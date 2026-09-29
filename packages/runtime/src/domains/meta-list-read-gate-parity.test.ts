// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20237] The dispatcher's `/meta/:type` LIST answers what `RestServer`'s
 * `GET /meta/:type` answers the same caller — because both ask ONE per-caller
 * list gate.
 *
 * ## The defect this pins
 *
 * `handleMetadataRequest`'s one-segment list branch read `getMetaItems` and
 * served the result through the doc slim alone: no ADR-0046 §6.7 doc or book
 * audience, no app nav filter (`requiredPermissions`, the unpublished gate, the
 * docs-audience entry arm), no ADR-0057 D10 dashboard widget gate — and on its
 * two fallback exits (the `MetadataService` list and the ObjectQL registry) not
 * even the ADR-0106 object mask its protocol exit runs. A host that mounts only
 * the `${prefix}/*` catch-all (`createHonoApp`, and any thin adapter on the
 * public `HttpDispatcher` API) therefore listed, to a member `RestServer`
 * prunes, a `{ permissionSet }`-gated doc WITH its body, a set-gated book, and
 * every app with its gated entries. Measured before the fix, through
 * `dispatch()` (the catch-all's delegate), for a member without `crm_admin`:
 *
 *     row                           dispatcher                          RestServer
 *     doc?include=content           crm_intro + crm_admin_runbook+body  crm_intro
 *     book                          admin_guide + help_center           help_center
 *     app                           crm (3 entries), payroll, launchpad crm [nav_leads]
 *     dashboard (any caller)        ops [w_open_cases, w_org_kpi]       ops [w_open_cases]
 *
 * ## The fix, and why it is not a second resolver
 *
 * `RestServer`'s list filters moved, unchanged, into `createMetaListReadGate`
 * (`@objectstack/rest`'s `meta-item-read-gate.ts`, beside the item gate);
 * `RestServer`'s list route and this dispatcher's list branch each hand it
 * their own I/O and rewrap its answer in their own list envelope. One gate, two
 * callers — ruling `5793362670` item 1 forbids a second audience resolver, and
 * there is none: the cases below drive the SAME fixtures through both
 * transports and compare the answers.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── Fixtures (the #20193 parity pin's, as lists) ──────────────────────────────

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

const STORE: Record<string, any[]> = {
    book: [ADMIN_GUIDE, HELP_CENTER],
    doc: DOCS,
    app: [CRM_APP, PAYROLL_APP, LAUNCHPAD_APP],
    dashboard: [OPS_DASHBOARD],
    object: [INVOICE_OBJECT],
    view: [LEADS_VIEW],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

// ── Callers ───────────────────────────────────────────────────────────────────

interface Caller {
    ctx: { userId?: string; isSystem: false; systemPermissions: string[] };
    holdings: string[];
    readableFields: string[];
}
const CALLERS: Record<'holder' | 'non-holder' | 'anonymous', Caller> = {
    holder: {
        ctx: { userId: 'u_holder', isSystem: false, systemPermissions: ['finance.access', 'payroll.access', 'studio.access'] },
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

/**
 * One protocol double, the same shape both transports read. `unansweredTypes`
 * makes `getMetaItems` answer NO list for those types — the one protocol
 * answer that sends the dispatcher on to its fallback stores — while it still
 * answers every other type, the books the doc audience reads included.
 *
 * [#20590] Not a throw. A protocol throw is a fault and is answered as itself
 * (`meta-list-protocol-fault.test.ts`); it used to be read as "the protocol
 * does not know this type", which the one real protocol never signals that
 * way — it answers such a type with an empty list.
 */
function protocolDouble(unansweredTypes: string[] = []) {
    return {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORE) })),
        getMetaItems: vi.fn(async ({ type }: any) => {
            if (unansweredTypes.includes(singular(type))) return undefined;
            return clone(STORE[singular(type)] ?? []);
        }),
    };
}

const securityFor = (caller: Caller) => ({
    resolvePermissionSetNames: async () => caller.holdings,
    getMetadataReadableFields: async () => caller.readableFields,
});

// ── The two transports ────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; body: any; items?: any[] }

const itemsOf = (data: any): any[] | undefined =>
    Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : undefined;

/** The dispatcher, exactly as `createHonoApp` builds it: `new HttpDispatcher(kernel)`. */
function bootDispatcher(
    callerName: CallerName,
    opts: { protocol?: any; extra?: Record<string, unknown> } = {},
) {
    const caller = CALLERS[callerName];
    const protocol = opts.protocol ?? protocolDouble();
    const services: Record<string, unknown> = { protocol, security: securityFor(caller), ...opts.extra };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through; a context handed in is
    // overwritten by it, so the principal is supplied here (as the sibling
    // dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(caller.ctx);
    const list = async (type: string, query: Record<string, string> = {}): Promise<Answer> => {
        const res = await dispatcher.dispatch('GET', `/meta/${type}`, undefined, query, { request: { headers: {} } } as any);
        const status = res.response?.status ?? 0;
        const body = res.response?.body;
        return { status, code: body?.error?.code, body, items: status === 200 ? itemsOf(body?.data) : undefined };
    };
    return { list, protocol };
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

/** `RestServer`'s `GET /meta/:type` over the same protocol double and the same caller — the reference answer. */
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
    rest.registerRoutes();
    const META = '/api/v1/meta';
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}/:type`);
    if (!route) throw new Error(`GET ${META}/:type is not registered`);
    const list = async (type: string, query: Record<string, string> = {}): Promise<Answer> => {
        const res = makeRes();
        await route.handler({ method: 'GET', path: `${META}/${type}`, params: { type }, query, body: {}, headers: {} }, res);
        const status = res.statusCode;
        return { status, code: res.body?.code ?? res.body?.error?.code, body: res.body, items: status === 200 ? itemsOf(res.body) : undefined };
    };
    return { list };
}

const text = (a: Answer): string => JSON.stringify(a.body ?? null);
const names = (items: any[] | undefined): string[] => (items ?? []).map((i: any) => i?.name);
/** Per item, what the gates decide: nav entries, widgets, fields, and whether a body is served. */
const shape = (items: any[] | undefined) => (items ?? []).map((i: any) => ({
    name: i?.name,
    nav: Array.isArray(i?.navigation) ? i.navigation.map((e: any) => e.id) : undefined,
    widgets: Array.isArray(i?.widgets) ? i.widgets.map((w: any) => w.id) : undefined,
    fields: i?.fields ? Object.keys(i.fields).sort() : undefined,
    body: i && typeof i === 'object' && 'content' in i,
}));

// ── The rows ──────────────────────────────────────────────────────────────────

interface Row {
    /** The `:type` segment as a client spells it — the plural is the same read. */
    type: string;
    query?: Record<string, string>;
    /** Strings a caller the gate withholds them from must never receive. */
    secrets: string[];
    /** What `RestServer` lists for the non-holder — asserted, so the reference cannot drift. */
    nonHolder: string[];
}

const ROWS: Row[] = [
    // The card's three rows.
    { type: 'doc', query: { include: 'content' }, secrets: [DOC_SECRET, 'crm_admin_runbook'], nonHolder: ['crm_intro'] },
    { type: 'book', secrets: [BOOK_SECRET, 'admin_guide'], nonHolder: ['help_center'] },
    { type: 'app', secrets: ['nav_finance_ledger', 'nav_admin_runbook', 'payroll', 'launchpad'], nonHolder: ['crm'] },
    // The gate's other arms and spellings.
    { type: 'doc', secrets: ['crm_admin_runbook'], nonHolder: ['crm_intro'] },
    { type: 'docs', query: { include: 'content' }, secrets: [DOC_SECRET, 'crm_admin_runbook'], nonHolder: ['crm_intro'] },
    { type: 'books', secrets: [BOOK_SECRET, 'admin_guide'], nonHolder: ['help_center'] },
    { type: 'apps', secrets: ['nav_finance_ledger', 'nav_admin_runbook', 'payroll', 'launchpad'], nonHolder: ['crm'] },
    { type: 'dashboard', secrets: ['w_org_kpi'], nonHolder: ['ops'] },
    // The ADR-0106 object mask — the dispatcher's protocol exit already ran it.
    { type: 'object', secrets: ['secret_margin'], nonHolder: ['invoice'] },
    { type: 'objects', secrets: ['secret_margin'], nonHolder: ['invoice'] },
    // Control: an ungated type.
    { type: 'view', secrets: [], nonHolder: ['all_leads'] },
];

const label = (row: Row): string =>
    `GET /meta/${row.type}${row.query ? `?${new URLSearchParams(row.query)}` : ''}`;

describe('[#20237] the reference: RestServer lists for the non-holder what each row declares', () => {
    for (const row of ROWS) {
        it(label(row), async () => {
            const rest = await bootRest('non-holder').list(row.type, row.query);
            expect(rest.status).toBe(200);
            expect(names(rest.items)).toEqual(row.nonHolder);
            for (const s of row.secrets) expect(text(rest)).not.toContain(s);
        });
    }
});

describe('[#20237] the dispatcher lists for every caller what RestServer lists — the same status, the same items, pruned the same way', () => {
    for (const row of ROWS) {
        for (const callerName of ['holder', 'non-holder'] as const) {
            it(`${label(row)} × ${callerName}`, async () => {
                const dispatcher = await bootDispatcher(callerName).list(row.type, row.query);
                const rest = await bootRest(callerName).list(row.type, row.query);

                // The ADR-0112 minimum, both halves: the status and the machine code.
                expect({ status: dispatcher.status, code: dispatcher.code })
                    .toEqual({ status: rest.status, code: rest.code });
                expect(dispatcher.status).toBe(200);
                // The same items, each pruned / masked / projected the same way.
                expect(shape(dispatcher.items)).toEqual(shape(rest.items));
                for (const s of row.secrets) {
                    if (text(rest).includes(s)) expect(text(dispatcher)).toContain(s);
                    else expect(text(dispatcher)).not.toContain(s);
                }
            });
        }
    }
});

describe('[#20237] controls', () => {
    it('a holder lists the gated doc WITH its body, the set-gated book and every app whole through the dispatcher', async () => {
        const { list } = bootDispatcher('holder');
        const docs = await list('doc', { include: 'content' });
        const books = await list('book');
        const apps = await list('app');
        expect(names(docs.items)).toEqual(['crm_intro', 'crm_admin_runbook']);
        expect(text(docs)).toContain(DOC_SECRET);
        expect(names(books.items)).toEqual(['admin_guide', 'help_center']);
        expect(text(books)).toContain(BOOK_SECRET);
        expect(shape(apps.items).map((a) => [a.name, a.nav])).toEqual([
            ['crm', ['nav_leads', 'nav_finance_ledger', 'nav_admin_runbook']],
            ['payroll', ['nav_payroll_runs']],
            ['launchpad', ['nav_launchpad_home']],
        ]);
    });

    it('an unauthenticated caller keeps its existing answer on every list but doc and book: 401 UNAUTHENTICATED, before any read', async () => {
        for (const row of ROWS.filter((r) => !['doc', 'book'].includes(singular(r.type)))) {
            const { list, protocol } = bootDispatcher('anonymous');
            const res = await list(row.type, row.query);
            expect({ status: res.status, code: res.code }, label(row)).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
            for (const s of row.secrets) expect(text(res), label(row)).not.toContain(s);
            expect(protocol.getMetaItems, label(row)).not.toHaveBeenCalled();
        }
    });

    it('[#20320] …and on doc and book lists answers what RestServer answers: the public ones (none here), never gated content', async () => {
        for (const row of ROWS.filter((r) => ['doc', 'book'].includes(singular(r.type)))) {
            const dispatcher = await bootDispatcher('anonymous').list(row.type, row.query);
            const rest = await bootRest('anonymous').list(row.type, row.query);
            expect({ status: rest.status, items: rest.items }, label(row)).toEqual({ status: 200, items: [] });
            expect({ status: dispatcher.status, items: dispatcher.items }, label(row)).toEqual({ status: 200, items: [] });
            for (const s of row.secrets) expect(text(dispatcher), label(row)).not.toContain(s);
        }
    });

    it('a doc list whose audience input cannot be read is answered as that fault — never the unfiltered list', async () => {
        const protocol = protocolDouble();
        const listed = protocol.getMetaItems.getMockImplementation()!;
        protocol.getMetaItems.mockImplementation(async (req: any) => {
            if (singular(req?.type) === 'book') throw Object.assign(new Error('metadata store unavailable'), { status: 503 });
            return listed(req);
        });
        const res = await bootDispatcher('non-holder', { protocol }).list('doc', { include: 'content' });
        expect(res.status).toBe(503);
        expect(res.body?.success).toBe(false);
        expect(text(res)).not.toContain(DOC_SECRET);
        expect(text(res)).not.toContain('crm_intro');
    });
});

// ── Every exit of the list branch, not just the first ─────────────────────────

describe('[#20237] the fallback exits are gated too — the protocol exit is not the only door', () => {
    /** The runtime metadata service's list, answering the same store. */
    const metadataService = () => ({ list: vi.fn(async (type: string) => clone(STORE[singular(type)] ?? [])) });

    it('the MetadataService exit: the non-holder is served the pruned doc, book and app lists and the masked objects', async () => {
        for (const [type, expected, secrets] of [
            ['doc', [{ name: 'crm_intro', body: true }], [DOC_SECRET, 'crm_admin_runbook']],
            ['book', [{ name: 'help_center', body: false }], [BOOK_SECRET, 'admin_guide']],
            ['app', [{ name: 'crm', body: false }], ['nav_finance_ledger', 'payroll', 'launchpad']],
        ] as const) {
            const metadata = metadataService();
            const { list } = bootDispatcher('non-holder', {
                protocol: protocolDouble([type]),
                extra: { metadata },
            });
            const res = await list(type, { include: 'content' });
            expect(metadata.list, type).toHaveBeenCalledWith(type);
            expect(res.status, type).toBe(200);
            expect(shape(res.items).map(({ name, body }) => ({ name, body })), type).toEqual(expected);
            for (const s of secrets) expect(text(res), type).not.toContain(s);
        }
        const metadata = metadataService();
        const objects = await bootDispatcher('non-holder', { protocol: protocolDouble(['object']), extra: { metadata } })
            .list('object');
        expect(metadata.list).toHaveBeenCalledWith('object');
        expect(shape(objects.items).map((o) => o.fields)).toEqual([['amount']]);
        expect(text(objects)).not.toContain('secret_margin');
    });

    it('the ObjectQL registry exit: the object list is masked for the non-holder', async () => {
        const registry = {
            getAllObjects: vi.fn(() => clone(STORE.object)),
            listItems: vi.fn((type: string) => clone(STORE[singular(type)] ?? [])),
            getObject: vi.fn(() => undefined),
        };
        const { list } = bootDispatcher('non-holder', {
            protocol: protocolDouble(['object']),
            extra: { objectql: { registry } },
        });
        const res = await list('object');
        expect(registry.listItems).toHaveBeenCalledWith('object', undefined);
        expect(shape(res.items).map((o) => o.fields)).toEqual([['amount']]);
        expect(text(res)).not.toContain('secret_margin');
    });

    it('control: the holder is served every fallback list whole', async () => {
        const metadata = metadataService();
        const { list } = bootDispatcher('holder', { protocol: protocolDouble(['doc']), extra: { metadata } });
        const res = await list('doc', { include: 'content' });
        expect(names(res.items)).toEqual(['crm_intro', 'crm_admin_runbook']);
        expect(text(res)).toContain(DOC_SECRET);
    });
});
