// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33904, ADR-0150 D4, ADR-0146 D8] The merged action list keys a
 * package-less action by `(object, name)`: a package-less action bound to an
 * object no package binds the name to is the environment's own item (or the
 * platform's), listed beside the package's item, as the by-name read naming
 * no package serves it beside one package holder (`judgeBareActionRead`).
 *
 * BASE (main 895783a1e): the list slots an action by name alone, so such a
 * row stood in for the package's slot. Beside the package's code item alone
 * it was served AS the package's item (its body, the package's `_packageId`
 * and `_provenance: 'package'`), and the package's own item on its object
 * left the list; beside the package's own stored row it lost to that row and
 * left the list itself. A list scoped to the package served it in the
 * package's slot.
 *
 * Driven over the protocol's own list read with a registry double that keys
 * an action as the real one does: a package's item per package, a
 * package-less item per object.
 */
import './lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { NO_PACKAGE_SCOPED_READS } from './no-package-scoped-reads.testkit.js';

const A = 'com.acme.alpha';
const NAME = 'approve';

interface StoredRow { id: string; type: string; name: string; package_id: string | null; state: string; metadata: string }

const actionBody = (label: string, objectName: string | undefined) => ({
    name: NAME, label, type: 'url', target: 'https://example.com', ...(objectName !== undefined ? { objectName } : {}),
});

/** A's code item on `objectName`, as the registry lists it. */
const shipped = (objectName: string | undefined) => ({ ...actionBody('alpha', objectName), _packageId: A, _provenance: 'package' });
/** The registry's package-less entry the boot hydrates from a stored row (or a plugin registers). */
const packageless = (label: string, objectName: string | undefined) => ({ ...actionBody(label, objectName), _provenance: 'org' });

const row = (id: string, packageId: string | null, label: string, objectName: string | undefined, state = 'active'): StoredRow => ({
    id, type: 'action', name: NAME, package_id: packageId, state, metadata: JSON.stringify(actionBody(label, objectName)),
});

const whereMatches = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        if (v !== null && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) return (v as { $in: unknown[] }).$in.includes(r[k]);
        return v === undefined || (r[k] ?? null) === v;
    });

/**
 * The protocol over a registry holding `items` (in registration order) and a
 * store holding `rows`; `service` is a MetadataService listing, when given.
 */
function harness(items: Array<Record<string, unknown>>, rows: StoredRow[], service?: Array<Record<string, unknown>>) {
    const ofPackage = (packageId?: string) => items.filter((i) => packageId === undefined || i._packageId === packageId);
    const registry = {
        ...NO_PACKAGE_SCOPED_READS,
        getArtifactItem: (type: string, name: string, packageId?: string) => (type === 'action'
            ? items.find((i) => i.name === name && i._packageId !== undefined && (packageId === undefined || i._packageId === packageId))
            : undefined),
        getItem: (type: string, name: string, packageId?: string) => (type === 'action'
            ? (packageId === undefined
                ? items.find((i) => i.name === name && i._packageId === undefined) ?? items.find((i) => i.name === name)
                : items.find((i) => i.name === name && i._packageId === packageId))
            : undefined),
        listItems: (type: string, packageId?: string) => (type === 'action' ? ofPackage(packageId) : []),
        packageScopedHoldersOf: (type: string, name: string) => (type === 'action'
            ? [...new Set(items.filter((i) => i.name === name && typeof i._packageId === 'string').map((i) => i._packageId as string))]
            : []),
        getPackageScopedItem: (type: string, name: string, packageId: string) => (type === 'action'
            ? items.find((i) => i.name === name && i._packageId === packageId)
            : undefined),
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        getAllPackages: () => [],
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const hits = rows.filter((r) => whereMatches(r as unknown as Record<string, unknown>, opts?.where ?? {}));
            return opts?.limit === undefined ? hits : hits.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return rows.find((r) => whereMatches(r as unknown as Record<string, unknown>, opts?.where ?? {})) ?? null;
        },
        async insert() {
            return {};
        },
        registry,
    };
    const services = new Map<string, unknown>(service ? [['metadata', { list: async (type: string) => (type === 'action' ? service : []) }]] : []);
    return new ObjectStackProtocolImplementation(engine, () => services as Map<string, any>, 'env_1');
}

/** The listed items of the name: object, label, package, provenance; sorted by object. */
async function listed(protocol: ObjectStackProtocolImplementation, request: { packageId?: string; previewDrafts?: boolean } = {}) {
    const answer: any = await protocol.getMetaItems({ type: 'action', ...request });
    return (answer.items as any[])
        .filter((it) => it?.name === NAME)
        .map((it) => [it.objectName ?? null, it.label, it._packageId ?? null, it._provenance === 'package' ? 'package' : null, it._draft === true ? 'draft' : null])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
}

const both = <T>(x: T, y: T): Array<[string, T[]]> => [['registered as written', [x, y]], ['registered the other way', [y, x]]];

describe('[#33904] the list naming no package lists a package-less action on another object beside the package\'s action', () => {
    for (const [order, registered] of both(shipped('account'), packageless('env', 'contact'))) {
        it(`A on account, the environment's row on contact, the registry holding both (${order}): both listed, the environment's with no package (BASE: one item, the environment's body as A's)`, async () => {
            const protocol = harness(registered, [row('r-env', null, 'env', 'contact')]);
            expect(await listed(protocol)).toEqual([
                ['account', 'alpha', A, 'package', null],
                ['contact', 'env', null, null, null],
            ]);
        });
    }

    for (const [order, stored] of both(row('r-a', A, 'alpha custom', 'account'), row('r-env', null, 'env', 'contact'))) {
        it(`A's own row on account beside the environment's row on contact (${order}): both listed (BASE: A's row alone)`, async () => {
            const protocol = harness([shipped('account')], stored);
            expect(await listed(protocol)).toEqual([
                ['account', 'alpha custom', A, 'package', null],
                ['contact', 'env', null, null, null],
            ]);
        });
    }

    it('the environment\'s row object-less beside A on account: both listed', async () => {
        const protocol = harness([shipped('account')], [row('r-env', null, 'env', undefined)]);
        expect(await listed(protocol)).toEqual([
            ['account', 'alpha', A, 'package', null],
            [null, 'env', null, null, null],
        ]);
    });

    it('the MetadataService listing both copies: both listed once each', async () => {
        const protocol = harness([shipped('account')], [row('r-env', null, 'env', 'contact')],
            [shipped('account'), { ...actionBody('env (service copy)', 'contact') }]);
        expect(await listed(protocol)).toEqual([
            ['account', 'alpha', A, 'package', null],
            ['contact', 'env', null, null, null],
        ]);
    });

    it('the draft preview: the environment\'s draft previews over its own item, A\'s item stays', async () => {
        const protocol = harness([shipped('account')], [row('r-env', null, 'env', 'contact'), row('d-env', null, 'env draft', 'contact', 'draft')]);
        expect(await listed(protocol, { previewDrafts: true })).toEqual([
            ['account', 'alpha', A, 'package', null],
            ['contact', 'env draft', null, null, 'draft'],
        ]);
    });

    it('the list scoped to A lists A\'s own item, never the environment\'s row on another object (BASE: the environment\'s body in A\'s slot)', async () => {
        const protocol = harness([shipped('account'), packageless('env', 'contact')], [row('r-env', null, 'env', 'contact')]);
        expect(await listed(protocol, { packageId: A })).toEqual([['account', 'alpha', A, 'package', null]]);
    });

    it('the list and the by-name read naming no package answer the environment\'s item on contact', async () => {
        const protocol = harness([shipped('account'), packageless('env', 'contact')], [row('r-env', null, 'env', 'contact')]);
        const read: any = await protocol.getMetaItem({ type: 'action', name: NAME });
        expect([read.item?.objectName, read.item?.label]).toEqual(['contact', 'env']);
        expect((await listed(protocol)).filter(([object]) => object === 'contact').map(([, label]) => label)).toEqual(['env']);
    });
});

describe('[#33904] CONTROLS — what the list served before, it serves still', () => {
    for (const [order, registered] of both(shipped('account'), packageless('env', 'account'))) {
        it(`the environment's row on A's own object is A's customization: one item, its body in A's slot (${order})`, async () => {
            const protocol = harness(registered, [row('r-env', null, 'env', 'account')]);
            expect(await listed(protocol)).toEqual([['account', 'env', A, 'package', null]]);
        });
    }

    it('no package holds the name: the environment\'s row is listed as itself', async () => {
        const protocol = harness([packageless('env', 'contact')], [row('r-env', null, 'env', 'contact')]);
        expect(await listed(protocol)).toEqual([['contact', 'env', null, null, null]]);
    });

    it('A on account alone: A\'s item', async () => {
        const protocol = harness([shipped('account')], []);
        expect(await listed(protocol)).toEqual([['account', 'alpha', A, 'package', null]]);
    });
});
