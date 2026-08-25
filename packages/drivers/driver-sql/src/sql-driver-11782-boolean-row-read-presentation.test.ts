// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11782] A declared `Field.boolean` answers JSON booleans on EVERY read door,
 * on every dialect this driver speaks — one column, one answer set, whichever
 * door it is read through.
 *
 * ## The measured gap this suite exists to keep closed
 *
 * Measured 2026-08-25 on live MySQL 8.0.46 through the driver boundary, on
 * `main` @ `d63b014360`, before the fix (the same instrument as the card:
 * `driver.create(...)` + the read doors, over `flag` declared
 * `type: 'boolean'`, stored as `tinyint(1)`):
 *
 * - `find().flag`                → `1` / `0`   (`typeof number`)
 * - `distinct('flag')`           → `[0, 1]`    (`typeof number`)
 * - `aggregate` groupBy(`flag`)  → keys `1`/`0` (`typeof number`)
 * - `aggregate` `min`/`max`      → `false`/`true` (correct since #11635/#11785)
 *
 * while SQLite and Postgres answered `true`/`false` on all four. The boolean
 * read coercion in `formatOutput` — and its per-column mirror
 * `readPresentationKind`, which `distinct()` and the aggregate group-key /
 * `min`/`max` tracking consume — was gated `isSqlite`-only, so MySQL's storage
 * form leaked. Worse than a one-dialect leak: after #11635 presented the
 * aggregate door everywhere, `max(flag)` answered `true` while `find()` on the
 * SAME column over the SAME connection answered `1` — two doors, opposite
 * answers, in one request cycle. The fix runs the boolean presentation on the
 * two dialects whose stored boolean is a number (SQLite INTEGER 0/1, MySQL
 * `tinyint(1)`); Postgres stores a real `boolean` node-pg parses, so its
 * stored form already IS the presented form and it stays ungated.
 *
 * ## Assertion conventions
 *
 * Booleans are asserted STRICTLY (`toBe(true)` / `toBe(false)`, `toEqual` on
 * exact values): the before-state is a WRONG VALUE, not an absence — `1` is
 * truthy, so a `toBeTruthy()` pin would have passed on the defect this suite
 * went red on. The cross-door test asserts the doors against EACH OTHER on the
 * same column (per the triage note on the card: a one-door pin passes on an
 * implementation where the doors still disagree).
 *
 * ## Controls
 *
 * A declared `number` and a declared `string` column ride the same fixture and
 * must come back untouched — the presentation is per declared-boolean column,
 * never per row. A NULL boolean stays `null` on every door: absence is not
 * `false`, and `Boolean(null)` would manufacture one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'bool_row_read_presentation';

/** 1 true / 2 false / 1 null — asymmetric so a sticky constant shows. */
const ROWS = [
  { label: 'a', flag: true, score: 10 },
  { label: 'b', flag: false, score: 20 },
  { label: 'c', flag: false, score: 30 },
  { label: 'd', flag: null, score: 40 },
] as const;

function declarePresentation(cell: DialectCell): void {
describe(`[#11782] driver-sql — boolean row reads answer JSON booleans (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          label: { type: 'string' },
          flag: { type: 'boolean' },
          score: { type: 'number' },
        },
      },
    ]);
    for (const row of ROWS) {
      await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // The fixture read back rather than trusted: four rows under their labels —
  // a seed that dropped or folded a row would turn every assertion below into
  // a test of the wrong table.
  it('the fixture is four rows: T, F, F, NULL', async () => {
    const rows = (await driver.find(TABLE, {})) as Array<{ label: string }>;
    expect(rows.map((r) => r.label).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  // ─── The row-read door (`find()`) — the card's own surface ───────────────

  it('find() answers the JSON boolean true — not 1', async () => {
    const rows = (await driver.find(TABLE, { where: { label: 'a' } } as DriverQuery)) as any[];
    expect(rows).toHaveLength(1);
    // STRICT: `1` — the exact value this suite went red on — is truthy.
    expect(rows[0].flag).toBe(true);
  });

  it('find() answers the JSON boolean false — not 0', async () => {
    const rows = (await driver.find(TABLE, { where: { label: 'b' } } as DriverQuery)) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].flag).toBe(false);
  });

  it('find() passes a NULL boolean through — absence is not false', async () => {
    const rows = (await driver.find(TABLE, { where: { label: 'd' } } as DriverQuery)) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].flag).toBeNull();
  });

  it('CONTROL find() leaves declared number and string columns untouched', async () => {
    const rows = (await driver.find(TABLE, { where: { label: 'a' } } as DriverQuery)) as any[];
    expect(rows[0].score).toBe(10);
    expect(rows[0].label).toBe('a');
  });

  // ─── The values door (`distinct()`) — measured here, shares the gate ─────

  it('distinct(flag) answers JSON booleans — not 0/1', async () => {
    const values = await driver.distinct(TABLE, 'flag');
    // Set-compare: order is the dialect's; membership is the contract.
    // `toEqual` does not coerce, so a `Set {0, 1, null}` fails here.
    expect(new Set(values)).toEqual(new Set([true, false, null]));
  });

  it('CONTROL distinct(score) still answers numbers', async () => {
    const values = await driver.distinct(TABLE, 'score');
    expect(new Set(values)).toEqual(new Set([10, 20, 30, 40]));
  });

  // ─── Cross-door agreement — the assertion the triage note asked for ──────

  it('find(), distinct() and aggregate() answer the SAME JSON booleans for the same column', async () => {
    const found = new Set(
      ((await driver.find(TABLE, {})) as any[]).map((r) => r.flag),
    );
    const listed = new Set(await driver.distinct(TABLE, 'flag'));
    const grouped = (await driver.aggregate(TABLE, {
      groupBy: ['flag'],
      aggregations: [{ function: 'count', field: 'score', alias: 'n' }],
    } as DriverQuery)) as any[];
    const groupKeys = new Set(grouped.map((g) => g.flag));
    const agg = (await driver.aggregate(TABLE, {
      aggregations: [
        { function: 'min', field: 'flag', alias: 'lo' },
        { function: 'max', field: 'flag', alias: 'hi' },
      ],
    } as DriverQuery)) as any[];

    const domain = new Set([true, false, null]);
    expect(found, 'find()').toEqual(domain);
    expect(listed, 'distinct()').toEqual(domain);
    expect(groupKeys, 'aggregate group keys').toEqual(domain);
    expect(agg[0].lo, 'min(flag)').toBe(false);
    expect(agg[0].hi, 'max(flag)').toBe(true);
  });

  it('aggregate group keys carry per-group counts under the presented key', async () => {
    const grouped = (await driver.aggregate(TABLE, {
      groupBy: ['flag'],
      aggregations: [{ function: 'count', field: 'score', alias: 'n' }],
    } as DriverQuery)) as any[];
    const byKey = new Map(grouped.map((g) => [g.flag, Number(g.n)]));
    expect(byKey.get(true), 'count under key true').toBe(1);
    expect(byKey.get(false), 'count under key false').toBe(2);
    expect(byKey.get(null), 'count under key null').toBe(1);
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it (the #11455 suite's own guard, kept in force here).
describe('[#11782] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'boolean row-read presentation', declarePresentation);
}
