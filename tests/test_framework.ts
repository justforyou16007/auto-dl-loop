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
  `---\nname: ${name}\ndescription: ${name} for tests\n---\n\n# ${name}\n\n## Responsibility\nx\n\n## Inputs\nx\n\n## Output\nx\n\n## Writes\nnothing\n\n## Evaluation\nx\n${extra}`;
/** A project with the installed helpers, as the hook helper finds its project from its own path. */
function project(name: string): string {
  const root = path.join(sandbox, name);
  fs.cpSync(dist, path.join(root, ".contrejour", "dist"), { recursive: true });
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

  // --- the role check ---
  write(path.join(loops, ".claude/agents/broken.md"), "---\nname: other\n---\n\n# Broken\n\n## Responsibility\nx\n");
  const roles = JSON.parse(checker(loops, "roles").stdout);
  assert.deepEqual(roles.find((entry: { role: string }) => entry.role === "alpha").defects, []);
  assert.deepEqual(roles.find((entry: { role: string }) => entry.role === "broken").defects, [
    'frontmatter name must be "broken"',
    "frontmatter description is required",
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
  console.log("framework: loop check, role check, hooks and worker ledger passed");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
