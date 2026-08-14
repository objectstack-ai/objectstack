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
          Object.entries(query.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
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
    // A plain object (no self-ref) → the batched flushPendingInserts path.
    my_app_widget: {
      name: 'my_app_widget',
      fields: {
        name: { type: 'text' },
        sku: { type: 'text' },
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

describe('seed batched path — idempotent retry after commit-then-lost-response (framework#3149)', () => {
  it('does not duplicate rows when the batch insert commits but its response is lost', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // First array insert writes both rows to the store, then throws a transient
    // error (turso's commit-then-lost-response shape). The retry must recheck
    // by externalId and NOT insert them again.
    const realInsert = (engine.insert as any).getMockImplementation();
    let arrayInsertCalls = 0;
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'my_app_widget' && Array.isArray(data)) {
        arrayInsertCalls++;
        if (arrayInsertCalls === 1) {
          await realInsert(obj, data, opts); // commit lands
          throw new Error('fetch failed');   // ...but the response is lost
        }
      }
      return realInsert(obj, data, opts);
    });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [{
        object: 'my_app_widget',
        externalId: 'sku',
        mode: 'insert',
        env: ['prod', 'dev', 'test'],
        records: [{ name: 'Widget A', sku: 'W-A' }, { name: 'Widget B', sku: 'W-B' }],
      }] as any,
      config: CONFIG,
    });

    // The array insert ran once (attempt 1, which committed); the retry's
    // recheck found both rows already present and did NOT re-insert.
    expect(arrayInsertCalls).toBe(1);
    expect(store.my_app_widget.filter((r) => r.sku === 'W-A')).toHaveLength(1);
    expect(store.my_app_widget.filter((r) => r.sku === 'W-B')).toHaveLength(1);
    expect(store.my_app_widget).toHaveLength(2); // no duplicates
    expect(result.summary.totalErrored).toBe(0);
  });
});

describe('seed batched path — partial-success engine (framework#3172)', () => {
  it('a bad row is a per-row verdict: good rows insert once, no degradation re-run', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // Engine with insertMany (partial success): the bad row comes back as a
    // per-row error, good rows as records — one call, no thrown batch error.
    let insertManyCalls = 0;
    (engine as any).insertMany = vi.fn(async (obj: string, rows: any[], opts: any) => {
      insertManyCalls++;
      const outcomes = [];
      for (const r of rows) {
        if (r.sku === 'BAD') {
          outcomes.push({ ok: false, error: new Error('validation failed: bad widget') });
        } else {
          outcomes.push({ ok: true, record: await (engine.insert as any)(obj, r, opts) });
        }
      }
      return outcomes;
    });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [{
        object: 'my_app_widget',
        externalId: 'sku',
        mode: 'insert',
        env: ['prod', 'dev', 'test'],
        records: [
          { name: 'Good A', sku: 'W-A' },
          { name: 'Bad', sku: 'BAD' },
          { name: 'Good B', sku: 'W-B' },
        ],
      }] as any,
      config: CONFIG,
    });

    expect(insertManyCalls).toBe(1);
    expect(result.summary.totalInserted).toBe(2);
    expect(result.summary.totalErrored).toBe(1);
    expect(store.my_app_widget.map((r: any) => r.sku).sort()).toEqual(['W-A', 'W-B']);
    // The good rows were written exactly once — no whole-batch degradation
    // re-ran them through engine.insert (single-row form).
    const singleInsertCalls = (engine.insert as any).mock.calls.filter(
      ([obj, data]: [string, any]) => obj === 'my_app_widget' && !Array.isArray(data),
    );
    expect(singleInsertCalls).toHaveLength(2); // only the two calls made INSIDE insertMany's mock
  });
});

// The RECOVERY pinned here is framework#3147's and is unchanged: the rows were
// written, so re-writing them would duplicate. Its loudness is not — a stale
// roll-up column is persisted data disagreeing with its detail rows, so the
// seam logs at `error` and counts into `summariesStale` (framework#4998, pinned
// in seed-loader-summary-stale.test.ts). It is still not a WRITE error, which
// is what `totalErrored: 0` below says.
describe('seed batched path — a recompute failure is recovered, not re-written (framework#3147)', () => {
  it('records the rows as inserted (not errored) and does not re-insert on ERR_SUMMARY_RECOMPUTE', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // The array insert writes the rows, then reports a post-write summary
    // recompute failure — the records ARE written (carried on `written`).
    const realInsert = (engine.insert as any).getMockImplementation();
    let arrayCalls = 0;
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'my_app_widget' && Array.isArray(data)) {
        arrayCalls++;
        const written = await realInsert(obj, data, opts);
        throw Object.assign(new Error('summary recompute failed'), {
          code: 'ERR_SUMMARY_RECOMPUTE', written, failures: [{ parentObject: 'x' }],
        });
      }
      return realInsert(obj, data, opts);
    });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [{
        object: 'my_app_widget',
        externalId: 'sku',
        mode: 'insert',
        env: ['prod', 'dev', 'test'],
        records: [{ name: 'A', sku: 'W-A' }, { name: 'B', sku: 'W-B' }],
      }] as any,
      config: CONFIG,
    });

    expect(arrayCalls).toBe(1);              // recovered, NOT re-inserted
    expect(store.my_app_widget).toHaveLength(2); // no duplicates
    expect(result.summary.totalErrored).toBe(0); // a stale summary is not a write error
  });
});
