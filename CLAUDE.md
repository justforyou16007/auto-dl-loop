# Contrejour

This repository holds Contrejour, a two-machine research task (worker and validator) built on agent-loop-studio, the framework of agent loops on Claude Code. The framework is the git submodule `agent-loop-studio/`, and the shared library of loops and roles, agent-loop-community, is the submodule `agent-loop-community/`; this package pins a version of each, and neither depends on it. It runs on Claude Code only; do not add Codex or Paseo support, and do not add Claude Code's own source here.

Read `docs/` before non-trivial changes. Package conventions are in [docs/packaging.md](docs/packaging.md), coding rules in [docs/coding-standards.md](docs/coding-standards.md), testing in [docs/testing.md](docs/testing.md), system constraints in [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md), and the framework's design in [agent-loop-studio/docs/architecture.md](agent-loop-studio/docs/architecture.md).

This package holds `project.json` (its profiles, extension and hook actions), the research helpers in `src/tools/` (the extension is `research-extension.ts`), the research library in `library/{loops,roles}/{worker,validator}/`, and the project's rules for the framework's roles in `skills/shared-references/project-rules.md`. Changes to the framework (its helpers, the Studio, the installer, the base loops and roles in `agent-loop-studio/library/`) are made in agent-loop-studio, not here; then bump the submodule. Once one of its tasks has finished, a project sends its new and changed loops and roles back to the library each came from with the `library-contribution` loop, one pull request per library; maintainers review and merge them. Check the research library, laid over the framework's and the community's, with `npm run build && node tools/library-check.mjs`, adding `--stamp` after regenerating a library script from its definition.

- Preserve the adversarial worker/validator separation, test counts measured by the helper, finalize's checks, and the leak review bound to the feedback's digest. The default validation loop's append-only benchmark (registered layers never change; new tests derive from existing ones) stays mechanically checked by the helper.
- Sessions run loops, loops schedule roles, roles do the steps: no flow lives outside a loop, a role never runs another role, and an owner decision is an `owner-review` step of a loop. How a step is done lives in its role file. Every operation belongs to a role; helpers are tools of roles.
- Keep project installation independent of global configuration.
- Keep helpers compatible with Node.js 22.12+ and Windows; launch configured commands as argv arrays.
- Build the framework before this package: `npm --prefix agent-loop-studio ci` and `npm run build:framework`, then `npm run build`.
- Run `npm run typecheck` and `npm run lint` after changes, and `npm run format` before committing.
- Run only the relevant test file with `npm run test -- tests/<file>.ts`; leave the full test matrix to CI.
- Refresh `distribution/releases/` from `npm run pack:contrejour` when shipped code, roles, loops, skills or documentation change, or a submodule moves.
- Never restart a running Claude Code background service or Paseo daemon without permission.
