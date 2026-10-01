// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21002, #20761 ruling rule 1, ADR-0126 §2 / §3] The layered read of a flow
 * name the loader's set holds reports the loader's body as the effective layer
 * — the body the by-name read and the list serve for that name — and a stored
 * row of that name as a shadowed layer, never as the effective layer under the
 * package's lock and provenance flags.
 *
 * `flow` is Regime C: the packaged base is locked, "⛔ Never silent override,
 * never an overlay read path". Since #20913 the flattened view and since
 * #20946 `getMetaItem` apply that by name, with the stored-row predicate
 * (`isShippedFlowName`). `getMetaItemLayered` computed its effective layer as
 * overlay-wins, so for such a name it answered the stored body while its
 * docblock promised "what `getMetaItem` would return". It now decides the
 * effective layer with the same predicate, and keeps the row in `overlay`.
 *
 * The registry double is the one `protocol.flow-by-name-shipped-name.test.ts`
 * uses: the real `SchemaRegistry`'s key shape (`<package>:<name>` for a loader
 * entry, the bare name for a hydrated row), its `getItem` precedence (the bare
 * slot first) and its artifact lookup (package-scoped code-artifact entries
 * first). `@objectstack/objectql` cannot be imported here: it depends on this
 * package. The cold-boot proof over the real composition is
 * `flow-shipped-name-layered-read.dogfood.test.ts`.
 *
 * Controls: a flow name no managed package ships keeps its stored row as the
 * effective layer, a shipped name with no stored row is unchanged, an
 * organization-scoped flow row is out of the read's reach, and a type in the
 * overlay regime keeps overlay-wins.
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
        { id: label === 'LOADER' ? 'end' : 'stored_end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: label === 'LOADER' ? 'end' : 'stored_end' }],
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

type Layer = Record<string, unknown> & { label?: unknown; nodes?: unknown };
interface LayeredAnswer {
    code: Layer | null;
    overlay: Layer | null;
    overlayScope: 'org' | 'env' | null;
    effective: Layer | null;
    packageId?: string;
    provenance?: string;
}

const layered = async (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    (await protocol.getMetaItemLayered(request as any)) as unknown as LayeredAnswer;
const byName = async (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    ((await protocol.getMetaItem(request as any)) as { item: Layer }).item;
const listed = async (protocol: ObjectStackProtocolImplementation, name: string) =>
    ((await protocol.getMetaItems({ type: 'flow' })) as { items: Layer[] }).items
        .filter((it) => it.name === name);

describe('[#21002] the layered read of a shipped flow name reports the loader\'s body as the effective layer', () => {
    it('a shipped name with an environment-wide stored row: the effective layer is the loader\'s body, and the row is a shadowed layer', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const answer = await layered(protocol, { type: 'flow', name: SHIPPED });

        expect(answer.effective?.label).toBe('LOADER');
        expect(answer.code?.label).toBe('LOADER');
        // The stored row is still reported, as stored, with its own scope.
        expect(answer.overlay?.label).toBe('STORED');
        expect(answer.overlayScope).toBe('env');
        // The package's flags describe the effective layer, which is the loader's.
        expect(answer.packageId).toBe(PACKAGE_ID);
        expect(answer.provenance).toBe('package');
    });

    it('it does so after the row was hydrated — the registry\'s bare copy of the row stands in for neither layer', async () => {
        const { protocol, registry } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);
        await protocol.getMetaItemsForExecution({ type: 'flow' }); // hydrates the row under the bare key
        expect(registry.bare('flow', SHIPPED)?.label).toBe('STORED');

        const answer = await layered(protocol, { type: 'flow', name: SHIPPED });

        expect(answer.effective?.label).toBe('LOADER');
        expect(answer.code?.label).toBe('LOADER');
        expect(answer.overlay?.label).toBe('STORED');
    });

    it('the layered read, the by-name read and the list answer one and the same body', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const answer = await layered(protocol, { type: 'flow', name: SHIPPED });
        const served = await byName(protocol, { type: 'flow', name: SHIPPED });
        const list = await listed(protocol, SHIPPED);

        expect(list.map((it) => it.label)).toEqual(['LOADER']);
        expect(answer.effective?.label).toBe(served.label);
        expect(answer.effective?.nodes).toEqual(served.nodes);
        expect(answer.effective?.nodes).toEqual(list[0].nodes);
    });

    it('the package-scoped read and the plural type spelling answer the same', async () => {
        for (const request of [
            { type: 'flow', name: SHIPPED, packageId: PACKAGE_ID },
            { type: 'flows', name: SHIPPED },
        ]) {
            const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);
            const answer = await layered(protocol, request);
            expect(answer.effective?.label).toBe('LOADER');
            expect(answer.overlay?.label).toBe('STORED');
        }
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
                const answer = await layered(protocol, request);
                expect(answer.effective?.label).toBe('LOADER');
                expect(answer.overlay?.label).toBe('STORED');
            }
        }
    });

    it('control: a flow name no managed package ships keeps its stored row as the effective layer', async () => {
        const { protocol } = harness([storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'CUSTOMER'))]);

        const answer = await layered(protocol, { type: 'flow', name: CUSTOMER });

        expect(answer.effective?.label).toBe('CUSTOMER');
        expect(answer.overlay?.label).toBe('CUSTOMER');
        expect(answer.overlayScope).toBe('env');
    });

    it('control: a shipped name with no stored row is unchanged', async () => {
        const { protocol } = harness([]);

        const answer = await layered(protocol, { type: 'flow', name: SHIPPED });

        expect(answer.effective?.label).toBe('LOADER');
        expect(answer.overlay).toBeNull();
        expect(answer.overlayScope).toBeNull();
    });

    it('control: an organization-scoped flow row is out of the read\'s reach', async () => {
        const { protocol } = harness([
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'ORG ROW'), { organization_id: ORG_ID }),
            storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'ORG ROW'), { organization_id: ORG_ID }),
        ]);

        const shipped = await layered(protocol, { type: 'flow', name: SHIPPED, organizationId: ORG_ID });
        expect(shipped.effective?.label).toBe('LOADER');
        expect(shipped.overlay).toBeNull();
        expect(shipped.overlayScope).toBeNull();

        const customer = await layered(protocol, { type: 'flow', name: CUSTOMER, organizationId: ORG_ID });
        expect(customer.overlay).toBeNull();
        expect(customer.effective).toBeNull();
    });

    it('control: an overlay of a packaged type in the overlay regime is still the effective layer', async () => {
        const { protocol } = harness([storedRow('view', 'pkg_view', { name: 'pkg_view', label: 'OVERLAY VIEW' })]);

        const answer = await layered(protocol, { type: 'view', name: 'pkg_view' });

        expect(answer.effective?.label).toBe('OVERLAY VIEW');
        expect(answer.code?.label).toBe('LOADER VIEW');
        expect(answer.overlay?.label).toBe('OVERLAY VIEW');
    });
});
