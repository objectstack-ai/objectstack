// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22639] The `/meta` read gate applies a list view's and a dashboard's
 * `requiredPermissions` — the rest half of ruling 6095014058 (letter A): "The
 * `/meta` read gate applies it on the list read and the by-name read of both
 * types, so `GET /api/v1/meta/view` returns only the views the caller may see,
 * and a dashboard's direct URL is refused by the server".
 *
 * Pinned per audience — holder served, non-holder not served, no key served to
 * all — on the reads this file owns: the LIST read of `view` (the console's
 * view switcher, `?object=`), `dashboard` and `object` (an object's own
 * `listViews`), the by-name refusal's envelope, and the plain read's CACHED arm,
 * whose validator must vary with what the gate withheld. Every alternate door of
 * the by-name read is pinned by the census, `meta-alternate-door-read-gates.test.ts`;
 * the runtime dispatcher's parity, by the two read-gate parity tests in
 * `@objectstack/runtime`.
 */

import { describe, it, expect, vi } from 'vitest';
// Explicit `.js` extension: NodeNext resolution (see the sibling nav-gate tests).
import { RestServer } from './rest-server.js';
import { holdsRequiredPermissions } from './meta-item-read-gate.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LEGAL_CAP = 'clm_legal_workbench.view';

/** A view container: the default `list` and `mine` open, `legal_review` gated. */
const CONTRACT_VIEWS = {
    name: 'clm_contract',
    object: 'clm_contract',
    list: { type: 'grid', columns: ['name'], label: 'All contracts' },
    listViews: {
        mine: { type: 'grid', columns: ['name'], label: 'My contracts' },
        legal_review: { type: 'grid', columns: ['matter_ref'], label: 'Legal review', requiredPermissions: [LEGAL_CAP] },
    },
};
/** The items the registry expands that container into, plus ONE gated view item of its own. */
const VIEW_ITEMS = [
    { name: 'clm_contract.mine', object: 'clm_contract', viewKind: 'list', order: 0, config: CONTRACT_VIEWS.listViews.mine },
    { name: 'clm_contract.legal_review', object: 'clm_contract', viewKind: 'list', order: 1, config: CONTRACT_VIEWS.listViews.legal_review },
    { name: 'clm_contract.default', object: 'clm_contract', viewKind: 'list', order: 2, isDefault: true, config: CONTRACT_VIEWS.list },
    {
        name: 'clm_contract.legal_queue', object: 'clm_contract', viewKind: 'list', order: 3,
        config: { type: 'grid', columns: ['matter_ref'], requiredPermissions: [LEGAL_CAP] },
    },
    // A flattened list view (the overlay arm): the key at the top level.
    { name: 'clm_contract.legal_overlay', object: 'clm_contract', viewKind: 'list', order: 4, type: 'grid', requiredPermissions: [LEGAL_CAP] },
];
/** The control: a view that names no capability. */
const ALL_LEADS = { name: 'lead.all', object: 'lead', viewKind: 'list', order: 0, config: { type: 'grid', columns: ['name'] } };

const LEGAL_BOARD = { name: 'legal_board', label: 'Legal board', requiredPermissions: [LEGAL_CAP], widgets: [{ id: 'w_open_matters', type: 'metric' }] };
const OPS_BOARD = { name: 'ops', label: 'Operations', widgets: [{ id: 'w_open_cases', type: 'metric' }] };
const CRM_APP_GATED = { name: 'payroll', label: 'Payroll', requiredPermissions: ['payroll.access'], navigation: [] };

const CONTRACT_OBJECT = {
    name: 'clm_contract',
    label: 'Contract',
    fields: { amount: { type: 'number', label: 'Amount' } },
    listViews: {
        mine: { type: 'grid', columns: ['amount'], label: 'My contracts' },
        legal_desk: { type: 'grid', columns: ['amount'], label: 'Legal desk', requiredPermissions: [LEGAL_CAP] },
    },
};

const STORE: Record<string, any[]> = {
    view: [CONTRACT_VIEWS, ...VIEW_ITEMS, ALL_LEADS],
    dashboard: [LEGAL_BOARD, OPS_BOARD],
    object: [CONTRACT_OBJECT],
    app: [CRM_APP_GATED],
};

// ── Callers ───────────────────────────────────────────────────────────────────

const CALLERS = {
    holder: { userId: 'u_legal', systemPermissions: [LEGAL_CAP] },
    'non-holder': { userId: 'u_member', systemPermissions: [] as string[] },
    // May write metadata (ADR-0106 D4 exempts them on the object read), holds no capability.
    author: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
} as const;
type CallerName = keyof typeof CALLERS;

// ── Harness ───────────────────────────────────────────────────────────────────

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const find = (type: unknown, name: unknown): any => (STORE[singular(type)] ?? []).find((i: any) => i.name === name);
const etagOf = (type: string, name: string) => `etag-${type}-${name}`;

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.send = vi.fn(() => res);
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

function setup(who: CallerName) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: Object.keys(STORE) }),
        getMetaItems: vi.fn(async ({ type }: any) => ({ type: singular(type), items: clone(STORE[singular(type)] ?? []) })),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        // The shared cache's read: the UNGATED document, under a validator that
        // hashes the stored body — and it answers a matching `If-None-Match`
        // itself, so a gated type that let it judge would be answered a `304`
        // for a body the caller may no longer be served.
        getMetaItemCached: vi.fn(async ({ type, name, cacheRequest }: any) => {
            const value = etagOf(singular(type), name);
            if (cacheRequest?.ifNoneMatch === `"${value}"`) return { notModified: true };
            return { data: clone(find(type, name)), etag: { value, weak: false } };
        }),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, {} as any);
    rest.resolveExecCtx = async () => clone(CALLERS[who]);
    rest.securityServiceProvider = async () => ({
        resolvePermissionSetNames: async () => [],
        getMetadataReadableFields: async () => ['amount'],
    });
    rest.serviceExistsProvider = () => true;
    rest.registerRoutes();
    return { rest, protocol };
}

const META = '/api/v1/meta';

async function list(who: CallerName, type: string, query: Record<string, string> = {}) {
    const { rest } = setup(who);
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}/:type`);
    const res = makeRes();
    await route.handler({ method: 'GET', path: `${META}/${type}`, params: { type }, query, body: {}, headers: {} }, res);
    return res;
}

async function item(who: CallerName, type: string, name: string, headers: Record<string, string> = {}) {
    const { rest, protocol } = setup(who);
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}/:type/:name`);
    const res = makeRes();
    await route.handler({ method: 'GET', path: `${META}/${type}/${name}`, params: { type, name }, query: {}, body: {}, headers }, res);
    return { res, protocol };
}

const itemsOf = (res: any): any[] => (Array.isArray(res.body) ? res.body : res.body?.items ?? []);
const names = (res: any): string[] => itemsOf(res).map((i: any) => i?.name);
const text = (res: any): string => JSON.stringify(res.body ?? null);
/** The ADR-0112 minimum: the status and the machine code. */
const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });

// ── The predicate ─────────────────────────────────────────────────────────────

describe('[#22639] THE predicate: every capability named, all required — the app arm\'s own', () => {
    it('serves a holder of EVERY capability, and refuses a holder of only some (no any-of)', () => {
        const required = ['clm_legal.access', 'clm_admin.access'];
        expect(holdsRequiredPermissions(required, new Set(required))).toBe(true);
        expect(holdsRequiredPermissions(required, new Set(['clm_legal.access']))).toBe(false);
        expect(holdsRequiredPermissions(required, new Set(['clm_admin.access']))).toBe(false);
    });

    it('absent or empty is no gate', () => {
        expect(holdsRequiredPermissions(undefined, new Set())).toBe(true);
        expect(holdsRequiredPermissions([], new Set())).toBe(true);
    });

    it('the app arm asks it: the app the predicate refuses is the app the by-name read refuses', async () => {
        expect(holdsRequiredPermissions(CRM_APP_GATED.requiredPermissions, new Set(CALLERS['non-holder'].systemPermissions))).toBe(false);
        const { res } = await item('non-holder', 'app', 'payroll');
        expect(envelope(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });
});

// ── The list read ─────────────────────────────────────────────────────────────

describe('[#22639] GET /meta/view — only the views the caller may see', () => {
    it('holder: every view, the container whole', async () => {
        const res = await list('holder', 'view');
        expect(res.statusCode).toBe(200);
        expect(names(res)).toEqual(STORE.view.map((v) => v.name));
        const container = itemsOf(res).find((v: any) => v.name === 'clm_contract');
        expect(Object.keys(container.listViews)).toEqual(['mine', 'legal_review']);
    });

    it('non-holder: the gated view items left out, the container served minus its gated entry — the rest untouched', async () => {
        const res = await list('non-holder', 'view');
        expect(res.statusCode).toBe(200);
        expect(names(res)).toEqual(['clm_contract', 'clm_contract.mine', 'clm_contract.default', 'lead.all']);
        const container = itemsOf(res).find((v: any) => v.name === 'clm_contract');
        expect(Object.keys(container.listViews)).toEqual(['mine']);
        expect(container.list).toEqual(CONTRACT_VIEWS.list);
        expect(text(res)).not.toContain('matter_ref');
        expect(text(res)).not.toContain(LEGAL_CAP);
    });

    it('the console\'s view switcher (`?object=`) lists only what the caller may open', async () => {
        expect(names(await list('holder', 'view', { object: 'clm_contract' }))).toEqual([
            'clm_contract.mine', 'clm_contract.legal_review', 'clm_contract.default',
            'clm_contract.legal_queue', 'clm_contract.legal_overlay',
        ]);
        expect(names(await list('non-holder', 'view', { object: 'clm_contract' }))).toEqual([
            'clm_contract.mine', 'clm_contract.default',
        ]);
    });

    it('no key, served to all: a view that names no capability reaches every caller', async () => {
        for (const who of Object.keys(CALLERS) as CallerName[]) {
            expect(names(await list(who, 'view', { object: 'lead' })), who).toEqual(['lead.all']);
        }
    });
});

describe('[#22639] GET /meta/dashboard — only the dashboards the caller may open', () => {
    it('holder: both; non-holder and author: the gated board left out, the ungated one served', async () => {
        expect(names(await list('holder', 'dashboard'))).toEqual(['legal_board', 'ops']);
        for (const who of ['non-holder', 'author'] as const) {
            const res = await list(who, 'dashboard');
            expect(names(res), who).toEqual(['ops']);
            expect(text(res), who).not.toContain('w_open_matters');
        }
    });
});

describe('[#22639] GET /meta/object — an object\'s own list views', () => {
    it('non-holder: the gated list view pruned; holder: whole', async () => {
        const member = itemsOf(await list('non-holder', 'object'));
        expect(Object.keys(member[0].listViews)).toEqual(['mine']);
        const holder = itemsOf(await list('holder', 'object'));
        expect(Object.keys(holder[0].listViews)).toEqual(['mine', 'legal_desk']);
    });

    it('ADR-0106 D4: a caller who may write the schema reads every list view, as they read every field', async () => {
        const author = itemsOf(await list('author', 'object'));
        expect(Object.keys(author[0].listViews)).toEqual(['mine', 'legal_desk']);
    });
});

// ── The by-name refusal ───────────────────────────────────────────────────────

describe('[#22639] the by-name read: a list view or a dashboard the caller does not hold is refused WHOLE — the app arm\'s whole refusal', () => {
    for (const [type, name] of [
        ['view', 'clm_contract.legal_queue'],
        ['view', 'clm_contract.legal_overlay'],
        ['dashboard', 'legal_board'],
    ] as const) {
        it(`${type}/${name}: non-holder refused 403 PERMISSION_DENIED in the app's envelope; holder served`, async () => {
            const refused = (await item('non-holder', type, name)).res;
            expect(envelope(refused)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
            // The app's whole refusal, written by the same emitter: the same
            // envelope keys, only the message names the item.
            const app = (await item('non-holder', 'app', 'payroll')).res;
            expect(Object.keys(refused.body).sort()).toEqual(Object.keys(app.body).sort());
            expect(Object.keys(refused.body.error).sort()).toEqual(Object.keys(app.body.error).sort());
            expect(text(refused)).not.toContain('matter_ref');
            expect(text(refused)).not.toContain('w_open_matters');

            const served = (await item('holder', type, name)).res;
            expect(served.statusCode).toBe(200);
            expect(served.body?.item?.name).toBe(name);
        });
    }

    it('a dashboard\'s direct URL is refused to an author too — the refusal is whole, author or not', async () => {
        expect(envelope((await item('author', 'dashboard', 'legal_board')).res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });
});

// ── The cached arm ────────────────────────────────────────────────────────────

describe('[#22639] the plain read\'s cached arm: gated, and its validator varies with what the gate withheld', () => {
    it('a container: the non-holder is served it pruned under a DIFFERENT ETag than the holder\'s whole one', async () => {
        const holder = (await item('holder', 'view', 'clm_contract')).res;
        const member = (await item('non-holder', 'view', 'clm_contract')).res;
        expect(holder.statusCode).toBe(200);
        expect(member.statusCode).toBe(200);
        expect(Object.keys(holder.body.item.listViews)).toEqual(['mine', 'legal_review']);
        expect(Object.keys(member.body.item.listViews)).toEqual(['mine']);
        // Nothing withheld folds nothing: the holder's validator is the store's.
        expect(holder.headers.ETag).toBe(`"${etagOf('view', 'clm_contract')}"`);
        expect(member.headers.ETag).not.toBe(holder.headers.ETag);
    });

    it('a caller who no longer holds the capability is never answered a 304 for the body that carried it', async () => {
        const stale = `"${etagOf('view', 'clm_contract')}"`;
        const { res, protocol } = await item('non-holder', 'view', 'clm_contract', { 'if-none-match': stale });
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.body.item.listViews)).toEqual(['mine']);
        // The protocol was never asked to judge the conditional request.
        expect(protocol.getMetaItemCached.mock.calls[0][0].cacheRequest.ifNoneMatch).toBeUndefined();
    });

    it('…and ONE gated view is refused, never a 304, whatever validator the caller holds', async () => {
        const stale = `"${etagOf('view', 'clm_contract.legal_queue')}"`;
        const { res } = await item('non-holder', 'view', 'clm_contract.legal_queue', { 'if-none-match': stale });
        expect(envelope(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });

    it('control: a matching validator is still a 304 — for the holder\'s whole body and for the non-holder\'s pruned one', async () => {
        const holder = (await item('holder', 'view', 'clm_contract')).res;
        expect((await item('holder', 'view', 'clm_contract', { 'if-none-match': holder.headers.ETag })).res.statusCode).toBe(304);
        const member = (await item('non-holder', 'view', 'clm_contract')).res;
        expect((await item('non-holder', 'view', 'clm_contract', { 'if-none-match': member.headers.ETag })).res.statusCode).toBe(304);
    });

    it('an object: its gated list view pruned for the non-holder under its own validator, served whole to the D4-exempt author', async () => {
        const member = (await item('non-holder', 'object', 'clm_contract')).res;
        const author = (await item('author', 'object', 'clm_contract')).res;
        expect(Object.keys(member.body.item.listViews)).toEqual(['mine']);
        expect(Object.keys(author.body.item.listViews)).toEqual(['mine', 'legal_desk']);
        expect(member.headers.ETag).not.toBe(author.headers.ETag);
        const stale = (await item('non-holder', 'object', 'clm_contract', { 'if-none-match': author.headers.ETag })).res;
        expect(stale.statusCode).toBe(200);
        expect(Object.keys(stale.body.item.listViews)).toEqual(['mine']);
    });
});
