# Contrejour

**Agent-driven research with independent benchmark validation.**

[中文](README.zh-CN.md) · [Quick start](#quick-start) · [Setup guide](SETUP_GUIDE.md) · [Architecture](ARCHITECTURE_GUIDE.md)

Give an agent a task, a benchmark and a submission budget. Contrejour lets a worker agent develop a solution, submit it for independent, adversarial testing by validator agents and improve it using measured test results and leak-reviewed feedback.

Contrejour is designed for benchmark-driven coding, model evaluation and experimental research. The worker chooses how to plan and implement the task. A separate validator machine owns the hidden, append-only benchmark and tests each submission with a pass rule frozen at setup.

Use the official **Paseo** app and CLI to run and monitor agents on both machines. Contrejour installs its own skills and helpers into your projects as a standalone package.

## Features

### Independent, measured validation

- **Two machines, two projects.** The worker builds the deliverable; the validator machine owns the hidden benchmark. They interact only through four MCP tools, `task`, `requirements`, `submit` and `query`, with no shared directory. `task` hands the worker the validator's own `task.md`, byte for byte, so both sides work to the same text, and an edit on the validator reaches the worker at its next fetch. `requirements` gives the worker the deliverable's terms up front (zip checks and limits, what `USAGE.md` must state, the calling interface and the runtime environment), so submissions are not rejected or judged unusable for format or environment reasons.
- **Append-only benchmark.** The base benchmark's code, data revision, split, sample count, evaluation settings and per-sample pass rule are pinned at setup. Validator agents add layers of tests (`inc-001`, …), each test derived from existing tests, never invented from nothing. Added layers live in a git repository the helper alone commits to, and every commit may only add files, which the helper checks commit by commit; a wrong layer is retired, not edited. Any change to a pinned file or to that history stops the service.
- **Measured test results.** Each benchmark sample is one test, passed or failed by the frozen pass rule (`metric`, `op`, `threshold`) applied to complete per-sample runner output. Results report how many tests passed out of how many; there is no score, and results of different submissions are not compared. The worker never reports its own results.
- **Adversarial review.** A validator agent inspects each artifact, writes its own adapter from `USAGE.md`, reruns every benchmark layer and hunts for as many real problems within `task.md` as it can, using any tool or researched testing method. It judges the submission `valid`, `cheating` or `unusable`; a cheating verdict voids every test result.
- **Leak-reviewed feedback.** Feedback states the real problems: what goes wrong, which requirement of `task.md` it breaks, roughly how often, how severe, and which earlier problems were solved or persist. It never reveals the tests. A separate, independent agent checks it against the hidden tests before publication; if it still leaks after the allowed rewrites, only the verdict and test counts are published.
- **Defined stopping.** The task closes only when the counted submissions are used up; passing every current test does not end it. Upload, format and infrastructure failures do not count against the budget.

### Agent backends

Either role runs on either backend, chosen with the installer's `--provider claude|codex`. Without it the worker gets Claude Code and the validator Codex.

| Backend | Agent | Skills | Instructions | Worker MCP config |
| --- | --- | --- | --- | --- |
| `claude` | Claude Code | `.claude/skills/` | `CLAUDE.md` | `.mcp.json` |
| `codex` | Codex | `.agents/skills/` | `AGENTS.md` | `.codex/config.toml` |

| Role | Paseo thinking on Claude Code | on Codex |
| --- | --- | --- |
| worker | `ultracode` | `ultra` |
| validator | `max` | `max` |

The worker runs the level that may delegate to subagents; the validator the deepest single-agent level. Every review agent the validation service starts, and every feedback leak-review agent, runs on the validator project's backend at `max`. The backend stays with the project; install into a fresh project to change it.

### Strict iteration with memory

- **Numbered iteration flow.** The worker's role instructions require every step in order: read memory → choose problems → five subagents propose one idea each (three with the wiki, one knowing only the ineffective ideas, one with no prior knowledge) → the worker scores each idea's potential and feasibility and ranks the pool with UCB (`rank_ideas`), implementing the top idea first → plan in the todo list → run experiments → commit → submit → record the verdict and test counts → save lessons. Each submission maps to exactly one Git commit.
- **Long-term memory is mandatory.** The `research-wiki` records, for one or more problems, what existing work did (surveys from arXiv, Semantic Scholar, OpenAlex, Exa and others), which ideas and experiments were tried, and which were effective or ineffective. Typed evidence edges link them (`supports`, `invalidates`, `solves`, `reproduces`, …).
- **Compact query pack.** Each iteration starts from a deterministic summary of at most 1000 characters, with one line per open problem marking effective (✔) and ineffective (✘) attempts by node id. Details stay in the node pages.
- **Validation memory.** The validator machine keeps its own wiki of verification problems, recording which ones each submission solved and which persist. Reviews check them again and report both.
- **Short-term tasks in the todo list.** Iteration steps and every issue from feedback are tracked as todos and closed only when fixed in the committed deliverable.
- **Cross-project experience.** After each published verdict, the worker commits concise, evidenced lessons to `Experience.md` on the Contrejour source checkout's `experience` branch; you review them in a pull request into `main` before other projects use them.

### Environment skill

Setup writes a project skill, `<project>-environment`, on the real machine:

- **Facts only.** Environment facts an agent cannot know: hosts, paths, environment names, resources, where metrics land and verified quirks. General tool knowledge is left out.
- **Verified scripts.** Fixed procedures such as syncing code, launching a named run, checking it, fetching results and stopping it. Each run has its own name, log and result path, so several experiments can run at once.
- **Secrets apart.** Keys and tokens live only in `.contrejour/environment.json` (mode 0600, kept out of Git).

New environment facts or repeated procedures found later are added to the same skill.

### Local, ownership-aware installation

The installer copies compiled helpers, four core skills (the role's setup skill, `worker-setup` or `validator-setup`, plus `validation-review`, `research-wiki` and `browser-act`) and runtime dependencies from your prepared local Git checkout, without downloads. Updates replace only files Contrejour owns and preserve tasks, wikis, benchmarks, submissions, generated environment skills and unrelated configuration.

## How it works

1. **Define the task.** Write `task.md` on the validator machine; the worker's setup fetches it from the validation service. Configure the validation benchmark, per-sample pass rule and submission budget, then review and freeze the configuration.
2. **Build a solution.** The worker plans, codes and experiments in its own environment, without access to the validator machine's hidden data.
3. **Submit an artifact.** The worker commits the solution to Git, calls `submit`, receives a temporary single-use upload URL and uploads a zip containing the solution and `USAGE.md`.
4. **Evaluate independently.** The service starts a validator agent through official Paseo. The agent reviews the artifact, reruns every benchmark layer, adds derived tests where it finds more problems and writes feedback, which an independent leak-review agent checks before publication.
5. **Improve or finish.** The worker calls `query` for status, verdict, test counts and published feedback. It turns the feedback into todo items, fixes them and continues until the task reaches `closed` (no submissions left).

Keep the two projects on separate machines without a shared or synchronized directory. That separation keeps the hidden benchmark outside the worker's environment. See the [architecture guide](ARCHITECTURE_GUIDE.md) for evaluation and feedback boundaries.

## Quick start

### Prerequisites

On each machine, install:

- **Node.js 22.12+**, **Bash** and **Git**.
- The chosen backend, **Claude Code** or **Codex**, authenticated on each machine.
- The official **Paseo app and CLI**, with its daemon running.

The validator machine also needs your benchmark's dependencies. On Windows, run the installer in Git Bash with Node.js on `PATH`; see the [setup guide](SETUP_GUIDE.md) for Windows command paths and networking.

### Install into each project

Use a local checkout of `main` on each machine. Prepare its dependencies and compiled helpers explicitly:

```bash
cd /path/to/local/contrejour-checkout
npm ci
npm run build
```

On the **worker** machine:

```bash
bash distribution/install-contrejour.sh --role worker --project /path/to/project [--provider claude|codex]
```

On the **validator** machine:

```bash
bash distribution/install-contrejour.sh --role validator --project /path/to/project [--provider claude|codex]
```

The role and backend stay with the project. Installation reads only the prepared local checkout and makes no downloads; missing dependencies or compiled helpers cause an error. Codex must trust each project it runs in.

### Configure the two roles

Add both projects to official Paseo. Setup reads the role from the installation.

| Step | Agent in Paseo | Invoke |
| --- | --- | --- |
| Set up the validator project first | its backend at thinking `max` | `/validator-setup` (Claude Code) or `$validator-setup` (Codex) |
| Set up the worker project | its backend at thinking `ultracode` (Claude Code) or `ultra` (Codex) | `/worker-setup` or `$worker-setup` |

On the validator machine, review the setup sheet, approve its configuration and start the generated `contrejour` service. If the validator machine already provides the service's address and token as `CONTREJOUR_URL` and `CONTREJOUR_TOKEN`, setup uses them instead of asking for an address and creating a token. Transfer the worker connection URL and token privately to the worker machine and configure the worker connection; the worker's setup then fetches `task.md` through it. On each machine setup then writes the project environment skill and verifies its scripts. Run `reload-skills` in Claude Code, or open a fresh Codex session, to load the skills, reopen the worker session for its MCP configuration and ask it to work on `task.md`.

Follow the **[full setup guide](SETUP_GUIDE.md)** or **[中文部署指南](SETUP_GUIDE_CN.md)** for benchmark setup, networking, offline installation, updates and troubleshooting.

## Included skills

The standalone package ships four core skills:

| Skill | Purpose |
| --- | --- |
| [`worker-setup`](skills/worker-setup/SKILL.md) | Worker projects only: connect to the validation service, fetch `task.md`, confirm the configuration, then write and verify the project environment skill. |
| [`validator-setup`](skills/validator-setup/SKILL.md) | Validator projects only: write `task.md`, freeze the benchmark and terms, register the validation service, then write and verify the project environment skill. |
| [`validation-review`](skills/validation-review/SKILL.md) | Review a submission as the worker's adversary: rerun and extend the benchmark, then publish a verdict, test counts and leak-reviewed feedback. |
| [`research-wiki`](skills/research-wiki/SKILL.md) | Maintain and query the role's long-term memory. |
| [`browser-act`](skills/browser-act/SKILL.md) | Access rendered pages and browser sessions through the external browser-act CLI. |

Setup also writes `<project>-environment`, the project environment skill. Browser runtimes and experiment host dependencies are installed separately when needed. Update or repair Contrejour by rerunning the installer for the same role and project; see the [setup guide](SETUP_GUIDE.md#update-or-repair).

Optional literature, GPU platform and notification integrations are available in the source repository; they are not included in the standalone archive.

## Documentation

| Guide | Use it for |
| --- | --- |
| [Setup guide](SETUP_GUIDE.md) / [中文部署指南](SETUP_GUIDE_CN.md) | Deploying the two machines and operating your installation. |
| [Architecture](ARCHITECTURE_GUIDE.md) | Understanding task state, benchmark integrity, pass rules and validation boundaries. |
| [Agent guide](AGENT_GUIDE.md) | Choosing skills and finding project records. |
| [Contributing](CONTRIBUTING.md) | Developing Contrejour and running focused checks. |
| [Packaging](docs/packaging.md) | Building the archive and understanding installation ownership. |

## License

[MIT](LICENSE). Original ARIS copyright and attribution are retained.
