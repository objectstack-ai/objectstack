// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3954 — `os migrate plan` must list the datetime storage convergence.
 *
 * The datetime canonicalisation (#3912/#3942) added two steps to `initObjects`'
 * physical path: a row-rewriting backfill on SQLite and a column rebuild on
 * MySQL. Both correctly respect the DDL deferral, so `plan` performs neither and
 * `apply` performs both — the behaviour was never wrong.
 *
 * What was wrong is the reporting. `PendingSchemaWork` could only express
 * `create_table` / `add_columns`, so an operator saw a plan listing two added
 * columns, confirmed it, and `apply` additionally rewrote every row of a
 * datetime column. The plan promises to show what apply will do.
 *
 * These tests pin three things: the step is listed, it is measured, and it is
 * still not *performed* by the preview.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { LegacyStorageDriver } from './legacy-datetime-storage.testkit.js';

const EVT = {
  name: 'evt',
  fields: {
    label: { type: 'text' },
    at: { type: 'datetime' },
    seen_at: { type: 'datetime' },
  },
} as any;

const make = <T extends SqlDriver>(Ctor: new (cfg: any) => T): T =>
  new Ctor({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });

/** A database an older build wrote: legacy datetime forms, backfill not yet run. */
async function seedLegacyDatabase(driver: LegacyStorageDriver) {
  await driver.initObjects([EVT]);
  await driver.seedLegacyRows('evt', 'at', [
    { id: 'e1', label: 'a', at: Date.parse('2026-03-20T12:00:00.000Z'), seen_at: '2026-03-20T12:00:00.000Z' },
    { id: 'e2', label: 'b', at: '2026-03-20 13:00:00', seen_at: '2026-03-20T13:00:00.000Z' },
    { id: 'e3', label: 'c', at: '2026-03-20T14:00:00+08:00', seen_at: '2026-03-20T06:00:00.000Z' },
  ]);
  // `seen_at` was written canonical, so only `at` should be reported.
  driver.forgetCanonical('evt', 'seen_at');
}

describe('os migrate plan lists the datetime convergence (#3954)', () => {
  let driver: LegacyStorageDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  it('reports the pending backfill, naming the columns and the row count', async () => {
    driver = make(LegacyStorageDriver);
    await seedLegacyDatabase(driver);

    driver.setDeferredDdl(true);
    await driver.initObjects([EVT]);
    const pending = await driver.previewDeferredSchemaWork();

    const converge = pending.filter((p) => p.kind === 'normalize_datetime_storage');
    expect(converge).toHaveLength(1);
    expect(converge[0].table).toBe('evt');
    // Only the column that actually holds non-canonical rows.
    expect(converge[0].columns).toEqual(['at']);
    expect(converge[0].rows).toBe(3);
  });

  it('does not PERFORM the backfill while previewing it', async () => {
    driver = make(LegacyStorageDriver);
    await seedLegacyDatabase(driver);
    const before = await driver.storedForms('evt', 'at');

    driver.setDeferredDdl(true);
    await driver.initObjects([EVT]);
    await driver.previewDeferredSchemaWork();

    // The whole point of the deferral: plan measures, apply changes.
    expect(await driver.storedForms('evt', 'at')).toEqual(before);
  });

  it('flushing the deferral converges the rows the plan named', async () => {
    driver = make(LegacyStorageDriver);
    await seedLegacyDatabase(driver);

    driver.setDeferredDdl(true);
    await driver.initObjects([EVT]);
    const planned = await driver.previewDeferredSchemaWork();
    expect(planned.some((p) => p.kind === 'normalize_datetime_storage')).toBe(true);

    await driver.flushDeferredSchemaDdl();

    for (const row of await driver.storedForms('evt', 'at')) {
      expect(String(row.value)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    // And re-planning now finds nothing left to converge.
    driver.setDeferredDdl(true);
    await driver.initObjects([EVT]);
    const after = await driver.previewDeferredSchemaWork();
    expect(after.filter((p) => p.kind === 'normalize_datetime_storage')).toEqual([]);
  });

  it('reports nothing for a database that is already canonical', async () => {
    driver = make(LegacyStorageDriver);
    await driver.initObjects([EVT]);
    await driver.create('evt', { id: 'ok', label: 'ok', at: '2026-03-20T12:00:00.000Z' }, { bypassTenantAudit: true });

    driver.setDeferredDdl(true);
    await driver.initObjects([EVT]);
    expect(await driver.previewDeferredSchemaWork()).toEqual([]);
  });

  it('reports nothing for a table that does not exist yet — it is created empty', async () => {
    driver = make(LegacyStorageDriver);
    driver.setDeferredDdl(true);
    await driver.initObjects([EVT]);

    const pending = await driver.previewDeferredSchemaWork();
    expect(pending.map((p) => p.kind)).toEqual(['create_table']);
  });

  it('reports the convergence ALONGSIDE an add_columns on the same table', async () => {
    // The combination the gap was worst in: a plan that lists one added column
    // while apply also rewrites the table.
    driver = make(LegacyStorageDriver);
    await seedLegacyDatabase(driver);

    const widened = { ...EVT, fields: { ...EVT.fields, note: { type: 'text' } } };
    driver.setDeferredDdl(true);
    await driver.initObjects([widened]);
    const pending = await driver.previewDeferredSchemaWork();

    expect(pending.map((p) => p.kind).sort()).toEqual(['add_columns', 'normalize_datetime_storage']);
    expect(pending.find((p) => p.kind === 'add_columns')!.columns).toEqual(['note']);
  });

  it('survives a probe that cannot run, rather than failing the plan', async () => {
    // Same posture as the migrations themselves, which log and swallow: a probe
    // that cannot run costs an UNLISTED step, while throwing would cost the whole
    // plan — including the create/add entries that have nothing to do with it.
    class BrokenProbe extends LegacyStorageDriver {
      protected override sqliteCanonicalDatetimeSql(): string {
        throw new Error('probe exploded');
      }
    }
    const broken = make(BrokenProbe);
    try {
      await seedLegacyDatabase(broken);
      broken.setDeferredDdl(true);
      await broken.initObjects([{ ...EVT, fields: { ...EVT.fields, note: { type: 'text' } } }]);

      const pending = await broken.previewDeferredSchemaWork();
      expect(pending.map((p) => p.kind)).toEqual(['add_columns']);
    } finally {
      await broken.disconnect();
    }
    driver = make(LegacyStorageDriver); // satisfy afterEach
  });
});
