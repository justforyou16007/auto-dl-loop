# Contributing

Use Node.js 22.12+ and run `npm ci` from the repository root. Contrejour has no npm workspaces and does not contain or build Claude Code.

Run `npm run build`, `npm run typecheck` and `npm run lint` after changes. Run only the relevant test file, for example `npm run test -- tests/test_framework.ts`, and leave the full matrix to CI; build first, because the setup and framework suites use the compiled helpers. The [testing guide](docs/testing.md) describes the evidence bar. Run `npm run format` before committing.

## Where things live

| Path | Contents |
| --- | --- |
| `library/roles/framework/`, `library/roles/worker/`, `library/roles/validator/` | The roles installation seeds into projects |
| `library/loops/<side>/` | The loops: each a definition (`<loop>.md`) and its generated script (`<loop>.js`) |
| `skills/` | Skills; only `research-wiki`, `browser-act` and `shared-references` ship |
| `src/` | The helpers |
| `templates/` | Project scaffolding: the role blocks, the environment placeholder, the task and benchmark templates |
| `tools/`, `distribution/` | Packaging, the library check, the installers and the released archive |

## Roles and loops

A session starts loops and carries the owner's answers into them, a loop schedules roles, and a role does one step: no flow lives outside a loop, a role never runs another role, and a decision of the owner's is an `owner-review` step ([running-loops.md](skills/shared-references/running-loops.md)). How a step is done belongs in its role's file, never in a script or a prompt: every operation belongs to a role, and helpers are tools of roles. What must be guaranteed mechanically (test counts, finalize's checks, the append-only benchmark) stays in a helper. The forms are specified by the roles that write them: a role's by [`role-creator`](library/roles/framework/role-creator.md) (frontmatter `name` matching the file, `description` and `side`, which must match the directory; sections Responsibility, Inputs, Output, Writes and Evaluation), a loop's definition and the script rules by [`loop-editor`](library/roles/framework/loop-editor.md). A script only schedules roles, gives every call a `schema` and a declared `phase`, loops within a fixed bound, and uses neither the clock nor randomness.

Check the library as a project of each side sees it:

```bash
npm run build && node tools/library-check.mjs
```

It lays out the framework roles and each side's roles and loops in a temporary project and runs the loop and role checks; a non-zero exit means a defect, named in its report. After regenerating a script from its changed definition, run it with `--stamp`, which records each definition's digest in its script. Stamping declares a script current, so stamp only after regenerating.

Projects contribute what they added or changed through the [`library-contributor`](library/roles/framework/library-contributor.md) role once one of their submissions has finished, as a pull request from a branch named `library/<project>-<side>-<yyyymmdd>`, and maintainers review and merge it. CI runs the library check on it, and a merged role reaches every project installed afterwards, so review it as code; an existing project gets it when its installer runs again, unless it already has a file of that name. A validator role may describe how tests are constructed, but must never contain an actual test case.

When adding or changing a role, loop, skill or helper, keep the [agent guide](AGENT_GUIDE.md) and the [integration contract](skills/shared-references/integration-contract.md) in sync; add a helper's row to the contract in the same change that makes a role call it. Helpers stay compatible with Node.js 22.12+ and Windows and launch configured commands as argv arrays, never through a shell. Before adding a feature, go through the questions at the end of the [architecture guide](ARCHITECTURE_GUIDE.md).

## Releases

For changes to shipped code, roles, loops, skills or documentation, rebuild with `npm run pack:contrejour` and refresh the archive and checksum in `distribution/releases/`. New runtime entrypoints and shipped skills are added in `tools/pack-contrejour.mjs`. Follow the [package ownership conventions](docs/packaging.md).

Use commit subjects such as `fix(contrejour): preserve owner MCP entries`. Keep changes focused and describe the user-visible behavior and validation in the pull request.

Contributions use the [MIT license](LICENSE).
