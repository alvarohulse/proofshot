import * as path from 'path';
import { parseAgentBrowserBatchCommands } from './provenance.js';

// The runtime pin makes this a closed 0.34.0 contract. Re-audit the complete
// command surface before changing the version or adding an entry here.
const ALLOWED_COMMANDS = new Set([
  'back',
  'batch',
  'check',
  'click',
  'console',
  'cookies',
  'dblclick',
  'drag',
  'errors',
  'eval',
  'fill',
  'find',
  'focus',
  'forward',
  'get',
  'goto',
  'hover',
  'is',
  'key',
  'keyboard',
  'keydown',
  'keyup',
  'mouse',
  'navigate',
  'network',
  'open',
  'press',
  'reload',
  'screenshot',
  'scroll',
  'scrollinto',
  'scrollintoview',
  'select',
  'set',
  'snapshot',
  'storage',
  'tab',
  'type',
  'uncheck',
  'upload',
  'wait',
]);
const PROOFSHOT_OWNED_COMMANDS = new Set([
  'auth',
  'close',
  'connect',
  'record',
  'state',
]);
const RESERVED_AGENT_BROWSER_FLAGS = new Set([
  '--action-policy',
  '--allow-file-access',
  '--allowed-domains',
  '--args',
  '--auto-connect',
  '--cdp',
  '--config',
  '--confirm-actions',
  '--confirm-interactive',
  '--device',
  '--download-path',
  '--enable',
  '--engine',
  '--executable-path',
  '--extension',
  '--headed',
  '--ignore-https-errors',
  '--init-script',
  '--namespace',
  '--no-auto-dialog',
  '--profile',
  '--provider',
  '--proxy',
  '--proxy-bypass',
  '--session',
  '--session-name',
  '--socket-dir',
  '--state',
  '--user-agent',
  '-p',
]);
const ALLOWED_GET_SUBCOMMANDS = new Set([
  'attr',
  'box',
  'count',
  'html',
  'styles',
  'text',
  'title',
  'url',
  'value',
]);
const ALLOWED_COOKIE_OPERATIONS = new Set(['clear', 'get', 'set']);
const ALLOWED_IS_SUBCOMMANDS = new Set(['checked', 'enabled', 'visible']);
const ALLOWED_KEYBOARD_SUBCOMMANDS = new Set(['inserttext', 'type']);
const ALLOWED_MOUSE_SUBCOMMANDS = new Set(['down', 'move', 'up', 'wheel']);
const ALLOWED_SET_SUBCOMMANDS = new Set([
  'credentials',
  'device',
  'geo',
  'headers',
  'media',
  'offline',
  'viewport',
]);
const ALLOWED_STORAGE_TYPES = new Set(['local', 'session']);
const ALLOWED_STORAGE_OPERATIONS = new Set(['clear', 'get', 'set']);
const SCREENSHOT_FLAGS = new Set(['--annotate', '--full', '-f']);
const MAX_BATCH_DEPTH = 8;
const MINIMUM_COMMAND_ARGUMENTS: Record<string, number> = {
  check: 2,
  click: 2,
  dblclick: 2,
  drag: 3,
  eval: 2,
  fill: 3,
  find: 3,
  focus: 2,
  goto: 2,
  hover: 2,
  is: 3,
  key: 2,
  keyboard: 3,
  keydown: 2,
  keyup: 2,
  navigate: 2,
  press: 2,
  scrollinto: 2,
  scrollintoview: 2,
  select: 3,
  type: 3,
  uncheck: 2,
  upload: 3,
  wait: 2,
};

export function assertControlledAgentBrowserCommand(args: string[]): void {
  assertControlledAgentBrowserCommandAtDepth(args, 0);
}

export function prepareControlledAgentBrowserCommand(
  args: string[],
  sessionDir: string,
): string[] {
  assertControlledAgentBrowserCommand(args);
  if (args[0]?.toLowerCase() !== 'screenshot') {
    return args;
  }

  const { filename, flags } = parseScreenshotCommand(args);
  return ['screenshot', path.join(sessionDir, filename), ...flags];
}

export function parseScreenshotCommand(args: string[]): {
  filename: string;
  flags: string[];
} {
  if (args[0]?.toLowerCase() !== 'screenshot') {
    throw new Error('Expected an agent-browser screenshot command.');
  }
  const filename = args.slice(1).find((argument) => !argument.startsWith('-'));
  const flags = args.slice(1).filter((argument) => argument.startsWith('-'));
  assertScreenshotFilename(filename, args);
  if (args.slice(1).filter((argument) => !argument.startsWith('-')).length !== 1) {
    throw new Error('ProofShot screenshots require one PNG filename directly inside the active session.');
  }
  return { filename, flags };
}

function assertControlledAgentBrowserCommandAtDepth(
  args: string[],
  batchDepth: number,
): void {
  const command = args[0]?.toLowerCase();
  if (!command) {
    throw new Error('An agent-browser command is required.');
  }
  if (PROOFSHOT_OWNED_COMMANDS.has(command)) {
    throw new Error(
      `agent-browser ${command} is ProofShot-owned and cannot override browser state.`,
    );
  }
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(
      `agent-browser ${command} is not permitted inside a ProofShot session.`,
    );
  }
  if (batchDepth > 0 && command === 'screenshot') {
    throw new Error(
      'agent-browser screenshot must run as a separate ProofShot action so its output remains session-local.',
    );
  }

  const reservedFlag = args
    .map(normalizeFlag)
    .find((argument) => RESERVED_AGENT_BROWSER_FLAGS.has(argument));
  if (reservedFlag) {
    throw new Error(
      `${reservedFlag} is owned by ProofShot and cannot be passed through proofshot exec.`,
    );
  }

  assertMinimumArguments(command, args);

  switch (command) {
    case 'batch':
      assertBatchCommands(args, batchDepth);
      return;
    case 'console':
    case 'errors':
      if (args.length > 1) {
        throw new Error(
          `agent-browser ${command} options are not permitted because they can destroy ProofShot evidence.`,
        );
      }
      return;
    case 'cookies':
      assertOptionalSubcommand(
        command,
        args[1],
        ALLOWED_COOKIE_OPERATIONS,
      );
      assertCookieArguments(args);
      return;
    case 'get':
      assertAllowedSubcommand(command, args[1], ALLOWED_GET_SUBCOMMANDS);
      assertGetArguments(args);
      return;
    case 'is':
      assertAllowedSubcommand(command, args[1], ALLOWED_IS_SUBCOMMANDS);
      return;
    case 'keyboard':
      assertAllowedSubcommand(command, args[1], ALLOWED_KEYBOARD_SUBCOMMANDS);
      return;
    case 'mouse':
      assertAllowedSubcommand(command, args[1], ALLOWED_MOUSE_SUBCOMMANDS);
      if (args[1]?.toLowerCase() === 'move') {
        requireArguments(args, 4, 'mouse move <x> <y>');
      }
      return;
    case 'network':
      assertNetworkCommand(args);
      return;
    case 'screenshot':
      parseScreenshotCommand(args);
      return;
    case 'set':
      assertAllowedSubcommand(command, args[1], ALLOWED_SET_SUBCOMMANDS);
      assertSetArguments(args);
      return;
    case 'storage':
      assertAllowedSubcommand(command, args[1], ALLOWED_STORAGE_TYPES);
      assertOptionalSubcommand(
        command,
        args[2],
        ALLOWED_STORAGE_OPERATIONS,
      );
      if (args[2]?.toLowerCase() === 'set') {
        requireArguments(args, 5, 'storage <local|session> set <key> <value>');
      }
      return;
    default:
      if (command === 'find' && args[1]?.toLowerCase() === 'nth') {
        requireArguments(args, 4, 'find nth <index> <selector>');
      }
      return;
  }
}

function assertMinimumArguments(command: string, args: string[]): void {
  const minimum = MINIMUM_COMMAND_ARGUMENTS[command];
  if (minimum !== undefined) {
    requireArguments(args, minimum, `${command} requires more arguments`);
  }
}

function requireArguments(args: string[], minimum: number, usage: string): void {
  if (args.length < minimum) {
    throw new Error(`agent-browser command requires: ${usage}.`);
  }
}

function assertCookieArguments(args: string[]): void {
  if (args[1]?.toLowerCase() !== 'set') return;
  const curlIndex = args.findIndex((argument) => normalizeFlag(argument) === '--curl');
  if (curlIndex >= 0) {
    requireArguments(args.slice(curlIndex), 2, 'cookies set --curl <file>');
    return;
  }
  requireArguments(args, 4, 'cookies set <name> <value>');
}

function assertGetArguments(args: string[]): void {
  const subcommand = args[1]?.toLowerCase();
  if (subcommand === 'url' || subcommand === 'title') return;
  requireArguments(
    args,
    subcommand === 'attr' ? 4 : 3,
    subcommand === 'attr'
      ? 'get attr <selector> <attribute>'
      : `get ${subcommand} <selector>`,
  );
}

function assertSetArguments(args: string[]): void {
  const subcommand = args[1]?.toLowerCase();
  switch (subcommand) {
    case 'viewport':
      requireArguments(args, 4, 'set viewport <width> <height>');
      return;
    case 'geo':
      requireArguments(args, 4, 'set geo <latitude> <longitude>');
      return;
    case 'credentials':
      requireArguments(args, 4, 'set credentials <username> <password>');
      return;
    case 'device':
      requireArguments(args, 3, 'set device <name>');
      return;
    case 'headers':
      requireArguments(args, 3, 'set headers <json>');
      return;
    default:
      return;
  }
}

function assertBatchCommands(args: string[], batchDepth: number): void {
  if (batchDepth >= MAX_BATCH_DEPTH) {
    throw new Error('Nested agent-browser batch commands exceed the safe depth.');
  }
  const nestedCommands = parseAgentBrowserBatchCommands(args);
  if (nestedCommands.length === 0) {
    throw new Error('agent-browser batch requires parseable commands.');
  }
  for (const nestedArgs of nestedCommands) {
    assertControlledAgentBrowserCommandAtDepth(nestedArgs, batchDepth + 1);
  }
}

function assertAllowedSubcommand(
  command: string,
  subcommand: string | undefined,
  allowed: Set<string>,
): void {
  const normalized = subcommand?.toLowerCase();
  if (!normalized || !allowed.has(normalized)) {
    throw new Error(
      `agent-browser ${command} ${subcommand || '(missing)'} is not permitted inside a ProofShot session.`,
    );
  }
}

function assertOptionalSubcommand(
  command: string,
  subcommand: string | undefined,
  allowed: Set<string>,
): void {
  if (subcommand && !allowed.has(subcommand.toLowerCase())) {
    throw new Error(
      `agent-browser ${command} ${subcommand} is not permitted inside a ProofShot session.`,
    );
  }
}

function assertNetworkCommand(args: string[]): void {
  const subcommand = args[1]?.toLowerCase();
  if (subcommand === 'har') {
    throw new Error('agent-browser network HAR capture is owned by ProofShot.');
  }
  if (subcommand !== 'requests') {
    throw new Error(
      `agent-browser network ${subcommand || '(missing)'} is not permitted inside a ProofShot session.`,
    );
  }
  if (args.slice(2).some((argument) => normalizeFlag(argument) === '--clear')) {
    throw new Error(
      'agent-browser network requests --clear is not permitted because it destroys ProofShot evidence.',
    );
  }
}

function assertScreenshotFilename(
  filename: string | undefined,
  args: string[],
): asserts filename is string {
  const flags = args.slice(1).filter((argument) => argument.startsWith('-'));
  if (
    !filename ||
    filename.startsWith('-') ||
    path.isAbsolute(filename) ||
    path.basename(filename) !== filename ||
    path.extname(filename) !== '.png' ||
    flags.some((flag) => !SCREENSHOT_FLAGS.has(normalizeFlag(flag)))
  ) {
    throw new Error(
      'ProofShot screenshots require one PNG filename directly inside the active session.',
    );
  }
}

function normalizeFlag(argument: string): string {
  return argument.toLowerCase().split('=', 1)[0];
}
