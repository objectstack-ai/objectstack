// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#23497] `GET /forms/:slug` localizes the served form's SECTION headings
// under `Accept-Language`, beside the field labels it already localized.
//
// An anonymous visitor cannot load the translation bundle client-side (the
// `/i18n` domain answers an anonymous caller 401, and the console's language
// loader answers `{}` signed out), so the client-side
// `objects.OBJECT._sections.NAME` lookup never fires for it. Before this, the
// route translated `objectSchema` and spread each section as authored: a
// zh-CN visitor read English section titles over Chinese field labels.
//
// The RULES live in `@objectstack/spec/system` (`translateView`, which the
// route reaches through `translateMetadataDocument('view', …)`): the key is
// the section's `name`, a missing key keeps the authored text, a nameless
// section is returned as authored, and an explicit override beats the catalog
// against the packaged view. What is pinned here is the ROUTE's half: that it
// makes the call, with the request's locale and the packaged view base, and
// serves its result through the existing lookup / master-detail / user strip.
//
// The translator localizes sections at a view item's `config`, one of the
// three slots an open form is found in. The other two (a container's `form`
// and `formViews.KEY`) never reach the route: the protocol's view list drops
// every container and serves each of its forms as the `viewKind: 'form'` item
// it expands to. Pinned below over the REAL protocol, beside what the route
// answers when it is handed a form in those slots anyway.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { expandViewContainer } from '@objectstack/spec/ui';
import { RestServer } from './rest-server';

// [#10126] Pay the first transform of the dist-resolved workspace dep the
// handler reaches through a dynamic `import()` at MODULE LOAD, not inside a
// clocked `it()` body (`scripts/check-test-source-alias.mjs`).
import '@objectstack/spec/system';

const ABOUT_EN = 'Tell us about yourself';
const ABOUT_DESC_EN = 'We will get back to you within a day.';
const ABOUT_ZH = '介绍一下你自己';
const ABOUT_DESC_ZH = '我们会在一天内回复你。';

/**
 * The served form view, in the flattened registered shape the protocol
 * enumerates (`viewKind: 'form'`, the form under `config`). Three sections:
 *
 *  - `about` — its label and description are in the zh-CN bundle; it also
 *    declares a lookup field, which the anonymous route strips;
 *  - `details` — named, but the bundle carries no key for it;
 *  - a NAMELESS section labelled `More` — the bundle carries
 *    `_sections.more.label`, so a route that slugged a label into a key would
 *    translate it.
 */
function formView(aboutLabel = ABOUT_EN) {
    return {
        name: 'ticket_form',
        object: 'ticket',
        viewKind: 'form',
        label: 'Contact us',
        config: {
            data: { object: 'ticket' },
            sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/test' },
            sections: [
                { name: 'about', label: aboutLabel, description: ABOUT_DESC_EN, fields: ['subject', 'contact_id'] },
                { name: 'details', label: 'Details', description: 'Anything else we should know.', fields: ['email'] },
                { label: 'More', fields: ['status'] },
            ],
        },
    };
}

const ticketObject = {
    name: 'ticket',
    label: 'Ticket',
    fields: {
        subject: { type: 'text', label: 'Subject' },
        email: { type: 'text', label: 'Email' },
        status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
        contact_id: { type: 'lookup', reference: 'contact', label: 'Contact' },
    },
};

/**
 * The catalog. `en` carries the field labels only, so an `en` request has no
 * section key to read; `zh-CN` translates the fields and two `_sections` keys.
 */
const BUNDLE: Record<string, any> = {
    en: { objects: { ticket: { fields: { subject: { label: 'Subject' }, email: { label: 'Email' } } } } },
    'zh-CN': {
        objects: {
            ticket: {
                fields: { subject: { label: '主题' }, email: { label: '邮箱' }, status: { label: '状态' } },
                _sections: {
                    about: {
                        label: ABOUT_ZH,
                        description: ABOUT_DESC_ZH,
                        // A section entry's override copy (read only by the entry pins below).
                        fields: { subject: { label: '您的问题', placeholder: '一句话概括', helpText: '我们据此分派工单' } },
                    },
                    more: { label: '更多' },
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
    return async (locale: string, slug = 'test') => {
        const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
        res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
        res.json = vi.fn((b: any) => { res.body = b; return res; });
        res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
        await resolve.handler({ params: { slug }, query: {}, headers: { 'accept-language': locale } } as any, res);
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        return res;
    };
}

/**
 * The route over a protocol double that serves `view` as the one view body.
 * `packagedView`, when given, is what the protocol's `getPackagedViewBase`
 * answers — the packaged view before any overlay, which the override rule
 * compares the served strings against.
 */
function buildServer(view: Record<string, any>, packagedView?: Record<string, any>) {
    const getPackagedViewBase = vi.fn((name: string) => (name === view.name ? packagedView : undefined));
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: { type: string }) => {
            if (type === 'view') return [view];
            if (type === 'object') return [ticketObject];
            return [];
        }),
        ...(packagedView ? { getPackagedViewBase } : {}),
    };
    return { get: routeOver(protocol), getPackagedViewBase };
}

const section = (res: any, index: number) => res.body.form.sections[index];
const renderedFields = (res: any) => res.body.form.sections.map((s: any) =>
    (s.fields ?? []).map((f: any) => (typeof f === 'string' ? f : f.field)));

describe('[#23497] GET /forms/:slug — section headings are localized under Accept-Language', () => {
    it('zh-CN: a named section with a `_sections` key is served its translated label and description', async () => {
        const res = await buildServer(formView()).get('zh-CN');
        expect(section(res, 0)).toMatchObject({ name: 'about', label: ABOUT_ZH, description: ABOUT_DESC_ZH });
        // The translated section is the one the strip ran over: its lookup is gone.
        expect(section(res, 0).fields).toEqual(['subject']);
    });

    it('zh-CN: a named section whose key the bundle lacks keeps its authored label and description', async () => {
        const res = await buildServer(formView()).get('zh-CN');
        expect(section(res, 1)).toMatchObject({
            name: 'details', label: 'Details', description: 'Anything else we should know.',
        });
    });

    it('zh-CN: a section with no `name` is served as authored, even though a key matching its label exists', async () => {
        const res = await buildServer(formView()).get('zh-CN');
        expect(section(res, 2).label).toBe('More');
        expect(section(res, 2).name).toBeUndefined();
    });

    it('zh-CN: an override beats the catalog — an edited heading keeps the edit, the unedited description translates', async () => {
        // The served view carries a heading edited on top of the packaged one;
        // the packaged view (the protocol's `getPackagedViewBase`) still ships
        // the original. The catalog is the translation of the ORIGINAL, so it
        // must not overwrite the edit.
        const edited = 'Tell us about yourself (edited)';
        const { get, getPackagedViewBase } = buildServer(formView(edited), formView());
        const res = await get('zh-CN');
        expect(section(res, 0)).toMatchObject({ name: 'about', label: edited, description: ABOUT_DESC_ZH });
        // Looked up by the served item's registry name, as the `/meta/view` reads do.
        expect(getPackagedViewBase).toHaveBeenCalledWith('ticket_form');
    });

    it('CONTROL — en: every section is served its authored text', async () => {
        const res = await buildServer(formView()).get('en');
        expect(res.body.form.sections.map((s: any) => [s.label, s.description])).toEqual([
            [ABOUT_EN, ABOUT_DESC_EN],
            ['Details', 'Anything else we should know.'],
            ['More', undefined],
        ]);
    });

    it('CONTROL: the field labels in `objectSchema` are translated as before', async () => {
        const { get } = buildServer(formView());
        const zh = await get('zh-CN');
        expect(zh.body.objectSchema.fields.subject.label).toBe('主题');
        expect(zh.body.objectSchema.fields.email.label).toBe('邮箱');
        const en = await get('en');
        expect(en.body.objectSchema.fields.subject.label).toBe('Subject');
    });

    it('CONTROL: under zh-CN the lookup strip still removes a lookup field from its section', async () => {
        const res = await buildServer(formView()).get('zh-CN');
        expect(renderedFields(res)).toEqual([['subject'], ['email'], ['status']]);
    });

    it('CONTROL: the response shape, its top-level label and `Vary` are unchanged, and the stored view is not mutated', async () => {
        const view = formView();
        const res = await buildServer(view).get('zh-CN');
        expect(Object.keys(res.body).sort()).toEqual(['form', 'label', 'object', 'objectSchema', 'slug']);
        expect(res.body).toMatchObject({ slug: 'test', object: 'ticket', label: 'Contact us' });
        expect(res.headers.Vary).toBe('Accept-Language');
        expect(view.config.sections[0]).toMatchObject({ label: ABOUT_EN, description: ABOUT_DESC_EN });
        expect(view.config.sections[0].fields).toEqual(['subject', 'contact_id']);
    });
});

// ─── the three form slots ───────────────────────────────────────────────────
//
// `anonymousFormIntakeCandidates` finds an open form in three slots of a view
// body: a container's `form`, a container's `formViews.KEY`, and a
// `viewKind: 'form'` item's `config`. The spec's view translator localizes
// sections at the THIRD address only, and the route serves its translation for
// that slot alone. The two pins below are why that is the whole population, and
// what the route does with a body that breaks the premise.

/** A container's form as the showcase authors its public form: a `formViews` entry and the default `form`. */
const containerForm = (slug: string) => ({
    type: 'simple',
    data: { provider: 'object', object: 'ticket' },
    sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${slug}` },
    sections: [
        { name: 'about', label: ABOUT_EN, description: ABOUT_DESC_EN, fields: ['subject', 'contact_id'] },
        { name: 'details', label: 'Details', description: 'Anything else we should know.', fields: ['email'] },
    ],
});
const ticketContainer = () => ({ object: 'ticket', form: containerForm('ticket-default'), formViews: { contact: containerForm('ticket-contact') } });

const PKG = 'com.example.helpdesk';

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/**
 * The REAL protocol (`ObjectStackProtocolImplementation`) over a real
 * `SchemaRegistry`, with the container registered the way the boot registers
 * a `defineView` container (the bare object key, then every item
 * `expandViewContainer` expands it to), over a READ-ONLY in-memory
 * `sys_metadata` the overlay rows are seeded into.
 */
function realProtocolSession() {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const rows: Record<string, unknown>[] = [];
    // Only what the route's reads reach: the registry and the `sys_metadata`
    // list read the protocol's view list overlays rows from.
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
    return { protocol, rows, get: routeOver(protocol) };
}

describe('[#23497] a container-authored form reaches the route as the item the protocol expands it to', () => {
    it('the view list the route reads serves each container form only as a `viewKind: \'form\'` item, its form under `config`', async () => {
        const { protocol } = realProtocolSession();
        const views: any[] = (await protocol.getMetaItems({ type: 'view' })).items;
        // No served body carries a container slot, so no candidate the route
        // matches can come from `form` or `formViews`.
        expect(views.filter((v) => v && ('form' in v || 'formViews' in v))).toEqual([]);
        const forms = views.filter((v) => v?.viewKind === 'form');
        expect(forms.map((v) => [v.name, v.config?.sharing?.publicLink]).sort()).toEqual([
            ['ticket.contact', '/forms/ticket-contact'],
            ['ticket.form', '/forms/ticket-default'],
        ]);
    });

    for (const slug of ['ticket-contact', 'ticket-default']) {
        it(`zh-CN: the form authored at ${slug === 'ticket-contact' ? '`formViews.contact`' : 'the default `form`'} is served its translated headings`, async () => {
            const { get } = realProtocolSession();
            const res = await get('zh-CN', slug);
            expect(res.body.form.sections.map((s: any) => [s.name, s.label, s.description])).toEqual([
                ['about', ABOUT_ZH, ABOUT_DESC_ZH],
                ['details', 'Details', 'Anything else we should know.'],
            ]);
            expect(renderedFields(res)).toEqual([['subject'], ['email']]);
            // CONTROL: the same form under `en` is served as authored.
            const en = await get('en', slug);
            expect(en.body.form.sections.map((s: any) => s.label)).toEqual([ABOUT_EN, 'Details']);
        });
    }

    it('zh-CN: a heading an environment overlay edited keeps the edit against the packaged view the real protocol answers', async () => {
        const { rows, get, protocol } = realProtocolSession();
        const shipped: any = expandViewContainer('ticket', ticketContainer()).find((v) => v.name === 'ticket.contact');
        const edited = 'Tell us about yourself (edited)';
        const overlay = {
            ...shipped,
            config: {
                ...shipped.config,
                sections: shipped.config.sections.map((s: any) => (s.name === 'about' ? { ...s, label: edited } : s)),
            },
        };
        rows.push({
            id: 'r_1', type: 'view', name: 'ticket.contact', package_id: null, organization_id: null,
            state: 'active', metadata: JSON.stringify(overlay),
        });
        // The packaged base is the item the package shipped, under the served item's own name.
        expect((protocol.getPackagedViewBase('ticket.contact') as any)?.config?.sections?.[0]?.label).toBe(ABOUT_EN);
        const res = await get('zh-CN', 'ticket-contact');
        expect(section(res, 0)).toMatchObject({ name: 'about', label: edited, description: ABOUT_DESC_ZH });
    });
});

describe('[#23497] a form matched outside `config` is served as matched', () => {
    // No body the route reads carries a container slot (the pin above), but
    // the route still answers one it is handed, from a protocol double or a
    // row stored before the write door stored parsed bodies: its own sections,
    // never the item's `config`, and as authored, because the spec's view
    // translator localizes sections at `config` only.
    for (const [where, slug] of [['form', 'ticket-default'], ['formViews.contact', 'ticket-contact']] as const) {
        it(`a container's \`${where}\` is answered with its own sections, as authored`, async () => {
            const res = await buildServer({ name: 'ticket', ...ticketContainer() }).get('zh-CN', slug);
            expect(res.body.form.sharing.publicLink).toBe(`/forms/${slug}`);
            expect(res.body.form.sections.map((s: any) => [s.name, s.label])).toEqual([
                ['about', ABOUT_EN],
                ['details', 'Details'],
            ]);
            // The strip still ran over it.
            expect(renderedFields(res)).toEqual([['subject'], ['email']]);
        });
    }
});

describe('GET /forms/:slug — a section entry\'s label, placeholder and helpText are localized under Accept-Language', () => {
    /** The form view with an entry object overriding the `subject` field's copy in `about`, and one in `details` the bundle has no key for. */
    const entryFormView = () => {
        const view = formView();
        view.config.sections[0].fields = [
            { field: 'subject', label: 'Your question', placeholder: 'One line, please', helpText: 'We route the ticket by it' },
            'contact_id',
        ] as any;
        view.config.sections[1].fields = [{ field: 'email', label: 'Your email', placeholder: 'you@example.com' }] as any;
        return view;
    };
    const entry = (res: any, index: number) => res.body.form.sections[index].fields[0];

    it('zh-CN: a pack with `_sections.<section>.fields.<field>` serves the translated entry label, placeholder and helpText', async () => {
        const res = await buildServer(entryFormView()).get('zh-CN');
        expect(entry(res, 0)).toEqual({
            field: 'subject', label: '您的问题', placeholder: '一句话概括', helpText: '我们据此分派工单',
        });
        // The strip still ran over the translated section: its lookup is gone.
        expect(renderedFields(res)[0]).toEqual(['subject']);
    });

    it('zh-CN: an entry the pack has no key for is served its authored copy', async () => {
        const res = await buildServer(entryFormView()).get('zh-CN');
        expect(entry(res, 1)).toEqual({ field: 'email', label: 'Your email', placeholder: 'you@example.com' });
    });

    it('CONTROL — en: the entry is served its authored copy', async () => {
        const res = await buildServer(entryFormView()).get('en');
        expect(entry(res, 0)).toEqual({
            field: 'subject', label: 'Your question', placeholder: 'One line, please', helpText: 'We route the ticket by it',
        });
    });
});
