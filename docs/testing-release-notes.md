SkillDock 测试安装包，直接下载安装，不通过 App Store。

- **Windows x64：**下载 `SkillDock_*_x64-setup.exe`，双击安装。默认仅安装到当前用户，支持简体中文与英文。缺少 WebView2 时安装程序会联网安装运行时。
- **macOS 13+：**下载 `SkillDock_*_universal.dmg`，打开后将 SkillDock 拖到 Applications（应用程序）。同一个安装包支持 Apple Silicon 与 Intel。
- **校验：**`SHA256SUMS.txt` 提供两个安装包的 SHA-256 摘要。

此版本未配置 Windows 发行者证书；macOS 使用 ad-hoc 临时签名，未通过 Apple 公证。Windows 可能提示未知发布者；macOS 首次启动如被拦截，可在“系统设置 → 隐私与安全性”选择“仍要打开”。只对自己确认来源的测试包执行此操作。

当前发布保持草稿状态，由仓库维护者测试后决定是否公开发布。应用未配置自动更新。
