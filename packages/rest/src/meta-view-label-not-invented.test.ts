// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23967 — the `/meta` single-item and list reads serve a view stored with no
 * `label` WITHOUT the `label` the read-side translator invents from its name.
 *
 * `ViewItemSchema` declares a view's `label` optional, with no default. The
 * spec's `translateView` answers `view.label ?? view.name` when the catalog
 * carries no string for the view, so a view stored without one was served
 * `label: '<object>.<key>'` on `GET /meta/view/NAME` and on `GET /meta/view`,
 * and the console drew `recheck_gate.default` as the view tab. The container
 * read (#22614) already dropped that same fallback; the item and list reads
 * now take the same rule.
 *
 * Pinned over both hosts' read path:
 *
 *  - §1 through the standalone server's ROUTES (`RestServer`, which delegates
 *    to `translateMetaDocument` / `translateMetaList`), over a REAL registry and
 *    the REAL metadata protocol, the stored view seeded as the row a runtime
 *    save writes;
 *  - §2 through the two functions the runtime dispatcher's `/meta` domain
 *    imports from this package (`translateMetaEnvelope`, `translateMetaList`).
 *
 * Covered on each: a label-less stored view is served with no `label`; an
 * authored label is served as authored (one equal to the view's own name
 * included — the rule drops only what nobody wrote); a catalog translation for
 * a label-less view is served; a view that has a label is served its
 * translation. §3 holds the container read's answer to what it was.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import {
    translateMetaDocument,
    translateMetaEnvelope,
    translateMetaList,
    type MetaListTranslationSources,
} from './meta-item-read-gate.js';

// ---------------------------------------------------------------------------
// Fixtures — the card's recipe: an object with a label, views on it
// ---------------------------------------------------------------------------

const OBJ = 'recheck_gate';
const PKG = 'com.qa.recheck';

const config = () => ({ type: 'grid', columns: ['name', 'kind'] });

/** The card's step 3 body: a list view PUT with NO `label`. */
const BARE = `${OBJ}.default`;
const bareView = () => ({ name: BARE, object: OBJ, viewKind: 'list', isDefault: true, config: config() });

/** A view with an authored label, which the `zh-CN` catalog translates. */
const NAMED = `${OBJ}.named`;
const namedView = () => ({ name: NAMED, object: OBJ, label: 'All gates', viewKind: 'list', config: config() });

/** A view with NO label, which the `zh-CN` catalog nevertheless translates. */
const TAGGED = `${OBJ}.tagged`;
const taggedView = () => ({ name: TAGGED, object: OBJ, viewKind: 'list', config: config() });

/** A view whose AUTHORED label happens to equal its own name. */
const SELF = `${OBJ}.self`;
const selfView = () => ({ name: SELF, object: OBJ, label: SELF, viewKind: 'list', config: config() });

const VIEWS = () => [bareView(), namedView(), taggedView(), selfView()];

const BUNDLE: Record<string, any> = {
    en: { objects: { [OBJ]: { label: 'QA Gate', _views: {} } } },
    'zh-CN': {
        objects: {
            [OBJ]: {
                label: '质检闸门',
                _views: { named: { label: '全部闸门' }, tagged: { label: '已标记' } },
            },
        },
    },
};

const i18nService = {
    getLocales: () => Object.keys(BUNDLE),
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

/** A deployment that registers no catalog at all: no bundle, a default locale. */
const bundlelessI18n = {
    getLocales: () => [] as string[],
    getTranslations: () => undefined,
    getDefaultLocale: () => 'en',
};

/**
 * What each view is served, per locale. `undefined` = the served document
 * carries NO `label` key at all.
 */
const EXPECTED: Record<string, Record<string, string | undefined>> = {
    en: { [BARE]: undefined, [NAMED]: 'All gates', [TAGGED]: undefined, [SELF]: SELF },
    'zh-CN': { [BARE]: undefined, [NAMED]: '全部闸门', [TAGGED]: '已标记', [SELF]: SELF },
};

const LOCALES = ['en', 'zh-CN'] as const;

/** The served `label`, asserting the key is absent where nothing was authored or translated. */
function expectServedLabel(doc: any, name: string, locale: string): void {
    const expected = EXPECTED[locale][name];
    expect(doc, `${name} ${locale}: served`).toBeTruthy();
    if (expected === undefined) {
        expect('label' in doc, `${name} ${locale}: no label key (served ${JSON.stringify(doc.label)})`).toBe(false);
    } else {
        expect(doc.label, `${name} ${locale}`).toBe(expected);
    }
}

// ---------------------------------------------------------------------------
// §1 — the standalone server's routes, over a REAL registry and protocol
// ---------------------------------------------------------------------------

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * Seed each view as the PUBLISHED row a runtime save stores
 * (`state: 'active'`, environment-wide since ADR-0131 D6) and mount the REST
 * routes over the real protocol.
 */
function makeHost(i18n: unknown = i18nService) {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    registry.registerItem('object', {
        name: OBJ,
        label: 'QA Gate',
        pluralLabel: 'QA Gates',
        fields: { name: { type: 'text', label: 'Name' }, kind: { type: 'text', label: 'Kind' } },
    }, 'name', PKG);

    const rows = VIEWS().map((view, i) => ({
        id: `r_${i}`,
        type: 'view',
        name: view.name,
        package_id: null,
        organization_id: null,
        state: 'active',
        metadata: JSON.stringify(view),
    }));
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return (r[k] ?? null) === (v ?? null);
        });
    const engine = {
        registry,
        find: async (table: string, q: { where: Record<string, unknown>; limit?: number }) => {
            if (table !== 'sys_metadata') return [];
            const matched = rows.filter((r) => matches(r, q.where));
            return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
        },
        findOne: async (table: string, q: { where: Record<string, unknown> }) => {
            assertEngineFindOnePredicate(table, q);
            return table === 'sys_metadata' ? rows.find((r) => matches(r, q.where)) ?? null : null;
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never, undefined, 'env_test');

    const rest = new RestServer(
        createMockServer() as never, protocol as never, { api: { requireAuth: false } } as never,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        // i18nServiceProvider — the 14th constructor argument.
        async () => i18n as never,
    );
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx = async () => ({
        userId: 'u_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    });
    rest.registerRoutes();
    const routes = rest.getRouteManager();

    const run = async (path: string, params: Record<string, string>, headers: Record<string, string>) => {
        const entry = routes.get('GET', path);
        if (!entry) throw new Error(`route not registered: GET ${path}`);
        let body: unknown;
        let status = 200;
        const res = {
            status: (s: number) => { status = s; return res; },
            header: () => res,
            json: (b: unknown) => { body = b; },
            send: (b: unknown) => { body = b; },
        } as unknown as Parameters<typeof entry.handler>[1];
        await entry.handler(
            { params, query: {}, body: {}, headers, method: 'GET', path } as unknown as Parameters<typeof entry.handler>[0],
            res,
        );
        expect(status, `GET ${path} ${JSON.stringify(params)}: ${JSON.stringify(body)}`).toBe(200);
        return body as any;
    };
    const lang = (locale?: string): Record<string, string> => (locale ? { 'accept-language': locale } : {});

    return {
        /** `GET /meta/view/:name` → the served document. */
        item: async (name: string, locale?: string) =>
            (await run('/api/v1/meta/:type/:name', { type: 'view', name }, lang(locale)))?.item,
        /** `GET /meta/view` → the served page. */
        list: async (locale?: string): Promise<any[]> => {
            const body = await run('/api/v1/meta/:type', { type: 'view' }, lang(locale));
            return Array.isArray(body) ? body : body?.items ?? [];
        },
    };
}

describe('#23967 §1 the standalone routes — GET /meta/view/NAME and GET /meta/view', () => {
    it.each(LOCALES)('GET /meta/view/%s… — every view is served its authored or translated label, and a label-less one none', async (locale) => {
        const host = makeHost();
        for (const name of [BARE, NAMED, TAGGED, SELF]) {
            expectServedLabel(await host.item(name, locale), name, locale);
        }
    });

    it.each(LOCALES)('GET /meta/view in %s — the list serves the same labels as the item read', async (locale) => {
        const page = await makeHost().list(locale);
        for (const name of [BARE, NAMED, TAGGED, SELF]) {
            expectServedLabel(page.find((d) => d?.name === name), name, locale);
        }
    });

    it('the card\'s read: GET /meta/view/recheck_gate.default carries no `label` equal to its name, with no Accept-Language and no catalog', async () => {
        // The deployment's default locale resolves, so the read still translates; nothing is invented.
        const host = makeHost(bundlelessI18n);
        const item = await host.item(BARE);
        expect(item.name).toBe(BARE);
        expect(item.label).not.toBe(BARE);
        expect('label' in item).toBe(false);
        const listed = (await host.list()).find((d) => d?.name === BARE);
        expect('label' in listed).toBe(false);
        // The authored one is untouched on the same deployment.
        expect((await host.item(NAMED)).label).toBe('All gates');
    });
});

// ---------------------------------------------------------------------------
// §2 — the functions the runtime dispatcher's `/meta` domain calls
// ---------------------------------------------------------------------------

function sources(locale: string | undefined, i18n: unknown = i18nService): MetaListTranslationSources {
    return {
        resolveI18nService: async () => i18n,
        resolveProtocol: async () => ({ getPackagedViewBase: () => undefined }),
        requestLocale: () => locale,
    };
}

describe('#23967 §2 translateMetaEnvelope / translateMetaList — the dispatcher\'s item and list translation', () => {
    it.each(LOCALES)('translateMetaEnvelope in %s: the item under `item` carries the same labels', async (locale) => {
        for (const view of VIEWS()) {
            const body = await translateMetaEnvelope(sources(locale), 'view', { type: 'view', name: view.name }, view);
            expect(body.name).toBe(view.name);
            expectServedLabel(body.item, view.name, locale);
        }
    });

    it.each(LOCALES)('translateMetaList in %s: a bare array and the `{ type, items }` envelope alike', async (locale) => {
        const bare = (await translateMetaList(sources(locale), 'view', VIEWS())) as any[];
        const enveloped = (await translateMetaList(sources(locale), 'view', { type: 'view', items: VIEWS() })) as any;
        expect(enveloped.type).toBe('view');
        for (const page of [bare, enveloped.items as any[]]) {
            for (const view of VIEWS()) {
                expectServedLabel(page.find((d) => d.name === view.name), view.name, locale);
            }
        }
    });

    it('with no catalog registered, a label-less view is served none on both reads', async () => {
        const item = (await translateMetaDocument(sources('en', bundlelessI18n), 'view', bareView())) as any;
        expect('label' in item).toBe(false);
        const [listed] = (await translateMetaList(sources('en', bundlelessI18n), 'view', [bareView()])) as any[];
        expect('label' in listed).toBe(false);
    });

    it('keeps everything else the view carries, and does not mutate the served document', async () => {
        const view = bareView();
        const item = (await translateMetaDocument(sources('zh-CN'), 'view', view)) as any;
        expect(item).toEqual(bareView());
        expect(view).toEqual(bareView());
        const [listed] = (await translateMetaList(sources('zh-CN'), 'view', [view])) as any[];
        expect(listed).toEqual(bareView());
    });

    it('a label-less view served with no locale resolved is returned as stored', async () => {
        const view = bareView();
        expect(await translateMetaDocument(sources(undefined), 'view', view)).toBe(view);
        const page = [view];
        expect(await translateMetaList(sources(undefined), 'view', page)).toBe(page);
    });
});

// ---------------------------------------------------------------------------
// §3 — CONTROL: the container read answers what it answered
// ---------------------------------------------------------------------------

describe('#23967 §3 CONTROL — the view container read is unchanged', () => {
    const grid = (label?: string) => ({
        type: 'grid',
        ...(label !== undefined ? { label } : {}),
        data: { provider: 'object', object: OBJ },
        columns: ['name'],
    });

    it('translates each slot it has a string for, and invents no label for the container or a slot without one', async () => {
        const container = { object: OBJ, list: grid(), listViews: { named: grid('All gates'), tagged: grid() } };
        const out = (await translateMetaDocument(sources('zh-CN'), 'view', container)) as any;
        expect(out).toEqual({
            object: OBJ,
            list: grid(),
            listViews: { named: grid('全部闸门'), tagged: grid('已标记') },
        });
        expect(container.listViews.named.label).toBe('All gates');
    });

    it('returns the SAME container when no catalog string applies', async () => {
        const container = { object: OBJ, list: grid() };
        expect(await translateMetaDocument(sources('en'), 'view', container)).toBe(container);
    });
});
