import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  execFileSync,
  spawn,
  spawnSync,
  type SpawnSyncReturns,
} from 'child_process';
import { fileURLToPath } from 'url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isPortOpen } from '../utils/port.js';
import {
  captureProcessIdentity,
  terminateOwnedProcessTree,
  type ProcessIdentity,
} from '../utils/process.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = path.join(repoRoot, 'dist', 'bin', 'proofshot.js');
const createdRoots: string[] = [];
const cleanupProcesses: ProcessIdentity[] = [];

function cacheRoot(): string {
  const cache = path.join(os.userInfo().homedir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  return cache;
}

function createAuditRoot(): { base: string; audit: string } {
  const base = fs.mkdtempSync(path.join(cacheRoot(), 'proofshot-lifecycle-test-'));
  const audit = path.join(
    base,
    `generated-audit-${'x'.repeat(64)}`,
    `consumer-evidence-${'y'.repeat(48)}`,
  );
  fs.mkdirSync(audit, { recursive: true });
  createdRoots.push(base);
  return { base, audit };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing free port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function processIsAlive(pid: number): boolean {
  return captureProcessIdentity(pid) !== null;
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`process ${pid} did not exit`);
}

async function waitForLatestDaemon(
  browserLog: string,
  timeoutMs = 5000,
): Promise<{ daemonPid: number; session: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(browserLog)) {
      const entries = fs
        .readFileSync(browserLog, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const daemon = [...entries].reverse().find((entry) => entry.command === 'daemon');
      if (daemon) {
        return daemon;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('agent-browser daemon was not recorded');
}

function writeFixtureTools(base: string): {
  binDir: string;
  browserPath: string;
  browserLog: string;
  serverScript: string;
} {
  const binDir = path.join(base, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const browserLog = path.join(base, 'agent-browser.jsonl');
  const fakeAgentBrowser = path.join(binDir, 'agent-browser');
  fs.writeFileSync(
    fakeAgentBrowser,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
let args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('agent-browser 0.34.0\\n');
  process.exit(0);
}
let session = 'default';
const sessionIndex = args.indexOf('--session');
if (sessionIndex >= 0) {
  session = args[sessionIndex + 1];
  args.splice(sessionIndex, 2);
}
const configIndex = args.indexOf('--config');
if (configIndex >= 0) args.splice(configIndex, 2);
const jsonIndex = args.indexOf('--json');
const jsonOutput = jsonIndex >= 0;
if (jsonIndex >= 0) args.splice(jsonIndex, 1);
const socketRoot = process.env.AGENT_BROWSER_SOCKET_DIR;
if (!socketRoot) {
  process.stderr.write('missing AGENT_BROWSER_SOCKET_DIR\\n');
  process.exit(2);
}
const namespace = (process.env.AGENT_BROWSER_NAMESPACE || '')
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '');
const socketDir = namespace
  ? path.join(socketRoot, 'namespaces', namespace, 'run')
  : socketRoot;
fs.mkdirSync(socketDir, { recursive: true });
const pidPath = path.join(socketDir, session + '.pid');
const statePath = path.join(socketDir, session + '.fake.json');
const command = args[0] || '';
const detail = args.slice(1);
fs.appendFileSync(process.env.FAKE_AGENT_BROWSER_LOG, JSON.stringify({
  pid: process.pid,
  session,
  namespace,
  allowedDomains: process.env.AGENT_BROWSER_ALLOWED_DOMAINS,
  socketDir,
  home: process.env.HOME,
  command,
  detail,
}) + '\\n');
if (Buffer.byteLength(path.join(socketDir, session + '.sock')) > 103) {
  process.stderr.write('socket path too long\\n');
  process.exit(3);
}
if (command === 'open') {
  const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();
  fs.writeFileSync(pidPath, String(daemon.pid));
  fs.writeFileSync(statePath, JSON.stringify({ url: detail[0] }));
  fs.appendFileSync(process.env.FAKE_AGENT_BROWSER_LOG, JSON.stringify({
    session,
    socketDir,
    command: 'daemon',
    daemonPid: daemon.pid,
  }) + '\\n');
  if (process.env.FAKE_AGENT_BROWSER_FAIL_OPEN === '1') {
    process.stderr.write('simulated browser open failure\\n');
    process.exit(9);
  }
  if (process.env.FAKE_AGENT_BROWSER_HANG_OPEN === '1') {
    spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
  } else {
    process.exit(0);
  }
}
if (command === 'get' && detail[0] === 'url') {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  process.stdout.write(
    jsonOutput
      ? JSON.stringify({ success: true, data: { url: state.url } }) + '\\n'
      : state.url + '\\n',
  );
  process.exit(0);
}
if (command === 'console' && detail.includes('--json')) {
  process.stdout.write(JSON.stringify({ success: true, data: { messages: [] } }) + '\\n');
  process.exit(0);
}
if (command === 'console') {
  process.stdout.write('No console output\\n');
  process.exit(0);
}
if (command === 'errors') {
  process.stdout.write('No errors\\n');
  process.exit(0);
}
if (command === 'network' && detail[0] === 'har' && detail[1] === 'start') {
  process.exit(0);
}
if (command === 'network' && detail[0] === 'har' && detail[1] === 'stop') {
  const harPath = detail[2];
  fs.writeFileSync(harPath, JSON.stringify({
    log: {
      entries: [
        {
          time: 12.5,
          request: {
            method: 'GET',
            url: 'https://example.invalid/api/items?token=secret-token',
            headers: [{ name: 'authorization', value: 'Bearer secret-token' }],
          },
          response: {
            status: 200,
            content: {
              mimeType: 'application/json',
              text: 'private-response-body',
            },
          },
        },
      ],
    },
  }, null, 2));
  if (jsonOutput) {
    process.stdout.write(JSON.stringify({
      success: true,
      data: { path: harPath, requestCount: 1 },
    }) + '\\n');
  }
  process.exit(0);
}
if (
  command === 'record' &&
  detail[0] === 'stop' &&
  process.env.FAKE_AGENT_BROWSER_DELAY_RECORD_STOP === '1'
) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  process.exit(0);
}
if (command === 'hang') {
  spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  process.exit(0);
}
if (command === 'fail') {
  process.stderr.write('simulated action failure\\n');
  process.exit(7);
}
if (command === 'close') {
  try {
    const pid = Number(fs.readFileSync(pidPath, 'utf8'));
    process.kill(-pid, 'SIGTERM');
  } catch {}
  try { fs.unlinkSync(pidPath); } catch {}
  try { fs.unlinkSync(statePath); } catch {}
  if (process.env.FAKE_AGENT_BROWSER_DELAY_CLOSE_AFTER_KILL === '1') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  process.exit(0);
}
if (jsonOutput) {
  process.stdout.write(JSON.stringify({ success: true, data: { command } }) + '\\n');
}
process.exit(0);
`,
  );
  fs.chmodSync(fakeAgentBrowser, 0o700);

  const browserPath = path.join(binDir, 'fake-chrome');
  fs.writeFileSync(browserPath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(browserPath, 0o700);

  const serverScript = path.join(base, 'server.mjs');
  fs.writeFileSync(
    serverScript,
    [
      "import fs from 'node:fs';",
      "import http from 'node:http';",
      'const port = Number(process.argv[2]);',
      'const pidFile = process.argv[3];',
      "fs.writeFileSync(pidFile, String(process.pid));",
      "const server = http.createServer((request, response) => response.end(request.url || '/'));",
      "server.listen(port, '127.0.0.1', () => console.log('server-ready'));",
    ].join('\n'),
  );
  return { binDir, browserPath, browserLog, serverScript };
}

function isolatedEnvironment(
  audit: string,
  tools: ReturnType<typeof writeFixtureTools>,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(audit, 'isolated-home'),
    XDG_CACHE_HOME: path.join(audit, 'isolated-cache'),
    XDG_STATE_HOME: path.join(audit, 'isolated-home', '.local', 'state'),
    PATH: `${tools.binDir}${path.delimiter}${process.env.PATH || ''}`,
    FAKE_AGENT_BROWSER_LOG: tools.browserLog,
    ...overrides,
  };
  delete env.AGENT_BROWSER_SOCKET_DIR;
  delete env.XDG_RUNTIME_DIR;
  return env;
}

function runCli(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[],
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf-8',
    timeout: 15000,
  });
}

function registryDirectory(env: NodeJS.ProcessEnv): string {
  return path.join(env.XDG_STATE_HOME!, 'proofshot', 'sessions');
}

function readRegisteredSessions(env: NodeJS.ProcessEnv): any[] {
  const directory = registryDirectory(env);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) =>
      JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8')),
    );
}

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' });
}, 30000);

afterEach(async () => {
  for (const identity of cleanupProcesses.splice(0)) {
    await terminateOwnedProcessTree(identity, { graceMs: 300 });
  }
  for (const root of createdRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('isolated CLI lifecycle', () => {
  it('refuses --force while another start owns the lifecycle operation', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const startEnv = isolatedEnvironment(audit, tools, {
      FAKE_AGENT_BROWSER_HANG_OPEN: '1',
    });
    const forceEnv = isolatedEnvironment(audit, tools);
    fs.mkdirSync(startEnv.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const start = spawn(
      process.execPath,
      [
        cliPath,
        'start',
        '--url',
        'https://example.invalid/starting',
        '--browser-executable',
        tools.browserPath,
      ],
      {
        cwd: audit,
        env: startEnv,
        detached: true,
        stdio: 'pipe',
      },
    );
    let startOutput = '';
    start.stdout?.on('data', (chunk) => {
      startOutput += chunk.toString();
    });
    start.stderr?.on('data', (chunk) => {
      startOutput += chunk.toString();
    });
    const daemon = await waitForLatestDaemon(tools.browserLog);
    const daemonIdentity = captureProcessIdentity(daemon.daemonPid);
    if (daemonIdentity) {
      cleanupProcesses.push(daemonIdentity);
    }
    const [startingSession] = readRegisteredSessions(startEnv);
    expect(startingSession.operationLease).toMatchObject({ kind: 'start' });

    const forcedStart = runCli(audit, forceEnv, [
      'start',
      '--force',
      '--url',
      'https://example.invalid/replacement',
      '--browser-executable',
      tools.browserPath,
    ]);

    expect(forcedStart.status, `${forcedStart.stdout}\n${forcedStart.stderr}`).toBe(1);
    expect(forcedStart.stderr).toContain(
      '--force cannot take over a live ProofShot operation',
    );
    const openCalls = fs
      .readFileSync(tools.browserLog, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((call) => call.command === 'open');
    expect(openCalls).toHaveLength(1);

    process.kill(-start.pid!, 'SIGTERM');
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('interrupted start did not finish')),
        10000,
      );
      start.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode, startOutput).toBe(143);
    await waitForProcessExit(daemon.daemonPid);
    expect(readRegisteredSessions(startEnv)).toEqual([]);
    expect(fs.readdirSync(registryDirectory(startEnv))).toEqual([]);
    if (daemonIdentity) {
      cleanupProcesses.splice(cleanupProcesses.indexOf(daemonIdentity), 1);
    }
  }, 30000);

  it('refuses --force while exact live ownership is verified', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const start = runCli(audit, env, [
      'start',
      '--url',
      'https://example.invalid/live',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    const [session] = readRegisteredSessions(env);
    cleanupProcesses.push(session.browserProcess);
    const registryPath = path.join(
      registryDirectory(env),
      `${session.sessionName}.json`,
    );
    const registryBefore = fs.readFileSync(registryPath, 'utf-8');
    const browserLogBefore = fs.readFileSync(tools.browserLog, 'utf-8');

    const forcedStart = runCli(audit, env, [
      'start',
      '--force',
      '--url',
      'https://example.invalid/replacement',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(forcedStart.status).toBe(1);
    expect(forcedStart.stderr).toContain(
      '--force cannot clean a verified live ProofShot session',
    );
    expect(fs.readFileSync(registryPath, 'utf-8')).toBe(registryBefore);
    expect(fs.readFileSync(tools.browserLog, 'utf-8')).toBe(browserLogBefore);
    expect(processIsAlive(session.browserProcess.pid)).toBe(true);

    const stop = runCli(audit, env, ['stop']);
    expect(stop.status, `${stop.stdout}\n${stop.stderr}`).toBe(0);
    await waitForProcessExit(session.browserProcess.pid);
    cleanupProcesses.splice(cleanupProcesses.indexOf(session.browserProcess), 1);
  }, 30000);

  it('refuses --force while stop finalizes after exact browser cleanup', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const start = runCli(audit, env, [
      'start',
      '--url',
      'https://example.invalid/stopping',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    const [session] = readRegisteredSessions(env);
    cleanupProcesses.push(session.browserProcess);

    const stop = spawn(process.execPath, [cliPath, 'stop'], {
      cwd: audit,
      env: {
        ...env,
        FAKE_AGENT_BROWSER_DELAY_CLOSE_AFTER_KILL: '1',
      },
      stdio: 'pipe',
    });
    let stopOutput = '';
    stop.stdout?.on('data', (chunk) => {
      stopOutput += chunk.toString();
    });
    stop.stderr?.on('data', (chunk) => {
      stopOutput += chunk.toString();
    });
    await waitForProcessExit(session.browserProcess.pid);
    const [stoppingSession] = readRegisteredSessions(env);
    expect(stoppingSession.operationLease).toMatchObject({ kind: 'stop' });
    expect(stoppingSession.lifecycleStatus).toBe('stopping');

    const forcedStart = runCli(audit, env, [
      'start',
      '--force',
      '--url',
      'https://example.invalid/replacement',
      '--browser-executable',
      tools.browserPath,
    ]);

    expect(forcedStart.status, `${forcedStart.stdout}\n${forcedStart.stderr}`).toBe(1);
    expect(forcedStart.stderr).toContain(
      '--force cannot take over a live ProofShot operation',
    );
    const stopExitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('delayed stop did not finish')),
        10000,
      );
      stop.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(stopExitCode, stopOutput).toBe(0);
    cleanupProcesses.splice(cleanupProcesses.indexOf(session.browserProcess), 1);
    expect(readRegisteredSessions(env)).toEqual([]);
    expect(fs.readdirSync(registryDirectory(env))).toEqual([]);
  }, 30000);

  it('allows --force to replace only proven stale ownership', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const start = runCli(audit, env, [
      'start',
      '--url',
      'https://example.invalid/stale',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    const [staleSession] = readRegisteredSessions(env);
    await terminateOwnedProcessTree(staleSession.browserProcess, { graceMs: 300 });
    await waitForProcessExit(staleSession.browserProcess.pid);

    const replacement = runCli(audit, env, [
      'start',
      '--force',
      '--url',
      'https://example.invalid/replacement',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(replacement.status, `${replacement.stdout}\n${replacement.stderr}`).toBe(0);
    expect(replacement.stdout).toContain('Cleaned up stale session state');
    const [replacementSession] = readRegisteredSessions(env);
    expect(replacementSession.sessionName).not.toBe(staleSession.sessionName);
    expect(replacementSession.targetUrl).toBe(
      'https://example.invalid/replacement',
    );
    cleanupProcesses.push(replacementSession.browserProcess);

    const stop = runCli(audit, env, ['stop']);
    expect(stop.status, `${stop.stdout}\n${stop.stderr}`).toBe(0);
    await waitForProcessExit(replacementSession.browserProcess.pid);
    cleanupProcesses.splice(
      cleanupProcesses.indexOf(replacementSession.browserProcess),
      1,
    );
  }, 30000);

  it('isolates two sessions and requires an exact target only while ambiguous', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const firstStart = runCli(audit, env, [
      'start',
      '--url',
      'https://example.invalid/first',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(firstStart.status, `${firstStart.stdout}\n${firstStart.stderr}`).toBe(0);

    const secondStart = runCli(audit, env, [
      'start',
      '--url',
      'https://example.invalid/second',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(secondStart.status, `${secondStart.stdout}\n${secondStart.stderr}`).toBe(0);

    const registryDir = registryDirectory(env);
    const sessions = readRegisteredSessions(env)
      .sort((left, right) => left.targetUrl.localeCompare(right.targetUrl));
    expect(sessions).toHaveLength(2);
    cleanupProcesses.push(...sessions.map((session) => session.browserProcess));
    expect(sessions[0].sessionDir).not.toBe(sessions[1].sessionDir);
    expect(sessions[0].sessionName).not.toBe(sessions[1].sessionName);
    expect(sessions[0].agentBrowserNamespace).toEqual(expect.any(String));
    expect(sessions[0].agentBrowserNamespace).not.toBe(
      sessions[1].agentBrowserNamespace,
    );
    expect(sessions[0].agentBrowserAllowedDomains).toEqual(['example.invalid']);
    expect(sessions[1].agentBrowserAllowedDomains).toEqual(['example.invalid']);
    expect(sessions[0].agentBrowserExecutablePath).toBe(
      tools.binDir + path.sep + 'agent-browser',
    );
    expect(sessions[1].agentBrowserExecutablePath).toBe(
      tools.binDir + path.sep + 'agent-browser',
    );
    const decoyBinDir = path.join(base, 'decoy-bin');
    const decoyLog = path.join(base, 'decoy-agent-browser.log');
    fs.mkdirSync(decoyBinDir, { recursive: true });
    const decoyAgentBrowser = path.join(decoyBinDir, 'agent-browser');
    fs.writeFileSync(
      decoyAgentBrowser,
      `#!/bin/sh\nprintf 'invoked\\n' >> ${shellQuote(decoyLog)}\nexit 88\n`,
    );
    fs.chmodSync(decoyAgentBrowser, 0o755);
    const postStartEnv = {
      ...env,
      PATH: `${decoyBinDir}${path.delimiter}${env.PATH}`,
    };
    const openCalls = fs
      .readFileSync(tools.browserLog, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((call) => call.command === 'open');
    expect(openCalls).toHaveLength(2);
    expect(openCalls.every((call) => call.allowedDomains === 'example.invalid')).toBe(
      true,
    );
    const inventory = runCli(audit, env, ['session', 'list', '--json']);
    expect(inventory.status, `${inventory.stdout}\n${inventory.stderr}`).toBe(0);
    expect(
      JSON.parse(inventory.stdout).sessions.map((entry: { id: string }) => entry.id),
    ).toEqual(expect.arrayContaining(sessions.map((session) => session.sessionName)));

    const ambiguousExec = runCli(audit, env, ['exec', 'get', 'url']);
    expect(ambiguousExec.status).toBe(1);
    expect(ambiguousExec.stderr).toContain('Multiple active ProofShot sessions');

    for (const session of sessions) {
      const explicitExec = runCli(audit, postStartEnv, [
        'exec',
        '--session',
        session.sessionName,
        'get',
        'url',
      ]);
      expect(explicitExec.status, `${explicitExec.stdout}\n${explicitExec.stderr}`).toBe(0);
      expect(explicitExec.stdout).toContain(session.targetUrl);
    }

    const secret = 'proofshot-secret-value';
    const secretExec = runCli(audit, postStartEnv, [
      'exec',
      '--session',
      sessions[0].sessionName,
      'fill',
      '@e1',
      secret,
    ]);
    expect(secretExec.status, `${secretExec.stdout}\n${secretExec.stderr}`).toBe(0);
    const actionLogPath = path.join(sessions[0].sessionDir, 'session-log.json');
    const actionLogText = fs.readFileSync(actionLogPath, 'utf-8');
    const actionEntries = JSON.parse(actionLogText);
    const secretEntry = actionEntries.at(-1);
    expect(actionLogText).not.toContain(secret);
    expect(secretEntry).toMatchObject({
      action: 'fill @e1 [REDACTED]',
      category: 'hybrid',
      intent: {
        command: 'fill',
        summary: 'fill @e1 [REDACTED]',
      },
      outcome: 'passed',
      durationMs: expect.any(Number),
      agentBrowserResult: {
        success: true,
        evidencePath: expect.stringMatching(/^private\/agent-browser\/actions\//),
      },
    });
    const privateResultPath = path.join(
      sessions[0].sessionDir,
      secretEntry.agentBrowserResult.evidencePath,
    );
    expect(fs.statSync(privateResultPath).mode & 0o777).toBe(0o600);

    const failedExec = runCli(audit, postStartEnv, [
      'exec',
      '--session',
      sessions[0].sessionName,
      'fail',
    ]);
    expect(failedExec.status).toBe(7);
    const failedEntry = JSON.parse(fs.readFileSync(actionLogPath, 'utf-8')).at(-1);
    expect(failedEntry).toMatchObject({
      action: 'fail',
      outcome: 'failed',
      pageUrl: sessions[0].targetUrl,
    });

    const ambiguousStop = runCli(audit, env, ['stop']);
    expect(ambiguousStop.status).toBe(1);
    expect(ambiguousStop.stderr).toContain('Multiple active ProofShot sessions');

    const explicitStop = runCli(audit, postStartEnv, [
      'stop',
      '--session',
      sessions[0].sessionName,
    ]);
    expect(explicitStop.status, `${explicitStop.stdout}\n${explicitStop.stderr}`).toBe(0);
    await waitForProcessExit(sessions[0].browserProcess.pid);
    cleanupProcesses.splice(cleanupProcesses.indexOf(sessions[0].browserProcess), 1);

    const implicitStop = runCli(audit, postStartEnv, ['stop']);
    expect(implicitStop.status, `${implicitStop.stdout}\n${implicitStop.stderr}`).toBe(0);
    await waitForProcessExit(sessions[1].browserProcess.pid);
    cleanupProcesses.splice(cleanupProcesses.indexOf(sessions[1].browserProcess), 1);
    expect(fs.readdirSync(registryDir)).toEqual([]);
    expect(fs.existsSync(decoyLog)).toBe(false);
    const browserLogAfterStops = fs.readFileSync(tools.browserLog, 'utf-8');
    const execWithoutSession = runCli(audit, env, ['exec', 'get', 'url']);
    expect(execWithoutSession.status).toBe(1);
    expect(execWithoutSession.stderr).toContain(
      'No active ProofShot session matches this worktree',
    );
    expect(fs.readFileSync(tools.browserLog, 'utf-8')).toBe(browserLogAfterStops);

    for (const session of sessions) {
      const privateEvidenceDir = path.join(
        session.sessionDir,
        'private',
        'agent-browser',
      );
      const harPath = path.join(privateEvidenceDir, 'network.har');
      const requestsPath = path.join(privateEvidenceDir, 'requests.json');
      const summaryPath = path.join(session.sessionDir, 'network-summary.json');
      expect(fs.statSync(privateEvidenceDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(harPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(requestsPath).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(harPath, 'utf-8')).toContain(
        'private-response-body',
      );
      const summaryText = fs.readFileSync(summaryPath, 'utf-8');
      expect(summaryText).not.toContain('private-response-body');
      expect(summaryText).not.toContain('secret-token');
      expect(JSON.parse(summaryText)).toEqual({
        version: 1,
        requestCount: 1,
        requests: [
          {
            endpoint: 'https://example.invalid/api/items',
            method: 'GET',
            status: 200,
            durationMs: 12.5,
            error: null,
          },
        ],
      });
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(session.sessionDir, 'artifact-manifest.json'),
          'utf-8',
        ),
      );
      expect(manifest.artifacts).toContainEqual(
        expect.objectContaining({
          kind: 'network-summary',
          path: 'network-summary.json',
        }),
      );
      expect(
        manifest.artifacts.some((artifact: { path: string }) =>
          artifact.path.startsWith('private/'),
        ),
      ).toBe(false);
    }
  }, 30000);

  it('automatically selects the one live session when a stale record remains', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    for (const target of ['stale', 'live']) {
      const start = runCli(audit, env, [
        'start',
        '--url',
        `https://example.invalid/${target}`,
        '--browser-executable',
        tools.browserPath,
      ]);
      expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    }
    const sessions = readRegisteredSessions(env);
    const staleSession = sessions.find((session) =>
      session.targetUrl.endsWith('/stale'),
    );
    const liveSession = sessions.find((session) =>
      session.targetUrl.endsWith('/live'),
    );
    expect(staleSession).toBeDefined();
    expect(liveSession).toBeDefined();
    cleanupProcesses.push(staleSession.browserProcess, liveSession.browserProcess);
    await terminateOwnedProcessTree(staleSession.browserProcess, { graceMs: 300 });
    await waitForProcessExit(staleSession.browserProcess.pid);
    cleanupProcesses.splice(
      cleanupProcesses.indexOf(staleSession.browserProcess),
      1,
    );

    const implicitExec = runCli(audit, env, ['exec', 'get', 'url']);
    expect(implicitExec.status, `${implicitExec.stdout}\n${implicitExec.stderr}`).toBe(0);
    expect(implicitExec.stdout.trim()).toBe(liveSession.targetUrl);

    const staleCleanup = runCli(audit, env, [
      'session',
      'clean',
      '--session',
      staleSession.sessionName,
    ]);
    expect(
      staleCleanup.status,
      `${staleCleanup.stdout}\n${staleCleanup.stderr}`,
    ).toBe(0);
    const finalStop = runCli(audit, env, ['stop']);
    expect(finalStop.status, `${finalStop.stdout}\n${finalStop.stderr}`).toBe(0);
    await waitForProcessExit(liveSession.browserProcess.pid);
    cleanupProcesses.splice(cleanupProcesses.indexOf(liveSession.browserProcess), 1);
    expect(readRegisteredSessions(env)).toEqual([]);
  }, 30000);

  it('keeps both owned browsers isolated when one exec process is interrupted', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    for (const target of ['first', 'second']) {
      const start = runCli(audit, env, [
        'start',
        '--url',
        `https://example.invalid/${target}`,
        '--browser-executable',
        tools.browserPath,
      ]);
      expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    }
    const sessions = readRegisteredSessions(env).sort((left, right) =>
      left.targetUrl.localeCompare(right.targetUrl),
    );
    cleanupProcesses.push(...sessions.map((session) => session.browserProcess));

    const interruptedExec = spawn(
      process.execPath,
      [
        cliPath,
        'exec',
        '--session',
        sessions[0].sessionName,
        'hang',
      ],
      {
        cwd: audit,
        env,
        detached: true,
        stdio: 'ignore',
      },
    );
    const interruptedIdentity = captureProcessIdentity(interruptedExec.pid!);
    if (interruptedIdentity) {
      cleanupProcesses.push(interruptedIdentity);
    }
    const interruptedLogPath = path.join(
      sessions[0].sessionDir,
      'session-log.json',
    );
    for (
      let attempt = 0;
      attempt < 80 && !fs.existsSync(interruptedLogPath);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(fs.existsSync(interruptedLogPath)).toBe(true);

    process.kill(-interruptedExec.pid!, 'SIGTERM');
    await new Promise<void>((resolve) => interruptedExec.once('close', () => resolve()));
    if (interruptedIdentity) {
      cleanupProcesses.splice(cleanupProcesses.indexOf(interruptedIdentity), 1);
    }
    expect(processIsAlive(sessions[0].browserProcess.pid)).toBe(true);
    expect(processIsAlive(sessions[1].browserProcess.pid)).toBe(true);
    const pendingActions = JSON.parse(
      fs.readFileSync(interruptedLogPath, 'utf-8'),
    );
    expect(pendingActions.at(-1).action).toBe('hang');
    expect('outcome' in pendingActions.at(-1)).toBe(false);

    const unaffectedExec = runCli(audit, env, [
      'exec',
      '--session',
      sessions[1].sessionName,
      'get',
      'url',
    ]);
    expect(unaffectedExec.status, `${unaffectedExec.stdout}\n${unaffectedExec.stderr}`).toBe(0);
    expect(unaffectedExec.stdout.trim()).toBe(sessions[1].targetUrl);

    for (const session of sessions) {
      const stop = runCli(audit, env, [
        'stop',
        '--session',
        session.sessionName,
      ]);
      expect(stop.status, `${stop.stdout}\n${stop.stderr}`).toBe(0);
      await waitForProcessExit(session.browserProcess.pid);
      cleanupProcesses.splice(cleanupProcesses.indexOf(session.browserProcess), 1);
    }
    const interruptedVerdict = JSON.parse(
      fs.readFileSync(
        path.join(sessions[0].sessionDir, 'verdict.json'),
        'utf-8',
      ),
    );
    expect(interruptedVerdict).toMatchObject({ status: 'INCOMPLETE' });
    expect(interruptedVerdict.reasons).toContain(
      '1 browser action(s) had no recorded outcome.',
    );
  }, 30000);

  it('finishes exact recording teardown after stop is interrupted', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    for (const target of ['first-stop', 'second-stop']) {
      const start = runCli(audit, env, [
        'start',
        '--url',
        `https://example.invalid/${target}`,
        '--browser-executable',
        tools.browserPath,
      ]);
      expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    }
    const sessions = readRegisteredSessions(env).sort((left, right) =>
      left.targetUrl.localeCompare(right.targetUrl),
    );
    cleanupProcesses.push(...sessions.map((session) => session.browserProcess));

    const interruptedStop = spawn(
      process.execPath,
      [
        cliPath,
        'stop',
        '--session',
        sessions[0].sessionName,
      ],
      {
        cwd: audit,
        env: {
          ...env,
          FAKE_AGENT_BROWSER_DELAY_RECORD_STOP: '1',
        },
        detached: true,
        stdio: 'pipe',
      },
    );
    let stopOutput = '';
    interruptedStop.stdout?.on('data', (chunk) => {
      stopOutput += chunk.toString();
    });
    interruptedStop.stderr?.on('data', (chunk) => {
      stopOutput += chunk.toString();
    });
    let recordingStopStarted = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const calls = fs
        .readFileSync(tools.browserLog, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      if (
        calls.some(
          (call) =>
            call.session === sessions[0].sessionName &&
            call.command === 'record' &&
            call.detail[0] === 'stop',
        )
      ) {
        recordingStopStarted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(recordingStopStarted).toBe(true);
    process.kill(interruptedStop.pid!, 'SIGTERM');
    const stopExitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('interrupted stop did not finish')),
        10000,
      );
      interruptedStop.once('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    expect(stopExitCode, stopOutput).toBe(143);
    await waitForProcessExit(sessions[0].browserProcess.pid);
    cleanupProcesses.splice(cleanupProcesses.indexOf(sessions[0].browserProcess), 1);
    expect(processIsAlive(sessions[1].browserProcess.pid)).toBe(true);
    expect(
      readRegisteredSessions(env).map((session) => session.sessionName),
    ).toEqual([sessions[1].sessionName]);

    const unaffectedExec = runCli(audit, env, [
      'exec',
      '--session',
      sessions[1].sessionName,
      'get',
      'url',
    ]);
    expect(unaffectedExec.status, `${unaffectedExec.stdout}\n${unaffectedExec.stderr}`).toBe(0);
    const finalStop = runCli(audit, env, ['stop']);
    expect(finalStop.status, `${finalStop.stdout}\n${finalStop.stderr}`).toBe(0);
    await waitForProcessExit(sessions[1].browserProcess.pid);
    cleanupProcesses.splice(cleanupProcesses.indexOf(sessions[1].browserProcess), 1);
  }, 30000);

  it('shares custom-output control across processes and stops idempotently', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    unrelated.unref();
    const unrelatedIdentity = captureProcessIdentity(unrelated.pid!);
    if (!unrelatedIdentity) throw new Error('failed to capture unrelated process');
    cleanupProcesses.push(unrelatedIdentity);

    const port = await freePort();
    const serverPidFile = path.join(base, 'owned-server.pid');
    const customOutput = path.join(audit, 'custom-evidence');
    const intendedUrl = `http://127.0.0.1:${port}/intended-target`;
    const serverCommand = [
      shellQuote(process.execPath),
      shellQuote(tools.serverScript),
      String(port),
      shellQuote(serverPidFile),
    ].join(' ');

    const start = runCli(audit, env, [
      'start',
      '--run',
      serverCommand,
      '--port',
      String(port),
      '--output',
      customOutput,
      '--url',
      intendedUrl,
      '--browser-executable',
      tools.browserPath,
      '--description',
      'isolated lifecycle integration',
    ]);
    expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    expect(start.stdout).toContain(`Target:     ${intendedUrl}`);

    const controlPath = path.join(audit, 'proofshot-artifacts', '.session.json');
    expect(fs.existsSync(controlPath)).toBe(false);
    expect(fs.existsSync(path.join(customOutput, '.session.json'))).toBe(false);
    const [state] = readRegisteredSessions(env);
    expect(state).toMatchObject({
      outputDir: customOutput,
      targetUrl: intendedUrl,
      recordingActive: true,
    });
    expect(Buffer.byteLength(path.join(state.agentBrowserSocketDir, `${state.sessionName}.sock`))).toBeLessThanOrEqual(103);
    expect(state.agentBrowserSocketDir).not.toContain(env.HOME);
    expect(state.serverProcess).toMatchObject({ pid: expect.any(Number), startTime: expect.any(String) });
    expect(state.browserProcess).toMatchObject({ pid: expect.any(Number), startTime: expect.any(String) });
    cleanupProcesses.push(state.serverProcess, state.browserProcess);

    const ownedServerPid = Number(fs.readFileSync(serverPidFile, 'utf-8'));
    expect(processIsAlive(ownedServerPid)).toBe(true);
    expect(processIsAlive(unrelated.pid!)).toBe(true);

    const nestedCwd = path.join(audit, 'nested', 'consumer');
    fs.mkdirSync(nestedCwd, { recursive: true });
    const execResult = runCli(nestedCwd, env, ['exec', 'get', 'url']);
    expect(execResult.status, `${execResult.stdout}\n${execResult.stderr}`).toBe(0);
    expect(execResult.stdout.trim()).toBe(intendedUrl);
    expect(execResult.stdout).not.toContain('about:blank');
    const browserCalls = fs
      .readFileSync(tools.browserLog, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(browserCalls.at(-1)).toMatchObject({
      session: state.sessionName,
      socketDir: state.agentBrowserSocketDir,
      command: 'get',
      detail: ['url'],
    });

    const browserLogBeforeMismatchedExec = fs.readFileSync(tools.browserLog, 'utf-8');
    const mismatchedState = {
      ...state,
      browserProcess: {
        ...state.browserProcess,
        startTime: `${state.browserProcess.startTime}-recycled`,
      },
    };
    const registryPath = path.join(
      registryDirectory(env),
      `${state.sessionName}.json`,
    );
    fs.writeFileSync(registryPath, JSON.stringify(mismatchedState, null, 2) + '\n');
    const mismatchedExec = runCli(nestedCwd, env, ['exec', 'get', 'url']);
    expect(mismatchedExec.status).toBe(1);
    expect(mismatchedExec.stderr).toContain(
      'No active ProofShot session matches this worktree',
    );
    expect(fs.readFileSync(tools.browserLog, 'utf-8')).toBe(
      browserLogBeforeMismatchedExec,
    );
    fs.writeFileSync(registryPath, JSON.stringify(state, null, 2) + '\n');

    const stop = runCli(nestedCwd, env, ['stop']);
    expect(stop.status, `${stop.stdout}\n${stop.stderr}`).toBe(0);
    expect(fs.existsSync(controlPath)).toBe(false);
    expect(fs.existsSync(registryPath)).toBe(false);
    await waitForProcessExit(ownedServerPid);
    await waitForProcessExit(state.serverProcess.pid);
    await waitForProcessExit(state.browserProcess.pid);
    expect(processIsAlive(unrelated.pid!)).toBe(true);
    cleanupProcesses.splice(cleanupProcesses.indexOf(state.serverProcess), 1);
    cleanupProcesses.splice(cleanupProcesses.indexOf(state.browserProcess), 1);

    const summaryPath = path.join(state.sessionDir, 'SUMMARY.md');
    const summaryBefore = fs.readFileSync(summaryPath, 'utf-8');
    const summaryMtimeBefore = fs.statSync(summaryPath).mtimeMs;
    const browserLogBefore = fs.readFileSync(tools.browserLog, 'utf-8');

    const secondStop = runCli(nestedCwd, env, ['stop']);
    expect(secondStop.status, `${secondStop.stdout}\n${secondStop.stderr}`).toBe(0);
    expect(secondStop.stdout).toContain('already stopped');
    expect(fs.readFileSync(summaryPath, 'utf-8')).toBe(summaryBefore);
    expect(fs.statSync(summaryPath).mtimeMs).toBe(summaryMtimeBefore);
    expect(fs.readFileSync(tools.browserLog, 'utf-8')).toBe(browserLogBefore);
  }, 30000);

  it('preserves unrelated listeners and cleans partial browser/server starts', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const occupiedPort = await freePort();
    const unrelatedPidFile = path.join(base, 'unrelated-listener.pid');
    const unrelated = spawn(
      process.execPath,
      [tools.serverScript, String(occupiedPort), unrelatedPidFile],
      { detached: true, stdio: 'ignore' },
    );
    unrelated.unref();
    const unrelatedIdentity = captureProcessIdentity(unrelated.pid!);
    if (!unrelatedIdentity) throw new Error('failed to capture unrelated listener');
    cleanupProcesses.push(unrelatedIdentity);
    for (let attempt = 0; attempt < 80 && !fs.existsSync(unrelatedPidFile); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (let attempt = 0; attempt < 80 && !(await isPortOpen(occupiedPort)); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await isPortOpen(occupiedPort)).toBe(true);

    const occupiedStart = runCli(audit, env, [
      'start',
      '--run',
      `${shellQuote(process.execPath)} -e ${shellQuote('setInterval(() => {}, 1000)')}`,
      '--port',
      String(occupiedPort),
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(occupiedStart.status).toBe(1);
    expect(occupiedStart.stderr).toContain('already in use by a process ProofShot did not start');
    expect(processIsAlive(unrelated.pid!)).toBe(true);
    expect(fs.existsSync(path.join(audit, 'proofshot-artifacts', '.session.json'))).toBe(false);
    const stopAfterOccupiedFailure = runCli(audit, env, ['stop']);
    expect(stopAfterOccupiedFailure.status).toBe(0);
    expect(stopAfterOccupiedFailure.stdout).toContain('already stopped');
    expect(processIsAlive(unrelated.pid!)).toBe(true);

    const failedPort = await freePort();
    const failedServerPidFile = path.join(base, 'failed-server.pid');
    const failedServerCommand = [
      shellQuote(process.execPath),
      shellQuote(tools.serverScript),
      String(failedPort),
      shellQuote(failedServerPidFile),
    ].join(' ');
    const failedStart = runCli(
      audit,
      isolatedEnvironment(audit, tools, { FAKE_AGENT_BROWSER_FAIL_OPEN: '1' }),
      [
        'start',
        '--run',
        failedServerCommand,
        '--port',
        String(failedPort),
        '--browser-executable',
        tools.browserPath,
      ],
    );
    expect(failedStart.status).toBe(1);
    expect(failedStart.stderr).toContain('simulated browser open failure');
    const failedServerPid = Number(fs.readFileSync(failedServerPidFile, 'utf-8'));
    await waitForProcessExit(failedServerPid);
    expect(processIsAlive(unrelated.pid!)).toBe(true);
    expect(fs.existsSync(path.join(audit, 'proofshot-artifacts', '.session.json'))).toBe(false);

    const calls = fs
      .readFileSync(tools.browserLog, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const failedOpen = [...calls].reverse().find((call) => call.command === 'open');
    const failedDaemon = [...calls]
      .reverse()
      .find((call) => call.command === 'daemon' && call.session === failedOpen.session);
    const failedSessionCalls = calls.filter((call) => call.session === failedOpen.session);
    expect(failedSessionCalls.map((call) => call.command)).toEqual(
      expect.arrayContaining(['open', 'record', 'close']),
    );
    await waitForProcessExit(failedDaemon.daemonPid);
    const failedBrowserPidPath = path.join(
      failedOpen.socketDir,
      `${failedOpen.session}.pid`,
    );
    expect(fs.existsSync(failedBrowserPidPath)).toBe(false);
  }, 30000);

  it('retains exact browser ownership across stop --no-close', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const start = runCli(audit, env, [
      'start',
      '--url',
      'https://example.invalid/retained-browser',
      '--browser-executable',
      tools.browserPath,
    ]);
    expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    const [initialState] = readRegisteredSessions(env);
    const registryPath = path.join(
      registryDirectory(env),
      `${initialState.sessionName}.json`,
    );
    cleanupProcesses.push(initialState.browserProcess);

    const retainedStop = runCli(audit, env, ['stop', '--no-close']);
    expect(retainedStop.status, `${retainedStop.stdout}\n${retainedStop.stderr}`).toBe(0);
    const retainedState = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    expect(retainedState).toMatchObject({
      recordingActive: false,
      bundleComplete: true,
      browserRetained: true,
      browserProcess: initialState.browserProcess,
    });
    expect(processIsAlive(initialState.browserProcess.pid)).toBe(true);
    const summaryPath = path.join(initialState.sessionDir, 'SUMMARY.md');
    const summaryBefore = fs.readFileSync(summaryPath, 'utf-8');
    const summaryMtimeBefore = fs.statSync(summaryPath).mtimeMs;

    const finalStop = runCli(audit, env, ['stop']);
    expect(finalStop.status, `${finalStop.stdout}\n${finalStop.stderr}`).toBe(0);
    expect(finalStop.stdout).toContain('Retained browser closed');
    await waitForProcessExit(initialState.browserProcess.pid);
    expect(fs.existsSync(registryPath)).toBe(false);
    expect(fs.readFileSync(summaryPath, 'utf-8')).toBe(summaryBefore);
    expect(fs.statSync(summaryPath).mtimeMs).toBe(summaryMtimeBefore);
    cleanupProcesses.splice(cleanupProcesses.indexOf(initialState.browserProcess), 1);
  }, 30000);

  it('does not accumulate owned daemons across ten start-stop cycles', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools);
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    unrelated.unref();
    const unrelatedIdentity = captureProcessIdentity(unrelated.pid!);
    if (!unrelatedIdentity) {
      throw new Error('failed to capture unrelated process');
    }
    cleanupProcesses.push(unrelatedIdentity);

    for (let cycle = 0; cycle < 10; cycle += 1) {
      const start = runCli(audit, env, [
        'start',
        '--url',
        `https://example.invalid/cycle-${cycle}`,
        '--browser-executable',
        tools.browserPath,
      ]);
      expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
      const [state] = readRegisteredSessions(env);

      const stop = runCli(audit, env, ['stop']);
      expect(stop.status, `${stop.stdout}\n${stop.stderr}`).toBe(0);
      await waitForProcessExit(state.browserProcess.pid);
      expect(readRegisteredSessions(env)).toEqual([]);
      expect(processIsAlive(unrelated.pid!)).toBe(true);
    }

    const registryDir = registryDirectory(env);
    expect(fs.existsSync(registryDir) ? fs.readdirSync(registryDir) : []).toEqual([]);
  }, 60000);

  it('cleans exact ownership when startup is interrupted', async () => {
    const { base, audit } = createAuditRoot();
    const tools = writeFixtureTools(base);
    const env = isolatedEnvironment(audit, tools, {
      FAKE_AGENT_BROWSER_HANG_OPEN: '1',
    });
    fs.mkdirSync(env.HOME!, { recursive: true });
    fs.writeFileSync(
      path.join(audit, 'proofshot.config.json'),
      JSON.stringify({ output: './proofshot-artifacts' }),
    );

    const start = spawn(
      process.execPath,
      [
        cliPath,
        'start',
        '--url',
        'https://example.invalid/interrupted',
        '--browser-executable',
        tools.browserPath,
      ],
      {
        cwd: audit,
        env,
        detached: true,
        stdio: 'pipe',
      },
    );
    let startOutput = '';
    start.stdout?.on('data', (chunk) => {
      startOutput += chunk.toString();
    });
    start.stderr?.on('data', (chunk) => {
      startOutput += chunk.toString();
    });
    const daemon = await waitForLatestDaemon(tools.browserLog);
    const daemonIdentity = captureProcessIdentity(daemon.daemonPid);
    if (daemonIdentity) {
      cleanupProcesses.push(daemonIdentity);
    }

    process.kill(-start.pid!, 'SIGTERM');
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('interrupted start did not exit')), 10000);
      start.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode, startOutput).toBe(143);
    await waitForProcessExit(daemon.daemonPid);
    const controlPath = path.join(audit, 'proofshot-artifacts', '.session.json');
    expect(fs.existsSync(controlPath)).toBe(false);
    const registryDir = registryDirectory(env);
    expect(fs.existsSync(registryDir) ? fs.readdirSync(registryDir) : []).toEqual([]);
    if (daemonIdentity) {
      cleanupProcesses.splice(cleanupProcesses.indexOf(daemonIdentity), 1);
    }
  }, 30000);
});
