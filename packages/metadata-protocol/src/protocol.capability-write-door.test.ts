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
 * The three doors, and which one each case is about
 * ---------------------------------------------------------------------------
 * `capability` is CODE-ONLY (`allowRuntimeCreate: false` +
 * `allowOrgOverride: false`, ADR-0066 D1 — packages DEFINE capabilities). That
 * makes the ORDER inside `saveMetaItem` load-bearing, and this file pins the
 * order rather than asserting a 422 that the real code never reaches:
 *
 *   1. DEFAULT — #5086's code-only refusal fires FIRST: 403 `not_creatable`,
 *      on every kernel, before any schema is consulted. Nothing is stored.
 *   2. ESCAPE HATCH — with `OS_METADATA_WRITABLE=capability` (ADR-0005's one
 *      documented operator door) the write reaches the spec-conformance check,
 *      and THAT is where the new schema earns its keep: 422 `invalid_metadata`
 *      instead of storing the body verbatim.
 *   3. PACKAGE DECLARATION — untouched. `AppPlugin` registers stack
 *      `capabilities[]` through `registerInMemory` and the filesystem loader
 *      globs `filePatterns`; neither goes through `saveMetaItem`, so
 *      `bootstrapDeclaredCapabilities` still seeds `sys_capability` exactly as
 *      before. Asserted here as the "legal payload still gets in" half.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Two limbs, two predictions, both ordinary red. Each limb was rebuilt before
 * measuring — this package resolves `@objectstack/spec` from `dist`, so an
 * unbuilt limb measures the OLD spec and reports a false green (it did, once).
 *
 *   • **Limb 1 — delete the `capability` row from
 *     `DEFAULT_METADATA_TYPE_REGISTRY`.** Predicted: `isRuntimeCreateAllowed`
 *     falls into its "no static entry ⇒ synthesised as creatable" branch, so
 *     the refusal cases RESOLVE instead of rejecting and `/meta/types` shows
 *     the synthesised descriptor again. Measured: 7 red / 3 green, with the
 *     refusals failing as `promise resolved "{ success: true, …(4) }" instead
 *     of rejecting` — the open door, reproduced on demand.
 *
 *     One case failed in a SHARPER shape than predicted, and it is worth
 *     writing down rather than smoothing over: the first case (garbage body,
 *     no hatch) did not resolve — it turned into `422 invalid_metadata`,
 *     because with the registry row gone the write sails past the code-only
 *     gate and reaches the schema check, which is still bound and still
 *     rejects. So the two limbs are not merely additive: the schema binding is
 *     a genuine second line of defence behind the registry row, and only a
 *     body that is BOTH well-formed and unauthorised (case 2) isolates the row
 *     on its own.
 *
 *   • **Limb 2 — delete `capability: CapabilityDeclarationSchema` from
 *     `BUILTIN_METADATA_TYPE_SCHEMAS`.** Predicted: `resolveOverlaySchema`
 *     answers null, the escape-hatch case SAVES the garbage body instead of
 *     422-ing, and `/meta/types` emits an entry with no schema. Measured:
 *     3 red / 7 green, exactly those three, `promise resolved "{ success:
 *     true, …(4) }" instead of rejecting` and `expected undefined to be
 *     defined`.
 *
 * The green halves are not slack. A "fix" that made `capability` unwritable
 * under every condition would pass every refusal case here and fail the
 * behind-the-hatch save; a harness that could not save anything at all would
 * pass the refusals for the wrong reason. Both are excluded by cases that stay
 * green in the fixed tree and move in only one of the two limbs.
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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

function makeStubEngine(registeredTypes: string[] = []) {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const keyOf = (w: Record<string, unknown>) =>
        `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            for (const row of rows.values()) {
                if (opts.where.type !== undefined && row.type !== opts.where.type) continue;
                if (opts.where.name !== undefined && row.name !== opts.where.name) continue;
                if (opts.where.state !== undefined && row.state !== opts.where.state) continue;
                return row;
            }
            return null;
        },
        async find() { return []; },
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
        },
    };
    return { engine, rows };
}

function makeProtocol(registeredTypes?: string[], environmentId?: string) {
    const { engine, rows } = makeStubEngine(registeredTypes);
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

describe('#5961 — capability: the runtime write door is closed, and validated behind the hatch', () => {
    beforeEach(() => {
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
    });
    afterEach(() => {
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
    });

    // ── door 1: the default, and the acceptance criterion ─────────────────

    it('PUT /meta/capability/:name is refused 403 — nothing reaches sys_metadata', async () => {
        // The write that used to succeed with ANY body. `environmentId` is set
        // here and omitted in the next case on purpose: the refusal must not
        // depend on deployment topology.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({
                type: 'capability',
                name: 'billing.refund',
                item: NOT_A_CAPABILITY,
                organizationId: 'org_alpha',
            }),
        ).rejects.toMatchObject({ code: 'NOT_CREATABLE', status: 403 });

        // Refused, not "refused after writing". The stored row is the bug.
        expect(rows.size).toBe(0);
    });

    it('a WELL-FORMED declaration is refused too — the door is about WHO writes, not what', async () => {
        // The distinction that makes this a code-only kind rather than a
        // validation improvement: a perfectly valid capability is still not
        // authorable through the runtime API, because ADR-0066 D1 says
        // packages DEFINE capabilities. If this ever goes green, the kind has
        // silently become runtime-creatable.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({
                type: 'capability',
                name: 'billing.refund',
                item: CAPABILITY,
                organizationId: 'org_alpha',
            }),
        ).rejects.toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
        expect(rows.size).toBe(0);
    });

    it('the refusal does not depend on deployment topology (no environmentId either)', async () => {
        // #5086's finding: keying an authorization rule off `environmentId`
        // left the flagship showcase — a host config boots with NO
        // environmentId — running with the gate disengaged, on a surface whose
        // `PUT /api/v1/meta/*` is an END-USER door.
        const { protocol, rows } = makeProtocol();

        await expect(
            protocol.saveMetaItem({ type: 'capability', name: 'billing.refund', item: CAPABILITY }),
        ).rejects.toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
        expect(rows.size).toBe(0);
    });

    it('the refusal prescribes where to declare it instead', async () => {
        // `codeOnlySourceHint` reads the registry row's own `filePatterns[0]`,
        // so the remedy cannot drift from the entry. A refusal that only says
        // "no" sends the author looking for a workaround.
        const { protocol } = makeProtocol();

        await expect(
            protocol.saveMetaItem({ type: 'capability', name: 'billing.refund', item: CAPABILITY }),
        ).rejects.toThrow(/\.capability\./);
    });

    it('the plural spelling is judged by the same rule', async () => {
        // `STATIC_REGISTRY_TYPES` / `RUNTIME_CREATE_ALLOWED_TYPES` add
        // `SINGULAR_TO_PLURAL[type]` alongside each entry, so
        // `PUT /meta/capabilities/:name` must not be a second, open door.
        const { protocol, rows } = makeProtocol();

        await expect(
            protocol.saveMetaItem({ type: 'capabilities', name: 'billing.refund', item: CAPABILITY }),
        ).rejects.toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
        expect(rows.size).toBe(0);
    });

    // ── door 2: behind the operator escape hatch, the schema bites ────────

    it('with OS_METADATA_WRITABLE=capability, a garbage body is 422 — not stored verbatim', async () => {
        // THE regression this issue is about, isolated. Reaching the
        // spec-conformance check requires opening ADR-0005's documented hatch,
        // because the code-only refusal fires first — so this is the one place
        // the new schema binding is observable on the write path, and without
        // it this body was persisted.
        process.env.OS_METADATA_WRITABLE = 'capability';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        const { protocol, rows } = makeProtocol([], 'env_prod');

        // [#6190] The `organizationId` this case used to pass was incidental —
        // the door under test is the SCHEMA one, not the org one. Since the
        // #6190 ruling an org-scoped write of a non-org-overridable type is
        // refused BEFORE the schema is consulted (and `OS_METADATA_WRITABLE`
        // deliberately does not unlock the org dimension), so keeping the org
        // here would have turned this into a test of that other refusal and
        // left the 422 unmeasured. Env-wide keeps it pointed at the schema.
        // The hatch-plus-org interaction is pinned in
        // `protocol.org-scoped-write-refused.test.ts` (case R7).
        await expect(
            protocol.saveMetaItem({
                type: 'capability',
                name: 'billing.refund',
                item: NOT_A_CAPABILITY,
            }),
        ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(rows.size).toBe(0);
    });

    it('behind the same hatch a VALID declaration saves — the 422 is about the body', async () => {
        // The control that stops the case above from passing for the wrong
        // reason. Without it, a change that made `capability` unwritable under
        // every condition would look identical.
        process.env.OS_METADATA_WRITABLE = 'capability';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        const { protocol, rows } = makeProtocol([], 'env_prod');

        const result = await protocol.saveMetaItem({
            type: 'capability',
            name: 'billing.refund',
            item: CAPABILITY,
        });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });

    // ── door 3: the package-declaration channel, untouched ────────────────

    it('the package channel does not go through saveMetaItem at all', async () => {
        // `AppPlugin` calls `metadata.registerInMemory('capability', name, item)`
        // for every stack-declared capability, and the filesystem loader globs
        // `filePatterns` — neither reaches the gate above, which is why
        // `allowRuntimeCreate: false` closes the ADMIN door without breaking
        // the one ADR-0066 D1 actually prescribes. Asserted structurally: the
        // registry row is what the loader reads, and it must carry patterns.
        const row = entry('capability')!;
        expect(row.allowRuntimeCreate).toBe(false);
        expect(row.filePatterns.length).toBeGreaterThan(0);

        // And the declaration itself is spec-valid, so the seeding pass that
        // reads it back (`bootstrapDeclaredCapabilities`) is being handed a
        // body this schema accepts rather than one it would now reject.
        const { getMetadataTypeSchema } = await import('@objectstack/spec/kernel');
        expect(getMetadataTypeSchema('capability')!.safeParse(CAPABILITY).success).toBe(true);
    });

    // ── /meta/types no longer publishes a fiction ─────────────────────────

    it('/meta/types serves the REAL registry descriptor, not a synthesised one', async () => {
        const { protocol } = makeProtocol(['capability']);

        const { entries } = await protocol.getMetaTypes();
        const descriptor = entries.find((e: any) => e.type === 'capability');

        expect(descriptor).toBeDefined();
        // The three tells of the synthesised branch, each asserted against the
        // value the registry actually declares.
        expect(descriptor.allowRuntimeCreate).toBe(false);   // was: true
        expect(descriptor.domain).toBe('security');          // was: 'system'
        expect(descriptor.loadOrder).toBe(entry('capability')!.loadOrder); // was: 1000
        expect(descriptor.label).toBe('Capability');         // was: 'capability'
    });

    it('/meta/types emits a real JSON Schema, so the admin form is not a raw-JSON textarea', async () => {
        // The read-side consequence of the missing schema binding. The engine
        // picks its controls from this; with no schema it falls back to a free
        // text area, which is how arbitrary JSON got authored in the first
        // place.
        const { protocol } = makeProtocol(['capability']);

        const { entries } = await protocol.getMetaTypes();
        const descriptor = entries.find((e: any) => e.type === 'capability');

        expect(descriptor.schema).toBeDefined();
        expect(Object.keys(descriptor.schema.properties ?? {})).toEqual(
            expect.arrayContaining(['name', 'label', 'description', 'scope']),
        );
    });
});
