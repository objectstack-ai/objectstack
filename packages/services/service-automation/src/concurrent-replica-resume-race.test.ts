// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14333 — two CONCURRENT resumes of one run, on two replicas over one shared
 * store, must advance it exactly once.
 *
 * ## Why this is a sibling file and not more cases in the staleness harness
 *
 * `multi-replica-resume-staleness.test.ts` (#13617) is the two-engines-over-
 * one-shared-store harness of record, and it carries a REVERT-PROOF ledger
 * keyed to its own mutation: restore the cache-first read at the top of
 * `loadSuspendedRunStrict` and that file goes exactly `4 red / 4 green`, case
 * by named case. Adding cases there would silently invalidate those counts —
 * the ledger would describe a file that no longer exists — so the concurrent
 * half lives here, off its own mutation, and that file's ledger stays true.
 *
 * ## The defect this file measures
 *
 * #13617 closed the SEQUENTIAL failure (a replica resuming from a snapshot it
 * had gone stale on). It did not close the CONCURRENT one. `resumeInternal`
 * guards a duplicate resume with `this.resuming`, an in-process `Set`. Two
 * decisions on ONE run arriving in the same instant on TWO replicas each pass
 * their OWN `resuming` check, both read the same fresh row out of the shared
 * store, both consume it, and both traverse forward — so every downstream side
 * effect runs twice.
 *
 * ## What "both advanced" is asserted on
 *
 * OBSERVABLE EFFECTS, never internal bookkeeping. The flow below puts a real
 * side-effect node between the two approval levels:
 *
 *     start -> lv1 (pauses) -> notify (fires) -> lv2 (pauses) -> end
 *
 * so one advance past `lv1` fires `notify` once and opens `lv2` once. The
 * defect's signature is `notify` in the `fired` ledger TWICE and `lv2` in the
 * `opened` ledger twice — an action fired twice and a node executed twice,
 * which is the `sys_approval_request` duplication the family was reported as.
 * "Both callers entered `resumeInternal`" is deliberately NOT the assertion.
 *
 * ## The remedy this file pins
 *
 * A conditional advance on `SuspendedRunStore` — `claimSuspension`, "consume
 * the row only if it is still parked at node N with correlation C" — so the
 * winner advances and the loser is told `RESUME_IN_PROGRESS` and runs nothing.
 * The per-process `this.resuming` stays as the cheap first gate; it is not
 * replaced.
 *
 * ## REVERT-PROOF — three mutations, all measured on the committed tree
 *
 * Each was confirmed ON DISK before a single result was read (anchored counts
 * plus the blob hash) and restored inside a `trap ... EXIT INT TERM`, with the
 * restore proven by an empty `git diff HEAD` and a blob hash equal to HEAD's.
 * The population is these three files: this one, `suspended-run-store.test.ts`
 * and `multi-replica-resume-staleness.test.ts` — 61 tests.
 *
 * **(E) the engine stops asking.** Replace the `claimAdvance` call in
 * `resumeInternal` with the unconditional `forgetSuspendedRun(run, 'resumed')`
 * it had before this card: `Tests 9 failed | 52 passed (61)`. Seven here
 * (SHAPE A and SHAPE B on `expected [ 'notify', 'notify' ] to deeply equal
 * [ 'notify' ]`, SIZED on `{ trials: 25, doubled: 25, extraOpens: 25 }`, both
 * CONDITION cases, the loser's `debug` trace and the declared degradation) and
 * two in `suspended-run-store.test.ts` (the two-engines race over the durable
 * store, and the throwing claim). `multi-replica-resume-staleness.test.ts`
 * stays 8/8: the mutation is targeted, and #13617's own ledger is untouched.
 *
 * **(C) the condition stops being a condition.** Delete BOTH comparisons from
 * `InMemorySuspendedRunStore.claimSuspension`, leaving an existence-only
 * consume: `Tests 2 failed | 59 passed (61)` — exactly the two CONDITION cases
 * below, and nothing else. That is the point of them. Every other race in this
 * file lets the loser lose by finding no row at all, which an existence check
 * satisfies too; before those two existed this mutation was measured GREEN
 * across the whole branch.
 *
 * **(C2) the production store loses its predicate.** Delete `multi: true` from
 * the one `delete` call in `ObjectStoreSuspendedRunStore.claimSuspension`:
 * `Tests 7 failed | 54 passed (61)`, every one of them in
 * `suspended-run-store.test.ts`, failing with the PRODUCER's own refusal —
 * "Delete names one row by primary key, but options.where also carries
 * predicate keys 'node_id', 'correlation' ... For a conditional
 * (compare-and-set) write, declare the predicate path". Against a running
 * server that spelling throws and `claimAdvance` turns it into
 * `STORE_UNAVAILABLE` on EVERY resume; before that suite existed, this
 * one-token regression was measured GREEN across the whole branch.
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

/** A logger that keeps every line, so a degradation can be read back. */
function capturingLogger(lines: string[]): any {
    const l: any = {
        info: (m: string) => lines.push(`info ${m}`),
        warn: (m: string) => lines.push(`warn ${m}`),
        error: (m: string) => lines.push(`error ${m}`),
        debug: (m: string) => lines.push(`debug ${m}`),
        child: () => l,
    };
    return l;
}

/**
 * Two approval levels with a real side effect between them, so ONE advance
 * past `lv1` is distinguishable from two by what ran, not by what was called.
 */
const APPROVAL_FLOW = {
    name: 'expense_approval',
    label: 'Expense approval',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'lv1', type: 'approval_level', label: 'Department head' },
        { id: 'notify', type: 'notify_action', label: 'Notify finance' },
        { id: 'lv2', type: 'approval_level', label: 'General manager' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'lv1' },
        { id: 'e2', source: 'lv1', target: 'notify' },
        { id: 'e3', source: 'notify', target: 'lv2' },
        { id: 'e4', source: 'lv2', target: 'end' },
    ],
} as any;

/** The shared ledgers a run writes into, standing in for real side effects. */
interface Ledgers {
    /** Approval levels opened — one `sys_approval_request` row each. */
    opened: string[];
    /** Downstream actions fired — the doubled effect this card is about. */
    fired: string[];
}

/**
 * One replica: a fresh engine over the SHARED store, appending to the SHARED
 * ledgers. Two replicas therefore see one another's effects, exactly as two
 * app instances over one database see one another's rows.
 */
function replica(store: SuspendedRunStore | undefined, led: Ledgers, logger = silentLogger()): AutomationEngine {
    const engine = new AutomationEngine(logger, store);
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
            led.opened.push(node.id);
            return { success: true, suspend: true, correlation: `req_${node.id}` };
        },
    });
    engine.registerNodeExecutor({
        type: 'notify_action',
        descriptor: defineActionDescriptor({
            type: 'notify_action',
            version: '1.0.0',
            name: 'Notify',
        }),
        async execute(node) {
            led.fired.push(node.id);
            return { success: true };
        },
    });
    engine.registerFlow('expense_approval', APPROVAL_FLOW);
    return engine;
}

const ledgers = (): Ledgers => ({ opened: [], fired: [] });

/** The approve an approvals service issues once it has recorded a decision. */
function approve(engine: AutomationEngine, runId: string, signal: Record<string, unknown> = {}) {
    return engine.resume(runId, { ...signal, [RESUME_AUTHORITY_SERVICE]: true } as any);
}

/** Park a fresh run at `lv1` on `submitter`, returning its id. */
async function parkAtLv1(submitter: AutomationEngine): Promise<string> {
    const submitted = await submitter.execute('expense_approval');
    expect(submitted.status).toBe('paused');
    return submitted.runId!;
}

describe('#14333 concurrent resumes of one run on two replicas advance it exactly once', () => {
    // ── SHAPE A: parallel / any-of approvers ────────────────────────────────
    //
    // Two DIFFERENT approvers on the same level, both authorized to advance it
    // (any-of), click approve in the same instant. The load balancer puts one
    // decision on replica A and the other on replica B. Each engine's own
    // `resuming` set is empty, so neither sees the other.

    it('SHAPE A (any-of approvers): the level advances once and fires the action once', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const a = replica(store, led);
        const b = replica(store, led);

        const runId = await parkAtLv1(a);
        expect(led.opened).toEqual(['lv1']);

        const [byAlice, byBob] = await Promise.all([
            approve(a, runId, { approver: 'alice' }),
            approve(b, runId, { approver: 'bob' }),
        ]);

        // THE OBSERVABLE EFFECT. One advance past `lv1`: the action fires once
        // and exactly one `lv2` request is opened. Unguarded, this reads
        // `['notify','notify']` and `['lv1','lv2','lv2']`.
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);

        // Exactly one winner, and the loser is TOLD — not silently dropped.
        const winners = [byAlice, byBob].filter((r) => r.success);
        const losers = [byAlice, byBob].filter((r) => !r.success);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(winners[0]!.status).toBe('paused');
        expect(losers[0]!.code).toBe('RESUME_IN_PROGRESS');
        // A refusal carries no run status — nothing was dispatched for it.
        expect(losers[0]!.status).toBeUndefined();

        // And the run is still one run, parked once, as either replica reads it.
        expect(await a.hasSuspendedRun(runId)).toBe(true);
        expect(await b.hasSuspendedRun(runId)).toBe(true);
    });

    // ── SHAPE B: automated approve calls ────────────────────────────────────
    //
    // No human at all: an auto-approve rule (or an at-least-once delivery of
    // one decision) issues the SAME approve twice, microseconds apart, landing
    // on two replicas. Identical signals, so nothing downstream could tell the
    // duplicate from the original after the fact.

    it('SHAPE B (automated approve calls): a duplicated automated approve advances once', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const a = replica(store, led);
        const b = replica(store, led);

        const runId = await parkAtLv1(a);
        const automated = { approver: 'auto_rule_expense_under_1000' };

        const [first, second] = await Promise.all([
            approve(a, runId, automated),
            approve(b, runId, automated),
        ]);

        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect([first, second].filter((r) => r.success)).toHaveLength(1);
        expect([first, second].filter((r) => r.code === 'RESUME_IN_PROGRESS')).toHaveLength(1);
    });

    // ── The exposure, sized ─────────────────────────────────────────────────
    //
    // How OFTEN, not just whether. Every trial is one run raced by two
    // replicas; `doubled` counts the trials whose action fired more than once.
    // The failure message carries the measurement, so the number is recorded
    // by the run itself rather than by a comment.

    it('SIZED: 25 raced runs produce 25 single advances and zero doubled effects', async () => {
        const TRIALS = 25;
        let doubled = 0;
        let extraOpens = 0;
        for (let i = 0; i < TRIALS; i++) {
            const store = new InMemorySuspendedRunStore();
            const led = ledgers();
            const a = replica(store, led);
            const b = replica(store, led);
            const runId = await parkAtLv1(a);
            await Promise.all([approve(a, runId), approve(b, runId)]);
            if (led.fired.length > 1) doubled++;
            extraOpens += led.opened.filter((id) => id === 'lv2').length - 1;
        }
        expect({ trials: TRIALS, doubled, extraOpens }).toEqual({ trials: TRIALS, doubled: 0, extraOpens: 0 });
    });

    // ── NEGATIVE CONTROL: the shape the card called not obviously reachable ──
    //
    // A single approver per level, deciding one at a time: the second decision
    // is only issued after the first has returned. There is no window in which
    // two resumes overlap, so this cannot race however the replicas are
    // scheduled — and the second call finds the pause already consumed.

    it('NEGATIVE CONTROL: a single approver per level, sequential, cannot race', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const a = replica(store, led);
        const b = replica(store, led);

        const runId = await parkAtLv1(a);

        // Decision 1, fully returned before decision 2 is issued.
        const first = await approve(a, runId);
        expect(first.success).toBe(true);
        expect(first.status).toBe('paused');
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);

        // Decision 2 for `lv2`, on the other replica — advances, once.
        const second = await approve(b, runId);
        expect(second.success).toBe(true);
        expect(second.status).toBeUndefined();
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);
    });

    // ── NEGATIVE CONTROL: the single-replica path is untouched ──────────────

    it('NEGATIVE CONTROL: one replica, two concurrent approves — the in-process guard still refuses one', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const only = replica(store, led);

        const runId = await parkAtLv1(only);
        const [first, second] = await Promise.all([approve(only, runId), approve(only, runId)]);

        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect([first, second].filter((r) => r.success)).toHaveLength(1);
        const refused = [first, second].find((r) => !r.success)!;
        // `this.resuming` — the cheap first gate, kept, not replaced.
        expect(refused.code).toBe('RESUME_IN_PROGRESS');
        expect(refused.error).toContain('already being resumed');
    });

    it('NEGATIVE CONTROL: one replica, sequential approves walk the flow to completion', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const only = replica(store, led);

        const runId = await parkAtLv1(only);
        expect((await approve(only, runId)).status).toBe('paused');
        const final = await approve(only, runId);

        expect(final.success).toBe(true);
        expect(final.status).toBeUndefined();
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect(led.fired).toEqual(['notify']);
        expect(await only.hasSuspendedRun(runId)).toBe(false);
    });

    it('NEGATIVE CONTROL: with no store at all, behaviour is purely in-memory', async () => {
        // The historical default (LiteKernel, tests, dev): nothing is shared,
        // so there is no second replica to race and the in-process guard is
        // the whole guarantee. No degradation is declared here — there is no
        // cross-replica guarantee to weaken.
        const led = ledgers();
        const lines: string[] = [];
        const solo = replica(undefined, led, capturingLogger(lines));

        const runId = await parkAtLv1(solo);
        expect((await approve(solo, runId)).status).toBe('paused');
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect(led.fired).toEqual(['notify']);
        expect(lines.filter((l) => l.includes('advance guarantee'))).toEqual([]);
    });

    // ── THE CONDITION ITSELF: "still parked at node N", not "still present" ──
    //
    // Everything above races two claims that arrive while the row is still at
    // the node both replicas read, so the LOSER loses by finding no row at all.
    // That cannot tell a compare-and-set from an existence check — measured:
    // with both comparisons deleted from `InMemorySuspendedRunStore.
    // claimSuspension`, every test on the branch stayed green.
    //
    // The window the condition actually closes is the other one: a loser whose
    // claim lands AFTER the winner has already advanced and RE-PARKED. Now a
    // row exists again, at a different parking, and an existence-only consume
    // deletes the parking another replica is standing on and traverses forward
    // from a snapshot that is two beats stale. The two tests below hold the
    // loser's claim until exactly that moment — one per comparison, so a
    // mutation that deletes only one of them still reddens.

    /** A promise with its resolver, for holding a claim open. */
    function latch(): { held: Promise<void>; release: () => void } {
        let release!: () => void;
        const held = new Promise<void>((r) => { release = () => r(); });
        return { held, release };
    }

    /**
     * A replica's own view of the SHARED store — the real topology: two
     * processes, one database, each process holding its own client. Only the
     * TIMING of `claimSuspension` is this wrapper's business; the claim itself
     * is the shared store's, taken against the shared row.
     */
    function delayedClaimClient(
        shared: InMemorySuspendedRunStore,
        held: Promise<void>,
        seen: Array<{ nodeId: string; correlation?: string }>,
    ): SuspendedRunStore {
        return {
            save: (r: SuspendedRun) => shared.save(r),
            load: (id: string) => shared.load(id),
            delete: (id: string) => shared.delete(id),
            list: () => shared.list(),
            async claimSuspension(runId, parkedAt) {
                seen.push({ ...parkedAt });
                await held;
                return shared.claimSuspension(runId, parkedAt);
            },
        };
    }

    /** The same view with no delay — the winner's client. */
    function client(shared: InMemorySuspendedRunStore): SuspendedRunStore {
        return {
            save: (r: SuspendedRun) => shared.save(r),
            load: (id: string) => shared.load(id),
            delete: (id: string) => shared.delete(id),
            list: () => shared.list(),
            claimSuspension: (id, at) => shared.claimSuspension(id, at),
        };
    }

    it('THE CONDITION (node): a claim landing after the winner RE-PARKED is lost, not granted', async () => {
        const shared = new InMemorySuspendedRunStore();
        const led = ledgers();
        const gate = latch();
        const seen: Array<{ nodeId: string; correlation?: string }> = [];
        const a = replica(client(shared), led);
        const b = replica(delayedClaimClient(shared, gate.held, seen), led);

        const runId = await parkAtLv1(a);
        expect(led.opened).toEqual(['lv1']);

        // B's decision arrives first and reads the run at `lv1` — then its claim
        // stalls (a slow client, a queued statement, a paused container).
        const bDecision = approve(b, runId);

        // A's decision lands and completes: `notify` fires once and the run
        // RE-PARKS at `lv2`. A row for this run exists again.
        const aResult = await approve(a, runId);
        expect(aResult.success).toBe(true);
        expect(aResult.status).toBe('paused');
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);

        // The precondition this test rests on, asserted rather than assumed: B
        // is claiming the parking it READ, which is the one A has left.
        expect(seen).toEqual([{ nodeId: 'lv1', correlation: 'req_lv1' }]);

        // Now B's claim reaches the store.
        gate.release();
        const bResult = await bDecision;

        // It must LOSE. Existence-only, it wins: the `lv2` row is present, so
        // it is deleted and B traverses forward from its stale `lv1` snapshot.
        expect(bResult.success).toBe(false);
        expect(bResult.code).toBe('RESUME_IN_PROGRESS');
        expect(bResult.status).toBeUndefined();

        // The observable effects are unchanged by the loser: one `notify`, one
        // `lv2`. Existence-only reads `[ 'notify', 'notify' ]` here.
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);

        // ⛔ And the winner's parking SURVIVED. This is the half a doubled
        // effect alone would not catch: an existence-only consume destroys the
        // live `lv2` suspension, stranding the run for good.
        expect(await a.hasSuspendedRun(runId)).toBe(true);
        expect(await b.hasSuspendedRun(runId)).toBe(true);
        const stored = await shared.load(runId);
        expect(stored?.nodeId).toBe('lv2');
    });

    it('THE CONDITION (correlation): a re-entry at the SAME node with a new correlation is lost', async () => {
        // The one shape where a run legitimately re-parks at the node it just
        // left: `map` re-entry, whose correlation carries the child run id
        // (`map:<childRunId>`), so the node id alone cannot separate the
        // parking a replica read from the parking that replaced it. Only the
        // correlation comparison can.
        const shared = new InMemorySuspendedRunStore();
        const gate = latch();
        const seen: Array<{ nodeId: string; correlation?: string }> = [];
        // Each re-entry records the item it just finished, then parks for the
        // next one — so an item recorded twice is the doubled effect here.
        const done: string[] = [];
        const items = ['item_1', 'item_2', 'item_3'];

        function mapReplica(store: SuspendedRunStore): AutomationEngine {
            const engine = new AutomationEngine(silentLogger(), store);
            engine.registerNodeExecutor({
                type: 'map_items',
                descriptor: defineActionDescriptor({
                    type: 'map_items', version: '1.0.0', name: 'Map items',
                    supportsPause: true, resumeAuthority: 'service',
                }),
                async execute() {
                    const next = items[done.length];
                    if (next === undefined) return { success: true };
                    done.push(next);
                    return { success: true, suspend: true, correlation: `map:${next}` };
                },
            });
            engine.registerFlow('sweep', {
                name: 'sweep',
                label: 'Sweep',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'sweep_items', type: 'map_items', label: 'Sweep items' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'sweep_items' },
                    { id: 'e2', source: 'sweep_items', target: 'end' },
                ],
            } as any);
            return engine;
        }

        const a = mapReplica(client(shared));
        const b = mapReplica(delayedClaimClient(shared, gate.held, seen));

        const runId = (await a.execute('sweep')).runId!;
        expect(done).toEqual(['item_1']);

        // B reads the run parked at `sweep_items` / `map:item_1`, then stalls.
        const bDecision = approve(b, runId);

        // A completes the item: the node RE-RUNS and re-parks at the SAME node
        // with a NEW correlation.
        const aResult = await approve(a, runId);
        expect(aResult.status).toBe('paused');
        expect(done).toEqual(['item_1', 'item_2']);
        expect((await shared.load(runId))?.nodeId).toBe('sweep_items');
        expect((await shared.load(runId))?.correlation).toBe('map:item_2');
        expect(seen).toEqual([{ nodeId: 'sweep_items', correlation: 'map:item_1' }]);

        gate.release();
        const bResult = await bDecision;

        // Node id alone says "still parked at sweep_items" and would GRANT it.
        // The correlation is the whole difference.
        expect(bResult.success).toBe(false);
        expect(bResult.code).toBe('RESUME_IN_PROGRESS');
        // No item swept twice, and item_3 was not pulled forward.
        expect(done).toEqual(['item_1', 'item_2']);
        // The live parking survived.
        expect((await shared.load(runId))?.correlation).toBe('map:item_2');
    });

    it('the loser is traced at DEBUG — an ordinary outcome, not a degradation', async () => {
        // The caller is told in the result, so this line exists only for an
        // operator reconstructing a race. At `warn` a busy any-of level would
        // emit a steady stream of records describing correct behaviour.
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const lines: string[] = [];
        const a = replica(store, led, capturingLogger(lines));
        const b = replica(store, led, capturingLogger(lines));

        const runId = await parkAtLv1(a);
        await Promise.all([approve(a, runId), approve(b, runId)]);

        const claimLines = lines.filter((l) => l.includes('lost the advance claim'));
        expect(claimLines).toHaveLength(1);
        expect(claimLines[0]!.startsWith('debug ')).toBe(true);
        expect(claimLines[0]).toContain("at node 'lv1'");
        // ⛔ Not a degradation: nothing about the advance claim is raised to
        // `warn` or `error` on this path. (Scoped to the claim family on
        // purpose — a directly-constructed engine also emits the unrelated
        // #4792 "node-type vocabulary was never sealed" warn, and widening
        // this to "no warn at all" would pin that instead of this.)
        const raised = lines.filter(
            (l) => (l.startsWith('warn ') || l.startsWith('error ')) &&
                (l.includes('advance claim') || l.includes('advance guarantee')),
        );
        expect(raised).toEqual([]);
    });

    // ── The seam is LOUD when a store cannot express the guarantee ──────────

    it('a store without claimSuspension gets a ONE-TIME declared degradation, and still resumes', async () => {
        // Third-party stores predating this member cannot express the
        // conditional advance. They must not silently offer no guarantee: the
        // engine says so once per store, at `warn` (a weakened guarantee is a
        // FUNCTIONAL degradation — nothing claimed-persisted fails to land —
        // the same call `claim()`'s missing-ledger branch makes one screen up).
        const led = ledgers();
        const lines: string[] = [];
        const backing = new InMemorySuspendedRunStore();
        // A store predating `claimSuspension`: the four original members and
        // nothing else. Delegated to a real one so the run genuinely resumes —
        // the point is that it resumes UNGUARDED and is told so, not that it
        // breaks.
        const store: SuspendedRunStore = {
            save: (r: SuspendedRun) => backing.save(r),
            load: (id: string) => backing.load(id),
            delete: (id: string) => backing.delete(id),
            list: () => backing.list(),
        };
        const engine = replica(store, led, capturingLogger(lines));

        const runId = await parkAtLv1(engine);
        expect((await approve(engine, runId)).status).toBe('paused');
        expect((await approve(engine, runId)).status).toBeUndefined();

        const declared = lines.filter((l) => l.includes('advance guarantee'));
        expect(declared).toHaveLength(1);
        expect(declared[0]!.startsWith('warn ')).toBe(true);
        expect(declared[0]).toContain('claimSuspension');
    });
});
