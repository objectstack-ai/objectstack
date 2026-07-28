// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

/**
 * framework#2805: a pass-2 (deferred) reference back-fill that FAILS must be
 * reported — not silently swallowed.
 *
 * Two records reference each other (a circular dependency). The parent is
 * inserted first without the back-reference (deferred to pass 2); pass 2 then
 * issues an `engine.update` to fill the reference in. Before this fix, if that
 * update threw, `resolveDeferredUpdates` only logged a warning: the reference
 * stayed NULL yet the loader still returned `success: true`, `errors: []`,
 * `totalErrored: 0` — an incomplete relationship reported as a clean load.
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
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) { records[idx] = { ...records[idx], ...data }; return records[idx]; }
      return data;
    }),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

// Two objects that reference each other → a circular dependency that forces
// the multi-pass deferred back-fill (audit_department.head_id is filled in
// during pass 2, once audit_worker "Alice" exists).
function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    audit_department: {
      name: 'audit_department',
      fields: {
        name: { type: 'text' },
        head_id: { type: 'lookup', reference: 'audit_worker' },
      },
    },
    audit_worker: {
      name: 'audit_worker',
      fields: {
        name: { type: 'text' },
        department_id: { type: 'lookup', reference: 'audit_department' },
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

const SEEDS = [
  {
    object: 'audit_department',
    externalId: 'name',
    mode: 'insert',
    env: ['prod', 'dev', 'test'],
    records: [{ name: 'Engineering', head_id: 'Alice' }],
  },
  {
    object: 'audit_worker',
    externalId: 'name',
    mode: 'insert',
    env: ['prod', 'dev', 'test'],
    records: [{ name: 'Alice', department_id: 'Engineering' }],
  },
] as any[];

/**
 * #3760 — the pass-2 back-fill is still SEEDING, so it must carry `skipTriggers`
 * like every other seed write. It used to inline a bare `{ isSystem: true }`,
 * and `isSystem` does NOT suppress record-change dispatch — only `skipTriggers`
 * does. So the forward-reference patch pass re-fired "on update" automation over
 * freshly seeded business rows: the exact self-trigger vector SEED_OPTIONS
 * exists to prevent, on the one write that skipped it.
 */
describe('the deferred back-fill seeds with automation suppressed (#3760)', () => {
  it("pass-2's reference update carries skipTriggers, like every other seed write", async () => {
    const { engine } = createFaithfulEngine();
    const metadata = createMetadata();

    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });

    const deferredUpdates = (engine.update as any).mock.calls.filter(
      ([obj]: [string]) => obj === 'audit_department',
    );
    expect(deferredUpdates.length, 'the pass-2 back-fill did not run').toBeGreaterThan(0);
    for (const [, , opts] of deferredUpdates) {
      expect(opts?.context?.skipTriggers, 'a seed write fired record-change automation').toBe(true);
      expect(opts?.context?.isSystem).toBe(true);
    }
  });
});

describe('seed deferred back-fill failure is reported, not swallowed (framework#2805)', () => {
  it('a failing pass-2 reference update flips success=false and counts an error', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // The ONLY update in this load is pass-2's back-fill of
    // audit_department.head_id. Make every attempt fail (a persistent
    // "fetch failed" outlasts the transient-retry budget) so the deferred
    // reference genuinely never lands.
    const realUpdate = (engine.update as any).getMockImplementation();
    let deptUpdateAttempts = 0;
    (engine.update as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'audit_department') {
        deptUpdateAttempts++;
        throw new Error('fetch failed');
      }
      return realUpdate(obj, data, opts);
    });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    // The back-fill was attempted (and exhausted its retries).
    expect(deptUpdateAttempts).toBeGreaterThan(0);

    // The relationship is genuinely incomplete: Engineering.head_id is still null.
    const engineeringRow = store.audit_department.find((r) => r.name === 'Engineering')!;
    expect(engineeringRow.head_id == null).toBe(true);

    // ...so the load must NOT report clean success.
    expect(result.success).toBe(false);
    expect(result.summary.totalErrored).toBeGreaterThan(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e: { field: string }) => e.field === 'head_id')).toBe(true);
  });

  it('a transient blip that recovers on retry still reports clean success', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // First back-fill attempt blips, the retry succeeds — the reference lands,
    // so this is NOT an error.
    const realUpdate = (engine.update as any).getMockImplementation();
    let deptUpdateAttempts = 0;
    (engine.update as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'audit_department') {
        deptUpdateAttempts++;
        if (deptUpdateAttempts === 1) throw new Error('fetch failed');
      }
      return realUpdate(obj, data, opts);
    });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    expect(deptUpdateAttempts).toBe(2); // blipped once, then succeeded
    const aliceId = store.audit_worker.find((r) => r.name === 'Alice')!.id;
    expect(store.audit_department.find((r) => r.name === 'Engineering')!.head_id).toBe(aliceId);
    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
  });
});
