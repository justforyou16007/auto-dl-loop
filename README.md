# Contrejour

**An adversarial research task on two machines, run as agent loops on Claude Code.**

[中文](README.zh-CN.md) · [Quick start](#quick-start) · [Setup guide](SETUP_GUIDE.md) · [Architecture](ARCHITECTURE_GUIDE.md)

Contrejour runs one research task on two machines. The **worker** builds deliverables for a task and submits them. The **validator** owns a hidden benchmark that only grows, judges each submission as the worker's adversary, and publishes a verdict, how many tests passed out of how many, and leak-reviewed feedback. The worker improves from that feedback until the submissions run out.

On both machines the work runs as **loops** of **roles**, on the [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio) framework. A loop's definition, written in natural language, is the authority on what it does: which role does each step, what passes between them, where it branches and how often it may repeat. A Claude Code workflow script generated from that definition runs it. Each role is a Claude Code agent file holding everything about how its step is done. Every role's run is recorded as a **trajectory**, and the `trajectory-optimizer` role learns from them by fixing the roles. The owner chooses, changes and runs the loops in the **Studio**, a console in the browser.

Contrejour runs on Claude Code only: no Codex, no Paseo.

## Three repositories

This repository, auto-dl-loop, holds the research task. The framework and the shared library are repositories of their own, which it carries as git submodules:

| Repository | What it holds |
| --- | --- |
| [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio), at `agent-loop-studio/` | The framework: loops that schedule roles on Claude Code, the helpers that check and run them, the Studio, the installer, and the base loops and roles every project gets, such as `loop-authoring`, `owner-review` and `trajectory-optimizer`. |
| [agent-loop-community](https://github.com/justforyou16007/agent-loop-community), at `agent-loop-community/` | The shared library: loops and roles that projects contributed for other projects to use. It is empty for now. |
| auto-dl-loop, this one | The research task: `project.json`, which tells the framework about the two kinds of machine; the research helpers (the validation service, the configuration sheet, the worker's ledger, the wiki); the worker's and the validator's loops and roles in `library/`; skills, templates and tests. |

Dependencies point one way: this package pins a version of each, and neither depends on it. The framework and the shared library stay free of anything that belongs to one project, and this package moves to a newer framework only when it chooses to.

## Why loops of roles

Earlier versions gave one agent a numbered list of steps. Nothing but the agent's discipline kept the order. When a result was poor, nobody could tell which step was at fault, so an improvement could only edit the text, and might not take effect. And whatever worked stayed in one project. Contrejour answers each of these:

- **The order is fixed.** A script decides what runs when, not the agent.
- **Each step belongs to one role**, whose file says what it is responsible for, what it sees, what it returns and how to tell it did well. A problem can be traced to one role and fixed in one place.
- **Experience accumulates.** Roles are judged and fixed from their trajectories, and loops and roles reach other projects through the shared libraries.

The scripts only schedule. Open-ended work, such as implementing an idea with its experiments or finding a deliverable's problems, is left whole to one role: a pipeline that hard-codes the work itself becomes its ceiling, which is what happened to Contrejour's predecessor, ARIS.

Models also still judge their own results badly: tests written by the agent that built the deliverable are not credible. So Contrejour keeps building and judging on two machines that cannot see each other.

## Features

### From the framework

The research task gets these from agent-loop-studio; its [README](https://github.com/justforyou16007/agent-loop-studio#readme) and [architecture notes](agent-loop-studio/docs/architecture.md) say more.

- **Loops in natural language, run as scripts.** A loop's definition (`.claude/loops/<loop>.md`) names, for each step, the role that does it, what the role receives and returns, the condition it branches on, the bound of each repetition and where the loop waits. `loop-editor` generates the workflow script (`.claude/workflows/<loop>.js`) from it. A script only calls roles, orders and branches on their structured output, passes inputs between them and loops within a bound. It never says in a prompt how a step is done and never does the work in code, so a fix to a role file is never overridden by the script.
- **A compile check.** `loop-check` runs a script against stub roles, without calling a model, several times with different stub answers so every branch is reached. It reports unknown roles, loops that never stop, undeclared phases, roles no answer reaches, use of the clock or randomness (which breaks resuming a run) and a script older than its definition.
- **Roles are Claude Code agent files** (`.claude/agents/<role>.md`): responsibility, inputs, structured output, what the role may write, model and effort, and an Evaluation section with the signals by which it is judged. Tool lists isolate for real: a role given no file tools cannot read the wiki. A role with Bash relies on the rules in its file.
- **Trajectories teach the roles.** A hook copies every finished role's transcript into the project. After each worker round and each validator review, `trajectory-optimizer` judges each role against its own Evaluation section and fixes the role file where a problem recurs. Validator roles change only through proposals the owner accepts in the `proposal-review` loop, because the validator's trajectories hold hidden tests that must never find their way into a role.
- **Hooks only record, notify or block.** The installer registers them once; which actions run is declared in the loop definitions. The framework's two actions record every role's trajectory and check, before any loop runs, that every answer a session passes in is a message the owner typed after the loop asked, unchanged. This package adds two in its `project.json`: one tells the validation service that a review session stopped early, the other keeps the validator's roles away from the benchmark, the hidden data and the files only the helpers write.
- **No flow outside a loop.** A session only starts loops and carries the owner's answers into them; loops schedule roles; roles do the steps. A role never runs another role, and a decision of the owner's is an `owner-review` step of a loop. Workflow agents cannot ask a person anything, so a loop stops at that step, the session shows the owner a review note, and the loop resumes with the reply.
- **New loops and roles start from existing ones.** `loop-authoring` has `loop-query` find the loops a requested loop can be built on, and `loop-editor` builds it on the closest; `role-authoring` has `role-creator` find the roles that already do the work and build on the closest. Either writes from scratch only when the owner asks. Drafts reach the project only once the owner approves that exact version.
- **The Studio.** `studio.js` is the owner's console in a browser on the same machine. Say what loop you want in its chat: it lists the close ones, each previewable as a flow, and draws the closest on a canvas with its parameters beside the steps they affect. Point at steps or arrows and say what to change, or ask for a role, and `loop-authoring` or `role-authoring` drafts it in a background session and stops for your review, with the draft on the canvas. There you also choose the loop the project runs and its parameter values, run any loop and watch its steps, and keep several projects: start one from a reference project, or copy one. Only the browser signed in with its one-time link can use it, and it answers only on the machine's own address. `loop-view.js` shows the same loops on a read-only page.
- **Libraries shared between projects.** Installation seeds a project with the framework's base loops and roles, the community's, and the worker's or validator's from this package; from then on they are the project's own, and a copy of each as seeded is kept. Once one of its submissions has finished, the owner can run the `library-contribution` loop. It sends what the project added or changed back to the library each file came from (a new one any project can use goes to the community's), as one pull request per library, after the owner has reviewed exactly what leaves. The kept copy tells the project's changes from the library's, so a contribution never undoes anyone else's work.

### The task loop and the machine's configuration

- **The owner chooses the loop.** Each project runs one task loop: `research-iteration` on the worker, `submission-review` on the validator. The owner chooses it and sets its parameters in the Studio, or with `project-cli.js use`, and the choice is recorded in `.contrejour/loop.json`. A loop declares its parameters with defaults, so tuning it means choosing values, not editing it; another loop, or one `loop-authoring` builds, can take its place.
- **Configuring a machine is a loop too.** `machine-config` runs when the owner asks for it, from the Studio or from a session in the project. It settles what only that machine has: on the validator `task.md`, the benchmark, the terms and the service; on the worker the connection to the validator, from which `task.md` comes. What the machine needs is gathered on one configuration sheet, and only the version the owner approved is applied. Then it prepares the machine's environment, checks the loops and says what comes next.

### Independent, measured validation

- **Two machines, one channel.** The worker and the validator share no disk, repository or messages, only the validation service's four MCP tools and the upload of each zip. `task` hands the worker the validator's `task.md` byte for byte, so both sides work to the same text, and an edit on the validator reaches the worker at its next fetch. `requirements` gives the worker the deliverable's terms up front: zip checks and limits, what `USAGE.md` must state, the calling interface, the runtime environment, the review time limit and what each verdict means. `submit` reserves a one-time upload URL; `query` reports the state, the submissions left and each submission's result. Cheating is prevented by separation rather than by rules: the worker cannot read the benchmark.
- **Append-only benchmark.** The base layer's source, data revision, split, sample count, runners and per-sample pass rule are frozen when the validator machine is configured. During reviews, `test-extender` adds layers (`inc-001`, …) whose tests are each derived from existing tests, never invented. The layers live in a git repository only the helper commits to; every commit may only add files, and the helper checks the history commit by commit. A wrong layer is retired, never edited, and any change stops the service.
- **Measured test results.** Each sample is one test, passed or failed by the frozen pass rule (`metric`, `op`, `threshold`), which the helper applies to complete per-sample runner output. Results report how many tests passed out of how many. There is no score, and submissions are not compared, because the benchmark keeps growing. The worker never reports its own results.
- **Adversarial review as a loop.** For each submission the service starts a Claude Code background session that runs the review loop the owner chose, `submission-review`: inspect the code before anything runs, install the deliverable as documented and write its adapter, rerun every layer, hunt for more problems and add derived tests, write the verdict (`valid`, `cheating` or `unusable`) and feedback, have the feedback leak-reviewed, publish, record, and propose role fixes. A `cheating` verdict voids every test result.
- **Leak-reviewed feedback.** Feedback names the real problems: what goes wrong, which requirement of `task.md` it breaks, roughly how often, how severe, and which earlier problems were solved or persist. It may describe how tests are constructed, never the actual tests. `leak-reviewer` checks it against every hidden test from a fresh context; the loop starts it, so the feedback's author cannot shape what it sees. The review is bound to the feedback's digest, and if every permitted rewrite still leaks, only the verdict and counts are published.
- **Supervised reviews.** The service continues a review session that stops before publishing; a session that was removed or cannot be continued fails its submission without counting it. A review the validator's side cannot complete (its machine lacks what was promised, a helper fails) is abandoned uncounted, so the worker can submit again at once.
- **Defined stopping.** The task closes only when the counted submissions are used up; passing every current test does not end it. Upload, format and infrastructure failures do not count.

### Research rounds with memory

- **One round, seven steps.** The worker's `research-iteration` loop chooses open problems; has ideators propose one idea each (by default five: three see the wiki, one knows only the ideas that failed, one knows only the task and the problems); scores the ideas and ranks the whole pool with `rank_ideas`, which adds an exploration bonus for directions tried less; implements the top idea with its experiments; and submits one commit. Once the result is published, it records the result and fixes the roles. Rounds repeat until the task closes. How many ideators of each kind, and the weight of exploration, are the loop's parameters.
- **Research wiki.** Each machine's `research-wiki` records, for one or more problems, what existing work did, which ideas and experiments were tried, and which were effective or ineffective, linked by typed evidence edges. Only the memory role writes it. Every round starts from its query pack, a summary of at most 1000 characters. The validator's wiki records which problems each submission solved and which persist, never test content.
- **Environment section and environment skill.** Facts about the machine (hosts, paths, environments, resources, where metrics land, verified pitfalls) live in the environment section of `CLAUDE.md`. Every role reads that file, so the section holds the environment only. Fixed procedures (sync code, launch a named run, check it, fetch results, stop it) are verified scripts in the project's environment skill, and each run has its own name, so several experiments run at once. Keys and tokens stay in `.contrejour/environment.json`.

### Local, ownership-aware installation

The installer comes from the framework and runs from this package's prepared checkout. It copies into the project the compiled helpers (the framework's and this package's), the `research-wiki` and `browser-act` skills with the shared references, the loops and roles of the three libraries, and the runtime dependencies. It downloads nothing and writes only into the project. Updates replace only the files the installer owns; seeded loops and roles, tasks, wikis, benchmarks, submissions and settings stay as the project has them.

## How it works

1. **Define the task.** On the validator machine, choose the review loop and its parameters in the Studio, then run `machine-config`. It writes `task.md` with you and has you confirm one configuration sheet: the benchmark, the per-sample pass rule, the submission budget, how review sessions start and the service address. Applying the sheet freezes the terms; then start the service.
2. **Build.** On the worker machine, choose the research loop and its parameters, and run `machine-config` with the connection the validator gave you; it fetches `task.md` through the service. A Claude Code session opened in the project runs as the task manager and runs the chosen loop, `research-iteration`, round after round.
3. **Submit.** Each round ends with one commit, built into a zip with `USAGE.md` and uploaded to a one-time URL.
4. **Review.** The service starts a review session for the submission, which runs the chosen loop, `submission-review`, and publishes the verdict, the test counts and leak-reviewed feedback.
5. **Learn.** The worker's memory records the result and the problems it names, `trajectory-optimizer` fixes the roles on both sides, and the next round starts from the open problems.
6. **Contribute and finish.** Once a submission has finished, either side's owner can run `library-contribution` to send that project's new and changed loops and roles back to the libraries they came from; the validator's go only after a leak check. When the submissions are used up the task closes.

Keep the two projects on separate machines with no shared or synchronized directory: that is what keeps the hidden benchmark out of the worker's reach. See the [architecture guide](ARCHITECTURE_GUIDE.md) for the boundaries of evaluation and feedback.

## Quick start

### Prerequisites

On each machine:

- **Bash**, **Git** and **Node.js 22.12+**.
- **Claude Code**, installed and signed in.

The validator machine also needs your benchmark's dependencies. On Windows, run the installer in Git Bash with Node.js on `PATH`; the [setup guide](SETUP_GUIDE.md) covers the Windows command for review sessions and networking.

### Prepare a checkout

On each machine, clone this repository with its submodules and build it. The framework builds first, because this package's build takes the framework's compiled helpers and the Studio's page and puts its own helpers next to them:

```bash
git clone --recurse-submodules https://github.com/justforyou16007/auto-dl-loop.git
cd auto-dl-loop
npm ci
npm --prefix agent-loop-studio ci
npm run build:framework
npm run build
```

### Install into each project

On the **validator** machine:

```bash
bash distribution/install-contrejour.sh --role validator --project /path/to/project
```

On the **worker** machine:

```bash
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

The side stays with the project. Installation reads only the prepared checkout and downloads nothing; missing dependencies or compiled helpers cause an error. The installer records the checkout in the project, because that is where the project's contributions go back. Without a checkout on the target machine, use the offline archive's `install.sh` with the same options.

### Configure the two machines

The validator comes first, because the worker's configuration fetches `task.md` from the validator's running service:

```bash
cd /path/to/validator-project
claude                                                 # once, to accept the folder trust prompt; then quit
node .contrejour/dist/tools/studio.js --project .      # prints a one-time sign-in link
```

Open the link in a browser on that machine (from another machine, forward the port first: `ssh -L 8790:127.0.0.1:8790 <machine>`). In the Studio, make `submission-review` the project's task loop and set its parameters, then run `machine-config`. It stops for you to say what the machine should validate, to review `task.md` and to confirm the configuration sheet, and the Studio's chat asks you each time. The same works from a terminal:

```bash
node .contrejour/dist/tools/project-cli.js use --project . --loop submission-review   # --param name=value to change a default
claude "Run the machine-config loop"
```

When it is done, start the validation service and keep it running; it starts one review session per submission:

```bash
node .contrejour/dist/tools/validation-cli.js serve --project .
```

Background sessions, the Studio's and the reviews', only start in a trusted folder; hence the trust prompt. `machine-config` ends with the worker's connection, a URL and a token: pass it to the worker machine privately. If the validator machine already provides `CONTREJOUR_URL` and `CONTREJOUR_TOKEN`, it uses them instead of asking for an address and creating a token.

Then the worker, the same way, in the Studio or from a terminal: make `research-iteration` its task loop, run `machine-config` with the connection (it fetches `task.md`), and start the rounds:

```bash
cd /path/to/worker-project
node .contrejour/dist/tools/project-cli.js use --project . --loop research-iteration
claude "Run the machine-config loop"
claude --permission-mode bypassPermissions "start"    # runs as worker-task-manager, round after round
```

Leave that last session open: it runs round after round on its own, which is why it needs a permission mode that does not wait for approvals (`auto` is the more cautious choice; see the setup guide). Keep its first message to "start", because every role of the loop receives the message that started the run.

Follow the **[full setup guide](SETUP_GUIDE.md)** or **[中文部署指南](SETUP_GUIDE_CN.md)** for the configuration sheet, networking, how a submission is reviewed, updates and troubleshooting.

## What is included

| Part | Roles | Loops |
| --- | --- | --- |
| Framework, in every project | `loop-query`, `loop-editor`, `role-creator`, `owner-review`, `trajectory-optimizer`, `library-contributor`; also `task-manager` and `project-memory`, which the research sides do not use: they have their own task managers and memory roles | `loop-authoring`, `role-authoring`, `library-contribution` |
| Worker | `worker-config`, `worker-task-manager` (entry), `worker-memory`, `problem-selector`, `ideator-informed`, `ideator-failures-only`, `ideator-blank`, `idea-assessor`, `implementer` | `research-iteration` (task), `machine-config` |
| Validator | `validator-config`, `validator-task-manager` (entry), `validator-memory`, `inspector`, `adapter-writer`, `regression-runner`, `test-extender`, `verdict-writer`, `leak-reviewer` | `submission-review` (task), `machine-config`, `library-contribution` (its own, with a leak check, in place of the framework's), `proposal-review` |

The worker's and validator's sources are in [`library/`](library/), the framework's in [`agent-loop-studio/library/`](agent-loop-studio/library/); the community library adds nothing yet. The [agent guide](AGENT_GUIDE.md) says what each role does. Two skills ship with them, as operating manuals the roles refer to: [`research-wiki`](skills/research-wiki/SKILL.md), the long-term memory, and [`browser-act`](skills/browser-act/SKILL.md), for rendered pages and browser sessions through the external browser-act CLI. `machine-config` writes a third, the project's `<project>-environment` skill. Optional literature, GPU platform and notification integrations stay in this repository and are not installed.

## Documentation

| Guide | Use it for |
| --- | --- |
| [Setup guide](SETUP_GUIDE.md) / [中文部署指南](SETUP_GUIDE_CN.md) | Deploying the two machines and operating the installation. |
| [Architecture](ARCHITECTURE_GUIDE.md) (in Chinese) | The design: loops, roles, trajectories, the trust boundary, benchmark integrity and who writes which file. |
| [Agent guide](AGENT_GUIDE.md) | Roles, loops and where things live, for an agent reading a project cold. |
| [Contributing](CONTRIBUTING.md) | Developing this package, its roles and loops, where framework changes go, and running focused checks. |
| [Packaging](docs/packaging.md) | Building the archive and how installation ownership works. |
| [agent-loop-studio](agent-loop-studio/README.md), [its architecture](agent-loop-studio/docs/architecture.md) | The framework: sessions, loops and roles, project packages, the Studio, libraries and contributions. |
| [agent-loop-community](agent-loop-community/README.md) | The shared library and what it accepts. |

## License

[MIT](LICENSE). Original ARIS copyright and attribution are retained.
