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
    library: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log("bash install.sh --role worker|validator --project PATH [--dry-run] [--force]");
  process.exit(0);
}
if (!values.project || !["worker", "validator"].includes(values.role)) {
  throw new Error("Specify --role worker|validator and --project PATH. See --help.");
}
if (values.provider !== undefined) {
  throw new Error("Contrejour runs on Claude Code only; --provider was removed. See --help.");
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
// Earlier releases could install Codex projects; Contrejour runs on Claude Code only and does not migrate them.
if (previous?.provider !== undefined && previous.provider !== "claude") {
  throw new Error(
    `This project was installed for ${previous.provider}, which Contrejour no longer supports; install into a fresh project.`,
  );
}
const skills = ".claude/skills";
/**
 * Loops and roles from the library are seeded: written when the project has
 * none of that name, then owned by the project (the optimizer fixes roles, the
 * owner changes loops) and never replaced or removed by an update. A project
 * gets the framework roles and its own side's roles and loops.
 */
function seededTarget(relative) {
  const role_ = /^library\/roles\/(framework|worker|validator)\/([^/]+\.md)$/.exec(relative);
  if (role_)
    return role_[1] === "framework" || role_[1] === role ? `.claude/agents/${role_[2]}` : null;
  const loop = /^library\/loops\/(framework|worker|validator)\/([^/]+)\.(md|js)$/.exec(relative);
  if (loop && (loop[1] === "framework" || loop[1] === role))
    return `.claude/${loop[3] === "md" ? "loops" : "workflows"}/${loop[2]}.${loop[3]}`;
  return null;
}
const seeded = [];
const kept = [];
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
  if (entry.path.startsWith("library/")) {
    const relative = seededTarget(entry.path);
    if (!relative) continue;
    const target = destination(relative);
    if (fs.existsSync(target)) kept.push(relative);
    else {
      seeded.push(relative);
      planned.push({ target, contents: bytes, relative });
    }
    continue;
  }
  const isSkill = entry.path.startsWith("skills/");
  if (
    !isSkill &&
    !/^(dist|templates|node_modules)\//.test(entry.path) &&
    entry.path !== "package.json"
  )
    continue;
  const relative = isSkill ? `${skills}/${entry.path.slice(7)}` : `.contrejour/${entry.path}`;
  const contents = bytes;
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
      {
        format: 1,
        version: manifest.version,
        role,
        provider: "claude",
        ...(values.library
          ? { library: path.resolve(values.library) }
          : previous?.library
            ? { library: previous.library }
            : {}),
        files: hashes,
        seeded: [...new Set([...(previous?.seeded ?? []), ...seeded])].sort(),
      },
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
      version: manifest.version,
      dry_run: values["dry-run"],
      written: planned.map((entry) => entry.relative),
      seeded,
      kept_project_versions: kept,
      removed,
    },
    null,
    2,
  ),
);
console.log(
  `Next: in ${root}, run \`claude --agent ${role}-setup\` and accept the folder trust prompt the first time; ${
    role === "worker"
      ? "set up the validator machine first."
      : "background review sessions need the trusted folder."
  } Loops and roles already in the project were kept as they are.`,
);
