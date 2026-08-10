import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { ProcessIdentity } from '../utils/process.js';

const SESSION_FILENAME = '.session.json';

export interface SessionState {
  startedAt: string;
  startDirectory?: string;
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
  agentBrowserConfigPath?: string;
  serverProcess?: ProcessIdentity | null;
  browserProcess?: ProcessIdentity | null;
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
 * Write session state to disk.
 */
export function saveSession(state: SessionState, controlDir = state.outputDir): void {
  fs.mkdirSync(controlDir, { recursive: true });
  const sessionPath = path.join(controlDir, SESSION_FILENAME);
  const temporaryPath = `${sessionPath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2) + '\n', {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, sessionPath);
}

/**
 * Read session state from disk.
 * Returns null if no active session.
 */
export function loadSession(controlDir: string): SessionState | null {
  const sessionPath = path.join(controlDir, SESSION_FILENAME);
  if (!fs.existsSync(sessionPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check if a session is currently active.
 */
export function hasActiveSession(controlDir: string): boolean {
  return fs.existsSync(path.join(controlDir, SESSION_FILENAME));
}

/**
 * Delete the session state file (called after stop).
 */
export function clearSession(controlDir: string): void {
  const sessionPath = path.join(controlDir, SESSION_FILENAME);
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

/**
 * Generate a deterministic agent-browser session name for a ProofShot run.
 */
export function generateAgentBrowserSessionName(
  seed: string,
  nonce = randomUUID(),
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
