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
  emitJson,
} from '../../utils/format.js';
import {
  bootSchemaStack,
  renderPlan,
  renderPendingSchemaWork,
  summarize,
  summarizePendingSchemaWork,
  groupByCategory,
} from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';

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
 *
 * Two operational-safety guarantees, both added by #3917:
 *
 * 1. **Nothing is written before you say yes.** The stack boots with schema
 *    DDL deferred and the artifact seed suppressed, so the additive
 *    create-table / add-column work that used to run during boot is now part
 *    of the plan you confirm — not something that already happened by the time
 *    the prompt appeared.
 * 2. **A database somebody else is using is not migrated by accident.** The
 *    SQLite target is probed for other attached connections before boot, and a
 *    busy database refuses without `--force`.
 */
export default class MigrateApply extends Command {
  static override description =
    'Reconcile the physical database to metadata (safe by default; destructive changes need --allow-destructive)';

  static override examples = [
    '$ os migrate apply',
    '$ os migrate apply --yes',
    '$ os migrate apply --allow-destructive --yes',
    '$ os migrate apply --force',
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
    force: Flags.boolean({
      description: 'Migrate even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to mutate)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateApply);
    const timer = createTimer();
    const allowDestructive = flags['allow-destructive'];

    if (!flags.json) {
      printHeader('Migrate · apply');
      printStep('Checking whether the database is in use…');
    }

    // Occupancy gate — BEFORE the stack boots, or our own pooled connections
    // are what the probe finds (#3917).
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && !flags.force) {
      if (flags.json) {
        await emitJson({
          error: 'database_busy',
          database: occupancy.filename,
          signal: occupancy.signal,
          detail: occupancy.detail,
          hint: OCCUPANCY_HINT,
        }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(describeOccupancy(occupancy));
      printWarning(OCCUPANCY_HINT);
      this.exit(1);
      return;
    }
    if (occupancy.status === 'busy' && flags.force && !flags.json) {
      printWarning(`--force: ${describeOccupancy(occupancy)} Migrating anyway — the live process may see stale schema or SQLITE_BUSY.`);
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (!flags.json) {
      printStep('Booting schema stack…');
    }

    let stack;
    try {
      // `deferSchemaDdl` is what makes the prompt below meaningful: without it
      // the boot has already created tables and added columns by this point.
      stack = await bootSchemaStack({ jsonOutput: flags.json, databaseUrl: flags['database-url'], deferSchemaDdl: true });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      if (!stack.driver) {
        if (flags.json) { await emitJson({ error: 'no_sql_driver' }, 0, { compact: true }); return; }
        printWarning('Schema migration is only supported on SQL drivers (SQLite / Postgres). No SQL driver is active.');
        return;
      }

      const drift = await stack.driver.detectManagedDrift();
      const grouped = groupByCategory(drift);
      // Additive work the boot sync was held back from doing. Not drift — it
      // is what `initObjects` does on its own — but it IS a change to the
      // target database, so it belongs in the plan and behind the prompt.
      const pending = stack.pendingSchemaWork;

      if (drift.length === 0 && pending.length === 0) {
        if (flags.json) { await emitJson({ applied: [], skipped: [], created: [], message: 'in_sync' }, 0, { compact: true }); return; }
        printSuccess('Physical schema is already in sync with metadata — nothing to apply.');
        return;
      }

      // Entries we intend to apply this run.
      const intended = drift.filter((d) => d.category !== 'destructive' || allowDestructive);
      const deferred = drift.filter((d) => d.category === 'destructive' && !allowDestructive);

      if (!flags.json) {
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        console.log('');
        await renderPendingSchemaWork(pending);
        renderPlan(drift);
        if (pending.length > 0) printInfo(await summarizePendingSchemaWork(pending));
        printInfo(summarize(drift));
        if (deferred.length > 0) {
          printWarning(`${deferred.length} destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).`);
        }
        if (allowDestructive && grouped.destructive.length > 0) {
          printWarning('Destructive changes assume your full app/plugin set is loaded. A column that looks "orphaned" here may belong to a plugin that is not part of this build.');
        }
      }

      const totalIntended = intended.length + pending.length;
      if (totalIntended === 0) {
        if (flags.json) { await emitJson({ applied: [], skipped: deferred, created: [], message: 'nothing_safe_to_apply' }, 0, { compact: true }); return; }
        printWarning('No changes to apply without --allow-destructive.');
        return;
      }

      // Confirmation gate. Nothing above this line has touched the database.
      if (!flags.yes) {
        if (flags.json || !process.stdin.isTTY) {
          if (flags.json) { await emitJson({ applied: [], skipped: drift, pending, message: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true }); return; }
          printWarning('Confirmation required. Re-run with --yes to apply, or use "os migrate plan" to preview.');
          return;
        }
        const ok = await confirm(chalk.bold(`\nApply ${totalIntended} change(s) to ${stack.dbLabel}? [y/N] `));
        if (!ok) { printInfo('Aborted — no changes made.'); return; }
      }

      // Additive work first: a table has to exist before its columns can be
      // reconciled. Drift was detected against the pre-flush database, and a
      // just-created table matches metadata by construction, so the two sets
      // never overlap.
      const created = await stack.flushSchemaDdl();
      const { applied, skipped } = await stack.driver.applyMigrationEntries(drift, { allowDestructive });

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          created,
          applied,
          skipped,
          duration: timer.elapsed(),
        });
        return;
      }

      console.log('');
      if (created.length > 0) {
        printSuccess(`Created/extended ${created.length} table(s): ${await summarizePendingSchemaWork(created)}.`);
      }
      printSuccess(`Applied ${applied.length} change(s).`);
      if (skipped.length > 0) {
        printWarning(`Skipped ${skipped.length} change(s) (destructive without --allow-destructive, or unsupported on this dialect).`);
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
