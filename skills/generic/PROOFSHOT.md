# ProofShot visual verification

1. Explore with the approved local agent-browser launcher before recording. Keep project commands on the repository runtime and browser tooling on its separate Node 24/agent-browser 0.34+ launcher.
2. Maintain a brief under the task's persistent `~/data` directory: User Stories; stable Use Cases with preconditions, starting state, test data, and success criteria; user-level User Flows; Iteration Feedback; and final User Testing instructions.
3. Exercise and simplify every flow. Prefer pointer/keyboard actions, disclose hybrid fill/select/checkbox behavior, and use synthetic DOM mutation only for diagnosis.
4. Record one fresh ProofShot session per finalized Use Case. Include an assertion and screenshot. With multiple sessions, use `proofshot exec --session ID ...` and `proofshot stop --session ID`.
5. Treat `FAIL`, `INCOMPLETE`, and `BLOCKED` as unsuccessful. Record the session ID and local evidence pointer. Keep raw JSON/HAR/bodies/credentials/customer data local under `~/data` and out of prompts, scratch, PRs, and uploads.
6. Copy only exercised flows into PR User Testing instructions and dry-run explicit ordered publication with curated screenshots.

Recover with `proofshot session list` and `proofshot session clean --session ID`; never kill by process name or port. `--force` refuses live sessions and operations.
