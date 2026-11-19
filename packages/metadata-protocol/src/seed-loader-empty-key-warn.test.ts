// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * A keyed seed record that leaves a key field blank — no value, null or an
 * empty string, in any component of a composite `externalId` or in the one
 * field of a single-field key (`name` when the dataset names none) — keys
 * `''`, so it can match no row a load wrote before. Measured before the
 * refusal, three loads of one such record among keyed siblings: 2 -> 3 -> 4
 * rows, nothing said (#34857 composite, #35336 single-field).
 *
 * The keyed modes now REFUSE such a record at load, on the key as authored —
 * after its expressions resolve, before any reference does: it is not
 * written, the load result carries one error naming the object, the record,
 * the blank field(s) and the fix, and every other record loads as before. A
 * dataset whose every record keys empty (#28952: `externalId` names a field no
 * record carries) is the same refusal for each record; its dataset-level
 * notice is gone, since it would report the same records twice. The save door
 * and the publish promotion still refuse a seed whose `externalId` names no
 * field of its object (`protocol.seed-external-id-refusal.test.ts`).
 *
 * Uses the faithful engine of `seed-loader-composite-external-id.test.ts`
 * (filters `where`, mints ids), kept local.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createFaithfulEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
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
  } as unknown as IDataEngine;

  return { engine, store };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    demo_other: { name: 'demo_other', fields: { name: { type: 'text' }, code: { type: 'text' } } },
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

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
  organizationId: 'org_demo',
} as any;

const dataset = (externalId: string | string[], mode = 'upsert', records: Record<string, unknown>[] = [{ name: 'G1', code: 'g' }]) =>
  ({ object: 'demo_other', externalId, mode, env: ['prod', 'dev', 'test'], records });

/** The loader's blank-key refusals in a load result, by their message. */
const blankKeyRefusals = (result: any): any[] =>
  result.errors.filter((e: any) => e.message.includes('was NOT loaded: it is keyed on externalId'));

/** The blank-key refusal lines the loader logged. */
const blankKeyLines = (logger: ReturnType<typeof createLogger>) =>
  logger.error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('was NOT loaded: it is keyed on externalId'));

/** Three loads of one stored seed, each by a fresh loader over the same store — three boots. */
async function threeLoads(seeds: any[]) {
  const { engine, store } = createFaithfulEngine();
  const counts: number[] = [];
  const results: any[] = [];
  const loggers: Array<ReturnType<typeof createLogger>> = [];
  for (let boot = 0; boot < 3; boot++) {
    const logger = createLogger();
    results.push(await new SeedLoaderService(engine, createMetadata(), logger).load({ seeds, config: CONFIG }));
    counts.push((store.demo_other ?? []).length);
    loggers.push(logger);
  }
  return { store, counts, results, loggers };
}

describe('[#34857, #35336] the boot loader refuses a keyed record that leaves a key field blank', () => {
  for (const [label, blank] of [['empty string', ''], ['null', null], ['no value', undefined]] as const) {
    it(`composite key, one component ${label}: the record is not written, its siblings converge`, async () => {
      const blankRecord: Record<string, unknown> = { name: 'B' };
      if (blank !== undefined) blankRecord.code = blank;
      const { store, counts, results, loggers } = await threeLoads([
        dataset(['name', 'code'], 'upsert', [{ name: 'A', code: 'a' }, blankRecord, { name: 'C', code: 'c' }]),
      ]);

      expect(counts).toEqual([2, 2, 2]);
      expect(store.demo_other.map((r) => r.name).sort()).toEqual(['A', 'C']);
      for (const result of results) {
        expect(result.success).toBe(false);
        expect(result.results[0]).toMatchObject({ object: 'demo_other', errored: 1, total: 3 });
        const refused = blankKeyRefusals(result);
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatchObject({ sourceObject: 'demo_other', field: 'code', recordIndex: 1 });
        expect(refused[0].message).toContain(
          "Seed record #1 of 'demo_other' was NOT loaded: it is keyed on externalId 'name+code' and leaves 'code' blank",
        );
        expect(refused[0].message).toContain("Give the record a value for 'code'");
      }
      // Logged once per load, at `error`: the record is dropped.
      for (const logger of loggers) expect(blankKeyLines(logger)).toHaveLength(1);
    });
  }

  it('single-field key: a record with no value for it is refused; its keyed sibling converges', async () => {
    const { counts, results } = await threeLoads([dataset('code', 'upsert', [{ name: 'A', code: 'a' }, { name: 'B' }])]);

    expect(counts).toEqual([1, 1, 1]);
    for (const result of results) {
      const refused = blankKeyRefusals(result);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({ sourceObject: 'demo_other', field: 'code', recordIndex: 1 });
      expect(refused[0].message).toContain("keyed on externalId 'code' and leaves 'code' blank");
    }
  });

  it('the default key (`name`, no externalId declared): a record with no name is refused, and the message says the key is the default', async () => {
    const seed = { object: 'demo_other', mode: 'ignore', env: ['prod', 'dev', 'test'], records: [{ name: 'A', code: 'a' }, { code: 'b' }] };
    const { counts, results } = await threeLoads([seed]);

    expect(counts).toEqual([1, 1, 1]);
    const refused = blankKeyRefusals(results[0]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ field: 'name', recordIndex: 1 });
    expect(refused[0].message).toContain("keyed on externalId 'name' (the default key when a dataset names none) and leaves 'name' blank");
  });

  it('an expression that evaluates empty in a key field is refused the same way (it is read after expressions resolve)', async () => {
    // `os.user.id` is null at seed time when no identity is supplied.
    const { counts, results } = await threeLoads([
      dataset(['name', 'code'], 'upsert', [{ name: 'A', code: 'a' }, { name: 'B', code: { dialect: 'cel', source: 'os.user.id' } }]),
    ]);

    expect(counts).toEqual([1, 1, 1]);
    const refused = blankKeyRefusals(results[0]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ field: 'code', recordIndex: 1 });
  });

  it('an `update` dataset reports the record instead of skipping it in silence', async () => {
    const { results } = await threeLoads([dataset('code', 'update', [{ name: 'B' }])]);
    const refused = blankKeyRefusals(results[0]);
    expect(refused).toHaveLength(1);
    expect(refused[0].message).toContain('so an update load can never find the row it names');
    expect(results[0].results[0]).toMatchObject({ errored: 1, inserted: 0, updated: 0 });
  });

  it('a dry run reports the refusal and logs nothing', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [dataset('code', 'upsert', [{ name: 'B' }])] as any[], config: { ...CONFIG, dryRun: true },
    });
    expect(blankKeyRefusals(result)).toHaveLength(1);
    expect(blankKeyLines(logger)).toEqual([]);
  });

  it('CONTROL: a fully keyed dataset converges on replay, refuses nothing and says nothing', async () => {
    const { counts, results, loggers } = await threeLoads([
      dataset(['name', 'code'], 'upsert', [{ name: 'A', code: 'a' }, { name: 'B', code: 'b' }]),
    ]);

    expect(counts).toEqual([2, 2, 2]);
    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
    }
    for (const logger of loggers) {
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    }
  });

  it('CONTROL: a whitespace-only key value is a value, as before (no trim)', async () => {
    const { counts, results } = await threeLoads([dataset('code', 'upsert', [{ name: 'A', code: ' ' }])]);
    expect(counts).toEqual([1, 1, 1]);
    expect(blankKeyRefusals(results[0])).toEqual([]);
  });
});

describe('[#28952] the boot loader — a keyed dataset whose every record keys empty', () => {
  it('refuses every record, one error each in the result, one line logged per dataset, and never writes', async () => {
    const { store, counts, results, loggers } = await threeLoads([
      dataset('no_such_field', 'upsert', [{ name: 'G1', code: 'g' }, { name: 'G2', code: 'h' }]),
    ]);

    expect(counts).toEqual([0, 0, 0]);
    expect(store.demo_other).toBeUndefined();
    for (const result of results) {
      expect(result.results[0]).toMatchObject({ object: 'demo_other', inserted: 0, errored: 2, total: 2 });
      const refused = blankKeyRefusals(result);
      expect(refused.map((e) => e.recordIndex)).toEqual([0, 1]);
      // The fix names the dataset-level remedy too: key on a field every record carries.
      expect(refused[0].message).toContain("or key the dataset on fields every record carries: a field the object declares");
    }
    for (const logger of loggers) {
      expect(blankKeyLines(logger)).toHaveLength(1);
      // No second, dataset-level report of the same records.
      expect(logger.warn).not.toHaveBeenCalled();
    }
  });

  it('a composite key with a member no record carries is refused the same way', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [dataset(['code', 'no_such_field'], 'ignore')] as any[], config: CONFIG,
    });
    const refused = blankKeyRefusals(result);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ field: 'no_such_field', recordIndex: 0 });
    expect(refused[0].message).toContain("keyed on externalId 'code+no_such_field' and leaves 'no_such_field' blank");
  });

  it('control: a retired `insert` dataset is refused before any key is read, so it carries no blank-key refusal (#34613)', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [dataset('no_such_field', 'insert')] as any[], config: CONFIG,
    });
    expect(result.results[0]).toMatchObject({ inserted: 0, errored: 1 });
    expect(blankKeyRefusals(result)).toEqual([]);
  });
});
