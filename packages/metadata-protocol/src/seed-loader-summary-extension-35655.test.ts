// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [#35655] A seed never stores a roll-up (maintainer ruling D, record
 * 7063117450), and that includes a roll-up an object EXTENSION contributes.
 *
 * The loader resolves a definition from the metadata service first and uses
 * that copy whenever it has `fields`, without consulting the engine. The
 * metadata service stores the object as registered, with no extension merged
 * in, so its copy can lack a roll-up the engine's merged schema declares and
 * computes. The strip therefore reads both: the resolved definition and the
 * engine's own schema. These pins hand the loader a metadata copy WITHOUT the
 * extension's roll-up and an engine schema WITH it.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** The object as the metadata service stores it: no extension merged in. */
const METADATA_COPY = {
  name: 'ext_invoice',
  fields: {
    name: { type: 'text' },
    total: { type: 'number' },
    paid: { type: 'summary', summaryOperations: { object: 'ext_payment', field: 'amount', function: 'sum' } },
  },
};

/** The engine's merged schema: the same object plus an extension's roll-up. */
const ENGINE_SCHEMA = {
  ...METADATA_COPY,
  fields: {
    ...METADATA_COPY.fields,
    ext_refunds: { type: 'summary', summaryOperations: { object: 'ext_refund', field: 'amount', function: 'count' } },
  },
};

function createEngine(getSchema: (name: string) => unknown): IDataEngine {
  const store: Record<string, any[]> = {};
  let idCounter = 0;
  const engine = {
    getSchema: vi.fn(getSchema),
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
      const rows = (Array.isArray(data) ? data : [data]).map((d) => ({ id: `gen-${++idCounter}`, ...d }));
      store[objectName].push(...rows);
      return Array.isArray(data) ? rows : rows[0];
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      assertEngineUpdateDispatch(data, undefined);
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) { records[idx] = { ...records[idx], ...data }; return records[idx]; }
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;
  return engine;
}

function metadataWith(copy: unknown): IMetadataService {
  return {
    getObject: vi.fn(async (name: string) => (name === 'ext_invoice' ? copy : undefined)),
    listObjects: vi.fn(async () => [copy]),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => (name === 'ext_invoice' ? copy : undefined)),
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
  defaultMode: 'ignore',
  batchSize: 1000,
  transaction: false,
} as any;

const SEED = {
  object: 'ext_invoice',
  externalId: 'name',
  mode: 'ignore',
  env: ['prod', 'dev', 'test'],
  records: [{ name: 'INV-1', total: 10, paid: 3000, ext_refunds: 7 }],
};

const insertedKeys = (engine: IDataEngine) =>
  (engine.insert as any).mock.calls
    .filter(([object]: [string]) => object === 'ext_invoice')
    .flatMap(([, data]: [string, any]) => (Array.isArray(data) ? data : [data]).map((row: any) => Object.keys(row)));
const dropNotices = (logger: ReturnType<typeof createLogger>) =>
  (logger.warn as any).mock.calls.filter(([m]: [string]) => m.includes('roll-up summary'));

describe('a roll-up an object extension contributes is never seeded either (#35655)', () => {
  it('the metadata copy lacks the extension roll-up, the engine schema has it: neither roll-up reaches the engine, and the notice names both', async () => {
    const engine = createEngine((name) => (name === 'ext_invoice' ? ENGINE_SCHEMA : undefined));
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, metadataWith(METADATA_COPY), logger).load({
      seeds: [SEED] as any,
      config: CONFIG,
    });

    const keys = insertedKeys(engine);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('total');
    expect(keys[0]).not.toContain('paid');
    expect(keys[0]).not.toContain('ext_refunds');
    expect(result.results[0]).toMatchObject({ inserted: 1, errored: 0 });
    expect(dropNotices(logger).map(([, meta]: [string, any]) => meta)).toEqual([
      { object: 'ext_invoice', fields: ['paid', 'ext_refunds'], droppedValues: 2 },
    ]);
  });

  it('CONTROL: an engine whose schema read throws leaves the metadata copy the only source, and its roll-up is still dropped', async () => {
    const engine = createEngine(() => { throw new Error('no schema registry'); });
    const logger = createLogger();

    await new SeedLoaderService(engine, metadataWith(METADATA_COPY), logger).load({
      seeds: [SEED] as any,
      config: CONFIG,
    });

    const keys = insertedKeys(engine);
    expect(keys[0]).not.toContain('paid');
    // Nothing declares `ext_refunds` a roll-up here, so it is written as authored.
    expect(keys[0]).toContain('ext_refunds');
    expect(dropNotices(logger).map(([, meta]: [string, any]) => meta)).toEqual([
      { object: 'ext_invoice', fields: ['paid'], droppedValues: 1 },
    ]);
  });
});
