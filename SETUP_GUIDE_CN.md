# Contrejour 部署指南

Contrejour 是在两台机器上对抗进行的研究任务，以 agent 流程的形式运行在 Claude Code 上；它的项目包就是本仓库 [auto-dl-loop](https://github.com/justforyou16007/auto-dl-loop)，本指南部署的就是它。**worker** 为 `task.md` 构建交付物并提交。**validator** 持有只增不改的隐藏 benchmark，作为 worker 的对抗方评审每次提交，发布结论、测试项总数与通过数，以及对所发现问题的反馈。两台机器之间只有验证服务的四个 MCP 工具（`task`、`requirements`、`submit`、`query`）和每个 zip 的上传。

两台机器都运行在 [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio) 框架上。工作以**流程**的形式运行：流程定义用自然语言写成，写明每一步由哪个**角色**做、按什么顺序、在什么上限之内；根据定义生成的 Claude Code workflow 脚本严格照此调度各个角色。每个角色是一个 Claude Code agent 文件，这一步怎么做全写在里面。每个角色的每次运行都记录为轨迹，`trajectory-optimizer` 角色据此修复角色。框架提供 helper、安装器、Studio（你在浏览器里用的控制台），以及每个项目一开始就有的基础流程和角色，其中的 `setup` 设置项目的工作流，`loop-trial` 在正式工作之前真跑一次流程、看它是否合用；各项目贡献出来、留给别的项目用的流程和角色放在 [agent-loop-community](https://github.com/justforyou16007/agent-loop-community)。

Contrejour 只运行在 Claude Code 上：不支持 Codex，也不使用 Paseo。设计及其理由见 auto-dl-loop 仓库中的 `ARCHITECTURE_GUIDE.md`；框架自身的设计见 `agent-loop-studio/docs/architecture.md`。[English setup guide](SETUP_GUIDE.md)

## 各部分在哪里

auto-dl-loop 是一个项目包：它只放研究任务特有的东西，框架和共享流程库则以 git 子模块的形式引用进来。

| 位置 | 内容 |
| --- | --- |
| `project.json` | 项目可以安装成的两种 profile，`worker` 和 `validator`：各自的会话以哪个角色启动（`worker-task-manager`、`validator-task-manager`），以及装好之后做什么 |
| `src/tools/` | 研究任务自己的 helper：机器配置（`config-cli`）、验证服务（`validation-cli`）、worker 的台账（`worker-cli`）和研究 wiki |
| `library/loops/`、`library/roles/` | worker 端和验证端的流程与角色，分别在 `worker/` 和 `validator/` 下；其中有两端各自的 `configure`，也就是本项目包自己对机器的配置 |
| `skills/`、`templates/` | 角色用到的技能和模板 |
| `agent-loop-studio/` | 子模块：框架，包括它的 helper、Studio、安装器（`distribution/install.mjs`）和基础流程与角色，`setup` 和 `loop-trial` 也在其中（`library/loops/framework/`、`library/roles/framework/`） |
| `agent-loop-community/` | 子模块：共享流程库，各项目把 owner 选定的流程和角色贡献到这里，留给别的项目用 |

依赖只有一个方向：auto-dl-loop 固定引用两个子模块各自的某个版本，它们都不依赖 auto-dl-loop。

## 开始之前

两台机器都需要 Bash、Git、Node.js 22.12+，以及已安装并登录的 Claude Code。验证机器还需要运行 benchmark 所需的一切。Windows 上在 Git Bash 中运行下面的命令，Node.js 需在 `PATH` 中；WSL 是另一个独立的 Linux 环境。Contrejour 对 Claude Code 的用法（后台会话、workflow、agent、hooks）已在 Claude Code 2.1.316 上验证。

每台机器建一个项目目录，两者绝不共享磁盘、仓库或同步目录：正是这种隔离让隐藏的 benchmark 不在 worker 能触及的范围内。`task.md` 只在验证端写，worker 会取回它。

## 准备本地仓库

每台机器都从 auto-dl-loop 的本地克隆安装，克隆放在项目目录之外。准备它是唯一需要下载的一步：Git 取回项目包和两个子模块，npm 取回它们各自需要的包，然后把两者都构建好。

```bash
git clone --recurse-submodules https://github.com/justforyou16007/auto-dl-loop.git
cd auto-dl-loop
npm ci                              # 本项目包的依赖
npm --prefix agent-loop-studio ci   # 框架的依赖，包括构建 Studio 页面要用的
npm run build:framework             # 构建框架的 helper 和 Studio 页面
npm run build                       # 构建本项目包的 helper，放进 dist/，和框架的放在一起
```

克隆时没加 `--recurse-submodules` 的，先运行 `git submodule update --init`。顺序不能乱：`npm run build` 以框架的构建结果为起点，框架还没构建就会停下。

## 安装

在准备好的本地仓库里，按本机是哪一端安装到项目：

```bash
bash distribution/install-contrejour.sh --role validator --project /path/to/project   # 验证机器
bash distribution/install-contrejour.sh --role worker --project /path/to/project      # worker 机器
```

安装器只读取准备好的本地仓库。它不执行 Git clone 或更新，不安装 npm 包，不下载任何东西，也不需要 tar；它只写入项目目录，从不碰全局配置。缺少依赖或编译好的 helper 时，它会停止并给出准备步骤。`--dry-run` 报告将要做什么，不写入任何文件。

目标机器上没有本地仓库时，用发布归档：`distribution/releases/` 里有一份，也可以在准备好的本地仓库里用 `npm run pack:contrejour` 构建一份（输出到 `artifacts/`）。复制过去，在项目目录之外解压，用相同的参数运行其中的安装器：

```bash
tar -xzf contrejour-0.1.0.tar.gz
bash contrejour/install.sh --role worker --project /path/to/project
```

安装器放进项目的内容：

| 位置 | 内容 | 之后 |
| --- | --- | --- |
| `.contrejour/` | 编译好的 helper（`dist/`，含 Studio 页面）、它们的运行依赖、模板，以及项目包的 `project.json` | 由安装器更新 |
| `.claude/skills/` | `research-wiki`、`browser-act` 和共享参考 | 由安装器更新 |
| `.claude/agents/` | 框架的十个角色和本端的九个角色 | 首次放入，之后归项目所有 |
| `.claude/loops/`、`.claude/workflows/` | 每个流程的定义和脚本：框架的 `setup`、`loop-trial`、`loop-authoring`、`role-authoring`、`library-contribution` 和 `contribution-check`；本端自己的 `configure`；以及本端的主任务流程（worker 端是 `research-iteration`；验证端是 `submission-review`，另有 `proposal-review`，以及验证端自己的 `contribution-check`，即泄漏检查，代替框架的那个） | 首次放入，之后归项目所有 |
| `.contrejour/seeded/` | 每个流程和角色放入时的副本：之后用来分清本项目改了什么 | 放入文件时写入 |
| `.contrejour/install.json` | 本项目是哪一端、作为项目流程库的本地仓库，以及安装器所管理文件的哈希 | 每次安装重写 |
| `.claude/settings.json` | Contrejour 的 hooks 登记和入口角色（本端的任务管理角色）；你的其他设置和 hooks 保持不变 | 每次安装重新写入 |

流程和角色只在项目里还没有同名文件时写入，更新从不替换或删除它们，因为它们本来就要变化：`trajectory-optimizer` 修复角色，流程和新角色由你通过 `loop-authoring`、`role-authoring` 这两个流程修改和添加。`.contrejour/seeded/` 里的副本让项目分得清哪些是自己改的、哪些是流程库改的；记录下来的本地仓库里带着共享流程库，你决定贡献时，选定的流程和角色就送到那里（见[哪些内容会离开项目](#哪些内容会离开项目)）。从归档安装不会记录流程库（从归档更新时保留之前记录的），所以从这样的项目贡献时，要先取一份共享流程库的本地仓库。

项目是哪一端在安装时固定：之后的一切都读取它，用另一端更新会被拒绝，所以每一端用一个项目。早期版本为 Codex 安装的项目，以及名为 ARL 的版本安装的项目（数据在 `.aris/` 下），会被拒绝而不是迁移：请安装到新项目，重新配置和设置，并新建 `research-wiki/`。安装器不再接受 `--provider`。

安装完成时，安装器会列出接下来要做的事，包括本端的先后顺序。下一节逐一说明。

## 安装之后

装好的项目已经有了流程和角色，但还没有这台机器在任务里的那一部分：没有任务，没有 benchmark 或连接，也没有要运行的流程。这些由两个互相独立的流程定下来，都由你自己运行：

- **`configure`** 是本项目包自己的流程，负责配置这台机器：验证端定下 `task.md`、benchmark、验证条款和服务；worker 端定下到验证端的连接，并通过它取回 `task.md`；两端都准备本机环境。
- **`setup`** 是框架的流程，每个项目都一样。它只设置项目的工作流，别的都不管：项目拿哪个流程当自己的工作来运行，超参数取什么值。

`configure` 在前，因为工作流要按任务来选，而 `task.md` 是在 `configure` 里定下的。

### 步骤的顺序

每台机器上：

1. **安装**，见上一节。
2. **接受目录信任提示。** 在项目里打开一次 `claude`。Claude Code 只在它信任的目录里启动后台会话，而 Studio 和验证服务都要靠后台会话工作。
3. **配置机器**，运行 `configure`（见 [configure 做什么](#configure-做什么)）。
4. **设置工作流**，运行 `setup`（见 [setup 的四步](#setup-的四步)）：验证端通常选 `submission-review`，worker 端通常选 `research-iteration`。
5. **想试的话，试运行流程**，运行 `loop-trial`（见[试运行流程](#试运行流程)）。这一步是 worker 端的：`submission-review` 要有真实的提交才能运行，所以没法试。
6. **开始。** 验证端用 `configure` 报告里给出的命令启动服务，此后每次评审都由服务自己启动。worker 端运行 `claude --permission-mode bypassPermissions "start"`。

两台机器之间，验证端在前，一直做到服务运行起来。worker 的 `configure` 要从这个服务取回 `task.md`，而服务要等验证端做完两件事才能启动：`configure` 写好它要读的条款和 token，`setup` 选定它要运行的评审流程。

```text
验证端： 安装 → 信任提示 → configure → setup → 启动服务 → 把连接信息交给 worker
worker： 安装 → 信任提示 → configure（取回 task.md）→ setup → loop-trial（可选）→ start
```

### 运行流程

在项目里打开的每个会话，一开始就是本端的任务管理角色（`validator-task-manager` 或 `worker-task-manager`），因为安装器已经把它作为入口角色写进了 `.claude/settings.json`；Studio 启动的会话也一样。任务管理角色负责运行流程、把你的回答带进流程。有两种做法：

- **在 Studio 里。** Studio 是你管理项目的控制台，在本机的浏览器里使用（见 [Studio](#studio)）。在项目里启动它，打开它打印的登录链接：

  ```bash
  cd /path/to/project
  node .contrejour/dist/tools/studio.js --project .
  ```

  它只在本机的回环地址上响应；机器在远端时，先转发端口（`ssh -L 8790:127.0.0.1:8790 <机器>`）。还没设置的项目，一打开画布上就是它的 `setup` 流程；要运行别的流程（首先就是 `configure`），在画布上方的流程列表里选中它。点「运行」：流程在后台会话里运行，每次需要你决定时都会在对话里问你。在对话框里打字不会启动流程：流程问你之前，你说的话会用来修改画布上的流程，或者查找相近的流程。

- **在会话里。** 在项目里运行，一次一个：

  ```bash
  claude "Run the configure loop"
  claude "Run the setup loop"
  ```

  项目还没设置时，在会话里说 `start` 也会运行 `setup`，但不会运行 `configure`。

### configure 做什么

`configure` 是研究任务自己对机器的配置，和项目的工作流是两回事。两端各有一个：[`library/loops/validator/configure.md`](library/loops/validator/configure.md) 和 [`library/loops/worker/configure.md`](library/loops/worker/configure.md)。做这些步骤的角色是 `validator-config` 和 `worker-config`，它们使用的 helper 是 `.contrejour/dist/tools/config-cli.js`。

- **验证端：** 需求（这台机器要验证什么）→ 任务（`task.md`）→ 配置表（benchmark、条款、服务）→ apply → 环境 → 报告。
- **worker 端：** 配置表（到验证端的连接，`task.md` 通过它取回）→ apply → 环境 → 报告。

你审阅整张配置表并批准其中一个版本，apply 写入的正是这个版本。随后在真实机器上准备环境。报告说明定下了什么、接下来做什么。`configure` 不会开始研究，也不选流程。两端的具体步骤见[先设置验证机器](#先设置验证机器)和 [worker 机器](#worker-机器)。

### setup 的四步

`setup` 设置项目的工作流：项目拿哪个流程当自己的工作来运行，怎么运行。它分四步，每个项目都一样。它的定义在框架里，即 `agent-loop-studio/library/loops/framework/setup.md`；它自己的那几步由 `project-setup` 角色来做。

1. **目标。** `project-setup` 读你对这项工作说的话，以及项目里已有的说明：`task.md`（如果有）和当前的主任务流程。足够选定工作流时，它用几行话重述目标；不够就问你。setup 只读 `task.md`，从不写它。
2. **主任务流程。** 主任务流程就是项目要做的工作：worker 一轮接一轮做的事，或者验证端对每次提交做的评审。`loop-query` 在本项目和它的流程库里找出适合这个目标的主任务流程，`project-setup` 从中推荐一个，并给出各个超参数的取值。你批准，或者说明想换哪个流程、哪些取值。都不合适，或者要改其中一个，就直接说：`loop-authoring` 作为 setup 的一步把它建出来或改好，经你批准后，再和其他流程一样拿来推荐。你批准之后，它就成为本项目的主任务流程，记在 `.contrejour/loop.json` 里。
3. **检查。** 对项目里的流程运行流程检查和角色检查。过期或有缺陷的流程脚本，由 `loop-authoring` 按不变的定义重新生成，再检查一次。
4. **交接。** 你会收到一份报告：目标、主任务流程及其取值、检查结果、怎样用 `loop-trial` 试运行、怎样开始工作，以及之后还可以做什么。然后 `project-cli.js finish-setup` 写入 `.contrejour/setup.json`：从此这个项目就算设置好了。

### 试运行流程

流程检查用假角色运行脚本：它能说明每一步都走得到、每个角色都存在，说明不了流程做的是不是你想要的。`loop-trial` 按真实运行的方式检查流程。任何流程都可以用它，正式工作之前或改完之后都行；它自己的那几步由 `loop-tester` 角色来做。

1. **静态检查。** 先运行流程检查和角色检查。过期或有缺陷的脚本按定义重新生成；还有缺陷，试运行就到此结束。
2. **试跑。** 用定义里为试运行声明的参数（`trial-args`）小规模地真跑一次。没有声明这些参数的流程，或者自己还要运行别的流程的流程，没法试运行：试运行结束，并说明原因。
3. **报告。** `loop-tester` 对照你的目标读这次运行做了什么，写进 `.contrejour/trials/<流程>/<轮次>.md`：每一步做了什么、产出了什么、哪里和你想要的不一样。
4. **你来判断。** 你读报告，判断流程做的事是否符合目标。符合就批准，试运行结束。
5. **改进。** 不符合就说明要改什么：`loop-authoring` 修改流程的步骤（草稿经你审核），`trajectory-optimizer` 根据这次试运行修复角色（在验证端是提案）。然后再试一次，总共最多 4 轮。

在 Studio 里，把流程放到画布上，点「运行」旁边的「试运行」：这时没有给目标，报告就对照流程自己的 Purpose 一节来判断，你在回复报告时再说你要什么。在会话里要写明目标：

```bash
claude --permission-mode bypassPermissions 'Run the loop-trial loop with args {"loop": "research-iteration", "goal": "<这个流程要达到什么>"}'
```

试运行是无人值守地真跑流程，所以和正式工作一样，要用不等人批准的权限模式（见[开始工作](#4-开始工作)）。目标写在启动会话的那条消息里，而流程里的角色都会收到这条消息，包括"空白"出想法角色，所以只写流程要达到什么，不要写任务该怎么解决。

这里的两个主任务流程情况不同：

- **`research-iteration`** 声明了 `trial-args: {"stage": "build", "trial": true}`。试运行的一轮到「构建」为止，不进入「提交」，所以什么都不会发给验证端，也不占用提交次数。但它在项目里做的是真实的工作，这些都会留下：wiki 条目、代码、commit 和 zip。
- **`submission-review`** 没有声明试运行参数，因为它要有真实的提交才能运行。试运行它，静态检查之后就结束，并说明原因。

### 流程需要你时

流程每次需要你时就停下来，会话给你看一份审核说明和一个问题：在终端里，或者，对 Studio 运行的流程来说，在 Studio 的对话里。你的下一句话就是回答，会话把它原样交给流程，流程从停下的地方接着运行。下面每一个决定都是这样做的，由流程里的 `owner-review` 这一步负责。（在流程里运行的角色自己没法问你：Claude Code 不给 workflow 里的 agent 向人提问的工具，所以由会话来传问题和回答。hook 会核对进入流程的每个回答，都是你在流程提出那个问题之后亲手输入、没有改动的消息。）

### 以后要改时

每一部分以后都可以单独改：

- **机器的配置**，比如验证条款、连接、某个 key 或环境：再运行一次 `configure`，在 Studio 里，或者用 `claude "Run the configure loop"`。工作流保持不变。
- **主任务流程或它的超参数取值**：在 Studio 里把流程放到画布上，打开「超参数」，设好取值，再点「设为本项目的主任务」；或者在项目里用命令行：

  ```bash
  node .contrejour/dist/tools/project-cli.js use --project . --loop <流程> --param <名字>=<取值>
  node .contrejour/dist/tools/project-cli.js show --project .
  ```

  每个不想用默认值的超参数写一个 `--param`：没写的都取默认值，而不是沿用之前选的值。`show` 显示项目当前运行什么。下一轮或下一次评审就用新的选择。
- **整个工作流**：再运行一次 `setup`。它从项目现在的状态出发，把四步再走一遍，机器的配置保持不变。

## 先设置验证机器

worker 的配置要从运行中的验证服务取回 `task.md`，所以验证端在前，一直做到服务运行起来：配置机器，设置工作流，启动服务。然后才配置 worker。

### 1. 运行 `configure`

安装、接受目录信任提示，然后运行验证端的 `configure`：在 Studio 里，从画布上方的流程列表里选中它，点「运行」；或者在会话里：

```bash
cd /path/to/validator-project
claude "Run the configure loop"
```

会话以 `validator-task-manager` 身份运行，由它运行这个流程。流程的步骤就是下面第 2 到第 5 步。每个决定都以审核说明加问题的形式交给你，做法见[流程需要你时](#流程需要你时)。

### 2. 说明需求，写好任务

配置从你的需求开始：这台机器要验证什么。说清楚交付物要做到什么、用什么来评判、worker 有多少次提交机会，以及评审的运行方式有没有特殊要求。流程会问你要这些，缺什么再追问什么。

项目根目录的 `task.md` 就是全部任务，也是 worker 能得到的唯一任务说明：服务通过 `task` 工具原样交出它，之后的修改会在 worker 下次取回时生效。如果还没有，`validator-config` 根据你的需求和 `.contrejour/templates/TASK_TEMPLATE.md` 写出它（UTF-8 文本）请你审阅，你批准后流程才继续。你自己写好的 `task.md` 保持原样，除非你要求修改。它写要构建什么，不写怎么测试。

### 3. 审阅配置表

审核说明以项目语言一次展示整张配置表：每个字段及其可选项、建议和未解决的问题。在一次回复中给出多项修改，或者直接编辑 `.contrejour/setup-draft.json` 再告诉它；`validator-config` 把你的回答改成对配置表的修改，刷新后你会再次看到整张表。建议只有在你接受后才成为取值。评审流程和它的超参数不在配置表里：它们归 `setup` 来定，在 `configure` 之后（第 6 步）。

| 字段 | 决定什么 |
| --- | --- |
| `project.name`、`project.language` | 项目名，以及配置表用 `zh` 还是 `en` |
| `environment.secrets` | 只放环境脚本需要的 key 和 token，形如 `{"NAME": "value"}`；没有就是 `{}`。主机、路径和命令写进环境段 |
| `validation.benchmark` | base 层，在 apply 时冻结：固定的来源和版本、数据版本和切分、完整样本数、指标，以及 setup、healthcheck、smoke、test 的 argv runner（写 `python` 而不是 `python3`，Windows 上也能运行）。从 `.contrejour/templates/TESTER_FACILITY_CONFIG_TEMPLATE.json` 和 `.contrejour/templates/README.md` 里的 runner 协议开始；`.contrejour/templates/tester-benchmark/` 是一个用 lm-evaluation-harness 的完整示例 |
| `validation.pass_rule` | 一个样本（即一个测试项）何时通过：逐样本的 `metric`、`op`（`>=`、`>`、`<=`、`<`、`==`）和 `threshold` |
| `validation.adapter_contract` | 你的 runner 如何调用适配角色 `adapter-writer` 为每次提交写的适配器 |
| `validation.runtime_environment` | 交付物在这里运行时可以依赖什么：操作系统、Python 和 CUDA 版本、GPU 和内存、网络访问、每个输入的时间。worker 通过 `requirements` 读到它，所以不能提及任何测试数据 |
| `validation.limits` | 计次提交数（默认 20）、同时进行的评审数（1）、上传大小、解压后的大小和文件数、上传地址有效期、审查时限（24 小时）、发现泄漏后反馈可重写的次数（3），以及一次评审可新增的测试项数（200） |
| `validation.hidden_paths` | 隐藏样本、标签和参考答案的绝对路径：泄漏审查角色拿反馈与它们比对，任何角色都不能写它们 |
| `validation.agent` | 评审会话怎么启动：`model`（`null` 表示用 Claude Code 的默认模型）、`permission_mode` 和 `claude_command`，见下文 |
| `validation.service` | 服务在哪里监听、worker 怎么访问：`host`、`port` 和 `public_url`，见[网络](#网络) |

`validation.agent.permission_mode` 取 `bypassPermissions`（默认），让 benchmark 和交付物文档里的安装步骤可以使用网络和项目之外的路径；或取 `auto`，由分类器审查每一步，可能拒绝其中一些。需要等人批准的模式不提供，因为没有人在场批准。

`validation.agent.claude_command` 是启动 Claude Code 的 argv，默认 `["claude"]`；不能运行 `--version` 时，配置表会报告问题。Windows 上 npm 安装的 `claude.cmd` 不经过 shell 无法启动：使用原生安装的 `claude.exe`，或 `["node", "<npm prefix>\\node_modules\\@anthropic-ai\\claude-code\\cli.js"]`。

`validation.service.port` 必须填写，因为服务总在一个固定端口上监听（默认 8765）。

如果验证机器已经以 `CONTREJOUR_URL`（服务根地址，不带 `/mcp`）和 `CONTREJOUR_TOKEN`（至少 32 个字符）提供了服务的地址和 token，配置直接使用它们：`public_url` 取自 `CONTREJOUR_URL`，在配置表里不能修改（要填别的地址，先取消这个变量）；apply 把 `CONTREJOUR_TOKEN` 作为服务 token，不再新建。这两个变量在流程运行时读取；修改任何一个之后，再运行一次 `configure`，重新审阅、确认、apply，然后重启服务。

### 4. 确认并 apply

配置表没有问题时，审核说明会给出它的 `configuration_sha256`。你批准这个版本，流程就确认并写入它。之后的任何修改，包括 `task.md`，都需要重新确认；提出修改不等于批准。

apply 随后：

- 运行 benchmark 的 setup、healthcheck 和 smoke 命令，冻结 base 层（`.contrejour/tester-config.json`）和验证条款（`.contrejour/validation/config.json`）；
- 在 `.contrejour/validation/token` 生成服务 token，或采用 `CONTREJOUR_TOKEN`；再次 apply 时保留 token，所以 worker 手上的那份仍然有效；
- 把 `environment.secrets` 写入 `.contrejour/environment.json`（权限 0600），并把 `.contrejour/` 加进 `.gitignore`，因为其中有凭据；
- 写入 `.claude/settings.json`：入口角色 `validator-task-manager`、hooks 登记，以及 `worktree.bgIsolation: "none"`，让后台会话可以直接修改 git 仓库里的文件，不必先建工作树。你的其他设置保持不变；
- 在 `CLAUDE.md` 中写入两段：`CONTREJOUR ROLE` 标记之间的角色段（每个验证端角色都遵守的规则），以及 `CONTREJOUR ENVIRONMENT` 标记之间的空环境段。文件其余部分不动。

apply 不碰评审流程，它由 setup 接下来再选。apply 返回 `service_command`（运行服务的命令）、`worker_connection`（`url`，即 `public_url` 加上 `/mcp`，以及 worker 的配置需要的 `token`）和 `from_environment`（用了 `CONTREJOUR_URL` 和 `CONTREJOUR_TOKEN` 中的哪些），此外还有写入的文件、入口角色，以及环境技能所在的目录 `environment_skill_dir`。

入口角色写在设置里而不是 `CLAUDE.md` 里，是因为每个角色都会读 `CLAUDE.md`。这个文件只放所有角色都必须知道的内容：本端的规则和本机的环境。

### 5. 环境、wiki 和报告

随后 `validator-config` 在真实机器上工作。它新建 `research-wiki/`，写好环境技能的脚本并把每个实际运行一次，再把每个角色都必须知道的本机情况写进环境段（见[经验放在哪里](#经验放在哪里)）。环境需要只有你知道的信息时，会问你。

配置最后写出它的报告：确认过的需求、apply 写入了什么、每个环境脚本及其实际运行是否通过、做不成的事及其真实错误、`worker_connection`，以及接下来做什么：先运行 `setup`，再用报告里的命令启动服务。

### 6. 设置工作流：选定评审流程

接着运行 `setup`：在 Studio 里，让画布上是 `setup`（如果还停在 `configure` 上，就从列表里选），点「运行」；或者运行 `claude "Run the setup loop"`。它在这里要定的，就是评审每次提交的流程。它根据你说的话和 `task.md` 定下目标，然后推荐合适的流程，通常是流程库里的 `submission-review`（见[一次提交怎么评审](#一次提交怎么评审)），并给出各个超参数的取值：

| 超参数 | 默认值 | 决定什么 |
| --- | --- | --- |
| `max_adapter_fixes` | 2 | 完整运行暴露的适配器问题最多交回 `adapter-writer` 几次 |
| `max_extension_rounds` | 3 | 一次评审最多找几轮问题、加几轮测试项；新增测试项的总数仍受 `limits.max_new_tests_per_review` 限制 |
| `max_leak_reviews` | 5 | 流程一次运行最多做几次泄漏审查；什么时候扣下反馈仍由 `limits.feedback_attempts` 决定 |

批准，或者说明想换哪些取值、哪个流程。如果这里的评审要按别的方式进行，就把要求说清楚：`loop-authoring` 作为 setup 的一步，在最接近的流程上构建，经你批准后，setup 再把它拿来推荐。服务对每次提交运行一次你选定的流程，参数是 `{submission_id, submission_dir, params}`。新流程要接受这些参数，并以 `validator-task-manager` 发布评审结果结束，验证方无法完成评审时则放弃这次评审。这样 worker 只能收到 finalize 发布的内容。你批准之后，流程和取值记在 `.contrejour/loop.json` 里。

### 7. 检查和交接

然后 setup 运行流程检查和角色检查（`loop-check.js check` 和 `roles`）：过期或有缺陷的流程脚本，由 `loop-authoring` 作为一步按不变的定义重新生成，再检查一次。

最后是交接，给你一份报告：目标、评审流程和它的超参数取值、检查结果和还要处理的问题、怎样启动服务，以及之后还可以做什么。到这里验证端的工作流就设置好了。这里没有试运行这一步：`submission-review` 要有真实的提交才能运行（见[试运行流程](#试运行流程)）。

### 8. 启动服务

在项目根目录运行 `configure` 报告里给出的服务命令，整个任务期间保持运行，例如放在终端复用器（tmux、screen）里，或作为系统服务（systemd、Windows 服务或计划任务）：

```bash
node .contrejour/dist/tools/validation-cli.js serve --project .
```

服务放在最后启动，因为两个流程定下的东西它都要用：`configure` 的 apply 写好的条款和 token（没有就拒绝启动，报 `VALIDATION_NOT_CONFIGURED`），以及 `setup` 选定的评审流程（没有就报 `LOOP_NOT_SELECTED`）。服务在启动时读取冻结的配置和 token，所以每次重新 apply 之后都要重启它。流程和超参数在每次开始评审时读取：换一个流程或改了取值，只影响下一次评审，不影响正在进行的评审。查看验证状态：

```bash
node .contrejour/dist/tools/validation-cli.js status --project .
```

通过私密渠道把 `configure` 报告里 `worker_connection` 的地址和 token 交给 worker 端的 owner。评审不用你启动：服务为每次提交启动一次。之后要改条款，再运行一次 `configure`，apply 之后重启服务；要改评审流程或它的超参数取值，见[以后要改时](#以后要改时)。

### benchmark 只增不改

base 层和通过规则在 apply 时冻结。一旦有提交按它们计了次，要改其中任何一项都只能新开一个验证端项目；配置表会把这种修改报告为问题。之后的测试项来自评审过程中的扩展角色 `test-extender`。每个测试项都从 benchmark 里已有的测试项派生（记下 `derived_from`、`variation` 和 `reference_check`），通过 `validation-cli.js extend` 登记为一个新层（`inc-001`、`inc-002`、…）的一部分。每一层是 helper 自有的 git 仓库 `.contrejour/validation/benchmark/` 中一个只新增文件的提交，helper 把 head 记在 `.contrejour/validation/benchmark-head`，并逐个提交检查历史。错了的层用 `validation-cli.js retire` 停用，这本身也是新增一个文件；层从不修改。冻结的 base 层、它的证据文件或层的历史有任何改动，服务都会停止；hook 还会拦截任何角色对 benchmark、冻结配置和隐藏数据的直接写入。

## 网络

worker 必须能访问 `public_url` 下的三个路径：`/mcp`（四个工具）、`/upload/…`（一次性上传地址，用 HTTP PUT 上传 zip）和 `/health`（返回 `{"status":"ok"}`）。有两种做法：

- **私网或 VPN 直连。** `host` 设为 `0.0.0.0`，`port` 设一个固定端口，`public_url` 设为 `http://<验证端地址>:<port>`。在验证机器的防火墙上放行该端口；Windows 上例如 `netsh advfirewall firewall add rule name="Contrejour validation" dir=in action=allow protocol=TCP localport=<port>`。
- **通过你自己运行的隧道或反向代理。** `host` 保持 `127.0.0.1`，这样服务只能经由它访问；让隧道或代理指向 `port`，`public_url` 设为它的地址。它可以把服务放在某个子路径下，此时 worker 的地址就是该地址加 `/mcp`。让它放行不超过 `limits.max_upload_bytes` 的上传。

Contrejour 不配置 DNS、隧道或代理。`CONTREJOUR_URL` 可以是 worker 能访问到的任何 http(s) 地址。在 worker 机器上运行 `curl <public_url>/health`，应返回 `{"status":"ok"}`。

验证机器不断网，因为有些任务的验证本身就要联网（安装依赖、调用外部服务）。作弊靠检查交付物的行为来发现，而不是靠切断网络。

## 一次提交怎么评审

worker 的任务管理角色调用 `submit`，拿到一次性上传地址，用 `curl.exe --fail-with-body -T`（Windows 之外用 `curl`）上传 zip。服务计算哈希并安全解压（拒绝 `../` 路径，限制总大小和文件数），检查 `USAGE.md` 是否位于根目录或唯一的顶层文件夹。格式不对的 zip 记为 `invalid`，不计次数：格式错误不该消耗 worker 的机会。

服务为每个收下的提交启动一个 Claude Code 后台会话，名为 `contrejour-review-<编号>`，以 `validator-task-manager` 身份运行，模型和权限模式取自 `validation.agent`。同时最多进行 `limits.max_concurrent` 个评审，其余排队。会话的提示词只有一句 `Run the <流程> loop with args {…}`，写明你选定的评审流程、提交、它的目录和流程的超参数：流程里的每个角色都会收到这句话的原文，所以里面不放任何别的内容。

任务管理角色先用 `loop-check` 检查流程。脚本过期或有缺陷时，它运行 `loop-authoring`，按不变的定义重新生成脚本，再检查一次；仍不通过就停止并报告。这一步在读取提交的任何内容之前进行，所以交付物里的任何东西都影响不了流程。然后它运行流程。默认流程 `submission-review` 的步骤是：

| 步骤 | 角色 | 做什么 |
| --- | --- | --- |
| 检查 | `inspector` | 在交付物的任何部分运行之前，阅读它的代码、脚本和配置，把作弊迹象写进 `inspection.md`：读取 benchmark 数据、内置答案、在评测时改变行为、针对上次反馈打补丁、写到自己的输出之外、安装步骤做了安装以外的事 |
| 适配 | `adapter-writer` | 按 `USAGE.md` 把交付物安装在提交目录里，按 `adapter_contract` 写适配器，在 smoke 子集上反复调试，直到适配器能正确调用它。照文档跑不起来，本身就是结论 |
| 回归 | `regression-runner` | 只在能运行时进行：跑 benchmark 的每个有效层，报告 helper 算出的计数。它从不改适配器：完整运行暴露出的适配器缺陷交回 `adapter-writer` 修，然后各层重跑，最多 `max_adapter_fixes` 次 |
| 扩展 | `test-extender` | 只在回归完整之后进行：继续找问题，从已有测试项派生新测试项（需要时调研外部测试方法），登记为新的一层并在这次提交上运行。新测试项还在发现问题时继续，最多 `max_extension_rounds` 轮 |
| 结论 | `verdict-writer` | `valid`、`cheating` 或 `unusable`，以及对实际问题的反馈 |
| 泄漏审查 | `leak-reviewer` | 从全新的上下文出发，拿反馈快照逐条比对全部隐藏测试。发现泄漏就退回 `verdict-writer` 重写，次数以 `limits.feedback_attempts` 为限；允许的重写全部仍有泄漏时，只发布结论和计数 |
| 发布 | `validator-task-manager` | 运行 `finalize`。此后 worker 的 `query` 才能看到结果 |
| 记录 | `validator-memory` | 只根据已发布的结果，在 wiki 里记下这次提交解决了哪些问题、哪些仍在 |
| 优化 | `trajectory-optimizer` | 读这次评审的轨迹，写出修复验证端角色的提案，你在 `proposal-review` 里接受后才生效 |

`adapter-writer` 或 `regression-runner` 遇到验证端自己修不好的故障时（本机缺少 `runtime_environment` 承诺的东西，或 helper 出错），交付物根本没有被公平地测过。这时任务管理角色用 `validation-cli.js abandon` 放弃这次评审：提交记为 `failed`，不计次数，worker 可以立即重新提交。worker 只看到验证方未能完成评审；具体原因留在本机这次提交的记录里，会话会报告需要修复什么。

结论只决定结果算不算数。每个测试项是否通过，由 helper 按冻结的通过规则，从 runner 的逐样本输出算出；交付物答错或崩溃的测试项算失败。发布的只有测试项总数、通过数和失败数，从不发布分数，也不比较不同提交的结果：benchmark 一直在长，重要的是还剩哪些问题。结论是 `cheating` 时，所有测试结果作废。

反馈必须写出实际问题：交付物错在哪里、违反 `task.md` 的哪项要求、大致多常见、多严重，以及之前的问题哪些解决了、哪些还在。它可以说明测试是怎样构造的，因为方法本身不含任何用例，但绝不能透露实际测试：输入、参考答案、实际输出、样本或测试项 id、单项结果、某一层有多少测试项、隐藏文件名和路径、从测试数据中摘抄或改写的文字，以及和真实测试项近似到足以充当它的例子。泄漏审查角色的独立性由流程保证：启动它的是固定的脚本，结论角色既改不了脚本，也决定不了审查角色收到什么，审查角色每次都从全新的上下文开始。helper 把每次审查绑定到它所读反馈的摘要上，改过的反馈必须重审；只有对这份文字本身的审查通过，`finalize` 才发布反馈。

### 评审会话停下时

评审会话可能在发布之前停下：崩溃了、回合提前结束了，或在等一个没人会给的回答。这样 worker 就会白等，所以服务看护每一个评审会话。会话在提交未完成、也没有流程在运行时停下，它的 Stop hook 会立即通知服务；此外服务每分钟检查一次每个会话。它从不打扰正在工作的会话。停下的会话有两分钟的宽限期，hook 已经报告时没有宽限。之后，如果会话的进程还在，服务先停止它，再恢复这个会话，只附上继续这次评审开始时所用流程的提醒，不带其他选项：只有先停止、再这样恢复，Claude Code 才会在原会话上继续，否则会另开一个副本。任务管理角色恢复自己上次运行的流程，已完成的步骤会立即返回，各角色也会保留已经做完的工作。提醒的间隔越来越长，至少相隔 10 分钟、30 分钟，之后 60 分钟，所以长时间的运行不会被频繁打扰。会话被删除或无法继续时，服务把提交标为 `failed`：不计次数，worker 也不必等到审查时限。到了 `limits.review_timeout_minutes` 仍未完成的评审，同样记为失败。

### 查看评审

- `claude agents` 列出本机的会话及其状态；`claude attach <编号>` 实时查看某个会话，并可以接管；`claude logs <编号>` 显示它最近的输出。
- `node .contrejour/dist/tools/validation-cli.js status --project .` 显示服务状态、已计次和剩余的提交、各层，以及每次提交的状态、结论和测试项计数；加 `--submission <编号>` 查看某一次的完整信息。
- 服务自己的输出会说明它何时启动、提醒了评审会话，或将其记为失败。
- `.contrejour/trajectories/` 里是每个角色的过程记录，`.contrejour/proposals/` 里是对角色的修改提案。要处理待定的提案，在 Studio 里运行 `proposal-review`，或者在项目里运行 `claude "Run the proposal-review loop"`：你会看到每个提案的依据和具体修改，你接受的会被应用，每个提案的结果都会记下。
- Studio 的运行记录页和流程页面（见[查看流程](#查看流程)）都列出每次评审对 `submission-review` 的运行：哪些角色完成了、什么时候、对应哪次提交。

## worker 机器

确认验证端的服务正在运行，并拿到了它的 `worker_connection`：在这台机器上运行 `curl <public_url>/health`，应返回 `{"status":"ok"}`。然后配置 worker，设置工作流，想试就试运行一次，再开始工作。

### 1. 运行 `configure`

安装、接受目录信任提示，然后运行 worker 端的 `configure`：在 Studio 里，从画布上方的流程列表里选中它，点「运行」；或者在项目里运行 `claude "Run the configure loop"`。它不会开始研究。

worker 的配置表包括 `project.name`、`project.language`、`environment.secrets`、`connection.url`（`worker_connection` 的地址，以 `/mcp` 结尾）和 `connection.token`。连接信息填进配置表后，`worker-config` 用 `config-cli.js fetch-task` 从验证端逐字节取回 `task.md`；不要手工编写或复制它。你确认审核说明给出的摘要时，取回的任务也在确认范围内。

apply 先核对 `task.md` 是否仍与验证端一致：如果在你审阅之后验证端改过任务，apply 以 `TASK_CHANGED` 停止，流程会重新取回任务，再请你确认配置表。随后 apply 把 `environment.secrets` 写入 `.contrejour/environment.json`（权限 0600）；把 `contrejour` 服务写入 `.mcp.json`，只替换这一项；把 `.contrejour/` 和 `.mcp.json` 加进 `.gitignore`，因为其中有凭据；写入 `.claude/settings.json`，包括入口角色 `worker-task-manager`、hooks 登记和 `worktree.bgIsolation: "none"`；并在 `CLAUDE.md` 中写入角色段和空的环境段。之后 `worker-config` 新建 `research-wiki/`，写好环境技能的脚本并把每个实际运行一次，写入环境段（只有你知道的信息会问你，比如主机、配额、它找不到的路径）。配置最后写出它的报告：apply 写入了什么、每个脚本的实际运行情况和未完成的事；开始工作之前这台机器还需要什么，也就是批准 `contrejour` 服务、用不等人批准的权限模式（见[开始工作](#4-开始工作)）；以及接下来做什么。

### 2. 设置工作流：选定流程

接着运行 `setup`：在 Studio 里，让画布上是 `setup`（如果还停在 `configure` 上，就从列表里选），点「运行」；或者运行 `claude "Run the setup loop"`。它根据你说的话和 `task.md` 定下目标，然后推荐这台机器要运行的流程，通常是流程库里的研究流程 `research-iteration`（见[一轮做什么](#一轮做什么)），并给出各个超参数的取值：

| 超参数 | 默认值 | 决定什么 |
| --- | --- | --- |
| `informed_ideators` | 3 | 每轮读 query pack、wiki 和最新结果的出想法角色个数 |
| `failures_only_ideators` | 1 | 每轮只看无效想法及其做法的出想法角色个数 |
| `blank_ideators` | 1 | 每轮只看任务和问题的出想法角色个数 |
| `ucb_c` | 1 | 给想法排序时探索奖励的权重；为 0 时只按潜力×可行性排序 |

这台机器怎样做验证端的任务，就由这个选择决定。批准，或者说明想换哪些取值、哪个流程。想换一种工作方式，比如比多轮探索更窄的工作，或者对做法有限制，就把要求说清楚，`loop-authoring` 会在最接近的流程上构建，经你批准后才装进项目。无论选定哪个流程，都由 `worker-task-manager` 运行，也只有它能访问验证服务。

然后 setup 像在验证端一样检查流程并交接：目标、流程和它的取值、检查结果、怎样试运行、怎样开始工作，以及之后还可以做什么。到这里 worker 的工作流就设置好了。

### 3. 想试的话，先试运行

正式开始之前，可以用 `loop-trial` 试一下这个流程（见[试运行流程](#试运行流程)）：在 Studio 里把 `research-iteration` 放到画布上，点「试运行」，或者在会话里运行。试运行走完一轮里到「构建」为止的部分，在「提交」之前停下，所以不占用提交次数，然后由你判断它做得对不对。它做的工作，以及改好的地方，都留在项目里，正式的几轮接着往下做。

### 4. 开始工作

运行主任务流程：在 Studio 里把它放到画布上，点「运行」；或者在项目里打开一个新的 Claude Code 会话：

```bash
cd /path/to/worker-project
claude --permission-mode bypassPermissions "start"
```

流程无人值守地运行，所以会话要用不等人批准的权限模式：默认模式下，它在第一条命令就会停下等批准。`bypassPermissions` 让实验可以使用网络和项目之外的路径；`auto` 由分类器审查每一步，可能拒绝其中一些。Studio 启动的会话用 `bypassPermissions`，除非启动 Studio 时加了 `--permission-mode auto`。

会话以 `.claude/settings.json` 里的入口角色 `worker-task-manager` 身份运行，并加载 `.mcp.json`；Claude Code 询问时，批准 `contrejour` 服务。Studio 启动的会话在后台运行，没有人在场批准，所以打算从 Studio 开始工作的话，先在 `configure` 完成之后，于项目里打开一次 `claude`，批准这个服务。会话按你选定的取值运行主任务流程。第一句话里不要放别的内容：流程里的每个角色都会收到启动它的那条消息，包括只该看到任务和问题的"空白"出想法角色。

让这个会话一直运行。它会自己一轮接一轮地运行，只有任务结束时才再需要你。你可以随时问它状态（Studio 启动的会话，用对话里给出的编号运行 `claude attach <编号>`）：它根据台账和 `query`，报告每次提交的状态、结论、测试项通过数与总数、想法和针对的问题、commit 和 zip，以及已用和剩余的次数。

### 一轮做什么

每一轮开始前，任务管理角色重新取回 `task.md`（验证端的修改在这里到达 worker），并调用 `query`。第一轮之前、以及每次结果为 `invalid` 或 `unusable` 之后，它会重新读取提交要求。它每轮还读取 `.contrejour/loop.json`，所以换了流程或改了取值，下一轮就生效。然后运行流程。默认流程 `research-iteration` 的步骤是：

1. **选题。** 选题角色 `problem-selector` 根据 wiki 的 query pack 和最新结果，选出一个或多个未解决的问题（`[regressed]` 优先），列出已被证明无效的想法，并调研 wiki 中还没有的已有工作；`worker-memory` 记下这些调研。
2. **出想法。** 出想法角色（按默认超参数共五个）同时各提一个想法，各自能看到什么由它们的工具清单保证。`ideator-informed`（默认三个）读 query pack、wiki 和最新结果；`ideator-failures-only` 只拿到无效的想法以及每个的做法；`ideator-blank` 只拿到任务和问题，没有读文件的工具。多轮之后，知情的视角会越收越窄，后两个保证每一轮都有跳出它的候选。
3. **排序。** 评估角色 `idea-assessor` 去掉重复无效想法的候选，给其余的评估潜力和可行性（0–1），并按新证据给以前轮次留下的待定想法重新打分。`worker-memory` 把它们记为待定想法，用 `rank_ideas` 对整个候选池排序：潜力×可行性，加上一个探索奖励（权重是 `ucb_c`），同一方向已实测的想法越多，奖励越小。没选中的想法留在池里，下一轮继续竞争。
4. **构建。** 实现角色 `implementer` 实现得分最高的想法，通过环境技能的脚本运行实验（每个实验独立命名，可以同时跑多个），提交 commit，按提交要求构建带 `USAGE.md` 的 zip，并逐项检查。每次提交对应一个 commit。如果做不出可提交的版本，`worker-memory` 把原因记在这个想法上，它不会原样再被选中，这一轮结束。
5. **提交。** `worker-task-manager` 调用 `submit`，上传 zip，在台账里记下这次提交：commit、zip、想法和针对的问题。

随后任务管理角色在后台等待（`worker-cli.js wait`），直到结果发布，会话被唤醒。已发布的结果不会再变，所以它被原样存进 `.contrejour/results/`，供不能访问服务的角色读取。然后：

6. **记录。** `worker-memory` 记下结论和从结果中复制来的测试项计数，把想法标为有效或无效，把反馈指出的每个问题记为 problem。`invalid`、`expired` 和 `failed` 不计次，原因交给下一轮。
7. **优化。** `trajectory-optimizer` 读这一轮的轨迹，在 worker 的角色暴露出问题的地方修复它们。

## 任务结束

通过全部现有测试项不会结束任务，因为验证端还会继续加测试项。`query` 报告 `closed` 时任务才结束：计次提交已经用完，也没有正在进行的评审。

任务管理角色随后报告最终统计，以及你还可以把哪些内容贡献给共享流程库、怎么做（见[哪些内容会离开项目](#哪些内容会离开项目)），然后停止。验证端用 `status` 查看同样的状态。

## 哪些内容会离开项目

项目里的东西不会自己离开项目。项目做的改进留在项目里：`trajectory-optimizer` 在项目里修复角色，worker 端直接改、每处修改一个 commit，验证端写成提案、你在 `proposal-review` 里接受后才生效；你修改或新增的流程和角色也归项目所有。什么都不会自动发到任何仓库。

要不要往外送，由你决定，靠的只是一个流程：`library-contribution`。它列出项目安装以来新增或改动的流程和角色，由你选择哪些送出；选中的全部送到共享流程库 agent-loop-community，合成一个 PR，由它的维护者审核合并。

什么时候运行由你决定，只要有一个任务完成就可以，之后有了新内容还可以再运行。任务完成指的是有一次提交完成：走完评审、结果已发布（`invalid`、`expired`、`failed` 不算，试运行也不算）。不必等整个任务结束。第一次有提交完成时，worker 的任务管理角色会告诉你；任务结束时，它还会告诉你还可以贡献什么。两端都一样，在 Studio 里运行，或者在项目里运行：

```bash
claude "Run the library-contribution loop"
```

会话运行流程并替你传话：

1. **列清单。** `library-contributor` 列出可以送出的内容，并逐个文件给出判断：别的项目用不用得上，会不会透露本项目的东西。只考虑项目安装后新增或改动的文件：安装器把放入的内容在 `.contrejour/seeded/` 留了一份副本，所以你没动过的文件绝不发送，不管流程库后来变了多少，送出去的东西也就不会改回别人的改进。改动过的文件要和共享流程库里的版本做三方合并：改在不同位置的，合并两边；两边改了角色的同一处，或者两边都改了某个流程（流程的脚本是根据定义生成的），这一项先留下，并说明怎么处理。不合 Contrejour 流程或角色格式的文件（比如你自己的 agent）留在项目里。含本项目密钥或 token、隐藏路径或注入模式的文件直接拒绝。本机路径和只有本项目用得上的内容会指出来，由你决定。清单还列出流程检查和角色检查在结果里发现的问题。
2. **验证端的检查。** 在验证端，送出之前要先运行验证端自己的 `contribution-check`（[`library/loops/validator/contribution-check.md`](library/loops/validator/contribution-check.md)）：`leak-reviewer` 从全新的上下文出发，拿要发出的这批文件和隐藏测试逐一比对，把结论记在这份清单的摘要上。没有通过，什么都发不出去。它代替框架的 `contribution-check`（框架的那个是请你自己把这些文件读一遍）；worker 端的清单不需要这项检查。
3. **审核。** 你审核一次清单（`owner-review` 这一步），决定送出什么：你会看到每个流程和角色及其判断和提醒、没选中的内容及原因，以及检查结果。说明要去掉或放回什么，你会看到新的清单。批准就发送这份确切的清单；只有检查没有发现问题（验证端还要泄漏检查通过）时才能批准。你批准之前，什么都不会推送。
4. **发送。** `library-contributor` 只发送你批准的内容，作为一个 PR 发到共享流程库。它从该库的最新版本新开分支 `library/<项目>-<端>-<yyyymmdd>`，写入批准的文字，然后提交、推送并开 PR；对仓库没有写权限就走 fork。本地仓库当前的分支和改动保持不变，用过的工作副本会清理掉。你批准之后内容如果又有变化，helper 会拒绝发送；再运行一次流程，审核新的清单。

项目改过的框架基础流程和角色也可以送出。到了共享流程库，它们会在带着这个库的项目里替代框架原版：安装项目时，项目包自己的流程或角色优先，其次是共享流程库的，最后才是框架的。

这个流程通过 helper `library-cli.js` 工作：`plan`、`clone`、`record-check` 和 `contribute`。只想看看能送出什么、不真的发送，可以运行 `node .contrejour/dist/tools/library-cli.js plan --project .`。研究任务另加的规则，比如什么算任务完成、验证端的检查，写在 [`skills/shared-references/project-rules.md`](skills/shared-references/project-rules.md) 里。

推送到 GitHub 和开 PR 需要已登录的 GitHub CLI（`gh auth login`）。没有它时，如果你的 git 凭据允许，分支仍会推送，并给出地址让你自己开 PR；推送不了，提交就留在那个本地仓库里，结果会说明缺什么。从归档安装的项目没有本地仓库：流程会问你要不要取一份共享流程库；也可以在安装时传 `--library PATH`。贡献出去的流程或角色，由它的 `side` 决定共享流程库把它交给哪些项目：`framework` 交给所有项目，`worker` 或 `validator` 只交给那一端的项目。新角色要是任何项目都用得上，清单会指出来，由你决定是否把它的 `side` 改成 `framework`。

## 经验放在哪里

经验放在用到它的地方，由负责它的角色写入：

| 种类 | 位置 | 写入方 |
| --- | --- | --- |
| 研究知识：每个问题上已有工作做了什么、试过哪些想法和实验、哪些有效 | `research-wiki/`，每台机器一份 | 只有记忆角色（`worker-memory`、`validator-memory`），通过 `research-wiki.js` |
| 本机的事实和经验 | `CLAUDE.md` 的环境段 | 配置角色（`worker-config`、`validator-config`）写初始内容，之后只有记忆角色 |
| 每次都一样的固定操作 | 环境技能 `<项目>-environment` 的脚本 | 配置角色写初始内容，之后由记忆角色补充 |
| 一个角色怎么做它那一步 | `.claude/agents/` 里它的文件 | `trajectory-optimizer`；验证端只能通过你在 `proposal-review` 里接受的提案；新角色通过 `role-authoring` |
| 运行哪些角色、按什么顺序 | `.claude/loops/` 里的流程定义 | `loop-authoring`，只按你的要求 |

**研究 wiki。** 用 survey、idea、experiment、claim、problem 五类节点和证据边，按问题记录已有工作做了什么、试过什么、哪些有效、哪些无效。每一轮从 query pack 开始，那是一份不超过 1000 字符、带节点引用的摘要；细节留在各页面里。验证端的 wiki 记录各次提交暴露的问题、每次提交解决了哪些、哪些仍在，以及调研过的测试方法。它不含任何测试内容，因为 `validator-memory` 只依据已发布的结果和公开来源工作；哪些层针对哪些问题记录在 benchmark 的 `registry/` 里，不在 wiki 里。通过 `research-wiki` 技能、它的命令行或 Markdown 页面阅读 wiki。

**环境段。** 每个角色都读 `CLAUDE.md`，包括"空白"出想法角色，所以这一段只写环境：机器和 SSH 别名；代码、数据、checkpoint、结果和日志路径；环境名及激活方式；资源及其限制；指标输出到哪里；验证过的坑。每行一条验证过的事实，不超过 8000 字符；研究结论留在 wiki 里。`node .contrejour/dist/tools/config-cli.js environment --project .` 可以查看它。

**环境技能。** `.claude/skills/<项目>-environment/` 把固定操作写成 Bash 脚本（同步代码、准备环境、启动命名实验、检查、取回日志和结果、停止；验证端还有例如检查一次运行所需的 GPU、内存和磁盘），每个脚本写好时都实际运行一次。每次运行有自己的名字、日志和结果路径，所以可以同时跑多个实验。在验证端，`validator-memory` 还会把评审中写出的可复用测试工具加进来，前提是它核实过其中不含测试内容。key 和 token 从 `.contrejour/environment.json` 读取，从不写进脚本。脚本用到的工具，例如 SSH、rsync、conda 或容器运行时，不在安装包里。

**角色。** worker 每一轮、validator 每一次评审之后，`trajectory-optimizer` 读每个角色做了什么，按该角色自己的 Evaluation 一节评估它，在问题重复出现或明显影响了结果的地方，对角色文件做一处小修改。在 worker 端，每处修改单独提交一个 commit，任何一处都可以撤回。在验证端，它只把提案写进 `.contrejour/proposals/`，你在 `proposal-review` 流程里接受后才生效：验证端的轨迹里有隐藏测试和 worker 写的文字，这两样都不能混进角色。两种情况下，修复都留在项目里。试运行也可以要求做这类修复（见[试运行流程](#试运行流程)）。

**流程库。** 项目做的改进留在项目里。你选定要贡献的流程和角色，新增的和改动的都算，会送到共享流程库（见[哪些内容会离开项目](#哪些内容会离开项目)），下一个项目就可以从这个项目学到的东西开始。这取代了早期版本跨项目的 `Experience.md`。

## 修改流程和角色

修改流程和角色也通过流程进行，每次都经你审核。最方便的入口是 Studio 的对话（见 [Studio](#studio)）；在会话里，用 `claude "Run the <流程> loop"` 运行其中一个，并说明你要什么，任务管理角色运行它并替你传话。换一个主任务流程，或者改它的超参数取值，不需要改任何流程：在 Studio 里或用 `project-cli.js use` 重新选即可（见[以后要改时](#以后要改时)）。

- **`loop-authoring`** 按你的描述新建或修改流程。先由 `loop-query` 在本项目和它的各个流程库里找可以作为基础的流程；如果已有流程恰好就能做你要的事，会先问你是否直接用它。然后 `loop-editor` 在最接近的流程上构建新流程，保留它做得好的部分，只改你要求改的（只有你要求时才从头写）；缺的角色由 `role-creator` 以最接近的已有角色为基础补上。所有内容先放在 `.contrejour/drafts/` 里并通过检查；你会看到流程定义、脚本、新角色以及和基础流程的区别，只有你批准的那个版本才会装进项目。运行中的流程不会改自己，其他流程也不改流程。
- **`role-authoring`** 按你的描述（在哪一步做什么、收到什么、交出什么、能读写什么、怎样算做得好）新建或修改角色。`role-creator` 先在本项目和它的各个流程库里找已经能做这件事的角色，有合适的就先问你是否直接用；没有就以最接近的角色为基础构建（只有你要求时才从头写），检查后装入你批准的版本。需要一个没有角色负责的步骤时，就加一个角色，而不是加一段不属于任何角色的代码。
- **`loop-trial`** 按真实运行的方式试运行流程，并在两次试运行之间把它改好（见[试运行流程](#试运行流程)）。
- **`library-contribution`** 把你选定的流程和角色（新增的和改动的）送到共享流程库（见[哪些内容会离开项目](#哪些内容会离开项目)）。
- **`proposal-review`**（验证端）把 `trajectory-optimizer` 提出的角色修改交给你，应用你接受的那些。

想问哪个流程适合某项工作，或者某个流程做什么，可以直接问 `loop-query`：`claude --agent loop-query "<你的问题>"`。

流程做什么，以定义为准；脚本是它的可执行副本。脚本末尾记有它所依据的定义的摘要，所以定义一改，就能看出脚本过期了。脚本只能调用角色、把另一个流程当作一步运行（只嵌套一层）、根据角色的结构化输出决定顺序、并行和分支、在角色之间传递输入、在固定上限内循环，以及在 `owner-review` 这一步停下等你。它不能在提示里写一步怎么做（这只写在角色的文件里，`trajectory-optimizer` 才能修复），不能用代码干活，不能调用 `loop-editor` 或 `role-creator`（只有 `loop-authoring` 和 `role-authoring` 能），也不能使用当前时间或随机数，否则会破坏续跑。流程检查不调用模型，用假角色把每个脚本运行几遍，每遍给出不同的假回答，以走到每一个分支：

```bash
node .contrejour/dist/tools/loop-check.js check --project .
```

它报告未知或未指定的角色、未知的子流程和嵌套超过一层的子流程、对当前时间或随机数的使用、停不下来的循环、未声明的阶段、任何回答都走不到的角色、未知的 `kind` 或触发动作，以及比定义旧的脚本。流程的 `kind` 写明它的用途：`task` 是项目的工作，由你选作主任务流程；`setup` 是设置项目工作流的流程；`on-request` 在你要求时运行。

hooks 负责每次某个事件发生都必须做的事。安装器在 `.claude/settings.json` 里登记它们，所以从你运行的第一个流程起它们就在把关；选定主任务流程、apply 配置时还会重新登记。全部交给 Contrejour 的 hook helper。它们只做记录、通知或拦截，执行哪些动作写在流程定义里（`triggers`）：

- `record-trajectory`：角色结束时，把它的过程记录复制到 `.contrejour/trajectories/`，并记下所属的会话、流程和提交。Claude Code 自己的记录放在你的用户目录下，默认 30 天后清理，格式也随版本变化，所以要复制一份。轨迹只留在本机。
- `notify-stopped-review`（验证端）：评审会话在提交未完成时停下，就通知服务。
- `guard-protected-paths`（验证端）：拦截对 benchmark、其冻结配置、隐藏数据、只能由 helper 写入的文件，以及只能由你修改的 `.contrejour/loop.json` 的写操作。
- `guard-owner-answers`：每个流程启动前，核对会话带进去的每个回答都是你在这个会话里、在流程停在那个审核点之后亲手输入的一条消息，逐字完整；不是就拦下这次运行。核对过的回答记在 `.contrejour/reviews/answers/`，人审核角色只认这里的记录。

## 查看流程

不翻文件也能看清项目里的流程：打开流程页面。它只读，Studio 能看到同样的内容，还能在上面操作。

```bash
node .contrejour/dist/tools/loop-view.js --project .
```

它会打印一个地址，默认是 `http://127.0.0.1:8780/`（`--port` 可以换端口），用浏览器打开即可。每个流程会显示：用途，以及每一步由哪些角色来做，流程停下等你决定的步骤会单独标出；超参数，本项目的取值和默认值并排；它调用的角色；脚本是否通过流程检查；以及轨迹索引里最近的几次运行：每次有哪些角色完成、什么时候、对应哪次提交。流程按 `kind` 分组，本项目的主任务流程会标出来；各流程库里有、本项目没有的流程也会列出。点开一个角色，可以看到它的文件内容和用到它的流程。点 **刷新** 会重新读取文件，界面可以在中文和英文之间切换。

这个页面只读：它读流程和角色文件、选定的流程及其超参数、轨迹索引，从不读过程记录、wiki、benchmark 或隐藏数据；它什么都不改，也不从网络加载任何东西；没有哪个角色会运行它。它只在本机地址上响应。要从另一台机器看，先转发端口，例如 `ssh -L 8780:127.0.0.1:8780 <机器>`，再在那台机器上打开 `http://127.0.0.1:8780/`。加 `--out loops.html` 则把同样的页面写成一个文件，不用启动服务也能打开。在验证端，这个页面会显示提交是怎么被评判的：页面和从它写出的文件都不要给 worker 那边。

## Studio

Studio 是你在本机浏览器里管理项目的控制台：它和你一起设置新项目的工作流，把每个流程画成流程图，按你的描述找出相近的流程，在对话里和你一起改，把其中一个连同你定的超参数设为本项目的主任务流程，运行项目里的流程并把它们的问题转给你，还能在正式工作之前真跑一次、试运行流程。

```bash
node .contrejour/dist/tools/studio.js --project .
```

它会打印一个登录链接，在浏览器里打开一次即可。这个链接只能让一个浏览器登录，只保存在 Studio 的内存里、不写进任何文件，所以本机上的 agent 没法借它冒充你；需要新链接就重启 Studio。和流程页面一样，Studio 只在本机地址上响应（默认端口 8790，`--port` 可以换）。要在别的机器上用，先用 `ssh -L 8790:127.0.0.1:8790 <机器>` 转发端口，再在那台机器上打开登录链接；两边的端口号要一致，因为 Studio 只应答发给它自己地址的请求。

- **设置工作流。** 还没设置的项目，一打开画布上就是它的 `setup` 流程（见[setup 的四步](#setup-的四步)）。点「运行」；每次需要你决定时，审核说明和问题都会出现在对话里。项目设置好之后，Studio 打开时画布上就是它的主任务流程。在这两台机器上，`configure` 要先运行：在画布上方的流程列表里选中它，运行完再运行 `setup`（见[步骤的顺序](#步骤的顺序)）。
- **说你想要什么。** 在对话框里描述你需要的流程。Studio 马上列出本项目和它的各个流程库里相近的流程，每个都能预览它的流程图，并把最接近的放到画布上。可以换一个，也可以原样使用。
- **画布**上是流程的各个步骤、每一步由哪些角色来做、同时进行的角色分组、停下等你决定的步骤（橙色），以及箭头：去下一步、按条件跳到后面、回到前面的步骤（虚线）、提前结束。流程的超参数排在右侧，用虚线连到它们影响的步骤。点一个步骤可以看它的完整说明。
- **用一句话改。** 点画布上的步骤、箭头或参数来引用它们，再说要怎么改；你不需要指定变量或角色之间的接口。Studio 会在后台的 Claude Code 会话里、以任务管理角色的身份运行 `loop-authoring`，并显示当前是哪个角色在工作。创建流程的角色以画布上的流程为基础起草修改、补上需要的角色、检查草稿，然后停下请你审核：草稿画在画布上，可以和原流程切换着看，审核说明显示在对话里。你可以批准、取消，或者继续说还要怎么改。你的回复会原样交给流程，`guard-owner-answers` 像核对终端里输入的回复一样核对它；只有你批准的那个版本才会装进项目。
- **设为主任务流程。** 「超参数」列出流程的各个超参数及其默认值和取值范围。设好取值，点「设为本项目的主任务」：流程和这些取值写进 `.contrejour/loop.json`，下一轮或下一次评审就用它们。只有 `task` 类的流程能设为主任务流程。项目里还没有的流程库流程，会先连同它需要、而项目里还没有的角色一起复制进项目，从此归项目所有。
- **运行流程。** 在画布上方的流程列表里选中项目里的某个流程，「运行」就在一个后台 Claude Code 会话里、以任务管理角色的身份运行它：`configure`、`setup`、`library-contribution`、验证端的 `proposal-review`，或者 worker 端的主任务流程（验证端的评审由服务按提交逐次启动）。画布上会标出正在进行和已经完成的步骤。流程停下等你决定时，审核说明和问题显示在对话里，你的回复会原样交给流程。
- **试运行流程。** 「运行」旁边的「试运行」用 `loop-trial` 试跑画布上的流程（见[试运行流程](#试运行流程)）：先静态检查，再小规模真跑一次，然后把报告放到对话里请你判断；你说要改的地方，下一次试运行之前就改好。除了 `setup` 和 `loop-trial` 本身，项目里的每个流程都有这个按钮。
- **角色和运行记录。** 角色页显示每个角色的文件内容和用到它的流程，也可以在对话里通过 `role-authoring` 修改某个角色或新建角色；运行记录页显示每个流程在轨迹索引里的运行。

Studio 启动的会话无人值守，所以默认用 `--permission-mode bypassPermissions`；启动 Studio 时加 `--permission-mode auto` 则改用 auto 模式。`--model` 指定这些会话的模型，`--claude` 指定它们运行的 Claude Code 程序（Windows 上用原生的 `claude.exe`：npm 安装的 `claude.cmd` 不经过 shell 无法启动）。对话里会给出会话编号，用 `claude attach <编号>` 可以实时查看。Claude Code 只在它信任的目录里启动后台会话，所以先在项目里打开一次 `claude` 并接受信任提示。

## 升级或修复

更新本地仓库并重新构建，然后用相同的端和项目重新运行安装器：

```bash
cd /path/to/auto-dl-loop
git pull
git submodule update --init         # 把框架和共享流程库切到本项目包固定的版本
npm ci                              # 仅当 package-lock.json 变化时
npm --prefix agent-loop-studio ci   # 仅当 agent-loop-studio/package-lock.json 变化时
npm run build:framework
npm run build
bash distribution/install-contrejour.sh --role worker --project /path/to/project --dry-run
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

安装器根据当前仓库生成并校验一个临时文件包，补回缺失的文件，更新 helper、运行依赖、模板和装好的技能，删除包里已移除的文件。其中任何一个有本地修改，更新都会在写入之前停止：保存你的修改，再加 `--force` 重新运行以替换它。放入项目的流程和角色保持项目里的版本，列在 `kept_project_versions` 下。想用流程库里更新的版本，先删除项目里的那份（流程要同时删除定义和脚本），再运行安装器。`task.md`、wiki、benchmark、提交记录、配置的草稿和状态、`.contrejour/loop.json` 里选定的流程、表示项目已设置好的 `.contrejour/setup.json`、`.contrejour/environment.json` 和环境技能都不会被动；`.claude/settings.json` 里，安装器只重新写入它的 hooks 和入口角色。

已经配置过的机器，重新运行 `node .contrejour/dist/tools/config-cli.js apply --project .` 来更新 `CLAUDE.md` 的角色段和设置；配置没变时，原来的确认仍然有效。Claude Code 在会话开始时读取角色和技能，所以之后要打开新会话，并重启 Studio。验证端要重启服务，让它运行更新后的 helper。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 安装器：本地运行时不完整，或 `npm run build` 要求先构建框架 | 本地仓库还没准备好：在里面运行 `git submodule update --init`、`npm ci`、`npm --prefix agent-loop-studio ci`、`npm run build:framework` 和 `npm run build`，再运行安装器 |
| 安装器拒绝这个项目 | 它是为另一端安装的（每一端用一个项目），或是早期版本为 Codex 安装的，或是 ARL 安装在 `.aris/` 下的：请安装到新项目。`--provider` 已删除 |
| 安装器：`Local file differs` | 安装包管理的某个文件被改过：保存修改，再加 `--force` 重新运行 |
| Studio 的登录链接提示已用过或不对，或页面返回 `wrong host` | 链接只能让一个浏览器登录一次：重启 Studio 获取新链接。经 `ssh -L` 转发时，两边用同一个端口号 |
| Studio 启动不了会话（点「运行」，或在对话里要求修改时） | 目录已信任（在项目里运行一次 `claude` 并接受提示）；`--claude` 指向不经过 shell 也能启动的 Claude Code（Windows 上用 `claude.exe`）；运行 Studio 的用户已登录 Claude Code。对话里会说明会话为何无法启动 |
| 说 `start` 却运行了 setup，而不是主任务流程 | 项目的工作流还没设置好（没有 `.contrejour/setup.json`）：让 setup 走到交接；之后 `start` 就会运行主任务流程。setup 不配置机器：还没运行过 `configure` 的话，先运行它 |
| 服务启动失败：`VALIDATION_NOT_CONFIGURED` | 这台机器的 `configure` 还没走到 apply，所以没有冻结的条款和 token：运行 `configure` 直到 apply 完成，再启动服务 |
| 服务启动失败：`LOOP_NOT_SELECTED` | 还没有选定评审流程：让 setup 走完选主任务流程这一步并交接，或者在 Studio 里、用 `project-cli.js use --project . --loop submission-review` 选定，再启动服务 |
| 提交都以 `failed` 结束，`claude agents` 里也没有评审会话 | 目录已信任（在验证端项目里运行一次 `claude` 并接受提示）；`validation.agent.claude_command` 能运行 `--version`（Windows 上用 `claude.exe`，或 `node` 加 `cli.js`）；运行服务的用户已登录 Claude Code。服务的输出会说明会话为何无法启动 |
| 配置表在 `validation.agent.claude_command` 上报告问题 | 该命令无法启动，或它的 `--version` 失败；Windows 上 `.cmd` 或 `.bat` 包装会被拒绝 |
| 某个流程未通过 `loop-check` | 报告会列出每个缺陷，或指出脚本已过期。脚本过期时用 `claude "Run the loop-authoring loop to regenerate <流程>"` 按定义重新生成；定义本身有错，就通过 `loop-authoring` 修改，经你审核。setup 在检查这一步会重新生成未通过的脚本；验证端的任务管理角色在每次评审前也会自己重新生成未通过的脚本，仍不通过就停止 |
| 没有轨迹，或某个 hook 似乎不起作用 | 看 `.contrejour/hook-errors.log`：hook helper 把错误写在那里，并让事件照常通过。它的动作只有在某个流程定义的 `triggers` 里声明了才会执行。登记写在 `.claude/settings.json` 里，指向写入登记时的那个 Node.js：Node.js 换了位置后，重新运行安装器 |
| `query` 或 `fetch-task` 失败 | 验证端的服务正在运行（要等验证端的 `configure` 和 `setup` 都做完才能启动）；worker 能访问 `/health`；地址以 `/mcp` 结尾；token 一致；验证端的 `task.md` 是 UTF-8 |
| worker 的 apply 报告 `TASK_CHANGED` | 验证端在你审阅之后改了 `task.md`：流程会重新取回，你再审阅并确认 |
| 新会话不是任务管理角色，或没有 `contrejour` 工具 | 安装器会把入口角色写进 `.claude/settings.json`（选定主任务流程、apply 配置时会再写一次）；如果被删掉了，运行 `node .contrejour/dist/tools/project-cli.js hooks --project .`。worker 的 apply 把 `contrejour` 服务写进 `.mcp.json`，Claude Code 会请你批准；打开新会话 |
| 上传被拒为 `invalid` | `requirements` 里的 zip 规则：`USAGE.md` 在根目录或唯一的顶层文件夹，大小和文件数限制，可移植的相对路径名。上传地址只能用一次，而且会过期。`invalid` 不计次 |
| 提交为 `failed` | 本方原因。要么评审会话无法启动、被删除、无法继续，或超出审查时限（服务的输出会说明是哪种，`claude logs <编号>` 显示会话内容），要么评审因本机故障被放弃（`validation-cli.js status --project . --submission <编号>` 在 `abandoned` 下显示原因）。`failed` 不计次 |
| 修改之后服务拒绝工作（`BENCHMARK_CHANGED`） | 恢复冻结的 base benchmark、它的证据文件和层的仓库，或新开一个验证端项目 |
