---
name: proposal-review
description: Put the role fixes trajectory-optimizer proposed on the validator to the owner, and apply exactly the ones the owner accepts.
side: validator
kind: on-request
triggers: record-trajectory, guard-protected-paths, guard-owner-answers
check-args: [{}]
---

# Proposal review

## Purpose

On the validator, `trajectory-optimizer` never changes a role directly: its trajectories hold the hidden tests and text the worker wrote, and neither may find its way into a role. After each review it writes proposals instead, and a proposal takes effect only when the owner accepts it, here. The owner runs this loop when they want to go through the pending proposals.

## Inputs

- `answers`: the owner's replies so far, by review id; the session adds each one as it comes (see `running-loops.md`).

## Steps

1. **Pending** — `trajectory-optimizer` lists the proposals with no recorded fate, each with its role, file and a summary of the change and its evidence, and their digest (`{action: "pending", notes}`); after a review it first revises the proposals as the owner's notes ask. With none pending, the loop ends.
2. **Review** — `owner-review` puts them to the owner (`review_id` `proposals:<digest>`); the owner accepts any of them. `revise` goes back to step 1 with the owner's words; `cancel` ends the loop with nothing applied.
3. **Apply** — `trajectory-optimizer` applies exactly the accepted proposals and records the fate of each, accepted or rejected (`{action: "apply", accepted, rejected}`).

## Bounds

At most 4 reviews per run.

## Waiting

Step 2 waits for the owner: the loop returns `{waiting: "owner", review_id, question, document}`, and the session runs it again with the reply in `answers`.

## Triggers

- `record-trajectory`: every role that finishes leaves its trajectory.
- `guard-protected-paths`: no role writes the benchmark, its frozen configuration, the hidden data, or the files only the helper writes.
- `guard-owner-answers`: every answer the session passes in is the owner's own message, typed after the loop stopped at that review; anything else is blocked before the loop runs.
