#!/usr/bin/env node
/**
 * The hook helper Claude Code runs on the events setup registered: one event
 * name as the argument, the event's JSON on stdin. It only records, notifies or
 * blocks; judgment stays with roles. Which actions run is declared by the loop
 * definitions (`triggers` in `.claude/loops/*.md`). It never breaks a session:
 * anything unexpected is logged to `.contrejour/hook-errors.log` and the event
 * passes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRIGGERS, declaredTriggers } from "./loops.js";
import { isRecord } from "./validate.js";
import { readValidationConfig, validationDir } from "./validation/config.js";
import { listSubmissions, stopMarkerFile, submissionsDir } from "./validation/store.js";

/** The project this helper is installed in: `<root>/.contrejour/dist/tools/hook.js`. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const trajectoriesDir = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "trajectories");
const safe = (value: unknown): string =>
  String(value ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "_");

/** The submission a validator review session works on, if any. */
function submissionOf(root: string, sessionId: unknown): string | null {
  if (typeof sessionId !== "string" || !fs.existsSync(submissionsDir(root))) return null;
  return (
    listSubmissions(root).find((record) => record.session?.session_id === sessionId)
      ?.submission_id ?? null
  );
}
function runningWorkflows(input: Record<string, unknown>): { id: string; name: string }[] {
  const tasks = Array.isArray(input.background_tasks) ? input.background_tasks : [];
  return tasks
    .filter((task) => isRecord(task) && task.type === "workflow" && task.status === "running")
    .map((task) => ({
      id: String((task as Record<string, unknown>).id),
      name: String((task as Record<string, unknown>).name),
    }));
}

/**
 * A role finished, or the session stopped: keep the transcript in the project,
 * because Claude Code's own copy lives under the user's home, is cleaned up
 * after a while and changes format between versions, and index which session,
 * loop and submission it belonged to. A role has its own transcript; the
 * session's is the entry role's, copied again each time the session stops.
 */
export function recordTrajectory(root: string, input: Record<string, unknown>): void {
  const dir = path.join(trajectoriesDir(root), safe(input.session_id));
  fs.mkdirSync(dir, { recursive: true });
  const isRole = input.agent_id !== undefined;
  const transcript = isRole ? input.agent_transcript_path : input.transcript_path;
  const source = typeof transcript === "string" ? transcript : null;
  const id = isRole ? safe(input.agent_id) : "session";
  const file = path.join(dir, `${safe(input.agent_type)}-${id}.jsonl`);
  if (source && fs.existsSync(source)) fs.copyFileSync(source, file);
  const entry = {
    at: new Date().toISOString(),
    session_id: input.session_id ?? null,
    agent_type: input.agent_type ?? null,
    agent_id: isRole ? input.agent_id : "session",
    workflows: runningWorkflows(input),
    submission: submissionOf(root, input.session_id),
    transcript: source && fs.existsSync(file) ? path.relative(root, file) : null,
  };
  fs.appendFileSync(path.join(trajectoriesDir(root), "index.jsonl"), `${JSON.stringify(entry)}\n`);
}

/**
 * A validator review session stopped. If its submission is still in review and
 * no loop is running for it, tell the service, which continues the session.
 */
export function notifyStoppedReview(root: string, input: Record<string, unknown>): void {
  if (runningWorkflows(input).length) return;
  const id = submissionOf(root, input.session_id);
  if (!id) return;
  const record = listSubmissions(root).find((entry) => entry.submission_id === id);
  if (record?.status !== "reviewing") return;
  fs.writeFileSync(
    stopMarkerFile(root, id),
    `${JSON.stringify({ at: new Date().toISOString(), session_id: input.session_id })}\n`,
  );
}

/** Files only the validation helper writes, and the hidden data no role may change. */
function protectedPaths(root: string): string[] {
  const validation = validationDir(root);
  const paths = [
    path.join(validation, "benchmark"),
    path.join(validation, "benchmark-head"),
    path.join(validation, "config.json"),
    path.join(validation, "token"),
    path.join(root, ".contrejour", "tester-config.json"),
  ];
  try {
    paths.push(...readValidationConfig(root).hidden_paths);
  } catch {
    // Before setup there is nothing frozen to protect.
  }
  return paths.map((entry) => path.resolve(entry));
}
const HELPER_FILES =
  /[\\/]submissions[\\/]s\d{3,}[\\/](status\.json|published\.json|leak-review[\\/]\d+[\\/]feedback\.md)$/;

/** Why a validator role may not write this file, or null when it may. */
export function guardReason(root: string, input: Record<string, unknown>): string | null {
  if (!fs.existsSync(validationDir(root))) return null;
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  const target = toolInput.file_path ?? toolInput.notebook_path;
  if (typeof target !== "string" || !target) return null;
  const cwd = typeof input.cwd === "string" ? input.cwd : root;
  const resolved = path.resolve(cwd, target);
  const inside = (parent: string) =>
    resolved === parent ||
    resolved.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
  if (protectedPaths(root).some(inside))
    return "Contrejour: the benchmark, its frozen configuration and the hidden data never change; register tests with `validation-cli.js extend` instead.";
  if (HELPER_FILES.test(resolved))
    return "Contrejour: submission records, published results and leak-review snapshots are written only by validation-cli.js.";
  return null;
}

function handle(event: string, input: Record<string, unknown>): string | null {
  const actions = declaredTriggers(ROOT);
  const on = (action: string) => actions.has(action) && (TRIGGERS[action] ?? []).includes(event);
  if (on("record-trajectory")) recordTrajectory(ROOT, input);
  if (on("notify-stopped-review")) notifyStoppedReview(ROOT, input);
  if (on("guard-protected-paths")) {
    const reason = guardReason(ROOT, input);
    if (reason)
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      });
  }
  return null;
}

function main(): void {
  const event = process.argv[2] ?? "";
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => (text += chunk));
  process.stdin.on("end", () => {
    try {
      const input: unknown = text.trim() ? JSON.parse(text) : {};
      const output = handle(event, isRecord(input) ? input : {});
      if (output) process.stdout.write(`${output}\n`);
    } catch (error) {
      try {
        fs.appendFileSync(
          path.join(ROOT, ".contrejour", "hook-errors.log"),
          `${new Date().toISOString()} ${event}: ${String(error)}\n`,
        );
      } catch {
        // Nowhere to log; let the event pass.
      }
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
