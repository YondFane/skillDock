---
name: commit-code
description: 在 SkillDock 项目提交代码时使用；编写 docs 变更文档、执行相关检查，并生成含中英文描述的 Git commit。适用于“提交代码”“commit changes”；创建技能或仅讨论提交规范时不执行提交。
---

# 提交代码

在仓库根目录操作。先读取项目指令、`git status` 和 diff，确定本次提交范围，保留无关改动。

## 文档与验证

- 每次代码提交前，在项目 `docs/` 下新增或更新相关 Markdown 文档，与代码一起提交。优先更新已有主题文档，否则使用有含义的文件名。
- 文档简要说明变更目的、最终行为、验证结果及实际限制；没有执行的检查明确写为未执行，不虚构结果。纯文档或技能变更可更新对应的使用文档。
- 按改动运行相关检查：前端使用 `npm test`、`npm run build`；Rust 使用 `cargo fmt --all --check`、`cargo test -p skilldock-core --locked`、`cargo clippy --workspace --all-targets --locked -- -D warnings`。仅文档或技能变更无需运行全部应用测试。
- 提交前检查暂存 diff 和 `git diff --cached --check`；只暂存本次变更，排除密钥、运行数据、依赖目录和构建产物。

## 提交信息

每个 commit message 必须包含中文和英文描述。建议标题使用 Conventional Commits 类型，以 `中文 / English` 表达同一项变更；复杂变更可在正文继续补充对应的中英文说明。

```text
feat: 添加项目工作流技能 / Add project workflow skills

中文：新增提交代码和发版技能，并补充 docs 使用说明。
English: Add commit and release skills with usage documentation in docs.
```

使用多行提交信息时，将完整正文写入临时文件，执行 `git commit -F <临时文件>`，提交后删除临时文件。不要在提交信息中泄露敏感信息。

用户要求“提交代码”时完成本地提交；明确要求推送时再推送当前分支到对应远程，不强制推送。完成后报告提交号、文档位置、检查结果和推送状态。没有可提交变更时直接说明，不创建空提交。
