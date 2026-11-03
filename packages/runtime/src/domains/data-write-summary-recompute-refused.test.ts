// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28661] The runtime dispatcher's `/data` door answers a child write whose
 * roll-up recompute is refused the way `RestServer` does: the write's own
 * success answer, never a 500 for a write that landed.
 *
 * Measured on `origin/main` before it: the engine's `SummaryRecomputeError`
 * ("the triggering records WERE written") left `dispatch()` and the host
 * rendered it `500`, though the row was persisted and the parent's valid
 * roll-ups had recomputed. `RestServer`'s twin routes are pinned in
 * `packages/rest/src/data-write-summary-recompute-refused.test.ts`.
 *
 * The rig is `data-hook-condition-refusal.test.ts`'s: a real store
 * (better-sqlite3 `:memory:`, the real `ObjectQL`, a real
 * `ObjectStackProtocolImplementation`) and `HttpDispatcher.dispatch()` handed
 * what the catch-all hands it. The failing roll-up (`sum` over a child text
 * field) is registered on the engine directly, as a stored object published
 * before the publish gate refused it would be.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const metadata = { getObject: async (name: string) => engine.registry.getObject(name) };
    const services: Record<string, unknown> = { protocol, metadata };
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

describe('[#28661] the dispatcher /data door — a child write under a failing roll-up answers its success', () => {
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

    it('the operator is told once, at error, through the host logger', () => {
        const lines = logger.error.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`"${PARENT}.probe_sf"`);
    });
});
