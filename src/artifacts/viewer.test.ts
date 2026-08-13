import { describe, expect, it } from 'vitest';
import type { CanonicalEvidence, Verdict } from './evidence.js';
import { generateViewer } from './viewer.js';

/** Body of the first stylesheet rule for `selector`, so assertions can target single declarations. */
function styleRule(html: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`No stylesheet rule found for "${selector}"`);
  return match[1];
}

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
          origin: 'environment',
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

  it('embeds untrusted actions without executable HTML or script terminators', () => {
    const action = `click </script><img src=x onerror=alert('proofshot')>\u2028next`;
    const html = generateViewer({
      description: 'injection fixture',
      serverCommand: null,
      durationSec: 1,
      videoFilename: 'recording.webm',
      entries: [
        {
          action,
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
        },
      ],
      consoleErrorCount: 0,
      serverErrorCount: 0,
    });

    expect(html).not.toContain('</script><img');
    expect(html).not.toContain('scrubTooltip.innerHTML');
    expect(html).toContain('scrubTooltip.textContent');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('\\u2028');
    const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
    expect(inlineScript).not.toContain('\u2028');
  });

  it('reserves the recorded video aspect ratio before metadata loads', () => {
    const html = generateViewer({
      description: 'video sizing fixture',
      serverCommand: null,
      durationSec: 1,
      videoFilename: 'recording.webm',
      viewport: { width: 1024, height: 768 },
      entries: [],
      consoleErrorCount: 0,
      serverErrorCount: 0,
    });

    expect(html).toContain('width="1024" height="768"');
    expect(html).toContain(
      '<div class="video-container video-fit" style="aspect-ratio: 1024 / 768">',
    );
    expect(html).toContain('const recordedVideoSize = { width: 1024, height: 768 };');
    expect(styleRule(html, 'body')).toContain('height: 100vh');
    expect(styleRule(html, 'body')).toContain('overflow: hidden');
    expect(styleRule(html, '.viewer')).toContain('flex: 1 1 auto');
    expect(styleRule(html, '.viewer')).toContain('min-height: 0');
    expect(styleRule(html, '.video-container.video-fit')).toContain('width: 100%');
    expect(styleRule(html, '.video-container.video-fit video')).toContain(
      'height: 100%',
    );
  });

  it('keeps the scrub bar aligned with the fitted video width', () => {
    const html = generateViewer({
      description: 'video sizing fixture',
      serverCommand: null,
      durationSec: 1,
      videoFilename: 'recording.webm',
      viewport: { width: 1024, height: 768 },
      entries: [],
      consoleErrorCount: 0,
      serverErrorCount: 0,
    });

    expect(html).toContain("videoWrapper.style.width = Math.floor(fitted) + 'px';");
    expect(styleRule(html, '.scrub-bar')).toContain('width: 100%');
    expect(styleRule(html, '.header')).toContain('max-height: 50%');
    expect(styleRule(html, '.header')).toContain('overflow-y: auto');
  });

  it('omits video dimensions when the recorded viewport is not usable', () => {
    const render = (viewport: unknown) =>
      generateViewer({
        description: 'video sizing fixture',
        serverCommand: null,
        durationSec: 1,
        videoFilename: 'recording.webm',
        viewport: viewport as { width: number; height: number },
        entries: [],
        consoleErrorCount: 0,
        serverErrorCount: 0,
      });

    for (const viewport of [
      { width: undefined, height: undefined },
      { width: 0, height: 0 },
      { width: -1024, height: 768 },
      { width: '1024" onerror="alert(1)', height: 768 },
    ]) {
      const html = render(viewport);
      expect(html).toContain('<video src="./recording.webm" controls>');
      expect(html).not.toContain('onerror');
    }

    expect(render({ width: '1024', height: '768.4' })).toContain(
      'width="1024" height="768"',
    );
  });
});
