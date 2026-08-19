import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  sanitizeDiagnosticMessage,
  sanitizePageUrl,
} from './provenance.js';
import {
  isHighConfidenceSecretField,
  isSecretBearingCommandArgument,
} from './redaction-policy.js';
import { ab } from '../utils/exec.js';

export type AgentBrowserResultReceipt = {
  success: boolean;
  evidencePath: string;
  error?: string;
};

type AgentBrowserOutputOptions = {
  args: string[];
  rawOutput: string;
  success: boolean;
  error?: string;
};

export type PrivateNetworkEvidencePaths = {
  privateDirectory: string;
  harPath: string;
  requestsPath: string;
  summaryPath: string;
};

export type FinalizePrivateNetworkCaptureOptions = {
  allowBrowserCommands?: boolean;
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
  ab(['network', 'har', 'start', '--content', 'text'], {
    session: sessionName,
  });
}

export function finalizePrivateNetworkCapture(
  sessionName: string,
  paths: PrivateNetworkEvidencePaths,
  options: FinalizePrivateNetworkCaptureOptions = {},
): SanitizedNetworkSummary {
  preparePrivateDirectory(paths.privateDirectory);
  const allowBrowserCommands = options.allowBrowserCommands !== false;
  const har = finalizePrivateHarCapture(
    sessionName,
    paths.harPath,
    allowBrowserCommands,
  );
  if (fs.existsSync(paths.requestsPath)) {
    fs.chmodSync(paths.requestsPath, 0o600);
  } else if (allowBrowserCommands) {
    let requests: string;
    try {
      requests = ab(['network', 'requests', '--json'], {
        session: sessionName,
      });
    } catch (error) {
      requests = JSON.stringify({
        success: false,
        data: null,
        error: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
    writePrivateTextFile(
      paths.requestsPath,
      requests.trim() ? `${requests.trim()}\n` : '{"success":true,"data":[]}\n',
    );
  }
  const summary = buildSanitizedNetworkSummary(har);
  writeJsonFile(paths.summaryPath, summary);
  return summary;
}

function finalizePrivateHarCapture(
  sessionName: string,
  harPath: string,
  allowBrowserCommands: boolean,
): unknown {
  const finalizedHar = readValidHarFile(harPath);
  if (finalizedHar !== null) {
    fs.chmodSync(harPath, 0o600);
    return finalizedHar;
  }

  const pendingPath = `${harPath}.pending`;
  const pendingHar = readValidHarFile(pendingPath);
  if (pendingHar !== null) {
    adoptPendingHar(pendingPath, harPath);
    return pendingHar;
  }
  if (!allowBrowserCommands) {
    throw new Error('No valid local HAR evidence was available for recovery.');
  }
  removeInvalidHarFile(pendingPath);

  let stopError: unknown;
  try {
    ab(['network', 'har', 'stop', pendingPath, '--json'], {
      session: sessionName,
    });
  } catch (error) {
    stopError = error;
  }

  const capturedHar = readValidHarFile(pendingPath);
  if (capturedHar === null) {
    if (stopError) {
      throw stopError;
    }
    throw new Error('agent-browser did not write valid HAR evidence.');
  }
  adoptPendingHar(pendingPath, harPath);
  return capturedHar;
}

function readValidHarFile(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    buildSanitizedNetworkSummary(value);
    return value;
  } catch {
    return null;
  }
}

function adoptPendingHar(pendingPath: string, harPath: string): void {
  fs.chmodSync(pendingPath, 0o600);
  if (fs.existsSync(harPath)) {
    fs.unlinkSync(harPath);
  }
  fs.renameSync(pendingPath, harPath);
  fs.chmodSync(harPath, 0o600);
}

function removeInvalidHarFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
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
  args: string[];
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
  const result = parseStructuredResult(
    options.rawOutput,
    options.success,
    options.error,
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
      ? { error: sanitizeAgentBrowserError(options.args, options.error) }
      : {}),
  };
}

export function formatAgentBrowserOutputForDisplay(
  options: AgentBrowserOutputOptions,
): string {
  const result = sanitizeStructuredResult(
    parseStructuredResult(options.rawOutput, options.success, options.error),
    options.args,
  );
  if (typeof result !== 'object' || result === null) {
    return String(result);
  }
  const data = (result as { data?: unknown }).data;
  if (
    typeof data === 'string' ||
    typeof data === 'number' ||
    typeof data === 'boolean'
  ) {
    return String(data);
  }
  if (typeof data !== 'object' || data === null) {
    return JSON.stringify(result);
  }
  const record = data as Record<string, unknown>;
  for (const key of ['url', 'title', 'text', 'value', 'snapshot']) {
    if (typeof record[key] === 'string') {
      return record[key];
    }
  }
  return JSON.stringify(result);
}

export function sanitizeAgentBrowserError(
  args: string[],
  error: string | undefined,
): string {
  if (commandResultMayContainSecrets(args)) {
    return 'agent-browser command failed; sensitive details were redacted';
  }
  return sanitizeDiagnosticMessage(error) || 'agent-browser failed';
}

function sanitizeStructuredResult(value: unknown, args: string[]): unknown {
  if (commandResultMayContainSecrets(args)) {
    const record = readRecord(value);
    return {
      success:
        typeof record.success === 'boolean' ? record.success : true,
      data: '[REDACTED]',
      ...(typeof record.error === 'string'
        ? { error: sanitizeAgentBrowserError(args, record.error) }
        : {}),
    };
  }
  return sanitizeStructuredValue(value);
}

function commandResultMayContainSecrets(args: string[]): boolean {
  const command = args[0]?.toLowerCase();
  if (!command) {
    return true;
  }
  if (args.slice(1).some(isSecretBearingCommandArgument)) {
    return true;
  }
  if (
    [
      'auth',
      'batch',
      'cookies',
      'eval',
      'fill',
      'network',
      'select',
      'storage',
      'type',
      'upload',
    ].includes(command)
  ) {
    return true;
  }
  if (
    command === 'keyboard' &&
    ['inserttext', 'type'].includes(args[1]?.toLowerCase())
  ) {
    return true;
  }
  if (
    command === 'set' &&
    ['credentials', 'headers'].includes(args[1]?.toLowerCase())
  ) {
    return true;
  }
  if (command === 'get') {
    const getAction = args[1]?.toLowerCase();
    if (getAction === 'value') {
      return true;
    }
    if (getAction === 'attr') {
      const attribute = args[3];
      return (
        typeof attribute === 'string' &&
        (attribute.toLowerCase() === 'value' ||
          isHighConfidenceSecretField(attribute))
      );
    }
  }
  if (command === 'find') {
    return ['fill', 'select', 'type'].some((action) =>
      args.some((argument) => argument.toLowerCase() === action),
    );
  }
  return false;
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
    isHighConfidenceSecretField(record.name);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => {
      const isSensitive =
        isHighConfidenceSecretField(key) || (namedSecret && key === 'value');
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
    const url = new URL(sanitizePageUrl(value) || value);
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
    Array.isArray(summary.requests) &&
    summary.requests.every(
      (request) =>
        typeof request === 'object' &&
        request !== null &&
        typeof request.endpoint === 'string' &&
        typeof request.method === 'string' &&
        typeof request.status === 'number' &&
        (typeof request.durationMs === 'number' || request.durationMs === null) &&
        (typeof request.error === 'string' || request.error === null),
    )
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
