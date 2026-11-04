# Contrejour

Contrejour is an adversarial research task on two machines, run as agent loops on Claude Code; its package is this repository, [auto-dl-loop](https://github.com/justforyou16007/auto-dl-loop), and this guide deploys it. The **worker** builds deliverables for `task.md` and submits them. The **validator** owns a hidden benchmark that only grows, reviews each submission as the worker's adversary and publishes a verdict, how many tests passed out of how many, and feedback on the problems it found. The two machines share nothing but the validation service's four MCP tools (`task`, `requirements`, `submit`, `query`) and the upload of each zip.

Both machines run on the [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio) framework. Work runs as **loops**: a loop's definition, written in natural language, says which **role** does each step, in what order and within what bounds, and a Claude Code workflow script generated from it schedules the roles exactly so. Each role is a Claude Code agent file that holds everything about how its step is done. Every role's run is recorded as a trajectory, from which the `trajectory-optimizer` role fixes the roles. The framework brings the helpers, the installer, the Studio (your console in a browser) and the base loops and roles every project starts with, among them `setup`, which sets up a project's workflow, and `loop-trial`, which tries a loop for real before its real work; the loops and roles projects contribute for one another go to [agent-loop-community](https://github.com/justforyou16007/agent-loop-community).

Contrejour runs on Claude Code only: no Codex, no Paseo. The design and its reasons are in `ARCHITECTURE_GUIDE.md` in the auto-dl-loop repository; the framework's own design is in `agent-loop-studio/docs/architecture.md`. [中文部署指南](SETUP_GUIDE_CN.md)

## What is where

auto-dl-loop is a project package: it holds what is particular to the research task, and carries the framework and the shared library as git submodules.

| Where | What |
| --- | --- |
| `project.json` | The two profiles a project can be installed as, `worker` and `validator`: for each, the role its sessions start as (`worker-task-manager`, `validator-task-manager`) and what to do after installing |
| `src/tools/` | The research task's helpers: machine configuration (`config-cli`), the validation service (`validation-cli`), the worker's ledger (`worker-cli`) and the research wiki |
| `library/loops/`, `library/roles/` | The worker's and the validator's loops and roles, under `worker/` and `validator/`, among them each side's `configure`, this package's own configuration of the machine |
| `skills/`, `templates/` | The skills and templates the roles use |
| `agent-loop-studio/` | Submodule: the framework, with its helpers, the Studio, the installer (`distribution/install.mjs`) and the base loops and roles, `setup` and `loop-trial` among them (`library/loops/framework/`, `library/roles/framework/`) |
| `agent-loop-community/` | Submodule: the community library, where projects contribute the loops and roles their owners choose, for other projects to use |

Dependencies point one way: auto-dl-loop pins a version of each submodule, and neither depends on it.

## Before you start

On both machines you need Bash, Git, Node.js 22.12+ and Claude Code, installed and signed in. The validator machine also needs whatever your benchmark needs to run. On Windows, run the commands below in Git Bash with Node.js on `PATH`; WSL is a separate Linux environment. Contrejour's use of Claude Code (background sessions, workflows, agents, hooks) was verified with Claude Code 2.1.316.

Create one project directory on each machine and never give them a shared disk, repository or synchronized directory: that separation is what keeps the hidden benchmark out of the worker's reach. Write `task.md` only on the validator; the worker fetches it.

## Prepare a checkout

Each machine installs from a local clone of auto-dl-loop, kept outside the project directory. Preparing it is the only step that downloads anything: Git fetches the package with both submodules, npm fetches what each of them needs, and then both are built.

```bash
git clone --recurse-submodules https://github.com/justforyou16007/auto-dl-loop.git
cd auto-dl-loop
npm ci                              # this package's dependencies
npm --prefix agent-loop-studio ci   # the framework's, including what builds the Studio's page
npm run build:framework             # the framework's helpers and the Studio's page
npm run build                       # this package's helpers, added beside the framework's in dist/
```

In a clone made without `--recurse-submodules`, run `git submodule update --init` first. Keep the order: `npm run build` starts from the framework's build and stops when there is none.

## Install

From the prepared checkout, install into the project with that machine's side:

```bash
bash distribution/install-contrejour.sh --role validator --project /path/to/project   # validator machine
bash distribution/install-contrejour.sh --role worker --project /path/to/project      # worker machine
```

The installer reads only the prepared checkout. It does not clone or update Git, install npm packages, download anything or need tar, and it writes only into the project, never into global configuration. Missing dependencies or compiled helpers stop it with the preparation steps. `--dry-run` reports what it would do and writes nothing.

Without a checkout on the target machine, use a release archive: there is one in `distribution/releases/`, and `npm run pack:contrejour` builds one from a prepared checkout into `artifacts/`. Copy it over, extract it outside the project and run its installer with the same options:

```bash
tar -xzf contrejour-0.1.0.tar.gz
bash contrejour/install.sh --role worker --project /path/to/project
```

What the installer puts in the project:

| Where | What | Afterwards |
| --- | --- | --- |
| `.contrejour/` | The compiled helpers (`dist/`, the Studio's page included), their runtime dependencies, the templates and the package's `project.json` | Updated by the installer |
| `.claude/skills/` | `research-wiki`, `browser-act` and the shared references | Updated by the installer |
| `.claude/agents/` | The framework's ten roles and the side's nine | Seeded, then the project's own |
| `.claude/loops/`, `.claude/workflows/` | Each loop's definition and its script: the framework's `setup`, `loop-trial`, `loop-authoring`, `role-authoring`, `library-contribution` and `contribution-check`; the side's own `configure`; and the side's task loop (`research-iteration` on the worker; on the validator `submission-review`, with `proposal-review` and a `contribution-check` of its own, a leak check, in place of the framework's) | Seeded, then the project's own |
| `.contrejour/seeded/` | A copy of each loop and role as it was seeded: the baseline that later tells what this project changed | Written when a file is seeded |
| `.contrejour/install.json` | The side, the checkout as the project's library, and the hashes of the files the installer manages | Rewritten by each installation |
| `.claude/settings.json` | Contrejour's hook registrations and the entry role, the side's task manager; your other settings and hooks stay | Written again by each installation |

Seeded loops and roles are written only where the project has none of that name, and an update never replaces or removes them, because they are meant to change: `trajectory-optimizer` fixes roles, and you change loops and add roles through `loop-authoring` and `role-authoring`. The copies in `.contrejour/seeded/` let the project tell its own changes from the library's, and the recorded checkout carries the community library, where the loops and roles you choose can go when you decide to ([What leaves a project](#what-leaves-a-project)). An installation from the archive records no library (an update from the archive keeps one recorded earlier), so contributing from it starts by fetching a checkout of the community library.

The side is fixed at installation: everything that follows reads it, and an update with the other side is refused, so use one project per side. Projects installed for Codex by earlier releases, and projects of the releases named ARL (data under `.aris/`), are refused rather than migrated: install into a fresh project, configure it and set it up again, and start a new `research-wiki/`. The installer no longer accepts `--provider`.

When it finishes, the installer prints what to do next, with the order for this side. The next section explains each step.

## After installing

An installed project has its loops and roles, but nothing yet of this machine's part in the task: no task, no benchmark or connection, no loop to run. Two separate loops settle that, and you run each yourself:

- **`configure`** is this package's own. It configures the machine: on the validator `task.md`, the benchmark, the validation terms and the service; on the worker the connection to the validator, through which it fetches `task.md`; on both, the machine's environment.
- **`setup`** is the framework's, the same in every project. It sets up the project's workflow and nothing else: which loop the project runs as its work, with which parameter values.

`configure` comes first, because the workflow is chosen for the task, and `task.md` is settled in `configure`.

### The order of the steps

On each machine:

1. **Install**, as above.
2. **Accept the folder trust prompt.** Open `claude` in the project once. Claude Code starts background sessions only in a folder it trusts, and the Studio and the validator's service both work through them.
3. **Configure the machine** with `configure` ([What configure does](#what-configure-does)).
4. **Set up the workflow** with `setup` ([What setup does](#what-setup-does)): normally `submission-review` on the validator and `research-iteration` on the worker.
5. **Try the loop, if you want to,** with `loop-trial` ([Trying a loop](#trying-a-loop)). This step is the worker's: `submission-review` needs a real submission, so it cannot be tried.
6. **Start.** On the validator, start the service with the command `configure`'s report names; from then on the service starts every review itself. On the worker, run `claude --permission-mode bypassPermissions "start"`.

Between the machines, the validator goes first, as far as a running service. The worker's `configure` fetches `task.md` from that service, and the service starts only after the validator's `configure`, which writes the terms and the token it reads, and the validator's `setup`, which chooses the review loop it runs:

```text
validator:  install → trust prompt → configure → setup → start the service → give the worker its connection
worker:     install → trust prompt → configure (fetches task.md) → setup → loop-trial (optional) → start
```

### Running a loop

Every session opened in the project starts as the side's task manager (`validator-task-manager` or `worker-task-manager`), because the installer writes it into `.claude/settings.json` as the entry role; the Studio starts its sessions as the task manager too. The task manager is the role that runs loops and carries your answers into them. There are two ways in:

- **The Studio**, your console for the project, in a browser on the same machine ([The Studio](#the-studio)). Start it in the project and open the sign-in link it prints:

  ```bash
  cd /path/to/project
  node .contrejour/dist/tools/studio.js --project .
  ```

  It answers only on this machine's loopback address; for a remote machine, forward the port first (`ssh -L 8790:127.0.0.1:8790 <machine>`). A project that is not set up yet opens with its `setup` loop on the canvas; to run another loop, `configure` first of all, pick it in the list above the canvas. Press **Run**: the loop runs in a background session and asks you in the chat whenever it needs a decision. What you type in the chat does not start a loop: until a loop asks you something, it asks for a change to the loop on the canvas, or finds close loops.

- **A session** in the project, one loop at a time:

  ```bash
  claude "Run the configure loop"
  claude "Run the setup loop"
  ```

  Saying `start` in a project that is not set up yet runs `setup` as well, but not `configure`.

### What configure does

`configure` is the research task's own configuration of the machine, apart from the project's workflow. Each side has its own: [`library/loops/validator/configure.md`](library/loops/validator/configure.md) and [`library/loops/worker/configure.md`](library/loops/worker/configure.md). The roles `validator-config` and `worker-config` do their steps, with the helper `.contrejour/dist/tools/config-cli.js`.

- **Validator:** Requirement (what this machine should validate) → Task (`task.md`) → Sheet (the benchmark, the terms, the service) → Apply → Environment → Report.
- **Worker:** Sheet (the connection to the validator, through which `task.md` is fetched) → Apply → Environment → Report.

You review the whole sheet and approve one version of it, and Apply writes exactly that. Environment then prepares the real machine. The report says what was settled and what comes next. `configure` starts no research and chooses no loop. [Validator machine first](#validator-machine-first) and [Worker machine](#worker-machine) go through each side's steps.

### What setup does

`setup` sets up the project's workflow: the loop the project runs as its work, and how. It has four steps, the same for every project. The definition is the framework's `agent-loop-studio/library/loops/framework/setup.md`, and the role `project-setup` does its own steps.

1. **Goal.** `project-setup` reads what you said about the work, with what the project already says about it: `task.md` when there is one, and its current task loop. When that is enough to choose a workflow, it restates the goal in a few lines; otherwise it asks you. Setup reads `task.md` and never writes it.
2. **Task loop.** The task loop is the project's work: the rounds the worker runs, or the review the validator runs for each submission. `loop-query` finds the task loops that fit the goal, in the project and its library, and `project-setup` proposes one, with values for its parameters. You approve, or say which loop or values you want instead. If none fits, or one should change, say so: `loop-authoring` builds or changes it as a step of setup, for your approval, and it is then proposed like the others. Your approval makes it the project's task loop, recorded in `.contrejour/loop.json`.
3. **Check.** The loop and role checks run over the project's loops. A stale or defective loop script is regenerated from its unchanged definition by `loop-authoring`, and the checks run again.
4. **Hand off.** You get a report: the goal, the task loop and its values, the checks, how to try the loop with `loop-trial`, how to start the work, and what you may do later. Then `project-cli.js finish-setup` writes `.contrejour/setup.json`: from now on the project is set up.

### Trying a loop

The loop check runs a script with stand-in roles: it shows that every step can be reached and every role exists, not that the loop does what you want. `loop-trial` checks a loop the way it will run. It works on any loop, before its real work or after a change, and the role `loop-tester` does its own steps.

1. **Static check.** The loop and role checks run first. A stale or defective script is regenerated from its definition; defects that remain end the trial.
2. **Trial run.** The loop runs for real, on a small scale, with the arguments its definition declares for a trial (`trial-args`). A loop that declares none, or that runs loops of its own, cannot be tried: the trial ends and says why.
3. **Report.** `loop-tester` reads what the run did against your goal and writes it up in `.contrejour/trials/<loop>/<round>.md`: what each step did and produced, and where it went another way than you want.
4. **Your judgement.** You read the report and decide whether what the loop did serves your goal. If it does, approve, and the trial ends.
5. **Improve.** If it does not, say what should be different: `loop-authoring` changes the loop's steps, with your review of the draft, and `trajectory-optimizer` fixes its roles from the trial (on the validator, as proposals). Then the loop is tried again, at most 4 rounds in all.

In the Studio, put the loop on the canvas and press **Trial**, beside **Run**: with no goal given, the report judges the run against the loop's own Purpose, and you say what you want when you answer it. In a session, name the goal:

```bash
claude --permission-mode bypassPermissions 'Run the loop-trial loop with args {"loop": "research-iteration", "goal": "<what the loop should achieve>"}'
```

A trial runs a real loop unattended, so it needs the same permission mode as the real work ([Start work](#4-start-work)). The goal travels in the message that starts the session, and a loop's roles receive that message, the blank ideator included, so keep it to what the loop should achieve, not how to solve the task.

The two task loops here differ:

- **`research-iteration`** declares `trial-args: {"stage": "build", "trial": true}`. A trial round stops after Build, before Submit, so nothing reaches the validator and no submission is used. It still does real work inside the project, which stays there: wiki entries, code, commits and a zip.
- **`submission-review`** declares no trial arguments, because it needs a real submission. A trial of it ends after the static check and says so.

### When a loop needs you

Whenever a loop needs you, it stops, and the session shows you a review note and a question: in the terminal, or in the Studio's chat for a loop the Studio runs. Your next message is the answer: the session hands it to the loop unchanged, and the loop continues where it stopped. Every decision below is made that way, by the `owner-review` step of the loop. (A role running inside a loop cannot ask you anything itself: Claude Code gives workflow agents no way to talk to the person, which is why the session carries the question and the answer. A hook checks that every answer reaching the loop is a message you typed, unchanged, after the loop asked that question.)

### Changing it later

Each part can be changed later on its own:

- **The machine's configuration**, such as the validation terms, the connection, a key or the environment: run `configure` again, from the Studio or with `claude "Run the configure loop"`. The workflow stays as it is.
- **The task loop or its parameter values**: in the Studio, put the loop on the canvas, open **Parameters**, set the values and choose **Use as this project's task loop**; or from a terminal in the project:

  ```bash
  node .contrejour/dist/tools/project-cli.js use --project . --loop <loop> --param <name>=<value>
  node .contrejour/dist/tools/project-cli.js show --project .
  ```

  Give one `--param` for each value that should differ from its default: the others take their defaults, not the values chosen before. `show` prints what the project runs. The next round or review uses the new choice.
- **The whole workflow**: run `setup` again. It goes through its four steps, starting from what the project has now, and leaves the machine's configuration as it is.

## Validator machine first

The worker's configuration fetches `task.md` from the validator's running service, so the validator goes first, as far as a running service: configure the machine, set up its workflow, start the service. Only then configure the worker.

### 1. Run `configure`

Install, accept the folder trust prompt, and run the validator's `configure`: in the Studio, pick it in the list above the canvas and press **Run**; or in a session:

```bash
cd /path/to/validator-project
claude "Run the configure loop"
```

The session runs as `validator-task-manager`, which runs the loop. Its steps are steps 2 to 5 below. Each decision comes to you as a review note and a question, as [When a loop needs you](#when-a-loop-needs-you) describes.

### 2. Say what you need, and the task

The configuration starts from your requirement: what this machine should validate. Say what the deliverables must do, what judges them, how many submissions the worker gets, and anything special about how reviews must run. The loop asks for it, and asks again for whatever is missing.

`task.md` at the project root is the whole task and the only statement of it the worker gets: the service hands it over through the `task` tool exactly as it stands, and an edit reaches the worker at its next fetch. If it is missing, `validator-config` writes it from your requirement and `.contrejour/templates/TASK_TEMPLATE.md`, as UTF-8 text, and you review it; the loop goes on once you approve it. A `task.md` you wrote yourself is left as it is, unless you ask for changes. It describes what to build, not how it is tested.

### 3. Review the configuration sheet

The review note shows the whole sheet at once, in the project language: every field with its options, a recommendation and any open issue. Answer with several changes in one reply, or edit `.contrejour/setup-draft.json` yourself and say so; `validator-config` turns your answer into changes, refreshes the sheet, and you see it again. A recommendation becomes a value only when you accept it. The review loop and its parameters are not on the sheet: they are `setup`'s to settle, after `configure` (step 6).

| Field | What it decides |
| --- | --- |
| `project.name`, `project.language` | The project's name, and `zh` or `en` for the sheet |
| `environment.secrets` | Only the keys and tokens the environment scripts need, as `{"NAME": "value"}`; `{}` when there are none. Hosts, paths and commands go in the environment section |
| `validation.benchmark` | The base layer, frozen at apply: pinned source and revision, dataset revision and split, the full sample count, the metrics, and argv runners for setup, healthcheck, smoke and test (write `python`, not `python3`, so they also run on Windows). Start from `.contrejour/templates/TESTER_FACILITY_CONFIG_TEMPLATE.json` and the runner protocol in `.contrejour/templates/README.md`; `.contrejour/templates/tester-benchmark/` is a worked lm-evaluation-harness example |
| `validation.pass_rule` | When one sample, which is one test, passes: a per-sample `metric`, an `op` (`>=`, `>`, `<=`, `<`, `==`) and a `threshold` |
| `validation.adapter_contract` | Exactly how your runner calls the adapter that `adapter-writer` writes for each submission |
| `validation.runtime_environment` | What a deliverable can rely on when it runs here: OS, Python and CUDA versions, GPU and memory, network access, time per input. The worker reads it through `requirements`, so it names no test data |
| `validation.limits` | Counted submissions (20 by default), reviews at once (1), upload size, unpacked size and file count, upload URL lifetime, the review time limit (24 hours), feedback rewrites after a leak (3) and the tests one review may add (200) |
| `validation.hidden_paths` | Absolute paths of the hidden samples, labels and references: the leak reviewer checks feedback against them, and no role may write them |
| `validation.agent` | How review sessions start: `model` (`null` keeps Claude Code's default), `permission_mode` and `claude_command`, below |
| `validation.service` | Where the service listens and how the worker reaches it: `host`, `port` and `public_url`; see [Network](#network) |

`validation.agent.permission_mode` is `bypassPermissions` (the default), which lets the benchmark and the deliverable's documented install use the network and paths outside the project, or `auto`, where a classifier reviews each step and may refuse some. Modes that wait for an approval are not offered, because nobody is there to give it.

`validation.agent.claude_command` is the argv that starts Claude Code, `["claude"]` by default; the sheet reports an issue unless it runs `--version`. On Windows an npm-installed `claude.cmd` cannot be started without a shell: use the native `claude.exe`, or `["node", "<npm prefix>\\node_modules\\@anthropic-ai\\claude-code\\cli.js"]`.

`validation.service.port` is required, because the service always listens on a fixed port (8765 by default).

If the machine already provides the service's address and token as `CONTREJOUR_URL` (the root address, without `/mcp`) and `CONTREJOUR_TOKEN` (at least 32 characters), the configuration uses them as they are: `public_url` is taken from `CONTREJOUR_URL` and cannot be edited in the sheet (unset the variable to enter another address), and apply keeps `CONTREJOUR_TOKEN` as the service token instead of creating one. They are read when the loop runs; after changing either, run `configure` again to review, confirm and apply, then restart the service.

### 4. Confirm and apply

When the sheet has no issues, the review note shows its `configuration_sha256`. Approve that version and the loop confirms and applies it. Any later edit, `task.md` included, needs a new confirmation, and asking for a change is not approval.

Apply then:

- runs the benchmark's setup, healthcheck and smoke commands, and freezes the base layer (`.contrejour/tester-config.json`) and the terms (`.contrejour/validation/config.json`);
- creates the service token in `.contrejour/validation/token`, or takes `CONTREJOUR_TOKEN`; applying again keeps the token, so the worker's copy stays valid;
- writes `environment.secrets` to `.contrejour/environment.json` (mode 0600) and adds `.contrejour/` to `.gitignore`, because it holds credentials;
- writes `.claude/settings.json`: the entry role `validator-task-manager`, the hook registrations, and `worktree.bgIsolation: "none"`, so that background sessions may edit files in a git checkout without first creating a worktree. Your other settings stay;
- writes two blocks in `CLAUDE.md`: the role block between the `CONTREJOUR ROLE` markers (the rules every validator role follows) and an empty environment section between the `CONTREJOUR ENVIRONMENT` markers. The rest of the file is left alone.

Apply leaves the review loop alone: setup chooses it next. It returns `service_command` (the command that runs the service), `worker_connection` (the `url`, which is `public_url` plus `/mcp`, and the `token` the worker's configuration needs) and `from_environment` (which of `CONTREJOUR_URL` and `CONTREJOUR_TOKEN` it used), along with the files it wrote, the entry role and `environment_skill_dir`, where the environment skill goes.

The entry role is set in the settings rather than in `CLAUDE.md` because every role reads `CLAUDE.md`. That file holds only what all of them must know: the side's rules and the machine's environment.

### 5. Environment, wiki and report

`validator-config` then works on the real machine. It creates `research-wiki/`, writes the scripts of the environment skill and runs each once, and records what every role must know about this machine in the environment section ([Where experience goes](#where-experience-goes)). When the environment needs a fact only you have, you are asked.

The configuration ends with its report: the requirement as confirmed, what apply wrote, each environment script and whether its real run passed, anything it could not make work with the real error, the `worker_connection`, and what comes next: `setup`, then the command that runs the service.

### 6. Set up the workflow: choose the review loop

Now run `setup`: in the Studio, with `setup` on the canvas (pick it in the list if `configure` is still there), press **Run**; or run `claude "Run the setup loop"`. Its work here is the loop that reviews each submission. From your words and `task.md` it settles the goal, then proposes the loop that fits, normally the library's `submission-review` ([How a submission is reviewed](#how-a-submission-is-reviewed)), with values for its parameters:

| Parameter | Default | What it decides |
| --- | --- | --- |
| `max_adapter_fixes` | 2 | How many times an adapter defect the full runs exposed goes back to `adapter-writer` |
| `max_extension_rounds` | 3 | Rounds of hunting for problems and adding tests per review; `limits.max_new_tests_per_review` still caps the tests added |
| `max_leak_reviews` | 5 | Leak reviews per run of the loop; `limits.feedback_attempts` still decides when feedback is withheld |

Approve it, or say which values or which loop you want instead. If reviews here must run differently, describe what you need: `loop-authoring` builds it on the closest loop, as a step of setup, for your approval, and setup then proposes it. The service runs the loop you choose once per submission, with `{submission_id, submission_dir, params}` as its arguments. A new loop takes those, and ends with `validator-task-manager` finalizing the review or abandoning one the validator's side cannot complete, so nothing reaches the worker except what finalize publishes. Your approval records the loop and its values in `.contrejour/loop.json`.

### 7. Checks and hand-off

Setup then runs the loop and role checks (`loop-check.js check` and `roles`): a stale or defective loop script is regenerated from its unchanged definition, by `loop-authoring` as a step, and checked again.

It ends with the hand-off, a report for you: the goal, the review loop and its parameter values, the checks with anything left to fix, how to start the service, and what you may do later. The validator's workflow is now set up. There is no trial to run here: `submission-review` needs a real submission ([Trying a loop](#trying-a-loop)).

### 8. Start the service

From the project root, run the service command from `configure`'s report and keep it running for the whole task, for example in a terminal multiplexer (tmux, screen) or as an OS service (systemd, a Windows service or a scheduled task):

```bash
node .contrejour/dist/tools/validation-cli.js serve --project .
```

The service comes last because it needs what both loops settle: the terms and the token from `configure`'s apply (without them it refuses to start with `VALIDATION_NOT_CONFIGURED`), and the review loop from `setup` (without one, `LOOP_NOT_SELECTED`). It reads the frozen configuration and the token when it starts, so restart it after any new apply. The loop and its parameters are read each time a review starts: choosing another loop or other values changes the next review, never one already under way. Check the validation state with:

```bash
node .contrejour/dist/tools/validation-cli.js status --project .
```

Give the `worker_connection` URL and token from `configure`'s report to the worker's owner over a private channel. You start no review yourself: the service starts one per submission. To change the terms later, run `configure` again and restart the service after its apply; to change the review loop or its parameter values, see [Changing it later](#changing-it-later).

### The benchmark only grows

The base layer and the pass rule are frozen at apply. Once a submission has been counted against them, changing either needs a new validator project; the sheet reports the attempt as an issue. Later tests come from `test-extender` during reviews. Each is derived from tests already in the benchmark (it records `derived_from`, `variation` and `reference_check`) and is registered with `validation-cli.js extend` as part of a new layer (`inc-001`, `inc-002`, …). Each layer is one commit that only adds files to the helper's git repository `.contrejour/validation/benchmark/`, whose head the helper records in `.contrejour/validation/benchmark-head`, and the helper checks the history commit by commit. A wrong layer is retired with `validation-cli.js retire`, itself an added file; it is never edited. A change to the frozen base layer, its evidence files or the layer history stops the service, and a hook blocks every role's direct writes to the benchmark, its frozen configuration and the hidden data.

## Network

The worker must reach three paths under `public_url`: `/mcp` (the four tools), `/upload/…` (the one-time upload URLs, an HTTP PUT of the zip) and `/health`, which answers `{"status":"ok"}`. There are two ways to arrange that:

- **Directly, over a private network or VPN.** Set `host` to `0.0.0.0`, a fixed `port`, and `public_url` to `http://<validator address>:<port>`. Allow the port through the validator's firewall; on Windows, for example, `netsh advfirewall firewall add rule name="Contrejour validation" dir=in action=allow protocol=TCP localport=<port>`.
- **Through a tunnel or reverse proxy you run.** Keep `host` at `127.0.0.1`, so the service is reachable only through it, point the tunnel or proxy at `port`, and set `public_url` to its address. It may serve the service under a sub-path; the worker's URL is then that address plus `/mcp`. Let it pass uploads up to `limits.max_upload_bytes`.

Contrejour configures no DNS, tunnel or proxy. `CONTREJOUR_URL` accepts any http(s) address the worker can reach. From the worker machine, `curl <public_url>/health` should answer `{"status":"ok"}`.

The validator machine keeps its network access, because some tasks need it for validation itself (installing dependencies, calling external services). Cheating is caught by inspecting what the deliverable does, not by cutting the network.

## How a submission is reviewed

The worker's task manager calls `submit`, receives a one-time upload URL and uploads the zip with `curl.exe --fail-with-body -T` (`curl` outside Windows). The service hashes and safely unpacks it (refusing `../` paths, limiting total size and file count) and checks that `USAGE.md` is at the root or in a single top-level folder. A malformed zip becomes `invalid` and does not count: a format error should not cost the worker an attempt.

For each accepted submission the service starts one Claude Code background session, named `contrejour-review-<id>`, running as `validator-task-manager` with the model and permission mode from `validation.agent`. At most `limits.max_concurrent` reviews run at once; the rest queue. The session's whole prompt is `Run the <loop> loop with args {…}`, naming the review loop you chose, the submission, its directory and the loop's parameters: every role of the loop receives that text verbatim, so it carries nothing else.

The task manager first checks the loop with `loop-check`. If the script is stale or defective, it runs `loop-authoring` to regenerate it from the unchanged definition and checks again; if the check still fails, it stops and reports. This comes before anything of the submission is read, so nothing in the deliverable can shape the loop. Then it runs the loop. The steps of the default loop, `submission-review`:

| Step | Role | What happens |
| --- | --- | --- |
| Inspect | `inspector` | Reads the deliverable's code, scripts and configuration before anything of it runs, and records signs of cheating in `inspection.md`: reading benchmark data, built-in answers, behaving differently under evaluation, patches fitted to earlier feedback, writes outside its own output, install steps that do more than install |
| Adapt | `adapter-writer` | Installs the deliverable inside the submission directory as `USAGE.md` says, writes the adapter to `adapter_contract`, and iterates on the smoke subset until the adapter calls it correctly. A deliverable that cannot be run as documented is itself a finding |
| Regress | `regression-runner` | Only if it runs: runs every active benchmark layer and reports the counts the helper computed. It never edits the adapter: a defect the full runs expose goes back to `adapter-writer`, and the layers run again, at most `max_adapter_fixes` times |
| Extend | `test-extender` | Only after a complete regression: hunts for more problems, derives new tests from existing ones (researching external testing methods where useful), registers them as a new layer and runs it on this submission. Up to `max_extension_rounds` rounds, while new tests keep finding problems |
| Verdict | `verdict-writer` | `valid`, `cheating` or `unusable`, and feedback on the real problems |
| Leak review | `leak-reviewer` | From a fresh context, checks a snapshot of the feedback against every hidden test. A leak sends it back to `verdict-writer` for a rewrite, within `limits.feedback_attempts`; if every permitted rewrite leaks, only the verdict and counts are published |
| Publish | `validator-task-manager` | Runs `finalize`. Only now can the worker's `query` see the result |
| Record | `validator-memory` | Records in the wiki which problems this submission solved and which persist, from the published result only |
| Optimize | `trajectory-optimizer` | Reads the review's trajectories and writes proposals to fix the validator's roles, which take effect once you accept them in `proposal-review` |

When `adapter-writer` or `regression-runner` hits a failure on the validator's side that it cannot fix (this machine lacks what `runtime_environment` promised, or a helper fails), the deliverable was never fairly tried. The task manager then abandons the review with `validation-cli.js abandon`: the submission becomes `failed`, which does not count, so the worker can submit again at once. The worker sees only that the validator could not complete the review; the cause stays in the submission's record on this machine, and the session reports what must be fixed.

The verdict only decides whether the results count. Whether each test passed is computed by the helper from the runners' per-sample output under the frozen pass rule, and a test the deliverable got wrong or crashed on counts as failed. Only the totals of tests, passed and failed are published, never a score, and results of different submissions are not compared: the benchmark keeps growing, so what matters is which problems remain. A `cheating` verdict voids every test result.

Feedback must state the real problems: what the deliverable does wrong, which requirement of `task.md` it breaks, roughly how often and how severely, and which earlier problems are solved or persist. It may describe how tests are constructed, since a method contains no test case, but never the actual tests: inputs, references, actual outputs, sample or test ids, per-test results, how many tests a layer has, hidden file names and paths, text copied or paraphrased from the test data, or an example close enough to a real test to stand in for it. The leak reviewer's independence comes from the loop: a fixed script starts it, the verdict writer can change neither the script nor what the reviewer receives, and the reviewer starts from a fresh context every time. The helper binds each review to the digest of the feedback it read, so edited feedback needs a new review, and `finalize` publishes feedback only when the review of exactly that text passed.

### When a review session stops

A review session can stop before it publishes: it crashed, its turn ended early, or it is waiting for an answer nobody will give. The worker would then wait in vain, so the service watches every review session. When a session stops with its submission unfinished and no loop running, its Stop hook tells the service at once; otherwise the service checks each session once a minute. It never disturbs a session that is working. A stopped session gets a two-minute grace, none when the hook reported it. Then the service stops the session's process if it is still alive, and resumes the session with a reminder to continue the loop the review started with and no other option: Claude Code continues a session in place only when it was stopped and is resumed that way; otherwise it starts a copy. The task manager resumes its last run of the loop, so finished steps return at once, and the roles keep work already done. Reminders come at growing intervals, at least 10, 30 and then 60 minutes apart, so a long run is not disturbed often. If the session was removed or cannot be continued, the service marks the submission `failed`: it does not count, and the worker need not wait for the review time limit. A review still unfinished at `limits.review_timeout_minutes` fails the same way.

### Watching the reviews

- `claude agents` lists the sessions on the machine and their state; `claude attach <id>` follows one live and lets you take over; `claude logs <id>` shows its recent output.
- `node .contrejour/dist/tools/validation-cli.js status --project .` shows the service state, counted and remaining submissions, the layers, and each submission's status, verdict and test counts; add `--submission <id>` for one in full.
- The service's own output says when it started, reminded or failed a review session.
- `.contrejour/trajectories/` holds every role's transcript, and `.contrejour/proposals/` the proposed role fixes. To go through the pending proposals, run `proposal-review` from the Studio, or `claude "Run the proposal-review loop"` in the project: you see each with its evidence and exact change, the ones you accept are applied, and the fate of each is recorded.
- The Studio's Runs page and the loop page ([Viewing the loops](#viewing-the-loops)) list each review's run of `submission-review`: which roles finished, when, for which submission.

## Worker machine

Check that the validator's service is running and that you have its `worker_connection`: from this machine, `curl <public_url>/health` should answer `{"status":"ok"}`. Then configure the worker, set up its workflow, try it if you want to, and start work.

### 1. Run `configure`

Install, accept the folder trust prompt, and run the worker's `configure`: in the Studio, pick it in the list above the canvas and press **Run**; or run `claude "Run the configure loop"` in the project. It starts no research.

The worker's sheet has `project.name`, `project.language`, `environment.secrets`, `connection.url` (the `worker_connection` URL, ending in `/mcp`) and `connection.token`. Once the connection is in the sheet, `worker-config` fetches `task.md` from the validator with `config-cli.js fetch-task`, byte for byte; never write or copy it by hand. The fetched task is part of what you approve when you confirm the digest the review note shows.

Apply first checks that `task.md` is still the validator's: if the validator changed it since your review, apply stops with `TASK_CHANGED`, and the loop fetches it again and shows you the sheet for a new confirmation. Apply then writes `environment.secrets` to `.contrejour/environment.json` (mode 0600); the `contrejour` server to `.mcp.json`, replacing only that entry; `.contrejour/` and `.mcp.json` to `.gitignore`, because they hold credentials; `.claude/settings.json` with the entry role `worker-task-manager`, the hook registrations and `worktree.bgIsolation: "none"`; and the role block and an empty environment section in `CLAUDE.md`. `worker-config` then creates `research-wiki/`, writes the environment skill's scripts and runs each once for real, and writes the environment section, asking you for what only you know (a host, a quota, a path it cannot find). The configuration ends with its report: what apply wrote, how each script's real run went, and anything incomplete; what this machine needs before work starts, which is the `contrejour` server approved and a permission mode that does not wait for approvals ([Start work](#4-start-work)); and what comes next.

### 2. Set up the workflow: choose the loop

Now run `setup`: in the Studio, with `setup` on the canvas (pick it in the list if `configure` is still there), press **Run**; or run `claude "Run the setup loop"`. From your words and `task.md` it settles the goal, then proposes the loop this machine runs, normally the library's research loop, `research-iteration` ([What a round does](#what-a-round-does)), with values for its parameters:

| Parameter | Default | What it decides |
| --- | --- | --- |
| `informed_ideators` | 3 | Ideators per round that read the query pack, the wiki and the latest result |
| `failures_only_ideators` | 1 | Ideators per round that see only the ineffective ideas and what each tried |
| `blank_ideators` | 1 | Ideators per round that see only the task and the problems |
| `ucb_c` | 1 | The weight of the exploration bonus when ideas are ranked; 0 ranks by potential × feasibility alone |

How this machine works on the validator's task is this choice. Approve it, or say which values or which loop you want instead. For another kind of work, such as something narrower than exploring over many rounds, or a constraint on approaches, describe it, and `loop-authoring` builds it on the closest loop, for your approval. Whatever loop you choose, `worker-task-manager` runs it and stays the only role that talks to the validation service.

Setup then checks the loops, as on the validator, and hands off: the goal, the loop and its values, the checks, how to try the loop, how to start work, and what you may do later. The worker's workflow is now set up.

### 3. Try it first, if you want to

Before the real rounds you can try the loop with `loop-trial` ([Trying a loop](#trying-a-loop)): press **Trial** in the Studio with `research-iteration` on the canvas, or run it in a session. A trial goes through one round as far as Build and stops before Submit, so no submission is used, and you judge what it did. Its work stays in the project, along with whatever was improved, and the real rounds go on from there.

### 4. Start work

Run the task loop: in the Studio, put it on the canvas and press **Run**; or open a new Claude Code session in the project:

```bash
cd /path/to/worker-project
claude --permission-mode bypassPermissions "start"
```

The loop runs unattended, so the session needs a permission mode that does not wait for approvals: in the default mode it would stop at its first command. `bypassPermissions` lets experiments use the network and paths outside the project; `auto` has a classifier review each step and may refuse some. Sessions the Studio starts use `bypassPermissions` unless the Studio was started with `--permission-mode auto`.

The session runs as `worker-task-manager`, the entry role in `.claude/settings.json`, and loads `.mcp.json`; approve the `contrejour` server when Claude Code asks. A session the Studio starts runs in the background, with nobody there to approve it, so before starting work from the Studio, open `claude` in the project once after `configure` and approve the server. The session runs the task loop with the values you chose. Put nothing else in that first message: every role of the loop receives the message that started it, including the blank ideator, which must see only the task and the problems.

Leave the session running. It runs round after round on its own, and you are needed again only when the task ends. Ask it for status at any time (for a session the Studio started, `claude attach <id>`, with the id the chat names): from its ledger and `query` it reports each submission's status, verdict, tests passed out of total, idea and target problems, commit and zip, and the submissions used and left.

### What a round does

Before each round the task manager fetches `task.md` again, so an edit on the validator reaches the worker here, and calls `query`. It reads the submission requirements before the first round and after any `invalid` or `unusable` result, and reads `.contrejour/loop.json`, so a new choice of loop or parameter values takes effect at the next round. Then it runs the loop. The steps of the default loop, `research-iteration`:

1. **Choose.** `problem-selector` picks one or more open problems (`[regressed]` ones first) from the wiki's query pack and the latest result, lists the ideas already found ineffective, and surveys existing work the wiki lacks; `worker-memory` records the surveys.
2. **Ideate.** The ideators, five with the default parameters, propose one idea each, at the same time, and what each sees is enforced by its tools. `ideator-informed` (three by default) read the query pack, the wiki and the latest result; `ideator-failures-only` gets only the ineffective ideas and what each tried; `ideator-blank` gets only the task and the problems and has no file tools. Over many rounds the informed view narrows, and the last two keep candidates that step outside it in every round.
3. **Rank.** `idea-assessor` drops ideas that repeat an ineffective one, scores the rest for potential and feasibility (0–1), and rescores pending ideas from earlier rounds that new evidence changes. `worker-memory` records them as pending ideas and ranks the whole pool with `rank_ideas`: potential × feasibility, plus an exploration bonus, weighted by `ucb_c`, that shrinks as more ideas in the same direction are tested. Ideas not chosen stay in the pool and compete again next round.
4. **Build.** `implementer` implements the top idea, runs its experiments through the environment skill's scripts (each run named, several at once), commits, builds the zip with `USAGE.md` to the submission requirements and checks it against each of them. One submission is one commit. If no deliverable can be made ready, `worker-memory` records why against the idea, so it is not picked again unchanged, and the round ends.
5. **Submit.** `worker-task-manager` calls `submit`, uploads the zip and records the submission in its ledger: commit, zip, idea and target problems.

The task manager then waits in the background (`worker-cli.js wait`) until the result is published, and the session wakes. A published result never changes, so it is kept as received in `.contrejour/results/` for the roles that may not call the service. Then:

6. **Record.** `worker-memory` records the verdict and the test counts copied from the result, marks the idea effective or ineffective, and files every problem the feedback names. `invalid`, `expired` and `failed` do not count; their reason goes to the next round.
7. **Optimize.** `trajectory-optimizer` reads the round's trajectories and fixes the worker's roles where they show a problem.

## End of the task

Passing every current test does not end the task, because the validator keeps adding tests. The task ends when `query` reports `closed`: the counted submissions are used up and no review is in flight.

The task manager then reports the final statistics and what you could still contribute to the community library, and how ([What leaves a project](#what-leaves-a-project)); then it stops. On the validator, read the same state with `status`.

## What leaves a project

Nothing leaves a project on its own. What the project improves stays in it: `trajectory-optimizer` fixes roles in the project, on the worker directly, with each fix committed, on the validator as proposals you accept in `proposal-review`; and the loops and roles you change or add are the project's own. Nothing is sent to any repository automatically.

Whether any of it goes further is your choice, made with one loop, `library-contribution`. It lists the project's loops and roles that are new or changed since it was installed, you choose which go, and everything you choose goes to the community library, agent-loop-community, as one pull request for its maintainers to review and merge.

Run it when you decide to, any time after one task has finished, and again whenever there is something new. A finished task is one finished submission: its review ended and its result was published (`invalid`, `expired` and `failed` do not count, and neither does a trial). You need not wait for the whole task to end. The worker's task manager tells you when the first submission has finished, and at the end of the task what you could still contribute. Run the loop in the project, on either side, from the Studio or in a session:

```bash
claude "Run the library-contribution loop"
```

The session runs the loop and carries your answers in:

1. **Plan.** `library-contributor` lists what could go, and judges each file: whether another project could use it, and whether it gives anything of this project away. Only what this project added or changed since it was installed counts: the installer kept a copy of everything it seeded in `.contrejour/seeded/`, so a file you left alone is never sent, however far the libraries have moved on, and nothing sent can undo anyone else's work. A changed file is merged three ways with what the community library holds of it: changes in different places are merged; where both changed the same part of a role, or both changed a loop (whose script is generated from its definition), it stays out, with what to do about it. Files that are not in the form of a Contrejour loop or role, such as an agent of your own, stay here. Files holding one of this project's keys or tokens, a hidden path or an injection pattern are refused outright. Paths of this machine and anything only this project could use are pointed out for you to decide. The plan also shows what the loop and role checks found in the result.
2. **Check, on the validator.** Before anything leaves the validator, its own `contribution-check` ([`library/loops/validator/contribution-check.md`](library/loops/validator/contribution-check.md)) runs: `leak-reviewer` checks exactly the files that would leave against the hidden tests, from a fresh context, and records its verdict on the plan's digest. Nothing leaves without a pass. It takes the place of the framework's `contribution-check`, which would have you read the files yourself; the worker's plans need no check of their own.
3. **Review.** You review the plan once, through `owner-review`, and choose what goes: you see every loop and role with its judgement and warnings, what was left out and why, and the checks. Say what to leave out or put back, and you see the new plan. Approval sends exactly that plan, and is possible only when the checks found nothing and, on the validator, the leak check passed. Nothing is pushed before you approve.
4. **Contribute.** `library-contributor` sends exactly what you approved, as one pull request to the community library. It starts from the library's current version on a new branch, `library/<project>-<side>-<yyyymmdd>`, writes exactly the approved text, commits, pushes and opens the pull request; without write access to the repository it goes through a fork. The checkout's own branches and edits stay untouched, and the working copy it used is removed. If anything changed after your approval, the helper refuses to send it; run the loop again to review the new plan.

A project's version of one of the framework's loops or roles can go too. In the community library it takes the framework's place for projects that carry that library: when a project is installed, a package's own loop or role comes first, then the community library's, then the framework's.

The loop works through the helper `library-cli.js`: `plan`, `clone`, `record-check` and `contribute`. To see what could go without sending anything, run `node .contrejour/dist/tools/library-cli.js plan --project .`. The rules the research task adds, such as what counts as a finished task and the validator's check, are in [`skills/shared-references/project-rules.md`](skills/shared-references/project-rules.md).

Pushing to GitHub and opening a pull request need the GitHub CLI, signed in (`gh auth login`). Without it, a branch is pushed if your git credentials allow and you get the address to open the pull request yourself; if it cannot be pushed, it stays committed in that checkout and the result says what is missing. A project installed from the archive has no checkout: the loop asks whether to fetch one of the community library; or pass `--library PATH` to the installer. A contributed loop or role's `side` decides which projects the community library gives it to: `framework` reaches every project, `worker` or `validator` the projects of that side. When a new role could serve any project, the plan says so, for you to have its `side` changed to `framework`.

## Where experience goes

Experience is kept where it is used, by the role responsible for it:

| Kind | Where | Written by |
| --- | --- | --- |
| Research knowledge: for each problem, what existing work did, which ideas and experiments were tried, which worked | `research-wiki/`, one per machine | Only the memory role (`worker-memory`, `validator-memory`), through `research-wiki.js` |
| Facts and lessons about this machine | The environment section of `CLAUDE.md` | The configuration (`worker-config`, `validator-config`) first, then only the memory role |
| Procedures done the same way every time | The scripts of the environment skill `<project>-environment` | The configuration first, then the memory role |
| How a role does its step | Its file in `.claude/agents/` | `trajectory-optimizer`; on the validator only as proposals you accept in `proposal-review`; new roles through `role-authoring` |
| Which roles run, in which order | The loop definition in `.claude/loops/` | `loop-authoring`, only at your request |

**Research wiki.** Survey, idea, experiment, claim and problem nodes joined by evidence edges record, for each problem, what existing work did, what was tried and what was effective or ineffective. Each round starts from the query pack, a summary of at most 1000 characters with node references; the details stay on the pages. The validator's wiki records the problems found across submissions, which ones each submission solved and which persist, and the testing methods researched. It holds no test content, because `validator-memory` works only from the published result and public sources; which layers probe which problems is recorded in the benchmark's `registry/`, not in the wiki. Read a wiki through the `research-wiki` skill, its command line or its Markdown pages.

**Environment section.** Every role reads `CLAUDE.md`, the blank ideator included, so this section holds the environment and nothing else: machines and SSH aliases; code, data, checkpoint, result and log paths; environment names and how to activate them; resources and their limits; where metrics land; verified pitfalls. One line per verified fact, under 8000 characters; research conclusions stay in the wiki. `node .contrejour/dist/tools/config-cli.js environment --project .` shows it.

**Environment skill.** `.claude/skills/<project>-environment/` holds the fixed procedures as Bash scripts (sync code, prepare the environment, launch a named run, check it, fetch its logs and results, stop it; on the validator also, for example, checking the GPU, memory and disk a run needs), each run once for real when written. Every run gets its own name, log and result path, so several experiments can run at once. On the validator, `validator-memory` also adds the reusable testing tools a review built, once it has checked that they hold no test content. Keys and tokens are read from `.contrejour/environment.json`, never written into the scripts. The tools the scripts use, such as SSH, rsync, conda or a container runtime, are not bundled.

**Roles.** After each worker round and each validator review, `trajectory-optimizer` reads what each role did, judges it against that role's own Evaluation section, and makes a small fix to the role file where a problem recurs or clearly cost the outcome. On the worker it commits each fix on its own, so any one can be reverted. On the validator it only writes proposals to `.contrejour/proposals/`, which take effect once you accept them in the `proposal-review` loop: the validator's trajectories contain the hidden tests and text written by the worker, and neither may find its way into a role. Either way, the fixes stay in the project. A trial can ask for the same kind of fix ([Trying a loop](#trying-a-loop)).

**Libraries.** What the project improves stays in it. The loops and roles you choose to contribute, new or changed, go to the community library ([What leaves a project](#what-leaves-a-project)), so the next project can start from what this one learned. This replaces the cross-project `Experience.md` of earlier releases.

## Changing loops and roles

Loops and roles change through loops too, each with your review. The Studio's chat is the easiest way in ([The Studio](#the-studio)); from a session, run one with `claude "Run the <loop> loop"` and say what you want, and the task manager runs it and carries your answers in. Choosing another task loop, or other parameter values, changes no loop: do it in the Studio or with `project-cli.js use` ([Changing it later](#changing-it-later)).

- **`loop-authoring`** creates or changes a loop from your description. `loop-query` first finds the loops it could be built on, in the project and its libraries; if one already does exactly what you want, you are offered that one instead. `loop-editor` then builds the new loop on the closest one, keeping what it does well and changing what you asked for (it writes from scratch only when you ask for that), and `role-creator` adds any role it needs, built on the closest existing role. Everything is drafted in `.contrejour/drafts/` and checked; you see the definition, the script, the new roles and what differs from the base, and only the version you approve is installed. No running loop changes itself, and no other loop edits loops.
- **`role-authoring`** creates or changes a role from your description (what it does in which step, what it receives and returns, what it may read and write, how to tell it did well). `role-creator` first finds the roles that already do this, in the project and its libraries, and offers an existing one that fits; otherwise it builds the new role on the closest one, from scratch only when you ask, checks it, and installs the version you approve. When work needs a step no role does, add a role rather than code that belongs to no role.
- **`loop-trial`** tries a loop the way it will run, and has it improved between trials ([Trying a loop](#trying-a-loop)).
- **`library-contribution`** sends the loops and roles you choose, new or changed, to the community library ([What leaves a project](#what-leaves-a-project)).
- **`proposal-review`** (validator) puts `trajectory-optimizer`'s proposed role fixes to you and applies the ones you accept.

To ask which loop fits a piece of work, or what a loop does, ask `loop-query` directly: `claude --agent loop-query "<question>"`.

The definition is the authority on what a loop does; the script is its executable copy. The script ends with the digest of the definition it was generated from, so a changed definition shows the script is stale. A script may only call roles, run another loop as one step (one level deep), decide order, parallelism and branches from the roles' structured output, pass inputs between roles, loop with a fixed bound, and stop for you at an `owner-review` step. It may not put instructions on how to do a step into a prompt (that lives only in the role's file, where `trajectory-optimizer` can fix it), do work in code, call `loop-editor` or `role-creator` (only `loop-authoring` and `role-authoring` do), or use the clock or randomness, which would break resuming a run. The loop check runs each script against stub roles, several times with different stub answers to reach every branch, without calling a model:

```bash
node .contrejour/dist/tools/loop-check.js check --project .
```

It reports unknown or unnamed roles, unknown child loops and loops nested deeper than one level, use of the clock or randomness, loops that never stop, undeclared phases, roles no answer reaches, an unknown `kind` or trigger, and a script older than its definition. A loop's `kind` says what it is for: `task`, the project's work, which you choose as the task loop; `setup`, the loop that sets up the project's workflow; or `on-request`, run when you ask.

Hooks cover what must happen every time an event occurs. The installer registers them in `.claude/settings.json`, so they guard every loop from the first one you run, and choosing the task loop or applying the configuration registers them again; all are handed to Contrejour's hook helper. They only record, notify or block, and which actions run is declared in the loop definitions (`triggers`):

- `record-trajectory`: when a role finishes, copy its transcript to `.contrejour/trajectories/` and index its session, loop and submission. Claude Code keeps its own transcripts under your home directory, removes them after 30 days by default and changes their format between versions, hence the copy. Trajectories stay on the machine.
- `notify-stopped-review` (validator): tell the service when a review session stops with its submission unfinished.
- `guard-protected-paths` (validator): block writes to the benchmark, its frozen configuration, the hidden data and the files only the helpers write, and to `.contrejour/loop.json`, which only you change.
- `guard-owner-answers`: before a loop runs, check that every answer the session passes in is a message you typed in this session after the loop stopped at that review, whole and word for word, and block the run otherwise. The answers it verified are recorded in `.contrejour/reviews/answers/`, which is all `owner-review` accepts.

## Viewing the loops

To see the project's loops without reading their files, open the loop page, a read-only view (the Studio shows the same and lets you act on it):

```bash
node .contrejour/dist/tools/loop-view.js --project .
```

It prints an address, `http://127.0.0.1:8780/` unless you pass another `--port`, to open in a browser. For each loop it shows its purpose and its steps, each with the roles that do it, and marks the steps where the loop stops for you; its parameters, with this project's values beside the defaults; the roles it calls; whether its script passes the loop check; and its recent runs from the trajectory index: which roles finished in each, when, and for which submission. Loops are grouped by `kind`, with the project's task loop marked, and the libraries' loops this project does not have are listed too. A role's page shows its file and the loops that use it. **Refresh** reads the files again, and the page switches between Chinese and English.

The page only reads: the loop and role files, the chosen loop with its parameters, and the trajectory index. It never reads a transcript, the wiki, the benchmark or the hidden data, changes nothing, and loads nothing from the network; no role runs it. It answers only on this machine's own address. To view it from another machine, forward the port, for example `ssh -L 8780:127.0.0.1:8780 <machine>`, and open `http://127.0.0.1:8780/` there. `--out loops.html` writes the same page as one file instead, to open without a server. On the validator the page shows how submissions are judged: keep it, and any file written from it, away from the worker side.

## The Studio

The Studio is your console for the project, in a browser on this machine. It sets up a new project's workflow with you, draws each loop as a flow, finds the loops close to what you ask for, changes them with you in a chat, makes one the project's task loop with your parameter values, runs the project's loops, bringing their questions to you, and tries a loop for real before its real work.

```bash
node .contrejour/dist/tools/studio.js --project .
```

It prints a sign-in link: open it once in your browser. The link signs in that one browser and is kept only in the Studio's memory, never in a file, so no agent on the machine can act as you through it; restart the Studio for a new one. Like the loop page, the Studio answers only on this machine's own address (`--port` picks another port than 8790). To use it from another machine, forward the port with `ssh -L 8790:127.0.0.1:8790 <machine>` and open the link there; keep the same port number on both sides, because the Studio answers only to its own address.

- **Set up the workflow.** A project that is not set up yet opens with its `setup` loop on the canvas ([What setup does](#what-setup-does)). Press **Run**; whenever it needs a decision, its review note and question appear in the chat. Once the project is set up, the Studio opens with its task loop on the canvas. On these two machines `configure` comes first: pick it in the list above the canvas and run it before `setup` ([The order of the steps](#the-order-of-the-steps)).
- **Say what you want.** Describe in the chat the loop you need. The Studio at once lists the close loops of the project and its libraries, each with a preview of its flow, and puts the closest on the canvas. Pick another, or keep it as it is.
- **The canvas** shows the loop's steps, the roles that do each, the groups of roles that run at once, the steps where the loop stops for you (orange), and arrows on to the next step, ahead on a condition, back to an earlier step (dashed) and out to the end. The loop's parameters sit on the right, joined by dashed lines to the steps they affect. Click a step for its full text.
- **Change it in words.** Click steps, arrows or parameters to point at them, then say what to change; you never name variables or the roles' inputs. The Studio starts `loop-authoring` in a background Claude Code session running as the task manager, and shows which role is working. The loop-writing roles take the loop on the canvas as the base, draft the change, add any role it needs, check the draft and stop for your review: the draft is drawn on the canvas, beside the original, and the review note is shown in the chat. Approve, cancel, or say what else to change. Your reply goes to the loop exactly as you typed it, and `guard-owner-answers` checks it as it checks a reply typed in a terminal; only the version you approve is installed.
- **Make it the task loop.** **Parameters** lists the loop's parameters with their defaults and ranges. Set the values and choose **Use as this project's task loop**: the loop and the values go to `.contrejour/loop.json`, and the next round or review uses them. Only a `task` loop can be chosen. A loop from a library that the project does not have yet is copied in first, with the roles it needs that the project lacks, and from then on they are the project's own.
- **Run a loop.** Pick one of the project's loops in the list above the canvas. **Run** starts it in a background Claude Code session running as the task manager: `configure`, `setup`, `library-contribution`, the validator's `proposal-review`, or the worker's task loop (the validator's reviews are started by its service, one per submission). The canvas marks the steps going on and done. When the loop stops for you, its review note and question appear in the chat, and your reply goes to the loop exactly as you typed it.
- **Try a loop.** **Trial**, beside **Run**, tries the loop on the canvas with `loop-trial` ([Trying a loop](#trying-a-loop)): a static check, a small real run, and its report in the chat for you to judge; what you say should be different is improved before the next trial. The button is there for every loop of the project except `setup` and `loop-trial` itself.
- **Roles and runs.** The Roles page shows each role's file and the loops that use it, and starts a change to a role, or a new role, in the chat through `role-authoring`; the Runs page shows each loop's runs from the trajectory index.

The sessions the Studio starts run unattended, so they use `--permission-mode bypassPermissions` unless you start the Studio with `--permission-mode auto`; `--model` picks their model, and `--claude` the Claude Code program they run (on Windows, the native `claude.exe`: an npm `claude.cmd` cannot be started without a shell). `claude attach <id>` follows one live: the chat names its id. Claude Code starts background sessions only in a folder it trusts, so open `claude` in the project once and accept the prompt.

## Update or repair

Update your checkout and rebuild it, then rerun the installer with the same side and project:

```bash
cd /path/to/auto-dl-loop
git pull
git submodule update --init         # the framework and the shared library at the versions this package pins
npm ci                              # only if package-lock.json changed
npm --prefix agent-loop-studio ci   # only if agent-loop-studio/package-lock.json changed
npm run build:framework
npm run build
bash distribution/install-contrejour.sh --role worker --project /path/to/project --dry-run
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

The installer assembles and verifies a temporary bundle from the current checkout, restores missing files, updates the helpers, runtime, templates and installed skills, and removes the ones dropped from the package. A local edit to one of them stops the update before anything is written: save your edit, then rerun with `--force` to replace it. Seeded loops and roles are kept as the project has them, listed under `kept_project_versions`. To take a library's newer version of one, remove the project's copy (for a loop, both its definition and its script) and rerun the installer. `task.md`, the wiki, the benchmark, submissions, the configuration's draft and state, the chosen loop in `.contrejour/loop.json`, the record that the project is set up (`.contrejour/setup.json`), `.contrejour/environment.json` and the environment skill are never touched, and in `.claude/settings.json` the installer only writes its hooks and the entry role again.

If the machine was configured, rerun `node .contrejour/dist/tools/config-cli.js apply --project .` to refresh the role block in `CLAUDE.md` and the settings; an unchanged configuration keeps its confirmation. Claude Code reads roles and skills when a session starts, so open new sessions afterwards, and restart the Studio. On the validator, restart the service so it runs the updated helpers.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Installer: local runtime incomplete, or `npm run build` asks to build the framework first | The checkout is not prepared: run `git submodule update --init`, `npm ci`, `npm --prefix agent-loop-studio ci`, `npm run build:framework` and `npm run build` in it, then rerun the installer |
| Installer refuses the project | It was installed for the other side (use one project per side), for Codex by an earlier release, or by ARL under `.aris/`: install into a fresh project. `--provider` was removed |
| Installer: `Local file differs` | A file the package owns was edited: save the edit, then rerun with `--force` |
| The Studio's sign-in link was used or is wrong, or the page answers `wrong host` | The link signs in one browser, once: restart the Studio for a new one. Through `ssh -L`, use the same port number on both sides |
| The Studio starts no session (**Run**, or a change asked for in the chat) | The folder is trusted (run `claude` in the project once and accept the prompt); `--claude` names a Claude Code that starts without a shell (on Windows `claude.exe`); Claude Code is signed in for the user running the Studio. The chat says why the session could not start |
| `start` runs setup instead of the task loop | The project's workflow is not set up yet (there is no `.contrejour/setup.json`): let setup reach its hand-off; after that, `start` runs the task loop. Setup does not configure the machine: if you have not run `configure`, run it first |
| The service will not start: `VALIDATION_NOT_CONFIGURED` | `configure` has not reached its apply on this machine, so there are no frozen terms or token: run `configure` through its apply, then start the service again |
| The service will not start: `LOOP_NOT_SELECTED` | No review loop is chosen yet: let setup finish its task-loop step and hand off, or choose the loop in the Studio or with `project-cli.js use --project . --loop submission-review`; then start the service again |
| Submissions end `failed` and no review session appears in `claude agents` | The folder is trusted (run `claude` in the validator project once and accept the prompt); `validation.agent.claude_command` runs `--version` (on Windows `claude.exe`, or `node` with `cli.js`); Claude Code is signed in for the user running the service. The service's output shows why the session could not start |
| The sheet reports an issue on `validation.agent.claude_command` | The command cannot be started or its `--version` fails; on Windows a `.cmd` or `.bat` shim is refused |
| A loop fails `loop-check` | The report names each defect, or says the script is stale. A stale script is regenerated from its definition by `claude "Run the loop-authoring loop to regenerate <loop>"`; a wrong definition is changed through `loop-authoring` with your review. Setup regenerates failing scripts in its check step, and before each review the validator's task manager regenerates a failing script itself, and stops if it still fails |
| No trajectories, or a hook seems to do nothing | `.contrejour/hook-errors.log`: the hook helper writes its errors there and lets the event pass. Its actions run only when a loop definition declares them under `triggers`. `.claude/settings.json` holds the registrations, which name the Node.js that wrote them: after moving Node.js, rerun the installer |
| `query` or `fetch-task` fails | The validator's service is running, which needs its `configure` and `setup` done; the worker reaches `/health`; the URL ends in `/mcp`; the token matches; the validator has a UTF-8 `task.md` |
| Worker apply reports `TASK_CHANGED` | The validator edited `task.md` after your review: the loop fetches it again; review and confirm |
| A new session is not the task manager, or lacks the `contrejour` tools | The installer writes the entry role to `.claude/settings.json` (choosing the task loop and applying the configuration write it again); if it was removed, run `node .contrejour/dist/tools/project-cli.js hooks --project .`. The worker's apply writes the `contrejour` server to `.mcp.json`, which Claude Code asks you to approve; open a new session |
| Upload rejected as `invalid` | The zip rules in `requirements`: `USAGE.md` at the root or in one top-level folder, size and file limits, portable relative names. The upload URL is single-use and expires. `invalid` does not count |
| Submission `failed` | Our side. Either the review session could not start, was removed, could not be continued or ran past the review time limit (the service's output says which, and `claude logs <id>` shows the session), or the review was abandoned because of a failure on this machine (`validation-cli.js status --project . --submission <id>` shows the cause under `abandoned`). `failed` does not count |
| The service refuses after an edit (`BENCHMARK_CHANGED`) | Restore the frozen base benchmark, its evidence files and the layer repository, or create a new validator project |
