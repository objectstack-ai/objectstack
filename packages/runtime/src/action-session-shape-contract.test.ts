// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5697 / #5613] The action-body `ctx.session` consistency pin — what
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
 * Phase 2 has now landed on both sides: the spec half (#5779) added the
 * canonical `positions` key and demoted `roles` to a deprecated alias of it,
 * and the runtime half (#5613) made the producer DUAL-EMIT them. So the key-set
 * assertions below are no longer "what the builder happens to do" — they are
 * the deprecation window itself, pinned: both keys, same array, for exactly as
 * long as the ADR-0087 semantic migration `action-session-roles-to-positions`
 * says. When that window closes, `roles` comes out of the expectations here in
 * the same change that stops producing it.
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
        const positions = ['sales_rep', 'org_admin'];
        const built = build({ userId: 'u_1', tenantId: 'org_acme', positions });

        // FLIPPED by #5613's runtime half. Before it, the builder emitted only
        // the deprecated `roles`; it now emits the canonical `positions` too,
        // which is what opens the migration window the spec half (#5779)
        // declared. Both keys, or this is not a window.
        expect(Object.keys(built!).sort()).toEqual(['organizationId', 'positions', 'roles', 'userId']);

        // The window's load-bearing property: SAME VALUE under both spellings,
        // so migrating a body from `roles` to `positions` is a change of key
        // and nothing else. Asserted against `ec.positions` on both sides
        // rather than just key-to-key, so a builder that started deriving one
        // of them from something else could not satisfy it.
        expect((built as { positions?: string[] }).positions).toEqual(positions);
        expect((built as { roles?: string[] }).roles).toEqual(positions);
        expect((built as { roles?: string[] }).roles).toEqual((built as { positions?: string[] }).positions);

        // Non-strict parse: an UNDECLARED key would be silently stripped here,
        // so deep equality — not `.success` — is what proves the contract
        // covers everything the producer emits. This is also what proves the
        // spec half is actually in: before #5779 declared `positions`, a
        // dual-emitting builder would fail HERE (key stripped) rather than on
        // the key-set assertion above.
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
        // The v16-removed alias (#3280 / #3290) must not reappear.
        expect('tenantId' in built!).toBe(false);
    });

    it('carries `ec.positions` verbatim under BOTH the canonical and the deprecated spelling', () => {
        const positions = ['sales_rep', 'org_admin'];
        const built = build({ userId: 'u_1', positions });
        // Phase 2 (#5613) renamed the KEY; this pins that the VALUE is, and
        // stays, the ADR-0090 D3 vocabulary — so the rename is a rename and
        // not a semantic change smuggled inside one.
        expect((built as { positions?: string[] }).positions).toEqual(positions);
        expect((built as { roles?: string[] }).roles).toEqual(positions);
        expect(ActionSessionSchema.safeParse(built).success).toBe(true);
    });

    it('emits the alias only alongside the canonical key — never `roles` on its own', () => {
        // The direction that matters when the window CLOSES: the removal
        // deletes `roles` from the producer and from the expectation above,
        // and this assertion is what says the canonical key was never the
        // thing that could go missing. A builder that regressed to alias-only
        // would satisfy the value assertions and fail here.
        for (const ec of [
            { userId: 'u_1', positions: ['org_admin'] },
            { tenantId: 'org_acme', positions: ['org_admin'] },
            { userId: 'u_1', tenantId: 'org_acme', positions: ['org_admin'] },
        ]) {
            const keys = Object.keys(build(ec)!);
            expect(keys).toContain('positions');
            expect(keys).toContain('roles');
        }
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
        expect(Object.keys(built!).sort()).toEqual(['organizationId', 'positions', 'roles']);
    });

    it('omits BOTH position spellings for an empty or absent positions array', () => {
        // The dual emission is one conditional spread, so the "non-empty only"
        // semantics is identical for the canonical key and the alias — neither
        // appears as an empty array, and `'positions' in ctx.session` answers
        // false exactly when `'roles' in ctx.session` does.
        expect(Object.keys(build({ userId: 'u_1', positions: [] })!)).toEqual(['userId']);
        expect(Object.keys(build({ userId: 'u_1' })!)).toEqual(['userId']);
        // A non-array `positions` is ignored rather than passed through — the
        // declared `string[]` would otherwise be a lie the parse catches.
        expect(Object.keys(build({ userId: 'u_1', positions: 'org_admin' })!)).toEqual(['userId']);
        for (const ec of [{ userId: 'u_1', positions: [] }, { userId: 'u_1' }, { userId: 'u_1', positions: 'org_admin' }]) {
            expect(ActionSessionSchema.parse(build(ec))).toEqual(build(ec));
        }
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
        // `undefined` rather than `{}`. The third row is why neither position
        // spelling can ever appear alone — positions without a user and without
        // an org produce no session for them to appear on.
        expect(build(ec)).toBeUndefined();
    });
});
