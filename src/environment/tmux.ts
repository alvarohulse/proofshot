import * as fs from 'fs';
import * as path from 'path';
import {
  appendHistory,
  buildTmuxPipeCommand,
  createWorkerConfig,
  waitForCaptureProcess,
} from './workers.js';
import { appendEvidenceEvent } from './evidence.js';
import { stopTmuxEnvironment } from './tmux-cleanup.js';
import { assertTmuxAvailable, runCommand, tmuxExec } from './tmux-command.js';
import {
  createTmuxState,
  startExternalTmux,
  startOwnedTmux,
} from './tmux-launch.js';
import type { TmuxConnection } from './tmux-launch.js';
import { resolveTmuxPanes } from './tmux-panes.js';
import type {
  EnvironmentState,
  LauncherEnvironmentState,
  LogsConfig,
  TmuxEnvironmentConfig,
  TmuxEnvironmentState,
} from './types.js';
import { terminateOwnedProcessTree } from '../utils/process.js';

export { stopTmuxEnvironment };

/**
 * Release a tmux server ProofShot took ownership of before it could record an
 * immutable identity. Without a captured identity the recorded-state teardown
 * path cannot run, so the launcher's own stop command and the just-created
 * socket are the only ownership-safe handles left.
 */
async function releaseUnverifiedTmux(
  config: TmuxEnvironmentConfig,
  connection: TmuxConnection | null,
): Promise<void> {
  const stopCommand =
    config.launch.kind === 'external-command' ? config.launch.stopCommand : undefined;
  if (stopCommand) {
    await runCommand(stopCommand, config.cwd || process.cwd()).catch(() => {});
  }
  if (!connection || (!connection.ownsServer && !connection.ownsSession)) {
    return;
  }
  try {
    tmuxExec(
      connection.socketPath,
      connection.ownsServer
        ? ['kill-server']
        : ['kill-session', '-t', connection.sessionName],
    );
  } catch {
    // The launcher's stop command may already have removed the server.
  }
}

export async function startTmuxEnvironment(
  config: TmuxEnvironmentConfig,
  logs: LogsConfig,
  sessionDir: string,
  proofShotSessionName: string,
  startTimeMs: number,
  onState: (state: EnvironmentState) => void,
): Promise<TmuxEnvironmentState> {
  assertTmuxAvailable();
  const evidencePath = path.join(sessionDir, 'environment.ndjson');
  const logsDir = path.join(sessionDir, 'logs');
  const captureDir = path.join(sessionDir, '.capture');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(captureDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(evidencePath, '', { flag: 'a', mode: 0o600 });

  let state: TmuxEnvironmentState | null = null;
  let pendingLauncher: LauncherEnvironmentState | null = null;
  let unverifiedConnection: TmuxConnection | null = null;
  let connection: TmuxConnection;
  try {
    connection =
      config.launch.kind === 'panes'
        ? startOwnedTmux(config, proofShotSessionName, (startedConnection) => {
            unverifiedConnection = startedConnection;
            const startedState = createTmuxState(
              config,
              startedConnection,
              evidencePath,
            );
            state = startedState;
            onState(startedState);
          })
        : await startExternalTmux(config, (launcher) => {
            pendingLauncher = {
              kind: 'launcher',
              evidencePath,
              sources: [],
              launcher: {
                sourceId: 'external-launcher',
                process: launcher,
                pidFile: '',
              },
            };
            onState(pendingLauncher);
          });
    if (!state) {
      unverifiedConnection = connection;
      const connectedState = createTmuxState(
        config,
        connection,
        evidencePath,
      );
      state = connectedState;
      onState(connectedState);
    }
  } catch (error) {
    if (state) {
      await stopTmuxEnvironment(state).catch(() => {});
    } else {
      // Assigned from the launcher callback, which control-flow analysis cannot
      // see, so the declared type has to be restored before the null check.
      const launcherState = pendingLauncher as LauncherEnvironmentState | null;
      if (launcherState) {
        await terminateOwnedProcessTree(launcherState.launcher.process).catch(() => {});
      }
      await releaseUnverifiedTmux(config, unverifiedConnection);
    }
    throw error;
  }

  try {
    if (!state) {
      throw new Error('tmux environment ownership state was not initialized.');
    }
    let activeState: TmuxEnvironmentState = state;
    const panes = resolveTmuxPanes(config, logs, connection, logsDir);
    activeState = {
      ...activeState,
      panes: panes.map(({ pane }) => pane),
      sources: panes.map(({ source }) => source),
    };
    state = activeState;
    onState(activeState);

    for (const pane of panes) {
      const pipeStatus = tmuxExec(connection.socketPath, [
        'display-message',
        '-p',
        '-t',
        pane.pane.paneId,
        '#{pane_pipe}',
      ]);
      if (pipeStatus === '1') {
        throw new Error(
          `tmux pane ${pane.pane.paneId} already has a pipe-pane consumer.`,
        );
      }

      const pidFile = path.join(captureDir, `${pane.source.id}.pid`);
      const sourceBudget = logs.maxBytesPerSource || 5 * 1024 * 1024;
      const historyBudget = Math.max(1, Math.floor(sourceBudget / 2));
      const workerConfig = createWorkerConfig({
        evidencePath,
        logPath: pane.source.logPath,
        pidFile,
        startTimeMs,
        maxBytes: Math.max(1, sourceBudget - historyBudget),
        stripAnsi: logs.stripAnsi !== false,
        source: pane.source,
      });
      tmuxExec(connection.socketPath, [
        'pipe-pane',
        '-t',
        pane.pane.paneId,
        buildTmuxPipeCommand(workerConfig),
      ]);
      pane.pane.captureAttached = true;
      activeState = {
        ...activeState,
        panes: activeState.panes.map((ownedPane) =>
          ownedPane.paneId === pane.pane.paneId
            ? { ...ownedPane, captureAttached: true }
            : ownedPane,
        ),
      };
      state = activeState;
      onState(activeState);

      const history = tmuxExec(connection.socketPath, [
        'capture-pane',
        '-p',
        '-S',
        '-',
        '-t',
        pane.pane.paneId,
      ]);
      appendHistory(
        history,
        pane.source,
        evidencePath,
        historyBudget,
        logs.stripAnsi !== false,
        'pty',
      );
      appendEvidenceEvent(evidencePath, {
        version: 1,
        origin: 'environment',
        group: pane.source.group,
        sourceId: pane.source.id,
        sourceTitle: pane.source.title,
        stream: 'pty',
        segment: 'history',
        timestamp: null,
        relativeTimeSec: null,
        text: '[tmux history/live capture boundary]',
      });
      const capture = await waitForCaptureProcess(pane.source.id, pidFile);
      activeState = {
        ...activeState,
        captures: [...activeState.captures, capture],
      };
      state = activeState;
      onState(activeState);
    }
    return activeState;
  } catch (error) {
    if (state) {
      await stopTmuxEnvironment(state).catch(() => {});
    }
    throw error;
  }
}
