import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAgentBrowserSessionFiles,
  prepareAgentBrowserSocketDir,
  UNIX_SOCKET_PATH_MAX_BYTES,
} from './runtime.js';

const createdRoots: string[] = [];

function createAccountHome(): string {
  const cache = path.join(os.userInfo().homedir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const root = fs.mkdtempSync(path.join(cache, 'proofshot-runtime-test-'));
  createdRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('prepareAgentBrowserSocketDir', () => {
  it('stays short and independent of a long isolated HOME', () => {
    const accountHome = createAccountHome();
    const isolatedHome = path.join(accountHome, 'isolated', 'x'.repeat(180));
    const sessionName = 'ps-audit-123456789abc';

    const socketDir = prepareAgentBrowserSocketDir(
      sessionName,
      { HOME: isolatedHome },
      accountHome,
    );

    expect(socketDir).not.toContain(isolatedHome);
    expect(Buffer.byteLength(path.join(socketDir, `${sessionName}.sock`))).toBeLessThanOrEqual(
      UNIX_SOCKET_PATH_MAX_BYTES,
    );
    expect(fs.statSync(socketDir).mode & 0o777).toBe(0o700);
  });

  it('rejects an explicitly configured socket path before agent-browser starts', () => {
    const accountHome = createAccountHome();
    const longSocketDir = path.join(accountHome, 'x'.repeat(90));

    expect(() =>
      prepareAgentBrowserSocketDir(
        'ps-audit-123456789abc',
        { AGENT_BROWSER_SOCKET_DIR: longSocketDir },
        accountHome,
      ),
    ).toThrow(/max 103/);
  });

  it('removes only one stopped session socket and PID sidecars', () => {
    const accountHome = createAccountHome();
    const socketDir = prepareAgentBrowserSocketDir(
      'ps-audit-123456789abc',
      { AGENT_BROWSER_SOCKET_DIR: path.join(accountHome, 'sockets') },
      accountHome,
    );
    const sessionName = 'ps-audit-123456789abc';
    const otherPath = path.join(socketDir, 'ps-other.pid');
    for (const suffix of ['.pid', '.sock']) {
      fs.writeFileSync(path.join(socketDir, `${sessionName}${suffix}`), 'owned');
    }
    fs.writeFileSync(otherPath, 'other');

    clearAgentBrowserSessionFiles(socketDir, sessionName);

    expect(fs.existsSync(path.join(socketDir, `${sessionName}.pid`))).toBe(false);
    expect(fs.existsSync(path.join(socketDir, `${sessionName}.sock`))).toBe(false);
    expect(fs.existsSync(otherPath)).toBe(true);
  });
});
