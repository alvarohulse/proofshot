import { finalizeRecording } from '../browser/capture.js';
import { finalizePrivateNetworkCapture } from '../browser/evidence.js';
import { sanitizeDiagnosticMessage } from '../browser/provenance.js';
import { stopOwnedEnvironment } from '../environment/runtime.js';
import {
  clearAgentBrowserSessionFiles,
  captureAgentBrowserProcessIdentity,
  waitForAgentBrowserProcessIdentity,
} from '../browser/runtime.js';
import { closeBrowser } from '../browser/session.js';
import {
  captureProcessIdentity,
  ownedProcessTreeIsAlive,
  processIdentitiesMatch,
  processIdentityMatches,
  terminateOwnedProcessTree,
  type ProcessIdentity,
} from '../utils/process.js';
import type { SessionState } from './state.js';

function resolveOwnedBrowserIdentity(session: SessionState): ProcessIdentity | null {
  return (
    session.browserProcess ||
    (session.agentBrowserSocketDir
      ? captureAgentBrowserProcessIdentity(
          session.agentBrowserSocketDir,
          session.sessionName,
        )
      : null)
  );
}

/**
 * Whether it is safe to address this agent-browser session by socket/name.
 * Persisted immutable identity always wins: a mismatched PID must never fall
 * back to a possibly reused session-name PID file. Legacy state without an
 * identity may adopt the exact current identity from that file.
 */
export function canAddressOwnedBrowserSession(session: SessionState): boolean {
  const identity = resolveOwnedBrowserIdentity(session);
  return Boolean(identity && processIdentityMatches(identity));
}

export async function stopOwnedBrowser(session: SessionState): Promise<void> {
  const identity = resolveOwnedBrowserIdentity(session);
  if (!identity && session.browserLaunchAttempted) {
    throw new Error(
      `Could not recover exact browser ownership for ${session.sessionName}; cleanup state was retained.`,
    );
  }
  assertIdentityNotReused(identity, 'browser');

  // The graceful CLI command is name/socket addressed, so issue it only while
  // the persisted immutable identity still matches. Exact tree termination
  // below remains safe when the leader has exited or its PID was recycled.
  let gracefulCloseError: unknown;
  if (identity && processIdentityMatches(identity)) {
    try {
      closeBrowser(session.sessionName);
    } catch (error) {
      gracefulCloseError = error;
    }
  }
  await terminateOwnedProcessTree(identity);
  if (identity && ownedProcessTreeIsAlive(identity)) {
    throw new AggregateError(
      [
        ...(gracefulCloseError ? [gracefulCloseError] : []),
        new Error(`Owned browser process session ${identity.sessionId} did not stop.`),
      ],
      'Browser cleanup failed.',
    );
  }
  if (session.agentBrowserSocketDir) {
    clearAgentBrowserSessionFiles(session.agentBrowserSocketDir, session.sessionName);
  }
  if (gracefulCloseError) {
    console.warn(
      `ProofShot graceful browser close failed; exact owned-process cleanup succeeded: ${
        gracefulCloseError instanceof Error
          ? gracefulCloseError.message
          : String(gracefulCloseError)
      }`,
    );
  }
}

export async function stopOwnedServer(session: SessionState): Promise<void> {
  assertIdentityNotReused(session.serverProcess, 'server');
  await terminateOwnedProcessTree(session.serverProcess);
  if (session.serverProcess && ownedProcessTreeIsAlive(session.serverProcess)) {
    throw new Error(`Owned server process session ${session.serverProcess.sessionId} did not stop.`);
  }
}

function assertIdentityNotReused(
  identity: ProcessIdentity | null | undefined,
  label: string,
): void {
  if (!identity) return;
  const current = captureProcessIdentity(identity.pid);
  if (current && !processIdentitiesMatch(current, identity)) {
    throw new Error(
      `Owned ${label} process identity no longer matches PID ${identity.pid}; cleanup state was retained.`,
    );
  }
}

export async function cleanupFailedStart(session: SessionState): Promise<void> {
  let cleanupError: unknown;
  if (
    !session.browserProcess &&
    session.browserLaunchAttempted &&
    session.agentBrowserSocketDir
  ) {
    session.browserProcess = await waitForAgentBrowserProcessIdentity(
      session.agentBrowserSocketDir,
      session.sessionName,
    );
  }
  if (session.browserLaunchAttempted && !session.browserProcess) {
    cleanupError = new Error(
      `Could not recover exact browser ownership for ${session.sessionName}; cleanup state was retained.`,
    );
  }

  const browserSessionAddressable = canAddressOwnedBrowserSession(session);
  if (
    (session.networkCaptureStarted || session.networkCaptureActive) &&
    session.privateEvidenceDir &&
    session.networkHarPath &&
    session.networkRequestsPath &&
    session.networkSummaryPath
  ) {
    const allowBrowserCommands =
      browserSessionAddressable && session.networkCaptureActive === true;
    try {
      finalizePrivateNetworkCapture(
        session.sessionName,
        {
          privateDirectory: session.privateEvidenceDir,
          harPath: session.networkHarPath,
          requestsPath: session.networkRequestsPath,
          summaryPath: session.networkSummaryPath,
        },
        { allowBrowserCommands },
      );
      session.networkEvidenceAvailable = true;
      session.networkCaptureActive = false;
      session.networkCaptureError = null;
    } catch (error) {
      session.networkEvidenceAvailable = false;
      session.networkCaptureError =
        sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ) || 'network capture failed';
      const recordedBrowserIsGone = Boolean(
        !allowBrowserCommands &&
          session.browserProcess &&
          !ownedProcessTreeIsAlive(session.browserProcess),
      );
      session.networkCaptureActive = !recordedBrowserIsGone;
      if (!recordedBrowserIsGone) {
        cleanupError ||= error;
      }
    }
  }

  // Recording may have started even when its CLI call returned an error.
  // Never address a session name unless its daemon still has the identity
  // captured by this start.
  let recordingFinalizationFailed = false;
  if (canAddressOwnedBrowserSession(session)) {
    try {
      await finalizeRecording(session.videoPath, session.sessionName);
    } catch (error) {
      cleanupError ||= error;
      recordingFinalizationFailed = true;
    }
  }
  if (!recordingFinalizationFailed && (session.browserProcess || !session.browserLaunchAttempted)) {
    try {
      await stopOwnedBrowser(session);
    } catch (error) {
      cleanupError ||= error;
    }
  }
  try {
    await stopOwnedEnvironment(session.environment);
  } catch (error) {
    cleanupError ||= error;
  }
  try {
    await stopOwnedServer(session);
  } catch (error) {
    cleanupError ||= error;
  }
  if (cleanupError) throw cleanupError;
}
