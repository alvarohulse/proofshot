import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, spawnSync } from 'child_process';
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
const { spawn } = require('child_process');
let args = process.argv.slice(2);
let session = 'default';
const sessionIndex = args.indexOf('--session');
if (sessionIndex >= 0) {
  session = args[sessionIndex + 1];
  args.splice(sessionIndex, 2);
}
const configIndex = args.indexOf('--config');
if (configIndex >= 0) args.splice(configIndex, 2);
const socketDir = process.env.AGENT_BROWSER_SOCKET_DIR;
if (!socketDir) {
  process.stderr.write('missing AGENT_BROWSER_SOCKET_DIR\\n');
  process.exit(2);
}
fs.mkdirSync(socketDir, { recursive: true });
const pidPath = path.join(socketDir, session + '.pid');
const statePath = path.join(socketDir, session + '.fake.json');
const command = args[0] || '';
const detail = args.slice(1);
fs.appendFileSync(process.env.FAKE_AGENT_BROWSER_LOG, JSON.stringify({
  pid: process.pid,
  session,
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
  process.exit(0);
}
if (command === 'get' && detail[0] === 'url') {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  process.stdout.write(state.url + '\\n');
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
if (command === 'close') {
  try {
    const pid = Number(fs.readFileSync(pidPath, 'utf8'));
    process.kill(-pid, 'SIGTERM');
  } catch {}
  try { fs.unlinkSync(pidPath); } catch {}
  try { fs.unlinkSync(statePath); } catch {}
  process.exit(0);
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
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf-8',
    timeout: 15000,
  });
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
    expect(fs.existsSync(controlPath)).toBe(true);
    expect(fs.existsSync(path.join(customOutput, '.session.json'))).toBe(false);
    const state = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
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

    const execResult = runCli(audit, env, ['exec', 'get', 'url']);
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
    fs.writeFileSync(controlPath, JSON.stringify(mismatchedState, null, 2) + '\n');
    const mismatchedExec = runCli(audit, env, ['exec', 'get', 'url']);
    expect(mismatchedExec.status).toBe(1);
    expect(mismatchedExec.stderr).toContain(
      'Browser ownership no longer matches this ProofShot session',
    );
    expect(fs.readFileSync(tools.browserLog, 'utf-8')).toBe(
      browserLogBeforeMismatchedExec,
    );
    fs.writeFileSync(controlPath, JSON.stringify(state, null, 2) + '\n');

    const stop = runCli(audit, env, ['stop']);
    expect(stop.status, `${stop.stdout}\n${stop.stderr}`).toBe(0);
    expect(fs.existsSync(controlPath)).toBe(false);
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

    const secondStop = runCli(audit, env, ['stop']);
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
    const controlPath = path.join(audit, 'proofshot-artifacts', '.session.json');
    const initialState = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
    cleanupProcesses.push(initialState.browserProcess);

    const retainedStop = runCli(audit, env, ['stop', '--no-close']);
    expect(retainedStop.status, `${retainedStop.stdout}\n${retainedStop.stderr}`).toBe(0);
    const retainedState = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
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
    expect(fs.existsSync(controlPath)).toBe(false);
    expect(fs.readFileSync(summaryPath, 'utf-8')).toBe(summaryBefore);
    expect(fs.statSync(summaryPath).mtimeMs).toBe(summaryMtimeBefore);
    cleanupProcesses.splice(cleanupProcesses.indexOf(initialState.browserProcess), 1);
  }, 30000);
});
