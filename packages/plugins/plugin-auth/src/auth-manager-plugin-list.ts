// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 16] The better-auth plugin list `AuthManager` builds — the body
 * of its private `buildPluginList()` method, which `createAuthInstance` calls
 * once per build — moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. The function below is that method's body as it
 * stood, re-indented one level and otherwise unedited: the same reset of the
 * degraded-feature record and the JWT signing verdict, the same `enabled`
 * table (the env and config precedence it documents, the SCIM coherence
 * re-check), and the same plugins in the same order — `bearer`, the
 * `organization` factory, `twoFactor`, breached-password rejection, `admin`,
 * `phoneNumber`, `magicLink`, the generic OAuth providers, the OIDC provider
 * with its `jwt` plugin, `sso`, `scim`, device authorization and the custom
 * session — each with its own failure tier, as the method's docblock states.
 * The `organization` factory's body was moved out by cut 15; its arrow, which
 * hands that body its host, moves here with the rest.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which the fifteen `auth-manager-*.ts`
 * modules split out before this one follow. `buildPluginList` keeps its place,
 * its docblock, its signature and its return type in the class; its body is
 * now one literal of exactly the {@link PluginListHost} members the body
 * reads, plus a `.call`. The `async` moved from the method to the function
 * below, and the method returns the function's own promise.
 *
 * The body's `this` was the manager; it is now that host. Every member it
 * reads but four is a method, and each goes as a closure that calls it on the
 * manager at call time, so a test double or spy set on the manager is still
 * the one the body reaches — including from the callbacks it hands
 * better-auth, which run long after this function returns. Of the four
 * fields, two go as GETTERS: `config`, because the class reassigns it after
 * construction (`setRuntimeBaseUrl` and `applyConfigPatch`), and
 * `degradedFeatures`, as every field this series carries goes. Two go as a
 * GET/SET pair, because the body writes them: `jwtSigningFailureReported`,
 * which it resets, and `orgRolesMap`, which the `organization` arrow's host
 * writes through. Each setter writes the manager's own field, so every reader
 * of those fields reads what the body wrote, at the same moment as before.
 * The method builds the host each time it is called, as every method stub in
 * this series does.
 *
 * The `organization` arrow builds its own host from `this`, which is now this
 * host: each of its closures calls this host's closure, which calls the
 * manager's method, and its getter and setter go through this host's pair to
 * the manager's field, so it reaches the same member at the same moment as
 * before. `readBooleanEnv` and `consentOrganizationOf` are the two top-level
 * declarations of `auth-manager.ts` the body reads that were not exported;
 * they are exported in place there, per ruling 6364006498 (A), and imported
 * here by value with the five that already were. `src/index.ts` names its
 * `auth-manager.ts` exports one by one, so those exports publish nothing.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { AuthPluginConfig } from '@objectstack/spec/system';
import { MCP_OAUTH_SCOPES } from '@objectstack/spec/ai';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { applyPlatformAdminImpersonation } from './admin-impersonate-endpoint.js';
import { buildOrganizationPlugin, type OrganizationPluginHost } from './auth-manager-organization-plugin.js';
import {
  OAUTH_ORGANIZATION_CLAIM,
  assertScimAdminCoherence,
  consentOrganizationOf,
  readBooleanEnv,
  resolveDcrEnabled,
  resolveOidcProviderEnabled,
  resolveScimEnabled,
  type AuthManager,
} from './auth-manager.js';
import {
  buildAdminPluginSchema,
  buildDeviceAuthorizationPluginSchema,
  buildOauthProviderPluginSchema,
  buildPhoneNumberPluginSchema,
  buildTwoFactorPluginSchema,
} from './auth-schema-config.js';
import { isPlaceholderEmail } from './placeholder-email.js';
import { userInfoLocaleClaim } from './oidc-userinfo-locale-claim.js';
import { buildTurnstileSignUpPlugin, reportHalfConfiguredTurnstile, resolveTurnstileKeys } from './turnstile-sign-up.js';

/**
 * The `AuthManager` members the function below reads — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too, and naming a member the class does not have is a compile error.
 * `config` and `degradedFeatures` are read-only here: the host hands them out
 * through getters. `jwtSigningFailureReported` and `orgRolesMap` are written
 * through, so the host hands each out as a getter and a setter over the
 * manager's own field.
 */
export interface PluginListHost {
  addOptionalPlugin: AuthManager['addOptionalPlugin'];
  buildJwtPlugin: AuthManager['buildJwtPlugin'];
  computeAuthGate: AuthManager['computeAuthGate'];
  readonly config: AuthManager['config'];
  readonly degradedFeatures: AuthManager['degradedFeatures'];
  deliverPhoneOtp: AuthManager['deliverPhoneOtp'];
  emailLocaleArg: AuthManager['emailLocaleArg'];
  enforceSessionControls: AuthManager['enforceSessionControls'];
  getAppName: AuthManager['getAppName'];
  getConsolePageUrl: AuthManager['getConsolePageUrl'];
  getDataEngine: AuthManager['getDataEngine'];
  getEmailService: AuthManager['getEmailService'];
  getMcpResourceUrl: AuthManager['getMcpResourceUrl'];
  isPlatformAdminUserId: AuthManager['isPlatformAdminUserId'];
  jwtSigningFailureReported: AuthManager['jwtSigningFailureReported'];
  multiOrgPostureEffective: AuthManager['multiOrgPostureEffective'];
  orgRolesMap: AuthManager['orgRolesMap'];
  reconcileScimUserLifecycle: AuthManager['reconcileScimUserLifecycle'];
  resolveAuthSecret: AuthManager['resolveAuthSecret'];
  resolveMembershipRole: AuthManager['resolveMembershipRole'];
  resolveTwoFactorAccountLockout: AuthManager['resolveTwoFactorAccountLockout'];
  storedRecipientLocale: AuthManager['storedRecipientLocale'];
}

/**
 * The body of `AuthManager.buildPluginList()`; the method's docblock and the
 * comments in it are its contract.
 */
export async function buildPluginList(this: PluginListHost): Promise<any[]> {
  this.degradedFeatures.clear();
  // Same lifecycle as degradedFeatures: an operator who fixes the cause and
  // triggers a rebuild gets a fresh verdict, and a fresh log line if it is
  // still broken. (The Ed25519 probe itself is NOT reset — it is a property
  // of the runtime, which a rebuild cannot change.)
  this.jwtSigningFailureReported = false;
  const pluginConfig: Partial<AuthPluginConfig> = this.config.plugins ?? {};
  const plugins: any[] = [];

  // Defaults — kept in sync with `AuthPluginConfigSchema` in
  // @objectstack/spec/system/auth-config.zod.ts. The frontend AuthProvider
  // (in @object-ui/app-shell) calls `/api/v1/auth/organization/list` on
  // every load; making the org plugin opt-out (default true) avoids
  // 404s and the noisy "Failed to load organizations" warning.
  //
  // `OS_OIDC_PROVIDER_ENABLED` lets operators flip the OIDC IdP on
  // without re-deploying with a code change (mirrors the
  // `OS_MULTI_ORG_ENABLED` / `OS_DISABLE_SIGNUP` pattern). When set, the
  // env var WINS over the config-file setting so platform operators can
  // override per-environment without touching the application bundle.
  // Use the shared `readBooleanEnv` parser (same as OS_AUTH_TWO_FACTOR /
  // OS_AUTH_PASSWORD_REJECT_BREACHED / OS_DISABLE_SIGNUP) so these accept the
  // platform-standard truthy set (`true`/`1`/`yes`/`on`, case-insensitive)
  // instead of only the literal string `'true'` — a repeated operator footgun
  // (`OS_SSO_ENABLED=1` silently parsed as disabled).
  //
  // Precedence for `scim` / `sso` / `ssoDomainVerification` (#13439,
  // maintainer ruling 2026-08-31): an EXPLICIT config value wins over the
  // env var; the env var decides only where the config leaves the key unset
  // (tri-state `z.boolean().optional()` in AuthPluginConfigSchema). This is
  // deliberately the OPPOSITE of the env-wins order the OIDC/2FA/HIBP keys
  // above keep: for these three, config is how the code constructing the
  // AuthPlugin states a value the deployment env must not silently outrank
  // (the cloud control plane's plan-derived `plugins.scim` is the known
  // writer), while the operator per-environment override survives for every
  // deployment that leaves the keys unset.
  const ssoFromEnv = readBooleanEnv('OS_SSO_ENABLED');
  // Opt-in DNS domain-verification for external SSO providers (ADR-0135 D6).
  // OFF by default → today's behavior exactly (register → login immediately).
  // ON → @better-auth/sso mounts /sso/{request-domain-verification,verify-domain}
  // AND enforces a HARD login gate: a provider whose domain is not DNS-verified
  // rejects logins ("Provider domain has not been verified"). The two are
  // coupled in @better-auth/sso (the endpoints only register when
  // `domainVerification.enabled`), so this single flag governs both. Requires
  // `OS_SSO_ENABLED` (the sso plugin must be loaded to honor it).
  const ssoDomainVerifyFromEnv = readBooleanEnv('OS_SSO_DOMAIN_VERIFICATION');
  // @better-auth/scim's `active:false` → ban runs through the admin plugin,
  // and org-scoped tokens need the organization plugin — so enabling SCIM
  // forces `admin` on (organization already defaults on). See ADR-0134.
  // An explicit `plugins.admin: false` beside effective SCIM is a
  // contradiction refused below (#13816) — never silently honoured.
  const scimEffective = resolveScimEnabled(pluginConfig);
  // Re-checked here (the constructor already refused a conflicted BOOT
  // config) because this is where the env var is actually read: an
  // OS_SCIM_ENABLED that appears between construction and the lazy
  // better-auth build would otherwise mount SCIM with its ADR-0134
  // deprovisioning path silently declined.
  assertScimAdminCoherence(pluginConfig);
  const twoFactorFromEnv = readBooleanEnv('OS_AUTH_TWO_FACTOR');
  const hibpFromEnv = readBooleanEnv('OS_AUTH_PASSWORD_REJECT_BREACHED');
  const enabled = {
    organization: pluginConfig.organization ?? true,
    twoFactor: twoFactorFromEnv ?? pluginConfig.twoFactor ?? false,
    passwordRejectBreached: hibpFromEnv ?? pluginConfig.passwordRejectBreached ?? false,
    passkeys: pluginConfig.passkeys ?? false,
    magicLink: pluginConfig.magicLink ?? false,
    // Shared decision point (env → config → follows OS_MCP_SERVER_ENABLED),
    // see resolveOidcProviderEnabled — keep auth-plugin.ts / features in sync.
    oidcProvider: resolveOidcProviderEnabled(pluginConfig),
    deviceAuthorization: pluginConfig.deviceAuthorization ?? false,
    admin: pluginConfig.admin ?? scimEffective,
    // #2766 V1.5 — phone+password sign-in. Opt-in; OTP flows stay off until
    // SMS infrastructure exists (tracked separately).
    phoneNumber: (pluginConfig as any).phoneNumber ?? false,
    sso: pluginConfig.sso ?? ssoFromEnv ?? false,
    ssoDomainVerification: pluginConfig.ssoDomainVerification ?? ssoDomainVerifyFromEnv ?? false,
    scim: scimEffective,
  };

  // bearer() — ALWAYS enabled.
  //
  // Enables token-based authentication for cross-origin and mobile clients
  // where third-party cookies are blocked (e.g. Safari ITP, Chrome CHIPS,
  // native apps). The plugin:
  //   • Accepts `Authorization: Bearer <token>` on incoming requests and
  //     transparently resolves the session as if a cookie had been sent.
  //   • Emits a `set-auth-token` response header on sign-in / session-refresh
  //     that the client can store (e.g. in `localStorage`) and replay on
  //     subsequent requests.
  //
  // This mirrors how Salesforce, Notion, Supabase and first-party mobile
  // SDKs handle auth. Cookie-based auth remains available for same-origin
  // browser deployments; bearer is additive, not a replacement.
  const { bearer } = await import('better-auth/plugins/bearer');
  plugins.push(bearer());

  // Opt-in Cloudflare Turnstile on email sign-up: mounted only when BOTH keys
  // are configured, through the same resolver `getPublicConfig()` advertises
  // `features.turnstileSiteKey` from. Not an optional plugin: a guard that
  // fails to build must fail the build, never leave sign-up open while the
  // Console renders a widget. See `turnstile-sign-up.ts`.
  reportHalfConfiguredTurnstile();
  const turnstileKeys = resolveTurnstileKeys();
  if (turnstileKeys) {
    plugins.push(await buildTurnstileSignUpPlugin(turnstileKeys));
  }

  if (enabled.organization) {
    // [#25224 cut 15] The body of this factory moved to
    // `auth-manager-organization-plugin.ts`; this arrow hands it the members
    // it reads (`OrganizationPluginHost`).
    await this.addOptionalPlugin(plugins, 'organization', () => {
      const readConfig = () => this.config;
      const readOrgRolesMap = () => this.orgRolesMap;
      const writeOrgRolesMap = (v: AuthManager['orgRolesMap']) => { this.orgRolesMap = v; };
      const host: OrganizationPluginHost = {
        get config() { return readConfig(); },
        emailLocaleArg: (...a) => this.emailLocaleArg(...a),
        getAppName: (...a) => this.getAppName(...a),
        getConsolePageUrl: (...a) => this.getConsolePageUrl(...a),
        getDataEngine: (...a) => this.getDataEngine(...a),
        getEmailService: (...a) => this.getEmailService(...a),
        multiOrgPostureEffective: (...a) => this.multiOrgPostureEffective(...a),
        get orgRolesMap() { return readOrgRolesMap(); },
        set orgRolesMap(v) { writeOrgRolesMap(v); },
        resolveMembershipRole: (...a) => this.resolveMembershipRole(...a),
        storedRecipientLocale: (...a) => this.storedRecipientLocale(...a),
      };
      return buildOrganizationPlugin.call(host);
    });
  }

  if (enabled.twoFactor) {
    const { twoFactor } = await import('better-auth/plugins/two-factor');
    plugins.push(twoFactor({
      schema: buildTwoFactorPluginSchema(),
      // ADR-0069 D2 (#3690) — the operator's lockout policy governs BOTH
      // stages of sign-in, not just the password one.
      accountLockout: this.resolveTwoFactorAccountLockout(),
    }));
  }

  // Breached-password rejection (ADR-0069 D1). Native, stateless: a
  // k-anonymity range check against Have I Been Pwned on better-auth's
  // password-mutating endpoints (sign-up / change / reset — the plugin's
  // defaults). The plaintext password is never sent; only the first 5 SHA-1
  // hex chars leave the process. Rejects with PASSWORD_COMPROMISED.
  if (enabled.passwordRejectBreached) {
    const { haveIBeenPwned } = await import('better-auth/plugins/haveibeenpwned');
    plugins.push(haveIBeenPwned({
      customPasswordCompromisedMessage:
        'This password has appeared in a known data breach. Please choose a different one.',
    }));
  }

  if (enabled.admin) {
    await this.addOptionalPlugin(plugins, 'admin', async () => {
      const { admin } = await import('better-auth/plugins/admin');
      // Platform admin: ban/unban, set-password, impersonate, set-role.
      // Schema mapping ensures the plugin's added user/session columns
      // match ObjectStack's snake_case conventions (ban_reason,
      // ban_expires, impersonated_by). `role` and `banned` are already
      // snake_case-compatible.
      const adminPlugin: any = admin({
        schema: buildAdminPluginSchema(),
      });

      // ADR-0068 D2 — re-authorize `/admin/impersonate-user` on ObjectStack's
      // platform-admin predicate, IN PLACE on this plugin's own endpoints
      // record. See `admin-impersonate-endpoint.ts` for the measurement that
      // picked this shape over a second plugin (which boots and serves, but
      // makes `checkEndpointConflicts` log an error on every start) and over
      // a raw Hono mount (forbidden: hand-rolled signed cookies, and it would
      // silently detach the #8243 rotation hook keyed on this path).
      //
      // Every OTHER better-auth-native `/admin/*` route still gates on the
      // legacy scalar and still refuses platform admins — that is the parent
      // card's remaining surface, deliberately untouched here. (A caller the
      // ADR-0069 policy holds is refused on those ahead of the vendor, by the
      // global before-hook — `VENDOR_ROLE_SCALAR_ADMIN_PATHS`.)
      //
      // ADR-0069 D3 — the same endpoint refuses a caller the policy holds,
      // asked of the session gate's own posture carrier (`computeAuthGate`,
      // the first entry of `resolveUserAuthGates`); see the endpoint module.
      const rewired = await applyPlatformAdminImpersonation(
        adminPlugin,
        (userId: string) => this.isPlatformAdminUserId(userId),
        (userId: string, organizationId: string | undefined) =>
          this.computeAuthGate(userId, organizationId, false),
      );
      if (!rewired) {
        // The vendor renamed or dropped the endpoint. Say so loudly: the
        // route then falls back to the vendor's own handler, which refuses
        // every platform admin — a broken button, not an open door.
        console.error(
          '[AuthManager] better-auth\'s admin plugin no longer exposes a ' +
          '`impersonateUser` endpoint at /admin/impersonate-user, so the ' +
          'ADR-0068 platform-admin authorization could NOT be applied. ' +
          'Impersonation will refuse every ObjectStack platform admin until ' +
          'admin-impersonate-endpoint.ts is updated for the new vendor shape.',
        );
      }
      return adminPlugin;
    });
  }

  if (enabled.phoneNumber) {
    await this.addOptionalPlugin(plugins, 'phoneNumber', async () => {
    const { phoneNumber } = await import('better-auth/plugins/phone-number');
    // #2766 V1.5 wired phone+password sign-in; #2780 opens the OTP surface
    // (`/phone-number/send-otp` + `/verify`, `/request-password-reset` +
    // `/reset-password`) whenever an SMS service is available — resolved
    // lazily per send so the plugin list stays stable while the capability
    // upgrades at kernel:ready. Without one, sendOTP still fails loudly
    // (400 SMS_SERVICE_REQUIRED) instead of silently logging. signUpOnVerification
    // stays deliberately NOT configured — phone-only accounts are created
    // by the admin create-user/import routes with a placeholder email
    // (see placeholder-email.ts), never by OTP self-signup.
    const otpCfg = this.config.phoneOtp ?? {};
    return phoneNumber({
      schema: buildPhoneNumberPluginSchema(),
      // Wrong-code attempts before the stored OTP is invalidated. Explicit
      // (even though 3 is the better-auth default) — #2780 names it a
      // security requirement, so it must not drift with a dependency bump.
      allowedAttempts: otpCfg.allowedAttempts ?? 3,
      ...(otpCfg.expiresIn != null ? { expiresIn: otpCfg.expiresIn } : {}),
      ...(otpCfg.otpLength != null ? { otpLength: otpCfg.otpLength } : {}),
      // Reject garbage before an SMS is paid for (same shape rule as the
      // admin endpoints' normalizePhoneNumber).
      phoneNumberValidator: (phone: string) =>
        /^\+?[0-9]{6,15}$/.test(String(phone ?? '').replace(/[\s\-().]/g, '')),
      // Sign-in / verify OTP. Throws surface to the endpoint (better-auth
      // awaits this callback on /phone-number/send-otp), so the guard's
      // TOO_MANY_REQUESTS becomes an honest 429 to the client.
      sendOTP: async ({ phoneNumber: phone, code }) => {
        await this.deliverPhoneOtp(phone, code);
      },
      // Self-service password reset OTP (`/phone-number/request-password-
      // reset`). better-auth invokes this via runInBackgroundOrAwait —
      // errors are logged, the route still answers {status:true} — so a
      // throw here can neither 500 the request nor leak whether the number
      // is registered.
      sendPasswordResetOTP: async ({ phoneNumber: phone, code }) => {
        await this.deliverPhoneOtp(phone, code);
      },
    });
    });
  }

  if (enabled.magicLink) {
    await this.addOptionalPlugin(plugins, 'magicLink', async () => {
    const { magicLink } = await import('better-auth/plugins/magic-link');
    // magic-link reuses the `verification` table — no extra schema mapping needed.
    //
    // The link's lifetime, in seconds, and the ONE source for it: the mount
    // states it and the mail's `expiresInMinutes` is derived from it, so the
    // copy says what the link does. 300 s is the lifetime the link already
    // had through the vendor default (`opts.expiresIn || 300`, better-auth
    // 1.7.12 `plugins/magic-link/index.mjs`), now written down so a
    // dependency bump cannot move it under the mail. ⛔ Lengthening it
    // relaxes a sign-in credential's validity — a security-boundary change
    // for the maintainer, not a copy fix.
    const magicLinkExpiresInSec = 5 * 60;
    return magicLink({
      expiresIn: magicLinkExpiresInSec,
      // #14319 — this one is called with the endpoint CTX, not a Request
      // (measured; magic-link/index.mjs `sendMagicLink({...}, ctx)`).
      sendMagicLink: async ({ email: recipientEmail, url, token }, ctx?: unknown) => {
        // #2766 V1.5 — placeholder addresses are never real recipients.
        if (isPlaceholderEmail(recipientEmail)) {
          throw new Error(
            `Magic-link email refused: ${recipientEmail} is a placeholder address (PLACEHOLDER_EMAIL).`,
          );
        }
        const emailService = this.getEmailService();
        if (!emailService) {
          // #2766 — a magic link IS a session credential; only print it in
          // dev, never in production logs.
          const dev = (globalThis as any)?.process?.env?.NODE_ENV !== 'production';
          console.warn(
            `[AuthManager] Magic-link requested for ${recipientEmail} but no email service is wired.` +
            (dev ? ` URL: ${url}` : ' (link suppressed outside dev)'),
          );
          return;
        }
        // #15106 — the recipient's OWN stored language, the last auth mail
        // to reach the top rung of the #14788 option-D ladder. Same rung and
        // same helper as the other four sends; only the predicate differs,
        // because this callback is handed an address rather than a user row
        // — the #14641 invitation shape, and for the same reason it has two
        // branches:
        //
        //  1. the address HAS a `sys_user` row — the ordinary case, since a
        //     magic link is how an existing account signs in without a
        //     password → their own `locale`;
        //  2. NO row — magic link doubles as sign-up (measured in the
        //     installed 1.7.x: `/sign-in/magic-link` sends WITHOUT checking
        //     for an account, and `/magic-link/verify` creates one unless
        //     `disableSignUp`), so an unknown address is legitimate here and
        //     its language is genuinely unknown → the rungs below stand.
        //
        // ⚠️ Lowercased, unlike the invitation predicate, and the difference
        // is measured rather than stylistic: better-auth lowercases the
        // invitee address on the invite route, but `signInMagicLinkBodySchema`
        // applies no such transform, so what arrives here is whatever the
        // caller typed. `internalAdapter.findUserByEmail` — the lookup
        // `/magic-link/verify` resolves this very link with — matches on
        // `email.toLowerCase()`. Reading the column on the same spelling
        // keeps the row the mail is ABOUT identical to the row the link will
        // sign into; an address that resolves nothing lands on the rungs
        // below, which is the documented floor rather than a failure.
        //
        // ⛔ The request rung is NOT removed: ruling D inserts the column
        // ABOVE `Accept-Language`, it does not replace it. A magic link is
        // requested by its own recipient, so `ctx` here carries the
        // recipient's own header and stays a legitimate second rung for an
        // account that has stated no language.
        const storedLocale = await this.storedRecipientLocale({
          email: recipientEmail.toLowerCase(),
        });
        try {
          await emailService.sendTemplate({
            template: 'auth.magic_link',
            to: recipientEmail,
            ...this.emailLocaleArg(ctx, storedLocale),
            data: {
              magicLinkUrl: url,
              token,
              expiresInMinutes: Math.round(magicLinkExpiresInSec / 60),
              appName: this.getAppName(),
            },
            // [ADR-0131 D7, Q2 A] A sign-in link for a person: identity mail.
            identityMail: true,
          });
        } catch (err: any) {
          console.error(`[AuthManager] sendMagicLink failed: ${err?.message ?? err}`);
          throw err;
        }
      },
    });
    });
  }

  // OIDC / Generic OAuth2 providers (enterprise SSO via genericOAuth plugin)
  if (this.config.oidcProviders?.length) {
    const oidcProviders = this.config.oidcProviders;
    await this.addOptionalPlugin(plugins, 'genericOAuth', async () => {
    const { genericOAuth } = await import('better-auth/plugins/generic-oauth');
    return genericOAuth({
      config: oidcProviders.map(p => ({
        providerId: p.providerId,
        ...(p.discoveryUrl ? { discoveryUrl: p.discoveryUrl } : {}),
        ...(p.issuer ? { issuer: p.issuer } : {}),
        ...(p.authorizationUrl ? { authorizationUrl: p.authorizationUrl } : {}),
        ...(p.tokenUrl ? { tokenUrl: p.tokenUrl } : {}),
        ...(p.userInfoUrl ? { userInfoUrl: p.userInfoUrl } : {}),
        clientId: p.clientId,
        clientSecret: p.clientSecret,
        ...(p.scopes ? { scopes: p.scopes } : {}),
        ...(p.pkce != null ? { pkce: p.pkce } : {}),
      })),
    });
    });
  }

  // OAuth/OIDC Provider — turn this server into an OpenID Connect Identity
  // Provider so external apps can SSO via ObjectStack. Adds the
  // `/oauth2/{authorize,token,userinfo,register,consent,endsession}` and
  // `/.well-known/openid-configuration` endpoints under the auth route.
  //
  // Migrated from the deprecated `better-auth/plugins/oidc-provider` to the
  // standalone `@better-auth/oauth-provider` package. The new plugin uses
  // `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, and `oauthConsent`
  // models — see `buildOauthProviderPluginSchema()` for the snake_case
  // mappings to ObjectStack's `sys_oauth_*` tables.
  if (enabled.oidcProvider) {
    // jwt + oauthProvider are one atomic unit: on failure neither lands.
    // This is the plugin that broke every fresh 15.1.0 project (modelName
    // TypeError from a 1.6/1.7 version mix) — see addOptionalPlugin.
    await this.addOptionalPlugin(plugins, 'oidcProvider', async () => {
    // The new @better-auth/oauth-provider package requires the `jwt`
    // plugin (used to sign id_tokens / JWT access tokens). Register it
    // automatically — it is otherwise an internal implementation detail
    // and forcing every consumer to opt in would be poor DX.
    const { jwt } = await import('better-auth/plugins');
    const jwtPlugin = await this.buildJwtPlugin(jwt);

    const { oauthProvider } = await import('@better-auth/oauth-provider');
    const dcr = resolveDcrEnabled(pluginConfig);
    return [jwtPlugin, oauthProvider({
      // Console SPA renders both pages (replaces the legacy Account SPA at
      // /_account). Override `uiBasePath` in AuthConfig if Console is
      // mounted elsewhere.
      loginPage: this.getConsolePageUrl('/login'),
      consentPage: this.getConsolePageUrl('/oauth/consent'),
      schema: buildOauthProviderPluginSchema(),
      // ⛔ No `silenceWarnings` here. It was added for the #3420 double
      // print of oauth-provider's "Please ensure /.well-known/… exists"
      // notice — a false positive, because registerOidcDiscoveryRoutes
      // mounts those documents at the issuer ROOT where RFC 8414 §3 requires
      // them. The pinned 1.7.2 emits no such notice: neither the option name
      // nor the `oauthAuthServerConfig` key nor the notice text occurs
      // anywhere in `@better-auth/oauth-provider` or `better-auth`, so the
      // option silenced nothing and was the same dead-option shape as the
      // `validAudiences` defect below. If a future bump reintroduces the
      // notice, re-add the silencer with a fresh reading — do NOT restore it
      // on the strength of this comment.
      // ── MCP OAuth track (#2698) ────────────────────────────────
      // Coarse tool-family scopes for the platform's own MCP endpoint,
      // advertised alongside the standard OIDC scopes. Names are
      // single-sourced in @objectstack/spec so AS / resource server /
      // tool layer cannot drift.
      scopes: ['openid', 'profile', 'email', 'offline_access', ...MCP_OAUTH_SCOPES],
      // MCP clients bind tokens to the resource via RFC 8707
      // (`resource=<mcp url>`). In @better-auth/oauth-provider 1.7.2 a
      // requested `resource` is resolved from the `oauthResource` table
      // (`sys_oauth_resource`) — a miss is refused at /oauth2/authorize with
      // `invalid_target: requested resource <id> is not configured` — and
      // `enforcePerClientResources` defaults to TRUE, so the client must
      // additionally be linked in `oauthClientResource`
      // (`sys_oauth_client_resource`). Both rows have to exist before the
      // first Connect, so both are declared here:
      //
      //   • `resources` seeds the sys_oauth_resource row from the plugin's
      //     own `init` (idempotent, `resourceSeedMode: "insertOnly"` by
      //     default, so an admin's later CRUD edits are never reverted);
      //   • `clientRegistrationDefaultResources` links every newly
      //     registered client to it inside the DCR transaction — a client
      //     that registers anonymously one second before the login cannot
      //     be linked by an admin in between.
      //
      // ⛔ `enforcePerClientResources` is deliberately NOT passed: the
      // per-client linkage check stays at its `true` default. The fix makes
      // the link happen; it does not switch the check off. A client with no
      // link row is still refused, and
      // auth-manager.mcp-oauth-resource.test.ts asserts exactly that.
      //
      // ⛔ Do not reintroduce `validAudiences`: 1.7.2 reads no such option
      // (0 occurrences in its dist), and audience validation now runs
      // through the resource table instead. A field that is passed and read
      // by nobody looks like configuration and enforces nothing — that is
      // how this defect survived a version bump.
      resources: [this.getMcpResourceUrl()],
      clientRegistrationDefaultResources: [this.getMcpResourceUrl()],
      // RFC 7591 Dynamic Client Registration. `allowUnauthenticated…` is
      // required: MCP clients register BEFORE any user is logged in (the
      // whole point of the self-serve flow). Registration is rate-limited
      // by the plugin, clients get only the scopes advertised above, and
      // every token still requires an interactive PKCE login + consent —
      // an anonymous registration mints no authority by itself.
      allowDynamicClientRegistration: dcr,
      allowUnauthenticatedClientRegistration: dcr,
      // ── Native MCP clients that omit `application_type` (#25118, ruling 6329352251, A1) ──
      // Local MCP clients (Claude Code, Cursor, VS Code, Codex CLI) register
      // over DCR with a loopback `http` or a custom-scheme redirect, as RFC
      // 8252 §7.3 and the MCP authorization spec have native clients do, and
      // send no `application_type`. The provider's default fills a missing
      // type with `web` (OIDC Registration §2), whose redirect rule refuses
      // both forms, so every such client was refused before its browser
      // opened.
      //
      // `'infer'` is the provider's own classifier; there is no second rule
      // here. A dynamic registration that omits the type becomes `native`
      // when ANY redirect uses a non-http(s) scheme or `http` on exactly
      // `localhost`, `127.0.0.1` or `[::1]`, and each redirect is then held to
      // the native rule; otherwise it stays `web`. A type the client sends is
      // never overridden. It acts on `/oauth2/register` only (the Setup
      // form's managed `create-client` door is unaffected) and only while
      // `dcr` is on: with DCR off the provider refuses every registration.
      //
      // The measured boundary, pinned on the real provider in
      // auth-manager.mcp-oauth-dcr-infer.test.ts:
      //   • a public client with a loopback or custom-scheme redirect → `native`;
      //   • `https://evil.example/cb` alone stays `web`; `http://evil.example/cb`,
      //     `http://localhost.evil.example`, and an explicit `web` with a
      //     loopback redirect stay refused;
      //   • NOT "public clients only": the classifier reads redirect URIs and
      //     never `token_endpoint_auth_method`, so a CONFIDENTIAL registration
      //     (`client_secret_basic`, or the method omitted, which the provider
      //     fills as `client_secret_basic`) with a loopback or custom-scheme
      //     redirect and no type also registers as `native` and is issued a
      //     `client_secret`. That body was already accepted with
      //     `application_type: 'native'` spelled out, so no registrable client
      //     shape is added; only the meaning of an omitted field changes
      //     (RFC 8252 §8.4 allows a per-instance secret provisioned by DCR);
      //   • PKCE stays required at /oauth2/authorize for every one of these
      //     clients: unconditionally for a public client, and for a
      //     confidential DCR client because `clientRegistrationRequirePKCE`
      //     keeps its `true` default. ⛔ Do not pass it as `false`.
      //
      // ⛔ No hook on `/oauth2/register` and no second classification rule
      // beside this one: ruling A1 declined both.
      clientRegistrationDefaultApplicationType: 'infer',
      // ── The organization an OAuth consent binds (ruling 6232069920, A) ──
      // At consent the consenting session's active organization becomes the
      // consent's `reference_id`, and the installed provider carries that
      // value onto the authorization code, the refresh family it starts, and
      // every access token minted from either, where `customAccessTokenClaims`
      // emits it as `organization_id` (`verifyMcpAccessToken` reads it back).
      //
      // ⛔ The value is the SESSION's, never the client's: the hook reads the
      // session the provider hands it and nothing else. The authorize query,
      // the consent body and the client's metadata never reach it, so no
      // request parameter can choose the organization a token acts in.
      //
      // ⛔ No session organization ⇒ no reference and no claim. Never a
      // guessed or default one: the principal then resolves with global
      // grants only.
      //
      // Existing consents re-confirm once, by the provider's own lookup: it
      // finds a consent by (client, user, reference) whenever this hook
      // answers a reference, so a consent stored before this binding (its
      // `reference_id` is null) no longer satisfies an authorize made in an
      // organization, and the user sees the consent page again. Until then an
      // old refresh family keeps minting tokens with no claim, because a
      // refresh carries the family's own reference, never the session's.
      //
      // `postLogin` is declared as one object, so its two other members are
      // required beside the hook. `shouldRedirect` answers false: the
      // organization is the one the session already has, not a choice made
      // on an extra page. `page` is read only when `shouldRedirect` answers
      // true, which it never does here; it names the consent page so that it
      // could only ever point at a page that exists.
      postLogin: {
        page: this.getConsolePageUrl('/oauth/consent'),
        shouldRedirect: () => false,
        consentReferenceId: ({ session }) => consentOrganizationOf(session),
      },
      // `organization_id` is not in the provider's reserved access-token
      // claim set, which it strips at issuance. This is the claim the
      // `IAuthService.verifyMcpAccessToken` contract names.
      customAccessTokenClaims: ({ referenceId }) =>
        referenceId ? { [OAUTH_ORGANIZATION_CLAIM]: referenceId } : {},
      // ── The standard `locale` claim at userinfo (OIDC Core §5.1) ──
      // `sys_user.locale` under the `profile` scope, so an environment that
      // signs in through this OP follows the user's language; the rule and
      // its failure posture live in `oidc-userinfo-locale-claim.ts`. Userinfo
      // only: the provider keeps profile claims out of the ID token, and the
      // platform RP reads userinfo.
      customUserInfoClaims: ({ user, scopes }) =>
        userInfoLocaleClaim(
          {
            getEngine: () => this.getDataEngine(),
            warn: (message, meta) => this.config.logger?.warn?.(message, meta),
          },
          { user, scopes },
        ),
    })];
    });
  }

  // External SSO (OIDC / SAML) relying-party — lets this environment federate
  // login to a customer's own IdP (Okta / Entra / Google …). Per-env, runtime-
  // registered providers live in `sys_sso_provider` (ADR-0135 D6: the OPEN SSO
  // mechanism — cloud-free for self-host). Endpoints mount under
  // /api/v1/auth/sso/{register,providers,delete-provider,callback,…}.
  //
  // Toggle with `OS_SSO_ENABLED` (mirrors `OS_OIDC_PROVIDER_ENABLED`).
  if (enabled.sso) {
    await this.addOptionalPlugin(plugins, 'sso', async () => {
    const { sso } = await import('@better-auth/sso');
    // NOTE: the `ssoProvider` model is bridged to `sys_sso_provider` by the
    // better-auth adapter / a global model map, not per-plugin here (see the
    // `ssoProvider` NOTE in auth-schema-config.ts).
    //
    // That bridge dates from 1.6.20, where @better-auth/sso hardcoded the
    // model and read no `schema` option. Re-measured against the installed
    // 1.7.1 (`node_modules/@better-auth/sso/dist`) on 2026-08-19 — the pin
    // moved off 1.7.0-rc.2, so the previous stamp here had itself expired
    // (#8224): still no longer true — `SSOOptions.schema.ssoProvider` exists
    // (index-CZytzKv6.d.mts) and the runtime honours `modelName` plus a
    // per-field `fieldName` map (index.mjs, the plugin's `schema:` block). The
    // adapter-level bridge is kept as-is here because it is what the rest of
    // the auth stack is wired to; whether to move it onto the plugin option is
    // a separate change, not a silent one. Only the mapping surface below was
    // re-verified in depth — see register-sso-provider.ts for the
    // `oidcConfig.mapping` strict-object findings.
    //
    // `organizationProvisioning.defaultRole` (cloud ADR-0024 V1): a first-time
    // federated login is JIT-provisioned into the user's domain-matched org
    // with this role, so a member who arrives via an external IdP lands with
    // an explicit default role (belt-and-suspenders over SecurityPlugin's
    // `member_default` fallback, which already grants baseline access to any
    // authenticated user). Requires the `organization` plugin — on by default.
    // `domainVerification.enabled` (ADR-0135 D6, opt-in via OS_SSO_DOMAIN_VERIFICATION):
    // when on, @better-auth/sso mounts /sso/request-domain-verification +
    // /sso/verify-domain (DNS TXT proof-of-ownership) AND enforces that an
    // external IdP's email domain be DNS-verified before it may complete a
    // login — preventing an org admin from registering a provider for a domain
    // they don't control. Off by default to preserve the register→login flow.
    return sso({
      organizationProvisioning: { defaultRole: 'member' },
      ...(enabled.ssoDomainVerification ? { domainVerification: { enabled: true } } : {}),
    });
    });
  }

  // External SCIM 2.0 Service Provider (@better-auth/scim, MIT) — lets an
  // external IdP (Okta / Entra) auto-provision / deprovision THIS env's users
  // (the paid Identity lifecycle, cloud ADR-0071). The env is the SCIM Service
  // Provider; SCIM 2.0 endpoints mount under /api/v1/auth/scim/v2/{Users,…}.
  // `active:false` → ban + session revoke (needs the admin plugin, forced on
  // above). This plugin still accepts no `schema` option (`SCIMOptions`
  // declares no `schema` / `modelName` / `fields` member on the installed
  // 1.7.1), so its seven models are bridged to the `sys_scim_*` platform
  // objects via AUTH_MODEL_TO_PROTOCOL. Toggle with `OS_SCIM_ENABLED`.
  //
  // Connections are RUNTIME DATA, not boot config (#3653): the stable
  // constructor's three-way requirement (static `connections` | bearer
  // verifier | managed catalog) is satisfied with an application-owned
  // `verifyBearerToken` that resolves the connection from a
  // `sys_scim_connection_credential` row at request time. ObjectStack owns
  // the whole credential lifecycle — mint / store / verify — in
  // `scim-connection-service.ts`; only a keyed one-way digest is ever
  // persisted (pinned by `credential-at-rest-posture.test.ts`). The rc.1
  // `storeSCIMToken` / `/scim/generate-token` surface no longer exists on
  // stable, and the upstream `managedConnections` catalog is deliberately
  // NOT adopted (maintainer ruling 2026-08-25).
  if (enabled.scim) {
    await this.addOptionalPlugin(plugins, 'scim', async () => {
      const { scim } = await import('@better-auth/scim');
      const { verifyScimBearerToken } = await import('./scim-connection-service.js');
      const secret = this.resolveAuthSecret();
      return scim({
        connections: [],
        authentication: {
          verifyBearerToken: async (input) => {
            // ⛔ No `scimRequestScope.enterWith(...)` here. The SCIM request
            // scope that makes the adapter open a REAL engine transaction is
            // opened by `handleRequest` with `run(...)` around the whole
            // request (see `SCIM_PROTOCOL_PATH_PREFIX`). It used to be
            // stamped from this callback and never reached the writes: an
            // `enterWith` marks only the async resource it runs in and that
            // resource's descendants, and the vendor resumes the endpoint
            // handler from a continuation captured BEFORE this verifier ran
            // (measured on 1.7.2 — zero engine transactions across a SCIM
            // POST + PATCH; pinned by `scim-transaction-scope.test.ts`).
            const engine = this.config.dataEngine;
            if (!engine) return null; // no store to verify against — fail closed
            return verifyScimBearerToken(engine as never, secret, input.token);
          },
        },
        // [#14360] The host half of `active`: stable @better-auth/scim
        // writes no `banned` itself any more (the 1.6.x coupling left the
        // package in 1.7.0) — it hands the aggregate lifecycle state to
        // this callback inside the SCIM transaction and only revokes
        // sessions. Routed to the platform's own ban write; the break-glass
        // last-administrator guard judges it at the engine. See
        // `reconcileScimUserLifecycle` for the contract and the measurement.
        identity: {
          reconcileUser: (state, context) => this.reconcileScimUserLifecycle(state, context),
        },
      });
    });
  }

  // Device Authorization Grant (RFC 8628) — for CLI / TV-style devices.
  // Exposes the standard `/device/{code,token,approve,deny}` endpoints
  // and persists pending requests in `sys_device_code`.
  //
  // The verification URI points at the account portal page that lets a
  // signed-in user approve or deny a pending CLI login. The page reads
  // the `user_code` query parameter that better-auth appends to
  // `verification_uri_complete`.
  if (enabled.deviceAuthorization) {
    await this.addOptionalPlugin(plugins, 'deviceAuthorization', async () => {
      const { deviceAuthorization } = await import('better-auth/plugins/device-authorization');
      return deviceAuthorization({
        verificationUri: this.getConsolePageUrl('/auth/device'),
        schema: buildDeviceAuthorizationPluginSchema(),
      });
    });
  }

  // customSession() — augments the session payload with the canonical
  // `positions: string[]` array (ADR-0068 D1/D2, renamed ADR-0090 D3) and its
  // derived `isPlatformAdmin` alias.
  //
  // [#15136] `positions[]` is the SECURITY axis — the same set
  // `/auth/me/permissions` reports and every server-side evaluator resolves:
  // the active organization's membership mapped to canonical
  // `org_owner`/`org_admin`/`org_member`, the ADR-0057 D4 `sys_user_position`
  // assignments, the ADR-0090 D5 `everyone` anchor, and `platform_admin`. It
  // is not derived here; it is asked of `resolveUserAuthzGrants`, the ONE
  // authority, for the reason spelled out at the call site below.
  //
  // ⛔ The better-auth `user.role` scalar is NOT a source of it. It used to be
  // (split on commas and unioned in), which put auth-layer role names on an
  // array whose declared meaning — `EvalUserSchema`, "built-in identity names
  // + position names" — is the security axis, and left the real position names
  // off it entirely.
  //
  // IMPORTANT: `user.role` is NOT overwritten — consumers must gate on
  // `positions[]` / `isPlatformAdmin` (e.g. via objectui's
  // `useWorkspaceAdminStatus`), never on `user.role === 'admin'`. A consumer
  // that genuinely wants the better-auth role reads `user.role`, which stays
  // on the payload verbatim; the raw membership role stays on the organization
  // plugin's `member` payload.
  const dataEngine = this.config.dataEngine;
  if (dataEngine) {
    const { customSession } = await import('better-auth/plugins/custom-session');
    plugins.push(customSession(async ({ user, session }) => {
      if (!user?.id) return { user, session };

      // ADR-0068 D1/D2 (renamed ADR-0090 D3) — emit ONE canonical
      // positions[] (identity names + position names), with NO singular
      // overwrite. isPlatformAdmin is a DERIVED alias of
      // `'platform_admin' in positions`, retained for back-compat clients.
      // [#10348] Asked through the ONE authority, exactly as `/sso/register`
      // and `/admin/impersonate-user` ask it — so the session payload can no
      // longer disagree with the gates about who a platform admin is.
      //
      // [#15136 — maintainer ruling 2026-09-05, option A] ONE name, ONE
      // meaning: `positions[]` is the SECURITY axis on every surface.
      //
      // This used to be a hand-rolled union — the better-auth `sys_user.role`
      // scalar split on commas, plus the active membership mapped to `org_*`,
      // plus `platform_admin`. It read NOTHING from `sys_user_position`, the
      // ADR-0057 D4 table that is the source of truth for custom positions, so
      // a user genuinely holding a business position got a payload without it
      // and every client-side gate narrowed by that position answered FALSE —
      // silently, because the root and the key were both bound and CEL raised
      // nothing. `EvalUserSchema` had declared the opposite all along
      // ("built-in identity names + position names", "evaluates identically
      // wherever it is written"); the Console binds this array straight through
      // as `current_user`, so the payload WAS the contract violation.
      //
      // The derivation is not repaired here — it is DELETED and asked of the
      // authority instead. `resolve-authz-context.ts` states that every entry
      // point must resolve authorization through it and never re-read the
      // `sys_*` grant tables itself; this callback was doing exactly what that
      // forbids, which is how it drifted out of agreement with
      // `/auth/me/permissions` (served from the same `grants.positions`) and
      // with every server-side evaluator (`ExecutionContext.positions`) in the
      // first place. The same move `isPlatformAdminUserId` made at #10348.
      //
      // Scoped to the session's ACTIVE organization, so a position held in one
      // organization does not answer while the caller operates in another —
      // the resolver's own rule, now applied to the payload too.
      //
      // `isPlatformAdmin` comes from the posture RUNG on the same envelope,
      // never from the array. ⛔ `positions.includes('platform_admin')` is the
      // form `resolve-authz-context.ts` explicitly forbids, because an
      // ADR-0057 D4 `sys_user_position` row MAY SPELL THAT VERY NAME and a
      // platform-RBAC assignment is not the ADR-0068 D2 capability grant.
      // Under ruling A that stopped being theoretical: moving `positions` to
      // the security axis moved the string `platform_admin` into a space a
      // tenant admin can WRITE (`sys_user_position` is `apiEnabled`), so an
      // array read here would have let a tenant mint platform standing and
      // pass the `/admin/*` mount gate. `grants.posture === 'PLATFORM_ADMIN'`
      // is byte-for-byte what `hasPlatformAdminStanding` returns, so the
      // payload, that predicate and `judgePlatformAdmin` cannot disagree.
      // ADR-0068 D2 defines the alias as `'platform_admin' in roles`; that
      // wording predates D4 rows being able to spell built-in names, and
      // core's later ⛔ is the specific rule.
      //
      // Fail CLOSED on an unreadable grant store, matching what both halves of
      // the old derivation already did (`isPlatformAdminUserId` returns false
      // on any lookup error; `activeOrgRoles` caught to `[]`). Warned rather
      // than swallowed — an empty `positions[]` hides UI, and this card is
      // about exactly that going unannounced.
      //
      // The seed email is the session's own, spelled as `resolveAuthzContext`
      // spells it for this session (`String(user.email)` when present), so an
      // in-process session read that `resolveAuthzContext` makes asks for
      // EXACTLY the resolution its own step 2 asks for — and core's
      // request-scoped memo serves that step this resolution instead of
      // issuing every grant read twice per request. It shapes nothing read
      // here: `grants.email` is the only output it reaches, and the
      // platform-admin config anchor compares the STORED `sys_user.email`,
      // never a seed (core §6b-config).
      let positions: string[] = [];
      let platformAdmin = false;
      try {
        const grants = await resolveUserAuthzGrants(dataEngine as any, user.id, {
          tenantId: (session as any)?.activeOrganizationId ?? undefined,
          seedEmail: user.email ? String(user.email) : undefined,
        });
        positions = grants.positions;
        platformAdmin = grants.posture === 'PLATFORM_ADMIN';
      } catch (err: any) {
        console.warn(
          '[auth] could not resolve authorization grants for the session payload; '
          + 'positions[] is empty and position-gated UI will be hidden:',
          err?.message ?? String(err),
        );
      }

      // ADR-0069 — authentication-policy gate posture (password expiry,
      // enforced MFA). Computed only when a gate feature is enabled (else
      // zero extra reads on the hot path); surfaced as `user.authGate` for
      // the transport seams to enforce. See computeAuthGate().
      // ADR-0069 D4 — session controls (idle / absolute). Best-effort;
      // revokes the session in place when exceeded (next request → 401).
      await this.enforceSessionControls((session as any)?.id, (session as any)?.createdAt);

      // An impersonation session carries the administrator who started it
      // (`impersonatedBy`, written by the admin plugin's impersonation and
      // stored as `sys_session.impersonated_by`); which postures hold the
      // session depends on it — see computeAuthGate().
      const impersonatedBy = (session as any)?.impersonatedBy;
      const authGate = await this.computeAuthGate(
        user.id,
        (session as any)?.activeOrganizationId,
        (user as any)?.twoFactorEnabled === true,
        { impersonation: typeof impersonatedBy === 'string' && impersonatedBy.trim() !== '' },
      );

      return {
        user: { ...user, positions, isPlatformAdmin: platformAdmin, ...(authGate ? { authGate } : {}) },
        session,
      };
    }));
  }

  return plugins;
}
