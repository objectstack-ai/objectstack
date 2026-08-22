// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10700 — a SECOND `/two-factor/enable` on an account that already has a
 * confirmed factor rewrote the stored TOTP secret and carried `verified` over
 * from the enrollment before it.
 *
 * ## The defect, at the seam
 *
 * better-auth's enable handler computes the row it is about to write as
 *
 *     verified: existingTwoFactor != null && existingTwoFactor.verified === true
 *               || !!options?.skipVerificationOnEnable
 *
 * and, when a row already exists, `update`s that onto it
 * (`dist/plugins/two-factor/index.mjs`, measured 2026-08-22 against the
 * installed better-auth `1.7.1`). `secret` is the freshly generated one;
 * `verified` is inherited. So the flag describes the enrollment that came
 * BEFORE the secret sitting next to it.
 *
 * `sys_two_factor` declares `user_id` unique
 * (`packages/platform-objects/src/identity/sys-two-factor.object.ts`), so this
 * is an in-place rewrite of the one row the account has — there is no second
 * row and no second secret.
 *
 * ## Why the flag alone is the whole defect here
 *
 * The vendor ALREADY gates the sign-in challenge on this flag, in two places
 * (same dist tree):
 *
 *   • `totp/index.mjs` — `if (isSignIn && twoFactor.verified === false) throw
 *     TOTP_NOT_ENABLED`, before any lockout bookkeeping;
 *   • `index.mjs`'s post-sign-in hook — `totp` is offered in
 *     `twoFactorMethods` only when `userTotpSecret.verified !== false`.
 *
 * Both are STRICT `false` comparisons, which hold here because `verified` is
 * declared `type: 'boolean'` in the plugin's own schema and this repo's adapter
 * runs with `supportsBooleans: false` (`objectql-adapter.ts`), so better-auth's
 * factory converts the stored 0/1 back to a real boolean on read.
 *
 * That gate is exactly what a FIRST enrollment relies on: enable writes
 * `verified: false`, the factor is inert at sign-in, and the session-lane
 * `/two-factor/verify-totp` flips it true. Re-enrollment is the one path that
 * skipped it — not because the gate is missing, but because the flag handed to
 * the gate was inherited. Restoring the flag therefore restores the gate; it
 * does not add a second one. A duplicate gate here would be a second owner of
 * the same decision (AGENTS.md · Route & surface ownership #1).
 *
 * ## What this does
 *
 * After a successful `method: 'totp'` enable, force `verified = false` on the
 * account's row. On a first enrollment the vendor already wrote `false` and
 * this is a no-op; on a re-enrollment it is the correction. Nothing else about
 * the endpoint changes — same request body, same response shape, same status.
 * The endpoint accepts strictly LESS than it did: a secret it hands out is no
 * longer live at the challenge until the caller proves possession of it.
 *
 * ⚠️ **Scope, stated so review can see the edge of it.** This closes the
 * integrity half of the card — `verified` describes the stored secret at every
 * point in the flow — and it moves the mis-scan discovery point from "the next
 * sign-in, with no session" to "immediately, while the caller still holds a
 * live session". It does NOT make the previous secret survive the call: enable
 * rewrites the one row unconditionally, so the prior secret dies when enable
 * returns, exactly as before. Keeping it alive would need somewhere to park an
 * unconfirmed secret, and every way to do that either widens what
 * `/two-factor/verify-totp` accepts or adds persisted state to a
 * `managedBy: 'better-auth'` table — neither is a call this lane may make on
 * its own. The recovery path that does hold across the window is pinned in the
 * tests: the backup codes the same enable response issues complete a sign-in.
 *
 * ## `skipVerificationOnEnable`
 *
 * Deliberately honoured rather than overridden. That option means "activate
 * without a confirmation step", so under it `verified: true` beside a fresh
 * secret is the operator's declared intent, not a stale flag. `AuthManager`
 * never sets it — the option is not exposed in this repo's plugin config — so
 * this branch is defensive, not a live path.
 */

/** The published endpoint whose write this repairs. */
export const TWO_FACTOR_ENABLE_PATH = '/two-factor/enable';

/** better-auth's logical model name for `sys_two_factor`. */
const TWO_FACTOR_MODEL = 'twoFactor';

/** Did this request succeed, and did it enroll a TOTP secret? */
async function enrolledTotpSecret(ctx: any): Promise<boolean> {
  const returned = ctx?.context?.returned;
  if (!returned || typeof returned !== 'object') return false;
  try {
    const { isAPIError } = await import('better-auth/api');
    if (isAPIError(returned)) return false;
  } catch {
    if (returned instanceof Error) return false;
  }
  // `method: 'otp'` enables email/SMS codes and never touches the secret row.
  return (returned as any).method === 'totp';
}

/** Is the operator running with the confirmation step deliberately disabled? */
function verificationDeliberatelySkipped(ctx: any): boolean {
  const plugins = ctx?.context?.options?.plugins;
  if (!Array.isArray(plugins)) return false;
  const twoFactorPlugin = plugins.find((p: any) => p?.id === 'two-factor');
  return twoFactorPlugin?.options?.skipVerificationOnEnable === true;
}

/**
 * Force `verified = false` on the row a successful TOTP enable just wrote, so
 * the flag describes the secret stored beside it rather than the enrollment
 * before it.
 *
 * Never throws. The enrollment itself succeeded and the caller is holding the
 * `totpURI` and backup codes the response handed over; turning that into a 500
 * would strand them with credentials the account may or may not have kept.
 * A failure to correct the flag is loud in the log instead — this is the
 * silent-data-loss class, not the noisy-degradation class, because the symptom
 * of getting it wrong is an account whose second factor nobody confirmed.
 */
export async function resetVerifiedOnTwoFactorReenrollment(ctx: any): Promise<void> {
  try {
    if (ctx?.path !== TWO_FACTOR_ENABLE_PATH) return;
    if (!(await enrolledTotpSecret(ctx))) return;
    if (verificationDeliberatelySkipped(ctx)) return;

    const userId: unknown = ctx?.context?.session?.user?.id;
    if (typeof userId !== 'string' || !userId) {
      console.error(
        '[AuthManager] /two-factor/enable succeeded with no resolvable session user; ' +
        'could not confirm that sys_two_factor.verified describes the stored secret (#10700).',
      );
      return;
    }

    const adapter = ctx?.context?.adapter;
    if (!adapter?.findOne || !adapter?.update) return;

    const row = await adapter.findOne({
      model: TWO_FACTOR_MODEL,
      where: [{ field: 'userId', value: userId }],
    });
    // #3807 — an absent row is not "not mine". A successful TOTP enable always
    // writes one, so a miss means the read did not see what the handler wrote;
    // say so rather than reading the null as "nothing to correct".
    if (!row) {
      console.error(
        '[AuthManager] /two-factor/enable succeeded but no sys_two_factor row was ' +
        `readable for user ${userId}; sys_two_factor.verified could not be confirmed (#10700).`,
      );
      return;
    }
    // Skip only on the exact value the vendor's challenge gate keys on
    // (`verified === false`, strict, in both `totp/index.mjs` and the
    // post-sign-in hook). Anything else — `true`, an un-converted `1`, an
    // absent column — is a value that gate would NOT refuse, so it gets the
    // write. Fail-closed: the cost of a redundant update is one statement; the
    // cost of skipping one is a live unconfirmed secret.
    if (row.verified === false) return;

    await adapter.update({
      model: TWO_FACTOR_MODEL,
      update: { verified: false },
      where: [{ field: 'id', value: row.id }],
    });
  } catch (err: any) {
    console.error(
      '[AuthManager] could not reset sys_two_factor.verified after /two-factor/enable ' +
      `(#10700): ${err?.message ?? err}`,
    );
  }
}
