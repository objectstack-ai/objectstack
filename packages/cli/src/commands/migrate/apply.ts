// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
} from '../../utils/format.js';
import {
  bootSchemaStack,
  renderPlan,
  summarize,
  groupByCategory,
} from '../../utils/schema-migrate.js';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // non-interactive → require --yes
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * `os migrate apply` — reconcile the physical database to metadata (#2186).
 * Applies safe (loosening) + needs-confirm changes by default; destructive
 * changes (drop column, tighten NOT NULL, narrow type) require
 * `--allow-destructive`.
 */
export default class MigrateApply extends Command {
  static override description =
    'Reconcile the physical database to metadata (safe by default; destructive changes need --allow-destructive)';

  static override examples = [
    '$ os migrate apply',
    '$ os migrate apply --yes',
    '$ os migrate apply --allow-destructive --yes',
    '$ os migrate apply --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to reconcile (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    'allow-destructive': Flags.boolean({
      description: 'Also apply destructive changes (drop column, tighten NOT NULL, narrow type)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt', default: false }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to mutate)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateApply);
    const timer = createTimer();
    const allowDestructive = flags['allow-destructive'];

    if (!flags.json) {
      printHeader('Migrate · apply');
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
        if (flags.json) { console.log(JSON.stringify({ error: 'no_sql_driver' })); return; }
        printWarning('Schema migration is only supported on SQL drivers (SQLite / Postgres). No SQL driver is active.');
        return;
      }

      const drift = await stack.driver.detectManagedDrift();
      const grouped = groupByCategory(drift);

      if (drift.length === 0) {
        if (flags.json) { console.log(JSON.stringify({ applied: [], skipped: [], message: 'in_sync' })); return; }
        printSuccess('Physical schema is already in sync with metadata — nothing to apply.');
        return;
      }

      // Entries we intend to apply this run.
      const intended = drift.filter((d) => d.category !== 'destructive' || allowDestructive);
      const deferred = drift.filter((d) => d.category === 'destructive' && !allowDestructive);

      if (!flags.json) {
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        console.log('');
        renderPlan(drift);
        printInfo(summarize(drift));
        if (deferred.length > 0) {
          printWarning(`${deferred.length} destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).`);
        }
        if (allowDestructive && grouped.destructive.length > 0) {
          printWarning('Destructive changes assume your full app/plugin set is loaded. A column that looks "orphaned" here may belong to a plugin that is not part of this build.');
        }
      }

      if (intended.length === 0) {
        if (flags.json) { console.log(JSON.stringify({ applied: [], skipped: deferred, message: 'nothing_safe_to_apply' })); return; }
        printWarning('No changes to apply without --allow-destructive.');
        return;
      }

      // Confirmation gate.
      if (!flags.yes) {
        if (flags.json || !process.stdin.isTTY) {
          if (flags.json) { console.log(JSON.stringify({ applied: [], skipped: drift, message: 'confirmation_required', hint: 'pass --yes' })); return; }
          printWarning('Confirmation required. Re-run with --yes to apply, or use "os migrate plan" to preview.');
          return;
        }
        const ok = await confirm(chalk.bold(`\nApply ${intended.length} change(s) to ${stack.dbLabel}? [y/N] `));
        if (!ok) { printInfo('Aborted — no changes made.'); return; }
      }

      const { applied, skipped } = await stack.driver.applyMigrationEntries(drift, { allowDestructive });

      if (flags.json) {
        console.log(JSON.stringify({
          database: stack.dbLabel,
          applied,
          skipped,
          duration: timer.elapsed(),
        }, null, 2));
        return;
      }

      console.log('');
      printSuccess(`Applied ${applied.length} change(s).`);
      if (skipped.length > 0) {
        printWarning(`Skipped ${skipped.length} change(s) (destructive without --allow-destructive, or unsupported on this dialect).`);
      }
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
