# Contrejour 部署指南

Contrejour 是运行在 Claude Code 上的 agent 流程框架。工作以**流程**的形式运行：流程定义用自然语言写成，写明每一步由哪个**角色**做、按什么顺序、在什么上限之内；根据定义生成的 Claude Code workflow 脚本严格照此调度各个角色。每个角色是一个 Claude Code agent 文件，这一步怎么做全写在里面。每个角色的每次运行都记录为轨迹，`trajectory-optimizer` 角色据此修复角色；流程和角色通过流程库共享，也就是 Contrejour 仓库里的 `library/` 目录。

它的第一个应用、也是本指南要部署的，是两台机器上的研究任务。**worker** 为 `task.md` 构建交付物并提交。**validator** 持有只增不改的隐藏 benchmark，作为 worker 的对抗方评审每次提交，发布结论、测试项总数与通过数，以及对所发现问题的反馈。两台机器之间只有验证服务的四个 MCP 工具（`task`、`requirements`、`submit`、`query`）和每个 zip 的上传。

Contrejour 只运行在 Claude Code 上：不支持 Codex，也不使用 Paseo。设计及其理由见源码仓库中的 `ARCHITECTURE_GUIDE.md`。[English setup guide](SETUP_GUIDE.md)

## 开始之前

两台机器都需要 Bash、Git、Node.js 22.12+，以及已安装并登录的 Claude Code。验证机器还需要运行 benchmark 所需的一切。Windows 上在 Git Bash 中运行安装器，Node.js 需在 `PATH` 中；WSL 是另一个独立的 Linux 环境。Contrejour 对 Claude Code 的用法（后台会话、workflow、agent、hooks）已在 Claude Code 2.1.316 上验证。

每台机器建一个项目目录，两者绝不共享磁盘、仓库或同步目录：正是这种隔离让隐藏的 benchmark 不在 worker 能触及的范围内。`task.md` 只在验证端写，worker 会取回它。

## 安装

每台机器上使用 Contrejour 的本地 Git 仓库。先显式准备好，再按本机是哪一端安装到项目：

```bash
cd /path/to/local/contrejour-checkout
npm ci
npm run build
bash distribution/install-contrejour.sh --role validator --project /path/to/project   # 验证机器
bash distribution/install-contrejour.sh --role worker --project /path/to/project      # worker 机器
```

安装器只读取准备好的本地仓库。它不执行 Git clone 或更新，不安装 npm 包，不下载任何东西，也不需要 tar；它只写入项目目录，从不碰全局配置。缺少依赖或编译好的 helper 时，它会停止并给出准备步骤。`--dry-run` 报告将要做什么，不写入任何文件。

目标机器上没有仓库时，在别处用 `npm run pack:contrejour` 构建归档，复制过去，在项目目录之外解压，用相同的参数运行其中的安装器：

```bash
tar -xzf contrejour-0.1.0.tar.gz
bash contrejour/install.sh --role worker --project /path/to/project
```

安装器放进项目的内容：

| 位置 | 内容 | 之后 |
| --- | --- | --- |
| `.contrejour/` | 编译好的 helper（`dist/`）、它们的运行依赖和模板 | 由安装器更新 |
| `.claude/skills/` | `research-wiki`、`browser-act` 和共享参考 | 由安装器更新 |
| `.claude/agents/` | 五个框架角色和本端的九个角色 | 首次放入，之后归项目所有 |
| `.claude/loops/`、`.claude/workflows/` | 本端的流程 `research-iteration` 或 `submission-review`：流程定义和脚本 | 首次放入，之后归项目所有 |
| `.contrejour/seeded/` | 每个流程和角色放入时的副本：之后用来分清本项目改了什么 | 放入文件时写入 |
| `.contrejour/install.json` | 本项目是哪一端、作为项目流程库的本地仓库，以及安装器所管理文件的哈希 | 每次安装重写 |

流程和角色只在项目里还没有同名文件时写入，更新从不替换或删除它们，因为它们本来就要变化：`trajectory-optimizer` 修复角色，流程和新角色由你通过 `loop-authoring`、`role-authoring` 这两个流程修改和添加。项目可以把改动送回流程库（见[贡献到流程库](#贡献到流程库)），这就是安装器要记录本地仓库的原因。从归档安装不会记录流程库（从归档更新时保留之前记录的），贡献时需要先取一份本地仓库。

项目是哪一端在安装时固定：setup 读取它，用另一端更新会被拒绝，所以每一端用一个项目。早期版本为 Codex 安装的项目，以及名为 ARL 的版本安装的项目（数据在 `.aris/` 下），会被拒绝而不是迁移：请安装到新项目，重新 setup，并新建 `research-wiki/`。安装器不再接受 `--provider`。

安装完成时，安装器会给出下一步：运行本端的 setup 角色。

## 先配置验证机器

worker 的 setup 要从运行中的验证服务取回 `task.md`，所以先配置验证端。

### 1. 打开 setup 角色

```bash
cd /path/to/validator-project
claude --agent validator-setup "start"
```

引号里是会话的第一句话。Claude Code 会话收到第一句话才开始工作：只写 `--agent` 时角色已经加载，但会一直等你输入；带上第一句话就立即开始。需求已经想好的话，直接写在 `start` 的位置。

第一次在项目里打开 Claude Code 时，它会询问是否信任这个目录。请接受：服务在 Claude Code 后台会话中评审每次提交，而后台会话只能在已信任的目录里启动。

会话以 `validator-setup` 身份运行，它运行 `project-setup` 这个流程，也就是下面这些步骤。流程每次需要你时就停下来，会话给你看一份审核说明和一个问题；你的下一句话就是回答，会话把它原样交给流程，流程从停下的地方接着运行。下面每一个决定都是这样做的，由流程里的 `owner-review` 这一步负责。（在流程里运行的角色自己没法问你：Claude Code 不给 workflow 里的 agent 向人提问的工具，所以由会话来传问题和回答。hook 会核对进入流程的每个回答，都是你在流程提出那个问题之后亲手输入、没有改动的消息。）

### 2. 说明需求，定下流程

setup 从你的需求开始。告诉角色这台机器要验证什么：交付物要做到什么、用什么来评判、worker 有多少次提交机会，以及评审的运行方式有没有特殊要求。需求不够具体时，会问你缺的部分。

项目根目录的 `task.md` 就是全部任务，也是 worker 能得到的唯一任务说明：服务通过 `task` 工具原样交出它，之后的修改会在 worker 下次取回时生效。如果还没有，setup 角色根据你的需求和 `.contrejour/templates/TASK_TEMPLATE.md` 写出它（UTF-8 文本）请你审阅，你批准后才继续。你自己写好的 `task.md` 保持原样。它写要构建什么，不写怎么测试。

接着 `loop-query` 在项目里找能做这件事的流程，你会看到复述后的需求和这个流程：它的用途、步骤和负责每一步的角色，以及它的超参数。

- **合适：** 你批准，就直接复用。项目一开始就有流程库里本端的流程；验证端的 `submission-review` 见[一次提交怎么评审](#一次提交怎么评审)。
- **没有合适的，或者你想要别的：** 说清楚要什么，setup 就把 `loop-authoring` 这个流程当作一步来运行。它在最接近的已有流程上构建新流程，而不是从头写（只有你要求时才从头写）；缺的角色也以最接近的已有角色为基础补上；整体检查通过后给你看草稿：流程定义（以它为准）、由定义生成的脚本、新角色，以及和基础流程的区别。你批准了这个确切版本，才会装进项目。

服务对每次提交运行一次你定下的流程，参数是 `{submission_id, submission_dir, params}`。新流程要接受这些参数，并以 `validator-task-manager` 发布评审结果结束，验证方无法完成评审时则放弃这次评审。这样 worker 只能收到 finalize 发布的内容。

### 3. 审阅配置表

审核说明以项目语言一次展示整张配置表：每个字段及其可选项、建议和未解决的问题。排在最前面的是选定的流程和它的每个超参数，以及流程定义里写的默认值、取值范围和含义。在一次回复中给出多项修改，或者直接编辑 `.contrejour/setup-draft.json` 再告诉它；setup 角色把你的回答改成对配置表的修改，刷新后你会再次看到整张表。建议只有在你接受后才成为取值，没有设置的超参数保持默认值。

| 字段 | 决定什么 |
| --- | --- |
| `loop.name`、`loop.params.*` | 本项目运行的流程和它的超参数。`submission-review` 有 `max_adapter_fixes`（2：完整运行暴露的适配器问题最多交回 `adapter-writer` 几次）、`max_extension_rounds`（3：一次评审最多找几轮问题、加几轮测试项；新增测试项的总数仍受 `limits.max_new_tests_per_review` 限制）和 `max_leak_reviews`（5：流程一次运行最多做几次泄漏审查；什么时候扣下反馈仍由 `limits.feedback_attempts` 决定） |
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

如果验证机器已经以 `CONTREJOUR_URL`（服务根地址，不带 `/mcp`）和 `CONTREJOUR_TOKEN`（至少 32 个字符）提供了服务的地址和 token，setup 直接使用它们：`public_url` 取自 `CONTREJOUR_URL`，在配置表里不能修改（要填别的地址，先取消这个变量）；apply 把 `CONTREJOUR_TOKEN` 作为服务 token，不再新建。setup 在运行时读取这两个变量；修改任何一个之后，要重新审阅、确认、apply，然后重启服务。

### 4. 确认并 apply

配置表没有问题时，审核说明会给出它的 `configuration_sha256`。你批准这个版本，流程就确认并写入它。之后的任何修改，包括 `task.md`，都需要重新确认；提出修改不等于批准。

apply 随后：

- 运行 benchmark 的 setup、healthcheck 和 smoke 命令，冻结 base 层（`.contrejour/tester-config.json`）和验证条款（`.contrejour/validation/config.json`）；
- 把选定的流程和超参数取值记入 `.contrejour/loop.json`；
- 在 `.contrejour/validation/token` 生成服务 token，或采用 `CONTREJOUR_TOKEN`；再次 apply 时保留 token，所以 worker 手上的那份仍然有效；
- 把 `environment.secrets` 写入 `.contrejour/environment.json`（权限 0600），并把 `.contrejour/` 加进 `.gitignore`，因为其中有凭据；
- 写入 `.claude/settings.json`：入口角色 `validator-task-manager`、hooks 登记，以及 `worktree.bgIsolation: "none"`，让后台会话可以直接修改 git 仓库里的文件，不必先建工作树。你的其他设置保持不变；
- 在 `CLAUDE.md` 中写入两段：`CONTREJOUR ROLE` 标记之间的角色段（每个验证端角色都遵守的规则），以及 `CONTREJOUR ENVIRONMENT` 标记之间的空环境段。文件其余部分不动。

它返回 `loop`（选定的流程）、`service_command`（运行服务的命令）、`worker_connection`（`url`，即 `public_url` 加上 `/mcp`，以及 worker 的 setup 需要的 `token`）和 `from_environment`（用了 `CONTREJOUR_URL` 和 `CONTREJOUR_TOKEN` 中的哪些），此外还有写入的文件、入口角色，以及环境技能所在的目录 `environment_skill_dir`。

入口角色写在设置里而不是 `CLAUDE.md` 里，是因为每个角色都会读 `CLAUDE.md`。这个文件只放所有角色都必须知道的内容：本端的规则和本机的环境。

### 5. 环境、wiki 和检查

随后 setup 角色在真实机器上工作。它新建 `research-wiki/`，写好环境技能的脚本并把每个实际运行一次，再把每个角色都必须知道的本机情况写进环境段（见[经验放在哪里](#经验放在哪里)）。然后运行流程检查和角色检查（`loop-check.js check` 和 `roles`）。过期或有缺陷的流程脚本，由 `loop-authoring` 作为一步按不变的定义重新生成，再检查一次；仍不通过的流程，以及有缺陷的角色，连同检查报告交给你。环境需要只有你知道的信息时，会问你。做不成的事会如实报告为未完成，附上真实的错误。

### 6. 启动服务

在项目根目录运行 `service_command`，整个任务期间保持运行，例如放在终端复用器（tmux、screen）里，或作为系统服务（systemd、Windows 服务或计划任务）：

```bash
node .contrejour/dist/tools/validation-cli.js serve --project .
```

服务在启动时读取冻结的配置和 token，所以每次重新 apply 之后都要重启它。流程和超参数在每次开始评审时读取：重新 apply 只影响下一次评审，不影响正在进行的评审。查看验证状态：

```bash
node .contrejour/dist/tools/validation-cli.js status --project .
```

通过私密渠道把 `worker_connection` 的地址和 token 交给 worker 端的 owner。评审不用你启动：服务为每次提交启动一次。之后要改流程、超参数或条款，再次运行 `claude --agent validator-setup "change the configuration"`。

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

服务为每个收下的提交启动一个 Claude Code 后台会话，名为 `contrejour-review-<编号>`，以 `validator-task-manager` 身份运行，模型和权限模式取自 `validation.agent`。同时最多进行 `limits.max_concurrent` 个评审，其余排队。会话的提示词只有一句 `Run the <流程> loop with args {…}`，写明 setup 选定的流程、提交、它的目录和流程的超参数：流程里的每个角色都会收到这句话的原文，所以里面不放任何别的内容。

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
- `.contrejour/trajectories/` 里是每个角色的过程记录，`.contrejour/proposals/` 里是对角色的修改提案。要处理待定的提案，在项目里运行 `claude "Run the proposal-review loop"`：你会看到每个提案的依据和具体修改，你接受的会被应用，每个提案的结果都会记下。

## worker 机器

### 1. setup

确认验证端的服务正在运行，并拿到了它的 `worker_connection`。然后：

```bash
cd /path/to/worker-project
claude --agent worker-setup "start"
```

第一次打开时接受目录信任提示。和验证端一样，setup 从你的需求开始，这里是这台机器怎样做验证端的任务：工作方式（多轮探索迭代，还是更窄的工作）、可用的算力和时间、对做法有没有限制；任务本身来自验证端。需求已经想好的话，直接写在 `start` 的位置。和验证端一样，会话运行 worker 的 `project-setup` 流程并替你传话。合适的流程经你批准后直接复用；没有合适的，就由 `loop-authoring` 在最接近的已有流程上构建一个，经你批准后使用。无论定下哪个流程，都由 `worker-task-manager` 运行，也只有它能访问验证服务。

配置表最前面是流程和它的超参数，每个都带默认值、取值范围和含义；没有设置的超参数保持默认值。`research-iteration` 有 `informed_ideators`（3）、`failures_only_ideators`（1）、`blank_ideators`（1），即每轮各类出想法角色的个数，还有 `ucb_c`（1），即给想法排序时探索奖励的权重。配置表还包括 `project.name`、`project.language`、`environment.secrets`、`connection.url`（`worker_connection` 的地址，以 `/mcp` 结尾）和 `connection.token`。连接信息填进配置表后，setup 角色用 `setup-cli.js fetch-task` 从验证端逐字节取回 `task.md`；不要手工编写或复制它。你确认审核说明给出的摘要时，取回的任务也在确认范围内。

apply 先核对 `task.md` 是否仍与验证端一致：如果在你审阅之后验证端改过任务，apply 以 `TASK_CHANGED` 停止，流程会重新取回任务，再请你确认配置表。随后 apply 把选定的流程和超参数取值记入 `.contrejour/loop.json`；把 `environment.secrets` 写入 `.contrejour/environment.json`（权限 0600）；把 `contrejour` 服务写入 `.mcp.json`，只替换这一项；把 `.contrejour/` 和 `.mcp.json` 加进 `.gitignore`，因为其中有凭据；写入 `.claude/settings.json`，包括入口角色 `worker-task-manager`、hooks 登记和 `worktree.bgIsolation: "none"`；并在 `CLAUDE.md` 中写入角色段和空的环境段。之后 setup 角色新建 `research-wiki/`，写好环境技能的脚本并把每个实际运行一次，写入环境段，检查装好的流程，然后交接。

### 2. 开始工作

在项目里打开一个新的 Claude Code 会话：

```bash
cd /path/to/worker-project
claude --permission-mode bypassPermissions "start"
```

流程无人值守地运行，所以会话要用不等人批准的权限模式：默认模式下，它在第一条命令就会停下等批准。`bypassPermissions` 让实验可以使用网络和项目之外的路径；`auto` 由分类器审查每一步，可能拒绝其中一些。

它以 `worker-task-manager` 身份运行，这是 setup 写进 `.claude/settings.json` 的入口角色，并加载 `.mcp.json`；Claude Code 询问时，批准 `contrejour` 服务。它按你确认的取值运行 setup 选定的流程。第一句话里不要放别的内容：流程里的每个角色都会收到启动它的那条消息，包括只该看到任务和问题的"空白"出想法角色。

保持这个会话打开。它会自己一轮接一轮地运行，只有任务结束时才再需要你。你可以随时问它状态：它根据台账和 `query`，报告每次提交的状态、结论、测试项通过数与总数、想法和针对的问题、commit 和 zip，以及已用和剩余的次数。

### 一轮做什么

每一轮开始前，任务管理角色重新取回 `task.md`（验证端的修改在这里到达 worker），并调用 `query`。第一轮之前、以及每次结果为 `invalid` 或 `unusable` 之后，它会重新读取提交要求。它每轮还读取 `.contrejour/loop.json`，所以重新 apply 后下一轮就生效。然后运行流程。默认流程 `research-iteration` 的步骤是：

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

任务管理角色随后报告最终统计和还可以贡献到流程库的内容（见[贡献到流程库](#贡献到流程库)），然后停止。验证端用 `status` 查看同样的状态。

## 贡献到流程库

项目学到的东西可以送回共享的流程库，也就是 Contrejour 仓库里的 `library/` 目录，以 PR 的形式交给维护者审核。不必等任务结束：**只要有一次提交完成就可以**，也就是有一次提交走完评审、结果已发布（`invalid`、`expired`、`failed` 不算）。项目有值得分享的东西就可以贡献，之后还可以再贡献。两端都一样，在项目里运行：

```bash
claude "Run the library-contribution loop"
```

会话以任务管理角色运行，它运行 `library-contribution` 这个流程并替你传话。流程的步骤是：

1. **`library-contributor` 列出要发送的内容**，并逐个给出判断。只有项目安装后新增或改动的文件：安装器把放入的内容在 `.contrejour/seeded/` 留了一份副本，所以你没动过的文件绝不发送，不管流程库后来变了多少，贡献也就不会改回别人的改进。你和流程库改了同一个角色的不同位置，就合并两边；改了同一处，这个文件先留下，并说明怎么处理。不合 Contrejour 角色格式的文件（比如你自己的 agent）留在项目里。含本项目密钥或 token、隐藏路径或注入模式的文件直接拒绝。本机路径和只有本项目用得上的内容会指出来，由你决定。
2. **验证端由 `leak-reviewer` 检查**：它从全新上下文拿这批文件和隐藏测试比对，结论记在这份清单上。
3. **你审核清单**（`owner-review` 这一步）：批准，或者说明要去掉或修改什么，然后你会看到新的清单。
4. **`library-contributor` 只发送你批准的内容。** 它从流程库的最新版本新开分支 `library/<项目>-<端>-<yyyymmdd>`，对结果跑流程检查和角色检查，然后提交、推送并开 PR；没有仓库写权限就走 fork。本地仓库当前的分支和改动保持不变，用完的工作副本会清理掉。你批准之后内容如果又有变化，helper 会拒绝发送，你会看到新的清单。

推送到 GitHub 和开 PR 需要已登录的 GitHub CLI（`gh auth login`）。没有它时，如果你的 git 凭据允许，分支仍会推送，并给出地址让你自己开 PR；推送不了，分支就留在本地仓库，角色会说明缺什么。从归档安装的项目没有本地仓库：流程会问你要不要从这个版本注明的仓库取一份，或者你在安装时传 `--library PATH`。新角色的 `side` 决定谁能拿到：`framework` 进入所有项目，`worker` 或 `validator` 只进入那一端。

## 经验放在哪里

经验放在用到它的地方，由负责它的角色写入：

| 种类 | 位置 | 写入方 |
| --- | --- | --- |
| 研究知识：每个问题上已有工作做了什么、试过哪些想法和实验、哪些有效 | `research-wiki/`，每台机器一份 | 只有记忆角色（`worker-memory`、`validator-memory`），通过 `research-wiki.js` |
| 本机的事实和经验 | `CLAUDE.md` 的环境段 | setup 角色写初始内容，之后只有记忆角色 |
| 每次都一样的固定操作 | 环境技能 `<项目>-environment` 的脚本 | setup 角色写初始内容，之后由记忆角色补充 |
| 一个角色怎么做它那一步 | `.claude/agents/` 里它的文件 | `trajectory-optimizer`；验证端只能通过你在 `proposal-review` 里接受的提案；新角色通过 `role-authoring` |
| 运行哪些角色、按什么顺序 | `.claude/loops/` 里的流程定义 | `loop-authoring`，只按你的要求 |

**研究 wiki。** 用 survey、idea、experiment、claim、problem 五类节点和证据边，按问题记录已有工作做了什么、试过什么、哪些有效、哪些无效。每一轮从 query pack 开始，那是一份不超过 1000 字符、带节点引用的摘要；细节留在各页面里。验证端的 wiki 记录各次提交暴露的问题、每次提交解决了哪些、哪些仍在，以及调研过的测试方法。它不含任何测试内容，因为 `validator-memory` 只依据已发布的结果和公开来源工作；哪些层针对哪些问题记录在 benchmark 的 `registry/` 里，不在 wiki 里。通过 `research-wiki` 技能、它的命令行或 Markdown 页面阅读 wiki。

**环境段。** 每个角色都读 `CLAUDE.md`，包括"空白"出想法角色，所以这一段只写环境：机器和 SSH 别名；代码、数据、checkpoint、结果和日志路径；环境名及激活方式；资源及其限制；指标输出到哪里；验证过的坑。每行一条验证过的事实，不超过 8000 字符；研究结论留在 wiki 里。`node .contrejour/dist/tools/setup-cli.js environment --project .` 可以查看它。

**环境技能。** `.claude/skills/<项目>-environment/` 把固定操作写成 Bash 脚本（同步代码、准备环境、启动命名实验、检查、取回日志和结果、停止；验证端还有例如检查一次运行所需的 GPU、内存和磁盘），每个脚本写好时都实际运行一次。每次运行有自己的名字、日志和结果路径，所以可以同时跑多个实验。在验证端，`validator-memory` 还会把评审中写出的可复用测试工具加进来，前提是它核实过其中不含测试内容。key 和 token 从 `.contrejour/environment.json` 读取，从不写进脚本。脚本用到的工具，例如 SSH、rsync、conda 或容器运行时，不在安装包里。

**角色。** worker 每一轮、validator 每一次评审之后，`trajectory-optimizer` 读每个角色做了什么，按该角色自己的 Evaluation 一节评估它，在问题重复出现或明显影响了结果的地方，对角色文件做一处小修改。在 worker 端，每处修改单独提交一个 commit，任何一处都可以撤回。在验证端，它只把提案写进 `.contrejour/proposals/`，你在 `proposal-review` 流程里接受后才生效：验证端的轨迹里有隐藏测试和 worker 写的文字，这两样都不能混进角色。

**流程库。** 流程和角色回到流程库（见[贡献到流程库](#贡献到流程库)），下一个项目就从这个项目学到的东西开始。这取代了早期版本跨项目的 `Experience.md`。

## 修改流程和角色

修改流程和角色也通过流程进行，每次都经你审核。在项目里用 `claude "Run the <流程> loop"` 运行其中一个，并说明你要什么；任务管理角色运行它并替你传话。要给项目换一个流程，或者改流程的超参数，再次运行本端的 setup：`claude --agent worker-setup "change the configuration"`（验证端是 `validator-setup`）。

- **`loop-authoring`** 按你的描述新建或修改流程。先由 `loop-query` 在本项目和流程库里找可以作为基础的流程；如果已有流程恰好就能做你要的事，会先问你是否直接用它。然后 `loop-editor` 在最接近的流程上构建新流程，保留它做得好的部分，只改你要求改的（只有你要求时才从头写）；缺的角色由 `role-creator` 以最接近的已有角色为基础补上。所有内容先放在 `.contrejour/drafts/` 里并通过检查；你会看到流程定义、脚本、新角色以及和基础流程的区别，只有你批准的那个版本才会装进项目。运行中的流程不会改自己，其他流程也不改流程。
- **`role-authoring`** 按你的描述（在哪一步做什么、收到什么、交出什么、能读写什么、怎样算做得好）新建或修改角色。`role-creator` 先在本项目和流程库里找已经能做这件事的角色，有合适的就先问你是否直接用；没有就以最接近的角色为基础构建（只有你要求时才从头写），检查后装入你批准的版本。需要一个没有角色负责的步骤时，就加一个角色，而不是加一段不属于任何角色的代码。
- **`library-contribution`** 把项目新增和改动的内容送回流程库（见[贡献到流程库](#贡献到流程库)）。
- **`proposal-review`**（验证端）把 `trajectory-optimizer` 提出的角色修改交给你，应用你接受的那些。

想问哪个流程适合某项工作，或者某个流程做什么，可以直接问 `loop-query`：`claude --agent loop-query "<你的问题>"`。

流程做什么，以定义为准；脚本是它的可执行副本。脚本末尾记有它所依据的定义的摘要，所以定义一改，就能看出脚本过期了。脚本只能调用角色、把另一个流程当作一步运行（只嵌套一层）、根据角色的结构化输出决定顺序、并行和分支、在角色之间传递输入、在固定上限内循环，以及在 `owner-review` 这一步停下等你。它不能在提示里写一步怎么做（这只写在角色的文件里，`trajectory-optimizer` 才能修复），不能用代码干活，不能调用 `loop-editor` 或 `role-creator`（只有 `loop-authoring` 和 `role-authoring` 能），也不能使用当前时间或随机数，否则会破坏续跑。流程检查不调用模型，用假角色把每个脚本运行几遍，每遍给出不同的假回答，以走到每一个分支：

```bash
node .contrejour/dist/tools/loop-check.js check --project .
```

它报告未知或未指定的角色、未知的子流程和嵌套超过一层的子流程、对当前时间或随机数的使用、停不下来的循环、未声明的阶段、任何回答都走不到的角色、未知的 `kind` 或触发动作，以及比定义旧的脚本。流程的 `kind` 写明它的用途：`task` 是项目的主任务，由 setup 选定；`setup` 是 setup 本身；`on-request` 在你要求时运行。

hooks 负责每次某个事件发生都必须做的事。安装器在 `.claude/settings.json` 里登记它们（这样 setup 自己的流程也受保护），setup 再刷新一次，全部交给 Contrejour 的 hook helper。它们只做记录、通知或拦截，执行哪些动作写在流程定义里（`triggers`）：

- `record-trajectory`：角色结束时，把它的过程记录复制到 `.contrejour/trajectories/`，并记下所属的会话、流程和提交。Claude Code 自己的记录放在你的用户目录下，默认 30 天后清理，格式也随版本变化，所以要复制一份。轨迹只留在本机。
- `notify-stopped-review`（验证端）：评审会话在提交未完成时停下，就通知服务。
- `guard-protected-paths`（验证端）：拦截对 benchmark、其冻结配置、隐藏数据，以及只能由 helper 写入的文件的写操作。
- `guard-owner-answers`：每个流程启动前，核对会话带进去的每个回答都是你在这个会话里、在流程停在那个审核点之后亲手输入的一条消息，逐字完整；不是就拦下这次运行。核对过的回答记在 `.contrejour/reviews/answers/`，人审核角色只认这里的记录。

## 升级或修复

显式更新本地仓库并重新构建，然后用相同的端和项目重新运行安装器：

```bash
cd /path/to/local/contrejour-checkout
npm ci            # 仅当锁文件变化时
npm run build
bash distribution/install-contrejour.sh --role worker --project /path/to/project --dry-run
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

安装器根据当前仓库生成并校验一个临时文件包，补回缺失的文件，更新 helper、运行依赖、模板和装好的技能，删除包里已移除的文件。其中任何一个有本地修改，更新都会在写入之前停止：保存你的修改，再加 `--force` 重新运行以替换它。放入项目的流程和角色保持项目里的版本，列在 `kept_project_versions` 下。想用流程库里更新的版本，先删除项目里的那份（流程要同时删除定义和脚本），再运行安装器。`task.md`、wiki、benchmark、提交记录、setup 状态、`.contrejour/environment.json`、环境技能和 `.claude/settings.json` 都不会被动。

已经 apply 过的项目，重新运行 `node .contrejour/dist/tools/setup-cli.js apply --project .` 来更新角色段和设置（入口角色和 hooks 登记）；配置没变时，原来的确认仍然有效。Claude Code 在会话开始时读取角色和技能，所以之后要打开新会话。验证端要重启服务，让它运行更新后的 helper。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 安装器：本地运行时不完整 | 在仓库里运行 `npm ci` 和 `npm run build`，再运行安装器 |
| 安装器拒绝这个项目 | 它是为另一端安装的（每一端用一个项目），或是早期版本为 Codex 安装的，或是 ARL 安装在 `.aris/` 下的：请安装到新项目。`--provider` 已删除 |
| 安装器：`Local file differs` | 安装包管理的某个文件被改过：保存修改，再加 `--force` 重新运行 |
| 提交都以 `failed` 结束，`claude agents` 里也没有评审会话 | 目录已信任（在验证端项目里运行一次 `claude` 并接受提示）；`validation.agent.claude_command` 能运行 `--version`（Windows 上用 `claude.exe`，或 `node` 加 `cli.js`）；运行服务的用户已登录 Claude Code。服务的输出会说明会话为何无法启动 |
| 配置表在 `validation.agent.claude_command` 上报告问题 | 该命令无法启动，或它的 `--version` 失败；Windows 上 `.cmd` 或 `.bat` 包装会被拒绝 |
| 某个流程未通过 `loop-check` | 报告会列出每个缺陷，或指出脚本已过期。脚本过期时用 `claude "Run the loop-authoring loop to regenerate <流程>"` 按定义重新生成；定义本身有错，就通过 `loop-authoring` 修改，经你审核。验证端的任务管理角色在每次评审前会自己重新生成未通过的脚本，仍不通过就停止 |
| 没有轨迹，或某个 hook 似乎不起作用 | 看 `.contrejour/hook-errors.log`：hook helper 把错误写在那里，并让事件照常通过。它的动作只有在某个流程定义的 `triggers` 里声明了才会执行。登记写在 `.claude/settings.json` 里，指向运行 setup 的那个 Node.js：Node.js 换了位置后，重新 apply |
| `query` 或 `fetch-task` 失败 | 服务正在运行；worker 能访问 `/health`；地址以 `/mcp` 结尾；token 一致；验证端的 `task.md` 是 UTF-8 |
| worker 的 apply 报告 `TASK_CHANGED` | 验证端在你审阅之后改了 `task.md`：重新取回、审阅并确认 |
| 新会话不是任务管理角色，或没有 `contrejour` 工具 | setup 已经 apply（`.claude/settings.json` 写明了入口角色）；批准 `.mcp.json` 里的 `contrejour` 服务；打开新会话 |
| 上传被拒为 `invalid` | `requirements` 里的 zip 规则：`USAGE.md` 在根目录或唯一的顶层文件夹，大小和文件数限制，可移植的相对路径名。上传地址只能用一次，而且会过期。`invalid` 不计次 |
| 提交为 `failed` | 本方原因。要么评审会话无法启动、被删除、无法继续，或超出审查时限（服务的输出会说明是哪种，`claude logs <编号>` 显示会话内容），要么评审因本机故障被放弃（`validation-cli.js status --project . --submission <编号>` 在 `abandoned` 下显示原因）。`failed` 不计次 |
| 修改之后服务拒绝工作（`BENCHMARK_CHANGED`） | 恢复冻结的 base benchmark、它的证据文件和层的仓库，或新开一个验证端项目 |
