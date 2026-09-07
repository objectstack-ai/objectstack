// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15660 — **the suspension an operator restores must be the pause, not the
 * attempt that failed** — for NESTED values, which is where it was not.
 *
 * ## The state under test
 *
 * `resumeInternal` rebuilds the flow scope as
 * `new Map(Object.entries(run.variables))`: the KEYS are copied, every VALUE
 * OBJECT is shared with `run.variables`. `journalConsumedSuspension` then
 * shallow-copies `run` and journals it as the pause "VERBATIM". So a node that
 * keeps state in the scope and updates it **in place** writes straight through
 * into the snapshot the operator exit later hands back — and
 * `restoreConsumedSuspension` re-arms a pause carrying state that belongs to
 * the failed attempt.
 *
 * `map` is the concrete instance and, by a census re-derived here rather than
 * recalled (nothing else in the tree writes a `${node.id}.$…` object into the
 * scope), the only executor in-repo that does it. The seam under test is the
 * ENGINE's, not `map`'s, so the fixture is a minimal executor with the same
 * shape: coupling this pin to `map`'s internals would make it fail for reasons
 * that are not this card.
 *
 * ## ⚠️ The card was filed as a READING, and the reading's mechanism was wrong
 *
 * The card attributed the aliasing to "the in-memory suspended-run store keeps
 * the object by identity rather than serialising it". It does not — it JSON
 * round-trips on both save and load, and the last test here pins that. The
 * defect reproduces anyway, because the aliasing that carries the mutation is
 * minted on the RESUME (the scope rebuild above), not at the suspend. That is
 * also why "deep copy at snapshot time" cannot be the fix: with a store
 * configured the snapshot already IS a private deep copy, and it still
 * reproduced.
 *
 * ## Why the controls are in the file and not in a scratch buffer
 *
 * Each in-place arm is paired with a replace-and-set arm that must stay green.
 * Without them a harness that reported the pause's value for a trivial reason —
 * a fixture whose mutation never ran, an assertion on the wrong key — would read
 * exactly like a fixed engine. The pair is what makes either reading mean
 * something.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine, type SuspendedRun, type SuspendedRunStore } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

/** The shape `map` keeps: node-scoped progress state living in the flow scope. */
const STATE_KEY = 'worker.$mapState';

type ProgressState = { started: number; results: unknown[] };

const pauser = (type: string) => defineActionDescriptor({
    type, version: '1.0.0', name: type, supportsPause: true, resumeAuthority: 'any',
});
const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });

function flowDef(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        variables: [{ name: 'ticket', type: 'text', isInput: true, isOutput: true }],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'seed', type: 'seed_state', label: 'Seed' },
            { id: 'pause', type: 'pause_here', label: 'Pause' },
            { id: 'worker', type: 'worker', label: 'Worker' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'seed' },
            { id: 'e2', source: 'seed', target: 'pause' },
            { id: 'e3', source: 'pause', target: 'worker' },
            { id: 'e4', source: 'worker', target: 'end' },
        ],
    };
}

const ctx = { event: 'test', record: { id: 'rec_1' }, params: { ticket: 'TKT-9' } } as unknown as AutomationContext;

/**
 * `in-place` is the executor pattern under test. `replace` is its control: the
 * same fixture, the same mutation, the same throw — only the parked object is
 * left alone, so it must report the pause under a fixed engine AND under a
 * broken one.
 */
type Arm = 'in-place' | 'replace';

function build(mode: Arm, store?: SuspendedRunStore) {
    const engine = new AutomationEngine(silent as never, store);
    const entry = { first: true };
    const observed: ProgressState[] = [];

    engine.registerNodeExecutor({
        type: 'seed_state', descriptor: plain('seed_state'),
        async execute(_node: unknown, variables: Map<string, unknown>) {
            variables.set(STATE_KEY, { started: 1, results: ['at-suspend'] } satisfies ProgressState);
            return { success: true };
        },
    } as never);

    engine.registerNodeExecutor({
        type: 'pause_here', descriptor: pauser('pause_here'),
        async execute() {
            return { success: true, suspend: true, correlation: 'approval:req_1', output: { stage: 'awaiting' } };
        },
    } as never);

    engine.registerNodeExecutor({
        type: 'worker', descriptor: plain('worker'),
        async execute(_node: unknown, variables: Map<string, unknown>) {
            const state = variables.get(STATE_KEY) as ProgressState;
            if (entry.first) {
                entry.first = false;
                if (mode === 'in-place') {
                    state.started = 99;
                    state.results.push('post-resume');
                } else {
                    variables.set(STATE_KEY, { started: 99, results: [...state.results, 'post-resume'] });
                }
                // Strand the run: the pause is already consumed, so this throw
                // is what makes `restoreConsumedSuspension` the only way out.
                throw new Error('downstream node blew up');
            }
            observed.push(JSON.parse(JSON.stringify(state)) as ProgressState);
            return { success: true, output: { done: true } };
        },
    } as never);

    engine.registerFlow('aliasing_flow', flowDef('aliasing_flow') as never);
    return { engine, observed };
}

/**
 * Drive one arm all the way: pause → resume that mutates and throws → restore →
 * resume again. Reports the pause's progress state as three independent
 * readings, because a fix that satisfies only one of them is not a fix.
 */
async function drive(mode: Arm, store?: InMemorySuspendedRunStore) {
    const { engine, observed } = build(mode, store);

    const started = await engine.execute('aliasing_flow', ctx);
    expect(started.status).toBe('paused');
    const runId = started.runId as string;

    // What the pause actually parked — read before any resume can touch it.
    const parked = store ? await store.load(runId) : null;

    const failed = await engine.resume(runId);
    expect(failed.success).toBe(false);
    expect(await engine.hasSuspendedRun(runId)).toBe(false);

    const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops@example.com' });
    expect(restored.restored).toBe(true);

    // Reading 1 — the durable row the restore re-parked.
    const back = store ? await store.load(runId) : null;
    // Reading 2 — end to end: what the node is handed on the resume after the repair.
    const finished = await engine.resume(runId);
    expect(finished.success).toBe(true);

    return {
        parked: (parked?.variables?.[STATE_KEY] as ProgressState | undefined),
        restored: (back?.variables?.[STATE_KEY] as ProgressState | undefined),
        observedAfterRepair: observed[0],
    };
}

describe('#15660 — the restored suspension carries the pause, not the failed attempt', () => {
    it('an executor that mutates its scope state IN PLACE does not rewrite the parked snapshot', async () => {
        const store = new InMemorySuspendedRunStore();
        const r = await drive('in-place', store);

        // The pause itself was always recorded correctly — the divergence is
        // introduced later, which is why reading only the parked row missed it.
        expect(r.parked).toEqual({ started: 1, results: ['at-suspend'] });

        // ⭐ The card's question, measured: what does the operator get back?
        expect(r.restored).toEqual({ started: 1, results: ['at-suspend'] });
        expect(r.observedAfterRepair).toEqual({ started: 1, results: ['at-suspend'] });
    });

    it('CONTROL — the same fixture that never touches the parked object reports the pause', async () => {
        const store = new InMemorySuspendedRunStore();
        const r = await drive('replace', store);

        expect(r.parked).toEqual({ started: 1, results: ['at-suspend'] });
        expect(r.restored).toEqual({ started: 1, results: ['at-suspend'] });
        expect(r.observedAfterRepair).toEqual({ started: 1, results: ['at-suspend'] });
    });

    it('holds with NO durable store, where the engine map answers by identity', async () => {
        const r = await drive('in-place');
        expect(r.observedAfterRepair).toEqual({ started: 1, results: ['at-suspend'] });
    });

    it('CONTROL — no durable store, replace-and-set', async () => {
        const r = await drive('replace');
        expect(r.observedAfterRepair).toEqual({ started: 1, results: ['at-suspend'] });
    });

    /**
     * The card's stated mechanism, pinned as FALSE so the next reader does not
     * re-derive the fix from it. If this ever goes red the store started keeping
     * identity, and "deep copy at snapshot time" stops being refuted — the
     * reasoning in `cloneVariablesAtPause`'s call site would need re-deriving.
     */
    it('the in-memory store does NOT keep object identity — it JSON round-trips', async () => {
        const store = new InMemorySuspendedRunStore();
        const nested: ProgressState = { started: 1, results: ['x'] };
        await store.save({
            runId: 'r1', flowName: 'f', flowVersion: '1', nodeId: 'n', nodeType: 't',
            variables: { [STATE_KEY]: nested }, steps: [], context: {} as never,
            startedAt: new Date().toISOString(), startTime: Date.now(),
        } as unknown as SuspendedRun);

        nested.started = 42; // mutate the caller's object AFTER the save

        const loaded = await store.load('r1');
        expect((loaded?.variables?.[STATE_KEY] as ProgressState).started).toBe(1);
    });
});
