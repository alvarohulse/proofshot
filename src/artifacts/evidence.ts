import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import type { SessionLogEntry } from '../commands/exec.js';
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
  actions: SessionLogEntry[];
  events: EvidenceEvent[];
  sources: EvidenceSourceSummary[];
  incidents: EvidenceIncident[];
  screenshots: ScreenshotIntegrity[];
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
  durationSec: number;
  videoPath: string;
  recordingWasActive: boolean;
  consoleEvidenceAvailable: boolean;
  actions: SessionLogEntry[];
  consoleEntries: TimestampedLogEntry[];
  serverEntries: TimestampedLogEntry[];
  environment?: EnvironmentState | null;
};

export function writeCanonicalEvidence(
  options: EvidenceBuildOptions,
): { evidence: CanonicalEvidence; verdict: Verdict } {
  const events = collectEvents(options);
  applyPresentationFilters(events, options.environment?.sources || []);
  const incidents = buildIncidents(events);
  const screenshots = inspectScreenshots(options.sessionDir);
  const mediaDurationSec = probeMediaDuration(options.videoPath);
  const actionDuration = options.actions
    .map((entry) => entry.relativeTimeSec)
    .filter(Number.isFinite)
    .reduce((maximum, current) => Math.max(maximum, current), 0);
  const timelineDurationSec = Math.max(options.durationSec, actionDuration);
  const mediaDivergenceSec =
    mediaDurationSec === null ? null : timelineDurationSec - mediaDurationSec;
  const mediaTruncated =
    mediaDivergenceSec !== null && mediaDivergenceSec > 1;
  const sources = buildSourceSummaries(
    events,
    incidents,
  );
  const evidence: CanonicalEvidence = {
    version: 1,
    sessionId: options.sessionId,
    generatedAt: new Date().toISOString(),
    timelineDurationSec,
    mediaDurationSec,
    mediaDivergenceSec,
    mediaTruncated,
    actions: options.actions,
    events,
    sources,
    incidents,
    screenshots,
  };
  const verdict = buildVerdict(options, evidence);
  fs.writeFileSync(
    path.join(options.sessionDir, 'evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(options.sessionDir, 'verdict.json'),
    JSON.stringify(verdict, null, 2) + '\n',
  );
  return { evidence, verdict };
}

function collectEvents(options: EvidenceBuildOptions): EvidenceEvent[] {
  const environmentEvents =
    options.environment?.evidencePath &&
    fs.existsSync(options.environment.evidencePath)
      ? loadEvidenceEvents(options.environment.evidencePath)
      : [];
  if (environmentEvents.length === 0) {
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
  }

  const navigations = buildNavigations(options.actions);
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
): Array<{ id: string; url: string; startTimeSec: number }> {
  const navigations = actions
    .map((entry) => {
      const match = entry.action.match(/^(?:open|navigate)\s+(\S+)/i);
      return match && Number.isFinite(entry.relativeTimeSec)
        ? { url: match[1], startTimeSec: entry.relativeTimeSec }
        : null;
    })
    .filter(
      (
        navigation,
      ): navigation is { url: string; startTimeSec: number } =>
        navigation !== null,
    )
    .map((navigation, index) => ({
      id: `browser-nav-${index + 1}`,
      ...navigation,
    }));
  return navigations.length > 0
    ? navigations
    : [{ id: 'browser-nav-1', url: 'Browser', startTimeSec: 0 }];
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
    const key = `${event.group}\0${severity}\0${message}`;
    const incident = incidents.get(key) || {
      severity,
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
  if (/\bFATAL\b|\bpanic:|uncaught exception|unhandled rejection/i.test(text)) {
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
    const existing = sourceKeys.get(event.sourceId) || {
      title: event.sourceTitle,
      origin: event.origin,
      group: event.group,
      events: [],
    };
    existing.events.push(event);
    sourceKeys.set(event.sourceId, existing);
  }

  return [...sourceKeys.entries()].map(([id, source]) => {
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
      incidentCount: incidents.filter((incident) =>
        incident.sourceIds.includes(id),
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

function inspectScreenshots(sessionDir: string): ScreenshotIntegrity[] {
  return fs
    .readdirSync(sessionDir)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => {
      const contents = fs.readFileSync(path.join(sessionDir, file));
      const validPng = isValidPng(contents);
      return {
        file,
        sha256: createHash('sha256').update(contents).digest('hex'),
        validPng,
        size: contents.length,
      };
    });
}

function isValidPng(contents: Buffer): boolean {
  if (
    contents.length < 33 ||
    !contents
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    contents.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    return false;
  }
  return contents.includes(Buffer.from('IEND', 'ascii'), contents.length - 16);
}

function buildVerdict(
  options: EvidenceBuildOptions,
  evidence: CanonicalEvidence,
): Verdict {
  const missingArtifacts: string[] = [];
  if (options.recordingWasActive && !fs.existsSync(options.videoPath)) {
    missingArtifacts.push(path.basename(options.videoPath));
  }
  const screenshotFiles = new Set(
    evidence.screenshots.map((screenshot) => screenshot.file),
  );
  for (const action of options.actions) {
    const match = action.action.match(/^screenshot\s+(.+)$/);
    if (match && !screenshotFiles.has(path.basename(match[1]))) {
      missingArtifacts.push(path.basename(match[1]));
    }
  }
  for (const screenshot of evidence.screenshots) {
    if (!screenshot.validPng || screenshot.size === 0) {
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
  const fatalIncidentCount = evidence.incidents.filter(
    (incident) => incident.severity === 'fatal',
  ).length;
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
    ...(duplicateScreenshotHashes.length > 0
      ? ['Duplicate key-frame screenshot hashes were detected.']
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
  ];
  const status: VerdictStatus =
    blockingReasons.length > 0
      ? 'BLOCKED'
      : failureReasons.length > 0
        ? 'FAIL'
        : incompleteReasons.length > 0
          ? 'INCOMPLETE'
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

function probeMediaDuration(videoPath: string): number | null {
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
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    const duration = Number(output);
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}
