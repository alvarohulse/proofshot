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
  EnvironmentState,
  LauncherEnvironmentState,
  LogSourceConfig,
  LogsConfig,
  ResolvedLogSourceState,
  TmuxEnvironmentConfig,
  TmuxEnvironmentState,
  TmuxPaneState,
} from './types.js';
import {
  captureProcessIdentity,
  processIdentitiesMatch,
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
    } else if (pendingLauncher) {
      await terminateOwnedProcessTree(pendingLauncher.launcher.process).catch(() => {});
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
        connection.sessionName,
        sourceConfig,
        mapping,
        logsDir,
      ),
    );
    const resolvedPaneIds = new Set<string>();
    for (const { pane } of panes) {
      if (resolvedPaneIds.has(pane.paneId)) {
        throw new Error(`Multiple log sources resolved to tmux pane ${pane.paneId}.`);
      }
      resolvedPaneIds.add(pane.paneId);
    }
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
    try {
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

function startOwnedTmux(
  config: TmuxEnvironmentConfig,
  proofShotSessionName: string,
  onStarted: (connection: TmuxConnection) => void,
): TmuxConnection {
  if (config.launch.kind !== 'panes' || config.launch.panes.length === 0) {
    throw new Error('tmux pane launch requires at least one pane.');
  }
  const paneIds = new Set<string>();
  for (const pane of config.launch.panes) {
    validateId(pane.id);
    if (paneIds.has(pane.id)) {
      throw new Error(`Duplicate tmux pane id: ${pane.id}`);
    }
    paneIds.add(pane.id);
    buildPaneCommand(pane);
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
  onStarted({
    socketPath,
    sessionName,
    paneMappings: [...mappings],
    ownsServer: true,
    ownsSession: true,
  });
  configurePane(socketPath, first.paneId, firstPane.id, firstPane.title);

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
  onLauncherStarted: (identity: NonNullable<ReturnType<typeof captureProcessIdentity>>) => void,
): Promise<TmuxConnection> {
  if (config.launch.kind !== 'external-command' || !config.connection) {
    throw new Error('External tmux launch requires a connection contract.');
  }
  const hintedSocket = config.connection.socket;
  const socketExistedBefore = hintedSocket ? fs.existsSync(hintedSocket) : true;
  const attachOnly = config.connection.ownership === 'attach';
  if (
    !attachOnly &&
    ((!hintedSocket && !config.launch.stopCommand) ||
      (socketExistedBefore && !config.launch.stopCommand))
  ) {
    throw new Error(
      'External tmux launch against an existing or undisclosed socket requires stopCommand.',
    );
  }
  const output = await runCommand(
    config.launch.command,
    config.cwd || process.cwd(),
    onLauncherStarted,
    config.launch.timeoutMs,
  );
  const parsed =
    config.connection.format === 'json'
      ? parseJsonConnection(output)
      : parseAttachCommand(output, config.cwd || process.cwd());
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
  sessionName: string,
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
      '-t',
      sessionName,
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
    '#{pane_id}\t#{pane_index}\t#{pane_pid}\t#{pane_title}\t#{session_name}\t#{session_name}:#{window_name}.#{pane_index}',
  ]).split('\t');
  if (fields.length !== 6) {
    throw new Error(`Could not resolve tmux pane metadata for ${target}.`);
  }
  if (fields[4] !== sessionName) {
    throw new Error(
      `tmux pane ${fields[0]} belongs to session "${fields[4]}", expected "${sessionName}".`,
    );
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
      target: fields[5],
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
  const parsed = JSON.parse(output) as Partial<ExternalTmuxConnection>;
  if (
    !parsed.tmux ||
    !path.isAbsolute(parsed.tmux.socket) ||
    typeof parsed.tmux.session !== 'string' ||
    parsed.tmux.session.length === 0 ||
    (parsed.tmux.panes !== undefined && !Array.isArray(parsed.tmux.panes))
  ) {
    throw new Error('External launcher returned invalid tmux JSON.');
  }
  const paneMappings: PaneMapping[] = [];
  const keys = new Set<string>();
  const paneIds = new Set<string>();
  for (const [index, pane] of (parsed.tmux.panes || []).entries()) {
    if (
      typeof pane !== 'object' ||
      pane === null ||
      typeof pane.key !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(pane.key) ||
      typeof pane.paneId !== 'string' ||
      !/^%\d+$/.test(pane.paneId) ||
      (pane.title !== undefined && typeof pane.title !== 'string') ||
      (pane.group !== undefined && typeof pane.group !== 'string')
    ) {
      throw new Error(`External launcher returned invalid pane mapping at index ${index}.`);
    }
    if (keys.has(pane.key) || paneIds.has(pane.paneId)) {
      throw new Error('External launcher returned duplicate pane mappings.');
    }
    keys.add(pane.key);
    paneIds.add(pane.paneId);
    paneMappings.push(pane);
  }
  return {
    socketPath: parsed.tmux.socket,
    sessionName: parsed.tmux.session,
    paneMappings,
    ownsServer: false,
    ownsSession: false,
  };
}

function parseAttachCommand(output: string, cwd: string): TmuxConnection {
  const tokens = tokenizeShellCommand(output);
  const tmuxIndex = tokens.findIndex((token) => path.basename(token) === 'tmux');
  const attachIndex = tokens.findIndex(
    (token, index) =>
      index > tmuxIndex && (token === 'attach' || token === 'attach-session'),
  );
  const targetIndex = tokens.indexOf('-t', attachIndex + 1);
  const socketIndex = tokens.indexOf('-S', tmuxIndex + 1);
  const labelIndex = tokens.indexOf('-L', tmuxIndex + 1);
  if (
    tmuxIndex < 0 ||
    attachIndex < 0 ||
    targetIndex < 0 ||
    !tokens[targetIndex + 1] ||
    (socketIndex < 0 && labelIndex < 0)
  ) {
    throw new Error('External launcher did not emit a supported tmux attach command.');
  }
  const flag = socketIndex >= 0 ? '-S' : '-L';
  const valueIndex = socketIndex >= 0 ? socketIndex + 1 : labelIndex + 1;
  const value = tokens[valueIndex];
  const sessionName = tokens[targetIndex + 1];
  if (!value) {
    throw new Error('External launcher emitted a tmux socket flag without a value.');
  }
  const socketPath =
    flag === '-S'
      ? path.resolve(cwd, value)
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

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const character of command.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
    } else if (character === '\\' && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (escaping || quote) {
    throw new Error('External launcher emitted an unterminated tmux attach command.');
  }
  if (current) tokens.push(current);
  return tokens;
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

async function runCommand(
  command: string,
  cwd: string,
  onStarted?: (
    identity: NonNullable<ReturnType<typeof captureProcessIdentity>>,
  ) => void,
  timeoutMs = 30_000,
): Promise<string> {
  const child = spawnShellCommand(command, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const identity = child.pid ? captureProcessIdentity(child.pid) : null;
  if (!identity) {
    throw new Error('ProofShot could not capture the external launcher identity.');
  }
  try {
    onStarted?.(identity);
  } catch (error) {
    await terminateOwnedProcessTree(identity);
    throw error;
  }
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const outcome = await new Promise<
    { kind: 'exit'; code: number | null } | { kind: 'timeout' }
  >((resolve, reject) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ kind: 'exit', code });
    });
  });
  if (outcome.kind === 'timeout') {
    await terminateOwnedProcessTree(identity);
    throw new Error(`External environment command timed out after ${timeoutMs}ms.`);
  }
  const exitCode = outcome.code;
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
