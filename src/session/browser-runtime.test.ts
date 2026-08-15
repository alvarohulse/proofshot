import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveAgentBrowserRuntime: vi.fn(),
}));

vi.mock('../browser/isolation.js', () => ({
  resolveAgentBrowserRuntime: mocks.resolveAgentBrowserRuntime,
}));

import { backfillSessionAgentBrowserRuntime } from './browser-runtime.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAgentBrowserRuntime.mockReturnValue({
    executablePath: '/opt/node24/bin/agent-browser',
    version: '0.34.0',
  });
});

describe('session agent-browser runtime', () => {
  it('persists an exact runtime for a legacy session', () => {
    const session = {} as Parameters<typeof backfillSessionAgentBrowserRuntime>[0];

    expect(backfillSessionAgentBrowserRuntime(session)).toBe(true);

    expect(session.agentBrowserExecutablePath).toBe(
      '/opt/node24/bin/agent-browser',
    );
    expect(session.agentBrowserVersion).toBe('0.34.0');
  });

  it('preserves the runtime already pinned to a session', () => {
    const session = {
      agentBrowserExecutablePath: '/verified/bin/agent-browser',
      agentBrowserVersion: '0.34.0',
    } as Parameters<typeof backfillSessionAgentBrowserRuntime>[0];

    expect(backfillSessionAgentBrowserRuntime(session)).toBe(false);
    expect(mocks.resolveAgentBrowserRuntime).not.toHaveBeenCalled();
    expect(session.agentBrowserExecutablePath).toBe(
      '/verified/bin/agent-browser',
    );
  });
});
