// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 12] The global after-hook of the better-auth instance
 * `AuthManager` builds — the one `hooks.after` middleware `createAuthInstance`
 * hands better-auth, which every endpoint's response passes through — moved
 * out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the arrow
 * `createAuthInstance` passes to `createAuthMiddleware` for `hooks.after`, as
 * it stood, re-indented four levels and otherwise unedited: the same bearer
 * rotation on impersonation, the same echo of the installed session token,
 * the same session envelope completion, the same two-factor re-enrolment
 * reset, the same sign-in outcome count, refusal audit, concurrent-session cap
 * and login stamp, the same password-change stamp and history commit, the
 * same old-address notice on an e-mail change, the same directory doors
 * narrowed for an external caller, the same invite-role refusal code, and the
 * same sign-up stamp and `disableSignUp` restore — in the same order.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which the eleven `auth-manager-*.ts`
 * modules split out before this one follow, applied to a closure instead of a
 * method. `createAuthInstance` keeps its place, its docblock and its
 * signature, and `hooks.after` keeps its place in the config literal: the
 * arrow there is now one literal of exactly the {@link AfterHookHost} members
 * the body reads, plus a `.call`. The `async` moved from that arrow to the
 * function below, and the arrow returns the function's own promise, so the
 * middleware awaits the same promise the body settles, with no extra wrapper.
 *
 * The body's `this` was the manager, the arrow's lexical receiver; it is now
 * that host. Every member it reads is a method, and each goes as a closure
 * that calls it on the manager at call time, so a test double or spy set on
 * the manager is still the one the body reaches. The arrow builds the host
 * each time better-auth runs the hook, as every method stub in this series
 * does, so nothing the body reads is captured early. The arrow read no local
 * of `createAuthInstance`, so the function takes the same one parameter.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { AuthManager } from './auth-manager.js';
import { SIGN_IN_EMAIL_PATH } from './auth-session-audit.js';
import { narrowDirectoryForExternalCaller } from './external-directory-door.js';
import { rotateCallerBearerOnImpersonation } from './impersonation-bearer-rotation.js';
import { stampInvitationDeliveryOutcome } from './invitation-delivery-outcome.js';
import { retireExpiredInvitationsOnReissue } from './invitation-expired-supersede.js';
import { codeInviteRoleNotFound } from './invite-role-not-found-code.js';
import { readRequestClientAddress } from './request-client-address.js';
import { stampRoleChangeGrantedSet } from './role-change-granted-set.js';
import { attachSessionToCredentialResponse } from './session-envelope-completion.js';
import { resetVerifiedOnTwoFactorReenrollment } from './two-factor-reenrollment-verified-reset.js';
import { echoInstalledSessionToken } from './two-factor-rotated-token-echo.js';

/**
 * The `AuthManager` members the function below reads — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too, and naming a member the class does not have is a compile error.
 */
export interface AfterHookHost {
  auditRefusedSignIn: AuthManager['auditRefusedSignIn'];
  enforceConcurrentCap: AuthManager['enforceConcurrentCap'];
  externalDirectoryDoorDeps: AuthManager['externalDirectoryDoorDeps'];
  isEmailDeliveryLive: AuthManager['isEmailDeliveryLive'];
  recordPasswordHistory: AuthManager['recordPasswordHistory'];
  recordSignInOutcome: AuthManager['recordSignInOutcome'];
  roleChangeGrantDeps: AuthManager['roleChangeGrantDeps'];
  sendChangeEmailNotice: AuthManager['sendChangeEmailNotice'];
  stampLastLogin: AuthManager['stampLastLogin'];
  stampPasswordChangedAt: AuthManager['stampPasswordChangedAt'];
}

/** The body of `createAuthInstance`'s `hooks.after` arrow; the comments there and in it are its contract. */
export async function globalAfterHook(this: AfterHookHost, ctx: any) {
  // ── #8243: impersonation must actually take effect for a bearer ──
  // FIRST among the after-hooks that touch the response, because the
  // bearer plugin's own after-hook runs behind this one and must see
  // what we stage: it re-reads `Access-Control-Expose-Headers` to add
  // `set-auth-token`, so the recovery header we expose here survives
  // only by being merged before it. See
  // `impersonation-bearer-rotation.ts` for the mechanism — the short
  // version is that `bearer()` converts the caller's token back into
  // the ADMIN's session cookie on every later request, so without
  // rotating that token, `/admin/impersonate-user` is a 200 no-op.
  await rotateCallerBearerOnImpersonation(ctx);

  // ── #10701: a 2FA verification must echo the session it INSTALLED ─
  // On the enrolment lane `/two-factor/verify-totp` rotates the
  // caller's session and then echoes the PRE-rotation token — the row
  // it just deleted. A client that stores it (the console's
  // `auth-session-token` pattern) is holding a revoked credential, and
  // because `bearer()` overwrites the request cookie with whatever the
  // Authorization header carries, presenting it destroys the valid
  // rotated cookie too. See `two-factor-rotated-token-echo.ts`. This
  // corrects the echoed VALUE only; resolver precedence is untouched.
  await echoInstalledSessionToken(ctx);

  // ── #17234: complete the SessionResponse envelope with the session
  // the route just committed ────────────────────────────────────────
  // `/sign-in/email` and `/sign-up/email` answer `{ token, user }`
  // (plus `redirect` on sign-in) with no `session` member anywhere in
  // the body or the headers, so `SessionResponseSchema` never parsed
  // either method's return value. The session is not absent — it is
  // the row `internalAdapter.createSession` already committed before
  // the endpoint returned — so this reads it back by the response's
  // own token, the same seam `/get-session` uses, and attaches it.
  // See `session-envelope-completion.ts` for the full measurement and
  // why this can never fabricate an id or an expiry.
  await attachSessionToCredentialResponse(ctx);

  // ── #10700: `verified` must describe the secret stored beside it ──
  // A second `/two-factor/enable` on an already-confirmed account
  // rewrites the TOTP secret on the one `sys_two_factor` row the
  // account has and INHERITS `verified` from the enrollment before it,
  // so a secret nobody confirmed is honoured at the sign-in challenge.
  // better-auth already gates that challenge on the flag — a first
  // enrollment is inert until the session-lane verify flips it — so
  // restoring the flag restores the gate rather than adding a second
  // one. See `two-factor-reenrollment-verified-reset.ts`, whose header
  // also states what this deliberately does NOT do.
  await resetVerifiedOnTwoFactorReenrollment(ctx);

  // ── ADR-0069 D2: account lockout (counter) ──────────────────
  // better-auth catches an INVALID_EMAIL_OR_PASSWORD APIError and runs
  // the after-hook with it on `ctx.context.returned`; a success leaves
  // the session payload there. Count failures, reset on success.
  if (ctx?.path === SIGN_IN_EMAIL_PATH) {
    const email = typeof ctx?.body?.email === 'string' ? ctx.body.email : '';
    if (email) {
      let succeeded = true;
      try {
        const { isAPIError } = await import('better-auth/api');
        succeeded = !isAPIError(ctx?.context?.returned);
      } catch {
        succeeded = !(ctx?.context?.returned instanceof Error);
      }
      const lockStamped = await this.recordSignInOutcome(email, succeeded);
      // A refused sign-in writes `login_failed`, and the one that
      // stamped the lockout also writes `account_locked`. A successful
      // one is recorded as `login` by the session hook, unchanged.
      if (!succeeded) await this.auditRefusedSignIn(ctx, email, lockStamped);
      if (succeeded) {
        const uid = ctx?.context?.returned?.user?.id;
        if (typeof uid === 'string') await this.enforceConcurrentCap(uid);
        // ADR-0069 D7 — login audit: stamp last_login_at/ip on success.
        // Independent of lockout config (recordSignInOutcome no-ops when
        // lockout is off). The IP is the address `handleRequest`
        // established for this request by the client-address trust rule,
        // the same address the D5 allow-list judged; none when it was
        // undetermined. ⛔ Never re-read from a header here.
        if (typeof uid === 'string') {
          await this.stampLastLogin(uid, await readRequestClientAddress());
        }
      }
    }
    return;
  }

  // ── ADR-0069 D1: on a successful change/reset — stamp
  //    password_changed_at (expiry) and commit password history.
  if (ctx?.path === '/change-password' || ctx?.path === '/reset-password') {
    let succeeded: boolean;
    try {
      const { isAPIError } = await import('better-auth/api');
      succeeded = !isAPIError(ctx?.context?.returned);
    } catch {
      succeeded = !(ctx?.context?.returned instanceof Error);
    }
    if (succeeded) {
      const stampId = ctx?.context?.__osPwChangeUserId;
      if (stampId) await this.stampPasswordChangedAt(stampId);
      const stash = ctx?.context?.__osPwHistory;
      if (stash?.userId) await this.recordPasswordHistory(stash.userId, stash.oldHash);
    }
    delete ctx.context.__osPwChangeUserId;
    delete ctx.context.__osPwHistory;
    return;
  }

  // ── #8019: tell the OLD address, without gating on it ──────────────
  // Maintainer ruling 2026-08-12 — 「notify the OLD address — do not
  // gate on it」. See the `changeEmail` config site for why this cannot
  // be `sendChangeEmailConfirmation` (that option IS the gate).
  //
  // Why HERE is the whole design:
  //   • after-hook ⇒ better-auth has already produced its response, so
  //     nothing this code does can change the endpoint's outcome. The
  //     "does not gate" property is structural, not a promise;
  //   • gated on success ⇒ a refused request sends nothing;
  //   • `sendChangeEmailNotice` swallows its own failures ⇒ a dead
  //     mailbox, an unseeded template or a missing transport cannot
  //     turn the notification into a block. That inversion — a security
  //     notice that takes the flow down with it — is precisely the
  //     failure mode the ruling exists to avoid.
  //
  // Sent at REQUEST time, which is also the strongest moment available:
  // the owner learns while the attacker still has to prove control of
  // the new mailbox, so the warning arrives inside the window where it
  // can still be acted on. It is also the only moment that exists
  // exactly once per attempt — the apply step (`GET /verify-email`)
  // does not carry the old address, and better-auth mints a fresh
  // session there when the link is opened without one, so an
  // apply-time notice would silently miss that path.
  if (ctx?.path === '/change-email') {
    const from = ctx?.context?.__osChangeEmailFrom;
    delete ctx.context.__osChangeEmailFrom;
    let succeeded: boolean;
    try {
      const { isAPIError } = await import('better-auth/api');
      succeeded = !isAPIError(ctx?.context?.returned);
    } catch {
      succeeded = !(ctx?.context?.returned instanceof Error);
    }
    const newEmail = typeof ctx?.body?.newEmail === 'string' ? ctx.body.newEmail : '';
    if (succeeded && from?.email && newEmail) {
      // #14319 — the notice goes to the account owner, who IS the
      // caller here, so the request rung applies.
      await this.sendChangeEmailNotice(from, newEmail, ctx);
    }
    return;
  }

  // ── Ruling 6355206139 E2: the directory doors, narrowed for an external ──
  // list-members, get-full-organization, list-teams and list-invitations
  // check membership only, so an `external` caller would read every
  // fellow member, team and pending invitation there. See
  // `external-directory-door.ts`.
  await narrowDirectoryForExternalCaller(ctx, this.externalDirectoryDoorDeps());

  // ── #27843: invite-member says whether its mail was delivered ──
  // A success answers `outcome: 'sent' | 'link_only'` beside the
  // invitation row, by the one deliverability rule sign-up uses (see
  // `invitation-delivery-outcome.ts`). A refusal passes untouched.
  await stampInvitationDeliveryOutcome(ctx, () => this.isEmailDeliveryLive());

  // ── #28540: a new invitation retires the person's expired pending one ──
  // The vendor skips an expired row when it looks for one to renew, so a
  // resend (or an invite) on it issues a new invitation; the expired row is
  // moved to `expired` here, so the Pending list holds one row per person
  // (see `invitation-expired-supersede.ts`). A refusal retires nothing.
  await retireExpiredInvitationsOnReissue(ctx);

  // ── #27862: a role change names the permission set it granted ──
  // The before hook read the member's org-admin grants; a success that
  // left a new one held answers `outcome: 'permission_set_granted'` and
  // `grantedPermissionSet: { name, label }` beside the member row (see
  // `role-change-granted-set.ts`). A refusal passes untouched.
  const roleChangeDeps = this.roleChangeGrantDeps();
  if (roleChangeDeps) await stampRoleChangeGrantedSet(ctx, roleChangeDeps);

  // ── #24750: invite-member's unknown-role refusal carries its code ──
  // better-auth throws it with only a message; the spec promises
  // `ROLE_NOT_FOUND` (see `invite-role-not-found-code.ts`). It throws
  // on a match, so it stays after every section above.
  await codeInviteRoleNotFound(ctx);

  if (ctx?.path !== '/sign-up/email') return;
  // ADR-0069 D1 — stamp password_changed_at for a newly-created local
  // user (expiry clock starts at sign-up). Best-effort.
  {
    const newUserId = ctx?.context?.returned?.user?.id;
    let signupOk: boolean;
    try {
      const { isAPIError } = await import('better-auth/api');
      signupOk = !isAPIError(ctx?.context?.returned);
    } catch {
      signupOk = !(ctx?.context?.returned instanceof Error);
    }
    // [#25060] Not for an existing address answered as a success: that
    // answer's user id belongs to no row, and nothing was created.
    if (signupOk && typeof newUserId === 'string' && ctx?.context?.__osExistingAddressSignUp !== true) {
      await this.stampPasswordChangedAt(newUserId);
    }
  }
  const ep = ctx?.context?.options?.emailAndPassword;
  if (ep && ctx.context.__osDisableSignUpOrig !== undefined) {
    ep.disableSignUp = ctx.context.__osDisableSignUpOrig;
    delete ctx.context.__osDisableSignUpOrig;
  }
}
