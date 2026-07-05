// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import { ObjectStoreSuspendedRunStore, type SuspendedRunStoreEngine } from './suspended-run-store.js';
import type { RunRecord, SuspendedRun } from './engine.js';

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
    // Equality plus the `$lt` operator the retention sweep uses.
    const matches = (row: any, where: any) =>
        !where || Object.entries(where).every(([k, v]) =>
            v && typeof v === 'object' && '$lt' in (v as any)
                ? row[k] < (v as any).$lt
                : row[k] === v,
        );
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
    context: { object: 'crm_deal', userId: 'u1', organizationId: 'org_1', record: { id: 'd1', amount: 100 } } as any,
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

    it('pruneHistory deletes terminal rows past the age window but never paused rows', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        const now = Date.parse('2026-03-01T00:00:00.000Z');
        // Backdate created_at: two ancient terminals (one failed), one fresh.
        await store.recordTerminal(terminalRecord(1));
        await store.recordTerminal(terminalRecord(2, { status: 'failed', error: 'x' }));
        await store.recordTerminal(terminalRecord(3));
        engine.rows.get('run_r1').created_at = '2026-01-01T00:00:00.000Z';
        engine.rows.get('run_r2').created_at = '2026-01-02T00:00:00.000Z';
        engine.rows.get('run_r3').created_at = '2026-02-28T00:00:00.000Z';
        // An old suspended run — live resumable state, exempt from retention.
        await store.save(baseRun());
        engine.rows.get('run_abc').created_at = '2025-06-01T00:00:00.000Z';

        const deleted = await store.pruneHistory(30, now);
        expect(deleted).toBe(2);
        expect(await store.loadTerminal('r1')).toBeNull();
        expect(await store.loadTerminal('r2')).toBeNull();
        expect(await store.loadTerminal('r3')).not.toBeNull();
        expect(await store.load('run_abc')).not.toBeNull();
    });

    it('pruneHistory is a no-op for a non-positive window', async () => {
        const engine = createFakeEngine();
        const store = new ObjectStoreSuspendedRunStore(engine, createTestLogger());
        await store.recordTerminal(terminalRecord(1));
        engine.rows.get('run_r1').created_at = '2020-01-01T00:00:00.000Z';
        expect(await store.pruneHistory(0)).toBe(0);
        expect(await store.pruneHistory(-5)).toBe(0);
        expect(await store.loadTerminal('r1')).not.toBeNull();
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
