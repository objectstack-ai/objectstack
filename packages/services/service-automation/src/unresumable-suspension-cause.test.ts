// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AutomationEngine.unresumableSuspensionCause` — the read-only probe a caller
 * asks BEFORE it writes anything of its own (#26477).
 *
 * A suspension outlives the flow it belongs to: `unregisterFlow` (the
 * `DELETE /automation/:name` door) and a parked-node edit both leave the
 * parked row, so `hasSuspendedRun` still answers `true`. Approvals used that
 * alone as its pre-flight, recorded the decision, and only the resume after it
 * found the run could never continue. The probe answers the resume's own
 * never-dispatched question without acting on it.
 *
 * What these pins hold:
 *  - the probe's cause is byte-for-byte the `error` the resume then answers
 *    `RUN_NOT_FOUND` with, for both causes — one classification, not two;
 *  - [#28405] a republish that edits the parked node away is no cause for a
 *    run that recorded the body it started on: it resumes on that body;
 *  - it is a read: the parked row is untouched until the resume settles it;
 *  - a live suspension and a missing one both answer `undefined` (the second
 *    is `hasSuspendedRun`'s answer to give);
 *  - a store that cannot be read rejects, as `hasSuspendedRun` does, rather
 *    than answering "can continue".
 */

import { describe, it, expect } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';

import { AutomationEngine } from './engine.js';
import type { SuspendedRun, SuspendedRunStore } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';

const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } } as never;

/** `resumeAuthority: 'any'` is required of a pausing fixture since #5561. */
const HOLD_DESCRIPTOR = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'Hold',
    supportsPause: true, resumeAuthority: 'any',
});

function holdFlow(name: string, { withHold }: { withHold: boolean } = { withHold: true }) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 's' },
            ...(withHold ? [{ id: 'hold', type: 'hold', label: 'h' }] : []),
            { id: 'end', type: 'end', label: 'e' },
        ],
        edges: withHold
            ? [
                { id: 'e1', source: 'start', target: 'hold' },
                { id: 'e2', source: 'hold', target: 'end' },
            ]
            : [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

function engineOver(store: SuspendedRunStore, { sealed }: { sealed: boolean } = { sealed: true }) {
    const engine = new AutomationEngine(silent, store);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: HOLD_DESCRIPTOR,
        async execute() { return { success: true, suspend: true, correlation: 'held' }; },
    } as never);
    if (sealed) engine.sealNodeTypeVocabulary();
    return engine;
}

async function park(engine: AutomationEngine, flowName: string): Promise<string> {
    engine.registerFlow(flowName, holdFlow(flowName) as never);
    const parked = await engine.execute(flowName, {} as never);
    expect(parked.status).toBe('paused');
    return parked.runId!;
}

class FlakyLoadStore extends InMemorySuspendedRunStore {
    loadThrows = false;
    override async load(runId: string): Promise<SuspendedRun | null> {
        if (this.loadThrows) throw new Error('store connection reset');
        return super.load(runId);
    }
}

describe('unresumableSuspensionCause: the resume\'s never-dispatched question, asked without acting (#26477)', () => {
    it('flow unregistered while parked: the cause is the resume\'s own RUN_NOT_FOUND text, and the row stays parked until that resume', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = engineOver(store);
        const runId = await park(engine, 'gone_flow');

        engine.unregisterFlow('gone_flow');
        expect(await engine.hasSuspendedRun(runId), 'the parked row outlives its flow').toBe(true);

        const cause = await engine.unresumableSuspensionCause(runId);
        expect(cause).toBe(`Flow 'gone_flow' not found for run '${runId}'`);
        expect((await store.load(runId))?.nodeId, 'the probe is a read').toBe('hold');

        const resumed = await engine.resume(runId);
        expect(resumed.code).toBe('RUN_NOT_FOUND');
        expect(resumed.error, 'one classification, not two').toBe(cause);
    });

    // [#28405] Re-judged: a run records the body it started on and resumes on
    // it, so editing its parked node away in a republish no longer ends it.
    // The node-gone cause stays the answer for a run with no recorded
    // identity — a row written before the field — pinned beside the rest of
    // the card in `flow-version-pinning.test.ts`.
    it('parked node edited away by a republish: the run is pinned to the body it started on, so there is no cause and it finishes', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = engineOver(store);
        const runId = await park(engine, 'edited_flow');

        engine.registerFlow('edited_flow', holdFlow('edited_flow', { withHold: false }) as never);

        expect(await engine.unresumableSuspensionCause(runId)).toBeUndefined();
        expect((await store.load(runId))?.nodeId).toBe('hold');

        const resumed = await engine.resume(runId);
        expect(resumed.success, JSON.stringify(resumed)).toBe(true);
        expect(resumed.code, 'no longer RUN_NOT_FOUND').toBeUndefined();
    });

    it('parked node edited away on a run that recorded no identity: the cause is the resume\'s own text too', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = engineOver(store);
        const runId = await park(engine, 'edited_flow');
        const row = (await store.load(runId))!;
        delete row.flowChecksum;
        await store.save(row);
        (engine as unknown as { suspendedRuns: Map<string, unknown> }).suspendedRuns.delete(runId);

        engine.registerFlow('edited_flow', holdFlow('edited_flow', { withHold: false }) as never);

        const cause = await engine.unresumableSuspensionCause(runId);
        expect(cause).toBe(`Suspended node 'hold' no longer exists in flow 'edited_flow'`);
        expect((await store.load(runId))?.nodeId).toBe('hold');

        const resumed = await engine.resume(runId);
        expect(resumed.code).toBe('RUN_NOT_FOUND');
        expect(resumed.error).toBe(cause);
    });

    it('a live suspension answers undefined, and the run still resumes', async () => {
        const engine = engineOver(new InMemorySuspendedRunStore());
        const runId = await park(engine, 'live_flow');

        expect(await engine.unresumableSuspensionCause(runId)).toBeUndefined();
        expect((await engine.resume(runId)).success).toBe(true);
    });

    it('no suspension at all answers undefined — that is hasSuspendedRun\'s answer to give', async () => {
        const engine = engineOver(new InMemorySuspendedRunStore());
        const runId = await park(engine, 'cancelled_flow');
        expect(await engine.cancelRun(runId)).toBe(true);

        expect(await engine.hasSuspendedRun(runId)).toBe(false);
        expect(await engine.unresumableSuspensionCause(runId)).toBeUndefined();
        expect(await engine.unresumableSuspensionCause('run_never_existed')).toBeUndefined();
    });

    it('before the host seals the boot it still answers, and records nothing a later registration would have to undo', async () => {
        const store = new InMemorySuspendedRunStore();
        const runId = await park(engineOver(store), 'late_flow');

        // A second lifetime mid-boot: the flow is not bound yet.
        const booting = engineOver(store, { sealed: false });
        expect(await booting.unresumableSuspensionCause(runId)).toBe(`Flow 'late_flow' not found for run '${runId}'`);
        expect((await store.load(runId))?.nodeId).toBe('hold');

        booting.registerFlow('late_flow', holdFlow('late_flow') as never);
        booting.sealNodeTypeVocabulary();
        expect(await booting.unresumableSuspensionCause(runId)).toBeUndefined();
        expect((await booting.resume(runId)).success).toBe(true);
    });

    it('a store that cannot be read rejects, never "can continue"', async () => {
        const store = new FlakyLoadStore();
        const runId = await park(engineOver(store), 'flaky_flow');

        // A fresh lifetime has no hot copy, so the read reaches the store.
        const engine = engineOver(store);
        engine.registerFlow('flaky_flow', holdFlow('flaky_flow') as never);
        store.loadThrows = true;
        await expect(engine.unresumableSuspensionCause(runId)).rejects.toThrow(/store connection reset/);
        await expect(engine.hasSuspendedRun(runId), 'the same posture as the existence check').rejects.toThrow();
    });
});
