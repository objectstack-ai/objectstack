// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15238 — the `/ui`, `/meta` and `/mcp` domains reach the `protocol` service
 * through TYPED handles, and the runtime capability probes survive that typing.
 *
 * The template is `packages-protocol-handle-typing.test.ts` beside this file
 * (#13598), and this is that instrument applied to the three domains the
 * finding named. Two halves, because the card has two halves that pull in
 * opposite directions and either one alone is a regression:
 *
 *  1. **Compile-time** (section 1). An undeclared key — or a misspelt verb — in
 *     one of these domains' request literals must be a COMPILE ERROR. That is
 *     the #11006 series' end state, and it stopped three seams short here.
 *  2. **Runtime** (section 2). ⛔ A host may occupy the `protocol` slot with a
 *     PARTIAL object. Tightening the types and then deleting a
 *     `typeof … === 'function'` probe would trade the compile-time improvement
 *     for a runtime crash, so section 2 drives real dispatcher routes whose
 *     protocol brings none of the verbs and pins the documented answers.
 *
 * ## The defect, measured on the base tree with the card's own instrument
 *
 * `deps.resolveService(context, 'protocol')` answers `any` — `protocol` is
 * deliberately unmapped in `ServiceSlotContracts`. Measured at `1008be3b`,
 * per non-test file under `packages/runtime/src`:
 *
 *     grep -c "resolveService([^,]*, 'protocol'"   |   grep -c "protocol as any\|protocol: any"
 *     domains/meta.ts        9 sites   4 casts
 *     domains/mcp.ts         1 site    1 cast
 *     domains/ui.ts          1 site    0 casts
 *     domains/packages.ts    1 site    0 casts     <- the CONTROL, fixed by #13598
 *
 * The `packages.ts` row is the control: the same instrument on the file that
 * was already repaired, whose single remaining site is the one inside its
 * narrowing helper. Without it the other three counts say nothing about
 * whether the shape is repairable.
 *
 * Section 1 makes the repair durable. Each `@ts-expect-error` below is itself
 * checked: if a seam goes back to `any` the directive stops matching an error
 * and tsc reports TS2578 (unused directive) — so this file cannot rot into a
 * green no-op the way an assertion-only pin could.
 *
 * ⚠️ These directives are NOT phantom checks: `packages/runtime`'s BUILD
 * tsconfig excludes every `.test.ts` under `src`, but the sibling
 * `tsconfig.test.json` compiles this layer and `package.json`'s `typecheck`
 * script names it via `check:test-typecheck`. This file carries no entry in
 * `test-typecheck-debt.json`, so any error it gains beyond the expected ones is
 * red on arrival.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Reverting the three domain files to the base tree makes section 1 red as
 * TS2578 x12 (every directive becomes unused, because an `any` handle accepts
 * everything) — the reversal shape, not a plain "assertion failed", which is
 * why the directives are the pin and not `expectTypeOf` assertions. Section 2
 * is GREEN IN BOTH DIRECTIONS by construction: the probes it exercises are
 * unchanged by this card, so it is the control that says the answers below
 * were never bought with a behaviour change.
 */
import { describe, expect, it } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { UiDomainProtocol } from './ui.js';
import type { MetaDomainProtocol } from './meta.js';
import type { McpMergedMetadataRead } from './mcp.js';

// ---------------------------------------------------------------------------
// Section 1 — compile-time pins (never executed; the checker is the assertion)
// ---------------------------------------------------------------------------

/**
 * The literals these domains actually send, spelled exactly as the handlers
 * spell them. A positive control for the `@ts-expect-error`s below: if this
 * body ever stopped compiling, those directives could be "satisfied" by a type
 * that rejects everything, which pins nothing.
 */
function declaredKeysCompile(
    ui: UiDomainProtocol,
    meta: MetaDomainProtocol,
    mcp: McpMergedMetadataRead,
) {
    return [
        // `/ui/view/:object[/:type]` — the one call in the whole domain.
        ui.getUiView?.({ object: 'account', type: 'list' }),
        ui.getUiView?.({ object: 'account', type: 'form' }),
        // `/meta` reads.
        meta.getMetaTypes?.({}),
        meta.getMetaItems?.({ type: 'app', packageId: 'crm', organizationId: 'org_1', previewDrafts: true }),
        meta.getMetaItem?.({ type: 'object', name: 'account', organizationId: 'org_1' }),
        meta.getMetaItem?.({ type: 'app', name: 'crm', packageId: 'crm', organizationId: undefined, previewDrafts: false }),
        meta.getMetaItemLayered?.({ type: 'view', name: 'account_list', organizationId: 'org_1' }),
        // `/meta` write — `writeFace` is a DECLARED closed set and
        // `'meta-dispatch'` is this door's member of it.
        meta.saveMetaItem?.({
            type: 'app',
            name: 'crm_console',
            item: { _unpublished: false },
            organizationId: 'org_1',
            writeFace: 'meta-dispatch',
            packageId: 'crm',
        }),
        // The two undeclared-request verbs: the NAME is bought, the request
        // shape is honestly still `any` (nothing declares one).
        meta.listDrafts?.({ packageId: 'crm', type: 'view', organizationId: 'org_1' }),
        meta.migrateStoredMetadata?.({ apply: false, types: ['view'], actor: 'u_1 (test)' }),
        meta.getProjectId?.(),
        // The `/mcp` merged skill read.
        mcp.getMetaItems?.({ type: 'skill' }),
    ];
}

/**
 * ⛔ THE PIN. Each directive must match a real diagnostic; an unused one is
 * TS2578 and fails `check:test-typecheck`.
 */
function undeclaredKeysAreCompileErrors(
    ui: UiDomainProtocol,
    meta: MetaDomainProtocol,
    mcp: McpMergedMetadataRead,
) {
    return [
        // ── /ui ──────────────────────────────────────────────────────────
        ui.getUiView?.({
            // @ts-expect-error [#15238] `objectName` is not a member of the
            // declared `GetUiViewRequest`; the key is `object`. Through the
            // pre-change `any` handle this compiled and served nothing.
            objectName: 'account',
            type: 'list',
        }),
        // @ts-expect-error [#15238] `type` is a DECLARED closed set
        // (`'list' | 'form'`) — `'grid'` is not in it.
        ui.getUiView?.({ object: 'account', type: 'grid' }),
        // @ts-expect-error [#15238] a misspelt VERB, which is what the untyped
        // handle could never catch: any property access on `any` is a property
        // access on `any`.
        ui.getUiVeiw?.({ object: 'account', type: 'list' }),
        // ⛔ Every member is OPTIONAL and STAYS optional: a filled slot is not a
        // promise that the verb is there. This directive is what would go
        // unused if someone "simplified" the handle to a non-partial
        // `MetadataProtocol` — exactly the change that deletes the reason the
        // runtime probes in section 2 exist.
        // @ts-expect-error [#15238] possibly `undefined` — call it behind the probe.
        ui.getUiView({ object: 'account', type: 'list' }),

        // ── /meta ────────────────────────────────────────────────────────
        meta.getMetaItem?.({
            type: 'object',
            name: 'account',
            // @ts-expect-error [#15238] `packagId` is a misspelling of the
            // declared `packageId`. Through the pre-change `any` handle this
            // compiled and the read silently ran unscoped.
            packagId: 'crm',
        }),
        meta.getMetaItems?.({
            type: 'app',
            // @ts-expect-error [#15238] not a member of `GetMetaItemsRequest` —
            // the list read has no `packageIds` plural.
            packageIds: ['crm'],
        }),
        meta.saveMetaItem?.({
            type: 'app',
            name: 'crm_console',
            item: {},
            // @ts-expect-error [#15238] `writeFace` is a DECLARED closed set;
            // this door's member is `'meta-dispatch'` exactly.
            writeFace: 'meta-dispatchh',
        }),
        // @ts-expect-error [#15238] a misspelt VERB on the undeclared-request
        // half of the ledger: the request shape is still `any`, but the NAME is
        // now checked — which is the whole win for these three verbs.
        meta.migrateStoredMetadta?.({ apply: true }),
        // @ts-expect-error [#15238] `getMetaItemLayered` was reached through a
        // `(protocol as any)` cast before this card; the cast is gone and the
        // declared request is enforced — `nmae` is not `name`.
        meta.getMetaItemLayered?.({ type: 'view', nmae: 'account_list' }),
        // @ts-expect-error [#15238] possibly `undefined` — the `/meta` probes
        // stay, so every member stays optional here too.
        meta.getMetaTypes({}),

        // ── /mcp ─────────────────────────────────────────────────────────
        mcp.getMetaItems?.({
            // @ts-expect-error [#15238] `getMetaItems` takes `type`, not
            // `types`. The second handle in this file was annotated `any` while
            // its own `McpMergedMetadataRead` sat one seam away, so this key
            // compiled at the resolve site.
            types: ['skill'],
        }),
        // @ts-expect-error [#15238] the merged read is `Pick`ed to ONE verb —
        // `getMetaItem` (singular) is deliberately not on this handle.
        mcp.getMetaItem?.({ type: 'skill', name: 'a' }),
    ];
}

// ---------------------------------------------------------------------------
// Section 2 — runtime control: the capability probes SURVIVE the typing
// ---------------------------------------------------------------------------

/** `/meta/_drafts` and `/meta/_migrate-stored` gate BEFORE resolving the protocol. */
const META_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_meta_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/**
 * A host that OCCUPIES the `protocol` slot with an object carrying none of the
 * verbs — the documented reason every call site probes rather than calls. Not
 * an empty slot: an empty slot would take the `!protocol` arm of each guard and
 * prove nothing about the `typeof … === 'function'` half.
 */
function partialProtocolDoor() {
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return Promise.resolve({ someUnrelatedVerb: () => undefined });
            if (name === 'objectql') {
                return Promise.resolve({
                    registry: { getAllPackages: () => [], getPackage: () => undefined, getObject: () => undefined },
                });
            }
            return null;
        },
        context: { getService: () => null },
    };
    return new HttpDispatcher(kernel);
}

describe('#15238 · 1 · the compile-time pins are type-level only', () => {
    it('neither pin function is invoked — tsc is the assertion', () => {
        expect(typeof declaredKeysCompile).toBe('function');
        expect(typeof undeclaredKeysAreCompileErrors).toBe('function');
    });
});

describe('#15238 · 2 · a PARTIAL protocol host is still answered, never crashed', () => {
    it('/ui/view answers 501 from the capability probe, not a crash', async () => {
        const result = await partialProtocolDoor().handleUi('/view/account/list', {}, META_ADMIN());
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(501);
    });

    it('/meta/_drafts answers the documented 501 from its probe', async () => {
        const result = await partialProtocolDoor().handleMetadata(
            '/_drafts', META_ADMIN(), 'GET', undefined, {},
        );
        expect(result.response?.status).toBe(501);
        expect(JSON.stringify(result.response?.body)).toContain('Draft listing not supported');
    });

    it('/meta/_migrate-stored answers the documented 501 from its probe', async () => {
        const result = await partialProtocolDoor().handleMetadata(
            '/_migrate-stored', META_ADMIN(), 'POST', { apply: false }, {},
        );
        expect(result.response?.status).toBe(501);
        expect(JSON.stringify(result.response?.body)).toContain('Stored-metadata migration not supported');
    });

    it('/meta type listing falls through the probe to its own default', async () => {
        const result = await partialProtocolDoor().handleMetadata('', META_ADMIN(), 'GET', undefined, {});
        expect(result.handled).toBe(true);
        expect(result.response?.status).not.toBe(500);
    });
});
