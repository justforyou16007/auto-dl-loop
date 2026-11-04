export const meta = {
  name: "research-iteration",
  description:
    "One worker research round: choose problems, five ideators, assess and rank, implement, submit; once the result is out, record it and fix roles",
  whenToUse:
    'Worker. Run with {"stage": "build", "task": "<task.md text>"} for a round, then with {"stage": "record", "submission_id": "<id>"} once its result is published.',
  phases: [
    { title: "Choose" },
    { title: "Ideate" },
    { title: "Rank" },
    { title: "Build" },
    { title: "Submit" },
    { title: "Record" },
    { title: "Optimize" },
  ],
};

const DONE = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
const STRINGS = { type: "array", items: { type: "string" } };
const PROBLEM = {
  type: "object",
  properties: { id: { type: "string" }, statement: { type: "string" } },
  required: ["id", "statement"],
};
const CHOSEN = {
  type: "object",
  properties: {
    problems: { type: "array", items: PROBLEM },
    ineffective: {
      type: "array",
      items: {
        type: "object",
        properties: { idea: { type: "string" }, tried: { type: "string" } },
        required: ["idea", "tried"],
      },
    },
    surveys: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          source: { type: "string" },
          finding: { type: "string" },
          problems: STRINGS,
        },
        required: ["title", "source", "finding", "problems"],
      },
    },
  },
  required: ["problems", "ineffective", "surveys"],
};
const IDEA = {
  type: "object",
  properties: {
    title: { type: "string" },
    approach: { type: "string" },
    targets: STRINGS,
    rationale: { type: "string" },
    risks: { type: "string" },
  },
  required: ["title", "approach", "targets", "rationale", "risks"],
};
const ASSESSED = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          approach: { type: "string" },
          targets: STRINGS,
          rationale: { type: "string" },
          risks: { type: "string" },
          slot: { type: "string" },
          potential: { type: "number" },
          feasibility: { type: "number" },
          variant_of: STRINGS,
          based_on: STRINGS,
        },
        required: [
          "title",
          "approach",
          "targets",
          "rationale",
          "risks",
          "slot",
          "potential",
          "feasibility",
          "variant_of",
          "based_on",
        ],
      },
    },
    rescored: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idea: { type: "string" },
          potential: { type: "number" },
          feasibility: { type: "number" },
          reason: { type: "string" },
        },
        required: ["idea", "potential", "feasibility", "reason"],
      },
    },
    dropped: STRINGS,
  },
  required: ["ideas", "rescored", "dropped"],
};
const TOP = {
  type: "object",
  properties: {
    idea: { type: "string" },
    title: { type: "string" },
    approach: { type: "string" },
    targets: STRINGS,
  },
  required: ["idea", "title", "approach", "targets"],
};
const BUILT = {
  type: "object",
  properties: {
    ready: { type: "boolean" },
    commit: { type: "string" },
    zip: { type: "string" },
    summary: { type: "string" },
  },
  required: ["ready", "commit", "zip", "summary"],
};
const SUBMITTED = {
  type: "object",
  properties: {
    submitted: { type: "boolean" },
    submission_id: { type: "string" },
    reason: { type: "string" },
  },
  required: ["submitted", "submission_id", "reason"],
};

const input = args || {};

if (input.stage === "record") {
  // Step 6: the result is published; the task manager's wait kept it in .contrejour/results/.
  phase("Record");
  const recorded = await agent(
    JSON.stringify({ action: "record-result", submission_id: input.submission_id }),
    {
      agentType: "worker-memory",
      schema: DONE,
      phase: "Record",
    },
  );
  // Step 7
  phase("Optimize");
  const optimized = await agent(
    JSON.stringify({ action: "optimize", side: "worker", submission_id: input.submission_id }),
    {
      agentType: "trajectory-optimizer",
      schema: DONE,
      phase: "Optimize",
    },
  );
  return {
    stage: "record",
    submission_id: input.submission_id,
    recorded: recorded.summary,
    optimized: optimized.summary,
  };
}

// Step 1
phase("Choose");
const chosen = await agent(JSON.stringify({ action: "choose" }), {
  agentType: "problem-selector",
  schema: CHOSEN,
  phase: "Choose",
});
if (chosen.surveys.length)
  await agent(
    JSON.stringify({
      action: "record-surveys",
      surveys: chosen.surveys,
      problems: chosen.problems,
    }),
    {
      agentType: "worker-memory",
      schema: DONE,
      phase: "Choose",
    },
  );

// Step 2: what each ideator sees is decided here and enforced by its role's tools.
phase("Ideate");
const params = input.params;
const brief = { task: input.task, problems: chosen.problems };
const ideator = (role, slot, index, extra) => () =>
  agent(JSON.stringify({ ...brief, ...extra, ideator: index + 1 }), {
    agentType: role,
    schema: IDEA,
    label: `${slot} ${index + 1}`,
    phase: "Ideate",
  });
const informed = Array.from({ length: params.informed_ideators }, (_, i) =>
  ideator("ideator-informed", "informed", i, {}),
);
const failuresOnly = Array.from({ length: params.failures_only_ideators }, (_, i) =>
  ideator("ideator-failures-only", "failures-only", i, { ineffective: chosen.ineffective }),
);
const blank = Array.from({ length: params.blank_ideators }, (_, i) =>
  ideator("ideator-blank", "blank", i, {}),
);
const slots = [
  ...informed.map(() => "informed"),
  ...failuresOnly.map(() => "failures-only"),
  ...blank.map(() => "blank"),
];
const proposed = await parallel([...informed, ...failuresOnly, ...blank]);
const ideas = proposed
  .map((idea, i) => (idea ? { ...idea, slot: slots[i] } : null))
  .filter(Boolean);

// Step 3
phase("Rank");
const assessed = await agent(JSON.stringify({ ideas }), {
  agentType: "idea-assessor",
  schema: ASSESSED,
  phase: "Rank",
});
const top = await agent(
  JSON.stringify({
    action: "record-ideas-and-rank",
    ideas: assessed.ideas,
    rescored: assessed.rescored,
    problems: chosen.problems,
    ucb_c: params.ucb_c,
  }),
  {
    agentType: "worker-memory",
    schema: TOP,
    phase: "Rank",
  },
);
if (!top.idea) return { stage: "build", submitted: false, reason: "no pending idea to implement" };

// Step 4
phase("Build");
const built = await agent(JSON.stringify({ idea: top, problems: chosen.problems }), {
  agentType: "implementer",
  schema: BUILT,
  phase: "Build",
});
if (!built.ready) {
  // The idea was not built: record why, so the ranking does not pick it again unchanged.
  await agent(
    JSON.stringify({ action: "record-build-failure", idea: top.idea, reason: built.summary }),
    { agentType: "worker-memory", schema: DONE, phase: "Build" },
  );
  return { stage: "build", submitted: false, reason: built.summary };
}

// A trial run stops here: nothing reaches the validator, no submission is used.
if (input.trial)
  return {
    stage: "build",
    submitted: false,
    trial: true,
    commit: built.commit,
    reason: built.summary,
  };

// Step 5: after this the round waits for the published result.
phase("Submit");
const submitted = await agent(
  JSON.stringify({
    action: "submit",
    commit: built.commit,
    zip: built.zip,
    idea: top.idea,
    problems: top.targets,
    note: built.summary,
  }),
  { agentType: "worker-task-manager", schema: SUBMITTED, phase: "Submit" },
);
return {
  stage: "build",
  submitted: submitted.submitted,
  submission_id: submitted.submission_id,
  reason: submitted.reason,
};

// contrejour-loop-definition-sha256: eab58307e3c1c149599a0cab54eaa893b5be666bc6ef2ee348e7e9ccdf4c20b5
