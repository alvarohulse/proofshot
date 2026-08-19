import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import type { EnvironmentState, EvidenceEvent } from '../environment/types.js';

const mocks = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>(
    'child_process',
  );
  return {
    ...actual,
    execFileSync: mocks.execFileSync,
  };
});

import { writeCanonicalEvidence } from './evidence.js';

const temporaryDirectories: string[] = [];
const TEST_IMAGE = new PNG({ width: 2, height: 1 });
TEST_IMAGE.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
const VALID_PNG = PNG.sync.write(TEST_IMAGE);

beforeEach(() => {
  mocks.execFileSync.mockReturnValue(
    JSON.stringify({
      format: {
        start_time: '0',
        duration: '284.9',
      },
    }),
  );
});

afterEach(() => {
  mocks.execFileSync.mockReset();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('canonical evidence and verdicts', () => {
  it('groups repeated incidents and detects short media and duplicate key frames', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-evidence-'),
    );
    temporaryDirectories.push(sessionDir);
    const evidencePath = path.join(sessionDir, 'environment.ndjson');
    const events: EvidenceEvent[] = [
      environmentEvent('Error: Vite stack exploded', 10),
      environmentEvent('GET /health', 11),
      environmentEvent('Error: Vite stack exploded', 12),
      environmentEvent(
        'Authorization: Basic cHJpdmF0ZTpzZWNyZXQ=',
        12.5,
      ),
      environmentEvent('[process stopped by ProofShot]', 13),
    ];
    fs.writeFileSync(
      evidencePath,
      events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    );
    fs.writeFileSync(path.join(sessionDir, 'first.png'), VALID_PNG);
    fs.writeFileSync(path.join(sessionDir, 'second.png'), VALID_PNG);
    const videoPath = path.join(sessionDir, 'recording.webm');
    fs.writeFileSync(videoPath, 'video fixture');
    const environment: EnvironmentState = {
      kind: 'processes',
      evidencePath,
      processes: [],
      sources: [
        {
          id: 'vite',
          title: 'Vite',
          group: 'frontend',
          kind: 'file',
          stream: 'file',
          logPath: path.join(sessionDir, 'vite.log'),
          exclude: ['GET /health'],
        },
      ],
    };

    const { evidence, verdict } = writeCanonicalEvidence({
      sessionId: 'proofshot-fixture',
      sessionDir,
      durationSec: 598.5,
      videoPath,
      recordingWasActive: true,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'open https://example.test',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'passed',
        },
        {
          action: 'screenshot first.png',
          relativeTimeSec: 100,
          timestamp: '2026-08-09T00:01:40.000Z',
          outcome: 'passed',
        },
        {
          action: 'screenshot second.png',
          relativeTimeSec: 200,
          timestamp: '2026-08-09T00:03:20.000Z',
          outcome: 'passed',
        },
        {
          action: 'is visible #ready',
          relativeTimeSec: 598.5,
          timestamp: '2026-08-09T00:09:58.500Z',
          outcome: 'failed',
          expectedSelector: '#ready',
        },
      ],
      consoleEntries: [
        { text: 'Browser warning', relativeTimeSec: 20 },
      ],
      serverEntries: [],
      environment,
    });

    expect(evidence.timelineDurationSec).toBe(598.5);
    expect(evidence.mediaDurationSec).toBe(284.9);
    expect(evidence.mediaTruncated).toBe(true);
    expect(evidence.incidents).toEqual([
      expect.objectContaining({
        group: 'frontend',
        count: 2,
        sourceIds: ['vite'],
      }),
    ]);
    expect(
      evidence.sources.find((source) => source.id === 'vite'),
    ).toEqual(
      expect.objectContaining({
        title: 'Vite',
        hiddenLineCount: 1,
        incidentCount: 1,
      }),
    );
    expect(
      evidence.sources.find((source) => source.origin === 'browser'),
    ).toEqual(
      expect.objectContaining({
        title: 'https://example.test/',
        group: 'browser',
      }),
    );
    expect(verdict.status).toBe('INCOMPLETE');
    expect(verdict.duplicateScreenshotHashes).toEqual([
      ['first.png', 'second.png'],
    ]);
    expect(verdict.expectedSelectorFailures).toEqual(['#ready']);
    expect(verdict.mediaTruncated).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'evidence.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'verdict.json'))).toBe(true);
    expect(
      fs.readFileSync(path.join(sessionDir, 'evidence.json'), 'utf-8'),
    ).not.toContain('cHJpdmF0ZTpzZWNyZXQ=');
  });

  it('does not treat pre-recording lifecycle time as truncated media', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-evidence-offset-'),
    );
    temporaryDirectories.push(sessionDir);
    const evidencePath = path.join(sessionDir, 'environment.ndjson');
    fs.writeFileSync(
      evidencePath,
      [
        environmentEvent('startup before recording', 10),
        environmentEvent('live after recording', 90),
      ]
        .map((event) => JSON.stringify(event))
        .join('\n') + '\n',
    );
    const videoPath = path.join(sessionDir, 'recording.webm');
    fs.writeFileSync(videoPath, 'video fixture');
    fs.writeFileSync(path.join(sessionDir, 'proof.png'), VALID_PNG);

    const { evidence, verdict } = writeCanonicalEvidence({
      sessionId: 'proofshot-offset-fixture',
      sessionDir,
      durationSec: 66,
      timelineOffsetSec: 83,
      videoPath,
      recordingWasActive: true,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'is visible #ready',
          relativeTimeSec: 0.25,
          timestamp: '2026-08-09T00:01:23.250Z',
          outcome: 'passed',
          expectedSelector: '#ready',
        },
        {
          action: 'screenshot proof.png',
          relativeTimeSec: 0.5,
          timestamp: '2026-08-09T00:01:23.500Z',
          outcome: 'passed',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
      environment: {
        kind: 'processes',
        evidencePath,
        processes: [],
        sources: [],
      },
    });

    expect(evidence.mediaTruncated).toBe(false);
    expect(evidence.mediaDivergenceSec).toBe(0);
    expect(evidence.events.map((event) => event.relativeTimeSec)).toEqual([
      null,
      7,
    ]);
    expect(verdict.status).toBe('PASS');
  });

  it('uses stable non-empty media when ffprobe is unavailable', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-no-ffprobe-'),
    );
    temporaryDirectories.push(sessionDir);
    const videoPath = path.join(sessionDir, 'recording.mp4');
    fs.writeFileSync(videoPath, 'stable media');
    mocks.execFileSync.mockImplementation(() => {
      throw Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' });
    });

    const { evidence, verdict } = writeCanonicalEvidence({
      sessionId: 'proofshot-no-ffprobe',
      sessionDir,
      durationSec: 1,
      videoPath,
      recordingWasActive: true,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'is visible #ready',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'passed',
          expectedSelector: '#ready',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
    });

    expect(evidence.mediaDurationSec).toBeNull();
    expect(verdict.status).toBe('PASS');
    expect(verdict.missingArtifacts).toEqual([]);
  });

  it('rejects media that ffprobe reports as invalid', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-invalid-media-'),
    );
    temporaryDirectories.push(sessionDir);
    const videoPath = path.join(sessionDir, 'recording.mp4');
    fs.writeFileSync(videoPath, 'invalid media');
    mocks.execFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ffprobe exited 1'), { status: 1 });
    });

    const { verdict } = writeCanonicalEvidence({
      sessionId: 'proofshot-invalid-media',
      sessionDir,
      durationSec: 1,
      videoPath,
      recordingWasActive: true,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'is visible #ready',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'passed',
          expectedSelector: '#ready',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
    });

    expect(verdict.status).toBe('INCOMPLETE');
    expect(verdict.missingArtifacts).toContain('recording.mp4');
  });

  it('requires a passed explicit assertion for a PASS verdict', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-no-assertion-'),
    );
    temporaryDirectories.push(sessionDir);

    const { verdict } = writeCanonicalEvidence({
      sessionId: 'no-assertion',
      sessionDir,
      durationSec: 1,
      videoPath: path.join(sessionDir, 'unused.webm'),
      recordingWasActive: false,
      consoleEvidenceAvailable: true,
      actions: [],
      consoleEntries: [],
      serverEntries: [],
    });

    expect(verdict.status).toBe('INCOMPLETE');
    expect(verdict.reasons).toContain(
      'No explicit behavioral assertion passed.',
    );
  });

  it('reports a failed explicit assertion as FAIL when evidence is complete', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-failed-assertion-'),
    );
    temporaryDirectories.push(sessionDir);

    const { verdict } = writeCanonicalEvidence({
      sessionId: 'failed-assertion',
      sessionDir,
      durationSec: 1,
      videoPath: path.join(sessionDir, 'unused.webm'),
      recordingWasActive: false,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'is visible #ready',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'failed',
          expectedSelector: '#ready',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
    });

    expect(verdict.status).toBe('FAIL');
    expect(verdict.reasons).toContain(
      '1 expected selector assertion(s) failed.',
    );
    expect(verdict.reasons).not.toContain(
      'No explicit behavioral assertion passed.',
    );
  });

  it('keeps nonfatal console and network failures from receiving PASS', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-nonfatal-failures-'),
    );
    temporaryDirectories.push(sessionDir);

    const { verdict } = writeCanonicalEvidence({
      sessionId: 'nonfatal-failures',
      sessionDir,
      durationSec: 1,
      videoPath: path.join(sessionDir, 'unused.webm'),
      recordingWasActive: false,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'is visible #ready',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'passed',
          expectedSelector: '#ready',
        },
      ],
      consoleEntries: [
        { text: 'Error: recoverable browser problem', relativeTimeSec: 0.5 },
      ],
      serverEntries: [],
      networkSummary: {
        version: 1,
        requestCount: 1,
        requests: [
          {
            endpoint: 'http://localhost/api/save',
            method: 'POST',
            status: 500,
            durationMs: 10,
            error: null,
          },
        ],
      },
    });

    expect(verdict.status).toBe('INCOMPLETE');
    expect(verdict.reasons).toContain('1 nonfatal incident(s) detected.');
    expect(verdict.reasons).toContain('1 failed network request(s) detected.');
  });

  it('keeps uncaught page errors and status-zero requests from receiving PASS', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-browser-failures-'),
    );
    temporaryDirectories.push(sessionDir);

    const { evidence, verdict } = writeCanonicalEvidence({
      sessionId: 'browser-failures',
      sessionDir,
      durationSec: 1,
      videoPath: path.join(sessionDir, 'unused.webm'),
      recordingWasActive: false,
      consoleEvidenceAvailable: true,
      browserErrorCount: 1,
      actions: [
        {
          action: 'is visible #ready',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'passed',
          expectedSelector: '#ready',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
      networkSummary: {
        version: 1,
        requestCount: 1,
        requests: [
          {
            endpoint: 'http://localhost/api/aborted',
            method: 'GET',
            status: 0,
            durationMs: 10,
            error: null,
          },
        ],
      },
    });

    expect(evidence.browserErrorCount).toBe(1);
    expect(verdict.status).toBe('INCOMPLETE');
    expect(verdict.reasons).toContain(
      '1 uncaught browser error(s) detected.',
    );
    expect(verdict.reasons).toContain(
      '1 failed network request(s) detected.',
    );
  });

  it('marks decoded blank screenshots as incomplete evidence', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-blank-screenshot-'),
    );
    temporaryDirectories.push(sessionDir);
    const blank = new PNG({ width: 2, height: 2 });
    fs.writeFileSync(path.join(sessionDir, 'blank.png'), PNG.sync.write(blank));

    const { evidence, verdict } = writeCanonicalEvidence({
      sessionId: 'blank-screenshot',
      sessionDir,
      durationSec: 1,
      videoPath: path.join(sessionDir, 'unused.webm'),
      recordingWasActive: false,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'screenshot blank.png',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'passed',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
    });

    expect(evidence.screenshots[0]).toMatchObject({
      validPng: true,
      visuallyBlank: true,
    });
    expect(verdict.status).toBe('INCOMPLETE');
  });

  it('does not accept synthetic DOM mutation as final behavioral proof', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-synthetic-action-'),
    );
    temporaryDirectories.push(sessionDir);

    const { verdict } = writeCanonicalEvidence({
      sessionId: 'synthetic-action',
      sessionDir,
      durationSec: 1,
      videoPath: path.join(sessionDir, 'unused.webm'),
      recordingWasActive: false,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'eval [REDACTED_SCRIPT]',
          category: 'synthetic-dom',
          intent: {
            command: 'eval',
            summary: 'eval [REDACTED_SCRIPT]',
          },
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
          outcome: 'passed',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
    });

    expect(verdict.status).toBe('INCOMPLETE');
    expect(verdict.reasons).toContain(
      'Synthetic DOM mutation is diagnostic-only and cannot serve as final behavioral proof.',
    );
  });

  it('marks interrupted browser actions without an outcome as incomplete', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-interrupted-action-'),
    );
    temporaryDirectories.push(sessionDir);

    const { verdict } = writeCanonicalEvidence({
      sessionId: 'interrupted-action',
      sessionDir,
      durationSec: 1,
      videoPath: path.join(sessionDir, 'unused.webm'),
      recordingWasActive: false,
      consoleEvidenceAvailable: true,
      actions: [
        {
          action: 'click @e1',
          category: 'pointer-keyboard',
          relativeTimeSec: 0,
          timestamp: '2026-08-09T00:00:00.000Z',
        },
      ],
      consoleEntries: [],
      serverEntries: [],
    });

    expect(verdict.status).toBe('INCOMPLETE');
    expect(verdict.reasons).toContain(
      '1 browser action(s) had no recorded outcome.',
    );
  });
});

function environmentEvent(
  text: string,
  relativeTimeSec: number,
): EvidenceEvent {
  return {
    version: 1,
    origin: 'environment',
    group: 'frontend',
    sourceId: 'vite',
    sourceTitle: 'Vite',
    stream: 'file',
    segment: 'live',
    timestamp: new Date(
      Date.parse('2026-08-09T00:00:00.000Z') +
        relativeTimeSec * 1000,
    ).toISOString(),
    relativeTimeSec,
    text,
  };
}
