// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28697] A refused upgrade leaves the installed version serving, whole.
 *
 * ## What this file pins
 *
 * An installed `1.0.0` of a package (a v1-only object, a shared object, an
 * object a tenant has overlaid, an object another package extends, an app, a
 * page, a picklist, a datasource) is re-registered as a `2.0.0` that the
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
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

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
    objects: [object('probeup_a'), object('probeup_shared', { label: 'v1 shared' }), object('probeup_old')],
    apps: [app('probeup_app', 'probeup_a')],
    pages: [{ name: 'probeup_v1_page', type: 'app' }],
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
        pages: [{ name: 'probeup_v2_page', type: 'app' }],
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
        defaultPages: ['probeup_a', 'probeup_held'].map((o) => registry.defaultRecordPageHoldersOf(o)),
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
        label: 'a picklist repeating a value an extension already adds to it',
        fault: { picklistExtensions: [{ extend: 'probeup_list', options: [{ label: 'X', value: 'x' }] }], picklists: [{ name: 'probeup_list', label: 'L', options: [{ label: 'X again', value: 'x' }] }] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'a picklist extension repeating a value another package\'s list carries',
        fault: { picklistExtensions: [{ extend: 'probeup_industry', options: [{ label: 'Fintech', value: 'finance' }] }] },
        code: 'INVALID_METADATA', status: 422,
    },
    {
        label: 'the same from a nested plugin, after the body registered',
        fault: { plugins: [{ name: 'probeup_inner', namespace: 'probeupinner', objects: [object('probeup_inner_thing')], picklistExtensions: [{ extend: 'probeup_industry', options: [{ label: 'Fintech', value: 'finance' }] }] }] },
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
