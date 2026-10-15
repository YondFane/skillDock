use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_resource_id: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            existing_resource_id: None,
        }
    }
    pub(crate) fn conflict() -> Self {
        Self::new(
            "conflict",
            "文件已被其他程序修改。请重新读取并核对内容后再保存。",
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for AppError {}
impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::new("io", format!("文件操作失败：{value}"))
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::new("database", format!("本地数据库操作失败：{value}"))
    }
}
impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("data", format!("本地记录解析失败：{value}"))
    }
}
pub type Result<T> = std::result::Result<T, AppError>;
