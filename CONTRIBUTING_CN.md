# 贡献指南

使用 Node.js 22.12+，在仓库根目录执行 `npm ci`。Contrejour 不使用 npm workspace，既不包含也不构建 Claude Code。

修改后执行 `npm run build`、`npm run typecheck` 和 `npm run lint`。只运行相关的测试文件，例如 `npm run test -- tests/test_framework.ts`，完整测试矩阵交给 CI；先构建，因为 setup 和 framework 测试套件使用编译好的 helper。证据要求见[测试约定](docs/testing.md)。提交前执行 `npm run format`。

## 各部分的位置

| 路径 | 内容 |
| --- | --- |
| `library/roles/framework/`、`library/roles/worker/`、`library/roles/validator/` | 安装时放入项目的角色 |
| `library/loops/<端>/` | 流程：每个由流程定义（`<流程>.md`）和据此生成的脚本（`<流程>.js`）组成 |
| `skills/` | 技能；只有 `research-wiki`、`browser-act` 和 `shared-references` 进入安装包 |
| `src/` | helper |
| `templates/` | 项目模板：角色段、环境段占位、任务和 benchmark 模板 |
| `tools/`、`distribution/` | 打包、流程库检查、安装器和发布的归档 |

## 角色和流程

一步怎么做，只写在对应角色的文件里，不写进脚本或提示：每项操作都归某个角色，helper 是角色的工具。必须机械保证的事（测试计数、finalize 的各项检查、只增不改的 benchmark）留在 helper 里。格式由负责写它们的角色规定：角色的格式见 [`role-creator`](library/roles/framework/role-creator.md)（frontmatter 的 `name` 与文件名一致、有 `description`；包含 Responsibility、Inputs、Output、Writes、Evaluation 几节），流程定义和脚本规则见 [`loop-editor`](library/roles/framework/loop-editor.md)。脚本只调度角色，每次调用都给出 `schema` 和已声明的 `phase`，循环有固定上限，不使用当前时间和随机数。

按两端项目各自看到的样子检查流程库：

```bash
npm run build && node tools/library-check.mjs
```

它在临时项目里摆好框架角色以及每一端的角色和流程，运行流程检查和角色检查；退出码非零表示有缺陷，报告里写明是哪个。根据改过的流程定义重新生成脚本后，加 `--stamp` 运行，它把每个定义的摘要记进对应的脚本。打上摘要等于宣布脚本是最新的，所以只在重新生成之后才加。

项目在任务结束后把流程和角色推送到名为 `library/<项目>-<yyyymmdd>` 的分支，由维护者通过 PR 合并。合并后的角色会进入之后安装的每一个项目，所以要像审代码一样审它。验证端的角色可以写测试的构造方法，但绝不能包含实际测试用例。

新增或修改角色、流程、技能或 helper 时，同步更新 [AGENT_GUIDE.md](AGENT_GUIDE.md) 和 [integration contract](skills/shared-references/integration-contract.md)；在让角色调用新 helper 的同一次改动里，就在 contract 中加上它的一行。helper 保持兼容 Node.js 22.12+ 和 Windows，配置的命令一律以 argv 数组启动，不经过 shell。加新功能前，先过一遍[架构说明](ARCHITECTURE_GUIDE.md)最后一节的问题。

## 发布

修改安装包中的代码、角色、流程、技能或文档后，执行 `npm run pack:contrejour`，把归档及校验文件更新到 `distribution/releases/`。新的运行入口和要发布的技能在 `tools/pack-contrejour.mjs` 中添加。参见[打包约定](docs/packaging.md)。

提交标题使用 `fix(contrejour): preserve owner MCP entries` 这样的格式。改动保持集中，PR 写清用户可见的行为和验证结果。

贡献使用 [MIT 许可证](LICENSE)。
