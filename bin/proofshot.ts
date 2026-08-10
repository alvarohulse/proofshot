import chalk from 'chalk';
import { createCLI } from '../src/cli.js';
import { formatErrorDetail } from '../src/utils/errors.js';

const program = createCLI();
program.parseAsync().catch((error) => {
  console.error(chalk.red('✗') + ` ${formatErrorDetail(error)}`);
  process.exit(1);
});
