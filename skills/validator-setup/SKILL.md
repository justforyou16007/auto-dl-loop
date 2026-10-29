---
name: validator-setup
description: 'Set up this project as the Contrejour validator: write task.md with the owner, freeze the benchmark and the validation terms through one editable configuration sheet, register the validation service and write the project environment skill. Use for "/validator-setup", validator setup or 配置验证端.'
allowed-tools: Read, Write, Edit, Bash(*), AskUserQuestion
---

# Validator Setup

Contrejour runs one task on two machines. This project is the **validator**: it owns an append-only benchmark the worker never sees and tests each submission as the worker's adversary, adding tests derived from the problems it finds. The task ends when the counted submissions run out. The worker reaches this machine only through the validation service's MCP tools. Each machine runs official Paseo, so the owner sees both sides' agents. Set up this machine before the worker, whose `worker-setup` needs the running service.

The role and the backend were chosen at installation from the owner's prepared local Git checkout (`bash distribution/install-contrejour.sh --role validator --project PATH [--provider claude|codex]`; Codex without `--provider`). The service starts every validator agent on that backend at thinking `max`:

| Backend  | Instructions |
| -------- | ------------ |
| `claude` | `CLAUDE.md`  |
| `codex`  | `AGENTS.md`  |

The helper is `node .contrejour/dist/tools/setup-cli.js` (see [integration-contract.md](../shared-references/integration-contract.md)). It owns the draft, the review sheet and the confirmed digest; never edit `.contrejour/setup-state.json` by hand.

## 1. Task

`task.md` at the project root is the whole task. If it is missing, write it with the owner from `.contrejour/templates/TASK_TEMPLATE.md`, as UTF-8 text. The service publishes it to the worker through the `task` MCP tool exactly as it stands: the worker's setup copies it byte for byte, and a later edit reaches the worker at its next fetch.

## 2. Review

```bash
node .contrejour/dist/tools/setup-cli.js review --project .
```

Show the owner `.contrejour/setup-review.md` in full: every module, field, option, recommendation and open issue at once, in the project language. Do not interview field by field. The sheet shows keys and tokens masked.

The owner answers with several changes in one reply, or edits `.contrejour/setup-draft.json` directly. Put their changes in a JSON patch (objects merge, lists replace, `null` clears) and refresh:

```bash
node .contrejour/dist/tools/setup-cli.js review --project . --input patch.json
```

Show the whole sheet again after each refresh. A recommendation becomes a value only when the owner accepts it.

- `environment.secrets`: only the keys and tokens the environment scripts need, as `{"NAME": "value"}`; `{}` when there are none. Hosts, paths and commands belong in the environment skill (step 5).
- `validation.benchmark`: the base layer of the benchmark, frozen at setup; validator agents later add layers derived from its tests. Build it with the owner from `.contrejour/templates/TESTER_FACILITY_CONFIG_TEMPLATE.json` and the runner protocol in `.contrejour/templates/README.md`; `.contrejour/templates/tester-benchmark/` is a worked lm-evaluation-harness example. Pin the benchmark source, dataset revision, split and full sample count. The runner must not import anything from a deliverable; it calls the deliverable only through the adapter a validator agent writes under `CONTREJOUR_ADAPTER_DIR`.
- `validation.pass_rule`: when one sample, which is one test, passes: a per-sample benchmark metric, an operator (`>=`, `>`, `<=`, `<`, `==`) and a threshold, e.g. `{"metric": "accuracy", "op": ">=", "threshold": 1}`. Results are published as tests passed out of tests run; there is no score or target.
- `validation.runtime_environment`: what a deliverable can rely on when a validator agent runs it: OS, Python and CUDA versions, GPU and memory, network access, time per input. The worker reads it, with the adapter contract and the limits, through the `requirements` MCP tool, so it must name no test data; leave it empty only if nothing beyond `USAGE.md` can be assumed.
- `validation.hidden_paths`: absolute paths of the hidden samples, labels and references. The independent leak reviewer checks feedback against them and the added layers.
- `validation.limits`: maximum counted submissions (the only stop condition), concurrency, upload size, review timeout, leak-review rewrites and the tests one review may add.
- `validation.agent`: the per-submission validator agent runs on the installed backend (`provider`, fixed) at `max`; the sheet sets its model and mode. The mode defaults to full access (`full-access` for Codex, `bypassPermissions` for Claude Code), so the benchmark and the deliverable's documented install can use the network and paths outside the project; Codex's `auto` and `auto-review` sandbox them and Claude Code's `auto` has a classifier review each step. On Windows `paseo_command` must be `["node", "<Paseo install>\\bin\\paseo"]`; setup rejects the `paseo` shim.
- `validation.service`: how the worker reaches the service.
  - Through the Paseo service proxy: keep `host` at `127.0.0.1`, leave `port` null, and set `public_url` to the proxy URL of the `contrejour` script.
  - Directly on a private network: set `host` to `0.0.0.0`, a fixed `port`, and `public_url` to `http://<this machine's address>:<port>`. On Windows, allow that port through the firewall: `netsh advfirewall firewall add rule name="Contrejour validation" dir=in action=allow protocol=TCP localport=<port>`.
  - When the machine already provides the service's address and token, setup uses them as they are. `CONTREJOUR_URL` fills `public_url` (the root address, without `/mcp`) and fixes it in the sheet; to enter another address, unset the variable. With `CONTREJOUR_TOKEN` (at least 32 characters), apply uses that token instead of creating one. Both are read when setup runs, so change them only together with a new review, confirm and apply.

Once a submission has been counted, the base benchmark and the pass rule are frozen and the helper reports any change as an issue. Changing them means a new validator project.

## 3. Confirm

When the sheet has no issues, show the final `configuration_sha256` and ask the owner to approve that version. Then:

```bash
node .contrejour/dist/tools/setup-cli.js confirm --project . --digest <configuration_sha256>
```

Any later edit, including to `task.md`, invalidates the confirmation. A request to change something is not approval.

## 4. Apply

```bash
node .contrejour/dist/tools/setup-cli.js apply --project .
```

Apply installs the benchmark (setup, healthcheck and smoke must pass), freezes `.contrejour/validation/config.json`, creates the service token (or takes `CONTREJOUR_TOKEN`) and adds the `contrejour` service script to `paseo.json`; `from_environment` lists the values that came from the machine. It writes the role block between the `CONTREJOUR ROLE` markers of the instruction file and leaves the rest of the file alone, writes `environment.secrets` to `.contrejour/environment.json` (mode 0600 where the platform supports it) and adds `.contrejour/` to `.gitignore`, because it holds credentials.

Create the wiki, the validator's long-term memory, if `research-wiki/` is absent: `node .contrejour/dist/tools/research-wiki.js init research-wiki/`. Then:

1. Give the owner the printed `worker_connection` URL and token for `worker-setup` on the worker machine. Send the token over a private channel.
2. Have the owner start the `contrejour` script from the Paseo workspace, or restart it if it was running, so it serves the applied address and token.
3. Check it: `node .contrejour/dist/tools/validation-cli.js status --project .`.

## 5. Environment skill

Write the project's environment skill in apply's `environment_skill_dir`, on the real machine, as [environment-skill.md](../shared-references/environment-skill.md) describes. Validator agents later add the reusable testing tools they build to it.

## 6. Hand off

List the available skills, including the environment skill. Tell the owner to run **`reload-skills`** in Claude Code (or open a fresh session; Codex always needs one). The owner starts no agent here: the service starts one validator agent per submission, on the project's backend at `max`.

Finish setup at this handoff.

A failed apply step with an unchanged configuration can be retried as is. A fix that changes the configuration goes back through review and confirm.
