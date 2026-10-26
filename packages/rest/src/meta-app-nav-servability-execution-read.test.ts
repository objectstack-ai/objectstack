// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25783] `GET /api/v1/meta/app` computes NO object diagnostics to judge its
// navigation — the `/meta/app` door of the class #24031 / #24535 closed for
// `/data`.
//
// The defect: the nav-servability gate (`resolveNavServability`) reads every
// object's `enable` through `loadObjectItems`, which asked the SERVED list
// read, `getMetaItems`, and that decorates every item with `_diagnostics` — a
// full schema `safeParse` of each object definition. Measured at 63 of 73 ms
// CPU per `/meta/app` read over 108 objects. The gate now reads the protocol's
// EXECUTION face, `getMetaItemsForExecution`: the same list, undecorated
// (`RestServer.metaListSource`).
//
// The instrument is `rest-exposure-gate-execution-read.test.ts`'s: the
// `object` schema behind a proxy that records the name of each document it
// parses, registered through `registerMetadataTypeSchema` — a FRESH proxy per
// test, because verdicts are memoized per schema object and document content.
// Everything else is real: the REST route handlers over the real
// `ObjectStackProtocolImplementation` over a real `SchemaRegistry`.
//
// Rows, unscoped and environment-scoped:
//  1. COST — the app list and the app by name prune the entry whose object
//     refuses `list` and keep the one that grants it, recording ZERO object
//     diagnostics.
//  2. FALLBACK — a protocol with no execution list face is asked
//     `getMetaItems`, as before: the same prune, and every object diagnosed.
//     This row keeps the zeros above from being vacuous.
//  3. CONTROL — `GET /api/v1/meta/object` still serves `_diagnostics` on
//     every object, and the instrument records them.

import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { getMetadataTypeSchema, registerMetadataTypeSchema } from '@objectstack/spec/kernel';
import { RestServer } from './rest-server.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Grants `list`: its nav entry is served. */
const LISTED = {
    name: 'listed_widget', label: 'Listed Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['get', 'list'] },
};
/** Refuses `list` (405 for every user): its nav entry is pruned. */
const UNLISTED = {
    name: 'unlisted_widget', label: 'Unlisted Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['get'] },
};
const APP = {
    name: 'widgets', label: 'Widgets',
    navigation: [
        { id: 'nav_listed', type: 'object', label: 'Listed', objectName: LISTED.name },
        { id: 'nav_unlisted', type: 'object', label: 'Unlisted', objectName: UNLISTED.name },
    ],
};

// ── The instrument ───────────────────────────────────────────────────────────

const OBJECT_SCHEMA = getMetadataTypeSchema('object');
/** The `name` of every object document diagnosed since the last reset. */
let diagnosed: unknown[] = [];

beforeEach(() => {
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

function host(opts: { environmentId?: string; withoutExecutionListFace?: boolean } = {}) {
    const registry = new SchemaRegistry();
    registry.registerObject(clone(LISTED) as never, 'pkg_code', undefined, 'own');
    registry.registerObject(clone(UNLISTED) as never, 'pkg_code', undefined, 'own');
    registry.registerItem('app', clone(APP) as never, 'name' as never, 'pkg_code');
    const engine = {
        registry,
        find: async () => [],
        count: async () => 0,
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine as never, () => new Map(), opts.environmentId);
    if (opts.withoutExecutionListFace) protocol.getMetaItemsForExecution = undefined;
    const rest = new RestServer(createMockServer() as never, protocol as never, { api: { requireAuth: false } } as never);
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
        async () => ({ userId: 'test-user', systemPermissions: [] });
    rest.registerRoutes();
    return { rest, protocol };
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

const META_LIST = '/api/v1/meta/:type';
const META_ITEM = '/api/v1/meta/:type/:name';
const navIds = (app: any): string[] => (app?.navigation ?? []).map((e: any) => e.id);
const listedApp = (body: any): any => (body?.items ?? []).find((a: any) => a?.name === APP.name);

for (const scope of [{ label: 'unscoped kernel', environmentId: undefined }, { label: 'environment-scoped kernel', environmentId: 'env_test' }]) {
    describe(`[#25783] GET /api/v1/meta/app judges its navigation without object diagnostics — ${scope.label}`, () => {
        it('the app LIST: the unlistable entry is pruned, the listable one kept, ZERO object diagnostics', async () => {
            const h = host({ environmentId: scope.environmentId });
            const execution = vi.spyOn(h.protocol, 'getMetaItemsForExecution');
            const out = await get(h, META_LIST, { type: 'app' });
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(navIds(listedApp(out.body))).toEqual(['nav_listed']);
            expect(execution).toHaveBeenCalledWith(expect.objectContaining({ type: 'object' }));
            expect(out.diagnosed).toEqual([]);
        });

        it('the app BY NAME: the same prune, ZERO object diagnostics', async () => {
            const h = host({ environmentId: scope.environmentId });
            const out = await get(h, META_ITEM, { type: 'app', name: APP.name });
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(navIds(out.body.item)).toEqual(['nav_listed']);
            expect(out.diagnosed).toEqual([]);
        });

        it('FALLBACK: a protocol with no execution list face is asked `getMetaItems` — the same prune, every object diagnosed', async () => {
            const h = host({ environmentId: scope.environmentId, withoutExecutionListFace: true });
            const served = vi.spyOn(h.protocol, 'getMetaItems');
            const out = await get(h, META_LIST, { type: 'app' });
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            expect(navIds(listedApp(out.body))).toEqual(['nav_listed']);
            expect(served).toHaveBeenCalledWith(expect.objectContaining({ type: 'object' }));
            expect([...out.diagnosed].sort()).toEqual([LISTED.name, UNLISTED.name].sort());
        });

        it('CONTROL: GET /api/v1/meta/object still serves `_diagnostics` on every object', async () => {
            const h = host({ environmentId: scope.environmentId });
            const out = await get(h, META_LIST, { type: 'object' });
            expect(out.status, JSON.stringify(out.body)).toBe(200);
            const items = (out.body?.items ?? []).filter((o: any) => o?.name === LISTED.name || o?.name === UNLISTED.name);
            expect(items).toHaveLength(2);
            for (const item of items) expect(item._diagnostics).toBeDefined();
            expect(out.diagnosed).toEqual(expect.arrayContaining([LISTED.name, UNLISTED.name]));
        });
    });
}
