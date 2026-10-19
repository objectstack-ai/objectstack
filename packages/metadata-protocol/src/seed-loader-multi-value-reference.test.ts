// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

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
          Object.entries(query.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
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

/**
 * [#24459] A blank seed reference is NO reference.
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
 * Same engine double as the suite above, on its own schema map. What the
 * real engine stores and refuses is pinned on a real `SqlDriver` in
 * `packages/runtime/src/seed-blank-reference-real-driver.integration.test.ts`;
 * this double does not validate, so nothing here claims it.
 */
const BLANK_SCHEMAS: Record<string, any> = {
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

const blankAuthorSeed = (records: any[]) => ({ object: 'author', externalId: 'name', mode: 'upsert', env: ENV, records });
const blankBookSeed = (records: any[]) => ({ object: 'book', externalId: 'name', mode: 'upsert', env: ENV, records });

const DEFERRED_UNRESOLVED = /Deferred reference unresolved/;

async function loadBlank(seeds: any[]) {
  const { engine, store } = createEngine(BLANK_SCHEMAS);
  const logger = createLogger();
  const result = await new SeedLoaderService(engine, createEmptyMetadata(), logger).load({ seeds, config: CONFIG });
  return { result, store, logger, engine };
}

describe('a blank seed reference is no reference (isMissing)', () => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('skips a single reference written %s: not resolved, not deferred, left as written', async (_label, blank) => {
    const { result, store, logger } = await loadBlank([
      blankAuthorSeed([{ name: 'Alice' }]),
      blankBookSeed([{ name: 'Refactoring', reviewer: blank }]),
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
    const { result, store, engine } = await loadBlank([
      blankAuthorSeed([{ name: 'Alice' }, { name: 'Bob' }]),
      blankBookSeed([{ name: 'Refactoring', authors: ['Alice', '', null, '  ', 'Bob'] }]),
    ]);

    expect(result.errors.map((e) => e.message)).toEqual([]);
    expect(result.success).toBe(true);
    const alice = store.author.find((r) => r.name === 'Alice')!;
    const bob = store.author.find((r) => r.name === 'Bob')!;
    expect(store.book[0].authors).toEqual([alice.id, bob.id]);
    // Resolved in PASS 1: nothing deferred the array to a back-fill
    // (where pass 2 would re-resolve it, blanks included).
    expect((engine.update as any).mock.calls.filter(([o, d]: [string, any]) => o === 'book' && 'authors' in d)).toEqual([]);
  });

  it('drops a blank element in PASS 2 too, where the deferred value is the whole authored array', async () => {
    const { result, store, engine } = await loadBlank([
      blankBookSeed([
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
    const { result, store } = await loadBlank([
      blankAuthorSeed([{ name: 'Alice' }]),
      {
        object: 'activity', externalId: 'summary', mode: 'upsert', env: ENV,
        records: [
          { summary: 'empty pointer', object_name: 'author', record_id: '' },
          { summary: 'whitespace pointer', object_name: 'author', record_id: '   ' },
          // The pair's type half empty: an AUTHORED id here is refused as
          // un-addressable; a blank one is no pointer, so there is nothing to
          // address — the same answer `''` always got.
          { summary: 'empty pointer, no type', record_id: '' },
          { summary: 'whitespace pointer, no type', record_id: '   ' },
          // Control: the pair is live on this object — a real key resolves.
          { summary: 'real pointer', object_name: 'author', record_id: 'Alice' },
        ],
      },
    ]);

    expect(result.errors.map((e) => e.message)).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
    expect(result.summary.totalReferencesDeferred).toBe(0);
    const alice = store.author.find((r) => r.name === 'Alice')!;
    expect(store.activity.find((r) => r.summary === 'real pointer')!.record_id).toBe(alice.id);
    expect(store.activity).toHaveLength(5);
  });

  it('control: a real natural key still resolves, and an unresolvable one still errors', async () => {
    const { result, store } = await loadBlank([
      blankAuthorSeed([{ name: 'Alice' }]),
      blankBookSeed([
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
