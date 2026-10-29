# Contributing

Use Node.js 22.12+ and run `npm ci` from this repository root. Contrejour has no npm workspaces or Paseo build dependencies.

Run `npm run build`, `npm run typecheck` and `npm run lint` after code changes. Run the relevant existing test file with `npm run test -- tests/test_setup.ts`; the [testing guide](docs/testing.md) describes the evidence bar. Run `npm run format` before committing.

Skills live in `skills/`, runtime helpers in `src/`, and project scaffolding in `templates/`. Keep the [agent guide](AGENT_GUIDE.md) and [integration contract](skills/shared-references/integration-contract.md) current when adding a skill or helper.

For changes to shipped code, skills or documentation, rebuild with `npm run pack:contrejour` and refresh the archive and checksum in `distribution/releases/`. Follow [package ownership conventions](docs/packaging.md).

Use commit subjects such as `fix(contrejour): preserve owner MCP entries`. Keep changes focused and describe the user-visible behavior and validation in the pull request.

Contributions use the [MIT license](LICENSE).
