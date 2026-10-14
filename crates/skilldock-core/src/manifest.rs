use crate::{AppError, Result};
use serde_yaml_ng::Value;

pub const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

pub fn skill_metadata(content: &str) -> Result<(String, String)> {
    validate_text(content)?;
    let normalized = content
        .strip_prefix('\u{feff}')
        .unwrap_or(content)
        .replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return Err(AppError::new(
            "validation",
            "技能需要以 YAML frontmatter（---）开头，并包含 name 和 description。",
        ));
    }
    let mut header = String::new();
    let mut closed = false;
    for line in lines {
        if line == "---" {
            closed = true;
            break;
        }
        header.push_str(line);
        header.push('\n');
    }
    if !closed {
        return Err(AppError::new(
            "validation",
            "技能 YAML frontmatter 缺少结束的 ---。",
        ));
    }
    let parsed: Value = serde_yaml_ng::from_str(&header)
        .map_err(|e| AppError::new("validation", format!("技能 YAML 格式错误：{e}")))?;
    let name = parsed
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let description = parsed
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let valid_name = !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--");
    if !valid_name {
        return Err(AppError::new(
            "validation",
            "技能 name 须为 1–64 个小写字母、数字或单个连字符，不能以连字符开头或结尾。",
        ));
    }
    if description.trim().is_empty() || description.chars().count() > 1024 {
        return Err(AppError::new(
            "validation",
            "技能 description 必须为非空文本，最长 1024 个字符。",
        ));
    }
    if name == "synced" || name == "anthropic-skills" {
        return Err(AppError::new(
            "validation",
            "此名称由 Claude 的账号同步功能保留，请使用其他技能名称。",
        ));
    }
    validate_filename(&name)?;
    Ok((name, description))
}

pub(crate) fn validate_text(content: &str) -> Result<()> {
    if content.len() > MAX_TEXT_BYTES {
        return Err(AppError::new("limit", "编辑文件不能超过 2 MB。"));
    }
    if content.contains('\0') {
        return Err(AppError::new("validation", "文本内容不能包含空字符。"));
    }
    Ok(())
}

pub(crate) fn validate_filename(name: &str) -> Result<()> {
    let reserved = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let device = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&reserved.as_str());
    if name.is_empty()
        || name.trim() != name
        || name.encode_utf16().count() > 120
        || name.ends_with('.')
        || name == "."
        || name == ".."
        || device
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err(AppError::new(
            "validation",
            "名称含有跨平台文件名不允许的字符、保留名称，或超过 120 个字符。",
        ));
    }
    Ok(())
}

pub(crate) fn rule_description(content: &str) -> String {
    content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .trim_start_matches('#')
        .trim()
        .chars()
        .take(160)
        .collect()
}

pub(crate) fn compatibility_warnings(content: &str, both: bool) -> Vec<String> {
    let mut warnings = Vec::new();
    if both
        && [
            "allowed-tools:",
            "disable-model-invocation:",
            "context:",
            "$ARGUMENTS",
            "${CLAUDE_",
            "when_to_use:",
            "paths:",
        ]
        .iter()
        .any(|token| content.contains(token))
    {
        warnings.push("内容含 Claude 专有字段或变量。标记为通用不会转换这些能力；应用前需要确认另一工具的兼容性。".into());
    }
    warnings
}
