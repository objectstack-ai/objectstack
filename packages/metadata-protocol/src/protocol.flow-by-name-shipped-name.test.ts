// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20946, #20761 ruling rule 1, ADR-0126 §2 / §3] The by-name read of a flow
 * name the loader's set holds serves the loader's body — the body the list
 * serves for that name — and never a stored row of that name under the
 * package's provenance.
 *
 * `flow` is Regime C: the packaged base is locked, "⛔ Never silent override,
 * never an overlay read path". Since #20913 the flattened view (both faces of
 * `getMetaItems`) applies that by name, with two predicates: the stored-row
 * half ({@link ObjectStackProtocolImplementation.isShippedFlowName}) and the
 * registry half (`isStoredFlowEntryOfShippedName`). `getMetaItem` applied
 * neither: it adopted the environment-wide stored row, then grafted the
 * artifact's protection envelope over it, so the two read doors answered two
 * different bodies for one name. It now calls the same two predicates.
 *
 * The registry double keeps the real `SchemaRegistry`'s key shape
 * (`<package>:<name>` for a loader entry, the bare name for a hydrated row), its
 * `getItem` precedence (the bare slot first) and its artifact lookup
 * (package-scoped code-artifact entries first). `@objectstack/objectql` cannot
 * be imported here: it depends on this package. The cold-boot proof over the
 * real composition is `flow-shipped-name-by-name-read.dogfood.test.ts`.
 *
 * Controls: a flow name no managed package ships keeps its stored row (the
 * tenant's own flow), a shipped name with no stored row is unchanged, an
 * organization-scoped flow row is out of the read's reach, and a type in the
 * overlay regime keeps its overlay.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PACKAGE_ID = 'com.example.pkg';
const SHIPPED = 'pkg_flow';
const CUSTOMER = 'customer_flow';
const ORG_ID = 'org_a';

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
    id: `r_${type}_${name}_${extra.organization_id ?? 'env'}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify(body),
    ...extra,
});

/**
 * A registry double with the real `SchemaRegistry`'s two key shapes, its
 * `getItem` precedence and its artifact lookup. `registerItem` stamps a package
 * entry the way `applyProtection` does and leaves a bare registration's
 * provenance alone.
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
        /** The real precedence: the bare slot, then prefer-local, then the first composite. */
        getItem(type: string, name: string, packageId?: string) {
            const entries = byType.get(type);
            if (!entries) return undefined;
            const direct = entries.get(name);
            if (direct) return direct;
            if (packageId) {
                const local = entries.get(`${packageId}:${name}`);
                if (local) return local;
            }
            for (const [key, item] of entries) if (key.endsWith(`:${name}`)) return item;
            return undefined;
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
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
}

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, plus the
 * registry. ⛔ No `insert` / `update` / `delete` — the read paths under test
 * issue no write verb.
 */
function harness(rows: StoredRow[]) {
    const registry = registryDouble();
    // What the loader registered: one packaged flow and one packaged view.
    registry.registerItem('flow', flowBody(SHIPPED, 'LOADER'), 'name', PACKAGE_ID);
    registry.registerItem('view', { name: 'pkg_view', label: 'LOADER VIEW' }, 'name', PACKAGE_ID);
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        registry,
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, registry };
}

const byName = async (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    ((await protocol.getMetaItem(request as any)) as { item: Record<string, unknown> }).item;
const listed = async (protocol: ObjectStackProtocolImplementation, name: string) =>
    ((await protocol.getMetaItems({ type: 'flow' })) as { items: Array<Record<string, unknown>> }).items
        .filter((it) => it.name === name);

describe('[#20946] the by-name read of a shipped flow name serves the loader\'s body', () => {
    it('a shipped name with an environment-wide stored row answers the loader\'s body, not the row\'s', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(served.label).toBe('LOADER');
        expect(served._packageId).toBe(PACKAGE_ID);
    });

    it('it does so after the row was hydrated — the registry\'s bare copy of the row does not stand in either', async () => {
        const { protocol, registry } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);
        await protocol.getMetaItemsForExecution({ type: 'flow' }); // hydrates the row under the bare key
        expect(registry.bare('flow', SHIPPED)?.label).toBe('STORED');

        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(served.label).toBe('LOADER');
    });

    it('by name and in the list, the shipped name answers the same body', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const list = await listed(protocol, SHIPPED);
        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(list.map((it) => it.label)).toEqual(['LOADER']);
        expect(served.label).toBe(list[0].label);
        expect(served.nodes).toEqual(list[0].nodes);
    });

    it('the package-scoped read answers the loader\'s body too', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const served = await byName(protocol, { type: 'flow', name: SHIPPED, packageId: PACKAGE_ID });

        expect(served.label).toBe('LOADER');
    });

    it('a row bound to the shipping package, or one whose own body claims its provenance, is judged by name alone', async () => {
        for (const row of [
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'), { package_id: PACKAGE_ID }),
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED', { _packageId: PACKAGE_ID, _provenance: 'package' })),
        ]) {
            for (const request of [
                { type: 'flow', name: SHIPPED },
                { type: 'flow', name: SHIPPED, packageId: PACKAGE_ID },
            ]) {
                const { protocol } = harness([row]);
                expect((await byName(protocol, request)).label).toBe('LOADER');
            }
        }
    });

    it('the plural spelling of the type is folded first and answers the same', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const served = await byName(protocol, { type: 'flows', name: SHIPPED });

        expect(served.label).toBe('LOADER');
    });

    it('control: a flow name no managed package ships answers its stored row, unchanged', async () => {
        const { protocol } = harness([storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'CUSTOMER'))]);

        const served = await byName(protocol, { type: 'flow', name: CUSTOMER });

        expect(served.label).toBe('CUSTOMER');
        expect(isCodeArtifactBody(served)).toBe(false);
    });

    it('control: a shipped name with no stored row answers the loader\'s body, unchanged', async () => {
        const { protocol } = harness([]);

        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(served.label).toBe('LOADER');
    });

    it('control: an organization-scoped flow row is out of the read\'s reach', async () => {
        const { protocol } = harness([
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'ORG ROW'), { organization_id: ORG_ID }),
            storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'ORG ROW'), { organization_id: ORG_ID }),
        ]);

        expect((await byName(protocol, { type: 'flow', name: SHIPPED, organizationId: ORG_ID })).label).toBe('LOADER');
        expect(await byName(protocol, { type: 'flow', name: CUSTOMER, organizationId: ORG_ID })).toBeUndefined();
    });

    it('control: an overlay of a packaged type in the overlay regime is still served over the artifact', async () => {
        const { protocol } = harness([storedRow('view', 'pkg_view', { name: 'pkg_view', label: 'OVERLAY VIEW' })]);

        const served = await byName(protocol, { type: 'view', name: 'pkg_view' });

        expect(served.label).toBe('OVERLAY VIEW');
        expect(served._packageId).toBe(PACKAGE_ID);
    });
});
