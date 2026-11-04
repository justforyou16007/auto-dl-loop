# Contrejour

**两台机器上的对抗式研究任务，以 agent 流程的形式运行在 Claude Code 上。**

[English](README.md) · [快速开始](#快速开始) · [部署指南](SETUP_GUIDE_CN.md) · [架构说明](ARCHITECTURE_GUIDE.md)

Contrejour 在两台机器上运行一个研究任务。**worker** 为任务构建交付物并提交。**validator** 持有只增不改的隐藏 benchmark，作为 worker 的对抗方评判每次提交，发布结论、测试项总数与通过数，以及经过泄漏审查的反馈。worker 根据反馈不断改进，直到提交次数用完。

两台机器上的工作都组织成由**角色**组成的**流程**，运行在 [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio) 框架上。流程定义用自然语言写成，是流程的唯一依据：每一步由哪个角色做、角色之间传递什么、在哪里分支、最多重复几次。根据定义生成的 Claude Code workflow 脚本负责执行它。每个角色是一个 Claude Code agent 文件，这一步怎么做全写在里面。每个角色的每次运行都记录为**轨迹**，`trajectory-optimizer` 角色从中学习，修复角色。owner 在 **Studio**（浏览器里的控制台）里选择、试运行、修改和运行项目的流程。

Contrejour 只运行在 Claude Code 上：不支持 Codex，也不使用 Paseo。

## 三个仓库

本仓库 auto-dl-loop 存放研究任务本身。框架和共享流程库各是独立的仓库，本仓库以 git 子模块的形式引用它们：

| 仓库 | 内容 |
| --- | --- |
| [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio)，位于 `agent-loop-studio/` | 框架：在 Claude Code 上由流程调度角色的机制，检查和运行流程的 helper，Studio，安装器，以及每个项目都会拿到的基础流程和角色，例如 `setup`、`loop-trial`、`loop-authoring`、`owner-review` 和 `trajectory-optimizer`。 |
| [agent-loop-community](https://github.com/justforyou16007/agent-loop-community)，位于 `agent-loop-community/` | 共享流程库：各项目的 owner 选择贡献出来、供其他项目使用的流程和角色。目前还是空的。 |
| auto-dl-loop，即本仓库 | 研究任务：向框架说明两种机器的 `project.json`；研究用的 helper（验证服务、配置表、worker 的提交台账、wiki）；`library/` 里 worker 和 validator 的流程与角色；技能、模板和测试。 |

依赖只有一个方向：本仓库固定引用这两个仓库的某个版本，它们从不依赖本仓库。这样框架和共享库里不会混进只属于某个项目的东西，本仓库也可以自己决定什么时候升级到新版框架。

## 为什么用角色组成流程

以前的版本把一段编号步骤交给一个 agent 照做。顺序只能靠 agent 自觉。结果不好时，没人分得清是哪一步做得差，改进只能改那段文字，下一次未必生效。做得好的经验也只留在一个项目里。Contrejour 对此逐一回应：

- **顺序固定。** 什么时候运行什么由脚本决定，不靠 agent。
- **每一步归一个角色**，它的文件写明负责什么、能看到什么、交出什么、怎样算做得好。问题能定位到具体角色，在一处修复。
- **经验累积。** 角色根据轨迹被评估和修复，owner 选择贡献的内容再通过社区库带到其他项目。

脚本只管调度。开放式的工作，例如实现一个想法并做实验、找出交付物的问题，整个交给一个角色完成：把工作本身写死的流水线会成为上限，Contrejour 的前身 ARIS 就是这样。

模型还有一件事做不好：给自己的成果下结论。同一个 agent 写的评测，评出来的结果不可信。所以 Contrejour 把"做"和"判"放在两台互相看不见的机器上。

## 功能特性

### 来自框架的能力

下面这些由 agent-loop-studio 提供，详见它的 [README](https://github.com/justforyou16007/agent-loop-studio#readme) 和[架构说明](agent-loop-studio/docs/architecture.md)（英文）。

- **流程用自然语言定义，以脚本执行。** 流程定义（`.claude/loops/<流程>.md`）为每一步写明由哪个角色做、角色收到什么、交出什么、按什么条件分支、每处重复的上限，以及流程在哪里等待。`loop-editor` 据此生成 workflow 脚本（`.claude/workflows/<流程>.js`）。脚本只调用角色、按角色的结构化输出决定顺序和分支、在角色之间传递输入、在上限内循环。它从不在提示里写一步怎么做，也不用代码干活，所以对角色文件的修改不会被脚本盖过。
- **编译检查。** `loop-check` 不调用模型，用假角色把脚本运行几遍，每遍给出不同的假回答，以走到每一个分支。它报告未知的角色、停不下来的循环、未声明的阶段、任何回答都走不到的角色、对当前时间或随机数的使用（会破坏续跑），以及比定义旧的脚本。
- **小规模试运行。** 检查通过只说明每一步都走得到、每个角色都存在，不说明流程做的就是你想要的。[`loop-trial`](agent-loop-studio/library/loops/framework/loop-trial.md) 先做静态检查，再用流程定义里声明的参数（`trial-args`）小规模真跑一次，这些参数保证这次运行不会碰到项目之外的东西。`loop-tester` 对照你的目标报告这次运行做了什么，由你判断。不符合时，`loop-authoring` 修改流程，`trajectory-optimizer` 根据这次试运行修复角色，或者两者都做，然后再试一次，最多四轮。没有声明 `trial-args` 的流程不能试运行。
- **角色就是 Claude Code agent 文件**（`.claude/agents/<角色>.md`）：职责、输入、结构化输出、能写的位置、模型和思考深度，以及写明评价信号的 Evaluation 一节。工具清单能做到真正的隔离：不给读文件工具的角色确实读不到 wiki。能用 Bash 的角色靠的是文件里的约定。
- **轨迹让角色进步。** hook 把每个结束的角色的过程记录复制到项目里。worker 每一轮、validator 每一次评审之后，`trajectory-optimizer` 按每个角色自己的 Evaluation 一节评估它，在问题重复出现时修复角色文件。这些修复留在项目里。验证端的角色只能通过 owner 在 `proposal-review` 流程里接受的提案修改，因为验证端的轨迹里有隐藏测试，它们绝不能进入任何角色文件。
- **hooks 只做记录、通知或拦截。** 安装器只登记一次；哪些动作执行，写在流程定义里。框架自带的动作负责记录每个角色的轨迹，并在每个流程启动前核对：会话带进去的每个回答，都是 owner 在流程提问之后亲手输入、没有改动的消息。本仓库在 `project.json` 里另加了两个：一个在评审会话提前停下时通知验证服务，另一个不让验证端的角色碰 benchmark、隐藏数据和只能由 helper 写的文件。
- **没有流程之外的调度。** 会话只负责启动流程、把 owner 的回答带进流程；流程调度角色；角色完成各自那一步。角色从不直接调用别的角色，owner 的决定是流程里的 `owner-review` 一步。workflow 里的 agent 没法向人提问，所以流程在这一步停下，会话给 owner 看审核说明，拿到回答后流程接着运行。
- **新流程、新角色从已有的出发。** `loop-authoring` 先让 `loop-query` 找可以作为基础的流程，再由 `loop-editor` 在最接近的那个上构建；`role-authoring` 先让 `role-creator` 找已经能做这件事的角色，再以最接近的为基础构建。只有 owner 要求时才从头写。草稿只有在 owner 批准了确切版本后才装进项目。
- **Studio。** `studio.js` 是 owner 在本机浏览器里用的控制台。还没设置的项目打开时，画布上就是它的 `setup` 流程。在对话框里说出想要的流程，它会列出相近的流程，每个都能预览流程图，并把最接近的画到画布上，超参数排在旁边、连到它们影响的步骤。点步骤或箭头、说要怎么改，或者要一个新角色，`loop-authoring` 或 `role-authoring` 就在后台会话里起草，然后停下请你审核，草稿画在画布上。在这里还可以选定项目运行的流程和超参数取值、运行任意流程并看着它一步步执行、用「运行」旁边的「试运行」试跑流程，以及管理多个项目：从参考项目新建，或复制已有项目。只有用一次性链接登录的浏览器才能使用它，而且它只在本机地址上响应。`loop-view.js` 则把同样的流程显示成一个只读页面。
- **项目之间共享的流程库。** 安装时，项目会拿到框架的基础流程和角色、社区库里的流程和角色，以及本仓库里 worker 或 validator 那一端的流程和角色；同名时先取本仓库的，其次社区库的，最后框架的。此后它们归项目所有，安装时的副本另外保留一份，以后靠它分清哪些是项目改的、哪些是库里改的。

### 设置一台机器

研究机器的设置顺序是：安装，接受目录信任提示，`configure`，`setup`，可选的 `loop-trial`，然后开始工作。

- **`configure` 配置机器。** 它是研究任务自己的流程，最先运行，单独运行，而且先配置 validator。各步由 `validator-config` 或 `worker-config` 完成，用的工具是 `config-cli.js`。[validator 端](library/loops/validator/configure.md)：需求 → 任务（`task.md`）→ 配置表（benchmark、验证条款和服务）→ 应用 → 环境 → 报告，报告里写明启动服务的命令和 worker 需要的连接信息。[worker 端](library/loops/worker/configure.md)：配置表（连到 validator 的连接，`task.md` 由此取回）→ 应用 → 环境 → 报告。这台机器需要的配置都汇总在一张配置表上，只有 owner 批准的那个版本才会被应用。机器有变化时，再运行一次。
- **`setup` 只设置项目的工作流程。** 每个项目都有框架的 [`setup`](agent-loop-studio/library/loops/framework/setup.md) 流程，不管项目是做什么的。它有四步。**目标**（Goal）由 owner 用自己的话说明项目的工作应该是什么；有 `task.md` 时它会读，但绝不写。**主任务流程**（Task loop）确定项目运行什么：`loop-query` 找出合适的主任务流程，`project-setup` 提议其中一个并给出超参数取值，owner 批准或者说要改什么；owner 要求时，由 `loop-authoring` 修改或新建流程。选择结果记在 `.contrejour/loop.json`。**检查**（Check）运行流程和角色检查，重新生成过期的脚本。**交接**（Hand off）给 owner 一份报告，写明怎么试运行、怎么开始工作，再由 `project-cli.js finish-setup` 写入 `.contrejour/setup.json`，标记项目已设置好。还没设置的项目，Studio 打开时画布上就是 `setup`；在这种项目的会话里说 `start`，运行的也是 setup。
- **`loop-trial` 在正式工作之前试运行。** 在 worker 上，它用 `research-iteration` 的 `trial` 参数试跑：真跑一轮，实验也真做，但在构建（Build）之后、提交（Submit）之前停下，所以什么都不会发给 validator，也不占用提交次数。`submission-review` 不能试运行，因为它需要一次真实的提交。
- **流程由 owner 选定。** 每个项目运行一个主任务流程：通常 worker 上是 `research-iteration`，validator 上是 `submission-review`。流程自己声明超参数和默认值，所以调整流程只需要选取值，不用改流程；也可以换成别的流程，或者让 `loop-authoring` 新建一个。设置完之后要改，再运行一次 `setup`，或者用 Studio 或 `project-cli.js use`。

### 优化与贡献

- **优化留在项目里。** `trajectory-optimizer` 根据轨迹在项目里修复角色。在 worker 上，它直接改角色文件，每处修复单独提交；在 validator 上，它只提提案，owner 在 `proposal-review` 里接受后才生效。什么都不会自动发到别处。
- **贡献由 owner 决定**（[`library-contribution`](agent-loop-studio/library/loops/framework/library-contribution.md)）。任务完成之后（至少一次提交的结果已发布），只要 owner 决定，这个流程就列出项目新写和改过的流程与角色，并附上对每一项的判断。owner 选择哪些上传，并审过要发出的确切内容。选中的全部发到社区库 agent-loop-community，合成一个 PR。改过的会和社区库的版本做三方合并。项目改进过的框架流程或角色也可以发过去，之后在引用社区库的项目里，改进版会替代框架原版。收什么样的内容见社区库的 [README](agent-loop-community/README.md)。
- **验证端的泄漏检查。** 验证端的角色可以写测试的构造方法，但绝不能包含实际测试。所以在 validator 上，这个流程先运行验证端自己的 [`contribution-check`](library/loops/validator/contribution-check.md)：`leak-reviewer` 从全新的上下文出发，拿要发出的文件逐个比对隐藏测试，并把结论记在这份计划的摘要上，没有通过就什么都发不出去。它替代框架默认的 `contribution-check`（由 owner 自己检查文件）。

这个流程的步骤由 `library-contributor` 角色完成，它用的工具是 `library-cli.js`。这个 helper 把每个文件同安装时保留的副本和社区库的当前版本比较，所以项目没动过的文件绝不会发出去，也不会改回别人的改进。文件里有 key、token、隐藏路径或注入模式时，它拒绝发出；有本机路径时，它给出警告；它还把计划绑定到一个摘要上，所以发出去的就是 owner 批准的内容。之后由社区库的维护者审核合并。

### 独立、可度量的验证

- **两台机器，一条通道。** worker 和 validator 不共享磁盘、仓库，也不互发消息，只有验证服务的四个 MCP 工具和每个 zip 的上传。`task` 把验证端的 `task.md` 逐字节交给 worker，两边按同一份文字工作，验证端修改后，worker 下次取回时就会拿到。`requirements` 事先告诉 worker 交付物要满足的条件：zip 检查项和限制、`USAGE.md` 必须写清的内容、调用接口、运行环境、审查时限和各结论的含义。`submit` 预约一个一次性上传地址；`query` 报告服务状态、剩余次数和每次提交的结果。防作弊靠的是物理隔离而不是规则：worker 读不到 benchmark。
- **只增不改的 benchmark。** base 层的来源、数据版本、切分、样本数、runner 和逐样本通过规则在配置验证机器时冻结。评审过程中，`test-extender` 按层新增测试项（`inc-001`、…），每项都从已有测试项派生，不凭空编造。这些层放在只由 helper 提交的 git 仓库里，每个提交只能新增文件，helper 逐个提交检查历史。错了的层只能 retire，不能修改；任何改动都会让服务停止。
- **实测的测试结果。** 每个样本是一个测试项，由 helper 按冻结的通过规则（`metric`、`op`、`threshold`）根据完整的逐样本 runner 输出判定通过与否。结果只报告测试项总数和通过数。没有分数，也不比较不同提交，因为 benchmark 一直在长。worker 从不自报结果。
- **对抗式评审是一个流程。** 服务为每次提交启动一个 Claude Code 后台会话，运行 owner 选定的评审流程 `submission-review`：在运行任何东西之前检查代码，按文档安装交付物并写适配器，重跑每一层，继续找问题并派生新测试项，写出结论（`valid`、`cheating` 或 `unusable`）和反馈，让反馈经过泄漏审查，发布，记录，提出角色修改提案。结论是 `cheating` 时，所有测试结果作废。
- **反馈经过泄漏审查。** 反馈写出实际问题：错在哪里、违反 `task.md` 的哪项要求、大致多常见、多严重，以及之前的问题哪些解决了、哪些还在。它可以说明测试是怎样构造的，但不能透露实际测试。`leak-reviewer` 从全新的上下文出发，拿反馈逐条比对全部隐藏测试；它由流程启动，所以写反馈的角色左右不了它看到什么。审查绑定反馈的摘要；允许的重写次数用完仍有泄漏，就只发布结论和计数。
- **评审受到看护。** 评审会话在发布之前停下，服务会让它继续；会话被删除或无法继续时，这次提交记为失败，不计次数。验证端自己无法完成的评审（本机缺少承诺的环境、helper 出错）会被放弃，不计次数，worker 可以立即重新提交。
- **明确的停止条件。** 只有计次提交用完，任务才结束；通过全部现有测试项不会结束任务。上传、格式和基础设施故障都不计次数。

### 有记忆的研究迭代

- **一轮七步。** worker 的 `research-iteration` 流程先选出未解决的问题；让出想法角色各提一个想法（默认五个：三个看 wiki，一个只知道无效的想法，一个只知道任务和问题）；给想法打分，用 `rank_ideas` 对整个候选池排序，尝试得越少的方向，探索奖励越高；实现得分最高的想法并做实验；提交一个 commit。结果发布后，记录结果并修复角色。一轮接一轮，直到任务结束。每种出想法角色各用几个、探索的权重多大，都是这个流程的超参数。
- **研究 wiki。** 每台机器的 `research-wiki` 按问题（可以是多个）记录已有工作做了什么、试过哪些想法和实验、哪些有效、哪些无效，用有类型的证据边相连。只有记忆角色写入。每一轮都从它的 query pack 开始，那是一份不超过 1000 字符的摘要。验证端的 wiki 记录每次提交解决了哪些问题、哪些仍在，从不包含测试内容。
- **环境段和环境技能。** 关于机器的事实（主机、路径、环境、资源、指标输出位置、验证过的坑）写在 `CLAUDE.md` 的环境段里。每个角色都会读这个文件，所以这一段只写环境。固定的操作（同步代码、启动命名实验、检查、取回结果、停止）写成项目环境技能里验证过的脚本，每次运行有自己的名字，所以可以同时跑多个实验。key 和 token 只放在 `.contrejour/environment.json`。

### 本地、按归属管理的安装

安装器来自框架，在本仓库准备好的本地副本里运行。它把编译好的 helper（框架的和本仓库的）、`research-wiki` 和 `browser-act` 技能及共享参考文档、三个库里的流程和角色以及运行依赖复制进项目。它把 hooks 和这一端的入口角色写进 `.claude/settings.json`，所以 hooks 从一开始就守着每个流程，每个会话从一开始就是这一端的任务管理角色。它不下载任何东西，只写入项目目录；它不做配置，也不选流程，这些是 `configure` 和 `setup` 的事。更新只替换安装器管理的文件；放入项目的流程和角色、任务、wiki、benchmark、提交记录和设置都保持项目里的样子。

## 工作方式

1. **定义任务。** 在验证机器上运行 `configure` 流程。它和你一起写好 `task.md`，再请你确认一张配置表：benchmark、逐样本通过规则、提交次数、评审会话怎么启动、服务地址。应用配置表时冻结验证条款。接着运行 `setup`，它请你批准评审流程（通常是 `submission-review`）和它的超参数取值，检查各流程并交接；然后启动服务。
2. **构建。** 在 worker 机器上，用 validator 给你的连接信息运行 `configure`，它通过服务取回 `task.md`。接着运行 `setup`，批准研究流程（通常是 `research-iteration`）和它的超参数取值，需要的话用 `loop-trial` 试跑一轮。在项目里打开的 Claude Code 会话就是任务管理角色，说 `start`，它就一轮接一轮地运行这个流程。
3. **提交。** 每一轮以一个 commit 结束，打包成带 `USAGE.md` 的 zip，上传到一次性地址。
4. **评审。** 服务为这次提交启动一个评审会话，它运行选定的流程 `submission-review`，发布结论、测试项计数和经过泄漏审查的反馈。
5. **学习。** worker 的记忆角色记下结果和反馈指出的问题，`trajectory-optimizer` 修复两端的角色（在 validator 上要经 owner 接受提案），下一轮从仍未解决的问题开始。
6. **贡献与结束。** 只要有一次提交完成，两端的 owner 都可以在自己决定时运行 `library-contribution`，从项目新写和改过的流程与角色里选出要上传的，发到社区库；在 validator 上要先过泄漏检查。提交次数用完时任务结束。

两个项目放在不同的机器上，不共享也不同步任何目录：正是这一点让隐藏的 benchmark 不在 worker 能触及的范围内。评测和反馈的边界见[架构说明](ARCHITECTURE_GUIDE.md)。

## 快速开始

### 前置条件

每台机器上：

- **Bash**、**Git** 和 **Node.js 22.12+**。
- 已安装并登录的 **Claude Code**。

验证机器还需要 benchmark 的依赖。Windows 上在 Git Bash 中运行安装器，Node.js 需在 `PATH` 中；评审会话在 Windows 上的启动命令和网络设置见[部署指南](SETUP_GUIDE_CN.md)。

### 准备本地仓库

每台机器上，连同子模块克隆本仓库并构建。要先构建框架，因为本仓库的构建会取用框架编译好的 helper 和 Studio 页面，再把自己的 helper 放在旁边：

```bash
git clone --recurse-submodules https://github.com/justforyou16007/auto-dl-loop.git
cd auto-dl-loop
npm ci
npm --prefix agent-loop-studio ci
npm run build:framework
npm run build
```

### 安装到各自的项目

在 **validator** 机器上：

```bash
bash distribution/install-contrejour.sh --role validator --project /path/to/project
```

在 **worker** 机器上：

```bash
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

项目是哪一端在安装时固定。安装只读取准备好的本地仓库，不下载任何东西；缺少依赖或编译产物时直接报错。安装器写好 hooks 和入口角色，所以项目里的每个会话从一开始就是这一端的任务管理角色，然后打印下一步要做的事，其中包括 `project.json` 里给这一端的说明。安装器还会在项目里记下这个本地仓库的位置，因为项目要在那里找流程库：一是找项目还没有的流程，二是贡献时发出 PR。目标机器上没有仓库时，使用离线归档里的 `install.sh`，参数相同；以后需要本地仓库的流程会先问你要不要取回一份。

### 设置两台机器

每台机器的顺序都一样：接受目录信任提示，`configure`，`setup`，然后开始工作；在 worker 上，开始之前可以用 `loop-trial` 试跑一轮。先在 validator 上走完：worker 的 `configure` 要从 validator 运行中的服务取回 `task.md`，而这个服务要等 validator 的 `setup` 选定评审流程之后才能启动。

```bash
cd /path/to/validator-project
claude                                                 # 只需一次：接受目录信任提示，然后退出
node .contrejour/dist/tools/studio.js --project .      # 打印一次性登录链接
```

在这台机器的浏览器里打开链接（要从别的机器访问，先转发端口：`ssh -L 8790:127.0.0.1:8790 <机器>`）。项目还没设置，所以 Studio 打开时画布上是 `setup` 流程，但要先运行 `configure`：在画布上方的流程列表里选中它，点「运行」。它会停下来请你说明这台机器要验证什么、审阅 `task.md` 并确认配置表，每次都由 Studio 的对话框来问你。然后选中 `setup`，点「运行」：`task.md` 没说清楚时，它会问你项目的工作应该是什么，并请你批准评审流程（通常是 `submission-review`）和它的超参数取值。在终端里也可以完成同样的事，每个流程开一个会话：

```bash
claude "Run the configure loop"
claude "Run the setup loop"
```

setup 交接之后，用 `configure` 的报告里写明的命令启动验证服务并保持运行；它会为每次提交启动一个评审会话：

```bash
node .contrejour/dist/tools/validation-cli.js serve --project .
```

后台会话（Studio 启动的和评审用的）只能在已信任的目录里启动，所以要接受信任提示。`configure` 的报告里还有 worker 的连接信息，即一个地址和一个 token，把它私下交给 worker 机器。验证机器已经提供 `CONTREJOUR_URL` 和 `CONTREJOUR_TOKEN` 时，`configure` 直接使用它们，不再询问地址，也不新建 token。

然后用同样的方式设置 worker，在 Studio 里或终端里都可以。它的 `configure` 会向你要连接信息，通过 validator 的服务取回 `task.md`；它的 `setup` 请你批准研究流程（通常是 `research-iteration`）和它的超参数取值：

```bash
cd /path/to/worker-project
claude                                                 # 只需一次：接受目录信任提示，然后退出
claude "Run the configure loop"
claude "Run the setup loop"
```

想在正式迭代之前先试跑一轮，就把 `research-iteration` 放到画布上，点「运行」旁边的「试运行」，或者运行：

```bash
claude --permission-mode bypassPermissions 'Run the loop-trial loop with args {"loop": "research-iteration", "goal": "<这一轮应该达到什么>"}'
```

这是真实的一轮，实验也真做，做出来的东西留在项目里：它在构建之后停下，所以什么都不会发给 validator，也不占用提交次数。然后由你对照目标判断它的报告，你想改的地方会在下一次试运行之前改好。

然后开始一轮轮迭代：

```bash
claude --permission-mode bypassPermissions "start"     # 以 worker-task-manager 身份运行，一轮接一轮
```

保持这个会话打开，它会自己一轮接一轮地运行，所以要用不等人批准的权限模式（更谨慎的选择是 `auto`，见部署指南）。第一句话只写 "start"，因为流程里的每个角色都会收到启动这次运行的那句话。如果想从 Studio 开始迭代，要先在项目里再打开一次 `claude`，批准 `contrejour` 服务器：后台会话没法问你。

以后要重新配置机器，再运行一次 `configure`；之后重启 validator 正在运行的服务，让它用上新应用的地址和 token。要换主任务流程或改它的取值，再运行一次 `setup`，或者用 Studio 或 `project-cli.js use`。

配置表、网络、一次提交怎么评审、升级和故障排查，见**[中文部署指南](SETUP_GUIDE_CN.md)**或 **[English setup guide](SETUP_GUIDE.md)**。

## 包含哪些内容

| 部分 | 角色 | 流程 |
| --- | --- | --- |
| 框架，每个项目都有 | `project-setup`、`loop-query`、`loop-editor`、`role-creator`、`loop-tester`、`owner-review`、`trajectory-optimizer`、`library-contributor`；另有 `task-manager` 和 `project-memory`，研究任务的两端不用它们，而是用各自的任务管理角色和记忆角色 | `setup`、`loop-trial`、`loop-authoring`、`role-authoring`、`library-contribution`；另有 `contribution-check`，是某一端可以替换的默认版本 |
| worker | `worker-config`、`worker-task-manager`（入口）、`worker-memory`、`problem-selector`、`ideator-informed`、`ideator-failures-only`、`ideator-blank`、`idea-assessor`、`implementer` | `research-iteration`（主任务）、`configure` |
| validator | `validator-config`、`validator-task-manager`（入口）、`validator-memory`、`inspector`、`adapter-writer`、`regression-runner`、`test-extender`、`verdict-writer`、`leak-reviewer` | `submission-review`（主任务）、`configure`、`contribution-check`（自己的版本，替代框架的那个）、`proposal-review` |

worker 和 validator 的源文件在 [`library/`](library/)，框架的在 [`agent-loop-studio/library/`](agent-loop-studio/library/)；社区库目前还没有内容。每个角色做什么见 [Agent 指南](AGENT_GUIDE.md)。随附两个技能，作为角色引用的操作手册：[`research-wiki`](skills/research-wiki/SKILL.md) 是长期记忆，[`browser-act`](skills/browser-act/SKILL.md) 通过外部的 browser-act CLI 访问渲染后的页面和浏览器会话。`configure` 会再写入第三个：项目自己的 `<项目>-environment` 技能。文献检索、GPU 平台和通知等可选集成留在本仓库中，不会安装进项目。

## 文档

| 文档 | 用途 |
| --- | --- |
| [部署指南](SETUP_GUIDE_CN.md) / [Setup guide](SETUP_GUIDE.md) | 部署两台机器，运维安装好的项目。 |
| [架构说明](ARCHITECTURE_GUIDE.md) | 设计：流程、角色、轨迹、信任边界、benchmark 完整性，以及谁写哪个文件。 |
| [Agent 指南](AGENT_GUIDE.md)（英文） | 角色、流程和各类文件的位置，供初次读项目的 agent 使用。 |
| [贡献指南](CONTRIBUTING_CN.md) | 开发本仓库及其角色和流程、框架的改动该提交到哪里，以及运行针对性检查。 |
| [打包约定](docs/packaging.md)（英文） | 构建归档，以及安装时的文件归属。 |
| [agent-loop-studio](agent-loop-studio/README.zh-CN.md)、[它的架构说明](agent-loop-studio/docs/architecture.md)（英文） | 框架：会话、流程和角色、项目包、Studio、流程库和贡献。 |
| [agent-loop-community](agent-loop-community/README.md) | 共享流程库，以及它收什么样的内容（文末有中文）。 |

## 许可证

[MIT](LICENSE)，保留原 ARIS 作者的版权声明。
