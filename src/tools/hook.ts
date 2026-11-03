#!/usr/bin/env node
/**
 * The hook helper Claude Code runs on the events setup registered: one event
 * name as the argument, the event's JSON on stdin. It only records, notifies or
 * blocks; judgment stays with roles. Which actions run is declared by the loop
 * definitions (`triggers` in `.claude/loops/*.md`). It never breaks a session:
 * anything unexpected is logged to `.contrejour/hook-errors.log` and the event
 * passes.
 *
 * A role inside a loop cannot talk to the owner, so a session carries the owner's
 * replies into a loop as `args.answers`. `guard-owner-answers` makes sure each is
 * the owner's own: a message the owner typed in this session after the loop
 * stopped at that review, word for word. It blocks the run otherwise, and records
 * the answers it verified for the loop's `owner-review` step to check.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contributionsDir } from "./installation.js";
import { TRIGGERS, declaredTriggers, selectedLoopPath } from "./loops.js";
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

/** Where the hook keeps the owner's answers it verified, one file per review. */
export const answersDir = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "reviews", "answers");
export const answerFile = (root: string, reviewId: string): string =>
  path.join(answersDir(root), `${reviewId.replace(/[^A-Za-z0-9._-]/g, "-")}.json`);

export interface SessionLog {
  /** What the owner typed, with its place in the transcript. */
  owner: { index: number; text: string }[];
  /** Where a loop first stopped for the owner at each review id. */
  stops: Map<string, number>;
}
/** The owner's messages and the loops' stops for the owner, in a session transcript. */
export function readSessionLog(transcript: string): SessionLog {
  const log: SessionLog = { owner: [], stops: new Map() };
  transcript.split("\n").forEach((line, index) => {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(entry) || entry.type !== "user" || entry.isMeta) return;
    const message = isRecord(entry.message) ? entry.message : {};
    const content = message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content) &&
            content.length &&
            content.every((block) => isRecord(block) && block.type === "text")
          ? content.map((block) => String((block as Record<string, unknown>).text ?? "")).join("")
          : null;
    if (text === null) return;
    // Typed by a person: no origin (Claude Code 2.1.316 and before) or a human one (2.1.317
    // on, promptSource "typed"), and never sent by the system. A loop's result reaches the
    // session as a notification; a message relayed from another session or channel has its
    // own origin. Neither is the owner's words.
    const origin = isRecord(entry.origin) ? entry.origin : null;
    const typed =
      entry.promptSource !== "system" &&
      (entry.origin === undefined || (origin !== null && origin.kind === "human"));
    if (!typed) {
      if (entry.promptSource !== "system" && origin?.kind !== "task-notification") return;
      for (const match of text.matchAll(/"review_id"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
        let id: string;
        try {
          id = JSON.parse(`"${match[1]}"`) as string;
        } catch {
          continue;
        }
        if (!log.stops.has(id)) log.stops.set(id, index);
      }
      return;
    }
    if (/^<(task-notification|system-reminder|command-|local-command)/.test(text.trim())) return;
    log.owner.push({ index, text: text.trim() });
  });
  return log;
}
/** Why the answers a session passes to a loop are not all the owner's own; empty when they are. */
export function answerProblems(log: SessionLog, answers: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [id, answer] of Object.entries(answers)) {
    const stop = log.stops.get(id);
    if (typeof answer !== "string" || !answer.trim())
      problems.push(`the answer to "${id}" is not text`);
    else if (stop === undefined)
      problems.push(`no loop stopped at "${id}" in this session, so the owner was never shown it`);
    else if (!log.owner.some((message) => message.index > stop && message.text === answer.trim()))
      problems.push(
        `the answer to "${id}" is not, word for word and whole, a message the owner typed after the loop stopped there`,
      );
  }
  return problems;
}
function guardOwnerAnswers(root: string, input: Record<string, unknown>): string | null {
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  if (input.tool_name !== "Workflow") {
    const target = toolInput.file_path ?? toolInput.notebook_path;
    if (typeof target !== "string" || !target) return null;
    const cwd = typeof input.cwd === "string" ? input.cwd : root;
    const resolved = path.resolve(cwd, target);
    const dir = answersDir(root);
    return resolved === dir || resolved.startsWith(dir + path.sep)
      ? "Contrejour: the owner's verified answers are written only by the hook, when a session passes them to a loop."
      : null;
  }
  const args = isRecord(toolInput.args) ? toolInput.args : {};
  if (!isRecord(args.answers) || !Object.keys(args.answers).length) return null;
  const transcript = typeof input.transcript_path === "string" ? input.transcript_path : "";
  if (!transcript || !fs.existsSync(transcript))
    return "Contrejour: the owner's answers cannot be checked, because this session's transcript is not available. Run the loop without answers; it asks the owner again.";
  const problems = answerProblems(
    readSessionLog(fs.readFileSync(transcript, "utf8")),
    args.answers,
  );
  if (problems.length)
    return `Contrejour: an answer passed to a loop must be a message the owner typed in this session after the loop stopped at that review, whole and word for word: ${problems.join("; ")}. Show the owner the review note and pass their reply unchanged; drop answers this session never received.`;
  fs.mkdirSync(answersDir(root), { recursive: true });
  for (const [id, answer] of Object.entries(args.answers))
    fs.writeFileSync(
      answerFile(root, id),
      `${JSON.stringify({ review_id: id, answer, session_id: input.session_id ?? null, verified_at: new Date().toISOString() }, null, 2)}\n`,
    );
  return null;
}

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
    return "Contrejour: what leaves for the shared library, and its leak check, are written only by `library-cli.js`.";
  if (resolved === selectedLoopPath(root))
    return "Contrejour: the loop a review runs and its parameters are written only by `setup-cli.js apply`, once the owner has confirmed them.";
  if (HELPER_FILES.test(resolved))
    return "Contrejour: submission records, published results and leak-review snapshots are written only by validation-cli.js.";
  return null;
}

const deny = (reason: string): string =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });

function handle(event: string, input: Record<string, unknown>): string | null {
  const actions = declaredTriggers(ROOT);
  const on = (action: string) => actions.has(action) && (TRIGGERS[action] ?? []).includes(event);
  if (on("record-trajectory")) recordTrajectory(ROOT, input);
  if (on("notify-stopped-review")) notifyStoppedReview(ROOT, input);
  if (on("guard-owner-answers")) {
    const reason = guardOwnerAnswers(ROOT, input);
    if (reason) return deny(reason);
  }
  if (on("guard-protected-paths") && input.tool_name !== "Workflow") {
    const reason = guardReason(ROOT, input);
    if (reason) return deny(reason);
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
