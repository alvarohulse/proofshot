import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import { getConsoleErrors, getConsoleOutput, getConsoleOutputJson } from '../browser/session.js';
import { stopRecording } from '../browser/capture.js';
import {
  loadSession,
  clearSession,
  resolveSessionControlDir,
  saveSession,
  type SessionState,
} from '../session/state.js';
import {
  canAddressOwnedBrowserSession,
  stopOwnedBrowser,
  stopOwnedServer,
} from '../session/lifecycle.js';
import { registerSession, unregisterSession } from '../session/registry.js';
import { writeViewer, type TimestampedLogEntry } from '../artifacts/viewer.js';
import { extractServerErrors } from '../utils/error-patterns.js';
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
}

export async function stopCommand(options: StopOptions): Promise<void> {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);

  // Load session state
  const session = loadSession(controlDir);
  if (!session) {
    console.log(
      chalk.dim('No active session found; all owned processes are already stopped.'),
    );
    return;
  }
  setAgentBrowserDefaults({
    configPath: session.agentBrowserConfigPath || config.browser.configPath,
    socketDir: session.agentBrowserSocketDir,
  });

  if (session.bundleComplete) {
    if (session.browserRetained && !options.noClose) {
      console.log(chalk.dim('Closing retained browser...'));
      const browserSessionAddressable = canAddressOwnedBrowserSession(session);
      await stopOwnedBrowser(session);
      session.browserRetained = false;
      clearOwnedSession(session, controlDir);
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
      clearOwnedSession(session, controlDir);
      console.log(chalk.dim('Proof artifacts are already bundled and all owned processes are stopped.'));
    }
    return;
  }

  session.lifecycleStatus = 'stopping';
  session.cleanupError = null;
  persistOwnedSession(session, controlDir);
  const retryingStoppedSession = !session.recordingActive;
  const recordingWasActive = session.recordingActive;
  const startTime = new Date(session.startedAt).getTime();
  const durationMs = Date.now() - startTime;
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
    } catch {
      // Browser may already be closed
    }
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
    persistOwnedSession(session, controlDir);
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
  }

  // Step 2: Stop recording
  console.log(chalk.dim('Stopping recording...'));
  if (browserSessionAvailable) {
    stopRecording(session.sessionName);
  }
  session.recordingActive = false;
  persistOwnedSession(session, controlDir);

  // Step 3: Close browser (unless --no-close)
  let cleanupError: unknown;
  if (!options.noClose) {
    console.log(chalk.dim('Closing browser...'));
    try {
      await stopOwnedBrowser(session);
    } catch (error) {
      cleanupError = error;
    }
  }

  // Step 3.5: Stop only the detached process session created by this start.
  if (session.serverProcess) {
    console.log(chalk.dim('Stopping dev server...'));
    try {
      await stopOwnedServer(session);
    } catch (error) {
      cleanupError ||= error;
    }
  }
  if (cleanupError) {
    session.lifecycleStatus = 'recovery';
    session.cleanupError =
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    persistOwnedSession(session, controlDir);
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
  let trimOffsetSec = session.trimOffsetSec ?? 0;
  if (!session.videoTrimComplete) {
    if (fs.existsSync(session.videoPath)) {
      trimOffsetSec = trimVideo(session.videoPath, screenshots, sessionDir, startTime, sessionLog);
    } else if (recordingWasActive) {
      console.log(
        chalk.yellow('⚠') +
          ' Recording was active but no video file was produced.\n' +
          chalk.dim('  The screencast may have been interrupted. Screenshots and logs are still saved.'),
      );
    }
    session.videoTrimComplete = true;
    session.trimOffsetSec = trimOffsetSec;
    persistOwnedSession(session, controlDir);
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
    persistOwnedSession(session, controlDir);
  }

  // Extract errors from server log using multi-language patterns
  const serverErrorLines = extractServerErrors(serverLog);
  const serverErrorCount = serverErrorLines.length;

  // Step 6.5: Estimate token usage
  const tokenUsage = estimateTokenUsage(session.sessionDir, startTime, Date.now());

  // Step 7: Generate SUMMARY.md
  const summaryPath = path.join(sessionDir, 'SUMMARY.md');
  const summary = generateProofSummary({
    projectDirectory: session.startDirectory || process.cwd(),
    description: session.description,
    serverCommand: session.serverCommand,
    port: session.port,
    headless: session.headless ?? config.headless ?? true,
    viewport: session.viewport || config.viewport || { width: 1280, height: 720 },
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
    persistOwnedSession(session, controlDir);
  }

  // Apply trimOffsetSec to log entries (same adjustment as session log)
  const adjustTime = (e: TimestampedLogEntry): TimestampedLogEntry =>
    trimOffsetSec > 0
      ? { ...e, relativeTimeSec: parseFloat((e.relativeTimeSec - trimOffsetSec).toFixed(1)) }
      : e;

  const viewerConsoleEntries = consoleEntries.map(adjustTime);
  const viewerServerEntries = serverEntries.map(adjustTime);

  const viewerPath = writeViewer(sessionDir, {
    description: session.description,
    serverCommand: session.serverCommand,
    durationSec,
    videoFilename: fs.existsSync(session.videoPath) ? path.basename(session.videoPath) : null,
    consoleErrorCount,
    consoleEvidenceAvailable,
    serverErrorCount,
    consoleOutput,
    serverLog,
    consoleEntries: viewerConsoleEntries.length > 0 ? viewerConsoleEntries : undefined,
    serverEntries: viewerServerEntries.length > 0 ? viewerServerEntries : undefined,
    entries: viewerEntries.length > 0 ? viewerEntries : undefined,
    tokenUsage,
  });

  // Step 8: Retain exact browser ownership only when explicitly requested.
  session.bundleComplete = true;
  session.browserRetained = Boolean(options.noClose);
  if (session.browserRetained) {
    session.lifecycleStatus = 'active';
    persistOwnedSession(session, controlDir);
  } else {
    clearOwnedSession(session, controlDir);
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

function persistOwnedSession(session: SessionState, controlDir: string): void {
  saveSession(session, controlDir);
  registerSession(session);
}

function clearOwnedSession(session: SessionState, controlDir: string): void {
  clearSession(controlDir);
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
  recordingStartMs: number,
  sessionLog: SessionLogEntry[],
): number {
  let firstActionSec: number | null = null;
  let lastActionSec: number | null = null;

  // Prefer session log timestamps (precise, not affected by stale files)
  if (sessionLog.length > 0) {
    firstActionSec = sessionLog[0].relativeTimeSec;
    lastActionSec = sessionLog[sessionLog.length - 1].relativeTimeSec;
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
      .filter((t): t is number => t !== null && t >= recordingStartMs);

    if (timestamps.length === 0) return 0;

    firstActionSec = (Math.min(...timestamps) - recordingStartMs) / 1000;
    lastActionSec = (Math.max(...timestamps) - recordingStartMs) / 1000;
  }

  if (firstActionSec === null || lastActionSec === null) return 0;

  const BUFFER_BEFORE = 5;
  const BUFFER_AFTER = 3;

  const trimStartSec = Math.max(0, firstActionSec - BUFFER_BEFORE);
  const trimEndSec = lastActionSec + BUFFER_AFTER;

  // Don't trim very short videos
  if (trimEndSec - trimStartSec < 5) return 0;

  // Check if ffmpeg is available
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    console.log(chalk.dim('Tip: Install ffmpeg to auto-trim dead time from videos.'));
    return 0;
  }

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
        '-i',
        rawPath,
        '-ss',
        trimStartSec.toFixed(2),
        '-to',
        trimEndSec.toFixed(2),
        '-c',
        'copy',
        '-abort_on',
        'empty_output',
        videoPath,
      ],
      { stdio: 'pipe', timeout: 60000 },
    );
    validateTrimmedVideo(videoPath);

    // Remove raw file on success
    fs.unlinkSync(rawPath);
    const trimmedDuration = Math.round(trimEndSec - trimStartSec);
    console.log(chalk.dim(`Trimmed video to ${trimmedDuration}s (removed dead time)`));
    return trimStartSec;
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

function validateTrimmedVideo(videoPath: string): void {
  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
    throw new Error('FFmpeg produced an empty video');
  }

  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', videoPath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'],
    { stdio: 'pipe', timeout: 60000 },
  );
}
