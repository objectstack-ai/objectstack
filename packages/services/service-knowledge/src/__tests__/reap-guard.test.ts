// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4672 — the knowledge index is de-indexed BEFORE the retention sweep deletes
 * the row it projects.
 *
 * A knowledge index built from an `object` source is a per-record projection
 * keyed by `sourceRecordId`. `LifecycleService`'s reap deletes rows by
 * predicate and ADR-0057 §3.3 forbids fanning that out per record, so before
 * this the row vanished and its document stayed: an orphan that still occupies
 * a `topK` slot and is read straight through by an `isSystem` caller.
 *
 * These cases drive the REAL `LifecycleService` rather than a stand-in for it.
 * That matters most for the composition case: the property under test (#5535 —
 * guards compose by intersection, so the knowledge guard cannot displace
 * `service-storage`'s byte-reclaim guard) is a property of the CONSUMER. A fake
 * registry would only prove that the fake intersects, which is the shape of a
 * test that passes because nothing is produced.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  LifecycleService,
  assertEngineDeleteDispatch,
  type LifecycleObjectLike,
} from '@objectstack/objectql';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import type { IKnowledgeAdapter } from '@objectstack/spec/contracts';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';
import type { KnowledgeService } from '../knowledge-service.js';

const FIXED_NOW = 1_700_000_000_000;
const OLD = '2020-01-01T00:00:00Z'; // comfortably past every cutoff below

/** `task` is knowledge-backed; `audit_log` is the untouched control object. */
const OBJECTS: LifecycleObjectLike[] = [
  { name: 'task', lifecycle: { class: 'transient', ttl: { field: 'deleted_at', expireAfter: '30d' } } },
  { name: 'audit_log', lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } } },
];

function noteSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'task_notes',
    label: 'Task notes',
    adapter: 'fake',
    source: { kind: 'object', object: 'task', contentFields: ['notes'] },
    ...overrides,
  } as KnowledgeSource;
}

/**
 * Fake ObjectQL engine backing the sweep.
 *
 * `delete` opens with the producer's own dispatch predicate, so this double
 * cannot accept a call the real engine refuses (#4550/#4434) — including the
 * `id: { $in: [...] }` shape a hand-mirrored guard always lets through.
 */
function reapEngine(seed: Record<string, Array<Record<string, unknown>>>) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  // `id` widened to what the producer's dispatch actually resolves to — the
  // double takes the predicate's word for the type, it does not narrow it.
  const deleted: Array<{ object: string; id: string | number | bigint }> = [];

  const engine: any = {
    registry: { getAllObjects: () => OBJECTS },
    async find(object: string) {
      return [...(store.get(object) ?? [])];
    },
    async delete(object: string, options: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      if (dispatch.kind === 'by-id') {
        const rows = store.get(object) ?? [];
        store.set(object, rows.filter((r) => String(r.id) !== String(dispatch.id)));
        deleted.push({ object, id: dispatch.id });
        return true;
      }
      // The batched reap never issues one, but the double must not be looser
      // than the engine about the shape either.
      const before = (store.get(object) ?? []).length;
      store.set(object, []);
      return before;
    },
    getDriverForObject: () => undefined,
    datasource(name: string) {
      throw new Error(`[ObjectQL] Datasource '${name}' not found`);
    },
  };

  return {
    engine,
    deleted,
    idsLeft: (object: string) => (store.get(object) ?? []).map((r) => String(r.id)),
  };
}

/** Adapter that records every de-index, and can be told to fail for some ids. */
function fakeAdapter(failFor: string[] = []) {
  const deletedDocs: string[] = [];
  const reasons: Array<string | undefined> = [];
  const adapter: IKnowledgeAdapter = {
    id: 'fake',
    upsert: async () => undefined,
    search: async () => [],
    delete: async (documentIds, ctx) => {
      for (const documentId of documentIds) {
        if (failFor.some((bad) => documentId.endsWith(bad))) {
          throw new Error(`backend refused ${documentId}`);
        }
        deletedDocs.push(documentId);
        reasons.push(ctx.reason);
      }
    },
  };
  return { adapter, deletedDocs, reasons };
}

/**
 * Boot the plugin against a real `LifecycleService`, exactly as a host does:
 * the plugin resolves `lifecycle` by duck-type through `ctx.getService`.
 */
async function boot(
  options: ConstructorParameters<typeof KnowledgeServicePlugin>[0],
  opts: {
    engine?: any;
    lifecycle?: LifecycleService | null;
    adapter?: IKnowledgeAdapter;
  } = {},
) {
  let readyHook: (() => Promise<void>) | undefined;
  let service: KnowledgeService | undefined;
  const asked: string[] = [];

  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: (name: string, fn: () => Promise<void>) => {
      if (name === 'kernel:ready') readyHook = fn;
    },
    registerService: (_name: string, svc: KnowledgeService) => {
      service = svc;
    },
    getService: (name: string) => {
      asked.push(name);
      if (name === 'lifecycle' && opts.lifecycle) return opts.lifecycle;
      throw new Error(`no service ${name}`);
    },
  };

  const plugin = new KnowledgeServicePlugin(options);
  await plugin.init(ctx);
  if (opts.adapter) service!.registerAdapter('fake', opts.adapter);
  await plugin.start(ctx);
  await readyHook?.();
  return { ctx, service: service!, asked };
}

function lifecycleOver(engine: any) {
  return new LifecycleService({
    getEngine: () => engine,
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    now: () => FIXED_NOW,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
  });
}

describe('#4672 — knowledge reap guard', () => {
  it('de-indexes each candidate row by id, then confirms it for deletion', async () => {
    const { engine, deleted, idsLeft } = reapEngine({
      task: [
        { id: 'k1', deleted_at: OLD },
        { id: 'k2', deleted_at: OLD },
      ],
      audit_log: [],
    });
    const lifecycle = lifecycleOver(engine);
    const { adapter, deletedDocs, reasons } = fakeAdapter();
    await boot({ sources: [noteSource()] }, { lifecycle, adapter });

    const report = await lifecycle.sweep();

    // Document id is the same projection key the event-sync delete uses:
    // `${sourceId}:${recordId}`.
    expect(deletedDocs).toEqual(['task_notes:k1', 'task_notes:k2']);
    // Tagged honestly on the EXISTING free-form `AdapterContext.reason`.
    expect(reasons).toEqual(['lifecycle-reap', 'lifecycle-reap']);
    // …and only then are the rows deleted, by id.
    expect(deleted).toEqual([
      { object: 'task', id: 'k1' },
      { object: 'task', id: 'k2' },
    ]);
    expect(idsLeft('task')).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it('VETOES a row whose de-index failed — the row outlives its index entry, never the reverse', async () => {
    const { engine, deleted, idsLeft } = reapEngine({
      task: [
        { id: 'k1', deleted_at: OLD },
        { id: 'k2', deleted_at: OLD },
        { id: 'k3', deleted_at: OLD },
      ],
      audit_log: [],
    });
    const lifecycle = lifecycleOver(engine);
    const { adapter, deletedDocs } = fakeAdapter(['k2']);
    const { ctx } = await boot({ sources: [noteSource()] }, { lifecycle, adapter });

    await lifecycle.sweep();

    expect(deletedDocs).toEqual(['task_notes:k1', 'task_notes:k3']);
    // k2's row survives this sweep: deleting it would orphan the document the
    // adapter still holds. The next sweep retries it.
    expect(deleted.map((d) => d.id)).toEqual(['k1', 'k3']);
    expect(idsLeft('task')).toEqual(['k2']);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("reap guard: de-index failed for source 'task_notes'"),
    );
  });

  it('a failing adapter never leaves the row deleted — the veto holds across repeated sweeps', async () => {
    const { engine, deleted, idsLeft } = reapEngine({
      task: [{ id: 'k1', deleted_at: OLD }],
      audit_log: [],
    });
    const lifecycle = lifecycleOver(engine);
    const { adapter } = fakeAdapter(['k1']);
    await boot({ sources: [noteSource()] }, { lifecycle, adapter });

    await lifecycle.sweep();
    await lifecycle.sweep();

    expect(deleted).toEqual([]);
    expect(idsLeft('task')).toEqual(['k1']);
  });

  it('objects with no knowledge source reap exactly as before — no guard, no de-index', async () => {
    const { engine, deleted, idsLeft } = reapEngine({
      task: [],
      audit_log: [{ id: 'a1', created_at: OLD }, { id: 'a2', created_at: OLD }],
    });
    const lifecycle = lifecycleOver(engine);
    const { adapter, deletedDocs } = fakeAdapter();
    await boot({ sources: [noteSource()] }, { lifecycle, adapter });

    await lifecycle.sweep();

    expect(deleted).toEqual([
      { object: 'audit_log', id: 'a1' },
      { object: 'audit_log', id: 'a2' },
    ]);
    expect(idsLeft('audit_log')).toEqual([]);
    // The guard is registered per object; `audit_log` never reaches it.
    expect(deletedDocs).toEqual([]);
  });
});

/**
 * [#5535] The consumption-side proof. `registerReapGuard` used to be a
 * single-slot `set()`, and this plugin is exactly the "second registrar"
 * ADR-0057 §3.3 invites (de-index a derived index by id) — the one that would
 * have silently displaced `sys_file`'s byte reclaim. It composes instead.
 */
describe('#4672 — reap guard composition with another registrar', () => {
  it('runs alongside a pre-registered guard: both do their cleanup, neither is displaced', async () => {
    const { engine, deleted, idsLeft } = reapEngine({
      task: [
        { id: 'k1', deleted_at: OLD },
        { id: 'k2', deleted_at: OLD },
        { id: 'k3', deleted_at: OLD },
      ],
      audit_log: [],
    });
    const lifecycle = lifecycleOver(engine);

    // Stands in for `service-storage`'s byte-reclaim guard: reclaims the
    // external resource for the rows it confirms, and vetoes k3.
    const reclaimed: string[] = [];
    const byteGuard = vi.fn(async (_object: string, rows: Array<Record<string, unknown>>) => {
      const confirmed = rows.map((r) => String(r.id)).filter((id) => id !== 'k3');
      reclaimed.push(...confirmed);
      return confirmed;
    });
    lifecycle.registerReapGuard('task', byteGuard);

    const { adapter, deletedDocs } = fakeAdapter();
    await boot({ sources: [noteSource()] }, { lifecycle, adapter });

    await lifecycle.sweep();

    // Both registrars were consulted — the knowledge plugin registering second
    // did not unhook the first.
    expect(byteGuard).toHaveBeenCalledTimes(1);
    expect(byteGuard.mock.calls[0][1].map((r: any) => r.id)).toEqual(['k1', 'k2', 'k3']);
    expect(reclaimed).toEqual(['k1', 'k2']);
    // …and the knowledge guard was asked only about the rows still standing, so
    // it never de-indexes a row another guard is keeping (a de-index is a
    // receipt for cleanup already done, not an opinion).
    expect(deletedDocs).toEqual(['task_notes:k1', 'task_notes:k2']);
    // Intersection: k3 vetoed by one guard is kept whatever the other said.
    expect(deleted.map((d) => d.id)).toEqual(['k1', 'k2']);
    expect(idsLeft('task')).toEqual(['k3']);
  });

  it("the knowledge guard's own veto keeps a row the other registrar confirmed", async () => {
    const { engine, deleted, idsLeft } = reapEngine({
      task: [
        { id: 'k1', deleted_at: OLD },
        { id: 'k2', deleted_at: OLD },
      ],
      audit_log: [],
    });
    const lifecycle = lifecycleOver(engine);
    const otherGuard = vi.fn(async (_o: string, rows: Array<Record<string, unknown>>) =>
      rows.map((r) => String(r.id)),
    );
    lifecycle.registerReapGuard('task', otherGuard);

    const { adapter } = fakeAdapter(['k2']);
    await boot({ sources: [noteSource()] }, { lifecycle, adapter });

    await lifecycle.sweep();

    expect(otherGuard).toHaveBeenCalledTimes(1);
    expect(deleted.map((d) => d.id)).toEqual(['k1']);
    expect(idsLeft('task')).toEqual(['k2']);
  });
});

describe('#4672 — registration seam', () => {
  it('goes through the duck-typed lifecycle service, once per guarded object', async () => {
    const registered: Array<{ object: string; guard: unknown }> = [];
    const fakeLifecycle: any = {
      registerReapGuard: (object: string, guard: unknown) => registered.push({ object, guard }),
    };
    await boot(
      {
        sources: [
          noteSource(),
          // A second source on the SAME object must not register a second guard…
          noteSource({ id: 'task_titles' }),
          // …and a source on another object gets its own.
          noteSource({
            id: 'doc_body',
            source: { kind: 'object', object: 'doc', contentFields: ['body'] },
          } as Partial<KnowledgeSource>),
        ],
      },
      { lifecycle: fakeLifecycle },
    );

    expect(registered.map((r) => r.object)).toEqual(['task', 'doc']);
    // One guard instance for every object: it resolves its targets from the
    // object it is called with, so re-registration is a documented no-op.
    expect(registered[0].guard).toBe(registered[1].guard);
  });

  it('skips silently when no lifecycle service is registered (bare kernel)', async () => {
    const { ctx } = await boot({ sources: [noteSource()] }, { lifecycle: null });

    // Nothing thrown, nothing concluded about the registry — no sweeper means
    // no reap, so there are no orphans to prevent.
    expect(ctx.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('lifecycle'));
    expect(ctx.logger.info).not.toHaveBeenCalledWith(expect.stringContaining('reap guards registered'));
  });

  it('never asks for the lifecycle service when no object source is declared', async () => {
    const { asked } = await boot(
      {
        sources: [
          { id: 'handbooks', label: 'Handbooks', adapter: 'fake', source: { kind: 'file', prefix: 'kb/' } } as KnowledgeSource,
        ],
      },
      { lifecycle: lifecycleOver(reapEngine({ task: [], audit_log: [] }).engine) },
    );

    expect(asked).not.toContain('lifecycle');
  });

  it('honours the declared opt-outs rather than inventing a second switch', async () => {
    const registrations: string[] = [];
    const fakeLifecycle: any = {
      registerReapGuard: (object: string) => registrations.push(object),
    };

    // `refresh.onRecordChange: false` — an external indexer owns this index, so
    // the platform neither syncs it on record change nor holds up its reaps.
    await boot(
      { sources: [noteSource({ refresh: { onRecordChange: false } })] },
      { lifecycle: fakeLifecycle },
    );
    expect(registrations).toEqual([]);

    // `enableEventSync: false` is the same statement one level up.
    await boot(
      { sources: [noteSource()], enableEventSync: false },
      { lifecycle: fakeLifecycle },
    );
    expect(registrations).toEqual([]);
  });
});
