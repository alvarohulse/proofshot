import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { resolveSessionControlDir } from '../session/state.js';
import { listSessionsForControlDir } from '../session/selection.js';

export async function cleanCommand(): Promise<void> {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const outputDir = path.resolve(config.output);

  if (listSessionsForControlDir(controlDir).length > 0) {
    console.error(
      chalk.red('✗') +
        ' Cannot clean while ProofShot has registered session state for this output.\n' +
        chalk.dim(
          'Run "proofshot stop" or "proofshot session clean" first so evidence and exact cleanup metadata are preserved.',
        ),
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
