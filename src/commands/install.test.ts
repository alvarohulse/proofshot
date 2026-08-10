import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCommand } from './install.js';

const mocks = vi.hoisted(() => ({
  home: '',
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => mocks.home,
  };
});

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-install-test-'));
  mocks.home = root;
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('installCommand Cursor skill', () => {
  it('installs ProofShot as a personal Cursor skill', async () => {
    await installCommand({ only: 'cursor' });

    const skillPath = path.join(
      root,
      '.cursor',
      'skills',
      'proofshot',
      'SKILL.md',
    );
    expect(fs.readFileSync(skillPath, 'utf-8')).toContain(
      'name: proofshot',
    );
  });

  it('preserves and disables the legacy Cursor rule after installing the skill', async () => {
    const legacyPath = path.join(root, '.cursor', 'rules', 'proofshot.mdc');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, 'custom legacy guidance\n');

    await installCommand({ only: 'cursor' });

    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(fs.readFileSync(`${legacyPath}.migrated`, 'utf-8')).toBe(
      'custom legacy guidance\n',
    );
    expect(
      fs.existsSync(
        path.join(root, '.cursor', 'skills', 'proofshot', 'SKILL.md'),
      ),
    ).toBe(true);
  });

  it('keeps the legacy rule active when the skill cannot be written', async () => {
    const legacyPath = path.join(root, '.cursor', 'rules', 'proofshot.mdc');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, 'legacy guidance\n');
    fs.writeFileSync(path.join(root, '.cursor', 'skills'), 'not a directory');

    await installCommand({ only: 'cursor' });

    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe('legacy guidance\n');
    expect(fs.existsSync(`${legacyPath}.migrated`)).toBe(false);
  });
});
