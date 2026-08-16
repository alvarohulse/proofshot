import {
  formatAgentBrowserOutputForDisplay,
  sanitizeAgentBrowserError,
  writePrivateAgentBrowserResult,
  type AgentBrowserResultReceipt,
} from '../browser/evidence.js';
import {
  buildSanitizedCommandIntent,
  classifyInteraction,
  sanitizeDiagnosticMessage,
  sanitizePageUrl,
} from '../browser/provenance.js';
import {
  assertControlledAgentBrowserCommand,
  prepareControlledAgentBrowserCommand,
} from '../browser/command-policy.js';
import { loadConfig, normalizeViewport } from '../utils/config.js';
import {
  ab,
  buildAgentBrowserInvocation,
  executeAgentBrowser,
  setAgentBrowserDefaults,
  type AgentBrowserInvocation,
} from '../utils/exec.js';
import {
  resolveSessionControlDir,
} from '../session/state.js';
import { backfillSessionAgentBrowserRuntime } from '../session/browser-runtime.js';
import { canAddressOwnedBrowserSession } from '../session/lifecycle.js';
import { getPageUrl } from '../browser/session.js';
import {
  claimSessionOperation,
  registerSession,
  releaseSessionOperation,
} from '../session/registry.js';
import { resolveLiveSession } from '../session/selection.js';
import {
  appendSessionLogEntry,
  persistSessionLogEntry,
  type SessionLogEntry,
} from '../session/action-log.js';

type ExecOptions = {
  session?: string;
};

/**
 * Build an executable + argv invocation for agent-browser.
 */
export function buildExecInvocation(
  args: string[],
  sessionName?: string,
  structuredOutput = false,
): AgentBrowserInvocation {
  assertControlledAgentBrowserCommand(args);
  return buildAgentBrowserInvocation(normalizeExecArgs(args), {
    json: structuredOutput,
    session: sessionName,
  });
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
    try { elemId = ab(['get', 'attr', ref, 'id'], { session: sessionName }); } catch { /* empty */ }

    if (elemId) {
      try {
        const raw = ab(['get', 'box', `#${elemId}`], { session: sessionName });
        bbox = JSON.parse(raw);
      } catch { /* empty */ }

      // For inputs, get label from associated <label> via eval (doesn't invalidate refs)
      try {
        const raw = ab(
          [
            'eval',
            `document.getElementById(${JSON.stringify(elemId)})?.labels?.[0]?.textContent||document.getElementById(${JSON.stringify(elemId)})?.placeholder||document.getElementById(${JSON.stringify(elemId)})?.getAttribute('aria-label')||''`,
          ],
          { session: sessionName },
        );
        label = JSON.parse(raw) || '';
      } catch { /* empty */ }
    }

    // Strategy 2: Try text-based selector (works for links, buttons)
    if (!bbox) {
      try { label = ab(['get', 'text', ref], { session: sessionName }); } catch { /* empty */ }
      if (!label) {
        try { label = ab(['get', 'attr', ref, 'placeholder'], { session: sessionName }); } catch { /* empty */ }
      }
      if (!label) {
        try { label = ab(['get', 'attr', ref, 'aria-label'], { session: sessionName }); } catch { /* empty */ }
      }
      if (!label) {
        try { label = ab(['get', 'attr', ref, 'name'], { session: sessionName }); } catch { /* empty */ }
      }

      if (label) {
        try {
          const raw = ab(['get', 'box', `text=${label}`], { session: sessionName });
          bbox = JSON.parse(raw);
        } catch { /* empty */ }
      }
    }

    if (!bbox) return null;

    return {
      label: sanitizeDiagnosticMessage(label) || '',
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
export async function execCommand(
  args: string[],
  options: ExecOptions = {},
): Promise<void> {
  const intent = buildSanitizedCommandIntent(args);
  const action = intent.summary;
  const translated = translateProofShotExecArgs(args);
  assertControlledAgentBrowserCommand(translated.agentBrowserArgs);
  let loggedEntry: SessionLogEntry | null = null;
  let sessionLogPath: string | null = null;

  // Load session state
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const session = resolveLiveSession({
    controlDir,
    operation: 'exec',
    sessionName: options.session,
  });
  if (!session) {
    console.error(
      'Error: No active ProofShot session matches this worktree.\n' +
        'Run "proofshot start" first, or inspect recovery state with "proofshot session list".',
    );
    process.exit(1);
    return;
  }

  if (!session.recordingActive) {
    console.error(
      'Error: Session has no active recording. Video capture is required.\n' +
        'Run "proofshot stop" to end this session, then start a new one.',
    );
    process.exit(1);
  }

  if (!canAddressOwnedBrowserSession(session)) {
    console.error(
      'Error: Browser ownership no longer matches this ProofShot session.\n' +
        'Refusing to address a possibly reused agent-browser session name.',
    );
    process.exit(1);
    return;
  }

  const execLease = claimSessionOperation(session, 'exec');
  try {
  if (backfillSessionAgentBrowserRuntime(session)) {
    registerSession(session);
  }
  setAgentBrowserDefaults({
    allowedDomains: session.agentBrowserAllowedDomains,
    configPath: session.agentBrowserConfigPath || config.browser.configPath,
    executablePath: session.agentBrowserExecutablePath,
    namespace: session.agentBrowserNamespace,
    socketDir: session.agentBrowserSocketRoot || session.agentBrowserSocketDir,
  });
  const pageUrlBefore = capturePageUrl(session.sessionName);
  // Resolve args (screenshot path rewriting)
  let resolvedArgs = translated.agentBrowserArgs;
  if (session) {
    resolvedArgs = prepareControlledAgentBrowserCommand(
      translated.agentBrowserArgs,
      session.sessionDir,
    );
  }

  // Capture element data BEFORE execution (element may be gone after click navigation)
  let elementData: SessionLogEntry['element'] | undefined;
  if (session && isRefTargetedAction(args)) {
    const ref = parseElementRef(args)!;
    const viewport = normalizeViewport(session.viewport) || { width: 1280, height: 720 };
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
      category: classifyInteraction(args),
      intent,
      pageUrl: pageUrlBefore,
      relativeTimeSec,
      timestamp: now.toISOString(),
      expectedSelector: sanitizeDiagnosticMessage(translated.expectedSelector),
    };
    if (elementData) {
      entry.element = elementData;
    }

    const logPath = appendSessionLogEntry(session.sessionDir, entry);
    loggedEntry = entry;
    sessionLogPath = logPath;
  }

  const commandArgs = normalizeExecArgs(resolvedArgs);
  const executionStartedAt = Date.now();

  // Pass through to agent-browser
  try {
    const result = executeAgentBrowser(commandArgs, {
      json: Boolean(session),
      session: session?.sessionName,
      timeoutMs: 60000,
    });
    if (
      translated.expectedSelector &&
      !assertionPassed(result)
    ) {
      const assertionError = new Error(
        `Expected selector to be visible: ${translated.expectedSelector}`,
      ) as Error & { status: number; stderr: string };
      assertionError.status = 1;
      assertionError.stderr = assertionError.message;
      throw assertionError;
    }
    const displayedResult = formatAgentBrowserOutputForDisplay({
      args,
      rawOutput: result,
      success: true,
    });
    if (displayedResult.trim()) {
      process.stdout.write(displayedResult);
      // Ensure trailing newline
      if (!displayedResult.endsWith('\n')) {
        process.stdout.write('\n');
      }
    }
    const pageUrl = capturePageUrl(session.sessionName);
    const agentBrowserResult = session
      ? writePrivateAgentBrowserResult({
          args,
          sessionDir: session.sessionDir,
          rawOutput: result,
          success: true,
        })
      : undefined;
    persistActionOutcome(
      loggedEntry,
      sessionLogPath,
      'passed',
      undefined,
      pageUrl,
      Date.now() - executionStartedAt,
      agentBrowserResult,
    );
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    if (stdout) {
      const displayedStdout = formatAgentBrowserOutputForDisplay({
        args,
        rawOutput: stdout,
        success: false,
      });
      if (displayedStdout) {
        process.stdout.write(`${displayedStdout}\n`);
      }
    }
    if (stderr) {
      process.stderr.write(
        `${sanitizeAgentBrowserError(args, stderr.trim())}\n`,
      );
    }
    if (!stdout && !stderr) {
      process.stderr.write(
        `agent-browser exited with status ${error?.status || 1}\n`,
      );
    }
    const rawErrorOutput = stdout || stderr;
    const errorMessage =
      stderr.trim() ||
      stdout.trim() ||
      `agent-browser exited with status ${error?.status || 1}`;
    const persistedError = sanitizeAgentBrowserError(
      args,
      errorMessage,
    );
    const agentBrowserResult = session
      ? writePrivateAgentBrowserResult({
          args,
          sessionDir: session.sessionDir,
          rawOutput: rawErrorOutput,
          success: false,
          error: persistedError,
        })
      : undefined;
    persistActionOutcome(
      loggedEntry,
      sessionLogPath,
      'failed',
      persistedError,
      pageUrlBefore,
      Date.now() - executionStartedAt,
      agentBrowserResult,
    );
    process.exitCode = error?.status || 1;
    return;
  }

  // If the action was `set viewport`, update cached viewport in session state
  if (session && args[0] === 'set' && args[1] === 'viewport') {
    try {
      const vpJson = ab(['eval', 'JSON.stringify({width: window.innerWidth, height: window.innerHeight})'], {
        session: session.sessionName,
      });
      const vp = normalizeViewport(JSON.parse(vpJson));
      if (vp) {
        session.viewport = vp;
        registerSession(session);
      }
    } catch {
      // Non-critical — viewport cache stays stale
    }
  }
  } finally {
    if (session.operationLease?.id === execLease.id) {
      releaseSessionOperation(session, execLease);
    }
  }
}

export {
  assertControlledAgentBrowserCommand,
  prepareControlledAgentBrowserCommand,
};

function capturePageUrl(sessionName: string): string | undefined {
  try {
    return sanitizePageUrl(getPageUrl(sessionName) || undefined);
  } catch {
    return undefined;
  }
}

function persistActionOutcome(
  entry: SessionLogEntry | null,
  logPath: string | null,
  outcome: 'passed' | 'failed',
  error?: string,
  pageUrl?: string,
  durationMs?: number,
  agentBrowserResult?: AgentBrowserResultReceipt,
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
  if (durationMs !== undefined) {
    entry.durationMs = durationMs;
  }
  if (agentBrowserResult) {
    entry.agentBrowserResult = agentBrowserResult;
  }
  persistSessionLogEntry(logPath, entry);
}

function assertionPassed(rawOutput: string): boolean {
  if (rawOutput.trim().toLowerCase() === 'true') {
    return true;
  }
  try {
    const parsed = JSON.parse(rawOutput) as {
      data?: boolean | { visible?: unknown };
    };
    if (typeof parsed.data === 'boolean') {
      return parsed.data;
    }
    return parsed.data?.visible === true;
  } catch {
    return false;
  }
}

function normalizeExecArgs(args: string[]): string[] {
  return args[0] === 'eval' && args.length > 1
    ? ['eval', args.slice(1).join(' ')]
    : args;
}
