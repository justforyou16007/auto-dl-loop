---
name: submission-review
description: Review one submission as the worker's adversary — inspect, adapt, rerun every layer, hunt and extend, verdict and feedback, independent leak review, publish, record, propose role fixes.
side: validator
kind: task
triggers: record-trajectory, notify-stopped-review, guard-protected-paths
check-args: [{"submission_id": "s001", "submission_dir": "/validator/.contrejour/validation/submissions/s001"}]
---

# Submission review

## Purpose

The validator's loop for one submission. Its goal is not a score: it is to find as many real problems in the deliverable as possible within `task.md`, and to make sure a problem the worker claims to have fixed is fixed in general and not patched for the tests that exposed it. The validation service starts one Claude Code session per submission; its `validator-task-manager` runs this loop. Nothing reaches the worker until step 7 publishes.

## Inputs

- `submission_id`, `submission_dir`: the submission to review and its directory.
- `params`: the parameter values setup recorded in `.contrejour/loop.json`; the service passes them with each submission.

## Steps

1. **Inspect** — `inspector` reads the deliverable before anything runs and records signs of cheating in `inspection.md`.
2. **Adapt** — `adapter-writer` installs the deliverable as `USAGE.md` says and writes the adapter to the adapter contract, using the smoke subset. It reports whether the deliverable runs, and whether something on our side that it could not fix stopped it.
3. **Regress** — only if it runs: `regression-runner` runs every active benchmark layer and reports whether every layer completed, whether the adapter showed a defect, and whether something on our side stopped it. It never edits the adapter: a defect goes back to `adapter-writer` with the runner's summary, then the layers run again, at most `max_adapter_fixes` times.

   When step 2 or 3 reports a failure on our side that could not be fixed, the deliverable was never fairly tried: `validator-task-manager` abandons the review (`validation-cli.js abandon`), which ends it as `failed`, uncounted, so the worker can submit again at once. The loop ends there.
4. **Extend** — only after a complete regression: `test-extender` hunts for more problems and registers new tests derived from existing ones as new layers, run on this submission. It repeats while new tests keep finding problems, at most `max_extension_rounds` rounds.
5. **Verdict** — `verdict-writer` writes the verdict (`valid`, `cheating`, `unusable`) and the feedback on the real problems, given whether the deliverable ran, whether every layer completed and what the inspection suspects.
6. **Leak review** — while there is feedback: `leak-reviewer`, from a fresh context, checks the feedback against the hidden tests. On a leak, `verdict-writer` rewrites the feedback from the findings and the reviewer checks again; at most `max_leak_reviews` reviews. When the helper refuses more reviews, the result is published without feedback.
7. **Publish** — `validator-task-manager` finalizes. If finalize refuses, the loop ends with its reason; the task manager deals with it.
8. **Record** — `validator-memory` records, from the published result only, which problems this submission solved and which persist.
9. **Optimize** — `trajectory-optimizer` reads the review's trajectories and writes proposals to fix the execution problems of the validator's roles; they take effect only when the owner accepts them in the `proposal-review` loop.

## Bounds

Per run of the loop, at most `max_adapter_fixes` adapter fixes, `max_extension_rounds` extension rounds and `max_leak_reviews` leak reviews.

## Parameters

```json
[
  { "name": "max_adapter_fixes", "type": "integer", "default": 2, "min": 0, "max": 5, "description": "Times an adapter defect the full runs exposed goes back to the adapter writer before the layers run again." },
  { "name": "max_extension_rounds", "type": "integer", "default": 3, "min": 0, "max": 10, "description": "Rounds of hunting for problems and registering derived tests per review; the validation terms' max_new_tests_per_review still caps the tests added." },
  { "name": "max_leak_reviews", "type": "integer", "default": 5, "min": 1, "max": 10, "description": "Leak reviews per run of the loop; the validation terms' feedback_attempts still decides when feedback is withheld." }
]
```

## Waiting

Long benchmark runs are waited for inside the role that started them: it runs them in the background and checks on them. If the session stops before step 7, the service continues it, and the task manager resumes this loop; roles keep work already done.

## Triggers

- `record-trajectory`: every role that finishes leaves its trajectory for step 9.
- `notify-stopped-review`: a review session that stops with its submission unfinished and nothing running tells the service at once.
- `guard-protected-paths`: no role writes the benchmark, its frozen configuration, the hidden data, or the files only the helper writes.
