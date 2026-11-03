/**
 * Contributing a project's loops and roles to the shared library, as the owner
 * and the library-contributor role see it: real installed helpers, real git with
 * local bare repositories standing in for GitHub, a stand-in `gh`. Run `npm run
 * build` first.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(source, "dist");
assert.ok(fs.existsSync(path.join(dist, "tools", "library-cli.js")), "run npm run build first");
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "contrejour-contribution-")));
const github = path.join(sandbox, "github");
const bin = path.join(sandbox, "bin");
const ghLog = path.join(sandbox, "gh.log");
fs.mkdirSync(bin, { recursive: true });

// A stand-in for GitHub: git rewrites its addresses to local bare repositories, and this `gh` records its calls.
fs.writeFileSync(
  path.join(bin, "gh"),
  `#!${process.execPath}
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const args = process.argv.slice(2);
const body = args.includes("--body-file") ? fs.readFileSync(args[args.indexOf("--body-file") + 1], "utf8") : null;
fs.appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify({ args, body }) + "\\n");
const github = ${JSON.stringify(github)};
if (args[0] === "--version") console.log("gh version 2");
else if (args[0] === "auth") process.exit(process.env.FAKE_GH_SIGNED_OUT ? 1 : 0);
else if (args[0] === "api" && args[1] === "user") console.log("contributor");
else if (args[0] === "api") console.log(process.env.FAKE_GH_CAN_PUSH ?? "false");
else if (args[0] === "repo" && args[1] === "fork") {
  const fork = path.join(github, "contributor", args[2].split("/")[1] + ".git");
  if (!fs.existsSync(fork)) execFileSync("git", ["clone", "--quiet", "--bare", path.join(github, args[2] + ".git"), fork]);
} else if (args[0] === "pr") console.log("https://github.com/acme/contrejour/pull/7");
`,
  { mode: 0o755 },
);
const env = {
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: `url.${github}/.insteadOf`,
  GIT_CONFIG_VALUE_0: "https://github.com/",
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};
delete env.FAKE_GH_SIGNED_OUT;
delete env.FAKE_GH_CAN_PUSH;
delete env.CONTREJOUR_TOKEN;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const read = (file: string) => fs.readFileSync(file, "utf8");
const ghCalls = () =>
  fs.existsSync(ghLog)
    ? read(ghLog).trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; body: string | null })
    : [];
const prCalls = () => ghCalls().filter((call) => call.args[0] === "pr");

/** A repository on the stand-in GitHub whose main branch holds the library. */
function publishRepository(slug: string, files: (work: string) => void): string {
  const bare = path.join(github, `${slug}.git`);
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", bare], { env });
  const work = path.join(sandbox, "maintainer", slug);
  execFileSync("git", ["clone", "--quiet", `https://github.com/${slug}.git`, work], { env, stdio: "ignore" });
  git(work, "checkout", "--quiet", "-B", "main");
  files(work);
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "start");
  git(work, "push", "--quiet", "origin", "main");
  return work;
}
const maintainer = publishRepository("acme/contrejour", (work) =>
  fs.cpSync(path.join(source, "library"), path.join(work, "library"), { recursive: true }),
);
/** What maintainers merged meanwhile: projects must not undo it. */
function libraryMoves(relative: string, change: (text: string) => string) {
  git(maintainer, "pull", "--quiet", "origin", "main");
  const file = path.join(maintainer, relative);
  write(file, change(read(file)));
  git(maintainer, "add", "-A");
  git(maintainer, "commit", "--quiet", "-m", `change ${relative}`);
  git(maintainer, "push", "--quiet", "origin", "main");
}

// The real installer, from the real package.
execFileSync(process.execPath, [path.join(source, "tools/pack-contrejour.mjs"), "--directory", path.join(sandbox, "package")], { stdio: "ignore" });
const installer = path.join(sandbox, "package/contrejour/install.mjs");
const checkout = path.join(sandbox, "checkout");
execFileSync("git", ["clone", "--quiet", "https://github.com/acme/contrejour.git", checkout], { env, stdio: "ignore" });
function install(name: string, role: "worker" | "validator", library: string | null = checkout): string {
  const root = path.join(sandbox, name);
  execFileSync(process.execPath, [installer, "--role", role, "--project", root, ...(library ? ["--library", library] : [])], { stdio: "ignore" });
  return root;
}
const cli = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [path.join(root, ".contrejour/dist/tools/library-cli.js"), args[0]!, "--project", root, ...args.slice(1)], { env, encoding: "utf8" });
const reply = (run: { status: number | null; stdout: string; stderr: string }) =>
  JSON.parse(run.stdout || run.stderr) as Record<string, any>;
const plan = (root: string, ...args: string[]) => {
  const run = cli(root, "plan", ...args);
  assert.equal(run.status, 0, run.stderr);
  return reply(run);
};
const unit = (planned: Record<string, any>, name: string) =>
  [...planned.selected, ...planned.not_selected].find((entry: { name: string }) => entry.name === name);
const selected = (planned: Record<string, any>) => planned.selected.map((entry: { name: string }) => entry.name).sort();
const role = (name: string, side: string, extra = "") =>
  `---\nname: ${name}\ndescription: ${name} checks things.\nside: ${side}\n---\n\n# ${name}\n\n## Responsibility\nx\n\n## Inputs\nx\n\n## Output\nx\n\n## Writes\nnothing\n\n## Evaluation\nx\n${extra}`;
const finish = (root: string, id: string, status = "tested") =>
  write(path.join(root, `.contrejour/results/${id}.json`), JSON.stringify({ submission_id: id, status }));
const changedFiles = (repo: string, base: string, branch: string) =>
  git(repo, "diff", "--name-status", `${base}...${branch}`).split("\n").filter(Boolean).sort();

try {
  // --- the installer keeps a baseline of what it seeds ---
  const worker = install("worker", "worker");
  const agents = path.join(worker, ".claude/agents");
  const seeded = path.join(worker, ".contrejour/seeded/agents/implementer.md");
  assert.equal(read(seeded), read(path.join(agents, "implementer.md")));
  assert.ok(fs.existsSync(path.join(worker, ".contrejour/seeded/workflows/research-iteration.js")));

  // --- one finished task is enough, and nothing short of one counts ---
  write(path.join(agents, "citation-checker.md"), role("citation-checker", "worker"));
  let planned = plan(worker);
  assert.equal(planned.eligible, false);
  assert.deepEqual(selected(planned), ["citation-checker"]);
  const noTask = cli(worker, "contribute", "--digest", planned.digest);
  assert.equal(noTask.status, 1);
  assert.equal(reply(noTask).reason, "NO_FINISHED_TASK");
  for (const status of ["invalid", "expired", "failed", "reviewing"]) finish(worker, `s00${status.length}`, status);
  assert.equal(plan(worker).eligible, false);
  finish(worker, "s009");
  assert.deepEqual([plan(worker).eligible, plan(worker).finished_tasks], [true, ["s009"]]);

  // --- only what this project added or changed leaves; what the library changed meanwhile is untouched ---
  libraryMoves("library/roles/worker/idea-assessor.md", (text) => `${text}\nA maintainer's improvement.\n`);
  planned = plan(worker);
  assert.equal(unit(planned, "idea-assessor"), undefined, "a role this project left alone is not sent");
  assert.ok(planned.unchanged > 10);
  assert.deepEqual(selected(planned), ["citation-checker"]);
  assert.equal(planned.selected[0].state, "new");
  assert.equal(planned.selected[0].files[0].target, "library/roles/worker/citation-checker.md");
  assert.equal(planned.library.base_branch, "main");

  // An owner's own agent is not in the form of a role, and stays here without anyone having to notice it.
  write(path.join(agents, "my-private-notes.md"), "---\nname: my-private-notes\ndescription: mine\n---\nLook in the private client data.\n");
  planned = plan(worker);
  assert.equal(unit(planned, "my-private-notes").state, "invalid");
  assert.match(unit(planned, "my-private-notes").reason, /stays in this project/);
  assert.deepEqual(selected(planned), ["citation-checker"]);

  // Line endings say nothing about what a role does.
  const crlf = path.join(agents, "problem-selector.md");
  const original = read(crlf);
  fs.writeFileSync(crlf, original.replace(/\n/g, "\r\n"));
  assert.equal(unit(plan(worker), "problem-selector"), undefined);
  fs.writeFileSync(crlf, original);

  // A project's change goes alone, in the state that says how it relates to the library.
  write(crlf, `${original}\nThis project's improvement.\n`);
  assert.equal(unit(plan(worker), "problem-selector").state, "changed");

  // Both changed one role in different places: they merge, and the library's change survives.
  const assessor = path.join(agents, "idea-assessor.md");
  write(assessor, read(assessor).replace("# Idea assessor", "# Idea assessor, this project's title"));
  planned = plan(worker);
  assert.equal(unit(planned, "idea-assessor").state, "merged");
  const preview = read(unit(planned, "idea-assessor").files[0].preview);
  assert.match(preview, /this project's title/);
  assert.match(preview, /A maintainer's improvement/);
  assert.match(read(planned.changes_file), /this project's title/);

  // Both changed the same part: it stays out, and says what to do.
  libraryMoves("library/roles/worker/worker-memory.md", (text) => text.replace("# Worker memory", "# Worker memory, the library's title"));
  const memory = path.join(agents, "worker-memory.md");
  write(memory, read(memory).replace("# Worker memory", "# Worker memory, this project's title"));
  planned = plan(worker);
  assert.equal(unit(planned, "worker-memory").state, "conflict");
  assert.match(unit(planned, "worker-memory").reason, /by hand/);
  assert.equal(selected(planned).includes("worker-memory"), false);

  // A role of the same name another project already sent is not overwritten.
  git(maintainer, "pull", "--quiet", "origin", "main");
  write(path.join(maintainer, "library/roles/worker/taken-name.md"), role("taken-name", "worker", "theirs\n"));
  git(maintainer, "add", "-A");
  git(maintainer, "commit", "--quiet", "-m", "another project's role");
  git(maintainer, "push", "--quiet", "origin", "main");
  write(path.join(agents, "taken-name.md"), role("taken-name", "worker", "ours\n"));
  assert.equal(unit(plan(worker), "taken-name").state, "conflict");
  fs.rmSync(path.join(agents, "taken-name.md"));

  // --- nothing secret or private leaves ---
  write(path.join(worker, ".contrejour/environment.json"), JSON.stringify({ HF_TOKEN: "owner-secret-value" }));
  write(path.join(agents, "leaky.md"), role("leaky", "worker", "Use owner-secret-value to log in.\n"));
  write(path.join(agents, "shaped-key.md"), role("shaped-key", "worker", `Key: ${"sk-"}${"a".repeat(30)}\n`));
  write(path.join(agents, "elsewhere.md"), role("elsewhere", "validator"));
  write(path.join(agents, "local-paths.md"), role("local-paths", "worker", "Data lives in /home/someone/data/set.\n"));
  planned = plan(worker);
  assert.equal(unit(planned, "leaky").state, "blocked");
  assert.match(unit(planned, "leaky").reason, /environment secret HF_TOKEN/);
  assert.equal(JSON.stringify(planned).includes("owner-secret-value"), false);
  assert.equal(unit(planned, "shaped-key").state, "blocked");
  assert.equal(unit(planned, "elsewhere").state, "wrong-side");
  assert.match(unit(planned, "local-paths").warnings[0], /\/home\/someone\/data\/set/);
  for (const name of ["leaky", "shaped-key", "elsewhere", "local-paths"]) fs.rmSync(path.join(agents, `${name}.md`));

  // --- a contribution sends exactly the plan the owner approved ---
  planned = plan(worker, "--exclude", "problem-selector");
  assert.equal(unit(planned, "problem-selector").state, "excluded");
  const approved = planned.digest as string;
  assert.notEqual(approved, plan(worker).digest, "leaving something out is another plan");
  const stale = cli(worker, "contribute", "--digest", approved);
  assert.equal(reply(stale).reason, "PLAN_CHANGED", "the approved list left something out");
  // A role that changes after the owner saw it is a new plan too.
  write(assessor, read(assessor).replace("this project's title", "this project's better title"));
  assert.equal(reply(cli(worker, "contribute", "--digest", approved, "--exclude", "problem-selector")).reason, "PLAN_CHANGED");

  planned = plan(worker, "--exclude", "problem-selector");
  const branchBefore = git(checkout, "branch", "--show-current");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const firstBranch = `library/worker-worker-${stamp}`;
  let run = cli(worker, "contribute", "--digest", planned.digest, "--exclude", "problem-selector");
  assert.equal(run.status, 0, run.stdout + run.stderr);
  let result = reply(run);
  assert.equal(result.status, "pushed");
  assert.equal(result.branch, firstBranch);
  assert.equal(result.pull_request, "https://github.com/acme/contrejour/pull/7");
  const upstream = path.join(github, "acme/contrejour.git");
  // The pull request carries the new role and the merged one, and undoes nothing the library changed.
  assert.deepEqual(changedFiles(upstream, "main", firstBranch), [
    "A\tlibrary/roles/worker/citation-checker.md",
    "M\tlibrary/roles/worker/idea-assessor.md",
  ]);
  assert.match(git(upstream, "show", `${firstBranch}:library/roles/worker/idea-assessor.md`), /A maintainer's improvement/);
  const [pr] = prCalls();
  assert.deepEqual(pr!.args.slice(0, 8), ["pr", "create", "--repo", "acme/contrejour", "--base", "main", "--head", firstBranch]);
  assert.match(pr!.body!, /citation-checker/);
  assert.match(pr!.body!, /after 1 finished task/);
  // The checkout is as it was, with no working copy left behind.
  assert.equal(git(checkout, "branch", "--show-current"), branchBefore);
  assert.equal(git(checkout, "status", "--short"), "");
  assert.equal(git(checkout, "worktree", "list").split("\n").length, 1);
  assert.equal(fs.existsSync(path.join(worker, ".contrejour/contributions/preview")), false);
  assert.deepEqual(fs.readdirSync(path.join(worker, ".contrejour/contributions/worktrees")), []);

  // What a pull request already carries is not sent twice; what changed further is, on a new branch.
  planned = plan(worker, "--exclude", "problem-selector");
  assert.equal(unit(planned, "citation-checker").state, "already-contributed");
  assert.equal(planned.digest, null);
  assert.equal(reply(cli(worker, "contribute", "--digest", "0".repeat(64), "--exclude", "problem-selector")).reason, "NOTHING_TO_CONTRIBUTE");
  const contributed = path.join(agents, "citation-checker.md");
  write(contributed, `${read(contributed)}\nLearned later.\n`);
  planned = plan(worker, "--exclude", "problem-selector");
  assert.deepEqual(selected(planned), ["citation-checker"]);
  result = reply(cli(worker, "contribute", "--digest", planned.digest, "--exclude", "problem-selector"));
  assert.equal(result.branch, `${firstBranch}-2`);

  // Once merged, the project's later change goes as a change, without a false conflict against its own earlier text.
  git(maintainer, "pull", "--quiet", "origin", "main");
  git(maintainer, "fetch", "--quiet", "origin");
  git(maintainer, "merge", "--quiet", "--no-edit", `origin/${firstBranch}-2`);
  git(maintainer, "push", "--quiet", "origin", "main");
  assert.equal(unit(plan(worker), "citation-checker").state, "in-library");
  write(contributed, `${read(contributed)}\nLearned even later.\n`);
  assert.equal(unit(plan(worker), "citation-checker").state, "changed");
  fs.rmSync(contributed);

  // --- a contribution that would break the library does not leave ---
  write(path.join(agents, "needed-role.md"), role("needed-role", "worker"));
  write(path.join(worker, ".claude/loops/narrow.md"), "---\nname: narrow\ndescription: Calls one role.\nside: worker\n---\n\n# Narrow\n");
  write(
    path.join(worker, ".claude/workflows/narrow.js"),
    "export const meta = { name: 'narrow', description: 'one role', phases: [{ title: 'Run' }] }\nphase('Run')\nawait agent('{}', { agentType: 'needed-role', phase: 'Run' })\n",
  );
  const checker = (...args: string[]) => execFileSync(process.execPath, [path.join(worker, ".contrejour/dist/tools/loop-check.js"), ...args, "--project", worker], { encoding: "utf8" });
  checker("stamp", "narrow");
  const without = plan(worker, "--exclude", "needed-role,problem-selector,idea-assessor");
  assert.equal(unit(without, "narrow").state, "new");
  assert.equal(without.library_check.ok, false);
  assert.match(without.library_check.defects.join("\n"), /unknown role "needed-role"/);
  const broken = cli(worker, "contribute", "--digest", without.digest, "--exclude", "needed-role,problem-selector,idea-assessor");
  assert.equal(reply(broken).reason, "LIBRARY_CHECK_FAILED");
  const branches = git(checkout, "branch", "--list", "library/*");
  assert.equal(branches.includes(`${firstBranch}-3`), false);

  // A stale script is not sent either.
  fs.appendFileSync(path.join(worker, ".claude/loops/narrow.md"), "One more sentence.\n");
  assert.equal(unit(plan(worker), "narrow").state, "invalid");
  assert.match(unit(plan(worker), "narrow").reason, /stale/);
  checker("stamp", "narrow");

  // --- without write access it goes through a fork; pull request from the fork ---
  planned = plan(worker, "--exclude", "problem-selector,idea-assessor");
  assert.deepEqual(selected(planned), ["narrow", "needed-role"]);
  const denied = path.join(upstream, "hooks/pre-receive");
  write(denied, "#!/bin/sh\necho 'denied to contributor' >&2\nexit 1\n");
  fs.chmodSync(denied, 0o755);
  fs.rmSync(ghLog, { force: true });
  run = cli(worker, "contribute", "--digest", planned.digest, "--exclude", "problem-selector,idea-assessor");
  assert.equal(run.status, 0, run.stdout + run.stderr);
  result = reply(run);
  assert.equal(result.status, "pushed");
  assert.equal(result.remote, "https://github.com/contributor/contrejour.git");
  const fork = path.join(github, "contributor/contrejour.git");
  assert.deepEqual(changedFiles(fork, "main", result.branch).length, 3);
  assert.equal(spawnSync("git", ["-C", upstream, "rev-parse", "--verify", "--quiet", `refs/heads/${result.branch}`]).status, 1);
  const forked = prCalls()[0]!;
  assert.deepEqual(forked.args.slice(0, 8), ["pr", "create", "--repo", "acme/contrejour", "--base", "main", "--head", `contributor:${result.branch}`]);
  assert.ok(ghCalls().some((call) => call.args.slice(0, 3).join(" ") === "repo fork acme/contrejour"));

  // Without write access and without gh, the branch stays local, says why, and is not counted as sent.
  for (const name of ["narrow"]) {
    fs.rmSync(path.join(worker, `.claude/loops/${name}.md`));
    fs.rmSync(path.join(worker, `.claude/workflows/${name}.js`));
  }
  fs.rmSync(path.join(agents, "needed-role.md"));
  write(path.join(agents, "stays-local.md"), role("stays-local", "worker"));
  planned = plan(worker, "--exclude", "problem-selector,idea-assessor");
  assert.deepEqual(selected(planned), ["stays-local"]);
  const signedOut = spawnSync(process.execPath, [path.join(worker, ".contrejour/dist/tools/library-cli.js"), "contribute", "--project", worker, "--digest", planned.digest, "--exclude", "problem-selector,idea-assessor"], { env: { ...env, FAKE_GH_SIGNED_OUT: "1" }, encoding: "utf8" });
  assert.equal(signedOut.status, 1);
  const local = reply(signedOut);
  assert.equal(local.status, "local-only");
  assert.match(local.reason, /not signed in/);
  assert.match(git(checkout, "branch", "--list", local.branch), /stays-local|library\//);
  assert.deepEqual(selected(plan(worker, "--exclude", "problem-selector,idea-assessor")), ["stays-local"]);
  fs.rmSync(denied);

  // Pushed, but gh is not there to open the pull request: the owner gets the address.
  const bare = path.join(sandbox, "no-gh");
  fs.mkdirSync(bare);
  for (const tool of ["git", "sh"]) fs.symlinkSync(execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim(), path.join(bare, tool));
  const noGh = spawnSync(process.execPath, [path.join(worker, ".contrejour/dist/tools/library-cli.js"), "contribute", "--project", worker, "--digest", planned.digest, "--exclude", "problem-selector,idea-assessor"], { env: { ...env, PATH: bare }, encoding: "utf8" });
  assert.equal(noGh.status, 0, noGh.stdout + noGh.stderr);
  const pushedOnly = reply(noGh);
  assert.equal(pushedOnly.pull_request, null);
  assert.match(pushedOnly.reason, /not installed/);
  assert.ok(pushedOnly.compare_url.startsWith("https://github.com/acme/contrejour/compare/main..."));
  fs.rmSync(path.join(agents, "stays-local.md"));

  // --- the validator's files leave only after a leak check of exactly this list ---
  const validator = install("validator", "validator");
  const hidden = path.join(validator, "bench/labels.json");
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
  write(path.join(validator, ".contrejour/validation/token"), "validator-service-token\n");
  const status = (id: string, value: string) =>
    write(path.join(validator, `.contrejour/validation/submissions/${id}/status.json`), JSON.stringify({ schema_version: 1, submission_id: id, status: value, created_at: "", updated_at: "" }));
  const vAgents = path.join(validator, ".claude/agents");
  write(path.join(vAgents, "probe-writer.md"), role("probe-writer", "validator"));
  status("s001", "reviewing");
  assert.equal(plan(validator).eligible, false);
  status("s001", "tested");
  write(path.join(vAgents, "token-role.md"), role("token-role", "validator", "Auth with validator-service-token.\n"));
  write(path.join(vAgents, "hidden-role.md"), role("hidden-role", "validator", `Compare with ${hidden}.\n`));
  planned = plan(validator);
  assert.equal(planned.eligible, true);
  assert.equal(unit(planned, "token-role").state, "blocked");
  assert.equal(unit(planned, "hidden-role").state, "blocked");
  assert.match(unit(planned, "hidden-role").reason, /hidden path/);
  fs.rmSync(path.join(vAgents, "token-role.md"));
  fs.rmSync(path.join(vAgents, "hidden-role.md"));
  planned = plan(validator);
  assert.equal(planned.leak_check, "required");
  const needsCheck = cli(validator, "contribute", "--digest", planned.digest);
  assert.equal(reply(needsCheck).reason, "LEAK_CHECK_REQUIRED");
  // A verdict binds to its digest: a pass on another list does not count.
  const verdict = (digest: string, value: string, ...extra: string[]) => cli(validator, "record-leak-check", "--digest", digest, "--verdict", value, ...extra);
  assert.equal(verdict("f".repeat(64), "pass").status, 0);
  assert.equal(plan(validator).leak_check, "required");
  assert.equal(verdict(planned.digest, "leak").status, 1, "a leak needs a finding");
  assert.equal(verdict(planned.digest, "leak", "--finding", "probe-writer.md: an example close to a test").status, 0);
  assert.equal(plan(validator).leak_check, "failed");
  assert.equal(reply(cli(validator, "contribute", "--digest", planned.digest)).reason, "LEAK_CHECK_FAILED");
  assert.equal(verdict(planned.digest, "pass").status, 0);
  assert.equal(plan(validator).leak_check, "passed");
  fs.rmSync(ghLog, { force: true });
  run = cli(validator, "contribute", "--digest", planned.digest);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(prCalls()[0]!.body!, /`leak-reviewer` role checked them/);
  assert.equal(cli(worker, "record-leak-check", "--digest", "a".repeat(64), "--verdict", "pass").status, 1);

  // --- a new role reaches every project only when it says so ---
  const shared = path.join(sandbox, "shared-role");
  fs.cpSync(path.join(source, "library"), shared, { recursive: true });
  const { checkLibrary } = await import(pathToFileURL(path.join(dist, "tools/library-cli.js")).href);
  assert.equal((await checkLibrary(shared)).ok, true);
  write(path.join(shared, "roles/worker/misfiled.md"), role("misfiled", "framework"));
  const misfiled = await checkLibrary(shared);
  assert.equal(misfiled.ok, false);
  assert.match(JSON.stringify(misfiled.reports.worker.roles), /declares side framework, but lives under worker/);
  fs.rmSync(path.join(shared, "roles/worker/misfiled.md"));
  const everyProject = install("framework-role", "worker");
  finish(everyProject, "s001");
  write(path.join(everyProject, ".claude/agents/general-helper.md"), role("general-helper", "framework"));
  assert.equal(plan(everyProject).selected[0].files[0].target, "library/roles/framework/general-helper.md");

  // --- a project without a checkout fetches one ---
  const fromArchive = install("from-archive", "worker", null);
  finish(fromArchive, "s001");
  planned = plan(fromArchive);
  assert.equal(planned.library.available, false);
  assert.equal(planned.library.upstream, "https://github.com/justforyou16007/auto-dl-loop");
  assert.match(planned.library.reason, /library-cli\.js clone/);
  assert.equal(reply(cli(fromArchive, "contribute", "--digest", "0".repeat(64))).reason, "LIBRARY_UNAVAILABLE");
  const packaged = path.join(fromArchive, ".contrejour/package.json");
  write(packaged, JSON.stringify({ ...JSON.parse(read(packaged)), repository: { url: "git+https://github.com/acme/contrejour.git" } }));
  const cloned = cli(fromArchive, "clone");
  assert.equal(cloned.status, 0, cloned.stdout + cloned.stderr);
  assert.equal(reply(cloned).cloned, true);
  assert.equal(reply(cli(fromArchive, "clone")).cloned, false);
  write(path.join(fromArchive, ".claude/agents/archive-role.md"), role("archive-role", "worker"));
  planned = plan(fromArchive);
  assert.equal(planned.library.available, true);
  assert.deepEqual(selected(planned), ["archive-role"]);

  // --- a repository whose default branch has no library yet: the contribution targets the branch it has ---
  const early = publishRepository("acme/early", (work) => write(path.join(work, "README.md"), "no library here\n"));
  git(early, "checkout", "--quiet", "-b", "feat/framework");
  fs.cpSync(path.join(source, "library"), path.join(early, "library"), { recursive: true });
  git(early, "add", "-A");
  git(early, "commit", "--quiet", "-m", "library");
  git(early, "push", "--quiet", "origin", "feat/framework");
  const earlyCheckout = path.join(sandbox, "early-checkout");
  execFileSync("git", ["clone", "--quiet", "--branch", "feat/framework", "https://github.com/acme/early.git", earlyCheckout], { env, stdio: "ignore" });
  const earlyProject = install("early-project", "worker", earlyCheckout);
  finish(earlyProject, "s001");
  write(path.join(earlyProject, ".claude/agents/early-role.md"), role("early-role", "worker"));
  planned = plan(earlyProject);
  assert.equal(planned.library.base_branch, "feat/framework");
  assert.match(planned.library.note, /default branch main has no library yet/);
  fs.rmSync(ghLog, { force: true });
  run = cli(earlyProject, "contribute", "--digest", planned.digest);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(prCalls()[0]!.args.slice(4, 6), ["--base", "feat/framework"]);

  // --- a checkout with no remote: the branch stays local ---
  const lone = path.join(sandbox, "lone-checkout");
  fs.mkdirSync(lone);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", lone], { env });
  fs.cpSync(path.join(source, "library"), path.join(lone, "library"), { recursive: true });
  git(lone, "add", "-A");
  git(lone, "commit", "--quiet", "-m", "library");
  const loneProject = install("lone-project", "worker", lone);
  finish(loneProject, "s001");
  write(path.join(loneProject, ".claude/agents/lone-role.md"), role("lone-role", "worker"));
  planned = plan(loneProject);
  assert.equal(planned.library.remote, null);
  run = cli(loneProject, "contribute", "--digest", planned.digest);
  assert.equal(run.status, 1);
  assert.equal(reply(run).status, "local-only");
  assert.match(reply(run).reason, /no remote/);

  // --- a project installed before baselines were kept ---
  const older = install("older", "worker");
  finish(older, "s001");
  fs.rmSync(path.join(older, ".contrejour/seeded"), { recursive: true });
  const olderRole = path.join(older, ".claude/agents/problem-selector.md");
  write(olderRole, `${read(olderRole)}\nChanged before baselines.\n`);
  // Its changed role cannot be told apart from what the library changed, so it stays out.
  assert.equal(unit(plan(older), "problem-selector").state, "unknown-base");
  // Updating backfills only what is provably unedited.
  execFileSync(process.execPath, [installer, "--role", "worker", "--project", older], { stdio: "ignore" });
  assert.ok(fs.existsSync(path.join(older, ".contrejour/seeded/agents/implementer.md")));
  assert.equal(fs.existsSync(path.join(older, ".contrejour/seeded/agents/problem-selector.md")), false);
  assert.equal(unit(plan(older), "problem-selector").state, "unknown-base");

  console.log("contribution: baselines, one finished task, plans, merges, forks, leak checks and fallbacks passed");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
