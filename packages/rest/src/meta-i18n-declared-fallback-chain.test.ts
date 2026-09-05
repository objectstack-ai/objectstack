// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14882 — the metadata reads hand the document translators the DECLARED
 * fallback chain, not a literal `en`; #15711 — and the DECLARED default
 * locale, so a request for it answers with the authored label.
 *
 * The RULE lives in `@objectstack/spec/system`: the label resolvers walk
 * `requested locale → fallbackChain → authored label` for a non-default
 * request, skip the chain for a request that names `defaultLocale` (the
 * authored label IS the default locale's text, ruled on #15711), and invent
 * no chain for a caller that declares none (pinned in
 * `i18n-resolver.test.ts`). What can only be tested here is the PLUMBING —
 * that every seam translating a metadata document passes
 * `fallbackChain: [i18n.getFallbackLocale()]`, the locale the i18n service's
 * own `t()` falls back to, which `I18nServicePlugin` receives from the
 * stack's `i18n` config as `fallbackLocale || defaultLocale || 'en'`, and
 * `defaultLocale: i18n.getDefaultLocale()`, the same accessor a header-less
 * request already resolves its locale from. Before #14882, every seam passed
 * NO chain, so the declared `fallbackLocale` never reached the resolver and
 * `en` was consulted before the authored label.
 *
 * The fixture is the card's workspace: labels authored in the default locale
 * (`zh-CN`), a courtesy `en` bundle for English users, and NO `zh-CN` bundle
 * — `getLocales()` still reports `zh-CN` (declared), with an empty bundle
 * behind it, exactly what `buildTranslationBundle` sees on the reporter's
 * stack. `subject_type` has no `en` entry: the reporter's own control, the
 * one field that stayed Chinese while its siblings flipped to English.
 *
 * Seams covered: `GET /meta/:type/:name` (object and app), `GET /meta/:type`
 * (list), `GET /meta` (the types listing) — and the feature-detection
 * contract for a service that declares no fallback, or no default.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

// ---------------------------------------------------------------------------
// Fixtures — the card's workspace
// ---------------------------------------------------------------------------

const SHEET = {
    name: 'kpi_entry_sheet',
    label: '填报单',
    pluralLabel: '填报单',
    fields: {
        name: { name: 'name', type: 'text', label: '填报单名称' },
        status: { name: 'status', type: 'select', label: '状态' },
        total_score: { name: 'total_score', type: 'number', label: '最终得分' },
        subject_type: { name: 'subject_type', type: 'select', label: '主体类型' },
    },
};

const KPI_APP = { name: 'kpi_app', label: 'KPI 考核管理', navigation: [] };

/** The courtesy `en` bundle — `defineTranslationBundle({ en: {...} })`. */
const EN_DATA = {
    objects: {
        kpi_entry_sheet: {
            label: 'Entry Sheet',
            pluralLabel: 'Entry Sheets',
            fields: { name: { label: 'Sheet' }, status: { label: 'Status' }, total_score: { label: 'Final Score' } },
        },
    },
    apps: { kpi_app: { label: 'KPI Assessment' } },
    metadataForms: { object: { label: 'Object' } },
};

/** What `os i18n extract --locales=zh-CN` would ship — the reporter's workaround. */
const ZH_DATA = { objects: { kpi_entry_sheet: { label: '填报单（bundle）' } } };

const AUTHORED = {
    label: '填报单', pluralLabel: '填报单',
    name: '填报单名称', status: '状态', total_score: '最终得分', subject_type: '主体类型',
};
const ENGLISH = {
    label: 'Entry Sheet', pluralLabel: 'Entry Sheets',
    name: 'Sheet', status: 'Status', total_score: 'Final Score', subject_type: '主体类型',
};

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * An `II18nService` double shaped like `FileI18nAdapter` on the reporter's
 * stack: every declared locale is reported, an undeclared bundle reads as
 * `{}`, and `getFallbackLocale()` answers what the plugin was constructed
 * with. `fallbackLocale: null` builds a service that does NOT implement the
 * accessor at all (the older-provider / in-memory-fallback control).
 */
function i18nFor(opts: {
    bundles: Record<string, any>;
    defaultLocale: string;
    fallbackLocale: string | undefined | null;
}) {
    const svc: any = {
        getLocales: () => Object.keys(opts.bundles),
        getTranslations: (locale: string) => opts.bundles[locale] ?? {},
        getDefaultLocale: () => opts.defaultLocale,
    };
    if (opts.fallbackLocale !== null) svc.getFallbackLocale = () => opts.fallbackLocale;
    return svc;
}

/** The card's stack: `defaultLocale: 'zh-CN'`, `fallbackLocale: 'zh-CN'`, `en` bundle only. */
const CARD = () => i18nFor({ bundles: { 'zh-CN': {}, en: EN_DATA }, defaultLocale: 'zh-CN', fallbackLocale: 'zh-CN' });

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    return { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
}

const singular = (type: string) => (type.endsWith('s') ? type.slice(0, -1) : type);
const DOCUMENTS: Record<string, any> = { object: SHEET, app: KPI_APP };

function protocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn(async () => ({
            entries: [{ type: 'object', label: '对象' }],
            types: ['object', 'app'],
            registered: ['object', 'app'],
        })),
        getMetaItems: vi.fn(async ({ type }: any) => (DOCUMENTS[singular(type)] ? [DOCUMENTS[singular(type)]] : [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({
            type: singular(type),
            name,
            item: DOCUMENTS[singular(type)],
            lock: 'none',
            editable: true,
        })),
        getMetaItemCached: undefined as any,
        // [#8284] The packaged base equals the served document: nothing was
        // authored on top of it, so the catalog applies — the path the card
        // measured, where the wrong CATALOG locale answered.
        getPackagedObjectBase: vi.fn((name: string) => (name === SHEET.name ? SHEET : undefined)),
        findData: vi.fn().mockResolvedValue([]),
    };
}

function makeRest(i18n: any) {
    const rest = new RestServer(
        mockServer() as any, protocol() as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        // i18nServiceProvider — the 14th constructor argument.
        async () => i18n,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return rest;
}

function routeFor(rest: RestServer, path: string) {
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    if (!route) throw new Error(`route not registered: GET ${path}`);
    return route;
}

/** Indexed rather than `.at(-1)`: this package's `lib` target predates ES2022. */
function lastBody(res: ReturnType<typeof mockRes>): any {
    const calls = res.json.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

/** `Accept-Language` absent when `locale` is `undefined` — the card's "no header" request. */
const headersFor = (locale: string | undefined) => (locale ? { 'accept-language': locale } : {});

async function readItem(rest: RestServer, type: string, name: string, locale: string | undefined): Promise<any> {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta/:type/:name').handler(
        { method: 'GET', params: { type, name }, query: {}, body: {}, headers: headersFor(locale) },
        res,
    );
    return lastBody(res)?.item;
}

async function readList(rest: RestServer, type: string, locale: string | undefined): Promise<any[]> {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta/:type').handler(
        { method: 'GET', params: { type }, query: {}, body: {}, headers: headersFor(locale) },
        res,
    );
    const body = lastBody(res);
    return Array.isArray(body) ? body : body?.items ?? [];
}

async function readTypes(rest: RestServer, locale: string | undefined): Promise<any> {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta').handler(
        { method: 'GET', params: {}, query: {}, body: {}, headers: headersFor(locale) },
        res,
    );
    return lastBody(res);
}

const labelsOf = (doc: any) => ({
    label: doc.label,
    pluralLabel: doc.pluralLabel,
    name: doc.fields.name.label,
    status: doc.fields.status.label,
    total_score: doc.fields.total_score.label,
    subject_type: doc.fields.subject_type.label,
});

// ---------------------------------------------------------------------------
// §1 — the card: a zh-CN request on a zh-CN workspace, en bundle present
// ---------------------------------------------------------------------------

describe('#14882 §1 — a zh-CN request resolves to the authored labels', () => {
    it('GET /meta/object/:name serves the authored Chinese labels', async () => {
        expect(labelsOf(await readItem(makeRest(CARD()), 'object', 'kpi_entry_sheet', 'zh-CN'))).toEqual(AUTHORED);
    });

    it('GET /meta/app/:name serves the authored app label', async () => {
        expect((await readItem(makeRest(CARD()), 'app', 'kpi_app', 'zh-CN')).label).toBe('KPI 考核管理');
    });

    it('with NO Accept-Language the workspace default (zh-CN) answers the same', async () => {
        expect(labelsOf(await readItem(makeRest(CARD()), 'object', 'kpi_entry_sheet', undefined))).toEqual(AUTHORED);
        expect((await readItem(makeRest(CARD()), 'app', 'kpi_app', undefined)).label).toBe('KPI 考核管理');
    });

    it('the list read agrees with the single read', async () => {
        const [sheet] = await readList(makeRest(CARD()), 'object', 'zh-CN');
        expect(labelsOf(sheet)).toEqual(AUTHORED);
        const [app] = await readList(makeRest(CARD()), 'app', 'zh-CN');
        expect(app.label).toBe('KPI 考核管理');
    });

    it('the types listing keeps its authored metadata-type label', async () => {
        const body = await readTypes(makeRest(CARD()), 'zh-CN');
        expect(body.entries.find((e: any) => e.type === 'object').label).toBe('对象');
    });
});

// ---------------------------------------------------------------------------
// §2 — the en bundle still serves an en request
// ---------------------------------------------------------------------------

describe('#14882 §2 — an en request still gets the courtesy en bundle', () => {
    it('GET /meta/object/:name serves the en bundle, subject_type stays authored', async () => {
        expect(labelsOf(await readItem(makeRest(CARD()), 'object', 'kpi_entry_sheet', 'en'))).toEqual(ENGLISH);
    });

    it('GET /meta/app/:name serves the en app label', async () => {
        expect((await readItem(makeRest(CARD()), 'app', 'kpi_app', 'en')).label).toBe('KPI Assessment');
    });

    it('the types listing serves the en metadata-type label', async () => {
        const body = await readTypes(makeRest(CARD()), 'en');
        expect(body.entries.find((e: any) => e.type === 'object').label).toBe('Object');
    });
});

// ---------------------------------------------------------------------------
// §3 — the controls the card itself measured
// ---------------------------------------------------------------------------

describe('#14882 §3 — controls', () => {
    it('remove the en bundle: the zh-CN answer does not move', async () => {
        const noEn = i18nFor({ bundles: { 'zh-CN': {} }, defaultLocale: 'zh-CN', fallbackLocale: 'zh-CN' });
        expect(labelsOf(await readItem(makeRest(noEn), 'object', 'kpi_entry_sheet', 'zh-CN'))).toEqual(AUTHORED);
    });

    it('ship a zh-CN bundle: it still wins over the authored label', async () => {
        // The reporter's workaround (`os i18n extract --locales=zh-CN`) is
        // the documented per-locale layout and must keep working: a bundle
        // entry for the requested locale IS the translation.
        const withZh = i18nFor({
            bundles: { 'zh-CN': ZH_DATA, en: EN_DATA }, defaultLocale: 'zh-CN', fallbackLocale: 'zh-CN',
        });
        const item = await readItem(makeRest(withZh), 'object', 'kpi_entry_sheet', 'zh-CN');
        expect(item.label).toBe('填报单（bundle）');
        // A field the zh-CN bundle does not mention still resolves through the
        // declared chain (zh-CN → zh-CN → authored), never through `en`.
        expect(item.fields.name.label).toBe('填报单名称');
    });
});

// ---------------------------------------------------------------------------
// §4 — the feature-detection contract: no declaration, no invented chain
// ---------------------------------------------------------------------------

describe('#14882 §4 / #15711 — a service that declares no fallback gets no chain, and no en is invented', () => {
    // The serving layer threads DECLARATIONS; it derives nothing. An i18n
    // provider without `getFallbackLocale` (or answering `undefined`) gets no
    // chain, and since #15711 the resolver's own default is `[]`: a request
    // walks `requested locale → authored label`, and `en` is consulted only
    // when it is requested or declared. `getDefaultLocale()` IS threaded now
    // (#15711 ruled the question §5 used to leave open), so the `zh-CN`
    // request below answers authored for two independent reasons; the `fr`
    // request isolates the second facet, where only the `[]` default applies.
    it('a provider without getFallbackLocale: zh-CN (the default) and fr (not) both answer authored', async () => {
        const legacy = i18nFor({ bundles: { 'zh-CN': {}, en: EN_DATA }, defaultLocale: 'zh-CN', fallbackLocale: null });
        expect(labelsOf(await readItem(makeRest(legacy), 'object', 'kpi_entry_sheet', 'zh-CN'))).toEqual(AUTHORED);
        expect(labelsOf(await readItem(makeRest(legacy), 'object', 'kpi_entry_sheet', 'fr'))).toEqual(AUTHORED);
        // Control — an `en` request still finds its own bundle.
        expect((await readItem(makeRest(legacy), 'object', 'kpi_entry_sheet', 'en')).label).toBe('Entry Sheet');
    });

    it('a provider answering undefined answers the same', async () => {
        const undeclared = i18nFor({ bundles: { 'zh-CN': {}, en: EN_DATA }, defaultLocale: 'zh-CN', fallbackLocale: undefined });
        expect((await readItem(makeRest(undeclared), 'object', 'kpi_entry_sheet', 'zh-CN')).label).toBe('填报单');
        expect((await readItem(makeRest(undeclared), 'object', 'kpi_entry_sheet', 'fr')).label).toBe('填报单');
    });

    it('a provider without getDefaultLocale gets no default: nothing is the default, the chain is all there is', async () => {
        // No `defaultLocale` is threaded (the seam passes nothing, never
        // `'en'`), so the default-locale rule is off and the DECLARED `en`
        // chain is walked for a `zh-CN` request exactly as #14882 pinned it.
        const noDefault = i18nFor({ bundles: { 'zh-CN': {}, en: EN_DATA }, defaultLocale: 'zh-CN', fallbackLocale: 'en' });
        delete noDefault.getDefaultLocale;
        expect((await readItem(makeRest(noDefault), 'object', 'kpi_entry_sheet', 'zh-CN')).label).toBe('Entry Sheet');
    });
});

// ---------------------------------------------------------------------------
// §5 — a stack that DECLARES en as its fallback: honoured for every request
//      but the default-locale one (#15711)
// ---------------------------------------------------------------------------

describe('#15711 §5 — a declared en fallback never outranks the authored label for a default-locale request', () => {
    // `defaultLocale: 'zh-CN'`, `fallbackLocale: 'en'`, no zh-CN bundle — the
    // reflexive AI-authored config. #14882 pinned this as it answered then
    // (`Entry Sheet`) because whether the authored label is the default-locale
    // source was a CONTRACT question that card did not decide. #15711 ruled
    // it: the authored label IS the default locale's text.
    const enFallback = () =>
        i18nFor({ bundles: { 'zh-CN': {}, en: EN_DATA }, defaultLocale: 'zh-CN', fallbackLocale: 'en' });

    it('GET /meta/object/:name serves the authored 填报单 for a zh-CN request', async () => {
        expect(labelsOf(await readItem(makeRest(enFallback()), 'object', 'kpi_entry_sheet', 'zh-CN'))).toEqual(AUTHORED);
    });

    it('GET /meta/app/:name, the list read and the types listing agree', async () => {
        expect((await readItem(makeRest(enFallback()), 'app', 'kpi_app', 'zh-CN')).label).toBe('KPI 考核管理');
        const [sheet] = await readList(makeRest(enFallback()), 'object', 'zh-CN');
        expect(labelsOf(sheet)).toEqual(AUTHORED);
        const body = await readTypes(makeRest(enFallback()), 'zh-CN');
        expect(body.entries.find((e: any) => e.type === 'object').label).toBe('对象');
    });

    it('with NO Accept-Language the request falls to the default locale and answers authored', async () => {
        expect(labelsOf(await readItem(makeRest(enFallback()), 'object', 'kpi_entry_sheet', undefined))).toEqual(AUTHORED);
    });

    it('a NON-default request still walks fr → en bundle → authored', async () => {
        // `fallbackLocale` keeps its full meaning for every other locale.
        expect(labelsOf(await readItem(makeRest(enFallback()), 'object', 'kpi_entry_sheet', 'fr'))).toEqual(ENGLISH);
        expect((await readItem(makeRest(enFallback()), 'app', 'kpi_app', 'fr')).label).toBe('KPI Assessment');
    });

    it('an en request on the same stack still gets the en bundle', async () => {
        expect(labelsOf(await readItem(makeRest(enFallback()), 'object', 'kpi_entry_sheet', 'en'))).toEqual(ENGLISH);
    });

    it('a shipped zh-CN bundle still wins; a key it omits is authored, never en', async () => {
        const withZh = i18nFor({ bundles: { 'zh-CN': ZH_DATA, en: EN_DATA }, defaultLocale: 'zh-CN', fallbackLocale: 'en' });
        const item = await readItem(makeRest(withZh), 'object', 'kpi_entry_sheet', 'zh-CN');
        expect(item.label).toBe('填报单（bundle）');
        expect(item.fields.name.label).toBe('填报单名称');
    });
});
