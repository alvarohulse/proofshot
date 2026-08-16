import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendSessionLogEntry, loadSessionLog } from './action-log.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('session action log', () => {
  it('sanitizes page-controlled labels before persistence', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-action-log-'),
    );
    temporaryDirectories.push(sessionDir);

    appendSessionLogEntry(sessionDir, {
      action: 'click @e1',
      relativeTimeSec: 1,
      timestamp: '2026-08-16T00:00:00.000Z',
      element: {
        label:
          'Authorization: Basic cHJpdmF0ZTpzZWNyZXQ= https://example.test/token/private-label',
        bbox: { x: 1, y: 2, width: 3, height: 4 },
        viewport: { width: 1280, height: 720 },
      },
    });

    const serialized = fs.readFileSync(
      path.join(sessionDir, 'session-log.json'),
      'utf-8',
    );
    expect(serialized).not.toContain('cHJpdmF0ZTpzZWNyZXQ=');
    expect(serialized).not.toContain('private-label');
    expect(loadSessionLog(sessionDir)[0]?.element?.label).toContain(
      '[REDACTED]',
    );
  });
});
