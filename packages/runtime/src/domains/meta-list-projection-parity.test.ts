// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20320] The dispatcher's `/meta` reads answer what `RestServer` answers, off
 * the per-caller gate path too. This file is the family's closure census.
 *
 * ## The defects it pins
 *
 * #20193 and #20237 put the dispatcher's item and list reads through the
 * per-caller gates `RestServer` asks. Three kinds of divergence were left:
 *
 *  - **Row A, the list projections.** `RestServer`'s `GET /meta/:type` runs a
 *    fixed chain after the gate: the `api` served-set face, `?id=` for apps,
 *    `?object=` for views, the doc locale collapse, the doc content slim and
 *    the translation step. The dispatcher's list branch ran only the slim, and
 *    compared the raw segment for it, so `/meta/docs` served doc bodies.
 *  - **Row B, the `public` audience.** `handleMetadataRequest` opened with the
 *    anonymous deny, so an anonymous read of a `public` book or doc answered
 *    `401` where `RestServer` serves it (ADR-0046 §6.7).
 *  - **The `?state=draft` row.** The dispatcher's item read never read
 *    `?state=`, so an admitted builder was answered the active item, never the
 *    pending draft and never `404 NO_DRAFT`.
 *
 * Measured through `dispatch()` (the `createHonoApp` catch-all's delegate)
 * against `RestServer` on this file's fixtures, before the fix: every row A
 * projection cell, every anonymous `public` book and doc cell, and every
 * admitted `?state=draft` cell was red. The numbers are in the PR.
 *
 * ## Why the census is derived, not written down
 *
 * Both transports now hand their list to ONE function
 * (`createMetaListAnswer` in `@objectstack/rest`'s `meta-item-read-gate.ts`),
 * so a projection added there reaches both. The drift left to catch is a
 * projection added to `RestServer`'s list handler itself, or a parameter the
 * shared chain starts reading that this census never sends. So the census axes
 * are checked against the SOURCE: every query parameter and every type literal
 * the list handler and the shared chain read must be a cell here, and every
 * translatable type is a cell (`TRANSLATABLE_METADATA_TYPES`, the set the
 * translation step asks). A new projection that reads a new parameter or keys
 * on a new type reddens the derivation block until it is a cell, and the cell
 * reddens until the dispatcher answers it.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { RestServer } from '@objectstack/rest';
import { TRANSLATABLE_METADATA_TYPES } from '@objectstack/spec/system';
import { pluralToSingular } from '@objectstack/spec/shared';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DOC_SECRET = 'Rotate the tenant signing keys before every release.';

const ADMIN_GUIDE = {
    name: 'admin_guide',
    label: 'Admin Guide',
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
const PUBLIC_GUIDE = {
    name: 'public_guide',
    label: 'Public Guide',
    audience: 'public',
    _packageId: 'crm',
    groups: [{ key: 'faq', label: 'FAQ', include: 'public_*' }],
};
const DOCS = [
    {
        name: 'crm_intro', label: 'Getting started', description: 'Start here', content: 'Welcome aboard.', _packageId: 'crm',
        translations: { 'zh-CN': { label: '入门', description: '从这里开始', content: '欢迎。' } },
    },
    { name: 'crm_admin_runbook', label: 'Admin runbook', content: DOC_SECRET, _packageId: 'crm' },
    {
        name: 'public_faq', label: 'FAQ', content: 'Questions and answers.', _packageId: 'crm',
        translations: { 'zh-CN': { label: '常见问题', content: '问答。' } },
    },
];
const CRM_APP = {
    name: 'crm',
    label: 'CRM',
    _packageId: 'crm',
    navigation: [
        { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'lead' },
        { id: 'nav_finance_ledger', type: 'page', label: 'Ledger', pageName: 'ledger', requiredPermissions: ['finance.access'] },
        { id: 'nav_admin_runbook', type: 'doc', label: 'Admin runbook', doc: 'crm_admin_runbook' },
        // Bound to an optional service this deployment does not register.
        { id: 'nav_org_directory', type: 'page', label: 'Organizations', pageName: 'orgs', requiresService: 'tenancy' },
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
/** No pending draft: the `NO_DRAFT` row. */
const HELPDESK_APP = {
    name: 'helpdesk',
    label: 'Helpdesk',
    navigation: [{ id: 'nav_tickets', type: 'page', label: 'Tickets', pageName: 'tickets' }],
};
const VIEWS = [
    { name: 'lead_all', label: 'All leads', object: 'lead', viewKind: 'list', order: 2 },
    { name: 'lead_mine', label: 'My leads', object: 'lead', viewKind: 'list', order: 1 },
    { name: 'account_all', label: 'All accounts', object: 'account', viewKind: 'list' },
    // The aggregated container: no `viewKind`, so the switcher leaves it out.
    { name: 'lead', label: 'Lead views', object: 'lead' },
];
const API_ITEMS = [
    { name: 'crm_served', method: 'GET', path: '/crm/served' },
    // Declared and stored, never served: the matcher resolves it to nothing.
    { name: 'crm_unserved', method: 'GET', path: '/crm/unserved' },
];
const INVOICE_OBJECT = {
    name: 'invoice',
    label: 'Invoice',
    fields: {
        amount: { type: 'number', label: 'Amount' },
        secret_margin: { type: 'number', label: 'Margin' },
    },
};
const OPS_DASHBOARD = {
    name: 'ops',
    label: 'Operations',
    widgets: [
        { id: 'w_open_cases', type: 'metric', label: 'Open cases' },
        { id: 'w_org_kpi', type: 'metric', label: 'Organizations', requiresService: 'tenancy' },
    ],
};

const STORE: Record<string, any[]> = {
    book: [ADMIN_GUIDE, HELP_CENTER, PUBLIC_GUIDE],
    doc: DOCS,
    app: [CRM_APP, PAYROLL_APP, LAUNCHPAD_APP, HELPDESK_APP],
    view: VIEWS,
    api: API_ITEMS,
    object: [INVOICE_OBJECT],
    dashboard: [OPS_DASHBOARD],
    page: [{ name: 'home', label: 'Home', type: 'app' }],
    action: [{ name: 'close_case', label: 'Close case', objectName: 'case', type: 'script' }],
    dataset: [{ name: 'pipeline', label: 'Pipeline', object: 'opportunity' }],
    flow: [{ name: 'on_lead', label: 'On lead', type: 'autolaunched' }],
};

/** Pending drafts (ADR-0033): relabelled, plus an entry that exists only in the draft. */
const DRAFTS: Record<string, any[]> = {
    app: [
        {
            ...CRM_APP,
            label: 'CRM (draft)',
            navigation: [
                ...CRM_APP.navigation,
                { id: 'nav_finance_forecast', type: 'page', label: 'Forecast', pageName: 'forecast', requiredPermissions: ['finance.access'] },
            ],
        },
        // Never published.
        { name: 'beacon', label: 'Beacon', navigation: [{ id: 'nav_beacon_home', type: 'page', label: 'Home', pageName: 'beacon_home' }] },
    ],
    object: [{
        ...INVOICE_OBJECT,
        label: 'Invoice (draft)',
        fields: { ...INVOICE_OBJECT.fields, due_on: { type: 'date', label: 'Due on' } },
    }],
    api: [{ name: 'crm_pending', method: 'GET', path: '/crm/pending' }],
};

const BUNDLE: Record<string, any> = {
    'zh-CN': {
        apps: { crm: { label: '客户管理' }, helpdesk: { label: '服务台' } },
        objects: { invoice: { label: '发票' } },
        pages: { home: { label: '首页' } },
    },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => pluralToSingular(String(type ?? ''));

// ── Callers ───────────────────────────────────────────────────────────────────

interface Caller {
    ctx: { userId?: string; isSystem: false; systemPermissions: string[] };
    holdings: string[];
    readableFields: string[];
}
const CALLERS = {
    holder: {
        ctx: { userId: 'u_holder', isSystem: false, systemPermissions: ['finance.access', 'payroll.access'] },
        holdings: ['crm_admin'],
        readableFields: ['amount', 'secret_margin'],
    },
    'non-holder': {
        ctx: { userId: 'u_member', isSystem: false, systemPermissions: [] },
        holdings: [],
        readableFields: ['amount'],
    },
    /** May read drafts (`studio.access`), may not save an app. */
    builder: {
        ctx: { userId: 'u_builder', isSystem: false, systemPermissions: ['studio.access'] },
        holdings: [],
        readableFields: ['amount'],
    },
    /** May save an app (`manage_metadata`), holds no entry permission. */
    author: {
        ctx: { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] },
        holdings: [],
        readableFields: ['amount'],
    },
    anonymous: { ctx: { isSystem: false, systemPermissions: [] }, holdings: [], readableFields: [] },
} satisfies Record<string, Caller>;
type CallerName = keyof typeof CALLERS;
const LIST_CALLERS = ['holder', 'non-holder', 'builder', 'anonymous'] as const satisfies readonly CallerName[];

// ── The services both transports read ─────────────────────────────────────────

/** The protocol's read rules: `?package=` scopes, `previewDrafts` overlays, `state: 'draft'` reads the pending row or throws `NO_DRAFT`. */
function protocolDouble() {
    return {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORE) })),
        getMetaItems: vi.fn(async ({ type, packageId, previewDrafts }: any) => {
            const t = singular(type);
            const items = new Map<string, any>((STORE[t] ?? []).map((i) => [i.name, clone(i)]));
            if (previewDrafts) for (const d of DRAFTS[t] ?? []) items.set(d.name, { ...clone(d), _draft: true });
            const listed = [...items.values()];
            return packageId ? listed.filter((i) => i._packageId === packageId) : listed;
        }),
        getMetaItem: vi.fn(async ({ type, name, state, previewDrafts }: any) => {
            const t = singular(type);
            const draft = (DRAFTS[t] ?? []).find((i) => i.name === name);
            if (state === 'draft') {
                if (!draft) {
                    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
                }
                return { type: t, name, item: clone(draft) };
            }
            const active = (STORE[t] ?? []).find((i) => i.name === name);
            const item = previewDrafts && draft ? { ...clone(draft), _draft: true } : (active ? clone(active) : undefined);
            return { type: t, name, item };
        }),
    };
}

const securityFor = (caller: Caller) => ({
    resolvePermissionSetNames: async () => caller.holdings,
    getMetadataReadableFields: async () => caller.readableFields,
});

const i18nDouble = {
    getLocales: () => Object.keys(BUNDLE),
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

/** The endpoint matcher (#5224): it serves `crm_served` and nothing else. */
const endpointMatcher = {
    matchEndpoint: async ({ path, method }: { path: string; method: string }) =>
        (path === '/crm/served' && method === 'GET' ? { endpoint: { name: 'crm_served', method, path } } as any : undefined),
};

// ── The two transports ────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; body: any; items?: any[]; item?: any; vary?: string }

const itemsOf = (data: any): any[] | undefined =>
    Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : undefined;

interface Boot { withI18n?: boolean }

/** The dispatcher, exactly as `createHonoApp` builds it: `new HttpDispatcher(kernel)`. */
function bootDispatcher(callerName: CallerName, opts: Boot = {}) {
    const caller = CALLERS[callerName];
    const protocol = protocolDouble();
    const services: Record<string, unknown> = {
        protocol,
        security: securityFor(caller),
        metadata: endpointMatcher,
        ...(opts.withI18n === false ? {} : { i18n: i18nDouble }),
    };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (as the sibling dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(caller.ctx);
    const read = async (path: string, query: Record<string, string> = {}, headers: Record<string, string> = {}): Promise<Answer> => {
        const res = await dispatcher.dispatch('GET', path, undefined, query, { request: { headers } } as any);
        const status = res.response?.status ?? 0;
        const body = res.response?.body;
        const vary = (res.response as any)?.headers?.Vary;
        return {
            status, code: body?.error?.code, body, vary,
            items: status === 200 ? itemsOf(body?.data) : undefined,
            item: status === 200 ? body?.data?.item : undefined,
        };
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

/** `RestServer` over the same services and the same caller — the reference answer. */
function bootRest(callerName: CallerName, opts: Boot = {}) {
    const caller = CALLERS[callerName];
    const protocol = protocolDouble();
    const rest: any = new RestServer(createMockServer() as any, protocol as any, {} as any);
    if (caller.ctx.userId) {
        const ctx = caller.ctx;
        rest.resolveExecCtx = async () => clone(ctx);
    }
    rest.securityServiceProvider = async () => securityFor(caller);
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
    rest.metadataServiceProvider = async () => endpointMatcher;
    if (opts.withI18n !== false) rest.i18nServiceProvider = async () => i18nDouble;
    rest.registerRoutes();
    const META = '/api/v1/meta';
    const routeOf = (path: string) => {
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
        if (!route) throw new Error(`GET ${path} is not registered`);
        return route;
    };
    const drive = async (routePath: string, path: string, params: Record<string, string>, query: Record<string, string>, headers: Record<string, string>): Promise<Answer> => {
        const res = makeRes();
        await routeOf(routePath).handler({ method: 'GET', path: `${META}${path}`, params, query, body: {}, headers }, res);
        const status = res.statusCode;
        return {
            status, code: res.body?.code ?? res.body?.error?.code, body: res.body, vary: res.headers.Vary,
            items: status === 200 ? itemsOf(res.body) : undefined,
            item: status === 200 ? res.body?.item : undefined,
        };
    };
    const read = async (path: string, query: Record<string, string> = {}, headers: Record<string, string> = {}): Promise<Answer> => {
        const [type, name, ...rest_] = path.replace(/^\/meta\//, '').split('/');
        if (rest_.length > 0) throw new Error(`bootRest.read drives list and item reads only: ${path}`);
        return name === undefined
            ? drive(`${META}/:type`, path.replace(/^\/meta/, ''), { type }, query, headers)
            : drive(`${META}/:type/:name`, path.replace(/^\/meta/, ''), { type, name }, query, headers);
    };
    return { read, protocol };
}

const text = (a: Answer): string => JSON.stringify(a.body ?? null);
const names = (items: any[] | undefined): string[] => (items ?? []).map((i: any) => i?.name);
const brief = (a: Answer) => ({
    status: a.status,
    code: a.code,
    items: a.items && JSON.stringify(a.items).slice(0, 400),
});

// ── The census axes ───────────────────────────────────────────────────────────

/**
 * One probe per query parameter the list reads (plus the `Accept-Language`
 * header the locale is read from first). Each probe is chosen to MOVE the
 * answer for at least one type: a parameter whose probe changes nothing proves
 * nothing.
 */
const PARAM_PROBES: ReadonlyArray<{ label: string; param?: string; query: Record<string, string>; headers?: Record<string, string> }> = [
    { label: '(none)', query: {} },
    { label: '?id=crm', param: 'id', query: { id: 'crm' } },
    { label: '?id=nope', param: 'id', query: { id: 'nope' } },
    { label: '?object=lead', param: 'object', query: { object: 'lead' } },
    { label: '?object=nope', param: 'object', query: { object: 'nope' } },
    { label: '?include=content', param: 'include', query: { include: 'content' } },
    { label: '?locale=zh-CN', param: 'locale', query: { locale: 'zh-CN' } },
    { label: 'Accept-Language: zh-CN', query: {}, headers: { 'accept-language': 'zh-CN' } },
    { label: '?package=crm', param: 'package', query: { package: 'crm' } },
    { label: '?preview=draft', param: 'preview', query: { preview: 'draft' } },
];
const PARAM_AXIS = new Set(PARAM_PROBES.map((p) => p.param).filter((p): p is string => !!p));

/** Every type a projection or a gate keys on, both spellings, plus every translatable type and an untouched control (`flow`). */
const TYPE_CELLS: readonly string[] = [
    'app', 'apps', 'view', 'views', 'doc', 'docs', 'book', 'books', 'api', 'apis',
    'object', 'objects', 'dashboard', 'dashboards', 'page', 'action', 'dataset', 'flow',
];
const TYPE_AXIS = new Set(TYPE_CELLS.map(singular));

// ── The derivation: the axes are checked against the source ───────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const REST_SERVER_SOURCE = resolve(HERE, '../../../rest/src/rest-server.ts');
const SHARED_CHAIN_SOURCE = resolve(HERE, '../../../rest/src/meta-item-read-gate.ts');

interface Derived { params: Set<string>; types: Set<string>; found: boolean }

function parse(file: string): ts.SourceFile {
    return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Query members read, and type literals compared, anywhere under `root`. */
function readsUnder(sf: ts.SourceFile, root: ts.Node, into: Derived): void {
    const walk = (n: ts.Node): void => {
        // `req.query?.id`, `req.query.object`, `query?.include`, `http.query?.locale` …
        if (ts.isPropertyAccessExpression(n) && /(^|\.)query$/.test(n.expression.getText(sf).replace(/\?/g, ''))) {
            into.params.add(n.name.text);
        }
        // `refuseRepeatedQueryParams(req, res, ['package', …])` — the handler's declared set.
        if (ts.isCallExpression(n) && n.expression.getText(sf) === 'refuseRepeatedQueryParams') {
            for (const arg of n.arguments) {
                if (ts.isArrayLiteralExpression(arg)) {
                    for (const el of arg.elements) if (ts.isStringLiteral(el)) into.params.add(el.text);
                }
            }
        }
        // `extractLocale(req …)` reads `?locale=` a frame down.
        if (ts.isCallExpression(n) && /(^|\.)extractLocale$/.test(n.expression.getText(sf))) into.params.add('locale');
        // `metaTypeSingular(req.params.type) === 'api'`, `metaType === 'doc'` …
        if (ts.isBinaryExpression(n)
            && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) {
            const [lit, other] = ts.isStringLiteral(n.right) ? [n.right, n.left] : ts.isStringLiteral(n.left) ? [n.left, n.right] : [];
            if (lit && other && /metaType|MetaType/.test(other.getText(sf))) into.types.add(lit.text);
        }
        ts.forEachChild(n, walk);
    };
    walk(root);
}

function propertyInitializer(sf: ts.SourceFile, literal: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    for (const p of literal.properties) if (ts.isPropertyAssignment(p) && p.name.getText(sf) === name) return p.initializer;
    return undefined;
}

/** `RestServer`'s `GET ${metaPath}/:type` handler, and the shared list chain it hands its answer to. */
function deriveListReads(): Derived {
    const derived: Derived = { params: new Set(), types: new Set(), found: false };
    const rest = parse(REST_SERVER_SOURCE);
    const visit = (n: ts.Node): void => {
        if (ts.isObjectLiteralExpression(n)) {
            const method = propertyInitializer(rest, n, 'method');
            const path = propertyInitializer(rest, n, 'path');
            const handler = propertyInitializer(rest, n, 'handler');
            if (method?.getText(rest) === "'GET'" && path?.getText(rest) === '`${metaPath}/:type`' && handler) {
                derived.found = true;
                readsUnder(rest, handler, derived);
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(rest);
    const chain = parse(SHARED_CHAIN_SOURCE);
    for (const s of chain.statements) {
        if (ts.isFunctionDeclaration(s) && s.name && ['createMetaListAnswer', 'metaRequestLocale', 'translateMetaList'].includes(s.name.text)) {
            readsUnder(chain, s, derived);
        }
    }
    return derived;
}

describe('[#20320] the census axes cover every read of RestServer\'s list handler and the shared chain', () => {
    const derived = deriveListReads();

    it('the handler is found where the census looks for it', () => {
        expect(derived.found, `GET \${metaPath}/:type in ${REST_SERVER_SOURCE}`).toBe(true);
    });

    it('every query parameter read is a census cell', () => {
        const missing = [...derived.params].filter((p) => !PARAM_AXIS.has(p)).sort();
        expect(missing, 'a list read of a parameter this census never sends: add a probe that moves its answer').toEqual([]);
    });

    it('every type a projection keys on, and every translatable type, is a census cell', () => {
        const wanted = new Set([...derived.types, ...TRANSLATABLE_METADATA_TYPES]);
        const missing = [...wanted].filter((t) => !TYPE_AXIS.has(t)).sort();
        expect(missing, 'a type the list chain treats specially that this census never lists: add a type cell (and fixtures)').toEqual([]);
    });
});

// ── Row A: the list projections, every type × parameter × caller ──────────────

describe('[#20320] row A: the dispatcher lists what RestServer lists — every type × query parameter × caller', () => {
    for (const type of TYPE_CELLS) {
        for (const probe of PARAM_PROBES) {
            it(`GET /meta/${type} ${probe.label}`, async () => {
                const mismatches: unknown[] = [];
                for (const who of LIST_CALLERS) {
                    const dispatcher = await bootDispatcher(who).read(`/meta/${type}`, probe.query, probe.headers);
                    const rest = await bootRest(who).read(`/meta/${type}`, probe.query, probe.headers);
                    const same = dispatcher.status === rest.status
                        && dispatcher.code === rest.code
                        && JSON.stringify(dispatcher.items) === JSON.stringify(rest.items)
                        && (rest.status !== 200 || dispatcher.vary === rest.vary);
                    if (!same) mismatches.push({ who, dispatcher: { ...brief(dispatcher), vary: dispatcher.vary }, rest: { ...brief(rest), vary: rest.vary } });
                }
                expect(mismatches).toEqual([]);
            });
        }
    }
});

describe('[#20320] row A: the reference moves — each probe changes RestServer\'s answer for the type it targets', () => {
    it('?id= narrows the app list; ?object= switches views; the doc slim, locale and translation all move', async () => {
        const { read } = bootRest('holder');
        expect(names((await read('/meta/app', { id: 'crm' })).items)).toEqual(['crm']);
        expect((await read('/meta/app', { id: 'nope' })).items).toEqual([]);
        expect(names((await read('/meta/view', { object: 'lead' })).items)).toEqual(['lead_mine', 'lead_all']);
        expect((await read('/meta/views', { object: 'nope' })).items).toEqual([]);
        const docs = await read('/meta/docs');
        expect(text(docs)).not.toContain('Welcome aboard.');
        expect(text(await read('/meta/docs', { include: 'content' }))).toContain(DOC_SECRET);
        const zh = await read('/meta/doc', { locale: 'zh-CN' });
        expect(zh.items?.find((d: any) => d.name === 'crm_intro')?.label).toBe('入门');
        expect(text(zh)).not.toContain('"translations"');
        const apps = await read('/meta/apps', {}, { 'accept-language': 'zh-CN' });
        expect(apps.items?.find((a: any) => a.name === 'crm')?.label).toBe('客户管理');
        expect(names((await read('/meta/api')).items)).toEqual(['crm_served']);
        expect(names((await read('/meta/apis')).items)).toEqual(['crm_served']);
    });
});

// ── Row B: the `public` audience, anonymously ─────────────────────────────────

describe('[#20320] row B: an anonymous read of a public book or doc is served on both transports', () => {
    for (const path of ['/meta/book', '/meta/books', '/meta/doc', '/meta/docs']) {
        it(`GET ${path}: the public items, and only those`, async () => {
            const dispatcher = await bootDispatcher('anonymous').read(path);
            const rest = await bootRest('anonymous').read(path);
            expect({ status: rest.status, items: names(rest.items) }).toEqual({
                status: 200, items: path.includes('book') ? ['public_guide'] : ['public_faq'],
            });
            expect({ status: dispatcher.status, code: dispatcher.code }).toEqual({ status: rest.status, code: rest.code });
            expect(dispatcher.items).toEqual(rest.items);
            expect(text(dispatcher)).not.toContain(DOC_SECRET);
        });
    }

    for (const [path, status] of [
        ['/meta/book/public_guide', 200],
        ['/meta/books/public_guide', 200],
        ['/meta/doc/public_faq', 200],
        ['/meta/docs/public_faq', 200],
        // Reachability is not authorization: the §6.7 gate still refuses these.
        ['/meta/book/help_center', 401],
        ['/meta/doc/crm_admin_runbook', 401],
    ] as const) {
        it(`GET ${path}: ${status} on both`, async () => {
            const dispatcher = await bootDispatcher('anonymous', { withI18n: false }).read(path);
            const rest = await bootRest('anonymous', { withI18n: false }).read(path);
            expect({ status: rest.status, code: rest.status === 200 ? undefined : rest.code })
                .toEqual({ status, code: status === 200 ? undefined : 'UNAUTHENTICATED' });
            expect({ status: dispatcher.status, code: dispatcher.code }).toEqual({ status: rest.status, code: rest.code });
            if (status === 200) expect(dispatcher.item).toEqual(rest.item);
            expect(text(dispatcher)).not.toContain(DOC_SECRET);
        });
    }

    it('control: every other type keeps the anonymous deny on both transports, before any read', async () => {
        for (const path of ['/meta/object', '/meta/objects', '/meta/app', '/meta/view', '/meta/object/invoice', '/meta/app/crm']) {
            const { read, protocol } = bootDispatcher('anonymous');
            const dispatcher = await read(path);
            const rest = await bootRest('anonymous').read(path);
            expect({ status: rest.status, code: rest.code }, path).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
            expect({ status: dispatcher.status, code: dispatcher.code }, path).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
            expect(protocol.getMetaItems, path).not.toHaveBeenCalled();
            expect(protocol.getMetaItem, path).not.toHaveBeenCalled();
        }
    });

    it('control: the exemption reaches only the dispatcher\'s own list and item reads — /published and an unrouted book path stay 401', async () => {
        for (const path of ['/meta/book/public_guide/published', '/meta/book/public_guide/tree', '/meta/doc/public_faq/published']) {
            const { read, protocol } = bootDispatcher('anonymous');
            const res = await read(path);
            expect({ status: res.status, code: res.code }, path).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
            expect(protocol.getMetaItem, path).not.toHaveBeenCalled();
        }
    });
});

// ── The `?state=draft` row, on the item read ──────────────────────────────────

describe('[#20320] the ?state=draft row: the dispatcher\'s item read answers what RestServer\'s answers', () => {
    const CELLS = [
        // The pending draft: whole for the author, pruned for the builder.
        '/meta/app/crm',
        '/meta/apps/crm',
        // A draft-only app: the draft for both admitted callers.
        '/meta/app/beacon',
        // Nothing pending: `404 NO_DRAFT` for both admitted callers.
        '/meta/app/helpdesk',
        // An object's pending draft (the object branch).
        '/meta/object/invoice',
    ];

    for (const path of CELLS) {
        for (const who of ['builder', 'author'] as const) {
            it(`GET ${path}?state=draft × ${who}`, async () => {
                const dispatcher = await bootDispatcher(who, { withI18n: false }).read(path, { state: 'draft' });
                const rest = await bootRest(who, { withI18n: false }).read(path, { state: 'draft' });
                expect({ status: dispatcher.status, code: dispatcher.code }).toEqual({ status: rest.status, code: rest.code });
                expect(dispatcher.item).toEqual(rest.item);
            });
        }
    }

    it('the reference: whole for the author, pruned per caller for the builder, NO_DRAFT where nothing is pending', async () => {
        const nav = (a: Answer) => (a.item?.navigation ?? []).map((e: any) => e.id);
        const author = await bootRest('author', { withI18n: false }).read('/meta/app/crm', { state: 'draft' });
        const builder = await bootRest('builder', { withI18n: false }).read('/meta/app/crm', { state: 'draft' });
        expect(author.item?.label).toBe('CRM (draft)');
        expect(nav(author)).toEqual(['nav_leads', 'nav_finance_ledger', 'nav_admin_runbook', 'nav_org_directory', 'nav_finance_forecast']);
        expect(builder.item?.label).toBe('CRM (draft)');
        // Per caller only: the finance entries and the gated doc go; the service-bound entry stays (a stored version).
        expect(nav(builder)).toEqual(['nav_leads', 'nav_org_directory']);
        const none = await bootRest('builder', { withI18n: false }).read('/meta/app/helpdesk', { state: 'draft' });
        expect({ status: none.status, code: none.code }).toEqual({ status: 404, code: 'NO_DRAFT' });
    });

    for (const path of ['/meta/app/crm', '/meta/app/beacon', '/meta/app/helpdesk', '/meta/object/invoice']) {
        it(`a caller the draft doors do not admit is answered the plain read, byte for byte, on each transport: GET ${path}?state=draft × non-holder`, async () => {
            for (const boot of [bootDispatcher, bootRest]) {
                const { read, protocol } = boot('non-holder', { withI18n: false });
                const plain = await read(path);
                const res = await read(path, { state: 'draft' });
                expect({ status: res.status, body: res.body }).toEqual({ status: plain.status, body: plain.body });
                expect(text(res)).not.toContain('(draft)');
                expect(protocol.getMetaItem.mock.calls.map(([r]: any[]) => r).filter((r: any) => r?.state === 'draft')).toEqual([]);
            }
        });
    }
});
