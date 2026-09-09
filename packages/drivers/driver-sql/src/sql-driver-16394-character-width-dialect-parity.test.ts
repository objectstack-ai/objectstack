// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16394 — the character column's width is DIALECT-INVARIANT, measured rather
 * than assumed.
 *
 * ## The premise that nothing was holding
 *
 * `packages/cli/src/commands/generate-string-family-width.pin.test.ts` (#16091)
 * pins that the character column both migration generators emit is the column
 * `driver-sql` actually creates. Its authority is the real chain —
 * `SqlDriver.initObjects` → `computeAndRecordTenantField` → `indexedKeyColumns`
 * → `createColumn` → knex → a column read back out of the database — and that
 * is the right authority. But the database it runs that chain against is an
 * in-memory better-sqlite3 one, while the widths it asserts are a **PostgreSQL**
 * claim: the generators emit PostgreSQL DDL and say so.
 *
 * So the pin rests on an unstated premise — *the width the chain produces does
 * not depend on the dialect* — and nothing measured it. The gap was measured
 * from the other side, as a mutation battery against that pin's oracle:
 *
 * ```
 *   leg   driver-side mutation                                pin result
 *   L7    a Postgres gate on `createColumn`'s quoted line     2 failed / 79
 *   L7b   the same gate as the FIRST LINE of                  81 passed (81)
 *         `keyableTextLength`
 * ```
 *
 * ⭐ L7b changes the column a real PostgreSQL deployment gets, and the
 * instrument reports everything fine. L7 reddens only because a *source-text*
 * assertion in that file happens to quote the line the mutation landed on —
 * luck about placement, not coverage. The oracle is otherwise sound (L2/L3/L4
 * redden as predicted); the DIALECT is the one axis it cannot read.
 *
 * ## What this file is, and what it deliberately is not
 *
 * It is the missing half, in the one place it can actually run: the live
 * PG + MySQL job runs `pnpm --filter @objectstack/driver-sql test` and nothing
 * else, so a live cell written into the CLI pin would be provisioned by no job
 * in this repository and would report itself un-run forever.
 *
 * ⛔ It is NOT a second width table. Transcribing `varchar(64)` per dialect
 * would re-create #16091's own first mistake one layer up — a mirror that goes
 * stale the day the driver moves. What is asserted is EQUALITY between what the
 * SAME object produces on SQLite and on each length-enforcing dialect, both read
 * back from the server's own catalog through `columnInfo()`. A driver change
 * that moves every dialect together stays green here and is caught by #16091;
 * a change that moves ONE dialect is exactly what this file exists to see.
 *
 * The SQLite baseline additionally carries a literal control, because parity
 * alone is satisfiable by a chain that answers `text` everywhere: the control
 * asserts the corpus really produced all four dispositions the three arms of
 * `createColumn` can emit.
 *
 * ## The corpus covers all three arms, so a gate in any of them is visible
 *
 *   - TEXT FAMILY, keyed and bounded → `varchar(keyableTextLength(field))`.
 *     ⭐ The L7b axis. Three widths, so a gate that returns a CONSTANT is
 *     caught as surely as one that returns `null`.
 *   - TEXT FAMILY, unkeyed → unbounded TEXT, `maxLength` or not.
 *   - STRING FAMILY → `declaredVarcharLength`: the declaration verbatim, knex's
 *     255 for no usable one, TEXT past `MAX_VARCHAR_CHARS`.
 *   - CATCH-ALL → a bare `table.string(name)`, which never reads `maxLength`.
 *
 * Opt-in for the live halves — they need real servers:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *   OS_TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { MYSQL_CELL, PG_CELL, dialectCell, declareDialectCell } from './live-dialect-matrix.testkit.js';

const T = 'os16394_widths';
const PARENT = 'os16394_parent';

/** Inside `MAX_KEYABLE_VARCHAR_CHARS` (768), so a keyed text field is sized. */
const KEYED_CHARS = 64;

/**
 * One object carrying every arm of `createColumn`'s character switch at once.
 *
 * One table rather than one per case for the reason
 * `sql-driver-string-maxlength-varchar.test.ts` gives: a change to the emitter
 * cannot then be green in five places and wrong in the sixth. Every keyed field
 * declares a bound a key part can hold, so no column here reaches the
 * hash-shadow-key path (#11627) that a keyed UNBOUNDED text column takes on
 * MySQL — that road has its own pins and is not this file's axis.
 */
const widthObject = () => ({
  name: T,
  fields: {
    // ── TEXT family, KEYED: `keyableTextLength` sizes the column ──────────
    // Three DIFFERENT widths on purpose. A dialect gate returning a constant
    // (rather than `null`) still collapses these three onto one value.
    keyed_text_64: { type: 'text', unique: true, maxLength: KEYED_CHARS },
    keyed_text_100: { type: 'text', unique: true, maxLength: 100 },
    keyed_markdown_255: { type: 'markdown', unique: true, maxLength: 255 },
    // ── TEXT family, UNKEYED: unbounded, declaration or not ───────────────
    unkeyed_text_100: { type: 'text', maxLength: 100 },
    unkeyed_text_plain: { type: 'text' },
    // ── STRING family: `declaredVarcharLength`, all three outcomes ────────
    wide_url: { type: 'url', maxLength: 1024 },
    narrow_phone: { type: 'phone', maxLength: 20 },
    plain_email: { type: 'email' },
    bogus_url: { type: 'url', maxLength: 0 },
    huge_url: { type: 'url', maxLength: 100000 },
    // ── CATCH-ALL: never reads `maxLength` ────────────────────────────────
    a_select: { type: 'select', maxLength: 4000, options: ['a', 'b'] },
    a_user: { type: 'user', maxLength: 30 },
    a_lookup: { type: 'lookup', maxLength: 20, reference: PARENT },
  },
});

const parentObject = () => ({ name: PARENT, fields: { name: { type: 'text', maxLength: 64 } } });

/** The declared fields, in declaration order — the builtins are not this axis. */
const PROBE_COLUMNS = Object.keys(widthObject().fields);

/**
 * `type(maxLength)` per DECLARED column, normalised across the three dialects.
 *
 * Restricted to the declared fields deliberately: the driver's own builtins
 * (`created_at` and friends) legitimately differ per dialect — `datetime` on
 * SQLite, `timestamptz` on Postgres — and comparing them would make this file
 * red about the temporal axis, which has its own matrix.
 *
 * The same normalisation `sql-driver-string-maxlength-varchar.test.ts` and
 * `sql-driver-11794-richtext-text-family.test.ts` use, for the same reason: the
 * three dialects spell one column three ways (`character varying` / `varchar`)
 * and only the WIDTH is being compared.
 */
async function probeShapes(driver: SqlDriver, table: string): Promise<Record<string, string>> {
  const info: Record<string, any> = await (driver as any).knex(table).columnInfo();
  const out: Record<string, string> = {};
  for (const column of PROBE_COLUMNS) {
    const v = info[column];
    const t = String(v?.type ?? '(absent)').toLowerCase();
    const n = v?.maxLength;
    out[column] = /char/.test(t) && n ? `varchar(${n})` : t;
  }
  return out;
}

/** The whole corpus, created and read back on one dialect. */
async function shapesOn(driver: SqlDriver): Promise<Record<string, string>> {
  for (const t of [T, PARENT]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
  await driver.initObjects([parentObject(), widthObject()] as never);
  return probeShapes(driver, T);
}

// ── The baseline, on the dialect every runner has ──────────────────────────

describe('character column widths — the SQLite baseline the CLI pin reads (#16394)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it('produces all four dispositions the three arms can emit', async () => {
    // ⛔ Non-vacuity for the parity assertions below, and the reason this
    // literal block exists at all: `toEqual(baseline)` is satisfied by a chain
    // that answers `text` for every column on every dialect. This says the
    // corpus really exercises the arms it claims to.
    driver = new SqlDriver(dialectCell('sqlite').config());
    const shapes = await shapesOn(driver);

    // KEYED text family — the L7b axis, at three distinct widths.
    expect(shapes.keyed_text_64).toBe(`varchar(${KEYED_CHARS})`);
    expect(shapes.keyed_text_100).toBe('varchar(100)');
    expect(shapes.keyed_markdown_255).toBe('varchar(255)');
    // UNKEYED text family — unbounded either way.
    expect(shapes.unkeyed_text_100).toBe('text');
    expect(shapes.unkeyed_text_plain).toBe('text');
    // STRING family — declaration verbatim, knex's 255, TEXT past the ceiling.
    expect(shapes.wide_url).toBe('varchar(1024)');
    expect(shapes.narrow_phone).toBe('varchar(20)');
    expect(shapes.plain_email).toBe('varchar(255)');
    expect(shapes.bogus_url).toBe('varchar(255)');
    expect(shapes.huge_url).toBe('text');
    // CATCH-ALL — `maxLength` is never read here.
    expect(shapes.a_select).toBe('varchar(255)');
    expect(shapes.a_user).toBe('varchar(255)');
    expect(shapes.a_lookup).toBe('varchar(255)');

    // Every declared column really came back, and the sweep really produced
    // more than one answer.
    expect(Object.keys(shapes).sort()).toEqual([...PROBE_COLUMNS].sort());
    expect(new Set(Object.values(shapes)).size).toBeGreaterThan(3);
    expect(Object.values(shapes)).not.toContain('(absent)');
  });
});

// ── The DIALECT axis: the half only a live length-enforcing server can read ──

for (const cell of [PG_CELL, MYSQL_CELL]) {
  declareDialectCell(cell, 'character width dialect parity (#16394)', (c) => {
    describe(`character width parity on ${c.label} (#16394)`, () => {
      let live: SqlDriver;
      let sqlite: SqlDriver;

      afterEach(async () => {
        for (const t of [T, PARENT]) await live?.execute(`drop table if exists ${t}`).catch(() => {});
        await live?.disconnect().catch(() => {});
        await sqlite?.disconnect().catch(() => {});
      });

      // The 60_000 budget is the live-cell convention this package already
      // carries (`LIVE_CELL_TIMEOUT_MS`); `declareDialectCell` applies it to
      // this describe, and these bodies do not override it.
      it('creates the SAME character column this dialect that SQLite creates', async () => {
        sqlite = new SqlDriver(dialectCell('sqlite').config());
        live = new SqlDriver(c.config());

        const baseline = await shapesOn(sqlite);
        const actual = await shapesOn(live);

        // ⭐ THE ASSERTION. Not a transcribed width table — the SAME object,
        // through the SAME chain, on two servers. A dialect gate anywhere on
        // `initObjects` → `indexedKeyColumns` → `createColumn` → the two width
        // bodies moves one side of this and nothing else in the repository
        // has to be edited for it to be seen.
        expect(
          actual,
          `the column ${c.label} creates differs from the column SQLite creates for the same ` +
            'object. The CLI migration-width pin (#16091) reads its oracle off SQLite and ' +
            'asserts a PostgreSQL claim, which is only sound while these agree.',
        ).toEqual(baseline);

        // Non-vacuity, both halves: the comparison really had columns in it,
        // and the live server really answered rather than reporting nothing.
        expect(Object.keys(actual)).toHaveLength(PROBE_COLUMNS.length);
        expect(Object.values(actual)).not.toContain('(absent)');
        expect(new Set(Object.values(actual)).size).toBeGreaterThan(3);
      });

      it('really enforces the keyed text-family width it reported — at the bound and one past it', async () => {
        // ⛔ Without this the parity above is a statement about two catalogs.
        // This is what makes it a statement about the column a deployment
        // gets: the server itself accepts exactly `maxLength` characters and
        // refuses one more, in this very run.
        live = new SqlDriver(c.config());
        const shapes = await shapesOn(live);
        expect(shapes.keyed_text_64).toBe(`varchar(${KEYED_CHARS})`);

        await live.create(T, { id: 'w1', keyed_text_64: 'x'.repeat(KEYED_CHARS) });
        const res: any = await live.execute(
          `select char_length(keyed_text_64) as n from ${T} where id = 'w1'`,
        );
        const rows: any[] = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res?.rows ?? res);
        expect(Number(rows[0]?.n ?? rows[0]?.N)).toBe(KEYED_CHARS);

        const refusal = await live
          .create(T, { id: 'w2', keyed_text_64: 'x'.repeat(KEYED_CHARS + 1) })
          .then(() => null)
          .catch((e: unknown) => e);
        expect(refusal, 'the server accepted a value past the declared bound').toBeInstanceOf(Error);
        const said = `${String((refusal as { code?: string })?.code ?? '')} ${String((refusal as Error).message)}`;
        expect(said).toMatch(/ER_DATA_TOO_LONG|22001|too long/i);
      });
    });
  });
}
