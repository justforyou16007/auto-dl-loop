export const meta = {
  name: "project-setup",
  description:
    "Set the worker project up from the owner's requirement: settle its loop, the sheet with the loop's parameters and the connection, apply, environment, checks, hand-off",
  whenToUse:
    'Worker setup. The worker-setup session runs it with {"requirement": "<the owner\'s first message>"}, then again with the owner\'s replies in answers.',
  phases: [
    { title: "Requirement" },
    { title: "Loop" },
    { title: "Sheet" },
    { title: "Apply" },
    { title: "Environment" },
    { title: "Check" },
    { title: "Hand off" },
  ],
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
const REQUIREMENT = {
  type: "object",
  properties: {
    needs_owner: { type: "boolean" },
    requirement: { type: "string" },
    request: { type: "string" },
  },
  required: ["needs_owner", "requirement", "request"],
};
const FOUND = {
  type: "object",
  properties: {
    fit: { type: "string", enum: ["fits", "close", "none"] },
    loop: { type: "string" },
    why: { type: "string" },
    parameters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          why: { type: "string" },
        },
        required: ["name", "value", "why"],
      },
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: { loop: { type: "string" }, fit: { type: "string" }, why: { type: "string" } },
        required: ["loop", "fit", "why"],
      },
    },
  },
  required: ["fit", "loop", "why", "parameters", "candidates"],
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
const CHECKED = {
  type: "object",
  properties: { stale: STRINGS, defects: STRINGS },
  required: ["stale", "defects"],
};
const HANDOFF = {
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
const stopped = { done: false, reason: "the owner stopped setup" };

// Step 1
phase("Requirement");
let notes = "";
let read = null;
for (let round = 1; round <= 3; round += 1) {
  read = await agent(
    JSON.stringify({ action: "requirement", requirement: input.requirement, notes }),
    { agentType: "worker-setup", schema: REQUIREMENT, phase: "Requirement" },
  );
  if (!read.needs_owner) break;
  const id = `requirement:${round}`;
  const decided = await review(
    id,
    {
      subject: "what this worker project should do",
      request: read.request,
      materials: { requirement: input.requirement, earlier_answers: notes },
      approvable: false,
    },
    "Requirement",
  );
  if (decided.decision === "ask") return waiting(id, decided);
  if (decided.decision === "cancel") return stopped;
  notes = [notes, decided.notes].filter(Boolean).join("\n");
}
if (read.needs_owner)
  return { done: false, reason: "the requirement is still not clear enough to choose a loop" };
const requirement = read.requirement;

// Steps 2 to 4
phase("Loop");
const found = await agent(
  JSON.stringify({ action: "find-task-loop", requirement, side: "worker" }),
  { agentType: "loop-query", schema: FOUND, phase: "Loop" },
);
let loop = "";
let description = requirement;
// The parameter values the owner approved with the loop become the sheet's first values.
let suggested = [];
if (found.fit !== "none") {
  const id = `setup-loop:${found.loop}`;
  const decided = await review(
    id,
    {
      subject: "the loop this project runs",
      request:
        "Is this your requirement, and is this the loop to run? Approve, or say what to change.",
      materials: { requirement, found },
      approvable: true,
    },
    "Loop",
  );
  if (decided.decision === "ask") return waiting(id, decided);
  if (decided.decision === "cancel") return stopped;
  if (decided.decision === "approve") {
    loop = found.loop;
    suggested = found.parameters;
  } else description = `${requirement}\n\nThe owner adds: ${decided.notes}`;
}
if (!loop) {
  // A new task loop is built on the closest existing one, with the owner's review of the draft.
  const built = await workflow("loop-authoring", {
    description,
    side: "worker",
    kind: "task",
    answers,
  });
  if (built && built.waiting) return built;
  if (!built || !built.loop || !(built.installed || built.reused))
    return { done: false, reason: (built && built.reason) || "no loop was settled" };
  loop = built.loop;
}

// Steps 5 and 6
let applied = null;
let sheetNotes = "";
let sheetReason = "";
for (let round = 1; round <= 12 && !applied; round += 1) {
  phase("Sheet");
  const sheet = await agent(
    JSON.stringify({
      action: "sheet",
      loop,
      suggested: round === 1 ? suggested : [],
      notes: sheetNotes,
      reason: sheetReason,
    }),
    { agentType: "worker-setup", schema: SHEET, phase: "Sheet" },
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
    agentType: "worker-setup",
    schema: APPLIED,
    phase: "Apply",
  });
  if (result.failed) {
    sheetNotes = "";
    sheetReason = result.reason;
  } else applied = result;
}
if (!applied) return { done: false, reason: "no configuration was applied within 12 rounds" };

// Step 7
phase("Environment");
let environmentNotes = "";
let environment = null;
for (let round = 1; round <= 3; round += 1) {
  environment = await agent(JSON.stringify({ action: "environment", notes: environmentNotes }), {
    agentType: "worker-setup",
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

// Step 8
phase("Check");
let checked = await agent(JSON.stringify({ action: "check" }), {
  agentType: "worker-setup",
  schema: CHECKED,
  phase: "Check",
});
if (checked.stale.length) {
  if (checked.stale.length > 4) log(`${checked.stale.length - 4} stale loops were not regenerated`);
  for (const stale of checked.stale.slice(0, 4))
    await workflow("loop-authoring", { regenerate: stale });
  checked = await agent(JSON.stringify({ action: "check" }), {
    agentType: "worker-setup",
    schema: CHECKED,
    phase: "Check",
  });
}

// Step 9
phase("Hand off");
const handoff = await agent(
  JSON.stringify({
    action: "handoff",
    requirement,
    loop,
    applied: applied.summary,
    environment: environment.summary,
    incomplete: environment.incomplete,
    check: checked,
  }),
  { agentType: "worker-setup", schema: HANDOFF, phase: "Hand off" },
);
return { done: true, loop, report: handoff.report };

// contrejour-loop-definition-sha256: a22d781901b2ffcc42e85a26ea1c4cafbeec7d48faa15310d832e6bd19c5d992
