// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Break-glass guard: never remove the LAST local-password login.
 *
 * Under enforced SSO the managed team holds no local credential; the env owner
 * / a local admin keeps one as the break-glass escape hatch so an IdP outage
 * can never lock the org out. Deleting or banning the last user holding a
 * `credential` account is refused.
 *
 * ── Why this is a module and not an inline check ─────────────────────────────
 *
 * It used to live inline in `auth-manager.ts`'s better-auth `before` hook,
 * matched on `ctx.path`. That is the correct seam for routes better-auth
 * serves — and it silently STOPS BEING A SEAM the moment ObjectStack mounts a
 * raw Hono route on the same path ahead of the catch-all, because the request
 * then never enters better-auth's router at all. `/admin/ban-user` is now such
 * a route (the ADR-0068 platform-admin gate the vendor cannot express), so the
 * guard has two call sites and must be ONE implementation: a raw mount that
 * forgot to re-run it would drop a lockout protection with no test, no gate
 * and no diff to read.
 *
 * Fail-open on lookup errors is deliberate and unchanged: a transient query
 * error must never block a legitimate admin operation.
 */

/** The slice of better-auth's DB adapter this guard needs. */
export interface CredentialAccountAdapter {
  findOne(query: {
    model: string;
    where: Array<{ field: string; value: string }>;
  }): Promise<unknown | null>;
  findMany(query: {
    model: string;
    where: Array<{ field: string; value: string }>;
  }): Promise<unknown[]>;
}

/** The error code + message both call sites answer with. */
export const LAST_LOCAL_CREDENTIAL_CODE = 'LAST_LOCAL_CREDENTIAL';
export const LAST_LOCAL_CREDENTIAL_MESSAGE =
  'Cannot remove the last local password login. At least one break-glass ' +
  'account with a password must remain so an identity-provider outage can ' +
  'never lock the organization out. Add another local password first, then retry.';

/**
 * Would removing/banning `targetId` leave zero users holding a local password?
 *
 * Returns `false` — permit — when the target holds no credential account at
 * all (removing a credential-less, managed user cannot cause lockout), and
 * `false` on any lookup failure (fail-open, see the header).
 */
export async function isLastLocalCredentialHolder(
  adapter: CredentialAccountAdapter,
  targetId: string,
): Promise<boolean> {
  if (!targetId) return false;
  try {
    // Only guard when the target actually holds a local credential.
    const targetCred = await adapter.findOne({
      model: 'account',
      where: [
        { field: 'userId', value: targetId },
        { field: 'providerId', value: 'credential' },
      ],
    });
    if (!targetCred) return false;

    const creds = (await adapter.findMany({
      model: 'account',
      where: [{ field: 'providerId', value: 'credential' }],
    })) as Array<Record<string, unknown>>;

    const otherHolders = new Set(
      (creds ?? [])
        .map((a) => (a?.userId ?? a?.user_id) as string | undefined)
        .filter((id): id is string => Boolean(id) && id !== targetId),
    );
    return otherHolders.size === 0;
  } catch {
    // Fail-open — never block a legitimate op on a lookup error.
    return false;
  }
}
