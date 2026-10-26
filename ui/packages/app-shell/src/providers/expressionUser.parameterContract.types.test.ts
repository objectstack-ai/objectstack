/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type-level pin for objectui#6559 — `buildExpressionUser`'s PARAMETER is the
 * session contract, so every call site is checked against it.
 *
 * ## What the defect was
 *
 * objectui#6551 narrowed the CAST the normaliser read its input through, so the
 * module began DECLARING what a signed-in session is (`id` / `name` / `email`
 * required, mirroring the spec's `AuthUser`). The parameter behind that cast
 * stayed `unknown`, so the declaration bound nothing: every call site satisfied
 * it vacuously, and `buildExpressionUser({ name: 'B', email: 'b@c.d' })` still
 * compiled. A declaration nothing checks is indistinguishable from no
 * declaration — AGENTS.md #0.1. That gap is what this card closes, by moving
 * the declaration from the cast onto the parameter.
 *
 * Maintainer ruling 2026-08-27 (option A): the parameter narrows to
 * `ExpressionUserSession | null | undefined`; the tightening is compile-time
 * only and no runtime behaviour moves. ⛔ B (keep `unknown`) and ⛔ C (a second,
 * wider entry point) were declined.
 *
 * ## Why the instrument is `tsc` and not a test run
 *
 * Every assertion here is erased before vitest sees it, so a green test run
 * proves nothing about any of them. What makes them a pin is
 * `packages/app-shell/tsconfig.test.json`, which compiles every
 * `src/**\/*.test.ts` in the package and is chained off the package's
 * `type-check` script (the script CI's `Type Check` job runs, and
 * `scripts/check-type-check-coverage.mjs` enforces the chaining). The package's
 * BUILD tsconfig excludes `**\/*.test.ts`, so without that project these
 * directives would be read by no compiler at all — failing neither when the
 * error they name disappears nor when it was never there, which is
 * objectui#3009's failure verbatim.
 *
 * Two instruments, because they fail in different directions:
 *
 * - `Assert<Equal<…>>` on the parameter type reds if the parameter becomes
 *   anything other than the declared contract — including `unknown`.
 * - `@ts-expect-error` reds via TS2578 ("unused '@ts-expect-error' directive")
 *   the moment a refusal stops biting. A widened parameter accepts these
 *   arguments again, the suppressed error goes away, and the directive itself
 *   becomes the error.
 *
 * ## Freshness is not the contract
 *
 * A FRESH object literal is refused by excess-property checking regardless of
 * what the parameter declares, so a pin routed only through one measures
 * freshness rather than the contract. Every refusal case below is therefore
 * routed through a NON-FRESH value — a `const` of a declared type, passed by
 * name. `UNCHECKED` in particular is the whole card in one line: an `unknown`
 * a caller has not narrowed, which is precisely what all four production call
 * sites were free to pass before this change.
 *
 * ## No build artifact sits between the edit and these assertions
 *
 * The import below is a relative path to the SOURCE module, and that module is
 * a LEAF that imports nothing, so no workspace `dist` can go stale on the path
 * and degrade a type to `any`. `AuthUser` comes from the PUBLISHED
 * `@objectstack/spec` typings; the `IsAny` guards below fail loudly if either
 * import stops resolving, rather than letting a silent `any` turn a refusal
 * case green.
 */
import { describe, it, expect } from 'vitest';
import type { AuthUser } from '@object-ui/auth';
import type { AuthUser as SpecAuthUser } from '@objectstack/spec/contracts';

import { buildExpressionUser, type ExpressionUserSession } from './expressionUser';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/** What the function actually declares it accepts. */
type Param = Parameters<typeof buildExpressionUser>[0];

// ── The pin, stated directly on the parameter ───────────────────────────────
// Guard against the probe lying: were either type `any`, every assertion here
// would pass while proving nothing.
type _ParamNotAny = Assert<Equal<IsAny<Param>, false>>;
type _SessionNotAny = Assert<Equal<IsAny<ExpressionUserSession>, false>>;
type _AuthUserNotAny = Assert<Equal<IsAny<AuthUser>, false>>;
type _SpecAuthUserNotAny = Assert<Equal<IsAny<SpecAuthUser>, false>>;

/**
 * The card, as one type equation. `unknown` — the shape this parameter carried
 * before objectui#6559 — is not equal to the contract, so re-widening reds
 * HERE first, with the parameter named in the diagnostic.
 */
type _ParamIsTheDeclaredContract = Assert<
  Equal<Param, ExpressionUserSession | null | undefined>
>;
type _ParamIsNoLongerUnknown = Assert<Equal<Equal<Param, unknown>, false>>;

/**
 * The narrowing did not overshoot. Every production call site passes
 * `useAuth().user`, typed `AuthUser | null` by `@object-ui/auth`, and the
 * signed-out branch is reached by passing `null`. Without these, "reds when the
 * parameter widens" would also be satisfied by a parameter that refuses
 * everything, which is the other way to disagree with the contract.
 *
 * ⚠️ The control is `@object-ui/auth`'s `AuthUser`, NOT the spec's, and the
 * difference is load-bearing rather than a spelling choice. The spec's
 * `AuthUser` is an `interface` with no index signature, and TypeScript infers
 * an implicit index signature for type ALIASES only — never for interfaces — so
 * the bare spec principal is not assignable to a contract that declares
 * `[key: string]: unknown`. `@object-ui/auth`'s `AuthUser` extends it and adds
 * that index signature (better-auth projects an app's custom user columns onto
 * the object), which is exactly why the four production call sites type
 * cleanly. Measured: using the spec interface here produced
 * `TS2345: Argument of type 'AuthUser' is not assignable`, which would have
 * been a false alarm about the parameter and is really a fact about interfaces.
 */
type _BrowserPrincipalIsAcceptedInput = Assert<Equal<AuthUser extends Param ? true : false, true>>;
type _NullIsAcceptedInput = Assert<Equal<null extends Param ? true : false, true>>;
type _UndefinedIsAcceptedInput = Assert<Equal<undefined extends Param ? true : false, true>>;
type _UncheckedIsNotAcceptedInput = Assert<Equal<unknown extends Param ? true : false, false>>;

/**
 * The refusal cases as a CALLER writes them, all routed through non-fresh
 * values. Assignability above is the contract; a call expression is the
 * authoring surface, and excess-property freshness makes the two differ often
 * enough to pin both.
 */
const UNCHECKED: unknown = { id: 'u_1', name: 'Ada', email: 'a@e.d' };
const NO_ID: { name: string; email: string } = { name: 'B', email: 'b@c.d' };
const OPTIONAL_ID: { id?: string; name: string; email: string } = {
  id: 'u_1',
  name: 'B',
  email: 'b@c.d',
};
const PRINCIPAL: AuthUser = { id: 'u_1', name: 'Ada', email: 'a@e.d' };
/** The signed-out arm the same call sites pass — `useAuth().user` is nullable. */
const NOBODY: AuthUser | null = null;

describe('objectui#6559 — the parameter is the session contract, checked at every call site', () => {
  it('refuses an input the caller has not narrowed', () => {
    // THE CARD. Before this change the parameter was `unknown` and this
    // compiled — which is why all four production call sites satisfied
    // objectui#6551's declaration vacuously. `UNCHECKED` is a const, not a
    // literal, so this is the parameter refusing it and not freshness.
    // @ts-expect-error objectui#6559 — `unknown` is not a signed-in session.
    const fromUnchecked = buildExpressionUser(UNCHECKED);

    // The runtime is unmoved by the narrowing (the ruling: compile-time only),
    // so the refused input still normalises exactly as it always did.
    expect(fromUnchecked).toMatchObject({ id: 'u_1', name: 'Ada', email: 'a@e.d' });
  });

  it('refuses a session missing a key the contract declares required', () => {
    // Non-fresh, and missing `id` — the exact input objectui#6551 declared
    // illegitimate and could not refuse. `name`/`email` are pinned by the type
    // equation above; this is the call-expression half.
    // @ts-expect-error objectui#6559 — a session with no `id` is not signed in.
    const built = buildExpressionUser(NO_ID);

    // ⛔ NOT a fallback. `id: u.id ?? null` is the REJECTED shape (triage
    // ruling 2026-08-26, carried into objectui#6559's dispatch): a lenient
    // default in the CONSUMER is what AGENTS.md #0.1 forbids, and it silently
    // equates "signed in, no id" with "signed out". The honest answer is that
    // the type refuses the input; nothing was added below it to paper over one.
    expect(built.id).toBeUndefined();
    expect(built.id).not.toBeNull();
  });

  it('refuses a session whose `id` is merely optional', () => {
    // The producer-side spelling of the same defect: a caller whose own type
    // makes `id` optional cannot satisfy the contract even when the value is
    // present, because the CONTRACT is what the compiler checks, not the value.
    // @ts-expect-error objectui#6559 — `id?: string` is wider than the contract.
    const built = buildExpressionUser(OPTIONAL_ID);

    expect(built.id).toBe('u_1');
  });

  it('accepts what the production call sites actually pass', () => {
    // The overshoot control, on the real production input type. All four call
    // sites pass `useAuth().user`, typed `AuthUser | null`; both arms are here.
    const signedIn = buildExpressionUser(PRINCIPAL);
    const signedOut = buildExpressionUser(NOBODY);

    expect(signedIn.id).toBe('u_1');
    expect(signedOut.id).toBeNull();
  });
});
