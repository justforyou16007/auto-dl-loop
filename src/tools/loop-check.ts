#!/usr/bin/env node
/**
 * The loop editor's compile check. `check` runs each loop's workflow script
 * against stub roles, without calling a model, several times with different stub
 * answers so other branches are reached, and reports call-flow defects: unknown
 * or unnamed roles, the clock or randomness, loops that never stop, undeclared
 * phases, roles no answer reaches, a meta that is not a pure literal, undeclared
 * triggers, and a script generated from an older definition. `stamp` records the
 * definition a script was generated from; `roles` checks role files for the
 * sections every role must have.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { createCli, runCli } from "../lib/cli.js";
import {
  DIGEST_LINE,
  TRIGGERS,
  definitionDigest,
  frontmatter,
  listLoops,
  loopDefinitionPath,
  loopScriptPath,
  parseTriggers,
  recordedDigest,
  roleNames,
  rolesDir,
} from "./loops.js";

/** Sections every role file has, so its work, its inputs and how it is judged are explicit. */
export const ROLE_SECTIONS = ["Responsibility", "Inputs", "Output", "Writes", "Evaluation"];
const MAX_ROLE_CALLS = 200;
/** The whole search for one argument sample; a script stuck in a loop without awaiting is stopped here. */
const RUN_TIMEOUT_MS = 20_000;
const MAX_RUNS = 3000;
const MAX_FLIPS = 4;

/** A JSON-like literal parser: anything that is not a literal is an error. */
function parseLiteral(text: string, start: number): { value: unknown; end: number } {
  let i = start;
  const fail = (what: string): never => {
    throw new Error(
      `meta: ${what} near "${text.slice(i, i + 30).replace(/\s+/g, " ")}" is not a literal`,
    );
  };
  const space = () => {
    for (;;) {
      if (/\s/.test(text[i] ?? "")) i += 1;
      else if (text.startsWith("//", i))
        i = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
      else if (text.startsWith("/*", i))
        i = text.indexOf("*/", i) < 0 ? fail("comment") : text.indexOf("*/", i) + 2;
      else return;
    }
  };
  const string = (): string => {
    const quote = text[i]!;
    i += 1;
    let out = "";
    while (i < text.length && text[i] !== quote) {
      if (quote === "`" && text.startsWith("${", i)) fail("a template substitution");
      if (text[i] === "\\") {
        const next = text[i + 1]!;
        const escapes: Record<string, string> = {
          n: "\n",
          t: "\t",
          r: "\r",
          b: "\b",
          f: "\f",
          v: "\v",
          "0": "\0",
        };
        if (next === "u") {
          out += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        out += escapes[next] ?? next;
        i += 2;
        continue;
      }
      out += text[i];
      i += 1;
    }
    if (text[i] !== quote) fail("an unterminated string");
    i += 1;
    return out;
  };
  const value = (): unknown => {
    space();
    const c = text[i];
    if (c === "{") {
      i += 1;
      const out: Record<string, unknown> = {};
      for (space(); text[i] !== "}"; space()) {
        let key: string;
        if (text[i] === '"' || text[i] === "'") key = string();
        else {
          const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))?.[0] ?? fail("a key");
          key = name;
          i += name.length;
        }
        space();
        if (text[i] !== ":") fail(`"${key}" without a value`);
        i += 1;
        out[key] = value();
        space();
        if (text[i] === ",") i += 1;
        else if (text[i] !== "}") fail("a separator");
      }
      i += 1;
      return out;
    }
    if (c === "[") {
      i += 1;
      const out: unknown[] = [];
      for (space(); text[i] !== "]"; space()) {
        out.push(value());
        space();
        if (text[i] === ",") i += 1;
        else if (text[i] !== "]") fail("a separator");
      }
      i += 1;
      return out;
    }
    if (c === '"' || c === "'" || c === "`") return string();
    const word = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)(?![\w$])/.exec(
      text.slice(i),
    )?.[0];
    if (!word) return fail("a value");
    i += word.length;
    return word === "true"
      ? true
      : word === "false"
        ? false
        : word === "null"
          ? null
          : Number(word);
  };
  const parsed = value();
  return { value: parsed, end: i };
}

/** The script's meta, which must open it and be a pure literal, and the body that runs. */
export function splitScript(text: string): { meta: Record<string, unknown>; body: string } {
  const opening = /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*export\s+const\s+meta\s*=/.exec(text);
  if (!opening) throw new Error("meta: the script must begin with `export const meta = {...}`");
  const { value } = parseLiteral(text, opening[0].length);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("meta: must be an object");
  const exportAt = opening[0].lastIndexOf("export");
  // Dropping the keyword leaves `const meta = {...}` in the body, as the runtime sees it.
  const body = `${text.slice(0, exportAt)}${text.slice(exportAt + "export".length)}`;
  return { meta: value as Record<string, unknown>, body };
}

interface RunInput {
  body: string;
  roles: string[];
  args: unknown;
}
interface RunOutput {
  defects: string[];
  reached: string[];
  phases: string[];
  runs: number;
}
/** Picks one of `options` alternatives at the next choice point of a run. */
type Chooser = (options: number) => number;

/** The answer a role gives when nothing is chosen: false, the first enum value, empty lists. */
function plain(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return "stub";
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum)) return s.enum[0];
  switch (s.type) {
    case "object":
      return Object.fromEntries(
        Object.entries((s.properties ?? {}) as Record<string, unknown>).map(([key, value]) => [
          key,
          plain(value),
        ]),
      );
    case "array":
      return [];
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 1;
    default:
      return "stub";
  }
}
/**
 * A stub answer that satisfies a role's output schema. Every boolean, enum and
 * list of it is a choice point: the chooser decides its value, so a search over
 * the choices reaches the script's branches.
 */
function stub(schema: unknown, choose: Chooser, depth = 0): unknown {
  if (!schema || typeof schema !== "object" || depth > 5) return plain(schema);
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum)) return s.enum[choose(s.enum.length)];
  switch (s.type) {
    case "object":
      return Object.fromEntries(
        Object.entries((s.properties ?? {}) as Record<string, unknown>).map(([key, value]) => [
          key,
          stub(value, choose, depth + 1),
        ]),
      );
    case "array":
      return choose(2) === 1 ? [plain(s.items), plain(s.items)] : [];
    case "boolean":
      return choose(2) === 1;
    default:
      return plain(schema);
  }
}

/**
 * Runs of a script body against stub roles, inside one worker thread. The first
 * run takes the plain answer at every choice point; later runs change one more
 * choice at a time (breadth first, up to MAX_FLIPS changes), so branches that
 * need several answers at once are reached without trying every combination.
 */
async function explore(input: RunInput): Promise<RunOutput> {
  const defects: string[] = [];
  const reached = new Set<string>();
  const phases = new Set<string>();
  const forbidden = (what: string) => () => {
    defects.push(`${what} is not allowed: it breaks resuming a run`);
    return 0;
  };
  const DateStub = new Proxy(Date, {
    apply: forbidden("Date()"),
    construct: (target, args) =>
      (args.length
        ? new target(...(args as [number]))
        : (forbidden("new Date()")(), new target(0))) as object,
    get: (target, key) => (key === "now" ? forbidden("Date.now()") : Reflect.get(target, key)),
  });
  const MathStub = new Proxy(Math, {
    get: (target, key) =>
      key === "random" ? forbidden("Math.random()") : Reflect.get(target, key),
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...params: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  let script: (...args: unknown[]) => Promise<unknown>;
  try {
    script = new AsyncFunction(
      "agent",
      "parallel",
      "pipeline",
      "phase",
      "log",
      "args",
      "budget",
      "workflow",
      "Date",
      "Math",
      input.body,
    );
  } catch (error) {
    return {
      defects: [`the script does not parse: ${(error as Error).message}`],
      reached: [],
      phases: [],
      runs: 0,
    };
  }
  const queue: Map<number, number>[] = [new Map()];
  let runs = 0;
  while (queue.length && runs < MAX_RUNS) {
    const flips = queue.shift()!;
    const trace: number[] = [];
    const choose: Chooser = (options) => {
      const index = trace.length;
      trace.push(options);
      return Math.min(flips.get(index) ?? 0, options - 1);
    };
    let calls = 0;
    const agent = async (prompt: unknown, options: Record<string, unknown> = {}) => {
      calls += 1;
      if (calls > MAX_ROLE_CALLS)
        throw new Error(`more than ${MAX_ROLE_CALLS} role calls: a loop has no working bound`);
      if (typeof options.agentType !== "string" || !options.agentType)
        defects.push(`a step names no role: agent(${JSON.stringify(String(prompt).slice(0, 40))})`);
      else {
        reached.add(options.agentType);
        if (!input.roles.includes(options.agentType))
          defects.push(`unknown role "${options.agentType}"`);
      }
      if (typeof options.phase === "string") phases.add(options.phase);
      return options.schema ? stub(options.schema, choose) : "stub";
    };
    const parallel = (thunks: (() => Promise<unknown>)[]) =>
      Promise.all(thunks.map((thunk) => thunk().catch(() => null)));
    const pipeline = (
      items: unknown[],
      ...stages: ((r: unknown, item: unknown, i: number) => unknown)[]
    ) =>
      Promise.all(
        items.map(async (item, index) => {
          let result: unknown = item;
          for (const stage of stages) result = await stage(result, item, index);
          return result;
        }),
      );
    try {
      await script(
        agent,
        parallel,
        pipeline,
        (title: unknown) => phases.add(String(title)),
        () => {},
        input.args,
        { total: null, spent: () => 0, remaining: () => Infinity },
        async () => null,
        DateStub,
        MathStub,
      );
    } catch (error) {
      defects.push(`run failed: ${(error as Error).message}`);
    }
    runs += 1;
    // Each further run changes one more choice, after the last one this run changed.
    if (flips.size < MAX_FLIPS) {
      const after = flips.size ? Math.max(...flips.keys()) + 1 : 0;
      for (let index = after; index < trace.length; index += 1)
        for (let option = 1; option < trace[index]!; option += 1)
          queue.push(new Map([...flips, [index, option]]));
    }
  }
  return { defects: [...new Set(defects)], reached: [...reached], phases: [...phases], runs };
}

function exploreInWorker(input: RunInput): Promise<RunOutput> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: input });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({
        defects: [`did not finish within ${RUN_TIMEOUT_MS / 1000}s under stub roles`],
        reached: [],
        phases: [],
        runs: 0,
      });
    }, RUN_TIMEOUT_MS);
    worker.once("message", (output: RunOutput) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(output);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      resolve({ defects: [`run failed: ${error.message}`], reached: [], phases: [], runs: 0 });
    });
  });
}

export interface LoopReport {
  loop: string;
  ok: boolean;
  stale: boolean;
  roles_called: string[];
  defects: string[];
}

export async function checkLoop(root: string, name: string): Promise<LoopReport> {
  const defects: string[] = [];
  const report = (stale: boolean, called: string[] = []): LoopReport => {
    const unique = [...new Set(defects)];
    return {
      loop: name,
      ok: !unique.length && !stale,
      stale,
      roles_called: called,
      defects: unique,
    };
  };
  const definitionFile = loopDefinitionPath(root, name);
  const scriptFile = loopScriptPath(root, name);
  if (!fs.existsSync(definitionFile)) defects.push(`no definition ${definitionFile}`);
  if (!fs.existsSync(scriptFile)) defects.push(`no script ${scriptFile}`);
  if (defects.length) return report(true);
  const definition = fs.readFileSync(definitionFile);
  const fields = frontmatter(definition.toString("utf8"));
  for (const action of parseTriggers(fields.triggers))
    if (!TRIGGERS[action])
      defects.push(`unknown trigger "${action}"; known: ${Object.keys(TRIGGERS).join(", ")}`);
  let samples: unknown[] = [{}];
  if (fields["check-args"]) {
    try {
      const parsed: unknown = JSON.parse(fields["check-args"]);
      samples = Array.isArray(parsed) && parsed.length ? parsed : [parsed];
    } catch {
      defects.push("check-args must be one line of JSON: a list of argument objects");
    }
  }
  const text = fs.readFileSync(scriptFile, "utf8");
  const stale = recordedDigest(text) !== definitionDigest(definition);
  let split: { meta: Record<string, unknown>; body: string };
  try {
    split = splitScript(text);
  } catch (error) {
    defects.push((error as Error).message);
    return report(stale);
  }
  const { meta, body } = split;
  if (meta.name !== name) defects.push(`meta.name must be "${name}", the loop's name`);
  if (typeof meta.description !== "string" || !meta.description)
    defects.push("meta.description is required");
  if (/\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)|\bMath\s*\.\s*random\b/.test(body))
    defects.push("the script uses the clock or randomness, which break resuming a run");
  const roles = [...roleNames(root).values()];
  const named = new Set(
    [...body.matchAll(/agentType\s*:\s*(['"`])([^'"`]+)\1/g)].map((match) => match[2]!),
  );
  for (const role of named) if (!roles.includes(role)) defects.push(`unknown role "${role}"`);
  const reached = new Set<string>();
  const phases = new Set<string>();
  for (const args of samples) {
    const output = await exploreInWorker({ body, roles, args });
    defects.push(...output.defects);
    output.reached.forEach((role) => reached.add(role));
    output.phases.forEach((title) => phases.add(title));
  }
  for (const role of named)
    if (roles.includes(role) && !reached.has(role))
      defects.push(`role "${role}" is never reached under any stub answer`);
  const declared = new Set(
    (Array.isArray(meta.phases) ? meta.phases : []).map((entry) =>
      entry && typeof entry === "object" ? String((entry as Record<string, unknown>).title) : "",
    ),
  );
  for (const title of phases)
    if (!declared.has(title)) defects.push(`phase "${title}" is not declared in meta.phases`);
  return report(stale, [...reached].sort());
}

/** Record the definition a script was generated from, as its last line. */
export function stampLoop(root: string, name: string): { loop: string; definition_sha256: string } {
  const digest = definitionDigest(fs.readFileSync(loopDefinitionPath(root, name)));
  const file = loopScriptPath(root, name);
  const text = fs
    .readFileSync(file, "utf8")
    .replace(new RegExp(DIGEST_LINE.source, "gm"), "")
    .trimEnd();
  fs.writeFileSync(file, `${text}\n\n// contrejour-loop-definition-sha256: ${digest}\n`);
  return { loop: name, definition_sha256: digest };
}

export interface RoleReport {
  role: string;
  ok: boolean;
  defects: string[];
}
/** Every role file names itself after its file, describes itself and has the required sections. */
export function checkRoles(root: string, only?: string[]): RoleReport[] {
  const dir = rolesDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md") && (!only?.length || only.includes(file.slice(0, -3))))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const fields = frontmatter(text);
      const defects: string[] = [];
      if (fields.name !== file.slice(0, -3))
        defects.push(`frontmatter name must be "${file.slice(0, -3)}"`);
      if (!fields.description) defects.push("frontmatter description is required");
      for (const section of ROLE_SECTIONS)
        if (!new RegExp(`^##\\s+${section}\\b`, "mi").test(text))
          defects.push(`missing section "## ${section}"`);
      return { role: file.slice(0, -3), ok: !defects.length, defects };
    });
}

function cli(): void {
  const program = createCli("loop-check", "Check Contrejour loops and roles");
  const print = (value: unknown, ok: boolean) => {
    console.log(JSON.stringify(value, null, 2));
    if (!ok) process.exitCode = 1;
  };
  program
    .command("check")
    .description("Run each loop's script against stub roles and report call-flow defects")
    .requiredOption("--project <dir>")
    .argument("[loops...]", "loop names; every loop in .claude/loops when omitted")
    .action(async (loops: string[], options: { project: string }) => {
      const names = loops.length ? loops : listLoops(options.project);
      const reports: LoopReport[] = [];
      for (const name of names) reports.push(await checkLoop(options.project, name));
      print(
        reports,
        reports.every((entry) => entry.ok),
      );
    });
  program
    .command("stamp")
    .description("Record in the script which version of the definition it was generated from")
    .requiredOption("--project <dir>")
    .argument("<loop>")
    .action((loop: string, options: { project: string }) =>
      print(stampLoop(options.project, loop), true),
    );
  program
    .command("roles")
    .description("Check role files for their name, description and required sections")
    .requiredOption("--project <dir>")
    .argument("[roles...]")
    .action((roles: string[], options: { project: string }) => {
      const reports = checkRoles(options.project, roles);
      print(
        reports,
        reports.every((entry) => entry.ok),
      );
    });
  runCli(program);
}

if (!isMainThread) {
  void explore(workerData as RunInput).then((output) => parentPort!.postMessage(output));
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli();
}
