// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34613] `SeedLoaderService.loadStored`: a STORED seed dataset that still
 * declares a retired `SeedMode` (`insert`, `replace`; ruling 6942780880) is
 * refused alone, loudly, and every other dataset of the load lands.
 *
 * The request parse refuses a retired mode by name, so a load built straight
 * through `SeedLoaderRequestSchema.parse` would refuse the WHOLE boot seed (or
 * install, or replay) over one dataset a package carried from before the
 * retirement. `loadStored` is the funnel the replaying loads go through: the
 * refused dataset writes nothing, its error names the object and carries the
 * schema's own prescription, and the result says `success: false`.
 *
 * Controls: a load with no retired dataset is `load()`'s answer unchanged, and
 * a malformed dataset that is not a retired mode still throws from the parse,
 * as it did before.
 */

import { describe, it, expect, vi } from 'vitest';
import { SeedMode } from '@objectstack/spec/data';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SeedLoaderService } from './seed-loader.js';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** An in-memory engine: equality `where` (a combinator is refused, not read as a field), ids minted on insert. */
function createEngine(): { engine: IDataEngine; store: Record<string, Array<Record<string, unknown>>> } {
  const store: Record<string, Array<Record<string, unknown>>> = {};
  let next = 0;
  const find = async (object: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
    let rows = store[object] ?? [];
    if (query?.where) {
      rows = rows.filter((r) => Object.entries(query.where!).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`in-memory engine: unsupported operator ${k}`);
        return r[k] === v;
      }));
    }
    return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
  };
  const engine = {
    find: vi.fn(find),
    findOne: vi.fn(async (object: string, query?: any) => {
      assertEngineFindOnePredicate(object, query);
      return (await find(object, { ...query, limit: 1 }))[0] ?? null;
    }),
    insert: vi.fn(async (object: string, data: any) => {
      const put = (d: Record<string, unknown>) => {
        const row = { id: `r${++next}`, ...d };
        (store[object] ??= []).push(row);
        return row;
      };
      return Array.isArray(data) ? data.map(put) : put(data);
    }),
    update: vi.fn(async (_object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return data;
    }),
    delete: vi.fn(async (_object: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 0 };
    }),
    count: vi.fn(async (object: string) => (store[object] ?? []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;
  return { engine, store };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, unknown> = {
    rm_region: { name: 'rm_region', fields: { name: { type: 'text' } } },
    rm_source: { name: 'rm_source', fields: { name: { type: 'text' } } },
    rm_tier: { name: 'rm_tier', fields: { name: { type: 'text' } } },
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

const prescriptionOf = (mode: string): string => {
  const verdict = SeedMode.safeParse(mode);
  if (verdict.success) throw new Error(`'${mode}' is a live mode — wrong fixture`);
  return verdict.error.issues[0]!.message;
};

describe('loadStored — a stored dataset with a retired mode is refused alone (#34613)', () => {
  it.each([['insert'], ['replace']])('`%s`: that dataset writes nothing, every other dataset lands, the result names the refusal', async (mode) => {
    const { engine, store } = createEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).loadStored({
      seeds: [
        { object: 'rm_region', records: [{ name: 'emea' }] },
        { object: 'rm_source', mode, records: [{ name: 'web' }] },
        { object: 'rm_tier', mode: 'upsert', externalId: 'name', records: [{ name: 'gold' }] },
      ],
      config: { multiPass: true },
    });

    // The refused dataset wrote nothing; both others landed.
    expect(store.rm_source).toBeUndefined();
    expect(store.rm_region?.map((r) => r.name)).toEqual(['emea']);
    expect(store.rm_tier?.map((r) => r.name)).toEqual(['gold']);
    expect(result.results.map((r) => r.object).sort()).toEqual(['rm_region', 'rm_tier']);

    // Loud: the load failed, and its one error is the dataset's refusal with
    // the schema's prescription, read from `SeedMode` rather than restated.
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ sourceObject: 'rm_source', field: 'mode', attemptedValue: mode, recordIndex: 0 });
    expect(result.errors[0]!.message).toBe(`Seed dataset for 'rm_source' was not loaded: ${prescriptionOf(mode)}`);
    expect(result.errors[0]!.message).toMatch(/`mode: 'ignore'`.*`externalId`/s);
  });

  it('a load whose only dataset is retired writes nothing and still answers, failed', async () => {
    const { engine, store } = createEngine();
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).loadStored({
      seeds: [{ object: 'rm_source', mode: 'insert', records: [{ name: 'web' }] }],
    });
    expect(store).toEqual({});
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.sourceObject)).toEqual(['rm_source']);
  });

  it.each([['insert'], ['replace']])('`load()` itself refuses a `%s` dataset it was handed unparsed: nothing written, every record errored (S1)', async (mode) => {
    const { engine, store } = createEngine();
    const logger = createLogger();
    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [
        { object: 'rm_source', mode, externalId: 'name', records: [{ name: 'web' }, { name: 'mail' }] },
        { object: 'rm_region', mode: 'ignore', externalId: 'name', records: [{ name: 'emea' }] },
      ],
      config: { dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'ignore', batchSize: 1000, transaction: false },
    } as never);
    expect(store.rm_source).toBeUndefined();
    expect(store.rm_region?.map((r) => r.name)).toEqual(['emea']);
    expect(result.success).toBe(false);
    expect(result.results.find((r) => r.object === 'rm_source')).toMatchObject({ inserted: 0, updated: 0, errored: 2, total: 2 });
    expect(result.errors.map((e) => e.message)).toEqual([`Seed dataset for 'rm_source' was not loaded: ${prescriptionOf(mode)}`]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('`validate()` (the dry run) answers the same refusal a real load would, not a clean result (S1)', async () => {
    const { engine, store } = createEngine();
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).validate(
      [{ object: 'rm_source', mode: 'insert', externalId: 'name', records: [{ name: 'web' }] }] as never,
    );
    expect(store).toEqual({});
    expect(result.success).toBe(false);
    expect(result.errors[0]!.message).toBe(`Seed dataset for 'rm_source' was not loaded: ${prescriptionOf('insert')}`);
  });

  it('CONTROL: with no retired dataset the answer is the load’s own', async () => {
    const { engine, store } = createEngine();
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).loadStored({
      seeds: [{ object: 'rm_region', records: [{ name: 'emea' }] }],
    });
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(store.rm_region?.map((r) => r.name)).toEqual(['emea']);
  });

  it('CONTROL: a mode that was never a seed mode is still the parse’s refusal, for the whole load', async () => {
    const { engine, store } = createEngine();
    const attempt = new SeedLoaderService(engine, createMetadata(), createLogger()).loadStored({
      seeds: [
        { object: 'rm_region', records: [{ name: 'emea' }] },
        { object: 'rm_source', mode: 'merge', records: [{ name: 'web' }] },
      ],
    });
    await expect(attempt).rejects.toThrow();
    expect(store).toEqual({});
  });
});
