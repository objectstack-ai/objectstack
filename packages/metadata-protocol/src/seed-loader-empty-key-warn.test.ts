// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [#28952] A keyed dataset whose every record keys empty.
 *
 * The save door and the publish promotion refuse a seed whose `externalId`
 * names no field of its object (`protocol.seed-external-id-refusal.test.ts`).
 * The boot loader never refuses: a stored seed must not fail a boot. What it
 * owes instead is one `warn` per dataset when no record carries a value for
 * the key, because such a load can match no existing row. Its writes are
 * unchanged, and that is pinned here too: replayed, such a dataset inserts
 * every record again (`upsert`), which is the duplication the doors now stop
 * at authoring.
 *
 * Uses the faithful engine of `seed-loader-composite-external-id.test.ts`
 * (filters `where`, mints ids), kept local.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createFaithfulEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
        );
      }
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      assertEngineFindOnePredicate(objectName, query);
      const rows = await (engine.find as any)(objectName, { ...query, limit: 1 });
      return rows[0] ?? null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      if (Array.isArray(data)) {
        const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...d }));
        store[objectName].push(...records);
        return records;
      }
      const record = { id: `gen-${++idCounter}`, ...data };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      assertEngineUpdateDispatch(data, undefined);
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    demo_other: { name: 'demo_other', fields: { name: { type: 'text' }, code: { type: 'text' } } },
  };
  return {
    getObject: vi.fn(async (name: string) => objects[name]),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => objects[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
  organizationId: 'org_demo',
} as any;

const dataset = (externalId: string | string[], mode = 'upsert', records: Record<string, unknown>[] = [{ name: 'G1', code: 'g' }]) =>
  ({ object: 'demo_other', externalId, mode, env: ['prod', 'dev', 'test'], records });

/** The loader's empty-key warnings, by their message. */
const emptyKeyWarnings = (logger: ReturnType<typeof createLogger>) =>
  logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('no record carries a value for it'));

describe('[#28952] the boot loader — a keyed dataset whose every record keys empty', () => {
  it('warns once per dataset, naming the object and the key, and never refuses; a replay inserts every record again', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    const seeds = [dataset('no_such_field')] as any[];

    const logger = createLogger();
    const first = await new SeedLoaderService(engine, metadata, logger).load({ seeds, config: CONFIG });
    expect(first.success).toBe(true);
    expect(first.results[0]).toMatchObject({ object: 'demo_other', inserted: 1 });
    const warned = emptyKeyWarnings(logger);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("Seed dataset for 'demo_other' keys every record on externalId 'no_such_field'");

    // The replay a boot makes of the same stored seed: unchanged writes, so
    // the row is inserted again. The doors refuse such a seed at authoring.
    const replayLogger = createLogger();
    const second = await new SeedLoaderService(engine, metadata, replayLogger).load({ seeds, config: CONFIG });
    expect(second.success).toBe(true);
    expect(second.results[0]).toMatchObject({ inserted: 1, updated: 0 });
    expect(store.demo_other).toHaveLength(2);
    expect(emptyKeyWarnings(replayLogger)).toHaveLength(1);
  });

  it('a composite key with a member no record carries warns the same way', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [dataset(['code', 'no_such_field'], 'ignore')] as any[], config: CONFIG,
    });
    const warned = emptyKeyWarnings(logger);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("externalId 'code+no_such_field'");
  });

  it('control: a declared key converges on replay and warns nothing', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    const seeds = [dataset('name')] as any[];

    const logger = createLogger();
    const first = await new SeedLoaderService(engine, metadata, logger).load({ seeds, config: CONFIG });
    expect(first.results[0]).toMatchObject({ inserted: 1 });
    const second = await new SeedLoaderService(engine, metadata, logger).load({ seeds, config: CONFIG });
    expect(second.results[0]).toMatchObject({ inserted: 0, updated: 0 });
    expect(store.demo_other).toHaveLength(1);
    expect(emptyKeyWarnings(logger)).toEqual([]);
  });

  it('control: an `insert` dataset never matches, so it is not warned about', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [dataset('no_such_field', 'insert')] as any[], config: CONFIG,
    });
    expect(emptyKeyWarnings(logger)).toEqual([]);
  });

  it('control: a dataset where some record carries the key is not warned about', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [dataset('code', 'upsert', [{ name: 'A', code: 'a' }, { name: 'B' }])] as any[], config: CONFIG,
    });
    expect(emptyKeyWarnings(logger)).toEqual([]);
  });
});
