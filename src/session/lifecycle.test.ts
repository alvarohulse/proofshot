import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureAgentBrowserProcessIdentity: vi.fn(),
  clearAgentBrowserSessionFiles: vi.fn(),
  waitForAgentBrowserProcessIdentity: vi.fn(),
  closeBrowser: vi.fn(),
  stopRecording: vi.fn(),
  captureProcessIdentity: vi.fn(),
  ownedProcessTreeIsAlive: vi.fn(),
  processIdentitiesMatch: vi.fn(),
  processIdentityMatches: vi.fn(),
  terminateOwnedProcessTree: vi.fn(),
  finalizePrivateNetworkCapture: vi.fn(),
}));

vi.mock('../browser/runtime.js', () => ({
  captureAgentBrowserProcessIdentity: mocks.captureAgentBrowserProcessIdentity,
  clearAgentBrowserSessionFiles: mocks.clearAgentBrowserSessionFiles,
  waitForAgentBrowserProcessIdentity: mocks.waitForAgentBrowserProcessIdentity,
}));
vi.mock('../browser/session.js', () => ({ closeBrowser: mocks.closeBrowser }));
vi.mock('../browser/capture.js', () => ({ stopRecording: mocks.stopRecording }));
vi.mock('../browser/evidence.js', () => ({
  finalizePrivateNetworkCapture: mocks.finalizePrivateNetworkCapture,
}));
vi.mock('../utils/process.js', () => ({
  captureProcessIdentity: mocks.captureProcessIdentity,
  ownedProcessTreeIsAlive: mocks.ownedProcessTreeIsAlive,
  processIdentitiesMatch: mocks.processIdentitiesMatch,
  processIdentityMatches: mocks.processIdentityMatches,
  terminateOwnedProcessTree: mocks.terminateOwnedProcessTree,
}));

import {
  canAddressOwnedBrowserSession,
  cleanupFailedStart,
  stopOwnedBrowser,
  stopOwnedServer,
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
  mocks.processIdentitiesMatch.mockReturnValue(true);
  mocks.captureProcessIdentity.mockReturnValue(null);
  mocks.ownedProcessTreeIsAlive.mockReturnValue(false);
  mocks.terminateOwnedProcessTree.mockResolvedValue(true);
  mocks.waitForAgentBrowserProcessIdentity.mockResolvedValue(null);
  mocks.finalizePrivateNetworkCapture.mockReturnValue({
    version: 1,
    requestCount: 0,
    requests: [],
  });
});

describe('owned browser lifecycle', () => {
  it('does not address a recycled session name when the persisted identity mismatches', async () => {
    mocks.processIdentityMatches.mockReturnValue(false);
    mocks.processIdentitiesMatch.mockReturnValue(false);
    mocks.captureProcessIdentity.mockReturnValue({
      ...persistedIdentity,
      startTime: 'recycled-start',
    });
    const state = session();

    expect(canAddressOwnedBrowserSession(state)).toBe(false);
    await expect(stopOwnedBrowser(state)).rejects.toThrow(/identity no longer matches/);
    await expect(cleanupFailedStart(state)).rejects.toThrow(/identity no longer matches/);

    expect(mocks.captureAgentBrowserProcessIdentity).not.toHaveBeenCalled();
    expect(mocks.closeBrowser).not.toHaveBeenCalled();
    expect(mocks.stopRecording).not.toHaveBeenCalled();
    expect(mocks.terminateOwnedProcessTree).not.toHaveBeenCalledWith(persistedIdentity);
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(null);
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
    expect(mocks.clearAgentBrowserSessionFiles).toHaveBeenCalledTimes(2);
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

  it('retains failed network finalization for an exact cleanup retry', async () => {
    const state = {
      ...session(),
      networkCaptureStarted: false,
      networkCaptureActive: true,
      privateEvidenceDir: '/evidence/private/agent-browser',
      networkHarPath: '/evidence/private/agent-browser/network.har',
      networkRequestsPath: '/evidence/private/agent-browser/requests.json',
      networkSummaryPath: '/evidence/network-summary.json',
    };
    mocks.finalizePrivateNetworkCapture.mockImplementationOnce(() => {
      throw new Error('HAR finalization failed');
    });

    await expect(cleanupFailedStart(state)).rejects.toThrow(
      'HAR finalization failed',
    );

    expect(state.networkCaptureActive).toBe(true);
    expect(state.networkEvidenceAvailable).toBe(false);
    expect(state.networkCaptureError).toContain('HAR finalization failed');
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(
      persistedIdentity,
    );
  });

  it('retains offline network finalization for delayed local recovery', async () => {
    mocks.captureAgentBrowserProcessIdentity.mockReturnValue(null);
    const state = {
      ...session(null),
      browserLaunchAttempted: false,
      networkCaptureStarted: true,
      networkCaptureActive: true,
      privateEvidenceDir: '/evidence/private/agent-browser',
      networkHarPath: '/evidence/private/agent-browser/network.har',
      networkRequestsPath: '/evidence/private/agent-browser/requests.json',
      networkSummaryPath: '/evidence/network-summary.json',
    };
    mocks.finalizePrivateNetworkCapture.mockImplementationOnce(() => {
      throw new Error('pending HAR is not complete yet');
    });

    await expect(cleanupFailedStart(state)).rejects.toThrow(
      'pending HAR is not complete yet',
    );

    expect(state.networkCaptureActive).toBe(true);
    expect(state.networkEvidenceAvailable).toBe(false);
    expect(state.networkCaptureError).toContain('pending HAR is not complete yet');
    expect(mocks.stopRecording).not.toHaveBeenCalled();
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(null);
  });

  it('marks absent network evidence unavailable after the recorded browser tree is gone', async () => {
    mocks.processIdentityMatches.mockReturnValue(false);
    const state = {
      ...session(),
      networkCaptureStarted: true,
      networkCaptureActive: true,
      privateEvidenceDir: '/evidence/private/agent-browser',
      networkHarPath: '/evidence/private/agent-browser/network.har',
      networkRequestsPath: '/evidence/private/agent-browser/requests.json',
      networkSummaryPath: '/evidence/network-summary.json',
    };
    mocks.finalizePrivateNetworkCapture.mockImplementationOnce(() => {
      throw new Error('no local HAR remains');
    });

    await cleanupFailedStart(state);

    expect(state.networkCaptureActive).toBe(false);
    expect(state.networkEvidenceAvailable).toBe(false);
    expect(state.networkCaptureError).toContain('no local HAR remains');
    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(
      persistedIdentity,
    );
  });

  it('falls back to exact termination when graceful browser close fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.closeBrowser.mockImplementationOnce(() => {
      throw new Error('daemon close failed');
    });

    await stopOwnedBrowser(session());

    expect(mocks.terminateOwnedProcessTree).toHaveBeenCalledWith(persistedIdentity);
    expect(mocks.clearAgentBrowserSessionFiles).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('exact owned-process cleanup succeeded'),
    );
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

  it('retains recovery state instead of killing a reused server PID', async () => {
    const state = {
      ...session(null),
      serverProcess: persistedIdentity,
    };
    mocks.captureProcessIdentity.mockReturnValue({
      ...persistedIdentity,
      startTime: 'recycled-start',
    });
    mocks.processIdentitiesMatch.mockReturnValue(false);

    await expect(stopOwnedServer(state)).rejects.toThrow(/identity no longer matches/);
    expect(mocks.terminateOwnedProcessTree).not.toHaveBeenCalled();
  });
});
