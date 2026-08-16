import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPortOpen } from '../utils/port.js';
import {
  isDetachedProcessIdentity,
  ownedProcessTreeIsAlive,
  terminateOwnedProcessTree,
  type ProcessIdentity,
} from '../utils/process.js';
import { ensureDevServer } from './start.js';

const roots: string[] = [];
const ownedProcesses: ProcessIdentity[] = [];
const originalPath = process.env.PATH;

function createRoot(): string {
  const cache = path.join(os.userInfo().homedir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const root = fs.mkdtempSync(path.join(cache, 'proofshot-server-test-'));
  roots.push(root);
  return root;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeExecutable(root: string, name: string, source: string): string {
  const executablePath = path.join(root, name);
  fs.writeFileSync(executablePath, source, { mode: 0o700 });
  fs.chmodSync(executablePath, 0o700);
  return executablePath;
}

async function waitForOwnedTreeExit(
  identity: ProcessIdentity,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (ownedProcessTreeIsAlive(identity)) {
    if (Date.now() >= deadline) {
      throw new Error(`owned process tree ${identity.sessionId} did not exit`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function readServer(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/' },
      (response) => {
        let body = '';
        response.setEncoding('utf-8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve(body));
      },
    );
    request.on('error', reject);
  });
}

afterEach(async () => {
  process.env.PATH = originalPath;
  for (const identity of ownedProcesses.splice(0)) {
    await terminateOwnedProcessTree(identity, { graceMs: 200 });
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('ensureDevServer', () => {
  it('preflights a missing lsof before spawning or creating logs', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const root = createRoot();
    const logPath = path.join(root, 'server.log');
    const onStarted = vi.fn();
    process.env.PATH = root;

    await expect(
      ensureDevServer('unused command', 3000, 250, logPath, onStarted),
    ).rejects.toThrow(/lsof is required.*Install lsof/i);
    expect(onStarted).not.toHaveBeenCalled();
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('preflights a failing lsof before spawning or creating logs', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const root = createRoot();
    const logPath = path.join(root, 'server.log');
    const onStarted = vi.fn();
    writeExecutable(
      root,
      'lsof',
      '#!/bin/sh\necho "listener inspection unavailable" >&2\nexit 2\n',
    );
    process.env.PATH = root;

    await expect(
      ensureDevServer('unused command', 3000, 250, logPath, onStarted),
    ).rejects.toThrow(/could not run lsof.*listener inspection unavailable/i);
    expect(onStarted).not.toHaveBeenCalled();
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('fails actionably without killing an unrelated occupied listener', async () => {
    const listener = http.createServer((_request, response) => response.end('unrelated'));
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('missing listener port');

    try {
      await expect(
        ensureDevServer(
          `${shellQuote(process.execPath)} -e ${shellQuote('process.exit(99)')}`,
          address.port,
          250,
          path.join(createRoot(), 'server.log'),
        ),
      ).rejects.toThrow(/already in use by a process ProofShot did not start/);
      expect(listener.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  it('persists an exact supervisor identity and keeps epoch-tab server logs', async () => {
    const root = createRoot();
    const scriptPath = path.join(root, 'server.mjs');
    const logPath = path.join(root, 'server.log');
    fs.writeFileSync(
      scriptPath,
      [
        "import http from 'node:http';",
        'const port = Number(process.argv[2]);',
        "const server = http.createServer((_req, res) => res.end('ok'));",
        "server.listen(port, '127.0.0.1', () => console.log('server-ready'));",
      ].join('\n'),
    );

    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('missing probe port');
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const onStarted = vi.fn();
    const result = await ensureDevServer(
      `${shellQuote(process.execPath)} ${shellQuote(scriptPath)} ${port}`,
      port,
      3000,
      logPath,
      onStarted,
    );
    ownedProcesses.push(result.process);

    expect(isDetachedProcessIdentity(result.process)).toBe(true);
    expect(onStarted).toHaveBeenCalledWith(result);
    expect(fs.readFileSync(logPath, 'utf-8')).toMatch(/^\d{13}\tserver-ready$/m);
    expect(fs.statSync(logPath).mode & 0o777).toBe(0o600);

    await terminateOwnedProcessTree(result.process, { graceMs: 300 });
    ownedProcesses.pop();
    for (let attempt = 0; attempt < 40 && (await isPortOpen(port)); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await isPortOpen(port)).toBe(false);
  });

  it('exact-cleans the owned tree and preserves a runtime inspection error', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const root = createRoot();
    const scriptPath = path.join(root, 'server.mjs');
    const logPath = path.join(root, 'server.log');
    fs.writeFileSync(
      scriptPath,
      [
        "import http from 'node:http';",
        'const port = Number(process.argv[2]);',
        "const server = http.createServer((_req, res) => res.end('ok'));",
        "server.listen(port, '127.0.0.1');",
      ].join('\n'),
    );
    writeExecutable(
      root,
      'lsof',
      [
        '#!/bin/sh',
        'if [ "$1" = "-v" ]; then exit 0; fi',
        'echo "listener inspection denied" >&2',
        'exit 2',
      ].join('\n'),
    );
    process.env.PATH = root;

    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('missing probe port');
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    let startedProcess: ProcessIdentity | undefined;
    const start = ensureDevServer(
      `${shellQuote(process.execPath)} ${shellQuote(scriptPath)} ${port}`,
      port,
      3000,
      logPath,
      ({ process }) => {
        startedProcess = process;
        ownedProcesses.push(process);
      },
    );

    await expect(start).rejects.toThrow(
      /lsof failed while inspecting.*listener inspection denied/i,
    );
    if (!startedProcess) throw new Error('missing started process identity');
    await waitForOwnedTreeExit(startedProcess);
    expect(ownedProcessTreeIsAlive(startedProcess)).toBe(false);
  });

  it('rejects a same-port starter whose owned supervisor loses the bind race', async () => {
    const root = createRoot();
    const scriptPath = path.join(root, 'racing-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import fs from 'node:fs';",
        "import http from 'node:http';",
        'const [port, ownMarker, peerMarker] = process.argv.slice(2);',
        "fs.writeFileSync(ownMarker, 'ready');",
        'while (!fs.existsSync(peerMarker)) {',
        '  await new Promise((resolve) => setTimeout(resolve, 10));',
        '}',
        'setInterval(() => {}, 1000);',
        "const server = http.createServer((_req, res) => res.end('ok'));",
        "server.on('error', () => {});",
        "server.listen(Number(port), '127.0.0.1');",
      ].join('\n'),
    );

    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('missing probe port');
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const markers = [path.join(root, 'first.ready'), path.join(root, 'second.ready')];
    const startedProcesses: Array<ProcessIdentity | undefined> = [];
    const starts = markers.map((marker, index) =>
      ensureDevServer(
        [
          shellQuote(process.execPath),
          shellQuote(scriptPath),
          String(port),
          shellQuote(marker),
          shellQuote(markers[1 - index]),
        ].join(' '),
        port,
        3000,
        path.join(root, `server-${index}.log`),
        ({ process }) => {
          startedProcesses[index] = process;
          ownedProcesses.push(process);
        },
      ),
    );

    const results = await Promise.allSettled(starts);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringMatching(/another listener/i),
      }),
    });

    const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
    const loserIndex = results.findIndex((result) => result.status === 'rejected');
    const winnerIdentity = startedProcesses[winnerIndex];
    const loserIdentity = startedProcesses[loserIndex];
    if (!winnerIdentity || !loserIdentity) throw new Error('missing raced process identity');

    await waitForOwnedTreeExit(loserIdentity);
    expect(ownedProcessTreeIsAlive(loserIdentity)).toBe(false);
    expect(ownedProcessTreeIsAlive(winnerIdentity)).toBe(true);
    await expect(readServer(port)).resolves.toBe('ok');
  });
});
