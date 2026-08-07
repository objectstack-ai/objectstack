// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4722 — the server is the authoritative visibility gate for app metadata, so
// the proof that matters is the RESPONSE BODY, not the private filter in
// isolation: an entry the caller may not see must not be in the JSON at all.
//
// Before this change `filterAppForUser` walked only the app's top-level
// `navigation` tree, so an item gated inside `areas[]` was hidden by the shell
// alone — the entry, and with it the `objectName` / `pageName` / `componentRef`
// it points at, still shipped in `/meta`. Reading the JSON (or poking client
// state) defeated the gate entirely.
//
// Both call sites are exercised here, because they are separate handlers that
// each re-derive the gate: the LIST read `GET /meta/:type` and the single-item
// read `GET /meta/:type/:name` (which bypasses the shared cache for apps
// precisely so this per-user filter can run).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// An areas-shaped app: no top-level navigation at all, which is the shape the
// pre-#4722 early return (`if (!nav) return item`) handed back untouched.
const AREA_APP = {
    name: 'crm',
    label: 'CRM',
    areas: [
        {
            id: 'area_sales',
            label: 'Sales',
            navigation: [
                { id: 'nav_leads', type: 'object', objectName: 'lead' },
                { id: 'nav_forecast', type: 'object', objectName: 'secret_forecast', requiredPermissions: ['sales.admin'] },
                { id: 'nav_ops_page', type: 'page', pageName: 'secret_ops_page', requiredPermissions: ['sales.admin'] },
                { id: 'nav_widget', type: 'component', componentRef: 'secret_widget', requiresService: 'org-scoping' },
            ],
        },
        {
            id: 'area_admin',
            label: 'Admin',
            navigation: [
                { id: 'nav_users', type: 'object', objectName: 'secret_sys_user', requiredPermissions: ['admin.access'] },
            ],
        },
    ],
};

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
    res.header = vi.fn(); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

/**
 * @param perms system permissions the caller holds
 * @param services which `requiresService` names the runtime has registered
 */
function setup(perms: string[], services: string[] = ['org-scoping']) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        // Deep-clone per call: the filter must never mutate stored metadata, and
        // a shared object would hide that by carrying a prior call's damage.
        getMetaItems: vi.fn(async ({ type }: any) => {
            const t = String(type ?? '');
            return t === 'app' || t === 'apps' ? [JSON.parse(JSON.stringify(AREA_APP))] : [];
        }),
        // `getMetaItem` answers the `{ type, name, item }` envelope (#5563),
        // with `type` folded to the canonical singular the way the real
        // protocol folds it (#4432) — the route is addressed as `/meta/apps/…`
        // here, and the producer answers `app`.
        getMetaItem: vi.fn(async ({ name }: any) => ({
            type: 'app', name, item: JSON.parse(JSON.stringify(AREA_APP)),
        })),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    // The RBAC filter only runs for a resolved caller; stubbing the context is
    // the established pattern in this package for exercising it by route.
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: perms });
    // ADR-0057 D10 capability probe (what `rest-api-plugin` wires in production).
    rest.serviceExistsProvider = (n: string) => services.includes(n);
    rest.registerRoutes();
    return { rest, protocol };
}

async function getList(rest: any, type = 'apps') {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type');
    if (!route) throw new Error('meta/:type route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type }, query: {}, body: {}, headers: {} }, res);
    return res;
}

async function getItem(rest: any, name = 'crm', type = 'apps') {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type, name }, query: {}, body: {}, headers: {} }, res);
    return res;
}

/**
 * The LIST body's elements are metadata documents (`{ type, items: [...] }`,
 * or a bare array). [#5563] This used to end with a `raw.item ? raw.item : raw`
 * shape sniff, because the single-item route answered either shape depending on
 * server config; each surface has exactly one shape now, so each reader names
 * the one it reads.
 */
const appFrom = (body: any): any =>
    Array.isArray(body) ? body[0] : (body?.items ? body.items[0] : body);
/** The SINGLE-ITEM body is the `{ type, name, item }` envelope. */
const appFromItem = (body: any): any => body?.item;
const areaNav = (app: any, areaId: string): string[] =>
    (app?.areas?.find((a: any) => a.id === areaId)?.navigation ?? []).map((e: any) => e.id);

describe('#4722 — `/meta` strips gated nav entries inside `areas[]`, on both read paths', () => {
    it('LIST: a caller without the permissions receives neither the entries nor their targets', async () => {
        const { rest } = setup([]);
        const res = await getList(rest);

        expect(res.statusCode).toBe(200);
        const app = appFrom(res.body);
        // `nav_widget` survives on purpose: it carries only a capability gate,
        // and this runtime HAS `org-scoping`. Permission gating is what is
        // under test here — over-filtering would be a bug of its own.
        expect(areaNav(app, 'area_sales')).toEqual(['nav_leads', 'nav_widget']);
        // area_admin was emptied by the gate → dropped whole, no bare label.
        expect(app.areas.map((a: any) => a.id)).toEqual(['area_sales']);

        // The acceptance criterion is about the wire bytes: every gated item's
        // objectName / pageName / componentRef target is gone from the body.
        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('secret_forecast');
        expect(wire).not.toContain('secret_ops_page');
        expect(wire).not.toContain('secret_sys_user');
        // …while what the caller may see is still served.
        expect(wire).toContain('lead');
    });

    it('SINGLE ITEM: the same stripping applies to GET /meta/apps/:name', async () => {
        const { rest } = setup([]);
        const res = await getItem(rest);

        expect(res.statusCode).toBe(200);
        const app = appFromItem(res.body);
        expect(areaNav(app, 'area_sales')).toEqual(['nav_leads', 'nav_widget']);
        expect(app.areas.map((a: any) => a.id)).toEqual(['area_sales']);
        // The envelope is the body; the gated document sits inside it.
        expect(res.body).toMatchObject({ type: 'app', name: 'crm' });

        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('secret_forecast');
        expect(wire).not.toContain('secret_ops_page');
        expect(wire).not.toContain('secret_sys_user');
    });

    it('a caller who HOLDS the permissions still receives the whole tree (no over-filtering)', async () => {
        const { rest } = setup(['sales.admin', 'admin.access']);
        const list = appFrom((await getList(rest)).body);
        const single = appFromItem((await getItem(rest)).body);

        for (const app of [list, single]) {
            expect(app.areas.map((a: any) => a.id)).toEqual(['area_sales', 'area_admin']);
            expect(areaNav(app, 'area_sales')).toEqual(['nav_leads', 'nav_forecast', 'nav_ops_page', 'nav_widget']);
            expect(areaNav(app, 'area_admin')).toEqual(['nav_users']);
        }
    });

    it('ADR-0057 D10: a `requiresService` entry inside an area is stripped when the service is absent', async () => {
        // Holds every permission — only the capability gate can remove the item.
        const { rest } = setup(['sales.admin', 'admin.access'], []);
        const list = appFrom((await getList(rest)).body);
        const single = appFromItem((await getItem(rest)).body);

        for (const app of [list, single]) {
            expect(areaNav(app, 'area_sales')).toEqual(['nav_leads', 'nav_forecast', 'nav_ops_page']);
            expect(JSON.stringify(app)).not.toContain('secret_widget');
        }
    });

    it('the probe covers services named only inside an area — a REGISTERED one is not stripped', async () => {
        // The complement of the test above, and the reason
        // `resolveRegisteredServices` had to learn to descend into `areas`: a
        // name it never probes is absent from the registered set, which the
        // gate reads as "service missing" and would strip a live entry.
        const { rest } = setup(['sales.admin', 'admin.access'], ['org-scoping']);
        const app = appFrom((await getList(rest)).body);
        expect(areaNav(app, 'area_sales')).toContain('nav_widget');
    });
});
