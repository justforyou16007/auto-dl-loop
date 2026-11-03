export const meta = {
  name: "machine-config",
  description:
    "Configure this machine as the validator from the owner's requirement: task.md, the sheet with the validation terms, apply, environment, checks, hand-off",
  whenToUse:
    'Validator machine configuration, when the owner asks for it. Run it with {"requirement": "<what to validate, or start>"}, then again with the owner\'s replies in answers.',
  phases: [
    { title: "Requirement" },
    { title: "Task" },
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
const TASK = {
  type: "object",
  properties: {
    needs_owner: { type: "boolean" },
    task_file: { type: "string" },
    digest: { type: "string" },
    summary: { type: "string" },
  },
  required: ["needs_owner", "task_file", "digest", "summary"],
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
const stopped = { done: false, reason: "the owner stopped the configuration" };

// Step 1
phase("Requirement");
let notes = "";
let read = null;
for (let round = 1; round <= 3; round += 1) {
  read = await agent(
    JSON.stringify({ action: "requirement", requirement: input.requirement, notes }),
    { agentType: "validator-config", schema: REQUIREMENT, phase: "Requirement" },
  );
  if (!read.needs_owner) break;
  const id = `requirement:${round}`;
  const decided = await review(
    id,
    {
      subject: "what this validator project should validate",
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
  return { done: false, reason: "the requirement is still not clear enough to write the task" };
const requirement = read.requirement;

// Step 2: task.md is the whole task the worker gets; one the owner wrote needs no review.
phase("Task");
let taskNotes = "";
let taskSettled = false;
for (let round = 1; round <= 6 && !taskSettled; round += 1) {
  const task = await agent(JSON.stringify({ action: "task", requirement, notes: taskNotes }), {
    agentType: "validator-config",
    schema: TASK,
    phase: "Task",
  });
  if (!task.needs_owner) {
    taskSettled = true;
    break;
  }
  const id = `task:${task.digest}`;
  const decided = await review(
    id,
    {
      subject: "task.md, the whole task the worker will get",
      request: "Approve this task.md, or say what to change.",
      materials: { task_file: task.task_file, summary: task.summary },
      approvable: true,
    },
    "Task",
  );
  if (decided.decision === "ask") return waiting(id, decided);
  if (decided.decision === "cancel") return stopped;
  if (decided.decision === "approve") taskSettled = true;
  else taskNotes = decided.notes;
}
if (!taskSettled) return { done: false, reason: "task.md was not approved within 6 rounds" };

// Steps 3 and 4
let applied = null;
let sheetNotes = "";
let sheetReason = "";
for (let round = 1; round <= 12 && !applied; round += 1) {
  phase("Sheet");
  const sheet = await agent(
    JSON.stringify({ action: "sheet", notes: sheetNotes, reason: sheetReason }),
    { agentType: "validator-config", schema: SHEET, phase: "Sheet" },
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
    agentType: "validator-config",
    schema: APPLIED,
    phase: "Apply",
  });
  if (result.failed) {
    sheetNotes = "";
    sheetReason = result.reason;
  } else applied = result;
}
if (!applied) return { done: false, reason: "no configuration was applied within 12 rounds" };

// Step 5
phase("Environment");
let environmentNotes = "";
let environment = null;
for (let round = 1; round <= 3; round += 1) {
  environment = await agent(JSON.stringify({ action: "environment", notes: environmentNotes }), {
    agentType: "validator-config",
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

// Step 6
phase("Check");
let checked = await agent(JSON.stringify({ action: "check" }), {
  agentType: "validator-config",
  schema: CHECKED,
  phase: "Check",
});
if (checked.stale.length) {
  if (checked.stale.length > 4) log(`${checked.stale.length - 4} stale loops were not regenerated`);
  for (const stale of checked.stale.slice(0, 4))
    await workflow("loop-authoring", { regenerate: stale });
  checked = await agent(JSON.stringify({ action: "check" }), {
    agentType: "validator-config",
    schema: CHECKED,
    phase: "Check",
  });
}

// Step 7
phase("Hand off");
const handoff = await agent(
  JSON.stringify({
    action: "handoff",
    requirement,
    applied: applied.summary,
    environment: environment.summary,
    incomplete: environment.incomplete,
    check: checked,
  }),
  { agentType: "validator-config", schema: HANDOFF, phase: "Hand off" },
);
return { done: true, report: handoff.report };

// contrejour-loop-definition-sha256: 747f4c81c07f2622c2931984a2cb597b45753d25dccc11af6c20e5be465e77f4
