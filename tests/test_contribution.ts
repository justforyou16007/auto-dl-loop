/**
 * What leaves a project, as the owner and the library-contributor role see it:
 * the loops and roles it made, shared with the community library, and its
 * improvements to those a library gave it, sent back to that library. Real
 * installed helpers, real git with local bare repositories standing in for GitHub
 * (this package, with the framework's and the community's libraries as
 * submodules), a stand-in `gh`. Run `npm run build` first.
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
  GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: `url.${github}/.insteadOf`,
  GIT_CONFIG_VALUE_0: "https://github.com/",
  // The stand-in GitHub is local, and git clones submodules from local paths only when told to.
  GIT_CONFIG_KEY_1: "protocol.file.allow",
  GIT_CONFIG_VALUE_1: "always",
  // The community library's real address, which the framework names, leads to the stand-in too.
  GIT_CONFIG_KEY_2: `url.${github}/acme/agent-loop-community.git.insteadOf`,
  GIT_CONFIG_VALUE_2: "https://github.com/justforyou16007/agent-loop-community.git",
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
/** The one pull request a contribution to one library opened. */
const only = (result: Record<string, any>) => {
  assert.equal(result.pull_requests.length, 1, JSON.stringify(result));
  return result.pull_requests[0] as Record<string, any>;
};
/** A library's files, placeholders included, so an empty library still has its folders in git. */
const copyLibrary = (from: string, to: string) => fs.cpSync(from, to, { recursive: true });

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
// The framework's library and the community's, each in its own repository, and this package with both as submodules.
const frameworkMaintainer = publishRepository("acme/agent-loop-studio", (work) =>
  copyLibrary(path.join(source, "agent-loop-studio", "library"), path.join(work, "library")),
);
const communityMaintainer = publishRepository("acme/agent-loop-community", (work) =>
  copyLibrary(path.join(source, "agent-loop-community", "library"), path.join(work, "library")),
);
const maintainer = publishRepository("acme/contrejour", (work) => {
  fs.cpSync(path.join(source, "library"), path.join(work, "library"), { recursive: true });
  for (const library of ["agent-loop-studio", "agent-loop-community"])
    git(work, "submodule", "add", "--quiet", `https://github.com/acme/${library}.git`, library);
});
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
execFileSync("git", ["clone", "--quiet", "--recurse-submodules", "https://github.com/acme/contrejour.git", checkout], { env, stdio: "ignore" });
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

  // --- sharing: only what this project made, and whatever its side, to the community library ---
  libraryMoves("library/roles/worker/idea-assessor.md", (text) => `${text}\nA maintainer's improvement.\n`);
  planned = plan(worker);
  assert.equal(planned.purpose, "share");
  assert.equal(unit(planned, "idea-assessor"), undefined, "a role this project left alone is not sent");
  assert.ok(planned.unchanged > 10);
  assert.deepEqual(selected(planned), ["citation-checker"]);
  assert.equal(planned.selected[0].state, "new");
  assert.equal(planned.selected[0].files[0].target, "library/roles/worker/citation-checker.md");
  assert.equal(planned.selected[0].library, "agent-loop-community");
  assert.equal(planned.library.name, "agent-loop-community");
  assert.equal(planned.library.base_branch, "main");
  assert.deepEqual(planned.libraries.map((library: { name: string }) => library.name), ["contrejour", "agent-loop-studio", "agent-loop-community"]);

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

  // --- an improvement to a role a library gave this project is not shared: it goes back to that library ---
  write(crlf, `${original}\nThis project's improvement.\n`);
  assert.deepEqual([unit(plan(worker), "problem-selector").state, unit(plan(worker), "problem-selector").library], ["improvement", "contrejour"]);
  let upstream = plan(worker, "--purpose", "upstream");
  assert.equal(unit(upstream, "problem-selector").state, "changed");
  assert.equal(unit(upstream, "citation-checker").state, "contribution", "what the project made is shared, not sent upstream");

  // Both changed one role in different places: they merge, and the library's change survives.
  const assessor = path.join(agents, "idea-assessor.md");
  write(assessor, read(assessor).replace("# Idea assessor", "# Idea assessor, this project's title"));
  upstream = plan(worker, "--purpose", "upstream");
  assert.deepEqual([unit(upstream, "idea-assessor").state, unit(upstream, "idea-assessor").library], ["merged", "contrejour"]);
  const preview = read(unit(upstream, "idea-assessor").files[0].preview);
  assert.match(preview, /this project's title/);
  assert.match(preview, /A maintainer's improvement/);
  assert.match(read(upstream.changes_file), /this project's title/);

  // Both changed the same part: it stays out, and says what to do.
  libraryMoves("library/roles/worker/worker-memory.md", (text) => text.replace("# Worker memory", "# Worker memory, the library's title"));
  const memory = path.join(agents, "worker-memory.md");
  write(memory, read(memory).replace("# Worker memory", "# Worker memory, this project's title"));
  upstream = plan(worker, "--purpose", "upstream");
  assert.equal(unit(upstream, "worker-memory").state, "conflict");
  assert.match(unit(upstream, "worker-memory").reason, /by hand/);
  assert.equal(selected(upstream).includes("worker-memory"), false);

  // A role of the same name another project already shared is not overwritten.
  git(communityMaintainer, "pull", "--quiet", "origin", "main");
  write(path.join(communityMaintainer, "library/roles/worker/taken-name.md"), role("taken-name", "worker", "theirs\n"));
  git(communityMaintainer, "add", "-A");
  git(communityMaintainer, "commit", "--quiet", "-m", "another project's role");
  git(communityMaintainer, "push", "--quiet", "origin", "main");
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

  // --- what leaves is exactly the plan the owner approved ---
  write(path.join(agents, "summary-writer.md"), role("summary-writer", "worker"));
  planned = plan(worker, "--exclude", "summary-writer");
  assert.equal(unit(planned, "summary-writer").state, "excluded");
  const approved = planned.digest as string;
  assert.notEqual(approved, plan(worker).digest, "leaving something out is another plan");
  const stale = cli(worker, "contribute", "--digest", approved);
  assert.equal(reply(stale).reason, "PLAN_CHANGED", "the approved list left something out");
  // A role that changes after the owner saw it is a new plan too.
  const citations = path.join(agents, "citation-checker.md");
  write(citations, `${read(citations)}\nChanged after the review.\n`);
  assert.equal(reply(cli(worker, "contribute", "--digest", approved, "--exclude", "summary-writer")).reason, "PLAN_CHANGED");
  // A digest binds its purpose: an approved contribution sends nothing upstream.
  const shareDigest = plan(worker, "--exclude", "summary-writer").digest;
  assert.equal(reply(cli(worker, "contribute", "--purpose", "upstream", "--digest", shareDigest)).reason, "PLAN_CHANGED");

  planned = plan(worker, "--exclude", "summary-writer");
  const branchBefore = git(checkout, "branch", "--show-current");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const firstBranch = `library/worker-worker-${stamp}`;
  let run = cli(worker, "contribute", "--digest", planned.digest, "--exclude", "summary-writer");
  assert.equal(run.status, 0, run.stdout + run.stderr);
  let result = reply(run);
  assert.equal(result.status, "pushed");
  assert.equal(only(result).library, "agent-loop-community");
  assert.equal(only(result).branch, firstBranch);
  assert.equal(only(result).pull_request, "https://github.com/acme/contrejour/pull/7");
  const communityRepo = path.join(github, "acme/agent-loop-community.git");
  assert.deepEqual(changedFiles(communityRepo, "main", firstBranch), ["A\tlibrary/roles/worker/citation-checker.md"]);
  const [pr] = prCalls();
  assert.deepEqual(pr!.args.slice(0, 8), ["pr", "create", "--repo", "acme/agent-loop-community", "--base", "main", "--head", firstBranch]);
  assert.match(pr!.body!, /citation-checker/);
  assert.match(pr!.body!, /after 1 finished task/);
  // The checkouts are as they were, with no working copy left behind.
  const communityCheckout = path.join(checkout, "agent-loop-community");
  assert.equal(git(checkout, "branch", "--show-current"), branchBefore);
  for (const repository of [checkout, communityCheckout]) {
    assert.equal(git(repository, "status", "--short"), "");
    assert.equal(git(repository, "worktree", "list").split("\n").length, 1);
  }
  assert.equal(fs.existsSync(path.join(worker, ".contrejour/contributions/preview")), false);
  assert.deepEqual(fs.readdirSync(path.join(worker, ".contrejour/contributions/worktrees")), []);

  // --- sending upstream: the improvements go back to the library that gave them, merged with what it changed ---
  upstream = plan(worker, "--purpose", "upstream");
  assert.deepEqual(selected(upstream), ["idea-assessor", "problem-selector"]);
  fs.rmSync(ghLog, { force: true });
  run = cli(worker, "contribute", "--purpose", "upstream", "--digest", upstream.digest);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  result = reply(run);
  assert.equal(only(result).library, "contrejour");
  const upstreamBranch = only(result).branch;
  assert.equal(upstreamBranch, `upstream/worker-worker-${stamp}`);
  const packageRepo = path.join(github, "acme/contrejour.git");
  assert.deepEqual(changedFiles(packageRepo, "main", upstreamBranch), [
    "M\tlibrary/roles/worker/idea-assessor.md",
    "M\tlibrary/roles/worker/problem-selector.md",
  ]);
  assert.match(git(packageRepo, "show", `${upstreamBranch}:library/roles/worker/idea-assessor.md`), /A maintainer's improvement/);
  assert.deepEqual(prCalls()[0]!.args.slice(0, 4), ["pr", "create", "--repo", "acme/contrejour"]);
  assert.match(prCalls()[0]!.body!, /Improvements a worker project made/);
  assert.equal(unit(plan(worker, "--purpose", "upstream"), "problem-selector").state, "already-contributed");

  // What a pull request already carries is not shared twice; what changed further is, on a new branch.
  planned = plan(worker, "--exclude", "summary-writer");
  assert.equal(unit(planned, "citation-checker").state, "already-contributed");
  assert.equal(planned.digest, null);
  assert.equal(reply(cli(worker, "contribute", "--digest", "0".repeat(64), "--exclude", "summary-writer")).reason, "NOTHING_TO_CONTRIBUTE");
  write(citations, `${read(citations)}\nLearned later.\n`);
  planned = plan(worker, "--exclude", "summary-writer");
  assert.deepEqual(selected(planned), ["citation-checker"]);
  result = reply(cli(worker, "contribute", "--digest", planned.digest, "--exclude", "summary-writer"));
  assert.equal(only(result).branch, `${firstBranch}-2`);

  // Once merged, the project's later change goes as a change, without a false conflict against its own earlier text.
  git(communityMaintainer, "pull", "--quiet", "origin", "main");
  git(communityMaintainer, "fetch", "--quiet", "origin");
  git(communityMaintainer, "merge", "--quiet", "--no-edit", `origin/${firstBranch}-2`);
  git(communityMaintainer, "push", "--quiet", "origin", "main");
  assert.equal(unit(plan(worker), "citation-checker").state, "in-library");
  write(citations, `${read(citations)}\nLearned even later.\n`);
  assert.equal(unit(plan(worker), "citation-checker").state, "changed");
  fs.rmSync(citations);
  fs.rmSync(path.join(agents, "summary-writer.md"));

  // --- a contribution that would break the library does not leave ---
  write(path.join(agents, "needed-role.md"), role("needed-role", "worker"));
  write(path.join(worker, ".claude/loops/narrow.md"), "---\nname: narrow\ndescription: Calls one role.\nside: worker\n---\n\n# Narrow\n");
  write(
    path.join(worker, ".claude/workflows/narrow.js"),
    "export const meta = { name: 'narrow', description: 'one role', phases: [{ title: 'Run' }] }\nphase('Run')\nawait agent('{}', { agentType: 'needed-role', phase: 'Run' })\n",
  );
  const checker = (...args: string[]) => execFileSync(process.execPath, [path.join(worker, ".contrejour/dist/tools/loop-check.js"), ...args, "--project", worker], { encoding: "utf8" });
  checker("stamp", "narrow");
  const without = plan(worker, "--exclude", "needed-role");
  assert.equal(unit(without, "narrow").state, "new");
  assert.equal(without.library_check.ok, false);
  assert.match(without.library_check.defects.join("\n"), /unknown role "needed-role"/);
  const broken = cli(worker, "contribute", "--digest", without.digest, "--exclude", "needed-role");
  assert.equal(reply(broken).reason, "LIBRARY_CHECK_FAILED");
  assert.equal(git(communityCheckout, "branch", "--list", "library/*").includes(`${firstBranch}-3`), false);

  // A stale script is not sent either.
  fs.appendFileSync(path.join(worker, ".claude/loops/narrow.md"), "One more sentence.\n");
  assert.equal(unit(plan(worker), "narrow").state, "invalid");
  assert.match(unit(plan(worker), "narrow").reason, /stale/);
  checker("stamp", "narrow");

  // --- without write access it goes through a fork; pull request from the fork ---
  planned = plan(worker);
  assert.deepEqual(selected(planned), ["narrow", "needed-role"]);
  const denied = path.join(communityRepo, "hooks/pre-receive");
  write(denied, "#!/bin/sh\necho 'denied to contributor' >&2\nexit 1\n");
  fs.chmodSync(denied, 0o755);
  fs.rmSync(ghLog, { force: true });
  run = cli(worker, "contribute", "--digest", planned.digest);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  result = reply(run);
  assert.equal(result.status, "pushed");
  const forkedBranch = only(result).branch;
  assert.equal(only(result).remote, "https://github.com/contributor/agent-loop-community.git");
  const fork = path.join(github, "contributor/agent-loop-community.git");
  assert.deepEqual(changedFiles(fork, "main", forkedBranch).length, 3);
  assert.equal(spawnSync("git", ["-C", communityRepo, "rev-parse", "--verify", "--quiet", `refs/heads/${forkedBranch}`]).status, 1);
  const forked = prCalls()[0]!;
  assert.deepEqual(forked.args.slice(0, 8), ["pr", "create", "--repo", "acme/agent-loop-community", "--base", "main", "--head", `contributor:${forkedBranch}`]);
  assert.ok(ghCalls().some((call) => call.args.slice(0, 3).join(" ") === "repo fork acme/agent-loop-community"));

  // Without write access and without gh, the branch stays local, says why, and is not counted as sent.
  fs.rmSync(path.join(worker, ".claude/loops/narrow.md"));
  fs.rmSync(path.join(worker, ".claude/workflows/narrow.js"));
  fs.rmSync(path.join(agents, "needed-role.md"));
  write(path.join(agents, "stays-local.md"), role("stays-local", "worker"));
  planned = plan(worker);
  assert.deepEqual(selected(planned), ["stays-local"]);
  const signedOut = spawnSync(process.execPath, [path.join(worker, ".contrejour/dist/tools/library-cli.js"), "contribute", "--project", worker, "--digest", planned.digest], { env: { ...env, FAKE_GH_SIGNED_OUT: "1" }, encoding: "utf8" });
  assert.equal(signedOut.status, 1);
  const local = reply(signedOut);
  assert.equal(local.status, "local-only");
  assert.match(local.reason, /not signed in/);
  assert.match(git(communityCheckout, "branch", "--list", only(local).branch), /library\//);
  assert.deepEqual(selected(plan(worker)), ["stays-local"]);
  fs.rmSync(denied);

  // Pushed, but gh is not there to open the pull request: the owner gets the address.
  const bare = path.join(sandbox, "no-gh");
  fs.mkdirSync(bare);
  for (const tool of ["git", "sh"]) fs.symlinkSync(execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim(), path.join(bare, tool));
  const noGh = spawnSync(process.execPath, [path.join(worker, ".contrejour/dist/tools/library-cli.js"), "contribute", "--project", worker, "--digest", planned.digest], { env: { ...env, PATH: bare }, encoding: "utf8" });
  assert.equal(noGh.status, 0, noGh.stdout + noGh.stderr);
  const pushedOnly = reply(noGh);
  assert.equal(only(pushedOnly).pull_request, null);
  assert.match(pushedOnly.reason, /not installed/);
  assert.ok(only(pushedOnly).compare_url.startsWith("https://github.com/acme/agent-loop-community/compare/main..."));
  fs.rmSync(path.join(agents, "stays-local.md"));

  // --- the validator's files leave only after its own check of exactly this list, either way ---
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
  assert.equal(planned.check, "required");
  const needsCheck = cli(validator, "contribute", "--digest", planned.digest);
  assert.equal(reply(needsCheck).reason, "CHECK_REQUIRED");
  // A verdict binds to its digest: a pass on another list does not count.
  const verdict = (digest: string, value: string, ...extra: string[]) => cli(validator, "record-check", "--digest", digest, "--verdict", value, ...extra);
  assert.equal(verdict("f".repeat(64), "pass").status, 0);
  assert.equal(plan(validator).check, "required");
  assert.equal(verdict(planned.digest, "fail").status, 1, "a failed check needs a finding");
  assert.equal(verdict(planned.digest, "fail", "--finding", "probe-writer.md: an example close to a test").status, 0);
  assert.equal(plan(validator).check, "failed");
  assert.equal(reply(cli(validator, "contribute", "--digest", planned.digest)).reason, "CHECK_FAILED");
  // The contributor passes the purpose with every command; the digest already binds it.
  assert.equal(verdict(planned.digest, "pass", "--purpose", "share").status, 0);
  assert.equal(plan(validator).check, "passed");
  fs.rmSync(ghLog, { force: true });
  run = cli(validator, "contribute", "--digest", planned.digest);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(prCalls()[0]!.body!, /project's own check of what leaves passed/);
  assert.equal(cli(worker, "record-check", "--digest", "a".repeat(64), "--verdict", "pass").status, 1, "a worker's plans need no check of their own");
  // An improvement going back upstream needs the same check.
  const inspector = path.join(vAgents, "inspector.md");
  write(inspector, `${read(inspector)}\nAn improvement learned from the reviews.\n`);
  const vUpstream = plan(validator, "--purpose", "upstream");
  assert.deepEqual([selected(vUpstream), vUpstream.check], [["inspector"], "required"]);
  assert.equal(reply(cli(validator, "contribute", "--purpose", "upstream", "--digest", vUpstream.digest)).reason, "CHECK_REQUIRED");

  // --- a new role reaches every project only when it says so ---
  // A project receives the framework's library, the community's and this package's, laid together.
  const shared = path.join(sandbox, "shared-role");
  for (const library of [path.join(source, "agent-loop-studio", "library"), path.join(source, "agent-loop-community", "library"), path.join(source, "library")])
    copyLibrary(library, shared);
  const { checkLibrary } = await import(pathToFileURL(path.join(dist, "tools/library-cli.js")).href);
  // This package's library is checked with its manifest, which names the hook actions its loops add.
  const researchManifest = JSON.parse(fs.readFileSync(path.join(source, "project.json"), "utf8"));
  assert.equal((await checkLibrary(shared, researchManifest)).ok, true);
  assert.equal((await checkLibrary(shared)).ok, false, "without it, only the framework's hook actions are known");
  write(path.join(shared, "roles/worker/misfiled.md"), role("misfiled", "framework"));
  const misfiled = await checkLibrary(shared, researchManifest);
  assert.equal(misfiled.ok, false);
  assert.match(JSON.stringify(misfiled.reports.worker.roles), /declares side framework, but lives under worker/);
  fs.rmSync(path.join(shared, "roles/worker/misfiled.md"));
  const everyProject = install("framework-role", "worker");
  finish(everyProject, "s001");
  write(path.join(everyProject, ".claude/agents/general-helper.md"), role("general-helper", "framework"));
  const baseRole = path.join(everyProject, ".claude/agents/owner-review.md");
  write(baseRole, `${read(baseRole)}\nA project's improvement to a base role.\n`);
  // Shared, the new role goes to the community library, where every project can get it.
  planned = plan(everyProject);
  assert.deepEqual(
    planned.selected.map((entry: Record<string, any>) => [entry.name, entry.library, entry.files[0].target]),
    [["general-helper", "agent-loop-community", "library/roles/framework/general-helper.md"]],
  );
  assert.equal(unit(planned, "owner-review").state, "improvement");
  assert.equal(planned.library_check.ok, true, JSON.stringify(planned.library_check));
  fs.rmSync(ghLog, { force: true });
  run = cli(everyProject, "contribute", "--digest", planned.digest);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  result = reply(run);
  assert.deepEqual(changedFiles(communityRepo, "main", only(result).branch), ["A\tlibrary/roles/framework/general-helper.md"]);
  // Sent upstream, the improved base role goes back to the framework.
  upstream = plan(everyProject, "--purpose", "upstream");
  assert.deepEqual(upstream.selected.map((entry: Record<string, any>) => [entry.name, entry.library]), [["owner-review", "agent-loop-studio"]]);
  fs.rmSync(ghLog, { force: true });
  run = cli(everyProject, "contribute", "--purpose", "upstream", "--digest", upstream.digest);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  result = reply(run);
  assert.deepEqual(prCalls().map((call) => call.args[3]), ["acme/agent-loop-studio"]);
  assert.deepEqual(changedFiles(path.join(github, "acme/agent-loop-studio.git"), "main", only(result).branch), ["M\tlibrary/roles/framework/owner-review.md"]);
  for (const library of ["agent-loop-studio", "agent-loop-community"]) {
    assert.equal(git(path.join(checkout, library), "status", "--short"), "");
    assert.equal(git(path.join(checkout, library), "worktree", "list").split("\n").length, 1);
  }
  // The framework's maintainers merge it; then the framework has exactly this.
  git(frameworkMaintainer, "fetch", "--quiet", "origin");
  git(frameworkMaintainer, "merge", "--quiet", "--no-edit", `origin/${only(result).branch}`);
  git(frameworkMaintainer, "push", "--quiet", "origin", "main");
  assert.equal(unit(plan(everyProject, "--purpose", "upstream"), "owner-review").state, "in-library");

  // --- a project without a checkout fetches the one it needs ---
  const fromArchive = install("from-archive", "worker", null);
  finish(fromArchive, "s001");
  write(path.join(fromArchive, ".claude/agents/archive-role.md"), role("archive-role", "worker"));
  planned = plan(fromArchive);
  assert.equal(planned.library.available, false);
  assert.equal(planned.library.upstream, "https://github.com/justforyou16007/agent-loop-community.git");
  assert.match(planned.library.reason, /clone --purpose share/);
  assert.equal(reply(cli(fromArchive, "contribute", "--digest", "0".repeat(64))).reason, "LIBRARY_UNAVAILABLE");
  const sharedClone = cli(fromArchive, "clone");
  assert.equal(sharedClone.status, 0, sharedClone.stdout + sharedClone.stderr);
  assert.equal(reply(sharedClone).cloned, true);
  assert.equal(reply(cli(fromArchive, "clone")).cloned, false);
  planned = plan(fromArchive);
  assert.equal(planned.library.available, true);
  assert.deepEqual(selected(planned), ["archive-role"]);
  upstream = plan(fromArchive, "--purpose", "upstream");
  assert.equal(upstream.library.available, false);
  assert.equal(upstream.library.upstream, "https://github.com/justforyou16007/auto-dl-loop");
  const packaged = path.join(fromArchive, ".contrejour/package.json");
  write(packaged, JSON.stringify({ ...JSON.parse(read(packaged)), repository: { url: "git+https://github.com/acme/contrejour.git" } }));
  const upstreamClone = cli(fromArchive, "clone", "--purpose", "upstream");
  assert.equal(upstreamClone.status, 0, upstreamClone.stdout + upstreamClone.stderr);
  assert.equal(plan(fromArchive, "--purpose", "upstream").library.available, true);

  // --- a repository whose default branch has no library yet: what goes back targets the branch it has ---
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
  const earlyRole = path.join(earlyProject, ".claude/agents/problem-selector.md");
  write(earlyRole, `${read(earlyRole)}\nAn early improvement.\n`);
  upstream = plan(earlyProject, "--purpose", "upstream");
  assert.equal(upstream.library.base_branch, "feat/framework");
  assert.match(upstream.library.note, /default branch main has no library yet/);
  fs.rmSync(ghLog, { force: true });
  run = cli(earlyProject, "contribute", "--purpose", "upstream", "--digest", upstream.digest);
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
  const loneRole = path.join(loneProject, ".claude/agents/problem-selector.md");
  write(loneRole, `${read(loneRole)}\nA lone improvement.\n`);
  upstream = plan(loneProject, "--purpose", "upstream");
  assert.equal(upstream.library.remote, null);
  run = cli(loneProject, "contribute", "--purpose", "upstream", "--digest", upstream.digest);
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
  assert.equal(unit(plan(older, "--purpose", "upstream"), "problem-selector").state, "unknown-base");
  // Updating backfills only what is provably unedited.
  execFileSync(process.execPath, [installer, "--role", "worker", "--project", older], { stdio: "ignore" });
  assert.ok(fs.existsSync(path.join(older, ".contrejour/seeded/agents/implementer.md")));
  assert.equal(fs.existsSync(path.join(older, ".contrejour/seeded/agents/problem-selector.md")), false);
  assert.equal(unit(plan(older, "--purpose", "upstream"), "problem-selector").state, "unknown-base");

  console.log("contribution: sharing, sending upstream, baselines, merges, forks, own checks and fallbacks passed");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
