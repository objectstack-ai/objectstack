// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21059] The layered read's code layer is the packaged artifact, or an item
 * registered at runtime with no package — never a stored row that a hydration
 * put in the registry's plain slot. For a name no package ships, the read
 * answers a null code layer before a hydration and after it alike.
 *
 * The spec's layer 1 reads "`null` when no artifact ships this item (it exists
 * only as an overlay)", and the method's own #5707 / #5840 rule allows a layer
 * only from a read that happened. The fallback below the artifact lookup reads
 * the registry's plain slot, which it does for items registered at runtime
 * without a package; a hydrated stored row lands in that same slot. So once a
 * hydration had run, the code layer was the stored body and the lock flags were
 * resolved from it, while the same read before the hydration answered a null
 * code layer. The discriminator is the tenant marker the hydrator already
 * writes on every row it registers; nothing new is stamped.
 *
 * Triage's ruling on the open corner is pinned as well: a stored body that
 * carries package-provenance stamps under a name no package ships is not a code
 * layer either, so the lock-state resolver sees no code layer for it and its
 * flags are the same before and after a hydration.
 *
 * The registry double is the one `protocol.flow-layered-shipped-name.test.ts`
 * uses: the real `SchemaRegistry`'s key shapes (`<package>:<name>` for a loader
 * entry, the bare name for everything else), its `getItem` precedence (the bare
 * slot first) and its artifact lookup. `registerItem` stamps a package entry the
 * way `applyProtection` does and leaves a bare registration alone.
 * `@objectstack/objectql` cannot be imported here: it depends on this package.
 * The cold-boot proof over the real composition is
 * `packages/qa/dogfood/test/flow-unshipped-name-layered-code.dogfood.test.ts`.
 *
 * Controls: a shipped name keeps the loader's body as its code layer on both
 * sides of a hydration, and an item registered at runtime with no package keeps
 * its code layer — the fallback's stated purpose.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PACKAGE_ID = 'com.example.pkg';
const SHIPPED = 'pkg_flow';
const UNSHIPPED = 'customer_flow';
const STAMPED = 'stamped_flow';
const RUNTIME = 'runtime_flow';
const UNSHIPPED_VIEW = 'customer_view';

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

/** A body that claims a package's provenance under a name that package does not ship. */
const stampedBody = (name: string) => flowBody(name, 'STAMPED', {
    _packageId: PACKAGE_ID,
    _packageVersion: '1.0.0',
    _provenance: 'package',
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

/** The registry double — see the header. */
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
            return bare && isCodeArtifactBody(bare) && (!packageId || bare._packageId === packageId) ? bare : undefined;
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
 * registry. ⛔ No `insert` / `update` / `delete` — the paths under test (the
 * layered read and the two hydrations) issue no write verb.
 */
function harness(rows: StoredRow[]) {
    const registry = registryDouble();
    // What the loader registered: one packaged flow.
    registry.registerItem('flow', flowBody(SHIPPED, 'LOADER'), 'name', PACKAGE_ID);
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

type Layer = Record<string, unknown> & { label?: unknown };
interface LayeredAnswer {
    code: Layer | null;
    overlay: Layer | null;
    overlayScope: 'org' | 'env' | null;
    effective: Layer | null;
    lock: string;
    lockSource?: string;
    provenance?: string;
    packageId?: string;
    packageVersion?: string;
    editable: boolean;
    deletable: boolean;
    resettable: boolean;
}

const layered = async (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    (await protocol.getMetaItemLayered(request as any)) as unknown as LayeredAnswer;

/** The ADR-0010 protection flags the response derives from its layers. */
const flagsOf = (answer: LayeredAnswer) => ({
    lock: answer.lock,
    lockSource: answer.lockSource,
    provenance: answer.provenance,
    packageId: answer.packageId,
    packageVersion: answer.packageVersion,
    editable: answer.editable,
    deletable: answer.deletable,
    resettable: answer.resettable,
});

/** Boot hydration: the stored rows go into the registry, as on a cold boot. */
async function bootHydrate(protocol: ObjectStackProtocolImplementation) {
    const receipt = await protocol.loadMetaFromDb();
    expect(receipt.storeUnavailable).toBe(false);
    expect(receipt.errors).toBe(0);
    return receipt;
}

describe('[#21059] the layered read answers a null code layer for a name no package ships, before and after hydration', () => {
    it('an unshipped flow name: null before boot hydration and null after it, with the stored row reported as the stored layer', async () => {
        const { protocol, registry } = harness([storedRow('flow', UNSHIPPED, flowBody(UNSHIPPED, 'STORED'))]);

        const before = await layered(protocol, { type: 'flow', name: UNSHIPPED });
        expect(registry.bare('flow', UNSHIPPED)).toBeUndefined();
        expect(before.code).toBeNull();
        expect(before.overlay?.label).toBe('STORED');

        await bootHydrate(protocol);
        // The hydration really ran: the row now sits in the registry's plain slot.
        expect(registry.bare('flow', UNSHIPPED)?.label).toBe('STORED');

        const after = await layered(protocol, { type: 'flow', name: UNSHIPPED });
        expect(after.code).toBeNull();
        expect(after.overlay?.label).toBe('STORED');
        expect(after.overlayScope).toBe('env');
        expect(after.effective?.label).toBe('STORED');
        expect(flagsOf(after)).toEqual(flagsOf(before));
    });

    it('the read-side hydration is held the same way', async () => {
        const { protocol, registry } = harness([storedRow('flow', UNSHIPPED, flowBody(UNSHIPPED, 'STORED'))]);
        await protocol.getMetaItemsForExecution({ type: 'flow' });
        expect(registry.bare('flow', UNSHIPPED)?.label).toBe('STORED');

        const after = await layered(protocol, { type: 'flow', name: UNSHIPPED });

        expect(after.code).toBeNull();
        expect(after.effective?.label).toBe('STORED');
    });

    it('the package-scoped read and the plural type spelling answer the same', async () => {
        for (const request of [
            { type: 'flow', name: UNSHIPPED, packageId: PACKAGE_ID },
            { type: 'flows', name: UNSHIPPED },
        ]) {
            const { protocol } = harness([storedRow('flow', UNSHIPPED, flowBody(UNSHIPPED, 'STORED'))]);
            await bootHydrate(protocol);
            const after = await layered(protocol, request);
            expect(after.code).toBeNull();
            expect(after.overlay?.label).toBe('STORED');
        }
    });

    it('a stored body carrying package-provenance stamps under an unshipped name is no code layer, and the lock-state flags do not move across hydration', async () => {
        for (const row of [
            storedRow('flow', STAMPED, stampedBody(STAMPED)),
            storedRow('flow', STAMPED, stampedBody(STAMPED), { package_id: PACKAGE_ID }),
        ]) {
            const { protocol, registry } = harness([row]);

            const before = await layered(protocol, { type: 'flow', name: STAMPED });
            expect(before.code).toBeNull();

            await bootHydrate(protocol);
            expect(registry.bare('flow', STAMPED)?.label).toBe('STAMPED');

            for (const request of [
                { type: 'flow', name: STAMPED },
                { type: 'flow', name: STAMPED, packageId: PACKAGE_ID },
            ]) {
                const after = await layered(protocol, request);
                expect(after.code).toBeNull();
                expect(after.overlay?.label).toBe('STAMPED');
                expect(flagsOf(after)).toEqual(flagsOf(before));
            }
        }
    });

    it('not a flow-only rule: an unshipped view\'s hydrated row is no code layer either', async () => {
        const { protocol, registry } = harness([
            storedRow('view', UNSHIPPED_VIEW, { name: UNSHIPPED_VIEW, label: 'STORED VIEW' }),
        ]);

        const before = await layered(protocol, { type: 'view', name: UNSHIPPED_VIEW });
        expect(before.code).toBeNull();

        await bootHydrate(protocol);
        expect(registry.bare('view', UNSHIPPED_VIEW)?.label).toBe('STORED VIEW');

        const after = await layered(protocol, { type: 'view', name: UNSHIPPED_VIEW });
        expect(after.code).toBeNull();
        expect(after.effective?.label).toBe('STORED VIEW');
        expect(flagsOf(after)).toEqual(flagsOf(before));
    });

    it('control: a shipped name keeps the loader\'s body as its code layer, before and after hydration', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const before = await layered(protocol, { type: 'flow', name: SHIPPED });
        expect(before.code?.label).toBe('LOADER');

        await bootHydrate(protocol);

        const after = await layered(protocol, { type: 'flow', name: SHIPPED });
        expect(after.code?.label).toBe('LOADER');
        expect(after.overlay?.label).toBe('STORED');
        expect(after.packageId).toBe(PACKAGE_ID);
        expect(after.provenance).toBe('package');
        expect(flagsOf(after)).toEqual(flagsOf(before));
    });

    it('control: an item registered at runtime with no package keeps its code layer', async () => {
        const { protocol, registry } = harness([]);
        registry.registerItem('flow', flowBody(RUNTIME, 'RUNTIME'));

        const before = await layered(protocol, { type: 'flow', name: RUNTIME });
        expect(before.code?.label).toBe('RUNTIME');
        expect(before.overlay).toBeNull();
        expect(before.effective?.label).toBe('RUNTIME');

        await bootHydrate(protocol);

        const after = await layered(protocol, { type: 'flow', name: RUNTIME });
        expect(after.code?.label).toBe('RUNTIME');
        expect(after.effective?.label).toBe('RUNTIME');
    });
});
