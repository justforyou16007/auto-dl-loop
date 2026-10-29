import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    role: { type: "string" },
    project: { type: "string" },
    provider: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    "bash install.sh --role worker|validator --project PATH [--provider claude|codex] [--dry-run] [--force]",
  );
  process.exit(0);
}
if (!values.project || !["worker", "validator"].includes(values.role)) {
  throw new Error("Specify --role worker|validator and --project PATH. See --help.");
}
if (values.provider !== undefined && !["claude", "codex"].includes(values.provider)) {
  throw new Error("--provider must be claude or codex. See --help.");
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) throw new Error("Node.js 22.12+ required");

const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(values.project);
const role = values.role;
const manifestFile = path.join(root, ".contrejour/install.json");
function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function safeRelative(relative) {
  return (
    typeof relative === "string" &&
    relative !== "" &&
    !relative.includes("\\") &&
    !path.isAbsolute(relative) &&
    relative.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
function destination(relative) {
  if (!safeRelative(relative)) throw new Error(`Unsafe install path: ${relative}`);
  const target = path.join(root, relative);
  let current = target;
  while (true) {
    if (
      fs.existsSync(current) ||
      (() => {
        try {
          return fs.lstatSync(current).isSymbolicLink();
        } catch {
          return false;
        }
      })()
    ) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return target;
}
destination(".contrejour/install.json");
// Releases named ARL kept their data under .aris/; they are not migrated.
if (fs.existsSync(path.join(root, ".aris/install.json"))) {
  throw new Error(
    "This project was installed by an earlier release under .aris/ (ARL), which Contrejour does not migrate; install into a fresh project.",
  );
}
const previous = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
  : null;
if (previous && !["worker", "validator"].includes(previous.role)) {
  throw new Error(
    "This project's installation record names no worker/validator role; install into a fresh project.",
  );
}
if (previous && previous.role !== role) {
  throw new Error(`This project is installed for ${previous.role}; keep its role when updating.`);
}
// Either backend can run either role; without --provider an update keeps the installed one
// and a new install takes the role's default: Claude Code for the worker, Codex for the validator.
const provider = values.provider ?? previous?.provider ?? (role === "worker" ? "claude" : "codex");
if (previous?.provider && previous.provider !== provider) {
  throw new Error(
    `This project is installed for ${previous.provider}; keep its provider when updating, or install into a fresh project.`,
  );
}
const skills = provider === "codex" ? ".agents/skills" : ".claude/skills";
// The archive carries both setup skills; a project gets only its own role's.
const otherSetup = `skills/${role === "worker" ? "validator" : "worker"}-setup/`;
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
if (manifest.format !== 1 || !Array.isArray(manifest.files))
  throw new Error("Invalid Contrejour archive manifest");
const planned = [];
const hashes = {};
for (const entry of manifest.files) {
  if (!safeRelative(entry.path)) throw new Error("Invalid archive path");
  const bytes = fs.readFileSync(path.join(source, entry.path));
  if (digest(bytes) !== entry.sha256)
    throw new Error(`Archive integrity check failed: ${entry.path}`);
  const isSkill = entry.path.startsWith("skills/");
  if (
    (!isSkill &&
      !/^(dist|templates|node_modules)\//.test(entry.path) &&
      entry.path !== "package.json") ||
    entry.path.startsWith(otherSetup)
  )
    continue;
  const relative = isSkill ? `${skills}/${entry.path.slice(7)}` : `.contrejour/${entry.path}`;
  const contents =
    provider === "codex" && entry.path.endsWith(".md")
      ? Buffer.from(bytes.toString("utf8").replaceAll(".claude/skills", ".agents/skills"))
      : bytes;
  const target = destination(relative);
  const nextHash = digest(contents);
  hashes[relative] = nextHash;
  if (fs.existsSync(target)) {
    const currentHash = digest(fs.readFileSync(target));
    if (currentHash === nextHash) continue;
    if (!values.force && currentHash !== previous?.files?.[relative]) {
      throw new Error(
        `Local file differs: ${relative}. Save your edits, then use --force to replace it.`,
      );
    }
  }
  planned.push({ target, contents, relative });
}
const removed = [];
for (const [relative, oldHash] of Object.entries(previous?.files ?? {})) {
  if (Object.hasOwn(hashes, relative)) continue;
  if (
    !relative.startsWith(`${skills}/`) &&
    !/^\.contrejour\/(dist|templates|node_modules)\//.test(relative)
  ) {
    throw new Error(`Invalid managed path: ${relative}`);
  }
  const target = destination(relative);
  if (!fs.existsSync(target)) continue;
  if (!values.force && digest(fs.readFileSync(target)) !== oldHash) {
    throw new Error(
      `Removed upstream but locally edited: ${relative}. Save it before using --force.`,
    );
  }
  removed.push(target);
}
if (!values["dry-run"]) {
  for (const { target, contents } of planned) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.contrejour-${process.pid}`;
    fs.writeFileSync(temp, contents);
    fs.renameSync(temp, target);
  }
  for (const target of removed) fs.unlinkSync(target);
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const temp = `${manifestFile}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify(
      { format: 1, version: manifest.version, role, provider, files: hashes },
      null,
      2,
    ) + "\n",
  );
  fs.renameSync(temp, manifestFile);
}
console.log(
  JSON.stringify(
    {
      project: root,
      role,
      provider,
      version: manifest.version,
      dry_run: values["dry-run"],
      written: planned.map((entry) => entry.relative),
      removed,
    },
    null,
    2,
  ),
);
const thinking = {
  worker: { claude: "ultracode", codex: "ultra" },
  validator: { claude: "max", codex: "max" },
}[role][provider];
const client =
  provider === "claude"
    ? "Run reload-skills after skills change, or open a fresh session."
    : "Codex must trust the project to read its .codex/config.toml; open a fresh session after skills change.";
console.log(
  role === "worker"
    ? `Next: open this project in official Paseo with ${provider === "claude" ? "Claude Code" : "Codex"} at thinking ${thinking} and invoke worker-setup. ${client} A changed MCP configuration needs a fresh session.`
    : `Next: open this project in official Paseo with ${provider === "claude" ? "Claude Code" : "Codex"} at thinking ${thinking} and invoke validator-setup; the service starts validator agents with the same backend. ${client}`,
);
