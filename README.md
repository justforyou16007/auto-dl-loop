# Contrejour

**An adversarial research task on two machines, run as agent loops on Claude Code.**

[中文](README.zh-CN.md) · [Quick start](#quick-start) · [Setup guide](SETUP_GUIDE.md) · [Architecture](ARCHITECTURE_GUIDE.md)

Contrejour runs one research task on two machines. The **worker** builds deliverables for a task and submits them. The **validator** owns a hidden benchmark that only grows, judges each submission as the worker's adversary, and publishes a verdict, how many tests passed out of how many, and leak-reviewed feedback. The worker improves from that feedback until the submissions run out.

On both machines the work runs as **loops** of **roles**, on the [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio) framework. A loop's definition, written in natural language, is the authority on what it does: which role does each step, what passes between them, where it branches and how often it may repeat. A Claude Code workflow script generated from that definition runs it. Each role is a Claude Code agent file holding everything about how its step is done. Every role's run is recorded as a **trajectory**, and the `trajectory-optimizer` role learns from them by fixing the roles. The owner chooses, tries, changes and runs a project's loops in the **Studio**, a console in the browser.

Contrejour runs on Claude Code only: no Codex, no Paseo.

## Three repositories

This repository, auto-dl-loop, holds the research task. The framework and the shared library are repositories of their own, which it carries as git submodules:

| Repository | What it holds |
| --- | --- |
| [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio), at `agent-loop-studio/` | The framework: loops that schedule roles on Claude Code, the helpers that check and run them, the Studio, the installer, and the base loops and roles every project gets, such as `setup`, `loop-trial`, `loop-authoring`, `owner-review` and `trajectory-optimizer`. |
| [agent-loop-community](https://github.com/justforyou16007/agent-loop-community), at `agent-loop-community/` | The shared library: the loops and roles owners chose to contribute from their projects, for other projects to use. It is empty for now. |
| auto-dl-loop, this one | The research task: `project.json`, which tells the framework about the two kinds of machine; the research helpers (the validation service, the configuration sheet, the worker's ledger, the wiki); the worker's and the validator's loops and roles in `library/`; skills, templates and tests. |

Dependencies point one way: this package pins a version of each, and neither depends on it. The framework and the shared library stay free of anything that belongs to one project, and this package moves to a newer framework only when it chooses to.

## Why loops of roles

Earlier versions gave one agent a numbered list of steps. Nothing but the agent's discipline kept the order. When a result was poor, nobody could tell which step was at fault, so an improvement could only edit the text, and might not take effect. And whatever worked stayed in one project. Contrejour answers each of these:

- **The order is fixed.** A script decides what runs when, not the agent.
- **Each step belongs to one role**, whose file says what it is responsible for, what it sees, what it returns and how to tell it did well. A problem can be traced to one role and fixed in one place.
- **Experience accumulates.** Roles are judged and fixed from their trajectories, and what an owner chooses to contribute reaches other projects through the community library.

The scripts only schedule. Open-ended work, such as implementing an idea with its experiments or finding a deliverable's problems, is left whole to one role: a pipeline that hard-codes the work itself becomes its ceiling, which is what happened to Contrejour's predecessor, ARIS.

Models also still judge their own results badly: tests written by the agent that built the deliverable are not credible. So Contrejour keeps building and judging on two machines that cannot see each other.

## Features

### From the framework

The research task gets these from agent-loop-studio; its [README](https://github.com/justforyou16007/agent-loop-studio#readme) and [architecture notes](agent-loop-studio/docs/architecture.md) say more.

- **Loops in natural language, run as scripts.** A loop's definition (`.claude/loops/<loop>.md`) names, for each step, the role that does it, what the role receives and returns, the condition it branches on, the bound of each repetition and where the loop waits. `loop-editor` generates the workflow script (`.claude/workflows/<loop>.js`) from it. A script only calls roles, orders and branches on their structured output, passes inputs between them and loops within a bound. It never says in a prompt how a step is done and never does the work in code, so a fix to a role file is never overridden by the script.
- **A compile check.** `loop-check` runs a script against stub roles, without calling a model, several times with different stub answers so every branch is reached. It reports unknown roles, loops that never stop, undeclared phases, roles no answer reaches, use of the clock or randomness (which breaks resuming a run) and a script older than its definition.
- **A trial on a small scale.** A passing check shows that every step can be reached and every role exists, not that the loop does what you want. [`loop-trial`](agent-loop-studio/library/loops/framework/loop-trial.md) runs the static check, then runs the loop for real on a small scale, with the arguments its definition declares (`trial-args`) so that the run stays inside the project. `loop-tester` reports what the run did against your goal, and you judge it. If it falls short, `loop-authoring` changes the loop, `trajectory-optimizer` fixes its roles from the trial, or both, and it is tried again, at most four rounds. A loop that declares no `trial-args` cannot be tried.
- **Roles are Claude Code agent files** (`.claude/agents/<role>.md`): responsibility, inputs, structured output, what the role may write, model and effort, and an Evaluation section with the signals by which it is judged. Tool lists isolate for real: a role given no file tools cannot read the wiki. A role with Bash relies on the rules in its file.
- **Trajectories teach the roles.** A hook copies every finished role's transcript into the project. After each worker round and each validator review, `trajectory-optimizer` judges each role against its own Evaluation section and fixes the role file where a problem recurs. The fixes stay in the project. Validator roles change only through proposals the owner accepts in the `proposal-review` loop, because the validator's trajectories hold hidden tests that must never find their way into a role.
- **Hooks only record, notify or block.** The installer registers them once; which actions run is declared in the loop definitions. The framework's two actions record every role's trajectory and check, before any loop runs, that every answer a session passes in is a message the owner typed after the loop asked, unchanged. This package adds two in its `project.json`: one tells the validation service that a review session stopped early, the other keeps the validator's roles away from the benchmark, the hidden data and the files only the helpers write.
- **No flow outside a loop.** A session only starts loops and carries the owner's answers into them; loops schedule roles; roles do the steps. A role never runs another role, and a decision of the owner's is an `owner-review` step of a loop. Workflow agents cannot ask a person anything, so a loop stops at that step, the session shows the owner a review note, and the loop resumes with the reply.
- **New loops and roles start from existing ones.** `loop-authoring` has `loop-query` find the loops a requested loop can be built on, and `loop-editor` builds it on the closest; `role-authoring` has `role-creator` find the roles that already do the work and build on the closest. Either writes from scratch only when the owner asks. Drafts reach the project only once the owner approves that exact version.
- **The Studio.** `studio.js` is the owner's console in a browser on the same machine. A project not set up yet opens with its `setup` loop on the canvas. Say what loop you want in its chat: it lists the close ones, each previewable as a flow, and draws the closest on a canvas with its parameters beside the steps they affect. Point at steps or arrows and say what to change, or ask for a role, and `loop-authoring` or `role-authoring` drafts it in a background session and stops for your review, with the draft on the canvas. There you also choose the loop the project runs and its parameter values, run any loop and watch its steps, try one with **Trial**, beside **Run**, and keep several projects: start one from a reference project, or copy one. Only the browser signed in with its one-time link can use it, and it answers only on the machine's own address. `loop-view.js` shows the same loops on a read-only page.
- **Libraries shared between projects.** Installation seeds a project with the framework's base loops and roles, the community's, and the worker's or validator's from this package. Where names meet, this package's comes first, then the community's, then the framework's. From then on they are the project's own, and a copy of each as seeded is kept, which later tells the project's changes from the library's.

### Setting up a machine

A research machine is set up in this order: install, accept the trust prompt, `configure`, `setup`, optionally `loop-trial`, then start.

- **`configure` configures the machine.** It is the research task's own loop, run first and on its own, and the validator goes first. `validator-config` or `worker-config` does its steps, through `config-cli.js`. On the [validator](library/loops/validator/configure.md): Requirement → Task (`task.md`) → Sheet (the benchmark, the terms and the service) → Apply → Environment → Report, which names the service command and the connection the worker needs. On the [worker](library/loops/worker/configure.md): Sheet (the connection to the validator, from which `task.md` is fetched) → Apply → Environment → Report. What a machine needs is gathered on one configuration sheet, and only the version the owner approved is applied. Run it again when something about the machine changes.
- **`setup` sets up the project's workflow, and only that.** Every project has the framework's [`setup`](agent-loop-studio/library/loops/framework/setup.md) loop, whatever it is built for. It has four steps. **Goal** takes what the owner wants the project's work to be, in their words; it reads `task.md` if there is one and never writes it. **Task loop** settles what the project runs: `loop-query` finds the task loops that fit, `project-setup` proposes one with parameter values, and the owner approves it or says what to change; `loop-authoring` builds or changes a loop when the owner asks. The choice is recorded in `.contrejour/loop.json`. **Check** runs the loop and role checks and regenerates any stale script. **Hand off** gives the owner a report that says how to try the workflow and how to start, and `project-cli.js finish-setup` writes `.contrejour/setup.json`, which marks the project as set up. The Studio opens a project not yet set up with `setup` on the canvas, and `start` in a session of such a project runs setup.
- **`loop-trial` tries the workflow before the real work.** On the worker it tries `research-iteration` with that loop's `trial` argument: one real round, experiments included, that stops after Build, before Submit, so nothing reaches the validator and no submission is used. `submission-review` cannot be tried, because it needs a real submission.
- **The owner chooses the loop.** Each project runs one task loop: normally `research-iteration` on the worker and `submission-review` on the validator. A loop declares its parameters with defaults, so tuning it means choosing values, not editing it; another loop, or one `loop-authoring` builds, can take its place. To change the choice after setup, run `setup` again, or use the Studio or `project-cli.js use`.

### Optimizing and contributing

- **Optimization stays in the project.** `trajectory-optimizer` fixes roles from their trajectories, in the project. On the worker it fixes the role file and commits each fix. On the validator it only proposes, and a fix takes effect when the owner accepts it in `proposal-review`. Nothing is sent anywhere automatically.
- **Contributing is the owner's choice** ([`library-contribution`](agent-loop-studio/library/loops/framework/library-contribution.md)). Once a task has finished (one submission's result was published), and whenever the owner decides to, this loop lists the project's new and changed loops and roles, with a judgement of each. The owner chooses what goes and reviews exactly that. Everything chosen goes to the community library, agent-loop-community, as one pull request. A changed one is merged three ways with the community's version. A project's version of a framework loop or role may go there too, and then takes the framework's place in projects that carry the community library. The community's [README](agent-loop-community/README.md) says what it accepts.
- **A leak check on the validator.** A validator role may describe how tests are constructed but must never contain an actual test. So on the validator the loop first runs the validator's own [`contribution-check`](library/loops/validator/contribution-check.md): `leak-reviewer`, from a fresh context, checks exactly the files that would leave against the hidden tests and records its verdict on the plan's digest, and nothing leaves without a pass. It takes the place of the framework's default `contribution-check`, where the owner checks the files.

The `library-contributor` role does the loop's steps, through `library-cli.js`. The helper compares each file with the copy kept at installation and with the community's current version, so a file the project left alone is never sent and nothing undoes anyone else's work. It refuses a file holding a key, a token, a hidden path or an injection pattern, warns about paths of this machine, and binds the plan to a digest, so what leaves is what the owner approved. The community's maintainers review and merge.

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

The installer comes from the framework and runs from this package's prepared checkout. It copies into the project the compiled helpers (the framework's and this package's), the `research-wiki` and `browser-act` skills with the shared references, the loops and roles of the three libraries, and the runtime dependencies. It writes the hooks and the side's entry role into `.claude/settings.json`, so the hooks guard every loop and every session is the side's task manager from the start. It downloads nothing and writes only into the project; it configures nothing and chooses no loop, which are the work of `configure` and `setup`. Updates replace only the files the installer owns; seeded loops and roles, tasks, wikis, benchmarks, submissions and settings stay as the project has them.

## How it works

1. **Define the task.** On the validator machine, run the `configure` loop. It writes `task.md` with you and has you confirm one configuration sheet: the benchmark, the per-sample pass rule, the submission budget, how review sessions start and the service address. Applying the sheet freezes the terms. Then run `setup`, which has you approve the review loop, normally `submission-review`, and its parameter values, checks the loops and hands off; then start the service.
2. **Build.** On the worker machine, run `configure` with the connection the validator gave you; it fetches `task.md` through the service. Then run `setup` and approve the research loop, normally `research-iteration`, and its parameter values, and try a round with `loop-trial` if you like. A Claude Code session opened in the project runs as the task manager, and `start` runs that loop round after round.
3. **Submit.** Each round ends with one commit, built into a zip with `USAGE.md` and uploaded to a one-time URL.
4. **Review.** The service starts a review session for the submission, which runs the chosen loop, `submission-review`, and publishes the verdict, the test counts and leak-reviewed feedback.
5. **Learn.** The worker's memory records the result and the problems it names, `trajectory-optimizer` fixes the roles on both sides (on the validator, through proposals the owner accepts), and the next round starts from the open problems.
6. **Contribute and finish.** Once a submission has finished, each side's owner can, when they decide to, run `library-contribution` and choose which of the project's new and changed loops and roles go to the community library; on the validator, a leak check comes first. When the submissions are used up the task closes.

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

The side stays with the project. Installation reads only the prepared checkout and downloads nothing; missing dependencies or compiled helpers cause an error. The installer writes the hooks and the entry role, so every session in the project is the side's task manager from the start, and prints what to do next, including this side's note from `project.json`. It records the checkout in the project, because that is where the project finds the libraries, both for loops it does not have yet and for the pull request a contribution opens. Without a checkout on the target machine, use the offline archive's `install.sh` with the same options; a loop that needs a checkout later offers to fetch one.

### Set up the two machines

On each machine the order is the same: accept the trust prompt, `configure`, `setup`, then start; on the worker, `loop-trial` can try a round before the start. Go through it on the validator first: the worker's `configure` fetches `task.md` from the validator's running service, and that service can start only after the validator's `setup` has chosen the review loop.

```bash
cd /path/to/validator-project
claude                                                 # once, to accept the folder trust prompt; then quit
node .contrejour/dist/tools/studio.js --project .      # prints a one-time sign-in link
```

Open the link in a browser on that machine (from another machine, forward the port first: `ssh -L 8790:127.0.0.1:8790 <machine>`). The project is not set up yet, so the Studio opens with the `setup` loop on the canvas, but `configure` comes first: choose it in the list of loops above the canvas and press **Run**. It stops for you to say what the machine should validate, to review `task.md` and to confirm the configuration sheet, and the Studio's chat asks you each time. Then choose `setup` and press **Run**: it asks what you want from the project's work if `task.md` does not already say, and has you approve the review loop (normally `submission-review`) with its parameter values. The same works from a terminal, one session for each:

```bash
claude "Run the configure loop"
claude "Run the setup loop"
```

When setup has handed off, start the validation service with the command `configure`'s report names, and keep it running; it starts one review session per submission:

```bash
node .contrejour/dist/tools/validation-cli.js serve --project .
```

Background sessions, the Studio's and the reviews', only start in a trusted folder; hence the trust prompt. `configure`'s report also gives the worker's connection, a URL and a token: pass it to the worker machine privately. If the validator machine already provides `CONTREJOUR_URL` and `CONTREJOUR_TOKEN`, `configure` uses them instead of asking for an address and creating a token.

Then the worker, the same way, in the Studio or from a terminal. Its `configure` asks for the connection and fetches `task.md` through the validator's service; its `setup` has you approve the research loop (normally `research-iteration`) with its parameter values:

```bash
cd /path/to/worker-project
claude                                                 # once, to accept the folder trust prompt; then quit
claude "Run the configure loop"
claude "Run the setup loop"
```

To try a round before the real ones, press **Trial** beside **Run** in the Studio with `research-iteration` on the canvas, or run:

```bash
claude --permission-mode bypassPermissions 'Run the loop-trial loop with args {"loop": "research-iteration", "goal": "<what a round should achieve>"}'
```

It is a real round, with real experiments, whose work stays in the project: it stops after Build, so nothing reaches the validator and no submission is used. You then judge its report against your goal, and what you want changed is fixed before the next trial.

Then start the rounds:

```bash
claude --permission-mode bypassPermissions "start"     # runs as worker-task-manager, round after round
```

Leave that session open: it runs round after round on its own, which is why it needs a permission mode that does not wait for approvals (`auto` is the more cautious choice; see the setup guide). Keep its first message to "start", because every role of the loop receives the message that started the run. To start the rounds from the Studio instead, first open `claude` in the project once more and approve the `contrejour` server: a background session cannot ask.

To reconfigure a machine later, run `configure` again; afterwards, restart a validator's running service, so it serves the applied address and token. To change the task loop or its values, run `setup` again, or use the Studio or `project-cli.js use`.

Follow the **[full setup guide](SETUP_GUIDE.md)** or **[中文部署指南](SETUP_GUIDE_CN.md)** for the configuration sheet, networking, how a submission is reviewed, updates and troubleshooting.

## What is included

| Part | Roles | Loops |
| --- | --- | --- |
| Framework, in every project | `project-setup`, `loop-query`, `loop-editor`, `role-creator`, `loop-tester`, `owner-review`, `trajectory-optimizer`, `library-contributor`; also `task-manager` and `project-memory`, which the research sides do not use: they have their own task managers and memory roles | `setup`, `loop-trial`, `loop-authoring`, `role-authoring`, `library-contribution`; also `contribution-check`, the default a side can replace |
| Worker | `worker-config`, `worker-task-manager` (entry), `worker-memory`, `problem-selector`, `ideator-informed`, `ideator-failures-only`, `ideator-blank`, `idea-assessor`, `implementer` | `research-iteration` (task), `configure` |
| Validator | `validator-config`, `validator-task-manager` (entry), `validator-memory`, `inspector`, `adapter-writer`, `regression-runner`, `test-extender`, `verdict-writer`, `leak-reviewer` | `submission-review` (task), `configure`, `contribution-check` (its own, in place of the framework's), `proposal-review` |

The worker's and validator's sources are in [`library/`](library/), the framework's in [`agent-loop-studio/library/`](agent-loop-studio/library/); the community library adds nothing yet. The [agent guide](AGENT_GUIDE.md) says what each role does. Two skills ship with them, as operating manuals the roles refer to: [`research-wiki`](skills/research-wiki/SKILL.md), the long-term memory, and [`browser-act`](skills/browser-act/SKILL.md), for rendered pages and browser sessions through the external browser-act CLI. `configure` writes a third, the project's `<project>-environment` skill. Optional literature, GPU platform and notification integrations stay in this repository and are not installed.

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
