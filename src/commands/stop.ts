import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import chalk from 'chalk';
import { loadConfig, normalizeViewport } from '../utils/config.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import { getConsoleErrors, getConsoleOutput, getConsoleOutputJson } from '../browser/session.js';
import { stopRecording } from '../browser/capture.js';
import {
  finalizePrivateNetworkCapture,
  loadSanitizedNetworkSummary,
  type SanitizedNetworkSummary,
} from '../browser/evidence.js';
import { sanitizeDiagnosticMessage } from '../browser/provenance.js';
import {
  resolveSessionControlDir,
  type SessionState,
} from '../session/state.js';
import {
  canAddressOwnedBrowserSession,
  stopOwnedBrowser,
  stopOwnedServer,
} from '../session/lifecycle.js';
import { registerSession, unregisterSession } from '../session/registry.js';
import { resolveLiveSession } from '../session/selection.js';
import { stopOwnedEnvironment } from '../environment/runtime.js';
import { writeViewer, type TimestampedLogEntry } from '../artifacts/viewer.js';
import {
  probeMediaDuration,
  writeCanonicalEvidence,
} from '../artifacts/evidence.js';
import { loadMetadata } from '../session/metadata.js';
import { writeArtifactManifest } from '../session/manifest.js';
import { extractServerErrors } from '../utils/error-patterns.js';
import { processIdentityMatches } from '../utils/process.js';
import { loadSessionLog, type SessionLogEntry } from './exec.js';
import { estimateTokenUsage, formatTokenUsage, type TokenUsage } from '../utils/token-usage.js';

/**
 * Parse server.log lines with "epochMs\ttext" format.
 * Returns { entries (with relativeTimeSec), cleanText (timestamps stripped) }.
 */
function parseTimestampedServerLog(
  raw: string,
  startTimeMs: number,
): { entries: TimestampedLogEntry[]; cleanText: string } {
  if (!raw.trim()) return { entries: [], cleanText: '' };

  const lines = raw.split('\n').filter((l) => l.trim());
  const entries: TimestampedLogEntry[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    const tabIdx = line.indexOf('\t');
    if (tabIdx > 0) {
      const epochStr = line.slice(0, tabIdx);
      const epochMs = parseInt(epochStr, 10);
      if (!isNaN(epochMs) && epochMs > 1e12) {
        const text = line.slice(tabIdx + 1);
        entries.push({
          text,
          relativeTimeSec: Math.max(0, parseFloat(((epochMs - startTimeMs) / 1000).toFixed(1))),
        });
        cleanLines.push(text);
        continue;
      }
    }
    // Fallback: line without timestamp prefix
    entries.push({ text: line, relativeTimeSec: -1 });
    cleanLines.push(line);
  }

  return { entries, cleanText: cleanLines.join('\n') };
}

interface StopOptions {
  noClose?: boolean;
  session?: string;
}

export async function stopCommand(options: StopOptions): Promise<void> {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);

  // Load session state
  const session = resolveLiveSession({
    controlDir,
    sessionName: options.session,
  });
  if (!session) {
    console.log(
      chalk.dim('No active session found; all owned processes are already stopped.'),
    );
    return;
  }
  setAgentBrowserDefaults({
    allowedDomains: session.agentBrowserAllowedDomains,
    configPath: session.agentBrowserConfigPath || config.browser.configPath,
    namespace: session.agentBrowserNamespace,
    socketDir: session.agentBrowserSocketRoot || session.agentBrowserSocketDir,
  });

  if (session.bundleComplete) {
    if (session.browserRetained && !options.noClose) {
      console.log(chalk.dim('Closing retained browser...'));
      const browserSessionAddressable = canAddressOwnedBrowserSession(session);
      await stopOwnedBrowser(session);
      session.browserRetained = false;
      clearOwnedSession(session);
      if (browserSessionAddressable) {
        console.log(chalk.green('✓') + ' Retained browser closed; proof artifacts were already bundled.');
      } else {
        console.log(
          chalk.yellow('⚠') +
            ' Retained browser ownership was no longer current; skipped session-name close and cleared control state after exact recorded-tree cleanup.',
        );
      }
    } else if (session.browserRetained) {
      console.log(
        chalk.dim('Proof artifacts are already bundled; the owned browser remains intentionally open.'),
      );
    } else {
      clearOwnedSession(session);
      console.log(chalk.dim('Proof artifacts are already bundled and all owned processes are stopped.'));
    }
    return;
  }
  const stopSignals = installStopSignalHandlers();
  try {

  session.lifecycleStatus = 'stopping';
  session.cleanupError = null;
  session.stoppedAt ||= new Date().toISOString();
  persistOwnedSession(session);
  const retryingStoppedSession = !session.recordingActive;
  const recordingWasActive =
    session.recordingActive || Boolean(session.recordingStartedAt);
  const startTime = new Date(session.startedAt).getTime();
  const recordingStartTime = session.recordingStartedAt
    ? new Date(session.recordingStartedAt).getTime()
    : startTime;
  const recordingStartOffsetSec = Math.max(
    0,
    (recordingStartTime - startTime) / 1000,
  );
  const durationMs = new Date(session.stoppedAt).getTime() - startTime;
  const durationSec = Math.round(durationMs / 1000);
  const browserSessionAvailable = canAddressOwnedBrowserSession(session);

  const priorConsoleEvidenceAvailable = session.consoleEvidenceAvailable === true;
  if (!browserSessionAvailable && priorConsoleEvidenceAvailable) {
    console.log(
      chalk.dim('Browser already stopped; reusing console evidence collected before cleanup.'),
    );
  } else if (!browserSessionAvailable) {
    console.log(
      chalk.yellow('⚠') +
        ' Browser ownership could not be verified; skipping console and recording commands.\n' +
        chalk.dim('  Browser evidence may be incomplete; exact recorded-process cleanup will still run.'),
    );
  }

  // Step 1: Collect console errors and output
  console.log(chalk.dim('Collecting errors...'));
  let consoleErrors = '';
  let consoleOutput = '';
  let consoleEntries: TimestampedLogEntry[] = [];
  const consoleErrorsPath = path.join(session.sessionDir, 'console-errors.log');
  const consoleOutputPath = path.join(session.sessionDir, 'console-output.log');
  const consoleEntriesPath = path.join(session.sessionDir, 'console-entries.json');
  let consoleCollectionSucceeded = false;
  if (browserSessionAvailable) {
    try {
      consoleErrors = getConsoleErrors(session.sessionName);
      consoleOutput = getConsoleOutput(session.sessionName);
      // Get timestamped console messages for viewer sync
      const consoleMessages = getConsoleOutputJson(session.sessionName);
      consoleEntries = consoleMessages.map((msg) => ({
        text: `[${msg.type}] ${msg.text}`,
        relativeTimeSec: Math.max(0, parseFloat(((msg.timestamp - startTime) / 1000).toFixed(1))),
      }));
      consoleCollectionSucceeded = true;
    } catch {
      consoleCollectionSucceeded = false;
    }
  }
  if (consoleCollectionSucceeded) {
    writeTextFileAtomically(consoleErrorsPath, consoleErrors);
    writeTextFileAtomically(consoleOutputPath, consoleOutput);
    writeTextFileAtomically(
      consoleEntriesPath,
      JSON.stringify(consoleEntries, null, 2) + '\n',
    );
    const capturedErrorLines = consoleErrors
      .split('\n')
      .filter((line) => line.trim() && line.trim() !== 'No errors');
    session.consoleEvidenceAvailable = true;
    session.consoleErrorCount =
      capturedErrorLines.length > 0 && consoleErrors.trim() !== ''
        ? capturedErrorLines.length
        : 0;
    // Persist evidence before any cleanup step can fail. A retry must not turn
    // successfully collected browser facts into an "unavailable" claim.
    persistOwnedSession(session);
  } else if (priorConsoleEvidenceAvailable) {
    if (fs.existsSync(consoleErrorsPath)) {
      consoleErrors = fs.readFileSync(consoleErrorsPath, 'utf-8');
    }
    if (fs.existsSync(consoleOutputPath)) {
      consoleOutput = fs.readFileSync(consoleOutputPath, 'utf-8');
    }
    if (fs.existsSync(consoleEntriesPath)) {
      try {
        const savedEntries = JSON.parse(fs.readFileSync(consoleEntriesPath, 'utf-8'));
        if (Array.isArray(savedEntries)) consoleEntries = savedEntries;
      } catch {
        // Keep the persisted availability/count; only the optional timeline is absent.
      }
    }
  } else {
    session.consoleEvidenceAvailable = false;
    session.consoleErrorCount = 0;
    persistOwnedSession(session);
  }

  let networkSummary: SanitizedNetworkSummary | null =
    loadSanitizedNetworkSummary(session.networkSummaryPath);
  if (
    browserSessionAvailable &&
    session.networkCaptureActive &&
    session.privateEvidenceDir &&
    session.networkHarPath &&
    session.networkRequestsPath &&
    session.networkSummaryPath
  ) {
    console.log(chalk.dim('Collecting private network evidence...'));
    try {
      networkSummary = finalizePrivateNetworkCapture(session.sessionName, {
        privateDirectory: session.privateEvidenceDir,
        harPath: session.networkHarPath,
        requestsPath: session.networkRequestsPath,
        summaryPath: session.networkSummaryPath,
      });
      session.networkEvidenceAvailable = true;
      session.networkCaptureError = null;
    } catch (error) {
      session.networkEvidenceAvailable = false;
      session.networkCaptureError =
        sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ) || 'network capture failed';
      console.log(
        chalk.yellow('⚠') +
          ` Private network evidence was incomplete: ${session.networkCaptureError}`,
      );
    }
    session.networkCaptureActive = false;
    persistOwnedSession(session);
  } else if (session.networkCaptureStarted && !networkSummary) {
    session.networkEvidenceAvailable = false;
    session.networkCaptureActive = false;
    persistOwnedSession(session);
  }

  // Step 2: Stop recording
  console.log(chalk.dim('Stopping recording...'));
  if (browserSessionAvailable) {
    stopRecording(session.sessionName);
  }
  session.recordingActive = false;
  persistOwnedSession(session);

  // Step 3: Close browser (unless --no-close)
  const cleanupErrors: unknown[] = [];
  if (!options.noClose) {
    console.log(chalk.dim('Closing browser...'));
    try {
      await stopOwnedBrowser(session);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (
    session.environment &&
    !session.environmentStopped &&
    session.environment.kind !== 'launcher'
  ) {
    const captures =
      session.environment.kind === 'tmux'
        ? session.environment.captures
        : session.environment.processes;
    session.environment.healthFailures = captures
      .filter((capture) => !processIdentityMatches(capture.process))
      .map((capture) => capture.sourceId);
    persistOwnedSession(session);
  }
  const finalizedEnvironment = session.environment;
  if (session.environment && !session.environmentStopped) {
    console.log(chalk.dim('Stopping environment...'));
    try {
      await stopOwnedEnvironment(session.environment);
      session.environmentStopped = true;
      persistOwnedSession(session);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  // Step 3.5: Stop only the detached process session created by this start.
  if (session.serverProcess) {
    console.log(chalk.dim('Stopping dev server...'));
    try {
      await stopOwnedServer(session);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    const cleanupError = new AggregateError(
      cleanupErrors,
      `Cleanup failed: ${cleanupErrors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('; ')}`,
    );
    session.lifecycleStatus = 'recovery';
    session.cleanupError =
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    persistOwnedSession(session);
    throw cleanupError;
  }

  // Step 4: Read server log (with timestamp parsing)
  let serverLog = '';
  let serverEntries: TimestampedLogEntry[] = [];
  if (fs.existsSync(session.serverErrorLog)) {
    const rawServerLog = fs.readFileSync(session.serverErrorLog, 'utf-8');
    const parsed = parseTimestampedServerLog(rawServerLog, startTime);
    serverLog = parsed.cleanText;
    serverEntries = parsed.entries;
  }

  // Use session subfolder for all artifacts
  const sessionDir = session.sessionDir;

  // Step 5: Find all screenshots in session dir
  const screenshots = fs.existsSync(sessionDir)
    ? fs.readdirSync(sessionDir).filter((f) => f.endsWith('.png'))
    : [];

  // Step 5.5: Trim video dead time
  const sessionLog = loadSessionLog(sessionDir);
  let trimOffsetSec = session.trimOffsetSec ?? recordingStartOffsetSec;
  if (!session.videoTrimComplete) {
    let videoTrimOffsetSec = 0;
    if (fs.existsSync(session.videoPath)) {
      videoTrimOffsetSec = trimVideo(
        session.videoPath,
        screenshots,
        sessionDir,
        startTime,
        sessionLog,
        recordingStartOffsetSec,
      );
    }
    session.videoPath = convertVideoToMp4(session.videoPath);
    if (!fs.existsSync(session.videoPath) && recordingWasActive) {
      console.log(
        chalk.yellow('⚠') +
          ' Recording was active but no video file was produced.\n' +
          chalk.dim('  The screencast may have been interrupted. Screenshots and logs are still saved.'),
      );
    }
    trimOffsetSec = recordingStartOffsetSec + videoTrimOffsetSec;
    session.videoTrimComplete = true;
    session.trimOffsetSec = trimOffsetSec;
    persistOwnedSession(session);
  }

  // Step 6: Count errors
  const consoleErrorLines = consoleErrors
    .split('\n')
    .filter((l) => l.trim() && l.trim() !== 'No errors');
  const observedConsoleErrorCount =
    consoleErrorLines.length > 0 && consoleErrors.trim() !== ''
      ? consoleErrorLines.length
      : 0;
  const consoleEvidenceAvailable =
    browserSessionAvailable || priorConsoleEvidenceAvailable;
  const consoleErrorCount = browserSessionAvailable
    ? observedConsoleErrorCount
    : session.consoleErrorCount ?? 0;
  if (browserSessionAvailable) {
    session.consoleEvidenceAvailable = true;
    session.consoleErrorCount = consoleErrorCount;
    persistOwnedSession(session);
  }

  // Extract errors from server log using multi-language patterns
  const serverErrorLines = extractServerErrors(serverLog);
  const serverErrorCount = serverErrorLines.length;

  // Step 6.5: Estimate token usage
  const tokenUsage = estimateTokenUsage(session.sessionDir, startTime, Date.now());

  // Step 7: Generate SUMMARY.md
  const recordedViewport = normalizeViewport(session.viewport);
  const summaryViewport =
    recordedViewport ||
    normalizeViewport(config.viewport) || { width: 1280, height: 720 };
  const summaryPath = path.join(sessionDir, 'SUMMARY.md');
  const summary = generateProofSummary({
    projectDirectory: session.startDirectory || process.cwd(),
    description: session.description,
    serverCommand: session.serverCommand,
    port: session.port,
    headless: session.headless ?? config.headless ?? true,
    viewport: summaryViewport,
    videoPath: session.videoPath,
    screenshots,
    consoleErrors,
    consoleErrorCount,
    consoleEvidenceAvailable,
    serverLog,
    serverErrorCount,
    tokenUsage,
    durationSec,
    outputDir: sessionDir,
  });
  if (!retryingStoppedSession || !fs.existsSync(summaryPath)) {
    writeTextFileAtomically(summaryPath, summary);
  }

  // Step 7.5: Generate interactive viewer (if session log exists)
  // Adjust session log timestamps to match the trimmed video
  let viewerEntries = sessionLog;
  if (trimOffsetSec > 0 && !session.sessionLogAdjusted) {
    viewerEntries = sessionLog.map((e) => ({
      ...e,
      relativeTimeSec: parseFloat((e.relativeTimeSec - trimOffsetSec).toFixed(1)),
    }));
  }

  // Write adjusted log back to disk so timestamps match the trimmed video
  if (trimOffsetSec > 0 && !session.sessionLogAdjusted && viewerEntries.length > 0) {
    const logPath = path.join(sessionDir, 'session-log.json');
    writeTextFileAtomically(logPath, JSON.stringify(viewerEntries, null, 2) + '\n');
  }
  if (!session.sessionLogAdjusted) {
    session.sessionLogAdjusted = true;
    persistOwnedSession(session);
  }

  // Apply trimOffsetSec to log entries (same adjustment as session log)
  const adjustTime = (e: TimestampedLogEntry): TimestampedLogEntry =>
    trimOffsetSec > 0
      ? { ...e, relativeTimeSec: parseFloat((e.relativeTimeSec - trimOffsetSec).toFixed(1)) }
      : e;

  const viewerConsoleEntries = consoleEntries.map(adjustTime);
  const viewerServerEntries = serverEntries.map(adjustTime);
  const canonicalDurationSec = Math.max(0, durationSec - trimOffsetSec);
  const { evidence, verdict } = writeCanonicalEvidence({
    sessionId: session.sessionName,
    sessionDir,
    initialPageUrl: session.targetUrl,
    durationSec: canonicalDurationSec,
    timelineOffsetSec: trimOffsetSec,
    videoPath: session.videoPath,
    recordingWasActive,
    consoleEvidenceAvailable,
    actions: viewerEntries,
    consoleEntries: viewerConsoleEntries,
    serverEntries: viewerServerEntries,
    environment: finalizedEnvironment,
    networkSummary,
    networkEvidenceRequired: session.networkCaptureStarted === true,
  });

  const viewerPath = writeViewer(sessionDir, {
    description: session.description,
    serverCommand: session.serverCommand,
    durationSec: canonicalDurationSec,
    videoFilename: fs.existsSync(session.videoPath) ? path.basename(session.videoPath) : null,
    viewport: recordedViewport ?? undefined,
    consoleErrorCount,
    consoleEvidenceAvailable,
    serverErrorCount,
    consoleOutput,
    serverLog,
    consoleEntries: viewerConsoleEntries.length > 0 ? viewerConsoleEntries : undefined,
    serverEntries: viewerServerEntries.length > 0 ? viewerServerEntries : undefined,
    entries: viewerEntries.length > 0 ? viewerEntries : undefined,
    tokenUsage,
    evidence,
    verdict,
  });
  const metadata = loadMetadata(sessionDir) || {
    repository: '',
    repositoryRoot: session.startDirectory,
    branch: '',
    commitSha: '',
    treeHash: '',
    sourceDirty: true,
    startedAt: session.startedAt,
    description: session.description,
  };
  writeArtifactManifest({
    sessionId: session.sessionName,
    sessionDir,
    metadata,
    evidence,
    verdict,
  });

  // Step 8: Retain exact browser ownership only when explicitly requested.
  session.bundleComplete = true;
  session.browserRetained = Boolean(options.noClose);
  if (session.browserRetained) {
    session.lifecycleStatus = 'active';
    persistOwnedSession(session);
  } else {
    clearOwnedSession(session);
  }

  // Step 9: Print results
  console.log('');
  console.log(chalk.green.bold('✅ ProofShot verification complete'));
  console.log('');

  if (fs.existsSync(session.videoPath)) {
    console.log(`📹 Video:         ${chalk.dim(session.videoPath)} (${durationSec}s)`);
  }
  console.log(`📸 Screenshots:   ${screenshots.length} captured`);
  console.log(`📝 Summary:       ${chalk.dim(summaryPath)}`);
  console.log(`🧾 Verdict:       ${verdict.status}`);
  if (viewerPath) {
    console.log(`🎬 Viewer:        ${chalk.dim(viewerPath)}`);
  } else {
    console.log(chalk.dim('Tip: Use "proofshot exec" instead of "agent-browser" to get an interactive timeline viewer.'));
  }
  console.log('');
  console.log(
    `Console errors:   ${
      !consoleEvidenceAvailable
        ? chalk.yellow('unavailable')
        : consoleErrorCount === 0
          ? chalk.green('0')
          : chalk.red(String(consoleErrorCount))
    }`,
  );
  console.log(
    `Server errors:    ${serverErrorCount === 0 ? chalk.green('0') : chalk.red(String(serverErrorCount))}`,
  );
  console.log(`Duration:         ${durationSec} seconds`);
  console.log('');
  console.log(`Proof artifacts saved to ${chalk.dim(sessionDir)}`);
  if (session.browserRetained) {
    console.log(chalk.dim('Browser retained. Run "proofshot stop" later to close this exact session.'));
  }

  // If errors were found, print them for immediate feedback
  if (consoleErrorCount > 0) {
    console.log('');
    console.log(chalk.red.bold('Console Errors:'));
    for (const line of consoleErrorLines.slice(0, 10)) {
      console.log(chalk.red(`  ${line}`));
    }
    if (consoleErrorLines.length > 10) {
      console.log(chalk.dim(`  ... and ${consoleErrorLines.length - 10} more (see SUMMARY.md)`));
    }
  }

  if (serverErrorCount > 0) {
    console.log('');
    console.log(chalk.red.bold('Server Errors:'));
    for (const line of serverErrorLines.slice(0, 10)) {
      console.log(chalk.red(`  ${line}`));
    }
    if (serverErrorLines.length > 10) {
      console.log(chalk.dim(`  ... and ${serverErrorLines.length - 10} more (see SUMMARY.md)`));
    }
  }
  } finally {
    const interruptedBy = stopSignals.remove();
    if (interruptedBy) {
      process.exitCode = interruptedBy === 'SIGINT' ? 130 : 143;
    }
  }
}

function installStopSignalHandlers(): {
  remove: () => NodeJS.Signals | null;
} {
  let interruptedBy: NodeJS.Signals | null = null;
  let signalCount = 0;
  let forcedExitTimer: NodeJS.Timeout | null = null;
  const handlers = new Map<NodeJS.Signals, () => void>();
  const removeListeners = (): void => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = (): void => {
      signalCount += 1;
      interruptedBy ||= signal;
      if (signalCount >= 3) {
        removeListeners();
        process.kill(process.pid, signal);
        return;
      }
      if (signalCount === 2) {
        console.error(
          chalk.yellow(
            `Received ${signal} again; forcing exit in 5s if exact teardown does not finish.`,
          ),
        );
        forcedExitTimer = setTimeout(() => {
          removeListeners();
          process.kill(process.pid, signal);
        }, 5000);
        return;
      }
      console.error(
        chalk.yellow(`Received ${signal}; finishing exact ProofShot teardown before exit.`),
      );
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return {
    remove: (): NodeJS.Signals | null => {
      removeListeners();
      if (forcedExitTimer) clearTimeout(forcedExitTimer);
      return interruptedBy;
    },
  };
}

function writeTextFileAtomically(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function persistOwnedSession(session: SessionState): void {
  registerSession(session);
}

function clearOwnedSession(session: SessionState): void {
  unregisterSession(session.sessionName);
}

export interface SummaryData {
  projectDirectory: string;
  description: string | null;
  serverCommand: string | null;
  port: number;
  headless: boolean;
  viewport: { width: number; height: number };
  videoPath: string;
  screenshots: string[];
  consoleErrors: string;
  consoleErrorCount: number;
  consoleEvidenceAvailable: boolean;
  serverLog: string;
  serverErrorCount: number;
  tokenUsage?: TokenUsage | null;
  durationSec: number;
  outputDir: string;
}

export function generateProofSummary(data: SummaryData): string {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const projectName = path.basename(data.projectDirectory);

  let md = `# ProofShot Verification Report

**Date:** ${date}
**Project:** ${projectName}
**Dev Server:** ${data.serverCommand ? data.serverCommand : 'external'} on localhost:${data.port}

`;

  if (data.description) {
    md += `## What Was Verified

${data.description}

`;
  }

  // Video
  const relativeVideo = path.basename(data.videoPath);
  md += `## Video Recording

Full session recording: [${relativeVideo}](./${relativeVideo}) (${data.durationSec}s)

`;

  // Screenshots
  if (data.screenshots.length > 0) {
    md += `## Screenshots

`;
    for (const ss of data.screenshots) {
      md += `![${ss}](./${ss})\n\n`;
    }
  }

  // Console errors
  md += `## Console Errors

`;
  if (!data.consoleEvidenceAvailable) {
    md += `Browser ownership could not be verified, so console evidence was unavailable.\n\n`;
  } else if (data.consoleErrorCount === 0) {
    md += `No console errors detected.\n\n`;
  } else {
    md += `${data.consoleErrorCount} error(s) detected:\n\n\`\`\`\n${data.consoleErrors}\n\`\`\`\n\n`;
  }

  // Server errors
  md += `## Server Errors

`;
  if (data.serverErrorCount === 0) {
    md += `No server errors detected.\n\n`;
  } else {
    md += `${data.serverErrorCount} error(s) detected:\n\n\`\`\`\n${data.serverLog.slice(0, 5000)}\n\`\`\`\n\n`;
    if (data.serverLog.length > 5000) {
      md += `_(truncated — see server.log for full output)_\n\n`;
    }
  }

  if (data.tokenUsage) {
    md += `## Token Usage (Estimated)\n\n`;
    md += formatTokenUsage(data.tokenUsage);
    md += '\n';
  }

  // Environment
  md += `## Environment
- Browser: Chromium (${data.headless ? 'headless' : 'headed'})
- Viewport: ${data.viewport.width}x${data.viewport.height}
- Duration: ${data.durationSec} seconds
`;

  return md;
}

/**
 * Trim dead time from the beginning and end of the session video.
 *
 * Prefers session log timestamps (from `proofshot exec`) when available — these
 * give exact relative times for every action. Falls back to screenshot file
 * birth times when there's no session log.
 *
 * Buffers: 5s before first action, 3s after last action.
 */
export function trimVideo(
  videoPath: string,
  screenshots: string[],
  outputDir: string,
  sessionStartMs: number,
  sessionLog: SessionLogEntry[],
  mediaStartOffsetSec = 0,
): number {
  let firstActionSec: number | null = null;
  let lastActionSec: number | null = null;

  // Prefer session log timestamps (precise, not affected by stale files)
  if (sessionLog.length > 0) {
    firstActionSec =
      sessionLog[0].relativeTimeSec - mediaStartOffsetSec;
    lastActionSec =
      sessionLog[sessionLog.length - 1].relativeTimeSec - mediaStartOffsetSec;
  } else if (screenshots.length > 0) {
    // Fallback: use screenshot file birth times (only files created AFTER session start)
    const timestamps = screenshots
      .map((f) => {
        try {
          return fs.statSync(path.join(outputDir, f)).birthtimeMs;
        } catch {
          return null;
        }
      })
      .filter(
        (timestamp): timestamp is number =>
          timestamp !== null &&
          timestamp >= sessionStartMs + mediaStartOffsetSec * 1000,
      );

    if (timestamps.length === 0) return 0;

    firstActionSec =
      (Math.min(...timestamps) - sessionStartMs) / 1000 -
      mediaStartOffsetSec;
    lastActionSec =
      (Math.max(...timestamps) - sessionStartMs) / 1000 -
      mediaStartOffsetSec;
  }

  if (firstActionSec === null || lastActionSec === null) return 0;

  const BUFFER_BEFORE = 5;
  const BUFFER_AFTER = 3;

  const timelineTrimOffsetSec = Math.max(0, firstActionSec - BUFFER_BEFORE);
  const trimEndSec = lastActionSec + BUFFER_AFTER;
  const requestedDurationSec = trimEndSec - timelineTrimOffsetSec;

  // Don't trim very short videos
  if (requestedDurationSec < 5) return 0;

  // Check if ffmpeg is available
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    console.log(chalk.dim('Tip: Install ffmpeg to auto-trim dead time from videos.'));
    return 0;
  }

  const mediaDurationSec = probeMediaDuration(videoPath);
  const actionDurationSec = Math.max(0, lastActionSec - firstActionSec);
  const maximumPhysicalTrimSec =
    mediaDurationSec === null
      ? timelineTrimOffsetSec
      : Math.max(0, mediaDurationSec - actionDurationSec - BUFFER_BEFORE);
  const physicalTrimStartSec = Math.min(
    timelineTrimOffsetSec,
    maximumPhysicalTrimSec,
  );
  const trimDurationSec =
    mediaDurationSec === null
      ? requestedDurationSec
      : Math.min(
          requestedDurationSec,
          mediaDurationSec - physicalTrimStartSec,
        );

  // Trim the video
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  const rawPath = path.join(dir, `${base}-raw${ext}`);

  try {
    // Rename original to -raw
    fs.renameSync(videoPath, rawPath);

    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-ss',
        physicalTrimStartSec.toFixed(2),
        '-i',
        rawPath,
        '-t',
        trimDurationSec.toFixed(2),
        '-map',
        '0:v:0',
        '-c:v',
        'libvpx-vp9',
        '-deadline',
        'realtime',
        '-cpu-used',
        '8',
        '-crf',
        '30',
        '-b:v',
        '0',
        '-an',
        '-avoid_negative_ts',
        'make_zero',
        '-abort_on',
        'empty_output',
        videoPath,
      ],
      { stdio: 'pipe', timeout: 60000 },
    );
    validateVideo(videoPath);

    // Remove raw file on success
    fs.unlinkSync(rawPath);
    const trimmedDuration = Math.round(trimDurationSec);
    console.log(chalk.dim(`Trimmed video to ${trimmedDuration}s (removed dead time)`));
    return timelineTrimOffsetSec;
  } catch {
    // Restore original if trimming failed
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }
    if (fs.existsSync(rawPath)) {
      fs.renameSync(rawPath, videoPath);
    }
    console.log(chalk.dim('Video trimming failed, keeping original'));
    return 0;
  }
}

export function convertVideoToMp4(videoPath: string): string {
  if (path.extname(videoPath).toLowerCase() === '.mp4') {
    return videoPath;
  }

  const directory = path.dirname(videoPath);
  const basename = path.basename(videoPath, path.extname(videoPath));
  const mp4Path = path.join(directory, `${basename}.mp4`);

  if (fs.existsSync(mp4Path)) {
    if (fs.statSync(mp4Path).size > 0) {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
      return mp4Path;
    }
    fs.unlinkSync(mp4Path);
  }

  if (!fs.existsSync(videoPath)) {
    return videoPath;
  }

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    console.log(chalk.dim('Tip: Install ffmpeg to finalize recordings as MP4.'));
    return videoPath;
  }

  const temporaryPath = path.join(
    directory,
    `${basename}.${process.pid}.${randomUUID()}.tmp.mp4`,
  );
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        videoPath,
        '-map',
        '0:v:0',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        '-abort_on',
        'empty_output',
        temporaryPath,
      ],
      { stdio: 'pipe', timeout: 60000 },
    );
    validateVideo(temporaryPath);
    fs.renameSync(temporaryPath, mp4Path);
    fs.unlinkSync(videoPath);
    console.log(chalk.dim('Converted finalized video to MP4'));
    return mp4Path;
  } catch {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    if (fs.existsSync(mp4Path)) {
      fs.unlinkSync(mp4Path);
    }
    console.log(chalk.dim('MP4 conversion failed, keeping WebM recording'));
    return videoPath;
  }
}

function validateVideo(videoPath: string): void {
  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
    throw new Error('FFmpeg produced an empty video');
  }

  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', videoPath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'],
    { stdio: 'pipe', timeout: 60000 },
  );
}
