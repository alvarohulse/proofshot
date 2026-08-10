import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { appendEvidenceEvent, normalizeLogText } from './evidence.js';
import type {
  CaptureProcessState,
  EvidenceEvent,
  ProcessDefinition,
  ResolvedLogSourceState,
} from './types.js';
import { captureProcessIdentity, type ProcessIdentity } from '../utils/process.js';

type WorkerConfig = {
  evidencePath: string;
  logPath: string;
  pidFile?: string;
  startTimeMs: number;
  maxBytes: number;
  stripAnsi: boolean;
  source: ResolvedLogSourceState;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  offset?: number;
};

const COMMON_WORKER_SOURCE = String.raw`
const fs = require('fs');
const config = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
const ansiPattern = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const controlPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;
let bytesWritten = 0;
let truncated = false;
function normalize(text) {
  const normalized = text.replace(/\r\n?/g, '\n').replace(controlPattern, '');
  return config.stripAnsi ? normalized.replace(ansiPattern, '') : normalized;
}
function writeEvent(text, stream, segment = 'live', extra = {}) {
  const normalized = normalize(text);
  if (normalized.length === 0) return;
  const bytes = Buffer.byteLength(normalized);
  if (bytesWritten + bytes > config.maxBytes) {
    if (!truncated) {
      truncated = true;
      const now = Date.now();
      const event = {
        version: 1,
        origin: 'environment',
        group: config.source.group,
        sourceId: config.source.id,
        sourceTitle: config.source.title,
        stream,
        segment,
        timestamp: new Date(now).toISOString(),
        relativeTimeSec: Math.max(0, (now - config.startTimeMs) / 1000),
        text: '[ProofShot capture truncated at configured byte limit]',
        truncated: true,
      };
      fs.appendFileSync(config.evidencePath, JSON.stringify(event) + '\n');
      fs.appendFileSync(config.logPath, event.text + '\n');
    }
    return;
  }
  bytesWritten += bytes;
  const now = Date.now();
  const event = {
    version: 1,
    origin: 'environment',
    group: config.source.group,
    sourceId: config.source.id,
    sourceTitle: config.source.title,
    stream,
    segment,
    timestamp: new Date(now).toISOString(),
    relativeTimeSec: Math.max(0, (now - config.startTimeMs) / 1000),
    text: normalized,
    ...extra,
  };
  fs.appendFileSync(config.evidencePath, JSON.stringify(event) + '\n');
  fs.appendFileSync(config.logPath, normalized + '\n');
}
function attachLines(stream, streamName) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString().replace(/\r\n?/g, '\n');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) writeEvent(line, streamName);
  });
  stream.on('end', () => {
    if (buffer.length > 0) writeEvent(buffer, streamName);
    buffer = '';
  });
}
if (config.pidFile) {
  fs.writeFileSync(config.pidFile, String(process.pid), { mode: 0o600 });
}
function removePidFile() {
  if (config.pidFile) {
    try { fs.unlinkSync(config.pidFile); } catch {}
  }
}
`;

const TMUX_PIPE_RUNNER_SOURCE = `${COMMON_WORKER_SOURCE}
attachLines(process.stdin, 'pty');
process.stdin.on('end', () => {
  removePidFile();
  process.exit(0);
});
process.on('SIGTERM', () => {
  removePidFile();
  process.exit(0);
});
`;

const PROCESS_RUNNER_SOURCE = `${COMMON_WORKER_SOURCE}
const { spawn } = require('child_process');
const child = spawn(config.command, {
  cwd: config.cwd,
  env: { ...process.env, ...config.env },
  shell: process.env.SHELL || '/bin/sh',
  stdio: ['ignore', 'pipe', 'pipe'],
});
attachLines(child.stdout, 'stdout');
attachLines(child.stderr, 'stderr');
child.on('error', (error) => writeEvent(error.stack || error.message || String(error), 'stderr'));
child.on('close', (code) => {
  writeEvent('[process exited with code ' + (code == null ? 'unknown' : code) + ']', 'stderr');
  removePidFile();
  process.exit(code == null ? 1 : code);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try { child.kill(signal); } catch {}
  });
}
`;

const FILE_RUNNER_SOURCE = `${COMMON_WORKER_SOURCE}
let offset = config.offset || 0;
let buffered = '';
function readAvailable() {
  let stat;
  try {
    stat = fs.statSync(config.filePath);
  } catch {
    return;
  }
  if (stat.size < offset) {
    offset = 0;
    writeEvent('[file rotated or truncated]', 'file', 'live', { captureGap: true });
  }
  if (stat.size === offset) return;
  const length = stat.size - offset;
  const fd = fs.openSync(config.filePath, 'r');
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, offset);
  fs.closeSync(fd);
  offset = stat.size;
  buffered += buffer.toString();
  const lines = buffered.split('\\n');
  buffered = lines.pop() || '';
  for (const line of lines) writeEvent(line, 'file');
}
const timer = setInterval(readAvailable, 100);
function stop() {
  clearInterval(timer);
  if (buffered.length > 0) writeEvent(buffered, 'file');
  removePidFile();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
`;

export function buildTmuxPipeCommand(config: WorkerConfig): string {
  const encodedConfig = encodeConfig(config);
  return [
    shellQuote(process.execPath),
    '-e',
    shellQuote(TMUX_PIPE_RUNNER_SOURCE),
    shellQuote(encodedConfig),
  ].join(' ');
}

export async function waitForCaptureProcess(
  sourceId: string,
  pidFile: string,
  timeoutMs = 2000,
): Promise<CaptureProcessState> {
  const deadline = Date.now() + timeoutMs;
  do {
    const identity = readPidIdentity(pidFile);
    if (identity) {
      return { sourceId, process: identity, pidFile };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);

  throw new Error(`ProofShot could not capture the log helper identity for ${sourceId}.`);
}

export async function startProcessCapture(
  definition: ProcessDefinition,
  source: ResolvedLogSourceState,
  evidencePath: string,
  startTimeMs: number,
  maxBytes: number,
  stripAnsi: boolean,
): Promise<CaptureProcessState> {
  const pidFile = `${source.logPath}.pid`;
  const config: WorkerConfig = {
    evidencePath,
    logPath: source.logPath,
    pidFile,
    startTimeMs,
    maxBytes,
    stripAnsi,
    source,
    command: definition.command,
    cwd: definition.cwd,
    env: definition.env,
  };
  return startDetachedWorker(source.id, pidFile, PROCESS_RUNNER_SOURCE, config);
}

export async function startFileCapture(
  filePath: string,
  source: ResolvedLogSourceState,
  evidencePath: string,
  startTimeMs: number,
  maxBytes: number,
  stripAnsi: boolean,
): Promise<CaptureProcessState> {
  const pidFile = `${source.logPath}.pid`;
  let offset = 0;
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    appendHistory(
      raw,
      source,
      evidencePath,
      maxBytes,
      stripAnsi,
      'file',
    );
    offset = fs.statSync(filePath).size;
  }

  const config = {
    evidencePath,
    logPath: source.logPath,
    pidFile,
    startTimeMs,
    maxBytes,
    stripAnsi,
    source,
    offset,
    filePath,
  };
  return startDetachedWorker(source.id, pidFile, FILE_RUNNER_SOURCE, config);
}

export function appendHistory(
  raw: string,
  source: ResolvedLogSourceState,
  evidencePath: string,
  maxBytes: number,
  stripAnsi: boolean,
  stream: EvidenceEvent['stream'],
): void {
  const normalized = normalizeLogText(raw, stripAnsi);
  const buffer = Buffer.from(normalized);
  const truncated = buffer.byteLength > maxBytes;
  const retained = truncated
    ? buffer.subarray(Math.max(0, buffer.byteLength - maxBytes)).toString('utf-8')
    : normalized;
  const lines = retained.split('\n').filter((line) => line.length > 0);
  fs.appendFileSync(source.logPath, retained + (retained.endsWith('\n') ? '' : '\n'));
  for (const line of lines) {
    appendEvidenceEvent(evidencePath, {
      version: 1,
      origin: 'environment',
      group: source.group,
      sourceId: source.id,
      sourceTitle: source.title,
      stream,
      segment: 'history',
      timestamp: null,
      relativeTimeSec: null,
      text: line,
      truncated: truncated || undefined,
    });
  }
}

export function createWorkerConfig(params: WorkerConfig): WorkerConfig {
  return params;
}

async function startDetachedWorker(
  sourceId: string,
  pidFile: string,
  workerSource: string,
  config: object,
): Promise<CaptureProcessState> {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  const errorFd = fs.openSync(`${pidFile}.stderr`, 'a', 0o600);
  const worker = spawn(process.execPath, ['-e', workerSource, encodeConfig(config)], {
    detached: true,
    stdio: ['ignore', 'ignore', errorFd],
  });
  fs.closeSync(errorFd);
  worker.unref();

  let identity = worker.pid ? captureProcessIdentity(worker.pid) : null;
  for (let attempt = 0; !identity && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    identity = worker.pid ? captureProcessIdentity(worker.pid) : null;
  }
  if (!identity) {
    try {
      if (worker.pid) {
        process.kill(-worker.pid, 'SIGKILL');
      }
    } catch {
      // The worker may already have exited.
    }
    throw new Error(`ProofShot could not capture the runner identity for ${sourceId}.`);
  }
  return { sourceId, process: identity, pidFile };
}

function readPidIdentity(pidFile: string): ProcessIdentity | null {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf-8').trim());
    return captureProcessIdentity(pid);
  } catch {
    return null;
  }
}

function encodeConfig(config: object): string {
  return Buffer.from(JSON.stringify(config)).toString('base64');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
