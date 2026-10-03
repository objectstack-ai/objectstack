// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { objectNotFoundError } from '@objectstack/core';
import { keysetWalk } from '@objectstack/types';
import { StorageNameMapping } from '@objectstack/spec/system';
import type { ManagedDriftEntry } from '@objectstack/driver-sql';
import {
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  errorCodeFields,
  isExitSignal,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { exitOneShotCommand } from '../../utils/one-shot-exit.js';
import {
  refuseWhenHostConfigUnloadable,
  type SchemaMigrationComposition,
} from '../../utils/schema-migration-plugins.js';

/** Rows per page of the read. The projection is `id` plus the unmapped columns, so a page stays narrow. */
const PAGE_SIZE = 500;

/** One unmapped column, as `os migrate plan` reports it: the name, and the physical type the differ read. */
export interface UnmappedColumn {
  column: string;
  actual: string;
}

/** One record's unmapped values, keyed by its id. */
export interface UnmappedColumnRecord {
  id: unknown;
  values: Record<string, unknown>;
}

/**
 * The columns `os migrate plan` reports as `unmapped_column` for one table.
 *
 * ⛔ A filter over the plan's own findings, never a second column diff. The
 * differ (`diffManagedTable` in `@objectstack/driver-sql`, reached through
 * `detectManagedDrift()`) owns what counts as unmapped, including what it
 * leaves out: the columns the driver creates unconditionally (`id`,
 * `created_at`, `updated_at`) and a driver-owned hash-shadow column, which
 * carries a UNIQUE index rather than a retired field's values. A column this
 * door emits is therefore always a column the plan reports, and a column the
 * plan reports for this table is always one this door emits.
 */
export function unmappedColumnsOf(drift: readonly ManagedDriftEntry[], table: string): UnmappedColumn[] {
  return drift
    .filter((d) => d.kind === 'unmapped_column' && d.table === table && typeof d.column === 'string')
    .map((d) => ({ column: d.column as string, actual: String(d.actual) }));
}

/** The driver read this door issues: `find` only, read-only by construction. */
export interface UnmappedColumnReader {
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
}

/**
 * The class of a value JSON cannot carry as the database stored it, or `null`
 * when it can.
 *
 * Each of the three arrives in a JSON document as something else, with nothing
 * to say so: binary bytes as an object shaped `{ type, data }` (a `Buffer`) or
 * as an index-keyed object (another typed array), a `bigint` as a thrown
 * serialisation error, and `NaN` / `±Infinity` as `null`. A conversion script
 * would write the stand-in into the replacing field and report success, so the
 * door refuses these instead of emitting them. ⛔ No codec: choosing a
 * representation would make a representation part of this door's contract.
 *
 * A `Date` is not in the set: PostgreSQL hands a `timestamp` column back as
 * one, and it serialises to its unambiguous ISO 8601 text.
 */
export function unrepresentableKind(value: unknown): string | null {
  if (ArrayBuffer.isView(value)) return 'binary bytes';
  if (typeof value === 'bigint') return 'a bigint';
  if (typeof value === 'number' && !Number.isFinite(value)) return `a non-finite number (${String(value)})`;
  return null;
}

/**
 * Read every row's unmapped values, keyed by record id.
 *
 * Through the DRIVER, never the engine: the engine's read verbs serve the
 * declared fields and refuse a name no metadata declares, which is the
 * runtime rule this operator door exists beside, not a gap in it. No tenant
 * scope is passed, so the read covers every organization's rows, under the
 * credentials the operator's database URL carries.
 *
 * Values are emitted as the driver hands them back. An unmapped column has no
 * declared type, so the driver applies none of its field-type decoding to it,
 * and this function applies none either: no parsing, no hydration, no
 * decryption.
 *
 * ⛔ Refuses, and emits nothing, when the read cannot be complete:
 *  - the walk stops before the end of the table (`--max-records`, or a row it
 *    cannot seek past): a conversion run over part of a table, followed by the
 *    destructive drop, loses the rest;
 *  - a row comes back without a column the differ reported: the SQL driver
 *    answers a projection naming a missing column with the whole row instead,
 *    and a record emitted without its value would read as converted;
 *  - a value is one JSON cannot carry as stored ({@link unrepresentableKind}):
 *    it would be emitted as a stand-in a conversion would write as the value;
 *  - the driver answers something other than an array of rows.
 */
export async function readUnmappedColumnValues(
  reader: UnmappedColumnReader,
  object: string,
  columns: readonly string[],
  opts: { max?: number } = {},
): Promise<UnmappedColumnRecord[]> {
  const walk = keysetWalk<Record<string, unknown>>(
    async (q) => {
      const page = await reader.find(object, {
        where: q.where,
        orderBy: q.orderBy,
        limit: q.limit,
        fields: ['id', ...columns],
      });
      if (!Array.isArray(page)) {
        throw new Error(
          `Reading ${object} answered ${page === null ? 'null' : typeof page}, not an array of rows. ` +
            'Refusing rather than reading an uninterpretable answer as an empty one.',
        );
      }
      return page as Array<Record<string, unknown>>;
    },
    { pageSize: PAGE_SIZE, ...(opts.max != null ? { max: opts.max } : {}) },
  );

  const records: UnmappedColumnRecord[] = [];
  for await (const page of walk.pages()) {
    for (const row of page) {
      const values: Record<string, unknown> = {};
      for (const column of columns) {
        if (!Object.prototype.hasOwnProperty.call(row, column)) {
          throw new Error(
            `Reading ${object} returned record ${String(row.id)} without the column ${column}, which ` +
              '"os migrate plan" reports as unmapped. The driver answered a different projection than ' +
              'the one asked for. Refusing rather than emitting the record without that value.',
          );
        }
        const kind = unrepresentableKind(row[column]);
        if (kind !== null) {
          throw new Error(
            `Record ${String(row.id)} of ${object} holds ${kind} in the column ${column}, which JSON cannot ` +
              'carry as the database stored it. Read that column with the database\'s own client. Refusing ' +
              'rather than emitting a stand-in a conversion would write as the value; no record was emitted.',
          );
        }
        values[column] = row[column];
      }
      records.push({ id: row.id, values });
    }
  }

  if (walk.truncated) {
    throw new Error(
      `The read of ${object} stopped at ${walk.scanned} row(s) without reaching the end of the table, ` +
        'so the rows it did not read cannot be emitted. ' +
        (opts.max != null ? 'Re-run with a higher row cap (--max-records). ' : '') +
        'Refusing rather than emitting a partial set: a conversion over part of the table, followed by ' +
        'the destructive drop, loses the rest.',
    );
  }
  return records;
}

/**
 * `os migrate unmapped-columns` — read the values of the columns `os migrate
 * plan` reports as `unmapped_column` for one object, keyed by record id.
 *
 * ## What it is for
 *
 * Retiring a field leaves its column in the table: the additive schema sync
 * never drops one, and `os migrate apply --allow-destructive` is what does.
 * Between the two, the column's values are still stored, and no runtime door
 * serves them: a read or a write through the engine answers the object's
 * declared fields only, and naming the column is refused. An app that moves a
 * retired field's values into the field that replaced it needs to read them
 * once, and this is that read: the operator runs it, a conversion script
 * writes the values into the declared fields, and only then does the
 * destructive apply drop the columns.
 *
 * ## Why it is a CLI read and nothing else
 *
 *  - **Operator-only.** It runs under the operator's own database credentials
 *    (`--database-url`), like every `os migrate` subcommand. There is no REST
 *    route, API flag or per-request option behind it: a runtime door that
 *    served undeclared columns is exactly what the read narrowing closed.
 *  - **Read-only.** It boots the way `os migrate plan` does (schema DDL
 *    deferred, no seed, no database file created) and issues one paged
 *    `find` per page. Dropping the columns stays `os migrate apply
 *    --allow-destructive`'s job.
 *  - **One column set.** The columns are the plan's own `unmapped_column`
 *    findings for the object's table ({@link unmappedColumnsOf}). The boot is
 *    the plan's boot, host composition included, so the object set the differ
 *    runs over is the plan's too.
 *
 * ## The answers
 *
 *  - columns found: their values, keyed by record id, exit 0;
 *  - an object with no unmapped column, or with no table in this database yet:
 *    empty work, exit 0;
 *  - no SQL driver: the plan's own answer (`no_sql_driver`, exit 0), since no
 *    differ runs there;
 *  - an object name no registry entry resolves: `OBJECT_NOT_FOUND`, exit 1;
 *  - an object the plan does not diff (federated, or bound to another
 *    datasource): refused, exit 1, because an empty answer there would be
 *    unmeasured rather than clean;
 *  - a read that cannot be complete, or a value JSON cannot carry as stored:
 *    refused, exit 1, no record emitted ({@link readUnmappedColumnValues}).
 */
export default class MigrateUnmappedColumns extends Command {
  // No tracker id in this string: a command description reaches operators,
  // who have no tracker to resolve one against (`check:doc-authoring`).
  static override description =
    'Read the values of the columns "os migrate plan" reports as unmapped_column for one object, keyed by ' +
    'record id, so a conversion script can move a retired field\'s values into the field that replaced it ' +
    'before "os migrate apply --allow-destructive" drops the columns. Read-only; runs under the database ' +
    'credentials you pass, and no runtime door serves these values.';

  static override examples = [
    '$ os migrate unmapped-columns --object contact',
    '$ os migrate unmapped-columns --object contact --json > contact-unmapped.json',
    '$ os migrate unmapped-columns --object contact --max-records 1000000 --json',
    '$ os migrate unmapped-columns --object contact --database-url postgres://…',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to read (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    object: Flags.string({
      description: 'The object whose unmapped columns to read (one per run)',
      required: true,
    }),
    'max-records': Flags.integer({
      description:
        'Row cap for the read. Reaching it REFUSES rather than emitting a partial set.',
    }),
    json: Flags.boolean({ description: 'Output the columns and their values, keyed by record id, as JSON' }),
  };

  /**
   * What {@link read} composed, read by {@link run} after it returns — the
   * `os migrate plan` wrapper's shape. `null` until the stack has booted.
   */
  private composition: SchemaMigrationComposition | null = null;

  /**
   * The body is {@link read}; this wrapper ends the process deliberately, for
   * the reason `os migrate plan`'s does: the composed host boot can leave the
   * event loop alive after the kernel reports a clean shutdown. The failure
   * paths exit through oclif's own signal and do not come back here.
   */
  async run(): Promise<void> {
    await this.read();
    // A host config that exists but could not be loaded means the object set
    // above is a fraction of the deployment's: the document stands, the run
    // is refused, exactly as the plan refuses it.
    if (this.composition) refuseWhenHostConfigUnloadable(this.composition);
    await exitOneShotCommand(typeof process.exitCode === 'number' ? process.exitCode : 0);
  }

  private async read(): Promise<void> {
    const { flags } = await this.parse(MigrateUnmappedColumns);
    const timer = createTimer();
    const object = flags.object;
    const table = StorageNameMapping.resolveTableName({ name: object });

    if (!flags.json) {
      printHeader('Migrate · unmapped-columns');
      printStep('Booting schema stack (read-only)…');
    }

    let stack;
    try {
      // The `os migrate plan` boot, so the differ runs over the plan's object
      // set: schema DDL deferred and no seed (`deferSchemaDdl`), no database
      // file brought into existence (`readOnlyProbe`), and the deployment's
      // own composition (`composeHostStack`).
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        deferSchemaDdl: true,
        readOnlyProbe: true,
        composeHostStack: true,
      });
    } catch (error: any) {
      if (flags.json) {
        await emitJson(
          { error: 'boot_failed', detail: error?.message ?? String(error), ...errorCodeFields(error) },
          1,
          { compact: true },
        );
        return;
      }
      printError(error?.message ?? String(error));
      this.exit(1);
      return;
    }
    this.composition = stack.composition;

    try {
      // The plan's answer where no differ runs: no SQL driver, no drift report.
      if (!stack.driver) {
        if (flags.json) {
          await emitJson({ error: 'no_sql_driver', object, columns: [], records: [] }, 0, { compact: true });
          return;
        }
        printInfo(
          'Unmapped columns are reported by the SQL drivers\' schema differ (SQLite / Postgres). No SQL driver ' +
            'is active, so "os migrate plan" reports none and there is nothing to read.',
        );
        return;
      }

      const declared = stack
        .allObjects()
        .find((o) => (o as { name?: unknown } | null)?.name === object) as { external?: unknown } | undefined;
      if (!declared) throw objectNotFoundError(object);

      // The coverage pass's own judgement (`measureComposedCoverage`): the plan
      // diffs the objects bound to its driver and nothing else. For any other
      // object it reports nothing, and that nothing is unmeasured, not clean.
      const engine = (stack.kernel as { getService?: (n: string) => unknown }).getService?.call(
        stack.kernel,
        'objectql',
      ) as { getDriverForObject?: (name: string) => unknown } | undefined;
      const bound = engine?.getDriverForObject?.(object);
      const outside =
        declared.external != null
          ? 'it is federated (no managed table)'
          : !bound
            ? 'it is bound to no driver'
            : bound !== stack.driver
              ? 'it is bound to a different datasource'
              : null;
      if (outside) {
        throw new Error(
          `${object} is not in the set "os migrate plan" diffs: ${outside}. The plan reports no unmapped column ` +
            'for it, and that is unmeasured, not clean. Refusing rather than answering empty work.',
        );
      }

      const reader = stack.driver as unknown as Partial<UnmappedColumnReader>;
      if (typeof reader.find !== 'function') {
        throw new Error(`The SQL driver on this stack has no find(); ${object} cannot be read from here.`);
      }

      // [#21529] Not asked: the read-only boot measured this table absent, and
      // a table that does not exist holds no column to read.
      if (stack.tableAbsent(object)) {
        const line = `${object} has no table in this database yet, so it holds no column to read and it was not read.`;
        if (flags.json) {
          console.error(line);
          await emitJson({
            database: stack.dbLabel,
            object,
            table,
            columns: [],
            count: 0,
            records: [],
            duration: timer.elapsed(),
          });
          return;
        }
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        printInfo(line);
        printSuccess(`No unmapped column on ${object} — nothing to read.`);
        return;
      }

      const drift = await stack.driver.detectManagedDrift();
      const columns = unmappedColumnsOf(drift, table);

      const records =
        columns.length === 0
          ? []
          : await readUnmappedColumnValues(
              { find: (o, q) => (reader.find as UnmappedColumnReader['find']).call(stack.driver, o, q) },
              object,
              columns.map((c) => c.column),
              flags['max-records'] != null ? { max: flags['max-records'] } : {},
            );

      if (flags.json) {
        await emitJson({
          database: stack.dbLabel,
          object,
          table,
          columns,
          count: records.length,
          records,
          duration: timer.elapsed(),
        });
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      printInfo(`Object: ${chalk.white(object)} (table ${table})`);
      console.log('');
      if (columns.length === 0) {
        printSuccess(`No unmapped column on ${object} — nothing to read.`);
        console.log(chalk.dim(`  ${timer.display()}`));
        return;
      }
      printInfo(`${columns.length} unmapped column(s), as "os migrate plan" reports them:`);
      for (const c of columns) console.log(`    ${chalk.bold(c.column)}  ${chalk.dim(c.actual)}`);
      console.log('');
      for (const r of records) console.log(`  ${String(r.id)}  ${JSON.stringify(r.values)}`);
      console.log('');
      printSuccess(
        `Read ${records.length} record(s). Convert these values into the declared fields that replaced the ` +
          'columns, then run "os migrate apply --allow-destructive" to drop them.',
      );
      console.log(chalk.dim(`  ${timer.display()}`));
    } catch (error: any) {
      // `this.exit(1)` throws oclif's exit signal; re-reporting it would print
      // a second document after the first.
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        await emitJson({ error: error?.message ?? String(error), ...errorCodeFields(error) }, 1, { compact: true });
        this.exit(1);
      }
      printError(error?.message ?? String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
