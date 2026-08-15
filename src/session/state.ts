import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { EnvironmentState } from '../environment/types.js';
import type { ProcessIdentity } from '../utils/process.js';

export type SessionOperationKind = 'exec' | 'recovery' | 'start' | 'stop';

export type SessionOperationLease = {
  id: string;
  kind: SessionOperationKind;
  owner: ProcessIdentity;
  startedAt: string;
};

export interface SessionState {
  startedAt: string;
  recordingStartedAt?: string;
  stoppedAt?: string;
  startDirectory?: string;
  controlDir?: string;
  lifecycleStatus?: 'starting' | 'active' | 'stopping' | 'recovery';
  cleanupError?: string | null;
  operationLease?: SessionOperationLease;
  description: string | null;
  outputDir: string;
  sessionDir: string;
  sessionName: string;
  videoPath: string;
  serverErrorLog: string;
  port: number;
  serverCommand: string | null;
  serverAlreadyRunning: boolean;
  recordingActive: boolean;
  browserLaunchAttempted?: boolean;
  bundleComplete?: boolean;
  browserRetained?: boolean;
  videoTrimComplete?: boolean;
  trimOffsetSec?: number;
  sessionLogAdjusted?: boolean;
  consoleEvidenceAvailable?: boolean;
  consoleErrorCount?: number;
  targetUrl?: string;
  headless?: boolean;
  agentBrowserSocketDir?: string;
  agentBrowserSocketRoot?: string;
  agentBrowserNamespace?: string;
  agentBrowserAllowedDomains?: string[];
  agentBrowserConfigPath?: string;
  privateEvidenceDir?: string;
  networkHarPath?: string;
  networkRequestsPath?: string;
  networkSummaryPath?: string;
  networkCaptureStarted?: boolean;
  networkCaptureActive?: boolean;
  networkEvidenceAvailable?: boolean;
  networkCaptureError?: string | null;
  serverProcess?: ProcessIdentity | null;
  browserProcess?: ProcessIdentity | null;
  environment?: EnvironmentState | null;
  environmentStopped?: boolean;
  viewport?: { width: number; height: number };
}

/**
 * Resolve the stable control directory for a project.
 *
 * CLI-only `--output` overrides choose where evidence is written, but active
 * control state remains in the configured/default output directory so a later
 * `proofshot exec` or `proofshot stop` process can always find it.
 */
export function resolveSessionControlDir(
  configuredOutput: string,
  cwd = process.cwd(),
): string {
  return path.resolve(cwd, configuredOutput);
}

/**
 * Generate a deterministic agent-browser session name for a ProofShot run.
 */
export function generateAgentBrowserSessionName(
  seed: string,
  nonce: string = randomUUID(),
): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 8)
    .replace(/-+$/g, '');
  const digest = createHash('sha256')
    .update(`${seed}\0${nonce}`)
    .digest('hex')
    .slice(0, 12);

  return normalized ? `ps-${normalized}-${digest}` : `ps-${digest}`;
}

export function generateAgentBrowserNamespace(sessionName: string): string {
  const digest = createHash('sha256').update(sessionName).digest('hex').slice(0, 12);
  return `psn-${digest}`;
}
