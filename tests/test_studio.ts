/**
 * Contrejour Studio's server, as the owner and a stranger meet it: a project laid
 * out by the real installer from the real package; signing in with the one-time
 * link; what the page's data says about the project's loops (flows with their
 * arrows and parameters, the quick search, roles, runs); and what is refused.
 * Run `npm run build` first: the server sends the built page.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(fs.existsSync(path.join(source, "dist", "studio", "index.html")), "run npm run build first");
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-studio-")));

execFileSync(process.execPath, [path.join(source, "tools/pack-contrejour.mjs"), "--directory", path.join(sandbox, "package")], { stdio: "ignore" });
const root = path.join(sandbox, "worker");
execFileSync(process.execPath, [path.join(sandbox, "package/contrejour/install.mjs"), "--role", "worker", "--project", root, "--library", source], { stdio: "ignore" });
fs.writeFileSync(
  path.join(root, ".contrejour/loop.json"),
  JSON.stringify({ schema_version: 1, loop: "research-iteration", params: { informed_ideators: 2, failures_only_ideators: 1, blank_ideators: 1, ucb_c: 1.5 } }),
);
const helper = path.join(root, ".contrejour/dist/tools/studio.js");
// The package carries the page next to its server.
assert.ok(fs.existsSync(path.join(root, ".contrejour/dist/studio/index.html")));
const studioModule = (await import(pathToFileURL(helper).href)) as {
  serveStudio(root: string, options?: { host?: string; port?: number; assets?: string }): Promise<{ url: string; loginUrl: string; close(): Promise<void> }>;
};

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}
function request(
  url: string,
  options: { method?: string; host?: string; cookie?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Reply> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: options.method ?? "GET",
        headers: { host: options.host ?? target.host, ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

const studio = await studioModule.serveStudio(root, { port: 0 });
try {
  const at = (relative: string) => new URL(relative, studio.url).href;
  const port = new URL(studio.url).port;

  // --- a browser that has not signed in gets nothing of the project ---
  const outside = await request(studio.url);
  assert.equal(outside.status, 401);
  assert.ok(!outside.body.includes("research-iteration"));
  assert.equal((await request(at("api/overview"))).status, 401);
  assert.equal((await request(at("auth?t=not-the-token"))).status, 403);

  // --- the printed link signs in one browser, once ---
  const signIn = await request(studio.loginUrl);
  assert.equal(signIn.status, 302);
  assert.equal(signIn.headers.location, "/");
  const setCookie = String(signIn.headers["set-cookie"]);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(";")[0]!;
  assert.equal((await request(studio.loginUrl)).status, 403, "the link works once");

  // --- the page: its own files only ---
  const page = await request(studio.url, { cookie });
  assert.equal(page.status, 200);
  const csp = String(page.headers["content-security-policy"]);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  const script = /<script type="module"[^>]*src="([^"]+)"/.exec(page.body)?.[1];
  assert.ok(script, "the page loads its own script");
  const asset = await request(at(script!), { cookie });
  assert.equal(asset.status, 200);
  assert.match(String(asset.headers["content-type"]), /^text\/javascript/);
  assert.ok(!/<script[^>]+src="https?:/i.test(page.body) && !/<link[^>]+href="https?:/i.test(page.body), "nothing from the network");
  // The page's own routes all get the page; files outside the page's folder do not exist for it.
  assert.equal((await request(at("loops/research-iteration"), { cookie })).status, 200);
  assert.equal((await request(at("assets/..%2F..%2Ftools%2Fstudio.js"), { cookie })).status, 404);
  assert.equal((await request(at("package.json"), { cookie })).status, 404);

  // --- what the page is told about the project ---
  const overview = JSON.parse((await request(at("api/overview"), { cookie })).body);
  assert.equal(overview.project.side, "worker");
  assert.equal(overview.project.chosen.loop, "research-iteration");
  const loops = new Map<string, { kind: string; chosen: boolean; check: string }>(overview.loops.map((loop: { name: string }) => [loop.name, loop]));
  assert.equal(loops.get("research-iteration")?.kind, "task");
  assert.equal(loops.get("research-iteration")?.chosen, true);
  assert.equal(loops.get("research-iteration")?.check, "ok");
  assert.equal(loops.get("project-setup")?.kind, "setup");

  const flow = async (name: string) => JSON.parse((await request(at(`api/flow?name=${name}&source=project`), { cookie })).body);
  const arrows = (graph: { edges: { from: string; to: string; kind: string; label: string }[] }) =>
    graph.edges.map((edge) => `${edge.from}>${edge.to}:${edge.kind}:${edge.label}`);

  // The research round: seven steps in two stages, groups of ideators, parameters joined to the steps that use them.
  const research = await flow("research-iteration");
  const steps = research.nodes.filter((node: { kind: string }) => node.kind === "step");
  assert.deepEqual(steps.map((node: { number: number }) => node.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...new Set(steps.map((node: { group: string }) => node.group))], ["build", "record"]);
  const ideate = steps.find((node: { title: string }) => node.title === "Ideate");
  assert.deepEqual(ideate.items.map((item: { roles: string[] }) => item.roles[0]), ["ideator-informed", "ideator-failures-only", "ideator-blank"]);
  const params = new Map(research.params.map((param: { name: string }) => [param.name, param]));
  assert.deepEqual([(params.get("informed_ideators") as { value: number }).value, (params.get("informed_ideators") as { links: string[] }).links], [2, ["s2"]]);
  assert.deepEqual((params.get("ucb_c") as { links: string[] }).links, ["s3"]);
  const researchArrows = arrows(research);
  assert.ok(researchArrows.includes("s3>end:end:With no pending idea left"), researchArrows.join("\n"));
  assert.ok(researchArrows.includes("s7>end:end:"));
  assert.ok(researchArrows.includes("s5>s6:next:"));

  // A loop that stops for the owner: those steps are marked; "revise" goes back, "cancel" ends it.
  const contribution = await flow("library-contribution");
  assert.deepEqual(
    contribution.nodes.filter((node: { waits: boolean }) => node.waits).map((node: { number: number }) => node.number),
    [2, 3],
  );
  const contributionArrows = arrows(contribution);
  for (const expected of ["s3>s1:back:revise", "s3>end:end:cancel", "s1>s2:next:no-library", "s3>s4:next:approval", "s4>end:end:"])
    assert.ok(contributionArrows.includes(expected), `${expected} in ${contributionArrows.join(", ")}`);
  assert.match(contributionArrows.find((arrow) => arrow.startsWith("s1>end"))!, /not-eligible/);

  // A step that runs only on a condition: the way into it says so, and otherwise the loop goes past it.
  const authoring = await flow("loop-authoring");
  const authoringArrows = arrows(authoring);
  for (const expected of ["start>s1:next:regenerate", "start>s2:branch:otherwise", "s7>s4:back:revise", "s7>s9:branch:cancel", "s8>end:end:"])
    assert.ok(authoringArrows.includes(expected), `${expected} in ${authoringArrows.join(", ")}`);
  assert.ok(!authoringArrows.some((arrow) => arrow.startsWith("s8>s9")), "installing ends the loop");
  const setup = await flow("project-setup");
  assert.ok(setup.nodes.find((node: { number: number }) => node.number === 4).loops.includes("loop-authoring"));
  assert.equal((await request(at("api/flow?name=no-such-loop"), { cookie })).status, 404);

  // The quick search: a Chinese request finds the English definition it describes.
  const search = JSON.parse(
    (await request(at(`api/search?q=${encodeURIComponent("读题目生成 N 个 idea，评分后记入项目记忆，用 UCB 挑选做实验并提交")}`), { cookie })).body,
  );
  assert.equal(search.candidates[0].name, "research-iteration");
  assert.ok(search.candidates[0].matched.includes("ucb"));
  const contributeSearch = JSON.parse((await request(at("api/search?q=contribute%20roles%20to%20the%20library"), { cookie })).body);
  assert.equal(contributeSearch.candidates[0].name, "library-contribution");

  const role = JSON.parse((await request(at("api/role?name=owner-review"), { cookie })).body);
  assert.ok(role.used_by.includes("library-contribution"));
  assert.match(role.body, /## Responsibility/);
  const detail = JSON.parse((await request(at("api/loop?name=research-iteration&source=project"), { cookie })).body);
  assert.match(detail.definition, /^---\nname: research-iteration/);
  assert.deepEqual(detail.runs, []);

  // --- the owner makes a loop the project's task loop, with values they set ---
  const use = (body: unknown) =>
    request(at("api/use"), { cookie, method: "POST", headers: { "x-contrejour-studio": "1", "content-type": "application/json" }, body });
  const settings = () => JSON.parse(fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
  const chosen = () => JSON.parse(fs.readFileSync(path.join(root, ".contrejour/loop.json"), "utf8"));
  const used = await use({ name: "research-iteration", params: { informed_ideators: 4, ucb_c: 0.5 } });
  assert.equal(used.status, 200, used.body);
  assert.deepEqual(chosen(), {
    schema_version: 1,
    loop: "research-iteration",
    params: { informed_ideators: 4, failures_only_ideators: 1, blank_ideators: 1, ucb_c: 0.5 },
  });
  assert.equal(settings().agent, "worker-task-manager", "sessions enter as the role that runs loops");
  assert.ok(settings().hooks.PreToolUse, "the hooks stay registered");
  for (const [body, why] of [
    [{ name: "research-iteration", params: { informed_ideators: 99 } }, /at most/],
    [{ name: "research-iteration", params: { informed_ideators: 1.5 } }, /integer/],
    [{ name: "research-iteration", params: { nonsense: 1 } }, /no parameter nonsense/],
    [{ name: "library-contribution", params: {} }, /on-request loop/],
    [{ name: "no-such-loop", params: {} }, /neither this project nor its library/],
  ] as const) {
    const refused = await use(body);
    assert.equal(refused.status, 400, refused.body);
    assert.match(JSON.parse(refused.body).error, why);
  }
  assert.equal(chosen().params.informed_ideators, 4, "a refused choice changes nothing");
  // A library loop the project lacks comes in with the roles it needs, as the installer seeds them.
  for (const file of [".claude/loops/research-iteration.md", ".claude/workflows/research-iteration.js", ".claude/agents/idea-assessor.md"])
    fs.rmSync(path.join(root, file));
  fs.rmSync(path.join(root, ".contrejour/seeded/agents/idea-assessor.md"));
  const fromLibrary = await use({ name: "research-iteration", source: "library", params: {} });
  assert.equal(fromLibrary.status, 200, fromLibrary.body);
  assert.deepEqual(JSON.parse(fromLibrary.body).added.sort(), [
    ".claude/agents/idea-assessor.md",
    ".claude/loops/research-iteration.md",
    ".claude/workflows/research-iteration.js",
  ]);
  assert.equal(
    fs.readFileSync(path.join(root, ".contrejour/seeded/agents/idea-assessor.md"), "utf8"),
    fs.readFileSync(path.join(source, "library/roles/worker/idea-assessor.md"), "utf8"),
    "the copy keeps its baseline for contributions",
  );
  assert.equal(chosen().params.informed_ideators, 3, "values left unset take the defaults");
  assert.equal((await use({ name: "research-iteration", params: {} })).status, 200);

  // --- what is refused ---
  assert.equal((await request(at("api/overview"), { cookie, host: `attacker.example:${port}` })).status, 421);
  assert.equal((await request(at("api/overview"), { cookie, method: "POST" })).status, 403, "a form on another site cannot act");
  assert.equal((await request(at("api/overview"), { cookie, method: "DELETE" })).status, 405);
  assert.equal((await request(studio.url, { cookie, method: "POST" })).status, 405);
  await assert.rejects(studioModule.serveStudio(root, { host: "0.0.0.0", port: 0 }), /only on this machine/);
  await assert.rejects(studioModule.serveStudio(root, { port: 0, assets: path.join(sandbox, "missing") }), /page is missing/);
} finally {
  await studio.close();
}

// --- the command prints the link to open, and nothing else knows it ---
const child = spawn(process.execPath, [helper, "--project", root, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
try {
  const printed = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`no link printed: ${out}`)), 20_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (/auth\?t=\S+/.test(out)) {
        clearTimeout(timer);
        resolve(out);
      }
    });
    child.on("exit", (code) => reject(new Error(`exited ${code}: ${out}`)));
  });
  const link = /http:\/\/127\.0\.0\.1:\d+\/auth\?t=[A-Za-z0-9_-]+/.exec(printed)?.[0];
  assert.ok(link, printed);
  assert.equal((await request(link!)).status, 302);
  const files = execFileSync("grep", ["-rl", new URL(link!).searchParams.get("t")!, root], { encoding: "utf8" }).trim();
  assert.equal(files, "", "the link is written nowhere in the project");
} catch (error) {
  // grep exits 1 when it finds nothing, which is what is wanted.
  if (!(error as { status?: number }).status || (error as { status?: number }).status !== 1) throw error;
} finally {
  child.kill();
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log("studio: ok");
