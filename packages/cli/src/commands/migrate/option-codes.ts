// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { SINGLE_OPTION_TYPES, MULTI_OPTION_TYPES, isMultiValueField } from '@objectstack/spec/data';
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

/** The option-field slice this run reads. */
export interface OptionCodeFieldDef {
  type: string;
  multiple?: boolean;
  options?: Array<{ value: string | number } | string | number>;
  picklist?: unknown;
}

/**
 * What a stored scalar is, against its field:
 * - `ok`: a string this run leaves alone (a declared code, any other string on
 *   a free field, `null`).
 * - `rewrite`: decidable, and `to` is the code the write door stores today.
 * - `report`: an old form whose code this run cannot decide; never rewritten.
 */
export type OptionCodeVerdict =
  | { kind: 'ok' }
  | { kind: 'rewrite'; to: string; arm: 'scalar' | 'sqlite-real' }
  | { kind: 'report'; reason: OptionCodeReportReason };

/**
 * - `free-field`: a SQLite `"N.0"` on a field with no declared codes: it may be
 *   the old number or a string a client wrote, and nothing here can tell.
 * - `undeclared`: the code the old form reads as is not declared (the options
 *   changed after it was stored); rewriting it would be refused by the door.
 * - `ambiguous`: a SQLite `"1.0"` / `"0.0"` on a field declaring both readings
 *   (`"1"` and `"true"`, or `"0"` and `"false"`).
 * - `picklist-unresolved`: a picklist-bound field whose options did not
 *   resolve on this boot, so no code is known.
 */
export type OptionCodeReportReason = 'free-field' | 'undeclared' | 'ambiguous' | 'picklist-unresolved';

/**
 * The integral TEXT a SQLite TEXT column holds for a JS number or boolean the
 * pre-#29562 door bound as REAL: `3` → `"3.0"`, `true` → `"1.0"`, `false` →
 * `"0.0"`. A fractional number (`-1.5`) is stored as `"-1.5"`, which is
 * already its `String(value)`, so it is not this form.
 */
const SQLITE_REAL_TEXT = /^-?\d+\.0$/;

function declaredCodes(def: OptionCodeFieldDef): string[] {
  if (!Array.isArray(def.options)) return [];
  return def.options.map((o) => (typeof o === 'object' && o !== null ? String(o.value) : String(o)));
}

/**
 * The codes an old SQLite `"N.0"` can have been written as: the integer's own
 * string, and for `"1.0"` / `"0.0"` the boolean's. `"-0.0"` reads as `"0"`.
 */
function sqliteRealReadings(stored: string): string[] {
  const n = String(Number(stored));
  if (stored === '1.0') return [n, 'true'];
  if (stored === '0.0' || stored === '-0.0') return ['0', 'false'];
  return [n];
}

/**
 * Decide one stored scalar (a single-value field's value, or one element of a
 * multi-value field's array). The rule (#29643):
 *
 * - A raw number or boolean (driver-memory with persistence, or a JSON array
 *   element on any driver) is decidable by type: it becomes `String(value)`,
 *   the string the write door stores since #29562. On a field declaring codes,
 *   only when that string is one of them; otherwise `undeclared`.
 * - A SQLite `"N.0"` that is not itself a declared code is decidable only
 *   against the declared codes: exactly one reading declared → that code;
 *   none → `undeclared`; two → `ambiguous`; no codes → `free-field`.
 * - Every other string, and `null`, is `ok`.
 */
export function decideOptionCode(def: OptionCodeFieldDef, value: unknown): OptionCodeVerdict {
  const isScalar = typeof value === 'number' || typeof value === 'boolean';
  const isRealText = typeof value === 'string' && SQLITE_REAL_TEXT.test(value);
  if (!isScalar && !isRealText) return { kind: 'ok' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { kind: 'ok' };

  const codes = declaredCodes(def);
  if (codes.length === 0 && def.picklist !== undefined) return { kind: 'report', reason: 'picklist-unresolved' };

  if (isScalar) {
    const to = String(value);
    if (codes.length > 0 && !codes.includes(to)) return { kind: 'report', reason: 'undeclared' };
    return { kind: 'rewrite', to, arm: 'scalar' };
  }

  const stored = value as string;
  if (codes.includes(stored)) return { kind: 'ok' };
  if (codes.length === 0) return { kind: 'report', reason: 'free-field' };
  const matches = sqliteRealReadings(stored).filter((c) => codes.includes(c));
  if (matches.length === 1) return { kind: 'rewrite', to: matches[0], arm: 'sqlite-real' };
  return { kind: 'report', reason: matches.length === 0 ? 'undeclared' : 'ambiguous' };
}

/**
 * The fields of one object this run walks: every option-family field
 * (`SINGLE_OPTION_TYPES` ∪ `MULTI_OPTION_TYPES`, the spec's sets, the same the
 * #29562 door reads), `readonly` ones included (the door normalises those too,
 * and the system context this run writes in may write them).
 */
export function optionCodeFields(schema: unknown): Array<{ name: string; def: OptionCodeFieldDef; multi: boolean }> {
  const fields = (schema as { fields?: Record<string, OptionCodeFieldDef | undefined> } | undefined)?.fields;
  if (!fields) return [];
  const out: Array<{ name: string; def: OptionCodeFieldDef; multi: boolean }> = [];
  for (const [name, def] of Object.entries(fields)) {
    if (!def || typeof def.type !== 'string') continue;
    if (!SINGLE_OPTION_TYPES.has(def.type) && !MULTI_OPTION_TYPES.has(def.type)) continue;
    out.push({ name, def, multi: isMultiValueField(def) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** One object/field pair holding at least one old form. */
export interface OptionCodeColumn {
  object: string;
  field: string;
  type: string;
  /** Rows holding a decidable old form (rewritten on `--apply`). */
  rewriteRows: number;
  /** Of those, the rows this run rewrote (always 0 on a dry run). */
  rewritten: number;
  /** Rows holding an old form this run cannot decide, by reason. */
  reported: Partial<Record<OptionCodeReportReason, number>>;
  /** A few stored → code pairs, so an operator can see what moves. */
  samples: Array<{ recordId: string; stored: unknown; to?: unknown; reason?: OptionCodeReportReason }>;
}

export interface OptionCodeFailure {
  object: string;
  recordId: string;
  fields: string[];
  error: string;
}

export interface OptionCodesReport {
  scannedObjects: string[];
  scannedRecords: number;
  columns: OptionCodeColumn[];
  /** Values (single values or whole arrays) this run would rewrite / rewrote. */
  rewriteValues: number;
  rewritten: number;
  /** Values reported and left as stored. */
  reportedValues: number;
  applied: boolean;
  truncated: boolean;
  unreadableObjects: string[];
  failures: OptionCodeFailure[];
}

export interface OptionCodesEngine {
  getObject(name: string): any | undefined;
  getConfigs?(): Record<string, unknown>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<unknown>;
}

export interface OptionCodesLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface OptionCodesOptions {
  apply?: boolean;
  objects?: string[];
  maxRecordsPerObject?: number;
}

const PAGE_SIZE = 500;
const MAX_SAMPLES = 5;
const SYSTEM_CTX = { isSystem: true } as const;

type Decision =
  | { kind: 'ok' }
  | { kind: 'rewrite'; to: unknown }
  | { kind: 'report'; reason: OptionCodeReportReason };

/**
 * One field's stored value. A multi-value array is rewritten whole when every
 * old element in it is decidable; one undecidable element reports the array
 * and rewrites none of it, so a row never ends half-migrated.
 */
function decideValue(field: { def: OptionCodeFieldDef; multi: boolean }, value: unknown): Decision {
  if (!field.multi || !Array.isArray(value)) {
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) return { kind: 'ok' };
    const v = decideOptionCode(field.def, value);
    return v.kind === 'rewrite' ? { kind: 'rewrite', to: v.to } : v;
  }
  let out: unknown[] | undefined;
  for (let i = 0; i < value.length; i++) {
    const v = decideOptionCode(field.def, value[i]);
    if (v.kind === 'report') return v;
    if (v.kind === 'rewrite') (out ??= value.slice())[i] = v.to;
  }
  return out ? { kind: 'rewrite', to: out } : { kind: 'ok' };
}

/**
 * Walk every stored row of every object with an option field, decide each
 * value (`decideOptionCode`), and on `apply` rewrite each row's decidable
 * values in one update through the engine.
 *
 * Read and decided in JS, never pushed down as a filter: a `"3.0"` / `3`
 * comparison is exactly where drivers diverge.
 *
 * Idempotent: a rewritten value is a declared code or `String(value)`, which
 * the next walk reads as `ok`; reported values stay reported.
 */
export async function migrateOptionCodes(
  engine: OptionCodesEngine,
  logger: OptionCodesLogger,
  options: OptionCodesOptions = {},
): Promise<OptionCodesReport> {
  const apply = options.apply === true;
  const maxPerObject = options.maxRecordsPerObject ?? 100_000;
  const candidates =
    options.objects ?? (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);

  const scannedObjects: string[] = [];
  const columns = new Map<string, OptionCodeColumn>();
  const unreadableObjects: string[] = [];
  const failures: OptionCodeFailure[] = [];
  let scannedRecords = 0;
  let truncated = false;

  for (const object of candidates) {
    const inScope = optionCodeFields(engine.getObject(object));
    if (inScope.length === 0) continue;
    scannedObjects.push(object);
    for (const f of inScope) {
      columns.set(`${object}.${f.name}`, {
        object, field: f.name, type: f.def.type, rewriteRows: 0, rewritten: 0, reported: {}, samples: [],
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
          const patch: Record<string, unknown> = {};
          for (const f of inScope) {
            const d = decideValue(f, row[f.name]);
            if (d.kind === 'ok') continue;
            const col = columns.get(`${object}.${f.name}`)!;
            if (d.kind === 'report') {
              col.reported[d.reason] = (col.reported[d.reason] ?? 0) + 1;
              if (col.samples.length < MAX_SAMPLES) col.samples.push({ recordId: String(id), stored: row[f.name], reason: d.reason });
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
            // the code, say) does not abort the rest; a re-run revisits it.
            const message = (err as Error)?.message ?? String(err);
            logger.warn(`[option-codes] ${object} record ${String(id)}: ${message}`);
            failures.push({ object, recordId: String(id), fields: changed, error: message });
          }
        }
      }
    } catch (err) {
      logger.warn(
        `[option-codes] cannot read ${object} (${(err as Error)?.message ?? err}) — ` +
          'reported as unreadable; this run does not cover it',
      );
      unreadableObjects.push(object);
      truncated = true;
      continue;
    }
    if (walk.truncated) truncated = true;
  }

  const reportedCount = (c: OptionCodeColumn) => Object.values(c.reported).reduce((n, k) => n + (k ?? 0), 0);
  const found = [...columns.values()]
    .filter((c) => c.rewriteRows > 0 || reportedCount(c) > 0)
    .sort((a, b) => b.rewriteRows + reportedCount(b) - (a.rewriteRows + reportedCount(a)));
  return {
    scannedObjects,
    scannedRecords,
    columns: found,
    rewriteValues: found.reduce((n, c) => n + c.rewriteRows, 0),
    rewritten: found.reduce((n, c) => n + c.rewritten, 0),
    reportedValues: found.reduce((n, c) => n + reportedCount(c), 0),
    applied: apply,
    truncated,
    unreadableObjects,
    failures,
  };
}

const REASON_TEXT: Record<OptionCodeReportReason, string> = {
  'free-field': 'SQLite "N.0" on a field with no declared codes (undecidable)',
  undeclared: 'reads as a code the field does not declare',
  ambiguous: 'SQLite "1.0"/"0.0" where both readings are declared',
  'picklist-unresolved': 'picklist options did not resolve',
};

/** Human-readable report body, shared by the dry run and the apply run. */
export function formatOptionCodesReport(report: OptionCodesReport): string[] {
  const lines: string[] = [
    `Scanned ${report.scannedRecords} record(s) across ${report.scannedObjects.length} object(s) ` +
      'for numbers, booleans and SQLite "N.0" text stored on option fields.',
  ];
  if (report.columns.length === 0) {
    lines.push('✓ Every stored option value is a code string.');
  } else {
    if (report.rewriteValues > 0) {
      lines.push(`${report.applied ? '✓' : '•'} ${report.rewriteValues} value(s) decidable${report.applied ? `, ${report.rewritten} rewritten` : ''}.`);
    }
    if (report.reportedValues > 0) {
      lines.push(`⚠ ${report.reportedValues} value(s) left as stored — fix by hand, then re-run:`);
    }
    for (const c of report.columns) {
      const parts: string[] = [];
      if (c.rewriteRows > 0) parts.push(`${c.rewriteRows} to rewrite${report.applied ? ` (${c.rewritten} done)` : ''}`);
      for (const [reason, n] of Object.entries(c.reported)) parts.push(`${n} reported: ${REASON_TEXT[reason as OptionCodeReportReason]}`);
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
 * `os migrate option-codes` — the one-time rewrite of option values stored in
 * an old form (#29643).
 *
 * Since #29562 the write door stores a number or boolean written to an
 * option-family field as the code string it was judged by: `3` as `"3"`,
 * `true` as `"true"`, element by element on a multi-value field. Rows written
 * before that keep the form the driver stored: driver-memory with persistence
 * holds the raw `3` / `true`, SQLite holds the TEXT `"3.0"` / `"1.0"` /
 * `"0.0"` (a JS number bound as REAL into a TEXT column), and a JSON array
 * holds raw elements on every driver. So `{ f: "3" }` misses those rows, a
 * read hands back the old form, and a unique field's new `"3"` does not
 * collide with an old `"3.0"`.
 *
 * A raw scalar is decidable by type; a SQLite `"N.0"` only against the
 * declared codes, and on a free field it is reported, never rewritten
 * (`decideOptionCode`). A data step of its own beside `blank-single-values`,
 * not part of `value-shapes`, whose documented contract is that it rewrites
 * nothing (the server seat's ruling on #29431, record 6588116815).
 *
 * Dry run by default (writes no row), `--apply` to rewrite. `--object` narrows
 * the walk; a name the deployment does not declare is refused.
 *
 * ## No deployment flag, deliberately
 *
 * Nothing is gated on this run: it repairs values and changes no posture, and
 * a re-run that reports zero to rewrite is the verification.
 */
export default class MigrateOptionCodes extends Command {
  static override description =
    'Rewrite option values still stored as a number, a boolean or SQLite "N.0" text to the option code ' +
    'string the write door stores, so filters, reads and unique keys see one value. ' +
    'Dry-run by default; --apply rewrites each affected row. Undecidable values are reported, never rewritten.';

  static override examples = [
    '$ os migrate option-codes',
    '$ os migrate option-codes --apply',
    '$ os migrate option-codes --apply --yes --json',
    '$ os migrate option-codes --object account',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Rewrite the decidable values (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    object: Flags.string({
      description:
        'Restrict to this object (repeatable; default: every object with an option field). A name the ' +
        'deployment does not declare is refused',
      multiple: true,
    }),
    'max-records': Flags.integer({
      description: 'Safety bound on rows read per object — exceeding it truncates the walk',
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateOptionCodes);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · option-codes');

    // Occupancy gate, like `blank-single-values`: an apply run rewrites ROWS,
    // so a second writer on the same SQLite file is a real hazard.
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
        chalk.bold('\nRewrite every decidable old-form option value to its code string on this database? [y/N] '),
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
      const engine: OptionCodesEngine = stack.kernel.getService('objectql');
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
      const view: OptionCodesEngine = {
        getObject: (name) => engine.getObject(name),
        ...(typeof engine.getConfigs === 'function' ? { getConfigs: () => engine.getConfigs!() } : {}),
        find: (object, options) =>
          !apply && stack.tableAbsent?.(object) ? Promise.resolve([]) : engine.find(object, options),
        update: (object, data, options) => engine.update(object, data, options),
      };

      const report = await migrateOptionCodes(view, logger, {
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
      console.log(`${formatOptionCodesReport(report).join('\n')}${journalNote}`);
      console.log('');

      if (report.failures.length > 0) {
        printError(`${report.failures.length} row(s) could not be rewritten — re-run to finish them.`);
      } else if (apply && report.rewritten > 0) {
        printSuccess(
          `Rewrote ${report.rewritten} value(s) across ${report.columns.length} field(s). ` +
            'Re-run any time — it only ever revisits values still stored in an old form.',
        );
      } else if (report.rewriteValues > 0) {
        printInfo(`Dry run only — ${report.rewriteValues} value(s) would be rewritten. Re-run with --apply.`);
      } else if (report.reportedValues === 0) {
        printSuccess('Nothing to rewrite — every stored option value is a code string.');
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
