// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A resume reads the run's state from the SHARED store, not from this replica's
 * own memory of where the run was last parked (#13617).
 *
 * ## The defect
 *
 * `AutomationEngine.suspendedRuns` is a per-process map of paused runs, and
 * `loadSuspendedRunStrict` used to read it FIRST and consult the durable store
 * only on a miss. That is a correct read for exactly one deployment shape: a
 * single process. Put three replicas behind a load balancer over one postgres
 * and the map becomes a per-replica snapshot of the node a run was parked at
 * THE LAST TIME THIS REPLICA TOUCHED IT — and nothing invalidates it, because
 * nothing is wired to invalidate it.
 *
 * Reported from a three-replica deployment as: every approval level except the
 * first is created twice, so one approver approves each level twice, and a
 * three-level flow produces five `sys_approval_request` rows (lv1 x1, lv2 x2,
 * lv3 x2). The duplicate's `created_at` sits ~60ms after the previous node's
 * `completed_at` — the resume itself re-created the level it had just left. A
 * second observed shape, from the same environment: the FINAL approval rolls
 * the run back to the previous level and opens a fourth pending node, and the
 * run never terminates. One replica, same database, same flow: zero duplicates.
 *
 * Both shapes are ONE mechanism at two different points in the flow — a resume
 * that read a suspension one beat stale and traversed forward from it — which
 * is why both are pinned here off the same helper.
 *
 * ## What is NOT the mechanism
 *
 * Not the missing `attachClusterPubSub()` from that deployment's boot log: that
 * is the METADATA cache-invalidation channel (`MetadataClusterBridgePlugin` over
 * `MetadataManager`), and this package has no cluster or pub/sub wiring of any
 * kind — there is no invalidation channel here that could have been disabled.
 * Attaching that bridge would not move these tests one bit; only reading the
 * shared store does. Nor is it leader election on scheduled jobs: an approval
 * resume arrives on the decision-write path, not from a job tick.
 *
 * ## REVERT-PROOF
 *
 * Restore the old cache-first order in `loadSuspendedRunStrict`
 * (`const cached = this.suspendedRuns.get(runId); if (cached) return cached;`)
 * and the two `THE BUG` cases below fail — the first counting a duplicated
 * middle level, the second a run that rolled back instead of terminating —
 * while every negative control stays green, which is the defect stated as a
 * test. Measured: with the old order they report 4 and 4 opened levels
 * respectively where 3 are correct.
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
 * One replica: a fresh engine over the SHARED store, appending the id of every
 * level it opens to the shared `opened` ledger. `opened` stands in for
 * `sys_approval_request` — the table the report counted rows in — so a level
 * created twice appears twice here, in order.
 *
 * `resumeAuthority: 'service'` mirrors the real `approval` node: the owning
 * service authorizes and records the decision, then resumes with the in-process
 * marker. Resuming any other way is a different door and a different test.
 */
function replica(store: SuspendedRunStore | undefined, opened: string[]): AutomationEngine {
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
  });
  engine.registerFlow('expense_approval', APPROVAL_FLOW);
  return engine;
}

/** The approve that the approvals service issues once it has recorded a
 *  decision — the only door a `resumeAuthority: 'service'` pause opens for. */
function approve(engine: AutomationEngine, runId: string) {
  return engine.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any);
}

describe('multi-replica approval resume reads the shared store (#13617)', () => {
  // ── THE BUG, shape 1: a middle level created twice ──────────────────────
  //
  // Replica schedule (the load balancer's, not ours): A opens the run and is
  // therefore holding `lv1` in memory; B takes the `lv1` decision and moves the
  // run to `lv2`; the `lv2` decision comes back to A, whose memory still says
  // `lv1`. That third hop is the whole defect — A resumed from `lv1` and opened
  // `lv2` a second time instead of opening `lv3`.

  it('THE BUG: a replica that fell one level behind must not re-open that level', async () => {
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const a = replica(store, opened);
    const b = replica(store, opened);

    const submitted = await a.execute('expense_approval');
    expect(submitted.status).toBe('paused');
    const runId = submitted.runId!;
    expect(opened).toEqual(['lv1']);

    // `lv1` is decided on B. The run advances in the shared store; A's memory
    // of it does not move, and nothing tells A that it is now stale.
    const first = await approve(b, runId);
    expect(first.status).toBe('paused');
    expect(opened).toEqual(['lv1', 'lv2']);

    // `lv2` is decided on A — the replica that is one beat behind.
    const second = await approve(a, runId);
    expect(second.success).toBe(true);
    expect(second.status).toBe('paused');

    // Exactly one request per level, in order. Cache-first read: a second
    // 'lv2' lands here instead of 'lv3'.
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);

    // …and BOTH replicas agree the run is parked, at the same level: a
    // store-authoritative read is the same read everywhere. Proven by taking
    // the last decision on the OTHER replica — it terminates the run and opens
    // nothing, which only holds if it resumed from `lv3` too.
    expect(await a.hasSuspendedRun(runId)).toBe(true);
    expect(await b.hasSuspendedRun(runId)).toBe(true);
    const final = await approve(b, runId);
    expect(final.success).toBe(true);
    expect(final.status).toBeUndefined();
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);
  });

  // ── THE BUG, shape 2: the final approval rolls the run back ─────────────
  //
  // Same mechanism, landing on the LAST level. Reported as: three levels each
  // approved exactly once, then the third approval re-opens a fourth pending
  // node and the run stays "in approval" forever instead of completing.

  it('THE BUG: the final approval terminates the run, it does not roll it back', async () => {
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const a = replica(store, opened);
    const b = replica(store, opened);

    const runId = (await a.execute('expense_approval')).runId!;
    // A takes the first decision too, so A's memory is current at `lv2` — one
    // beat behind is what this shape needs, not two.
    await approve(a, runId);
    // B takes the second: the run moves to `lv3` in the store, A still says `lv2`.
    expect((await approve(b, runId)).status).toBe('paused');
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);

    // The final decision lands on the stale replica.
    const final = await approve(a, runId);

    // It TERMINATES. `status` is absent on a completed run — a `'paused'` here
    // is the reported "single stays in approval and never finishes".
    expect(final.success).toBe(true);
    expect(final.status).toBeUndefined();

    // No fourth node was opened, on any level.
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);

    // Nothing is left parked, as either replica sees it.
    for (const node of [a, b]) {
      expect(await node.hasSuspendedRun(runId)).toBe(false);
    }
  });

  // ── The store's silence is authoritative, not overridden by stale memory ──

  it('a finished run is RUN_NOT_FOUND on the replica still holding it in memory', async () => {
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const a = replica(store, opened);
    const b = replica(store, opened);

    const runId = (await a.execute('expense_approval')).runId!;
    // B walks the run all the way out. A's memory still holds the `lv1` pause.
    for (let i = 0; i < 3; i++) await approve(b, runId);
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);

    const late = await approve(a, runId);
    expect(late.success).toBe(false);
    // The classified refusal, not a silent no-op: approvals persists a decision
    // BEFORE resuming and must be able to tell "gone for good" from "retry".
    expect(late.code).toBe('RUN_NOT_FOUND');
    // A refusal carries no run status — nothing dispatched.
    expect(late.status).toBeUndefined();
    // And it re-opened nothing on its way to that answer.
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);
  });

  // ── Negative controls ───────────────────────────────────────────────────

  it('NEGATIVE CONTROL: one replica is unchanged — three levels, three requests', async () => {
    // The report's own control: same database, same flow definition, a single
    // app replica, zero duplicates. It passed before this fix and must keep
    // passing after it, or the fix moved the defect rather than removing it.
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const only = replica(store, opened);

    const runId = (await only.execute('expense_approval')).runId!;
    expect((await approve(only, runId)).status).toBe('paused');
    expect((await approve(only, runId)).status).toBe('paused');
    const final = await approve(only, runId);

    expect(final.success).toBe(true);
    expect(final.status).toBeUndefined();
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);
  });

  it('NEGATIVE CONTROL: the healthy multi-replica path still advances once per level', async () => {
    // Every decision lands on a replica that has never seen this run — the
    // round-robin case that always worked, because a cold replica had nothing
    // stale to read. It must still advance exactly one level per approval.
    const store = new InMemorySuspendedRunStore();
    const opened: string[] = [];
    const submitter = replica(store, opened);

    const runId = (await submitter.execute('expense_approval')).runId!;
    expect((await approve(replica(store, opened), runId)).status).toBe('paused');
    expect((await approve(replica(store, opened), runId)).status).toBe('paused');
    const final = await approve(replica(store, opened), runId);

    expect(final.success).toBe(true);
    expect(final.status).toBeUndefined();
    expect(opened).toEqual(['lv1', 'lv2', 'lv3']);
  });

  it('NEGATIVE CONTROL: with no store at all, behaviour is purely in-memory', async () => {
    // The historical default (LiteKernel, tests, dev): no durable store, so the
    // engine's own map IS the authority and there is nothing to be stale
    // against. A run parked here resumes here and nowhere else.
    const opened: string[] = [];
    const solo = replica(undefined, opened);

    const runId = (await solo.execute('expense_approval')).runId!;
    expect((await approve(solo, runId)).status).toBe('paused');
    expect(opened).toEqual(['lv1', 'lv2']);

    // A second engine shares no state with it — nothing was persisted.
    const other = replica(undefined, opened);
    const elsewhere = await approve(other, runId);
    expect(elsewhere.success).toBe(false);
    expect(elsewhere.code).toBe('RUN_NOT_FOUND');
  });

  it('NEGATIVE CONTROL: a run the store never accepted is still resumable in-process', async () => {
    // `persistSuspendedRun` documents this degradation and logs it at `error`:
    // a failed durable save costs CROSS-RESTART durability, not in-process
    // resumability. Making the store authoritative must not quietly convert
    // that into an unresumable run — the store's "no row" says nothing about a
    // row it was never handed.
    const opened: string[] = [];
    const saves: string[] = [];
    const writeOnlyFailingStore: SuspendedRunStore = {
      async save(run: SuspendedRun) { saves.push(run.nodeId); throw new Error('sqlite: disk I/O error'); },
      async load() { return null; },
      async delete() {},
      async list() { return []; },
    };
    const engine = replica(writeOnlyFailingStore, opened);

    const runId = (await engine.execute('expense_approval')).runId!;
    expect(saves).toEqual(['lv1']);

    // The pause never reached the store, and this process can still continue it.
    const advanced = await approve(engine, runId);
    expect(advanced.success).toBe(true);
    expect(advanced.status).toBe('paused');
    expect(opened).toEqual(['lv1', 'lv2']);
  });

  it('NEGATIVE CONTROL: an unreadable store is STORE_UNAVAILABLE, never a lost run', async () => {
    // The other half of the same rule, and the reason the strict reader exists
    // (#4420): an outage is "unknown", not "gone". A caller that already wrote a
    // decision needs "retry when the store is back" to be distinguishable from
    // "this run is gone for good" — same failure, opposite remedy.
    const opened: string[] = [];
    const store = new InMemorySuspendedRunStore();
    const engine = replica(store, opened);
    const runId = (await engine.execute('expense_approval')).runId!;

    const brokenStore: SuspendedRunStore = {
      async save() {},
      async load() { throw new Error('sqlite: database is locked'); },
      async delete() {},
      async list() { return []; },
    };
    engine.setSuspendedRunStore(brokenStore);

    const refused = await approve(engine, runId);
    expect(refused.success).toBe(false);
    expect(refused.code).toBe('STORE_UNAVAILABLE');
    expect(refused.status).toBeUndefined();
    // Refused before consuming anything: no level was opened or re-opened.
    expect(opened).toEqual(['lv1']);
  });
});
