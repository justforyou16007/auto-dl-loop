# Contrejour

Contrejour runs one task on two machines. The worker builds a deliverable; the validator machine owns an append-only benchmark, tests each submission as the worker's adversary and publishes a verdict, test counts and leak-reviewed feedback. Their only application interface is the validation service's `task`, `requirements`, `submit` and `query` MCP tools. Planning and implementation belong to the agent; Contrejour adds no fixed research pipeline.

Use the official Paseo app and CLI on both machines. Contrejour supplies project skills and the Node runtime helpers; it does not contain or require a custom Paseo build. Official Paseo shows agents and service scripts. It has no custom knowledge graph tab: read the wiki files or use the `research-wiki` skill.

## Install

You need Bash, Git and Node.js 22.12+. Install and authenticate the backend each machine uses, Claude Code or Codex, and install the official Paseo CLI with its daemon running (`paseo daemon status`). The validator machine also needs the dependencies required by your benchmark. Windows users can run the Bash installer in Git Bash, with Node on PATH; WSL is a separate Linux environment.

Use a local Git checkout of `main` on each machine. Prepare dependencies and compile the helpers separately, then install from that checkout with the machine's role:

```bash
cd /path/to/local/contrejour-checkout
npm ci
npm run build
bash distribution/install-contrejour.sh --role worker --project /path/to/project [--provider claude|codex]
# On the validator machine:
bash distribution/install-contrejour.sh --role validator --project /path/to/project [--provider claude|codex]
```

The installer does not clone or update Git, install npm dependencies, download archives, or require tar. Missing local dependencies or compiled helpers stop installation with preparation instructions. You can invoke the script by absolute path from another directory, and `--dry-run` leaves the target unchanged.

For manual offline distribution without a Git checkout on the target machine, an owner can still build an archive with `npm run pack:contrejour`, transfer it and extract it outside the target project:

```bash
tar -xzf contrejour-0.1.0.tar.gz
bash contrejour/install.sh --role worker --project /path/to/project [--provider claude|codex]
# On the validator machine:
bash contrejour/install.sh --role validator --project /path/to/project [--provider claude|codex]
```

The optional archive includes compiled helpers, their runtime dependencies and templates. Neither installation route creates global skill links or restarts Paseo.

Either role runs on either backend. `--provider` chooses it; without it the worker gets Claude Code and the validator Codex. Updates keep the installed backend, and a different `--provider` is refused: install into a fresh project to change it.

| Backend | Agent | Skills | Role instructions | Worker MCP config | Worker thinking | Validator thinking |
| --- | --- | --- | --- | --- | --- | --- |
| `claude` | Claude Code | `.claude/skills/` | `CLAUDE.md` | `.mcp.json` | `ultracode` | `max` |
| `codex` | Codex | `.agents/skills/` | `AGENTS.md` | `.codex/config.toml` | `ultra` | `max` |

Setup writes the role instructions, and the worker's `contrejour` entry in its MCP config, after you confirm the configuration sheet. Existing unrelated instructions and MCP entries are preserved. Trust every Codex project in Codex (a Codex worker reads `.codex/config.toml` only then), then open a fresh session; its [skill discovery](https://developers.openai.com/codex/skills/) follows the official OpenAI documentation.

The archive contains five skills: `worker-setup` and `validator-setup`, of which each project receives only its role's, `validation-review`, `research-wiki` and `browser-act`, with their shared references, helpers and runtime dependencies. It installs no subagent definitions. Optional literature, GPU platform and notification skills in the source repository are not included in the archive.

Create a separate project on each machine and add each to official Paseo. Never share their disk, repository or synchronized directory. Write `task.md` only on the validator machine: the worker's setup fetches it, byte for byte, through the `task` tool. In the project `.gitignore`, exclude `.contrejour/` and the worker's MCP config because setup stores credentials there; setup adds them.

## Validator machine first

1. Open the validator project's backend at thinking `max` in Paseo and invoke `/validator-setup` (Claude Code) or `$validator-setup` (Codex), the setup skill installed for this role. If `task.md` is absent, write it with the owner from `.contrejour/templates/TASK_TEMPLATE.md`, as UTF-8 text. The service publishes it to the worker exactly as it stands, so a later edit reaches the worker at its next fetch.
2. Review the complete configuration sheet. Configure the pinned benchmark source and data revision, split, full sample count, runner argv and metrics; the per-sample pass rule `pass_rule` (`metric`, `op` one of `>=` `>` `<=` `<` `==`, `threshold`), under which each sample is one test; the adapter contract; `runtime_environment`, what a deliverable can rely on when it runs (OS, runtimes, GPU, network, time per input), which the worker reads through `requirements` with the adapter contract and limits; `hidden_paths`, the absolute paths of the hidden samples, labels and references that the leak reviewer checks feedback against; the limits (submissions, uploads, review timeout, `feedback_attempts` and `max_new_tests_per_review`, default 200); and the service address, which `CONTREJOUR_URL` fills in and fixes when the machine provides it (see [Network](#network)). Validator agents run on the installed backend at `max`; the sheet shows that backend and sets only their model and mode. The example in `.contrejour/templates/tester-benchmark/` uses lm-evaluation-harness.
3. Approve the final configuration digest. Setup runs the benchmark setup, healthcheck and smoke test, freezes the base benchmark and pass rule and creates the service token, or takes `CONTREJOUR_TOKEN` when the machine provides it. It writes the `contrejour` service script into `paseo.json` and initializes `research-wiki/`, the validator machine's long-term memory of verification problems: which ones each submission solved and which persist.
4. Start that script from official Paseo. Check with `node .contrejour/dist/tools/validation-cli.js status --project .`. The service starts one validator agent per submission with `--provider <backend> --thinking max`; `validation-cli leak-review` starts each independent feedback leak reviewer with the same agent configuration.
5. Transfer the printed `worker_connection` URL and token privately to the worker machine.

Setup ends by writing the [environment skill](#environment-skill) and asks you to run `reload-skills` in Claude Code or open a fresh Codex session.

On Windows, use `agent.paseo_command: ["node", "<Paseo install>\\bin\\paseo"]` because Node cannot execute a `.cmd` shim directly. On Linux/macOS the default `["paseo"]` uses the official CLI on PATH.

The benchmark is append-only. Its base layer and the pass rule are frozen at setup; once submissions have been tested against them, changing either needs a new validator project. Validator agents add later layers (`inc-001`, `inc-002` and so on) with `validation-cli extend`, each test derived from existing tests; each one is an addition-only commit in the helper-owned git repository `.contrejour/validation/benchmark/`, whose head the helper records in `.contrejour/validation/benchmark-head`. The helper checks commit by commit that the history only adds files. A registered layer is never edited; a wrong one is retired with `validation-cli retire`, itself an addition. Any change to a pinned file or to that history stops the service.

## Network

For a private network or VPN, set `service.host` to `0.0.0.0`, `service.port` to a fixed port such as `8790`, and `service.public_url` to `http://<validator-address>:8790`. Allow that port in the validator machine's firewall. The worker must reach `/health`; it should return `{"status":"ok"}`.

If you already operate Paseo's service proxy, use host `127.0.0.1`, leave the port null, and use the script's proxy URL as `public_url`. Paseo supplies the runtime port. This package does not configure DNS or a proxy for you.

If the validator machine already provides the service's public address and bearer token as the environment variables `CONTREJOUR_URL` (the root address, without `/mcp`) and `CONTREJOUR_TOKEN` (at least 32 characters), setup uses them as they are: the sheet takes `public_url` from `CONTREJOUR_URL` and no longer lets you edit it, and apply writes `CONTREJOUR_TOKEN` as the service token instead of creating one. Setup reads them when it runs; after changing either, review, confirm and apply again and restart the `contrejour` script. The worker still receives the URL and token through its own setup sheet.

## Worker machine

1. Make sure the validator's `contrejour` service is running: the worker's setup fetches `task.md` from it. Do not copy or write `task.md` by hand.
2. Open the worker project's backend in Paseo, Claude Code at thinking `ultracode` or Codex at `ultra`, and run `/worker-setup` or `$worker-setup`. Fill in `connection.url` and `connection.token`, and under `environment.secrets` any keys the environment scripts need. Setup then fetches `task.md` with `node .contrejour/dist/tools/setup-cli.js fetch-task --project .`; the fetched task is part of what you approve.
3. Approve the reviewed digest. Apply first checks `task.md` against the validator's again; if the validator changed it in the meantime, apply stops, and setup fetches it again for a new review and approval. Setup then writes the role block to `CLAUDE.md` or `AGENTS.md` and the MCP entry to `.mcp.json` or `.codex/config.toml`, initializes `research-wiki/` and writes the [environment skill](#environment-skill).
4. Run `reload-skills` in Claude Code to discover new skills; in Codex, open a fresh session. Reopen the worker session to load its MCP configuration. Ask the agent to call `query` and verify the validation service is open.
5. Tell the worker to work on `task.md`. It starts every iteration with `fetch-task`, and fetches again when `query` reports another `task_sha256`, so an edit to the validator's task reaches it. It follows the numbered iteration in its role block step by step: the research wiki is its mandatory long-term memory and the todo list holds the current iteration's tasks. It commits before every submit, uploads a zip containing `USAGE.md` to the one-time URL and polls `query`. After each published verdict, it saves concise, evidenced, cross-project lessons to `Experience.md` on the `experience` branch of your local Contrejour source checkout, creating that branch from `main` the first time and committing to it afterwards, in a separate worktree that never switches the checkout's branch. It never pushes or merges: you push `experience` and open a pull request into `main`, and other projects read a lesson only after you merge it. Setup records the checkout and worktree in the instruction file. Duplicate lessons are merged and project details stay in the wiki. Keep that checkout writable; `.contrejour/` is not the source checkout. See the [experience contract](skills/shared-references/experience.md). It stops submitting only at `closed` (submission limit reached); passing every current test does not end the task, because the validator keeps adding tests. It finishes saving experience before its final response.

The worker role block routes to `research-wiki`, `browser-act` and the environment skill. Browser work checks or installs the external browser-act CLI on demand. Read the installed skills before using their tools.

## Environment skill

On both machines setup ends by writing `<project>-environment` in the role's skills directory, on the real machine. Its `SKILL.md` holds only facts an agent cannot know (machines and SSH aliases, code, data, result and log paths, environment names, resources, where the metric lands, verified quirks) and a table of its scripts. `scripts/` holds fixed, verified Bash procedures such as syncing code, launching a named run, checking it, fetching logs and results and stopping it. Every run has its own name, so the worker can run several experiments in one iteration. Setup runs each script once and reports the step incomplete, with the real error, if one fails. Agents add new facts and repeated procedures to the skill the same way.

The only environment configuration file is `.contrejour/environment.json`: the keys and tokens from the sheet's `environment.secrets`, written with mode 0600. Hosts, paths and commands belong in the skill. The transport and runtime tools its scripts use (for example SSH, rsync, conda or a container runtime) are not bundled.

## Update or repair

Update and rebuild your local checkout explicitly, then use the same role and project:

```bash
cd /path/to/local/contrejour-checkout
npm run build
bash distribution/install-contrejour.sh --role worker --project /path/to/project --dry-run
bash distribution/install-contrejour.sh --role worker --project /path/to/project
```

Prepare dependencies again if the lockfile changed. The installer assembles and verifies a temporary bundle from the current local files and records the role and managed file hashes in `.contrejour/install.json`. It restores missing files, updates unchanged managed files and removes managed files dropped from the package. A local edit stops the update before writes; save it before choosing `--force`. Updates preserve task.md, setup state, `.contrejour/environment.json`, benchmark, submissions, wiki, user skills and the environment skill. Role changes in an existing installation are refused; use separate projects for the two roles. Projects installed by the earlier releases named ARL keep their data under `.aris/` and are not migrated: the installer refuses them, so install Contrejour into a fresh project, set it up again and start a new `research-wiki/`.

If setup was applied, rerun `node .contrejour/dist/tools/setup-cli.js apply --project .` to refresh the role block. An unchanged configuration keeps its confirmation. Run `reload-skills` in your client after updates; reopen the agent session when MCP configuration changes or the client has no reload action. No daemon restart is required.

Older custom-Paseo installations have no standalone ownership manifest. Back them up and install into fresh projects, or inspect conflicting files and explicitly select `--force`. The installer never deletes user agent definitions or old global skill links.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Local runtime incomplete | Run `npm ci` and `npm run build` explicitly in the source checkout, then rerun the local installer |
| Skills missing | The opened agent matches the backend recorded in `.contrejour/install.json`; Codex trusts the project; reopen the session |
| query or fetch-task fails | Service is running; worker reaches /health; URL ends in /mcp; token matches; the validator has a UTF-8 `task.md` |
| Worker apply reports `TASK_CHANGED` | The validator edited `task.md` after your review: run `fetch-task`, review and approve again |
| Upload rejected | Zip has USAGE.md at root or in one top-level folder; upload fits limits; URL is single-use |
| Submission failed | Official Paseo CLI and the validator's backend are available on the validator machine; inspect validation service logs and review timeout |
| Service refuses after an edit | Restore the pinned benchmark files and registered layers, or create a new validator project |
