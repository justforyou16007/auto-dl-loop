export const meta = {
  name: "proposal-review",
  description:
    "Put trajectory-optimizer's proposed role fixes to the owner and apply exactly the ones accepted",
  whenToUse:
    "Validator, when the owner asks. Run with {}, then again with the owner's replies in answers.",
  phases: [{ title: "Pending" }, { title: "Review" }, { title: "Apply" }],
};

const STRINGS = { type: "array", items: { type: "string" } };
const PENDING = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          role: { type: "string" },
          file: { type: "string" },
          summary: { type: "string" },
        },
        required: ["id", "role", "file", "summary"],
      },
    },
    digest: { type: "string" },
  },
  required: ["proposals", "digest"],
};
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
const APPLIED = {
  type: "object",
  properties: { applied: STRINGS, rejected: STRINGS, summary: { type: "string" } },
  required: ["applied", "rejected", "summary"],
};

const answers = (args && args.answers) || {};
let notes = "";
for (let round = 1; round <= 4; round += 1) {
  // Step 1
  phase("Pending");
  const pending = await agent(JSON.stringify({ action: "pending", notes }), {
    agentType: "trajectory-optimizer",
    schema: PENDING,
    phase: "Pending",
  });
  if (!pending.proposals.length) return { applied: [], reason: "no proposal is pending" };
  // Step 2
  phase("Review");
  const id = `proposals:${pending.digest}`;
  const decided = await agent(
    JSON.stringify({
      review_id: id,
      subject: "role fixes proposed by trajectory-optimizer",
      request:
        "Accept which of these proposals? Each changes the role exactly as its file shows; the rest are recorded as rejected.",
      materials: { proposals: pending.proposals },
      approvable: true,
      answer: answers[id] ?? null,
    }),
    { agentType: "owner-review", schema: REVIEW, phase: "Review" },
  );
  if (decided.decision === "ask")
    return {
      waiting: "owner",
      review_id: id,
      question: decided.question,
      document: decided.document,
    };
  if (decided.decision === "cancel") return { applied: [], reason: "the owner cancelled" };
  if (decided.decision === "approve") {
    // Step 3
    phase("Apply");
    const ids = pending.proposals.map((proposal) => proposal.id);
    const applied = await agent(
      JSON.stringify({
        action: "apply",
        accepted: decided.accepted,
        rejected: ids.filter((proposal) => !decided.accepted.includes(proposal)),
      }),
      { agentType: "trajectory-optimizer", schema: APPLIED, phase: "Apply" },
    );
    return applied;
  }
  notes = decided.notes;
}
return { applied: [], reason: "no decision within 4 reviews" };

// contrejour-loop-definition-sha256: 9db868f9051c2ba2f208986e1037a8dea42739b31de5bc3409e019657952ba0f
