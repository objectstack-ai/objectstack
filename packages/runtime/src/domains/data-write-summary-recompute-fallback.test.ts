// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28782] `callData`'s ObjectQL FALLBACK — the arm that serves a host with no
 * `protocol` service — answers a write that landed under a failing roll-up
 * with its own success answer, through the dispatcher's `/data` door.
 *
 * Measured on `origin/main` (`c9a9981da`) before this file: #28781 taught the
 * dispatcher's door to answer the answer the protocol's `createData` /
 * `updateData` / `deleteData` attach to `ERR_SUMMARY_RECOMPUTE`; the fallback
 * builds none, so on a protocol-less host the same writes still left
 * `dispatch()` as the refusal — a 500 for a row that was stored. The fallback
 * now builds its own answer from the refusal's `written` and carries it the
 * same way (`withEarnedAnswer`).
 *
 * Harness: #28781's `data-write-summary-recompute-refused.test.ts`, with the
 * `protocol` service removed and the engine registered as `objectql`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { HttpDispatcher } from '../http-dispatcher.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const PREFIX = '/api/v1';
const PACKAGE_ID = 'objectstack-test';
const CALLER = { userId: 'u_member', isSystem: false };
const PARENT = 'qsf_parent';
const CHILD = 'qsf_child';

const PARENT_OBJECT = {
    name: PARENT, label: 'Parent',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const },
        child_sum: { name: 'child_sum', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'sum', field: 'amount' } },
        child_count: { name: 'child_count', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'count' } },
        probe_sf: { name: 'probe_sf', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'sum', field: 'memo' } },
    },
};
const CHILD_OBJECT = {
    name: CHILD, label: 'Child',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const },
        memo: { name: 'memo', type: 'text' as const },
        amount: { name: 'amount', type: 'number' as const },
        parent: { name: 'parent', type: 'master_detail' as const, reference: PARENT, required: true, deleteBehavior: 'cascade' },
    },
};

let engine: ObjectQL;
let dispatcher: HttpDispatcher;
let logger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(PARENT_OBJECT as any, PACKAGE_ID);
    engine.registry.registerObject(CHILD_OBJECT as any, PACKAGE_ID);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await engine.insert(PARENT, { id: 'p1', name: 'P' } as any);
    await engine.insert(CHILD, [
        { id: 'c1', name: 'c1', amount: 100, parent: 'p1' },
        { id: 'c2', name: 'c2', amount: 135, parent: 'p1' },
    ] as any).catch((e: any) => {
        // The seed itself meets the failing roll-up; its rows are written.
        if (e?.code !== 'ERR_SUMMARY_RECOMPUTE') throw e;
    });

    // No `protocol` service: `callData` takes its ObjectQL fallback.
    const metadata = { getObject: async (name: string) => engine.registry.getObject(name) };
    const services: Record<string, unknown> = { objectql: engine, metadata };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    (dispatcher as any).domainDeps.logger = logger;
});

afterAll(async () => {
    warn.mockRestore();
    try { await engine.destroy(); } catch { /* noop */ }
});

/** One `/data` request as the catch-all hands it: the returned answer, or what left `dispatch()`. */
async function send(method: string, path: string, body?: Record<string, unknown>): Promise<{ returned?: any; thrown?: unknown }> {
    const raw = new Request(`http://localhost${PREFIX}/data${path}`, {
        method, headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    try {
        return { returned: await dispatcher.dispatch(method, `/data${path}`, body ?? {}, {}, { request: raw } as any, PREFIX) };
    } catch (thrown) {
        return { thrown };
    }
}

const parentRow = async () => (await engine.findOne(PARENT, { where: { id: 'p1' } })) as any;
const childRows = async (where: Record<string, unknown>) => (await engine.find(CHILD, { where })) as any[];

describe('[#28782] the callData ObjectQL fallback — a child write under a failing roll-up answers its success', () => {
    it('POST answers 201 with the created record, persisted once, and the valid roll-ups recompute', async () => {
        const { returned, thrown } = await send('POST', `/${CHILD}`, { id: 'x1', name: 'x', amount: 60, parent: 'p1' });
        expect(thrown).toBeUndefined();
        expect(returned.response.status, JSON.stringify(returned.response.body)).toBe(201);
        expect(returned.response.body.data).toMatchObject({ object: CHILD, id: 'x1', record: { id: 'x1', amount: 60 } });
        expect(await childRows({ name: 'x' })).toHaveLength(1);
        expect(await parentRow()).toMatchObject({ child_sum: 295, child_count: 3 });
    });

    it('PATCH answers 200 with the updated record, and the valid roll-ups recompute', async () => {
        const { returned, thrown } = await send('PATCH', `/${CHILD}/c1`, { amount: 35 });
        expect(thrown).toBeUndefined();
        expect(returned.response.status, JSON.stringify(returned.response.body)).toBe(200);
        expect(returned.response.body.data).toMatchObject({ object: CHILD, id: 'c1', record: { id: 'c1', amount: 35 } });
        expect(await parentRow()).toMatchObject({ child_sum: 230, child_count: 3 });
    });

    it('DELETE answers 200 success, the row is gone, and the valid roll-ups recompute', async () => {
        const { returned, thrown } = await send('DELETE', `/${CHILD}/c2`);
        expect(thrown).toBeUndefined();
        expect(returned.response.status, JSON.stringify(returned.response.body)).toBe(200);
        expect(returned.response.body.data).toEqual({ object: CHILD, id: 'c2', success: true });
        expect(await childRows({ id: 'c2' })).toEqual([]);
        expect(await parentRow()).toMatchObject({ child_sum: 95, child_count: 2 });
    });

    it('a refusal before the write answers as it did: a child missing its required parent is refused, nothing stored', async () => {
        const { returned, thrown } = await send('POST', `/${CHILD}`, { id: 'orphan1', name: 'orphan1', amount: 1 });
        expect(returned?.response?.status).not.toBe(201);
        expect((thrown as any)?.code ?? returned?.response?.body?.code).not.toBe('ERR_SUMMARY_RECOMPUTE');
        expect(await childRows({ id: 'orphan1' })).toEqual([]);
    });

    it('the operator is told once, at error, through the host logger', () => {
        const lines = logger.error.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`"${PARENT}.probe_sf"`);
    });
});
