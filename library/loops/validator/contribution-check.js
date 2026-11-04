export const meta = {
  name: "contribution-check",
  description:
    "The validator's check of exactly what would leave: a leak review against the hidden tests, from a fresh context",
  whenToUse:
    "As a step of library-contribution, when the plan says the validator's own check is required. Run it with the plan's digest and files.",
  phases: [{ title: "Leak check" }],
};

const STRINGS = { type: "array", items: { type: "string" } };
const LEAK = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["pass", "leak"] }, findings: STRINGS },
  required: ["verdict", "findings"],
};

const input = args || {};

// Step 1: the reviewer starts fresh, and records its verdict on exactly this plan.
phase("Leak check");
const leak = await agent(
  JSON.stringify({ action: "check-library", digest: input.digest, files: input.files || [] }),
  { agentType: "leak-reviewer", schema: LEAK, phase: "Leak check" },
);
return { verdict: leak.verdict === "pass" ? "pass" : "fail", findings: leak.findings };

// contrejour-loop-definition-sha256: 98ad9cd9bdb1258c5809cd900b954084976a69aac0fdcf12d8b100327561f7f7
