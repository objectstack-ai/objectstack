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
 *
 * [#20478] The layered view joined the census on both of its spellings: the
 * item read's deprecated `?layers=` flag is an item probe like every other
 * parameter, and `GET /meta/:type/:name/layers` has its own route census. The
 * dispatcher answered the flag with the plain read's `{ type, name, item }` and
 * the route with a located `404 ROUTE_NOT_FOUND`; both transports now hand it to
 * `createMetaLayeredAnswer`, and the item census no longer excludes any
 * parameter `RestServer`'s item read reads.
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
    picklist: [{ name: 'industry', label: 'Industry', options: [{ label: 'Technology', value: 'technology' }] }],
    flow: [{ name: 'on_lead', label: 'On lead', type: 'autolaunched' }],
};

/**
 * [#20478] Env-wide overlay rows (a `sys_metadata` `state: 'active'` row over a
 * packaged baseline), the `overlay` layer of the layered view: `crm` relabelled
 * with one more gated entry, and `invoice` relabelled.
 */
const OVERLAYS: Record<string, any[]> = {
    app: [{
        ...CRM_APP,
        label: 'CRM (overlay)',
        navigation: [
            ...CRM_APP.navigation,
            { id: 'nav_finance_reports', type: 'page', label: 'Reports', pageName: 'reports', requiredPermissions: ['finance.access'] },
        ],
    }],
    object: [{ ...INVOICE_OBJECT, label: 'Invoice (overlay)' }],
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
    /** `undefined` — the field universe is unresolvable: the ADR-0106 D6 tier-2 `undetermined` posture. */
    readableFields: string[] | undefined;
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
    /** [#20408] A member whose field visibility could not be determined (ADR-0106 D6 tier 2). */
    undetermined: {
        ctx: { userId: 'u_undetermined', isSystem: false, systemPermissions: [] },
        holdings: [],
        readableFields: undefined,
    },
} satisfies Record<string, Caller>;
type CallerName = keyof typeof CALLERS;
const LIST_CALLERS = ['holder', 'non-holder', 'builder', 'anonymous'] as const satisfies readonly CallerName[];

// ── The services both transports read ─────────────────────────────────────────

/** The protocol's read rules: `?package=` scopes, `previewDrafts` overlays, `state: 'draft'` reads the pending row or throws `NO_DRAFT`. */
function protocolDouble(opts: { withoutLayered?: boolean } = {}) {
    const double = {
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
        /**
         * [#20478] The layered read, in the shape `metadata-protocol` answers it:
         * `code` the packaged baseline (scoped by `?package=`, ADR-0048),
         * `overlay` the active overlay row, `effective` the overlay over the code
         * layer — every layer `null` with nothing behind the name.
         */
        getMetaItemLayered: vi.fn(async ({ type, name, packageId }: any) => {
            const t = singular(type);
            const code = (STORE[t] ?? []).find((i) => i.name === name && (!packageId || i._packageId === packageId));
            const overlay = (OVERLAYS[t] ?? []).find((i) => i.name === name);
            const effective = overlay ?? code;
            return {
                type: t, name,
                code: code ? clone(code) : null,
                overlay: overlay ? clone(overlay) : null,
                overlayScope: overlay ? 'env' : null,
                effective: effective ? clone(effective) : null,
                lock: 'none', editable: true, deletable: true, resettable: overlay !== undefined,
            };
        }),
    };
    return opts.withoutLayered ? { ...double, getMetaItemLayered: undefined } : double;
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

interface Answer {
    status: number; code?: string; body: any; items?: any[]; item?: any; vary?: string; cacheControl?: string;
    /** [#20478] The deprecated `?layers=` flag's RFC 9745 / RFC 8288 pair. */
    deprecation?: string; link?: string;
}

const itemsOf = (data: any): any[] | undefined =>
    Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : undefined;

interface Boot {
    withI18n?: boolean;
    /** [#20478] A protocol with no layered read (`getMetaItemLayered` absent). */
    withoutLayered?: boolean;
}

/** The dispatcher, exactly as `createHonoApp` builds it: `new HttpDispatcher(kernel)`. */
function bootDispatcher(callerName: CallerName, opts: Boot = {}) {
    const caller: Caller = CALLERS[callerName];
    const protocol = protocolDouble(opts);
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
        // [#20478] The request carries its own URL, as `createHonoApp` hands
        // `dispatch()` the raw Fetch `Request` (`c.req.raw`) — the only
        // statement of where this host serves the item, which the `?layers=`
        // flag names its successor under.
        const request = { headers, url: `http://localhost/api/v1${path}` };
        const res = await dispatcher.dispatch('GET', path, undefined, query, { request } as any);
        const status = res.response?.status ?? 0;
        const body = res.response?.body;
        const vary = (res.response as any)?.headers?.Vary;
        const cacheControl = (res.response as any)?.headers?.['Cache-Control'];
        const deprecation = (res.response as any)?.headers?.Deprecation;
        const link = (res.response as any)?.headers?.Link;
        return {
            status, code: body?.error?.code, body, vary, cacheControl, deprecation, link,
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
    const caller: Caller = CALLERS[callerName];
    const protocol = protocolDouble(opts);
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
            // [#20478] A refusal's code: a served layered body carries its own
            // `code` — the packaged layer — which is not one.
            status, code: status === 200 ? undefined : res.body?.code ?? res.body?.error?.code, body: res.body, vary: res.headers.Vary,
            cacheControl: res.headers['Cache-Control'],
            deprecation: res.headers.Deprecation, link: res.headers.Link,
            items: status === 200 ? itemsOf(res.body) : undefined,
            item: status === 200 ? res.body?.item : undefined,
        };
    };
    const read = async (path: string, query: Record<string, string> = {}, headers: Record<string, string> = {}): Promise<Answer> => {
        const [type, name, ...rest_] = path.replace(/^\/meta\//, '').split('/');
        if (type === 'book' && rest_.length === 1 && rest_[0] === 'tree') {
            return drive(`${META}/book/:name/tree`, path.replace(/^\/meta/, ''), { name }, query, headers);
        }
        // [#20478] The layered view's own route.
        if (rest_.length === 1 && rest_[0] === 'layers') {
            return drive(`${META}/:type/:name/layers`, path.replace(/^\/meta/, ''), { type, name }, query, headers);
        }
        if (rest_.length > 0) throw new Error(`bootRest.read drives list, item, layers and book-tree reads only: ${path}`);
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
    // [#20408] The switch's value is compared case-insensitively on `RestServer`.
    { label: '?preview=DRAFT', param: 'preview', query: { preview: 'DRAFT' } },
];
const PARAM_AXIS = new Set(PARAM_PROBES.map((p) => p.param).filter((p): p is string => !!p));

/** Every type a projection or a gate keys on, both spellings, plus every translatable type and an untouched control (`flow`). */
const TYPE_CELLS: readonly string[] = [
    'app', 'apps', 'view', 'views', 'doc', 'docs', 'book', 'books', 'api', 'apis',
    'object', 'objects', 'dashboard', 'dashboards', 'page', 'action', 'dataset', 'picklist', 'flow',
    // [#20408] A segment that names no metadata type: `RestServer` refuses it
    // (`refuseUnknownMetaListType`) rather than listing an empty collection.
    'totally_invented_type',
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
                        && (rest.status !== 200 || dispatcher.vary === rest.vary)
                        && dispatcher.cacheControl === rest.cacheControl;
                    if (!same) {
                        mismatches.push({
                            who,
                            dispatcher: { ...brief(dispatcher), vary: dispatcher.vary, cacheControl: dispatcher.cacheControl },
                            rest: { ...brief(rest), vary: rest.vary, cacheControl: rest.cacheControl },
                        });
                    }
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
            // The document served: its identity, label and body. (The item read's
            // doc LOCALE collapse — the rest of the answer — is pinned by the
            // [#20408] item census below, every caller × query parameter.)
            const served = (a: Answer) => a.item && { name: a.item.name, label: a.item.label, content: a.item.content };
            if (status === 200) expect(served(dispatcher)).toEqual(served(rest));
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

    it('control: the exemption reaches only the dispatcher\'s own list, item and book-tree reads — /published and an unrouted book path stay 401', async () => {
        // [#20408] `/meta/book/:name/tree` is a route here now, and exempt as on
        // `RestServer` (its census is below); the plural spelling is no route on
        // either transport, so it keeps the deny.
        for (const path of ['/meta/book/public_guide/published', '/meta/books/public_guide/tree', '/meta/doc/public_faq/published']) {
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

// ── [#20408] The item read, the book-tree route, and the cache posture ────────
//
// #20320 closed the LIST. The item read and the route beside it had the same two
// transports and the same split, measured on this file's fixtures before the
// fix: the dispatcher's item read did not translate, did not collapse a doc to
// the request's locale, served no `sortability` beside an object schema, read
// `?preview=` case-sensitively and ignored `?preview=draft` on the object
// branch; the list compared `?preview=` case-sensitively and served an empty
// collection for a segment that names no type; `GET /meta/book/:name/tree`
// was no route at all; and an object schema served under an UNDETERMINED field
// visibility (ADR-0106 D6 tier 2) went out with no `Cache-Control`, where
// `RestServer` answers `private, no-store`. Each is now a census cell, and each
// census is derived from `RestServer`'s handler like the list's above.

const ITEM_PROBES: ReadonlyArray<{ label: string; param?: string; query: Record<string, string>; headers?: Record<string, string> }> = [
    { label: '(none)', query: {} },
    { label: '?state=draft', param: 'state', query: { state: 'draft' } },
    { label: '?state=DRAFT', param: 'state', query: { state: 'DRAFT' } },
    { label: '?preview=draft', param: 'preview', query: { preview: 'draft' } },
    { label: '?preview=DRAFT', param: 'preview', query: { preview: 'DRAFT' } },
    { label: '?package=crm', param: 'package', query: { package: 'crm' } },
    { label: '?locale=zh-CN', param: 'locale', query: { locale: 'zh-CN' } },
    { label: 'Accept-Language: zh-CN', query: {}, headers: { 'accept-language': 'zh-CN' } },
    // [#20478] The layered view's deprecated spelling — any non-empty value —
    // and the empty value, which is the plain read on both transports.
    { label: '?layers=true', param: 'layers', query: { layers: 'true' } },
    { label: '?layers=', param: 'layers', query: { layers: '' } },
];
const ITEM_PARAM_AXIS = new Set(ITEM_PROBES.map((p) => p.param).filter((p): p is string => !!p));

/** One cell per type the item read keys on (both spellings where a gate folds), per translatable type, plus absences and refusals. */
const ITEM_CELLS: readonly string[] = [
    '/meta/app/crm', '/meta/apps/crm',
    // `requiredPermissions` the non-holder lacks → 403; unpublished → absent to a non-builder.
    '/meta/app/payroll', '/meta/app/launchpad',
    // A draft-only app, an app with no draft, and a name with nothing behind it.
    '/meta/app/beacon', '/meta/app/helpdesk', '/meta/app/no_such_app',
    '/meta/view/lead_all', '/meta/views/lead_all',
    '/meta/doc/crm_intro', '/meta/docs/crm_intro', '/meta/doc/crm_admin_runbook', '/meta/doc/public_faq',
    '/meta/book/admin_guide', '/meta/books/help_center', '/meta/book/public_guide',
    '/meta/object/invoice', '/meta/objects/invoice',
    '/meta/dashboard/ops', '/meta/dashboards/ops',
    '/meta/page/home', '/meta/action/close_case', '/meta/dataset/pipeline', '/meta/picklist/industry', '/meta/flow/on_lead', '/meta/api/crm_served',
];
const ITEM_TYPE_AXIS = new Set(ITEM_CELLS.map((c) => singular(c.split('/')[2])));
const ITEM_CALLERS = ['holder', 'non-holder', 'builder', 'author'] as const satisfies readonly CallerName[];

/** `GET /meta/book/:name/tree` — every declared book, the implicit per-package book, and a name nothing claims. */
const TREE_CELLS: readonly string[] = ['admin_guide', 'help_center', 'public_guide', 'crm', 'no_such_book'];
const TREE_PROBES: ReadonlyArray<{ label: string; param?: string; query: Record<string, string>; headers?: Record<string, string> }> = [
    { label: '(none)', query: {} },
    { label: '?package=crm', param: 'package', query: { package: 'crm' } },
    { label: '?locale=zh-CN', param: 'locale', query: { locale: 'zh-CN' } },
    { label: 'Accept-Language: zh-CN', query: {}, headers: { 'accept-language': 'zh-CN' } },
];
const TREE_PARAM_AXIS = new Set(TREE_PROBES.map((p) => p.param).filter((p): p is string => !!p));
const TREE_CALLERS = ['holder', 'non-holder', 'builder', 'anonymous'] as const satisfies readonly CallerName[];

/**
 * [#20478] `GET /meta/:type/:name/layers` — the layered view's own route: one
 * probe per parameter it reads, and the locale a control (the view is not
 * translated, so `Accept-Language` must move nothing on either transport).
 */
const LAYERS_PROBES: ReadonlyArray<{ label: string; param?: string; query: Record<string, string>; headers?: Record<string, string> }> = [
    { label: '(none)', query: {} },
    { label: '?package=crm', param: 'package', query: { package: 'crm' } },
    { label: 'Accept-Language: zh-CN', query: {}, headers: { 'accept-language': 'zh-CN' } },
];
const LAYERS_PARAM_AXIS = new Set(LAYERS_PROBES.map((p) => p.param).filter((p): p is string => !!p));

/** The item and tree answers compared whole: the envelope (or tree) served, and the headers either transport sets. */
const served = (a: Answer, transport: 'dispatcher' | 'rest'): unknown =>
    (a.status === 200 ? (transport === 'dispatcher' ? a.body?.data : a.body) : undefined);
const sameAnswer = (dispatcher: Answer, rest: Answer): boolean =>
    dispatcher.status === rest.status
    && dispatcher.code === rest.code
    && JSON.stringify(served(dispatcher, 'dispatcher')) === JSON.stringify(served(rest, 'rest'))
    && (rest.status !== 200 || dispatcher.vary === rest.vary)
    && dispatcher.cacheControl === rest.cacheControl
    // [#20478] On EVERY answer of the deprecated flag, refusals included.
    && dispatcher.deprecation === rest.deprecation
    && dispatcher.link === rest.link;
const headersOf = (a: Answer) => ({ vary: a.vary, cacheControl: a.cacheControl, deprecation: a.deprecation, link: a.link });
const mismatchOf = (who: string, dispatcher: Answer, rest: Answer) => ({
    who,
    dispatcher: { status: dispatcher.status, code: dispatcher.code, ...headersOf(dispatcher), body: JSON.stringify(served(dispatcher, 'dispatcher'))?.slice(0, 400) },
    rest: { status: rest.status, code: rest.code, ...headersOf(rest), body: JSON.stringify(served(rest, 'rest'))?.slice(0, 400) },
});

/**
 * The shared functions `RestServer`'s item and tree handlers hand their answer
 * to — read as part of the handler, so a parameter or a type the SHARED step
 * starts reading is a derived cell too. A name absent from the module derives
 * nothing (the handler's own reads still do).
 */
const SHARED_ITEM_FUNCTIONS = [
    'createMetaItemAnswer', 'createMetaItemReadGate', 'metaRequestLocale', 'translateMetaDocument', 'translateMetaEnvelope',
    // [#20478] The `?layers=` flag's parse, and the layered answer it serves.
    'wantsMetaItemLayers', 'createMetaLayeredAnswer',
];
const SHARED_TREE_FUNCTIONS = ['createMetaBookTreeAnswer', 'resolveDocsAudience', 'metaRequestLocale'];
const SHARED_LAYERS_FUNCTIONS = ['createMetaLayeredAnswer', 'createMetaItemReadGate'];
/** [#20478] `RestServer`'s own helper both layered spellings call — read as part of each handler. */
const LAYERED_METHODS = ['serveMetaItemLayered'];

function deriveRouteReads(routePath: string, sharedFunctions: readonly string[], methods: readonly string[] = []): Derived {
    const derived: Derived = { params: new Set(), types: new Set(), found: false };
    const rest = parse(REST_SERVER_SOURCE);
    const visit = (n: ts.Node): void => {
        if (ts.isObjectLiteralExpression(n)) {
            const method = propertyInitializer(rest, n, 'method');
            const path = propertyInitializer(rest, n, 'path');
            const handler = propertyInitializer(rest, n, 'handler');
            if (method?.getText(rest) === "'GET'" && path?.getText(rest) === routePath && handler) {
                derived.found = true;
                readsUnder(rest, handler, derived);
            }
        }
        // [#20478] A private helper the handler delegates to reads its own
        // parameters a frame down (`serveMetaItemLayered` reads `?package=`).
        if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && methods.includes(n.name.text)) readsUnder(rest, n, derived);
        ts.forEachChild(n, visit);
    };
    visit(rest);
    const chain = parse(SHARED_CHAIN_SOURCE);
    for (const s of chain.statements) {
        if (ts.isFunctionDeclaration(s) && s.name && sharedFunctions.includes(s.name.text)) readsUnder(chain, s, derived);
    }
    return derived;
}

describe('[#20408] the item and book-tree census axes cover every read of RestServer\'s handlers and the shared steps', () => {
    const item = deriveRouteReads('`${metaPath}/:type/:name`', SHARED_ITEM_FUNCTIONS, LAYERED_METHODS);
    const tree = deriveRouteReads('`${metaPath}/book/:name/tree`', SHARED_TREE_FUNCTIONS);
    const layers = deriveRouteReads('`${metaPath}/:type/:name/layers`', SHARED_LAYERS_FUNCTIONS, LAYERED_METHODS);

    it('every handler is found where the census looks for it', () => {
        expect(item.found, `GET \${metaPath}/:type/:name in ${REST_SERVER_SOURCE}`).toBe(true);
        expect(tree.found, `GET \${metaPath}/book/:name/tree in ${REST_SERVER_SOURCE}`).toBe(true);
        expect(layers.found, `GET \${metaPath}/:type/:name/layers in ${REST_SERVER_SOURCE}`).toBe(true);
    });

    it('every query parameter the item read reads is a census cell — [#20478] `?layers=` included, with no exclusion left', () => {
        const missing = [...item.params].filter((p) => !ITEM_PARAM_AXIS.has(p)).sort();
        expect(missing, 'an item read of a parameter this census never sends: add a probe that moves its answer').toEqual([]);
        // The flag is read, so its probe is not a dead cell.
        expect(item.params.has('layers')).toBe(true);
    });

    it('[#20478] every query parameter the layered route reads is a census cell', () => {
        expect([...layers.params].filter((p) => !LAYERS_PARAM_AXIS.has(p)).sort()).toEqual([]);
        expect(layers.params.has('package')).toBe(true);
    });

    it('every type the item read keys on, and every translatable type, is a census cell', () => {
        const wanted = new Set([...item.types, ...TRANSLATABLE_METADATA_TYPES]);
        expect([...wanted].filter((t) => !ITEM_TYPE_AXIS.has(t)).sort()).toEqual([]);
    });

    it('every query parameter the book tree reads is a census cell', () => {
        expect([...tree.params].filter((p) => !TREE_PARAM_AXIS.has(p)).sort()).toEqual([]);
    });
});

describe('[#20408] the item read: the dispatcher answers what RestServer answers — every cell × query parameter × caller', () => {
    for (const path of ITEM_CELLS) {
        for (const probe of ITEM_PROBES) {
            it(`GET ${path} ${probe.label}`, async () => {
                const mismatches: unknown[] = [];
                for (const who of ITEM_CALLERS) {
                    const dispatcher = await bootDispatcher(who).read(path, probe.query, probe.headers);
                    const rest = await bootRest(who).read(path, probe.query, probe.headers);
                    if (!sameAnswer(dispatcher, rest)) mismatches.push(mismatchOf(who, dispatcher, rest));
                }
                expect(mismatches).toEqual([]);
            });
        }
    }
});

describe('[#20408] the item read: the reference moves — each probe changes RestServer\'s answer for the cell it targets', () => {
    it('translation, the doc locale, sortability, both draft switches in any case, and the object preview all move', async () => {
        const { read } = bootRest('holder');
        expect((await read('/meta/app/crm', {}, { 'accept-language': 'zh-CN' })).item?.label).toBe('客户管理');
        const zhDoc = await read('/meta/doc/crm_intro', { locale: 'zh-CN' });
        expect(zhDoc.item?.label).toBe('入门');
        expect(text(zhDoc)).not.toContain('"translations"');
        expect(Object.keys((await read('/meta/object/invoice')).body ?? {})).toContain('sortability');
        const builder = bootRest('builder').read;
        expect((await builder('/meta/app/crm', { preview: 'DRAFT' })).item?.label).toBe('CRM (draft)');
        expect((await builder('/meta/app/crm', { state: 'DRAFT' })).item?.label).toBe('CRM (draft)');
        expect((await builder('/meta/object/invoice', { preview: 'draft' })).item?.label).toBe('Invoice (draft)');
    });

    it('the list: ?preview=DRAFT overlays the drafts, and a segment that names no type is refused', async () => {
        expect(names((await bootRest('builder').read('/meta/app', { preview: 'DRAFT' })).items)).toContain('beacon');
        const invented = await bootRest('holder').read('/meta/totally_invented_type');
        expect({ status: invented.status, code: invented.code }).toEqual({ status: 400, code: 'INVALID_REQUEST' });
    });
});

// ── [#20478] The layered view, on both of its spellings ──────────────────────
//
// Measured on this file's fixtures before the fix: every `?layers=true` item
// cell was red (the dispatcher answered the plain read's `{ type, name, item }`,
// with no `Deprecation` and, for the author, the app PRUNED where ruling
// 5856774816 serves it whole), and every `/layers` cell answered a located
// `404 ROUTE_NOT_FOUND`. The item census above carries the flag as a probe;
// the route has its own census here.

describe('[#20478] GET /meta/:type/:name/layers: the dispatcher serves the route RestServer serves — every cell × query parameter × caller', () => {
    for (const path of ITEM_CELLS) {
        for (const probe of LAYERS_PROBES) {
            it(`GET ${path}/layers ${probe.label}`, async () => {
                const mismatches: unknown[] = [];
                for (const who of ITEM_CALLERS) {
                    const dispatcher = await bootDispatcher(who).read(`${path}/layers`, probe.query, probe.headers);
                    const rest = await bootRest(who).read(`${path}/layers`, probe.query, probe.headers);
                    if (!sameAnswer(dispatcher, rest)) mismatches.push(mismatchOf(who, dispatcher, rest));
                }
                expect(mismatches).toEqual([]);
            });
        }
    }
});

describe('[#20478] the layered view: the reference moves — each spelling and probe changes RestServer\'s answer', () => {
    const nav = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);
    const layerNav = (a: Answer) => ({ code: nav(a.body?.code), overlay: nav(a.body?.overlay), effective: nav(a.body?.effective) });
    const WHOLE = ['nav_leads', 'nav_finance_ledger', 'nav_admin_runbook', 'nav_org_directory'];
    const PRUNED = ['nav_leads', 'nav_org_directory'];

    it('?layers=true answers the three layers, not the plain read, under Deprecation and a Link to the successor', async () => {
        const { read } = bootRest('author');
        const flagged = await read('/meta/app/crm', { layers: 'true' });
        expect(Object.keys(flagged.body ?? {})).toEqual(expect.arrayContaining(['code', 'overlay', 'effective']));
        expect(flagged.body?.item).toBeUndefined();
        expect(flagged.body?.effective?.label).toBe('CRM (overlay)');
        expect({ deprecation: flagged.deprecation, link: flagged.link })
            .toEqual({ deprecation: 'true', link: '</api/v1/meta/app/crm/layers>; rel="successor-version"' });
        const plain = await read('/meta/app/crm', { layers: '' });
        expect(plain.body?.item?.label).toBe('CRM');
        expect(plain.deprecation).toBeUndefined();
    });

    it('the route answers the flag\'s body, with no Deprecation', async () => {
        const { read } = bootRest('author');
        const route = await read('/meta/app/crm/layers');
        const flagged = await read('/meta/app/crm', { layers: 'true' });
        expect(route.body).toEqual(flagged.body);
        expect({ deprecation: route.deprecation, link: route.link }).toEqual({ deprecation: undefined, link: undefined });
    });

    it('ruling 5856774816: every layer whole for the author, pruned per caller for everyone else — the plain read prunes the author too', async () => {
        const author = await bootRest('author').read('/meta/app/crm/layers');
        expect(layerNav(author)).toEqual({ code: WHOLE, overlay: [...WHOLE, 'nav_finance_reports'], effective: [...WHOLE, 'nav_finance_reports'] });
        const member = await bootRest('non-holder').read('/meta/app/crm/layers');
        expect(layerNav(member)).toEqual({ code: PRUNED, overlay: PRUNED, effective: PRUNED });
        // Per caller only: the service-bound entry and widget stay on a stored version.
        expect(nav((await bootRest('author').read('/meta/app/crm')).item)).toEqual(['nav_leads']);
        const ops = await bootRest('holder').read('/meta/dashboard/ops/layers');
        expect((ops.body?.effective?.widgets ?? []).map((w: any) => w.id)).toEqual(['w_open_cases', 'w_org_kpi']);
        expect(((await bootRest('holder').read('/meta/dashboard/ops')).item?.widgets ?? []).map((w: any) => w.id)).toEqual(['w_open_cases']);
    });

    it('a refusal is the plain read\'s, and the flag still carries its Deprecation on it', async () => {
        const payroll = await bootRest('non-holder').read('/meta/app/payroll', { layers: 'true' });
        expect({ status: payroll.status, code: payroll.code, deprecation: payroll.deprecation })
            .toEqual({ status: 403, code: 'PERMISSION_DENIED', deprecation: 'true' });
        const launchpad = await bootRest('non-holder').read('/meta/app/launchpad/layers');
        expect({ status: launchpad.status, code: launchpad.code }).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    });

    it('?package= scopes the code layer, and the object mask projects every layer', async () => {
        // [#20507] Scoped to a package that ships no `crm`, the code layer is
        // gone and the overlay row still answers for the name.
        const scoped = await bootRest('non-holder').read('/meta/app/crm/layers', { package: 'elsewhere' });
        expect({ status: scoped.status, code: scoped.body?.code, effective: scoped.body?.effective?.label })
            .toEqual({ status: 200, code: null, effective: 'CRM (overlay)' });
        // …and a scope that leaves NO layer behind the name is its absence, the
        // plain read's 404 — never a 200 with every layer null.
        const emptied = await bootRest('non-holder').read('/meta/app/payroll/layers', { package: 'crm' });
        expect({ status: emptied.status, code: emptied.code }).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        const invoice = await bootRest('non-holder').read('/meta/object/invoice/layers');
        for (const layer of ['code', 'overlay', 'effective']) expect(Object.keys(invoice.body?.[layer]?.fields ?? {}), layer).toEqual(['amount']);
    });
});

describe('[#20478] the layered view: the controls', () => {
    it('an anonymous ?layers=true on a public book reaches its §6.7 gate on both transports; a gated one is refused; /layers keeps the deny', async () => {
        for (const [path, query, status] of [
            ['/meta/book/public_guide', { layers: 'true' }, 200],
            ['/meta/doc/public_faq', { layers: 'true' }, 200],
            ['/meta/doc/crm_admin_runbook', { layers: 'true' }, 401],
            ['/meta/book/public_guide/layers', {}, 401],
        ] as const) {
            const { read, protocol } = bootDispatcher('anonymous');
            const dispatcher = await read(path, query);
            const rest = await bootRest('anonymous').read(path, query);
            expect({ status: rest.status }, path).toEqual({ status });
            expect(sameAnswer(dispatcher, rest) ? [] : [mismatchOf('anonymous', dispatcher, rest)], path).toEqual([]);
            expect(text(dispatcher), path).not.toContain(DOC_SECRET);
            if (path.endsWith('/layers')) expect(protocol.getMetaItemLayered, path).not.toHaveBeenCalled();
        }
    });

    it('a protocol with no layered read: /layers is 501 NOT_IMPLEMENTED and ?layers=true the plain read, on both transports', async () => {
        for (const [path, query] of [['/meta/app/crm/layers', {}], ['/meta/app/crm', { layers: 'true' }]] as const) {
            const dispatcher = await bootDispatcher('author', { withoutLayered: true }).read(path, query);
            const rest = await bootRest('author', { withoutLayered: true }).read(path, query);
            expect(sameAnswer(dispatcher, rest) ? [] : [mismatchOf('author', dispatcher, rest)], path).toEqual([]);
            if (path.endsWith('/layers')) expect({ status: rest.status, code: rest.code }).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            else expect({ status: rest.status, label: rest.item?.label, deprecation: rest.deprecation }).toEqual({ status: 200, label: 'CRM', deprecation: undefined });
        }
    });
});

/**
 * [#20507] ADR-0045 §3: "Hidden" means externally unobservable, consistently
 * across every surface. A member asking the layered view for an unpublished app
 * is answered its absence (the gate withholds it); a member asking for a name
 * with nothing behind it used to be answered `200` with every layer `null` —
 * so the two answers told the member which unpublished apps exist. The shared
 * chain (`createMetaLayeredAnswer`) now answers a name with no layer present as
 * the plain read answers it, judged before the gate, once for both spellings
 * and both transports.
 */
describe('[#20507] the layered view: a name with nothing behind it answers what an unpublished app answers — both spellings, both transports', () => {
    const TRANSPORTS = { RestServer: bootRest, dispatcher: bootDispatcher } as const;
    const SPELLINGS: Record<string, (name: string) => [string, Record<string, string>]> = {
        '/layers': (name) => [`/meta/app/${name}/layers`, {}],
        '?layers=true': (name) => [`/meta/app/${name}`, { layers: 'true' }],
    };
    // Everything an answer carries. The flag's `Link` names the caller's OWN
    // request path, so the name is masked out of it: it says nothing about the item.
    const whole = (a: Answer, name: string) => ({
        status: a.status, code: a.code, body: a.body, vary: a.vary, cacheControl: a.cacheControl,
        deprecation: a.deprecation, link: a.link?.replace(name, 'NAME'),
    });
    const nav = (doc: any): string[] => (doc?.navigation ?? []).map((e: any) => e.id);

    for (const [transport, boot] of Object.entries(TRANSPORTS)) {
        for (const [spelling, at] of Object.entries(SPELLINGS)) {
            it(`${spelling} on ${transport}: as a member, an absent name and an unpublished app answer the same status and body`, async () => {
                const unpublished = await boot('non-holder').read(...at('launchpad'));
                const absent = await boot('non-holder').read(...at('no_such_app'));
                expect({ status: unpublished.status, code: unpublished.code }).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
                expect(whole(absent, 'no_such_app')).toEqual(whole(unpublished, 'launchpad'));
            });

            it(`${spelling} on ${transport}: control — a published app is still served to the member, every layer pruned`, async () => {
                const published = await boot('non-holder').read(...at('crm'));
                const layered = served(published, transport === 'dispatcher' ? 'dispatcher' : 'rest') as any;
                expect(published.status).toBe(200);
                for (const layer of ['code', 'overlay', 'effective']) {
                    expect(nav(layered?.[layer]), layer).toEqual(['nav_leads', 'nav_org_directory']);
                }
            });
        }
    }

    it('whoever asks, an absent name is the same 404; an unpublished app is still served to a builder', async () => {
        for (const [transport, boot] of Object.entries(TRANSPORTS)) {
            for (const [spelling, at] of Object.entries(SPELLINGS)) {
                for (const who of ITEM_CALLERS) {
                    const absent = await boot(who).read(...at('no_such_app'));
                    expect({ status: absent.status, code: absent.code }, `${spelling} ${transport} ${who}`)
                        .toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
                }
                // ADR-0045 §3: the builder (`studio.access`) still receives the unpublished app.
                const built = await boot('builder').read(...at('launchpad'));
                expect(built.status, `${spelling} ${transport} builder launchpad`).toBe(200);
            }
        }
    });
});

describe('[#20408] GET /meta/book/:name/tree: the dispatcher serves the route RestServer serves — every book × query parameter × caller', () => {
    for (const book of TREE_CELLS) {
        for (const probe of TREE_PROBES) {
            it(`GET /meta/book/${book}/tree ${probe.label}`, async () => {
                const mismatches: unknown[] = [];
                for (const who of TREE_CALLERS) {
                    const dispatcher = await bootDispatcher(who).read(`/meta/book/${book}/tree`, probe.query, probe.headers);
                    const rest = await bootRest(who).read(`/meta/book/${book}/tree`, probe.query, probe.headers);
                    if (!sameAnswer(dispatcher, rest)) mismatches.push(mismatchOf(who, dispatcher, rest));
                }
                expect(mismatches).toEqual([]);
            });
        }
    }

    it('the reference: the public book is served anonymously, a gated one refused, and the tree narrowed per caller', async () => {
        const anonymous = await bootRest('anonymous').read('/meta/book/public_guide/tree');
        expect(anonymous.status).toBe(200);
        expect(text(anonymous)).toContain('public_faq');
        const gated = await bootRest('anonymous').read('/meta/book/admin_guide/tree');
        expect({ status: gated.status, code: gated.code }).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
        const member = await bootRest('non-holder').read('/meta/book/admin_guide/tree');
        expect({ status: member.status, code: member.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(text(await bootRest('holder').read('/meta/book/admin_guide/tree'))).toContain('crm_admin_runbook');
    });
});

describe('[#20408] an undetermined field visibility (ADR-0106 D6 tier 2) serves the object schema `private, no-store` on both transports', () => {
    const OBJECT_PATHS = [
        '/meta/object', '/meta/objects', '/meta/object/invoice', '/meta/objects/invoice',
        // [#20478] The layered view's own route.
        '/meta/object/invoice/layers', '/meta/objects/invoice/layers',
    ];

    it('the reference: RestServer serves the unmasked schema under `private, no-store`, and a determined caller\'s answer carries no such header', async () => {
        for (const path of OBJECT_PATHS) {
            const undetermined = await bootRest('undetermined').read(path);
            expect({ status: undetermined.status, cacheControl: undetermined.cacheControl }, path).toEqual({ status: 200, cacheControl: 'private, no-store' });
            expect((await bootRest('non-holder').read(path)).cacheControl, path).toBeUndefined();
        }
    });

    for (const path of OBJECT_PATHS) {
        const probes = path.split('/').length === 3 ? PARAM_PROBES : path.endsWith('/layers') ? LAYERS_PROBES : ITEM_PROBES;
        for (const probe of probes) {
            it(`GET ${path} ${probe.label} × undetermined`, async () => {
                const dispatcher = await bootDispatcher('undetermined').read(path, probe.query, probe.headers);
                const rest = await bootRest('undetermined').read(path, probe.query, probe.headers);
                const list = path.split('/').length === 3;
                const same = list
                    ? dispatcher.status === rest.status && dispatcher.code === rest.code
                        && JSON.stringify(dispatcher.items) === JSON.stringify(rest.items)
                        && dispatcher.cacheControl === rest.cacheControl
                    : sameAnswer(dispatcher, rest);
                expect(same ? [] : [mismatchOf('undetermined', dispatcher, rest)]).toEqual([]);
            });
        }
    }
});
