// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20889] `AGGREGATE_ANSWER_KIND` and `presentAsNumber` — what an aggregate
 * ANSWERS, and the one `'number'` presenter every face that hands a SQL
 * client's aggregate row to a caller applies: `driver-sql`'s own `aggregate()`
 * (#20335) and `service-analytics`' native-SQL face (`NativeSQLStrategy`).
 *
 * The wire strings below are the values measured on live PostgreSQL 16.13
 * through the analytics native-SQL path (node-postgres parses `bigint` and
 * `numeric` to strings), and the large totals are the ones #20335 pinned at the
 * driver door. Each face pins the same presentation through its own door, in
 * its own package, on SQLite and PostgreSQL.
 *
 * [#21042] The operand policies, moved here from `driver-sql` so the
 * analytics native-SQL face applies them too: `AGGREGATE_ACCUMULATION`
 * (#20387), the column class it and the boolean cast read
 * (`aggregandColumnClass`), the PostgreSQL boolean-aggregand cast (#11635) and
 * the double operand. The SQL text below is the text `driver-sql` emitted
 * before the move (its move proof, `sql-driver-21042-aggregate-policy-move
 * .test.ts`, pins the whole statements); each face pins the answers through
 * its own door.
 */

import { describe, it, expect } from 'vitest';
import { AggregationFunction, FieldType } from '@objectstack/spec/data';
import {
  AGGREGATE_ACCUMULATION,
  AGGREGATE_ANSWER_KIND,
  POSTGRES_BOOLEAN_AGGREGAND_CAST,
  aggregandColumnClass,
  aggregandOperandSql,
  doubleAccumulationOperand,
  presentAsNumber,
  type AggregandColumnClass,
  type AggregandSqlDialect,
} from './aggregate-answer';

describe('[#20889] AGGREGATE_ANSWER_KIND — what each declared aggregate function answers', () => {
  it('has exactly one row per declared aggregate function', () => {
    expect(Object.keys(AGGREGATE_ANSWER_KIND).sort()).toEqual([...AggregationFunction.options].sort());
  });

  it('count, count_distinct, sum and avg answer a number; min and max answer a value of the column', () => {
    expect(AGGREGATE_ANSWER_KIND).toEqual({
      count: 'number',
      count_distinct: 'number',
      sum: 'number',
      avg: 'number',
      min: 'column',
      max: 'column',
    });
  });
});

describe("[#20889] presentAsNumber — the 'number' presenter", () => {
  it('turns the numeric text a SQL client hands back into the number it spells', () => {
    // count / count_distinct (`bigint`), sum over an integer column (`bigint`).
    expect(presentAsNumber('2')).toBe(2);
    expect(presentAsNumber('11')).toBe(11);
    // avg over an integer column (`numeric`, 16 places).
    expect(presentAsNumber('3.5000000000000000')).toBe(3.5);
    // sum / avg / min / max over the exact-decimal column (`numeric(65,30)`).
    expect(presentAsNumber('500.000000000000000000000000000000')).toBe(500);
    expect(presentAsNumber('20.500000000000000000000000000000')).toBe(20.5);
    expect(presentAsNumber('0.125000000000000000000000000000')).toBe(0.125);
    expect(presentAsNumber('-7.250000000000000000000000000000')).toBe(-7.25);
  });

  it('precision policy: a total a double cannot hold answers the nearest double, never a string', () => {
    const big = presentAsNumber('9007199254740993.000000000000000000000000000000');
    expect(typeof big).toBe('number');
    expect(big).toBe(9007199254740992);
    expect(big).toBe(Number('9007199254740993'));
    const decimal = presentAsNumber('12345678901234567.123456789000000000000000000000');
    expect(typeof decimal).toBe('number');
    expect(decimal).toBe(12345678901234568);
    expect(decimal).toBe(Number('12345678901234567.123456789'));
  });

  it('passes every value that is not numeric text through as given', () => {
    expect(presentAsNumber(7)).toBe(7);
    expect(presentAsNumber(0.30000000000000004)).toBe(0.30000000000000004);
    expect(presentAsNumber(null)).toBeNull();
    expect(presentAsNumber(undefined)).toBeUndefined();
    expect(presentAsNumber(true)).toBe(true);
    expect(presentAsNumber('')).toBe('');
    expect(presentAsNumber('   ')).toBe('   ');
    // PostgreSQL's `numeric` 'NaN', and text `Number()` cannot read, stay as written.
    expect(presentAsNumber('NaN')).toBe('NaN');
    expect(presentAsNumber('abc')).toBe('abc');
    const date = new Date(0);
    expect(presentAsNumber(date)).toBe(date);
  });
});

describe('[#20387, #21042] AGGREGATE_ACCUMULATION — what each declared aggregate function accumulates in', () => {
  it('has exactly one row per declared aggregate function', () => {
    expect(Object.keys(AGGREGATE_ACCUMULATION).sort()).toEqual([...AggregationFunction.options].sort());
  });

  it('avg accumulates in double, sum in double over a fractional column, the rest as stored', () => {
    expect(AGGREGATE_ACCUMULATION).toEqual({
      count: 'as-stored',
      count_distinct: 'as-stored',
      sum: 'double-over-fractional',
      avg: 'double',
      min: 'as-stored',
      max: 'as-stored',
    });
  });
});

describe('[#11635, #21042] POSTGRES_BOOLEAN_AGGREGAND_CAST — the functions a PostgreSQL boolean aggregand is cast for', () => {
  it('has exactly one row per declared aggregate function', () => {
    expect(Object.keys(POSTGRES_BOOLEAN_AGGREGAND_CAST).sort()).toEqual([...AggregationFunction.options].sort());
  });

  it('sum, avg, min and max cast; the two counts never do', () => {
    expect(POSTGRES_BOOLEAN_AGGREGAND_CAST).toEqual({
      count: false,
      count_distinct: false,
      sum: true,
      avg: true,
      min: true,
      max: true,
    });
  });
});

describe('[#20387, #11635, #21042] aggregandColumnClass — the one column-class predicate over a declared shape', () => {
  const FRACTIONAL = ['number', 'currency', 'percent', 'slider', 'progress', 'summary'];
  const INTEGRAL = ['rating'];
  const BOOLEAN = ['boolean', 'toggle'];

  it('classes every declared field type: fractional, integral, boolean, or none', () => {
    for (const type of FieldType.options) {
      const want: AggregandColumnClass | undefined = FRACTIONAL.includes(type)
        ? 'fractional'
        : INTEGRAL.includes(type)
          ? 'integral'
          : BOOLEAN.includes(type)
            ? 'boolean'
            : undefined;
      expect(aggregandColumnClass({ type }), type).toBe(want);
    }
  });

  it('every member of the three classes is a declared field type, so none of them is a typo', () => {
    for (const type of [...FRACTIONAL, ...INTEGRAL, ...BOOLEAN]) expect(FieldType.options, type).toContain(type);
  });

  it("classes driver-sql's internal column aliases: float is fractional, integer and int integral", () => {
    expect(aggregandColumnClass({ type: 'float' })).toBe('fractional');
    expect(aggregandColumnClass({ type: 'integer' })).toBe('integral');
    expect(aggregandColumnClass({ type: 'int' })).toBe('integral');
  });

  it('a multi-valued column (a JSON list) is in no class', () => {
    expect(aggregandColumnClass({ type: 'select', multiple: true })).toBeUndefined();
    expect(aggregandColumnClass({ type: 'tags' })).toBeUndefined();
    expect(aggregandColumnClass({ type: 'lookup', multiple: true })).toBeUndefined();
  });

  it('`multiple` on a type that cannot be multi-valued changes nothing, as storage ignores it', () => {
    expect(aggregandColumnClass({ type: 'number', multiple: true })).toBe('fractional');
    expect(aggregandColumnClass({ type: 'rating', multiple: true })).toBe('integral');
    expect(aggregandColumnClass({ type: 'boolean', multiple: true })).toBe('boolean');
  });

  it('no declaration is no class', () => {
    expect(aggregandColumnClass(undefined)).toBeUndefined();
    expect(aggregandColumnClass(null)).toBeUndefined();
    expect(aggregandColumnClass({})).toBeUndefined();
    expect(aggregandColumnClass({ type: 'string' })).toBeUndefined();
  });
});

describe('[#20387, #21042] doubleAccumulationOperand — the column text, parsed as a double', () => {
  it('PostgreSQL and MySQL each spell it their way', () => {
    expect(doubleAccumulationOperand('"amount"', 'postgres')).toBe('cast(cast("amount" as text) as double precision)');
    expect(doubleAccumulationOperand('`amount`', 'mysql')).toBe('cast(cast(`amount` as char) as double)');
  });
});

describe('[#20387, #11635, #21042] aggregandOperandSql — the operand each face aggregates', () => {
  const X = 'COL';
  const pg = (f: AggregationFunction, c: AggregandColumnClass | undefined) => aggregandOperandSql(f, c, 'postgres', X);
  const my = (f: AggregationFunction, c: AggregandColumnClass | undefined) => aggregandOperandSql(f, c, 'mysql', X);
  const PG_DOUBLE = (x: string) => `cast(cast(${x} as text) as double precision)`;
  const MY_DOUBLE = (x: string) => `cast(cast(${x} as char) as double)`;

  it('PostgreSQL: sum over a fractional column and avg over every class accumulate in double', () => {
    expect(pg('sum', 'fractional')).toBe(PG_DOUBLE(X));
    expect(pg('avg', 'fractional')).toBe(PG_DOUBLE(X));
    expect(pg('avg', 'integral')).toBe(PG_DOUBLE(X));
    expect(pg('sum', 'integral'), 'an integer total stays exact').toBe(X);
  });

  it('PostgreSQL: a boolean aggregand is cast to int for sum / avg / min / max, inside the double operand', () => {
    expect(pg('sum', 'boolean')).toBe(`cast(${X} as int)`);
    expect(pg('avg', 'boolean')).toBe(PG_DOUBLE(`cast(${X} as int)`));
    expect(pg('min', 'boolean')).toBe(`cast(${X} as int)`);
    expect(pg('max', 'boolean')).toBe(`cast(${X} as int)`);
  });

  it('PostgreSQL: the counts and min / max over a numeric column take the column as stored', () => {
    for (const c of ['fractional', 'integral', 'boolean'] as const) {
      expect(pg('count', c), `count ${c}`).toBe(X);
      expect(pg('count_distinct', c), `count_distinct ${c}`).toBe(X);
    }
    expect(pg('min', 'fractional')).toBe(X);
    expect(pg('max', 'integral')).toBe(X);
  });

  it('MySQL: the same accumulation, and no boolean cast (a boolean is tinyint(1) there)', () => {
    expect(my('sum', 'fractional')).toBe(MY_DOUBLE(X));
    expect(my('avg', 'integral')).toBe(MY_DOUBLE(X));
    expect(my('avg', 'boolean')).toBe(MY_DOUBLE(X));
    expect(my('sum', 'boolean')).toBe(X);
    expect(my('min', 'boolean')).toBe(X);
    expect(my('sum', 'integral')).toBe(X);
  });

  it('a column in no class is aggregated as stored on every dialect', () => {
    for (const d of ['postgres', 'mysql', 'sqlite', 'unknown'] as const) {
      for (const f of AggregationFunction.options) expect(aggregandOperandSql(f, undefined, d, X), `${d} ${f}`).toBe(X);
    }
  });

  it('SQLite and an unnamed dialect apply neither policy: SQLite already adds doubles and stores booleans as 0 / 1', () => {
    for (const d of ['sqlite', 'unknown'] as const satisfies readonly AggregandSqlDialect[]) {
      for (const f of AggregationFunction.options) {
        for (const c of ['fractional', 'integral', 'boolean'] as const) {
          expect(aggregandOperandSql(f, c, d, X), `${d} ${f} ${c}`).toBe(X);
        }
      }
    }
  });
});
