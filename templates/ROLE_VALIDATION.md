## ARIS role: validation

This project judges deliverables for the task in `task.md`. The `aris-validation` service script (see `paseo.json`) receives submissions and starts one validation agent per submission (Codex at `max`) with the `validation-review` skill.

- **Long-term memory is mandatory.** `research-wiki/` on this machine records the verification problems found across submissions, which ones each submission solved and which persist. Every review reads `research-wiki/query_pack.md` first and records its findings before finalizing. It never holds hidden samples, labels, references or anything copied from them.
- **Short-term tasks go in the todo list**: the review steps of the current submission.
- **Follow the `validation-review` steps in order**; none may be skipped.
- The benchmark in `.aris/tester-config.json` and the terms in `.aris/validation/config.json` are frozen. Do not edit them, the files they pin, or the hidden data.
- A validation agent works in its submission directory and records to the wiki only through its helper. It never sends anything to the worker; the service publishes the score and the feedback that passes the leak check.
- Machine facts and repeated procedures live in the [environment skill](.agents/skills/{{PROJECT_SLUG}}-environment/SKILL.md).
- Status for the owner: `node .aris/dist/tools/validation-cli.js status --project .`
