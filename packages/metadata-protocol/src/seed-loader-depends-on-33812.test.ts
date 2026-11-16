// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/**
 * `Seed.dependsOn` — a dataset declares the seeded objects its insert-time
 * lifecycle hook reads, and the loader orders it after them.
 *
 * Before the key existed, a dataset's place in the load came from lookup /
 * master_detail / user edges alone; authored order only broke ties inside the
 * Kahn queue. A dataset whose `beforeInsert` hook READS another seeded object
 * had no way to say so, so its hook ran against whatever that object happened
 * to hold — here, a rating scored against bands that had not landed yet.
 *
 * The fixture is the reported shape: `customer_rating` looks up `rating_rule`
 * only, and `rating_band` sits two master_detail hops below the rule, so the
 * rating is ready one wave before the bands. The fake engine plays the hook:
 * every `customer_rating` row is stamped, at insert time, with the number of
 * `rating_band` rows the store holds at that moment.
 *
 * What the ruling binds, each pinned below:
 *   - `dependsOn` names objects; each name is an edge in the same graph the
 *     lookups feed, so the declaring dataset lands after the named object.
 *   - An app that declares no `dependsOn` keeps today's order exactly.
 *   - A declared edge that closes a cycle refuses the load, and so does a name
 *     that is not a seeded object of the same load. A refused load writes no
 *     row. A cycle of lookup edges alone keeps today's deferred passes.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createEngine() {
  const store: Record<string, any[]> = {};
  const insertOrder: string[] = [];
  let idCounter = 0;

  /** The "hook": a rating is scored against the bands present when it is inserted. */
  const stamp = (objectName: string, row: any) =>
    objectName === 'customer_rating' ? { ...row, bands_seen: (store.rating_band ?? []).length } : row;

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
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      insertOrder.push(objectName);
      if (Array.isArray(data)) {
        const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...stamp(objectName, d) }));
        store[objectName].push(...records);
        return records;
      }
      const record = { id: `gen-${++idCounter}`, ...stamp(objectName, data) };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (_o: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store, insertOrder };
}

const OBJECTS: Record<string, any> = {
  rating_rule: { name: 'rating_rule', fields: { name: { type: 'text' } } },
  rating_item: { name: 'rating_item', fields: { name: { type: 'text' }, rule: { type: 'master_detail', reference: 'rating_rule' } } },
  rating_band: { name: 'rating_band', fields: { name: { type: 'text' }, item: { type: 'master_detail', reference: 'rating_item' } } },
  customer_rating: {
    name: 'customer_rating',
    fields: { name: { type: 'text' }, rule: { type: 'lookup', reference: 'rating_rule' }, bands_seen: { type: 'number' } },
  },
  // A lookup cycle of its own (x ↔ y), and an object hanging off it.
  cyc_x: { name: 'cyc_x', fields: { name: { type: 'text' }, y: { type: 'lookup', reference: 'cyc_y' } } },
  cyc_y: { name: 'cyc_y', fields: { name: { type: 'text' }, x: { type: 'lookup', reference: 'cyc_x' } } },
  cyc_child: { name: 'cyc_child', fields: { name: { type: 'text' }, x: { type: 'lookup', reference: 'cyc_x' } } },
  cyc_reader: { name: 'cyc_reader', fields: { name: { type: 'text' } } },
};

function createMetadata(): IMetadataService {
  return {
    getObject: vi.fn(async (name: string) => OBJECTS[name]),
    listObjects: vi.fn(async () => Object.values(OBJECTS)),
    register: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const BASE_CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
  env: 'prod',
} as any;

const ds = (object: string, records: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  object,
  externalId: 'name',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records,
  ...extra,
});

/** The reported book: the bands authored BEFORE the ratings, which was never enough. */
const book = (ratingExtra: Record<string, unknown> = {}) => [
  ds('rating_rule', [{ name: 'R1' }]),
  ds('rating_item', [{ name: 'I1', rule: 'R1' }]),
  ds('rating_band', [{ name: 'B1', item: 'I1' }, { name: 'B2', item: 'I1' }]),
  ds('customer_rating', [{ name: 'C1', rule: 'R1' }], ratingExtra),
];

async function run(seeds: any[], config: Record<string, unknown> = {}) {
  const { engine, store, insertOrder } = createEngine();
  const logger = createLogger();
  const loader = new SeedLoaderService(engine, createMetadata(), logger as any);
  const result = await loader.load({ seeds, config: { ...BASE_CONFIG, ...config } } as any);
  return { result, store, insertOrder, logger, engine };
}

describe('Seed.dependsOn orders a dataset after the objects its hook reads', () => {
  it('the card: a rating declaring dependsOn its bands is inserted after them, and its hook sees them', async () => {
    const { result, store, insertOrder } = await run(book({ dependsOn: ['rating_band'] }));

    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(insertOrder.indexOf('rating_band')).toBeLessThan(insertOrder.indexOf('customer_rating'));
    expect(store.customer_rating?.[0]?.bands_seen).toBe(2);
    // The declared edge is in the graph the lookups feed.
    const node = result.dependencyGraph.nodes.find((n) => n.object === 'customer_rating');
    expect(node?.dependsOn).toEqual(expect.arrayContaining(['rating_rule', 'rating_band']));
  });

  it('control: with no dependsOn the load keeps today\'s order exactly — the rating lands a wave before the bands', async () => {
    const { result, store, insertOrder } = await run(book());

    expect(result.success).toBe(true);
    expect(result.dependencyGraph.insertOrder).toEqual(['rating_rule', 'rating_item', 'customer_rating', 'rating_band']);
    expect(insertOrder).toEqual(['rating_rule', 'rating_item', 'customer_rating', 'rating_band']);
    expect(store.customer_rating?.[0]?.bands_seen).toBe(0);
  });

  it('several datasets of one object: their declarations are pooled onto the object', async () => {
    const seeds = [
      ...book(),
      ds('customer_rating', [{ name: 'C2', rule: 'R1' }], { dependsOn: ['rating_band'] }),
    ];
    const { result, store } = await run(seeds);

    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(store.customer_rating?.map((r) => r.bands_seen)).toEqual([2, 2]);
  });

  it('a lookup cycle elsewhere: a dataset downstream of it still lands after the object it declares', async () => {
    // cyc_x ↔ cyc_y never reach in-degree 0, so cyc_child (lookup → cyc_x) and
    // cyc_reader (dependsOn cyc_child) are both appended after the Kahn pass.
    // Authored with the reader first, the append must still honour the edge.
    const seeds = [
      ds('cyc_reader', [{ name: 'R' }], { dependsOn: ['cyc_child'] }),
      ds('cyc_x', [{ name: 'X', y: 'Y' }]),
      ds('cyc_y', [{ name: 'Y', x: 'X' }]),
      ds('cyc_child', [{ name: 'C', x: 'X' }]),
    ];
    const { result, insertOrder } = await run(seeds);

    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(result.dependencyGraph.circularDependencies.length).toBeGreaterThan(0);
    expect(insertOrder.indexOf('cyc_child')).toBeLessThan(insertOrder.indexOf('cyc_reader'));
  });
});

describe('Seed.dependsOn refusals: the load writes nothing and names the declaration', () => {
  /** Refused, nothing written, and the declaration named by its two objects. */
  const expectRefused = (r: Awaited<ReturnType<typeof run>>, object: string, target: string) => {
    expect(r.result.success).toBe(false);
    expect(r.result.results).toEqual([]);
    expect(r.result.summary.totalInserted).toBe(0);
    expect(r.engine.insert).not.toHaveBeenCalled();
    expect(r.result.errors.every((e) => e.field === 'dependsOn')).toBe(true);
    expect(r.result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceObject: object, targetObject: target, field: 'dependsOn' }),
    ]));
    const error = r.result.errors.find((e) => e.sourceObject === object && e.targetObject === target)!;
    expect(error.message).toContain(`'${object}'`);
    return error;
  };

  it('a declared edge that closes a cycle with lookup edges refuses the load', async () => {
    // customer_rating looks up rating_rule, so the rule lands first; a rule
    // that declares it reads the ratings asks for the opposite.
    const seeds = book();
    seeds[0] = ds('rating_rule', [{ name: 'R1' }], { dependsOn: ['customer_rating'] });
    const r = await run(seeds);

    const error = expectRefused(r, 'rating_rule', 'customer_rating');
    // The subject is the cycle itself, named object by object.
    expect(error.message).toContain('rating_rule → customer_rating → rating_rule');
  });

  it('two declared edges that close a cycle between themselves refuse the load', async () => {
    const seeds = [
      ds('cyc_reader', [{ name: 'R' }], { dependsOn: ['rating_rule'] }),
      ds('rating_rule', [{ name: 'R1' }], { dependsOn: ['cyc_reader'] }),
    ];
    const r = await run(seeds);

    expectRefused(r, 'cyc_reader', 'rating_rule');
    expectRefused(r, 'rating_rule', 'cyc_reader');
  });

  it('a dataset that declares its own object refuses the load', async () => {
    const r = await run(book({ dependsOn: ['customer_rating'] }));

    expectRefused(r, 'customer_rating', 'customer_rating');
  });

  it('a name that no dataset of this load seeds refuses the load', async () => {
    const r = await run(book({ dependsOn: ['crm_rating_bnad'] }));

    const error = expectRefused(r, 'customer_rating', 'crm_rating_bnad');
    expect(error.message).toContain("'crm_rating_bnad'");
    expect(error.message).not.toContain('scoped out');
  });

  it('a name whose datasets this load scoped out (env) refuses the load and says why', async () => {
    const seeds = book({ dependsOn: ['rating_band'] });
    seeds[2] = ds('rating_band', [{ name: 'B1', item: 'I1' }], { env: ['dev'] });
    const r = await run(seeds, { env: 'prod' });

    const error = expectRefused(r, 'customer_rating', 'rating_band');
    expect(error.message).toContain('scoped out');
  });

  it('a dataset this load scoped out is not judged', async () => {
    const seeds = [...book(), ds('cyc_reader', [{ name: 'R' }], { env: ['dev'], dependsOn: ['no_such_object'] })];
    const r = await run(seeds, { env: 'prod' });

    expect(r.result.success, JSON.stringify(r.result.errors)).toBe(true);
  });

  it('control: a cycle of lookup edges alone is still loaded by deferred passes, not refused', async () => {
    const seeds = [ds('cyc_x', [{ name: 'X', y: 'Y' }]), ds('cyc_y', [{ name: 'Y', x: 'X' }])];
    const r = await run(seeds);

    expect(r.result.success, JSON.stringify(r.result.errors)).toBe(true);
    expect(r.result.dependencyGraph.circularDependencies.length).toBeGreaterThan(0);
    expect(r.result.summary.totalInserted).toBe(2);
  });

  it('a dry run reports the same refusal', async () => {
    const r = await run(book({ dependsOn: ['crm_rating_bnad'] }), { dryRun: true });

    expect(r.result.success).toBe(false);
    expect(r.result.errors.map((e) => e.message).join('\n')).toContain("'crm_rating_bnad'");
  });
});
