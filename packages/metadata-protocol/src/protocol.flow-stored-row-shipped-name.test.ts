// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20913, #20761 ruling rule 1, ADR-0126 §2 / §3] A stored flow row under a
 * name the loader's set holds is its own row: never grafted with the package's
 * provenance, never merged into the package's slot of the flattened view.
 *
 * `flow` is Regime C — the packaged base is locked, "⛔ Never silent override,
 * never an overlay read path". Two seams used to disagree with that:
 *
 *  - the HYDRATION grafted the artifact's envelope onto a stored row of a
 *    shipped flow name, so the registry held two entries that both read as the
 *    package's own, and the automation boot pull could neither tell them apart
 *    nor report the stored one as what it is;
 *  - the FLATTENED VIEW (`getMetaItemsForExecution` / `getMetaItems`) let the
 *    stored row stand in for the package's slot and stamped it with the
 *    package's id, so the automation engine's `kernel:ready` sync armed the
 *    stored body over the loader's.
 *
 * Both are pinned here with a registry double that keeps the real
 * `SchemaRegistry`'s key shape (`<package>:<name>` for a loader entry, the bare
 * name for a hydrated row) and its artifact lookup (package-scoped entries
 * first, the per-entry `isCodeArtifactBody` test). `@objectstack/objectql`
 * cannot be imported here: it depends on this package. The cold-boot proof over
 * the real composition is `flow-shipped-name-stored-row-boot.dogfood.test.ts`.
 *
 * Controls: a flow name no managed package ships keeps its stored row (the
 * tenant's own flow), and a type in the overlay regime keeps its overlay.
 */
import { describe, expect, it } from 'vitest';
import { isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { storedRowBindingOf } from './stored-row-binding.js';

const PACKAGE_ID = 'com.example.pkg';
const SHIPPED = 'pkg_flow';
const CUSTOMER = 'customer_flow';

const flowBody = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
    name,
    label,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...extra,
});

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

const storedRow = (type: string, name: string, body: unknown, extra: Partial<StoredRow> = {}): StoredRow => ({
    id: `r_${type}_${name}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify(body),
    ...extra,
});

/**
 * A registry double with the real `SchemaRegistry`'s two key shapes and its
 * artifact lookup. `registerItem` stamps a package entry the way
 * `applyProtection` does and leaves a bare registration's provenance alone.
 */
function registryDouble() {
    const byType = new Map<string, Map<string, Record<string, unknown>>>();
    const collection = (type: string) => {
        if (!byType.has(type)) byType.set(type, new Map());
        return byType.get(type)!;
    };
    return {
        registerItem(type: string, item: Record<string, unknown>, keyField = 'name', packageId?: string) {
            const name = String(item[keyField]);
            if (packageId) {
                if (item._packageId === undefined) item._packageId = packageId;
                if (item._provenance === undefined) item._provenance = 'package';
                collection(type).set(`${packageId}:${name}`, item);
            } else {
                collection(type).set(name, item);
            }
        },
        listItems(type: string, packageId?: string) {
            const all = [...(byType.get(type)?.values() ?? [])];
            return packageId ? all.filter((it) => it._packageId === packageId) : all;
        },
        getArtifactItem(type: string, name: string, packageId?: string) {
            const entries = [...(byType.get(type)?.entries() ?? [])];
            const scoped = entries.filter(([key, it]) => key.endsWith(`:${name}`) && isCodeArtifactBody(it));
            const local = packageId ? scoped.find(([, it]) => it._packageId === packageId) : undefined;
            if (local) return local[1];
            if (scoped[0]) return scoped[0][1];
            const bare = byType.get(type)?.get(name);
            return bare && isCodeArtifactBody(bare) ? bare : undefined;
        },
        bare(type: string, name: string) {
            return byType.get(type)?.get(name);
        },
        getItem: () => undefined,
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
}

/**
 * The engine double: `find` over `sys_metadata` rows, plus the registry.
 * ⛔ No `findOne` / `insert` / `update` / `delete` — the read path under test
 * issues one verb (the shape `get-meta-items-org-read-gate.test.ts` drives).
 */
function harness(rows: StoredRow[]) {
    const registry = registryDouble();
    // What the loader registered: one packaged flow and one packaged view.
    registry.registerItem('flow', flowBody(SHIPPED, 'LOADER'), 'name', PACKAGE_ID);
    registry.registerItem('view', { name: 'pkg_view', label: 'LOADER VIEW' }, 'name', PACKAGE_ID);
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const where = opts?.where ?? {};
            for (const k of Object.keys(where)) {
                if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
            }
            const matched = rows.filter((r) =>
                Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
            );
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        registry,
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, registry };
}

const itemsOf = (res: any): Array<Record<string, unknown>> => (Array.isArray(res) ? res : res.items);
const named = (res: any, name: string) => itemsOf(res).filter((it) => it.name === name);

describe('[#20913] hydration registers a stored flow row as the tenant row it is', () => {
    it('a stored row of a shipped flow name is not grafted with the package\'s provenance', async () => {
        const { protocol, registry } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);
        await protocol.getMetaItemsForExecution({ type: 'flow' });

        const hydrated = registry.bare('flow', SHIPPED)!;
        expect(hydrated.label).toBe('STORED');
        expect(hydrated._provenance).toBe('org');
        expect(hydrated._packageId).toBeUndefined();
        expect(isCodeArtifactBody(hydrated)).toBe(false);
        // The loader's set still answers from the loader's entry alone.
        expect(protocol.packagedArtifactOwner({ type: 'flow', name: SHIPPED })).toBe(PACKAGE_ID);
    });

    it('control: an overlay of a packaged type in the overlay regime keeps the artifact\'s envelope', async () => {
        const { protocol, registry } = harness([storedRow('view', 'pkg_view', { name: 'pkg_view', label: 'OVERLAY VIEW' })]);
        await protocol.getMetaItems({ type: 'view' });

        const hydrated = registry.bare('view', 'pkg_view')!;
        expect(hydrated.label).toBe('OVERLAY VIEW');
        expect(hydrated._packageId).toBe(PACKAGE_ID);
        expect(hydrated._provenance).toBe('package');
    });
});

describe('[#20913] the flattened flow view serves a shipped name from the loader\'s entry alone', () => {
    it('the execution view serves the loader\'s body for a shipped name that has an environment-wide stored row', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const served = named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED);

        expect(served).toHaveLength(1);
        expect(served[0].label).toBe('LOADER');
        expect(served[0]._packageId).toBe(PACKAGE_ID);
    });

    it('it does so on every read — the registry\'s hydrated copy of the row does not stand in either', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);
        await protocol.getMetaItemsForExecution({ type: 'flow' }); // hydrates the row
        const second = named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED);
        expect(second.map((it) => it.label)).toEqual(['LOADER']);
    });

    it('the served list agrees with the execution view', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);
        const served = named(await protocol.getMetaItems({ type: 'flow' }), SHIPPED);
        expect(served.map((it) => it.label)).toEqual(['LOADER']);
    });

    it('a row bound to the shipping package, or one whose own body claims its provenance, is judged by name alone', async () => {
        for (const row of [
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'), { package_id: PACKAGE_ID }),
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED', { _packageId: PACKAGE_ID, _provenance: 'package' })),
        ]) {
            const { protocol } = harness([row]);
            const served = named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED);
            expect(served.map((it) => it.label)).toEqual(['LOADER']);
        }
    });

    it('control: a flow name no managed package ships serves its stored row, unchanged', async () => {
        const { protocol } = harness([storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'CUSTOMER'))]);
        const served = named(await protocol.getMetaItemsForExecution({ type: 'flow' }), CUSTOMER);
        expect(served.map((it) => it.label)).toEqual(['CUSTOMER']);
        expect(isCodeArtifactBody(served[0])).toBe(false);
    });

    it('control: a shipped name with no stored row serves the loader\'s body, unchanged', async () => {
        const { protocol } = harness([]);
        const served = named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED);
        expect(served.map((it) => it.label)).toEqual(['LOADER']);
    });

    it('control: an overlay of a packaged type in the overlay regime is still served over the artifact', async () => {
        const { protocol } = harness([storedRow('view', 'pkg_view', { name: 'pkg_view', label: 'OVERLAY VIEW' })]);
        const served = named(await protocol.getMetaItems({ type: 'view' }), 'pkg_view');
        expect(served.map((it) => it.label)).toEqual(['OVERLAY VIEW']);
    });
});

/**
 * [#28412, ADR-0146 D9 item 1] …except ONE stored row: the shipping package's
 * declared override. A row bound — by its own `package_id` column — to the
 * package's paired `<package>.custom`, whose body declares
 * `overrides.package` = the package, is the packaged flow now: the flow view
 * (both faces), the by-name read, the layered read and the per-package
 * customization read serve it over the loader's body, under the package's
 * provenance, once per name. The predicate is the one served-override
 * predicate (`isServedOverrideRowOf`); every other stored row of the name —
 * a dependent's declaration, a package-less row whose body names the pair, an
 * undeclared pair row — stays declined, as above.
 */
describe('[#28412] the flow view admits exactly the shipping package\'s declared .custom override', () => {
    const PAIR = `${PACKAGE_ID}.custom`;
    const DECLARED = { overrides: { package: PACKAGE_ID, basedOn: '1.0.0' } };
    const overrideRow = (extra: Partial<StoredRow> = {}, body: Record<string, unknown> = DECLARED) =>
        storedRow('flow', SHIPPED, flowBody(SHIPPED, 'OVERRIDE', body), { package_id: PAIR, ...extra });

    it('the execution view serves the declared override once, in the package\'s slot, under its provenance', async () => {
        const { protocol } = harness([overrideRow()]);
        const served = named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED);
        expect(served.map((it) => it.label)).toEqual(['OVERRIDE']);
        expect(served[0]._packageId).toBe(PACKAGE_ID);
        expect(served[0].overrides).toEqual(DECLARED.overrides);
    });

    it('…on every read: the registry\'s hydrated copy does not add a second entry', async () => {
        const { protocol } = harness([overrideRow()]);
        await protocol.getMetaItemsForExecution({ type: 'flow' });
        const second = named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED);
        expect(second.map((it) => it.label)).toEqual(['OVERRIDE']);
    });

    it('the served list agrees with the execution view', async () => {
        // The by-name and layered reads' agreement is pinned over the real
        // engine (`protocol-flow-custom-override.test.ts`, packages/objectql):
        // this double answers no `findOne` and no by-name registry read.
        const { protocol } = harness([overrideRow()]);
        expect(named(await protocol.getMetaItems({ type: 'flow' }), SHIPPED).map((it) => it.label)).toEqual(['OVERRIDE']);
    });

    it('the per-package customization read lists the flow override of the package', async () => {
        const { protocol } = harness([overrideRow()]);
        expect(await (protocol as any).listServedOverrides({ packageId: PACKAGE_ID }))
            .toEqual([{ type: 'flow', name: SHIPPED, basedOn: '1.0.0' }]);
    });

    it('the hydration records the row\'s own package_id on the registry body, never the body\'s stamp', async () => {
        const { protocol, registry } = harness([overrideRow({}, { ...DECLARED, _packageId: PACKAGE_ID })]);
        await protocol.getMetaItemsForExecution({ type: 'flow' });
        const hydrated = registry.bare('flow', SHIPPED)!;
        expect(storedRowBindingOf(hydrated)).toBe(PAIR);
        expect(hydrated._packageId).toBe(PACKAGE_ID); // the body's own stamp, kept and never read for the binding
        expect(JSON.parse(JSON.stringify(hydrated))).not.toHaveProperty('storedRowBinding');

        const packageless = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STAMPED', { ...DECLARED, _packageId: PAIR }))]);
        await packageless.protocol.getMetaItemsForExecution({ type: 'flow' });
        expect(storedRowBindingOf(packageless.registry.bare('flow', SHIPPED))).toBeNull();
    });

    for (const [label, row] of [
        ['a dependent package\'s declaration', overrideRow({ package_id: 'com.example.partner' })],
        ['a package-less row whose body stamps the pair', storedRow('flow', SHIPPED,
            flowBody(SHIPPED, 'OVERRIDE', { ...DECLARED, _packageId: PAIR }))],
        ['an undeclared row of the pair', overrideRow({}, {})],
        ['another base\'s pair declaring this package', overrideRow({ package_id: 'com.other.custom' })],
    ] as const) {
        it(`${label} is not admitted: the loader's body is served, and nothing is listed as an override`, async () => {
            const { protocol } = harness([row]);
            expect(named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED).map((it) => it.label))
                .toEqual(['LOADER']);
            expect(named(await protocol.getMetaItems({ type: 'flow' }), SHIPPED).map((it) => it.label)).toEqual(['LOADER']);
            expect(await (protocol as any).listServedOverrides({ packageId: PACKAGE_ID })).toEqual([]);
        });
    }

    it('deleting the override serves the loader\'s body again on the next read', async () => {
        const rows = [overrideRow()];
        const { protocol } = harness(rows);
        expect(named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED).map((it) => it.label)).toEqual(['OVERRIDE']);
        rows.splice(0, 1);
        expect(named(await protocol.getMetaItemsForExecution({ type: 'flow' }), SHIPPED).map((it) => it.label)).toEqual(['LOADER']);
    });
});
