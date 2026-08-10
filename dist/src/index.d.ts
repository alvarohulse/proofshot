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

type EnvironmentGroup = 'frontend' | 'backend' | string;
type ReadinessCheck = {
    kind: 'http';
    url: string;
    timeoutMs?: number;
} | {
    kind: 'tcp';
    host?: string;
    port: number;
    timeoutMs?: number;
};
type TmuxPaneDefinition = {
    id: string;
    title?: string;
    group?: EnvironmentGroup;
    cwd?: string;
    command: string;
    env?: Record<string, string>;
};
type TmuxLaunchConfig = {
    kind: 'panes';
    panes: TmuxPaneDefinition[];
    sessionName?: string;
} | {
    kind: 'external-command';
    command: string;
    stopCommand?: string;
};
type TmuxConnectionConfig = {
    source?: 'stdout';
    format: 'json' | 'tmux-attach-command';
    socket?: string;
};
type TmuxEnvironmentConfig = {
    kind: 'tmux';
    launch: TmuxLaunchConfig;
    cwd?: string;
    connection?: TmuxConnectionConfig;
    readiness?: ReadinessCheck[];
};
type ProcessDefinition = {
    id: string;
    title?: string;
    group?: EnvironmentGroup;
    cwd?: string;
    command: string;
    env?: Record<string, string>;
};
type ProcessesEnvironmentConfig = {
    kind: 'processes';
    commands: ProcessDefinition[];
    readiness?: ReadinessCheck[];
};
type EnvironmentConfig = TmuxEnvironmentConfig | ProcessesEnvironmentConfig;
type TmuxPaneMatch = {
    connectionKey: string;
} | {
    tag: string;
} | {
    target: string;
};
type LogSourceConfig = {
    id: string;
    title?: string;
    group?: EnvironmentGroup;
    kind: 'tmux-pane';
    match: TmuxPaneMatch;
    include?: string[];
    exclude?: string[];
} | {
    id: string;
    title?: string;
    group?: EnvironmentGroup;
    kind: 'process';
    processId: string;
    include?: string[];
    exclude?: string[];
} | {
    id: string;
    title?: string;
    group?: EnvironmentGroup;
    kind: 'file';
    path: string;
    include?: string[];
    exclude?: string[];
};
type LogsConfig = {
    stripAnsi?: boolean;
    maxBytesPerSource?: number;
    sources?: LogSourceConfig[];
};
type SocketIdentity = {
    path: string;
    inode: number;
    uid: number;
};
type CaptureProcessState = {
    sourceId: string;
    process: ProcessIdentity;
    pidFile: string;
};
type TmuxPaneState = {
    paneId: string;
    paneIndex: number;
    panePid: number;
    sourceId: string;
    title: string;
    group: EnvironmentGroup;
    target: string;
};
type TmuxEnvironmentState = {
    kind: 'tmux';
    evidencePath: string;
    sources: ResolvedLogSourceState[];
    socket: SocketIdentity;
    serverProcess: ProcessIdentity;
    sessionName: string;
    ownsServer: boolean;
    ownsSession: boolean;
    panes: TmuxPaneState[];
    captures: CaptureProcessState[];
    stopCommand?: string;
    stopCwd?: string;
};
type ProcessEnvironmentState = {
    kind: 'processes';
    evidencePath: string;
    sources: ResolvedLogSourceState[];
    processes: CaptureProcessState[];
};
type EnvironmentState = TmuxEnvironmentState | ProcessEnvironmentState;
type ResolvedLogSourceState = {
    id: string;
    title: string;
    group: EnvironmentGroup;
    kind: LogSourceConfig['kind'];
    stream: EvidenceEvent['stream'];
    logPath: string;
    include?: string[];
    exclude?: string[];
};
type EvidenceEvent = {
    version: 1;
    origin: 'environment' | 'browser';
    group: string;
    sourceId: string;
    sourceTitle: string;
    navigationId?: string;
    pageUrl?: string;
    stream: 'pty' | 'stdout' | 'stderr' | 'file' | 'console';
    segment: 'history' | 'live';
    timestamp: string | null;
    relativeTimeSec: number | null;
    text: string;
    presentationHidden?: boolean;
    truncated?: boolean;
    captureGap?: boolean;
};

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
    environment?: EnvironmentConfig;
    logs: LogsConfig;
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
    environment?: EnvironmentState | null;
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
    outcome?: 'passed' | 'failed';
    expectedSelector?: string;
    error?: string;
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

type VerdictStatus = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'BLOCKED';
type EvidenceSourceSummary = {
    id: string;
    title: string;
    origin: EvidenceEvent['origin'];
    group: string;
    lineCount: number;
    hiddenLineCount: number;
    truncationCount: number;
    captureGapCount: number;
    incidentCount: number;
};
type EvidenceIncident = {
    id: string;
    severity: 'fatal' | 'error';
    group: string;
    message: string;
    count: number;
    sourceIds: string[];
    firstTimeSec: number | null;
    lastTimeSec: number | null;
};
type ScreenshotIntegrity = {
    file: string;
    sha256: string | null;
    validPng: boolean;
    size: number;
};
type CanonicalEvidence = {
    version: 1;
    sessionId: string;
    generatedAt: string;
    timelineDurationSec: number;
    mediaDurationSec: number | null;
    mediaDivergenceSec: number | null;
    mediaTruncated: boolean;
    actions: SessionLogEntry[];
    events: EvidenceEvent[];
    sources: EvidenceSourceSummary[];
    incidents: EvidenceIncident[];
    screenshots: ScreenshotIntegrity[];
};
type Verdict = {
    version: 1;
    status: VerdictStatus;
    reasons: string[];
    fatalIncidentCount: number;
    missingArtifacts: string[];
    duplicateScreenshotHashes: string[][];
    expectedSelectorFailures: string[];
    mediaTruncated: boolean;
};
type EvidenceBuildOptions = {
    sessionId: string;
    sessionDir: string;
    durationSec: number;
    videoPath: string;
    recordingWasActive: boolean;
    consoleEvidenceAvailable: boolean;
    actions: SessionLogEntry[];
    consoleEntries: TimestampedLogEntry[];
    serverEntries: TimestampedLogEntry[];
    environment?: EnvironmentState | null;
};
declare function writeCanonicalEvidence(options: EvidenceBuildOptions): {
    evidence: CanonicalEvidence;
    verdict: Verdict;
};

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
    evidence?: CanonicalEvidence;
    verdict?: Verdict;
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
    repository?: string;
    repositoryRoot?: string;
    treeHash?: string;
    sourceDirty?: boolean;
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

type GitProvenance = {
    repository: string;
    branch: string;
    commitSha: string;
    treeHash: string;
    sourceDirty: boolean;
};
type ManifestArtifactKind = 'screenshot' | 'video' | 'viewer' | 'summary' | 'evidence' | 'verdict' | 'log';
type ManifestArtifact = {
    id: string;
    kind: ManifestArtifactKind;
    path: string;
    sha256: string;
    size: number;
    order: number;
};
type ArtifactManifest = {
    version: 1;
    sessionId: string;
    repository: string;
    branch: string;
    commitSha: string;
    treeHash: string;
    sourceDirty: boolean;
    sourceDrift: boolean;
    startedAt: string;
    finalizedAt: string;
    completion: 'complete';
    verdict: Verdict['status'];
    artifacts: ManifestArtifact[];
};
declare function captureGitProvenance(cwd?: string): GitProvenance;
declare function writeArtifactManifest(options: {
    sessionId: string;
    sessionDir: string;
    metadata: SessionMetadata;
    evidence: CanonicalEvidence;
    verdict: Verdict;
    finalizedProvenance?: GitProvenance;
}): ArtifactManifest;
declare function loadArtifactManifest(sessionDir: string): ArtifactManifest | null;
declare function validateManifestArtifacts(sessionDir: string, manifest: ArtifactManifest): void;

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

declare function startOwnedEnvironment(environment: EnvironmentConfig | undefined, logs: LogsConfig, sessionDir: string, sessionName: string, startTimeMs: number, onState: (state: EnvironmentState) => void): Promise<EnvironmentState | null>;
declare function stopOwnedEnvironment(state: EnvironmentState | null | undefined): Promise<void>;

export { type ArtifactManifest, type CanonicalEvidence, type EnvironmentConfig, type EnvironmentState, type EvidenceIncident, type EvidenceSourceSummary, type GitProvenance, type LogSourceConfig, type LogsConfig, type ManifestArtifact, type PRCommentData, type ProofShotConfig, ProofShotError, type SessionLogEntry, type SessionMetadata, type SessionState, type Verdict, type VerdictStatus, ab, captureGitProvenance, createCLI, ensureDevServer, findSessionsForBranch, formatPRComment, generateViewer, installCommand, isPortOpen, loadArtifactManifest, loadConfig, loadMetadata, loadSession, saveSession, startOwnedEnvironment, stopOwnedEnvironment, validateManifestArtifacts, waitForPort, writeArtifactManifest, writeCanonicalEvidence, writeConfig, writeMetadata, writeViewer };
