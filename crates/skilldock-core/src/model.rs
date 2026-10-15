use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Skill,
    Rule,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Tool {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Compatibility {
    Both,
    Claude,
    Codex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    Library,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub claude_root: String,
    pub codex_root: String,
    pub codex_skills_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
}

pub const DEFAULT_WORKSPACE_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub project_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectImportFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectsResult {
    pub overview: Overview,
    pub added_project_ids: Vec<String>,
    pub already_present: usize,
    pub failures: Vec<ProjectImportFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub tool: Tool,
    pub scope: String,
    pub project_id: Option<String>,
    pub root: String,
    pub skills_root: String,
    pub rules_root: Option<String>,
    pub instruction_files: Vec<String>,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub origin: Origin,
    pub kind: Kind,
    pub name: String,
    pub description: String,
    pub compatibility: Compatibility,
    pub environment_id: Option<String>,
    pub tool: Option<Tool>,
    pub scope: String,
    pub path: String,
    pub main_file: String,
    pub source: String,
    pub updated_at: u64,
    pub revision: u64,
    pub file_count: usize,
    pub read_only: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFile {
    pub path: String,
    pub size: u64,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDetail {
    pub resource: Resource,
    pub content: String,
    pub relative_path: String,
    pub fingerprint: String,
    pub files: Vec<ResourceFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub resources: Vec<Resource>,
    pub environments: Vec<Environment>,
    pub projects: Vec<Project>,
    pub workspaces: Vec<Workspace>,
    pub settings: Settings,
    pub data_dir: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInput {
    pub target: String,
    pub kind: Kind,
    pub name: String,
    pub compatibility: Compatibility,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditInput {
    pub id: String,
    pub name: String,
    pub compatibility: Compatibility,
    pub relative_path: String,
    pub content: String,
    pub expected_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdit {
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditFilesInput {
    pub id: String,
    pub name: String,
    pub compatibility: Compatibility,
    pub files: Vec<FileEdit>,
    pub expected_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreview {
    pub id: String,
    pub action: String,
    pub name: String,
    pub target_path: String,
    pub before_content: String,
    pub after_content: String,
    pub changed_files: Vec<String>,
    pub total_files: usize,
    pub removes_resource: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub action: String,
    pub name: String,
    pub origin: Origin,
    pub target_path: String,
    pub status: String,
    pub created_at: u64,
    pub can_restore: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub resource_id: Option<String>,
    pub operation_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Asset {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    pub description: String,
    pub compatibility: Compatibility,
    pub source: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub revision: u64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Location {
    pub id: String,
    pub origin: Origin,
    pub kind: Kind,
    pub path: PathBuf,
    pub main_file: String,
    pub is_directory: bool,
    pub environment_id: Option<String>,
    pub asset: Option<Asset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Journal {
    pub operation: Operation,
    pub location: Location,
    pub asset_before: Option<Asset>,
    pub asset_after: Option<Asset>,
    pub before_fingerprint: String,
    pub after_fingerprint: String,
    pub backup_path: PathBuf,
    pub stage_path: PathBuf,
    pub old_path: PathBuf,
}
