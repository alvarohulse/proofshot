import { describe, expect, it } from 'vitest';
import { parseReplayCase, renderUserTesting } from './case.js';

const validCase = {
  version: 1,
  id: 'create-task',
  description: 'Create a task and confirm it appears.',
  start: { url: 'http://localhost:3000' },
  steps: [
    { command: ['click', '#create'] },
    { command: ['assert-visible', '#created-task'] },
    { command: ['screenshot', 'created-task.png'] },
  ],
  humanTesting: [
    'Open the task board.',
    'Create a task and confirm it appears.',
  ],
};

describe('replay case contract', () => {
  it('accepts a stable flow and renders high-level human instructions', () => {
    const replay = parseReplayCase(validCase);

    expect(replay.steps).toHaveLength(3);
    expect(renderUserTesting(replay)).toBe(
      '# User Testing\n\n1. Open the task board.\n2. Create a task and confirm it appears.\n',
    );
  });

  it('rejects ephemeral snapshot references before execution', () => {
    expect(() =>
      parseReplayCase({
        ...validCase,
        steps: [
          { command: ['click', '@e1'] },
          ...validCase.steps.slice(1),
        ],
      }),
    ).toThrow(/ephemeral snapshot references/);
  });

  it('requires an assertion, screenshot, and human instructions', () => {
    expect(() =>
      parseReplayCase({
        ...validCase,
        steps: [{ command: ['screenshot', 'proof.png'] }],
      }),
    ).toThrow(/assert-visible/);
    expect(() =>
      parseReplayCase({
        ...validCase,
        steps: [{ command: ['assert-visible', '#ready'] }],
      }),
    ).toThrow(/reviewer screenshot/);
    expect(() =>
      parseReplayCase({ ...validCase, humanTesting: [] }),
    ).toThrow(/humanTesting/);
  });

  it('uses the final screenshot filename and rejects multiline instructions', () => {
    expect(
      parseReplayCase({
        ...validCase,
        steps: [
          { command: ['assert-visible', '#ready'] },
          { command: ['screenshot', '--full', 'proof.png'] },
        ],
      }).steps[1].command,
    ).toEqual(['screenshot', 'proof.png', '--full']);
    expect(() =>
      parseReplayCase({
        ...validCase,
        humanTesting: ['Open the page.\nSubmit the form.'],
      }),
    ).toThrow(/one line/);
  });

  it('uses the parsed screenshot filename for duplicate detection', () => {
    expect(() =>
      parseReplayCase({
        ...validCase,
        steps: [
          { command: ['assert-visible', '#ready'] },
          { command: ['screenshot', '--full', 'proof.png'] },
          { command: ['screenshot', 'proof.png'] },
        ],
      }),
    ).toThrow(/reuse screenshot filenames/);

    expect(() =>
      parseReplayCase({
        ...validCase,
        steps: [
          { command: ['assert-visible', '#ready'] },
          { command: ['screenshot', 'proof.PNG'] },
        ],
      }),
    ).toThrow(/PNG filename directly inside/);
  });

  it.each([
    ['is', 'visible'],
    ['check'],
    ['key'],
    ['focus'],
    ['upload', '#file'],
  ])('rejects an incomplete command before replay startup: %j', (...command) => {
    expect(() =>
      parseReplayCase({
        ...validCase,
        steps: [
          { command },
          { command: ['assert-visible', '#ready'] },
          { command: ['screenshot', 'proof.png'] },
        ],
      }),
    ).toThrow(/requires/);
  });

  it('redacts labelled and contextual credentials from human instructions', () => {
    const replay = parseReplayCase({
      ...validCase,
      humanTesting: [
        'Enter password using hunter2.',
        'Log in using private-token.',
      ],
    });

    expect(renderUserTesting(replay)).toBe(
      '# User Testing\n\n1. Enter password using [REDACTED].\n2. Log in using [REDACTED].\n',
    );
  });
});
