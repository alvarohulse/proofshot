import type { ProcessIdentity } from '../utils/process.js';

export type EnvironmentGroup = 'frontend' | 'backend' | string;

export type ReadinessCheck =
  | { kind: 'http'; url: string; timeoutMs?: number }
  | { kind: 'tcp'; host?: string; port: number; timeoutMs?: number };

export type TmuxPaneDefinition = {
  id: string;
  title?: string;
  group?: EnvironmentGroup;
  cwd?: string;
  command: string;
  env?: Record<string, string>;
};

export type TmuxLaunchConfig =
  | { kind: 'panes'; panes: TmuxPaneDefinition[]; sessionName?: string }
  | { kind: 'external-command'; command: string; stopCommand?: string };

export type TmuxConnectionConfig = {
  source?: 'stdout';
  format: 'json' | 'tmux-attach-command';
  socket?: string;
};

export type TmuxEnvironmentConfig = {
  kind: 'tmux';
  launch: TmuxLaunchConfig;
  cwd?: string;
  connection?: TmuxConnectionConfig;
  readiness?: ReadinessCheck[];
};

export type ProcessDefinition = {
  id: string;
  title?: string;
  group?: EnvironmentGroup;
  cwd?: string;
  command: string;
  env?: Record<string, string>;
};

export type ProcessesEnvironmentConfig = {
  kind: 'processes';
  commands: ProcessDefinition[];
  readiness?: ReadinessCheck[];
};

export type EnvironmentConfig = TmuxEnvironmentConfig | ProcessesEnvironmentConfig;

export type TmuxPaneMatch =
  | { connectionKey: string }
  | { tag: string }
  | { target: string };

export type LogSourceConfig =
  | {
      id: string;
      title?: string;
      group?: EnvironmentGroup;
      kind: 'tmux-pane';
      match: TmuxPaneMatch;
      include?: string[];
      exclude?: string[];
    }
  | {
      id: string;
      title?: string;
      group?: EnvironmentGroup;
      kind: 'process';
      processId: string;
      include?: string[];
      exclude?: string[];
    }
  | {
      id: string;
      title?: string;
      group?: EnvironmentGroup;
      kind: 'file';
      path: string;
      include?: string[];
      exclude?: string[];
    };

export type LogsConfig = {
  stripAnsi?: boolean;
  maxBytesPerSource?: number;
  sources?: LogSourceConfig[];
};

export type SocketIdentity = {
  path: string;
  inode: number;
  uid: number;
};

export type CaptureProcessState = {
  sourceId: string;
  process: ProcessIdentity;
  pidFile: string;
};

export type TmuxPaneState = {
  paneId: string;
  paneIndex: number;
  panePid: number;
  sourceId: string;
  title: string;
  group: EnvironmentGroup;
  target: string;
};

export type TmuxEnvironmentState = {
  kind: 'tmux';
  evidencePath: string;
  sources: ResolvedLogSourceState[];
  socket: SocketIdentity;
  serverProcess: ProcessIdentity;
  sessionName: string;
  ownsServer: boolean;
  ownsSession: boolean;
  panes: TmuxPaneState[];
  captures: CaptureProcessState[];
  stopCommand?: string;
  stopCwd?: string;
};

export type ProcessEnvironmentState = {
  kind: 'processes';
  evidencePath: string;
  sources: ResolvedLogSourceState[];
  processes: CaptureProcessState[];
};

export type EnvironmentState = TmuxEnvironmentState | ProcessEnvironmentState;

export type ResolvedLogSourceState = {
  id: string;
  title: string;
  group: EnvironmentGroup;
  kind: LogSourceConfig['kind'];
  stream: EvidenceEvent['stream'];
  logPath: string;
  include?: string[];
  exclude?: string[];
};

export type EvidenceEvent = {
  version: 1;
  origin: 'environment' | 'browser';
  group: string;
  sourceId: string;
  sourceTitle: string;
  stream: 'pty' | 'stdout' | 'stderr' | 'file' | 'console';
  segment: 'history' | 'live';
  timestamp: string | null;
  relativeTimeSec: number | null;
  text: string;
  truncated?: boolean;
  captureGap?: boolean;
};

export type ExternalTmuxConnection = {
  tmux: {
    socket: string;
    session: string;
    panes?: Array<{
      key: string;
      paneId: string;
      title?: string;
      group?: EnvironmentGroup;
    }>;
  };
};
