# SkillDock · 技能坞

使用 Tauri 2、React、TypeScript 和 Rust 构建的 Claude Code / Codex 本地技能与行为规则管理器。当前实现技术方案的第一阶段：可运行的桌面应用与本地 CRUD。

## 已实现

- **资源库：**新建、查看、搜索、筛选、编辑和删除技能、Markdown 规则；支持工具兼容标签。
- **本地配置：**扫描 Claude Code / Codex 的用户全局目录及已登记项目；直接创建、编辑和删除原生技能、规则文件。
- **完整技能目录：**本地导入 SKILL.md、脚本、参考资料、二进制资产与空目录；附属 UTF-8 文本可在编辑器中修改。
- **安全写入：**查看差异后确认；使用整个资源和元数据的哈希检测外部修改；写入后回读验证。
- **备份恢复：**每次变更保存完整的操作前副本；可预览恢复编辑、删除，也可撤销创建。
- **项目与目录：**登记、移除项目；自定义 Claude 配置目录、Codex 配置目录和 Codex 全局技能目录。
- **持久化：**SQLite 保存索引、项目、配置与操作日志；实际文件保存在磁盘；启动时检查中断操作。

## 开发启动

本机验证环境：Node.js 26、Rust stable、macOS Apple Silicon。

macOS 需要 Xcode Command Line Tools；Windows 需要 Visual Studio C++ Build Tools 与 WebView2。安装要求见 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)。

```bash
cd /Users/huayun-mini/WEB_WORKSPACE/skillDock
npm ci
npm run tauri dev
```

`npm run dev` 只启动 Vite。浏览器没有 Tauri 本地文件权限，会显示桌面启动提示；不会使用 localStorage 模拟持久化。

## 构建与检查

```bash
npm test
npm run build
cargo test -p skilldock-core --locked
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
npm run tauri build
```

macOS 平台配置生成 .app，Windows 平台配置生成 NSIS 安装程序。此阶段未配置发布证书、公证或自动更新；开发构建不代表正式签名发布。

`.github/workflows/ci.yml` 配置 macOS / Windows 的构建检查、界面测试和 Rust 集成测试。Windows 需要在对应系统或 CI 中实际运行后才能确认运行兼容性。

## 使用方式

1. 在“资源库”创建技能或规则，或从本地导入。技能生成带 name、description 的 SKILL.md；元数据中的未知扩展字段完整保留。
2. 从列表打开资源。技能名称以 YAML 中的 name 为准；规则名称和兼容标签可在表单修改。下拉菜单可切换附属文件。
3. 点击“预览保存”或“删除”，查看目标路径和差异，再确认应用。
4. 在“本地配置”选择工具和位置，管理真实的全局 / 项目文件。也可将现有本地资源复制导入资源库。
5. 在“变更记录”预览恢复。恢复不会自动覆盖预览后被其他程序修改的内容。
6. 在“项目”添加项目目录；取消登记只移除应用内索引，保留项目文件。

## 路径约定

| 类型 | Claude Code | Codex |
| --- | --- | --- |
| 全局技能 | ~/.claude/skills/name/ | ~/.agents/skills/name/ |
| 项目技能 | .claude/skills/name/ | .agents/skills/name/ |
| 全局行为规则 | ~/.claude/CLAUDE.md、~/.claude/rules/ | CODEX_HOME/AGENTS.md、AGENTS.override.md |
| 项目行为规则 | CLAUDE.md、.claude/CLAUDE.md、CLAUDE.local.md、.claude/rules/ | AGENTS.md、AGENTS.override.md |

Codex 配置目录默认 ~/.codex，并识别 CODEX_HOME。全局技能目录与配置目录分别管理。Windows 使用系统用户目录，不通过 shell 展开 ~。

Codex 原生规则按指令文件编辑；新建不会覆盖已有 AGENTS.md，并考虑同层非空 AGENTS.override.md。已有 override 会在列表提示。命令执行策略 .rules 和 Claude 权限设置不属于当前规则管理范围。

旧版 ~/.codex/skills、Claude 的账号同步技能、包含符号链接的资源仅可查看。新建和编辑本地技能时，name 保持与技能目录名一致。

资源库的“通用”标签是兼容性声明；不会自动转换工具专有语法，也尚未实现统一安装到多种工具。当前通过手工刷新发现外部变化，没有后台双向同步。

## 数据和恢复机制

应用数据目录由 Tauri 系统路径 API 获取，可在“设置”查看。其下包含：

```text
skilldock.sqlite3       索引、目录设置、项目、变更日志
assets/<uuid>/         资源库中的完整文件
backups/<operation>/   操作前的完整副本
```

预览不写入目标文件。确认时先校验当前哈希、写备份和操作日志，再在目标文件的同一父目录生成暂存副本，替换后回读验证并提交元数据。失败会尝试回退，程序中断后会检查日志。若中断后文件再次被外部修改，会保留副本并提示人工恢复。

备份不会自动清理。恢复失败记录会保留具体原因和原始备份，避免静默丢失文件。

技能和本地导入不执行脚本；二进制文件保留但不能编辑。编辑上限 2 MB，资源上限 200 MB / 5,000 个文件与目录。拒绝路径穿越、符号链接导入和仅大小写不同的重复路径。

## 隔离验证

使用以下环境变量可以在测试目录验证真实桌面 CRUD，而不读取或修改真实用户配置：

```bash
SKILLDOCK_DATA_DIR="$PWD/.local-test/data" \
SKILLDOCK_HOME_DIR="$PWD/.local-test/home" \
npm run tauri dev
```

设置 SKILLDOCK_HOME_DIR 时，默认工具目录由该目录派生，并忽略外部 CODEX_HOME；已保存的目录设置仍以本地数据库记录为准。

## 代码结构

```text
src/                      React 界面、CodeMirror 编辑器、差异预览、类型化 IPC
src-tauri/                Tauri 生命周期、原生对话框、业务命令与平台构建配置
crates/skilldock-core/     可独立测试的 Rust 核心：SQLite、适配器、文件快照、CRUD、恢复
```

后续阶段：统一资源库的跨工具安装与卸载、通用规则映射、GitHub 下载与更新、资源导入导出、正式签名发布及 WSL 环境。
