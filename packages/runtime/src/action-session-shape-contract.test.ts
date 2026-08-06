// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5697] The action-body `ctx.session` consistency pin — what
 * `buildActionSession()` BUILDS against what `ActionSessionSchema`
 * (`@objectstack/spec/ui`) DECLARES.
 *
 * Phase 1 of #5613's contract-first ruling declared the shape without changing
 * it. A declaration that nothing executes against is exactly the state #5613
 * found (`actionContext` is a bare `any` at both dispatch sites, so the key set
 * reached no schema and no gate), so the declaration arrives with the test that
 * runs the real producer — the `hook-input-shape-contract.test.ts` shape from
 * #5668, one surface over.
 *
 * It lives in `packages/runtime` for the same reason that one lives in
 * `packages/objectql`: the pin must EXECUTE the producer, and `packages/spec`
 * cannot import the runtime without inverting the dependency.
 *
 * ## What each assertion is actually guarding
 *
 * `ActionSessionSchema` is deliberately NOT strict (it is a runtime shape the
 * platform hands a body — see the schema's docblock), so `safeParse().success`
 * alone would stay green for a builder that started emitting an undeclared key.
 * The load-bearing assertion is therefore `parse(built)` deep-equals `built`:
 * a non-strict parse STRIPS what it does not declare, so equality is the fact
 * that every key the builder produces is a key the contract names.
 */

import { describe, it, expect } from 'vitest';
import { ActionSessionSchema } from '@objectstack/spec/ui';

import { buildActionSession } from './action-execution.js';

/** `buildActionSession` never reads `deps`; the parameter is signature-only. */
const deps: any = { resolveService: () => undefined, getObjectQL: async () => undefined };
const build = (ec: unknown) => buildActionSession(deps, ec as any);

describe('#5697 — action `ctx.session` matches its declared contract', () => {
    it('builds exactly the declared keys, and the declaration covers all of them', () => {
        const built = build({ userId: 'u_1', tenantId: 'org_acme', positions: ['sales_rep', 'org_admin'] });

        // `roles`, not `positions` — the deprecated spelling is what the
        // builder emits today and what the contract therefore declares. This
        // assertion is the one #5613 phase 2 flips.
        expect(Object.keys(built!).sort()).toEqual(['organizationId', 'roles', 'userId']);

        // Non-strict parse: an UNDECLARED key would be silently stripped here,
        // so deep equality — not `.success` — is what proves the contract
        // covers everything the producer emits.
        expect(ActionSessionSchema.parse(built)).toEqual(built);
        expect(ActionSessionSchema.safeParse(built).success).toBe(true);
    });

    it('stringifies the ids the declaration types as strings', () => {
        // The builder wraps both in `String(...)`; a driver handing back a
        // numeric id would otherwise produce a session the contract rejects.
        const built = build({ userId: 42, tenantId: 7, positions: [] });
        expect(built).toEqual({ userId: '42', organizationId: '7' });
        expect(ActionSessionSchema.safeParse(built).success).toBe(true);
    });

    it('translates `ExecutionContext.tenantId` to the blessed `organizationId`', () => {
        const built = build({ tenantId: 'org_acme' });
        expect(built).toEqual({ organizationId: 'org_acme' });
        // The v11-removed alias (#3280 / #3290) must not reappear.
        expect('tenantId' in built!).toBe(false);
    });

    it('carries `ec.positions` verbatim under the deprecated `roles` spelling', () => {
        const positions = ['sales_rep', 'org_admin'];
        const built = build({ userId: 'u_1', positions });
        // Phase 2 (#5613) renames the KEY; this pins that the VALUE is, and
        // stays, the ADR-0090 D3 vocabulary — so the rename is a rename and
        // not a semantic change smuggled inside one.
        expect((built as { roles?: string[] }).roles).toEqual(positions);
        expect(ActionSessionSchema.safeParse(built).success).toBe(true);
    });
});

describe('#5697 — conditional-spread semantics: absent means the KEY is absent', () => {
    it('omits `organizationId` entirely when the context carries no tenant', () => {
        const built = build({ userId: 'u_1' });

        // MEASURED, not assumed, and the opposite of the hook path's #5668
        // case: there `input.id` is a PRESENT key holding `undefined` because
        // the engine builds it with a shorthand, so `'id' in input` answers
        // true. Here the builder uses a conditional SPREAD, so the key does not
        // exist at all. A body must not port an `in` test between the two.
        expect('organizationId' in built!).toBe(false);
        expect(Object.keys(built!)).toEqual(['userId']);
        expect(ActionSessionSchema.parse(built)).toEqual(built);
    });

    it('omits `userId` entirely for an org-scoped call with no user', () => {
        const built = build({ tenantId: 'org_acme', positions: ['org_admin'] });
        expect('userId' in built!).toBe(false);
        expect(Object.keys(built!).sort()).toEqual(['organizationId', 'roles']);
    });

    it('omits `roles` for an empty or absent positions array', () => {
        expect(Object.keys(build({ userId: 'u_1', positions: [] })!)).toEqual(['userId']);
        expect(Object.keys(build({ userId: 'u_1' })!)).toEqual(['userId']);
        // A non-array `positions` is ignored rather than passed through — the
        // declared `string[]` would otherwise be a lie the parse catches.
        expect(Object.keys(build({ userId: 'u_1', positions: 'org_admin' })!)).toEqual(['userId']);
    });
});

describe('#5697 — no identity envelope yields NO session, never an empty one', () => {
    it.each([
        ['undefined context', undefined],
        ['empty context', {}],
        ['positions only — no user, no org', { positions: ['org_admin'] }],
    ])('%s → undefined', (_label, ec) => {
        // #3712's distinction, on the action side: a body can tell "no identity
        // envelope at all" from "an anonymous caller" only because this is
        // `undefined` rather than `{}`. The third row is why `roles` can never
        // appear alone — positions without a user and without an org produce no
        // session for it to appear on.
        expect(build(ec)).toBeUndefined();
    });
});
