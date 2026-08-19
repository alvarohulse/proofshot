import * as fs from 'fs';
import * as path from 'path';
import { sanitizeDiagnosticMessage } from '../browser/provenance.js';
import { assertControlledAgentBrowserCommand, parseScreenshotCommand } from '../browser/command-policy.js';

export type ReplayCase = {
  version: 1;
  id?: string;
  description: string;
  start: {
    output?: string;
    run?: string;
    port?: number;
    url?: string;
    headed?: boolean;
  };
  steps: Array<{ command: string[] }>;
  humanTesting: string[];
};

export function loadReplayCase(filePath: string): ReplayCase {
  const absolutePath = path.resolve(filePath);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Replay case must be a regular file.');
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
  return parseReplayCase(parsed);
}

export function parseReplayCase(value: unknown): ReplayCase {
  const replay = requireRecord(value, 'replay case');
  if (replay.version !== 1) {
    throw new Error('Replay case version must be 1.');
  }
  const description = requireBoundedString(
    replay.description,
    'description',
    1_000,
  );
  const id = replay.id === undefined
    ? undefined
    : requireBoundedString(replay.id, 'id', 120);
  const start = parseStart(replay.start);
  if (!Array.isArray(replay.steps) || replay.steps.length === 0) {
    throw new Error('Replay case requires at least one step.');
  }
  if (replay.steps.length > 100) {
    throw new Error('Replay case cannot contain more than 100 steps.');
  }
  const steps = replay.steps.map((rawStep, index) => {
    const step = requireRecord(rawStep, `steps[${index}]`);
    if (!Array.isArray(step.command) || step.command.length === 0) {
      throw new Error(`steps[${index}].command must be a non-empty array.`);
    }
    const command = step.command.map((argument, argumentIndex) =>
      requireBoundedString(
        argument,
        `steps[${index}].command[${argumentIndex}]`,
        4_000,
      ),
    );
    if (command.some((argument) => /@e\d+\b/i.test(argument))) {
      throw new Error(
        'Replay cases cannot use ephemeral snapshot references such as @e1.',
      );
    }
    if (command[0] === 'assert-visible' && command.length < 2) {
      throw new Error(
        `steps[${index}].command requires a selector for assert-visible.`,
      );
    }
    if (command[0] === 'screenshot' && command.length < 2) {
      throw new Error(
        `steps[${index}].command requires a filename for screenshot.`,
      );
    }
    const translated = command[0] === 'assert-visible'
      ? ['is', 'visible', ...command.slice(1)]
      : command;
    assertControlledAgentBrowserCommand(translated);
    if (command[0]?.toLowerCase() === 'screenshot') {
      const { filename, flags } = parseScreenshotCommand(command);
      return { command: ['screenshot', filename, ...flags] };
    }
    return { command };
  });
  if (!steps.some(({ command }) => command[0] === 'assert-visible')) {
    throw new Error('Replay case requires an explicit assert-visible step.');
  }
  if (!steps.some(({ command }) => command[0] === 'screenshot')) {
    throw new Error('Replay case requires a reviewer screenshot step.');
  }
  const screenshotPaths = steps
    .filter(({ command }) => command[0] === 'screenshot')
    .map(({ command }) => path.basename(parseScreenshotCommand(command).filename));
  if (new Set(screenshotPaths).size !== screenshotPaths.length) {
    throw new Error('Replay case cannot reuse screenshot filenames.');
  }
  if (!Array.isArray(replay.humanTesting) || replay.humanTesting.length === 0) {
    throw new Error('Replay case requires humanTesting instructions.');
  }
  if (replay.humanTesting.length > 20) {
    throw new Error('Replay case cannot contain more than 20 human instructions.');
  }
  const humanTesting = replay.humanTesting.map((instruction, index) =>
    requireBoundedString(instruction, `humanTesting[${index}]`, 1_000),
  );
  if (humanTesting.some((instruction) => /[\r\n]/.test(instruction))) {
    throw new Error('humanTesting instructions must each fit on one line.');
  }

  return {
    version: 1,
    ...(id ? { id } : {}),
    description,
    start,
    steps,
    humanTesting,
  };
}

export function renderUserTesting(replay: ReplayCase): string {
  const instructions = replay.humanTesting.map((instruction, index) => {
    const sanitized = sanitizeDiagnosticMessage(instruction) || '[REDACTED]';
    return `${index + 1}. ${sanitized}`;
  });
  return `# User Testing\n\n${instructions.join('\n')}\n`;
}

function parseStart(value: unknown): ReplayCase['start'] {
  const start = requireRecord(value, 'start');
  const output = optionalBoundedString(start.output, 'start.output', 4_000);
  const run = optionalBoundedString(start.run, 'start.run', 8_000);
  const url = optionalBoundedString(start.url, 'start.url', 4_000);
  if (start.port !== undefined && typeof start.port !== 'number') {
    throw new Error('start.port must be a number.');
  }
  const port = start.port;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error('start.port must be an integer between 1 and 65535.');
  }
  if (run && port === undefined) {
    throw new Error('start.port is required when start.run is provided.');
  }
  if (!run && !url) {
    throw new Error('Replay start requires either run or url.');
  }
  if (start.headed !== undefined && typeof start.headed !== 'boolean') {
    throw new Error('start.headed must be a boolean.');
  }
  return {
    ...(output ? { output } : {}),
    ...(run ? { run } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(url ? { url } : {}),
    ...(start.headed !== undefined ? { headed: start.headed } : {}),
  };
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maximumLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : requireBoundedString(value, label, maximumLength);
}

function requireBoundedString(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (value.length > maximumLength) {
    throw new Error(`${label} exceeds ${maximumLength} characters.`);
  }
  return value;
}
