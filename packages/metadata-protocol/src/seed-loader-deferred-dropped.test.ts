// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * #5127 / #11674 — pass 2 RESOLVES the target; does it have a record to write
 * it onto?
 *
 * #5127's finding: `resolveDeferredUpdates()` looked the source record's
 * internal id up in `insertedRecords` (a natural-key map) and, when it wasn't
 * there, ran off the end of an `if` with no `else`: no write, no error entry
 * (so `success` stayed `true`), not one log line — only a dangling
 * `referencesDeferred` nothing explained. #5127 made both roads to that state
 * loud.
 *
 * #11674 then removed one of the roads at the root. Pass 2 now writes back
 * through the internal id CAPTURED AT INSERT TIME, so a row this load actually
 * wrote can always be written back to — a natural key is no longer required.
 * What used to be the "PURE SILENT LOSS" (row written fine, composite
 * externalId evaluated to `''`, so the natural-key map had no handle) is not a
 * loss at all any more: it HEALS, and the first describe below pins that.
 *
 * The road that remains — and stays pinned loud — is SOURCE ROW NEVER LANDED:
 * the pass-1 write failed (already reported at `error` by the write site,
 * #4729) or returned no id, so there is genuinely nothing to write onto. It is
 * recorded under the same objective criterion, as exactly ONE line that points
 * AT the pass-1 error rather than a second flood over the same root cause —
 * spelled by natural key when the record has one, by record index when it does
 * not (the keyless / empty-key spelling, pinned in the last describe).
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

describe('pass 2 heals a row whose natural key evaluated empty (#5127 → #11674)', () => {
  /**
   * What #5127 pinned here as "THE PURE SILENT LOSS" — row written fine,
   * composite externalId ['name', 'region'] evaluating to `''` because
   * `region` is blank, pass 2 resolving 'Alice' perfectly and then having no
   * handle to write her id onto — is exactly the structural defect #11674
   * removed: pass 2 no longer re-resolves the source row through its
   * externalId at all. The id the row got when it was INSERTED is captured
   * then and written back through now, so the empty key costs nothing.
   *
   * These pins flip #5127's loud-drop pins into healing pins on the SAME
   * scenario, so the two fixes cannot regress each other: if the write-back
   * handle is ever lost again, this load either drops loudly (#5127's
   * branches, still live for a row that never landed) or heals — silence over
   * a written row with a missing link has no branch left to come back through.
   */
  it('back-fills the reference by the internal id captured at insert — the empty key costs nothing', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: compositeSeeds(''),
      config: CONFIG,
    });

    // The row is there AND carries its association.
    const engineering = store.drop_department.find((r) => r.name === 'Engineering');
    expect(engineering, 'the department row was not seeded — wrong scenario').toBeDefined();
    const aliceId = store.drop_worker.find((r) => r.name === 'Alice')!.id;
    expect(engineering!.head_id).toBe(aliceId);
    // It went through the pass-2 back-fill write, by a REAL record id.
    expect(
      (engine.update as any).mock.calls.some(([obj]: [string]) => obj === 'drop_department'),
      'no back-fill write reached the department',
    ).toBe(true);

    // A healed load is a clean load.
    const deptResult = result.results.find((r: { object: string }) => r.object === 'drop_department')!;
    expect(deptResult.inserted).toBe(1);
    expect(deptResult.errored).toBe(0);
    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('says nothing at error OR warn — a healed deferral is not a degradation (#4632)', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();

    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: compositeSeeds(''),
      config: CONFIG,
    });

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * #5127's pairing invariant, unchanged in meaning: `referencesDeferred`
   * means "deferred references that never landed", only a SUCCESSFUL
   * back-fill decrements it, and a leftover count must have a matching entry
   * in `errors`. Here the back-fill SUCCEEDS, so the counter is given back —
   * zero left over, zero to explain — and the invariant loop still holds for
   * every result entry.
   */
  it('gives referencesDeferred back on the successful back-fill, leaving nothing dangling', async () => {
    const { engine } = createFaithfulEngine();

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: compositeSeeds(''),
      config: CONFIG,
    });

    const deptResult = result.results.find((r: { object: string }) => r.object === 'drop_department')!;
    expect(deptResult.referencesDeferred).toBe(0); // booked in pass 1, given back in pass 2
    expect(deptResult.referencesResolved).toBe(1);
    expect(deptResult.errors).toHaveLength(0);

    for (const entry of result.results) {
      if (entry.referencesDeferred > 0) {
        expect(
          entry.errors.length,
          `${entry.object} reports ${entry.referencesDeferred} deferred reference(s) that never landed and zero errors explaining them`,
        ).toBeGreaterThan(0);
      }
    }
    expect(result.summary.totalReferencesDeferred).toBe(0);
  });

  /**
   * The keyed sibling: same composite key, `region` filled in. The key
   * registers AND the internal id is captured, and the outcome is identical to
   * the empty-key case above — which is the point of #11674: keyedness no
   * longer decides whether a deferral can land, so the two paths are pinned to
   * the same healed outcome and cannot drift apart.
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

/**
 * The same "source row never landed" failure on a record with NO usable
 * natural key (#11674) — the composite key evaluates to `''` AND the pass-1
 * insert fails, so neither the captured-internal-id channel nor the
 * natural-key fallback can name a row. This is the one way left to reach the
 * empty-key drop branch: before #11674 that branch claimed "The row itself WAS
 * seeded" and prescribed fixing the externalId components, both of which would
 * be lies now (a row that seeds heals; the key is not the problem). The
 * rewritten line names the record by INDEX — the only handle a keyless record
 * has — and points at the pass-1 write error, exactly like its keyed sibling
 * above.
 */
describe('pass 2 finds no id because a KEYLESS record failed in pass 1 (#11674)', () => {
  function loadWithFailingKeylessDepartment() {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();
    const realInsert = (engine.insert as any).getMockImplementation();
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'drop_department') throw new Error('CHECK constraint failed: drop_department');
      return realInsert(obj, data, opts);
    });
    return { engine, store, logger };
  }

  it('records the drop, naming the record by index and pointing at the pass-1 error', async () => {
    const { engine, store, logger } = loadWithFailingKeylessDepartment();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: compositeSeeds(''), // region '' → externalIdKey '' → no natural key
      config: CONFIG,
    });

    // The row really is absent — nothing to back-fill onto.
    expect(store.drop_department ?? []).toHaveLength(0);
    expect(result.success).toBe(false);

    // Recorded: the row loss (pass 1) AND the link it would have carried.
    const dropped = result.errors.find(
      (e: { field: string; message?: string }) => e.field === 'head_id' && String(e.message).includes('Deferred reference dropped'),
    )!;
    expect(dropped, 'the dropped back-fill was not recorded as an error').toBeDefined();
    expect(dropped.message).toContain('no internal id was captured for drop_department record #0');
    expect(result.errors.length).toBeGreaterThan(1); // the pass-1 write error is still there too

    // Exactly ONE extra line, spelled by index (the only handle), pointing at
    // the pass-1 failure — not the old "fix your externalId" prescription.
    const lines = deferredDropLines(logger);
    expect(lines.length).toBe(1);
    const [message, err, meta] = lines[0];
    expect(String(message)).toContain('drop_department.head_id');
    expect(String(message)).toContain('record #0');
    expect(String(message)).toContain('pass-1 write FAILED');
    expect(String(message)).not.toContain('The row itself WAS seeded');
    expect(String(message)).not.toMatch(/non-empty value/);
    expect(String(message)).toMatch(/re-run the seed/);
    expect(err).toBeUndefined();
    expect(meta).toMatchObject({
      object: 'drop_department',
      field: 'head_id',
      target: 'drop_worker.name',
      recordIndex: 0,
      recordExternalId: '',
    });

    // The pass-1 write error is untouched — one line each, no flood.
    expect(
      logger.error.mock.calls.some((c: unknown[]) => String(c[0]).includes('CHECK constraint failed')),
      'the pass-1 write error stopped being reported',
    ).toBe(true);
  });
});
