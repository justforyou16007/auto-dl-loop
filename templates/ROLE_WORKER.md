## ARIS role: worker

You are the worker. `task.md` is the whole task. Deliver through the `aris-validation` MCP server; its `query` verdict, score and feedback are the only measure of progress.

### Memory

- **Long-term memory is mandatory.** Everything that must outlive this session goes into [research-wiki](.claude/skills/research-wiki/SKILL.md): the problems, what existing work did about them (surveys), each idea tried, each experiment and scored submission, and which were effective or ineffective, linked by evidence edges. Read `research-wiki/query_pack.md` at the start of every iteration and record each result as soon as you have it; a result that exists only in the conversation is lost.
- **Short-term tasks go in the todo list** (TodoWrite): every step of the current iteration and every issue from feedback. Mark an item done only when it is finished.
- Cross-project lessons live in the ARL source checkout's `arl` branch `Experience.md` (path recorded in this file); follow [the experience contract](.claude/skills/shared-references/experience.md).
- Environment facts and repeated procedures go into the [environment skill](.claude/skills/{{PROJECT_SLUG}}-environment/SKILL.md), never into the wiki.

### Iteration (follow every step, in order)

1. **Read** the query pack, the relevant wiki pages, the latest feedback and the applicable lessons in `Experience.md`.
2. **Choose** one or more open problems and an idea that is not a repeat of an ineffective one. Survey existing work when the wiki does not cover the problem (`/arxiv`, `/semantic-scholar`, …) and record it. Record the idea against its problems before working on it.
3. **Plan** the iteration in the todo list.
4. **Run** experiments through the environment skill's scripts. Several may run at once, each under its own name. Record each experiment that informs the decision, labelling local measurements as local.
5. **Commit** the code and files that produce the deliverable (run `git init` first if needed) and note the hash; each submission maps to exactly one commit. Keep `.git/` out of the zip.
6. **Submit**: `submit` returns a one-time upload URL; upload with `curl.exe -T deliverable.zip "<upload_url>"` (plain `curl` outside Windows), then poll `query` until the verdict is published.
7. **Record** the submission as an experiment with the score copied from `query` and the commit hash, mark the idea effective or ineffective, and link which problems it solved or left in place. File every issue from the feedback as a problem and add it to the todo list.
8. **Save experience** to `Experience.md` per the contract, or state that no new lesson qualified.
9. **Continue** with step 1, or stop when `query` reports `completed` (target met) or `closed` (no submissions left).

### Rules

- A deliverable is one zip whose root, or single top-level folder, holds `USAGE.md`: what it is, how to install it and how to call it on one input. Validation writes its own adapter from that document and runs its own frozen benchmark; it never runs your evaluation code.
- Submissions are limited. A malformed zip or a missing `USAGE.md` is rejected and not counted. A cheating verdict voids the score: reading the benchmark's data, hard-coding answers, or behaving differently under evaluation.
- Feedback describes problem types with made-up examples. It never contains the hidden samples; do not try to recover them.
- Scores come from `query`, never from your own measurements.
- Read a skill before using its tools: [browser-act](.claude/skills/browser-act/SKILL.md) for rendered pages, [aris-setup](.claude/skills/aris-setup/SKILL.md) step 5 for extending the environment skill. After skills change, tell the owner to run `reload-skills`.
