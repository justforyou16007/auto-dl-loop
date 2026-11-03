# Integration Contract

The standalone Contrejour package installs roles and loops (`.claude/agents/`, `.claude/loops/`, `.claude/workflows/`), the research-wiki and browser-act skills, and the helpers below. The setup role writes a project-specific environment skill. Other research skills remain optional source tools.

Roles call Contrejour helpers; they never reimplement them. Each helper command belongs to the roles listed here. This file lists every helper and what happens when one is missing or fails.

## Finding a helper

Run helpers from the project root with Node:

```bash
node .contrejour/dist/tools/<helper>.js ...
```

`.contrejour/dist/` is the installed runtime. Inside the Contrejour package checkout
itself, use `dist/tools/` instead. If the file is missing, stop and tell the
owner to rerun the standalone installer with the same role and project to repair the installation; do not look elsewhere or write the helper's output
by hand.

## Failure rule

A missing helper or a non-zero exit stops the current step. Report the
helper's error and the step it blocked. Do not:

- retry with another tool, source, model or command;
- write the helper's artifact yourself;
- skip the step and report success.

## Helpers

| Helper | Used by | Failure |
| --- | --- | --- |
| `setup-cli.js` | `worker-setup`, `validator-setup`; `worker-task-manager` (`fetch-task` each round); the setup and memory roles (`environment`) | Stop setup or the step. The helper owns the draft, the review, the confirmed digest, the chosen loop with its parameters (`.contrejour/loop.json`), the worker's copy of `task.md` and the environment section of CLAUDE.md. |
| `validation-cli.js` | the validator's roles: `validator-task-manager` (`finalize`, `abandon`), `adapter-writer` (`smoke`), `regression-runner` (`evaluate`, `retire` for a broken layer), `test-extender` (`evaluate`, `extend`, `retire`), `leak-reviewer` (`leak-review`); every validator role may read `status`; the owner runs `serve` | Stop the review. The helper owns submission records, benchmark layers, leak-review snapshots and published results. |
| `worker-cli.js` | `worker-task-manager` (`requirements`, `ledger-add`, `ledger`, `wait`); other worker roles read `ledger` | Stop the step. The helper owns the ledger, the saved requirements and the results kept in `.contrejour/results/`. |
| `loop-check.js` | `loop-editor` (`stamp`, `check`, `draft`, `install`, `discard`, each with `--draft` on a draft), `role-creator` (`roles --draft`, `draft`, `install`, `discard`), `loop-query` and the task managers (`check`), the setup roles (`check`, `roles`) | Stop: never run a loop that fails its check, and never copy a draft into `.claude/` by hand: `install` takes only the digest the owner approved. |
| `library-cli.js` | `library-contributor` (`plan`, `clone`, `contribute`), `leak-reviewer` (`record-leak-check`), `worker-task-manager` (`plan`, when the task closes) | Stop the contribution and report the cause. The helper owns what leaves, its digest and the record of contributions; never push or open a pull request by hand. |
| `hook.js` | Claude Code, on the events the installer and setup register; it runs the actions the loop definitions declare, among them `guard-owner-answers`, which `owner-review` relies on | Never fails a session: errors go to `.contrejour/hook-errors.log`. |
| `research-wiki.js` | `worker-memory`, `validator-memory`; other roles read the wiki and run read-only commands | Stop the wiki write. Never create wiki files by hand. |
| `threat-scan` (inside `research-wiki.js`) | `research-wiki.js` | Quarantines strict-scope hits; see [injection-hygiene.md](injection-hygiene.md). |
| `capture-filter.js` | the memory roles | Rewrite or drop the flagged note; see [capture-antipatterns.md](capture-antipatterns.md). |
| `ensure-browser-act.js` | `browser-act`, setup and environment scripts that need a browser | Stop browser work; see [browser-act.md](browser-act.md). |
| `loop-view.js` | the owner only: a read-only page of the loops, served until stopped | No role runs it. When the owner asks to see the loops, give them the command `node .contrejour/dist/tools/loop-view.js --project .` instead. |
| `studio.js` | the owner only: the console that draws loops, previews candidates and starts authoring loops in background sessions | No role runs it. A session the Studio started is an ordinary task-manager session: run the loop it names and relay the owner's replies as `running-loops.md` says. |

Add a row here in the same change that makes a role call a new helper.
