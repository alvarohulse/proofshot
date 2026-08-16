import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncBuiltinESMExports } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureOutputDir } from './bundle.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ensureOutputDir', () => {
  it('creates private directories without changing an existing unsafe directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const outputDirectory = path.join(root, 'proofshot-artifacts');
    const nestedDirectory = path.join(outputDirectory, 'private', 'environment');

    expect(ensureOutputDir(outputDirectory)).toBe(outputDirectory);
    expect(fs.statSync(outputDirectory).mode & 0o777).toBe(0o700);
    expect(ensureOutputDir(nestedDirectory)).toBe(nestedDirectory);
    expect(fs.statSync(nestedDirectory).mode & 0o777).toBe(0o700);
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

  it('does not create through an ancestor swapped during mkdir', () => {
    if (process.platform !== 'linux') {
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const outputParent = path.join(root, 'output');
    const displacedOutputParent = path.join(root, 'output-before-race');
    const targetDirectory = path.join(root, 'target');
    const targetOutputDirectory = path.join(targetDirectory, 'session');
    const outputDirectory = path.join(outputParent, 'session');
    fs.mkdirSync(outputParent, { mode: 0o700 });
    fs.mkdirSync(targetDirectory, { mode: 0o755 });
    fs.chmodSync(targetDirectory, 0o755);

    const mkdirSync = fs.mkdirSync;
    let swapped = false;
    vi.spyOn(fs, 'mkdirSync').mockImplementation((directory, options) => {
      if (!swapped && path.basename(String(directory)) === 'session') {
        fs.renameSync(outputParent, displacedOutputParent);
        fs.symlinkSync(targetDirectory, outputParent);
        swapped = true;
      }
      return mkdirSync(directory, options);
    });
    syncBuiltinESMExports();

    expect(() => ensureOutputDir(outputDirectory)).toThrow();
    expect(fs.existsSync(targetOutputDirectory)).toBe(false);
    expect(fs.statSync(targetDirectory).mode & 0o777).toBe(0o755);
  });

  it('keeps descriptor chmod bound to a leaf swapped during validation', () => {
    if (process.platform === 'win32') {
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const outputDirectory = path.join(root, 'session');
    const displacedOutputDirectory = path.join(root, 'session-before-race');
    const targetDirectory = path.join(root, 'target');
    fs.mkdirSync(targetDirectory, { mode: 0o755 });
    fs.chmodSync(targetDirectory, 0o755);

    const chmodSync = fs.chmodSync;
    const fchmodSync = fs.fchmodSync;
    let swapped = false;
    function swapOutputDirectory(): void {
      if (swapped) {
        return;
      }
      fs.renameSync(outputDirectory, displacedOutputDirectory);
      fs.symlinkSync(targetDirectory, outputDirectory);
      swapped = true;
    }
    const chmodSpy = vi.spyOn(fs, 'chmodSync').mockImplementation((filePath, mode) => {
      swapOutputDirectory();
      chmodSync(filePath, mode);
    });
    vi.spyOn(fs, 'fchmodSync').mockImplementation((fileDescriptor, mode) => {
      swapOutputDirectory();
      fchmodSync(fileDescriptor, mode);
    });
    syncBuiltinESMExports();

    expect(() => ensureOutputDir(outputDirectory)).toThrow();
    expect(chmodSpy).not.toHaveBeenCalled();
    expect(fs.statSync(targetDirectory).mode & 0o777).toBe(0o755);
  });

  it('does not accept a leaf swapped during descriptor validation', () => {
    if (process.platform === 'win32') {
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const outputDirectory = path.join(root, 'session');
    const displacedOutputDirectory = path.join(root, 'session-before-race');
    const targetDirectory = path.join(root, 'target');
    fs.mkdirSync(outputDirectory, { mode: 0o700 });
    fs.mkdirSync(targetDirectory, { mode: 0o700 });

    const accessSync = fs.accessSync;
    const fstatSync = fs.fstatSync;
    let swapped = false;
    function swapOutputDirectory(): void {
      if (swapped) {
        return;
      }
      fs.renameSync(outputDirectory, displacedOutputDirectory);
      fs.symlinkSync(targetDirectory, outputDirectory);
      swapped = true;
    }
    const accessSpy = vi.spyOn(fs, 'accessSync').mockImplementation((filePath, mode) => {
      swapOutputDirectory();
      accessSync(filePath, mode);
    });
    vi.spyOn(fs, 'fstatSync').mockImplementation((fileDescriptor, options) => {
      swapOutputDirectory();
      return fstatSync(fileDescriptor, options);
    });
    syncBuiltinESMExports();

    expect(() => ensureOutputDir(outputDirectory)).toThrow();
    expect(accessSpy).toHaveBeenCalledOnce();
    expect(fs.lstatSync(outputDirectory).isSymbolicLink()).toBe(true);
    expect(fs.statSync(targetDirectory).mode & 0o777).toBe(0o700);
  });

  it('canonicalizes an immutable root-owned system alias ancestor', () => {
    if (process.platform === 'win32') {
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const canonicalTarget = path.join(root, 'canonical-target');
    const realAlias = path.join(root, 'real-alias');
    const virtualAlias = `/proofshot-system-alias-${path.basename(root)}`;
    fs.mkdirSync(canonicalTarget, { mode: 0o700 });
    fs.symlinkSync(canonicalTarget, realAlias);

    const lstatSync = fs.lstatSync;
    const realpathSync = fs.realpathSync;
    const aliasStat = lstatSync(realAlias);
    aliasStat.uid = 0;
    vi.spyOn(fs, 'lstatSync').mockImplementation((filePath, options) => {
      const resolvedPath = path.resolve(String(filePath));
      if (resolvedPath === virtualAlias || resolvedPath === realAlias) {
        return aliasStat;
      }
      return lstatSync(filePath, options);
    });
    vi.spyOn(fs, 'realpathSync').mockImplementation((filePath, options) => {
      if (path.resolve(String(filePath)) === virtualAlias) {
        return canonicalTarget;
      }
      return realpathSync(filePath, options);
    });
    syncBuiltinESMExports();

    const outputDirectory = path.join(virtualAlias, 'session');
    const canonicalOutputDirectory = path.join(canonicalTarget, 'session');
    expect(ensureOutputDir(outputDirectory)).toBe(canonicalOutputDirectory);
    expect(fs.statSync(canonicalOutputDirectory).mode & 0o777).toBe(0o700);
    expect(() => ensureOutputDir(virtualAlias)).toThrow(/real directory/);
    expect(() => ensureOutputDir(path.join(realAlias, 'unsafe'))).toThrow(
      /real directory/,
    );
  });
});
