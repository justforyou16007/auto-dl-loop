# Coding standards

Validate file, network and command inputs at their boundaries. Preserve the parsed types inside the implementation; do not add `any`, ignored type errors or duplicate schemas.

Keep helpers portable to Node.js 22.12+ and Windows. Launch configured executables with argv arrays. Bash installer scripts use `#!/usr/bin/env bash`; generated experiment scripts follow their skill contract.

Build on the framework rather than copying it: research sources import its modules as `@studio/tools/…` and `@studio/lib/…`. A change the framework needs is made in agent-loop-studio, then the submodule is bumped here. The framework never names this project, so what the research task decides reaches it only through `project.json`, the extension (`src/tools/research-extension.ts`) and `skills/shared-references/project-rules.md`.

Give each persistent fact one writer. Preserve user instructions and unrelated provider configuration when updating owned blocks. Treat hidden benchmark data and submitted artifacts as separate trust boundaries.

Use npm scripts for lint and formatting. Run `npm run typecheck` and `npm run lint` after changes, and `npm run format` before committing. Testing conventions are in [testing.md](testing.md).

Put code-level constraints next to the code. Integrate documentation changes into the document that owns the subject; do not append discovery notes or repeat the same fact across guides.
