# Project rules: the research task

This project is one side of a task run on two machines: the **worker** researches and builds a deliverable, round after round, and submits it; the **validator** reviews each submission against a benchmark that only grows and against hidden tests the worker never sees, and publishes the result. The two talk only through the validation service. These rules are the project's own; the framework's roles read them where their files say so.

## Task loops

- A worker task loop is run by `worker-task-manager` round after round, split where it waits for a result, as `research-iteration` is: `{stage: "build", task, params}`, then `{stage: "record", submission_id, params}` once the result is published. It submits only through `worker-task-manager`'s `submit` step, the only role that talks to the validation service.
- A validator task loop is run by the validation service once per submission, with `{submission_id, submission_dir, params}`, in a session running as `validator-task-manager`. It ends with that role's `finalize` step, or its `abandon` step when the validator cannot complete the review; nothing reaches the worker except what finalize publishes.
## Setting up

- Each machine is configured first by this package's own `configure` loop: on the worker the connection to the validator and `task.md`, fetched from the validator's service, so the validator comes first: configured, its workflow set up and its service running; on the validator `task.md`, the benchmark, the terms and the service. Both prepare the machine's environment. It is the research task's, apart from the project's workflow.
- The project's workflow is set up by the framework's `setup` loop, after `configure`: normally `research-iteration` on the worker and `submission-review` on the validator, with their parameter values. `loop-trial` tries `research-iteration` with its `trial` argument, which stops the round before it submits; `submission-review` needs a real submission, so it is not tried.
- How to start, for setup's hand-off: on the worker, `claude --permission-mode bypassPermissions "start"` in the project, after opening `claude` once to approve the `contrejour` server when starting from the Studio; on the validator, the service command `configure`'s report names, kept running, after which the service starts every review itself.

## Hook actions

Added by this project's extension, and declared by the loops that need them:

- `notify-stopped-review` (validator; a session stopped): tell the service a review session stopped with its submission unfinished, so it continues it.
- `guard-protected-paths` (validator; before a file write): block writes to the benchmark, its frozen configuration, the hidden data, the chosen loop and the helper's own records.

## Trajectories and their optimization

- A run is identified by `{side, submission_id}`, on the validator also `submission_dir`; the trajectory index tags each entry with the submission its session worked on.
- Outcomes. Worker: `.contrejour/results/<id>.json` and `node .contrejour/dist/tools/worker-cli.js ledger --project . --submission <id>`. Validator: `node .contrejour/dist/tools/validation-cli.js status --project . --submission <id>` (the published result, the leak reviews, the reminders).
- On the worker, `trajectory-optimizer` fixes roles directly and commits each fix.
- On the validator, the trajectories hold the hidden tests and text the worker wrote, the validator's adversary; neither may find its way into a role. `trajectory-optimizer` only proposes, and a proposal takes effect when the owner accepts it in `proposal-review`. A proposal may describe how tests are constructed, never contain one.

## Optimizing and contributing

- What a project improves stays in it: on the worker `trajectory-optimizer` fixes roles in the project and commits each fix; on the validator it only proposes (above).
- A task has finished when a submission's review ended and its result was published; `invalid`, `expired` and `failed` submissions do not count. After that, when the owner decides to, `library-contribution` sends the loops and roles the owner chooses, new or improved, to the community library.
- On the validator, nothing leaves before this side's `contribution-check` has run: `leak-reviewer` checks exactly the files that would leave against the hidden tests and records its verdict on the plan's digest (`node .contrejour/dist/tools/library-cli.js record-check`).
- The validation service's token and the hidden data never leave.
