// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8284 — the i18n catalog loses to an explicitly-set object scalar, and the
 * value that decides it reaches the translator.
 *
 * The RULE lives in `@objectstack/spec/system` (`translateObject`, unit-tested
 * in `i18n-resolver.test.ts` across the whole truth table). What can only be
 * tested here is the PLUMBING: `translateObject` compares the served document
 * against the packaged base declaration, which is a fact no spec function can
 * reach — it comes from the protocol (`getPackagedObjectBase`, over
 * `SchemaRegistry.getPackagedObjectOwner`) and is handed in by this boundary.
 * A perfect rule that never receives a base is exactly the defect it fixes, so
 * these cases assert the response body, not a call.
 *
 * The three seams that translate an object document are all covered:
 * `GET /meta/:type` (list), `GET /meta/:type/:name` (single), and the
 * feature-detection contract for a protocol that predates the accessor.
 *
 * Maintainer ruling, 2026-08-13: a tenant's explicit scalar (a Studio rename
 * that answered `200`) and a code-shipped `objectExtensions` scalar are both
 * authored data and must win over the packaged catalog; decided by comparison
 * against the packaged base, with no provenance flag carried through the fold.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

// ---------------------------------------------------------------------------
// Fixtures — one object, one catalog, three documents
// ---------------------------------------------------------------------------

/**
 * The packaged declaration, as the owner contributor holds it: pre-fold,
 * pre-overlay. This is what `getPackagedObjectBase` answers with.
 */
const PACKAGED = {
    name: 'showcase_account',
    label: 'Account',
    pluralLabel: 'Accounts',
    description: 'A company the org delivers projects for.',
    fields: { industry: { name: 'industry', type: 'select', label: 'Industry' } },
};

/** The served document when a code extension has folded its own scalars on. */
const EXTENDED = { ...PACKAGED, label: 'Account (Success Overlay)' };

/** The served document after a tenant's Studio rename. */
const RENAMED = { ...PACKAGED, label: 'Customer' };

/**
 * The packaged catalog. `en` repeats the packaged strings (what `i18n:extract`
 * writes); `zh-CN` translates them. Both locales are exercised: a rule that
 * only withheld the catalog in translation would still serve the packaged
 * English back over a rename to an `en` session.
 */
const BUNDLE: Record<string, any> = {
    en: {
        objects: {
            showcase_account: { label: 'Account', pluralLabel: 'Accounts' },
        },
    },
    'zh-CN': {
        objects: {
            showcase_account: { label: '客户', pluralLabel: '客户', fields: { industry: { label: '行业' } } },
            showcase_contact: { label: '联系人' },
        },
    },
};

const i18nService = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

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
 * @param served the object document the protocol serves (post-fold,
 *   post-overlay — what a real read hands the boundary).
 * @param packagedBase what `getPackagedObjectBase` answers, or `null` to build
 *   a protocol that does NOT implement the accessor at all (the older-host
 *   control).
 */
function protocolFor(served: any, packagedBase: any) {
    const base: Record<string, any> = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => (type === 'object' || type === 'objects' ? [served] : [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({
            type: type === 'objects' ? 'object' : type,
            name,
            item: served,
            lock: 'none',
            editable: true,
        })),
        getMetaItemCached: undefined as any,
        findData: vi.fn().mockResolvedValue([]),
    };
    if (packagedBase !== null) {
        base.getPackagedObjectBase = vi.fn((name: string) =>
            name === packagedBase?.name ? packagedBase : undefined,
        );
    }
    return base;
}

function makeRest(protocol: any) {
    const rest = new RestServer(
        mockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
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
 * The body of the last `res.json(...)`. Indexed rather than `.at(-1)`: this
 * package's `lib` target predates ES2022 (see `meta-plural-i18n.test.ts`).
 */
function lastBody(res: ReturnType<typeof mockRes>): any {
    const calls = res.json.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

async function listLabel(rest: RestServer, locale = 'zh-CN'): Promise<unknown> {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta/:type').handler(
        { method: 'GET', params: { type: 'object' }, query: {}, body: {}, headers: { 'accept-language': locale } },
        res,
    );
    const body = lastBody(res);
    const items = Array.isArray(body) ? body : body?.items ?? [];
    return items[0]?.label;
}

async function itemLabel(rest: RestServer, locale = 'zh-CN'): Promise<unknown> {
    const res = mockRes();
    await routeFor(rest, '/api/v1/meta/:type/:name').handler(
        {
            method: 'GET',
            params: { type: 'object', name: 'showcase_account' },
            query: {},
            body: {},
            headers: { 'accept-language': locale },
        },
        res,
    );
    return lastBody(res)?.item?.label;
}

// ---------------------------------------------------------------------------
// §1 — the packaged default is still translated
// ---------------------------------------------------------------------------

describe('#8284 §1 — an untouched object keeps its catalog translation', () => {
    // The majority path. Stated first because it is what a comparison-based
    // rule risks: withholding the catalog from documents that never diverged
    // would be a far larger regression than the defect being fixed.
    const rest = () => makeRest(protocolFor(PACKAGED, PACKAGED));

    it('list read serves the catalog label', async () => {
        expect(await listLabel(rest())).toBe('客户');
    });

    it('by-name read serves the catalog label', async () => {
        expect(await itemLabel(rest())).toBe('客户');
    });
});

// ---------------------------------------------------------------------------
// §2 — an explicitly-set scalar beats the catalog, on BOTH reads
// ---------------------------------------------------------------------------

describe('#8284 §2 — an explicit override reaches both /meta/object reads', () => {
    it("a code extension's label survives the list read", async () => {
        expect(await listLabel(makeRest(protocolFor(EXTENDED, PACKAGED)))).toBe('Account (Success Overlay)');
    });

    it("a code extension's label survives the by-name read", async () => {
        expect(await itemLabel(makeRest(protocolFor(EXTENDED, PACKAGED)))).toBe('Account (Success Overlay)');
    });

    it("a tenant's rename survives the list read", async () => {
        expect(await listLabel(makeRest(protocolFor(RENAMED, PACKAGED)))).toBe('Customer');
    });

    it("a tenant's rename survives the by-name read", async () => {
        // The severe half of the card: this is the read every writable form
        // derives from, and it used to answer the packaged catalog string
        // after a `PUT` that returned 200.
        expect(await itemLabel(makeRest(protocolFor(RENAMED, PACKAGED)))).toBe('Customer');
    });

    it('and in the SOURCE locale, where the catalog repeats the packaged string', async () => {
        expect(await itemLabel(makeRest(protocolFor(RENAMED, PACKAGED)), 'en')).toBe('Customer');
        expect(await listLabel(makeRest(protocolFor(RENAMED, PACKAGED)), 'en')).toBe('Customer');
    });

    it('leaves everything else on the document translated', async () => {
        // Withholding the catalog is per-scalar, not per-document: the field
        // labels and the untouched `pluralLabel` still localize.
        const res = mockRes();
        await routeFor(makeRest(protocolFor(RENAMED, PACKAGED)), '/api/v1/meta/:type/:name').handler(
            {
                method: 'GET',
                params: { type: 'object', name: 'showcase_account' },
                query: {}, body: {}, headers: { 'accept-language': 'zh-CN' },
            },
            res,
        );
        const item = lastBody(res)?.item;
        expect(item.label).toBe('Customer');
        expect(item.pluralLabel).toBe('客户');
        expect(item.fields.industry.label).toBe('行业');
    });
});

// ---------------------------------------------------------------------------
// §3 — the feature-detection contract
// ---------------------------------------------------------------------------

describe('#8284 §3 — a protocol without the accessor keeps its translations', () => {
    // `RestProtocol` is the ADR-0076 D9 wire slice and is deliberately NOT
    // widened for this (server-only extensions are runtime-cast). So the
    // boundary must degrade to the pre-#8284 answer rather than guessing —
    // "no baseline known" is not "explicitly set".
    it('falls back to catalog-wins when getPackagedObjectBase is absent', async () => {
        const rest = makeRest(protocolFor(RENAMED, null));
        expect(await itemLabel(rest)).toBe('客户');
        expect(await listLabel(rest)).toBe('客户');
    });

    it('and when the accessor answers undefined (runtime-authored object)', async () => {
        // A tenant-authored object has no packaged owner at all. Same rule:
        // nothing to compare, so nothing is withheld.
        const rest = makeRest(protocolFor({ ...RENAMED, name: 'showcase_account' }, { name: 'other_object' }));
        expect(await itemLabel(rest)).toBe('客户');
    });

    it('asks only for objects — no lookup for a non-object type', async () => {
        const protocol = protocolFor(PACKAGED, PACKAGED);
        const rest = makeRest(protocol);
        const res = mockRes();
        await routeFor(rest, '/api/v1/meta/:type').handler(
            { method: 'GET', params: { type: 'page' }, query: {}, body: {}, headers: { 'accept-language': 'zh-CN' } },
            res,
        );
        expect(protocol.getPackagedObjectBase).not.toHaveBeenCalled();
    });
});
