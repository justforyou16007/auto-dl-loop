# Standalone Contrejour

Contrejour installs explicitly into projects and runs on Claude Code. This repository contains no Claude Code implementation. User installation and updates live in the [setup guide](../SETUP_GUIDE.md); the archive includes that guide as its README.

## Build the distributable

The normal installation entrypoint is `bash distribution/install-contrejour.sh --role worker|validator --project PATH` from a local Contrejour Git checkout. `.contrejour/install.json` records the role, and an update with another role is refused; it also records the checkout as the project's `library`, where the project contributes its loops and roles back. Prepare that checkout explicitly with `npm ci` and `npm run build`. The installer invokes `tools/pack-contrejour.mjs --directory <temporary-directory>` to assemble the same runtime dependency closure as the release, then runs its ownership-aware installer. It requires no tar and makes no network requests or Git/npm updates. Missing local runtime files stop installation.

Run `npm ci` in this repository, then `npm run pack:contrejour`. No workspace packages or generated declarations from another repository are required. Node.js 22.12+, Bash and tar are host prerequisites.

The build writes `artifacts/contrejour-0.1.0.tar.gz` and its `.sha256`. The archive contains its Bash installer, the compiled helper dependency closure, the Commander runtime, the library of loops and roles (`library/`), the `research-wiki` and `browser-act` skills, shared references and templates. Target machines need no build tools, source checkout or npm install. Claude Code, browser and experiment host dependencies remain external; see the [setup guide](../SETUP_GUIDE.md).

`tools/pack-contrejour.mjs` traces local JavaScript imports from the setup, validation, worker, wiki, hook, loop-check, library, capture-filter and browser entrypoints. Add new runtime entrypoints and shipped skills there rather than shipping unrelated tools.

The release archive remains available for manual offline distribution and CI; local repository installation does not read or download it. After changing shipped code, roles, loops, skills or documentation, run `npm run pack:contrejour` and copy the archive and checksum into `distribution/releases/` before committing.

## Ownership

The installation manifest records the role and the hashes of managed files. Updates preflight conflicts and replace only owned package files — helpers, runtime, templates and skills — and remove managed files dropped from the package. Loops and roles are seeded instead: the installer writes the framework roles and the side's roles and loops only where the project has none of that name. From then on they belong to the project (`trajectory-optimizer` fixes roles, the owner changes loops through `loop-editor`), and updates never replace or remove them. A copy of each as seeded stays in `.contrejour/seeded/`, the baseline that tells what the project changed when it contributes back, so a contribution holds only that. The installer also registers Contrejour's hooks in `.claude/settings.json` through the installed `setup-cli.js hooks`, replacing only its own registrations, so they guard setup's own loop; setup adds the entry role. Project data, the project environment skill, `.contrejour/environment.json`, the rest of `.claude/settings.json` and unrelated agent configuration survive. A project installed for Codex by an earlier release, or by the releases named ARL (data under `.aris/`), is refused rather than migrated.

`claude agents` shows the background sessions. Read research records through the wiki skill, CLI or Markdown files. See the [architecture guide](../ARCHITECTURE_GUIDE.md) for the worker/validator trust boundary.
