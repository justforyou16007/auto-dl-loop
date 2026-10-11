export type WikiPageKind = "survey" | "idea" | "experiment" | "claim" | "problem";

/** Node-id prefix → page kind. Experiments use the short `exp:` prefix. */
export const WIKI_NODE_KINDS: Readonly<Record<string, WikiPageKind>> = {
  survey: "survey",
  idea: "idea",
  exp: "experiment",
  claim: "claim",
  problem: "problem",
};

/** The From → To node-id prefixes each edge type may connect. */
export const WIKI_EDGE_ENDPOINTS = {
  extends: { from: ["survey", "claim"], to: ["survey"] },
  contradicts: { from: ["survey"], to: ["survey"] },
  supersedes: { from: ["survey"], to: ["survey"] },
  addresses: { from: ["survey", "idea", "claim"], to: ["problem"] },
  child_of: { from: ["problem"], to: ["problem"] },
  inspired_by: { from: ["idea"], to: ["survey"] },
  tested_by: { from: ["idea", "claim"], to: ["exp"] },
  supports: { from: ["exp"], to: ["claim", "idea"] },
  invalidates: { from: ["exp"], to: ["claim", "idea"] },
  solves: { from: ["exp"], to: ["problem"] },
  reproduces: { from: ["exp"], to: ["problem"] },
  uses: { from: ["claim"], to: ["survey"] },
  depends_on: { from: ["claim"], to: ["claim"] },
  refutes: { from: ["claim"], to: ["claim"] },
} as const satisfies Record<string, { from: readonly string[]; to: readonly string[] }>;

export type WikiEdgeType = keyof typeof WIKI_EDGE_ENDPOINTS;

export const WIKI_EDGE_TYPES = Object.keys(WIKI_EDGE_ENDPOINTS) as WikiEdgeType[];

export const IDEA_OUTCOMES = ["pending", "effective", "ineffective", "mixed"] as const;
export const EXPERIMENT_RESULTS = ["effective", "ineffective", "mixed"] as const;
export const CLAIM_STATUSES = [
  "drafted",
  "unproven",
  "sound-modulo-imports",
  "verified",
  "refuted",
  "retracted",
] as const;
export const PROBLEM_STATUSES = ["open", "solved", "refuted", "deferred"] as const;
export const PROBLEM_SEVERITIES = ["high", "medium", "low"] as const;

export const DEFAULT_QUERY_CHARS = 1000;
export const MIN_QUERY_CHARS = 300;

export type WikiOperation =
  | { op: "upsert_page"; kind: WikiPageKind; id: string; data: Record<string, unknown> }
  | { op: "remove_page"; kind: WikiPageKind; id: string }
  | {
      op: "upsert_edge";
      edge: { from: string; to: string; type: WikiEdgeType; evidence?: string };
    }
  | { op: "remove_edges"; from?: string; to?: string; type?: WikiEdgeType }
  | { op: "append_log"; message: string }
  | { op: "quarantine"; target: string; findings: string[]; raw_text: string }
  | { op: "set_projection_config"; max_query_chars: number };

const PAGE_KINDS = new Set<string>(Object.values(WIKI_NODE_KINDS));
const EDGE_TYPE_SET = new Set<string>(WIKI_EDGE_TYPES);
const PAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NODE_ID_PATTERN = /^(survey|idea|exp|claim|problem):[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PAGE_DATA_KEYS: Record<WikiPageKind, readonly string[]> = {
  survey: [
    "title",
    "authors",
    "year",
    "venue",
    "url",
    "external_ids",
    "tags",
    "thesis",
    "abstract",
  ],
  idea: ["title", "description", "outcome", "thesis", "risks", "tags"],
  experiment: ["title", "idea_id", "result", "submission_id", "metrics", "reasoning", "tags"],
  claim: [
    "name",
    "description",
    "status",
    "provenance",
    "statement",
    "scope",
    "evidence",
    "tags",
    "date",
  ],
  problem: [
    "title",
    "status",
    "severity",
    "parent",
    "statement",
    "origin",
    "evidence",
    "whatWouldSolve",
    "tags",
  ],
};

export function isWikiEdgeType(value: unknown): value is WikiEdgeType {
  return typeof value === "string" && EDGE_TYPE_SET.has(value);
}

export function wikiNodeKind(nodeId: string): string {
  const separator = nodeId.indexOf(":");
  return separator > 0 ? nodeId.slice(0, separator) : "";
}

/** Null when the edge fits its endpoint kinds, otherwise a message naming the types that do. */
export function wikiEdgeEndpointError(from: string, to: string, type: WikiEdgeType): string | null {
  const fits = (candidate: WikiEdgeType): boolean =>
    (WIKI_EDGE_ENDPOINTS[candidate].from as readonly string[]).includes(wikiNodeKind(from)) &&
    (WIKI_EDGE_ENDPOINTS[candidate].to as readonly string[]).includes(wikiNodeKind(to));
  if (fits(type)) return null;
  const spec = WIKI_EDGE_ENDPOINTS[type];
  const fromKind = wikiNodeKind(from) || "?";
  const toKind = wikiNodeKind(to) || "?";
  const alternatives = WIKI_EDGE_TYPES.filter(fits);
  const hint =
    alternatives.length > 0 ? ` For ${fromKind} → ${toKind} use: ${alternatives.join(", ")}.` : "";
  return `'${type}' connects ${spec.from.join("|")} → ${spec.to.join("|")}, got ${fromKind} → ${toKind}.${hint}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  location: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(`invalid Wiki operation ${location}: unknown field '${key}'`);
    }
  }
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid Wiki operation: ${label} must be a string`);
  }
  return value;
}

function assertPageId(value: string, location: string): void {
  if (!PAGE_ID_PATTERN.test(value)) {
    throw new Error(
      `invalid Wiki page id '${value}' at ${location}; ids must be single relative path components`,
    );
  }
}

function assertNodeId(value: string, location: string, kind?: string): void {
  if (!NODE_ID_PATTERN.test(value)) {
    throw new Error(`invalid Wiki node id '${value}' at ${location}`);
  }
  if (kind !== undefined && wikiNodeKind(value) !== kind) {
    throw new Error(`${location} must be a ${kind} id, got '${value}'`);
  }
}

function assertStringArray(value: unknown, location: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${location} must be a string array`);
  }
}

function assertOptionalStrings(
  data: Record<string, unknown>,
  fields: readonly string[],
  location: string,
): void {
  for (const field of fields) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      throw new Error(`${location}.${field} must be a string`);
    }
  }
}

function assertOneOf(
  data: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  location: string,
  allowEmpty = false,
): void {
  const value = data[field];
  if (value === undefined || (allowEmpty && value === "")) return;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${location}.${field} must be one of ${allowed.join(", ")}`);
  }
}

function validatePageData(
  kind: WikiPageKind,
  data: Record<string, unknown>,
  location: string,
): void {
  assertKeys(data, PAGE_DATA_KEYS[kind], location);
  if (data.tags !== undefined) assertStringArray(data.tags, `${location}.tags`);
  switch (kind) {
    case "survey":
      assertOptionalStrings(data, ["title", "venue", "url", "thesis", "abstract"], location);
      if (data.authors !== undefined) assertStringArray(data.authors, `${location}.authors`);
      if (data.year !== undefined && !Number.isSafeInteger(data.year)) {
        throw new Error(`${location}.year must be a finite integer`);
      }
      if (data.external_ids !== undefined) {
        if (!isObject(data.external_ids))
          throw new Error(`${location}.external_ids must be an object`);
        assertKeys(data.external_ids, ["arxiv", "doi"], `${location}.external_ids`);
        assertOptionalStrings(data.external_ids, ["arxiv", "doi"], `${location}.external_ids`);
      }
      return;
    case "idea":
      assertOptionalStrings(data, ["title", "description", "outcome", "thesis", "risks"], location);
      assertOneOf(data, "outcome", IDEA_OUTCOMES, location);
      return;
    case "experiment":
      assertOptionalStrings(
        data,
        ["title", "idea_id", "result", "submission_id", "metrics", "reasoning"],
        location,
      );
      assertOneOf(data, "result", EXPERIMENT_RESULTS, location, true);
      if (data.idea_id !== undefined && data.idea_id !== "")
        assertNodeId(data.idea_id as string, `${location}.idea_id`, "idea");
      return;
    case "claim":
      assertOptionalStrings(
        data,
        ["name", "description", "status", "provenance", "statement", "scope", "evidence", "date"],
        location,
      );
      assertOneOf(data, "status", CLAIM_STATUSES, location);
      return;
    case "problem":
      assertOptionalStrings(
        data,
        [
          "title",
          "status",
          "severity",
          "parent",
          "statement",
          "origin",
          "evidence",
          "whatWouldSolve",
        ],
        location,
      );
      assertOneOf(data, "status", PROBLEM_STATUSES, location);
      assertOneOf(data, "severity", PROBLEM_SEVERITIES, location);
      if (data.parent !== undefined && data.parent !== "")
        assertNodeId(data.parent as string, `${location}.parent`, "problem");
      return;
  }
}

function pageKindField(value: unknown, location: string): WikiPageKind {
  const kind = stringField(value, location);
  if (!PAGE_KINDS.has(kind)) throw new Error(`invalid Wiki page kind '${kind}'`);
  return kind as WikiPageKind;
}

function edgeTypeField(value: unknown, location: string): WikiEdgeType {
  const type = stringField(value, location);
  if (!isWikiEdgeType(type)) throw new Error(`invalid Wiki edge type '${type}'`);
  return type;
}

export function parseWikiOperation(value: unknown, location: string): WikiOperation {
  if (!isObject(value)) throw new Error(`invalid Wiki operation at ${location}`);
  const op = stringField(value.op, `${location}.op`);
  switch (op) {
    case "upsert_page": {
      assertKeys(value, ["op", "kind", "id", "data"], location);
      const kind = pageKindField(value.kind, `${location}.kind`);
      const id = stringField(value.id, `${location}.id`);
      if (!isObject(value.data)) throw new Error(`${location}.data must be an object`);
      assertPageId(id, `${location}.id`);
      validatePageData(kind, value.data, `${location}.data`);
      return { op, kind, id, data: value.data };
    }
    case "remove_page": {
      assertKeys(value, ["op", "kind", "id"], location);
      const kind = pageKindField(value.kind, `${location}.kind`);
      const id = stringField(value.id, `${location}.id`);
      assertPageId(id, `${location}.id`);
      return { op, kind, id };
    }
    case "upsert_edge": {
      assertKeys(value, ["op", "edge"], location);
      if (!isObject(value.edge)) throw new Error(`${location}.edge must be an object`);
      assertKeys(value.edge, ["from", "to", "type", "evidence"], `${location}.edge`);
      const from = stringField(value.edge.from, `${location}.edge.from`);
      const to = stringField(value.edge.to, `${location}.edge.to`);
      const type = edgeTypeField(value.edge.type, `${location}.edge.type`);
      assertNodeId(from, `${location}.edge.from`);
      assertNodeId(to, `${location}.edge.to`);
      const endpointError = wikiEdgeEndpointError(from, to, type);
      if (endpointError) throw new Error(`invalid Wiki edge at ${location}: ${endpointError}`);
      return {
        op,
        edge: {
          from,
          to,
          type,
          evidence:
            value.edge.evidence === undefined
              ? ""
              : stringField(value.edge.evidence, `${location}.edge.evidence`),
        },
      };
    }
    case "remove_edges": {
      assertKeys(value, ["op", "from", "to", "type"], location);
      const from =
        value.from === undefined ? undefined : stringField(value.from, `${location}.from`);
      const to = value.to === undefined ? undefined : stringField(value.to, `${location}.to`);
      if (from !== undefined) assertNodeId(from, `${location}.from`);
      if (to !== undefined) assertNodeId(to, `${location}.to`);
      const type =
        value.type === undefined ? undefined : edgeTypeField(value.type, `${location}.type`);
      return { op, from, to, type };
    }
    case "append_log":
      assertKeys(value, ["op", "message"], location);
      return { op, message: stringField(value.message, `${location}.message`) };
    case "quarantine":
      assertKeys(value, ["op", "target", "findings", "raw_text"], location);
      assertStringArray(value.findings, `${location}.findings`);
      return {
        op,
        target: stringField(value.target, `${location}.target`),
        findings: [...(value.findings as string[])],
        raw_text: stringField(value.raw_text, `${location}.raw_text`),
      };
    case "set_projection_config": {
      assertKeys(value, ["op", "max_query_chars"], location);
      const maxChars = value.max_query_chars;
      if (
        typeof maxChars !== "number" ||
        !Number.isSafeInteger(maxChars) ||
        maxChars < MIN_QUERY_CHARS
      ) {
        throw new Error(`${location}.max_query_chars must be an integer >= ${MIN_QUERY_CHARS}`);
      }
      return { op, max_query_chars: maxChars };
    }
    default:
      throw new Error(`invalid Wiki operation '${op}' at ${location}`);
  }
}

export interface WikiPayload {
  operations: WikiOperation[];
}

export function parseWikiPayload(payload: unknown): WikiPayload {
  if (!isObject(payload)) throw new Error("Wiki payload must be an object");
  assertKeys(payload, ["operations"], "payload");
  if (!Array.isArray(payload.operations)) {
    throw new Error("Wiki payload.operations must be an array");
  }
  return {
    operations: payload.operations.map((item, index) =>
      parseWikiOperation(item, `payload.operations[${index}]`),
    ),
  };
}
