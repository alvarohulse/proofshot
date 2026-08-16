import * as fs from 'fs';
import * as path from 'path';
import type { SessionLogEntry } from '../session/action-log.js';
import type {
  CanonicalEvidence,
  EvidenceSourceSummary,
  Verdict,
} from './evidence.js';
import type { EvidenceEvent } from '../environment/types.js';
import { normalizeViewport, type ViewportConfig } from '../utils/config.js';

export interface TimestampedLogEntry {
  text: string;
  relativeTimeSec: number;
}

interface ViewerData {
  description: string | null;
  serverCommand: string | null;
  durationSec: number;
  videoFilename: string | null;
  viewport?: ViewportConfig;
  entries: SessionLogEntry[];
  consoleErrorCount: number;
  consoleEvidenceAvailable?: boolean;
  serverErrorCount: number;
  consoleOutput?: string;
  serverLog?: string;
  consoleEntries?: TimestampedLogEntry[];
  serverEntries?: TimestampedLogEntry[];
  evidence?: CanonicalEvidence;
  verdict?: Verdict;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    source: string;
  } | null;
}

/** Maximum log size embedded in the viewer HTML (50 KB). */
const MAX_LOG_BYTES = 50 * 1024;

function truncateLog(log: string, maxBytes: number): { text: string; truncated: boolean } {
  if (log.length <= maxBytes) return { text: log, truncated: false };
  const cut = log.slice(0, maxBytes);
  const lastNl = cut.lastIndexOf('\n');
  return { text: lastNl > 0 ? cut.slice(0, lastNl) : cut, truncated: true };
}

/** Simple error-line detector for log highlighting. */
function isErrorLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /\bError:|ERR[_!]|FATAL\b|CRITICAL\b|panic:|Exception:|Traceback/i.test(t);
}

/** Build line-numbered HTML from raw log text, with error lines highlighted. */
function buildLogLines(text: string): string {
  if (!text.trim()) return '';
  return text
    .split('\n')
    .map((line, i) => {
      const num = i + 1;
      const cls = isErrorLine(line) ? 'log-line log-line-error' : 'log-line';
      return `<span class="${cls}"><span class="log-ln">${num}</span>${escapeHtml(line)}</span>`;
    })
    .join('\n');
}

/** Maximum number of log entries embedded in the viewer to avoid DOM bloat. */
const MAX_LOG_ENTRIES = 2000;

/** Build timestamped log lines with data-time attributes for video sync. */
function buildTimestampedLogLines(entries: TimestampedLogEntry[]): { html: string; truncated: boolean } {
  if (entries.length === 0) return { html: '', truncated: false };
  const truncated = entries.length > MAX_LOG_ENTRIES;
  const capped = truncated ? entries.slice(0, MAX_LOG_ENTRIES) : entries;
  const html = capped
    .map((entry, i) => {
      const num = i + 1;
      const cls = isErrorLine(entry.text) ? 'log-line log-line-error' : 'log-line';
      const timed = Number.isFinite(entry.relativeTimeSec);
      const time = formatTime(timed ? Math.max(0, entry.relativeTimeSec) : Number.NaN);
      const interaction = timed
        ? ` data-time="${entry.relativeTimeSec}" onclick="seekTo(${entry.relativeTimeSec})"`
        : '';
      return `<span class="${cls}"${interaction}><span class="log-time">${time}</span><span class="log-ln">${num}</span>${escapeHtml(entry.text)}</span>`;
    })
    .join('\n');
  return { html, truncated };
}

/**
 * Map an action string to an icon character for the timeline.
 */
function getActionIcon(action: string): string {
  const cmd = action.split(' ')[0].toLowerCase();
  switch (cmd) {
    case 'open':
    case 'navigate':
      return '\u{1F9ED}'; // compass
    case 'click':
      return '\u{1F5B1}'; // mouse
    case 'fill':
    case 'type':
      return '\u2328'; // keyboard
    case 'screenshot':
      return '\u{1F4F7}'; // camera
    case 'snapshot':
      return '\u{1F441}'; // eye
    case 'scroll':
      return '\u2195'; // scroll arrows
    case 'press':
      return '\u2318'; // key
    default:
      return '\u25B6'; // play
  }
}

/**
 * Format seconds as m:ss string.
 */
function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) {
    return 'untimed';
  }
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

type EvidencePanel = {
  key: string;
  label: string;
  summary: EvidenceSourceSummary | null;
  events: EvidenceEvent[];
};

function buildEvidencePanels(evidence: CanonicalEvidence): EvidencePanel[] {
  const panels: EvidencePanel[] = [];
  for (const origin of ['environment', 'browser'] as const) {
    const originEvents = evidence.events.filter(
      (event) => event.origin === origin && !event.presentationHidden,
    );
    if (originEvents.length === 0) {
      continue;
    }
    const originLabel = origin === 'environment' ? 'Environment' : 'Browser';
    panels.push({
      key: origin,
      label: originLabel,
      summary: null,
      events: orderEvidenceEvents(originEvents),
    });
    const sources = evidence.sources
      .filter((source) => source.origin === origin)
      .sort(
        (left, right) =>
          left.group.localeCompare(right.group) ||
          left.title.localeCompare(right.title),
      );
    for (const source of sources) {
      panels.push({
        key: `${origin}-${source.id}`,
        label:
          origin === 'environment'
            ? `${titleCase(source.group)} · ${source.title}`
            : source.title,
        summary: source,
        events: orderEvidenceEvents(
          originEvents.filter((event) => event.sourceId === source.id),
        ),
      });
    }
  }
  return panels;
}

function orderEvidenceEvents(events: EvidenceEvent[]): EvidenceEvent[] {
  return [...events].sort((left, right) => {
    if (left.segment !== right.segment) {
      return left.segment === 'history' ? -1 : 1;
    }
    if (left.relativeTimeSec === null) {
      return -1;
    }
    if (right.relativeTimeSec === null) {
      return 1;
    }
    return left.relativeTimeSec - right.relativeTimeSec;
  });
}

function buildEvidenceLogLines(events: EvidenceEvent[]): string {
  if (events.length === 0) {
    return '<p class="log-empty">No visible evidence for this source</p>';
  }
  return `<pre class="log-pre">${events
    .slice(0, MAX_LOG_ENTRIES)
    .map((event, index) => {
      const timed =
        event.relativeTimeSec !== null &&
        Number.isFinite(event.relativeTimeSec);
      const classes = [
        'log-line',
        isErrorLine(event.text) ? 'log-line-error' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const interaction = timed
        ? ` data-time="${event.relativeTimeSec}" onclick="seekTo(${event.relativeTimeSec})"`
        : '';
      const boundary = event.captureGap
        ? '<span class="log-boundary">capture gap</span>'
        : event.segment === 'history'
          ? '<span class="log-boundary">history</span>'
          : '';
      return `<span class="${classes}"${interaction}><span class="log-time">${formatTime(timed ? event.relativeTimeSec! : Number.NaN)}</span><span class="log-ln">${index + 1}</span>${boundary}${escapeHtml(event.text)}</span>`;
    })
    .join('\n')}</pre>${
    events.length > MAX_LOG_ENTRIES
      ? '<p class="log-truncated">Viewer display truncated. Canonical evidence.json retains the bounded source evidence.</p>'
      : ''
  }`;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serialize session log entries to a JSON string safe for embedding in HTML <script>.
 */
function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Generate a standalone HTML viewer file from session data.
 */
export function generateViewer(data: ViewerData): string {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const timelineDurationSec =
    data.evidence?.timelineDurationSec ?? data.durationSec;

  const stepsHtml = data.entries
    .map((entry, i) => {
      const icon = getActionIcon(entry.action);
      const time = formatTime(entry.relativeTimeSec);
      const action = escapeHtml(entry.action);
      const timed = Number.isFinite(entry.relativeTimeSec);
      const interaction = timed
        ? ` data-time="${entry.relativeTimeSec}" onclick="seekTo(${entry.relativeTimeSec})"`
        : '';
      return `      <div class="step${timed ? '' : ' untimed'}"${interaction} data-index="${i}">
        <span class="step-number">${i + 1}</span>
        <span class="icon">${icon}</span>
        <div class="step-content">
          <span class="action">${action}</span>
        </div>
        <span class="time">${time}</span>
      </div>`;
    })
    .join('\n');

  const descriptionHtml = data.description
    ? `<p class="description" id="description"><span class="description-text">${escapeHtml(data.description)}</span><button class="show-more" id="showMoreBtn" style="display:none" onclick="toggleDescription()">Show more</button></p>`
    : '';

  const consoleEvidenceAvailable = data.consoleEvidenceAvailable !== false;
  const consoleBadgeClass = !consoleEvidenceAvailable
    ? 'unavailable'
    : data.consoleErrorCount === 0
      ? 'clean'
      : 'has-errors';
  const consoleBadgeText = !consoleEvidenceAvailable
    ? 'Console: unavailable'
    : data.consoleErrorCount === 0
      ? 'Console: clean'
      : `Console: ${data.consoleErrorCount} error(s)`;

  const serverBadgeClass = data.serverErrorCount === 0 ? 'clean' : 'has-errors';
  const serverBadgeText =
    data.serverErrorCount === 0
      ? 'Server: clean'
      : `Server: ${data.serverErrorCount} error(s)`;

  const tokenUsageHtml = data.tokenUsage
    ? `<div class="token-usage">
      <div class="token-usage-title">Token Usage (Estimated)</div>
      <div class="token-usage-values">
        <span>In: ~${data.tokenUsage.inputTokens.toLocaleString()}</span>
        <span>Out: ~${data.tokenUsage.outputTokens.toLocaleString()}</span>
        <span>Total: ~${data.tokenUsage.totalTokens.toLocaleString()}</span>
        ${data.tokenUsage.estimatedCost > 0 ? `<span>Cost: ~$${data.tokenUsage.estimatedCost.toFixed(4)}</span>` : ''}
      </div>
      ${data.tokenUsage.source === 'estimated' ? '<div class="token-usage-note">Estimated from session activity</div>' : ''}
    </div>`
    : '';

  const hasVideo = !!data.videoFilename;
  // The recorded viewport is the only aspect-ratio source before metadata loads, so it feeds
  // the intrinsic `width`/`height` attributes, the `.video-fit` container ratio, and the
  // `recordedVideoSize` fallback used to fit the video. Without it the browser reserves the
  // 300x150 unloaded-media box; legacy sessions lack it and only fit once metadata arrives.
  const recordedViewport = normalizeViewport(data.viewport);
  const videoDimensions = recordedViewport
    ? ` width="${recordedViewport.width}" height="${recordedViewport.height}"`
    : '';
  const videoContainerAttributes = recordedViewport
    ? ` class="video-container video-fit" style="aspect-ratio: ${recordedViewport.width} / ${recordedViewport.height}"`
    : ' class="video-container"';
  const recordedVideoSizeJs = recordedViewport
    ? `{ width: ${recordedViewport.width}, height: ${recordedViewport.height} }`
    : 'null';

  // Build marker data for the scrub bar
  const markersJson = serializeInlineJson(
    data.entries
      .map((entry, i) => ({
        time: entry.relativeTimeSec,
        icon: getActionIcon(entry.action),
        action: entry.action,
        index: i,
      }))
      .filter((marker) => Number.isFinite(marker.time)),
  );

  const scrubBarHtml = hasVideo
    ? `<div class="scrub-bar">
        <div class="scrub-track" id="scrubTrack">
          <div class="scrub-progress" id="scrubProgress"></div>
          <div class="scrub-playhead" id="scrubPlayhead"></div>
          ${data.entries
            .filter((entry) => Number.isFinite(entry.relativeTimeSec))
            .map((entry, i) => {
              const pct =
                timelineDurationSec > 0
                  ? (entry.relativeTimeSec / timelineDurationSec) * 100
                  : 0;
              const icon = getActionIcon(entry.action);
              return `<div class="scrub-marker" data-index="${i}" data-time="${entry.relativeTimeSec}" style="left:${pct}%"><span class="scrub-marker-icon">${icon}</span></div>`;
            })
            .join('\n          ')}
        </div>
        <div class="scrub-tooltip" id="scrubTooltip"></div>
      </div>`
    : '';

  const videoPanelHtml = hasVideo
    ? `<div class="video-wrapper">
        <div${videoContainerAttributes}>
          <video src="./${escapeHtml(data.videoFilename!)}"${videoDimensions} controls></video>
          <div class="video-overlay"></div>
        </div>
        ${scrubBarHtml}
      </div>`
    : `<div class="no-video"><p>No video recorded</p><p class="no-video-hint">Screenshots are available in the timeline</p></div>`;

  const entriesJson = serializeInlineJson(data.entries);

  // Prepare log content for embedding — prefer timestamped entries for video sync
  let consoleLogBodyHtml: string;
  if (data.consoleEntries && data.consoleEntries.length > 0) {
    const built = buildTimestampedLogLines(data.consoleEntries);
    consoleLogBodyHtml = `<pre class="log-pre">${built.html}</pre>${built.truncated ? '<p class="log-truncated">Log truncated at 2000 entries. Raw output is retained privately.</p>' : ''}`;
  } else {
    const consoleTrunc = truncateLog(data.consoleOutput ?? '', MAX_LOG_BYTES);
    const consoleLogLines = buildLogLines(consoleTrunc.text);
    consoleLogBodyHtml = consoleLogLines
      ? `<pre class="log-pre">${consoleLogLines}</pre>${consoleTrunc.truncated ? '<p class="log-truncated">Log truncated at 50 KB. Raw output is retained privately.</p>' : ''}`
      : '<p class="log-empty">No console output captured</p>';
  }

  let serverLogBodyHtml: string;
  if (data.serverEntries && data.serverEntries.length > 0) {
    const built = buildTimestampedLogLines(data.serverEntries);
    serverLogBodyHtml = `<pre class="log-pre">${built.html}</pre>${built.truncated ? '<p class="log-truncated">Log truncated at 2000 entries. Raw output is retained privately.</p>' : ''}`;
  } else {
    const serverTrunc = truncateLog(data.serverLog ?? '', MAX_LOG_BYTES);
    const serverLogLines = buildLogLines(serverTrunc.text);
    serverLogBodyHtml = serverLogLines
      ? `<pre class="log-pre">${serverLogLines}</pre>${serverTrunc.truncated ? '<p class="log-truncated">Log truncated at 50 KB. Raw output is retained privately.</p>' : ''}`
      : '<p class="log-empty">No server log captured</p>';
  }

  // Compute line counts for tab badges
  const consoleLineCount =
    data.consoleEntries && data.consoleEntries.length > 0
      ? data.consoleEntries.length
      : (data.consoleOutput ?? '').split('\n').filter((l) => l.trim()).length;
  const serverLineCount =
    data.serverEntries && data.serverEntries.length > 0
      ? data.serverEntries.length
      : (data.serverLog ?? '').split('\n').filter((l) => l.trim()).length;
  const evidencePanels = data.evidence
    ? buildEvidencePanels(data.evidence)
    : [];
  const evidenceTabsHtml = evidencePanels
    .map(
      (panel, index) =>
        `<button class="panel-tab" data-tab="evidence-${index}" onclick="switchTab('evidence-${index}')">${escapeHtml(panel.label)} &middot; ${panel.events.length}</button>`,
    )
    .join('\n        ');
  const evidenceContentsHtml = evidencePanels
    .map((panel, index) => {
      const sourceIds = new Set(panel.events.map((event) => event.sourceId));
      const incidents =
        data.evidence?.incidents.filter((incident) =>
          incident.sourceIds.some((sourceId) => sourceIds.has(sourceId)),
        ) || [];
      const summary = panel.summary;
      const status = summary
        ? `${summary.hiddenLineCount} hidden · ${summary.truncationCount} truncated · ${summary.captureGapCount} capture gap(s)`
        : `${incidents.length} grouped incident(s)`;
      const incidentsHtml =
        incidents.length > 0
          ? `<div class="incident-list">${incidents
              .map(
                (incident) =>
                  `<div class="incident ${incident.severity}"><strong>${incident.severity.toUpperCase()} × ${incident.count}</strong> ${escapeHtml(incident.message)}</div>`,
              )
              .join('')}</div>`
          : '';
      return `<div id="tab-evidence-${index}" class="panel-content" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status"><span>${escapeHtml(status)}</span></div>
          ${incidentsHtml}
          ${buildEvidenceLogLines(panel.events)}
        </div>
      </div>`;
    })
    .join('\n      ');
  const environmentTabIndex = evidencePanels.findIndex(
    (panel) => panel.key === 'environment',
  );
  const browserTabIndex = evidencePanels.findIndex(
    (panel) => panel.key === 'browser',
  );
  const canonicalTabs = evidencePanels.length > 0;
  const verdictStatus = data.verdict?.status || 'INCOMPLETE';
  const verdictBadgeClass =
    verdictStatus === 'PASS'
      ? 'clean'
      : verdictStatus === 'FAIL'
        ? 'has-errors'
        : 'unavailable';
  const mediaWarningHtml = data.evidence?.mediaTruncated
    ? `<div class="media-warning">Media ends ${Math.max(0, data.evidence.mediaDivergenceSec || 0).toFixed(1)}s before the canonical action timeline. Timeline events remain authoritative; seeks clamp to available media.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ProofShot — Verification Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .header {
      flex: 0 0 auto;
      max-height: 50%;
      overflow-y: auto;
      padding: 24px 32px;
      border-bottom: 1px solid #21262d;
      background: #161b22;
    }

    .header h1 {
      font-size: 20px;
      font-weight: 600;
      color: #f0f6fc;
      margin-bottom: 8px;
    }

    .header .description {
      font-size: 14px;
      color: #8b949e;
      margin-bottom: 6px;
    }

    .header .description.clamped .description-text {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .header .description .show-more {
      background: none;
      border: none;
      color: #58a6ff;
      font-size: 12px;
      cursor: pointer;
      padding: 0;
      margin-top: 4px;
      display: block;
    }

    .header .description .show-more:hover {
      text-decoration: underline;
    }

    .header .meta {
      font-size: 12px;
      color: #484f58;
    }

    /* Overlay toggle controls */
    .overlay-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      position: relative;
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      font-size: 12px;
    }

    .overlay-toggle .tooltip {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 6px;
      background: #1c2128;
      color: #c9d1d9;
      font-size: 11px;
      padding: 6px 10px;
      border-radius: 6px;
      white-space: nowrap;
      pointer-events: none;
      border: 1px solid #30363d;
      z-index: 10;
    }

    .overlay-toggle:hover .tooltip {
      display: block;
    }

    .overlay-toggle input[type="checkbox"] {
      display: none;
    }

    .toggle-track {
      position: relative;
      width: 34px;
      height: 18px;
      background: #30363d;
      border-radius: 9px;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    .toggle-track::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      background: #8b949e;
      border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }

    .overlay-toggle input:checked + .toggle-track {
      background: #1f6feb;
    }

    .overlay-toggle input:checked + .toggle-track::after {
      transform: translateX(16px);
      background: #fff;
    }

    .error-badges {
      display: flex;
      gap: 12px;
      margin-top: 10px;
    }

    .token-usage {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #30363d;
      border-radius: 8px;
      background: #0d1117;
      max-width: fit-content;
    }

    .token-usage-title {
      font-size: 12px;
      color: #f0f6fc;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .token-usage-values {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 12px;
      color: #8b949e;
      font-variant-numeric: tabular-nums;
    }

    .token-usage-note {
      margin-top: 6px;
      font-size: 11px;
      color: #6e7681;
    }

    .error-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      font-family: inherit;
      line-height: inherit;
    }

    .error-badge:hover {
      opacity: 0.85;
      transform: translateY(-1px);
    }

    .error-badge.clean {
      background: rgba(63, 185, 80, 0.12);
      color: #3fb950;
      border: 1px solid rgba(63, 185, 80, 0.25);
    }

    .error-badge.has-errors {
      background: rgba(248, 81, 73, 0.12);
      color: #f85149;
      border: 1px solid rgba(248, 81, 73, 0.25);
    }

    .error-badge.unavailable {
      background: rgba(210, 153, 34, 0.12);
      color: #d29922;
      border: 1px solid rgba(210, 153, 34, 0.25);
    }

    .error-badge .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .error-badge.clean .badge-dot {
      background: #3fb950;
    }

    .error-badge.has-errors .badge-dot {
      background: #f85149;
    }

    .error-badge.unavailable .badge-dot {
      background: #d29922;
    }

    .viewer {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
    }

    .video-panel {
      flex: 0 0 62%;
      padding: 16px;
      display: flex;
      align-items: stretch;
      justify-content: center;
      background: #0d1117;
      overflow: hidden;
    }

    .video-wrapper {
      width: 100%;
      max-width: 100%;
      height: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .video-container {
      position: relative;
      width: 100%;
    }

    .video-container.video-fit {
      flex: 0 0 auto;
      min-height: 0;
      width: 100%;
    }

    .video-container video {
      width: 100%;
      height: auto;
      border-radius: 8px 8px 0 0;
      background: #000;
      display: block;
    }

    .video-container.video-fit video {
      width: 100%;
      height: 100%;
    }

    .video-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      border-radius: 8px 8px 0 0;
    }

    /* Scrub bar */
    .scrub-bar {
      position: relative;
      flex: 0 0 auto;
      width: 100%;
      padding: 8px 0 6px;
      background: #161b22;
      border-radius: 0 0 8px 8px;
      border-top: 1px solid #21262d;
    }

    .scrub-track {
      position: relative;
      height: 6px;
      background: #21262d;
      border-radius: 3px;
      margin: 0 16px;
      cursor: pointer;
    }

    .scrub-track:hover {
      height: 8px;
      margin-top: -1px;
    }

    .scrub-progress {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: #58a6ff;
      border-radius: 3px;
      pointer-events: none;
      transition: width 0.1s linear;
    }

    .scrub-playhead {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      background: #f0f6fc;
      border: 2px solid #58a6ff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 3;
      box-shadow: 0 0 4px rgba(0,0,0,0.4);
      transition: left 0.1s linear;
    }

    .scrub-marker {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 2;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .scrub-marker-icon {
      font-size: 14px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #21262d;
      border: 1.5px solid #30363d;
      border-radius: 50%;
      transition: all 0.15s;
    }

    .scrub-marker:hover .scrub-marker-icon,
    .scrub-marker.active .scrub-marker-icon {
      background: #1f2a37;
      border-color: #58a6ff;
      transform: scale(1.25);
    }

    .scrub-tooltip {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 8px;
      padding: 6px 10px;
      background: #1c2128;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 12px;
      color: #c9d1d9;
      white-space: nowrap;
      pointer-events: none;
      z-index: 20;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }

    .scrub-tooltip .tooltip-icon {
      margin-right: 4px;
    }

    .scrub-tooltip .tooltip-time {
      color: #58a6ff;
      margin-left: 6px;
      font-variant-numeric: tabular-nums;
    }

    .no-video {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 300px;
      border: 1px dashed #30363d;
      border-radius: 8px;
      color: #484f58;
      font-size: 15px;
    }

    .no-video-hint {
      font-size: 12px;
      margin-top: 8px;
      color: #30363d;
    }

    .timeline-panel {
      flex: 0 0 38%;
      border-left: 1px solid #21262d;
      overflow-y: auto;
      background: #161b22;
    }

    /* Tab bar */
    .panel-tabs {
      display: flex;
      align-items: center;
      padding: 0 12px;
      border-bottom: 1px solid #21262d;
      position: sticky;
      top: 0;
      background: #161b22;
      z-index: 10;
      gap: 0;
      overflow-x: auto;
    }

    .panel-tab {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #8b949e;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 16px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
      font-family: inherit;
    }

    .panel-tab:hover { color: #c9d1d9; }
    .panel-tab.active { color: #f0f6fc; border-bottom-color: #58a6ff; }

    .panel-tab-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
    }

    /* Log tab content */
    .log-tab-content {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .log-tab-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid #21262d;
      font-size: 12px;
    }

    .log-pre {
      margin: 0;
      padding: 12px 16px;
      background: #0d1117;
      font-family: 'SF Mono', SFMono-Regular, 'Consolas', 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #c9d1d9;
      overflow-x: auto;
      white-space: pre;
      flex: 1;
      overflow-y: auto;
    }

    .log-pre::-webkit-scrollbar { width: 6px; height: 6px; }
    .log-pre::-webkit-scrollbar-track { background: transparent; }
    .log-pre::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .log-pre::-webkit-scrollbar-thumb:hover { background: #484f58; }

    .log-line { display: block; }
    .log-line[data-time] { cursor: pointer; transition: background 0.15s; padding: 0 4px; margin: 0 -4px; border-radius: 2px; }
    .log-line[data-time]:hover { background: rgba(88, 166, 255, 0.08); }
    .log-line.active { background: #1f2a37; border-left: 3px solid #58a6ff; padding-left: 1px; }
    .log-line.active .log-time { color: #58a6ff; }

    .log-time {
      display: inline-block;
      min-width: 36px;
      padding-right: 8px;
      text-align: right;
      color: #484f58;
      user-select: none;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
    }

    .log-ln {
      display: inline-block;
      min-width: 40px;
      padding-right: 12px;
      text-align: right;
      color: #484f58;
      user-select: none;
      font-variant-numeric: tabular-nums;
    }

    .log-line-error { background: rgba(248, 81, 73, 0.1); color: #f85149; }
    .log-line-error .log-ln { color: rgba(248, 81, 73, 0.5); }
    .log-line-error .log-time { color: rgba(248, 81, 73, 0.5); }
    .log-boundary {
      display: inline-block;
      margin-right: 8px;
      padding: 0 5px;
      border: 1px solid #30363d;
      border-radius: 8px;
      color: #8b949e;
      font-size: 10px;
    }
    .incident-list { padding: 8px 16px; border-bottom: 1px solid #21262d; }
    .incident { padding: 5px 0; font-size: 12px; color: #d29922; }
    .incident.fatal { color: #f85149; }
    .media-warning {
      padding: 8px 16px;
      border-bottom: 1px solid #9e6a03;
      background: rgba(187, 128, 9, 0.12);
      color: #d29922;
      font-size: 12px;
    }

    .log-empty {
      padding: 32px 16px;
      text-align: center;
      color: #484f58;
      font-size: 13px;
      font-style: italic;
    }

    .log-truncated {
      padding: 8px 16px;
      font-size: 11px;
      color: #484f58;
      font-style: italic;
      border-top: 1px solid #21262d;
      background: #161b22;
    }

    .step {
      display: flex;
      align-items: center;
      padding: 10px 20px;
      cursor: pointer;
      border-bottom: 1px solid #21262d;
      transition: background 0.15s;
      gap: 10px;
    }

    .step:hover {
      background: #1c2128;
    }
    .step.untimed { cursor: default; }

    .step.active {
      background: #1f2a37;
      border-left: 3px solid #58a6ff;
      padding-left: 17px;
    }

    .step-number {
      font-size: 11px;
      color: #484f58;
      min-width: 20px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .icon {
      font-size: 16px;
      min-width: 24px;
      text-align: center;
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }

    .action {
      font-size: 13px;
      font-family: 'SF Mono', SFMono-Regular, 'Consolas', 'Liberation Mono', Menlo, monospace;
      color: #c9d1d9;
      word-break: break-all;
    }

    .step.active .action {
      color: #f0f6fc;
    }

    .time {
      font-size: 12px;
      color: #484f58;
      font-variant-numeric: tabular-nums;
      min-width: 36px;
      text-align: right;
    }

    .step.active .time {
      color: #58a6ff;
    }


    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: #484f58;
      font-size: 14px;
    }

    /* Overlay animations */
    .ripple {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      animation: ripple-expand 600ms ease-out forwards;
    }

    @keyframes ripple-expand {
      0%   { width: 12px; height: 12px; opacity: 0.7; }
      100% { width: 60px; height: 60px; opacity: 0; }
    }

    .ripple-click  { background: rgba(56, 132, 255, 0.5); }
    .ripple-fill   { background: rgba(255, 152, 56, 0.5); }

    .scroll-indicator {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 32px;
      opacity: 0.6;
      pointer-events: none;
      animation: fade-out 800ms ease-out forwards;
    }

    @keyframes fade-out {
      0%   { opacity: 0.6; }
      100% { opacity: 0; }
    }

    .toast {
      position: absolute;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 500;
      pointer-events: none;
      animation: toast-in 200ms ease-out;
      white-space: nowrap;
      letter-spacing: 0.2px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    @keyframes toast-in {
      0%   { opacity: 0; transform: translateX(-50%) translateY(8px); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* Scrollbar styling */
    .timeline-panel::-webkit-scrollbar { width: 6px; }
    .timeline-panel::-webkit-scrollbar-track { background: transparent; }
    .timeline-panel::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .timeline-panel::-webkit-scrollbar-thumb:hover { background: #484f58; }

    @media (max-width: 768px) {
      body {
        height: auto;
        min-height: 100vh;
        display: block;
        overflow: auto;
      }
      .viewer {
        flex-direction: column;
        height: auto;
      }
      .video-wrapper {
        height: auto;
      }
      .video-container.video-fit {
        flex: none;
        width: 100%;
      }
      .video-container.video-fit video {
        height: auto;
      }
      .video-panel, .timeline-panel {
        flex: none;
        width: 100%;
      }
      .timeline-panel {
        border-left: none;
        border-top: 1px solid #21262d;
        max-height: 50vh;
      }
      .error-badges {
        flex-wrap: wrap;
      }
      .log-pre {
        max-height: 50vh;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width:24px;height:24px;vertical-align:middle;margin-right:8px"><path d="M8,24 L8,12 C8,8 12,8 12,8 L24,8" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M40,8 L52,8 C56,8 56,12 56,12 L56,24" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8,40 L8,52 C8,56 12,56 12,56 L24,56" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M40,56 L52,56 C56,56 56,52 56,52 L56,40" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20,34 L28,42 L44,22" fill="none" stroke="#22D3EE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>ProofShot Verification</h1>
    ${descriptionHtml}
    <p class="meta">${escapeHtml(date)} &middot; ${timelineDurationSec}s</p>
    <div class="error-badges">
      <span class="error-badge ${verdictBadgeClass}"><span class="badge-dot"></span>Verdict: ${verdictStatus}</span>
      ${
        canonicalTabs
          ? `${environmentTabIndex >= 0 ? `<button class="error-badge ${serverBadgeClass}" onclick="switchTab('evidence-${environmentTabIndex}')"><span class="badge-dot"></span>Environment</button>` : ''}
      ${browserTabIndex >= 0 ? `<button class="error-badge ${consoleBadgeClass}" onclick="switchTab('evidence-${browserTabIndex}')"><span class="badge-dot"></span>${consoleBadgeText}</button>` : ''}`
          : `<button class="error-badge ${consoleBadgeClass}" onclick="switchTab('console')"><span class="badge-dot"></span>${consoleBadgeText}</button>
      <button class="error-badge ${serverBadgeClass}" onclick="switchTab('server')"><span class="badge-dot"></span>${serverBadgeText}</button>`
      }
    </div>
    ${tokenUsageHtml}
  </div>
  <div class="viewer">
    <div class="video-panel">
      ${videoPanelHtml}
    </div>
    <div class="timeline-panel">
      <div class="panel-tabs">
        <button class="panel-tab active" data-tab="timeline" onclick="switchTab('timeline')">Timeline &middot; ${data.entries.length}</button>
        ${
          canonicalTabs
            ? evidenceTabsHtml
            : `<button class="panel-tab" data-tab="console" onclick="switchTab('console')">Console${consoleLineCount > 0 ? ` &middot; ${consoleLineCount}` : ''}</button>
        <button class="panel-tab" data-tab="server" onclick="switchTab('server')">Server${serverLineCount > 0 ? ` &middot; ${serverLineCount}` : ''}</button>`
        }
        <div class="panel-tab-actions" id="tabActionsTimeline">
          <label class="overlay-toggle"><input type="checkbox" id="toggle-overlays" checked><span class="toggle-track"></span> Overlays<span class="tooltip">Show ripple animations and action labels on the video as each step plays.</span></label>
        </div>
      </div>
      <div id="tabTimeline" class="panel-content" data-panel="timeline">
${mediaWarningHtml}
${stepsHtml}
      </div>
      ${
        canonicalTabs
          ? evidenceContentsHtml
          : `<div id="tabConsole" class="panel-content" data-panel="console" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status">
            <span class="error-badge ${consoleBadgeClass}" style="cursor:default"><span class="badge-dot"></span>${consoleBadgeText}</span>
          </div>
          ${consoleLogBodyHtml}
        </div>
      </div>
      <div id="tabServer" class="panel-content" data-panel="server" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status">
            <span class="error-badge ${serverBadgeClass}" style="cursor:default"><span class="badge-dot"></span>${serverBadgeText}</span>
          </div>
          ${serverLogBodyHtml}
        </div>
      </div>`
      }
    </div>
  </div>
  <script>
    // --- Description expand/collapse ---
    function initDescription() {
      const desc = document.getElementById('description');
      const btn = document.getElementById('showMoreBtn');
      if (!desc || !btn) return;
      const textEl = desc.querySelector('.description-text');
      // Clamp initially, then check if text overflows
      desc.classList.add('clamped');
      requestAnimationFrame(() => {
        if (textEl.scrollHeight > textEl.clientHeight + 1) {
          btn.style.display = 'block';
        }
      });
    }
    function toggleDescription() {
      const desc = document.getElementById('description');
      const btn = document.getElementById('showMoreBtn');
      if (!desc || !btn) return;
      const isClamped = desc.classList.contains('clamped');
      desc.classList.toggle('clamped');
      btn.textContent = isClamped ? 'Show less' : 'Show more';
      fitVideoToAvailableSpace();
    }
    initDescription();

    // --- Tab switching ---
    let activeTab = 'timeline';

    function switchTab(tab) {
      if (tab === activeTab) return;
      activeTab = tab;
      document.querySelectorAll('.panel-tab').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      var targetId = tab === 'timeline'
        ? 'tabTimeline'
        : tab === 'console'
          ? 'tabConsole'
          : tab === 'server'
            ? 'tabServer'
            : 'tab-' + tab;
      document.querySelectorAll('.panel-content').forEach(function(panel) {
        panel.style.display = panel.id === targetId ? '' : 'none';
      });
      var actions = document.getElementById('tabActionsTimeline');
      if (actions) actions.style.display = tab === 'timeline' ? '' : 'none';
    }

    const video = document.querySelector('video');
    const steps = document.querySelectorAll('.step');
    const timelinePanel = document.querySelector('.timeline-panel');
    const overlay = document.querySelector('.video-overlay');
    const videoContainer = document.querySelector('.video-container');
    const videoWrapper = document.querySelector('.video-wrapper');
    const scrubBar = document.querySelector('.scrub-bar');
    const recordedVideoSize = ${recordedVideoSizeJs};
    const entries = ${entriesJson};
    let duration = ${timelineDurationSec};
    const markers = ${markersJson};

    // Scrub bar elements
    const scrubTrack = document.getElementById('scrubTrack');
    const scrubProgress = document.getElementById('scrubProgress');
    const scrubPlayhead = document.getElementById('scrubPlayhead');
    const scrubTooltip = document.getElementById('scrubTooltip');
    const scrubMarkers = document.querySelectorAll('.scrub-marker');

    // --- Video sizing ---
    // The wrapper is the shared-width card: the aspect ratio drives the container
    // height, and the fitted width is applied to the wrapper so the scrub bar matches.
    function videoIntrinsicSize() {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        return { width: video.videoWidth, height: video.videoHeight };
      }
      return recordedVideoSize;
    }

    function fitVideoToAvailableSpace() {
      if (!video || !videoContainer || !videoWrapper) return;
      const size = videoIntrinsicSize();
      if (!size) return;
      videoContainer.classList.add('video-fit');
      videoContainer.style.aspectRatio = size.width + ' / ' + size.height;
      videoWrapper.style.width = '';
      if (window.matchMedia('(max-width: 768px)').matches) return;
      const availableWidth = videoWrapper.clientWidth;
      const availableHeight = videoWrapper.clientHeight - (scrubBar ? scrubBar.offsetHeight : 0);
      if (availableWidth <= 0 || availableHeight <= 0) return;
      const fitted = Math.min(availableWidth, (availableHeight * size.width) / size.height);
      videoWrapper.style.width = Math.floor(fitted) + 'px';
    }

    fitVideoToAvailableSpace();
    window.addEventListener('resize', fitVideoToAvailableSpace);

    // --- Toggle state ---
    const toggleOverlays = document.getElementById('toggle-overlays');

    function loadToggleState() {
      try {
        const saved = JSON.parse(localStorage.getItem('proofshot-overlays') || '{}');
        if (saved.overlays === false) toggleOverlays.checked = false;
      } catch {}
    }
    function saveToggleState() {
      try {
        localStorage.setItem('proofshot-overlays', JSON.stringify({
          overlays: toggleOverlays.checked,
        }));
      } catch {}
    }
    loadToggleState();

    toggleOverlays.addEventListener('change', () => {
      if (!toggleOverlays.checked) clearOverlays();
      saveToggleState();
    });

    function clearOverlays() {
      if (!overlay) return;
      overlay.querySelectorAll('.ripple, .scroll-indicator, .toast').forEach(el => el.remove());
    }

    // --- Action icon (mirrors server-side getActionIcon) ---
    function getActionIconJS(action) {
      const cmd = action.split(' ')[0].toLowerCase();
      switch (cmd) {
        case 'open': case 'navigate': return '\\u{1F9ED}';
        case 'click': return '\\u{1F5B1}';
        case 'fill': case 'type': return '\\u2328';
        case 'screenshot': return '\\u{1F4F7}';
        case 'snapshot': return '\\u{1F441}';
        case 'scroll': return '\\u2195';
        case 'press': case 'keyboard': return '\\u2318';
        default: return '\\u25B6';
      }
    }

    // --- Toast text generation ---
    function getToastText(entry) {
      const action = entry.action;
      const parts = action.split(' ');
      const cmd = parts[0].toLowerCase();
      const label = entry.element ? entry.element.label : '';
      const icon = getActionIconJS(action);

      switch (cmd) {
        case 'click':
          return icon + '  Click' + (label ? ': ' + label : '');
        case 'fill': {
          const valMatch = action.match(/"([^"]*)"/);
          const val = valMatch ? valMatch[1] : '';
          const target = label || '';
          return icon + '  Type: ' + val + (target ? ' into ' + target : '');
        }
        case 'type': {
          const valMatch2 = action.match(/"([^"]*)"/);
          const val2 = valMatch2 ? valMatch2[1] : '';
          const target2 = label || '';
          return icon + '  Type: ' + val2 + (target2 ? ' into ' + target2 : '');
        }
        case 'scroll': {
          const dir = parts[1] || '';
          return icon + '  Scroll ' + dir;
        }
        case 'open': {
          const url = parts.slice(1).join(' ');
          try {
            return icon + '  Navigate: ' + new URL(url).pathname;
          } catch {
            return icon + '  Navigate: ' + url;
          }
        }
        case 'press':
          return icon + '  Press: ' + parts.slice(1).join(' ');
        case 'screenshot':
          return icon + '  Screenshot';
        default:
          return icon + '  ' + action;
      }
    }

    // --- Scroll direction arrows ---
    function getScrollArrow(action) {
      const parts = action.split(' ');
      const dir = (parts[1] || '').toLowerCase();
      switch (dir) {
        case 'up': return '\\u2191';
        case 'down': return '\\u2193';
        case 'left': return '\\u2190';
        case 'right': return '\\u2192';
        default: return '\\u2195';
      }
    }

    // --- Overlay scheduling ---
    const overlayWindows = entries.map((entry, i) => {
      const cmd = entry.action.split(' ')[0].toLowerCase();
      const nextTime = i + 1 < entries.length ? entries[i + 1].relativeTimeSec : entry.relativeTimeSec + 3;
      const rippleEnd = entry.relativeTimeSec + 0.6;
      const toastEnd = Math.min(nextTime, entry.relativeTimeSec + 3);
      const scrollEnd = entry.relativeTimeSec + 0.8;

      return {
        entry,
        cmd,
        rippleStart: entry.relativeTimeSec,
        rippleEnd: cmd === 'scroll' ? scrollEnd : rippleEnd,
        toastStart: entry.relativeTimeSec,
        toastEnd,
      };
    });

    const activeRipples = new Map();
    const activeToasts = new Map();
    let rafId = null;

    function renderOverlays() {
      if (!video || !overlay) return;
      const t = video.currentTime;
      const videoEl = video;

      overlayWindows.forEach((win, idx) => {
        const enabled = toggleOverlays.checked;

        // --- Ripple / scroll indicator ---
        if (enabled) {
          if (t >= win.rippleStart && t < win.rippleEnd && !activeRipples.has(idx)) {
            const el = document.createElement('div');

            if (win.cmd === 'scroll') {
              el.className = 'scroll-indicator';
              el.textContent = getScrollArrow(win.entry.action);
              overlay.appendChild(el);
              activeRipples.set(idx, el);
            } else if ((win.cmd === 'click' || win.cmd === 'fill' || win.cmd === 'type') && win.entry.element) {
              const elem = win.entry.element;
              const scaleX = videoEl.clientWidth / elem.viewport.width;
              const scaleY = videoEl.clientHeight / elem.viewport.height;
              const cx = (elem.bbox.x + elem.bbox.width / 2) * scaleX;
              const cy = (elem.bbox.y + elem.bbox.height / 2) * scaleY;

              el.className = 'ripple ' + (win.cmd === 'click' ? 'ripple-click' : 'ripple-fill');
              el.style.left = cx + 'px';
              el.style.top = cy + 'px';
              overlay.appendChild(el);
              activeRipples.set(idx, el);
            }
          }
          if (t >= win.rippleEnd && activeRipples.has(idx)) {
            activeRipples.get(idx).remove();
            activeRipples.delete(idx);
          }
        } else if (activeRipples.has(idx)) {
          activeRipples.get(idx).remove();
          activeRipples.delete(idx);
        }

        // --- Toast ---
        if (enabled) {
          if (t >= win.toastStart && t < win.toastEnd && !activeToasts.has(idx)) {
            activeToasts.forEach((el) => el.remove());
            activeToasts.clear();

            const el = document.createElement('div');
            el.className = 'toast';
            el.textContent = getToastText(win.entry);
            overlay.appendChild(el);
            activeToasts.set(idx, el);
          }
          if (t >= win.toastEnd && activeToasts.has(idx)) {
            activeToasts.get(idx).remove();
            activeToasts.delete(idx);
          }
        } else if (activeToasts.has(idx)) {
          activeToasts.get(idx).remove();
          activeToasts.delete(idx);
        }
      });

      rafId = requestAnimationFrame(renderOverlays);
    }

    function startOverlayLoop() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(renderOverlays);
    }

    function stopOverlayLoop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    // --- Seek handler: clear overlays on seek so they re-trigger correctly ---
    function onSeeked() {
      activeRipples.forEach(el => el.remove());
      activeRipples.clear();
      activeToasts.forEach(el => el.remove());
      activeToasts.clear();
    }

    function seekTo(time) {
      if (video && Number.isFinite(time)) {
        var mediaEnd = Number.isFinite(video.duration) ? video.duration : time;
        video.currentTime = Math.max(0, Math.min(time, mediaEnd));
        video.play();
      }
    }

    function formatTimeFn(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + String(s).padStart(2, '0');
    }

    // Update scrub bar position
    function updateScrubBar(t) {
      if (!scrubTrack || duration <= 0) return;
      const pct = Math.min((t / duration) * 100, 100);
      if (scrubProgress) scrubProgress.style.width = pct + '%';
      if (scrubPlayhead) scrubPlayhead.style.left = pct + '%';
    }

    // Highlight active marker on scrub bar
    function updateActiveMarker(t) {
      scrubMarkers.forEach(m => {
        const mTime = parseFloat(m.dataset.time);
        const idx = parseInt(m.dataset.index);
        const nextMarker = markers[idx + 1];
        const nextTime = nextMarker ? nextMarker.time : Infinity;
        m.classList.toggle('active', t >= mTime && t < nextTime);
      });
    }

    // Scrub bar: click track to seek
    if (scrubTrack && video) {
      let isDragging = false;

      function getTimeFromEvent(e) {
        const rect = scrubTrack.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        return pct * duration;
      }

      scrubTrack.addEventListener('mousedown', (e) => {
        if (e.target.closest('.scrub-marker')) return;
        isDragging = true;
        const t = getTimeFromEvent(e);
        video.currentTime = Math.min(t, video.duration);
        updateScrubBar(t);
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const t = getTimeFromEvent(e);
        video.currentTime = Math.min(t, video.duration);
        updateScrubBar(t);
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          video.play();
        }
      });
    }

    // Scrub bar: marker hover tooltips
    scrubMarkers.forEach(marker => {
      marker.addEventListener('mouseenter', (e) => {
        const idx = parseInt(marker.dataset.index);
        const m = markers[idx];
        if (!m || !scrubTooltip) return;
        const action = m.action.length > 40 ? m.action.slice(0, 40) + '\\u2026' : m.action;
        scrubTooltip.textContent = '';
        const iconElement = document.createElement('span');
        iconElement.className = 'tooltip-icon';
        iconElement.textContent = m.icon;
        scrubTooltip.appendChild(iconElement);
        scrubTooltip.appendChild(document.createTextNode(action));
        const timeElement = document.createElement('span');
        timeElement.className = 'tooltip-time';
        timeElement.textContent = formatTimeFn(m.time);
        scrubTooltip.appendChild(timeElement);
        scrubTooltip.style.display = 'block';

        const trackRect = scrubTrack.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        const tooltipLeft = markerRect.left - trackRect.left + markerRect.width / 2;
        scrubTooltip.style.left = tooltipLeft + 'px';
        scrubTooltip.style.transform = 'translateX(-50%)';
      });

      marker.addEventListener('mouseleave', () => {
        if (scrubTooltip) scrubTooltip.style.display = 'none';
      });

      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = parseFloat(marker.dataset.time);
        seekTo(t);
      });
    });

    // Log lines with timestamps for video sync
    const logLines = document.querySelectorAll('.log-line[data-time]');

    // Highlight active log line for a given video time
    function updateActiveLogLine(t) {
      logLines.forEach(line => {
        const lt = parseFloat(line.dataset.time);
        const nextLine = line.nextElementSibling;
        const hasNext = nextLine && nextLine.dataset && nextLine.dataset.time !== undefined;
        const nextTime = hasNext ? parseFloat(nextLine.dataset.time) : Infinity;
        line.classList.toggle('active', t >= lt && t < nextTime);
      });

      // Auto-scroll the active log line in the currently visible tab
      if (activeTab !== 'timeline') {
        var tabEl = Array.from(document.querySelectorAll('.panel-content')).find(function(panel) {
          return panel.style.display !== 'none';
        });
        if (tabEl) {
          var activeLine = tabEl.querySelector('.log-line.active');
          if (activeLine && timelinePanel) {
            var panelRect = timelinePanel.getBoundingClientRect();
            var lineRect = activeLine.getBoundingClientRect();
            if (lineRect.top < panelRect.top || lineRect.bottom > panelRect.bottom) {
              activeLine.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }
        }
      }
    }

    // Highlight active step as video plays (only if video exists)
    if (video) {
      video.addEventListener('timeupdate', () => {
        const t = video.currentTime;
        let activeStep = null;

        steps.forEach(step => {
          const stepTime = parseFloat(step.dataset.time);
          const nextStep = step.nextElementSibling;
          const isLastStep = !nextStep || !nextStep.classList.contains('step');
          const nextTime = isLastStep ? Infinity : parseFloat(nextStep.dataset.time);
          const isActive = t >= stepTime && t < nextTime;
          step.classList.toggle('active', isActive);
          if (isActive) activeStep = step;
        });

        // Auto-scroll the active step into view (only when timeline tab is active)
        if (activeStep && activeTab === 'timeline') {
          const panelRect = timelinePanel.getBoundingClientRect();
          const stepRect = activeStep.getBoundingClientRect();
          if (stepRect.top < panelRect.top || stepRect.bottom > panelRect.bottom) {
            activeStep.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }

        // Sync log lines with video
        updateActiveLogLine(t);

        // Update scrub bar + markers
        updateScrubBar(t);
        updateActiveMarker(t);
      });

      // Preserve the canonical action timeline when media is shorter.
      video.addEventListener('loadedmetadata', () => {
        fitVideoToAvailableSpace();
        if (video.duration && isFinite(video.duration)) {
          duration = Math.max(duration, video.duration);
          scrubMarkers.forEach(m => {
            const mTime = parseFloat(m.dataset.time);
            m.style.left = (duration > 0 ? (mTime / duration) * 100 : 0) + '%';
          });
        }
      });

      // Start/stop rAF overlay loop with video play state
      video.addEventListener('play', startOverlayLoop);
      video.addEventListener('pause', stopOverlayLoop);
      video.addEventListener('ended', stopOverlayLoop);
      video.addEventListener('seeked', onSeeked);
    }

    // Keyboard navigation: left/right arrows jump between steps
    document.addEventListener('keydown', (e) => {
      if (activeTab !== 'timeline') return;
      if (!video || !markers.length) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const t = video.currentTime;
        let targetIdx = -1;

        if (e.key === 'ArrowRight') {
          // Find next marker after current time
          for (let i = 0; i < markers.length; i++) {
            if (markers[i].time > t + 0.5) { targetIdx = i; break; }
          }
          if (targetIdx === -1) targetIdx = markers.length - 1;
        } else {
          // Find previous marker before current time
          for (let i = markers.length - 1; i >= 0; i--) {
            if (markers[i].time < t - 0.5) { targetIdx = i; break; }
          }
          if (targetIdx === -1) targetIdx = 0;
        }

        seekTo(markers[targetIdx].time);
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Write the viewer HTML file to the output directory.
 * Returns the path to the generated file, or null if no session log exists.
 */
export function writeViewer(
  outputDir: string,
  data: Omit<ViewerData, 'entries'> & { entries?: SessionLogEntry[] },
): string | null {
  // Load session log if entries not provided
  let entries = data.entries;
  if (!entries) {
    const logPath = path.join(outputDir, 'session-log.json');
    if (fs.existsSync(logPath)) {
      try {
        entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      } catch {
        entries = [];
      }
    } else {
      entries = [];
    }
  }

  const html = generateViewer({ ...data, entries: entries || [] });
  const viewerPath = path.join(outputDir, 'viewer.html');
  fs.writeFileSync(viewerPath, html);
  return viewerPath;
}
