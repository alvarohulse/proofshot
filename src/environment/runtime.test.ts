import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEvidenceEvents } from './evidence.js';
import {
  recordCaptureHealthFailures,
  startOwnedEnvironment,
  stopOwnedEnvironment,
} from './runtime.js';
import type {
  EnvironmentState,
  LauncherEnvironmentState,
  ProcessEnvironmentState,
  TmuxEnvironmentState,
} from './types.js';
import { processIdentityMatches } from '../utils/process.js';

let root: string;
const states: EnvironmentState[] = [];
const extraTmuxSockets: string[] = [];

/**
 * tmux coverage is mandatory in CI, which installs the binary explicitly, and
 * skipped on contributor machines that do not have it.
 */
const tmuxAvailable = (() => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const skipWithoutTmux = !tmuxAvailable && !process.env.CI;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-environment-test-'));
});

afterEach(async () => {
  for (const state of states.splice(0)) {
    await stopOwnedEnvironment(state).catch(() => {});
  }
  for (const socket of extraTmuxSockets.splice(0)) {
    try {
      execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // The fixture may already have exited.
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe('owned environment capture', () => {
  it.skipIf(skipWithoutTmux)('captures named tmux panes as history and live PTY evidence', async () => {
    const sessionDir = path.join(root, 'session');
    fs.mkdirSync(sessionDir, { recursive: true });
    let latestState: EnvironmentState | null = null;
    const started = await startOwnedEnvironment(
      {
        kind: 'tmux',
        launch: {
          kind: 'panes',
          panes: [
            {
              id: 'vite',
              title: 'Vite',
              group: 'frontend',
              command:
                "printf 'vite-history\\n'; sleep 2; printf '\\033[31mvite-live\\033[0m\\n'; sleep 30",
            },
            {
              id: 'api',
              title: 'API',
              group: 'backend',
              command: "printf 'api-history\\n'; sleep 2; printf 'api-live\\n'; sleep 30",
            },
          ],
        },
      },
      {
        stripAnsi: true,
        sources: [
          {
            id: 'frontend-vite',
            group: 'frontend',
            kind: 'tmux-pane',
            match: { connectionKey: 'vite' },
          },
          {
            id: 'backend-api',
            group: 'backend',
            kind: 'tmux-pane',
            match: { connectionKey: 'api' },
          },
        ],
      },
      sessionDir,
      'ps-tmux-test',
      Date.now(),
      (updated) => {
        latestState = updated;
      },
    );
    if (started) states.push(started);
    const state = requireTmuxState(started);

    await waitForEvidence(state.evidencePath, ['vite-live', 'api-live']);
    const events = loadEvidenceEvents(state.evidencePath);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'frontend-vite',
          sourceTitle: 'Vite',
          group: 'frontend',
          stream: 'pty',
          text: 'vite-history',
        }),
        expect.objectContaining({
          sourceId: 'frontend-vite',
          segment: 'history',
          text: '[tmux history/live capture boundary]',
        }),
        expect.objectContaining({
          sourceId: 'frontend-vite',
          segment: 'live',
          text: 'vite-live',
        }),
        expect.objectContaining({
          sourceId: 'backend-api',
          sourceTitle: 'API',
          group: 'backend',
          text: 'api-live',
        }),
      ]),
    );
    expect(fs.readFileSync(path.join(sessionDir, 'logs', 'frontend-vite.log'), 'utf-8'))
      .not.toContain('\u001b');
    expect(latestState).toMatchObject({
      kind: 'tmux',
      ownsServer: true,
      ownsSession: true,
    });

    await stopOwnedEnvironment(state);
    expect(processIdentityMatches(state.serverProcess)).toBe(false);
    expect(fs.existsSync(state.socket.path)).toBe(false);
    await expect(stopOwnedEnvironment(state)).resolves.toBeUndefined();
    states.pop();
  }, 15000);

  it.skipIf(skipWithoutTmux)('does not kill a shared external tmux session', async () => {
    const socket = path.join(root, 'shared.sock');
    extraTmuxSockets.push(socket);
    execFileSync(
      'tmux',
      [
        '-S',
        socket,
        'new-session',
        '-d',
        '-s',
        'shared',
        "sleep 0.5; printf 'shared-live\\n'; sleep 30",
      ],
      { stdio: 'ignore' },
    );
    const sessionDir = path.join(root, 'shared-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    const started = await startOwnedEnvironment(
      {
        kind: 'tmux',
        launch: {
          kind: 'external-command',
          command: `printf 'tmux -S ${socket} attach -t shared\\n'`,
        },
        connection: {
          source: 'stdout',
          format: 'tmux-attach-command',
          ownership: 'attach',
        },
      },
      {
        sources: [
          {
            id: 'shared-pane',
            kind: 'tmux-pane',
            match: { target: 'shared:0.0' },
          },
        ],
      },
      sessionDir,
      'ps-shared-test',
      Date.now(),
      () => {},
    );
    if (started) states.push(started);
    const state = requireTmuxState(started);
    expect(state.ownsServer).toBe(false);
    expect(state.ownsSession).toBe(false);
    await waitForEvidence(state.evidencePath, ['shared-live']);

    await stopOwnedEnvironment(state);
    expect(() =>
      execFileSync('tmux', ['-S', socket, 'has-session', '-t', 'shared']),
    ).not.toThrow();
    states.pop();
  }, 15000);

  it.skipIf(skipWithoutTmux)('never owns a tmux server its attach-only launcher created', async () => {
    const socket = path.join(root, 'attach-created.sock');
    extraTmuxSockets.push(socket);
    expect(fs.existsSync(socket)).toBe(false);
    const sessionDir = path.join(root, 'attach-created-session');
    fs.mkdirSync(sessionDir, { recursive: true });

    const started = await startOwnedEnvironment(
      {
        kind: 'tmux',
        launch: {
          kind: 'external-command',
          command:
            `tmux -S ${socket} new-session -d -s created "printf 'created-live\\n'; sleep 30" && ` +
            `printf 'tmux -S ${socket} attach -t created\\n'`,
        },
        connection: {
          source: 'stdout',
          format: 'tmux-attach-command',
          ownership: 'attach',
          socket,
        },
      },
      {
        sources: [
          {
            id: 'created-pane',
            kind: 'tmux-pane',
            match: { target: 'created:0.0' },
          },
        ],
      },
      sessionDir,
      'ps-attach-created',
      Date.now(),
      () => {},
    );
    if (started) states.push(started);
    const state = requireTmuxState(started);

    expect(state.ownsServer).toBe(false);
    expect(state.ownsSession).toBe(false);
    await waitForEvidence(state.evidencePath, ['created-live']);

    await stopOwnedEnvironment(state);
    expect(
      execFileSync(
        'tmux',
        ['-S', socket, 'display-message', '-p', '-t', 'created:0.0', '#{pane_pipe}'],
        { encoding: 'utf-8' },
      ).trim(),
    ).toBe('0');
    expect(() =>
      execFileSync('tmux', ['-S', socket, 'has-session', '-t', 'created']),
    ).not.toThrow();
    states.pop();
  }, 15000);

  it('reports a capture gap when a capture worker dies mid-session', async () => {
    const sessionDir = path.join(root, 'capture-health-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    const started = await startOwnedEnvironment(
      {
        kind: 'processes',
        commands: [{ id: 'api', command: "printf 'api-ready\\n'; sleep 30" }],
      },
      {},
      sessionDir,
      'ps-capture-health',
      Date.now(),
      () => {},
    );
    if (started) states.push(started);
    const state = requireProcessState(started);
    await waitForEvidence(state.evidencePath, ['api-ready']);
    expect(recordCaptureHealthFailures(state)).toEqual([]);

    const capture = state.processes[0];
    process.kill(capture.process.pid, 'SIGKILL');
    await waitFor(() => !processIdentityMatches(capture.process));

    const failures = recordCaptureHealthFailures(state, Date.now());
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('"api"');
    expect(state.healthFailures).toEqual(failures);
    expect(
      loadEvidenceEvents(state.evidencePath).filter(
        (event) => event.captureGap && event.sourceId === 'api',
      ),
    ).toHaveLength(1);

    await stopOwnedEnvironment(state);
    states.pop();
  }, 15000);

  it.skipIf(skipWithoutTmux)('persists and cleans a timed-out external launcher identity', async () => {
    const sessionDir = path.join(root, 'timed-out-launcher');
    fs.mkdirSync(sessionDir, { recursive: true });
    let pendingState: EnvironmentState | null = null;

    await expect(
      startOwnedEnvironment(
        {
          kind: 'tmux',
          launch: {
            kind: 'external-command',
            command: 'sleep 30',
            timeoutMs: 100,
          },
          connection: {
            format: 'json',
            ownership: 'attach',
          },
        },
        { sources: [] },
        sessionDir,
        'ps-timed-out-launcher',
        Date.now(),
        (state) => {
          pendingState = state;
        },
      ),
    ).rejects.toThrow(/timed out/);

    expect(pendingState).toMatchObject({ kind: 'launcher' });
    const launcherState = requireLauncherState(pendingState);
    expect(processIdentityMatches(launcherState.launcher.process)).toBe(false);
  }, 15000);

  it('preserves direct stdout/stderr and file history/live evidence', async () => {
    const sessionDir = path.join(root, 'process-session');
    const filePath = path.join(root, 'worker.log');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(filePath, 'file-history\n');
    const started = await startOwnedEnvironment(
      {
        kind: 'processes',
        commands: [
          {
            id: 'api',
            title: 'API',
            group: 'backend',
            command: "printf 'process-out\\n'; printf 'process-err\\n' >&2; sleep 30",
          },
        ],
      },
      {
        sources: [
          {
            id: 'api',
            kind: 'process',
            processId: 'api',
            group: 'backend',
          },
          {
            id: 'worker',
            kind: 'file',
            path: filePath,
            group: 'backend',
          },
        ],
      },
      sessionDir,
      'ps-process-test',
      Date.now(),
      () => {},
    );
    if (started) states.push(started);
    fs.appendFileSync(filePath, 'file-live\n');
    const state = requireProcessState(started);
    const fileCapture = state.processes.find(
      (capture) => capture.sourceId === 'worker',
    );
    expect(fileCapture && processIdentityMatches(fileCapture.process)).toBe(true);
    await waitForEvidence(
      state.evidencePath,
      ['process-out', 'process-err', 'file-history', 'file-live'],
    );

    const events = loadEvidenceEvents(state.evidencePath);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'api', stream: 'stdout', text: 'process-out' }),
        expect.objectContaining({ sourceId: 'api', stream: 'stderr', text: 'process-err' }),
        expect.objectContaining({
          sourceId: 'worker',
          stream: 'file',
          segment: 'history',
          text: 'file-history',
        }),
        expect.objectContaining({
          sourceId: 'worker',
          stream: 'file',
          segment: 'live',
          text: 'file-live',
        }),
      ]),
    );

    expect(
      fs.readdirSync(path.join(sessionDir, 'logs')).sort(),
    ).toEqual(['api.log', 'worker.log']);

    await stopOwnedEnvironment(state);
    expect(
      state.processes.every((capture) => !processIdentityMatches(capture.process)),
    ).toBe(true);
    states.pop();
  }, 15000);

  it('refuses a log source the environment kind cannot capture', async () => {
    const sessionDir = path.join(root, 'mismatched-session');
    fs.mkdirSync(sessionDir, { recursive: true });

    await expect(
      startOwnedEnvironment(
        {
          kind: 'processes',
          commands: [{ id: 'api', command: 'sleep 30' }],
        },
        {
          sources: [
            { id: 'vite', kind: 'tmux-pane', match: { tag: 'vite' } },
          ],
        },
        sessionDir,
        'ps-source-kind-mismatch',
        Date.now(),
        () => {},
      ),
    ).rejects.toThrow(/cannot be captured by environment kind "processes"/);
    expect(fs.existsSync(path.join(sessionDir, 'logs'))).toBe(false);
  });

  it('launches every process definition when only some sources are customized', async () => {
    const sessionDir = path.join(root, 'all-processes-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    const started = await startOwnedEnvironment(
      {
        kind: 'processes',
        commands: [
          { id: 'api', command: "printf 'api-ready\\n'; sleep 30" },
          { id: 'worker', command: "printf 'worker-ready\\n'; sleep 30" },
        ],
      },
      {
        sources: [
          {
            id: 'custom-api',
            kind: 'process',
            processId: 'api',
          },
        ],
      },
      sessionDir,
      'ps-all-processes',
      Date.now(),
      () => {},
    );
    if (started) states.push(started);
    const state = requireProcessState(started);

    expect(state.processes.map((capture) => capture.sourceId).sort()).toEqual([
      'custom-api',
      'worker',
    ]);
    await waitForEvidence(state.evidencePath, ['api-ready', 'worker-ready']);

    await stopOwnedEnvironment(state);
    states.pop();
  }, 15000);

  it.skipIf(skipWithoutTmux)('refuses to replace a pre-existing pipe-pane consumer', async () => {
    const socket = path.join(root, 'p.sock');
    extraTmuxSockets.push(socket);
    execFileSync(
      'tmux',
      ['-S', socket, 'new-session', '-d', '-s', 'shared', 'sleep 30'],
      { stdio: 'ignore' },
    );
    execFileSync(
      'tmux',
      [
        '-S',
        socket,
        'pipe-pane',
        '-t',
        'shared:0.0',
        `cat > ${path.join(root, 'existing.log')}`,
      ],
      { stdio: 'ignore' },
    );
    const sessionDir = path.join(root, 'preexisting-session');
    fs.mkdirSync(sessionDir, { recursive: true });

    await expect(
      startOwnedEnvironment(
        {
          kind: 'tmux',
          launch: {
            kind: 'external-command',
            command: `printf 'tmux -S ${socket} attach -t shared\\n'`,
          },
          connection: {
            source: 'stdout',
            format: 'tmux-attach-command',
            ownership: 'attach',
          },
        },
        {
          sources: [
            {
              id: 'shared-pane',
              kind: 'tmux-pane',
              match: { target: 'shared:0.0' },
            },
          ],
        },
        sessionDir,
        'ps-existing-pipe',
        Date.now(),
        () => {},
      ),
    ).rejects.toThrow(/already has a pipe-pane consumer/);

    expect(
      execFileSync(
        'tmux',
        ['-S', socket, 'display-message', '-p', '-t', 'shared:0.0', '#{pane_pipe}'],
        { encoding: 'utf-8' },
      ).trim(),
    ).toBe('1');
  }, 15000);

  it('cleans process ownership when readiness fails', async () => {
    const sessionDir = path.join(root, 'readiness-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    let latestState: EnvironmentState | null = null;

    await expect(
      startOwnedEnvironment(
        {
          kind: 'processes',
          commands: [
            {
              id: 'api',
              command: 'sleep 30',
            },
          ],
          readiness: [
            {
              kind: 'http',
              url: 'http://127.0.0.1:1/health',
              timeoutMs: 200,
            },
          ],
        },
        {},
        sessionDir,
        'ps-readiness-failure',
        Date.now(),
        (state) => {
          latestState = state;
        },
      ),
    ).rejects.toThrow(/Environment readiness failed/);

    const recoveryState = requireProcessState(latestState);
    expect(
      recoveryState.processes.every(
        (capture) => !processIdentityMatches(capture.process),
      ),
    ).toBe(true);
  }, 15000);

  it('records truncation and cleans descendants after a coordinator dies', async () => {
    const sessionDir = path.join(root, 'truncation-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    const started = await startOwnedEnvironment(
      {
        kind: 'processes',
        commands: [
          {
            id: 'noisy',
            command: `${process.execPath} -e "console.log('x'.repeat(1024)); setInterval(() => {}, 1000)"`,
          },
        ],
      },
      {
        maxBytesPerSource: 512,
      },
      sessionDir,
      'ps-truncation',
      Date.now(),
      () => {},
    );
    if (started) states.push(started);
    const state = requireProcessState(started);
    await waitForEvidence(state.evidencePath, ['capture truncated']);
    expect(
      loadEvidenceEvents(state.evidencePath).some((event) => event.truncated),
    ).toBe(true);
    expect(
      fs.statSync(state.evidencePath).size +
        fs.statSync(path.join(sessionDir, 'logs', 'noisy.log')).size,
    ).toBeLessThanOrEqual(512);
    const coordinator = state.processes[0].process;
    process.kill(coordinator.pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 100));

    await stopOwnedEnvironment(state);
    expect(processIdentityMatches(coordinator)).toBe(false);
    states.pop();
  }, 15000);
});

function requireProcessState(
  state: EnvironmentState | null,
): ProcessEnvironmentState {
  if (!state || state.kind !== 'processes') {
    throw new Error('expected process state');
  }
  return state;
}

function requireTmuxState(
  state: EnvironmentState | null,
): TmuxEnvironmentState {
  if (!state || state.kind !== 'tmux') {
    throw new Error('expected tmux state');
  }
  return state;
}

function requireLauncherState(
  state: EnvironmentState | null,
): LauncherEnvironmentState {
  if (!state || state.kind !== 'launcher') {
    throw new Error('expected persisted launcher state');
  }
  return state;
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Condition was not met before the timeout.');
}

async function waitForEvidence(
  evidencePath: string,
  texts: string[],
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = loadEvidenceEvents(evidencePath);
    if (texts.every((text) => events.some((event) => event.text.includes(text)))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const raw = fs.existsSync(evidencePath)
    ? fs.readFileSync(evidencePath, 'utf-8')
    : '<missing evidence file>';
  const captureDir = path.join(path.dirname(evidencePath), '.capture');
  const helperErrors = fs.existsSync(captureDir)
    ? fs
        .readdirSync(captureDir)
        .filter((file) => file.endsWith('.stderr'))
        .map((file) => `${file}:\n${fs.readFileSync(path.join(captureDir, file), 'utf-8')}`)
        .join('\n')
    : '';
  throw new Error(`Missing evidence: ${texts.join(', ')}\n${raw}\n${helperErrors}`);
}
