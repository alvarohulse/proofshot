import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { normalizeLogText } from './evidence.js';
import type {
  CaptureProcessState,
  EvidenceEvent,
  ProcessDefinition,
  ResolvedLogSourceState,
} from './types.js';
import {
  captureProcessIdentity,
  getShellExecutable,
  type ProcessIdentity,
} from '../utils/process.js';

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
  shellPath?: string;
  offset?: number;
  fileDevice?: number;
  fileInode?: number;
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
  const serialized = JSON.stringify(event) + '\n';
  const logLine = normalized + '\n';
  const bytes = Buffer.byteLength(serialized) + Buffer.byteLength(logLine);
  const truncationEvent = {
    ...event,
    text: '[ProofShot capture truncated at configured byte limit]',
    truncated: true,
  };
  const truncationSerialized = JSON.stringify(truncationEvent) + '\n';
  const truncationLogLine = truncationEvent.text + '\n';
  const truncationBytes =
    Buffer.byteLength(truncationSerialized) +
    Buffer.byteLength(truncationLogLine);
  if (bytesWritten + bytes + truncationBytes > config.maxBytes) {
    if (!truncated) {
      truncated = true;
      if (bytesWritten + truncationBytes <= config.maxBytes) {
        bytesWritten += truncationBytes;
        fs.appendFileSync(config.evidencePath, truncationSerialized);
        fs.appendFileSync(config.logPath, truncationLogLine);
      }
    }
    return;
  }
  bytesWritten += bytes;
  fs.appendFileSync(config.evidencePath, serialized);
  fs.appendFileSync(config.logPath, logLine);
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
let stopping = false;
const child = spawn(config.command, {
  cwd: config.cwd,
  env: { ...process.env, ...config.env },
  shell: config.shellPath,
  stdio: ['ignore', 'pipe', 'pipe'],
});
attachLines(child.stdout, 'stdout');
attachLines(child.stderr, 'stderr');
child.on('error', (error) => writeEvent(error.stack || error.message || String(error), 'stderr'));
child.on('close', (code) => {
  writeEvent(
    stopping
      ? '[process stopped by ProofShot]'
      : '[process exited with code ' + (code == null ? 'unknown' : code) + ']',
    'stderr',
  );
  removePidFile();
  process.exit(stopping ? 0 : (code == null ? 1 : code));
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    try { child.kill(signal); } catch {}
  });
}
`;

const FILE_RUNNER_SOURCE = `${COMMON_WORKER_SOURCE}
let offset = config.offset || 0;
let fileDevice = config.fileDevice;
let fileInode = config.fileInode;
let buffered = '';
function readAvailable() {
  let fd;
  try {
    fd = fs.openSync(config.filePath, 'r');
  } catch {
    return;
  }
  const stat = fs.fstatSync(fd);
  if (
    (fileDevice !== undefined && stat.dev !== fileDevice) ||
    (fileInode !== undefined && stat.ino !== fileInode) ||
    stat.size < offset
  ) {
    offset = 0;
    writeEvent('[file rotated or truncated]', 'file', 'live', { captureGap: true });
  }
  fileDevice = stat.dev;
  fileInode = stat.ino;
  if (stat.size === offset) {
    fs.closeSync(fd);
    return;
  }
  const length = Math.min(stat.size - offset, 64 * 1024);
  const buffer = Buffer.alloc(length);
  const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
  fs.closeSync(fd);
  offset += bytesRead;
  buffered += buffer.subarray(0, bytesRead).toString().replace(/\\r\\n?/g, '\\n');
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
  captureDir: string,
  startTimeMs: number,
  maxBytes: number,
  stripAnsi: boolean,
): Promise<CaptureProcessState> {
  const pidFile = path.join(captureDir, `${source.id}.pid`);
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
    shellPath: getShellExecutable(),
  };
  return startDetachedWorker(source.id, pidFile, PROCESS_RUNNER_SOURCE, config);
}

export async function startFileCapture(
  filePath: string,
  source: ResolvedLogSourceState,
  evidencePath: string,
  captureDir: string,
  startTimeMs: number,
  maxBytes: number,
  stripAnsi: boolean,
): Promise<CaptureProcessState> {
  const pidFile = path.join(captureDir, `${source.id}.pid`);
  let offset = 0;
  let fileDevice: number | undefined;
  let fileInode: number | undefined;
  let liveMaxBytes = maxBytes;
  if (fs.existsSync(filePath)) {
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      offset = stat.size;
      fileDevice = stat.dev;
      fileInode = stat.ino;
      const historyBudget = Math.max(1, Math.floor(maxBytes / 2));
      liveMaxBytes = Math.max(1, maxBytes - historyBudget);
      const historyLength = Math.min(stat.size, historyBudget);
      const history = Buffer.alloc(historyLength);
      fs.readSync(fd, history, 0, historyLength, stat.size - historyLength);
      appendHistory(
        history.toString('utf-8'),
        source,
        evidencePath,
        historyBudget,
        stripAnsi,
        'file',
      );
    } finally {
      fs.closeSync(fd);
    }
  }

  const config = {
    evidencePath,
    logPath: source.logPath,
    pidFile,
    startTimeMs,
    maxBytes: liveMaxBytes,
    stripAnsi,
    source,
    offset,
    fileDevice,
    fileInode,
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
  const lines = normalized.split('\n').filter((line) => line.length > 0);
  const retained: Array<{ event: EvidenceEvent; serialized: string; logLine: string }> = [];
  let retainedBytes = 0;
  let truncated = false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event: EvidenceEvent = {
      version: 1,
      origin: 'environment',
      group: source.group,
      sourceId: source.id,
      sourceTitle: source.title,
      stream,
      segment: 'history',
      timestamp: null,
      relativeTimeSec: null,
      text: lines[index],
    };
    const serialized = JSON.stringify(event) + '\n';
    const logLine = `${lines[index]}\n`;
    const eventBytes =
      Buffer.byteLength(serialized) + Buffer.byteLength(logLine);
    if (retainedBytes + eventBytes > maxBytes) {
      truncated = true;
      break;
    }
    retained.unshift({ event, serialized, logLine });
    retainedBytes += eventBytes;
  }
  if (truncated && retained.length > 0) {
    while (retained.length > 0) {
      retained[0].event.truncated = true;
      retained[0].serialized = JSON.stringify(retained[0].event) + '\n';
      retainedBytes = retained.reduce(
        (total, entry) =>
          total +
          Buffer.byteLength(entry.serialized) +
          Buffer.byteLength(entry.logLine),
        0,
      );
      if (retainedBytes <= maxBytes) break;
      retained.shift();
    }
  }
  if (truncated && retained.length === 0) {
    const event: EvidenceEvent = {
      version: 1,
      origin: 'environment',
      group: source.group,
      sourceId: source.id,
      sourceTitle: source.title,
      stream,
      segment: 'history',
      timestamp: null,
      relativeTimeSec: null,
      text: '[ProofShot capture truncated at configured byte limit]',
      truncated: true,
    };
    const serialized = JSON.stringify(event) + '\n';
    const logLine = `${event.text}\n`;
    if (
      Buffer.byteLength(serialized) + Buffer.byteLength(logLine) <=
      maxBytes
    ) {
      retained.push({ event, serialized, logLine });
    }
  }
  for (const entry of retained) {
    fs.appendFileSync(evidencePath, entry.serialized);
    fs.appendFileSync(source.logPath, entry.logLine);
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
  fs.mkdirSync(path.dirname(pidFile), { recursive: true, mode: 0o700 });
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
