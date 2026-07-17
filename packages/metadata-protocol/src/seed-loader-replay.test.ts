// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

/**
 * Replay regression: seeds with lookup natural keys must survive a dev-server
 * restart (the upsert UPDATE path), not just first boot (the INSERT path).
 *
 * Third-party eval 2026-07-17 (15.1.x): every restart, the seed replay's
 * update path wrote `candidate = NULL` for records whose lookup was authored
 * as a natural key — only a NOT NULL column stopped silent data corruption.
 *
 * Unlike seed-loader.test.ts's engine mock (whose find() ignores `where` and
 * returns the whole table — masking exactly this bug), this mock filters
 * `where` faithfully like a real engine.
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
          Object.entries(query.where).every(([k, v]) => r[k] === v),
        );
      }
      if (typeof query?.limit === 'number') {
        records = records.slice(0, query.limit);
      }
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
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    my_app_candidate: {
      name: 'my_app_candidate',
      fields: {
        name: { type: 'text' },
        email: { type: 'text' },
      },
    },
    my_app_interview: {
      name: 'my_app_interview',
      fields: {
        name: { type: 'text' },
        candidate: { type: 'lookup', reference: 'my_app_candidate', required: true },
        stage: { type: 'text' },
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

// Mirrors the AppPlugin inline-seed config (defaultMode upsert, multiPass on).
const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

// Parent's natural key is a non-`name` externalId (email) — the exact shape
// from the eval repro (interview.candidate: 'alice@example.com').
const SEEDS = [
  {
    object: 'my_app_candidate',
    externalId: 'email',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records: [
      { name: 'Alice Smith', email: 'alice@example.com' },
      { name: 'Bob Jones', email: 'bob@example.com' },
    ],
  },
  {
    object: 'my_app_interview',
    externalId: 'name',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records: [
      { name: 'iv-alice-1', candidate: 'alice@example.com', stage: 'screening' },
      { name: 'iv-bob-1', candidate: 'bob@example.com', stage: 'onsite' },
    ],
  },
] as any[];

/** No interview update may ever carry a NULL or unresolved (email-string) candidate. */
function corruptInterviewUpdates(engine: IDataEngine) {
  return (engine.update as any).mock.calls.filter(
    ([obj, data]: [string, any]) =>
      obj === 'my_app_interview' &&
      'candidate' in data &&
      (data.candidate == null || String(data.candidate).includes('@')),
  );
}

describe('seed replay (restart) — lookup natural keys on the update path', () => {
  it('keeps lookups pointing at the right parent after a second load (no NULL overwrite)', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // Boot #1 — fresh DB, insert path.
    const first = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });
    expect(first.success).toBe(true);

    const aliceId = store.my_app_candidate.find((r) => r.email === 'alice@example.com')!.id;
    const bobId = store.my_app_candidate.find((r) => r.email === 'bob@example.com')!.id;
    expect(store.my_app_interview.find((r) => r.name === 'iv-alice-1')!.candidate).toBe(aliceId);
    expect(store.my_app_interview.find((r) => r.name === 'iv-bob-1')!.candidate).toBe(bobId);

    // Boot #2 — same DB, new loader instance (dev-server restart): upsert
    // matches existing rows and takes the UPDATE path.
    const second = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    // The replay must not corrupt the association: still the right parent id,
    // never NULL (a nullable column would silently lose the link; a NOT NULL
    // column turns every replayed record into a constraint error).
    expect(store.my_app_interview.find((r) => r.name === 'iv-alice-1')!.candidate).toBe(aliceId);
    expect(store.my_app_interview.find((r) => r.name === 'iv-bob-1')!.candidate).toBe(bobId);
    expect(corruptInterviewUpdates(engine)).toEqual([]);

    expect(second.success).toBe(true);
    expect(second.summary.totalErrored).toBe(0);
  });

  it('replaying an unchanged seed is a no-op (skip, no update churn)', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });
    (engine.update as any).mockClear();
    const before = structuredClone(store);

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    // Nothing the seed declares changed → no update at all: updated_at stays
    // put, lifecycle validation (e.g. a state_machine rule) never re-fires.
    expect(engine.update).not.toHaveBeenCalled();
    expect(replay.summary.totalUpdated).toBe(0);
    expect(replay.summary.totalSkipped).toBe(4);
    expect(replay.summary.totalErrored).toBe(0);
    expect(store).toEqual(before);
  });

  it('a rejected parent update (state-machine style) must not cascade into NULLed child lookups', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });
    const aliceId = store.my_app_candidate.find((r) => r.email === 'alice@example.com')!.id;
    const bobId = store.my_app_candidate.find((r) => r.email === 'bob@example.com')!.id;

    // A user edited rows at runtime (the eval scenario: kanban drags changed
    // candidate stages, someone rescheduled an interview) — so the replay's
    // updates are NOT no-ops — and the object now vetoes the transition back
    // (my-app's `Invalid stage transition.`).
    for (const r of store.my_app_candidate) r.name = r.name + ' (edited)';
    for (const r of store.my_app_interview) r.stage = 'edited';
    const realUpdate = (engine.update as any).getMockImplementation();
    (engine.update as any).mockImplementation(async (objectName: string, data: any) => {
      if (objectName === 'my_app_candidate') throw new Error('Invalid stage transition.');
      return realUpdate(objectName, data);
    });

    const replay = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    // The candidate updates legitimately failed (reported), but the interview
    // records still resolved their parents and re-applied the seed values.
    expect(replay.summary.totalErrored).toBe(2);
    expect(store.my_app_interview.find((r) => r.name === 'iv-alice-1')!.candidate).toBe(aliceId);
    expect(store.my_app_interview.find((r) => r.name === 'iv-bob-1')!.candidate).toBe(bobId);
    expect(store.my_app_interview.every((r) => r.stage !== 'edited')).toBe(true);
    expect(corruptInterviewUpdates(engine)).toEqual([]);
  });

  it('resolves a lookup from the DB by the target dataset externalId when the parent dataset is absent', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // Parents already in the DB (seeded earlier / another load).
    await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });
    const aliceId = store.my_app_candidate.find((r) => r.email === 'alice@example.com')!.id;

    // A later load carries ONLY the child dataset, so the in-memory
    // insertedRecords map has no candidate entries — resolution must fall
    // back to the DB and query the candidate dataset's externalId (email),
    // not the hardcoded 'name' column.
    const childOnly = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [
        { ...SEEDS[0] }, // candidate dataset present but EMPTY → only its externalId declaration matters
        {
          object: 'my_app_interview',
          externalId: 'name',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'iv-alice-2', candidate: 'alice@example.com', stage: 'onsite' }],
        },
      ].map((s, idx) => (idx === 0 ? { ...s, records: [] } : s)) as any,
      config: CONFIG,
    });

    expect(childOnly.summary.totalErrored).toBe(0);
    expect(store.my_app_interview.find((r) => r.name === 'iv-alice-2')!.candidate).toBe(aliceId);
  });

  it('an unresolvable lookup never reaches the row: deferred pass leaves the column alone, single-pass drops the record', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });
    const aliceId = store.my_app_candidate.find((r) => r.email === 'alice@example.com')!.id;

    // Poison the seed: alice's interview now references a candidate that does
    // not exist anywhere. Change another field so the update is not a no-op.
    const poisoned = structuredClone(SEEDS);
    poisoned[1].records[0].candidate = 'ghost@example.com';
    poisoned[1].records[0].stage = 'changed';

    // multiPass: the update must NOT touch the candidate column (pass 2 also
    // fails → reported), preserving the existing association.
    const deferred = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: poisoned,
      config: CONFIG,
    });
    expect(deferred.success).toBe(false);
    expect(store.my_app_interview.find((r) => r.name === 'iv-alice-1')!.candidate).toBe(aliceId);
    expect(corruptInterviewUpdates(engine)).toEqual([]);

    // single-pass: the whole record is dropped (reported + counted), rather
    // than written with a corrupted reference.
    (engine.update as any).mockClear();
    const singlePass = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: poisoned,
      config: { ...CONFIG, multiPass: false },
    });
    expect(singlePass.success).toBe(false);
    expect(singlePass.summary.totalErrored).toBeGreaterThanOrEqual(1);
    expect(
      (engine.update as any).mock.calls.filter(([obj, data]: [string, any]) => obj === 'my_app_interview' && data.name === 'iv-alice-1'),
    ).toEqual([]);
    expect(store.my_app_interview.find((r) => r.name === 'iv-alice-1')!.candidate).toBe(aliceId);
  });
});
