/**
 * Review sessions through the local Claude Code CLI. The service starts one
 * background session per submission; it enters through the validator's
 * task-manager role, which runs the submission-review loop. The service also
 * asks Claude Code how each session is doing and continues one that stopped
 * before finalize. How sessions are started, watched and continued is the
 * framework's (`sessions.ts`); this file names the review's session and its
 * first message.
 */
import { TASK_MANAGER } from "../research-profiles.js";
import {
  backgroundedId,
  listArgv,
  resumeArgv,
  sessionControl,
  sessionState,
  standaloneEnvironment,
  startArgv,
  startSession,
  stopArgv,
  type SessionControl as BackgroundControl,
  type SessionState,
} from "@studio/tools/sessions.js";
import type { ValidationAgentConfig } from "./config.js";
import type { ReviewSession } from "./store.js";

export { backgroundedId, sessionState, standaloneEnvironment, type SessionState };

export interface DispatchRequest {
  root: string;
  submission_id: string;
  submission_dir: string;
  /** The loop the owner chose for this project and its parameter values. */
  loop: string;
  params: Record<string, unknown>;
}
export type Dispatcher = (request: DispatchRequest) => Promise<ReviewSession>;

/** What the service can learn about, and say to, the sessions it started. */
export type SessionControl = BackgroundControl;

export const sessionName = (submissionId: string): string => `contrejour-review-${submissionId}`;

/** The arguments a review loop runs with: the submission and the loop's parameters. */
export const reviewArgs = (request: Omit<DispatchRequest, "root" | "loop">) => ({
  submission_id: request.submission_id,
  submission_dir: request.submission_dir,
  params: request.params,
});
/**
 * Every role of the loop receives this text verbatim, the blank-context ones
 * included, so it names the loop and its arguments and nothing else.
 */
export function reviewPrompt(request: DispatchRequest): string {
  return `Run the ${request.loop} loop with args ${JSON.stringify(reviewArgs(request))}.`;
}

const startRequest = (request: DispatchRequest) => ({
  name: sessionName(request.submission_id),
  agent: TASK_MANAGER.validator,
  prompt: reviewPrompt(request),
});
export const claudeStartArgv = (agent: ValidationAgentConfig, request: DispatchRequest): string[] =>
  startArgv(agent, startRequest(request));
export const claudeListArgv = (agent: ValidationAgentConfig, root: string): string[] =>
  listArgv(agent, root);
export const claudeStopArgv = (agent: ValidationAgentConfig, session: ReviewSession): string[] =>
  stopArgv(agent, session);
export const claudeResumeArgv = (
  agent: ValidationAgentConfig,
  session: ReviewSession,
  message: string,
): string[] => resumeArgv(agent, session, message);

export function claudeDispatcher(agent: ValidationAgentConfig): Dispatcher {
  return (request) => startSession(agent, request.root, startRequest(request));
}

export function claudeSessionControl(agent: ValidationAgentConfig, root: string): SessionControl {
  return sessionControl(agent, root);
}
