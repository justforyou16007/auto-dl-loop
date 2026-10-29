# Contrejour Agent Guide

For agents reading this package cold. This file routes you to the right skill; the skill's `SKILL.md` is the specification and wins over anything here.

## What Contrejour is

Contrejour runs one task as a contest between two machines:

- The **worker** machine has one agent (Claude Code at Paseo thinking `ultracode`, or Codex at `ultra`) with `task.md`, its own environment and its own research wiki. It builds a deliverable and submits it.
- The **validator** machine runs the `contrejour` service. It owns an append-only benchmark the worker never sees and acts as the worker's adversary: it starts one validator agent per submission on the project's backend (Claude Code or Codex, thinking `max`), which looks for as many real problems as it can, adds tests derived from existing ones, and publishes a verdict, how many tests passed out of how many, and feedback on the problems found (never on the tests) after an independent leak review. Validation ends when the submissions run out.

The two sides share nothing but the service's four MCP tools: `task` (the validator's `task.md`, which the worker's setup copies byte for byte), `requirements` (the terms a deliverable must meet: zip checks, `USAGE.md` contents, calling interface, runtime environment, review time limit), `submit` and `query`. Each machine runs official Paseo, so the owner watches both sides' agents in the Paseo app. Everything else (planning, coding, training, debugging, delegating to subagents) is the agent's own work; Contrejour adds no workflow for it, except that each iteration's idea comes from five subagents with different access to the wiki and is chosen by a UCB ranking (`rank_ideas`), so past directions do not trap the search.

Your role and backend are fixed at installation; the role is written between the `CONTREJOUR ROLE` markers of `CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex). If there is none, the project is not set up: run the role's setup, `/worker-setup` or `/validator-setup` (Claude Code; `$worker-setup` or `$validator-setup` in Codex). A project has only its own role's setup skill. The role block is binding: long-term memory (the research wiki and the environment skill, plus `Experience.md` for the worker) is mandatory, short-term tasks go in the todo list, and its numbered steps are followed in order.

## Skills

| Skill | Role | Use it to |
| --- | --- | --- |
| `/worker-setup` | worker | Connect to the validation service, fetch `task.md`, confirm one editable review sheet, then write and verify the project environment skill |
| `/validator-setup` | validation | Write `task.md`, freeze the benchmark and terms through one editable review sheet, register the validation service, then write and verify the project environment skill |
| `/validation-review` | validation | Review one submission (the service starts an agent with it); its `leak-review.md` guides the independent feedback leak reviewer |
| `/research-wiki` | both | Keep long-term memory as `survey`, `idea`, `experiment`, `claim` and `problem` nodes linked by evidence edges: for each problem, what existing work did, what was tried and what was effective or ineffective. Start from the query pack (at most 1000 characters, with node references). The validation wiki records the problems each submission solved or left in place and the testing methods researched |
| `/browser-act` | worker | Read rendered pages and use browser sessions through the external CLI |
| `/<project>-environment` | both | Written by setup: environment facts an agent cannot know, plus verified scripts to sync code, launch named runs (several at once), check them, fetch logs and results and stop them |

Updates and repairs use the standalone installer with the same role and backend; see the [setup guide](SETUP_GUIDE.md#update-or-repair).

Other research skills remain in source but are not shipped in the standalone archive.

## Helpers

Skills call compiled helpers with `node .contrejour/dist/tools/<helper>.js` from the project root. Which skill uses which helper, and what to do when one fails, is in [integration-contract.md](skills/shared-references/integration-contract.md). Never write a helper's output by hand.

## Where things live

| Path | Owner | Contents |
| --- | --- | --- |
| `task.md` | owner on the validator; `setup-cli.js fetch-task` on the worker | The task; the worker's is a byte-for-byte copy of the validator's |
| `.contrejour/setup-*.json`, `.contrejour/setup-review.md` | `setup-cli.js` | Draft, review sheet and confirmed configuration |
| `.contrejour/tester-config.json` | `setup-cli.js` | Frozen base layer of the benchmark (validation) |
| `.contrejour/validation/` | `validation-cli.js` | Frozen terms, service token, benchmark layers added by reviews (an append-only git repository `benchmark/`, whose head is recorded in `benchmark-head`), submissions and published results (validation) |
| `.mcp.json` (Claude Code) or `.codex/config.toml` (Codex) | `setup-cli.js` | `contrejour` server URL and token (worker; keep it out of git) |
| `.contrejour/environment.json` | `setup-cli.js` | Keys and tokens the environment scripts read (mode 0600; keep it out of git) |
| `<skills>/<project>-environment/` | the role's agent, by [environment-skill.md](skills/shared-references/environment-skill.md) | Environment facts and verified scripts |
| `paseo.json` | `setup-cli.js` | `contrejour` service script (validation) |
| `research-wiki/` | `research-wiki.js` | Wiki pages, edges, the generated index and query pack |
| Local Contrejour source checkout: `Experience.md` (reviewed on `main`, new lessons committed to `experience`) | worker agent; the owner merges by pull request | Concise, evidenced lessons reusable across projects; location recorded in worker project instructions, rules in [the experience contract](skills/shared-references/experience.md) |

Architecture and design rationale: [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md). Installing both machines: [SETUP_GUIDE.md](SETUP_GUIDE.md).
