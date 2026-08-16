// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

/**
 * #5127 — pass 2 RESOLVES the target and then has no record to write it onto.
 *
 * `resolveDeferredUpdates()` looked the source record's internal id up in
 * `insertedRecords` and, when it wasn't there, ran off the end of an `if`
 * with no `else`: no write, no `errors`/`allErrors` entry (so `success` stayed
 * `true`), no `errored`, not one log line. The single trace left behind was the
 * `referencesDeferred` the record booked in pass 1 and never gave back — only a
 * SUCCESSFUL back-fill decrements it — i.e. a result object carrying a dangling
 * number with nothing in it that explains the number.
 *
 * It is the deeper cousin of the two branches on either side of it: #4729 fixed
 * "counted, but logged at `warn`"; #4997 fixed "counted, never logged"; this one
 * was "never counted, never logged".
 *
 * The two ways to reach it are NOT the same failure and are pinned separately:
 *
 *  - PURE SILENT LOSS — the row wrote perfectly, but its natural key was never
 *    registered because `externalIdKey` returned `''` (any component of a
 *    composite externalId absent or blank). NOTHING else in the load reports
 *    anything: this is the only signal that will ever exist. Mandatory coverage.
 *  - SOURCE ROW NEVER LANDED — its pass-1 write failed, which the write site
 *    already reported at `error` (#4729). Still recorded here under the same
 *    objective criterion, but as exactly ONE line that points AT that error
 *    rather than a second flood over the same root cause.
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

  return { engine, store };
}

// Two objects that reference each other → a circular dependency, which is what
// forces the multi-pass deferral: `drop_department.head_id` cannot resolve until
// `drop_worker` "Alice" exists, so pass 1 defers it and pass 2 back-fills it.
// `drop_department` additionally carries a `region`, so a dataset can key it on
// the COMPOSITE ['name', 'region'] and leave one component blank.
function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    drop_department: {
      name: 'drop_department',
      fields: {
        name: { type: 'text' },
        region: { type: 'text' },
        head_id: { type: 'lookup', reference: 'drop_worker' },
      },
    },
    drop_worker: {
      name: 'drop_worker',
      fields: {
        name: { type: 'text' },
        department_id: { type: 'lookup', reference: 'drop_department' },
      },
    },
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
  defaultMode: 'insert',
  batchSize: 1000,
  transaction: false,
} as any;

/** Composite-keyed department seed; `region` decides whether its key registers. */
const compositeSeeds = (region: string) => [
  {
    object: 'drop_department',
    externalId: ['name', 'region'],
    mode: 'insert',
    env: ['prod', 'dev', 'test'],
    records: [{ name: 'Engineering', region, head_id: 'Alice' }],
  },
  {
    object: 'drop_worker',
    externalId: 'name',
    mode: 'insert',
    env: ['prod', 'dev', 'test'],
    records: [{ name: 'Alice', department_id: 'Engineering' }],
  },
] as any[];

const deferredDropLines = (logger: ReturnType<typeof createLogger>) =>
  logger.error.mock.calls.filter((c: unknown[]) => String(c[0]).includes('Deferred reference DROPPED'));

describe('pass 2 resolves the target but the source record has no id (#5127)', () => {
  /**
   * (c) THE PURE SILENT LOSS — the case that must be covered.
   *
   * The department row is written successfully and sits in the database. Its
   * composite externalId ['name', 'region'] evaluates to `''` because `region`
   * is blank, so `externalIdKey` returns the empty key and nothing registers it
   * in `insertedRecords`. Pass 2 then resolves 'Alice' perfectly and finds no id
   * to write onto. No other site in the loader says a word about this: before
   * the fix the entire outcome was one un-explained `referencesDeferred: 1`.
   */
  it('reports the back-fill it had to drop, with the row itself seeded fine', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: compositeSeeds(''),
      config: CONFIG,
    });

    // The row IS there — this is not a write failure. That is the whole point:
    // every row counter reads healthy.
    const engineering = store.drop_department.find((r) => r.name === 'Engineering');
    expect(engineering, 'the department row was not seeded — wrong scenario').toBeDefined();
    const deptResult = result.results.find((r: { object: string }) => r.object === 'drop_department')!;
    expect(deptResult.inserted).toBe(1);
    expect(deptResult.errored).toBe(1);

    // …while the association it declared is permanently absent.
    expect(engineering!.head_id == null).toBe(true);
    // Nothing was even attempted against the department (no id to update).
    expect(
      (engine.update as any).mock.calls.some(([obj]: [string]) => obj === 'drop_department'),
      'a back-fill write was attempted without a record id',
    ).toBe(false);

    // So the load must NOT report clean success — it used to.
    expect(result.success).toBe(false);
    expect(result.summary.totalErrored).toBe(1);
    const dropped = result.errors.find((e: { field: string }) => e.field === 'head_id')!;
    expect(dropped, 'the dropped back-fill was not recorded as an error').toBeDefined();
    expect(dropped.sourceObject).toBe('drop_department');
    expect(dropped.targetObject).toBe('drop_worker');
    expect(dropped.recordIndex).toBe(0);
    expect(dropped.message).toContain('Deferred reference dropped');
    expect(dropped.message).toContain('name+region');
  });

  it('logs it exactly once at ERROR, naming the empty key, the consequence and the fix (#4632)', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();

    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: compositeSeeds(''),
      config: CONFIG,
    });

    // ONE line — and, since nothing else in this load fails, the ONLY error line.
    const lines = deferredDropLines(logger);
    expect(lines.length, 'the dropped back-fill was not logged exactly once at error').toBe(1);
    expect(logger.error.mock.calls.length).toBe(1);

    const [message, err, meta] = lines[0];
    // Locating info: object, field, target, and which record.
    expect(String(message)).toContain('drop_department.head_id');
    expect(String(message)).toContain('drop_worker.name');
    // The consequence, concretely.
    expect(String(message)).toContain('stays NULL');
    expect(String(message)).toContain('The row itself WAS seeded');
    // WHY there is no id — the empty composite key, named.
    expect(String(message)).toContain('`name+region`');
    expect(String(message)).toContain('EMPTY key');
    // The fix.
    expect(String(message)).toMatch(/non-empty value/);
    expect(String(message)).toMatch(/re-run the seed/);
    // Logger contract is `(message, error, meta)`; there is no thrown error here.
    expect(err).toBeUndefined();
    expect(meta).toMatchObject({
      object: 'drop_department',
      field: 'head_id',
      target: 'drop_worker.name',
      recordIndex: 0,
      recordExternalId: '',
    });

    // NOT downgraded to warn — the level the count has to agree with.
    expect(
      logger.warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('DROPPED')),
      'the dropped back-fill is being reported at warn',
    ).toBe(false);
  });

  /**
   * The result object may no longer carry a `referencesDeferred` that nothing
   * explains. The counter itself keeps its meaning — "deferred references that
   * never landed", decremented only by a SUCCESSFUL back-fill, exactly as the
   * two sibling failure branches leave it — so what this pins is the pairing:
   * a leftover count now always has a matching entry in `errors`.
   */
  it('leaves no dangling referencesDeferred without an error explaining it', async () => {
    const { engine } = createFaithfulEngine();

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: compositeSeeds(''),
      config: CONFIG,
    });

    const deptResult = result.results.find((r: { object: string }) => r.object === 'drop_department')!;
    expect(deptResult.referencesDeferred).toBe(1); // booked in pass 1, never landed
    expect(deptResult.errors.length).toBe(1); // …and now explained
    expect(deptResult.errors[0].field).toBe('head_id');

    for (const entry of result.results) {
      if (entry.referencesDeferred > 0) {
        expect(
          entry.errors.length,
          `${entry.object} reports ${entry.referencesDeferred} deferred reference(s) that never landed and zero errors explaining them`,
        ).toBeGreaterThan(0);
      }
    }
    expect(result.summary.totalReferencesDeferred).toBe(1);
  });

  /**
   * (b) The control: same composite key, `region` filled in. The key registers,
   * pass 2 back-fills normally, and the new branch stays out of the way — which
   * proves the failure above is caused by the EMPTY key, not by composite keys.
   */
  it('a composite key whose components are all present back-fills normally and says nothing', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: compositeSeeds('APAC'),
      config: CONFIG,
    });

    const aliceId = store.drop_worker.find((r) => r.name === 'Alice')!.id;
    expect(store.drop_department.find((r) => r.name === 'Engineering')!.head_id).toBe(aliceId);
    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
    expect(result.summary.totalReferencesDeferred).toBe(0); // decremented by the successful back-fill
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

/**
 * (c, other half) THE SOURCE ROW NEVER LANDED.
 *
 * A real natural key ('Engineering'), but its pass-1 insert failed, so no id was
 * ever registered for it. That failure was ALREADY reported at `error` by the
 * write site (#4729), so the dropped back-fill is recorded under the same
 * criterion and logged as exactly ONE additional line — one that points at the
 * pass-1 error instead of restating it. This case is distinguishable from the
 * pure loss above by its message and by the non-empty `recordExternalId`.
 */
describe('pass 2 finds no id because the source row failed in pass 1 (#5127)', () => {
  const SEEDS = [
    {
      object: 'drop_department',
      externalId: 'name',
      mode: 'insert',
      env: ['prod', 'dev', 'test'],
      records: [{ name: 'Engineering', region: 'APAC', head_id: 'Alice' }],
    },
    {
      // No `department_id` value: this dataset exists to make the dependency
      // graph circular (the FIELD is declared in metadata), not to add a second
      // deferred update that would muddy the assertions below.
      object: 'drop_worker',
      externalId: 'name',
      mode: 'insert',
      env: ['prod', 'dev', 'test'],
      records: [{ name: 'Alice' }],
    },
  ] as any[];

  function loadWithFailingDepartmentInsert() {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();
    const realInsert = (engine.insert as any).getMockImplementation();
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      // A validation-style (non-transient) rejection: the row genuinely never lands.
      if (obj === 'drop_department') throw new Error('CHECK constraint failed: drop_department');
      return realInsert(obj, data, opts);
    });
    return { engine, store, logger };
  }

  it('records the dropped back-fill and points at the already-reported pass-1 error', async () => {
    const { engine, store, logger } = loadWithFailingDepartmentInsert();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    // The row really is absent — nothing to back-fill onto.
    expect(store.drop_department ?? []).toHaveLength(0);
    expect(result.success).toBe(false);

    // Two DISTINCT losses are reported: the row, and the link it would have carried.
    const dropped = result.errors.find(
      (e: { field: string; message?: string }) => e.field === 'head_id' && String(e.message).includes('Deferred reference dropped'),
    )!;
    expect(dropped, 'the dropped back-fill was not recorded as an error').toBeDefined();
    expect(dropped.message).toContain("no internal id was registered for drop_department 'Engineering'");
    expect(result.errors.length).toBeGreaterThan(1); // …the pass-1 write error is still there too

    // Exactly ONE extra line for the dropped back-fill — no second flood over
    // the same root cause — and it sends the reader to the pass-1 error.
    const lines = deferredDropLines(logger);
    expect(lines.length).toBe(1);
    const [message, err, meta] = lines[0];
    expect(String(message)).toContain('drop_department.head_id');
    expect(String(message)).toContain("record 'Engineering'");
    expect(String(message)).toContain('pass-1 write FAILED');
    expect(String(message)).toMatch(/re-run the seed/);
    expect(err).toBeUndefined();
    expect(meta).toMatchObject({
      object: 'drop_department',
      field: 'head_id',
      recordExternalId: 'Engineering',
    });

    // The pass-1 write error (#4729) is untouched — this fix adds a line, it
    // does not replace or suppress the one that was already correct.
    expect(
      logger.error.mock.calls.some((c: unknown[]) => String(c[0]).includes('CHECK constraint failed')),
      'the pass-1 write error stopped being reported',
    ).toBe(true);
  });

  it('does not claim the reference "stays NULL" on a row that was never written', async () => {
    const { engine, logger } = loadWithFailingDepartmentInsert();

    await new SeedLoaderService(engine, createMetadata(), logger).load({ seeds: SEEDS, config: CONFIG });

    // The pure-loss wording would be a lie here: there is no row to hold a NULL,
    // and telling the reader to fix an externalId component sends them nowhere.
    const [message] = deferredDropLines(logger)[0];
    expect(String(message)).not.toContain('EMPTY key');
    expect(String(message)).not.toContain('stays NULL');
  });
});
