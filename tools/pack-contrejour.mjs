import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directoryOnly = process.argv[2] === "--directory";
const output = path.resolve(process.argv[directoryOnly ? 3 : 2] ?? path.join(root, "artifacts"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-package-"));
const stage = path.join(temp, "contrejour");
const skills = ["research-wiki", "browser-act", "shared-references"];
const entries = ["tools/config-cli", "tools/validation-cli", "tools/research-wiki", "tools/capture-filter", "tools/ensure-browser-act", "tools/hook", "tools/loop-check", "tools/worker-cli", "tools/library-cli", "tools/loop-view", "tools/studio", "tools/project-cli", "tools/research-extension"];
const visited = new Set();

const keep = (file) => !file.split(path.sep).some((part) => ["__pycache__", "node_modules", ".git", ".gitkeep"].includes(part));
function copy(relative) {
  copyFrom(root, relative, relative);
}
/** Copy from another checkout (the framework's, the community library's), merging into what is staged. */
function copyFrom(base, relative, target) {
  const destination = path.join(stage, target);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(path.join(base, relative), destination, { recursive: true, dereference: true, filter: keep });
}
const studio = path.join(root, "agent-loop-studio");
const community = path.join(root, "agent-loop-community");
for (const checkout of [studio, community])
  if (!fs.existsSync(path.join(checkout, "library")))
    throw new Error(`${checkout} is missing: run git submodule update --init`);
function runtime(relative) {
  if (visited.has(relative)) return;
  if (!relative.startsWith("dist/")) throw new Error(`Runtime escaped dist: ${relative}`);
  visited.add(relative);
  copy(relative);
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
    if (imported.fileName.startsWith(".")) runtime(path.posix.normalize(path.posix.join(path.posix.dirname(relative), imported.fileName)));
  }
}
try {
  for (const entry of entries) runtime(`dist/${entry}.js`);
  // The Studio's page: static files its server sends, built by Vite, not traced through imports.
  copy("dist/studio");
  // The framework's shared references (running loops), then this package's skills and references.
  copyFrom(studio, "skills/shared-references", "skills/shared-references");
  for (const skill of skills) copy(`skills/${skill}`);
  // The library: the framework's base loops and roles, the community's shared ones, then this package's sides.
  copyFrom(studio, "library", "library");
  copyFrom(community, "library", "library");
  copy("library");
  copy("templates");
  // What the package tells the installer and the framework about itself: its profiles and extension.
  copy("project.json");
  copy("LICENSE");
  copy("SETUP_GUIDE_CN.md");
  copy("SETUP_GUIDE.md");
  fs.copyFileSync(path.join(root, "SETUP_GUIDE.md"), path.join(stage, "README.md"));
  // The framework's installer installs this package.
  for (const name of ["install.sh", "install.mjs"]) fs.copyFileSync(path.join(studio, "distribution", name), path.join(stage, name));
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: "contrejour", version, private: true, type: "module", repository: pkg.repository, engines: { node: ">=22.12.0" } }, null, 2) + "\n");
  const require = createRequire(path.join(root, "package.json"));
  const commander = path.dirname(require.resolve("commander"));
  fs.cpSync(commander, path.join(stage, "node_modules/commander"), { recursive: true, dereference: true });
  const files = [];
  function inventory(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) inventory(path.join(dir, entry.name), `${relative}/`);
      else files.push({ path: relative, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, entry.name))).digest("hex") });
    }
  }
  inventory(stage);
  fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify({ format: 1, version, files }, null, 2) + "\n");
  fs.mkdirSync(output, { recursive: true });
  if (directoryOnly) {
    const bundle = path.join(output, "contrejour");
    if (fs.existsSync(bundle)) throw new Error(`Bundle directory already exists: ${bundle}`);
    fs.cpSync(stage, bundle, { recursive: true });
    console.log(bundle);
  } else {
    const archive = path.join(output, `contrejour-${version}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", temp, "contrejour"]);
    const sum = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    fs.writeFileSync(`${archive}.sha256`, `${sum}  ${path.basename(archive)}\n`);
    console.log(archive);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
