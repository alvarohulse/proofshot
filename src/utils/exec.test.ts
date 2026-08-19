import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAgentBrowserInvocation,
  executeAgentBrowser,
  getAgentBrowserEnvironment,
  setAgentBrowserDefaults,
} from './exec.js';

const temporaryDirectories: string[] = [];

describe('agent-browser argv execution', () => {
  beforeEach(() => {
    setAgentBrowserDefaults({
      executablePath: '/opt/node24/bin/agent-browser',
    });
  });

  afterEach(() => {
    setAgentBrowserDefaults({});
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses commands before an executable is verified', () => {
    setAgentBrowserDefaults({});

    expect(() => buildAgentBrowserInvocation(['open', 'http://localhost:3000'])).toThrow(
      'agent-browser executable path has not been verified',
    );
  });

  it('prepends owned flags as discrete arguments', () => {
    expect(
      buildAgentBrowserInvocation(['snapshot', '-i'], {
        configPath: '/tmp/agent browser.json',
        json: true,
        session: "proofshot-o'connor",
      }),
    ).toEqual({
      executablePath: '/opt/node24/bin/agent-browser',
      args: [
        '--config',
        '/tmp/agent browser.json',
        '--session',
        "proofshot-o'connor",
        '--json',
        'snapshot',
        '-i',
      ],
    });
  });

  it('applies default config and exact executable options to later commands', () => {
    setAgentBrowserDefaults({
      configPath: '/tmp/project-agent-browser.json',
      executablePath: '/opt/node 24/bin/agent-browser',
    });

    expect(buildAgentBrowserInvocation(['snapshot', '-i'])).toEqual({
      executablePath: '/opt/node 24/bin/agent-browser',
      args: [
        '--config',
        '/tmp/project-agent-browser.json',
        'snapshot',
        '-i',
      ],
    });
  });

  it('routes agent-browser FFmpeg calls through the quiet wrapper', () => {
    const environment = getAgentBrowserEnvironment(
      {},
      () => '/private/proofshot/ffmpeg-bin',
    );

    expect(environment.PATH?.split(path.delimiter)[0]).toBe(
      '/private/proofshot/ffmpeg-bin',
    );
  });

  it('reuses the exact wrapper accepted during recording preflight', () => {
    setAgentBrowserDefaults({
      executablePath: '/opt/node24/bin/agent-browser',
      ffmpegWrapperDirectory: '/private/proofshot/accepted-ffmpeg-bin',
    });

    const environment = getAgentBrowserEnvironment({}, () => {
      throw new Error('the accepted wrapper must not be re-derived');
    });

    expect(environment.PATH?.split(path.delimiter)[0]).toBe(
      '/private/proofshot/accepted-ffmpeg-bin',
    );
  });

  it('never prepends a wrapper path containing the platform delimiter', () => {
    const environment = getAgentBrowserEnvironment(
      {},
      () => `/tmp/proof${path.delimiter}state/ffmpeg-bin`,
    );

    expect(environment.PATH).not.toContain(
      `/tmp/proof${path.delimiter}state/ffmpeg-bin`,
    );
  });

  it('keeps shell metacharacters, newlines, URLs, and output paths as argv data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-argv-'));
    temporaryDirectories.push(directory);
    const executablePath = path.join(directory, 'agent browser');
    const markerPath = path.join(directory, 'host-side-effect');
    fs.writeFileSync(
      executablePath,
      '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
      { mode: 0o755 },
    );
    const dangerousUrl = `https://example.test/$(touch ${markerPath});x\n\ty`;
    const dangerousOutputPath = path.join(
      directory,
      `proof $(touch ${markerPath}); screenshot.png`,
    );
    setAgentBrowserDefaults({ executablePath });

    const output = executeAgentBrowser([
      'screenshot',
      dangerousUrl,
      dangerousOutputPath,
    ]);

    expect(JSON.parse(output)).toEqual([
      'screenshot',
      dangerousUrl,
      dangerousOutputPath,
    ]);
    expect(fs.existsSync(markerPath)).toBe(false);
  });
});
