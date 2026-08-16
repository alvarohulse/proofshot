# ProofShot visual verification

Explore UI behavior with the approved local agent-browser launcher, maintain User Stories/Use Cases/User Flows and iteration feedback under the task's persistent `~/data` directory, then record one fresh ProofShot session per finalized Use Case.

```bash
proofshot start --run "your-dev-command" --port PORT --description "UC-ID: behavior"
proofshot exec snapshot -i
proofshot exec click @e3
proofshot exec assert-visible "#expected-result"
proofshot exec screenshot step-result.png
proofshot stop
```

With multiple sessions, pass the printed ID to `proofshot exec --session ID ...` and `proofshot stop --session ID`. Prefer pointer/keyboard actions, disclose hybrid input, and treat synthetic DOM mutation as diagnostic only. `FAIL`, `INCOMPLETE`, and `BLOCKED` are unsuccessful.

Keep raw JSON, HAR, response bodies, credentials, and customer data private under the task's `~/data` evidence root. Report the local path without copying raw artifacts into prompts, scratch, PRs, or uploads. Copy only exercised final flows into PR User Testing instructions, then dry-run ordered explicit publication with repeated `--session` flags.

Browser tooling requires agent-browser 0.34.0 through its Node 24 launcher; project commands continue to honor the repository runtime. Recover with `proofshot session list` and `proofshot session clean --session ID`, never broad process cleanup.
