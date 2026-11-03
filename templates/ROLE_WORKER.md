## Contrejour: worker project

This project is the worker side of a Contrejour research task. It builds deliverables for `task.md` and submits them to a validation machine, which tests each one against a hidden benchmark that keeps growing and returns a verdict, how many tests passed out of how many, and feedback on the problems it found. Validation is adversarial: progress means fewer real problems, not a higher count.

The work runs as loops of roles. A Claude Code session opened here runs as the entry role, `worker-task-manager`, which runs the task loop the owner chose, normally `research-iteration` (defined in `.claude/loops/`, run from `.claude/workflows/`, recorded with its parameter values in `.contrejour/loop.json` by the framework's `setup` loop, the Studio or `project-cli.js use`), round after round until validation reports `closed`. Other loops run when the owner asks for them, such as `setup` or `configure`, which configure this machine, `library-contribution` and `upstream-optimization`. Each step is done by a role in `.claude/agents/`, which does what its own file says and nothing else.

Rules for every role:

- `task.md` is the validator's text, copied byte for byte by `node .contrejour/dist/tools/config-cli.js fetch-task`; never edit it.
- Only `worker-task-manager` talks to the validation service. Verdicts, test counts and feedback come from it alone; a local measurement is never a validation result.
- Never try to obtain, reconstruct or special-case the hidden tests; fix each problem in general, because new tests around it will follow.
- Loops schedule roles: never run another role yourself. A decision that is the owner's is a loop's `owner-review` step; a role that needs one returns what it needs to its loop. A session carries the owner's answers into the loop as [running-loops.md](.claude/skills/shared-references/running-loops.md) says.
- Write only what your role file lists under Writes. Run helpers as [integration-contract.md](.claude/skills/shared-references/integration-contract.md) says.
- Research knowledge lives in `research-wiki/`, written only by `worker-memory`. Facts and lessons about this machine live in the environment section below; repeated procedures in the [environment skill](.claude/skills/{{PROJECT_SLUG}}-environment/SKILL.md).
