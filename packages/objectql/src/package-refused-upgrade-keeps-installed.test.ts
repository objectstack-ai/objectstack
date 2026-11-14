// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28697] A refused upgrade leaves the installed version serving, whole.
 *
 * ## What this file pins
 *
 * An installed `1.0.0` of a package (a v1-only object, a shared object, an
 * object a tenant has overlaid, an object another package extends, an app, a
 * page, a default record page, a permission set, a picklist, a datasource) is
 * re-registered as a `2.0.0` that the
 * registry refuses part-way, once for each refusal the registry raises after
 * the new package record is written:
 *
 *  - the refusal keeps its code and status;
 *  - the package record, every object (as served and as layered), every item,
 *    picklist options, namespaces, security-catalog names, default record page
 *    holders and datasource definitions read exactly as before;
 *  - the other package's extension and the tenant's overlay still serve.
 *
 * CONTROLS: a clean `2.0.0` upgrades as before (and keeps the extension and
 * the overlay); a refusal the package door raises before its first write leaves
 * v1 as before; the other package's own entries are not touched by a refused
 * upgrade of this one.
 *
 * [#33050] A clean upgrade REPLACES what the body ships: the 1.0.0-only page,
 * app and permission set (item and claim) are withdrawn; the same body
 * registered again keeps everything; an environment overlay of a dropped item
 * and an item registered under the id outside the body are kept; a refusal
 * later in the same run puts every withdrawn item and claim back, in place;
 * and a dropped bare name is free at once while one still shipped stays held.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { BareNameConflictError } from './registry.js';

const PKG = 'com.probe.upgrade';
const HOST = 'com.probe.host';
const EXT = 'com.probe.extender';
const NS = 'probeup';

const field = (label: string) => ({ type: 'text', label });
const object = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    fields: { title: field('Title') },
    ...extra,
});
const app = (name: string, objectName: string) => ({
    name,
    label: name,
    navigation: [{ id: `nav_${objectName}`, type: 'object', label: objectName, objectName }],
});

const V1 = () => ({
    id: PKG,
    name: PKG,
    namespace: NS,
    version: '1.0.0',
    objects: [
        object('probeup_a'),
        object('probeup_shared', { label: 'v1 shared' }),
        object('probeup_old', { fields: { title: field('Title'), tier: { type: 'select', label: 'Tier', picklist: 'probeup_tier' } } }),
    ],
    apps: [app('probeup_app', 'probeup_a')],
    pages: [{ name: 'probeup_v1_page', type: 'app' }, { name: 'probeup_v1_record', type: 'record', object: 'probeup_a', isDefault: true }],
    permissions: [{ name: 'probeup_v1_ps', objects: {} }],
    picklists: [{ name: 'probeup_tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }] }],
    datasources: [{ name: 'probeup_ds_v1', driver: 'memory' }],
});

/** A `2.0.0` that rewrites, adds and drops, with `fault` appended where the registry refuses it. */
const V2 = (fault: Record<string, unknown> = {}) => {
    const { objects: faultObjects = [], ...rest } = fault as { objects?: unknown[] };
    return {
        id: PKG,
        name: PKG,
        namespace: NS,
        version: '2.0.0',
        objects: [
            object('probeup_a', { label: 'v2 a' }),
            object('probeup_shared', { label: 'v2 shared' }),
            object('probeup_new'),
            ...faultObjects,
        ],
        apps: [app('probeup_app_v2', 'probeup_new')],
        pages: [{ name: 'probeup_v2_page', type: 'app' }, { name: 'probeup_v2_record', type: 'record', object: 'probeup_new', isDefault: true }],
        permissions: [{ name: 'probeup_v2_ps', objects: {} }],
        picklists: [{ name: 'probeup_tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }, { label: 'Platinum', value: 'platinum' }] }],
        picklistExtensions: [{ extend: 'probeup_industry', options: [{ label: 'Retail', value: 'retail' }] }],
        datasources: [{ name: 'probeup_ds_v2', driver: 'memory' }],
        ...rest,
    };
};

const INDUSTRY = { name: 'probeup_industry', label: 'Industry', options: [{ label: 'Finance', value: 'finance' }] };
const RECORD_AMOUNT = {
    title: field('Title'),
    currency_code: { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' },
    amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
};

/** An engine holding HOST, PKG@1.0.0, EXT's extension of a v1 object and a tenant overlay of another. */
function installed(): ObjectQL {
    const engine = new ObjectQL();
    engine.registerApp({
        id: HOST,
        name: HOST,
        objects: [object('probeup_held', { label: 'Host held' })],
        picklists: [INDUSTRY],
        picklistExtensions: [{ extend: 'probeup_tier', options: [{ label: 'Silver', value: 'silver' }] }],
    } as any);
    engine.registerApp(V1() as any);
    engine.registerApp({
        id: EXT,
        name: EXT,
        objectExtensions: [{ extend: 'probeup_old', fields: { ext_note: field('Extender note') } }],
    } as any);
    engine.registry.registerObject(
        { ...object('probeup_a', { label: 'Tenant label' }), _provenance: 'org' } as any,
        'sys_metadata',
        undefined,
        'overlay',
    );
    return engine;
}

/** Everything the engine serves, read through its public verbs. */
function served(engine: ObjectQL) {
    const registry = engine.registry;
    const objects = registry.getAllObjects().map((o: any) => o.name as string).filter((n) => n.startsWith('probeup_')).sort();
    return {
        packages: Object.fromEntries([PKG, HOST, EXT].map((id) => [id, registry.getPackage(id)])),
        objects: Object.fromEntries(objects.map((name) => [name, {
            served: registry.getObject(name),
            layers: registry.getObjectContributors(name).map((c) => ({ packageId: c.packageId, ownership: c.ownership, priority: c.priority, definition: c.definition })),
        }])),
        items: Object.fromEntries(registry.getRegisteredTypes().filter((t) => t !== 'object').sort().map((type) => [type, registry.listItems(type)])),
        picklists: Object.fromEntries(['probeup_tier', 'probeup_industry', 'probeup_list'].map((p) => [p, registry.resolvePicklistOptions(p)])),
        namespaces: Object.fromEntries([NS, 'probeupinner'].map((ns) => [ns, registry.getNamespaceOwners(ns)])),
        catalog: (['permission', 'position', 'capability'] as const).map((type) => registry.securityCatalogNamesHeldBy(PKG, type as any)),
        defaultPages: ['probeup_a', 'probeup_new', 'probeup_held'].map((o) => registry.defaultRecordPageHoldersOf(o)),
        datasources: engine.listDatasourceDefs().map((d) => d.name).filter((n) => n.startsWith('probeup_')).sort(),
    };
}

function refusal(fn: () => void): any {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected the upgrade to be refused');
}

// ── refusals the registry raises after the 2.0.0 record is written ─────────

const PART_WAY: Array<{ label: string; fault: Record<string, unknown>; code: string; status: number }> = [
    {
        label: 'an object field with no `type`',
        fault: { objects: [{ name: 'probeup_bad', fields: { t: { label: 'No type' } } }] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'an object declaring its own `queue` field',
        fault: { objects: [object('probeup_queued', { fields: { title: field('Title'), queue: field('Queue') } })] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'an object action its schema refuses',
        fault: { objects: [object('probeup_acted', { actions: [{ name: 'probeup_go', type: 'nonsense' }] })] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'a roll-up of a record-currency amount in an object registered just before it',
        fault: {
            objects: [
                object('probeup_line', { fields: RECORD_AMOUNT }),
                object('probeup_rollup', { fields: { title: field('Title'), total: { type: 'summary', label: 'Total', summaryOperations: { object: 'probeup_line', field: 'amount', function: 'sum' } } } }),
            ],
        },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'an object another package owns',
        fault: { objects: [object('probeup_held')] },
        code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422,
    },
    {
        label: 'an extension field with no `type`',
        fault: { objectExtensions: [{ extend: 'probeup_held', fields: { t: { label: 'No type' } } }] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'a standalone action its schema refuses',
        fault: { actions: [{ name: 'probeup_loose', type: 'nonsense' }] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'a picklist repeating a value another package\'s extension already adds to it',
        fault: { picklists: [{ name: 'probeup_tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }] }] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'a picklist extension repeating a value another package\'s list carries',
        fault: { picklistExtensions: [{ extend: 'probeup_industry', options: [{ label: 'Fintech', value: 'finance' }] }] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        // After the body registered whole (its picklist and its extension of
        // the host's list included), and after a nested object whose
        // record-currency amount makes the registry resolve every object.
        label: 'the same from a nested plugin, after the body registered',
        fault: {
            plugins: [{
                name: 'probeup_inner',
                namespace: 'probeupinner',
                objects: [object('probeup_inner_line', { fields: RECORD_AMOUNT })],
                picklistExtensions: [{ extend: 'probeup_industry', options: [{ label: 'Fintech', value: 'finance' }] }],
            }],
        },
        code: 'INVALID_METADATA', status: 422,
    },
];

describe('[#28697] an upgrade the registry refuses part-way leaves the installed version serving', () => {
    for (const c of PART_WAY) {
        it(c.label, () => {
            const engine = installed();
            const before = served(engine);
            const err = refusal(() => engine.registerApp(V2(c.fault) as any));
            expect(err).toMatchObject({ code: c.code, status: c.status });
            expect(served(engine)).toEqual(before);
            expect(engine.registry.getPackage(PKG)?.manifest.version).toBe('1.0.0');
            expect((engine.registry.getObject('probeup_shared') as any)?.label).toBe('v1 shared');
            expect((engine.registry.getObject('probeup_a') as any)?.label).toBe('Tenant label');
            expect(Object.keys((engine.registry.getObject('probeup_old') as any)?.fields ?? {})).toContain('ext_note');
            expect(engine.registry.getObject('probeup_new')).toBeUndefined();
            expect(engine.registry.resolvePicklistOptions('probeup_industry')?.map((o) => o.value)).toEqual(['finance']);
            expect(((engine.registry.getObject('probeup_old') as any)?.fields?.tier?.options ?? []).map((o: any) => o.value)).toEqual(['gold', 'silver']);
        });
    }
});

// ── controls ───────────────────────────────────────────────────────────────

describe('[#28697] refused-upgrade controls', () => {
    it('a clean 2.0.0 upgrades as before, keeping the extension and the overlay', () => {
        const engine = installed();
        engine.registerApp(V2() as any);
        const registry = engine.registry;
        expect(registry.getPackage(PKG)?.manifest.version).toBe('2.0.0');
        expect((registry.getObject('probeup_shared') as any)?.label).toBe('v2 shared');
        expect(registry.getObject('probeup_new')).toBeDefined();
        expect((registry.getObject('probeup_a') as any)?.label).toBe('Tenant label');
        expect(Object.keys((registry.getObject('probeup_old') as any)?.fields ?? {})).toContain('ext_note');
        expect(registry.listItems('app').map((a: any) => a.name)).toContain('probeup_app_v2');
        expect(engine.listDatasourceDefs().map((d) => d.name)).toContain('probeup_ds_v2');
        expect(registry.resolvePicklistOptions('probeup_industry')?.map((o) => o.value)).toEqual(['finance', 'retail']);
        expect(((registry.getObject('probeup_old') as any)?.fields?.tier?.options ?? []).map((o: any) => o.value)).toEqual(['gold', 'platinum', 'silver']);
        // [#33050] FROM `['probeup_v1_ps', 'probeup_v2_ps']` TO the 2.0.0 set alone:
        // the permission set 2.0.0 no longer ships is withdrawn with its claim.
        expect(registry.securityCatalogNamesHeldBy(PKG, 'permission' as any)).toEqual(['probeup_v2_ps']);
        expect(registry.defaultRecordPageHoldersOf('probeup_new').map((h: any) => h.page)).toEqual(['probeup_v2_record']);
    });

    it('a refusal the package door raises before its first write leaves v1 as before', () => {
        const engine = installed();
        const before = served(engine);
        const err = refusal(() => engine.registerApp({ ...V2(), pages: [{ name: 'probeup_misplaced', type: 'app', isDefault: true }] } as any));
        expect(err).toMatchObject({ status: 422 });
        expect(served(engine)).toEqual(before);
    });

    it('a refused upgrade does not move the other package\'s entries', () => {
        const engine = installed();
        const hostBefore = { pkg: engine.registry.getPackage(HOST), held: engine.registry.getObjectContributors('probeup_held'), industry: engine.registry.resolvePicklistOptions('probeup_industry') };
        refusal(() => engine.registerApp(V2({ objects: [object('probeup_held')] }) as any));
        expect({ pkg: engine.registry.getPackage(HOST), held: engine.registry.getObjectContributors('probeup_held'), industry: engine.registry.resolvePicklistOptions('probeup_industry') }).toEqual(hostBefore);
        expect(engine.registry.getObjectOwner('probeup_held')?.packageId).toBe(HOST);
    });
});

// ── [#33050] what the new version no longer ships ─────────────────────────

describe('[#33050] a re-registration withdraws the items the previous body shipped and the new one does not', () => {
    const itemNames = (engine: ObjectQL, type: string, packageId: string) =>
        engine.registry.listItems<any>(type, packageId).map((i) => i.name).sort();

    it('a clean 2.0.0 withdraws the 1.0.0-only page, app and permission set, and serves what it ships', () => {
        const engine = installed();
        expect(itemNames(engine, 'page', PKG)).toEqual(['probeup_v1_page', 'probeup_v1_record']);

        engine.registerApp(V2() as any);

        expect(itemNames(engine, 'page', PKG)).toEqual(['probeup_v2_page', 'probeup_v2_record']);
        expect(itemNames(engine, 'app', PKG)).toEqual(['probeup_app_v2']);
        expect(itemNames(engine, 'permission', PKG)).toEqual(['probeup_v2_ps']);
        expect(engine.registry.getItem('page', 'probeup_v1_page')).toBeUndefined();
        expect(engine.registry.getItem('app', 'probeup_app')).toBeUndefined();
        expect(engine.registry.securityCatalogNamesHeldBy(PKG, 'permission' as any)).toEqual(['probeup_v2_ps']);
        // The other package's items are not this package's to withdraw.
        expect(itemNames(engine, 'picklist', HOST)).toEqual(['probeup_industry']);
    });

    it('re-registering the same body keeps every item it ships', () => {
        const engine = installed();
        const shipped = () => {
            // The package record is re-stamped (`installedAt`, `updatedAt`) by every registration.
            const { package: _record, ...items } = served(engine).items;
            return { items, catalog: served(engine).catalog };
        };
        const before = shipped();
        engine.registerApp(V1() as any);
        expect(shipped()).toEqual(before);
    });

    it('keeps an environment overlay of a dropped item and an item registered under the package id outside its body', () => {
        const engine = installed();
        // The bare slot (ADR-0005 overlay, `sys_metadata` hydration) and a
        // registration under the package's id that no body made.
        engine.registry.registerItem('page', { name: 'probeup_v1_page', type: 'app', label: 'Tenant page' } as any);
        engine.registry.registerItem('page', { name: 'probeup_side_page', type: 'app' } as any, 'name' as any, PKG);

        engine.registerApp(V2() as any);

        expect(engine.registry.getItem<any>('page', 'probeup_v1_page')?.label).toBe('Tenant page');
        expect(itemNames(engine, 'page', PKG)).toEqual(['probeup_side_page', 'probeup_v2_page', 'probeup_v2_record']);
    });

    it('a refusal later in the same run puts every withdrawn item and claim back', () => {
        const engine = installed();
        const before = served(engine);
        const err = refusal(() => engine.registry.restoringOnRefusal(() => {
            engine.registerApp(V2() as any);
            expect(engine.registry.getItem('page', 'probeup_v1_page')).toBeUndefined();
            throw Object.assign(new Error('a later member of the artifact is refused'), { code: 'INVALID_METADATA', status: 422 });
        }));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(served(engine)).toEqual(before);
        expect(engine.registry.getItem<any>('page', 'probeup_v1_page')?.name).toBe('probeup_v1_page');
    });

    it('a dropped bare name is free at once once the holders are sealed; one still shipped stays held', () => {
        const engine = new ObjectQL();
        const withConnectors = (version: string, names: string[]) => ({
            id: PKG,
            name: PKG,
            version,
            connectors: names.map((name) => ({ name, label: name, type: 'api', enabled: false })),
        });
        engine.registerApp(withConnectors('1.0.0', ['probeup_dropped_conn', 'probeup_kept_conn']) as any);
        engine.registry.sealBareNameHolders();

        engine.registerApp(withConnectors('2.0.0', ['probeup_kept_conn']) as any);

        const other = (name: string) => ({
            id: HOST,
            name: HOST,
            connectors: [{ name, label: `${name} (host)`, type: 'api', enabled: false }],
        });
        engine.registerApp(other('probeup_dropped_conn') as any);
        expect(engine.registry.getItem<any>('connector', 'probeup_dropped_conn')?._packageId).toBe(HOST);
        const held = refusal(() => engine.registerApp({ ...other('probeup_kept_conn'), id: EXT, name: EXT } as any));
        expect(held).toBeInstanceOf(BareNameConflictError);
        expect(held).toMatchObject({ status: 422, incomingPackageId: EXT, existingHolder: { kind: 'package', packageId: PKG } });
    });
});
