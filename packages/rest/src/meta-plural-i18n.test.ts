// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6349 — the `/meta` routes' PLURAL spelling gets the same i18n as the
 * singular one.
 *
 * `translateMetaItem` / `translateMetaItems` decide "does this type translate"
 * by asking `isTranslatableMetaType`, which reads
 * `TRANSLATABLE_METADATA_TYPES` — a set DERIVED (#3786) from
 * `METADATA_DOCUMENT_TRANSLATORS`' keys, and those keys are singular-only:
 * `view` / `action` / `object` / `app` / `dashboard` / `page`. The `/meta`
 * handlers were handing those helpers the RAW `:type` path segment, while
 * Prime Directive #3 makes PLURAL the canonical REST spelling
 * (`/api/v1/meta/apps`). So the documented spelling missed the set, the
 * predicate answered `false`, and the entire localization was skipped: the
 * same route, the same document, the same `Accept-Language`, two answers.
 *
 * This is #3984's family — "a per-type judgement that only ever saw the
 * singular" — landing on the i18n predicate rather than on an authorization
 * gate, so the cost is an English fallback, not a leak.
 *
 * Every case here asserts the PAIR: the plural body is translated, AND it
 * equals the singular body. Asserting only "the plural is translated" would
 * stay green if a future change translated it differently from the singular,
 * which is the inconsistency the issue explicitly asked not to trade for.
 *
 * Handler census taken on this branch's `origin/main` (the issue's line
 * numbers had drifted): FIVE passthrough sites across THREE handlers —
 *   1. list            `GET /meta/:type`                        (one site)
 *   2. single item     `GET /meta/:type/:name`                  (three sites:
 *      cached-normal, cached-with-undetermined-mask, non-cached)
 *   3. compound name   `GET /meta/:type/:section/:name`         (one site)
 * The issue counted four; the cached branch's ADR-0106 D6 "visibility
 * undetermined" exit is the fifth and arrived after it was filed. All five go
 * through `translateMetaItem` (`translateMetaEnvelope` delegates to it), which
 * is why the fix folds the spelling in the two helpers rather than at the call
 * sites — option 2 of the issue's three, and the shape a sixth site inherits
 * for free.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

// ---------------------------------------------------------------------------
// Fixture locale
// ---------------------------------------------------------------------------

/**
 * One bundle, three namespaces — `pages`, `objects`, `apps` — because the
 * handlers under test are exercised with whichever type can actually reach
 * them (`app` structurally bypasses the cache; `object` is the only type the
 * mask postures apply to).
 *
 * The translated strings are deliberately unmistakable: a body that still says
 * `Home` is untranslated, and no partial match can pass for the translated one.
 */
const BUNDLE: Record<string, any> = {
    'zh-CN': {
        pages: { home: { label: '首页', description: '门户首页' } },
        objects: { customer: { label: '客户' } },
        apps: { crm: { label: '客户管理' } },
    },
};

const i18nService = {
    getLocales: () => ['zh-CN'],
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

/** Raw (English) documents as they are stored. */
const PAGE = { name: 'home', label: 'Home', description: 'Portal home' };
const OBJECT = { name: 'customer', label: 'Customer', fields: { id: { type: 'text' } } };
const APP = { name: 'crm', label: 'CRM', navigation: [] };
/**
 * A type with NO translator: `widget` is not a `METADATA_DOCUMENT_TRANSLATORS`
 * key and `widgets` has no `PLURAL_TO_SINGULAR` entry either, so neither
 * spelling may gain translation. The control for "the fix did not widen the
 * set" — it only widened the spellings that reach it.
 */
const WIDGET = { name: 'home', label: 'Home' };
/**
 * The sharper control: `books` IS in `PLURAL_TO_SINGULAR` (→ `book`), so the
 * normalization definitely fires for it — but `book` is not a translator key,
 * so the answer must still be "untranslated". This separates "normalizes the
 * spelling" from "translates anything it can normalize"; a fix that folded the
 * spelling into the translator lookup without keeping the predicate would pass
 * every other case here and fail this one.
 */
const BOOK = { name: 'home', label: 'Home', groups: [] };

const RAW_BY_NAME: Record<string, any> = { page: PAGE, object: OBJECT, app: APP, widget: WIDGET, book: BOOK };

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    return { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
}

/**
 * Which raw document a given `:type` segment serves. The real protocol
 * normalizes singular↔plural and serves BOTH spellings the same document
 * (`metadata-protocol`'s `PLURAL_TO_SINGULAR[type] ?? type`), so a double that
 * answered only one spelling would be testing itself rather than the REST
 * layer — the plural case would come back empty and read as "not translated"
 * for entirely the wrong reason.
 */
function canonicalType(type: string): string {
    const t = String(type ?? '');
    return t.endsWith('s') ? t.slice(0, -1) : t;
}

function documentFor(type: string): any {
    return RAW_BY_NAME[canonicalType(type)];
}

function baseProtocol(overrides: Record<string, any> = {}) {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => {
            const doc = documentFor(type);
            return doc ? [doc] : [];
        }),
        // The producer folds the plural to the singular canonical key in the
        // envelope it answers with (#4432) — a double that echoed the raw
        // spelling back would make every "same body under both spellings"
        // assertion fail on the double's own artefact rather than on the
        // localization under test.
        getMetaItem: vi.fn(async ({ type, name }: any) => ({
            type: canonicalType(type), name, item: documentFor(type), lock: 'none', editable: true,
        })),
        getMetaItemCached: undefined as any,
        findData: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

const ANON_API = { api: { requireAuth: false } };

function makeRest(protocol: any, config: any = ANON_API) {
    const rest = new RestServer(
        mockServer() as any, protocol as any, config as any,
        // kernelManager, envRegistry, defaultEnvironmentIdProvider, authServiceProvider,
        // objectQLProvider, emailServiceProvider, sharingServiceProvider,
        // reportsServiceProvider, approvalsServiceProvider, sharingRulesServiceProvider
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        // i18nServiceProvider — the 14th constructor argument.
        async () => i18nService as any,
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

/**
 * The body of the last `res.json(...)`. Indexed rather than `.at(-1)` on
 * purpose: this package's `lib` target predates ES2022, so `.at` is a TS2550
 * here and `TEST_DEBT['@objectstack/rest']` is a frozen ratchet with no margin.
 */
function lastBody(res: ReturnType<typeof mockRes>): any {
    const calls = res.json.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

/**
 * `Accept-Language: zh-CN` is sent explicitly rather than leaning on the
 * service's default locale — the header is the path a real client takes, and
 * `extractLocale` reads it before either fallback.
 */
const ZH = { 'accept-language': 'zh-CN' };

async function listOf(rest: RestServer, type: string) {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta/:type').handler(
        { method: 'GET', params: { type }, query: {}, body: {}, headers: ZH }, res,
    );
    return lastBody(res);
}

async function itemOf(rest: RestServer, type: string, name: string) {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta/:type/:name').handler(
        { method: 'GET', params: { type, name }, query: {}, body: {}, headers: ZH }, res,
    );
    return lastBody(res);
}

async function compoundOf(rest: RestServer, type: string, section: string, name: string) {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta/:type/:section/:name').handler(
        { method: 'GET', params: { type, section, name }, query: {}, body: {}, headers: ZH }, res,
    );
    return lastBody(res);
}

/** First element of whichever list shape `getMetaItems` produced. */
const firstItem = (body: any) => (Array.isArray(body) ? body : body?.items ?? [])[0];

// ---------------------------------------------------------------------------
// §1 — list: GET /meta/:type
// ---------------------------------------------------------------------------

describe('#6349 §1 list `GET /meta/:type`', () => {
    it('translates under the singular spelling (the behaviour that already worked)', async () => {
        const rest = makeRest(baseProtocol());
        expect(firstItem(await listOf(rest, 'page'))).toMatchObject({ name: 'home', label: '首页' });
    });

    it('translates under the canonical PLURAL spelling, identically', async () => {
        const rest = makeRest(baseProtocol());
        const singular = await listOf(rest, 'page');
        const plural = await listOf(rest, 'pages');

        expect(firstItem(plural)).toMatchObject({ name: 'home', label: '首页', description: '门户首页' });
        // Not merely "translated" — the SAME answer. `/meta/pages` and
        // `/meta/page` are one route with two spellings.
        expect(plural).toEqual(singular);
    });
});

// ---------------------------------------------------------------------------
// §2 — single item: GET /meta/:type/:name, all three of its exits
// ---------------------------------------------------------------------------

describe('#6349 §2 single item `GET /meta/:type/:name`', () => {
    /** `enableCache` defaults to true, so this is the DEFAULT deployment's exit. */
    function cachedProtocol() {
        return baseProtocol({
            getMetaItemCached: vi.fn(async ({ type }: any) => ({
                data: documentFor(type),
                etag: { value: 'e1', weak: false },
                notModified: false,
            })),
        });
    }

    it('cached branch: the plural spelling is translated, identically to the singular', async () => {
        const rest = makeRest(cachedProtocol());
        const singular = await itemOf(rest, 'page', 'home');
        const plural = await itemOf(rest, 'pages', 'home');

        expect(singular.item).toMatchObject({ label: '首页' });
        expect(plural.item).toMatchObject({ label: '首页', description: '门户首页' });
        expect(plural).toEqual(singular);
    });

    it('non-cached branch: the plural spelling is translated, identically to the singular', async () => {
        const config = { api: { requireAuth: false }, metadata: { enableCache: false } };
        const rest = makeRest(baseProtocol(), config);
        const singular = await itemOf(rest, 'page', 'home');
        const plural = await itemOf(rest, 'pages', 'home');

        expect(singular.item).toMatchObject({ label: '首页' });
        expect(plural.item).toMatchObject({ label: '首页' });
        // The envelope's OCC carriers ride along on this branch — asserting the
        // whole body keeps the comparison from being satisfied by `item` alone.
        expect(plural).toEqual(singular);
    });

    it('cached branch, ADR-0106 D6 `undetermined` visibility exit: plural is translated too', async () => {
        // The fifth passthrough site, and the one with its own `res.json` call:
        // when the field-visibility posture cannot be resolved, the branch sends
        // an unmasked body with `no-store` and its OWN re-wrapped envelope
        // instead of falling through to the shared exit. `object` is the only
        // type the mask postures apply to, so this is exercised with
        // `object`/`objects`.
        const rest = makeRest(baseProtocol({
            getMetaItemCached: vi.fn(async ({ type }: any) => ({
                data: documentFor(type), etag: { value: 'e1', weak: false }, notModified: false,
            })),
        }));
        (rest as any).resolveObjectMasker = async () => async () => ({ kind: 'undetermined', reason: 'test' });

        const singular = await itemOf(rest, 'object', 'customer');
        const plural = await itemOf(rest, 'objects', 'customer');

        expect(singular.item).toMatchObject({ label: '客户' });
        expect(plural.item).toMatchObject({ label: '客户' });
        expect(plural).toEqual(singular);
    });

    it('`app` — which structurally bypasses the cache — is translated under `apps` too', async () => {
        // Worth its own case because `app` is the spelling the issue measured
        // (`apps.setup.label`) and the one type excluded from the cached branch
        // by `isAppType`, so it reaches the RBAC-filtering path instead.
        const rest = makeRest(baseProtocol({
            getMetaItemCached: vi.fn(async ({ type }: any) => ({
                data: documentFor(type), etag: { value: 'e1', weak: false }, notModified: false,
            })),
        }));

        const singular = await itemOf(rest, 'app', 'crm');
        const plural = await itemOf(rest, 'apps', 'crm');

        expect(singular.item).toMatchObject({ label: '客户管理' });
        expect(plural.item).toMatchObject({ label: '客户管理' });
        expect(plural).toEqual(singular);
    });
});

// ---------------------------------------------------------------------------
// §3 — compound name: GET /meta/:type/:section/:name
// ---------------------------------------------------------------------------

describe('#6349 §3 compound name `GET /meta/:type/:section/:name`', () => {
    it('translates the plural spelling, identically to the singular', async () => {
        const rest = makeRest(baseProtocol({
            getMetaItem: vi.fn(async ({ type, name }: any) => ({
                type: canonicalType(type), name, item: documentFor(type), lock: 'none',
            })),
        }));

        const singular = await compoundOf(rest, 'page', 'portal', 'home');
        const plural = await compoundOf(rest, 'pages', 'portal', 'home');

        expect(singular.item).toMatchObject({ label: '首页' });
        expect(plural.item).toMatchObject({ label: '首页', description: '门户首页' });
        expect(plural).toEqual(singular);
    });
});

// ---------------------------------------------------------------------------
// §4 — controls: the translatable SET is unchanged
// ---------------------------------------------------------------------------

describe('#6349 §4 no widening — only the spellings changed, not the set', () => {
    it('a type with no translator and no plural mapping is untranslated in BOTH spellings', async () => {
        const rest = makeRest(baseProtocol());
        // `widget` has no entry in `METADATA_DOCUMENT_TRANSLATORS`; `widgets`
        // has none in `PLURAL_TO_SINGULAR`. The bundle DOES carry a
        // `pages.home.label`, and this document is also named `home` — so a fix
        // that translated by name instead of by type would show up right here.
        expect(firstItem(await listOf(rest, 'widget'))).toMatchObject({ label: 'Home' });
        expect(firstItem(await listOf(rest, 'widgets'))).toMatchObject({ label: 'Home' });
        expect(await itemOf(rest, 'widgets', 'home')).toMatchObject({ item: { label: 'Home' } });
    });

    it('a plural that DOES normalize but whose singular has no translator stays untranslated', async () => {
        // `books` → `book`. The normalization fires; the predicate must still
        // say no. This is the case that separates "folds the spelling" from
        // "translates whatever it can fold".
        const rest = makeRest(baseProtocol(), { api: { requireAuth: false }, metadata: { enableCache: false } });
        expect(firstItem(await listOf(rest, 'book'))).toMatchObject({ label: 'Home' });
        expect(firstItem(await listOf(rest, 'books'))).toMatchObject({ label: 'Home' });
    });

    it('a request expressing no locale preference is untouched in both spellings', async () => {
        // `extractLocale` returns `undefined` → both helpers return the items
        // unchanged before any translator runs. Normalizing the type must not
        // have moved that exit.
        const rest = makeRest(baseProtocol({
            // A service with no default locale, so nothing backfills the header.
            getMetaItems: vi.fn(async ({ type }: any) => [documentFor(type)]),
        }));
        (rest as any).resolveI18nService = async () => ({
            getLocales: () => ['zh-CN'],
            getTranslations: (l: string) => BUNDLE[l],
        });
        const res = mockRes();
        await routeFor(rest, '/api/v1/meta/:type').handler(
            { method: 'GET', params: { type: 'pages' }, query: {}, body: {}, headers: {} }, res,
        );
        expect(firstItem(lastBody(res))).toMatchObject({ label: 'Home' });
    });
});
