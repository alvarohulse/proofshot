import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { sanitizeDiagnosticMessage } from './provenance.js';
import { ab, quoteShellArgument } from '../utils/exec.js';

export type AgentBrowserResultReceipt = {
  success: boolean;
  evidencePath: string;
  error?: string;
};

export type PrivateNetworkEvidencePaths = {
  privateDirectory: string;
  harPath: string;
  requestsPath: string;
  summaryPath: string;
};

export type SanitizedNetworkRequest = {
  endpoint: string;
  method: string;
  status: number;
  durationMs: number | null;
  error: string | null;
};

export type SanitizedNetworkSummary = {
  version: 1;
  requestCount: number;
  requests: SanitizedNetworkRequest[];
};

export function preparePrivateNetworkEvidence(
  sessionDir: string,
): PrivateNetworkEvidencePaths {
  const privateDirectory = path.join(sessionDir, 'private', 'agent-browser');
  preparePrivateDirectory(privateDirectory);
  return {
    privateDirectory,
    harPath: path.join(privateDirectory, 'network.har'),
    requestsPath: path.join(privateDirectory, 'requests.json'),
    summaryPath: path.join(sessionDir, 'network-summary.json'),
  };
}

export function startPrivateNetworkCapture(sessionName: string): void {
  ab('network har start --content text', { session: sessionName });
}

export function finalizePrivateNetworkCapture(
  sessionName: string,
  paths: PrivateNetworkEvidencePaths,
): SanitizedNetworkSummary {
  preparePrivateDirectory(paths.privateDirectory);
  const requests = ab('network requests --json', { session: sessionName });
  writePrivateTextFile(
    paths.requestsPath,
    requests.trim() ? `${requests.trim()}\n` : '{"success":true,"data":[]}\n',
  );
  ab(
    `network har stop ${quoteShellArgument(paths.harPath)} --json`,
    { session: sessionName },
  );
  if (!fs.existsSync(paths.harPath)) {
    throw new Error('agent-browser did not write the requested HAR evidence.');
  }
  fs.chmodSync(paths.harPath, 0o600);
  const summary = buildSanitizedNetworkSummary(
    JSON.parse(fs.readFileSync(paths.harPath, 'utf-8')),
  );
  writeJsonFile(paths.summaryPath, summary);
  return summary;
}

export function loadSanitizedNetworkSummary(
  summaryPath: string | undefined,
): SanitizedNetworkSummary | null {
  if (!summaryPath || !fs.existsSync(summaryPath)) {
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as unknown;
    return isSanitizedNetworkSummary(value) ? value : null;
  } catch {
    return null;
  }
}

export function buildSanitizedNetworkSummary(
  value: unknown,
): SanitizedNetworkSummary {
  const entries = readHarEntries(value);
  const requests = entries.map(toSanitizedRequest).sort(compareRequests);
  return {
    version: 1,
    requestCount: requests.length,
    requests,
  };
}

export function writePrivateAgentBrowserResult(options: {
  command: string;
  sessionDir: string;
  rawOutput: string;
  success: boolean;
  error?: string;
}): AgentBrowserResultReceipt {
  const actionsDirectory = path.join(
    options.sessionDir,
    'private',
    'agent-browser',
    'actions',
  );
  preparePrivateDirectory(actionsDirectory);
  const filePath = path.join(
    actionsDirectory,
    `${Date.now()}-${randomUUID()}.json`,
  );
  const result = sanitizeStructuredResult(
    parseStructuredResult(options.rawOutput, options.success, options.error),
    options.command,
  );
  writeJsonFile(filePath, result);
  const evidencePath = path
    .relative(options.sessionDir, filePath)
    .split(path.sep)
    .join(path.posix.sep);
  return {
    success: readSuccess(result, options.success),
    evidencePath,
    ...(options.error
      ? { error: sanitizeDiagnosticMessage(options.error) || 'agent-browser failed' }
      : {}),
  };
}

function sanitizeStructuredResult(value: unknown, command: string): unknown {
  if (['auth', 'cookies', 'eval', 'storage'].includes(command)) {
    const record = readRecord(value);
    return {
      success:
        typeof record.success === 'boolean' ? record.success : true,
      data: '[REDACTED]',
      ...(typeof record.error === 'string'
        ? { error: sanitizeDiagnosticMessage(record.error) }
        : {}),
    };
  }
  return sanitizeStructuredValue(value);
}

function sanitizeStructuredValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeDiagnosticMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeStructuredValue);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const namedSecret =
    typeof record.name === 'string' &&
    /authorization|cookie|credential|password|secret|token|api[-_]?key/i.test(
      record.name,
    );
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => {
      const isSensitive =
        /authorization|cookie|credential|password|secret|token|api[-_]?key/i.test(
          key,
        ) || (namedSecret && key === 'value');
      return [key, isSensitive ? '[REDACTED]' : sanitizeStructuredValue(entry)];
    }),
  );
}

function parseStructuredResult(
  rawOutput: string,
  success: boolean,
  error?: string,
): unknown {
  if (rawOutput.trim()) {
    try {
      return JSON.parse(rawOutput);
    } catch {
      return {
        success,
        data: { text: rawOutput },
        ...(error ? { error } : {}),
      };
    }
  }
  return {
    success,
    data: null,
    ...(error ? { error } : {}),
  };
}

function readSuccess(result: unknown, fallback: boolean): boolean {
  if (typeof result !== 'object' || result === null) {
    return fallback;
  }
  const success = (result as { success?: unknown }).success;
  return typeof success === 'boolean' ? success : fallback;
}

function preparePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let current = directory;
  while (current !== path.dirname(current)) {
    fs.chmodSync(current, 0o700);
    if (path.basename(current) === 'private') {
      break;
    }
    current = path.dirname(current);
  }
}

function readHarEntries(value: unknown): Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('HAR evidence root must be an object.');
  }
  const log = (value as { log?: unknown }).log;
  if (typeof log !== 'object' || log === null) {
    throw new Error('HAR evidence is missing its log object.');
  }
  const entries = (log as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error('HAR evidence is missing its entries array.');
  }
  return entries.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null,
  );
}

function toSanitizedRequest(entry: Record<string, unknown>): SanitizedNetworkRequest {
  const request = readRecord(entry.request);
  const response = readRecord(entry.response);
  const rawUrl = typeof request.url === 'string' ? request.url : '';
  const rawDuration = typeof entry.time === 'number' ? entry.time : Number.NaN;
  const rawError =
    typeof entry._error === 'string'
      ? entry._error
      : typeof response._error === 'string'
        ? response._error
        : null;
  return {
    endpoint: sanitizeEndpoint(rawUrl),
    method: typeof request.method === 'string' ? request.method : '',
    status: typeof response.status === 'number' ? response.status : 0,
    durationMs: Number.isFinite(rawDuration)
      ? parseFloat(rawDuration.toFixed(3))
      : null,
    error: rawError ? sanitizeDiagnosticMessage(rawError) || 'request failed' : null,
  };
}

function sanitizeEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return sanitizeDiagnosticMessage(value) || '';
  }
}

function compareRequests(
  left: SanitizedNetworkRequest,
  right: SanitizedNetworkRequest,
): number {
  return (
    left.endpoint.localeCompare(right.endpoint) ||
    left.method.localeCompare(right.method) ||
    left.status - right.status ||
    (left.durationMs ?? -1) - (right.durationMs ?? -1) ||
    (left.error || '').localeCompare(right.error || '')
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function isSanitizedNetworkSummary(
  value: unknown,
): value is SanitizedNetworkSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const summary = value as Partial<SanitizedNetworkSummary>;
  return (
    summary.version === 1 &&
    typeof summary.requestCount === 'number' &&
    Array.isArray(summary.requests)
  );
}

function writePrivateTextFile(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}
