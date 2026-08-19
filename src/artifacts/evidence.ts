import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { PNG } from 'pngjs';
import type { SanitizedNetworkSummary } from '../browser/evidence.js';
import {
  sanitizeSessionLogEntry,
  type SessionLogEntry,
} from '../session/action-log.js';
import { sanitizeDiagnosticMessage } from '../browser/provenance.js';
import type { AgentBrowserRuntimeReceipt } from '../browser/isolation.js';
import { loadEvidenceEvents } from '../environment/evidence.js';
import type {
  EnvironmentState,
  EvidenceEvent,
  ResolvedLogSourceState,
} from '../environment/types.js';
import type { TimestampedLogEntry } from './viewer.js';

export type VerdictStatus = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'BLOCKED';

export type EvidenceSourceSummary = {
  id: string;
  title: string;
  origin: EvidenceEvent['origin'];
  group: string;
  lineCount: number;
  hiddenLineCount: number;
  truncationCount: number;
  captureGapCount: number;
  incidentCount: number;
};

export type EvidenceIncident = {
  id: string;
  severity: 'fatal' | 'error';
  origin: EvidenceEvent['origin'];
  group: string;
  message: string;
  count: number;
  sourceIds: string[];
  firstTimeSec: number | null;
  lastTimeSec: number | null;
};

export type ScreenshotIntegrity = {
  file: string;
  sha256: string | null;
  validPng: boolean;
  visuallyBlank: boolean;
  size: number;
};

export type CanonicalEvidence = {
  version: 1;
  sessionId: string;
  generatedAt: string;
  timelineDurationSec: number;
  mediaDurationSec: number | null;
  mediaDivergenceSec: number | null;
  mediaTruncated: boolean;
  browserErrorCount?: number;
  actions: SessionLogEntry[];
  events: EvidenceEvent[];
  sources: EvidenceSourceSummary[];
  incidents: EvidenceIncident[];
  screenshots: ScreenshotIntegrity[];
  network?: SanitizedNetworkSummary | null;
  runtime?: AgentBrowserRuntimeReceipt;
};

export type Verdict = {
  version: 1;
  status: VerdictStatus;
  reasons: string[];
  fatalIncidentCount: number;
  missingArtifacts: string[];
  duplicateScreenshotHashes: string[][];
  expectedSelectorFailures: string[];
  mediaTruncated: boolean;
};

export type EvidenceBuildOptions = {
  sessionId: string;
  sessionDir: string;
  initialPageUrl?: string;
  durationSec: number;
  timelineOffsetSec?: number;
  videoPath: string;
  recordingWasActive: boolean;
  consoleEvidenceAvailable: boolean;
  browserErrorCount?: number;
  actions: SessionLogEntry[];
  consoleEntries: TimestampedLogEntry[];
  serverEntries: TimestampedLogEntry[];
  environment?: EnvironmentState | null;
  networkSummary?: SanitizedNetworkSummary | null;
  networkEvidenceRequired?: boolean;
  runtime?: AgentBrowserRuntimeReceipt;
};

export function writeCanonicalEvidence(
  options: EvidenceBuildOptions,
): { evidence: CanonicalEvidence; verdict: Verdict } {
  const sanitizedOptions = {
    ...options,
    actions: options.actions.map(sanitizeSessionLogEntry),
  };
  const events = collectEvents(sanitizedOptions);
  applyPresentationFilters(events, options.environment?.sources || []);
  const sanitizedEvents = events.map(sanitizeEvidenceEvent);
  const incidents = buildIncidents(sanitizedEvents);
  const screenshots = inspectScreenshots(
    sanitizedOptions.sessionDir,
    sanitizedOptions.actions,
  );
  const mediaDurationSec = probeMediaDuration(options.videoPath);
  const actionDuration = sanitizedOptions.actions
    .map((entry) => entry.relativeTimeSec)
    .filter(Number.isFinite)
    .reduce((maximum, current) => Math.max(maximum, current), 0);
  const timelineDurationSec = Math.max(options.durationSec, actionDuration);
  const mediaDivergenceSec =
    mediaDurationSec === null
      ? null
      : Math.max(0, actionDuration - mediaDurationSec);
  const mediaTruncated =
    mediaDivergenceSec !== null && mediaDivergenceSec > 1;
  const sources = buildSourceSummaries(sanitizedEvents, incidents);
  const evidence: CanonicalEvidence = {
    version: 1,
    sessionId: options.sessionId,
    generatedAt: new Date().toISOString(),
    timelineDurationSec,
    mediaDurationSec,
    mediaDivergenceSec,
    mediaTruncated,
    browserErrorCount: options.browserErrorCount ?? 0,
    actions: sanitizedOptions.actions,
    events: sanitizedEvents,
    sources,
    incidents,
    screenshots,
    network: options.networkSummary,
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };
  const verdict = buildVerdict(sanitizedOptions, evidence);
  writeJsonAtomically(
    path.join(options.sessionDir, 'evidence.json'),
    evidence,
  );
  writeJsonAtomically(
    path.join(options.sessionDir, 'verdict.json'),
    verdict,
  );
  return { evidence, verdict };
}

function sanitizeEvidenceEvent(event: EvidenceEvent): EvidenceEvent {
  return {
    ...event,
    group: sanitizeDiagnosticMessage(event.group) || 'environment',
    sourceId: sanitizeDiagnosticMessage(event.sourceId) || 'source',
    sourceTitle: sanitizeDiagnosticMessage(event.sourceTitle) || 'Source',
    text: sanitizeDiagnosticMessage(event.text) || '[REDACTED]',
    navigationId: sanitizeDiagnosticMessage(event.navigationId),
    pageUrl: sanitizeDiagnosticMessage(event.pageUrl),
  };
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function collectEvents(options: EvidenceBuildOptions): EvidenceEvent[] {
  const environmentEvents: EvidenceEvent[] =
    options.environment?.evidencePath &&
    fs.existsSync(options.environment.evidencePath)
      ? loadEvidenceEvents(options.environment.evidencePath).map((event) =>
          adjustEnvironmentEventTime(
            event,
            options.timelineOffsetSec ?? 0,
          ),
        )
      : [];
  if (options.environment && options.environment.kind !== 'launcher') {
    for (const sourceId of options.environment.healthFailures || []) {
      const source = options.environment.sources.find(
        (candidate) => candidate.id === sourceId,
      );
      environmentEvents.push({
        version: 1,
        origin: 'environment',
        group: source?.group || 'environment',
        sourceId,
        sourceTitle: source?.title || sourceId,
        stream: source?.stream || 'stderr',
        segment: 'live',
        timestamp: null,
        relativeTimeSec: null,
        text: `[capture worker exited before stop: ${sourceId}]`,
        captureGap: true,
      });
    }
  }
  environmentEvents.push(
    ...options.serverEntries.map((entry) =>
      toEvidenceEvent(entry, {
        origin: 'environment',
        group: 'backend',
        sourceId: 'server',
        sourceTitle: 'Server',
        stream: 'stderr',
      }),
    ),
  );

  const navigations = buildNavigations(options.actions, options.initialPageUrl);
  const browserEvents = options.consoleEntries.map((entry) => {
    const navigation = findNavigation(navigations, entry.relativeTimeSec);
    return toEvidenceEvent(entry, {
      origin: 'browser',
      group: 'browser',
      sourceId: navigation.id,
      sourceTitle: navigation.url,
      navigationId: navigation.id,
      pageUrl: navigation.url,
      stream: 'console',
    });
  });
  return [...environmentEvents, ...browserEvents];
}

function adjustEnvironmentEventTime(
  event: EvidenceEvent,
  timelineOffsetSec: number,
): EvidenceEvent {
  if (event.relativeTimeSec === null || timelineOffsetSec <= 0) {
    return event;
  }
  const relativeTimeSec = event.relativeTimeSec - timelineOffsetSec;
  return {
    ...event,
    relativeTimeSec:
      relativeTimeSec >= 0
        ? parseFloat(relativeTimeSec.toFixed(3))
        : null,
  };
}

function toEvidenceEvent(
  entry: TimestampedLogEntry,
  source: Pick<
    EvidenceEvent,
    | 'origin'
    | 'group'
    | 'sourceId'
    | 'sourceTitle'
    | 'stream'
    | 'navigationId'
    | 'pageUrl'
  >,
): EvidenceEvent {
  return {
    version: 1,
    ...source,
    segment: 'live',
    timestamp: null,
    relativeTimeSec: Number.isFinite(entry.relativeTimeSec)
      ? entry.relativeTimeSec
      : null,
    text: entry.text,
  };
}

function buildNavigations(
  actions: SessionLogEntry[],
  initialPageUrl?: string,
): Array<{ id: string; url: string; startTimeSec: number }> {
  const navigations: Array<{ url: string; startTimeSec: number }> = [];
  const append = (url: string | undefined, startTimeSec: number): void => {
    if (!url || navigations.at(-1)?.url === url) return;
    navigations.push({ url, startTimeSec });
  };
  append(initialPageUrl, 0);
  for (const entry of actions) {
    if (!Number.isFinite(entry.relativeTimeSec)) continue;
    const explicit = entry.action.match(/^(?:open|navigate)\s+(\S+)/i)?.[1];
    append(entry.pageUrl || explicit, entry.relativeTimeSec);
  }
  if (navigations.length === 0) {
    navigations.push({ url: 'Browser', startTimeSec: 0 });
  }
  return navigations.map((navigation, index) => ({
    id: `browser-nav-${index + 1}`,
    ...navigation,
  }));
}

function findNavigation(
  navigations: Array<{ id: string; url: string; startTimeSec: number }>,
  relativeTimeSec: number,
): { id: string; url: string } {
  const timed = Number.isFinite(relativeTimeSec) ? relativeTimeSec : 0;
  return (
    [...navigations]
      .reverse()
      .find((navigation) => navigation.startTimeSec <= timed) ||
    navigations[0]
  );
}

function buildIncidents(events: EvidenceEvent[]): EvidenceIncident[] {
  const incidents = new Map<
    string,
    {
      severity: 'fatal' | 'error';
      origin: EvidenceEvent['origin'];
      group: string;
      message: string;
      count: number;
      sourceIds: Set<string>;
      times: number[];
    }
  >();
  for (const event of events) {
    const severity = classifyIncident(event.text);
    if (!severity) {
      continue;
    }
    const message = normalizeIncident(event.text);
    const key = `${event.origin}\0${event.group}\0${severity}\0${message}`;
    const incident = incidents.get(key) || {
      severity,
      origin: event.origin,
      group: event.group,
      message,
      count: 0,
      sourceIds: new Set<string>(),
      times: [],
    };
    incident.count += 1;
    incident.sourceIds.add(event.sourceId);
    if (event.relativeTimeSec !== null) {
      incident.times.push(event.relativeTimeSec);
    }
    incidents.set(key, incident);
  }

  return [...incidents.values()].map((incident, index) => ({
    id: `incident-${index + 1}`,
    severity: incident.severity,
    origin: incident.origin,
    group: incident.group,
    message: incident.message,
    count: incident.count,
    sourceIds: [...incident.sourceIds],
    firstTimeSec:
      incident.times.length > 0 ? Math.min(...incident.times) : null,
    lastTimeSec:
      incident.times.length > 0 ? Math.max(...incident.times) : null,
  }));
}

function classifyIncident(text: string): 'fatal' | 'error' | null {
  if (
    /\bFATAL\b|\bpanic:|uncaught exception|unhandled rejection|capture worker exited before stop|malformed canonical evidence row|\[process exited with code (?!0\])/i.test(
      text,
    )
  ) {
    return 'fatal';
  }
  if (/\bError:|ERR[_!]|Exception:|Traceback/i.test(text)) {
    return 'error';
  }
  return null;
}

function normalizeIncident(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, '<timestamp>')
    .replace(/:\d+:\d+\b/g, ':<line>:<column>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSourceSummaries(
  events: EvidenceEvent[],
  incidents: EvidenceIncident[],
): EvidenceSourceSummary[] {
  const sourceKeys = new Map<
    string,
    {
      title: string;
      origin: EvidenceEvent['origin'];
      group: string;
      events: EvidenceEvent[];
    }
  >();
  for (const event of events) {
    const key = `${event.origin}\0${event.sourceId}`;
    const existing = sourceKeys.get(key) || {
      title: event.sourceTitle,
      origin: event.origin,
      group: event.group,
      events: [],
    };
    existing.events.push(event);
    sourceKeys.set(key, existing);
  }

  return [...sourceKeys.values()].map((source) => {
    const id = source.events[0].sourceId;
    const hiddenLineCount = source.events.filter(
      (event) => event.presentationHidden,
    ).length;
    return {
      id,
      title: source.title,
      origin: source.origin,
      group: source.group,
      lineCount: source.events.length,
      hiddenLineCount,
      truncationCount: source.events.filter((event) => event.truncated).length,
      captureGapCount: source.events.filter((event) => event.captureGap).length,
      incidentCount: incidents.filter(
        (incident) =>
          incident.origin === source.origin && incident.sourceIds.includes(id),
      ).length,
    };
  });
}

function applyPresentationFilters(
  events: EvidenceEvent[],
  configuredSources: ResolvedLogSourceState[],
): void {
  for (const event of events) {
    const config = configuredSources.find(
      (candidate) => candidate.id === event.sourceId,
    );
    if (isHidden(event.text, config)) {
      event.presentationHidden = true;
    }
  }
}

function isHidden(
  text: string,
  config: ResolvedLogSourceState | undefined,
): boolean {
  if (!config) {
    return false;
  }
  if (
    config.include &&
    config.include.length > 0 &&
    !config.include.some((pattern) => text.includes(pattern))
  ) {
    return true;
  }
  return Boolean(config.exclude?.some((pattern) => text.includes(pattern)));
}

function inspectScreenshots(
  sessionDir: string,
  actions: SessionLogEntry[],
): ScreenshotIntegrity[] {
  const files = [
    ...new Set(
      actions
        .filter((action) => action.outcome === 'passed')
        .map((action) => action.action.match(/^screenshot\s+(.+)$/)?.[1])
        .filter((value): value is string => Boolean(value))
        .map((value) => path.basename(value)),
    ),
  ];
  return files
    .map((file) => {
      const filePath = path.join(sessionDir, file);
      const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      if (size > 50 * 1024 * 1024) {
        return {
          file,
          sha256: null,
          validPng: false,
          visuallyBlank: false,
          size,
        };
      }
      const contents = size > 0 ? fs.readFileSync(filePath) : Buffer.alloc(0);
      const integrity = inspectPng(contents);
      return {
        file,
        sha256: createHash('sha256').update(contents).digest('hex'),
        validPng: integrity.valid,
        visuallyBlank: integrity.visuallyBlank,
        size,
      };
    });
}

function inspectPng(contents: Buffer): {
  valid: boolean;
  visuallyBlank: boolean;
} {
  if (
    contents.length < 33 ||
    !contents
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    contents.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    return { valid: false, visuallyBlank: false };
  }
  const width = contents.readUInt32BE(16);
  const height = contents.readUInt32BE(20);
  if (width <= 0 || height <= 0 || width * height > 20_000_000) {
    return { valid: false, visuallyBlank: false };
  }
  try {
    const decoded = PNG.sync.read(contents, { checkCRC: true });
    const spans = [
      { minimum: 255, maximum: 0 },
      { minimum: 255, maximum: 0 },
      { minimum: 255, maximum: 0 },
      { minimum: 255, maximum: 0 },
    ];
    const pixelCount = decoded.width * decoded.height;
    const sampleStep = Math.max(1, Math.floor(pixelCount / 10_000));
    for (let pixel = 0; pixel < pixelCount; pixel += sampleStep) {
      const offset = pixel * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = decoded.data[offset + channel];
        spans[channel].minimum = Math.min(spans[channel].minimum, value);
        spans[channel].maximum = Math.max(spans[channel].maximum, value);
      }
    }
    return {
      valid: true,
      visuallyBlank: spans.every(
        ({ minimum, maximum }) => maximum - minimum <= 3,
      ),
    };
  } catch {
    return { valid: false, visuallyBlank: false };
  }
}

function buildVerdict(
  options: EvidenceBuildOptions,
  evidence: CanonicalEvidence,
): Verdict {
  const missingArtifacts: string[] = [];
  if (options.networkEvidenceRequired && !options.networkSummary) {
    missingArtifacts.push('network-summary.json');
  }
  if (options.recordingWasActive && !fs.existsSync(options.videoPath)) {
    missingArtifacts.push(path.basename(options.videoPath));
  } else if (
    options.recordingWasActive &&
    (evidence.mediaDurationSec === null || evidence.mediaDurationSec <= 0)
  ) {
    missingArtifacts.push(path.basename(options.videoPath));
  }
  const screenshotFiles = new Set(
    evidence.screenshots.map((screenshot) => screenshot.file),
  );
  const successfulScreenshotPaths = options.actions
    .filter((action) => action.outcome === 'passed')
    .map((action) => action.action.match(/^screenshot\s+(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => path.basename(value));
  const reusedScreenshotPaths =
    successfulScreenshotPaths.length - new Set(successfulScreenshotPaths).size;
  for (const action of options.actions) {
    const match = action.action.match(/^screenshot\s+(.+)$/);
    if (match && !screenshotFiles.has(path.basename(match[1]))) {
      missingArtifacts.push(path.basename(match[1]));
    }
  }
  for (const screenshot of evidence.screenshots) {
    if (
      !screenshot.validPng ||
      screenshot.visuallyBlank ||
      screenshot.size === 0
    ) {
      missingArtifacts.push(screenshot.file);
    }
  }

  const hashes = new Map<string, string[]>();
  for (const screenshot of evidence.screenshots) {
    if (screenshot.sha256 && screenshot.validPng) {
      const files = hashes.get(screenshot.sha256) || [];
      files.push(screenshot.file);
      hashes.set(screenshot.sha256, files);
    }
  }
  const duplicateScreenshotHashes = [...hashes.values()].filter(
    (files) => files.length > 1,
  );
  const expectedSelectorFailures = options.actions
    .filter(
      (action) =>
        action.expectedSelector && action.outcome === 'failed',
    )
    .map((action) => action.expectedSelector!);
  const pendingActions = options.actions.filter(
    (action) => action.outcome === undefined,
  );
  const passedAssertions = options.actions.filter(
    (action) => action.expectedSelector && action.outcome === 'passed',
  );
  const hasSyntheticDomMutation = options.actions.some(
    (action) =>
      action.category === 'synthetic-dom' || /^eval\b/i.test(action.action),
  );
  const fatalIncidentCount = evidence.incidents.filter(
    (incident) => incident.severity === 'fatal',
  ).length;
  const nonfatalIncidentCount = evidence.incidents.filter(
    (incident) => incident.severity === 'error',
  ).length;
  const failedNetworkRequestCount = (evidence.network?.requests || []).filter(
    (request) =>
      request.error != null || request.status === 0 || request.status >= 400,
  ).length;
  const browserErrorCount = evidence.browserErrorCount ?? 0;
  const blockingReasons = options.consoleEvidenceAvailable
    ? []
    : ['Browser console evidence was unavailable.'];
  const failureReasons = [
    ...(fatalIncidentCount > 0
      ? [`${fatalIncidentCount} fatal incident(s) detected.`]
      : []),
    ...(expectedSelectorFailures.length > 0
      ? [`${expectedSelectorFailures.length} expected selector assertion(s) failed.`]
      : []),
  ];
  const incompleteReasons = [
    ...(missingArtifacts.length > 0
      ? [`${missingArtifacts.length} required artifact(s) were missing or invalid.`]
      : []),
    ...(evidence.mediaTruncated
      ? ['Recorded media ends before the canonical action timeline.']
      : []),
    ...(evidence.sources.some((source) => source.truncationCount > 0)
      ? ['One or more evidence sources were truncated.']
      : []),
    ...(duplicateScreenshotHashes.length > 0
      ? ['Duplicate key-frame screenshot hashes were detected.']
      : []),
    ...(nonfatalIncidentCount > 0
      ? [`${nonfatalIncidentCount} nonfatal incident(s) detected.`]
      : []),
    ...(failedNetworkRequestCount > 0
      ? [`${failedNetworkRequestCount} failed network request(s) detected.`]
      : []),
    ...(browserErrorCount > 0
      ? [`${browserErrorCount} uncaught browser error(s) detected.`]
      : []),
    ...(pendingActions.length > 0
      ? [
          `${pendingActions.length} browser action(s) had no recorded outcome.`,
        ]
      : []),
    ...(passedAssertions.length === 0 &&
    expectedSelectorFailures.length === 0 &&
    fatalIncidentCount === 0
      ? ['No explicit behavioral assertion passed.']
      : []),
    ...(reusedScreenshotPaths > 0
      ? ['One or more screenshot paths were reused by multiple actions.']
      : []),
    ...(hasSyntheticDomMutation
      ? [
          'Synthetic DOM mutation is diagnostic-only and cannot serve as final behavioral proof.',
        ]
      : []),
  ];
  const status: VerdictStatus =
    blockingReasons.length > 0
      ? 'BLOCKED'
      : incompleteReasons.length > 0
        ? 'INCOMPLETE'
        : failureReasons.length > 0
          ? 'FAIL'
          : 'PASS';
  return {
    version: 1,
    status,
    reasons: [...blockingReasons, ...failureReasons, ...incompleteReasons],
    fatalIncidentCount,
    missingArtifacts: [...new Set(missingArtifacts)],
    duplicateScreenshotHashes,
    expectedSelectorFailures,
    mediaTruncated: evidence.mediaTruncated,
  };
}

export function probeMediaDuration(videoPath: string): number | null {
  if (!fs.existsSync(videoPath)) {
    return null;
  }
  try {
    const output = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=start_time,duration',
        '-of',
        'json',
        videoPath,
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    const parsed = JSON.parse(output) as {
      format?: {
        start_time?: string;
        duration?: string;
      };
    };
    const startTime = Number(parsed.format?.start_time || 0);
    const duration = Number(parsed.format?.duration);
    const playableDuration = duration - startTime;
    return Number.isFinite(playableDuration) && playableDuration >= 0
      ? playableDuration
      : null;
  } catch {
    return null;
  }
}
