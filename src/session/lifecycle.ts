import { stopRecording } from '../browser/capture.js';
import { closeBrowser } from '../browser/session.js';
import { SERVER_OWNERSHIP_ENV } from '../server/start.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import {
  getProcessStartTime,
  isProcessRunning,
  processHasEnvironmentValue,
  terminateProcessTree,
  waitForProcessExit,
} from '../utils/process.js';
import { unregisterSession } from './registry.js';
import { clearSession, type SessionState } from './state.js';

type DiscardSessionOptions = {
  unregister?: boolean;
};

export type ServerStopResult = 'not-owned' | 'already-stopped' | 'stopped';

export function isSessionStillStarting(session: SessionState): boolean {
  return (
    session.lifecycleStatus === 'starting' &&
    session.ownerPid !== null &&
    session.ownerPid !== undefined &&
    isProcessRunning(session.ownerPid)
  );
}

export function stopOwnedServer(session: SessionState): ServerStopResult {
  if (
    session.serverAlreadyRunning ||
    session.serverPid === null ||
    session.serverPid === undefined
  ) {
    return 'not-owned';
  }

  if (!isProcessRunning(session.serverPid)) {
    return 'already-stopped';
  }

  const hasOwnershipToken =
    session.serverOwnershipToken !== null &&
    session.serverOwnershipToken !== undefined &&
    processHasEnvironmentValue(
      session.serverPid,
      SERVER_OWNERSHIP_ENV,
      session.serverOwnershipToken,
    ) === true;
  const hasMatchingStartTime =
    process.platform === 'win32' &&
    session.serverProcessStartTime !== null &&
    session.serverProcessStartTime !== undefined &&
    getProcessStartTime(session.serverPid) === session.serverProcessStartTime;

  if (!hasOwnershipToken && !hasMatchingStartTime) {
    throw new Error(
      `Cannot safely stop server PID ${session.serverPid}: process ownership could not be verified.`,
    );
  }

  terminateProcessTree(session.serverPid);
  if (!waitForProcessExit(session.serverPid)) {
    throw new Error(
      `Server PID ${session.serverPid} is still running after termination.`,
    );
  }
  return 'stopped';
}

export function discardSession(
  session: SessionState,
  options: DiscardSessionOptions = {},
): void {
  setAgentBrowserDefaults({
    configPath: session.browserConfigPath ?? undefined,
  });
  stopRecording(session.sessionName);
  closeBrowser(session.sessionName);
  stopOwnedServer(session);
  clearSession(session.outputDir, session.sessionName);
  if (options.unregister !== false) {
    unregisterSession(session.sessionName);
  }
}
