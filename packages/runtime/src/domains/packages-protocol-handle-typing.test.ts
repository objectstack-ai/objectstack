// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13598 — the packages domain reaches the `protocol` service through a TYPED
 * handle, and the runtime capability probes survive that typing.
 *
 * Two halves, because the card has two halves that pull in opposite directions
 * and either one alone is a regression:
 *
 *  1. **Compile-time** (section 1). An undeclared key in one of this domain's
 *     request literals must be a COMPILE ERROR. That is the #11006 series' end
 *     state, and it stopped one seam short here.
 *  2. **Runtime** (section 2). ⛔ A host may occupy the `protocol` slot with a
 *     PARTIAL object. Tightening the type and then deleting a
 *     `typeof … === 'function'` probe would trade the compile-time improvement
 *     for a runtime crash, so section 2 drives a real dispatcher whose protocol
 *     brings none of the verbs and pins the documented 501s.
 *
 * ## The defect, measured on the base tree with the same instrument
 *
 * `deps.resolveService(context, 'protocol')` answers `any` — `protocol` is
 * deliberately unmapped in `ServiceSlotContracts`. Downstream of that seam
 * nothing compiled against a contract at all. Measured at `25a59bd`, injecting
 * one undeclared key (`bogusUndeclaredKey: true`) into the `saveMetaItem`
 * literal of the ADR-0045 visibility flip:
 *
 *   tsc --noEmit -p packages/runtime/tsconfig.json  ->  exit 0, ZERO diagnostics
 *
 * The same injection into the same literal after this change:
 *
 *   ... -> exit 2
 *   packages.ts(727,41): error TS2353: Object literal may only specify known
 *   properties, and 'bogusUndeclaredKey' does not exist in type
 *   '{ type: string; name: string; item: unknown; organizationId?: … }'
 *
 * Section 1 is that measurement made DURABLE. Each `@ts-expect-error` below is
 * itself checked: if the seam ever goes back to `any` the directive stops
 * matching an error and tsc reports TS2578 (unused directive) — so this file
 * cannot rot into a green no-op the way an assertion-only pin could.
 *
 * ⚠️ These directives are NOT phantom checks: `packages/runtime`'s BUILD
 * tsconfig excludes every `.test.ts` under `src`, but the sibling
 * `tsconfig.test.json`
 * compiles this layer and `package.json`'s `typecheck` script names it via
 * `check:test-typecheck`. This file carries no entry in
 * `test-typecheck-debt.json`, so any error it gains beyond the expected ones is
 * red on arrival.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Reverting `domains/packages.ts` to the base tree makes section 1 red as
 * TS2578 x4 (every directive becomes unused, because the `any` handle accepts
 * everything) — the reversal shape, not a plain "assertion failed", which is
 * why the directives are the pin and not `expectTypeOf` assertions. Section 2
 * is GREEN IN BOTH DIRECTIONS by construction: the probes it exercises are
 * unchanged by this card, so it is the control that says the 501s were never
 * bought with a behaviour change.
 */
import { describe, expect, it } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { PackagesDomainProtocol } from './packages.js';

// ---------------------------------------------------------------------------
// Section 1 — compile-time pins (never executed; the checker is the assertion)
// ---------------------------------------------------------------------------

/**
 * The literals this domain actually sends, spelled exactly as the handlers
 * spell them. A positive control for the four `@ts-expect-error`s below: if
 * this body ever stopped compiling, those directives could be "satisfied" by a
 * type that rejects everything, which pins nothing.
 */
function declaredKeysCompile(protocol: PackagesDomainProtocol) {
    return [
        // ADR-0045 visibility flip — `GET` half.
        protocol.getMetaItems?.({ type: 'app', packageId: 'crm', organizationId: 'org_1' }),
        // ADR-0045 visibility flip — `SAVE` half. `packageId` is declared
        // `nullable().optional()`, `actor` optional; both are load-bearing here.
        protocol.saveMetaItem?.({
            type: 'app',
            name: 'crm_console',
            item: { _unpublished: false },
            packageId: 'crm',
            organizationId: 'org_1',
            actor: 'u_publisher',
        }),
        // `applyPublishedSeeds`' seed body read-back, both attempts.
        protocol.getMetaItem?.({ type: 'seed', name: 'crm_seed', organizationId: 'org_1' }),
        protocol.getMetaItem?.({ type: 'seed', name: 'crm_seed' }),
        // The manifest-export read.
        protocol.getMetaItems?.({ type: 'view', packageId: 'crm', organizationId: undefined }),
    ];
}

/**
 * ⛔ THE PIN. Each directive must match a real diagnostic; an unused one is
 * TS2578 and fails `check:test-typecheck`.
 */
function undeclaredKeysAreCompileErrors(protocol: PackagesDomainProtocol) {
    return [
        protocol.saveMetaItem?.({
            type: 'app',
            name: 'crm_console',
            item: {},
            // @ts-expect-error [#13598] `packagId` is a misspelling of the
            // declared `packageId`. Through the pre-change `any` handle this
            // compiled, and the write silently landed unbound to the package.
            packagId: 'crm',
        }),
        protocol.getMetaItems?.({
            type: 'app',
            // @ts-expect-error [#13598] not a member of `GetMetaItemsRequest` —
            // the read has no `packageIds` plural.
            packageIds: ['crm'],
        }),
        // A misspelt VERB, which is what the untyped handle could never catch:
        // any property access on `any` is a property access on `any`.
        // @ts-expect-error [#13598] `rollbackToPackageCommit` has three `m`s in
        // neither of the two places this one puts them.
        protocol.rollbackToPackageCommmit?.({ commitId: 'c1' }),
        // ⛔ Every member is OPTIONAL and STAYS optional: a filled slot is not a
        // promise that the verb is there. This directive is what would go
        // unused if someone "simplified" the handle to a non-partial
        // `MetadataProtocol` — which is exactly the change that deletes the
        // reason the runtime probes in section 2 exist.
        // @ts-expect-error [#13598] possibly `undefined` — call it behind the probe.
        protocol.getMetaItems({ type: 'app' }),
    ];
}

// ---------------------------------------------------------------------------
// Section 2 — runtime control: the capability probes SURVIVE the typing
// ---------------------------------------------------------------------------

/** `/packages` state changes demand `manage_metadata` (#7033 / #7023). */
const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
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
                    registry: { getAllPackages: () => [], getPackage: () => undefined },
                });
            }
            return null;
        },
        context: { getService: () => null },
    };
    return new HttpDispatcher(kernel);
}

describe('#13598 · 1 · the compile-time pins are type-level only', () => {
    it('neither pin function is invoked — tsc is the assertion', () => {
        expect(typeof declaredKeysCompile).toBe('function');
        expect(typeof undeclaredKeysAreCompileErrors).toBe('function');
    });
});

describe('#13598 · 2 · a PARTIAL protocol host is still answered, never crashed', () => {
    const cases: Array<[string, string, string, string]> = [
        ['publish-drafts', '/crm/publish-drafts', 'POST', 'Draft publishing not supported'],
        ['discard-drafts', '/crm/discard-drafts', 'POST', 'Draft discarding not supported'],
        ['commits', '/crm/commits', 'GET', 'Commit history not supported'],
        ['commit revert', '/crm/commits/c1/revert', 'POST', 'Commit revert not supported'],
        ['rollback', '/crm/rollback', 'POST', 'Commit rollback not supported'],
        ['adopt-orphans', '/crm/adopt-orphans', 'POST', 'Orphan adoption not supported'],
        ['duplicate', '/crm/duplicate', 'POST', 'Package duplication not supported'],
    ];

    for (const [label, path, method, message] of cases) {
        it(`${label} answers 501 from the capability probe`, async () => {
            const result = await partialProtocolDoor().handlePackages(
                path, method, { commitId: 'c1', targetPackageId: 'crm_copy' }, {}, PKG_ADMIN(),
            );
            expect(result.response?.status).toBe(501);
            expect(JSON.stringify(result.response?.body)).toContain(message);
        });
    }
});
