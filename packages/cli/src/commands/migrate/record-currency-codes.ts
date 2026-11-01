// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { isValueDomainMember } from '@objectstack/spec/shared';
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
// Type-only, so the heavy engine package is still loaded lazily below.
import type { RecordCurrencyBackfillEngine } from '@objectstack/objectql';

/**
 * The `--code` refusal, judged before the occupancy probe, the `--apply`
 * prompt and the boot: a code the code field's `valueDomain` would refuse
 * fails the same way on every database, so nothing about the database needs
 * opening to say so, and an `--apply` boot may create tables and columns.
 *
 * The predicate is the one `backfillRecordCurrencyCodes` applies, and the
 * error is its envelope (`INVALID_FIELD` / 400, `httpStatus` for the `--json`
 * face) and its wording, so the answer is the one the engine gave when this
 * was judged after the boot. The code field's name is in the object's
 * declaration, which is not loaded yet, so the message names the amount field
 * the code is owed by. The engine keeps its own check for every other caller.
 */
function refuseNonMemberCurrencyCode(object: string, field: string, code: string): void {
  if (isValueDomainMember('iso_4217_currency', code)) return;
  const err = new Error(
    `[record-currency-backfill] '${code}' is not an ISO 4217 currency code, so the currency code field of ` +
      `'${object}.${field}' would refuse it: give the uppercase alphabetic code of the currency these amounts ` +
      'are in (for example USD). Refused before the database was opened or any row was read.',
  ) as Error & { code: string; status: number; httpStatus: number; field: string };
  err.code = 'INVALID_FIELD';
  err.status = 400;
  err.httpStatus = 400;
  err.field = field;
  throw err;
}

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
 * `os migrate record-currency-codes` — the explicit backfill of the currency
 * code owed by rows stored before an existing amount field was switched to
 * `currencyMode: 'record'` (ADR-0144, ruling 6492000994, letter B).
 *
 * Such a row holds an amount beside a blank code: it displays as a plain
 * number, falls into the `null` group of a grouped aggregate and sits outside
 * every currency-paired filter until it holds a code. The metadata save that
 * makes the switch answers 409 `destructive_change` naming this command.
 *
 * The command is the shell; the walk, its refusals and its report are
 * `@objectstack/objectql`'s `backfillRecordCurrencyCodes` — the split
 * `os migrate summary-nulls` has with `summary-backfill.ts`. The code is the
 * operator's `--code`, ⛔ never derived (ADR-0144 D8 rule 4). Dry run by
 * default (writes no row), `--apply` to write; idempotent, so re-running and
 * reading a clean report is the verification. No `sys_migration` flag is
 * recorded: nothing gates on the run.
 */
export default class MigrateRecordCurrencyCodes extends Command {
  static override description =
    'Write a currency code into the rows of a record-mode currency field that hold an amount and no code — the ' +
    'rows stored before the field was switched to currencyMode record. The code is the one you give; nothing is ' +
    'derived. Dry run by default; --apply writes.';

  static override examples = [
    '$ os migrate record-currency-codes --object opportunity --field amount --code USD',
    '$ os migrate record-currency-codes --object opportunity --field amount --code USD --apply',
    '$ os migrate record-currency-codes --object opportunity --field amount --code USD --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    object: Flags.string({ description: 'The object whose rows are backfilled', required: true }),
    field: Flags.string({
      description: 'The record-mode currency field (currencyConfig.currencyMode record) whose rows owe a code',
      required: true,
    }),
    code: Flags.string({
      description:
        'The ISO 4217 code to write, uppercase (e.g. USD). Written into every row with an amount and a blank code; ' +
        'a row that holds a code is never touched. A code that is not ISO 4217 is refused before the database is opened',
      required: true,
    }),
    apply: Flags.boolean({
      description: 'Write the code (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    'max-records': Flags.integer({
      description: 'Safety bound on rows read — exceeding it truncates the walk',
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateRecordCurrencyCodes);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · record-currency-codes');

    // `--code` first: before the occupancy probe, the `--apply` prompt and the boot.
    try {
      refuseNonMemberCurrencyCode(flags.object, flags.field, flags.code);
    } catch (error: any) {
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(error.message);
      this.exit(1);
      return;
    }

    // Occupancy gate, as `summary-nulls`: probed before boot and before the prompt.
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
          `\nWrite ${flags.code} as the currency code of every ${flags.object}.${flags.field} amount stored ` +
            'without one, on this database? [y/N] ',
        ),
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
      // The dry run boots read-only, as `summary-nulls` does; `--apply` keeps
      // the plain boot, because the tables must exist before it writes.
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
      const engine: RecordCurrencyBackfillEngine & { getConfigs?(): Record<string, unknown> } =
        stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || typeof engine?.update !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot read the object declaration.');
      }
      // A stack with no app metadata loaded would answer "object not found"
      // for a real object: say what is missing instead.
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the walk would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }
      refuseUndeclaredObjects([flags.object], loadedObjects);

      const { backfillRecordCurrencyCodes, formatRecordCurrencyBackfillReport } = await import('@objectstack/objectql');

      // In JSON mode keep stdout parseable — route warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      const report = await backfillRecordCurrencyCodes(engine, logger, {
        object: flags.object,
        field: flags.field,
        code: flags.code,
        apply,
        maxRecords: flags['max-records'],
      });

      if (flags.json) {
        await emitJson({ database: stack.dbLabel, apply, report, duration: timer.elapsed() });
        if (report.failures.length > 0) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      console.log('');
      // The report's dry-run line claims no row or table; on a SQLite file the
      // read-only boot's connect may still have switched the journal mode (its
      // header, no row), so the line is followed by the note naming the switch.
      const journalNote = !report.applied && report.codeless > 0
        && describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      console.log(`${formatRecordCurrencyBackfillReport(report).join('\n')}${journalNote}`);
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be written — re-run to finish them.`);
      } else if (apply && report.written > 0) {
        printSuccess(
          `Wrote ${report.code} on ${report.written} row(s). ` +
            'Re-run any time — it only ever revisits rows whose code is still blank.',
        );
      } else if (!apply && report.codeless > 0) {
        printInfo(`Dry run only — ${report.codeless} row(s) would get ${report.code}. Re-run with --apply.`);
      } else {
        printSuccess(`Nothing to backfill — every ${report.object}.${report.field} amount has its currency code.`);
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (report.failures.length > 0) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      // `INVALID_FIELD` is the backfill refusing the field before its walk
      // ("Refused before the walk read or wrote any row."; the code was judged
      // before the boot, so it is refused there only if that judge drifts). The boot
      // above ran first, so on a SQLite file the note naming a journal-mode
      // switch follows, as on `summary-nulls`.
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
