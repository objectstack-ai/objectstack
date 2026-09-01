// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11565 — MySQL's per-ROW budget over DECLARED column widths, and the
 * diagnostic that names the declarations that spent it.
 *
 * ## The defect
 *
 * MySQL charges every bounded column's DECLARED byte width against a per-row
 * budget, independently of the per-column `varchar` ceiling. An object whose
 * fields declare enough total width simply fails `CREATE TABLE` — and the
 * server's refusal names **no column and no declaration**. It says "You have to
 * change some columns to TEXT or BLOBs" about a table its author described
 * entirely in metadata, and nothing maps that back to the `maxLength` values
 * responsible. Sixteen fields at `maxLength: 1024` is not an exotic object.
 *
 * ## Why a translator and not a pre-flight
 *
 * A pre-flight that sums declared widths BEFORE issuing DDL has to reproduce
 * the server's arithmetic, and wrong in the strict direction it refuses an
 * object MySQL would have accepted — a contract change. A translator cannot
 * over-refuse by construction: it speaks only after the server has refused.
 * Sitting inside `initObjects`' own loop it still sees `obj.fields`, so it
 * names every contributing field exactly as a pre-flight would.
 * {@link SqlDriver.explainRowSizeOverflow} carries the four measurements that
 * decided it; this file is the executable half.
 *
 * ## What each half is worth
 *
 * The dialect-free block runs everywhere, including Test Core. It pins the
 * arithmetic, the agreement between the width mirror and `createColumn`'s own
 * switch over every `FieldType` the spec declares, and — the half that stops
 * "refuses" from passing for "refuses the RIGHT objects" — that an object past
 * MySQL's budget still creates cleanly on a dialect that has no such budget.
 *
 * The MySQL block is the one that reds on the pre-fix tree. Opt-in:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';
import { MYSQL_CELL, dialectCell, declareDialectCell } from './live-dialect-matrix.testkit.js';

/** An object of `count` string fields, each declaring the same `maxLength`. */
const wideObject = (name: string, count: number, maxLength: number) => ({
  name,
  fields: Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`f${i + 1}`, { type: 'string', maxLength }]),
  ),
});

/** The same shape with NOTHING declared — `lookup` takes knex's varchar(255). */
const undeclaredObject = (name: string, count: number) => ({
  name,
  fields: Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`f${i + 1}`, { type: 'lookup' }]),
  ),
});

// ── The arithmetic, and the mirror, on a dialect every runner has ───────────

describe('row byte budget — arithmetic and column mirror (#11565)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  /**
   * The length prefix moves at a BYTE-payload boundary, not a character one, so
   * it moves with the charset — measured on MySQL 8.0.46 through the column
   * counts a table can hold. A utf8mb4 `varchar(63)` payload is 252 bytes and
   * 32 of them fit InnoDB's 8126-byte page limit (32 x 253 = 8096; at 254 bytes
   * each, 32 would not fit), so that prefix is one byte. A `varchar(64)`
   * payload is 256 bytes and behaves as the two-byte, off-page-eligible class.
   *
   * ⚠️ A payload of EXACTLY 255 is documented as the last one-byte width, and
   * is deliberately not asserted here: such a column is never stored off-page,
   * so the page limit binds at ~31 columns and neither limit can be made to
   * discriminate 256 from 257 bytes. An unmeasurable claim does not get a pin.
   */
  it('charges payload + varchar length prefix, and the prefix moves with the charset', () => {
    const pack = (chars: number, bpc: number) => (SqlDriver as any).varcharPackLength(chars, bpc);
    expect(pack(63, 4)).toBe(253); // utf8mb4: 252 + 1
    expect(pack(64, 4)).toBe(258); // utf8mb4: 256 + 2
    expect(pack(63, 1)).toBe(64); // latin1: 63 + 1 — the same width, a quarter the cost
    expect(pack(300, 1)).toBe(302); // latin1: 300 + 2
    expect(pack(1024, 4)).toBe(4098); // the card's own row: 16 x 4098 = 65568 > 65535
    expect(pack(255, 4)).toBe(1022); // the DEFAULT width, which declares nothing
  });

  /**
   * ⚠️ The mirror is a second reading of `createColumn`'s switch, so the risk it
   * carries is drift. This pin removes the risk structurally rather than by
   * review: one field of EVERY `FieldType` the spec declares, created for real,
   * and the mirror's answer compared against the column that actually landed. A
   * type added to the spec joins this pin without anyone remembering to.
   */
  it('agrees with createColumn about every FieldType the spec declares', async () => {
    const types = FieldType.options as readonly string[];
    expect(types.length).toBeGreaterThan(40); // the registry really was read

    const fields = Object.fromEntries(types.map((t) => [`f_${t}`, { type: t }]));
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([{ name: 'os11565_every_type', fields }]);
    const info: Record<string, { type?: string; maxLength?: number | string }> = await (
      driver as any
    ).knex('os11565_every_type').columnInfo();

    const mismatched: string[] = [];
    for (const t of types) {
      const column = `f_${t}`;
      const mirrored = (driver as any).varcharColumnChars({ type: t }, undefined) as number | null;
      const landed = info[column];
      const isVarchar = /varchar/i.test(String(landed?.type ?? ''));
      const landedChars = isVarchar ? Number(landed?.maxLength) : null;
      if (mirrored !== landedChars) {
        mismatched.push(
          `${t}: mirror says ${mirrored === null ? 'not a varchar' : `varchar(${mirrored})`}, ` +
            `createColumn emitted ${landed === undefined ? 'no column' : String(landed.type)}`,
        );
      }
    }
    expect(mismatched).toEqual([]);
  });

  /**
   * ⛔ The negative half, and the reason "it refuses" is not the assertion this
   * file makes: the budget is MySQL's, so an object past it must still create
   * cleanly everywhere else. A pre-flight with a wrong constant would fail
   * exactly here; a translator cannot, because it never runs.
   */
  it('refuses nothing on a dialect with no row budget', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    // 16 x maxLength 1024 — the shape live MySQL rejects, three lines down in
    // the same repo.
    await driver.initObjects([wideObject('os11565_wide_sqlite', 16, 1024)]);
    const info: any = await (driver as any).knex('os11565_wide_sqlite').columnInfo();
    expect(Object.keys(info)).toContain('f16');
    expect(String(info.f16?.maxLength ?? '')).toBe('1024');
  });

  /** The offender list is ordered by cost, and holds every varchar column. */
  it('profiles every varchar column, widest first', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const profile = (driver as any).rowWidthProfile(
      {
        narrow: { type: 'string', maxLength: 10 },
        widest: { type: 'string', maxLength: 4000 },
        middle: { type: 'string', maxLength: 1024 },
        unbounded_lookup: { type: 'lookup' },
        a_number: { type: 'number' },
        // Unkeyed text stays TEXT — it costs the budget a pointer, not a width.
        body: { type: 'text', maxLength: 60000 },
        id: { type: 'string', maxLength: 9999 }, // built-in, never the author's
      },
      new Map(),
      4,
    );
    expect(profile.columns.map((c: any) => c.name)).toEqual([
      'widest',
      'middle',
      'unbounded_lookup',
      'narrow',
    ]);
    expect(profile.columns[0]).toMatchObject({ chars: 4000, bytes: 16002 });
    expect(profile.columns[2]).toMatchObject({ chars: 255, bytes: 1022 });
    expect(profile.totalBytes).toBe(16002 + 4098 + 1022 + 41);
  });
});

// ── The half only a live MySQL can measure ──────────────────────────────────

declareDialectCell(MYSQL_CELL, 'row byte budget (#11565)', (cell) => {
  describe('row byte budget on live MySQL (#11565)', () => {
    let driver: SqlDriver;
    const TABLES = [
      'os11565_ok',
      'os11565_over',
      'os11565_ok255',
      'os11565_over255',
      'os11565_grow',
      'os11565_narrow',
      'os11565_undeclared',
    ];

    afterEach(async () => {
      for (const t of TABLES) await driver?.execute(`drop table if exists ${t}`).catch(() => {});
      await driver?.disconnect().catch(() => {});
    });

    /**
     * The measured boundaries below are utf8mb4's. On a latin1 schema the same
     * declarations cost a quarter as much and every count here is wrong — so
     * the cell asserts the multiplier rather than assuming it, the same way the
     * matrix asserts its zone skew instead of hoping for it.
     */
    // ── Why the 6 it() blocks below carry an explicit 60_000 budget (#13902) ──
    // Each constructs a FRESH `new SqlDriver(...)` against this cell's live
    // server inside their own body — so the live connect cycle, and the
    // schema-sync DDL and catalog read-back that all but the cheapest of these
    // drive through it, are paid PER TEST rather than once in a beforeAll.
    // With no third argument vitest applies its own 5000ms default — a number
    // nobody chose for that work, and one that reddens unrelated PRs when the
    // runner is merely a bit slow (#13688 measured exactly this shape: a timeout,
    // no MySQL error in the logs, on a diff that touched no driver). Sized like
    // this package's siblings — 60_000 is 7 of its 9 explicit budgets — and NOT
    // an assertion that these tests are normally anywhere near that slow.
    it('runs on a 4-byte charset — the boundaries below are utf8mb4 numbers', async () => {
      driver = new SqlDriver(cell.config());
      const seen = await (driver as any).schemaBytesPerChar();
      expect(seen).not.toBeNull();
      expect(seen.bytesPerChar).toBe(4);
    }, 60_000);

    /**
     * Both sides of the boundary, in one test, because only the pair means
     * anything: an implementation that refused every object would pass the
     * second assertion alone. Measured through this driver (its built-in `id`
     * varchar(255) is inside the budget, which is why the count is 15/16 here
     * and 15/16 in raw SQL only by coincidence of the same width).
     */
    it('creates 15 fields at maxLength 1024 and names all 16 when one more is added', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute('drop table if exists os11565_ok');
      await driver.execute('drop table if exists os11565_over');

      // ACCEPTS: unchanged behaviour, no diagnostic, a real table.
      await driver.initObjects([wideObject('os11565_ok', 15, 1024)]);
      const info: any = await (driver as any).knex('os11565_ok').columnInfo();
      expect(String(info.f15?.type)).toBe('varchar');
      expect(Number(info.f15?.maxLength)).toBe(1024);

      // REFUSES — with the fields the server would not name.
      const failure = await driver
        .initObjects([wideObject('os11565_over', 16, 1024)])
        .then(() => null)
        .catch((e: any) => e);
      expect(failure).toBeInstanceOf(Error);
      const message = String(failure.message);
      expect(message).toMatch(/cannot create table "os11565_over"/);
      expect(message).toMatch(/65535-byte budget for one ROW/);
      // Every contributing field, not merely "the table failed".
      expect(message).toMatch(/Its 16 varchar column\(s\) take 65568 bytes/);
      expect(message).toMatch(/"f1" varchar\(1024\) = 4098 bytes/);
      expect(message).toMatch(/and 8 more/);
      // The server's own sentence is kept, not replaced.
      expect(message).toMatch(/server said: Row size too large/);
      // Same failure, re-worded: the code survives for anything reading it.
      expect(failure.code).toBe('ER_TOO_BIG_ROWSIZE');
      expect((failure.cause as any)?.code).toBe('ER_TOO_BIG_ROWSIZE');

      // ⛔ And nothing was left behind: the object is not registered half-built.
      const exists = await (driver as any).knex.schema.hasTable('os11565_over');
      expect(exists).toBe(false);
    }, 60_000);

    /** The card's second measured row, moved by the driver's own `id` column. */
    it('creates 63 fields at maxLength 255 and refuses 64', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute('drop table if exists os11565_ok255');
      await driver.execute('drop table if exists os11565_over255');

      await driver.initObjects([wideObject('os11565_ok255', 63, 255)]);
      expect(await (driver as any).knex.schema.hasTable('os11565_ok255')).toBe(true);

      await expect(driver.initObjects([wideObject('os11565_over255', 64, 255)])).rejects.toThrow(
        /cannot create table "os11565_over255".*Its 64 varchar column\(s\) take 65408 bytes/s,
      );
    }, 60_000);

    /**
     * The path that is more likely than CREATE in a living app: a field added
     * to an object that was already near the budget. The server refuses the ADD
     * naming only the column being added, as if that one column were too wide —
     * when the width is in fifteen columns nobody is touching.
     */
    it('names the whole row when ALTER TABLE ADD COLUMN crosses the budget', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute('drop table if exists os11565_grow');
      await driver.initObjects([wideObject('os11565_grow', 15, 1024)]);

      await expect(driver.initObjects([wideObject('os11565_grow', 16, 1024)])).rejects.toThrow(
        /cannot add column\(s\) "f16" to "os11565_grow".*Its 16 varchar column\(s\)/s,
      );
    }, 60_000);

    /**
     * The SECOND limit, which the card's threshold table does not reach and a
     * 65535-byte pre-flight would have waved through: InnoDB's per-page limit,
     * hit here by forty ordinary `maxLength: 63` fields — about a sixth of the
     * 65535 budget. Reported with the number the SERVER quoted, not with 65535.
     */
    it('reports InnoDB page-limit refusals with the page limit, not the row budget', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute('drop table if exists os11565_narrow');

      const failure = await driver
        .initObjects([wideObject('os11565_narrow', 40, 63)])
        .then(() => null)
        .catch((e: any) => e);
      expect(failure).toBeInstanceOf(Error);
      const message = String(failure.message);
      expect(message).toMatch(/InnoDB's per-PAGE limit of 8126 bytes/);
      expect(message).not.toMatch(/65535-byte budget for one ROW/);
      expect(message).toMatch(/"f1" varchar\(63\) = 253 bytes/);
    }, 60_000);

    /**
     * The shape a diagnostic reading only DECLARED bounds would have nothing to
     * say about: sixty-four `lookup` fields, no `maxLength` anywhere, each
     * silently taking knex's varchar(255).
     */
    it('names the fields even when nothing declares a maxLength', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute('drop table if exists os11565_undeclared');

      const failure = await driver
        .initObjects([undeclaredObject('os11565_undeclared', 64)])
        .then(() => null)
        .catch((e: any) => e);
      expect(failure).toBeInstanceOf(Error);
      const message = String(failure.message);
      expect(message).toMatch(/"f1" varchar\(255\) = 1022 bytes/);
      expect(message).toMatch(/a field declaring NO `maxLength` still takes varchar\(255\)/i);
    }, 60_000);
  });
});
