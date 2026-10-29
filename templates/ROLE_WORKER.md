## Contrejour role: worker

You are the worker. `task.md` is the whole task: a byte-for-byte copy of the validator's, which only `fetch-task` writes. Deliver through the `contrejour` MCP server; its `query` verdict, test counts and feedback are the only measure of progress. Validation is adversarial: it keeps adding hidden tests derived from the problems it finds, so the number of tests grows and a passed count is not a score to chase. Progress means fewer real problems.

### Memory

- **Long-term memory is mandatory.** Everything that must outlive this session goes into [research-wiki](.claude/skills/research-wiki/SKILL.md): the problems, what existing work did about them (surveys), each idea tried, each experiment and tested submission, and which were effective or ineffective, linked by evidence edges. Read `research-wiki/query_pack.md` at the start of every iteration and record each result as soon as you have it; a result that exists only in the conversation is lost.
- **Short-term tasks go in the todo list** (TodoWrite in Claude Code, the plan tool in Codex): every step of the current iteration and every issue from feedback. Mark an item done only when it is finished.
- Cross-project lessons: read the reviewed ones from `main:Experience.md` in the Contrejour source checkout and commit new or updated ones to its local `experience` branch, creating it from `main` if missing (paths recorded in this file); follow [the experience contract](.claude/skills/shared-references/experience.md).
- Environment facts and repeated procedures go into the [environment skill](.claude/skills/{{PROJECT_SLUG}}-environment/SKILL.md), never into the wiki.

### Iteration (follow every step, in order)

1. **Read**: first run `node .contrejour/dist/tools/setup-cli.js fetch-task --project .`; if it reports `changed: true`, the validator changed the task, so read `task.md` again and check the open problems against it. Then read the query pack, the relevant wiki pages, the latest feedback and the applicable lessons in `Experience.md`.
2. **Choose** one or more open problems (a `[regressed]` one first). When the wiki does not cover them, survey existing work with WebSearch/WebFetch (or a literature skill, if installed) and record each work with `ingest_survey --arxiv-id` or `--url`.
3. **Ideate** with five subagents started together (the Agent tool in Claude Code, subagents in Codex), one idea each, so the wiki's past directions do not trap every iteration in the same few ideas. Each gets `task.md`, the chosen problems' statements and only the knowledge its slot allows, and writes nothing to the wiki:
   - three `informed`: the query pack, the wiki pages, the latest feedback and the applicable lessons;
   - one `failures-only`: just the ineffective ideas and what each tried, to avoid them without following the rest of the wiki;
   - one `blank`: nothing else; it reads no wiki, feedback, lessons or past ideas and reasons from the task alone.

   Each returns a title, the approach, the problems it targets, why it should work and its risks. Drop any that repeats an ineffective idea. Assess the rest yourself with the whole wiki: `potential` (0–1, how much of its problems it fixes if it works) and `feasibility` (0–1, the chance it can be built and works with the submissions and compute left). Record each as a pending idea with `upsert_idea --target-problems … --potential … --feasibility … --variant-of <earlier ideas in the same direction> --tags ideation:<slot>`, and any work it relies on as a survey.
4. **Rank** with `rank_ideas research-wiki/` and implement the top idea first. Its score is potential × feasibility plus an exploration bonus that shrinks as more ideas in its direction are tested, so a direction tried many times gives way to a new one. Ideas not chosen stay pending and are ranked again with the next five; update a pending idea's scores with `--update-on-exist` when new evidence changes them.
5. **Plan** the iteration in the todo list.
6. **Run** experiments through the environment skill's scripts. Several may run at once, each under its own name. Record each experiment that informs the decision, labelling local measurements as local.
7. **Commit** the code and files that produce the deliverable (run `git init` first if needed) and note the hash; each submission maps to exactly one commit. Keep `.git/` out of the zip.
8. **Submit** once the zip and `USAGE.md` meet everything `requirements` lists, with the commit hash as `note`: `submit` returns a one-time upload URL; upload with `curl.exe --fail-with-body -T deliverable.zip "<upload_url>"` (plain `curl` outside Windows), then poll `query` until the submission's status is final; when its `service.task_sha256` differs from the `sha256` `fetch-task` last reported, run `fetch-task` again and read the changed task. `tested`, `rejected_cheating` and `unusable` carry a verdict. `invalid`, `expired` and `failed` do not count: read `reason`, fix it and submit again.
9. **Record** the verdict as an experiment with the test counts copied from `query` and the commit hash, mark the idea effective or ineffective, and link which problems it solved or left in place. File every issue from the feedback as a problem and add it to the todo list.
10. **Save experience**: commit new or updated lessons to `Experience.md` on the local `experience` branch, creating it from `main` if missing, per the contract (the owner reviews them by pull request), or state that no new lesson qualified.
11. **Continue** with step 1 until `query` reports `closed` (no submissions left); passing every current test does not end the task. While reviews are still running with no submissions remaining, keep polling.

### Rules

- A deliverable is one zip whose root, or single top-level folder, holds `USAGE.md`: what it is, how to install it and how to call it on one input. Validation writes its own adapter from that document and runs its own hidden, growing benchmark; it never runs your evaluation code. Call `requirements` before the first submission and after any `invalid` or `unusable` one: it lists the zip checks and limits, what `USAGE.md` must state, how validation calls the deliverable, the machine it runs on and the review time limit. Build the deliverable to those terms from the start.
- Submissions are limited. A malformed zip or a missing `USAGE.md` is rejected and not counted. A cheating verdict voids every test result: reading the benchmark's data, hard-coding answers, special-casing the problems named in feedback instead of fixing them, or behaving differently under evaluation.
- Feedback describes the real problems: what goes wrong, which requirement it breaks, how often and how badly. It never contains the tests; do not try to recover them. Fix each problem in general, because new tests around it will follow.
- Never edit `task.md` or copy it by hand; `fetch-task` keeps it identical to the validator's. A helper error from it stops the step: report it to the owner.
- Test counts come from `query`, never from your own measurements.
- Read a skill before using its tools: [browser-act](.claude/skills/browser-act/SKILL.md) for rendered pages, [environment-skill.md](.claude/skills/shared-references/environment-skill.md) for extending the environment skill. After skills change, tell the owner to run `reload-skills` (Claude Code) or open a fresh session (Codex).
