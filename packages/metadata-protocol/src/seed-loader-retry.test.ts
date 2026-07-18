// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

/**
 * framework#3150: the self-referencing seed path (`hasSelfRef`) writes records
 * sequentially via `writeRecord`, which — unlike the batched path (bulkWrite's
 * internal retry) and the update path — used to call `engine.insert` bare. A
 * single transient blip (`fetch failed`) therefore dropped the row with no
 * retry. These tests pin the now-wrapped behaviour.
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
          Object.entries(query.where).every(([k, v]) => r[k] === v),
        );
      }
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
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
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) { records[idx] = { ...records[idx], ...data }; return records[idx]; }
      return data;
    }),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

// A self-referencing object: `manager` is a lookup back to the same object, so
// the loader takes the historical sequential `writeRecord` path (`hasSelfRef`).
function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    my_app_employee: {
      name: 'my_app_employee',
      fields: {
        name: { type: 'text' },
        manager: { type: 'lookup', reference: 'my_app_employee' },
      },
    },
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
  defaultMode: 'insert',
  batchSize: 1000,
  transaction: false,
} as any;

const SEEDS = [
  {
    object: 'my_app_employee',
    externalId: 'name',
    mode: 'insert',
    env: ['prod', 'dev', 'test'],
    records: [{ name: 'Alice' }, { name: 'Bob' }],
  },
] as any[];

describe('seed self-ref sequential path — transient retry (framework#3150)', () => {
  it('retries a transient insert on the self-referencing path instead of dropping the row', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // Bob's first insert hits a network blip, then succeeds on retry.
    const realInsert = (engine.insert as any).getMockImplementation();
    let bobAttempts = 0;
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'my_app_employee' && !Array.isArray(data) && data.name === 'Bob') {
        bobAttempts++;
        if (bobAttempts === 1) throw new Error('fetch failed');
      }
      return realInsert(obj, data, opts);
    });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    expect(bobAttempts).toBe(2); // first threw, retried, succeeded
    expect(result.summary.totalErrored).toBe(0);
    expect((store.my_app_employee ?? []).map((r) => r.name).sort()).toEqual(['Alice', 'Bob']);
  });
});
