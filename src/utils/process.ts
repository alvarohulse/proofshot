import * as fs from 'fs';
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
}

export interface TerminateProcessTreeOptions {
  graceMs?: number;
  pollIntervalMs?: number;
}

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

/**
 * Capture the current immutable identity for a process.
 * Returns null when the process is already gone or cannot be inspected.
 */
export function captureProcessIdentity(pid: number): ProcessIdentity | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  if (process.platform === 'linux') {
    try {
      return parseLinuxProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf-8'));
    } catch {
      return null;
    }
  }

  if (process.platform !== 'win32') {
    try {
      const output = execFileSync(
        'ps',
        ['-o', 'pgid=', '-o', 'sid=', '-o', 'lstart=', '-p', String(pid)],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
      const match = output.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid,
        processGroupId: Number(match[1]),
        sessionId: Number(match[2]),
        startTime: match[3],
      };
    } catch {
      return null;
    }
  }

  // Windows has no /proc-style start token available through Node. Keep the
  // identity scoped to the exact PID; taskkill below still targets only it and
  // its descendants rather than using a command-name match.
  try {
    process.kill(pid, 0);
    return { pid, processGroupId: pid, sessionId: pid, startTime: `pid:${pid}` };
  } catch {
    return null;
  }
}

export function processIdentityMatches(identity: ProcessIdentity): boolean {
  const current = captureProcessIdentity(identity.pid);
  return Boolean(current && identitiesMatch(current, identity));
}

function identitiesMatch(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return (
    left.pid === right.pid &&
    left.processGroupId === right.processGroupId &&
    left.sessionId === right.sessionId &&
    left.startTime === right.startTime
  );
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
      const output = execFileSync('ps', ['-axo', 'pgid=,sid='], {
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

export function ownedProcessTreeIsAlive(identity: ProcessIdentity): boolean {
  if (process.platform === 'win32') return processIdentityMatches(identity);

  const current = captureProcessIdentity(identity.pid);
  if (current && !identitiesMatch(current, identity)) return false;

  return listProcessGroupsInSession(identity.sessionId).length > 0;
}

function signalOwnedTree(identity: ProcessIdentity, signal: NodeJS.Signals): boolean {
  if (process.platform === 'win32') return false;

  const current = captureProcessIdentity(identity.pid);
  if (current && !identitiesMatch(current, identity)) return false;

  // Detached children created by ProofShot are session leaders. If that leader
  // has already exited, its session id cannot be reused while descendants from
  // that session remain, so scanning the recorded session stays ownership-safe.
  if (identity.sessionId !== identity.pid) return false;
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

export function parseWindowsNetstatOutput(output: string, port: number): number[] {
  const pids = new Set<number>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('TCP')) continue;

    const columns = line.split(/\s+/);
    if (columns.length < 5) continue;

    const localAddress = columns[1];
    const state = columns[3];
    const pid = Number(columns[4]);
    const match = localAddress.match(/:(\d+)$/);

    if (state !== 'LISTENING' || !match || !Number.isInteger(pid)) continue;
    if (Number(match[1]) === port) {
      pids.add(pid);
    }
  }

  return [...pids];
}

export function findPidsListeningOnPort(port: number): number[] {
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano -p tcp', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return parseWindowsNetstatOutput(output, port);
    }

    const output = execSync(`lsof -ti:${port}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return output
      .split(/\r?\n/)
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid));
  } catch {
    return [];
  }
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
