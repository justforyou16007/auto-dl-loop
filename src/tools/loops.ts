/**
 * Loops on disk: a definition in `.claude/loops/<name>.md`, the only authority,
 * and the workflow script generated from it in `.claude/workflows/<name>.js`.
 * The script ends with the digest of the definition it was generated from, so a
 * changed definition shows the script is stale.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LOOPS_DIR, ROLES_DIR, WORKFLOWS_DIR } from "./installation.js";

/**
 * Actions a loop definition may declare under `triggers`, and the events each
 * runs on: a role's trajectory is kept when it finishes, and the session's own
 * (the entry role's) each time the session stops.
 */
export const TRIGGERS: Readonly<Record<string, readonly string[]>> = {
  "record-trajectory": ["SubagentStop", "Stop"],
  "notify-stopped-review": ["Stop"],
  "guard-protected-paths": ["PreToolUse"],
};

export const DIGEST_LINE = /^\/\/ contrejour-loop-definition-sha256: ([0-9a-f]{64})[ \t]*$/m;

const dir = (root: string, relative: string): string =>
  path.join(path.resolve(root), ...relative.split("/"));
export const loopDefinitionPath = (root: string, name: string): string =>
  path.join(dir(root, LOOPS_DIR), `${name}.md`);
export const loopScriptPath = (root: string, name: string): string =>
  path.join(dir(root, WORKFLOWS_DIR), `${name}.js`);
export const rolesDir = (root: string): string => dir(root, ROLES_DIR);

/** Names of the loops defined in this project. */
export function listLoops(root: string): string[] {
  const loops = dir(root, LOOPS_DIR);
  if (!fs.existsSync(loops)) return [];
  return fs
    .readdirSync(loops)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3))
    .sort();
}

/** The `key: value` lines of a leading `---` block. */
export function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (field) fields[field[1]!] = field[2]!.trim();
  }
  return fields;
}

/** `triggers: a, b` or `triggers: [a, b]`, as a list of action names. */
export function parseTriggers(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Every action the project's loop definitions declare. */
export function declaredTriggers(root: string): Set<string> {
  const actions = new Set<string>();
  for (const name of listLoops(root))
    for (const action of parseTriggers(
      frontmatter(fs.readFileSync(loopDefinitionPath(root, name), "utf8")).triggers,
    ))
      actions.add(action);
  return actions;
}

export const definitionDigest = (bytes: Buffer | string): string =>
  crypto.createHash("sha256").update(bytes).digest("hex");

/** The definition digest a script records, or null when it records none. */
export function recordedDigest(script: string): string | null {
  return DIGEST_LINE.exec(script)?.[1] ?? null;
}

/** The names roles declare in `.claude/agents/*.md`, by file. */
export function roleNames(root: string): Map<string, string> {
  const roles = rolesDir(root);
  const names = new Map<string, string>();
  if (!fs.existsSync(roles)) return names;
  for (const file of fs.readdirSync(roles).filter((entry) => entry.endsWith(".md"))) {
    const name = frontmatter(fs.readFileSync(path.join(roles, file), "utf8")).name;
    if (name) names.set(file, name);
  }
  return names;
}
