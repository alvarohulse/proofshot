import * as fs from 'fs';
import * as path from 'path';
import type { AgentBrowserResultReceipt } from '../browser/evidence.js';
import { sanitizeDiagnosticMessage } from '../browser/provenance.js';
import type {
  InteractionCategory,
  SanitizedCommandIntent,
} from '../browser/provenance.js';

const SESSION_LOG_FILENAME = 'session-log.json';
const SESSION_LOG_LOCK_TIMEOUT_MS = 5000;
const SESSION_LOG_STALE_LOCK_MS = 120000;

export type SessionLogEntry = {
  action: string;
  category?: InteractionCategory;
  intent?: SanitizedCommandIntent;
  relativeTimeSec: number;
  timestamp: string;
  durationMs?: number;
  outcome?: 'passed' | 'failed';
  expectedSelector?: string;
  error?: string;
  pageUrl?: string;
  agentBrowserResult?: AgentBrowserResultReceipt;
  element?: {
    label: string;
    bbox: { x: number; y: number; width: number; height: number };
    viewport: { width: number; height: number };
  };
};

export function loadSessionLog(sessionDir: string): SessionLogEntry[] {
  const logPath = path.join(sessionDir, SESSION_LOG_FILENAME);
  if (!fs.existsSync(logPath)) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    if (!Array.isArray(parsed)) {
      throw new Error('session log root must be an array');
    }
    return parsed as SessionLogEntry[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ProofShot session action log is corrupt: ${logPath}\n${message}`);
  }
}

export function appendSessionLogEntry(
  sessionDir: string,
  entry: SessionLogEntry,
): string {
  const logPath = path.join(sessionDir, SESSION_LOG_FILENAME);
  updateSessionLog(logPath, (entries) => {
    entries.push(sanitizeSessionLogEntry(entry));
  });
  return logPath;
}

export function persistSessionLogEntry(
  logPath: string,
  entry: SessionLogEntry,
): void {
  updateSessionLog(logPath, (entries) => {
    const matchingEntry = [...entries]
      .reverse()
      .find(
        (candidate) =>
          candidate.timestamp === entry.timestamp &&
          candidate.action === entry.action,
      );
    if (matchingEntry) {
      Object.assign(matchingEntry, sanitizeSessionLogEntry(entry));
    }
  });
}

export function sanitizeSessionLogEntry(entry: SessionLogEntry): SessionLogEntry {
  return {
    ...entry,
    action: sanitizeDiagnosticMessage(entry.action) || '[REDACTED]',
    intent: entry.intent
      ? {
          ...entry.intent,
          summary:
            sanitizeDiagnosticMessage(entry.intent.summary) || '[REDACTED]',
        }
      : undefined,
    expectedSelector: sanitizeDiagnosticMessage(entry.expectedSelector),
    error: sanitizeDiagnosticMessage(entry.error),
    pageUrl: sanitizeDiagnosticMessage(entry.pageUrl),
    element: entry.element
      ? {
          ...entry.element,
          label: sanitizeDiagnosticMessage(entry.element.label) || '',
        }
      : undefined,
  };
}

function updateSessionLog(
  logPath: string,
  update: (entries: SessionLogEntry[]) => void,
): void {
  const lockPath = `${logPath}.lock`;
  const deadline = Date.now() + SESSION_LOG_LOCK_TIMEOUT_MS;
  let lockDescriptor: number | null = null;
  while (lockDescriptor === null) {
    try {
      lockDescriptor = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      try {
        if (
          Date.now() - fs.statSync(lockPath).mtimeMs >
          SESSION_LOG_STALE_LOCK_MS
        ) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for session log lock: ${lockPath}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }

  try {
    const entries = loadSessionLog(path.dirname(logPath));
    update(entries);
    const temporaryPath = `${logPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(entries, null, 2) + '\n', {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, logPath);
  } finally {
    fs.closeSync(lockDescriptor);
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
