export const meta = {
  name: "submission-review",
  description:
    "Review one submission as the worker's adversary: inspect, adapt, rerun every layer, hunt and extend, verdict and feedback, leak review, publish, record, propose role fixes",
  whenToUse:
    'Validator. The service starts one session per submission; its task manager runs this loop with {"submission_id": "<id>", "submission_dir": "<path>"}.',
  phases: [
    { title: "Inspect" },
    { title: "Adapt" },
    { title: "Regress" },
    { title: "Extend" },
    { title: "Verdict" },
    { title: "Leak review" },
    { title: "Publish" },
    { title: "Record" },
    { title: "Optimize" },
  ],
};

const DONE = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
const STRINGS = { type: "array", items: { type: "string" } };
const INSPECTED = {
  type: "object",
  properties: { suspicions: STRINGS, summary: { type: "string" } },
  required: ["suspicions", "summary"],
};
const ADAPTED = {
  type: "object",
  properties: {
    runs: { type: "boolean" },
    our_side: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["runs", "our_side", "summary"],
};
const REGRESSED = {
  type: "object",
  properties: {
    complete: { type: "boolean" },
    our_side: { type: "boolean" },
    adapter_defect: { type: "boolean" },
    layers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          layer: { type: "string" },
          total: { type: "integer" },
          passed: { type: "integer" },
          failed: { type: "integer" },
        },
        required: ["layer", "total", "passed", "failed"],
      },
    },
    summary: { type: "string" },
  },
  required: ["complete", "our_side", "adapter_defect", "layers", "summary"],
};
const ABANDONED = {
  type: "object",
  properties: { abandoned: { type: "boolean" }, reason: { type: "string" } },
  required: ["abandoned", "reason"],
};
const EXTENDED = {
  type: "object",
  properties: {
    found_new_problems: { type: "boolean" },
    layers_added: STRINGS,
    summary: { type: "string" },
  },
  required: ["found_new_problems", "layers_added", "summary"],
};
const VERDICT = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["valid", "cheating", "unusable"] },
    has_feedback: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["verdict", "has_feedback", "summary"],
};
const LEAK = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "leak", "exhausted"] },
    findings: STRINGS,
  },
  required: ["verdict", "findings"],
};
const PUBLISHED = {
  type: "object",
  properties: {
    published: { type: "boolean" },
    verdict: { type: "string" },
    reason: { type: "string" },
  },
  required: ["published", "verdict", "reason"],
};

const submission = { submission_id: args.submission_id, submission_dir: args.submission_dir };
const params = args.params;
const input = (extra) => JSON.stringify({ ...submission, ...extra });

// Step 1
phase("Inspect");
const inspected = await agent(input({}), {
  agentType: "inspector",
  schema: INSPECTED,
  phase: "Inspect",
});

// A failure on our side that cannot be fixed ends the review uncounted: the worker may submit again at once.
const abandon = async (reason) => {
  const ended = await agent(JSON.stringify({ action: "abandon", ...submission, reason }), {
    agentType: "validator-task-manager",
    schema: ABANDONED,
    phase: "Publish",
  });
  return { ...submission, published: false, abandoned: ended.abandoned, reason: ended.reason };
};

// Step 2
phase("Adapt");
let adapted = await agent(input({}), {
  agentType: "adapter-writer",
  schema: ADAPTED,
  phase: "Adapt",
});
if (adapted.our_side) return await abandon(adapted.summary);

// Steps 3 and 4 need a deliverable that runs and a complete run of every layer.
let complete = false;
if (adapted.runs) {
  phase("Regress");
  let regressed = await agent(input({}), {
    agentType: "regression-runner",
    schema: REGRESSED,
    phase: "Regress",
  });
  // A defect in the adapter goes back to the adapter's writer, then the layers run again.
  for (
    let attempt = 1;
    regressed.adapter_defect && attempt <= params.max_adapter_fixes;
    attempt += 1
  ) {
    adapted = await agent(input({ fix: regressed.summary }), {
      agentType: "adapter-writer",
      schema: ADAPTED,
      phase: "Regress",
    });
    if (adapted.our_side) return await abandon(adapted.summary);
    if (!adapted.runs) break;
    regressed = await agent(input({}), {
      agentType: "regression-runner",
      schema: REGRESSED,
      phase: "Regress",
    });
  }
  if (regressed.our_side) return await abandon(regressed.summary);
  complete = adapted.runs && regressed.complete && !regressed.adapter_defect;
  if (complete) {
    phase("Extend");
    for (let round = 1; round <= params.max_extension_rounds; round += 1) {
      const extended = await agent(input({ round }), {
        agentType: "test-extender",
        schema: EXTENDED,
        phase: "Extend",
      });
      if (!extended.found_new_problems) break;
    }
  }
}

// Step 5
phase("Verdict");
let verdict = await agent(
  input({ runs: adapted.runs, complete, suspicions: inspected.suspicions }),
  {
    agentType: "verdict-writer",
    schema: VERDICT,
    phase: "Verdict",
  },
);

// Step 6: the reviewer starts fresh every time; the author cannot change what it is given.
phase("Leak review");
for (let attempt = 1; verdict.has_feedback && attempt <= params.max_leak_reviews; attempt += 1) {
  const review = await agent(input({}), {
    agentType: "leak-reviewer",
    schema: LEAK,
    phase: "Leak review",
  });
  if (review.verdict !== "leak") break;
  verdict = await agent(input({ rewrite: true, findings: review.findings }), {
    agentType: "verdict-writer",
    schema: VERDICT,
    phase: "Leak review",
  });
}

// Step 7
phase("Publish");
const published = await agent(JSON.stringify({ action: "finalize", ...submission }), {
  agentType: "validator-task-manager",
  schema: PUBLISHED,
  phase: "Publish",
});
if (!published.published) return { ...submission, published: false, reason: published.reason };

// Steps 8 and 9 use only what was published.
phase("Record");
await agent(JSON.stringify({ action: "record-review", ...submission }), {
  agentType: "validator-memory",
  schema: DONE,
  phase: "Record",
});
phase("Optimize");
const optimized = await agent(
  JSON.stringify({ action: "optimize", side: "validator", ...submission }),
  {
    agentType: "trajectory-optimizer",
    schema: DONE,
    phase: "Optimize",
  },
);
return { ...submission, published: true, verdict: published.verdict, optimized: optimized.summary };

// contrejour-loop-definition-sha256: af3519a7c42f9d7005f6916d17bf9341e2a18c2382c1618feae25f3c821eb202
