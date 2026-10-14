use crate::{
    manifest::{validate_filename, MAX_TEXT_BYTES},
    model::ResourceFile,
    AppError, Result,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;

pub(crate) const MAX_FILES: usize = 5000;
pub(crate) const MAX_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct FileData {
    pub path: String,
    pub bytes: Vec<u8>,
    pub executable: bool,
    pub permissions: Option<fs::Permissions>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Snapshot {
    pub files: Vec<FileData>,
    pub directories: Vec<String>,
    pub root_permissions: Option<fs::Permissions>,
    pub directory_permissions: HashMap<String, fs::Permissions>,
}

pub(crate) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn relative_path(value: &str) -> Result<PathBuf> {
    if value.is_empty() || value.contains('\\') || value.contains('\0') {
        return Err(AppError::new(
            "path",
            "文件路径必须是资源目录内的相对路径。",
        ));
    }
    let path = PathBuf::from(value);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(AppError::new("path", "不允许绝对路径或路径穿越。"));
    }
    for component in path.components() {
        validate_filename(&component.as_os_str().to_string_lossy())?;
    }
    Ok(path)
}

pub(crate) fn path_has_symlink(path: &Path) -> bool {
    path.ancestors()
        .any(|ancestor| fs::symlink_metadata(ancestor).is_ok_and(|m| m.file_type().is_symlink()))
}

pub(crate) fn ensure_writable_path(path: &Path) -> Result<()> {
    if path_has_symlink(path) {
        return Err(AppError::new(
            "readOnly",
            "此路径包含符号链接，当前版本仅允许查看，不能覆盖或删除链接目标。",
        ));
    }
    Ok(())
}

impl Snapshot {
    pub(crate) fn read(path: &Path, directory: bool) -> Result<Option<Self>> {
        ensure_writable_path(path)?;
        if !path.exists() {
            return Ok(None);
        }
        if directory != path.is_dir() {
            return Err(AppError::new("path", "目标文件类型发生变化，请重新扫描。"));
        }
        let mut snapshot = Self {
            root_permissions: if directory {
                Some(fs::metadata(path)?.permissions())
            } else {
                None
            },
            ..Self::default()
        };
        let mut total = 0u64;
        let mut case_names = HashSet::new();
        let entries: Vec<_> = if directory {
            WalkDir::new(path)
                .follow_links(false)
                .sort_by_file_name()
                .into_iter()
                .skip(1)
                .collect::<std::result::Result<_, _>>()
                .map_err(|e| AppError::new("io", format!("目录读取失败：{e}")))?
        } else {
            Vec::new()
        };
        if entries.len() > MAX_FILES {
            return Err(AppError::new("limit", "资源最多包含 5,000 个文件和目录。"));
        }
        if !directory {
            snapshot.add_file(
                path,
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                &mut total,
            )?;
        }
        for entry in entries {
            if entry.file_type().is_symlink() {
                return Err(AppError::new(
                    "readOnly",
                    "资源包含符号链接。当前版本不导入、编辑或删除此资源。",
                ));
            }
            let relative = entry
                .path()
                .strip_prefix(path)
                .map_err(|_| AppError::new("path", "目录不在资源范围内。"))?
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            relative_path(&relative)?;
            if !case_names.insert(relative.to_lowercase()) {
                return Err(AppError::new(
                    "validation",
                    "资源包含仅大小写不同的同名路径，无法安全跨平台使用。",
                ));
            }
            if entry.file_type().is_dir() {
                snapshot
                    .directory_permissions
                    .insert(relative.clone(), fs::metadata(entry.path())?.permissions());
                snapshot.directories.push(relative);
            } else if entry.file_type().is_file() {
                snapshot.add_file(entry.path(), relative, &mut total)?;
            } else {
                return Err(AppError::new(
                    "validation",
                    "不允许设备文件、套接字或其他特殊文件。",
                ));
            }
        }
        snapshot.files.sort_by(|a, b| a.path.cmp(&b.path));
        snapshot.directories.sort();
        Ok(Some(snapshot))
    }

    fn add_file(&mut self, full_path: &Path, relative: String, total: &mut u64) -> Result<()> {
        let metadata = fs::metadata(full_path)?;
        *total = total
            .checked_add(metadata.len())
            .ok_or_else(|| AppError::new("limit", "资源大小超限。"))?;
        if *total > MAX_BYTES {
            return Err(AppError::new("limit", "资源总大小不能超过 200 MB。"));
        }
        let bytes = fs::read(full_path)?;
        if bytes.len() as u64 != metadata.len() {
            return Err(AppError::conflict());
        }
        #[cfg(unix)]
        let executable = {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode() & 0o111 != 0
        };
        #[cfg(not(unix))]
        let executable = false;
        self.files.push(FileData {
            path: relative,
            bytes,
            executable,
            permissions: Some(metadata.permissions()),
        });
        Ok(())
    }

    pub(crate) fn text(&self, relative: &str) -> Result<String> {
        relative_path(relative)?;
        let file = self
            .files
            .iter()
            .find(|f| f.path == relative)
            .ok_or_else(|| AppError::new("notFound", "资源文件不存在。"))?;
        if file.bytes.len() > MAX_TEXT_BYTES {
            return Err(AppError::new(
                "limit",
                "此文件超过 2 MB，可保留和导入，但不能在编辑器内编辑。",
            ));
        }
        String::from_utf8(file.bytes.clone()).map_err(|_| {
            AppError::new(
                "binary",
                "此文件不是 UTF-8 文本，可保留但不能在编辑器内编辑。",
            )
        })
    }

    pub(crate) fn fingerprint(&self) -> String {
        let mut hash = Sha256::new();
        for dir in &self.directories {
            hash.update(b"dir\0");
            hash.update(dir.as_bytes());
            hash.update([0]);
        }
        for file in &self.files {
            hash.update(b"file\0");
            hash.update(file.path.as_bytes());
            hash.update([0]);
            hash.update((file.bytes.len() as u64).to_le_bytes());
            hash.update(&file.bytes);
            hash.update([u8::from(file.executable)]);
        }
        format!("{:x}", hash.finalize())
    }

    pub(crate) fn files(&self) -> Vec<ResourceFile> {
        self.files
            .iter()
            .map(|f| ResourceFile {
                path: f.path.clone(),
                size: f.bytes.len() as u64,
                editable: f.bytes.len() <= MAX_TEXT_BYTES && std::str::from_utf8(&f.bytes).is_ok(),
            })
            .collect()
    }

    pub(crate) fn replace_text(&mut self, relative: &str, content: &str) -> Result<()> {
        relative_path(relative)?;
        let file = self
            .files
            .iter_mut()
            .find(|f| f.path == relative)
            .ok_or_else(|| AppError::new("notFound", "只能编辑资源中已有的文件。"))?;
        file.bytes = content.as_bytes().to_vec();
        Ok(())
    }

    pub(crate) fn write(&self, path: &Path, directory: bool) -> Result<()> {
        ensure_writable_path(path)?;
        if path.exists() {
            return Err(AppError::new("exists", "暂存路径已存在。"));
        }
        if directory {
            fs::create_dir(path)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
            }
            for dir in &self.directories {
                fs::create_dir_all(path.join(relative_path(dir)?))?;
            }
            for file in &self.files {
                let full = path.join(relative_path(&file.path)?);
                fs::create_dir_all(
                    full.parent()
                        .ok_or_else(|| AppError::new("path", "文件缺少父目录。"))?,
                )?;
                write_new_file(&full, file)?;
            }
            for directory in self.directories.iter().rev() {
                if let Some(permissions) = self.directory_permissions.get(directory) {
                    fs::set_permissions(path.join(relative_path(directory)?), permissions.clone())?;
                }
            }
            if let Some(permissions) = &self.root_permissions {
                fs::set_permissions(path, permissions.clone())?;
            }
        } else {
            if self.files.len() != 1 {
                return Err(AppError::new("data", "单文件资源包含多个文件。"));
            }
            write_new_file(path, &self.files[0])?;
        }
        Ok(())
    }
}

fn write_new_file(path: &Path, data: &FileData) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(&data.bytes)?;
    file.sync_all()?;
    if let Some(permissions) = &data.permissions {
        fs::set_permissions(path, permissions.clone())?;
    }
    Ok(())
}

pub(crate) fn fingerprint(snapshot: &Option<Snapshot>) -> String {
    snapshot
        .as_ref()
        .map(Snapshot::fingerprint)
        .unwrap_or_else(|| "missing".into())
}

pub(crate) fn remove_generated(path: &Path) -> Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub(crate) fn modified_at(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|t| t.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn read_text(path: &Path) -> Result<String> {
    let size = fs::metadata(path)?.len();
    if size > MAX_TEXT_BYTES as u64 {
        return Err(AppError::new("limit", "编辑文件不能超过 2 MB。"));
    }
    Ok(fs::read_to_string(path)?)
}
