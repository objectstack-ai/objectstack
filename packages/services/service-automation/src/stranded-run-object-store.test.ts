// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13937 — the operator exit on the PRODUCTION store class,
 * `ObjectStoreSuspendedRunStore`, over the repo's own fake ObjectQL engine.
 *
 * `stranded-run-status.test.ts` pins the ruling on `InMemorySuspendedRunStore`,
 * whose `recordTerminal` is synchronous, uncapped, and keeps the nested
 * snapshot verbatim. The object store differs in exactly the ways that decide
 * whether the verb re-arms the RIGHT pause: it flattens the snapshot into
 * `sys_automation_run` columns, drops it over a byte budget, and is written
 * fire-and-forget. A suite green on the in-memory store said nothing about
 * any of that — the contract review of the first cut measured the defect one
 * store class over, and this file is that measurement kept.
 *
 * What is pinned, and why each one is here:
 *
 *  1. ⭐ **The re-armed snapshot carries the PAUSE node — same replica.** The
 *     terminal row's `node_id` used to be the LAST STEP, i.e. the node that
 *     threw; read back as the snapshot's node, a restore re-armed the run at
 *     the failed node and the next resume SKIPPED it and reported the run
 *     completed. Measured red before the provenance fix.
 *  2. ⭐ **…and across a restart / on another replica**, where the durable
 *     row is the only copy. Same provenance, other reader.
 *  3. ⭐ **An over-budget snapshot does not destroy recoverability.** The
 *     store cannot persist a 300 KiB snapshot; it says so IN THE ROW, and the
 *     replica that holds the hot copy still restores. A replica without the
 *     hot copy is refused with a reason that names the budget. Nothing is
 *     deleted on that reading.
 *  4. ⭐ **A stale hot copy still cannot re-arm a run that finished
 *     elsewhere** — the cross-replica pin from the in-memory file, on the
 *     object store.
 *  5. ⭐ **Two witnesses, one truth.** When the hot copy and the durable row
 *     describe different pauses, the newest strand wins: a hot copy whose own
 *     terminal write never landed beats an older row (the #13617 exception —
 *     a row the store was never handed says nothing), and a landed hot copy
 *     yields to a later strand another replica recorded.
 *  6. **The verdict itself** (`status: 'stranded'`) on this store, and the
 *     row's discriminator column semantics.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

import { AutomationEngine } from './engine.js';
import type { SuspendedRunStore } from './engine.js';
import { ObjectStoreSuspendedRunStore } from './suspended-run-store.js';
import type { SuspendedRunStoreEngine } from './suspended-run-store.js';

function createTestLogger() {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() } as any;
}

/**
 * Minimal in-memory ObjectQL-like engine: rows keyed by id, with `where`
 * equality filtering — the same double `suspended-run-store.test.ts` drives
 * {@link ObjectStoreSuspendedRunStore} with, copied rather than shared so this
 * file registers no tests it does not own. `delete` and `update` route through
 * the real engine's dispatch predicates (`check:engine-double-contract`).
 */
function createFakeEngine(): SuspendedRunStoreEngine & { rows: Map<string, any> } {
    const rows = new Map<string, any>();
    const matches = (row: any, where: any) =>
        !where || Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return v && typeof v === 'object' && '$lt' in (v as any)
                ? row[k] < (v as any).$lt
                : row[k] === v;
        });
    return {
        rows,
        async find(_object, options) {
            const where = options?.where;
            const out = [...rows.values()].filter(r => matches(r, where));
            return typeof options?.limit === 'number' ? out.slice(0, options.limit) : out;
        },
        async insert(_object, data) {
            rows.set(String(data.id), { ...data });
            return data;
        },
        async update(_object, data, options) {
            // Refuses what a real server refuses (`check:engine-double-contract`).
            assertEngineUpdateDispatch(data, options as any);
            const id = options?.where?.id ?? data.id;
            const existing = rows.get(String(id)) ?? { id };
            rows.set(String(id), { ...existing, ...data });
            return rows.get(String(id));
        },
        async delete(_object, options) {
            const dispatch = assertEngineDeleteDispatch(options as any);
            if (dispatch.kind === 'multi') {
                const doomed = [...rows.values()].filter(r => matches(r, options?.where));
                for (const r of doomed) rows.delete(String(r.id));
                return doomed.length;
            }
            rows.delete(String(dispatch.id));
            return true;
        },
    };
}

const holdDescriptor = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'hold',
    supportsPause: true, resumeAuthority: 'any',
});
const tailDescriptor = defineActionDescriptor({ type: 'tail', version: '1.0.0', name: 'tail' });

/** start → hold (pauses) → tail (throws while `knobs.throwAt` names it) → end. */
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

/** Two pauses, so a run can strand at two DIFFERENT pauses in its life. */
const TWO_PAUSE_FLOW = {
    name: 'two_pause_flow', label: 'Two pauses', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'hold', label: 'Hold' },
        { id: 'tail', type: 'tail', label: 'Tail' },
        { id: 'hold2', type: 'hold', label: 'Hold 2' },
        { id: 'tail2', type: 'tail', label: 'Tail 2' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'tail' },
        { id: 'e3', source: 'tail', target: 'hold2' },
        { id: 'e4', source: 'hold2', target: 'tail2' },
        { id: 'e5', source: 'tail2', target: 'end' },
    ],
};

/** The node ids that RAN, in order — what a wrong re-arm or a double-run moves. */
interface Ledger { ran: string[] }
/** Which tail nodes throw on their next run. Shared across replicas. */
interface Knobs { throwAt: Set<string> }

/** One engine over `store`, writing to the SHARED ledger, reading the SHARED knobs. */
function replica(store: SuspendedRunStore | undefined, led: Ledger, knobs: Knobs, logger = createTestLogger()): AutomationEngine {
    const engine = new AutomationEngine(logger, store);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: holdDescriptor,
        async execute(node: { id: string }) {
            return { success: true, suspend: true, correlation: `approval:${node.id}` };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'tail',
        descriptor: tailDescriptor,
        async execute(node: { id: string }) {
            led.ran.push(node.id);
            if (knobs.throwAt.has(node.id)) throw new Error(`${node.id} blew up`);
            return { success: true };
        },
    } as never);
    engine.registerFlow('strand_flow', STRAND_FLOW as never);
    engine.registerFlow('two_pause_flow', TWO_PAUSE_FLOW as never);
    return engine;
}

const ctx = { event: 'test', record: { id: 'rec_1' } } as unknown as AutomationContext;

function objectStore(rows?: SuspendedRunStoreEngine & { rows: Map<string, any> }) {
    const engine = rows ?? createFakeEngine();
    return { engine, store: new ObjectStoreSuspendedRunStore(engine, createTestLogger()) };
}

function harness(store: SuspendedRunStore) {
    const led: Ledger = { ran: [] };
    const knobs: Knobs = { throwAt: new Set(['tail']) };
    return { led, knobs, engine: replica(store, led, knobs) };
}

/** Park a run at `hold`, then resume it into the `tail` throw. */
async function strand(engine: AutomationEngine, flow = 'strand_flow', context: AutomationContext = ctx) {
    const started = await engine.execute(flow, context);
    expect(started.status).toBe('paused');
    const runId = started.runId as string;
    const failed = await engine.resume(runId);
    expect(failed.success).toBe(false);
    expect(failed.status).toBe('stranded');
    return { runId, failed };
}

/**
 * The terminal write is fire-and-forget (`void store.recordTerminal(...)`), so
 * a cross-replica reader has to wait for the row the way a real one would:
 * by observing it land.
 */
async function untilTerminalRow(store: SuspendedRunStore, runId: string) {
    for (let i = 0; i < 200; i++) {
        const row = await store.loadTerminal!(runId);
        if (row) return row;
        await new Promise(r => setTimeout(r, 1));
    }
    throw new Error(`terminal row for ${runId} never landed`);
}

/** A store whose history write can be made to fail, everything else delegated. */
function withFailingHistory(inner: ObjectStoreSuspendedRunStore, state: { fail: boolean }): SuspendedRunStore {
    return {
        save: (r) => inner.save(r),
        load: (id) => inner.load(id),
        delete: (id) => inner.delete(id),
        list: () => inner.list(),
        claimSuspension: (id, at) => inner.claimSuspension(id, at),
        recordTerminal: async (r) => {
            if (state.fail) throw new Error('history table unreachable');
            return inner.recordTerminal(r);
        },
        listHistory: (f, n) => inner.listHistory(f, n),
        loadTerminal: (id) => inner.loadTerminal(id),
    };
}

describe('#13937 — the re-armed snapshot carries the PAUSE node (ObjectStoreSuspendedRunStore)', () => {
    it('⭐ same replica: strand → restore → resume re-runs the node that threw, at the pause it left', async () => {
        const { store } = objectStore();
        const { engine, knobs, led } = harness(store);
        const { runId } = await strand(engine);
        expect(led.ran).toEqual(['tail']);
        await untilTerminalRow(store, runId);

        const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
        expect(restored.restored).toBe(true);
        // The re-armed pause is the PAUSE node — never the node that threw.
        expect(restored.nodeId).toBe('hold');
        expect((await store.load(runId))?.nodeId).toBe('hold');
        expect((await store.load(runId))?.correlation).toBe('approval:hold');

        knobs.throwAt.clear();
        const done = await engine.resume(runId);
        expect(done.success).toBe(true);
        // THE OBSERVABLE: the failed node RAN AGAIN. A re-arm at `tail` would
        // have skipped it and still reported the run completed.
        expect(led.ran).toEqual(['tail', 'tail']);
        expect((await engine.getRun(runId))?.status).toBe('completed');
    });

    it('⭐ the durable row records the pause node on a stranded run, so a restore from the row alone re-arms the pause', async () => {
        const { engine: fake, store } = objectStore();
        const led: Ledger = { ran: [] };
        const knobs: Knobs = { throwAt: new Set(['tail']) };
        const a = replica(store, led, knobs);
        const { runId } = await strand(a);
        const row = await untilTerminalRow(store, runId);

        // The row itself: its snapshot names the pause, its step log still
        // ends with the node that threw (the Runs surface reads that half).
        expect(row.status).toBe('failed');
        expect(row.consumedSuspension?.nodeId).toBe('hold');
        expect(row.consumedSuspension?.correlation).toBe('approval:hold');
        expect(row.steps?.[row.steps.length - 1]?.nodeId).toBe('tail');
        expect(fake.rows.get(`run_${runId}`)?.node_id).toBe('hold');

        // A fresh replica — no hot copy at all — restores from the row.
        const b = replica(store, led, knobs);
        const restored = await b.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(true);
        expect(restored.nodeId).toBe('hold');
        knobs.throwAt.clear();
        expect((await b.resume(runId)).success).toBe(true);
        expect(led.ran).toEqual(['tail', 'tail']);
    });
});

describe('#13937 — an over-budget snapshot does not destroy recoverability', () => {
    // A context far over the 256 KiB row budget the store applies to the
    // snapshot's JSON columns.
    const hugeCtx = { ...ctx, payload: 'x'.repeat(300 * 1024) } as unknown as AutomationContext;

    it('⭐ the store says IN THE ROW that a snapshot existed and was not persisted, and the replica holding the hot copy still restores', async () => {
        const { engine: fake, store } = objectStore();
        const { engine, knobs, led } = harness(store);
        const { runId, failed } = await strand(engine, 'strand_flow', hugeCtx);
        expect(failed.status).toBe('stranded');
        const row = await untilTerminalRow(store, runId);

        // No snapshot — and NOT nothing: the row records the drop, with the
        // pause it belonged to, so no reader mistakes it for a run that moved
        // on or never paused.
        expect(row.consumedSuspension).toBeUndefined();
        expect(row.consumedSuspensionDropped).toBeDefined();
        expect(row.consumedSuspensionDropped?.bytes).toBeGreaterThan(row.consumedSuspensionDropped?.budget ?? Infinity);
        expect(row.consumedSuspensionDropped?.nodeId).toBe('hold');
        expect(row.consumedSuspensionDropped?.correlation).toBe('approval:hold');
        expect(fake.rows.get(`run_${runId}`)?.context_json).toBeNull();

        // The hot copy is the only copy — and it is honoured, not deleted.
        const restored = await engine.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(true);
        expect(restored.nodeId).toBe('hold');
        expect((await engine.restoreConsumedSuspension(runId)).refusal).toBe('RUN_SUSPENDED');
        knobs.throwAt.clear();
        expect((await engine.resume(runId)).success).toBe(true);
        expect(led.ran).toEqual(['tail', 'tail']);
    });

    it('a replica WITHOUT the hot copy is refused with a reason that names the budget, and deletes nothing', async () => {
        const { store } = objectStore();
        const led: Ledger = { ran: [] };
        const knobs: Knobs = { throwAt: new Set(['tail']) };
        const a = replica(store, led, knobs);
        const { runId } = await strand(a, 'strand_flow', hugeCtx);
        await untilTerminalRow(store, runId);

        const b = replica(store, led, knobs);
        const refused = await b.restoreConsumedSuspension(runId);
        expect(refused.restored).toBe(false);
        expect(refused.refusal).toBe('NO_CONSUMED_SUSPENSION');
        expect(refused.reason).toMatch(/budget/);
        expect(refused.reason).toMatch(/process that stranded it/);

        // …and A's hot copy is untouched by B's reading: A still restores.
        expect((await a.restoreConsumedSuspension(runId)).restored).toBe(true);
        expect(await b.hasSuspendedRun(runId)).toBe(true);
    });
});

describe('#13937 — a re-armed run is not double-runnable (ObjectStoreSuspendedRunStore)', () => {
    it('⭐ a stale hot copy cannot re-arm a run another replica restored and finished', async () => {
        const { store } = objectStore();
        const led: Ledger = { ran: [] };
        const knobs: Knobs = { throwAt: new Set(['tail']) };
        const a = replica(store, led, knobs);
        const b = replica(store, led, knobs);

        const { runId } = await strand(a);
        await untilTerminalRow(store, runId);

        expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throwAt.clear();
        expect((await b.resume(runId)).success).toBe(true);
        expect(led.ran).toEqual(['tail', 'tail']);
        // The completing upsert is fire-and-forget too: wait for THAT row.
        for (let i = 0; i < 200 && (await store.loadTerminal!(runId))?.status !== 'completed'; i++) {
            await new Promise(r => setTimeout(r, 1));
        }
        expect((await store.loadTerminal!(runId))?.status).toBe('completed');

        const stale = await a.restoreConsumedSuspension(runId, { requestedBy: 'ops-retry' });
        expect(stale.restored).toBe(false);
        expect(stale.refusal).toBe('RUN_COMPLETED');
        expect(await store.list()).toHaveLength(0);
        expect((await a.resume(runId)).code).toBe('RUN_NOT_FOUND');
        expect(led.ran).toEqual(['tail', 'tail']);
    });

    it('⭐ two witnesses, different pauses: a hot copy whose own write never landed beats the older row', async () => {
        const { store: inner } = objectStore();
        const history = { fail: false };
        const store = withFailingHistory(inner, history);
        const led: Ledger = { ran: [] };
        const knobs: Knobs = { throwAt: new Set(['tail']) };
        const a = replica(store, led, knobs);

        // Strand at `hold` (write lands), restore, run on to `hold2`.
        const { runId } = await strand(a, 'two_pause_flow');
        await untilTerminalRow(store, runId);
        expect((await a.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throwAt = new Set(['tail2']);
        const parkedAgain = await a.resume(runId);
        expect(parkedAgain.status).toBe('paused');
        expect((await store.load(runId))?.nodeId).toBe('hold2');

        // Strand at `hold2` with the history write FAILING: the row still
        // describes the `hold` strand; the hot copy is the newest witness.
        history.fail = true;
        const again = await a.resume(runId);
        expect(again.status).toBe('stranded');
        expect((await store.loadTerminal!(runId))?.consumedSuspension?.nodeId).toBe('hold');
        history.fail = false;

        const restored = await a.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(true);
        // Re-armed at the pause the run actually left — never back at `hold`,
        // which would run `tail` a THIRD time on the way to `hold2`. (The
        // second `tail` is the successful re-run after the first restore.)
        expect(restored.nodeId).toBe('hold2');
        knobs.throwAt.clear();
        expect((await a.resume(runId)).success).toBe(true);
        expect(led.ran).toEqual(['tail', 'tail', 'tail2', 'tail2']);
    });

    it('⭐ two witnesses, different pauses: a landed hot copy yields to the later strand another replica recorded', async () => {
        const { store } = objectStore();
        const led: Ledger = { ran: [] };
        const knobs: Knobs = { throwAt: new Set(['tail']) };
        const a = replica(store, led, knobs);
        const b = replica(store, led, knobs);

        // A strands at `hold` and keeps its hot copy of that pause.
        const { runId } = await strand(a, 'two_pause_flow');
        await untilTerminalRow(store, runId);

        // B restores, runs on to `hold2`, and strands THERE.
        expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throwAt = new Set(['tail2']);
        expect((await b.resume(runId)).status).toBe('paused');
        expect((await b.resume(runId)).status).toBe('stranded');
        expect(led.ran).toEqual(['tail', 'tail', 'tail2']);
        for (let i = 0; i < 200 && (await store.loadTerminal!(runId))?.consumedSuspension?.nodeId !== 'hold2'; i++) {
            await new Promise(r => setTimeout(r, 1));
        }
        expect((await store.loadTerminal!(runId))?.consumedSuspension?.nodeId).toBe('hold2');

        // A's copy is of a pause the run has LEFT. Re-arming it would send the
        // run back through `tail` a third time.
        const restored = await a.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(true);
        expect(restored.nodeId).toBe('hold2');
        knobs.throwAt.clear();
        expect((await a.resume(runId)).success).toBe(true);
        expect(led.ran).toEqual(['tail', 'tail', 'tail2', 'tail2']);
    });

    it('two concurrent resumes of a restored run on two replicas run the tail once more', async () => {
        const { store } = objectStore();
        const led: Ledger = { ran: [] };
        const knobs: Knobs = { throwAt: new Set(['tail']) };
        const a = replica(store, led, knobs);
        const b = replica(store, led, knobs);

        const { runId } = await strand(a);
        await untilTerminalRow(store, runId);
        expect((await b.restoreConsumedSuspension(runId)).restored).toBe(true);
        knobs.throwAt.clear();

        const [byA, byB] = await Promise.all([a.resume(runId), b.resume(runId)]);
        expect([byA, byB].filter(r => r.success)).toHaveLength(1);
        expect([byA, byB].filter(r => r.code === 'RESUME_IN_PROGRESS')).toHaveLength(1);
        expect(led.ran).toEqual(['tail', 'tail']);
        expect(await store.list()).toHaveLength(0);
    });
});
