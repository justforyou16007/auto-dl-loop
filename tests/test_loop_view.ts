/**
 * The owner's page of a project's loops, as the owner sees it: projects laid out
 * by the real installer from the real package, the page's data, the page written
 * as one file and the page served on this machine. Run `npm run build` first.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(fs.existsSync(path.join(source, "dist", "tools", "loop-view.js")), "run npm run build first");
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-view-")));
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const read = (file: string) => fs.readFileSync(file, "utf8");

interface Step {
  kind: string;
  number: number | null;
  title: string;
  text: string;
  roles: string[];
  loops: string[];
  group: string | null;
}
interface Loop {
  name: string;
  description: string;
  source: string;
  side: string;
  kind: string;
  chosen: boolean;
  parameters: { name: string; default: unknown; value?: unknown }[];
  steps: Step[];
  roles: string[];
  children: string[];
  check: { ok: boolean; defects: string[] } | null;
  runs: { id: string; started: string; ended: string; roles: { role: string }[]; submissions: string[] }[];
}
interface View {
  project: { side: string; language: string; chosen: { loop: string } | null; live: boolean };
  loops: Loop[];
  roles: { name: string; source: string; description: string; body: string; used_by: string[] }[];
}
const loopOf = (view: View, name: string) => {
  const loop = view.loops.find((entry) => entry.name === name);
  assert.ok(loop, `the page shows ${name}`);
  return loop;
};

// The real installer, from the real package, with this checkout as the library.
execFileSync(process.execPath, [path.join(source, "tools/pack-contrejour.mjs"), "--directory", path.join(sandbox, "package")], { stdio: "ignore" });
const installer = path.join(sandbox, "package/contrejour/install.mjs");
function install(name: string, role: "worker" | "validator"): string {
  const root = path.join(sandbox, name);
  execFileSync(process.execPath, [installer, "--role", role, "--project", root, "--library", source], { stdio: "ignore" });
  return root;
}
const worker = install("worker", "worker");
const validator = install("validator", "validator");
const helper = (root: string) => path.join(root, ".contrejour/dist/tools/loop-view.js");
// The page is a helper the package ships: a project imports it from its own installed copy.
const viewer = (await import(pathToFileURL(helper(worker)).href)) as {
  collectView(root: string, live?: boolean): Promise<View>;
  parseSteps(body: string, roles: Set<string>, loops: Set<string>): Step[];
  serveLoops(root: string, options?: { host?: string; port?: number }): Promise<{ url: string; close(): Promise<void> }>;
};
const { splitScript } = (await import(pathToFileURL(path.join(worker, ".contrejour/dist/tools/loop-check.js")).href)) as {
  splitScript(text: string): { meta: { description?: string } };
};

/** A request with any Host header, as a browser or another site's page would send it. */
function request(url: string, options: { method?: string; host?: string } = {}) {
  const target = new URL(url);
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const outgoing = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname, method: options.method ?? "GET", headers: { host: options.host ?? target.host } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

try {
  // --- a step list as a loop definition writes it ---
  const steps = viewer.parseSteps(
    [
      "The round is split in two; `alpha` waits in between.",
      "",
      "`build`:",
      "",
      "1. **Choose** — `alpha` picks the problems.",
      "   On a second line, `beta` records them.",
      "2. **Run** — runs the loop `child` as a step, then `gamma`, which is not installed.",
      "",
      "`record`:",
      "",
      "3. Record the result, a step without a title.",
    ].join("\n"),
    new Set(["alpha", "beta"]),
    new Set(["child"]),
  );
  assert.deepEqual(
    steps.map((step) => [step.kind, step.number, step.title, step.group, step.roles, step.loops]),
    [
      ["note", null, "", null, ["alpha"], []],
      ["step", 1, "Choose", "build", ["alpha", "beta"], []],
      ["step", 2, "Run", "build", [], ["child"]],
      ["step", 3, "", "record", [], []],
    ],
  );
  assert.match(steps[1]!.text, /^`alpha` picks the problems\.\nOn a second line/);

  // --- the worker: its loops, the chosen one with this project's values, the roles each step names ---
  write(
    path.join(worker, ".contrejour/loop.json"),
    JSON.stringify({ schema_version: 1, loop: "research-iteration", params: { informed_ideators: 2, failures_only_ideators: 1, blank_ideators: 1, ucb_c: 1.5 } }),
  );
  const description = splitScript(read(path.join(worker, ".claude/workflows/research-iteration.js"))).meta.description;
  assert.ok(description);
  const transcriptMarker = "TRANSCRIPT-TEXT-THE-PAGE-NEVER-READS";
  write(path.join(worker, ".contrejour/trajectories/t1.jsonl"), JSON.stringify({ message: transcriptMarker }) + "\n");
  const entry = (at: string, role: string, run: { id: string; name: string }, submission: string | null = null) =>
    JSON.stringify({ at, session_id: "s1", agent_type: role, agent_id: role, workflows: [run], submission, transcript: ".contrejour/trajectories/t1.jsonl" });
  // The index names a run by its script's description or by its loop's name; runs of loops the project lacks are skipped.
  const round = { id: "wf_round", name: description! };
  const record = { id: "wf_record", name: "research-iteration" };
  write(
    path.join(worker, ".contrejour/trajectories/index.jsonl"),
    [
      entry("2026-11-03T02:10:00.000Z", "problem-selector", round),
      entry("2026-11-03T02:14:00.000Z", "ideator-informed", round),
      entry("2026-11-03T02:15:00.000Z", "ideator-informed", round),
      "not json",
      entry("2026-11-03T02:40:00.000Z", "worker-task-manager", round, "s001"),
      entry("2026-11-03T05:00:00.000Z", "worker-memory", record, "s001"),
      entry("2026-11-03T05:05:00.000Z", "trajectory-optimizer", record, "s001"),
      entry("2026-11-03T06:00:00.000Z", "implementer", { id: "wf_other", name: "a loop this project does not have" }),
    ].join("\n") + "\n",
  );
  // A loop the project removed is still shown, from the library, unchecked.
  fs.rmSync(path.join(worker, ".claude/loops/role-authoring.md"));
  fs.rmSync(path.join(worker, ".claude/workflows/role-authoring.js"));

  const view = await viewer.collectView(worker);
  assert.equal(view.project.side, "worker");
  assert.equal(view.project.language, "zh");
  assert.equal(view.project.chosen?.loop, "research-iteration");
  assert.equal(view.project.live, false);
  for (const loop of view.loops.filter((entry) => entry.source === "project"))
    assert.deepEqual([loop.name, loop.check?.ok, loop.check?.defects], [loop.name, true, []]);
  assert.deepEqual(
    Object.fromEntries(view.loops.map((loop) => [loop.name, [loop.kind, loop.source]])),
    {
      "research-iteration": ["task", "project"],
      "library-contribution": ["on-request", "project"],
      "loop-authoring": ["on-request", "project"],
      "machine-config": ["on-request", "project"],
      "role-authoring": ["on-request", "library"],
    },
  );
  assert.equal(loopOf(view, "role-authoring").check, null);
  assert.ok(!view.loops.some((loop) => loop.side === "validator"), "a worker sees no validator loop");
  assert.ok(!view.roles.some((role) => role.name === "validator-task-manager"), "a worker sees no validator role");

  const research = loopOf(view, "research-iteration");
  assert.equal(research.chosen, true);
  const ideators = research.parameters.find((parameter) => parameter.name === "informed_ideators");
  assert.deepEqual([ideators?.default, ideators?.value], [3, 2]);
  const numbered = research.steps.filter((step) => step.kind === "step");
  assert.ok(numbered.length > 3);
  assert.deepEqual(
    numbered.map((step) => step.number),
    numbered.map((_, index) => index + 1),
  );
  const installedRoles = new Set(fs.readdirSync(path.join(worker, ".claude/agents")).map((file) => file.replace(/\.md$/, "")));
  for (const role of numbered.flatMap((step) => step.roles)) assert.ok(installedRoles.has(role), `${role} is installed`);
  assert.ok(research.roles.includes("implementer"));
  // The steps where the loop stops for the owner are the ones owner-review does.
  const contribution = loopOf(view, "library-contribution");
  assert.ok(contribution.steps.some((step) => step.roles.includes("owner-review")));
  assert.ok(view.roles.find((role) => role.name === "owner-review")?.used_by.includes("library-contribution"));
  assert.ok(loopOf(view, "machine-config").children.includes("loop-authoring"));

  // Runs, newest first: which roles finished in each (a role that ran twice, twice) and the submission.
  assert.deepEqual(
    research.runs.map((run) => [run.id, run.started, run.ended, run.roles.map((finished) => finished.role), run.submissions]),
    [
      ["wf_record", "2026-11-03T05:00:00.000Z", "2026-11-03T05:05:00.000Z", ["worker-memory", "trajectory-optimizer"], ["s001"]],
      ["wf_round", "2026-11-03T02:10:00.000Z", "2026-11-03T02:40:00.000Z", ["problem-selector", "ideator-informed", "ideator-informed", "worker-task-manager"], ["s001"]],
    ],
  );
  assert.ok(!JSON.stringify(view).includes(transcriptMarker), "the page never reads a transcript");

  write(path.join(worker, ".contrejour/setup-draft.json"), JSON.stringify({ configuration: { project: { language: "en" } } }));
  assert.equal((await viewer.collectView(worker)).project.language, "en");

  // --- the page written as one file: its data intact, nothing loaded from elsewhere ---
  const hostile = "ends early </script><script>alert(1)</script>";
  const separated = "a line separator " + String.fromCharCode(0x2028) + " in the text";
  write(
    path.join(worker, ".claude/agents/odd-role.md"),
    `---\nname: odd-role\ndescription: ${hostile}\nside: worker\n---\n\n# Odd\n\n## Responsibility\n<!-- </script> --> ${separated}\n`,
  );
  const out = path.join(sandbox, "pages", "worker.html");
  const written = spawnSync(process.execPath, [helper(worker), "--project", worker, "--out", out], { encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  assert.equal(JSON.parse(written.stdout).written, out);
  const html = read(out);
  const nonces = [...html.matchAll(/nonce="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(nonces.length, 2);
  assert.equal(nonces[0], nonces[1]);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.ok(csp.includes(`script-src 'nonce-${nonces[0]}'`));
  const data = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  assert.ok(!data.includes("<"), "the embedded data cannot close its script element");
  assert.ok(!data.includes(String.fromCharCode(0x2028)), "nor end a line inside the page's script");
  const style = /<style nonce="[^"]+">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  assert.ok(style.length > 1000 && !/@import|url\(/i.test(style), "the style loads nothing");
  assert.ok(!/<(link|img|iframe|object|embed)\b|<script[^>]*\bsrc=/i.test(html.replace(data, "")), "the page loads nothing");
  const embedded = JSON.parse(data) as View;
  const odd = embedded.roles.find((role) => role.name === "odd-role");
  assert.equal(odd?.description, hostile);
  assert.ok(odd?.body.includes(separated));
  assert.equal(embedded.loops.length, view.loops.length);
  // The nonce is base64 and may hold "+" or "/": find the element as plain text, not as a pattern.
  const opening = `<script nonce="${nonces[0]}">`;
  const scriptStart = html.indexOf(opening) + opening.length;
  const script = html.slice(scriptStart, html.indexOf("</script>", scriptStart));
  assert.ok(script.length > 1000);
  new Function(script); // compiles: the page's own code survived being embedded

  // --- the validator: its own loops and roles, no loop chosen yet ---
  const validatorView = await viewer.collectView(validator);
  assert.equal(validatorView.project.side, "validator");
  assert.equal(validatorView.project.chosen, null);
  assert.equal(loopOf(validatorView, "submission-review").kind, "task");
  assert.ok(validatorView.loops.some((loop) => loop.name === "proposal-review"));
  assert.ok(!validatorView.loops.some((loop) => loop.name === "research-iteration"), "a validator sees no worker loop");
  assert.ok(!validatorView.roles.some((role) => role.name === "implementer"), "a validator sees no worker role");

  // --- served on this machine: read-only, only to its own address ---
  await assert.rejects(viewer.serveLoops(validator, { host: "0.0.0.0", port: 0 }), /only on this machine/);
  const served = await viewer.serveLoops(worker, { port: 0 });
  try {
    const { port } = new URL(served.url);
    const page = await request(served.url);
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-type"]), /^text\/html/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    assert.equal(page.headers["cache-control"], "no-store");
    const nonce = /<script nonce="([^"]+)">/.exec(page.body)?.[1];
    assert.ok(nonce && String(page.headers["content-security-policy"]).includes(`script-src 'nonce-${nonce}'`));
    assert.match(String(page.headers["content-security-policy"]), /connect-src 'self'/);
    assert.match(page.body, /<script id="data" type="application\/json">null<\/script>/);

    const api = await request(new URL("api/data", served.url).href);
    assert.equal(api.status, 200);
    const live = JSON.parse(api.body) as View;
    assert.equal(live.project.live, true);
    assert.equal(loopOf(live, "research-iteration").runs.length, 2);
    for (const host of [`localhost:${port}`, `[::1]:${port}`])
      assert.equal((await request(new URL("api/data", served.url).href, { host })).status, 200, host);
    const head = await request(new URL("api/data", served.url).href, { method: "HEAD" });
    assert.deepEqual([head.status, head.body], [200, ""]);

    // Another site's name pointing at this machine gets nothing; nothing can be changed through it.
    assert.equal((await request(served.url, { host: `attacker.example:${port}` })).status, 421);
    assert.equal((await request(new URL("api/data", served.url).href, { host: "attacker.example" })).status, 421);
    const post = await request(served.url, { method: "POST" });
    assert.deepEqual([post.status, post.headers.allow], [405, "GET, HEAD"]);
    assert.equal((await request(new URL("other", served.url).href)).status, 404);

    // The page shows the project as it is now: an edited loop shows up on the next read.
    const definition = path.join(worker, ".claude/loops/library-contribution.md");
    write(definition, read(definition).replace(/^description: .*$/m, "description: edited while the page was open"));
    const again = JSON.parse((await request(new URL("api/data", served.url).href)).body) as View;
    assert.equal(loopOf(again, "library-contribution").description, "edited while the page was open");

    // A port already taken is reported, not retried elsewhere.
    const taken = spawnSync(process.execPath, [helper(worker), "--project", worker, "--port", port], { encoding: "utf8", timeout: 20_000 });
    assert.notEqual(taken.status, 0);
    assert.match(taken.stderr + taken.stdout, new RegExp(`port ${port} is in use`));
  } finally {
    await served.close();
  }
  console.log("loop view: ok");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
