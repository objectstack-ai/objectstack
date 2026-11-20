// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/meta/_migrate-unit-codes` — the tenant-admin door for the unit
 * code backfill (ADR-0158 U7 R1; Open item 12, point 7), the twin of
 * `_migrate-record-currency-codes`.
 *
 * Driven on the real `RestServer` registration, with a real `ObjectQL` engine
 * over a driver double whose reads are the engine's own in-memory reading of a
 * driver query (`applyDriverQueryInMemory`), holding the rows of two
 * organizations, so the scope and the refusals are judged on what the driver
 * stores. The caller's context is the only stand-in.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL, applyDriverQueryInMemory } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const PATH = '/api/v1/meta/_migrate-unit-codes';
const ADMIN_A = { userId: 'u_a', tenantId: 'org_a', systemPermissions: ['setup.access', 'setup.write'] };

function makeDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    const writes: string[] = [];
    const reads: string[] = [];
    const select = (object: string, ast: any) =>
        applyDriverQueryInMemory(Array.from(storeFor(object).values()), { where: ast?.where, orderBy: ast?.orderBy, limit: ast?.limit, offset: ast?.offset });
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(object: string, ast: any) { reads.push(object); return select(object, ast).map((r) => ({ ...r })); },
        async findOne(object: string, ast: any) { const [hit] = select(object, { ...ast, limit: 1 }); return hit ? { ...hit } : null; },
        async create(object: string, data: Record<string, unknown>) { storeFor(object).set(String(data.id), { ...data }); return { ...data }; },
        async update(object: string, id: string, data: Record<string, unknown>) {
            writes.push(id);
            const row = { ...storeFor(object).get(id), ...data, id };
            storeFor(object).set(id, row);
            return { ...row };
        },
        async delete() { return true; }, async count() { return 0; },
        async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, storeFor, writes, reads };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
    };
    return res;
}

const PROTOCOL: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockResolvedValue(null),
};
const SERVER = () => ({
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
});

/** A `RestServer` over `engine` (none: no provider wired), answering every caller as `context`. */
function boot(engine: ObjectQL | undefined, context: Record<string, unknown> | undefined, config: Record<string, unknown> = {}) {
    const provider = engine ? vi.fn(async () => engine) : undefined;
    const rest: any = new RestServer(SERVER() as any, PROTOCOL, config as any, undefined, undefined, undefined, undefined, provider as any);
    rest.resolveExecCtx = async () => context;
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === PATH);
    return {
        provider,
        route,
        call: async (body: unknown) => {
            if (!route) throw new Error(`POST ${PATH} is not registered`);
            const res = mockRes();
            await route.handler({ params: {}, query: {}, headers: {}, body }, res);
            const raw = res.json.mock.calls.at(-1)?.[0] as any;
            return { status: res.statusCode as number, raw, body: raw?.success === true ? raw.data : raw };
        },
    };
}

describe('POST /meta/_migrate-unit-codes — the caller\'s organization only', () => {
    let engine: ObjectQL;
    let d: ReturnType<typeof makeDriver>;
    const uom = (id: string) => d.storeFor('material').get(id)?.uom;

    beforeEach(async () => {
        engine = new ObjectQL();
        d = makeDriver();
        engine.registerDriver(d.driver, true);
        await engine.init();
        engine.registry.registerObject({
            name: 'material',
            fields: {
                uom: { type: 'text' },
                weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'uom', unitDimension: 'mass' } },
            },
        } as any);
        for (const [id, org, value] of [['a1', 'org_a', 'kg'], ['a2', 'org_a', 'KGM'], ['a3', 'org_a', 'lbs'], ['b1', 'org_b', 'kg']]) {
            d.storeFor('material').set(id!, { id, organization_id: org, uom: value, weight: 1 });
        }
    });

    it('a preview with no mapping lists the caller\'s organization\'s stored values, and writes nothing', async () => {
        const answer = await boot(engine, ADMIN_A).call({ object: 'material', field: 'uom' });
        expect(answer.status).toBe(200);
        expect(Object.keys(answer.raw).sort()).toEqual(['data', 'success']);
        expect(answer.body).toMatchObject({ organizationId: 'org_a', field: 'uom', scannedRecords: 3, mapped: 0, unmatched: 2, skippedMember: 1, applied: false });
        expect(answer.body.values.map((v: any) => [v.value, v.rows, v.disposition])).toEqual([['KGM', 1, 'member'], ['kg', 1, 'unmatched'], ['lbs', 1, 'unmatched']]);
        expect(d.writes).toEqual([]);
    });

    it('apply: true with an unmatched value is refused 400 VALIDATION_ERROR before any write, naming it', async () => {
        const answer = await boot(engine, ADMIN_A).call({ object: 'material', field: 'uom', mapping: { kg: 'KGM' }, apply: true });
        expect({ status: answer.status, code: answer.body?.error?.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(answer.body.error.details?.unmatched).toEqual([{ value: 'lbs', rows: 1, disposition: 'unmatched' }]);
        expect(answer.body.error.details?.fields?.[0]).toMatchObject({ field: 'mapping' });
        expect(d.writes).toEqual([]);
    });

    it('apply: true converts the caller\'s rows only; a second run writes nothing', async () => {
        const mapping = { kg: 'KGM', lbs: 'LBR' };
        const answer = await boot(engine, ADMIN_A).call({ object: 'material', field: 'uom', mapping, apply: true });
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ organizationId: 'org_a', mapped: 2, written: 2, unmatched: 0, applied: true, failures: [] });
        expect([uom('a1'), uom('a2'), uom('a3'), uom('b1')]).toEqual(['KGM', 'KGM', 'LBR', 'kg']);
        const again = await boot(engine, ADMIN_A).call({ object: 'material', field: 'uom', mapping, apply: true });
        expect(again.body).toMatchObject({ mapped: 0, written: 0 });
        expect(d.writes.sort()).toEqual(['a1', 'a3']);
    });

    it('the backfill\'s own refusals answer with its status and code, before any row of the object is read', async () => {
        const notMember = await boot(engine, ADMIN_A).call({ object: 'material', field: 'uom', mapping: { kg: 'MTR' }, apply: true });
        expect({ status: notMember.status, code: notMember.body?.error?.code }).toEqual({ status: 400, code: 'INVALID_FIELD' });
        expect(notMember.body.error.details?.fields?.[0]).toMatchObject({ field: 'uom', code: 'INVALID_FIELD' });
        const quantity = await boot(engine, ADMIN_A).call({ object: 'material', field: 'weight', mapping: {} });
        expect({ status: quantity.status, code: quantity.body?.error?.code }).toEqual({ status: 400, code: 'INVALID_FIELD' });
        const malformed = await boot(engine, ADMIN_A).call({ object: 'material', field: 'uom', mapping: { kg: 3 } });
        expect({ status: malformed.status, code: malformed.body?.error?.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect((await boot(engine, ADMIN_A).call({ object: 'nope', field: 'uom' })).status).toBe(404);
        expect(d.reads.filter((o) => o === 'material')).toEqual([]);
        expect(d.writes).toEqual([]);
    });

    it('a caller without `setup.write`, or with no current organization, is refused 403 FORBIDDEN before the engine is reached', async () => {
        for (const caller of [
            { userId: 'u_m', tenantId: 'org_a', systemPermissions: ['setup.access'] },
            { userId: 'u_x', systemPermissions: ['setup.write'] },
            { userId: 'u_sys', isSystem: true },
        ]) {
            const stack = boot(engine, caller);
            const answer = await stack.call({ object: 'material', field: 'uom', mapping: { kg: 'KGM' }, apply: true });
            expect({ status: answer.status, code: answer.body?.error?.code }, caller.userId).toEqual({ status: 403, code: 'FORBIDDEN' });
            expect(stack.provider).not.toHaveBeenCalled();
        }
        expect(d.writes).toEqual([]);
    });

    it('a malformed body, or an organization in it, is refused 400 VALIDATION_ERROR before the engine is reached', async () => {
        for (const body of [
            undefined,
            [],
            { field: 'uom' },
            { object: 'material', field: ' ' },
            { object: 'material', field: 'uom', mapping: ['kg'] },
            { object: 'material', field: 'uom', apply: 'true' },
            { object: 'material', field: 'uom', organizationId: 'org_b' },
            { object: 'material', field: 'uom', allOrganizations: true },
            { object: 'material', field: 'uom', code: 'KGM' },
        ]) {
            const stack = boot(engine, ADMIN_A);
            const answer = await stack.call(body);
            expect({ status: answer.status, code: answer.body?.error?.code }, JSON.stringify(body)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
            expect(stack.provider).not.toHaveBeenCalled();
        }
        expect(d.writes).toEqual([]);
    });

    it('with no data engine wired it answers 501 NOT_IMPLEMENTED', async () => {
        const answer = await boot(undefined, ADMIN_A).call({ object: 'material', field: 'uom' });
        expect({ status: answer.status, code: answer.body?.error?.code }).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
    });

    it('is mounted behind `metadata.endpoints.maintenance`, and under the environment-scoped base too', () => {
        expect(boot(undefined, ADMIN_A).route).toBeDefined();
        expect(boot(undefined, ADMIN_A, { metadata: { endpoints: { maintenance: false } } }).route).toBeUndefined();
        const rest: any = new RestServer(SERVER() as any, PROTOCOL, { api: { enableProjectScoping: true } } as any);
        rest.registerRoutes();
        expect(rest.getRoutes().map((r: any) => r.path)).toContain('/api/v1/environments/:environmentId/meta/_migrate-unit-codes');
    });
});
