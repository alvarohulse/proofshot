import * as fs from 'fs';
import { spawn } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureProcessIdentity,
  findExecutablePath,
  getShellExecutable,
  isDetachedProcessIdentity,
  parseLinuxProcStat,
  parseUnixProcessIdentity,
  parseWindowsNetstatOutput,
  readCommandVersion,
  terminateOwnedProcess,
  terminateOwnedProcessTree,
} from './process.js';

function waitForExit(pid: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (!captureProcessIdentity(pid)) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error(`process ${pid} did not exit`));
      } else {
        setTimeout(poll, 25);
      }
    };
    poll();
  });
}

describe('getShellExecutable', () => {
  it('uses cmd.exe on Windows when ComSpec is missing', () => {
    expect(getShellExecutable('win32', {})).toBe('cmd.exe');
  });

  it('prefers ComSpec on Windows', () => {
    expect(getShellExecutable('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    );
  });

  it('falls back to /bin/sh on Unix when SHELL is missing', () => {
    expect(getShellExecutable('linux', {})).toBe('/bin/sh');
  });
});

describe('parseWindowsNetstatOutput', () => {
  it('returns unique listening pids for the requested port', () => {
    const output = `
Proto  Local Address          Foreign Address        State           PID
TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234
TCP    [::]:3000              [::]:0                 LISTENING       5678
TCP    127.0.0.1:3000         127.0.0.1:51722        ESTABLISHED     9999
TCP    0.0.0.0:4000           0.0.0.0:0              LISTENING       4321
TCP    [::]:3000              [::]:0                 LISTENING       5678
`;

    expect(parseWindowsNetstatOutput(output, 3000)).toEqual([1234, 5678]);
  });
});

describe('findExecutablePath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses command -v on Unix-like platforms', () => {
    const execSpy = vi.fn().mockReturnValue('/usr/local/bin/ffmpeg\n');

    expect(findExecutablePath('ffmpeg', 'darwin', execSpy as never)).toBe('/usr/local/bin/ffmpeg');
    expect(execSpy).toHaveBeenCalledWith('command -v ffmpeg', expect.any(Object));
  });
});

describe('readCommandVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first output line from the version command', () => {
    const execSpy = vi.fn().mockReturnValue('ffmpeg version 7.0\nbuilt with clang\n');

    expect(readCommandVersion('ffmpeg', ['--version'], execSpy as never)).toBe('ffmpeg version 7.0');
    expect(execSpy).toHaveBeenCalledWith('ffmpeg --version', expect.any(Object));
  });
});

describe('process ownership', () => {
  it('parses immutable Linux ownership fields', () => {
    if (process.platform !== 'linux') return;
    const stat = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf-8');
    const identity = parseLinuxProcStat(stat);
    expect(identity).toMatchObject({ pid: process.pid });
    expect(identity?.processGroupId).toBeGreaterThan(0);
    expect(identity?.sessionId).toBeGreaterThan(0);
    expect(identity?.startTime).toMatch(/^\d+$/);
  });

  it('parses macOS process ownership fields', () => {
    expect(
      parseUnixProcessIdentity(
        321,
        '  321     0 Sun Aug  9 19:35:36 2026    \n',
      ),
    ).toEqual({
      pid: 321,
      processGroupId: 321,
      sessionId: 0,
      startTime: 'Sun Aug  9 19:35:36 2026',
    });
  });

  it('terminates only the exact detached process session it owns', async () => {
    if (process.platform === 'win32') return;
    const owned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    owned.unref();
    unrelated.unref();

    const ownedIdentity = captureProcessIdentity(owned.pid!);
    const unrelatedIdentity = captureProcessIdentity(unrelated.pid!);
    expect(ownedIdentity && isDetachedProcessIdentity(ownedIdentity)).toBe(true);
    expect(unrelatedIdentity && isDetachedProcessIdentity(unrelatedIdentity)).toBe(true);

    try {
      await expect(
        terminateOwnedProcessTree(ownedIdentity, { graceMs: 200 }),
      ).resolves.toBe(true);
      await waitForExit(owned.pid!);
      expect(captureProcessIdentity(unrelated.pid!)).not.toBeNull();

      await expect(
        terminateOwnedProcessTree(
          ownedIdentity && { ...ownedIdentity, startTime: `${ownedIdentity.startTime}-reused` },
          { graceMs: 20 },
        ),
      ).resolves.toBe(false);
      expect(captureProcessIdentity(unrelated.pid!)).not.toBeNull();
    } finally {
      await terminateOwnedProcessTree(unrelatedIdentity, { graceMs: 200 });
      await waitForExit(unrelated.pid!);
    }
  });

  it('terminates an exact helper without widening to its process group', async () => {
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const helperIdentity = captureProcessIdentity(helper.pid!);
    const unrelatedIdentity = captureProcessIdentity(unrelated.pid!);
    expect(helperIdentity).not.toBeNull();
    expect(unrelatedIdentity).not.toBeNull();

    try {
      await expect(
        terminateOwnedProcess(helperIdentity, { graceMs: 200 }),
      ).resolves.toBe(true);
      await waitForExit(helper.pid!);
      expect(captureProcessIdentity(unrelated.pid!)).not.toBeNull();
    } finally {
      if (unrelatedIdentity) {
        process.kill(unrelatedIdentity.pid, 'SIGKILL');
        await waitForExit(unrelatedIdentity.pid);
      }
    }
  });
});
