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
 * registered the way the boot registers them and the org overlay rows are
 * seeded the way a published overlay stores them, so no write verb is doubled.
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

type OverlayRow = { type: 'dashboard' | 'view'; name: string; body: Record<string, unknown> };

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
 * the PUBLISHED org row its write stores (`package_id: null`, the org,
 * `state: 'active'`). `overlays: []` is the state after a reset.
 */
function makeHost(overlays: OverlayRow[], who: Who) {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    registry.registerItem('dashboard', packagedDashboard(), 'name', AUTH_PKG);
    registry.registerItem('dashboard', packagedControlDashboard(), 'name', SHOWCASE_PKG);
    registry.registerItem('view', { name: OBJ, ...taskContainer() }, 'name', SHOWCASE_PKG);
    for (const item of expandViewContainer(OBJ, taskContainer())) registry.registerItem('view', item, 'name', SHOWCASE_PKG);

    const rows = overlays.map((o, i) => ({
        id: `r_${i}`,
        type: o.type,
        name: o.name,
        package_id: null,
        organization_id: ORG,
        state: 'active',
        metadata: JSON.stringify(o.body),
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
    });

    it('asks each type its own accessor, handing the served name through unchanged', () => {
        const p = protocol();
        expect(packagedObjectBaseOf(p, 'object', 'showcase_account')).toEqual({ kind: 'object', name: 'showcase_account' });
        expect(packagedObjectBaseOf(p, 'dashboard', DASH)).toEqual({ kind: 'dashboard', name: DASH });
        // The qualified registry name — never the bare `in_progress` the catalog uses.
        expect(packagedObjectBaseOf(p, 'view', VIEW)).toEqual({ kind: 'view', name: VIEW });
        expect(p.getPackagedObjectBase).toHaveBeenCalledTimes(1);
        expect(p.getPackagedDashboardBase).toHaveBeenCalledTimes(1);
        expect(p.getPackagedViewBase).toHaveBeenCalledTimes(1);
    });

    it('asks nothing for a type with no packaged base', () => {
        const p = protocol();
        for (const type of ['action', 'app', 'dataset', 'page', 'report', 'toString', 'constructor']) {
            expect(packagedObjectBaseOf(p, type, 'x'), type).toBeUndefined();
        }
        expect(p.getPackagedObjectBase).not.toHaveBeenCalled();
        expect(p.getPackagedDashboardBase).not.toHaveBeenCalled();
        expect(p.getPackagedViewBase).not.toHaveBeenCalled();
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

describe('#20730 §2 dashboard — a published org overlay is what both /meta reads serve', () => {
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

describe('#20730 §3 view — a published org overlay on a packaged view is what both /meta reads serve', () => {
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
