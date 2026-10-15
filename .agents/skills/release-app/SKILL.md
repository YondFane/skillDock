---
name: release-app
description: 在 SkillDock 项目发版时使用；同步应用版本、编写简短中英文版本说明、创建并推送版本 Tag，跟进现有 GitHub Actions 发布。适用于“发版”“发布新版本”；仅讨论流程或创建技能时不执行发布。
---

# 发版

使用项目现有的 `.github/workflows/installers.yml`、`scripts/set-version.mjs` 和 `scripts/release-version.mjs`。先检查它们及当前分支、工作区、远程和已有版本，不假定历史配置始终有效。

## 准备版本

- 尊重用户指定的版本。未指定时，普通修复及小幅改进默认递增 patch，并明确告知所选版本；主版本或不兼容变更若无法从需求确定，先澄清版本范围。
- 使用 `npm run release:version -- <版本号>` 同步 `package.json`、`package-lock.json`、`Cargo.toml`、`Cargo.lock`、`src-tauri/tauri.conf.json`。当前脚本只支持数字 `major.minor.patch`，Tag 格式为 `v<版本号>`。
- 更新 `docs/testing-release-notes.md`。现有构建流程将此文件用于 GitHub Release 及应用内更新说明，不能只修改远程 Release 正文。
- 从上一个发布 Tag 到本次发布的实际 diff 提炼内容，包含中文、English 两节，每种语言用 2–4 个简短要点描述相同变化；内容较少时可各写一句。只列已实现的变化，必要时用一句话保留安装或兼容性限制。

```markdown
# SkillDock vX.Y.Z

## 中文
- 隐藏滚动条，保留正常滚动。
- 调整资源查看区域为左侧 30%、右侧 70%。

## English
- Hide scrollbars while preserving scrolling.
- Set the resource list and viewer split to 30% / 70%.
```

## 检查与提交

- 执行 `node scripts/release-version.mjs`、`npm test`、`npm run build`，以及 Rust 格式、集成测试和 Clippy 检查；具体命令以当前 CI 为准。`npm test` 已包含更新清单测试 `scripts/update-manifest.test.mjs`，该文件使用 Vitest，不能通过 `node --test` 运行。记录真实结果，检查失败先修复再打 Tag。
- 将发布版本、版本说明及本次待发布代码提交，遵循本项目提交规范：commit message 必须包含中文与英文，相关变更说明写入 `docs/`。可使用 `$commit-code`；不可将无关改动混入发布。
- 发布源代码必须已提交，工作区干净。确认目标分支及远程；未另行指定时沿用仓库的发布分支。先推送发布提交，确认远程分支包含该提交，再创建指向该提交的 annotated Tag。

## 打 Tag 与发布

“发版”包含推送发布提交、推送版本 Tag 并由现有 CI 发布的授权，无需为同一流程重复确认。只要求准备草稿或本地打 Tag 时，按该范围执行。

```bash
git tag -a vX.Y.Z <发布提交号> -m "发布 SkillDock vX.Y.Z / Release SkillDock vX.Y.Z"
git push origin vX.Y.Z
```

- 推送 `v*` Tag 会触发安装包工作流；Windows 与 macOS 构建成功、附件上传完整后自动公开 Release。手动运行该工作流只创建草稿，不等同于正式发版。
- 不覆盖或强推已有 Tag，不覆盖已公开版本的附件。Tag 已存在时检查其提交及工作流状态；同一提交的失败构建可重新运行，修正源代码后需要新版本。
- 使用现有 GitHub 登录和仓库 Secrets，不读取、打印或提交签名私钥与密码。签名配置或权限缺失时说明具体阻碍，保留已完成结果。
- 跟进对应工作流，核对 Release 的 Tag、目标提交、中英文说明和安装包、签名、`latest.json`、`SHA256SUMS.txt`。CI 尚未结束时只报告“已触发构建”，仅在公开发布及附件确认后报告成功并提供链接。失败时报告失败任务和原因，不把 Tag 推送成功当作发版完成。
