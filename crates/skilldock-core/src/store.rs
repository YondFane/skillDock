use crate::{
    adapters::{self, display},
    files::{self, digest, fingerprint, read_text, relative_path, FileData, Snapshot},
    manifest::{
        compatibility_warnings, rule_description, skill_metadata, validate_filename, validate_text,
    },
    model::*,
    AppError, Result,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use walkdir::WalkDir;

struct ChangePlan {
    preview: ChangePreview,
    location: Location,
    before: Option<Snapshot>,
    after: Option<Snapshot>,
    asset_before: Option<Asset>,
    asset_after: Option<Asset>,
    expected_state: String,
}

pub struct Store {
    root: PathBuf,
    home: PathBuf,
    connection: Connection,
    pending: HashMap<String, ChangePlan>,
    locals: HashMap<String, (Resource, Location)>,
    startup_warnings: Vec<String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn uuid() -> String {
    Uuid::new_v4().to_string()
}

impl Store {
    /// Explicit roots make the same implementation usable in isolated integration tests.
    pub fn open(data_dir: &Path, home: &Path) -> Result<Self> {
        fs::create_dir_all(data_dir)?;
        let root = data_dir.canonicalize()?;
        fs::create_dir_all(root.join("assets"))?;
        fs::create_dir_all(root.join("backups"))?;
        fs::create_dir_all(home)?;
        let home = home.canonicalize()?;
        let connection = Connection::open(root.join("skilldock.sqlite3"))?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL);"
        )?;
        // Add grouping without rewriting project identities, paths or resource files.
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS workspace_projects (
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                PRIMARY KEY(workspace_id, project_id)
             );
             INSERT OR IGNORE INTO workspaces(id,name) VALUES('default','默认工作区');
             INSERT OR IGNORE INTO workspace_projects(workspace_id,project_id)
                SELECT 'default', id FROM projects
                WHERE NOT EXISTS(SELECT 1 FROM workspace_projects WHERE project_id=projects.id);
             PRAGMA user_version = 2;
             COMMIT;",
        )?;
        let mut store = Self {
            root,
            home,
            connection,
            pending: HashMap::new(),
            locals: HashMap::new(),
            startup_warnings: vec![],
        };
        store.recover_interrupted()?;
        Ok(store)
    }

    pub fn settings(&self) -> Result<Settings> {
        let stored: Option<String> = self
            .connection
            .query_row("SELECT data FROM settings WHERE id=1", [], |r| r.get(0))
            .optional()?;
        if let Some(stored) = stored {
            return Ok(serde_json::from_str(&stored)?);
        }
        Ok(Settings {
            claude_root: display(&self.home.join(".claude")),
            codex_root: std::env::var_os("CODEX_HOME")
                .filter(|_| std::env::var_os("SKILLDOCK_HOME_DIR").is_none())
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .map(|path| display(&path))
                .unwrap_or_else(|| display(&self.home.join(".codex"))),
            codex_skills_root: display(&self.home.join(".agents/skills")),
        })
    }

    pub fn save_settings(&mut self, settings: Settings) -> Result<Overview> {
        for path in [
            &settings.claude_root,
            &settings.codex_root,
            &settings.codex_skills_root,
        ] {
            self.validate_root(Path::new(path))?;
        }
        self.connection.execute("INSERT INTO settings(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&settings)?])?;
        self.pending.clear();
        self.locals.clear();
        self.overview()
    }

    fn validate_root(&self, path: &Path) -> Result<()> {
        if !path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(AppError::new(
                "path",
                "配置目录必须为绝对路径，且不能包含 ..。",
            ));
        }
        let absolute = if path.exists() {
            path.canonicalize()?
        } else {
            path.to_owned()
        };
        if absolute.starts_with(&self.root) {
            return Err(AppError::new(
                "path",
                "不能将 SkillDock 自身的数据目录作为工具配置或项目目录。",
            ));
        }
        Ok(())
    }

    pub fn projects(&self) -> Result<Vec<Project>> {
        let mut query = self
            .connection
            .prepare("SELECT data FROM projects ORDER BY path")?;
        let rows = query.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn add_project(&mut self, path: &str) -> Result<Overview> {
        let result = self.add_projects_to_workspace(DEFAULT_WORKSPACE_ID, vec![path.to_owned()])?;
        if let Some(failure) = result.failures.first() {
            return Err(AppError::new("path", &failure.message));
        }
        Ok(result.overview)
    }

    fn project_from_path(&self, path: &str) -> Result<Project> {
        let path = PathBuf::from(path).canonicalize()?;
        if !path.is_dir() {
            return Err(AppError::new("path", "请选择一个存在的项目目录。"));
        }
        self.validate_root(&path)?;
        let id = self
            .connection
            .query_row(
                "SELECT id FROM projects WHERE path=?1",
                [display(&path)],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_else(uuid);
        Ok(Project {
            id,
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: display(&path),
        })
    }

    pub fn workspaces(&self) -> Result<Vec<Workspace>> {
        let mut query = self.connection.prepare("SELECT id,name FROM workspaces ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END, name,id")?;
        let groups = query
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        groups.into_iter().map(|(id, name)| {
            let mut members = self.connection.prepare("SELECT project_id FROM workspace_projects WHERE workspace_id=?1 ORDER BY project_id")?;
            let project_ids = members.query_map([&id], |row| row.get(0))?.collect::<std::result::Result<Vec<String>, _>>()?;
            Ok(Workspace { id, name, project_ids })
        }).collect()
    }

    fn validate_workspace(&self, id: &str) -> Result<()> {
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1)",
            [id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::new("notFound", "工作区已不存在，请重新选择。"));
        }
        Ok(())
    }

    fn validate_workspace_name(&self, name: &str, except: Option<&str>) -> Result<String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err(AppError::new(
                "validation",
                "工作区名称需为 1–80 个字符，不能包含控制字符。",
            ));
        }
        if self.workspaces()?.iter().any(|item| {
            Some(item.id.as_str()) != except && item.name.to_lowercase() == name.to_lowercase()
        }) {
            return Err(AppError::new("exists", "已有同名工作区，请使用其他名称。"));
        }
        Ok(name.to_owned())
    }

    pub fn create_workspace(&mut self, name: &str) -> Result<Overview> {
        let name = self.validate_workspace_name(name, None)?;
        self.connection.execute(
            "INSERT INTO workspaces(id,name) VALUES(?1,?2)",
            params![uuid(), name],
        )?;
        self.overview()
    }

    pub fn rename_workspace(&mut self, id: &str, name: &str) -> Result<Overview> {
        self.validate_workspace(id)?;
        let name = self.validate_workspace_name(name, Some(id))?;
        self.connection.execute(
            "UPDATE workspaces SET name=?1 WHERE id=?2",
            params![name, id],
        )?;
        self.overview()
    }

    pub fn delete_workspace(&mut self, id: &str) -> Result<Overview> {
        self.validate_workspace(id)?;
        if id == DEFAULT_WORKSPACE_ID {
            return Err(AppError::new("validation", "默认工作区不能删除。"));
        }
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM workspaces WHERE id=?1", [id])?;
        // Keep projects accessible even if their only group was removed.
        transaction.execute("INSERT OR IGNORE INTO workspace_projects(workspace_id,project_id) SELECT 'default',id FROM projects WHERE NOT EXISTS(SELECT 1 FROM workspace_projects WHERE project_id=projects.id)", [])?;
        transaction.commit()?;
        self.overview()
    }

    pub fn add_projects_to_workspace(
        &mut self,
        workspace_id: &str,
        paths: Vec<String>,
    ) -> Result<AddProjectsResult> {
        self.validate_workspace(workspace_id)?;
        let mut failures = Vec::new();
        let mut projects = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for path in paths {
            match self.project_from_path(&path) {
                Ok(project) if seen.insert(project.path.clone()) => projects.push(project),
                Ok(_) => {}
                Err(error) => failures.push(ProjectImportFailure {
                    path,
                    message: error.message,
                }),
            }
        }
        let mut added_project_ids = Vec::new();
        let mut already_present = 0;
        let transaction = self.connection.transaction()?;
        for project in projects {
            transaction.execute(
                "INSERT OR IGNORE INTO projects(id,path,data) VALUES(?1,?2,?3)",
                params![project.id, project.path, serde_json::to_string(&project)?],
            )?;
            let inserted = transaction.execute(
                "INSERT OR IGNORE INTO workspace_projects(workspace_id,project_id) VALUES(?1,?2)",
                params![workspace_id, project.id],
            )?;
            if inserted == 1 {
                added_project_ids.push(project.id);
            } else {
                already_present += 1;
            }
        }
        transaction.commit()?;
        Ok(AddProjectsResult {
            overview: self.overview()?,
            added_project_ids,
            already_present,
            failures,
        })
    }

    pub fn remove_project_from_workspace(
        &mut self,
        workspace_id: &str,
        project_id: &str,
    ) -> Result<Overview> {
        self.validate_workspace(workspace_id)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "DELETE FROM workspace_projects WHERE workspace_id=?1 AND project_id=?2",
            params![workspace_id, project_id],
        )?;
        let removed = transaction.execute("DELETE FROM projects WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM workspace_projects WHERE project_id=?1)", [project_id])?;
        transaction.commit()?;
        if removed > 0 {
            self.pending.clear();
            self.locals.clear();
        }
        self.overview()
    }

    pub fn remove_project(&mut self, id: &str) -> Result<Overview> {
        self.connection
            .execute("DELETE FROM projects WHERE id=?1", [id])?;
        self.pending.clear();
        self.locals.clear();
        self.overview()
    }

    fn environments(&self) -> Result<Vec<Environment>> {
        Ok(adapters::environments(&self.settings()?, &self.projects()?))
    }

    fn environment(&self, id: &str) -> Result<Environment> {
        self.environments()?
            .into_iter()
            .find(|environment| environment.id == id)
            .ok_or_else(|| AppError::new("notFound", "环境已移除或配置发生变化，请重新选择目标。"))
    }

    fn assets(&self) -> Result<Vec<Asset>> {
        let mut query = self
            .connection
            .prepare("SELECT data FROM assets WHERE deleted=0")?;
        let rows = query.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    fn asset(&self, id: &str, include_deleted: bool) -> Result<Option<Asset>> {
        let data: Option<String> = self
            .connection
            .query_row(
                "SELECT data FROM assets WHERE id=?1 AND (deleted=0 OR ?2=1)",
                params![id, include_deleted],
                |r| r.get(0),
            )
            .optional()?;
        data.map(|data| Ok(serde_json::from_str(&data)?))
            .transpose()
    }

    fn asset_location(&self, asset: Asset) -> Location {
        Location {
            id: format!("asset:{}", asset.id),
            origin: Origin::Library,
            kind: asset.kind.clone(),
            path: self.root.join("assets").join(&asset.id),
            main_file: if asset.kind == Kind::Skill {
                "SKILL.md".into()
            } else {
                "rule.md".into()
            },
            is_directory: true,
            environment_id: None,
            asset: Some(asset),
        }
    }

    fn describe_asset(&self, asset: Asset) -> Resource {
        let location = self.asset_location(asset.clone());
        let content_path = location.path.join(&location.main_file);
        let mut warnings = Vec::new();
        let mut read_only = files::path_has_symlink(&location.path);
        let mut file_count = 0;
        if !content_path.is_file() {
            warnings.push("资源文件丢失，请通过变更记录恢复。".into());
        }
        if let Ok(content) = read_text(&content_path) {
            if digest(content.as_bytes()) != asset.content_hash {
                warnings.push("主文件在应用外被修改；读取后保存可刷新元数据。".into());
            }
            warnings.extend(compatibility_warnings(
                &content,
                asset.compatibility == Compatibility::Both,
            ));
        }
        for entry in WalkDir::new(&location.path)
            .follow_links(false)
            .into_iter()
            .take(5001)
        {
            match entry {
                Ok(entry) if entry.file_type().is_symlink() => read_only = true,
                Ok(entry) if entry.file_type().is_file() => file_count += 1,
                Err(_) => {}
                _ => {}
            }
        }
        if read_only {
            warnings.push("资源含符号链接，当前版本仅可查看。".into());
        }
        Resource {
            id: location.id,
            origin: Origin::Library,
            kind: asset.kind,
            name: asset.name,
            description: asset.description,
            compatibility: asset.compatibility,
            environment_id: None,
            tool: None,
            scope: "library".into(),
            path: display(&location.path),
            main_file: location.main_file,
            source: asset.source,
            updated_at: asset.updated_at,
            revision: asset.revision,
            file_count,
            read_only,
            warnings,
        }
    }

    pub fn overview(&mut self) -> Result<Overview> {
        let settings = self.settings()?;
        let projects = self.projects()?;
        let environments = adapters::environments(&settings, &projects);
        let (locals, mut warnings) = adapters::scan(&environments);
        self.locals = locals
            .into_iter()
            .map(|pair| (pair.0.id.clone(), pair))
            .collect();
        let mut resources: Vec<_> = self
            .assets()?
            .into_iter()
            .map(|asset| self.describe_asset(asset))
            .collect();
        resources.extend(self.locals.values().map(|pair| pair.0.clone()));
        resources.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then(a.name.cmp(&b.name))
                .then(a.id.cmp(&b.id))
        });
        warnings.extend(self.startup_warnings.clone());
        Ok(Overview {
            resources,
            environments,
            projects,
            workspaces: self.workspaces()?,
            settings,
            data_dir: display(&self.root),
            warnings,
        })
    }

    fn resolve(&mut self, id: &str) -> Result<(Resource, Location)> {
        if let Some(asset_id) = id.strip_prefix("asset:") {
            let asset = self
                .asset(asset_id, false)?
                .ok_or_else(|| AppError::new("notFound", "资源已删除或不存在。"))?;
            let resource = self.describe_asset(asset.clone());
            return Ok((resource, self.asset_location(asset)));
        }
        if !self.locals.contains_key(id) {
            self.overview()?;
        }
        let (cached, location) = self
            .locals
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::new("notFound", "本地资源不存在，请重新扫描。"))?;
        let environment = self.environment(location.environment_id.as_deref().unwrap_or(""))?;
        adapters::describe(
            &environment,
            &location.path,
            location.kind,
            cached.source == "账号同步",
        )
    }

    fn validate_location(&self, location: &Location) -> Result<()> {
        if location.origin == Origin::Library {
            let asset_id = location
                .id
                .strip_prefix("asset:")
                .ok_or_else(|| AppError::new("path", "资源标识无效。"))?;
            Uuid::parse_str(asset_id).map_err(|_| AppError::new("path", "资源标识无效。"))?;
            if location.path != self.root.join("assets").join(asset_id) {
                return Err(AppError::new("path", "资源路径不在资源库中。"));
            }
            files::ensure_writable_path(&location.path)
        } else {
            adapters::validate_local_location(
                location,
                &self.environment(location.environment_id.as_deref().unwrap_or(""))?,
            )
        }
    }

    fn current_asset(&self, location: &Location) -> Result<Option<Asset>> {
        if let Some(id) = location.id.strip_prefix("asset:") {
            self.asset(id, false)
        } else {
            Ok(None)
        }
    }

    fn state_fingerprint(
        &self,
        location: &Location,
        snapshot: &Option<Snapshot>,
    ) -> Result<String> {
        let disk = fingerprint(snapshot);
        let metadata = self
            .current_asset(location)?
            .map(|asset| serde_json::to_string(&asset))
            .transpose()?
            .unwrap_or_default();
        Ok(digest(format!("{disk}\0{metadata}").as_bytes()))
    }

    pub fn resource_detail(&mut self, id: &str, relative: Option<&str>) -> Result<ResourceDetail> {
        let (resource, location) = self.resolve(id)?;
        let relative = relative.unwrap_or(&location.main_file);
        relative_path(relative)?;
        if resource.read_only {
            if relative != location.main_file {
                return Err(AppError::new("readOnly", "只读链接资源仅可预览主文件。"));
            }
            let path = if location.is_directory {
                location.path.join(&location.main_file)
            } else {
                location.path.clone()
            };
            let content = read_text(&path)?;
            let fingerprint = digest(content.as_bytes());
            let files = vec![ResourceFile {
                path: location.main_file.clone(),
                size: content.len() as u64,
                editable: false,
            }];
            return Ok(ResourceDetail {
                resource,
                content,
                relative_path: relative.into(),
                fingerprint,
                files,
            });
        }
        let snapshot = Snapshot::read(&location.path, location.is_directory)?
            .ok_or_else(|| AppError::new("notFound", "资源文件已被移除，请刷新列表。"))?;
        let content = snapshot.text(relative)?;
        let fingerprint = self.state_fingerprint(&location, &Some(snapshot.clone()))?;
        Ok(ResourceDetail {
            resource,
            content,
            relative_path: relative.into(),
            fingerprint,
            files: snapshot.files(),
        })
    }

    fn metadata(&self, kind: &Kind, name: &str, content: &str) -> Result<(String, String)> {
        validate_text(content)?;
        if *kind == Kind::Skill {
            skill_metadata(content)
        } else {
            validate_filename(name.trim())?;
            Ok((name.trim().into(), rule_description(content)))
        }
    }

    pub fn preview_create(&mut self, input: CreateInput) -> Result<ChangePreview> {
        let (name, description) = self.metadata(&input.kind, &input.name, &input.content)?;
        let asset = Asset {
            id: uuid(),
            kind: input.kind.clone(),
            name: name.clone(),
            description,
            compatibility: input.compatibility.clone(),
            source: "新建".into(),
            created_at: now(),
            updated_at: now(),
            revision: 1,
            content_hash: digest(input.content.as_bytes()),
        };
        let location = if input.target == "library" {
            self.asset_location(asset.clone())
        } else {
            let environment = self.environment(&input.target)?;
            if environment.read_only {
                return Err(AppError::new("readOnly", "该环境仅支持查看。"));
            }
            let path = if input.kind == Kind::Skill {
                Path::new(&environment.skills_root).join(&name)
            } else if environment.tool == Tool::Claude {
                Path::new(environment.rules_root.as_deref().unwrap_or(""))
                    .join(format!("{name}.md"))
            } else {
                let root = Path::new(&environment.root);
                let override_path = root.join("AGENTS.override.md");
                if read_text(&override_path).is_ok_and(|text| !text.trim().is_empty()) {
                    override_path
                } else {
                    root.join("AGENTS.md")
                }
            };
            let main_file = if input.kind == Kind::Skill {
                "SKILL.md".into()
            } else {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            };
            Location {
                id: adapters::local_id(&environment, &path),
                origin: Origin::Local,
                kind: input.kind.clone(),
                path,
                main_file,
                is_directory: input.kind == Kind::Skill,
                environment_id: Some(environment.id),
                asset: None,
            }
        };
        self.validate_location(&location)?;
        if location.path.exists() {
            let mut error = AppError::new(
                "exists",
                "目标已存在。请从列表打开它进行编辑，或使用其他名称。",
            );
            error.existing_resource_id = Some(location.id.clone());
            return Err(error);
        }
        self.ensure_no_case_collision(&location.path)?;
        let after = Snapshot {
            files: vec![FileData {
                path: location.main_file.clone(),
                bytes: input.content.into_bytes(),
                executable: false,
                permissions: None,
            }],
            directories: vec![],
            ..Snapshot::default()
        };
        let asset_after = if location.origin == Origin::Library {
            Some(asset)
        } else {
            None
        };
        self.plan("create", name, location, None, Some(after), asset_after)
    }

    fn ensure_no_case_collision(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent().filter(|p| p.exists()) {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            for entry in fs::read_dir(parent)? {
                if entry?.file_name().to_string_lossy().to_lowercase() == name {
                    return Err(AppError::new(
                        "exists",
                        "目标目录存在同名或仅大小写不同的资源，请使用其他名称。",
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn preview_edit(&mut self, input: EditInput) -> Result<ChangePreview> {
        self.preview_edit_files(EditFilesInput {
            id: input.id,
            name: input.name,
            compatibility: input.compatibility,
            files: vec![FileEdit {
                relative_path: input.relative_path,
                content: input.content,
            }],
            expected_fingerprint: input.expected_fingerprint,
        })
    }

    pub fn preview_edit_files(&mut self, input: EditFilesInput) -> Result<ChangePreview> {
        if input.files.len() > files::MAX_FILES {
            return Err(AppError::new("validation", "一次最多编辑 5,000 个文件。"));
        }
        let (resource, location) = self.resolve(&input.id)?;
        if resource.read_only {
            return Err(AppError::new("readOnly", "该资源仅支持查看。"));
        }
        self.validate_location(&location)?;
        let before = Snapshot::read(&location.path, location.is_directory)?;
        if self.state_fingerprint(&location, &before)? != input.expected_fingerprint {
            return Err(AppError::conflict());
        }
        let mut after = before
            .clone()
            .ok_or_else(|| AppError::new("notFound", "资源已被移除。"))?;
        let mut seen = std::collections::HashSet::new();
        for file in &input.files {
            let path = relative_path(&file.relative_path)?;
            if !seen.insert(path) {
                return Err(AppError::new("validation", "修改列表包含重复文件。"));
            }
            validate_text(&file.content)?;
            // Do not turn a binary or oversized file into an editable text file.
            after.text(&file.relative_path)?;
            after.replace_text(&file.relative_path, &file.content)?;
        }
        if after
            .files
            .iter()
            .map(|file| file.bytes.len() as u64)
            .sum::<u64>()
            > files::MAX_BYTES
        {
            return Err(AppError::new("limit", "修改后的完整资源不能超过 200 MB。"));
        }
        let mut asset_after = location.asset.clone();
        if let Some(asset) = &mut asset_after {
            let main = after.text(&location.main_file)?;
            let (name, description) = self.metadata(&location.kind, &input.name, &main)?;
            asset.name = name;
            asset.description = description;
            asset.compatibility = input.compatibility;
            asset.updated_at = now();
            asset.revision += 1;
            asset.content_hash = digest(main.as_bytes());
        } else if location.kind == Kind::Skill {
            let (name, _) = skill_metadata(&after.text(&location.main_file)?)?;
            let folder = location
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy();
            if name != folder {
                return Err(AppError::new(
                    "validation",
                    "本地技能 name 必须与目录名一致。重命名请先导入资源库，再另行创建目标。",
                ));
            }
        }
        self.plan(
            "edit",
            resource.name,
            location,
            before,
            Some(after),
            asset_after,
        )
    }

    pub fn preview_delete(
        &mut self,
        id: &str,
        expected_fingerprint: &str,
    ) -> Result<ChangePreview> {
        let (resource, location) = self.resolve(id)?;
        if resource.read_only {
            return Err(AppError::new("readOnly", "该资源仅支持查看。"));
        }
        self.validate_location(&location)?;
        let before = Snapshot::read(&location.path, location.is_directory)?;
        if self.state_fingerprint(&location, &before)? != expected_fingerprint {
            return Err(AppError::conflict());
        }
        self.plan("delete", resource.name, location, before, None, None)
    }

    pub fn preview_import(
        &mut self,
        path: &str,
        compatibility: Compatibility,
    ) -> Result<ChangePreview> {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err(AppError::new(
                "path",
                "请选择绝对路径的技能目录或 Markdown 规则文件。",
            ));
        }
        let path = if path.file_name().is_some_and(|name| name == "SKILL.md") {
            path.parent().unwrap_or(&path).to_owned()
        } else {
            path
        };
        let directory = path.is_dir();
        let kind = if directory { Kind::Skill } else { Kind::Rule };
        if !directory
            && !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            return Err(AppError::new(
                "validation",
                "规则导入仅支持 Markdown 文件；技能请导入包含 SKILL.md 的完整目录。",
            ));
        }
        let mut snapshot = Snapshot::read(&path, directory)?
            .ok_or_else(|| AppError::new("notFound", "导入来源不存在。"))?;
        let original_file = if directory {
            "SKILL.md".into()
        } else {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        };
        let content = snapshot.text(&original_file)?;
        let candidate_name = path.file_stem().unwrap_or_default().to_string_lossy();
        let (name, description) = self.metadata(&kind, &candidate_name, &content)?;
        if !directory {
            snapshot.files[0].path = "rule.md".into();
        }
        let asset = Asset {
            id: uuid(),
            kind: kind.clone(),
            name: name.clone(),
            description,
            compatibility,
            source: format!("本地导入 · {}", display(&path)),
            created_at: now(),
            updated_at: now(),
            revision: 1,
            content_hash: digest(content.as_bytes()),
        };
        let location = self.asset_location(asset.clone());
        self.plan("import", name, location, None, Some(snapshot), Some(asset))
    }

    pub fn preview_adopt(&mut self, id: &str) -> Result<ChangePreview> {
        let (resource, location) = self.resolve(id)?;
        self.preview_import(&display(&location.path), resource.compatibility)
    }

    fn plan(
        &mut self,
        action: &str,
        name: String,
        location: Location,
        before: Option<Snapshot>,
        after: Option<Snapshot>,
        asset_after: Option<Asset>,
    ) -> Result<ChangePreview> {
        self.validate_location(&location)?;
        let asset_before = self.current_asset(&location)?;
        let expected_state = self.state_fingerprint(&location, &before)?;
        let before_content = before
            .as_ref()
            .map(|snapshot| snapshot.text(&location.main_file))
            .transpose()?
            .unwrap_or_default();
        let after_content = after
            .as_ref()
            .map(|snapshot| snapshot.text(&location.main_file))
            .transpose()?
            .unwrap_or_default();
        let mut changed_files = Vec::new();
        let empty = Snapshot::default();
        let old = before.as_ref().unwrap_or(&empty);
        let new = after.as_ref().unwrap_or(&empty);
        for file in old.files.iter().chain(new.files.iter()) {
            if changed_files.contains(&file.path) {
                continue;
            }
            let a = old.files.iter().find(|f| f.path == file.path);
            let b = new.files.iter().find(|f| f.path == file.path);
            if a.map(|f| (&f.bytes, f.executable)) != b.map(|f| (&f.bytes, f.executable)) {
                changed_files.push(file.path.clone());
            }
        }
        let both = asset_after
            .as_ref()
            .is_some_and(|asset| asset.compatibility == Compatibility::Both);
        let mut warnings = compatibility_warnings(&after_content, both);
        if location.origin == Origin::Local {
            warnings.push("写入后仅验证文件内容。请在对应客户端刷新技能或开启新会话确认加载；已进入会话的旧指令不会自动消失。".into());
        }
        if action == "delete" {
            warnings.push(
                "删除会移除该资源及其附属文件。完整副本会保留在变更记录中，可预览恢复。".into(),
            );
        }
        let preview = ChangePreview {
            id: uuid(),
            action: action.into(),
            name,
            target_path: display(&location.path),
            before_content,
            after_content,
            changed_files,
            total_files: old.files.len().max(new.files.len()),
            removes_resource: after.is_none(),
            warnings,
        };
        // One window has one review at a time. Old previews must never be reused.
        self.pending.clear();
        self.pending.insert(
            preview.id.clone(),
            ChangePlan {
                preview: preview.clone(),
                location,
                before,
                after,
                asset_before,
                asset_after,
                expected_state,
            },
        );
        Ok(preview)
    }

    pub fn history(&self) -> Result<Vec<Operation>> {
        let mut query = self
            .connection
            .prepare("SELECT data FROM operations ORDER BY created_at DESC LIMIT 200")?;
        let rows = query.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str::<Journal>(&row?)?.operation))
            .collect()
    }

    fn journal(&self, id: &str) -> Result<Journal> {
        let data: String = self
            .connection
            .query_row("SELECT data FROM operations WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or_else(|| AppError::new("notFound", "变更记录不存在。"))?;
        Ok(serde_json::from_str(&data)?)
    }

    fn write_journal(&self, journal: &Journal) -> Result<()> {
        self.connection.execute("INSERT INTO operations(id,created_at,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            params![journal.operation.id, journal.operation.created_at as i64, serde_json::to_string(journal)?])?;
        Ok(())
    }

    pub fn preview_restore(&mut self, operation_id: &str) -> Result<ChangePreview> {
        let journal = self.journal(operation_id)?;
        if journal.operation.status != "completed" {
            return Err(AppError::new("validation", "仅能恢复已完成的变更。"));
        }
        self.validate_location(&journal.location)?;
        let expected_backup = self.root.join("backups").join(operation_id).join("before");
        if journal.backup_path != expected_backup {
            return Err(AppError::new("path", "备份路径校验失败。"));
        }
        let before = Snapshot::read(&journal.location.path, journal.location.is_directory)?;
        let after = if journal.before_fingerprint == "missing" {
            None
        } else {
            let mut snapshot = Snapshot::read(&journal.backup_path, journal.location.is_directory)?
                .ok_or_else(|| AppError::new("notFound", "备份文件已丢失。"))?;
            // Single-file backups are stored as "before", but the fingerprint and
            // editor use the original resource filename.
            if !journal.location.is_directory {
                snapshot.files[0].path = journal.location.main_file.clone();
            }
            Some(snapshot)
        };
        if fingerprint(&after) != journal.before_fingerprint {
            return Err(AppError::new("data", "备份内容校验失败，无法恢复。"));
        }
        let mut asset_after = journal.asset_before.clone();
        if let Some(asset) = &mut asset_after {
            let existing = self.asset(&asset.id, true)?;
            asset.revision = existing
                .map(|asset| asset.revision + 1)
                .unwrap_or(asset.revision + 1);
            asset.updated_at = now();
        }
        self.plan(
            "restore",
            journal.operation.name,
            journal.location,
            before,
            after,
            asset_after,
        )
    }

    pub fn apply(&mut self, preview_id: &str) -> Result<ApplyResult> {
        let plan = self
            .pending
            .remove(preview_id)
            .ok_or_else(|| AppError::new("expired", "变更预览已失效，请重新预览。"))?;
        self.validate_location(&plan.location)?;
        let current = Snapshot::read(&plan.location.path, plan.location.is_directory)?;
        if self.state_fingerprint(&plan.location, &current)? != plan.expected_state {
            return Err(AppError::conflict());
        }
        if current.is_none() && plan.after.is_some() {
            self.ensure_no_case_collision(&plan.location.path)?;
        }
        let parent = plan
            .location
            .path
            .parent()
            .ok_or_else(|| AppError::new("path", "目标目录缺少父目录。"))?;
        files::ensure_writable_path(parent)?;
        fs::create_dir_all(parent)?;
        let id = uuid();
        let backup_dir = self.root.join("backups").join(&id);
        fs::create_dir(&backup_dir)?;
        let mut journal = Journal {
            operation: Operation {
                id: id.clone(),
                action: plan.preview.action.clone(),
                name: plan.preview.name.clone(),
                origin: plan.location.origin.clone(),
                target_path: display(&plan.location.path),
                status: "pending".into(),
                created_at: now(),
                can_restore: false,
                error: None,
            },
            location: plan.location.clone(),
            asset_before: plan.asset_before.clone(),
            asset_after: plan.asset_after.clone(),
            before_fingerprint: fingerprint(&plan.before),
            after_fingerprint: fingerprint(&plan.after),
            backup_path: backup_dir.join("before"),
            stage_path: parent.join(format!(".skilldock-{id}.stage")),
            old_path: parent.join(format!(".skilldock-{id}.old")),
        };
        self.write_journal(&journal)?;
        let result = self.apply_files(&plan, &journal);
        if let Err(error) = result {
            let rollback = self.rollback_files(&journal);
            journal.operation.status = if rollback.is_ok() {
                "failed".into()
            } else {
                "needsRecovery".into()
            };
            journal.operation.error = Some(match rollback {
                Ok(()) => error.message.clone(),
                Err(rollback_error) => {
                    format!("{}；回退失败：{}", error.message, rollback_error.message)
                }
            });
            self.write_journal(&journal)?;
            return Err(AppError::new(
                error.code.as_str(),
                journal.operation.error.unwrap_or(error.message),
            ));
        }
        journal.operation.status = "completed".into();
        journal.operation.can_restore = true;
        let commit = self.commit_metadata(&journal);
        if let Err(error) = commit {
            let rollback = self.rollback_files(&journal);
            journal.operation.status = if rollback.is_ok() {
                "failed".into()
            } else {
                "needsRecovery".into()
            };
            journal.operation.error = Some(format!("{}；文件变更已尝试回退。", error.message));
            self.write_journal(&journal)?;
            return Err(error);
        }
        // The full pre-change snapshot is already stored in the application backup.
        if let Err(error) = files::remove_generated(&journal.old_path) {
            self.startup_warnings.push(format!(
                "旧暂存副本需要手动清理：{}；{}",
                display(&journal.old_path),
                error.message
            ));
        }
        self.locals.clear();
        let message = match plan.preview.action.as_str() {
            "delete" => "资源已删除，可从变更记录预览恢复。".into(),
            "restore" => "变更已恢复，文件内容已验证。".into(),
            _ if plan.location.origin == Origin::Local => {
                "本地文件已写入并验证。请在对应客户端确认加载。".into()
            }
            _ => "资源已保存到本地资源库。".into(),
        };
        Ok(ApplyResult {
            resource_id: plan.after.map(|_| plan.location.id),
            operation_id: id,
            message,
        })
    }

    fn apply_files(&self, plan: &ChangePlan, journal: &Journal) -> Result<()> {
        if let Some(before) = &plan.before {
            before.write(&journal.backup_path, plan.location.is_directory)?;
        }
        if let Some(after) = &plan.after {
            after.write(&journal.stage_path, plan.location.is_directory)?;
        }
        let before_now = Snapshot::read(&plan.location.path, plan.location.is_directory)?;
        if fingerprint(&before_now) != journal.before_fingerprint {
            return Err(AppError::conflict());
        }
        if plan.before.is_some() {
            fs::rename(&plan.location.path, &journal.old_path)?;
        }
        if plan.after.is_some() {
            fs::rename(&journal.stage_path, &plan.location.path)?;
        }
        let actual = Snapshot::read(&plan.location.path, plan.location.is_directory)?;
        if fingerprint(&actual) != journal.after_fingerprint {
            return Err(AppError::new("verification", "写入后的内容校验失败。"));
        }
        Ok(())
    }

    fn commit_metadata(&mut self, journal: &Journal) -> Result<()> {
        let tx = self.connection.transaction()?;
        if journal.location.origin == Origin::Library {
            if let Some(asset) = &journal.asset_after {
                tx.execute("INSERT INTO assets(id,data,deleted) VALUES(?1,?2,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,deleted=0",
                    params![asset.id, serde_json::to_string(asset)?])?;
            } else if let Some(asset) = &journal.asset_before {
                let mut tombstone = asset.clone();
                tombstone.revision += 1;
                tombstone.updated_at = now();
                tx.execute(
                    "UPDATE assets SET data=?1,deleted=1 WHERE id=?2",
                    params![serde_json::to_string(&tombstone)?, asset.id],
                )?;
            }
        }
        tx.execute(
            "UPDATE operations SET data=?1 WHERE id=?2",
            params![serde_json::to_string(journal)?, journal.operation.id],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn rollback_files(&self, journal: &Journal) -> Result<()> {
        self.validate_location(&journal.location)?;
        let parent = journal
            .location
            .path
            .parent()
            .ok_or_else(|| AppError::new("path", "记录缺少父目录。"))?;
        if journal.stage_path != parent.join(format!(".skilldock-{}.stage", journal.operation.id))
            || journal.old_path != parent.join(format!(".skilldock-{}.old", journal.operation.id))
        {
            return Err(AppError::new("path", "暂存目录校验失败。"));
        }
        if journal.old_path.exists() {
            let current = Snapshot::read(&journal.location.path, journal.location.is_directory)?;
            if current.is_some() && fingerprint(&current) != journal.after_fingerprint {
                return Err(AppError::new(
                    "conflict",
                    "中断后目标又被修改，已保留目标与旧副本，请人工恢复。",
                ));
            }
            files::remove_generated(&journal.location.path)?;
            fs::rename(&journal.old_path, &journal.location.path)?;
        } else if journal.before_fingerprint == "missing" {
            let current = Snapshot::read(&journal.location.path, journal.location.is_directory)?;
            if fingerprint(&current) == journal.after_fingerprint {
                files::remove_generated(&journal.location.path)?;
            } else if current.is_some() {
                return Err(AppError::conflict());
            }
        } else {
            let current = Snapshot::read(&journal.location.path, journal.location.is_directory)?;
            if fingerprint(&current) != journal.before_fingerprint {
                return Err(AppError::new(
                    "conflict",
                    "原始暂存副本丢失且目标已改变，请从变更记录备份人工恢复。",
                ));
            }
        }
        files::remove_generated(&journal.stage_path)?;
        Ok(())
    }

    fn recover_interrupted(&mut self) -> Result<()> {
        let journals: Vec<Journal> = {
            let mut query = self.connection.prepare("SELECT data FROM operations")?;
            let rows = query.query_map([], |r| r.get::<_, String>(0))?;
            rows.map(|row| Ok(serde_json::from_str::<Journal>(&row?)?))
                .collect::<Result<_>>()?
        };
        for mut journal in journals {
            if journal.operation.status != "pending" {
                continue;
            }
            match self.rollback_files(&journal) {
                Ok(()) => {
                    journal.operation.status = "interrupted".into();
                    journal.operation.error =
                        Some("上次操作被中断，已恢复操作前的文件状态。".into());
                }
                Err(error) => {
                    journal.operation.status = "needsRecovery".into();
                    journal.operation.error = Some(error.message.clone());
                    self.startup_warnings.push(format!(
                        "有一项中断变更需要恢复：{}；{}",
                        journal.operation.name, error.message
                    ));
                }
            }
            self.write_journal(&journal)?;
        }
        Ok(())
    }
}
