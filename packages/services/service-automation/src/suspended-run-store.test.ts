// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import { ObjectStoreSuspendedRunStore, type SuspendedRunStoreEngine } from './suspended-run-store.js';
import type { RunRecord, SuspendedRun } from './engine.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';

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
function createFakeEngine(): SuspendedRunStoreEngine & { rows: Map<string, any> } {
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
            if (options?.multi) {
                const doomed = [...rows.values()].filter(r => matches(r, options?.where));
                for (const r of doomed) rows.delete(String(r.id));
                return doomed.length;
            }
            const id = options?.where?.id;
            rows.delete(String(id));
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

// ─── Organization attribution on the row (cloud#1395) ────────────────────────
//
// The finding this pins was measured from UNDER the wall, on a walled
// single-database HotCRM SaaS boot (cloud#1338's `verify-hotcrm-saas.mjs`,
// check `a4`): `sys_automation_run` carried `organization_id = NULL` on 31 of
// 31 rows while every one of them described a record owned by a specific
// customer — on a boot where `sys_audit_log` (1669 rows) was correctly
// attributed. That negative control is the whole reason this is a defect and
// not "platform tables do not carry an organization", so it is restated in
// every comment here and must stay restated.
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

    // ⛔ PINNED DEFECT — this is cloud#1395 IN THE SHAPE MEASURED, not a
    // specification of desired behaviour. It asserts what the writer does
    // today: a run whose trigger carried no acting tenant persists NO
    // organization, even though `trigger_object` / `trigger_record_id` on the
    // very same row name a record that belongs to one.
    //
    // The schedule, time-relative and api triggers set no tenant AT ALL — by
    // construction, since a scheduled sweep has no single acting organization —
    // so this is not an edge case, it is every run those triggers produce.
    //
    // ⛔ When the write side is fixed, this test must FAIL and be rewritten to
    // assert the organization resolved from the trigger record. Do not "repair"
    // it to keep it green; a pinned defect that quietly adapts to the fix is the
    // unfalsifiable green this whole line of work exists to prevent. Its sibling
    // pin is check `a4` in cloud's `verify-hotcrm-saas.mjs`, which carries the
    // same instruction and must be promoted in the same change.
    it('PINNED: a tenant-less trigger context persists organization_id = NULL beside a record that HAS an organization', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());

        // The shape a schedule / api trigger produces: a real triggering record,
        // carrying its own `organization_id`, and no tenant on the context.
        await store.save({
            ...baseRun(),
            context: { object: 'crm_deal', record: { id: 'd1', organization_id: 'org_1' } } as any,
        });

        const row = engine.rows.get('run_abc');
        expect(row.trigger_record_id, 'the row names the record it is about').toBe('d1');
        // …and stores no organization for it. Both halves asserted together:
        // the NULL alone would be satisfiable by a row that describes nothing.
        expect(row.organization_id, 'PINNED DEFECT cloud#1395 — fix this and PROMOTE the assertion').toBeNull();
    });
});
