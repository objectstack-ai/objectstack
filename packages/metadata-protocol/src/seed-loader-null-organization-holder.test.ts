// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [ADR-0131 D8] An organization-scoped load reads ITS OWN rows, and only them:
 * one read per decision, `organization_id = ORG`, with no NULL arm on any of
 * the three readers of `loadExistingRecords` (its #8896 note):
 *
 *   1. the upsert/ignore/update pre-load;
 *   2. `writeBatchPartial`'s retry recheck;
 *   3. `writeOne`'s per-row recheck.
 *
 * Until step 7 of the organization-ownership line the pre-load also read the
 * keys held by rows with NO organization and refused to twin or adopt them
 * (#24301). Certification leaves no such row (the ownership ceremony
 * attributes every one, D10) and a new write without an organization is
 * stamped or refused (D9), so that second read retired. These pins hold the
 * retirement: no `{ organization_id: null }` read is issued, whatever the
 * mode or path, and the scoped load behaves as the organization's own.
 *
 * The real driver's side is pinned in
 * `packages/runtime/src/seed-loader-null-organization-holder-real-driver.integration.test.ts`.
 */

const ORG = 'org_twdefaultk3x9qfa2';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** `where` matched like a real driver, `{ f: null }` included: it is `IS NULL`. */
function createFaithfulEngine(): { engine: IDataEngine; store: Record<string, any[]>; finds: any[] } {
  const store: Record<string, any[]> = {};
  const finds: any[] = [];
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      finds.push({ objectName, where: query?.where });
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return v === null ? r[k] == null : r[k] === v;
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

  return { engine, store, finds };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    tw_widget: { name: 'tw_widget', fields: { sku: { type: 'text' }, label: { type: 'text' } } },
    // Self-referencing: the sequential `writeRecord` path (`hasSelfRef`).
    tw_unit: { name: 'tw_unit', fields: { code: { type: 'text' }, parent: { type: 'lookup', reference: 'tw_unit' } } },
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

const config = (organizationId?: string) => ({
  dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'upsert', batchSize: 1000, transaction: false,
  ...(organizationId ? { organizationId } : {}),
}) as any;

const widgets = (mode: string) => [{
  object: 'tw_widget', externalId: 'sku', mode, env: ['prod', 'dev', 'test'],
  records: [{ sku: 'W-HELD', label: 'held' }, { sku: 'W-NEW', label: 'new' }],
}] as any[];

/** This organization's own row, holding the natural key `W-HELD`. */
function plantOwn(store: Record<string, any[]>) {
  store.tw_widget = [{ id: 'w_own', sku: 'W-HELD', label: 'old', organization_id: ORG }];
}

const nullReads = (finds: any[]) => finds.filter((f) => f.where && 'organization_id' in f.where && f.where.organization_id == null);

describe('[ADR-0131 D8] a scoped load reads only its organization\'s rows', () => {
  it.each(['upsert', 'ignore', 'update'])('%s: one scoped pre-load, no NULL read, its own row matched', async (mode) => {
    const { engine, store, finds } = createFaithfulEngine();
    plantOwn(store);
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: widgets(mode), config: config(ORG) });

    expect(result.errors).toEqual([]);
    expect(nullReads(finds)).toEqual([]);
    expect(finds.filter((f) => f.objectName === 'tw_widget').map((f) => f.where)).toEqual([{ organization_id: ORG }]);
    // The held key is this organization's: matched, never twinned.
    expect(store.tw_widget.filter((r) => r.sku === 'W-HELD')).toHaveLength(1);
    if (mode === 'update') {
      expect(store.tw_widget).toHaveLength(1);
    } else {
      expect(store.tw_widget.find((r) => r.sku === 'W-NEW')?.organization_id).toBe(ORG);
      expect(result.summary.totalInserted).toBe(1);
    }
  });

  it('the self-referencing (sequential) path reads the same way', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    store.tw_unit = [{ id: 'u_own', code: 'ROOT', parent: null, organization_id: ORG }];
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: [{ object: 'tw_unit', externalId: 'code', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ code: 'ROOT' }, { code: 'LEAF' }] }] as any[],
      config: config(ORG),
    });
    expect(result.errors).toEqual([]);
    expect(store.tw_unit.map((r) => r.code).sort()).toEqual(['LEAF', 'ROOT']);
    expect(nullReads(finds)).toEqual([]);
  });

  it('writeBatchPartial retry recheck: reads only the organization\'s rows, and inserts nothing twice', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    plantOwn(store);
    // The first array insert commits, then loses its response: the retry's
    // recheck must find W-NEW as already written and insert nothing again.
    const realInsert = (engine.insert as any).getMockImplementation();
    const payloads: any[][] = [];
    let calls = 0;
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      payloads.push(Array.isArray(data) ? data : [data]);
      const out = await realInsert(obj, data, opts);
      if (++calls === 1) throw new Error('fetch failed');
      return out;
    });
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: widgets('upsert'), config: config(ORG) });

    expect(calls).toBe(1);
    expect(payloads.flat().map((r) => r.sku)).toEqual(['W-NEW']);
    expect(store.tw_widget.map((r) => r.sku).sort()).toEqual(['W-HELD', 'W-NEW']);
    expect(result.summary.totalInserted).toBe(1);
    expect(nullReads(finds)).toEqual([]);
    // The pre-load and the retry's recheck: both scoped.
    expect(finds.filter((f) => f.objectName === 'tw_widget').map((f) => f.where))
      .toEqual([{ organization_id: ORG }, { organization_id: ORG }]);
  });

  it('writeOne recheck (an engine with no insertMany, an uncertain batch): the same, per row', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    plantOwn(store);
    const realInsert = (engine.insert as any).getMockImplementation();
    const payloads: any[][] = [];
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      payloads.push(Array.isArray(data) ? data : [data]);
      // A whole-array insert reports a mismatch: bulkWrite degrades to writeOne.
      if (Array.isArray(data)) throw Object.assign(new Error('bulk result mismatch'), { code: 'ERR_BULK_RESULT_MISMATCH' });
      return realInsert(obj, data, opts);
    });
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: [{
        object: 'tw_widget', externalId: 'sku', mode: 'upsert', env: ['prod', 'dev', 'test'],
        records: [{ sku: 'W-HELD' }, { sku: 'W-NEW' }, { sku: 'W-NEW-2' }],
      }] as any[],
      config: config(ORG),
    });

    // One whole-array attempt, then the per-row degradation: two single inserts.
    expect(payloads.map((p) => p.map((r) => r.sku))).toEqual([['W-NEW', 'W-NEW-2'], ['W-NEW'], ['W-NEW-2']]);
    expect(store.tw_widget.map((r) => r.sku).sort()).toEqual(['W-HELD', 'W-NEW', 'W-NEW-2']);
    expect(result.summary.totalInserted).toBe(2);
    expect(nullReads(finds)).toEqual([]);
  });

  it('an unscoped load reads no NULL holders either, and matches by key alone', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    plantOwn(store);
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: widgets('upsert'), config: config() });

    expect(result.errors).toEqual([]);
    expect(store.tw_widget.filter((r) => r.sku === 'W-HELD')).toHaveLength(1);
    expect(store.tw_widget.find((r) => r.sku === 'W-HELD')?.label).toBe('held');
    expect(nullReads(finds)).toEqual([]);
  });
});
