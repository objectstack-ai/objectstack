/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: ObjectStackAdapter must implement `onMutation` and emit an event
 * after every successful create/update/delete (and bulk variant).
 *
 * Real-world symptom (framework app-showcase): inline-edit a grid cell, click
 * "全部保存" (Save All) — the write persisted but the list did NOT auto-refresh.
 * ListView auto-refreshes by subscribing to `dataSource.onMutation`; the
 * ObjectStack adapter never implemented it, so the per-row `update` writes
 * issued by ObjectGrid's default batch-save were silent and the grid kept
 * showing stale rows until a manual reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  readTransactionalBatchCapability,
} from './index';
import type { DataSourceMutationEvent } from '@object-ui/types';

function makeDS(stub: Record<string, any>) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => {
      const body = { success: true, data: { capabilities: {}, routes: {} } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { data: stub };
  return ds;
}

describe('ObjectStackAdapter.onMutation', () => {
  it('emits an update event after a successful update (the inline-edit save path)', async () => {
    const update = vi
      .fn()
      .mockResolvedValue({ record: { id: 'r1', account: 'acc-1' } });
    const ds = makeDS({ update });

    const events: DataSourceMutationEvent[] = [];
    const unsub = ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.update('showcase_project', 'r1', { account: 'acc-1' });

    expect(events).toEqual([
      { type: 'update', resource: 'showcase_project', id: 'r1', record: { id: 'r1', account: 'acc-1' } },
    ]);

    // Unsubscribe stops delivery.
    unsub();
    await ds.update('showcase_project', 'r1', { account: 'acc-2' });
    expect(events).toHaveLength(1);
  });

  it('emits a create event with the new record', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'new', name: 'X' } });
    const ds = makeDS({ create });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.create('showcase_project', { name: 'X' });

    expect(events).toEqual([
      { type: 'create', resource: 'showcase_project', record: { id: 'new', name: 'X' } },
    ]);
  });

  it('emits a delete event only when the server confirms deletion', async () => {
    // `success`, not `deleted` (objectstack#5638). This mock is why the bug it
    // fixed was invisible here: `DeleteDataResult` DECLARED a `deleted` key that
    // no schema has ever declared and no server path has ever returned, and this
    // fixture faithfully reproduced the declaration rather than the wire. So the
    // adapter read `result.deleted`, got `undefined` against a real server —
    // emitting no event and resolving `undefined` from a `Promise<boolean>` —
    // while this test stayed green against the fiction. Pinning the shape the
    // server actually sends is what makes the assertion mean anything.
    const del = vi
      .fn()
      .mockResolvedValueOnce({ object: 'showcase_project', id: 'r1', success: true })
      .mockResolvedValueOnce({ object: 'showcase_project', id: 'r2', success: false });
    const ds = makeDS({ delete: del });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.delete('showcase_project', 'r1');
    await ds.delete('showcase_project', 'r2');

    expect(events).toEqual([
      { type: 'delete', resource: 'showcase_project', id: 'r1' },
    ]);
  });

  // REVERSE PIN for objectui#3412 / objectstack#5638. The bug was not that the
  // guard was missing — it was that the guard read a key the wire never carries,
  // so it was dead while looking alive. A response spelling the old `deleted`
  // must therefore emit NOTHING: if someone re-introduces a tolerant
  // `result.success ?? result.deleted` read, this goes red. Reading both keys is
  // exactly what contract-first forbids (AGENTS.md #0.1) and what objectstack#5638's
  // own triage ruled out — the producer has one shape, so the consumer gets one.
  it('emits nothing for a response carrying the retired `deleted` key', async () => {
    const del = vi.fn().mockResolvedValue({ object: 'showcase_project', id: 'r1', deleted: true });
    const ds = makeDS({ delete: del });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    const returned = await ds.delete('showcase_project', 'r1');

    expect(events).toEqual([]);
    expect(returned).toBeUndefined();
  });

  it('emits a single bulk event per bulkUpdate call (not per id)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ succeeded: 3, failed: 0, results: [] });
    const ds = makeDS({ updateMany });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.bulkUpdate('showcase_project', ['a', 'b', 'c'], { archived: true });

    expect(events).toEqual([{ type: 'update', resource: 'showcase_project' }]);
  });

  it('does not emit when a bulk operation affected zero rows', async () => {
    const updateMany = vi.fn().mockResolvedValue({ succeeded: 0, failed: 0, results: [] });
    const ds = makeDS({ updateMany });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.bulkUpdate('showcase_project', ['a'], { archived: true });

    expect(events).toEqual([]);
  });

  it('isolates a throwing listener so the mutation still resolves and others fire', async () => {
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' } });
    const ds = makeDS({ update });
    const good = vi.fn();
    ds.onMutation(() => { throw new Error('boom'); });
    ds.onMutation(good);

    await expect(ds.update('showcase_project', 'r1', { x: 1 })).resolves.toBeTruthy();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

/**
 * Regression for #2582: a ModalForm over an object WITH subforms delegates to
 * MasterDetailForm, which persists parent + child rows through ONE
 * `batchTransaction` (`POST /api/v1/batch`). That path never emitted
 * MutationEvents, so the related list and the "相关" tab count badge stayed
 * stale after a successful create/edit until a full page reload. The adapter
 * must emit one event per committed operation — and nothing when the
 * transaction failed (it rolled back entirely).
 */
describe('ObjectStackAdapter.batchTransaction mutation events', () => {
  function makeBatchDS(responder: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    const ds: any = new ObjectStackAdapter({
      baseUrl: 'http://test.local',
      fetch: vi.fn(responder),
    });
    ds.connected = true;
    ds.connectionState = 'connected';
    return ds;
  }

  it('emits one event per op after a committed master-detail CREATE batch', async () => {
    const ds = makeBatchDS(async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: 'p1', name: 'Task version A' },
            { id: 'c1', task: 'p1', label: 'Check item 1' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.batchTransaction([
      { object: 'ehr_task_version', action: 'create', data: { name: 'Task version A' } },
      { object: 'ehr_task_check_item', action: 'create', data: { task: { $ref: 0 }, label: 'Check item 1' } },
    ]);

    expect(events).toEqual([
      { type: 'create', resource: 'ehr_task_version', record: { id: 'p1', name: 'Task version A' } },
      { type: 'create', resource: 'ehr_task_check_item', record: { id: 'c1', task: 'p1', label: 'Check item 1' } },
    ]);
  });

  it('emits update/create/delete events after a committed master-detail EDIT batch', async () => {
    const ds = makeBatchDS(async () =>
      new Response(
        JSON.stringify({
          results: [{ id: 'p1' }, { id: 'c-new' }, { id: 'c1' }, { deleted: true }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.batchTransaction([
      { object: 'ehr_task_version', action: 'update', id: 'p1', data: { name: 'Renamed' } },
      { object: 'ehr_task_check_item', action: 'create', data: { task: 'p1' } },
      { object: 'ehr_task_check_item', action: 'update', id: 'c1', data: { label: 'Edited' } },
      { object: 'ehr_task_check_item', action: 'delete', id: 'c2' },
    ]);

    expect(events).toEqual([
      { type: 'update', resource: 'ehr_task_version', id: 'p1', record: { id: 'p1' } },
      { type: 'create', resource: 'ehr_task_check_item', record: { id: 'c-new' } },
      { type: 'update', resource: 'ehr_task_check_item', id: 'c1', record: { id: 'c1' } },
      { type: 'delete', resource: 'ehr_task_check_item', id: 'c2' },
    ]);
  });

  it('treats an op without an explicit action as a create (the server default)', async () => {
    const ds = makeBatchDS(async () =>
      new Response(JSON.stringify({ results: [{ id: 'p1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.batchTransaction([{ object: 'ehr_task_version', data: { name: 'X' } }]);

    expect(events).toEqual([
      { type: 'create', resource: 'ehr_task_version', record: { id: 'p1' } },
    ]);
  });

  it('emits NOTHING when the batch failed — the transaction rolled back', async () => {
    const ds = makeBatchDS(async () =>
      new Response(JSON.stringify({ error: 'validation failed' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await expect(
      ds.batchTransaction([{ object: 'ehr_task_version', action: 'create', data: {} }]),
    ).rejects.toThrow('validation failed');

    expect(events).toEqual([]);
  });
});

/**
 * #2679 / #2694: cross-object saves go through the SDK's
 * `client.data.batchTransaction` (no hand-rolled POST /api/v1/batch). When the
 * SDK reports this backend can't do a transactional batch — it throws an error
 * carrying HTTP 404/405 (endpoint missing) or 501 (runtime without
 * transactions) — the adapter degrades to a client-side, NON-atomic emulation
 * instead of failing the save. This is the isolated home of the non-atomic
 * fallback — the form no longer carries it. Real errors (any other 4xx/5xx)
 * must still surface, never be silently downgraded.
 */
describe('ObjectStackAdapter.batchTransaction fallback (no server atomicity)', () => {
  // The SDK's batchTransaction signals "backend can't do a transactional batch"
  // by throwing an error decorated with the HTTP status (the @objectstack/client
  // convention that `errorStatusOf` reads).
  function makeFallbackDS(opts: { batchStatus: number; clientData: Record<string, any> }) {
    const batchTransaction = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { httpStatus: opts.batchStatus });
    });
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: vi.fn() });
    ds.connected = true;
    ds.connectionState = 'connected';
    ds.client = { data: { batchTransaction, ...opts.clientData } };
    return { ds, batchTransaction };
  }

  it('404 → warns once, saves via the create primitive, and caches the detection', async () => {
    const create = vi.fn(async (_o: string, d: any) => ({ record: { id: 'p1', ...d } }));
    const { ds, batchTransaction } = makeFallbackDS({ batchStatus: 404, clientData: { create } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    const res = await ds.batchTransaction([{ object: 'proj', action: 'create', data: { name: 'A' } }]);

    expect(res.results[0]).toMatchObject({ id: 'p1', name: 'A' });
    expect(create).toHaveBeenCalledWith('proj', { name: 'A' });
    expect(warn).toHaveBeenCalledTimes(1);
    // Events come from the create primitive ONCE — not also re-emitted by the
    // committed-batch path (no double emission).
    expect(events).toEqual([{ type: 'create', resource: 'proj', record: { id: 'p1', name: 'A' } }]);

    // A second batch short-circuits: the endpoint is known-unsupported, so we
    // never call the SDK batch method again.
    expect(batchTransaction).toHaveBeenCalledTimes(1);
    await ds.batchTransaction([{ object: 'proj', action: 'create', data: { name: 'B' } }]);
    expect(batchTransaction).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('501 (runtime without transactions) also degrades to emulation', async () => {
    const create = vi.fn(async (_o: string, d: any) => ({ record: { id: 'p1', ...d } }));
    const { ds } = makeFallbackDS({ batchStatus: 501, clientData: { create } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await ds.batchTransaction([{ object: 'proj', action: 'create', data: { name: 'A' } }]);
    expect(create).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a real error (400) surfaces — never downgraded to emulation', async () => {
    const create = vi.fn();
    const { ds } = makeFallbackDS({ batchStatus: 400, clientData: { create } });
    await expect(
      ds.batchTransaction([{ object: 'proj', action: 'create', data: {} }]),
    ).rejects.toThrow(/nope/);
    // No client-side writes happened — the batch was rejected, not retried.
    expect(create).not.toHaveBeenCalled();
  });

  it('routes a committed batch through the SDK method and never hand-rolls a fetch', async () => {
    const sdkBatch = vi.fn(async () => ({ results: [{ id: 'p1', name: 'A' }] }));
    const fetchMock = vi.fn();
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchMock });
    ds.connected = true;
    ds.connectionState = 'connected';
    ds.client = { data: { batchTransaction: sdkBatch } };
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    const res = await ds.batchTransaction([{ object: 'proj', action: 'create', data: { name: 'A' } }]);

    expect(sdkBatch).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled(); // no raw POST /api/v1/batch
    expect(res.results[0]).toMatchObject({ id: 'p1' });
    // Committed via the SDK → one event per op (emitted once).
    expect(events).toEqual([{ type: 'create', resource: 'proj', record: { id: 'p1', name: 'A' } }]);
  });
});

/**
 * Regression for #2582 (fallback path): when the server lacks the transactional
 * batch endpoint, MasterDetailForm persists child rows via `bulk(child,
 * 'create', rows)` (applyDetail → createMany). `bulk` only emitted progress
 * events, so those writes were equally invisible to the invalidation bus. Each
 * branch now emits ONE resource-level event, matching bulkUpdate/bulkDelete.
 */
describe('ObjectStackAdapter.bulk mutation events', () => {
  it('emits a single create event per bulk create call', async () => {
    const createMany = vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const ds = makeDS({ createMany });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.bulk('ehr_task_check_item', 'create', [{ label: 'a' }, { label: 'b' }]);

    expect(events).toEqual([{ type: 'create', resource: 'ehr_task_check_item' }]);
  });

  it('does not emit when a bulk create returned zero records', async () => {
    const createMany = vi.fn().mockResolvedValue([]);
    const ds = makeDS({ createMany });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.bulk('ehr_task_check_item', 'create', [{ label: 'a' }]);

    expect(events).toEqual([]);
  });

  it('emits a single delete event per bulk delete call', async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const ds = makeDS({ deleteMany });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.bulk('ehr_task_check_item', 'delete', [{ id: 'c1' }, { id: 'c2' }] as any);

    expect(events).toEqual([{ type: 'delete', resource: 'ehr_task_check_item' }]);
  });

  it('emits a single update event per bulk update call', async () => {
    const updateMany = vi.fn().mockResolvedValue([{ id: 'c1' }]);
    const ds = makeDS({ updateMany });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await ds.bulk('ehr_task_check_item', 'update', [{ id: 'c1', label: 'x' }] as any);

    expect(events).toEqual([{ type: 'update', resource: 'ehr_task_check_item' }]);
  });

  it('bulk create failure emits nothing', async () => {
    const createMany = vi.fn().mockRejectedValue(new Error('boom'));
    const ds = makeDS({ createMany });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    await expect(ds.bulk('ehr_task_check_item', 'create', [{ label: 'a' }])).rejects.toThrow();

    expect(events).toEqual([]);
  });
});

/**
 * #2693 / framework#3298 — declarative capability negotiation for atomic batch.
 *
 * The adapter reads `capabilities.transactionalBatch` from discovery at
 * connect(). When the backend DECLARES support it TRUSTS server atomicity and
 * never degrades to the non-atomic client emulation — a batch failure (even
 * 404/405/501) is a real error. When the capability is ABSENT (backend predates
 * #3298) or explicitly `false`, the legacy runtime-probe + emulation fallback
 * stays active so a save is still possible (#2679 compatibility constraint).
 */
describe('ObjectStackAdapter.batchTransaction capability gate (#2693 / framework#3298)', () => {
  // The discovery cache is module-level and shared across files in the (unit)
  // project — reset it so each case reads its own advertised capability.
  beforeEach(() => clearSharedDiscoveryCache());

  function makeCapabilityDS(opts: {
    /** Value placed at `capabilities.transactionalBatch`; omit to leave it absent. */
    capability?: boolean | { enabled: boolean };
    batchStatus: number;
    /** Result the SDK batch resolves with on a 2xx `batchStatus`. */
    batchBody?: unknown;
    clientData?: Record<string, any>;
  }) {
    const capabilities: Record<string, unknown> = {};
    if (opts.capability !== undefined) capabilities.transactionalBatch = opts.capability;
    // connect() still fetches discovery to read the #3298 capability; the batch
    // itself now goes through the SDK method (no raw POST /api/v1/batch).
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/discovery')) {
        return new Response(
          JSON.stringify({ success: true, data: { name: 't', version: '1.0.0', capabilities } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });
    // The SDK batch resolves on a 2xx status and otherwise throws a
    // status-decorated error (the @objectstack/client convention `errorStatusOf`
    // reads) — the signal the capability gate + fallback branch on.
    const batchTransaction = vi.fn(async () => {
      if (opts.batchStatus >= 200 && opts.batchStatus < 300) {
        return opts.batchBody ?? { results: [] };
      }
      throw Object.assign(new Error('nope'), { httpStatus: opts.batchStatus });
    });
    const ds: any = new ObjectStackAdapter({
      baseUrl: 'http://test.local',
      autoReconnect: false,
      fetch: fetchMock,
    });
    // SDK batch method + emulation primitives live on the stubbed client.
    ds.client = { data: { batchTransaction, ...(opts.clientData ?? {}) } };
    return { ds, fetchMock, batchTransaction };
  }

  it('declared transactionalBatch:true → a 404 is a hard error, NOT downgraded to emulation', async () => {
    const create = vi.fn();
    const { ds } = makeCapabilityDS({ capability: { enabled: true }, batchStatus: 404, clientData: { create } });

    await expect(
      ds.batchTransaction([{ object: 'proj', action: 'create', data: {} }]),
    ).rejects.toThrow(/nope/);
    // A declared-atomic backend is trusted: no client-side compensation ran.
    expect(create).not.toHaveBeenCalled();
  });

  it('declared transactionalBatch:true → 501 is also a hard error (no emulation)', async () => {
    const create = vi.fn();
    const { ds } = makeCapabilityDS({ capability: { enabled: true }, batchStatus: 501, clientData: { create } });

    await expect(
      ds.batchTransaction([{ object: 'proj', action: 'create', data: {} }]),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts the flat boolean capability shape too', async () => {
    const create = vi.fn();
    const { ds } = makeCapabilityDS({ capability: true, batchStatus: 404, clientData: { create } });

    await expect(
      ds.batchTransaction([{ object: 'proj', action: 'create', data: {} }]),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('declared support → a committed batch commits via /batch and emits one event per op', async () => {
    const { ds } = makeCapabilityDS({
      capability: { enabled: true },
      batchStatus: 200,
      batchBody: { results: [{ id: 'p1', name: 'A' }, { id: 'c1', proj: 'p1' }] },
    });
    const events: DataSourceMutationEvent[] = [];
    ds.onMutation((e: DataSourceMutationEvent) => events.push(e));

    const res = await ds.batchTransaction([
      { object: 'proj', action: 'create', data: { name: 'A' } },
      { object: 'item', action: 'create', data: { proj: { $ref: 0 } } },
    ]);

    expect(res.results).toHaveLength(2);
    expect(events).toEqual([
      { type: 'create', resource: 'proj', record: { id: 'p1', name: 'A' } },
      { type: 'create', resource: 'item', record: { id: 'c1', proj: 'p1' } },
    ]);
  });

  it('declared transactionalBatch:false → 404 still degrades to non-atomic emulation', async () => {
    const create = vi.fn(async (_o: string, d: any) => ({ record: { id: 'p1', ...d } }));
    const { ds } = makeCapabilityDS({ capability: { enabled: false }, batchStatus: 404, clientData: { create } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await ds.batchTransaction([{ object: 'proj', action: 'create', data: { name: 'A' } }]);

    expect(create).toHaveBeenCalledWith('proj', { name: 'A' });
    expect(res.results[0]).toMatchObject({ id: 'p1', name: 'A' });
    warn.mockRestore();
  });

  it('capability ABSENT (backend predates #3298) → 404 degrades to emulation (back-compat)', async () => {
    const create = vi.fn(async (_o: string, d: any) => ({ record: { id: 'p1', ...d } }));
    const { ds } = makeCapabilityDS({ batchStatus: 404, clientData: { create } }); // no capability advertised
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await ds.batchTransaction([{ object: 'proj', action: 'create', data: { name: 'A' } }]);

    expect(create).toHaveBeenCalledWith('proj', { name: 'A' });
    warn.mockRestore();
  });

  it('declared support → a real error (400) surfaces unchanged', async () => {
    const create = vi.fn();
    const { ds } = makeCapabilityDS({ capability: { enabled: true }, batchStatus: 400, clientData: { create } });

    await expect(
      ds.batchTransaction([{ object: 'proj', action: 'create', data: {} }]),
    ).rejects.toThrow(/nope/);
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * Unit coverage for the discovery capability reader — it must accept both the
 * hierarchical `{ enabled }` wire shape (what the framework producers emit) and
 * the flat boolean the client SDK normalizes to, and return `undefined` for a
 * pre-#3298 backend that advertises nothing.
 */
describe('readTransactionalBatchCapability (#3298 shape reader)', () => {
  it('reads the hierarchical { enabled } form', () => {
    expect(readTransactionalBatchCapability({ capabilities: { transactionalBatch: { enabled: true } } })).toBe(true);
    expect(readTransactionalBatchCapability({ capabilities: { transactionalBatch: { enabled: false } } })).toBe(false);
  });

  it('reads the flat boolean form', () => {
    expect(readTransactionalBatchCapability({ capabilities: { transactionalBatch: true } })).toBe(true);
    expect(readTransactionalBatchCapability({ capabilities: { transactionalBatch: false } })).toBe(false);
  });

  it('returns undefined when the capability (or the whole map) is absent', () => {
    expect(readTransactionalBatchCapability({ capabilities: {} })).toBeUndefined();
    expect(readTransactionalBatchCapability({ capabilities: { comments: { enabled: true } } })).toBeUndefined();
    expect(readTransactionalBatchCapability({})).toBeUndefined();
    expect(readTransactionalBatchCapability(null)).toBeUndefined();
    expect(readTransactionalBatchCapability(undefined)).toBeUndefined();
  });

  it('ignores a malformed capability value', () => {
    expect(readTransactionalBatchCapability({ capabilities: { transactionalBatch: { enabled: 'yes' } } })).toBeUndefined();
    expect(readTransactionalBatchCapability({ capabilities: { transactionalBatch: 'true' } })).toBeUndefined();
  });
});
