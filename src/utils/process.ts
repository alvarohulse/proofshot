import * as fs from 'fs';
import {
  execFileSync,
  execSync,
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'child_process';

type ExecSyncLike = typeof execSync;

export type TextCommandRunner = (
  command: string,
  args: readonly string[],
) => string;

export interface TcpListenerInspectorStatus {
  available: boolean;
  command: string;
  label: string;
  error: string | null;
}

export class TcpListenerInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TcpListenerInspectionError';
  }
}

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

export interface CaptureProcessIdentityOptions {
  includeZombie?: boolean;
}

export interface WindowsProcessRecord {
  parentPid: number;
  startTime: string;
}

const WINDOWS_PROCESS_ANCESTRY_LIMIT = 256;
const WINDOWS_LISTENER_INSPECTOR = 'PowerShell Get-NetTCPConnection';
const UNIX_LISTENER_INSPECTOR = 'lsof';

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
export function parseLinuxProcStat(
  stat: string,
  options: CaptureProcessIdentityOptions = {},
): ProcessIdentity | null {
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return null;

  const pid = Number(stat.slice(0, stat.indexOf(' ')));
  const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
  if (fields[0] === 'Z' && options.includeZombie !== true) return null;
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
 * A just-exited Linux launcher may opt into zombie identity capture so its
 * immutable ownership can be persisted before Node reaps it; liveness scans
 * still exclude zombies.
 */
export function captureProcessIdentity(
  pid: number,
  options: CaptureProcessIdentityOptions = {},
): ProcessIdentity | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  if (process.platform === 'linux') {
    try {
      const identity = parseLinuxProcStat(
        fs.readFileSync(`/proc/${pid}/stat`, 'utf-8'),
        options,
      );
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

/** Parse the intentionally numeric output emitted by TCP listener probes. */
export function parseTcpListenerPidOutput(output: string): number[] {
  const pids = new Set<number>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (!/^\d+$/.test(line)) {
      throw new TcpListenerInspectionError(
        `TCP listener inspection returned a non-numeric PID: ${JSON.stringify(line)}`,
      );
    }

    const pid = Number(line);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new TcpListenerInspectionError(
        `TCP listener inspection returned an invalid PID: ${JSON.stringify(line)}`,
      );
    }
    pids.add(pid);
  }

  return [...pids].sort((left, right) => left - right);
}

function runTextCommand(command: string, args: readonly string[]): string {
  return execFileSync(command, [...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function commandErrorOutput(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);

  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === 'string' && stderr.trim().length > 0) return stderr.trim();
  if (Buffer.isBuffer(stderr) && stderr.length > 0) {
    return stderr.toString('utf-8').trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function executableIsMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function listenerInspectorForPlatform(platform: NodeJS.Platform): {
  command: string;
  label: string;
  probeArgs: readonly string[];
} | null {
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      label: WINDOWS_LISTENER_INSPECTOR,
      probeArgs: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; Get-Command Get-NetTCPConnection -ErrorAction Stop | Out-Null',
      ],
    };
  }
  if (platform === 'darwin' || platform === 'linux') {
    return {
      command: 'lsof',
      label: UNIX_LISTENER_INSPECTOR,
      probeArgs: ['-v'],
    };
  }
  return null;
}

export function getTcpListenerInspectorStatus(
  platform: NodeJS.Platform = process.platform,
  runner: TextCommandRunner = runTextCommand,
): TcpListenerInspectorStatus {
  const inspector = listenerInspectorForPlatform(platform);
  if (inspector === null) {
    return {
      available: false,
      command: '',
      label: 'TCP listener inspection',
      error: `ProofShot does not support TCP listener inspection on ${platform}.`,
    };
  }

  try {
    runner(inspector.command, inspector.probeArgs);
    return {
      available: true,
      command: inspector.command,
      label: inspector.label,
      error: null,
    };
  } catch (error) {
    if (platform !== 'win32' && executableIsMissing(error)) {
      return {
        available: false,
        command: inspector.command,
        label: inspector.label,
        error:
          'lsof is required to verify dev-server TCP listener ownership. Install lsof and retry.',
      };
    }

    const requirement =
      platform === 'win32'
        ? 'PowerShell Get-NetTCPConnection is required to verify dev-server TCP listener ownership.'
        : 'ProofShot could not run lsof to verify dev-server TCP listener ownership.';
    return {
      available: false,
      command: inspector.command,
      label: inspector.label,
      error: `${requirement} ${commandErrorOutput(error)}`,
    };
  }
}

export function assertTcpListenerInspectionAvailable(
  platform: NodeJS.Platform = process.platform,
  runner: TextCommandRunner = runTextCommand,
): void {
  const status = getTcpListenerInspectorStatus(platform, runner);
  if (!status.available) {
    throw new TcpListenerInspectionError(
      status.error || 'TCP listener inspection is unavailable.',
    );
  }
}

function isEmptyLsofResult(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  const stdout = (error as { stdout?: unknown }).stdout;
  const stderr = (error as { stderr?: unknown }).stderr;
  const stdoutText = Buffer.isBuffer(stdout)
    ? stdout.toString('utf-8')
    : String(stdout || '');
  const stderrText = Buffer.isBuffer(stderr)
    ? stderr.toString('utf-8')
    : String(stderr || '');
  return (
    status === 1 &&
    stdoutText.trim().length === 0 &&
    stderrText.trim().length === 0
  );
}

function inspectWindowsListenerPids(
  port: number,
  runner: TextCommandRunner,
): number[] {
  const script =
    '$ErrorActionPreference = "Stop"; ' +
    'Get-NetTCPConnection -State Listen -ErrorAction Stop | ' +
    `Where-Object { [int]$_.LocalPort -eq ${port} } | ` +
    'ForEach-Object { [Console]::Out.WriteLine([int]$_.OwningProcess) }';
  try {
    return parseTcpListenerPidOutput(
      runner('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ]),
    );
  } catch (error) {
    if (error instanceof TcpListenerInspectionError) throw error;
    throw new TcpListenerInspectionError(
      `PowerShell Get-NetTCPConnection failed while inspecting port ${port}: ${commandErrorOutput(error)}`,
    );
  }
}

function inspectUnixListenerPids(
  port: number,
  runner: TextCommandRunner,
): number[] {
  try {
    return parseTcpListenerPidOutput(
      runner('lsof', [
        '-w',
        '-nP',
        '-a',
        `-iTCP:${port}`,
        '-sTCP:LISTEN',
        '-t',
      ]),
    );
  } catch (error) {
    if (error instanceof TcpListenerInspectionError) throw error;
    if (isEmptyLsofResult(error)) return [];
    throw new TcpListenerInspectionError(
      `lsof failed while inspecting TCP listeners on port ${port}: ${commandErrorOutput(error)}`,
    );
  }
}

export function findPidsListeningOnPort(
  port: number,
  platform: NodeJS.Platform = process.platform,
  runner: TextCommandRunner = runTextCommand,
): number[] {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new TcpListenerInspectionError(`Invalid TCP listener port: ${port}`);
  }

  if (platform === 'win32') return inspectWindowsListenerPids(port, runner);
  if (platform === 'darwin' || platform === 'linux') {
    return inspectUnixListenerPids(port, runner);
  }
  throw new TcpListenerInspectionError(
    `ProofShot does not support TCP listener inspection on ${platform}.`,
  );
}

function captureWindowsProcessRecords(): ReadonlyMap<number, WindowsProcessRecord> {
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
    const processes = parseWindowsProcessRecords(output);
    if (processes === null) {
      throw new TcpListenerInspectionError(
        'PowerShell returned malformed process ancestry while inspecting TCP listener ownership.',
      );
    }
    return processes;
  } catch (error) {
    if (error instanceof TcpListenerInspectionError) throw error;
    throw new TcpListenerInspectionError(
      `PowerShell failed while inspecting TCP listener ancestry: ${commandErrorOutput(error)}`,
    );
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
    windowsProcesses = captureWindowsProcessRecords();
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
