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
  errorCodeFields,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { describeDriverSqliteFile } from '../../utils/connection-display.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { refuseUndeclaredObjects } from '../../utils/migrate-object-scope.js';
// Type-only: the engine package is imported dynamically inside run(), never at
// module load, so `os --help` and every other command pay nothing for it.
import type { StoredExpressionBackfillEngine } from '@objectstack/objectql';

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
 * `os migrate stored-expressions` — fill the stored computed fields (a
 * non-`formula` field declaring `expression`) of rows no write has computed
 * since the field was declared.
 *
 * The engine computes such a field on every insert and update, and on nothing
 * else, so a field declared on an object that already holds rows is NULL on
 * every one of them until each is next written. This command computes each
 * through the write's own computation and writes it; the boot names it when
 * a sample of rows holds such a NULL.
 *
 * The command is the shell; the walk, its refusals and its report are
 * `@objectstack/objectql`'s `backfillStoredExpressions` — the split
 * `os migrate summary-nulls` has with `summary-backfill.ts`.
 *
 * Dry run by default (writes no row), `--apply` to write. `--changed` also
 * rewrites values that differ from the expression — the run to make after an
 * expression changed; every run counts them. Rows on which an expression does
 * not evaluate are listed; one that holds a value there is skipped, because
 * the write would store NULL over it. Idempotent: a re-run with nothing
 * listed is the verification. No `sys_migration` flag is recorded: nothing
 * gates on the run.
 */
export default class MigrateStoredExpressions extends Command {
  static override description =
    'Fill stored computed fields (fields declaring an expression, other than formula fields) on rows no write has ' +
    'computed since the field was declared — they hold NULL until each row is next written. Dry run by default; ' +
    '--apply writes, --changed also recomputes values that differ from a changed expression.';

  static override examples = [
    '$ os migrate stored-expressions',
    '$ os migrate stored-expressions --object contract',
    '$ os migrate stored-expressions --object contract --field review_sla_days_offset --apply',
    '$ os migrate stored-expressions --changed --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    object: Flags.string({
      description:
        'Restrict to this object (repeatable; default: every object declaring a stored computed field). A name the ' +
        'deployment does not declare is refused',
      multiple: true,
    }),
    field: Flags.string({
      description: 'One stored computed field of the one --object (default: every one it declares)',
      dependsOn: ['object'],
    }),
    changed: Flags.boolean({
      description:
        'Also recompute rows whose stored value differs from the expression — after an expression changed. An ' +
        'expression reading the clock (now(), today()) recomputes to the current time',
      default: false,
    }),
    apply: Flags.boolean({ description: 'Write the computed values (default is a read-only dry run)', default: false }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    'max-records': Flags.integer({ description: 'Safety bound on rows read per object — exceeding it truncates the walk' }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateStoredExpressions);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · stored-expressions');

    // Occupancy gate, as `summary-nulls`: an apply rewrites ROWS, so a second writer on the same
    // SQLite file is a real hazard. Probed before boot and before the prompt.
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
        ? `--force: ${describeOccupancy(occupancy)} Filling anyway — the live process may write rows mid-walk.`
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
        printWarning('Apply mode rewrites record data. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold(
          `\nCompute and write the stored computed fields ${flags.changed ? 'that are NULL or differ from their expression' : 'still NULL'}` +
            `${flags.object ? ` of ${flags.object.join(', ')}` : ''} on this database? [y/N] `,
        ),
      );
      if (!ok) {
        printInfo('Aborted — no changes made.');
        return;
      }
    }

    if (!flags.json) printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (dry run)…');

    let stack;
    try {
      // The dry run boots read-only, as `summary-nulls` does; `--apply` keeps
      // the plain boot, because the tables and columns must exist before it writes.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins(),
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      const engine: StoredExpressionBackfillEngine = stack.kernel.getService('objectql');
      if (typeof engine?.computeStoredExpressionsOver !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot compute stored expressions.');
      }
      // An empty walk is indistinguishable from a clean one: refuse when no app metadata is loaded.
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the walk would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }
      refuseUndeclaredObjects(flags.object, loadedObjects);

      const { backfillStoredExpressions, formatStoredExpressionBackfillReport } = await import('@objectstack/objectql');

      // In JSON mode keep stdout parseable — route warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const report = await backfillStoredExpressions(engine, logger, {
        apply,
        objects: flags.object,
        field: flags.field,
        changed: flags.changed,
        maxRecordsPerObject: flags['max-records'],
      });
      // Not done while a row could not be written, a row was skipped, or the walk was cut short.
      const gap = report.failures.length > 0 || report.skippedRows > 0 || report.truncated;
      const pending = report.nullRows + (report.changed ? report.staleRows : 0);

      if (flags.json) {
        await emitJson({ database: stack.dbLabel, apply, report, duration: timer.elapsed() });
        if (gap) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      // The report's dry-run line claims no row or table; on a SQLite file the read-only boot's
      // connect may still have switched the journal mode (its header, no row), so the note follows.
      const journalNote = !report.applied && pending > 0
        && describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      console.log(`${formatStoredExpressionBackfillReport(report).join('\n')}${journalNote}`);
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be written — re-run to finish them.`);
      } else if (report.skippedRows > 0) {
        printError(`${report.skippedRows} row(s) were listed and not written — fix each one listed above, then re-run.`);
      } else if (report.truncated) {
        printError('The walk stopped at --max-records: rows past it were not looked at. Re-run with a higher --max-records.');
      } else if (apply && report.writtenRows > 0) {
        printSuccess(`Wrote ${report.writtenRows} row(s). Re-run any time — it only rewrites rows that still differ.`);
      } else if (!apply && pending > 0) {
        printInfo(`Dry run only — ${pending} value(s) would be written. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to fill — every stored computed field already holds its expression\'s value.');
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (gap) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      // `INVALID_FIELD` is the run refusing an object or field before its walk ("Refused before
      // the walk read or wrote any row."). The boot ran first, so on a SQLite file the note follows.
      const journalNote = error?.code === 'INVALID_FIELD'
        && describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      printError(`${error.message || String(error)}${journalNote}`);
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
