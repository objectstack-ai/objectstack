// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6808 — the registry heal's OBJECT limb, pinned at this package's own seam.
 *
 * `deleteMetaItem` ends its repository delete with `restoreArtifactRegistryView`
 * (the #6687 three-tier walk). Every verb that walk used —
 * `removeRuntimeShadow`, `registerItem`, `removeOverlayEntry` — addresses
 * `SchemaRegistry`'s generic `metadata` map. An `object` is written into TWO
 * places on the way in (`registerItem` into that map, `registerObject` into
 * `objectContributors`), so the walk retired the LISTING copy and left the
 * DISPATCH copy: `registry.getObject(name)` kept serving a deleted object, and
 * with it every data-plane write, because `assertObjectRegistered` reads
 * exactly that.
 *
 * This file pins the CONTRACT between the two packages — that the heal calls a
 * name-addressed object removal, on the right tier and for the right type, and
 * degrades rather than throwing when the registry in hand does not have one.
 * The behavioural half (a real `SchemaRegistry`, real repository, both exits
 * measured, data CRUD refused afterwards) lives in `@objectstack/objectql`,
 * which is where the registry lives:
 * `protocol-delete-object-registry-heal.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Removing the `registry.unregisterObject(name)` call from the heal turns the
 * two "calls it" cases in this file red on the call count (`[]` vs
 * `['rc9_widget']`) and leaves every negative case green — they assert the call
 * is NOT made, which is trivially true with no call site at all. That asymmetry
 * is intended: the negatives constrain the SHAPE of the fix (tier and type),
 * not its presence.
 */
import { describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). Imported from `@objectstack/metadata-core`, never from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    checksum: string;
    metadata: string;
}

/** An overlay row as `deleteMetaItem` finds it — a real `checksum` or the OCC */
/** parent-version check 409s before the heal is ever reached. */
const overlayRow = (type: string, name: string): Row => ({
    id: `row_${type}_${name}`,
    type,
    name,
    organization_id: null,
    state: 'active',
    checksum: 'sha256:stored-head',
    metadata: JSON.stringify({ name, label: 'Stored' }),
});

function makeHarness(opts: {
    rows?: Row[];
    /** Tier 1 answers "a packaged artifact is underneath" for these `type|name`s. */
    shadowed?: Array<{ type: string; name: string }>;
    /** Simulate an older registry double that has no name-addressed removal. */
    omitUnregisterObject?: boolean;
    /** The ADR-0029 refusal, raised by the registry the way the real verb does. */
    unregisterThrows?: Error;
    /**
     * ADR-0010 `_provenance` of what the registry currently serves for the
     * name. `'org'` is what BOTH paths that register a tenant's object stamp
     * (the write-through and the boot rehydration); `'package'` is a
     * loader-introduced artifact.
     */
    servedProvenance?: 'org' | 'package' | null;
    /** `environmentId === undefined` — the kernel on which the two-tier delete
     * authorization does not run. A FLAG, never an `environmentId` parameter
     * with a default: passing `undefined` explicitly to a defaulted parameter
     * re-applies the default (#6621). */
    controlPlane?: boolean;
} = {}) {
    const rows = [...(opts.rows ?? [])];
    const shadowKeys = new Set((opts.shadowed ?? []).map((s) => `${s.type}|${s.name}`));
    const unregisterObjectCalls: string[] = [];
    const removeOverlayEntryCalls: string[] = [];
    const matches = (row: Row, where: Record<string, unknown> = {}) =>
        Object.entries(where).every(([k, v]) => (row as any)[k] === v);

    const provenance = opts.servedProvenance === undefined ? 'org' : opts.servedProvenance;
    const registry: any = {
        getObject: (name: string) =>
            provenance === null ? undefined : { name, _packageId: 'app.myapp', _provenance: provenance },
        getItem: () => undefined,
        listItems: () => [],
        registerItem: () => {},
        registerObject: () => {},
        applyNavContributions: (x: unknown) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
        // Mirrors the REAL `SchemaRegistry.getArtifactItem` for `object`: it
        // reads `getObject` and returns it only when it looks like packaged
        // code (`_packageId` real, and NOT `_provenance: 'org'`). A double that
        // always answered `undefined` here would report every object as
        // runtime-authored and hide the artifact refusal entirely — looser than
        // the implementation it stands in for, which is no test at all (#4550).
        getArtifactItem: (type: string, name: string) => {
            if (type !== 'object' && type !== 'objects') return undefined;
            const obj: any = registry.getObject(name);
            return obj && obj._packageId && obj._packageId !== 'sys_metadata' && obj._provenance !== 'org'
                ? obj
                : undefined;
        },
        removeRuntimeShadow: (type: string, name: string) => shadowKeys.has(`${type}|${name}`),
        removeOverlayEntry: (type: string, name: string) => {
            removeOverlayEntryCalls.push(`${type}|${name}`);
            return true;
        },
    };
    if (!opts.omitUnregisterObject) {
        registry.unregisterObject = (name: string) => {
            unregisterObjectCalls.push(name);
            if (opts.unregisterThrows) throw opts.unregisterThrows;
            return true;
        };
    }

    const engine: any = {
        async findOne(table: string, query: { where?: Record<string, unknown> } = {}) {
            if (table !== 'sys_metadata') return null;
            return rows.find((r) => matches(r, query.where)) ?? null;
        },
        async find() { return []; },
        async insert(_table: string, data: Record<string, unknown>) { return { id: 'inserted', ...data }; },
        async update(_table: string, data: Record<string, unknown>, options?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, options);
            return { id: null };
        },
        async delete(_table: string, options?: Record<string, unknown>) {
            assertEngineDeleteDispatch(options);
            const id = (options as any)?.where?.id;
            const at = rows.findIndex((r) => r.id === id);
            if (at >= 0) rows.splice(at, 1);
            return { deleted: at >= 0 ? 1 : 0 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        async syncObjectSchema() { /* no physical storage in this double */ },
        registry,
    };

    // An EMPTY services registry: with no `metadata` service, tier 2 answers
    // "no baseline, not degraded", which is the verdict that licenses tier 3.
    const protocol = new ObjectStackProtocolImplementation(
        engine, () => new Map(), opts.controlPlane === true ? undefined : 'env_1',
    ) as any;
    return { protocol, rows, unregisterObjectCalls, removeOverlayEntryCalls };
}

describe('#6808 — the heal retires the object contributor, not just the metadata entry', () => {
    it('a deleted runtime-only object is unregistered BY NAME', async () => {
        const h = makeHarness({ rows: [overlayRow('object', 'rc9_widget')] });

        const result = await h.protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });

        expect(result.success).toBe(true);
        expect(h.rows).toHaveLength(0);
        // Pre-fix: `[]`. The generic-map half ran and the contributor half did not.
        expect(h.unregisterObjectCalls).toEqual(['rc9_widget']);
        // …alongside the half that always ran, not instead of it.
        expect(h.removeOverlayEntryCalls).toContain('object|rc9_widget');
    });

    it('the plural `objects` spelling reaches the same limb, once', async () => {
        const h = makeHarness({ rows: [overlayRow('object', 'rc9_widget')] });

        await h.protocol.deleteMetaItem({ type: 'objects', name: 'rc9_widget' });

        // Keyed off the SINGULAR, so the twin spelling neither misses it nor
        // doubles it (#4432 — every surface in agreement).
        expect(h.unregisterObjectCalls).toEqual(['rc9_widget']);
    });

    it('a NON-object type never reaches it — only `object` has a second home', async () => {
        const h = makeHarness({ rows: [overlayRow('view', 'rc9_grid')] });

        const result = await h.protocol.deleteMetaItem({ type: 'view', name: 'rc9_grid' });

        expect(result.success).toBe(true);
        expect(h.removeOverlayEntryCalls).toContain('view|rc9_grid');
        expect(h.unregisterObjectCalls).toEqual([]);
    });

    /**
     * The tier discipline. Tier 1 concluded a packaged artifact still serves the
     * name, so the walk returns before tier 3 — and an object that is still
     * served must stay registered: `assertObjectRegistered` fails CLOSED, so
     * retiring it here would turn "reset to artifact default" into a data-plane
     * outage for a name a code package still ships.
     */
    it('an object whose overlay shadows an artifact is NOT unregistered (tier 1 stops the walk)', async () => {
        const h = makeHarness({
            rows: [overlayRow('object', 'rc9_widget')],
            shadowed: [{ type: 'object', name: 'rc9_widget' }],
        });

        const result = await h.protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });

        expect(result.success).toBe(true);
        expect(h.rows).toHaveLength(0);
        expect(h.removeOverlayEntryCalls).toEqual([]);
        expect(h.unregisterObjectCalls).toEqual([]);
    });

    /**
     * The second refusal, and the one that is NOT theoretical for objects:
     * `engine.registerApp` registers a package's objects straight into
     * `objectContributors` without writing the generic `metadata` map, so
     * `isArtifactBacked` does not see them and an overlay row for such a name
     * CAN be authored. Retiring the contributor on that row's delete would take
     * a code package's object off the data plane until restart.
     *
     * The axis is ADR-0010 `_provenance`, the same one `removeOverlayEntry`
     * uses one line up — both paths that register a TENANT's object stamp
     * `'org'` server-side, an artifact carries `'package'`.
     */
    it('a CODE-SHIPPED object is never unregistered by this walk', async () => {
        // The reachable shape: a CONTROL-PLANE kernel (the two-tier delete
        // authorization that refuses an artifact-backed `object` with
        // `NOT_OVERRIDABLE` is wrapped in `environmentId !== undefined`), on the
        // NO-ROW leg — which runs the heal without ever reaching the
        // repository's own `assertAllowed`. `revertCommit`'s soft-remove limb
        // reaches the walk without that gate either.
        const h = makeHarness({ controlPlane: true, servedProvenance: 'package' });

        const result = await h.protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });

        expect(result.success).toBe(true);
        // The generic-map half still runs — that entry IS the overlay's slot,
        // and `removeOverlayEntry` applies its own artifact refusal inside.
        expect(h.removeOverlayEntryCalls).toContain('object|rc9_widget');
        expect(h.unregisterObjectCalls).toEqual([]);
    });

    /**
     * The ADR-0029 refusal, at THIS seam. The registry verb throws when an
     * extender still depends on the owner; the heal runs after the repository
     * delete has committed, so it must not propagate that — the row is gone
     * either way and a throw here would turn a successful delete into a 500.
     * What it must not do is swallow it into the silent outer `catch`: a runtime
     * that disagrees with `sys_metadata` has to be visible in the log.
     */
    it('an extender refusal is stated, not swallowed — and the delete still succeeds', async () => {
        const h = makeHarness({
            rows: [overlayRow('object', 'rc9_widget')],
            unregisterThrows: new Error(
                'Cannot unregister object "rc9_widget": it is extended by app.addon. Unregister the extenders first.',
            ),
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let result: any;
        let warned: string[];
        try {
            result = await h.protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });
        } finally {
            // Read BEFORE restoring — `mockRestore` also resets recorded calls.
            warned = warn.mock.calls.map((c) => String(c[0]));
            warn.mockRestore();
        }

        expect(result.success).toBe(true);
        expect(h.rows).toHaveLength(0);
        const refusals = warned.filter((m) => m.includes('stays registered'));
        expect(refusals).toHaveLength(1);
        expect(refusals[0]).toContain('rc9_widget');
        expect(refusals[0]).toContain('app.addon');
    });

    /**
     * The same `typeof … === 'function'` courtesy every other verb in this walk
     * extends to a partial registry double (edge/Lite embeddings, engine
     * doubles). A missing verb is a no-op, never a crash that would strand the
     * rest of the delete.
     */
    it('a registry without the verb degrades quietly — the delete still succeeds', async () => {
        const h = makeHarness({
            rows: [overlayRow('object', 'rc9_widget')],
            omitUnregisterObject: true,
        });

        const result = await h.protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });

        expect(result.success).toBe(true);
        expect(h.rows).toHaveLength(0);
        expect(h.removeOverlayEntryCalls).toContain('object|rc9_widget');
    });
});
