import { describe, expect, it } from 'vitest';
import { formatError, formatErrorDetail } from './errors.js';

describe('formatErrorDetail', () => {
  it('names every cause collected by cleanup', () => {
    const error = new AggregateError(
      [
        new Error('Log helper for vite did not stop.'),
        new Error('Owned tmux server did not stop.'),
      ],
      'One or more tmux cleanup steps failed.',
    );

    expect(formatErrorDetail(error)).toBe(
      [
        'One or more tmux cleanup steps failed.',
        '  - Log helper for vite did not stop.',
        '  - Owned tmux server did not stop.',
      ].join('\n'),
    );
  });

  it('indents nested aggregate causes', () => {
    const error = new AggregateError(
      [new AggregateError([new Error('inner')], 'outer cause')],
      'summary',
    );

    expect(formatErrorDetail(error)).toBe(
      ['summary', '  - outer cause', '    - inner'].join('\n'),
    );
  });

  it('falls back to the plain message for other errors', () => {
    expect(formatErrorDetail(new Error('boom'))).toBe('boom');
    expect(formatErrorDetail(new AggregateError([], 'nothing collected'))).toBe(
      'nothing collected',
    );
    expect(formatErrorDetail('raw failure')).toBe('raw failure');
    expect(formatError(new Error('boom'))).toBe('boom');
  });
});
