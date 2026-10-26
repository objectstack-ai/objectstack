/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The predicate-evaluation identity `ExpressionProvider` binds as
 * `current_user` / `ctx.user` / `os.user`.
 *
 * Extracted from `AppContent`'s body in objectui#5424 so the SHAPE it
 * advertises is assertable on its own — the defect it carried was a key that
 * was always `undefined`, which no render-level assertion can see.
 *
 * ## Why it lives HERE and not in `AppContent` (objectui#6515)
 *
 * It sat in `console/AppContent.tsx`, and `AppContent` `lazy()`-loads the views
 * that also mount an `ExpressionProvider` — `views/RecordFormPage.tsx` is one.
 * A view importing the normaliser from its old home would create a STATIC edge
 * from the lazily-split chunk back into the console module it was split out of,
 * which is precisely what `scripts/check-eager-closure-budget.mjs` weighs. So
 * the site that most needed the shared normaliser was the one site that could
 * not afford to import it, and it hand-rolled the descriptor instead — missing
 * `id` and `isPlatformAdmin`, the two roots real predicates name
 * (`ctx.user.isPlatformAdmin == true` gates `sys_environment`'s "Change Plan
 * (admin)" action; `record.id == ctx.user.id` is the shape `sys_user`'s own
 * gates use). An absent key is not `false`: it makes the predicate FAULT, and a
 * faulting visibility predicate fails OPEN (`evaluateVisibility`), so the gate
 * silently did not bite.
 *
 * This module is a LEAF — it imports nothing — so every mount site can reach it
 * without dragging a chunk along, and it sits beside the `ExpressionProvider`
 * it feeds rather than beside one of its callers. `AppContent` and the package
 * index both re-export the name, so nothing published moved.
 *
 * ## Shape notes
 *
 * `roles` is deliberately ABSENT, not merely empty. It used to be forwarded as
 * `roles: (user as any).roles`, and the protocol-17 session face emits no
 * `roles` key at all (framework ADR-0090 D3 renamed it to `positions` with no
 * deprecation window — measured in objectui#5389), so the key reached every CEL
 * predicate as `undefined`: an author writing `'manager' in current_user.roles`
 * got a shape that answered, wrongly, rather than one that was plainly not
 * there. `positions` below is the published spelling and carries the same
 * names. Not paired as a fallback — that is what ADR-0090 D3 forbids
 * (`packages/auth/src/types.ts`).
 *
 * The signed-out branch never had `roles` either, so removing it also makes the
 * two branches agree on one shape. Both branches carry `isPlatformAdmin` and
 * `positions` for the same reason: a predicate naming either must evaluate to
 * FALSE, not fault.
 *
 * `id` is on BOTH branches for that same reason, and it is the last place the
 * two disagreed (objectui#6534). It used to be signed-in-only, so
 * `'id' in buildExpressionUser(null)` was `false` and a gate naming
 * `ctx.user.id` / `current_user.id` / `os.user.id` faulted for every signed-out
 * visitor — measured at a real mount site in
 * `expressionUser.mountParity.test.tsx`, where the excluded field was PRESENT
 * in the schema handed to `ObjectForm`. Anonymous now answers `null`, which is
 * a VALUE a CEL author can compare against, so the predicate resolves FALSE
 * instead of faulting.
 *
 * ## What this module does NOT decide
 *
 * Fail-open on a predicate that DOES fault stays deliberate policy
 * (objectui#6443 / #6487 / #6445): an unevaluable `visible` still renders, and
 * that verdict is `evaluateVisibility`'s to make, not this normaliser's. Every
 * shape rule above works the same way — it removes REASONS to fault, so fewer
 * predicates ever reach that policy. None of them touches what the policy does
 * once one has.
 */
/**
 * The signed-in session principal this normaliser MIRRORS — the declared shape
 * of what its production callers hand it (objectui#6551).
 *
 * `id`, `name` and `email` are REQUIRED because the contract they mirror
 * declares them required. Every production input is `useAuth().user`, whose
 * type is `@object-ui/auth`'s `AuthUser`; that interface EXTENDS the spec's
 * `AuthUser` (`@objectstack/spec/contracts`), which declares
 * `id: string; email: string; name: string` and makes only `positions` and
 * `tenantId` optional. This cast used to write all three as `id?` / `name?` /
 * `email?`, which is WIDER than the contract it mirrors: it declared a session
 * missing any of them to be a legitimate input, while the signed-in branch
 * below forwards those three keys RAW. So the declaration said
 * `buildExpressionUser({ name: 'B', email: 'b@c.d' })` was fine and the code
 * answered `{ id: undefined, … }` — present-and-always-`undefined`, which is
 * exactly the shape objectui#5424 removed `roles` from this same object for
 * ("the shape that teaches the wrong thing") and the one objectui#6534 refused
 * for the anonymous branch, one key over.
 *
 * Nothing reachable today hands this function a session without `id` — the
 * better-auth principal above always carries one — so no runtime behaviour
 * moves here and none was made to move: the defect was that the declaration
 * LIED about the contract, not that a user could reach it. What refuses the
 * widening from coming back is the compiler, via
 * `expressionUser.sessionContract.types.test.ts`.
 *
 * ## This type is the PARAMETER, not a cast (objectui#6559)
 *
 * objectui#6551 wrote the shape above but left the parameter `unknown`, with
 * the narrowing applied INSIDE as `user as ExpressionUserSession | …`. A cast
 * binds nothing: every call site satisfied the declaration vacuously, and
 * `buildExpressionUser({ name: 'B', email: 'b@c.d' })` still compiled. A
 * declaration nothing checks is indistinguishable from no declaration at all
 * (AGENTS.md #0.1), which is why the shape above and the signature below are
 * now the SAME statement rather than two that merely agree.
 *
 * Maintainer ruling 2026-08-27 (option A): the parameter narrows to
 * `ExpressionUserSession | null | undefined`. It is a tightening of a
 * package-entry export, so an external caller passing an unchecked value gets a
 * compile error on upgrade — accepted, because such a call was never
 * contract-conformant. All four in-repo production call sites pass
 * `useAuth().user` (`AuthUser | null`) and type cleanly, measured: two in
 * `console/AppContent.tsx`, one in `views/RecordFormPage.tsx`, one in
 * `apps/console`'s `InternalFormRoute.tsx`. Runtime output is unchanged for
 * every input any producer can supply. ⛔ B (keep `unknown`) and ⛔ C (a second,
 * wider entry point) were declined. The pin is
 * `expressionUser.parameterContract.types.test.ts`.
 *
 * ⛔ Not a fallback. `id: u.id ?? null` was the rejected shape (triage ruling,
 * 2026-08-26): it puts a lenient default in the CONSUMER, which AGENTS.md #0.1
 * forbids and which objectui#6534 shipped a scope fence against, and it
 * silently equates "signed in, no id" with "signed out". A producer with no
 * `id` is wrong AT THE PRODUCER, and the type is where that is now said.
 *
 * The index signature stays: better-auth projects an app's custom user columns
 * onto this object and no local type can enumerate them — the same reason
 * `@object-ui/auth`'s own `AuthUser` carries one, and the route by which
 * `isPlatformAdmin` and `positions` are read below. `role` stays OPTIONAL: it
 * is not a spec key at all, it is the display-only field `@object-ui/auth`
 * adds, so `?? 'user'` below is its declared default rather than a fallback
 * around a broken producer.
 */
export type ExpressionUserSession = {
  id: string;
  name: string;
  email: string;
  role?: string;
  [key: string]: unknown;
};

export function buildExpressionUser(
  user: ExpressionUserSession | null | undefined,
): Record<string, unknown> {
  if (!user) {
    return {
      // `null`, not absent — objectui#6534. An ABSENT key is not `false`: it
      // makes `ctx.user.id == '…'` FAULT, and a faulting visibility predicate
      // fails OPEN (`evaluateVisibility`), so an id-gated field rendered for
      // exactly the signed-out visitor it was written to exclude, silently, at
      // EVERY mount site. `null` ANSWERS: the comparison is a clean FALSE and
      // the gate bites. Not `undefined` — objectui#5424 measured on this same
      // object that a present-and-always-`undefined` key "is the shape that
      // teaches the wrong thing", which is why `roles` is absent rather than
      // forwarded as `undefined`.
      id: null,
      name: 'Anonymous',
      email: '',
      role: 'guest',
      isPlatformAdmin: false,
      positions: [],
    };
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role ?? 'user',
    // Surface the platform-admin flag so action `visible` CEL predicates
    // gated on `ctx.user.isPlatformAdmin == true` (e.g. sys_environment
    // "Change Plan (admin)") evaluate correctly. Previously only
    // name/email/role were forwarded → isPlatformAdmin-gated actions were
    // hidden even for platform admins.
    isPlatformAdmin: user.isPlatformAdmin ?? false,
    // Positions are what the SERVER binds as `current_user` for per-option
    // `visibleWhen` authorization gating (ADR-0058; framework EvalUser —
    // objectui#2284). Forwarding them lets a position-gated option
    // (`'admin' in current_user.positions`) hide client-side too, instead
    // of failing open as visible and only being rejected on submit.
    positions: user.positions ?? [],
  };
}
