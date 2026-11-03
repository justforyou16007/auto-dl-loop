/**
 * The one editable configuration sheet behind the worker-setup and
 * validator-setup roles, for the installed side. refresh writes the draft and
 * its review, confirm records the owner's approval of one digest, and apply is
 * the only step that changes the project, apart from the worker's fetch-task,
 * which copies the validator's task.md, and the environment section of
 * CLAUDE.md, which the setup and memory roles keep.
 */
import { isUtf8 } from "node:buffer";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJsonSha256 } from "./canonical-json.js";
import { readStateFile, withStateFileLock, writeStateJsonAtomic } from "./state-file.js";
import { fetchValidatorTask, readTask, taskPath, writeTask } from "./task.js";
import {
  setupTesterFacility,
  testerFacilityConfigSha256,
  validateTesterFacilityConfig,
  type TesterFacilityConfig,
} from "./tester-facility.js";
import { failA1, isRecord, type JsonObject } from "./validate.js";
import {
  DEFAULT_LIMITS,
  PASS_OPERATORS,
  PERMISSION_MODES,
  readValidationConfig,
  ensureValidationToken,
  validateValidationConfig,
  validationConfigPath,
  type ValidationConfig,
} from "./validation/config.js";
import { standaloneEnvironment } from "./sessions.js";
import { hookHelperPath, registerHooks, writeEntryRole } from "./project-settings.js";

export { hookHelperPath, registerHooks };
import { assertBenchmarkIntact } from "./validation/layers.js";
import { countedSubmissions } from "./validation/store.js";
import { TASK_MANAGER, installedRole, skillsDir, type Role } from "./installation.js";
import {
  listLoops,
  loopDefinitionPath,
  loopKind,
  loopParameters,
  loopSide,
  parameterDefaults,
  parameterProblem,
  selectedLoopPath,
  type LoopParameter,
} from "./loops.js";

export type SetupRole = Role;
export interface SetupDraft {
  schema_version: 1;
  project_root: string;
  configuration: JsonObject;
}
export interface SetupIssue {
  field: string;
  message: string;
}
export interface SetupReviewField {
  path: string;
  value: unknown;
  options?: readonly unknown[];
  recommendation: string;
}
export interface SetupReview {
  role: SetupRole;
  language: "en" | "zh";
  draft_path: string;
  review_path: string;
  task: { path: string; sha256: string | null };
  configuration_sha256: string;
  ready_to_confirm: boolean;
  confirmed: boolean;
  modules: { id: string; title: string; fields: SetupReviewField[] }[];
  issues: SetupIssue[];
}
export class SetupReviewIncompleteError extends Error {
  readonly issues: SetupIssue[];
  constructor(issues: SetupIssue[]) {
    super("SETUP_CONFIGURATION_INCOMPLETE: edit the reported fields, then refresh");
    this.issues = issues;
  }
}

const TITLES: Record<string, string> = {
  loop: "流程 / Loop",
  project: "项目 / Project",
  environment: "执行环境 / Environment",
  connection: "验证服务连接 / Validation service",
  validation: "验证条款 / Validation terms",
};
/** The loop module comes first: the loop the owner's requirement calls for, then its parameters. */
const ROLE_MODULES: Record<SetupRole, readonly string[]> = {
  worker: ["loop", "project", "environment", "connection"],
  validator: ["loop", "project", "environment", "validation"],
};
const MODULE_FIELDS: Record<string, readonly string[]> = {
  loop: ["name", "params"],
  project: ["name", "language"],
  environment: ["secrets"],
  connection: ["url", "token"],
  validation: [
    "pass_rule",
    "benchmark",
    "adapter_contract",
    "runtime_environment",
    "limits",
    "hidden_paths",
    "agent",
    "service",
  ],
};
const CHOICES: Record<string, readonly unknown[]> = {
  "project.language": ["zh", "en"],
  "validation.pass_rule.op": PASS_OPERATORS,
  "validation.benchmark.metrics.*.direction": ["higher_better", "lower_better"],
  "validation.benchmark.metrics.*.aggregation": ["mean", "sum", "external"],
  "validation.service.host": ["127.0.0.1", "0.0.0.0"],
  "validation.agent.permission_mode": PERMISSION_MODES,
};
/**
 * The validation service's public address and bearer token, when the validator
 * machine provides them: setup then uses them instead of asking for an address
 * or creating a token.
 */
function serviceEnvironment(): { url?: string; token?: string } {
  const url = process.env.CONTREJOUR_URL?.trim().replace(/\/+$/, "");
  const token = process.env.CONTREJOUR_TOKEN?.trim();
  return { ...(url ? { url } : {}), ...(token ? { token } : {}) };
}
/** The task loops this side can run: setup, contribution and authoring loops are never the project's task. */
function loopChoices(root: string): string[] {
  const role = installedRole(root);
  return listLoops(root).filter(
    (name) => loopSide(root, name) === role && loopKind(root, name) === "task",
  );
}
/** The parameters the chosen loop declares, or null while no valid loop is chosen. */
function declaredParameters(root: string, configuration: JsonObject): LoopParameter[] | null {
  const name = isRecord(configuration.loop) ? configuration.loop.name : undefined;
  if (typeof name !== "string" || !loopChoices(root).includes(name)) return null;
  try {
    return loopParameters(fs.readFileSync(loopDefinitionPath(root, name), "utf8"));
  } catch {
    return null;
  }
}
/**
 * The chosen loop's parameters with their defaults filled in, so the sheet shows
 * every one. A null is the owner clearing a value: it goes back to the default,
 * or goes away when it is no parameter of this loop.
 */
function withLoopDefaults(root: string, configuration: JsonObject): JsonObject {
  if (!isRecord(configuration.loop)) return configuration;
  const loop = configuration.loop;
  const set = Object.entries(isRecord(loop.params) ? loop.params : {}).filter(
    ([, value]) => value !== null,
  );
  const defaults = parameterDefaults(declaredParameters(root, configuration) ?? []);
  const params = { ...defaults, ...Object.fromEntries(set) };
  return { ...configuration, loop: { ...loop, params: params as JsonObject } };
}
/** CHOICES plus the ones the machine and the chosen loop fix. */
function choicesFor(root: string, configuration: JsonObject): Record<string, readonly unknown[]> {
  const { url } = serviceEnvironment();
  const choices: Record<string, readonly unknown[]> = {
    ...CHOICES,
    ...(url ? { "validation.service.public_url": [url] } : {}),
    "loop.name": loopChoices(root),
  };
  for (const parameter of declaredParameters(root, configuration) ?? [])
    if (parameter.type === "enum") choices[`loop.params.${parameter.name}`] = parameter.choices!;
  return choices;
}
/** What the sheet says about the loop and each of its parameters, from the loop's definition. */
function loopAdvice(root: string, configuration: JsonObject): Record<string, string> {
  const advice: Record<string, string> = {
    "loop.name":
      "The loop this project runs. The setup role finds one in .claude/loops that fits the owner's requirement, or has loop-editor generate one from it; its parameters then appear below.",
  };
  for (const parameter of declaredParameters(root, configuration) ?? []) {
    const range = [
      parameter.min === undefined ? "" : `min ${parameter.min}`,
      parameter.max === undefined ? "" : `max ${parameter.max}`,
    ]
      .filter(Boolean)
      .join(", ");
    advice[`loop.params.${parameter.name}`] =
      `${parameter.description} Default ${JSON.stringify(parameter.default)}${range ? ` (${range})` : ""}.`;
  }
  return advice;
}
const ADAPTER_CONTRACT =
  'The runner calls `python <CONTREJOUR_ADAPTER_DIR>/predict.py <inputs.jsonl> <predictions.jsonl>`. predict.py runs the deliverable in CONTREJOUR_ARTIFACT_REF as USAGE.md describes and writes one JSON line {"id", "prediction"} per input. The runner scores the predictions and writes CONTREJOUR_TEST_OUTPUT.';
/** CLAUDE.md blocks: the side's rules, written by apply; the environment, kept by the setup and memory roles. */
const ROLE_MARKERS = ["<!-- CONTREJOUR ROLE BEGIN -->", "<!-- CONTREJOUR ROLE END -->"] as const;
const ENVIRONMENT_MARKERS = [
  "<!-- CONTREJOUR ENVIRONMENT BEGIN -->",
  "<!-- CONTREJOUR ENVIRONMENT END -->",
] as const;
/** Every role reads CLAUDE.md, so the environment section stays short. */
const MAX_ENVIRONMENT_CHARS = 8000;
const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");

function get(object: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        isRecord(value) || Array.isArray(value) ? (value as JsonObject)[part] : undefined,
      object,
    );
}
/** Objects merge, arrays and scalars replace, null clears. */
function merge(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = merge(out[key], value);
  return out;
}
/** The worker's way to the validation service, as the sheet holds it. */
function connectionOf(configuration: JsonObject): { url: string; token: string } {
  return {
    url: String(get(configuration, "connection.url")),
    token: String(get(configuration, "connection.token")),
  };
}
function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (isRecord(value) && !Object.keys(value).length)
  );
}
function readJson(file: string): JsonObject {
  if (!fs.existsSync(file)) return {};
  const value = readStateFile<unknown>(file);
  if (!isRecord(value)) failA1("INVALID_VALUE", `${file} must hold a JSON object`);
  return value;
}

/** A folder name with no ASCII letters or digits (`项目`) still needs a usable skill name. */
export function projectSlug(projectRoot: string): string {
  const name = path.basename(path.resolve(projectRoot));
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
  return slug || `project-${crypto.createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
}
/** Where setup's environment step publishes the project's environment skill. */
export function environmentSkillDir(projectRoot: string): string {
  return path.join(skillsDir(projectRoot), `${projectSlug(projectRoot)}-environment`);
}
/** The only environment configuration file: keys and tokens the environment scripts read. */
export const environmentSecretsPath = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "environment.json");
export const setupDraftPath = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "setup-draft.json");
const statePath = (root: string): string =>
  path.join(path.resolve(root), ".contrejour", "setup-state.json");

function moduleDefaults(root: string, module: string): JsonObject {
  if (module === "loop") return { name: null, params: {} };
  if (module === "project") return { name: path.basename(path.resolve(root)), language: "zh" };
  if (module === "environment") return { secrets: {} };
  if (module === "connection") return { url: null, token: null };
  const installed = path.join(root, ".contrejour", "tester-config.json");
  const benchmark = fs.existsSync(installed)
    ? readJson(installed)
    : readJson(path.join(TEMPLATES, "TESTER_FACILITY_CONFIG_TEMPLATE.json"));
  return {
    pass_rule: { metric: null, op: ">=", threshold: null },
    benchmark,
    adapter_contract: ADAPTER_CONTRACT,
    runtime_environment: "",
    limits: DEFAULT_LIMITS,
    hidden_paths: [],
    agent: { model: null, permission_mode: PERMISSION_MODES[0], claude_command: ["claude"] },
    service: { host: "127.0.0.1", port: 8765, public_url: null },
  };
}
/**
 * A draft carries only the modules of the installed role. A value the machine
 * provides replaces the draft's, so the owner confirms what apply will use.
 */
function completeModules(root: string, configuration: JsonObject): JsonObject {
  const { url } = serviceEnvironment();
  const provided: JsonObject = url ? { validation: { service: { public_url: url } } } : {};
  const out: JsonObject = {};
  for (const module of ROLE_MODULES[installedRole(root)])
    out[module] = merge(
      merge(moduleDefaults(root, module), configuration[module] ?? {}),
      provided[module] ?? {},
    );
  return withLoopDefaults(root, out);
}
function loadDraft(root: string): SetupDraft {
  const file = setupDraftPath(root);
  if (!fs.existsSync(file))
    return { schema_version: 1, project_root: root, configuration: completeModules(root, {}) };
  const draft = readStateFile<SetupDraft>(file);
  if (draft.schema_version !== 1 || draft.project_root !== root || !isRecord(draft.configuration))
    failA1("IDENTITY_MISMATCH", "setup draft must identify this project and schema");
  return draft;
}
/** The task text is part of what the owner approves, so editing task.md needs a new confirmation. */
function draftDigest(root: string, draft: SetupDraft): string {
  return canonicalJsonSha256({
    draft: draft as unknown as JsonObject,
    task: readTask(root)?.sha256 ?? null,
  });
}

function recommendation(key: string, value: unknown, extra: Record<string, string> = {}): string {
  if (extra[key]) return extra[key];
  if (key === "validation.service.public_url" && serviceEnvironment().url)
    return "Taken from CONTREJOUR_URL on this machine; unset that variable to enter another address.";
  const advice: Record<string, string> = {
    "project.language": "zh for Chinese collaboration; en for English.",
    "environment.secrets":
      'Only keys and tokens the environment scripts need, as {"NAME": "value"}; {} when there are none. Hosts, paths and commands go into the environment section of CLAUDE.md, not here.',
    "connection.url": "The `url` the validator-setup role printed on the validator machine.",
    "connection.token":
      "The `token` the validator-setup role printed; .mcp.json will hold it, so keep that file out of git.",
    "validation.pass_rule.metric":
      "The benchmark metric each sample reports; one sample is one test, passed or failed by this rule.",
    "validation.pass_rule.op":
      "How a sample's value compares with the threshold for the test to pass.",
    "validation.pass_rule.threshold":
      "The per-sample value a test must reach, e.g. 1 for an exact-match score of 0 or 1.",
    "validation.adapter_contract":
      "Exactly how your runner calls CONTREJOUR_ADAPTER_DIR; the adapter-writer role writes each submission's adapter to this contract.",
    "validation.runtime_environment":
      "What a deliverable can rely on when the validator runs it: OS, Python and CUDA versions, GPU and memory, network access, time per input. The worker reads it through `requirements`, so name no test data.",
    "validation.hidden_paths":
      "Absolute paths of the hidden samples, labels and references; the leak reviewer checks feedback against them.",
    "validation.agent.model":
      "The Claude Code model of review sessions; null keeps the CLI's default. Each role may still set its own.",
    "validation.agent.permission_mode":
      "bypassPermissions lets the benchmark and the deliverable's install use the network and paths outside the project; auto has a classifier review each step and may refuse some.",
    "validation.agent.claude_command":
      'The Claude Code CLI the service starts review sessions with; it must run `--version`. On Windows use the native claude.exe, or ["node", "<npm prefix>\\\\node_modules\\\\@anthropic-ai\\\\claude-code\\\\cli.js"]: an npm claude.cmd cannot be started without a shell.',
    "validation.service.host":
      "0.0.0.0 when the worker connects directly over a private network; 127.0.0.1 when a tunnel or reverse proxy on this machine forwards to the service.",
    "validation.service.port":
      "The port the service listens on, e.g. 8765. On Windows, allow it through the firewall for a direct connection.",
    "validation.service.public_url":
      "The root address the worker machine reaches, without /mcp: http://<this machine's address>:<port>, or the address of the tunnel or proxy. Setting CONTREJOUR_URL on this machine fills it in.",
  };
  if (advice[key]) return advice[key];
  if (key.startsWith("validation.limits."))
    return "Keep the default unless the benchmark or upload size needs otherwise.";
  if (key.startsWith("validation.benchmark."))
    return "Pin the benchmark to exact revisions and Windows-runnable argv; it freezes once a submission is counted.";
  if (Array.isArray(value)) return "Edits replace the whole list; [] clears it.";
  return empty(value) ? "Supply the actual value." : "Keep this value unless it is wrong here.";
}
const isSecret = (key: string): boolean =>
  key === "connection.token" || key.startsWith("environment.secrets.");
/** The review sheet is shown in chat; `mask` keeps keys and tokens out of it. */
function rows(
  value: unknown,
  key: string,
  choices: Record<string, readonly unknown[]>,
  mask = false,
  advice: Record<string, string> = {},
): SetupReviewField[] {
  if (isRecord(value) && Object.keys(value).length)
    return Object.entries(value).flatMap(([k, v]) => rows(v, `${key}.${k}`, choices, mask, advice));
  if (Array.isArray(value) && value.some(isRecord))
    return value.flatMap((v, i) => rows(v, `${key}.${i}`, choices, mask, advice));
  if (mask && isSecret(key) && typeof value === "string" && value)
    return [
      {
        path: key,
        value: `…${value.slice(-4)}`,
        recommendation: recommendation(key, value, advice),
      },
    ];
  const options =
    choices[key.replace(/\.\d+(?=\.|$)/g, ".*")] ??
    (typeof value === "boolean" ? [true, false] : undefined);
  return [
    {
      path: key,
      value: value ?? null,
      ...(options ? { options } : {}),
      recommendation: recommendation(key, value, advice),
    },
  ];
}

/** The validation config this draft would freeze; the benchmark digest is filled in by apply. */
function draftValidationConfig(
  validation: JsonObject,
  benchmark: TesterFacilityConfig,
): ValidationConfig {
  const metricName = get(validation, "pass_rule.metric");
  if (!benchmark.metrics.some((metric) => metric.name === metricName))
    failA1(
      "INVALID_VALUE",
      `choose one of ${JSON.stringify(benchmark.metrics.map((metric) => metric.name))}`,
      "validation.pass_rule.metric",
    );
  const { benchmark: _benchmark, ...rest } = validation;
  return validateValidationConfig({
    ...rest,
    schema_version: 3,
    tester_config_sha256: testerFacilityConfigSha256(benchmark),
  });
}

export function validateSetupConfiguration(configuration: JsonObject, root: string): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const attempt = (field: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      add(field, (error as Error).message);
    }
  };
  const role = installedRole(root);
  const modules = ROLE_MODULES[role];
  for (const key of Object.keys(configuration))
    if (!modules.includes(key)) add(key, `not a ${role} module`);
  for (const module of modules) {
    const value = configuration[module];
    if (!isRecord(value)) {
      add(module, "module must be an object");
      continue;
    }
    for (const key of Object.keys(value))
      if (!MODULE_FIELDS[module]!.includes(key)) add(`${module}.${key}`, "unknown field");
    for (const row of rows(value, module, choicesFor(root, configuration))) {
      if (row.options && !empty(row.value) && !row.options.includes(row.value))
        add(row.path, `choose one of ${JSON.stringify(row.options)}`);
      if (
        typeof row.value === "string" &&
        /YOUR_|PINNED_COMMIT|PINNED_DATA_REVISION|\/absolute\/path/.test(row.value)
      )
        add(row.path, "replace the template placeholder");
    }
  }
  // The loop comes from the owner's requirement; its parameters are checked against its definition.
  const loop = configuration.loop;
  if (isRecord(loop)) {
    const options = loopChoices(root);
    if (empty(loop.name))
      add(
        "loop.name",
        options.length
          ? `choose the loop this project runs, one of ${JSON.stringify(options)}`
          : "no loop for this side is installed: have loop-editor generate one from the requirement",
      );
    else if (options.includes(String(loop.name))) {
      let declared: LoopParameter[] = [];
      attempt("loop.name", () => {
        declared = loopParameters(
          fs.readFileSync(loopDefinitionPath(root, String(loop.name)), "utf8"),
        );
      });
      const params = isRecord(loop.params) ? loop.params : {};
      for (const key of Object.keys(params))
        if (!declared.some((parameter) => parameter.name === key))
          add(`loop.params.${key}`, "not a parameter of this loop");
      // An enum's choices are checked with the sheet's options above.
      for (const parameter of declared)
        if (parameter.type !== "enum") {
          const problem = parameterProblem(parameter, params[parameter.name]);
          if (problem) add(`loop.params.${parameter.name}`, problem);
        }
    }
  }
  if (empty(get(configuration, "project.name"))) add("project.name", "required");
  const task = readTask(root);
  if (!task)
    add(
      "task.md",
      role === "worker"
        ? "fetch the validator's task with `setup-cli.js fetch-task` once the connection is set"
        : "write the task in task.md at the project root",
    );
  else if (role === "validator" && !isUtf8(task.bytes))
    add("task.md", "save it as UTF-8 text; the worker fetches it as text through the `task` tool");
  const secrets = get(configuration, "environment.secrets");
  if (!isRecord(secrets)) add("environment.secrets", "must be an object of NAME: value");
  else
    for (const [name, value] of Object.entries(secrets))
      if (
        value !== null &&
        (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || !value)
      )
        add(
          `environment.secrets.${name}`,
          "must be an environment-variable name with a text value",
        );

  if (role === "worker") {
    const url = get(configuration, "connection.url");
    // Validation setup prints `<public_url>/mcp`; a proxy may serve it under a sub-path.
    const parsed = typeof url === "string" && URL.canParse(url) ? new URL(url) : null;
    if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.pathname.endsWith("/mcp"))
      add("connection.url", "must be the validation service's http(s)://…/mcp URL");
    const token = get(configuration, "connection.token");
    if (typeof token !== "string" || token.length < 32)
      add("connection.token", "paste the token printed by the validation setup");
  }
  if (role === "validator" && isRecord(configuration.validation)) {
    const validation = configuration.validation;
    const provided = serviceEnvironment().token;
    if (provided !== undefined && provided.length < 32)
      add(
        "CONTREJOUR_TOKEN",
        "must be at least 32 characters; the worker's setup takes no shorter token",
      );
    const command = get(validation, "agent.claude_command");
    const problem = claudeCommandProblem(command);
    if (problem) add("validation.agent.claude_command", problem);
    const port = get(validation, "service.port");
    if (!(Number.isInteger(port) && Number(port) > 0 && Number(port) < 65_536))
      add("validation.service.port", "must be a TCP port number");
    let benchmark: TesterFacilityConfig | undefined;
    attempt("validation.benchmark", () => {
      benchmark = validateTesterFacilityConfig(validation.benchmark);
    });
    if (benchmark)
      attempt("validation", () => {
        const next = draftValidationConfig(validation, benchmark!);
        for (const hidden of next.hidden_paths)
          if (!fs.existsSync(hidden)) add("validation.hidden_paths", `${hidden} is missing`);
        const frozenFile = validationConfigPath(root);
        if (fs.existsSync(frozenFile) && countedSubmissions(root) > 0) {
          const frozen = validateValidationConfig(readStateFile(frozenFile));
          if (
            frozen.tester_config_sha256 !== next.tester_config_sha256 ||
            canonicalJsonSha256(frozen.pass_rule) !== canonicalJsonSha256(next.pass_rule)
          )
            add(
              "validation",
              "submissions were already tested against the frozen base benchmark and pass rule; start a new validator project to change them",
            );
        }
      });
  }
  return issues;
}

function markdown(review: SetupReview): string {
  const t = (en: string, zh: string) => (review.language === "en" ? en : zh);
  const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, "\\n");
  const lines = [
    t("# Contrejour Configuration Review", "# Contrejour 配置总览"),
    "",
    `${t("Role", "角色")}: ${review.role ?? t("unset", "待选择")}`,
    `${t("Configuration version", "配置版本")}: \`${review.configuration_sha256}\``,
    `${t("Editable draft", "可编辑草稿")}: \`${review.draft_path}\``,
    `${t("Task", "任务")}: \`${review.task.path}\` ${review.task.sha256 ? `(sha256 ${review.task.sha256.slice(0, 12)})` : t("(missing)", "（缺失）")}`,
    "",
    t(
      "Edit the draft or describe several changes at once, refresh, then confirm the whole sheet once.",
      "集中修改草稿或一次描述多项修改，刷新后整份确认一次。",
    ),
  ];
  for (const module of review.modules) {
    lines.push(
      "",
      `## ${module.title}`,
      "",
      t(
        "| Field | Current draft | Options | Recommendation |",
        "| 配置项 | 当前草稿 | 可选项 | 建议 |",
      ),
      "| --- | --- | --- | --- |",
    );
    for (const row of module.fields)
      lines.push(
        `| ${row.path} | ${row.value === null ? t("unset", "待填写") : cell(JSON.stringify(row.value))} | ${row.options ? cell(JSON.stringify(row.options)) : t("text/JSON", "文本/JSON")} | ${cell(row.recommendation)} |`,
      );
  }
  lines.push("", t("## Validation", "## 配置检查"), "");
  lines.push(
    ...(review.issues.length
      ? review.issues.map((issue) => `- ${issue.field}: ${issue.message}`)
      : [
          t(
            "- All fields pass; review the sheet, then confirm.",
            "- 全部字段通过检查；审阅后确认。",
          ),
        ]),
    "",
  );
  return lines.join("\n");
}

/** Refresh is the only draft writer; it never changes the project outside `.contrejour/`. */
export function refreshSetupReview(projectRoot: string, patch?: unknown): SetupReview {
  const root = path.resolve(projectRoot),
    stateFile = statePath(root);
  return withStateFileLock(stateFile, () => {
    const draft = loadDraft(root);
    if (patch !== undefined) {
      if (!isRecord(patch)) failA1("INVALID_VALUE", "configuration changes must be an object");
      draft.configuration = merge(draft.configuration, patch) as JsonObject;
    }
    draft.configuration = completeModules(root, draft.configuration);
    const digest = draftDigest(root, draft),
      previous = readJson(stateFile),
      issues = validateSetupConfiguration(draft.configuration, root),
      role = installedRole(root),
      language = get(draft.configuration, "project.language") === "en" ? "en" : "zh";
    const review: SetupReview = {
      role,
      language,
      draft_path: setupDraftPath(root),
      review_path: path.join(root, ".contrejour", "setup-review.md"),
      task: { path: taskPath(root), sha256: readTask(root)?.sha256 ?? null },
      configuration_sha256: digest,
      ready_to_confirm: issues.length === 0,
      confirmed: previous.confirmed_sha256 === digest && issues.length === 0,
      modules: ROLE_MODULES[role].map((id) => ({
        id,
        title: TITLES[id]!.split(" / ")[language === "en" ? 1 : 0]!,
        fields: rows(
          draft.configuration[id],
          id,
          choicesFor(root, draft.configuration),
          true,
          loopAdvice(root, draft.configuration),
        ),
      })),
      issues,
    };
    writeStateJsonAtomic(review.draft_path, draft);
    fs.writeFileSync(review.review_path, markdown(review));
    writeStateJsonAtomic(stateFile, {
      review_sha256: digest,
      confirmed_sha256: review.confirmed ? digest : null,
      status: review.confirmed ? "confirmed" : "review",
      issues,
    });
    return review;
  });
}

export function confirmSetupReview(
  projectRoot: string,
  reviewedDigest: string,
): { status: "confirmed"; configuration_sha256: string } {
  const root = path.resolve(projectRoot),
    stateFile = statePath(root);
  return withStateFileLock(stateFile, () => {
    const draft = loadDraft(root),
      digest = draftDigest(root, draft),
      state = readJson(stateFile);
    if (digest !== reviewedDigest || state.review_sha256 !== digest)
      failA1("SETUP_CONFIGURATION_CHANGED", "refresh and confirm the current configuration");
    const issues = validateSetupConfiguration(draft.configuration, root);
    if (issues.length) throw new SetupReviewIncompleteError(issues);
    writeStateJsonAtomic(stateFile, {
      ...state,
      status: "confirmed",
      confirmed_sha256: digest,
      confirmed_at: new Date().toISOString(),
    });
    return { status: "confirmed", configuration_sha256: digest };
  });
}

function confirmedDraft(root: string): SetupDraft {
  const draft = loadDraft(root),
    digest = draftDigest(root, draft),
    state = readJson(statePath(root));
  if (state.confirmed_sha256 !== digest || state.review_sha256 !== digest)
    failA1(
      "SETUP_CONFIGURATION_CONFIRMATION_REQUIRED",
      "the owner must confirm the current refreshed configuration first",
    );
  const issues = validateSetupConfiguration(draft.configuration, root);
  if (issues.length) throw new SetupReviewIncompleteError(issues);
  return draft;
}

/**
 * Worker only: copy the validator's task.md through the connection in the
 * draft. The draft need not be confirmed: the copy becomes part of what the
 * owner confirms next.
 */
export async function fetchTask(
  projectRoot: string,
): Promise<{ task: string; sha256: string; changed: boolean }> {
  const root = path.resolve(projectRoot);
  if (installedRole(root) !== "worker")
    failA1("WORKER_ONLY", "the validator writes task.md with the owner; the worker fetches it");
  const { configuration } = loadDraft(root);
  const issues = validateSetupConfiguration(configuration, root).filter((issue) =>
    issue.field.startsWith("connection."),
  );
  if (issues.length) throw new SetupReviewIncompleteError(issues);
  const { url, token } = connectionOf(configuration);
  const task = await fetchValidatorTask(url, token);
  // Refresh digests task.md under this lock.
  const changed = withStateFileLock(statePath(root), () => writeTask(root, task));
  return { task: taskPath(root), sha256: task.sha256, changed };
}

/** Replace the marked block, or append it, so the owner's own text around it survives re-runs. */
function replaceBlock(
  current: string,
  [begin, end]: readonly [string, string],
  body: string,
): string {
  const block = `${begin}\n${body.trim()}\n${end}`;
  const start = current.indexOf(begin),
    stop = current.indexOf(end);
  return start >= 0 && stop > start
    ? `${current.slice(0, start)}${block}${current.slice(stop + end.length)}`
    : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`;
}
function readBlock(current: string, [begin, end]: readonly [string, string]): string | null {
  const start = current.indexOf(begin),
    stop = current.indexOf(end);
  return start >= 0 && stop > start ? current.slice(start + begin.length, stop).trim() : null;
}
const claudeMdPath = (root: string): string => path.join(root, "CLAUDE.md");
const readClaudeMd = (root: string): string =>
  fs.existsSync(claudeMdPath(root)) ? fs.readFileSync(claudeMdPath(root), "utf8") : "";

/** The side's rules for every role, between the ROLE markers of CLAUDE.md. */
function writeRoleBlock(root: string, role: SetupRole): void {
  const template = fs
    .readFileSync(path.join(TEMPLATES, `ROLE_${role.toUpperCase()}.md`), "utf8")
    .replaceAll("{{PROJECT_SLUG}}", projectSlug(root));
  fs.writeFileSync(claudeMdPath(root), replaceBlock(readClaudeMd(root), ROLE_MARKERS, template));
}

/**
 * The environment section of CLAUDE.md: facts and lessons about this project's
 * machines that every role needs. The setup role writes it first and the memory
 * role keeps it; with no text this only reads it. Apply creates it empty.
 */
export function environmentNotes(
  projectRoot: string,
  text?: string,
): { file: string; text: string } {
  const root = path.resolve(projectRoot);
  installedRole(root);
  const current = readClaudeMd(root);
  if (text === undefined)
    return { file: claudeMdPath(root), text: readBlock(current, ENVIRONMENT_MARKERS) ?? "" };
  const body = text.trim();
  if (
    ENVIRONMENT_MARKERS.some((marker) => body.includes(marker)) ||
    ROLE_MARKERS.some((marker) => body.includes(marker))
  )
    failA1("INVALID_VALUE", "the environment notes must not contain Contrejour markers");
  if (body.length > MAX_ENVIRONMENT_CHARS)
    failA1(
      "INVALID_VALUE",
      `keep the environment notes under ${MAX_ENVIRONMENT_CHARS} characters: every role reads them`,
    );
  fs.writeFileSync(claudeMdPath(root), replaceBlock(current, ENVIRONMENT_MARKERS, body));
  return { file: claudeMdPath(root), text: body };
}
function ensureEnvironmentBlock(root: string): void {
  const current = readClaudeMd(root);
  if (readBlock(current, ENVIRONMENT_MARKERS) !== null) return;
  const placeholder = fs.readFileSync(path.join(TEMPLATES, "ENVIRONMENT.md"), "utf8");
  fs.writeFileSync(claudeMdPath(root), replaceBlock(current, ENVIRONMENT_MARKERS, placeholder));
}

/** Credentials live in these paths; keep them out of commits and deliverable zips. */
function ensureGitignored(root: string, entries: readonly string[]): void {
  const file = path.join(root, ".gitignore");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(file, `${current}${separator}${missing.map((entry) => `${entry}\n`).join("")}`);
}
/** Add or replace one entry of a JSON object file without touching its other entries. */
function mergeJsonEntry(file: string, key: string, name: string, entry: JsonObject): void {
  const current = readJson(file);
  const section = isRecord(current[key]) ? current[key] : {};
  writeStateJsonAtomic(file, { ...current, [key]: { ...section, [name]: entry } });
}

/** The settings this project's sessions start with: the side's task manager as the entry role. */
function writeProjectSettings(root: string, role: SetupRole): string {
  return writeEntryRole(root, TASK_MANAGER[role]);
}

/**
 * Why the configured Claude Code CLI cannot serve as the service's command, or
 * null when it runs. An npm `claude.cmd` cannot be started without a shell.
 */
function claudeCommandProblem(command: unknown): string | null {
  if (
    !Array.isArray(command) ||
    !command.length ||
    command.some((part) => typeof part !== "string" || !part)
  )
    return 'must be a non-empty argv list, e.g. ["claude"]';
  const [program, ...args] = command as string[];
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(program!))
    return 'a .cmd or .bat shim cannot be started without a shell: use claude.exe or ["node", "<path to cli.js>"]';
  const run = spawnSync(program!, [...args, "--version"], {
    env: standaloneEnvironment(process.env),
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if (run.error) return `cannot start ${program}: ${run.error.message}`;
  if (run.status !== 0)
    return `${command.join(" ")} --version failed: ${String(run.stderr).trim()}`;
  return null;
}

type SetupEnvironmentResult = {
  /** The loop this project runs; its name and parameter values are in .contrejour/loop.json. */
  loop: string;
  /** Where the setup role writes the environment skill's scripts; apply does not create it. */
  environment_skill_dir: string;
  environment_secrets: string;
  /** Project settings: the entry role, the hook registrations, background-session editing. */
  settings: string;
  /** The role a Claude Code session opened in the project runs as. */
  entry_role: string;
};

export type SetupApplyResult = SetupEnvironmentResult &
  (
    | { role: "worker"; mcp_config: string }
    | {
        role: "validator";
        validation_config: string;
        /** The command the owner runs, from the project root, and keeps running. */
        service_command: string[];
        worker_connection: { url: string; token: string };
        /** CONTREJOUR_URL and CONTREJOUR_TOKEN when this machine provided them. */
        from_environment: string[];
      }
  );

/** Apply the confirmed sheet: the side's own wiring, then the settings and CLAUDE.md blocks. */
export async function applySetup(projectRoot: string): Promise<SetupApplyResult> {
  const root = path.resolve(projectRoot),
    configuration = confirmedDraft(root).configuration,
    role = installedRole(root);
  if (role === "worker") {
    // The confirmed task.md must still be the one the validator judges against.
    const { url, token } = connectionOf(configuration);
    if ((await fetchValidatorTask(url, token)).sha256 !== readTask(root)?.sha256)
      failA1(
        "TASK_CHANGED",
        "the validator's task.md differs from this copy; run fetch-task, then review and confirm again",
      );
  }
  const secrets = Object.entries(get(configuration, "environment.secrets") as JsonObject);
  const secretsFile = environmentSecretsPath(root);
  // A null entry is a cleared secret.
  writeStateJsonAtomic(
    secretsFile,
    Object.fromEntries(secrets.filter(([, value]) => value !== null)),
  );
  fs.chmodSync(secretsFile, 0o600);
  ensureGitignored(root, role === "worker" ? [".contrejour/", ".mcp.json"] : [".contrejour/"]);
  let wiring:
    | { role: "worker"; mcp_config: string }
    | Omit<Extract<SetupApplyResult, { role: "validator" }>, keyof SetupEnvironmentResult>;
  if (role === "worker") {
    const file = path.join(root, ".mcp.json");
    const { url, token } = connectionOf(configuration);
    mergeJsonEntry(file, "mcpServers", "contrejour", {
      type: "http",
      url,
      headers: { Authorization: `Bearer ${token}` },
    });
    fs.chmodSync(file, 0o600);
    wiring = { role, mcp_config: file };
  } else {
    const validation = configuration.validation as JsonObject;
    if (countedSubmissions(root) > 0) assertBenchmarkIntact(root, readValidationConfig(root));
    const benchmark = await setupTesterFacility(root, validation.benchmark);
    const config = draftValidationConfig(validation, benchmark);
    writeStateJsonAtomic(validationConfigPath(root), config);
    const provided = serviceEnvironment();
    const token = ensureValidationToken(root, provided.token);
    wiring = {
      role,
      validation_config: validationConfigPath(root),
      service_command: [
        "node",
        ".contrejour/dist/tools/validation-cli.js",
        "serve",
        "--project",
        ".",
      ],
      worker_connection: { url: `${config.service.public_url}/mcp`, token },
      from_environment: [
        ...(provided.url ? ["CONTREJOUR_URL"] : []),
        ...(provided.token ? ["CONTREJOUR_TOKEN"] : []),
      ],
    };
  }
  // The loop and its parameters, as the owner confirmed them: the service and the task manager run it so.
  const loop = configuration.loop as JsonObject;
  writeStateJsonAtomic(selectedLoopPath(root), {
    schema_version: 1,
    loop: loop.name,
    params: loop.params,
  });
  const settings = writeProjectSettings(root, role);
  writeRoleBlock(root, role);
  ensureEnvironmentBlock(root);
  return {
    ...wiring,
    loop: String(loop.name),
    environment_skill_dir: environmentSkillDir(root),
    environment_secrets: secretsFile,
    settings,
    entry_role: TASK_MANAGER[role],
  } as SetupApplyResult;
}
