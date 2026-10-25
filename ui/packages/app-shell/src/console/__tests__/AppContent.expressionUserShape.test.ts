/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5424 site 4 — the expression user advertised a key that was always
 * `undefined`.
 *
 * ## What was wrong
 *
 * `AppContent` built the object `ExpressionProvider` binds as `current_user` /
 * `ctx.user` / `os.user`, and forwarded `roles: (user as any).roles` into it.
 * The protocol-17 session face emits no `roles` key at all (framework ADR-0090
 * D3 renamed it to `positions` with no deprecation window — measured on a live
 * 17.1.0 server in objectui#5389), so that property was present-and-undefined
 * on every evaluation context the console ever built.
 *
 * This is the mildest of the card's four sites — the same object already
 * forwarded `positions` and `isPlatformAdmin` correctly, so nothing depended on
 * it — but "present and always undefined" is the shape that teaches the wrong
 * thing: a metadata author writing `'manager' in current_user.roles` gets a
 * context that answers rather than one that is plainly missing the key, and the
 * answer is silently, permanently wrong.
 *
 * ## Why the assertion is `in` and not `toBeUndefined`
 *
 * `{ roles: undefined }` and `{}` both make `user.roles` read as `undefined`,
 * so a value assertion cannot tell the fixed shape from the broken one — it is
 * green either way. Key PRESENCE is the only thing that moves, so `'roles' in`
 * is the whole pin. Same reason `toEqual` is used on the full object below:
 * `toEqual` treats an explicit `undefined` as absent, `toStrictEqual` does not,
 * and this file needs the strict one.
 *
 * ## Reverse verification (direction predicted BEFORE running, measured in this PR)
 *
 * Put `roles: u.roles,` back into `buildExpressionUser`:
 *   - BOTH "never advertises" cases go RED (`'roles' in` → `true`; the second
 *     also finds `['ghost_position']` among the forwarded values), and the
 *     strict-shape case goes RED with an extra `roles: undefined` property;
 *   - the `positions` / `isPlatformAdmin` forwarding cases stay GREEN — they
 *     never read the retired key, so they cannot stand in for the pin above;
 *   - the signed-out case stays GREEN — that branch never carried `roles`,
 *     which is exactly the inconsistency between the two branches that the
 *     removal closes.
 *
 * MEASURED: every prediction above held, with no unforeseen movement — three
 * red, three green, exactly the split named. The first red reads `expected true
 * to be false`, i.e. the key IS there on the mutated tree.
 */
import { describe, it, expect } from 'vitest';

import { buildExpressionUser } from '../AppContent';

/**
 * The measured protocol-17 payload (objectui#5424): a permission-set-derived
 * platform admin on a single-tenant 17.1.0 server. `role` is the scalar
 * `'user'`; the position names live only in `positions`; there is no `roles`.
 */
const PROTOCOL_17_USER = {
  id: 'u_1',
  name: 'Ada',
  email: 'admin@example.com',
  role: 'user',
  positions: ['user', 'platform_admin'],
  isPlatformAdmin: true,
};

describe('objectui#5424 — `buildExpressionUser` stops advertising the retired `roles` key', () => {
  it('never advertises `roles`, for a signed-in user', () => {
    // The pin. On `origin/main` the key is written with value `undefined`, so
    // `in` answers true while every value-shaped assertion stays green.
    expect('roles' in buildExpressionUser(PROTOCOL_17_USER)).toBe(false);
  });

  it('never advertises `roles`, even when the session still carries one', () => {
    // Not a fallback, not a passthrough: the retired spelling does not reach the
    // predicate context by any route (`packages/auth/src/types.ts` — "do not
    // pair it with `positions` as a fallback").
    const built = buildExpressionUser({ ...PROTOCOL_17_USER, roles: ['ghost_position'] });

    expect('roles' in built).toBe(false);
    expect(Object.values(built)).not.toContainEqual(['ghost_position']);
  });

  it('binds exactly the declared shape for a signed-in user', () => {
    // `toStrictEqual` so a re-added `roles: undefined` fails here too, not just
    // on the `in` check above.
    expect(buildExpressionUser(PROTOCOL_17_USER)).toStrictEqual({
      id: 'u_1',
      name: 'Ada',
      email: 'admin@example.com',
      role: 'user',
      isPlatformAdmin: true,
      positions: ['user', 'platform_admin'],
    });
  });

  it('still forwards `positions` and `isPlatformAdmin` — the keys authorization gating reads', () => {
    // Control: green before and after. These are what ADR-0058 / objectui#2284
    // put in this object, and the removal above must not disturb them.
    const built = buildExpressionUser(PROTOCOL_17_USER);

    expect(built.positions).toEqual(['user', 'platform_admin']);
    expect(built.isPlatformAdmin).toBe(true);
  });

  it('defaults `positions` to an empty list rather than leaving it undefined', () => {
    // A session without positions must still give `'x' in current_user.positions`
    // something to evaluate against.
    expect(buildExpressionUser({ id: 'u_2', name: 'B', email: 'b@c.d' }).positions).toEqual([]);
  });

  it('binds the anonymous shape when there is no session, with no `roles` there either', () => {
    const anonymous = buildExpressionUser(null);

    expect('roles' in anonymous).toBe(false);
    // objectui#6534 widened this from five keys to six by adding `id: null`.
    // That is a TIGHTENING of the pin, not a weakening of it, and it was graded
    // as part of the fix rather than a breach — triage, 2026-08-26, verbatim:
    //
    //   "Updating `AppContent.expressionUserShape.test.ts`'s five-key pin is
    //    part of the fix, not a breach"
    //
    // The pin's job is unchanged and its strictness is unchanged: it still
    // enumerates the WHOLE object with `toStrictEqual`, so an added key, a
    // dropped key or a key written as explicit `undefined` all still fail here.
    // Only the enumerated set moved, and it moved to CLOSE the last asymmetry
    // between the two branches — which is the same symmetry objectui#5424 was
    // closing when it removed `roles`.
    expect(anonymous).toStrictEqual({
      id: null,
      name: 'Anonymous',
      email: '',
      role: 'guest',
      isPlatformAdmin: false,
      positions: [],
    });
  });
});

/**
 * objectui#6534 — the anonymous branch ANSWERS `id` instead of omitting it.
 *
 * `id` was signed-in-only, so `'id' in buildExpressionUser(null)` was `false`.
 * An absent key is not `false`: `ctx.user.id == '…'` FAULTS for a signed-out
 * visitor, and a faulting visibility predicate fails OPEN
 * (`evaluateVisibility`), so an id-gated field rendered for exactly the
 * principal it was written to exclude — at EVERY mount site, including the two
 * that have always called this normaliser correctly.
 *
 * ## Why `null` and not `undefined`
 *
 * Settled by precedent on this very object, not chosen here. objectui#5424
 * removed `roles` because present-and-always-`undefined` "is the shape that
 * teaches the wrong thing" — the context answers rather than being plainly
 * absent, and the answer is silently wrong. `null` is a VALUE: a CEL author can
 * compare against it and the comparison resolves. `undefined` would reproduce
 * exactly the defect objectui#5424 measured, one key over.
 *
 * ## Why `in` and not just a value assertion
 *
 * Same reason the `roles` pin above uses it: `{ id: undefined }` and `{}` both
 * read as `undefined` at `user.id`, so only key PRESENCE distinguishes the
 * three candidate shapes. The `in` check and the value check together are what
 * separate `null` from both rejected alternatives — neither alone does.
 *
 * ## Fenced boundary
 *
 * This is NOT a change to fail-open. A predicate that faults still renders
 * (objectui#6443 / #6487 / #6445 — deliberate, and untouched by this card).
 * What changed is that this predicate no longer faults.
 */
describe('objectui#6534 — the anonymous branch answers `id` rather than omitting it', () => {
  it('advertises `id` on the anonymous branch', () => {
    // The pin. This is the assertion that was `false` before the fix, and it is
    // the one that moves between all three candidate shapes.
    expect('id' in buildExpressionUser(null)).toBe(true);
  });

  it('answers `null` there — a value a predicate can compare against', () => {
    const anonymous = buildExpressionUser(null);

    expect(anonymous.id).toBeNull();
    // Explicitly NOT `undefined`: that is the shape objectui#5424 rejected on
    // this object, and `toBeNull` alone would not catch it being reintroduced
    // as `undefined` on a future edit — `toBeUndefined` would pass on `{}` too.
    expect(anonymous.id).not.toBeUndefined();
  });

  it('agrees with the signed-in branch on the key set — the asymmetry is closed', () => {
    // objectui#5424 removed `roles` to make the two branches agree on one
    // shape; `id` was the last key they still disagreed on. A future edit that
    // adds a key to one branch and forgets the other fails HERE, whichever
    // branch it forgets, without needing to know which key was added.
    const signedIn = buildExpressionUser(PROTOCOL_17_USER);
    const anonymous = buildExpressionUser(null);

    expect(Object.keys(anonymous).sort()).toEqual(Object.keys(signedIn).sort());
  });

  it('still distinguishes anonymous from a signed-in user by VALUE, not by key set', () => {
    // The converse guard: converging the key sets must not make the two
    // branches indistinguishable. A gate excluding a signed-out visitor reads
    // the value, and the values still differ.
    expect(buildExpressionUser(null).id).toBeNull();
    expect(buildExpressionUser(PROTOCOL_17_USER).id).toBe('u_1');
  });
});
