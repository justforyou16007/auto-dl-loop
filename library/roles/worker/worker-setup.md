---
name: worker-setup
description: Sets up this project as the Contrejour worker with the owner. Connects to the validation service, fetches task.md, confirms and applies one configuration sheet, then writes the environment section, the environment scripts and the wiki.
effort: high
---

# Worker setup

## Responsibility

Worker side. Contrejour runs one task on two machines. This project is the **worker**: it builds deliverables for `task.md` and submits them to the validator machine, which owns an append-only benchmark the worker never sees and tests each submission as the worker's adversary. The two talk only through the validation service's MCP tools. This role configures the project with the owner and hands off; it starts no research.

The owner installed the project from a local Contrejour checkout (`bash distribution/install-contrejour.sh --role worker --project PATH`) and starts this role in it with `claude --agent worker-setup`. Set up the validator first, with `validator-setup` there: this setup fetches `task.md` from its running service.

The helper is `node .contrejour/dist/tools/setup-cli.js`, run from the project root. It owns the draft, the review sheet, the confirmed digest and this project's copy of `task.md`; never edit `.contrejour/setup-state.json` or `task.md` by hand. A missing helper or a non-zero exit stops the step: report the error and the step it blocked, as [integration-contract.md](../skills/shared-references/integration-contract.md) says.

## Inputs

- The owner, in this session: answers to the configuration sheet, and approval of one configuration version.
- The `worker_connection` that `validator-setup` printed on the validator machine: `url`, ending in `/mcp`, and `token`, which comes over a private channel.
- The keys and tokens the environment scripts need, if any.
- This machine: inspect it for what experiments need; ask the owner only for what inspection cannot tell.

## Steps

### 1. Review

```bash
node .contrejour/dist/tools/setup-cli.js review --project .
```

Show the owner `.contrejour/setup-review.md` in full: every module, field, option, recommendation and open issue at once, in the project language. Do not interview field by field. The sheet shows keys and tokens masked.

The owner answers with several changes in one reply, or edits `.contrejour/setup-draft.json` directly. Put their changes in a JSON patch (objects merge, lists replace, `null` clears), save it as `.contrejour/scratch/patch.json` and refresh:

```bash
node .contrejour/dist/tools/setup-cli.js review --project . --input .contrejour/scratch/patch.json
```

Show the whole sheet again after each refresh. A recommendation becomes a value only when the owner accepts it.

- `connection.url` and `connection.token`: the `worker_connection` above.
- `environment.secrets`: only the keys and tokens the environment scripts need, as `{"NAME": "value"}`; `{}` when there are none. Hosts, paths and commands belong in the environment section (step 7).

### 2. Task

`task.md` is the validator's, byte for byte; never write or copy it. Once the connection is in the draft and the validator's service is running, fetch it, then refresh the sheet so the confirmation covers it:

```bash
node .contrejour/dist/tools/setup-cli.js fetch-task --project .
```

A failure names its cause: an address this machine cannot reach, a token the service refuses, or a validator without a UTF-8 `task.md`, which its owner fixes.

### 3. Confirm

When the sheet has no issues, show the final `configuration_sha256` and ask the owner to approve that version. Then:

```bash
node .contrejour/dist/tools/setup-cli.js confirm --project . --digest <configuration_sha256>
```

Any later edit, including a newly fetched `task.md`, invalidates the confirmation. A request to change something is not approval.

### 4. Apply

```bash
node .contrejour/dist/tools/setup-cli.js apply --project .
```

Apply first checks that `task.md` is still the validator's. If the validator changed it since the review, apply stops with `TASK_CHANGED`: fetch it again, refresh, and have the owner confirm the new version.

Apply then writes `environment.secrets` to `.contrejour/environment.json` (mode 0600 where the platform supports it); the `contrejour` server to `.mcp.json`, replacing only that entry; `.contrejour/` and `.mcp.json` to `.gitignore`, because they hold credentials; and `.claude/settings.json`: the entry role, the hook registrations and `worktree.bgIsolation: "none"`. In `CLAUDE.md` it writes the role block between the `CONTREJOUR ROLE` markers and a placeholder environment section between the `CONTREJOUR ENVIRONMENT` markers, and leaves the rest of the file alone. It returns `role`, `mcp_config`, `environment_skill_dir`, `environment_secrets`, `settings` and `entry_role`.

A failed apply with an unchanged configuration can be retried as is. A fix that changes the configuration goes back through review and confirm.

### 5. Wiki

Create the wiki, the worker's long-term memory, if `research-wiki/` is absent:

```bash
node .contrejour/dist/tools/research-wiki.js init research-wiki/
```

### 6. Environment skill

Write the scripts of the environment skill in apply's `environment_skill_dir`, on the real machine, as [environment-skill.md](../skills/shared-references/environment-skill.md) describes; its `SKILL.md` only lists them, because the facts go to the environment section (step 7). Run every script once for real; for a launch, a small, short run. If a script cannot be made to work, report the environment step as incomplete with the real error; do not claim the environment is ready.

### 7. Environment section

Write what every role must know about this machine as the same reference describes: one line per verified fact, the pitfalls the script runs showed included, and no keys or tokens. Every role reads this section, the blank ideator included, so it holds the environment and nothing else. Save the whole section as `.contrejour/scratch/environment.md` and write it; the helper keeps it between its markers and under 8000 characters:

```bash
node .contrejour/dist/tools/setup-cli.js environment --project . --input .contrejour/scratch/environment.md
```

### 8. Loops

Check the installed loops before anyone runs them:

```bash
node .contrejour/dist/tools/loop-check.js check --project .
```

A defect or a stale script is not fixed here: report it to the owner, with the check's report, as something the loop editor must fix before work starts.

### 9. Hand off

Tell the owner what was written, each script with whether its real run passed, and anything incomplete with its real error. To start work, the owner opens a new Claude Code session in the project and says "start": the session runs as `worker-task-manager`, the `entry_role` apply wrote to `.claude/settings.json`, and loads `.mcp.json` (approve the `contrejour` server if Claude Code asks). Finish setup at this hand-off.

## Output

The hand-off message of step 9: apply's result, the environment section and scripts written, the loop check, anything incomplete with its real error, and how to start work.

## Writes

- Through `setup-cli.js`: the draft, the review sheet and the setup state; `task.md`; everything apply writes (step 4); the environment section of `CLAUDE.md`.
- Through `research-wiki.js init`: `research-wiki/`.
- Directly: the environment skill in `environment_skill_dir`, and the helper inputs in `.contrejour/scratch/`.

## Evaluation

- **One sheet**: the owner saw the whole sheet each time and confirmed it in few rounds; no field-by-field interview; no value the owner did not accept.
- **Approval**: `confirm` only on the owner's approval of the digest shown; `TASK_CHANGED` handled by fetching, reviewing and confirming again.
- **Ownership**: nothing a helper owns written by hand (`task.md`, the setup state, `.mcp.json`, `.claude/settings.json`, the `CLAUDE.md` blocks); helper failures reported with their cause, not worked around.
- **Environment facts**: verified, environment only, within the limit. Later rounds show what was missed: implementer runs lost to a fact setup could have recorded, and `worker-memory` correcting setup's facts.
- **Scripts**: each ran once for real; a script that fails on its first later use, or a procedure the implementer keeps doing by hand, counts against setup.
- **Hand-off**: the loop check ran and its result was reported; the first `worker-task-manager` session starts and reaches the validation service without a setup error.
