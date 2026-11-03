/**
 * The Studio's chat with the authoring loops, against a stand-in `claude`: a
 * change asked for on the canvas starts loop-authoring in a background session
 * as the task manager; where the loop stops for the owner the page gets the
 * review note and the draft drawn as a flow; the owner's reply reaches the
 * session exactly as typed, with what they pointed at; and the end is reported.
 * Run `npm run build` first.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(fs.existsSync(path.join(source, "dist", "studio", "index.html")), "run npm run build first");
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-authoring-")));
const home = path.join(sandbox, "home");
fs.mkdirSync(home, { recursive: true });
// Claude Code keeps transcripts under the user's home: here, the sandbox's.
process.env.HOME = home;
process.env.USERPROFILE = home;

execFileSync(process.execPath, [path.join(source, "tools/pack-contrejour.mjs"), "--directory", path.join(sandbox, "package")], { stdio: "ignore" });
const root = path.join(sandbox, "worker");
execFileSync(process.execPath, [path.join(sandbox, "package/contrejour/install.mjs"), "--role", "worker", "--project", root, "--library", source], { stdio: "ignore" });

// A stand-in for the Claude Code command: it records what it is asked and lists the sessions it "started".
const state = path.join(sandbox, "claude-state.json");
const fake = path.join(sandbox, "claude");
fs.writeFileSync(
  fake,
  `#!${process.execPath}
const fs = require("fs");
const file = ${JSON.stringify(state)};
const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { sessions: [], calls: [] });
const save = (value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const args = process.argv.slice(2);
const data = read();
data.calls.push(args);
if (args[0] === "agents") {
  save(data);
  process.stdout.write(JSON.stringify(data.sessions.map((s) => ({ id: s.id, sessionId: s.sessionId, name: s.name, status: s.status, state: s.state }))));
} else if (args[0] === "stop") {
  const session = data.sessions.find((s) => s.id === args[1]);
  session.status = undefined;
  save(data);
} else if (args[0] === "--bg" && args[1] === "--resume") {
  const session = data.sessions.find((s) => s.sessionId === args[2]);
  session.status = "busy";
  session.messages.push(args[3]);
  save(data);
  process.stdout.write("backgrounded · " + session.id + "\\n");
} else if (args[0] === "--bg") {
  const id = (0xabc12345 + data.sessions.length).toString(16);
  data.sessions.push({ id, sessionId: id + "-0000-4000-8000-000000000000", name: args[args.indexOf("--name") + 1], agent: args[args.indexOf("--agent") + 1], status: "busy", state: "working", messages: [args.at(-1)] });
  save(data);
  process.stdout.write("backgrounded · " + id + "\\n");
} else {
  save(data);
}
`,
  { mode: 0o755 },
);
const fakeState = () => JSON.parse(fs.readFileSync(state, "utf8")) as {
  sessions: { id: string; sessionId: string; name: string; agent: string; status?: string; messages: string[] }[];
  calls: string[][];
};
const setStatus = (status: string | undefined) => {
  const data = fakeState();
  data.sessions[0]!.status = status;
  fs.writeFileSync(state, JSON.stringify(data));
};
/** What the loop returned, as Claude Code records it in the session's transcript. */
function notify(sessionId: string, result: unknown, at = new Date().toISOString()) {
  const folder = path.join(home, ".claude", "projects", root.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(folder, { recursive: true });
  const content = `<task-notification>\n<task-id>w1</task-id>\n<status>completed</status>\n<summary>Workflow finished</summary>\n<result>${JSON.stringify(result)}</result>\n</task-notification>`;
  fs.appendFileSync(
    path.join(folder, `${sessionId}.jsonl`),
    JSON.stringify({ type: "user", origin: { kind: "task-notification" }, promptSource: "system", timestamp: at, message: { role: "user", content } }) +
      "\n" +
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "The loop is waiting for you." }] } }) +
      "\n",
  );
}

const { serveStudio } = (await import(pathToFileURL(path.join(root, ".contrejour/dist/tools/studio.js")).href)) as {
  serveStudio(root: string, options?: { port?: number; session?: { claude_command: string[]; permission_mode: string } }): Promise<{ url: string; loginUrl: string; close(): Promise<void> }>;
};
function request(url: string, options: { method?: string; cookie?: string; body?: unknown; header?: boolean } = {}) {
  const target = new URL(url);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const outgoing = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: options.method ?? "GET",
        headers: {
          host: target.host,
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(options.header === false ? {} : { "x-contrejour-studio": "1" }),
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(payload);
  });
}

const studio = await serveStudio(root, { port: 0, session: { claude_command: [fake], permission_mode: "bypassPermissions" } });
try {
  const at = (relative: string) => new URL(relative, studio.url).href;
  const cookie = String((await request(studio.loginUrl)).headers["set-cookie"]).split(";")[0]!;
  const conversations = async () => JSON.parse((await request(at("api/authoring"), { cookie })).body).conversations;
  assert.deepEqual(await conversations(), []);

  // A change cannot be started by another site's form, nor without words.
  const base = { name: "research-iteration", source: "project" };
  const pointers = [
    { kind: "node", id: "s2", label: "Step 2 · Ideate" },
    { kind: "edge", id: "s1-s2", label: "Step 1 · Choose → Step 2 · Ideate" },
  ];
  assert.equal((await request(at("api/authoring"), { method: "POST", cookie, header: false, body: { base, text: "x" } })).status, 403);
  assert.equal((await request(at("api/authoring"), { method: "POST", cookie, body: { base, text: " " } })).status, 400);

  // --- the owner asks for a change on the canvas ---
  const started = await request(at("api/authoring"), {
    method: "POST",
    cookie,
    body: { loop: "loop-authoring", base, text: "Make the ideator count one parameter N, split 3:1:1", references: pointers },
  });
  assert.equal(started.status, 200, started.body);
  const session = fakeState().sessions[0]!;
  assert.equal(session.agent, "worker-task-manager", "the session runs as the task manager, which runs loops");
  const prompt = session.messages[0]!;
  assert.match(prompt, /^Run the loop-authoring loop with args \{/);
  const args = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1));
  assert.equal(
    args.description,
    "Change the existing loop `research-iteration` (of this project): Make the ideator count one parameter N, split 3:1:1\n\n[On the canvas: Step 2 · Ideate; Step 1 · Choose → Step 2 · Ideate]",
  );
  const startCall = fakeState().calls.find((call) => call[0] === "--bg")!;
  assert.deepEqual(startCall.slice(startCall.indexOf("--permission-mode"), startCall.indexOf("--permission-mode") + 2), ["--permission-mode", "bypassPermissions"]);
  let [status] = await conversations();
  assert.equal(status.state, "running");
  assert.equal(status.session, "abc12345");

  // --- the loop drafts, checks and stops for the owner ---
  const draftDir = path.join(root, ".contrejour/drafts/research-iteration");
  fs.mkdirSync(path.join(draftDir, "loops"), { recursive: true });
  fs.mkdirSync(path.join(draftDir, "agents"), { recursive: true });
  const definition = fs
    .readFileSync(path.join(root, ".claude/loops/research-iteration.md"), "utf8")
    .replace("**Ideate** —", "**Ideate** — `ideator-scout` scouts first; then");
  fs.writeFileSync(path.join(draftDir, "loops/research-iteration.md"), definition);
  fs.writeFileSync(
    path.join(draftDir, "agents/ideator-scout.md"),
    "---\nname: ideator-scout\ndescription: Scouts directions before the ideators\nside: worker\n---\n\n# Scout\n\n## Responsibility\nscout\n",
  );
  fs.mkdirSync(path.join(root, ".contrejour/reviews"), { recursive: true });
  fs.writeFileSync(path.join(root, ".contrejour/reviews/loop-research.md"), "# Review\n\nThe draft adds a scout before the ideators.\n");
  const longAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  // The conversation began a quarter of an hour ago, and the loop stopped for the owner ten minutes ago.
  const store = path.join(root, ".contrejour/studio/conversations.json");
  const begun = JSON.parse(fs.readFileSync(store, "utf8"));
  begun.conversations[0].sent[0].at = longAgo(15);
  fs.writeFileSync(store, JSON.stringify(begun));
  notify(session.sessionId, { waiting: "owner", review_id: "loop:research-iteration:0123abcd", question: "Approve, revise or cancel?", document: ".contrejour/reviews/loop-research.md" }, longAgo(10));
  setStatus("idle");
  [status] = await conversations();
  assert.equal(status.state, "waiting");
  assert.equal(status.review.review_id, "loop:research-iteration:0123abcd");
  assert.match(status.note, /adds a scout before the ideators/, "the note is read from the file the review names");
  assert.equal(status.draft.name, "research-iteration");
  assert.deepEqual(status.draft.roles, ["ideator-scout"]);
  const ideate = status.draft.flow.nodes.find((node: { title: string }) => node.title === "Ideate");
  assert.ok(ideate.roles.includes("ideator-scout"), "the draft is drawn with its new role");

  // --- the owner's reply reaches the session exactly, with what they pointed at ---
  const answered = await request(at("api/authoring/answer"), {
    method: "POST",
    cookie,
    body: { id: status.id, text: "Keep the scout but make it optional", references: [pointers[0]] },
  });
  assert.equal(answered.status, 200, answered.body);
  const after = fakeState();
  assert.ok(after.calls.some((call) => call[0] === "stop" && call[1] === "abc12345"), "an idle session is stopped before it is continued");
  assert.equal(after.sessions[0]!.messages.at(-1), "Keep the scout but make it optional\n\n[On the canvas: Step 2 · Ideate]");
  [status] = await conversations();
  assert.equal(status.state, "running", "a reply the loop has not answered yet is being worked on");
  // Had the session ended its turn without passing the reply on, the loop would still wait for one.
  const backdate = JSON.parse(fs.readFileSync(path.join(root, ".contrejour/studio/conversations.json"), "utf8"));
  const sentAt = backdate.conversations[0].sent.at(-1).at;
  backdate.conversations[0].sent.at(-1).at = longAgo(5);
  fs.writeFileSync(path.join(root, ".contrejour/studio/conversations.json"), JSON.stringify(backdate));
  setStatus("idle");
  [status] = await conversations();
  assert.deepEqual([status.state, status.reply_failed], ["waiting", true]);
  assert.equal(status.review.review_id, "loop:research-iteration:0123abcd");
  backdate.conversations[0].sent.at(-1).at = sentAt;
  fs.writeFileSync(path.join(root, ".contrejour/studio/conversations.json"), JSON.stringify(backdate));
  setStatus("busy");

  // owner-review may also hand the note itself rather than its file.
  notify(session.sessionId, { waiting: "owner", review_id: "loop:research-iteration:0123abcd", question: "Approve?", document: "# Review\n\nThe note itself." });
  setStatus("idle");
  [status] = await conversations();
  assert.equal(status.state, "waiting");
  assert.match(status.note, /The note itself/);
  await request(at("api/authoring/answer"), { method: "POST", cookie, body: { id: status.id, text: "approve", references: [] } });
  await request(at("api/authoring/answer"), { method: "POST", cookie, body: { id: status.id, text: "approve", references: [] } }).catch(() => undefined);

  // --- the loop ends ---
  notify(session.sessionId, { installed: "research-iteration" });
  setStatus("idle");
  [status] = await conversations();
  assert.equal(status.state, "done");
  assert.deepEqual(status.result, { installed: "research-iteration" });
  assert.equal(status.draft, null);

  // --- running one of the project's loops: the session is told the loop's name and nothing else ---
  const ran = await request(at("api/run"), { method: "POST", cookie, body: { name: "research-iteration" } });
  assert.equal(ran.status, 200, ran.body);
  const runSession = fakeState().sessions.at(-1)!;
  assert.deepEqual([runSession.agent, runSession.messages[0]], ["worker-task-manager", "Run the research-iteration loop."]);
  // How far the run is, as Claude Code's journal of the run says.
  const runFolder = path.join(home, ".claude", "projects", root.replace(/[^A-Za-z0-9]/g, "-"), runSession.sessionId, "subagents", "workflows", "wf_1");
  fs.mkdirSync(runFolder, { recursive: true });
  // Claude Code keeps the session's transcript beside the folder of its runs.
  fs.writeFileSync(path.join(runFolder, "..", "..", "..", "..", `${runSession.sessionId}.jsonl`), "");
  fs.writeFileSync(path.join(runFolder, "agent-a1.meta.json"), JSON.stringify({ agentType: "problem-selector", workflowPhase: "Choose" }));
  fs.writeFileSync(path.join(runFolder, "agent-a2.meta.json"), JSON.stringify({ agentType: "ideator-informed", workflowPhase: "Ideate" }));
  fs.writeFileSync(
    path.join(runFolder, "journal.jsonl"),
    [
      { type: "launched" },
      { type: "started", key: "k1", agentId: "a1", phase: "Choose" },
      { type: "result", key: "k1", agentId: "a1", result: "{}" },
      { type: "started", key: "k2", agentId: "a2", phase: "Ideate" },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  const running = (await conversations()).find((entry: { purpose: string }) => entry.purpose === "run");
  assert.equal(running.state, "running");
  assert.deepEqual(running.progress, [
    { phase: "Choose", role: "problem-selector", done: true },
    { phase: "Ideate", role: "ideator-informed", done: false },
  ]);
  assert.equal((await request(at("api/run"), { method: "POST", cookie, body: { name: "nope" } })).status, 404);

  // --- changing a role: role-authoring, built on the role named ---
  const roleChange = await request(at("api/authoring"), {
    method: "POST",
    cookie,
    body: { loop: "role-authoring", base: { name: "idea-assessor", source: "project" }, text: "Score novelty too", references: [] },
  });
  assert.equal(roleChange.status, 200, roleChange.body);
  const rolePrompt = fakeState().sessions.at(-1)!.messages[0]!;
  assert.match(rolePrompt, /^Run the role-authoring loop with args/);
  assert.equal(
    JSON.parse(rolePrompt.slice(rolePrompt.indexOf("{"), rolePrompt.lastIndexOf("}") + 1)).description,
    "Change the existing role `idea-assessor` (of this project): Score novelty too",
  );

  // A reply needs a conversation and words.
  assert.equal((await request(at("api/authoring/answer"), { method: "POST", cookie, body: { id: status.id, text: "" } })).status, 400);
  assert.equal((await request(at("api/authoring/answer"), { method: "POST", cookie, body: { id: "nope", text: "x" } })).status, 404);
} finally {
  await studio.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log("studio authoring: ok");
