# Architecture

How ProofShot works under the hood, and why it's built the way it is.

## Overview

```
┌──────────────┐     shell commands      ┌───────────────┐     CLI calls     ┌──────────────────┐
│  AI Coding   │ ──────────────────────► │   ProofShot   │ ───────────────► │  agent-browser   │
│    Agent     │                         │     CLI       │                   │  (Rust + Node)   │
│              │  "proofshot start"       │               │  "ab open ..."   │                  │
│  Claude Code │  "proofshot exec ..."   │  session mgmt │  "ab click ..."  │  Chromium daemon │
│  Cursor      │  "proofshot stop"       │  video trim   │  "ab screenshot" │  video recording │
│  Codex       │                         │  error detect  │                  │  element refs    │
│  OpenCode    │                         │  artifact gen  │                  │                  │
│  Gemini CLI  │                         │  artifact gen  │                  │                  │
│  Windsurf    │                         │               │                   │                  │
└──────────────┘                         └───────────────┘                   └──────────────────┘
```

ProofShot is a thin orchestration layer between AI coding agents and a browser. The agent calls ProofShot CLI commands via shell. ProofShot manages session state, logging, and artifact generation, delegating all browser work to [agent-browser](https://github.com/vercel-labs/agent-browser).

## Why agent-browser?

The choice of agent-browser as the browser automation layer is the most important architectural decision in ProofShot.

**Agent-agnostic by design.** agent-browser exposes a CLI interface (`agent-browser open`, `agent-browser click @e3`). Any AI agent that can run shell commands can drive it. This is what makes ProofShot work with Claude Code, Cursor, Codex, OpenCode, Gemini CLI, and Windsurf without custom integrations for each.

**Persistent daemon.** agent-browser runs a Node.js daemon that maintains browser state across CLI calls. This means `proofshot exec click @e3` and the next `proofshot exec screenshot step.png` operate on the same browser tab and page state. Without this, each command would need to reconnect to the browser.

**Stable element references.** The `@eN` ref system (`@e1`, `@e2`, etc.) provides stable handles to interactive elements. An agent takes a snapshot, sees `@e3: Submit button`, and can target it reliably. This is far more robust than CSS selectors or XPath for AI-driven interaction.

**Lightweight context.** agent-browser's snapshot output is ~93% smaller than Playwright MCP's equivalent. This matters because AI agents have context limits — smaller snapshots mean more room for reasoning.

**Built-in recording.** Playwright's screencast API is exposed directly, so video capture works without ffmpeg. Finalization uses ffmpeg to trim the WebM capture and convert it to H.264 MP4.

All browser commands pass through one wrapper that injects the exact session, private config, namespace, socket root, allowlist, and a cleaned environment:

```typescript
// src/utils/exec.ts
export function ab(command: string, options: AgentBrowserCommandOptions): string {
  return execSync(buildAgentBrowserCommand(command, options), {
    env: getAgentBrowserEnvironment(options),
    timeout: options.timeoutMs ?? 30000,
  }).trim();
}
```

## Session lifecycle

ProofShot uses a three-phase model: **start**, **exec** (repeated), **stop**.

### Start

```
proofshot start --run "npm run dev" --port 3000 --description "Login flow"
```

1. Verify agent-browser 0.34.0, reject inherited provider/CDP/profile/state modes, and copy a safe config into private per-session state
2. Create a collision-safe session ID, namespace, socket root, domain allowlist, evidence directory, and immutable start-operation lease
3. Spawn an exact-owned dev server/environment when configured and persist process identities before waiting for readiness
4. Open fresh local Chromium and persist the daemon identity
5. Start private HAR capture and video recording
6. Register the session under the user state directory and write durable Git metadata beside its evidence

Recording is mandatory. If it fails after 3 retries, the session aborts. Video proof is the whole point.

### Exec

```
proofshot exec click @e3
proofshot exec screenshot step-login.png
```

Each `exec` call:

1. Selects the single addressable recording or requires `--session <id>` when several live sessions match
2. Claims an immutable exec-operation lease
3. Captures pre-action page context plus element bounds/label when available
4. Appends sanitized intent, interaction category, timing, outcome, and page context to `session-log.json`; raw structured output stays private
5. Forwards the command to the exact agent-browser namespace and releases the lease

The element data capture uses a multi-strategy approach because agent-browser's `get box` command doesn't accept refs directly:
- Try to get the element's `id` attribute, then query by `#id`
- Fall back to getting the element's text content, then query by `text=<label>`
- If both fail, skip element data (overlays won't render for this action, but it's non-critical)

### Stop

```
proofshot stop
```

1. Claim a stop-operation lease and collect console evidence
2. Flush HAR capture to a private pending file, validate it, atomically adopt it, and write a metadata-only network summary
3. Stop video and close only exact owned browser/environment/server processes
4. **Finalize video** — trim dead time, convert to H.264 `session.mp4`, and adjust action timestamps
5. Generate canonical evidence, verdict, summary, viewer, and provenance manifest
6. Unregister completed ownership, or retain the exact browser record after `--no-close`

## Interactive viewer

The viewer (`viewer.html`) is a self-contained HTML file that serves as the primary proof artifact. It has no external dependencies — you can open it in any browser or attach it to a PR.

```
┌─────────────────────────────────────────────┐
│  Header: description, error badges          │
├────────────────────────┬────────────────────┤
│                        │                    │
│  Video (62%)           │  Timeline (38%)    │
│                        │                    │
│  Custom scrub bar      │  Action steps      │
│  with action markers   │  with timestamps   │
│                        │                    │
│  Overlay layer:        │  Click to seek     │
│  - Click ripples       │  Arrow key nav     │
│  - Scroll indicators   │                    │
│  - Action toasts       │                    │
│                        │                    │
└────────────────────────┴────────────────────┘
```

Key features:

- **Scrub bar markers** — each action gets a marker on the progress bar, positioned at its timestamp. Click a marker to jump to that moment.
- **Action overlays** — click ripples, scroll indicators, and action label toasts rendered on a transparent layer over the video, synced via `requestAnimationFrame`. Coordinates are scaled from the original viewport size to the current video display size.
- **Timeline sync** — clicking a step in the timeline seeks the video. Playing the video highlights the current step and auto-scrolls it into view.
- **Error badges** — top-right corner shows console and server error counts (green = clean, red = N errors).

## Skill installation

`proofshot install` detects AI tools on the machine and installs a skill file that teaches the agent the ProofShot workflow.

Two installation strategies:

| Strategy | Used by | How it works |
|----------|---------|-------------|
| **File** | Claude Code, Cursor, Codex, OpenCode | Writes a standalone skill file to the tool's config directory |
| **Append** | Gemini CLI, Windsurf | Appends to an existing config file using `<!-- proofshot:start -->` / `<!-- proofshot:end -->` markers for clean updates |

All installations are at **user level** (home directory), not per-project. This means one `proofshot install` works across every project on the machine.

Detection checks both binary availability (`which <tool>`) and config directory existence, so it finds tools even if they're not on PATH.

## Error detection

`src/utils/error-patterns.ts` scans server logs with regex patterns for 10+ languages:

- **JavaScript / Node.js** — `Error:`, `ERR_`, unhandled rejections, stack traces
- **Python** — `Traceback`, `File:line`, exception classes
- **Ruby / Rails** — `ActionController` errors, `FATAL--` prefix
- **Go** — `panic:`, goroutine stacks, `runtime error:`
- **Java / Kotlin** — `Exception in thread`, `Caused by:`, `at` stack frames
- **Rust** — `thread panicked`, `error[E***]` compiler errors
- **PHP** — `Parse error`, `Fatal error`, `Warning`
- **C# / .NET** — `Unhandled exception`, `:line N`
- **Elixir / Phoenix** — `** (EXIT)`, runtime errors
- **Generic** — `FATAL`, `CRITICAL`, `Segmentation fault`, `out of memory`

Adding support for a new language is one entry in the `PATTERNS` array.

## Project structure

```
src/
├── cli.ts                    # Commander.js command registration
├── commands/
│   ├── install.ts            # Tool detection + skill installation
│   ├── start.ts              # Session init: server, browser, recording
│   ├── stop.ts               # Cleanup: trim, errors, artifacts
│   ├── exec.ts               # Action logging + agent-browser passthrough
│   ├── diff.ts               # Visual regression (screenshot comparison)
│   ├── pr.ts                 # GitHub PR description formatting
│   └── clean.ts              # Artifact directory removal
├── browser/
│   ├── isolation.ts          # Version gate, clean config/env, local-runtime policy
│   ├── provenance.ts         # Interaction classification and secret-safe intent
│   ├── evidence.ts           # Private structured/HAR evidence + sanitized summary
│   ├── session.ts            # Browser open/close, console collection
│   ├── capture.ts            # Recording start/stop, screenshots, diffs
│   ├── navigate.ts           # URL navigation, snapshot
│   └── interact.ts           # Click, fill, type, scroll, press
├── server/
│   └── start.ts              # Dev server spawn + port waiting
├── session/
│   ├── registry.ts           # Global registry and per-session operation leases
│   ├── selection.ts          # Operation-specific implicit/explicit resolution
│   ├── lifecycle.ts          # Exact owned-process cleanup and recovery
│   └── state.ts              # Session identity and evidence/process state
├── artifacts/
│   ├── viewer.ts             # Interactive HTML viewer generation
│   ├── summary.ts            # Markdown summary generation
│   ├── pr-format.ts          # PR description formatting
│   └── bundle.ts             # Artifact bundling
└── utils/
    ├── config.ts             # Config file search + merge
    ├── exec.ts               # ab() and exec() shell wrappers
    ├── error-patterns.ts     # Multi-language regex patterns
    ├── port.ts               # isPortOpen, waitForPort
    └── skills.ts             # Skill file bundling
```

## Design decisions

**ESM-only with `.js` extensions.** All imports use explicit `.js` extensions (`import { ab } from '../utils/exec.js'`). This ensures files resolve correctly after TypeScript compilation without relying on module resolution heuristics.

**tsup with two entry points.** The CLI binary (`bin/proofshot.ts`) builds to a single file with a shebang. The library entry (`src/index.ts`) builds with code splitting and `.d.ts` generation. This supports both CLI usage and programmatic import by other tools.

**Pinned browser contract.** agent-browser 0.34.0 is an exact runtime dependency and requires Node 24. Managed installations use a dedicated launcher so project commands keep their repository runtime.

Finalized evidence records the managed launcher contract and the hashes of the launcher and executed native artifact. This receipt identifies the runtime used for the session; it does not attest how the package dependency was installed.

**Registry-backed session control.** User-state registry files point to per-run evidence while immutable IDs, namespaces, sockets, and operation leases allow concurrent sessions in the same worktree. `clean` refuses while any matching registry record remains.

**Private evidence boundary.** Raw agent-browser JSON, HAR, response bodies, credentials, and customer data remain in a `0700` private tree with `0600` files. Manifests and PR publication exclude that tree.

**Config file walk-up.** `proofshot.config.json` is searched from cwd upward to filesystem root, supporting monorepo layouts where config lives at the repo root.

**Fail closed at trust boundaries.** Wrong browser versions, shared/cloud browser modes, ownership mismatches, corrupt operation locks, synthetic final proof, and invalid private evidence cannot be presented as successful proof. Missing ffmpeg still preserves the original WebM.
