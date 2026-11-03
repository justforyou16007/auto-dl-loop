import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  applySetup,
  confirmSetupReview,
  environmentNotes,
  fetchTask,
  refreshSetupReview,
  SetupReviewIncompleteError,
} from "../src/tools/setup.js";
import { readValidationConfig, validationTokenPath } from "../src/tools/validation/config.js";
import { startValidationService } from "../src/tools/validation/server.js";
import { createSubmission, updateSubmission, withSubmissionsLock } from "../src/tools/validation/store.js";
import { facilityConfig } from "./helpers/tester-facility-fixture.js";
import { environmentSkillDir, projectSlug } from "../src/tools/setup.js";
import { readSelectedLoop } from "../agent-loop-studio/src/tools/loops.js";
import { useLoop } from "../agent-loop-studio/src/tools/project-loop.js";

// The service address and token a machine may provide are set only where they are tested.
delete process.env.CONTREJOUR_URL;
delete process.env.CONTREJOUR_TOKEN;
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const execFileAsync = promisify(execFile);
// A stand-in for the Claude Code CLI the service starts review sessions with; setup only runs its --version.
const fakeClaude = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-config-cli-")), "claude.mjs");
fs.writeFileSync(fakeClaude, 'console.log("2.1.316 (Claude Code)");\n');
process.once("exit", () => fs.rmSync(path.dirname(fakeClaude), { recursive: true, force: true }));
const CLAUDE = [process.execPath, fakeClaude];
// A CLI that does not run: its --version exits with an error.
const brokenClaude = path.join(path.dirname(fakeClaude), "broken.mjs");
fs.writeFileSync(brokenClaude, 'console.error("not signed in"); process.exit(3);\n');
const installAs = (root: string, role: "worker" | "validator", extra: Record<string, unknown> = {}) => {
  fs.mkdirSync(path.join(root, ".contrejour"), { recursive: true });
  fs.writeFileSync(path.join(root, ".contrejour/install.json"), JSON.stringify({ role, ...extra }));
  // The package's manifest, as the installer lays it out: profiles, entry roles, extension.
  fs.copyFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../project.json"), path.join(root, ".contrejour/project.json"));
};
const librarySource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../library/loops");
/** The side's loops from the library, where the installer seeds them. */
const seedLoops = (root: string, side: "worker" | "validator") => {
  fs.mkdirSync(path.join(root, ".claude/loops"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude/workflows"), { recursive: true });
  for (const entry of fs.readdirSync(path.join(librarySource, side)))
    fs.copyFileSync(
      path.join(librarySource, side, entry),
      path.join(root, entry.endsWith(".md") ? ".claude/loops" : ".claude/workflows", entry),
    );
};
const ROLE_BEGIN = "<!-- CONTREJOUR ROLE BEGIN -->";
const ENVIRONMENT_BEGIN = "<!-- CONTREJOUR ENVIRONMENT BEGIN -->";
const issueFields = (root: string) => refreshSetupReview(root).issues.map((issue) => issue.field);
async function project(name: string, action: (root: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `contrejour-setup-${name}-`));
  try {
    await action(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** A validator project set up through the sheet, with its service running. */
async function startValidator(task: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-setup-service-"));
  process.once("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  installAs(root, "validator");
  seedLoops(root, "validator");
  fs.writeFileSync(path.join(root, "task.md"), task);
  const review = refreshSetupReview(root, {
    validation: {
      benchmark: facilityConfig(root),
      pass_rule: { metric: "score", op: ">=", threshold: 1 },
      hidden_paths: [path.join(root, "bench", "labels.json")],
      agent: { claude_command: CLAUDE },
      service: { public_url: "https://validation.example" },
    },
  });
  confirmSetupReview(root, review.configuration_sha256);
  const applied = await applySetup(root);
  if (applied.role !== "validator") throw new Error("unreachable");
  // The service runs the loop the owner chose, in the Studio or with project-cli.js use.
  useLoop(root, { name: "submission-review", params: {} });
  const service = await startValidationService(root, {
    port: 0,
    tick_ms: 3_600_000,
    log: () => {},
    dispatcher: async () => ({ id: "unused", session_id: "unused", name: "unused" }),
    sessions: { state: async () => "running", resume: async (session) => session },
  });
  return { root, url: `${service.url}/mcp`, token: applied.worker_connection.token, close: () => service.close() };
}

// Workers fetch task.md from this validator. Its BOM, CRLF line ends and non-ASCII text must survive.
const validator = await startValidator("﻿# Task\r\nAnswer the questions: café.\r\n");
const validatorTask = path.join(validator.root, "task.md");

// Worker: the installed role decides the modules; task.md comes from the validator and is part of what the owner approves.
await project("worker", async (root) => {
  assert.throws(() => refreshSetupReview(root), /install the project first/);
  installAs(root, "worker");
  let review = refreshSetupReview(root);
  assert.equal(review.role, "worker");
  assert.deepEqual(
    review.modules.map((module) => module.id),
    ["project", "environment", "connection"],
  );
  assert.ok(issueFields(root).includes("task.md"));
  assert.ok(issueFields(root).includes("connection.url"));

  // The sheet configures the machine; the loop the project runs is the owner's choice in the Studio.
  seedLoops(root, "worker");
  assert.equal(refreshSetupReview(root).issues.some((issue) => issue.field.startsWith("loop")), false);
  const fieldOf = (sheet: { modules: { fields: { path: string; value: unknown; options?: readonly unknown[]; recommendation: string }[] }[] }, name: string) =>
    sheet.modules.flatMap((module) => module.fields).find((row) => row.path === name);
  assert.equal(fieldOf(refreshSetupReview(root), "loop.name"), undefined);

  // The task is fetched through the connection in the sheet. A proxy may serve the service under a sub-path.
  await assert.rejects(fetchTask(root), SetupReviewIncompleteError);
  refreshSetupReview(root, { connection: { url: "http://127.0.0.1:1/proxy/abc/mcp", token: "t".repeat(43) } });
  assert.equal(issueFields(root).includes("connection.url"), false);
  await assert.rejects(fetchTask(root), /VALIDATION_UNREACHABLE: cannot reach/);
  refreshSetupReview(root, { connection: { url: validator.url } });
  await assert.rejects(fetchTask(root), /refused the token/);
  // The environment configuration holds only keys and tokens; null clears one.
  review = refreshSetupReview(root, {
    connection: { token: validator.token },
    environment: { secrets: { HF_TOKEN: "hf_secret", "not a name": "x" } },
  });
  const sheet = fs.readFileSync(review.review_path, "utf8");
  assert.equal(sheet.includes("hf_secret") || sheet.includes(validator.token), false);
  assert.ok(review.modules.flatMap((module) => module.fields).some((field) => field.value === "…cret"));
  assert.deepEqual(
    review.issues.map((issue) => issue.field),
    ["task.md", "environment.secrets.not a name"],
  );
  assert.deepEqual(await fetchTask(root), { task: path.join(root, "task.md"), sha256: sha256(validatorTask), changed: true });
  assert.deepEqual(fs.readFileSync(path.join(root, "task.md")), fs.readFileSync(validatorTask));
  assert.equal((await fetchTask(root)).changed, false);
  review = refreshSetupReview(root, { environment: { secrets: { "not a name": null } } });
  assert.deepEqual(review.issues, []);
  assert.equal(review.ready_to_confirm, true);
  await assert.rejects(applySetup(root), /SETUP_CONFIGURATION_CONFIRMATION_REQUIRED|confirm/);

  // The validator edits its task after review: apply refuses until the new one is fetched and confirmed.
  const reviewed = review.configuration_sha256;
  confirmSetupReview(root, reviewed);
  fs.appendFileSync(validatorTask, "Use English.\r\n");
  await assert.rejects(applySetup(root), /TASK_CHANGED/);
  assert.equal((await fetchTask(root)).changed, true);
  assert.throws(() => confirmSetupReview(root, reviewed), /refresh and confirm/);
  review = refreshSetupReview(root);
  assert.notEqual(review.configuration_sha256, reviewed);
  confirmSetupReview(root, review.configuration_sha256);
  assert.equal(refreshSetupReview(root).confirmed, true);

  fs.writeFileSync(
    path.join(root, ".mcp.json"),
    JSON.stringify({ mcpServers: { other: { command: "x" } } }),
  );
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Owner notes\n");
  // The owner's own settings and hooks survive; Contrejour owns only the entry role, its hooks and background editing.
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude/settings.json"),
    JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo owner" }] }] } }),
  );
  const applied = await applySetup(root);
  if (applied.role !== "worker") throw new Error("unreachable");
  assert.equal(applied.entry_role, "worker-task-manager");
  // No loop is chosen yet: configuring the machine does not choose one.
  assert.equal(applied.loop, null);
  assert.equal(fs.existsSync(path.join(root, ".contrejour/loop.json")), false);
  // The owner chooses it, with its values, the way the Studio does; configuring again leaves the choice as it is.
  useLoop(root, { name: "research-iteration", params: { informed_ideators: 2, ucb_c: 1.5 } });
  const expectedLoop = {
    schema_version: 1,
    loop: "research-iteration",
    params: { informed_ideators: 2, failures_only_ideators: 1, blank_ideators: 1, ucb_c: 1.5 },
  };
  assert.deepEqual(read(path.join(root, ".contrejour/loop.json")), expectedLoop);
  assert.deepEqual(readSelectedLoop(root), { loop: expectedLoop.loop, params: expectedLoop.params });
  assert.equal((await applySetup(root)).loop, "research-iteration");
  assert.deepEqual(read(path.join(root, ".contrejour/loop.json")), expectedLoop);
  assert.equal(applied.mcp_config, path.join(root, ".mcp.json"));
  assert.equal(applied.environment_skill_dir, environmentSkillDir(root));
  assert.match(applied.environment_skill_dir, /\.claude[/\\]skills[/\\].+-environment$/);
  // Apply names the environment skill; the setup role writes it.
  assert.equal(fs.existsSync(applied.environment_skill_dir), false);
  assert.deepEqual(read(applied.environment_secrets), { HF_TOKEN: "hf_secret" });
  assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), ".contrejour/\n.mcp.json\n");
  const mcp = read(path.join(root, ".mcp.json"));
  assert.deepEqual(mcp.mcpServers.other, { command: "x" });
  assert.deepEqual(mcp.mcpServers.contrejour, {
    type: "http",
    url: validator.url,
    headers: { Authorization: `Bearer ${validator.token}` },
  });
  // Re-applying replaces the blocks and hooks in place, once each.
  await applySetup(root);
  const settings = read(applied.settings);
  assert.equal(settings.agent, "worker-task-manager");
  assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
  assert.deepEqual(settings.worktree, { bgIsolation: "none" });
  const hook = (event: string) => ({ type: "command", command: process.execPath, args: [path.join(root, ".contrejour/dist/tools/hook.js"), event] });
  assert.deepEqual(settings.hooks.SubagentStop, [{ hooks: [hook("SubagentStop")] }]);
  assert.deepEqual(settings.hooks.Stop, [{ hooks: [{ type: "command", command: "echo owner" }] }, { hooks: [hook("Stop")] }]);
  // Before a write, and before a loop runs: the answers a session passes in must be the owner's own.
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: "Write|Edit|NotebookEdit|Workflow", hooks: [hook("PreToolUse")] }]);
  const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith("# Owner notes\n"));
  assert.equal(claude.split(ROLE_BEGIN).length, 2);
  assert.equal(claude.split(ENVIRONMENT_BEGIN).length, 2);
  assert.match(claude, /Contrejour: worker project/);
  assert.match(claude, /## Environment\n\nNot recorded yet/);
  assert.ok(claude.includes(`.claude/skills/${projectSlug(root)}-environment/SKILL.md`));
  assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), false);
  // The environment section is kept by the setup and memory roles; apply never overwrites it.
  const notes = path.join(root, "notes.md");
  fs.writeFileSync(notes, "## Environment\n\n- GPU: one A100 80 GB; batch 64 runs out of memory.\n");
  assert.equal(environmentNotes(root, fs.readFileSync(notes, "utf8")).text, fs.readFileSync(notes, "utf8").trim());
  await applySetup(root);
  assert.match(environmentNotes(root).text, /batch 64 runs out of memory/);
  assert.match(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), /# Owner notes\n/);
  assert.throws(() => environmentNotes(root, `${ROLE_BEGIN}\nx`), /markers/);
  assert.throws(() => environmentNotes(root, "x".repeat(9000)), /under 8000 characters/);

  // Changing the values later is the owner's choice again, at once; a value out of range changes nothing.
  useLoop(root, { name: "research-iteration", params: { informed_ideators: 2, blank_ideators: 3, ucb_c: 1.5 } });
  assert.equal(readSelectedLoop(root).params.blank_ideators, 3);
  assert.throws(() => useLoop(root, { name: "research-iteration", params: { informed_ideators: 7 } }), /at most 6/);
  assert.equal(readSelectedLoop(root).params.informed_ideators, 2);
  // Another loop takes its own defaults for what the owner leaves unset.
  fs.writeFileSync(
    path.join(root, ".claude/loops/narrow.md"),
    '---\nname: narrow\ndescription: one role\nside: worker\n---\n\n# Narrow\n\n## Parameters\n\n```json\n[{"name": "rounds", "type": "integer", "default": 4, "min": 1, "description": "How many rounds."}]\n```\n',
  );
  fs.writeFileSync(path.join(root, ".claude/workflows/narrow.js"), "export const meta = { name: 'narrow', description: 'd', phases: [] }\n");
  useLoop(root, { name: "narrow", params: {} });
  assert.deepEqual(readSelectedLoop(root), { loop: "narrow", params: { rounds: 4 } });
});

// Projects installed for Codex by an earlier release are refused, not migrated.
await project("codex-project", async (root) => {
  installAs(root, "validator", { provider: "codex" });
  assert.throws(() => refreshSetupReview(root), /no longer supports/);
});

assert.match(projectSlug(path.join(os.tmpdir(), "项目")), /^project-[0-9a-f]{8}$/);

// Validator: the benchmark is installed, the terms frozen, and the review sessions' Claude Code command checked.
await project("validator", async (root) => {
  installAs(root, "validator");
  seedLoops(root, "validator");
  fs.writeFileSync(path.join(root, "task.md"), "# Task\nAnswer the questions.\n");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "Owner instructions.\n");
  const benchmark = facilityConfig(root);
  let review = refreshSetupReview(root, {
    validation: { benchmark, pass_rule: { metric: "missing", threshold: 1 } },
  });
  assert.equal(review.role, "validator");
  assert.ok(review.issues.some((issue) => issue.field === "validation"));
  review = refreshSetupReview(root, {
    validation: {
      pass_rule: { metric: "score", op: ">=", threshold: 1 },
      hidden_paths: [path.join(root, "bench", "labels.json")],
      agent: { permission_mode: "full-access", claude_command: [process.execPath, brokenClaude] },
      service: { host: "0.0.0.0", port: 70_000, public_url: "https://validation.example/" },
    },
  });
  const field = (name: string) => review.modules.flatMap((module) => module.fields).find((row) => row.path === name);
  assert.deepEqual(field("validation.agent.permission_mode")?.options, ["bypassPermissions", "auto"]);
  // A mode that waits for approval, a CLI that does not run and a port that does not exist are reported together.
  assert.deepEqual(
    review.issues.map((issue) => issue.field),
    ["validation.agent.permission_mode", "validation.agent.claude_command", "validation.service.port", "validation"],
  );
  assert.match(review.issues.find((issue) => issue.field === "validation.agent.claude_command")!.message, /--version failed/);
  review = refreshSetupReview(root, {
    validation: { agent: { permission_mode: "bypassPermissions", claude_command: CLAUDE }, service: { port: 8765 } },
  });
  assert.deepEqual(review.issues, []);
  assert.throws(
    () => confirmSetupReview(root, "0".repeat(64)),
    /refresh and confirm/,
  );
  confirmSetupReview(root, review.configuration_sha256);
  const applied = await applySetup(root);
  assert.equal(applied.role, "validator");
  if (applied.role !== "validator") throw new Error("unreachable");
  assert.equal(applied.entry_role, "validator-task-manager");
  // The service reviews with the loop the owner chose and its values, not with anything configured here.
  assert.equal(applied.loop, null);
  useLoop(root, { name: "submission-review", params: { max_extension_rounds: 1 } });
  assert.deepEqual(readSelectedLoop(root).params.max_extension_rounds, 1);
  assert.deepEqual(applied.service_command, ["node", ".contrejour/dist/tools/validation-cli.js", "serve", "--project", "."]);
  assert.match(applied.environment_skill_dir, /\.claude[/\\]skills[/\\].+-environment$/);
  assert.equal(applied.worker_connection.url, "https://validation.example/mcp");
  assert.deepEqual(applied.from_environment, []);
  assert.equal(
    applied.worker_connection.token,
    fs.readFileSync(validationTokenPath(root), "utf8").trim(),
  );
  const config = readValidationConfig(root);
  assert.deepEqual(config.pass_rule, { metric: "score", op: ">=", threshold: 1 });
  assert.deepEqual(config.agent, { permission_mode: "bypassPermissions", claude_command: CLAUDE });
  assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), ".contrejour/\n");
  assert.equal(config.limits.max_submissions, 20);
  assert.ok(fs.existsSync(path.join(root, ".contrejour", "tester-config.json")));
  // The service binds where the sheet says; no Paseo service script exists any more.
  assert.deepEqual(config.service, { host: "0.0.0.0", port: 8765, public_url: "https://validation.example" });
  assert.equal(fs.existsSync(path.join(root, "paseo.json")), false);
  assert.equal(read(applied.settings).agent, "validator-task-manager");
  const instructions = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.ok(instructions.startsWith("Owner instructions.\n"));
  assert.match(instructions, /Contrejour: validator project/);
  assert.ok(instructions.includes(`.claude/skills/${projectSlug(root)}-environment/SKILL.md`));
  assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(root, ".mcp.json")), false);

  // Re-applying keeps the token the worker already holds.
  const again = await applySetup(root);
  if (again.role !== "validator") throw new Error("unreachable");
  assert.equal(again.worker_connection.token, applied.worker_connection.token);

  // Missing hidden data is reported.
  review = refreshSetupReview(root, {
    validation: { hidden_paths: [path.join(root, "nowhere")] },
  });
  assert.ok(review.issues.some((issue) => issue.field === "validation.hidden_paths"));
  review = refreshSetupReview(root, {
    validation: { hidden_paths: [path.join(root, "bench", "labels.json")] },
  });
  assert.deepEqual(review.issues, []);

  // Once a submission counts, the base benchmark and pass rule are frozen; limits may still change.
  const { record } = createSubmission(root, config, undefined);
  withSubmissionsLock(root, () => updateSubmission(root, record.submission_id, { status: "queued" }));
  review = refreshSetupReview(root, { validation: { pass_rule: { threshold: 0.5 } } });
  assert.ok(review.issues.some((issue) => issue.message.includes("frozen")));
  review = refreshSetupReview(root, {
    validation: { pass_rule: { threshold: 1 }, limits: { max_submissions: 30 } },
  });
  assert.deepEqual(review.issues, []);
  confirmSetupReview(root, review.configuration_sha256);
  const receiptFile = path.join(root, ".contrejour/tester-config.json.setup.json");
  const receipt = fs.readFileSync(receiptFile, "utf8");
  await applySetup(root);
  assert.equal(fs.readFileSync(receiptFile, "utf8"), receipt);
  fs.appendFileSync(path.join(root, "bench/runner.mjs"), "\n// changed benchmark\n");
  await assert.rejects(applySetup(root), /changed|mismatch/i);
  assert.equal(fs.readFileSync(receiptFile, "utf8"), receipt);
  try {
    confirmSetupReview(root, refreshSetupReview(root, { project: { name: "" } }).configuration_sha256);
    assert.fail("an incomplete sheet must not confirm");
  } catch (error) {
    assert.ok(error instanceof SetupReviewIncompleteError);
  }
});

// A validator machine that provides the service's address and token: setup uses them instead of the sheet's address and a new token.
await project("validator-environment", async (root) => {
  installAs(root, "validator");
  seedLoops(root, "validator");
  fs.writeFileSync(path.join(root, "task.md"), "# Task\nAnswer the questions.\n");
  const validation = {
    benchmark: facilityConfig(root),
    pass_rule: { metric: "score", op: ">=", threshold: 1 },
    hidden_paths: [path.join(root, "bench", "labels.json")],
    agent: { claude_command: CLAUDE },
    service: { public_url: "https://typed.example" },
  };
  process.env.CONTREJOUR_URL = "https://contrejour.example/";
  process.env.CONTREJOUR_TOKEN = "too short";
  try {
    let review = refreshSetupReview(root, { validation });
    const field = review.modules.flatMap((module) => module.fields).find((row) => row.path === "validation.service.public_url");
    assert.equal(field?.value, "https://contrejour.example");
    assert.deepEqual(field?.options, ["https://contrejour.example"]);
    assert.match(field!.recommendation, /CONTREJOUR_URL/);
    assert.deepEqual(review.issues.map((issue) => issue.field), ["CONTREJOUR_TOKEN"]);
    process.env.CONTREJOUR_TOKEN = "e".repeat(40);
    review = refreshSetupReview(root);
    assert.deepEqual(review.issues, []);
    confirmSetupReview(root, review.configuration_sha256);
    // An address that changes after confirmation needs a new review.
    process.env.CONTREJOUR_URL = "https://moved.example";
    await assert.rejects(applySetup(root), SetupReviewIncompleteError);
    confirmSetupReview(root, refreshSetupReview(root).configuration_sha256);
    const applied = await applySetup(root);
    if (applied.role !== "validator") throw new Error("unreachable");
    assert.deepEqual(applied.worker_connection, { url: "https://moved.example/mcp", token: "e".repeat(40) });
    assert.deepEqual(applied.from_environment, ["CONTREJOUR_URL", "CONTREJOUR_TOKEN"]);
    assert.equal(readValidationConfig(root).service.public_url, "https://moved.example");
    assert.equal(fs.readFileSync(validationTokenPath(root), "utf8"), `${"e".repeat(40)}\n`);
  } finally {
    delete process.env.CONTREJOUR_URL;
    delete process.env.CONTREJOUR_TOKEN;
  }
  // Without the variables the confirmed address stays and the token in place is kept.
  const again = await applySetup(root);
  if (again.role !== "validator") throw new Error("unreachable");
  assert.deepEqual(again.worker_connection, { url: "https://moved.example/mcp", token: "e".repeat(40) });
  assert.deepEqual(again.from_environment, []);
});

// Build a real archive, then exercise only extracted and installed files in unrelated directories.
await project("distribution", async (sandbox) => {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const archive = execFileSync(process.execPath, [path.join(source, "tools/pack-contrejour.mjs"), sandbox], { encoding: "utf8" }).trim();
  execFileSync("tar", ["-xzf", archive, "-C", sandbox]);
  const extracted = path.join(sandbox, "contrejour");
  const portable = path.join(sandbox, "moved archive");
  fs.renameSync(extracted, portable);
  const archiveManifest = read(path.join(portable, "manifest.json"));
  assert.equal(fs.existsSync(path.join(portable, "LICENSE")), true);
  assert.equal(archiveManifest.files.some((file: { path: string }) => file.path.startsWith("src/") || file.path.startsWith("agents/") || file.path.includes("server/src/")), false);
  assert.equal(fs.existsSync(path.join(portable, "skills/arxiv")), false);
  assert.equal(fs.existsSync(path.join(portable, "dist/tools/arxiv-fetch.js")), false);
  // Each side gets the framework roles and its own roles and loops, seeded from the libraries: the framework's, the community's and this package's.
  const libraryFiles = (dir: string) =>
    [
      ...new Set(
        [path.join(source, "agent-loop-studio"), path.join(source, "agent-loop-community"), source].flatMap((base) => {
          const folder = path.join(base, "library", dir);
          return fs.existsSync(folder) ? fs.readdirSync(folder).filter((file) => file !== ".gitkeep") : [];
        }),
      ),
    ].sort();
  for (const role of ["worker", "validator"] as const) {
    const root = path.join(sandbox, `${role} project`);
    const skillDir = ".claude/skills";
    const install = (...extra: string[]) => execFileSync("bash", [path.join(portable, "install.sh"), "--role", role, "--project", root, ...extra], { cwd: sandbox, encoding: "utf8" });
    install("--dry-run");
    assert.equal(fs.existsSync(root), false);
    assert.ok(install().includes("studio.js --project"), "the next step is the Studio");
    const manifest = read(path.join(root, ".contrejour/install.json"));
    // The hooks and the entry role are written at installation: every session, the first included, runs as the task manager.
    const installedSettings = read(path.join(root, ".claude/settings.json"));
    assert.equal(installedSettings.agent, `${role}-task-manager`);
    assert.equal(installedSettings.hooks.PreToolUse[0].matcher, "Write|Edit|NotebookEdit|Workflow");
    assert.ok(fs.existsSync(installedSettings.hooks.PreToolUse[0].hooks[0].args[0]));
    assert.equal(manifest.role, role);
    assert.equal(manifest.provider, "claude");
    assert.deepEqual(fs.readdirSync(path.join(root, skillDir)).sort(), ["browser-act", "research-wiki", "shared-references"]);
    assert.deepEqual(
      fs.readdirSync(path.join(root, ".claude/agents")).sort(),
      [...new Set([...libraryFiles("roles/framework"), ...libraryFiles(`roles/${role}`)])].sort(),
    );
    // A side's loop of the same name as the framework's takes its place.
    const loops = [...new Set([...libraryFiles("loops/framework"), ...libraryFiles(`loops/${role}`)])].sort();
    assert.deepEqual(fs.readdirSync(path.join(root, ".claude/loops")).sort(), loops.filter((file) => file.endsWith(".md")));
    assert.deepEqual(fs.readdirSync(path.join(root, ".claude/workflows")).sort(), loops.filter((file) => file.endsWith(".js")));
    // Owner decisions are a loop step; configuring the machine is a loop run on request.
    assert.ok(loops.includes("loop-authoring.js") && loops.includes("machine-config.js"));
    assert.ok(fs.existsSync(path.join(root, ".contrejour/project.json")), "the package's manifest is installed");
    assert.ok(fs.existsSync(path.join(root, ".claude/agents/owner-review.md")));
    assert.ok(fs.existsSync(path.join(root, ".claude/skills/shared-references/running-loops.md")));
    assert.ok(manifest.seeded.includes(`.claude/agents/${role}-task-manager.md`));
    // The installed loops pass the compile check and the roles their check.
    for (const command of ["check", "roles"]) {
      const checked = spawnSync(process.execPath, [path.join(root, ".contrejour/dist/tools/loop-check.js"), command, "--project", root], { encoding: "utf8" });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    }
    // Asynchronous, so the validation service in this process can answer the installed helper.
    const setup = async (...args: string[]) => JSON.parse((await execFileAsync(process.execPath, [path.join(root, ".contrejour/dist/tools/config-cli.js"), ...args, "--project", root], { cwd: sandbox, encoding: "utf8" })).stdout);
    const patch = path.join(root, "patch.json");
    if (role === "worker") {
      fs.writeFileSync(patch, JSON.stringify({ environment: { secrets: { API_KEY: "k" } }, connection: { url: validator.url, token: validator.token } }));
      assert.deepEqual((await setup("review", "--input", patch)).issues.map((issue: { field: string }) => issue.field), ["task.md"]);
      assert.equal((await setup("fetch-task")).sha256, sha256(validatorTask));
    } else {
      fs.writeFileSync(path.join(root, "task.md"), "An isolated installed task.\n");
      const benchmark = facilityConfig(root);
      fs.writeFileSync(patch, JSON.stringify({ validation: { benchmark, pass_rule: { metric: "score", op: ">=", threshold: 1 }, hidden_paths: [path.join(root, "bench/labels.json")], agent: { claude_command: CLAUDE }, service: { public_url: "http://validation.example:8790", port: 8790 } } }));
      await setup("review", "--input", patch);
    }
    const review = await setup("review");
    assert.deepEqual(review.issues, []);
    await setup("confirm", "--digest", review.configuration_sha256);
    const applied = await setup("apply");
    assert.equal(applied.role, role);
    assert.equal(applied.entry_role, `${role}-task-manager`);
    // Configuring the machine chose no loop; the owner chooses it, here from a terminal, with its defaults.
    assert.equal(applied.loop, null);
    const taskLoop = role === "worker" ? "research-iteration" : "submission-review";
    const used = JSON.parse(execFileSync(process.execPath, [path.join(root, ".contrejour/dist/tools/project-cli.js"), "use", "--project", root, "--loop", taskLoop], { encoding: "utf8" }));
    assert.equal(used.entry_role, `${role}-task-manager`);
    const chosen = read(path.join(root, ".contrejour/loop.json"));
    assert.equal(chosen.loop, taskLoop);
    assert.ok(fs.existsSync(path.join(root, ".claude/workflows", `${chosen.loop}.js`)));
    assert.ok(Object.keys(chosen.params).length > 0);
    assert.equal(applied.environment_skill_dir, path.join(root, skillDir, `${projectSlug(root)}-environment`));
    // Apply declares the expected skill output; it does not pretend the setup role has written it.
    assert.equal(fs.existsSync(applied.environment_skill_dir), false);
    // The settings name an installed entry role and an installed hook helper.
    const settings = read(path.join(root, ".claude/settings.json"));
    assert.ok(fs.existsSync(path.join(root, ".claude/agents", `${settings.agent}.md`)));
    assert.ok(fs.existsSync(settings.hooks.SubagentStop[0].hooks[0].args[0]));
    const instructions = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    assert.equal(instructions.includes("{{PROJECT_SLUG}}"), false);
    assert.ok(instructions.includes(`${skillDir}/${projectSlug(root)}-environment/SKILL.md`));
    // Every installed document the role block links to exists; the environment skill itself comes later.
    const links = [...instructions.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1]!);
    for (const link of links.filter((link) => !link.includes("-environment/")))
      assert.equal(fs.existsSync(path.join(root, link)), true, `Installed ${role} reference is missing: ${link}`);
    assert.ok(links.includes(`${skillDir}/shared-references/integration-contract.md`));
    // The environment section is written through the installed helper.
    const notes = path.join(root, "notes.md");
    fs.writeFileSync(notes, "## Environment\n\n- Data in /data/task.\n");
    assert.match((await setup("environment", "--input", notes)).text, /\/data\/task/);
    if (role === "worker") {
      assert.deepEqual(read(path.join(root, ".contrejour/environment.json")), { API_KEY: "k" });
    } else {
      assert.deepEqual(read(path.join(root, ".contrejour/validation/config.json")).agent, { permission_mode: "bypassPermissions", claude_command: CLAUDE });
      const status = JSON.parse(execFileSync(process.execPath, [path.join(root, ".contrejour/dist/tools/validation-cli.js"), "status", "--project", root], { cwd: sandbox, encoding: "utf8" }));
      assert.equal(status.service.state, "open");
    }
    const state = fs.readFileSync(path.join(root, ".contrejour/setup-state.json"), "utf8");
    execFileSync(process.execPath, [path.join(root, ".contrejour/dist/tools/research-wiki.js"), "init", path.join(root, "research-wiki")], { cwd: sandbox });
    const wiki = fs.readFileSync(path.join(root, "research-wiki/index.md"), "utf8");
    const generated = path.join(root, skillDir, `${projectSlug(root)}-environment/SKILL.md`);
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(generated, "owner generated\n");
    // Roles belong to the project once seeded: an update keeps an optimized role as it is.
    const optimized = path.join(root, ".claude/agents", `${role}-task-manager.md`);
    fs.appendFileSync(optimized, "\n## Changes\n\n- 2026-11-02: fixed a recurring step.\n");
    const optimizedText = fs.readFileSync(optimized, "utf8");
    // Upgrading a previous archive removes a retired managed skill only when Contrejour owns it.
    const retired = path.join(root, skillDir, "validation-review/SKILL.md");
    fs.mkdirSync(path.dirname(retired), { recursive: true });
    fs.writeFileSync(retired, "old managed review skill\n");
    manifest.files[`${skillDir}/validation-review/SKILL.md`] = crypto.createHash("sha256").update(fs.readFileSync(retired)).digest("hex");
    fs.writeFileSync(path.join(root, ".contrejour/install.json"), JSON.stringify(manifest));
    const helper = path.join(root, ".contrejour/dist/tools/config-cli.js");
    fs.unlinkSync(helper);
    const updated = JSON.parse(install().split("\nNext:")[0]!);
    assert.ok(updated.kept_project_versions.includes(`.claude/agents/${role}-task-manager.md`));
    assert.equal(fs.existsSync(helper), true);
    assert.equal(fs.existsSync(retired), false);
    assert.equal(fs.readFileSync(optimized, "utf8"), optimizedText);
    assert.equal(fs.readFileSync(path.join(root, ".contrejour/setup-state.json"), "utf8"), state);
    assert.equal(fs.readFileSync(path.join(root, "research-wiki/index.md"), "utf8"), wiki);
    assert.equal(fs.readFileSync(generated, "utf8"), "owner generated\n");
    const skill = path.join(root, skillDir, "research-wiki/SKILL.md");
    fs.appendFileSync(skill, "\nowner edit\n");
    const before = fs.readFileSync(path.join(root, ".contrejour/install.json"), "utf8");
    assert.throws(() => install(), /Local file differs/);
    assert.equal(fs.readFileSync(path.join(root, ".contrejour/install.json"), "utf8"), before);
    install("--force");
    assert.equal(fs.readFileSync(skill, "utf8").includes("owner edit"), false);
    assert.equal(fs.readFileSync(optimized, "utf8"), optimizedText);
    const switched = spawnSync("bash", [path.join(portable, "install.sh"), "--role", role === "worker" ? "validator" : "worker", "--project", root], { encoding: "utf8" });
    assert.equal(switched.status, 1);
    assert.match(switched.stderr, /keep its role/);
    const backend = spawnSync("bash", [path.join(portable, "install.sh"), "--role", role, "--project", root, "--provider", "codex"], { encoding: "utf8" });
    assert.equal(backend.status, 1);
    assert.match(backend.stderr, /Claude Code only; --provider was removed/);
  }
  // A project an earlier release installed for Codex is refused, not migrated.
  const codexProject = path.join(sandbox, "codex project");
  fs.mkdirSync(path.join(codexProject, ".contrejour"), { recursive: true });
  fs.writeFileSync(path.join(codexProject, ".contrejour/install.json"), JSON.stringify({ format: 1, role: "validator", provider: "codex", files: {} }));
  const codex = spawnSync("bash", [path.join(portable, "install.sh"), "--role", "validator", "--project", codexProject], { encoding: "utf8" });
  assert.equal(codex.status, 1);
  assert.match(codex.stderr, /installed for codex, which Contrejour no longer supports/);
  assert.equal(fs.existsSync(path.join(codexProject, ".claude")), false);
  // A project from the releases named ARL keeps its data under .aris/; it is refused, not installed next to.
  const arlProject = path.join(sandbox, "arl project");
  fs.mkdirSync(path.join(arlProject, ".aris"), { recursive: true });
  fs.writeFileSync(path.join(arlProject, ".aris/install.json"), JSON.stringify({ role: "worker", provider: "claude" }));
  const arl = spawnSync("bash", [path.join(portable, "install.sh"), "--role", "worker", "--project", arlProject], { encoding: "utf8" });
  assert.equal(arl.status, 1);
  assert.match(arl.stderr, /earlier release under \.aris\//);
  assert.equal(fs.existsSync(path.join(arlProject, ".contrejour")), false);
  // Installation from a prepared local Git checkout needs no download or archive tools, and records the checkout as the library.
  const localRepo = path.join(sandbox, "local Contrejour checkout");
  fs.mkdirSync(localRepo);
  execFileSync("git", ["init", "--quiet", localRepo]);
  for (const directory of ["dist", "skills", "templates", "library"])
    fs.cpSync(path.join(portable, directory), path.join(localRepo, directory), { recursive: true });
  for (const directory of ["distribution", "tools"])
    fs.cpSync(path.join(source, directory), path.join(localRepo, directory), { recursive: true, filter: (file) => path.basename(file) !== "releases" });
  // The framework's and the community's checkouts, as `git submodule update --init` leaves them.
  for (const [library, parts] of [
    ["agent-loop-studio", ["library", "skills", "distribution", "references", "project.json"]],
    ["agent-loop-community", ["library"]],
  ] as const)
    for (const part of parts)
      fs.cpSync(path.join(source, library, part), path.join(localRepo, library, part), { recursive: true });
  fs.copyFileSync(path.join(source, "package.json"), path.join(localRepo, "package.json"));
  for (const file of ["LICENSE", "SETUP_GUIDE.md", "SETUP_GUIDE_CN.md", "project.json"])
    fs.copyFileSync(path.join(source, file), path.join(localRepo, file));
  const forbiddenBin = path.join(sandbox, "forbidden commands");
  fs.mkdirSync(forbiddenBin);
  const invoked = path.join(forbiddenBin, "invoked");
  for (const command of ["curl", "wget", "npm", "npx", "tar"])
    fs.writeFileSync(path.join(forbiddenBin, command), '#!/usr/bin/env bash\nprintf "%s\\n" "$0" > "${BASH_SOURCE[0]%/*}/invoked"\nexit 99\n', { mode: 0o755 });
  const localEnv = {
    ...process.env,
    PATH: `${forbiddenBin}${path.delimiter}${process.env.PATH}`,
  };
  const localInstall = (entry: string, ...args: string[]) => spawnSync("bash", [path.join(localRepo, "distribution", entry), ...args], { cwd: sandbox, env: localEnv, encoding: "utf8" });
  assert.equal(localInstall("install-contrejour.sh", "--help").status, 0);
  const bootstrapped = path.join(sandbox, "bootstrap project");
  const missing = localInstall("install-contrejour.sh", "--role", "validator", "--project", bootstrapped);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /git submodule update --init, npm ci, .*npm run build/);
  assert.equal(fs.existsSync(bootstrapped), false);
  for (const dependency of ["commander", "typescript"])
    fs.cpSync(path.join(source, "node_modules", dependency), path.join(localRepo, "node_modules", dependency), { recursive: true });
  fs.renameSync(path.join(localRepo, "dist"), path.join(localRepo, "unbuilt-dist"));
  const unbuilt = localInstall("install-contrejour.sh", "--role", "validator", "--project", bootstrapped);
  assert.equal(unbuilt.status, 1);
  assert.match(unbuilt.stderr, /git submodule update --init, npm ci, .*npm run build/);
  assert.equal(fs.existsSync(bootstrapped), false);
  fs.renameSync(path.join(localRepo, "unbuilt-dist"), path.join(localRepo, "dist"));
  for (const role of ["worker", "validator"]) {
    const root = role === "validator" ? bootstrapped : path.join(sandbox, "local worker project");
    const preview = localInstall("install-contrejour.sh", "--role", role, "--project", root, "--dry-run");
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(fs.existsSync(root), false);
    const installed = localInstall("install-contrejour.sh", "--role", role, "--project", root);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(read(path.join(root, ".contrejour/install.json")).role, role);
    assert.equal(read(path.join(root, ".contrejour/install.json")).library, localRepo);
    execFileSync(process.execPath, [path.join(root, ".contrejour/dist/tools/config-cli.js"), "--help"], { cwd: sandbox });
  }
  const localSkill = path.join(localRepo, "skills/research-wiki/SKILL.md");
  fs.appendFileSync(localSkill, "\nLocal checkout update.\n");
  const updated = localInstall("install-contrejour.sh", "--role", "validator", "--project", bootstrapped);
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(fs.readFileSync(path.join(bootstrapped, ".claude/skills/research-wiki/SKILL.md"), "utf8"), /Local checkout update/);
  assert.equal(fs.existsSync(invoked), false, "Installer invoked a download, dependency installation or archive command");
  const changedSkill = path.join(portable, "skills/research-wiki/SKILL.md");
  fs.appendFileSync(changedSkill, "\nNew upstream instructions.\n");
  archiveManifest.version = "0.1.1";
  const changedEntry = archiveManifest.files.find((file: { path: string }) => file.path === "skills/research-wiki/SKILL.md");
  changedEntry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(changedSkill)).digest("hex");
  fs.writeFileSync(path.join(portable, "manifest.json"), JSON.stringify(archiveManifest));
  execFileSync("bash", [path.join(portable, "install.sh"), "--role", "validator", "--project", bootstrapped], { cwd: sandbox });
  assert.equal(read(path.join(bootstrapped, ".contrejour/install.json")).version, "0.1.1");
  // An update from the archive keeps the library the checkout recorded.
  assert.equal(read(path.join(bootstrapped, ".contrejour/install.json")).library, localRepo);
  assert.match(fs.readFileSync(path.join(bootstrapped, ".claude/skills/research-wiki/SKILL.md"), "utf8"), /New upstream instructions/);
  const damaged = path.join(portable, "dist/tools/config-cli.js");
  fs.appendFileSync(damaged, "\n// changed\n");
  const rejectedRoot = path.join(sandbox, "rejected");
  const rejected = spawnSync("bash", [path.join(portable, "install.sh"), "--role", "worker", "--project", rejectedRoot], { encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Archive integrity check failed/);
  assert.equal(fs.existsSync(rejectedRoot), false);
});

await validator.close();
console.log("test_setup: ok");
