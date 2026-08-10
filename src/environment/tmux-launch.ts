import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { runCommand, tmuxExec } from './tmux-command.js';
import { captureSocketIdentity } from './tmux-identity.js';
import type {
  ExternalTmuxConnection,
  TmuxEnvironmentConfig,
  TmuxEnvironmentState,
  TmuxPaneDefinition,
} from './types.js';
import { captureProcessIdentity } from '../utils/process.js';
import type { ProcessIdentity } from '../utils/process.js';

export type PaneMapping = {
  key: string;
  paneId: string;
  title?: string;
  group?: string;
};

export type TmuxConnection = {
  socketPath: string;
  sessionName: string;
  paneMappings: PaneMapping[];
  ownsServer: boolean;
  ownsSession: boolean;
};

type PaneOutput = {
  paneId: string;
  paneIndex: number;
  panePid: number;
};

export function startOwnedTmux(
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

export async function startExternalTmux(
  config: TmuxEnvironmentConfig,
  onLauncherStarted: (identity: ProcessIdentity) => void,
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

export function createTmuxState(
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

function buildPaneCommand(pane: TmuxPaneDefinition): string {
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

function parsePaneOutput(output: string): PaneOutput {
  const [paneId, paneIndex, panePid] = output.split('\t');
  if (
    !paneId ||
    !Number.isInteger(Number(paneIndex)) ||
    !Number.isInteger(Number(panePid))
  ) {
    throw new Error(`Unexpected tmux pane output: ${output}`);
  }
  return {
    paneId,
    paneIndex: Number(paneIndex),
    panePid: Number(panePid),
  };
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
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
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
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function validateId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid log source id: ${id}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
