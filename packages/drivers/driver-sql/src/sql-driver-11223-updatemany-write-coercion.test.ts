// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11223] `updateMany()` is the write door that skipped `formatInput` /
 * `applyWriteColumnMap`.
 *
 * Every other write door in `sql-driver.ts` — `create`, `update`, `bulkCreate`,
 * `upsert`, `rotatedUpdateById` — spells
 * `this.applyWriteColumnMap(object, this.formatInput(object, data))` before it
 * builds a statement. `updateMany` passed the caller's `data` straight to
 * `builder.update(data)`, while the WHERE side of the SAME statement went
 * through `applyFilters` and WAS translated.
 *
 * ## Why one cause needs this many sections
 *
 * The gap produced three failures with three different shapes, and a suite that
 * measured one of them would have said nothing about the other two:
 *
 *   - §1 json / `Field.multiple` values were REFUSED. Loud, every dialect, with
 *     three different dialect voices — `22P02 invalid input syntax for type
 *     json` on live Postgres, `SQLite3 can only bind numbers, strings, bigints,
 *     buffers, and null` on SQLite, and on MySQL the array expanded INTO the SET
 *     list (``set `tags` = 'y', 'z'``), which is a syntax error rather than a
 *     bind error.
 *   - §4 an `external.columnMap` object emitted a SET naming the LOCAL field
 *     beside a WHERE naming the physical column, in one statement:
 *     ``update `legacy_p` set `name` = 'Bulk' where `full_name` = 'Renamed'``
 *     → `no such column: name`. Loud, and it made the door unusable on exactly
 *     the objects federation exists to serve.
 *   - §2/§3 a temporal value was stored VERBATIM. SILENT, and the dangerous one.
 *
 * ## §3 is the section that justifies the card's priority
 *
 * `needsLegacyDatetimeRepair` exists to repair the pre-#3912 zone-naive storage
 * form on READ — but it consults `canonicalDatetimeFields`, and a column that
 * registry has certified ("proven to hold ONLY canonical UTC text") has its
 * read-side repair DROPPED. `initObjects` certifies a freshly created column.
 * So this door wrote the one form the repair exists for, into the one kind of
 * column that no longer gets repaired.
 *
 * Measured on the unfixed driver, SQLite, with both rows written to the same
 * calendar day through the two doors: a range filter over that day returned
 * `['a']` — the `update()` row. The `updateMany()` row was on disk with the
 * right day and invisible to the query, with `needsLegacyDatetimeRepair` already
 * answering `false` for the column. §3 is that measurement.
 *
 * ## The card scoped §2 to SQLite. It is not SQLite-only, and live Postgres is worse
 *
 * On SQLite the naive form is a STORAGE-FORM regression — the text is wrong, the
 * wall clock it names is not. On live Postgres the same literal is resolved in
 * the SERVER's timezone rather than UTC, which moves the INSTANT: measured
 * `2026-05-06 07:08:09` → `2026-05-05T23:08:09.000Z` on an `Asia/Shanghai`
 * server, exactly -8h, while `update()` stored `2026-05-06T07:08:09.000Z` from
 * the identical input in the same run. That is the hazard `formatInput`'s own
 * ADR-0053 note describes ("measured at 8 hours off on an `Asia/Shanghai`
 * server"), reached through the one door that skipped it. §2 asserts the
 * INSTANT, so that cell fails on the shift rather than on the spelling.
 *
 * MySQL was accidentally correct here — the driver pins the mysql2 SESSION to
 * UTC (#3942), so the naive literal is read as UTC — which is precisely why §2
 * running on one dialect would prove nothing.
 *
 * ## §2 also measures `date` and `time`, which the card guessed at
 *
 * The card said `date`/`time` "are presumably affected the same way; only
 * `datetime` was measured". Measured now, and the guess was right with a
 * dialect twist: on SQLite both landed verbatim (a full ISO string in a
 * date-only column, and in a time-of-day column), and on live Postgres and
 * MySQL the same uncoerced values were REFUSED outright. So they are silent on
 * SQLite and loud on the live dialects.
 *
 * ## §5 settles the open question the card names
 *
 * `formatInput` also resolves the literal `'NOW()'` token. On the unfixed door
 * SQLite stored the four-character string `"NOW()"` into a datetime column
 * (silent garbage) and MySQL refused it (`Incorrect datetime value: 'NOW()'`),
 * while `update()` resolved it on all three. Mirroring the other doors is what
 * the driver's own consumers already assume: the ONE production caller of
 * `driver.updateMany` (`engine.ts`, the predicate-write branch) hands it the
 * same `hookContext.input.data` object the by-id branch hands `driver.update`.
 *
 * ## Reverse verification — predicted, then MEASURED, and the two differed
 *
 * Predicted before running: §1–§5 red, §6 green. Restoring `main`'s `updateMany`
 * body gave **15 of 18 red**, and the three survivors are the more interesting
 * half of the result:
 *
 *   - **live Postgres keeps §5 green.** Postgres's own datetime parser accepts
 *     the string `'NOW()'`, so the unresolved token happens to land on a real
 *     instant there. SQLite stored it as the literal text and MySQL refused it —
 *     so a §5 written on the PG cell alone would have measured nothing.
 *   - **live MySQL keeps §3 green.** The driver pins the mysql2 SESSION to UTC
 *     (#3942), so the naive literal is read as the instant it names and the
 *     range filter still finds the row. This is the dialect asymmetry itself,
 *     observed rather than argued — and the reason §3 is not written as a
 *     SQLite-only section: what makes SQLite fail here is that its certified
 *     column has no read-side repair left, not that SQLite is where the bug is.
 *   - **§6 went red too, and that was a fault in §6 rather than a finding.** It
 *     patched a `json` field, which the §1 defect refuses outright on the unfixed
 *     driver, so it could never reach its own assertion. It now patches a plain
 *     `string` field and is green on both trees, which is what a guard on an
 *     unchanged decision should be.
 *
 * The failure SHAPES differ by section, which is the point of measuring them
 * separately: §1 and §4 arrive as thrown dialect errors (`invalid input syntax
 * for type json`, `SQLite3 can only bind …`, `Unknown column 'name' in 'field
 * list'`, `no such column: name`), while §2, §3 and §5 arrive as calls that
 * SUCCEEDED and left a wrong value behind (`expected '2026-05-06 07:08:09' to be
 * '2026-05-06T07:08:09.000Z'`, `expected [ 's3a' ] to deeply equal [ 's3a',
 * 's3b' ]`, `expected 'NOW()' not to be 'NOW()'`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** These fixtures are not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

const T = 'os11223_w';
const REMOTE = 'os11223_legacy';

/** The naive wall clock both doors are handed, and the instant it denotes. */
const NAIVE_DT = '2026-05-06 07:08:09';
const WANT_MS = Date.parse('2026-05-06T07:08:09.000Z');
/** A full ISO value written into a `date` / `time` column — what `formatInput` narrows. */
const WIDE_DAY = '2026-05-06T00:00:00.000Z';
const WIDE_CLOCK = '2026-05-06T07:08:09.000Z';

function writeObject(name: string) {
  return {
    name,
    fields: {
      id: { type: 'text' },
      // `string`, not `text`: MySQL refuses to index or key a TEXT column
      // without a length, and this is the filter target for every bulk write here.
      kind: { type: 'string' },
      payload: { type: 'json' },
      tags: { type: 'string', multiple: true },
      when: { type: 'datetime' },
      day: { type: 'date' },
      clock: { type: 'time' },
    },
  } as any;
}

/** The ADR-0015 §18 shape: a remote table whose columns are named differently. */
function remoteObject(name: string) {
  return {
    name,
    fields: { cust_id: { type: 'text' }, full_name: { type: 'string' }, region_code: { type: 'string' } },
  } as any;
}

/**
 * `{ remoteColumn -> localField }`, the direction ADR-0015 declares it in.
 *
 * `id` is deliberately NOT remapped here. `update()` addresses a row with a
 * literal `where('id', …)` while the SET side goes through the map, so a fixture
 * that remapped the primary key would be measuring THAT asymmetry (a different
 * question, and one #8622 already reasons about at the upsert door) instead of
 * the SET-clause mapping this card is about. The defect reproduces on exactly
 * the pair the card's emitted SQL names: local `name` ↔ remote `full_name`.
 */
const COLUMN_MAP = { full_name: 'name', region_code: 'region' };
const LOCAL_FIELDS = { name: { type: 'string' }, region: { type: 'string' } };

/** Whatever the dialect handed back for a temporal column, as epoch ms. */
function asInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const text = String(value);
  // A zone-naive form is read as UTC here rather than as host-local, so this
  // helper cannot itself invent the shift the assertion is looking for.
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

/** Read a row past every read-side coercion — storage as it actually is. */
async function raw(driver: SqlDriver, table: string, id: string, idColumn = 'id'): Promise<any> {
  return (driver as any).knex(table).where(idColumn, id).first();
}

function measure(cell: DialectCell): void {
  describe(`#11223 — updateMany coerces its payload like every other write door (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // `initObjects` is what certifies the fresh datetime column as canonical
      // (`canonicalDatetimeFields`), which is the state §3 needs: the read-side
      // repair for it is already dropped before the first bulk write lands.
      await driver.initObjects([writeObject(T), remoteObject(REMOTE)]);
      // The federated view of the table `initObjects` just built, bound through
      // a columnMap. §4 writes through this name.
      driver.registerExternalObject({
        name: 'os11223_cm',
        external: { remoteName: REMOTE, columnMap: COLUMN_MAP },
        fields: LOCAL_FIELDS,
      });
    });

    afterAll(async () => {
      await driver?.disconnect();
    });

    // ── §1 json / Field.multiple ────────────────────────────────────────────

    it('§1 writes a json object and a `multiple` array through the bulk door', async () => {
      await driver.create(T, { id: 's1a', kind: 'json', payload: { a: 1 }, tags: ['x'] }, OPTS);
      await driver.create(T, { id: 's1b', kind: 'json', payload: { a: 1 }, tags: ['x'] }, OPTS);

      // The control: the door that always worked, same values, same run.
      await driver.update(T, 's1a', { payload: { a: 2, deep: { b: [1, 2] } }, tags: ['y', 'z'] }, OPTS);

      // The defect: this call THREW on every dialect, each in its own voice —
      // `22P02` on Postgres, a bind refusal on SQLite, a SET-list syntax error
      // on MySQL. Nothing stringified the structured value for the bind.
      const affected = await driver.updateMany(
        T,
        { where: { id: 's1b' } },
        { payload: { a: 2, deep: { b: [1, 2] } }, tags: ['y', 'z'] },
        OPTS,
      );
      expect(affected).toBe(1);

      // Read back through the driver: both doors must produce the same record.
      const [viaUpdate] = await driver.find(T, { where: { id: 's1a' } }, OPTS);
      const [viaBulk] = await driver.find(T, { where: { id: 's1b' } }, OPTS);
      expect(viaBulk.payload).toEqual({ a: 2, deep: { b: [1, 2] } });
      expect(viaBulk.tags).toEqual(['y', 'z']);
      expect(viaBulk.payload).toEqual(viaUpdate.payload);
      expect(viaBulk.tags).toEqual(viaUpdate.tags);

      // …and the STORAGE forms agree too, not just the coerced read. A door that
      // stored a different shape could still read back equal through
      // `formatOutput` and leave the disk inconsistent between the two doors.
      const rawUpdate = await raw(driver, T, 's1a');
      const rawBulk = await raw(driver, T, 's1b');
      expect(typeof rawBulk.payload).toBe(typeof rawUpdate.payload);
      expect(typeof rawBulk.tags).toBe(typeof rawUpdate.tags);
    });

    // ── §2 temporal coercion: datetime, date and time ───────────────────────

    it('§2 stores datetime / date / time in the SAME form `update()` stores them', async () => {
      await driver.create(T, { id: 's2a', kind: 'temporal', when: '2026-01-01T00:00:00.000Z', day: '2026-01-01', clock: '01:02:03' }, OPTS);
      await driver.create(T, { id: 's2b', kind: 'temporal', when: '2026-01-01T00:00:00.000Z', day: '2026-01-01', clock: '01:02:03' }, OPTS);

      // The SAME inputs through both doors — the control that makes the
      // comparison honest. A zone-naive wall clock, and full-ISO values in a
      // date-only and a time-of-day column.
      const patch = { when: NAIVE_DT, day: WIDE_DAY, clock: WIDE_CLOCK };
      await driver.update(T, 's2a', { ...patch }, OPTS);
      // On the unfixed driver this SUCCEEDED on SQLite (storing all three
      // verbatim) and was REFUSED on live Postgres and MySQL, which would not
      // take a full ISO string in a `date` / `time` column.
      await driver.updateMany(T, { where: { id: 's2b' } }, { ...patch }, OPTS);

      const rawUpdate = await raw(driver, T, 's2a');
      const rawBulk = await raw(driver, T, 's2b');

      // The instant, not the spelling. This is what fails on live Postgres when
      // a zone-naive literal is resolved in the SERVER's timezone: measured
      // -8h on an `Asia/Shanghai` server through this door, while the `update()`
      // row in the same run carried the intended instant.
      expect(asInstant(rawBulk.when)).toBe(WANT_MS);
      expect(asInstant(rawBulk.when)).toBe(asInstant(rawUpdate.when));

      // The two doors agree byte-for-byte on what they put on disk.
      expect(String(rawBulk.when)).toBe(String(rawUpdate.when));
      expect(String(rawBulk.day)).toBe(String(rawUpdate.day));
      expect(String(rawBulk.clock)).toBe(String(rawUpdate.clock));

      if (cell.hasLegacyStorageForm) {
        // SQLite stores TEXT, so the canonical form is directly assertable —
        // and the pre-#3912 form this door used to write is exactly what the
        // negation rules out.
        expect(rawBulk.when).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(rawBulk.when).not.toBe(NAIVE_DT);
        // A `Field.date` is a calendar day and a `Field.time` a time-of-day;
        // neither may keep the full ISO instant it was handed.
        expect(rawBulk.day).toBe('2026-05-06');
        expect(rawBulk.clock).toMatch(/^\d{2}:\d{2}:\d{2}(\.\d+)?$/);
      }
    });

    // ── §3 the certified-canonical column keeps its claim ───────────────────

    it('§3 leaves a canonical-certified column still findable by a range filter', async () => {
      // `initObjects` created this table in this process, so
      // `canonicalDatetimeFields` has certified `when` and the read-side repair
      // (`needsLegacyDatetimeRepair`) is already dropped for it. That is what
      // makes a non-canonical write here unrecoverable rather than merely ugly:
      // no later layer repairs it.
      if (cell.hasLegacyStorageForm) {
        expect((driver as any).needsLegacyDatetimeRepair(T, 'when')).toBe(false);
      }

      await driver.create(T, { id: 's3a', kind: 'window', when: '2026-01-01T00:00:00.000Z' }, OPTS);
      await driver.create(T, { id: 's3b', kind: 'window', when: '2026-01-01T00:00:00.000Z' }, OPTS);

      await driver.update(T, 's3a', { when: NAIVE_DT }, OPTS);
      await driver.updateMany(T, { where: { id: 's3b' } }, { when: NAIVE_DT }, OPTS);

      // Both rows were written to the same calendar day through the two doors,
      // so both must be inside the window. On the unfixed driver this returned
      // `['s3a']` on SQLite — the bulk-written row was on disk carrying the
      // right day and invisible to the query.
      const found = await driver.find(
        T,
        { where: { kind: 'window', when: { $gte: '2026-05-06T00:00:00.000Z', $lte: '2026-05-06T23:59:59.999Z' } } },
        OPTS,
      );
      expect(found.map((r: any) => r.id).sort()).toEqual(['s3a', 's3b']);
    });

    // ── §4 external.columnMap ───────────────────────────────────────────────

    it('§4 maps the SET clause to physical columns on a federated object', async () => {
      // Seeded through the remote object's own names, so the fixture does not
      // depend on the mapping under test.
      await driver.create(REMOTE, { id: 'r1', cust_id: 'c1', full_name: 'Renamed', region_code: 'NA' }, OPTS);
      await driver.create(REMOTE, { id: 'r2', cust_id: 'c2', full_name: 'Renamed', region_code: 'EU' }, OPTS);

      // The control: the by-id door already mapped the SET side.
      await driver.update('os11223_cm', 'r1', { name: 'Aurora' }, OPTS);
      expect((await raw(driver, REMOTE, 'r1')).full_name).toBe('Aurora');

      // The defect: the WHERE was mapped (`full_name`) and the SET was not
      // (`name`), in one statement — `no such column: name`. The filter below
      // is written in LOCAL field names, exactly as a caller writes it.
      const affected = await driver.updateMany('os11223_cm', { where: { name: 'Renamed' } }, { name: 'Bulk' }, OPTS);
      expect(affected).toBe(1);

      const after = await raw(driver, REMOTE, 'r2');
      expect(after.full_name).toBe('Bulk');
      // The local field name must NOT have become a column of its own.
      expect(after.name).toBeUndefined();
      // …and the row the filter did not name is untouched.
      expect((await raw(driver, REMOTE, 'r1')).full_name).toBe('Aurora');
    });

    // ── §5 the `NOW()` token ────────────────────────────────────────────────

    it('§5 resolves the literal `NOW()` token, the way every other door does', async () => {
      await driver.create(T, { id: 's5a', kind: 'now', when: '2026-01-01T00:00:00.000Z' }, OPTS);
      await driver.create(T, { id: 's5b', kind: 'now', when: '2026-01-01T00:00:00.000Z' }, OPTS);

      await driver.update(T, 's5a', { when: 'NOW()' }, OPTS);
      // Unfixed: SQLite stored the four-character string `"NOW()"` in a datetime
      // column and MySQL refused it outright.
      await driver.updateMany(T, { where: { id: 's5b' } }, { when: 'NOW()' }, OPTS);

      const rawBulk = await raw(driver, T, 's5b');
      expect(String(rawBulk.when)).not.toBe('NOW()');
      const instant = asInstant(rawBulk.when);
      expect(Number.isNaN(instant)).toBe(false);
      expect(instant).toBeGreaterThan(Date.now() - 10 * 60_000);
      expect(instant).toBeLessThan(Date.now() + 10 * 60_000);
      // Both doors landed in the same window, from the same token.
      const rawUpdate = await raw(driver, T, 's5a');
      expect(Math.abs(instant - asInstant(rawUpdate.when))).toBeLessThan(10 * 60_000);
    });

    // ── §6 #11176's decisions, unchanged ────────────────────────────────────

    it('§6 still stamps `updated_at`, and still honours `preserveAudit`', async () => {
      // This change moves WHICH payload the stamping decision reads (`data` →
      // `formatted`, matching `update()` and `rotatedUpdateById`). #11176's two
      // answers must be identical either way, so this section is green before
      // and after — it is the guard on the move, not a measurement of it.
      const BACKDATED = Date.parse('2020-01-01T00:00:00.000Z');
      const iso = new Date(BACKDATED).toISOString();
      await driver.create(T, { id: 's6a', kind: 'stamp' }, OPTS);
      await (driver as any).knex(T).where('id', 's6a').update({
        updated_at: (driver as any).isSqlite ? iso : new Date(BACKDATED),
      });

      // The patch is a plain `string` field on purpose. A json value here would
      // be refused by the §1 defect on the unfixed driver, so this section would
      // go red for a reason that has nothing to do with what it measures — it
      // did, on the first reverse-verification run, on SQLite and MySQL.
      await driver.updateMany(T, { where: { id: 's6a' } }, { kind: 'stamped' }, OPTS);
      const stamped = await raw(driver, T, 's6a');
      expect(asInstant(stamped.updated_at)).toBeGreaterThan(BACKDATED);

      // The opt-in historical import still pins the value it supplied.
      await driver.updateMany(
        T,
        { where: { id: 's6a' } },
        { kind: 'imported', updated_at: (driver as any).isSqlite ? iso : new Date(BACKDATED) },
        { ...OPTS, preserveAudit: true },
      );
      const preserved = await raw(driver, T, 's6a');
      expect(asInstant(preserved.updated_at)).toBe(BACKDATED);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'updateMany write coercion (#11223)', measure);
}
