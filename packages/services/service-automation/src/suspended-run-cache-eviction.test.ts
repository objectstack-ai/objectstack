// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A run parked by one process and consumed by another leaves the parking
 * process's `suspendedRuns` map holding it forever (#15832 note 1).
 *
 * ## The defect, located where the correction measured it and not where the
 * card first pointed
 *
 * The card put the leak on `resumeInternal`'s `claim.kind === 'lost'` branch,
 * which returns before the one `suspendedRuns.delete` in `forgetSuspendedRun`.
 * That branch does leak — but it is not where the common shape lives. The
 * NO-RACE variant leaks identically: replica A parks a run, replica B is the
 * only one that ever resumes it, A never attempts a claim and there is no
 * `'lost'` at all. So the leak is a property of ANY run parked by one process
 * and consumed by another — the ordinary multi-replica deployment — and an
 * eviction hung on `'lost'` would leave that shape untouched.
 *
 * ## Why it is not only a memory leak
 *
 * The card's severity note said "the stale entry is not read back", which is
 * false: two readers hand it back.
 *
 *  - {@link AutomationEngine.listSuspendedRuns} — synchronous, cache-only, and
 *    the one listing on the `AutomationService` SPEC contract, where it is
 *    documented as "the currently suspended (paused) runs awaiting a resume".
 *  - {@link AutomationEngine.listSuspendedRunsDurable} — which deliberately
 *    APPENDS map entries the durable list lacks.
 *
 * After B **completes** the run the durable row is gone, and both listings
 * still report it: a phantom whose `getSuspendedScreen()` answers `null`, so a
 * consumer that lists and then opens gets an entry it cannot act on.
 *
 * ## The promise this file's fix relies on — stated, because it is the whole
 * question
 *
 * The fix only ever REMOVES map entries, and only ones the process has a
 * store-authoritative, per-id "no row" answer for. It relies on exactly one
 * promise, in the direction that promise already runs:
 *
 *  - the SPEC contract says `listSuspendedRuns()` lists "the currently
 *    suspended (paused) runs awaiting a resume" — a completed run is not one;
 *  - the engine's own docblock adds only that it may OMIT runs (those parked in
 *    a previous process lifetime), because it reads the cache alone.
 *
 * So under-reporting is already inside the method's declared latitude and
 * over-reporting was never inside its promise. ⛔ Nothing here makes the
 * synchronous listing store-backed, and nothing widens what it returns.
 *
 * ## The residual, pinned rather than described
 *
 * A phantom is evicted when this process obtains the per-id answer — any
 * `hasSuspendedRun` / `resume` / `getSuspendedScreen` on that run, or a
 * `listSuspendedRunsDurable()` reconcile. A process that never looks at the run
 * again keeps the entry: with no invalidation channel from B to A, the only
 * remedies for THAT are a background sweep or a store-backed listing, and both
 * are decisions above this card. `RESIDUAL` below pins the boundary so it
 * cannot be mistaken for a fix.
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

/** start -> lv1 -> lv2 -> end. Two approval levels is all the shape needs. */
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

/** One replica: a fresh engine over the SHARED store. */
function replica(store: SuspendedRunStore | undefined, opened: string[] = []): AutomationEngine {
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
      opened.push(node.id);
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

// ── the leak, both variants ─────────────────────────────────────────────────

describe('#15832 note 1 — a run parked here and consumed elsewhere leaves no phantom', () => {
  it('THE BUG (no race): A parks, B alone runs it to completion, A must list nothing', async () => {
    // The ordinary multi-replica shape: A never attempts a claim, so there is
    // no `'lost'` anywhere in this sequence.
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const a = replica(store, opened);
    const b = replica(store, opened);

    const runId = (await a.execute('expense_approval')).runId!;
    expect(opened).toEqual(['lv1']);
    expect((await approve(b, runId)).status).toBe('paused');   // lv1 -> lv2, on B
    expect((await approve(b, runId)).success).toBe(true);      // lv2 -> end, run COMPLETES
    expect(await store.load(runId)).toBeNull();                 // durable row is gone

    // Reader 1: the durable listing must not append a completed run.
    expect(listedNodes(await a.listSuspendedRunsDurable(), runId)).toEqual([]);
    // Reader 2: the spec-contract listing, once the reconcile above has run.
    expect(listedNodes(a.listSuspendedRuns(), runId)).toEqual([]);
  });

  it('THE BUG (race): the loser of the advance claim drops its stale entry', async () => {
    // A reads the run parked at lv2, then blocks INSIDE claimSuspension while B
    // consumes it — so A's compare-and-set runs against a row that is gone and
    // answers `'lost'`. That is the branch the card named.
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const a = replica(store, opened);
    const b = replica(store, opened);

    const runId = (await a.execute('expense_approval')).runId!;
    expect((await approve(b, runId)).status).toBe('paused');   // parked at lv2

    let releaseClaim: () => void = () => {};
    const gate = new Promise<void>(r => { releaseClaim = r; });
    a.setSuspendedRunStore({
      save: (run: SuspendedRun) => store.save(run),
      load: (id: string) => store.load(id),
      delete: (id: string) => store.delete(id),
      list: () => store.list(),
      async claimSuspension(id: string, at: any) {
        await gate;
        return store.claimSuspension(id, at);
      },
    });

    const losing = approve(a, runId);
    expect((await approve(b, runId)).success).toBe(true);       // B finishes the run
    releaseClaim();
    const lost = await losing;
    expect(lost.success).toBe(false);
    expect(lost.code).toBe('RESUME_IN_PROGRESS');

    expect(listedNodes(a.listSuspendedRuns(), runId)).toEqual([]);
  });

  it('list-then-open: the per-id read a consumer makes next evicts the phantom', async () => {
    // The harm the correction named — list, then open — is also the channel
    // that heals it: `hasSuspendedRun` is store-authoritative per id.
    const store = new InMemorySuspendedRunStore();
    const a = replica(store);
    const b = replica(store);

    const runId = (await a.execute('expense_approval')).runId!;
    expect((await approve(b, runId)).status).toBe('paused');
    expect((await approve(b, runId)).success).toBe(true);

    expect(await a.hasSuspendedRun(runId)).toBe(false);
    expect(listedNodes(a.listSuspendedRuns(), runId)).toEqual([]);
    expect(await a.getSuspendedScreen(runId)).toBeNull();
  });

  it('RESIDUAL: with no store-authoritative read of its own, A still holds the entry', async () => {
    // The declared boundary, pinned so it is not mistaken for a fix: eviction
    // is demand-driven. Closing THIS requires a background sweep or a
    // store-backed listing — both above this card.
    const store = new InMemorySuspendedRunStore();
    const a = replica(store);
    const b = replica(store);

    const runId = (await a.execute('expense_approval')).runId!;
    expect((await approve(b, runId)).status).toBe('paused');
    expect((await approve(b, runId)).success).toBe(true);

    // No `listSuspendedRunsDurable()`, no `hasSuspendedRun`, no resume on A.
    expect(listedNodes(a.listSuspendedRuns(), runId)).toEqual(['lv1']);
  });
});

// ── controls: the three shapes eviction must NEVER touch ────────────────────

describe('#15832 note 1 — eviction fires only on a store-authoritative per-id miss', () => {
  it('CONTROL: with no store attached the map IS the authority and nothing is evicted', async () => {
    const solo = replica(undefined);
    const runId = (await solo.execute('expense_approval')).runId!;

    expect(await solo.hasSuspendedRun(runId)).toBe(true);
    expect(listedNodes(await solo.listSuspendedRunsDurable(), runId)).toEqual(['lv1']);
    expect(listedNodes(solo.listSuspendedRuns(), runId)).toEqual(['lv1']);
  });

  it('CONTROL: a run the store never accepted (cache-only) is never evicted', async () => {
    // `persistSuspendedRun`'s documented degradation: a failed durable save
    // costs cross-restart durability, not in-process resumability. The store's
    // "no row" is SILENCE about this run, not an answer.
    const saves: string[] = [];
    const writeFailingStore: SuspendedRunStore = {
      async save(run: SuspendedRun) { saves.push(run.nodeId); throw new Error('sqlite: disk I/O error'); },
      async load() { return null; },
      async delete() {},
      async list() { return []; },
    };
    const engine = replica(writeFailingStore);
    const runId = (await engine.execute('expense_approval')).runId!;
    expect(saves).toEqual(['lv1']);

    expect(await engine.hasSuspendedRun(runId)).toBe(true);
    expect(listedNodes(await engine.listSuspendedRunsDurable(), runId)).toEqual(['lv1']);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
  });

  it('CONTROL: an unreadable store is "unknown", not a licence to evict', async () => {
    const store = new InMemorySuspendedRunStore();
    const engine = replica(store);
    const runId = (await engine.execute('expense_approval')).runId!;

    engine.setSuspendedRunStore({
      save: (run: SuspendedRun) => store.save(run),
      async load() { throw new Error('sqlite: database is locked'); },
      delete: (id: string) => store.delete(id),
      list: () => store.list(),
    });

    // The strict read THROWS rather than answering "no row" — the entry stands.
    await expect(engine.hasSuspendedRun(runId)).rejects.toThrow(/database is locked/);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
  });

  it('CONTROL: an unlistable store degrades the listing and evicts nothing', async () => {
    // `listSuspendedRunsDurable`'s documented degraded path: `byId` is empty
    // because the ENUMERATION failed, not because the rows are gone. A
    // reconcile here would evict every live run in the process.
    const store = new InMemorySuspendedRunStore();
    const engine = replica(store);
    const runId = (await engine.execute('expense_approval')).runId!;

    engine.setSuspendedRunStore({
      save: (run: SuspendedRun) => store.save(run),
      load: (id: string) => store.load(id),
      delete: (id: string) => store.delete(id),
      async list() { throw new Error('sqlite: database is locked'); },
    });

    expect(listedNodes(await engine.listSuspendedRunsDurable(), runId)).toEqual(['lv1']);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
  });

  it('CONTROL: a live run parked in THIS process survives every reconcile', async () => {
    const store = new InMemorySuspendedRunStore();
    const engine = replica(store);
    const runId = (await engine.execute('expense_approval')).runId!;

    expect(listedNodes(await engine.listSuspendedRunsDurable(), runId)).toEqual(['lv1']);
    expect(await engine.hasSuspendedRun(runId)).toBe(true);
    expect(listedNodes(engine.listSuspendedRuns(), runId)).toEqual(['lv1']);
    expect((await approve(engine, runId)).status).toBe('paused');
  });
});
