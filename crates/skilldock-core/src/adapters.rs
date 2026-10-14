use crate::{
    files::{digest, modified_at, path_has_symlink, read_text},
    manifest::{compatibility_warnings, rule_description, skill_metadata},
    model::*,
    AppError, Result,
};
use std::{
    fs,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

pub(crate) fn environments(settings: &Settings, projects: &[Project]) -> Vec<Environment> {
    let claude = PathBuf::from(&settings.claude_root);
    let codex = PathBuf::from(&settings.codex_root);
    let mut all = vec![
        Environment {
            id: "claude:global".into(),
            name: "Claude Code · 全局".into(),
            tool: Tool::Claude,
            scope: "global".into(),
            project_id: None,
            root: display(&claude),
            skills_root: display(&claude.join("skills")),
            rules_root: Some(display(&claude.join("rules"))),
            instruction_files: vec![display(&claude.join("CLAUDE.md"))],
            read_only: false,
        },
        Environment {
            id: "codex:global".into(),
            name: "Codex · 全局".into(),
            tool: Tool::Codex,
            scope: "global".into(),
            project_id: None,
            root: display(&codex),
            skills_root: settings.codex_skills_root.clone(),
            rules_root: None,
            instruction_files: vec![
                display(&codex.join("AGENTS.md")),
                display(&codex.join("AGENTS.override.md")),
            ],
            read_only: false,
        },
    ];
    let legacy = codex.join("skills");
    if legacy.is_dir() && legacy != Path::new(&settings.codex_skills_root) {
        all.push(Environment {
            id: "codex:legacy".into(),
            name: "Codex · 旧版技能目录（只读）".into(),
            tool: Tool::Codex,
            scope: "legacy".into(),
            project_id: None,
            root: display(&codex),
            skills_root: display(&legacy),
            rules_root: None,
            instruction_files: vec![],
            read_only: true,
        });
    }
    for project in projects {
        let root = PathBuf::from(&project.path);
        all.push(Environment {
            id: format!("claude:project:{}", project.id),
            name: format!("Claude Code · {}", project.name),
            tool: Tool::Claude,
            scope: "project".into(),
            project_id: Some(project.id.clone()),
            root: display(&root),
            skills_root: display(&root.join(".claude/skills")),
            rules_root: Some(display(&root.join(".claude/rules"))),
            instruction_files: vec![
                display(&root.join("CLAUDE.md")),
                display(&root.join(".claude/CLAUDE.md")),
                display(&root.join("CLAUDE.local.md")),
            ],
            read_only: false,
        });
        all.push(Environment {
            id: format!("codex:project:{}", project.id),
            name: format!("Codex · {}", project.name),
            tool: Tool::Codex,
            scope: "project".into(),
            project_id: Some(project.id.clone()),
            root: display(&root),
            skills_root: display(&root.join(".agents/skills")),
            rules_root: None,
            instruction_files: vec![
                display(&root.join("AGENTS.md")),
                display(&root.join("AGENTS.override.md")),
            ],
            read_only: false,
        });
    }
    all
}

pub(crate) fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(crate) fn local_id(environment: &Environment, path: &Path) -> String {
    format!(
        "local:{}",
        digest(format!("{}\0{}", environment.id, display(path)).as_bytes())
    )
}

pub(crate) fn scan(environments: &[Environment]) -> (Vec<(Resource, Location)>, Vec<String>) {
    let mut resources = Vec::new();
    let mut warnings = Vec::new();
    for environment in environments {
        let skills = Path::new(&environment.skills_root);
        if skills.exists() {
            match fs::read_dir(skills) {
                Ok(entries) => {
                    for entry in entries {
                        let entry = match entry {
                            Ok(entry) => entry,
                            Err(error) => {
                                warnings.push(format!("{}：{error}", environment.name));
                                continue;
                            }
                        };
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if name.starts_with('.') {
                            continue;
                        }
                        let path = entry.path();
                        if name == "synced" && environment.tool == Tool::Claude {
                            if let Ok(children) = fs::read_dir(&path) {
                                for child in children.flatten() {
                                    push_resource(
                                        environment,
                                        &child.path(),
                                        Kind::Skill,
                                        true,
                                        &mut resources,
                                        &mut warnings,
                                    );
                                }
                            }
                        } else {
                            push_resource(
                                environment,
                                &path,
                                Kind::Skill,
                                false,
                                &mut resources,
                                &mut warnings,
                            );
                        }
                    }
                }
                Err(error) => {
                    warnings.push(format!("无法读取 {} 的技能目录：{error}", environment.name))
                }
            }
        }
        if let Some(root) = &environment.rules_root {
            if Path::new(root).exists() {
                for entry in WalkDir::new(root).follow_links(false).max_depth(20) {
                    match entry {
                        Ok(entry)
                            if (entry.file_type().is_file() || entry.file_type().is_symlink())
                                && entry
                                    .path()
                                    .extension()
                                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md")) =>
                        {
                            push_resource(
                                environment,
                                entry.path(),
                                Kind::Rule,
                                false,
                                &mut resources,
                                &mut warnings,
                            )
                        }
                        Err(error) => {
                            warnings.push(format!("无法读取 {} 的规则：{error}", environment.name))
                        }
                        _ => {}
                    }
                    if resources.len() >= 10000 {
                        warnings.push("本地资源数量超过 10,000，扫描已停止。".into());
                        return (resources, warnings);
                    }
                }
            }
        }
        for path in &environment.instruction_files {
            if Path::new(path).exists() {
                push_resource(
                    environment,
                    Path::new(path),
                    Kind::Rule,
                    false,
                    &mut resources,
                    &mut warnings,
                );
            }
        }
    }
    (resources, warnings)
}

fn push_resource(
    environment: &Environment,
    path: &Path,
    kind: Kind,
    managed: bool,
    resources: &mut Vec<(Resource, Location)>,
    warnings: &mut Vec<String>,
) {
    if kind == Kind::Skill && !path.join("SKILL.md").is_file() {
        return;
    }
    match describe(environment, path, kind, managed) {
        Ok(resource) => resources.push(resource),
        Err(error) => warnings.push(format!("{}：{}", display(path), error.message)),
    }
}

pub(crate) fn describe(
    environment: &Environment,
    path: &Path,
    kind: Kind,
    managed: bool,
) -> Result<(Resource, Location)> {
    let directory = kind == Kind::Skill;
    let main_file = if directory {
        "SKILL.md".into()
    } else {
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    };
    let content_path = if directory {
        path.join(&main_file)
    } else {
        path.to_owned()
    };
    let mut warnings = Vec::new();
    let content = match read_text(&content_path) {
        Ok(content) => content,
        Err(error) => {
            warnings.push(error.message);
            String::new()
        }
    };
    let (name, description) = if directory {
        match skill_metadata(&content) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(error.message);
                (
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    "技能元数据需要修复".into(),
                )
            }
        }
    } else {
        (main_file.clone(), rule_description(&content))
    };
    let mut read_only = environment.read_only || managed || path_has_symlink(path);
    let mut file_count = usize::from(!directory);
    if directory {
        for entry in WalkDir::new(path).follow_links(false) {
            match entry {
                Ok(entry) if entry.file_type().is_symlink() => read_only = true,
                Ok(entry) if entry.file_type().is_file() => file_count += 1,
                Err(error) => {
                    read_only = true;
                    warnings.push(format!("资源文件无法完整读取：{error}"));
                }
                _ => {}
            }
            if file_count > 5000 {
                read_only = true;
                warnings.push("资源包含超过 5,000 个文件，当前版本仅可查看。".into());
                break;
            }
        }
    }
    if read_only {
        warnings.push(if managed {
            "此技能由账号同步管理，本地修改可能被覆盖。当前版本仅可查看。".into()
        } else if environment.read_only {
            "此目录的加载兼容性尚未验证，当前版本仅可查看。".into()
        } else {
            "此资源含符号链接或无法完整读取，当前版本仅可查看。".into()
        });
    }
    if environment.tool == Tool::Codex && main_file == "AGENTS.md" {
        let override_file = path.with_file_name("AGENTS.override.md");
        if read_text(&override_file).is_ok_and(|text| !text.trim().is_empty()) {
            warnings.push(
                "同层存在非空 AGENTS.override.md；Codex 会优先加载它，当前 AGENTS.md 可能未生效。"
                    .into(),
            );
        }
    }
    let compatibility = match environment.tool {
        Tool::Claude => Compatibility::Claude,
        Tool::Codex => Compatibility::Codex,
    };
    warnings.extend(compatibility_warnings(&content, false));
    let id = local_id(environment, path);
    Ok((
        Resource {
            id: id.clone(),
            origin: Origin::Local,
            kind: kind.clone(),
            name,
            description,
            compatibility,
            environment_id: Some(environment.id.clone()),
            tool: Some(environment.tool.clone()),
            scope: environment.scope.clone(),
            path: display(path),
            main_file: main_file.clone(),
            source: if managed {
                "账号同步".into()
            } else {
                "本地配置".into()
            },
            updated_at: modified_at(&content_path),
            revision: 0,
            file_count,
            read_only,
            warnings,
        },
        Location {
            id,
            origin: Origin::Local,
            kind,
            path: path.to_owned(),
            main_file,
            is_directory: directory,
            environment_id: Some(environment.id.clone()),
            asset: None,
        },
    ))
}

pub(crate) fn validate_local_location(
    location: &Location,
    environment: &Environment,
) -> Result<()> {
    if environment.read_only {
        return Err(AppError::new("readOnly", "旧版目录只允许查看。"));
    }
    let allowed = if location.kind == Kind::Skill {
        location.path.parent() == Some(Path::new(&environment.skills_root))
            && location.path.file_name().is_some_and(|name| {
                name != "synced"
                    && name != "anthropic-skills"
                    && !name.to_string_lossy().starts_with('.')
            })
    } else {
        environment
            .instruction_files
            .iter()
            .any(|path| Path::new(path) == location.path)
            || environment.rules_root.as_ref().is_some_and(|root| {
                location.path.starts_with(root)
                    && location.path != Path::new(root)
                    && location.path.extension().is_some_and(|ext| ext == "md")
            })
    };
    if !allowed {
        return Err(AppError::new(
            "path",
            "此文件不在已登记环境的技能或行为规则范围内。",
        ));
    }
    crate::files::ensure_writable_path(&location.path)
}
