// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28697] A first install that layers over what a tenant or another package
 * already holds, refused part-way by the registry, leaves nothing of itself
 * registered, and what was there before reads exactly as before.
 *
 * ## What this file pins
 *
 * For a first install over an object a tenant owns (with and without its
 * overlay layer), over an overlay with no owner, and over another package's
 * extension of an object nobody owns yet:
 *
 *  - the refusal keeps its code and status;
 *  - no package record, object, app, item, navigation contribution, kind,
 *    datasource definition or namespace of the package remains;
 *  - the object's layers (who holds each, how it is classified, at what
 *    priority, with which body) and the object as served read as before;
 *  - the boot seed of disabled packages is kept.
 *
 * CONTROLS: a clean first install over a tenant's object takes ownership with
 * the tenant's layer as its overlay, as before, and an operator's uninstall of
 * it still removes the package.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

const PKG = 'com.probe.lateinstall';
const HOST = 'com.probe.extender';
const TENANT = 'sys_metadata';

const object = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    fields: { title: { type: 'text', label: 'Title' } },
    ...extra,
});

/** A body that layers over `probe_a` and writes into every registry `registerApp` reaches. */
const body = (extra: Record<string, unknown> = {}) => ({
    id: PKG,
    name: PKG,
    namespace: 'probelate',
    objects: [object('probe_a')],
    apps: [{ name: 'probe_app', label: 'App', navigation: [{ id: 'nav_a', type: 'object', label: 'A', objectName: 'probe_a' }] }],
    pages: [{ name: 'probe_page', type: 'app' }],
    picklists: [{ name: 'probe_list', label: 'L', options: [{ label: 'X', value: 'x' }] }],
    datasources: [{ name: 'probe_ds', driver: 'memory' }],
    navigationContributions: [{ app: 'host_app', items: [{ id: 'probe_nav', type: 'url', label: 'Probe', url: '/probe' }] }],
    contributes: { kinds: [{ id: 'probe.kind' }] },
    plugins: [{ name: 'probe_inner', namespace: 'probeinner', objects: [object('probe_inner_thing')] }],
    ...extra,
});

/** The same body, refused by the registry on a later object (a field with no `type`). */
const refusedBody = () => body({ objects: [object('probe_a'), { name: 'probe_b', fields: { t: { label: 'No type' } } }] });

/** What the engine holds of PKG, read through its public verbs. */
function traceOfPackage(engine: ObjectQL) {
    const registry = engine.registry;
    return {
        pkg: registry.getPackage(PKG),
        ownedObjects: registry.getAllObjects().map((o: any) => o.name).filter((n: string) => n === 'probe_b' || n === 'probe_inner_thing'),
        apps: registry.listItems('app').map((a: any) => a.name),
        items: (['page', 'picklist'] as const)
            .flatMap((type) => registry.listItems(type).filter((i: any) => i?._packageId === PKG).map((i: any) => `${type}/${i.name}`)),
        picklist: registry.resolvePicklistOptions('probe_list'),
        nav: registry.getAppNavContributions('host_app').map((c) => c.packageId),
        kinds: registry.getAllKinds().map((k) => k.id).filter((id) => id === 'probe.kind'),
        datasources: engine.listDatasourceDefs().map((d) => d.name).filter((n) => n === 'probe_ds'),
        namespaces: [registry.getNamespaceOwner('probelate'), registry.getNamespaceOwner('probeinner')],
        contributions: registry.getObjectContributors('probe_a').filter((c) => c.packageId === PKG).length,
    };
}

const NOTHING = {
    pkg: undefined, ownedObjects: [], apps: [], items: [], picklist: undefined, nav: [], kinds: [], datasources: [],
    namespaces: [undefined, undefined], contributions: 0,
};

/** `probe_a`'s layers as the registry holds them, and the object as served. */
function layersOf(engine: ObjectQL) {
    return {
        layers: engine.registry.getObjectContributors('probe_a').map((c) => ({
            packageId: c.packageId, ownership: c.ownership, priority: c.priority, definition: c.definition,
        })),
        served: engine.registry.getObject('probe_a'),
    };
}

function refusal(fn: () => void): any {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected the registration to be refused');
}

const tenantObject = (engine: ObjectQL) =>
    engine.registry.registerObject({ ...object('probe_a', { label: 'Tenant label' }), _provenance: 'org' } as any, TENANT, undefined, 'own');

describe('[#28697] a first install over a tenant\'s or another package\'s layer, refused part-way, leaves nothing of itself', () => {
    it('over an object a tenant owns', () => {
        const engine = new ObjectQL();
        tenantObject(engine);
        const before = layersOf(engine);
        const err = refusal(() => engine.registerApp(refusedBody() as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(traceOfPackage(engine)).toEqual(NOTHING);
        expect(layersOf(engine)).toEqual(before);
        expect(engine.registry.getObjectOwner('probe_a')?.packageId).toBe(TENANT);
        expect((engine.registry.getObject('probe_a') as any)?.label).toBe('Tenant label');
    });

    it('over an object a tenant owns with its overlay layer', () => {
        const engine = new ObjectQL();
        tenantObject(engine);
        engine.registry.registerObject({ name: 'probe_a', label: 'Tenant overlay', _provenance: 'org' } as any, TENANT, undefined, 'overlay');
        const before = layersOf(engine);
        const err = refusal(() => engine.registerApp(refusedBody() as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(traceOfPackage(engine)).toEqual(NOTHING);
        expect(layersOf(engine)).toEqual(before);
        expect(engine.registry.getObjectContributors('probe_a').map((c) => c.ownership).sort()).toEqual(['overlay', 'own']);
    });

    it('over an overlay with no owner', () => {
        const engine = new ObjectQL();
        engine.registry.registerObject({ ...object('probe_a', { label: 'Orphan overlay' }), _provenance: 'org' } as any, TENANT, undefined, 'overlay');
        const before = layersOf(engine);
        const err = refusal(() => engine.registerApp(refusedBody() as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(traceOfPackage(engine)).toEqual(NOTHING);
        expect(layersOf(engine)).toEqual(before);
        expect(engine.registry.getObjectOwner('probe_a')).toBeUndefined();
    });

    it('over another package\'s extension of an object nobody owns yet', () => {
        const engine = new ObjectQL();
        engine.registerApp({ id: HOST, name: HOST, objectExtensions: [{ extend: 'probe_a', fields: { extra: { type: 'text', label: 'Extra' } } }] } as any);
        const before = layersOf(engine);
        const err = refusal(() => engine.registerApp(refusedBody() as any));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(traceOfPackage(engine)).toEqual(NOTHING);
        expect(layersOf(engine)).toEqual(before);
        expect(engine.registry.getObjectContributors('probe_a').map((c) => `${c.ownership}:${c.packageId}`)).toEqual([`extend:${HOST}`]);
        expect(engine.registry.getPackage(HOST)).toBeDefined();
    });

    it('keeps the boot seed of disabled packages, so the next install still lands disabled', () => {
        const engine = new ObjectQL();
        engine.registry.setInitialDisabledPackageIds([PKG]);
        tenantObject(engine);
        refusal(() => engine.registerApp(refusedBody() as any));
        expect(traceOfPackage(engine)).toEqual(NOTHING);
        engine.registerApp(body() as any);
        expect(engine.registry.getPackage(PKG)).toMatchObject({ enabled: false, status: 'disabled' });
    });
});

describe('[#28697] controls', () => {
    it('a clean first install over a tenant\'s object takes ownership, the tenant\'s layer its overlay', () => {
        const engine = new ObjectQL();
        tenantObject(engine);
        engine.registerApp(body() as any);
        expect(engine.registry.getPackage(PKG)).toBeDefined();
        expect(engine.registry.getObjectContributors('probe_a').map((c) => `${c.ownership}:${c.packageId}`).sort())
            .toEqual([`overlay:${TENANT}`, `own:${PKG}`]);
        expect((engine.registry.getObject('probe_a') as any)?.label).toBe('Tenant label');
        expect(traceOfPackage(engine)).toMatchObject({
            apps: ['probe_app'], items: ['page/probe_page', 'picklist/probe_list'], nav: [PKG], kinds: ['probe.kind'],
            datasources: ['probe_ds'], namespaces: [PKG, PKG],
        });
    });

    it('an operator\'s uninstall of that install still removes the package', () => {
        const engine = new ObjectQL();
        tenantObject(engine);
        engine.registerApp(body() as any);
        expect(engine.registry.uninstallPackage(PKG)).toBe(true);
        expect(engine.registry.getPackage(PKG)).toBeUndefined();
        expect(engine.registry.getObjectContributors('probe_a').some((c) => c.packageId === PKG)).toBe(false);
    });
});
