import { stopRecording } from '../browser/capture.js';
import {
  captureAgentBrowserProcessIdentity,
  waitForAgentBrowserProcessIdentity,
} from '../browser/runtime.js';
import { closeBrowser } from '../browser/session.js';
import {
  ownedProcessTreeIsAlive,
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

  // The graceful CLI command is name/socket addressed, so issue it only while
  // the persisted immutable identity still matches. Exact tree termination
  // below remains safe when the leader has exited or its PID was recycled.
  if (identity && processIdentityMatches(identity)) {
    closeBrowser(session.sessionName);
  }
  await terminateOwnedProcessTree(identity);
  if (identity && ownedProcessTreeIsAlive(identity)) {
    throw new Error(`Owned browser process session ${identity.sessionId} did not stop.`);
  }
}

export async function stopOwnedServer(session: SessionState): Promise<void> {
  await terminateOwnedProcessTree(session.serverProcess);
  if (session.serverProcess && ownedProcessTreeIsAlive(session.serverProcess)) {
    throw new Error(`Owned server process session ${session.serverProcess.sessionId} did not stop.`);
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

  // Recording may have started even when its CLI call returned an error. Both
  // operations are session-scoped and best effort. Never address a session
  // name unless its daemon still has the identity captured by this start.
  if (canAddressOwnedBrowserSession(session)) {
    stopRecording(session.sessionName);
  }
  if (session.browserProcess || !session.browserLaunchAttempted) {
    try {
      await stopOwnedBrowser(session);
    } catch (error) {
      cleanupError ||= error;
    }
  }
  try {
    await stopOwnedServer(session);
  } catch (error) {
    cleanupError ||= error;
  }
  if (cleanupError) throw cleanupError;
}
