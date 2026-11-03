#!/usr/bin/env node
/**
 * Worker machine helper of the worker-task-manager role, the only role that
 * talks to the validation service. The ledger keeps what
 * the validation service cannot know about each submission: its commit, zip,
 * idea and target problems. `wait` blocks until a submission is final, for a
 * background run that wakes the session; it keeps the final result as received
 * in `.contrejour/results/`, because a published result never changes and the
 * roles that may not call the service read it there. Anything that can change
 * (status, submissions left) is always read from the service.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCli, runCli } from "../lib/cli.js";
import { installedRole } from "./installation.js";
import { readStateFile, withStateFileLock, writeStateJsonAtomic } from "./state-file.js";
import { callValidatorTool } from "./task.js";
import { A1Error, failA1, isRecord } from "./validate.js";
import { FINAL } from "./validation/store.js";

export interface LedgerEntry {
  submission_id: string;
  commit: string;
  zip: string;
  zip_sha256: string | null;
  idea: string | null;
  problems: string[];
  note: string | null;
  recorded_at: string;
}
interface Ledger {
  schema_version: 1;
  submissions: Record<string, LedgerEntry>;
}

export const ledgerPath = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "ledger.json");
export const resultPath = (root: string, id: string): string =>
  path.join(path.resolve(root), ".contrejour", "results", `${id}.json`);
export const requirementsPath = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "requirements.json");

function workerRoot(projectRoot: string): string {
  const root = path.resolve(projectRoot);
  if (installedRole(root) !== "worker")
    failA1("WORKER_ONLY", "this helper runs in the worker project");
  return root;
}
function readLedger(root: string): Ledger {
  const file = ledgerPath(root);
  if (!fs.existsSync(file)) return { schema_version: 1, submissions: {} };
  const ledger = readStateFile<Ledger>(file);
  if (ledger.schema_version !== 1 || !isRecord(ledger.submissions))
    failA1("INVALID_VALUE", `${file} is not a Contrejour ledger`);
  return ledger;
}

export function addLedgerEntry(
  projectRoot: string,
  entry: {
    submission: string;
    commit: string;
    zip: string;
    idea?: string;
    problems?: string;
    note?: string;
  },
  update = false,
): LedgerEntry {
  const root = workerRoot(projectRoot);
  if (!/^s\d{3,}$/.test(entry.submission))
    failA1("INVALID_VALUE", "a submission id looks like s001");
  if (!/^[0-9a-f]{7,40}$/i.test(entry.commit))
    failA1("INVALID_VALUE", "the commit must be a git hash");
  const zip = path.resolve(root, entry.zip);
  return withStateFileLock(ledgerPath(root), () => {
    const ledger = readLedger(root);
    if (ledger.submissions[entry.submission] && !update)
      failA1(
        "ALREADY_RECORDED",
        `${entry.submission} is already in the ledger; pass --update to change it`,
      );
    const recorded: LedgerEntry = {
      submission_id: entry.submission,
      commit: entry.commit,
      zip,
      zip_sha256: fs.existsSync(zip)
        ? crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex")
        : null,
      idea: entry.idea ?? null,
      problems: (entry.problems ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      note: entry.note ?? null,
      recorded_at: new Date().toISOString(),
    };
    writeStateJsonAtomic(ledgerPath(root), {
      ...ledger,
      submissions: { ...ledger.submissions, [entry.submission]: recorded },
    });
    return recorded;
  });
}

export function showLedger(projectRoot: string, id?: string): unknown {
  const root = workerRoot(projectRoot);
  const ledger = readLedger(root);
  if (!id) return ledger.submissions;
  const entry =
    ledger.submissions[id] ?? failA1("UNKNOWN_SUBMISSION", `${id} is not in the ledger`);
  const result = resultPath(root, id);
  return { ...entry, result: fs.existsSync(result) ? readStateFile<unknown>(result) : null };
}

/** The validation service as the worker's MCP configuration names it. */
function connection(root: string): { url: string; token: string } {
  const file = path.join(root, ".mcp.json");
  const config: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const server =
    isRecord(config) && isRecord(config.mcpServers) ? config.mcpServers.contrejour : null;
  const auth = isRecord(server) && isRecord(server.headers) ? server.headers.Authorization : null;
  if (
    !isRecord(server) ||
    typeof server.url !== "string" ||
    typeof auth !== "string" ||
    !auth.startsWith("Bearer ")
  )
    failA1(
      "WORKER_NOT_CONFIGURED",
      "run the worker-config role first: .mcp.json names no contrejour server",
    );
  return { url: server.url, token: auth.slice("Bearer ".length) };
}

/**
 * Fetch the submission requirements and keep them, with when they were fetched,
 * for the roles that build to them. Their terms are frozen on the validator;
 * `submissions.remaining` is only as of `fetched_at`.
 */
export async function saveRequirements(projectRoot: string): Promise<unknown> {
  const root = workerRoot(projectRoot);
  const { url, token } = connection(root);
  const requirements = await callValidatorTool(url, token, "requirements");
  const saved = { fetched_at: new Date().toISOString(), requirements };
  writeStateJsonAtomic(requirementsPath(root), saved);
  return saved;
}

/** Poll `query` until the submission is final; keep its result as received. */
export async function waitForResult(
  projectRoot: string,
  id: string,
  options: { pollSeconds: number; timeoutMinutes: number; log?: (line: string) => void },
): Promise<unknown> {
  const root = workerRoot(projectRoot);
  const { url, token } = connection(root);
  const log = options.log ?? ((line: string) => console.error(line));
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  for (;;) {
    try {
      const reply = await callValidatorTool(url, token, "query", { submission_id: id });
      const submission = isRecord(reply) ? reply.submission : null;
      if (isRecord(submission) && FINAL.includes(submission.status as (typeof FINAL)[number])) {
        const result = { ...submission, service: isRecord(reply) ? reply.service : null };
        fs.mkdirSync(path.dirname(resultPath(root, id)), { recursive: true });
        writeStateJsonAtomic(resultPath(root, id), result);
        return result;
      }
    } catch (error) {
      // An unreachable service may be restarting; only the deadline ends the wait.
      if (!(error instanceof A1Error) || error.code !== "VALIDATION_UNREACHABLE") throw error;
      log(`waiting for ${id}: ${error.message}`);
    }
    if (Date.now() > deadline)
      failA1("WAIT_TIMEOUT", `${id} was not final after ${options.timeoutMinutes} minutes`);
    await new Promise((resolve) => setTimeout(resolve, options.pollSeconds * 1000));
  }
}

function cli(): void {
  const program = createCli("worker", "Contrejour worker ledger and result waiting");
  const run = (action: () => unknown | Promise<unknown>) => async () => {
    try {
      console.log(JSON.stringify(await action(), null, 2));
    } catch (error) {
      console.error(
        JSON.stringify(
          {
            status: "failed",
            reason: error instanceof A1Error ? error.code : "worker_command_failed",
            message: (error as Error).message,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    }
  };
  program
    .command("ledger-add")
    .description("Record a submission's commit, zip, idea and target problems")
    .requiredOption("--project <dir>")
    .requiredOption("--submission <id>")
    .requiredOption("--commit <hash>")
    .requiredOption("--zip <path>")
    .option("--idea <id>", "the wiki idea this submission implements, e.g. idea:short-answers")
    .option("--problems <ids>", "comma-separated wiki problems it targets")
    .option("--note <text>")
    .option("--update", "replace an entry already recorded", false)
    .action(
      (options: {
        project: string;
        submission: string;
        commit: string;
        zip: string;
        idea?: string;
        problems?: string;
        note?: string;
        update: boolean;
      }) => run(() => addLedgerEntry(options.project, options, options.update))(),
    );
  program
    .command("ledger")
    .description("Show the ledger, or one submission with its result once one was received")
    .requiredOption("--project <dir>")
    .option("--submission <id>")
    .action((options: { project: string; submission?: string }) =>
      run(() => showLedger(options.project, options.submission))(),
    );
  program
    .command("requirements")
    .description("Fetch the submission requirements and keep them in .contrejour/requirements.json")
    .requiredOption("--project <dir>")
    .action((options: { project: string }) => run(() => saveRequirements(options.project))());
  program
    .command("wait")
    .description(
      "Block until the submission is final; run it in the background so the session wakes when it ends",
    )
    .requiredOption("--project <dir>")
    .requiredOption("--submission <id>")
    .option("--poll-seconds <n>", "seconds between queries", "60")
    .option("--timeout-minutes <n>", "give up after this long", "1440")
    .action(
      (options: {
        project: string;
        submission: string;
        pollSeconds: string;
        timeoutMinutes: string;
      }) =>
        run(() =>
          waitForResult(options.project, options.submission, {
            pollSeconds: Math.max(1, Number(options.pollSeconds)),
            timeoutMinutes: Math.max(1, Number(options.timeoutMinutes)),
          }),
        )(),
    );
  runCli(program);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
