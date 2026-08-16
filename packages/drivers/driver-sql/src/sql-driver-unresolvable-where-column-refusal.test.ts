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
 * ## Scope: a plain unresolvable COLUMN, not a dotted PATH
 *
 * The card's headline repro was a dotted key, and measuring it across live
 * backends showed why that cannot be this suite's assertion: the three dialects
 * do not agree on what a dotted key IS. Postgres classifies it as an undefined
 * TABLE (`42P01`) and always did, so #8790 changed nothing there; SQLite
 * classifies it as an undefined COLUMN and cannot be told apart from a column
 * literally named `title.x`. The FILTER-axis verdict on dotted paths is #8371,
 * still open. So the ruled scope — a plain column the table lacks — carries the
 * refusal pins, and the dotted key is RECORDED per dialect in
 * `DOTTED_STATUS_QUO` with #8371 named as the owner of the verdict.
 *
 * ## The DIALECT axis
 *
 * `INVALID_FILTER` / 400 is required on both SQL drivers by
 * `cross-field-conformance-cases.ts`, so a fix pinned on one dialect proves
 * half the contract. The end-to-end sweep runs every `DIALECT_CELLS` cell
 * (SQLite always; live Postgres and MySQL when the runner provisions them),
 * and the MESSAGE-SHAPE sweep at the bottom covers all three dialects' real
 * error texts unconditionally — that parsing is the only dialect-sensitive
 * part of the fix, and it must not go unmeasured on a runner without a live
 * server.
 *
 * [#8926, maintainer ruling 2026-08-16] MySQL joined both sweeps one card
 * after #8790. Until then its wording (`Unknown column 'x' in 'where clause'`
 * / `'field list'` / `'order clause'`, `ER_BAD_FIELD_ERROR`) was matched by
 * neither arm of the predicate — a deliberate, pinned gap, kept visible so it
 * could only close by ruling. It closed as full dialect parity on the ONE
 * shared predicate, which moves MySQL's accept set in both directions at
 * once: an unresolvable WHERE column now refuses with the ADR-0112 envelope
 * instead of throwing the raw dialect error with the bound literals inlined
 * (the narrowing), and an unresolvable projection or ORDER BY now recovers
 * through the #3821 ladder instead of throwing (the widening — a query that
 * used to error returns rows, deliberately; see the direction pin in the
 * message-shape sweep).
 *
 * [#8931 question 3, maintainer authorisation 2026-08-16 「同意 a」] The card
 * asked for one separable half — strip the caller's bound literal from the
 * POSTGRES dotted route's message — and measuring it live disproved the
 * premise: on Postgres there is no bound literal in that message to strip.
 * No behaviour was changed here as a result. What was added is the axis that
 * was missing, so the property stops being an unstated accident of the client
 * library: see `DOTTED_STATUS_QUO.literalWithheldBy`, the disclosure pins in
 * each cell's sweep, and the mechanism pin at the bottom of the file.
 * ⛔ The dotted route's `code` and `status` are unchanged and stay recorded
 * rather than asserted — questions 1 (can it be enveloped without judging the
 * key) and 2 (which envelope) are unruled and are the maintainer's.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex from 'knex';
import type { DriverQuery } from '@objectstack/spec/contracts';
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

/**
 * Cells whose unresolvable-column wording this driver recognises — since
 * #8926, all three of them. The filter shape is kept so the day a fourth
 * dialect joins `DIALECT_CELLS`, its wording's reach is a decision this suite
 * states rather than a default it inherits.
 */
const RECOGNISED_CELLS = DIALECT_CELLS.filter(
  (c) => c.id === 'sqlite' || c.id === 'pg' || c.id === 'mysql',
);

/**
 * The RULED scope: a plain column the table does not have.
 *
 * ⛔ A dotted key is deliberately NOT in this list, and the reason is measured
 * rather than stylistic — see `DOTTED_STATUS_QUO` below. #8790's ruling is
 * about a column the backend cannot resolve; the FILTER-axis verdict on dotted
 * PATHS is #8371's, still open, and this suite must not decide it by assertion.
 *
 * `DriverQuery` rather than `as any`: its own docblock records that a direct
 * caller holding only a `where` used to reach for a blanket cast and lose
 * `where`'s type with it, which is the erasure `check:query-options-erasure`
 * ratchets. A refusal suite that names columns for a living should be the last
 * place to throw the type away.
 */
const UNRESOLVABLE: ReadonlyArray<{ label: string; where: NonNullable<DriverQuery['where']>; named: string }> = [
  { label: 'a plain unknown column', where: { nosuchcol: SECRET_LITERAL }, named: 'nosuchcol' },
];

/**
 * [#8790 → #8371] What a DOTTED key does per dialect, measured, and why this
 * suite records it instead of asserting the refusal on it.
 *
 * The three backends do not agree on what a dotted key even IS, because knex
 * compiles `{'title.x': v}` to the qualified reference `"title"."x"`:
 *
 * | dialect  | classification    | error                                        |
 * |----------|-------------------|----------------------------------------------|
 * | sqlite   | undefined COLUMN  | `no such column: title.x`                     |
 * | postgres | undefined TABLE   | `42P01 missing FROM-clause entry for table`   |
 * | mysql    | undefined COLUMN  | `ER_BAD_FIELD_ERROR Unknown column 'title.x'` |
 *
 * Measured live on PG 16.13 and MySQL 8.0.46, `origin/main` vs this branch.
 * Postgres reads `title` as a TABLE, so its error is `undefined_table`, not
 * `undefined_column` — a shape {@link isUnresolvableColumnError} does not match
 * and never has. The consequence, and the reason this is a recording rather
 * than a regression: on Postgres a dotted key raised a raw `42P01` on BOTH
 * halves **before this card and after it, byte for byte**. #8790 changed
 * nothing there. The card's headline repro (`find()` [] / `count()` throws) is
 * SQLite-specific; on Postgres the two halves already agreed.
 *
 * On SQLite the dotted key DOES now refuse, because SQLite hands the driver a
 * message indistinguishable from a plain missing column — the driver cannot
 * tell `{'title.x': v}` (a path) from a column literally NAMED `title.x`
 * without inspecting the key for a `.`, which is judging dotted-ness and is
 * #8371's call. Since #8926 MySQL sits in the same cell as SQLite: it too
 * classifies the dotted key as an undefined COLUMN and spells it exactly like
 * a plain missing one (`Unknown column 'title.x' in 'where clause'`), so the
 * widened predicate refuses it enveloped — still without ever inspecting the
 * key for a `.`. So this table pins the STATUS QUO, per dialect, and names
 * the owner of the verdict. ⛔ Do not "fix" a cell here by teaching the
 * classifier `42P01`: that mints a dotted-path verdict at the driver and
 * pre-empts #8371, which owns the dotted-path axis on every dialect.
 *
 * ## [#8931 Q3] The third axis: what keeps the caller's bound literal off the wire
 *
 * `code`/`enveloped` record the SHAPE of the answer. They say nothing about
 * its CONTENT, and #8931's separable half is a content question — so the two
 * cells that agree on "no literal reaches the caller" reach that answer by
 * mechanisms that are different in kind, and only one of them is a redaction:
 *
 * - **sqlite, mysql** — the dialect really does inline the bound literal
 *   (knex leaves `?` in the SQL, so its error formatter substitutes the
 *   value). The #8790 refusal is what removes it, keeping the full text to
 *   the server log. A genuine redaction, and `POSITIVE CONTROL` below asserts
 *   the literal is in that log — otherwise "the message has no literal" would
 *   be a claim about a message nobody proved ever could have carried one.
 * - **postgres** — nothing redacts anything, because there is nothing to
 *   redact. knex positions pg bindings to `$1` BEFORE it formats the failing
 *   statement into the message, and its formatter substitutes only `?`, so no
 *   bound value is ever written into the text. Measured live on PostgreSQL
 *   16.13 across seven filter shapes on both halves: the literal is absent
 *   from `message`, from `stack` and from every own property of the pg error
 *   object, and a `$n` placeholder stands where the value would be.
 *
 * ⭐ That measurement is why #8931's question 3 landed as a pin rather than a
 * fix: its premise ("the bound literal inlined", carried from the card's dated
 * `13d78642d` evidence) does not hold on Postgres. ⚠️ The property is real but
 * INCIDENTAL — it belongs to knex's binding path, not to any rule this repo
 * states — so it is asserted here, and the mechanism pin at the bottom fails
 * the day that path changes. What remains genuinely open on the pg cell is the
 * ENVELOPE (a raw `42P01` with no `status`, carrying the compiled statement's
 * shape), and that is questions 1 and 2, unruled.
 */
interface DottedCell {
  /** The `code` the caller receives. ⛔ Recorded, not adjudicated (#8931 Q1/Q2). */
  code: string;
  /** Does the answer carry the ADR-0112 envelope (`status: 400`)? */
  enveloped: boolean;
  /** [#8931 Q3] Which of the two mechanisms above keeps the literal off the wire. */
  literalWithheldBy: typeof REFUSAL_ENVELOPE | typeof NEVER_INLINED;
  /**
   * Substrings the caller-visible message MUST still carry.
   *
   * ⛔ Without this, "the message does not contain the literal" is trivially
   * true of an empty string — a redaction that deleted everything would pass
   * the disclosure assertion and leave the caller with nothing to act on.
   */
  identifies: readonly string[];
}

/** The dialect inlined the literal and the #8790 refusal took it back out. */
const REFUSAL_ENVELOPE = 'the #8790 refusal envelope (a real redaction)';
/** knex parameterised the value, so the message never carried it. */
const NEVER_INLINED = 'knex parameterisation — the literal was never in the text';

const DOTTED_STATUS_QUO: Readonly<Record<string, DottedCell>> = {
  sqlite: {
    code: 'INVALID_FILTER',
    enveloped: true,
    literalWithheldBy: REFUSAL_ENVELOPE,
    identifies: ['title.x', TABLE],
  },
  pg: {
    code: '42P01',
    enveloped: false,
    literalWithheldBy: NEVER_INLINED,
    // The raw dialect text, which on this cell IS the caller-visible message:
    // `select … where "title"."x" = $1 - missing FROM-clause entry for table "title"`.
    identifies: ['missing FROM-clause entry for table', '"title"."x"', TABLE],
  },
  mysql: {
    code: 'INVALID_FILTER',
    enveloped: true,
    literalWithheldBy: REFUSAL_ENVELOPE,
    identifies: ['title.x', TABLE],
  },
};

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

  for (const { label, where, named } of UNRESOLVABLE) {
    it(`find() refuses ${label} with INVALID_FILTER / 400 naming the column`, async () => {
      const err = await caught(() => driver.find(TABLE, { where }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(named);
    });

    it(`count() refuses ${label} with INVALID_FILTER / 400 naming the column`, async () => {
      const err = await caught(() => driver.count(TABLE, { where }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(named);
    });

    // The two halves must not merely both fail — they must fail the SAME way.
    // Answering one predicate two different ways is the whole defect.
    it(`find() and count() answer ${label} with the same envelope`, async () => {
      const onFind = await caught(() => driver.find(TABLE, { where }));
      const onCount = await caught(() => driver.count(TABLE, { where }));
      expect({ code: onCount.code, status: onCount.status, message: onCount.message })
        .toEqual({ code: onFind.code, status: onFind.status, message: onFind.message });
    });
  }

  // ───────────────────────────────────────────────────────────────
  // DOTTED KEY — recorded, NOT adjudicated (verdict owned by #8371)
  // ───────────────────────────────────────────────────────────────

  // Both halves still have to AGREE — that is #8790's actual subject, and it
  // holds on every dialect regardless of which verdict #8371 lands. What this
  // deliberately does NOT assert is that the agreed answer is a refusal.
  it('a dotted key answers find() and count() the same way, whatever that way is', async () => {
    const onFind = await caught(() => driver.find(TABLE, { where: { 'title.x': SECRET_LITERAL } }));
    const onCount = await caught(() => driver.count(TABLE, { where: { 'title.x': SECRET_LITERAL } }));
    expect(onCount.code).toBe(onFind.code);
    expect(onCount.status).toBe(onFind.status);
  });

  it('a dotted key is at this dialect\'s recorded status quo (see DOTTED_STATUS_QUO)', async () => {
    const expected = DOTTED_STATUS_QUO[cell.id];
    expect(expected, `no recorded status quo for cell '${cell.id}'`).toBeDefined();
    const err = await caught(() => driver.find(TABLE, { where: { 'title.x': SECRET_LITERAL } }));
    expect(err.code).toBe(expected.code);
    expect(err.status).toBe(expected.enveloped ? 400 : undefined);
  });

  // ───────────────────────────────────────────────────────────────
  // [#8931 Q3] THE DISCLOSURE AXIS — content, not shape
  // ───────────────────────────────────────────────────────────────

  // ⭐ True on every cell REGARDLESS of the envelope, which is exactly why it
  // can be asserted while #8931's questions 1 and 2 stay unruled: the answer's
  // shape is recorded above, its CONTENT is contracted here.
  it('a dotted key never puts the caller\'s bound literal on the wire (#8931 Q3)', async () => {
    const expected = DOTTED_STATUS_QUO[cell.id];
    for (const [half, run] of [
      ['find', () => driver.find(TABLE, { where: { 'title.x': SECRET_LITERAL } })],
      ['count', () => driver.count(TABLE, { where: { 'title.x': SECRET_LITERAL } })],
    ] as const) {
      const err = await caught(run);
      expect(err.message, `${half}: message`).not.toContain(SECRET_LITERAL);
      expect(String(err.stack ?? ''), `${half}: stack`).not.toContain(SECRET_LITERAL);
      // The message is not the only way out: an unenveloped pg error reaches
      // the caller as the driver's own object, carrying a dozen own fields
      // (`detail`, `hint`, `where`, `internalQuery`, …). Any of them would be
      // a disclosure, so all of them are asserted rather than the one the
      // card happened to name.
      for (const key of Object.keys(err ?? {})) {
        const value = (err as Record<string, unknown>)[key];
        if (typeof value === 'string') {
          expect(value, `${half}: error property '${key}'`).not.toContain(SECRET_LITERAL);
        }
      }
      // ⛔ Non-triviality: an empty message satisfies every assertion above.
      for (const needle of expected.identifies) {
        expect(err.message, `${half}: the caller must still be told '${needle}'`).toContain(needle);
      }
    }
  });

  // The control that makes the assertion above mean something. Without it,
  // "no literal in the message" is unfalsifiable — it would hold just as well
  // for a dialect that never had one, a message that was emptied, and a fix
  // that never ran. So each cell must show WHICH of the two mechanisms is
  // keeping the literal off the wire, and that mechanism must be observable.
  it('POSITIVE CONTROL — the literal is withheld by this cell\'s recorded mechanism (#8931 Q3)', async () => {
    const expected = DOTTED_STATUS_QUO[cell.id];
    const logged: string[] = [];
    const sink = { warn: (m: string) => logged.push(String(m)), info: () => {}, error: () => {} };
    const original = (driver as unknown as { logger: unknown }).logger;
    (driver as unknown as { logger: unknown }).logger = sink;
    let err: any;
    try {
      err = await caught(() => driver.find(TABLE, { where: { 'title.x': SECRET_LITERAL } }));
    } finally {
      (driver as unknown as { logger: unknown }).logger = original;
    }

    expect(err.message).not.toContain(SECRET_LITERAL);

    if (expected.literalWithheldBy === REFUSAL_ENVELOPE) {
      // A REAL redaction: the dialect text did carry the caller's value, and
      // the refusal moved it to the server log (#7929's line, #8790's seam).
      // This is the proof the message "would have carried the literal".
      expect(
        logged.some((line) => line.includes(SECRET_LITERAL)),
        'the dialect text should have reached the server log with the literal intact',
      ).toBe(true);
    } else {
      // Postgres: NOT a redaction. The value was parameterised, so a `$n`
      // placeholder stands where it would have been — and nothing was logged,
      // because nothing recognised the error in the first place. ⛔ Do not
      // read this cell as "the redaction works here"; see `literalWithheldBy`.
      expect(err.message, 'the value should stand as a placeholder, not a literal').toMatch(/\$\d/);
      expect(logged.some((line) => line.includes(SECRET_LITERAL))).toBe(false);
    }
  });

  // ⭐ The invariant half of the ruling — true under every branch it could have
  // taken. `count()` used to answer the dialect's own error with the bound
  // literal inlined: a declared-vs-enforced gap against ADR-0112 AND the
  // predicate-text disclosure shape #7929 redacted elsewhere.
  it('neither half puts the bound literal or the compiled statement on the wire', async () => {
    for (const half of [
      () => driver.find(TABLE, { where: { nosuchcol: SECRET_LITERAL } }),
      () => driver.count(TABLE, { where: { nosuchcol: SECRET_LITERAL } }),
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
    const rows = await driver.find(TABLE, { where: { title: 'Design' } });
    expect(rows.map((r: any) => r.id)).toEqual(['t1']);
    expect(await driver.count(TABLE, { where: { title: 'Design' } })).toBe(1);
  });

  it('CONTROL an unfiltered read is untouched', async () => {
    const rows = await driver.find(TABLE, {});
    expect(rows.map((r: any) => r.id).sort()).toEqual(['t1', 't2']);
    expect(await driver.count(TABLE)).toBe(2);
  });

  it('CONTROL a resolvable predicate that genuinely matches nothing is still an honest empty list', async () => {
    // The one empty answer that must never become a 400: the predicate ran.
    expect(await driver.find(TABLE, { where: { title: 'no-such-title' } })).toEqual([]);
    expect(await driver.count(TABLE, { where: { title: 'no-such-title' } })).toBe(0);
  });

  it('CONTROL an error that is not about an unresolvable column still propagates unchanged', async () => {
    const err = await caught(() => driver.find('no_such_table_at_all', {}));
    expect(err.code).not.toBe('INVALID_FILTER');
  });

  // ───────────────────────────────────────────────────────────────
  // WHAT WAS DELIBERATELY NOT CHANGED — the #3821 ladder's recoveries
  // ───────────────────────────────────────────────────────────────

  it('KEEPS the #3821 projection recovery — and honours the WHERE while recovering', async () => {
    const rows = await driver.find(TABLE, {
      fields: ['title', 'nosuchfield'],
      where: { rank: { $gte: 1 } },
    });
    expect(rows.map((r: any) => r.title).sort()).toEqual(['Build', 'Design']);
  });

  it('KEEPS the #3821 ORDER-BY recovery — and honours the WHERE while recovering', async () => {
    const rows = await driver.find(TABLE, {
      orderBy: [{ field: 'nosuchfield', order: 'asc' }],
      where: { rank: { $gte: 2 } },
    });
    expect(rows.map((r: any) => r.id)).toEqual(['t2']);
  });

  it('KEEPS both recoveries together, with a resolvable WHERE', async () => {
    const rows = await driver.find(TABLE, {
      fields: ['title', 'nosuchfield'],
      orderBy: [{ field: 'alsomissing', order: 'asc' }],
      where: { rank: { $gte: 1 } },
    });
    expect(rows).toHaveLength(2);
  });

  // The discriminator between "the ladder recovered" and "the ladder refused":
  // an unresolvable PROJECTION plus an unresolvable WHERE is not recoverable,
  // because no rung may drop the predicate. It must refuse — and it must name
  // the WHERE's column, not the projection's, since the projection is the half
  // the ladder actually fixed.
  it('refuses when the WHERE is unresolvable even though the projection was recoverable', async () => {
    const err = await caught(() =>
      driver.find(TABLE, { fields: ['title', 'nosuchfield'], where: { alsomissing: 'x' } }),
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
  it('covers the cells whose wording the driver recognises — all three since #8926', () => {
    expect(RECOGNISED_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
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
  // ⚠️ The measured reason the DOTTED case is recorded rather than refused.
  // Postgres reads `title.x` as table `title`, column `x`, so it raises
  // undefined_TABLE (42P01), not undefined_column (42703). Neither arm of the
  // predicate matches it — before this card or after. Teaching the classifier
  // this shape would mint a dotted-path verdict the driver has no business
  // making; #8371 owns that. See `DOTTED_STATUS_QUO`.
  {
    dialect: 'postgres, DOTTED key — undefined_table, NOT recognised',
    message: 'select * from "task" where "title"."x" = $1 - missing FROM-clause entry for table "title"',
    recognised: false,
    column: null,
  },
  // [#8926, maintainer ruling 2026-08-16] The gap the entry above's Postgres
  // sibling still pins, CLOSED for MySQL. This entry spent #8790 pinned
  // `recognised: false` precisely so the widening could not arrive quietly —
  // flipping it here IS the ruling being enacted, not a test being fixed.
  {
    dialect: "mysql (ER_BAD_FIELD_ERROR), WHERE — recognised since #8926",
    message: "select * from `task` where `nosuchcol` = 'y' - Unknown column 'nosuchcol' in 'where clause'",
    recognised: true,
    column: 'nosuchcol',
  },
  // ER_BAD_FIELD_ERROR spells every clause position with one sentence, so the
  // projection and ORDER-BY spellings ride the same arm — which is what routes
  // them into the #3821 ladder's recoveries (see the direction pin below).
  {
    dialect: "mysql (ER_BAD_FIELD_ERROR), projection — 'field list'",
    message: "select `title`, `nosuchfield` from `task` - Unknown column 'nosuchfield' in 'field list'",
    recognised: true,
    column: 'nosuchfield',
  },
  {
    dialect: "mysql (ER_BAD_FIELD_ERROR), ORDER BY — 'order clause'",
    message: "select * from `task` order by `nosuchfield` asc - Unknown column 'nosuchfield' in 'order clause'",
    recognised: true,
    column: 'nosuchfield',
  },
  // Unlike Postgres (undefined_table, the entry above), MySQL classifies a
  // dotted key as an undefined COLUMN and spells it exactly like a plain
  // missing one — so it is recognised the same way SQLite's dotted message is,
  // without the key ever being inspected for a `.` (#8371 owns that axis).
  {
    dialect: 'mysql, dotted key — same ER_BAD_FIELD_ERROR sentence',
    message: "select * from `task` where `title`.`x` = 'y' - Unknown column 'title.x' in 'where clause'",
    recognised: true,
    column: 'title.x',
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

  // ───────────────────────────────────────────────────────────────
  // [#8926] THE WIDENING, PINNED AS A DIRECTION — not left implicit
  // ───────────────────────────────────────────────────────────────

  // Recognition is the single switch that routes a MySQL failure into the
  // #3821 ladder, so these three clause positions being recognised IS the
  // ruled behaviour change: a projection or ORDER BY that used to throw the
  // raw dialect error now returns rows (recovered), and a WHERE now refuses
  // with the envelope instead of leaking the bound literals. Narrowing any of
  // the three back out — e.g. matching only 'where clause' to keep the
  // envelope while withholding the recoveries — is the split predicate the
  // ruling refused as option B. The live-cell sweep above measures the same
  // fact end-to-end when a MySQL is provisioned; this pin holds it on every
  // runner.
  it('mysql: all three clause positions ride ONE arm — envelope and recoveries arrive together (#8926)', () => {
    for (const clause of ["'where clause'", "'field list'", "'order clause'"]) {
      const err = new Error(`select * from \`task\` - Unknown column 'nosuchcol' in ${clause}`);
      expect(isUnresolvableColumnError(err), `clause position ${clause}`).toBe(true);
      expect(unresolvableColumnNameOf(err), `clause position ${clause}`).toBe('nosuchcol');
    }
  });

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

// ─────────────────────────────────────────────────────────────────
// [#8931 Q3] WHY Postgres' message carries no bound literal — the mechanism
// ─────────────────────────────────────────────────────────────────

/**
 * The load-bearing half of #8931's disproved premise, pinned on every runner.
 *
 * The card asserted the Postgres dotted route leaks "the bound literal
 * inlined", on both halves. It does not, and the reason is one ordering
 * decision inside knex rather than anything this repo does:
 *
 * 1. `enrichQueryObject` runs `client.positionBindings(sql)` — the pg dialect
 *    rewrites every `?` to `$1`, `$2`, … Sqlite and mysql leave `?` alone.
 * 2. Only THEN, in the failure path, does knex build
 *    `err.message = formatQuery(sql, bindings) + ' - ' + nativeMessage`.
 * 3. `formatQuery` substitutes `?` and nothing else, so on pg it finds no
 *    placeholder it recognises and inlines ZERO bindings — while on sqlite and
 *    mysql it inlines all of them, which is the disclosure #7929 and #8790
 *    really did have to redact.
 *
 * So Postgres' immunity here is incidental, undocumented and entirely inside a
 * dependency — the three properties that make something worth pinning. If a
 * knex upgrade ever positions bindings after formatting (or teaches the
 * formatter `$n`), this goes red and the pg cell becomes a genuine leak that
 * question 3 would then have to fix for real.
 *
 * ⚠️ `positionBindings` is knex's own seam, not a public API contract. That is
 * the point: a red here means "the assumption underneath the pg cell moved",
 * which is exactly when a human should re-measure.
 */
describe('[#8931] the bound literal on the dotted route — mechanism, not luck', () => {
  const BOUND = 'select * from "task" where "title"."x" = ?';

  it('knex positions pg bindings to $n before the failing statement is formatted', () => {
    const pg = knex({ client: 'pg' });
    try {
      // No `?` survives, so knex's error formatter has nothing to substitute
      // and the caller's value cannot reach the message.
      const positioned = pg.client.positionBindings(BOUND);
      expect(positioned).toBe('select * from "task" where "title"."x" = $1');
      expect(positioned).not.toContain('?');
    } finally {
      void pg.destroy();
    }
  });

  it('sqlite and mysql leave `?` standing — which is why THEIR messages inline it', () => {
    for (const client of ['better-sqlite3', 'mysql2'] as const) {
      const k = knex({ client, useNullAsDefault: true });
      try {
        // The literal really does get substituted into these dialects'
        // messages; the #8790 refusal is what keeps it off the wire, and the
        // live cells' POSITIVE CONTROL measures that end to end.
        expect(k.client.positionBindings(BOUND), client).toBe(BOUND);
      } finally {
        void k.destroy();
      }
    }
  });
});
