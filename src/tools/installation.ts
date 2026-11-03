/**
 * What the installer fixed for this project: which side of a Contrejour task it
 * is. Every project runs on Claude Code, so skills, roles, loop definitions and
 * loop scripts live in the project's `.claude/` directory.
 */
import fs from "node:fs";
import path from "node:path";
import { failA1, isRecord } from "./validate.js";

export type Role = "worker" | "validator";

/** Where Claude Code reads project skills and roles, and where loops live, relative to the project root. */
export const SKILLS_DIR = ".claude/skills";
export const ROLES_DIR = ".claude/agents";
export const LOOPS_DIR = ".claude/loops";
export const WORKFLOWS_DIR = ".claude/workflows";

/** The entry role of each side: a session opened in the project runs as it. */
export const TASK_MANAGER: Record<Role, string> = {
  worker: "worker-task-manager",
  validator: "validator-task-manager",
};
/** The role that configures each side with the owner. */
export const SETUP_ROLE: Record<Role, string> = {
  worker: "worker-setup",
  validator: "validator-setup",
};

export const installationFile = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "install.json");
/** What library-cli.js keeps about this project's contributions to the shared library. */
export const contributionsDir = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "contributions");

function installation(root: string): Record<string, unknown> {
  const file = installationFile(root);
  if (!fs.existsSync(file))
    failA1("INVALID_VALUE", "install Contrejour with --role worker|validator first", file);
  const installed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(installed)) failA1("INVALID_VALUE", "reinstall Contrejour", file);
  // Earlier releases could run on Codex; Contrejour no longer does and does not migrate.
  if (installed.provider !== undefined && installed.provider !== "claude")
    failA1(
      "INVALID_VALUE",
      "this project was installed for Codex, which Contrejour no longer supports; install into a fresh project",
      file,
    );
  return installed;
}

/** The side chosen at installation (`install-contrejour.sh --role`); setup never changes it. */
export function installedRole(root: string): Role {
  const role = installation(root).role;
  if (role !== "worker" && role !== "validator")
    failA1(
      "INVALID_VALUE",
      "reinstall Contrejour with --role worker|validator",
      installationFile(root),
    );
  return role;
}

/** The local Contrejour checkout the project was installed from: the shared library of loops and roles. */
export function installedLibrary(root: string): string | null {
  const library = installation(root).library;
  return typeof library === "string" && library ? library : null;
}

export function skillsDir(root: string): string {
  return path.join(path.resolve(root), ...SKILLS_DIR.split("/"));
}
