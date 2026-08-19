---
name: proofshot
description: Visual verification of UI features. Explore and refine real user flows with agent-browser, then replay each stabilized use case in a fresh isolated ProofShot session and retain local evidence.
allowed-tools: Bash(proofshot:*), Bash(agent-browser:*)
---

# ProofShot visual verification

Use this workflow after a UI or visual behavior changes.

## 1. Explore and write the brief

Use the approved local `agent-browser` launcher before recording. Keep project commands on the repository runtime; browser tooling uses its separate Node 24 launcher and agent-browser 0.34.0.

Maintain one Markdown brief in the task's persistent `~/data` directory. Define User Stories (actor, goal, benefit), stable Use Cases (preconditions, starting state, test data, success criteria), user-level User Flows, Iteration Feedback, and final User Testing instructions.

## 2. Refine every flow

Exercise each flow repeatedly until it is correct, stable, and concise. Prefer pointer/keyboard-backed actions and disclose hybrid fill/select/checkbox behavior. `eval`, direct DOM clicks, setters, and dispatched events are diagnostics only and cannot be final proof.

## 3. Record one fresh session per Use Case

```bash
proofshot replay ./proofshot.UC-ID.json
```

The version 1 case uses stable selectors—not exploratory `@eN` references—and contains ordered command arrays, an `assert-visible` step, a screenshot, and high-level `humanTesting` instructions. ProofShot creates one exact fresh session, attempts exact cleanup after failure, writes `USER_TESTING.md`, and succeeds only on canonical `PASS`. Record the final session ID and local evidence pointer in the brief.

When the approved plan chooses an executable E2E instead, hand the stabilized scenario to the target repository's E2E workflow and flake proof. ProofShot is not the product-behavior authority.

## 4. Inspect and retain

`FAIL`, `INCOMPLETE`, and `BLOCKED` are unsuccessful. Keep raw JSON, HAR, response bodies, credentials, and customer data private under the task's `~/data` evidence root. Report paths without copying raw artifacts into prompts, scratch, PRs, or uploads.

Recover interrupted cleanup with `proofshot session list` and `proofshot session clean --session ID`; never kill by process name or port. `--force` only recovers proven stale state.

## 5. Publish curated proof

Publish the replay-generated User Testing instructions with the exercised final flow. Dry-run explicit ordered publication, repeating `--session` in review order:

```bash
proofshot pr 42 --session SESSION_ID --screenshot step-result.png --dry-run
```

Publish only curated media, sanitized summaries, and interaction disclosure.
