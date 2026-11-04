---
name: configure
description: Configure this machine as the validator — what it should validate, task.md, the configuration sheet with the validation terms, applying it, the machine's environment and the report for the owner. The project's workflow is set up by the framework's setup, apart from this.
side: validator
kind: on-request
triggers: record-trajectory, guard-owner-answers
check-args: [{"requirement": "start"}, {"requirement": "Validate question-answering programs against a hidden test set; the worker gets 5 submissions."}]
---

# Configure (validator)

## Purpose

What only a validator machine has: the task the worker gets (`task.md`), the benchmark and the terms each submission is judged by, the service the worker reaches, and the machine's environment. This is the research task's own configuration, apart from the project's workflow, which the framework's `setup` sets up (the loop that reviews each submission and its parameter values). The owner runs this loop when the machine is new, before `setup`, and again when the machine's terms change, from the Studio (pick it in the list above the canvas and press Run) or with `claude "Run the configure loop"`.

## Inputs

- `requirement`: the owner's first message, verbatim.
- `answers`: the owner's replies so far, by review id; the session adds each one as it comes (see `running-loops.md`).

## Steps

1. **Requirement** — `validator-config` reads the requirement and the owner's later words (`{action: "requirement", requirement, notes}`): when they say what this machine should validate, it restates the requirement for `task.md`; otherwise it says what it needs to know, `owner-review` asks the owner (`review_id` `requirement:<round>`), and their words come back as `notes`.
2. **Task** — `validator-config` writes `task.md` from the requirement when it is missing, or revises it as the owner's words ask (`{action: "task", requirement, notes}`). When it wrote or changed it, `owner-review` shows it (`review_id` `task:<digest>`): the whole task the worker will get. Approval goes on; `revise` sends the owner's words back to this step; `cancel` ends the loop. A `task.md` the owner wrote and this loop did not change needs no review.
3. **Sheet** — `validator-config` turns the owner's words into changes to the configuration sheet and refreshes it (`{action: "sheet", notes, reason}`). `owner-review` shows the whole sheet (`review_id` `sheet:<round>:<digest>`); approval is possible only when it has no open issue. `revise` sends the owner's words back to this step; `cancel` ends the loop.
4. **Apply** — `validator-config` confirms the approved digest and applies it (`{action: "apply", digest}`): the benchmark is installed and frozen, the token created. When the apply fails, the sheet goes back to step 3 with the reason.
5. **Environment** — `validator-config` creates the wiki, writes and runs the environment skill's scripts and writes the environment section (`{action: "environment", notes}`). When it needs facts only the owner has, `owner-review` asks (`review_id` `environment:<round>`).
6. **Report** — `validator-config` writes the report for the owner: what this configuration settled, the connection the worker needs and what comes next (`{action: "report", requirement, applied, environment, incomplete}`), and the loop ends with `{done: true, requirement, report}`.

## Bounds

3 requirement rounds, 6 task rounds, 12 sheet rounds, 3 environment rounds.

## Waiting

Steps 1, 2, 3 and 5 wait for the owner: the loop returns `{waiting: "owner", review_id, question, document}`, and the session runs it again with the reply in `answers`.

## Triggers

- `record-trajectory`: every role that finishes leaves its trajectory.
- `guard-owner-answers`: every answer the session passes in is the owner's own message, typed after the loop stopped at that review; anything else is blocked before the loop runs.
