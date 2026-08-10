import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureAgentBrowserProcessIdentity: vi.fn(),
  waitForAgentBrowserProcessIdentity: vi.fn(),
  closeBrowser: vi.fn(),
  stopRecording: vi.fn(),
  ownedProcessTreeIsAlive: vi.fn(),
  processIdentityMatches: vi.fn(),
  terminateOwnedProcessTree: vi.fn(),
}));

vi.mock('../browser/runtime.js', () => ({
  captureAgentBrowserProcessIdentity: mocks.captureAgentBrowserProcessIdentity,
  waitForAgentBrowserProcessIdentity: mocks.waitForAgentBrowserProcessIdentity,
}));
vi.mock('../browser/session.js', () => ({ closeBrowser: mocks.closeBrowser }));
vi.mock('../browser/capture.js', () => ({ stopRecording: mocks.stopRecording }));
vi.mock('../utils/process.js', () => ({
  ownedProcessTreeIsAlive: mocks.ownedProcessTreeIsAlive,
  processIdentityMatches: mocks.processIdentityMatches,
  terminateOwnedProcessTree: mocks.terminateOwnedProcessTree,
}));

import {
  canAddressOwnedBrowserSession,
  cleanupFailedStart,
  stopOwnedBrowser,
} from './lifecycle.js';

const persistedIdentity = {
  pid: 12001,
  processGroupId: 12001,
  sessionId: 12001,
  startTime: 'original-start',
};

function session(browserProcess: typeof persistedIdentity | null = persistedIdentity): any {
  return {
    sessionName: 'ps-owned-session',
    agentBrowserSocketDir: '/run/user/1000/proofshot/agent-browser',
    browserProcess,
    serverProcess: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.processIdentityMatches.mockReturnValue(true);
  mocks.ownedProcessTreeIsAlive.mockReturnValue(false);
  mocks.terminateOwnedProcessTree.mockResolvedValue(true);
  mocks.waitForAgentBrowserProcessIdentity.mockResolvedValue(null);
});

describe('owned browser lifecycle', () => {
  it('does not address a recycled session name when the persisted identity mismatches', async () => {
    mocks.processIdentityMatches.mockReturnValue(false);
    const state = session();

    expect(canAddressOwnedBrowserSession(state)).toBe(false);
    await stopOwnedBrowser(state);
    await cleanupFailedStart(state);

    expect(mocks.captureAgentBrowserProcessIdentity).not.toHaveBeenCalled();
    expect(mocks.closeBrowser).not.toHaveBeenCalled();
    expect(mocks.stopRecording).not.toHaveBeenCalled();
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(persistedIdentity);
  });

  it('allows a matching persisted identity and legacy state captured from its PID file', async () => {
    const legacyIdentity = {
      ...persistedIdentity,
      pid: 12002,
      processGroupId: 12002,
      sessionId: 12002,
    };
    mocks.captureAgentBrowserProcessIdentity.mockReturnValue(legacyIdentity);

    expect(canAddressOwnedBrowserSession(session())).toBe(true);
    await stopOwnedBrowser(session());
    await stopOwnedBrowser(session(null));

    expect(mocks.closeBrowser).toHaveBeenNthCalledWith(1, 'ps-owned-session');
    expect(mocks.closeBrowser).toHaveBeenNthCalledWith(2, 'ps-owned-session');
    expect(mocks.terminateOwnedProcessTree).toHaveBeenNthCalledWith(1, persistedIdentity);
    expect(mocks.terminateOwnedProcessTree).toHaveBeenNthCalledWith(2, legacyIdentity);
  });

  it('recovers a delayed daemon identity after a timed-out browser launch', async () => {
    const state = {
      ...session(null),
      browserLaunchAttempted: true,
    };
    mocks.waitForAgentBrowserProcessIdentity.mockResolvedValue(persistedIdentity);

    await cleanupFailedStart(state);

    expect(state.browserProcess).toEqual(persistedIdentity);
    expect(mocks.closeBrowser).toHaveBeenCalledWith('ps-owned-session');
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(persistedIdentity);
  });

  it('retains a cleanup error when exact browser identity cannot be recovered', async () => {
    const state = {
      ...session(null),
      browserLaunchAttempted: true,
    };

    await expect(cleanupFailedStart(state)).rejects.toThrow(/cleanup state was retained/);
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledTimes(1);
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(null);
  });
});
