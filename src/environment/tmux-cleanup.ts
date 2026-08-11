import * as fs from 'fs';
import { runCommand, tmuxExec } from './tmux-command.js';
import {
  assertSocketIdentity,
  captureSocketIdentity,
  tmuxHasSession,
} from './tmux-identity.js';
import type { TmuxEnvironmentState } from './types.js';
import {
  captureProcessIdentity,
  processIdentitiesMatch,
  processIdentityMatches,
  terminateOwnedProcess,
  terminateOwnedProcessTree,
} from '../utils/process.js';

export async function stopTmuxEnvironment(
  state: TmuxEnvironmentState,
): Promise<void> {
  const errors: Error[] = [];
  let socketMatches = false;
  let socketIdentityError: Error | null = null;
  if (fs.existsSync(state.socket.path)) {
    try {
      assertSocketIdentity(state);
      socketMatches = true;
    } catch (error) {
      socketIdentityError = toError(error);
    }
  }

  const currentServer = captureProcessIdentity(state.serverProcess.pid);
  const serverIdentityReused = Boolean(
    currentServer && !processIdentitiesMatch(currentServer, state.serverProcess),
  );
  if (serverIdentityReused) {
    errors.push(new Error('tmux server identity changed; refusing widened cleanup.'));
  }
  const serverMatches = processIdentityMatches(state.serverProcess);
  if (
    socketIdentityError &&
    (serverMatches ||
      state.captures.some((capture) => processIdentityMatches(capture.process)))
  ) {
    errors.push(socketIdentityError);
  }

  if (serverMatches && socketMatches) {
    // Detaching first releases panes ProofShot does not own before any shutdown
    // runs, and stops output reaching a helper that is about to be terminated.
    for (const pane of state.panes.filter(
      (candidate) => candidate.captureAttached,
    )) {
      try {
        tmuxExec(state.socket.path, ['pipe-pane', '-t', pane.paneId]);
      } catch {
        // A launcher-provided shutdown may already have removed the pane.
      }
    }
    try {
      if (state.stopCommand) {
        await runCommand(state.stopCommand, state.stopCwd || process.cwd());
      } else if (state.ownsSession && tmuxHasSession(state)) {
        tmuxExec(state.socket.path, ['kill-session', '-t', state.sessionName]);
      }
    } catch (error) {
      errors.push(toError(error));
    }
  }

  for (const capture of state.captures) {
    try {
      await terminateOwnedProcess(capture.process, { graceMs: 500 });
      if (processIdentityMatches(capture.process)) {
        throw new Error(`Log helper for ${capture.sourceId} did not stop.`);
      }
    } catch (error) {
      errors.push(toError(error));
    }
  }

  if (state.ownsServer && !serverIdentityReused) {
    if (processIdentityMatches(state.serverProcess) && socketMatches) {
      try {
        tmuxExec(state.socket.path, ['kill-server']);
      } catch {
        // Exact process-session termination below is the verified fallback.
      }
    }
    if (processIdentityMatches(state.serverProcess)) {
      try {
        await terminateOwnedProcessTree(state.serverProcess, { graceMs: 500 });
      } catch (error) {
        errors.push(toError(error));
      }
    }
    if (processIdentityMatches(state.serverProcess)) {
      errors.push(new Error('Owned tmux server did not stop.'));
    }
  }

  if (
    state.ownsServer &&
    socketMatches &&
    !processIdentityMatches(state.serverProcess) &&
    fs.existsSync(state.socket.path)
  ) {
    try {
      const currentSocket = captureSocketIdentity(state.socket.path);
      if (
        currentSocket.inode !== state.socket.inode ||
        currentSocket.uid !== state.socket.uid
      ) {
        throw new Error('tmux socket changed before final cleanup.');
      }
      fs.unlinkSync(state.socket.path);
    } catch (error) {
      errors.push(toError(error));
    }
  }
  if (
    state.ownsSession &&
    processIdentityMatches(state.serverProcess) &&
    socketMatches &&
    tmuxHasSession(state)
  ) {
    errors.push(new Error(`Owned tmux session ${state.sessionName} did not stop.`));
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'One or more tmux cleanup steps failed.');
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
