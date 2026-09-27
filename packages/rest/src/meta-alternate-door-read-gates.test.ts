// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20156] THE CENSUS — every alternate read door of `GET /meta/:type/:name`
 * answers what the plain read answers for the same caller, or refuses.
 *
 * The plain single-item read applies a per-caller read gate for four kinds of
 * document: the ADR-0046 §6.7 docs audience (`doc`, `book`), the app nav filter
 * (`app`: `requiredPermissions`, the unpublished gate, the docs-audience entry
 * arm) and the ADR-0106 object-schema mask (`object`). The doors beside it —
 * `/layers`, the deprecated `?layers=true`, `/published`, `/history`, `/audit`
 * and `/diff` — used to serve the same document with none of those gates, so a
 * member who is refused `crm_admin_runbook` by the plain read got its body back
 * from three of them.
 *
 * ## What each door owes, by the kind of body it serves
 *
 *  - **`/published` serves ONE document**, the same representation the plain
 *    read serves: it answers exactly what the plain read answers — the same
 *    refusal, or the same pruned or masked document.
 *  - **`/layers`, `?layers=true` and `/diff` serve STORED versions** — the
 *    layers side by side, or two versions compared. They carry only the
 *    per-caller gates, and where the plain read would serve this caller a
 *    PART of an app (entries withheld) they refuse it `403 PERMISSION_DENIED`
 *    rather than hand back a pruned stored version: Studio's designer loads the
 *    layered view and saves what it loaded, so a pruned version saved back is
 *    the withheld entries silently deleted. The object mask is the one per-caller
 *    arm they still APPLY, because ADR-0106 D4 exempts every caller who may
 *    write a schema from it — the masked view never reaches a writer.
 *  - **`/history` and `/audit` serve events, never a body**: they refuse where
 *    the plain read refuses the item whole, and otherwise serve the events.
 *  - **`/references`** is declared exempt: it serves the identities of OTHER
 *    items that point at this one, never a member of this item's document.
 *
 * The dashboard widget gate (ADR-0057 D10) is NOT a per-caller gate — it asks
 * which optional services this deployment registered, and answers every caller
 * alike. The single-document doors keep it (they answer what the plain read
 * answers); the stored-version doors serve the stored dashboard, so a designer
 * never loads — and saves back — a dashboard minus a widget whose service is
 * merely off in this deployment.
 *
 * ## The door list is read off the route table
 *
 * `DOORS` below is checked against every `GET` route the server registers under
 * `/meta/:type/:name`, so a door added later without a declared disposition
 * fails this file instead of passing it silently.
 */

import { describe, it, expect, vi } from 'vitest';
// Explicit `.js` extension: NodeNext resolution (see the sibling nav-gate tests).
import { RestServer } from './rest-server.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

/**
 * The PREVIOUS version each `/diff` compares against. Identity keys only, so
 * every other key arrives in the diff's `added` bucket with its whole value —
 * the shape `diffMetaItem` answers for an item's first revision — except the
 * object, whose `fields` arrive as a `changed` entry (both sides carry values).
 */
const previousVersionOf = (type: string, doc: any): any =>
    type === 'object'
        ? { name: doc.name, label: doc.label, fields: { amount: doc.fields.amount } }
        : { name: doc.name, label: doc.label };

// ── Callers ───────────────────────────────────────────────────────────────────

interface Caller {
    ctx?: { userId: string; systemPermissions: string[] };
    holdings: string[];
    readableFields: string[];
}
const CALLERS: Record<'reader' | 'non-reader' | 'anonymous', Caller> = {
    reader: {
        ctx: { userId: 'u_reader', systemPermissions: ['finance.access', 'payroll.access', 'studio.access'] },
        holdings: ['crm_admin'],
        readableFields: ['amount', 'secret_margin'],
    },
    'non-reader': {
        ctx: { userId: 'u_member', systemPermissions: [] },
        holdings: [],
        readableFields: ['amount'],
    },
    anonymous: { holdings: [], readableFields: [] },
};
type CallerName = keyof typeof CALLERS;

// ── Harness ───────────────────────────────────────────────────────────────────

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

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const find = (type: unknown, name: unknown): any =>
    (STORE[singular(type)] ?? []).find((i: any) => i.name === name);

/** `diffShallow`'s top-level contract: added / removed / changed, whole values. */
function shallowDiff(from: Record<string, any>, to: Record<string, any>) {
    const added: any[] = [];
    const removed: any[] = [];
    const changed: any[] = [];
    for (const k of Object.keys(to)) {
        if (!(k in from)) added.push({ path: k, value: to[k] });
        else if (JSON.stringify(from[k]) !== JSON.stringify(to[k])) changed.push({ path: k, from: from[k], to: to[k] });
    }
    for (const k of Object.keys(from)) if (!(k in to)) removed.push({ path: k, value: from[k] });
    return { added, removed, changed };
}

function setup(callerName: CallerName) {
    const caller = CALLERS[callerName];
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        // The shared cache's read, present on purpose: it serves the UNGATED
        // document, so a gated type the plain read's cache exclusion missed
        // would take this arm and redden its plain-read row below.
        getMetaItemCached: vi.fn(async ({ type, name }: any) => ({
            data: clone(find(type, name)),
            etag: { value: `etag-${singular(type)}-${name}`, weak: false },
        })),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => {
            const found = find(type, name);
            const layer = () => (found ? clone(found) : null);
            return { type: singular(type), name, code: layer(), overlay: layer(), effective: layer() };
        }),
        historyMetaItem: vi.fn(async ({ type, name }: any) => ({
            events: [{
                seq: 1, op: 'update', ref: { type: singular(type), name }, hash: null, parentHash: null,
                version: 2, actor: 'u_author', message: 'revised', ts: '2026-09-27T00:00:00.000Z', source: 'rest',
            }],
        })),
        auditMetaItem: vi.fn(async ({ type, name }: any) => ({
            events: [{ type: singular(type), name, operation: 'save', allowed: true, actor: 'u_author', at: '2026-09-27T00:00:00.000Z' }],
        })),
        diffMetaItem: vi.fn(async ({ type, name }: any) => {
            const t = singular(type);
            const found = find(type, name);
            const to = found ? clone(found) : {};
            const from = found ? previousVersionOf(t, clone(found)) : {};
            return { type: t, name, fromVersion: 1, toVersion: 2, ...shallowDiff(from, to) };
        }),
        findReferencesToMeta: vi.fn(async () => ({ references: [] })),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, {} as any);
    if (caller.ctx) {
        const ctx = caller.ctx;
        rest.resolveExecCtx = async () => clone(ctx);
    }
    rest.securityServiceProvider = async () => ({
        resolvePermissionSetNames: async () => caller.holdings,
        getMetadataReadableFields: async () => caller.readableFields,
    });
    // ADR-0057 D10 — `tenancy` is an optional service this deployment lacks.
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
    rest.metadataServiceProvider = async () => ({
        getPublished: async (type: string, name: string) => clone(find(type, name)),
    });
    rest.registerRoutes();
    return { rest, protocol };
}

const META = '/api/v1/meta';

async function drive(rest: any, suffix: string, type: string, name: string, query: Record<string, string> = {}) {
    const path = `${META}/:type/:name${suffix}`;
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    if (!route) throw new Error(`GET ${path} is not registered`);
    const res = makeRes();
    await route.handler({ method: 'GET', path: `${META}/${type}/${name}${suffix}`, params: { type, name }, query, body: {}, headers: {} }, res);
    return res;
}

/** The ADR-0112 minimum: the status and the machine code, never the prose. */
const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });
const text = (res: any): string => JSON.stringify(res.body ?? null);

// ── The doors, and what each owes ─────────────────────────────────────────────

type DoorKind = 'document' | 'stored' | 'events' | 'exempt';
interface Door { kind: DoorKind; suffix: string; query?: Record<string, string>; reason?: string }

const DOORS: Record<string, Door> = {
    '?layers=true': { kind: 'stored', suffix: '', query: { layers: 'true' } },
    '/layers': { kind: 'stored', suffix: '/layers' },
    '/published': { kind: 'document', suffix: '/published' },
    '/diff': { kind: 'stored', suffix: '/diff' },
    '/history': { kind: 'events', suffix: '/history' },
    '/audit': { kind: 'events', suffix: '/audit' },
    '/references': {
        kind: 'exempt',
        suffix: '/references',
        reason: 'serves the identities of OTHER items that reference this one, never a member of this item\'s document',
    },
};

// ── The subjects, and what the plain read answers each caller ────────────────

/**
 * How the plain read answers one caller, DECLARED here and checked against the
 * plain read itself below — so the table cannot drift from the gate it mirrors.
 *
 *  - `whole`: 200, the document with nothing withheld.
 *  - `refused`: the plain read's refusal (status + code given).
 *  - `pruned`: 200, part of an app withheld from this caller.
 *  - `masked`: 200, an object schema minus the fields this caller may not read.
 *  - `deployment-pruned`: 200, minus a widget whose service is off in this deployment.
 */
type PlainAnswer =
    | { kind: 'whole' }
    | { kind: 'refused'; status: number; code: string }
    | { kind: 'pruned' }
    | { kind: 'masked' }
    | { kind: 'deployment-pruned' };

const ANON: PlainAnswer = { kind: 'refused', status: 401, code: 'UNAUTHENTICATED' };

interface Subject {
    type: string;
    name: string;
    /** Strings a caller the plain read withholds them from must never receive. */
    secrets: string[];
    plain: Record<CallerName, PlainAnswer>;
}

const SUBJECTS: Subject[] = [
    {
        type: 'doc', name: 'crm_admin_runbook', secrets: [DOC_SECRET],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, anonymous: ANON },
    },
    {
        type: 'doc', name: 'crm_intro', secrets: [],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'whole' }, anonymous: ANON },
    },
    {
        type: 'book', name: 'admin_guide', secrets: [BOOK_SECRET],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, anonymous: ANON },
    },
    {
        type: 'app', name: 'crm', secrets: ['nav_finance_ledger', 'nav_admin_runbook'],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'pruned' }, anonymous: ANON },
    },
    {
        type: 'app', name: 'payroll', secrets: ['nav_payroll_runs'],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, anonymous: ANON },
    },
    {
        type: 'app', name: 'launchpad', secrets: ['nav_launchpad_home'],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'refused', status: 404, code: 'RESOURCE_NOT_FOUND' }, anonymous: ANON },
    },
    {
        type: 'dashboard', name: 'ops', secrets: [],
        plain: { reader: { kind: 'deployment-pruned' }, 'non-reader': { kind: 'deployment-pruned' }, anonymous: ANON },
    },
    {
        type: 'object', name: 'invoice', secrets: ['secret_margin'],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'masked' }, anonymous: ANON },
    },
    // Control: a type the plain read gates for nobody.
    {
        type: 'view', name: 'all_leads', secrets: [],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'whole' }, anonymous: ANON },
    },
];

/** The document the plain read served (its envelope's `item`). */
const plainItem = (res: any) => res.body?.item;
const navIds = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);
const widgetIds = (doc: any): string[] => (doc?.widgets ?? []).map((w: any) => w.id);
const fieldNames = (doc: any): string[] => Object.keys(doc?.fields ?? {}).sort();

// ── The census ────────────────────────────────────────────────────────────────

describe('[#20156] the door list is read off the route table', () => {
    it('every GET route under /meta/:type/:name has a declared disposition, and every declared door is mounted', () => {
        const { rest } = setup('reader');
        const itemPath = `${META}/:type/:name`;
        const mounted = new Set<string>(
            rest.getRoutes()
                .filter((r: any) => r.method === 'GET' && typeof r.path === 'string'
                    && (r.path === itemPath || r.path.startsWith(`${itemPath}/`)))
                .map((r: any) => r.path.slice(itemPath.length)),
        );
        const declared = new Set<string>(['', ...Object.values(DOORS).map((d) => d.suffix)]);
        expect([...mounted].sort()).toEqual([...declared].sort());
    });
});

describe('[#20156] the plain read answers what the census declares', () => {
    for (const subject of SUBJECTS) {
        for (const callerName of Object.keys(CALLERS) as CallerName[]) {
            const want = subject.plain[callerName];
            it(`${subject.type}/${subject.name} × ${callerName} → ${want.kind}`, async () => {
                const { rest } = setup(callerName);
                const res = await drive(rest, '', subject.type, subject.name);
                const stored = find(subject.type, subject.name);
                if (want.kind === 'refused') {
                    expect(envelope(res)).toEqual({ status: want.status, code: want.code });
                    for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                    return;
                }
                expect(res.statusCode).toBe(200);
                const item = plainItem(res);
                if (want.kind === 'pruned') expect(navIds(item)).not.toEqual(navIds(stored));
                if (want.kind === 'masked') expect(fieldNames(item)).not.toEqual(fieldNames(stored));
                if (want.kind === 'deployment-pruned') expect(widgetIds(item)).toEqual(['w_open_cases']);
                if (want.kind === 'whole') for (const s of subject.secrets) expect(text(res)).toContain(s);
                if (want.kind === 'pruned' || want.kind === 'masked') {
                    for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                }
            });
        }
    }
});

describe('[#20156] every alternate door answers what the plain read answers, or refuses', () => {
    for (const [doorName, door] of Object.entries(DOORS)) {
        if (door.kind === 'exempt') continue;
        describe(doorName, () => {
            for (const subject of SUBJECTS) {
                for (const callerName of Object.keys(CALLERS) as CallerName[]) {
                    const want = subject.plain[callerName];
                    it(`${subject.type}/${subject.name} × ${callerName}`, async () => {
                        const { rest } = setup(callerName);
                        const plain = await drive(rest, '', subject.type, subject.name);
                        const res = await drive(rest, door.suffix, subject.type, subject.name, door.query);
                        const stored = find(subject.type, subject.name);

                        // A refusal of the item WHOLE is the plain read's refusal
                        // on every door: same status, same code, nothing withheld.
                        if (want.kind === 'refused') {
                            expect(envelope(res)).toEqual(envelope(plain));
                            for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                            return;
                        }

                        if (door.kind === 'events') {
                            expect(res.statusCode).toBe(200);
                            expect(Array.isArray(res.body?.events)).toBe(true);
                            return;
                        }

                        if (door.kind === 'document') {
                            expect(res.statusCode).toBe(200);
                            const served = res.body;
                            const expected = plainItem(plain);
                            if (subject.type === 'app') expect(navIds(served)).toEqual(navIds(expected));
                            if (subject.type === 'dashboard') expect(widgetIds(served)).toEqual(widgetIds(expected));
                            if (subject.type === 'object') expect(fieldNames(served)).toEqual(fieldNames(expected));
                            if (want.kind === 'whole') for (const s of subject.secrets) expect(text(res)).toContain(s);
                            else for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                            return;
                        }

                        // door.kind === 'stored'
                        if (want.kind === 'pruned') {
                            // A part of the app is withheld from this caller, and a
                            // stored version is served whole or not at all.
                            expect(envelope(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
                            for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                            return;
                        }
                        expect(res.statusCode).toBe(200);
                        if (want.kind === 'masked') {
                            for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                            if (door.suffix !== '/diff') {
                                for (const layer of ['code', 'overlay', 'effective']) {
                                    expect(fieldNames(res.body?.[layer])).toEqual(fieldNames(plainItem(plain)));
                                }
                            }
                            return;
                        }
                        if (want.kind === 'deployment-pruned') {
                            // Not a per-caller gate: the stored dashboard, widget and all.
                            expect(text(res)).toContain('w_org_kpi');
                            return;
                        }
                        // whole
                        for (const s of subject.secrets) expect(text(res)).toContain(s);
                        if (door.suffix !== '/diff') {
                            for (const layer of ['code', 'overlay', 'effective']) {
                                expect(res.body?.[layer]).toEqual(stored);
                            }
                        }
                    });
                }
            }
        });
    }
});

// ── The edges the census rows do not reach ────────────────────────────────────

describe('[#20156] edges', () => {
    it('/layers judges EVERY layer: a code layer the caller may not read is not served beside an effective one they may', async () => {
        const { rest, protocol } = setup('non-reader');
        // The shipped book is set-gated; an overlay opened it to the org.
        const opened = { ...clone(ADMIN_GUIDE), audience: 'org', description: 'Open to everyone now.' };
        protocol.getMetaItemLayered.mockImplementation(async () => ({
            type: 'book', name: 'admin_guide', code: clone(ADMIN_GUIDE), overlay: opened, effective: opened,
        }));
        const res = await drive(rest, '/layers', 'book', 'admin_guide');

        expect(envelope(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(text(res)).not.toContain(BOOK_SECRET);
    });

    it('a gate-input FAULT on a stored-version door is the fault, never a 403 and never the body', async () => {
        // The app's docs-audience entry arm reads the books; that read fails.
        // Pruning every `doc` entry would read here as "part of this app is
        // withheld from you" — a 403 telling a holder they hold nothing.
        const { rest, protocol } = setup('reader');
        const listRead = protocol.getMetaItems.getMockImplementation();
        protocol.getMetaItems.mockImplementation(async (request: any) => {
            if (singular(request?.type) === 'book') {
                throw Object.assign(new Error('The metadata store could not be read.'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
            }
            return listRead(request);
        });
        for (const suffix of ['/layers', '/diff']) {
            const res = await drive(rest, suffix, 'app', 'crm');
            expect(envelope(res), suffix).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
            expect(text(res), suffix).not.toContain('nav_finance_ledger');
        }
        // The single-document doors keep the plain read's answer to that fault:
        // the `doc` entries left out, the rest of the navigation served.
        const plain = await drive(rest, '', 'app', 'crm');
        const published = await drive(rest, '/published', 'app', 'crm');
        expect(plain.statusCode).toBe(200);
        expect(navIds(published.body)).toEqual(navIds(plainItem(plain)));
        expect(navIds(published.body)).not.toContain('nav_admin_runbook');
    });

    it('a gated type with nothing behind the name: /diff answers the plain read\'s absence, /history its events', async () => {
        const { rest, protocol } = setup('non-reader');
        protocol.getMetaItem.mockImplementation(async ({ type, name }: any) => ({ type: singular(type), name, item: undefined }));
        const diff = await drive(rest, '/diff', 'doc', 'crm_admin_runbook');
        const history = await drive(rest, '/history', 'doc', 'crm_admin_runbook');

        expect(envelope(diff)).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        expect(text(diff)).not.toContain(DOC_SECRET);
        expect(history.statusCode).toBe(200);
        expect(Array.isArray(history.body?.events)).toBe(true);
    });

    it('a type no per-caller gate judges costs its event and diff doors no extra read', async () => {
        const { rest, protocol } = setup('non-reader');
        for (const suffix of ['/history', '/audit', '/diff']) {
            protocol.getMetaItem.mockClear();
            const res = await drive(rest, suffix, 'view', 'all_leads');
            expect(res.statusCode, suffix).toBe(200);
            expect(protocol.getMetaItem, suffix).not.toHaveBeenCalled();
        }
    });
});
