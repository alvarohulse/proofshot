import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadConfigForTeardown } from './config.js';

describe('loadConfig', () => {
  it('merges nested browser config with defaults', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-config-test-'));
    fs.writeFileSync(
      path.join(tempDir, 'proofshot.config.json'),
      JSON.stringify({
        browser: {
          executablePath: '/tmp/chrome',
        },
      }),
    );

    expect(loadConfig(tempDir).browser).toEqual({
      configPath: undefined,
      executablePath: '/tmp/chrome',
      ignoreHttpsErrors: false,
    });
  });

  it('resolves browser config paths relative to proofshot.config.json', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-browser-config-path-'));
    fs.writeFileSync(
      path.join(tempDir, 'proofshot.config.json'),
      JSON.stringify({
        browser: {
          configPath: './agent-browser.local.json',
        },
      }),
    );

    expect(loadConfig(tempDir).browser).toEqual({
      configPath: path.join(tempDir, 'agent-browser.local.json'),
      executablePath: undefined,
      ignoreHttpsErrors: false,
    });
  });

  it('resolves control output against the ancestor config from a subdirectory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-output-path-'));
    const nested = path.join(tempDir, 'nested', 'consumer');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'proofshot.config.json'),
      JSON.stringify({ output: './project-proof' }),
    );

    expect(loadConfig(nested).output).toBe(path.join(tempDir, 'project-proof'));
  });

  it('resolves environment runners and file sources relative to the config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-environment-config-'));
    fs.writeFileSync(
      path.join(tempDir, 'proofshot.config.json'),
      JSON.stringify({
        environment: {
          kind: 'tmux',
          launch: {
            kind: 'panes',
            panes: [
              { id: 'vite', command: 'npm run dev', cwd: './frontend' },
              { id: 'api', command: 'npm run api' },
            ],
          },
          cwd: './workspace',
        },
        logs: {
          sources: [
            { id: 'vite', kind: 'tmux-pane', match: { connectionKey: 'vite' } },
            { id: 'worker', kind: 'file', path: './logs/worker.jsonl' },
          ],
        },
      }),
    );

    const config = loadConfig(tempDir);
    expect(config.environment).toMatchObject({
      kind: 'tmux',
      cwd: path.join(tempDir, 'workspace'),
      launch: {
        panes: [
          { id: 'vite', cwd: path.join(tempDir, 'frontend') },
          { id: 'api', cwd: path.join(tempDir, 'workspace') },
        ],
      },
    });
    expect(config.logs.sources?.[1]).toMatchObject({
      kind: 'file',
      path: path.join(tempDir, 'logs', 'worker.jsonl'),
    });
  });

  it('fails closed for malformed or unsafe capture configuration', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-invalid-config-'));
    const configPath = path.join(tempDir, 'proofshot.config.json');

    fs.writeFileSync(
      configPath,
      JSON.stringify({ environment: { kind: 'tmuxx' } }),
    );
    expect(() => loadConfig(tempDir)).toThrow(/environment\.kind/);

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        logs: {
          sources: [{ id: '../escape', kind: 'file', path: './server.log' }],
        },
      }),
    );
    expect(() => loadConfig(tempDir)).toThrow(/logs\.sources\[0\]\.id/);

    fs.writeFileSync(configPath, '{not-json');
    expect(() => loadConfig(tempDir)).toThrow(/Invalid ProofShot config/);
  });

  it('rejects an attach-only launcher that also declares a stop command', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-attach-stop-'));
    const configPath = path.join(tempDir, 'proofshot.config.json');
    const environment = {
      kind: 'tmux',
      launch: {
        kind: 'external-command',
        command: 'npm run dev:tmux',
        stopCommand: 'npm run dev:stop',
      },
      connection: { format: 'json', ownership: 'attach', socket: '/tmp/dev.sock' },
    };

    fs.writeFileSync(configPath, JSON.stringify({ environment }));
    expect(() => loadConfig(tempDir)).toThrow(/attach.*cannot be combined with launch\.stopCommand/);

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environment: { ...environment, connection: { ...environment.connection, ownership: 'create' } },
      }),
    );
    expect(() => loadConfig(tempDir)).not.toThrow();
  });

  it('rejects log sources the configured environment cannot capture', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-source-kind-'));
    const configPath = path.join(tempDir, 'proofshot.config.json');

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environment: { kind: 'processes', commands: [{ id: 'api', command: 'npm run api' }] },
        logs: { sources: [{ id: 'vite', kind: 'tmux-pane', match: { tag: 'vite' } }] },
      }),
    );
    expect(() => loadConfig(tempDir)).toThrow(/requires environment\.kind "tmux"/);

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environment: {
          kind: 'tmux',
          launch: { kind: 'panes', panes: [{ id: 'vite', command: 'npm run dev' }] },
        },
        logs: { sources: [{ id: 'api', kind: 'process', processId: 'api' }] },
      }),
    );
    expect(() => loadConfig(tempDir)).toThrow(/requires environment\.kind "processes"/);

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        logs: { sources: [{ id: 'api', kind: 'process', processId: 'api' }] },
      }),
    );
    expect(() => loadConfig(tempDir)).toThrow(/no environment/);
  });
});

describe('loadConfigForTeardown', () => {
  it('resolves the recorded output directory when the config is invalid', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-teardown-config-'));
    fs.writeFileSync(
      path.join(tempDir, 'proofshot.config.json'),
      JSON.stringify({
        output: './project-proof',
        environment: {
          kind: 'tmux',
          launch: {
            kind: 'panes',
            panes: [
              { id: 'vite', command: 'npm run dev' },
              { id: 'vite', command: 'npm run api' },
            ],
          },
        },
      }),
    );

    const { config, error } = loadConfigForTeardown(tempDir);
    expect(error?.message).toMatch(/Duplicate environment\.launch\.panes id/);
    expect(config.output).toBe(path.join(tempDir, 'project-proof'));
  });

  it('reports no error for a valid config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-teardown-valid-'));
    fs.writeFileSync(
      path.join(tempDir, 'proofshot.config.json'),
      JSON.stringify({ output: './proof' }),
    );

    const { config, error } = loadConfigForTeardown(tempDir);
    expect(error).toBeNull();
    expect(config.output).toBe(path.join(tempDir, 'proof'));
  });
});
