#!/usr/bin/env node
/**
 * Check the library's loops and roles as a project of each side sees them: lay
 * out the framework roles and the side's roles and loops as `.claude/` in a
 * temporary project and run the compiled loop-check (`npm run build` first).
 * With --stamp, first record in each library script the digest of its
 * definition, which a maintainer does after regenerating a script.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const library = path.join(root, "library");
const checker = path.join(root, "dist", "tools", "loop-check.js");
const stamp = process.argv.includes("--stamp");
const DIGEST = /^\/\/ contrejour-loop-definition-sha256: [0-9a-f]{64}[ \t]*$/gm;

const files = (dir, extension) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith(extension)).sort() : [];

if (stamp)
  for (const side of ["framework", "worker", "validator"]) {
    const dir = path.join(library, "loops", side);
    for (const definition of files(dir, ".md")) {
      const script = path.join(dir, definition.replace(/\.md$/, ".js"));
      if (!fs.existsSync(script)) continue;
      const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, definition))).digest("hex");
      const text = fs.readFileSync(script, "utf8").replace(DIGEST, "").trimEnd();
      fs.writeFileSync(script, `${text}\n\n// contrejour-loop-definition-sha256: ${digest}\n`);
    }
  }

if (!fs.existsSync(checker)) throw new Error("Run npm run build first: dist/tools/loop-check.js is missing.");
const reports = {};
let ok = true;
for (const side of ["worker", "validator"]) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `contrejour-library-${side}-`));
  try {
    for (const [from, to, extension] of [
      ["roles/framework", "agents", ".md"],
      [`roles/${side}`, "agents", ".md"],
      ["loops/framework", "loops", ".md"],
      [`loops/${side}`, "loops", ".md"],
      ["loops/framework", "workflows", ".js"],
      [`loops/${side}`, "workflows", ".js"],
    ]) {
      const source = path.join(library, from);
      fs.mkdirSync(path.join(project, ".claude", to), { recursive: true });
      for (const file of files(source, extension))
        fs.copyFileSync(path.join(source, file), path.join(project, ".claude", to, file));
    }
    reports[side] = {};
    for (const command of ["check", "roles"]) {
      const run = spawnSync(process.execPath, [checker, command, "--project", project], { encoding: "utf8" });
      if (run.status !== 0) ok = false;
      reports[side][command] = run.stdout ? JSON.parse(run.stdout) : run.stderr;
    }
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(reports, null, 2));
process.exitCode = ok ? 0 : 1;
