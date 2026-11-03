---
name: contribution-check
description: The validator's check of exactly what would leave, before library-contribution or upstream-optimization sends it — a leak review against the hidden tests, from a fresh context. It takes the framework's contribution-check's place in validator projects.
side: validator
kind: on-request
triggers: record-trajectory, guard-owner-answers
check-args: [{"digest": "0000000000000000000000000000000000000000000000000000000000000000", "files": [".contrejour/contributions/preview/after/agent-loop-community/library/roles/validator/example.md"]}]
---

# Contribution check (validator)

## Purpose

Validator roles may describe how tests are constructed but must never contain an actual test. So before anything leaves this project, shared with the community library or sent back where it came from, `leak-reviewer` checks exactly the files that would leave against the hidden tests, from a fresh context, and records its verdict on the plan's digest; the plan leaves only with a pass. The framework's `library-contribution` and `upstream-optimization` run this loop as their own-check step whenever the plan says this project's check is required.

## Inputs

- `digest`: the digest of the plan whose files are checked.
- `files`: the paths of exactly the files that would leave.

## Steps

1. **Leak check** — `leak-reviewer` checks exactly these files against the hidden tests and records its verdict on the digest (`{action: "check-library", digest, files}`); the loop ends with `{verdict, findings}`, `verdict` being `pass`, or `fail` when it found a leak.

## Bounds

One check per plan.

## Waiting

It does not wait for the owner: the owner sees the verdict and its findings in the plan's review.

## Triggers

- `record-trajectory`: every role that finishes leaves its trajectory.
- `guard-owner-answers`: every answer the session passes in is the owner's own message, typed after the loop stopped at that review; anything else is blocked before the loop runs.
