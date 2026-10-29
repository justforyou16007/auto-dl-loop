import fs from "node:fs";
import path from "node:path";
import { failA1, isRecord } from "./validate.js";

export type Role = "worker" | "validator";
export type Provider = "claude" | "codex";

export const PROVIDERS: readonly Provider[] = ["claude", "codex"];

/** The backend a role gets when installation names none. */
export const DEFAULT_PROVIDER: Record<Role, Provider> = {
  worker: "claude",
  validator: "codex",
};

/**
 * Paseo thinking per role and backend: the worker runs the level that may
 * delegate to subagents, the validator the deepest single-agent level.
 */
export const ROLE_THINKING: Record<Role, Record<Provider, string>> = {
  worker: { claude: "ultracode", codex: "ultra" },
  validator: { claude: "max", codex: "max" },
};

export interface RoleAgent {
  provider: Provider;
  thinking: string;
}

export function roleAgent(role: Role, provider: Provider): RoleAgent {
  return { provider, thinking: ROLE_THINKING[role][provider] };
}

export function isProvider(value: unknown): value is Provider {
  return value === "claude" || value === "codex";
}

/** The role chosen at installation (`install-contrejour.sh --role`); setup never changes it. */
export function installedRole(root: string): Role {
  const file = path.join(root, ".contrejour", "install.json");
  if (!fs.existsSync(file))
    failA1("INVALID_VALUE", "install Contrejour with --role worker|validator first", file);
  const installed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(installed) || (installed.role !== "worker" && installed.role !== "validator"))
    failA1("INVALID_VALUE", "reinstall Contrejour with --role worker|validator", file);
  return installed.role;
}

/** The backend chosen at installation (`--provider`); installs that recorded none use the role's default. */
export function installedProvider(root: string): Provider {
  const role = installedRole(root);
  const file = path.join(root, ".contrejour", "install.json");
  const installed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const provider = isRecord(installed) ? installed.provider : undefined;
  if (provider === undefined) return DEFAULT_PROVIDER[role];
  if (!isProvider(provider))
    failA1("INVALID_VALUE", "reinstall Contrejour with --provider claude|codex", file);
  return provider;
}

export function installedAgent(root: string): RoleAgent {
  return roleAgent(installedRole(root), installedProvider(root));
}

/** Where each backend reads project skills, relative to the project root. */
export const PROVIDER_SKILLS: Record<Provider, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills",
};

/** The source checkout has no installation; its skills are found under `.claude/skills`. */
export function providerSkillsDir(root: string): string {
  const installed = fs.existsSync(path.join(root, ".contrejour", "install.json"));
  const provider = installed ? installedProvider(root) : "claude";
  return path.join(root, ...PROVIDER_SKILLS[provider].split("/"));
}
