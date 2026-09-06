// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16129] The MID-PARK WINDOW in {@link AutomationEngine.persistSuspendedRun}:
 * a concurrent per-id read can evict a LIVE map entry while the durable save is
 * still in flight.
 *
 * ## Why this file exists at all
 *
 * This is not a contract defect and must not be read as one. It is a real but
 * BOUNDED limit that was, until this file, undocumented and unpinned — and an
 * unpinned limit becomes folklore: the next reader cannot tell a deliberate
 * boundary from an oversight. Pinning it makes the boundary EXECUTABLE. A
 * comment saying the same thing is a claim that drifts away from the code; a
 * test that drives the interleaving cannot.
 *
 * ## The window, as measured on this head (not as inherited from the card)
 *
 * `persistSuspendedRun` writes the map entry FIRST and marks the run cache-only
 * LAST, and only on the failure path:
 *
 *   1. `this.suspendedRuns.set(run.runId, run)`
 *   2. `await this.store.save(run)`            <- the window is this await
 *   3. on success: `cacheOnlySuspensions.delete(runId)`
 *      on failure: `cacheOnlySuspensions.add(runId)`
 *
 * Between 1 and the resolution of 2 the entry is in the map and is NOT yet in
 * {@link AutomationEngine.cacheOnlySuspensions}. A concurrent
 * `loadSuspendedRunStrict` for that same id therefore reads a store that
 * truthfully answers "no row" (the save has not landed), finds no cache-only
 * qualifier, and takes the eviction path #16031 added — deleting an entry for a
 * run that is being parked right now.
 *
 * ## Reachability — measured, because the card recorded a reading and not a
 * measurement
 *
 * REACHABLE, on an ordinary single-process composition, and with no
 * out-of-band knowledge of the run id. The map write happens first, so
 * `listSuspendedRuns()` PUBLISHES the id during the window: the very
 * list-then-open consumer #16031 was written for can obtain the id and issue
 * the per-id read without the run having been handed to anyone yet. The second
 * test drives the same window on the RE-suspend path, where the id has been
 * public since the first park, so the reachability does not rest on the listing
 * either. Both need only a store whose `save` is asynchronous — that is every
 * real store.
 *
 * ## The two bounds this pin exists to keep standing
 *
 *  - {@link AutomationEngine.loadSuspendedRunStrict} is STORE-FIRST while a
 *    store is attached, so once the save lands the run is resumable from the
 *    store. The evicted entry was a cache, not the authority.
 *  - {@link AutomationEngine.listSuspendedRuns} merely OMITS the run.
 *    Under-reporting is already inside that method's declared latitude (its own
 *    docblock says it omits runs parked in a previous process lifetime);
 *    over-reporting never was, which is the asymmetry #16031 rests on.
 *
 * ⛔ So this file does NOT widen the cache-only marking, add a lock, or move the
 * save before the map write. It pins the outcome those two bounds promise, and
 * a future change that alters the trade — in either direction — has to come
 * through here and say so.
 *
 * ## One measured case that does NOT stay inside those bounds
 *
 * `FINDING` below. Bound 1 holds only because the save eventually LANDS. Let the
 * save FAIL after an evicting read has already run, and the compound outcome is
 * a run with no durable row and no map entry: unresumable, and the engine's own
 * `error` record for the failed save promises the opposite ("it is kept in
 * memory only"). It is narrower than the base window — it needs a store that
 * rejects the write while still answering reads with "no row" rather than
 * throwing (a healthy read replica behind a broken write path, a missing INSERT
 * grant, a full disk) — but it is not hypothetical, and it escapes the bound.
 *
 * ⛔ It is deliberately NOT fixed here. Widening the cache-only marking is
 * exactly the move this card forbids taking unilaterally, and the choice
 * between that, a lock, and reordering the save is a decision above it. The
 * case is pinned at its MEASURED behaviour so the cost is visible and so any
 * future fix has a red test to turn green.
 */

import { describe, it, expect } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { SuspendedRun, SuspendedRunStore } from './engine.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

/** start -> lv1 -> lv2 -> end. Two levels, so a re-suspend has somewhere to go. */
const APPROVAL_FLOW = {
  name: 'expense_approval',
  label: 'Expense approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'lv1', type: 'approval_level', label: 'Department head' },
    { id: 'lv2', type: 'approval_level', label: 'General manager' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'lv1' },
    { id: 'e2', source: 'lv1', target: 'lv2' },
    { id: 'e3', source: 'lv2', target: 'end' },
  ],
} as any;

function engineOver(store: SuspendedRunStore | undefined): AutomationEngine {
  const engine = new AutomationEngine(silentLogger(), store);
  engine.registerNodeExecutor({
    type: 'approval_level',
    descriptor: defineActionDescriptor({
      type: 'approval_level',
      version: '1.0.0',
      name: 'Approval level',
      supportsPause: true,
      resumeAuthority: 'service',
    }),
    async execute(node: any) {
      return { success: true, suspend: true, correlation: `req_${node.id}` };
    },
  } as any);
  engine.registerFlow('expense_approval', APPROVAL_FLOW);
  return engine;
}

const approve = (engine: AutomationEngine, runId: string) =>
  engine.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any);

/** Node ids the listing reports for `runId`, in call order. */
const listedNodes = (rows: Array<{ runId: string; nodeId: string }>, runId: string) =>
  rows.filter(r => r.runId === runId).map(r => r.nodeId);

/**
 * A store whose `save` PARKS INSIDE THE WINDOW. `entered` resolves with the run
 * being saved the first time `save` is called — that is the instant between the
 * map write and the save landing — and nothing proceeds until `release()`.
 *
 * Every later `save` passes straight through the already-resolved gate, so a
 * re-suspend after the window is an ordinary park.
 */
function gatedSaveStore(
  inner: SuspendedRunStore,
  opts: { failSave?: boolean; loadThrows?: boolean } = {},
): { store: SuspendedRunStore; entered: Promise<SuspendedRun>; release: () => void } {
  let announce!: (run: SuspendedRun) => void;
  const entered = new Promise<SuspendedRun>(r => { announce = r; });
  let open!: () => void;
  const gate = new Promise<void>(r => { open = r; });
  const store: SuspendedRunStore = {
    async save(run: SuspendedRun) {
      announce(run);
      await gate;
      if (opts.failSave) throw new Error('sqlite: attempt to write a readonly database');
      return inner.save(run);
    },
    async load(id: string) {
      if (opts.loadThrows) throw new Error('sqlite: database is locked');
      return inner.load(id);
    },
    delete: (id: string) => inner.delete(id),
    list: () => inner.list(),
  };
  return { store, entered, release: () => open() };
}

// -- the window, and the bounds it stays inside -------------------------------

describe('#16129 — the mid-park window between the map write and the durable save', () => {
  it('THE WINDOW: a per-id read taken mid-park evicts a LIVE entry, and the listing hands out the id to do it with', async () => {
    const inner = new InMemorySuspendedRunStore();
    const { store, entered, release } = gatedSaveStore(inner);
    const engine = engineOver(store);

    const parking = engine.execute('expense_approval'); // deliberately not awaited
    const parked = await entered;                       // now INSIDE the window
    const runId = parked.runId;

    // Reachability without out-of-band knowledge of the id: the map write is
    // first, so the cache-only listing publishes the run mid-park...
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
    // ...while the store truthfully has no row for it yet.
    expect(await inner.load(runId)).toBeNull();

    // The per-id read. The store answers "no row", the run is not cache-only,
    // so #16031's eviction path deletes an entry for a run being parked NOW.
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual([]);

    release();
    expect((await parking).runId).toBe(runId);

    // BOUND 1 — store-first: the run is resumable. The evicted entry was a
    // cache; the authority is the row that has now landed.
    expect(await inner.load(runId)).not.toBeNull();
    expect(await engine.hasSuspendedRun(runId)).toBe(true);
    expect(await engine.getSuspendedScreen(runId)).not.toBeUndefined();

    // BOUND 2 — the cost is confined to the cache-only listing, which OMITS the
    // run. Under-reporting is inside its declared latitude.
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual([]);
    // The durable listing is unaffected: it reads the store.
    expect(listedNodes(await engine.listSuspendedRunsDurable(), runId)).toEqual(['lv1']);

    // Resumable END TO END, not merely answering `true` — and the next park
    // re-seeds the map, so the omission lasts one park, not forever.
    expect((await approve(engine, runId)).status).toBe('paused');
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv2']);
    expect((await approve(engine, runId)).success).toBe(true);
  });

  it('THE WINDOW (re-suspend): the same eviction on a run whose id has been public since the first park', async () => {
    // The reachability here rests on nothing at all: an operator holding the id
    // from the first park issues an ordinary read while the SECOND park's save
    // is in flight. `claimAdvance` has already removed the durable row, so the
    // store's "no row" is again truthful and again not the whole truth.
    const inner = new InMemorySuspendedRunStore();
    const first = new InMemorySuspendedRunStore();
    const engine = engineOver({
      save: (run: SuspendedRun) => first.save(run),
      load: (id: string) => first.load(id),
      delete: (id: string) => first.delete(id),
      list: () => first.list(),
    });
    const runId = (await engine.execute('expense_approval')).runId!;
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);

    // Swap in the gated store over the same rows, then resume: lv1 -> lv2 parks
    // again, and THAT save is the one that waits.
    for (const r of await first.list()) await inner.save(r);
    const { store, entered, release } = gatedSaveStore(inner);
    engine.setSuspendedRunStore(store);

    const resuming = approve(engine, runId);
    const reparked = await entered;
    expect(reparked.nodeId).toBe('lv2');

    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv2']);
    expect(await inner.load(runId)).toBeNull();
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual([]);

    release();
    expect((await resuming).status).toBe('paused');

    // Same two bounds.
    expect(await engine.hasSuspendedRun(runId)).toBe(true);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual([]);
    expect(listedNodes(await engine.listSuspendedRunsDurable(), runId)).toEqual(['lv2']);
    expect((await approve(engine, runId)).success).toBe(true);
  });
});

// -- the one case that escapes the bounds, pinned at its measured behaviour ---

describe('#16129 — the window compounded with a FAILING save', () => {
  it('FINDING: an evicting read inside the window of a save that then fails leaves the run unresumable', async () => {
    // ⛔ Deliberately NOT fixed here — see this file's header. Pinned so the
    // cost is visible and so a future fix has a red test to turn green.
    const inner = new InMemorySuspendedRunStore();
    const { store, entered, release } = gatedSaveStore(inner, { failSave: true });
    const engine = engineOver(store);

    const parking = engine.execute('expense_approval');
    const runId = (await entered).runId;

    // Same window, same evicting read.
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual([]);

    // The save now fails. `persistSuspendedRun` marks the run cache-only — but
    // the map entry it qualifies is already gone, so the qualifier qualifies
    // nothing and the strict loader has nothing left to serve.
    release();
    expect((await parking).runId).toBe(runId);

    // ESCAPES BOUND 1. The store never took the row and the cache no longer
    // holds it, so the run is unresumable — while the engine's `error` record
    // for the failed save says it "is kept in memory only".
    expect(await inner.load(runId)).toBeNull();
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual([]);
    const resumed = await approve(engine, runId);
    expect(resumed.success).toBe(false);
    expect(resumed.code).toBe('RUN_NOT_FOUND');

    // The control that isolates the window as the cause: WITHOUT the mid-park
    // read, the identical failing save is the documented degradation — the run
    // stays resumable in-process, which is exactly what the promise says.
    const solo = engineOver({
      async save() { throw new Error('sqlite: attempt to write a readonly database'); },
      async load() { return null; },
      async delete() {},
      async list() { return []; },
    });
    const soloRun = (await solo.execute('expense_approval')).runId!;
    expect(await solo.hasSuspendedRun(soloRun)).toBe(true);
    expect(listedNodes(solo.listSuspendedRuns(), soloRun)).toEqual(['lv1']);
  });
});

// -- controls: the shapes in which the window cannot bite ---------------------

describe('#16129 — where the window does not exist', () => {
  it('CONTROL: with no store attached there is no window and nothing is evicted', async () => {
    // `persistSuspendedRun` awaits nothing, and `evictConsumedSuspension`
    // refuses to act because the map IS the authority.
    const engine = engineOver(undefined);
    const runId = (await engine.execute('expense_approval')).runId!;

    expect(await engine.hasSuspendedRun(runId)).toBe(true);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
    expect((await approve(engine, runId)).status).toBe('paused');
  });

  it('CONTROL: a read that THROWS inside the window evicts nothing — unknown is not "gone"', async () => {
    // The store-outage guard covers the window too: an unreadable store makes
    // the run's existence UNKNOWN, and the strict read throws rather than
    // reaching the eviction.
    const inner = new InMemorySuspendedRunStore();
    const { store, entered, release } = gatedSaveStore(inner, { loadThrows: true });
    const engine = engineOver(store);

    const parking = engine.execute('expense_approval');
    const runId = (await entered).runId;

    await expect(engine.hasSuspendedRun(runId)).rejects.toThrow(/database is locked/);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);

    release();
    expect((await parking).runId).toBe(runId);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
  });
});
