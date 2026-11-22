// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [#35254] A lookup that one package adds to another package's object through
 * `objectExtensions` (ADR-0130 D5) resolves in a seed exactly like a lookup
 * the owner authored: it joins the dependency graph, its natural key becomes
 * the target's id, it is deferred to pass 2 when the target loads later, and
 * an unknown key is refused the same way.
 *
 * The shape this file reproduces is the boot that ingests a compiled artifact
 * (`os dev`, `os serve`, the cloud runtime). There the metadata service holds
 * each object AS ITS PACKAGE AUTHORED IT, and the extension's fields exist only
 * in the engine registry's fold. The loader used to prefer the metadata copy
 * whenever it had `fields`, so the extension lookup was no reference at all:
 * no `ext_order → ext_quote` edge, and the quote's name written verbatim into
 * the foreign-key column. Measured with the resolver of `origin/main`
 * a5a5312ff4 put back: this harness stores `quote_ref = 'Q-ACME'`, and a real
 * `os dev` boot of a two-package artifact of this shape stores the quote's
 * name in both an `update` and an `upsert` row.
 *
 * The metadata double serves the authored `ext_order` (no `quote_ref`); the
 * engine double's `getSchema` serves the folded one (with it), as the ObjectQL
 * registry does after `registerApp` applies the extension. Every case keeps a
 * CONTROL beside it: the same seed through `account_ref`, a lookup the owner
 * authored on the same object.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** The faithful engine of seed-loader-engine-schema-fallback.test.ts (where-filtering find, the
 *  producer's dispatch predicates on findOne / update / delete), plus a store a case can pre-fill. */
function createFaithfulEngine(schemas: Record<string, any>) {
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
      if (typeof query?.limit === 'number') {
        records = records.slice(0, query.limit);
      }
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
    getSchema: vi.fn((objectName: string) => schemas[objectName]),
  } as unknown as IDataEngine & { getSchema: ReturnType<typeof vi.fn> };

  return { engine, store };
}

/** The owner package's objects, as it authored them — what the metadata service holds on an artifact boot. */
function authoredObjects(quoteBacklink: boolean): Record<string, any> {
  return {
    ext_account: { name: 'ext_account', fields: { name: { type: 'text', required: true } } },
    ext_order: {
      name: 'ext_order',
      fields: {
        name: { type: 'text', required: true },
        account_ref: { type: 'lookup', reference: 'ext_account' },
      },
    },
    ext_quote: {
      name: 'ext_quote',
      fields: {
        name: { type: 'text', required: true },
        ...(quoteBacklink ? { order_ref: { type: 'lookup', reference: 'ext_order' } } : {}),
      },
    },
  };
}

/** The same objects as the engine's registry serves them: `ext_order` with the extension's lookup folded in. */
function servedObjects(quoteBacklink: boolean): Record<string, any> {
  const authored = authoredObjects(quoteBacklink);
  return {
    ...authored,
    ext_order: {
      ...authored.ext_order,
      fields: { ...authored.ext_order.fields, quote_ref: { type: 'lookup', reference: 'ext_quote' } },
    },
  };
}

function createMetadata(objects: Record<string, any>): IMetadataService {
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
} as any;

const ENV = ['prod', 'dev', 'test'];

function loaderFor(quoteBacklink = false) {
  const { engine, store } = createFaithfulEngine(servedObjects(quoteBacklink));
  const logger = createLogger();
  const loader = new SeedLoaderService(engine, createMetadata(authoredObjects(quoteBacklink)), logger);
  return { loader, store, logger, engine };
}

/** The order dataset first, then the targets — the order a later package's seeds arrive in. */
function seeds(mode: string, order: Record<string, unknown>) {
  return [
    { object: 'ext_order', externalId: 'name', mode, env: ENV, records: [{ name: 'O-1', ...order }] },
    { object: 'ext_quote', externalId: 'name', mode: 'upsert', env: ENV, records: [{ name: 'Q-ACME' }] },
    { object: 'ext_account', externalId: 'name', mode: 'upsert', env: ENV, records: [{ name: 'Acme' }] },
  ] as any[];
}

describe('[#35254] a seed resolves a lookup an object extension adds like an authored one', () => {
  for (const mode of ['upsert', 'ignore'] as const) {
    it(`${mode} (inserting): the extension lookup stores the quote's id, and the graph loads the quote first`, async () => {
      const { loader, store } = loaderFor();
      const result = await loader.load({ seeds: seeds(mode, { quote_ref: 'Q-ACME', account_ref: 'Acme' }), config: CONFIG });

      expect(result.success).toBe(true);
      expect(result.summary.totalErrored).toBe(0);
      const quoteId = store.ext_quote.find((r) => r.name === 'Q-ACME')!.id;
      const accountId = store.ext_account.find((r) => r.name === 'Acme')!.id;
      expect(store.ext_order).toHaveLength(1);
      expect(store.ext_order[0].quote_ref).toBe(quoteId);
      // CONTROL: the authored lookup on the same row.
      expect(store.ext_order[0].account_ref).toBe(accountId);

      const order = result.dependencyGraph.insertOrder;
      expect(order.indexOf('ext_quote')).toBeLessThan(order.indexOf('ext_order'));
      expect(order.indexOf('ext_account')).toBeLessThan(order.indexOf('ext_order'));
      const node = result.dependencyGraph.nodes.find((n) => n.object === 'ext_order')!;
      expect([...node.dependsOn].sort()).toEqual(['ext_account', 'ext_quote']);
      // (The injected `owner_id` → `sys_user` reference rides along on both; it is not this pin's subject.)
      expect(node.references.filter((r) => r.targetObject.startsWith('ext_')).map((r) => `${r.field}->${r.targetObject}`).sort())
        .toEqual(['account_ref->ext_account', 'quote_ref->ext_quote']);
    });
  }

  it('update: the existing order gets the quote\'s id and no second order is inserted', async () => {
    const { loader, store } = loaderFor();
    store.ext_order = [{ id: 'ord-existing', name: 'O-1' }];

    const result = await loader.load({ seeds: seeds('update', { quote_ref: 'Q-ACME', account_ref: 'Acme' }), config: CONFIG });

    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
    const quoteId = store.ext_quote.find((r) => r.name === 'Q-ACME')!.id;
    const accountId = store.ext_account.find((r) => r.name === 'Acme')!.id;
    expect(store.ext_order).toEqual([
      expect.objectContaining({ id: 'ord-existing', name: 'O-1', quote_ref: quoteId, account_ref: accountId }),
    ]);
  });

  it('a target that loads after the order (a cycle) is deferred to pass 2 and resolved, as an authored lookup is', async () => {
    // `ext_quote.order_ref` points back at the order, so the graph has a cycle
    // only once the extension lookup is read: one side loads first, its
    // reference waits for pass 2, and pass 2 writes it back. CONTROL: the same
    // cycle with `quote_ref` authored on the order itself.
    const run = async (authoredQuoteRef: boolean) => {
      const { engine, store } = createFaithfulEngine(servedObjects(true));
      const authored = authoredObjects(true);
      if (authoredQuoteRef) authored.ext_order = servedObjects(true).ext_order;
      const loader = new SeedLoaderService(engine, createMetadata(authored), createLogger());
      const result = await loader.load({
        seeds: [
          { object: 'ext_order', externalId: 'name', mode: 'upsert', env: ENV, records: [{ name: 'O-1', quote_ref: 'Q-ACME' }] },
          { object: 'ext_quote', externalId: 'name', mode: 'upsert', env: ENV, records: [{ name: 'Q-ACME', order_ref: 'O-1' }] },
        ] as any[],
        config: CONFIG,
      });
      const order = store.ext_order.find((r) => r.name === 'O-1')!;
      const quote = store.ext_quote.find((r) => r.name === 'Q-ACME')!;
      const backfills = (engine.update as any).mock.calls.map(([object, data]: [string, any]) =>
        [object, Object.keys(data).filter((k) => k !== 'id').sort()]);
      return { result, order, quote, backfills };
    };
    const extension = await run(false);
    const control = await run(true);

    for (const { result, order, quote } of [extension, control]) {
      expect(result.summary.totalErrored).toBe(0);
      expect(result.dependencyGraph.circularDependencies.length).toBeGreaterThan(0);
      expect(order.quote_ref).toBe(quote.id);
      expect(quote.order_ref).toBe(order.id);
    }
    // One side was written in pass 2, and the extension lookup took the same path the authored one does.
    expect(extension.backfills.length).toBeGreaterThan(0);
    expect(extension.backfills).toEqual(control.backfills);
    expect(extension.result.dependencyGraph.insertOrder).toEqual(control.result.dependencyGraph.insertOrder);
  });

  it('an unknown natural key is refused exactly as the authored lookup refuses it, and no raw key is stored', async () => {
    const run = async (field: 'quote_ref' | 'account_ref') => {
      const { loader, store } = loaderFor();
      const result = await loader.load({ seeds: seeds('upsert', { [field]: 'Ghost' }), config: CONFIG });
      return { result, store };
    };
    const extension = await run('quote_ref');
    const authored = await run('account_ref');

    for (const { result, store } of [extension, authored]) {
      expect(result.success).toBe(false);
      expect(result.summary.totalErrored).toBe(1);
      expect((store.ext_order ?? []).some((r) => r.quote_ref === 'Ghost' || r.account_ref === 'Ghost')).toBe(false);
    }
    const shape = (r: typeof extension.result, field: string, target: string) =>
      r.errors.map((e: any) => ({
        message: String(e.message).split(field).join('FIELD').split(target).join('TARGET'),
        recordIndex: e.recordIndex,
        attemptedValue: e.attemptedValue,
      }));
    expect(shape(extension.result, 'quote_ref', 'ext_quote')).toEqual(shape(authored.result, 'account_ref', 'ext_account'));
    expect(extension.result.errors.map((e: any) => e.message).join('\n')).toContain('ext_order.quote_ref');
  });
});
