// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { SeedLoadResultSchema } from '@objectstack/spec/data';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * #23354 — `SeedLoadResult.landedIds`: the rows each dataset landed on.
 *
 * The seed-ownership claim (ADR-0138 D1) may hand to the platform admin only
 * the unowned rows the SEED wrote: a guest-written row and a public form's
 * intake keep no owner, and no stored column tells them from a seed row. The
 * loader is the one place that knows which rows its records resolved to — it
 * matches natural keys, resolves references to the target's id first, and
 * re-identifies rows per organization — so it publishes the answer instead of
 * a reader re-deriving it from the dataset.
 *
 * What the claim depends on, pinned here:
 *
 *  - the insert path reports the ids it wrote;
 *  - a REPLAY reports the rows an earlier load wrote, on the skip path and on
 *    the update path alike — that is what keeps the claim correct on every
 *    later boot;
 *  - a dataset keyed on a REFERENCE reports the matched row: the stored key is
 *    the resolved id, never the dataset's own value, which is exactly what a
 *    reader copying the dataset would get wrong;
 *  - a row the load did not land (a refused insert) and a dry run report none.
 *
 * The engine is a faithful in-memory double (`where` filters, ids minted on
 * insert), the same shape `seed-loader-replay.test.ts` drives; the loader is
 * the real one.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createFaithfulEngine(opts: { refuseInsert?: (object: string, row: any) => boolean } = {}) {
  const store: Record<string, any[]> = {};
  let idCounter = 0;
  const mint = (object: string, d: any) => {
    if (opts.refuseInsert?.(object, d)) {
      throw Object.assign(new Error('Validation failed: name is reserved'), { code: 'VALIDATION_FAILED', status: 400 });
    }
    return { id: `gen-${++idCounter}`, ...d };
  };

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return r[k] === v;
          }),
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
        const records = data.map((d) => mint(objectName, d));
        store[objectName].push(...records);
        return records;
      }
      const record = mint(objectName, data);
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

function createMetadata(extra: Record<string, any> = {}): IMetadataService {
  const objects: Record<string, any> = {
    ...extra,
    lid_team: { name: 'lid_team', fields: { name: { type: 'text' } } },
    lid_case: { name: 'lid_case', fields: { name: { type: 'text' }, status: { type: 'text' } } },
    // A junction keyed on its REFERENCE: the stored `team` is the resolved
    // team id, never the dataset's natural key.
    lid_membership: {
      name: 'lid_membership',
      fields: {
        team: { type: 'lookup', reference: 'lid_team', required: true },
        role: { type: 'text' },
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

// An upsert config, multi-pass on: how a dataset that declares no mode replays
// here. (The AppPlugin request itself sets no mode since #30081 — a parsed dataset
// carries its own, `ignore` when it declares none.)
const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

const SEEDS = [
  {
    object: 'lid_team',
    externalId: 'name',
    mode: 'upsert',
    records: [{ name: 'Experience' }, { name: 'Platform' }],
  },
  {
    object: 'lid_case',
    externalId: 'name',
    mode: 'upsert',
    records: [
      { name: 'CASE-1', status: 'open' },
      { name: 'CASE-2', status: 'open' },
    ],
  },
  {
    object: 'lid_membership',
    externalId: 'team',
    mode: 'upsert',
    records: [{ team: 'Experience', role: 'lead' }],
  },
] as any[];

function landed(result: { results: Array<{ object: string; landedIds: string[] }> }, object: string): string[] {
  return result.results.filter((r) => r.object === object).flatMap((r) => r.landedIds);
}

const idsOf = (rows: any[] | undefined) => (rows ?? []).map((r) => r.id);

describe('SeedLoadResult.landedIds — the rows a seed landed on (#23354)', () => {
  it('the insert path reports the ids it wrote, per dataset, in record order', async () => {
    const { engine, store } = createFaithfulEngine();
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: SEEDS, config: CONFIG });

    expect(result.success).toBe(true);
    expect(landed(result, 'lid_team')).toEqual(idsOf(store.lid_team));
    expect(landed(result, 'lid_case')).toEqual(idsOf(store.lid_case));
    expect(landed(result, 'lid_membership')).toEqual(idsOf(store.lid_membership));
    expect(landed(result, 'lid_case')).toHaveLength(2);
    // The published shape is the spec's: it parses, and the field survives.
    for (const r of result.results) expect(SeedLoadResultSchema.parse(r).landedIds).toEqual(r.landedIds);
  });

  it('a replay of an unchanged seed reports the rows the FIRST load wrote (skip path)', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    const firstIds = { team: idsOf(store.lid_team), cases: idsOf(store.lid_case), membership: idsOf(store.lid_membership) };

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });

    // Positive control: this really was the skip path, nothing written.
    expect(replay.summary.totalInserted).toBe(0);
    expect(replay.summary.totalUpdated).toBe(0);
    expect(replay.summary.totalSkipped).toBe(5);
    expect(landed(replay, 'lid_team')).toEqual(firstIds.team);
    expect(landed(replay, 'lid_case')).toEqual(firstIds.cases);
    expect(landed(replay, 'lid_membership')).toEqual(firstIds.membership);
  });

  it('a replay that updates the rows reports them too (update path)', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    for (const row of store.lid_case) row.status = 'edited at runtime';

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });

    expect(replay.results.find((r) => r.object === 'lid_case')!.updated).toBe(2);
    expect(landed(replay, 'lid_case')).toEqual(idsOf(store.lid_case));
  });

  it('a dataset keyed on a reference reports the matched row, whose stored key is the resolved id', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    const experienceId = store.lid_team.find((r) => r.name === 'Experience')!.id;
    const membership = store.lid_membership[0];
    // The trap a reader copying the dataset falls into: the stored key is NOT
    // the dataset's value.
    expect(membership.team).toBe(experienceId);
    expect(membership.team).not.toBe('Experience');

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });

    expect(replay.results.find((r) => r.object === 'lid_membership')!.skipped).toBe(1);
    expect(landed(replay, 'lid_membership')).toEqual([membership.id]);
  });

  it('a row that is not in the seed is never reported, even when it shares the object', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    // Written by someone else between boots — a guest, a form door, a user.
    store.lid_case.push({ id: 'guest-row', name: 'Guest enquiry', status: 'new' });

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });

    expect(landed(replay, 'lid_case')).not.toContain('guest-row');
    expect(landed(replay, 'lid_case')).toHaveLength(2);
  });

  it('a refused insert lands no row, so it reports no id', async () => {
    const { engine, store } = createFaithfulEngine({ refuseInsert: (o, row) => o === 'lid_case' && row.name === 'CASE-2' });
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: SEEDS, config: CONFIG });

    expect(result.results.find((r) => r.object === 'lid_case')!.errored).toBe(1);
    expect(store.lid_case.map((r) => r.name)).toEqual(['CASE-1']);
    expect(landed(result, 'lid_case')).toEqual(idsOf(store.lid_case));
  });

  it('two records that resolve to one row report it once', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    const doubled = [{
      object: 'lid_case',
      externalId: 'name',
      mode: 'upsert',
      records: [{ name: 'CASE-1', status: 'open' }, { name: 'CASE-1', status: 'open' }],
    }] as any[];

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: doubled, config: CONFIG });

    const case1 = store.lid_case.find((r) => r.name === 'CASE-1')!.id;
    expect(landed(replay, 'lid_case')).toEqual([case1]);
  });

  it('a dry run writes nothing and reports nothing', async () => {
    const { engine, store } = createFaithfulEngine();
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: SEEDS,
      config: { ...CONFIG, dryRun: true },
    });

    // Positive control: the dry run did count the would-be inserts.
    expect(result.summary.totalInserted).toBe(5);
    expect(store.lid_case).toBeUndefined();
    for (const r of result.results) expect(r.landedIds).toEqual([]);
  });
});

/**
 * #30348 — `SeedLoadResult.insertedIds`: which of the landed rows THIS load
 * created. A landed id is either a row an insert created or a pre-existing
 * row a record's key matched (updated, left as it was, or refused an update);
 * the publish receipt splits them so a reader clears only the seed's own rows,
 * never a customer's row that happens to share the seed's natural key.
 */
describe('SeedLoadResult.insertedIds — the landed rows this load created (#30348)', () => {
  const inserted = (result: { results: Array<{ object: string; insertedIds?: string[] }> }, object: string): string[] =>
    result.results.filter((r) => r.object === object).flatMap((r) => r.insertedIds ?? []);

  it('a fresh load created every row it landed on: insertedIds equals landedIds, and the spec parse keeps it', async () => {
    const { engine, store } = createFaithfulEngine();
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: SEEDS, config: CONFIG });

    expect(result.success).toBe(true);
    for (const object of ['lid_team', 'lid_case', 'lid_membership']) {
      expect(inserted(result, object)).toEqual(idsOf(store[object]));
      expect(inserted(result, object)).toEqual(landed(result, object));
    }
    for (const r of result.results) expect(SeedLoadResultSchema.parse(r).insertedIds).toEqual(r.insertedIds);
  });

  it('a replay that skips or updates created nothing: every landed id is matched, none inserted', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    for (const row of store.lid_case) row.status = 'edited at runtime';

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });

    // Positive control: both paths ran — cases updated, teams skipped.
    expect(replay.results.find((r) => r.object === 'lid_case')!.updated).toBe(2);
    expect(replay.results.find((r) => r.object === 'lid_team')!.skipped).toBe(2);
    expect(landed(replay, 'lid_case')).toEqual(idsOf(store.lid_case));
    expect(landed(replay, 'lid_team')).toEqual(idsOf(store.lid_team));
    for (const r of replay.results) expect(r.insertedIds).toEqual([]);
  });

  it('under `ignore`, a pre-existing row the key matched is landed but NOT inserted; a fresh record is inserted', async () => {
    const { engine, store } = createFaithfulEngine();
    // A customer's own row, written before any seed, sharing the seed's key.
    store.lid_case = [{ id: 'customer-row', name: 'CASE-1', status: 'customer edit' }];
    const seeds = [{
      object: 'lid_case',
      externalId: 'name',
      mode: 'ignore',
      records: [{ name: 'CASE-1', status: 'open' }, { name: 'CASE-2', status: 'open' }],
    }] as any[];

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds, config: CONFIG });

    const case2 = store.lid_case.find((r) => r.name === 'CASE-2')!.id;
    // Positive control: `ignore` left the customer's row as it was.
    expect(store.lid_case.find((r) => r.id === 'customer-row')!.status).toBe('customer edit');
    expect(landed(result, 'lid_case')).toEqual(['customer-row', case2]);
    expect(inserted(result, 'lid_case')).toEqual([case2]);
  });

  it('a matched row whose update the engine refused is landed but not inserted', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    for (const row of store.lid_case) row.status = 'edited at runtime';
    (engine.update as any).mockImplementation(async () => {
      throw Object.assign(new Error('Validation failed: transition refused'), { code: 'VALIDATION_FAILED', status: 400 });
    });

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });

    expect(replay.results.find((r) => r.object === 'lid_case')!.errored).toBe(2);
    expect(landed(replay, 'lid_case')).toEqual(idsOf(store.lid_case));
    expect(inserted(replay, 'lid_case')).toEqual([]);
  });

  it('the self-referencing (sequential) write path reports its inserts too', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata({
      lid_node: { name: 'lid_node', fields: { name: { type: 'text' }, parent: { type: 'lookup', reference: 'lid_node' } } },
    });
    const seeds = [{
      object: 'lid_node',
      externalId: 'name',
      mode: 'upsert',
      records: [{ name: 'root' }, { name: 'leaf', parent: 'root' }],
    }] as any[];

    const first = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds, config: CONFIG });
    expect(first.success).toBe(true);
    expect(inserted(first, 'lid_node')).toEqual(idsOf(store.lid_node));
    expect(inserted(first, 'lid_node')).toHaveLength(2);

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds, config: CONFIG });
    expect(landed(replay, 'lid_node')).toEqual(idsOf(store.lid_node));
    expect(inserted(replay, 'lid_node')).toEqual([]);
  });

  it('a refused insert and a dry run create nothing', async () => {
    const { engine, store } = createFaithfulEngine({ refuseInsert: (o, row) => o === 'lid_case' && row.name === 'CASE-2' });
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: SEEDS, config: CONFIG });
    expect(inserted(result, 'lid_case')).toEqual(idsOf(store.lid_case));
    expect(inserted(result, 'lid_case')).toHaveLength(1);

    const dry = createFaithfulEngine();
    const dryRun = await new SeedLoaderService(dry.engine, createMetadata(), createLogger()).load({
      seeds: SEEDS,
      config: { ...CONFIG, dryRun: true },
    });
    for (const r of dryRun.results) expect(r.insertedIds).toEqual([]);
  });
});
