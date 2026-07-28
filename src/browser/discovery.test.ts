import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverBrowserExecutable } from './discovery.js';

const createdRoots: string[] = [];

function createRoot(): string {
  const cache = path.join(os.userInfo().homedir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const root = fs.mkdtempSync(path.join(cache, 'proofshot-browser-test-'));
  createdRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('discoverBrowserExecutable', () => {
  it('finds an executable in the real account home when HOME is isolated', () => {
    const accountHome = createRoot();
    const chrome = path.join(
      accountHome,
      '.agent-browser',
      'browsers',
      'chrome-151.0.0',
      'chrome',
    );
    fs.mkdirSync(path.dirname(chrome), { recursive: true });
    fs.writeFileSync(chrome, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(chrome, 0o700);

    expect(
      discoverBrowserExecutable({
        env: { HOME: path.join(accountHome, 'isolated-home') },
        accountHome,
        platform: 'linux',
        findExecutable: () => null,
      }),
    ).toBe(chrome);
  });

  it('returns one exact retry flag when an explicit browser path is invalid', () => {
    const missing = path.join(createRoot(), 'missing-chrome');

    expect(() =>
      discoverBrowserExecutable({
        configuredPath: missing,
        findExecutable: () => null,
      }),
    ).toThrow(`proofshot start --browser-executable ${JSON.stringify(missing)}`);
  });
});
