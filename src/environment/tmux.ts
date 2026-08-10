import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  appendHistory,
  buildTmuxPipeCommand,
  createWorkerConfig,
  waitForCaptureProcess,
} from './workers.js';
import { appendEvidenceEvent } from './evidence.js';
import type {
  ExternalTmuxConnection,
  LogSourceConfig,
  LogsConfig,
  ResolvedLogSourceState,
  TmuxEnvironmentConfig,
  TmuxEnvironmentState,
  TmuxPaneState,
} from './types.js';
import {
  captureProcessIdentity,
  processIdentityMatches,
  spawnShellCommand,
  terminateOwnedProcess,
  terminateOwnedProcessTree,
} from '../utils/process.js';

type PaneMapping = {
  key: string;
  paneId: string;
  title?: string;
  group?: string;
};

type TmuxConnection = {
  socketPath: string;
  sessionName: string;
  paneMappings: PaneMapping[];
  ownsServer: boolean;
  ownsSession: boolean;
};

export async function startTmuxEnvironment(
  config: TmuxEnvironmentConfig,
  logs: LogsConfig,
  sessionDir: string,
  proofShotSessionName: string,
  startTimeMs: number,
  onState: (state: TmuxEnvironmentState) => void,
): Promise<TmuxEnvironmentState> {
  assertTmuxAvailable();
  const evidencePath = path.join(sessionDir, 'environment.ndjson');
  const logsDir = path.join(sessionDir, 'logs');
  const captureDir = path.join(sessionDir, '.capture');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(captureDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(evidencePath, '', { flag: 'a', mode: 0o600 });

  let state: TmuxEnvironmentState | null = null;
  let connection: TmuxConnection;
  try {
    connection =
      config.launch.kind === 'panes'
        ? startOwnedTmux(config, proofShotSessionName, (startedConnection) => {
            const startedState = createTmuxState(
              config,
              startedConnection,
              evidencePath,
            );
            state = startedState;
            onState(startedState);
          })
        : await startExternalTmux(config);
    if (!state) {
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
    }
    throw error;
  }

  try {
    if (!state) {
      throw new Error('tmux environment ownership state was not initialized.');
    }
    let activeState: TmuxEnvironmentState = state;
    const tmuxSources = resolveTmuxSources(config, logs, connection);
    const panes = tmuxSources.map(({ config: sourceConfig, mapping }) =>
      resolvePane(
        connection.socketPath,
        sourceConfig,
        mapping,
        logsDir,
      ),
    );
    disambiguateTitles(panes);
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
      const workerConfig = createWorkerConfig({
        evidencePath,
        logPath: pane.source.logPath,
        pidFile,
        startTimeMs,
        maxBytes: logs.maxBytesPerSource || 5 * 1024 * 1024,
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
        logs.maxBytesPerSource || 5 * 1024 * 1024,
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
        captureGap: true,
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

export async function stopTmuxEnvironment(
  state: TmuxEnvironmentState,
): Promise<void> {
  if (
    !processIdentityMatches(state.serverProcess) &&
    !fs.existsSync(state.socket.path) &&
    state.captures.every((capture) => !processIdentityMatches(capture.process))
  ) {
    return;
  }
  assertSocketIdentity(state);
  if (!processIdentityMatches(state.serverProcess)) {
    throw new Error('tmux server identity changed; refusing widened cleanup.');
  }

  if (state.stopCommand) {
    await runCommand(state.stopCommand, state.stopCwd || process.cwd());
  } else if (state.ownsSession && tmuxHasSession(state)) {
    tmuxExec(state.socket.path, ['kill-session', '-t', state.sessionName]);
  } else {
    for (const pane of state.panes.filter(
      (candidate) => candidate.captureAttached,
    )) {
      try {
        tmuxExec(state.socket.path, ['pipe-pane', '-t', pane.paneId]);
      } catch {
        // A launcher-provided shutdown may already have removed the pane.
      }
    }
  }

  for (const capture of state.captures) {
    await terminateOwnedProcess(capture.process, { graceMs: 500 });
    if (processIdentityMatches(capture.process)) {
      throw new Error(`Log helper for ${capture.sourceId} did not stop.`);
    }
  }

  if (state.ownsServer && processIdentityMatches(state.serverProcess)) {
    try {
      tmuxExec(state.socket.path, ['kill-server']);
    } catch {
      await terminateOwnedProcessTree(state.serverProcess, { graceMs: 500 });
    }
  }
  if (state.ownsServer && processIdentityMatches(state.serverProcess)) {
    throw new Error('Owned tmux server did not stop.');
  }
  if (state.ownsServer && fs.existsSync(state.socket.path)) {
    const currentSocket = captureSocketIdentity(state.socket.path);
    if (
      currentSocket.inode !== state.socket.inode ||
      currentSocket.uid !== state.socket.uid
    ) {
      throw new Error('tmux socket changed before final cleanup.');
    }
    fs.unlinkSync(state.socket.path);
  }
  if (state.ownsSession && tmuxHasSession(state)) {
    throw new Error(`Owned tmux session ${state.sessionName} did not stop.`);
  }
}

function startOwnedTmux(
  config: TmuxEnvironmentConfig,
  proofShotSessionName: string,
  onStarted: (connection: TmuxConnection) => void,
): TmuxConnection {
  if (config.launch.kind !== 'panes' || config.launch.panes.length === 0) {
    throw new Error('tmux pane launch requires at least one pane.');
  }
  const uid = process.getuid?.() ?? process.pid;
  const socketDir = path.join('/tmp', `proofshot-${uid}`, 'tmux');
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const socketPath = path.join(socketDir, `${proofShotSessionName}.sock`);
  if (fs.existsSync(socketPath)) {
    throw new Error(`Refusing to reuse an existing tmux socket: ${socketPath}`);
  }

  const sessionName = config.launch.sessionName || proofShotSessionName;
  const [firstPane, ...remainingPanes] = config.launch.panes;
  const first = parsePaneOutput(
    tmuxExec(socketPath, [
      'new-session',
      '-d',
      '-P',
      '-F',
      '#{pane_id}\t#{pane_index}\t#{pane_pid}',
      '-s',
      sessionName,
      '-n',
      'environment',
      '-c',
      firstPane.cwd || config.cwd || process.cwd(),
      buildPaneCommand(firstPane),
    ]),
  );
  const mappings: PaneMapping[] = [
    {
      key: firstPane.id,
      paneId: first.paneId,
      title: firstPane.title,
      group: firstPane.group,
    },
  ];
  configurePane(socketPath, first.paneId, firstPane.id, firstPane.title);
  onStarted({
    socketPath,
    sessionName,
    paneMappings: [...mappings],
    ownsServer: true,
    ownsSession: true,
  });

  for (const pane of remainingPanes) {
    const created = parsePaneOutput(
      tmuxExec(socketPath, [
        'split-window',
        '-d',
        '-P',
        '-F',
        '#{pane_id}\t#{pane_index}\t#{pane_pid}',
        '-t',
        `${sessionName}:environment`,
        '-c',
        pane.cwd || config.cwd || process.cwd(),
        buildPaneCommand(pane),
      ]),
    );
    configurePane(socketPath, created.paneId, pane.id, pane.title);
    mappings.push({
      key: pane.id,
      paneId: created.paneId,
      title: pane.title,
      group: pane.group,
    });
  }
  tmuxExec(socketPath, ['select-layout', '-t', `${sessionName}:environment`, 'tiled']);
  return {
    socketPath,
    sessionName,
    paneMappings: mappings,
    ownsServer: true,
    ownsSession: true,
  };
}

function createTmuxState(
  config: TmuxEnvironmentConfig,
  connection: TmuxConnection,
  evidencePath: string,
): TmuxEnvironmentState {
  const serverPid = Number(
    tmuxExec(connection.socketPath, ['display-message', '-p', '#{pid}']),
  );
  const serverProcess = captureProcessIdentity(serverPid);
  if (!serverProcess) {
    throw new Error('ProofShot could not capture the exact tmux server identity.');
  }
  return {
    kind: 'tmux',
    evidencePath,
    sources: [],
    socket: captureSocketIdentity(connection.socketPath),
    serverProcess,
    sessionName: connection.sessionName,
    ownsServer: connection.ownsServer,
    ownsSession: connection.ownsSession,
    panes: [],
    captures: [],
    stopCommand:
      config.launch.kind === 'external-command'
        ? config.launch.stopCommand
        : undefined,
    stopCwd: config.cwd,
  };
}

async function startExternalTmux(
  config: TmuxEnvironmentConfig,
): Promise<TmuxConnection> {
  if (config.launch.kind !== 'external-command' || !config.connection) {
    throw new Error('External tmux launch requires a connection contract.');
  }
  const hintedSocket = config.connection.socket;
  const socketExistedBefore = hintedSocket ? fs.existsSync(hintedSocket) : true;
  const output = await runCommand(
    config.launch.command,
    config.cwd || process.cwd(),
  );
  const parsed =
    config.connection.format === 'json'
      ? parseJsonConnection(output)
      : parseAttachCommand(output);
  const ownsCreatedSocket =
    hintedSocket !== undefined &&
    path.resolve(hintedSocket) === path.resolve(parsed.socketPath) &&
    !socketExistedBefore;
  return {
    ...parsed,
    ownsServer: ownsCreatedSocket,
    ownsSession: ownsCreatedSocket,
  };
}

function resolveTmuxSources(
  config: TmuxEnvironmentConfig,
  logs: LogsConfig,
  connection: TmuxConnection,
): Array<{
  config: Extract<LogSourceConfig, { kind: 'tmux-pane' }>;
  mapping?: PaneMapping;
}> {
  const configured = (logs.sources || []).filter(
    (source): source is Extract<LogSourceConfig, { kind: 'tmux-pane' }> =>
      source.kind === 'tmux-pane',
  );
  if (configured.length > 0) {
    return configured.map((source) => {
      const connectionKey =
        'connectionKey' in source.match
          ? source.match.connectionKey
          : undefined;
      return {
        config: source,
        mapping: connectionKey
          ? connection.paneMappings.find(
              (mapping) => mapping.key === connectionKey,
            )
          : undefined,
      };
    });
  }
  if (config.launch.kind !== 'panes') {
    return [];
  }
  return connection.paneMappings.map((mapping) => ({
    config: {
      id: mapping.key,
      title: mapping.title,
      group: mapping.group,
      kind: 'tmux-pane',
      match: { connectionKey: mapping.key },
    },
    mapping,
  }));
}

function resolvePane(
  socketPath: string,
  sourceConfig: Extract<LogSourceConfig, { kind: 'tmux-pane' }>,
  mapping: PaneMapping | undefined,
  logsDir: string,
): { pane: TmuxPaneState; source: ResolvedLogSourceState } {
  let target: string;
  if ('connectionKey' in sourceConfig.match) {
    if (!mapping) {
      throw new Error(
        `No tmux pane mapping matched connection key "${sourceConfig.match.connectionKey}".`,
      );
    }
    target = mapping.paneId;
  } else if ('tag' in sourceConfig.match) {
    const tag = sourceConfig.match.tag;
    const matches = tmuxExec(socketPath, [
      'list-panes',
      '-a',
      '-F',
      '#{pane_id}\t#{@proofshot-source}',
    ])
      .split('\n')
      .filter((line) => line.split('\t')[1] === tag);
    if (matches.length !== 1) {
      throw new Error(
        `Expected one tmux pane tagged "${tag}", found ${matches.length}.`,
      );
    }
    target = matches[0].split('\t')[0];
  } else {
    target = sourceConfig.match.target;
  }

  const fields = tmuxExec(socketPath, [
    'display-message',
    '-p',
    '-t',
    target,
    '#{pane_id}\t#{pane_index}\t#{pane_pid}\t#{pane_title}\t#{session_name}:#{window_name}.#{pane_index}',
  ]).split('\t');
  if (fields.length !== 5) {
    throw new Error(`Could not resolve tmux pane metadata for ${target}.`);
  }
  const paneIndex = Number(fields[1]);
  const tmuxTitle = fields[3].trim();
  const title =
    mapping?.title ||
    (tmuxTitle.length > 0 ? tmuxTitle : `Pane ${paneIndex}`);
  const group = sourceConfig.group || mapping?.group || 'environment';
  const source: ResolvedLogSourceState = {
    id: sourceConfig.id,
    title,
    group,
    kind: 'tmux-pane',
    stream: 'pty',
    logPath: path.join(logsDir, `${sourceConfig.id}.log`),
    include: sourceConfig.include,
    exclude: sourceConfig.exclude,
  };
  return {
    source,
    pane: {
      paneId: fields[0],
      paneIndex,
      panePid: Number(fields[2]),
      sourceId: source.id,
      title,
      group,
      target: fields[4],
      captureAttached: false,
    },
  };
}

function disambiguateTitles(
  panes: Array<{ pane: TmuxPaneState; source: ResolvedLogSourceState }>,
): void {
  const counts = new Map<string, number>();
  for (const pane of panes) {
    counts.set(pane.source.title, (counts.get(pane.source.title) || 0) + 1);
  }
  for (const pane of panes) {
    if ((counts.get(pane.source.title) || 0) > 1) {
      const title = `${pane.source.title} (Pane ${pane.pane.paneIndex})`;
      pane.source.title = title;
      pane.pane.title = title;
    }
  }
}

function configurePane(
  socketPath: string,
  paneId: string,
  sourceId: string,
  title?: string,
): void {
  validateId(sourceId);
  tmuxExec(socketPath, [
    'set-option',
    '-p',
    '-t',
    paneId,
    '@proofshot-source',
    sourceId,
  ]);
  if (title) {
    tmuxExec(socketPath, ['select-pane', '-t', paneId, '-T', title]);
  }
}

function buildPaneCommand(
  pane: { command: string; env?: Record<string, string> },
): string {
  const assignments = Object.entries(pane.env || {}).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    return `${key}=${shellQuote(value)}`;
  });
  return assignments.length > 0
    ? `env ${assignments.join(' ')} ${pane.command}`
    : pane.command;
}

function parsePaneOutput(output: string): {
  paneId: string;
  paneIndex: number;
  panePid: number;
} {
  const [paneId, paneIndex, panePid] = output.split('\t');
  if (!paneId || !Number.isInteger(Number(paneIndex)) || !Number.isInteger(Number(panePid))) {
    throw new Error(`Unexpected tmux pane output: ${output}`);
  }
  return { paneId, paneIndex: Number(paneIndex), panePid: Number(panePid) };
}

function parseJsonConnection(output: string): TmuxConnection {
  const parsed = JSON.parse(output) as ExternalTmuxConnection;
  if (
    !parsed.tmux ||
    !path.isAbsolute(parsed.tmux.socket) ||
    typeof parsed.tmux.session !== 'string'
  ) {
    throw new Error('External launcher returned invalid tmux JSON.');
  }
  return {
    socketPath: parsed.tmux.socket,
    sessionName: parsed.tmux.session,
    paneMappings: parsed.tmux.panes || [],
    ownsServer: false,
    ownsSession: false,
  };
}

function parseAttachCommand(output: string): TmuxConnection {
  const match = output.match(
    /tmux\s+(?:(-S)\s+(\S+)|(-L)\s+(\S+)).*?attach(?:-session)?\s+-t\s+(\S+)/,
  );
  if (!match) {
    throw new Error('External launcher did not emit a supported tmux attach command.');
  }
  const flag = match[1] || match[3];
  const value = stripShellQuotes(match[2] || match[4]);
  const sessionName = stripShellQuotes(match[5]);
  const socketPath =
    flag === '-S'
      ? path.resolve(value)
      : execFileSync(
          'tmux',
          ['-L', value, 'display-message', '-p', '#{socket_path}'],
          { encoding: 'utf-8' },
        ).trim();
  return {
    socketPath,
    sessionName,
    paneMappings: [],
    ownsServer: false,
    ownsSession: false,
  };
}

function tmuxExec(socketPath: string, args: string[]): string {
  return execFileSync('tmux', ['-S', socketPath, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function tmuxHasSession(state: TmuxEnvironmentState): boolean {
  if (!processIdentityMatches(state.serverProcess)) {
    return false;
  }
  try {
    tmuxExec(state.socket.path, ['has-session', '-t', state.sessionName]);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, cwd: string): Promise<string> {
  const child = spawnShellCommand(command, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const identity = child.pid ? captureProcessIdentity(child.pid) : null;
  if (!identity) {
    throw new Error('ProofShot could not capture the external launcher identity.');
  }
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (exitCode !== 0) {
    await terminateOwnedProcessTree(identity);
    throw new Error(
      `External environment command failed with code ${String(exitCode)}: ${stderr.trim()}`,
    );
  }
  return stdout.trim();
}

function captureSocketIdentity(socketPath: string): {
  path: string;
  inode: number;
  uid: number;
} {
  const stat = fs.lstatSync(socketPath);
  if (!stat.isSocket() || stat.isSymbolicLink()) {
    throw new Error(`tmux socket is not an owned Unix socket: ${socketPath}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(`tmux socket is owned by uid ${stat.uid}, expected ${uid}.`);
  }
  return { path: socketPath, inode: stat.ino, uid: stat.uid };
}

function assertSocketIdentity(state: TmuxEnvironmentState): void {
  if (!fs.existsSync(state.socket.path)) {
    if (!processIdentityMatches(state.serverProcess)) {
      return;
    }
    throw new Error('Owned tmux socket disappeared while its server is still alive.');
  }
  const current = captureSocketIdentity(state.socket.path);
  if (current.inode !== state.socket.inode || current.uid !== state.socket.uid) {
    throw new Error('tmux socket identity changed; refusing widened cleanup.');
  }
}

function assertTmuxAvailable(): void {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'pipe' });
  } catch {
    throw new Error('tmux is required for environment.kind "tmux".');
  }
}

function validateId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid log source id: ${id}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stripShellQuotes(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}
