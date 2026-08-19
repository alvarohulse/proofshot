import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startCommand: vi.fn(),
  execCommand: vi.fn(),
  stopCommand: vi.fn(),
}));

vi.mock('./start.js', () => ({ startCommand: mocks.startCommand }));
vi.mock('./exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./exec.js')>()),
  execCommand: mocks.execCommand,
}));
vi.mock('./stop.js', () => ({ stopCommand: mocks.stopCommand }));

import { replayCommand } from './replay.js';

let root: string;
let sessionDir: string;
let casePath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-replay-'));
  sessionDir = path.join(root, 'session');
  fs.mkdirSync(sessionDir);
  casePath = path.join(root, 'case.json');
  fs.writeFileSync(
    casePath,
    JSON.stringify({
      version: 1,
      description: 'Create a task.',
      start: { url: 'http://localhost:3000' },
      steps: [
        { command: ['click', '#create'] },
        { command: ['assert-visible', '#created'] },
        { command: ['screenshot', 'created.png'] },
      ],
      humanTesting: ['Create a task.', 'Confirm it appears.'],
    }),
  );
  mocks.startCommand.mockResolvedValue({
    sessionId: 'ps-replay-123',
    sessionDir,
  });
  mocks.stopCommand.mockImplementation(async () => {
    fs.writeFileSync(
      path.join(sessionDir, 'verdict.json'),
      JSON.stringify({ status: 'PASS' }),
    );
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('replayCommand', () => {
  it('uses one exact fresh session and writes reviewer instructions before stop', async () => {
    await replayCommand(casePath);

    expect(mocks.execCommand.mock.calls).toEqual([
      [['click', '#create'], { session: 'ps-replay-123', throwOnFailure: true }],
      [['assert-visible', '#created'], { session: 'ps-replay-123', throwOnFailure: true }],
      [['screenshot', 'created.png'], { session: 'ps-replay-123', throwOnFailure: true }],
    ]);
    expect(mocks.stopCommand).toHaveBeenCalledWith({
      session: 'ps-replay-123',
    });
    expect(fs.readFileSync(path.join(sessionDir, 'USER_TESTING.md'), 'utf-8'))
      .toBe('# User Testing\n\n1. Create a task.\n2. Confirm it appears.\n');
  });

  it('attempts exact stop after a failed replay step', async () => {
    mocks.execCommand.mockImplementationOnce(async () => {
      process.exitCode = 1;
    });

    await expect(replayCommand(casePath)).rejects.toThrow(
      'Replay step failed (1): click',
    );
    expect(mocks.execCommand).toHaveBeenCalledTimes(1);
    expect(mocks.stopCommand).toHaveBeenCalledWith({
      session: 'ps-replay-123',
    });
    expect(fs.readFileSync(path.join(sessionDir, 'USER_TESTING.md'), 'utf-8'))
      .toBe('# User Testing\n\n1. Create a task.\n2. Confirm it appears.\n');
  });

  it('rejects a forbidden later command before starting a session', async () => {
    const replay = JSON.parse(fs.readFileSync(casePath, 'utf-8'));
    replay.steps.splice(1, 0, { command: ['record', 'stop'] });
    fs.writeFileSync(casePath, JSON.stringify(replay));
    await expect(replayCommand(casePath)).rejects.toThrow(
      /record is ProofShot-owned/,
    );
    expect(mocks.startCommand).not.toHaveBeenCalled();
    expect(mocks.execCommand).not.toHaveBeenCalled();
    expect(mocks.stopCommand).not.toHaveBeenCalled();
  });
});
