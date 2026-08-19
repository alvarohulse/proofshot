---
name: proofshot
description: Visual verification of UI features. Explore and refine real user flows with agent-browser, then replay each stabilized use case in a fresh isolated ProofShot session and retain local evidence.
---

# ProofShot visual verification

Use this workflow after a UI or visual behavior changes.

## 1. Explore

Use the approved local `agent-browser` launcher to understand the feature before recording proof. Keep the project on its repository runtime; browser tooling uses its separate Node 24 launcher and agent-browser 0.34.0.

Maintain one Markdown brief in the task's persistent `~/data` directory:

- **User Story**: actor, goal, and benefit.
- **Use Case**: one reviewable behavior with a stable ID, preconditions, starting state, test-data references, and success criteria.
- **User Flow**: ordered user-level actions and observable outcomes. Exclude shell commands and ephemeral element refs.
- **Iteration Feedback**: what was wrong, brittle, redundant, or slow and what the next revision changes.
- **User Testing instructions**: the concise final flow copied to the PR after it was exercised.

## 2. Refine every flow

Exercise each User Flow with `agent-browser`. Append feedback and revise until the flow is correct, stable, and concise. Exploration can use repeated passes.

- Prefer pointer/keyboard-backed interactions.
- Disclose hybrid operations such as fill, select, and checkbox actions.
- Treat `eval`, direct DOM `.click()`, setters, and dispatched events as diagnostics only. A synthetic DOM action cannot be final behavioral proof.

## 3. Record fresh proof

For each finalized Use Case, write a version 1 replay case with stable selectors, ordered agent-browser command arrays, an `assert-visible` step, a screenshot, and high-level `humanTesting` instructions. Ephemeral `@eN` references are exploration-only. Then run:

```bash
proofshot replay ./proofshot.UC-ID.json
```

ProofShot creates one fresh exact session, attempts exact cleanup after failure, writes `USER_TESTING.md`, and requires a canonical `PASS`. Record one short session per Use Case.

Completion requires an explicit assertion, a fresh-session replay, and a retained session ID/evidence pointer in the brief.

If the approved plan chooses executable E2E coverage instead, hand the stabilized scenario to the target repository's E2E workflow and its repeated flake proof. ProofShot does not own product expectations or E2E policy.

## 4. Inspect and retain

Treat `FAIL`, `INCOMPLETE`, and `BLOCKED` as unsuccessful verification. Raw agent-browser JSON, HAR, response bodies, credentials, and customer data remain private under the task's `~/data` evidence root. Report the local path; do not copy raw evidence into prompts, scratch, PRs, or uploads.

If cleanup is interrupted, use `proofshot session list` and `proofshot session clean --session ID`. Never clean by process name or port. `--force` recovers proven stale state only and refuses a verified live session or operation.

## 5. Publish curated proof

Publish only replay-generated User Testing instructions, exercised final flows, and curated screenshots:

```bash
proofshot pr 42 --session SESSION_ID --screenshot step-result.png --dry-run
```

Repeat `--session` in review order. Publish only curated media, sanitized summaries, and interaction disclosure; keep raw private evidence local.
