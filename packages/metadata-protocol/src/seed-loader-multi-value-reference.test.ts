// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

/**
 * Multi-value reference resolution (`Field.lookup(..., { multiple: true })`).
 *
 * The seed value for a multi-value lookup is an ARRAY of natural keys —
 * `authors: ['Alice', 'Bob']`. Reference resolution used to reject anything
 * non-string outright ("expected a natural-key string but got an object.
 * Pass the target's name value as a plain string"), which for a `multiple`
 * field is impossible advice: one string cannot express several associations.
 * The array was then DROPPED from the record, so the row landed with the whole
 * relationship missing and only a warn in the log (framework#3911).
 *
 * These tests pin the fix: every element resolves independently, the field
 * lands as an array of target ids, deferral is all-or-nothing per field, and a
 * genuinely single-value field still rejects an array — loudly and with advice
 * an author can act on.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Faithful in-memory engine (where-filtering find, array insert) — same shape
 *  the other seed-loader suites use, plus a `getSchema` registry. */
function createEngine(schemas: Record<string, any>) {
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
      return records.map((r) => ({ ...r }));
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
      assertEngineUpdateDispatch(data, undefined);
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async () => ({ deleted: 1 })),
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

/** The issue's minimal repro: a book with several authors. `reviewer` is the
 *  single-value control that must keep rejecting an array. */
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
    },
  },
};

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

const AUTHOR_SEED = {
  object: 'author',
  externalId: 'name',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records: [{ name: 'Alice' }, { name: 'Bob' }],
};

const bookSeed = (records: any[]) => ({
  object: 'book',
  externalId: 'name',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records,
});

describe('seed reference resolution — multi-value lookup (multiple: true)', () => {
  it('resolves every natural key in the array to a target id', async () => {
    const { engine, store } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: ['Alice', 'Bob'] }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);

    const alice = store.author.find((r) => r.name === 'Alice')!;
    const bob = store.author.find((r) => r.name === 'Bob')!;
    const book = store.book.find((r) => r.name === 'Refactoring')!;

    // The bug: `authors` was deleted from the record entirely.
    expect(book.authors).toEqual([alice.id, bob.id]);
    // Order is the authored order — a stored array is ordered data.
    expect(book.authors[0]).toBe(alice.id);
  });

  it('resolves against rows that already exist in the database', async () => {
    const { engine, store } = createEngine(SCHEMAS);
    store.author = [
      { id: 'author-existing-1', name: 'Alice' },
      { id: 'author-existing-2', name: 'Bob' },
    ];

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [bookSeed([{ name: 'Refactoring', authors: ['Alice', 'Bob'] }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(store.book[0].authors).toEqual(['author-existing-1', 'author-existing-2']);
    expect(result.summary.totalReferencesResolved).toBe(2);
  });

  it('normalizes a lone natural key to the array shape the field stores', async () => {
    const { engine, store } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: 'Alice' }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const alice = store.author.find((r) => r.name === 'Alice')!;
    expect(store.book[0].authors).toEqual([alice.id]);
  });

  it('passes internal ids through untouched, mixed with natural keys', async () => {
    const { engine, store } = createEngine(SCHEMAS);
    const existingId = '11111111-2222-4333-8444-555555555555'; // UUID → looksLikeInternalId
    store.author = [{ id: existingId, name: 'Carol' }];

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: [existingId, 'Bob'] }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const bob = store.author.find((r) => r.name === 'Bob')!;
    expect(store.book[0].authors).toEqual([existingId, bob.id]);
  });

  it('back-fills the whole array in pass 2 when the targets load later (circular graph)', async () => {
    // `author.favorite_book → book` and `book.authors → author` form a cycle,
    // so `book` loads before its authors exist and defers the WHOLE array.
    const cyclic = {
      author: {
        name: 'author',
        fields: {
          name: { type: 'text', required: true },
          favorite_book: { type: 'lookup', reference: 'book' },
        },
      },
      book: SCHEMAS.book,
    };
    const { engine, store } = createEngine(cyclic);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [
        bookSeed([{ name: 'Refactoring', authors: ['Alice', 'Bob'] }]),
        { ...AUTHOR_SEED, records: [{ name: 'Alice', favorite_book: 'Refactoring' }, { name: 'Bob' }] },
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);

    const alice = store.author.find((r) => r.name === 'Alice')!;
    const bob = store.author.find((r) => r.name === 'Bob')!;
    const book = store.book.find((r) => r.name === 'Refactoring')!;

    expect(book.authors).toEqual([alice.id, bob.id]);
    expect(alice.favorite_book).toBe(book.id);
  });

  it('defers the array as a WHOLE — never writes a half-resolved association', async () => {
    const { engine, store } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      // 'Nobody' never materializes, so the field stays deferred and then errors.
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: ['Alice', 'Nobody'] }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(false);
    // The partial `[alice.id]` must NOT have been written.
    expect(store.book[0].authors).toBeUndefined();
    // The error names the element at fault, not the whole array.
    expect(result.errors.some((e) => e.message.includes("'Nobody'"))).toBe(true);
  });

  it('drops the record (loudly) when an element cannot resolve and no pass 2 will run', async () => {
    const { engine, store } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: ['Alice', 'Nobody'] }])] as any,
      config: { ...CONFIG, multiPass: false },
    });

    expect(result.success).toBe(false);
    expect(store.book).toBeUndefined();
    expect(result.errors.some((e) => e.message.includes('Cannot resolve reference: book.authors'))).toBe(true);
  });

  it('rejects an array on a SINGLE-value reference field with actionable advice', async () => {
    const { engine, store } = createEngine(SCHEMAS);
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), logger).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', reviewer: ['Alice', 'Bob'] }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(false);
    const message = result.errors.find((e) => e.field === 'reviewer')!.message;
    expect(message).toContain('but got an array');
    expect(message).toContain('multiple: true');
    // The unwritable value never reaches the driver; the record still lands.
    expect(store.book[0].reviewer).toBeUndefined();
    expect(store.book[0].name).toBe('Refactoring');
    // #4729: the row landed WITHOUT its association and the row counters stay
    // clean, so this is reported at `error` — the one level a reader of the
    // console is not trained to skim — and the line says what was lost.
    const dropped = logger.error.mock.calls.map((c: any[]) => String(c[0])).find((m: string) => m.includes('reviewer'));
    expect(dropped, 'the dropped reference was not reported at error level').toBeDefined();
    expect(dropped).toContain('DROPPED');
    expect(dropped).toContain('re-run the seed');
    expect(logger.warn).not.toHaveBeenCalled();

    // framework#3932: the row WAS written, so `errored` stays 0 and the row
    // counters all look healthy — the loss only shows up here.
    expect(result.summary.totalErrored).toBe(0);
    expect(result.summary.totalReferencesDropped).toBe(1);
    expect(result.results.find((r) => r.object === 'book')!.referencesDropped).toBe(1);
  });

  it('counts a dropped reference field without disturbing the row counters (#3932)', async () => {
    const { engine, store } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([
        { name: 'Refactoring', authors: [{ externalId: 'Alice' }] },
        { name: 'Clean Code', authors: ['Alice'] },
      ])] as any,
      config: CONFIG,
    });

    const book = result.results.find((r) => r.object === 'book')!;
    // Both rows were written — one just lost its association.
    expect(store.book).toHaveLength(2);
    expect(book.inserted).toBe(2);
    expect(book.errored).toBe(0);
    expect(book.referencesDropped).toBe(1);
    // The reconciliation `errored` must not break: inserted + updated + skipped
    // still accounts for every record in the dataset.
    expect(book.inserted + book.updated + book.skipped + book.errored).toBe(book.total);
    // Still a failed load — the counter reports damage, it does not excuse it.
    expect(result.success).toBe(false);
  });

  it('reports zero dropped references on a clean load', async () => {
    const { engine } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: ['Alice', 'Bob'] }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalReferencesDropped).toBe(0);
  });

  it('still rejects a wrapper object inside a multi-value array', async () => {
    const { engine } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: [{ externalId: 'Alice' }] }])] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(false);
    const message = result.errors.find((e) => e.field === 'authors')!.message;
    expect(message).toContain('Pass the natural key directly: authors: "Alice"');
  });

  it('replays idempotently — a resolved array is not rewritten on the second load', async () => {
    const { engine, store } = createEngine(SCHEMAS);
    const seeds = [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: ['Alice', 'Bob'] }])] as any;
    const loader = new SeedLoaderService(engine, createEmptyMetadata(), createLogger());

    await loader.load({ seeds, config: CONFIG });
    const first = store.book[0].authors;

    const replay = await loader.load({ seeds, config: CONFIG });

    expect(replay.success).toBe(true);
    // Replay compares the resolved array against the stored one — no churn.
    expect(replay.summary.totalUpdated).toBe(0);
    expect(replay.summary.totalSkipped).toBe(3);
    expect(store.book).toHaveLength(1);
    expect(store.book[0].authors).toEqual(first);
  });

  it('reports the array shape in the dependency graph', async () => {
    const { engine } = createEngine(SCHEMAS);

    const result = await new SeedLoaderService(engine, createEmptyMetadata(), createLogger()).load({
      seeds: [AUTHOR_SEED, bookSeed([{ name: 'Refactoring', authors: ['Alice'] }])] as any,
      config: CONFIG,
    });

    const bookNode = result.dependencyGraph.nodes.find((n) => n.object === 'book')!;
    expect(bookNode.references.find((r) => r.field === 'authors')!.multiple).toBe(true);
    expect(bookNode.references.find((r) => r.field === 'reviewer')!.multiple).toBeUndefined();
  });
});
