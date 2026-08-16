import * as fs from 'fs';
import * as path from 'path';

export interface PageResult {
  page: string;
  title: string;
  url: string;
  screenshotPath: string;
  snapshot: string;
  errors: string;
  consoleOutput: string;
}

export interface VerificationResult {
  pageResults: PageResult[];
  videoPath: string | null;
  outputDir: string;
  timestamp: string;
  framework: string;
  port: number;
  serverAlreadyRunning: boolean;
  durationMs: number;
}

/**
 * Ensure the output directory exists.
 */
export function ensureOutputDir(outputDir: string): void {
  const resolvedOutputDir = path.resolve(outputDir);
  assertRealDirectoryPath(resolvedOutputDir);

  const createdDirectory = fs.mkdirSync(resolvedOutputDir, {
    recursive: true,
    mode: 0o700,
  });
  assertRealDirectoryPath(resolvedOutputDir);

  assertOwnedDirectory(resolvedOutputDir);
  if (createdDirectory !== undefined) {
    fs.chmodSync(resolvedOutputDir, 0o700);
  }
  assertPrivateDirectory(resolvedOutputDir);
}

function assertRealDirectoryPath(directoryPath: string): void {
  const root = path.parse(directoryPath).root;
  const relativePath = path.relative(root, directoryPath);
  const components = relativePath === '' ? [] : relativePath.split(path.sep);
  let componentPath = root;

  for (const component of components) {
    componentPath = path.join(componentPath, component);
    const componentStat = fs.lstatSync(componentPath, {
      throwIfNoEntry: false,
    });
    if (componentStat === undefined) {
      return;
    }
    if (!componentStat.isDirectory() || componentStat.isSymbolicLink()) {
      throw new Error(
        `ProofShot output path component must be a real directory: ${componentPath}`,
      );
    }
  }
}

function assertOwnedDirectory(outputDir: string): fs.Stats {
  const directoryStat = fs.lstatSync(outputDir);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`ProofShot output must be a real directory: ${outputDir}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && directoryStat.uid !== uid) {
    throw new Error(`ProofShot output must be owned by the current user: ${outputDir}`);
  }
  return directoryStat;
}

function assertPrivateDirectory(outputDir: string): void {
  const directoryStat = assertOwnedDirectory(outputDir);
  const uid = process.getuid?.();
  if (uid !== undefined && (directoryStat.mode & 0o777) !== 0o700) {
    throw new Error(
      `ProofShot output must already be private; refusing to change permissions: ${outputDir}`,
    );
  }
  fs.accessSync(
    outputDir,
    fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
  );
}

/**
 * Slugify a page path for use in filenames.
 * "/" -> "home", "/dashboard" -> "dashboard", "/settings/profile" -> "settings-profile"
 */
export function slugifyPage(pagePath: string): string {
  if (pagePath === '/' || pagePath === '') return 'home';
  return pagePath
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '');
}

/**
 * Generate a timestamp string for filenames.
 */
export function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/**
 * Generate a session folder name from timestamp and optional description.
 * e.g. "2026-02-27_14-22-09_verify-settings-page" or "2026-02-27_14-22-09"
 */
export function generateSessionDirName(timestamp: string, description: string | null): string {
  if (!description) return timestamp;
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return slug ? `${timestamp}_${slug}` : timestamp;
}

/**
 * Count interactive elements from a snapshot string.
 */
export function countInteractiveElements(snapshot: string): {
  buttons: number;
  links: number;
  forms: number;
  inputs: number;
} {
  const buttons = (snapshot.match(/button/gi) || []).length;
  const links = (snapshot.match(/link|<a /gi) || []).length;
  const forms = (snapshot.match(/form/gi) || []).length;
  const inputs = (snapshot.match(/input|textbox|textarea/gi) || []).length;
  return { buttons, links, forms, inputs };
}

/**
 * Count console errors from the errors string.
 */
export function countErrors(errors: string): number {
  if (!errors || errors.trim() === '' || errors.trim() === 'No errors') return 0;
  return errors.split('\n').filter((line) => line.trim()).length;
}

/**
 * Count console warnings from console output.
 */
export function countWarnings(consoleOutput: string): number {
  if (!consoleOutput) return 0;
  return (consoleOutput.match(/warn/gi) || []).length;
}

/**
 * Get all artifact file paths in the output directory.
 */
export function listArtifacts(outputDir: string): string[] {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir).map((f) => path.join(outputDir, f));
}
