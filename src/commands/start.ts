import * as path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import { ensureDevServer } from '../server/start.js';
import { getPageUrl, openBrowser } from '../browser/session.js';
import {
  preparePrivateNetworkEvidence,
  startPrivateNetworkCapture,
} from '../browser/evidence.js';
import {
  sanitizeDiagnosticMessage,
  sanitizePageUrl,
} from '../browser/provenance.js';
import {
  loadIsolatedAgentBrowserConfig,
  resolveAgentBrowserRuntime,
  writeIsolatedAgentBrowserConfig,
} from '../browser/isolation.js';
import { startRecording } from '../browser/capture.js';
import {
  assertSafeAgentBrowserRecordingPlatform,
  prepareQuietFfmpegWrapper,
} from '../browser/ffmpeg-wrapper.js';
import { discoverBrowserExecutable, browserSetupError } from '../browser/discovery.js';
import {
  captureAgentBrowserProcessIdentity,
  prepareAgentBrowserSocketDir,
  resolveAgentBrowserRuntimeDir,
} from '../browser/runtime.js';
import { ensureOutputDir, generateTimestamp, generateSessionDirName } from '../artifacts/bundle.js';
import {
  generateAgentBrowserNamespace,
  generateAgentBrowserSessionName,
  resolveSessionControlDir,
  type SessionState,
} from '../session/state.js';
import { backfillSessionAgentBrowserRuntime } from '../session/browser-runtime.js';
import {
  canAddressOwnedBrowserSession,
  cleanupFailedStart,
} from '../session/lifecycle.js';
import {
  claimSessionOperation,
  registerSession,
  releaseSessionOperation,
  sessionHasLiveOperation,
  unregisterSession,
} from '../session/registry.js';
import {
  listSessionsForControlDir,
  sessionHasVerifiedLiveOwnership,
} from '../session/selection.js';
import { writeMetadata } from '../session/metadata.js';
import {
  captureGitProvenance,
  resolveGitRepositoryRoot,
} from '../session/manifest.js';
import { startOwnedEnvironment } from '../environment/runtime.js';

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

export type StartReceipt = {
  sessionId: string;
  sessionDir: string;
};

export async function startCommand(
  options: StartOptions,
): Promise<StartReceipt | undefined> {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);

  if (options.force) {
    const existingSessions = listSessionsForControlDir(controlDir);
    const operationSessions = existingSessions.filter((session) =>
      sessionHasLiveOperation(session),
    );
    if (operationSessions.length > 0) {
      console.error(
        chalk.red('✗') +
          ' --force cannot take over a live ProofShot operation.\n' +
          chalk.dim(
            `  ${operationSessions[0].sessionName} is still ${operationSessions[0].operationLease?.kind || 'running'}.`,
          ),
      );
      process.exit(1);
      return;
    }
    const liveSessions = existingSessions.filter(
      (session) =>
        sessionHasVerifiedLiveOwnership(session) ||
        canAddressOwnedBrowserSession(session),
    );
    if (liveSessions.length > 0) {
      console.error(
        chalk.red('✗') +
          ' --force cannot clean a verified live ProofShot session.\n' +
          chalk.dim(
            `  Stop it explicitly with --session ${liveSessions[0].sessionName}.`,
          ),
      );
      process.exit(1);
      return;
    }
    for (const existingSession of existingSessions) {
      let recoveryLease;
      try {
        recoveryLease = claimSessionOperation(existingSession, 'recovery');
      } catch (error) {
        console.error(
          chalk.red('✗') +
            ` Could not claim recovery for ${existingSession.sessionName}: ${sanitizeErrorMessage(error)}`,
        );
        process.exit(1);
        return;
      }
      try {
        if (backfillSessionAgentBrowserRuntime(existingSession)) {
          registerSession(existingSession);
        }
        setAgentBrowserDefaults({
          allowedDomains: existingSession.agentBrowserAllowedDomains,
          configPath:
            existingSession.agentBrowserConfigPath || config.browser.configPath,
          executablePath: existingSession.agentBrowserExecutablePath,
          namespace: existingSession.agentBrowserNamespace,
          socketDir:
            existingSession.agentBrowserSocketRoot ||
            existingSession.agentBrowserSocketDir,
        });
        await cleanupFailedStart(existingSession);
        releaseSessionOperation(existingSession, recoveryLease);
        unregisterSession(existingSession.sessionName);
      } catch (error) {
        existingSession.lifecycleStatus = 'recovery';
        existingSession.cleanupError =
          error instanceof Error ? error.message : String(error);
        registerSession(existingSession);
        console.error(
          chalk.red('✗') +
            ` Could not recover ${existingSession.sessionName}: ${sanitizeDiagnosticMessage(existingSession.cleanupError) || 'cleanup failed'}`,
        );
        process.exit(1);
        return;
      } finally {
        if (existingSession.operationLease?.id === recoveryLease.id) {
          releaseSessionOperation(existingSession, recoveryLease);
        }
      }
    }
    if (existingSessions.length > 0) {
      console.log(
        chalk.yellow('⚠') + chalk.dim(' Cleaned up stale session state'),
      );
    }
  }

  if (options.port) config.devServer.port = options.port;
  if (options.output) config.output = options.output;
  if (options.headed !== undefined) config.headless = !options.headed;

  const baseUrl = `http://localhost:${config.devServer.port}`;
  const openUrl = options.url || baseUrl;
  const agentBrowserAllowedDomains = resolveAgentBrowserAllowedDomains(
    openUrl,
    config.browser.allowedDomains,
  );
  const requestedOutputDir = path.resolve(config.output);
  const timestamp = generateTimestamp();
  const sessionName = generateAgentBrowserSessionName(timestamp);
  const sessionDirName = generateSessionDirName(timestamp, options.description || null);
  const agentBrowserNamespace = generateAgentBrowserNamespace(sessionName);
  let socketRoot: string;
  let socketDir: string;
  let browserExecutable: string | null;
  let agentBrowserExecutablePath: string;
  let agentBrowserExecutableSha256: string;
  let agentBrowserVersion: string;
  let agentBrowserRuntime: ReturnType<typeof resolveAgentBrowserRuntime>;
  let isolatedAgentBrowserConfig: Record<string, unknown>;
  let ffmpegWrapperDirectory: string;

  try {
    assertSafeAgentBrowserRecordingPlatform();
    const preparedFfmpegWrapperDirectory = prepareQuietFfmpegWrapper();
    if (!preparedFfmpegWrapperDirectory) {
      throw new Error('Could not prepare the quiet FFmpeg wrapper for recording.');
    }
    ffmpegWrapperDirectory = preparedFfmpegWrapperDirectory;
    isolatedAgentBrowserConfig = loadIsolatedAgentBrowserConfig(
      config.browser.configPath,
    );
    agentBrowserRuntime = resolveAgentBrowserRuntime();
    agentBrowserExecutablePath = agentBrowserRuntime.executablePath;
    agentBrowserExecutableSha256 = agentBrowserRuntime.sha256;
    agentBrowserVersion = agentBrowserRuntime.version;
    socketRoot = prepareAgentBrowserSocketDir(
      sessionName,
      process.env,
      undefined,
      agentBrowserNamespace,
    );
    socketDir = resolveAgentBrowserRuntimeDir(
      socketRoot,
      agentBrowserNamespace,
    );
    browserExecutable = discoverBrowserExecutable({
      configuredPath: options.browserExecutable || config.browser.executablePath,
    });
    if (!browserExecutable) {
      throw browserSetupError();
    }
  } catch (error: unknown) {
    console.error(
      chalk.red('✗') +
        ` Browser preflight failed: ${sanitizeErrorMessage(error)}`,
    );
    process.exit(1);
    return;
  }

  if (browserExecutable) config.browser.executablePath = browserExecutable;

  const outputDir = ensureOutputDir(requestedOutputDir);
  const sessionDir = ensureOutputDir(
    path.join(outputDir, `${sessionDirName}_${sessionName}`),
  );

  // agent-browser's WebM path uses single-threaded VP8 encoding and can fall
  // far behind during ordinary model pauses. MP4 uses its real-time x264 path
  // and remains bounded at stop time.
  const videoPath = path.join(sessionDir, 'session.mp4');
  const networkEvidence = preparePrivateNetworkEvidence(sessionDir);
  const serverErrorLog = path.join(
    path.dirname(networkEvidence.privateDirectory),
    'server.log',
  );
  const agentBrowserConfigPath = writeIsolatedAgentBrowserConfig(
    networkEvidence.privateDirectory,
    isolatedAgentBrowserConfig,
  );
  const privateEnvironmentDirectory = ensureOutputDir(
    path.join(sessionDir, 'private', 'environment'),
  );
  setAgentBrowserDefaults({
    allowedDomains: agentBrowserAllowedDomains,
    configPath: agentBrowserConfigPath,
    executablePath: agentBrowserExecutablePath,
    ffmpegWrapperDirectory,
    namespace: agentBrowserNamespace,
    socketDir: socketRoot,
  });

  const provenance = captureGitProvenance(process.cwd(), [outputDir]);
  const repositoryRoot = provenance.repository
    ? resolveGitRepositoryRoot(process.cwd())
    : process.cwd();

  writeMetadata(sessionDir, {
    ...provenance,
    repositoryRoot,
    startedAt: new Date().toISOString(),
    description:
      sanitizeDiagnosticMessage(options.description) || null,
  });

  const session: SessionState = {
    startedAt: new Date().toISOString(),
    startDirectory: process.cwd(),
    controlDir,
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
    recordingAttempted: false,
    recordingActive: false,
    browserLaunchAttempted: false,
    bundleComplete: false,
    browserRetained: false,
    videoTrimComplete: false,
    trimOffsetSec: 0,
    sessionLogAdjusted: false,
    consoleEvidenceAvailable: false,
    consoleErrorCount: 0,
    targetUrl: sanitizePageUrl(openUrl) || openUrl,
    headless: config.headless,
    agentBrowserSocketDir: socketDir,
    agentBrowserSocketRoot: socketRoot,
    agentBrowserNamespace,
    agentBrowserAllowedDomains,
    agentBrowserConfigPath,
    agentBrowserExecutablePath,
    agentBrowserExecutableSha256,
    agentBrowserRuntime,
    agentBrowserVersion,
    privateEvidenceDir: networkEvidence.privateDirectory,
    networkHarPath: networkEvidence.harPath,
    networkRequestsPath: networkEvidence.requestsPath,
    networkSummaryPath: networkEvidence.summaryPath,
    networkCaptureStarted: false,
    networkCaptureActive: false,
    networkEvidenceAvailable: false,
    networkCaptureError: null,
    serverProcess: null,
    browserProcess: null,
    environment: null,
    viewport: { width: config.viewport.width, height: config.viewport.height },
  };
  const startLease = claimSessionOperation(session, 'start');
  const signalHandlers = installStartSignalHandlers(session, startLease);

  let failureContext = 'start the session';
  try {
    if (options.run && config.environment) {
      throw new Error('Use either --run or config.environment, not both.');
    }
    if (config.environment || (config.logs?.sources || []).some((source) => source.kind === 'file')) {
      failureContext = 'start environment';
      session.environment = await startOwnedEnvironment(
        config.environment,
        config.logs || {},
        privateEnvironmentDirectory,
        sessionName,
        new Date(session.startedAt).getTime(),
        (environmentState) => {
          session.environment = environmentState;
          persistOwnedSession(session);
        },
      );
      console.log(chalk.green('✓') + ' Environment and log capture started');
    }
    if (options.run) {
      failureContext = 'start dev server';
      console.log(chalk.dim('Starting dev server command...'));
      const server = await ensureDevServer(
        options.run,
        config.devServer.port,
        config.devServer.startupTimeout,
        serverErrorLog,
        (startedServer) => {
          session.serverAlreadyRunning = false;
          session.serverProcess = startedServer.process;
          persistOwnedSession(session);
        },
      );
      session.serverAlreadyRunning = false;
      session.serverProcess = server.process;
      persistOwnedSession(session);
      console.log(chalk.green('✓') + ` Dev server started on :${config.devServer.port}`);
      console.log(chalk.dim(`  Server logs → ${serverErrorLog}`));
    } else if (!config.environment) {
      console.log(chalk.dim('No --run provided, assuming server is already running'));
    }

    failureContext = 'open browser';
    console.log(chalk.dim('Opening browser...'));
    session.browserLaunchAttempted = true;
    persistOwnedSession(session);
    openBrowser(openUrl, config.viewport, config.headless, sessionName, config.browser);
    session.browserProcess = captureAgentBrowserProcessIdentity(socketDir, sessionName);
    if (!session.browserProcess) {
      throw new Error(
        `Could not record the exact agent-browser daemon identity for session ${sessionName}.`,
      );
    }
    session.targetUrl =
      sanitizePageUrl(getPageUrl(sessionName) || openUrl) || openUrl;
    persistOwnedSession(session);
    console.log(chalk.green('✓') + ' Browser ready');

    failureContext = 'start private network capture';
    session.networkCaptureActive = true;
    persistOwnedSession(session);
    startPrivateNetworkCapture(sessionName);
    session.networkCaptureStarted = true;
    persistOwnedSession(session);
    console.log(chalk.green('✓') + ' Private network capture started');

    failureContext = 'initialize recording';
    const RECORDING_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;
    let recordingStarted = false;
    let lastError: any;
    session.recordingAttempted = true;
    persistOwnedSession(session);

    for (let attempt = 1; attempt <= RECORDING_RETRIES; attempt++) {
      try {
        startRecording(videoPath, sessionName);
        session.recordingStartedAt = new Date().toISOString();
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
  } catch (error: unknown) {
    if (signalHandlers.isHandling()) {
      return;
    }
    signalHandlers.remove();
    const interruptionSignal = getTerminationSignal(error);
    try {
      await cleanupFailedStart(session);
      releaseSessionOperation(session, startLease);
      clearOwnedSession(session);
      console.error(
        chalk.red('✗') +
          ` Failed to ${failureContext}: ${sanitizeErrorMessage(error)}\n` +
          chalk.dim('All processes started by this ProofShot attempt were cleaned up.'),
      );
    } catch (cleanupError) {
      session.lifecycleStatus = 'recovery';
      session.cleanupError =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      persistOwnedSession(session);
      if (session.operationLease?.id === startLease.id) {
        releaseSessionOperation(session, startLease);
      }
      console.error(
        chalk.red('✗') +
          ` Failed to ${failureContext}: ${sanitizeErrorMessage(error)}\n` +
          chalk.yellow(
            `Cleanup is incomplete: ${sanitizeDiagnosticMessage(session.cleanupError) || 'cleanup failed'}\n`,
          ) +
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
  persistOwnedSession(session);
  releaseSessionOperation(session, startLease);
  signalHandlers.remove();

  console.log('');
  console.log(chalk.green.bold('✅ ProofShot session started'));
  console.log('');
  console.log(`Server:     ${options.run ? chalk.cyan('ProofShot-owned') : chalk.dim('external')} on :${config.devServer.port}`);
  console.log(`Browser:    Chromium (${config.headless ? 'headless' : 'headed'})`);
  console.log(`Session:    ${chalk.dim(sessionName)}`);
  console.log(`Target:     ${chalk.dim(sanitizePageUrl(openUrl) || '[REDACTED_URL]')}`);
  console.log(`Recording:  ${chalk.dim(videoPath)}`);
  console.log(`Errors log: ${chalk.dim(serverErrorLog)}`);

  if (options.description) {
    console.log(
      `Verifying:  ${chalk.white(sanitizeDiagnosticMessage(options.description) || '[REDACTED]')}`,
    );
  }

  console.log('');
  console.log(chalk.dim('Use proofshot exec to navigate and test:'));
  console.log(chalk.dim('  proofshot exec snapshot -i            # See interactive elements'));
  console.log(chalk.dim('  proofshot exec click @e3              # Click an element'));
  console.log(chalk.dim('  proofshot exec fill @e2 "text"        # Fill a form field'));
  console.log(chalk.dim('  proofshot exec screenshot step.png    # Capture a moment'));
  console.log('');
  console.log(`When done, run: ${chalk.white('proofshot stop')}`);
  return { sessionId: sessionName, sessionDir };
}

export function resolveAgentBrowserAllowedDomains(
  targetUrl: string,
  configuredDomains: string[] = [],
): string[] {
  const normalizedTarget = targetUrl.includes('://')
    ? targetUrl
    : `http://${targetUrl}`;
  const targetDomain = new URL(normalizedTarget).hostname;
  return [...new Set([targetDomain, ...configuredDomains])].sort();
}

function persistOwnedSession(session: SessionState): void {
  registerSession(session);
}

function clearOwnedSession(session: SessionState): void {
  unregisterSession(session.sessionName);
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeDiagnosticMessage(message) || 'operation failed';
}

function installStartSignalHandlers(
  session: SessionState,
  lease: NonNullable<SessionState['operationLease']>,
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
          releaseSessionOperation(session, lease);
          clearOwnedSession(session);
          process.exit(signal === 'SIGINT' ? 130 : 143);
        })
        .catch((error) => {
          session.lifecycleStatus = 'recovery';
          session.cleanupError = error instanceof Error ? error.message : String(error);
          persistOwnedSession(session);
          if (session.operationLease?.id === lease.id) {
            releaseSessionOperation(session, lease);
          }
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
