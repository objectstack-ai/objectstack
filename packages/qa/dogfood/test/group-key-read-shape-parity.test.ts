// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Group-key read-shape parity (#3849).
//
// A `groupBy` key is a COLUMN VALUE, so there is only one right answer for what
// it looks like: whatever that column looks like on a `find()` row. Three code
// paths produce it and all three must agree —
//
//   find()                        → `formatOutput`, the canonical read shape
//   aggregate() pushed down       → raw builder output + per-column presentation
//   applyInMemoryAggregation()    → passes through find()'s own output
//
// — because `engine.aggregate` picks between the latter two per query (does the
// driver aggregate natively? does it advertise the requested granularity? is the
// reference timezone UTC?), and `find()` is what every non-aggregated read of
// the same column returns.
//
// They did not agree. The in-memory path `String()`-coerced every key (`3` →
// `'3'`, `true` → `'true'`), and the pushed-down path skipped the boolean and
// numeric repairs `formatOutput` applies, so a SQLite boolean surfaced as `0`/`1`
// there and `'false'`/`'true'` here. Three paths, three answers, same column.
//
// The damage was silent because every measure still reconciled. What broke was
// downstream code that probes a raw `Map` keyed by the value's own type — the
// select-option label table, the lookup FK → record-name table, the cross-object
// FK → attribute table. `Map` lookup is SameValueZero, so `'1'` never finds `1`:
// labels fell back to raw ids, and cross-object rebucketing filed every row
// under `'(restricted)'` while the totals stayed correct.
//
// This asserts the TYPE as well as the value. Folding both sides through
// `String()` — the reflex when comparing bucket labels — is exactly what hid
// this, and would make the check pass against the bug it exists to catch.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyInMemoryAggregation } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

const TABLE = 'deal';

const DRIVERS = [
  {
    name: 'driver-sql (better-sqlite3 :memory:)',
    make: () =>
      new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      }) as any,
  },
  {
    name: 'driver-sqlite-wasm (:memory:)',
    make: () => new SqliteWasmDriver({ filename: ':memory:' }) as any,
  },
];

/**
 * Every column whose stored form differs from its presented form on SQLite, plus
 * a text control. `text` is the shape that always agreed — if it ever fails, the
 * harness itself is wrong, not the driver.
 */
const COLUMNS = ['qty', 'won', 'stage'] as const;

/** `value<type>` pairs, sorted. Carrying the TYPE is the whole point. */
function shape(rows: any[], field: string): string[] {
  return rows
    .map((r) => `${JSON.stringify(r[field]) ?? 'undefined'}<${r[field] === null ? 'null' : typeof r[field]}>`)
    .sort();
}

describe.each(DRIVERS)('group-key read-shape parity: $name', ({ make }) => {
  let driver: any;
  let rows: any[];

  beforeEach(async () => {
    driver = make();
    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          qty: { type: 'number' },
          won: { type: 'boolean' },
          stage: { type: 'text' },
          amount: { type: 'number' },
        },
      },
    ]);
    const opts = { bypassTenantAudit: true };
    // Two rows share `qty`/`stage` and differ on `won`, so every column produces
    // both a merged and a split bucket — a key that silently changed shape would
    // otherwise be able to hide behind a one-row-per-bucket fixture.
    await driver.create(TABLE, { id: 'a', qty: 3, won: true, stage: 'won', amount: 1 }, opts);
    await driver.create(TABLE, { id: 'b', qty: 3, won: false, stage: 'won', amount: 2 }, opts);
    await driver.create(TABLE, { id: 'c', qty: 7, won: false, stage: 'lost', amount: 4 }, opts);
    // What `engine.aggregate` feeds the in-memory fallback, and the canonical
    // presentation both aggregate paths are measured against.
    rows = await driver.find(TABLE, {});
  });

  afterEach(async () => {
    await driver?.disconnect?.();
  });

  it.each(COLUMNS)("groups by '%s' identically on both paths, in find()'s shape", async (field) => {
    const ast = {
      object: TABLE,
      groupBy: [field],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    };

    const pushedDown = await driver.aggregate(TABLE, ast);
    const inMemory = applyInMemoryAggregation(rows, ast as never);

    // The two aggregate paths agree with each other…
    expect(shape(pushedDown, field)).toEqual(shape(inMemory, field));
    // …and with the shape the same column takes on a plain read. Deduplicated,
    // because find() returns one entry per ROW and aggregate one per BUCKET.
    const fromFind = [...new Set(shape(rows, field))].sort();
    expect([...new Set(shape(pushedDown, field))].sort()).toEqual(fromFind);

    // Totals were never the broken part; assert them so a "fix" that lost rows
    // while making the keys agree cannot pass.
    const total = (rs: any[]) => rs.reduce((a, r) => a + Number(r.total), 0);
    expect(total(pushedDown)).toBe(7);
    expect(total(inMemory)).toBe(7);
  });

  // Spelled out separately from the parametrised case above: these are the two
  // concrete shapes #3849 was filed about, and naming them makes a regression
  // report readable without decoding a `shape()` string.
  it('keeps a number key a number and a boolean key a boolean', async () => {
    const by = async (field: string) => {
      const ast = {
        object: TABLE,
        groupBy: [field],
        aggregations: [{ function: 'count', alias: 'n' }],
      };
      return {
        sql: (await driver.aggregate(TABLE, ast)).map((r: any) => r[field]).sort(),
        mem: applyInMemoryAggregation(rows, ast as never).map((r: any) => r[field]).sort(),
      };
    };

    const qty = await by('qty');
    expect(qty.sql).toEqual([3, 7]);
    expect(qty.mem).toEqual([3, 7]);

    const won = await by('won');
    expect(won.sql).toEqual([false, true]);
    expect(won.mem).toEqual([false, true]);
  });
});
