// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 13] The global before-hook of the better-auth instance
 * `AuthManager` builds — the one `hooks.before` middleware
 * `createAuthInstance` hands better-auth, which every endpoint's request
 * passes through before the endpoint runs — moved out of `auth-manager.ts`
 * whole.
 *
 * A MOVE, not a redesign. The function below is the body of the arrow
 * `createAuthInstance` passes to `createAuthMiddleware` for `hooks.before`, as
 * it stood, re-indented four levels and otherwise unedited: the same actor
 * resolver handed to the attribution scope, the same refresh skip for a minted
 * principal session, the same per-number OTP send guard, the same password
 * complexity and reuse checks, the same change-email capture, the same
 * remove-member, organization-delete and no-record revoke refusals, the same
 * held-caller refusal on the admin plugin's role-scalar actions, the same
 * no-record admin revoke refusal, the same held-caller refusal on rewriting or
 * deleting an identity provider, the same identity-provider registration gate,
 * the same cloud-as-IdP authorization gate, the same break-glass
 * last-local-credential refusal, the same audience posture and uniqueness
 * refusal on password sign-up, the same cloud-managed invite-member refusal,
 * the same account lockout gate, and the same first-user `disableSignUp` flip
 * — in the same order.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which the twelve `auth-manager-*.ts`
 * modules split out before this one follow, applied to a closure as
 * `auth-manager-after-hook.ts` applies it. `createAuthInstance` keeps its
 * place, its docblock and its signature, and `hooks.before` keeps its place in
 * the config literal: the arrow there is now one literal of exactly the
 * {@link BeforeHookHost} members the body reads, plus a `.call`. The `async`
 * moved from that arrow to the function below, and the arrow returns the
 * function's own promise, so the middleware awaits the same promise the body
 * settles, with no extra wrapper.
 *
 * The body's `this` was the manager, the arrow's lexical receiver; it is now
 * that host. Every member it reads but one is a method, and each goes as a
 * closure that calls it on the manager at call time, so a test double or spy
 * set on the manager is still the one the body reaches. `config` goes as a
 * GETTER, because the class reassigns it after construction
 * (`setRuntimeBaseUrl` and `applyConfigPatch`), so the body reads the
 * manager's current one. The
 * arrow builds the host each time better-auth runs the hook, as every method
 * stub in this series does, so nothing the body reads is captured early.
 *
 * The arrow read one local of `createAuthInstance`:
 * `setShouldSkipSessionRefresh`, which the method takes from
 * `better-auth/api` before it builds the literal. It is the function's second
 * parameter, under the same name, and the arrow passes it on each call. The
 * body reads one static, `AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD`
 * (public), so this module imports the class by value, as
 * `auth-manager-membership-admission.ts` does; the one read is inside the
 * function, at call time.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import { isCloudManaged } from '@objectstack/core';
import { VENDOR_ROLE_SCALAR_ADMIN_PATHS } from './admin-impersonate-endpoint.js';
import { setAuthActorResolver } from './auth-actor-attribution.js';
import { AuthManager } from './auth-manager.js';
import { SIGN_IN_EMAIL_PATH } from './auth-session-audit.js';
import { CLOUD_MANAGED_REFUSAL_CODE, CLOUD_MANAGED_REFUSAL_MESSAGES } from './cloud-managed.js';
import {
  isLastLocalCredentialHolder,
  LAST_LOCAL_CREDENTIAL_CODE,
  LAST_LOCAL_CREDENTIAL_MESSAGE,
} from './last-local-credential.js';
import { ORGANIZATION_DELETE_PATH } from './organization-delete.js';
import { carriesPrincipalSession } from './principal-session-mint.js';
import { snapshotRoleChangeGrants, UPDATE_MEMBER_ROLE_PATH } from './role-change-granted-set.js';

/**
 * The `AuthManager` members the function below reads — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too, and naming a member the class does not have is a compile error.
 * `config` is read-only here: the host hands it out through a getter.
 */
export interface BeforeHookHost {
  assertAccountNotLocked: AuthManager['assertAccountNotLocked'];
  assertActorNotHeld: AuthManager['assertActorNotHeld'];
  assertAdminRevokeUserSessionIdentifiesRecord: AuthManager['assertAdminRevokeUserSessionIdentifiesRecord'];
  assertOrganizationDeletable: AuthManager['assertOrganizationDeletable'];
  assertPasswordComplexity: AuthManager['assertPasswordComplexity'];
  assertPasswordNotReused: AuthManager['assertPasswordNotReused'];
  assertPhoneOtpSendAllowed: AuthManager['assertPhoneOtpSendAllowed'];
  assertRemoveMemberPermitted: AuthManager['assertRemoveMemberPermitted'];
  assertRevokeSessionIdentifiesRecord: AuthManager['assertRevokeSessionIdentifiesRecord'];
  readonly config: AuthManager['config'];
  existingAddressSignUpAnswersSuccess: AuthManager['existingAddressSignUpAnswersSuccess'];
  hasExistingUserFor: AuthManager['hasExistingUserFor'];
  isAuthGateActive: AuthManager['isAuthGateActive'];
  isBootstrapCreation: AuthManager['isBootstrapCreation'];
  isOperatorProvisioning: AuthManager['isOperatorProvisioning'];
  isPlatformAdminUserId: AuthManager['isPlatformAdminUserId'];
  resolveActor: AuthManager['resolveActor'];
  resolvePasswordChangeUserId: AuthManager['resolvePasswordChangeUserId'];
  roleChangeGrantDeps: AuthManager['roleChangeGrantDeps'];
  validateAudienceAdmission: AuthManager['validateAudienceAdmission'];
}

/**
 * The body of `createAuthInstance`'s `hooks.before` arrow; the comments there
 * and in it are its contract. `setShouldSkipSessionRefresh` is the
 * `better-auth/api` export of that name the arrow read from `createAuthInstance`.
 */
export async function globalBeforeHook(
  this: BeforeHookHost,
  ctx: any,
  setShouldSkipSessionRefresh: typeof import('better-auth/api').setShouldSkipSessionRefresh,
) {
  // ── #4586: hand the attribution scope its actor resolver ─────
  // FIRST, and unconditionally: this global before-hook is the one
  // seam every better-auth endpoint passes through (`matcher: () =>
  // true`, plugin routes included), and it is the only layer where
  // the session actor exists at all. Registering here is O(1) — the
  // resolver is STORED, not run; the session lookup happens only if
  // a write later asks who to credit, and at most once per request.
  //
  // What travels is `attributedUserId`, which no security middleware
  // reads. The adapter's writes stay `isSystem` (see
  // `withSystemContext`): better-auth already authorized them under
  // its own ACL, and re-authorizing as the human would open the
  // second adjudication track ADR-0095 D3 closed.
  setAuthActorResolver(async () => {
    const actor = await this.resolveActor(ctx);
    return actor?.userId ?? null;
  });

  // ── #23813: a minted principal session is never refreshed ───────
  // Also FIRST: the switch must be set before anything in this
  // request reads the session (the actor resolver above may, later).
  // A renewal of a minted session writes the row and re-sets its
  // cookie, so `bearer()` answers `set-auth-token` on every request
  // and the console re-resolves identity forever. Request-scoped
  // (better-auth's own state), so it reaches the nested session reads
  // of every endpoint on both lanes and in-process — see
  // `principal-session-mint.ts` (3b).
  if (carriesPrincipalSession(ctx)) await setShouldSkipSessionRefresh(true);

  // ── #2780: per-number OTP send guard (admission control) ─────
  // MUST run BEFORE the phone-number endpoints: better-auth's
  // send-otp handler stores a fresh code and only THEN invokes
  // `sendOTP` — a guard that throws inside the callback would
  // still rotate (invalidate) the previously delivered code, so a
  // blocked resend (or an attacker spamming the endpoint) could
  // keep voiding the user's valid OTP. Rejecting here leaves the
  // stored code untouched. Applies uniformly to registered and
  // unregistered numbers (no account-existence oracle).
  if (
    ctx?.path === '/phone-number/send-otp' ||
    ctx?.path === '/phone-number/request-password-reset'
  ) {
    const phone = typeof ctx?.body?.phoneNumber === 'string' ? ctx.body.phoneNumber : '';
    await this.assertPhoneOtpSendAllowed(phone);
  }

  // ── ADR-0069 D1: password complexity (validator) ────────────
  // better-auth enforces only min/max length; class-mix is custom.
  // Runs on the password-mutating endpoints; reads the candidate from
  // the path-appropriate body field (sign-up: `password`; reset /
  // change: `newPassword`).
  if (
    ctx?.path === '/sign-up/email' ||
    ctx?.path === '/reset-password' ||
    ctx?.path === '/change-password'
  ) {
    const candidate =
      (typeof ctx?.body?.password === 'string' && ctx.body.password) ||
      (typeof ctx?.body?.newPassword === 'string' && ctx.body.newPassword) ||
      '';
    if (candidate) await this.assertPasswordComplexity(candidate);

    // ── ADR-0069 D1: password history (reject reuse) ────────────
    // change/reset only (sign-up has no prior history). Reuses
    // better-auth's native password.verify — no bespoke crypto. Stashes
    // the old hash so the after-hook appends it to the bounded ring on
    // success. While an administrator's forced change is outstanding the
    // current password is refused here whatever the history depth. The
    // change door hands over its current-password claim, and the claim gate
    // sits above the history ring as well as the forced change: no
    // `PASSWORD_REUSE` of either kind is given until that claim is confirmed
    // (see the method's docblock).
    if (
      candidate &&
      (ctx?.path === '/reset-password' || ctx?.path === '/change-password')
    ) {
      const userId = await this.resolvePasswordChangeUserId(ctx).catch(() => undefined);
      if (userId) {
        // Stash for the after-hook (password_changed_at stamp), regardless
        // of whether history is enabled.
        ctx.context.__osPwChangeUserId = userId;
        const pw = ctx?.context?.password;
        const verify = typeof pw?.verify === 'function' ? pw.verify.bind(pw) : undefined;
        const currentPassword = ctx?.path === '/change-password'
          ? (typeof ctx?.body?.currentPassword === 'string' ? ctx.body.currentPassword : '')
          : undefined;
        const oldHash = await this.assertPasswordNotReused(userId, candidate, verify, currentPassword);
        if (oldHash !== undefined) ctx.context.__osPwHistory = { userId, oldHash };
      }
    }
    // fall through to the path's own handling below
  }

  // ── #8019: capture the address a change-email would move AWAY from ──
  // The notice goes out from the after-hook, but the OLD address only
  // exists BEFORE the endpoint runs — and `ctx.context.session` is not
  // it: better-auth's own `sensitiveSessionMiddleware` populates that,
  // and endpoint middleware runs AFTER this global before-hook, so the
  // field is still empty here. Resolve the session explicitly, the same
  // hook-order-independent way `/oauth2/authorize` below has to.
  //
  // Stashed, never sent from here: at this point the request has not
  // been accepted yet (it can still fail on `newEmail` equal to the
  // current address, on rate limiting, or on a missing transport), and
  // a notice for a request better-auth then refuses would be a false
  // alarm about an identity move that never happened.
  if (ctx?.path === '/change-email') {
    try {
      const { getSessionFromCtx } = await import('better-auth/api');
      const s: any = await getSessionFromCtx(ctx as any).catch(() => null);
      const from = s?.user?.email;
      if (typeof from === 'string' && from) {
        ctx.context.__osChangeEmailFrom = {
          email: from,
          ...(typeof s?.user?.name === 'string' && s.user.name ? { name: s.user.name } : {}),
          ...(typeof s?.user?.id === 'string' && s.user.id ? { id: s.user.id } : {}),
        };
      }
    } catch {
      // Unresolvable session → no stash → no notice. better-auth's own
      // session middleware still rejects the request with 401, so this
      // never silently drops a notice for a change that proceeds.
    }
  }

  // ── #8289: remove-member answers its PERMISSION denial itself ──
  // better-auth's `removeMember` orders "only an owner may remove an
  // owner" AHEAD of its real permission check and reports it with the
  // sole-owner invariant's code and a 400, so a caller who merely lacks
  // permission is told they "cannot leave the organization as the only
  // owner" — every clause false, and a 400 where every sibling denial is
  // a 403. Answer the permission class here instead; the sole-owner
  // invariant and every 200 path stay the vendor's, untouched.
  // `remove-member-permission-guard.ts` carries the full reading,
  // including why this MUST be a before-hook (an after-hook cannot
  // change the status) and why the guard's refusal set is exactly the
  // vendor's.
  if (ctx?.path === '/organization/remove-member') {
    await this.assertRemoveMemberPermitted(ctx);
    // fall through — the vendor still re-decides everything it owns
  }

  // ── #24948: organization delete refuses while records remain ──
  // Before the vendor's handler, so a refused delete writes nothing:
  // the vendor clears the caller's active organization and deletes the
  // members before its own `beforeDeleteOrganization` hook runs.
  // `organization-delete.ts` carries the contract.
  if (ctx?.path === ORGANIZATION_DELETE_PATH) {
    await this.assertOrganizationDeletable(ctx);
    // fall through — the vendor still authorizes and deletes
  }

  // ── #9714: a revoke that identifies NO record must not report ──
  // success. better-auth 1.7.1's `revoke-session` handler skips the
  // delete when the token matches zero rows (or another user's row)
  // and still answers `200 { status: true }` — its success line is
  // unconditional. Refuse those requests HERE, with the vendor's own
  // admission predicate asked through the vendor's own adapter call,
  // so the handler only ever runs on requests whose success answer is
  // true. Before-hook on purpose: an after-hook cannot change the
  // status. `revoke-session-match-guard.ts` carries the full reading,
  // including the 404-over-`{status:false}` decision and the
  // no-existence-oracle property.
  if (ctx?.path === '/revoke-session') {
    await this.assertRevokeSessionIdentifiesRecord(ctx);
    // fall through — the vendor still performs the revoke itself
  }

  // ── ADR-0069 D3: the admin plugin's role-scalar actions refuse a ──
  // caller the authentication policy holds. better-auth serves these
  // itself and authorizes them on a session plus the legacy `role`
  // scalar, so no ObjectStack judge runs and nothing on the path read
  // the posture: measured on a real boot, a held caller carrying that
  // scalar was admitted to every one of them, writes included. The
  // refusal is the session gate's, asked of the session gate's own
  // posture carrier (`assertActorNotHeld`), and it runs FIRST — before
  // the vendor's authorization and before the record guard below — the
  // order the session gate applies. No resolvable session falls through
  // to the vendor's own 401. `VENDOR_ROLE_SCALAR_ADMIN_PATHS`
  // (`admin-impersonate-endpoint.ts`) classifies every other path the
  // plugin registers. With no gate feature active the posture holds no
  // one, so the session read is skipped, as the transport seams skip it
  // (`isAuthGateActive`, the same caches the computation reads).
  if (VENDOR_ROLE_SCALAR_ADMIN_PATHS.has(ctx?.path) && this.isAuthGateActive()) {
    const actor = await this.resolveActor(ctx);
    if (actor?.userId) await this.assertActorNotHeld(actor);
    // fall through — the vendor still authorizes everything it owns
  }

  // ── #10069: the ADMIN revoke that identifies NO record must not ──
  // report success either. better-auth 1.7.1's `admin/revoke-user-
  // session` handler calls `deleteSession(ctx.body.sessionToken)`
  // blindly and answers `200 { success: true }` unconditionally —
  // measured on this pipeline: zero-match AND already-revoked tokens
  // both answered success. NOT the #9714 predicate: no ownership
  // dimension here (the caller is an admin acting on arbitrary
  // users) — the question is only "does any session carry this
  // token", and it is asked AFTER the vendor's own permission
  // question so non-admins keep the vendor's 401/403 and gain no
  // existence oracle. Before-hook on purpose: an after-hook cannot
  // change the status. `admin-revoke-user-session-match-guard.ts`
  // carries the full reading.
  if (ctx?.path === '/admin/revoke-user-session') {
    await this.assertAdminRevokeUserSessionIdentifiesRecord(ctx);
    // fall through — the vendor still performs the revoke itself
  }

  // ── ADR-0069 D3: nor may a held caller rewrite or delete one ──────
  // `@better-auth/sso` lets a provider's OWNER (who, past the
  // registration gate below, is a platform admin) update its issuer,
  // endpoints and secrets or delete it, on a session alone. Measured on
  // a real boot: a held platform admin who owned a provider rewrote its
  // issuer to another host (200, landed) and deleted another (200, row
  // gone) — login routing, rewritten by a caller the policy holds. The
  // same refusal as registration, asked the same way; the vendor still
  // decides who may manage the provider.
  if (
    (ctx?.path === '/sso/update-provider' || ctx?.path === '/sso/delete-provider') &&
    this.isAuthGateActive()
  ) {
    const actor = await this.resolveActor(ctx);
    if (actor?.userId) await this.assertActorNotHeld(actor);
    // fall through — the vendor's own provider-access check still runs
  }

  // ── ADR-0135 D6 + ADR-0068 D4: registering an identity provider is ──
  // a PLATFORM-OPERATOR action.
  //
  // `@better-auth/sso`'s POST /sso/register only checks org-admin when
  // `body.organizationId` is present (index.mjs: `if (ctx.body
  // .organizationId) { … hasOrgAdminRole … }`). A GLOBAL (org-less)
  // provider therefore passes with nothing but a valid session — so any
  // authenticated member can register an env-wide external IdP, a JIT-
  // provisioning / login-routing vector. So ObjectStack decides the
  // authorization here, regardless of whether `organizationId` is
  // supplied.
  //
  // [#10009] The admit set is PLATFORM ADMIN ONLY — the same posture
  // #9653 landed on the `/admin/sso/*` bridges. It previously ALSO
  // admitted an owner/admin of the caller's active org, and that gap
  // made the bridge tightening honest labelling rather than a boundary:
  // one principal, refused 403 at `/admin/sso/register` and admitted
  // here, for the same underlying registration. Maintainer ruling
  // 2026-08-20 closed the wider door (ADR-0068 D4 — platform-operator
  // actions gate on the platform admin, sole operator). An org-scoped
  // self-serve channel for org-scoped providers is a deliberate FUTURE
  // ruling if multi-org IdP self-serve becomes a product goal — it is
  // not the vendor default, inherited by omission.
  //
  // Unauthenticated requests fall through to better-auth's
  // `sessionMiddleware` (→ 401). Fail-CLOSED: an unverifiable actor is
  // denied. (D5.1's `/oauth2/authorize` gate is a different surface —
  // the OP issuing codes, not the env's RP config.)
  //
  // ADR-0069 D3: a caller the authentication policy holds is refused
  // FIRST, with the session gate's refusal (`assertActorNotHeld`) —
  // identity, then posture, then the platform-admin question, the order
  // `judgePlatformAdmin` applies on the `/admin/sso/*` bridges. Measured
  // on a real boot before this: a held platform admin's registration
  // answered `200` and the provider row landed, in every held state.
  if (ctx?.path === '/sso/register') {
    const actor = await this.resolveActor(ctx);
    if (actor?.userId) {
      await this.assertActorNotHeld(actor);
      const ok = await this.isPlatformAdminUserId(actor.userId);
      if (!ok) {
        const { APIError } = await import('better-auth/api');
        throw new APIError('FORBIDDEN', {
          message: 'Only a platform admin can register an SSO provider.',
          code: 'SSO_REGISTER_FORBIDDEN',
        });
      }
    }
    return;
  }

  // ── D5.1: cloud-as-IdP authorization gate ───────────────────
  // On the OIDC OP's /oauth2/authorize, when a host gate is set
  // (cloud control plane), an AUTHENTICATED subject must be
  // authorized for the requesting client (env) before a code is
  // issued — this enforces org-membership (app-assignment). Unset
  // (open editions / self-host) → no gate. Unauthenticated → fall
  // through so the OP redirects to login; the gate runs on the
  // return pass (or immediately for a bearer/cookie session).
  //
  // [#8102] The acting subject is resolved through the shared,
  // hook-order-independent {@link resolveActor} — NOT a second inline
  // copy of it. This branch used to carry its own token lookup, line
  // for line the same logic, and the two diverged the moment one was
  // fixed: #8101 taught `resolveActor` to strip the signature from a
  // bearer credential (`session.token` stores the UNSIGNED value while
  // `bearer()` hands clients the SIGNED form in `set-auth-token`), and
  // the copy here kept looking the signed credential up verbatim. It
  // resolved nothing — and because the unresolved case is deliberately
  // fail-open, an AUTHENTICATED caller on the documented API lane was
  // read as unauthenticated and this env-access check never evaluated
  // at all. Two resolution sites are what let them diverge, so the fix
  // is to delete one, not to correct it in place.
  if (ctx?.path === '/oauth2/authorize' && this.config.oidcAuthorizeGate) {
    const clientId = ctx?.query?.client_id;
    if (clientId) {
      const actor = await this.resolveActor(ctx);
      // Unauthenticated → fall through, per the contract above. Only an
      // AUTHENTICATED subject is gated here. `resolveActor` also returns
      // `activeOrgId`; this gate deliberately does not consume it — the
      // D5.1 host contract is `(userId, clientId)` and the control plane
      // derives org membership / app assignment from the user itself.
      if (actor?.userId) {
        const allowed = await this.config.oidcAuthorizeGate({
          userId: actor.userId,
          clientId: String(clientId),
        });
        if (!allowed) {
          const { APIError } = await import('better-auth/api');
          throw new APIError('FORBIDDEN', {
            message: 'You are not authorized to sign in to this environment.',
            code: 'ENV_ACCESS_DENIED',
          });
        }
      }
    }
    return;
  }

  // ── Break-glass: never remove the LAST local-password login ──────
  // Under enforced SSO the managed team holds no local credential; the
  // env owner / a local admin keeps one as the break-glass escape hatch
  // so an IdP outage can never lock the org out. Refuse to delete or
  // ban the last user holding a `credential` account. Generic over the
  // IdP. Managed (credential-less) users are unaffected. Fail-open on
  // lookup hiccups (a transient query error must not block legit ops).
  if (
    ctx?.path === '/delete-user' ||
    ctx?.path === '/admin/remove-user' ||
    ctx?.path === '/admin/ban-user'
  ) {
    // ⚠️ `/admin/ban-user` no longer reaches this hook — #9652 mounts an
    // ObjectStack raw route on that path ahead of the catch-all (the
    // ADR-0068 gate better-auth cannot express), so the request never
    // enters better-auth's router. The path stays listed here because
    // the mount is conditional on the admin plugin, and because the
    // guard itself now lives in ONE module both call sites share —
    // `last-local-credential.ts`, whose header records this trap.
    //
    // ⚠️ `/admin/remove-user` IS ALSO SHADED NOW (commit 6dd3e6968) — and it DOES
    // still reach this hook, which is the opposite of the line above
    // and is the point. Its mount only runs `gateAdmin` and then
    // RE-DISPATCHES the request through `handleRequest`, so it re-enters
    // better-auth's router and this hook fires exactly as before —
    // just AFTER authorization instead of before it. That is the whole
    // fix: an authenticated non-admin is now refused by the mount and
    // never reaches the lookup below, while an admitted platform admin
    // reaches the identical lookup and the identical `CONFLICT`.
    // ⛔ Do not "reconcile" the two notes by deleting this path from
    // the list — that would silently drop the guard on the one route
    // that still depends on this hook to run it.
    // ── [#10776] AUTHENTICATE FIRST ────────────────────────────
    // A `hooks.before` runs AHEAD of the endpoint's own
    // `use: [adminMiddleware]`, and that middleware is the only layer
    // establishing identity on this lane. So this guard used to read an
    // unauthenticated request's body, ask the database a question about
    // the named user, and answer it — a per-record answer to a caller
    // nobody had authenticated, where every sibling `/admin/` route
    // answers 401. Resolving the actor first makes the guard's decision
    // (and its distinctive refusal) reachable only once the caller has
    // an identity; an anonymous caller falls through to the vendor's own
    // `sessionMiddleware`/`adminMiddleware` and hears the ordinary 401.
    //
    // Maintainer ruling 2026-08-22 (decision-inbox digest, accepted
    // verbatim 「接受所有」): option A, authentication before the guard.
    //
    // ⚠️ This changes WHEN the guard decides, never WHAT it decides:
    // an authenticated caller reaches exactly the same lookup and the
    // same `CONFLICT`. `break-glass-guard-authentication-order.test.ts`
    // pins both halves — the disclosure closing AND the invariant
    // surviving — because closing the first by deleting the guard would
    // satisfy a disclosure-only suite.
    //
    // Same shape as the `/oauth2/authorize` gate above: unauthenticated
    // → fall through, never a refusal invented here.
    const breakGlassActor = await this.resolveActor(ctx);

    let isLastLocalCredential = false;
    if (breakGlassActor?.userId) {
      try {
        // `/delete-user` names no target in the vendor's own contract:
        // the subject IS the authenticated caller. That must hold
        // UNCONDITIONALLY — a body-supplied `userId` on this
        // self-service route is never the target, present or not.
        // (A prior `if (!targetId && …)` form let a body value win
        // whenever one was supplied, turning the guard's refusal into
        // a per-record oracle over the break-glass holder for any
        // authenticated caller, not just the caller acting on
        // themselves. `/admin/remove-user` and `/admin/ban-user`
        // legitimately name a target in their own contract, so only
        // this route's resolution is keyed on the actor instead of
        // the body.)
        const targetId: string | undefined =
          ctx.path === '/delete-user'
            ? breakGlassActor.userId
            : (ctx?.body?.userId ?? ctx?.body?.user_id);
        if (targetId) {
          isLastLocalCredential = await isLastLocalCredentialHolder(
            ctx.context.adapter,
            targetId,
          );
        }
      } catch {
        // Fail-open — never block a legitimate op on a lookup error.
      }
    }
    if (isLastLocalCredential) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('CONFLICT', {
        message: LAST_LOCAL_CREDENTIAL_MESSAGE,
        code: LAST_LOCAL_CREDENTIAL_CODE,
      });
    }
    // fall through to better-auth's own handler
  }

  // ── [#11739] Audience posture on the PASSWORD sign-up route ──
  // The DECISION is validateAudienceAdmission — the same single owner
  // the user.validateUserInfo gate calls for every creation path.
  // This route alone needs the refusal raised HERE, before the
  // handler: better-auth's sign-up route wraps createUser in an
  // anti-enumeration shield (dist/api/routes/sign-up.mjs:163,235 —
  // `shouldReturnGenericDuplicateResponse`, on whenever
  // requireEmailVerification is on) that converts ANY 403 from the
  // creation seam into a synthetic 200 "success". Correct for
  // account-existence oracles; wrong for an audience refusal, which
  // is deterministic per (posture, domain, invitation) and reveals
  // nothing about any account — swallowed, it would turn the domain
  // gate's refusal into a silent black hole (fake success, no
  // verification mail ever). Measured: with posture `open`/
  // `email_domain` (verification forced on) the validateUserInfo
  // refusal came back 200 `{token:null,user:{synthetic}}`. The
  // validateUserInfo gate stays wired for this route too — the
  // decision is idempotent, so the second ask cannot disagree.
  if (ctx?.path === '/sign-up/email') {
    const refusal = await this.validateAudienceAdmission(
      {
        user: {
          ...(typeof ctx?.body?.email === 'string'
            ? { email: ctx.body.email.toLowerCase() }
            : {}),
        },
        source: { action: 'create-user', method: 'email-password' },
      },
      ctx,
    );
    if (refusal) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('FORBIDDEN', {
        code: refusal.error,
        message: refusal.errorDescription ?? refusal.error,
      });
    }

    // ── [#15587] The UNIQUENESS refusal, raised here for the same
    // reason the audience refusal above is — and STRICTLY after it.
    //
    // Same shield, its other arm. `shouldReturnGenericDuplicateResponse`
    // (better-auth 1.7.12 sign-up.mjs:155) is on whenever
    // `requireEmailVerification` is on OR `autoSignIn === false`, and it
    // guards TWO sites: the 403 catch at :227 (what the audience block
    // above steps around) and the duplicate pre-check at :192–204. On
    // the second, the vendor finds the
    // existing row, logs it, and returns `buildGenericDuplicateResponse()`
    // — a 200 carrying a freshly `generateId()`-ed user that is never
    // written — INSTEAD of throwing USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL.
    //
    // We turn that shield on ourselves: a posture that permits
    // self-registration forces `requireEmailVerification` on by default
    // (see `createAuthInstance` — always under `email_domain`, and under
    // `open` unless the deployment declared it off, #20389), so
    // `email_domain` and `open` sign-ups for an address that already
    // exists answered 200 while `invite_only` answered 422 on the same
    // population. Measured on a real ObjectQL
    // engine with the posture held CONSTANT and only the verification flag
    // moved, so the divergence is the flag's, not the posture's: zero
    // inserts reach the engine, no `sys_account` appears, and the next
    // sign-in is 401 with nothing anywhere explaining it. The silent
    // success shape, on the recovery path a locked-out deployment walks.
    //
    // ORDER IS LOAD-BEARING: this runs only for a caller the posture
    // ALREADY ADMITTED. Asking it first would hand an uninvited stranger
    // an account-existence oracle under the `invite_only` DEFAULT (422 for
    // a real address vs 403 for an unknown one) — inventing on the closed
    // posture exactly what the vendor's shield exists to prevent. After
    // the gate, `invite_only` is untouched: a stranger still gets
    // SELF_REGISTRATION_CLOSED and learns nothing.
    //
    // [#25060, ruling 1B on #25040] ONE exception, decided here and
    // nowhere else ({@link existingAddressSignUpAnswersSuccess}): under
    // `open` and `email_domain`, where the vendor's shield is on and a
    // mail transport is live, the request FALLS THROUGH. The vendor then
    // finds the row, answers its generic success — the same shape a new
    // sign-up gets there, and no row, credential or session is written —
    // and its `onExistingUserSignUp` hook mails the address's holder
    // ({@link sendExistingAccountSignUpNotice}). Every other case keeps
    // the explicit refusal: `invite_only`, a shield that is off (a new
    // sign-up's answer there carries a session, which an existing
    // address cannot mirror without one for someone else's account), and
    // a transport that is not live (a success with no mail is the black
    // hole this refusal replaced). The refusal is the platform's at this
    // one seam, so it never depends on the vendor also refusing; where
    // the vendor would have answered, its code and message are the
    // vendor's OWN constant, so the two lanes are byte-identical by
    // construction rather than by copying.
    const signUpAddress = typeof ctx?.body?.email === 'string' ? ctx.body.email : '';
    if (signUpAddress && (await this.hasExistingUserFor(signUpAddress))) {
      if (!this.existingAddressSignUpAnswersSuccess(ctx?.context?.options?.emailAndPassword)) {
        const { APIError, BASE_ERROR_CODES } = await import('@better-auth/core/error');
        throw APIError.from(
          'UNPROCESSABLE_ENTITY',
          BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL,
        );
      }
      // The answer will carry a user id that no row holds: tell the
      // after-hook, so it stamps nothing on that id (it would report a
      // lost write for a user that was never created).
      if (ctx?.context) ctx.context.__osExistingAddressSignUp = true;
    }
    // fall through — the vendor still decides everything it owns
  }

  // ── [#25083] cloud-managed: invite-member issues nothing ────
  // `beforeCreateInvitation` refuses a NEW invitation, but
  // better-auth answers `resend: true` for an invitee who is
  // already pending BEFORE it consults that hook: it extends the
  // row's `expiresAt` and sends the invitation e-mail again
  // (`organization/routes/crud-invites.mjs`, better-auth 1.7.12).
  // The console reaches exactly that branch through
  // `sys_invitation`'s `resend_invitation` action. On a
  // cloud-managed environment no invitation leaves this door in
  // either shape, so the route refuses ahead of the vendor's
  // handler; the hook keeps its own arm as the second line. The
  // fact is public (`features.cloudManaged` on `/auth/config`), so
  // answering it ahead of the session check tells an anonymous
  // caller nothing new.
  if (ctx?.path === '/organization/invite-member' && isCloudManaged()) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('CONFLICT', {
      message: CLOUD_MANAGED_REFUSAL_MESSAGES.invitation,
      code: CLOUD_MANAGED_REFUSAL_CODE,
    });
  }

  // ── #27862: read the member's org-admin grants before a role change ──
  // The after hook compares them with what the change left held and names
  // the set it granted (see `role-change-granted-set.ts`). A read only: it
  // gates nothing, and a read that fails stashes nothing.
  if (ctx?.path === UPDATE_MEMBER_ROLE_PATH) {
    const roleChangeDeps = this.roleChangeGrantDeps();
    if (roleChangeDeps) await snapshotRoleChangeGrants(ctx, roleChangeDeps);
  }

  // ── ADR-0069 D2: account lockout (gate) ─────────────────────
  // Reject a sign-in for a locked identity BEFORE better-auth checks
  // the password — a lock must hold even against the correct password.
  // The refusal is a refused sign-in, so it writes its `login_failed`
  // row (`auth-session-audit.ts`, account events) before it throws.
  if (ctx?.path === SIGN_IN_EMAIL_PATH) {
    const email = typeof ctx?.body?.email === 'string' ? ctx.body.email : '';
    if (email) await this.assertAccountNotLocked(email, ctx);
    return;
  }

  if (ctx?.path !== '/sign-up/email') return;
  const ep = ctx?.context?.options?.emailAndPassword;
  if (!ep?.disableSignUp) return;
  // [#11767] Same population question, same owner. This site used to
  // ask `ctx.context.adapter.findOne({ model: 'user', where: [] })`,
  // which the real ObjectQL engine REFUSES (#4419 —
  // `requireFindOnePredicate`) rather than answers; the surrounding
  // `catch` read that refusal as "users exist" and the declared
  // bypass never fired on a real deployment. `isBootstrapCreation`
  // owns the answerable form — see its doc.
  // [#14157] …and the deployment's own boot command provisioning its
  // admin is the OTHER way through this door. It is not a
  // self-registration and must not depend on a self-registration
  // carve-out: an app that seeds people makes the bootstrap probe
  // answer "populated" before the seed ever runs. Cheap synchronous
  // check first, so the ticket path costs no I/O.
  // [#14373] The email alone no longer admits — see
  // `stageOperatorProvisioning`'s doc. `ctx.body` is the vendor's own
  // zod-validated body, which keeps any key outside the declared
  // schema (`signUpEmailBodySchema.and(z.record(...))`), so the
  // in-process seed call's ticket field survives here untouched.
  const signUpEmail = typeof ctx?.body?.email === 'string' ? ctx.body.email : undefined;
  const provisioningTicket = ctx?.body?.[AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD];
  if (
    this.isOperatorProvisioning(signUpEmail, provisioningTicket) ||
    (await this.isBootstrapCreation())
  ) {
    ctx.context.__osDisableSignUpOrig = ep.disableSignUp;
    ep.disableSignUp = false;
  }
}
