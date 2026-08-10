import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { loadConfig } from '../utils/config.js';
import {
  ab,
  buildAgentBrowserCommand,
  getAgentBrowserEnvironment,
  setAgentBrowserDefaults,
} from '../utils/exec.js';
import {
  loadSession,
  resolveSessionControlDir,
  saveSession,
  type SessionState,
} from '../session/state.js';
import { canAddressOwnedBrowserSession } from '../session/lifecycle.js';
import { getPageUrl } from '../browser/session.js';
import { registerSession } from '../session/registry.js';

const SESSION_LOG_FILENAME = 'session-log.json';
const SESSION_LOG_LOCK_TIMEOUT_MS = 5000;
const SESSION_LOG_STALE_LOCK_MS = 120000;

export interface SessionLogEntry {
  action: string;
  relativeTimeSec: number;
  timestamp: string;
  outcome?: 'passed' | 'failed';
  expectedSelector?: string;
  error?: string;
  pageUrl?: string;
  element?: {
    label: string;
    bbox: { x: number; y: number; width: number; height: number };
    viewport: { width: number; height: number };
  };
}

/**
 * Load existing session log entries from disk.
 */
export function loadSessionLog(sessionDir: string): SessionLogEntry[] {
  const logPath = path.join(sessionDir, SESSION_LOG_FILENAME);
  if (!fs.existsSync(logPath)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    if (!Array.isArray(parsed)) {
      throw new Error('session log root must be an array');
    }
    return parsed as SessionLogEntry[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ProofShot session action log is corrupt: ${logPath}\n${message}`);
  }
}

/**
 * For screenshot commands, resolve relative paths into the session directory
 * so agents can just say `proofshot exec screenshot step-name.png`.
 */
function resolveScreenshotPath(args: string[], sessionDir: string): string[] {
  if (args[0] !== 'screenshot' || args.length < 2) return args;

  const screenshotPath = args[args.length - 1];
  const resolved = path.resolve(sessionDir, screenshotPath);
  if (path.dirname(resolved) !== path.resolve(sessionDir)) {
    throw new Error(
      'ProofShot screenshots must use a filename directly inside the active session.',
    );
  }
  return [...args.slice(0, -1), resolved];
}

/**
 * Build the shell command string for agent-browser.
 *
 * For `eval` commands, we need to pass the JS code as a single quoted argument
 * to prevent the shell from interpreting parentheses, brackets, etc.
 * For other commands, simple joining is fine.
 */
export function buildShellCommand(args: string[], sessionName?: string): string {
  if (args[0] === 'eval' && args.length > 1) {
    const jsCode = args.slice(1).join(' ');
    const escaped = jsCode.replace(/'/g, "'\\''");
    return buildAgentBrowserCommand(`eval '${escaped}'`, { session: sessionName });
  }

  const quotedArgs = args.map((arg) => {
    if (/[(){}[\]$`!#&|;<>*? "'\\]/.test(arg)) {
      const escaped = arg.replace(/'/g, "'\\''");
      return `'${escaped}'`;
    }
    return arg;
  });
  return buildAgentBrowserCommand(quotedArgs.join(' '), { session: sessionName });
}

export function translateProofShotExecArgs(args: string[]): {
  agentBrowserArgs: string[];
  expectedSelector?: string;
} {
  if (args[0] === 'assert-visible' && args.length > 1) {
    return {
      agentBrowserArgs: ['is', 'visible', ...args.slice(1)],
      expectedSelector: args.slice(1).join(' '),
    };
  }
  return { agentBrowserArgs: args };
}

/**
 * Parse an element ref (@eN) from command args.
 */
function parseElementRef(args: string[]): string | null {
  for (const arg of args) {
    const match = arg.match(/@e\d+/);
    if (match) return match[0];
  }
  return null;
}

/**
 * Capture element bounding box and label before action execution.
 *
 * agent-browser's `get box` doesn't support @eN refs, but `get text` and
 * `get attr` do. Strategy:
 * 1. Try `get attr @eN id` — if found, use `get box #<id>` (reliable for inputs)
 * 2. Otherwise try `get text @eN` — use `get box "text=<label>"` (works for links/buttons)
 * 3. Label comes from get text (links/buttons) or get attr fallback chain (inputs)
 *
 * None of these commands invalidate snapshot refs, so the subsequent action still works.
 */
function captureElementData(
  ref: string,
  viewport: { width: number; height: number },
  sessionName?: string,
): SessionLogEntry['element'] | null {
  try {
    let bbox: { x: number; y: number; width: number; height: number } | null = null;
    let label = '';

    // Strategy 1: Try id-based selector (works for inputs with id attributes)
    let elemId = '';
    try { elemId = ab(`get attr ${ref} id`, { session: sessionName }); } catch { /* empty */ }

    if (elemId) {
      try {
        const raw = ab(`get box '#${elemId}'`, { session: sessionName });
        bbox = JSON.parse(raw);
      } catch { /* empty */ }

      // For inputs, get label from associated <label> via eval (doesn't invalidate refs)
      try {
        const raw = ab(
          `eval "document.getElementById('${elemId}')?.labels?.[0]?.textContent||document.getElementById('${elemId}')?.placeholder||document.getElementById('${elemId}')?.getAttribute('aria-label')||''"`,
          { session: sessionName },
        );
        label = JSON.parse(raw) || '';
      } catch { /* empty */ }
    }

    // Strategy 2: Try text-based selector (works for links, buttons)
    if (!bbox) {
      try { label = ab(`get text ${ref}`, { session: sessionName }); } catch { /* empty */ }
      if (!label) {
        try { label = ab(`get attr ${ref} placeholder`, { session: sessionName }); } catch { /* empty */ }
      }
      if (!label) {
        try { label = ab(`get attr ${ref} aria-label`, { session: sessionName }); } catch { /* empty */ }
      }
      if (!label) {
        try { label = ab(`get attr ${ref} name`, { session: sessionName }); } catch { /* empty */ }
      }

      if (label) {
        try {
          const escaped = label.replace(/'/g, "\\'");
          const raw = ab(`get box 'text=${escaped}'`, { session: sessionName });
          bbox = JSON.parse(raw);
        } catch { /* empty */ }
      }
    }

    if (!bbox) return null;

    return {
      label: label || '',
      bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      viewport,
    };
  } catch {
    return null;
  }
}

/**
 * Check if the action is ref-targeted (click, fill, type with @eN).
 */
function isRefTargetedAction(args: string[]): boolean {
  const cmd = args[0]?.toLowerCase();
  return (cmd === 'click' || cmd === 'fill' || cmd === 'type') && parseElementRef(args) !== null;
}

/**
 * proofshot exec <agent-browser-args...>
 *
 * 1. Read session state to get sessionDir and startedAt
 * 2. For screenshot commands, resolve paths into the session dir
 * 3. For ref-targeted actions, capture element bbox + label BEFORE execution
 * 4. Calculate timestamp relative to session start
 * 5. Append entry to session-log.json
 * 6. Pass through to agent-browser and return its output
 * 7. If action was `set viewport`, update cached viewport in session state
 */
export async function execCommand(args: string[]): Promise<void> {
  const action = args.join(' ');
  const translated = translateProofShotExecArgs(args);
  let loggedEntry: SessionLogEntry | null = null;
  let sessionLogPath: string | null = null;

  // Load session state
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const session = loadSession(controlDir);
  setAgentBrowserDefaults({
    configPath: session?.agentBrowserConfigPath || config.browser.configPath,
    socketDir: session?.agentBrowserSocketDir,
  });

  if (session && !session.recordingActive) {
    console.error(
      'Error: Session has no active recording. Video capture is required.\n' +
        'Run "proofshot stop" to end this session, then start a new one.',
    );
    process.exit(1);
  }

  if (session && !canAddressOwnedBrowserSession(session)) {
    console.error(
      'Error: Browser ownership no longer matches this ProofShot session.\n' +
        'Refusing to address a possibly reused agent-browser session name.',
    );
    process.exit(1);
    return;
  }

  // Resolve args (screenshot path rewriting)
  let resolvedArgs = translated.agentBrowserArgs;
  if (session) {
    resolvedArgs = resolveScreenshotPath(
      translated.agentBrowserArgs,
      session.sessionDir,
    );
  }

  // Capture element data BEFORE execution (element may be gone after click navigation)
  let elementData: SessionLogEntry['element'] | undefined;
  if (session && isRefTargetedAction(args)) {
    const ref = parseElementRef(args)!;
    const viewport = session.viewport || { width: 1280, height: 720 };
    const captured = captureElementData(ref, viewport, session.sessionName);
    if (captured) elementData = captured;
  }

  // Log the action if a session is active
  if (session) {
    const now = new Date();
    const startTime = new Date(session.startedAt).getTime();
    const relativeTimeSec = parseFloat(((now.getTime() - startTime) / 1000).toFixed(1));

    const entry: SessionLogEntry = {
      action,
      relativeTimeSec,
      timestamp: now.toISOString(),
      expectedSelector: translated.expectedSelector,
    };
    if (elementData) {
      entry.element = elementData;
    }

    const logPath = path.join(session.sessionDir, SESSION_LOG_FILENAME);
    updateSessionLog(logPath, (entries) => {
      entries.push(entry);
    });
    loggedEntry = entry;
    sessionLogPath = logPath;
  }

  // Build shell command with proper quoting
  const shellCmd = buildShellCommand(resolvedArgs, session?.sessionName);

  // Pass through to agent-browser
  try {
    const result = execSync(shellCmd, {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getAgentBrowserEnvironment(),
    });
    if (
      translated.expectedSelector &&
      result.trim().toLowerCase() !== 'true'
    ) {
      const assertionError = new Error(
        `Expected selector to be visible: ${translated.expectedSelector}`,
      ) as Error & { status: number };
      assertionError.status = 1;
      throw assertionError;
    }
    if (result.trim()) {
      process.stdout.write(result);
      // Ensure trailing newline
      if (!result.endsWith('\n')) {
        process.stdout.write('\n');
      }
    }
    const pageUrl = session ? getPageUrl(session.sessionName) || undefined : undefined;
    persistActionOutcome(loggedEntry, sessionLogPath, 'passed', undefined, pageUrl);
  } catch (error: any) {
    // Print stderr and exit with the same code
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (!stdout && !stderr && error?.message) {
      process.stderr.write(`${error.message}\n`);
    }
    persistActionOutcome(
      loggedEntry,
      sessionLogPath,
      'failed',
      stderr.trim() || stdout.trim() || error?.message,
    );
    process.exit(error?.status || 1);
  }

  // If the action was `set viewport`, update cached viewport in session state
  if (session && args[0] === 'set' && args[1] === 'viewport') {
    try {
      const vpJson = ab("eval 'JSON.stringify({width: window.innerWidth, height: window.innerHeight})'", {
        session: session.sessionName,
      });
      const vp = JSON.parse(vpJson);
      session.viewport = { width: vp.width, height: vp.height };
      saveSession(session, controlDir);
      registerSession(session);
    } catch {
      // Non-critical — viewport cache stays stale
    }
  }
}

function persistActionOutcome(
  entry: SessionLogEntry | null,
  logPath: string | null,
  outcome: 'passed' | 'failed',
  error?: string,
  pageUrl?: string,
): void {
  if (!entry || !logPath) {
    return;
  }
  entry.outcome = outcome;
  if (error) {
    entry.error = error;
  }
  if (pageUrl) {
    entry.pageUrl = pageUrl;
  }
  updateSessionLog(logPath, (entries) => {
    const matchingEntry = [...entries]
      .reverse()
      .find(
        (candidate) =>
          candidate.timestamp === entry.timestamp &&
          candidate.action === entry.action,
      );
    if (matchingEntry) {
      matchingEntry.outcome = outcome;
      if (error) {
        matchingEntry.error = error;
      }
      if (pageUrl) {
        matchingEntry.pageUrl = pageUrl;
      }
    }
  });
}

function updateSessionLog(
  logPath: string,
  update: (entries: SessionLogEntry[]) => void,
): void {
  const lockPath = `${logPath}.lock`;
  const deadline = Date.now() + SESSION_LOG_LOCK_TIMEOUT_MS;
  let lockFd: number | null = null;
  while (lockFd === null) {
    try {
      lockFd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > SESSION_LOG_STALE_LOCK_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for session log lock: ${lockPath}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }

  try {
    const entries = loadSessionLog(path.dirname(logPath));
    update(entries);
    const temporaryPath = `${logPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(entries, null, 2) + '\n', {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, logPath);
  } finally {
    fs.closeSync(lockFd);
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
