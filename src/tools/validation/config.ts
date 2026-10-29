/** The validator machine's terms: how a test passes, how often, and by whom. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROLE_THINKING, isProvider, type Provider } from "../provider.js";
import { readStateFile, writeStateFileAtomic } from "../state-file.js";
import {
  assertNoUnknownFields,
  failA1,
  isRecord,
  requireFiniteNumber,
  requireInteger,
  requireString,
} from "../validate.js";

export type PassOperator = ">=" | ">" | "<=" | "<" | "==";
export const PASS_OPERATORS: readonly PassOperator[] = [">=", ">", "<=", "<", "=="];

/** One test passes when its per-sample value of `metric` satisfies `op threshold`. */
export interface PassRule {
  metric: string;
  op: PassOperator;
  threshold: number;
}

export interface ValidationLimits {
  /** Counted submissions; format failures and infrastructure failures do not count. */
  max_submissions: number;
  max_concurrent: number;
  max_upload_bytes: number;
  max_unpacked_bytes: number;
  max_files: number;
  upload_ttl_minutes: number;
  review_timeout_minutes: number;
  /** Rewrites a validator agent gets when the leak review finds a leak in its feedback. */
  feedback_attempts: number;
  /** Tests one review may add across the layers it registers. */
  max_new_tests_per_review: number;
}

export interface ValidationAgentConfig {
  /** The backend the validator project was installed with, at the role's thinking level. */
  provider: Provider;
  thinking: string;
  model?: string;
  mode?: string;
  /**
   * argv prefix that runs the Paseo CLI. On Windows `paseo` is a .cmd shim that
   * cannot be spawned without a shell, so name node and the CLI script instead.
   */
  paseo_command: string[];
}

export interface ValidationConfig {
  schema_version: 2;
  pass_rule: PassRule;
  /** The base layer frozen at setup; a different installed config stops the service. */
  tester_config_sha256: string;
  /** What a validator agent must write into a submission's adapter directory. */
  adapter_contract: string;
  /**
   * What the validator machine offers a deliverable (OS, runtimes, GPU, network,
   * time per input), written by the owner and shown to the worker; "" when unset.
   */
  runtime_environment: string;
  limits: ValidationLimits;
  /** Hidden samples, labels and references of the base layer, for the leak reviewer. */
  hidden_paths: string[];
  agent: ValidationAgentConfig;
  service: { host: string; public_url: string };
}

/**
 * Paseo modes a validator may run in, per backend, the default first. Full access
 * lets the benchmark and the deliverable's documented install reach the network
 * and write outside the project; a sandboxed mode makes those steps fail. Modes
 * that wait for an approval nobody gives are not offered.
 */
export const VALIDATOR_MODES: Record<Provider, readonly string[]> = {
  claude: ["bypassPermissions", "auto"],
  codex: ["full-access", "auto-review", "auto"],
};

export const DEFAULT_LIMITS: ValidationLimits = {
  max_submissions: 20,
  max_concurrent: 1,
  max_upload_bytes: 2 * 1024 ** 3,
  max_unpacked_bytes: 8 * 1024 ** 3,
  max_files: 20_000,
  upload_ttl_minutes: 60,
  review_timeout_minutes: 24 * 60,
  feedback_attempts: 3,
  max_new_tests_per_review: 200,
};

export const validationDir = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "validation");
export const validationConfigPath = (root: string): string =>
  path.join(validationDir(root), "config.json");
export const validationTokenPath = (root: string): string =>
  path.join(validationDir(root), "token");

function strings(value: unknown, location: string): string[] {
  if (!Array.isArray(value)) failA1("INVALID_VALUE", "expected a list", location);
  return value.map((item, index) => requireString(item, `${location}[${index}]`));
}

export function validateValidationConfig(value: unknown): ValidationConfig {
  if (!isRecord(value) || value.schema_version !== 2)
    failA1(
      "INVALID_VALIDATION_CONFIG",
      "run /validator-setup on the validator machine to create it",
    );
  assertNoUnknownFields(
    value,
    [
      "schema_version",
      "pass_rule",
      "tester_config_sha256",
      "adapter_contract",
      "runtime_environment",
      "limits",
      "hidden_paths",
      "agent",
      "service",
    ],
    "validation",
  );
  for (const key of ["pass_rule", "limits", "agent", "service"])
    if (!isRecord(value[key])) failA1("INVALID_VALIDATION_CONFIG", `${key} must be an object`);
  const rule = value.pass_rule as Record<string, unknown>;
  assertNoUnknownFields(rule, ["metric", "op", "threshold"], "pass_rule");
  if (!PASS_OPERATORS.includes(rule.op as PassOperator))
    failA1("INVALID_VALUE", `choose one of ${PASS_OPERATORS.join(" ")}`, "pass_rule.op");
  const rawLimits = value.limits as Record<string, unknown>;
  assertNoUnknownFields(rawLimits, Object.keys(DEFAULT_LIMITS), "limits");
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ValidationLimits)[])
    if (rawLimits[key] !== undefined)
      limits[key] = requireInteger(
        rawLimits[key],
        `limits.${key}`,
        key === "feedback_attempts" ? 0 : 1,
      );
  const hidden = strings(value.hidden_paths, "hidden_paths");
  if (!hidden.length) failA1("INVALID_VALUE", "name the hidden benchmark files", "hidden_paths");
  for (const item of hidden)
    if (!path.isAbsolute(item))
      failA1("INVALID_VALUE", "hidden paths must be absolute", "hidden_paths");
  const agent = value.agent as Record<string, unknown>;
  assertNoUnknownFields(agent, ["provider", "model", "mode", "thinking", "paseo_command"], "agent");
  const command = strings(agent.paseo_command ?? ["paseo"], "agent.paseo_command");
  if (!command.length) failA1("INVALID_VALUE", "must not be empty", "agent.paseo_command");
  // Configs written before the backend became a choice name none: they ran Codex.
  const provider = agent.provider ?? "codex";
  if (!isProvider(provider)) failA1("INVALID_VALUE", "choose claude or codex", "agent.provider");
  const thinking = ROLE_THINKING.validator[provider];
  if (agent.thinking !== undefined && agent.thinking !== null && agent.thinking !== thinking)
    failA1("INVALID_VALUE", `${provider} validator agents use ${thinking}`, "agent.thinking");
  const modes = VALIDATOR_MODES[provider];
  if (agent.mode !== undefined && agent.mode !== null && !modes.includes(String(agent.mode)))
    failA1("INVALID_VALUE", `choose one of ${modes.join(", ")}`, "agent.mode");
  const optional = (key: string) =>
    agent[key] === undefined || agent[key] === null
      ? {}
      : { [key]: requireString(agent[key], `agent.${key}`) };
  const service = value.service as Record<string, unknown>;
  assertNoUnknownFields(service, ["host", "public_url"], "service");
  const publicUrl = requireString(service.public_url, "service.public_url");
  if (!/^https?:\/\/[^/]+/.test(publicUrl))
    failA1("INVALID_VALUE", "must be an http(s) URL", "service.public_url");
  if (!/^[0-9a-f]{64}$/.test(String(value.tester_config_sha256)))
    failA1("INVALID_VALUE", "must be a SHA-256 digest", "tester_config_sha256");
  return {
    schema_version: 2,
    pass_rule: {
      metric: requireString(rule.metric, "pass_rule.metric"),
      op: rule.op as PassOperator,
      threshold: requireFiniteNumber(rule.threshold, "pass_rule.threshold"),
    },
    tester_config_sha256: String(value.tester_config_sha256),
    adapter_contract: requireString(value.adapter_contract, "adapter_contract"),
    runtime_environment:
      value.runtime_environment === undefined || value.runtime_environment === ""
        ? ""
        : requireString(value.runtime_environment, "runtime_environment"),
    limits,
    hidden_paths: hidden,
    agent: {
      provider,
      thinking,
      ...optional("model"),
      ...optional("mode"),
      paseo_command: command,
    },
    service: {
      host: service.host === undefined ? "127.0.0.1" : requireString(service.host, "service.host"),
      public_url: publicUrl.replace(/\/+$/, ""),
    },
  };
}

export function readValidationConfig(root: string): ValidationConfig {
  const file = validationConfigPath(root);
  if (!fs.existsSync(file))
    failA1("VALIDATION_NOT_CONFIGURED", "run /validator-setup on this validator machine");
  return validateValidationConfig(readStateFile(file));
}

export function readValidationToken(root: string): string {
  const file = validationTokenPath(root);
  if (!fs.existsSync(file)) failA1("VALIDATION_NOT_CONFIGURED", "service token is missing");
  const token = fs.readFileSync(file, "utf8").trim();
  if (token.length < 32) failA1("VALIDATION_NOT_CONFIGURED", "service token is too short");
  return token;
}

/**
 * The bearer token: the one the machine provides (CONTREJOUR_TOKEN), otherwise
 * one created once, so re-running setup keeps the worker's copy valid.
 */
export function ensureValidationToken(root: string, provided?: string): string {
  const file = validationTokenPath(root);
  if (provided !== undefined) {
    if (provided.length < 32)
      failA1("INVALID_VALUE", "must be at least 32 characters", "CONTREJOUR_TOKEN");
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8").trim() !== provided)
      writeStateFileAtomic(file, `${provided}\n`);
    return provided;
  }
  if (fs.existsSync(file)) return readValidationToken(root);
  const token = crypto.randomBytes(32).toString("base64url");
  writeStateFileAtomic(file, `${token}\n`);
  return token;
}

export function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const left = Buffer.from(expected),
    right = Buffer.from(presented);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function passes(rule: PassRule, value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (rule.op === ">=") return value >= rule.threshold;
  if (rule.op === ">") return value > rule.threshold;
  if (rule.op === "<=") return value <= rule.threshold;
  if (rule.op === "<") return value < rule.threshold;
  return value === rule.threshold;
}
