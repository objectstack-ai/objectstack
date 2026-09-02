// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The three OTHER readers of suspended-run state read the SHARED store, not
 * this replica's memory of where the run was last parked (#14332).
 *
 * ## The defect
 *
 * #13617 made the RESUME path store-authoritative: `loadSuspendedRunStrict`
 * reads the shared row and consults the per-process map only for a run the
 * store never accepted. Three other readers of the same state still preferred
 * the map, each with the same mechanism and a different consequence:
 *
 *  1. `cancelRun` — the row deletion is by id and is therefore right either
 *     way, but `forgetSuspendedRun` notifies the executor of the node recorded
 *     on the object it was handed. Cancel from a stale snapshot and the WRONG
 *     node executor is told its pause is over: whatever the live node armed is
 *     not torn down, and a node the run left long ago is released a second
 *     time. So every pin below asserts on the NOTIFICATION, never on the row.
 *  2. `failAncestors` — #13617's own harm shape one level up: a stale parent is
 *     failed at a node it has already left.
 *  3. `listSuspendedRunsDurable` — merged the durable list under the in-process
 *     map, so the listing reported the node this replica last saw rather than
 *     the node the run is parked at.
 *
 * ## Why a sibling file rather than more cases in the #13617 harness
 *
 * `multi-replica-resume-staleness.test.ts` carries a REVERT-PROOF ledger in its
 * module docblock: one named mutation (restoring the cache-first read at the
 * top of `loadSuspendedRunStrict`) and the measured 4 red / 4 green split it
 * produces. Adding these cases to that file would falsify those counts and mix
 * two different mutations' revert-proofs into one statement. This file gets its
 * own, below, and shares only the two-engines-over-one-store SHAPE.
 *
 * ## REVERT-PROOF
 *
 * Restore ONE site's map-first read at a time and this file splits as follows —
 * measured per site on the committed tree, not predicted:
 *
 *  - site 1, `run = this.suspendedRuns.get(runId) ?? await this.loadSuspendedRunStrict(runId)`
 *    → **2 red / 9 green**. `THE BUG` reports the teardown naming `lv1` while
 *    the run is parked at `lv2` — the wrong node executor told its pause is
 *    over. `NEW REACH` goes red with it, and that is the same fact seen from
 *    the other side: a map hit means the unreadable store is never read at all,
 *    so the cancel proceeds from the local snapshot instead of degrading.
 *  - site 2, `const parent = this.suspendedRuns.get(parentId) ?? await this.loadSuspendedRun(parentId)`
 *    → **2 red / 9 green**. The ancestor is failed at `lv1`, a node it has
 *    already left; the unreadable-ancestor control goes with it for site 1's
 *    reason — a map hit never reaches the store, so the walk that should have
 *    stopped instead tears down a stale parent.
 *  - site 3, drop the `byId.has(r.runId)` guard so the map overwrites again
 *    → **1 red / 10 green**. The listing reports `lv1`, one level stale.
 *
 * What stays green under all three is what must: the no-store cases where the
 * map IS the authority, the failed-durable-save cases the store's silence says
 * nothing about, and the unlistable store's documented short list. Each
 * mutation was proven on disk by anchored occurrence counts before its run and
 * restored with `git checkout HEAD --`, the restore proven by `git hash-object`
 * against the HEAD blob.
 */

import { describe, it, expect } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext, SuspendedRun, SuspendedRunStore } from './engine.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

/** What `NodeExecutor.onSuspensionReleased` was told — the fact under test. */
interface Release {
  runId: string;
  flowName: string;
  nodeId: string;
  correlation?: string;
  reason: string;
}

/** A three-level approval chain: start -> lv1 -> lv2 -> lv3 -> end. */
const APPROVAL_FLOW = {
  name: 'expense_approval',
  label: 'Expense approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'lv1', type: 'approval_level', label: 'Department head' },
    { id: 'lv2', type: 'approval_level', label: 'General manager' },
    { id: 'lv3', type: 'approval_level', label: 'Finance' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'lv1' },
    { id: 'e2', source: 'lv1', target: 'lv2' },
    { id: 'e3', source: 'lv2', target: 'lv3' },
    { id: 'e4', source: 'lv3', target: 'end' },
  ],
} as any;

/**
 * A subflow child that pauses and then fails downstream — the only door to
 * `failAncestors`, which runs in `resumeInternal`'s catch arm. The child's own
 * pause is deliberately a different node type with no release hook, so the
 * `released` ledger holds ancestor teardowns alone.
 */
const CHILD_FLOW = {
  name: 'child_task',
  label: 'Child task',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'hold', type: 'child_pause', label: 'Hold' },
    { id: 'write_back', type: 'exploding_writer', label: 'Write back' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'hold' },
    { id: 'e2', source: 'hold', target: 'write_back' },
    { id: 'e3', source: 'write_back', target: 'end' },
  ],
} as any;

/**
 * One replica: a fresh engine over the SHARED store. `opened` records every
 * level opened (a level re-opened appears twice); `released` records every
 * suspension teardown the approval executor is notified of — the node id and
 * the correlation IT minted, which is what says whose pause was torn down.
 */
function replica(
  store: SuspendedRunStore | undefined,
  opened: string[],
  released: Release[],
): AutomationEngine {
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
    async execute(node) {
      opened.push(node.id);
      return { success: true, suspend: true, correlation: `req_${node.id}` };
    },
    async onSuspensionReleased(release) {
      released.push({
        runId: release.runId,
        flowName: release.flowName,
        nodeId: release.nodeId,
        correlation: release.correlation,
        reason: release.reason,
      });
    },
  });
  engine.registerNodeExecutor({
    type: 'child_pause',
    descriptor: defineActionDescriptor({
      type: 'child_pause',
      version: '1.0.0',
      name: 'Child pause',
      supportsPause: true,
      resumeAuthority: 'any',
    }),
    async execute() {
      return { success: true, suspend: true, correlation: 'child:hold' };
    },
  });
  engine.registerNodeExecutor({
    type: 'exploding_writer',
    async execute() {
      throw new Error('update_record(expense_claim) failed: Record not found in expense_claim');
    },
  });
  engine.registerFlow('expense_approval', APPROVAL_FLOW);
  engine.registerFlow('child_task', CHILD_FLOW);
  return engine;
}

/** The approve the approvals service issues once it has recorded a decision. */
function approve(engine: AutomationEngine, runId: string) {
  return engine.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any);
}

/** A store that saves and lists fine but cannot be READ for one id. */
function unreadableFor(inner: SuspendedRunStore, blindId: () => string): SuspendedRunStore {
  return {
    save: (run) => inner.save(run),
    async load(runId) {
      if (runId === blindId()) throw new Error('sqlite: database is locked');
      return inner.load(runId);
    },
    delete: (runId) => inner.delete(runId),
    list: () => inner.list(),
  };
}

/** Park a run on `a` at `lv1`, then let `b` advance it to `lv2` in the store. */
async function parkedOnOneReplicaAdvancedOnAnother(
  store: SuspendedRunStore,
  opened: string[],
  released: Release[],
): Promise<{ a: AutomationEngine; b: AutomationEngine; runId: string }> {
  const a = replica(store, opened, released);
  const b = replica(store, opened, released);
  const runId = (await a.execute('expense_approval')).runId!;
  expect(opened).toEqual(['lv1']);
  // The lv1 decision round-robins to B: the shared row advances to lv2 while
  // A's map still says lv1, and nothing tells A that it is now stale.
  expect((await approve(b, runId)).status).toBe('paused');
  expect(opened).toEqual(['lv1', 'lv2']);
  return { a, b, runId };
}

// ── site 1: cancelRun ───────────────────────────────────────────────────────

describe('#14332 site 1 — cancelRun tears down the pause the run is ACTUALLY parked at', () => {
  it('THE BUG: a stale replica must not tell the wrong node executor its pause is over', async () => {
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const released: Release[] = [];
    const { a, b, runId } = await parkedOnOneReplicaAdvancedOnAnother(store, opened, released);

    // The submitter withdraws, and the recall lands on the STALE replica.
    expect(await a.cancelRun(runId, 'submitter withdrew the claim')).toBe(true);

    // The live pause is lv2's. Cache-first read: `lv1` / `req_lv1` lands here —
    // lv2's executor never learns its pause ended and whatever it armed stays
    // armed, while lv1's is released a second time.
    expect(released.filter(r => r.reason === 'cancelled')).toEqual([
      { runId, flowName: 'expense_approval', nodeId: 'lv2', correlation: 'req_lv2', reason: 'cancelled' },
    ]);

    // The row deletion is by id and is correct either way — which is exactly
    // why the assertion above is on the notification and not on the row.
    expect(await store.load(runId)).toBeNull();
    expect(await b.hasSuspendedRun(runId)).toBe(false);
  });

  it('NEGATIVE CONTROL: with no store the map IS the authority and the cancel still tears down', async () => {
    const opened: string[] = [];
    const released: Release[] = [];
    const solo = replica(undefined, opened, released);

    const runId = (await solo.execute('expense_approval')).runId!;
    expect(await solo.cancelRun(runId, 'withdrawn')).toBe(true);
    expect(released.filter(r => r.reason === 'cancelled')).toEqual([
      { runId, flowName: 'expense_approval', nodeId: 'lv1', correlation: 'req_lv1', reason: 'cancelled' },
    ]);
  });

  it('NEGATIVE CONTROL: a run the store never accepted is still cancellable in-process', async () => {
    // `persistSuspendedRun`'s documented degradation: a failed durable save
    // costs cross-restart durability, not in-process resumability — and not
    // cancellability either. `loadSuspendedRunStrict`'s `cacheOnlySuspensions`
    // branch is the whole reason this stays true through a store-authoritative
    // read: the store was never handed the row, so its silence says nothing.
    const opened: string[] = [];
    const released: Release[] = [];
    const saves: string[] = [];
    const writeFailingStore: SuspendedRunStore = {
      async save(run: SuspendedRun) { saves.push(run.nodeId); throw new Error('sqlite: disk I/O error'); },
      async load() { return null; },
      async delete() {},
      async list() { return []; },
    };
    const engine = replica(writeFailingStore, opened, released);

    const runId = (await engine.execute('expense_approval')).runId!;
    expect(saves).toEqual(['lv1']);
    expect(await engine.cancelRun(runId, 'withdrawn')).toBe(true);
    expect(released.filter(r => r.reason === 'cancelled')).toEqual([
      { runId, flowName: 'expense_approval', nodeId: 'lv1', correlation: 'req_lv1', reason: 'cancelled' },
    ]);
  });

  it('NEW REACH: an unreadable store is "unknown", not a licence to tear down the local snapshot', async () => {
    // The reachability this fix buys, and the one behaviour change it makes on
    // this site: a run parked in THIS process used to be answered from memory,
    // so its own cancel never touched the store. Now the read is
    // store-authoritative, so an outage lands on the #4632 DURABILITY record
    // this seam already carries (pinned byte-for-byte in
    // `suspended-run-store-consume-log-cause.test.ts`) instead of tearing down
    // a snapshot that may name a node the run has left. The cancellation is
    // skipped, and the run stays parked and resumable — which is what that
    // record tells the operator.
    const opened: string[] = [];
    const released: Release[] = [];
    const store = new InMemorySuspendedRunStore();
    const engine = replica(store, opened, released);
    const runId = (await engine.execute('expense_approval')).runId!;

    engine.setSuspendedRunStore(unreadableFor(store, () => runId));

    expect(await engine.cancelRun(runId, 'withdrawn')).toBe(false);
    expect(released.filter(r => r.reason === 'cancelled'), 'nothing was torn down').toEqual([]);
    expect(await store.load(runId), 'the run is still parked').not.toBeNull();
  });
});

// ── site 2: failAncestors ───────────────────────────────────────────────────

describe('#14332 site 2 — failAncestors fails the ancestor at the node it is ACTUALLY parked at', () => {
  it('THE BUG: a stale parent must not be failed at a node it has already left', async () => {
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const released: Release[] = [];
    const { a, runId: parentRunId } = await parkedOnOneReplicaAdvancedOnAnother(store, opened, released);

    // A subflow child of that parent, launched and then resumed on the STALE
    // replica, whose downstream node throws — `resumeInternal`'s catch arm is
    // the only caller of `failAncestors`.
    const child = await a.execute('child_task', { $parentRunId: parentRunId } as unknown as AutomationContext);
    expect(child.status).toBe('paused');
    const failed = await a.resume(child.runId!);
    expect(failed.success).toBe(false);
    expect(failed.error).toContain('Record not found in expense_claim');

    // The ancestor is failed where it is parked — lv2. Cache-first read: lv1,
    // so lv2's approval sits armed under a run that has just been failed.
    // Filtered to the TERMINAL teardown: the setup's own `lv1` release (reason
    // `resumed`, when B took the lv1 decision) is a different, correct fact.
    expect(released.filter(r => r.runId === parentRunId && r.reason === 'failed')).toEqual([
      { runId: parentRunId, flowName: 'expense_approval', nodeId: 'lv2', correlation: 'req_lv2', reason: 'failed' },
    ]);
    expect(await store.load(parentRunId), 'the ancestor is terminal').toBeNull();
  });

  it('NEGATIVE CONTROL: with no store, the in-process ancestor is still failed', async () => {
    const opened: string[] = [];
    const released: Release[] = [];
    const solo = replica(undefined, opened, released);

    const parentRunId = (await solo.execute('expense_approval')).runId!;
    const child = await solo.execute('child_task', { $parentRunId: parentRunId } as unknown as AutomationContext);
    expect((await solo.resume(child.runId!)).success).toBe(false);

    expect(released.filter(r => r.runId === parentRunId && r.reason === 'failed')).toEqual([
      { runId: parentRunId, flowName: 'expense_approval', nodeId: 'lv1', correlation: 'req_lv1', reason: 'failed' },
    ]);
  });

  it('NEGATIVE CONTROL: an unreadable ancestor stops the walk, it does not throw out of the failure path', async () => {
    // The posture the bare `.catch(() => null)` had and the degrading loader
    // keeps: this walk runs inside the catch arm that is already handling a
    // failure, so a store outage must read as "no ancestor here" and end the
    // walk — never propagate. The child's own failure is what the caller sees.
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const released: Release[] = [];
    let parentRunId = '';
    const a = replica(unreadableFor(store, () => parentRunId), opened, released);

    parentRunId = (await a.execute('expense_approval')).runId!;
    const child = await a.execute('child_task', { $parentRunId: parentRunId } as unknown as AutomationContext);
    const failed = await a.resume(child.runId!);

    expect(failed.success).toBe(false);
    expect(failed.error, "the child's own failure, not the store's").toContain('Record not found in expense_claim');
    expect(released.filter(r => r.runId === parentRunId), 'no ancestor was released').toEqual([]);
    expect(await store.load(parentRunId), 'the ancestor is untouched and still parked').not.toBeNull();
  });
});

// ── site 3: listSuspendedRunsDurable ────────────────────────────────────────

describe('#14332 site 3 — listSuspendedRunsDurable prefers the durable row over this process\'s memory', () => {
  it('THE BUG: the durable row wins an id collision, the stale in-process copy does not', async () => {
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const released: Release[] = [];
    const { a, runId } = await parkedOnOneReplicaAdvancedOnAnother(store, opened, released);

    // Cache-first merge: `lv1` / `req_lv1` — the node this replica last saw.
    expect(await a.listSuspendedRunsDurable()).toEqual([
      { runId, flowName: 'expense_approval', nodeId: 'lv2', correlation: 'req_lv2' },
    ]);
  });

  it('a run the store never accepted is still listed — the cache is its only copy', async () => {
    const opened: string[] = [];
    const released: Release[] = [];
    const writeFailingStore: SuspendedRunStore = {
      async save() { throw new Error('sqlite: disk I/O error'); },
      async load() { return null; },
      async delete() {},
      async list() { return []; },
    };
    const engine = replica(writeFailingStore, opened, released);

    const runId = (await engine.execute('expense_approval')).runId!;
    expect(await engine.listSuspendedRunsDurable()).toEqual([
      { runId, flowName: 'expense_approval', nodeId: 'lv1', correlation: 'req_lv1' },
    ]);
  });

  it('NEGATIVE CONTROL: an unlistable store still degrades to the in-memory cache alone', async () => {
    // #4632 verdict FUNCTIONAL, unchanged: the enumeration failed, the rows are
    // intact, and the listing says so at `warn` while answering from the cache.
    // The merge direction must not turn that degradation into an empty answer.
    const opened: string[] = [];
    const released: Release[] = [];
    const inner = new InMemorySuspendedRunStore();
    const unlistable: SuspendedRunStore = {
      save: (run) => inner.save(run),
      load: (runId) => inner.load(runId),
      delete: (runId) => inner.delete(runId),
      async list(): Promise<SuspendedRun[]> { throw new Error('sqlite: database is locked'); },
    };
    const engine = replica(unlistable, opened, released);

    const runId = (await engine.execute('expense_approval')).runId!;
    expect(await engine.listSuspendedRunsDurable()).toEqual([
      { runId, flowName: 'expense_approval', nodeId: 'lv1', correlation: 'req_lv1' },
    ]);
  });

  it('NEGATIVE CONTROL: with no store the durable listing is the in-memory listing', async () => {
    const opened: string[] = [];
    const released: Release[] = [];
    const solo = replica(undefined, opened, released);

    const runId = (await solo.execute('expense_approval')).runId!;
    expect(await solo.listSuspendedRunsDurable()).toEqual(solo.listSuspendedRuns());
    expect(await solo.listSuspendedRunsDurable()).toEqual([
      { runId, flowName: 'expense_approval', nodeId: 'lv1', correlation: 'req_lv1' },
    ]);
  });
});
