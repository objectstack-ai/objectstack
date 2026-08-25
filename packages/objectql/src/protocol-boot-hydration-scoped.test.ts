// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4624 — boot hydration (`loadMetaFromDb`) grafts each overlay row's
 * protection envelope from ITS OWN package (ADR-0048 / #1828).
 *
 * Pre-fix, the non-object branch of `loadMetaFromDb` kept a third inline
 * copy of the overlay→SchemaRegistry rule and looked the artifact up
 * UNSCOPED (`lookupArtifactItem(type, name)` without the row's
 * `package_id`) — the exact pre-#1828 shape: with two installed packages
 * shipping the same `type`/`name`, a name-colliding overlay row grafted
 * the FIRST-registered package's `_lock`/`_packageId`/`_provenance` onto
 * another package's row at boot (composite-scan first-match by Map
 * iteration order).
 *
 * Post-fix the branch delegates to the ONE shared
 * `hydrateOverlayIntoRegistry` (#4521), so the ADR-0048 package-scoped
 * lookup applies at boot exactly as it does on the read-side hydration
 * and the write-through.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';

const PKG_A = 'com.acme.a';
const PKG_B = 'com.acme.b';

function artifactPage(pkg: string, label: string) {
    return {
        name: 'home',
        label,
        _packageId: pkg,
        _packageVersion: '1.0.0',
        _provenance: 'package',
        _lock: 'full',
        _lockReason: `Locked by ${pkg}`,
    };
}

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

function makeEngine(registry: SchemaRegistry, rows: Row[]) {
    const matches = (r: Row, where: Record<string, unknown>): boolean => {
        for (const [k, v] of Object.entries(where)) {
            if (v === undefined) continue;
            if ((r as any)[k] !== v) return false;
        }
        return true;
    };
    const engine: any = {
        registry,
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return rows.filter((r) => matches(r, opts.where));
        },
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            // [#11957] Pinned to ObjectQL.findOne's OWN #4419 predicate: `findOne`
            // applies limit: 1, so a query naming no record returns an ARBITRARY row
            // and the engine REFUSES it. A double that answers it anyway is how
            // #11767 shipped a bootstrap bypass that was inert on every real
            // deployment while a 641-line unit matrix stayed green.
            assertEngineFindOnePredicate(_t, opts);
            return rows.find((r) => matches(r, opts.where)) ?? null;
        },
        async insert() { return { id: 'x' }; },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            // [#5480] Pinned to ObjectQL.update's OWN dispatch predicate — the twin of
            // the delete pin, on the same argument: a double looser than the engine it
            // stands in for is how #4434 shipped a REST route that 500'd for every
            // caller with its suite green, and a predicate update is no less
            // destructive than a predicate delete.
            assertEngineUpdateDispatch(data, opts);
            return { id: 'x' };
        },
        async delete() { return { deleted: 0 }; },
    };
    return engine;
}

function overlayRow(partial: Partial<Row> & { name: string; metadata: unknown }): Row {
    return {
        id: `r_${partial.name}_${partial.package_id ?? 'global'}`,
        type: 'page',
        organization_id: null,
        package_id: null,
        state: 'active',
        ...partial,
        metadata: typeof partial.metadata === 'string'
            ? partial.metadata
            : JSON.stringify(partial.metadata),
    } as Row;
}

describe('loadMetaFromDb — ADR-0048 package-scoped protection graft at boot (#4624)', () => {
    it('grafts the envelope from the row\'s OWN package, not the first-registered one', async () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        // Package A registers FIRST — pre-fix, the unscoped composite scan
        // returned A for every same-named row, whatever package owned it.
        registry.registerItem('page', artifactPage(PKG_A, 'A Home'), 'name', PKG_A);
        registry.registerItem('page', artifactPage(PKG_B, 'B Home'), 'name', PKG_B);

        const rows = [
            overlayRow({
                name: 'home',
                package_id: PKG_B,
                metadata: { name: 'home', label: 'B Home (customized)' },
            }),
        ];
        const engine = makeEngine(registry, rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res = await protocol.loadMetaFromDb();
        expect(res.loaded).toBe(1);
        expect(res.errors).toBe(0);

        // The hydrated plain-key entry carries package B's envelope —
        // pre-fix it carried PKG_A's (`_packageId: 'com.acme.a'`,
        // `_lockReason: 'Locked by com.acme.a'`).
        const direct: any = registry.getItem('page', 'home');
        expect(direct.label).toBe('B Home (customized)'); // overlay content wins
        expect(direct._packageId).toBe(PKG_B);
        expect(direct._lock).toBe('full');
        expect(direct._lockReason).toBe(`Locked by ${PKG_B}`);
        expect(direct._provenance).toBe('package');
    });

    it('registers the row unchanged when artifacts have not loaded yet (boot-order no-op)', async () => {
        // Empty registry at hydration time — the scoped lookup finds
        // nothing, exactly like the unscoped one did, and the row
        // registers without a grafted envelope. Artifact-after-hydration
        // boot orders are unaffected by the scoping.
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        const rows = [
            overlayRow({
                name: 'home',
                package_id: PKG_B,
                metadata: { name: 'home', label: 'B Home (customized)' },
            }),
        ];
        const engine = makeEngine(registry, rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res = await protocol.loadMetaFromDb();
        expect(res.loaded).toBe(1);

        const direct: any = registry.getItem('page', 'home');
        expect(direct.label).toBe('B Home (customized)');
        expect(direct._lock).toBeUndefined();
        expect(direct._packageId).toBeUndefined();
        expect(direct._provenance).toBeUndefined();
    });

    it('keeps the legacy best-effort graft for package-less (global) rows', async () => {
        // A row with no package binding keeps the pre-existing unscoped
        // first-match semantics — identical to the read-side hydration.
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        registry.registerItem('page', artifactPage(PKG_A, 'A Home'), 'name', PKG_A);
        registry.registerItem('page', artifactPage(PKG_B, 'B Home'), 'name', PKG_B);

        const rows = [
            overlayRow({
                name: 'home',
                package_id: null,
                metadata: { name: 'home', label: 'Global overlay' },
            }),
        ];
        const engine = makeEngine(registry, rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.loadMetaFromDb();

        const direct: any = registry.getItem('page', 'home');
        expect(direct.label).toBe('Global overlay');
        // Best-effort first-match: SOME package's envelope is grafted
        // (legacy behaviour, unchanged by #4624 — do not over-pin which).
        expect([PKG_A, PKG_B]).toContain(direct._packageId);
        expect(direct._lock).toBe('full');
    });
});
