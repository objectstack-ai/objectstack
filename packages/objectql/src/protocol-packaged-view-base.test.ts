// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20731 — `ObjectStackProtocolImplementation.getPackagedViewBase`, against a
 * REAL `SchemaRegistry`, and the read it exists to feed. The view twin of
 * `protocol-packaged-dashboard-base.test.ts`.
 *
 * ## What was measured
 *
 * An org overlay on the showcase's packaged view `showcase_task.in_progress`
 * (ADR-0126 Regime O — a packaged view is overlay-editable) changed its label
 * and was published. An `en` reader was served the edit; a `zh-CN` reader,
 * admin or member, on the `/meta` item and list reads, was served `进行中` —
 * the catalog's translation of the label the package shipped. Reproduced here
 * one layer down, on the tree before this change: the protocol's item and list
 * reads both return the overlay's label, and `translateView` answered `进行中`
 * over it in `zh-CN` even when handed the packaged view, because it took no
 * base at all.
 *
 * The rule that fixes it is ADR-0029 D9.2a's — an explicit override beats a
 * packaged default, decided by comparing against the PACKAGED declaration —
 * and that comparison is only as good as the body this accessor returns. Hence
 * a real registry, registered the way the boot registers a `defineView`
 * container: the container under the bare object key, and each view it
 * expands to (`expandViewContainer`) under its qualified `<object>.<viewKey>`
 * name, which is the identity the base is looked up by.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { translateView, type TranslationBundle } from '@objectstack/spec/system';
import { expandViewContainer } from '@objectstack/spec/ui';
import { SchemaRegistry } from './registry.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';

const PKG = 'com.example.showcase';
const OBJ = 'showcase_task';
const VIEW = 'showcase_task.in_progress';
const ORG = 'org_acme';

const SHIPPED_LABEL = 'In Progress';
const EDITED_LABEL = 'In Progress (edited)';

const listView = (object: string, label: string) => ({
    label,
    type: 'grid' as const,
    data: { provider: 'object' as const, object },
    columns: [{ field: 'title' }],
});

/** The `defineView` container as the code package ships it. */
const taskContainer = () => ({
    listViews: {
        in_progress: listView(OBJ, SHIPPED_LABEL),
        urgent: listView(OBJ, 'Urgent'),
    },
});

/**
 * The catalog: `zh-CN` translates the shipped labels, keyed by the BARE view
 * key under its object; `en` repeats the shipped label, the way a package that
 * extracts its source locale ships it.
 */
const BUNDLE: TranslationBundle = {
    en: { objects: { [OBJ]: { _views: { in_progress: { label: SHIPPED_LABEL }, urgent: { label: 'Urgent' } } } } } as any,
    'zh-CN': { objects: { [OBJ]: { _views: { in_progress: { label: '进行中' }, urgent: { label: '紧急' } } } } } as any,
};

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/**
 * A real registry and the real protocol over a READ-ONLY in-memory
 * `sys_metadata`: the overlay row is seeded exactly as a published org overlay
 * stores it, so no write verb is doubled here at all.
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

/** Register a container the way the boot does: the bare object key, then every expanded view. */
function registerContainer(registry: SchemaRegistry, object: string, container: Record<string, unknown>, pkg: string) {
    registry.registerItem('view', { name: object, ...container }, 'name', pkg);
    for (const item of expandViewContainer(object, container)) {
        registry.registerItem('view', item, 'name', pkg);
    }
}

/** The packaged view item, as the boot registered it — the overlay's starting point. */
const packagedItem = () => {
    const item = expandViewContainer(OBJ, taskContainer()).find((v) => v.name === VIEW);
    if (!item) throw new Error(`fixture missing ${VIEW}`);
    return item;
};

/** The same view as the org's published overlay stores it — its label edited. */
const overlayBody = () => ({ ...packagedItem(), label: EDITED_LABEL });

/** The published org overlay row, in the identity the write stores. */
function seedOrgOverlay(rows: Record<string, unknown>[]) {
    rows.push({
        id: 'r_1',
        type: 'view',
        name: VIEW,
        package_id: null,
        organization_id: ORG,
        state: 'active',
        metadata: JSON.stringify(overlayBody()),
    });
}

describe('#20731 getPackagedViewBase — the packaged view, never an overlay', () => {
    it('answers the view item the code package shipped, by its qualified name', () => {
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        const base = s.protocol.getPackagedViewBase(VIEW);
        expect(base?.name).toBe(VIEW);
        expect(base?.object).toBe(OBJ);
        expect(base?.label).toBe(SHIPPED_LABEL);
        expect(base?._packageId).toBe(PKG);
    });

    it('is immune to an overlay hydrated under the plain registry key', () => {
        // A published overlay is hydrated into the registry's PLAIN key. The
        // accessor must still answer the packaged body — a base that returned
        // the overlay would compare the edit equal to itself and hand the
        // catalog straight back.
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        s.registry.registerItem('view', overlayBody(), 'name');

        // The trap is live: the plain registry read answers the overlay…
        expect((s.registry.getItem('view', VIEW) as any)?.label).toBe(EDITED_LABEL);
        // …and the packaged base does not move.
        expect(s.protocol.getPackagedViewBase(VIEW)?.label).toBe(SHIPPED_LABEL);
    });

    it('the KEY — matched by the qualified <object>.<viewKey>, never by the bare catalog key another object shares', () => {
        // The catalog addresses a view by its bare key UNDER its object, so the
        // bare key alone is not an identity: `showcase_project` ships an
        // `in_progress` view too. The base must be this object's view.
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        registerContainer(s.registry, 'showcase_project', { listViews: { in_progress: listView('showcase_project', 'Active Projects') } }, PKG);

        expect(s.protocol.getPackagedViewBase(VIEW)?.label).toBe(SHIPPED_LABEL);
        expect(s.protocol.getPackagedViewBase('showcase_project.in_progress')?.label).toBe('Active Projects');
        // The bare key selects nothing — no view is registered under it.
        expect(s.protocol.getPackagedViewBase('in_progress')).toBeUndefined();
    });

    it('is undefined for a view no code package ships, an unknown name, and an empty name', () => {
        // "No packaged baseline" is a real answer: the translator reads it as
        // "infer nothing" and keeps the catalog, as before this change.
        const s = makeSession();
        s.registry.registerItem('view', { ...packagedItem(), name: 'showcase_task.tenant_view' }, 'name');
        expect(s.protocol.getPackagedViewBase('showcase_task.tenant_view')).toBeUndefined();
        expect(s.protocol.getPackagedViewBase('showcase_task.no_such_view')).toBeUndefined();
        expect(s.protocol.getPackagedViewBase('')).toBeUndefined();
    });

    it('is undefined when the host registry cannot answer', () => {
        const partial: any = new ObjectStackProtocolImplementation({ registry: {} } as any, undefined, 'env_test');
        expect(partial.getPackagedViewBase(VIEW)).toBeUndefined();
        const none: any = new ObjectStackProtocolImplementation({} as any, undefined, 'env_test');
        expect(none.getPackagedViewBase(VIEW)).toBeUndefined();
    });
});

describe('#20731 the published org overlay, through the protocol reads and the translation', () => {
    it('the item and list reads serve the overlay — one identity for the write and both reads', async () => {
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        seedOrgOverlay(s.rows);
        const served = await s.protocol.getMetaItem({ type: 'view', name: VIEW, organizationId: ORG });
        expect(served.item.label).toBe(EDITED_LABEL);
        // The code artifact's envelope rides on the overlay body; it names the
        // registering package, not a second identity the overlay missed.
        expect(served.item._packageId).toBe(PKG);

        const list = await s.protocol.getMetaItems({ type: 'view', organizationId: ORG });
        const listed = (list.items as any[]).find((v) => v?.name === VIEW);
        expect(listed?.label).toBe(EDITED_LABEL);
    });

    it('the translation serves the edit once it is handed the packaged base — zh-CN and en, item and list', async () => {
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        seedOrgOverlay(s.rows);
        const item = (await s.protocol.getMetaItem({ type: 'view', name: VIEW, organizationId: ORG })).item;
        const listed = ((await s.protocol.getMetaItems({ type: 'view', organizationId: ORG })).items as any[])
            .find((v) => v?.name === VIEW);

        for (const served of [item, listed]) {
            const packagedBase = s.protocol.getPackagedViewBase(served.name);
            for (const locale of ['zh-CN', 'en']) {
                expect(translateView(served, BUNDLE, { locale, packagedBase }).label, locale).toBe(EDITED_LABEL);
            }
        }
    });

    it('an unedited view stays translated, handed its own base', async () => {
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        seedOrgOverlay(s.rows);
        const urgent = (await s.protocol.getMetaItem({ type: 'view', name: 'showcase_task.urgent', organizationId: ORG })).item;
        const packagedBase = s.protocol.getPackagedViewBase('showcase_task.urgent');
        expect(packagedBase?.label).toBe('Urgent');
        expect(translateView(urgent, BUNDLE, { locale: 'zh-CN', packagedBase }).label).toBe('紧急');
    });

    it('CONTROL — without the base, the catalog replaces the edit (the measured defect)', async () => {
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        seedOrgOverlay(s.rows);
        const served = (await s.protocol.getMetaItem({ type: 'view', name: VIEW, organizationId: ORG })).item;
        expect(translateView(served, BUNDLE, { locale: 'zh-CN' }).label).toBe('进行中');
        expect(translateView(served, BUNDLE, { locale: 'en' }).label).toBe(SHIPPED_LABEL);
    });

    it('after reset (no overlay row) the shipped label is served and translated again', async () => {
        const s = makeSession();
        registerContainer(s.registry, OBJ, taskContainer(), PKG);
        seedOrgOverlay(s.rows);
        const edited = (await s.protocol.getMetaItem({ type: 'view', name: VIEW, organizationId: ORG })).item;
        const packagedBase = s.protocol.getPackagedViewBase(VIEW);
        expect(translateView(edited, BUNDLE, { locale: 'zh-CN', packagedBase }).label).toBe(EDITED_LABEL);

        s.rows.length = 0;
        const served = (await s.protocol.getMetaItem({ type: 'view', name: VIEW, organizationId: ORG })).item;
        expect(served.label).toBe(SHIPPED_LABEL);
        expect(translateView(served, BUNDLE, { locale: 'zh-CN', packagedBase }).label).toBe('进行中');
    });
});
