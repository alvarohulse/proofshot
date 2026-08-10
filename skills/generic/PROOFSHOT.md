# ProofShot Visual Verification

ProofShot is an open-source, agent-agnostic CLI that lets any AI coding agent verify its own work in a real browser — no vendor lock-in required.

After building or modifying UI features, verify with this workflow:

1. Start: `proofshot start --run "your-dev-command" --port PORT --description "what you are verifying"`
   Always use --run so proofshot captures server logs. Only omit --run if the server was started by the user.
   If the port is in use, ProofShot leaves that unowned listener alone; choose another port or stop it explicitly. Add --force only if a stale ProofShot session blocks startup.
   For configured multi-service projects, let `environment` launch its tmux panes or processes instead of starting duplicate services. Run `proofshot doctor` for dependency or recovery diagnostics.
2. Test: Use `proofshot exec` to navigate, click, fill forms, take screenshots
   Record an explicit assertion such as `proofshot exec assert-visible "#expected-result"` before screenshots.
3. Stop: `proofshot stop` — bundles canonical evidence, video, screenshots, and a structured verdict. `FAIL`, `INCOMPLETE`, and `BLOCKED` are unsuccessful.
   After an interrupted cleanup, use `proofshot session list` and `proofshot session clean --session ID`; never kill by port or process name.
4. Publish only finalized matching evidence: `proofshot pr 42 --session SESSION_ID --screenshot ARTIFACT_ID`. Repeat either flag for multiple explicit selections.

Key proofshot exec commands:
- `proofshot exec snapshot -i` — see interactive elements
- `proofshot exec click @e3` — click an element
- `proofshot exec fill @e2 "text"` — fill a form field
- `proofshot exec screenshot step.png` — capture a moment

Artifacts saved to ./proofshot-artifacts/ including video, screenshots, errors, and summary.
