import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  findExecutablePath: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: mocks.execFileSync,
}));
vi.mock('../utils/process.js', () => ({
  findExecutablePath: mocks.findExecutablePath,
}));

import {
  assertAgentBrowserRuntime,
  getIsolatedAgentBrowserEnvironment,
  loadIsolatedAgentBrowserConfig,
  parseAgentBrowserVersion,
  resolveAgentBrowserRuntime,
  writeIsolatedAgentBrowserConfig,
} from './isolation.js';

const createdDirectories: string[] = [];
const RUNTIME_SOURCE = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01]);
let runtimeExecutablePath: string;

beforeEach(() => {
  mocks.execFileSync.mockReset();
  mocks.findExecutablePath.mockReset();
  const directory = createDirectory();
  runtimeExecutablePath = path.join(directory, 'agent-browser');
  fs.writeFileSync(runtimeExecutablePath, RUNTIME_SOURCE, { mode: 0o755 });
  mocks.findExecutablePath.mockReturnValue(runtimeExecutablePath);
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

  it('rejects JSON output mode from an explicit config', () => {
    const directory = createDirectory();
    const configPath = path.join(directory, 'agent-browser.json');
    fs.writeFileSync(configPath, JSON.stringify({ json: true }));

    expect(() => loadIsolatedAgentBrowserConfig(configPath, {})).toThrow(
      'config key "json"',
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

  it('resolves one executable and requires exactly agent-browser 0.34.0', () => {
    mockVersions('agent-browser 0.33.1\n');
    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'requires exactly agent-browser 0.34.0',
    );

    mockVersions('agent-browser 0.35.0\n');
    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'requires exactly agent-browser 0.34.0',
    );

    mockVersions('agent-browser 0.34.0-beta.1\n');
    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'requires exactly agent-browser 0.34.0',
    );

    mockVersions('agent-browser 0.34.0\n');
    expect(resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toEqual({
      contract: 'direct-native-v1',
      executablePath: runtimeExecutablePath,
      nativePath: runtimeExecutablePath,
      nativeSha256: createHash('sha256').update(RUNTIME_SOURCE).digest('hex'),
      sha256: createHash('sha256').update(RUNTIME_SOURCE).digest('hex'),
      version: '0.34.0',
    });
    expect(mocks.execFileSync).toHaveBeenLastCalledWith(
      runtimeExecutablePath,
      ['--version'],
      expect.objectContaining({ env: { PATH: '/usr/bin' } }),
    );
  });

  it('normalizes a discovered executable to an absolute path before probing it', () => {
    const relativeExecutablePath = path.relative(
      process.cwd(),
      runtimeExecutablePath,
    );
    mocks.findExecutablePath.mockReturnValue(relativeExecutablePath);
    mockVersions('0.34.0\n');

    expect(resolveAgentBrowserRuntime({ PATH: './tools' })).toEqual({
      contract: 'direct-native-v1',
      executablePath: runtimeExecutablePath,
      nativePath: runtimeExecutablePath,
      nativeSha256: createHash('sha256').update(RUNTIME_SOURCE).digest('hex'),
      sha256: createHash('sha256').update(RUNTIME_SOURCE).digest('hex'),
      version: '0.34.0',
    });
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      runtimeExecutablePath,
      ['--version'],
      expect.any(Object),
    );
  });

  it('pins the native artifact and managed launcher contract', () => {
    const directory = createDirectory();
    const entrypointPath = path.join(directory, 'agent-browser.js');
    const nativePath = path.join(directory, 'agent-browser-linux-x64');
    const entrypointSource = '#!/usr/bin/env node\n';
    const nativeSource = Buffer.concat([
      RUNTIME_SOURCE,
      Buffer.from('managed-native'),
    ]);
    fs.writeFileSync(entrypointPath, entrypointSource);
    fs.writeFileSync(nativePath, nativeSource, { mode: 0o755 });
    const entrypointSha256 = createHash('sha256')
      .update(entrypointSource)
      .digest('hex');
    const nativeSha256 = createHash('sha256')
      .update(nativeSource)
      .digest('hex');
    mocks.execFileSync.mockImplementation(
      (_executablePath: string, args: string[]) =>
        args[0] === '--managed-preflight'
          ? JSON.stringify({
              agentBrowserVersion: '0.34.0',
              entrypointPath,
              entrypointSha256,
              nativePath,
              nativeSha256,
              nodeVersion: 'v24.19.0',
              result: 'ok',
            })
          : 'agent-browser 0.34.0\n',
    );

    expect(resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toEqual({
      contract: 'managed-preflight-v1',
      entrypointSha256,
      executablePath: runtimeExecutablePath,
      nativePath,
      nativeSha256,
      nodeVersion: 'v24.19.0',
      sha256: createHash('sha256').update(RUNTIME_SOURCE).digest('hex'),
      version: '0.34.0',
    });
  });

  it('fails before version probing when agent-browser is unavailable', () => {
    mocks.findExecutablePath.mockReturnValue(null);

    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'agent-browser executable was not found',
    );
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it('rejects same-path executable replacement after a session starts', () => {
    mockVersions('agent-browser 0.34.0\n', 'agent-browser 0.34.0\n');
    const runtime = resolveAgentBrowserRuntime({ PATH: '/usr/bin' });
    fs.writeFileSync(
      runtimeExecutablePath,
      Buffer.concat([RUNTIME_SOURCE, Buffer.from('replaced')]),
    );

    expect(() =>
      assertAgentBrowserRuntime(runtime, { PATH: '/usr/bin' }),
    ).toThrow('executable changed');
  });

  it('pins the canonical executable when its discovery symlink is retargeted', () => {
    const directory = createDirectory();
    const firstTarget = path.join(directory, 'agent-browser-first');
    const secondTarget = path.join(directory, 'agent-browser-second');
    const symlinkPath = path.join(directory, 'agent-browser');
    fs.writeFileSync(firstTarget, RUNTIME_SOURCE, { mode: 0o755 });
    fs.writeFileSync(secondTarget, Buffer.concat([RUNTIME_SOURCE, Buffer.from('second')]), {
      mode: 0o755,
    });
    fs.symlinkSync(firstTarget, symlinkPath);
    mocks.findExecutablePath.mockReturnValue(symlinkPath);
    mockVersions('agent-browser 0.34.0\n', 'agent-browser 0.34.0\n');
    const runtime = resolveAgentBrowserRuntime({ PATH: '/usr/bin' });

    fs.unlinkSync(symlinkPath);
    fs.symlinkSync(secondTarget, symlinkPath);

    expect(() =>
      assertAgentBrowserRuntime(runtime, { PATH: '/usr/bin' }),
    ).not.toThrow();
    expect(mocks.execFileSync).toHaveBeenLastCalledWith(
      firstTarget,
      ['--version'],
      expect.any(Object),
    );
  });
});

function mockVersions(...versions: string[]): void {
  mocks.execFileSync.mockImplementation(
    (_executablePath: string, args: string[]) => {
      if (args[0] === '--managed-preflight') {
        throw new Error('unsupported option');
      }
      const version = versions.shift();
      if (!version) {
        throw new Error('missing mocked version');
      }
      return version;
    },
  );
}

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-isolation-'));
  createdDirectories.push(directory);
  return directory;
}
