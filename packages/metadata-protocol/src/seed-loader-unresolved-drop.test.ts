// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
// `.js` extension deliberately: under `moduleResolution: nodenext` an
// extensionless relative import does not resolve, every symbol it names
// degrades to `any`, and the callbacks below then report TS7006 — the trap
// AGENTS.md → "Build & Test" describes. Both spellings exist in this package's
// tests; this one is the one tsc can actually read.
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

/**
 * framework#4997: a record DROPPED because its reference cannot be resolved —
 * and no pass 2 will run — must be LOUD in the console too, not only in the
 * result object.
 *
 * The branch's own comment claimed "LOUD: counted + reported" while it made no
 * logger call at all, so a seed that silently dropped N records looked exactly
 * like a clean one on the console. The only difference was whether the caller
 * inspected `result.success` — and several `packages/runtime` seed call sites
 * just `await` the load and carry on. This is the deeper notch of #4729's
 * finding (count says "error", log level says *nothing*), which that PR could
 * not see because its audit criterion was the file's `logger.warn` calls, and
 * `pnpm check:durability-log-level` cannot see it either: this is not a
 * `try`/`catch`.
 *
 * Pinned here, per AGENTS.md → "Degradation log levels" (#4632):
 *  - the DROPPED-record branch logs at `error`, naming the consequence (the
 *    WHOLE record was not seeded) and every remedy;
 *  - the same objective criterion — does this outcome enter
 *    `errors`/`allErrors`? — applied to the file's other never-logged branch,
 *    "deferred reference unresolved after pass 2";
 *  - the DRY-RUN branch stays deliberately QUIET (its caller reads the result
 *    by definition; a loud line about a simulated outcome trains readers to
 *    skim `error`), which is a decision and therefore pinned as one.
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
      assertEngineUpdateDispatch(data, undefined);
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

/** `drop_order.customer_id` → `drop_customer`; no cycle, so nothing defers. */
function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    drop_customer: {
      name: 'drop_customer',
      fields: { name: { type: 'text' } },
    },
    drop_order: {
      name: 'drop_order',
      fields: {
        name: { type: 'text' },
        customer_id: { type: 'lookup', reference: 'drop_customer' },
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

const SINGLE_PASS = {
  dryRun: false,
  haltOnError: false,
  multiPass: false,
  defaultMode: 'insert',
  batchSize: 1000,
  transaction: false,
} as any;

/** Record #0 seeds cleanly; record #1 points at a customer that does not exist. */
const ORDERS = [
  {
    object: 'drop_order',
    externalId: 'name',
    mode: 'insert',
    env: ['prod', 'dev', 'test'],
    records: [
      { name: 'ORD-1' },
      { name: 'ORD-2', customer_id: 'Ghost Inc' },
    ],
  },
] as any[];

describe('a record dropped for an unresolvable reference is logged, not only counted (framework#4997)', () => {
  it('logs at ERROR naming the object, the record, the field, the target and every remedy', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: ORDERS,
      config: SINGLE_PASS,
    });

    // The loss is real: ORD-2 was not written at all (not "written without the
    // link" — that is the referencesDropped shape, a different branch).
    expect(store.drop_order.map((r) => r.name)).toEqual(['ORD-1']);

    // Mutation pin: before #4997 this path made NO logger call whatsoever.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, cause, meta] = (logger.error as any).mock.calls[0];

    // WHAT was lost — object, record ordinal, field, target, attempted value.
    expect(message).toContain('drop_order');
    expect(message).toContain('record #1');
    expect(message).toContain('customer_id');
    expect(message).toContain('drop_customer.name');
    expect(message).toContain('Ghost Inc');

    // CONSEQUENCE (#4632): the WHOLE record is gone, not just the association.
    expect(message).toContain('NOT seeded AT ALL');
    expect(message).toContain('WHOLE');

    // REMEDY (#4632) — all three routes the issue names.
    expect(message).toContain('seed drop_customer BEFORE drop_order');
    expect(message).toContain('multiPass');
    expect(message).toContain('fix the natural key');
    expect(message).toMatch(/re-run the seed/);

    // Structured payload per the `Logger` contract's `(message, error, meta)`.
    // There is no thrown Error behind this one — nothing failed, the target
    // simply is not there — so the error slot is deliberately undefined.
    expect(cause).toBeUndefined();
    expect(meta).toMatchObject({
      object: 'drop_order',
      field: 'customer_id',
      target: 'drop_customer.name',
      recordIndex: 1,
    });

    // Mutation pin: not `warn` — the level #4729 aligned everywhere else here.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is still COUNTED and reported, which is what the log level now agrees with', async () => {
    const { engine } = createFaithfulEngine();

    const result = await new SeedLoaderService(engine, createMetadata(), createLogger()).load({
      seeds: ORDERS,
      config: SINGLE_PASS,
    });

    expect(result.success).toBe(false);
    expect(result.summary.totalErrored).toBe(1);
    expect(result.summary.totalInserted).toBe(1);
    // A dropped RECORD, never a dropped FIELD — the two counters mean different
    // losses and must not blur (framework#3932).
    expect(result.summary.totalReferencesDropped).toBe(0);
    expect(result.results[0].errored).toBe(1);
    // Row counters still reconcile against the dataset total.
    const r = result.results[0];
    expect(r.inserted + r.updated + r.skipped + r.errored).toBe(r.total);

    const error = result.errors.find((e) => e.field === 'customer_id')!;
    expect(error.message).toContain('Cannot resolve reference: drop_order.customer_id');
    expect(error.recordIndex).toBe(1);
    expect(error.attemptedValue).toBe('Ghost Inc');
  });

  it('a load where every reference resolves logs nothing loud (do not train readers to skim `error`)', async () => {
    const { engine } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [
        {
          object: 'drop_customer',
          externalId: 'name',
          mode: 'insert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Ghost Inc' }],
        },
        ORDERS[0],
      ] as any,
      config: SINGLE_PASS,
    });

    expect(result.success).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('a DRY RUN reports the same miss in the result and stays quiet (framework#4997)', () => {
  it('carries the note in result.errors while the console says nothing', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: ORDERS,
      config: { ...SINGLE_PASS, dryRun: true },
    });

    // A dry run writes nothing, so nothing was lost.
    expect(store.drop_order).toBeUndefined();
    expect(engine.insert).not.toHaveBeenCalled();

    // The caller of a dry run is by definition reading the result — the note is
    // there, in full.
    expect(result.dryRun).toBe(true);
    expect(result.success).toBe(false);
    const note = result.errors.find((e) => e.field === 'customer_id')!;
    expect(note.message).toContain('[dry-run] Reference may not resolve');
    expect(note.message).toContain('drop_order.customer_id');
    expect(note.message).toContain('Ghost Inc');
    expect(note.recordIndex).toBe(1);

    // …and the console stays QUIET. This is a DECISION, not an oversight: an
    // `error` line about a SIMULATED outcome is the over-application AGENTS.md
    // warns about. Deleting the `if (config.dryRun)` guard's quietness — i.e.
    // logging here like the real-run branch does — must turn this red.
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

/**
 * The same objective criterion (#5001 style: does this outcome enter
 * `errors`/`allErrors`?) applied to the file's OTHER never-logged branch. Its
 * sibling — the pass-2 back-fill whose WRITE fails — has logged at `error`
 * since #4729; "the target never materialized" was counted identically and
 * logged nowhere.
 */
describe('a deferred reference still unresolved after pass 2 is logged too (framework#4997)', () => {
  const CIRCULAR = {
    ...SINGLE_PASS,
    multiPass: true,
  } as any;

  function createCircularMetadata(): IMetadataService {
    const objects: Record<string, any> = {
      drop_team: {
        name: 'drop_team',
        fields: {
          name: { type: 'text' },
          lead_id: { type: 'lookup', reference: 'drop_person' },
        },
      },
      drop_person: {
        name: 'drop_person',
        fields: {
          name: { type: 'text' },
          team_id: { type: 'lookup', reference: 'drop_team' },
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

  it('logs at ERROR naming the row, the NULL reference, the missing target and the remedy', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    const result = await new SeedLoaderService(engine, createCircularMetadata(), logger).load({
      seeds: [
        {
          object: 'drop_team',
          externalId: 'name',
          mode: 'insert',
          env: ['prod', 'dev', 'test'],
          // 'Nobody' is never seeded and is not in the database — pass 2 cannot
          // rescue it, so the deferred reference is permanently NULL.
          records: [{ name: 'Platform', lead_id: 'Nobody' }],
        },
      ] as any,
      config: CIRCULAR,
    });

    // The ROW landed (unlike the pass-1 drop above) — only the link is missing.
    expect(store.drop_team.map((r) => r.name)).toEqual(['Platform']);
    expect(store.drop_team[0].lead_id == null).toBe(true);

    // Mutation pin: this branch made no logger call before #4997.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, , meta] = (logger.error as any).mock.calls[0];
    expect(message).toContain('drop_team.lead_id');
    expect(message).toContain("record 'Platform'");
    expect(message).toContain('drop_person.name');
    expect(message).toContain('Nobody');
    // CONSEQUENCE + REMEDY.
    expect(message).toContain('stays NULL');
    expect(message).toContain('counter looks healthy');
    expect(message).toMatch(/re-run the seed/);
    expect(meta).toMatchObject({ object: 'drop_team', field: 'lead_id', recordIndex: 0 });
    expect(logger.warn).not.toHaveBeenCalled();

    // …and it was already counted — the half the log level now agrees with.
    expect(result.success).toBe(false);
    expect(result.summary.totalErrored).toBe(1);
    expect(result.errors.some((e) => e.message.includes('unresolved after pass 2'))).toBe(true);
  });
});
