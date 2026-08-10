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
  | {
      kind: 'external-command';
      command: string;
      stopCommand?: string;
      timeoutMs?: number;
    };

export type TmuxConnectionConfig = {
  source?: 'stdout';
  format: 'json' | 'tmux-attach-command';
  socket?: string;
  ownership?: 'attach' | 'create';
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
    }
  | {
      id: string;
      title?: string;
      group?: EnvironmentGroup;
      kind: 'process';
      processId: string;
    }
  | {
      id: string;
      title?: string;
      group?: EnvironmentGroup;
      kind: 'file';
      path: string;
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
  captureAttached: boolean;
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
  healthFailures?: string[];
  stopCommand?: string;
  stopCwd?: string;
};

export type ProcessEnvironmentState = {
  kind: 'processes';
  evidencePath: string;
  sources: ResolvedLogSourceState[];
  processes: CaptureProcessState[];
  healthFailures?: string[];
};

export type LauncherEnvironmentState = {
  kind: 'launcher';
  evidencePath: string;
  sources: [];
  launcher: CaptureProcessState;
};

export type EnvironmentState =
  | TmuxEnvironmentState
  | ProcessEnvironmentState
  | LauncherEnvironmentState;

export type ResolvedLogSourceState = {
  id: string;
  title: string;
  group: EnvironmentGroup;
  kind: LogSourceConfig['kind'];
  stream: EvidenceEvent['stream'];
  logPath: string;
};

export type EvidenceEvent = {
  version: 1;
  origin: 'environment' | 'browser';
  group: string;
  sourceId: string;
  sourceTitle: string;
  navigationId?: string;
  pageUrl?: string;
  stream: 'pty' | 'stdout' | 'stderr' | 'file' | 'console';
  segment: 'history' | 'live';
  timestamp: string | null;
  relativeTimeSec: number | null;
  text: string;
  presentationHidden?: boolean;
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
