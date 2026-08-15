// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#8790 — one unresolvable WHERE column, ONE answer.
 *
 * Measured before the fix, real `SqlDriver` on better-sqlite3, one seeded row:
 *
 * ```
 * where { 'title.x': 'y' }
 *   find()   ->  0 rows, NO ERROR
 *   count()  ->  THREW  code=SQLITE_ERROR  status=undefined
 *                select count(*) as `count` from `task` where `title`.`x` = 'y'
 *                  - no such column: title.x
 * ```
 *
 * Two answers to one predicate: a list view calls both halves, so the user got
 * an empty page from the rows half and a 500-shaped failure from the total
 * half — or, reading only the rows, a silent empty page that says "no records
 * exist" for what was really "your predicate never ran".
 *
 * Maintainer ruling 2026-08-15 (issue comment 5302931807): **refuse both**,
 * with the ADR-0112 envelope this path already declares — `INVALID_FILTER` /
 * 400, naming the column. Recover-both was excluded by the card's own argument
 * (dropping a WHERE returns rows the caller excluded), and the #3821 ladder
 * KEEPS its projection and ORDER-BY recoveries: only the WHERE-failure terminal
 * `return []` became a refusal.
 *
 * ## What each half of this suite is for
 *
 * A refusal pin alone cannot show the refusal is SELECTIVE rather than blanket,
 * and a blanket refusal here would break every query on the platform. So every
 * refusal case is stated next to a CONTROL on the same shape with a resolvable
 * column, asserting the rows/count still come back unchanged. The third block
 * pins what was deliberately NOT changed — the two recoveries — because those
 * are what an over-broad fix destroys silently.
 *
 * ## The DIALECT axis
 *
 * `INVALID_FILTER` / 400 is required on both SQL drivers by
 * `cross-field-conformance-cases.ts`, so a fix pinned on one dialect proves
 * half the contract. The end-to-end sweep runs the `DIALECT_CELLS` cells whose
 * wording the driver recognises (SQLite always, live Postgres when the runner
 * provisions it), and the MESSAGE-SHAPE sweep at the bottom covers all three
 * dialects' real error texts unconditionally — that parsing is the only
 * dialect-sensitive part of the fix, and it must not go unmeasured on a runner
 * without a live server.
 *
 * ⚠️ MySQL is NOT in the end-to-end sweep, and that omission is a measurement,
 * not an oversight: MySQL spells this condition `Unknown column 'x' in 'where
 * clause'`, which `isUnresolvableColumnError` matches with neither arm — so on
 * MySQL the raw dialect error has always travelled out and still does. The
 * message-shape sweep pins exactly that, so the gap is visible and goes red the
 * day someone widens the predicate. It is filed separately rather than closed
 * here because widening would also hand MySQL the #3821 recoveries it has never
 * had, which is an accept-set change in the opposite direction from this one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver, isUnresolvableColumnError, unresolvableColumnNameOf } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'unresolvable_where_task';

/**
 * The bound literal the caller's filter carries. Distinctive on purpose: the
 * pre-fix `count()` message inlined it verbatim (`… where \`title\`.\`x\` =
 * 'y' …`), so asserting its ABSENCE from every caller-visible message is what
 * pins the redaction rather than merely the status code.
 */
const SECRET_LITERAL = 'zz-bound-literal-must-not-leak';

/** Cells whose unresolvable-column wording this driver recognises. */
const RECOGNISED_CELLS = DIALECT_CELLS.filter((c) => c.id === 'sqlite' || c.id === 'pg');

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return expect.fail('expected the query to be refused, but it resolved');
}

function declareSweep(cell: DialectCell): void {
describe(`[#8790] driver-sql — unresolvable WHERE column refuses on BOTH halves (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    // Live cells reuse one database, so the sweep starts from a dropped table.
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([
      { name: TABLE, fields: { title: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
    await driver.create(TABLE, { id: 't1', title: 'Design', rank: 1 }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 't2', title: 'Build', rank: 2 }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE RULING — both halves refuse, with the declared envelope
  // ───────────────────────────────────────────────────────────────

  // A plain unknown key and a dotted one are the two routes the card names:
  // the dotted one is what stays reachable with a fully populated registry
  // (the doors judge a dotted key on its head segment only), the plain one is
  // what reaches the driver when the registry cannot answer at all.
  for (const [label, where, named] of [
    ['a plain unknown column', { nosuchcol: SECRET_LITERAL }, 'nosuchcol'],
    ['a dotted key on a real head', { 'title.x': SECRET_LITERAL }, 'title.x'],
  ] as const) {
    it(`find() refuses ${label} with INVALID_FILTER / 400 naming the column`, async () => {
      const err = await caught(() => driver.find(TABLE, { where } as any));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(named);
    });

    it(`count() refuses ${label} with INVALID_FILTER / 400 naming the column`, async () => {
      const err = await caught(() => driver.count(TABLE, { where } as any));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(named);
    });

    // The two halves must not merely both fail — they must fail the SAME way.
    // Answering one predicate two different ways is the whole defect.
    it(`find() and count() answer ${label} with the same envelope`, async () => {
      const onFind = await caught(() => driver.find(TABLE, { where } as any));
      const onCount = await caught(() => driver.count(TABLE, { where } as any));
      expect({ code: onCount.code, status: onCount.status, message: onCount.message })
        .toEqual({ code: onFind.code, status: onFind.status, message: onFind.message });
    });
  }

  // ⭐ The invariant half of the ruling — true under every branch it could have
  // taken. `count()` used to answer the dialect's own error with the bound
  // literal inlined: a declared-vs-enforced gap against ADR-0112 AND the
  // predicate-text disclosure shape #7929 redacted elsewhere.
  it('neither half puts the bound literal or the compiled statement on the wire', async () => {
    for (const half of [
      () => driver.find(TABLE, { where: { nosuchcol: SECRET_LITERAL } } as any),
      () => driver.count(TABLE, { where: { nosuchcol: SECRET_LITERAL } } as any),
    ]) {
      const err = await caught(half);
      expect(err.message).not.toContain(SECRET_LITERAL);
      expect(err.message).not.toContain('select ');
      // The dialect's own code must not survive either — it is what made this
      // an unclassified 5xx at the REST boundary rather than a caller mistake.
      expect(err.code).not.toBe('SQLITE_ERROR');
      expect(err.status).toBe(400);
    }
  });

  // ───────────────────────────────────────────────────────────────
  // CONTROLS — the refusal is SELECTIVE, not blanket
  // ───────────────────────────────────────────────────────────────

  it('CONTROL a resolvable column on the same shape still returns its rows and its count', async () => {
    const rows = await driver.find(TABLE, { where: { title: 'Design' } } as any);
    expect(rows.map((r: any) => r.id)).toEqual(['t1']);
    expect(await driver.count(TABLE, { where: { title: 'Design' } } as any)).toBe(1);
  });

  it('CONTROL an unfiltered read is untouched', async () => {
    const rows = await driver.find(TABLE, {} as any);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['t1', 't2']);
    expect(await driver.count(TABLE)).toBe(2);
  });

  it('CONTROL a resolvable predicate that genuinely matches nothing is still an honest empty list', async () => {
    // The one empty answer that must never become a 400: the predicate ran.
    expect(await driver.find(TABLE, { where: { title: 'no-such-title' } } as any)).toEqual([]);
    expect(await driver.count(TABLE, { where: { title: 'no-such-title' } } as any)).toBe(0);
  });

  it('CONTROL an error that is not about an unresolvable column still propagates unchanged', async () => {
    const err = await caught(() => driver.find('no_such_table_at_all', {} as any));
    expect(err.code).not.toBe('INVALID_FILTER');
  });

  // ───────────────────────────────────────────────────────────────
  // WHAT WAS DELIBERATELY NOT CHANGED — the #3821 ladder's recoveries
  // ───────────────────────────────────────────────────────────────

  it('KEEPS the #3821 projection recovery — and honours the WHERE while recovering', async () => {
    const rows = await driver.find(TABLE, {
      fields: ['title', 'nosuchfield'],
      where: { rank: { $gte: 1 } },
    } as any);
    expect(rows.map((r: any) => r.title).sort()).toEqual(['Build', 'Design']);
  });

  it('KEEPS the #3821 ORDER-BY recovery — and honours the WHERE while recovering', async () => {
    const rows = await driver.find(TABLE, {
      orderBy: [{ field: 'nosuchfield', order: 'asc' }],
      where: { rank: { $gte: 2 } },
    } as any);
    expect(rows.map((r: any) => r.id)).toEqual(['t2']);
  });

  it('KEEPS both recoveries together, with a resolvable WHERE', async () => {
    const rows = await driver.find(TABLE, {
      fields: ['title', 'nosuchfield'],
      orderBy: [{ field: 'alsomissing', order: 'asc' }],
      where: { rank: { $gte: 1 } },
    } as any);
    expect(rows).toHaveLength(2);
  });

  // The discriminator between "the ladder recovered" and "the ladder refused":
  // an unresolvable PROJECTION plus an unresolvable WHERE is not recoverable,
  // because no rung may drop the predicate. It must refuse — and it must name
  // the WHERE's column, not the projection's, since the projection is the half
  // the ladder actually fixed.
  it('refuses when the WHERE is unresolvable even though the projection was recoverable', async () => {
    const err = await caught(() =>
      driver.find(TABLE, { fields: ['title', 'nosuchfield'], where: { alsomissing: 'x' } } as any),
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('alsomissing');
    expect(err.message).not.toContain('nosuchfield');
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#8790] the dialect axis this suite runs', () => {
  it('covers the cells whose wording the driver recognises', () => {
    expect(RECOGNISED_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg']);
  });
});

for (const cell of RECOGNISED_CELLS) {
  declareDialectCell(cell, 'unresolvable WHERE column refusal', declareSweep);
}

// ─────────────────────────────────────────────────────────────────
// MESSAGE SHAPE — all three dialects, no live server required
// ─────────────────────────────────────────────────────────────────

/**
 * Real error texts, as knex surfaces them (statement, ` - `, then the driver's
 * own words). These are what the fix actually reads, so they are pinned as
 * data: a runner without `OS_TEST_POSTGRES_URL` still measures that Postgres'
 * wording yields its column name, which is the half of the both-dialect
 * contract an unprovisioned cell would otherwise leave unproven.
 */
const DIALECT_MESSAGES: ReadonlyArray<{
  dialect: string;
  message: string;
  recognised: boolean;
  column: string | null;
}> = [
  {
    dialect: 'sqlite (better-sqlite3)',
    message: "select * from `task` where `nosuchcol` = 'y' - no such column: nosuchcol",
    recognised: true,
    column: 'nosuchcol',
  },
  {
    dialect: 'sqlite, dotted key',
    message: "select count(*) as `count` from `task` where `title`.`x` = 'y' - no such column: title.x",
    recognised: true,
    column: 'title.x',
  },
  {
    dialect: 'postgres, quoted',
    message: 'select * from "task" where "nosuchcol" = $1 - column "nosuchcol" does not exist',
    recognised: true,
    column: 'nosuchcol',
  },
  {
    dialect: 'postgres, table-qualified and unquoted',
    message: 'select * from "task" - column task.nosuchcol does not exist',
    recognised: true,
    column: 'task.nosuchcol',
  },
  // ⚠️ The measured gap. MySQL's wording matches neither arm of the predicate,
  // so this condition still travels out as the raw dialect error on MySQL.
  // Pinned so the reach is a stated fact rather than an assumption, and so
  // widening the predicate goes red here first.
  {
    dialect: 'mysql (ER_BAD_FIELD_ERROR) — NOT recognised, see the head note',
    message: "select * from `task` where `nosuchcol` = 'y' - Unknown column 'nosuchcol' in 'where clause'",
    recognised: false,
    column: null,
  },
];

describe('[#8790] dialect wording — what the refusal recognises and what it names', () => {
  for (const { dialect, message, recognised, column } of DIALECT_MESSAGES) {
    it(`${dialect}: recognised=${recognised}, column=${column ?? 'null'}`, () => {
      const err = Object.assign(new Error(message), { code: 'DIALECT' });
      expect(isUnresolvableColumnError(err)).toBe(recognised);
      expect(unresolvableColumnNameOf(err)).toBe(column);
    });
  }

  it('an unrecognised wording still refuses, just without a name', () => {
    // `null` from the extractor must never be read as "not an unresolvable
    // column after all" — that would restore the silent `[]` for every wording
    // the parser has not been taught.
    const err = new Error('no such column: ');
    expect(isUnresolvableColumnError(err)).toBe(true);
    expect(unresolvableColumnNameOf(err)).toBe(null);
  });

  it('a non-error value is not mistaken for a column failure', () => {
    expect(isUnresolvableColumnError(null)).toBe(false);
    expect(isUnresolvableColumnError(undefined)).toBe(false);
    expect(isUnresolvableColumnError('no such column: x')).toBe(false);
    expect(unresolvableColumnNameOf(null)).toBe(null);
  });
});
