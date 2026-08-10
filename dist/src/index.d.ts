import { Command } from 'commander';

declare function createCLI(): Command;

interface InstallOptions {
    only?: string;
    skip?: string;
    force?: boolean;
}
declare function installCommand(options: InstallOptions): Promise<void>;

/**
 * Immutable identity for a process which started an isolated process session.
 *
 * A PID alone is not sufficient ownership proof because the operating system
 * can reuse it. `startTime` lets cleanup reject a recycled PID, while the
 * process/session group ids let ProofShot terminate only descendants created
 * by the detached process it started.
 */
interface ProcessIdentity {
    pid: number;
    processGroupId: number;
    sessionId: number;
    startTime: string;
}

interface ServerStartResult {
    alreadyRunning: boolean;
    port: number;
    process: ProcessIdentity;
}
/**
 * Start a dev server command and wait for it to be ready.
 * Only called when the agent provides a --run command.
 * Pipes stdout/stderr to logPath for server error capture.
 */
declare function ensureDevServer(command: string, port: number, startupTimeout: number, logPath: string, onStarted?: (result: ServerStartResult) => void): Promise<ServerStartResult>;

interface DevServerConfig {
    port: number;
    startupTimeout: number;
}
interface ViewportConfig {
    width: number;
    height: number;
}
interface BrowserConfig {
    configPath?: string;
    executablePath?: string;
    ignoreHttpsErrors: boolean;
}
interface ProofShotConfig {
    devServer: DevServerConfig;
    output: string;
    defaultPages: string[];
    viewport: ViewportConfig;
    headless: boolean;
    browser: BrowserConfig;
}
/**
 * Load config from disk, merging with defaults.
 */
declare function loadConfig(startDir?: string): ProofShotConfig;
/**
 * Write config to disk.
 */
declare function writeConfig(config: ProofShotConfig, dir?: string): string;

declare class ProofShotError extends Error {
    cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
interface AgentBrowserCommandOptions {
    configPath?: string;
    session?: string;
    socketDir?: string;
    timeoutMs?: number;
}
/**
 * Execute an agent-browser command via CLI.
 * agent-browser uses a Rust CLI + persistent Node.js daemon architecture,
 * so calling it via CLI is the intended usage pattern.
 */
declare function ab(command: string, timeoutOrOptions?: number | AgentBrowserCommandOptions): string;

/**
 * Check if a port is currently open (something is listening on it).
 * Checks both IPv4 and IPv6 to handle servers that listen on either.
 */
declare function isPortOpen(port: number, host?: string): Promise<boolean>;
/**
 * Wait for a port to become open, polling every intervalMs.
 */
declare function waitForPort(port: number, timeoutMs?: number, intervalMs?: number): Promise<void>;

interface SessionState {
    startedAt: string;
    startDirectory?: string;
    lifecycleStatus?: 'starting' | 'active' | 'stopping' | 'recovery';
    cleanupError?: string | null;
    description: string | null;
    outputDir: string;
    sessionDir: string;
    sessionName: string;
    videoPath: string;
    serverErrorLog: string;
    port: number;
    serverCommand: string | null;
    serverAlreadyRunning: boolean;
    recordingActive: boolean;
    browserLaunchAttempted?: boolean;
    bundleComplete?: boolean;
    browserRetained?: boolean;
    videoTrimComplete?: boolean;
    trimOffsetSec?: number;
    sessionLogAdjusted?: boolean;
    consoleEvidenceAvailable?: boolean;
    consoleErrorCount?: number;
    targetUrl?: string;
    headless?: boolean;
    agentBrowserSocketDir?: string;
    agentBrowserConfigPath?: string;
    serverProcess?: ProcessIdentity | null;
    browserProcess?: ProcessIdentity | null;
    viewport?: {
        width: number;
        height: number;
    };
}
/**
 * Write session state to disk.
 */
declare function saveSession(state: SessionState, controlDir?: string): void;
/**
 * Read session state from disk.
 * Returns null if no active session.
 */
declare function loadSession(controlDir: string): SessionState | null;

interface SessionLogEntry {
    action: string;
    relativeTimeSec: number;
    timestamp: string;
    element?: {
        label: string;
        bbox: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        viewport: {
            width: number;
            height: number;
        };
    };
}

interface TimestampedLogEntry {
    text: string;
    relativeTimeSec: number;
}
interface ViewerData {
    description: string | null;
    serverCommand: string | null;
    durationSec: number;
    videoFilename: string | null;
    entries: SessionLogEntry[];
    consoleErrorCount: number;
    consoleEvidenceAvailable?: boolean;
    serverErrorCount: number;
    consoleOutput?: string;
    serverLog?: string;
    consoleEntries?: TimestampedLogEntry[];
    serverEntries?: TimestampedLogEntry[];
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
        source: string;
    } | null;
}
/**
 * Generate a standalone HTML viewer file from session data.
 */
declare function generateViewer(data: ViewerData): string;
/**
 * Write the viewer HTML file to the output directory.
 * Returns the path to the generated file, or null if no session log exists.
 */
declare function writeViewer(outputDir: string, data: Omit<ViewerData, 'entries'> & {
    entries?: SessionLogEntry[];
}): string | null;

interface SessionMetadata {
    branch: string;
    commitSha: string;
    startedAt: string;
    description: string | null;
}
/**
 * Write metadata.json into a session folder.
 * This file persists after proofshot stop (unlike .session.json).
 */
declare function writeMetadata(sessionDir: string, metadata: SessionMetadata): void;
/**
 * Read metadata.json from a session folder.
 * Returns null if the file doesn't exist or is malformed.
 */
declare function loadMetadata(sessionDir: string): SessionMetadata | null;
/**
 * Find all session folders in the output directory that match a given branch.
 * Scans subdirectories for metadata.json, filters by branch name.
 * Returns session directories sorted newest first (by startedAt).
 */
declare function findSessionsForBranch(outputDir: string, branch: string): string[];

interface PRCommentData {
    description: string | null;
    sessionCount: number;
    screenshots: Map<string, string>;
    video: {
        url: string;
        renderMode: 'embed' | 'link';
    } | null;
    errorCount: number;
    branch: string;
    commitSha: string;
}
/**
 * Generate markdown for a GitHub PR comment with embedded uploaded assets.
 * Uses GitHub asset URLs so images and video render inline.
 */
declare function formatPRComment(data: PRCommentData): string;

export { type PRCommentData, type ProofShotConfig, ProofShotError, type SessionLogEntry, type SessionMetadata, type SessionState, ab, createCLI, ensureDevServer, findSessionsForBranch, formatPRComment, generateViewer, installCommand, isPortOpen, loadConfig, loadMetadata, loadSession, saveSession, waitForPort, writeConfig, writeMetadata, writeViewer };
