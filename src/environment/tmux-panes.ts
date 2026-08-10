import * as path from 'path';
import { tmuxExec } from './tmux-command.js';
import type { PaneMapping, TmuxConnection } from './tmux-launch.js';
import type {
  LogSourceConfig,
  LogsConfig,
  ResolvedLogSourceState,
  TmuxEnvironmentConfig,
  TmuxPaneState,
} from './types.js';

export type ResolvedTmuxPane = {
  pane: TmuxPaneState;
  source: ResolvedLogSourceState;
};

type TmuxSource = {
  config: Extract<LogSourceConfig, { kind: 'tmux-pane' }>;
  mapping?: PaneMapping;
};

export function resolveTmuxPanes(
  config: TmuxEnvironmentConfig,
  logs: LogsConfig,
  connection: TmuxConnection,
  logsDir: string,
): ResolvedTmuxPane[] {
  const panes = resolveTmuxSources(config, logs, connection).map(
    ({ config: sourceConfig, mapping }) =>
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
  return panes;
}

function resolveTmuxSources(
  config: TmuxEnvironmentConfig,
  logs: LogsConfig,
  connection: TmuxConnection,
): TmuxSource[] {
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
): ResolvedTmuxPane {
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

function disambiguateTitles(panes: ResolvedTmuxPane[]): void {
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
