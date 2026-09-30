// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20680 — `ObjectStackProtocolImplementation.getPackagedDashboardBase`, against
 * a REAL `SchemaRegistry`, and the read it exists to feed.
 *
 * ## What was measured, and what it rules out
 *
 * An org overlay on the platform's own `system_overview` dashboard (ADR-0126
 * Regime O — a packaged dashboard is overlay-editable) published `200`, and
 * `?layers=true` reported it as effective, while the `/meta` item and list
 * reads kept serving the shipped widget title. Measured on a booted showcase
 * with an org-bound admin and a member of the same org: the write stored ONE
 * row (`type: 'dashboard'`, the name, `package_id: null`, the org,
 * `state: 'active'` after publish), and `getMetaItem` / `getMetaItems` both
 * answered it — the overlay branch of the item read hit that row. So the write
 * and every protocol read agree on the item's identity; the plain read's
 * `_packageId: com.objectstack.plugin-auth` is only the code artifact's
 * protection envelope, grafted onto the overlay body by
 * `mergeArtifactProtection`.
 *
 * What replaced the title was the i18n catalog: `platform-objects` ships an
 * `en` bundle whose `dashboards.system_overview.widgets.<id>.title` repeats
 * the shipped string, and `translateDashboard` applied it over whatever the
 * document said. The showcase dashboard (the control) ships no widget titles
 * in its bundle, so the same overlay reached its reader untouched.
 *
 * The rule that fixes it is ADR-0029 D9.2a's — an explicit override beats a
 * packaged default, decided by comparing against the PACKAGED declaration —
 * and that comparison is only as good as the body this accessor returns. Hence
 * a real registry: the body must be the one the code package shipped, never an
 * overlay the protocol hydrated under the plain registry key.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { translateDashboard, type TranslationBundle } from '@objectstack/spec/system';
import { SchemaRegistry } from './registry.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';

const PKG = 'com.objectstack.plugin-auth';
const DASH = 'system_overview';
const ORG = 'org_acme';

const SHIPPED_TITLE = 'Total Users';
const EDITED_TITLE = 'Total Users (edited)';

/** The dashboard as the code package ships it. */
const packagedBody = () => ({
    name: DASH,
    label: 'System Overview',
    columns: 12,
    widgets: [
        { id: 'widget_total_users', type: 'metric', title: SHIPPED_TITLE, object: 'sys_user', layout: { x: 0, y: 0, w: 3, h: 2 } },
        { id: 'widget_organizations', type: 'metric', title: 'Organizations', object: 'sys_organization', layout: { x: 3, y: 0, w: 3, h: 2 } },
    ],
});

/** The same dashboard as the org's published overlay stores it — one title edited. */
const overlayBody = () => {
    const body = packagedBody();
    body.widgets[0] = { ...body.widgets[0], title: EDITED_TITLE };
    return body;
};

/**
 * The catalog `platform-objects` ships: `en` repeats the shipped strings,
 * `zh-CN` translates them. Both locales, because the defect showed in the
 * SOURCE locale — an `en` reader got the shipped English back over the edit.
 */
const BUNDLE: TranslationBundle = {
    en: {
        dashboards: {
            [DASH]: {
                widgets: {
                    widget_total_users: { title: SHIPPED_TITLE },
                    widget_organizations: { title: 'Organizations' },
                },
            },
        },
    } as any,
    'zh-CN': {
        dashboards: {
            [DASH]: {
                widgets: {
                    widget_total_users: { title: '用户总数' },
                    widget_organizations: { title: '组织' },
                },
            },
        },
    } as any,
};

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/**
 * A real registry and the real protocol over a READ-ONLY in-memory
 * `sys_metadata`: the rows are seeded exactly as the measured write left them,
 * so no write verb is doubled here at all.
 */
function makeSession() {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const rows: Record<string, unknown>[] = [];
    const engine: any = {
        registry,
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            // The real engine's #4419 predicate: a `findOne` naming no record is refused.
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            return rows.find((r) => matchesWhere(r, o.where)) ?? null;
        },
        async find(table: string, o: { where: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = rows.filter((r) => matchesWhere(r, o.where));
            // The caller's bound, applied after the filter, by presence.
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
    return { protocol, registry, rows };
}

/** The code package's registration (plugin-auth's manifest, in the measured boot). */
function registerPackaged(registry: SchemaRegistry) {
    registry.registerItem('dashboard', packagedBody(), 'name', PKG);
}

/** The published org overlay row, in the identity the measured write stored. */
function seedOrgOverlay(rows: Record<string, unknown>[]) {
    rows.push({
        id: 'r_1',
        type: 'dashboard',
        name: DASH,
        package_id: null,
        organization_id: ORG,
        state: 'active',
        metadata: JSON.stringify(overlayBody()),
    });
}

const titleOf = (doc: any, id = 'widget_total_users') =>
    (doc?.widgets as any[] | undefined)?.find((w) => w?.id === id)?.title;

describe('#20680 getPackagedDashboardBase — the packaged declaration, never an overlay', () => {
    it('answers the body the code package shipped', () => {
        const s = makeSession();
        registerPackaged(s.registry);
        const base = s.protocol.getPackagedDashboardBase(DASH);
        expect(titleOf(base)).toBe(SHIPPED_TITLE);
        expect(base?._packageId).toBe(PKG);
    });

    it('is immune to an overlay hydrated under the plain registry key', () => {
        // An env-wide overlay is hydrated into the registry's PLAIN key on
        // publish. The accessor must still answer the packaged body — a base
        // that returned the overlay would compare the edit equal to itself and
        // hand the catalog straight back.
        const s = makeSession();
        registerPackaged(s.registry);
        s.registry.registerItem('dashboard', overlayBody(), 'name');

        // The trap is live: the plain registry read answers the overlay…
        expect(titleOf(s.registry.getItem('dashboard', DASH))).toBe(EDITED_TITLE);
        // …and the packaged base does not move.
        expect(titleOf(s.protocol.getPackagedDashboardBase(DASH))).toBe(SHIPPED_TITLE);
    });

    it('is undefined for a dashboard no code package ships, an unknown name, and an empty name', () => {
        // "No packaged baseline" is a real answer: the translator reads it as
        // "infer nothing" and keeps the catalog, as before this change.
        const s = makeSession();
        s.registry.registerItem('dashboard', { ...packagedBody(), name: 'tenant_board' }, 'name');
        expect(s.protocol.getPackagedDashboardBase('tenant_board')).toBeUndefined();
        expect(s.protocol.getPackagedDashboardBase('no_such_board')).toBeUndefined();
        expect(s.protocol.getPackagedDashboardBase('')).toBeUndefined();
    });

    it('is undefined when the host registry cannot answer', () => {
        const partial: any = new ObjectStackProtocolImplementation({ registry: {} } as any, undefined, 'env_test');
        expect(partial.getPackagedDashboardBase(DASH)).toBeUndefined();
        const none: any = new ObjectStackProtocolImplementation({} as any, undefined, 'env_test');
        expect(none.getPackagedDashboardBase(DASH)).toBeUndefined();
    });
});

describe('#20680 the published org overlay, through the protocol read and the translation', () => {
    it('the item read serves the overlay — one identity for the write and the read', async () => {
        const s = makeSession();
        registerPackaged(s.registry);
        seedOrgOverlay(s.rows);
        const served = await s.protocol.getMetaItem({ type: 'dashboard', name: DASH, organizationId: ORG });
        expect(titleOf(served.item)).toBe(EDITED_TITLE);
        // The code artifact's envelope rides on the overlay body; it names the
        // registering package, not a second identity the overlay missed.
        expect(served.item._packageId).toBe(PKG);
    });

    it('the translation serves the edit once it is handed the packaged base — en and zh-CN', async () => {
        const s = makeSession();
        registerPackaged(s.registry);
        seedOrgOverlay(s.rows);
        const served = (await s.protocol.getMetaItem({ type: 'dashboard', name: DASH, organizationId: ORG })).item;
        const packagedBase = s.protocol.getPackagedDashboardBase(DASH);

        for (const locale of ['en', 'zh-CN']) {
            const out = translateDashboard(served, BUNDLE, { locale, packagedBase });
            expect(titleOf(out), `${locale}: the edited widget keeps the edit`).toBe(EDITED_TITLE);
        }
        // The widget nobody edited is still translated.
        const zh = translateDashboard(served, BUNDLE, { locale: 'zh-CN', packagedBase });
        expect(titleOf(zh, 'widget_organizations')).toBe('组织');
    });

    it('CONTROL — without the base, the catalog replaces the edit (the measured defect)', async () => {
        const s = makeSession();
        registerPackaged(s.registry);
        seedOrgOverlay(s.rows);
        const served = (await s.protocol.getMetaItem({ type: 'dashboard', name: DASH, organizationId: ORG })).item;
        expect(titleOf(translateDashboard(served, BUNDLE, { locale: 'en' }))).toBe(SHIPPED_TITLE);
        expect(titleOf(translateDashboard(served, BUNDLE, { locale: 'zh-CN' }))).toBe('用户总数');
    });

    it('after reset (no overlay row) the shipped body is served and still translated', async () => {
        const s = makeSession();
        registerPackaged(s.registry);
        const served = (await s.protocol.getMetaItem({ type: 'dashboard', name: DASH, organizationId: ORG })).item;
        const packagedBase = s.protocol.getPackagedDashboardBase(DASH);
        expect(titleOf(served)).toBe(SHIPPED_TITLE);
        expect(titleOf(translateDashboard(served, BUNDLE, { locale: 'zh-CN', packagedBase }))).toBe('用户总数');
    });
});
