---
name: configure
description: Configure this machine as the worker — the configuration sheet with the connection to the validator, from which task.md comes, applying it, the machine's environment and the report for the owner. The project's workflow is set up by the framework's setup, apart from this.
side: worker
kind: on-request
triggers: record-trajectory, guard-owner-answers
check-args: [{}]
---

# Configure (worker)

## Purpose

What only a worker machine has: the connection to the validator, from which the task comes, the keys its environment scripts need, and the environment itself. This is the research task's own configuration, apart from the project's workflow, which the framework's `setup` sets up (the loop the project runs and its parameter values). The owner runs this loop when the machine is new, before `setup`, and again when something about the machine changes, from the Studio (pick it in the list above the canvas and press Run) or with `claude "Run the configure loop"`. Set the validator up first (configured, its workflow set up, its service running): this fetches `task.md` from that service. It starts no research.

## Inputs

- `answers`: the owner's replies so far, by review id; the session adds each one as it comes (see `running-loops.md`).

## Steps

1. **Sheet** — `worker-config` turns the owner's words into changes to the configuration sheet, fetches `task.md` from the validator once the connection is set, and refreshes the sheet (`{action: "sheet", notes, reason}`). `owner-review` shows the whole sheet (`review_id` `sheet:<round>:<digest>`); approval is possible only when it has no open issue. `revise` sends the owner's words back to this step; `cancel` ends the loop.
2. **Apply** — `worker-config` confirms the approved digest and applies it (`{action: "apply", digest}`). When the validator changed `task.md` meanwhile, or the apply fails, the sheet goes back to step 1 with the reason.
3. **Environment** — `worker-config` creates the wiki, writes and runs the environment skill's scripts and writes the environment section (`{action: "environment", notes}`). When it needs facts only the owner has, `owner-review` asks (`review_id` `environment:<round>`).
4. **Report** — `worker-config` writes the report for the owner: what this configuration settled and what comes next (`{action: "report", applied, environment, incomplete}`), and the loop ends with `{done: true, report}`.

## Bounds

12 sheet rounds, 3 environment rounds.

## Waiting

Steps 1 and 3 wait for the owner: the loop returns `{waiting: "owner", review_id, question, document}`, and the session runs it again with the reply in `answers`.

## Triggers

- `record-trajectory`: every role that finishes leaves its trajectory.
- `guard-owner-answers`: every answer the session passes in is the owner's own message, typed after the loop stopped at that review; anything else is blocked before the loop runs.
