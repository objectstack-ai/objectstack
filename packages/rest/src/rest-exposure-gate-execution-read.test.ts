// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24535] `GET /api/v1/data/OBJECT` computes NO metadata diagnostics.
//
// The defect: the API-exposure gate (`enforceApiAccess`) read the object it
// judges through the SERVED by-name read, `getMetaItem`, which decorates the
// item it answers with `_diagnostics` — a full schema `safeParse` of the
// object's definition (`computeMetadataDiagnostics`) — on every `/data`
// request, while the gate reads only `enable`. Measured at 1.84 ms of 15.60 ms
// CPU per HotCRM `top=1` read (11.8%), growing with the object's size. The gate
// now reads the protocol's EXECUTION face, `getMetaItemForExecution`: the same
// item, undecorated (`protocol.item-execution-read.test.ts` in
// `@objectstack/metadata-protocol` pins that parity).
//
// The instrument: every diagnostic of an object goes through ONE seam,
// `computeMetadataDiagnostics` → `getMetadataTypeSchema('object').safeParse`.
// The `object` binding is replaced, for this file, by the same schema behind a
// proxy that records the name of each document it parses, through the
// registry's own public overlay (`registerMetadataTypeSchema`), and restored
// after. Everything else is real: the REST route handlers over the real
// `ObjectStackProtocolImplementation` over a real `SchemaRegistry`, with the
// real data call behind the gate for the code object (see `host`).
//
// Rows:
//  1. COST — a `/data` list of a code-registered object and of one stored in
//     the environment (the overlay read), unscoped and environment-scoped,
//     records ZERO diagnostics; so does a request the gate REFUSES (the gate
//     did read `enable`: the verdict is the object's).
//  2. FALLBACK — a protocol with no execution face is asked `getMetaItem`, as
//     before: same answer, and exactly ONE diagnostic of the object, recorded
//     on the same `/data` path. This row is what keeps the zeros above from
//     being vacuous: the instrument does see the gate's read when it decorates.
//  3. CONTROL — the served read is unchanged: `GET /api/v1/meta/object/NAME`
//     still serves `_diagnostics`, and the instrument records it.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { getMetadataTypeSchema, registerMetadataTypeSchema } from '@objectstack/spec/kernel';
import { RestServer } from './rest-server.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Code-registered, whitelisted to reads. */
const CODE = {
    name: 'code_widget', label: 'Code Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['get', 'list'] },
};
/**
 * Stored in the environment (`sys_metadata`), registered by no package — the
 * environment-overlay item, served from its stored row. (A packaged object's
 * stored copy is never served over the package's definition, ADR-0131 D6, so
 * a tenant-authored object is the overlay case. This host has no write-epoch
 * seam, so the row is read per call; the overlay cache both faces share is
 * pinned in `@objectstack/metadata-protocol`.)
 */
const STORED = {
    name: 'stored_widget', label: 'Stored Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['list'] },
};

// ── The instrument ───────────────────────────────────────────────────────────

const OBJECT_SCHEMA = getMetadataTypeSchema('object');
/** The `name` of every object document diagnosed since the last reset. */
let diagnosed: unknown[] = [];

beforeAll(() => {
    if (!OBJECT_SCHEMA) throw new Error('no registered `object` schema to instrument');
    const recording = new Proxy(OBJECT_SCHEMA, {
        get(target, prop, receiver) {
            if (prop === 'safeParse') {
                return (input: unknown, ...rest: unknown[]) => {
                    diagnosed.push((input as { name?: unknown } | null)?.name);
                    return (target.safeParse as (...a: unknown[]) => unknown).call(target, input, ...rest);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
    registerMetadataTypeSchema('object', recording);
});
afterAll(() => {
    if (OBJECT_SCHEMA) registerMetadataTypeSchema('object', OBJECT_SCHEMA);
});
afterEach(() => { vi.restoreAllMocks(); });

// ── The host ─────────────────────────────────────────────────────────────────

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function host(opts: { environmentId?: string; withoutExecutionFace?: boolean } = {}) {
    const registry = new SchemaRegistry();
    registry.registerObject(clone(CODE) as never, 'pkg_code', undefined, 'own');
    const rows = [{
        id: 'row_stored', type: 'object', name: STORED.name, state: 'active',
        organization_id: null, package_id: null, metadata: JSON.stringify(STORED),
    }];
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return whereValueMatches(r[k] ?? null, v ?? null);
        });
    const engine = {
        registry,
        find: async (table: string, q: { where?: Record<string, unknown>; limit?: number } = {}) => {
            const hits = table === 'sys_metadata' ? rows.filter((r) => matches(r, q.where ?? {})) : [];
            return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        findOne: async (table: string, q: { where: Record<string, unknown> }) => {
            assertEngineFindOnePredicate(table, q as never);
            return table === 'sys_metadata' ? rows.find((r) => matches(r, q.where)) : undefined;
        },
        count: async () => 0,
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine as never, () => new Map(), opts.environmentId);
    if (opts.withoutExecutionFace) protocol.getMetaItemForExecution = undefined;
    // The data call is the REAL one for the code object. The stored object's
    // rows are answered here: this host never hydrates a stored object into
    // the registry, so the data plane's registry gate would 404 it, and its
    // rows are not what this file measures. The gate in front of it is real.
    const realFindData = protocol.findData.bind(protocol);
    const findData = vi.fn(async (request: { object?: string }) => request?.object === STORED.name
        ? { object: STORED.name, records: [], total: 0 }
        : realFindData(request));
    protocol.findData = findData;

    const rest = new RestServer(createMockServer() as never, protocol as never, { api: { requireAuth: false } } as never);
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
        async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    return { rest, protocol, findData };
}

async function get(h: ReturnType<typeof host>, path: string, params: Record<string, string>) {
    const route = (h.rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    if (!route) throw new Error(`route not registered: GET ${path}`);
    let status = 200;
    let body: any;
    const res: any = {
        status: (c: number) => { status = c; return res; },
        json: (b: unknown) => { body = b; return res; },
        send: (b: unknown) => { body = b; return res; },
        header: () => res, setHeader: () => res, write: () => true, end: () => res,
    };
    diagnosed = [];
    await route.handler({ method: 'GET', path, params, query: {}, headers: {}, body: {} }, res);
    return { status, body, diagnosed: [...diagnosed] };
}

const DATA = '/api/v1/data/:object';
const DATA_ONE = '/api/v1/data/:object/:id';
const META_ITEM = '/api/v1/meta/:type/:name';
const errorCode = (body: any): unknown => body?.code ?? body?.error?.code;

for (const scope of [{ label: 'unscoped kernel', environmentId: undefined }, { label: 'environment-scoped kernel', environmentId: 'env_test' }]) {
    describe(`[#24535] GET /api/v1/data/OBJECT computes no metadata diagnostics — ${scope.label}`, () => {
        it.each([
            ['code-registered', CODE.name],
            ['environment-overlay', STORED.name],
        ])('a %s object: ZERO diagnostics, and the data call is reached', async (_kind, object) => {
            const h = host({ environmentId: scope.environmentId });
            const out = await get(h, DATA, { object });
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(h.findData).toHaveBeenCalledTimes(1);
            expect(out.diagnosed).toEqual([]);
        });

        it('a request the gate REFUSES: ZERO diagnostics, and the verdict is the stored row\'s `enable`', async () => {
            const h = host({ environmentId: scope.environmentId });
            // The stored row allows `list` only, so a by-id read is refused.
            const out = await get(h, DATA_ONE, { object: STORED.name, id: 'r1' });
            expect(out.status).toBe(405);
            expect(errorCode(out.body)).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
            expect(out.body.allowed).toContain('list');
            expect(out.body.allowed).not.toContain('get');
            expect(h.findData).not.toHaveBeenCalled();
            expect(out.diagnosed).toEqual([]);
        });

        it('FALLBACK: a protocol with no execution face is asked `getMetaItem` — same answer, ONE diagnostic', async () => {
            const h = host({ environmentId: scope.environmentId, withoutExecutionFace: true });
            const served = vi.spyOn(h.protocol, 'getMetaItem');
            const out = await get(h, DATA, { object: CODE.name });
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(served).toHaveBeenCalledTimes(1);
            expect(out.diagnosed).toEqual([CODE.name]);

            const refused = await get(h, DATA_ONE, { object: STORED.name, id: 'r1' });
            expect(refused.status).toBe(405);
            expect(refused.body.allowed).not.toContain('get');
            expect(refused.diagnosed).toEqual([STORED.name]);
        });

        it.each([
            ['code-registered', CODE.name],
            ['environment-overlay', STORED.name],
        ])('CONTROL: GET /api/v1/meta/object/NAME of a %s object still serves `_diagnostics`', async (_kind, name) => {
            const h = host({ environmentId: scope.environmentId });
            const out = await get(h, META_ITEM, { type: 'object', name });
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(out.body.item.name).toBe(name);
            expect(out.body.item._diagnostics).toBeDefined();
            expect(out.diagnosed).toContain(name);
        });
    });
}
