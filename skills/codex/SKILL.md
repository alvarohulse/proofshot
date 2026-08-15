---
name: proofshot
description: Visual verification of UI features. Explore and refine real user flows with agent-browser, then record one fresh isolated ProofShot session per reviewable use case and retain local evidence.
---

# ProofShot visual verification

Use this workflow after a UI or visual behavior changes.

## 1. Explore

Use the approved local `agent-browser` launcher to understand the feature before recording proof. Keep the project on its repository runtime; browser tooling uses its separate Node 24 launcher and agent-browser 0.34.0 or newer.

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

For each finalized Use Case, start a fresh ProofShot session and rerun only its optimized flow:

```bash
proofshot start --run "your-dev-command" --port PORT --description "UC-ID: behavior"
proofshot exec snapshot -i
proofshot exec click @e3
proofshot exec assert-visible "#expected-result"
proofshot exec screenshot step-result.png
proofshot stop
```

Omit `--run` only when the server is explicitly owned elsewhere. Record one short session per Use Case. When several sessions match the worktree, pass the printed ID with `proofshot exec --session ID ...` and `proofshot stop --session ID`.

Completion requires an explicit assertion, a fresh-session replay, and a retained session ID/evidence pointer in the brief.

## 4. Inspect and retain

Treat `FAIL`, `INCOMPLETE`, and `BLOCKED` as unsuccessful verification. Raw agent-browser JSON, HAR, response bodies, credentials, and customer data remain private under the task's `~/data` evidence root. Report the local path; do not copy raw evidence into prompts, scratch, PRs, or uploads.

If cleanup is interrupted, use `proofshot session list` and `proofshot session clean --session ID`. Never clean by process name or port. `--force` recovers proven stale state only and refuses a verified live session or operation.

## 5. Publish curated proof

Copy only exercised final flows into PR User Testing instructions. Publish explicit ordered sessions and curated screenshots:

```bash
proofshot pr 42 --session SESSION_ID --screenshot step-result.png --dry-run
```

Repeat `--session` in review order. Publish only curated media, sanitized summaries, and interaction disclosure; keep raw private evidence local.
