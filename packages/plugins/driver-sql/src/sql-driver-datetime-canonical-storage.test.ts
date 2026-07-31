// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3912 — `Field.datetime` has ONE storage form: canonical UTC text
 * (`YYYY-MM-DDTHH:MM:SS.sssZ`).
 *
 * The filter-level fix that came first (normalise the column in the comparison)
 * made queries correct but left the disease: two write paths producing two
 * shapes in one column. That still mis-ordered `ORDER BY` (#3928), still cost an
 * unindexable expression on every window, and still meant storage disagreed with
 * the value `find()` presents.
 *
 * So the write path canonicalises, the comparand canonicalises to the same
 * function, and `backfillCanonicalDatetimes` converges existing rows at schema
 * sync. This suite covers the three claims that buys:
 *   1. every write shape lands as one canonical string;
 *   2. the backfill converges a legacy database, and the read paths then drop
 *      their repair expression;
 *   3. lexicographic order is chronological order, so ORDER BY is correct.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { LegacyStorageDriver } from '../src/legacy-datetime-storage.testkit.js';

const CANONICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const makeDriver = <T extends SqlDriver>(Ctor: new (cfg: any) => T): T =>
  new Ctor({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });

const OBJECT = {
  name: 'evt',
  fields: { label: { type: 'string' }, at: { type: 'datetime' } },
} as any;

describe('Field.datetime writes land in ONE canonical form (#3912)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = makeDriver(SqlDriver);
    await driver.initObjects([OBJECT]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const storedOf = async (id: string) => {
    const res: any = await driver.execute(`select typeof(at) as t, at as v from evt where id = ?`, [id]);
    const row = Array.isArray(res) ? res[0] : (res?.rows?.[0] ?? res);
    return { type: row.t, value: row.v };
  };

  it('folds every accepted input shape onto the same stored string', async () => {
    const INSTANT = '2026-03-20T12:00:00.000Z';
    const inputs: Array<[string, unknown]> = [
      ['date-obj', new Date(INSTANT)],
      ['iso-z', INSTANT],
      ['iso-no-ms', '2026-03-20T12:00:00Z'],
      ['offset', '2026-03-20T20:00:00+08:00'], // same instant, other offset
      ['naive', '2026-03-20 12:00:00'],        // wall clock IS UTC (ADR-0074)
      ['epoch-num', Date.parse(INSTANT)],
      ['epoch-str', String(Date.parse(INSTANT))],
    ];
    for (const [id, at] of inputs) {
      await driver.create('evt', { id, label: id, at }, { bypassTenantAudit: true });
    }

    for (const [id] of inputs) {
      const stored = await storedOf(id);
      expect(stored.type, `${id} stored form`).toBe('text');
      expect(stored.value, `${id} stored value`).toBe(INSTANT);
    }
  });

  it('stores a bare calendar day as UTC midnight, not local midnight', async () => {
    await driver.create('evt', { id: 'day', label: 'day', at: '2026-03-20' }, { bypassTenantAudit: true });
    expect((await storedOf('day')).value).toBe('2026-03-20T00:00:00.000Z');
  });

  it('leaves an uninterpretable value alone rather than inventing an instant', async () => {
    await driver.create('evt', { id: 'junk', label: 'junk', at: 'not-a-date' }, { bypassTenantAudit: true });
    expect((await storedOf('junk')).value).toBe('not-a-date');
  });

  it('sorts chronologically as TEXT — lexicographic order IS time order (#3928)', async () => {
    // The property that makes canonical UTC text the right choice over an epoch
    // integer: ORDER BY needs no expression, so it can use an index, and a
    // `Date`-written row can no longer sort ahead of an ISO-written one.
    const instants = [
      ['e-1969', '1969-12-31T23:59:59.999Z'],
      ['e-2025', '2025-11-15T09:00:00.000Z'],
      ['e-2026a', '2026-01-10T09:00:00.000Z'],
      ['e-2026b', '2026-06-30T23:59:59.000Z'],
    ] as const;
    // Alternate the write shape so a form-sensitive sort would interleave wrongly.
    for (const [i, [id, iso]] of instants.entries()) {
      await driver.create(
        'evt', { id, label: id, at: i % 2 === 0 ? new Date(iso) : iso }, { bypassTenantAudit: true },
      );
    }

    const rows = await driver.find('evt', { object: 'evt', orderBy: [{ field: 'at', order: 'asc' }] });
    expect(rows.map((r: any) => r.id)).toEqual(instants.map(([id]) => id));

    // …and the raw column sorts identically, i.e. the DB did the ordering.
    const res: any = await driver.execute(`select id from evt order by at asc`);
    const raw = Array.isArray(res) ? res : (res?.rows ?? []);
    expect(raw.map((r: any) => r.id)).toEqual(instants.map(([id]) => id));
  });

  it('emits a plain indexable comparison — no repair expression (#3912)', async () => {
    // A table created in this process is canonical by construction, so
    // `needsLegacyDatetimeRepair` is false and the SQL has no CASE in it.
    const sql = (driver as any).knex('evt').where('at', '>=', '2026-01-01').toString();
    expect(sql).not.toContain('typeof');
    const compiled = (driver as any).knex.queryBuilder();
    (driver as any).applyFilters(compiled.table('evt'), { at: { $gte: '2026-01-01' } });
    expect(compiled.toString()).not.toContain('typeof');
    expect(compiled.toString()).toContain('2026-01-01T00:00:00.000Z');
  });
});

describe('backfillCanonicalDatetimes converges a legacy database (#3912)', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => {
    driver = makeDriver(LegacyStorageDriver);
    await driver.initObjects([OBJECT]);
    await driver.seedLegacyRows('evt', 'at', [
      { id: 'epoch', label: 'epoch', at: Date.parse('2026-03-20T12:00:00.000Z') },
      { id: 'naive', label: 'naive', at: '2026-03-20 12:00:00' },
      { id: 'offset', label: 'offset', at: '2026-03-20T20:00:00+08:00' },
      { id: 'canon', label: 'canon', at: '2026-03-20T12:00:00.000Z' },
      { id: 'junk', label: 'junk', at: 'not-a-date' },
      { id: 'nil', label: 'nil', at: null },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('rewrites every interpretable row to the canonical form', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);

    const forms = Object.fromEntries(
      (await driver.storedForms('evt', 'at')).map((r) => [r.id, r.value]),
    );
    // All four interpretable shapes describe the same instant, so they converge
    // on one byte-identical string.
    expect(forms.epoch).toBe('2026-03-20T12:00:00.000Z');
    expect(forms.naive).toBe('2026-03-20T12:00:00.000Z');
    expect(forms.offset).toBe('2026-03-20T12:00:00.000Z');
    expect(forms.canon).toBe('2026-03-20T12:00:00.000Z');
  });

  it('preserves what it cannot interpret instead of nulling it', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const forms = Object.fromEntries(
      (await driver.storedForms('evt', 'at')).map((r) => [r.id, r.value]),
    );
    expect(forms.junk).toBe('not-a-date');
    expect(forms.nil).toBeNull();
  });

  it('marks the column clean, so the read paths drop the repair expression', async () => {
    expect((driver as any).needsLegacyDatetimeRepair('evt', 'at')).toBe(true);
    expect((driver as any).filterColumnExpr('evt', 'at', 'at')).not.toBeNull();

    await (driver as any).backfillCanonicalDatetimes('evt', true);

    expect((driver as any).needsLegacyDatetimeRepair('evt', 'at')).toBe(false);
    expect((driver as any).filterColumnExpr('evt', 'at', 'at')).toBeNull();
    expect(driver.temporalFilterColumnSql('evt', 'at', '"at"')).toBe('"at"');
  });

  it('is idempotent — a second run rewrites nothing', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const before = await driver.storedForms('evt', 'at');
    driver.forgetCanonical('evt', 'at');
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    expect(await driver.storedForms('evt', 'at')).toEqual(before);
  });

  it('makes a window filter return the same rows before and after (#3912)', async () => {
    // The repair keeps the un-migrated database CORRECT; the backfill only makes
    // it fast. Both must agree, or the migration would be observable as a change
    // in results — which is exactly what it must never be.
    const window = { at: { $gte: '2026-03-20T00:00:00.000Z', $lte: '2026-03-21T00:00:00.000Z' } };
    const before = (await driver.find('evt', { object: 'evt', where: window })).map((r: any) => r.id).sort();
    expect(before).toEqual(['canon', 'epoch', 'naive', 'offset']);

    await (driver as any).backfillCanonicalDatetimes('evt', true);

    const after = (await driver.find('evt', { object: 'evt', where: window })).map((r: any) => r.id).sort();
    expect(after).toEqual(before);
  });

  it('runs automatically at schema sync', async () => {
    // The fixture cleared the marker by hand; a real boot re-runs `initObjects`,
    // which is where the backfill is wired in.
    expect((driver as any).needsLegacyDatetimeRepair('evt', 'at')).toBe(true);
    await driver.initObjects([OBJECT]);
    expect((driver as any).needsLegacyDatetimeRepair('evt', 'at')).toBe(false);
    for (const row of await driver.storedForms('evt', 'at')) {
      if (row.id === 'junk' || row.id === 'nil') continue;
      expect(String(row.value)).toMatch(CANONICAL);
    }
  });
});
