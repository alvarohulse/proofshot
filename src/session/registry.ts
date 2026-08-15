import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  captureProcessIdentity,
  processIdentityMatches,
  type ProcessIdentity,
} from '../utils/process.js';
import type {
  SessionOperationKind,
  SessionOperationLease,
  SessionState,
} from './state.js';

const SESSION_REGISTRY_DIRECTORY = 'sessions';

export function getSessionRegistryDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.userInfo().homedir,
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

export function claimSessionOperation(
  session: SessionState,
  kind: SessionOperationKind,
  registryDir = getSessionRegistryDir(),
): SessionOperationLease {
  validateSessionName(session.sessionName);
  if (
    session.operationLease &&
    processIdentityMatches(session.operationLease.owner)
  ) {
    throw new Error(
      `ProofShot session ${session.sessionName} already has a live ${session.operationLease.kind} operation.`,
    );
  }
  const owner = captureProcessIdentity(process.pid);
  if (!owner) {
    throw new Error('Could not capture immutable ownership for this ProofShot operation.');
  }
  const lease: SessionOperationLease = {
    id: randomUUID(),
    kind,
    owner,
    startedAt: new Date().toISOString(),
  };
  prepareRegistryDirectory(registryDir);
  const lockPath = getOperationLockPath(session.sessionName, registryDir);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let lockDescriptor: number;
    try {
      lockDescriptor = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      const existingLease = readOperationLease(lockPath);
      if (!existingLease) {
        throw new Error(
          `ProofShot operation lock is corrupt or unsafe: ${lockPath}`,
        );
      }
      if (processIdentityMatches(existingLease.owner)) {
        throw new Error(
          `ProofShot session ${session.sessionName} already has a live ${existingLease.kind} operation.`,
        );
      }
      reclaimStaleOperationLock(lockPath, existingLease);
      continue;
    }

    try {
      fs.writeFileSync(lockDescriptor, JSON.stringify(lease, null, 2) + '\n');
    } finally {
      fs.closeSync(lockDescriptor);
    }
    try {
      session.operationLease = lease;
      registerSession(session, registryDir);
      return lease;
    } catch (error) {
      removeOwnedOperationLock(lockPath, lease);
      throw error;
    }
  }
  throw new Error(`Could not claim ProofShot operation lock: ${lockPath}`);
}

export function releaseSessionOperation(
  session: SessionState,
  lease: SessionOperationLease,
  registryDir = getSessionRegistryDir(),
): void {
  validateSessionName(session.sessionName);
  const lockPath = getOperationLockPath(session.sessionName, registryDir);
  if (!fs.existsSync(lockPath)) {
    throw new Error(`ProofShot operation lock disappeared: ${lockPath}`);
  }
  const currentLease = readOperationLease(lockPath);
  if (!currentLease || currentLease.id !== lease.id) {
    throw new Error(
      `ProofShot operation lock no longer belongs to ${lease.id}: ${lockPath}`,
    );
  }

  const registeredSession = getRegisteredSession(session.sessionName, registryDir);
  if (registeredSession?.operationLease?.id === lease.id) {
    delete registeredSession.operationLease;
    registerSession(registeredSession, registryDir);
  } else if (registeredSession?.operationLease) {
    throw new Error(
      `ProofShot session operation no longer belongs to ${lease.id}: ${session.sessionName}`,
    );
  }
  fs.unlinkSync(lockPath);
  delete session.operationLease;
}

export function sessionHasLiveOperation(
  session: SessionState,
  registryDir = getSessionRegistryDir(),
): boolean {
  validateSessionName(session.sessionName);
  const lockPath = getOperationLockPath(session.sessionName, registryDir);
  if (fs.existsSync(lockPath)) {
    const lease = readOperationLease(lockPath);
    if (!lease) {
      throw new Error(`ProofShot operation lock is corrupt or unsafe: ${lockPath}`);
    }
    if (processIdentityMatches(lease.owner)) {
      return true;
    }
  }
  return Boolean(
    session.operationLease && processIdentityMatches(session.operationLease.owner),
  );
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

function getOperationLockPath(sessionName: string, registryDir: string): string {
  return path.join(registryDir, `${sessionName}.operation.lock`);
}

function reclaimStaleOperationLock(
  lockPath: string,
  expectedLease: SessionOperationLease,
): void {
  const reclaimPath = `${lockPath}.reclaim`;
  try {
    fs.mkdirSync(reclaimPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`ProofShot operation lock is already being recovered: ${lockPath}`);
    }
    throw error;
  }

  try {
    const currentLease = readOperationLease(lockPath);
    if (!currentLease) {
      throw new Error(`ProofShot operation lock is corrupt or unsafe: ${lockPath}`);
    }
    if (currentLease.id !== expectedLease.id) {
      return;
    }
    if (processIdentityMatches(currentLease.owner)) {
      throw new Error(
        `ProofShot session already has a live ${currentLease.kind} operation.`,
      );
    }
    fs.unlinkSync(lockPath);
  } finally {
    fs.rmdirSync(reclaimPath);
  }
}

function removeOwnedOperationLock(
  lockPath: string,
  expectedLease: SessionOperationLease,
): void {
  if (!fs.existsSync(lockPath)) {
    return;
  }
  const currentLease = readOperationLease(lockPath);
  if (currentLease?.id === expectedLease.id) {
    fs.unlinkSync(lockPath);
  }
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

function readOperationLease(lockPath: string): SessionOperationLease | null {
  try {
    const stat = fs.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as unknown;
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const lease = value as Partial<SessionOperationLease>;
    return (
      typeof lease.id === 'string' &&
      ['exec', 'recovery', 'start', 'stop'].includes(lease.kind || '') &&
      isOptionalProcessIdentity(lease.owner) &&
      lease.owner !== undefined &&
      lease.owner !== null &&
      typeof lease.startedAt === 'string'
    )
      ? (lease as SessionOperationLease)
      : null;
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
    isOptionalString(session.agentBrowserSocketDir) &&
    isOptionalString(session.agentBrowserSocketRoot) &&
    isOptionalString(session.agentBrowserNamespace) &&
    isOptionalStringArray(session.agentBrowserAllowedDomains) &&
    isOptionalString(session.agentBrowserConfigPath) &&
    isOptionalString(session.agentBrowserVersion) &&
    isOptionalString(session.privateEvidenceDir) &&
    isOptionalString(session.networkHarPath) &&
    isOptionalString(session.networkRequestsPath) &&
    isOptionalString(session.networkSummaryPath) &&
    isOptionalOperationLease(session.operationLease) &&
    isOptionalBoolean(session.networkCaptureStarted) &&
    isOptionalBoolean(session.networkCaptureActive) &&
    isOptionalBoolean(session.networkEvidenceAvailable) &&
    (session.networkCaptureError === undefined ||
      session.networkCaptureError === null ||
      typeof session.networkCaptureError === 'string') &&
    isOptionalProcessIdentity(session.serverProcess) &&
    isOptionalProcessIdentity(session.browserProcess)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalOperationLease(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const lease = value as Partial<SessionOperationLease>;
  return (
    typeof lease.id === 'string' &&
    ['exec', 'recovery', 'start', 'stop'].includes(lease.kind || '') &&
    typeof lease.startedAt === 'string' &&
    isOptionalProcessIdentity(lease.owner) &&
    lease.owner !== undefined &&
    lease.owner !== null
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
