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
 * `os migrate comment-parent-pair` — the stored-row backfill of `sys_comment`'s
 * writer-stamped parent pair, `object_name` + `record_id` (ADR-0139 E7).
 *
 * The comment-thread read gate narrows a comment read with one `ReadableIds`
 * leaf per parent object over the pair. New rows are stamped at write time;
 * rows written before the upgrade carry no pair, and the gate answers them with
 * the bounded thread probe instead — at most 2,000 candidate rows per read,
 * fail closed. So after the upgrade, and until this runs, a broad comment read
 * past that window omits comments the caller may read, and its total agrees
 * with the short answer. Operators run it at once after upgrading, dry run
 * first.
 *
 * Each row is stamped from its `thread_id` by the planner the writer stamps
 * new rows with (`@objectstack/plugin-audit`'s `backfillCommentParentPair`). A
 * row whose thread names no record stays unstamped (hidden from every
 * non-system reader, as before) and is counted.
 *
 * Dry run by default (writes no row), `--apply` to stamp. Idempotent: only
 * unstamped rows are read, so a second run stamps nothing — re-running and
 * reading a clean report is the verification. No `sys_migration` flag is
 * recorded: nothing gates irreversible behaviour on it. The flags are
 * `os migrate activity-changed-fields`'s, one for one.
 */
export default class MigrateCommentParentPair extends Command {
  static override description =
    'Stamp the parent pair (object_name, record_id) on the sys_comment rows written before it existed: until it ' +
    'runs, a broad comment read past 2,000 candidate rows omits comments the caller may read. Dry run by default; ' +
    '--apply writes. Run it at once after upgrading.';

  static override examples = [
    '$ os migrate comment-parent-pair',
    '$ os migrate comment-parent-pair --apply',
    '$ os migrate comment-parent-pair --apply --yes --json',
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
    const { flags } = await this.parse(MigrateCommentParentPair);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · comment-parent-pair');

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
        printWarning('Apply mode stamps sys_comment rows. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nStamp every unstamped sys_comment row on this database? [y/N] '),
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
        throw new Error('No ObjectQL engine on this stack — cannot stamp comment rows.');
      }

      const { backfillCommentParentPair } = await import('@objectstack/plugin-audit');

      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // [#21552] The dry run boots read-only, so the boot's own measurement of
      // which tables exist is not believed: the table is read, and only the
      // refusal of a table that is not there (a database no process has opened)
      // reads as no rows (`absentTableReads`). ⛔ Any other refused read — a
      // `sys_comment` the upgraded schema sync has not yet given its pair
      // columns, included — is still counted in `failures` and still exits
      // non-zero. `--apply` booted plain; its writes go to the engine itself.
      const reads = absentTableReads(stack, (object) => engine.getObject(object));
      const readView: Pick<IObjectQLEngine, 'find' | 'update'> = {
        find: (object, query, options) => reads.rows(object, () => engine.find(object, query, options)),
        update: (object, data, options) => engine.update(object, data, options),
      };

      const report = await backfillCommentParentPair(readView, logger, { apply });

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
        `  ${chalk.white('sys_comment')}: ${report.scanned} unstamped, ${report.stamped} ${apply ? 'stamped' : 'to stamp'}` +
          `, ${report.unparented} name no record`,
      );
      console.log('');

      if (report.failures > 0) {
        printError(`${report.failures} read(s) or row(s) failed — re-run to finish them.`);
      } else if (apply && report.stamped > 0) {
        printSuccess(
          `Stamped ${report.stamped} comment row(s). Re-run any time — it only revisits rows still unstamped.`,
        );
      } else if (!apply && report.stamped > 0) {
        printInfo(`Dry run only — ${report.stamped} row(s) would be stamped. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to stamp — every sys_comment row whose thread names a record is stamped.');
      }
      if (report.unparented > 0) {
        printWarning(
          `${report.unparented} row(s) have a thread_id that names no record: they stay unstamped and, as before, ` +
            'are hidden from every non-system reader.',
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
