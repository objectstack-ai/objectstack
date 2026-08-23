// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11224] The UPDATE door's `updated_at` stamp must carry the SAME precision
 * the audit column was created with — measured as the ordering invariant a
 * delta cursor depends on, not as a string shape.
 *
 * ## The mismatch this closes
 *
 * `createAuditTimestampColumn` builds the audit columns on MySQL as
 * `DATETIME(3)` defaulted with `now(3)`, and its docblock says why in as many
 * words ("`CURRENT_TIMESTAMP` has to carry matching precision for a
 * `DATETIME(3)` default", #3942). `updatedAtStamp()` — the value every UPDATE
 * door writes into that same column — was a bare `knex.fn.now()`, which
 * compiles to an unqualified `CURRENT_TIMESTAMP` that MySQL truncates to whole
 * seconds. So the column was created at millisecond precision on purpose and
 * then written at second precision.
 *
 * Measured on live MySQL 8.0.46 against the exact schema the driver produces:
 *
 * ```
 * created_at   11:59:33.357
 * update()     11:59:33.000   ← updated_at 357 ms EARLIER than created_at
 * ```
 *
 * ## Not #11176, and not a second derivation of the right answer
 *
 * #11176 landed `upsertUpdatedAtStamp()` — the precision-matched form — for the
 * UPSERT door only, deliberately leaving the UPDATE door's emitted SQL alone
 * because that card had not measured it. This one measures it, so the two
 * expressions collapse into ONE helper. §4 pins that collapse behaviourally:
 * whatever the upsert door puts in its payload is what the UPDATE door stamps,
 * character for character.
 *
 * ## Why the ordering invariant rather than the rendered SQL
 *
 * `updated_at >= created_at` is the property a consumer actually reads: an
 * audit answer comparing the two, a "modified since creation?" badge, and above
 * all a millisecond-precision delta cursor (`updated_at > cursor`), which
 * SKIPS every row whose stamp was truncated back below it — the same
 * silent-wrong-answer family as #11067 / #11176 / #11223, reached by a fourth
 * mechanism. §2 asserts that skip is gone by issuing the cursor comparison as
 * real SQL on the server rather than comparing numbers in JS.
 *
 * ## Non-vacuity
 *
 * Truncation is only OBSERVABLE on a row whose `created_at` carried a non-zero
 * millisecond component — roughly 999 inserts in 1000, but not all of them. So
 * every ordering cell runs {@link ROUNDS} independent create+update pairs and
 * asserts at least one of them carried sub-second digits. Without that guard a
 * run in which every `created_at` happened to land on `.000` would report a
 * green that no truncation could have perturbed.
 *
 * Every cell runs on SQLite AND on live Postgres / MySQL through
 * `declareDialectCell`, because "the other dialects do not regress" is a
 * measurement here and not an assumption: Postgres' `CURRENT_TIMESTAMP` is
 * `transaction_timestamp()` at microsecond precision and SQLite's stamp is a
 * JS ISO-8601 string with millis, so neither has anything to truncate — and the
 * emitted SQL on both is asserted UNCHANGED by §5.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring `main`'s `updatedAtStamp()` body turns §1, §2 and §3 red on the
 * live MySQL cell ONLY — with `updated_at` reading a few hundred ms EARLIER
 * than `created_at`, the defect itself as the received value — and turns §4 red
 * on that cell too (`CURRENT_TIMESTAMP` vs `CURRENT_TIMESTAMP(3)`). The SQLite
 * and Postgres cells stay green throughout: the asymmetry, observed rather than
 * argued.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — these fixtures are not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

/**
 * How many independent create+update pairs each ordering cell measures.
 *
 * Sized for the non-vacuity guard above rather than for coverage: the chance
 * that all six `created_at` defaults land on an exact `.000` millisecond is
 * ~1e-18, so a run that cannot observe truncation fails loudly instead of
 * passing vacuously.
 */
const ROUNDS = 6;

const MANAGED = 'os11224_stamp';
const BULK = 'os11224_bulk';

/** ISO-8601 with an explicit `Z` — the shape SQLite's stamp must keep (#3493 lineage). */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function managedObject(name: string) {
  return {
    name,
    fields: {
      id: { type: 'text' },
      title: { type: 'string' },
      status: { type: 'string' },
    },
  } as any;
}

/** Whatever the dialect handed back for an audit column, as epoch ms. */
function asInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const text = String(value);
  // SQLite stores TEXT. The canonical form already carries `Z`; a zone-naive
  // legacy form is read as UTC here rather than as host-local, matching what
  // `repairNaiveUtcAuditTimestamp` does on the read path.
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

/** Read the audit columns straight out of storage, past every read-side coercion. */
async function readAudit(driver: SqlDriver, table: string, id: string) {
  const row: any = await (driver as any).knex(table).where('id', id).first();
  return {
    createdAt: asInstant(row.created_at),
    updatedAt: asInstant(row.updated_at),
    /** The stored value in the dialect's OWN shape — what a cursor round-trips. */
    rawCreatedAt: row.created_at,
    row,
  };
}

function measure(cell: DialectCell): void {
  describe(`#11224 — the UPDATE door stamps at the audit column's precision (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // The DDL path, so the audit columns are the ones
      // `createAuditTimestampColumn` produces — `DATETIME(3) default now(3)` on
      // MySQL. That pairing is the whole defect.
      await driver.initObjects([managedObject(MANAGED), managedObject(BULK)]);
    });

    afterAll(async () => {
      await driver?.disconnect();
    });

    // ── §1 The ordering invariant, on a row updated inside its first second ──

    it('§1 never leaves `updated_at` EARLIER than `created_at`', async () => {
      const seen: { id: string; createdAt: number; updatedAt: number }[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const id = `s${i}`;
        await driver.create(MANAGED, { id, title: 'one', status: 'open' }, OPTS);
        // No sleep and no backdating: the row is updated inside the same second
        // it was created in, which is exactly where a truncated stamp lands
        // BEHIND the column's own `now(3)` default.
        await driver.update(MANAGED, id, { title: 'two' }, OPTS);
        seen.push({ id, ...(await readAudit(driver, MANAGED, id)) });
      }

      // Non-vacuity: truncation is invisible on a `created_at` of exactly `.000`.
      const withMillis = seen.filter((r) => r.createdAt % 1000 !== 0);
      expect(
        withMillis.length,
        'no `created_at` in this run carried sub-second digits, so nothing here could ' +
          'have observed a truncated stamp — the cell measured nothing',
      ).toBeGreaterThan(0);

      for (const r of seen) {
        // The defect: on MySQL this was `created_at` truncated to the second,
        // i.e. up to 999 ms in the PAST of a row that had just been created.
        expect(
          r.updatedAt,
          `${r.id}: updated_at ${new Date(r.updatedAt).toISOString()} is EARLIER than ` +
            `created_at ${new Date(r.createdAt).toISOString()}`,
        ).toBeGreaterThanOrEqual(r.createdAt);
      }
    });

    it('§1b holds for the BULK door too — one helper, every UPDATE path', async () => {
      // `update`, `updateMany` and `rotatedUpdateById` all read the same
      // `updatedAtStamp()`, so fixing the expression fixes every one of them.
      // This is the door that would silently keep the old value if a future
      // change gave it a private copy.
      const ids: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const id = `b${i}`;
        ids.push(id);
        await driver.create(BULK, { id, title: 'one', status: 'open' }, OPTS);
      }
      const affected = await driver.updateMany(BULK, { where: { status: 'open' } }, { title: 'two' }, OPTS);
      expect(affected).toBe(ROUNDS);

      const rows = await Promise.all(ids.map((id) => readAudit(driver, BULK, id)));
      expect(rows.filter((r) => r.createdAt % 1000 !== 0).length).toBeGreaterThan(0);
      for (const r of rows) expect(r.updatedAt).toBeGreaterThanOrEqual(r.createdAt);
    });

    // ── §2 The delta cursor, issued as real SQL on the server ────────────────

    it('§2 a millisecond-precision delta cursor does not SKIP the updated row', async () => {
      // The consequence that makes this a silent wrong answer rather than a
      // cosmetic one. The comparison is deliberately made BY THE SERVER, in the
      // column's own type, because that is where an incremental sync makes it —
      // comparing two JS numbers here would measure this test's own parsing.
      const knex = (driver as any).knex;
      const missed: string[] = [];
      let observable = 0;

      for (let i = 0; i < ROUNDS; i++) {
        const id = `c${i}`;
        await driver.create(MANAGED, { id, title: 'one', status: 'sync' }, OPTS);
        // The cursor a delta sync would be holding: the last instant it saw for
        // this row, at the full precision the column stores.
        const before = await readAudit(driver, MANAGED, id);
        if (before.createdAt % 1000 !== 0) observable++;

        await driver.update(MANAGED, id, { title: 'two' }, OPTS);

        const found = await knex(MANAGED).where('id', id).where('updated_at', '>=', before.rawCreatedAt).first();
        if (!found) missed.push(id);
      }

      expect(
        observable,
        'no cursor in this run sat at a sub-second offset, so no truncation could have ' +
          'moved a row below it — the cell measured nothing',
      ).toBeGreaterThan(0);
      // The defect: every row whose `created_at` carried millis was invisible to
      // its own cursor after being updated, so a delta sync silently dropped it.
      expect(missed, `rows skipped by their own delta cursor after update(): ${missed.join(', ')}`).toEqual([]);
    });

    // ── §3 Two updates in the same second stay distinguishable ───────────────

    it('§3 keeps sub-second resolution, so same-second updates are ordered', async () => {
      // Truncation collapses every update inside one second onto one value, so
      // an `order by updated_at` over them is unstable exactly where it matters.
      const id = 'd1';
      await driver.create(MANAGED, { id, title: 'one', status: 'seq' }, OPTS);
      const stamps: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        await driver.update(MANAGED, id, { title: `t${i}` }, OPTS);
        stamps.push((await readAudit(driver, MANAGED, id)).updatedAt);
      }
      // Monotone regardless (the invariant), and — the point — the run spans
      // less than the full second a truncated stamp would need to distinguish
      // any two of these at all.
      for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThanOrEqual(stamps[i - 1]);
      const span = stamps[stamps.length - 1] - stamps[0];
      expect(span, 'this run took over a second, so second-precision stamps could have differed too').toBeLessThan(
        1_000,
      );
      expect(new Set(stamps).size, 'every update in this second stamped the SAME instant').toBeGreaterThan(1);
    });

    // ── §4 The two stamp helpers collapsed into one ──────────────────────────

    it('§4 stamps the UPSERT door and the UPDATE door with the identical expression', async () => {
      // #11176 carried the precision-matched form as a SECOND helper
      // (`upsertUpdatedAtStamp`) so it could fix the upsert door without
      // changing the SQL every `update()` emits. This card measured that SQL, so
      // there is one helper again — and this is the assertion that stays red if
      // a future change re-forks them.
      const upsertPayload: Record<string, any> = {};
      (driver as any).stampUpsertUpdatedAt(MANAGED, upsertPayload);
      const updateStamp = (driver as any).updatedAtStamp();

      if (cell.id === 'sqlite') {
        // Both are JS-side ISO strings, so they differ by the millisecond they
        // were taken in; the SHAPE is what has to agree.
        expect(String(upsertPayload.updated_at)).toMatch(ISO_Z);
        expect(String(updateStamp)).toMatch(ISO_Z);
      } else {
        // Rendered SQL, character for character. Before this card the MySQL cell
        // read `CURRENT_TIMESTAMP(3)` here and `CURRENT_TIMESTAMP` there.
        expect(String(upsertPayload.updated_at)).toBe(String(updateStamp));
      }
    });

    // ── §5 The other dialects' emitted SQL is UNCHANGED ──────────────────────

    it('§5 emits the expression this dialect defaults its audit column with', async () => {
      // Not a restatement of §1: this pins WHICH form each dialect gets, so a
      // future "just add (3) everywhere" cannot pass §1 while changing the SQL
      // Postgres and SQLite emit.
      const stamp = String((driver as any).updatedAtStamp());
      switch (cell.id) {
        case 'mysql':
          // Matched to `createAuditTimestampColumn`'s `DATETIME(3) default now(3)` (#3942).
          expect(stamp).toBe('CURRENT_TIMESTAMP(3)');
          break;
        case 'pg':
          // Unchanged: `CURRENT_TIMESTAMP` is `transaction_timestamp()` at
          // microsecond precision against a `timestamptz` column — nothing to match.
          expect(stamp).toBe('CURRENT_TIMESTAMP');
          break;
        default:
          // Unchanged: SQLite has no temporal type, and the stamp is the same
          // zone-EXPLICIT ISO-8601 string the insert paths write.
          expect(stamp).toMatch(ISO_Z);
      }
    });

    // ── §6 #3493's historical import still wins ──────────────────────────────

    it('§6 still preserves a caller-supplied `updated_at` under `preserveAudit`', async () => {
      // The precision change must not reach the one caller allowed to pin the
      // value — otherwise a historical import silently starts being force-advanced.
      const id = 'e1';
      const supplied = new Date(Date.parse('2020-01-01T00:00:00.000Z'));
      await driver.create(MANAGED, { id, title: 'one', status: 'import' }, OPTS);
      await driver.update(
        MANAGED,
        id,
        { title: 'two', updated_at: (driver as any).isSqlite ? supplied.toISOString() : supplied },
        { ...OPTS, preserveAudit: true },
      );
      const after = await readAudit(driver, MANAGED, id);
      expect(after.updatedAt).toBe(supplied.getTime());
      expect(after.row.title).toBe('two');
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'update stamp precision (#11224)', measure);
}
