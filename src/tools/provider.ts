import fs from "node:fs";
import path from "node:path";
import { failA1, isRecord } from "./validate.js";

export type ArlRole = "worker" | "validator";
export type ArlProvider = "claude" | "codex";

/** The role fixes the agent: the worker runs Claude Code at ultracode, the validator runs Codex at max. */
export const ROLE_AGENT = {
  worker: { provider: "claude", thinking: "ultracode" },
  validator: { provider: "codex", thinking: "max" },
} as const satisfies Record<ArlRole, { provider: ArlProvider; thinking: string }>;

/** The role chosen at installation (`install-aris.sh --role`); setup never changes it. */
export function installedRole(root: string): ArlRole {
  const file = path.join(root, ".aris", "install.json");
  if (!fs.existsSync(file))
    failA1("INVALID_VALUE", "install ARL with --role worker|validator first", file);
  const installed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(installed) || (installed.role !== "worker" && installed.role !== "validator"))
    failA1("INVALID_VALUE", "reinstall ARL with --role worker|validator", file);
  return installed.role;
}

export function installedProvider(root: string): ArlProvider {
  return ROLE_AGENT[installedRole(root)].provider;
}

/** The source checkout has no installation; its skills are found under `.claude/skills`. */
export function providerSkillsDir(root: string): string {
  const installed = fs.existsSync(path.join(root, ".aris", "install.json"));
  const provider = installed ? installedProvider(root) : "claude";
  return path.join(root, provider === "codex" ? ".agents" : ".claude", "skills");
}
