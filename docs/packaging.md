# Standalone Contrejour

Contrejour installs explicitly into projects and uses official Paseo as an external agent runtime. This repository contains no Paseo implementation. User installation and updates live in the [setup guide](../SETUP_GUIDE.md); the archive includes that guide as its README.

## Build the distributable

The normal installation entrypoint is `bash distribution/install-contrejour.sh --role worker|validator --project PATH` from a local Contrejour Git checkout. `--provider claude|codex` chooses the backend for either role, Claude Code (`.claude/skills/`, `CLAUDE.md`) or Codex (`.agents/skills/`, `AGENTS.md`); without it the worker gets Claude Code and the validator Codex. `.contrejour/install.json` records role and provider, and an update with a different provider is refused. Prepare that checkout explicitly with `npm ci` and `npm run build`. The installer invokes `tools/pack-contrejour.mjs --directory <temporary-directory>` to assemble the same runtime dependency closure as the release, then runs its ownership-aware installer. It requires no tar and makes no network requests or Git/npm updates. Missing local runtime files stop installation.

Run `npm ci` in this repository, then `npm run pack:contrejour`. No workspace packages or generated declarations from another repository are required. Node.js 22.12+, Bash and tar are host prerequisites.

The build writes `artifacts/contrejour-0.1.0.tar.gz` and its `.sha256`. The archive contains its Bash installer, compiled helper dependency closure, Commander runtime, the core skills (`worker-setup` and `validator-setup`, of which the installer gives each project only its role's, plus `validation-review`, `research-wiki` and `browser-act`), shared references and templates. Target machines need no build tools, source checkout or npm install. Browser and experiment host dependencies remain external; see the [setup guide](../SETUP_GUIDE.md).

`tools/pack-contrejour.mjs` traces local JavaScript imports from the setup, validation, wiki, capture-filter and browser entrypoints. Add new runtime entrypoints and shipped skills there rather than shipping unrelated tools.

The release archive remains available for manual offline distribution and CI; local repository installation does not read or download it. After changing shipped code, skills or documentation, run `npm run pack:contrejour` and copy the archive and checksum into `distribution/releases/` before committing.

## Ownership

The installation manifest records the role, its provider and managed file hashes. Updates preflight conflicts and replace only owned package files; managed files dropped from the package are removed. Project data, the project environment skill, `.contrejour/environment.json` and unrelated agent configuration survive. An update must keep the installed role, so setup and the environment skill keep the same discovery paths; a manifest without a role is refused. A project installed by the earlier releases named ARL, which kept their data under `.aris/`, is refused rather than installed alongside it; Contrejour does not migrate it.

Official Paseo displays agents and service scripts. Read research records through the wiki skill, CLI or Markdown files. See the [architecture guide](../ARCHITECTURE_GUIDE.md) for the worker/validator trust boundary.
