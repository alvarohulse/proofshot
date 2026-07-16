import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { loadConfig } from '../utils/config.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import {
  DevServerStartError,
  ensureDevServer,
  type ServerStartResult,
} from '../server/start.js';
import { closeBrowser, openBrowser } from '../browser/session.js';
import { startRecording } from '../browser/capture.js';
import { ensureOutputDir, generateTimestamp, generateSessionDirName } from '../artifacts/bundle.js';
import {
  saveSession,
  hasActiveSession,
  clearSession,
  loadSession,
  reserveOutputSession,
  generateAgentBrowserSessionName,
  type SessionState,
} from '../session/state.js';
import {
  listRegisteredSessions,
  registerSession,
  reserveSession,
  unregisterSession,
} from '../session/registry.js';
import {
  discardSession,
  isSessionStillStarting,
} from '../session/lifecycle.js';
import { writeMetadata } from '../session/metadata.js';
import { isProcessRunning, terminateProcessTree } from '../utils/process.js';

interface StartOptions {
  description?: string;
  port?: number;
  run?: string;
  headed?: boolean;
  output?: string;
  url?: string;
  force?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const config = loadConfig();
  setAgentBrowserDefaults({ configPath: config.browser.configPath });
  if (options.port) config.devServer.port = options.port;
  if (options.output) config.output = options.output;
  if (options.headed !== undefined) config.headless = !options.headed;

  const outputDir = path.resolve(config.output);
  const timestamp = generateTimestamp();
  const registeredSession = listRegisteredSessions().find(
    (session) => path.resolve(session.outputDir) === outputDir,
  );
  const existingSession = registeredSession || loadSession(outputDir);

  if (existingSession || hasActiveSession(outputDir)) {
    if (options.force) {
      if (existingSession) {
        if (isSessionStillStarting(existingSession)) {
          console.log(
            chalk.yellow('⚠ A session is still starting.') +
              chalk.dim(' Wait for it to finish or stop its ProofShot process first.'),
          );
          return;
        }
        try {
          discardSession(existingSession);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red('✗') + ` Could not clear stale session: ${message}`);
          process.exit(1);
        }
      } else {
        clearSession(outputDir);
      }
      console.log(chalk.yellow('⚠') + chalk.dim(' Cleared stale session'));
    } else {
      console.log(
        chalk.yellow('⚠ A session is already active.') +
          chalk.dim(' Run "proofshot stop" first, or use --force to override.'),
      );
      return;
    }
  }

  ensureOutputDir(outputDir);

  const sessionSuffix = randomUUID().slice(0, 8);
  const sessionDirName = `${generateSessionDirName(timestamp, options.description || null)}-${sessionSuffix}`;
  const sessionDir = path.join(outputDir, sessionDirName);
  const sessionName = generateAgentBrowserSessionName(`${timestamp}-${sessionSuffix}`);
  ensureOutputDir(sessionDir);

  const videoPath = path.join(sessionDir, 'session.webm');
  const serverErrorLog = path.join(sessionDir, 'server.log');

  let branch = '';
  let commitSha = '';
  try {
    branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Non-fatal outside a git repo.
  }
  try {
    commitSha = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Non-fatal outside a git repo.
  }

  writeMetadata(sessionDir, {
    branch,
    commitSha,
    startedAt: new Date().toISOString(),
    description: options.description || null,
  });

  const session: SessionState = {
    startedAt: new Date().toISOString(),
    startDirectory: process.cwd(),
    lifecycleStatus: 'starting',
    ownerPid: process.pid,
    description: options.description || null,
    outputDir,
    sessionDir,
    sessionName,
    browserConfigPath: config.browser.configPath || null,
    headless: config.headless,
    videoPath,
    serverErrorLog,
    port: config.devServer.port,
    serverCommand: options.run || null,
    serverOwnershipToken: null,
    serverProcessStartTime: null,
    serverPid: null,
    serverAlreadyRunning: options.run === undefined,
    recordingActive: false,
    viewport: { width: config.viewport.width, height: config.viewport.height },
  };

  try {
    reserveSession(session);
  } catch (error) {
    throw error;
  }
  try {
    reserveOutputSession(outputDir, sessionName);
  } catch (error) {
    unregisterSession(sessionName);
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
    console.log(
      chalk.yellow('⚠ A session is already active.') +
        chalk.dim(' Run "proofshot stop" first, or use --force to override.'),
    );
    return;
  }

  if (options.run) {
    console.log(chalk.dim(`Starting: ${options.run}`));
    try {
      const server = await ensureDevServer(
        options.run,
        config.devServer.port,
        config.devServer.startupTimeout,
        serverErrorLog,
        (spawnedServer) => {
          applyServerState(session, spawnedServer);
          registerSession(session);
        },
      );
      applyServerState(session, server);
      registerSession(session);
      console.log(chalk.green('✓') + ` Dev server started on :${config.devServer.port}`);
      console.log(chalk.dim(`  Server logs → ${serverErrorLog}`));
    } catch (error) {
      if (error instanceof DevServerStartError && error.recoveryState !== null) {
        applyServerState(session, error.recoveryState);
        persistRecoverySession(session);
      } else {
        unregisterSession(sessionName);
        clearSession(outputDir, sessionName);
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red('✗') + ` Failed to start dev server: ${message}`);
      process.exit(1);
    }
  } else {
    console.log(chalk.dim('No --run provided, assuming server is already running'));
  }

  const baseUrl = `http://localhost:${config.devServer.port}`;
  const openUrl = options.url || baseUrl;

  console.log(chalk.dim('Opening browser...'));
  try {
    openBrowser(openUrl, config.viewport, config.headless, sessionName, config.browser);
    console.log(chalk.green('✓') + ' Browser ready');
  } catch (error: any) {
    closeBrowser(sessionName);
    const cleanupComplete = cleanupFailedSession(session);
    console.error(
      chalk.red('✗') +
        ` Failed to open browser: ${error.message}\n` +
        chalk.dim('Make sure agent-browser is installed: npm install -g agent-browser') +
        (cleanupComplete
          ? ''
          : chalk.dim('\nServer cleanup failed; recovery state was preserved.')),
    );
    process.exit(1);
  }

  const RECORDING_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;
  let recordingStarted = false;
  let lastError: any;

  for (let attempt = 1; attempt <= RECORDING_RETRIES; attempt++) {
    try {
      startRecording(videoPath, sessionName);
      recordingStarted = true;
      console.log(chalk.green('✓') + ' Recording started');
      break;
    } catch (error: any) {
      lastError = error;
      if (attempt < RECORDING_RETRIES) {
        console.log(
          chalk.yellow('⚠') +
            ` Recording failed (attempt ${attempt}/${RECORDING_RETRIES}), retrying in ${RETRY_DELAY_MS / 1000}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  if (!recordingStarted) {
    closeBrowser(sessionName);
    const cleanupComplete = cleanupFailedSession(session);
    console.error(
      chalk.red('✗') +
        ` Failed to initialize recording after ${RECORDING_RETRIES} attempts: ${lastError?.message}\n` +
        chalk.dim('Recording is required — ProofShot cannot proceed without video capture.\n') +
        chalk.dim('Troubleshooting:\n') +
        chalk.dim('  1. Make sure agent-browser is installed and running\n') +
        chalk.dim('  2. Try "proofshot clean" then re-run "proofshot start"\n') +
        chalk.dim('  3. If the port was already in use, stop the old server first') +
        (cleanupComplete
          ? ''
          : chalk.dim('\nServer cleanup failed; recovery state was preserved.')),
    );
    process.exit(1);
  }

  session.lifecycleStatus = 'active';
  session.ownerPid = null;
  session.recordingActive = true;
  try {
    saveSession(session);
    registerSession(session);
  } catch (error) {
    let cleanupComplete = false;
    try {
      discardSession(session);
      cleanupComplete = true;
    } catch {
      persistRecoverySession(session);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      chalk.red('✗') +
        ` Failed to persist session state: ${message}` +
        (cleanupComplete
          ? ''
          : chalk.dim('\nCleanup failed; recovery state was preserved.')),
    );
    process.exit(1);
  }

  console.log('');
  console.log(chalk.green.bold('✅ ProofShot session started'));
  console.log('');
  console.log(`Server:     ${options.run ? chalk.cyan(options.run) : chalk.dim('external')} on :${config.devServer.port}`);
  console.log(`Browser:    Chromium (${config.headless ? 'headless' : 'headed'})`);
  console.log(`Session:    ${chalk.dim(sessionName)}`);
  console.log(`Recording:  ${chalk.dim(videoPath)}`);
  console.log(`Errors log: ${chalk.dim(serverErrorLog)}`);

  if (options.description) {
    console.log(`Verifying:  ${chalk.white(options.description)}`);
  }

  console.log('');
  console.log(chalk.dim('Use proofshot exec to navigate and test:'));
  console.log(chalk.dim('  proofshot exec snapshot -i            # See interactive elements'));
  console.log(chalk.dim('  proofshot exec click @e3              # Click an element'));
  console.log(chalk.dim('  proofshot exec fill @e2 "text"        # Fill a form field'));
  console.log(chalk.dim('  proofshot exec screenshot step.png    # Capture a moment'));
  console.log('');
  console.log(`When done, run: ${chalk.white('proofshot stop')}`);

  function terminateStartedServer(pid: number | null): boolean {
    if (pid === null) {
      return true;
    }

    try {
      terminateProcessTree(pid);
    } catch {
      return !isProcessRunning(pid);
    }
    return !isProcessRunning(pid);
  }

  function cleanupFailedSession(failedSession: SessionState): boolean {
    if (!terminateStartedServer(failedSession.serverPid ?? null)) {
      persistRecoverySession(failedSession);
      return false;
    }

    try {
      unregisterSession(failedSession.sessionName);
      clearSession(failedSession.outputDir, failedSession.sessionName);
      return true;
    } catch {
      persistRecoverySession(failedSession);
      return false;
    }
  }

  function persistRecoverySession(recoverySession: SessionState): void {
    recoverySession.lifecycleStatus = 'stopped';
    recoverySession.ownerPid = null;
    recoverySession.recordingActive = false;
    try {
      saveSession(recoverySession);
    } catch {
      // The global registry remains the primary recovery record.
    }
    try {
      registerSession(recoverySession);
    } catch {
      // Preserve any provisional registry record already on disk.
    }
  }

  function applyServerState(
    targetSession: SessionState,
    server: ServerStartResult,
  ): void {
    targetSession.serverAlreadyRunning = server.alreadyRunning;
    targetSession.serverPid = server.pid;
    targetSession.serverOwnershipToken = server.ownershipToken;
    targetSession.serverProcessStartTime = server.processStartTime;
  }

  function isAlreadyExistsError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'EEXIST'
    );
  }
}
