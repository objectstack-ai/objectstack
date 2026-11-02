// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28697] A package `registerApp` refuses part-way leaves nothing of itself
 * registered, and a refused re-register of an installed id leaves that install
 * serving.
 *
 * ## What this file pins
 *
 *  - every refusal the collection seam and the seed step judge from the body
 *    alone (an item's own `_packageId`, a divergent view container, a
 *    permission set's owner, a `views:` entry that is not a container, a
 *    `viewItems:` entry, a dataset's stamp, the same from a nested plugin) is
 *    raised with its code and status unchanged, and leaves no package record,
 *    object, app, navigation contribution, kind, datasource definition or
 *    nested-plugin namespace behind; on an installed id, the installed version
 *    still serves, untouched;
 *  - a refusal only the registry can raise part-way (a field with no `type`,
 *    an object another package owns, a picklist value already added, the same
 *    from a nested plugin) on a FIRST registration withdraws what was written,
 *    leaves the other package's object and list as they were, and keeps the
 *    boot seed of disabled packages;
 *  - CONTROLS: a clean body registers everything as before; a body that took
 *    over a tenant's object leaves nothing of itself and the tenant's object
 *    serves as before (`package-refused-first-install-over-tenant.test.ts`);
 *    an installed id refused part-way by the registry keeps serving its
 *    installed version (`package-refused-upgrade-keeps-installed.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

const PKG = 'com.probe.refused';
const HOST = 'com.probe.host';

const object = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    fields: { title: { type: 'text', label: 'Title' } },
    ...extra,
});
const app = (name: string) => ({
    name,
    label: name,
    navigation: [{ id: 'nav_a', type: 'object', label: 'A', objectName: 'probe_a' }],
});

/** A body that writes into every registry `registerApp` reaches. */
const body = (extra: Record<string, unknown> = {}) => ({
    id: PKG,
    name: PKG,
    objects: [object('probe_a')],
    apps: [app('probe_app')],
    datasources: [{ name: 'probe_ds', driver: 'memory' }],
    navigationContributions: [{ app: 'host_app', items: [{ id: 'probe_nav', type: 'url', label: 'Probe', url: '/probe' }] }],
    contributes: { kinds: [{ id: 'probe.kind' }] },
    plugins: [{ name: 'probe_inner', namespace: 'probeinner', objects: [object('probe_inner_thing')] }],
    ...extra,
});

/** What the engine holds of PKG, read through its public verbs. */
function trace(engine: ObjectQL) {
    const registry = engine.registry;
    return {
        pkg: registry.getPackage(PKG),
        objects: registry.getAllObjects().map((o: any) => o.name).filter((n: string) => n.startsWith('probe_')).sort(),
        apps: registry.listItems('app').map((a: any) => a.name).sort(),
        items: (['page', 'view', 'permission', 'data', 'picklist'] as const)
            .flatMap((type) => registry.listItems(type).filter((i: any) => i?._packageId === PKG).map((i: any) => `${type}/${i.name ?? i.object}`)),
        nav: registry.getAppNavContributions('host_app').map((c) => c.packageId),
        kinds: registry.getAllKinds().map((k) => k.id).filter((id) => id === 'probe.kind'),
        datasources: engine.listDatasourceDefs().map((d) => d.name).filter((n) => n === 'probe_ds'),
        innerNamespace: registry.getNamespaceOwner('probeinner'),
    };
}

function expectNothingOf(engine: ObjectQL) {
    expect(trace(engine)).toEqual({
        pkg: undefined, objects: [], apps: [], items: [], nav: [], kinds: [], datasources: [], innerNamespace: undefined,
    });
}

function refusal(fn: () => void): any {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected the registration to be refused');
}

// ── refusals judged from the body alone ────────────────────────────────────

const BODY_ONLY: Array<{ label: string; extra: Record<string, unknown>; code: string; status: number }> = [
    { label: 'a page wearing another package\'s `_packageId`', extra: { pages: [{ name: 'probe_page', type: 'app', _packageId: HOST }] }, code: 'VALIDATION_ERROR', status: 400 },
    { label: 'a view container whose own `name` differs from its key', extra: { views: [{ name: 'probe_wrong', object: 'probe_a', list: { type: 'grid', columns: ['title'] } }] }, code: 'VALIDATION_ERROR', status: 400 },
    { label: 'a permission set naming another package', extra: { permissions: [{ name: 'probe_ps', packageId: HOST, objects: {} }] }, code: 'VALIDATION_ERROR', status: 400 },
    { label: 'a `views:` entry that is not a container', extra: { views: [{ name: 'probe_vi', viewKind: 'list', config: {} }] }, code: 'INVALID_METADATA', status: 422 },
    { label: 'a `viewItems:` entry its schema refuses', extra: { viewItems: [{ name: 'probe_a.bad' }] }, code: 'INVALID_METADATA', status: 422 },
    { label: 'a `viewItems:` entry wearing another package\'s `_packageId`', extra: { viewItems: [{ name: 'probe_a.hot', object: 'probe_a', viewKind: 'list', config: { type: 'grid', columns: [{ field: 'title' }] }, _packageId: HOST }] }, code: 'VALIDATION_ERROR', status: 400 },
    { label: 'a seed dataset wearing another package\'s `_packageId`', extra: { data: [{ object: 'probe_a', records: [], _packageId: HOST }] }, code: 'VALIDATION_ERROR', status: 400 },
    { label: 'a nested plugin\'s page wearing another package\'s `_packageId`', extra: { plugins: [{ name: 'probe_inner', namespace: 'probeinner', objects: [object('probe_inner_thing')], pages: [{ name: 'probe_inner_page', type: 'app', _packageId: HOST }] }] }, code: 'VALIDATION_ERROR', status: 400 },
];

describe('[#28697] a body-only refusal leaves nothing of the package behind', () => {
    for (const c of BODY_ONLY) {
        it(c.label, () => {
            const engine = new ObjectQL();
            const err = refusal(() => engine.registerApp(body(c.extra) as any));
            expect(err).toMatchObject({ code: c.code, status: c.status });
            expectNothingOf(engine);
        });
    }
});

describe('[#28697] a body-only refusal of a re-register leaves the installed version serving', () => {
    const v1 = () => ({
        id: PKG,
        name: PKG,
        version: '1.0.0',
        objects: [object('probe_a'), object('probe_old')],
        apps: [app('probe_app')],
        pages: [{ name: 'probe_v1_page', type: 'app' }],
    });
    for (const c of BODY_ONLY) {
        it(c.label, () => {
            const engine = new ObjectQL();
            engine.registerApp(v1() as any);
            const before = trace(engine);
            const v2 = body({
                version: '2.0.0',
                objects: [object('probe_a', { label: 'v2 label' }), object('probe_new')],
                apps: [app('probe_app_v2')],
                ...c.extra,
            });
            const err = refusal(() => engine.registerApp(v2 as any));
            expect(err).toMatchObject({ code: c.code, status: c.status });
            expect(trace(engine)).toEqual(before);
            expect(engine.registry.getPackage(PKG)?.manifest.version).toBe('1.0.0');
            expect((engine.registry.getObject('probe_a') as any)?.label).toBe('probe_a');
            expect(trace(engine).items).toEqual(['page/probe_v1_page']);
        });
    }
});

// ── refusals only the registry can raise, part-way ─────────────────────────

describe('[#28697] a registry refusal part-way through a first registration withdraws it', () => {
    it('a field with no `type` on a later object', () => {
        const engine = new ObjectQL();
        const err = refusal(() => engine.registerApp(body({ objects: [object('probe_a'), { name: 'probe_b', fields: { t: { label: 'No type' } } }] }) as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expectNothingOf(engine);
    });

    it('an object another package owns, which keeps it', () => {
        const engine = new ObjectQL();
        engine.registerApp({ id: HOST, name: HOST, objects: [object('probe_held', { label: 'Host held' })] } as any);
        const err = refusal(() => engine.registerApp(body({ objects: [object('probe_a'), object('probe_held')] }) as any));
        expect(err).toMatchObject({ code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422 });
        expect({ ...trace(engine), objects: trace(engine).objects.filter((n) => n !== 'probe_held') }).toEqual({
            pkg: undefined, objects: [], apps: [], items: [], nav: [], kinds: [], datasources: [], innerNamespace: undefined,
        });
        expect(engine.registry.getObjectOwner('probe_held')?.packageId).toBe(HOST);
        expect((engine.registry.getObject('probe_held') as any)?.label).toBe('Host held');
    });

    const INDUSTRY = { name: 'probe_industry', label: 'Industry', options: [{ label: 'Finance', value: 'finance' }] };
    const repeated = { extend: 'probe_industry', options: [{ label: 'Fintech', value: 'finance' }] };

    it('a picklist value another package\'s list already carries, which keeps its list', () => {
        const engine = new ObjectQL();
        engine.registerApp({ id: HOST, name: HOST, picklists: [INDUSTRY] } as any);
        const err = refusal(() => engine.registerApp(body({ picklists: [{ name: 'probe_list', label: 'L', options: [{ label: 'X', value: 'x' }] }], picklistExtensions: [repeated] }) as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expectNothingOf(engine);
        expect(engine.registry.resolvePicklistOptions('probe_list')).toBeUndefined();
        expect(engine.registry.resolvePicklistOptions('probe_industry')).toEqual([{ label: 'Finance', value: 'finance' }]);
    });

    it('the same refusal from a nested plugin, after the parent body registered', () => {
        const engine = new ObjectQL();
        engine.registerApp({ id: HOST, name: HOST, picklists: [INDUSTRY] } as any);
        const err = refusal(() => engine.registerApp(body({
            plugins: [{ name: 'probe_inner', namespace: 'probeinner', objects: [object('probe_inner_thing')], picklistExtensions: [repeated] }],
        }) as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expectNothingOf(engine);
    });

    it('keeps the boot seed of disabled packages, so the next install still lands disabled', () => {
        const engine = new ObjectQL();
        engine.registry.setInitialDisabledPackageIds([PKG]);
        refusal(() => engine.registerApp(body({ objects: [object('probe_a'), { name: 'probe_b', fields: { t: { label: 'No type' } } }] }) as any));
        expectNothingOf(engine);
        engine.registerApp(body() as any);
        expect(engine.registry.getPackage(PKG)).toMatchObject({ enabled: false, status: 'disabled' });
    });
});

// ── controls ───────────────────────────────────────────────────────────────

describe('[#28697] controls', () => {
    it('a clean body registers into every registry as before', () => {
        const engine = new ObjectQL();
        engine.registerApp(body({ pages: [{ name: 'probe_page', type: 'app' }] }) as any);
        const t = trace(engine);
        expect(t.pkg).toBeDefined();
        expect(t.objects).toEqual(['probe_a', 'probe_inner_thing']);
        expect(t.apps).toEqual(['probe_app']);
        expect(t.items).toEqual(['page/probe_page']);
        expect(t.nav).toEqual([PKG]);
        expect(t.kinds).toEqual(['probe.kind']);
        expect(t.datasources).toEqual(['probe_ds']);
        expect(t.innerNamespace).toBe(PKG);
    });

    it('a body that took over a tenant\'s object leaves nothing of itself: the tenant\'s object serves as before', () => {
        const engine = new ObjectQL();
        engine.registry.registerObject({ ...object('probe_a', { label: 'Tenant label' }), _provenance: 'org' } as any, 'sys_metadata', undefined, 'own');
        const err = refusal(() => engine.registerApp(body({ objects: [object('probe_a'), { name: 'probe_b', fields: { t: { label: 'No type' } } }] }) as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(engine.registry.getObjectContributors('probe_a').map((c) => `${c.ownership}:${c.packageId}`))
            .toEqual(['own:sys_metadata']);
        expect((engine.registry.getObject('probe_a') as any)?.label).toBe('Tenant label');
        expect({ ...trace(engine), objects: trace(engine).objects.filter((n) => n !== 'probe_a') }).toEqual({
            pkg: undefined, objects: [], apps: [], items: [], nav: [], kinds: [], datasources: [], innerNamespace: undefined,
        });
    });

    it('an installed id refused part-way by the registry is not withdrawn: the installed version keeps serving', () => {
        const engine = new ObjectQL();
        engine.registerApp({ id: HOST, name: HOST, objects: [object('probe_held')] } as any);
        engine.registerApp({ id: PKG, name: PKG, version: '1.0.0', objects: [object('probe_a'), object('probe_old')], apps: [app('probe_app')] } as any);
        const before = trace(engine);
        const err = refusal(() => engine.registerApp(body({
            version: '2.0.0',
            objects: [object('probe_a', { label: 'v2 label' }), object('probe_held')],
        }) as any));
        expect(err).toMatchObject({ code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422 });
        // Not withdrawn (the withdrawal would take v1 with it), and nothing of
        // v2 stays: the registry puts back what the refused upgrade wrote.
        expect(trace(engine)).toEqual(before);
        expect(engine.registry.getPackage(PKG)?.manifest.version).toBe('1.0.0');
        expect((engine.registry.getObject('probe_a') as any)?.label).toBe('probe_a');
        expect(trace(engine).objects).toEqual(['probe_a', 'probe_held', 'probe_old']);
        expect(engine.registry.getObjectOwner('probe_held')?.packageId).toBe(HOST);
    });
});
