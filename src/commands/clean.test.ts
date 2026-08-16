import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  listSessionsForControlDir: vi.fn(),
}));
vi.mock('../utils/config.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../session/selection.js', () => ({
  listSessionsForControlDir: mocks.listSessionsForControlDir,
}));

import { cleanCommand } from './clean.js';

let root: string;

beforeEach(() => {
  const cache = path.join(os.userInfo().homedir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  root = fs.mkdtempSync(path.join(cache, 'proofshot-clean-test-'));
  mocks.loadConfig.mockReturnValue({ output: root });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.loadConfig.mockReset();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('cleanCommand', () => {
  it.each(['starting', 'active', 'stopping', 'recovery', undefined])(
    'refuses to discard evidence while %s registry state remains',
    async (lifecycleStatus) => {
      mocks.listSessionsForControlDir.mockReturnValue([
        { lifecycleStatus, sessionName: 'ps-registered' },
      ]);
      const evidencePath = path.join(root, 'evidence.txt');
      fs.writeFileSync(evidencePath, 'keep');

      await expect(cleanCommand()).rejects.toThrow('process.exit:1');

      expect(fs.readFileSync(evidencePath, 'utf-8')).toBe('keep');
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Run "proofshot stop" or "proofshot session clean"'),
      );
    },
  );

  it('removes evidence after all registry state is cleared', async () => {
    mocks.listSessionsForControlDir.mockReturnValue([]);
    fs.writeFileSync(path.join(root, 'evidence.txt'), 'remove');

    await cleanCommand();

    expect(fs.existsSync(root)).toBe(false);
  });
});
