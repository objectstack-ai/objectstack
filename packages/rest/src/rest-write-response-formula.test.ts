// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5504] The issue's repro, walked over the REST routes a client actually
// calls:
//
//     POST  /api/v1/data/:object       → 201, record.<formula> was ABSENT
//     GET   /api/v1/data/:object/:id   → the same formula had a value
//     PATCH /api/v1/data/:object/:id   → 200, still absent
//
// The fix is entirely in `packages/objectql` (`engine.insert` / `engine.update`
// now hydrate formula virtual fields onto what they return, the way `find` /
// `findOne` always have). The REST layer needed NO production change — its
// POST/PATCH handlers pass the protocol result through verbatim.
//
// That is exactly why this file exists. "No change needed here" is a claim
// about a layer, and the only honest way to make it is to drive the layer:
// nothing hand-built below, a REAL `ObjectQL` + a REAL
// `ObjectStackProtocolImplementation` + the registered routes, so a future
// reshaping of the write response (a projection, a whitelist, a serializer)
// that drops virtual fields on the way out fails HERE rather than silently
// re-opening the issue one layer above the tests that cover it.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const DATA_COLLECTION = '/api/v1/data/:object';
const DATA_ITEM = '/api/v1/data/:object/:id';

/** The HotCRM shape from the issue: `nameField` points at a formula. */
const ACCOUNT = {
    name: 'rf_account',
    label: 'Account',
    nameField: 'display_title',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        name: { name: 'name', label: 'Name', type: 'text', required: true },
        segment: { name: 'segment', label: 'Segment', type: 'text' },
        display_title: {
            name: 'display_title',
            label: 'Display Title',
            type: 'formula',
            expression: { dialect: 'cel', source: '"ACC - " + record.name' },
        },
    },
};

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: Record<string, unknown> = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: unknown) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/** In-memory driver with `RETURNING *` write semantics and copy-on-read. */
function memoryDriver() {
    const rows = new Map<string, Map<string, Record<string, unknown>>>();
    const table = (o: string) => {
        let t = rows.get(o);
        if (!t) { t = new Map(); rows.set(o, t); }
        return t;
    };
    let seq = 0;
    const matches = (row: Record<string, unknown>, where: unknown) => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
            if (k.startsWith('$')) continue;
            const want = (v && typeof v === 'object' && '$eq' in (v as Record<string, unknown>))
                ? (v as Record<string, unknown>).$eq
                : v;
            if ((row[k] ?? null) !== (want ?? null)) return false;
        }
        return true;
    };
    const driver = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        // Copies, never live references — `driver-memory`'s stated contract.
        async find(object: string, ast: { where?: unknown }) {
            return Array.from(table(object).values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
        },
        async findOne(object: string, ast: { where?: unknown }) {
            for (const r of table(object).values()) if (matches(r, ast?.where)) return { ...r };
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            seq += 1;
            const id = (data.id as string) ?? `r_${seq}`;
            const row = { ...data, id };
            table(object).set(id, row);
            return { ...row };
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const t = table(object);
            const cur = t.get(id);
            if (!cur) return null;
            const next = { ...cur, ...data, id };
            t.set(id, next);
            return { ...next };
        },
        async delete(object: string, id: string) { return table(object).delete(id); },
        async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
        async count(object: string, ast: { where?: unknown }) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, list: Record<string, unknown>[]) {
            const out = [];
            for (const r of list) out.push(await this.create(object, r));
            return out;
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return driver;
}

async function bootRest() {
    const engine = new ObjectQL();
    engine.registerDriver(memoryDriver() as never, true);
    await engine.init();
    engine.registry.registerObject(ACCOUNT as never);
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    const rest = new RestServer(
        createMockServer() as never,
        protocol as never,
        { api: { requireAuth: false } } as never,
    );
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
        async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return rest;
}

async function call(
    rest: Awaited<ReturnType<typeof bootRest>>,
    method: string,
    path: string,
    req: Record<string, unknown>,
) {
    const route = (rest.getRoutes() as Array<{ method: string; path: string; handler: (rq: unknown, rs: unknown) => Promise<void> }>)
        .find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    const res = makeRes();
    await route.handler({ method, params: {}, query: {}, body: {}, headers: {}, ...req }, res);
    return res as { statusCode: number; body: Record<string, unknown> };
}

const recordOf = (res: { body: Record<string, unknown> }) => res.body.record as Record<string, unknown>;

describe('[#5504] write responses carry formula fields over REST', () => {
    it('POST answers 201 with the formula present, equal to the GET that follows', async () => {
        const rest = await bootRest();

        const created = await call(rest, 'POST', DATA_COLLECTION, {
            params: { object: 'rf_account' },
            body: { name: 'PatchEcho' },
        });
        expect(created.statusCode).toBe(201);
        // The reported symptom: the KEY was missing entirely, so a client could
        // not tell "not evaluated" from "field not configured".
        expect('display_title' in recordOf(created)).toBe(true);
        expect(recordOf(created).display_title).toBe('ACC - PatchEcho');

        const fetched = await call(rest, 'GET', DATA_ITEM, {
            params: { object: 'rf_account', id: String(created.body.id) },
        });
        expect(recordOf(fetched).display_title).toBe(recordOf(created).display_title);
    }, 60_000);

    it('PATCH answers 200 with the formula recomputed from the new values', async () => {
        const rest = await bootRest();
        const created = await call(rest, 'POST', DATA_COLLECTION, {
            params: { object: 'rf_account' },
            body: { name: 'Before' },
        });
        const id = String(created.body.id);

        const patched = await call(rest, 'PATCH', DATA_ITEM, {
            params: { object: 'rf_account', id },
            body: { segment: 'growth' },
        });
        expect(patched.statusCode).toBe(200);
        expect(recordOf(patched).display_title).toBe('ACC - Before');

        const renamed = await call(rest, 'PATCH', DATA_ITEM, {
            params: { object: 'rf_account', id },
            body: { name: 'After' },
        });
        expect(recordOf(renamed).display_title).toBe('ACC - After');

        const fetched = await call(rest, 'GET', DATA_ITEM, { params: { object: 'rf_account', id } });
        expect(recordOf(fetched).display_title).toBe('ACC - After');
    }, 60_000);

    it('the create response is renderable as-is for a formula `nameField`', async () => {
        // No second round-trip: the consequence the issue led with.
        const rest = await bootRest();
        const created = await call(rest, 'POST', DATA_COLLECTION, {
            params: { object: 'rf_account' },
            body: { name: 'Northwind' },
        });
        expect(recordOf(created)[ACCOUNT.nameField]).toBe('ACC - Northwind');
    }, 60_000);
});
