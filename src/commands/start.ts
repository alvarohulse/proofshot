import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { loadConfig } from '../utils/config.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import { ensureDevServer } from '../server/start.js';
import { openBrowser } from '../browser/session.js';
import { startRecording } from '../browser/capture.js';
import { discoverBrowserExecutable, browserSetupError } from '../browser/discovery.js';
import {
  captureAgentBrowserProcessIdentity,
  prepareAgentBrowserSocketDir,
} from '../browser/runtime.js';
import { ensureOutputDir, generateTimestamp, generateSessionDirName } from '../artifacts/bundle.js';
import {
  saveSession,
  loadSession,
  hasActiveSession,
  clearSession,
  generateAgentBrowserSessionName,
  resolveSessionControlDir,
  type SessionState,
} from '../session/state.js';
import { cleanupFailedStart } from '../session/lifecycle.js';
import { registerSession, unregisterSession } from '../session/registry.js';
import { writeMetadata } from '../session/metadata.js';

interface StartOptions {
  description?: string;
  port?: number;
  run?: string;
  headed?: boolean;
  output?: string;
  url?: string;
  browserExecutable?: string;
  force?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);

  if (hasActiveSession(controlDir)) {
    if (options.force) {
      const existingSession = loadSession(controlDir);
      if (existingSession) {
        setAgentBrowserDefaults({
          configPath: existingSession.agentBrowserConfigPath || config.browser.configPath,
          socketDir: existingSession.agentBrowserSocketDir,
        });
        await cleanupFailedStart(existingSession);
        unregisterSession(existingSession.sessionName);
      }
      clearSession(controlDir);
      console.log(chalk.yellow('⚠') + chalk.dim(' Cleaned up the previous session'));
    } else {
      console.log(
        chalk.yellow('⚠ A session is already active.') +
          chalk.dim(' Run "proofshot stop" first, or use --force to override.'),
      );
      return;
    }
  }

  if (options.port) config.devServer.port = options.port;
  if (options.output) config.output = options.output;
  if (options.headed !== undefined) config.headless = !options.headed;

  const outputDir = path.resolve(config.output);
  const timestamp = generateTimestamp();
  const sessionDirName = generateSessionDirName(timestamp, options.description || null);
  const sessionDir = path.join(outputDir, sessionDirName);
  const sessionName = generateAgentBrowserSessionName(timestamp);
  let socketDir: string;
  let browserExecutable: string | null;

  try {
    socketDir = prepareAgentBrowserSocketDir(sessionName);
    browserExecutable = discoverBrowserExecutable({
      configuredPath: options.browserExecutable || config.browser.executablePath,
    });
    if (
      !browserExecutable &&
      !process.env.AGENT_BROWSER_PROVIDER &&
      !process.env.AGENT_BROWSER_CDP
    ) {
      throw browserSetupError();
    }
  } catch (error: any) {
    console.error(chalk.red('✗') + ` Browser preflight failed: ${error.message}`);
    process.exit(1);
    return;
  }

  if (browserExecutable) config.browser.executablePath = browserExecutable;
  setAgentBrowserDefaults({ configPath: config.browser.configPath, socketDir });

  ensureOutputDir(outputDir);
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

  const baseUrl = `http://localhost:${config.devServer.port}`;
  const openUrl = options.url || baseUrl;
  const session: SessionState = {
    startedAt: new Date().toISOString(),
    startDirectory: process.cwd(),
    lifecycleStatus: 'starting',
    cleanupError: null,
    description: options.description || null,
    outputDir,
    sessionDir,
    sessionName,
    videoPath,
    serverErrorLog,
    port: config.devServer.port,
    serverCommand: options.run || null,
    serverAlreadyRunning: !options.run,
    recordingActive: false,
    browserLaunchAttempted: false,
    bundleComplete: false,
    browserRetained: false,
    videoTrimComplete: false,
    trimOffsetSec: 0,
    sessionLogAdjusted: false,
    consoleEvidenceAvailable: false,
    consoleErrorCount: 0,
    targetUrl: openUrl,
    headless: config.headless,
    agentBrowserSocketDir: socketDir,
    agentBrowserConfigPath: config.browser.configPath,
    serverProcess: null,
    browserProcess: null,
    viewport: { width: config.viewport.width, height: config.viewport.height },
  };
  persistOwnedSession(session, controlDir);
  const signalHandlers = installStartSignalHandlers(session, controlDir);

  let failureContext = 'start the session';
  try {
    if (options.run) {
      failureContext = 'start dev server';
      console.log(chalk.dim(`Starting: ${options.run}`));
      const server = await ensureDevServer(
        options.run,
        config.devServer.port,
        config.devServer.startupTimeout,
        serverErrorLog,
        (startedServer) => {
          session.serverAlreadyRunning = false;
          session.serverProcess = startedServer.process;
          persistOwnedSession(session, controlDir);
        },
      );
      session.serverAlreadyRunning = false;
      session.serverProcess = server.process;
      persistOwnedSession(session, controlDir);
      console.log(chalk.green('✓') + ` Dev server started on :${config.devServer.port}`);
      console.log(chalk.dim(`  Server logs → ${serverErrorLog}`));
    } else {
      console.log(chalk.dim('No --run provided, assuming server is already running'));
    }

    failureContext = 'open browser';
    console.log(chalk.dim('Opening browser...'));
    session.browserLaunchAttempted = true;
    persistOwnedSession(session, controlDir);
    openBrowser(openUrl, config.viewport, config.headless, sessionName, config.browser);
    session.browserProcess = captureAgentBrowserProcessIdentity(socketDir, sessionName);
    if (!session.browserProcess) {
      throw new Error(
        `Could not record the exact agent-browser daemon identity for session ${sessionName}.`,
      );
    }
    persistOwnedSession(session, controlDir);
    console.log(chalk.green('✓') + ' Browser ready');

    failureContext = 'initialize recording';
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
      throw new Error(
        `Recording did not start after ${RECORDING_RETRIES} attempts: ${lastError?.message}`,
      );
    }
  } catch (error: any) {
    if (signalHandlers.isHandling()) {
      return;
    }
    signalHandlers.remove();
    const interruptionSignal = getTerminationSignal(error);
    try {
      await cleanupFailedStart(session);
      clearOwnedSession(session, controlDir);
      console.error(
        chalk.red('✗') +
          ` Failed to ${failureContext}: ${error.message}\n` +
          chalk.dim('All processes started by this ProofShot attempt were cleaned up.'),
      );
    } catch (cleanupError) {
      session.lifecycleStatus = 'recovery';
      session.cleanupError =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      persistOwnedSession(session, controlDir);
      console.error(
        chalk.red('✗') +
          ` Failed to ${failureContext}: ${error.message}\n` +
          chalk.yellow(`Cleanup is incomplete: ${session.cleanupError}\n`) +
          chalk.dim(`Run "proofshot session clean --session ${session.sessionName}" to retry.`),
      );
    }
    process.exit(
      interruptionSignal === 'SIGINT'
        ? 130
        : interruptionSignal === 'SIGTERM'
          ? 143
          : 1,
    );
    return;
  }

  session.recordingActive = true;
  session.lifecycleStatus = 'active';
  persistOwnedSession(session, controlDir);
  signalHandlers.remove();

  console.log('');
  console.log(chalk.green.bold('✅ ProofShot session started'));
  console.log('');
  console.log(`Server:     ${options.run ? chalk.cyan(options.run) : chalk.dim('external')} on :${config.devServer.port}`);
  console.log(`Browser:    Chromium (${config.headless ? 'headless' : 'headed'})`);
  console.log(`Session:    ${chalk.dim(sessionName)}`);
  console.log(`Target:     ${chalk.dim(openUrl)}`);
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
}

function persistOwnedSession(session: SessionState, controlDir: string): void {
  saveSession(session, controlDir);
  registerSession(session);
}

function clearOwnedSession(session: SessionState, controlDir: string): void {
  clearSession(controlDir);
  unregisterSession(session.sessionName);
}

function installStartSignalHandlers(
  session: SessionState,
  controlDir: string,
): { isHandling: () => boolean; remove: () => void } {
  let handlingSignal = false;
  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = (): void => {
      if (handlingSignal) {
        return;
      }
      handlingSignal = true;
      void cleanupFailedStart(session)
        .then(() => {
          clearOwnedSession(session, controlDir);
          process.exit(signal === 'SIGINT' ? 130 : 143);
        })
        .catch((error) => {
          session.lifecycleStatus = 'recovery';
          session.cleanupError = error instanceof Error ? error.message : String(error);
          persistOwnedSession(session, controlDir);
          process.exit(1);
        });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  return {
    isHandling: (): boolean => handlingSignal,
    remove: (): void => {
      for (const [signal, handler] of handlers) {
        process.removeListener(signal, handler);
      }
    },
  };
}

function getTerminationSignal(error: unknown): NodeJS.Signals | null {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return null;
    }
    const candidate = current as { cause?: unknown; signal?: unknown };
    if (candidate.signal === 'SIGINT' || candidate.signal === 'SIGTERM') {
      return candidate.signal;
    }
    current = candidate.cause;
  }
  return null;
}
