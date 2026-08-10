---
name: proofshot
description: Visually verifies UI changes with browser recordings, screenshots, console output, and named environment logs. Use after building or modifying user-facing features.
---

# ProofShot visual verification

Use ProofShot after changing UI behavior:

1. Start a session:
   `proofshot start --run "your-dev-command" --port PORT --description "what you are verifying"`
   Use `proofshot.config.json` environment and log sources instead of `--run` when verification needs multiple processes, tmux panes, or file tails.
2. Drive the browser with `proofshot exec`:
   - `proofshot exec snapshot -i`
   - `proofshot exec click @e3`
   - `proofshot exec fill @e2 "text"`
   - `proofshot exec screenshot step.png`
3. Stop and bundle evidence:
   `proofshot stop`

Take screenshots before and after important actions. Read the browser snapshot and captured logs to verify the expected behavior, then fix and repeat if evidence contains errors.
