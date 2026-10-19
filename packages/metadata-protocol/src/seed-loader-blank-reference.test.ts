// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * A blank seed reference is NO reference.
 *
 * "Blank" is the engine's own rule, `isMissing` (`@objectstack/core`,
 * `required-emptiness.ts`): `undefined`, `null`, and a string that is empty or
 * only whitespace — the rule the insert door and the required check use. The
 * loader used to skip a reference only on `undefined` / `null`, so `''`
 * resolved as a natural key, missed, deferred, and was reported after pass 2 as
 * "Deferred reference unresolved" for a row that had landed.
 *
 * Every site that decides "this reference has a value" asks that one rule:
 * the single reference, each element of a multi-value one (pass 1 and pass 2)
 * and the pointer pair's id half. A blank single value is left AS WRITTEN for
 * the engine (its required check refuses it on a required field); a blank
 * element is dropped like a `null` hole, so the field's other elements land.
 *
 * What the real engine stores and refuses is pinned on a real `SqlDriver` in
 * `packages/runtime/src/seed-blank-reference-real-driver.integration.test.ts`;
 * this double does not validate, so nothing here claims it.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Faithful in-memory engine (where-filtering find, array insert) — the shape
 *  the other seed-loader suites use, plus a `getSchema` registry. */
function createEngine(schemas: Record<string, any>) {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

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
      return records.map((r) => ({ ...r }));
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
    getSchema: vi.fn((objectName: string) => schemas[objectName]),
  } as unknown as IDataEngine & { getSchema: ReturnType<typeof vi.fn> };

  return { engine, store };
}

function createEmptyMetadata(): IMetadataService {
  return {
    getObject: vi.fn(async () => undefined),
    listObjects: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const SCHEMAS: Record<string, any> = {
  author: {
    name: 'author',
    fields: { name: { type: 'text', required: true } },
  },
  book: {
    name: 'book',
    fields: {
      name: { type: 'text', required: true },
      authors: { type: 'lookup', reference: 'author', multiple: true },
      reviewer: { type: 'lookup', reference: 'author' },
      // A self-reference to a row later in the same dataset: not inserted yet
      // in pass 1, so the field defers its WHOLE authored array to pass 2.
      related: { type: 'lookup', reference: 'book', multiple: true },
    },
  },
  activity: {
    name: 'activity',
    fields: {
      summary: { type: 'text', required: true },
      object_name: { type: 'text' },
      record_id: { type: 'text', referenceVia: 'object_name' },
    },
  },
};

const ENV = ['prod', 'dev', 'test'];
const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

const authorSeed = (records: any[]) => ({ object: 'author', externalId: 'name', mode: 'upsert', env: ENV, records });
const bookSeed = (records: any[]) => ({ object: 'book', externalId: 'name', mode: 'upsert', env: ENV, records });

const DEFERRED_UNRESOLVED = /Deferred reference unresolved/;

async function load(seeds: any[]) {
  const { engine, store } = createEngine(SCHEMAS);
  const logger = createLogger();
  const result = await new SeedLoaderService(engine, createEmptyMetadata(), logger).load({ seeds, config: CONFIG });
  return { result, store, logger, engine };
}

describe('a blank seed reference is no reference (isMissing)', () => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('skips a single reference written %s: not resolved, not deferred, left as written', async (_label, blank) => {
    const { result, store, logger } = await load([
      authorSeed([{ name: 'Alice' }]),
      bookSeed([{ name: 'Refactoring', reviewer: blank }]),
    ]);

    expect(result.errors.map((e) => e.message)).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
    expect(result.summary.totalReferencesDeferred).toBe(0);
    expect(result.summary.totalReferencesDropped).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
    // Left for the engine's insert door and required check, exactly as authored.
    expect(store.book[0].reviewer).toBe(blank);
  });

  it('drops a blank ELEMENT of a multi-value reference like a null hole; the rest resolve in order', async () => {
    const { result, store } = await load([
      authorSeed([{ name: 'Alice' }, { name: 'Bob' }]),
      bookSeed([{ name: 'Refactoring', authors: ['Alice', '', null, '  ', 'Bob'] }]),
    ]);

    expect(result.errors.map((e) => e.message)).toEqual([]);
    expect(result.success).toBe(true);
    const alice = store.author.find((r) => r.name === 'Alice')!;
    const bob = store.author.find((r) => r.name === 'Bob')!;
    expect(store.book[0].authors).toEqual([alice.id, bob.id]);
  });

  it('drops a blank element in PASS 2 too, where the deferred value is the whole authored array', async () => {
    const { result, store, engine } = await load([
      bookSeed([
        { name: 'Refactoring', related: ['Dune', '', '  ', 'Emma'] },
        { name: 'Dune' },
        { name: 'Emma' },
      ]),
    ]);

    expect(result.errors.map((e) => e.message)).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
    // The array really went through pass 2 — the path this case exists for:
    // the insert carried no `related`, and the back-fill wrote it. (A pass-2
    // success un-books the deferral, so the summary counter reads 0 here.)
    const id = (name: string) => store.book.find((r) => r.name === name)!.id;
    expect(store.book.find((r) => r.name === 'Refactoring')!.related).toEqual([id('Dune'), id('Emma')]);
    const backFills = (engine.update as any).mock.calls.filter(([o, d]: [string, any]) => o === 'book' && 'related' in d);
    expect(backFills).toHaveLength(1);
    expect(backFills[0][1].related).toEqual([id('Dune'), id('Emma')]);
  });

  it('skips a whitespace-only pointer-pair id the way it skips an empty one', async () => {
    const { result } = await load([
      authorSeed([{ name: 'Alice' }]),
      {
        object: 'activity', externalId: 'summary', mode: 'upsert', env: ENV,
        records: [
          { summary: 'empty pointer', object_name: 'author', record_id: '' },
          { summary: 'whitespace pointer', object_name: 'author', record_id: '   ' },
        ],
      },
    ]);

    expect(result.errors.map((e) => e.message)).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.summary.totalReferencesDeferred).toBe(0);
  });

  it('control: a real natural key still resolves, and an unresolvable one still errors', async () => {
    const { result, store } = await load([
      authorSeed([{ name: 'Alice' }]),
      bookSeed([
        { name: 'Refactoring', reviewer: 'Alice' },
        { name: 'Dune', reviewer: 'Nobody' },
      ]),
    ]);

    const alice = store.author.find((r) => r.name === 'Alice')!;
    expect(store.book.find((r) => r.name === 'Refactoring')!.reviewer).toBe(alice.id);
    expect(result.success).toBe(false);
    expect(result.errors.filter((e) => DEFERRED_UNRESOLVED.test(e.message))).toHaveLength(1);
    expect(result.errors[0].message).toContain("'Nobody'");
  });
});
