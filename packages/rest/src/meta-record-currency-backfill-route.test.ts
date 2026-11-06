// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/meta/_migrate-record-currency-codes` — the tenant-admin door for
 * the record-currency code backfill (ADR-0144; ruling 6670707546 item B).
 *
 * Driven on the real `RestServer` registration, with a real `ObjectQL` engine
 * over an in-memory driver holding the rows of two organizations, so the
 * scope is judged on what the driver stores and returns, not on a mocked
 * backfill. The caller's context is the only stand-in.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const PATH = '/api/v1/meta/_migrate-record-currency-codes';

const ADMIN_A = { userId: 'u_a', tenantId: 'org_a', systemPermissions: ['setup.access', 'setup.write'] };
const ADMIN_B = { userId: 'u_b', tenantId: 'org_b', systemPermissions: ['setup.access', 'setup.write'] };

function makeDriver() {
    const stores = new Map<string, Map<string, any>>();
    const writes: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
    const storeFor = (o: string) => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    // Implicit equality plus the comparison operators the keyset walk emits.
    const checkOp = (value: any, cond: any): boolean => {
        if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
            return value === cond;
        }
        return Object.entries(cond).every(([op, target]: [string, any]) => {
            switch (op) {
                case '$eq': return value === target;
                case '$ne': return value !== target;
                case '$gt': return value > target;
                case '$gte': return value >= target;
                case '$lt': return value < target;
                case '$lte': return value <= target;
                case '$in': return Array.isArray(target) && target.includes(value);
                case '$nin': return Array.isArray(target) && !target.includes(value);
                default: return true;
            }
        });
    };
    const matches = (row: any, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        return Object.entries(where).every(([k, v]: [string, any]) => {
            if (k === '$and') return (v as any[]).every((w) => matches(row, w));
            if (k === '$or') return (v as any[]).some((w) => matches(row, w));
            if (k === '$not') return !matches(row, v);
            return checkOp(row?.[k], v);
        });
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            const row = { ...data };
            storeFor(object).set(String(row.id), row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            writes.push({ object, id, data });
            const s = storeFor(object);
            const row = { ...s.get(id), ...data, id };
            s.set(id, row);
            return row;
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count() { return 0; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r, undefined)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, storeFor, writes };
}

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
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

/** A `RestServer` over `engine` (none: no provider wired), answering every caller as `context`. */
function boot(
    engine: ObjectQL | undefined,
    context: Record<string, unknown> | undefined,
    config: Record<string, unknown> = {},
) {
    const provider = engine ? vi.fn(async () => engine) : undefined;
    const rest: any = new RestServer(
        mockServer() as any,
        PROTOCOL,
        config as any,
        undefined, undefined, undefined, undefined,
        provider as any,
    );
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
            return { status: res.statusCode as number, body: res.json.mock.calls.at(-1)?.[0] as any };
        },
    };
}

describe('POST /meta/_migrate-record-currency-codes — the caller\'s organization only', () => {
    let engine: ObjectQL;
    let d: ReturnType<typeof makeDriver>;

    const stored = (id: string, row: Record<string, unknown>) => {
        d.storeFor('deal').set(id, { id, name: id, ...row });
    };
    const deal = (id: string) => d.storeFor('deal').get(id);
    /** The `where` of every driver read of `deal`. */
    const dealReads = () => vi.mocked(d.driver.find).mock.calls
        .filter(([o]: unknown[]) => o === 'deal')
        .map(([, ast]: unknown[]) => JSON.stringify((ast as any)?.where));

    beforeEach(async () => {
        engine = new ObjectQL();
        d = makeDriver();
        vi.spyOn(d.driver, 'find');
        vi.spyOn(d.driver, 'update');
        engine.registerDriver(d.driver, true);
        await engine.init();
        engine.registry.registerObject({
            name: 'deal',
            fields: {
                name: { type: 'text' },
                amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
                currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
            },
        } as any);
        // Two organizations with codeless rows; one row of A already holds a code.
        stored('a1', { organization_id: 'org_a', amount: 100 });
        stored('a2', { organization_id: 'org_a', amount: 200 });
        stored('a3', { organization_id: 'org_a', amount: 300, currency_code: 'CNY' });
        stored('b1', { organization_id: 'org_b', amount: 400 });
    });

    it('a preview counts the caller\'s organization\'s rows only, and writes nothing', async () => {
        const answer = await boot(engine, ADMIN_A).call({ object: 'deal', field: 'amount', code: 'USD' });
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({
            object: 'deal', organizationId: 'org_a', allOrganizations: false, field: 'amount', codeField: 'currency_code',
            code: 'USD', scannedRecords: 3, codeless: 2, written: 0, skippedCodePresent: 1, applied: false,
            truncated: false, failures: [],
        });
        expect(answer.body.sampleRecordIds).toEqual(['a1', 'a2']);
        expect(answer.body.organizations).toEqual([
            { organizationId: 'org_a', scannedRecords: 3, codeless: 2, written: 0, skippedCodePresent: 1, skippedAmountBlank: 0 },
        ]);
        expect(vi.mocked(d.driver.update)).not.toHaveBeenCalled();
        expect(d.writes).toEqual([]);
        expect(deal('a1').currency_code).toBeUndefined();
        expect(deal('b1').currency_code).toBeUndefined();
        // Every read of the rows names the caller's organization.
        expect(dealReads().length).toBeGreaterThan(0);
        for (const where of dealReads()) expect(where).toContain('"organization_id":"org_a"');
    });

    it('the other organization\'s admin sees and writes only its own row', async () => {
        const preview = await boot(engine, ADMIN_B).call({ object: 'deal', field: 'amount', code: 'EUR' });
        expect(preview.body).toMatchObject({ organizationId: 'org_b', scannedRecords: 1, codeless: 1, written: 0 });
        expect(preview.body.sampleRecordIds).toEqual(['b1']);

        const applied = await boot(engine, ADMIN_B).call({ object: 'deal', field: 'amount', code: 'EUR', apply: true });
        expect(applied.body).toMatchObject({ organizationId: 'org_b', codeless: 1, written: 1, applied: true });
        expect(deal('b1').currency_code).toBe('EUR');
        expect(deal('a1').currency_code).toBeUndefined();
        expect(deal('a2').currency_code).toBeUndefined();
        expect(d.writes.map((w) => w.id)).toEqual(['b1']);
    });

    it('apply: true writes the caller\'s codeless rows, never a coded row or another organization\'s', async () => {
        const answer = await boot(engine, ADMIN_A).call({ object: 'deal', field: 'amount', code: 'USD', apply: true });
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ organizationId: 'org_a', codeless: 2, written: 2, applied: true, failures: [] });
        expect(deal('a1').currency_code).toBe('USD');
        expect(deal('a2').currency_code).toBe('USD');
        expect(deal('a3').currency_code).toBe('CNY');
        expect(deal('b1').currency_code).toBeUndefined();
        expect(d.writes.map((w) => w.id).sort()).toEqual(['a1', 'a2']);
        // Idempotent: a second preview finds nothing left.
        const again = await boot(engine, ADMIN_A).call({ object: 'deal', field: 'amount', code: 'USD' });
        expect(again.body).toMatchObject({ codeless: 0, written: 0 });
    });

    it('`isSystem` with a current organization passes the capability gate and stays in that organization', async () => {
        const answer = await boot(engine, { userId: 'u_sys', isSystem: true, tenantId: 'org_b' })
            .call({ object: 'deal', field: 'amount', code: 'EUR', apply: true });
        expect(answer.body).toMatchObject({ organizationId: 'org_b', written: 1 });
        expect(d.writes.map((w) => w.id)).toEqual(['b1']);
    });

    it('a caller without `setup.write` is refused 403 FORBIDDEN before the engine is reached', async () => {
        for (const caller of [
            { userId: 'u_m', tenantId: 'org_a', systemPermissions: ['setup.access'] },
            { userId: 'u_md', tenantId: 'org_a', systemPermissions: ['manage_metadata'] },
        ]) {
            const stack = boot(engine, caller);
            const answer = await stack.call({ object: 'deal', field: 'amount', code: 'USD', apply: true });
            expect({ status: answer.status, code: answer.body?.error?.code }, caller.userId).toEqual({ status: 403, code: 'FORBIDDEN' });
            expect(String(answer.body?.error?.message)).toContain('`setup.write`');
            expect(stack.provider).not.toHaveBeenCalled();
        }
        expect(dealReads()).toEqual([]);
        expect(d.writes).toEqual([]);
    });

    it('a caller with no current organization is refused 403 FORBIDDEN: there is no environment-wide form', async () => {
        for (const caller of [
            { userId: 'u_x', systemPermissions: ['setup.write'] },
            { userId: 'u_sys', isSystem: true },
        ]) {
            const stack = boot(engine, caller);
            const answer = await stack.call({ object: 'deal', field: 'amount', code: 'USD', apply: true });
            expect({ status: answer.status, code: answer.body?.error?.code }, caller.userId).toEqual({ status: 403, code: 'FORBIDDEN' });
            expect(String(answer.body?.error?.message)).toContain('no current organization');
            expect(stack.provider).not.toHaveBeenCalled();
        }
        expect(dealReads()).toEqual([]);
        expect(d.writes).toEqual([]);
    });

    it('an organization in the body is refused 400 VALIDATION_ERROR, not honoured and not ignored', async () => {
        for (const extra of [{ organizationId: 'org_b' }, { allOrganizations: true }]) {
            const stack = boot(engine, ADMIN_A);
            const answer = await stack.call({ object: 'deal', field: 'amount', code: 'USD', apply: true, ...extra });
            const key = Object.keys(extra)[0];
            expect({ status: answer.status, code: answer.body?.error?.code }, key).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
            expect(String(answer.body?.error?.message)).toContain(`'${key}' is not accepted`);
            expect(stack.provider).not.toHaveBeenCalled();
        }
        expect(d.writes).toEqual([]);
        expect(deal('b1').currency_code).toBeUndefined();
    });

    it('a malformed body is refused 400 VALIDATION_ERROR before the engine is reached', async () => {
        for (const body of [
            undefined,
            [],
            { field: 'amount', code: 'USD' },
            { object: 'deal', field: ' ', code: 'USD' },
            { object: 'deal', field: 'amount', code: 'USD', apply: 'true' },
            { object: 'deal', field: 'amount', code: 'USD', maxRecords: 10 },
        ]) {
            const stack = boot(engine, ADMIN_A);
            const answer = await stack.call(body);
            expect({ status: answer.status, code: answer.body?.error?.code }, JSON.stringify(body)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
            expect(stack.provider).not.toHaveBeenCalled();
        }
        expect(d.writes).toEqual([]);
    });

    it('the backfill\'s own refusals answer with its status and code, before any row is read', async () => {
        const notIso = await boot(engine, ADMIN_A).call({ object: 'deal', field: 'amount', code: 'usd', apply: true });
        expect({ status: notIso.status, code: notIso.body?.error?.code }).toEqual({ status: 400, code: 'INVALID_FIELD' });
        const notRecord = await boot(engine, ADMIN_A).call({ object: 'deal', field: 'name', code: 'USD', apply: true });
        expect({ status: notRecord.status, code: notRecord.body?.error?.code }).toEqual({ status: 400, code: 'INVALID_FIELD' });
        const noObject = await boot(engine, ADMIN_A).call({ object: 'no_such_object', field: 'amount', code: 'USD' });
        expect(noObject.status).toBe(404);
        expect(dealReads()).toEqual([]);
        expect(d.writes).toEqual([]);
    });

    it('with no data engine wired it answers 501 NOT_IMPLEMENTED', async () => {
        const answer = await boot(undefined, ADMIN_A).call({ object: 'deal', field: 'amount', code: 'USD' });
        expect({ status: answer.status, code: answer.body?.error?.code }).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
    });
});

describe('POST /meta/_migrate-record-currency-codes — mounted behind `metadata.endpoints.maintenance`', () => {
    it('is mounted by default, and the maintenance switch off takes it away', () => {
        expect(boot(undefined, ADMIN_A).route).toBeDefined();
        expect(boot(undefined, ADMIN_A, { metadata: { endpoints: { maintenance: false } } }).route).toBeUndefined();
        // The sibling switches leave it mounted.
        for (const key of ['types', 'items', 'item']) {
            expect(boot(undefined, ADMIN_A, { metadata: { endpoints: { [key]: false } } }).route, key).toBeDefined();
        }
    });

    it('the environment-scoped base mounts its twin', () => {
        const rest: any = new RestServer(mockServer() as any, PROTOCOL, { api: { enableProjectScoping: true } } as any);
        rest.registerRoutes();
        const paths = rest.getRoutes().filter((r: any) => r.method === 'POST' && r.path.endsWith('/_migrate-record-currency-codes'))
            .map((r: any) => r.path);
        expect(paths).toContain('/api/v1/environments/:environmentId/meta/_migrate-record-currency-codes');
    });
});
