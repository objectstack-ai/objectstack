// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `GET /forms/:slug` translates a public form view that a `.custom` pair
// overrides (ADR-0146 D2) in the same label order the `/meta/view` reads serve
// it in (ruling record 6631250894, restated by 6942920667): a translation the
// pair ships, then the override's own text, then the base's translation.
//
// The ORDER is `@objectstack/spec/system`'s (`labelCatalogs`), and the pair's
// translations are the protocol's to answer (`servedOverrideBaseOf` +
// `getPairTranslationBundle`, asked through `pairTranslationBundleOf`). What is
// pinned here is the ROUTE's half: that the view it serves is handed the
// pair's translations beside its packaged base, so the anonymous visitor reads
// the text the authenticated `/meta` reader reads.
//
// Every cell carries a CONTROL leg through `GET /meta/view/:name` on the same
// fixture. The pair rank needs the override envelope the read stamped on the
// served document (`_packageId` = the base, `overrides.package` = the base); a
// fixture that lost it would leave both surfaces on the override's own text,
// and the form pin would pass with the wiring absent. The control fails first.
//
// The object half of the form (its field labels) is out of this file: an
// `object` is extended, never replaced (ADR-0146 D10), so it never answers
// `servedOverrideBaseOf` and has no pair rank on `/meta` either.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { expandViewContainer } from '@objectstack/spec/ui';
import { RestServer } from './rest-server.js';

// Pay the first transform of the dist-resolved workspace dep the handlers reach
// through a dynamic `import()` at MODULE LOAD, not inside a clocked `it()` body
// (`scripts/check-test-source-alias.mjs`).
import '@objectstack/spec/system';

const OBJ = 'ticket';
const BASE_PKG = 'com.example.helpdesk';
const PAIR_PKG = `${BASE_PKG}.custom`;
const VIEW = `${OBJ}.contact`;
const SLUG = 'ticket-contact';

const TITLE_EN = 'Contact us';
const TITLE_ZH = '联系我们';
const ABOUT_EN = 'Tell us about yourself';
const ABOUT_ZH = '介绍一下你自己';
const ABOUT_DESC_EN = 'We will get back to you within a day.';
const ABOUT_DESC_ZH = '我们会在一天内回复你。';

/** The override's own text: what the pair's declared override wrote over the base. */
const TITLE_OV = 'Contact the helpdesk (pair override)';
const ABOUT_OV = 'About you (pair override)';
/** The pair's own zh-CN translation of the text its override wrote. */
const TITLE_PAIR_ZH = '联系服务台(配对包译文)';
const ABOUT_PAIR_ZH = '关于你(配对包译文)';

const ticketObject = {
    name: OBJ,
    label: 'Ticket',
    fields: {
        subject: { type: 'text', label: 'Subject' },
        email: { type: 'text', label: 'Email' },
    },
};

/** The `defineView` container as the code package ships it: one public form under `formViews.contact`. */
const ticketContainer = () => ({
    object: OBJ,
    formViews: {
        contact: {
            type: 'simple',
            title: TITLE_EN,
            data: { provider: 'object', object: OBJ },
            sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
            sections: [
                { name: 'about', label: ABOUT_EN, description: ABOUT_DESC_EN, fields: ['subject'] },
                { name: 'details', label: 'Details', fields: ['email'] },
            ],
        },
    },
});

/** The packaged form item as the boot registers it (`expandViewContainer`). */
const shippedFormItem = (): any => {
    const item = expandViewContainer(OBJ, ticketContainer()).find((v) => v.name === VIEW);
    if (!item) throw new Error(`fixture missing ${VIEW}`);
    return item;
};

/** The deployment's code catalog: `en` repeats the shipped strings, `zh-CN` translates them. */
const CODE_CATALOG: Record<string, Record<string, any>> = {
    en: {
        objects: {
            [OBJ]: {
                _views: { contact: { title: TITLE_EN } },
                _sections: { about: { label: ABOUT_EN, description: ABOUT_DESC_EN } },
            },
        },
    },
    'zh-CN': {
        objects: {
            [OBJ]: {
                _views: { contact: { title: TITLE_ZH } },
                _sections: { about: { label: ABOUT_ZH, description: ABOUT_DESC_ZH } },
            },
        },
    },
};

/** The pair's own zh-CN rows for the two strings its override changed. */
const PAIR_ZH_DATA = {
    objects: {
        [OBJ]: {
            _views: { contact: { title: TITLE_PAIR_ZH } },
            _sections: { about: { label: ABOUT_PAIR_ZH } },
        },
    },
};

/** Deep merge, `top` over `under`, of two translation-data groups. */
const mergeData = (under: Record<string, any>, top: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = { ...under };
    for (const [k, v] of Object.entries(top)) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
            ? mergeData(out[k], v)
            : v;
    }
    return out;
};

/** One `where` value as the store reads it: `{ $in: [...] }` or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

interface Seed {
    /** Seed the pair's declared override of the form view. */
    readonly override: boolean;
    /** Seed the pair's own zh-CN translation of the text its override wrote. */
    readonly pairZh: boolean;
}

/**
 * The REAL protocol over a real `SchemaRegistry`, the container registered the
 * way the boot registers a `defineView` container, and the `.custom` pair's
 * rows seeded the way Studio's Customize publishes them: the override row bound
 * to the pair (`package_id: <base>.custom`) declaring
 * `overrides: { package: <base> }`, and the pair's translation an active
 * `translation` row bound to the pair. The i18n service serves the deployment
 * catalog: the code catalog with every authored row merged over it, the pair's
 * row included, its package dropped.
 */
function makeHost(seed: Seed) {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    registry.registerObject(ticketObject as any, BASE_PKG);
    const container = ticketContainer();
    registry.registerItem('view', { name: OBJ, ...container }, 'name', BASE_PKG);
    for (const item of expandViewContainer(OBJ, container)) registry.registerItem('view', item, 'name', BASE_PKG);

    const rows: Record<string, unknown>[] = [];
    if (seed.override) {
        const shipped = shippedFormItem();
        const overridden = {
            ...shipped,
            config: {
                ...shipped.config,
                title: TITLE_OV,
                sections: shipped.config.sections.map((s: any) => (s.name === 'about' ? { ...s, label: ABOUT_OV } : s)),
            },
            overrides: { package: BASE_PKG, basedOn: '1.0.0' },
        };
        rows.push({
            id: 'ov_form', type: 'view', name: VIEW, package_id: PAIR_PKG, organization_id: null, state: 'active',
            metadata: JSON.stringify(overridden),
        });
    }
    if (seed.pairZh) {
        rows.push({
            id: 'tr_pair_zh', type: 'translation', name: 'helpdesk_custom_zh', package_id: PAIR_PKG, organization_id: null,
            state: 'active', metadata: JSON.stringify({ name: 'helpdesk_custom_zh', locale: 'zh-CN', ...PAIR_ZH_DATA }),
        });
    }

    const merged: Record<string, any> = {
        en: CODE_CATALOG.en,
        'zh-CN': seed.pairZh ? mergeData(CODE_CATALOG['zh-CN'], PAIR_ZH_DATA) : CODE_CATALOG['zh-CN'],
    };
    const i18n = {
        getLocales: () => ['en', 'zh-CN'],
        getTranslations: (locale: string) => merged[locale],
        getDefaultLocale: () => 'en',
    };

    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return whereValueMatches(r[k] ?? null, v ?? null);
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
        userId: 'u_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    });
    rest.registerRoutes();
    const routes = rest.getRouteManager();
    const run = async (path: string, params: Record<string, string>, locale: string) => {
        const entry = routes.get('GET', path);
        if (!entry) throw new Error(`route not registered: GET ${path}`);
        let body: any;
        let status = 200;
        const res = {
            status: (s: number) => { status = s; return res; },
            header: () => res,
            setHeader: () => res,
            json: (b: unknown) => { body = b; },
            send: (b: unknown) => { body = b; },
        } as unknown as Parameters<typeof entry.handler>[1];
        await entry.handler(
            { params, query: {}, body: {}, headers: { 'accept-language': locale }, method: 'GET', path } as unknown as Parameters<typeof entry.handler>[0],
            res,
        );
        expect(status, `GET ${path} ${JSON.stringify(params)}: ${JSON.stringify(body)}`).toBe(200);
        return body;
    };
    /** The two strings a reader sees, plus the about section's description (a string the override left alone). */
    const strings = (config: any) => ({
        title: config?.title,
        about: config?.sections?.find((s: any) => s?.name === 'about')?.label,
        aboutDescription: config?.sections?.find((s: any) => s?.name === 'about')?.description,
    });
    return {
        protocol,
        /** `GET /forms/:slug` — the anonymous visitor's read. */
        form: async (locale: string) => strings((await run('/api/v1/forms/:slug', { slug: SLUG }, locale))?.form),
        /** `GET /meta/view/:name` — the CONTROL leg: the authenticated read of the same document. */
        meta: async (locale: string) => strings((await run('/api/v1/meta/:type/:name', { type: 'view', name: VIEW }, locale))?.item?.config),
    };
}

describe('GET /forms/:slug serves a .custom pair override of the form view in the ruled label order', () => {
    it('the view the route matches carries the override envelope the pair rank reads', async () => {
        // The route matches its form in `getMetaItems({ type: 'view' })`; the pair
        // rank reads `servedOverrideBaseOf` off that served document.
        const { protocol } = makeHost({ override: true, pairZh: true });
        const views: any[] = ((await protocol.getMetaItems({ type: 'view' } as never)) as any).items;
        const served = views.find((v) => v?.name === VIEW);
        expect(served?._packageId).toBe(BASE_PKG);
        expect(served?.overrides?.package).toBe(BASE_PKG);
        expect(protocol.servedOverrideBaseOf('view', served)).toBe(BASE_PKG);
    });

    it('zh-CN: a translation the pair ships beats the override\'s own text, as /meta serves it', async () => {
        const host = makeHost({ override: true, pairZh: true });
        const expected = { title: TITLE_PAIR_ZH, about: ABOUT_PAIR_ZH, aboutDescription: ABOUT_DESC_ZH };
        // CONTROL: the authenticated read of the same document reads the pair's rank.
        expect(await host.meta('zh-CN'), '/meta/view zh-CN').toEqual(expected);
        expect(await host.form('zh-CN'), '/forms zh-CN').toEqual(expected);
    });

    it('en: the pair ships no en row, so both surfaces serve the override\'s own text', async () => {
        const host = makeHost({ override: true, pairZh: true });
        const expected = { title: TITLE_OV, about: ABOUT_OV, aboutDescription: ABOUT_DESC_EN };
        expect(await host.meta('en'), '/meta/view en').toEqual(expected);
        expect(await host.form('en'), '/forms en').toEqual(expected);
    });

    it('zh-CN with no pair translation: the override\'s own text beats the base\'s translation on both surfaces', async () => {
        const host = makeHost({ override: true, pairZh: false });
        const expected = { title: TITLE_OV, about: ABOUT_OV, aboutDescription: ABOUT_DESC_ZH };
        expect(await host.meta('zh-CN'), '/meta/view zh-CN').toEqual(expected);
        expect(await host.form('zh-CN'), '/forms zh-CN').toEqual(expected);
    });

    it('zh-CN with no override: the base\'s form reads the base\'s translation on both surfaces', async () => {
        const host = makeHost({ override: false, pairZh: false });
        const expected = { title: TITLE_ZH, about: ABOUT_ZH, aboutDescription: ABOUT_DESC_ZH };
        expect(await host.meta('zh-CN'), '/meta/view zh-CN').toEqual(expected);
        expect(await host.form('zh-CN'), '/forms zh-CN').toEqual(expected);
    });
});
