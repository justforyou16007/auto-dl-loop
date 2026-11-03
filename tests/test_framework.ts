/**
 * The framework layer: the loop editor's compile check, the role check, the hook
 * helper's actions and the worker's ledger and waiting helper. Run `npm run
 * build` first: hooks and checks run as the installed, compiled helpers do.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(source, "dist");
assert.ok(fs.existsSync(path.join(dist, "tools", "loop-check.js")), "run npm run build first");
const execFileAsync = promisify(execFile);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-framework-"));
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const role = (name: string, extra = "") =>
  `---\nname: ${name}\ndescription: ${name} for tests\nside: worker\n---\n\n# ${name}\n\n## Responsibility\nx\n\n## Inputs\nx\n\n## Output\nx\n\n## Writes\nnothing\n\n## Evaluation\nx\n${extra}`;
/** A project with the installed helpers, as the hook helper finds its project from its own path. */
function project(name: string): string {
  const root = path.join(sandbox, name);
  fs.cpSync(dist, path.join(root, ".contrejour", "dist"), { recursive: true });
  // The package's manifest, as the installer lays it out: its profiles, extension and hook actions.
  fs.copyFileSync(path.join(source, "project.json"), path.join(root, ".contrejour", "project.json"));
  // The installed runtime carries its one dependency next to dist/, as the installer lays it out.
  fs.cpSync(path.join(source, "node_modules", "commander"), path.join(root, ".contrejour", "node_modules", "commander"), { recursive: true });
  return root;
}
const checker = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [path.join(root, ".contrejour/dist/tools/loop-check.js"), ...args, "--project", root], { encoding: "utf8" });

try {
  // --- the library as projects of each side get it ---
  const library = spawnSync(process.execPath, [path.join(source, "tools/library-check.mjs")], { encoding: "utf8" });
  assert.equal(library.status, 0, library.stdout + library.stderr);
  const reports = JSON.parse(library.stdout);
  for (const side of ["worker", "validator"]) {
    assert.ok(reports[side].check.length > 0, `${side} has loops`);
    for (const loop of reports[side].check) assert.deepEqual([loop.loop, loop.ok, loop.stale, loop.defects], [loop.loop, true, false, []]);
    for (const entry of reports[side].roles) assert.deepEqual([entry.role, entry.defects], [entry.role, []]);
  }

  // --- the compile check finds call-flow defects without calling a model ---
  const loops = project("loops");
  for (const name of ["alpha", "beta"]) write(path.join(loops, `.claude/agents/${name}.md`), role(name));
  const definition = path.join(loops, ".claude/loops/sample.md");
  const script = path.join(loops, ".claude/workflows/sample.js");
  write(definition, '---\nname: sample\ndescription: d\nside: worker\ntriggers: record-trajectory\ncheck-args: [{"go": true}, {"go": false}]\n---\n\n# Sample\n');
  const good = [
    "export const meta = { name: 'sample', description: 'two roles', phases: [{ title: 'Run' }] }",
    "const ANSWER = { type: 'object', properties: { more: { type: 'boolean' }, kind: { type: 'string', enum: ['x', 'y'] } }, required: ['more', 'kind'] }",
    "phase('Run')",
    "if (args.go) {",
    "  for (let i = 0; i < 3; i += 1) {",
    "    const a = await agent(JSON.stringify({ i }), { agentType: 'alpha', schema: ANSWER })",
    "    if (!a.more) break",
    "  }",
    "}",
    "const done = await parallel([() => agent('{}', { agentType: 'beta', schema: ANSWER })])",
    "return done",
  ].join("\n");
  write(script, good);
  let run = checker(loops, "check", "sample");
  assert.equal(run.status, 1);
  assert.deepEqual(JSON.parse(run.stdout)[0].defects, []);
  assert.equal(JSON.parse(run.stdout)[0].stale, true, "a script without the definition's digest is stale");
  assert.equal(checker(loops, "stamp", "sample").status, 0);
  run = checker(loops, "check");
  assert.equal(run.status, 0, run.stdout);
  assert.deepEqual(JSON.parse(run.stdout)[0].roles_called, ["alpha", "beta"]);
  // Changing the definition makes the script stale until it is regenerated and stamped again.
  fs.appendFileSync(definition, "One more sentence.\n");
  assert.equal(JSON.parse(checker(loops, "check", "sample").stdout)[0].stale, true);
  checker(loops, "stamp", "sample");
  assert.equal(checker(loops, "check", "sample").status, 0);

  const defects = (text: string, triggers = "record-trajectory") => {
    write(definition, `---\nname: sample\ndescription: d\nside: worker\ntriggers: ${triggers}\n---\n\n# Sample\n`);
    write(script, text);
    checker(loops, "stamp", "sample");
    const report = JSON.parse(checker(loops, "check", "sample").stdout)[0];
    assert.equal(report.ok, false);
    return report.defects.join("\n");
  };
  const meta = "export const meta = { name: 'sample', description: 'd', phases: [{ title: 'Run' }] }\n";
  assert.match(defects(meta + "await agent('x', { agentType: 'gamma' })"), /unknown role "gamma"/);
  assert.match(defects(meta + "await agent('no role here')"), /a step names no role/);
  assert.match(defects(meta + "const t = Date.now()\nawait agent('x', { agentType: 'alpha' })"), /clock or randomness/);
  assert.match(defects(meta + "const r = Math.random()\nawait agent('x', { agentType: 'alpha' })"), /Math\.random\(\) is not allowed|clock or randomness/);
  assert.match(defects(meta + "while (true) await agent('x', { agentType: 'alpha' })"), /no working bound/);
  assert.match(defects(meta + "while (true) {}"), /did not finish/);
  assert.match(defects(meta + "phase('Hunt')\nawait agent('x', { agentType: 'alpha' })"), /phase "Hunt" is not declared/);
  assert.match(
    defects(meta + "const a = await agent('x', { agentType: 'alpha', schema: { type: 'object', properties: { never: { type: 'string', enum: ['n'] } } } })\nif (a.never === 'y') await agent('x', { agentType: 'beta' })"),
    /role "beta" is never reached/,
  );
  assert.match(defects("const name = 'sample'\nexport const meta = { name, description: 'd' }"), /must begin with `export const meta/);
  assert.match(defects("export const meta = { name: 'sample', description: `${1}` }"), /template substitution/);
  assert.match(defects("export const meta = { name: 'other', description: 'd' }\nawait agent('x', { agentType: 'alpha' })"), /meta\.name must be "sample"/);
  assert.match(defects(meta + "await agent('x', { agentType: 'alpha' })", "page-the-owner"), /unknown trigger "page-the-owner"/);

  // --- a loop's parameters: declared by its definition, read from args.params ---
  const parameterised = (parameters: string, body: string, checkArgs = "") => {
    write(definition, `---\nname: sample\ndescription: d\nside: worker\n${checkArgs}---\n\n# Sample\n\n## Parameters\n\n${parameters}\n\n## Waiting\n\nNone.\n`);
    write(script, meta + body);
    checker(loops, "stamp", "sample");
    return JSON.parse(checker(loops, "check", "sample").stdout)[0];
  };
  const rounds = '```json\n[{"name": "rounds", "type": "integer", "default": 2, "min": 1, "description": "Rounds to run."}]\n```';
  const usesRounds = "for (let i = 0; i < args.params.rounds; i += 1) await agent('x', { agentType: 'alpha' })";
  // The check runs the script with the declared defaults, as a project that keeps them would.
  let parameterReport = parameterised(rounds, usesRounds);
  assert.deepEqual(parameterReport.defects, []);
  assert.equal(parameterReport.ok, true);
  // The script and the definition must agree on which parameters exist.
  parameterReport = parameterised(rounds, `${usesRounds}\nconst p = args.params\nif (p.depth) await agent('x', { agentType: 'alpha' })`);
  assert.deepEqual(parameterReport.defects, []);
  parameterReport = parameterised(rounds, `${usesRounds}\nconst params = args.params\nif (params.depth) await agent('x', { agentType: 'alpha' })`);
  assert.match(parameterReport.defects.join("\n"), /uses parameter "depth", which the definition does not declare/);
  parameterReport = parameterised(rounds, "await agent('x', { agentType: 'alpha' })");
  assert.match(parameterReport.defects.join("\n"), /declares parameter "rounds", which the script never uses/);
  // A broken declaration is a defect of the definition.
  assert.match(parameterised("Just some text.", usesRounds).defects.join("\n"), /parameters: the Parameters section has no ```json block/);
  assert.match(parameterised('```json\n[{"name": "rounds", "type": "integer", "default": 99, "max": 5, "description": "d"}]\n```', usesRounds).defects.join("\n"), /parameter "rounds": its default must be at most 5/);
  assert.match(parameterised('```json\n[{"name": "rounds", "type": "integer", "description": "d"}]\n```', usesRounds).defects.join("\n"), /parameter "rounds": a default is required/);
  assert.match(parameterised('```json\n[{"name": "Rounds", "type": "integer", "default": 1, "description": "d"}]\n```', usesRounds).defects.join("\n"), /its name must be snake_case/);
  // A branch only other values reach is reached through a check sample that sets them.
  const deep = `${usesRounds}\nif (args.params.rounds > 2) await agent('x', { agentType: 'beta' })`;
  assert.match(parameterised(rounds, deep).defects.join("\n"), /role "beta" is never reached/);
  parameterReport = parameterised(rounds, deep, 'check-args: [{}, {"params": {"rounds": 3}}]\n');
  assert.deepEqual(parameterReport.defects, []);
  assert.deepEqual(parameterReport.roles_called, ["alpha", "beta"]);

  // --- a loop runs another loop as a step: the check runs the child under the same stub roles ---
  const nest = project("nest");
  for (const name of ["alpha", "beta", "gamma"]) write(path.join(nest, `.claude/agents/${name}.md`), role(name));
  const loopFiles = (name: string, body: string, extra = "") => {
    write(path.join(nest, `.claude/loops/${name}.md`), `---\nname: ${name}\ndescription: d\nside: worker\n${extra}---\n\n# ${name}\n`);
    write(path.join(nest, `.claude/workflows/${name}.js`), `export const meta = { name: '${name}', description: 'd', phases: [{ title: 'Run' }] }\n${body}`);
    checker(nest, "stamp", name);
  };
  const nestReport = (name: string) => JSON.parse(checker(nest, "check", name).stdout)[0];
  loopFiles("child", "phase('Inner')\nawait agent('{}', { agentType: 'gamma', phase: 'Inner' })\nreturn { done: true }");
  loopFiles("parent", "phase('Run')\nawait agent('{}', { agentType: 'alpha', phase: 'Run' })\nconst done = await workflow('child', {})\nif (done && done.waiting) return done\nreturn done");
  // The child's role is reached through the parent; the child's own phases are its own business.
  let nested = nestReport("parent");
  assert.deepEqual([nested.ok, nested.roles_called, nested.defects], [true, ["alpha", "gamma"], []]);
  loopFiles("parent", "await workflow('missing', {})\nawait agent('{}', { agentType: 'alpha' })");
  assert.match(nestReport("parent").defects.join("\n"), /unknown loop "missing"/);
  loopFiles("parent", "const name = 'child'\nawait workflow(name, {})\nawait agent('{}', { agentType: 'alpha' })");
  assert.match(nestReport("parent").defects.join("\n"), /a child loop must be named by a string/);
  // A child may not run a loop of its own: nesting is one level deep.
  loopFiles("child", "await workflow('parent', {})\nawait agent('{}', { agentType: 'gamma' })");
  loopFiles("parent", "await agent('{}', { agentType: 'alpha' })\nawait workflow('child', {})");
  assert.match(nestReport("parent").defects.join("\n"), /nesting is one level only/);
  // A loop says what it is for; setup offers only task loops.
  loopFiles("child", "await agent('{}', { agentType: 'gamma' })", "kind: sometimes\n");
  assert.match(nestReport("child").defects.join("\n"), /kind must be one of task, on-request/);
  loopFiles("child", "await agent('{}', { agentType: 'gamma' })", "kind: on-request\n");
  assert.equal(nestReport("child").ok, true);

  // --- drafts: nothing reaches .claude/ until the owner approves that exact version ---
  const drafts = path.join(nest, ".contrejour/drafts/narrow");
  write(path.join(drafts, "loops/narrow.md"), "---\nname: narrow\ndescription: d\nside: worker\nkind: task\n---\n\n# Narrow\n");
  write(path.join(drafts, "workflows/narrow.js"), "export const meta = { name: 'narrow', description: 'd', phases: [{ title: 'Run' }] }\nphase('Run')\nawait agent('{}', { agentType: 'fresh', phase: 'Run' })\nawait agent('{}', { agentType: 'alpha', phase: 'Run' })\n");
  // The draft is checked as the project would have it: its role does not exist yet, and its script is not stamped.
  let draft = JSON.parse(checker(nest, "draft", "--draft", "narrow").stdout);
  assert.equal(draft.ok, false);
  assert.deepEqual(draft.files, ["loops/narrow.md", "workflows/narrow.js"]);
  assert.match(draft.loops[0].defects.join("\n"), /unknown role "fresh"/);
  assert.equal(draft.loops[0].stale, true);
  assert.equal(checker(nest, "stamp", "--draft", "narrow", "narrow").status, 0);
  write(path.join(drafts, "agents/fresh.md"), role("fresh"));
  assert.equal(checker(nest, "roles", "--draft", "narrow").status, 0);
  assert.equal(checker(nest, "check", "--draft", "narrow").status, 0);
  draft = JSON.parse(checker(nest, "draft", "--draft", "narrow").stdout);
  assert.deepEqual([draft.ok, draft.files], [true, ["agents/fresh.md", "loops/narrow.md", "workflows/narrow.js"]]);
  // A draft never touches the project before it is installed.
  assert.equal(fs.existsSync(path.join(nest, ".claude/loops/narrow.md")), false);
  // Install takes only the approved version: a draft changed since, or one that does not check, stays out.
  const approved = draft.digest as string;
  fs.appendFileSync(path.join(drafts, "agents/fresh.md"), "One more line.\n");
  const changed = checker(nest, "install", "--draft", "narrow", "--digest", approved);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /DRAFT_CHANGED/);
  write(path.join(drafts, "agents/fresh.md"), role("fresh"));
  assert.equal(JSON.parse(checker(nest, "draft", "--draft", "narrow").stdout).digest, approved, "line endings and order do not change the digest");
  fs.writeFileSync(path.join(drafts, "agents/fresh.md"), role("fresh").replace(/\n/g, "\r\n"));
  assert.equal(JSON.parse(checker(nest, "draft", "--draft", "narrow").stdout).digest, approved);
  const broken = path.join(nest, ".contrejour/drafts/broken");
  write(path.join(broken, "agents/half.md"), "---\nname: half\n---\n");
  const halfDigest = JSON.parse(checker(nest, "draft", "--draft", "broken").stdout).digest;
  const refused = checker(nest, "install", "--draft", "broken", "--digest", halfDigest);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /DRAFT_CHECK_FAILED/);
  assert.equal(fs.existsSync(path.join(nest, ".claude/agents/half.md")), false);
  const installed = checker(nest, "install", "--draft", "narrow", "--digest", approved);
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(JSON.parse(installed.stdout).installed, [".claude/agents/fresh.md", ".claude/loops/narrow.md", ".claude/workflows/narrow.js"]);
  assert.equal(fs.existsSync(drafts), false);
  assert.equal(checker(nest, "check", "narrow").status, 0);
  assert.deepEqual(JSON.parse(checker(nest, "discard", "--draft", "broken").stdout), { draft: "broken", discarded: true });
  assert.equal(fs.existsSync(broken), false);
  assert.match(checker(nest, "draft", "--draft", "../escape").stderr, /lowercase letters, digits and hyphens/);

  // --- the role check ---
  write(path.join(loops, ".claude/agents/broken.md"), "---\nname: other\n---\n\n# Broken\n\n## Responsibility\nx\n");
  const roles = JSON.parse(checker(loops, "roles").stdout);
  assert.deepEqual(roles.find((entry: { role: string }) => entry.role === "alpha").defects, []);
  assert.deepEqual(roles.find((entry: { role: string }) => entry.role === "broken").defects, [
    'frontmatter name must be "broken"',
    "frontmatter description is required",
    "frontmatter side must be one of framework, worker, validator",
    'missing section "## Inputs"',
    'missing section "## Output"',
    'missing section "## Writes"',
    'missing section "## Evaluation"',
  ]);

  // --- the hook helper: record, notify, block; never break the session ---
  const validator = project("validator");
  const hook = (event: string, input: unknown) =>
    spawnSync(process.execPath, [path.join(validator, ".contrejour/dist/tools/hook.js"), event], {
      input: typeof input === "string" ? input : JSON.stringify(input),
      encoding: "utf8",
    });
  const submission = path.join(validator, ".contrejour/validation/submissions/s001");
  const statusFile = path.join(submission, "status.json");
  const record = (status: string) =>
    write(statusFile, JSON.stringify({ schema_version: 1, submission_id: "s001", status, created_at: "", updated_at: "", session: { id: "abc12345", session_id: "session-1", name: "contrejour-review-s001" } }));
  record("reviewing");
  const hidden = path.join(validator, "bench", "labels.json");
  write(hidden, "{}");
  write(path.join(validator, ".contrejour/validation/config.json"), JSON.stringify({
    schema_version: 3,
    pass_rule: { metric: "score", op: ">=", threshold: 1 },
    tester_config_sha256: "0".repeat(64),
    adapter_contract: "a",
    runtime_environment: "",
    limits: {},
    hidden_paths: [hidden],
    agent: { permission_mode: "bypassPermissions", claude_command: ["claude"] },
    service: { host: "127.0.0.1", port: 8765, public_url: "http://v" },
  }));
  const transcript = path.join(sandbox, "transcript.jsonl");
  write(transcript, '{"type":"user"}\n');
  const finished = {
    session_id: "session-1",
    agent_type: "inspector",
    agent_id: "a1",
    agent_transcript_path: transcript,
    background_tasks: [{ type: "workflow", status: "running", id: "w1", name: "submission-review" }],
  };
  // Nothing is declared yet: the event passes and nothing is written.
  assert.equal(hook("SubagentStop", finished).status, 0);
  assert.equal(fs.existsSync(path.join(validator, ".contrejour/trajectories")), false);
  write(path.join(validator, ".claude/loops/submission-review.md"), "---\nname: submission-review\ntriggers: record-trajectory, notify-stopped-review, guard-protected-paths\n---\n");
  assert.equal(hook("SubagentStop", finished).status, 0);
  const kept = path.join(validator, ".contrejour/trajectories/session-1/inspector-a1.jsonl");
  assert.equal(fs.readFileSync(kept, "utf8"), '{"type":"user"}\n');
  const indexed = JSON.parse(fs.readFileSync(path.join(validator, ".contrejour/trajectories/index.jsonl"), "utf8").trim());
  assert.deepEqual(
    [indexed.agent_type, indexed.submission, indexed.workflows, indexed.transcript],
    ["inspector", "s001", [{ id: "w1", name: "submission-review" }], path.join(".contrejour", "trajectories", "session-1", "inspector-a1.jsonl")],
  );
  // A stop while the loop runs is no news; a stop with the submission unfinished and nothing running is.
  const marker = path.join(submission, "session-stopped.json");
  hook("Stop", { session_id: "session-1", background_tasks: finished.background_tasks });
  assert.equal(fs.existsSync(marker), false);
  hook("Stop", { session_id: "session-other", background_tasks: [] });
  assert.equal(fs.existsSync(marker), false);
  hook("Stop", { session_id: "session-1", background_tasks: [] });
  assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).session_id, "session-1");
  fs.rmSync(marker);
  // Each stop also keeps the session's own transcript: the entry role's trajectory.
  const sessionTranscript = path.join(sandbox, "session.jsonl");
  write(sessionTranscript, '{"type":"assistant"}\n');
  hook("Stop", { session_id: "session-1", agent_type: "validator-task-manager", transcript_path: sessionTranscript, background_tasks: finished.background_tasks });
  assert.equal(fs.readFileSync(path.join(validator, ".contrejour/trajectories/session-1/validator-task-manager-session.jsonl"), "utf8"), '{"type":"assistant"}\n');
  record("tested");
  hook("Stop", { session_id: "session-1", background_tasks: [] });
  assert.equal(fs.existsSync(marker), false);
  // Writes to the benchmark, the hidden data and the helper's records are refused; the submission's own files are not.
  const denied = (file: string) => {
    const result = hook("PreToolUse", { cwd: validator, tool_name: "Write", tool_input: { file_path: file } });
    assert.equal(result.status, 0);
    return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : "allowed";
  };
  assert.equal(denied(".contrejour/validation/benchmark/layers/inc-001/labels.json"), "deny");
  assert.equal(denied(hidden), "deny");
  assert.equal(denied(path.join(validator, ".contrejour/tester-config.json")), "deny");
  assert.equal(denied(statusFile), "deny");
  // A role reading a deliverable must not be able to choose the next review's loop or weaken its parameters.
  assert.equal(denied(path.join(validator, ".contrejour/loop.json")), "deny");
  // What leaves for the shared library, and its leak check, are the helper's records.
  assert.equal(denied(path.join(validator, ".contrejour/contributions/leak-check.json")), "deny");
  assert.equal(denied(path.join(submission, "leak-review/1/feedback.md")), "deny");
  assert.equal(denied(path.join(submission, "inspection.md")), "allowed");
  assert.equal(denied(path.join(submission, "leak-review/1/result.json")), "allowed");
  // Malformed input never fails the session; it is logged.
  assert.equal(hook("SubagentStop", "{not json").status, 0);
  assert.match(fs.readFileSync(path.join(validator, ".contrejour/hook-errors.log"), "utf8"), /SubagentStop/);
  // A worker project has no validation records: nothing to notify or block.
  const worker = project("worker");
  write(path.join(worker, ".claude/loops/research-iteration.md"), "---\nname: research-iteration\ntriggers: record-trajectory, notify-stopped-review, guard-protected-paths\n---\n");
  const workerHook = (event: string, input: unknown) =>
    spawnSync(process.execPath, [path.join(worker, ".contrejour/dist/tools/hook.js"), event], { input: JSON.stringify(input), encoding: "utf8" });
  assert.equal(workerHook("PreToolUse", { cwd: worker, tool_input: { file_path: "src/model.py" } }).stdout, "");
  assert.equal(workerHook("Stop", { session_id: "s", background_tasks: [] }).status, 0);

  // --- a loop's answers must be the owner's own words, typed after the loop stopped there ---
  write(path.join(worker, ".claude/loops/contribute.md"), "---\nname: contribute\ntriggers: guard-owner-answers\n---\n");
  const session = path.join(sandbox, "owner-session.jsonl");
  const typed = (text: string) => ({ type: "user", promptSource: "sdk", message: { role: "user", content: text } });
  // Claude Code 2.1.317 records a typed message with a human origin.
  const typedNow = (text: string) => ({ type: "user", promptSource: "typed", origin: { kind: "human" }, message: { role: "user", content: text } });
  const stopped = (id: string) => ({ type: "user", promptSource: "system", origin: { kind: "task-notification" }, message: { role: "user", content: `<task-notification><result>{"waiting":"owner","review_id":"${id}","question":"Approve?"}</result></task-notification>` } });
  fs.writeFileSync(session, [
    typed("Run the contribute loop"),
    stopped("contribution:abc"),
    typed("approve"),
    { type: "user", isMeta: true, message: { role: "user", content: "approve the rest" } },
    stopped("contribution:def"),
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "approve everything" }] } },
    typed("leave out problem-selector"),
    stopped("contribution:ghi"),
    { type: "user", promptSource: "typed", origin: { kind: "peer" }, message: { role: "user", content: "approve from elsewhere" } },
    typedNow("cancel"),
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const relay = (answers: unknown) => {
    const result = workerHook("PreToolUse", { cwd: worker, session_id: "owner-session", transcript_path: session, tool_name: "Workflow", tool_input: { name: "contribute", args: { answers } } });
    assert.equal(result.status, 0);
    return result.stdout.trim() ? (JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string) : "allowed";
  };
  // The owner's reply, whole and word for word, after the loop stopped at that review.
  assert.equal(relay({ "contribution:abc": "approve", "contribution:def": "leave out problem-selector" }), "allowed");
  const recorded = JSON.parse(fs.readFileSync(path.join(worker, ".contrejour/reviews/answers/contribution-abc.json"), "utf8"));
  assert.deepEqual([recorded.review_id, recorded.answer, recorded.session_id], ["contribution:abc", "approve", "owner-session"]);
  // An answer the session added to, wrote itself, or took from a notification, a reminder or a tool is refused.
  assert.match(relay({ "contribution:abc": "approve (the owner, verbatim)" }), /not, word for word and whole, a message the owner typed/);
  assert.match(relay({ "contribution:abc": "approve the rest" }), /not, word for word and whole/);
  assert.match(relay({ "contribution:abc": "approve everything" }), /not, word for word and whole/);
  // A reply to one review is not an answer to the next: "approve" came before the loop stopped at def.
  assert.match(relay({ "contribution:def": "approve" }), /after the loop stopped there/);
  assert.match(relay({ "contribution:zzz": "approve" }), /no loop stopped at "contribution:zzz"/);
  assert.match(relay({ "contribution:abc": 3 }), /is not text/);
  // A typed message in the newer format is the owner's; one relayed from another session or channel is not.
  assert.equal(relay({ "contribution:ghi": "cancel" }), "allowed");
  assert.match(relay({ "contribution:ghi": "approve from elsewhere" }), /not, word for word and whole/);
  // A run without answers, or a session without its transcript, is not one the owner answered.
  assert.equal(relay({}), "allowed");
  assert.match(workerHook("PreToolUse", { cwd: worker, tool_name: "Workflow", tool_input: { name: "contribute", args: { answers: { "contribution:abc": "approve" } } } }).stdout, /transcript is not available/);
  // Only the hook writes the verified answers.
  const answerWrite = (file: string) => workerHook("PreToolUse", { cwd: worker, tool_name: "Write", tool_input: { file_path: file } }).stdout;
  assert.match(answerWrite(".contrejour/reviews/answers/contribution-abc.json"), /written only by the hook/);
  assert.equal(answerWrite(".contrejour/reviews/contribution-abc.md"), "");

  // --- the worker's ledger, requirements and waiting for a published result ---
  write(path.join(worker, ".contrejour/install.json"), JSON.stringify({ role: "worker" }));
  write(path.join(worker, "out/deliverable.zip"), "zip bytes");
  let queries = 0;
  const service = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk)).on("end", () => {
      const { params } = JSON.parse(body);
      const result =
        params.name === "requirements"
          ? { zip: { max_files: 50 }, submissions: { max: 4, remaining: 3 } }
          : {
              service: { state: "open", remaining: 3 },
              submission: queries++ < 1 ? { submission_id: "s001", status: "reviewing" } : { submission_id: "s001", status: "tested", verdict: "valid", tests: { total: 4, passed: 3, failed: 1 }, feedback: "Long answers are cut short." },
            };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(result) }] } }));
    });
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", () => resolve()));
  const port = (service.address() as { port: number }).port;
  write(path.join(worker, ".mcp.json"), JSON.stringify({ mcpServers: { contrejour: { type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${"t".repeat(40)}` } } } }));
  try {
    const cli = async (...args: string[]) =>
      JSON.parse((await execFileAsync(process.execPath, [path.join(worker, ".contrejour/dist/tools/worker-cli.js"), ...args, "--project", worker], { encoding: "utf8" })).stdout);
    const entry = await cli("ledger-add", "--submission", "s001", "--commit", "abc1234", "--zip", "out/deliverable.zip", "--idea", "idea:short-answers", "--problems", "problem:root, problem:cut-short", "--note", "local: 3/4 on the dev split");
    assert.deepEqual([entry.zip, entry.problems, entry.zip_sha256?.length], [path.join(worker, "out/deliverable.zip"), ["problem:root", "problem:cut-short"], 64]);
    await assert.rejects(cli("ledger-add", "--submission", "s001", "--commit", "abc1234", "--zip", "x"), /ALREADY_RECORDED/);
    await assert.rejects(cli("ledger-add", "--submission", "s002", "--commit", "not-a-hash", "--zip", "x"), /git hash/);
    const saved = await cli("requirements");
    assert.equal(saved.requirements.submissions.remaining, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(worker, ".contrejour/requirements.json"), "utf8")).requirements, saved.requirements);
    // wait returns only once the submission is final, and keeps the published result as received.
    const result = await cli("wait", "--submission", "s001", "--poll-seconds", "1");
    assert.deepEqual([result.status, result.tests], ["tested", { total: 4, passed: 3, failed: 1 }]);
    assert.equal(queries, 2);
    const shown = await cli("ledger", "--submission", "s001");
    assert.equal(shown.result.feedback, "Long answers are cut short.");
    assert.equal(shown.commit, "abc1234");
  } finally {
    await new Promise<void>((resolve) => service.close(() => resolve()));
  }
  // The ledger belongs to the worker.
  const elsewhere = project("validator-ledger");
  write(path.join(elsewhere, ".contrejour/install.json"), JSON.stringify({ role: "validator" }));
  assert.throws(
    () => execFileSync(process.execPath, [path.join(elsewhere, ".contrejour/dist/tools/worker-cli.js"), "ledger", "--project", elsewhere], { encoding: "utf8", stdio: "pipe" }),
    /WORKER_ONLY/,
  );
  console.log("framework: loop check with child loops and drafts, role check, hooks and worker ledger passed");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
