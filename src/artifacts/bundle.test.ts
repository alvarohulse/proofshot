import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureOutputDir } from './bundle.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ensureOutputDir', () => {
  it('creates private directories without changing an existing unsafe directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const outputDirectory = path.join(root, 'proofshot-artifacts');

    ensureOutputDir(outputDirectory);
    expect(fs.statSync(outputDirectory).mode & 0o777).toBe(0o700);
    expect(() => ensureOutputDir(outputDirectory)).not.toThrow();

    fs.chmodSync(outputDirectory, 0o755);

    expect(() => ensureOutputDir(outputDirectory)).toThrow(/private/);
    expect(fs.statSync(outputDirectory).mode & 0o777).toBe(0o755);
  });

  it('rejects a symlink without changing its target permissions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const targetDirectory = path.join(root, 'target');
    const outputDirectory = path.join(root, 'proofshot-artifacts');
    fs.mkdirSync(targetDirectory, { mode: 0o700 });
    fs.symlinkSync(targetDirectory, outputDirectory);

    expect(() => ensureOutputDir(outputDirectory)).toThrow(/real directory/);
    expect(fs.statSync(targetDirectory).mode & 0o777).toBe(0o700);
  });
});
