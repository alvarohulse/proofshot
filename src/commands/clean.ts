import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { hasActiveSession, resolveSessionControlDir } from '../session/state.js';

export async function cleanCommand(): Promise<void> {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const outputDir = path.resolve(config.output);

  if (hasActiveSession(controlDir)) {
    console.error(
      chalk.red('✗') +
        ' Cannot clean while a ProofShot session owns browser or server processes.\n' +
        chalk.dim('Run "proofshot stop" first so exact cleanup metadata is preserved.'),
    );
    process.exit(1);
    return;
  }

  if (!fs.existsSync(outputDir)) {
    console.log(chalk.dim('Nothing to clean — no artifacts directory found.'));
    return;
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  console.log(chalk.green('✓') + ` Removed ${chalk.dim(outputDir)}`);
}
