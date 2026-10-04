// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The approver-address spellings that name ONE position, and the caller's
 * acting addresses — the single source of the equivalence the approval service
 * applies wherever a slot address is compared with a caller's identity.
 *
 * A pending slot that routed to a position nobody held at open time stores the
 * literal `position:<p>` (`resolveApproverSpec`'s `type:value` fallback). A
 * `user` approver authored as an email stores the email. `resolveActor` lets a
 * caller act under each of those — a position `p` they hold (server-resolved
 * `context.positions`, never client-supplied) as `position:<p>`, an email
 * their own account carries — as well as under their bare user id.
 *
 * `position:<p>` is the ONE spelling of a position address. `role:<p>` is not
 * one: ADR-0090 D3 retires the word `role` with no alias window, so a slot
 * stored under that spelling — a 15.x-era request, or one the deprecated
 * `role` approver type opened before its fallback literal was canonicalized —
 * addresses no position holder. Only the privileged override decides it, or a
 * reassign to a real approver. Nothing in this package writes the spelling any
 * more (`resolveApproverSpec` writes the canonical type), and
 * `approver-address-readers.test.ts` fails on a `role:` slot literal written
 * anywhere in its source.
 *
 * The readers used to disagree with it, one at a time. The inbox's "My
 * Pending" filter matched the caller's `approverId` values literally; the
 * participant gate, the per-viewer `can_act` flag, the decision methods' slot
 * test and the already-acted probe each keyed on the bare user id. So a holder
 * of `p` could decide a `position:<p>` request only by naming that exact
 * spelling — the default actor was refused, the console hid its decision
 * buttons, and the request vanished from the holder's
 * sight the moment they decided it. Readers of one equivalence, written
 * separately, had drifted.
 *
 * So the equivalence lives HERE, once, and every reader takes it from here:
 *
 *   - `resolveActor` — may this caller act under the named address?
 *     ({@link positionAddresses})
 *   - `approverRequestIds` — which requests hold a slot under the addresses the
 *     caller asked about? ({@link equivalentApproverAddresses})
 *   - `visibleRequestIds`, current approver — which requests hold a slot the
 *     caller acts under? ({@link actingAddresses})
 *   - `visibleRequestIds`, already acted — which requests carry a decision or
 *     thread entry recorded under one of those addresses? ({@link actingAddresses})
 *   - the decision methods' slot test — which slot does this actor take?
 *     ({@link heldSlot})
 *   - `attachViewers`' `can_act` — would the default actor take a slot?
 *     ({@link heldSlot}, the same call the decision methods make)
 *
 * ⛔ Do not write a second fold beside any of them, and do not widen this one
 * to a spelling the acting path does not accept: the set below IS the acting
 * path's set. ⛔ Nor put `role:` back into it — that reopens the alias window
 * ADR-0090 D3 closed. A reader that folds more than the acting path accepts would show
 * a user requests they cannot decide; one that folds less hides requests they
 * can. `approver-address-readers.test.ts` enumerates the readers and fails on
 * a slot-against-caller comparison written anywhere else.
 */

/**
 * The prefixes under which a slot address names a position: `position:` alone
 * (ADR-0090 D3 — the retired `role:` is no alias of it). Kept a list so every
 * reader below reads the one set the acting path admits.
 */
const POSITION_ADDRESS_PREFIXES = ['position:'] as const;

/**
 * Every slot address that names `position` — `position:<position>`.
 *
 * Interpolated exactly as the acting path always spelled it, so a non-string
 * entry in `context.positions` produces the same strings it always did.
 */
export function positionAddresses(position: unknown): string[] {
  return POSITION_ADDRESS_PREFIXES.map((prefix) => `${prefix}${position}`);
}

/**
 * Every slot address the approval service treats as the SAME identity as
 * `address`: when it names a position, that position's addresses
 * ({@link positionAddresses}); otherwise the address alone. An address that
 * names no position (a user id, an email, a `team:` / `org_membership_level:`
 * literal, a stored `role:` slot) is equivalent only to itself.
 */
export function equivalentApproverAddresses(address: string): string[] {
  for (const prefix of POSITION_ADDRESS_PREFIXES) {
    if (address.startsWith(prefix)) return positionAddresses(address.slice(prefix.length));
  }
  return [address];
}

/**
 * The caller's identity as the SERVER resolved it — never a client-supplied
 * value: a body or query parameter that names an address is an ASK, judged
 * against this, never a member of it.
 *
 *   - `userId` — the session's user id;
 *   - `email` — the email the caller's own `sys_user` row carries, the same
 *     row `resolveActor` proves a named email against; absent when the row has
 *     none;
 *   - `positions` — the shared authz resolver's `context.positions`.
 */
export interface ActingCaller {
  readonly userId: string;
  readonly email?: string | null;
  readonly positions?: readonly unknown[];
}

/**
 * Every slot address the caller acts under WITHOUT naming one — the default
 * actor — in the order a slot is taken: the user id, the account's email, then
 * the address of every held position.
 *
 * The email is matched as the account stores it. `resolveActor` admits a
 * NAMED email case-insensitively, and that named spelling is judged by
 * {@link actorAddresses} on its own, exactly as before.
 */
export function actingAddresses(caller: ActingCaller): string[] {
  const out = [caller.userId];
  if (caller.email) out.push(caller.email);
  for (const position of caller.positions ?? []) out.push(...positionAddresses(position));
  return [...new Set(out)];
}

/**
 * The addresses ONE actor acts under, `actorId` exactly as `resolveActor`
 * returned it (so already proven to be the caller's own):
 *
 *   - the caller's own user id — the default actor, and what the REST routes
 *     pass when the body names nobody → {@link actingAddresses};
 *   - a position address → that position's addresses;
 *   - anything else (a named email; a machine caller's minted actor) → itself.
 */
export function actorAddresses(actorId: string, caller: ActingCaller | null): string[] {
  if (caller && actorId === caller.userId) return actingAddresses(caller);
  return [...new Set([actorId, ...equivalentApproverAddresses(actorId)])];
}

/**
 * THE slot test: the pending slot `actorId` takes on `pending`, or `undefined`
 * when it holds none — the first of {@link actorAddresses} the slate holds, so
 * a concrete user-id slot is taken before a position slot the same caller
 * could also take.
 *
 * Every decision method reads it with the actor `resolveActor` returned, and
 * `attachViewers` reads it for `can_act` with the default actor — the same
 * function, so the flag the console gates its decision actions on cannot
 * drift from the authorization it advertises.
 */
export function heldSlot(
  pending: readonly string[],
  actorId: string,
  caller: ActingCaller | null,
): string | undefined {
  for (const address of actorAddresses(actorId, caller)) {
    if (pending.includes(address)) return address;
  }
  return undefined;
}
