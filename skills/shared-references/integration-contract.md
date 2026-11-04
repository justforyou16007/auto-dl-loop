# Integration Contract

The Contrejour package installs roles and loops (`.claude/agents/`, `.claude/loops/`, `.claude/workflows/`), the research-wiki and browser-act skills, and the helpers below: the framework's (agent-loop-studio) and the research task's, side by side. The configuration role (`worker-config` or `validator-config`, in its side's `configure` loop) writes a project-specific environment skill. Other research skills remain optional source tools.

Roles call Contrejour helpers; they never reimplement them. Each helper command belongs to the roles listed here. This file lists every helper and what happens when one is missing or fails.

## Finding a helper

Run helpers from the project root with Node:

```bash
node .contrejour/dist/tools/<helper>.js ...
```

`.contrejour/dist/` is the installed runtime. Inside a checkout of the package
itself, use `dist/tools/` instead. If the file is missing, stop and tell the
owner to rerun the installer with the same role and project to repair the installation; do not look elsewhere or write the helper's output
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
| `config-cli.js` | `worker-config`, `validator-config` (`review`, `fetch-task`, `confirm`, `apply`, `environment`), as the steps of `configure`; `worker-task-manager` (`fetch-task` each round); the memory roles (`environment`) | Stop the step. The helper owns the configuration draft, its review sheet and the confirmed digest, the worker's copy of `task.md` and the environment section of CLAUDE.md. It never chooses the loop the project runs. |
| `validation-cli.js` | the validator's roles: `validator-task-manager` (`finalize`, `abandon`), `adapter-writer` (`smoke`), `regression-runner` (`evaluate`, `retire` for a broken layer), `test-extender` (`evaluate`, `extend`, `retire`), `leak-reviewer` (`leak-review`); every validator role may read `status`; the owner runs `serve` | Stop the review. The helper owns submission records, benchmark layers, leak-review snapshots and published results. |
| `worker-cli.js` | `worker-task-manager` (`requirements`, `ledger-add`, `ledger`, `wait`); other worker roles read `ledger` | Stop the step. The helper owns the ledger, the saved requirements and the results kept in `.contrejour/results/`. |
| `loop-check.js` | `loop-editor` (`stamp`, `check`, `draft`, `install`, `discard`, each with `--draft` on a draft), `role-creator` (`roles --draft`, `draft`, `install`, `discard`), `loop-query` and `validator-task-manager` (`check`), `project-setup` in setup's Check step (`check`, `roles`) | Stop: never run a loop that fails its check, and never copy a draft into `.claude/` by hand: `install` takes only the digest the owner approved. |
| `library-cli.js` | `library-contributor` (`plan`, `clone`, `contribute`, `record-check`, in `library-contribution`), `leak-reviewer` (`record-check`, in the validator's `contribution-check`), `worker-task-manager` (`plan`, when the task closes) | Stop and report the cause. The helper owns what leaves, its digest, the check recorded on it and the record of what was sent; never push or open a pull request by hand. |
| `hook.js` | Claude Code, on the events the installer registers (`project-cli.js hooks`); it runs the actions the loop definitions declare: the framework's `record-trajectory` and `guard-owner-answers`, which `owner-review` relies on, and the research task's `guard-protected-paths` and `notify-stopped-review` | Never fails a session: errors go to `.contrejour/hook-errors.log`. |
| `research-extension.js` | the framework's helpers only (`hook.js`, `library-cli.js`), never a role: the research task's hook actions, the submission a review session works on, which tasks have finished, and what must never leave the project in a contribution | A missing extension means the installation is incomplete: tell the owner to rerun the installer. |
| `research-wiki.js` | `worker-memory`, `validator-memory`; other roles read the wiki and run read-only commands | Stop the wiki write. Never create wiki files by hand. |
| `threat-scan.js` (the framework's; `research-wiki.js` scans what it writes with it) | `research-wiki.js` | Quarantines strict-scope hits; see [injection-hygiene.md](injection-hygiene.md). |
| `capture-filter.js` | the memory roles | Rewrite or drop the flagged note; see [capture-antipatterns.md](capture-antipatterns.md). |
| `ensure-browser-act.js` | `browser-act`, the configuration roles and environment scripts that need a browser | Stop browser work; see [browser-act.md](browser-act.md). |
| `project-cli.js` | `project-setup`, in the framework's `setup` loop: `use` makes the loop the owner approved the project's task loop with its parameter values, `finish-setup` records the project as set up at the hand-off; the owner (`use`, as the Studio does; `show`, what the project is installed as and runs); the installer (`hooks`, the hooks and the entry role) | Stop the step: the loop the project runs and its values are the owner's choice, made at setup's review or in the Studio, and never written by hand. |
| `loop-view.js` | the owner only: a read-only page of the loops, served until stopped | No role runs it. When the owner asks to see the loops, give them the command `node .contrejour/dist/tools/loop-view.js --project .` instead. |
| `studio.js` | the owner only: the console where the owner chooses the task loop and its values, runs loops, and changes loops and roles through the authoring loops, which it starts in background sessions | No role runs it. A session the Studio started is an ordinary task-manager session: run the loop it names and relay the owner's replies as `running-loops.md` says. |

Add a row here in the same change that makes a role call a new helper.
