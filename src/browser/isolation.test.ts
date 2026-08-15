import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: mocks.execFileSync,
}));

import {
  assertSupportedAgentBrowserVersion,
  getIsolatedAgentBrowserEnvironment,
  loadIsolatedAgentBrowserConfig,
  parseAgentBrowserVersion,
  writeIsolatedAgentBrowserConfig,
} from './isolation.js';

const createdDirectories: string[] = [];

beforeEach(() => {
  mocks.execFileSync.mockReset();
});

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('agent-browser isolation', () => {
  it('rejects inherited provider, connection, and persistent-state modes', () => {
    for (const key of [
      'AGENT_BROWSER_PROVIDER',
      'AGENT_BROWSER_CDP',
      'AGENT_BROWSER_AUTO_CONNECT',
      'AGENT_BROWSER_PROFILE',
      'AGENT_BROWSER_PLUGINS',
      'AGENT_BROWSER_STATE',
      'AGENT_BROWSER_SESSION_NAME',
    ]) {
      expect(() =>
        loadIsolatedAgentBrowserConfig(undefined, { [key]: 'configured' }),
      ).toThrow(key);
    }
  });

  it('rejects incompatible modes in an explicit config', () => {
    const directory = createDirectory();
    const configPath = path.join(directory, 'agent-browser.json');
    fs.writeFileSync(configPath, JSON.stringify({ profile: './shared-profile' }));

    expect(() =>
      loadIsolatedAgentBrowserConfig(configPath, {}),
    ).toThrow('config key "profile"');
  });

  it('rejects plugin loading from an explicit config', () => {
    const directory = createDirectory();
    const configPath = path.join(directory, 'agent-browser.json');
    fs.writeFileSync(configPath, JSON.stringify({ plugins: ['./plugin.js'] }));

    expect(() => loadIsolatedAgentBrowserConfig(configPath, {})).toThrow(
      'config key "plugins"',
    );
  });

  it('copies a safe config into private per-session state', () => {
    const directory = createDirectory();
    const sourcePath = path.join(directory, 'source.json');
    const privateDirectory = path.join(directory, 'private', 'agent-browser');
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({ ignoreHttpsErrors: true, userAgent: 'proofshot-test' }),
    );

    const config = loadIsolatedAgentBrowserConfig(sourcePath, {});
    const configPath = writeIsolatedAgentBrowserConfig(privateDirectory, config);

    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual(config);
    expect(fs.statSync(privateDirectory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('strips incompatible modes from every agent-browser subprocess', () => {
    const environment = getIsolatedAgentBrowserEnvironment({
      AGENT_BROWSER_PROVIDER: 'browserbase',
      AGENT_BROWSER_PROFILE: './shared',
      PATH: '/usr/bin',
    });

    expect(environment).toEqual({ PATH: '/usr/bin' });
  });

  it('parses the supported semantic version envelope', () => {
    expect(parseAgentBrowserVersion('agent-browser 0.34.0')).toEqual([0, 34, 0]);
    expect(parseAgentBrowserVersion('0.35.2')).toEqual([0, 35, 2]);
    expect(parseAgentBrowserVersion('unknown')).toBeNull();
  });

  it('requires agent-browser 0.34.0 or newer before launch', () => {
    mocks.execFileSync.mockReturnValueOnce('agent-browser 0.33.1\n');
    expect(() => assertSupportedAgentBrowserVersion({ PATH: '/usr/bin' })).toThrow(
      'requires agent-browser >=0.34.0',
    );

    mocks.execFileSync.mockReturnValueOnce('agent-browser 0.34.0\n');
    expect(assertSupportedAgentBrowserVersion({ PATH: '/usr/bin' })).toBe(
      '0.34.0',
    );
  });
});

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-isolation-'));
  createdDirectories.push(directory);
  return directory;
}
