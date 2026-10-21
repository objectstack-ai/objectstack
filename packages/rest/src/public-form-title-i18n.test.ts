// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `GET /forms/:slug` localizes the served form's TITLE (`form.title`) and the
// top-level `label` under `Accept-Language`.
//
// Before this, a public form could not be titled in more than one language:
// the title had no translation key, `translateView` never read `config.title`,
// and the route answered `label` from the view it matched, before
// translation. A form that declared a title served it in the authoring
// language to every visitor, so declaring one regressed every other locale
// from a translated heading (the object label) to an untranslated one.
//
// The console's public form page draws its heading as
// `payload.label ?? form.title ?? objectSchema.label`. All three now reach it
// translated, and the fall-through order is unchanged: a view that authors no
// `label` is still answered without one, so a form's title is not shadowed by
// the view's machine name.
//
// The RULES live in `@objectstack/spec/system` (`translateView`): the key is
// `objects.OBJECT._views.VIEW.title`, only an authored title is translated, a
// missing key keeps the authored text, and an explicit override beats the
// catalog against the packaged view. What is pinned here is the ROUTE's half.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { expandViewContainer } from '@objectstack/spec/ui';
import { RestServer } from './rest-server';

// [#10126] Pay the first transform of the dist-resolved workspace dep the
// handler reaches through a dynamic `import()` at MODULE LOAD, not inside a
// clocked `it()` body (`scripts/check-test-source-alias.mjs`).
import '@objectstack/spec/system';

const TITLE_EN = 'Contact us';
const TITLE_ZH = '联系我们';

const ticketObject = {
    name: 'ticket',
    label: 'Ticket',
    fields: {
        subject: { type: 'text', label: 'Subject' },
        email: { type: 'text', label: 'Email' },
    },
};

const publicForm = (slug: string, title?: string) => ({
    type: 'simple',
    data: { provider: 'object', object: 'ticket' },
    sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${slug}` },
    ...(title !== undefined ? { title } : {}),
    sections: [{ name: 'about', label: 'About', fields: ['subject', 'email'] }],
});

/**
 * Three public forms on one container: `contact` authors a title the bundle
 * translates, `untitled` authors none (the bundle carries a key for it that
 * must not apply), and `referral` authors a title the bundle has no key for.
 */
const ticketContainer = () => ({
    object: 'ticket',
    formViews: {
        contact: publicForm('contact-us', TITLE_EN),
        untitled: publicForm('untitled'),
        referral: publicForm('referral', 'Refer a friend'),
    },
});

const BUNDLE: Record<string, any> = {
    en: { objects: { ticket: { label: 'Ticket' } } },
    'zh-CN': {
        objects: {
            ticket: {
                label: '工单',
                fields: { subject: { label: '主题' } },
                _views: {
                    contact: { title: TITLE_ZH },
                    untitled: { title: 'MUST-NOT-APPLY' },
                    labelled: { label: '工单表单', title: '提交工单' },
                },
            },
        },
    },
};

const i18nService = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

/** The real `GET /forms/:slug` route, mounted over `protocol`. `get` answers one anonymous request. */
function routeOver(protocol: unknown) {
    const rest = new RestServer(
        mockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        // i18nServiceProvider — the 14th constructor argument.
        async () => i18nService as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const resolve = rest.getRoutes().find((r) => r.method === 'GET' && r.path.endsWith('/forms/:slug'))!;
    return async (locale: string, slug: string) => {
        const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
        res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
        res.json = vi.fn((b: any) => { res.body = b; return res; });
        res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
        await resolve.handler({ params: { slug }, query: {}, headers: { 'accept-language': locale } } as any, res);
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        return res;
    };
}

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

const PKG = 'com.example.helpdesk';

/**
 * The REAL protocol over a real `SchemaRegistry`, the container registered the
 * way the boot registers a `defineView` container (the bare object key, then
 * every item `expandViewContainer` expands it to), over a READ-ONLY in-memory
 * `sys_metadata` the overlay rows are seeded into.
 */
function realProtocolSession() {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const rows: Record<string, unknown>[] = [];
    const engine: any = {
        registry,
        async find(table: string, o: { where: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = rows.filter((r) => matchesWhere(r, o.where));
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
    registry.registerObject(ticketObject as any, PKG);
    const container = ticketContainer();
    registry.registerItem('view', { name: 'ticket', ...container }, 'name', PKG);
    for (const item of expandViewContainer('ticket', container)) registry.registerItem('view', item, 'name', PKG);
    return { rows, get: routeOver(protocol) };
}

/** The route over a protocol double that serves `view` as the one view body. */
function overDouble(view: Record<string, any>) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: { type: string }) => {
            if (type === 'view') return [view];
            if (type === 'object') return [ticketObject];
            return [];
        }),
    };
    return routeOver(protocol);
}

describe('GET /forms/:slug — the form title is localized under Accept-Language', () => {
    it('zh-CN: a form whose title the bundle keys under `_views.VIEW.title` is served the translated title', async () => {
        const { get } = realProtocolSession();
        const res = await get('zh-CN', 'contact-us');
        expect(res.body.form.title).toBe(TITLE_ZH);
        // The field labels are translated beside it, as before.
        expect(res.body.objectSchema.fields.subject.label).toBe('主题');
    });

    it('CONTROL — en: the same form is served its authored title', async () => {
        const { get } = realProtocolSession();
        const res = await get('en', 'contact-us');
        expect(res.body.form.title).toBe(TITLE_EN);
    });

    it('zh-CN: a title the bundle has no key for is served as authored', async () => {
        const { get } = realProtocolSession();
        const res = await get('zh-CN', 'referral');
        expect(res.body.form.title).toBe('Refer a friend');
    });

    it('CONTROL — a form with no title gains none, and the heading still falls back to the translated object label', async () => {
        const { get } = realProtocolSession();
        const res = await get('zh-CN', 'untitled');
        expect(res.body.form.title).toBeUndefined();
        // A container form item carries no `label`: the route answers none, so
        // the console's `payload.label ?? form.title ?? objectSchema.label`
        // reaches the object label, translated.
        expect(res.body.label).toBeUndefined();
        expect(res.body.objectSchema.label).toBe('工单');
    });

    it('CONTROL — `label` is not filled with the view\'s machine name when the view authors none', async () => {
        const { get } = realProtocolSession();
        const res = await get('zh-CN', 'contact-us');
        expect(res.body.label).toBeUndefined();
        expect(res.body.form.title).toBe(TITLE_ZH);
    });

    it('zh-CN: an environment overlay that edits the title keeps the edit against the packaged view', async () => {
        const { rows, get } = realProtocolSession();
        const shipped: any = expandViewContainer('ticket', ticketContainer()).find((v) => v.name === 'ticket.contact');
        const edited = 'Talk to us (edited)';
        rows.push({
            id: 'r_1', type: 'view', name: 'ticket.contact', package_id: null, organization_id: null,
            state: 'active', metadata: JSON.stringify({ ...shipped, config: { ...shipped.config, title: edited } }),
        });
        const res = await get('zh-CN', 'contact-us');
        expect(res.body.form.title).toBe(edited);
    });
});

describe('GET /forms/:slug — the top-level `label` is served from the TRANSLATED view', () => {
    /** A `viewKind: 'form'` item that authors both a `label` and a form `title`. */
    const labelledItem = () => ({
        name: 'labelled',
        object: 'ticket',
        viewKind: 'form',
        label: 'Ticket form',
        config: publicForm('labelled', 'File a ticket'),
    });

    it('zh-CN: an authored `label` with a `_views.VIEW.label` key is served translated, and so is the title', async () => {
        const res = await overDouble(labelledItem())('zh-CN', 'labelled');
        expect(res.body.label).toBe('工单表单');
        expect(res.body.form.title).toBe('提交工单');
    });

    it('CONTROL — en: both are served as authored', async () => {
        const res = await overDouble(labelledItem())('en', 'labelled');
        expect(res.body.label).toBe('Ticket form');
        expect(res.body.form.title).toBe('File a ticket');
    });

    it('CONTROL: the stored view is not mutated', async () => {
        const view = labelledItem();
        await overDouble(view)('zh-CN', 'labelled');
        expect(view.label).toBe('Ticket form');
        expect(view.config.title).toBe('File a ticket');
    });
});
