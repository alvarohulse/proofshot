import * as fs from 'fs';
import * as path from 'path';

const SESSION_FILENAME = '.session.json';
const SESSION_LOCK_FILENAME = '.session.lock';

export interface SessionState {
  startedAt: string;
  startDirectory?: string;
  lifecycleStatus?: 'starting' | 'active' | 'stopped';
  ownerPid?: number | null;
  description: string | null;
  outputDir: string;
  sessionDir: string;
  sessionName: string;
  browserConfigPath?: string | null;
  headless?: boolean;
  videoPath: string;
  serverErrorLog: string;
  port: number;
  serverCommand: string | null;
  serverOwnershipToken?: string | null;
  serverProcessStartTime?: string | null;
  serverPid?: number | null;
  serverAlreadyRunning: boolean;
  recordingActive: boolean;
  viewport?: { width: number; height: number };
}

/**
 * Write session state to disk.
 */
export function saveSession(state: SessionState): void {
  const sessionPath = path.join(state.outputDir, SESSION_FILENAME);
  fs.writeFileSync(sessionPath, JSON.stringify(state, null, 2) + '\n');
}

export function reserveOutputSession(outputDir: string, sessionName: string): void {
  const lockPath = path.join(outputDir, SESSION_LOCK_FILENAME);
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.pid,
      sessionName,
      createdAt: new Date().toISOString(),
    }) + '\n',
    { flag: 'wx' },
  );
}

/**
 * Read session state from disk.
 * Returns null if no active session.
 */
export function loadSession(outputDir: string): SessionState | null {
  const sessionPath = path.join(outputDir, SESSION_FILENAME);
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
export function hasActiveSession(outputDir: string): boolean {
  return (
    fs.existsSync(path.join(outputDir, SESSION_FILENAME)) ||
    fs.existsSync(path.join(outputDir, SESSION_LOCK_FILENAME))
  );
}

/**
 * Delete the session state file (called after stop).
 */
export function clearSession(outputDir: string, sessionName?: string): void {
  const sessionPath = path.join(outputDir, SESSION_FILENAME);
  const lockPath = path.join(outputDir, SESSION_LOCK_FILENAME);
  if (
    fs.existsSync(sessionPath) &&
    (sessionName === undefined || readSessionName(sessionPath) === sessionName)
  ) {
    fs.unlinkSync(sessionPath);
  }
  if (
    fs.existsSync(lockPath) &&
    (sessionName === undefined || readSessionName(lockPath) === sessionName)
  ) {
    fs.unlinkSync(lockPath);
  }
}

function readSessionName(filePath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      sessionName?: unknown;
    };
    return typeof parsed.sessionName === 'string' ? parsed.sessionName : null;
  } catch {
    return null;
  }
}

/**
 * Generate a deterministic agent-browser session name for a ProofShot run.
 */
export function generateAgentBrowserSessionName(seed: string): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized ? `proofshot-${normalized}` : 'proofshot';
}
