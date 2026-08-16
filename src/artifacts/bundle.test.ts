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

  it('rejects a new directory below a symlinked ancestor without creating it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const targetDirectory = path.join(root, 'target');
    const linkedAncestor = path.join(root, 'linked-output');
    const targetOutputDirectory = path.join(targetDirectory, 'session');
    const outputDirectory = path.join(linkedAncestor, 'session');
    fs.mkdirSync(targetDirectory, { mode: 0o755 });
    fs.chmodSync(targetDirectory, 0o755);
    fs.symlinkSync(targetDirectory, linkedAncestor);

    expect(() => ensureOutputDir(outputDirectory)).toThrow(/real directory/);
    expect(fs.existsSync(targetOutputDirectory)).toBe(false);
    expect(fs.statSync(targetDirectory).mode & 0o777).toBe(0o755);
  });

  it('rejects an existing directory below a symlinked ancestor without changing it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const targetDirectory = path.join(root, 'target');
    const linkedAncestor = path.join(root, 'linked-output');
    const targetOutputDirectory = path.join(targetDirectory, 'session');
    const outputDirectory = path.join(linkedAncestor, 'session');
    fs.mkdirSync(targetDirectory, { mode: 0o755 });
    fs.chmodSync(targetDirectory, 0o755);
    fs.mkdirSync(targetOutputDirectory, { mode: 0o700 });
    fs.symlinkSync(targetDirectory, linkedAncestor);

    expect(() => ensureOutputDir(outputDirectory)).toThrow(/real directory/);
    expect(fs.statSync(targetDirectory).mode & 0o777).toBe(0o755);
    expect(fs.statSync(targetOutputDirectory).mode & 0o777).toBe(0o700);
  });

  it('rejects a non-directory ancestor without changing it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const fileAncestor = path.join(root, 'not-a-directory');
    const outputDirectory = path.join(fileAncestor, 'session');
    fs.writeFileSync(fileAncestor, 'unchanged');

    expect(() => ensureOutputDir(outputDirectory)).toThrow(/real directory/);
    expect(fs.readFileSync(fileAncestor, 'utf8')).toBe('unchanged');
  });
});
