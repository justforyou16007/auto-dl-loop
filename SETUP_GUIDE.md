# Contrejour

Contrejour is an agent-loop framework on Claude Code. Work runs as **loops**: a loop's definition, written in natural language, says which **role** does each step, in what order and within what bounds, and a Claude Code workflow script generated from it schedules the roles exactly so. Each role is a Claude Code agent file that holds everything about how its step is done. Every role's run is recorded as a trajectory, from which the `trajectory-optimizer` role fixes the roles; loops and roles are shared through a library, the `library/` directory of the Contrejour repository.

Its first application, which this guide deploys, is a research task on two machines. The **worker** builds deliverables for `task.md` and submits them. The **validator** owns a hidden benchmark that only grows, reviews each submission as the worker's adversary and publishes a verdict, how many tests passed out of how many, and feedback on the problems it found. The two machines share nothing but the validation service's four MCP tools (`task`, `requirements`, `submit`, `query`) and the upload of each zip.

Contrejour runs on Claude Code only: no Codex, no Paseo. The design and its reasons are in `ARCHITECTURE_GUIDE.md` in the source repository. [中文部署指南](SETUP_GUIDE_CN.md)

## Before you start

On both machines you need Bash, Git, Node.js 22.12+ and Claude Code, installed and signed in. The validator machine also needs whatever your benchmark needs to run. On Windows, run the installer in Git Bash with Node.js on `PATH`; WSL is a separate Linux environment. Contrejour's use of Claude Code (background sessions, workflows, agents, hooks) was verified with Claude Code 2.1.316.

Create one project directory on each machine and never give them a shared disk, repository or synchronized directory: that separation is what keeps the hidden benchmark out of the worker's reach. Write `task.md` only on the validator; the worker fetches it.

## Install

On each machine, use a local Git checkout of Contrejour. Prepare it explicitly, then install into the project with that machine's side:

```bash
cd /path/to/local/contrejour-checkout
npm ci
npm run build
bash distribution/install-contrejour.sh --role validator --project /path/to/project   # validator machine
bash distribution/install-contrejour.sh --role worker --project /path/to/project      # worker machine
```

The installer reads only the prepared checkout. It does not clone or update Git, install npm packages, download anything or need tar, and it writes only into the project, never into global configuration. Missing dependencies or compiled helpers stop it with the preparation steps. `--dry-run` reports what it would do and writes nothing.

Without a checkout on the target machine, build the archive elsewhere with `npm run pack:contrejour`, copy it over, extract it outside the project and run its installer with the same options:

```bash
tar -xzf contrejour-0.1.0.tar.gz
bash contrejour/install.sh --role worker --project /path/to/project
```

What the installer puts in the project:

| Where | What | Afterwards |
| --- | --- | --- |
| `.contrejour/` | The compiled helpers (`dist/`), their runtime dependencies and the templates | Updated by the installer |
| `.claude/skills/` | `research-wiki`, `browser-act` and the shared references | Updated by the installer |
| `.claude/agents/` | The four framework roles and the side's nine roles | Seeded, then the project's own |
| `.claude/loops/`, `.claude/workflows/` | The side's loop, `research-iteration` or `submission-review`: its definition and its script | Seeded, then the project's own |
| `.contrejour/install.json` | The side, the checkout as the project's library, and the hashes of the files the installer manages | Rewritten by each installation |

Seeded loops and roles are written only where the project has none of that name, and an update never replaces or removes them, because they are meant to change: `trajectory-optimizer` fixes roles, and you change loops through `loop-editor`. When the task ends the project sends them back to the library ([End of the task](#end-of-the-task)); that is why the installer records the checkout. An installation from the archive records no library (an update from the archive keeps one recorded earlier), and without one the loops and roles cannot be synced.

The side is fixed at installation: setup reads it, and an update with the other side is refused, so use one project per side. Projects installed for Codex by earlier releases, and projects of the releases named ARL (data under `.aris/`), are refused rather than migrated: install into a fresh project, set it up again and start a new `research-wiki/`. The installer no longer accepts `--provider`.

When it finishes, the installer names the next step: the side's setup role.

## Validator machine first

The worker's setup fetches `task.md` from the running validation service, so set up the validator first.

### 1. Open the setup role

```bash
cd /path/to/validator-project
claude --agent validator-setup
```

The first time you open Claude Code in the project it asks whether to trust the folder. Accept: the service reviews each submission in a Claude Code background session, and background sessions only start in a trusted folder.

### 2. Write the task

`task.md` at the project root is the whole task and the only statement of it the worker gets: the service hands it over through the `task` tool exactly as it stands, and an edit reaches the worker at its next fetch. If it is missing, the setup role writes it with you from `.contrejour/templates/TASK_TEMPLATE.md`, as UTF-8 text. Describe what to build, not how it is tested.

### 3. Review the configuration sheet

The setup role shows the whole sheet at once, in the project language: every field with its options, a recommendation and any open issue. Answer with several changes in one reply, or edit `.contrejour/setup-draft.json` yourself; the role refreshes the sheet and shows it again. A recommendation becomes a value only when you accept it.

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

If the machine already provides the service's address and token as `CONTREJOUR_URL` (the root address, without `/mcp`) and `CONTREJOUR_TOKEN` (at least 32 characters), setup uses them as they are: `public_url` is taken from `CONTREJOUR_URL` and cannot be edited in the sheet (unset the variable to enter another address), and apply keeps `CONTREJOUR_TOKEN` as the service token instead of creating one. Setup reads them when it runs; after changing either, review, confirm and apply again, then restart the service.

### 4. Confirm and apply

When the sheet has no issues, the role shows its `configuration_sha256`. Approve that version and the role confirms it. Any later edit, `task.md` included, needs a new confirmation, and asking for a change is not approval.

Apply then:

- runs the benchmark's setup, healthcheck and smoke commands, and freezes the base layer (`.contrejour/tester-config.json`) and the terms (`.contrejour/validation/config.json`);
- creates the service token in `.contrejour/validation/token`, or takes `CONTREJOUR_TOKEN`; applying again keeps the token, so the worker's copy stays valid;
- writes `environment.secrets` to `.contrejour/environment.json` (mode 0600) and adds `.contrejour/` to `.gitignore`, because it holds credentials;
- writes `.claude/settings.json`: the entry role `validator-task-manager`, the hook registrations, and `worktree.bgIsolation: "none"`, so that background sessions may edit files in a git checkout without first creating a worktree. Your other settings stay;
- writes two blocks in `CLAUDE.md`: the role block between the `CONTREJOUR ROLE` markers (the rules every validator role follows) and an empty environment section between the `CONTREJOUR ENVIRONMENT` markers. The rest of the file is left alone.

It returns `service_command` (the command that runs the service), `worker_connection` (the `url`, which is `public_url` plus `/mcp`, and the `token` the worker's setup needs) and `from_environment` (which of `CONTREJOUR_URL` and `CONTREJOUR_TOKEN` it used), along with the files it wrote, the entry role and `environment_skill_dir`, where the environment skill goes.

The entry role is set in the settings rather than in `CLAUDE.md` because every role reads `CLAUDE.md`. That file holds only what all of them must know: the side's rules and the machine's environment.

### 5. Environment, wiki and checks

The setup role then works on the real machine. It creates `research-wiki/`, writes the scripts of the environment skill and runs each once, and records what every role must know about this machine in the environment section ([Where experience goes](#where-experience-goes)). Then it runs the loop and role checks (`loop-check.js check` and `roles`). A stale or defective loop script is regenerated from its definition by `loop-editor` and checked again; a loop that still fails, or a defective role, is reported to you with the check's report. Anything it could not make work is reported as incomplete, with the real error.

### 6. Start the service

From the project root, run `service_command` and keep it running for the whole task, for example in a terminal multiplexer (tmux, screen) or as an OS service (systemd, a Windows service or a scheduled task):

```bash
node .contrejour/dist/tools/validation-cli.js serve --project .
```

The service reads the frozen configuration and the token when it starts, so restart it after any new apply. Check the validation state with:

```bash
node .contrejour/dist/tools/validation-cli.js status --project .
```

Give the `worker_connection` URL and token to the worker's owner over a private channel. You start no review yourself: the service starts one per submission. To change the configuration later, run `claude --agent validator-setup` again.

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

For each accepted submission the service starts one Claude Code background session, named `contrejour-review-<id>`, running as `validator-task-manager` with the model and permission mode from `validation.agent`. At most `limits.max_concurrent` reviews run at once; the rest queue. The session's whole prompt is `Run the submission-review loop with args {…}`, naming the submission and its directory: every role of the loop receives that text verbatim, so it carries nothing else.

The task manager first checks the loop with `loop-check`. If the script is stale or defective, it has `loop-editor` regenerate it from the definition and checks again; if the check still fails, it stops and reports. This comes before anything of the submission is read, so nothing in the deliverable can shape the loop. Then it runs `submission-review`:

| Step | Role | What happens |
| --- | --- | --- |
| Inspect | `inspector` | Reads the deliverable's code, scripts and configuration before anything of it runs, and records signs of cheating in `inspection.md`: reading benchmark data, built-in answers, behaving differently under evaluation, patches fitted to earlier feedback, writes outside its own output, install steps that do more than install |
| Adapt | `adapter-writer` | Installs the deliverable inside the submission directory as `USAGE.md` says, writes the adapter to `adapter_contract`, and iterates on the smoke subset until the adapter calls it correctly. A deliverable that cannot be run as documented is itself a finding |
| Regress | `regression-runner` | Only if it runs: runs every active benchmark layer and reports the counts the helper computed. It never edits the adapter: a defect the full runs expose goes back to `adapter-writer`, and the layers run again, at most twice |
| Extend | `test-extender` | Only after a complete regression: hunts for more problems, derives new tests from existing ones (researching external testing methods where useful), registers them as a new layer and runs it on this submission. Up to three rounds, while new tests keep finding problems |
| Verdict | `verdict-writer` | `valid`, `cheating` or `unusable`, and feedback on the real problems |
| Leak review | `leak-reviewer` | From a fresh context, checks a snapshot of the feedback against every hidden test. A leak sends it back to `verdict-writer` for a rewrite, within `limits.feedback_attempts`; if every permitted rewrite leaks, only the verdict and counts are published |
| Publish | `validator-task-manager` | Runs `finalize`. Only now can the worker's `query` see the result |
| Record | `validator-memory` | Records in the wiki which problems this submission solved and which persist, from the published result only |
| Optimize | `trajectory-optimizer` | Reads the review's trajectories and writes proposals to fix the validator's roles, which you approve |

When `adapter-writer` or `regression-runner` hits a failure on the validator's side that it cannot fix (this machine lacks what `runtime_environment` promised, or a helper fails), the deliverable was never fairly tried. The task manager then abandons the review with `validation-cli.js abandon`: the submission becomes `failed`, which does not count, so the worker can submit again at once. The worker sees only that the validator could not complete the review; the cause stays in the submission's record on this machine, and the session reports what must be fixed.

The verdict only decides whether the results count. Whether each test passed is computed by the helper from the runners' per-sample output under the frozen pass rule, and a test the deliverable got wrong or crashed on counts as failed. Only the totals of tests, passed and failed are published, never a score, and results of different submissions are not compared: the benchmark keeps growing, so what matters is which problems remain. A `cheating` verdict voids every test result.

Feedback must state the real problems: what the deliverable does wrong, which requirement of `task.md` it breaks, roughly how often and how severely, and which earlier problems are solved or persist. It may describe how tests are constructed, since a method contains no test case, but never the actual tests: inputs, references, actual outputs, sample or test ids, per-test results, how many tests a layer has, hidden file names and paths, text copied or paraphrased from the test data, or an example close enough to a real test to stand in for it. The leak reviewer's independence comes from the loop: a fixed script starts it, the verdict writer can change neither the script nor what the reviewer receives, and the reviewer starts from a fresh context every time. The helper binds each review to the digest of the feedback it read, so edited feedback needs a new review, and `finalize` publishes feedback only when the review of exactly that text passed.

### When a review session stops

A review session can stop before it publishes: it crashed, its turn ended early, or it is waiting for an answer nobody will give. The worker would then wait in vain, so the service watches every review session. When a session stops with its submission unfinished and no loop running, its Stop hook tells the service at once; otherwise the service checks each session once a minute. It never disturbs a session that is working. A stopped session gets a two-minute grace, none when the hook reported it. Then the service stops the session's process if it is still alive, and resumes the session with a reminder to continue the `submission-review` loop and no other option: Claude Code continues a session in place only when it was stopped and is resumed that way; otherwise it starts a copy. The task manager resumes its last run of the loop, so finished steps return at once, and the roles keep work already done. Reminders come at growing intervals, at least 10, 30 and then 60 minutes apart, so a long run is not disturbed often. If the session was removed or cannot be continued, the service marks the submission `failed`: it does not count, and the worker need not wait for the review time limit. A review still unfinished at `limits.review_timeout_minutes` fails the same way.

### Watching the reviews

- `claude agents` lists the sessions on the machine and their state; `claude attach <id>` follows one live and lets you take over; `claude logs <id>` shows its recent output.
- `node .contrejour/dist/tools/validation-cli.js status --project .` shows the service state, counted and remaining submissions, the layers, and each submission's status, verdict and test counts; add `--submission <id>` for one in full.
- The service's own output says when it started, reminded or failed a review session.
- `.contrejour/trajectories/` holds every role's transcript, and `.contrejour/proposals/` the proposed role fixes. To accept a proposal, open `claude --agent trajectory-optimizer` in the project and ask it to apply that proposal; it records your approval in the proposal.

## Worker machine

### 1. Set up

Check that the validator's service is running and that you have its `worker_connection`. Then:

```bash
cd /path/to/worker-project
claude --agent worker-setup
```

Accept the folder trust prompt the first time. The sheet has `project.name`, `project.language`, `environment.secrets`, `connection.url` (the `worker_connection` URL, ending in `/mcp`) and `connection.token`. Once the connection is in the sheet, the role fetches `task.md` from the validator with `setup-cli.js fetch-task`, byte for byte; never write or copy it by hand. The fetched task is part of what you approve when you confirm the digest the role shows.

Apply first checks that `task.md` is still the validator's: if the validator changed it since your review, apply stops with `TASK_CHANGED`, and the role fetches it again for a new review and confirmation. Apply then writes `environment.secrets` to `.contrejour/environment.json` (mode 0600); the `contrejour` server to `.mcp.json`, replacing only that entry; `.contrejour/` and `.mcp.json` to `.gitignore`, because they hold credentials; `.claude/settings.json` with the entry role `worker-task-manager`, the hook registrations and `worktree.bgIsolation: "none"`; and the role block and an empty environment section in `CLAUDE.md`. The setup role then creates `research-wiki/`, writes the environment skill's scripts and runs each once for real, writes the environment section, checks the installed loop, and hands off.

### 2. Start work

Open a new Claude Code session in the project:

```bash
cd /path/to/worker-project
claude
```

It runs as `worker-task-manager`, the entry role setup wrote to `.claude/settings.json`, and loads `.mcp.json`; approve the `contrejour` server if Claude Code asks. Ask it to start the `research-iteration` loop, and put nothing else in that message: every role of the loop receives the message that started it, including the blank ideator, which must see only the task and the problems.

Leave the session open. It runs round after round on its own, and you are needed again only when the task ends. Ask it for status at any time: from its ledger and `query` it reports each submission's status, verdict, tests passed out of total, idea and target problems, commit and zip, and the submissions used and left.

### What a round does

Before each round the task manager fetches `task.md` again, so an edit on the validator reaches the worker here, and calls `query`. It reads the submission requirements before the first round and after any `invalid` or `unusable` result. Then it runs `research-iteration`:

1. **Choose.** `problem-selector` picks one or more open problems (`[regressed]` ones first) from the wiki's query pack and the latest result, lists the ideas already found ineffective, and surveys existing work the wiki lacks; `worker-memory` records the surveys.
2. **Ideate.** Five ideators propose one idea each, at the same time, and what each sees is enforced by its tools. Three `ideator-informed` read the query pack, the wiki and the latest result; `ideator-failures-only` gets only the ineffective ideas and what each tried; `ideator-blank` gets only the task and the problems and has no file tools. Over many rounds the informed view narrows, and the last two keep candidates that step outside it in every round.
3. **Rank.** `idea-assessor` drops ideas that repeat an ineffective one, scores the rest for potential and feasibility (0–1), and rescores pending ideas from earlier rounds that new evidence changes. `worker-memory` records them as pending ideas and ranks the whole pool with `rank_ideas`: potential × feasibility, plus an exploration bonus that shrinks as more ideas in the same direction are tested. Ideas not chosen stay in the pool and compete again next round.
4. **Build.** `implementer` implements the top idea, runs its experiments through the environment skill's scripts (each run named, several at once), commits, builds the zip with `USAGE.md` to the submission requirements and checks it against each of them. One submission is one commit. If no deliverable can be made ready, `worker-memory` records why against the idea, so it is not picked again unchanged, and the round ends.
5. **Submit.** `worker-task-manager` calls `submit`, uploads the zip and records the submission in its ledger: commit, zip, idea and target problems.

The task manager then waits in the background (`worker-cli.js wait`) until the result is published, and the session wakes. A published result never changes, so it is kept as received in `.contrejour/results/` for the roles that may not call the service. Then:

6. **Record.** `worker-memory` records the verdict and the test counts copied from the result, marks the idea effective or ineffective, and files every problem the feedback names. `invalid`, `expired` and `failed` do not count; their reason goes to the next round.
7. **Optimize.** `trajectory-optimizer` reads the round's trajectories and fixes the worker's roles where they show a problem.

## End of the task

Passing every current test does not end the task, because the validator keeps adding tests. The task ends when `query` reports `closed`: the counted submissions are used up and no review is in flight.

On the worker, the task manager then has `loop-query` sync the project's loops and roles to the library, reports the final statistics and stops. On the validator, open `claude` in the project once `status` shows `closed` and tell the task manager the task has ended: `leak-reviewer` first checks the loop and role files for test content, you approve them, and `loop-query` syncs them. Validator roles may describe how tests are constructed, but never contain actual tests.

The sync works in a worktree of the local checkout recorded at installation, on a new branch `library/<project>-<yyyymmdd>` that it pushes to the checkout's remote; it never pushes to the default branch, and the checkout's own branch and edits stay untouched. Maintainers review the branch and merge it, and projects installed afterwards start from it. Without a remote or credentials, the branch stays local and is reported. Keep the checkout in place and writable until then.

## Where experience goes

Experience is kept where it is used, by the role responsible for it:

| Kind | Where | Written by |
| --- | --- | --- |
| Research knowledge: for each problem, what existing work did, which ideas and experiments were tried, which worked | `research-wiki/`, one per machine | Only the memory role (`worker-memory`, `validator-memory`), through `research-wiki.js` |
| Facts and lessons about this machine | The environment section of `CLAUDE.md` | The setup role first, then only the memory role |
| Procedures done the same way every time | The scripts of the environment skill `<project>-environment` | The setup role first, then the memory role |
| How a role does its step | Its file in `.claude/agents/` | `trajectory-optimizer`; on the validator only as proposals you approve |
| Which roles run, in which order | The loop definition in `.claude/loops/` | `loop-editor`, only at your request |

**Research wiki.** Survey, idea, experiment, claim and problem nodes joined by evidence edges record, for each problem, what existing work did, what was tried and what was effective or ineffective. Each round starts from the query pack, a summary of at most 1000 characters with node references; the details stay on the pages. The validator's wiki records the problems found across submissions, which ones each submission solved and which persist, and the testing methods researched. It holds no test content, because `validator-memory` works only from the published result and public sources; which layers probe which problems is recorded in the benchmark's `registry/`, not in the wiki. Read a wiki through the `research-wiki` skill, its command line or its Markdown pages.

**Environment section.** Every role reads `CLAUDE.md`, the blank ideator included, so this section holds the environment and nothing else: machines and SSH aliases; code, data, checkpoint, result and log paths; environment names and how to activate them; resources and their limits; where metrics land; verified pitfalls. One line per verified fact, under 8000 characters; research conclusions stay in the wiki. `node .contrejour/dist/tools/setup-cli.js environment --project .` shows it.

**Environment skill.** `.claude/skills/<project>-environment/` holds the fixed procedures as Bash scripts (sync code, prepare the environment, launch a named run, check it, fetch its logs and results, stop it; on the validator also, for example, checking the GPU, memory and disk a run needs), each run once for real when written. Every run gets its own name, log and result path, so several experiments can run at once. On the validator, `validator-memory` also adds the reusable testing tools a review built, once it has checked that they hold no test content. Keys and tokens are read from `.contrejour/environment.json`, never written into the scripts. The tools the scripts use, such as SSH, rsync, conda or a container runtime, are not bundled.

**Roles.** After each worker round and each validator review, `trajectory-optimizer` reads what each role did, judges it against that role's own Evaluation section, and makes a small fix to the role file where a problem recurs or clearly cost the outcome. On the worker it commits each fix on its own, so any one can be reverted. On the validator it only writes proposals to `.contrejour/proposals/`, which take effect once you approve them: the validator's trajectories contain the hidden tests and text written by the worker, and neither may find its way into a role.

**Library.** At the end of the task the loops and roles go back to the library, so the next project starts from what this one learned. This replaces the cross-project `Experience.md` of earlier releases.

## Changing loops and roles

Four framework roles serve you, the owner, in any project. Open a session as one of them with `claude --agent <role>` in the project.

- **`loop-query`** finds and describes the loops registered in the project and in the library (purpose, side, the roles each uses, whether a project loop's script is current), so you pick an existing loop rather than write a near-duplicate. At the end of the task it syncs the project's loops and roles to the library.
- **`loop-editor`** creates or changes a loop at your request. It writes the definition (`.claude/loops/<loop>.md`), generates the script (`.claude/workflows/<loop>.js`), records which version of the definition the script comes from, and runs the loop check until it passes; then it shows you the definition and the check result. Loops change only this way: no running loop calls `loop-editor`, and no other role edits a loop.
- **`role-creator`** writes a new role from your description (what it does in which step, what it receives and returns, what it may read and write, how to tell it did well) in the form every role has, and checks it. When work needs a step no role does, add a role rather than code that belongs to no role.
- **`trajectory-optimizer`** fixes existing roles from their trajectories, as described above. It never changes a loop and never creates a role. On the validator, ask it to apply a proposal you approve.

The definition is the authority on what a loop does; the script is its executable copy. The script ends with the digest of the definition it was generated from, so a changed definition shows the script is stale. A script may only call roles, decide order, parallelism and branches from the roles' structured output, pass inputs between roles, and loop with a fixed bound. It may not put instructions on how to do a step into a prompt (that lives only in the role's file, where `trajectory-optimizer` can fix it), do work in code, call `loop-editor` or `role-creator`, or use the clock or randomness, which would break resuming a run. The loop check runs each script against stub roles, several times with different stub answers to reach every branch, without calling a model:

```bash
node .contrejour/dist/tools/loop-check.js check --project .
```

It reports unknown or unnamed roles, use of the clock or randomness, loops that never stop, undeclared phases, roles no answer reaches, unknown triggers, and a script older than its definition.

Hooks cover what must happen every time an event occurs. Setup registers them once in `.claude/settings.json`, all handed to Contrejour's hook helper. They only record, notify or block, and which actions run is declared in the loop definitions (`triggers`):

- `record-trajectory`: when a role finishes, copy its transcript to `.contrejour/trajectories/` and index its session, loop and submission. Claude Code keeps its own transcripts under your home directory, removes them after 30 days by default and changes their format between versions, hence the copy. Trajectories stay on the machine.
- `notify-stopped-review` (validator): tell the service when a review session stops with its submission unfinished.
- `guard-protected-paths` (validator): block writes to the benchmark, its frozen configuration, the hidden data and the files only the helper writes.

## Update or repair

Update your checkout and rebuild it explicitly, then rerun the installer with the same side and project:

```bash
cd /path/to/local/contrejour-checkout
npm ci            # only if the lockfile changed
npm run build
bash distribution/install-contrejour.sh --role worker --project /path/to/project --dry-run
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

The installer assembles and verifies a temporary bundle from the current checkout, restores missing files, updates the helpers, runtime, templates and installed skills, and removes the ones dropped from the package. A local edit to one of them stops the update before anything is written: save your edit, then rerun with `--force` to replace it. Seeded loops and roles are kept as the project has them, listed under `kept_project_versions`. To take the library's newer version of one, remove the project's copy (for a loop, both its definition and its script) and rerun the installer. `task.md`, the wiki, the benchmark, submissions, setup state, `.contrejour/environment.json`, the environment skill and `.claude/settings.json` are never touched.

If setup was applied, rerun `node .contrejour/dist/tools/setup-cli.js apply --project .` to refresh the role block and the settings (entry role and hook registrations); an unchanged configuration keeps its confirmation. Claude Code reads roles and skills when a session starts, so open new sessions afterwards. On the validator, restart the service so it runs the updated helpers.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Installer: local runtime incomplete | Run `npm ci` and `npm run build` in the checkout, then rerun the installer |
| Installer refuses the project | It was installed for the other side (use one project per side), for Codex by an earlier release, or by ARL under `.aris/`: install into a fresh project. `--provider` was removed |
| Installer: `Local file differs` | A file the package owns was edited: save the edit, then rerun with `--force` |
| Submissions end `failed` and no review session appears in `claude agents` | The folder is trusted (run `claude` in the validator project once and accept the prompt); `validation.agent.claude_command` runs `--version` (on Windows `claude.exe`, or `node` with `cli.js`); Claude Code is signed in for the user running the service. The service's output shows why the session could not start |
| The sheet reports an issue on `validation.agent.claude_command` | The command cannot be started or its `--version` fails; on Windows a `.cmd` or `.bat` shim is refused |
| A loop fails `loop-check` | The report names each defect, or says the script is stale. Fix it with `claude --agent loop-editor`. Before each review the validator's task manager has `loop-editor` regenerate a failing script itself, and stops if it still fails |
| No trajectories, or a hook seems to do nothing | `.contrejour/hook-errors.log`: the hook helper writes its errors there and lets the event pass. Its actions run only when a loop definition declares them under `triggers`. `.claude/settings.json` holds the registrations, which name the Node.js that ran setup: after moving Node.js, rerun apply |
| `query` or `fetch-task` fails | The service is running; the worker reaches `/health`; the URL ends in `/mcp`; the token matches; the validator has a UTF-8 `task.md` |
| Worker apply reports `TASK_CHANGED` | The validator edited `task.md` after your review: fetch it again, review and confirm |
| A new session is not the task manager, or lacks the `contrejour` tools | Setup has been applied (`.claude/settings.json` names the entry role); approve the `contrejour` server from `.mcp.json`; open a new session |
| Upload rejected as `invalid` | The zip rules in `requirements`: `USAGE.md` at the root or in one top-level folder, size and file limits, portable relative names. The upload URL is single-use and expires. `invalid` does not count |
| Submission `failed` | Our side. Either the review session could not start, was removed, could not be continued or ran past the review time limit (the service's output says which, and `claude logs <id>` shows the session), or the review was abandoned because of a failure on this machine (`validation-cli.js status --project . --submission <id>` shows the cause under `abandoned`). `failed` does not count |
| The service refuses after an edit (`BENCHMARK_CHANGED`) | Restore the frozen base benchmark, its evidence files and the layer repository, or create a new validator project |
