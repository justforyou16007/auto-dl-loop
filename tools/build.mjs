#!/usr/bin/env node
/**
 * Build this package. The framework (agent-loop-studio, a submodule) builds its
 * own helpers and the Studio's page; its dist/ becomes this package's runtime,
 * and this package's own helpers are bundled next to them, one file each. What
 * they use of the framework they import from the framework's own compiled files
 * beside them, so there is one copy of it, and the installed layout stays
 * .contrejour/dist/tools/<helper>.js: every role's command is unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const studio = path.join(root, "agent-loop-studio");
const dist = path.join(root, "dist");
if (!fs.existsSync(path.join(studio, "dist", "tools", "hook.js")))
  throw new Error(
    "Build the framework first: git submodule update --init, then npm --prefix agent-loop-studio ci && npm --prefix agent-loop-studio run build.",
  );
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(studio, "dist"), dist, { recursive: true });

// The research task's helpers: the ones its roles run, and the extension the framework loads by name.
export const ENTRIES = [
  "config-cli",
  "validation-cli",
  "worker-cli",
  "research-wiki",
  "capture-filter",
  "ensure-browser-act",
  "research-extension",
];
/** `@studio/tools/x.js` is the framework's dist/tools/x.js, beside the bundle; `@studio/lib/x.js` its dist/lib/x.js. */
const framework = {
  name: "framework",
  setup(builder) {
    builder.onResolve({ filter: /^@studio\// }, (args) => {
      const sub = args.path.slice("@studio/".length);
      return { path: sub.startsWith("tools/") ? `./${sub.slice("tools/".length)}` : `../${sub}`, external: true };
    });
  },
};
await build({
  plugins: [framework],
  absWorkingDir: root,
  entryPoints: ENTRIES.map((entry) => path.join("src", "tools", `${entry}.ts`)),
  outdir: path.join(dist, "tools"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: path.join(root, "tsconfig.json"),
  // The one runtime dependency comes with the installed helpers, next to dist/.
  external: ["commander"],
  logLevel: "warning",
});
console.log(`built ${ENTRIES.length} research helpers next to the framework's in ${path.relative(root, dist)}/`);
