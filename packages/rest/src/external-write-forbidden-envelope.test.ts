// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7739] A write refused by ADR-0015's Gate 3 reaches the client as a
// `403 EXTERNAL_WRITE_FORBIDDEN` envelope, not as a bare `500 INTERNAL_ERROR`.
//
// ---------------------------------------------------------------------------
// The defect, and where it actually lived
//
// `ExternalWriteForbiddenError` was already correct on every axis QA could see
// from the server side: it named the datasource, its `schemaMode`, and both
// flags that would be required, and it carried a ledgered ADR-0112 `code`
// (`EXTERNAL_WRITE_FORBIDDEN`, registered under `@objectstack/spec`). Nothing
// was applied — the gate throws before the driver is reached at all.
//
// What it did NOT carry was an HTTP status, and no exit can invent one. So the
// refusal fell past every structured branch of `mapDataError`, matched no
// message heuristic, and left through the terminal `UNCLASSIFIED_FAULT` as
// `500 INTERNAL_ERROR` **with no `code`** — the client could not tell a
// deliberate policy refusal from the server falling over, even though the
// discriminator existed the whole way down.
//
// The fix is at the PRODUCER (`packages/spec/src/shared/external-errors.ts`),
// not in a REST error map: the whole `EXTERNAL_ERROR_CODES` family now declares
// its status in one table, `EXTERNAL_ERROR_HTTP_STATUS`, and every HTTP exit in
// this repo already reads `status` → `statusCode` (`declaredHttpStatus` here,
// `resolveErrorResponse`, `HttpDispatcher.errorFromThrown`,
// `dispatcher-plugin.errorResponseBase`, `endpoint-executor`, `domains/actions`,
// `plugin-hono-server`). One mapping, every door — and `rest-server.ts`, a
// known 10k-line conflict site, is untouched by this change.
//
// ---------------------------------------------------------------------------
// Why the fixture is a REAL engine rather than a rejecting mock
//
// The card asks for two facts that a `mockRejectedValue` cannot pair:
//
//   1. the refusal answers 403 with its `code`, and
//   2. **nothing is applied**.
//
// A mock that rejects makes (2) vacuously true, so it would stay green against
// a future "fix" that got the status right by letting the write THROUGH on some
// other path. Here the protocol delegates to a real `ObjectQL` engine over an
// in-memory driver whose store this file can read, so (2) is measured against a
// store that CAN be written — §3's control case writes to it through the very
// same route to prove the fixture is not inert.
//
// ---------------------------------------------------------------------------
// Reverse verification (run before the assertions were finalised)
//
// Direction predicted: RED on the unfixed producer, and RED for the reason the
// card describes rather than an unrelated one. Measured by reverting
// `external-errors.ts` to `origin/main` (`git checkout origin/main -- <path>`)
// and re-running this file:
//
//   §1 status  → expected 403, received 500                    RED
//   §1 code    → expected 'EXTERNAL_WRITE_FORBIDDEN', received undefined  RED
//   §2 (update/delete) → same pair, both verbs                 RED
//   §3 "nothing applied" → GREEN both before and after, BY CONSTRUCTION:
//      the behaviour was never the bug. It is asserted anyway because it is the
//      half that stops a status-only "fix" from passing — see above.
//
// So the file goes red on the defect and its "nothing applied" half is
// deliberately direction-insensitive. Recorded rather than reshaped, since a
// template that demands before-red/after-green on every assertion would have
// had this test lie about what it measures.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { ObjectQL } from '@objectstack/objectql';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { RestServer } from './rest-server.js';

const DATA_COLLECTION = '/api/v1/data/:object';
const DATA_ITEM = '/api/v1/data/:object/:id';

// ---------------------------------------------------------------------------
// Fixture: a federated datasource whose rows this file can count
// ---------------------------------------------------------------------------

interface Backing {
    driver: IDataDriver;
    /** Every row the driver holds, in insertion order. The "remote table". */
    rows: () => Array<Record<string, unknown>>;
    /** Write attempts that reached the driver at all. */
    writes: () => string[];
}

function makeDriver(name: string): Backing {
    const store = new Map<string, Record<string, unknown>>();
    const writes: string[] = [];
    const driver = {
        name,
        version: '1.0.0',
        async connect() {},
        async disconnect() {},
        async find() { return [...store.values()]; },
        async findOne() { return null; },
        async count() { return store.size; },
        async create(object: string, data: any) {
            writes.push(`create:${object}`);
            const id = data.id ?? String(store.size + 1);
            const row = { ...data, id };
            store.set(`${object}:${id}`, row);
            return row;
        },
        async update(object: string, id: string, data: any) {
            writes.push(`update:${object}`);
            const row = { ...(store.get(`${object}:${id}`) ?? {}), ...data, id };
            store.set(`${object}:${id}`, row);
            return row;
        },
        async delete(object: string, id: string) {
            writes.push(`delete:${object}`);
            return store.delete(`${object}:${id}`);
        },
        async bulkCreate(object: string, rows: any[]) {
            return rows.map((r) => {
                writes.push(`create:${object}`);
                const id = r.id ?? String(store.size + 1);
                const row = { ...r, id };
                store.set(`${object}:${id}`, row);
                return row;
            });
        },
        async syncSchema() {},
        async dropTable() {},
    } as unknown as IDataDriver;
    return { driver, rows: () => [...store.values()], writes: () => [...writes] };
}

/**
 * The reproduction from the card: a read-only federated external object.
 *
 * `schemaMode: 'external'` with `allowWrites` / `writable` both off is exactly
 * the double opt-in Gate 3 requires, and the ONLY thing `writable` changes is
 * whether the gate throws — so the two arms of this fixture differ by one flag.
 */
function makeEngine(opts: { writable?: boolean } = {}) {
    const backing = makeDriver('warehouse');
    const engine = new ObjectQL();
    engine.registerDriver(makeDriver('default').driver, true);
    engine.registerDriver(backing.driver);
    engine.registerDatasourceDef({
        name: 'warehouse',
        schemaMode: 'external',
        external: { allowWrites: opts.writable ?? false },
    } as any);
    engine.registerApp({
        id: 'wh_pkg',
        name: 'Warehouse',
        objects: [
            {
                name: 'wh_order',
                datasource: 'warehouse',
                external: { remoteName: 'fact_orders', writable: opts.writable ?? false },
                fields: { order_id: { type: 'text' }, amount: { type: 'number' } },
            },
        ],
    } as any);
    return { engine, backing };
}

// ---------------------------------------------------------------------------
// The REST harness — the real CRUD routes, driven in process
// ---------------------------------------------------------------------------

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/** A protocol whose data verbs are the REAL engine — no rejecting stubs. */
function setup(opts: { writable?: boolean } = {}) {
    const { engine, backing } = makeEngine(opts);
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'wh_order' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn(async (r: any) => engine.find(r.object, {})),
        createData: vi.fn(async (r: any) => engine.insert(r.object, r.data)),
        updateData: vi.fn(async (r: any) => engine.update(r.object, { id: r.id, ...r.data })),
        deleteData: vi.fn(async (r: any) => engine.delete(r.object, { where: { id: r.id } })),
    };
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return { rest, backing };
}

function routeOf(rest: any, method: string, path: string) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    return route;
}

async function callPost(rest: any, object: string, body: Record<string, unknown>) {
    const res = makeRes();
    await routeOf(rest, 'POST', DATA_COLLECTION).handler(
        { method: 'POST', params: { object }, query: {}, headers: {}, body },
        res,
    );
    return res;
}

async function callPatch(rest: any, object: string, id: string, body: Record<string, unknown>) {
    const res = makeRes();
    await routeOf(rest, 'PATCH', DATA_ITEM).handler(
        { method: 'PATCH', params: { object, id }, query: {}, headers: {}, body },
        res,
    );
    return res;
}

async function callDelete(rest: any, object: string, id: string) {
    const res = makeRes();
    await routeOf(rest, 'DELETE', DATA_ITEM).handler(
        { method: 'DELETE', params: { object, id }, query: {}, headers: {} },
        res,
    );
    return res;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

// ---------------------------------------------------------------------------
// §1 The reported request
// ---------------------------------------------------------------------------

describe('[#7739] POST /api/v1/data/<external_object> on a read-only federated object', () => {
    it('answers 403 with the stable code — not a bare 500 INTERNAL_ERROR', async () => {
        const { rest } = setup();

        const res = await callPost(rest, 'wh_order', { order_id: 'o1', amount: 10 });

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('EXTERNAL_WRITE_FORBIDDEN');
        // The two halves of the symptom, pinned negatively so a regression that
        // reintroduces the generic envelope cannot pass on the positives alone.
        expect(res.statusCode).not.toBe(500);
        expect(res.body.error).not.toBe(INTERNAL_ERROR_MESSAGE);
    }, 60_000);

    it('keeps the refusal detail the error already computed', async () => {
        // A 4xx message is addressed TO the caller and is the remedy, so the
        // 4xx arm truncates rather than replaces it. This is the whole reason
        // 403 was chosen over a 5xx: the 5xx band drops the prose, and this
        // prose names precisely which two flags to set.
        const { rest } = setup();

        const res = await callPost(rest, 'wh_order', { order_id: 'o1' });

        expect(res.body.error).toContain('wh_order');
        expect(res.body.error).toContain('warehouse');
        expect(res.body.error).toContain('schemaMode=external');
        expect(res.body.error).toContain('allowWrites');
        expect(res.body.error).toContain('writable');
    }, 60_000);

    it('names the object on the envelope', async () => {
        const { rest } = setup();
        const res = await callPost(rest, 'wh_order', { order_id: 'o1' });
        expect(res.body.object).toBe('wh_order');
    }, 60_000);

    it('is not logged as an unhandled fault — a refusal is an expected outcome', async () => {
        // 403 is an `isExpectedDataStatus`, so a deliberate refusal stops
        // producing the "[REST] Unhandled error" line it emitted as a 500.
        const { rest } = setup();

        await callPost(rest, 'wh_order', { order_id: 'o1' });

        const logged = errorSpy.mock.calls.some(
            (call: unknown[]) => JSON.stringify(call.map(String)).includes('Unhandled error'),
        );
        expect(logged).toBe(false);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// §2 The other two verbs the gate covers
// ---------------------------------------------------------------------------

describe('[#7739] update and delete refusals get the same envelope', () => {
    it('PATCH → 403 EXTERNAL_WRITE_FORBIDDEN', async () => {
        const { rest } = setup();
        const res = await callPatch(rest, 'wh_order', 'rec1', { amount: 99 });
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('EXTERNAL_WRITE_FORBIDDEN');
    }, 60_000);

    it('DELETE → 403 EXTERNAL_WRITE_FORBIDDEN', async () => {
        const { rest } = setup();
        const res = await callDelete(rest, 'wh_order', 'rec1');
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('EXTERNAL_WRITE_FORBIDDEN');
    }, 60_000);
});

// ---------------------------------------------------------------------------
// §3 Nothing is applied — and the store can prove it
// ---------------------------------------------------------------------------

describe('[#7739] the remote table is byte-identical after a refused write', () => {
    it('POST leaves the store empty and never reaches the driver', async () => {
        const { rest, backing } = setup();
        const before = JSON.stringify(backing.rows());

        const res = await callPost(rest, 'wh_order', { order_id: 'o1', amount: 10 });

        expect(res.statusCode).toBe(403);
        expect(JSON.stringify(backing.rows())).toBe(before);
        expect(backing.rows()).toEqual([]);
        // Stronger than a row count: the gate refuses BEFORE the driver, so a
        // create-then-rollback "fix" would fail here even with an empty table.
        expect(backing.writes()).toEqual([]);
    }, 60_000);

    it('PATCH and DELETE reach the driver no more than POST does', async () => {
        const { rest, backing } = setup();
        await callPatch(rest, 'wh_order', 'rec1', { amount: 99 });
        await callDelete(rest, 'wh_order', 'rec1');
        expect(backing.writes()).toEqual([]);
    }, 60_000);

    it('CONTROL: with the double opt-in the same route DOES write — the fixture is not inert', async () => {
        // Without this, every "nothing was applied" assertion above would pass
        // just as happily against a driver that cannot write at all, and the
        // section would be measuring nothing.
        const { rest, backing } = setup({ writable: true });

        const res = await callPost(rest, 'wh_order', { order_id: 'o1', amount: 10 });

        expect(res.statusCode).toBe(201);
        expect(backing.rows()).toHaveLength(1);
        expect(backing.rows()[0]).toMatchObject({ order_id: 'o1' });
        expect(backing.writes()).toContain('create:wh_order');
    }, 60_000);
});
