import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadConfig: vi.fn() }));
vi.mock('../utils/config.js', () => ({ loadConfig: mocks.loadConfig }));

import { cleanCommand } from './clean.js';

let root: string;

beforeEach(() => {
  const cache = path.join(os.userInfo().homedir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  root = fs.mkdtempSync(path.join(cache, 'proofshot-clean-test-'));
  mocks.loadConfig.mockReturnValue({ output: root });
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
  it('refuses to discard active exact-process ownership metadata', async () => {
    const controlPath = path.join(root, '.session.json');
    const evidencePath = path.join(root, 'evidence.txt');
    fs.writeFileSync(controlPath, JSON.stringify({ browserRetained: true }));
    fs.writeFileSync(evidencePath, 'keep');

    await expect(cleanCommand()).rejects.toThrow('process.exit:1');

    expect(fs.readFileSync(controlPath, 'utf-8')).toContain('browserRetained');
    expect(fs.readFileSync(evidencePath, 'utf-8')).toBe('keep');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Run "proofshot stop" first'),
    );
  });
});
