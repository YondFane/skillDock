use skilldock_core::{Compatibility, CreateInput, EditInput, Kind, Origin, Settings, Store};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;

struct Fixture {
    temp: TempDir,
    data: PathBuf,
    home: PathBuf,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let data = root.join("data");
        let home = root.join("home");
        let mut store = Store::open(&data, &home).unwrap();
        store
            .save_settings(Settings {
                claude_root: home.join(".claude").to_string_lossy().into(),
                codex_root: home.join(".codex").to_string_lossy().into(),
                codex_skills_root: home.join(".agents/skills").to_string_lossy().into(),
            })
            .unwrap();
        Self {
            temp,
            data,
            home,
            store,
        }
    }
    fn rule(&mut self, name: &str, content: &str) -> String {
        let preview = self
            .store
            .preview_create(CreateInput {
                target: "library".into(),
                kind: Kind::Rule,
                name: name.into(),
                compatibility: Compatibility::Both,
                content: content.into(),
            })
            .unwrap();
        self.store.apply(&preview.id).unwrap().resource_id.unwrap()
    }
    fn skill(&mut self, name: &str) -> String {
        let preview = self
            .store
            .preview_create(CreateInput {
                target: "library".into(),
                kind: Kind::Skill,
                name: name.into(),
                compatibility: Compatibility::Both,
                content: skill(name),
            })
            .unwrap();
        self.store.apply(&preview.id).unwrap().resource_id.unwrap()
    }
    fn source(&self, name: &str) -> PathBuf {
        let path = self.temp.path().canonicalize().unwrap().join(name);
        fs::create_dir(&path).unwrap();
        fs::write(path.join("SKILL.md"), skill(name)).unwrap();
        path
    }
}
fn skill(name: &str) -> String {
    format!("---\nname: {name}\ndescription: 审查代码时使用\nallowed-tools: Read Grep\n---\n\n# 代码审查\n\n- 阅读代码并定位问题\n")
}
fn edit(detail: &skilldock_core::ResourceDetail, content: &str) -> EditInput {
    EditInput {
        id: detail.resource.id.clone(),
        name: detail.resource.name.clone(),
        compatibility: detail.resource.compatibility.clone(),
        relative_path: detail.relative_path.clone(),
        content: content.into(),
        expected_fingerprint: detail.fingerprint.clone(),
    }
}

#[test]
fn library_skill_and_rule_survive_restart() {
    let mut fixture = Fixture::new();
    let skill_id = fixture.skill("code-review");
    let rule_id = fixture.rule("编码约定", "# 工作约定\n\n- 运行相关测试\n");
    drop(fixture.store);
    let mut reopened = Store::open(&fixture.data, &fixture.home).unwrap();
    let overview = reopened.overview().unwrap();
    assert_eq!(
        overview
            .resources
            .iter()
            .filter(|r| r.origin == Origin::Library)
            .count(),
        2
    );
    assert_eq!(
        reopened.resource_detail(&skill_id, None).unwrap().content,
        skill("code-review")
    );
    assert!(reopened
        .resource_detail(&rule_id, None)
        .unwrap()
        .content
        .contains("运行相关测试"));
}

#[test]
fn previews_are_non_mutating_and_can_only_be_applied_once() {
    let mut fixture = Fixture::new();
    let preview = fixture
        .store
        .preview_create(CreateInput {
            target: "library".into(),
            kind: Kind::Skill,
            name: "first".into(),
            compatibility: Compatibility::Both,
            content: skill("first"),
        })
        .unwrap();
    assert!(!Path::new(&preview.target_path).exists());
    assert!(fixture.store.history().unwrap().is_empty());
    assert!(fixture.store.overview().unwrap().resources.is_empty());
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fixture.store.apply(&preview.id).unwrap_err().code,
        "expired"
    );
}

#[test]
fn edit_updates_metadata_and_preserves_unknown_frontmatter() {
    let mut fixture = Fixture::new();
    let id = fixture.skill("review");
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let content = skill("review-new");
    let preview = fixture.store.preview_edit(edit(&detail, &content)).unwrap();
    assert_eq!(
        fs::read_to_string(Path::new(&detail.resource.path).join("SKILL.md")).unwrap(),
        detail.content
    );
    fixture.store.apply(&preview.id).unwrap();
    let updated = fixture.store.resource_detail(&id, None).unwrap();
    assert_eq!(updated.resource.name, "review-new");
    assert_eq!(updated.resource.revision, 2);
    assert!(updated.content.contains("allowed-tools: Read Grep"));
    assert_eq!(updated.content, content);
}

#[test]
fn rule_name_and_compatibility_are_persistent_metadata() {
    let mut fixture = Fixture::new();
    let id = fixture.rule("规则", "# 原规则");
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let mut input = edit(&detail, "# 新规则");
    input.name = "团队编码规则".into();
    input.compatibility = Compatibility::Claude;
    let preview = fixture.store.preview_edit(input).unwrap();
    fixture.store.apply(&preview.id).unwrap();
    let updated = fixture.store.resource_detail(&id, None).unwrap();
    assert_eq!(updated.resource.name, "团队编码规则");
    assert_eq!(updated.resource.compatibility, Compatibility::Claude);
    assert_eq!(updated.content, "# 新规则");
}

#[test]
fn complete_skill_import_delete_and_restore_preserves_assets() {
    let mut fixture = Fixture::new();
    let source = fixture.source("bundle");
    fs::create_dir(source.join("scripts")).unwrap();
    fs::create_dir(source.join("references")).unwrap();
    fs::create_dir(source.join("empty")).unwrap();
    fs::write(
        source.join("scripts/check.sh"),
        "#!/bin/sh\ntouch should-never-exist\n",
    )
    .unwrap();
    fs::write(source.join("references/说明.md"), "# 参考资料\n你好").unwrap();
    fs::write(source.join("asset.bin"), [0, 255, 10, 33]).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            source.join("scripts/check.sh"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }
    let preview = fixture
        .store
        .preview_import(source.to_str().unwrap(), Compatibility::Both)
        .unwrap();
    assert_eq!(preview.total_files, 4);
    let id = fixture
        .store
        .apply(&preview.id)
        .unwrap()
        .resource_id
        .unwrap();
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let installed = PathBuf::from(&detail.resource.path);
    assert_eq!(detail.files.len(), 4);
    assert!(
        !detail
            .files
            .iter()
            .find(|f| f.path == "asset.bin")
            .unwrap()
            .editable
    );
    assert!(installed.join("empty").is_dir());
    assert!(source.join("SKILL.md").is_file());
    assert!(!source.join("should-never-exist").exists());
    let deletion = fixture
        .store
        .preview_delete(&id, &detail.fingerprint)
        .unwrap();
    let deletion_op = fixture.store.apply(&deletion.id).unwrap().operation_id;
    assert!(!installed.exists());
    assert!(!fixture
        .store
        .overview()
        .unwrap()
        .resources
        .iter()
        .any(|r| r.id == id));
    let restore = fixture.store.preview_restore(&deletion_op).unwrap();
    fixture.store.apply(&restore.id).unwrap();
    assert_eq!(
        fs::read(installed.join("asset.bin")).unwrap(),
        [0, 255, 10, 33]
    );
    assert_eq!(
        fs::read(installed.join("references/说明.md")).unwrap(),
        fs::read(source.join("references/说明.md")).unwrap()
    );
    assert!(installed.join("empty").is_dir());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_ne!(
            fs::metadata(installed.join("scripts/check.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );
    }
}

#[test]
fn supporting_text_files_can_be_edited_and_main_manifest_is_unchanged() {
    let mut fixture = Fixture::new();
    let source = fixture.source("support");
    fs::create_dir(source.join("references")).unwrap();
    fs::write(source.join("references/guide.md"), "# Before").unwrap();
    let preview = fixture
        .store
        .preview_import(source.to_str().unwrap(), Compatibility::Both)
        .unwrap();
    let id = fixture
        .store
        .apply(&preview.id)
        .unwrap()
        .resource_id
        .unwrap();
    let detail = fixture
        .store
        .resource_detail(&id, Some("references/guide.md"))
        .unwrap();
    let preview = fixture
        .store
        .preview_edit(edit(&detail, "# After"))
        .unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fixture
            .store
            .resource_detail(&id, Some("references/guide.md"))
            .unwrap()
            .content,
        "# After"
    );
    assert_eq!(
        fixture.store.resource_detail(&id, None).unwrap().content,
        skill("support")
    );
}

#[test]
fn external_edits_in_main_or_supporting_file_stop_stale_save_and_delete() {
    let mut fixture = Fixture::new();
    let source = fixture.source("concurrent");
    fs::write(source.join("other.md"), "original").unwrap();
    let preview = fixture
        .store
        .preview_import(source.to_str().unwrap(), Compatibility::Both)
        .unwrap();
    let id = fixture
        .store
        .apply(&preview.id)
        .unwrap()
        .resource_id
        .unwrap();
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let path = PathBuf::from(&detail.resource.path);
    fs::write(path.join("other.md"), "external change").unwrap();
    assert_eq!(
        fixture
            .store
            .preview_edit(edit(&detail, &skill("concurrent")))
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(
        fixture
            .store
            .preview_delete(&id, &detail.fingerprint)
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(
        fs::read_to_string(path.join("other.md")).unwrap(),
        "external change"
    );
}

#[test]
fn changes_between_review_and_apply_do_not_overwrite_other_programs() {
    let mut fixture = Fixture::new();
    let id = fixture.rule("冲突规则", "before");
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let preview = fixture
        .store
        .preview_edit(edit(&detail, "my edit"))
        .unwrap();
    fs::write(Path::new(&detail.resource.path).join("rule.md"), "external").unwrap();
    assert_eq!(
        fixture.store.apply(&preview.id).unwrap_err().code,
        "conflict"
    );
    assert_eq!(
        fs::read_to_string(Path::new(&detail.resource.path).join("rule.md")).unwrap(),
        "external"
    );
}

#[test]
fn metadata_only_change_invalidates_an_old_fingerprint() {
    let mut fixture = Fixture::new();
    let id = fixture.rule("元数据", "same content");
    let original = fixture.store.resource_detail(&id, None).unwrap();
    let mut input = edit(&original, &original.content);
    input.compatibility = Compatibility::Codex;
    let preview = fixture.store.preview_edit(input).unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fixture
            .store
            .preview_edit(edit(&original, "other"))
            .unwrap_err()
            .code,
        "conflict"
    );
}

#[test]
fn unsafe_names_and_invalid_yaml_are_rejected_without_writes() {
    let mut fixture = Fixture::new();
    for name in ["../outside", "CON", "bad:name", "LPT1.txt", "ending."] {
        let error = fixture
            .store
            .preview_create(CreateInput {
                target: "library".into(),
                kind: Kind::Rule,
                name: name.into(),
                compatibility: Compatibility::Both,
                content: "rule".into(),
            })
            .unwrap_err();
        assert_eq!(error.code, "validation");
    }
    for content in [
        "# No header",
        "---\nname: Foo\n---\n",
        "---\nname: good\ndescription: [\n---\n",
        "---\nname: synced\ndescription: use me\n---\n",
    ] {
        assert_eq!(
            fixture
                .store
                .preview_create(CreateInput {
                    target: "library".into(),
                    kind: Kind::Skill,
                    name: "ignored".into(),
                    compatibility: Compatibility::Both,
                    content: content.into()
                })
                .unwrap_err()
                .code,
            "validation"
        );
    }
    assert!(fixture.store.overview().unwrap().resources.is_empty());
}

#[test]
fn unknown_ids_and_relative_path_escape_cannot_read_or_write_arbitrary_files() {
    let mut fixture = Fixture::new();
    let id = fixture.skill("safe");
    assert_eq!(
        fixture
            .store
            .resource_detail("local:/etc/passwd", None)
            .unwrap_err()
            .code,
        "notFound"
    );
    assert_eq!(
        fixture
            .store
            .resource_detail(&id, Some("../../other"))
            .unwrap_err()
            .code,
        "path"
    );
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let mut input = edit(&detail, "oops");
    input.relative_path = "../outside.md".into();
    assert_eq!(fixture.store.preview_edit(input).unwrap_err().code, "path");
    assert_eq!(
        fixture.store.resource_detail(&id, None).unwrap().content,
        skill("safe")
    );
}

#[test]
fn global_claude_skill_has_real_disk_crud_and_restore() {
    let mut fixture = Fixture::new();
    let preview = fixture
        .store
        .preview_create(CreateInput {
            target: "claude:global".into(),
            kind: Kind::Skill,
            name: "native".into(),
            compatibility: Compatibility::Claude,
            content: skill("native"),
        })
        .unwrap();
    assert_eq!(
        PathBuf::from(&preview.target_path),
        fixture.home.join(".claude/skills/native")
    );
    let id = fixture
        .store
        .apply(&preview.id)
        .unwrap()
        .resource_id
        .unwrap();
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    assert_eq!(detail.resource.origin, Origin::Local);
    let content = skill("native") + "\n- 运行测试";
    let preview = fixture.store.preview_edit(edit(&detail, &content)).unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fs::read_to_string(fixture.home.join(".claude/skills/native/SKILL.md")).unwrap(),
        content
    );
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let preview = fixture
        .store
        .preview_delete(&id, &detail.fingerprint)
        .unwrap();
    let op = fixture.store.apply(&preview.id).unwrap().operation_id;
    assert!(!fixture.home.join(".claude/skills/native").exists());
    let preview = fixture.store.preview_restore(&op).unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fs::read_to_string(fixture.home.join(".claude/skills/native/SKILL.md")).unwrap(),
        content
    );
}

#[test]
fn projects_scan_both_tools_and_unregister_preserves_files() {
    let mut fixture = Fixture::new();
    let project = fixture
        .temp
        .path()
        .canonicalize()
        .unwrap()
        .join("中文 project");
    fs::create_dir(&project).unwrap();
    let overview = fixture
        .store
        .add_project(project.to_str().unwrap())
        .unwrap();
    let project_id = overview.projects[0].id.clone();
    for (tool, kind, name, content) in [
        ("claude", Kind::Rule, "规范", "# 中文规则"),
        ("codex", Kind::Skill, "project-skill", ""),
    ] {
        let preview = fixture
            .store
            .preview_create(CreateInput {
                target: format!("{tool}:project:{project_id}"),
                kind: kind.clone(),
                name: name.into(),
                compatibility: Compatibility::Both,
                content: if kind == Kind::Skill {
                    skill(name)
                } else {
                    content.into()
                },
            })
            .unwrap();
        fixture.store.apply(&preview.id).unwrap();
    }
    assert!(project.join(".claude/rules/规范.md").is_file());
    assert!(project
        .join(".agents/skills/project-skill/SKILL.md")
        .is_file());
    assert_eq!(
        fixture
            .store
            .overview()
            .unwrap()
            .resources
            .iter()
            .filter(|r| r.scope == "project")
            .count(),
        2
    );
    fixture.store.remove_project(&project_id).unwrap();
    assert!(project.join(".claude/rules/规范.md").is_file());
    assert!(fixture
        .store
        .overview()
        .unwrap()
        .resources
        .iter()
        .all(|r| r.scope != "project"));
}

#[test]
fn codex_override_is_visible_and_new_rules_never_clobber_it() {
    let mut fixture = Fixture::new();
    let root = fixture.home.join(".codex");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("AGENTS.md"), "# Base").unwrap();
    fs::write(root.join("AGENTS.override.md"), "# Override").unwrap();
    let overview = fixture.store.overview().unwrap();
    let base = overview
        .resources
        .iter()
        .find(|r| r.main_file == "AGENTS.md")
        .unwrap();
    assert!(base
        .warnings
        .iter()
        .any(|w| w.contains("AGENTS.override.md")));
    let error = fixture
        .store
        .preview_create(CreateInput {
            target: "codex:global".into(),
            kind: Kind::Rule,
            name: "instructions".into(),
            compatibility: Compatibility::Codex,
            content: "# New".into(),
        })
        .unwrap_err();
    assert_eq!(error.code, "exists");
    assert_eq!(
        fs::read_to_string(root.join("AGENTS.override.md")).unwrap(),
        "# Override"
    );
    let id = base.id.clone();
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let raw = "# Base\n\n@docs/external.md\n\n- 保留原生语法\n";
    let preview = fixture.store.preview_edit(edit(&detail, raw)).unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(fs::read_to_string(root.join("AGENTS.md")).unwrap(), raw);
}

#[test]
fn native_claude_rules_preserve_paths_frontmatter_and_imports() {
    let mut fixture = Fixture::new();
    let content = "---\npaths:\n  - \"src/**/*.ts\"\n---\n\n@docs/style.md\n";
    let preview = fixture
        .store
        .preview_create(CreateInput {
            target: "claude:global".into(),
            kind: Kind::Rule,
            name: "frontend".into(),
            compatibility: Compatibility::Claude,
            content: content.into(),
        })
        .unwrap();
    let id = fixture
        .store
        .apply(&preview.id)
        .unwrap()
        .resource_id
        .unwrap();
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let changed = content.to_owned() + "- 使用项目约定\n";
    let preview = fixture.store.preview_edit(edit(&detail, &changed)).unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fs::read_to_string(fixture.home.join(".claude/rules/frontend.md")).unwrap(),
        changed
    );
}

#[test]
fn legacy_and_account_synced_skills_are_read_only() {
    let mut fixture = Fixture::new();
    let legacy = fixture.home.join(".codex/skills/old");
    fs::create_dir_all(&legacy).unwrap();
    fs::write(legacy.join("SKILL.md"), skill("old")).unwrap();
    let synced = fixture.home.join(".claude/skills/synced/remote");
    fs::create_dir_all(&synced).unwrap();
    fs::write(synced.join("SKILL.md"), skill("remote")).unwrap();
    let overview = fixture.store.overview().unwrap();
    for resource in overview
        .resources
        .iter()
        .filter(|r| r.name == "old" || r.name == "remote")
    {
        assert!(resource.read_only);
        let detail = fixture.store.resource_detail(&resource.id, None).unwrap();
        assert_eq!(
            fixture
                .store
                .preview_delete(&resource.id, &detail.fingerprint)
                .unwrap_err()
                .code,
            "readOnly"
        );
    }
}

#[test]
fn cross_platform_case_collision_does_not_create_a_second_file() {
    let mut fixture = Fixture::new();
    let rules = fixture.home.join(".claude/rules");
    fs::create_dir_all(&rules).unwrap();
    fs::write(rules.join("TEST.md"), "# Existing").unwrap();
    let error = fixture
        .store
        .preview_create(CreateInput {
            target: "claude:global".into(),
            kind: Kind::Rule,
            name: "test".into(),
            compatibility: Compatibility::Claude,
            content: "# New".into(),
        })
        .unwrap_err();
    assert_eq!(error.code, "exists");
    assert_eq!(
        fs::read_to_string(rules.join("TEST.md")).unwrap(),
        "# Existing"
    );
}

#[cfg(unix)]
#[test]
fn symlinks_are_read_only_and_import_never_follows_them() {
    use std::os::unix::fs::symlink;
    let mut fixture = Fixture::new();
    let source = fixture.source("linked");
    let skills = fixture.home.join(".claude/skills");
    fs::create_dir_all(&skills).unwrap();
    symlink(&source, skills.join("linked")).unwrap();
    let overview = fixture.store.overview().unwrap();
    let resource = overview
        .resources
        .iter()
        .find(|r| r.name == "linked")
        .unwrap();
    assert!(resource.read_only);
    let detail = fixture.store.resource_detail(&resource.id, None).unwrap();
    assert_eq!(
        fixture
            .store
            .preview_delete(&resource.id, &detail.fingerprint)
            .unwrap_err()
            .code,
        "readOnly"
    );
    assert_eq!(
        fixture
            .store
            .preview_import(skills.join("linked").to_str().unwrap(), Compatibility::Both)
            .unwrap_err()
            .code,
        "readOnly"
    );
    assert!(source.join("SKILL.md").exists());
}

#[test]
fn custom_roots_are_persistent_and_internal_data_roots_are_rejected() {
    let mut fixture = Fixture::new();
    let root = fixture.temp.path().canonicalize().unwrap().join("custom");
    let settings = Settings {
        claude_root: root.join("claude").to_string_lossy().into(),
        codex_root: root.join("codex").to_string_lossy().into(),
        codex_skills_root: root.join("skills").to_string_lossy().into(),
    };
    fixture.store.save_settings(settings.clone()).unwrap();
    let preview = fixture
        .store
        .preview_create(CreateInput {
            target: "codex:global".into(),
            kind: Kind::Skill,
            name: "custom-skill".into(),
            compatibility: Compatibility::Codex,
            content: skill("custom-skill"),
        })
        .unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert!(root.join("skills/custom-skill/SKILL.md").is_file());
    let mut invalid = settings.clone();
    invalid.claude_root = fixture.data.to_string_lossy().into();
    assert_eq!(
        fixture.store.save_settings(invalid).unwrap_err().code,
        "path"
    );
    drop(fixture.store);
    let reopened = Store::open(&fixture.data, &fixture.home).unwrap();
    assert_eq!(
        reopened.settings().unwrap().codex_skills_root,
        settings.codex_skills_root
    );
}

#[test]
fn restore_rejects_a_tampered_backup() {
    let mut fixture = Fixture::new();
    let id = fixture.rule("备份", "# Original");
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let preview = fixture
        .store
        .preview_edit(edit(&detail, "# Updated"))
        .unwrap();
    let op = fixture.store.apply(&preview.id).unwrap().operation_id;
    fs::write(
        fixture
            .data
            .join("backups")
            .join(&op)
            .join("before/rule.md"),
        "# Tampered",
    )
    .unwrap();
    assert_eq!(fixture.store.preview_restore(&op).unwrap_err().code, "data");
    assert_eq!(
        fixture.store.resource_detail(&id, None).unwrap().content,
        "# Updated"
    );
}

#[test]
fn import_refuses_oversized_bundles_before_reading_their_payload() {
    let mut fixture = Fixture::new();
    let source = fixture.source("oversize");
    let file = fs::File::create(source.join("large.bin")).unwrap();
    file.set_len(201 * 1024 * 1024).unwrap();
    assert_eq!(
        fixture
            .store
            .preview_import(source.to_str().unwrap(), Compatibility::Both)
            .unwrap_err()
            .code,
        "limit"
    );
    assert!(fixture.store.overview().unwrap().resources.is_empty());
}

#[test]
fn restart_recovers_a_crash_after_swap_but_before_database_commit() {
    let mut fixture = Fixture::new();
    let id = fixture.rule("恢复测试", "# Before");
    let detail = fixture.store.resource_detail(&id, None).unwrap();
    let preview = fixture
        .store
        .preview_edit(edit(&detail, "# After"))
        .unwrap();
    let op = fixture.store.apply(&preview.id).unwrap().operation_id;
    drop(fixture.store);
    let connection = rusqlite::Connection::open(fixture.data.join("skilldock.sqlite3")).unwrap();
    let data: String = connection
        .query_row("SELECT data FROM operations WHERE id=?1", [&op], |r| {
            r.get(0)
        })
        .unwrap();
    let mut journal: serde_json::Value = serde_json::from_str(&data).unwrap();
    let old_path = PathBuf::from(journal["old_path"].as_str().unwrap());
    fs::create_dir(&old_path).unwrap();
    fs::copy(
        fixture
            .data
            .join("backups")
            .join(&op)
            .join("before/rule.md"),
        old_path.join("rule.md"),
    )
    .unwrap();
    journal["operation"]["status"] = "pending".into();
    journal["operation"]["canRestore"] = false.into();
    let asset_before = &journal["asset_before"];
    connection
        .execute(
            "UPDATE assets SET data=?1 WHERE id=?2",
            rusqlite::params![
                serde_json::to_string(asset_before).unwrap(),
                asset_before["id"].as_str().unwrap()
            ],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE operations SET data=?1 WHERE id=?2",
            rusqlite::params![serde_json::to_string(&journal).unwrap(), op],
        )
        .unwrap();
    drop(connection);
    let mut reopened = Store::open(&fixture.data, &fixture.home).unwrap();
    assert_eq!(
        reopened.resource_detail(&id, None).unwrap().content,
        "# Before"
    );
    assert!(!old_path.exists());
    assert_eq!(
        reopened
            .history()
            .unwrap()
            .iter()
            .find(|record| record.id == op)
            .unwrap()
            .status,
        "interrupted"
    );
}

#[test]
fn ipc_dtos_use_camel_case_and_structured_error_codes() {
    let input: CreateInput = serde_json::from_value(serde_json::json!({
        "target":"library", "kind":"skill", "name":"wire-test", "compatibility":"both", "content":skill("wire-test")
    })).unwrap();
    let mut fixture = Fixture::new();
    let preview = fixture.store.preview_create(input).unwrap();
    let serialized = serde_json::to_value(&preview).unwrap();
    assert!(serialized.get("targetPath").is_some());
    assert!(serialized.get("beforeContent").is_some());
    assert!(serialized.get("changedFiles").is_some());
    let error = fixture.store.resource_detail("unknown", None).unwrap_err();
    assert_eq!(serde_json::to_value(error).unwrap()["code"], "notFound");
}

#[test]
fn single_file_native_rules_can_restore_edits_and_deletes_for_both_tools() {
    let mut fixture = Fixture::new();
    for target in ["claude:global", "codex:global"] {
        let preview = fixture
            .store
            .preview_create(CreateInput {
                target: target.into(),
                kind: Kind::Rule,
                name: "restore-file".into(),
                compatibility: Compatibility::Both,
                content: "# 原始规则\n\n- 运行测试".into(),
            })
            .unwrap();
        let id = fixture
            .store
            .apply(&preview.id)
            .unwrap()
            .resource_id
            .unwrap();
        let original = fixture.store.resource_detail(&id, None).unwrap();
        let preview = fixture
            .store
            .preview_edit(edit(&original, "# 修改后的规则"))
            .unwrap();
        let operation = fixture.store.apply(&preview.id).unwrap().operation_id;
        let preview = fixture.store.preview_restore(&operation).unwrap();
        assert!(!preview.removes_resource);
        fixture.store.apply(&preview.id).unwrap();
        let restored = fixture.store.resource_detail(&id, None).unwrap();
        assert_eq!(restored.content, original.content);
        let preview = fixture
            .store
            .preview_delete(&id, &restored.fingerprint)
            .unwrap();
        assert!(preview.removes_resource);
        let deletion = fixture.store.apply(&preview.id).unwrap();
        assert!(deletion.message.contains("已删除"));
        assert!(!Path::new(&original.resource.path).exists());
        let preview = fixture
            .store
            .preview_restore(&deletion.operation_id)
            .unwrap();
        fixture.store.apply(&preview.id).unwrap();
        assert_eq!(
            fs::read_to_string(&original.resource.path).unwrap(),
            original.content
        );
    }
}

#[test]
fn restoring_an_empty_rule_keeps_the_resource_instead_of_deleting_it() {
    let mut fixture = Fixture::new();
    let preview = fixture
        .store
        .preview_create(CreateInput {
            target: "claude:global".into(),
            kind: Kind::Rule,
            name: "empty-rule".into(),
            compatibility: Compatibility::Claude,
            content: String::new(),
        })
        .unwrap();
    let id = fixture
        .store
        .apply(&preview.id)
        .unwrap()
        .resource_id
        .unwrap();
    let original = fixture.store.resource_detail(&id, None).unwrap();
    let preview = fixture
        .store
        .preview_edit(edit(&original, "# 有内容的规则"))
        .unwrap();
    let operation = fixture.store.apply(&preview.id).unwrap().operation_id;
    let preview = fixture.store.preview_restore(&operation).unwrap();
    assert_eq!(preview.after_content, "");
    assert!(!preview.removes_resource);
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fixture.store.resource_detail(&id, None).unwrap().content,
        ""
    );
    assert!(Path::new(&original.resource.path).exists());
}

#[cfg(unix)]
#[test]
fn imports_edits_and_restores_preserve_private_file_and_directory_modes() {
    use std::os::unix::fs::PermissionsExt;
    let mut fixture = Fixture::new();
    let source = fixture.source("private");
    fs::create_dir(source.join("references")).unwrap();
    fs::write(source.join("references/private.md"), "# private").unwrap();
    fs::set_permissions(&source, fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(source.join("references"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::set_permissions(
        source.join("references/private.md"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let preview = fixture
        .store
        .preview_import(source.to_str().unwrap(), Compatibility::Both)
        .unwrap();
    let id = fixture
        .store
        .apply(&preview.id)
        .unwrap()
        .resource_id
        .unwrap();
    let detail = fixture
        .store
        .resource_detail(&id, Some("references/private.md"))
        .unwrap();
    let root = PathBuf::from(&detail.resource.path);
    let preview = fixture
        .store
        .preview_edit(edit(&detail, "# changed"))
        .unwrap();
    let operation = fixture.store.apply(&preview.id).unwrap().operation_id;
    let preview = fixture.store.preview_restore(&operation).unwrap();
    fixture.store.apply(&preview.id).unwrap();
    assert_eq!(
        fs::metadata(&root).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(root.join("references"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(root.join("references/private.md"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}
