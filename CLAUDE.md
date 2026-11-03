# Contrejour

This repository contains Contrejour: an agent-loop framework on Claude Code — loops that schedule roles, trajectory-driven fixes to roles, a shared library of loops and roles — and its first application, a two-machine research task (worker and validator). It runs on Claude Code only; do not add Codex or Paseo support, and do not add Claude Code's own source here.

Read `docs/` before non-trivial changes. Package conventions are in [docs/packaging.md](docs/packaging.md), coding rules in [docs/coding-standards.md](docs/coding-standards.md), testing in [docs/testing.md](docs/testing.md), and system constraints in [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md).

The library of loops and roles lives in `library/`. Once one of its tasks has finished, a project contributes its new and changed loops and roles through the `library-contributor` role, as a pull request; maintainers review and merge them. Check it with `npm run build && node tools/library-check.mjs`, adding `--stamp` after regenerating a library script from its definition.

- Preserve the adversarial worker/validator separation, test counts measured by the helper, finalize's checks, and the leak review bound to the feedback's digest. The default validation loop's append-only benchmark (registered layers never change; new tests derive from existing ones) stays mechanically checked by the helper.
- Sessions run loops, loops schedule roles, roles do the steps: no flow lives outside a loop, a role never runs another role, and an owner decision is an `owner-review` step of a loop. How a step is done lives in its role file. Every operation belongs to a role; helpers are tools of roles.
- Keep project installation independent of global configuration.
- Keep helpers compatible with Node.js 22.12+ and Windows; launch configured commands as argv arrays.
- Run `npm run typecheck` and `npm run lint` after changes, and `npm run format` before committing.
- Run only the relevant test file with `npm run test -- tests/<file>.ts`; leave the full test matrix to CI.
- Refresh `distribution/releases/` from `npm run pack:contrejour` when shipped code, roles, loops, skills or documentation change.
- Never restart a running Claude Code background service or Paseo daemon without permission.
