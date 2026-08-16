import * as fs from 'fs';
import { isIP } from 'net';
import {
  execFileSync,
  execSync,
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'child_process';

type ExecSyncLike = typeof execSync;

/**
 * Immutable identity for a process which started an isolated process session.
 *
 * A PID alone is not sufficient ownership proof because the operating system
 * can reuse it. `startTime` lets cleanup reject a recycled PID, while the
 * process/session group ids let ProofShot terminate only descendants created
 * by the detached process it started.
 */
export interface ProcessIdentity {
  pid: number;
  processGroupId: number;
  sessionId: number;
  startTime: string;
  /** Stable boot token preventing cross-boot PID/start-time collisions. */
  bootId?: string;
}

export interface TerminateProcessTreeOptions {
  graceMs?: number;
  pollIntervalMs?: number;
}

export interface WindowsProcessRecord {
  parentPid: number;
  startTime: string;
}

const WINDOWS_PROCESS_ANCESTRY_LIMIT = 256;
const WINDOWS_TCP_STATES = new Set([
  'BOUND',
  'CLOSED',
  'CLOSE_WAIT',
  'CLOSING',
  'DELETE_TCB',
  'ESTABLISHED',
  'FIN_WAIT_1',
  'FIN_WAIT_2',
  'LAST_ACK',
  'LISTENING',
  'SYN_RECEIVED',
  'SYN_SENT',
  'TIME_WAIT',
]);

export function getShellExecutable(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') {
    return env.ComSpec || 'cmd.exe';
  }

  return env.SHELL || '/bin/sh';
}

export function spawnShellCommand(
  command: string,
  options: Omit<SpawnOptions, 'shell'> = {},
): ChildProcess {
  return spawn(command, {
    ...options,
    shell: getShellExecutable(),
  });
}

/** Parse the ownership fields from Linux `/proc/<pid>/stat`. */
export function parseLinuxProcStat(stat: string): ProcessIdentity | null {
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return null;

  const pid = Number(stat.slice(0, stat.indexOf(' ')));
  const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  const startTime = fields[19];

  if (
    !Number.isInteger(pid) ||
    !Number.isInteger(processGroupId) ||
    !Number.isInteger(sessionId) ||
    !startTime
  ) {
    return null;
  }

  return { pid, processGroupId, sessionId, startTime };
}

/** Parse the ownership fields emitted by BSD/POSIX ps implementations. */
export function parseUnixProcessIdentity(
  pid: number,
  output: string,
): ProcessIdentity | null {
  const match = output.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return null;

  const processGroupId = Number(match[1]);
  const sessionId = Number(match[2]);
  const startTime = match[3];
  if (
    !Number.isInteger(processGroupId) ||
    processGroupId <= 0 ||
    !Number.isInteger(sessionId) ||
    sessionId < 0 ||
    !startTime
  ) {
    return null;
  }

  return { pid, processGroupId, sessionId, startTime };
}

/**
 * Detached children are session leaders on Linux and process-group leaders on
 * macOS, whose ps implementation reports a zero session id.
 */
export function isDetachedProcessIdentity(
  identity: ProcessIdentity,
  platform = process.platform,
): boolean {
  if (platform === 'darwin') {
    return identity.processGroupId === identity.pid;
  }
  return identity.sessionId === identity.pid;
}

/**
 * Capture the current immutable identity for a process.
 * Returns null when the process is already gone or cannot be inspected.
 */
export function captureProcessIdentity(pid: number): ProcessIdentity | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  if (process.platform === 'linux') {
    try {
      const identity = parseLinuxProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf-8'));
      const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim();
      if (!identity || !bootId) return null;
      return { ...identity, bootId };
    } catch {
      return null;
    }
  }

  if (process.platform !== 'win32') {
    try {
      const sessionField = process.platform === 'darwin' ? 'sess=' : 'sid=';
      const output = execFileSync(
        'ps',
        ['-o', 'pgid=', '-o', sessionField, '-o', 'lstart=', '-p', String(pid)],
        {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, TZ: 'UTC' },
        },
      );
      const identity = parseUnixProcessIdentity(pid, output);
      if (!identity) return null;
      if (process.platform !== 'darwin') return identity;
      const bootId = execFileSync('sysctl', ['-n', 'kern.boottime'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      return bootId ? { ...identity, bootId } : null;
    } catch {
      return null;
    }
  }

  // PowerShell exposes the process creation timestamp. If that immutable token
  // cannot be read, refuse ownership instead of treating a reusable PID as
  // sufficient proof for taskkill /T.
  try {
    const script =
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
    const startTime = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!/^\d+$/.test(startTime)) return null;
    return { pid, processGroupId: pid, sessionId: pid, startTime };
  } catch {
    return null;
  }
}

export function processIdentityMatches(identity: ProcessIdentity): boolean {
  const current = captureProcessIdentity(identity.pid);
  return Boolean(current && processIdentitiesMatch(current, identity));
}

export function processIdentitiesMatch(
  left: ProcessIdentity,
  right: ProcessIdentity,
): boolean {
  return (
    left.pid === right.pid &&
    left.processGroupId === right.processGroupId &&
    left.sessionId === right.sessionId &&
    left.startTime === right.startTime &&
    left.bootId === right.bootId
  );
}

/** Parse the PID, parent PID, and creation time emitted by the Windows probe. */
export function parseWindowsProcessRecords(
  output: string,
): ReadonlyMap<number, WindowsProcessRecord> | null {
  const processes = new Map<number, WindowsProcessRecord>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (!match) return null;

    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const startTime = match[3];
    if (
      !Number.isInteger(pid) ||
      !Number.isInteger(parentPid) ||
      startTime.length === 0
    ) {
      return null;
    }
    if (pid === 0) {
      if (parentPid !== 0) return null;
      continue;
    }

    const existingProcess = processes.get(pid);
    if (
      existingProcess !== undefined &&
      (existingProcess.parentPid !== parentPid || existingProcess.startTime !== startTime)
    ) {
      return null;
    }
    processes.set(pid, { parentPid, startTime });
  }

  return processes;
}

/**
 * Return whether a process is the supervisor or reaches it through a bounded,
 * cycle-safe parent chain whose creation times rule out parent PID reuse.
 */
export function windowsProcessHasAncestor(
  candidateIdentity: ProcessIdentity,
  supervisorIdentity: ProcessIdentity,
  processes: ReadonlyMap<number, WindowsProcessRecord>,
  maxDepth = WINDOWS_PROCESS_ANCESTRY_LIMIT,
): boolean {
  if (
    !Number.isInteger(candidateIdentity.pid) ||
    candidateIdentity.pid <= 0 ||
    !Number.isInteger(supervisorIdentity.pid) ||
    supervisorIdentity.pid <= 0 ||
    !/^\d+$/.test(candidateIdentity.startTime) ||
    !/^\d+$/.test(supervisorIdentity.startTime) ||
    !Number.isInteger(maxDepth) ||
    maxDepth < 0
  ) {
    return false;
  }

  const visited = new Set<number>();
  let currentPid = candidateIdentity.pid;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const currentProcess = processes.get(currentPid);
    if (currentProcess === undefined) return false;
    if (!/^\d+$/.test(currentProcess.startTime)) return false;
    if (
      currentPid === candidateIdentity.pid &&
      currentProcess.startTime !== candidateIdentity.startTime
    ) {
      return false;
    }
    if (currentPid === supervisorIdentity.pid) {
      return currentProcess.startTime === supervisorIdentity.startTime;
    }
    if (visited.has(currentPid)) return false;
    visited.add(currentPid);

    if (currentProcess.parentPid <= 0) return false;
    const parentProcess = processes.get(currentProcess.parentPid);
    if (parentProcess === undefined) return false;
    if (!/^\d+$/.test(parentProcess.startTime)) return false;
    if (BigInt(parentProcess.startTime) > BigInt(currentProcess.startTime)) {
      return false;
    }
    currentPid = currentProcess.parentPid;
  }

  return false;
}

/** Pure platform-specific membership check for an exact owned process tree. */
export function processBelongsToOwnedTree(
  ownedIdentity: ProcessIdentity,
  candidateIdentity: ProcessIdentity,
  platform: NodeJS.Platform,
  windowsProcesses: ReadonlyMap<number, WindowsProcessRecord> = new Map(),
): boolean {
  if (!isDetachedProcessIdentity(ownedIdentity, platform)) return false;

  if (platform === 'linux') {
    return (
      typeof ownedIdentity.bootId === 'string' &&
      ownedIdentity.bootId.length > 0 &&
      candidateIdentity.bootId === ownedIdentity.bootId &&
      candidateIdentity.sessionId === ownedIdentity.sessionId
    );
  }

  if (platform === 'darwin') {
    return (
      typeof ownedIdentity.bootId === 'string' &&
      ownedIdentity.bootId.length > 0 &&
      candidateIdentity.bootId === ownedIdentity.bootId &&
      candidateIdentity.processGroupId === ownedIdentity.processGroupId
    );
  }

  if (platform === 'win32') {
    return windowsProcessHasAncestor(
      candidateIdentity,
      ownedIdentity,
      windowsProcesses,
    );
  }

  return false;
}

function listProcessGroupsInSession(sessionId: number): number[] {
  const groups = new Set<number>();

  if (process.platform === 'linux') {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync('/proc');
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const identity = parseLinuxProcStat(
          fs.readFileSync(`/proc/${entry}/stat`, 'utf-8'),
        );
        if (identity?.sessionId === sessionId) {
          groups.add(identity.processGroupId);
        }
      } catch {
        // The process may exit while /proc is being scanned.
      }
    }
    return [...groups];
  }

  if (process.platform !== 'win32') {
    try {
      const sessionField = process.platform === 'darwin' ? 'sess=' : 'sid=';
      const output = execFileSync('ps', ['-axo', `pgid=,${sessionField}`], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const line of output.split(/\r?\n/)) {
        const match = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (match && Number(match[2]) === sessionId) {
          groups.add(Number(match[1]));
        }
      }
    } catch {
      return [];
    }
  }

  return [...groups];
}

function processGroupIsAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function ownedProcessTreeIsAlive(identity: ProcessIdentity): boolean {
  if (process.platform === 'win32') return processIdentityMatches(identity);

  const current = captureProcessIdentity(identity.pid);
  if (current && !processIdentitiesMatch(current, identity)) return false;

  if (process.platform === 'darwin') {
    return processGroupIsAlive(identity.processGroupId);
  }
  return listProcessGroupsInSession(identity.sessionId).length > 0;
}

function signalOwnedTree(identity: ProcessIdentity, signal: NodeJS.Signals): boolean {
  if (process.platform === 'win32') return false;

  const current = captureProcessIdentity(identity.pid);
  if (current && !processIdentitiesMatch(current, identity)) return false;

  if (!isDetachedProcessIdentity(identity)) return false;
  if (process.platform === 'darwin') {
    if (!processGroupIsAlive(identity.processGroupId)) return false;
    try {
      process.kill(-identity.processGroupId, signal);
      return true;
    } catch {
      return false;
    }
  }

  // Detached children created by ProofShot are session leaders. If that leader
  // has already exited, its session id cannot be reused while descendants from
  // that session remain, so scanning the recorded session stays ownership-safe.
  const groups = listProcessGroupsInSession(identity.sessionId);
  if (groups.length === 0) return false;

  let signalled = false;
  for (const groupId of groups) {
    if (!Number.isInteger(groupId) || groupId <= 0) continue;
    try {
      process.kill(-groupId, signal);
      signalled = true;
    } catch {
      // A group can exit between discovery and signalling.
    }
  }
  return signalled;
}

/**
 * Terminate only the detached process session represented by `identity`.
 * Missing/already-dead processes are an idempotent no-op. A recycled PID is
 * rejected rather than widening cleanup to a name or port match.
 */
export async function terminateOwnedProcessTree(
  identity: ProcessIdentity | null | undefined,
  options: TerminateProcessTreeOptions = {},
): Promise<boolean> {
  if (!identity) return false;

  if (process.platform === 'win32') {
    if (!processIdentityMatches(identity)) return false;
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(identity.pid)], {
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  if (!ownedProcessTreeIsAlive(identity)) return false;
  const signalled = signalOwnedTree(identity, 'SIGTERM');
  if (!signalled) return false;

  const graceMs = options.graceMs ?? 1500;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && ownedProcessTreeIsAlive(identity)) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (ownedProcessTreeIsAlive(identity)) {
    signalOwnedTree(identity, 'SIGKILL');
    const killDeadline = Date.now() + 500;
    while (Date.now() < killDeadline && ownedProcessTreeIsAlive(identity)) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  return true;
}

export async function terminateOwnedProcess(
  identity: ProcessIdentity | null | undefined,
  options: TerminateProcessTreeOptions = {},
): Promise<boolean> {
  if (!identity || !processIdentityMatches(identity)) {
    return false;
  }

  const graceMs = options.graceMs ?? 1500;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  try {
    process.kill(identity.pid, 'SIGTERM');
  } catch {
    return false;
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && processIdentityMatches(identity)) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  if (processIdentityMatches(identity)) {
    try {
      process.kill(identity.pid, 'SIGKILL');
    } catch {
      return false;
    }
  }
  return true;
}

function parseWindowsLocalEndpointPort(endpoint: string): number | null {
  const match = endpoint.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/);
  if (!match) return null;

  const address = match[1] ?? match[2];
  if (isIP(address) === 0) return null;

  const port = Number(match[3]);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null;
}

export function parseWindowsNetstatOutput(output: string, port: number): number[] {
  const pids = new Set<number>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('TCP')) continue;

    const columns = line.split(/\s+/);
    if (columns.length !== 5) return [];

    const localAddress = columns[1];
    const state = columns[3];
    const pid = Number(columns[4]);
    const localPort = parseWindowsLocalEndpointPort(localAddress);

    if (
      localPort === null ||
      !WINDOWS_TCP_STATES.has(state) ||
      !Number.isInteger(pid) ||
      pid < 0
    ) {
      return [];
    }
    if (state === 'LISTENING' && localPort === port) {
      pids.add(pid);
    }
  }

  return [...pids].sort((left, right) => left - right);
}

export function findPidsListeningOnPort(port: number): number[] {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];

  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return parseWindowsNetstatOutput(output, port);
    }

    const output = execFileSync(
      'lsof',
      ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim();

    if (output.length === 0) return [];
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
      if (!/^\d+$/.test(line)) return [];
      const pid = Number(line);
      if (!Number.isInteger(pid) || pid <= 0) return [];
      pids.add(pid);
    }
    return [...pids].sort((left, right) => left - right);
  } catch {
    return [];
  }
}

function captureWindowsProcessRecords(): ReadonlyMap<number, WindowsProcessRecord> | null {
  try {
    const script =
      '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Process | ' +
      'Where-Object { $_.ProcessId -gt 0 } | ' +
      'ForEach-Object { try { $live = Get-Process -Id $_.ProcessId -ErrorAction Stop; ' +
      '"{0}`t{1}`t{2}" -f $_.ProcessId, $_.ParentProcessId, ' +
      '$live.StartTime.ToUniversalTime().Ticks } catch {} }';
    const output = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return parseWindowsProcessRecords(output);
  } catch {
    return null;
  }
}

function captureListenerIdentities(pids: number[]): ProcessIdentity[] | null {
  const identities: ProcessIdentity[] = [];
  for (const pid of pids) {
    const identity = captureProcessIdentity(pid);
    if (!identity) return null;
    identities.push(identity);
  }
  return identities;
}

function ownedSupervisorHasNotBeenReplaced(
  identity: ProcessIdentity,
  platform: NodeJS.Platform,
): boolean {
  const current = captureProcessIdentity(identity.pid);
  if (platform === 'win32') {
    return current !== null && processIdentitiesMatch(current, identity);
  }
  return current === null || processIdentitiesMatch(current, identity);
}

function processIdentitySnapshotsMatch(
  left: ProcessIdentity[],
  right: ProcessIdentity[],
): boolean {
  return (
    left.length === right.length &&
    left.every((identity, index) => processIdentitiesMatch(identity, right[index]))
  );
}

/**
 * Verify that every stable TCP listener on `port` belongs to the exact tree
 * represented by `ownedIdentity`. Inspection failures are ownership failures.
 */
export function ownedProcessTreeOwnsListeningPort(
  ownedIdentity: ProcessIdentity,
  port: number,
): boolean {
  const platform = process.platform;
  if (!['darwin', 'linux', 'win32'].includes(platform)) return false;

  const firstPids = findPidsListeningOnPort(port);
  if (firstPids.length === 0) return false;
  const firstIdentities = captureListenerIdentities(firstPids);
  if (
    firstIdentities === null ||
    !ownedSupervisorHasNotBeenReplaced(ownedIdentity, platform)
  ) {
    return false;
  }

  let windowsProcesses: ReadonlyMap<number, WindowsProcessRecord> = new Map();
  if (platform === 'win32') {
    const capturedProcesses = captureWindowsProcessRecords();
    if (capturedProcesses === null) return false;
    windowsProcesses = capturedProcesses;
  }

  if (
    !firstIdentities.every((identity) =>
      processBelongsToOwnedTree(ownedIdentity, identity, platform, windowsProcesses),
    )
  ) {
    return false;
  }

  const secondPids = findPidsListeningOnPort(port);
  if (
    secondPids.length !== firstPids.length ||
    secondPids.some((pid, index) => pid !== firstPids[index])
  ) {
    return false;
  }
  const secondIdentities = captureListenerIdentities(secondPids);
  if (
    secondIdentities === null ||
    !processIdentitySnapshotsMatch(firstIdentities, secondIdentities) ||
    !ownedSupervisorHasNotBeenReplaced(ownedIdentity, platform)
  ) {
    return false;
  }

  return secondIdentities.every((identity) =>
    processBelongsToOwnedTree(ownedIdentity, identity, platform, windowsProcesses),
  );
}

export function killPids(pids: number[]): boolean {
  if (pids.length === 0) return false;

  try {
    if (process.platform === 'win32') {
      const pidArgs = pids.map((pid) => `/PID ${pid}`).join(' ');
      execSync(`taskkill /F /T ${pidArgs}`, { stdio: 'pipe' });
      return true;
    }

    execSync(`kill -9 ${pids.join(' ')}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function terminateProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
    return;
  }

  process.kill(-pid, 'SIGKILL');
}

export function findExecutablePath(
  command: string,
  platform = process.platform,
  execFn: ExecSyncLike = execSync,
): string | null {
  try {
    const lookupCommand = platform === 'win32' ? `where ${command}` : `command -v ${command}`;
    const output = execFn(lookupCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

export function readCommandVersion(
  command: string,
  args: string[] = ['--version'],
  execFn: ExecSyncLike = execSync,
): string | null {
  try {
    const output = execFn([command, ...args].join(' '), {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}
