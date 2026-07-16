import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureDevServer } from './start.js';

const mocks = vi.hoisted(() => ({
  isPortOpen: vi.fn(),
  waitForPort: vi.fn(),
  getProcessStartTime: vi.fn(),
  isProcessRunning: vi.fn(),
  spawnShellCommand: vi.fn(),
  terminateProcessTree: vi.fn(),
  waitForProcessExit: vi.fn(),
}));

vi.mock('../utils/port.js', () => ({
  isPortOpen: mocks.isPortOpen,
  waitForPort: mocks.waitForPort,
}));

vi.mock('../utils/process.js', () => ({
  getProcessStartTime: mocks.getProcessStartTime,
  isProcessRunning: mocks.isProcessRunning,
  spawnShellCommand: mocks.spawnShellCommand,
  terminateProcessTree: mocks.terminateProcessTree,
  waitForProcessExit: mocks.waitForProcessExit,
}));

describe('ensureDevServer', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('refuses to kill an unrelated process on the requested port', async () => {
    mocks.isPortOpen.mockResolvedValue(true);

    await expect(
      ensureDevServer('npm run dev', 3000, 1000, '/tmp/server.log'),
    ).rejects.toThrow('Port 3000 is already in use');

    expect(mocks.terminateProcessTree).not.toHaveBeenCalled();
    expect(mocks.spawnShellCommand).not.toHaveBeenCalled();
  });

  it('redirects server output to inherited file descriptors', async () => {
    vi.useFakeTimers();
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-server-'),
    );
    const logPath = path.join(temporaryDirectory, 'server.log');
    const unref = vi.fn();
    mocks.isPortOpen.mockResolvedValue(false);
    mocks.getProcessStartTime.mockReturnValue('start-time');
    mocks.spawnShellCommand.mockReturnValue({ pid: 1234, unref });
    mocks.waitForPort.mockResolvedValue(undefined);

    try {
      const startPromise = ensureDevServer(
        'npm run dev',
        3000,
        1000,
        logPath,
      );
      await vi.runAllTimersAsync();
      await startPromise;

      const spawnOptions = mocks.spawnShellCommand.mock.calls[0][1];
      expect(spawnOptions.stdio[0]).toBe('ignore');
      expect(typeof spawnOptions.stdio[1]).toBe('number');
      expect(spawnOptions.stdio[2]).toBe(spawnOptions.stdio[1]);
      expect(unref).toHaveBeenCalled();
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
