---
name: configure
description: Setup's first step on the worker — the configuration sheet with the connection to the validator, from which task.md comes, applying it, and the machine's environment. It takes the framework's configure's place in worker projects.
side: worker
kind: on-request
triggers: record-trajectory, guard-owner-answers
check-args: [{}]
---

# Configure (worker)

## Purpose

What is particular to a worker machine, as the first step of the framework's `setup`: the connection to the validator, from which the task comes, the keys its environment scripts need, and the environment itself. `setup` then goes on as it does for every project: the loop the project runs and its parameter values, the checks and the hand-off. The owner also runs this loop alone when something about the machine changes, from the Studio's chat or with `claude "Run the configure loop"`. Configure the validator first: this fetches `task.md` from its running service. It starts no research.

## Inputs

- `requirement`: the owner's words, which `setup` passes on; the worker's task comes from the validator, so the steps do not need it.
- `answers`: the owner's replies so far, by review id; the session adds each one as it comes (see `running-loops.md`).

## Steps

1. **Sheet** — `worker-config` turns the owner's words into changes to the configuration sheet, fetches `task.md` from the validator once the connection is set, and refreshes the sheet (`{action: "sheet", notes, reason}`). `owner-review` shows the whole sheet (`review_id` `sheet:<round>:<digest>`); approval is possible only when it has no open issue. `revise` sends the owner's words back to this step; `cancel` ends the loop.
2. **Apply** — `worker-config` confirms the approved digest and applies it (`{action: "apply", digest}`). When the validator changed `task.md` meanwhile, or the apply fails, the sheet goes back to step 1 with the reason.
3. **Environment** — `worker-config` creates the wiki, writes and runs the environment skill's scripts and writes the environment section (`{action: "environment", notes}`). When it needs facts only the owner has, `owner-review` asks (`review_id` `environment:<round>`).
4. **Report** — `worker-config` writes what this configuration settled, for setup's hand-off (`{action: "report", applied, environment, incomplete}`), and the loop ends with `{done: true, report}`.

## Bounds

12 sheet rounds, 3 environment rounds.

## Waiting

Steps 1 and 3 wait for the owner: the loop returns `{waiting: "owner", review_id, question, document}`, and the session runs it again with the reply in `answers`.

## Triggers

- `record-trajectory`: every role that finishes leaves its trajectory.
- `guard-owner-answers`: every answer the session passes in is the owner's own message, typed after the loop stopped at that review; anything else is blocked before the loop runs.
