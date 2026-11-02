/**
 * Review sessions through the local Claude Code CLI. The service starts one
 * background session per submission; it enters through the validator's
 * task-manager role, which runs the submission-review loop. The service also
 * asks Claude Code how each session is doing and continues one that stopped
 * before finalize. No shell is involved: every command is an argv list built
 * from the frozen config.
 */
import { execFile } from "node:child_process";
import { TASK_MANAGER } from "../installation.js";
import { failA1, isRecord } from "../validate.js";
import type { ValidationAgentConfig } from "./config.js";
import type { ReviewSession } from "./store.js";

export interface DispatchRequest {
  root: string;
  submission_id: string;
  submission_dir: string;
}
export type Dispatcher = (request: DispatchRequest) => Promise<ReviewSession>;

/**
 * A session's state as the service needs it: working, its turn ended with the
 * process alive, stopped (the process ended), or gone once it is removed.
 */
export type SessionState = "running" | "idle" | "stopped" | "gone";

/** What the service can learn about, and say to, the sessions it started. */
export interface SessionControl {
  /** Throws when Claude Code cannot answer. */
  state(session: ReviewSession): Promise<SessionState>;
  /**
   * Continue a session that is not running with this message. It continues in
   * place; should Claude Code start a copy instead, the copy is returned.
   */
  resume(session: ReviewSession, message: string): Promise<ReviewSession>;
}

export const REVIEW_LOOP = "submission-review";
export const sessionName = (submissionId: string): string => `contrejour-review-${submissionId}`;

/**
 * Every role of the loop receives this text verbatim, the blank-context ones
 * included, so it names the loop and its arguments and nothing else.
 */
export function reviewPrompt(request: DispatchRequest): string {
  const args = { submission_id: request.submission_id, submission_dir: request.submission_dir };
  return `Run the ${REVIEW_LOOP} loop with args ${JSON.stringify(args)}.`;
}

export function claudeStartArgv(agent: ValidationAgentConfig, request: DispatchRequest): string[] {
  return [
    ...agent.claude_command,
    "--bg",
    "--name",
    sessionName(request.submission_id),
    "--agent",
    TASK_MANAGER.validator,
    "--permission-mode",
    agent.permission_mode,
    ...(agent.model ? ["--model", agent.model] : []),
    // In a git checkout a background session may not edit files until it creates a worktree.
    "--settings",
    JSON.stringify({ worktree: { bgIsolation: "none" } }),
    reviewPrompt(request),
  ];
}
export const claudeListArgv = (agent: ValidationAgentConfig, root: string): string[] => [
  ...agent.claude_command,
  "agents",
  "--json",
  "--all",
  "--cwd",
  root,
];
export const claudeStopArgv = (agent: ValidationAgentConfig, session: ReviewSession): string[] => [
  ...agent.claude_command,
  "stop",
  session.id,
];
/**
 * A stopped session continues in place with the options it was started with;
 * any other flag would start a copy instead.
 */
export const claudeResumeArgv = (
  agent: ValidationAgentConfig,
  session: ReviewSession,
  message: string,
): string[] => [...agent.claude_command, "--bg", "--resume", session.session_id, message];

/**
 * Variables that tie a process to the Claude Code or Paseo session it runs in.
 * Inherited, they would attach a review session to that one; it must stand alone.
 */
const SESSION_VARIABLES = new Set([
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
]);
export function standaloneEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !SESSION_VARIABLES.has(name) && !name.startsWith("PASEO_"),
    ),
  );
}

function claude(
  argv: string[],
  cwd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const [command, ...args] = argv;
  return new Promise((resolve) => {
    execFile(
      command!,
      args,
      {
        cwd,
        env: standaloneEnvironment(process.env),
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          stdout: String(stdout),
          stderr: String(stderr).trim() || (error ? error.message : ""),
        }),
    );
  });
}

/** `claude --bg` reports the short id of the session it started or continued. */
export function backgroundedId(output: string): string | null {
  return /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(output)?.[1] ?? null;
}

interface ListedSession {
  id: string;
  sessionId?: string;
  name?: string;
  status?: string;
  state?: string;
}
async function listSessions(agent: ValidationAgentConfig, root: string): Promise<ListedSession[]> {
  const reply = await claude(claudeListArgv(agent, root), root);
  if (!reply.ok) throw new Error(`claude agents failed: ${reply.stderr}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.stdout);
  } catch {
    throw new Error(`claude agents printed no JSON: ${reply.stdout.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("claude agents did not list sessions");
  return parsed.filter(
    (entry): entry is ListedSession => isRecord(entry) && typeof entry.id === "string",
  );
}

/**
 * busy is a working session; idle is one whose turn ended while its process
 * lives on (`done`, or `blocked` on something nobody will answer); a session
 * without a status has stopped.
 */
export function sessionState(listed: ListedSession | undefined): SessionState {
  if (!listed) return "gone";
  if (listed.status === "busy") return "running";
  if (listed.status === undefined || listed.status === null) return "stopped";
  return "idle";
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findSession(
  agent: ValidationAgentConfig,
  root: string,
  id: string | null,
  name: string,
): Promise<ReviewSession> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const found = (await listSessions(agent, root)).find(
      (entry) => (id ? entry.id === id : entry.name === name) && entry.sessionId,
    );
    if (found) return { id: found.id, session_id: found.sessionId!, name };
    await delay(1000);
  }
  failA1("DISPATCH_FAILED", `claude --bg started no session the service can find (${name})`);
}

export function claudeDispatcher(agent: ValidationAgentConfig): Dispatcher {
  return async (request) => {
    const reply = await claude(claudeStartArgv(agent, request), request.root);
    if (!reply.ok) throw new Error(`claude --bg failed: ${reply.stderr || reply.stdout}`);
    const name = sessionName(request.submission_id);
    return findSession(agent, request.root, backgroundedId(reply.stdout), name);
  };
}

export function claudeSessionControl(agent: ValidationAgentConfig, root: string): SessionControl {
  return {
    async state(session) {
      return sessionState(
        (await listSessions(agent, root)).find((entry) => entry.id === session.id),
      );
    },
    async resume(session, message) {
      const state = await this.state(session);
      if (state === "running") throw new Error(`session ${session.id} is still running`);
      if (state === "gone") throw new Error(`session ${session.id} no longer exists`);
      // A session whose process lives on would be copied rather than continued.
      if (state === "idle") {
        const stopped = await claude(claudeStopArgv(agent, session), root);
        if (!stopped.ok) throw new Error(`claude stop failed: ${stopped.stderr}`);
      }
      const reply = await claude(claudeResumeArgv(agent, session, message), root);
      if (!reply.ok) throw new Error(`claude --resume failed: ${reply.stderr || reply.stdout}`);
      const id = backgroundedId(reply.stdout);
      return id && id !== session.id ? await findSession(agent, root, id, session.name) : session;
    },
  };
}
