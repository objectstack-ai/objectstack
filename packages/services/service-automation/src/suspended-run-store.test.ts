// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import { ObjectStoreSuspendedRunStore, type SuspendedRunStoreEngine } from './suspended-run-store.js';
import type { RunRecord, SuspendedRun } from './engine.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
// [#14333] The PRODUCER's own delete-dispatch decision, imported rather than
// re-approximated. `createFakeEngine` below routes its `delete` through it, so
// the double physically cannot accept a call `ObjectQL.delete` refuses — the
// property `scripts/check-engine-double-contract.mjs` exists to hold, and the
// thing that makes the compare-and-set spelling in
// `ObjectStoreSuspendedRunStore.claimSuspension` testable at all: drop
// `multi: true` from it and this fake THROWS, exactly as a running server does.
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';

/**
 * The `resumeAuthority: 'any'` declaration every pausing fixture below needs
 * since #5561: these tests continue their pause through the public `resume`
 * door, and a node type that declares nothing is refused there. None of them is
 * about the resume gate (that is `resume-authority-gate.test.ts`), so each
 * states the posture it relies on — as the four pausing built-ins do.
 */
const PAUSE_NODE_DESCRIPTOR = defineActionDescriptor({
    type: 'pause_node', version: '1.0.0', name: 'Pause Node',
    supportsPause: true, resumeAuthority: 'any',
});

function createTestLogger() {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() } as any;
}

/**
 * Minimal in-memory ObjectQL-like engine: rows keyed by id, with `where`
 * equality filtering. Stands in for the `sys_automation_run` table so we can
 * exercise {@link ObjectStoreSuspendedRunStore} (and a restart through it)
 * without a real driver.
 */
function createFakeEngine(
    // [#10101] Optional name → object-definition map. When given, the fake
    // grows the `getSchema` the shared platform-row organization resolver
    // probes for; when omitted (every pre-#10101 caller) the fake has no
    // schema access and the store keeps the acting-context fallback — the
    // documented degradation, exercised below rather than assumed.
    schemas?: Record<string, any>,
): SuspendedRunStoreEngine & { rows: Map<string, any> } {
    const rows = new Map<string, any>();
    // Equality plus the `$lt` operator (kept for where-clause generality).
    const matches = (row: any, where: any) =>
        !where || Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return v && typeof v === 'object' && '$lt' in (v as any)
                ? row[k] < (v as any).$lt
                : row[k] === v;
        });
    return {
        rows,
        ...(schemas ? { getSchema: (name: string) => schemas[name] } : {}),
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
            const id = options?.where?.id ?? data.id;
            const existing = rows.get(String(id)) ?? { id };
            rows.set(String(id), { ...existing, ...data });
            return rows.get(String(id));
        },
        async delete(_object, options) {
            // [#14333] Dispatch through the producer's predicate, never a
            // hand-written approximation of it: `by-id` when a truthy scalar
            // `where.id` is the WHOLE predicate, `multi` when `options.multi`
            // carries the rest of the `where` to the many-row route, and a
            // THROW otherwise — the shape `ObjectQL.delete` refuses. Before
            // this, a `where` of `{ id, node_id }` with no `multi` silently
            // took the by-id branch here and returned `true`, so a store that
            // had lost its condition read as an untestable `'unsupported'`.
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

const baseRun = (): SuspendedRun => ({
    runId: 'run_abc',
    flowName: 'approval_flow',
    flowVersion: 3,
    nodeId: 'approve_step',
    variables: { $runId: 'run_abc', pause: { snapshot: { nested: { value: 42 }, arr: [1, 2, 3] } } },
    steps: [{ nodeId: 'start', nodeType: 'start', status: 'success', startedAt: '2026-01-01T00:00:00.000Z' }],
    // [cloud#1395] `tenantId`, NOT `organizationId`. This fixture used to spell
    // it `organizationId` — a key `AutomationContext` does not declare and no
    // producer writes — and `serialize()` carried a matching consumer-side alias
    // limb, so this assertion passed against a path production never takes. The
    // fixture now speaks the declared contract, which is what makes
    // `organization_id: 'org_1'` below evidence about the real writer.
    context: { object: 'crm_deal', userId: 'u1', tenantId: 'org_1', record: { id: 'd1', amount: 100 } } as any,
    startedAt: '2026-01-01T00:00:00.000Z',
    startTime: 1735689600000,
    correlation: 'areq_1',
});

describe('ObjectStoreSuspendedRunStore', () => {
    it('round-trips a suspended run (nested variables, steps, context)', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        const run = baseRun();

        await store.save(run);
        // Persisted as a single row with JSON-encoded state columns.
        expect(engine.rows.size).toBe(1);
        const row = engine.rows.get('run_abc');
        expect(row).toMatchObject({
            id: 'run_abc', flow_name: 'approval_flow', flow_version: 3,
            node_id: 'approve_step', status: 'paused', correlation: 'areq_1',
            user_id: 'u1', organization_id: 'org_1',
        });
        expect(typeof row.variables_json).toBe('string');

        const loaded = await store.load('run_abc');
        expect(loaded).not.toBeNull();
        expect(loaded).toEqual(run);
    });

    it('upserts on re-save rather than duplicating', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.save(baseRun());
        await store.save({ ...baseRun(), nodeId: 'second_step' });
        expect(engine.rows.size).toBe(1);
        expect((await store.load('run_abc'))?.nodeId).toBe('second_step');
    });

    it('deletes and lists paused runs', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.save(baseRun());
        await store.save({ ...baseRun(), runId: 'run_def' });
        expect(await store.list()).toHaveLength(2);

        await store.delete('run_abc');
        expect(await store.load('run_abc')).toBeNull();
        const remaining = await store.list();
        expect(remaining.map(r => r.runId)).toEqual(['run_def']);
    });

    it('drives a suspend → restart → resume through the DB-backed store', async () => {
        const engine = createFakeEngine();
        const ran: string[] = [];

        function build() {
            const e = new AutomationEngine(createTestLogger(), new ObjectStoreSuspendedRunStore(engine, createTestLogger()));
            e.registerNodeExecutor({
                type: 'pause_node',
                descriptor: PAUSE_NODE_DESCRIPTOR,
                async execute() { return { success: true, suspend: true, correlation: 'areq_1' }; },
            });
            e.registerNodeExecutor({
                type: 'branch_node',
                async execute(node) { ran.push(node.id); return { success: true }; },
            });
            e.registerFlow('approval_flow', {
                name: 'approval_flow', label: 'Approval Flow', type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'pause', type: 'pause_node', label: 'Approval' },
                    { id: 'approved', type: 'branch_node', label: 'Approved' },
                    { id: 'rejected', type: 'branch_node', label: 'Rejected' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'pause' },
                    { id: 'e2', source: 'pause', target: 'approved', label: 'approve' },
                    { id: 'e3', source: 'pause', target: 'rejected', label: 'reject' },
                    { id: 'e4', source: 'approved', target: 'end' },
                    { id: 'e5', source: 'rejected', target: 'end' },
                ],
            });
            return e;
        }

        const paused = await build().execute('approval_flow');
        expect(paused.status).toBe('paused');
        expect(engine.rows.size).toBe(1); // durably stored

        // Fresh engine over the same backing table — the run survives.
        const resumed = await build().resume(paused.runId!, { branchLabel: 'reject' });
        expect(resumed.success).toBe(true);
        expect(ran).toContain('rejected');
        expect(ran).not.toContain('approved');
        // The live suspended row is removed on terminal completion; a durable
        // terminal run-history row is kept in its place (run observability).
        await new Promise((r) => setTimeout(r, 0)); // recordTerminal is fire-and-forget
        const finalRows = [...engine.rows.values()];
        expect(finalRows.filter((r) => r.status === 'paused')).toHaveLength(0);
        expect(finalRows).toHaveLength(1);
        expect(finalRows[0].status).toBe('completed');
    });
});

/** A flow that parks at `pause_node`, over an optional store. */
function pausableEngine(store?: any, logger = createTestLogger()) {
    const e = new AutomationEngine(logger, store);
    e.registerNodeExecutor({
        type: 'pause_node',
        descriptor: PAUSE_NODE_DESCRIPTOR,
        async execute() { return { success: true, suspend: true, correlation: 'areq_1' }; },
    });
    e.registerFlow('approval_flow', {
        name: 'approval_flow', label: 'Approval Flow', type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'pause', type: 'pause_node', label: 'Approval' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'pause' },
            { id: 'e2', source: 'pause', target: 'end' },
        ],
    } as never);
    return e;
}

/**
 * Resume failure classification (#4420).
 *
 * A caller that persists its own decision BEFORE resuming — approvals does,
 * necessarily — cannot act on a bare `success: false`. "This run is gone for
 * good" and "the store is down, try again" need opposite remedies, and a
 * duplicate resume is not a failure at all. All three used to read the same,
 * and the approvals bridge answered every one of them with HTTP 200.
 */
describe('resume failure codes', () => {
    it('reports RUN_NOT_FOUND for a run that does not exist', async () => {
        const result = await pausableEngine().resume('run_never_existed');
        expect(result.success).toBe(false);
        expect(result.code).toBe('RUN_NOT_FOUND');
    });

    it('reports STORE_UNAVAILABLE — not RUN_NOT_FOUND — when the store cannot be read', async () => {
        const table = createFakeEngine();
        const paused = await pausableEngine(new ObjectStoreSuspendedRunStore(table, createTestLogger()))
            .execute('approval_flow');

        // A second process: nothing cached, and the table is unreachable. The
        // run is perfectly alive — reading this as "gone" is what lets a caller
        // strand it permanently over a transient outage.
        const broken = createFakeEngine();
        broken.find = async () => { throw new Error('connection refused'); };
        const result = await pausableEngine(new ObjectStoreSuspendedRunStore(broken, createTestLogger()))
            .resume(paused.runId!);

        expect(result.success).toBe(false);
        expect(result.code).toBe('STORE_UNAVAILABLE');
        expect(result.error).toMatch(/retry once the store is available/);
        // The suspension is not consumed, so the legitimate resume still lands.
        expect(table.rows.get(paused.runId!)?.status).toBe('paused');
    });

    it('reports RESUME_IN_PROGRESS for a concurrent duplicate resume', async () => {
        const e = pausableEngine();
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => { release = r; });
        e.registerNodeExecutor({
            type: 'slow_node',
            async execute() { await gate; return { success: true }; },
        });
        e.registerFlow('slow_flow', {
            name: 'slow_flow', label: 'Slow Flow', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'pause', type: 'pause_node', label: 'Approval' },
                { id: 'slow', type: 'slow_node', label: 'Slow' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'pause' },
                { id: 'e2', source: 'pause', target: 'slow' },
                { id: 'e3', source: 'slow', target: 'end' },
            ],
        } as never);
        const paused = await e.execute('slow_flow');

        const first = e.resume(paused.runId!);
        const duplicate = await e.resume(paused.runId!);
        expect(duplicate.success).toBe(false);
        expect(duplicate.code).toBe('RESUME_IN_PROGRESS');

        release();
        expect((await first).success).toBe(true);
    });

    it('logs a failed durable write at ERROR — a pause kept only in memory is data loss in waiting', async () => {
        const lines: { level: string; msg: string; meta?: Record<string, unknown> }[] = [];
        const logger: any = {
            info: (m: any) => lines.push({ level: 'info', msg: String(m) }),
            warn: (m: any, meta?: any) => lines.push({ level: 'warn', msg: String(m), meta }),
            error: (m: any, _err?: any, meta?: any) => lines.push({ level: 'error', msg: String(m), meta }),
            debug: () => {},
            child() { return logger; },
        };
        const broken = createFakeEngine();
        broken.insert = async () => { throw new Error('no such table: sys_automation_run'); };
        const paused = await pausableEngine(new ObjectStoreSuspendedRunStore(broken, logger), logger)
            .execute('approval_flow');

        expect(paused.status).toBe('paused'); // the run still pauses…
        const rec = lines.find(l => l.level === 'error' && /NOT be resumable after a restart/.test(l.msg));
        expect(rec).toBeTruthy();
        // #6499 — the driver's own text rides the STRUCTURED slot, never the
        // message (whose line count must stay ours).
        expect(rec!.msg).not.toMatch(/no such table/);
        expect(String(rec!.meta?.error)).toMatch(/no such table: sys_automation_run/);
    });
});

/**
 * `hasSuspendedRun` — the read approvals pre-flights a decision with, so a
 * decision is never recorded against a run that can no longer advance.
 */
describe('hasSuspendedRun', () => {
    it('sees a run suspended in this process', async () => {
        const e = pausableEngine();
        const paused = await e.execute('approval_flow');
        expect(await e.hasSuspendedRun(paused.runId!)).toBe(true);
        expect(await e.hasSuspendedRun('run_other')).toBe(false);
    });

    it('sees a run suspended by a PREVIOUS process, off the durable store', async () => {
        const table = createFakeEngine();
        const paused = await pausableEngine(new ObjectStoreSuspendedRunStore(table, createTestLogger()))
            .execute('approval_flow');

        // No execution-log entry exists in this process, yet the run is alive
        // and resumable — and both reads now say so. `getRun` used to answer
        // `null` here, and this line asserted that as the CONTRAST between the
        // two methods; #8050 measured the same `null` as the defect (it is what
        // made run-detail 404 for a healthy parked run) and gave `getRun` the
        // durable paused fallback `hasSuspendedRun` always had. The assertion is
        // inverted rather than deleted, so the pair stays pinned together.
        const cold = pausableEngine(new ObjectStoreSuspendedRunStore(table, createTestLogger()));
        expect(await cold.hasSuspendedRun(paused.runId!)).toBe(true);
        expect((await cold.getRun(paused.runId!))?.status).toBe('paused');
    });

    it('throws rather than answering false when the store is unreadable', async () => {
        const broken = createFakeEngine();
        broken.find = async () => { throw new Error('connection refused'); };
        const e = pausableEngine(new ObjectStoreSuspendedRunStore(broken, createTestLogger()));

        // "Unknown" must not collapse into "gone" — a caller that treats an
        // outage as a dead run rejects every decision in the tenant.
        await expect(e.hasSuspendedRun('run_x')).rejects.toThrow(/connection refused/);

        // The distinction between the two reads that #8050 did NOT erase, and
        // the one that carries the safety property: this method backs a WRITE
        // decision, so an outage must read as "unknown"; `getRun` is an
        // observability read and still degrades to null with a warning. Now
        // that they agree on a healthy store, the place they must keep
        // disagreeing is worth its own assertion.
        await expect(e.getRun('run_x')).resolves.toBeNull();
    });

    it('answers false with no store and nothing in memory', async () => {
        expect(await pausableEngine().hasSuspendedRun('run_x')).toBe(false);
    });
});

const terminalRecord = (n: number, overrides: Partial<RunRecord> = {}): RunRecord => ({
    runId: `r${n}`,
    flowName: 'busy_flow',
    status: 'completed',
    startedAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`,
    durationMs: 5,
    steps: [{ nodeId: 'start', nodeType: 'start', status: 'success', startedAt: '2026-01-01T00:00:00.000Z' }],
    ...overrides,
});

describe('ObjectStoreSuspendedRunStore — run-history retention + durable detail (#2585)', () => {
    it('persists terminal steps and round-trips them through loadTerminal', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        const record = terminalRecord(1, {
            status: 'failed',
            error: 'kaboom',
            finishedAt: '2026-01-01T00:01:00.000Z',
            nodeId: 'boom',
            steps: [
                { nodeId: 'start', nodeType: 'start', status: 'success', startedAt: '2026-01-01T00:00:01.000Z' },
                { nodeId: 'boom', nodeType: 'script', status: 'failure', startedAt: '2026-01-01T00:00:02.000Z', error: { code: 'X', message: 'kaboom' } },
            ],
        });
        await store.recordTerminal(record);

        const row = engine.rows.get('run_r1');
        expect(typeof row.steps_json).toBe('string');
        expect(row.finished_at).toBe('2026-01-01T00:01:00.000Z');

        const loaded = await store.loadTerminal('r1');
        expect(loaded).not.toBeNull();
        expect(loaded!.status).toBe('failed');
        expect(loaded!.error).toBe('kaboom');
        expect(loaded!.finishedAt).toBe('2026-01-01T00:01:00.000Z');
        expect(loaded!.steps).toEqual(record.steps);
    });

    it('loadTerminal returns null for unknown ids and never matches a paused row', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.save(baseRun()); // paused row, id 'run_abc'
        expect(await store.loadTerminal('nope')).toBeNull();
        // A raw runId of 'abc' would look up history id 'run_abc' — the paused
        // row's id. It must NOT be served as terminal history.
        expect(await store.loadTerminal('abc')).toBeNull();
    });

    it('caps terminal history per flow at write time, leaving other flows and paused rows alone', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger(), { maxTerminalRunsPerFlow: 3 });
        await store.save(baseRun()); // a live pause must survive every prune
        for (let n = 1; n <= 5; n++) await store.recordTerminal(terminalRecord(n));
        await store.recordTerminal(terminalRecord(9, { runId: 'other1', flowName: 'other_flow' }));

        const busy = await store.listHistory('busy_flow', 10);
        expect(busy.map((r) => r.runId)).toEqual(['r5', 'r4', 'r3']); // newest 3 kept
        expect(await store.listHistory('other_flow', 10)).toHaveLength(1);
        expect(await store.load('run_abc')).not.toBeNull(); // pause untouched
    });

    it('a re-emitted terminal (upsert) does not trigger the overflow prune path', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger(), { maxTerminalRunsPerFlow: 3 });
        for (let n = 1; n <= 3; n++) await store.recordTerminal(terminalRecord(n));
        await store.recordTerminal(terminalRecord(2)); // update in place
        expect(await store.listHistory('busy_flow', 10)).toHaveLength(3);
    });

    it('bounds steps_json bytes by dropping the oldest steps first', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        const bigMessage = 'x'.repeat(30 * 1024);
        await store.recordTerminal(terminalRecord(1, {
            steps: [
                { nodeId: 'old1', nodeType: 'script', status: 'failure', startedAt: 't', error: { code: 'E', message: bigMessage } },
                { nodeId: 'old2', nodeType: 'script', status: 'failure', startedAt: 't', error: { code: 'E', message: bigMessage } },
                { nodeId: 'old3', nodeType: 'script', status: 'failure', startedAt: 't', error: { code: 'E', message: bigMessage } },
                { nodeId: 'last', nodeType: 'script', status: 'failure', startedAt: 't', error: { code: 'E', message: 'the real reason' } },
            ],
        }));
        const row = engine.rows.get('run_r1');
        expect(row.steps_json.length).toBeLessThanOrEqual(64 * 1024);
        const kept = (await store.loadTerminal('r1'))!.steps!;
        expect(kept.length).toBeLessThan(4);
        expect(kept[kept.length - 1].nodeId).toBe('last'); // the tail survives
    });
});

// ─── Trigger attribution columns (#7533) ─────────────────────────────────────
//
// The defect was information dropped ON THE WAY TO THE ROW, so these assertions
// read the persisted CELL (`engine.rows.get(...)`) and not just what
// `loadTerminal` hands back — a mapper that never wrote the column but happened
// to reconstruct the value would pass the second and fail the first. They live
// in this file, against this file's fake engine, deliberately: it is the double
// that owns the `sys_automation_run` row shape.
describe('ObjectStoreSuspendedRunStore — trigger attribution columns (#7533)', () => {
    it('writes trigger kind, object and record id as COLUMNS on a terminal row', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.recordTerminal(terminalRecord(1, {
            triggerType: 'record-after-update',
            triggerObject: 'crm_deal',
            triggerRecordId: 'deal_42',
        }));

        // The persisted cells — what an operator's `WHERE trigger_record_id =`
        // actually filters on. Buried in a JSON blob these would be readable
        // and unqueryable, which is the distinction #4354 drew for the count
        // columns two groups up.
        const row = engine.rows.get('run_r1');
        expect(row.trigger_type).toBe('record-after-update');
        expect(row.trigger_object).toBe('crm_deal');
        expect(row.trigger_record_id).toBe('deal_42');
    });

    it('round-trips them back through loadTerminal', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.recordTerminal(terminalRecord(2, {
            triggerType: 'schedule',
        }));

        const back = (await store.loadTerminal('r2'))!;
        expect(back.triggerType).toBe('schedule');
        // Absent stays absent — never coerced to '' on the way out.
        expect(back.triggerObject).toBeUndefined();
        expect(back.triggerRecordId).toBeUndefined();
    });

    it('writes NULL — not empty string — for a record-less trigger kind', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.recordTerminal(terminalRecord(3, { triggerType: 'schedule' }));

        const row = engine.rows.get('run_r3');
        expect(row.trigger_type).toBe('schedule');
        expect(row.trigger_record_id).toBeNull();
        expect(row.trigger_object).toBeNull();
    });

    it('a pre-#7533 record (no trigger fields) writes nulls and reads back undefined', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.recordTerminal(terminalRecord(4));

        expect(engine.rows.get('run_r4').trigger_type).toBeNull();
        const back = (await store.loadTerminal('r4'))!;
        expect(back.triggerType).toBeUndefined();
    });

    it('a PAUSED row carries the columns too, from the run context', async () => {
        // A suspended run is a `sys_automation_run` row as well. Leaving these
        // null on paused rows would make "which runs did this record provoke?"
        // answer for finished runs and silently omit the in-flight ones — a
        // partial answer that reads as a complete one.
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        const run = baseRun();
        run.context = {
            event: 'record-after-create', object: 'crm_deal',
            record: { id: 'd1', amount: 100 }, userId: 'u1',
        } as never;

        await store.save(run);

        const row = engine.rows.get('run_abc');
        expect(row.status).toBe('paused');
        expect(row.trigger_type).toBe('record-after-create');
        expect(row.trigger_object).toBe('crm_deal');
        expect(row.trigger_record_id).toBe('d1');
    });

    it('the columns let the runs of a flow be filtered by the record that caused them', async () => {
        // The reverse-correlation read, exercised through the engine's own
        // `find` rather than asserted as a shape: two runs of one flow, two
        // records, one filter.
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.recordTerminal(terminalRecord(5, {
            triggerType: 'record-after-update', triggerObject: 'crm_deal', triggerRecordId: 'deal_A',
        }));
        await store.recordTerminal(terminalRecord(6, {
            triggerType: 'record-after-update', triggerObject: 'crm_deal', triggerRecordId: 'deal_B',
        }));

        const hits = await engine.find('sys_automation_run', {
            where: { trigger_object: 'crm_deal', trigger_record_id: 'deal_B' },
        });
        expect(hits).toHaveLength(1);
        expect(hits[0].id).toBe('run_r6');
    });
});

// ─── Organization attribution on the row (cloud#1395, fixed by #10101) ───────
//
// The finding this group started as was measured from UNDER the wall, on a
// walled single-database HotCRM SaaS boot (cloud#1338's
// `verify-hotcrm-saas.mjs`, check `a4`): `sys_automation_run` carried
// `organization_id = NULL` on 31 of 31 rows while every one of them described
// a record owned by a specific customer — on a boot where `sys_audit_log`
// (1669 rows) was correctly attributed. That negative control is the whole
// reason it was a defect and not "platform tables do not carry an
// organization". #10101 promoted the audit writer's subject-first resolution
// to the shared platform-row resolver (`@objectstack/metadata-core`, the
// cloud#1395 Option A ruling) and this store now stamps through it; the
// assertions below specify that behaviour, fallback directions included.
//
// These assertions read the persisted CELL for the same reason the #7533 group
// above does: the column is what a wall filters on, and what an inbox query
// filters by. A value that round-trips through the mapper but never reaches the
// cell is invisible to both.
describe('ObjectStoreSuspendedRunStore — organization attribution (cloud#1395)', () => {
    it('takes the organization from the DECLARED `tenantId`, and reads no other spelling', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());

        await store.save({ ...baseRun(), context: { object: 'crm_deal', tenantId: 'org_1' } as any });
        expect(engine.rows.get('run_abc').organization_id).toBe('org_1');
    });

    it('⛔ does NOT read a `context.organizationId` — the key is undeclared and has no producer', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());

        // `AutomationContext` declares `tenantId` and not `organizationId`, and
        // no trigger surface writes the latter. A consumer-side alias for it
        // would be a second de-facto contract (PD #12) — and was worse than
        // inert here, because the only test covering this column fed it, so the
        // column's sole coverage exercised a path production cannot reach.
        // Falsifiability: restore the alias limb in `serialize()` and this goes
        // red, which is the point of asserting the ABSENCE rather than trusting
        // the removal.
        await store.save({ ...baseRun(), context: { object: 'crm_deal', organizationId: 'org_1' } as any });
        expect(engine.rows.get('run_abc').organization_id).toBeNull();
    });

    // PROMOTED (#10101) — this was the cloud#1395 PINNED DEFECT ('a tenant-less
    // trigger context persists organization_id = NULL beside a record that HAS
    // an organization'), rewritten per its own instruction the moment the write
    // side was fixed: the assertion now specifies the ruled behaviour. Its
    // sibling pins — cloud's `hotcrm-multitenant.acceptance.ts` suite and check
    // `a4` in `verify-hotcrm-saas.mjs` — carry the same promote-never-repair
    // instruction and follow at the next `.objectstack-sha` bump (tracked on
    // cloud#1395).
    it('PROMOTED (was the cloud#1395 pin): a tenant-less trigger context resolves organization_id from the SUBJECT record', async () => {
        const engine = createFakeEngine({
            crm_deal: { fields: { id: {}, amount: {}, organization_id: {} } },
        });
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());

        // The shape a schedule / time-relative / api trigger produces: a real
        // triggering record, carrying its own `organization_id`, and no tenant
        // on the context — every run those triggers produce, by construction.
        await store.save({
            ...baseRun(),
            context: { object: 'crm_deal', record: { id: 'd1', organization_id: 'org_1' } } as any,
        });

        const row = engine.rows.get('run_abc');
        expect(row.trigger_record_id, 'the row names the record it is about').toBe('d1');
        // …and now stores that record's organization. Both halves asserted
        // together: the value alone would be satisfiable by a row that
        // describes nothing.
        expect(row.organization_id, 'the cloud#1395 Option A ruling: subject first').toBe('org_1');
    });

    it('the SUBJECT record beats the acting tenant when both are present (actor context is the fallback, never the primary)', async () => {
        const engine = createFakeEngine({
            crm_deal: { fields: { id: {}, amount: {}, organization_id: {} } },
        });
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());

        // A member of A and B, active in B, whose flow touches an A record —
        // the `group`-posture shape where actor-first measurably misfiles.
        await store.save({
            ...baseRun(),
            context: {
                object: 'crm_deal', tenantId: 'org_actor',
                record: { id: 'd1', organization_id: 'org_subject' },
            } as any,
        });
        expect(engine.rows.get('run_abc').organization_id).toBe('org_subject');
    });

    it('the acting-context fallback still stands: no record, no org column, or no schema access each keep tenantId', async () => {
        // ① trigger carries no record (a plain scheduled sweep has no ONE
        // subject — fabricating one stays vetoed, cloud#1395 Option C)
        const noRecord = createFakeEngine({ crm_deal: { fields: { id: {}, organization_id: {} } } });
        await new ObjectStoreSuspendedRunStore(noRecord, createTestLogger()).save({
            ...baseRun(), context: { object: 'crm_deal', tenantId: 'org_1' } as any,
        });
        expect(noRecord.rows.get('run_abc').organization_id).toBe('org_1');

        // ② the object has no organization of its own (single-tenant shape)
        const noColumn = createFakeEngine({ crm_deal: { fields: { id: {}, amount: {} } } });
        await new ObjectStoreSuspendedRunStore(noColumn, createTestLogger()).save({
            ...baseRun(),
            context: { object: 'crm_deal', tenantId: 'org_1', record: { id: 'd1', amount: 100 } } as any,
        });
        expect(noColumn.rows.get('run_abc').organization_id).toBe('org_1');

        // ③ an engine double with no getSchema at all (the pre-#10101 fake
        // shape) — the resolver degrades to null and the fallback answers
        const noSchema = createFakeEngine();
        await new ObjectStoreSuspendedRunStore(noSchema, createTestLogger()).save({
            ...baseRun(),
            context: { object: 'crm_deal', tenantId: 'org_1', record: { id: 'd1', organization_id: 'org_2' } } as any,
        });
        expect(noSchema.rows.get('run_abc').organization_id).toBe('org_1');
    });

    it('tenant-less AND subject-less stays NULL — Option C (fabricating an acting org) remains vetoed', async () => {
        const engine = createFakeEngine({ crm_deal: { fields: { id: {}, organization_id: {} } } });
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.save({ ...baseRun(), context: { object: 'crm_deal' } as any });
        expect(engine.rows.get('run_abc').organization_id).toBeNull();
    });

    it('⛔ pins the sys_api_key divergence: the stamp column is the DECLARED active_organization_id, not the wall', async () => {
        // The credential table: unwalled by necessity (`enabled: false`,
        // #8287) while its rows are still ABOUT one organization under
        // `tenancy.organizationField` (#8778). A flow triggered by an api-key
        // record must file its run under the org the key authenticates into —
        // limb 0 of the shared resolver, winning over the ADR-0066 opt-out.
        const engine = createFakeEngine({
            sys_api_key: {
                tenancy: { enabled: false, organizationField: 'active_organization_id' },
                fields: { id: {}, name: {}, user_id: {}, active_organization_id: {}, revoked: {} },
            },
        });
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.save({
            ...baseRun(),
            context: {
                object: 'sys_api_key',
                record: { id: 'key1', name: 'ci', active_organization_id: 'org_key' },
            } as any,
        });
        expect(engine.rows.get('run_abc').organization_id).toBe('org_key');
    });

    it('recordTerminal resolves the SUBJECT organization from the trigger-record snapshot, with the acting tenant as fallback', async () => {
        const engine = createFakeEngine({
            crm_deal: { fields: { id: {}, amount: {}, organization_id: {} } },
        });
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());

        // Subject resolvable → subject org, even beside an acting tenant.
        await store.recordTerminal({
            runId: 'r1', flowName: 'f', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z',
            organizationId: 'org_actor',
            triggerType: 'record-after-update', triggerObject: 'crm_deal', triggerRecordId: 'd1',
            triggerRecord: { id: 'd1', organization_id: 'org_subject' },
        } as RunRecord);
        expect(engine.rows.get('run_r1').organization_id).toBe('org_subject');

        // No snapshot (a plain scheduled sweep) → the acting-context fallback.
        await store.recordTerminal({
            runId: 'r2', flowName: 'f', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z',
            organizationId: 'org_actor', triggerType: 'schedule',
        } as RunRecord);
        expect(engine.rows.get('run_r2').organization_id).toBe('org_actor');

        // Neither → NULL, never a fabricated value.
        await store.recordTerminal({
            runId: 'r3', flowName: 'f', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z',
            triggerType: 'schedule',
        } as RunRecord);
        expect(engine.rows.get('run_r3').organization_id).toBeNull();
    });

    it('end to end: a tenant-less engine run lands a terminal history row carrying the SUBJECT organization', async () => {
        // Pins the engine → store handoff itself (`recordLog` copying the
        // context's trigger-record snapshot and acting tenant onto the
        // RunRecord), not just the store's resolution over a hand-built record.
        const engine = createFakeEngine({
            crm_deal: { fields: { id: {}, amount: {}, organization_id: {} } },
        });
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        const e = new AutomationEngine(createTestLogger(), store);
        e.registerFlow('attr_flow', {
            name: 'attr_flow', label: 'Attribution Flow', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });
        const result = await e.execute('attr_flow', {
            // the schedule / time-relative shape: a subject record, no tenant
            object: 'crm_deal', event: 'record-after-update',
            record: { id: 'd9', organization_id: 'org_1', amount: 5 },
        } as any);
        expect(result.success).toBe(true);
        // recordTerminal is fire-and-forget off the terminal recordLog — give
        // the microtask queue one turn to land the row.
        await new Promise((r) => setImmediate(r));
        const terminal = [...engine.rows.values()].find((r) => r.status === 'completed');
        expect(terminal, 'a terminal history row landed').toBeTruthy();
        expect(terminal.trigger_record_id).toBe('d9');
        expect(terminal.organization_id).toBe('org_1');
    });

    it('a run’s paused row and its terminal row agree by construction (same inputs, same precedence)', async () => {
        const engine = createFakeEngine({
            crm_deal: { fields: { id: {}, amount: {}, organization_id: {} } },
        });
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        const context = { object: 'crm_deal', record: { id: 'd1', organization_id: 'org_1' } };

        await store.save({ ...baseRun(), context: context as any });
        await store.recordTerminal({
            runId: 'abc2', flowName: 'approval_flow', status: 'completed',
            startedAt: '2026-01-01T00:00:00.000Z',
            triggerType: 'record-after-update', triggerObject: context.object,
            triggerRecordId: 'd1', triggerRecord: context.record,
        } as RunRecord);

        expect(engine.rows.get('run_abc').organization_id).toBe('org_1');
        expect(engine.rows.get('run_abc2').organization_id).toBe('org_1');
    });
});

/**
 * [#14333] The PRODUCTION conditional advance — `ObjectStoreSuspendedRunStore`,
 * against the counting `multi` fake engine above.
 *
 * ## Why this suite exists
 *
 * The engine-side pin (`concurrent-replica-resume-race.test.ts`) drives two
 * `AutomationEngine`s over one `InMemorySuspendedRunStore`, which proves the
 * engine asks the store and honours the answer. It says NOTHING about the store
 * every production deployment actually runs. Measured, on the branch before
 * this suite existed: deleting `multi: true` from `claimSuspension`'s one
 * `delete` call left every test green — while against a running server that
 * spelling is the dispatch `reject` verdict, which throws, which `claimAdvance`
 * turns into `STORE_UNAVAILABLE` on EVERY resume. A one-token regression that
 * refuses every production resume must not be able to pass.
 *
 * So the spelling is asserted through the producer's own predicate
 * (`assertEngineDeleteDispatch`, wired into `createFakeEngine` above and read
 * directly below), not by matching a literal token: a test that greps for
 * `multi: true` pins the characters, this pins the DECISION `ObjectQL.delete`
 * will make about the same options bag.
 */
describe('#14333 ObjectStoreSuspendedRunStore.claimSuspension — the production conditional advance', () => {
    /** A paused row for `run_abc`, parked at `approve_step` / `areq_1`. */
    const parkRun = async (store: ObjectStoreSuspendedRunStore, over: Partial<SuspendedRun> = {}) => {
        await store.save({ ...baseRun(), ...over });
    };

    it('spells the compare-and-set the way ObjectQL dispatches to deleteMany, not the by-id route', async () => {
        const engine = createFakeEngine();
        const seen: any[] = [];
        const spy = { ...engine, async delete(object: string, options: any) {
            seen.push(options);
            return engine.delete!(object, options);
        } } as SuspendedRunStoreEngine & { rows: Map<string, any> };
        const store = new ObjectStoreSuspendedRunStore(spy, createTestLogger());
        await parkRun(store);

        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('claimed');

        expect(seen).toHaveLength(1);
        // The condition really is carried: id AND the parking, not id alone.
        expect(seen[0].where).toEqual({ id: 'run_abc', node_id: 'approve_step', correlation: 'areq_1' });
        // THE decision, taken by the producer's predicate over the very options
        // bag the store built. `by-id` would bind only the primary key and
        // silently discard the condition; `reject` is what a missing `multi`
        // produces, and it THROWS in a running server.
        expect(assertEngineDeleteDispatch(seen[0])).toEqual({ kind: 'multi' });
        // …and it actually removed the row.
        expect(engine.rows.has('run_abc')).toBe(false);
    });

    it('omits `correlation` from the condition when the caller has none, and still takes the multi route', async () => {
        const engine = createFakeEngine();
        const seen: any[] = [];
        const spy = { ...engine, async delete(object: string, options: any) {
            seen.push(options);
            return engine.delete!(object, options);
        } } as SuspendedRunStoreEngine & { rows: Map<string, any> };
        const store = new ObjectStoreSuspendedRunStore(spy, createTestLogger());
        await parkRun(store, { correlation: undefined });

        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step' })).toBe('claimed');
        expect(seen[0].where).toEqual({ id: 'run_abc', node_id: 'approve_step' });
        expect(assertEngineDeleteDispatch(seen[0])).toEqual({ kind: 'multi' });
    });

    it('maps the affected-row COUNT to the outcome: 1 is claimed, 0 is lost', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await parkRun(store);

        // One row matches the whole condition.
        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('claimed');
        // The row is gone, so the second claim matches nothing.
        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('lost');
    });

    it('a row that MOVED to another node is lost, not claimed — the row still exists', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await parkRun(store, { nodeId: 'second_step', correlation: 'areq_2' });

        // A replica still holding the earlier parking claims against it.
        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('lost');
        // ⛔ And the winner's parking is intact: an existence-only consume would
        // have deleted the row that another replica is standing on.
        expect(engine.rows.has('run_abc')).toBe(true);
        expect(engine.rows.get('run_abc').node_id).toBe('second_step');
    });

    it('a row re-parked at the SAME node with a new correlation is lost (the map re-entry shape)', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await parkRun(store, { nodeId: 'items', correlation: 'map:child_2' });

        expect(await store.claimSuspension('run_abc', { nodeId: 'items', correlation: 'map:child_1' }))
            .toBe('lost');
        expect(engine.rows.has('run_abc')).toBe(true);
        expect(engine.rows.get('run_abc').correlation).toBe('map:child_2');
    });

    it('an engine with no delete() answers unsupported, and says so ONCE per store', async () => {
        const engine = createFakeEngine();
        const noDelete = { find: engine.find, insert: engine.insert, update: engine.update } as SuspendedRunStoreEngine;
        const lines: string[] = [];
        const store = new ObjectStoreSuspendedRunStore(noDelete, { warn: (m: string) => lines.push(m) } as any);

        for (let i = 0; i < 3; i++) {
            expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step' })).toBe('unsupported');
        }
        // Once per STORE, not once per call: the composition cannot express the
        // condition for the life of the process, so repeating it every resume
        // is repetition of a permanent fact.
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('no cross-replica advance guarantee');
        expect(lines[0]).toContain('engine has no delete()');
    });

    it('a multi-row result that is not a COUNT answers unsupported, and says so ONCE per store', async () => {
        const engine = createFakeEngine();
        // A driver whose many-row delete resolves something other than a number:
        // "did I win?" has no answer to read, so the store must not guess.
        const nonCounting = { ...engine, async delete() { return true; } } as SuspendedRunStoreEngine;
        const lines: string[] = [];
        const store = new ObjectStoreSuspendedRunStore(nonCounting, { warn: (m: string) => lines.push(m) } as any);

        for (let i = 0; i < 3; i++) {
            expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step' })).toBe('unsupported');
        }
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('not an affected-row count');
        expect(lines[0]).toContain('no cross-replica advance guarantee');
    });

    // ── End to end: two engines over ONE ObjectStoreSuspendedRunStore ────────
    //
    // The engine-side pin runs over the in-memory store. This is the same race
    // driven through the store production actually uses, so the predicate
    // spelling, the count mapping and the engine's fold are exercised together.

    const RACE_FLOW = {
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

    function raceReplica(store: ObjectStoreSuspendedRunStore, opened: string[], fired: string[]) {
        const engine = new AutomationEngine(createTestLogger(), store);
        engine.registerNodeExecutor({
            type: 'approval_level',
            descriptor: defineActionDescriptor({
                type: 'approval_level', version: '1.0.0', name: 'Approval level',
                supportsPause: true, resumeAuthority: 'service',
            }),
            async execute(node) {
                opened.push(node.id);
                return { success: true, suspend: true, correlation: `req_${node.id}` };
            },
        });
        engine.registerNodeExecutor({
            type: 'notify_action',
            descriptor: defineActionDescriptor({ type: 'notify_action', version: '1.0.0', name: 'Notify' }),
            async execute(node) { fired.push(node.id); return { success: true }; },
        });
        engine.registerFlow('expense_approval', RACE_FLOW);
        return engine;
    }

    it('two engines over ONE durable store advance a raced run exactly once', async () => {
        const dataEngine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(dataEngine, createTestLogger());
        const opened: string[] = [];
        const fired: string[] = [];
        const a = raceReplica(store, opened, fired);
        const b = raceReplica(store, opened, fired);

        const runId = (await a.execute('expense_approval')).runId!;
        expect(opened).toEqual(['lv1']);

        const both = await Promise.all([
            a.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any),
            b.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any),
        ]);

        // The observable effect, through the production store: one advance.
        expect(fired).toEqual(['notify']);
        expect(opened).toEqual(['lv1', 'lv2']);
        expect(both.filter((r) => r.success)).toHaveLength(1);
        const loser = both.find((r) => !r.success)!;
        expect(loser.code).toBe('RESUME_IN_PROGRESS');
        expect(loser.status).toBeUndefined();
        // The winner's new parking survived the loser's claim.
        expect(dataEngine.rows.get(runId).node_id).toBe('lv2');
    });

    it('a claim that THROWS refuses the resume as STORE_UNAVAILABLE and says only what it knows', async () => {
        const dataEngine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(dataEngine, createTestLogger());
        const opened: string[] = [];
        const fired: string[] = [];
        const engine = raceReplica(store, opened, fired);
        const runId = (await engine.execute('expense_approval')).runId!;

        (store as any).claimSuspension = async () => { throw new Error('sqlite: database is locked'); };
        const refused = await engine.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any);

        expect(refused.success).toBe(false);
        // Unknown, never "gone for good" (#4420) — the same call is expected to
        // work once the store recovers.
        expect(refused.code).toBe('STORE_UNAVAILABLE');
        expect(refused.status).toBeUndefined();
        // ⛔ It must NOT assert the suspension was not consumed: a throw can
        // arrive after a committed delete. It states what it knows and hands
        // the ambiguity to a retry.
        expect(refused.error).toContain('this resume did NOT continue the run');
        expect(refused.error).toContain('UNKNOWN');
        expect(refused.error).not.toContain('the suspension was NOT consumed');
        // Nothing ran, and the run is still parked for that retry.
        expect(fired).toEqual([]);
        expect(opened).toEqual(['lv1']);
        expect(dataEngine.rows.get(runId).node_id).toBe('lv1');
    });
});
