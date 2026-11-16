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
 *   - `approverIndexWhere` (read by `approverRequestIds`) — which requests hold
 *     a slot under the addresses the caller asked about?
 *     ({@link equivalentApproverAddresses})
 *   - `participantProbes`, current approver — which requests hold a slot the
 *     caller acts under? ({@link actingAddresses}) Asked by `visibleRequestIds`
 *     for the id set and by the schema-read delegate for "any at all"
 *   - `participantProbes`, already acted — which requests carry a decision or
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
 * The ONE slot a `platform_admin` approver opens: an address, not a person.
 * It names the deployment's platform administrators as a class, so it is
 * never expanded to the people in it (`hasPlatformAdminStanding` is a
 * per-user predicate and forbids the population read). A caller acts under it
 * exactly when the server finds them in that standing, at the moment they
 * ask ({@link ActingCaller.platformAdmin}), so a revocation takes effect at
 * the next read or decision, on requests opened before it too.
 *
 * Spelled `type:value` like every other address: the readers that
 * tell a person from an address (notification fan-out, the record-read
 * grant, out-of-office, labels) test for the colon, and this slot must read
 * as an address to every one of them. It names no person, so it grants no
 * record read and is told nothing.
 */
export const PLATFORM_ADMIN_ADDRESS = 'platform_admin:*';

/** Does `address` name the platform administrators' slot ({@link PLATFORM_ADMIN_ADDRESS})? */
export function isPlatformAdminAddress(address: string): boolean {
  return address === PLATFORM_ADMIN_ADDRESS;
}

/**
 * [#34218] Does the slate hold the platform administrators' slot? Read by the
 * override admissions (`isOverrideActor`'s `pendingSlate`): such a slate is
 * the platform's to decide, so the tenant-admin override arm is withheld from
 * the whole request, a mixed slate included.
 */
export function slateHoldsPlatformAdminAddress(slate: readonly string[]): boolean {
  return slate.some(isPlatformAdminAddress);
}

/**
 * A stored slate as every door reads it back. `pending_approvers` is stored
 * as one text, and the decision and override admissions, the per-viewer
 * flags and the approver-index rebuild all read it through this function
 * (the approval service's `csvSplit` is it). An address on a slate is what
 * this answers, never the string a resolution produced, so a rule about which
 * addresses a slate may hold is judged on this answer.
 */
export function readStoredSlate(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Does `entry`, once stored on a slate, read back as holding the platform
 * administrators' slot ({@link readStoredSlate})? The slot is judged on the
 * slate the doors read, not on the value a resolution produced. Any entry is
 * judged as the text it is stored as, so the answer is total: a value that is
 * not text (a number, a list, an object) is judged as the text the stored
 * slate holds for it.
 */
export function readsAsPlatformAdminAddress(entry: unknown): boolean {
  return readStoredSlate(entry == null ? '' : String(entry)).some(isPlatformAdminAddress);
}

/**
 * `ids` without any entry that reads back as the platform administrators'
 * slot ({@link readsAsPlatformAdminAddress}): the slot is judged on the slate
 * as the doors read it, so such an entry adds nothing to it. Read where a
 * slate is resolved from anything but the approver type that names them,
 * which alone opens it.
 */
export function withoutPlatformAdminAddress<T>(ids: readonly T[]): T[] {
  return ids.filter((id) => !readsAsPlatformAdminAddress(id));
}

/**
 * [#34218] A request's pending slate as the decision, override and inbox
 * doors read it: the stored slate ({@link readStoredSlate}), on which the
 * platform administrators' slot stands only when the request records that a
 * `platform_admin` approver opened it (`slotOpened`). On a request without
 * that record no door reads the slot, whatever its stored text holds: only
 * the approver type that names the platform administrators opens their slot.
 */
export function pendingSlateAsDoorsRead(stored: unknown, slotOpened: boolean): string[] {
  const slate = readStoredSlate(stored);
  return slotOpened ? slate : withoutPlatformAdminAddress(slate);
}

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
 * The position `address` names — `p` for `position:<p>` — or `undefined` when
 * it names none (a user id, an email, any other `type:value` literal, a stored
 * `role:` slot). The inverse of {@link positionAddresses}, read where a slot
 * address is RESOLVED to the people who could take it (`reassign`'s target
 * check), never compared with a caller.
 */
export function addressedPosition(address: string): string | undefined {
  for (const prefix of POSITION_ADDRESS_PREFIXES) {
    if (address.startsWith(prefix)) return address.slice(prefix.length);
  }
  return undefined;
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
  /**
   * Whether the server finds the caller in platform-administrator standing
   * (`hasPlatformAdminStanding`, read live for this request). `true` adds
   * {@link PLATFORM_ADMIN_ADDRESS} to the addresses they act under; absent
   * reads as `false`, so a caller built without asking acts under nothing
   * more than before.
   */
  readonly platformAdmin?: boolean;
}

/**
 * Every slot address the caller acts under WITHOUT naming one — the default
 * actor — in the order a slot is taken: the user id, the account's email, the
 * address of every held position, then the platform administrators' slot for a
 * caller in that standing.
 *
 * The email is matched as the account stores it. `resolveActor` admits a
 * NAMED email case-insensitively, and that named spelling is judged by
 * {@link actorAddresses} on its own, exactly as before.
 */
export function actingAddresses(caller: ActingCaller): string[] {
  const out = [caller.userId];
  if (caller.email) out.push(caller.email);
  for (const position of caller.positions ?? []) out.push(...positionAddresses(position));
  if (caller.platformAdmin === true) out.push(PLATFORM_ADMIN_ADDRESS);
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
 * Does `slate` name a PERSON? A concrete approver address is a user id or an
 * email: a slot one person takes by being who they are. Anything else on a
 * slate is a `type:value` literal, left by an approver target that resolved to
 * no holder (`position:<p>`, `team:<t>`, a stored `role:<p>`).
 *
 * One address counts as naming someone: {@link PLATFORM_ADMIN_ADDRESS}. It is
 * not an approver target that found nobody; it is the address the platform
 * administrators decide under, and it is never expanded. Read as empty, the
 * default `admin_rescue` would replace it with the request organization's
 * administrators, the very people the type exists to keep off the slate.
 *
 * `false` is the slate the open path hands to the node's `onEmptyApprovers`
 * policy, and the one it re-tests after a `fallback` before the default
 * `admin_rescue` opens on the organization's administrators (#22824). One
 * test, so every one of those decisions reads the same slate shape.
 *
 * This is a test of the slate's SHAPE. It compares no slot with a caller, so it
 * is not a reader of the equivalence above.
 */
export function slateNamesAPerson(slate: readonly string[]): boolean {
  return slate.some((address) => !!address && (!address.includes(':') || isPlatformAdminAddress(address)));
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
