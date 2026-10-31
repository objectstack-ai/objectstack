// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] `GET /meta/app/:appId/bundle` — one request for an app's metadata,
 * each member the answer of its own `GET /meta/{type}/{name}`, as the same
 * caller.
 *
 * Pinned on the mounted route of a real `RestServer`, against the item route of
 * the SAME server for every member (the store answers the plain read's uncached
 * arm, the item chain the bundle asks), so "the item read's answer" is measured
 * rather than restated: what the bundle holds, a member the caller may not read
 * left out, two callers whose gates differ answered two validators, an
 * unchanged bundle revalidated to `304`, an app the caller may not read refused
 * with the app read's own answer, and the closed query set.
 */

import { describe, it, expect, vi } from 'vitest';
import { AppMetadataBundleResponseSchema } from '@objectstack/spec/api';
import { PerfTiming, runWithPerfTiming } from '@objectstack/observability';
// Explicit `.js` extension: NodeNext resolution (see the sibling meta tests).
import { RestServer } from './rest-server.js';
import { appNavigationReach, inboundRelationObjects, META_APP_BUNDLE_PARAMS } from './meta-app-bundle-routes.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SALES_ADMIN = 'sales.admin';
const LEGAL_CAP = 'legal.view';

const CRM_APP = {
    name: 'crm',
    label: 'CRM',
    navigation: [
        { id: 'nav_accounts', type: 'object', objectName: 'account', viewName: 'account.all' },
        {
            id: 'nav_sales',
            type: 'group',
            label: 'Sales',
            children: [
                { id: 'nav_deals', type: 'object', objectName: 'secret_deal', requiredPermissions: [SALES_ADMIN] },
                { id: 'nav_home', type: 'page', pageName: 'home_page' },
                { id: 'nav_pipeline', type: 'dashboard', dashboardName: 'pipeline' },
                { id: 'nav_legal', type: 'dashboard', dashboardName: 'legal_board' },
            ],
        },
    ],
    areas: [
        { id: 'area_service', label: 'Service', navigation: [{ id: 'nav_contacts', type: 'object', objectName: 'contact' }] },
    ],
};
const PAYROLL_APP = { name: 'payroll', label: 'Payroll', requiredPermissions: ['payroll.access'], navigation: [] };

const field = (type: string, reference?: string) => ({ type, label: type, ...(reference ? { reference } : {}) });
const OBJECTS = [
    { name: 'account', label: 'Account', fields: { name: field('text') } },
    { name: 'contact', label: 'Contact', fields: { name: field('text'), account: field('lookup', 'account') } },
    { name: 'secret_deal', label: 'Deal', fields: { amount: field('number') } },
    // Inbound relations: `note` points at an account, `task` at a contact (array-shaped fields).
    { name: 'note', label: 'Note', fields: { body: field('text'), account: field('lookup', 'account') } },
    { name: 'task', label: 'Task', fields: [{ name: 'contact', ...field('master_detail', 'contact') }] },
    // Related only to a nav-reached object the member may not reach, and to nothing reached.
    { name: 'deal_line', label: 'Deal line', fields: { deal: field('master_detail', 'secret_deal') } },
    { name: 'invoice', label: 'Invoice', fields: { total: field('number') } },
];
const VIEWS = [
    { name: 'account.all', object: 'account', viewKind: 'list', order: 0, config: { type: 'grid', columns: ['name'] } },
    { name: 'account.legal', object: 'account', viewKind: 'list', order: 1, type: 'grid', requiredPermissions: [LEGAL_CAP] },
    { name: 'contact.mine', object: 'contact', viewKind: 'list', order: 0, config: { type: 'grid', columns: ['name'] } },
    { name: 'invoice.all', object: 'invoice', viewKind: 'list', order: 0, config: { type: 'grid', columns: ['total'] } },
];
const PAGES = [
    { name: 'home_page', label: 'Home', type: 'home' },
    { name: 'account_record', label: 'Account', type: 'record', object: 'account' },
    { name: 'invoice_record', label: 'Invoice', type: 'record', object: 'invoice' },
];
const DASHBOARDS = [
    { name: 'pipeline', label: 'Pipeline', widgets: [{ id: 'w_open', type: 'metric' }] },
    { name: 'legal_board', label: 'Legal', requiredPermissions: [LEGAL_CAP], widgets: [{ id: 'w_matters', type: 'metric' }] },
];

function store(): Record<string, any[]> {
    return { app: [CRM_APP, PAYROLL_APP], object: OBJECTS, view: VIEWS, page: PAGES, dashboard: DASHBOARDS };
}

const CALLERS = {
    admin: { userId: 'u_admin', systemPermissions: [SALES_ADMIN, LEGAL_CAP] },
    member: { userId: 'u_member', systemPermissions: [] as string[] },
} as const;
type CallerName = keyof typeof CALLERS;

// ── Harness ───────────────────────────────────────────────────────────────────

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string>, sent: false };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.send = vi.fn(() => { res.sent = true; return res; });
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

const META = '/api/v1/meta';

function setup(who: CallerName, data: Record<string, any[]> = store()) {
    const find = (type: unknown, name: unknown): any => (data[singular(type)] ?? []).find((i: any) => i.name === name);
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: Object.keys(data) }),
        getMetaItems: vi.fn(async ({ type }: any) => ({ type: singular(type), items: clone(data[singular(type)] ?? []) })),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, {} as any);
    rest.resolveExecCtx = async () => clone(CALLERS[who]);
    rest.securityServiceProvider = async () => ({ resolvePermissionSetNames: async () => [] });
    rest.serviceExistsProvider = () => true;
    rest.registerRoutes();
    const route = (path: string) => rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    return { rest, protocol, route };
}

async function bundle(
    who: CallerName,
    appId = 'crm',
    opts: { headers?: Record<string, string>; query?: Record<string, string>; data?: Record<string, any[]>; patch?: (rest: any) => void } = {},
) {
    const { rest, protocol, route } = setup(who, opts.data);
    opts.patch?.(rest);
    const res = makeRes();
    await route(`${META}/app/:appId/bundle`).handler({
        method: 'GET', path: `${META}/app/${appId}/bundle`, params: { appId }, query: opts.query ?? {}, body: {}, headers: opts.headers ?? {},
    }, res);
    return { res, protocol };
}

async function item(who: CallerName, type: string, name: string) {
    const { route } = setup(who);
    const res = makeRes();
    await route(`${META}/:type/:name`).handler({
        method: 'GET', path: `${META}/${type}/${name}`, params: { type, name }, query: {}, body: {}, headers: {},
    }, res);
    return res;
}

const namesOf = (entries: any[]): string[] => entries.map((e) => e.name);

// ── The derivation ────────────────────────────────────────────────────────────

describe('[#27627] which items an app reaches', () => {
    it('reads every navigation tree: top level, nested children and areas, in order, each name once', () => {
        expect(appNavigationReach(CRM_APP)).toEqual({
            objects: ['account', 'secret_deal', 'contact'],
            views: ['account.all'],
            pages: ['home_page'],
            dashboards: ['pipeline', 'legal_board'],
        });
        expect(appNavigationReach(undefined)).toEqual({ objects: [], views: [], pages: [], dashboards: [] });
    });

    it('takes one hop of inbound lookup and master-detail relationships, from either shape of `fields`', () => {
        expect(inboundRelationObjects(OBJECTS, ['account', 'contact'])).toEqual(['note', 'task']);
        expect(inboundRelationObjects(OBJECTS, ['secret_deal'])).toEqual(['deal_line']);
        expect(inboundRelationObjects(OBJECTS, [])).toEqual([]);
    });

    it('declares an EMPTY closed query set', () => {
        expect(META_APP_BUNDLE_PARAMS).toEqual([]);
    });
});

// ── The bundle ────────────────────────────────────────────────────────────────

describe('[#27627] one request answers the app, its reached objects, views, pages and dashboards', () => {
    it('admin: every reached member, in derivation order, the body parsing against the declared shape', async () => {
        const { res } = await bundle('admin');
        expect(res.statusCode).toBe(200);
        expect(AppMetadataBundleResponseSchema.safeParse(res.body).success).toBe(true);
        expect(res.body.app.name).toBe('crm');
        expect(namesOf(res.body.objects)).toEqual(['account', 'secret_deal', 'contact', 'note', 'task', 'deal_line']);
        expect(namesOf(res.body.views)).toEqual(['account.all', 'account.legal', 'contact.mine']);
        expect(namesOf(res.body.pages)).toEqual(['home_page', 'account_record']);
        expect(namesOf(res.body.dashboards)).toEqual(['pipeline', 'legal_board']);
    });

    it('every member is byte-equal to its own GET /meta/{type}/{name} answer, for each caller', async () => {
        for (const who of Object.keys(CALLERS) as CallerName[]) {
            const { res } = await bundle(who);
            const members: Array<[string, any]> = [
                ['app', res.body.app],
                ...res.body.objects.map((m: any) => ['object', m] as [string, any]),
                ...res.body.views.map((m: any) => ['view', m] as [string, any]),
                ...res.body.pages.map((m: any) => ['page', m] as [string, any]),
                ...res.body.dashboards.map((m: any) => ['dashboard', m] as [string, any]),
            ];
            for (const [type, member] of members) {
                const single = await item(who, type, member.name);
                expect(single.statusCode, `${who} ${type}/${member.name}`).toBe(200);
                expect(JSON.stringify(member), `${who} ${type}/${member.name}`).toBe(JSON.stringify(single.body));
            }
        }
    });

    it('member: what the item reads withhold is absent — the gated nav entry reaches nothing, the gated view and dashboard are left out', async () => {
        const { res } = await bundle('member');
        expect(res.statusCode).toBe(200);
        expect(namesOf(res.body.objects)).toEqual(['account', 'contact', 'note', 'task']);
        expect(namesOf(res.body.views)).toEqual(['account.all', 'contact.mine']);
        expect(namesOf(res.body.dashboards)).toEqual(['pipeline']);
        // The members carry none of it. (The app is its own read's answer: it
        // still names the dashboard, whose entry no app gate prunes.)
        const { app, ...members } = res.body;
        const text = JSON.stringify(members);
        for (const withheld of ['secret_deal', 'deal_line', 'account.legal', 'legal_board', 'w_matters']) {
            expect(text, withheld).not.toContain(withheld);
        }
        expect(JSON.stringify(app)).not.toContain('secret_deal');
        // The controls: the same caller's own item reads refuse what the bundle left out.
        expect((await item('member', 'view', 'account.legal')).statusCode).toBe(403);
        expect((await item('member', 'dashboard', 'legal_board')).statusCode).toBe(403);
        expect(JSON.stringify((await item('member', 'app', 'crm')).body)).not.toContain('secret_deal');
    });

    it('times its metadata reads as one `meta` span', async () => {
        const timing = new PerfTiming();
        await runWithPerfTiming(timing, () => bundle('admin'));
        expect(timing.marks().map((m) => m.name)).toContain('meta');
    });
});

// ── The validator ─────────────────────────────────────────────────────────────

describe('[#27627] a per-caller validator: ETag, private, no-cache, and 304', () => {
    it('sends a strong ETag under the item reads\' cache posture', async () => {
        const { res } = await bundle('admin');
        expect(res.headers.ETag).toMatch(/^"[0-9a-f]{64}"$/);
        expect(res.headers['Cache-Control']).toBe('private, no-cache');
        expect(res.headers.Vary).toBe('Accept-Language');
    });

    it('two callers whose gates differ are answered two validators; one caller twice, one validator', async () => {
        const admin = (await bundle('admin')).res.headers.ETag;
        const member = (await bundle('member')).res.headers.ETag;
        expect(admin).not.toBe(member);
        expect((await bundle('admin')).res.headers.ETag).toBe(admin);
    });

    it('an unchanged bundle answers 304 with no body; another caller\'s validator, or a changed store, is answered in full', async () => {
        const etag = (await bundle('member')).res.headers.ETag;
        const again = (await bundle('member', 'crm', { headers: { 'if-none-match': etag } })).res;
        expect(again.statusCode).toBe(304);
        expect(again.body).toBeUndefined();
        expect(again.sent).toBe(true);
        expect((await bundle('member', 'crm', { headers: { 'if-none-match': `W/${etag}` } })).res.statusCode).toBe(304);

        const admin = (await bundle('admin', 'crm', { headers: { 'if-none-match': etag } })).res;
        expect(admin.statusCode).toBe(200);
        expect(admin.headers.ETag).not.toBe(etag);

        const changed = store();
        changed.object = changed.object.map((o) => (o.name === 'account' ? { ...o, label: 'Customer' } : o));
        const edited = (await bundle('member', 'crm', { headers: { 'if-none-match': etag }, data: changed })).res;
        expect(edited.statusCode).toBe(200);
        expect(edited.headers.ETag).not.toBe(etag);
    });

    it('a member served under an undetermined field visibility serves the bundle no-store with no validator', async () => {
        const { res } = await bundle('admin', 'crm', {
            headers: { 'if-none-match': (await bundle('admin')).res.headers.ETag },
            patch: (rest) => {
                rest.resolveObjectMasker = async (_env: unknown, _req: unknown, type: string) => async () => (
                    type === 'object' ? { kind: 'undetermined' } : { kind: 'passthrough', reason: 'not-applicable' }
                );
            },
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers['Cache-Control']).toBe('private, no-store');
        expect(res.headers.ETag).toBeUndefined();
        expect(namesOf(res.body.objects)).toEqual(['account', 'secret_deal', 'contact', 'note', 'task', 'deal_line']);
    });
});

// ── Refusals ──────────────────────────────────────────────────────────────────

describe('[#27627] an app the caller cannot read refuses the whole request with the app read\'s own answer', () => {
    it('an unknown app: the item read\'s absence, byte for byte, and no member is read', async () => {
        const { res, protocol } = await bundle('admin', 'no_such_app');
        const single = await item('admin', 'app', 'no_such_app');
        expect(res.statusCode).toBe(single.statusCode);
        expect(res.body).toEqual(single.body);
        expect(res.headers.ETag).toBeUndefined();
        expect(protocol.getMetaItem.mock.calls.map((c: any[]) => c[0].type)).toEqual(['app']);
    });

    it('an app the caller may not open: the item read\'s 403, byte for byte', async () => {
        const { res } = await bundle('member', 'payroll');
        const single = await item('member', 'app', 'payroll');
        expect(single.statusCode).toBe(403);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual(single.body);
    });

    it('an unrecognised query parameter is a located 400 before anything is read', async () => {
        const { res, protocol } = await bundle('admin', 'crm', { query: { package: 'x' } });
        expect(res.statusCode).toBe(400);
        expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });
});
