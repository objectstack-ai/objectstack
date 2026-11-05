// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20730 — the `/meta` item and list reads hand a DASHBOARD and a VIEW their
 * packaged base, so a published org overlay beats the packaged catalog. The
 * dashboard and view twin of `meta-object-i18n-explicit-override.test.ts`.
 *
 * The RULE lives in `@objectstack/spec/system` (`translateDashboard`,
 * `translateView`: the catalog applies only while the served string still
 * equals the packaged one — ADR-0029 D9.2a), and the BASE lives on the
 * protocol (`getPackagedDashboardBase`, `getPackagedViewBase`). Both halves
 * were on `main` and neither changed a served answer, because the read
 * boundary handed the translator a base for objects only
 * (`packagedObjectBaseOf`). What is pinned here is that plumbing, through the
 * ROUTES, over the REAL protocol and a REAL registry: the packaged items are
 * registered the way the boot registers them and the overlay rows are seeded
 * the way a published overlay stores them, so no write verb is doubled. Since
 * ADR-0131 D6 that is the ENVIRONMENT row (`organization_id` NULL): the `/meta`
 * doors carry no organization, though both callers have an active one.
 *
 * Measured before the fix (a booted showcase, admin and member of one org): an
 * overlay on `system_overview` published, `?layers=true` reported it
 * effective, and both reads kept serving `Total Users` / `用户总数`; the same for
 * a view overlay on `showcase_task.in_progress` read in `zh-CN` (`进行中`).
 *
 * Covered, per the triage's list: after an overlay and a publish, the item read
 * and the list read serve the edit, for an admin and for a member, in `en` and
 * `zh-CN`; the unedited widget / view stays translated; a reset (no overlay
 * row) restores the shipped body, translated; a dashboard whose catalog
 * carries no widget titles (the showcase control) serves the edit unchanged.
 *
 * #25788 — a REPORT joined the table when it became translatable: it is
 * overlay-editable too (ADR-0126 Regime O), so `translateReport` landed with
 * its base (`getPackagedReportBase`) and §4 pins the same three facts for it.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { expandViewContainer } from '@objectstack/spec/ui';
import { RestServer } from './rest-server.js';
import { packagedObjectBaseOf } from './meta-item-read-gate.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = 'org_acme';
const AUTH_PKG = 'com.objectstack.plugin-auth';
const SHOWCASE_PKG = 'com.example.showcase';

const DASH = 'system_overview';
const CONTROL_DASH = 'showcase_overview';
const OBJ = 'showcase_task';
const VIEW = 'showcase_task.in_progress';
const OTHER_VIEW = 'showcase_task.urgent';

const SHIPPED_TITLE = 'Total Users';
const EDITED_TITLE = 'Total Users (edited-20730)';
const SHIPPED_LABEL = 'In Progress';
const EDITED_LABEL = 'In Progress (edited-20730)';

const REPORT = 'opps_by_stage';
const SHIPPED_REPORT_LABEL = 'Opportunities by Stage';
const EDITED_REPORT_LABEL = 'Opportunities by Stage (edited-25788)';

/** The report as the code package ships it. */
const packagedReport = () => ({
    name: REPORT,
    label: SHIPPED_REPORT_LABEL,
    description: 'Summary of opportunities grouped by stage',
    type: 'summary',
    dataset: 'pipeline',
    rows: ['stage'],
    values: ['amount'],
});

/** The dashboard as the code package ships it. */
const packagedDashboard = () => ({
    name: DASH,
    label: 'System Overview',
    columns: 12,
    widgets: [
        { id: 'widget_total_users', type: 'metric', title: SHIPPED_TITLE, object: 'sys_user', layout: { x: 0, y: 0, w: 3, h: 2 } },
        { id: 'widget_organizations', type: 'metric', title: 'Organizations', object: 'sys_organization', layout: { x: 3, y: 0, w: 3, h: 2 } },
    ],
});

/** The control: a packaged dashboard whose catalog ships no widget titles. */
const packagedControlDashboard = () => ({
    name: CONTROL_DASH,
    label: 'Showcase Overview',
    columns: 12,
    widgets: [
        { id: 'open_tasks', type: 'metric', title: 'Open Tasks', object: OBJ, layout: { x: 0, y: 0, w: 3, h: 2 } },
    ],
});

const withWidgetTitle = (body: ReturnType<typeof packagedDashboard> | ReturnType<typeof packagedControlDashboard>, id: string, title: string) =>
    ({ ...body, widgets: body.widgets.map((w) => (w.id === id ? { ...w, title } : w)) });

const listView = (label: string) => ({
    label,
    type: 'grid' as const,
    data: { provider: 'object' as const, object: OBJ },
    columns: [{ field: 'title' }],
});

/** The `defineView` container as the code package ships it. */
const taskContainer = () => ({
    listViews: { in_progress: listView(SHIPPED_LABEL), urgent: listView('Urgent') },
});

/** The packaged view item as the boot registers it (`expandViewContainer`), by its qualified name. */
const packagedViewItem = (name: string) => {
    const item = expandViewContainer(OBJ, taskContainer()).find((v) => v.name === name);
    if (!item) throw new Error(`fixture missing ${name}`);
    return item;
};

/**
 * The packaged catalog: `en` repeats the shipped strings (what `i18n:extract`
 * writes, and what `platform-objects` ships for `system_overview`), `zh-CN`
 * translates them. The defect showed in BOTH: an `en` reader got the shipped
 * English back over the edit. The control dashboard has a label entry only.
 */
const BUNDLE: Record<string, any> = {
    en: {
        dashboards: {
            [DASH]: {
                widgets: {
                    widget_total_users: { title: SHIPPED_TITLE },
                    widget_organizations: { title: 'Organizations' },
                },
            },
            [CONTROL_DASH]: { label: 'Showcase Overview' },
        },
        objects: { [OBJ]: { _views: { in_progress: { label: SHIPPED_LABEL }, urgent: { label: 'Urgent' } } } },
        reports: { [REPORT]: { label: SHIPPED_REPORT_LABEL, description: 'Summary of opportunities grouped by stage' } },
    },
    'zh-CN': {
        dashboards: {
            [DASH]: {
                widgets: {
                    widget_total_users: { title: '用户总数' },
                    widget_organizations: { title: '组织' },
                },
            },
            [CONTROL_DASH]: { label: '展示概览' },
        },
        objects: { [OBJ]: { _views: { in_progress: { label: '进行中' }, urgent: { label: '紧急' } } } },
        reports: { [REPORT]: { label: '各阶段商机', description: '按阶段汇总的商机' } },
    },
};

const i18nService = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

/** An org-bound admin and a member of the same org — `tenantId` is the vetted organization. */
const CALLERS = {
    admin: { userId: 'u_admin', tenantId: ORG, systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    member: { userId: 'u_member', tenantId: ORG, systemPermissions: [] },
} as const;
type Who = keyof typeof CALLERS;

const LOCALES = ['en', 'zh-CN'] as const;

// ---------------------------------------------------------------------------
// The host: REAL registry, REAL protocol, the REST routes
// ---------------------------------------------------------------------------

type OverlayRow = { type: 'dashboard' | 'view' | 'report'; name: string; body: Record<string, unknown> };

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
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

/**
 * Register the packaged items the way the boot does and seed each overlay as
 * the PUBLISHED row its write stores (`package_id: null`, environment-wide
 * since ADR-0131 D6, `state: 'active'`). `overlays: []` is the state after a
 * reset.
 */
function makeHost(overlays: OverlayRow[], who: Who) {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    registry.registerItem('dashboard', packagedDashboard(), 'name', AUTH_PKG);
    registry.registerItem('dashboard', packagedControlDashboard(), 'name', SHOWCASE_PKG);
    registry.registerItem('view', { name: OBJ, ...taskContainer() }, 'name', SHOWCASE_PKG);
    for (const item of expandViewContainer(OBJ, taskContainer())) registry.registerItem('view', item, 'name', SHOWCASE_PKG);
    registry.registerItem('report', packagedReport(), 'name', SHOWCASE_PKG);

    const rows = overlays.map((o, i) => ({
        id: `r_${i}`,
        type: o.type,
        name: o.name,
        package_id: null,
        organization_id: null,
        state: 'active',
        metadata: JSON.stringify(o.body),
    }));
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
        async () => i18nService as never,
    );
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx = async () => ({ ...CALLERS[who] });
    rest.registerRoutes();
    const routes = rest.getRouteManager();

    const run = async (path: string, params: Record<string, string>, locale: string) => {
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
            { params, query: {}, body: {}, headers: { 'accept-language': locale }, method: 'GET', path } as unknown as Parameters<typeof entry.handler>[0],
            res,
        );
        expect(status, `GET ${path} ${JSON.stringify(params)}`).toBe(200);
        return body as any;
    };

    return {
        /** `GET /meta/:type/:name` → the served document. */
        item: async (type: string, name: string, locale: string) =>
            (await run('/api/v1/meta/:type/:name', { type, name }, locale))?.item,
        /** `GET /meta/:type` → the served document named `name` from the page. */
        listed: async (type: string, name: string, locale: string) => {
            const body = await run('/api/v1/meta/:type', { type }, locale);
            const items: any[] = Array.isArray(body) ? body : body?.items ?? [];
            return items.find((d) => d?.name === name);
        },
    };
}

const titleOf = (doc: any, id: string) => (doc?.widgets as any[] | undefined)?.find((w) => w?.id === id)?.title;

const EDITED_DASHBOARD: OverlayRow = { type: 'dashboard', name: DASH, body: withWidgetTitle(packagedDashboard(), 'widget_total_users', EDITED_TITLE) };
const EDITED_VIEW: OverlayRow = { type: 'view', name: VIEW, body: { ...packagedViewItem(VIEW), label: EDITED_LABEL } };
const EDITED_REPORT: OverlayRow = { type: 'report', name: REPORT, body: { ...packagedReport(), label: EDITED_REPORT_LABEL } };

const READS = ['item', 'listed'] as const;
const cells = () => (Object.keys(CALLERS) as Who[]).flatMap((who) =>
    LOCALES.flatMap((locale) => READS.map((read) => ({ who, locale, read }))));

// ---------------------------------------------------------------------------
// §1 — the resolver: one table, three accessors
// ---------------------------------------------------------------------------

describe('#20730 §1 packagedObjectBaseOf — one per-type packaged-base resolver', () => {
    const protocol = () => ({
        getPackagedObjectBase: vi.fn((name: string) => ({ kind: 'object', name })),
        getPackagedDashboardBase: vi.fn((name: string) => ({ kind: 'dashboard', name })),
        getPackagedViewBase: vi.fn((name: string) => ({ kind: 'view', name })),
        getPackagedReportBase: vi.fn((name: string) => ({ kind: 'report', name })),
        // [#30062] A pair's declared override of a page, dataset, app or book replaces the base's item too.
        getPackagedPageBase: vi.fn((name: string) => ({ kind: 'page', name })),
        getPackagedDatasetBase: vi.fn((name: string) => ({ kind: 'dataset', name })),
        getPackagedAppBase: vi.fn((name: string) => ({ kind: 'app', name })),
        getPackagedBookBase: vi.fn((name: string) => ({ kind: 'book', name })),
    });

    it('asks each type its own accessor, handing the served name through unchanged', () => {
        const p = protocol();
        expect(packagedObjectBaseOf(p, 'object', 'showcase_account')).toEqual({ kind: 'object', name: 'showcase_account' });
        expect(packagedObjectBaseOf(p, 'dashboard', DASH)).toEqual({ kind: 'dashboard', name: DASH });
        // The qualified registry name — never the bare `in_progress` the catalog uses.
        expect(packagedObjectBaseOf(p, 'view', VIEW)).toEqual({ kind: 'view', name: VIEW });
        // [#25788] A report is overlay-editable too (ADR-0126 Regime O).
        expect(packagedObjectBaseOf(p, 'report', REPORT)).toEqual({ kind: 'report', name: REPORT });
        expect(p.getPackagedObjectBase).toHaveBeenCalledTimes(1);
        expect(p.getPackagedDashboardBase).toHaveBeenCalledTimes(1);
        expect(p.getPackagedViewBase).toHaveBeenCalledTimes(1);
        expect(p.getPackagedReportBase).toHaveBeenCalledTimes(1);
        // [#30062] The four sealed types a pair's declared override replaces.
        expect(packagedObjectBaseOf(p, 'page', 'crm_welcome')).toEqual({ kind: 'page', name: 'crm_welcome' });
        expect(packagedObjectBaseOf(p, 'dataset', 'opportunity_metrics')).toEqual({ kind: 'dataset', name: 'opportunity_metrics' });
        expect(packagedObjectBaseOf(p, 'app', 'crm')).toEqual({ kind: 'app', name: 'crm' });
        expect(packagedObjectBaseOf(p, 'book', 'crm_manual')).toEqual({ kind: 'book', name: 'crm_manual' });
        for (const accessor of ['getPackagedPageBase', 'getPackagedDatasetBase', 'getPackagedAppBase', 'getPackagedBookBase'] as const) {
            expect(p[accessor], accessor).toHaveBeenCalledTimes(1);
        }
    });

    it('asks nothing for a type with no packaged base', () => {
        const p = protocol();
        for (const type of ['action', 'flow', 'pages', 'toString', 'constructor']) {
            expect(packagedObjectBaseOf(p, type, 'x'), type).toBeUndefined();
        }
        for (const accessor of Object.keys(p) as (keyof typeof p)[]) {
            expect(p[accessor], accessor).not.toHaveBeenCalled();
        }
    });

    it('answers undefined for an empty name, a protocol without the accessor, and an accessor that throws', () => {
        expect(packagedObjectBaseOf(protocol(), 'dashboard', '')).toBeUndefined();
        expect(packagedObjectBaseOf(protocol(), 'view', undefined)).toBeUndefined();
        expect(packagedObjectBaseOf({ getPackagedObjectBase: () => ({}) }, 'dashboard', DASH)).toBeUndefined();
        expect(packagedObjectBaseOf(undefined, 'view', VIEW)).toBeUndefined();
        const throwing = { getPackagedViewBase: () => { throw new Error('registry read failed'); } };
        expect(packagedObjectBaseOf(throwing, 'view', VIEW)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// §2 — a published dashboard overlay beats the packaged catalog
// ---------------------------------------------------------------------------

describe('#20730 §2 dashboard — a published overlay is what both /meta reads serve', () => {
    it.each(cells())('$read read, $who, $locale: the edited widget serves the edit', async ({ who, locale, read }) => {
        const host = makeHost([EDITED_DASHBOARD], who);
        expect(titleOf(await host[read]('dashboard', DASH, locale), 'widget_total_users')).toBe(EDITED_TITLE);
    });

    it.each(cells())('$read read, $who, $locale: the unedited widget stays translated', async ({ who, locale, read }) => {
        const host = makeHost([EDITED_DASHBOARD], who);
        const expected = locale === 'zh-CN' ? '组织' : 'Organizations';
        expect(titleOf(await host[read]('dashboard', DASH, locale), 'widget_organizations')).toBe(expected);
    });

    it.each(cells())('$read read, $who, $locale: after a reset the shipped body is served, translated', async ({ who, locale, read }) => {
        const host = makeHost([], who);
        const expected = locale === 'zh-CN' ? '用户总数' : SHIPPED_TITLE;
        expect(titleOf(await host[read]('dashboard', DASH, locale), 'widget_total_users')).toBe(expected);
    });

    it('CONTROL — the showcase dashboard, whose catalog ships no widget titles, serves an overlay edit on both reads, as before', async () => {
        const overlay: OverlayRow = {
            type: 'dashboard',
            name: CONTROL_DASH,
            body: withWidgetTitle(packagedControlDashboard(), 'open_tasks', 'Open Tasks (edited-20730)'),
        };
        for (const who of Object.keys(CALLERS) as Who[]) {
            const host = makeHost([overlay], who);
            for (const locale of LOCALES) {
                for (const read of READS) {
                    const doc = await host[read]('dashboard', CONTROL_DASH, locale);
                    expect(titleOf(doc, 'open_tasks'), `${read} ${who} ${locale}`).toBe('Open Tasks (edited-20730)');
                    // Its unedited label still translates.
                    expect(doc?.label, `${read} ${who} ${locale}`).toBe(locale === 'zh-CN' ? '展示概览' : 'Showcase Overview');
                }
            }
        }
    });
});

// ---------------------------------------------------------------------------
// §3 — a published view overlay beats the packaged catalog
// ---------------------------------------------------------------------------

describe('#20730 §3 view — a published overlay on a packaged view is what both /meta reads serve', () => {
    it.each(cells())('$read read, $who, $locale: the edited view serves the edit', async ({ who, locale, read }) => {
        const host = makeHost([EDITED_VIEW], who);
        expect((await host[read]('view', VIEW, locale))?.label).toBe(EDITED_LABEL);
    });

    it.each(cells())('$read read, $who, $locale: an unedited view stays translated', async ({ who, locale, read }) => {
        const host = makeHost([EDITED_VIEW], who);
        expect((await host[read]('view', OTHER_VIEW, locale))?.label).toBe(locale === 'zh-CN' ? '紧急' : 'Urgent');
    });

    it.each(cells())('$read read, $who, $locale: after a reset the shipped label is served, translated', async ({ who, locale, read }) => {
        const host = makeHost([], who);
        expect((await host[read]('view', VIEW, locale))?.label).toBe(locale === 'zh-CN' ? '进行中' : SHIPPED_LABEL);
    });
});

// ---------------------------------------------------------------------------
// §4 — a published report overlay beats the packaged catalog (#25788)
// ---------------------------------------------------------------------------

describe('#25788 §4 report — a published overlay on a packaged report is what both /meta reads serve', () => {
    it.each(cells())('$read read, $who, $locale: the edited label serves the edit', async ({ who, locale, read }) => {
        const host = makeHost([EDITED_REPORT], who);
        expect((await host[read]('report', REPORT, locale))?.label).toBe(EDITED_REPORT_LABEL);
    });

    it.each(cells())('$read read, $who, $locale: the unedited description stays translated', async ({ who, locale, read }) => {
        const host = makeHost([EDITED_REPORT], who);
        const expected = locale === 'zh-CN' ? '按阶段汇总的商机' : 'Summary of opportunities grouped by stage';
        expect((await host[read]('report', REPORT, locale))?.description).toBe(expected);
    });

    it.each(cells())('$read read, $who, $locale: after a reset the shipped label is served, translated', async ({ who, locale, read }) => {
        const host = makeHost([], who);
        expect((await host[read]('report', REPORT, locale))?.label).toBe(locale === 'zh-CN' ? '各阶段商机' : SHIPPED_REPORT_LABEL);
    });
});

// ---------------------------------------------------------------------------
// §5 — [#30062] a `.custom` pair's declared override: the ruled label order
// ---------------------------------------------------------------------------

/**
 * [#30062 item 3, ruling record 6631250894] A pair's declared override
 * (ADR-0146 D2) is served with ONE label order on every type and every read: a
 * translation the pair ships, then the override's own label, then the base's
 * translation. The order itself is `@objectstack/spec/system`'s
 * (`labelCatalogs`); what is pinned here is that the `/meta` reads hand the
 * translators both inputs it needs:
 *
 *  - `packagedBase` — the BASE's item, for a page, a dataset, an app and a
 *    book too (`getPackagedPageBase`, `getPackagedDatasetBase`,
 *    `getPackagedAppBase`, `getPackagedBookBase`), as the object, dashboard,
 *    view and report already had it;
 *  - `pairBundle` — the translations the pair ships itself
 *    (`servedOverrideBaseOf` + `getPairTranslationBundle`), for every served
 *    declared override.
 *
 * Measured before (a booted CRM in zh-CN, the card's table): a page override
 * labelled `OVpage` served the base's `欢迎页`, a dataset override served the
 * base's text. And a view override whose pair ships a `zh-CN` translation of its
 * new label served the override's English: the pair's translation never got in.
 *
 * The rows are seeded the way Studio's Customize publishes them: the override
 * row bound to the pair (`package_id: <base>.custom`) declaring
 * `overrides: { package: <base> }`, and the pair's translation an active
 * `translation` row bound to the pair. The deployment catalog is what the i18n
 * service serves: every code bundle deep-merged with every authored row
 * (`readAuthoredTranslationLayer`), so the pair's row is in it too, with its
 * package dropped.
 */

const PAIR_PKG = `${SHOWCASE_PKG}.custom`;
const OVERRIDE_DECLARATION = { package: SHOWCASE_PKG, basedOn: '1.0.0' };

interface PrecedenceType {
    readonly type: 'page' | 'dataset' | 'app' | 'book' | 'view';
    readonly name: string;
    /** The base's item, as the code package ships it. */
    readonly shipped: () => Record<string, unknown>;
    /** The deployment catalog's group for this item, keyed by the item's label. */
    readonly catalog: (label: string) => Record<string, unknown>;
    readonly shippedZh: string;
}

const PRECEDENCE_TYPES: readonly PrecedenceType[] = [
    {
        type: 'page', name: 'crm_welcome', shippedZh: '欢迎页',
        shipped: () => ({ name: 'crm_welcome', label: 'Welcome', type: 'app', regions: [] }),
        catalog: (label) => ({ pages: { crm_welcome: { label } } }),
    },
    {
        type: 'dataset', name: 'opportunity_metrics', shippedZh: '商机指标',
        shipped: () => ({
            name: 'opportunity_metrics', label: 'Opportunity Metrics', object: OBJ,
            dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
            measures: [{ name: 'task_count', label: 'Tasks', aggregate: 'count' }],
        }),
        catalog: (label) => ({ datasets: { opportunity_metrics: { label } } }),
    },
    {
        type: 'app', name: 'crm', shippedZh: '客户关系',
        shipped: () => ({ name: 'crm', label: 'CRM' }),
        catalog: (label) => ({ apps: { crm: { label } } }),
    },
    {
        type: 'book', name: 'crm_manual', shippedZh: '手册',
        shipped: () => ({ name: 'crm_manual', label: 'Manual', groups: [{ key: 'start', label: 'Start', pages: [] }] }),
        catalog: (label) => ({ books: { crm_manual: { label } } }),
    },
    // An existing type, for the pair's rank: the base was always handed over, the pair's translation never.
    {
        type: 'view', name: VIEW, shippedZh: '进行中',
        shipped: () => ({ ...packagedViewItem(VIEW) }),
        catalog: (label) => ({ objects: { [OBJ]: { _views: { in_progress: { label } } } } }),
    },
];

/** Deep merge, `top` over `under`, of two translation-data groups (the shape `deepMerge` gives). */
const mergeData = (under: Record<string, any>, top: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = { ...under };
    for (const [k, v] of Object.entries(top)) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
            ? mergeData(out[k], v)
            : v;
    }
    return out;
};

/** The deployment's code catalog: `en` repeats each shipped label, `zh-CN` translates it. */
const precedenceStaticCatalog = (): Record<string, Record<string, any>> => {
    let en: Record<string, any> = {};
    let zh: Record<string, any> = {};
    for (const t of PRECEDENCE_TYPES) {
        en = mergeData(en, t.catalog(String(t.shipped().label)));
        zh = mergeData(zh, t.catalog(t.shippedZh));
    }
    return { en, 'zh-CN': zh };
};

interface PrecedenceSeed {
    /** The override's label per type; absent = no override row. */
    readonly overrides?: Partial<Record<PrecedenceType['type'], string>>;
    /** The pair's own `zh-CN` translation of the item's label, per type. */
    readonly pairZh?: Partial<Record<PrecedenceType['type'], string>>;
}

function makePrecedenceHost(seed: PrecedenceSeed, who: Who) {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    registry.registerItem('view', { name: OBJ, ...taskContainer() }, 'name', SHOWCASE_PKG);
    for (const item of expandViewContainer(OBJ, taskContainer())) registry.registerItem('view', item, 'name', SHOWCASE_PKG);
    for (const t of PRECEDENCE_TYPES) {
        if (t.type !== 'view') registry.registerItem(t.type, t.shipped(), 'name', SHOWCASE_PKG);
    }

    const rows: Record<string, unknown>[] = [];
    for (const t of PRECEDENCE_TYPES) {
        const label = seed.overrides?.[t.type];
        if (label === undefined) continue;
        rows.push({
            id: `ov_${t.type}`, type: t.type, name: t.name, package_id: PAIR_PKG, organization_id: null, state: 'active',
            metadata: JSON.stringify({ ...t.shipped(), label, overrides: OVERRIDE_DECLARATION }),
        });
    }
    let pairZh: Record<string, any> = {};
    for (const t of PRECEDENCE_TYPES) {
        const label = seed.pairZh?.[t.type];
        if (label !== undefined) pairZh = mergeData(pairZh, t.catalog(label));
    }
    if (Object.keys(pairZh).length > 0) {
        rows.push({
            id: 'tr_pair_zh', type: 'translation', name: 'showcase_custom_zh', package_id: PAIR_PKG, organization_id: null,
            state: 'active', metadata: JSON.stringify({ name: 'showcase_custom_zh', locale: 'zh-CN', ...pairZh }),
        });
    }

    // What the i18n service serves: the code catalog with every authored row merged over it.
    const catalog = precedenceStaticCatalog();
    const merged: Record<string, any> = { en: catalog.en, 'zh-CN': mergeData(catalog['zh-CN'], pairZh) };
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
        async () => i18n as never,
    );
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx = async () => ({ ...CALLERS[who] });
    rest.registerRoutes();
    const routes = rest.getRouteManager();
    const run = async (path: string, params: Record<string, string>, locale: string) => {
        const entry = routes.get('GET', path);
        if (!entry) throw new Error(`route not registered: GET ${path}`);
        let body: unknown;
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
        return body as any;
    };
    return {
        item: async (type: string, name: string, locale: string) =>
            (await run('/api/v1/meta/:type/:name', { type, name }, locale))?.item,
        listed: async (type: string, name: string, locale: string) => {
            const body = await run('/api/v1/meta/:type', { type }, locale);
            const items: any[] = Array.isArray(body) ? body : body?.items ?? [];
            return items.find((d) => d?.name === name);
        },
        /** `GET /meta/book/:name/tree` — the docs sidebar's book. */
        bookTree: async (name: string, locale: string) => run('/api/v1/meta/book/:name/tree', { name }, locale),
    };
}

const precedenceCells = () => PRECEDENCE_TYPES.flatMap((t) => READS.map((read) => ({ t, type: t.type, read })));
const OV = (type: string) => `OV ${type} (30062)`;
const PAIR_ZH = (type: string) => `配对包译文 ${type}`;

describe('[#30062] §5 a .custom pair\'s declared override serves the ruled label order on both /meta reads', () => {
    it.each(precedenceCells())('$type, $read read: the override\'s own label beats the base\'s translation (no pair translation)', async ({ t, read }) => {
        const host = makePrecedenceHost({ overrides: { [t.type]: OV(t.type) } }, 'admin');
        expect((await host[read](t.type, t.name, 'zh-CN'))?.label, 'zh-CN').toBe(OV(t.type));
        expect((await host[read](t.type, t.name, 'en'))?.label, 'en').toBe(OV(t.type));
    });

    it.each(precedenceCells())('$type, $read read: a translation the pair ships beats the override\'s own label', async ({ t, read }) => {
        const host = makePrecedenceHost({ overrides: { [t.type]: OV(t.type) }, pairZh: { [t.type]: PAIR_ZH(t.type) } }, 'admin');
        expect((await host[read](t.type, t.name, 'zh-CN'))?.label, 'zh-CN').toBe(PAIR_ZH(t.type));
        // The pair ships no `en`: the override's own label.
        expect((await host[read](t.type, t.name, 'en'))?.label, 'en').toBe(OV(t.type));
    });

    it.each(precedenceCells())('$type, $read read: with no override the base\'s item reads its translation', async ({ t, read }) => {
        const host = makePrecedenceHost({}, 'admin');
        expect((await host[read](t.type, t.name, 'zh-CN'))?.label, 'zh-CN').toBe(t.shippedZh);
        expect((await host[read](t.type, t.name, 'en'))?.label, 'en').toBe(t.shipped().label);
    });

    it('a member reads the same order as an admin', async () => {
        const host = makePrecedenceHost({ overrides: { page: OV('page'), dataset: OV('dataset') }, pairZh: { page: PAIR_ZH('page') } }, 'member');
        for (const read of READS) {
            expect((await host[read]('page', 'crm_welcome', 'zh-CN'))?.label, `page ${read}`).toBe(PAIR_ZH('page'));
            expect((await host[read]('dataset', 'opportunity_metrics', 'zh-CN'))?.label, `dataset ${read}`).toBe(OV('dataset'));
        }
    });

    it('the book tree serves the label the book list serves (#26690: the docs sidebar and the list never disagree)', async () => {
        for (const seed of [
            { overrides: { book: OV('book') } },
            { overrides: { book: OV('book') }, pairZh: { book: PAIR_ZH('book') } },
            {},
        ] as PrecedenceSeed[]) {
            const host = makePrecedenceHost(seed, 'admin');
            for (const locale of LOCALES) {
                const listed = (await host.listed('book', 'crm_manual', locale))?.label;
                expect((await host.bookTree('crm_manual', locale))?.label, `${JSON.stringify(seed)} ${locale}`).toBe(listed);
            }
        }
    });
});
