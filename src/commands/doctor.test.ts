import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findConfigPathMock, loadConfigMock, loadSessionMock, listRegisteredSessionsMock, resolveSessionControlDirMock, findExecutablePathMock, getTcpListenerInspectorStatusMock, readCommandVersionMock } =
  vi.hoisted(() => ({
    findConfigPathMock: vi.fn(),
    loadConfigMock: vi.fn(),
    loadSessionMock: vi.fn(),
    listRegisteredSessionsMock: vi.fn(),
    resolveSessionControlDirMock: vi.fn(),
    findExecutablePathMock: vi.fn(),
    getTcpListenerInspectorStatusMock: vi.fn(),
    readCommandVersionMock: vi.fn(),
  }));

vi.mock('../utils/config.js', () => ({
  findConfigPath: findConfigPathMock,
  loadConfig: loadConfigMock,
}));

vi.mock('../session/state.js', () => ({
  loadSession: loadSessionMock,
  resolveSessionControlDir: resolveSessionControlDirMock,
}));
vi.mock('../session/registry.js', () => ({
  listRegisteredSessions: listRegisteredSessionsMock,
}));

vi.mock('../utils/process.js', () => ({
  findExecutablePath: findExecutablePathMock,
  getTcpListenerInspectorStatus: getTcpListenerInspectorStatusMock,
  readCommandVersion: readCommandVersionMock,
}));

import { doctorCommand } from './doctor.js';

describe('doctorCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    findConfigPathMock.mockReturnValue('/tmp/proofshot.config.json');
    loadConfigMock.mockReturnValue({
      output: './proofshot-artifacts',
      headless: true,
      viewport: { width: 1280, height: 720 },
      devServer: { port: 3000, startupTimeout: 30000 },
      defaultPages: ['/'],
    });
    loadSessionMock.mockReturnValue(null);
    listRegisteredSessionsMock.mockReturnValue([]);
    resolveSessionControlDirMock.mockReturnValue('/workspace/proofshot-artifacts');
    findExecutablePathMock.mockImplementation((name: string) => {
      if (name === 'agent-browser') return '/usr/local/bin/agent-browser';
      if (name === 'ffmpeg') return '/opt/homebrew/bin/ffmpeg';
      if (name === 'lsof') return '/usr/sbin/lsof';
      return null;
    });
    getTcpListenerInspectorStatusMock.mockReturnValue({
      available: true,
      command: 'lsof',
      label: 'lsof',
      error: null,
    });
    readCommandVersionMock.mockImplementation((name: string) =>
      name === 'agent-browser' ? 'agent-browser 0.25.3' : 'ffmpeg version 7.0',
    );
  });

  it('prints a diagnostic summary for the current environment', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await doctorCommand();

    const output = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(output).toContain('ProofShot Doctor');
    expect(output).toContain('agent-browser');
    expect(output).toContain('ffmpeg');
    expect(output).toContain('lsof (TCP listener inspection)');
    expect(output).toContain('/usr/sbin/lsof');
    expect(output).toContain('1280x720');
    expect(output).toContain('proofshot-artifacts');
  });

  it('prints an actionable listener-inspection failure', async () => {
    getTcpListenerInspectorStatusMock.mockReturnValue({
      available: false,
      command: 'lsof',
      label: 'lsof',
      error: 'lsof is required to verify listener ownership. Install lsof and retry.',
    });
    findExecutablePathMock.mockImplementation((name: string) => {
      if (name === 'agent-browser') return '/usr/local/bin/agent-browser';
      if (name === 'ffmpeg') return '/opt/homebrew/bin/ffmpeg';
      return null;
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await doctorCommand();

    const output = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(output).toContain('lsof (TCP listener inspection)');
    expect(output).toContain('not found');
    expect(output).toContain('lsof is required');
    expect(output).toContain('Install lsof and retry');
  });
});
