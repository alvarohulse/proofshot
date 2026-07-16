import { execSync, spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import * as fs from 'fs';

type ExecSyncLike = typeof execSync;

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

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function waitForProcessExit(pid: number, timeoutMs = 1000): boolean {
  const deadline = Date.now() + timeoutMs;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    Atomics.wait(waitBuffer, 0, 0, 25);
  }

  return !isProcessRunning(pid);
}

export function processHasEnvironmentValue(
  pid: number,
  key: string,
  expectedValue: string,
  platform = process.platform,
  execFn: ExecSyncLike = execSync,
): boolean | null {
  const expectedEntry = `${key}=${expectedValue}`;

  try {
    if (platform === 'linux') {
      const environment = fs.readFileSync(`/proc/${pid}/environ`, 'utf-8');
      return environment.split('\0').includes(expectedEntry);
    }
    if (platform === 'darwin') {
      const output = execFn(`ps eww -p ${pid} -o command=`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.split(/\s+/).includes(expectedEntry);
    }
    return null;
  } catch {
    return null;
  }
}

export function getProcessStartTime(
  pid: number,
  platform = process.platform,
  execFn: ExecSyncLike = execSync,
): string | null {
  try {
    const command =
      platform === 'win32'
        ? `powershell -NoProfile -Command "(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks"`
        : `ps -o lstart= -p ${pid}`;
    const output = execFn(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
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
