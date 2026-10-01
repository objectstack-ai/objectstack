// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21042] The move proof for `driver-sql`'s aggregate operand policies: the
 * statement `SqlDriver.aggregate()` emits, per dialect, per aggregate function
 * and per declared column class, is the one this driver emitted before the
 * policies moved.
 *
 * Three policies were module-private here and moved to `@objectstack/core`
 * (`utils/aggregate-answer.ts`), so the analytics native-SQL face applies the
 * same rules from one implementation:
 *
 * - `AGGREGATE_ACCUMULATION` (#20387): `sum` over a fractional column and `avg`
 *   over every numeric or boolean column accumulate in double on PostgreSQL
 *   and MySQL, through the column's text;
 * - the column class each policy reads, now one predicate over the declared
 *   shape `{ type, multiple }` (it used to be `isFractionalNumericType` here,
 *   beside the registry reads);
 * - the PostgreSQL boolean-aggregand cast (#11635): `sum` / `avg` / `min` /
 *   `max` over a boolean column cast it to `int`, the counts never.
 *
 * Every expected expression below was captured from the driver BEFORE the move
 * (base `d34aa58a2a`), compiled through the real `aggregate()` offline: the
 * probe captures knex's `toSQL()` where the statement would execute, so no
 * connection is opened. Both registration paths fill the registries the
 * policies read — a managed object (`registerObjectMetadata`) and a federated
 * one (`registerExternalObject`) — and each must emit the same expression.
 *
 * The columns are one of each class: an exact-decimal `number` and the
 * driver's `float` alias (fractional), a `rating` and the `integer` alias
 * (integer-valued), `boolean` and `toggle`, and three the policies leave
 * alone — `text`, a multi-valued `select` (a JSON column) and a field that
 * declares no type. SQLite applies none of the policies; its control row
 * holds that.
 */

import { describe, it, expect, afterAll } from 'vitest';
import type { DriverOptions } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';

const FIELDS: Record<string, Record<string, unknown>> = {
  g: { type: 'text' },
  f_number: { type: 'number' },
  f_float: { type: 'float' },
  i_rating: { type: 'rating' },
  i_integer: { type: 'integer' },
  b_boolean: { type: 'boolean' },
  b_toggle: { type: 'toggle' },
  o_text: { type: 'text' },
  o_select_multi: { type: 'select', multiple: true },
  o_untyped: {},
};

const FUNCTIONS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
type Fn = (typeof FUNCTIONS)[number];

/** The six expressions, in {@link FUNCTIONS} order, one column per row. */
type Row = readonly [count: string, countDistinct: string, sum: string, avg: string, min: string, max: string];

interface Cell {
  readonly dialect: 'sqlite' | 'postgres' | 'mysql';
  readonly config: SqlDriverConfig;
  /** An identifier as the dialect quotes it. */
  readonly q: (name: string) => string;
  /** The captured aggregate expression per column; columns absent here are not pinned on this dialect. */
  readonly expressions: Readonly<Record<string, Row>>;
}

const pgDouble = (x: string) => `cast(cast(${x} as text) as double precision)`;
const myDouble = (x: string) => `cast(cast(${x} as char) as double)`;

const CELLS: readonly Cell[] = [
  {
    dialect: 'postgres',
    config: { client: 'pg', connection: {} } as SqlDriverConfig,
    q: (n) => `"${n}"`,
    expressions: {
      f_number: ['count("f_number")', 'count(distinct "f_number")', `sum(${pgDouble('"f_number"')})`, `avg(${pgDouble('"f_number"')})`, 'min("f_number")', 'max("f_number")'],
      f_float: ['count("f_float")', 'count(distinct "f_float")', `sum(${pgDouble('"f_float"')})`, `avg(${pgDouble('"f_float"')})`, 'min("f_float")', 'max("f_float")'],
      i_rating: ['count("i_rating")', 'count(distinct "i_rating")', 'sum("i_rating")', `avg(${pgDouble('"i_rating"')})`, 'min("i_rating")', 'max("i_rating")'],
      i_integer: ['count("i_integer")', 'count(distinct "i_integer")', 'sum("i_integer")', `avg(${pgDouble('"i_integer"')})`, 'min("i_integer")', 'max("i_integer")'],
      b_boolean: ['count("b_boolean")', 'count(distinct "b_boolean")', 'sum(cast("b_boolean" as int))', `avg(${pgDouble('cast("b_boolean" as int)')})`, 'min(cast("b_boolean" as int))', 'max(cast("b_boolean" as int))'],
      b_toggle: ['count("b_toggle")', 'count(distinct "b_toggle")', 'sum(cast("b_toggle" as int))', `avg(${pgDouble('cast("b_toggle" as int)')})`, 'min(cast("b_toggle" as int))', 'max(cast("b_toggle" as int))'],
      o_text: ['count("o_text")', 'count(distinct "o_text")', 'sum("o_text")', 'avg("o_text")', 'min("o_text")', 'max("o_text")'],
      o_select_multi: ['count("o_select_multi")', 'count(distinct "o_select_multi")', 'sum("o_select_multi")', 'avg("o_select_multi")', 'min("o_select_multi")', 'max("o_select_multi")'],
      o_untyped: ['count("o_untyped")', 'count(distinct "o_untyped")', 'sum("o_untyped")', 'avg("o_untyped")', 'min("o_untyped")', 'max("o_untyped")'],
    },
  },
  {
    dialect: 'mysql',
    config: { client: 'mysql2', connection: {} } as SqlDriverConfig,
    q: (n) => `\`${n}\``,
    expressions: {
      f_number: ['count(`f_number`)', 'count(distinct `f_number`)', `sum(${myDouble('`f_number`')})`, `avg(${myDouble('`f_number`')})`, 'min(`f_number`)', 'max(`f_number`)'],
      f_float: ['count(`f_float`)', 'count(distinct `f_float`)', `sum(${myDouble('`f_float`')})`, `avg(${myDouble('`f_float`')})`, 'min(`f_float`)', 'max(`f_float`)'],
      i_rating: ['count(`i_rating`)', 'count(distinct `i_rating`)', 'sum(`i_rating`)', `avg(${myDouble('`i_rating`')})`, 'min(`i_rating`)', 'max(`i_rating`)'],
      i_integer: ['count(`i_integer`)', 'count(distinct `i_integer`)', 'sum(`i_integer`)', `avg(${myDouble('`i_integer`')})`, 'min(`i_integer`)', 'max(`i_integer`)'],
      b_boolean: ['count(`b_boolean`)', 'count(distinct `b_boolean`)', 'sum(`b_boolean`)', `avg(${myDouble('`b_boolean`')})`, 'min(`b_boolean`)', 'max(`b_boolean`)'],
      b_toggle: ['count(`b_toggle`)', 'count(distinct `b_toggle`)', 'sum(`b_toggle`)', `avg(${myDouble('`b_toggle`')})`, 'min(`b_toggle`)', 'max(`b_toggle`)'],
      o_text: ['count(`o_text`)', 'count(distinct `o_text`)', 'sum(`o_text`)', 'avg(`o_text`)', 'min(`o_text`)', 'max(`o_text`)'],
      o_select_multi: ['count(`o_select_multi`)', 'count(distinct `o_select_multi`)', 'sum(`o_select_multi`)', 'avg(`o_select_multi`)', 'min(`o_select_multi`)', 'max(`o_select_multi`)'],
      o_untyped: ['count(`o_untyped`)', 'count(distinct `o_untyped`)', 'sum(`o_untyped`)', 'avg(`o_untyped`)', 'min(`o_untyped`)', 'max(`o_untyped`)'],
    },
  },
  {
    // CONTROL: no policy applies on SQLite — every column is aggregated as stored.
    dialect: 'sqlite',
    config: { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true },
    q: (n) => `\`${n}\``,
    expressions: {
      f_number: ['count(`f_number`)', 'count(distinct `f_number`)', 'sum(`f_number`)', 'avg(`f_number`)', 'min(`f_number`)', 'max(`f_number`)'],
      i_rating: ['count(`i_rating`)', 'count(distinct `i_rating`)', 'sum(`i_rating`)', 'avg(`i_rating`)', 'min(`i_rating`)', 'max(`i_rating`)'],
      b_boolean: ['count(`b_boolean`)', 'count(distinct `b_boolean`)', 'sum(`b_boolean`)', 'avg(`b_boolean`)', 'min(`b_boolean`)', 'max(`b_boolean`)'],
    },
  },
];

/** Captures the statement `aggregate()` would execute, and answers no rows. */
class AggregateProbe extends SqlDriver {
  captured: { sql: string; bindings: readonly unknown[] } | null = null;

  protected getBuilder(object: string, options?: DriverOptions) {
    const builder = super.getBuilder(object, options);
    // `aggregate()` awaits the builder exactly once; answer that await offline.
    Object.defineProperty(builder, 'then', {
      configurable: true,
      value: (resolve: (rows: unknown[]) => unknown) => {
        const { sql, bindings } = builder.toSQL();
        this.captured = { sql, bindings: [...bindings] };
        return Promise.resolve(resolve([]));
      },
    });
    return builder;
  }

  async compile(table: string, fn: Fn | 'count', field: string | undefined) {
    this.captured = null;
    await this.aggregate(table, {
      groupBy: ['g'],
      aggregations: [{ function: fn, ...(field ? { field } : {}), alias: 'a' }],
    } as never);
    return this.captured;
  }
}

const probes: AggregateProbe[] = [];
afterAll(async () => {
  for (const probe of probes) await probe.disconnect().catch(() => {});
});

for (const cell of CELLS) {
  for (const fill of ['managed', 'external'] as const) {
    describe(`[#21042] the aggregate statement is unchanged by the policy move (${cell.dialect}, ${fill} registration)`, () => {
      const table = `t_${fill}`;
      const probe = new AggregateProbe(cell.config);
      probes.push(probe);
      if (fill === 'managed') probe.registerObjectMetadata([{ name: table, fields: FIELDS }]);
      else probe.registerExternalObject({ name: table, fields: FIELDS });
      const frame = (expr: string) =>
        `select ${cell.q('g')}, ${expr} as ${cell.q('a')} from ${cell.q(table)} group by ${cell.q('g')}`;

      it('the probe compiles for the dialect it names', () => {
        expect(probe.dialectName).toBe(cell.dialect);
      });

      it('count(*) is untouched', async () => {
        expect(await probe.compile(table, 'count', undefined)).toEqual({ sql: frame('count(*)'), bindings: [] });
      });

      for (const [column, row] of Object.entries(cell.expressions)) {
        it(`${column}: every function emits the pre-move expression`, async () => {
          for (const [i, fn] of FUNCTIONS.entries()) {
            expect(await probe.compile(table, fn, column), `${fn}(${column})`).toEqual({ sql: frame(row[i]!), bindings: [] });
          }
        });
      }
    });
  }
}
