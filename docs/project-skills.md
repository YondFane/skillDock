# 项目工作流 Skill

项目技能保存在 `.agents/skills/`，供 Codex 在此仓库发现和使用。新增技能后若当前会话尚未发现，可重新打开项目会话，或指定对应的 `SKILL.md` 路径。使用默认的自动匹配，也可通过名称显式调用。

| Skill | 用途 | 示例 |
| --- | --- | --- |
| `commit-code`（提交代码） | 补充 docs 文档，运行相关检查，创建中英文提交信息 | `使用 $commit-code 提交当前改动` |
| `release-app`（发版） | 同步版本，编写简短中英文说明，打 Tag 并跟进发布 | `使用 $release-app 发布 v0.1.7` |

## 提交代码

每次提交在 `docs/` 下新增或更新与改动对应的文档，说明目的、行为和实际验证结果。commit message 必须同时包含中文和英文，例如：

```text
fix: 优化资源查看布局 / Improve resource viewer layout
```

提交代码默认完成本地 commit；需要推送时明确说“提交并推送”。Skill 会检查暂存范围，保留无关改动，不提交依赖、构建文件或密钥。

## 发版

指定版本时使用该版本；普通修复未指定版本时默认递增 patch。Skill 使用 `npm run release:version -- <版本号>` 同步应用和锁文件版本，更新 `docs/testing-release-notes.md`，通过检查并提交后，创建指向发布提交的 annotated Tag `v<版本号>`。

版本说明包含“中文”和“English”两节，分别用少量要点说明相同变化。该文件同时作为 GitHub Release 和应用内更新说明的来源。

“发版”会推送发布提交及 Tag。现有 GitHub Actions 在 Tag 推送后构建 Windows / macOS 安装包并公开 Release；手动触发构建只生成草稿。只有构建、附件及公开发布确认完成，才报告发版成功。已有公开版本和 Tag 不覆盖。

## 技能验证

两份 `SKILL.md` 和界面元数据已通过 skill-creator 的 `quick_validate.py` 校验。新增技能沿用现有发布工作流；更新清单测试使用 Vitest，已包含在 `npm test` 中。v0.1.7 界面变更与检查结果见[资源查看布局说明](resource-viewer-layout.md)。
