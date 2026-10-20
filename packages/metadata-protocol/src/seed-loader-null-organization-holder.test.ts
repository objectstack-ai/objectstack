// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [#24301] An organization-scoped load refuses a seed row whose natural key a
 * row with NO organization already holds, as a per-row error, instead of
 * inserting a twin of that row; and it never adopts the row.
 *
 * These pins hold the three readers of `loadExistingRecords` (its #8896 note)
 * apart, which a real-driver file cannot reach:
 *
 *   1. the upsert/ignore pre-load sees the unowned holder and refuses;
 *   2. `writeBatchPartial`'s retry recheck, and
 *   3. `writeOne`'s recheck read this organization's rows only: a row an
 *      earlier attempt committed carries the organization, so an unowned row
 *      is never taken for one, and the refused row never reaches either.
 *
 * The real drivers' NULL predicate and the stored rows are pinned in
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

/** A row no organization owns, holding the natural key `W-HELD`. */
function plantUnowned(store: Record<string, any[]>) {
  store.tw_widget = [{ id: 'w_unowned', sku: 'W-HELD', label: 'old', organization_id: null }];
}

const refusalsOf = <E extends { field: string; sourceObject: string; targetObject: string }>(result: { errors: E[] }) =>
  result.errors.filter((e) => e.field === 'organization_id' && e.targetObject === e.sourceObject);

describe('[#24301] a scoped load over a NULL-organization holder of a natural key', () => {
  it.each(['upsert', 'ignore'])('%s: refuses the held key by name, inserts the rest, and leaves the holder alone', async (mode) => {
    const { engine, store } = createFaithfulEngine();
    plantUnowned(store);
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: widgets(mode), config: config(ORG) });

    expect(store.tw_widget.map((r) => r.sku).sort()).toEqual(['W-HELD', 'W-NEW']);
    expect(store.tw_widget[0]).toEqual({ id: 'w_unowned', sku: 'W-HELD', label: 'old', organization_id: null });
    expect(store.tw_widget.find((r) => r.sku === 'W-NEW')?.organization_id).toBe(ORG);
    expect(result.summary.totalInserted).toBe(1);
    expect(result.summary.totalErrored).toBe(1);
    expect(engine.update).not.toHaveBeenCalled();
    const [refusal] = refusalsOf(result);
    expect(refusal).toMatchObject({ sourceObject: 'tw_widget', targetField: 'sku', attemptedValue: 'W-HELD', recordIndex: 0 });
    expect(refusal.message).toContain("'w_unowned'");
    // What 18.0 supports, never the ceremony it refuses; the first sentences
    // (what was refused, and why) stay.
    expect(refusal.message).toContain('which has no organization (organization_id is NULL)');
    expect(refusal.message).toContain('decided by the organization-ownership ceremony, not by a seed load.');
    expect(refusal.message).toMatch(
      /A row with no organization predates organization stamping, so it is a v17 database's\. 18\.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17\.x release until the 18\.x release that carries the upgrade path\.$/,
    );
    expect(refusal.message).not.toContain('os migrate organization-ownership');
    expect(refusal.message).not.toContain('--apply');
  });

  it("the organization's own row wins: a key held both by it and by an unowned row is matched, not refused", async () => {
    const { engine, store } = createFaithfulEngine();
    plantUnowned(store);
    store.tw_widget.push({ id: 'w_own', sku: 'W-HELD', label: 'held', organization_id: ORG });
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: widgets('upsert'), config: config(ORG) });

    expect(result.errors).toEqual([]);
    expect(result.summary.totalSkipped).toBe(1);
    expect(store.tw_widget.filter((r) => r.sku === 'W-HELD')).toHaveLength(2);
  });

  it('update mode writes no new row, so it keeps its behaviour: the held key is skipped, nothing refused', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    plantUnowned(store);
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: widgets('update'), config: config(ORG) });

    expect(result.errors).toEqual([]);
    expect(result.summary.totalSkipped).toBe(2);
    expect(store.tw_widget).toHaveLength(1);
    expect(finds.some((f) => f.where?.organization_id === null)).toBe(false);
  });

  it('the self-referencing (sequential) path refuses the same way', async () => {
    const { engine, store } = createFaithfulEngine();
    store.tw_unit = [{ id: 'u_unowned', code: 'ROOT', parent: null, organization_id: null }];
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: [{ object: 'tw_unit', externalId: 'code', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ code: 'ROOT' }, { code: 'LEAF' }] }] as any[],
      config: config(ORG),
    });
    expect(store.tw_unit.map((r) => r.code).sort()).toEqual(['LEAF', 'ROOT']);
    expect(refusalsOf(result).map((e) => e.attemptedValue)).toEqual(['ROOT']);
  });

  it('writeBatchPartial retry recheck: reads only the organization\'s rows, and the refused row never reaches an insert', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    plantUnowned(store);
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

    expect(payloads.flat().map((r) => r.sku)).toEqual(['W-NEW']);
    expect(store.tw_widget.map((r) => r.sku).sort()).toEqual(['W-HELD', 'W-NEW']);
    expect(refusalsOf(result)).toHaveLength(1);
    expect(result.summary.totalInserted).toBe(1);
    // One NULL read, the pre-load's; every recheck after the first insert is scoped.
    const nullReads = finds.filter((f) => f.where?.organization_id === null);
    expect(nullReads).toHaveLength(1);
    const afterPreload = finds.slice(finds.findIndex((f) => f.where?.organization_id === null) + 1)
      .filter((f) => f.objectName === 'tw_widget');
    // The retry happened, and its recheck is the one scoped read after the pre-load.
    expect(calls).toBe(1);
    expect(afterPreload.map((f) => f.where)).toEqual([{ organization_id: ORG }]);
  });

  it('writeOne recheck (an engine with no insertMany, an uncertain batch): the same, per row', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    plantUnowned(store);
    store.tw_widget.push({ id: 'w_unowned_2', sku: 'W-HELD-2', label: 'old', organization_id: null });
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
        records: [{ sku: 'W-HELD' }, { sku: 'W-NEW' }, { sku: 'W-HELD-2' }, { sku: 'W-NEW-2' }],
      }] as any[],
      config: config(ORG),
    });

    // One whole-array attempt, then the per-row degradation: two single inserts.
    expect(payloads.map((p) => p.map((r) => r.sku))).toEqual([['W-NEW', 'W-NEW-2'], ['W-NEW'], ['W-NEW-2']]);
    expect(store.tw_widget.map((r) => r.sku).sort()).toEqual(['W-HELD', 'W-HELD-2', 'W-NEW', 'W-NEW-2']);
    expect(refusalsOf(result).map((e) => e.attemptedValue)).toEqual(['W-HELD', 'W-HELD-2']);
    expect(result.summary.totalInserted).toBe(2);
    expect(finds.filter((f) => f.where?.organization_id === null)).toHaveLength(1);
  });

  it('an unscoped load reads no NULL holders and keeps matching the unowned row', async () => {
    const { engine, store, finds } = createFaithfulEngine();
    plantUnowned(store);
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({ seeds: widgets('upsert'), config: config() });

    expect(refusalsOf(result)).toEqual([]);
    expect(store.tw_widget.filter((r) => r.sku === 'W-HELD')).toHaveLength(1);
    expect(store.tw_widget.find((r) => r.sku === 'W-HELD')?.label).toBe('held');
    expect(finds.some((f) => f.where?.organization_id === null)).toBe(false);
  });
});
