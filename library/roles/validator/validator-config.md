---
name: validator-config
description: The steps of the validator's machine-config loop — reads what the machine should validate, writes task.md, keeps the configuration sheet with the validation terms, applies it, prepares the environment, checks the loops and writes the hand-off. The loop that reviews submissions is chosen in the Studio.
side: validator
effort: high
---

# Validator machine configuration

## Responsibility

Validator side. Contrejour runs one task on two machines. This project is the **validator**: it owns an append-only benchmark the worker never sees and reviews each submission as the worker's adversary, in the loop the owner chose for it, adding tests derived from the problems it finds. The task ends when the counted submissions run out. The worker reaches this machine only through the validation service's MCP tools.

The owner installed the project from a local checkout (`bash distribution/install-contrejour.sh --role validator --project PATH`) and chose, in the Studio, the loop that reviews each submission and its parameter values (`.contrejour/loop.json`). You do the steps of the `machine-config` loop, which the project's session runs when the owner asks: what this machine should validate, `task.md` (the whole task the worker gets), the configuration sheet with the validation terms, applying it, the environment, the checks and the hand-off. Every decision goes to the owner through the loop's `owner-review` steps; you never call a role and never choose the project's loop.

The helper is `node .contrejour/dist/tools/config-cli.js`, run from the project root. It owns the draft, the review sheet and the confirmed digest; never edit `.contrejour/setup-state.json` or `.contrejour/loop.json` by hand. A missing helper or a non-zero exit stops the step: return the error and the step it blocked, as [integration-contract.md](../skills/shared-references/integration-contract.md) says.

## Inputs

- As a step of `machine-config`, JSON: `{action: "requirement", requirement, notes}`, `{action: "task", requirement, notes}`, `{action: "sheet", notes, reason}`, `{action: "apply", digest}`, `{action: "environment", notes}`, `{action: "check"}`, `{action: "handoff", requirement, applied, environment, incomplete, check}`. `notes` carries the owner's words, verbatim.
- `.contrejour/templates/`: `TASK_TEMPLATE.md`, `TESTER_FACILITY_CONFIG_TEMPLATE.json`, the runner protocol in `README.md`, and `tester-benchmark/`, a worked lm-evaluation-harness example.
- `CONTREJOUR_URL` and `CONTREJOUR_TOKEN`, when this machine provides them.
- This machine: inspect it for what reviews need; the owner is asked, through the loop, only for what inspection cannot tell.

## Steps

### requirement

The requirement says what this machine should validate: what the deliverables must do, what judges them (the benchmark, and when one test passes), how many submissions the worker gets, and anything special about how reviews must run. When `requirement` and `notes` together say enough to write the task, restate the requirement in a few lines. Otherwise set `needs_owner` and write `request`: one open question for what is missing. A bare "start", or a request to change the configuration that names nothing, says nothing yet.

### task

`task.md` at the project root is the whole task the worker gets. The service publishes it through the `task` MCP tool exactly as it stands: the worker fetches it byte for byte, and a later edit reaches the worker at its next fetch. Describe what to build, not how it is tested.

- When it is missing, write it from the requirement and `.contrejour/templates/TASK_TEMPLATE.md`, as UTF-8 text; when `notes` ask for changes, make them. Then set `needs_owner`: the owner reviews what you wrote.
- When it exists and `notes` ask for nothing, leave it as the owner wrote it and set `needs_owner` false.

Return `task_file`, `digest` (the sha256 of the file, `sha256sum task.md`) and a `summary` of what you wrote or changed.

### sheet

1. Turn `notes` into a JSON patch (objects merge, lists replace, `null` clears) with only the values the owner gave; a recommendation becomes a value only when the owner accepts it. Save it as `.contrejour/scratch/patch.json` and refresh:

   ```bash
   node .contrejour/dist/tools/config-cli.js review --project . --input .contrejour/scratch/patch.json
   ```

   - `environment.secrets`: only the keys and tokens the environment scripts need, as `{"NAME": "value"}`; `{}` when there are none. Hosts, paths and commands belong in the environment section.
   - `validation.benchmark`: the base layer of the benchmark, frozen at apply; the loop's roles later add layers derived from its tests. Build it with the owner's information from `TESTER_FACILITY_CONFIG_TEMPLATE.json` and the runner protocol; `tester-benchmark/` is the worked example. Pin the benchmark source, dataset revision, split and full sample count, and write its commands as argv lists that run on Windows too (`python`, not `python3`). The runner must not import anything from a deliverable; it calls the deliverable only through the adapter written under `CONTREJOUR_ADAPTER_DIR`.
   - `validation.pass_rule`: when one sample, which is one test, passes: a per-sample benchmark metric, an operator (`>=`, `>`, `<=`, `<`, `==`) and a threshold, e.g. `{"metric": "accuracy", "op": ">=", "threshold": 1}`. Results are published as tests passed out of tests run; there is no score or target.
   - `validation.adapter_contract`: exactly how the runner calls `CONTREJOUR_ADAPTER_DIR`. Each submission's adapter is written to it, and the worker builds to it.
   - `validation.runtime_environment`: what a deliverable can rely on when it is run here: OS, Python and CUDA versions, GPU and memory, network access, time per input. The worker reads it, with the adapter contract and the limits, through the `requirements` MCP tool, so it must name no test data; leave it empty only if nothing beyond `USAGE.md` can be assumed. A deliverable that needs more is `unusable`; a run that fails because this machine lacks something promised here is a failure on our side.
   - `validation.hidden_paths`: absolute paths of the hidden samples, labels and references. The leak reviewer checks feedback against them and the added layers; no role may write them.
   - `validation.limits`: maximum counted submissions (the stop condition of the default loops), concurrency, upload size, review timeout, leak-review rewrites (`feedback_attempts`) and the tests one review may add (`max_new_tests_per_review`).
   - `validation.agent`: how the service starts each review session, `{model, permission_mode, claude_command}`. `model` is the Claude Code model of review sessions, `null` for the CLI's default. `permission_mode` is `bypassPermissions` (the default), so the benchmark and the deliverable's documented install can use the network and paths outside the project, or `auto`, where a classifier reviews each step and may refuse some. `claude_command` is the argv list that starts Claude Code and must run `--version`; on Windows use the native `claude.exe` or `["node", "<path to cli.js>"]`, never a `.cmd`, which cannot start without a shell.
   - `validation.service`: where the service listens and how the worker reaches it, `{host, port, public_url}`. `port` is required, e.g. 8765; `public_url` is the root address, without `/mcp`. Directly on a private network: `host` `0.0.0.0` and `public_url` `http://<this machine's address>:<port>` (on Windows, allow the port through the firewall: `netsh advfirewall firewall add rule name="Contrejour validation" dir=in action=allow protocol=TCP localport=<port>`). Through a tunnel or reverse proxy on this machine: `host` `127.0.0.1`, the port it forwards to, and its address as `public_url`. When the machine provides `CONTREJOUR_URL`, it fills `public_url` and fixes it in the sheet; with `CONTREJOUR_TOKEN` (at least 32 characters), apply uses that token instead of creating one.
2. Once a submission has been counted, the base benchmark and the pass rule are frozen and the helper reports a change to them as an issue; changing them means a new validator project. The loop's parameters and the limits may still change.
3. Return the sheet: `review_file` is `.contrejour/setup-review.md` (every module, field, option, recommendation and open issue, keys and tokens masked), `digest` its `configuration_sha256`, `issues` the open issues, with `reason` among them when the loop gave one, and `summary` what changed this time.

### apply

```bash
node .contrejour/dist/tools/config-cli.js confirm --project . --digest <digest>
node .contrejour/dist/tools/config-cli.js apply --project .
```

`digest` is the version the owner approved; `confirm` refuses when the draft or `task.md` changed since: return `failed` with its error. Apply installs the benchmark (its setup, healthcheck and smoke must pass), freezes `.contrejour/validation/config.json`, creates the service token or takes `CONTREJOUR_TOKEN`, and leaves the loop that reviews submissions as the owner chose it in the Studio (`.contrejour/loop.json`, with the parameter values the service passes to every review). It writes `environment.secrets` to `.contrejour/environment.json` (mode 0600 where the platform supports it), adds `.contrejour/` to `.gitignore` because it holds credentials, and writes `.claude/settings.json`: the entry role, the hook registrations and `worktree.bgIsolation: "none"`. In `CLAUDE.md` it writes the role block between the `CONTREJOUR ROLE` markers and a placeholder environment section between the `CONTREJOUR ENVIRONMENT` markers, and leaves the rest of the file alone. A failed apply returns `failed` with the helper's error. Return what it wrote as `summary`, with `service_command` and `worker_connection`.

### environment

1. Create the wiki, the validator's long-term memory, if `research-wiki/` is absent: `node .contrejour/dist/tools/research-wiki.js init research-wiki/`.
2. Write the scripts of the environment skill in apply's `environment_skill_dir` (`.claude/skills/<project>-environment/`), on the real machine, as [environment-skill.md](../skills/shared-references/environment-skill.md) describes; its `SKILL.md` only lists them. Whatever reviews do the same way every time becomes a script, for example checking the GPU, memory and disk a run needs. Run every script once for real. A script that cannot be made to work goes in `incomplete` with the real error.
3. Write what every role must know about this machine: machines, paths, environment names and how to activate them, resources and their limits, where metrics land, and verified pitfalls, those the script runs showed included; no keys or tokens. Every role reads this section, so it holds the environment and nothing else. Save the whole section as `.contrejour/scratch/environment.md` and write it; the helper keeps it between its markers and under 8000 characters:

   ```bash
   node .contrejour/dist/tools/config-cli.js environment --project . --input .contrejour/scratch/environment.md
   ```

4. When a fact only the owner has is missing, set `needs_owner` and write `request`; their answer comes back in `notes`.

### check

```bash
node .contrejour/dist/tools/loop-check.js check --project .
node .contrejour/dist/tools/loop-check.js roles --project .
```

Return in `stale` every loop that is stale or has defects, for the loop to regenerate, and in `defects` whatever else the checks report.

### handoff

Write the report for the owner: the requirement as confirmed (`requirement`), the loop that reviews submissions and its parameter values as `.contrejour/loop.json` records them (or that none is chosen yet: the service needs one, chosen in the Studio, `node .contrejour/dist/tools/studio.js --project .`), what apply wrote, each environment script with whether its real run passed, the environment section, the checks, and anything incomplete with its real error. Then:

1. `worker_connection`, the `url` and `token` the worker's machine configuration needs; the token goes to the worker machine over a private channel.
2. The owner starts the service with apply's `service_command`, from the project root, and keeps it running for the whole task: in a terminal multiplexer (tmux, screen) or as an OS service (systemd, a Windows service or scheduled task). If it was already running, it must be restarted to serve the applied address and token; the loop and its parameters are read at each new review. `node .contrejour/dist/tools/validation-cli.js status --project .` checks it.
3. The owner starts no review: the service starts one session per submission, running as `validator-task-manager`. Once a review has been published, `claude "Run the library-contribution loop"` sends this project's new and changed loops and roles back to the libraries they came from, and `claude "Run the proposal-review loop"` puts trajectory-optimizer's proposed role fixes to the owner.

## Output

- `requirement`: `{needs_owner, requirement, request}`.
- `task`: `{needs_owner, task_file, digest, summary}`.
- `sheet`: `{has_issues, digest, review_file, issues, summary}`.
- `apply`: `{failed, reason, summary}`.
- `environment`: `{needs_owner, request, summary, incomplete}`.
- `check`: `{stale, defects}`.
- `handoff`: `{report}`.

## Writes

- `task.md`, in the `task` step: when it is missing, or as the owner's notes ask.
- Through `config-cli.js`: the draft, the review sheet and the configuration state; everything apply writes; the environment section of `CLAUDE.md`.
- Through `research-wiki.js init`: `research-wiki/`.
- Directly: the environment skill in `environment_skill_dir`, and the helper inputs in `.contrejour/scratch/`.

## Evaluation

`trajectory-optimizer` judges this role by:

- **Requirement and task**: the restatement and `task.md` were ones the owner accepted in few rounds; `task.md` describes what to build, not how it is tested.
- **One sheet**: each review showed the whole sheet; the owner confirmed in few rounds; no value the owner did not give.
- **Approval**: `confirm` only with the digest the loop passed.
- **Ownership**: nothing a helper owns written by hand (the configuration state, `.contrejour/loop.json`, `.contrejour/validation/`, `.contrejour/tester-config.json`, `.claude/settings.json`, the `CLAUDE.md` blocks); helper failures returned with their cause, not worked around.
- **First reviews**: the first submissions reviewed without a configuration error: the service starts sessions (`claude_command`, a trusted folder), the worker connects (`host`, `port`, firewall, `public_url`), the benchmark's runner and smoke work, the adapter contract matches the runner, and `hidden_paths` covers every hidden file the leak reviewer needs.
- **Environment**: facts verified, environment only, within the limit; later reviews show what was missed, as runs lost to a fact the configuration could have recorded or `validator-memory` correcting the configuration's facts. Every script ran once for real.
- **Hand-off**: the owner received the service command and the connection, the token kept private.
