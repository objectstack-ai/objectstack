// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13937 — the services half of the shape-4 ruling (maintainer 2026-09-01).
 *
 * The ruling keeps `resumeInternal`'s consumption order (the suspension is
 * consumed BEFORE the downstream nodes run, which is what buys exactly-once
 * across a crash), makes an explicit operator verb the way out of the state
 * that order leaves behind when a downstream node throws, and names that state
 * on the contract: `AutomationResult.status: 'stranded'` (#14384). The verb
 * already exists — `restoreConsumedSuspension`, #13909 slice 2, pinned in full
 * in `consumed-suspension-restore.test.ts` — so what this file pins is the
 * NAME, and the one property the ruling's whole point rests on: a re-armed run
 * must never become double-runnable.
 *
 *  1. **The stamp lands on exactly one exit** — the catch arm that journalled
 *     a consumed suspension — and `'stranded'` and "restorable" are one fact:
 *     a result that says stranded is a run the verb accepts, a `'failed'`
 *     result is one it refuses.
 *  2. **Controls**, so the stamp is a reading and not a constant: a run
 *     rejected at trigger time is `'failed'`; a resume refused BEFORE the
 *     consumption point carries no status and leaves the pause live; a resume
 *     that completes carries no status.
 *  3. ⭐ **A re-armed run resumes exactly once.** Two concurrent resumes of a
 *     restored run — in one process, and on two replicas over one store — run
 *     the downstream node once more, not twice, and the loser is told.
 *  4. ⭐ **A stale hot journal cannot re-arm a run that finished elsewhere.**
 *     The journal is a per-process cache; the durable terminal row is the
 *     record. The replica that stranded a run keeps a hot copy after another
 *     replica restored, resumed and finished it. Honouring that copy would
 *     re-arm a COMPLETED run, whose next resume re-runs everything after the
 *     pause — shape 2's silent double-run, through the repair verb's side
 *     door. The verb reads the durable row first, the same way
 *     `loadSuspendedRunStrict` reads the store first (#13617). Measured RED on
 *     the tree that read the hot copy first (both cases below), green after.
 *  5. **Round trip** — a restored run that strands again is stranded again and
 *     restorable again: one strand per resume, each an operator's own call.
 *  6. **The recorded `ExecutionStatus` stays `failed`** — the ruling widened
 *     the RESULT vocabulary; the run-row vocabulary is `@objectstack/spec`'s
 *     (`automation/execution.zod.ts`) and is untouched, in the log and in the
 *     durable history row.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import type { SuspendedRunStore } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

/**
 * `resumeAuthority: 'any'` because every continuation here goes through the
 * public `resume` door (the gate itself is `resume-authority-gate.test.ts`'s).
 */
const holdDescriptor = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'hold',
    supportsPause: true, resumeAuthority: 'any',
});
const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });

/** start → hold (pauses) → tail (the node that throws, or not) → end. */
const STRAND_FLOW = {
    name: 'strand_flow', label: 'Strand', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'hold', label: 'Hold' },
        { id: 'tail', type: 'tail', label: 'Tail' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'tail' },
        { id: 'e3', source: 'tail', target: 'end' },
    ],
};

/** No pause at all — the trigger-time control. */
const NO_PAUSE_FLOW = {
    name: 'no_pause_flow', label: 'No pause', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'boom', type: 'boom', label: 'Boom' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'boom' },
        { id: 'e2', source: 'boom', target: 'end' },
    ],
};

/** How many times the downstream node RAN — the observable a double-run moves. */
interface Ledger { tail: number }
/** Whether the downstream node throws on its next run. Shared across replicas. */
interface Knobs { throws: boolean }

/**
 * One engine over `store`, writing to the SHARED ledger and reading the SHARED
 * knobs, so two of them stand in for two app replicas over one database.
 */
function replica(store: SuspendedRunStore | undefined, led: Ledger, knobs: Knobs): AutomationEngine {
    const engine = new AutomationEngine(silent, store);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: holdDescriptor,
        async execute() {
            return { success: true, suspend: true, correlation: 'approval:req_1' };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'tail',
        descriptor: plain('tail'),
        async execute() {
            led.tail++;
            if (knobs.throws) throw new Error('tail blew up');
            return { success: true, output: { done: true } };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'boom',
        descriptor: plain('boom'),
        async execute() { throw new Error('never paused, just broke'); },
    } as never);
    engine.registerFlow('strand_flow', STRAND_FLOW as never);
    engine.registerFlow('no_pause_flow', NO_PAUSE_FLOW as never);
    return engine;
}

const ctx = { event: 'test', record: { id: 'rec_1' } } as unknown as AutomationContext;

function harness(store?: SuspendedRunStore) {
    const led: Ledger = { tail: 0 };
    const knobs: Knobs = { throws: true };
    return { led, knobs, engine: replica(store, led, knobs) };
}

/** Park a run, then resume it into the downstream throw. Returns id + the result. */
async function strand(engine: AutomationEngine, knobs: Knobs) {
    knobs.throws = true;
    const started = await engine.execute('strand_flow', ctx);
    expect(started.status).toBe('paused');
    const runId = started.runId as string;
    const failed = await engine.resume(runId);
    expect(failed.success).toBe(false);
    return { runId, failed };
}

describe('#13937 — the resume that consumed the pause and failed downstream says so: status stranded', () => {
    it('stamps stranded on that exit, and that run is exactly the one the operator verb accepts', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, knobs, led } = harness(store);
        const { runId, failed } = await strand(engine, knobs);

        // The verdict, by name — not inferred from `success` plus a missing
        // suspension, which is what every consumer had to do before.
        expect(failed.status).toBe('stranded');
        expect(failed.error).toContain('tail blew up');
        // …and it is TERMINAL exactly like `failed`: the pause is gone and
        // `resume` cannot continue it.
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
        expect((await engine.resume(runId)).code).toBe('RUN_NOT_FOUND');
        expect(led.tail).toBe(1);

        // One fact stated twice: "the result said stranded" ⇔ "a snapshot was
        // journalled for the verb to put back".
        const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
        expect(restored.restored).toBe(true);
        expect(restored.refusal).toBeUndefined();
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
    });

    it('CONTROL — a run rejected at trigger time is failed, never stranded, and the verb refuses it', async () => {
        const { engine } = harness(new InMemorySuspendedRunStore());

        const rejected = await engine.execute('no_pause_flow', ctx);
        expect(rejected.success).toBe(false);
        // The producer's existing verdict for "ran and was rejected" (#9378).
        expect(rejected.status).toBe('failed');

        const runId = (await engine.listRuns('no_pause_flow'))[0]?.id as string;
        expect(runId).toBeTruthy();
        const res = await engine.restoreConsumedSuspension(runId);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('NO_CONSUMED_SUSPENSION');
    });

    it('CONTROL — a resume refused BEFORE the consumption point carries no status and leaves the pause live', async () => {
        const { engine, knobs, led } = harness(new InMemorySuspendedRunStore());
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;

        // Raised while folding the signal — above the consumption point.
        const refused = await engine.resume(runId, { variables: { $internal: 1 } } as never);
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('INVALID_SIGNAL');
        expect(refused.status).toBeUndefined();
        expect(led.tail).toBe(0);
        // Nothing to repair: the pause survived, and the verb says exactly that.
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
        expect((await engine.restoreConsumedSuspension(runId)).refusal).toBe('RUN_SUSPENDED');

        // And the SAME run, resumed cleanly, carries no status on completion.
        knobs.throws = false;
        const done = await engine.resume(runId);
        expect(done.success).toBe(true);
        expect(done.status).toBeUndefined();
        expect(led.tail).toBe(1);
    });

    it('the recorded ExecutionStatus stays failed — in the log and in the durable history row', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, knobs } = harness(store);
        const { runId, failed } = await strand(engine, knobs);
        expect(failed.status).toBe('stranded');

        // The ruling named the condition on the RESULT; `ExecutionStatus` (the
        // run-row vocabulary, `@objectstack/spec`) carries no such member, and
        // this seat does not mint one. The durable discriminator for the
        // condition is the snapshot the terminal row carries.
        expect((await engine.getRun(runId))?.status).toBe('failed');
        const row = await store.loadTerminal(runId);
        expect(row?.status).toBe('failed');
        expect(row?.consumedSuspension).toBeDefined();
        expect((await engine.listRuns('strand_flow', { status: 'failed' })).map(r => r.id)).toContain(runId);
    });
});

describe('#13937 — a re-armed run is not double-runnable', () => {
    it('⭐ two concurrent resumes of a restored run, one process: the tail runs once more and the loser is told', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, knobs, led } = harness(store);
        const { runId } = await strand(engine, knobs);
        expect(led.tail).toBe(1);

        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throws = false;

        const [x, y] = await Promise.all([engine.resume(runId), engine.resume(runId)]);
        const winners = [x, y].filter(r => r.success);
        const losers = [x, y].filter(r => !r.success);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(losers[0]!.code).toBe('RESUME_IN_PROGRESS');
        expect(losers[0]!.status).toBeUndefined();

        // THE OBSERVABLE: one strand, one continuation. Not three.
        expect(led.tail).toBe(2);
        expect((await engine.getRun(runId))?.status).toBe('completed');

        // And the run is finished for good — neither verb re-opens it.
        expect((await engine.restoreConsumedSuspension(runId)).refusal).toBe('RUN_COMPLETED');
        expect((await engine.resume(runId)).code).toBe('RUN_NOT_FOUND');
        expect(led.tail).toBe(2);
    });

    it('⭐ two concurrent resumes of a restored run, two replicas over one store: the tail runs once more', async () => {
        const store = new InMemorySuspendedRunStore();
        const led: Ledger = { tail: 0 };
        const knobs: Knobs = { throws: true };
        const a = replica(store, led, knobs);
        const b = replica(store, led, knobs);

        const { runId } = await strand(a, knobs);
        expect(led.tail).toBe(1);

        // Restored on the OTHER replica, from the durable row alone.
        expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throws = false;

        // Each replica's own `resuming` set is empty; only the store's
        // conditional consume (#14333) separates them.
        const [byA, byB] = await Promise.all([a.resume(runId), b.resume(runId)]);
        expect([byA, byB].filter(r => r.success)).toHaveLength(1);
        expect([byA, byB].filter(r => r.code === 'RESUME_IN_PROGRESS')).toHaveLength(1);

        expect(led.tail).toBe(2);
        expect(await store.list()).toHaveLength(0);
        const row = await store.loadTerminal(runId);
        expect(row?.status).toBe('completed');
        expect(row?.consumedSuspension).toBeUndefined();
    });

    it('⭐ a stale hot journal on the replica that stranded the run cannot re-arm it after another replica restored and finished it', async () => {
        const store = new InMemorySuspendedRunStore();
        const led: Ledger = { tail: 0 };
        const knobs: Knobs = { throws: true };
        const a = replica(store, led, knobs);
        const b = replica(store, led, knobs);

        // A strands the run: A's hot journal now holds the snapshot, and so
        // does the durable terminal row.
        const { runId } = await strand(a, knobs);
        expect(led.tail).toBe(1);

        // B — a support engineer's replica, hours later — restores and
        // finishes it. The durable row now says `completed`, snapshot cleared.
        expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throws = false;
        expect((await b.resume(runId)).success).toBe(true);
        expect(led.tail).toBe(2);
        expect((await store.loadTerminal(runId))?.consumedSuspension).toBeUndefined();

        // The SAME restore request lands on A (an at-least-once delivery, a
        // second operator, a retry). A still holds its hot copy. Honouring it
        // would re-arm a completed run.
        const stale = await a.restoreConsumedSuspension(runId, { requestedBy: 'ops-retry' });
        expect(stale.restored).toBe(false);
        expect(stale.refusal).toBe('RUN_COMPLETED');

        // Nothing was minted, on either replica's reading…
        expect(await store.list()).toHaveLength(0);
        expect(await a.hasSuspendedRun(runId)).toBe(false);
        expect(await b.hasSuspendedRun(runId)).toBe(false);
        // …so the tail cannot run a third time through any door.
        expect((await a.resume(runId)).code).toBe('RUN_NOT_FOUND');
        expect((await b.resume(runId)).code).toBe('RUN_NOT_FOUND');
        expect(led.tail).toBe(2);
    });

    it('⭐ the same stale copy is refused when the run was CANCELLED elsewhere after the restore', async () => {
        const store = new InMemorySuspendedRunStore();
        const led: Ledger = { tail: 0 };
        const knobs: Knobs = { throws: true };
        const a = replica(store, led, knobs);
        const b = replica(store, led, knobs);

        const { runId } = await strand(a, knobs);
        expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
        // Somebody decided, on purpose, that this run ends here.
        expect(await b.cancelRun(runId, 'submitter withdrew')).toBe(true);
        expect((await store.loadTerminal(runId))?.consumedSuspension).toBeUndefined();

        const stale = await a.restoreConsumedSuspension(runId);
        expect(stale.restored).toBe(false);
        // A's own log still says `failed` for this run and the durable row
        // records a cancelled run as `failed` too, so A cannot name the
        // cancellation — what it CAN say, honestly, is that no snapshot is
        // held any more. ⛔ Never `RUN_SUSPENDED`, and never `restored: true`.
        expect(stale.refusal).toBe('NO_CONSUMED_SUSPENSION');
        expect(await store.list()).toHaveLength(0);
        expect((await a.resume(runId)).code).toBe('RUN_NOT_FOUND');
        expect(led.tail).toBe(1);
    });

    it('a restored run that strands AGAIN is stranded again and restorable again — one strand per resume', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, knobs, led } = harness(store);
        const { runId } = await strand(engine, knobs);
        expect(led.tail).toBe(1);

        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);
        // The operator's retry hits the same broken dependency.
        const again = await engine.resume(runId);
        expect(again.success).toBe(false);
        expect(again.status).toBe('stranded');
        expect(led.tail).toBe(2);
        expect(await engine.hasSuspendedRun(runId)).toBe(false);

        // Nothing sweeps, nothing retries by itself — and the exit still works.
        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throws = false;
        const done = await engine.resume(runId);
        expect(done.success).toBe(true);
        expect(done.status).toBeUndefined();
        expect(led.tail).toBe(3);
        expect((await engine.getRun(runId))?.status).toBe('completed');
    });
});
