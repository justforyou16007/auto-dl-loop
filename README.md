# Contrejour

**An agent-loop framework on Claude Code, and the adversarial two-machine research task built on it.**

[中文](README.zh-CN.md) · [Quick start](#quick-start) · [Setup guide](SETUP_GUIDE.md) · [Architecture](ARCHITECTURE_GUIDE.md)

Contrejour runs agent work as **loops** of **roles** on Claude Code. A loop's definition, written in natural language, is the authority on what it does: which role does each step, what passes between them, where it branches and how often it may repeat. A Claude Code workflow script generated from that definition runs it. Each role is a Claude Code agent file holding everything about how its step is done. Every role's run is recorded as a **trajectory**, and the `trajectory-optimizer` role learns from them by fixing the roles. Loops and roles are shared through a **library** that projects install from and sync back to.

Its first application is a research task on two machines. The **worker** builds deliverables for a task and submits them. The **validator** owns a hidden benchmark that only grows, judges each submission as the worker's adversary, and publishes a verdict, how many tests passed out of how many, and leak-reviewed feedback. The worker improves from that feedback until the submissions run out.

Contrejour runs on Claude Code only: no Codex, no Paseo.

## Why loops of roles

Earlier versions gave one agent a numbered list of steps. Nothing but the agent's discipline kept the order. When a result was poor, nobody could tell which step was at fault, so an improvement could only edit the text, and might not take effect. And whatever worked stayed in one project. Contrejour answers each of these:

- **The order is fixed.** A script decides what runs when, not the agent.
- **Each step belongs to one role**, whose file says what it is responsible for, what it sees, what it returns and how to tell it did well. A problem can be traced to one role and fixed in one place.
- **Experience accumulates.** Roles are judged and fixed from their trajectories, and loops and roles reach other projects through the library.

The scripts only schedule. Open-ended work, such as implementing an idea with its experiments or finding a deliverable's problems, is left whole to one role: a pipeline that hard-codes the work itself becomes its ceiling, which is what happened to Contrejour's predecessor, ARIS.

Models also still judge their own results badly: tests written by the agent that built the deliverable are not credible. So the research application keeps building and judging on two machines that cannot see each other.

## Features

### Framework

- **Loops in natural language, run as scripts.** A loop's definition (`.claude/loops/<loop>.md`) names, for each step, the role that does it, what the role receives and returns, the condition it branches on, the bound of each repetition and where the loop waits. `loop-editor` generates the workflow script (`.claude/workflows/<loop>.js`) from it. A script only calls roles, orders and branches on their structured output, passes inputs between them and loops within a bound. It never says in a prompt how a step is done and never does the work in code, so a fix to a role file is never overridden by the script.
- **A compile check.** `loop-check` runs a script against stub roles, without calling a model, several times with different stub answers so every branch is reached. It reports unknown roles, loops that never stop, undeclared phases, roles no answer reaches, use of the clock or randomness (which breaks resuming a run) and a script older than its definition.
- **Roles are Claude Code agent files** (`.claude/agents/<role>.md`): responsibility, inputs, structured output, what the role may write, model and effort, and an Evaluation section with the signals by which it is judged. Tool lists isolate for real: a role given no file tools cannot read the wiki. A role with Bash relies on the rules in its file.
- **Trajectories teach the roles.** A hook copies every finished role's transcript into the project. After each worker round and each validator review, `trajectory-optimizer` judges each role against its own Evaluation section and fixes the role file where a problem recurs. Validator roles change only through proposals the owner approves.
- **Hooks only record, notify or block.** Setup registers them once; which actions run is declared in the loop definitions.
- **A shared library.** Installation seeds a project's roles and loops from the `library/` directory of the Contrejour repository; from then on they are the project's own. When the task ends, `loop-query` syncs them back on a branch for the maintainers to review and merge.
- **Roles for the owner.** `loop-editor` creates and changes loops, only at the owner's request; `loop-query` finds an existing loop before a new one is written; `role-creator` adds a role when a step is missing; `trajectory-optimizer` fixes roles.

### Independent, measured validation

- **Two machines, one channel.** The worker and the validator share no disk, repository or messages, only the validation service's four MCP tools and the upload of each zip. `task` hands the worker the validator's `task.md` byte for byte, so both sides work to the same text, and an edit on the validator reaches the worker at its next fetch. `requirements` gives the worker the deliverable's terms up front: zip checks and limits, what `USAGE.md` must state, the calling interface, the runtime environment, the review time limit and what each verdict means. `submit` reserves a one-time upload URL; `query` reports the state, the submissions left and each submission's result. Cheating is prevented by separation rather than by rules: the worker cannot read the benchmark.
- **Append-only benchmark.** The base layer's source, data revision, split, sample count, runners and per-sample pass rule are frozen at setup. During reviews, `test-extender` adds layers (`inc-001`, …) whose tests are each derived from existing tests, never invented. The layers live in a git repository only the helper commits to; every commit may only add files, and the helper checks the history commit by commit. A wrong layer is retired, never edited, and any change stops the service.
- **Measured test results.** Each sample is one test, passed or failed by the frozen pass rule (`metric`, `op`, `threshold`), which the helper applies to complete per-sample runner output. Results report how many tests passed out of how many. There is no score, and submissions are not compared, because the benchmark keeps growing. The worker never reports its own results.
- **Adversarial review as a loop.** For each submission the service starts a Claude Code background session that runs the `submission-review` loop: inspect the code before anything runs, install the deliverable as documented and write its adapter, rerun every layer, hunt for more problems and add derived tests, write the verdict (`valid`, `cheating` or `unusable`) and feedback, have the feedback leak-reviewed, publish, record, and propose role fixes. A `cheating` verdict voids every test result.
- **Leak-reviewed feedback.** Feedback names the real problems: what goes wrong, which requirement of `task.md` it breaks, roughly how often, how severe, and which earlier problems were solved or persist. It may describe how tests are constructed, never the actual tests. `leak-reviewer` checks it against every hidden test from a fresh context; the loop starts it, so the feedback's author cannot shape what it sees. The review is bound to the feedback's digest, and if every permitted rewrite still leaks, only the verdict and counts are published.
- **Supervised reviews.** The service continues a review session that stops before publishing; a session that was removed or cannot be continued fails its submission without counting it. A review the validator's side cannot complete (its machine lacks what was promised, a helper fails) is abandoned uncounted, so the worker can submit again at once.
- **Defined stopping.** The task closes only when the counted submissions are used up; passing every current test does not end it. Upload, format and infrastructure failures do not count.

### Research rounds with memory

- **One round, seven steps.** The worker's `research-iteration` loop chooses open problems; has five ideators propose one idea each (three see the wiki, one knows only the ideas that failed, one knows only the task and the problems); scores the ideas and ranks the whole pool with `rank_ideas`, which adds an exploration bonus for directions tried less; implements the top idea with its experiments; and submits one commit. Once the result is published, it records the result and fixes the roles. Rounds repeat until the task closes.
- **Research wiki.** Each machine's `research-wiki` records, for one or more problems, what existing work did, which ideas and experiments were tried, and which were effective or ineffective, linked by typed evidence edges. Only the memory role writes it. Every round starts from its query pack, a summary of at most 1000 characters. The validator's wiki records which problems each submission solved and which persist, never test content.
- **Environment section and environment skill.** Facts about the machine (hosts, paths, environments, resources, where metrics land, verified pitfalls) live in the environment section of `CLAUDE.md`. Every role reads that file, so the section holds the environment only. Fixed procedures (sync code, launch a named run, check it, fetch results, stop it) are verified scripts in the project's environment skill, and each run has its own name, so several experiments run at once. Keys and tokens stay in `.contrejour/environment.json`.

### Local, ownership-aware installation

The installer copies the compiled helpers, the `research-wiki` and `browser-act` skills, the library's roles and loops and the runtime dependencies from your prepared local checkout. It downloads nothing and writes only into the project. Updates replace only the files Contrejour owns; seeded loops and roles, tasks, wikis, benchmarks, submissions and settings stay as the project has them.

## How it works

1. **Define the task.** On the validator machine, write `task.md` and confirm one configuration sheet with the setup role: the benchmark, the per-sample pass rule, the submission budget, how review sessions start and the service address. Apply freezes it; then start the service.
2. **Build.** On the worker machine, the setup role fetches `task.md` through the service. A Claude Code session opened in the project runs as the task manager and, when asked, runs the `research-iteration` loop round after round.
3. **Submit.** Each round ends with one commit, built into a zip with `USAGE.md` and uploaded to a one-time URL.
4. **Review.** The service starts a review session for the submission, which runs the `submission-review` loop and publishes the verdict, the test counts and leak-reviewed feedback.
5. **Learn.** The worker's memory records the result and the problems it names, `trajectory-optimizer` fixes the roles on both sides, and the next round starts from the open problems.
6. **Finish.** When the submissions are used up the task closes, and each side syncs its loops and roles to the library; the validator's go only after a leak review and the owner's approval.

Keep the two projects on separate machines with no shared or synchronized directory: that is what keeps the hidden benchmark out of the worker's reach. See the [architecture guide](ARCHITECTURE_GUIDE.md) for the boundaries of evaluation and feedback.

## Quick start

### Prerequisites

On each machine:

- **Bash**, **Git** and **Node.js 22.12+**.
- **Claude Code**, installed and signed in.

The validator machine also needs your benchmark's dependencies. On Windows, run the installer in Git Bash with Node.js on `PATH`; the [setup guide](SETUP_GUIDE.md) covers the Windows command for review sessions and networking.

### Install into each project

Use a local Contrejour checkout on each machine and prepare it explicitly:

```bash
cd /path/to/local/contrejour-checkout
npm ci
npm run build
```

On the **validator** machine:

```bash
bash distribution/install-contrejour.sh --role validator --project /path/to/project
```

On the **worker** machine:

```bash
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

The side stays with the project. Installation reads only the prepared checkout and downloads nothing; missing dependencies or compiled helpers cause an error. Without a checkout on the target machine, use the offline archive's `install.sh` with the same options.

### Set up the two sides

The validator comes first, because the worker's setup fetches `task.md` from the running service:

```bash
cd /path/to/validator-project
claude --agent validator-setup                                   # accept the folder trust prompt the first time
node .contrejour/dist/tools/validation-cli.js serve --project .  # once setup is done; keep it running
```

Review sessions are Claude Code background sessions, which only start in a trusted folder; hence the trust prompt. Setup returns the worker connection, a URL and a token; pass it to the worker machine privately. If the validator machine already provides `CONTREJOUR_URL` and `CONTREJOUR_TOKEN`, setup uses them instead of asking for an address and creating a token.

Then the worker:

```bash
cd /path/to/worker-project
claude --agent worker-setup     # enter the connection; setup fetches task.md
claude                          # runs as worker-task-manager
```

In that last session, ask it to start the `research-iteration` loop, and leave the session open.

Follow the **[full setup guide](SETUP_GUIDE.md)** or **[中文部署指南](SETUP_GUIDE_CN.md)** for the configuration sheet, networking, how a submission is reviewed, updates and troubleshooting.

## What is included

| Side | Roles | Loop |
| --- | --- | --- |
| Framework, in every project | `loop-editor`, `loop-query`, `role-creator`, `trajectory-optimizer` | — |
| Worker | `worker-setup`, `worker-task-manager` (entry), `worker-memory`, `problem-selector`, `ideator-informed`, `ideator-failures-only`, `ideator-blank`, `idea-assessor`, `implementer` | `research-iteration` |
| Validator | `validator-setup`, `validator-task-manager` (entry), `validator-memory`, `inspector`, `adapter-writer`, `regression-runner`, `test-extender`, `verdict-writer`, `leak-reviewer` | `submission-review` |

Their sources are in [`library/`](library/), and the [agent guide](AGENT_GUIDE.md) says what each role does. Two skills ship with them, as operating manuals the roles refer to: [`research-wiki`](skills/research-wiki/SKILL.md), the long-term memory, and [`browser-act`](skills/browser-act/SKILL.md), for rendered pages and browser sessions through the external browser-act CLI. Setup writes a third, the project's `<project>-environment` skill. Optional literature, GPU platform and notification integrations stay in the source repository and are not in the standalone package.

## Documentation

| Guide | Use it for |
| --- | --- |
| [Setup guide](SETUP_GUIDE.md) / [中文部署指南](SETUP_GUIDE_CN.md) | Deploying the two machines and operating the installation. |
| [Architecture](ARCHITECTURE_GUIDE.md) (in Chinese) | The design: loops, roles, trajectories, the trust boundary, benchmark integrity and who writes which file. |
| [Agent guide](AGENT_GUIDE.md) | Roles, loops and where things live, for an agent reading a project cold. |
| [Contributing](CONTRIBUTING.md) | Developing Contrejour, its roles and its loops, and running focused checks. |
| [Packaging](docs/packaging.md) | Building the archive and how installation ownership works. |

## License

[MIT](LICENSE). Original ARIS copyright and attribution are retained.
