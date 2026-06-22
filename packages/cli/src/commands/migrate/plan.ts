// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
} from '../../utils/format.js';
import { bootSchemaStack, renderPlan, summarize } from '../../utils/schema-migrate.js';

/**
 * `os migrate plan` — dry-run diff of metadata vs the physical database,
 * categorised safe / needs-confirm / destructive (issue #2186). Never mutates
 * the schema.
 */
export default class MigratePlan extends Command {
  static override description =
    'Show how the physical database has drifted from metadata (dry run; no changes applied)';

  static override examples = [
    '$ os migrate plan',
    '$ os migrate plan --json',
    '$ os migrate plan --database-url postgres://localhost/app',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigratePlan);
    const timer = createTimer();

    if (!flags.json) {
      printHeader('Migrate · plan');
      printStep('Booting schema stack…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({ databaseUrl: flags['database-url'] });
    } catch (error: any) {
      if (flags.json) { console.log(JSON.stringify({ error: error.message })); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      if (!stack.driver) {
        if (flags.json) { console.log(JSON.stringify({ error: 'no_sql_driver', changes: [] })); return; }
        printWarning('Schema migration is only supported on SQL drivers (SQLite / Postgres). No SQL driver is active.');
        return;
      }

      const drift = await stack.driver.detectManagedDrift();

      if (flags.json) {
        console.log(JSON.stringify({
          database: stack.dbLabel,
          managedTables: stack.managedTableCount,
          total: drift.length,
          changes: drift,
          duration: timer.elapsed(),
        }, null, 2));
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      printInfo(`Examined ${chalk.white(String(stack.managedTableCount))} managed table(s).`);
      console.log('');

      if (drift.length === 0) {
        printSuccess('Physical schema is in sync with metadata — nothing to migrate.');
        console.log('');
        return;
      }

      renderPlan(drift);
      printInfo(summarize(drift));
      console.log(chalk.dim('  Apply with: ') + chalk.white('os migrate apply') +
        chalk.dim(' (add --allow-destructive for drops / tightenings)'));
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
    } catch (error: any) {
      if (flags.json) { console.log(JSON.stringify({ error: error.message })); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
