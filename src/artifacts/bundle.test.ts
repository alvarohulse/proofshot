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
  it('keeps ProofShot output and session directories private', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-'));
    temporaryDirectories.push(root);
    const outputDirectory = path.join(root, 'proofshot-artifacts');
    const sessionDirectory = path.join(outputDirectory, 'session');

    ensureOutputDir(outputDirectory);
    fs.chmodSync(outputDirectory, 0o755);
    ensureOutputDir(outputDirectory);
    ensureOutputDir(sessionDirectory);

    expect(fs.statSync(outputDirectory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(sessionDirectory).mode & 0o777).toBe(0o700);
  });
});
