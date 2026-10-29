---
name: worker-setup
description: 'Set up this project as the Contrejour worker: connect it to the validation service, fetch task.md, confirm one editable configuration sheet and write the project environment skill. Use for "/worker-setup", worker setup or 配置 worker.'
allowed-tools: Read, Write, Edit, Bash(*), AskUserQuestion
---

# Worker Setup

Contrejour runs one task on two machines. This project is the **worker**: it builds a deliverable and submits it to the validator machine, which owns an append-only benchmark the worker never sees and tests each submission as the worker's adversary. The two talk only through the validation service's MCP tools. Each machine runs official Paseo, so the owner sees both sides' agents. Set up the validator machine first, with `validator-setup` there: this setup needs its running service.

The role and the backend were chosen at installation from the owner's prepared local Git checkout (`bash distribution/install-contrejour.sh --role worker --project PATH [--provider claude|codex]`; Claude Code without `--provider`):

| Backend  | Instructions | MCP config           | Thinking    |
| -------- | ------------ | -------------------- | ----------- |
| `claude` | `CLAUDE.md`  | `.mcp.json`          | `ultracode` |
| `codex`  | `AGENTS.md`  | `.codex/config.toml` | `ultra`     |

The helper is `node .contrejour/dist/tools/setup-cli.js` (see [integration-contract.md](../shared-references/integration-contract.md)). It owns the draft, the review sheet, the confirmed digest and this project's copy of `task.md`; never edit `.contrejour/setup-state.json` or `task.md` by hand.

## 1. Review

```bash
node .contrejour/dist/tools/setup-cli.js review --project .
```

Show the owner `.contrejour/setup-review.md` in full: every module, field, option, recommendation and open issue at once, in the project language. Do not interview field by field. The sheet shows keys and tokens masked.

The owner answers with several changes in one reply, or edits `.contrejour/setup-draft.json` directly. Put their changes in a JSON patch (objects merge, lists replace, `null` clears) and refresh:

```bash
node .contrejour/dist/tools/setup-cli.js review --project . --input patch.json
```

Show the whole sheet again after each refresh. A recommendation becomes a value only when the owner accepts it.

- `connection.url` and `connection.token`: the `worker_connection` that `validator-setup` printed on the validator machine; the token comes over a private channel.
- `environment.secrets`: only the keys and tokens the environment scripts need, as `{"NAME": "value"}`; `{}` when there are none. Hosts, paths and commands belong in the environment skill (step 5).

## 2. Task

`task.md` is the validator's, byte for byte; never write or copy it. Once the connection is in the draft and the validator's `contrejour` service is running, fetch it, then refresh the sheet so the confirmation covers it:

```bash
node .contrejour/dist/tools/setup-cli.js fetch-task --project .
```

A failure names its cause: an address this machine cannot reach, a token the service refuses, or a validator without a UTF-8 `task.md`, which its owner fixes.

## 3. Confirm

When the sheet has no issues, show the final `configuration_sha256` and ask the owner to approve that version. Then:

```bash
node .contrejour/dist/tools/setup-cli.js confirm --project . --digest <configuration_sha256>
```

Any later edit, including a newly fetched `task.md`, invalidates the confirmation. A request to change something is not approval.

## 4. Apply

```bash
node .contrejour/dist/tools/setup-cli.js apply --project .
```

Apply first checks that `task.md` is still the validator's. If the validator changed it since the review, apply stops with `TASK_CHANGED`: fetch it again, refresh, and have the owner confirm the new version.

Apply then writes the role block between the `CONTREJOUR ROLE` markers of the instruction file and leaves the rest of the file alone, writes `environment.secrets` to `.contrejour/environment.json` (mode 0600 where the platform supports it), adds the `contrejour` server to `.mcp.json` (Claude Code) or `.codex/config.toml` (Codex, which reads it only in a trusted project), replacing only that entry, and adds `.contrejour/` and that MCP config to `.gitignore`, because they hold credentials.

Create the wiki, the worker's long-term memory, if `research-wiki/` is absent: `node .contrejour/dist/tools/research-wiki.js init research-wiki/`. Resolve and record the owner's local Contrejour source checkout and its `experience` worktree in the instruction file outside the managed role block, following [the experience contract](../shared-references/experience.md). Preserve existing owner text. Report an unavailable location as pending; do not use the installed `.contrejour/` directory as an experience repository.

## 5. Environment skill

Write the project's environment skill in apply's `environment_skill_dir`, on the real machine, as [environment-skill.md](../shared-references/environment-skill.md) describes.

## 6. Hand off

List the available skills, including the environment skill. Tell the owner to run **`reload-skills`** in Claude Code (or open a fresh session; Codex always needs one) and to run the worker in Paseo with the `agent` settings apply reports: Claude Code at `ultracode` or Codex at `ultra`. The changed MCP configuration needs a fresh session; then check that `query` answers.

Finish setup at this handoff. Start research only when the owner requests it.

A failed apply step with an unchanged configuration can be retried as is. A fix that changes the configuration goes back through review and confirm.
