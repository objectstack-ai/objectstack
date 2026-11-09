// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { blankAsNullColumns, blankStorageForm, type BlankAsNullFieldDef } from '@objectstack/core';
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
import { formatWithheldColumns } from '../../utils/migrate-withheld-columns.js';
import {
  walkBlankColumns,
  type BlankSingleValuesEngine,
  type BlankSingleValuesLogger,
  type BlankSingleValuesOptions,
  type BlankSingleValuesReport,
} from './blank-single-values.js';

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
 * The columns of one object this run cleans: the write door's #29343
 * `'emptyList'` arm, read from `blankAsNullColumns` (`@objectstack/core`, the
 * one rule the door and the seed replay read): the optional columns on the
 * `$empty` table's `multi_value` row (`isMultiValueField`). No type name is
 * listed here.
 *
 * Out, by the map's own rule: `required` columns (`[]` there is refused at the
 * door), lifecycle columns, and `readonly: true` columns (ruling record
 * 6598733139): a readonly column is platform-stamped, and its `[]` is a
 * stamped value — `sys_activity.changed_fields`, where `[]` is "stamped,
 * nothing changed" (ADR-0139 E6) — so this run never rewrites it.
 */
export function blankMultiValueColumns(schema: unknown): Array<{ name: string; type: string }> {
  const fields = (schema as { fields?: Record<string, BlankAsNullFieldDef | undefined> } | undefined)?.fields;
  if (!fields) return [];
  const out: Array<{ name: string; type: string }> = [];
  for (const [name, reach] of blankAsNullColumns(schema as Parameters<typeof blankAsNullColumns>[0])) {
    const type = fields[name]?.type;
    if (reach !== 'emptyList' || typeof type !== 'string') continue;
    out.push({ name, type });
  }
  return out;
}

/**
 * Whether a value the engine reads back is a blank the door now stores as
 * `null` on these columns: asked of the door's own `blankStorageForm`, so the
 * two never disagree on what a blank is (`[]` and exactly `''`; never a
 * non-empty list, never whitespace).
 */
function isBlankMultiValue(value: unknown): boolean {
  return value != null && blankStorageForm(value, 'emptyList') === null;
}

/**
 * Walk every stored row of every object with a column in scope, count the
 * stored `[]` and `''` values per column, and on `apply` rewrite each such
 * row's blank columns to `null` in one update through the engine — the walk
 * `blank-single-values` uses, read and tested in JS, never pushed down as a
 * filter. Idempotent: a re-run that reports zero is the verification.
 */
export async function cleanBlankMultiValues(
  engine: BlankSingleValuesEngine,
  logger: BlankSingleValuesLogger,
  options: BlankSingleValuesOptions = {},
): Promise<BlankSingleValuesReport> {
  return walkBlankColumns(engine, logger, options, {
    step: 'blank-multi-values',
    columnsOf: blankMultiValueColumns,
    isBlank: isBlankMultiValue,
  });
}

/** Human-readable report body, shared by the dry run and the apply run. */
export function formatBlankMultiValuesReport(report: BlankSingleValuesReport): string[] {
  const lines: string[] = [
    `Scanned ${report.scannedRecords} record(s) across ${report.scannedObjects.length} object(s) ` +
      'for empty lists and empty strings stored on optional multi-value columns.',
  ];
  if (report.columns.length === 0) {
    lines.push('✓ No stored empty list or empty string found.');
  } else {
    lines.push(`${report.applied ? '✓' : '•'} ${report.blankValues} stored empty value(s) in ${report.columns.length} column(s):`);
    for (const c of report.columns) {
      const done = report.applied ? `, ${c.cleared} set to null` : '';
      lines.push(`  • ${c.object}.${c.field} (${c.type}) — ${c.blankRows} record(s)${done}\n      e.g. ${c.sampleRecordIds.join(', ')}`);
    }
    if (!report.applied) lines.push('Dry run — no row or table was written.');
  }
  if (report.unreadableObjects.length > 0) {
    lines.push(`⚠ Unreadable object(s): ${report.unreadableObjects.join(', ')}`);
  }
  if (report.truncated) {
    lines.push('⚠ Walk incomplete — rows past the cap or in an unreadable object were not read.');
  }
  lines.push(...formatWithheldColumns(report.withheldColumns));
  return lines;
}

/**
 * `os migrate blank-multi-values` — the one-time clean of the empty list and
 * the empty string already stored on optional multi-value columns (#29653).
 *
 * The write door stores a cleared optional multi-value value — `[]` or `''`
 * on a `multiselect` / `checkboxes` / `tags` column or a `multiple: true`
 * `select` / `radio` / `lookup` / `user` / `file` / `image` — as `null` since
 * #29343 (ruling A, record 6591577985, execution step 2). Rows written before
 * that still hold the JSON text `'[]'` or `'""'`, so `= null`, grouping and
 * the read shape split them from rows cleared since, and the `$empty` table's
 * `multi_value` row does not read `'""'` as empty. The same ruling's step 3
 * binds this clean; it is a data step of its own beside `blank-single-values`,
 * not part of `value-shapes`, whose documented contract is that it rewrites
 * nothing (server seat ruling on #29431, record 6588116815).
 *
 * Dry run by default (writes no row), `--apply` to rewrite. `--object` narrows
 * the walk; a name the deployment does not declare is refused.
 *
 * ## No deployment flag, deliberately
 *
 * Nothing is gated on this run, as with `blank-single-values`: it repairs
 * values and changes no posture, and its idempotence is the verification (a
 * re-run that reports zero is the evidence).
 */
export default class MigrateBlankMultiValues extends Command {
  static override description =
    'Rewrite empty lists and empty strings still stored on optional multi-value columns to null, ' +
    'the form the write door stores a cleared value in, so old and new cleared rows read alike. ' +
    'Dry-run by default; --apply rewrites each affected row.';

  static override examples = [
    '$ os migrate blank-multi-values',
    '$ os migrate blank-multi-values --apply',
    '$ os migrate blank-multi-values --apply --yes --json',
    '$ os migrate blank-multi-values --object account',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Rewrite the empty lists and empty strings to null (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    object: Flags.string({
      description:
        'Restrict to this object (repeatable; default: every object with a column in scope). A name the ' +
        'deployment does not declare is refused',
      multiple: true,
    }),
    'max-records': Flags.integer({
      description: 'Safety bound on rows read per object — exceeding it truncates the walk',
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateBlankMultiValues);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · blank-multi-values');

    // Occupancy gate, like `blank-single-values`: an apply run rewrites ROWS, so a
    // second writer on the same SQLite file is a real hazard. Probed before
    // boot and before the prompt.
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
        ? `--force: ${describeOccupancy(occupancy)} Rewriting anyway — the live process may write rows mid-walk.`
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
        chalk.bold('\nRewrite every empty list and empty string stored on an optional multi-value column to null on this database? [y/N] '),
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
      // [#21391] The dry run boots READ-ONLY (`deferSchemaDdl` +
      // `readOnlyProbe`); `--apply` keeps the plain boot, since the tables must
      // exist before it writes.
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
      const engine: BlankSingleValuesEngine = stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || typeof engine?.update !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot walk the stored rows.');
      }
      // An empty walk is indistinguishable from a clean one, so refuse to run
      // when no app metadata is loaded rather than report a database the walk
      // never looked at.
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the walk would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }
      // [#21644] A name this registry does not declare would be skipped without
      // a word and read as clean. Refused before any row is read.
      refuseUndeclaredObjects(flags.object, loadedObjects);

      // In JSON mode keep stdout parseable — route warnings to stderr.
      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // [#21529] Not asked on a dry run: a table the read-only boot measured
      // absent stores no value, so it is answered as empty instead of read.
      const view: BlankSingleValuesEngine = {
        getObject: (name) => engine.getObject(name),
        ...(typeof engine.getConfigs === 'function' ? { getConfigs: () => engine.getConfigs!() } : {}),
        find: (object, options) =>
          !apply && stack.tableAbsent?.(object) ? Promise.resolve([]) : engine.find(object, options),
        update: (object, data, options) => engine.update(object, data, options),
        registry: engine.registry,
      };

      const report = await cleanBlankMultiValues(view, logger, {
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
      // [#23726] The read-only boot's connect may still switch a SQLite file's
      // journal mode (its header, no row), so a dry-run line on a SQLite file
      // is followed by the note naming it.
      const journalNote = !report.applied && report.blankValues > 0
        && describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      console.log(`${formatBlankMultiValuesReport(report).join('\n')}${journalNote}`);
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be rewritten — re-run to finish them.`);
      } else if (apply && report.cleared > 0) {
        printSuccess(
          `Rewrote ${report.cleared} empty value(s) to null across ${report.columns.length} column(s). ` +
            'Re-run any time — it only ever revisits rows still holding an empty list or empty string.',
        );
      } else if (report.blankValues > 0) {
        printInfo(`Dry run only — ${report.blankValues} value(s) would be rewritten to null. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to clean — no optional multi-value column stores an empty list or empty string.');
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (report.failures.length > 0) this.exit(1);
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
