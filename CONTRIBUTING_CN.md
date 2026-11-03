# 贡献指南

本仓库存放研究任务本身。它运行所依托的框架 [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio)，以及共享的流程和角色库 [agent-loop-community](https://github.com/justforyou16007/agent-loop-community)，都是 git 子模块，分别位于 `agent-loop-studio/` 和 `agent-loop-community/`，各自固定在某个版本。依赖只有一个方向：本仓库使用它们，它们构建和通过自己的检查都不需要本仓库。

所以每项改动都要放到它该在的地方：

- **框架**（hooks、流程检查、贡献用的 helper 等框架 helper，Studio，安装器，基础流程和角色，其中包括 `setup`）：在 agent-loop-studio 里改，在那里开 PR。合并之后，在本仓库用一个单独的 commit 更新子模块指向。CI 会检出子模块，所以本仓库的 PR 只能指向已经推到 GitHub 上的子模块 commit。
- **项目做出来的新流程或新角色**：提交到 agent-loop-community，所有贡献都到那里，不管它属于哪一端。它的[检查](agent-loop-community/tools/check.mjs)碰到某一端的流程用了该端项目包提供的东西时，只做记录，不判失败，因为社区库检查不了这些：贡献它的项目已经整体检查过。收什么样的内容见它的 [README](agent-loop-community/README.md)。
- **属于研究任务的东西**（它的 helper，以及 worker 和 validator 的流程与角色）：留在本仓库。设置机器用的是框架的 `setup` 流程，所以要改设置时确定的内容，就在本仓库改各端的 `configure` 和它的角色；要改 setup 自己的步骤，就到 agent-loop-studio 里改。

## 准备本地仓库

使用 Node.js 22.12+。连同子模块克隆，并且先构建框架、再构建本仓库，因为本仓库的构建会把框架编译好的 helper 和 Studio 页面复制进 `dist/`，再把自己的 helper 打包放在旁边：

```bash
git clone --recurse-submodules https://github.com/justforyou16007/auto-dl-loop.git
cd auto-dl-loop
npm ci
npm --prefix agent-loop-studio ci
npm run build:framework
npm run build
```

已有的本地仓库用 `git submodule update --init` 按固定的版本取回子模块。这里不使用 npm workspace，既不包含也不构建 Claude Code。

修改后执行 `npm run build`、`npm run typecheck`、`npm run lint` 和 `npm run format:check`；提交前执行 `npm run format`。只运行相关的测试文件，例如 `npm run test -- tests/test_validation.ts`，完整测试矩阵交给 CI；先构建，因为测试套件使用编译好的 helper。证据要求见[测试约定](docs/testing.md)。

## 各部分的位置

| 路径 | 内容 |
| --- | --- |
| `project.json` | 本仓库向框架和安装器说明自己：`worker` 和 `validator` 两种 profile，各自的入口角色、对应的流程库那一端，以及安装器为它打印的说明（`next`）；扩展模块；新增的 hook 动作 |
| `library/roles/worker/`、`library/roles/validator/` | 安装时放入各端项目的研究角色 |
| `library/loops/worker/`、`library/loops/validator/` | 研究流程：每个由流程定义（`<流程>.md`）和据此生成的脚本（`<流程>.js`）组成。各端的 `configure` 和验证端的 `contribution-check` 替代框架里的同名流程 |
| `src/tools/` | 研究用的 helper（配置表、验证服务、worker 的提交台账、wiki），以及框架加载的扩展 `research-extension.ts` |
| `skills/` | 技能；只有 `research-wiki`、`browser-act` 和 `shared-references` 进入安装包。`shared-references/project-rules.md` 写的是本仓库给框架角色定的规则 |
| `templates/` | 项目模板：角色段、环境段占位、任务和 benchmark 模板 |
| `tests/` | 测试套件 |
| `tools/` | 构建、流程库检查和打包 |
| `distribution/` | 安装器入口和发布的归档 |
| `agent-loop-studio/`、`agent-loop-community/` | 框架和共享流程库（子模块）：到它们各自的仓库里修改 |

## 角色和流程

会话负责启动流程、把 owner 的回答带进流程，流程负责调度角色，角色负责完成一步：没有流程之外的调度，角色不直接调用别的角色，owner 的决定是流程里的 `owner-review` 一步（见 [running-loops.md](agent-loop-studio/skills/shared-references/running-loops.md)）。一步怎么做，只写在对应角色的文件里，不写进脚本或提示：每项操作都归某个角色，helper 是角色的工具。必须机械保证的事（测试计数、finalize 的各项检查、只增不改的 benchmark）留在 helper 里。格式由负责写它们的框架角色规定：角色的格式见 [`role-creator`](agent-loop-studio/library/roles/framework/role-creator.md)（frontmatter 的 `name` 与文件名一致，有 `description` 和 `side`，`side` 要与所在目录一致；包含 Responsibility、Inputs、Output、Writes、Evaluation 几节），流程定义和脚本规则见 [`loop-editor`](agent-loop-studio/library/roles/framework/loop-editor.md)。脚本只调度角色，每次调用都给出 `schema` 和已声明的 `phase`，循环有固定上限，不使用当前时间和随机数。流程只能声明框架自带的 hook 动作，以及本仓库在 `project.json` 里列出的两个。

按两端项目实际拿到的样子检查研究流程库，也就是把它叠在框架库和社区库之上：

```bash
npm run build && node tools/library-check.mjs
```

它按顺序把框架的库、社区的库和本仓库的库复制到一个临时目录，对合起来的结果运行流程检查和角色检查；退出码非零表示有缺陷，报告里写明是哪个。根据改过的流程定义重新生成脚本后，加 `--stamp` 运行，它把每个定义的摘要记进对应的脚本（只处理本仓库的脚本）。打上摘要等于宣布脚本是最新的，所以只在重新生成之后才加。

项目学到的东西通过两个流程离开项目，都只在 owner 决定时运行，前提是已有一次提交完成。要发出的确切内容由 owner 一次审完，批准之前什么都不推送。在 validator 上，`leak-reviewer` 先在验证端的 [`contribution-check`](library/loops/validator/contribution-check.md) 里拿这些文件比对隐藏测试，这个流程替代框架默认的那个。两个流程的步骤都由框架的 [`library-contributor`](agent-loop-studio/library/roles/framework/library-contributor.md) 角色完成，用的工具是 `library-cli.js`（`--purpose share` 或 `--purpose upstream`）：

- [`library-contribution`](agent-loop-studio/library/loops/framework/library-contribution.md) 把项目自己做的东西，也就是没有哪个库给过它的流程和角色，一律发到 agent-loop-community：一个 PR，分支名为 `library/<项目>-<端>-<yyyymmdd>`。
- [`upstream-optimization`](agent-loop-studio/library/loops/framework/upstream-optimization.md) 把项目对某个库给它的流程和角色所做的改进，主要是 `trajectory-optimizer` 修好的角色，送回各自的来源：框架的基础流程和角色回 agent-loop-studio，本仓库 worker 和 validator 的回本仓库，社区库的回 agent-loop-community。每个库一个 PR，分支名为 `upstream/<项目>-<端>-<yyyymmdd>`。

所以从项目来到本仓库的，都是对本仓库自己的流程和角色的改进。由维护者审核合并。在本仓库，CI 会对每个 PR 跑流程库检查。合并后的角色会进入之后安装的每一个项目，所以要像审代码一样审它；已有项目重新运行安装器能拿到新的流程和角色，但已有的文件仍保留项目自己的版本。验证端的角色可以写测试的构造方法，但绝不能包含实际测试用例。

新增或修改角色、流程、技能或 helper 时，同步更新 [AGENT_GUIDE.md](AGENT_GUIDE.md) 和 [integration contract](skills/shared-references/integration-contract.md)；框架角色需要知道的改动，也要写进 [`project-rules.md`](skills/shared-references/project-rules.md)。在让角色调用新 helper 的同一次改动里，就在 contract 中加上它的一行。helper 保持兼容 Node.js 22.12+ 和 Windows，配置的命令一律以 argv 数组启动，不经过 shell。加新功能前，先过一遍[架构说明](ARCHITECTURE_GUIDE.md)最后一节的问题。

## 发布

修改安装包中的代码、角色、流程、技能或文档后，以及更新子模块指向后，执行 `npm run pack:contrejour`，把归档及校验文件更新到 `distribution/releases/`；归档里带着固定版本的框架运行时和流程库。新的研究 helper 要加进 `tools/build.mjs` 的 `ENTRIES` 和 `tools/pack-contrejour.mjs` 的入口列表；新发布的技能加进 `tools/pack-contrejour.mjs`。参见[打包约定](docs/packaging.md)。

提交标题使用 `fix(contrejour): preserve owner MCP entries` 这样的格式。改动保持集中，PR 写清用户可见的行为和验证结果。

贡献使用 [MIT 许可证](LICENSE)。
