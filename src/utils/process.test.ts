import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findExecutablePath,
  getProcessStartTime,
  getShellExecutable,
  parseWindowsNetstatOutput,
  processHasEnvironmentValue,
  readCommandVersion,
} from './process.js';

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

describe('processHasEnvironmentValue', () => {
  it('verifies an ownership token in macOS process output', () => {
    const execSpy = vi
      .fn()
      .mockReturnValue('npm run dev PROOFSHOT_SERVER_TOKEN=ownership-token\n');

    expect(
      processHasEnvironmentValue(
        1234,
        'PROOFSHOT_SERVER_TOKEN',
        'ownership-token',
        'darwin',
        execSpy as never,
      ),
    ).toBe(true);
  });

  it('does not claim ownership on unsupported platforms', () => {
    expect(
      processHasEnvironmentValue(
        1234,
        'PROOFSHOT_SERVER_TOKEN',
        'ownership-token',
        'win32',
      ),
    ).toBeNull();
  });
});

describe('getProcessStartTime', () => {
  it('reads the process creation time on Windows', () => {
    const execSpy = vi.fn().mockReturnValue('133987654321000000\n');

    expect(getProcessStartTime(1234, 'win32', execSpy as never)).toBe(
      '133987654321000000',
    );
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
