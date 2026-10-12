#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCli, runCli } from "../lib/cli.js";
import { quarantine } from "./threat-scan.js";
import { anyJsonSchema, canonicalJsonSha256 } from "./canonical-json.js";
import {
  assertWikiSchemaSupported,
  commitWikiChange,
  eventLogHead,
  initializeWikiSchema,
  type WikiDelta,
  type WikiEvent,
  type WikiAppendResult,
} from "./wiki-event-store.js";
import {
  CLAIM_STATUSES,
  EXPERIMENT_RESULTS,
  IDEA_OUTCOMES,
  MIN_QUERY_CHARS,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  WIKI_EDGE_TYPES,
  isWikiEdgeType,
  wikiEdgeEndpointError,
  wikiNodeKind,
  type WikiEdgeType,
  type WikiOperation,
} from "./wiki-operations.js";
import {
  WIKI_PAGE_LAYOUT,
  findPage,
  ideaResult,
  projectWiki,
  applyWikiOperations,
  projectWikiFromEvents,
  readWikiModel,
  replayWikiEvents,
  wikiStateDigest,
  type WikiModel,
} from "./wiki-projector.js";
import { WIKI_SCOPE } from "./wiki-scope.js";

const ARXIV_API = "https://export.arxiv.org/api/query?id_list={ids}";

/** `<author><year>_<keywords>`; just `<keywords>` when neither author nor year is known. */
function slugify(title: string, authorLast = "", year = 0): string {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "of",
    "for",
    "in",
    "on",
    "with",
    "via",
    "and",
    "to",
    "by",
  ]);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/);
  const keywords = words.filter((word) => !stopWords.has(word) && word.length > 2);
  const keyword = keywords.length > 0 ? keywords.slice(0, 3).join("_") : "untitled";
  const author = authorLast.toLowerCase().replace(/[^a-z]/g, "");
  if (!author && !year) return keyword;
  return `${author || "unknown"}${year ? String(year) : "0000"}_${keyword}`;
}

function xmlFindAll(xml: string, localName: string): string[] {
  const pattern = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${localName}>`,
    "g",
  );
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) values.push(match[1]!);
  return values;
}

function xmlFindFirst(xml: string, localName: string): string | null {
  const match = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${localName}>`,
  ).exec(xml);
  return match ? match[1]! : null;
}

function xmlSelfClosingAttr(xml: string, localName: string, attribute: string): string | null {
  const match = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${localName}[^>]*?\\b${attribute}="([^"]*)"[^>]*\\/?>`,
  ).exec(xml);
  return match ? match[1]! : null;
}

function arxivUserAgent(): string {
  const contact = (process.env.ARIS_VERIFY_EMAIL ?? "").trim();
  const base =
    "ARIS-research-wiki/1.0 (+https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep)";
  return contact ? `${base} (mailto:${contact})` : base;
}

function httpGet(url: string, timeout: number, userAgent: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const request = client.get(
      url,
      { headers: { "User-Agent": userAgent }, timeout },
      (response) => {
        if (response.statusCode === 429) {
          reject(new Error("HTTP 429"));
          return;
        }
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          httpGet(response.headers.location, timeout, userAgent).then(resolve, reject);
          return;
        }
        if (response.statusCode && response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function arxivApiGet(url: string, what: string, timeout = 15_000): Promise<string> {
  const userAgent = arxivUserAgent();
  try {
    const body = await httpGet(url, timeout, userAgent);
    const text = body.toString("utf-8");
    if (text.trim() === "Rate exceeded.") throw new Error("arXiv API rate-limited");
    return text;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`arXiv API fetch failed for ${what}: ${message}`);
  }
}

function normalizeArxivId(value: string): string {
  let normalized = value.trim();
  for (const prefix of ["arXiv:", "arxiv:", "http://arxiv.org/abs/", "https://arxiv.org/abs/"]) {
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      normalized = normalized.slice(prefix.length);
    }
  }
  return normalized.replace(/v\d+$/, "");
}

interface ArxivMeta {
  arxiv_id: string;
  title: string;
  authors: string[];
  year: number;
  venue: string;
  abstract: string;
  primary_category: string;
  doi?: string;
}

function parseArxivEntry(entry: string): ArxivMeta {
  const title = (xmlFindFirst(entry, "title") ?? "").replace(/\s+/g, " ").trim();
  const abstract = (xmlFindFirst(entry, "summary") ?? "").replace(/\s+/g, " ").trim();
  const published = (xmlFindFirst(entry, "published") ?? "").trim();
  const year = /^\d{4}$/.test(published.slice(0, 4))
    ? Number.parseInt(published.slice(0, 4), 10)
    : 0;
  const authors = xmlFindAll(entry, "author")
    .map((author) => (xmlFindFirst(author, "name") ?? "").trim())
    .filter(Boolean);
  const rawId = (xmlFindFirst(entry, "id") ?? "").trim();
  const arxivId = rawId.includes("/abs/") ? normalizeArxivId(rawId.split("/abs/")[1]!) : "";
  return {
    arxiv_id: arxivId,
    title,
    authors,
    year,
    venue: (xmlFindFirst(entry, "journal_ref") ?? "").trim() || "arXiv",
    abstract,
    primary_category: xmlSelfClosingAttr(entry, "primary_category", "term") ?? "",
  };
}

async function fetchArxivMetadata(arxivId: string, timeout = 15_000): Promise<ArxivMeta> {
  const normalized = normalizeArxivId(arxivId);
  const body = await arxivApiGet(ARXIV_API.replace("{ids}", normalized), normalized, timeout);
  const entry = xmlFindFirst(body, "entry");
  if (!entry) throw new Error(`arXiv API returned no entry for ${normalized}`);
  const metadata = parseArxivEntry(entry);
  metadata.arxiv_id = normalized;
  return metadata;
}

async function fetchArxivMetadataBatch(
  ids: string[],
  timeout = 30_000,
): Promise<Record<string, ArxivMeta>> {
  const normalized = ids.map(normalizeArxivId).filter(Boolean);
  if (normalized.length === 0) return {};
  const url = `${ARXIV_API.replace("{ids}", normalized.join(","))}&max_results=${normalized.length}`;
  const body = await arxivApiGet(url, `id_list[${normalized.length}]`, timeout);
  const result: Record<string, ArxivMeta> = {};
  for (const entry of xmlFindAll(body, "entry")) {
    const metadata = parseArxivEntry(entry);
    if (metadata.arxiv_id) result[metadata.arxiv_id] = metadata;
  }
  return result;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertNotAbsoluteIdentifier(value: string, label: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  const pathPart = trimmed.includes(":") ? trimmed.slice(trimmed.indexOf(":") + 1) : trimmed;
  if (
    path.isAbsolute(trimmed) ||
    path.isAbsolute(pathPart) ||
    /^[\\/]/.test(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(pathPart)
  ) {
    throw new Error(`${label} must be a relative identifier, not an absolute path`);
  }
}

function assertOneOf(value: string, allowed: readonly string[], label: string): void {
  if (!allowed.includes(value)) {
    throw new Error(`unknown ${label} '${value}' (expected ${allowed.join(" | ")})`);
  }
}

function normalizeNodeId(value: string, defaultPrefix: string): string {
  const trimmed = value.trim();
  assertNotAbsoluteIdentifier(trimmed, "node id");
  return trimmed ? (trimmed.includes(":") ? trimmed : `${defaultPrefix}:${trimmed}`) : "";
}

/** Normalize, check the kind and dedupe a list of node ids given to `operation`. */
function nodeIds(values: string[] | undefined, kind: string, operation: string): string[] {
  const ids: string[] = [];
  for (const raw of values ?? []) {
    const id = normalizeNodeId(raw, kind);
    if (!id) continue;
    if (wikiNodeKind(id) !== kind)
      throw new Error(`${operation}: expected ${kind} ids, got '${id}'`);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function assertNodeExists(model: WikiModel, nodeId: string, operation: string): void {
  if (!findPage(model, nodeId)) throw new Error(`${operation}: ${nodeId} not found in this wiki`);
}

function edgeOperation(from: string, to: string, type: WikiEdgeType): WikiOperation {
  return { op: "upsert_edge", edge: { from, to, type, evidence: `${from} ${type} ${to}` } };
}

function sanitizeText(value: string, label: string, operations: WikiOperation[]): string {
  if (!value) return value;
  const [safe, findings] = quarantine(value, "strict", label);
  if (findings.length > 0) {
    operations.push({ op: "quarantine", target: label, findings, raw_text: value });
    console.error(`Warning: ${label} was quarantined (${findings.join(", ")}).`);
  }
  return safe;
}

function appendEvidenceOnce(existing: string, incoming: string): string {
  const current = existing.trim();
  const next = incoming.trim();
  if (!next || !current) return current || next;
  if (current.split("\n\n").some((part) => part.trim() === next)) return current;
  return `${current}\n\n${next}`;
}

type EvidenceBundleId = string | ((events: readonly WikiEvent[], model: WikiModel) => string);
type OperationBuilder = (model: WikiModel) => WikiOperation[] | null;

function commitOperations(
  wikiRoot: string,
  subjectId: string,
  evidenceBundleId: EvidenceBundleId,
  build: OperationBuilder,
): WikiAppendResult | { status: "skipped"; event: null } {
  const result = commitWikiChange(
    wikiRoot,
    (events: readonly WikiEvent[]): WikiDelta | null => {
      const model = replayWikiEvents(events);
      const operations = build(model);
      if (operations === null) return null;
      const evidence =
        typeof evidenceBundleId === "function" ? evidenceBundleId(events, model) : evidenceBundleId;
      // A command that changes nothing but the log is skipped, so a retry is a
      // no-op; one that only appends to the log is the `log` command itself.
      if (operations.some((operation) => operation.op !== "append_log")) {
        const before = wikiStateDigest(model);
        applyWikiOperations(model, operations, "");
        if (wikiStateDigest(model) === before) return null;
      }
      // The log head makes a command that returns to an earlier state (solved →
      // open → solved) a new command instead of a duplicate of the first one.
      const head = eventLogHead(events).event_id ?? "genesis";
      return {
        producer_kind: "standalone-research-wiki",
        scope: WIKI_SCOPE,
        subject_id: subjectId,
        evidence_bundle_id: `${evidence || subjectId}@${head}`,
        payload: { operations },
      };
    },
    (events) => projectWikiFromEvents(wikiRoot, events),
  );
  if (result.status === "conflict") {
    throw new Error(
      `WIKI_COMMAND_CONFLICT: command ${result.command_id} conflicts with an existing payload`,
    );
  }
  return result;
}

function addLog(operations: WikiOperation[], message: string): void {
  operations.push({ op: "append_log", message });
}

/** A supplied slug may carry its own kind prefix (`idea:x`); it names the same node as `x`. */
function nodeSlugify(name: string, supplied: string, prefix: string): string {
  if (supplied.trim()) {
    assertNotAbsoluteIdentifier(supplied, "node slug");
    const value = supplied
      .trim()
      .replace(new RegExp(`^${prefix}:`), "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-|-$/g, "");
    if (value) return value;
  }
  return slugify(name) || "node";
}

function pagePath(root: string, kind: keyof typeof WIKI_PAGE_LAYOUT, slug: string): string {
  return path.join(root, WIKI_PAGE_LAYOUT[kind].dir, `${slug}.md`);
}

function existingString(existing: JsonObject | undefined, key: string, fallback = ""): string {
  return typeof existing?.[key] === "string" ? existing[key] : fallback;
}

function initWiki(wikiRoot: string): void {
  initializeWikiSchema(wikiRoot);
  projectWiki(wikiRoot);
  console.log(`Research wiki initialized at ${path.resolve(wikiRoot)}`);
}

function addEdge(
  wikiRoot: string,
  fromInput: string,
  toInput: string,
  edgeType: string,
  evidence = "",
): void {
  const from = fromInput.trim();
  const to = toInput.trim();
  assertNotAbsoluteIdentifier(from, "edge source");
  assertNotAbsoluteIdentifier(to, "edge target");
  if (!isWikiEdgeType(edgeType)) {
    throw new Error(
      `add_edge: unknown edge type '${edgeType}'. Valid: ${WIKI_EDGE_TYPES.join(", ")}`,
    );
  }
  const endpointError = wikiEdgeEndpointError(from, to, edgeType);
  if (endpointError) throw new Error(`add_edge: ${endpointError}`);
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  const result = commitOperations(
    root,
    `edge:${from}:${edgeType}:${to}`,
    `${from}->${to}`,
    (model) => {
      assertNodeExists(model, from, "add_edge");
      assertNodeExists(model, to, "add_edge");
      if (
        model.edges.some((edge) => edge.from === from && edge.to === to && edge.type === edgeType)
      ) {
        console.log(`Edge already exists: ${from} --${edgeType}--> ${to}`);
        return null;
      }
      const opposite = { solves: "reproduces", reproduces: "solves" }[edgeType as string];
      if (
        opposite &&
        model.edges.some((edge) => edge.from === from && edge.to === to && edge.type === opposite)
      )
        throw new Error(`add_edge: ${from} already ${opposite} ${to}; one result cannot do both`);
      const operations: WikiOperation[] = [];
      const safeEvidence = sanitizeText(evidence, `edge ${from} -> ${to}`, operations);
      operations.push({
        op: "upsert_edge",
        edge: { from, to, type: edgeType, evidence: safeEvidence },
      });
      addLog(operations, `add_edge: ${from} --${edgeType}--> ${to}`);
      return operations;
    },
  );
  if (result.status === "skipped") {
    console.log(`Edge unchanged: ${from} --${edgeType}--> ${to}`);
    return;
  }
  console.log(`Edge added: ${from} --${edgeType}--> ${to}`);
}

function normalizeSourceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`ingest_survey: --url must be an absolute http(s) URL, got '${trimmed}'`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`ingest_survey: --url must use http or https, got '${parsed.protocol}'`);
  }
  return parsed.href;
}

function findExistingSurvey(model: WikiModel, arxivId: string, url: string): string | null {
  for (const page of model.pages.survey.values()) {
    const external = isObject(page.data.external_ids) ? page.data.external_ids : {};
    if (arxivId && external.arxiv === arxivId) return page.id;
    if (!arxivId && url && page.data.url === url) return page.id;
  }
  return null;
}

interface SurveyOptions {
  arxivId?: string;
  url?: string;
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  thesis?: string;
  tags?: string[];
  problems?: string[];
  updateOnExist?: boolean;
  prefetchedMeta?: ArxivMeta;
}

async function ingestSurvey(wikiRoot: string, options: SurveyOptions): Promise<string> {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  const arxivId = options.arxivId ? normalizeArxivId(options.arxivId) : "";
  const authors = options.authors ?? [];
  const year = options.year ?? 0;
  if (!arxivId && !(options.title && (options.url || (authors.length > 0 && year)))) {
    throw new Error(
      "ingest_survey: without --arxiv-id, pass --title with --url, or --title with --authors and --year.",
    );
  }
  const problems = nodeIds(options.problems, "problem", "ingest_survey");
  const metadata: ArxivMeta = arxivId
    ? { ...(options.prefetchedMeta ?? (await fetchArxivMetadata(arxivId))), arxiv_id: arxivId }
    : {
        arxiv_id: "",
        title: "",
        authors: [],
        year: 0,
        venue: "",
        abstract: "",
        primary_category: "",
      };
  if (options.title) metadata.title = options.title;
  if (authors.length > 0) metadata.authors = authors;
  if (year) metadata.year = year;
  if (options.venue) metadata.venue = options.venue;
  const url = normalizeSourceUrl(
    options.url || (arxivId ? `https://arxiv.org/abs/${arxivId}` : ""),
  );

  const authorLast = metadata.authors[0]?.trim().split(/\s+/).at(-1) ?? "";
  const titleSlug = slugify(metadata.title, authorLast, metadata.year);
  let slug = titleSlug;
  let existedBefore = false;
  const result = commitOperations(
    root,
    `survey:${titleSlug}`,
    options.doi || arxivId || url || titleSlug,
    (model) => {
      slug = findExistingSurvey(model, arxivId, url) ?? titleSlug;
      const subject = `survey:${slug}`;
      existedBefore = model.pages.survey.has(slug);
      if (existedBefore && !options.updateOnExist) {
        console.log(
          `Survey already ingested: ${subject} — skipping (use --update-on-exist or add_edge).`,
        );
        return null;
      }
      for (const problem of problems) assertNodeExists(model, problem, "ingest_survey");
      const operations: WikiOperation[] = [];
      operations.push({
        op: "upsert_page",
        kind: "survey",
        id: slug,
        data: {
          title: metadata.title,
          authors: [...metadata.authors],
          year: metadata.year,
          venue: metadata.venue,
          url,
          external_ids: { arxiv: metadata.arxiv_id, doi: options.doi ?? "" },
          tags: options.tags ?? [],
          thesis: sanitizeText(options.thesis ?? "", `survey ${slug}.thesis`, operations),
          abstract: sanitizeText(metadata.abstract, `survey ${slug}.abstract`, operations),
        },
      });
      for (const problem of problems) operations.push(edgeOperation(subject, problem, "addresses"));
      addLog(
        operations,
        `ingest_survey: ${options.updateOnExist ? "updated" : "ingested"} ${subject} (${arxivId ? `arxiv:${arxivId}` : url || "manual"})`,
      );
      return operations;
    },
  );
  const file = pagePath(root, "survey", slug);
  if (result.status !== "skipped")
    console.log(`Survey ${existedBefore ? "updated" : "ingested"}: ${file}`);
  return file;
}

function addClaim(
  wikiRoot: string,
  suppliedSlug: string,
  name: string,
  options: {
    description?: string;
    status?: string;
    provenance?: string;
    statement?: string;
    scope?: string;
    evidence?: string;
    tags?: string[];
    addresses?: string[];
    extends?: string[];
    uses?: string[];
    dependsOn?: string[];
    refutes?: string[];
    updateOnExist?: boolean;
  },
): void {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  const status = options.status ?? "drafted";
  assertOneOf(status, CLAIM_STATUSES, "claim status");
  const slug = nodeSlugify(name, suppliedSlug, "claim");
  const subject = `claim:${slug}`;
  const references: Array<[string[], WikiEdgeType]> = [
    [nodeIds(options.addresses, "problem", "add_claim"), "addresses"],
    [nodeIds(options.extends, "survey", "add_claim"), "extends"],
    [nodeIds(options.uses, "survey", "add_claim"), "uses"],
    [nodeIds(options.dependsOn, "claim", "add_claim"), "depends_on"],
    [nodeIds(options.refutes, "claim", "add_claim"), "refutes"],
  ];
  let existedBefore = false;
  const result = commitOperations(root, subject, options.provenance || subject, (model) => {
    existedBefore = model.pages.claim.has(slug);
    if (existedBefore && !options.updateOnExist) {
      console.log(`Claim already exists: ${slug}.md (slug dedup) — skipping.`);
      return null;
    }
    const operations: WikiOperation[] = [];
    const data = {
      name,
      description: sanitizeText(options.description ?? "", `claim ${slug}.description`, operations),
      status,
      provenance: options.provenance ?? "",
      statement: sanitizeText(options.statement ?? "", `claim ${slug}.statement`, operations),
      scope: sanitizeText(options.scope ?? "", `claim ${slug}.scope`, operations),
      evidence: sanitizeText(options.evidence ?? "", `claim ${slug}.evidence`, operations),
      tags: options.tags ?? [],
      date: "",
    };
    operations.unshift({ op: "upsert_page", kind: "claim", id: slug, data });
    for (const [targets, type] of references) {
      for (const target of targets) {
        assertNodeExists(model, target, "add_claim");
        operations.push(edgeOperation(subject, target, type));
      }
    }
    addLog(
      operations,
      `add_claim: ${options.updateOnExist ? "updated" : "added"} ${subject} [status=${status}]`,
    );
    return operations;
  });
  const file = pagePath(root, "claim", slug);
  if (result.status === "skipped") {
    console.log(`Claim unchanged: ${file}`);
    return;
  }
  console.log(`Claim ${existedBefore ? "updated" : "added"}: ${file} [status=${status}]`);
}

function upsertIdea(
  wikiRoot: string,
  suppliedSlug: string,
  title: string,
  options: {
    description?: string;
    outcome?: string;
    thesis?: string;
    risks?: string;
    tags?: string[];
    basedOn?: string[];
    targetProblems?: string[];
    updateOnExist?: boolean;
  },
): void {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  if (options.outcome !== undefined) assertOneOf(options.outcome, IDEA_OUTCOMES, "idea outcome");
  const slug = nodeSlugify(title, suppliedSlug, "idea");
  const subject = `idea:${slug}`;
  const basedOn = nodeIds(options.basedOn, "survey", "upsert_idea --based-on");
  const targetProblems = nodeIds(
    options.targetProblems,
    "problem",
    "upsert_idea --target-problems",
  );
  let existedBefore = false;
  let outcome = options.outcome ?? "pending";
  const result = commitOperations(root, subject, subject, (model) => {
    const existing = model.pages.idea.get(slug)?.data;
    existedBefore = existing !== undefined;
    if (existedBefore && !options.updateOnExist) {
      console.log(`Idea already exists: ${slug}.md (slug dedup) — skipping.`);
      return null;
    }
    // Like add_problem, an update keeps every field it does not set.
    outcome = options.outcome ?? existingString(existing, "outcome", "pending");
    for (const target of [...basedOn, ...targetProblems])
      assertNodeExists(model, target, "upsert_idea");
    const operations: WikiOperation[] = [];
    operations.push({
      op: "upsert_page",
      kind: "idea",
      id: slug,
      data: {
        title,
        description: sanitizeText(
          options.description ?? existingString(existing, "description"),
          `idea ${slug}.description`,
          operations,
        ),
        outcome,
        thesis: sanitizeText(
          options.thesis ?? existingString(existing, "thesis"),
          `idea ${slug}.thesis`,
          operations,
        ),
        risks: sanitizeText(
          options.risks ?? existingString(existing, "risks"),
          `idea ${slug}.risks`,
          operations,
        ),
        tags: options.tags ?? (Array.isArray(existing?.tags) ? existing.tags : []),
      },
    });
    for (const target of basedOn) operations.push(edgeOperation(subject, target, "inspired_by"));
    for (const target of targetProblems)
      operations.push(edgeOperation(subject, target, "addresses"));
    addLog(
      operations,
      `upsert_idea: ${options.updateOnExist ? "updated" : "added"} ${subject} [outcome=${outcome}]`,
    );
    return operations;
  });
  if (result.status === "skipped") {
    console.log(`Idea unchanged: ${pagePath(root, "idea", slug)}`);
    return;
  }
  console.log(
    `Idea ${existedBefore ? "updated" : "added"}: ${pagePath(root, "idea", slug)} [outcome=${outcome}]`,
  );
}

function addExperiment(
  wikiRoot: string,
  slugInput: string,
  options: {
    title?: string;
    idea?: string;
    result?: string;
    metrics?: string;
    reasoning?: string;
    tags?: string[];
    /** Validation service submission whose published result these metrics come from. */
    submissionId?: string;
    solves?: string[];
    reproduces?: string[];
    updateOnExist?: boolean;
  },
): void {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  assertNotAbsoluteIdentifier(slugInput, "experiment slug");
  const slug = slugInput
    .trim()
    .replace(/^exp:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("experiment slug (exp id) is required and must be non-empty");
  const outcome = options.result ?? "";
  if (outcome) assertOneOf(outcome, EXPERIMENT_RESULTS, "experiment result");
  const ideaId = options.idea
    ? (nodeIds([options.idea], "idea", "add_experiment --idea")[0] ?? "")
    : "";
  const solves = nodeIds(options.solves, "problem", "add_experiment --solves");
  const reproduces = nodeIds(options.reproduces, "problem", "add_experiment --reproduces");
  const conflicting = solves.filter((id) => reproduces.includes(id));
  if (conflicting.length > 0) {
    throw new Error(
      `add_experiment: ${conflicting.join(", ")} cannot be both solved and reproduced`,
    );
  }
  const subject = `exp:${slug}`;
  let existedBefore = false;
  let reused = false;
  const result = commitOperations(root, subject, options.submissionId || subject, (model) => {
    existedBefore = model.pages.experiment.has(slug);
    // An experiment that already supports or invalidates a claim has been
    // judged. Writing it again would replace the evidence those claims stand
    // on, so the existing page is kept even with --update-on-exist.
    reused =
      existedBefore &&
      model.edges.some(
        (edge) =>
          edge.from === subject &&
          (edge.type === "supports" || edge.type === "invalidates") &&
          edge.to.startsWith("claim:"),
      );
    if (reused) return null;
    if (existedBefore && !options.updateOnExist) {
      console.log(`Experiment already exists: ${slug}.md (slug dedup) — skipping.`);
      return null;
    }
    for (const target of [ideaId, ...solves, ...reproduces].filter(Boolean))
      assertNodeExists(model, target, "add_experiment");
    const operations: WikiOperation[] = [];
    // Keyed on the flag, not on existence, so a retried update yields the same
    // payload and is deduplicated by its command id.
    if (options.updateOnExist) {
      for (const type of ["supports", "invalidates", "solves", "reproduces"] as const)
        operations.push({ op: "remove_edges", from: subject, type });
      operations.push({ op: "remove_edges", to: subject, type: "tested_by" });
    }
    operations.push({
      op: "upsert_page",
      kind: "experiment",
      id: slug,
      data: {
        title: options.title ?? "",
        idea_id: ideaId,
        result: outcome,
        submission_id: options.submissionId ?? "",
        metrics: sanitizeText(options.metrics ?? "", `experiment ${slug}.metrics`, operations),
        reasoning: sanitizeText(
          options.reasoning ?? "",
          `experiment ${slug}.reasoning`,
          operations,
        ),
        tags: options.tags ?? [],
      },
    });
    if (ideaId) {
      operations.push(edgeOperation(ideaId, subject, "tested_by"));
      if (outcome === "effective") operations.push(edgeOperation(subject, ideaId, "supports"));
      if (outcome === "ineffective") operations.push(edgeOperation(subject, ideaId, "invalidates"));
    }
    for (const problem of solves) operations.push(edgeOperation(subject, problem, "solves"));
    for (const problem of reproduces)
      operations.push(edgeOperation(subject, problem, "reproduces"));
    addLog(
      operations,
      `add_experiment: ${options.updateOnExist ? "updated" : "added"} ${subject} [result=${outcome || "-"}]`,
    );
    return operations;
  });
  const file = pagePath(root, "experiment", slug);
  if (reused) {
    console.log(`Experiment reused: ${file} already formed claims; page and claim edges kept.`);
    return;
  }
  if (result.status === "skipped") {
    console.log(`Experiment unchanged: ${file}`);
    return;
  }
  console.log(
    `Experiment ${existedBefore ? "updated" : "added"}: ${file} [result=${outcome || "-"}]`,
  );
}

function addProblem(
  wikiRoot: string,
  suppliedSlug: string,
  suppliedTitle: string,
  options: {
    status?: string;
    severity?: string;
    parent?: string;
    statement?: string;
    origin?: string;
    evidence?: string;
    whatWouldSolve?: string;
    tags?: string[];
    updateOnExist?: boolean;
  },
): void {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  const slug = nodeSlugify(suppliedTitle, suppliedSlug, "problem");
  const subject = `problem:${slug}`;
  const parentInput = options.parent
    ? nodeIds([options.parent], "problem", "add_problem --parent")[0]
    : undefined;
  if (parentInput === subject) throw new Error(`add_problem: ${subject} cannot be its own parent`);
  let existedBefore = false;
  const result = commitOperations(root, subject, options.evidence || subject, (model) => {
    const existing = model.pages.problem.get(slug)?.data;
    existedBefore = existing !== undefined;
    const title = suppliedTitle || existingString(existing, "title");
    if (!title) throw new Error("add_problem: --title is required when creating a new problem");
    if (existing && !options.updateOnExist) {
      console.log(`Problem already exists: ${slug}.md (slug dedup) — skipping.`);
      return null;
    }
    const status = options.status ?? existingString(existing, "status", "open");
    const severity = options.severity ?? existingString(existing, "severity", "medium");
    assertOneOf(status, PROBLEM_STATUSES, "problem status");
    assertOneOf(severity, PROBLEM_SEVERITIES, "problem severity");
    const existingEvidence = existingString(existing, "evidence");
    const evidence =
      options.evidence === undefined
        ? existingEvidence
        : appendEvidenceOnce(existingEvidence, options.evidence);
    const parent = parentInput ?? existingString(existing, "parent");
    if (parent) assertNodeExists(model, parent, "add_problem");
    const operations: WikiOperation[] = [];
    const text = (field: string, value: string | undefined): string =>
      sanitizeText(
        value ?? existingString(existing, field),
        `problem ${slug}.${field}`,
        operations,
      );
    operations.push({
      op: "upsert_page",
      kind: "problem",
      id: slug,
      data: {
        title,
        status,
        severity,
        parent,
        statement: text("statement", options.statement),
        origin: text("origin", options.origin),
        evidence: text("evidence", evidence),
        whatWouldSolve: text("whatWouldSolve", options.whatWouldSolve),
        tags: options.tags ?? (Array.isArray(existing?.tags) ? existing.tags : []),
      },
    });
    if (parent) operations.push(edgeOperation(subject, parent, "child_of"));
    addLog(
      operations,
      `add_problem: ${options.updateOnExist ? "updated" : "added"} ${subject} [status=${status} severity=${severity}]`,
    );
    return operations;
  });
  if (result.status === "skipped") {
    console.log(`Problem unchanged: ${pagePath(root, "problem", slug)}`);
    return;
  }
  console.log(`Problem ${existedBefore ? "updated" : "added"}: ${pagePath(root, "problem", slug)}`);
}

function getStats(wikiRoot: string, asJson: boolean): void {
  const model = readWikiModel(path.resolve(wikiRoot));
  const problemsWith = (status: string): string[] =>
    [...model.pages.problem.values()]
      .filter((page) => (page.data.status ?? "open") === status)
      .map((page) => `problem:${page.id}`)
      .sort();
  const ideas: Record<string, number> = Object.fromEntries(IDEA_OUTCOMES.map((key) => [key, 0]));
  for (const page of model.pages.idea.values()) {
    const result = ideaResult(model, page);
    ideas[result] = (ideas[result] ?? 0) + 1;
  }
  const stats = {
    surveys: model.pages.survey.size,
    ideas: { ...ideas, total: model.pages.idea.size },
    experiments: model.pages.experiment.size,
    claims: model.pages.claim.size,
    problems: {
      open: problemsWith("open"),
      solved: problemsWith("solved"),
      refuted: problemsWith("refuted"),
      deferred: problemsWith("deferred"),
      total: model.pages.problem.size,
    },
    edges: model.edges.length,
    wiki_root: path.resolve(wikiRoot),
  };
  if (asJson) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  console.log("Research Wiki Stats");
  console.log(`Surveys:     ${stats.surveys}`);
  console.log(
    `Ideas:       ${stats.ideas.total} (${IDEA_OUTCOMES.map((key) => `${ideas[key]} ${key}`).join(", ")})`,
  );
  console.log(`Experiments: ${stats.experiments}`);
  console.log(`Claims:      ${stats.claims}`);
  console.log(
    `Problems:    ${stats.problems.total} (${stats.problems.open.length} open, ${stats.problems.solved.length} solved)`,
  );
  console.log(`Edges:       ${stats.edges}`);
  console.log(`Wiki root:   ${stats.wiki_root}`);
}

function rebuildWiki(wikiRoot: string, message: string): void {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  projectWiki(root);
  console.log(message);
}

/** Each config change is a new fact, even when it returns to an earlier value. */
function projectionConfigEvidence(events: readonly WikiEvent[], model: WikiModel): string {
  const state = canonicalJsonSha256({ max_query_chars: model.max_query_chars }, anyJsonSchema);
  return `projection-config:${state}:${eventLogHead(events).event_id ?? "genesis"}`;
}

function rebuildQueryPack(wikiRoot: string, maxChars?: number): void {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  if (maxChars !== undefined && (!Number.isSafeInteger(maxChars) || maxChars < MIN_QUERY_CHARS))
    throw new Error(`max-chars must be an integer >= ${MIN_QUERY_CHARS}`);
  commitOperations(root, "projection:query-pack", projectionConfigEvidence, (model) =>
    maxChars !== undefined && maxChars !== model.max_query_chars
      ? [{ op: "set_projection_config", max_query_chars: maxChars }]
      : null,
  );
  console.log("query_pack.md rebuilt");
}

function appendLog(wikiRoot: string, message: string): void {
  const root = path.resolve(wikiRoot);
  assertWikiSchemaSupported(root);
  commitOperations(root, `log:${message}`, `log:${message}`, () => [{ op: "append_log", message }]);
}

async function syncSurveys(root: string, ids: string[], updateOnExist: boolean): Promise<void> {
  const metadata = await fetchArxivMetadataBatch(ids);
  for (const original of ids) {
    await ingestSurvey(root, {
      arxivId: original,
      prefetchedMeta: metadata[normalizeArxivId(original)],
      updateOnExist,
    });
  }
}

const program = createCli("research-wiki", "ARIS Research Wiki utilities");

program
  .command("init")
  .description("Initialize an event-sourced wiki directory")
  .argument("<wiki_root>")
  .action((wikiRoot: string) => initWiki(wikiRoot));

program
  .command("slug")
  .description("Print the slug ingest_survey derives from a title")
  .argument("<title>")
  .option("--author <name>", "First author last name", "")
  .option("--year <n>", "Publication year", "0")
  .action((title: string, options: { author: string; year: string }) => {
    console.log(slugify(title, options.author, Number.parseInt(options.year, 10)));
  });

program
  .command("add_edge")
  .description("Add a typed edge between two existing nodes")
  .argument("<wiki_root>")
  .requiredOption("--from <id>")
  .requiredOption("--to <id>")
  .requiredOption("--type <type>")
  .option("--evidence <text>", "Evidence text", "")
  .action(
    (wikiRoot: string, options: { from: string; to: string; type: string; evidence: string }) =>
      addEdge(wikiRoot, options.from, options.to, options.type, options.evidence),
  );

program
  .command("rebuild_query_pack")
  .description("Regenerate query_pack.md from events")
  .argument("<wiki_root>")
  .option("--max-chars <n>", "Persist a new query-pack size limit")
  .action((wikiRoot: string, options: { maxChars?: string }) =>
    rebuildQueryPack(
      wikiRoot,
      options.maxChars === undefined ? undefined : Number(options.maxChars),
    ),
  );

program
  .command("rebuild_index")
  .description("Regenerate index.md from events")
  .argument("<wiki_root>")
  .action((wikiRoot: string) => rebuildWiki(wikiRoot, "index.md rebuilt"));

program
  .command("rebuild")
  .description("Rebuild every projection from schema.json and events.jsonl")
  .argument("<wiki_root>")
  .action((wikiRoot: string) => rebuildWiki(wikiRoot, "Research Wiki projections rebuilt"));

program
  .command("stats")
  .description("Print wiki statistics")
  .argument("<wiki_root>")
  .option("--json", "Emit machine-readable stats")
  .action((wikiRoot: string, options: { json?: boolean }) =>
    getStats(wikiRoot, options.json === true),
  );

program
  .command("log")
  .description("Append a timeline entry to the event log")
  .argument("<wiki_root>")
  .argument("<message>")
  .action((wikiRoot: string, message: string) => appendLog(wikiRoot, message));

program
  .command("ingest_survey")
  .description("Record what an existing work (paper, repo, doc, blog) does")
  .argument("<wiki_root>")
  .option("--arxiv-id <id>", "arXiv identifier; metadata is fetched", "")
  .option("--url <url>", "Source URL for a non-arXiv work", "")
  .option("--title <title>", "Title", "")
  .option("--authors <list>", "Comma-separated author list", "")
  .option("--year <n>", "Publication year", "0")
  .option("--venue <venue>", "Venue", "")
  .option("--external-id-doi <doi>", "DOI", "")
  .option("--thesis <text>", "One line: what the work does and finds", "")
  .option("--tags <list>", "Comma-separated tag list", "")
  .option("--problems <list>", "Problem ids this work addresses", "")
  .option("--update-on-exist", "Overwrite an existing page", false)
  .action(
    async (
      wikiRoot: string,
      options: {
        arxivId: string;
        url: string;
        title: string;
        authors: string;
        year: string;
        venue: string;
        externalIdDoi: string;
        thesis: string;
        tags: string;
        problems: string;
        updateOnExist: boolean;
      },
    ) => {
      await ingestSurvey(wikiRoot, {
        arxivId: options.arxivId || undefined,
        url: options.url,
        title: options.title || undefined,
        authors: splitCsv(options.authors),
        year: Number.parseInt(options.year, 10) || 0,
        venue: options.venue,
        doi: options.externalIdDoi,
        thesis: options.thesis,
        tags: splitCsv(options.tags),
        problems: splitCsv(options.problems),
        updateOnExist: options.updateOnExist,
      });
    },
  );

program
  .command("add_claim")
  .description("Create or update a claim page")
  .argument("<wiki_root>")
  .option("--slug <slug>", "Stable claim id", "")
  .requiredOption("--name <name>", "Human-readable claim name")
  .option("--description <text>", "One-line description", "")
  .option("--status <status>", CLAIM_STATUSES.join(" | "), "drafted")
  .option("--provenance <path>", "Run directory", "")
  .option("--statement <text>", "Formal statement", "")
  .option("--scope <text>", "Honest scope", "")
  .option("--evidence <text>", "Evidence chain", "")
  .option("--tags <list>", "Comma-separated tag list", "")
  .option("--addresses <list>", "Problem ids", "")
  .option("--extends <list>", "Survey ids", "")
  .option("--uses <list>", "Survey ids", "")
  .option("--depends-on <list>", "Claim ids", "")
  .option("--refutes <list>", "Claim ids", "")
  .option("--update-on-exist", "Overwrite an existing claim", false)
  .action(
    (
      wikiRoot: string,
      options: {
        slug: string;
        name: string;
        description: string;
        status: string;
        provenance: string;
        statement: string;
        scope: string;
        evidence: string;
        tags: string;
        addresses: string;
        extends: string;
        uses: string;
        dependsOn: string;
        refutes: string;
        updateOnExist: boolean;
      },
    ) => {
      addClaim(wikiRoot, options.slug, options.name, {
        description: options.description,
        status: options.status,
        provenance: options.provenance,
        statement: options.statement,
        scope: options.scope,
        evidence: options.evidence,
        tags: splitCsv(options.tags),
        addresses: splitCsv(options.addresses),
        extends: splitCsv(options.extends),
        uses: splitCsv(options.uses),
        dependsOn: splitCsv(options.dependsOn),
        refutes: splitCsv(options.refutes),
        updateOnExist: options.updateOnExist,
      });
    },
  );

program
  .command("upsert_idea")
  .description("Create or update an idea page")
  .argument("<wiki_root>")
  .option("--slug <slug>", "Stable idea id", "")
  .requiredOption("--title <title>", "Human-readable idea title")
  .option("--description <text>", "One-line description")
  .option("--outcome <outcome>", `${IDEA_OUTCOMES.join(" | ")} (default pending)`)
  .option("--thesis <text>", "Core hypothesis")
  .option("--risks <text>", "Risks")
  .option("--tags <list>", "Comma-separated tag list")
  .option("--based-on <list>", "Survey ids that inspired the idea", "")
  .option("--target-problems <list>", "Problem ids the idea addresses", "")
  .option("--update-on-exist", "Update an existing idea; omitted fields are kept", false)
  .action(
    (
      wikiRoot: string,
      options: {
        slug: string;
        title: string;
        description?: string;
        outcome?: string;
        thesis?: string;
        risks?: string;
        tags?: string;
        basedOn: string;
        targetProblems: string;
        updateOnExist: boolean;
      },
    ) => {
      upsertIdea(wikiRoot, options.slug, options.title, {
        description: options.description,
        outcome: options.outcome,
        thesis: options.thesis,
        risks: options.risks,
        tags: options.tags === undefined ? undefined : splitCsv(options.tags),
        basedOn: splitCsv(options.basedOn),
        targetProblems: splitCsv(options.targetProblems),
        updateOnExist: options.updateOnExist,
      });
    },
  );

program
  .command("add_problem")
  .description("Create or update a problem page; omitted fields are kept, evidence is appended")
  .argument("<wiki_root>")
  .option("--title <title>", "Human-readable problem title")
  .option("--slug <slug>", "Stable problem id", "")
  .option("--status <status>", PROBLEM_STATUSES.join(" | "))
  .option("--severity <severity>", PROBLEM_SEVERITIES.join(" | "))
  .option("--parent <id>", "Parent problem id", "")
  .option("--statement <text>", "What is unsolved", "")
  .option("--origin <text>", "Why it exists", "")
  .option("--evidence <text>", "Evidence", "")
  .option("--what-would-solve <text>", "Closing result", "")
  .option("--tags <list>", "Comma-separated tag list", "")
  .option("--update-on-exist", "Overwrite an existing problem", false)
  .action(
    (
      wikiRoot: string,
      options: {
        title?: string;
        slug: string;
        status?: string;
        severity?: string;
        parent: string;
        statement: string;
        origin: string;
        evidence: string;
        whatWouldSolve: string;
        tags: string;
        updateOnExist: boolean;
      },
    ) => {
      addProblem(wikiRoot, options.slug, options.title ?? "", {
        status: options.status,
        severity: options.severity,
        parent: options.parent || undefined,
        statement: options.statement || undefined,
        origin: options.origin || undefined,
        evidence: options.evidence || undefined,
        whatWouldSolve: options.whatWouldSolve || undefined,
        tags: options.tags ? splitCsv(options.tags) : undefined,
        updateOnExist: options.updateOnExist,
      });
    },
  );

program
  .command("add_experiment")
  .description("Record a measured result and its evidence edges")
  .argument("<wiki_root>")
  .requiredOption("--slug <slug>", "Stable experiment id")
  .option("--title <title>", "Human-readable label", "")
  .option("--submission <id>", "Validation submission this result belongs to", "")
  .option("--idea <id>", "Idea the experiment tests", "")
  .option("--result <result>", `${EXPERIMENT_RESULTS.join(" | ")} for --idea`)
  .option("--solves <list>", "Problem ids this result shows fixed", "")
  .option("--reproduces <list>", "Problem ids still present in this result", "")
  .option("--metrics <text>", "Key metrics", "")
  .option("--reasoning <text>", "Reasoning", "")
  .option("--tags <list>", "Comma-separated tag list", "")
  .option("--update-on-exist", "Overwrite an existing experiment", false)
  .action(
    (
      wikiRoot: string,
      options: {
        slug: string;
        title: string;
        submission: string;
        idea: string;
        result?: string;
        solves: string;
        reproduces: string;
        metrics: string;
        reasoning: string;
        tags: string;
        updateOnExist: boolean;
      },
    ) => {
      addExperiment(wikiRoot, options.slug, {
        title: options.title,
        idea: options.idea,
        result: options.result,
        solves: splitCsv(options.solves),
        reproduces: splitCsv(options.reproduces),
        metrics: options.metrics,
        reasoning: options.reasoning,
        tags: splitCsv(options.tags),
        submissionId: options.submission || undefined,
        updateOnExist: options.updateOnExist,
      });
    },
  );

program
  .command("sync")
  .description("Batch ingest arXiv works as surveys")
  .argument("<wiki_root>")
  .option("--arxiv-ids <list>", "Comma-separated ids", "")
  .option("--from-file <path>", "Newline-delimited ids", "")
  .option("--update-on-exist", "Overwrite existing pages", false)
  .action(
    async (
      wikiRoot: string,
      options: { arxivIds: string; fromFile: string; updateOnExist: boolean },
    ) => {
      const ids: string[] = [];
      if (options.arxivIds) ids.push(...splitCsv(options.arxivIds));
      if (options.fromFile) {
        if (!fs.existsSync(options.fromFile)) {
          console.error(`--from-file not found: ${options.fromFile}`);
          process.exit(2);
        }
        for (const line of fs.readFileSync(options.fromFile, "utf-8").split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) ids.push(trimmed);
        }
      }
      if (ids.length === 0) {
        console.error("sync: no arxiv ids supplied (use --arxiv-ids or --from-file)");
        process.exit(2);
      }
      const seen = new Set<string>();
      const unique = ids.filter((id) => {
        const normalized = normalizeArxivId(id);
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
      console.log(`sync: ${unique.length} unique arxiv id(s)`);
      await syncSurveys(wikiRoot, unique, options.updateOnExist);
    },
  );

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCli(program);
}
