// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3994 — `Field.time` canonical storage: `HH:MM:SS`, `.fff` only when the
 * milliseconds are non-zero.
 *
 * `Field.time` repeated the pre-#3912 `Field.datetime` pattern: `formatInput`
 * never normalised it, so one SQLite column accumulated bare-time TEXT,
 * full-timestamp TEXT and INTEGER epoch ms side by side. Reads looked right
 * (`formatOutput` repaired), but a business-hours window filter compared the
 * raw stored forms: INTEGER rows failed `>= '09:00:00'` outright
 * (`INTEGER < TEXT` in SQLite's type ordering) and `'2026-…'` timestamp rows
 * failed `<= '18:00:00'` lexicographically — 4 of 7 rows silently dropped,
 * measured. These tests pin the three halves of the fix: canonical writes,
 * canonical comparands, and the backfill + read-repair for legacy rows.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { LegacyStorageDriver } from './legacy-datetime-storage.testkit.js';

const SHIFT = {
  name: 'shift',
  fields: {
    label: { type: 'text' },
    starts_at: { type: 'time' },
  },
} as any;

const make = <T extends SqlDriver>(Ctor: new (cfg: any) => T): T =>
  new Ctor({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });

// One wall clock (14:30:00.500 UTC) written in every accepted input shape, plus
// an 08:00 row that must stay OUTSIDE the business-hours window.
const WRITE_SHAPES: Array<[string, unknown]> = [
  ['s_hm', '14:30'],
  ['s_hms', '14:30:00'],
  ['s_ms', '14:30:00.500'],
  ['s_iso', '2026-01-15T14:30:00.500Z'],
  ['s_naive', '2026-01-15 14:30:00'],
  ['s_date_obj', new Date(Date.UTC(2026, 0, 15, 14, 30, 0, 500))],
  ['s_epoch', Date.UTC(2026, 0, 15, 14, 30, 0, 500)],
  ['s_early', '08:00:00'],
];

describe('Field.time canonical writes (#3994)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  it('collapses every accepted input shape to canonical TEXT — no INTEGER rows, no date prefixes', async () => {
    driver = make(SqlDriver);
    await driver.initObjects([SHIFT]);
    for (const [id, v] of WRITE_SHAPES) {
      await driver.create('shift', { id, label: id, starts_at: v }, { bypassTenantAudit: true });
    }

    const res: any = await (driver as any).knex.raw(
      `select id, typeof(starts_at) as t, starts_at as v from shift order by id`,
    );
    for (const row of res) {
      expect(row.t).toBe('text');
      expect(row.v).toMatch(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/);
    }
    const byId = Object.fromEntries(res.map((r: any) => [r.id, r.v]));
    // Zero milliseconds spell `HH:MM:SS`; non-zero keep exactly three digits.
    expect(byId.s_hm).toBe('14:30:00');
    expect(byId.s_naive).toBe('14:30:00');
    expect(byId.s_iso).toBe('14:30:00.500');
    expect(byId.s_date_obj).toBe('14:30:00.500');
    expect(byId.s_epoch).toBe('14:30:00.500');
  });

  it('the business-hours window matches every 14:30 row and excludes the 08:00 row (the #3994 F1 repro)', async () => {
    driver = make(SqlDriver);
    await driver.initObjects([SHIFT]);
    for (const [id, v] of WRITE_SHAPES) {
      await driver.create('shift', { id, label: id, starts_at: v }, { bypassTenantAudit: true });
    }

    const hits = await driver.find('shift', {
      object: 'shift',
      where: { starts_at: { $gte: '09:00:00', $lte: '18:00:00' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(hits.map((r: any) => r.id)).toEqual(
      ['s_date_obj', 's_epoch', 's_hm', 's_hms', 's_iso', 's_ms', 's_naive'],
    );
  });

  it('equality cannot be split by input precision: HH:MM writes match an HH:MM:SS comparand', async () => {
    driver = make(SqlDriver);
    await driver.initObjects([SHIFT]);
    await driver.create('shift', { id: 'a', label: 'a', starts_at: '14:30' }, { bypassTenantAudit: true });
    await driver.create('shift', { id: 'b', label: 'b', starts_at: '14:30:00' }, { bypassTenantAudit: true });

    const hits = await driver.find('shift', { object: 'shift', where: { starts_at: '14:30:00' } });
    expect(hits.map((r: any) => r.id).sort()).toEqual(['a', 'b']);
    // And the comparand is canonicalised too — the minutes-only spelling
    // matches the same two rows.
    const hits2 = await driver.find('shift', { object: 'shift', where: { starts_at: '14:30' } });
    expect(hits2.map((r: any) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('ORDER BY sorts chronologically across mixed written shapes', async () => {
    driver = make(SqlDriver);
    await driver.initObjects([SHIFT]);
    for (const [id, v] of WRITE_SHAPES) {
      await driver.create('shift', { id, label: id, starts_at: v }, { bypassTenantAudit: true });
    }
    const rows = await driver.find('shift', { object: 'shift', orderBy: [{ field: 'starts_at', order: 'asc' }] });
    // 08:00 first; the `.500` rows after their `14:30:00` flat siblings
    // (`.` sorts below every digit, so lexicographic == chronological).
    expect((rows[0] as any).id).toBe('s_early');
    const times = rows.map((r: any) => r.starts_at);
    expect(times).toEqual([...times].sort());
  });

  it('distinct() presents canonically and collapses equal wall clocks (#3994 F6)', async () => {
    driver = make(SqlDriver);
    await driver.initObjects([SHIFT]);
    for (const [id, v] of WRITE_SHAPES) {
      await driver.create('shift', { id, label: id, starts_at: v }, { bypassTenantAudit: true });
    }
    const values = await driver.distinct('shift', 'starts_at');
    expect(values.sort()).toEqual(['08:00:00', '14:30:00', '14:30:00.500']);
  });

  it('passes uninterpretable values through unchanged rather than rewriting them', async () => {
    driver = make(SqlDriver);
    await driver.initObjects([SHIFT]);
    // '25:00' is not a wall clock; the driver must not invent one.
    await driver.create('shift', { id: 'junk', label: 'j', starts_at: '25:00' }, { bypassTenantAudit: true });
    const res: any = await (driver as any).knex.raw(`select starts_at as v from shift where id = 'junk'`);
    expect(res[0].v).toBe('25:00');
  });
});

describe('Field.time legacy storage: backfill and read-side repair (#3994)', () => {
  let driver: LegacyStorageDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  /** The mixed shapes an un-migrated column really holds. All 14:30 UTC except `t4`. */
  async function seedLegacy(d: LegacyStorageDriver) {
    await d.initObjects([SHIFT]);
    await d.seedLegacyTimeRows('shift', 'starts_at', [
      { id: 't1', label: 'a', starts_at: Date.UTC(2026, 0, 15, 14, 30, 0, 500) }, // INTEGER epoch
      { id: 't2', label: 'b', starts_at: '2026-01-15T14:30:00.500Z' },            // full ISO TEXT
      { id: 't3', label: 'c', starts_at: '2026-01-15 14:30:00' },                 // naive timestamp TEXT
      { id: 't4', label: 'd', starts_at: '08:00' },                               // minutes-only TEXT
      { id: 't5', label: 'e', starts_at: '14:30:00' },                            // already canonical
    ]);
  }

  it('window filters and distinct() are correct BEFORE any migration, via the repair expression', async () => {
    driver = make(LegacyStorageDriver);
    await seedLegacy(driver);

    const hits = await driver.find('shift', {
      object: 'shift',
      where: { starts_at: { $gte: '09:00:00', $lte: '18:00:00' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(hits.map((r: any) => r.id)).toEqual(['t1', 't2', 't3', 't5']);

    const values = await driver.distinct('shift', 'starts_at');
    expect(values.sort()).toEqual(['08:00:00', '14:30:00', '14:30:00.500']);
  });

  it('a fresh boot over the existing table backfills every row to canonical text', async () => {
    driver = make(LegacyStorageDriver);
    await seedLegacy(driver);

    // Second sync over the SAME database — the state of a real upgrade boot.
    await driver.initObjects([SHIFT]);

    const stored = await driver.storedForms('shift', 'starts_at');
    expect(stored.map((s) => [s.id, s.type, s.value])).toEqual([
      ['t1', 'text', '14:30:00.500'],
      ['t2', 'text', '14:30:00.500'],
      ['t3', 'text', '14:30:00'],
      ['t4', 'text', '08:00:00'],
      ['t5', 'text', '14:30:00'],
    ]);

    // Converged storage means the plain indexable comparison now works.
    const hits = await driver.find('shift', {
      object: 'shift',
      where: { starts_at: { $gte: '09:00:00', $lte: '18:00:00' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(hits.map((r: any) => r.id)).toEqual(['t1', 't2', 't3', 't5']);
  });

  it('the backfill is idempotent and leaves junk it cannot parse untouched', async () => {
    driver = make(LegacyStorageDriver);
    await driver.initObjects([SHIFT]);
    await driver.seedLegacyTimeRows('shift', 'starts_at', [
      { id: 'j1', label: 'x', starts_at: 'not-a-time' },
      { id: 'j2', label: 'y', starts_at: '14:30' },
    ]);

    await driver.initObjects([SHIFT]);
    const once = await driver.storedForms('shift', 'starts_at');
    await driver.initObjects([SHIFT]);
    const twice = await driver.storedForms('shift', 'starts_at');

    expect(once).toEqual(twice);
    const byId = Object.fromEntries(once.map((s) => [s.id, s.value]));
    expect(byId.j1).toBe('not-a-time'); // preserved, not NULLed or rewritten
    expect(byId.j2).toBe('14:30:00');
  });

  it('temporalFilterValue / temporalFilterColumnSql cover time fields (the #3979 contract pair)', async () => {
    driver = make(LegacyStorageDriver);
    await seedLegacy(driver);

    // Comparand side: every shape folds to the canonical time-of-day.
    expect(driver.temporalFilterValue('shift', 'starts_at', '2026-01-15T14:30:00.500Z')).toBe('14:30:00.500');
    expect(driver.temporalFilterValue('shift', 'starts_at', '14:30')).toBe('14:30:00');
    // Column side: an un-migrated column is wrapped…
    const wrapped = driver.temporalFilterColumnSql('shift', 'starts_at', '"shift"."starts_at"');
    expect(wrapped).toContain('typeof');
    expect(wrapped).toContain('%H:%M:%f');
    // …and a converged one is returned verbatim.
    await driver.initObjects([SHIFT]);
    expect(driver.temporalFilterColumnSql('shift', 'starts_at', '"shift"."starts_at"')).toBe('"shift"."starts_at"');
  });
});

describe('os migrate plan lists the time convergence (#3994, #3954 pattern)', () => {
  let driver: LegacyStorageDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  it('reports normalize_time_storage with columns and row count, without performing it', async () => {
    driver = make(LegacyStorageDriver);
    await driver.initObjects([SHIFT]);
    await driver.seedLegacyTimeRows('shift', 'starts_at', [
      { id: 'p1', label: 'a', starts_at: Date.UTC(2026, 0, 15, 14, 30, 0) },
      { id: 'p2', label: 'b', starts_at: '2026-01-15 14:30:00' },
      { id: 'p3', label: 'c', starts_at: '14:30:00' }, // already canonical — not counted
    ]);
    const before = await driver.storedForms('shift', 'starts_at');

    driver.setDeferredDdl(true);
    await driver.initObjects([SHIFT]);
    const pending = await driver.previewDeferredSchemaWork();

    const converge = pending.filter((p) => p.kind === 'normalize_time_storage');
    expect(converge).toHaveLength(1);
    expect(converge[0].table).toBe('shift');
    expect(converge[0].columns).toEqual(['starts_at']);
    expect(converge[0].rows).toBe(2);

    // plan measures, apply changes — previewing must not have run the backfill.
    expect(await driver.storedForms('shift', 'starts_at')).toEqual(before);
  });
});
