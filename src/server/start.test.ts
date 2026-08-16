import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPortOpen } from '../utils/port.js';
import {
  isDetachedProcessIdentity,
  terminateOwnedProcessTree,
  type ProcessIdentity,
} from '../utils/process.js';
import { ensureDevServer } from './start.js';

const roots: string[] = [];
const ownedProcesses: ProcessIdentity[] = [];

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

afterEach(async () => {
  for (const identity of ownedProcesses.splice(0)) {
    await terminateOwnedProcessTree(identity, { graceMs: 200 });
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('ensureDevServer', () => {
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
        "const server = http.createServer((_req, res) => res.end('ok'));",
        "server.on('error', () => process.exit(98));",
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
        ({ process }) => ownedProcesses.push(process),
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
  });
});
