# 资源查看布局调整（v0.1.7）

## 目的与行为

查看技能或规则时，为右侧正文提供更多空间。列表和内容区按 3:7 分配可用宽度，移除原有内容区 610px 最大宽度限制；关闭内容区后列表恢复全宽。窄窗口仍保留编辑器最小宽度，因此实际占比可能随最小宽度约束调整。

隐藏界面所有滚动条，兼容 macOS WebKit 与 Windows WebView2；保持原有 overflow 和滚动交互，鼠标、触控板及键盘仍可滚动。修改仅涉及 `src/styles.css`，不改变资源读写或持久化行为。

## 验证

本机发布前检查已通过：

- `npm test`：19 项通过，包含 3 项更新清单测试。
- `npm run build`：TypeScript 与 Vite 生产构建通过，存在现有的大体积 JS 分包提示。
- `cargo fmt --all --check`：通过。
- `cargo test -p skilldock-core --locked --offline`：26 项核心集成测试通过。
- `cargo clippy --workspace --all-targets --locked -- -D warnings`：通过。
- `node scripts/release-version.mjs`：v0.1.7 的前端、Tauri、Rust 与锁文件版本一致。
- 两个项目 Skill 通过 `quick_validate.py` 校验，暂存差异通过空白格式检查。

Windows / macOS 安装包由版本 Tag 对应的 GitHub Actions 构建；未执行 Windows 实机交互验收。
