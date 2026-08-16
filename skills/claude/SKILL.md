---
name: proofshot
description: Visual verification of UI features. Explore and refine real user flows with agent-browser, then record one fresh isolated ProofShot session per reviewable use case and retain local evidence.
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
proofshot start --run "your-dev-command" --port PORT --description "UC-ID: behavior"
proofshot exec snapshot -i
proofshot exec click @e3
proofshot exec assert-visible "#expected-result"
proofshot exec screenshot step-result.png
proofshot stop
```

Omit `--run` only for an explicitly external server. With multiple sessions, use the printed ID in `proofshot exec --session ID ...` and `proofshot stop --session ID`. Record the final session ID and local evidence pointer in the brief.

## 4. Inspect and retain

`FAIL`, `INCOMPLETE`, and `BLOCKED` are unsuccessful. Keep raw JSON, HAR, response bodies, credentials, and customer data private under the task's `~/data` evidence root. Report paths without copying raw artifacts into prompts, scratch, PRs, or uploads.

Recover interrupted cleanup with `proofshot session list` and `proofshot session clean --session ID`; never kill by process name or port. `--force` only recovers proven stale state.

## 5. Publish curated proof

Copy the exercised final flows into PR User Testing instructions. Dry-run explicit ordered publication, repeating `--session` in review order:

```bash
proofshot pr 42 --session SESSION_ID --screenshot step-result.png --dry-run
```

Publish only curated media, sanitized summaries, and interaction disclosure.
