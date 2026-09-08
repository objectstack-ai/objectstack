// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15358 — `inspectConsumedSuspension`: the READ-ONLY half of the operator
 * exit, published as a dedicated engine member (ruling B′, 2026-09-07).
 *
 * ## Why this member exists
 *
 * `AutomationEngine.getRun` answers an `ExecutionLogEntry`, which carries
 * neither `consumedSuspension` nor `consumedSuspensionDropped` — on purpose,
 * because `GET /automation/:name/runs/:runId` serves that object verbatim. So
 * a consumer reading `getRun` sees `status: 'failed'` for BOTH the #13909
 * strand (the resume consumed the pause and a downstream node threw —
 * `restoreConsumedSuspension` re-arms it) and a cascade-failed ancestor
 * (`failAncestors` → `failSuspendedRun`, which consumes the pause and journals
 * nothing — nothing re-arms it; #15222). plugin-approvals' stranded-request
 * inspection reported both as one label. The ruling: publish the answer as a
 * read-only engine member, not on the wire.
 *
 * ## What is pinned
 *
 *  1. **Same reading as the restore verb, re-arming nothing.** The member
 *     answers from the two witnesses `restoreConsumedSuspension` reads (this
 *     process's hot journal, the durable row), and a `repairable: true` from
 *     it leaves the run exactly as it found it: still not suspended, and the
 *     restore verb still able to restore. A read that consumed the copy it
 *     read would be a second side door into shape 2.
 *  2. **Every negative separately, each with its own reason** — and the
 *     middle one, `SNAPSHOT_DROPPED`, distinct from both neighbours. Folding
 *     it into "unrepairable" is #15555's false negative; folding it into
 *     "repairable" over-reports. ⛔ Not a single `loadTerminal` read: the drop
 *     notice is repairable from the hot copy on the very replica that
 *     stranded the run, and this file drives that replica AND a fresh one over
 *     the same row.
 *  3. **Agreement, pinned as one fact stated twice**: for every shape driven
 *     here, `inspect(...).repairable === restore(...).restored`. The member is
 *     a prediction of the verb; a prediction the verb contradicts is worse
 *     than none.
 *  4. **An unreadable store REJECTS** — never `NO_CONSUMED_SUSPENSION`. That
 *     answer is what a sweep would act on by giving up on a repairable run.
 *  5. **Nameable from the barrel**, method and result type both.
 */

import { describe, it, expect } from 'vitest';

import {
    AutomationEngine,
    type ConsumedSuspensionDropNotice,
    type RunRecord,
    type SuspendedRunStore,
} from './engine.js';
// Barrel imports on purpose — the #13951 witness, for this member: the type
// half breaks at `tsc --noEmit`, the runtime half right here in vitest.
import {
    AutomationEngine as BarrelAutomationEngine,
    type ConsumedSuspensionInspection,
} from './index.js';
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

/** A flow with no pause at all — the never-suspended shape. */
const NO_PAUSE_FLOW = {
    name: 'no_pause_flow', label: 'no_pause_flow', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'boom', type: 'always_throws', label: 'Boom' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'boom' },
        { id: 'e2', source: 'boom', target: 'end' },
    ],
};

const ctx = { event: 'test', record: { id: 'rec_1' }, params: { ticket: 'TKT-9' } } as unknown as AutomationContext;

function newEngine(store?: SuspendedRunStore) {
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
    engine.registerNodeExecutor({
        type: 'always_throws', descriptor: plain('always_throws'),
        async execute() { throw new Error('never paused, just failed'); },
    } as never);
    engine.registerFlow('strand_flow', STRAND_FLOW as never);
    engine.registerFlow('no_pause_flow', NO_PAUSE_FLOW as never);
    return { engine, state };
}

/** Drive a run into the stranded state. Returns its id. */
async function strandRun(engine: AutomationEngine): Promise<string> {
    const started = await engine.execute('strand_flow', ctx);
    expect(started.status).toBe('paused');
    const runId = started.runId as string;
    const failed = await engine.resume(runId);
    expect(failed.success).toBe(false);
    expect(failed.status).toBe('stranded');
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    return runId;
}

/**
 * A store that keeps every row but serves the terminal one the way the object
 * store does when a snapshot is over its byte budget: no `consumedSuspension`,
 * and a drop notice in its place (`stranded-run-object-store.test.ts` drives
 * the real store into this; here the shape is enough).
 */
function droppingStore(inner: InMemorySuspendedRunStore, notice: Omit<ConsumedSuspensionDropNotice, 'nodeId' | 'correlation'>): SuspendedRunStore {
    return {
        save: (r) => inner.save(r),
        load: (id) => inner.load(id),
        delete: (id) => inner.delete(id),
        list: () => inner.list(),
        recordTerminal: (r) => inner.recordTerminal(r),
        async loadTerminal(id) {
            const row = await inner.loadTerminal(id);
            if (!row?.consumedSuspension) return row;
            const { consumedSuspension, ...rest } = row;
            const dropped: RunRecord = {
                ...rest,
                consumedSuspensionDropped: {
                    ...notice,
                    nodeId: consumedSuspension.nodeId,
                    correlation: consumedSuspension.correlation,
                },
            };
            return dropped;
        },
    };
}

describe('#15358 — inspectConsumedSuspension: the read-only half of the exit', () => {
    it('answers `repairable: true` for a strand, from this process\'s journal, and RE-ARMS NOTHING', async () => {
        const { engine } = newEngine(undefined);
        const runId = await strandRun(engine);

        const verdict = await engine.inspectConsumedSuspension(runId);
        expect(verdict).toMatchObject({
            repairable: true, runId, flowName: 'strand_flow', nodeId: 'pause',
            correlation: 'approval:req_1', witness: 'journal',
        });
        expect(typeof (verdict as { consumedAt?: string }).consumedAt).toBe('string');

        // Read-only, in both directions that matter: the run is no more
        // resumable than before, and the copy the answer came from was not
        // consumed by answering — the restore verb still finds it.
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
        expect((await engine.resume(runId)).code).toBe('RUN_NOT_FOUND');
        const restored = await engine.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(true);
        expect(restored.nodeId).toBe('pause');
    });

    it('answers `RUN_SUSPENDED` once the pause is back — the run is already resumable', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const runId = await strandRun(engine);
        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);

        const verdict = await engine.inspectConsumedSuspension(runId);
        expect(verdict).toEqual({ repairable: false, runId, reason: 'RUN_SUSPENDED', nodeId: 'pause' });
    });

    it('answers `NO_CONSUMED_SUSPENSION` for a run that never paused — the "neither witness" shape', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const started = await engine.execute('no_pause_flow', ctx);
        expect(started.success).toBe(false);
        expect(started.status).toBe('failed');
        // A failed `execute` does not carry its run id on the result; the run
        // log does (same derivation as the restore verb's own never-suspended pin).
        const runId = (started.runId ?? (await engine.listRuns('no_pause_flow'))[0]?.id) as string;
        expect(runId).toBeTruthy();

        const verdict = await engine.inspectConsumedSuspension(runId);
        expect(verdict).toEqual({ repairable: false, runId, reason: 'NO_CONSUMED_SUSPENSION' });
        // …and the restore verb agrees, for the same reason.
        const res = await engine.restoreConsumedSuspension(runId);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('NO_CONSUMED_SUSPENSION');
    });

    it('answers from the DURABLE row after a restart, where no journal exists', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine: a } = newEngine(store);
        const runId = await strandRun(a);

        const { engine: b } = newEngine(store);
        const verdict = await b.inspectConsumedSuspension(runId);
        expect(verdict).toMatchObject({ repairable: true, runId, nodeId: 'pause', witness: 'durable' });
        // Still read-only across the restart: B has not re-armed it either.
        expect(await b.hasSuspendedRun(runId)).toBe(false);
        expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
    });

    it('a run that was restored and then FINISHED is no longer repairable — the snapshot cleared with it', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, state } = newEngine(store);
        const runId = await strandRun(engine);
        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);
        state.throws = false;
        expect((await engine.resume(runId)).success).toBe(true);

        const fresh = new AutomationEngine(silent, store);
        expect(await fresh.inspectConsumedSuspension(runId)).toEqual({
            repairable: false, runId, reason: 'NO_CONSUMED_SUSPENSION',
        });
    });
});

describe('#15358 — the dropped snapshot is its OWN answer, and which replica asks decides it', () => {
    const notice = { bytes: 300 * 1024, budget: 256 * 1024 };

    it('⭐ the replica that stranded the run still answers `repairable: true` from its hot copy', async () => {
        const inner = new InMemorySuspendedRunStore();
        const store = droppingStore(inner, notice);
        const { engine } = newEngine(store);
        const runId = await strandRun(engine);
        // The row really is snapshot-less and carries the notice.
        const row = await store.loadTerminal!(runId);
        expect(row?.consumedSuspension).toBeUndefined();
        expect(row?.consumedSuspensionDropped).toMatchObject({ ...notice, nodeId: 'pause' });

        const verdict = await engine.inspectConsumedSuspension(runId);
        expect(verdict).toMatchObject({ repairable: true, runId, nodeId: 'pause', witness: 'journal' });
        // ⛔ A naive single `loadTerminal` read would have answered
        // SNAPSHOT_DROPPED here — on the one replica able to restore it.
        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);
    });

    it('a fresh replica answers `SNAPSHOT_DROPPED` carrying the notice — neither "repairable" nor "never a strand"', async () => {
        const inner = new InMemorySuspendedRunStore();
        const store = droppingStore(inner, notice);
        const { engine: a } = newEngine(store);
        const runId = await strandRun(a);

        const { engine: b } = newEngine(store);
        const verdict = await b.inspectConsumedSuspension(runId);
        expect(verdict).toEqual({
            repairable: false, runId, reason: 'SNAPSHOT_DROPPED',
            dropped: { ...notice, nodeId: 'pause', correlation: 'approval:req_1' },
        });
        // The restore verb's refusal names the same budget: one fact, twice.
        const res = await b.restoreConsumedSuspension(runId);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('NO_CONSUMED_SUSPENSION');
        expect(res.reason).toContain(`${notice.budget}-byte row budget`);
    });
});

describe('#15358 — an unreadable store REJECTS; it never answers "nothing to restore"', () => {
    it('when the suspended-run store cannot be read', async () => {
        const inner = new InMemorySuspendedRunStore();
        const store: SuspendedRunStore = {
            save: (r) => inner.save(r),
            load: async () => { throw new Error('connection reset'); },
            delete: (id) => inner.delete(id),
            list: () => inner.list(),
            recordTerminal: (r) => inner.recordTerminal(r),
            loadTerminal: (id) => inner.loadTerminal(id),
        };
        const { engine } = newEngine(store);
        await expect(engine.inspectConsumedSuspension('run_whatever')).rejects.toThrow('connection reset');
    });

    it('when the run history cannot be read', async () => {
        const inner = new InMemorySuspendedRunStore();
        const store: SuspendedRunStore = {
            save: (r) => inner.save(r),
            load: (id) => inner.load(id),
            delete: (id) => inner.delete(id),
            list: () => inner.list(),
            recordTerminal: (r) => inner.recordTerminal(r),
            loadTerminal: async () => { throw new Error('history table unreachable'); },
        };
        const { engine } = newEngine(store);
        await expect(engine.inspectConsumedSuspension('run_elsewhere')).rejects.toThrow('history table unreachable');
        // Positive control: the same engine answers for a store that works.
        const { engine: healthy } = newEngine(new InMemorySuspendedRunStore());
        await expect(healthy.inspectConsumedSuspension('run_elsewhere')).resolves.toMatchObject({ repairable: false });
    });
});

describe('#15358 — nameable from the barrel', () => {
    it('publishes the member on the same class the barrel exports, and its result type', async () => {
        expect(BarrelAutomationEngine).toBe(AutomationEngine);
        expect(typeof BarrelAutomationEngine.prototype.inspectConsumedSuspension).toBe('function');
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        // The annotation is the point — the line a missing export makes unwritable.
        const verdict: ConsumedSuspensionInspection = await engine.inspectConsumedSuspension('no-such-run');
        expect(verdict.repairable).toBe(false);
        expect(remedyFor(verdict)).toBe('start a new run');
    });
});

/** A consumer switching exhaustively over the three negatives. */
function remedyFor(v: ConsumedSuspensionInspection): string {
    if (v.repairable) return 'restoreConsumedSuspension, then re-issue the continuation';
    switch (v.reason) {
        case 'RUN_SUSPENDED': return 'resume it';
        case 'SNAPSHOT_DROPPED': return 'restore from the replica that stranded it';
        case 'NO_CONSUMED_SUSPENSION': return 'start a new run';
    }
}
