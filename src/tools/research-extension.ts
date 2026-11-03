/**
 * The research task's extension of the framework (named in project.json): where
 * the project decides what the framework cannot know. A validator review
 * session that stops early is reported to the service; the validator's frozen
 * benchmark, hidden data and helper-written records are guarded; a trajectory
 * is tagged with the submission its session reviews; a task has finished when a
 * submission's result is published; the validation token and the hidden data
 * never leave in a contribution, which on the validator needs the leak
 * reviewer's pass first.
 */
import fs from "node:fs";
import path from "node:path";
import { contributionsDir } from "@studio/tools/installation.js";
import type { ProjectExtension } from "@studio/tools/project-manifest.js";
import { selectedLoopPath } from "@studio/tools/loops.js";
import { isRecord } from "@studio/tools/validate.js";
import { readValidationConfig, validationDir, validationTokenPath } from "./validation/config.js";
import {
  FINISHED,
  listSubmissions,
  stopMarkerFile,
  submissionsDir,
  type SubmissionStatus,
} from "./validation/store.js";

/** The submission a validator review session works on, if any. */
function submissionOf(root: string, sessionId: unknown): string | null {
  if (typeof sessionId !== "string" || !fs.existsSync(submissionsDir(root))) return null;
  return (
    listSubmissions(root).find((record) => record.session?.session_id === sessionId)
      ?.submission_id ?? null
  );
}
const workflowsRunning = (input: Record<string, unknown>): boolean =>
  (Array.isArray(input.background_tasks) ? input.background_tasks : []).some(
    (task) => isRecord(task) && task.type === "workflow" && task.status === "running",
  );

/**
 * A validator review session stopped. If its submission is still in review and
 * no loop is running for it, tell the service, which continues the session.
 */
export function notifyStoppedReview(root: string, input: Record<string, unknown>): void {
  if (workflowsRunning(input)) return;
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
    // Before the machine is configured there is nothing frozen to protect.
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
  if (inside(contributionsDir(root)))
    return "Contrejour: what leaves for the shared library, and its check, are written only by `library-cli.js`.";
  if (resolved === selectedLoopPath(root))
    return "Contrejour: the loop a review runs and its parameters are chosen only by the owner, in the Studio or with `project-cli.js use`.";
  if (HELPER_FILES.test(resolved))
    return "Contrejour: submission records, published results and leak-review snapshots are written only by validation-cli.js.";
  return null;
}

/** The tasks that finished: a review ended and its result was published. */
function finishedTasks(root: string, profile: string): string[] {
  const finished = (status: unknown) => FINISHED.includes(status as SubmissionStatus);
  if (profile === "validator")
    return listSubmissions(root)
      .filter((record) => finished(record.status))
      .map((record) => record.submission_id);
  const results = path.join(root, ".contrejour", "results");
  if (!fs.existsSync(results)) return [];
  return fs
    .readdirSync(results)
    .filter((file) => file.endsWith(".json"))
    .filter((file) => {
      try {
        const result: unknown = JSON.parse(fs.readFileSync(path.join(results, file), "utf8"));
        return isRecord(result) && finished(result.status);
      } catch {
        return false;
      }
    })
    .map((file) => file.slice(0, -5))
    .sort();
}

export const extension: ProjectExtension = {
  hookActions: {
    "notify-stopped-review": (root, _event, input) => notifyStoppedReview(root, input),
    "guard-protected-paths": (root, _event, input) =>
      input.tool_name === "Workflow" ? null : guardReason(root, input),
  },
  taskOf: (root, sessionId) => submissionOf(root, sessionId),
  finishedTasks,
  secrets(root) {
    const secrets: { label: string; value: string }[] = [];
    const token = validationTokenPath(root);
    if (fs.existsSync(token))
      secrets.push({
        label: "the validation service token",
        value: fs.readFileSync(token, "utf8").trim(),
      });
    if (process.env.CONTREJOUR_TOKEN)
      secrets.push({ label: "CONTREJOUR_TOKEN", value: process.env.CONTREJOUR_TOKEN });
    return secrets;
  },
  hiddenPaths(root, profile) {
    if (profile !== "validator") return [];
    try {
      return readValidationConfig(root).hidden_paths;
    } catch {
      return [];
    }
  },
  // A validator's roles may describe how tests are built, never hold one: the leak reviewer checks first.
  needsContributionCheck: (_root, profile) => profile === "validator",
};
