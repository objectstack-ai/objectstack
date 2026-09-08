// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16709 item 1 — the restore verb DROPS a hot copy the durable row proves
 * stale, and this file is the only thing that observes it.
 *
 * ## The gap this closes, measured
 *
 * `resolveConsumedSuspensionWitnesses` (#15358) reports `staleHot` and
 * `restoreConsumedSuspension` acts on it in one line:
 *
 * ```ts
 * const { consumed, dropped, staleHot } = this.resolveConsumedSuspensionWitnesses(runId, terminal);
 * if (staleHot) this.consumedSuspensions.delete(runId);
 * ```
 *
 * The #15358 contract review ablated exactly that: make the shared helper
 * never report `staleHot`, so the restore verb never deletes the entry. The
 * eight restore-verb test files stayed green and so did the full suite — a
 * real behaviour could be deleted and nothing in either package noticed. The
 * behaviour is not new (the inline deletes the refactor replaced had the same
 * absent pins), but after the refactor it lives behind ONE helper flag, which
 * makes the gap cheaper to fall into.
 *
 * ## Why the drop matters — the harm, not the flag
 *
 * The hot journal is a PER-PROCESS cache. The replica that stranded a run
 * keeps its verbatim copy of the pause even after another replica restores,
 * resumes and FINISHES that run. Re-arming it then re-runs every node after
 * the pause: shape 2's silent double-run, through the restore verb's side
 * door. The durable row is what tells the stranding replica the run moved on,
 * and dropping the copy is how that knowledge outlives the row.
 *
 * ⭐ So the pin is written on the OUTLIVING, which is the only place the drop
 * is distinguishable from a no-op: with the terminal row still present, both
 * a dropped and a kept hot copy answer `NO_CONSUMED_SUSPENSION` (the row
 * supersedes the copy on every read). Once the row is gone — the run-history
 * retention cap evicts terminal rows per flow, `maxTerminalRunsPerFlow` /
 * `DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW`, #2585 — a KEPT copy becomes the only
 * witness again and answers `repairable: true, witness: 'journal'` for a run
 * that has already completed. That is the difference this file measures.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine, type RunRecord, type SuspendedRunStore } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

const pauser = defineActionDescriptor({
    type: 'pause_here', version: '1.0.0', name: 'pause_here',
    supportsPause: true, resumeAuthority: 'any',
});
const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });

/** start → pause (suspends) → after (the node that throws) → end. */
const STRAND_FLOW = {
    name: 'strand_flow', label: 'strand_flow', type: 'autolaunched',
    variables: [{ name: 'ticket', type: 'text', isInput: true, isOutput: true }],
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'pause', type: 'pause_here', label: 'Pause' },
        { id: 'after', type: 'after_pause', label: 'After' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'pause' },
        { id: 'e2', source: 'pause', target: 'after' },
        { id: 'e3', source: 'after', target: 'end' },
    ],
};

const ctx = { event: 'test', record: { id: 'rec_1' }, params: { ticket: 'TKT-9' } } as unknown as AutomationContext;

/** One replica: its own engine and journal, over a shared store. */
function replica(store: SuspendedRunStore) {
    const engine = new AutomationEngine(silent, store);
    const state = { throws: true };
    engine.registerNodeExecutor({
        type: 'pause_here', descriptor: pauser,
        async execute() {
            return { success: true, suspend: true, correlation: 'approval:req_1', output: { stage: 'awaiting' } };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'after_pause', descriptor: plain('after_pause'),
        async execute() {
            if (state.throws) throw new Error('downstream node blew up');
            return { success: true, output: { done: true } };
        },
    } as never);
    engine.registerFlow('strand_flow', STRAND_FLOW as never);
    return { engine, state };
}

/**
 * The shared store, with the one thing a real deployment does to a terminal
 * row that an in-test cap cannot do deterministically: FORGET it. The store's
 * own per-flow retention (`recordTerminal` prunes beyond
 * `maxTerminalRunsPerFlow`) is the mechanism; `forget` is that eviction,
 * addressed by run id so the fixture states which row went rather than racing
 * two `startedAt` stamps for it.
 */
function prunableStore() {
    const inner = new InMemorySuspendedRunStore();
    const forgotten = new Set<string>();
    const store: SuspendedRunStore & { forget(runId: string): void } = {
        save: (r) => inner.save(r),
        load: (id) => inner.load(id),
        delete: (id) => inner.delete(id),
        list: () => inner.list(),
        recordTerminal: (r) => inner.recordTerminal(r),
        async loadTerminal(id): Promise<RunRecord | null> {
            if (forgotten.has(id)) return null;
            return inner.loadTerminal(id);
        },
        forget(runId: string) { forgotten.add(runId); },
    };
    return store;
}

/**
 * Drive `a` into the stranded state, then let `b` — another replica over the
 * same store — restore it and run it to completion. Leaves: a hot journal
 * entry on `a`, and a durable terminal row saying `completed`.
 */
async function strandOnAFinishOnB(store: SuspendedRunStore) {
    const { engine: a } = replica(store);
    const { engine: b, state: bState } = replica(store);

    const started = await a.execute('strand_flow', ctx);
    expect(started.status).toBe('paused');
    const runId = started.runId as string;
    const stranded = await a.resume(runId);
    expect(stranded.status).toBe('stranded');
    // The fire-and-forget history write settles `persisted: 'pending'` →
    // `'landed'` off the resume's own promise chain; flush it, because the
    // "row supersedes a landed copy" arm is what this file drives.
    await new Promise(resolve => setTimeout(resolve, 0));

    // A really is the replica holding the copy — stated, not assumed.
    await expect(a.inspectConsumedSuspension(runId)).resolves.toMatchObject({
        repairable: true, witness: 'journal', nodeId: 'pause',
    });

    // B repairs and finishes it. A is told nothing.
    expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
    bState.throws = false;
    expect((await b.resume(runId)).success).toBe(true);

    return { a, b, runId };
}

describe('#16709 item 1 — a stale hot copy is DROPPED by the restore verb, and does not outlive the row', () => {
    it('⭐ after the row proving it stale is gone, the stranding replica answers NO_CONSUMED_SUSPENSION', async () => {
        const store = prunableStore();
        const { a, runId } = await strandOnAFinishOnB(store);

        // A's own restore attempt is what reads the row and drops the copy. It
        // refuses, naming the run's real end — and the refusal is NOT the pin:
        // it reads identically whether or not the copy was dropped.
        const refused = await a.restoreConsumedSuspension(runId);
        expect(refused.restored).toBe(false);
        expect((refused as { refusal?: string }).refusal).toBe('RUN_COMPLETED');

        // Retention evicts the terminal row. A's journal is now the only
        // witness left for this run — if it still holds the stale copy.
        store.forget(runId);
        expect(await store.loadTerminal!(runId)).toBeNull();

        // ⛔ THE PIN. A kept copy answers `repairable: true, witness: 'journal'`
        // here, offering an operator a restore of a run that COMPLETED.
        await expect(a.inspectConsumedSuspension(runId)).resolves.toEqual({
            repairable: false, runId, reason: 'NO_CONSUMED_SUSPENSION',
        });
    });

    it('⭐ …and the restore verb itself refuses rather than re-arming a finished run', async () => {
        // The same fact at the verb, where the cost is a silent double-run:
        // re-arming the pause would replay every node after it on a run whose
        // continuation already ran to `end` on another replica.
        const store = prunableStore();
        const { a, runId } = await strandOnAFinishOnB(store);
        expect((await a.restoreConsumedSuspension(runId)).restored).toBe(false);

        store.forget(runId);
        const second = await a.restoreConsumedSuspension(runId);
        expect(second.restored).toBe(false);
        expect((second as { refusal?: string }).refusal).toBe('NO_CONSUMED_SUSPENSION');
        // Nothing was re-armed: no second pause exists for a finished run.
        expect(await a.hasSuspendedRun(runId)).toBe(false);
    });

    it('CONTROL — the drop is the ROW\'s doing, not the read\'s: with no row, the copy survives', async () => {
        // Without this, the two pins above could be passing because
        // `inspectConsumedSuspension` or `restoreConsumedSuspension` consumes
        // the journal entry on any refusal. Same replica, same verbs, same run
        // — only the durable witness differs: a store that keeps NO history at
        // all never supersedes the hot copy, and the copy is still there
        // afterwards to be restored.
        const inner = new InMemorySuspendedRunStore();
        const historyless: SuspendedRunStore = {
            save: (r) => inner.save(r), load: (id) => inner.load(id),
            delete: (id) => inner.delete(id), list: () => inner.list(),
        };
        expect(historyless.loadTerminal).toBeUndefined();
        const { engine: a } = replica(historyless);

        const started = await a.execute('strand_flow', ctx);
        const runId = started.runId as string;
        expect((await a.resume(runId)).status).toBe('stranded');
        await new Promise(resolve => setTimeout(resolve, 0));

        await expect(a.inspectConsumedSuspension(runId)).resolves.toMatchObject({
            repairable: true, witness: 'journal',
        });
        expect((await a.restoreConsumedSuspension(runId)).restored).toBe(true);
    });
});
