// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { isDataMigrationVerified } from '@objectstack/platform-objects/system';
import {
  runFilesToReferencesMigration,
  type FilesToReferencesEngine,
} from './files-to-references-migration.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const MIGRATION = 'adr-0104-file-references';

const REGISTRY: Record<string, any> = {
  sys_file: { fields: { id: { type: 'text' } } },
  sys_migration: { fields: { id: { type: 'text' } } },
  product: {
    fields: {
      id: { type: 'text' },
      name: { type: 'text' },
      image: { type: 'image' },
    },
  },
};

function fakeEngine(tables: Record<string, Array<Record<string, unknown>>>) {
  tables.sys_migration ??= [];
  const engine: FilesToReferencesEngine & { tables: typeof tables } = {
    getObject: (name) => REGISTRY[name],
    getConfigs: () => REGISTRY,
    async find(object, options: any) {
      let rows = tables[object] ?? [];
      const id = options?.where?.id;
      if (typeof id === 'string') rows = rows.filter((r) => r.id === id);
      const start = typeof options?.offset === 'number' ? options.offset : 0;
      const end = typeof options?.limit === 'number' ? start + options.limit : undefined;
      return rows.slice(start, end);
    },
    async insert(object, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object, data: any) {
      const row = (tables[object] ?? []).find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row;
    },
    tables,
  };
  return engine;
}

const run = (engine: any, opts: any = {}) =>
  runFilesToReferencesMigration(engine, () => null, silentLogger(), opts);

describe('runFilesToReferencesMigration (#3617)', () => {
  it('dry run writes NOTHING — no conversions, no flag — even when the gate would pass', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'f1' }],
      sys_file: [{ id: 'f1', ref_object: 'product', ref_id: 'p1', ref_field: 'image', status: 'committed' }],
    });

    const result = await run(engine);

    expect(result.gatePassed).toBe(true);
    expect(result.flag).toBeNull();
    expect(engine.tables.sys_migration).toHaveLength(0);
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  it('apply + clean reconciliation records a verified flag — the gate opens', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: '/api/v1/storage/files/f1' }],
      sys_file: [{ id: 'f1', status: 'committed' }],
    });
    // The live claim hooks are what record ownership after a rewrite; this
    // fake engine has none, so pre-claim the file the way the hook would.
    engine.tables.sys_file[0] = {
      ...engine.tables.sys_file[0],
      ref_object: 'product',
      ref_id: 'p1',
      ref_field: 'image',
    };

    const result = await run(engine, { apply: true });

    expect(engine.tables.product[0].image).toBe('f1'); // converted
    expect(result.backfill.converted).toBe(1);
    expect(result.gatePassed).toBe(true);
    expect(result.flag?.verified_at).toBeTruthy();
    expect(result.flag?.blocking).toBe(0);
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(true);
  });

  it('apply with a blocking discrepancy records the failure and the gate stays closed', async () => {
    // p1 holds f1, but no sys_file owner is recorded → unowned_reference.
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'f1' }],
      sys_file: [{ id: 'f1', status: 'committed' }],
    });

    const result = await run(engine, { apply: true });

    expect(result.gatePassed).toBe(false);
    expect(result.gateFailures.join(' ')).toMatch(/blocking/);
    expect(result.verify.counts.unowned_reference).toBe(1);
    expect(result.flag?.verified_at).toBeNull();
    expect(result.flag?.blocking).toBe(1);
    expect(engine.tables.sys_migration).toHaveLength(1);
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  it('a regression after a verified run closes the gate again', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'f1' }],
      sys_file: [{ id: 'f1', ref_object: 'product', ref_id: 'p1', ref_field: 'image', status: 'committed' }],
    });
    await run(engine, { apply: true });
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(true);

    // Something later strips the ownership row — reality and ledger diverge.
    delete engine.tables.sys_file[0].ref_object;
    delete engine.tables.sys_file[0].ref_id;
    await run(engine, { apply: true });

    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  it('a truncated scan fails the gate even with zero blocking findings', async () => {
    // The backfill reads 200-row pages and only re-checks its bound between
    // FULL pages, so >200 rows are needed for the bound to actually bite.
    const engine = fakeEngine({
      product: Array.from({ length: 201 }, (_, i) => ({ id: `p${i}`, image: null })),
      sys_file: [],
    });

    const result = await run(engine, { apply: true, maxRecordsPerObject: 100 });

    expect(result.verify.blocking).toBe(0);
    expect(result.gatePassed).toBe(false);
    expect(result.gateFailures.join(' ')).toMatch(/truncated/);
    expect(result.flag?.verified_at).toBeNull();
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  it('external URLs are advisory: reported on the flag, never blocking the gate', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'https://cdn.example.com/logo.png' }],
      sys_file: [],
    });

    const result = await run(engine, { apply: true });

    expect(result.backfill.externalUrls).toBe(1);
    expect(engine.tables.product[0].image).toBe('https://cdn.example.com/logo.png'); // untouched
    expect(result.gatePassed).toBe(true);
    expect(result.flag?.advisory).toBe(1);
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(true);
  });
});
