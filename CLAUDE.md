# ProofShot CLI

Visual verification tool for AI coding agents. Records browser sessions, captures screenshots, collects errors, and bundles proof artifacts.

## Quick reference

```bash
npm run build          # Build with tsup (must run after changes)
npm test               # Run vitest once
npm run dev            # Watch mode build
```

## Architecture

```
src/
├── cli.ts                  # Commander.js command registration
├── commands/               # One file per CLI command (install, start, stop, exec, diff, pr, clean)
├── browser/                # agent-browser CLI wrappers (session, capture, interact, navigate)
├── server/                 # Dev server detection, startup, port waiting
├── session/                # Global registry, per-session leases, selection, manifests
├── session/metadata.ts     # Persistent per-session metadata (branch, commit) for PR matching
├── artifacts/              # Output generation (viewer.html, SUMMARY.md, PR format)
└── utils/                  # Config, exec helpers, port utils, error patterns, GitHub API
```

**Entry point:** `bin/proofshot.ts` → `src/cli.ts` → `src/commands/*.ts`

## Key conventions

- **ESM only** — all imports MUST use `.js` extensions: `import { foo } from '../utils/config.js'`
- **Build before test** — CLI runs from `dist/`, always `npm run build` after code changes
- **agent-browser** — exact 0.34.0 runtime dependency. ProofShot preflights version/capabilities and uses a dedicated Node 24 launcher without changing the project's runtime
- **Session state** — registry files live under the user state directory; every session has an immutable ID, private browser namespace, evidence directory, and operation lease. `exec`/`stop` auto-select only one live match or require `--session`
- **Session metadata** — `start` writes `metadata.json` inside each session folder with git branch/commit. This persists after `stop` and is used by `pr` to match sessions to branches
- **Per-session subfolders** — artifacts go in `proofshot-artifacts/YYYY-MM-DD_HH-mm-ss_slug/`

## Command lifecycle

1. `proofshot start` — validates a local isolated browser, claims a start lease, opens a unique agent-browser namespace, starts recording/network capture, and writes metadata
2. `proofshot exec [--session ID] <args>` — claims an exec lease, logs sanitized provenance/private structured output, and forwards to the exact browser
3. `proofshot stop [--session ID]` — claims a stop lease, atomically finalizes private evidence, performs exact cleanup, and generates canonical artifacts
4. `proofshot pr [number]` — finds sessions for current branch, uploads artifacts to GitHub, posts PR comment

## Adding a new command

1. Create `src/commands/mycommand.ts` with `export async function mycommandCommand(options): Promise<void>`
2. Register in `src/cli.ts` with `program.command('mycommand')...`
3. Export from `src/index.ts` if it should be part of the public API

## Adding error patterns for a new language

Edit `src/utils/error-patterns.ts` — add a new entry to the `PATTERNS` array:

```typescript
{
  name: 'Swift',
  patterns: [
    /Fatal error:/,
    /Thread \d+: signal SIGABRT/,
  ],
},
```

## Session artifacts

| File | Created by | Contains |
|---|---|---|
| `metadata.json` | `start` | Git branch, commit SHA, timestamp (persists after stop) |
| `session.mp4` | `stop` | Finalized H.264 recording (`start` captures temporary `session.webm`) |
| `session-log.json` | `exec` (appended each call) | Action timeline with relative timestamps |
| `server.log` | `start` (piped stdout+stderr) | All dev server output |
| `console-output.log` | `stop` | Browser console output |
| `network-summary.json` | `stop` | Sanitized endpoint/method/status/timing/error metadata |
| `private/agent-browser/` | `exec` / `stop` | User-only raw JSON/HAR; excluded from manifests and publication |
| `step-*.png` | `exec screenshot` | Screenshots at key moments |
| `SUMMARY.md` | `stop` | Markdown report with errors and screenshots |
| `viewer.html` | `stop` | Standalone HTML viewer with video + timeline |

## Versioning & releases

- **Automatic** — merging to `main` triggers semantic-release via GitHub Actions
- **Never manually edit `version` in package.json** — semantic-release handles it
- **Conventional Commits** determine the version bump:
  - `feat:` → minor (0.1.0 → 0.2.0)
  - `fix:`, `perf:`, `refactor:` → patch (0.2.0 → 0.2.1)
  - `feat!:` or `BREAKING CHANGE:` footer → major (0.2.1 → 1.0.0)
  - `docs:`, `style:`, `chore:`, `test:`, `ci:` → no release
- **Commit format:** `type(scope): description` — e.g. `feat(cli): add diff command`, `fix(viewer): correct timestamp offset`
- **Branch naming:** `AmElmo/<descriptive-name>`

## Gotchas

- `proofshot exec` has special shell quoting logic (`buildShellCommand` in exec.ts) — `eval` commands get single-quoted, args with special chars get auto-quoted
- Direct DOM mutation is diagnostic only; synthetic actions force `INCOMPLETE`. Preserve category/redaction behavior when adding commands
- Every browser subprocess strips provider/CDP/profile/state/session/proxy inheritance and uses the persisted private config, namespace, allowlist, and socket root
- Video trimming adjusts session-log.json timestamps to match the trimmed video (see `trimOffsetSec` in stop.ts)
- Server log capture only works when proofshot starts the server itself — if the port is already occupied, we skip spawning and get no server logs
- The `consoleErrors`/`consoleOutput` from agent-browser are point-in-time snapshots collected at stop time
