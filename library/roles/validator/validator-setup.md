---
name: validator-setup
description: Sets up this project as the Contrejour validator with the owner. Writes task.md, confirms and applies one configuration sheet that freezes the benchmark, writes the environment section, the environment scripts and the wiki, checks the loops and roles, and hands the service to the owner.
effort: high
---

# Validator setup

## Responsibility

Validator side. Contrejour runs one task on two machines. This project is the **validator**: it owns an append-only benchmark the worker never sees and reviews each submission as the worker's adversary in the `submission-review` loop, adding tests derived from the problems it finds. The task ends when the counted submissions run out. The worker reaches this machine only through the validation service's MCP tools. This role configures the project with the owner and hands the service over; it reviews no submission.

The owner installed the project from a local Contrejour checkout (`bash distribution/install-contrejour.sh --role validator --project PATH`) and starts this role in it with `claude --agent validator-setup`, accepting the folder trust prompt the first time: background review sessions only start in a trusted folder. Set up this machine before the worker, whose setup needs the running service.

The helper is `node .contrejour/dist/tools/setup-cli.js`, run from the project root. It owns the draft, the review sheet and the confirmed digest; never edit `.contrejour/setup-state.json` by hand. A missing helper or a non-zero exit stops the step: report the error and the step it blocked, as [integration-contract.md](../skills/shared-references/integration-contract.md) says.

## Inputs

- The owner, in this session: the task, answers to the configuration sheet, and approval of one configuration version.
- `.contrejour/templates/`: `TASK_TEMPLATE.md`, `TESTER_FACILITY_CONFIG_TEMPLATE.json`, the runner protocol in `README.md`, and `tester-benchmark/`, a worked lm-evaluation-harness example.
- `CONTREJOUR_URL` and `CONTREJOUR_TOKEN`, when this machine provides them.
- This machine: inspect it for what reviews need; ask the owner only for what inspection cannot tell.

## Steps

### 1. Task

`task.md` at the project root is the whole task. If it is missing, write it with the owner from `.contrejour/templates/TASK_TEMPLATE.md`, as UTF-8 text. The service publishes it to the worker through the `task` MCP tool exactly as it stands: the worker fetches it byte for byte, and a later edit reaches the worker at its next fetch.

### 2. Review

```bash
node .contrejour/dist/tools/setup-cli.js review --project .
```

Show the owner `.contrejour/setup-review.md` in full: every module, field, option, recommendation and open issue at once, in the project language. Do not interview field by field. The sheet shows keys and tokens masked.

The owner answers with several changes in one reply, or edits `.contrejour/setup-draft.json` directly. Put their changes in a JSON patch (objects merge, lists replace, `null` clears), save it as `.contrejour/scratch/patch.json` and refresh:

```bash
node .contrejour/dist/tools/setup-cli.js review --project . --input .contrejour/scratch/patch.json
```

Show the whole sheet again after each refresh. A recommendation becomes a value only when the owner accepts it.

- `environment.secrets`: only the keys and tokens the environment scripts need, as `{"NAME": "value"}`; `{}` when there are none. Hosts, paths and commands belong in the environment section (step 7).
- `validation.benchmark`: the base layer of the benchmark, frozen at setup; the `test-extender` role later adds layers derived from its tests. Build it with the owner from `TESTER_FACILITY_CONFIG_TEMPLATE.json` and the runner protocol; `tester-benchmark/` is the worked example. Pin the benchmark source, dataset revision, split and full sample count, and write its commands as argv lists that run on Windows too (`python`, not `python3`). The runner must not import anything from a deliverable; it calls the deliverable only through the adapter the `adapter-writer` role writes under `CONTREJOUR_ADAPTER_DIR`.
- `validation.pass_rule`: when one sample, which is one test, passes: a per-sample benchmark metric, an operator (`>=`, `>`, `<=`, `<`, `==`) and a threshold, e.g. `{"metric": "accuracy", "op": ">=", "threshold": 1}`. Results are published as tests passed out of tests run; there is no score or target.
- `validation.adapter_contract`: exactly how the runner calls `CONTREJOUR_ADAPTER_DIR`. The `adapter-writer` role writes each submission's adapter to it, and the worker builds to it.
- `validation.runtime_environment`: what a deliverable can rely on when it is run here: OS, Python and CUDA versions, GPU and memory, network access, time per input. The worker reads it, with the adapter contract and the limits, through the `requirements` MCP tool, so it must name no test data; leave it empty only if nothing beyond `USAGE.md` can be assumed. A deliverable that needs more is `unusable`; a run that fails because this machine lacks something promised here is a failure on our side.
- `validation.hidden_paths`: absolute paths of the hidden samples, labels and references. The leak reviewer checks feedback against them and the added layers; no role may write them.
- `validation.limits`: maximum counted submissions (the only stop condition), concurrency, upload size, review timeout, leak-review rewrites (`feedback_attempts`) and the tests one review may add (`max_new_tests_per_review`).
- `validation.agent`: how the service starts each review session, `{model, permission_mode, claude_command}`. `model` is the Claude Code model of review sessions, `null` for the CLI's default; a role may set its own. `permission_mode` is `bypassPermissions` (the default), so the benchmark and the deliverable's documented install can use the network and paths outside the project, or `auto`, where a classifier reviews each step and may refuse some. `claude_command` is the argv list that starts Claude Code and must run `--version`; on Windows use the native `claude.exe` or `["node", "<path to cli.js>"]`, never a `.cmd`, which cannot start without a shell.
- `validation.service`: where the service listens and how the worker reaches it, `{host, port, public_url}`. `port` is required, e.g. 8765; `public_url` is the root address, without `/mcp`.
  - Directly on a private network: `host` `0.0.0.0` and `public_url` `http://<this machine's address>:<port>`. On Windows, allow the port through the firewall: `netsh advfirewall firewall add rule name="Contrejour validation" dir=in action=allow protocol=TCP localport=<port>`.
  - Through a tunnel or reverse proxy on this machine: `host` `127.0.0.1`, the port it forwards to, and its address as `public_url`.
  - When the machine already provides the service's address and token, setup uses them as they are. `CONTREJOUR_URL` fills `public_url` and fixes it in the sheet; to enter another address, unset the variable. With `CONTREJOUR_TOKEN` (at least 32 characters), apply uses that token instead of creating one. Both are read when setup runs, so change them only together with a new review, confirm and apply.

Once a submission has been counted, the base benchmark and the pass rule are frozen and the helper reports any change as an issue. Changing them means a new validator project.

### 3. Confirm

When the sheet has no issues, show the final `configuration_sha256` and ask the owner to approve that version. Then:

```bash
node .contrejour/dist/tools/setup-cli.js confirm --project . --digest <configuration_sha256>
```

Any later edit, including to `task.md`, invalidates the confirmation. A request to change something is not approval.

### 4. Apply

```bash
node .contrejour/dist/tools/setup-cli.js apply --project .
```

Apply installs the benchmark (its setup, healthcheck and smoke must pass), freezes `.contrejour/validation/config.json`, and creates the service token or takes `CONTREJOUR_TOKEN`. It writes `environment.secrets` to `.contrejour/environment.json` (mode 0600 where the platform supports it), adds `.contrejour/` to `.gitignore` because it holds credentials, and writes `.claude/settings.json`: the entry role, the hook registrations and `worktree.bgIsolation: "none"`. In `CLAUDE.md` it writes the role block between the `CONTREJOUR ROLE` markers and a placeholder environment section between the `CONTREJOUR ENVIRONMENT` markers, and leaves the rest of the file alone. It returns `role`, `validation_config`, `service_command`, `worker_connection`, `from_environment` (which of `CONTREJOUR_URL` and `CONTREJOUR_TOKEN` came from the machine), `environment_skill_dir`, `environment_secrets`, `settings` and `entry_role`.

A failed apply with an unchanged configuration can be retried as is. A fix that changes the configuration goes back through review and confirm.

### 5. Wiki

Create the wiki, the validator's long-term memory, if `research-wiki/` is absent:

```bash
node .contrejour/dist/tools/research-wiki.js init research-wiki/
```

### 6. Environment skill

Write the scripts of the environment skill in apply's `environment_skill_dir`, on the real machine, as [environment-skill.md](../skills/shared-references/environment-skill.md) describes; its `SKILL.md` only lists them, because the facts go to the environment section (step 7). Whatever reviews do the same way every time becomes a script, for example checking the GPU, memory and disk a run needs. Run every script once for real. If a script cannot be made to work, report the environment step as incomplete with the real error; do not claim the environment is ready.

### 7. Environment section

Write what every role must know about this machine as the same reference describes: machines, paths, environment names and how to activate them, resources and their limits, where metrics land, and verified pitfalls, those the script runs showed included; no keys or tokens. Every role reads this section, so it holds the environment and nothing else. Save the whole section as `.contrejour/scratch/environment.md` and write it; the helper keeps it between its markers and under 8000 characters:

```bash
node .contrejour/dist/tools/setup-cli.js environment --project . --input .contrejour/scratch/environment.md
```

### 8. Loops and roles

```bash
node .contrejour/dist/tools/loop-check.js check --project .
node .contrejour/dist/tools/loop-check.js roles --project .
```

When a loop is stale or has defects, have the `loop-editor` role (Agent tool) regenerate its script from its definition, then check again. A loop that still fails, and a defective role, go to the owner with the check's report: setup edits neither.

### 9. Hand off

1. Give the owner `worker_connection`, the `url` and `token` the worker's setup needs; the token goes to the worker machine over a private channel.
2. The owner starts the service with apply's `service_command`, from the project root, and keeps it running for the whole task: in a terminal multiplexer (tmux, screen) or as an OS service (systemd, a Windows service or scheduled task). If it was already running, it must be restarted to serve the applied address and token.
3. Check it: `node .contrejour/dist/tools/validation-cli.js status --project .`.

The owner starts no review: the service starts one session per submission, running as `entry_role` (`validator-task-manager`), as does a Claude Code session the owner opens in the project. To change the configuration later, start `claude --agent validator-setup` again. Finish setup at this hand-off.

## Output

The hand-off message of step 9: apply's result, the environment section and scripts written with whether each script's real run passed, the loop and role checks, and anything incomplete with its real error.

## Writes

- `task.md`, with the owner, only when it is missing.
- Through `setup-cli.js`: the draft, the review sheet and the setup state; everything apply writes (step 4); the environment section of `CLAUDE.md`.
- Through `research-wiki.js init`: `research-wiki/`.
- Through the `loop-editor` role: regenerated scripts in `.claude/workflows/`.
- Directly: the environment skill in `environment_skill_dir`, and the helper inputs in `.contrejour/scratch/`.

## Evaluation

`trajectory-optimizer` judges this role by:

- **One sheet**: the owner saw the whole sheet each time and confirmed it in few rounds; no field-by-field interview; no value the owner did not accept.
- **Approval**: `confirm` only on the owner's approval of the digest shown; every later change confirmed again.
- **Ownership**: nothing a helper owns written by hand (the setup state, `.contrejour/validation/`, `.contrejour/tester-config.json`, `.claude/settings.json`, the `CLAUDE.md` blocks); helper failures reported with their cause, not worked around.
- **First reviews**: the first submissions reviewed without a setup error: the service starts sessions (`claude_command`, a trusted folder), the worker connects (`host`, `port`, firewall, `public_url`), the benchmark's runner and smoke work, the adapter contract matches the runner, and `hidden_paths` covers every hidden file the leak reviewer needs.
- **Environment**: facts verified, environment only, within the limit; later reviews show what was missed, as runs lost to a fact setup could have recorded or `validator-memory` correcting setup's facts. Every script ran once for real.
- **Hand-off**: the loop and role checks ran, a stale or defective loop was regenerated and passed, and the owner received the service command and the connection, the token kept private.
