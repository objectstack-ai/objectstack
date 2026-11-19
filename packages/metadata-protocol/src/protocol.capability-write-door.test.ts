// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5961 — the `capability` write door, and what `/meta/types` says about it.
 *
 * `packages/spec` now declares `capability` in all three registries it was
 * missing from (kind enum / schema map / type registry) — the DECLARATION half,
 * pinned in `capability-metadata-kind.test.ts` over there. This file is the
 * ENFORCEMENT half, and it is the acceptance criterion: a registry row that no
 * write path reads would have changed a document, not a behaviour.
 *
 * What was wrong, precisely:
 *
 *   • `getMetadataTypeSchema('capability')` answered `undefined`, so
 *     `saveMetaItem` took its documented "unregistered type → store without
 *     validation" branch. `PUT /api/v1/meta/capability/:name` accepted ANY
 *     JSON into `sys_metadata` — on the AUTHORIZATION surface, where
 *     `systemPermissions` (grant) and `requiredPermissions` (requirement)
 *     resolve capabilities by NAME STRING.
 *   • `isRuntimeCreateAllowed` mirrors `getMetaTypes()`'s synthesis rule:
 *     a type with no static registry entry is treated as runtime-creatable, so
 *     the missing row did not merely fail to close the door — it OPENED it.
 *     `/meta/types` published the matching fiction: `allowRuntimeCreate: true`
 *     with no schema, which the metadata-admin engine renders as a raw-JSON
 *     textarea.
 *
 * ---------------------------------------------------------------------------
 * #35157 — runtime-creatable, overlay-closed, one name per holder
 * ---------------------------------------------------------------------------
 * `capability` is no longer code-only: `allowRuntimeCreate: true` with
 * `allowEnvironmentOverlay: false`, because an `unmanaged` install (ADR-0131
 * D6) copies an app's capabilities into environment rows through this door,
 * and an app that gates its own actions could not be copied without them.
 * What the door now pins, in the order `saveMetaItem` meets them:
 *
 *   1. SCHEMA — every write is judged by `CapabilityDeclarationSchema`: a
 *      garbage body is 422 `invalid_metadata` and nothing is stored, with no
 *      operator hatch needed to reach the check. A valid one saves.
 *   2. PLATFORM FLOOR — a curated platform capability's name is refused
 *      `NAMESPACE_CONFLICT` / 422 before any read: a declaration under it
 *      would re-declare a platform power's `scope` (ADR-0090 D5 revision,
 *      boundary 1; D12 (c)).
 *   3. ONE NAME, ONE HOLDER — a name a package holds, or the environment or
 *      another package stores, is refused the same way: a grant and a
 *      requirement match a capability by name across the whole deployment.
 *   4. PACKAGE DECLARATION — untouched: `AppPlugin` registers stack
 *      `capabilities[]` through `registerInMemory`, never this door.
 *
 * #5961's reverse verification (below) measured the schema binding as a
 * genuine second line of defence; with the code-only gate gone it is the first.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification of #5961, as recorded then
 * ---------------------------------------------------------------------------
 *
 *   • Deleting the `capability` registry row made `isRuntimeCreateAllowed`
 *     answer "creatable" and the refusals resolve; deleting the schema binding
 *     made a garbage body save. Only the second half still applies to the
 *     door as it stands, and case 1 below pins it.
 *
 * Harness: the real write path over a stub engine — the same shape as
 * `protocol.flow-org-override-closed.test.ts`. The gates run INSIDE
 * `saveMetaItem`, so a harness that mocks it cannot see them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). Imported from `@objectstack/metadata-core`, never from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';
// The served save reaches a dynamic `import('@objectstack/lint')` (metadata diagnostics): pay its load at collection.
import '@objectstack/lint';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

function makeStubEngine(
    registeredTypes: string[] = [],
    packageHeld: Array<{ catalogType: string; name: string; packageIds: string[] }> = [],
) {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const keyOf = (w: Record<string, unknown>) =>
        `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(_t, opts);
            for (const row of rows.values()) {
                if (opts.where.type !== undefined && row.type !== opts.where.type) continue;
                if (opts.where.name !== undefined && row.name !== opts.where.name) continue;
                if (opts.where.state !== undefined && row.state !== opts.where.state) continue;
                return row;
            }
            return null;
        },
        async find(_t: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (_t !== 'sys_metadata') return [];
            const where = opts?.where ?? {};
            // Every scalar condition is an equality on that column; an operator
            // object is not modelled by this double and does not narrow.
            const matched = [...rows.values()].filter((row) => Object.entries(where).every(([key, value]) =>
                value === undefined || (typeof value === 'object' && value !== null) || (row as Record<string, unknown>)[key] === value));
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
            getRegisteredTypes: () => registeredTypes,
            // The registry's own package-held reading (`@objectstack/objectql`
            // `packageHeldSecurityCatalogNames`), which the save door asks.
            packageHeldSecurityCatalogNames: () => packageHeld,
        },
    };
    return { engine, rows };
}

function makeProtocol(
    registeredTypes?: string[],
    environmentId?: string,
    packageHeld?: Array<{ catalogType: string; name: string; packageIds: string[] }>,
) {
    const { engine, rows } = makeStubEngine(registeredTypes, packageHeld);
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        environmentId,
    ) as any;
    return { protocol, rows };
}

/** A well-formed package-level capability declaration (ADR-0066 D1). */
const CAPABILITY = {
    name: 'billing.refund',
    label: 'Issue Refunds',
    description: 'Refund a captured payment.',
    scope: 'org',
    packageId: 'com.acme.billing',
};

/**
 * The specimen the old behaviour stored verbatim: arbitrary JSON under a
 * capability name, in the namespace `systemPermissions` grants from.
 */
const NOT_A_CAPABILITY = {
    name: 'billing.refund',
    grantTo: ['*'],
    sql: 'DROP TABLE sys_capability',
};

const entry = (type: string) => DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type);

describe('#5961 / #35157 — capability: runtime-creatable, schema-judged, one name per holder', () => {
    beforeEach(() => {
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
    });
    afterEach(() => {
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
    });

    // ── 1. the schema judges every write ──────────────────────────────────

    it('a garbage body is 422 INVALID_METADATA — nothing reaches sys_metadata, no hatch needed', async () => {
        // #5961's regression, on the open door: the body the old unregistered
        // type stored verbatim. With or without an environment id — the
        // answer must not depend on deployment topology (#5086).
        for (const environmentId of ['env_prod', undefined]) {
            const { protocol, rows } = makeProtocol([], environmentId);
            await expect(
                protocol.saveMetaItem({ type: 'capability', name: 'billing.refund', item: NOT_A_CAPABILITY }),
            ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
            expect(rows.size).toBe(0);
        }
    });

    it('a WELL-FORMED declaration saves — the environment may declare its own capability (#35157)', async () => {
        // The control for the case above, and the acceptance criterion of
        // #35157: an unmanaged copy writes its capabilities through this door.
        const { protocol, rows } = makeProtocol([], 'env_prod');
        const result = await protocol.saveMetaItem({ type: 'capability', name: 'billing.refund', item: CAPABILITY });
        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });

    it('the plural spelling is judged by the same rule', async () => {
        // `STATIC_REGISTRY_TYPES` / `RUNTIME_CREATE_ALLOWED_TYPES` add
        // `SINGULAR_TO_PLURAL[type]` alongside each entry, so
        // `PUT /meta/capabilities/:name` is never a second, looser door.
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'capabilities', name: 'billing.refund', item: NOT_A_CAPABILITY }),
        ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(rows.size).toBe(0);
    });

    // ── 2. the platform floor ─────────────────────────────────────────────

    it('a platform capability name is refused NAMESPACE_CONFLICT / 422, before any write', async () => {
        // `manage_users` declared `scope: 'org'` by the environment would make
        // every set granting it pass condition (c) of the organization
        // boundary (ADR-0090 D12): an organization administrator could hand
        // out user management. The floor is absolute.
        const { protocol, rows } = makeProtocol([], 'env_prod');
        const refused = protocol.saveMetaItem({
            type: 'capability',
            name: 'manage_users',
            item: { name: 'manage_users', label: 'Manage users', scope: 'org' },
        });
        await expect(refused).rejects.toMatchObject({ code: 'NAMESPACE_CONFLICT', status: 422 });
        await expect(refused).rejects.toThrow(/platform capability/);
        expect(rows.size).toBe(0);
    });

    // ── 3. one name, one holder ───────────────────────────────────────────

    it('a name a package holds is refused — the environment cannot re-declare (re-scope) it', async () => {
        const { protocol, rows } = makeProtocol([], 'env_prod', [
            { catalogType: 'capability', name: 'billing.refund', packageIds: ['com.acme.billing'] },
        ]);
        const refused = protocol.saveMetaItem({ type: 'capability', name: 'billing.refund', item: CAPABILITY });
        await expect(refused).rejects.toMatchObject({ code: 'NAMESPACE_CONFLICT', status: 422 });
        await expect(refused).rejects.toThrow(/package "com\.acme\.billing"/);
        expect(rows.size).toBe(0);
    });

    it('CONTROL: a permission set of the same name held by a package does not hold the capability name', async () => {
        // The reading is per catalog type: a set and a capability that share a
        // spelling are two different names.
        const { protocol, rows } = makeProtocol([], 'env_prod', [
            { catalogType: 'permission', name: 'billing.refund', packageIds: ['com.acme.billing'] },
        ]);
        const result = await protocol.saveMetaItem({ type: 'capability', name: 'billing.refund', item: CAPABILITY });
        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });

    it('re-saving the environment\'s own capability is untouched — the owner meets itself', async () => {
        const { protocol, rows } = makeProtocol([], 'env_prod');
        await protocol.saveMetaItem({ type: 'capability', name: 'billing.refund', item: CAPABILITY });
        const again = await protocol.saveMetaItem({
            type: 'capability', name: 'billing.refund', item: { ...CAPABILITY, label: 'Refund payments' },
        });
        expect(again.success).toBe(true);
        expect(rows.size).toBe(1);
    });

    // ── 4. the package-declaration channel, untouched ─────────────────────

    it('the package channel does not go through saveMetaItem at all', async () => {
        // `AppPlugin` calls `metadata.registerInMemory('capability', name, item)`
        // for every stack-declared capability, and the filesystem loader globs
        // `filePatterns` — neither reaches the door above. Asserted
        // structurally: the registry row is what the loader reads, and it
        // must carry patterns; the overlay channel stays closed, so a package's
        // declaration is never an environment author's to re-declare.
        const row = entry('capability')!;
        expect(row.allowRuntimeCreate).toBe(true);
        expect(row.allowEnvironmentOverlay).toBe(false);
        expect(row.filePatterns.length).toBeGreaterThan(0);
        const { getMetadataTypeSchema } = await import('@objectstack/spec/kernel');
        expect(getMetadataTypeSchema('capability')!.safeParse(CAPABILITY).success).toBe(true);
    });

    // ── /meta/types serves the registry descriptor ────────────────────────

    it('/meta/types serves the REAL registry descriptor, not a synthesised one', async () => {
        const { protocol } = makeProtocol(['capability']);

        const { entries } = await protocol.getMetaTypes();
        const descriptor = entries.find((e: any) => e.type === 'capability');

        expect(descriptor).toBeDefined();
        expect(descriptor.allowRuntimeCreate).toBe(true);
        expect(descriptor.domain).toBe('security');          // the synthesised branch said 'system'
        expect(descriptor.loadOrder).toBe(entry('capability')!.loadOrder); // …and 1000
        expect(descriptor.label).toBe('Capability');         // …and 'capability'
    });

    it('/meta/types emits a real JSON Schema, so the admin form is not a raw-JSON textarea', async () => {
        const { protocol } = makeProtocol(['capability']);

        const { entries } = await protocol.getMetaTypes();
        const descriptor = entries.find((e: any) => e.type === 'capability');

        expect(descriptor.schema).toBeDefined();
        expect(Object.keys(descriptor.schema.properties ?? {})).toEqual(
            expect.arrayContaining(['name', 'label', 'description', 'scope']),
        );
    });
});
