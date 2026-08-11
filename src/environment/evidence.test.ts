import { describe, expect, it } from 'vitest';
import { normalizeLogText } from './evidence.js';

const ESC = '\u001B';
const BEL = '\u0007';

describe('normalizeLogText', () => {
  it('strips BEL-terminated OSC sequences without leaving residue', () => {
    expect(normalizeLogText(`${ESC}]0;my-title${BEL}ready in 431 ms`)).toBe(
      'ready in 431 ms',
    );
    expect(
      normalizeLogText(`${ESC}]2;dev server${BEL}${ESC}[32mVITE ready${ESC}[0m`),
    ).toBe('VITE ready');
  });

  it('strips ST-terminated titles and leaves unterminated escapes line-local', () => {
    expect(normalizeLogText(`${ESC}]0;npm run dev${ESC}\\listening`)).toBe(
      'listening',
    );
    // An unterminated sequence must never consume the line that follows it.
    expect(
      normalizeLogText(`${ESC}]0;never closed\nreal line`).endsWith('\nreal line'),
    ).toBe(true);
  });

  it('strips remaining control characters and normalizes newlines', () => {
    expect(normalizeLogText(`a${BEL}bc\r\nd\rE`)).toBe('abc\nd\nE');
  });

  it('keeps ANSI colors when stripping is disabled', () => {
    expect(normalizeLogText(`${ESC}[31mred${ESC}[0m`, false)).toBe(
      `${ESC}[31mred${ESC}[0m`,
    );
  });
});
