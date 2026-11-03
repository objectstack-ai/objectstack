// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { blankAsNullColumns, type BlankAsNullFieldDef } from '@objectstack/core';
import { STRING_VALUE_TYPES } from '@objectstack/spec/data';
import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
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

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** One object/column pair that still stores `''`. */
export interface BlankSingleValueColumn {
  object: string;
  field: string;
  /** The declared field type, so the report can say what kind of column it is. */
  type: string;
  /** Rows of this object storing `''` in this column when the walk read them. */
  blankRows: number;
  /** Of those, the rows this run rewrote to `null` (always 0 on a dry run). */
  cleared: number;
  /** A few of the rows, so an operator can go and look. */
  sampleRecordIds: string[];
}

export interface BlankSingleValueFailure {
  object: string;
  recordId: string;
  fields: string[];
  error: string;
}

export interface BlankSingleValuesReport {
  /** Objects walked: those with at least one column in scope. */
  scannedObjects: string[];
  scannedRecords: number;
  /** Columns holding at least one `''`, most first. */
  columns: BlankSingleValueColumn[];
  /** Total stored `''` values found across `columns`. */
  blankValues: number;
  /** Total values rewritten to `null`. */
  cleared: number;
  applied: boolean;
  /** True when `--max-records` or an unreadable object cut the walk short. */
  truncated: boolean;
  unreadableObjects: string[];
  failures: BlankSingleValueFailure[];
}

/** The engine surface the walk reads and writes through. */
export interface BlankSingleValuesEngine {
  getObject(name: string): any | undefined;
  getConfigs?(): Record<string, unknown>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<unknown>;
}

export interface BlankSingleValuesLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface BlankSingleValuesOptions {
  apply?: boolean;
  /** Restrict to these objects (default: every loaded object). */
  objects?: string[];
  maxRecordsPerObject?: number;
}

const PAGE_SIZE = 500;
const MAX_SAMPLE_IDS = 5;
/** Not tenant-scoped: the context the other `os migrate` data runs use. */
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * The columns of one object this run cleans: the write door's #29277 arm, read
 * from `blankAsNullColumns` (`@objectstack/core`, the one rule the door and
 * the seed replay read). That map holds four arms; this run takes the two
 * `'empty'` ones minus the text-like columns of the #29176 unique arm, which
 * leaves exactly the optional single-value columns on the `$empty` table's
 * `null_only` row: options, references and file references today. The text
 * types are the spec's `STRING_VALUE_TYPES`, the set the map itself reads for
 * that arm: no type name is listed here.
 *
 * Out, by the map's own rule: `required` columns and lifecycle columns. Out
 * because this run takes only `reach === 'empty'`: `multiple: true` columns
 * (the `multi_value` row), which the map holds on the #29343 `'emptyList'`
 * arm, and typed columns (the #20308 `'blank'` arm, whose door already refuses
 * to store a blank as a value).
 */
export function blankSingleValueColumns(schema: unknown): Array<{ name: string; type: string }> {
  const fields = (schema as { fields?: Record<string, BlankAsNullFieldDef | undefined> } | undefined)?.fields;
  if (!fields) return [];
  const out: Array<{ name: string; type: string }> = [];
  for (const [name, reach] of blankAsNullColumns(schema as Parameters<typeof blankAsNullColumns>[0])) {
    const type = fields[name]?.type;
    if (reach !== 'empty' || typeof type !== 'string' || STRING_VALUE_TYPES.has(type)) continue;
    out.push({ name, type });
  }
  return out;
}

/**
 * Walk every stored row of every object with a column in scope, count the
 * `''` values, and on `apply` rewrite each such row's `''` columns to `null`
 * in one update through the engine.
 *
 * The value is read and tested in JS (`=== ''`), never pushed down as a filter:
 * blank-string comparison is where drivers diverge, and a migration whose
 * coverage depends on the driver silently skips rows (the reason
 * `summary-nulls` gives for the same choice).
 *
 * Idempotent: a rewritten value is `null`, which the next walk does not count,
 * so "re-run until it reports zero" is the operator's verification.
 */
export async function cleanBlankSingleValues(
  engine: BlankSingleValuesEngine,
  logger: BlankSingleValuesLogger,
  options: BlankSingleValuesOptions = {},
): Promise<BlankSingleValuesReport> {
  const apply = options.apply === true;
  const maxPerObject = options.maxRecordsPerObject ?? 100_000;
  const candidates =
    options.objects ?? (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);

  const scannedObjects: string[] = [];
  const columns = new Map<string, BlankSingleValueColumn>();
  const unreadableObjects: string[] = [];
  const failures: BlankSingleValueFailure[] = [];
  let scannedRecords = 0;
  let truncated = false;

  for (const object of candidates) {
    const inScope = blankSingleValueColumns(engine.getObject(object));
    if (inScope.length === 0) continue;
    scannedObjects.push(object);
    for (const { name, type } of inScope) {
      columns.set(`${object}.${name}`, { object, field: name, type, blankRows: 0, cleared: 0, sampleRecordIds: [] });
    }

    // Seek by `id` (#4363): this run's claim is about every stored row, and an
    // offset walk that rewrites as it goes cannot promise it visited them all.
    const walk = keysetWalk<Record<string, unknown>>(
      (q: KeysetPageQuery) => engine.find(object, {
        ...q,
        fields: ['id', ...inScope.map((c) => c.name)],
        context: { ...SYSTEM_CTX },
      }),
      { pageSize: PAGE_SIZE, max: maxPerObject },
    );

    try {
      for await (const page of walk.pages()) {
        for (const row of page) {
          scannedRecords++;
          const id = row.id;
          if (id == null || id === '') continue;
          const blank = inScope.filter((c) => row[c.name] === '');
          if (blank.length === 0) continue;
          for (const c of blank) {
            const col = columns.get(`${object}.${c.name}`)!;
            col.blankRows++;
            if (col.sampleRecordIds.length < MAX_SAMPLE_IDS) col.sampleRecordIds.push(String(id));
          }
          if (!apply) continue;
          try {
            const patch: Record<string, unknown> = { id };
            for (const c of blank) patch[c.name] = null;
            await engine.update(object, patch, { context: { ...SYSTEM_CTX } });
            for (const c of blank) columns.get(`${object}.${c.name}`)!.cleared++;
          } catch (err) {
            // One row's failure does not abort the rest; re-running revisits
            // only what still holds `''`.
            const message = (err as Error)?.message ?? String(err);
            logger.warn(`[blank-single-values] ${object} record ${String(id)}: ${message}`);
            failures.push({ object, recordId: String(id), fields: blank.map((c) => c.name), error: message });
          }
        }
      }
    } catch (err) {
      // An object this run cannot read is one it cannot vouch for: reported,
      // and the run is truncated rather than quietly clean.
      logger.warn(
        `[blank-single-values] cannot read ${object} (${(err as Error)?.message ?? err}) — ` +
          'reported as unreadable; this run does not cover it',
      );
      unreadableObjects.push(object);
      truncated = true;
      continue;
    }
    if (walk.truncated) truncated = true;
  }

  const found = [...columns.values()].filter((c) => c.blankRows > 0).sort((a, b) => b.blankRows - a.blankRows);
  return {
    scannedObjects,
    scannedRecords,
    columns: found,
    blankValues: found.reduce((n, c) => n + c.blankRows, 0),
    cleared: found.reduce((n, c) => n + c.cleared, 0),
    applied: apply,
    truncated,
    unreadableObjects,
    failures,
  };
}

/** Human-readable report body, shared by the dry run and the apply run. */
export function formatBlankSingleValuesReport(report: BlankSingleValuesReport): string[] {
  const lines: string[] = [
    `Scanned ${report.scannedRecords} record(s) across ${report.scannedObjects.length} object(s) ` +
      'for empty strings stored on optional single-value option / reference / file columns.',
  ];
  if (report.columns.length === 0) {
    lines.push('✓ No stored empty string found.');
  } else {
    lines.push(`${report.applied ? '✓' : '•'} ${report.blankValues} stored empty string(s) in ${report.columns.length} column(s):`);
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
  return lines;
}

/**
 * `os migrate blank-single-values` — the one-time clean of `''` already stored
 * on optional single-value option, reference and file columns (#29431).
 *
 * The write door stores a cleared optional `select` / `radio` / `lookup` /
 * `master_detail` / `user` / `tree` / `image` / `file` / `avatar` / `video` /
 * `audio` value as `null` since #29277 (maintainer ruling B on #29346, record
 * 6579813296). Rows written before that still hold `''`, which the `$empty`
 * table reads as a value on those types: `$empty: true` misses them. That
 * ruling binds "an `os migrate` data step" to clean them once, and the server
 * seat's ruling on #29431 (record 6588116815) put the step here, beside
 * `summary-nulls`, rather than in `value-shapes`, whose documented contract is
 * that it rewrites nothing.
 *
 * Dry run by default (writes no row), `--apply` to rewrite. `--object` narrows
 * the walk; a name the deployment does not declare is refused.
 *
 * ## No deployment flag, deliberately
 *
 * Nothing is gated on this run, as with `summary-nulls`: it repairs values and
 * changes no posture, and its idempotence is the verification (a re-run that
 * reports zero is the evidence).
 */
export default class MigrateBlankSingleValues extends Command {
  static override description =
    'Rewrite empty strings still stored on optional single-value option, reference and file columns to null, ' +
    'the form the write door stores a cleared value in, so $empty finds them. ' +
    'Dry-run by default; --apply rewrites each affected row.';

  static override examples = [
    '$ os migrate blank-single-values',
    '$ os migrate blank-single-values --apply',
    '$ os migrate blank-single-values --apply --yes --json',
    '$ os migrate blank-single-values --object account',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Rewrite the empty strings to null (default is a read-only dry run)',
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
    const { flags } = await this.parse(MigrateBlankSingleValues);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · blank-single-values');

    // Occupancy gate, like `summary-nulls`: an apply run rewrites ROWS, so a
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
        chalk.bold('\nRewrite every empty string stored on an optional single-value column to null on this database? [y/N] '),
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
      };

      const report = await cleanBlankSingleValues(view, logger, {
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
      console.log(`${formatBlankSingleValuesReport(report).join('\n')}${journalNote}`);
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be rewritten — re-run to finish them.`);
      } else if (apply && report.cleared > 0) {
        printSuccess(
          `Rewrote ${report.cleared} empty string(s) to null across ${report.columns.length} column(s). ` +
            'Re-run any time — it only ever revisits rows still holding an empty string.',
        );
      } else if (report.blankValues > 0) {
        printInfo(`Dry run only — ${report.blankValues} value(s) would be rewritten to null. Re-run with --apply.`);
      } else {
        printSuccess('Nothing to clean — no optional single-value column stores an empty string.');
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
