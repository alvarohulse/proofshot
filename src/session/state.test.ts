import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  clearSession,
  generateAgentBrowserSessionName,
  hasActiveSession,
  reserveOutputSession,
} from './state.js';

describe('generateAgentBrowserSessionName', () => {
  it('prefixes ProofShot session names consistently', () => {
    expect(generateAgentBrowserSessionName('2026-04-07_22-30-00')).toBe(
      'proofshot-2026-04-07_22-30-00',
    );
  });

  it('normalizes unsafe characters', () => {
    expect(generateAgentBrowserSessionName("April 7 review / O'Connor")).toBe(
      'proofshot-april-7-review-o-connor',
    );
  });
});

describe('output session reservation', () => {
  it('atomically reserves an output directory until session state is cleared', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-state-'));

    try {
      reserveOutputSession(outputDir, 'proofshot-first');
      expect(hasActiveSession(outputDir)).toBe(true);
      expect(() => reserveOutputSession(outputDir, 'proofshot-second')).toThrow();

      clearSession(outputDir, 'proofshot-second');
      expect(hasActiveSession(outputDir)).toBe(true);

      clearSession(outputDir, 'proofshot-first');
      expect(hasActiveSession(outputDir)).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
