# Contributing

This repository holds the research task. The framework it runs on, [agent-loop-studio](https://github.com/justforyou16007/agent-loop-studio), and the shared library of loops and roles, [agent-loop-community](https://github.com/justforyou16007/agent-loop-community), are git submodules at `agent-loop-studio/` and `agent-loop-community/`, each pinned at a version. Dependencies point one way: this package uses them, and neither needs it to build or to pass its checks.

So a change goes where it belongs:

- **The framework** (its helpers such as the hooks, the loop check and the contribution helper; the Studio; the installer; the base loops and roles, `setup` among them): make it in agent-loop-studio, as a pull request there. Once it is merged, bump the submodule here in a commit of its own. CI checks the submodules out, so a pull request here can only point at a submodule commit that is already on GitHub.
- **A new loop or role a project made**: agent-loop-community, which takes every contribution, whichever side it serves. Its [check](agent-loop-community/tools/check.mjs) notes, and does not fail, a side's loop that uses what that side's package provides, because the community library cannot check those: the project that contributed the loop checked it whole. Its [README](agent-loop-community/README.md) says what it accepts.
- **What belongs to the research task** (its helpers, and the worker's and validator's loops and roles): here. A machine is set up by the framework's `setup` loop: to change what setup settles on a machine, change that side's `configure` and its role here; to change setup's own steps, change agent-loop-studio.

## Prepare a checkout

Use Node.js 22.12+. Clone with the submodules and build the framework before this package, because this package's build copies the framework's compiled helpers and the Studio's page into `dist/` and bundles its own helpers next to them:

```bash
git clone --recurse-submodules https://github.com/justforyou16007/auto-dl-loop.git
cd auto-dl-loop
npm ci
npm --prefix agent-loop-studio ci
npm run build:framework
npm run build
```

In an existing checkout, `git submodule update --init` fetches the submodules at their pinned versions. There are no npm workspaces, and nothing here contains or builds Claude Code.

After changes, run `npm run build`, `npm run typecheck`, `npm run lint` and `npm run format:check`; run `npm run format` before committing. Run only the relevant test file, for example `npm run test -- tests/test_validation.ts`, and leave the full matrix to CI; build first, because the suites use the compiled helpers. The [testing guide](docs/testing.md) describes the evidence bar.

## Where things live

| Path | Contents |
| --- | --- |
| `project.json` | What the package tells the framework and the installer about itself: the profiles `worker` and `validator`, each with its entry role, its library side and the note the installer prints for it (`next`); the extension module; the hook actions it adds |
| `library/roles/worker/`, `library/roles/validator/` | The research roles installation seeds into projects of each side |
| `library/loops/worker/`, `library/loops/validator/` | The research loops: each a definition (`<loop>.md`) and its generated script (`<loop>.js`). Each side's `configure` and the validator's `contribution-check` take the place of the framework's loops of those names |
| `src/tools/` | The research helpers (the configuration sheet, the validation service, the worker's ledger, the wiki) and `research-extension.ts`, the extension the framework loads |
| `skills/` | Skills; only `research-wiki`, `browser-act` and `shared-references` ship. `shared-references/project-rules.md` holds this package's rules for the framework's roles |
| `templates/` | Project scaffolding: the role blocks, the environment placeholder, the task and benchmark templates |
| `tests/` | The test suites |
| `tools/` | The build, the library check and packaging |
| `distribution/` | The installer's entry point and the released archive |
| `agent-loop-studio/`, `agent-loop-community/` | The framework and the shared library, as submodules: change them in their own repositories |

## Roles and loops

A session starts loops and carries the owner's answers into them, a loop schedules roles, and a role does one step: no flow lives outside a loop, a role never runs another role, and a decision of the owner's is an `owner-review` step ([running-loops.md](agent-loop-studio/skills/shared-references/running-loops.md)). How a step is done belongs in its role's file, never in a script or a prompt: every operation belongs to a role, and helpers are tools of roles. What must be guaranteed mechanically (test counts, finalize's checks, the append-only benchmark) stays in a helper. The forms are specified by the framework roles that write them: a role's by [`role-creator`](agent-loop-studio/library/roles/framework/role-creator.md) (frontmatter `name` matching the file, `description` and `side`, which must match the directory; sections Responsibility, Inputs, Output, Writes and Evaluation), a loop's definition and the script rules by [`loop-editor`](agent-loop-studio/library/roles/framework/loop-editor.md). A script only schedules roles, gives every call a `schema` and a declared `phase`, loops within a fixed bound, and uses neither the clock nor randomness. A loop may declare only the framework's hook actions and the two this package names in `project.json`.

Check the research library as a project of each side receives it, laid over the framework's library and the community's:

```bash
npm run build && node tools/library-check.mjs
```

It copies the framework's library, the community's and this package's, in that order, into a temporary folder and runs the loop and role checks on the result; a non-zero exit means a defect, named in its report. After regenerating a script from its changed definition, run it with `--stamp`, which records each definition's digest in its script (this package's scripts only). Stamping declares a script current, so stamp only after regenerating.

What a project learned leaves it through two loops, each run only when its owner decides, once one of its submissions has finished. The owner reviews exactly what leaves, in one review, and nothing is pushed before that approval. On the validator, `leak-reviewer` first checks exactly those files against the hidden tests, in the validator's [`contribution-check`](library/loops/validator/contribution-check.md), which replaces the framework's default. The framework's [`library-contributor`](agent-loop-studio/library/roles/framework/library-contributor.md) role does the steps of both, through `library-cli.js` (`--purpose share` or `--purpose upstream`):

- [`library-contribution`](agent-loop-studio/library/loops/framework/library-contribution.md) sends what the project made, the loops and roles no library gave it, to agent-loop-community, always: one pull request, from a branch named `library/<project>-<side>-<yyyymmdd>`.
- [`upstream-optimization`](agent-loop-studio/library/loops/framework/upstream-optimization.md) sends improvements to loops and roles a library gave the project, above all the role fixes `trajectory-optimizer` made, back where each came from: the framework's base ones to agent-loop-studio, this package's worker and validator ones to this repository, the community's to agent-loop-community. Each library gets one pull request, from a branch named `upstream/<project>-<side>-<yyyymmdd>`.

So what reaches this repository from projects are improvements to its own loops and roles. Maintainers review and merge. Here, CI runs the library check on each, and a merged role reaches every project installed afterwards, so review it as code; an existing project gets a new loop or role when its installer runs again, but keeps its own copy of any it already has. A validator role may describe how tests are constructed, but must never contain an actual test case.

When adding or changing a role, loop, skill or helper, keep the [agent guide](AGENT_GUIDE.md) and the [integration contract](skills/shared-references/integration-contract.md) in sync, and [`project-rules.md`](skills/shared-references/project-rules.md) when the framework's roles need to know about it; add a helper's row to the contract in the same change that makes a role call it. Helpers stay compatible with Node.js 22.12+ and Windows and launch configured commands as argv arrays, never through a shell. Before adding a feature, go through the questions at the end of the [architecture guide](ARCHITECTURE_GUIDE.md).

## Releases

For changes to shipped code, roles, loops, skills or documentation, and after bumping a submodule, rebuild with `npm run pack:contrejour` and refresh the archive and checksum in `distribution/releases/`; the archive carries the framework's runtime and libraries at the pinned versions. A new research helper is added to `ENTRIES` in `tools/build.mjs` and to the entry points in `tools/pack-contrejour.mjs`; a newly shipped skill to `tools/pack-contrejour.mjs`. Follow the [package ownership conventions](docs/packaging.md).

Use commit subjects such as `fix(contrejour): preserve owner MCP entries`. Keep changes focused and describe the user-visible behavior and validation in the pull request.

Contributions use the [MIT license](LICENSE).
