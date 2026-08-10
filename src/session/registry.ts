import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ProcessIdentity } from '../utils/process.js';
import type { SessionState } from './state.js';

const SESSION_REGISTRY_DIRECTORY = 'sessions';

export function getSessionRegistryDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const stateHome = env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state');
  return path.join(stateHome, 'proofshot', SESSION_REGISTRY_DIRECTORY);
}

export function registerSession(
  session: SessionState,
  registryDir = getSessionRegistryDir(),
): void {
  validateSessionName(session.sessionName);
  prepareRegistryDirectory(registryDir);
  const registryPath = getRegistryPath(session.sessionName, registryDir);
  const temporaryPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(session, null, 2) + '\n', {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, registryPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
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
  assertOwnedDirectory(registryDir);

  return fs
    .readdirSync(registryDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => readRegisteredSession(path.join(registryDir, fileName)))
    .filter((session): session is SessionState => session !== null)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function getRegisteredSession(
  sessionName: string,
  registryDir = getSessionRegistryDir(),
): SessionState | null {
  validateSessionName(sessionName);
  return readRegisteredSession(getRegistryPath(sessionName, registryDir));
}

function prepareRegistryDirectory(registryDir: string): void {
  fs.mkdirSync(registryDir, { recursive: true, mode: 0o700 });
  assertOwnedDirectory(registryDir);
}

function assertOwnedDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`ProofShot session registry is not a real directory: ${directory}`);
  }

  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(
      `ProofShot session registry is owned by uid ${stat.uid}, expected ${uid}: ${directory}`,
    );
  }
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  if (uid !== undefined) {
    fs.chmodSync(directory, 0o700);
  }
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
    const stat = fs.lstatSync(registryPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as unknown;
    return isSessionState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const session = value as Record<string, unknown>;
  return (
    typeof session.startedAt === 'string' &&
    (typeof session.description === 'string' || session.description === null) &&
    typeof session.outputDir === 'string' &&
    typeof session.sessionDir === 'string' &&
    typeof session.sessionName === 'string' &&
    typeof session.videoPath === 'string' &&
    typeof session.serverErrorLog === 'string' &&
    typeof session.port === 'number' &&
    (typeof session.serverCommand === 'string' || session.serverCommand === null) &&
    typeof session.serverAlreadyRunning === 'boolean' &&
    typeof session.recordingActive === 'boolean' &&
    isOptionalProcessIdentity(session.serverProcess) &&
    isOptionalProcessIdentity(session.browserProcess)
  );
}

function isOptionalProcessIdentity(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== 'object') {
    return false;
  }

  const identity = value as Partial<ProcessIdentity>;
  return (
    Number.isInteger(identity.pid) &&
    Number.isInteger(identity.processGroupId) &&
    Number.isInteger(identity.sessionId) &&
    typeof identity.startTime === 'string'
  );
}
