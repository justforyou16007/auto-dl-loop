export const meta = {
  name: "configure",
  description:
    "Configure this machine as the worker: the sheet with the connection to the validator, apply, environment, report",
  whenToUse:
    "When the worker machine is new, before setup, or when something about it changes. Run it with {}, then again with the owner's replies in answers.",
  phases: [{ title: "Sheet" }, { title: "Apply" }, { title: "Environment" }, { title: "Report" }],
};

const STRINGS = { type: "array", items: { type: "string" } };
const REVIEW = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["approve", "revise", "cancel", "ask"] },
    question: { type: "string" },
    document: { type: "string" },
    notes: { type: "string" },
    accepted: STRINGS,
  },
  required: ["decision", "question", "document", "notes", "accepted"],
};
const SHEET = {
  type: "object",
  properties: {
    has_issues: { type: "boolean" },
    digest: { type: "string" },
    review_file: { type: "string" },
    issues: STRINGS,
    summary: { type: "string" },
  },
  required: ["has_issues", "digest", "review_file", "issues", "summary"],
};
const APPLIED = {
  type: "object",
  properties: {
    failed: { type: "boolean" },
    reason: { type: "string" },
    summary: { type: "string" },
  },
  required: ["failed", "reason", "summary"],
};
const ENVIRONMENT = {
  type: "object",
  properties: {
    needs_owner: { type: "boolean" },
    request: { type: "string" },
    summary: { type: "string" },
    incomplete: STRINGS,
  },
  required: ["needs_owner", "request", "summary", "incomplete"],
};
const REPORT = {
  type: "object",
  properties: { report: { type: "string" } },
  required: ["report"],
};

const input = args || {};
const answers = input.answers || {};
// The owner decides at owner-review steps; the loop stops there until the session brings the reply.
const review = (id, request, at) =>
  agent(JSON.stringify({ review_id: id, ...request, answer: answers[id] ?? null }), {
    agentType: "owner-review",
    schema: REVIEW,
    phase: at,
  });
const waiting = (id, decided) => ({
  waiting: "owner",
  review_id: id,
  question: decided.question,
  document: decided.document,
});
const stopped = { done: false, reason: "the owner stopped the configuration" };

// Steps 1 and 2
let applied = null;
let sheetNotes = "";
let sheetReason = "";
for (let round = 1; round <= 12 && !applied; round += 1) {
  phase("Sheet");
  const sheet = await agent(
    JSON.stringify({ action: "sheet", notes: sheetNotes, reason: sheetReason }),
    { agentType: "worker-config", schema: SHEET, phase: "Sheet" },
  );
  sheetReason = "";
  const id = `sheet:${round}:${sheet.digest}`;
  const decided = await review(
    id,
    {
      subject: "the configuration sheet",
      request: "Approve this configuration version, or give your changes.",
      materials: { review_file: sheet.review_file, issues: sheet.issues, summary: sheet.summary },
      approvable: !sheet.has_issues,
    },
    "Sheet",
  );
  if (decided.decision === "ask") return waiting(id, decided);
  if (decided.decision === "cancel") return stopped;
  if (decided.decision !== "approve" || sheet.has_issues) {
    sheetNotes = decided.notes;
    continue;
  }
  phase("Apply");
  const result = await agent(JSON.stringify({ action: "apply", digest: sheet.digest }), {
    agentType: "worker-config",
    schema: APPLIED,
    phase: "Apply",
  });
  if (result.failed) {
    sheetNotes = "";
    sheetReason = result.reason;
  } else applied = result;
}
if (!applied) return { done: false, reason: "no configuration was applied within 12 rounds" };

// Step 3
phase("Environment");
let environmentNotes = "";
let environment = null;
for (let round = 1; round <= 3; round += 1) {
  environment = await agent(JSON.stringify({ action: "environment", notes: environmentNotes }), {
    agentType: "worker-config",
    schema: ENVIRONMENT,
    phase: "Environment",
  });
  if (!environment.needs_owner) break;
  const id = `environment:${round}`;
  const decided = await review(
    id,
    {
      subject: "facts about this machine",
      request: environment.request,
      materials: { summary: environment.summary, incomplete: environment.incomplete },
      approvable: false,
    },
    "Environment",
  );
  if (decided.decision === "ask") return waiting(id, decided);
  if (decided.decision === "cancel") break;
  environmentNotes = [environmentNotes, decided.notes].filter(Boolean).join("\n");
}

// Step 4
phase("Report");
const report = await agent(
  JSON.stringify({
    action: "report",
    applied: applied.summary,
    environment: environment.summary,
    incomplete: environment.incomplete,
  }),
  { agentType: "worker-config", schema: REPORT, phase: "Report" },
);
return { done: true, report: report.report };

// contrejour-loop-definition-sha256: ded484b2eabd3381bc9f23b80f9e25c25b228bbcbc795e9ac749e02522a783e9
