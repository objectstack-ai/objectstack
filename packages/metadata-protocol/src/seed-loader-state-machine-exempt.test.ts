// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

/**
 * #3433 — a curated seed is a snapshot of ESTABLISHED facts (a project already
 * `completed`, an opportunity `closed_won`), not a record walking its lifecycle.
 * When an object declares `state_machine.initialStates` (#3165), the write path
 * enforces that INSERTS are born in an initial state — which silently rejects
 * every mid-lifecycle seed row and cascades its master-detail children ("installed
 * but no data"). So SeedLoaderService marks its writes `seedReplay`, and the engine
 * skips the state_machine rule for them.
 *
 * The engine that actually enforces this lives in @objectstack/objectql, which
 * DEPENDS ON this package — importing it back would cycle. So this mock engine
 * reproduces the exact insert-time guard (reject a state ∉ initialStates UNLESS the
 * write carries `context.seedReplay`) to regression-test the loader's end of the
 * contract in isolation. Revert the `seedReplay` flag in `SEED_OPTIONS` and both
 * cases below go red — 4 of 5 rows rejected, the flag absent from the writes.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const PROJECT = {
  name: 'showcase_project',
  fields: {
    name: { type: 'text' },
    status: { type: 'select' },
  },
  validations: [
    {
      type: 'state_machine',
      name: 'project_status_flow',
      field: 'status',
      initialStates: ['planned'],
      transitions: {
        planned: ['active', 'cancelled'],
        active: ['on_hold', 'completed', 'cancelled'],
      },
      message: 'Invalid project status transition.',
    },
  ],
};

/** Reproduces the objectql insert-time initialStates guard, honoring the #3433 exemption. */
function enforceInitialStates(data: Record<string, unknown>, opts: any): void {
  if (opts?.context?.seedReplay === true) return; // #3433 exemption
  const sm = PROJECT.validations[0];
  const value = data[sm.field];
  if (value == null || value === '') return;
  if (!sm.initialStates.includes(String(value))) {
    const err: any = new Error(
      `invalid_initial_state: ${sm.field} '${String(value)}' not in [${sm.initialStates.join(', ')}]`,
    );
    err.code = 'VALIDATION_FAILED';
    throw err;
  }
}

function createEnforcingEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
  const store: Record<string, any[]> = {};
  let idCounter = 0;
  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let rows = store[objectName] || [];
      if (query?.where) {
        rows = rows.filter((r) => Object.entries(query.where).every(([k, v]) => r[k] === v));
      }
      if (typeof query?.limit === 'number') rows = rows.slice(0, query.limit);
      return rows;
    }),
    findOne: vi.fn(async () => null),
    // Per-row partial-success path the seed loader prefers (framework#3172):
    // one verdict per row, so a rejected row is culled, not thrown as a batch.
    insertMany: vi.fn(async (objectName: string, rows: any[], opts: any) =>
      rows.map((r) => {
        try {
          enforceInitialStates(r, opts);
          const record = { id: `gen-${++idCounter}`, ...r };
          (store[objectName] ||= []).push(record);
          return { ok: true, record };
        } catch (error) {
          return { ok: false, error };
        }
      }),
    ),
    insert: vi.fn(async (objectName: string, data: any, opts: any) => {
      const rows = Array.isArray(data) ? data : [data];
      const written = rows.map((r) => {
        enforceInitialStates(r, opts); // throws on violation (whole-array semantics)
        const record = { id: `gen-${++idCounter}`, ...r };
        (store[objectName] ||= []).push(record);
        return record;
      });
      return Array.isArray(data) ? written : written[0];
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      const rows = store[objectName] || [];
      const idx = rows.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...data };
        return rows[idx];
      }
      return data;
    }),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async (o: string) => (store[o] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;
  return { engine, store };
}

function createMetadata(): IMetadataService {
  return {
    getObject: vi.fn(async (name: string) => (name === PROJECT.name ? PROJECT : undefined)),
    listObjects: vi.fn(async () => [PROJECT]),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => (name === PROJECT.name ? PROJECT : undefined)),
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

// A seed that deliberately spans the lifecycle: 1 born-initial + 4 mid-lifecycle,
// exactly like the showcase project board (one card per Kanban column).
const SEED = [
  {
    object: 'showcase_project',
    externalId: 'name',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records: [
      { name: 'Mobile App', status: 'planned' },
      { name: 'Website Relaunch', status: 'active' },
      { name: 'Data Platform', status: 'active' },
      { name: 'Compliance Audit', status: 'on_hold' },
      { name: 'Legacy Sunset', status: 'completed' },
    ],
  },
] as any[];

describe('seed loader — state_machine initialStates exemption (#3433)', () => {
  it('inserts every mid-lifecycle row on a fresh DB (no initialStates rejection)', async () => {
    const { engine, store } = createEnforcingEngine();
    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: SEED,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);
    expect(result.summary.totalInserted).toBe(5);
    expect(store.showcase_project).toHaveLength(5);
    // The exact spread the showcase board needs — proof no state was dropped.
    expect(store.showcase_project.map((r) => r.status).sort()).toEqual([
      'active',
      'active',
      'completed',
      'on_hold',
      'planned',
    ]);
  });

  it('threads seedReplay into every project write (the flag the engine keys off)', async () => {
    const { engine } = createEnforcingEngine();
    await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: SEED,
      config: CONFIG,
    });

    // Whichever write path the loader took (insertMany batch or a per-row
    // fallback), its options must carry the exemption flag — that is what the
    // engine reads to skip the state_machine rule.
    const writeCalls = [
      ...(engine.insertMany as any).mock.calls,
      ...(engine.insert as any).mock.calls,
    ].filter(([obj]) => obj === 'showcase_project');
    expect(writeCalls.length).toBeGreaterThan(0);
    for (const call of writeCalls) {
      expect(call[2]?.context?.seedReplay).toBe(true);
    }
  });
});
