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
});
