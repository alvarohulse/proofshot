import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import type { EnvironmentState, EvidenceEvent } from '../environment/types.js';

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>(
    'child_process',
  );
  return {
    ...actual,
    execFileSync: vi.fn(() =>
      JSON.stringify({
        format: {
          start_time: '0',
          duration: '284.9',
        },
      }),
    ),
  };
});

import { writeCanonicalEvidence } from './evidence.js';

const temporaryDirectories: string[] = [];
const TEST_IMAGE = new PNG({ width: 2, height: 1 });
TEST_IMAGE.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
const VALID_PNG = PNG.sync.write(TEST_IMAGE);

afterEach(() => {
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
        title: 'https://example.test',
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
