import { describe, expect, it } from 'vitest';
import {
  generateAgentBrowserNamespace,
  generateAgentBrowserSessionName,
} from './state.js';

describe('generateAgentBrowserSessionName', () => {
  it('creates a short, deterministic name when a nonce is supplied', () => {
    const name = generateAgentBrowserSessionName('2026-04-07_22-30-00', 'test-nonce');
    expect(name).toMatch(/^ps-2026-04-[a-f0-9]{12}$/);
    expect(name).toBe(
      generateAgentBrowserSessionName('2026-04-07_22-30-00', 'test-nonce'),
    );
    expect(name.length).toBeLessThanOrEqual(24);
  });

  it('normalizes unsafe characters and keeps concurrent runs collision-safe', () => {
    const first = generateAgentBrowserSessionName("April 7 review / O'Connor", 'one');
    const second = generateAgentBrowserSessionName("April 7 review / O'Connor", 'two');
    expect(first).toMatch(/^ps-april-7-[a-f0-9]{12}$/);
    expect(second).not.toBe(first);
    expect(first).not.toMatch(/[^a-z0-9_-]/);
  });

  it('does not expose a long seed in the socket-facing name', () => {
    expect(
      generateAgentBrowserSessionName('x'.repeat(500), 'bounded'),
    ).toMatch(
      /^ps-x{8}-[a-f0-9]{12}$/,
    );
  });

  it('derives a compact isolated namespace from the immutable session name', () => {
    const namespace = generateAgentBrowserNamespace(
      'ps-2026-04-deadbeef1234',
    );
    expect(namespace).toMatch(/^psn-[a-f0-9]{12}$/);
    expect(namespace).toBe(
      generateAgentBrowserNamespace('ps-2026-04-deadbeef1234'),
    );
  });
});
