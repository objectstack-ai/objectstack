// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoadResultSchema, SeedLoaderResultSchema } from '@objectstack/spec/data';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * framework#4998: a roll-up summary recompute that exhausts its retries must be
 * LOUD and COUNTED.
 *
 * The recovery itself is correct and unchanged (framework#3147): the rows WERE
 * written, so re-writing them would duplicate. What was wrong was the
 * consequence's rank. A roll-up summary is a persisted DERIVED column on the
 * parent record, so after this the database is internally inconsistent — the
 * detail rows say one thing and the column summarizing them says another — and
 * nothing recomputes it until some later write touches the same parent, which
 * after a seed may never happen. The whole event used to be one `warn`: the
 * load counted no error, `success` stayed `true`, and no caller could detect it
 * programmatically.
 *
 * So both halves are pinned here, because shipping either alone was the defect:
 * the `error` line (with its consequence and its remedy) AND
 * `summariesStale` / `summary.totalSummariesStale`.
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

/**
 * Two independent objects — no references between them, so nothing is deferred
 * and each dataset's counters stand on their own.
 */
function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    roll_invoice: { name: 'roll_invoice', fields: { name: { type: 'text' }, total: { type: 'number' } } },
    roll_payment: { name: 'roll_payment', fields: { name: { type: 'text' }, amount: { type: 'number' } } },
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
  defaultMode: 'ignore',
  batchSize: 1000,
  transaction: false,
} as any;

const seedFor = (object: string, records: any[]) => ({
  object,
  externalId: 'name',
  mode: 'ignore',
  env: ['prod', 'dev', 'test'],
  records,
});

/**
 * Make `object`'s ARRAY insert write its rows and then report a post-write
 * roll-up recompute failure — objectql's `SummaryRecomputeError` shape
 * (framework#3147), matched across the package boundary by `code`.
 */
function failSummaryRecompute(
  engine: IDataEngine,
  object: string,
  failures: Array<{ childObject: string; parentObject: string; parentId: string; field: string; error: unknown }>,
) {
  const realInsert = (engine.insert as any).getMockImplementation();
  (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
    if (obj === object && Array.isArray(data)) {
      const written = await realInsert(obj, data, opts);
      throw Object.assign(
        new Error(
          `Roll-up summary recompute failed after retries for ${failures.length} parent record(s); ` +
          `the triggering records WERE written (summary values may be stale).`,
        ),
        { code: 'ERR_SUMMARY_RECOMPUTE', written, failures },
      );
    }
    return realInsert(obj, data, opts);
  });
}

const FAILURES = [
  { childObject: 'roll_invoice', parentObject: 'roll_account', parentId: 'acc-1', field: 'total_billed', error: new Error('deadlock detected') },
  { childObject: 'roll_invoice', parentObject: 'roll_account', parentId: 'acc-2', field: 'total_billed', error: new Error('deadlock detected') },
];

describe('a roll-up summary left stale by a seed is loud and counted (framework#4998)', () => {
  it('logs at ERROR naming the object, the stale column, the consequence and the remedy', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    failSummaryRecompute(engine, 'roll_invoice', FAILURES);

    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [seedFor('roll_invoice', [{ name: 'INV-1', total: 10 }, { name: 'INV-2', total: 20 }])] as any,
      config: CONFIG,
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, cause, meta] = (logger.error as any).mock.calls[0];

    // NAMES the object being seeded and the persisted column that is now wrong.
    expect(message).toContain('roll_invoice');
    expect(message).toContain('roll_account.total_billed');

    // CONSEQUENCE — #4632 requires it in the line that prints, and the specific
    // trap here is that everything else still reads healthy.
    expect(message).toContain('STALE');
    expect(message).toContain('disagree with the detail rows');
    expect(message).toContain('success: true');

    // REMEDY — both routes back to a correct summary.
    expect(message).toContain('re-run the seed');
    expect(message).toContain('trigger any write on the affected parent record(s)');

    // The original cause travels with it, structurally (not just pasted in).
    expect(message).toContain('Cause: Roll-up summary recompute failed after retries');
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('the triggering records WERE written');
    expect(meta).toMatchObject({ object: 'roll_invoice', summariesStale: 2 });
    expect(meta.summaryColumns).toEqual(['roll_account.total_billed']);
    expect(meta.failures.map((f: any) => f.parentId)).toEqual(['acc-1', 'acc-2']);
    expect(meta.failures[0].error).toBe('deadlock detected');

    // Mutation pin: reverting to the pre-#4998 `warn` must turn this red. The
    // AST gate (`pnpm check:durability-log-level`, `performSeedWrite` in its
    // DURABILITY_CRITICAL_CALLEES) fails on the same revert in CI.
    const warned = (logger.warn as any).mock.calls.map(([m]: [string]) => m).join('\n');
    expect(warned).not.toContain('summary');
  });

  it('counts it in the result — per object and in the summary — so a caller can branch on it', async () => {
    const { engine, store } = createFaithfulEngine();
    failSummaryRecompute(engine, 'roll_invoice', FAILURES);

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: [seedFor('roll_invoice', [{ name: 'INV-1', total: 10 }, { name: 'INV-2', total: 20 }])] as any,
      config: CONFIG,
    });

    // Mutation pin: the pre-#4998 behaviour counted NOTHING anywhere.
    expect(result.results[0].summariesStale).toBe(2);
    expect(result.summary.totalSummariesStale).toBe(2);

    // …while every other counter stays truthful: the rows DID land, exactly
    // once, so `errored` must not move and the reconciliation still holds.
    expect(result.summary.totalErrored).toBe(0);
    expect(result.summary.totalInserted).toBe(2);
    expect(store.roll_invoice).toHaveLength(2);

    // `success` deliberately stays true — it answers "did the rows land", and
    // they did. Flipping it would report `success: false` with an EMPTY errors
    // array to the protocol seed-apply surface and fail package/marketplace
    // installs that wrote every row; the counter above carries the signal.
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('attributes the count to the dataset that caused it, leaving clean datasets at 0', async () => {
    const { engine } = createFaithfulEngine();
    failSummaryRecompute(engine, 'roll_invoice', FAILURES);

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: [
        seedFor('roll_invoice', [{ name: 'INV-1', total: 10 }, { name: 'INV-2', total: 20 }]),
        seedFor('roll_payment', [{ name: 'PAY-1', amount: 5 }]),
      ] as any,
      config: CONFIG,
    });

    const byObject = Object.fromEntries(result.results.map((r) => [r.object, r.summariesStale]));
    expect(byObject).toEqual({ roll_invoice: 2, roll_payment: 0 });
    expect(result.summary.totalSummariesStale).toBe(2);
  });

  it('stays quiet and counts 0 when every recompute succeeds', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [seedFor('roll_invoice', [{ name: 'INV-1', total: 10 }])] as any,
      config: CONFIG,
    });

    expect(logger.error).not.toHaveBeenCalled();
    expect(result.results[0].summariesStale).toBe(0);
    expect(result.summary.totalSummariesStale).toBe(0);
    expect(result.success).toBe(true);
  });

  it('a load with no datasets reports 0 rather than omitting the counter', async () => {
    const { engine } = createFaithfulEngine();

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: [] as any,
      config: CONFIG,
    });

    expect(result.summary.totalSummariesStale).toBe(0);
  });
});

describe('the counter survives the contract, and the contract survives older payloads', () => {
  it('is carried THROUGH SeedLoaderResultSchema.parse — not stripped as an unknown key', async () => {
    const { engine } = createFaithfulEngine();
    failSummaryRecompute(engine, 'roll_invoice', FAILURES);

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: [seedFor('roll_invoice', [{ name: 'INV-1', total: 10 }, { name: 'INV-2', total: 20 }])] as any,
      config: CONFIG,
    });

    // The declared shape is what consumers actually receive over a parse
    // boundary. A field the runtime sets but the schema does not declare would
    // vanish HERE, silently — which is why #4998 could not be closed inside
    // metadata-protocol alone.
    const parsed = SeedLoaderResultSchema.parse(result);
    expect(parsed.summary.totalSummariesStale).toBe(2);
    expect(parsed.results[0].summariesStale).toBe(2);
  });

  it('defaults to 0 for a payload written before the field existed', () => {
    // Proving the `.default(0)` claim rather than asserting it: this is exactly
    // a pre-#4998 producer's output, and it must still parse.
    const legacyPerObject = {
      object: 'roll_invoice',
      mode: 'ignore',
      inserted: 2, updated: 0, skipped: 0, errored: 0, total: 2,
      referencesResolved: 0, referencesDeferred: 0,
      errors: [],
    };
    expect(SeedLoadResultSchema.parse(legacyPerObject).summariesStale).toBe(0);

    const legacyResult = {
      success: true,
      dryRun: false,
      dependencyGraph: { nodes: [], insertOrder: [], circularDependencies: [] },
      results: [legacyPerObject],
      errors: [],
      summary: {
        objectsProcessed: 1, totalRecords: 2, totalInserted: 2, totalUpdated: 0,
        totalSkipped: 0, totalErrored: 0, totalReferencesResolved: 0,
        totalReferencesDeferred: 0, circularDependencyCount: 0, durationMs: 1,
      },
    };
    expect(SeedLoaderResultSchema.parse(legacyResult).summary.totalSummariesStale).toBe(0);
  });
});

/**
 * [#35655] The other half of a seed and a roll-up: a seed never stores a
 * value it supplies for a `summary` field (maintainer ruling D, as analysed in
 * 7062334196; the seat's correction 7064615114). The loader takes it out of
 * the record before the write, and the engine computes the column from the
 * child rows. The drop is reported by one `warn` per dataset naming the
 * object, the fields and the count: that notice is the report, and no
 * load-result key carries it. These pins read the engine's CALLS and the
 * notice, so they hold whatever the engine would do with the key; the stored
 * outcome on the real engine is pinned in
 * `packages/objectql/src/seed-summary-never-stored.test.ts`.
 */
describe('a seed never hands the engine a roll-up value (#35655)', () => {
  const ROLLUP_OBJECTS: Record<string, any> = {
    drop_invoice: {
      name: 'drop_invoice',
      fields: {
        name: { type: 'text' },
        total: { type: 'number' },
        paid: { type: 'summary', summaryOperations: { object: 'drop_payment', field: 'amount', function: 'sum' } },
        payments: { type: 'summary', readonly: true, summaryOperations: { object: 'drop_payment', field: 'amount', function: 'count' } },
      },
    },
  };
  function rollUpMetadata(objects: Record<string, any> = ROLLUP_OBJECTS): IMetadataService {
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
  const writtenKeys = (engine: IDataEngine, verb: 'insert' | 'update') =>
    (engine[verb] as any).mock.calls
      .filter(([object]: [string]) => object === 'drop_invoice')
      .flatMap(([, data]: [string, any]) => (Array.isArray(data) ? data : [data]).map((row: any) => Object.keys(row)));
  /** The roll-up drop notices the load logged: `[message, meta]` per `warn`. */
  const dropNotices = (logger: ReturnType<typeof createLogger>) =>
    (logger.warn as any).mock.calls.filter(([m]: [string]) => m.includes('roll-up summary'));

  it('on insert: neither roll-up reaches the engine, the rest of the row does, and one notice names the object, fields and count', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, rollUpMetadata(), logger).load({
      seeds: [seedFor('drop_invoice', [
        { name: 'INV-1', total: 10, paid: 3000, payments: 4 },
        { name: 'INV-2', total: 20, paid: null },
        { name: 'INV-3', total: 30 },
      ])] as any,
      config: CONFIG,
    });

    for (const keys of writtenKeys(engine, 'insert')) {
      expect(keys).not.toContain('paid');
      expect(keys).not.toContain('payments');
    }
    expect(store.drop_invoice.map((r) => r.total)).toEqual([10, 20, 30]);
    // The rest of each record landed: nothing about the drop is an error.
    expect(result.results[0]).toMatchObject({ inserted: 3, errored: 0 });
    expect(result.success).toBe(true);
    // A supplied `null` is a supplied value too: three values, two fields, ONE notice.
    const drops = dropNotices(logger);
    expect(drops).toHaveLength(1);
    expect(drops[0][1]).toEqual({ object: 'drop_invoice', fields: ['paid', 'payments'], droppedValues: 3 });
    expect(drops[0][0]).toContain('drop_invoice');
    expect(drops[0][0]).toContain('`paid`, `payments`');
    // The notice is the whole report: the load result carries no key for it.
    expect(Object.keys(result.results[0])).not.toContain('summariesDropped');
  });

  it('on a matched row (upsert): the update carries no roll-up, a roll-up-only difference writes nothing, and the notice still speaks', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();
    store.drop_invoice = [{ id: 'inv-1', name: 'INV-1', total: 10, paid: 42, payments: 2 }];

    const result = await new SeedLoaderService(engine, rollUpMetadata(), logger).load({
      seeds: [{ ...seedFor('drop_invoice', [
        { name: 'INV-1', total: 10, paid: 999, payments: 99 },
      ]), mode: 'upsert' }] as any,
      config: CONFIG,
    });

    expect(writtenKeys(engine, 'update')).toEqual([]);
    expect(store.drop_invoice[0]).toMatchObject({ paid: 42, payments: 2 });
    expect(result.results[0]).toMatchObject({ updated: 0, skipped: 1 });
    expect(dropNotices(logger).map(([, meta]: [string, any]) => meta)).toEqual([
      { object: 'drop_invoice', fields: ['paid', 'payments'], droppedValues: 2 },
    ]);
  });

  it('on a matched row whose other columns changed: the update writes them and still no roll-up', async () => {
    const { engine, store } = createFaithfulEngine();
    store.drop_invoice = [{ id: 'inv-1', name: 'INV-1', total: 10, paid: 42, payments: 2 }];

    const result = await new SeedLoaderService(engine, rollUpMetadata(), createLogger()).load({
      seeds: [{ ...seedFor('drop_invoice', [
        { name: 'INV-1', total: 11, paid: 999, payments: 99 },
      ]), mode: 'upsert' }] as any,
      config: CONFIG,
    });

    const keys = writtenKeys(engine, 'update');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('total');
    expect(keys[0]).not.toContain('paid');
    expect(keys[0]).not.toContain('payments');
    expect(store.drop_invoice[0]).toMatchObject({ total: 11, paid: 42, payments: 2 });
    expect(result.results[0]).toMatchObject({ updated: 1 });
  });

  it('a dry run (validate) gives the same notice and writes nothing', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();

    await new SeedLoaderService(engine, rollUpMetadata(), logger).validate(
      [seedFor('drop_invoice', [{ name: 'INV-1', total: 10, paid: 3000 }])] as any,
    );

    expect(writtenKeys(engine, 'insert')).toEqual([]);
    expect(dropNotices(logger).map(([, meta]: [string, any]) => meta)).toEqual([
      { object: 'drop_invoice', fields: ['paid'], droppedValues: 1 },
    ]);
  });

  it('CONTROL: a field the definition does not type `summary` is written as authored, and no notice is logged', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();
    const plain = { drop_invoice: { name: 'drop_invoice', fields: { name: { type: 'text' }, total: { type: 'number' }, paid: { type: 'currency' } } } };

    await new SeedLoaderService(engine, rollUpMetadata(plain), logger).load({
      seeds: [seedFor('drop_invoice', [{ name: 'INV-1', total: 10, paid: 3000 }])] as any,
      config: CONFIG,
    });

    expect(writtenKeys(engine, 'insert')[0]).toContain('paid');
    expect(dropNotices(logger)).toEqual([]);
  });
});
