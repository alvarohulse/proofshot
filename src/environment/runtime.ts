import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { startFileCapture, startProcessCapture } from './workers.js';
import { startTmuxEnvironment, stopTmuxEnvironment } from './tmux.js';
import type {
  EnvironmentConfig,
  EnvironmentState,
  LogSourceConfig,
  LogsConfig,
  ProcessDefinition,
  ProcessEnvironmentState,
  ReadinessCheck,
  ResolvedLogSourceState,
  TmuxEnvironmentConfig,
  TmuxEnvironmentState,
  ProcessesEnvironmentConfig,
} from './types.js';
import {
  ownedProcessTreeIsAlive,
  terminateOwnedProcessTree,
} from '../utils/process.js';

export async function startOwnedEnvironment(
  environment: EnvironmentConfig | undefined,
  logs: LogsConfig,
  sessionDir: string,
  sessionName: string,
  startTimeMs: number,
  onState: (state: EnvironmentState) => void,
): Promise<EnvironmentState | null> {
  assertSourcesMatchEnvironment(environment, logs);
  const fileSources = (logs.sources || []).filter(
    (source): source is Extract<LogSourceConfig, { kind: 'file' }> =>
      source.kind === 'file',
  );
  if (!environment && fileSources.length === 0) {
    return null;
  }

  let state: EnvironmentState;
  if (environment?.kind === 'tmux') {
    state = await startTmuxEnvironment(
      environment,
      logs,
      sessionDir,
      sessionName,
      startTimeMs,
      onState,
    );
  } else {
    state = await startProcessEnvironment(
      environment?.kind === 'processes' ? environment.commands : [],
      logs,
      sessionDir,
      startTimeMs,
      onState,
    );
  }

  try {
    state = await attachFileSources(
      state,
      fileSources,
      logs,
      sessionDir,
      startTimeMs,
      onState,
    );
    if (environment) {
      await waitForReadiness(environment.readiness || []);
    }
    return state;
  } catch (error) {
    await stopOwnedEnvironment(state).catch(() => {});
    throw error;
  }
}

/**
 * Only the environment kind that owns a source can capture it, so a mismatch
 * must fail closed instead of dropping declared evidence.
 */
function assertSourcesMatchEnvironment(
  environment: EnvironmentConfig | undefined,
  logs: LogsConfig,
): void {
  const requiredKind =
    environment?.kind === 'tmux'
      ? 'tmux-pane'
      : environment?.kind === 'processes'
        ? 'process'
        : undefined;
  for (const source of logs.sources || []) {
    if (source.kind === 'file' || source.kind === requiredKind) continue;
    throw new Error(
      `Log source ${source.id} of kind "${source.kind}" cannot be captured by environment kind "${
        environment?.kind || 'none'
      }".`,
    );
  }
}

export async function stopOwnedEnvironment(
  state: EnvironmentState | null | undefined,
): Promise<void> {
  if (!state) {
    return;
  }
  switch (state.kind) {
    case 'tmux':
      await stopTmuxEnvironment(state);
      return;
    case 'launcher':
      await terminateOwnedProcessTree(state.launcher.process, { graceMs: 1000 });
      if (ownedProcessTreeIsAlive(state.launcher.process)) {
        throw new Error('External environment launcher did not stop.');
      }
      return;
    case 'processes': {
      const errors: Error[] = [];
      for (const capture of state.processes) {
        try {
          await terminateOwnedProcessTree(capture.process, { graceMs: 1000 });
          if (ownedProcessTreeIsAlive(capture.process)) {
            throw new Error(`Environment process ${capture.sourceId} did not stop.`);
          }
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          'One or more environment processes did not stop.',
        );
      }
      return;
    }
    default: {
      const exhaustiveState: never = state;
      return exhaustiveState;
    }
  }
}

async function startProcessEnvironment(
  definitions: ProcessDefinition[],
  logs: LogsConfig,
  sessionDir: string,
  startTimeMs: number,
  onState: (state: EnvironmentState) => void,
): Promise<ProcessEnvironmentState> {
  const evidencePath = path.join(sessionDir, 'environment.ndjson');
  const logsDir = path.join(sessionDir, 'logs');
  const captureDir = path.join(sessionDir, '.capture');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(captureDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(evidencePath, '', { flag: 'a', mode: 0o600 });

  const configuredSources = (logs.sources || []).filter(
    (source): source is Extract<LogSourceConfig, { kind: 'process' }> =>
      source.kind === 'process',
  );
  const sourceByProcessId = new Map<string, (typeof configuredSources)[number]>();
  for (const source of configuredSources) {
    if (sourceByProcessId.has(source.processId)) {
      throw new Error(
        `Multiple log sources reference process ${source.processId}; each process can be launched only once.`,
      );
    }
    sourceByProcessId.set(source.processId, source);
  }
  for (const source of configuredSources) {
    if (!definitions.some((definition) => definition.id === source.processId)) {
      throw new Error(
        `Log source ${source.id} references unknown process ${source.processId}.`,
      );
    }
  }
  const sources = definitions.map(
    (definition) =>
      sourceByProcessId.get(definition.id) || {
          id: definition.id,
          title: definition.title,
          group: definition.group,
          kind: 'process' as const,
          processId: definition.id,
        },
  );
  validateUniqueIds(sources.map((source) => source.id));

  let state: ProcessEnvironmentState = {
    kind: 'processes',
    evidencePath,
    sources: [],
    processes: [],
  };
  onState(state);
  try {
    for (const sourceConfig of sources) {
      const definition = definitions.find(
        (candidate) => candidate.id === sourceConfig.processId,
      );
      if (!definition) throw new Error(`Missing process ${sourceConfig.processId}.`);
      const source: ResolvedLogSourceState = {
        id: sourceConfig.id,
        title: sourceConfig.title || definition.title || definition.id,
        group: sourceConfig.group || definition.group || 'environment',
        kind: 'process',
        stream: 'stdout',
        logPath: path.join(logsDir, `${sourceConfig.id}.log`),
      };
      const process = await startProcessCapture(
        definition,
        source,
        evidencePath,
        captureDir,
        startTimeMs,
        logs.maxBytesPerSource || 5 * 1024 * 1024,
        logs.stripAnsi !== false,
      );
      state = {
        ...state,
        sources: [...state.sources, source],
        processes: [...state.processes, process],
      };
      onState(state);
    }
    return state;
  } catch (error) {
    await stopOwnedEnvironment(state).catch(() => {});
    throw error;
  }
}

async function attachFileSources(
  state: EnvironmentState,
  fileSources: Array<Extract<LogSourceConfig, { kind: 'file' }>>,
  logs: LogsConfig,
  sessionDir: string,
  startTimeMs: number,
  onState: (state: EnvironmentState) => void,
): Promise<EnvironmentState> {
  if (fileSources.length === 0) {
    return state;
  }
  if (state.kind === 'launcher') {
    throw new Error('Cannot attach file sources before the environment launcher exits.');
  }
  const knownIds = new Set(state.sources.map((source) => source.id));
  const logsDir = path.join(sessionDir, 'logs');
  const captureDir = path.join(sessionDir, '.capture');
  fs.mkdirSync(captureDir, { recursive: true, mode: 0o700 });
  for (const fileSource of fileSources) {
    if (knownIds.has(fileSource.id)) {
      throw new Error(`Duplicate log source id: ${fileSource.id}`);
    }
    knownIds.add(fileSource.id);
    const source: ResolvedLogSourceState = {
      id: fileSource.id,
      title: fileSource.title || path.basename(fileSource.path),
      group: fileSource.group || 'environment',
      kind: 'file',
      stream: 'file',
      logPath: path.join(logsDir, `${fileSource.id}.log`),
    };
    const capture = await startFileCapture(
      fileSource.path,
      source,
      state.evidencePath,
      captureDir,
      startTimeMs,
      logs.maxBytesPerSource || 5 * 1024 * 1024,
      logs.stripAnsi !== false,
    );
    state =
      state.kind === 'tmux'
        ? {
            ...state,
            sources: [...state.sources, source],
            captures: [...state.captures, capture],
          }
        : {
            ...state,
            sources: [...state.sources, source],
            processes: [...state.processes, capture],
          };
    onState(state);
  }
  return state;
}

async function waitForReadiness(checks: ReadinessCheck[]): Promise<void> {
  for (const check of checks) {
    const timeoutMs = check.timeoutMs || 30 * 1000;
    const deadline = Date.now() + timeoutMs;
    let lastError = 'not ready';
    while (Date.now() < deadline) {
      try {
        if (check.kind === 'http') {
          const response = await fetch(check.url, {
            signal: AbortSignal.timeout(Math.min(2000, timeoutMs)),
          });
          if (response.ok) {
            lastError = '';
            break;
          }
          lastError = `HTTP ${response.status}`;
        } else {
          await connectTcp(check.host || '127.0.0.1', check.port);
          lastError = '';
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (lastError) {
      const target =
        check.kind === 'http'
          ? check.url
          : `${check.host || '127.0.0.1'}:${check.port}`;
      throw new Error(`Environment readiness failed for ${target}: ${lastError}`);
    }
  }
}

function connectTcp(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('TCP readiness timed out'));
    }, 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function validateUniqueIds(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid log source id: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate log source id: ${id}`);
    }
    seen.add(id);
  }
}
