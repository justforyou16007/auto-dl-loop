---
name: research-iteration
description: One worker research round — choose problems, five ideators with different knowledge, assess and rank, implement, submit — and, once the result is published, record it and fix the roles.
side: worker
triggers: record-trajectory
check-args: [{"stage": "build", "task": "stub task"}, {"stage": "record", "submission_id": "s001"}]
---

# Research iteration

## Purpose

The worker's loop: one round turns the open problems into one submitted deliverable, and the published result into memory and role fixes. `worker-task-manager` runs it round after round until `query` reports `closed`; passing every current test does not end the task, because validation keeps adding tests.

## Inputs

- `stage`: `build` for the part up to the submission, `record` once that submission's result is published.
- `task`: with `build`, the full text of `task.md`, which the task manager has just fetched.
- `submission_id`: with `record`, the submission whose result was published.

## Steps

The round is split where it waits for the result: the task manager runs `build`, waits in the background until the result is published (`worker-cli.js wait`), then runs `record`.

`build`:

1. **Choose** — `problem-selector` picks one or more open problems (`[regressed]` first) from the query pack, the wiki and the latest result, and returns them with the ineffective ideas and what each tried. When the wiki does not cover the chosen problems, it surveys existing work and returns the surveys; `worker-memory` records them (only when there are any), with the chosen problems so that a new problem is filed with its statement.
2. **Ideate** — five ideators run at once, each returning one idea (title, approach, targets, rationale, risks). What each sees is decided here and enforced by its role's tools:
   - three `ideator-informed`: the task, the problems, and read access to the query pack, the wiki and the latest result;
   - one `ideator-failures-only`: the task, the problems and only the ineffective ideas with what each tried;
   - one `ideator-blank`: the task and the problems, nothing else, and no file tools.
   Each idea is tagged with its slot.
3. **Rank** — `idea-assessor` drops ideas that repeat an ineffective one, scores the rest (potential and feasibility, 0–1, with `variant_of` and `based_on`, keeping each idea's rationale and risks), and rescores pending ideas from earlier rounds that new evidence changes. `worker-memory` records the new ideas and the rescores, files any new target problem with its statement, and ranks all pending ideas with `rank_ideas`; it returns the top one. With no pending idea left, the round ends.
4. **Build** — `implementer` implements the top idea and runs its experiments, then commits and builds the zip and `USAGE.md` to the submission requirements. If it cannot get a deliverable ready, `worker-memory` records why against the idea, so it is not picked again unchanged, and the round ends with that reason.
5. **Submit** — `worker-task-manager` submits and uploads the zip and records the submission in the ledger, with the implementer's summary as its note.

`record`:

6. **Record** — `worker-memory` records the published verdict and test counts as an experiment, marks the idea effective or ineffective, and files every problem the feedback names. A submission that was `invalid`, `expired` or `failed` is recorded with its reason for the next round.
7. **Optimize** — `trajectory-optimizer` reads the round's trajectories and fixes the execution problems they show in the worker's roles.

## Bounds

One round has one submission; the five ideators run once. The task manager decides whether to start another round.

## Triggers

- `record-trajectory`: every role that finishes leaves its trajectory for step 7.
