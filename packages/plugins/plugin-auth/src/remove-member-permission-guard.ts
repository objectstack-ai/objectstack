// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8289] `POST /organization/remove-member` — answer a PERMISSION denial as a
 * permission denial.
 *
 * ## The defect, and where it is minted
 *
 * Not here, and not anywhere in our packages: the wrong answer comes out of the
 * pinned vendor. better-auth `1.7.0-rc.2`,
 * `dist/plugins/organization/routes/crud-members.mjs`, `removeMember` runs:
 *
 * ```js
 * const roles = toBeRemovedMember.role.split(",");
 * const creatorRole = ctx.context.orgOptions?.creatorRole || "owner";
 * if (roles.includes(creatorRole)) {
 *   //  (3a)  a PERMISSION rule, wearing the invariant's code and status
 *   if (!member.role.split(",").map(r => r.trim()).includes(creatorRole))
 *     throw APIError.from("BAD_REQUEST", YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER);
 *   //  (3b)  the genuine invariant
 *   if (owners.length <= 1)
 *     throw APIError.from("BAD_REQUEST", YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER);
 * }
 * //  (4)  the real permission check — ordered AFTER the two above
 * if (!await hasPermission({ role: member.role, permissions: { member: ["delete"] }, … }))
 *   throw APIError.from("UNAUTHORIZED", YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER);
 * ```
 *
 * (3a) is "only an owner may remove an owner" — a permission rule — reported
 * with the sole-owner invariant's message and a `400`. It is also ordered ahead
 * of (4), so whenever the target is an owner and the caller is not, the actual
 * permission check never runs and the invariant answers a question nobody asked.
 * That is the filed reproduction exactly, and it is why adding a second owner
 * does not change the response: (3a) short-circuits before the owner COUNT at
 * (3b) is ever consulted, so every clause of "you cannot leave the organization
 * as the only owner" can be false while it is still what comes back.
 *
 * (4) carries a second, smaller defect: `UNAUTHORIZED` (401) where every sibling
 * denial — `update-member-role`, `organization/update`, `organization/delete`,
 * `organization/invite-member` — answers `FORBIDDEN` (403).
 *
 * ## Why the fix is a pre-emptive gate and not a response remap
 *
 * The vendor is not ours to edit (no fork, no vendoring), so the correction has
 * to happen at our bridge. It has to happen in the **before**-hook specifically:
 * better-auth pins the HTTP status at the moment the handler throws
 * (`dispatch.mjs` calls `toResponse(response, { status: result.status })` with
 * the ORIGINAL error's `statusCode`, and `better-call`'s `toResponse` resolves
 * `init?.status ?? data.statusCode` — init WINS). An after-hook can therefore
 * replace the body but NOT the status, which would produce a `400` carrying a
 * `YOU_ARE_NOT_ALLOWED_TO_*` code — a worse answer than the one being fixed.
 * A before-hook throw is dispatched through `toResponse(before, { headers })`
 * with no `status` in init, so the thrown error's own `403` stands. That is the
 * same mechanism the `/sso/register` FORBIDDEN gate already relies on.
 *
 * ## What this guard is allowed to decide, and what it must never touch
 *
 * It answers the PERMISSION question and nothing else. Two properties make that
 * safe, and both are pinned by `remove-member-permission-guard.test.ts`:
 *
 *  1. **It never speaks on the sole-owner path.** When the caller is removing
 *     THEMSELVES and carries the creator role, the guard returns silently and
 *     lets the vendor answer — that is branch (3b)'s territory, the one reading
 *     of the message that is true. The exemption is exact: (3b) can only fire
 *     when caller and target are the same person (it requires both to carry the
 *     creator role while at most one such member exists), so exempting the
 *     self-removal path removes the guard from the invariant's way completely
 *     without exempting anything else.
 *  2. **It never widens a refusal.** The role test it applies is the vendor's
 *     own predicate at (3a), reproduced literally — including the asymmetry
 *     where the target's roles are split WITHOUT `trim()` and the caller's WITH
 *     it. Reproducing that asymmetry is deliberate: a "cleaned up" predicate
 *     would refuse inputs the vendor lets through (a `sys_member.role` of
 *     `' owner'` reads as an owner to a trimming test and as a non-owner to the
 *     vendor), which would be a policy change smuggled in under an envelope fix.
 *     The permission half is decided by calling the vendor's OWN exported
 *     `hasPermission`, never a local re-derivation of it — the org role
 *     vocabulary is closed (ADR-0108) but the ac map is still the vendor's to
 *     interpret, and two spellings of one authorization question cannot be kept
 *     in agreement.
 *
 * So the refusal SET is byte-for-byte the vendor's; only the envelope changes.
 */

/** better-auth's own code for this denial — the `YOU_ARE_NOT_ALLOWED_TO_*` family. */
export const REMOVE_MEMBER_DENIAL_CODE = 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER';

/** better-auth's own message for {@link REMOVE_MEMBER_DENIAL_CODE}. */
export const REMOVE_MEMBER_DENIAL_MESSAGE = 'You are not allowed to delete this member';

/** better-auth's default `creatorRole` when the org plugin does not set one. */
export const DEFAULT_CREATOR_ROLE = 'owner';

/**
 * Does this role value carry `creatorRole`, read the way the vendor's (3a)
 * reads the CALLER's — `split(',')` then `trim()` each part.
 */
export function callerCarriesCreatorRole(raw: unknown, creatorRole: string): boolean {
  const flat = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof flat !== 'string') return false;
  return flat
    .split(',')
    .map((r) => r.trim())
    .includes(creatorRole);
}

/**
 * Does this role value carry `creatorRole`, read the way the vendor's (3a)
 * reads the TARGET's — `split(',')` with NO `trim()`.
 *
 * The missing `trim()` is the vendor's, not a mistake here: see the header for
 * why the asymmetry is reproduced rather than corrected. Correcting it would
 * change WHO is refused, which this guard must not do.
 */
export function targetCarriesCreatorRole(raw: unknown, creatorRole: string): boolean {
  const flat = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof flat !== 'string') return false;
  return flat.split(',').includes(creatorRole);
}

/**
 * The role half of the decision — the vendor's (3a) predicate, and only it.
 *
 * `true` means "the vendor is about to refuse this at (3a) with the only-owner
 * message"; the caller of this function turns that into the `403` the refusal
 * should always have been.
 */
export function removalBlockedByOwnerTarget(
  callerRole: unknown,
  targetRole: unknown,
  creatorRole: string = DEFAULT_CREATOR_ROLE,
): boolean {
  return (
    targetCarriesCreatorRole(targetRole, creatorRole) &&
    !callerCarriesCreatorRole(callerRole, creatorRole)
  );
}

/**
 * Is this request the sole-owner invariant's territory — i.e. must the guard
 * stay silent and let the vendor answer?
 *
 * True exactly when the caller is removing themselves AND carries the creator
 * role. See header property (1) for why that is the precise exemption.
 */
export function isSoleOwnerGuardTerritory(
  callerUserId: string,
  targetUserId: string,
  callerRole: unknown,
  creatorRole: string = DEFAULT_CREATOR_ROLE,
): boolean {
  return (
    callerUserId === targetUserId && callerCarriesCreatorRole(callerRole, creatorRole)
  );
}
