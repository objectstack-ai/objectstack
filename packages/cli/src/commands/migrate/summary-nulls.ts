// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
// Type-only, so the heavy engine package is still loaded lazily below: this is
// the surface the migration actually needs, which is wider than the `objectql`
// slot contract by exactly one member (`getOwnedSummaryDescriptors`). Naming it
// here keeps the call site checked instead of erasing the lookup to `any`
// (#4168/#4251).
import type { SummaryBackfillEngine } from '@objectstack/objectql';

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
 * `os migrate summary-nulls` — the one-off backfill of roll-up `count`/`sum`
 * columns left `NULL` by inserts predating PR #6013 (#6063, the second half of
 * #5749).
 *
 * PR #6013 fixed the producer: a parent created from that release on starts its
 * `count`/`sum` roll-ups at 0. It cannot reach rows that already exist, and the
 * recompute only ever visits a parent when one of its CHILDREN is written — so
 * a database upgraded IN PLACE keeps pre-upgrade parents at `NULL`, and every
 * `= 0` filter, sort, GROUP BY and formula over the column silently drops them.
 * A freshly seeded database has no such rows; this command is for the other
 * kind, and is needed exactly once per deployment.
 *
 * Dry run by default (writes nothing at all), `--apply` to backfill. Each
 * `NULL` row is RECOMPUTED — a pre-upgrade parent that has children is `NULL`
 * too and its correct value is the real aggregate, so writing 0 everywhere
 * would swap a missing value for a wrong one. Idempotent: a second run finds
 * nothing left to do.
 *
 * `min`/`max`/`avg` are never touched — undefined on an empty set, so a `null`
 * there is the correct reading of "no child rows", not a defect.
 *
 * ## No deployment flag, deliberately
 *
 * Its siblings (`files-to-references`, `value-shapes`) record a `sys_migration`
 * flag because that flag is what later OPENS irreversible behaviour on the
 * deployment. Nothing is gated on this run: it repairs values and changes no
 * posture, and its own idempotence is the verification (re-run; a clean report
 * is the evidence). A flag here would be a fact nothing reads.
 */
export default class MigrateSummaryNulls extends Command {
  static override description =
    'Backfill roll-up count/sum summary columns still stored as NULL on parent rows created before the ' +
    'insert-time seed (#5749). Dry-run by default; --apply recomputes and writes each affected row.';

  static override examples = [
    '$ os migrate summary-nulls',
    '$ os migrate summary-nulls --apply',
    '$ os migrate summary-nulls --apply --yes --json',
    '$ os migrate summary-nulls --object project',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Write the recomputed values (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    object: Flags.string({
      description: 'Restrict to this object (repeatable; default: every object owning a count/sum roll-up)',
      multiple: true,
    }),
    'max-records': Flags.integer({
      description: 'Safety bound on parent rows read per object — exceeding it truncates the walk',
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateSummaryNulls);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · summary-nulls');

    // Occupancy gate, like `files-to-references`: an apply run rewrites ROWS,
    // so a second writer on the same SQLite file is a real hazard. Probed
    // before boot (afterwards our own pool is what the probe finds) and before
    // the prompt, so an operator is never asked to confirm a run we refuse.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
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
    if (occupancy.status === 'busy' && !flags.json) {
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Backfilling anyway — the live process may write rows mid-walk.`
        : `${describeOccupancy(occupancy)} The dry run below writes nothing, but its counts may shift while that process is running.`);
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning('Apply mode rewrites record data. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nRecompute and write every NULL count/sum roll-up value on this database? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — no changes made.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (dry run)…');
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins(),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      const engine: SummaryBackfillEngine = stack.kernel.getService('objectql');
      if (typeof engine?.getOwnedSummaryDescriptors !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot read the roll-up index.');
      }
      // An empty walk is indistinguishable from a clean one, and "clean" is the
      // answer an operator will act on — so refuse to run when no app metadata
      // is loaded (missing artifact / wrong directory) rather than report a
      // database the walk never looked at.
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the walk would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }

      const { backfillSummaryNulls, formatSummaryBackfillReport } = await import('@objectstack/objectql');

      // In JSON mode keep stdout parseable — route warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const report = await backfillSummaryNulls(engine, logger, {
        apply,
        objects: flags.object,
        maxRecordsPerObject: flags['max-records'],
      });

      if (flags.json) {
        await emitJson({ database: stack.dbLabel, apply, report, duration: timer.elapsed() });
        if (report.failures.length > 0) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      console.log(formatSummaryBackfillReport(report).join('\n'));
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be recomputed — re-run to finish them.`);
      } else if (apply && report.filled > 0) {
        printSuccess(
          `Backfilled ${report.filled} roll-up value(s) across ${report.fields.length} column(s). ` +
            'Re-run any time — it only ever revisits rows still holding NULL.',
        );
      } else if (apply) {
        printSuccess('Nothing to backfill — every count/sum roll-up already holds a value.');
      } else if (report.nullRows > 0) {
        printInfo(`Dry run only — ${report.nullRows} value(s) would be recomputed. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to backfill — every count/sum roll-up already holds a value.');
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (report.failures.length > 0) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
