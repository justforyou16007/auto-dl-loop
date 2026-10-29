/**
 * task.md, the statement both machines work to. The validator's copy is the
 * original, published by the validation service's `task` tool; the worker's is
 * fetched from it byte for byte and never edited.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { failA1, isRecord } from "./validate.js";

export const taskPath = (root: string): string => path.join(path.resolve(root), "task.md");

const sha256 = (bytes: Buffer): string => crypto.createHash("sha256").update(bytes).digest("hex");

/** task.md as it stands, or null when it is missing or blank. */
export function readTask(root: string): { bytes: Buffer; sha256: string } | null {
  const file = taskPath(root);
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return bytes.toString("utf8").trim() ? { bytes, sha256: sha256(bytes) } : null;
}

/** What the `task` tool returns: UTF-8 text, so it survives JSON unchanged. */
export interface PublishedTask {
  sha256: string;
  text: string;
}

/**
 * Call the `task` tool of the validation service at `url` (its /mcp endpoint).
 * The service answers each JSON-RPC request in one POST, so no MCP session is needed.
 */
export async function fetchValidatorTask(url: string, token: string): Promise<PublishedTask> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "task", arguments: {} },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    failA1("VALIDATION_UNREACHABLE", `cannot reach ${url}: ${String(reason)}`);
  }
  if (response.status === 401) failA1("VALIDATION_UNREACHABLE", `${url} refused the token`);
  if (!response.ok) failA1("VALIDATION_UNREACHABLE", `${url} answered HTTP ${response.status}`);
  const reply: unknown = await response.json().catch(() => null);
  const result = isRecord(reply) && isRecord(reply.result) ? reply.result : {};
  const content = Array.isArray(result.content) ? (result.content[0] as unknown) : undefined;
  const text = isRecord(content) ? content.text : undefined;
  if (typeof text !== "string")
    failA1("VALIDATION_UNREACHABLE", `${url} is not a Contrejour validation service`);
  if (result.isError === true) failA1("TASK_UNAVAILABLE", `the validation service says: ${text}`);
  let task: unknown;
  try {
    task = JSON.parse(text);
  } catch {
    failA1("TASK_UNAVAILABLE", "the task tool returned no JSON");
  }
  if (!isRecord(task) || typeof task.text !== "string" || typeof task.sha256 !== "string")
    failA1("TASK_UNAVAILABLE", "the task tool returned no text and sha256");
  if (sha256(Buffer.from(task.text, "utf8")) !== task.sha256)
    failA1("TASK_UNAVAILABLE", "the task text does not match its sha256");
  return { sha256: task.sha256, text: task.text };
}

/** Make task.md the published task, byte for byte; reports whether it changed. */
export function writeTask(root: string, task: PublishedTask): boolean {
  if (readTask(root)?.sha256 === task.sha256) return false;
  fs.writeFileSync(taskPath(root), task.text, "utf8");
  return true;
}
