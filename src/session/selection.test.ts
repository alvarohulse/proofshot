import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canAddressOwnedBrowserSession: vi.fn(),
  getRegisteredSession: vi.fn(),
  listRegisteredSessions: vi.fn(),
  ownedProcessTreeIsAlive: vi.fn(),
}));

vi.mock('./lifecycle.js', () => ({
  canAddressOwnedBrowserSession: mocks.canAddressOwnedBrowserSession,
}));
vi.mock('./registry.js', () => ({
  getRegisteredSession: mocks.getRegisteredSession,
  listRegisteredSessions: mocks.listRegisteredSessions,
}));
vi.mock('../utils/process.js', () => ({
  ownedProcessTreeIsAlive: mocks.ownedProcessTreeIsAlive,
}));

import { resolveLiveSession } from './selection.js';
import type { SessionState } from './state.js';
import type { ProcessIdentity } from '../utils/process.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAddressOwnedBrowserSession.mockReturnValue(false);
  mocks.ownedProcessTreeIsAlive.mockReturnValue(false);
});

describe('resolveLiveSession', () => {
  it('selects the one addressable recording for exec and ignores stale records', () => {
    const stale = buildSession('ps-stale');
    const live = buildSession('ps-live');
    mocks.listRegisteredSessions.mockReturnValue([stale, live]);
    mocks.canAddressOwnedBrowserSession.mockImplementation(
      (session) => session.sessionName === live.sessionName,
    );

    expect(
      resolveLiveSession({ controlDir: '/project/output', operation: 'exec' }),
    ).toBe(live);
  });

  it('does not present one stale active record as a live exec session', () => {
    mocks.listRegisteredSessions.mockReturnValue([buildSession('ps-stale')]);

    expect(
      resolveLiveSession({ controlDir: '/project/output', operation: 'exec' }),
    ).toBeNull();
  });

  it('does not implicitly resume a recovery session', () => {
    const recovery = buildSession('ps-recovery', {
      lifecycleStatus: 'recovery',
      recordingActive: false,
    });
    mocks.listRegisteredSessions.mockReturnValue([recovery]);

    expect(
      resolveLiveSession({ controlDir: '/project/output', operation: 'stop' }),
    ).toBeNull();
  });

  it('prefers one verified live stop target over stale active records', () => {
    const stale = buildSession('ps-stale');
    const live = buildSession('ps-live', {
      browserProcess: buildProcessIdentity(42),
    });
    mocks.listRegisteredSessions.mockReturnValue([stale, live]);
    mocks.ownedProcessTreeIsAlive.mockImplementation(
      (identity) => identity.pid === 42,
    );

    expect(
      resolveLiveSession({ controlDir: '/project/output', operation: 'stop' }),
    ).toBe(live);
  });

  it('resumes one interrupted stopping session when no owned process is live', () => {
    const stopping = buildSession('ps-stopping', {
      lifecycleStatus: 'stopping',
      recordingActive: false,
    });
    mocks.listRegisteredSessions.mockReturnValue([stopping]);

    expect(
      resolveLiveSession({ controlDir: '/project/output', operation: 'stop' }),
    ).toBe(stopping);
  });

  it('reports statuses when multiple live sessions require an explicit target', () => {
    const first = buildSession('ps-first', {
      browserProcess: buildProcessIdentity(41),
    });
    const second = buildSession('ps-second', {
      browserProcess: buildProcessIdentity(42),
    });
    mocks.listRegisteredSessions.mockReturnValue([first, second]);
    mocks.ownedProcessTreeIsAlive.mockReturnValue(true);

    expect(() =>
      resolveLiveSession({ controlDir: '/project/output', operation: 'stop' }),
    ).toThrow(/ps-first \(active\)[\s\S]*ps-second \(active\)/);
  });

  it('honors an explicit stale session for recovery-oriented commands', () => {
    const stale = buildSession('ps-explicit');
    mocks.getRegisteredSession.mockReturnValue(stale);

    expect(
      resolveLiveSession({
        controlDir: '/project/output',
        operation: 'stop',
        sessionName: stale.sessionName,
      }),
    ).toBe(stale);
  });
});

function buildSession(
  sessionName: string,
  overrides: Partial<SessionState> = {},
): SessionState {
  return {
    startedAt: '2026-08-15T20:00:00.000Z',
    startDirectory: '/project',
    controlDir: '/project/output',
    lifecycleStatus: 'active',
    description: null,
    outputDir: '/project/output',
    sessionDir: `/project/output/${sessionName}`,
    sessionName,
    videoPath: `/project/output/${sessionName}/session.webm`,
    serverErrorLog: `/project/output/${sessionName}/server.log`,
    port: 3000,
    serverCommand: null,
    serverAlreadyRunning: true,
    recordingActive: true,
    browserProcess: buildProcessIdentity(99),
    serverProcess: null,
    environment: null,
    ...overrides,
  };
}

function buildProcessIdentity(pid: number): ProcessIdentity {
  return {
    pid,
    processGroupId: pid,
    sessionId: pid,
    startTime: String(pid),
  };
}
