// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The approver-address spellings that name ONE position — the single source of
 * the equivalence the approval service applies wherever a slot address is
 * compared with a caller's identity.
 *
 * A pending slot that routed to a position nobody held at open time stores the
 * literal `position:<p>` (`resolveApproverSpec`'s `type:value` fallback); a
 * 15.x-era slot, and the Console's own identity list, spell the same position
 * `role:<p>` — the ADR-0090 D3 deprecated spelling. The service has always
 * treated the two as one identity on the ACTING path: `resolveActor` lets a
 * caller who holds position `p` (server-resolved `context.positions`, never
 * client-supplied) act as either spelling.
 *
 * The LIST path used to disagree. The inbox's "My Pending" filter matched the
 * caller's `approverId` values literally against the approver index, so a
 * request whose slot read `position:<p>` was invisible to a client that asked
 * for `role:<p>` — while the very same user could open and decide it. Two
 * readers of one equivalence, written twice, had drifted.
 *
 * So the equivalence lives HERE, once, and every reader takes it from here:
 *
 *   - `resolveActor` — may this caller act under the named address?
 *   - `approverRequestIds` — which requests hold a slot under any spelling of
 *     the addresses the caller asked about?
 *   - `visibleRequestIds` — which requests does this caller participate in as
 *     a current approver, counting the position slots they could act on?
 *
 * ⛔ Do not write a second fold beside any of them, and do not widen this one
 * to a spelling the acting path does not accept: the set below IS the acting
 * path's set. A list filter that folds more than the acting path accepts would
 * show a user requests they cannot decide; one that folds less hides requests
 * they can.
 */

/**
 * The prefixes under which a slot address names a position. The order is the
 * order {@link positionAddresses} spells them in, canonical first.
 */
const POSITION_ADDRESS_PREFIXES = ['position:', 'role:'] as const;

/**
 * Every slot address that names `position`, canonical spelling first.
 *
 * Interpolated exactly as the acting path always spelled it, so a non-string
 * entry in `context.positions` produces the same strings it always did.
 */
export function positionAddresses(position: unknown): string[] {
  return POSITION_ADDRESS_PREFIXES.map((prefix) => `${prefix}${position}`);
}

/**
 * Every slot address the approval service treats as the SAME identity as
 * `address`: the address itself, plus — when it names a position under any
 * accepted prefix — every other spelling of that position. An address that
 * names no position (a user id, an email, a `team:` / `org_membership_level:`
 * literal) is equivalent only to itself.
 */
export function equivalentApproverAddresses(address: string): string[] {
  for (const prefix of POSITION_ADDRESS_PREFIXES) {
    if (address.startsWith(prefix)) return positionAddresses(address.slice(prefix.length));
  }
  return [address];
}
