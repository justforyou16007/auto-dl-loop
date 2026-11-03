---
name: worker-config
description: The steps of the worker's machine-config loop — keeps the configuration sheet with the connection to the validator, applies it, prepares the environment, checks the loops and writes the hand-off. The loop the project runs is chosen in the Studio.
side: worker
effort: high
---

# Worker machine configuration

## Responsibility

Worker side. Contrejour runs one task on two machines. This project is the **worker**: it builds deliverables for `task.md` and submits them to the validator machine, which owns an append-only benchmark the worker never sees and tests each submission as the worker's adversary. The two talk only through the validation service's MCP tools.

The owner installed the project from a local checkout (`bash distribution/install-contrejour.sh --role worker --project PATH`) and chose, in the Studio, the loop the project runs and its parameter values (`.contrejour/loop.json`). You do the steps of the `machine-config` loop, which the project's session runs when the owner asks: the configuration sheet with the connection to the validator, from which `task.md` comes, applying it, the environment, the checks and the hand-off. Configure the validator first: this fetches `task.md` from its running service. Every decision goes to the owner through the loop's `owner-review` steps; you never call a role and never choose the project's loop.

The helper is `node .contrejour/dist/tools/config-cli.js`, run from the project root. It owns the draft, the review sheet, the confirmed digest and this project's copy of `task.md`; never edit `.contrejour/setup-state.json`, `.contrejour/loop.json` or `task.md` by hand. A missing helper or a non-zero exit stops the step: return the error and the step it blocked, as [integration-contract.md](../skills/shared-references/integration-contract.md) says.

## Inputs

- As a step of `machine-config`, JSON: `{action: "sheet", notes, reason}`, `{action: "apply", digest}`, `{action: "environment", notes}`, `{action: "check"}`, `{action: "handoff", applied, environment, incomplete, check}`. `notes` carries the owner's words, verbatim.
- The `worker_connection` that `validator-config` printed on the validator machine, as the owner gives it: `url`, ending in `/mcp`, and `token`, which comes over a private channel.
- This machine: inspect it for what experiments need; the owner is asked, through the loop, only for what inspection cannot tell.

## Steps

### sheet

1. Turn `notes` into a JSON patch (objects merge, lists replace, `null` clears) with only the values the owner gave; a recommendation becomes a value only when the owner accepts it. Save it as `.contrejour/scratch/patch.json` and refresh:

   ```bash
   node .contrejour/dist/tools/config-cli.js review --project . --input .contrejour/scratch/patch.json
   ```

   - `connection.url` and `connection.token`: the `worker_connection`.
   - `environment.secrets`: only the keys and tokens the environment scripts need, as `{"NAME": "value"}`; `{}` when there are none. Hosts, paths and commands belong in the environment section.
2. Once the connection is in the draft and the validator's service is running, fetch the task, then refresh again (`review` without `--input`), so that the confirmation covers it:

   ```bash
   node .contrejour/dist/tools/config-cli.js fetch-task --project .
   ```

   `task.md` is the validator's, byte for byte; never write or copy it. A failure names its cause (an address this machine cannot reach, a token the service refuses, a validator without a UTF-8 `task.md`): put it among the issues.
3. Return the sheet: `review_file` is `.contrejour/setup-review.md` (every module, field, option, recommendation and open issue, keys and tokens masked), `digest` its `configuration_sha256`, `issues` the open issues, with `reason` among them when the loop gave one, and `summary` what changed this time.

### apply

```bash
node .contrejour/dist/tools/config-cli.js confirm --project . --digest <digest>
node .contrejour/dist/tools/config-cli.js apply --project .
```

`digest` is the version the owner approved; `confirm` refuses when the draft changed since: return `failed` with its error. Apply first checks that `task.md` is still the validator's; on `TASK_CHANGED`, run `fetch-task` and return `failed` with that reason, so the owner reviews the new task. Apply then writes `environment.secrets` to `.contrejour/environment.json` (mode 0600 where the platform supports it); the `contrejour` server to `.mcp.json`, replacing only that entry; `.contrejour/` and `.mcp.json` to `.gitignore`, because they hold credentials; and `.claude/settings.json`: the entry role, the hook registrations and `worktree.bgIsolation: "none"`. In `CLAUDE.md` it writes the role block between the `CONTREJOUR ROLE` markers and a placeholder environment section between the `CONTREJOUR ENVIRONMENT` markers, and leaves the rest of the file alone. Return what it wrote as `summary`.

### environment

1. Create the wiki, the worker's long-term memory, if `research-wiki/` is absent: `node .contrejour/dist/tools/research-wiki.js init research-wiki/`.
2. Write the scripts of the environment skill in apply's `environment_skill_dir` (`.claude/skills/<project>-environment/`), on the real machine, as [environment-skill.md](../skills/shared-references/environment-skill.md) describes; its `SKILL.md` only lists them, because the facts go to the environment section. Run every script once for real; for a launch, a small, short run. A script that cannot be made to work goes in `incomplete` with the real error; never claim the environment is ready.
3. Write what every role must know about this machine, as the same reference describes: one line per verified fact, the pitfalls the script runs showed included, and no keys or tokens. Every role reads this section, the blank ideator included, so it holds the environment and nothing else. Save the whole section as `.contrejour/scratch/environment.md` and write it; the helper keeps it between its markers and under 8000 characters:

   ```bash
   node .contrejour/dist/tools/config-cli.js environment --project . --input .contrejour/scratch/environment.md
   ```

4. When a fact only the owner has is missing (a host, a quota, a path inspection cannot find), set `needs_owner` and write `request`; their answer comes back in `notes`.

### check

```bash
node .contrejour/dist/tools/loop-check.js check --project .
node .contrejour/dist/tools/loop-check.js roles --project .
```

Return in `stale` every loop that is stale or has defects, for the loop to regenerate, and in `defects` whatever else the checks report.

### handoff

Write the report for the owner: what apply wrote, the loop the project runs and its parameter values as `.contrejour/loop.json` records them (or that none is chosen yet: the owner chooses it in the Studio, `node .contrejour/dist/tools/studio.js --project .`), each environment script with whether its real run passed, the environment section, the checks, and anything incomplete with its real error. Then how to start work: run the loop from the Studio, or open a new session in the project with `claude --permission-mode bypassPermissions "start"`. The loop runs unattended, so the session needs a mode that does not wait for approvals; `auto` instead has a classifier review each step, which may refuse some. The session runs as `worker-task-manager` and loads `.mcp.json` (approve the `contrejour` server if Claude Code asks). Once a submission has finished, the owner can send this project's new and changed loops and roles back to the libraries they came from with `claude "Run the library-contribution loop"`.

## Output

- `sheet`: `{has_issues, digest, review_file, issues, summary}`.
- `apply`: `{failed, reason, summary}`.
- `environment`: `{needs_owner, request, summary, incomplete}`.
- `check`: `{stale, defects}`.
- `handoff`: `{report}`.

## Writes

- Through `config-cli.js`: the draft, the review sheet and the configuration state; `task.md`; everything apply writes; the environment section of `CLAUDE.md`.
- Through `research-wiki.js init`: `research-wiki/`.
- Directly: the environment skill in `environment_skill_dir`, and the helper inputs in `.contrejour/scratch/`.

## Evaluation

- **One sheet**: each review showed the whole sheet; the owner confirmed in few rounds; no value the owner did not give.
- **Approval**: `confirm` only with the digest the loop passed; `TASK_CHANGED` sent the sheet back for review.
- **Ownership**: nothing a helper owns written by hand (`task.md`, the configuration state, `.contrejour/loop.json`, `.mcp.json`, `.claude/settings.json`, the `CLAUDE.md` blocks); helper failures returned with their cause, not worked around.
- **Environment facts**: verified, environment only, within the limit. Later rounds show what was missed: implementer runs lost to a fact the configuration could have recorded, and `worker-memory` correcting its facts.
- **Scripts**: each ran once for real; a script that fails on its first later use, or a procedure the implementer keeps doing by hand, counts against the configuration.
- **Hand-off**: the first `worker-task-manager` session starts and reaches the validation service without a configuration error.
