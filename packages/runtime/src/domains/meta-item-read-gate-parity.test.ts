// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20193] The dispatcher's `/meta` item reads answer what `RestServer`'s
 * answer the same caller — because both ask ONE per-caller read gate.
 *
 * ## The defect this pins
 *
 * `handleMetadataRequest`'s two-segment item branch and its `/published`
 * branch applied no per-caller read gate: no ADR-0046 §6.7 docs audience, no
 * app nav filter (`requiredPermissions`, the unpublished gate, the docs-audience
 * entry arm), and on `/published` not even the ADR-0106 object mask its own
 * plain read runs. A host that mounts only the `${prefix}/*` catch-all —
 * `@objectstack/hono`'s `createHonoApp`, the documented embed shape, and any
 * thin adapter written on the public `HttpDispatcher` API — therefore served a
 * `{ permissionSet }`-gated doc body, a set-gated book, and an app's
 * `requiredPermissions`-gated nav entries to a member `RestServer` refuses or
 * prunes. Measured before the fix, through `dispatch()` (the catch-all's
 * delegate: identity resolution, the domain registry, this handler):
 *
 *     row                                    dispatcher        RestServer
 *     doc/crm_admin_runbook × non-holder     200 + body        403 PERMISSION_DENIED
 *     doc/…/published × non-holder           200 + body        403 PERMISSION_DENIED
 *     book/admin_guide × non-holder          200 + book        403 PERMISSION_DENIED
 *     app/crm × non-holder                   200, unpruned     200, pruned
 *
 * ## The fix, and why it is not a second resolver
 *
 * `RestServer`'s gate moved, unchanged, into `@objectstack/rest`'s
 * `meta-item-read-gate.ts`; `RestServer` and this dispatcher each hand it their
 * own I/O (the caller, the protocol reads, the security service) and render its
 * data verdict on their own wire. One gate, two callers — ruling `5793362670`
 * item 1 forbids a second audience resolver, and there is none: the cases below
 * drive the SAME fixtures through both transports and compare the answers.
 *
 * The four rows above are the card's; the rest are the gate's other arms
 * (a whole-refused app, an unpublished app, the per-deployment dashboard gate),
 * the object mask on both doors, and controls (a holder, an ungated type, an
 * anonymous caller).
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── Fixtures (the #20156 census's own) ────────────────────────────────────────

const DOC_SECRET = 'Rotate the tenant signing keys before every release.';
const BOOK_SECRET = 'Restricted spine: the incident playbooks.';

const ADMIN_GUIDE = {
    name: 'admin_guide',
    label: 'Admin Guide',
    description: BOOK_SECRET,
    audience: { permissionSet: 'crm_admin' },
    _packageId: 'crm',
    groups: [{ key: 'admin', label: 'Admin', include: 'crm_admin_*' }],
};
const HELP_CENTER = {
    name: 'help_center',
    label: 'Help Centre',
    audience: 'org',
    _packageId: 'crm',
    groups: [{ key: 'start', label: 'Start', include: 'crm_intro' }],
};
const DOCS = [
    { name: 'crm_intro', label: 'Getting started', content: 'Welcome aboard.', _packageId: 'crm' },
    { name: 'crm_admin_runbook', label: 'Admin runbook', content: DOC_SECRET, _packageId: 'crm' },
];
const CRM_APP = {
    name: 'crm',
    label: 'CRM',
    navigation: [
        { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
        { id: 'nav_finance_ledger', type: 'page', label: 'Ledger', pageName: 'ledger', requiredPermissions: ['finance.access'] },
        { id: 'nav_admin_runbook', type: 'doc', label: 'Admin runbook', doc: 'crm_admin_runbook' },
    ],
};
const PAYROLL_APP = {
    name: 'payroll',
    label: 'Payroll',
    requiredPermissions: ['payroll.access'],
    navigation: [{ id: 'nav_payroll_runs', type: 'page', label: 'Runs', pageName: 'payroll_runs' }],
};
const LAUNCHPAD_APP = {
    name: 'launchpad',
    label: 'Launchpad',
    _unpublished: true,
    navigation: [{ id: 'nav_launchpad_home', type: 'page', label: 'Home', pageName: 'launchpad_home' }],
};
const OPS_DASHBOARD = {
    name: 'ops',
    label: 'Operations',
    widgets: [
        { id: 'w_open_cases', type: 'metric', label: 'Open cases' },
        // Bound to an optional service this deployment does not register.
        { id: 'w_org_kpi', type: 'metric', label: 'Organizations', requiresService: 'tenancy' },
    ],
};
const INVOICE_OBJECT = {
    name: 'invoice',
    label: 'Invoice',
    fields: {
        amount: { type: 'number', label: 'Amount' },
        secret_margin: { type: 'number', label: 'Margin' },
    },
};
const LEADS_VIEW = { name: 'all_leads', label: 'All leads', object: 'lead', columns: ['name'] };

// [#22639] The list view and dashboard audience gate (ruling 6095014058,
// letter A): `requiredPermissions`, all required. The holder holds `LEGAL_CAP`.
const LEGAL_CAP = 'clm_legal_workbench.view';
const LEGAL_QUEUE_VIEW = {
    name: 'clm_contract.legal_queue', object: 'clm_contract', viewKind: 'list',
    config: { type: 'grid', columns: ['matter_ref'], requiredPermissions: [LEGAL_CAP] },
};
const CONTRACT_VIEWS = {
    name: 'clm_contract', object: 'clm_contract',
    list: { type: 'grid', columns: ['name'] },
    listViews: {
        mine: { type: 'grid', columns: ['name'] },
        legal_review: { type: 'grid', columns: ['matter_ref'], requiredPermissions: [LEGAL_CAP] },
    },
};
const LEGAL_BOARD = { name: 'legal_board', label: 'Legal board', requiredPermissions: [LEGAL_CAP], widgets: [{ id: 'w_open_matters', type: 'metric' }] };
const CONTRACT_OBJECT = {
    name: 'clm_contract', label: 'Contract',
    fields: { amount: { type: 'number', label: 'Amount' } },
    listViews: {
        mine: { type: 'grid', columns: ['amount'] },
        legal_desk: { type: 'grid', columns: ['amount'], requiredPermissions: [LEGAL_CAP] },
    },
};
/** A type no per-caller gate judges. */
const LEAD_FLOW = { name: 'lead_intake', label: 'Lead intake' };

const STORE: Record<string, any[]> = {
    book: [ADMIN_GUIDE, HELP_CENTER],
    doc: DOCS,
    app: [CRM_APP, PAYROLL_APP, LAUNCHPAD_APP],
    dashboard: [OPS_DASHBOARD, LEGAL_BOARD],
    object: [INVOICE_OBJECT, CONTRACT_OBJECT],
    view: [LEADS_VIEW, LEGAL_QUEUE_VIEW, CONTRACT_VIEWS],
    flow: [LEAD_FLOW],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const find = (type: unknown, name: unknown): any =>
    (STORE[singular(type)] ?? []).find((i: any) => i.name === name);

// ── Callers ───────────────────────────────────────────────────────────────────

interface Caller {
    ctx: { userId?: string; isSystem: false; systemPermissions: string[] };
    holdings: string[];
    readableFields: string[];
}
const CALLERS: Record<'holder' | 'non-holder' | 'anonymous', Caller> = {
    holder: {
        ctx: { userId: 'u_holder', isSystem: false, systemPermissions: ['finance.access', 'payroll.access', 'studio.access', LEGAL_CAP] },
        holdings: ['crm_admin'],
        readableFields: ['amount', 'secret_margin'],
    },
    'non-holder': {
        ctx: { userId: 'u_member', isSystem: false, systemPermissions: [] },
        holdings: [],
        readableFields: ['amount'],
    },
    anonymous: { ctx: { isSystem: false, systemPermissions: [] }, holdings: [], readableFields: [] },
};
type CallerName = keyof typeof CALLERS;

/** One protocol double, the same shape both transports read. */
function protocolDouble() {
    return {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORE) })),
        getMetaItems: vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            const layer = () => (found ? clone(found) : null);
            return { type: singular(type), name, code: layer(), overlay: layer(), effective: layer() };
        }),
    };
}

const securityFor = (caller: Caller) => ({
    resolvePermissionSetNames: async () => caller.holdings,
    getMetadataReadableFields: async () => caller.readableFields,
});

// ── The two transports ────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; body: any; served?: any }

/** The dispatcher, exactly as `createHonoApp` builds it: `new HttpDispatcher(kernel)`. */
function bootDispatcher(callerName: CallerName) {
    const caller = CALLERS[callerName];
    const protocol = protocolDouble();
    const services: Record<string, unknown> = {
        protocol,
        security: securityFor(caller),
        metadata: { getPublished: async (type: string, name: string) => clone(find(type, name)) },
    };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through; a context handed in is
    // overwritten by it, so the principal is supplied here (as the sibling
    // dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(caller.ctx);
    const read = async (path: string): Promise<Answer> => {
        const res = await dispatcher.dispatch('GET', path, undefined, {}, { request: { headers: {} } } as any);
        const status = res.response?.status ?? 0;
        const body = res.response?.body;
        const data = body?.data;
        // The item read serves the `{ type, name, item }` envelope; `/published`
        // serves the document itself.
        const served = status === 200 ? (path.endsWith('/published') ? data : data?.item) : undefined;
        return { status, code: body?.error?.code, body, served };
    };
    return { read, protocol };
}

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

/** `RestServer` over the same protocol double and the same caller — the reference answer. */
function bootRest(callerName: CallerName) {
    const caller = CALLERS[callerName];
    const rest: any = new RestServer(createMockServer() as any, protocolDouble() as any, {} as any);
    if (caller.ctx.userId) {
        const ctx = caller.ctx;
        rest.resolveExecCtx = async () => clone(ctx);
    }
    rest.securityServiceProvider = async () => securityFor(caller);
    // ADR-0057 D10 — `tenancy` is an optional service this deployment lacks.
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
    rest.metadataServiceProvider = async () => ({
        getPublished: async (type: string, name: string) => clone(find(type, name)),
    });
    rest.registerRoutes();
    const META = '/api/v1/meta';
    const read = async (type: string, name: string, suffix = ''): Promise<Answer> => {
        const routePath = suffix === '/published' ? `${META}/:type/:name/published` : `${META}/:type/:name`;
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === routePath);
        if (!route) throw new Error(`GET ${routePath} is not registered`);
        const res = makeRes();
        await route.handler({ method: 'GET', path: `${META}/${type}/${name}${suffix}`, params: { type, name }, query: {}, body: {}, headers: {} }, res);
        const served = res.statusCode === 200 ? (suffix === '/published' ? res.body : res.body?.item) : undefined;
        return { status: res.statusCode, code: res.body?.code ?? res.body?.error?.code, body: res.body, served };
    };
    return { read };
}

const text = (a: Answer): string => JSON.stringify(a.body ?? null);
const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);
const widgetIds = (doc: any): string[] => (doc?.widgets ?? []).map((w: any) => w.id);
const fieldNames = (doc: any): string[] => Object.keys(doc?.fields ?? {}).sort();
/** [#22639] A view container's or an object's list views, by key (`list` for a container's default). */
const listViewIds = (doc: any): string[] => [...(doc?.list ? ['list'] : []), ...Object.keys(doc?.listViews ?? {})];

// ── The rows ──────────────────────────────────────────────────────────────────

interface Row {
    type: string;
    name: string;
    /** Strings a caller the gate withholds them from must never receive. */
    secrets: string[];
    /** What `RestServer` answers the non-holder — asserted, so the reference cannot drift. */
    nonHolder: { status: number; code?: string; shape?: 'pruned' | 'masked' | 'deployment-pruned' | 'whole' };
}

const ROWS: Row[] = [
    // The card's four rows (the fourth on both doors).
    { type: 'doc', name: 'crm_admin_runbook', secrets: [DOC_SECRET], nonHolder: { status: 403, code: 'PERMISSION_DENIED' } },
    { type: 'book', name: 'admin_guide', secrets: [BOOK_SECRET], nonHolder: { status: 403, code: 'PERMISSION_DENIED' } },
    { type: 'app', name: 'crm', secrets: ['nav_finance_ledger', 'nav_admin_runbook'], nonHolder: { status: 200, shape: 'pruned' } },
    // The gate's other arms.
    { type: 'app', name: 'payroll', secrets: ['nav_payroll_runs'], nonHolder: { status: 403, code: 'PERMISSION_DENIED' } },
    { type: 'app', name: 'launchpad', secrets: ['nav_launchpad_home'], nonHolder: { status: 404, code: 'RESOURCE_NOT_FOUND' } },
    { type: 'dashboard', name: 'ops', secrets: [], nonHolder: { status: 200, shape: 'deployment-pruned' } },
    // The ADR-0106 object mask — the dispatcher's plain read already ran it;
    // its `/published` did not.
    { type: 'object', name: 'invoice', secrets: ['secret_margin'], nonHolder: { status: 200, shape: 'masked' } },
    // [#22639] The list view and dashboard audience gate: ONE view and a
    // dashboard refused whole (the app's whole refusal), a view container and
    // an object's own list views pruned.
    { type: 'view', name: 'clm_contract.legal_queue', secrets: ['matter_ref'], nonHolder: { status: 403, code: 'PERMISSION_DENIED' } },
    { type: 'view', name: 'clm_contract', secrets: ['legal_review', 'matter_ref'], nonHolder: { status: 200, shape: 'pruned' } },
    { type: 'dashboard', name: 'legal_board', secrets: ['w_open_matters'], nonHolder: { status: 403, code: 'PERMISSION_DENIED' } },
    { type: 'object', name: 'clm_contract', secrets: ['legal_desk'], nonHolder: { status: 200, shape: 'pruned' } },
    // Controls: an ungated doc, a view that names no capability (no key,
    // served to all), and [#22639] a type no gate judges (`view` now is one).
    { type: 'doc', name: 'crm_intro', secrets: [], nonHolder: { status: 200, shape: 'whole' } },
    { type: 'view', name: 'all_leads', secrets: [], nonHolder: { status: 200, shape: 'whole' } },
    { type: 'flow', name: 'lead_intake', secrets: [], nonHolder: { status: 200, shape: 'whole' } },
];

const DOORS = ['', '/published'] as const;

describe('[#20193] the reference: RestServer answers the non-holder as each row declares', () => {
    for (const row of ROWS) {
        for (const door of DOORS) {
            it(`${row.type}/${row.name}${door}`, async () => {
                const rest = await bootRest('non-holder').read(row.type, row.name, door);
                expect(rest.status).toBe(row.nonHolder.status);
                if (row.nonHolder.code) expect(rest.code).toBe(row.nonHolder.code);
            });
        }
    }
});

describe('[#20193] the dispatcher answers every caller what RestServer answers — the same status, the same code, the same document', () => {
    for (const row of ROWS) {
        for (const door of DOORS) {
            for (const callerName of Object.keys(CALLERS) as CallerName[]) {
                it(`GET /meta/${row.type}/${row.name}${door} × ${callerName}`, async () => {
                    const dispatcher = await bootDispatcher(callerName).read(`/meta/${row.type}/${row.name}${door}`);
                    const rest = await bootRest(callerName).read(row.type, row.name, door);

                    // The ADR-0112 minimum, both halves: the status and the machine code.
                    expect({ status: dispatcher.status, code: dispatcher.code })
                        .toEqual({ status: rest.status, code: rest.code });

                    if (rest.status !== 200) {
                        for (const s of row.secrets) expect(text(dispatcher)).not.toContain(s);
                        return;
                    }
                    // Served: the same document, pruned / masked the same way.
                    expect(navIds(dispatcher.served)).toEqual(navIds(rest.served));
                    expect(widgetIds(dispatcher.served)).toEqual(widgetIds(rest.served));
                    expect(fieldNames(dispatcher.served)).toEqual(fieldNames(rest.served));
                    expect(listViewIds(dispatcher.served)).toEqual(listViewIds(rest.served));
                    for (const s of row.secrets) {
                        if (text(rest).includes(s)) expect(text(dispatcher)).toContain(s);
                        else expect(text(dispatcher)).not.toContain(s);
                    }
                });
            }
        }
    }
});

describe('[#20193] controls', () => {
    it('a holder reads the gated doc body, the set-gated book and the whole app through the dispatcher', async () => {
        const { read } = bootDispatcher('holder');
        const doc = await read('/meta/doc/crm_admin_runbook');
        const published = await read('/meta/doc/crm_admin_runbook/published');
        const book = await read('/meta/book/admin_guide');
        const app = await read('/meta/app/crm');
        expect(doc.status).toBe(200);
        expect(doc.served?.content).toBe(DOC_SECRET);
        expect(published.status).toBe(200);
        expect(published.served?.content).toBe(DOC_SECRET);
        expect(book.status).toBe(200);
        expect(book.served?.description).toBe(BOOK_SECRET);
        expect(navIds(app.served)).toEqual(navIds(CRM_APP));
    });

    it('an object read is still masked for the non-holder, and served whole to the exempt holder', async () => {
        const member = await bootDispatcher('non-holder').read('/meta/object/invoice');
        const holder = await bootDispatcher('holder').read('/meta/object/invoice');
        expect(fieldNames(member.served)).toEqual(['amount']);
        expect(fieldNames(holder.served)).toEqual(['amount', 'secret_margin']);
    });

    it('an unauthenticated caller keeps its existing answer: 401 UNAUTHENTICATED — before any read for every type but doc and book', async () => {
        const { read, protocol } = bootDispatcher('anonymous');
        const res = await read('/meta/app/crm');
        expect({ status: res.status, code: res.code }).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });

    it('[#20320] …and for a gated doc, from the ADR-0046 §6.7 audience gate, as on RestServer: reachability is not authorization', async () => {
        const { read } = bootDispatcher('anonymous');
        const res = await read('/meta/doc/crm_admin_runbook');
        expect({ status: res.status, code: res.code }).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
        expect(text(res)).not.toContain(DOC_SECRET);
    });

    it('the plural spelling is the same read, gated the same way', async () => {
        const res = await bootDispatcher('non-holder').read('/meta/docs/crm_admin_runbook');
        expect({ status: res.status, code: res.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(text(res)).not.toContain(DOC_SECRET);
    });

    it('an unpublished app answers exactly what a name with nothing behind it answers on this transport (ADR-0045 §3)', async () => {
        const { read } = bootDispatcher('non-holder');
        const unpublished = await read('/meta/app/launchpad');
        const missing = await read('/meta/app/no_such_app');
        expect(unpublished.status).toBe(404);
        expect(unpublished.body).toEqual(missing.body);
    });
});
