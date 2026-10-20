// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { temporalComparandKind, temporalStorageForm } from '@objectstack/core';
import { SECRET_MASK, isMaskedOnReadFieldType } from '@objectstack/spec/data';

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

/**
 * [#24562] A `time` / `datetime` / `date` value the seed spells short, replayed
 * over the row a driver stored for it.
 *
 * The faithful engine above stores exactly what it is handed; a real driver
 * does not. `SqlDriver` and `InMemoryDriver` both write a temporal field
 * through `temporalStorageForm` (`@objectstack/core`, ADR-0053), so measured
 * on a SQLite file DB `'09:15'` lands as `'09:15:00'`,
 * `'2026-06-17T14:30:00Z'` as `'2026-06-17T14:30:00.000Z'`, and a `date`
 * written as an instant as its `YYYY-MM-DD`. The engine below does the same,
 * and stamps `updated_at` on every write the way the audit stamp does, so a
 * replay that rewrites an unchanged row shows as a moved stamp.
 *
 * Both write paths compare through `isNoOpReplay`: the batched
 * `decideWriteAction`, and the sequential `writeRecord` a self-referencing
 * object takes (`hasSelfRef`) — each case below asserts which one ran.
 */
describe('seed replay — a temporal value spelled short is the value the driver stored', () => {
  const ENTRY_FIELDS = {
    name: { type: 'text' },
    starts_at: { type: 'time' },
    logged_at: { type: 'datetime' },
    worked_on: { type: 'date' },
  };
  const ENTRY = { name: 'tz_replay_entry', fields: ENTRY_FIELDS };
  const TREE_ENTRY = {
    name: 'tz_replay_tree_entry',
    fields: { ...ENTRY_FIELDS, parent: { type: 'lookup', reference: 'tz_replay_tree_entry' } },
  };
  const PATHS = [
    { path: 'batched decideWriteAction', object: ENTRY, sequential: false },
    { path: 'sequential writeRecord', object: TREE_ENTRY, sequential: true },
  ];

  const SHORT_SPELLINGS: Array<Record<string, unknown>> = [
    { name: 'short-time', starts_at: '09:15' },
    { name: 'short-datetime', logged_at: '2026-06-17T14:30:00Z' },
    { name: 'zone-naive-datetime', logged_at: '2026-06-17 14:30' },
    { name: 'instant-date', worked_on: '2026-06-17T00:00:00Z' },
    // Control: already spelled the way the driver stores it.
    { name: 'stored-spelling', starts_at: '09:05:30', logged_at: '2026-06-17T14:30:00.000Z', worked_on: '2026-06-17' },
  ];

  function createStoringEngine(object: { name: string; fields: Record<string, { type: string }> }) {
    const { engine, store } = createFaithfulEngine();
    let clock = 0;
    const stored = (row: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...row, updated_at: `stamp-${++clock}` };
      for (const [key, value] of Object.entries(row)) {
        const kind = temporalComparandKind(object.fields[key]?.type);
        if (kind && value != null) out[key] = temporalStorageForm(value, kind);
      }
      return out;
    };
    const insert = (engine.insert as any).getMockImplementation();
    (engine.insert as any).mockImplementation(async (o: string, data: any, opts?: any) =>
      insert(o, Array.isArray(data) ? data.map(stored) : stored(data), opts));
    const update = (engine.update as any).getMockImplementation();
    (engine.update as any).mockImplementation(async (o: string, data: any, opts?: any) => update(o, stored(data), opts));
    return { engine, store };
  }

  function metadataOf(object: { name: string }): IMetadataService {
    return {
      getObject: vi.fn(async (name: string) => (name === object.name ? object : undefined)),
      listObjects: vi.fn(async () => [object]),
      register: vi.fn(async () => {}),
      get: vi.fn(async (_t: string, name: string) => (name === object.name ? object : undefined)),
      list: vi.fn(async () => []),
      unregister: vi.fn(async () => {}),
      exists: vi.fn(async () => false),
      listNames: vi.fn(async () => []),
    } as unknown as IMetadataService;
  }

  async function load(
    engine: IDataEngine,
    object: { name: string },
    mode: string,
    records: Array<Record<string, unknown>>,
  ) {
    const writeRecord = vi.spyOn(SeedLoaderService.prototype as any, 'writeRecord');
    try {
      const result = await new SeedLoaderService(engine, metadataOf(object), createLogger()).load({
        seeds: [{ object: object.name, externalId: 'name', mode, env: ['prod', 'dev', 'test'], records }] as any,
        config: CONFIG,
      });
      return { result, writeRecordCalls: writeRecord.mock.calls.length };
    } finally {
      writeRecord.mockRestore();
    }
  }

  const rowOf = (store: Record<string, any[]>, object: { name: string }, name: string) =>
    store[object.name].find((r) => r.name === name)!;
  const updatedNames = (engine: IDataEngine, store: Record<string, any[]>, object: { name: string }) =>
    (engine.update as any).mock.calls
      .map(([, data]: [string, any]) => store[object.name].find((r) => r.id === data.id)?.name)
      .sort();

  it.each(PATHS.flatMap((p) => ['upsert', 'update'].map((mode) => ({ ...p, mode }))))(
    '$path, mode $mode: replaying the unchanged seed issues no update and moves no updated_at',
    async ({ object, sequential, mode }) => {
      const { engine, store } = createStoringEngine(object);
      const first = await load(engine, object, 'upsert', SHORT_SPELLINGS);
      expect(first.result.summary.totalInserted).toBe(5);
      // The premise: what the column holds is the driver's spelling, not the seed's.
      expect(rowOf(store, object, 'short-time').starts_at).toBe('09:15:00');
      expect(rowOf(store, object, 'short-datetime').logged_at).toBe('2026-06-17T14:30:00.000Z');
      expect(rowOf(store, object, 'zone-naive-datetime').logged_at).toBe('2026-06-17T14:30:00.000Z');
      expect(rowOf(store, object, 'instant-date').worked_on).toBe('2026-06-17');
      (engine.update as any).mockClear();
      const before = structuredClone(store);

      const replay = await load(engine, object, mode, SHORT_SPELLINGS);

      expect(replay.writeRecordCalls > 0).toBe(sequential);
      expect(engine.update).not.toHaveBeenCalled();
      expect(replay.result.summary.totalUpdated).toBe(0);
      expect(replay.result.summary.totalSkipped).toBe(5);
      expect(replay.result.summary.totalErrored).toBe(0);
      expect(store).toEqual(before);
    },
  );

  it.each(PATHS)('$path: a changed wall clock, instant or day is still rewritten, and only its row', async ({ object, sequential }) => {
    const { engine, store } = createStoringEngine(object);
    await load(engine, object, 'upsert', SHORT_SPELLINGS);
    (engine.update as any).mockClear();
    const before = structuredClone(store);
    const changed = SHORT_SPELLINGS.map((r) =>
      r.name === 'short-time' ? { ...r, starts_at: '09:16' }
        : r.name === 'short-datetime' ? { ...r, logged_at: '2026-06-17T14:30:01Z' }
          : r.name === 'instant-date' ? { ...r, worked_on: '2026-06-18T00:00:00Z' }
            : r);

    const replay = await load(engine, object, 'upsert', changed);

    expect(replay.writeRecordCalls > 0).toBe(sequential);
    expect(updatedNames(engine, store, object)).toEqual(['instant-date', 'short-datetime', 'short-time']);
    expect(replay.result.summary.totalUpdated).toBe(3);
    expect(replay.result.summary.totalSkipped).toBe(2);
    expect(rowOf(store, object, 'short-time').starts_at).toBe('09:16:00');
    expect(rowOf(store, object, 'short-datetime').logged_at).toBe('2026-06-17T14:30:01.000Z');
    expect(rowOf(store, object, 'instant-date').worked_on).toBe('2026-06-18');
    for (const name of ['zone-naive-datetime', 'stored-spelling']) {
      expect(rowOf(store, object, name)).toEqual(before[object.name].find((r) => r.name === name));
    }
  });

  it.each(PATHS)('$path: a value the storage rule cannot read still reads as changed', async ({ object, sequential }) => {
    const { engine, store } = createStoringEngine(object);
    await load(engine, object, 'upsert', SHORT_SPELLINGS);
    (engine.update as any).mockClear();
    const unreadable = SHORT_SPELLINGS.map((r) =>
      r.name === 'short-time' ? { ...r, starts_at: 'quarter past nine' }
        : r.name === 'short-datetime' ? { ...r, logged_at: 'not-a-date' }
          : r);

    const replay = await load(engine, object, 'upsert', unreadable);

    expect(replay.writeRecordCalls > 0).toBe(sequential);
    expect(updatedNames(engine, store, object)).toEqual(['short-datetime', 'short-time']);
    expect(replay.result.summary.totalUpdated).toBe(2);
    expect(replay.result.summary.totalSkipped).toBe(3);
  });
});

/**
 * [#24624] A `password` or `secret` value replayed over the row the engine
 * stored for it.
 *
 * The engine never reads a credential back: `ObjectQL.maskSecretFields` serves
 * every `secret` field, and every `password` field on an object that is not
 * `managedBy: 'better-auth'`, as `SECRET_MASK` on `find` / `findOne` — in every
 * context, the seed's system read included (ADR-0100) — and an unset one as
 * `null`. So the replay holds the seed's plaintext on one side and the mask on
 * the other, and no comparison of the two can say whether the value changed.
 * Ruled (letter B): such a field never blocks the skip, and a load that skipped
 * a row without comparing one says so in one line.
 *
 * The engine below stores what a real one stores — a `password` verbatim, a
 * `secret` as an opaque ref — stamps `updated_at` on every write, and masks on
 * read by the spec's declaration (`isMaskedOnReadFieldType`, the predicate the
 * engine's own collector asks), returning copies so the mask never reaches the
 * store.
 */
describe('seed replay — a credential the read path masks never blocks the skip', () => {
  const VAULT_FIELDS = {
    name: { type: 'text' },
    note: { type: 'text' },
    pin: { type: 'password' },
    api_key: { type: 'secret' },
  };
  const VAULT = { name: 'cred_replay_vault', fields: VAULT_FIELDS };
  const TREE_VAULT = {
    name: 'cred_replay_tree_vault',
    fields: { ...VAULT_FIELDS, parent: { type: 'lookup', reference: 'cred_replay_tree_vault' } },
  };
  type VaultObject = { name: string; managedBy?: string; fields: Record<string, { type: string }> };
  const PATHS: Array<{ path: string; object: VaultObject; sequential: boolean }> = [
    { path: 'batched decideWriteAction', object: VAULT, sequential: false },
    { path: 'sequential writeRecord', object: TREE_VAULT, sequential: true },
  ];

  const SEED_ROWS: Array<Record<string, unknown>> = [
    { name: 'with-password', note: 'n1', pin: 'hunter2' },
    { name: 'with-secret', note: 'n2', api_key: 'sk-live-1' },
    { name: 'with-both', note: 'n3', pin: 'swordfish', api_key: 'sk-live-2' },
    { name: 'no-credential', note: 'n4' },
  ];

  function createMaskingEngine(object: VaultObject) {
    const { engine, store } = createFaithfulEngine();
    let clock = 0;
    let handle = 0;
    const stored = (row: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...row, updated_at: `stamp-${++clock}` };
      for (const [key, value] of Object.entries(row)) {
        if (object.fields[key]?.type === 'secret' && value != null) out[key] = `secret:h${++handle}`;
      }
      return out;
    };
    const masked = (row: Record<string, unknown>) => {
      const out = { ...row };
      for (const [key, def] of Object.entries(object.fields)) {
        if (key in out && isMaskedOnReadFieldType(def.type, object.managedBy)) {
          out[key] = out[key] == null ? null : SECRET_MASK;
        }
      }
      return out;
    };
    const insert = (engine.insert as any).getMockImplementation();
    (engine.insert as any).mockImplementation(async (o: string, data: any, opts?: any) =>
      insert(o, Array.isArray(data) ? data.map(stored) : stored(data), opts));
    const update = (engine.update as any).getMockImplementation();
    (engine.update as any).mockImplementation(async (o: string, data: any, opts?: any) => update(o, stored(data), opts));
    const find = (engine.find as any).getMockImplementation();
    (engine.find as any).mockImplementation(async (o: string, query?: any) =>
      ((await find(o, query)) as Array<Record<string, unknown>>).map(masked));
    return { engine, store };
  }

  function metadataOf(object: VaultObject): IMetadataService {
    return {
      getObject: vi.fn(async (name: string) => (name === object.name ? object : undefined)),
      listObjects: vi.fn(async () => [object]),
      register: vi.fn(async () => {}),
      get: vi.fn(async (_t: string, name: string) => (name === object.name ? object : undefined)),
      list: vi.fn(async () => []),
      unregister: vi.fn(async () => {}),
      exists: vi.fn(async () => false),
      listNames: vi.fn(async () => []),
    } as unknown as IMetadataService;
  }

  async function load(
    engine: IDataEngine,
    object: VaultObject,
    mode: string,
    records: Array<Record<string, unknown>>,
  ) {
    const logger = createLogger();
    const writeRecord = vi.spyOn(SeedLoaderService.prototype as any, 'writeRecord');
    try {
      const result = await new SeedLoaderService(engine, metadataOf(object), logger).load({
        seeds: [{ object: object.name, externalId: 'name', mode, env: ['prod', 'dev', 'test'], records }] as any,
        config: CONFIG,
      });
      return { result, logger, writeRecordCalls: writeRecord.mock.calls.length };
    } finally {
      writeRecord.mockRestore();
    }
  }

  const rowOf = (store: Record<string, any[]>, object: VaultObject, name: string) =>
    store[object.name].find((r) => r.name === name)!;
  const updatedNames = (engine: IDataEngine, store: Record<string, any[]>, object: VaultObject) =>
    (engine.update as any).mock.calls
      .map(([, data]: [string, any]) => store[object.name].find((r) => r.id === data.id)?.name)
      .sort();
  /** The load's notice lines: the ones naming the uncompared credential rule. */
  const credentialNotices = (logger: ReturnType<typeof createLogger>) =>
    [...logger.info.mock.calls, ...logger.warn.mock.calls]
      .map(([message]) => String(message))
      .filter((message) => message.includes('masked on read'));

  it.each(PATHS.flatMap((p) => ['upsert', 'update'].map((mode) => ({ ...p, mode }))))(
    '$path, mode $mode: replaying the unchanged seed issues no update and moves no updated_at',
    async ({ object, sequential, mode }) => {
      const { engine, store } = createMaskingEngine(object);
      const first = await load(engine, object, 'upsert', SEED_ROWS);
      expect(first.result.summary.totalInserted).toBe(4);
      // The premise: the store holds the credential, the read hands back the mask.
      expect(rowOf(store, object, 'with-password').pin).toBe('hunter2');
      expect(String(rowOf(store, object, 'with-secret').api_key)).toMatch(/^secret:h\d+$/);
      expect((await engine.find(object.name, {}))[0].pin).toBe(SECRET_MASK);
      (engine.update as any).mockClear();
      const before = structuredClone(store);

      const replay = await load(engine, object, mode, SEED_ROWS);

      expect(replay.writeRecordCalls > 0).toBe(sequential);
      expect(engine.update).not.toHaveBeenCalled();
      expect(replay.result.summary.totalUpdated).toBe(0);
      expect(replay.result.summary.totalSkipped).toBe(4);
      expect(replay.result.summary.totalErrored).toBe(0);
      expect(store).toEqual(before);
    },
  );

  it.each(PATHS)('$path: a credential-only seed change is not rewritten, and the load says so in one line', async ({ object, sequential }) => {
    const { engine, store } = createMaskingEngine(object);
    await load(engine, object, 'upsert', SEED_ROWS);
    (engine.update as any).mockClear();
    const before = structuredClone(store);
    const credentialOnly = SEED_ROWS.map((r) =>
      r.name === 'with-password' ? { ...r, pin: 'hunter3' }
        : r.name === 'with-secret' ? { ...r, api_key: 'sk-live-9' }
          : r);

    const replay = await load(engine, object, 'upsert', credentialOnly);

    expect(replay.writeRecordCalls > 0).toBe(sequential);
    expect(engine.update).not.toHaveBeenCalled();
    expect(replay.result.summary.totalSkipped).toBe(4);
    expect(store).toEqual(before);
    // ONE line for the whole load, naming every field it left uncompared,
    // the rule, and the two ways a credential-only change takes effect.
    const notices = credentialNotices(replay.logger);
    expect(notices).toHaveLength(1);
    expect(replay.logger.info.mock.calls.map(([m]) => String(m))).toContain(notices[0]);
    expect(notices[0]).toContain(`${object.name}.pin`);
    expect(notices[0]).toContain(`${object.name}.api_key`);
    expect(notices[0]).toMatch(/another field/);
    expect(notices[0]).toMatch(/rebuild/);
  });

  it.each(PATHS)('$path: a change to another field rewrites the row, and the credential lands as the seed declares it', async ({ object, sequential }) => {
    const { engine, store } = createMaskingEngine(object);
    await load(engine, object, 'upsert', SEED_ROWS);
    (engine.update as any).mockClear();
    const secretRefBefore = rowOf(store, object, 'with-secret').api_key;
    const changed = SEED_ROWS.map((r) =>
      r.name === 'with-password' ? { ...r, note: 'n1-edited', pin: 'hunter3' }
        : r.name === 'with-secret' ? { ...r, note: 'n2-edited', api_key: 'sk-live-9' }
          : r);

    const replay = await load(engine, object, 'upsert', changed);

    expect(replay.writeRecordCalls > 0).toBe(sequential);
    expect(updatedNames(engine, store, object)).toEqual(['with-password', 'with-secret']);
    expect(replay.result.summary.totalUpdated).toBe(2);
    expect(rowOf(store, object, 'with-password').pin).toBe('hunter3');
    expect(rowOf(store, object, 'with-password').note).toBe('n1-edited');
    // The update carried the seed's plaintext, so the engine wrote a new ref.
    expect((engine.update as any).mock.calls.find(([, d]: [string, any]) => d.note === 'n2-edited')[1].api_key).toBe('sk-live-9');
    expect(rowOf(store, object, 'with-secret').api_key).not.toBe(secretRefBefore);
  });

  it.each(PATHS)('$path: the read still tells set from unset, so setting or clearing a credential is written', async ({ object, sequential }) => {
    const { engine, store } = createMaskingEngine(object);
    await load(engine, object, 'upsert', SEED_ROWS);
    (engine.update as any).mockClear();
    const presenceChanged = SEED_ROWS.map((r) =>
      r.name === 'no-credential' ? { ...r, pin: 'first-pin' }
        : r.name === 'with-password' ? { ...r, pin: null }
          : r);

    const replay = await load(engine, object, 'upsert', presenceChanged);

    expect(replay.writeRecordCalls > 0).toBe(sequential);
    expect(updatedNames(engine, store, object)).toEqual(['no-credential', 'with-password']);
    expect(rowOf(store, object, 'no-credential').pin).toBe('first-pin');
    expect(rowOf(store, object, 'with-password').pin).toBeNull();
  });

  it('a field the declaration does not mask keeps comparing, even when it holds the mask\'s text', async () => {
    const object = VAULT;
    const { engine, store } = createMaskingEngine(object);
    await load(engine, object, 'upsert', [{ name: 'literal-bullets', note: SECRET_MASK }]);
    (engine.update as any).mockClear();

    const replay = await load(engine, object, 'upsert', [{ name: 'literal-bullets', note: 'plain note' }]);

    expect(updatedNames(engine, store, object)).toEqual(['literal-bullets']);
    expect(rowOf(store, object, 'literal-bullets').note).toBe('plain note');
    expect(credentialNotices(replay.logger)).toEqual([]);
  });

  it('a load that skips no row with an uncompared credential says nothing about the rule', async () => {
    const object = VAULT;
    const { engine } = createMaskingEngine(object);
    await load(engine, object, 'upsert', SEED_ROWS);

    const changedOnly = await load(
      engine,
      object,
      'upsert',
      SEED_ROWS.filter((r) => 'pin' in r || 'api_key' in r).map((r) => ({ ...r, note: `${r.note}-edited` })),
    );
    const noCredential = await load(engine, object, 'upsert', SEED_ROWS.filter((r) => r.name === 'no-credential'));

    expect(changedOnly.result.summary.totalUpdated).toBe(3);
    expect(credentialNotices(changedOnly.logger)).toEqual([]);
    expect(noCredential.result.summary.totalSkipped).toBe(1);
    expect(credentialNotices(noCredential.logger)).toEqual([]);
  });
});
