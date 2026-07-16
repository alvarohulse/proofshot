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
});
