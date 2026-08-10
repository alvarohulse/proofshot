import { describe, expect, it } from 'vitest';
import type { CanonicalEvidence, Verdict } from './evidence.js';
import { generateViewer } from './viewer.js';

describe('canonical evidence viewer', () => {
  it('keeps untimed rows non-clickable and the action timeline authoritative', () => {
    const evidence: CanonicalEvidence = {
      version: 1,
      sessionId: 'fixture',
      generatedAt: '2026-08-09T00:00:00.000Z',
      timelineDurationSec: 598.5,
      mediaDurationSec: 284.9,
      mediaDivergenceSec: 313.6,
      mediaTruncated: true,
      actions: [],
      events: [
        {
          version: 1,
          origin: 'environment',
          group: 'frontend',
          sourceId: 'vite',
          sourceTitle: 'Vite',
          stream: 'pty',
          segment: 'history',
          timestamp: null,
          relativeTimeSec: null,
          text: 'historical output',
          captureGap: true,
        },
        {
          version: 1,
          origin: 'environment',
          group: 'frontend',
          sourceId: 'vite',
          sourceTitle: 'Vite',
          stream: 'pty',
          segment: 'live',
          timestamp: '2026-08-09T00:05:00.000Z',
          relativeTimeSec: 300,
          text: 'Error: Vite stack exploded',
        },
        {
          version: 1,
          origin: 'browser',
          group: 'browser',
          sourceId: 'browser-nav-1',
          sourceTitle: 'https://example.test',
          navigationId: 'browser-nav-1',
          pageUrl: 'https://example.test',
          stream: 'console',
          segment: 'live',
          timestamp: null,
          relativeTimeSec: 301,
          text: 'browser output',
        },
      ],
      sources: [
        {
          id: 'vite',
          title: 'Vite',
          origin: 'environment',
          group: 'frontend',
          lineCount: 2,
          hiddenLineCount: 3,
          truncationCount: 1,
          captureGapCount: 1,
          incidentCount: 1,
        },
        {
          id: 'browser-nav-1',
          title: 'https://example.test',
          origin: 'browser',
          group: 'browser',
          lineCount: 1,
          hiddenLineCount: 0,
          truncationCount: 0,
          captureGapCount: 0,
          incidentCount: 0,
        },
      ],
      incidents: [
        {
          id: 'incident-1',
          severity: 'error',
          group: 'frontend',
          message: 'Error: Vite stack exploded',
          count: 3,
          sourceIds: ['vite'],
          firstTimeSec: 300,
          lastTimeSec: 302,
        },
      ],
      screenshots: [],
    };
    const verdict: Verdict = {
      version: 1,
      status: 'INCOMPLETE',
      reasons: ['Recorded media ends before the canonical action timeline.'],
      fatalIncidentCount: 0,
      missingArtifacts: [],
      duplicateScreenshotHashes: [],
      expectedSelectorFailures: [],
      mediaTruncated: true,
    };

    const html = generateViewer({
      description: 'fixture',
      serverCommand: null,
      durationSec: 598.5,
      videoFilename: 'recording.webm',
      entries: [
        {
          action: 'open https://example.test',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
        },
        {
          action: 'legacy untimed action',
          relativeTimeSec: Number.NaN,
          timestamp: '2026-08-09T00:00:01.000Z',
        },
      ],
      consoleErrorCount: 0,
      serverErrorCount: 1,
      evidence,
      verdict,
    });

    expect(html).toContain('Environment');
    expect(html).toContain('Frontend · Vite');
    expect(html).toContain('Browser');
    expect(html).toContain('https://example.test');
    expect(html).toContain('capture gap');
    expect(html).toContain('ERROR × 3');
    expect(html).toContain('313.6s before the canonical action timeline');
    expect(html).toContain('let duration = 598.5');
    expect(html).toContain('duration = Math.max(duration, video.duration)');
    expect(html).not.toContain('seekTo(NaN)');
  });
});
