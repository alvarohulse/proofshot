import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAgentBrowserRuntime: vi.fn(),
  resolveAgentBrowserRuntime: vi.fn(),
  resolveAgentBrowserRuntimeAtPath: vi.fn(),
}));

vi.mock('../browser/isolation.js', () => ({
  assertAgentBrowserRuntime: mocks.assertAgentBrowserRuntime,
  resolveAgentBrowserRuntime: mocks.resolveAgentBrowserRuntime,
  resolveAgentBrowserRuntimeAtPath: mocks.resolveAgentBrowserRuntimeAtPath,
}));

import { backfillSessionAgentBrowserRuntime } from './browser-runtime.js';

beforeEach(() => {
  vi.clearAllMocks();
  const runtime = {
    executablePath: '/opt/node24/bin/agent-browser',
    sha256: 'a'.repeat(64),
    version: '0.34.0',
  };
  mocks.resolveAgentBrowserRuntime.mockReturnValue(runtime);
  mocks.resolveAgentBrowserRuntimeAtPath.mockReturnValue(runtime);
});

describe('session agent-browser runtime', () => {
  it('persists an exact runtime for a legacy session', () => {
    const session = {} as Parameters<typeof backfillSessionAgentBrowserRuntime>[0];

    expect(backfillSessionAgentBrowserRuntime(session)).toBe(true);

    expect(session.agentBrowserExecutablePath).toBe(
      '/opt/node24/bin/agent-browser',
    );
    expect(session.agentBrowserExecutableSha256).toBe('a'.repeat(64));
    expect(session.agentBrowserVersion).toBe('0.34.0');
  });

  it('preserves the runtime already pinned to a session', () => {
    const session = {
      agentBrowserExecutablePath: '/verified/bin/agent-browser',
      agentBrowserExecutableSha256: 'b'.repeat(64),
      agentBrowserVersion: '0.34.0',
    } as Parameters<typeof backfillSessionAgentBrowserRuntime>[0];

    expect(backfillSessionAgentBrowserRuntime(session)).toBe(false);
    expect(mocks.resolveAgentBrowserRuntime).not.toHaveBeenCalled();
    expect(mocks.assertAgentBrowserRuntime).toHaveBeenCalledWith({
      executablePath: '/verified/bin/agent-browser',
      sha256: 'b'.repeat(64),
      version: '0.34.0',
    });
    expect(session.agentBrowserExecutablePath).toBe(
      '/verified/bin/agent-browser',
    );
  });

  it('anchors a legacy path to its current exact file identity', () => {
    const session = {
      agentBrowserExecutablePath: '/opt/node24/bin/agent-browser',
      agentBrowserVersion: '0.34.0',
    } as Parameters<typeof backfillSessionAgentBrowserRuntime>[0];

    expect(backfillSessionAgentBrowserRuntime(session)).toBe(true);

    expect(mocks.resolveAgentBrowserRuntimeAtPath).toHaveBeenCalledWith(
      '/opt/node24/bin/agent-browser',
      process.env,
    );
    expect(session.agentBrowserExecutableSha256).toBe('a'.repeat(64));
  });

  it('refuses a replaced executable before a later browser command', () => {
    const session = {
      agentBrowserExecutablePath: '/verified/bin/agent-browser',
      agentBrowserExecutableSha256: 'b'.repeat(64),
      agentBrowserVersion: '0.34.0',
    } as Parameters<typeof backfillSessionAgentBrowserRuntime>[0];
    mocks.assertAgentBrowserRuntime.mockImplementation(() => {
      throw new Error('pinned runtime changed');
    });

    expect(() => backfillSessionAgentBrowserRuntime(session)).toThrow(
      'pinned runtime changed',
    );
  });
});
