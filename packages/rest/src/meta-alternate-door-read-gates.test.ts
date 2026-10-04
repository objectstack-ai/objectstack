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
 *  - **`/layers`, `?layers=true`, `/diff` and [#20290] the plain read's
 *    `?state=draft` serve STORED versions** — the layers side by side, two
 *    versions compared, or the pending draft row. They carry the per-caller
 *    gates: the docs audience refuses what the plain read refuses, and the
 *    object mask projects as the plain read does (ADR-0106 D4 exempts every
 *    caller who may write a schema, so a masked version never reaches a
 *    writer).
 *
 *    For `app` they refuse, like every other door, an app the plain read
 *    refuses WHOLE (an app-level `requiredPermissions` the caller lacks; an
 *    unpublished app to a non-builder, ADR-0045 §3) — to an author as to
 *    anyone.
 *
 *    **The author exemption** (ruling 5856774816, letter B, confirmed
 *    5856866273 — `AUTHOR_EXEMPTION` below): on these doors a caller who
 *    may WRITE the app — the one the app's save door admits — reads the
 *    full stored version, and every other caller who may open it reads
 *    exactly what the plain read gives them, pruned. ADR-0106 D4's shape
 *    carried from object schemas to apps: read-to-display is pruned per
 *    user, read-to-edit is whole for whoever may edit, because Studio's
 *    designer saves back what it loaded and a pruned load would delete the
 *    withheld entries. [#20290] The draft is such a load: the designers
 *    merge `?state=draft` over the layered view and save the result back.
 *    The exemption is a CALLER property, honoured by these four doors and by
 *    no other: the rendered plain read (`?preview=draft` included) and
 *    `/published` still prune for an author.
 *
 *    [#20338] The draft door serves the draft only to a caller who may read
 *    drafts at all — the authoring capability `GET /meta/_drafts` asks
 *    (`readsDrafts` below). Anyone else is never handed one: `?state=draft`
 *    answers them what the plain read answers them, byte for byte.
 *  - **`/history` and `/audit` serve events, never a body**: they refuse where
 *    the plain read refuses the item whole, and otherwise serve the events.
 *
 *    [#20378] **`/diff` and `/history` are AUTHORING doors** (ruling
 *    5865708652, letter B, which narrows ruling 5856774816 item 2 for these
 *    two doors only). Both read `sys_metadata_history`, where a draft save is
 *    recorded exactly as an active save, so a caller who may not read drafts
 *    (`readsDrafts` below) is refused them exactly as `GET /meta/_drafts`
 *    refuses — 403 `FORBIDDEN`, before any read. Everything this census says
 *    about them holds for the callers they admit. `/layers` and
 *    `?layers=true` keep the pruned plain-read answer for everyone.
 *
 *    [#20441] **`/audit` is the third** (triage's grade 5871509797 carrying
 *    ruling 5865708652 to it): `sys_metadata_audit` records a draft save with
 *    `note: 'draft'`, its actor and its time, so it takes the same refusal
 *    before any read.
 *  - **`/references`** is declared exempt: it serves the identities of OTHER
 *    items that point at this one, never a member of this item's document.
 *
 * The dashboard widget gate (ADR-0057 D10) is NOT a per-caller gate — it asks
 * which optional services this deployment registered, and answers every caller
 * alike. The rendered single-document doors keep it (they answer what the plain
 * read answers); the stored-version doors — the draft read among them — serve
 * the stored dashboard, so a designer never loads — and saves back — a
 * dashboard minus a widget whose service is merely off in this deployment.
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
    ctx?: { userId: string; systemPermissions: string[]; tenantId?: string };
    holdings: string[];
    readableFields: string[];
    /**
     * Does `PUT /meta/app/:name` admit this caller? DECLARED here and checked
     * against the save door itself below — the author exemption's predicate is
     * that door's answer (ruling 5856774816, item 1), so the census cannot
     * call a caller an author the save door refuses, or the reverse.
     */
    savesApps: boolean;
    /**
     * [#20338] Does `GET /meta/_drafts` admit this caller? DECLARED here and
     * checked against that door below: every draft door asks the predicate it
     * asks, so a caller it refuses is never served a draft by `?state=draft`.
     */
    readsDrafts: boolean;
}
const CALLERS: Record<'reader' | 'non-reader' | 'author' | 'anonymous', Caller> = {
    reader: {
        ctx: { userId: 'u_reader', systemPermissions: ['finance.access', 'payroll.access', 'studio.access'] },
        holdings: ['crm_admin'],
        readableFields: ['amount', 'secret_margin'],
        savesApps: false,
        readsDrafts: true,
    },
    'non-reader': {
        ctx: { userId: 'u_member', systemPermissions: [] },
        holdings: [],
        readableFields: ['amount'],
        savesApps: false,
        readsDrafts: false,
    },
    // An author the plain read serves only PART of `crm`: they may write
    // metadata, but hold neither `finance.access` nor `crm_admin`. And no
    // builder capability either, so the unpublished `launchpad` stays
    // invisible to them (ADR-0045 §3 — the exemption lifts no whole refusal).
    author: {
        ctx: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
        holdings: [],
        readableFields: ['amount'],
        savesApps: true,
        readsDrafts: true,
    },
    anonymous: { holdings: [], readableFields: [], savesApps: false, readsDrafts: false },
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

function setup(who: CallerName | Caller) {
    const caller = typeof who === 'string' ? CALLERS[who] : who;
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
        // The save door's protocol call — reached only past its admission.
        saveMetaItem: vi.fn(async ({ type, name }: any) => ({ success: true, type: singular(type), name })),
        // [#20338] `GET /meta/_drafts` — reached only past its admission.
        listDrafts: vi.fn(async () => ({ items: [] })),
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

/** `PUT /meta/:type/:name` — the save door whose admission IS the author exemption's predicate. */
async function save(rest: any, type: string, name: string, item: any) {
    const path = `${META}/:type/:name`;
    const route = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === path);
    if (!route) throw new Error(`PUT ${path} is not registered`);
    const res = makeRes();
    await route.handler({ method: 'PUT', path: `${META}/${type}/${name}`, params: { type, name }, query: {}, body: item, headers: {} }, res);
    return res;
}

/** [#20338] `GET /meta/_drafts` — the door whose admission IS `readsDrafts`. */
async function listDrafts(rest: any) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}/_drafts`);
    if (!route) throw new Error(`GET ${META}/_drafts is not registered`);
    const res = makeRes();
    await route.handler({ method: 'GET', path: `${META}/_drafts`, params: {}, query: {}, body: {}, headers: {} }, res);
    return res;
}

/** The ADR-0112 minimum: the status and the machine code, never the prose. */
const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });
const text = (res: any): string => JSON.stringify(res.body ?? null);

// ── The doors, and what each owes ─────────────────────────────────────────────

type DoorKind = 'document' | 'stored' | 'events' | 'exempt';
/**
 * `serves` — what a `stored` door's body holds: the three `layers` side by
 * side, a `diff` of two versions, or the pending `draft` in the plain read's
 * envelope (its `item`).
 */
/**
 * `authoring` — [#20378] ruling 5865708652 (and [#20441] its carriage to
 * `/audit`): the door refuses a caller who may not read drafts (`readsDrafts`)
 * with the `GET /meta/_drafts` 403, before any read; the rest of its row holds
 * for the callers it admits.
 */
interface Door { kind: DoorKind; suffix: string; query?: Record<string, string>; reason?: string; serves?: 'layers' | 'diff' | 'draft'; authoring?: true }

const DOORS: Record<string, Door> = {
    '?layers=true': { kind: 'stored', suffix: '', query: { layers: 'true' }, serves: 'layers' },
    '/layers': { kind: 'stored', suffix: '/layers', serves: 'layers' },
    // [#20290] The plain read's draft branch: the pending draft ROW, a stored
    // version — not the rendered world, which is `?preview=draft`.
    '?state=draft': { kind: 'stored', suffix: '', query: { state: 'draft' }, serves: 'draft' },
    '/published': { kind: 'document', suffix: '/published' },
    '/diff': { kind: 'stored', suffix: '/diff', serves: 'diff', authoring: true },
    '/history': { kind: 'events', suffix: '/history', authoring: true },
    '/audit': { kind: 'events', suffix: '/audit', authoring: true },
    '/references': {
        kind: 'exempt',
        suffix: '/references',
        reason: 'serves the identities of OTHER items that reference this one, never a member of this item\'s document',
    },
};

/**
 * THE AUTHOR EXEMPTION — ruling 5856774816 (letter B, confirmed 5856866273).
 *
 * 「On the three stored-version doors (`/layers`, `?layers=true`, `/diff`) a
 * caller who may write the app reads the full stored version; every other
 * caller who may open the app reads exactly what the plain read gives them,
 * pruned.」 ADR-0106 D4's shape, carried from object schemas to apps: the
 * exemption is a CALLER property ("may write" = the save door admits them,
 * `savesApps` above, checked against that door below), and these three doors
 * are the only ones that honour it.
 *
 * [#20290] And on the plain read's `?state=draft` branch — the carrier
 * triage decided in 5859504238 under the same ruling's words: 「whoever can
 * save it must see it whole, or a save drops entries silently」. A draft is a
 * stored version, not a rendered one: Studio's designers merge it over the
 * layered view and save the result back.
 *
 * So on an exempt cell the door owes the STORED app whole where the plain
 * read would prune it — and nothing else changes: an app the plain read
 * refuses WHOLE is refused there too, author or not. Tests below hold the
 * exemption to exactly the author's partial `app` cells of exactly these
 * four doors: widening it to another door, to a rendered door, to a
 * non-author, or to a whole refusal fails them rather than passing silently.
 */
const AUTHOR_EXEMPTION = Object.freeze({
    ruling: '5856774816',
    /** [#20290] The draft read's carrier decision, under the same ruling. */
    draftCarrier: '5859504238',
    type: 'app',
    doors: Object.freeze(['?layers=true', '/layers', '/diff', '?state=draft']),
});
const authorExempt = (type: string, doorName: string, callerName: CallerName): boolean =>
    type === AUTHOR_EXEMPTION.type && AUTHOR_EXEMPTION.doors.includes(doorName)
    && CALLERS[callerName].savesApps;

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
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, author: { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, anonymous: ANON },
    },
    {
        type: 'doc', name: 'crm_intro', secrets: [],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'whole' }, author: { kind: 'whole' }, anonymous: ANON },
    },
    {
        type: 'book', name: 'admin_guide', secrets: [BOOK_SECRET],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, author: { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, anonymous: ANON },
    },
    {
        type: 'app', name: 'crm', secrets: ['nav_finance_ledger', 'nav_admin_runbook'],
        // The plain read prunes for the AUTHOR too: read-to-display is per user.
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'pruned' }, author: { kind: 'pruned' }, anonymous: ANON },
    },
    {
        type: 'app', name: 'payroll', secrets: ['nav_payroll_runs'],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, author: { kind: 'refused', status: 403, code: 'PERMISSION_DENIED' }, anonymous: ANON },
    },
    {
        type: 'app', name: 'launchpad', secrets: ['nav_launchpad_home'],
        plain: {
            reader: { kind: 'whole' },
            'non-reader': { kind: 'refused', status: 404, code: 'RESOURCE_NOT_FOUND' },
            author: { kind: 'refused', status: 404, code: 'RESOURCE_NOT_FOUND' },
            anonymous: ANON,
        },
    },
    {
        type: 'dashboard', name: 'ops', secrets: [],
        plain: {
            reader: { kind: 'deployment-pruned' },
            'non-reader': { kind: 'deployment-pruned' },
            author: { kind: 'deployment-pruned' },
            anonymous: ANON,
        },
    },
    {
        type: 'object', name: 'invoice', secrets: ['secret_margin'],
        // ADR-0106 D4: whoever may write a schema reads it whole.
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'masked' }, author: { kind: 'whole' }, anonymous: ANON },
    },
    // Control: a type the plain read gates for nobody.
    {
        type: 'view', name: 'all_leads', secrets: [],
        plain: { reader: { kind: 'whole' }, 'non-reader': { kind: 'whole' }, author: { kind: 'whole' }, anonymous: ANON },
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

const LAYERS = ['code', 'overlay', 'effective'] as const;
const bucketPaths = (diff: any): string[][] =>
    (['added', 'removed', 'changed'] as const).map((b) => (diff?.[b] ?? []).map((e: any) => e.path));
/** The stored versions a `layers` or `draft` door served, each as the gate served it. */
const servedVersions = (door: Door, res: any): any[] =>
    (door.serves === 'draft' ? [plainItem(res)] : LAYERS.map((layer) => res.body?.[layer]));
const servedLabels = (door: Door): string[] => (door.serves === 'draft' ? ['draft'] : [...LAYERS]);

describe(`[#20156 · #20290] ruling ${AUTHOR_EXEMPTION.ruling} — the author exemption is declared, and no wider than the author's partial app cells of four doors`, () => {
    it('it names exactly /layers, ?layers=true, /diff and ?state=draft — every stored-version door, and no other', () => {
        expect(AUTHOR_EXEMPTION.ruling).toBe('5856774816');
        expect(AUTHOR_EXEMPTION.draftCarrier).toBe('5859504238');
        expect(AUTHOR_EXEMPTION.type).toBe('app');
        // Literal, not derived from `DOORS`: a door is exempted by a deliberate
        // edit here, never by inheriting a kind.
        expect([...AUTHOR_EXEMPTION.doors].sort()).toEqual(['/diff', '/layers', '?layers=true', '?state=draft']);
        // ...and the literal is every stored-version door: none is left
        // pruning an author, none that renders is exempted.
        const storedDoors = Object.entries(DOORS).filter(([, d]) => d.kind === 'stored').map(([n]) => n);
        expect(storedDoors.sort()).toEqual([...AUTHOR_EXEMPTION.doors].sort());
    });

    it('the cells whose answer it changes are exactly the author\'s partial app cells — no whole refusal, no other caller, no rendered door', () => {
        const changed: string[] = [];
        const stillRefused: string[] = [];
        for (const doorName of Object.keys(DOORS)) {
            for (const subject of SUBJECTS) {
                for (const callerName of Object.keys(CALLERS) as CallerName[]) {
                    if (!authorExempt(subject.type, doorName, callerName)) continue;
                    const want = subject.plain[callerName];
                    const cell = `${doorName} ${subject.type}/${subject.name} × ${callerName}`;
                    if (want.kind === 'refused') stillRefused.push(cell);
                    else if (want.kind !== 'whole') changed.push(cell);
                }
            }
        }
        expect(changed.sort()).toEqual([
            '/diff app/crm × author',
            '/layers app/crm × author',
            '?layers=true app/crm × author',
            '?state=draft app/crm × author',
        ]);
        // The whole refusals it does NOT lift — each is held to the plain
        // read's refusal by its census row below.
        expect(stillRefused.sort()).toEqual([
            '/diff app/launchpad × author',
            '/diff app/payroll × author',
            '/layers app/launchpad × author',
            '/layers app/payroll × author',
            '?layers=true app/launchpad × author',
            '?layers=true app/payroll × author',
            '?state=draft app/launchpad × author',
            '?state=draft app/payroll × author',
        ]);
    });

    it('its predicate is the save door\'s answer: `savesApps` is exactly who `PUT /meta/app/crm` admits', async () => {
        for (const callerName of Object.keys(CALLERS) as CallerName[]) {
            const { rest, protocol } = setup(callerName);
            const res = await save(rest, 'app', 'crm', clone(CRM_APP));
            if (CALLERS[callerName].savesApps) {
                expect(res.statusCode, callerName).toBe(200);
                expect(protocol.saveMetaItem, callerName).toHaveBeenCalledTimes(1);
            } else {
                expect(envelope(res), callerName).toEqual(
                    CALLERS[callerName].ctx
                        ? { status: 403, code: 'FORBIDDEN' }
                        : { status: 401, code: 'UNAUTHENTICATED' },
                );
                expect(protocol.saveMetaItem, callerName).not.toHaveBeenCalled();
            }
        }
    });

    it('[#20338] `readsDrafts` is exactly who `GET /meta/_drafts` admits — the predicate every draft door asks', async () => {
        for (const callerName of Object.keys(CALLERS) as CallerName[]) {
            const { rest, protocol } = setup(callerName);
            const res = await listDrafts(rest);
            if (CALLERS[callerName].readsDrafts) {
                expect(res.statusCode, callerName).toBe(200);
                expect(protocol.listDrafts, callerName).toHaveBeenCalledTimes(1);
            } else {
                expect(envelope(res), callerName).toEqual(
                    CALLERS[callerName].ctx
                        ? { status: 403, code: 'FORBIDDEN' }
                        : { status: 401, code: 'UNAUTHENTICATED' },
                );
                expect(protocol.listDrafts, callerName).not.toHaveBeenCalled();
            }
        }
    });
});

describe(`[#20156] every alternate door answers what the plain read answers, or refuses — save the author exemption of ruling ${AUTHOR_EXEMPTION.ruling}`, () => {
    for (const [doorName, door] of Object.entries(DOORS)) {
        if (door.kind === 'exempt') continue;
        describe(doorName, () => {
            for (const subject of SUBJECTS) {
                for (const callerName of Object.keys(CALLERS) as CallerName[]) {
                    const want = subject.plain[callerName];
                    // A whole refusal is refused to an author as to anyone.
                    const exempt = authorExempt(subject.type, doorName, callerName) && want.kind !== 'refused';
                    const title = `${subject.type}/${subject.name} × ${callerName}`
                        + (exempt ? ` — AUTHOR, ruling ${AUTHOR_EXEMPTION.ruling}: the full stored version` : '');
                    it(title, async () => {
                        const { rest, protocol } = setup(callerName);
                        const plain = await drive(rest, '', subject.type, subject.name);
                        protocol.getMetaItem.mockClear();
                        const res = await drive(rest, door.suffix, subject.type, subject.name, door.query);
                        const stored = find(subject.type, subject.name);
                        if (door.authoring && CALLERS[callerName].ctx && !CALLERS[callerName].readsDrafts) {
                            // [#20378] ruling 5865708652: an authoring door
                            // refuses a caller who may not read drafts exactly
                            // as `GET /meta/_drafts` does, whatever the plain
                            // read answers them — and before any read. (An
                            // anonymous caller is refused by the `/meta` auth
                            // gate first, as on every door.)
                            expect(envelope(res)).toEqual({ status: 403, code: 'FORBIDDEN' });
                            for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                            expect(protocol.getMetaItem).not.toHaveBeenCalled();
                            expect(protocol.diffMetaItem).not.toHaveBeenCalled();
                            expect(protocol.historyMetaItem).not.toHaveBeenCalled();
                            expect(protocol.auditMetaItem).not.toHaveBeenCalled();
                            return;
                        }
                        if (door.serves === 'draft' && CALLERS[callerName].ctx) {
                            const asked = protocol.getMetaItem.mock.calls.map(([r]: any[]) => r?.state);
                            if (!CALLERS[callerName].readsDrafts) {
                                // [#20338] A caller who may not read drafts is
                                // never handed one: the protocol is not asked for
                                // the draft row, and the door answers what the
                                // plain read answers them, byte for byte.
                                expect(asked).not.toContain('draft');
                                expect(envelope(res)).toEqual(envelope(plain));
                                expect(res.body).toEqual(plain.body);
                                return;
                            }
                            // [#20290] The cell measured the draft branch: the
                            // protocol was asked for the draft row. (An anonymous
                            // caller is refused by the `/meta` auth gate before
                            // any read, on every door alike.)
                            expect(asked).toContain('draft');
                        }

                        if (exempt) {
                            // A caller who may write the app reads what is STORED —
                            // every entry the plain read withholds from them
                            // included, so a save of what they loaded keeps them.
                            expect(res.statusCode).toBe(200);
                            for (const s of subject.secrets) expect(text(res)).toContain(s);
                            if (door.serves === 'diff') {
                                expect(res.body).toEqual(await protocol.diffMetaItem.mock.results.at(-1)?.value);
                            } else {
                                for (const version of servedVersions(door, res)) expect(version).toEqual(stored);
                            }
                            return;
                        }

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
                        expect(res.statusCode).toBe(200);
                        if (want.kind === 'pruned') {
                            // Every other caller who may open the app reads exactly
                            // what the plain read gives them, pruned — on every
                            // layer, and on both sides of a diff, whose entries
                            // are kept and whose VALUES are the pruned ones.
                            for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                            const expected = navIds(plainItem(plain));
                            if (door.serves === 'diff') {
                                const raw = await protocol.diffMetaItem.mock.results.at(-1)?.value;
                                expect(bucketPaths(res.body)).toEqual(bucketPaths(raw));
                                const navigation = res.body?.added?.find((e: any) => e.path === 'navigation')?.value;
                                expect(navIds({ navigation })).toEqual(expected);
                            } else {
                                for (const version of servedVersions(door, res)) expect(navIds(version)).toEqual(expected);
                            }
                            return;
                        }
                        if (want.kind === 'masked') {
                            for (const s of subject.secrets) expect(text(res)).not.toContain(s);
                            if (door.serves !== 'diff') {
                                for (const version of servedVersions(door, res)) {
                                    expect(fieldNames(version)).toEqual(fieldNames(plainItem(plain)));
                                }
                            }
                            return;
                        }
                        if (want.kind === 'deployment-pruned') {
                            // Not a per-caller gate: the stored dashboard, widget and all.
                            expect(text(res)).toContain('w_org_kpi');
                            if (door.serves !== 'diff') {
                                for (const version of servedVersions(door, res)) expect(widgetIds(version)).toEqual(widgetIds(stored));
                            }
                            return;
                        }
                        // whole
                        for (const s of subject.secrets) expect(text(res)).toContain(s);
                        if (door.serves !== 'diff') {
                            for (const version of servedVersions(door, res)) {
                                expect(version).toEqual(stored);
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

    it('a gate-input FAULT is the fault on every door — never a 403, never the body [#20129 carried to the doors]', async () => {
        // The docs audience reads the books; that read fails. Read as `[]` it
        // would grant (no gated book anywhere), so every door hands the fault
        // to the route instead — the plain read's own answer since #20129,
        // and a holder is not told they hold nothing.
        const { rest, protocol } = setup('reader');
        const listRead = protocol.getMetaItems.getMockImplementation();
        protocol.getMetaItems.mockImplementation(async (request: any) => {
            if (singular(request?.type) === 'book') {
                throw Object.assign(new Error('The metadata store could not be read.'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
            }
            return listRead(request);
        });
        const plainDoc = await drive(rest, '', 'doc', 'crm_admin_runbook');
        expect(envelope(plainDoc)).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        for (const [doorName, door] of Object.entries(DOORS)) {
            if (door.kind === 'exempt') continue;
            const res = await drive(rest, door.suffix, 'doc', 'crm_admin_runbook', door.query);
            expect(envelope(res), doorName).toEqual(envelope(plainDoc));
            expect(text(res), doorName).not.toContain(DOC_SECRET);
        }
        // An app's docs-audience entry arm takes the plain read's composite
        // answer on the single-document door: the `doc` entries left out, the
        // rest of the navigation served.
        const plainApp = await drive(rest, '', 'app', 'crm');
        const published = await drive(rest, '/published', 'app', 'crm');
        expect(plainApp.statusCode).toBe(200);
        expect(navIds(published.body)).toEqual(navIds(plainItem(plainApp)));
        expect(navIds(published.body)).not.toContain('nav_admin_runbook');
        // [ruling 5856774816] And on a stored-version door, to a caller who
        // may not write the app (this reader holds `crm_admin` but not
        // `manage_metadata`): the same composite answer, never the stored app.
        const layers = await drive(rest, '/layers', 'app', 'crm');
        expect(layers.statusCode).toBe(200);
        for (const layer of LAYERS) expect(navIds(layers.body?.[layer]), layer).toEqual(navIds(plainItem(plainApp)));
    });

    it('[ruling 5856774816] "may write" is the save door\'s WHOLE question, not a capability name: an org-scoped presentation author writes views, not apps, so the app is pruned for them', async () => {
        // `manage_org_presentation` admits a save only of an org-overridable
        // type, scoped to the session's own organization — `app` is not one.
        const presenter: Caller = {
            ctx: { userId: 'u_presenter', systemPermissions: ['manage_org_presentation'], tenantId: 'org_1' },
            holdings: [],
            readableFields: ['amount'],
            savesApps: false,
            // [#20338] No authoring capability either, so `?state=draft`
            // serves them the published app — pruned, as below.
            readsDrafts: false,
        };
        const { rest, protocol } = setup(presenter);

        // The control: the same caller IS a writer, of a type they may write.
        const view = await save(rest, 'view', 'all_leads', clone(LEADS_VIEW));
        expect(view.statusCode).toBe(200);
        expect(protocol.saveMetaItem).toHaveBeenCalledTimes(1);
        // The app's save door refuses them...
        const app = await save(rest, 'app', 'crm', clone(CRM_APP));
        expect(envelope(app)).toEqual({ status: 403, code: 'FORBIDDEN' });
        expect(protocol.saveMetaItem).toHaveBeenCalledTimes(1);
        // ...so every stored-version door serves them the plain read's pruned app
        // — save `/diff`, an authoring door that refuses them outright
        // ([#20378] ruling 5865708652: they may not read drafts either).
        const plain = await drive(rest, '', 'app', 'crm');
        const expected = navIds(plainItem(plain));
        expect(expected).not.toEqual(navIds(CRM_APP));
        for (const doorName of AUTHOR_EXEMPTION.doors) {
            const door = DOORS[doorName];
            const res = await drive(rest, door.suffix, 'app', 'crm', door.query);
            if (door.authoring) {
                expect(envelope(res), doorName).toEqual({ status: 403, code: 'FORBIDDEN' });
                for (const s of ['nav_finance_ledger', 'nav_admin_runbook']) expect(text(res), doorName).not.toContain(s);
                continue;
            }
            expect(res.statusCode, doorName).toBe(200);
            for (const s of ['nav_finance_ledger', 'nav_admin_runbook']) expect(text(res), doorName).not.toContain(s);
            if (door.serves === 'diff') {
                const navigation = res.body?.added?.find((e: any) => e.path === 'navigation')?.value;
                expect(navIds({ navigation }), doorName).toEqual(expected);
            } else {
                const labels = servedLabels(door);
                servedVersions(door, res).forEach((version, i) => {
                    expect(navIds(version), `${doorName} ${labels[i]}`).toEqual(expected);
                });
            }
        }
    });

    // [#20378] Both edges below drive an ADMITTED caller: a caller who may not
    // read drafts is refused `/diff` and `/history` before any read (the
    // census rows above), so the question these edges ask is only open for one
    // who may.
    it('a gated type with nothing behind the name: /diff answers the plain read\'s absence, /history its events', async () => {
        const { rest, protocol } = setup('reader');
        protocol.getMetaItem.mockImplementation(async ({ type, name }: any) => ({ type: singular(type), name, item: undefined }));
        const diff = await drive(rest, '/diff', 'doc', 'crm_admin_runbook');
        const history = await drive(rest, '/history', 'doc', 'crm_admin_runbook');

        expect(envelope(diff)).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        expect(text(diff)).not.toContain(DOC_SECRET);
        expect(history.statusCode).toBe(200);
        expect(Array.isArray(history.body?.events)).toBe(true);
    });

    it('a type no per-caller gate judges costs its event and diff doors no extra read', async () => {
        const { rest, protocol } = setup('reader');
        for (const suffix of ['/history', '/audit', '/diff']) {
            protocol.getMetaItem.mockClear();
            const res = await drive(rest, suffix, 'view', 'all_leads');
            expect(res.statusCode, suffix).toBe(200);
            expect(protocol.getMetaItem, suffix).not.toHaveBeenCalled();
        }
    });
});
