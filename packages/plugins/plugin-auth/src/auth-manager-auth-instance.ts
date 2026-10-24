// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 14] The better-auth instance `AuthManager` builds — the body of
 * its private `createAuthInstance()` method, which `getOrCreateAuth()` calls
 * once per build — moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. The function below is that method's body as it
 * stood, re-indented one level and otherwise unedited: the same deferred
 * `better-auth` and `better-auth/api` imports, the same plugin list and
 * password hasher, the same config literal (secret, origin and base path, app
 * name, database, the `user`, `account` and `verification` model configs, the
 * social providers, `emailAndPassword` with its reset-password and sign-up
 * callbacks, the e-mail verification block, `session`, rate limiting and
 * secondary storage, the plugins, the composed database hooks, the global
 * `hooks.before` and `hooks.after` middleware, `onAPIError`, the trusted
 * origins and `advanced`), the same `betterAuth()` call, and the same wait on
 * `auth.$context` before the instance is returned — in the same order. The two
 * global hooks were moved out by cuts 12 and 13; their two arrows, which hand
 * those bodies their hosts, move here with the rest of the literal.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which the thirteen `auth-manager-*.ts`
 * modules split out before this one follow. `createAuthInstance` keeps its
 * place, its docblock, its signature and its return type in the class; its
 * body is now one literal of exactly the {@link AuthInstanceHost} members the
 * body reads, plus a `.call`. The `async` moved from the method to the
 * function below, and the method returns the function's own promise.
 *
 * The body's `this` was the manager; it is now that host. Every member it
 * reads but two is a method, and each goes as a closure that calls it on the
 * manager at call time, so a test double or spy set on the manager is still
 * the one the body reaches. The two fields go as GETTERS: `config`, because
 * the class reassigns it after construction (`setRuntimeBaseUrl` and
 * `applyConfigPatch`), and `idpLocale`, as every field this series carries
 * goes, so the body reads the manager's current value whenever it reads one —
 * including from the callbacks it hands better-auth, which run long after this
 * function returns. The method builds the host each time it is called, as
 * every method stub in this series does.
 *
 * The two hook arrows inside the literal build their own hosts from `this`,
 * which is now this host: each of their closures calls this host's closure,
 * which calls the manager's method, so they reach the same member at the same
 * moment as before. `readDisableSignUpEnv` is the one top-level helper of
 * `auth-manager.ts` the body reads; it is exported in place there, per ruling
 * 6364006498 (A), and imported here by value. `src/index.ts` names its
 * `auth-manager.ts` exports one by one, so that export publishes nothing.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { Auth, BetterAuthOptions } from 'better-auth';
import { audiencePermitsSelfRegistration } from '@objectstack/spec/system';
import { readEnvWithDeprecation } from '@objectstack/types';
import { readAccountInvitation, settleImportResetDelivery } from './account-invitation-marker.js';
import { resolveEmailVerificationRequirement } from './audience-posture.js';
import { globalAfterHook, type AfterHookHost } from './auth-manager-after-hook.js';
import { globalBeforeHook, type BeforeHookHost } from './auth-manager-before-hook.js';
import { readDisableSignUpEnv, type AuthManager } from './auth-manager.js';
import {
  AUTH_ACCOUNT_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_USER_CONFIG,
  AUTH_VERIFICATION_CONFIG,
} from './auth-schema-config.js';
import { vendorClientAddressOptions } from './client-address-vendor.js';
import { PLATFORM_IDP_PROVIDER_ID, refuseImplicitAccountLink } from './implicit-account-linking.js';
import { isPlaceholderEmail } from './placeholder-email.js';

/**
 * The `AuthManager` members the function below reads — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too, and naming a member the class does not have is a compile error.
 * `config` and `idpLocale` are read-only here: the host hands them out
 * through getters.
 */
export interface AuthInstanceHost {
  assertAccountNotLocked: AuthManager['assertAccountNotLocked'];
  assertActorNotHeld: AuthManager['assertActorNotHeld'];
  assertAdminRevokeUserSessionIdentifiesRecord: AuthManager['assertAdminRevokeUserSessionIdentifiesRecord'];
  assertOrganizationDeletable: AuthManager['assertOrganizationDeletable'];
  assertPasswordComplexity: AuthManager['assertPasswordComplexity'];
  assertPasswordNotReused: AuthManager['assertPasswordNotReused'];
  assertPhoneOtpSendAllowed: AuthManager['assertPhoneOtpSendAllowed'];
  assertRemoveMemberPermitted: AuthManager['assertRemoveMemberPermitted'];
  assertRevokeSessionIdentifiesRecord: AuthManager['assertRevokeSessionIdentifiesRecord'];
  auditRefusedSignIn: AuthManager['auditRefusedSignIn'];
  buildPluginList: AuthManager['buildPluginList'];
  composeDatabaseHooks: AuthManager['composeDatabaseHooks'];
  readonly config: AuthManager['config'];
  configuredBasePath: AuthManager['configuredBasePath'];
  createDatabaseConfig: AuthManager['createDatabaseConfig'];
  emailLocaleArg: AuthManager['emailLocaleArg'];
  enforceConcurrentCap: AuthManager['enforceConcurrentCap'];
  existingAddressSignUpAnswersSuccess: AuthManager['existingAddressSignUpAnswersSuccess'];
  externalDirectoryDoorDeps: AuthManager['externalDirectoryDoorDeps'];
  getAppName: AuthManager['getAppName'];
  getAudience: AuthManager['getAudience'];
  getCanonicalOrigin: AuthManager['getCanonicalOrigin'];
  getConsolePageUrl: AuthManager['getConsolePageUrl'];
  getEmailService: AuthManager['getEmailService'];
  hasExistingUserFor: AuthManager['hasExistingUserFor'];
  readonly idpLocale: AuthManager['idpLocale'];
  implicitLinkRequiresLocalEmailVerified: AuthManager['implicitLinkRequiresLocalEmailVerified'];
  isAuthGateActive: AuthManager['isAuthGateActive'];
  isBootstrapCreation: AuthManager['isBootstrapCreation'];
  isOperatorProvisioning: AuthManager['isOperatorProvisioning'];
  isPlatformAdminUserId: AuthManager['isPlatformAdminUserId'];
  isSsoWired: AuthManager['isSsoWired'];
  linkingContext: AuthManager['linkingContext'];
  recordPasswordHistory: AuthManager['recordPasswordHistory'];
  recordSignInOutcome: AuthManager['recordSignInOutcome'];
  resolveActor: AuthManager['resolveActor'];
  resolveAuthSecret: AuthManager['resolveAuthSecret'];
  resolvePasswordChangeUserId: AuthManager['resolvePasswordChangeUserId'];
  resolvePasswordHasher: AuthManager['resolvePasswordHasher'];
  sendChangeEmailNotice: AuthManager['sendChangeEmailNotice'];
  sendExistingAccountSignUpNotice: AuthManager['sendExistingAccountSignUpNotice'];
  signUpForcedOff: AuthManager['signUpForcedOff'];
  ssoDiscoveryTrustedOrigins: AuthManager['ssoDiscoveryTrustedOrigins'];
  stampLastLogin: AuthManager['stampLastLogin'];
  stampPasswordChangedAt: AuthManager['stampPasswordChangedAt'];
  storedRecipientLocale: AuthManager['storedRecipientLocale'];
  validateAudienceAdmission: AuthManager['validateAudienceAdmission'];
}

/**
 * The body of `AuthManager.createAuthInstance()`; the method's docblock and
 * the comments in it are its contract.
 */
export async function createAuthInstance(this: AuthInstanceHost): Promise<Auth<any>> {
  const { betterAuth } = await import('better-auth');
  const { createAuthMiddleware, setShouldSkipSessionRefresh } = await import('better-auth/api');
  const plugins = await this.buildPluginList();
  const passwordHasher = await this.resolvePasswordHasher();
  const betterAuthConfig: BetterAuthOptions = {
    // Base configuration
    secret: this.resolveAuthSecret(),
    // Absolute origin (getCanonicalOrigin prepends https:// when baseUrl is a
    // bare host) so the reset-password / verify-email / magic-link URLs
    // better-auth derives from baseURL are always clickable links.
    baseURL: this.getCanonicalOrigin(),
    basePath: this.configuredBasePath(),
    // The deployment's product name, from the one authority every auth
    // email already reads (`getAppName()`: the `branding.workspace_name`
    // override, else the configured `appName`, else 'ObjectStack').
    // better-auth 1.7.12 (re-read 2026-10-21 for #25096) reads this key once,
    // into its context's `appName` (unset ⇒ "Better Auth"), and reads that
    // in exactly two places: the
    // issuer and label prefix of the otpauth URI that `/two-factor/enable`
    // and `/two-factor/get-totp-uri` answer. No cookie name derives from it
    // (the prefix is the literal "better-auth") and nothing stores it, so an
    // authenticator enrolled under the old label keeps producing codes that
    // verify: the issuer is a display label beside an unchanged secret.
    //
    // Read when this instance is built. A later branding rename reaches the
    // issuer only when the instance is rebuilt (a config patch or a
    // restart), while auth emails call `getAppName()` on every send.
    appName: this.getAppName(),

    // Database adapter configuration
    database: await this.createDatabaseConfig(),

    // Model/field mapping: camelCase (better-auth) → snake_case (ObjectStack)
    // These declarations tell better-auth the actual table/column names used
    // by ObjectStack's protocol layer, enabling automatic transformation via
    // createAdapterFactory.
    user: {
      ...AUTH_USER_CONFIG,
      // NOTE: the env-side AI-seat marker `sys_user.ai_access` is deliberately
      // NOT declared as a better-auth additionalField. sys_user is a
      // better-auth-MANAGED table and better-auth SELECTs explicit columns, so
      // declaring it here would make getSession query a column that may not
      // exist on every env yet → broken auth. Instead the column is owned by
      // the objectql `SysUser` object def (provisioned by boot schema-sync)
      // and read by a GUARDED system query in resolveCtx (can only no-op,
      // never break auth). better-auth stays oblivious to the extra column.

      // ── #7735 — self-service email change, ON with verification ────────
      // better-auth ships `changeEmail` OFF, so `POST /change-email` answered
      // 400 CHANGE_EMAIL_DISABLED on every deployment while
      // `auth-route-ledger.ts` booked the route as a live SDK surface. The
      // ledger was right about the product and wrong about the runtime;
      // maintainer ruling 2026-08-12 settled it by making the runtime true:
      // 「`user.changeEmail` 在 plugin-auth 配置开启,带验证流程(变更需确认,
      // 策略按 better-auth 常规)」.
      //
      // THE FLOW, as better-auth 1.7 actually implements it (read off
      // `better-auth/dist/api/routes/update-user.mjs`, not off the docs):
      //   1. `POST /change-email {newEmail}` mints a JWT carrying
      //      `{ email: current, updateTo: newEmail, requestType:
      //      'change-email-verification' }` and hands it to
      //      `emailVerification.sendVerificationEmail` — the same callback
      //      (and `auth.verify_email` template) sign-up verification uses,
      //      addressed to the NEW address. Nothing is written yet.
      //   2. `GET /verify-email?token=…` applies it: `updateUserByEmail(old,
      //      { email: newEmail, emailVerified: true })`, then re-issues the
      //      session cookie on the new identity.
      // So the change is confirmed by proving control of the new mailbox —
      // 「变更需确认」 — and an unclicked request changes nothing.
      //
      // TWO OPTIONS DELIBERATELY LEFT AT THEIR DEFAULTS, because each is a
      // policy this ruling did not decide:
      //   • `updateEmailWithoutVerification` — would let a user whose CURRENT
      //     address is unverified swap emails with no confirmation at all.
      //     That is the one thing the ruling names; leaving it false keeps
      //     every path confirmed.
      //   • `sendChangeEmailConfirmation` — better-auth's opt-in EXTRA step
      //     that asks the OLD address to approve first (old → new, two
      //     clicks). Stronger against a hijacked session, and it needs a
      //     decision about which address is authoritative plus its own
      //     template; 「策略按 better-auth 常规」 is the single-step default,
      //     so the two-step variant stays a deliberate future design.
      //
      // ── #8019 — the OLD address is NOTIFIED, and still not gated ───────
      // Maintainer ruling 2026-08-12 (later the same day, and deliberately
      // narrower than the one above): 「notify the OLD address — do not gate
      // on it」. #7735's ruling keeps governing the CONFIRMATION option; this
      // one adds only the notice. So `sendChangeEmailConfirmation` stays
      // absent above — and that is a measured decision, not an omission:
      //
      //   `user.changeEmail` declares EXACTLY three members: `enabled`,
      //   `sendChangeEmailConfirmation`, and `updateEmailWithoutVerification`.
      //   Measured 2026-08-20 against the installed
      //   `@better-auth/core@1.7.1`, in the file the package actually SHIPS —
      //   `dist/types/init-options.d.mts:835-857`. (The previous stamp cited
      //   `src/types/init-options.ts:946-971`; no `src/` is published, so
      //   that reference could not be checked by anyone reading it.)
      //   There is NO notify-only hook, and
      //   `sendChangeEmailConfirmation` is not one: in better-auth 1.7.1's
      //   `dist/api/routes/update-user.mjs:457` it becomes
      //   `canSendConfirmation`, and the branch opening at `:496` RETURNS at
      //   `:505` right after invoking it — the new address is never mailed
      //   until the old one clicks. Setting it is therefore structurally the
      //   approval gate the ruling refuses, not a way to notify.
      //
      // The notice is consequently sent by the framework, from the global
      // `after` hook on `/change-email` (search `__osChangeEmailFrom`), using
      // the `auth.email_change_notice` template. It is failure-isolated by
      // construction: it runs after better-auth has already produced the
      // response, and its own errors are swallowed, so a dead mailbox cannot
      // turn a notification into a block. That is the "do not gate" half,
      // enforced mechanically rather than promised in prose.
      //
      // No email transport wired ⇒ the `emailVerification` block below is
      // absent ⇒ better-auth answers 400 "Verification email isn't enabled".
      // That is the honest answer for a deployment with no mailbox, and a
      // different sentence from "the platform does not offer this".
      //
      // The write itself already worked: `sys_user.email` is schema-`readonly`
      // and the readonly-strip drops non-system updates, but the adapter runs
      // better-auth's own writes as system (#3164, `withSystemContext` in
      // objectql-adapter.ts), so the applied change persists.
      //
      // ⛔ `deleteUser` is NOT configured here, by the same ruling — see the
      // `disabled` row for `POST /api/v1/auth/delete-user` in
      // `auth-route-ledger.ts` for why, and for what has to be decided first.
      changeEmail: {
        enabled: true,
      },

      // ── [#11739] Audience posture — THE enforcement point ──────────────
      // better-auth's own admission gate, invoked by internalAdapter
      // .createUser for EVERY creation path with a method-discriminated
      // `source` (email-password, oauth, sso-oidc/saml, magic-link,
      // email-otp, phone-number, anonymous, admin, scim, …), failing CLOSED
      // by vendor construction. One seam, one owner — see
      // `audience-posture.ts` for the decision semantics, the pinned
      // domain-matching rules, and the creation-class table.
      //
      // The same seam also carries the implicit-account-linking gate: the
      // vendor calls it with `action: 'link-account'` right before an
      // implicit link is written — see `implicit-account-linking.ts`. The
      // audience gate judges only `create-user`, so the two never answer
      // the same call.
      //
      // It is also where better-auth hands over the IdP's raw profile, so
      // the profile's `locale` claim is STAGED here, refusing nothing; the
      // session the sign-in mints settles it (`idp-locale-claim.ts`).
      validateUserInfo: async (data: any, ctx: any) => {
        this.idpLocale.stage(data, ctx);
        return (await refuseImplicitAccountLink(data, ctx, {
          requireLocalEmailVerified: this.implicitLinkRequiresLocalEmailVerified(),
          resolveContext: () => this.linkingContext(),
          logInfo: (m, meta) => this.config.logger?.info?.(m, meta),
        })) ?? this.validateAudienceAdmission(data, ctx);
      },
    },
    account: {
      ...AUTH_ACCOUNT_CONFIG,
      // Implicit account linking: an OAuth / OIDC / SSO sign-in whose
      // identity is not linked yet, but whose email matches an existing
      // local user, links to that user. The rules — every provider needs a
      // VERIFIED local row, except the platform's own cloud IdP
      // (`PLATFORM_IDP_PROVIDER_ID`, whose owner-seeded rows are born
      // `emailVerified=false`), and a user's unlink is honoured — are
      // enforced in `refuseImplicitAccountLink` (the `validateUserInfo`
      // seam above). Why there, and why the vendor flag below is pinned
      // `false` by default: `implicit-account-linking.ts`, module header.
      //
      // Custom-deployment consumers can extend the trusted set via
      // `config.account.accountLinking.trustedProviders`; we always
      // include `objectstack-cloud` because it is the platform IdP.
      // Trust relaxes only the IdP-side `email_verified` clause; it never
      // relaxes the local-verification requirement.
      accountLinking: {
        enabled: true,
        ...((this.config as any)?.account?.accountLinking ?? {}),
        // better-auth's flag is ONE global boolean with no per-provider
        // form, so it cannot carry the cloud exception: `true` would refuse
        // the cloud owner row before our gate runs. It is therefore `false`
        // unless the operator explicitly asked for the strict form for
        // EVERY provider (`true`), and the requirement itself is enforced
        // by our gate (`implicitLinkRequiresLocalEmailVerified`).
        requireLocalEmailVerified:
          (this.config as any)?.account?.accountLinking?.requireLocalEmailVerified === true,
        trustedProviders: Array.from(new Set([
          PLATFORM_IDP_PROVIDER_ID,
          ...((this.config as any)?.account?.accountLinking?.trustedProviders ?? []),
        ])),
      },
    },
    verification: {
      ...AUTH_VERIFICATION_CONFIG,
      // A host `secondaryStorage` would otherwise make the cache the ONLY
      // home of every verification value (better-auth drops the
      // `verification` model from the schema), and the implicit-linking
      // unlink records (`implicit-account-linking.ts`) must be durable: an
      // evicted record re-opens implicit re-linking without a sound. With
      // `storeInDatabase` every verification value is a `sys_verification`
      // row — exactly what it is when no `secondaryStorage` is configured,
      // ObjectStack's default — and the cache only fronts it.
      ...(this.config.secondaryStorage ? { storeInDatabase: true } : {}),
    },

    // Social / OAuth providers
    ...(this.config.socialProviders ? { socialProviders: this.config.socialProviders as any } : {}),

    // Email and password configuration.
    // `disableSignUp`: env overrides config/settings so deployments can
    // lock the registration policy without relying on UI state.
    emailAndPassword: (() => {
      const disableSignUpFromEnv = readDisableSignUpEnv();
      // SSO-only ("enforced") and a cloud-managed environment force
      // self-registration off (see `signUpForcedOff`). `enabled` stays true
      // so the break-glass password endpoint keeps working for the env
      // owner / local admin.
      const effectiveDisableSignUp = this.signUpForcedOff()
        ? true
        : (disableSignUpFromEnv ?? this.config.emailAndPassword?.disableSignUp);
      return {
        enabled: this.config.emailAndPassword?.enabled ?? true,
        ...(passwordHasher ? { password: passwordHasher } : {}),
        ...(effectiveDisableSignUp != null
          ? { disableSignUp: effectiveDisableSignUp } : {}),
        // [#11739] Invariant: a posture that permits self-registration
        // (email_domain / open) FORCES email verification on — an
        // unverified allowlisted-domain signup is colleague impersonation
        // and makes the domain gate decorative. [#20389] One exception:
        // under `open` the deployment may declare it off with an explicit
        // `false`. The entry validation (assertAudienceConfig) already
        // refused every other explicit false, so this never overrides a
        // value it accepted; getPublicConfig() reads the SAME resolver, so
        // the advertised flag cannot disagree with the wired one.
        ...((() => {
          const posture = this.getAudience().posture;
          const declared = this.config.emailAndPassword?.requireEmailVerification;
          return audiencePermitsSelfRegistration(posture) || declared != null
            ? { requireEmailVerification: resolveEmailVerificationRequirement(posture, declared) }
            : {};
        })()),
        ...(this.config.emailAndPassword?.minPasswordLength != null
          ? { minPasswordLength: this.config.emailAndPassword.minPasswordLength } : {}),
        ...(this.config.emailAndPassword?.maxPasswordLength != null
          ? { maxPasswordLength: this.config.emailAndPassword.maxPasswordLength } : {}),
        ...(this.config.emailAndPassword?.resetPasswordTokenExpiresIn != null
          ? { resetPasswordTokenExpiresIn: this.config.emailAndPassword.resetPasswordTokenExpiresIn } : {}),
        ...(this.config.emailAndPassword?.autoSignIn != null
          ? { autoSignIn: this.config.emailAndPassword.autoSignIn } : {}),
        ...(this.config.emailAndPassword?.revokeSessionsOnPasswordReset != null
          ? { revokeSessionsOnPasswordReset: this.config.emailAndPassword.revokeSessionsOnPasswordReset } : {}),
      // #14319 — better-auth calls this as `sendResetPassword(data, ctx.request)`.
      // [#23598] better-auth CATCHES what this callback throws
      // (`runInBackgroundOrAwait`) and still answers `{ status: true }`, so a
      // failed send can never reach the identity import that asked for it.
      // `settleImportResetDelivery` settles the import's own delivery receipt
      // with the outcome (and re-raises it unchanged); a call that carries a
      // `Request` — the public door — is handed straight through.
      // `account-invitation-marker.ts` holds the legs that keep it server-only.
      sendResetPassword: async ({ user, url, token }: { user: { id: string; email: string; name?: string }; url: string; token: string }, request?: unknown) => settleImportResetDelivery(user.email, request, async () => {
        // #2766 V1.5 — placeholder addresses (phone-only users) are never
        // real recipients. Refuse loudly instead of "sending" into the void;
        // the reset path for these users is phone sign-in / an admin
        // set-user-password, not email.
        if (isPlaceholderEmail(user.email)) {
          throw new Error(
            `Password-reset email refused: ${user.email} is a placeholder address (PLACEHOLDER_EMAIL). ` +
            'This account has no real mailbox — use an admin password reset instead.',
          );
        }
        const email = this.getEmailService();
        if (!email) {
          // No transport wired but password reset is enabled — a
          // misconfiguration. THROW (don't silently drop): better-auth
          // invokes this via `runInBackgroundOrAwait` and the forget-password
          // route always returns `{status:true}`, so this never leaks whether
          // an address exists AND never turns the request into a 500 — it just
          // surfaces the failure in the logs instead of vanishing.
          throw new Error(
            `Password-reset email could not be sent to ${user.email}: no email service is configured for this deployment.`,
          );
        }
        // The lifetime the token in `url` really has: better-auth mints it
        // with `resetPasswordTokenExpiresIn || 3600` seconds (better-auth
        // 1.7.12 `routes/password.mjs`, re-measured 2026-10-21 for #25096) — `||`, so a configured `0` is its
        // default too, and the mail must not say "0 minutes" for it.
        const ttlSec = this.config.emailAndPassword?.resetPasswordTokenExpiresIn || 60 * 60;
        // [#23343] An account an administrator created (the identity
        // import) is INVITED through this same reset mint, because
        // better-auth hands the link to nobody but this callback. The import
        // marks its own request; that one send names the new account and
        // its inviter instead of a reset nobody asked for. Every other
        // reset — above all a public `POST /request-password-reset`, which
        // always carries its Request — reads no marker and sends
        // `auth.password_reset` exactly as before. The marker's header
        // (`account-invitation-marker.ts`) holds the four legs that keep it
        // server-only, and why it rides better-auth's request state.
        const invitation = await readAccountInvitation(user.email, request);
        // Surface both template-resolution throws and transport failures
        // (status:'failed'); resilience is preserved by better-auth's
        // background-task handling (see sendVerificationEmail) and the
        // forget-password route always returns {status:true}, so this never
        // leaks whether an address exists nor turns the request into a 500.
        // commit 35e94c96b — the ladder's stored rung. It matters most HERE: an
        // admin-initiated send (`admin-import-users.ts` calls
        // `requestPasswordReset` server-side) reaches this callback with NO
        // request at all (measured on 1.7.3, #23343; unchanged on 1.7.12,
        // re-read for #25096), so without this rung
        // the user's mail carries only the deployment default. Best-effort;
        // `undefined` leaves the #14319 ladder exactly as it was.
        const storedLocale = await this.storedRecipientLocale({ id: user.id });
        // [ADR-0131 D7, ruling of record 6257510973, Q2 A] Both mails are
        // about a person, not an organization: identity mail, recorded in
        // the deployment-level `sys_identity_email`, with no organization.
        const result = await email.sendTemplate(invitation
          ? {
            // Exactly the variables `auth.account_invitation` declares —
            // what the import really holds, and nothing it does not (no
            // organization, no role). No request rung on the locale: the
            // marker is honoured only when there is no request, and the one
            // that started the import is the ADMIN's anyway.
            template: 'auth.account_invitation',
            to: { address: user.email, ...(user.name ? { name: user.name } : {}) },
            ...this.emailLocaleArg(undefined, storedLocale),
            data: {
              user: { name: user.name || user.email, email: user.email },
              inviter: { name: invitation.inviter.name, email: invitation.inviter.email },
              setPasswordUrl: url,
              expiresInMinutes: Math.round(ttlSec / 60),
              appName: this.getAppName(),
            },
            relatedObject: 'sys_user',
            relatedId: user.id,
            identityMail: true,
          }
          : {
            template: 'auth.password_reset',
            to: { address: user.email, ...(user.name ? { name: user.name } : {}) },
            ...this.emailLocaleArg(request, storedLocale),
            data: {
              user: { name: user.name || user.email, email: user.email, id: user.id },
              resetUrl: url,
              token,
              expiresInMinutes: Math.round(ttlSec / 60),
              appName: this.getAppName(),
            },
            relatedObject: 'sys_user',
            relatedId: user.id,
            identityMail: true,
          });
        if (result?.status === 'failed') {
          throw new Error(
            `${invitation ? 'Account-invitation' : 'Password-reset'} email could not be sent to ${user.email}: ${result.error ?? 'delivery failed'}`,
          );
        }
      }),
      // [#25060, ruling 1B on #25040] The mail half of "a sign-up for an
      // address that already has an account answers like a success". The
      // vendor calls this only when the address already has a row AND its
      // anti-enumeration shield is on, after its timing-equalizing password
      // hash, and awaits it inline (no background-task handler is set);
      // what it throws is caught and logged by the vendor, and the answer is
      // its generic success either way (better-auth 1.7.12
      // `routes/sign-up.mjs`, re-read for #25060). So the DECISION cannot
      // live here: it is made first, in the `/sign-up/email` before-hook,
      // which keeps the explicit refusal wherever this mail could not be
      // promised. This hands over the existing row, which is what the
      // recipient's stored-locale rung needs.
      onExistingUserSignUp: async ({ user }: { user: { id: string; email: string; name?: string | null } }) =>
        this.sendExistingAccountSignUpNotice(user),
      };
    })(),

    // Email verification
    ...(this.config.emailVerification || this.config.emailService ? {
      emailVerification: {
        ...(this.config.emailVerification?.sendOnSignUp != null
          ? { sendOnSignUp: this.config.emailVerification.sendOnSignUp } : {}),
        ...(this.config.emailVerification?.sendOnSignIn != null
          ? { sendOnSignIn: this.config.emailVerification.sendOnSignIn } : {}),
        ...(this.config.emailVerification?.autoSignInAfterVerification != null
          ? { autoSignInAfterVerification: this.config.emailVerification.autoSignInAfterVerification } : {}),
        ...(this.config.emailVerification?.expiresIn != null
          ? { expiresIn: this.config.emailVerification.expiresIn } : {}),
        // #14319 — better-auth calls this as `sendVerificationEmail(data, ctx.request)`.
        sendVerificationEmail: async ({ user, url, token }: { user: { id: string; email: string; name?: string }; url: string; token: string }, request?: unknown) => {
          const email = this.getEmailService();
          if (!email) {
            // Verification is enabled (this callback only exists when it is)
            // but no email transport is wired — a misconfiguration, not a
            // transient blip. THROW so the explicit `/send-verification-email`
            // resend endpoint (which awaits this) surfaces a real error
            // instead of a false "email sent" success. Sign-up stays
            // resilient regardless: better-auth runs the sendOnSignUp call
            // through `runInBackgroundOrAwait`, which logs (never rethrows)
            // a failure, so the account is still created and the user lands
            // on the verify screen (where an honest resend now reports the
            // problem). Previously this was swallowed, leaving every user
            // permanently stuck with no signal and no resend that could work.
            throw new Error(
              `Verification email could not be sent to ${user.email}: no email service is configured for this deployment.`,
            );
          }
          const ttlSec = this.config.emailVerification?.expiresIn ?? 60 * 60;
          // Let send failures propagate (see above): sendTemplate THROWS on
          // template/loader errors, and returns status:'failed' on transport
          // errors — surface both so resend is honest and signup stays
          // resilient via better-auth's background-task error handling.
          // commit 35e94c96b — the stored rung, same ladder as the reset above. An
          // admin re-triggering verification for a user is the same
          // requester-is-not-the-recipient shape.
          const storedLocale = await this.storedRecipientLocale({ id: user.id });
          const result = await email.sendTemplate({
            template: 'auth.verify_email',
            to: { address: user.email, ...(user.name ? { name: user.name } : {}) },
            ...this.emailLocaleArg(request, storedLocale),
            data: {
              user: { name: user.name || user.email, email: user.email, id: user.id },
              verificationUrl: url,
              token,
              expiresInMinutes: Math.round(ttlSec / 60),
              appName: this.getAppName(),
            },
            relatedObject: 'sys_user',
            relatedId: user.id,
            // [ADR-0131 D7, Q2 A] The mail is about a person, who may belong
            // to no organization yet: identity mail, in `sys_identity_email`.
            identityMail: true,
          });
          if (result?.status === 'failed') {
            throw new Error(
              `Verification email could not be sent to ${user.email}: ${result.error ?? 'delivery failed'}`,
            );
          }
        },
      },
    } : {}),

    // Session configuration
    //
    // ⚠️ `session.cookieCache` is the OTHER door into the architecture #4785
    // rejected, and it is deliberately not opened here. What that costs, and
    // what is actually known about it, measured 2026-08-27 against the
    // installed better-auth `1.7.1` (read out of `node_modules`, never off
    // the `^1.7.1` range) — each claim names the file it came from so a
    // version bump is re-checkable one grep at a time:
    //
    //  - **The failure DIRECTION is the sibling's.** With `cookieCache`
    //    enabled, `/get-session` answers from a signed payload in the
    //    client's own `session_data` cookie and returns before any adapter
    //    read (`dist/api/routes/session.mjs:48-130`). ObjectStack revokes by
    //    writing the `sys_session` row — `enforceSessionControls` /
    //    `enforceConcurrentCap` stamp `revoked_at` + a past `expires_at`
    //    (ADR-0069 D4), and `hideRevokedSessionRow` hides a tombstoned row
    //    from better-auth's reads (`session-tombstone.ts`). All of it is
    //    read-path enforcement, so for as long as the cookie answers, a
    //    revoked session keeps authenticating and nobody gets an error. Same
    //    silent direction as `secondaryStorage` (see `secondary-storage.ts`).
    //
    //  - ⭐ **The REACH is materially smaller, and saying so is the point.**
    //    Three differences, all measured, not inferred:
    //    1. The session of RECORD does not move. `cookieCache` is read-side
    //       only — `createSession` still writes the `sys_session` row, so
    //       admin session lists, the concurrent-cap count and D4's audit
    //       trail all stay correct. `secondaryStorage` skips the row.
    //    2. The staleness window is BOUNDED and per-client:
    //       `cookieCache.maxAge`, default 300s (`dist/cookies/index.mjs:50`,
    //       `:99`). It cannot be extended without a database read either —
    //       better-auth force-disables the stateless `refreshCache` whenever
    //       a `database` is configured, which ObjectStack always does
    //       (`dist/context/create-context.mjs:149-165`). Under
    //       `secondaryStorage` the cache IS the record and the window has no
    //       bound at all.
    //    3. Sensitive operations already bypass it: better-auth's own
    //       `getAuthoritativeSessionFromCtx` / `sensitiveSessionMiddleware`
    //       re-read with `disableCookieCache: true` when a `database` is
    //       configured (`dist/api/routes/session.mjs:270-280`). There is no
    //       equivalent escape from `secondaryStorage`.
    //
    //  - **It is not reachable from ObjectStack config today, by
    //    construction rather than by refusal.** The spec's
    //    `AuthConfigSchema.session` declares `expiresIn` / `updateAge` only,
    //    and this block reads only those two, so a `cookieCache` key on
    //    `AuthManagerOptions.session` is DROPPED, not honoured — pinned
    //    end-of-chain in `session-of-record.test.ts`. The one way in is
    //    `authInstance`, where the host has replaced this whole config.
    //
    // ⛔ So this is a disclosed cost on a door a host must build to reach —
    // NOT a guard, and deliberately not one. The #4785 posture is opt-in with
    // the cost stated (maintainer ruling 2026-08-27), the same posture
    // `cacheSecondaryStorage()` is exported under. Plumbing `cookieCache`
    // through is therefore a decision that re-opens #4785, not a feature: it
    // would trade D4's revocation latency for request latency, and the trade
    // has to be made deliberately, by a maintainer, with the window written
    // down. If you are here to add it, that ruling is what you need first.
    session: {
      ...AUTH_SESSION_CONFIG,
      expiresIn: this.config.session?.expiresIn || 60 * 60 * 24 * 7, // 7 days default
      updateAge: this.config.session?.updateAge || 60 * 60 * 24, // 1 day default
    },

    // ADR-0069 D2 — per-IP rate limiting (native). Only set when configured
    // so better-auth keeps its own defaults otherwise. The settings bind
    // supplies stricter `customRules` for the auth endpoints.
    //
    // Where the counters live, in precedence order:
    //  1. a host-supplied `secondaryStorage` → better-auth's own
    //     `storage: 'secondary-storage'` (unchanged behaviour);
    //  2. otherwise `rateLimitStorage` → `customStorage`, the counters-only
    //     seam AuthPlugin fills with the lazily-resolved kernel cache
    //     (#4772). better-auth ignores `storage` when `customStorage` is set.
    // Neither → better-auth's per-process 'memory' default.
    ...(this.config.rateLimit || this.config.secondaryStorage || this.config.rateLimitStorage
      ? {
          rateLimit: {
            ...(this.config.rateLimit ?? {}),
            ...(this.config.secondaryStorage
              ? { storage: 'secondary-storage' as const }
              : this.config.rateLimitStorage
                ? { customStorage: this.config.rateLimitStorage }
                : {}),
          },
        }
      : {}),

    // ADR-0069 D2 — shared KV for cross-node rate-limit + session state.
    ...(this.config.secondaryStorage ? { secondaryStorage: this.config.secondaryStorage } : {}),

    // better-auth plugins — registered based on AuthPluginConfig flags
    plugins,

    // Database hooks (fired by better-auth's adapter writes — the ONE seam
    // every user-creation path flows through, SSO JIT-provisioning included).
    // ADR-0093 D2 makes that seam the single owner of the user-lifecycle
    // invariants; see the `databaseHooks` option doc for why, and for the
    // #4802 correction of the "adapter bypasses ObjectQL middleware" claim
    // this comment used to carry. The framework's identity-source stamp
    // (`account.create.after`) is always composed in, preserving any
    // host-supplied hooks.
    databaseHooks: this.composeDatabaseHooks(this.config.databaseHooks),

    // Bootstrap bypass for `disableSignUp`. The first-run owner wizard
    // (`/_account/setup`) calls `POST /auth/sign-up/email` to create
    // the very first user — if `OS_DISABLE_SIGNUP=true` is set on a
    // fresh install we'd lock the operator out of their own instance.
    // Solution: when the request hits `/sign-up/email` AND no users
    // exist yet, temporarily flip `disableSignUp` off for *this*
    // request's context. Once the owner is created the next request
    // sees `userCount > 0` and the toggle is enforced again.
    hooks: {
      // [#25224 cut 13] The body moved to `auth-manager-before-hook.ts`; this
      // arrow hands it the members it reads (`BeforeHookHost`) and the one
      // local it read, `setShouldSkipSessionRefresh`.
      before: createAuthMiddleware((ctx: any) => {
        const readConfig = () => this.config;
        const host: BeforeHookHost = {
          assertAccountNotLocked: (...a) => this.assertAccountNotLocked(...a),
          assertActorNotHeld: (...a) => this.assertActorNotHeld(...a),
          assertAdminRevokeUserSessionIdentifiesRecord: (...a) => this.assertAdminRevokeUserSessionIdentifiesRecord(...a),
          assertOrganizationDeletable: (...a) => this.assertOrganizationDeletable(...a),
          assertPasswordComplexity: (...a) => this.assertPasswordComplexity(...a),
          assertPasswordNotReused: (...a) => this.assertPasswordNotReused(...a),
          assertPhoneOtpSendAllowed: (...a) => this.assertPhoneOtpSendAllowed(...a),
          assertRemoveMemberPermitted: (...a) => this.assertRemoveMemberPermitted(...a),
          assertRevokeSessionIdentifiesRecord: (...a) => this.assertRevokeSessionIdentifiesRecord(...a),
          get config() { return readConfig(); },
          existingAddressSignUpAnswersSuccess: (...a) => this.existingAddressSignUpAnswersSuccess(...a),
          hasExistingUserFor: (...a) => this.hasExistingUserFor(...a),
          isAuthGateActive: (...a) => this.isAuthGateActive(...a),
          isBootstrapCreation: (...a) => this.isBootstrapCreation(...a),
          isOperatorProvisioning: (...a) => this.isOperatorProvisioning(...a),
          isPlatformAdminUserId: (...a) => this.isPlatformAdminUserId(...a),
          resolveActor: (...a) => this.resolveActor(...a),
          resolvePasswordChangeUserId: (...a) => this.resolvePasswordChangeUserId(...a),
          validateAudienceAdmission: (...a) => this.validateAudienceAdmission(...a),
        };
        return globalBeforeHook.call(host, ctx, setShouldSkipSessionRefresh);
      }),
      // [#25224 cut 12] The body moved to `auth-manager-after-hook.ts`; this
      // arrow hands it the members it reads (`AfterHookHost`).
      after: createAuthMiddleware((ctx: any) => {
        const host: AfterHookHost = {
          auditRefusedSignIn: (...a) => this.auditRefusedSignIn(...a),
          enforceConcurrentCap: (...a) => this.enforceConcurrentCap(...a),
          externalDirectoryDoorDeps: (...a) => this.externalDirectoryDoorDeps(...a),
          recordPasswordHistory: (...a) => this.recordPasswordHistory(...a),
          recordSignInOutcome: (...a) => this.recordSignInOutcome(...a),
          sendChangeEmailNotice: (...a) => this.sendChangeEmailNotice(...a),
          stampLastLogin: (...a) => this.stampLastLogin(...a),
          stampPasswordChangedAt: (...a) => this.stampPasswordChangedAt(...a),
        };
        return globalAfterHook.call(host, ctx);
      }),
    },

    // Where better-auth redirects a browser flow that fails server-side —
    // most importantly an OAuth callback error (expired/replayed `state`,
    // IdP error). The default is `${baseURL}/error`, which bounces to
    // `/?error=<code>`; the root→console redirect then DROPS the query, so
    // the user lands on a silent login form right after a successful IdP
    // sign-in (objectui#2458 item 1). Point it at the console login page,
    // which renders `?error=` as an inline banner.
    onAPIError: {
      errorURL: this.getConsolePageUrl('/login'),
    },

    // Trusted origins for CSRF protection (supports wildcards like "https://*.example.com")
    // Auto-includes origins from OS_CORS_ORIGIN env var so CORS and CSRF stay in sync.
    ...(() => {
      const origins: string[] = [...(this.config.trustedOrigins || [])];
      // Sync with OS_CORS_ORIGIN env var (comma-separated), judged ENTRY BY
      // ENTRY: an entry that admits every host never enters the trusted set,
      // however the list around it is spelled. That is `*`, or a pattern whose
      // host part is the bare `*` (`https://*`, `*://*`, `http://*:*`) —
      // better-auth's own matcher reads each of them as every origin — the
      // same narrow class the CORS transport refuses with credentials
      // (`isAllHostOriginPattern`, `@objectstack/plugin-hono-server`, which
      // this package does not depend on). `docs/HARDENING.md` § CORS governs;
      // `@objectstack/http-conformance`'s CORS-doors pin holds the two equal.
      const corsOrigin = readEnvWithDeprecation('OS_CORS_ORIGIN', 'CORS_ORIGIN', { silent: true });
      if (corsOrigin) {
        const admitsEveryHost = (entry: string) => /^(?:[^:/]+:\/\/)?\*+(?::(?:\d+|\*))?$/.test(entry);
        corsOrigin.split(',').map(s => s.trim()).filter(Boolean).forEach(o => {
          if (!admitsEveryHost(o) && !origins.includes(o)) origins.push(o);
        });
      }
      // When CORS allows all origins (default) and no explicit trustedOrigins,
      // trust all localhost ports in development for convenience. Also trust
      // `*.localhost` subdomains so per-project tenant subdomains (the dev
      // default root domain — see project-provisioning.ts) pass CSRF checks
      // without operators having to configure trustedOrigins manually.
      //
      // NON-PRODUCTION ONLY (commit bbe643c08). This substitution is a development
      // convenience and is now gated on the same `NODE_ENV` dev signal used
      // by the fallback auth secret and the dev Origin synthesis below, so
      // the boundary this comment claims is the boundary that is enforced.
      // Previously the condition tested only emptiness, so a production
      // deployment whose trusted-origin list resolved empty silently
      // CSRF-trusted every `localhost` / `*.localhost` origin.
      //
      // What production gets instead: `trustedOrigins` is omitted from the
      // better-auth config entirely (see the tail of this block). That is
      // NOT an absent policy — better-auth seeds its trusted set from the
      // resolved `baseURL` origin and treats `trustedOrigins` as purely
      // ADDITIVE, so an empty list and an omitted key are equivalent and
      // both leave exactly the deployment's own origin trusted; every other
      // origin is refused with `403 INVALID_ORIGIN`. Measured against the
      // then-installed better-auth 1.7.1 (`getTrustedOrigins` in
      // `dist/context/helpers.mjs`, `validateOrigin` in
      // `dist/api/middlewares/origin-check.mjs`).
      if (
        process.env.NODE_ENV !== 'production' &&
        !origins.length && (!corsOrigin || corsOrigin === '*')
      ) {
        origins.push('http://localhost:*');
        origins.push('http://*.localhost:*');
        origins.push('https://*.localhost:*');
      }
      // ── ADR-0135 D6: runtime self-service external-IdP registration ───────
      // `@better-auth/sso`'s `validateDiscoveryUrl` requires the IdP's
      // *discovery* origin to be in `trustedOrigins` — even for a publicly-
      // routable IdP (stricter than its own sub-endpoint check, which allows
      // any public host). Without help that breaks ADR-0135 D6's "register your
      // IdP at runtime, no boot config" promise for every real IdP
      // (Okta/Entra/Google). When the SSO RP is enabled, expose
      // `trustedOrigins` as a per-request FUNCTION that, for a
      // `/sso/register` | `/sso/update-provider` POST, additionally trusts the
      // PUBLIC-ROUTABLE issuer / discovery origins declared in the request
      // body. Private / internal hosts are never auto-trusted — they still
      // require explicit `trustedOrigins` config (the documented SSRF escape
      // hatch), and better-auth's own DNS-resolution checks still apply.
      if (this.isSsoWired()) {
        return {
          trustedOrigins: async (request?: Request) => {
            const base = [...origins];
            try {
              for (const o of await this.ssoDiscoveryTrustedOrigins(request)) {
                if (!base.includes(o)) base.push(o);
              }
            } catch { /* never let trust resolution throw */ }
            return base;
          },
        };
      }
      return origins.length ? { trustedOrigins: origins } : {};
    })(),

    // Advanced options (cross-subdomain cookies, secure cookies, CSRF, etc.),
    // and — always — the library's own client-address source: the one
    // platform-owned header `handleRequest` writes from the address the
    // client-address trust rule established (`client-address-vendor.ts`).
    // Never left at the library's default reader, which knows neither the
    // transport's peer address nor `server.trustProxy`.
    advanced: {
      ...(this.config.advanced?.crossSubDomainCookies
        ? { crossSubDomainCookies: this.config.advanced.crossSubDomainCookies } : {}),
      ...(this.config.advanced?.useSecureCookies != null
        ? { useSecureCookies: this.config.advanced.useSecureCookies } : {}),
      ...(this.config.advanced?.disableCSRFCheck != null
        ? { disableCSRFCheck: this.config.advanced.disableCSRFCheck } : {}),
      ...(this.config.advanced?.cookiePrefix != null
        ? { cookiePrefix: this.config.advanced.cookiePrefix } : {}),
      ipAddress: vendorClientAddressOptions(),
    },
  };

  const auth = betterAuth(betterAuthConfig);

  // ⛔ Do not return before better-auth's plugin `init` hooks have settled.
  //
  // `betterAuth()` returns synchronously and runs those hooks behind
  // `auth.$context`, so anything a plugin does at init is a promise NOBODY
  // holds. That was harmless while init did no I/O. It stopped being harmless
  // when the oauth-provider began seeding the RFC 8707 `sys_oauth_resource`
  // row from its own `init`: a failure there had no catcher and surfaced as
  // an UNHANDLED REJECTION — which Node terminates the process for by default
  // — and, in tests, as a boot write racing its engine's teardown and failing
  // with "No driver available for object 'sys_oauth_resource'" long after the
  // test that triggered it had passed.
  //
  // Awaiting it here makes the seed part of "the instance is ready": a boot
  // failure now rejects THIS call, where callers can see and handle it,
  // instead of escaping the stack. `$context` is absent when better-auth is
  // mocked, and `await undefined` is a no-op, so this is safe on that path.
  await (auth as { $context?: Promise<unknown> } | undefined)?.$context;

  return auth;
}
