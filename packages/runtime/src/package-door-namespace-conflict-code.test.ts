// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14748] `POST /api/v1/packages` answers a namespace collision with
 * `error.code: NAMESPACE_CONFLICT` — the wire half of registering the code in
 * `ERROR_CODE_LEDGER`.
 *
 * ## What changed, and why a pin belongs here rather than beside the throw
 *
 * `NamespaceConflictError` (`packages/objectql/src/registry.ts`) has carried
 * the ADR-0112 envelope (`code` + `status: 422`) since #14474, and
 * `packages/objectql/src/registry-namespace-install-gate.test.ts` asserts both
 * fields ON THE THROW. That is a different claim from this one. Until the
 * ledger row landed, `NAMESPACE_CONFLICT` was not an `ErrorCode` member, so the
 * #9106 door narrowing DEMOTED the spelling onto the wire's open `declaredCode`
 * sibling and put `VALIDATION_ERROR` — the member 422 derives through
 * `standardErrorCodeForHttpStatus` — in the closed `error.code` slot:
 *
 *   before: {"code":"VALIDATION_ERROR", "declaredCode":"NAMESPACE_CONFLICT", …}
 *   after:  {"code":"NAMESPACE_CONFLICT", …}   ← `declaredCode` gone: nothing to demote
 *
 * So the throw's envelope and the wire's envelope were two different bodies,
 * and a suite asserting the first could not see the second. Registration is
 * what closes that gap, and the gap is invisible to every existing suite. This
 * file is the assertion that it stays closed.
 *
 * ⭐ It is also the permanent answer to the reachability claim the removed
 * `pending-registration` row asserted without pinning — the row's `door:
 * 'dispatcher'` verdict rested on a temporary probe test that was never in the
 * tree (#14745 residue 2). This suite makes the same claim by DRIVING the door.
 *
 * ## What is real here and what is doubled
 *
 * Real: `HttpDispatcher.handlePackages` (the shipped route), the terminal
 * `catch` that answers `errorFromThrown(e, 500)`, `resolveThrownHttpError`'s
 * registered/demoted decision, `buildApiError`, and the actual `SchemaRegistry`
 * — so the refusal under test is the one production raises, from the same
 * `installPackage` call, not a hand-built stand-in carrying the same fields.
 *
 * Doubled: only the kernel's service lookup, which hands the door that
 * registry. There is no protocol service, so the install takes the documented
 * fallback limb (`registry.installPackage(manifest, settings)`) — the same
 * primitive the protocol limb calls underneath.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Removing `'NAMESPACE_CONFLICT'` from the `@objectstack/objectql` list in
 * `packages/spec/src/api/error-code-ledger.zod.ts` and rebuilding was predicted
 * to turn section 1 RED (`error.code` back to `VALIDATION_ERROR`, and
 * `declaredCode` reappearing) and section 2's registration assertion RED, while
 * leaving section 3 — an unregistered spelling at the same door — GREEN in both
 * directions, since nothing about that limb depends on this row. The measured
 * result is recorded in the PR body.
 *
 * ⛔ Never a bare `toThrow()` here: the door does not throw, it ANSWERS, and
 * the whole subject is what the answer carries.
 */

import { describe, it, expect } from 'vitest';
import {
    ApiErrorSchema,
    BaseResponseSchema,
    ErrorCode,
    envelopeViolations,
    standardErrorCodeForHttpStatus,
} from '@objectstack/spec/api';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from './http-dispatcher.js';

/**
 * [#7033 / #7023] `/packages` carries an anonymous-deny floor and every
 * state-changing route demands `manage_metadata`. Without a caller these cases
 * would stop at the 401 long before the install gate they are named after.
 */
const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

const manifest = (id: string, namespace: string) => ({ id, name: id, namespace, version: '1.0.0' });

/**
 * The door over a REAL registry. `collisionPolicy: 'error'` is the default
 * posture the gate refuses under; `OS_METADATA_COLLISION=warn` downgrades it,
 * which is `registry-namespace-install-gate.test.ts`'s territory, not this
 * file's.
 */
function makeDoor(registry: SchemaRegistry) {
    const kernel: any = {
        getService: (name: string) =>
            name === 'objectql' ? Promise.resolve({ registry }) : null,
        context: { getService: () => null },
    };
    return new HttpDispatcher(kernel);
}

function freshRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    return registry;
}

/** `POST /api/v1/packages` with `manifest` as the body, exactly as the route reads it. */
const install = (dispatcher: HttpDispatcher, body: unknown) =>
    dispatcher.handlePackages('', 'POST', body, {}, PKG_ADMIN());

/** Every assertion an error body must satisfy whatever produced it (mirrors the conformance suite). */
function expectConformantError(response: { status: number; body?: any } | undefined) {
    expect(response, 'the door produced no response').toBeTruthy();
    const body = response!.body;
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(false);
    const parsed = ApiErrorSchema.safeParse(body.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    return body.error as Record<string, unknown>;
}

describe('#14748 — the install-time namespace refusal carries its own code on the wire', () => {
    it('section 1: a second package claiming an owned namespace answers 422 NAMESPACE_CONFLICT', async () => {
        const registry = freshRegistry();
        const dispatcher = makeDoor(registry);

        const first = await install(dispatcher, manifest('com.acme.crm', 'crm'));
        expect(first.handled).toBe(true);
        expect(first.response?.status, 'the first install must SUCCEED, or the refusal below is vacuous').toBe(201);

        const refused = await install(dispatcher, manifest('com.beta.crm', 'crm'));
        expect(refused.handled).toBe(true);
        expect(refused.response?.status).toBe(422);

        const error = expectConformantError(refused.response);

        // ⭐ The one line this card exists for.
        expect(error.code).toBe('NAMESPACE_CONFLICT');

        // And the demote is GONE, not merely joined: with the code registered
        // there is nothing left for `demotedDeclaredCode` to carry, so the
        // sibling field is absent rather than duplicating `code`.
        expect(error.declaredCode).toBeUndefined();

        // The prose is unchanged by registration — this card added a ledger
        // row, it did not rewrite the sentence an operator reads.
        expect(error.message).toContain('Namespace conflict: namespace "crm"');
    });

    it('section 2: the code is a member of the closed vocabulary, and the status cannot have invented it', () => {
        // The registration itself, asserted against the union `ApiErrorSchema.code`
        // parses with — this is what section 1 depends on.
        expect(ErrorCode.safeParse('NAMESPACE_CONFLICT').success).toBe(true);

        // The control that makes section 1 discriminating: 422 does NOT derive
        // this member, so a body carrying it proves the PRODUCER's code was
        // carried through, never re-derived from the status.
        expect(standardErrorCodeForHttpStatus(422)).not.toBe('NAMESPACE_CONFLICT');
    });

    it('section 3: an UNREGISTERED spelling at the same door still demotes — the control', async () => {
        // Without this, section 1 would also be satisfied by a door that
        // carries every producer spelling verbatim, which is exactly the
        // pre-#9106 behaviour the narrowing removed. The registry is doubled
        // for this one case only: no shipped producer spells an unregistered
        // code at this door — the dispatcher-vocabulary gate exists to keep it
        // that way — so the limb has to be driven deliberately.
        const conflict = Object.assign(new Error('a tenant refusal'), {
            code: 'A_TENANT_SPELLING_NO_LEDGER_KNOWS',
            status: 422,
        });
        const dispatcher = makeDoor({
            installPackage: () => { throw conflict; },
            getPackage: () => undefined,
            getAllPackages: () => [],
        } as unknown as SchemaRegistry);

        const refused = await install(dispatcher, manifest('com.gamma.crm', 'crm'));
        const error = expectConformantError(refused.response);

        expect(refused.response?.status).toBe(422);
        expect(error.code).toBe(standardErrorCodeForHttpStatus(422));
        expect(error.code).not.toBe('A_TENANT_SPELLING_NO_LEDGER_KNOWS');
        expect(error.declaredCode).toBe('A_TENANT_SPELLING_NO_LEDGER_KNOWS');
    });
});
