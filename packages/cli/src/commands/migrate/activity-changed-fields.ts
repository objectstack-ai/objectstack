// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
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
  errorCodeFields,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';

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
 * `os migrate activity-changed-fields` — the stored-row backfill of
 * `sys_activity`'s two writer-stamped read-rule columns (ADR-0139 D4, E6).
 *
 * The activity stream's withheld-row rule is a predicate over `changed_fields`
 * (the key set of a row's recorded change) and `milestone_key` (a fired
 * milestone's watched-field key). New rows are stamped at write time; rows
 * written before the upgrade carry no stamp, and an unstamped row is withheld
 * from every non-system reader. So after the upgrade, and until this runs, an
 * activity feed shows only the rows written since. Operators run it at once
 * after upgrading, dry run first.
 *
 * Both columns are stamped in one run, by the planner the writer stamps new
 * rows with (`@objectstack/plugin-audit`'s `backfillActivityChangedFields`). A
 * row the planner cannot judge stays unstamped (withheld) and is counted.
 *
 * Dry run by default (writes no row), `--apply` to stamp. Idempotent: only
 * unstamped rows are read, so a second run stamps nothing — re-running and
 * reading a clean report is the verification. No `sys_migration` flag is
 * recorded: nothing gates irreversible behaviour on it. The flags are
 * `os migrate audit-metadata-bodies`'s, one for one.
 */
export default class MigrateActivityChangedFields extends Command {
  static override description =
    'Stamp the two read-rule columns (changed_fields, milestone_key) on the sys_activity rows written before ' +
    'they existed: until it runs, those rows are withheld from every non-system reader. Dry run by default; ' +
    '--apply writes. Run it at once after upgrading.';

  static override examples = [
    '$ os migrate activity-changed-fields',
    '$ os migrate activity-changed-fields --apply',
    '$ os migrate activity-changed-fields --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Stamp the unstamped rows (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateActivityChangedFields);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · activity-changed-fields');

    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (flags.json) {
        await emitJson(
          { error: 'database_busy', database: occupancy.filename, signal: occupancy.signal, detail: occupancy.detail, hint: OCCUPANCY_HINT },
          0,
          { compact: true },
        );
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
        ? `--force: ${describeOccupancy(occupancy)} Stamping anyway — the live process may write rows mid-walk.`
        : `${describeOccupancy(occupancy)} The dry run below writes no row or table, but its counts may shift while that process is running. ${JOURNAL_MODE_SWITCH_NOTE}`);
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
        printWarning('Apply mode stamps sys_activity rows. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nStamp every unstamped sys_activity row on this database? [y/N] '),
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
      // [#21349] The dry run boots READ-ONLY — the same boot `os migrate plan`
      // takes: `deferSchemaDdl` holds schema DDL back and suppresses the
      // artifact's inline seed loader (whose upserts rewrite every seeded row
      // of the app's tables), and `readOnlyProbe` keeps a missing sqlite file
      // from being created. `--apply` keeps the plain boot, unchanged.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins({ audit: true }),
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      // `SchemaStack.kernel` is untyped, so the slot's contract is stated on the
      // RESULT — the `objectql` slot serves `IObjectQLEngine`, whose `find` /
      // `update` are exactly what the backfill calls.
      const engine = stack.kernel.getService('objectql') as IObjectQLEngine | undefined;
      if (typeof engine?.find !== 'function' || typeof engine?.update !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot stamp activity rows.');
      }

      const { backfillActivityChangedFields } = await import('@objectstack/plugin-audit');

      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // [#21552] The dry run's read-only boot lists `sys_activity` — rotation-
      // managed, its base name a view over time-sharded tables — as a table to
      // create, so the boot's measurement is not believed: the table is read,
      // and only the refusal of a table that is not there reads as no rows
      // (`absentTableReads`). ⛔ Any other refused read is still counted in
      // `failures` and still exits non-zero. `--apply` booted plain; its writes
      // go to the engine itself.
      const reads = absentTableReads(stack, (object) => engine.getObject(object));
      const readView: Pick<IObjectQLEngine, 'find' | 'update'> = {
        find: (object, query, options) => reads.rows(object, () => engine.find(object, query, options)),
        update: (object, data, options) => engine.update(object, data, options),
      };

      const report = await backfillActivityChangedFields(readView, logger, { apply });

      if (flags.json) {
        reads.notice(true);
        await emitJson({ database: stack.dbLabel, apply, report, duration: timer.elapsed() });
        if (report.failures > 0) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      reads.notice(false);
      console.log('');
      console.log(
        `  ${chalk.white('sys_activity')}: ${report.scanned} unstamped, ${report.stamped} ${apply ? 'stamped' : 'to stamp'}` +
          ` (${report.milestones} milestone), ${report.unjudged} cannot be judged`,
      );
      console.log('');

      if (report.failures > 0) {
        printError(`${report.failures} read(s) or row(s) failed — re-run to finish them.`);
      } else if (apply && report.stamped > 0) {
        printSuccess(
          `Stamped ${report.stamped} activity row(s). Re-run any time — it only revisits rows still unstamped.`,
        );
      } else if (!apply && report.stamped > 0) {
        printInfo(`Dry run only — ${report.stamped} row(s) would be stamped. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to stamp — every sys_activity row the planner can judge is stamped.');
      }
      if (report.unjudged > 0) {
        printWarning(
          `${report.unjudged} row(s) cannot be judged (a milestone row naming no readable watched-field list): ` +
            'they stay unstamped and are withheld from every non-system reader until retention ages them out.',
        );
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (report.failures > 0) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
