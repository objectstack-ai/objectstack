// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14360] The `sys_user` ban write, as ONE callable both ban paths share —
 * PACKAGE-INTERNAL by design. This module is deliberately NOT re-exported from
 * `index.ts` (the same posture as `scim-connection-service.ts` and the other
 * off-barrel plugin-auth modules): nothing here is a published symbol, so the
 * two callers can share the write without the package growing a public API it
 * would then owe forever.
 *
 * Two callers land a disable on this platform: the `/admin/ban-user` mount in
 * `admin-ban-endpoints.ts`, and — since `@better-auth/scim` 1.7.0 stopped
 * writing `banned` itself and handed the host an `identity.reconcileUser`
 * callback instead — the SCIM `active: false` deprovisioning hook in
 * `auth-manager.ts` (`reconcileScimUserLifecycle`). Field for field this is the
 * write better-auth's own `banUser` handler makes (`banned` / `banReason` /
 * `banExpires` / `updatedAt`), so the vendor's `session.create` hook
 * (`BANNED_USER`) enforces both halves identically. The break-glass
 * last-administrator guard (ADR-0024 D5.2, `last-admin-guard.ts`) judges the
 * write at the ENGINE, so it holds on both callers by construction — neither
 * can reach the column without passing it.
 *
 * `UserBanWriter` is the narrowest surface the write needs, and both callers
 * already hold one: better-auth's `internalAdapter` satisfies it directly; the
 * SCIM hook adapts the `DBTransactionAdapter` the vendor bound to its
 * transaction, so the write commits — or rolls back — with the SCIM mutation
 * it belongs to (a real engine transaction on this adapter: the SCIM request
 * scope is opened at `AuthManager.handleRequest`, pinned by
 * `scim-transaction-scope.test.ts`).
 *
 * Session revocation is deliberately NOT part of the write: the admin mount
 * revokes explicitly, and the SCIM vendor revokes after its callback returns
 * (`deleteUserSessions` on `active: false`, measured on 1.7.2).
 */

export interface UserBanWriter {
  updateUser(id: string, data: Record<string, unknown>): Promise<unknown>;
}

/**
 * The reason the SCIM deactivation path stamps on the row — the exact string
 * `@better-auth/scim` wrote itself through 1.6.x
 * (`resolveSCIMActiveDeactivation`, `dist/index.mjs` at 1.6.30), kept verbatim
 * so a row the vendor banned before the 1.7.0 decoupling and a row the host
 * hook bans are the same fact. It is also how the reactivation half
 * recognises its OWN ban: an `active: true` from the IdP lifts a ban carrying
 * this reason and leaves an administrator's ban (any other reason) in place.
 */
export const SCIM_DEACTIVATION_BAN_REASON = 'Deactivated via SCIM';

export interface UserBanFields {
  banReason: string;
  /** `undefined` leaves the column untouched; `null` clears a prior expiry. */
  banExpires?: Date | null;
}

/** Disable `userId` — the vendor-shaped ban write, on whichever writer the caller is inside. */
export async function applyUserBan(
  writer: UserBanWriter,
  userId: string,
  ban: UserBanFields,
): Promise<void> {
  await writer.updateUser(userId, {
    banned: true,
    banReason: ban.banReason,
    ...(ban.banExpires !== undefined ? { banExpires: ban.banExpires } : {}),
    updatedAt: new Date(),
  });
}

/** Re-enable `userId` — clears the three ban columns, exactly as the vendor's `unbanUser` does. */
export async function applyUserUnban(writer: UserBanWriter, userId: string): Promise<void> {
  await writer.updateUser(userId, {
    banned: false,
    banReason: null,
    banExpires: null,
    updatedAt: new Date(),
  });
}
