import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ab } from '../utils/exec.js';
import { loadSession, type SessionState } from './state.js';

const PROOFSHOT_STATE_DIRECTORY = 'proofshot';
const SESSION_REGISTRY_DIRECTORY = 'sessions';

type AgentBrowserSessionListResponse = {
  success?: boolean;
  data?: {
    sessions?: unknown;
  };
};

export type SessionResolutionOptions = {
  sessionName?: string;
  workingDirectory?: string;
  legacyOutputDir?: string;
  registryDir?: string;
  activeBrowserSessionNames?: Set<string> | null;
};

export class SessionSelectionError extends Error {
  constructor(
    message: string,
    public readonly sessions: SessionState[],
  ) {
    super(message);
    this.name = 'SessionSelectionError';
  }
}

export function getSessionRegistryDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const stateHome = env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state');
  return path.join(stateHome, PROOFSHOT_STATE_DIRECTORY, SESSION_REGISTRY_DIRECTORY);
}

export function registerSession(
  session: SessionState,
  registryDir = getSessionRegistryDir(),
): void {
  validateSessionName(session.sessionName);
  fs.mkdirSync(registryDir, { recursive: true });

  const registryPath = getRegistryPath(session.sessionName, registryDir);
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(session, null, 2) + '\n');
  fs.renameSync(temporaryPath, registryPath);
}

export function reserveSession(
  session: SessionState,
  registryDir = getSessionRegistryDir(),
): void {
  validateSessionName(session.sessionName);
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    getRegistryPath(session.sessionName, registryDir),
    JSON.stringify(session, null, 2) + '\n',
    { flag: 'wx' },
  );
}

export function unregisterSession(
  sessionName: string,
  registryDir = getSessionRegistryDir(),
): void {
  validateSessionName(sessionName);
  const registryPath = getRegistryPath(sessionName, registryDir);
  if (fs.existsSync(registryPath)) {
    fs.unlinkSync(registryPath);
  }
}

export function listRegisteredSessions(
  registryDir = getSessionRegistryDir(),
): SessionState[] {
  if (!fs.existsSync(registryDir)) {
    return [];
  }

  return fs
    .readdirSync(registryDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => readRegisteredSession(path.join(registryDir, fileName)))
    .filter((session): session is SessionState => session !== null)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function resolveSession(options: SessionResolutionOptions = {}): SessionState | null {
  const registeredSessions = listRegisteredSessions(options.registryDir);
  const legacySession = loadLegacySession(options.legacyOutputDir);
  const sessions = legacySession
    ? [
        ...registeredSessions.filter(
          (session) => session.sessionName !== legacySession.sessionName,
        ),
        legacySession,
      ]
    : registeredSessions;

  if (options.sessionName) {
    const explicitSession = sessions.find(
      (session) => session.sessionName === options.sessionName,
    );
    if (explicitSession) {
      return explicitSession;
    }

    throw new SessionSelectionError(
      `No active ProofShot session named "${options.sessionName}".`,
      sessions,
    );
  }

  const selectableSessions =
    options.activeBrowserSessionNames instanceof Set
      ? sessions.filter((session) =>
          options.activeBrowserSessionNames?.has(session.sessionName),
        )
      : sessions;
  const workingDirectory = canonicalizeDirectory(
    options.workingDirectory || process.cwd(),
  );
  const directoryMatches = selectableSessions.filter(
    (session) =>
      session.startDirectory !== undefined &&
      canonicalizeDirectory(session.startDirectory) === workingDirectory,
  );

  if (directoryMatches.length === 1) {
    return directoryMatches[0];
  }
  if (directoryMatches.length > 1) {
    throw new SessionSelectionError(
      `Multiple ProofShot sessions were started from ${workingDirectory}.`,
      directoryMatches,
    );
  }

  if (selectableSessions.length === 1) {
    return selectableSessions[0];
  }
  if (selectableSessions.length > 1) {
    throw new SessionSelectionError(
      'Multiple active ProofShot sessions were found.',
      selectableSessions,
    );
  }
  if (sessions.length > 0) {
    throw new SessionSelectionError(
      'Only orphaned ProofShot sessions were found.',
      sessions,
    );
  }

  return null;
}

export function listActiveBrowserSessionNames(): Set<string> {
  const raw = ab('session list --json');
  const parsed = JSON.parse(raw) as AgentBrowserSessionListResponse;
  const sessions = parsed.data?.sessions;

  if (!Array.isArray(sessions) || !sessions.every((session) => typeof session === 'string')) {
    throw new Error('agent-browser returned an invalid session list');
  }

  return new Set(sessions);
}

export function formatSessionChoices(sessions: SessionState[]): string {
  if (sessions.length === 0) {
    return '  No registered sessions.';
  }

  return sessions
    .map((session) => {
      const startDirectory = session.startDirectory || 'unknown directory';
      return `  ${session.sessionName}  ${startDirectory}  →  ${session.outputDir}`;
    })
    .join('\n');
}

function getRegistryPath(sessionName: string, registryDir: string): string {
  return path.join(registryDir, `${sessionName}.json`);
}

function validateSessionName(sessionName: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
    throw new Error(`Invalid ProofShot session name: ${sessionName}`);
  }
}

function readRegisteredSession(registryPath: string): SessionState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as unknown;
    return isSessionState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadLegacySession(outputDir?: string): SessionState | null {
  return outputDir ? loadSession(path.resolve(outputDir)) : null;
}

function canonicalizeDirectory(directory: string): string {
  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync.native(directory);
  } catch {
    canonicalPath = path.resolve(directory);
  }
  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
}

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const session = value as Record<string, unknown>;
  return (
    typeof session.startedAt === 'string' &&
    isOptionalString(session.startDirectory) &&
    isOptionalLifecycleStatus(session.lifecycleStatus) &&
    isOptionalNullableNumber(session.ownerPid) &&
    (typeof session.description === 'string' || session.description === null) &&
    typeof session.outputDir === 'string' &&
    typeof session.sessionDir === 'string' &&
    typeof session.sessionName === 'string' &&
    isOptionalNullableString(session.browserConfigPath) &&
    isOptionalBoolean(session.headless) &&
    typeof session.videoPath === 'string' &&
    typeof session.serverErrorLog === 'string' &&
    typeof session.port === 'number' &&
    (typeof session.serverCommand === 'string' || session.serverCommand === null) &&
    isOptionalNullableString(session.serverOwnershipToken) &&
    isOptionalNullableString(session.serverProcessStartTime) &&
    isOptionalNullableNumber(session.serverPid) &&
    typeof session.serverAlreadyRunning === 'boolean' &&
    typeof session.recordingActive === 'boolean' &&
    isOptionalViewport(session.viewport)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalNullableNumber(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'number';
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalLifecycleStatus(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'starting' ||
    value === 'active' ||
    value === 'stopped'
  );
}

function isOptionalViewport(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const viewport = value as Record<string, unknown>;
  return typeof viewport.width === 'number' && typeof viewport.height === 'number';
}
