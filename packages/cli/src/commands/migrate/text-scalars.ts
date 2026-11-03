// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { ENGINE_LIFECYCLE_COLUMNS } from '@objectstack/core';
import { BOUNDED_STRING_FIELD_TYPES } from '@objectstack/spec/data';
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
// The decision for one stored value
// ---------------------------------------------------------------------------

/**
 * What a stored text-family value is:
 * - `ok`: left alone (a string, `null`, anything that is not a scalar).
 * - `rewrite`: a raw number or boolean; `to` is `String(value)`, the string
 *   the write door stores since #29241.
 * - `report`: a SQLite REAL text form (`sqlite-real-text`), never rewritten.
 */
export type TextScalarVerdict =
  | { kind: 'ok' }
  | { kind: 'rewrite'; to: string }
  | { kind: 'report'; reason: 'sqlite-real-text' };

/**
 * The text a SQLite TEXT column holds for a JS number or boolean the
 * pre-#29241 door bound as REAL: `42` → `"42.0"`, `true` → `"1.0"`, `false`
 * → `"0.0"`, and from 1e15 up SQLite's exponent form (`1e21` → `"1.0e+21"`).
 * A fractional number (`-1.5`) is stored as `"-1.5"`, already its
 * `String(value)`, so it is not this form.
 */
const SQLITE_REAL_TEXT = /^-?\d+\.0(?:e[+-]\d+)?$/;

/**
 * Decide one stored value of a text-family field (#29702):
 *
 * - A raw number or boolean (what driver-memory with persistence kept) is
 *   decidable by type: it becomes `String(value)`, exactly the string the
 *   #29241 door writes for the same input (`isStringReadScalar` there takes
 *   every number, so this does too).
 * - A SQLite `"N.0"` is not decidable: a text field declares no codes, so it
 *   may be the old number or a string a client typed. Reported, never
 *   rewritten — the `free-field` case of `os migrate option-codes`.
 * - Every other string, `null`, and every non-scalar is `ok`.
 */
export function decideTextScalar(value: unknown): TextScalarVerdict {
  if (typeof value === 'number' || typeof value === 'boolean') return { kind: 'rewrite', to: String(value) };
  if (typeof value === 'string' && SQLITE_REAL_TEXT.test(value)) return { kind: 'report', reason: 'sqlite-real-text' };
  return { kind: 'ok' };
}

/** The text-field slice this run reads. */
export interface TextScalarFieldDef {
  type: string;
  system?: boolean;
  readonly?: boolean;
  primaryKey?: boolean;
}

const LIFECYCLE: ReadonlySet<string> = new Set(ENGINE_LIFECYCLE_COLUMNS);

/**
 * The fields of one object this run walks: the fields the #29241 door
 * rewrites. The type set is the spec's `BOUNDED_STRING_FIELD_TYPES`, the set
 * that door reads (no type is listed here); the field scope is the door's
 * walk: a `readonly` field is in, otherwise an engine lifecycle column
 * (`ENGINE_LIFECYCLE_COLUMNS`) and a `system` field are out. ⛔ The key is
 * always out (`id`, a `primaryKey` field): it is the address of the update.
 */
export function textScalarFields(schema: unknown): Array<{ name: string; type: string }> {
  const fields = (schema as { fields?: Record<string, TextScalarFieldDef | undefined> } | undefined)?.fields;
  if (!fields) return [];
  const out: Array<{ name: string; type: string }> = [];
  for (const [name, def] of Object.entries(fields)) {
    if (!def || typeof def.type !== 'string' || !BOUNDED_STRING_FIELD_TYPES.has(def.type)) continue;
    if (name === 'id' || def.primaryKey === true) continue;
    if (def.readonly !== true && (LIFECYCLE.has(name) || def.system === true)) continue;
    out.push({ name, type: def.type });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** One object/field pair holding at least one old form. */
export interface TextScalarColumn {
  object: string;
  field: string;
  type: string;
  /** Rows holding a raw number or boolean (rewritten on `--apply`). */
  rewriteRows: number;
  /** Of those, the rows this run rewrote (always 0 on a dry run). */
  rewritten: number;
  /** Rows holding SQLite `"N.0"` text, reported and left as stored. */
  reportedRows: number;
  /** A few stored → string pairs, so an operator can see what moves. */
  samples: Array<{ recordId: string; stored: unknown; to?: string }>;
}

export interface TextScalarFailure {
  object: string;
  recordId: string;
  fields: string[];
  error: string;
}

export interface TextScalarsReport {
  scannedObjects: string[];
  scannedRecords: number;
  columns: TextScalarColumn[];
  /** Values this run would rewrite / rewrote. */
  rewriteValues: number;
  rewritten: number;
  /** SQLite `"N.0"` values reported and left as stored. */
  reportedValues: number;
  applied: boolean;
  truncated: boolean;
  unreadableObjects: string[];
  failures: TextScalarFailure[];
}

export interface TextScalarsEngine {
  getObject(name: string): any | undefined;
  getConfigs?(): Record<string, unknown>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<unknown>;
}

export interface TextScalarsLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface TextScalarsOptions {
  apply?: boolean;
  objects?: string[];
  maxRecordsPerObject?: number;
}

const PAGE_SIZE = 500;
const MAX_SAMPLES = 5;
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * Walk every stored row of every object with a text-family field, decide each
 * value (`decideTextScalar`), and on `apply` rewrite each row's raw numbers
 * and booleans in one update through the engine.
 *
 * Read and decided in JS, never pushed down as a filter: a `42` / `"42"` /
 * `"42.0"` comparison is exactly where drivers diverge.
 *
 * Idempotent: a rewritten value is a string, which the next walk reads as
 * `ok`; reported values stay reported.
 */
export async function migrateTextScalars(
  engine: TextScalarsEngine,
  logger: TextScalarsLogger,
  options: TextScalarsOptions = {},
): Promise<TextScalarsReport> {
  const apply = options.apply === true;
  const maxPerObject = options.maxRecordsPerObject ?? 100_000;
  const candidates =
    options.objects ?? (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);

  const scannedObjects: string[] = [];
  const columns = new Map<string, TextScalarColumn>();
  const unreadableObjects: string[] = [];
  const failures: TextScalarFailure[] = [];
  let scannedRecords = 0;
  let truncated = false;

  for (const object of candidates) {
    const inScope = textScalarFields(engine.getObject(object));
    if (inScope.length === 0) continue;
    scannedObjects.push(object);
    for (const f of inScope) {
      columns.set(`${object}.${f.name}`, {
        object, field: f.name, type: f.type, rewriteRows: 0, rewritten: 0, reportedRows: 0, samples: [],
      });
    }

    // Seek by `id` (#4363): an offset walk that rewrites as it goes cannot
    // promise it visited every row.
    const walk = keysetWalk<Record<string, unknown>>(
      (q: KeysetPageQuery) => engine.find(object, {
        ...q,
        fields: ['id', ...inScope.map((f) => f.name)],
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
          const patch: Record<string, string> = {};
          for (const f of inScope) {
            const d = decideTextScalar(row[f.name]);
            if (d.kind === 'ok') continue;
            const col = columns.get(`${object}.${f.name}`)!;
            if (d.kind === 'report') {
              col.reportedRows++;
              if (col.samples.length < MAX_SAMPLES) col.samples.push({ recordId: String(id), stored: row[f.name] });
              continue;
            }
            col.rewriteRows++;
            if (col.samples.length < MAX_SAMPLES) col.samples.push({ recordId: String(id), stored: row[f.name], to: d.to });
            patch[f.name] = d.to;
          }
          const changed = Object.keys(patch);
          if (!apply || changed.length === 0) continue;
          try {
            await engine.update(object, { id, ...patch }, { context: { ...SYSTEM_CTX } });
            for (const name of changed) columns.get(`${object}.${name}`)!.rewritten++;
          } catch (err) {
            // One row's failure (a unique collision with a row already holding
            // the string, say) does not abort the rest; a re-run revisits it.
            const message = (err as Error)?.message ?? String(err);
            logger.warn(`[text-scalars] ${object} record ${String(id)}: ${message}`);
            failures.push({ object, recordId: String(id), fields: changed, error: message });
          }
        }
      }
    } catch (err) {
      logger.warn(
        `[text-scalars] cannot read ${object} (${(err as Error)?.message ?? err}) — ` +
          'reported as unreadable; this run does not cover it',
      );
      unreadableObjects.push(object);
      truncated = true;
      continue;
    }
    if (walk.truncated) truncated = true;
  }

  const found = [...columns.values()]
    .filter((c) => c.rewriteRows > 0 || c.reportedRows > 0)
    .sort((a, b) => b.rewriteRows + b.reportedRows - (a.rewriteRows + a.reportedRows));
  return {
    scannedObjects,
    scannedRecords,
    columns: found,
    rewriteValues: found.reduce((n, c) => n + c.rewriteRows, 0),
    rewritten: found.reduce((n, c) => n + c.rewritten, 0),
    reportedValues: found.reduce((n, c) => n + c.reportedRows, 0),
    applied: apply,
    truncated,
    unreadableObjects,
    failures,
  };
}

/** Human-readable report body, shared by the dry run and the apply run. */
export function formatTextScalarsReport(report: TextScalarsReport): string[] {
  const lines: string[] = [
    `Scanned ${report.scannedRecords} record(s) across ${report.scannedObjects.length} object(s) ` +
      'for numbers, booleans and SQLite "N.0" text stored on text fields.',
  ];
  if (report.columns.length === 0) {
    lines.push('✓ Every stored text value is a string in the form the write door stores.');
  } else {
    if (report.rewriteValues > 0) {
      lines.push(`${report.applied ? '✓' : '•'} ${report.rewriteValues} number/boolean value(s)${report.applied ? `, ${report.rewritten} rewritten to their string` : ' to rewrite to their string'}.`);
    }
    if (report.reportedValues > 0) {
      lines.push(
        `⚠ ${report.reportedValues} SQLite "N.0" value(s) left as stored — each may be an old number or text ` +
          'someone typed; fix by hand where it was a number:',
      );
    }
    for (const c of report.columns) {
      const parts: string[] = [];
      if (c.rewriteRows > 0) parts.push(`${c.rewriteRows} to rewrite${report.applied ? ` (${c.rewritten} done)` : ''}`);
      if (c.reportedRows > 0) parts.push(`${c.reportedRows} reported (SQLite "N.0", undecidable)`);
      const eg = c.samples
        .map((s) => `${s.recordId} ${JSON.stringify(s.stored)}${s.to !== undefined ? ` → ${JSON.stringify(s.to)}` : ''}`)
        .join('; ');
      lines.push(`  • ${c.object}.${c.field} (${c.type}) — ${parts.join(', ')}\n      e.g. ${eg}`);
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
 * `os migrate text-scalars` — the one-time rewrite of numbers and booleans
 * stored on text-family fields before #29241 (#29702).
 *
 * Since #29241 the write door stores a number or boolean written to a
 * text-family field (`BOUNDED_STRING_FIELD_TYPES`) as the string the record
 * validator judged it by: `42` as `"42"`, `true` as `"true"`. Rows written
 * before keep the form the driver stored: driver-memory with persistence
 * holds the raw `42` / `true`, SQLite holds the TEXT `"42.0"` / `"1.0"` /
 * `"0.0"` (a JS number bound as REAL into a TEXT column). So `{ f: "42" }`
 * misses those rows, a read hands back the old form, and a unique field's new
 * `"42"` does not collide with an old `42` or `"42.0"`.
 *
 * A raw scalar is decidable by type and rewritten; a SQLite `"N.0"` is not
 * (a text field declares no codes, so it may be text a client typed) and is
 * reported per object and field, never rewritten (`decideTextScalar`).
 *
 * A sibling of `os migrate option-codes`, not an arm of it: that command's
 * name, help and verdict ("every stored option value is a code string") are
 * about option fields, and its decision reads declared codes, which a text
 * field has none of. Not part of `value-shapes` either, whose documented
 * contract is that it rewrites nothing (the server seat's ruling on #29431,
 * record 6588116815).
 *
 * Dry run by default (writes no row), `--apply` to rewrite. `--object`
 * narrows the walk; a name the deployment does not declare is refused.
 *
 * ## No deployment flag, deliberately
 *
 * Nothing is gated on this run: it repairs values and changes no posture, and
 * a re-run that reports zero to rewrite is the verification.
 */
export default class MigrateTextScalars extends Command {
  static override description =
    'Rewrite numbers and booleans still stored raw on text fields to the string the write door stores, ' +
    'so filters, reads and unique keys see one value, and list the SQLite "N.0" text it cannot decide. ' +
    'Dry-run by default; --apply rewrites each affected row. Undecidable values are reported, never rewritten.';

  static override examples = [
    '$ os migrate text-scalars',
    '$ os migrate text-scalars --apply',
    '$ os migrate text-scalars --apply --yes --json',
    '$ os migrate text-scalars --object account',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Rewrite the raw numbers and booleans (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    object: Flags.string({
      description:
        'Restrict to this object (repeatable; default: every object with a text field). A name the ' +
        'deployment does not declare is refused',
      multiple: true,
    }),
    'max-records': Flags.integer({
      description: 'Safety bound on rows read per object — exceeding it truncates the walk',
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateTextScalars);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · text-scalars');

    // Occupancy gate, like `option-codes`: an apply run rewrites ROWS, so a
    // second writer on the same SQLite file is a real hazard.
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
        chalk.bold('\nRewrite every number and boolean stored on a text field to its string on this database? [y/N] '),
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
      // [#21391] The dry run boots READ-ONLY; `--apply` keeps the plain boot.
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
      const engine: TextScalarsEngine = stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || typeof engine?.update !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot walk the stored rows.');
      }
      const loadedObjects: string[] =
        typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
      if (!loadedObjects.some((name) => !name.startsWith('sys_'))) {
        throw new Error(
          'No app objects are loaded, so the walk would examine nothing. ' +
            'Run "os build" in your project root first (the migration reads dist/objectstack.json), then re-run.',
        );
      }
      // [#21644] A name this registry does not declare is refused before any row is read.
      refuseUndeclaredObjects(flags.object, loadedObjects);

      const logger = flags.json
        ? { info: (m: string) => console.error(m), warn: (m: string) => console.error(m) }
        : { info: (m: string) => printInfo(m), warn: (m: string) => printWarning(m) };

      // [#21529] A table the read-only boot measured absent stores no value.
      const view: TextScalarsEngine = {
        getObject: (name) => engine.getObject(name),
        ...(typeof engine.getConfigs === 'function' ? { getConfigs: () => engine.getConfigs!() } : {}),
        find: (object, options) =>
          !apply && stack.tableAbsent?.(object) ? Promise.resolve([]) : engine.find(object, options),
        update: (object, data, options) => engine.update(object, data, options),
      };

      const report = await migrateTextScalars(view, logger, {
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
      // [#23726] The read-only boot's connect may still switch a SQLite file's journal mode.
      const journalNote = !report.applied && report.rewriteValues > 0
        && describeDriverSqliteFile(stack.driver?.config) !== undefined
        ? ` ${JOURNAL_MODE_SWITCH_NOTE}`
        : '';
      console.log(`${formatTextScalarsReport(report).join('\n')}${journalNote}`);
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be rewritten — re-run to finish them.`);
      } else if (apply && report.rewritten > 0) {
        printSuccess(
          `Rewrote ${report.rewritten} value(s) across ${report.columns.length} field(s). ` +
            'Re-run any time — it only ever revisits values still stored as a number or boolean.',
        );
      } else if (report.rewriteValues > 0) {
        printInfo(`Dry run only — ${report.rewriteValues} value(s) would be rewritten. Re-run with --apply.`);
      } else if (report.reportedValues === 0) {
        printSuccess('Nothing to rewrite — every stored text value is a string.');
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
