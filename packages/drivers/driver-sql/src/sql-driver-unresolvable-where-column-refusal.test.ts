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
 *
 * [#8931 questions 1 and 2, maintainer ruling 2026-08-17 「同意 C」] Those two
 * are now ruled, and the Postgres row of `DOTTED_STATUS_QUO` changes with them
 * — DELIBERATELY, so ⛔ do not read the changed cells as drift. The ruling: the
 * driver stops answering an unenveloped dialect error at all. Any dialect error
 * the existing classification does not claim leaves the read exits as a GENERIC
 * backend-fault envelope (`DATABASE_ERROR` / 500) asserting only "the backend
 * rejected this statement" — ⛔ never `INVALID_FILTER`, and no verdict about the
 * filter, because on Postgres `42P01` is the same signal for a dotted key and
 * for a table that was never provisioned (measured below) and cannot honestly
 * support one. It is a terminal CATCH-ALL, ⛔ not a new recognizer on `42P01`:
 * `isUnresolvableColumnError` is untouched, the key is still never inspected
 * for a `.`, and #8371's verdict (landed in PR #8936) stays the only one.
 *
 * Two consequences this file now pins rather than records:
 *
 *  - the pg cell's `code`/`status` move from `42P01`/`undefined` to
 *    `DATABASE_ERROR`/`500`, and its caller-visible message loses the dialect
 *    text entirely — statement, quoted references and `$n` alike;
 *  - `literalWithheldBy` for pg moves from `NEVER_INLINED` to the envelope, and
 *    the knex fact it used to name moves one slot over, to
 *    `dialectTextInlinesLiteral` — asserted now against the SERVER LOG, which
 *    is where the dialect text still goes. The distinction #9108 paid for is
 *    kept, not collapsed: "the value was never in the text" and "the text was
 *    withheld" remain different facts about different strings.
 *
 * The end-to-end envelope, its enumeration and its `cause` preservation live in
 * `sql-driver-backend-fault-envelope.test.ts`; what stays here is the DOTTED
 * route, because that is the route this file has measured across three dialects
 * since #8790.
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
 * the day that path changes.
 *
 * ## [#8931 Q1+Q2, ruled 2026-08-17] The pg cell's answer changes — on purpose
 *
 * The envelope that was open when the paragraphs above were written is now
 * ruled, so the pg cell reads `DATABASE_ERROR` / 500 with a COMPOSED message
 * and no dialect text at all. That collapses the caller-visible half of the
 * mechanism distinction — a withheld message carries no literal whatever knex
 * did with the bindings — so the knex fact is kept on its own axis
 * ({@link DottedCell.dialectTextInlinesLiteral}) and asserted where the dialect
 * text still exists: the SERVER LOG line the driver writes on the way out.
 *
 * ⛔ Collapsing the two into "no literal reaches the caller" is exactly what let
 * #8931's false premise stand for a month; the axis is kept for that reason and
 * ⛔ must not be removed because the caller-side assertion became uniform.
 */
interface DottedCell {
  /**
   * The `code` the caller receives.
   *
   * [#8931 Q1/Q2] For sqlite/mysql this is still RECORDED (the #8790 refusal
   * decides it, and #8371 owns the dotted verdict). For pg it is now the ruled
   * generic backend-fault envelope — the terminal catch-all's answer, which
   * makes no claim about the filter.
   */
  code: string;
  /**
   * The `status` the caller receives — `undefined` would mean an unenveloped
   * dialect error escaped, which since the 2026-08-17 ruling no cell may do.
   */
  status: number;
  /** [#8931 Q3] Which mechanism keeps the literal out of the CALLER's message. */
  literalWithheldBy:
    | typeof REFUSAL_ENVELOPE
    | typeof NEVER_INLINED
    | typeof BACKEND_FAULT_ENVELOPE;
  /**
   * [#8931 Q3, re-homed by Q1/Q2] Does the dialect's own text — the string that
   * now reaches only the server log — carry the caller's bound literal?
   *
   * The half of `literalWithheldBy` that survives the envelope: `true` means
   * the log line proves the message COULD have carried the value (sqlite and
   * mysql leave `?` for knex's formatter to substitute), `false` means it never
   * could (pg positions bindings to `$n` first). Asserting only the caller's
   * side would make every cell pass for a different reason and record none of
   * them.
   */
  dialectTextInlinesLiteral: boolean;
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
/** [#8931 Q1/Q2] The whole dialect text is withheld, so nothing in it can travel. */
const BACKEND_FAULT_ENVELOPE = 'the #8931 backend-fault envelope (the dialect text is withheld whole)';

const DOTTED_STATUS_QUO: Readonly<Record<string, DottedCell>> = {
  sqlite: {
    code: 'INVALID_FILTER',
    status: 400,
    literalWithheldBy: REFUSAL_ENVELOPE,
    dialectTextInlinesLiteral: true,
    identifies: ['title.x', TABLE],
  },
  // [#8931 Q1+Q2, ruled 2026-08-17 「同意 C」] ⚠️ CHANGED CELL, and the reason is
  // recorded here so the next reader does not read it as drift. Postgres
  // classifies the dotted key as an undefined TABLE (`42P01`) — the identical
  // signal it raises for a relation that was never provisioned — so no honest
  // verdict about the FILTER can be read out of it. The ruling therefore does
  // not teach any predicate to recognise it: the terminal catch-all wraps every
  // dialect error the existing classification leaves unclaimed, and this cell
  // is one of them. `code`/`status` move from `42P01`/`undefined` to
  // `DATABASE_ERROR`/`500`, and the message stops carrying the statement.
  pg: {
    code: 'DATABASE_ERROR',
    status: 500,
    literalWithheldBy: BACKEND_FAULT_ENVELOPE,
    // Still false, still the #9108 measurement, now asserted on the LOG line —
    // the only string that still holds the dialect's words.
    dialectTextInlinesLiteral: false,
    // The composed message names the caller's own object and nothing else: ⛔ no
    // table name, no quoted reference, no `$n`. The negative half of this is
    // asserted for every cell in the disclosure sweep below.
    identifies: [TABLE],
  },
  mysql: {
    code: 'INVALID_FILTER',
    status: 400,
    literalWithheldBy: REFUSAL_ENVELOPE,
    dialectTextInlinesLiteral: true,
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
    expect(err.status).toBe(expected.status);
  });

  // [#8931 Q1+Q2, ruled 2026-08-17] The half of the ruling that is true of
  // EVERY cell and does not depend on which envelope a dialect lands in: no
  // dotted route may answer an unenveloped dialect error. Stated separately
  // from the per-cell record above so that a future cell added to
  // `DOTTED_STATUS_QUO` cannot record `status: undefined` and pass.
  it('no dialect answers a dotted key with an unenveloped dialect error (#8931)', async () => {
    for (const [half, run] of [
      ['find', () => driver.find(TABLE, { where: { 'title.x': SECRET_LITERAL } })],
      ['count', () => driver.count(TABLE, { where: { 'title.x': SECRET_LITERAL } })],
    ] as const) {
      const err = await caught(run);
      expect(typeof err.status, `${half}: an ADR-0112 status`).toBe('number');
      expect(err.status, `${half}`).toBeGreaterThanOrEqual(400);
      expect(typeof err.code, `${half}: an ADR-0112 code`).toBe('string');
      // The dialect's own vocabulary must not survive as the caller's `code`.
      expect(err.code, `${half}`).not.toBe('SQLITE_ERROR');
      expect(err.code, `${half}`).not.toBe('42P01');
      expect(err.code, `${half}`).not.toBe('ER_BAD_FIELD_ERROR');
    }
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
      // [#8931 Q1+Q2] The disclosure clause of the 2026-08-17 ruling, asserted
      // on every cell rather than only the one that changed: the caller-visible
      // message carries no STATEMENT SHAPE. Before the ruling the pg cell
      // failed all three of these — its message opened `select * from
      // "unresolvable_where_task" where "title"."x" = $1` — which is what made
      // "the caller sees the query's structure" the residue #9108 left open.
      expect(err.message, `${half}: no compiled statement`).not.toMatch(/\bselect\s/i);
      expect(err.message, `${half}: no positional placeholder`).not.toMatch(/\$\d/);
      expect(err.message, `${half}: no quoted physical reference`).not.toMatch(/["`]/);
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

    // [#8931 Q1+Q2, ruled 2026-08-17] Since the catch-all, EVERY cell writes
    // the dialect's own text to the server log on the way out — the pg cell
    // included, which before this ruling logged nothing at all because nothing
    // recognised its error. So the control is now uniform on the log's
    // EXISTENCE, and the per-cell fact it proves is what that text contains.
    const dialectText = logged.find((line) => line.includes(' - ') || line.includes('select '));
    expect(
      dialectText,
      'the dialect message must reach the server log — that is what makes this a withholding rather than a deletion',
    ).toBeDefined();

    if (expected.dialectTextInlinesLiteral) {
      // sqlite / mysql: knex leaves `?` standing, so its error formatter
      // substituted the caller's value into the text. The log carrying it is
      // the proof the caller's message "could have" carried it — without this,
      // "no literal in the message" is a claim about a string nobody showed
      // ever held one.
      expect(
        logged.some((line) => line.includes(SECRET_LITERAL)),
        'the dialect text should have reached the server log with the literal intact',
      ).toBe(true);
    } else {
      // Postgres: the value was parameterised BEFORE the failing statement was
      // formatted, so a `$n` placeholder stands where it would have been — in
      // the log, which since the ruling is the only place the dialect text
      // exists. ⛔ Do not read this cell as "the redaction works here": nothing
      // was redacted, the value was never in the string. The mechanism pin at
      // the bottom of this file is why that stays true.
      expect(String(dialectText), 'the value should stand as a placeholder, not a literal')
        .toMatch(/\$\d/);
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

  // [#8931] This used to assert the error "propagates unchanged", which since
  // the 2026-08-17 ruling is no longer what happens and would have been a
  // misleading name to leave standing: an unclassified dialect error now takes
  // the generic backend-fault envelope. What the control is FOR is unchanged —
  // the #8790 refusal must stay selective, i.e. a failure that is not about an
  // unresolvable column must not be answered as if it were. The full envelope,
  // its enumeration and its `cause` preservation are pinned in
  // `sql-driver-backend-fault-envelope.test.ts`.
  it('CONTROL an error that is not about an unresolvable column is NOT answered as a filter fault', async () => {
    const err = await caught(() => driver.find('no_such_table_at_all', {}));
    expect(err.code).not.toBe('INVALID_FILTER');
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
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
  //
  // [#8931 Q1+Q2, ruled 2026-08-17] `recognised: false` is still correct and is
  // now load-bearing in a second way: the pg dotted route is enveloped, but ⛔
  // NOT by this predicate learning `42P01`. It is enveloped by the terminal
  // CATCH-ALL, which claims no error class at all. A future reader tempted to
  // flip this to `true` "because pg is enveloped now" would be minting exactly
  // the second recognizer the ruling forbids — and, since `42P01` is also how
  // Postgres reports a table that was never provisioned, would answer
  // `INVALID_FILTER` for an unsynced schema.
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
 * [#8931 Q1+Q2, ruled 2026-08-17] ⚠️ This pin's CONSUMER moved, and it is worth
 * a sentence because a reader could otherwise conclude the envelope retired it.
 * The caller-visible message no longer carries the dialect text on any cell, so
 * the fact below no longer protects the caller — it protects the SERVER LOG,
 * which is where the driver now writes the dialect's words. A knex upgrade that
 * inlined pg bindings would put the caller's value in that log line, which is
 * precisely the exposure `redactBoundStatement` (`@objectstack/objectql`)
 * closes for the engine's own log slots. The pin therefore stays live and its
 * red still means "re-measure by hand"; only the string it is a statement about
 * has changed.
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
