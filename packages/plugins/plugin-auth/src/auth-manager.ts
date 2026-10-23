// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Auth, BetterAuthOptions } from 'better-auth';
import type { JSONWebKeySet } from 'jose';
import type { OrganizationOptions } from 'better-auth/plugins/organization';
import type { SCIMIdentityState, SCIMTransactionContext } from '@better-auth/scim';
// better-auth value imports (betterAuth + plugins) are deferred via dynamic
// import() in getOrCreateAuth() / buildPluginList() so that disabled plugins
// never get loaded into the process. See Stage 2F (RSS investigation).
import type {
  AuthConfig,
  EmailAndPasswordConfig,
  AuthPluginConfig,
  OidcProvidersConfig,
} from '@objectstack/spec/system';
import {
  SystemObjectName,
  audiencePermitsSelfRegistration,
  preferredLocaleFromHeader,
} from '@objectstack/spec/system';
import {
  assertAudienceConfig,
  isHumanUserRow,
  resolveAudience,
  resolveEmailVerificationRequirement,
  type ResolvedAudience,
  type VerificationDeclarant,
} from './audience-posture.js';
import {
  PLATFORM_IDP_PROVIDER_ID,
  type LinkingAuthContext,
  refuseImplicitAccountLink,
} from './implicit-account-linking.js';
import { CLOUD_MANAGED_REFUSAL_CODE, CLOUD_MANAGED_REFUSAL_MESSAGES } from './cloud-managed.js';
import { IdpLocaleSync } from './idp-locale-claim.js';
import type { IDataEngine } from '@objectstack/core';
import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_INACTIVITY_DAYS,
  API_KEY_MAX_EXPIRY_DAYS,
  accountScopeAuthGate,
  // [#25083] Is this process a cloud-managed (hosted) environment? The ONE
  // accessor every managed-mode judgement here asks, and nothing else.
  isCloudManaged,
  resolveUserAuthzGrants,
} from '@objectstack/core';
import type { AuthGate } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type {
  ApiKeyLifecyclePolicy,
  IEmailService,
  II18nService,
  ISmsService,
  PrincipalSession,
  PrincipalSessionMintOptions,
} from '@objectstack/spec/contracts';
import {
  readEnvWithDeprecation,
  resolveTenancyPosture,
  resolveOrgLimit,
  isMcpServerEnabled,
} from '@objectstack/types';
import { resolveMembershipLimitOption } from './membership-limit.js';
import {
  MEMBERSHIP_ROLE_DELEGATED_ADMIN,
  MEMBERSHIP_ROLE_EXTERNAL,
} from '@objectstack/spec';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { MCP_OAUTH_SCOPES } from '@objectstack/spec/ai';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
import { createObjectQLAdapterFactory, withSystemContext, withSystemReadContext } from './objectql-adapter.js';
import { narrowDirectoryForExternalCaller, type ExternalDirectoryDoorDeps } from './external-directory-door.js';
import { isExternalMembershipRole } from './external-membership.js';
import { permissionSetInEffect } from './catalog-set-in-effect.js';
import { recoverInternalFieldsForSystemRead } from './internal-field-readback.js';
import { setAuthActorResolver } from './auth-actor-attribution.js';
import {
  SIGN_IN_EMAIL_PATH,
  type AuthEventAuditSurface,
} from './auth-session-audit.js';
import {
  type BetterAuthRouteOwnership,
} from './better-auth-route-ownership.js';
import {
  rotateCallerBearerOnImpersonation,
} from './impersonation-bearer-rotation.js';
import { echoInstalledSessionToken } from './two-factor-rotated-token-echo.js';
import { resetVerifiedOnTwoFactorReenrollment } from './two-factor-reenrollment-verified-reset.js';
import { codeInviteRoleNotFound } from './invite-role-not-found-code.js';
import { attachSessionToCredentialResponse } from './session-envelope-completion.js';
import {
  applyPlatformAdminImpersonation,
  VENDOR_ROLE_SCALAR_ADMIN_PATHS,
} from './admin-impersonate-endpoint.js';
import {
  carriesPrincipalSession,
  mintPrincipalSession,
  type PrincipalSessionAuthContext,
} from './principal-session-mint.js';
import {
  applyDeclaredInvitationVerificationToListing,
} from './list-user-invitations-verification.js';
import {
  invitationRoleCapFailure,
  isPlainMemberInvitation,
} from './invitation-role-cap.js';
import { isPlaceholderEmail } from './placeholder-email.js';
import { readAccountInvitation, settleImportResetDelivery } from './account-invitation-marker.js';
import { resolveClientAddress } from './client-address.js';
import { vendorClientAddressOptions } from './client-address-vendor.js';
import { readRequestClientAddress } from './request-client-address.js';
import {
  type MembershipPolicy,
  type ReconcileOutcome,
} from './reconcile-membership.js';
import type { TenancyService } from './tenancy-service.js';
import { OtpSendGuard, assertOtpCooldownSeconds } from './otp-send-guard.js';
import type { CounterStore } from './rate-limit-storage.js';
import {
  isLastLocalCredentialHolder,
  LAST_LOCAL_CREDENTIAL_CODE,
  LAST_LOCAL_CREDENTIAL_MESSAGE,
} from './last-local-credential.js';
import {
  applyUserBan,
  applyUserUnban,
  SCIM_DEACTIVATION_BAN_REASON,
} from './user-ban-write.js';
import { invitationRoleLabel } from './invitation-role-label.js';
import {
  AUTH_USER_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_ACCOUNT_CONFIG,
  AUTH_VERIFICATION_CONFIG,
  buildOrganizationPluginSchema,
  buildTwoFactorPluginSchema,
  buildOauthProviderPluginSchema,
  buildDeviceAuthorizationPluginSchema,
  buildAdminPluginSchema,
  buildPhoneNumberPluginSchema,
} from './auth-schema-config.js';
import {
  ORGANIZATION_DELETE_PATH,
  isDefaultOrganizationTarget,
  removeOrganizationAuthStructure,
} from './organization-delete.js';
// [#25224 cut 1] The actor and organization guards; the methods of the same
// names below hand each body the members it reads (`ActorGuardHost`).
import {
  assertActorNotHeld,
  assertAdminRevokeUserSessionIdentifiesRecord,
  assertOrganizationDeletable,
  assertRemoveMemberPermitted,
  assertRevokeSessionIdentifiesRecord,
  isPlatformAdminUserId,
  resolveActor,
  resolveMembershipRole,
  type ActorGuardHost,
} from './auth-manager-actor-guards.js';
// [#25224 cut 2] The sign-in lockout path; the methods of the same names
// below hand each body the members it reads (`SignInLockoutHost`).
import {
  assertAccountNotLocked,
  auditRefusedSignIn,
  findSignInAccount,
  recordSignInOutcome,
  resolveSignInAccountId,
  resolveTwoFactorAccountLockout,
  stampLastLogin,
  type SignInLockoutHost,
} from './auth-manager-sign-in-lockout.js';
// [#25224 cut 3] The password, auth-gate and session policy; the methods of
// the same names below hand each body the members it reads
// (`PasswordSessionPolicyHost`).
import {
  assertPasswordComplexity,
  assertPasswordNotReused,
  enforceConcurrentCap,
  enforceSessionControls,
  parseHashes,
  recordPasswordHistory,
  refreshMustChangeCacheIfStale,
  refreshOrgMfaCacheIfStale,
  resolvePasswordChangeUserId,
  resolveUserAuthGates,
  stampPasswordChangedAt,
  unlockUser,
  type PasswordSessionPolicyHost,
} from './auth-manager-password-session-policy.js';
// [#25224 cut 4] The better-auth database hooks and the identity-source stamp
// they run; the methods of the same names below hand each body the members it
// reads (`DatabaseHooksHost`).
import {
  composeDatabaseHooks,
  stampIdentitySource,
  type DatabaseHooksHost,
} from './auth-manager-database-hooks.js';
// [#25224 cut 5] The email and SMS delivery; the methods of the same names
// below hand each body the members it reads (`EmailSmsDeliveryHost`).
import {
  assertPhoneOtpSendAllowed,
  deliverPhoneOtp,
  getOtpSendGuard,
  renderPhoneSmsBody,
  sendChangeEmailNotice,
  sendPhoneInviteSms,
  storedRecipientLocale,
  type EmailSmsDeliveryHost,
} from './auth-manager-email-sms-delivery.js';
// [#25224 cut 6] The plugin assembly helpers; the methods of the same names
// below hand each body the members it reads (`PluginAssemblyHost`).
import {
  addOptionalPlugin,
  buildJwtPlugin,
  reportJwtSigningFailure,
  type PluginAssemblyHost,
} from './auth-manager-plugin-assembly.js';
// [#25224 cut 7] The database and the secret handed to better-auth; the
// methods of the same names below hand each body the members it reads
// (`DatabaseSecretHost`).
import {
  createDatabaseConfig,
  generateSecret,
  resolveAuthSecret,
  type DatabaseSecretHost,
} from './auth-manager-database-secret.js';
// [#25224 cut 8] The audience gate, the membership reconciler's assembly and
// the self-registration grant's landing; the methods of the same names below
// hand each body the members it reads (`MembershipAdmissionHost`).
import {
  landSelfRegistrationGrant,
  reportUngrantedSelfRegistrant,
  settleMembership,
  validateAudienceAdmission,
  type MembershipAdmissionHost,
} from './auth-manager-membership-admission.js';
// [#25224 cut 9] The MCP access-token verifier and its forced keyring re-read;
// the methods of the same names below hand each body the members it reads
// (`McpAccessTokenHost`).
import {
  rereadKeyringForUnknownKey,
  verifyMcpAccessToken,
  type McpAccessTokenHost,
} from './auth-manager-mcp-access-token.js';
// [#25224 cut 10] The request routing — the seam every better-auth request
// passes through, route ownership and the endpoint path both key on; the
// methods of the same names below hand each body the members it reads
// (`RequestRoutingHost`).
import {
  betterAuthEndpointPath,
  handleRequest,
  ownsRoute,
  type RequestRoutingHost,
} from './auth-manager-request-routing.js';

/**
 * Detect WebContainer (StackBlitz) environment.
 *
 * WebContainer reports itself as Node.js but runs inside a browser. Several
 * Node APIs are polyfilled with significant behavioural differences — most
 * notably `node:async_hooks.AsyncLocalStorage`, whose `run()` does NOT
 * propagate the store across `await` boundaries the way Node's native
 * implementation does.
 */
function isWebContainerRuntime(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const proc = (globalThis as any).process;
  return (
    Boolean(proc?.versions?.webcontainer) ||
    Boolean(proc?.env?.SHELL?.includes?.('jsh')) ||
    Boolean(proc?.env?.STACKBLITZ)
  );
}

/**
 * Synchronous AsyncLocalStorage polyfill compatible with better-auth's
 * `requestStateAsyncStorage` slot.
 *
 * Behaviour:
 * - `run(store, fn)` sets the current store synchronously before invoking
 *   `fn` and restores the previous store after `fn` (and any promise it
 *   returns) settles.
 * - `getStore()` returns the current store.
 *
 * Why a polyfill is needed in WebContainer:
 * - WebContainer's `node:async_hooks` does not propagate ALS context through
 *   `await`, so better-auth's `runWithRequestState(map, () => handler(req))`
 *   wrap loses the store as soon as the call chain awaits anything (e.g.
 *   the inner `customSession` → `getSession()` call). All endpoints that
 *   read request-state via `defineRequestState()` then throw
 *   "No request state found".
 *
 * Single-flight caveat:
 * - This polyfill is process-global, not async-context-local. In a real
 *   server it could leak state across concurrent requests. That risk is
 *   acceptable here because:
 *   1) It is only installed when WebContainer is detected (dev / preview
 *      sandboxes that handle one request at a time).
 *   2) Each request still wraps the entire handler in `runWithRequestState`
 *      with a fresh WeakMap, so the in-flight request always sees its own
 *      store as long as nothing else mutates the slot mid-flight.
 */
class WebContainerRequestStateAsyncLocalStorage<T> {
  private current: T | undefined = undefined;

  run<R>(store: T, fn: () => R): R {
    const prev = this.current;
    this.current = store;
    try {
      const result = fn() as unknown;
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).finally(() => {
          this.current = prev;
        }) as unknown as R;
      }
      this.current = prev;
      return result as R;
    } catch (err) {
      this.current = prev;
      throw err;
    }
  }

  getStore(): T | undefined {
    return this.current;
  }
}

/**
 * Pre-populate better-auth's global `requestStateAsyncStorage` slot with the
 * synchronous polyfill when running inside WebContainer.
 *
 * Better-auth caches its AsyncLocalStorage instance on
 * `globalThis[Symbol.for('better-auth:global')].context.requestStateAsyncStorage`
 * the first time `ensureAsyncStorage()` runs (see
 * `@better-auth/core/dist/context/request-state.mjs`). By seeding that slot
 * BEFORE any better-auth code touches it, every call to
 * `runWithRequestState` / `getCurrentRequestState` — including the
 * `@better-auth/core` copy that `plugin-auth` imports directly and the copy
 * bundled with `better-auth` itself — share the same working polyfill.
 *
 * Outside WebContainer this is a no-op so production deployments keep
 * Node's native AsyncLocalStorage.
 */
function installWebContainerRequestStatePolyfill(): void {
  if (!isWebContainerRuntime()) return;
  const sym = Symbol.for('better-auth:global');
  const g = globalThis as any;
  if (!g[sym]) {
    g[sym] = { version: '0.0.0-polyfill', epoch: 0, context: {} };
  }
  if (!g[sym].context) g[sym].context = {};
  if (!g[sym].context.requestStateAsyncStorage) {
    g[sym].context.requestStateAsyncStorage = new WebContainerRequestStateAsyncLocalStorage();
    console.warn(
      '[AuthManager] WebContainer detected: installed synchronous request-state polyfill ' +
        '(node:async_hooks AsyncLocalStorage does not propagate context across await in WebContainer).',
    );
  }
}

/**
 * [#7724] Carries better-auth's own error `Response` out through the engine
 * transaction that must roll back because of it.
 *
 * better-auth's HTTP entrypoint CATCHES every fault and RETURNS a `Response` —
 * it does not throw. A `try`/`catch`-shaped unit of work therefore sees a clean
 * return on the exact path it exists to undo, commits, and the partial writes
 * land anyway. So the failure signal has to be re-raised from the response
 * status, and the response itself has to survive the throw that rolls the
 * transaction back — that is the whole job of this class. It never escapes
 * `runSubjectErasureAtomically`, which unwraps it back into the response the
 * client was always going to get.
 */
class SubjectErasureRollback extends Error {
  constructor(readonly response: Response) {
    super(`subject-erasure unit of work rolled back (HTTP ${response.status})`);
    this.name = 'SubjectErasureRollback';
  }
}

function readBooleanEnv(name: string, legacyName?: string): boolean | undefined {
  const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
  const raw = env?.[name] ?? (legacyName ? env?.[legacyName] : undefined);
  if (raw == null) return undefined;
  const normalized = String(raw).trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

function readDisableSignUpEnv(): boolean | undefined {
  const signupEnabled = readBooleanEnv('OS_AUTH_SIGNUP_ENABLED');
  if (signupEnabled != null) return !signupEnabled;
  return readBooleanEnv('OS_DISABLE_SIGNUP');
}

/**
 * SSO-only ("enforced") login mode from the deployment env. Self-host ops set
 * `OS_AUTH_SSO_ONLY=true` to lock the team to the configured IdP (parity with
 * the `OS_DISABLE_SIGNUP` self-host knob). The cloud runtime drives the same
 * behaviour per-env via the `ssoOnlyMode` config field instead.
 */
function readSsoOnlyEnv(): boolean | undefined {
  return readBooleanEnv('OS_AUTH_SSO_ONLY');
}

/**
 * [#16384] The auth plugin's shipped `basePath` default — the ONE place this
 * literal is written. Before this card it existed independently at four
 * sites: this file's own `configuredBasePath()` fallback below, plus three in
 * `auth-plugin.ts` (the constructor default and two later re-derivations of
 * "what if the caller cleared `basePath`?"). A future edit to one could drift
 * from the other three silently — `configuredBasePath()`'s own fallback is
 * unfalsifiable by construction on the live path (`AuthPlugin` always supplies
 * `basePath`, per its constructor default below), so no runtime test could
 * have caught that drift. Every one of the four readers now evaluates BYTE
 * IDENTICALLY to before this constant existed — see `configuredBasePath()`'s
 * docblock for the normalisation chain this does NOT touch.
 */
export const DEFAULT_AUTH_BASE_PATH = '/api/v1/auth';

/**
 * Whether this runtime serves the HTTP MCP surface (`/api/v1/mcp`).
 * Delegates to the platform-wide decision point (`isMcpServerEnabled` in
 * `@objectstack/types`): default ON, explicit `false` opts out — so the
 * OAuth/DCR follow-defaults below track the surface they exist to serve.
 */
export function readMcpServerEnabledEnv(): boolean {
  return isMcpServerEnabled();
}

/**
 * SINGLE decision point for "is the embedded OAuth/OIDC authorization server
 * on?" — shared by `buildPluginList()`, the `/auth/config` features block and
 * the discovery-route mounting in `auth-plugin.ts`, so the wired plugin, the
 * advertised feature flag and the `.well-known` documents can never disagree.
 *
 * Resolution order: `OS_OIDC_PROVIDER_ENABLED` env (operator override, wins)
 * → config file → **on when the MCP server surface is enabled** (#2698: the
 * MCP endpoint's human-client track is OAuth 2.1 and every deployment is its
 * own authorization server, so enabling MCP without an AS would strand every
 * OAuth-capable client on admin-minted API keys).
 */
export function resolveOidcProviderEnabled(pluginConfig?: Partial<AuthPluginConfig>): boolean {
  return readBooleanEnv('OS_OIDC_PROVIDER_ENABLED') ?? pluginConfig?.oidcProvider ?? readMcpServerEnabledEnv();
}

/**
 * Whether RFC 7591 Dynamic Client Registration is allowed on the embedded
 * authorization server. `OS_OIDC_DCR_ENABLED` env wins, then the config
 * field, then it FOLLOWS the MCP surface: DCR is what lets a generic MCP
 * client self-register against any deployment (no central client registry
 * exists), so it defaults on exactly when MCP is on.
 */
export function resolveDcrEnabled(pluginConfig?: Partial<AuthPluginConfig>): boolean {
  return (
    readBooleanEnv('OS_OIDC_DCR_ENABLED') ??
    pluginConfig?.dynamicClientRegistration ??
    readMcpServerEnabledEnv()
  );
}

/**
 * SINGLE decision point for "is the SCIM provisioning surface effective?" —
 * shared by `buildPluginList()`, the `/auth/config` features block and
 * {@link assertScimAdminCoherence}, so the wired plugin, the advertised
 * feature flag and the conflict refusal can never disagree.
 *
 * Resolution order (#13439, maintainer ruling 2026-08-31): an EXPLICIT
 * `plugins.scim` wins over `OS_SCIM_ENABLED`; the env var decides only where
 * the config leaves the key unset (absent everywhere ⇒ off).
 */
export function resolveScimEnabled(pluginConfig?: Partial<AuthPluginConfig>): boolean {
  return pluginConfig?.scim ?? readBooleanEnv('OS_SCIM_ENABLED') ?? false;
}

/**
 * Entry validation (#13816, maintainer ruling 2026-09-01) — REFUSES the one
 * incoherent corner of the `admin` tri-state at the point the config enters
 * the manager (constructor, `applyConfigPatch`, and `buildPluginList()` for
 * env vars read after boot), loudly, with the remedy in the message.
 *
 * SCIM's `active:false` deprovisioning path runs through the better-auth
 * `admin` plugin (ban/unban — ADR-0134), so a SCIM-enabled deployment cannot
 * have the admin plugin declined: effective SCIM with an explicit
 * `plugins.admin: false` is a contradiction. Previously the resolution
 * honoured the explicit `false` and mounted SCIM anyway — deprovisioning
 * broke silently. Absent `admin` is untouched: effective SCIM still forces
 * the admin plugin on (`admin: pluginConfig.admin ?? scimEffective`).
 * Whether SCIM's admin dependency can instead be narrowed to the actions it
 * actually needs is #14150's measurement (Shape 1); this refusal is the
 * honest floor pending that reading.
 */
export function assertScimAdminCoherence(pluginConfig?: Partial<AuthPluginConfig>): void {
  if (pluginConfig?.admin === false && resolveScimEnabled(pluginConfig)) {
    throw new Error(
      '[auth] conflicting auth plugin configuration: SCIM provisioning is effective ' +
      '(plugins.scim, or OS_SCIM_ENABLED where the config leaves it unset) while plugins.admin ' +
      "is explicitly false. SCIM's active:false deprovisioning path runs through the better-auth " +
      'admin plugin (ban/unban — ADR-0134), so a SCIM-enabled deployment cannot decline the admin ' +
      'surface. Either accept the admin plugin (remove plugins.admin: false, or set it true), or ' +
      'disable SCIM (plugins.scim: false — which also declines the admin plugin it would force on). ' +
      'Refused loudly at construction instead of silently mounting SCIM without its deprovisioning ' +
      'path.',
    );
  }
}

/**
 * Expand an IPv6 literal (already unbracketed) to its eight 16-bit groups, or
 * `null` when it is not one. Handles `::` elision and a trailing embedded
 * IPv4 (`::ffff:10.0.0.5`) so the classifier below reads real bits rather
 * than matching text prefixes.
 */
function parseIpv6Literal(host: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(host)) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const pieces = part.split(':');
    const out: number[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      if (piece.includes('.')) {
        // An embedded IPv4 tail is legal only in the last position.
        if (i !== pieces.length - 1) return null;
        const v4 = ipv4ToInt(piece);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]!);
  if (tail === null) return null;
  const elided = 8 - head.length - tail.length;
  if (elided < 1) return null;
  return [...head, ...new Array<number>(elided).fill(0), ...tail];
}

/**
 * Is this host LITERAL a loopback, RFC 1918 private, RFC 4193 unique-local or
 * link-local address? The ruled allow-list, and nothing wider:
 *
 *   IPv4  127.0.0.0/8 (loopback) · 10.0.0.0/8 · 172.16.0.0/12 · 192.168.0.0/16
 *         169.254.0.0/16 (link-local)
 *   IPv6  ::1 (loopback) · fc00::/7 (unique-local) · fe80::/10 (link-local)
 *
 * Boundaries that decide the verdict, each pinned in
 * `auth-manager.mcp-oauth.test.ts`: `172.15.x` and `172.32.x` sit OUTSIDE
 * RFC 1918 and are refused; `fec0::/10` site-local was deprecated by RFC 3879
 * and is NOT inside `fc00::/7`, so it is refused too; an IPv4-mapped IPv6
 * form (`::ffff:10.0.0.5`, which WHATWG URL canonicalises to `::ffff:a00:5`)
 * is refused rather than unwrapped — the conservative side of a rule whose
 * failure mode is opening plaintext OAuth to the public internet. The whole
 * of `127.0.0.0/8` is loopback (RFC 1122 §3.2.1.3), not the single literal
 * `127.0.0.1`, and `http://127.0.0.2` pins that.
 *
 * The IPv4 half is spelled with this file's own ADR-0069 D5 helpers
 * ({@link ipMatchesRange}, `ipv4ToInt`) rather than a second dotted-quad
 * regex: one parser for IPv4 literals in this file, and the ranges read as
 * the CIDR blocks the ruling names.
 */
const PLAIN_HTTP_ELIGIBLE_IPV4_CIDRS = [
  '127.0.0.0/8', // loopback (RFC 1122)
  '10.0.0.0/8', // RFC 1918
  '172.16.0.0/12', // RFC 1918
  '192.168.0.0/16', // RFC 1918
  '169.254.0.0/16', // RFC 3927 link-local
] as const;

function isPrivateOrLoopbackHostLiteral(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  if (ipv4ToInt(bare) !== null) {
    return PLAIN_HTTP_ELIGIBLE_IPV4_CIDRS.some((cidr) => ipMatchesRange(bare, cidr));
  }

  const v6 = parseIpv6Literal(bare);
  if (v6) {
    if (v6.every((g, i) => (i === 7 ? g === 1 : g === 0))) return true; // ::1
    const first = v6[0]!;
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
    return false;
  }

  return false;
}

/**
 * OAuth 2.1 §1.5 transport rule for the MCP OAuth track, applied at
 * DEPLOYMENT level with the semantics of Keycloak's `sslRequired=external`:
 * TLS is required on a PUBLIC host, and plain HTTP is accepted when the
 * deployment's own canonical origin is a loopback or private / link-local
 * address. A plain-HTTP PUBLIC deployment keeps the API-key track only — the
 * OAuth surface (protected-resource metadata, bearer acceptance) stays dark,
 * fail-closed, and is logged once at mount time.
 *
 * ## Why private hosts are eligible (maintainer ruling 2026-09-21)
 *
 * A deployment that already serves its login form and session cookies over
 * plain HTTP gains nothing from OAuth refusing plain HTTP: the refusal only
 * removes MCP from that deployment. Intranet installs and a developer's
 * `os dev` bound to a LAN address are the same case, so there is no separate
 * development-mode branch and ⛔ no configuration key or environment variable
 * — a switch would be reachable on a public host, which is exactly the
 * deployment this rule must keep refusing.
 *
 * ## The reading pinned for a non-IP hostname
 *
 * This judges the HOST LITERAL of the deployment's own canonical origin. An
 * intranet hostname (`crm.corp`, `host.docker.internal`) is not an IP
 * literal, so over plain HTTP it stays REFUSED, and the remedy is to
 * configure the base URL on the private address the deployment already binds
 * (`http://192.168.1.10:3000`). The two alternatives were both rejected, on
 * the record:
 *
 * - **Resolving the hostname in DNS** would make a pure, synchronous
 *   predicate depend on a network round trip on every `isMcpOAuthEnabled()`
 *   call, and a name whose answer can change (or be rebound) turns the
 *   transport verdict into something no test can pin.
 * - **Judging the REQUESTER's peer address**, which is what Keycloak's
 *   `sslRequired=external` does, cannot decide what this deployment
 *   ADVERTISES at mount time, and it carries a false-safe we would be
 *   adopting knowingly: a plain-HTTP reverse proxy on a public address
 *   forwards every request from a private peer, so every requester looks
 *   internal and plaintext OAuth is served to the public internet. The same
 *   false-safe reaches this rule from the other side — a private canonical
 *   origin that a public plain-HTTP proxy fronts is eligible here — and it is
 *   documented rather than keyed, exactly as Keycloak documents its own.
 */
export function isOAuthEligibleBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    return isPrivateOrLoopbackHostLiteral(host);
  } catch {
    return false;
  }
}

/**
 * Extended options for AuthManager
 */
/**
 * [ADR-0105 D8] The slice of `@objectstack/plugin-security`'s
 * `invitation-placement` service plugin-auth depends on. Structural, so
 * plugin-auth gains no dependency on plugin-security.
 */
export interface InvitationPlacementServiceLike {
  /**
   * Refuses with the gate's `PermissionDeniedError` (`code: 'PERMISSION_DENIED'`)
   * when the issuer may not place this invitation. Any other throw is a failure
   * to reach that verdict, such as a store that could not answer.
   */
  assertIssuable(args: {
    intent: { businessUnitId: string; positions: string[] };
    /** The ISSUER's user id — the service resolves their grants itself. */
    actorUserId?: string | null;
    organizationId?: string | null;
  }): Promise<void>;
  apply(args: {
    intent: { businessUnitId: string; positions: string[] };
    userId: string;
    organizationId?: string | null;
    grantedBy?: string | null;
  }): Promise<{ created: number; skipped: number }>;
}

/**
 * [ADR-0105 D8] Normalize placement intent off an invitation draft/row.
 * Accepts better-auth's camelCase draft shape and the snake_case persisted
 * row, and a `positions` value that survived a JSON round-trip as a string.
 * Returns `null` when there is no usable intent — an invitation WITHOUT
 * placement is the ordinary case, not an error.
 */
export function readInvitationPlacementIntent(
  row: unknown,
): { businessUnitId: string; positions: string[] } | null {
  const r = (row ?? {}) as Record<string, unknown>;
  const buRaw = r.businessUnitId ?? r.business_unit_id;
  const businessUnitId = typeof buRaw === 'string' && buRaw !== '' ? buRaw : null;

  let posRaw: unknown = r.positions;
  if (typeof posRaw === 'string') {
    try {
      posRaw = JSON.parse(posRaw);
    } catch {
      posRaw = [posRaw];
    }
  }
  const positions = Array.isArray(posRaw)
    ? posRaw.filter((p): p is string => typeof p === 'string' && p !== '')
    : [];

  if (!businessUnitId || positions.length === 0) return null;
  return { businessUnitId, positions };
}

export interface AuthManagerOptions extends Partial<AuthConfig> {
  /**
   * Better-Auth instance (for advanced use cases)
   * If not provided, one will be created from config
   */
  authInstance?: Auth<any>;

  /**
   * ObjectQL Data Engine instance
   * Required for database operations using ObjectQL instead of third-party ORMs
   */
  dataEngine?: IDataEngine;

  /**
   * Optional callback invoked AFTER an organization is created via better-auth's
   * `createOrganization` (the org-plugin `afterCreateOrganization` hook). Lets a
   * host stack run org-creation side effects that core `databaseHooks` can't —
   * better-auth's org-plugin models (`organization`/`member`) do NOT fire those.
   * The cloud control plane uses it to provision an org's born-with production
   * environment. Failure-isolated: org creation is never rolled back.
   */
  onOrganizationCreated?: (data: {
    organizationId: string;
    userId?: string;
    name?: string;
    slug?: string;
  }) => void | Promise<void>;

  /**
   * [ADR-0105 D8] Optional callback invoked AFTER an invitation is accepted
   * via better-auth (`organizationHooks.afterAcceptInvitation`) — the seam a
   * host uses to apply an invitation's PLACEMENT INTENT (business-unit
   * membership + position assignments, carried as extension fields on
   * `sys_invitation` per the ADR-0092 whitelist) the moment the better-auth
   * membership lands. Same rationale as {@link onOrganizationCreated}: the
   * org-plugin models don't fire core `databaseHooks`, so this is the only
   * server-side seam for accept-time side effects.
   *
   * `invitation` / `member` are the full better-auth rows, so a host reads
   * its own extension columns without a second query. Failure-isolated: the
   * acceptance is never rolled back on a side-effect miss — a host that
   * needs placement to be effectively atomic should make the callback
   * idempotent and reconcile on retry.
   */
  /**
   * [ADR-0105 D8] Lazy accessor for the `invitation-placement` service
   * (registered by `@objectstack/plugin-security`). Wired by `AuthPlugin`;
   * lazy because plugin-security starts after plugin-auth.
   *
   * It carries the authority for scoped invitations: issuance authorizes the
   * requested placement against the ISSUER's `adminScope`, acceptance applies
   * it. Absent (an embedding without plugin-security) ⇒ an invitation that
   * requests placement is REFUSED — there is no gate to check it against, and
   * an unchecked placement would hand `organization_admin` the RBAC-write
   * authority it is deliberately denied elsewhere.
   */
  invitationPlacement?: () => Promise<InvitationPlacementServiceLike | undefined>;

  onInvitationAccepted?: (data: {
    invitationId?: string;
    organizationId?: string;
    userId?: string;
    memberId?: string;
    role?: string;
    email?: string;
    invitation?: Record<string, unknown>;
    member?: Record<string, unknown>;
  }) => void | Promise<void>;

  /**
   * D5.1 — OIDC OP authorization gate (cloud-as-IdP app-assignment).
   * When set, it is called for an AUTHENTICATED subject on
   * `/oauth2/authorize` before an authorization code is issued, with the
   * subject + the requesting `clientId`. Return `false` to DENY (no code).
   * The cloud control plane uses it to require org-membership: a cloud user
   * may only obtain a code for an env client (`project_<envId>`) of an org
   * they belong to. Unset (open editions / self-host, where the OP is not a
   * multi-tenant issuer) = allow. Host is expected to fail CLOSED on error.
   */
  oidcAuthorizeGate?: (params: { userId: string; clientId: string }) => boolean | Promise<boolean>;

  /**
   * Base path for auth routes
   * Forwarded to better-auth's basePath option so it can match incoming
   * request URLs without manual path rewriting.
   * @default '/api/v1/auth'
   */
  basePath?: string;

  /**
   * OIDC / Generic OAuth2 providers for enterprise SSO.
   * Each entry is passed to better-auth's genericOAuth plugin.
   */
  oidcProviders?: OidcProvidersConfig;

  /**
   * `additionalOrgRoles` was REMOVED in ADR-0108 (#3723). The organization-role
   * vocabulary is closed: `owner` / `admin` / `delegated_admin` / `member`.
   *
   * It registered app-declared `position` / `permission` names with
   * better-auth so invitations could name them. Because every value stored in
   * `sys_member.role` is projected into `current_user.positions`, that made the
   * membership role a capability channel with none of ADR-0090 D12's controls.
   *
   * FROM → TO:
   *   `new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })`
   *   → declare `sales_rep` as a `position`, then either assign it
   *     (`sys_user_position`, governed by `DelegatedAdminGate`) or invite with
   *     placement: `POST /organization/invite-member`
   *     `{ role: 'member', businessUnitId, positions: ['sales_rep'] }`
   *     (ADR-0105 D8 — authorized against the issuer's `adminScope`).
   */

  /**
   * Optional outbound email service used by better-auth callbacks
   * (`sendResetPassword`, `sendVerificationEmail`, `sendInvitationEmail`,
   * `sendMagicLink`). When omitted, those callbacks degrade to logging
   * the action URL — keeping flows usable in pilots / local dev — but
   * production deployments SHOULD wire one via `setEmailService()`.
   *
   * Resolved lazily through {@link AuthManager.getEmailService}; safe
   * to set after construction. AuthPlugin wires this from the kernel
   * service registry on `kernel:ready`.
   */
  emailService?: IEmailService;

  /**
   * Optional outbound SMS service used by the phoneNumber plugin's OTP
   * callbacks (`sendOTP`, `sendPasswordResetOTP`) and the import SMS-invite
   * path (#2780). When omitted, `/phone-number/send-otp` fails loudly with
   * 400 `SMS_SERVICE_REQUIRED` instead of silently logging.
   *
   * Resolved lazily through {@link AuthManager.getSmsService}; safe to set
   * after construction. AuthPlugin wires this from the kernel service
   * registry (`sms`, see `@objectstack/service-sms`) on `kernel:ready`.
   */
  smsService?: ISmsService;

  /**
   * #2780 — knobs for the phone-number OTP surface. All optional; the
   * defaults are deliberately conservative because every OTP send costs
   * real money (SMS pumping abuse — see otp-send-guard.ts).
   */
  phoneOtp?: {
    /**
     * Per-number cooldown between sends, seconds. Default 60. `0` disables.
     * Enforced at the declared length up to 24 hours (`MAX_COOLDOWN_SECONDS`);
     * a longer value is REJECTED at construction, never truncated (#4808).
     */
    cooldownSeconds?: number;
    /** Per-number rolling-hour send cap. Default 5. `0` disables. */
    maxPerHour?: number;
    /** Wrong-code attempts before the OTP is invalidated (better-auth `allowedAttempts`). Default 3. */
    allowedAttempts?: number;
    /** OTP validity window, seconds (better-auth `expiresIn`). Default 300. */
    expiresIn?: number;
    /** OTP length (better-auth `otpLength`). Default 6. */
    otpLength?: number;
  };

  /**
   * The deployment's product name: the `{{appName}}` placeholder of the
   * built-in auth email templates, and the issuer and label prefix of the
   * otpauth URI a TOTP enrollment hands to the user's authenticator app.
   * Defaults to `'ObjectStack'` when omitted.
   */
  appName?: string;

  /**
   * ADR-0093 D9 — default active-org on session create. When enabled
   * (default), a `session.create.before` hook stamps `activeOrganizationId`
   * from the caller's `sys_member` row (owner-preferred) whenever the draft
   * lacks one. A host-supplied `session.create.before` (see
   * {@link databaseHooks}) chains FIRST and keeps precedence. Set `false`
   * to restore the raw better-auth behaviour (sessions start org-less).
   * @default true
   */
  autoActiveOrganization?: boolean;

  /**
   * Pass-through to better-auth's `databaseHooks` option. better-auth fires
   * these around its own adapter writes, including paths that never reach an
   * HTTP route of ours (e.g. `genericOAuth` JIT-creating a user during SSO
   * login).
   *
   * **Use this seam — not an ObjectQL middleware on `sys_user` — to react to
   * user creation.** The reason is ADR-0093 D2: an invariant over the user
   * lifecycle gets exactly ONE owner, composed into `user.create.after`
   * (`reconcile-membership.ts`), because that is the single seam every
   * creation path already flows through (self-signup, admin create-user,
   * import, SSO JIT). Re-deriving the invariant per creation path — or in a
   * parallel data-layer middleware — is precisely the shape D2 eliminated.
   * The platform's own use is a `user.create.after` hook that provisions a
   * personal/default organization so SSO-arriving users don't land on the
   * empty "create organization" screen.
   *
   * **Corrected mechanism (#4802).** This comment used to justify the rule by
   * asserting that better-auth's adapter "goes through `dataEngine` directly,
   * bypassing the `ql.registerMiddleware` chain". That is **not** true, and
   * the claim was copied widely enough (framework + cloud) to keep producing
   * wrong architectural conclusions, so it is refuted here rather than quietly
   * deleted. Verified hop by hop:
   *
   * - `objectql/src/plugin.ts` registers ONE instance under both names —
   *   `registerService('objectql', this.ql)` and `registerService('data',
   *   this.ql)`; nothing else in the repo registers `data`.
   * - `auth-plugin.ts` takes `ctx.getService<IDataEngine>('data')` and hands
   *   that same instance to {@link createObjectQLAdapterFactory}.
   * - `objectql-adapter.ts` writes with plain `dataEngine.insert(objectName,
   *   …)` — there is no bypass/skip-middleware option to pass.
   * - `ObjectQL.insert()` (`objectql/src/engine.ts`) wraps its body in
   *   `executeWithMiddleware()`, whose only filter is the object name.
   *
   * So `ql.registerMiddleware(fn, { object: 'sys_user' })` **does** fire for
   * better-auth's writes, and so do the engine's `beforeInsert`/`afterInsert`
   * lifecycle hooks (the SCIM identity-source stamp in `auth-plugin.ts` relies
   * on exactly that). What remains true is narrower and worth knowing: adapter
   * writes carry `context.isSystem: true` (`withSystemContext`, pinned by
   * `objectql-adapter.test.ts`), and every authorization middleware —
   * security, sharing, the ADR-0092 identity write guard — early-returns on
   * `isSystem` by design. A middleware that gates on `isSystem` therefore sees
   * nothing; one that does not, runs.
   */
  databaseHooks?: BetterAuthOptions['databaseHooks'];

  /**
   * ADR-0093 D1/D2 — deployment membership policy for the reconciler composed
   * into `user.create.after`. `'auto'` (default) binds every new member-less
   * user to the single-org default org; `'invite-only'` never auto-binds
   * (membership comes only from invite / add-member / SSO JIT / host hooks).
   * @default 'auto'
   */
  membershipPolicy?: MembershipPolicy;

  /**
   * ADR-0093 D3/D4 — accessor for the `tenancy` service, consulted by the
   * membership reconciler to resolve the target org (single → default org;
   * multi → none). A lazy accessor because the service is registered on the
   * kernel after the AuthManager is constructed; the reconciler calls it at
   * hook-fire time (well after boot). Omitted → the reconciler no-ops
   * (no target org), preserving pre-ADR-0093 behavior.
   */
  getTenancy?: () => TenancyService | undefined;

  /**
   * [#8144] Accessor for the `audit` service — the compliance ledger's ingress
   * for events that are not CRUD. Consulted by the session lifecycle hooks to
   * record `login` / `logout` in `sys_audit_log`.
   *
   * Lazy for the same reason `getTenancy` is: the service is registered on the
   * kernel after the AuthManager is constructed, and every call happens at
   * request time. Omitted, or resolving to `undefined` (the audit plugin is not
   * installed — it is an OPTIONAL pair in the CLI) → no auth rows are written,
   * which is exactly today's behaviour.
   */
  getAuditSink?: () => AuthEventAuditSurface | undefined;

  /**
   * Accessor for the runtime's `i18n` service, read by the organization
   * invitation mail to name the invitee's membership role by its option LABEL
   * in the mail's locale (`成员`, not `member`) — the label the console shows
   * for the same option, read through the same service, so a tenant's authored
   * translation reaches the mail too.
   *
   * Lazy for the same reason `getTenancy` is: the service is registered on the
   * kernel after the AuthManager is constructed, and every call happens at
   * send time. Omitted, or resolving to `undefined` (no i18n service) → the mail
   * names the option's authored label (`Member`), never the stored value.
   */
  getI18n?: () => II18nService | undefined;

  /**
   * Optional structured logger (the kernel `ctx.logger`) for best-effort
   * bookkeeping surfaces such as the ADR-0093 membership reconciler. Omitted →
   * those surfaces run silently (they already fail closed to no-op).
   *
   * The whole field stays OPTIONAL — omitting it is still a supported posture.
   * What is no longer representable is supplying a logger that cannot carry a
   * durability report: `warn` is non-optional because this value is FORWARDED
   * verbatim into `ReconcileMembershipDeps.logger` (reconcile-membership.ts),
   * whose sink guarantees that channel under #9754. Measured before tightening:
   * the only non-test construction site in this repo is `auth-plugin.ts`, which
   * passes `ctx.logger` — the kernel `Logger`, whose `warn` is already
   * required — so the in-tree cost is zero. An external embedder handing
   * `AuthManager` a reduced `{ info }` sink is the one caller this asks to
   * change, and that is the point: it was the caller silently discarding the
   * reconciler's reports (#10556).
   */
  logger?: { info?: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };

  /**
   * ADR-0069 D2 — account lockout (anti-brute-force). After this many
   * consecutive failed sign-ins the account is locked for
   * {@link lockoutDurationMinutes}. `0` (default) disables lockout.
   * Enforced per-identity in the `/sign-in/email` before/after hooks
   * (survives IP rotation, unlike the per-IP {@link rateLimit}).
   */
  lockoutThreshold?: number;

  /** Minutes an account stays locked once the threshold is crossed. Default 15. */
  lockoutDurationMinutes?: number;

  /**
   * ADR-0069 D1 — password complexity. When `passwordRequireComplexity` is on,
   * a new password must contain at least `passwordMinClasses` (1-4) of the
   * character classes upper / lower / digit / symbol. Enforced by a validator
   * in the `/sign-up/email`, `/reset-password`, `/change-password` before hook
   * (better-auth only enforces min/max length natively).
   */
  passwordRequireComplexity?: boolean;

  /** Minimum distinct character classes required (1-4). Default 3. */
  passwordMinClasses?: number;

  /**
   * ADR-0069 D1 — password history depth. When > 0, a password change/reset is
   * rejected if the new password matches the current or any of the last
   * `passwordHistoryCount` hashes (`sys_account.previous_password_hashes`).
   * Reuses better-auth's native hash/verify — no bespoke crypto.
   */
  passwordHistoryCount?: number;

  /**
   * ADR-0069 D1 — password expiry (days). When > 0, an authenticated user whose
   * `sys_user.password_changed_at` is older than this is gated out of protected
   * resources (`PASSWORD_EXPIRED`) until they change their password. Computed in
   * `customSession` (→ `user.authGate`) and enforced at the transport seam. 0 =
   * off. A null `password_changed_at` never expires (existing users on upgrade).
   */
  passwordExpiryDays?: number;

  /**
   * ADR-0069 D3 — enforced MFA. When true, an authenticated user without TOTP
   * enrolled (`sys_user.two_factor_enabled`) is gated out of protected resources
   * (`MFA_REQUIRED`) once their grace window elapses, until they enroll. Shares
   * the `customSession` → `user.authGate` seam with password expiry.
   */
  mfaRequired?: boolean;

  /** Days a user may defer MFA enrollment before the hard block. Default 7. */
  mfaGracePeriodDays?: number;

  /**
   * [#23367, ruling A] The API-key lifecycle policy (`resolveApiKeyLifecyclePolicy`):
   * the life of a key signed with no `expires_at` (default 90 days), the
   * ceiling on a signed key's life (default 365), and the inactivity window
   * after which an unused key is refused (default 90; 0 = off). Bound from the
   * `auth` settings keys `api_key_*` by `bindAuthSettings`.
   */
  apiKeyDefaultExpiryDays?: number;
  apiKeyMaxExpiryDays?: number;
  apiKeyInactivityDays?: number;

  /**
   * [#23367] When this deployment started enforcing the API-key lifecycle
   * policy (ISO 8601) — the anchor of the inactivity clock for keys with no
   * recorded use, and of the one-year grace for keys signed with no expiry.
   * Recorded ONCE, in the `auth` setting `api_key_policy_started_at`, by
   * `bindAuthSettings` on the first boot that runs the policy, so it survives
   * restarts and every node reads the same instant. ⛔ Never the process start.
   */
  apiKeyPolicyStartedAt?: string;

  /**
   * ADR-0069 D4 — session controls. Enforced in `customSession` (idle/absolute)
   * and the sign-in hook (concurrent). 0 = off for each. A revoked session is
   * expired in place (`sys_session.expires_at` past + `revoked_at`/`revoke_reason`)
   * so better-auth returns no session on the next request (→ 401 → re-login).
   */
  sessionIdleTimeoutMinutes?: number;
  sessionAbsoluteMaxHours?: number;
  maxConcurrentSessions?: number;

  /**
   * ADR-0069 D5 — network gating. When non-empty, auth requests (sign-in,
   * session) are judged at the auth-route middleware against these CIDR / exact
   * ranges, and refused with `403 IP_NOT_ALLOWED` unless the client address is
   * inside one.
   *
   * The address judged is the one the server ESTABLISHED, by the platform's
   * client-address trust rule ({@link resolveClientAddress}, shared with the
   * runtime's inbound rate limiter): forwarded headers only when
   * {@link trustProxy} is declared, the transport's peer address otherwise.
   * Behind a reverse proxy, declare `server.trustProxy`, or the allow-list
   * judges the proxy's own address.
   *
   * A request whose address cannot be established (no peer address, no trusted
   * forwarded header) is REFUSED with the same `403 IP_NOT_ALLOWED`, and the
   * first such refusal logs a warning naming this setting and `server.trustProxy`.
   * Unset or empty: no restriction, and nothing is judged.
   */
  allowedIpRanges?: string[];

  /**
   * The deployment's `server.trustProxy`: believe `X-Forwarded-For` /
   * `X-Real-IP` when establishing a request's client address for the ADR-0069
   * D5 allow-list ({@link allowedIpRanges}) and the D7 login audit
   * (`last_login_ip`) — and for what the vendored auth library records and
   * keys on by client address (session `ip_address`, the sign-in audit
   * fingerprint, its own per-address {@link rateLimit}), which is handed that
   * same address (`client-address-vendor.ts`). The same authored value the
   * runtime's inbound rate limiter reads; `objectstack serve` passes it to
   * both. A host that composes `AuthPlugin` itself passes the value it gives
   * the dispatcher.
   * @default false
   */
  trustProxy?: boolean;

  /**
   * ADR-0069 D2 — better-auth-native per-IP rate limiting, passed through to
   * better-auth's core `rateLimit`. The settings bind tightens `customRules`
   * for the auth endpoints (`/sign-in/email`, `/sign-up/email`,
   * `/reset-password`). Multi-node deployments need a shared `storage`.
   */
  rateLimit?: BetterAuthOptions['rateLimit'];

  /**
   * ADR-0069 D2 — shared KV store for cross-node state. When set, better-auth
   * uses it for **rate-limit counters** (the manager also flips
   * `rateLimit.storage` to `'secondary-storage'`) and session caching, so both
   * are enforced against ONE store across every node — closing the multi-node
   * rate-limit-bypass hole (each node otherwise counts independently).
   *
   * HOST-SUPPLIED ONLY (#4772). `AuthPlugin` no longer derives this from the
   * kernel `cache` service: better-auth also makes `secondaryStorage` the
   * session store (`createSession` skips the `sys_session` row, `findSession`
   * answers from the snapshot without reading the database), which silently
   * disables the ADR-0069 D4 session controls that revoke by writing that row.
   * The counters ride {@link rateLimitStorage} instead. Absent → better-auth
   * keeps its own session + rate-limit defaults.
   */
  secondaryStorage?: BetterAuthOptions['secondaryStorage'];

  /**
   * ADR-0069 D2 (#4772) — better-auth `rateLimit.customStorage`: the store the
   * per-IP counters are consumed from, and NOTHING else (no session
   * relocation, unlike {@link secondaryStorage}). `AuthPlugin` supplies a
   * lazily-cache-resolving implementation (`rate-limit-storage.ts`) so the
   * counters reach the kernel `cache` service regardless of plugin start
   * order. Ignored when `secondaryStorage` is set — better-auth's own
   * `storage: 'secondary-storage'` already routes counters there.
   *
   * Kept as its own option rather than inside {@link rateLimit} so a settings
   * patch that replaces `rateLimit` wholesale (`bindAuthSettings`) can never
   * drop the store.
   */
  rateLimitStorage?: NonNullable<BetterAuthOptions['rateLimit']>['customStorage'];

  /**
   * ADR-0069 D2 (#4790) — the store ObjectStack's OWN cross-node counters
   * count in, resolved LAZILY (called per count, not at construction). Today
   * that is the #2780 per-number OTP send budget; {@link rateLimitStorage}
   * covers better-auth's own per-IP counters, which never pass through here.
   *
   * `AuthPlugin` supplies `createLazyCounterStore(...)` over the kernel `cache`
   * service (`rate-limit-storage.ts`) — the same resolution the rate-limit
   * counters use, so plugin start order decides nothing and a deployment
   * WITHOUT a cache still counts, per process, and is told so. Absent → the
   * budget is per-process silently, which is the pre-#4790 behaviour and is
   * why this option exists.
   *
   * NOT `secondaryStorage`: handing better-auth one of those also relocates the
   * session of record into the cache and silently disables the ADR-0069 D4
   * session controls (#4785). A host that supplies `secondaryStorage`
   * deliberately still wins for this budget — see `getOtpSendGuard`.
   */
  sharedCounterStore?: () => Promise<CounterStore>;
}

/**
 * Authentication Manager
 *
 * Wraps better-auth and provides authentication services for ObjectStack.
 * Supports multiple authentication methods:
 * - Email/password
 * - OAuth providers (Google, GitHub, etc.)
 * - Magic links
 * - Two-factor authentication
 * - Passkeys
 * - Organization/teams
 */
/** ADR-0069 D5 — parse a dotted-quad IPv4 to a uint32, or null when not IPv4. */
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const p = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (p.some((n) => n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

/**
 * `::ffff:203.0.113.7` → `203.0.113.7`; anything else is returned trimmed.
 *
 * A dual-stack listener reports an IPv4 peer in this IPv4-mapped IPv6 form, and
 * the ADR-0069 D5 allow-list judges the transport's peer address when no proxy
 * is trusted. So both sides of a comparison are read as the IPv4 address they
 * denote, or an IPv4 range could never admit an IPv4 client on such a socket.
 */
function unmapIpv4(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

/**
 * ADR-0069 D5 — does `ip` match `range` (IPv4 CIDR `a.b.c.d/n`, or exact IP)?
 * An IPv4-mapped IPv6 address on either side compares as its IPv4 address.
 */
export function ipMatchesRange(ip: string, range: string): boolean {
  const r = unmapIpv4(range || '');
  if (!r) return false;
  const address = unmapIpv4(ip);
  if (r.includes('/')) {
    const [rawBase, bitsStr] = r.split('/');
    const base = unmapIpv4(rawBase);
    const bits = Number(bitsStr);
    const ipInt = ipv4ToInt(address);
    const baseInt = ipv4ToInt(base);
    if (ipInt === null || baseInt === null || !(bits >= 0 && bits <= 32)) {
      return address === base; // non-IPv4-CIDR → exact-match fallback
    }
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
  }
  return address === r;
}

/**
 * [#14522] The better-auth endpoint path prefix every SCIM 2.0 protocol
 * endpoint lives under (`/scim/v2/Users`, `/scim/v2/Groups/:groupId`, …) —
 * the same predicate `@better-auth/scim` uses for its own after-hook matcher
 * (`context.path?.startsWith("/scim/v2")`). A request under it runs inside
 * `scimRequestScope`; see `handleRequest`.
 */
const SCIM_PROTOCOL_PATH_PREFIX = '/scim/v2';

export function isScimProtocolPath(endpointPath: string | undefined): boolean {
  return (
    endpointPath === SCIM_PROTOCOL_PATH_PREFIX ||
    endpointPath?.startsWith(`${SCIM_PROTOCOL_PATH_PREFIX}/`) === true
  );
}

/**
 * #8195 — the locales the built-in auth email templates actually ship a row for.
 *
 * Spelled out rather than imported: `plugin-auth` does not depend on
 * `@objectstack/plugin-email` (it reaches the mail service through the service
 * registry), and these are also the four options the `localization.locale`
 * setting offers, so the two ends agree by construction rather than by import.
 */
const AUTH_EMAIL_TEMPLATE_LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'es-ES'] as const;

/**
 * #8195 — map a deployment-default locale onto the locale an auth email row is
 * actually keyed by.
 *
 * ⚠️ This exists because the two ends genuinely disagree, and the disagreement
 * is measured, not theoretical:
 *
 *  - `II18nService.getDefaultLocale()` — the ruled source — carries the message
 *    **catalog** language, whose English spelling is the bare `en`
 *    (`FileI18nAdapter`: `options.defaultLocale ?? 'en'`).
 *  - `sys_email_template` rows are keyed by the regional tag `en-US`, and
 *    `SendTemplateInput.locale` is documented as matched **exactly**, with "no
 *    language-only prefix matching" stated in the contract.
 *
 * So handing `en` straight through would miss every row and lean on the
 * ladder's en-US fallback for the single most common deployment — landing an
 * `en-US` body while the render filters were told `en`, which is the row-locale
 * vs. filter-locale split (#7801) reopened one notch narrower.
 *
 * The mapping is therefore deliberately narrow:
 *
 *  1. a tag we ship a row for is returned canonically (case-insensitively);
 *  2. a **bare language subtag** is promoted to the regional row we ship for it
 *     (`en` ⇒ `en-US`, `zh` ⇒ `zh-CN`, …);
 *  3. anything else is passed through **unchanged** — `en-GB` or `fr-FR` may
 *     well be a tenant's own overlay row, and swallowing it here would
 *     re-create exactly the bug this card closes for the fifth locale onward.
 */
export function normalizeAuthEmailLocale(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const lower = value.toLowerCase();
  const exact = AUTH_EMAIL_TEMPLATE_LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  // Bare language subtag only — a regional tag we do not ship is a real
  // request for that region, not a misspelling of one we do.
  if (!/^[a-z]{2,3}$/.test(lower)) return value;
  const byLanguage = AUTH_EMAIL_TEMPLATE_LOCALES.find(
    (l) => l.slice(0, l.indexOf('-')).toLowerCase() === lower,
  );
  return byLanguage ?? value;
}

/**
 * #14319 — the auth email locale the REQUEST asked for, or `undefined`.
 *
 * Maintainer ruling 2026-09-02 (in session). Quoted verbatim and untranslated,
 * as rulings are:
 *
 * > 注册 / 登录 / 重置密码等由请求触发的 auth 邮件，语言优先取请求的
 * > `Accept-Language`（命中 `AUTH_EMAIL_TEMPLATE_LOCALES` 才生效），其次才是
 * > 部署默认（`localization.locale` → `i18n.defaultLocale`）。
 *
 * The motivating case is the one no deployment default can answer: at cloud
 * self-service signup there is no workspace yet, so nothing on the server
 * represents this person's language — only the request does.
 *
 * The header is parsed by the platform's ONE parser,
 * {@link preferredLocaleFromHeader}, which REST already uses for metadata
 * translation and the runtime dispatcher for `ExecutionContext.requestLocale`.
 * A second parser here would let the mail a user receives disagree with the
 * screen that triggered it — the very class of defect this card is about.
 *
 * A hit is REQUIRED, not merely preferred: only a locale this platform ships an
 * auth row for takes effect, so `fr-FR` falls through to the deployment default
 * instead of naming a row that does not exist. That is deliberately narrower
 * than {@link normalizeAuthEmailLocale}, which passes an unshipped regional tag
 * through because a tenant may overlay `en-GB` rows and the deployment default
 * may legitimately ask for them. The asymmetry is the ruling's own: a
 * per-request header is a weaker claim than a deployment's declaration.
 *
 * ⚠️ The source is read defensively because better-auth is NOT consistent about
 * what it hands these callbacks — measured against the installed 1.7.x, not
 * assumed: `sendResetPassword`, `sendVerificationEmail` and
 * `sendInvitationEmail` are called with `ctx.request` (a Web `Request`), while
 * `sendMagicLink` is called with the endpoint `ctx` itself, and the
 * change-email notice fires from the global `after` hook, which also holds a
 * `ctx`. One reader covering all three shapes beats three call sites each
 * guessing at one.
 */
export function authEmailLocaleFromRequest(source: unknown): string | undefined {
  const header = acceptLanguageHeader(source);
  if (!header) return undefined;
  const preferred = preferredLocaleFromHeader(header);
  if (!preferred) return undefined;
  const normalized = normalizeAuthEmailLocale(preferred);
  const shipped: readonly string[] = AUTH_EMAIL_TEMPLATE_LOCALES;
  return normalized && shipped.includes(normalized) ? normalized : undefined;
}

/**
 * The `accept-language` value off a Web `Request`, a better-auth endpoint
 * context, or anything carrying either. Never throws: a vendor changing the
 * shape it hands a callback must degrade to the deployment default, never fail
 * the send.
 */
function acceptLanguageHeader(source: unknown): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const nested = (source as { request?: unknown }).request;
  const bags = [
    (source as { headers?: unknown }).headers,
    nested && typeof nested === 'object' ? (nested as { headers?: unknown }).headers : undefined,
  ];
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object') continue;
    try {
      const getter = (bag as { get?: unknown }).get;
      if (typeof getter === 'function') {
        const value = (bag as Headers).get('accept-language');
        if (typeof value === 'string' && value) return value;
        continue;
      }
      const record = bag as Record<string, unknown>;
      const value = record['accept-language'] ?? record['Accept-Language'];
      if (typeof value === 'string' && value) return value;
    } catch {
      // A header bag that throws on read is not a reason to fail the send.
    }
  }
  return undefined;
}

/** [#24243] The standard ADR-0112 code the slug guard's read fault answers with — the status's own name. */
const SLUG_GUARD_READ_FAULT_CODE: StandardErrorCode = 'SERVICE_UNAVAILABLE';

/**
 * [#21941] The organization slug guard's answer when one of its own reads
 * cannot answer: `503 SERVICE_UNAVAILABLE`, the existing ADR-0112 code for a
 * store that is temporarily down.
 *
 * Not the guard's `403 FORBIDDEN`: a read that could not answer is not a
 * verdict about the slug change, so it must not wear the refusal's words — and
 * never "allowed", which is what swallowing the fault used to answer. The
 * driver's own failure rides `cause`, so its diagnostic is not lost.
 */
async function slugGuardReadFaultApiError(object: string, cause: unknown): Promise<Error> {
  const { APIError } = await import('better-auth/api');
  const err = new APIError('SERVICE_UNAVAILABLE', {
    message:
      `The organization slug guard could not read \`${object}\`, so whether this organization has an ` +
      `active environment was never determined, and the slug was not changed. ` +
      `This is a server-side outage, not a refusal of the new slug: retry once the data store is reachable.`,
    code: SLUG_GUARD_READ_FAULT_CODE,
  });
  (err as { cause?: unknown }).cause = cause;
  return err;
}

// [#24243, ADR-0112] The organization plugin's hook refusals, one code each, so
// a client (the console's organization and Invite User dialogs among them)
// branches on the code and never on the prose. A registered code is typed
// `RegisteredErrorCode` and a standard one `StandardErrorCode`, so a removed or
// misspelled ledger row fails `tsc` here instead of shipping a code
// `ApiErrorSchema` rejects.

/** `beforeCreateOrganization`: the reserved `__global__` id or slug (ADR-0120 D3), a value the request may not carry. */
const ORGANIZATION_RESERVED_IDENTIFIER_CODE: StandardErrorCode = 'VALIDATION_ERROR';
/** `beforeCreateOrganization`: the effective tenancy posture enforces no organization wall, so no caller may create one. */
const ORGANIZATION_CREATION_DISABLED_CODE: RegisteredErrorCode = 'ORGANIZATION_CREATION_DISABLED';
/** `beforeCreateInvitation`: placement intent, and no delegated-administration runtime to authorize it. */
const INVITE_PLACEMENT_UNSUPPORTED_CODE: RegisteredErrorCode = 'INVITE_PLACEMENT_UNSUPPORTED';
/** `beforeCreateInvitation`: the delegated-administration gate's own verdict that the placement is outside the issuer's scope. */
const INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE_CODE: RegisteredErrorCode = 'INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE';
/** `beforeCreateInvitation`: the placement check failed before the gate reached a verdict — the status's own name. */
const INVITE_PLACEMENT_READ_FAULT_CODE: StandardErrorCode = 'SERVICE_UNAVAILABLE';
/** `beforeUpdateOrganization`: a change to a new slug while the organization has an active environment. */
const ORGANIZATION_SLUG_LOCKED_CODE: RegisteredErrorCode = 'ORGANIZATION_SLUG_LOCKED_BY_ACTIVE_ENVIRONMENTS';

/**
 * [#24243] Is this throw out of `assertIssuable` the delegated-administration
 * gate's own refusal? The service's contract is that the gate refuses with its
 * `PermissionDeniedError` (`invitation-placement.ts`), whose ADR-0112 code is
 * `PERMISSION_DENIED`. Read by that code, structurally, because plugin-auth has
 * no runtime dependency on plugin-security (see
 * {@link InvitationPlacementServiceLike}).
 */
function isInvitationPlacementGateRefusal(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'PERMISSION_DENIED';
}

/**
 * [#24243] The invitation placement check's answer when it failed BEFORE the
 * gate reached a verdict: `503 SERVICE_UNAVAILABLE`, as the role cap's read
 * fault answers ({@link invitationRoleCapReadFaultApiError}). `assertIssuable`
 * resolves the issuer's grants from the store before it runs the gate, and a
 * store that cannot answer throws there (`AuthzStoreUnavailableError`).
 *
 * Not `403 INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE`: that code is the gate's own
 * verdict, and a check that failed reached none, so it must not wear the
 * refusal's code. Still fail-closed: the throw ends the endpoint, so no
 * invitation row is written. The thrown failure rides `cause`, and its message
 * is not relayed, so a driver's text does not reach the caller.
 */
async function invitationPlacementReadFaultApiError(cause: unknown): Promise<Error> {
  const { APIError } = await import('better-auth/api');
  const err = new APIError('SERVICE_UNAVAILABLE', {
    message:
      'The invitation placement check failed before it reached a verdict, so whether the issuer may ' +
      'place this invitation was never determined, and no invitation was created. This is a ' +
      'server-side outage, not a refusal of the placement: retry once the data store is reachable.',
    code: INVITE_PLACEMENT_READ_FAULT_CODE,
  });
  (err as { cause?: unknown }).cause = cause;
  return err;
}

/**
 * [#24166, ruling 6232069920 A] The access-token claim that carries the
 * organization an OAuth consent bound. Minted by `customAccessTokenClaims` on
 * the embedded authorization server and read back by
 * {@link AuthManager.verifyMcpAccessToken} — one spelling for both ends.
 */
export const OAUTH_ORGANIZATION_CLAIM = 'organization_id';

/**
 * [#24166] The organization an OAuth consent binds: the consenting session's
 * active organization, or `undefined` when it has none.
 *
 * Reads the session the installed provider hands `postLogin.consentReferenceId`
 * — the session of record, by better-auth's field name — and nothing else, so
 * neither the authorize request nor the client can choose the value. An empty
 * or non-string value is no organization: the consent then binds none and the
 * token carries no claim, which is the ruled outcome for a user with no
 * organization, never a guessed or default one.
 */
function consentOrganizationOf(session: Record<string, unknown> | null | undefined): string | undefined {
  const organizationId = session?.activeOrganizationId;
  return typeof organizationId === 'string' && organizationId ? organizationId : undefined;
}

export class AuthManager {
  private auth: Auth<any> | null = null;
  /**
   * [#17176] The build currently in flight, so `getOrCreateAuth()` is
   * single-flight.
   *
   * `this.auth` alone cannot serialise the build: it is assigned only AFTER
   * `createAuthInstance()` resolves, and that function awaits a dynamic
   * `import('better-auth')`, `buildPluginList()`, `resolvePasswordHasher()`
   * and finally better-auth's own `$context`. Every caller that arrives inside
   * that window still reads `this.auth === null` and starts its own build, so
   * N overlapping callers construct N better-auth instances — measured, three
   * concurrent `getAuthInstance()` calls returned three distinct instances.
   *
   * The boot has such callers: `auth-plugin.ts` fires
   * `registerOidcDiscoveryRoutes()` with `void` from its route-mounting
   * `kernel:ready` hook (that hook returns while the call is still pending)
   * and a later `kernel:ready` hook reads the instantiated social providers
   * off the instance for the account-issuer backfill.
   *
   * Duplicate instances are not merely wasteful. Each one runs every
   * better-auth plugin's `init`, and `@better-auth/oauth-provider` seeds the
   * RFC 8707 `sys_oauth_resource` row from there. Its seed is already
   * check-then-insert (`findOne` by `identifier`, then `create` only on a
   * miss) with the UNIQUE refusal caught as its documented
   * concurrent-process fallback — so on a warm database every instance finds
   * the row and inserts nothing, but on a FRESH one all N miss together and
   * all N insert, and the unique index refuses N - 1 of them. That refusal is
   * the `Insert operation failed {object: sys_oauth_resource}` line on the
   * first boot of a fresh project.
   *
   * ⛔ The cure is not a quieter log and not an upsert: it is not doing the
   * work twice. Holding the in-flight promise makes the seed run once per
   * process on every driver, because there is only ever one plugin `init` to
   * run it.
   */
  private authBuild: Promise<Auth<any>> | null = null;
  private config: AuthManagerOptions;
  /**
   * [#20389] Whether the DEPLOYMENT declared email verification off — the
   * constructor config, or a later `applyConfigPatch()` whose
   * `requireEmailVerification` came from the deployment (host code, or an
   * `OS_AUTH_REQUIRE_EMAIL_VERIFICATION` env override) rather than from a value
   * stored in the settings console. Under posture `open` an explicit `false`
   * is honoured only while this is true: the console can agree with the
   * deployment's opt-out, never make one (`assertAudienceConfig`).
   */
  private deploymentDeclaredVerificationOff: boolean;
  /**
   * [#3653] The auth secret, resolved ONCE per manager. `generateSecret()`'s
   * dev fallback is `'dev-secret-' + Date.now()` — a fresh value per call — so
   * every consumer that needs the same key material (better-auth's own
   * `secret` and the SCIM credential digests, which are keyed HMACs over it)
   * must read this memo rather than re-resolving.
   */
  private resolvedAuthSecret?: string;
  /**
   * [#8289] The org-role ac map handed to the `organization` plugin as `roles`
   * (`undefined` → the plugin runs on better-auth's `defaultRoles`). Stashed at
   * plugin-build time because `assertRemoveMemberPermitted` has to ask the
   * vendor's own `hasPermission` the same question the route will, and the
   * global before-hook runs BEFORE the org plugin shims `ctx.context.orgOptions`
   * into scope — so the map is not reachable from `ctx` at that point.
   */
  private orgRolesMap: Record<string, any> | undefined;
  /**
   * [#24948] The last-administrator guard's question about an organization
   * delete (`LastAdminGuardHandle.judgeOrganizationDelete`), handed over by
   * `AuthPlugin` once the guard is registered. Absent on a composition without
   * the guard, where the Default Organization has no such protection to move.
   */
  private organizationDeleteStandingJudge?: (organizationId: string) => Promise<void>;

  /** [#24948] See {@link organizationDeleteStandingJudge}. */
  setOrganizationDeleteStandingJudge(judge: (organizationId: string) => Promise<void>): void {
    this.organizationDeleteStandingJudge = judge;
  }
  // ADR-0069 — cached "does any org require MFA" flag (per-org tightening).
  // Refreshed lazily with a TTL so isAuthGateActive() stays synchronous + cheap.
  private _orgMfaCache: { value: boolean; at: number } = { value: false, at: 0 };
  private _orgMfaRefreshing = false;
  // #2766 V1 — cached "does any user have must_change_password set" flag, so
  // the admin-issued temp-password gate activates without making
  // isAuthGateActive() (and thus every request's extra session read) hot in
  // deployments that never use the feature. Same lazy-TTL pattern as
  // _orgMfaCache; primed synchronously by noteMustChangePasswordIssued() on
  // the node that issues a flag (other nodes catch up within the TTL).
  private _mustChangeCache: { value: boolean; at: number } = { value: false, at: 0 };
  private _mustChangeRefreshing = false;
  // Optional auth features whose better-auth plugin failed to initialize and
  // was skipped so core auth stays up (feature key → error message). Rebuilt
  // by every buildPluginList() run; see addOptionalPlugin().
  private degradedFeatures = new Map<string, string>();

  // #3585 — "can this host do Ed25519?", asked of WebCrypto once per manager.
  // Memoized because the answer is a fixed property of the runtime, not of a
  // registry that is still filling: nothing can register Ed25519 support later
  // in the boot, so caching the verdict cannot go stale (contrast the
  // startup-registry-verdict rule in AGENTS.md, which is about the opposite
  // case).
  private ed25519ProbeResult?: Promise<boolean>;
  // Emitted at most once per instance build: a host that cannot sign says so on
  // the first /get-session failure, not on every request.
  private jwtSigningFailureReported = false;

  /**
   * Result of the dev-only admin seed (set by `AuthPlugin.maybeSeedDevAdmin`
   * when it provisions the well-known admin, or re-armed on a later boot while
   * that account still carries the default password). The `serve` command
   * reads this after boot to surface the credentials in the startup banner.
   * Undefined when no seed ran (production, opt-out, or [#14157] a database
   * that already carries a login).
   */
  public devSeedResult?: { email: string; password: string };

  constructor(config: AuthManagerOptions) {
    this.config = config;

    // #4808 — reject an unenforceable OTP cooldown HERE, at boot
    // (`AuthPlugin.init()` constructs this manager), rather than at the first
    // send: the guard itself is built lazily, so without this the operator
    // would learn about a bad throttle from a 500 on `/phone-number/send-otp`.
    // Values within the bound are enforced at their declared length — the
    // history retention follows the cooldown; see otp-send-guard.ts.
    assertOtpCooldownSeconds(config.phoneOtp?.cooldownSeconds);

    // [#11739] Audience posture — ENTRY validation, at boot, for the same
    // reason as the OTP guard above: an unusable audience declaration must
    // refuse the boot loudly, not surface as a 403 on the first sign-up.
    // Off-vocabulary postures, inert declarations (ADR-0078) and the
    // email_domain-with-verification-off contradiction are all refused here;
    // `applyConfigPatch` runs the same assertion on the merged result so no
    // entry path can smuggle an invalid declaration past boot. [#20389] The
    // constructor config IS the deployment's declaration, so under `open` its
    // explicit `requireEmailVerification: false` is honoured.
    this.deploymentDeclaredVerificationOff = config.emailAndPassword?.requireEmailVerification === false;
    assertAudienceConfig(config.audience, config.emailAndPassword, { verificationDeclaredBy: 'deployment' });

    // [#13816] SCIM ⇄ admin coherence — same boot-loudly rationale as the two
    // asserts above: effective SCIM with an explicit `plugins.admin: false`
    // is a contradiction (ADR-0134 routes SCIM deprovisioning through the
    // admin plugin), refused here rather than mounting SCIM whose
    // active:false path is silently broken. `applyConfigPatch` re-runs it on
    // the merged result, and `buildPluginList()` re-checks for env vars that
    // appear after boot.
    assertScimAdminCoherence(config.plugins);

    // WebContainer (StackBlitz) compatibility — install a synchronous
    // AsyncLocalStorage polyfill for better-auth's request-state global
    // BEFORE better-auth ever instantiates its own. See the helper for the
    // full rationale.
    installWebContainerRequestStatePolyfill();

    // [ADR-0131 D3] The self-registration grant settles on the first
    // membership: watch `sys_member` inserts on the engine from boot, so a
    // claim persisted before a restart settles whichever writer binds it.
    this.observeFirstMemberships(config.dataEngine);

    // Use provided auth instance
    if (config.authInstance) {
      this.auth = config.authInstance;
    }
    // Don't create auth instance automatically to avoid database initialization errors
    // It will be created lazily when needed
  }

  /**
   * Get or create the better-auth instance (lazy, and single-flight).
   *
   * Concurrent callers share ONE build — see {@link AuthManager.authBuild} for
   * why an `if (!this.auth)` guard cannot serialise an async initializer and
   * what the duplicate builds cost at boot. A rejected build is not cached:
   * the slot is cleared so the next caller retries, which is the pre-existing
   * behaviour of the un-serialised form.
   */
  private async getOrCreateAuth(): Promise<Auth<any>> {
    if (this.auth) return this.auth;
    if (this.authBuild) return this.authBuild;
    // `build` is only read from callbacks that run after this statement
    // completes, so comparing against it inside them is safe. The comparison
    // is what makes `applyConfigPatch()`'s invalidation stick: a build the
    // patch disowned must not install itself over the new configuration.
    const build: Promise<Auth<any>> = this.createAuthInstance().then(
      (auth) => {
        if (this.authBuild === build) {
          this.auth = auth;
          this.authBuild = null;
        }
        return auth;
      },
      (e) => {
        if (this.authBuild === build) this.authBuild = null;
        throw e;
      },
    );
    this.authBuild = build;
    return build;
  }

  /**
   * Create a better-auth instance from configuration
   */
  private async createAuthInstance(): Promise<Auth<any>> {
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
        before: createAuthMiddleware(async (ctx: any) => {
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
            // success.
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
                const oldHash = await this.assertPasswordNotReused(userId, candidate, verify);
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
        }),
        after: createAuthMiddleware(async (ctx: any) => {
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

  /**
   * Detect WebContainer (StackBlitz) and swap in a pure-JS scrypt hasher.
   *
   * better-auth defaults to `@better-auth/utils/password.node`, which calls
   * `node:crypto.scrypt`. WebContainer polyfills that API incompletely and
   * signup throws `TypeError: y.run is not a function`.
   *
   * We can't dynamic-import `@better-auth/utils/password` because that
   * package's `exports` map gates the pure-JS build behind a non-`"node"`
   * condition — Node-the-runtime (which WebContainer reports itself as)
   * always resolves to `password.node.mjs`. So we reimplement the same hash
   * here using `@noble/hashes/scrypt` directly, with byte-identical params
   * (N=16384, r=16, p=1, dkLen=64) and the same `{saltHex}:{keyHex}` storage
   * format. Hashes produced by either implementation verify against the
   * other — no migration needed.
   *
   * Returns `undefined` outside WebContainer so production deployments keep
   * the native (fast) hasher and never load `@noble/hashes`.
   */
  private async resolvePasswordHasher(): Promise<
    { hash: (password: string) => Promise<string>; verify: (args: { hash: string; password: string }) => Promise<boolean> } | undefined
  > {
    if (!isWebContainerRuntime()) return undefined;
    try {
      const { scryptAsync } = await import('@noble/hashes/scrypt.js');
      const PARAMS = { N: 16384, r: 16, p: 1, dkLen: 64, maxmem: 128 * 16384 * 16 * 2 } as const;
      const toHex = (b: Uint8Array): string => {
        let s = '';
        for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0');
        return s;
      };
      const generateKey = (password: string, saltHex: string): Promise<Uint8Array> =>
        scryptAsync(password.normalize('NFKC'), saltHex, PARAMS);
      return {
        hash: async (password: string) => {
          const saltBytes = (globalThis as any).crypto.getRandomValues(new Uint8Array(16));
          const saltHex = toHex(saltBytes);
          const key = await generateKey(password, saltHex);
          return `${saltHex}:${toHex(key)}`;
        },
        verify: async ({ hash, password }) => {
          const [saltHex, keyHex] = hash.split(':');
          if (!saltHex || !keyHex) throw new Error('Invalid password hash');
          const target = await generateKey(password, saltHex);
          return toHex(target) === keyHex;
        },
      };
    } catch (err: any) {
      console.warn(
        `[AuthManager] WebContainer detected but pure-JS scrypt unavailable: ${err?.message ?? err}. Falling back to default.`,
      );
      return undefined;
    }
  }

  /**
   * Construct one OPTIONAL better-auth plugin, isolating failures.
   *
   * The 15.1.0 incident: `@better-auth/oauth-provider` threw during
   * construction (`Cannot set properties of undefined (setting 'modelName')`)
   * and, because the better-auth instance is (re)built lazily per request,
   * EVERY auth endpoint — sign-up, sign-in, get-session — returned 500. One
   * optional federation feature must never take down core email/password +
   * session auth, so a throwing optional plugin is skipped with a loud
   * console.error and recorded in `degradedFeatures` (surfaced via
   * getDegradedAuthFeatures(); the OIDC discovery mount checks it).
   *
   * `build` may return one plugin or an array that must land atomically
   * (e.g. jwt + oauthProvider): on failure NOTHING from the unit is pushed.
   */
  private addOptionalPlugin(
    plugins: any[],
    feature: string,
    build: () => Promise<any | any[]>,
  ): Promise<void> {
    // [#25224 cut 6] The body moved to `auth-manager-plugin-assembly.ts` (see `PluginAssemblyHost`).
    const readDegradedFeatures = () => this.degradedFeatures;
    const host: Pick<PluginAssemblyHost, 'degradedFeatures'> = {
      get degradedFeatures() { return readDegradedFeatures(); },
    };
    return addOptionalPlugin.call(host, plugins, feature, build);
  }

  /**
   * Optional auth features that are not working on this instance. Empty when
   * the instance is healthy (or not built yet). Reset by every plugin-list
   * build.
   *
   * Most keys match the `AuthPluginConfig` flag names (`oidcProvider`, `sso`,
   * `scim`, …) and mean "the better-auth plugin threw during initialization
   * and was skipped" (see addOptionalPlugin). One key is finer-grained:
   * `jwtSigning` is recorded at REQUEST time when the jwt plugin constructed
   * fine but could not actually sign (#3585) — the plugin's endpoints are
   * mounted, they just cannot mint a token.
   */
  getDegradedAuthFeatures(): Array<{ feature: string; error: string }> {
    return Array.from(this.degradedFeatures, ([feature, error]) => ({ feature, error }));
  }

  /**
   * Construct better-auth's `jwt` plugin with an algorithm this host can
   * actually use, and with the `/get-session` header hook made non-fatal.
   *
   * Two independent defects are closed here; see `jwt-key-algorithm.ts` for
   * the full analysis of better-auth's key selection.
   *
   * 1. **Algorithm choice.** better-auth defaults to EdDSA/Ed25519, which
   *    `crypto.subtle.generateKey` rejects on hosts without it (WebContainer).
   *    We probe the capability once and pin `keyPairConfig` explicitly.
   * 2. **Existing EdDSA keys.** `resolveSigningKey` falls back to *any* stored
   *    key when none matches the configured algorithm, so a deployment that
   *    already minted an EdDSA key would still die in `importJWK` after the
   *    fallback. On a host without Ed25519 the `adapter.getJwks` keyring seam
   *    hides unusable keys, so they are not offered at all and a fresh ES256
   *    key is minted instead. Rows are hidden, never deleted — moving back to
   *    a host with Ed25519 restores them.
   *
   * The same seam carries the signing-key read cache on every host (#24061,
   * `signing-key-read-cache.ts`): the keyring is held across requests only
   * until a `sys_jwks` write passes the engine or its TTL lapses.
   *
   * Belt-and-braces, on every host: a signing failure degrades the
   * `set-auth-jwt` header instead of 500ing `/get-session`, and the header is
   * signed only for an HTTP `/get-session` — an in-process `auth.api.getSession`
   * read discards it, so it no longer pays the key read and the signature
   * (#24061; see `protectGetSessionJwtHook`).
   */
  private buildJwtPlugin(jwt: (options: any) => any): Promise<any> {
    // [#25224 cut 6] The body moved to `auth-manager-plugin-assembly.ts` (see `PluginAssemblyHost`).
    const readConfig = () => this.config;
    const readEd25519ProbeResult = () => this.ed25519ProbeResult;
    const writeEd25519ProbeResult = (v: AuthManager['ed25519ProbeResult']) => { this.ed25519ProbeResult = v; };
    const host: Pick<PluginAssemblyHost, 'config' | 'ed25519ProbeResult' | 'reportJwtSigningFailure'> = {
      get config() { return readConfig(); },
      get ed25519ProbeResult() { return readEd25519ProbeResult(); },
      set ed25519ProbeResult(v) { writeEd25519ProbeResult(v); },
      reportJwtSigningFailure: (...a) => this.reportJwtSigningFailure(...a),
    };
    return buildJwtPlugin.call(host, jwt);
  }

  /**
   * Record + announce a `/get-session` JWT signing failure exactly once.
   *
   * Functional degradation (AGENTS.md degradation-log-levels): nothing that
   * claimed to persist was lost, the session itself is valid and returned
   * normally — only the optional `set-auth-jwt` enrichment header is missing.
   * It is logged at `error` rather than `warn` for the same reason
   * addOptionalPlugin does: an auth feature the deployment asked for is not
   * delivering, and the operator has to act.
   */
  private reportJwtSigningFailure(error: unknown, alg: string): void {
    // [#25224 cut 6] The body moved to `auth-manager-plugin-assembly.ts` (see `PluginAssemblyHost`).
    const readDegradedFeatures = () => this.degradedFeatures;
    const readJwtSigningFailureReported = () => this.jwtSigningFailureReported;
    const writeJwtSigningFailureReported = (v: AuthManager['jwtSigningFailureReported']) => { this.jwtSigningFailureReported = v; };
    const host: Pick<PluginAssemblyHost, 'degradedFeatures' | 'jwtSigningFailureReported'> = {
      get degradedFeatures() { return readDegradedFeatures(); },
      get jwtSigningFailureReported() { return readJwtSigningFailureReported(); },
      set jwtSigningFailureReported(v) { writeJwtSigningFailureReported(v); },
    };
    return reportJwtSigningFailure.call(host, error, alg);
  }

  /**
   * Build the list of better-auth plugins based on AuthPluginConfig flags.
   *
   * Each plugin that introduces its own database tables is configured with
   * a `schema` option containing the appropriate snake_case field mappings,
   * so that `createAdapterFactory` transforms them automatically.
   *
   * Failure semantics — two tiers, chosen per plugin below:
   *
   *   CORE (construction failure fails the whole instance — better a hard
   *   500 than silently weakened auth):
   *     • bearer        — token auth for every non-cookie API client.
   *     • twoFactor     — skipping it would let accounts WITH 2FA enrolled
   *                       sign in on password alone (fail-open).
   *     • haveIBeenPwned— operator explicitly opted into breached-password
   *                       rejection; dropping it silently relaxes policy.
   *     • customSession — carries positions[]/isPlatformAdmin and the
   *                       ADR-0069 authGate (password expiry, enforced MFA);
   *                       without it authorization and policy gates vanish.
   *
   *   OPTIONAL (skipped on failure via addOptionalPlugin — feature 404s,
   *   core auth stays up): organization, admin, phoneNumber, magicLink,
   *   genericOAuth, jwt+oauthProvider, sso, scim, deviceAuthorization.
   */
  private async buildPluginList(): Promise<any[]> {
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

    if (enabled.organization) {
      await this.addOptionalPlugin(plugins, 'organization', async () => {
      const { organization } = await import('better-auth/plugins/organization');
      // [ADR-0108 / #3723] The org-role vocabulary is CLOSED — better-auth's
      // own `owner`/`admin`/`member` plus `delegated_admin`. App-declared
      // `position` / `permission` names are NOT registered here.
      //
      // They were, until this change: an app role registered with better-auth
      // became storable in `sys_member.role`, and every value in that column is
      // projected into `current_user.positions` by `resolve-authz-context`. So
      // the membership role was a capability channel carrying none of ADR-0090
      // D12's controls — no `granted_by`, no validity window, no subtree or
      // allowlist check — which is exactly what ADR-0057 D4 ("never as the
      // authority for RBAC") and ADR-0090 D3's word ban forbid. An app that
      // wants `sales_rep` declares a POSITION; the one-step admission flow is
      // an invitation carrying placement (ADR-0105 D8), which is governed and
      // reaches further (a delegated admin may use it; this never could).
      //
      // [ADR-0105 D8 / #3697] The map registers `delegated_admin` — the one
      // role that may reach `/organization/invite-member` without being an org
      // admin. Without it D8's scope-bounded issuance gate has no caller:
      // better-auth grants `invitation:["create"]` to owner/admin only, and
      // under a wall-enforcing posture those two are auto-elevated to tenant
      // admins, for whom the gate short-circuits and narrows nothing.
      //
      // Deliberately `create` WITHOUT `cancel`: better-auth's cancel route
      // (`crud-invites.mjs`) checks only `invitation:["cancel"]` — no inviterId
      // attribution — so the permission would mean "cancel anyone's pending
      // invitation in the org". Attributed cancel needs its own guard first.
      let customOrgRoles: Record<string, any> | undefined;
      try {
        const accessMod = await import('better-auth/plugins/organization/access');
        const { defaultAc, memberAc, defaultRoles } = accessMod as any;
        // Better-Auth's `hasPermission` does `{...options.roles || defaultRoles}`
        // (precedence: `||` then spread). When we pass our own `roles`, the
        // built-in owner/admin/member are silently dropped, so even the org
        // owner loses `invitation:create` and every mutation 403s. We must
        // re-include the defaults alongside `delegated_admin` — and if the
        // library ever stops exporting them, build NOTHING and let better-auth
        // fall back to its own defaults rather than ship a map missing `owner`.
        if (defaultAc && memberAc && defaultRoles && typeof memberAc.statements === 'object') {
          const built: Record<string, any> = { ...defaultRoles };
          const stmts = memberAc.statements;
          built[MEMBERSHIP_ROLE_DELEGATED_ADMIN] = defaultAc.newRole({
            ...stmts,
            invitation: ['create'],
          });
          // [Ruling 6355206139] `external` — a portal user inside the
          // organization: no organization, member, invitation, team or
          // access-control statement at all. It confers less than `member`,
          // which is why any issuer may invite to it (E3).
          built[MEMBERSHIP_ROLE_EXTERNAL] = defaultAc.newRole(
            Object.fromEntries(Object.keys(stmts).map((resource) => [resource, []])),
          );
          customOrgRoles = built;
        }
      } catch {
        customOrgRoles = undefined;
      }
      // [#8289] Same map, same request lifetime — see the field's doc for why
      // the before-hook cannot read it back off `ctx`.
      this.orgRolesMap = customOrgRoles;
      // [#16569] Held as a named object rather than an inline literal: the
      // rebuilt `/organization/list-user-invitations` endpoint below needs the
      // VERY object the vendor plugin was constructed with — it is what the
      // vendor's own `getOrgAdapter(ctx.context, options)` reads, and the
      // declaration it honours lives on it.
      const organizationOptions = {
        schema: buildOrganizationPluginSchema(),
        // Enable the team sub-feature so the framework's `sys_team` /
        // `sys_team_member` tables (already declared in platform-objects)
        // are actually wired up to better-auth's CRUD endpoints
        // (`/organization/{create,update,remove,list}-team[s]` and
        // `/organization/{add,remove,list}-team-member[s]`). The Account
        // portal exposes a Teams page; without this flag those endpoints
        // 404 and the section silently breaks.
        teams: { enabled: true },
        // Without a mailer wired in framework, requiring email verification
        // before accepting invitations dead-ends every invite flow with
        // FORBIDDEN EMAIL_VERIFICATION_REQUIRED…. Default-off here keeps
        // the built-in /accept-invitation route usable for pilots; operators
        // who wire a real mailer can re-enable downstream.
        requireEmailVerificationOnInvitation: false,
        // Cap how many orgs a user can CREATE (OS_ORG_LIMIT). Counts only orgs
        // the user OWNS (role=owner) — never orgs they were merely invited into —
        // so a generous cap stops scripted org/free-env spam (each new org can
        // auto-provision a free environment on the cloud control plane) WITHOUT
        // ever blocking a collaborator who belongs to many orgs. Unset → no
        // limit (self-host default). Fail-open: if the count can't be taken we
        // allow creation rather than block a legitimate user on an infra hiccup.
        organizationLimit: async (user: { id?: string }) => {
          const limit = resolveOrgLimit();
          if (limit == null) return false;
          const engine = this.config.dataEngine;
          const uid = typeof user?.id === 'string' ? user.id : '';
          if (!engine || !uid) return false;
          try {
            // `sys_member` is tenant-scoped (organization_id). We need to count
            // the user's owned orgs ACROSS tenants, so read with the system
            // context (isSystem) to bypass org-scoping — otherwise the query
            // returns nothing and the limit never fires.
            const owned = await withSystemReadContext(engine).count('sys_member', {
              where: { user_id: uid, role: 'owner' },
            });
            return (owned ?? 0) >= limit;
          } catch {
            return false;
          }
        },
        // How many MEMBERS one organization may hold — a different question
        // from `organizationLimit` above, and one this platform does not limit:
        // entitlements meter AI seats, and plain membership is not a billed
        // axis. It must still be stated, because better-auth substitutes a
        // vendor default of 100 for an absent `membershipLimit`
        // (`count >= (membershipLimit || 100)`), which reaches the operator as
        // `Organization membership limit reached` — a refusal nobody here ever
        // chose, on an axis nothing here bills. A deployment that DOES want a
        // ceiling sets `OS_ORG_MEMBERSHIP_LIMIT`.
        //
        // MAX_SAFE_INTEGER rather than Infinity: the value is compared, but it
        // also travels through option plumbing that may assume a finite number,
        // and nine quadrillion members is unlimited by any measure that matters.
        membershipLimit: resolveMembershipLimitOption(),
        ...(customOrgRoles ? { roles: customOrgRoles } : {}),
        // ── Slug-change guard ─────────────────────────────────────
        // An org's slug is baked into every env hostname at creation
        // time (see service-tenant `project-provisioning.ts`). Renaming
        // it while live envs exist would silently desync the URL from
        // the org identity. Block the change here; the cloud Console
        // surfaces this as an actionable error and points users to
        // `change_hostname` or archiving the env. Org `name` (display
        // label) is unaffected — only `slug` is guarded.
        //
        // We resolve the data engine lazily so non-cloud apps (which
        // never seed `sys_environment`) keep working: any lookup error
        // is treated as "no envs to protect".
        organizationHooks: {
          // Gate fresh organization creation behind the deployment's TENANCY
          // POSTURE. The plugin itself is always installed (so list/update/invite
          // endpoints keep responding); only the `create` operation is denied,
          // and only where no organization wall is enforced — creating an
          // organization there would mint a boundary nothing keeps (ADR-0049 at
          // the deployment layer).
          //
          // [#5233] The judge is the tenancy POSTURE, never the
          // `OS_MULTI_ORG_ENABLED` boolean ADR-0105 D1 demoted — that one reads
          // `false` on a deployment configured with only the authoritative
          // `OS_TENANCY_POSTURE=isolated`, so the whole organization wall
          // mounted and every org-less user's guided "create your workspace"
          // path still 403'd. Same defect shape as cloud#1020.
          //
          // [#5261] And the judge is the EFFECTIVE posture
          // (`multiOrgPostureEffective()` — the `tenancy` service's answer),
          // not the requested one, so this gate and `/auth/config`'s
          // `features.multiOrgEnabled` are literally the same derivation. On the
          // ADR-0093 D5 degraded shape they used to disagree: the console hid
          // the button while the route minted organizations no engine walls.
          beforeCreateOrganization: async ({ organization }: any = {}) => {
            // [ADR-0120 D3] `'__global__'` is the platform's name for the
            // NULL-organization bucket: the autonumber sequence table keys
            // org-less rows by it, and every organization-scoped unique index
            // folds NULL into it via `COALESCE(organization_id, '__global__')`.
            // An organization minted with that token as its id (or slug — the
            // only caller-controllable identifier here) would collide with the
            // platform bucket, so the token is reserved at this seam.
            if (organization?.id === '__global__' || organization?.slug === '__global__') {
              const { APIError } = await import('better-auth/api');
              throw new APIError('BAD_REQUEST', {
                message:
                  "'__global__' is reserved for the platform (no-organization) bucket " +
                  '(ADR-0120 D3) and cannot be used as an organization id or slug.',
                code: ORGANIZATION_RESERVED_IDENTIFIER_CODE,
              });
            }
            if (!this.multiOrgPostureEffective()) {
              const { APIError } = await import('better-auth/api');
              throw new APIError('FORBIDDEN', {
                message:
                  'Creating additional organizations is disabled on this deployment.',
                code: ORGANIZATION_CREATION_DISABLED_CODE,
              });
            }
          },
          // Run host-provided org-creation side effects (e.g. the cloud control
          // plane provisions the org's born-with production environment). The
          // org-plugin's models don't fire core databaseHooks, so this is the
          // only server-side seam for "every org is born with its prod env".
          // Failure-isolated: org creation must not roll back on a side-effect miss.
          afterCreateOrganization: async ({ organization, member, user }: any) => {
            const cb = this.config.onOrganizationCreated;
            if (typeof cb !== 'function') return;
            try {
              await cb({
                organizationId: organization?.id,
                userId: user?.id ?? member?.userId,
                name: organization?.name,
                slug: organization?.slug,
              });
            } catch (err: any) {
              console.warn('[auth] onOrganizationCreated callback failed:', err?.message ?? String(err));
            }
          },
          // [ADR-0105 D8] Issuance gate. A placement intent on an invitation
          // is a REQUEST; the authority to honour it is the ISSUER's
          // `adminScope` (ADR-0090 D12), judged HERE — at issuance, while the
          // actor is the inviter — not at acceptance, when the actor is the
          // invitee. Rejecting throws out of the endpoint, so no invitation
          // row is created.
          //
          // Fail closed on a missing service: without plugin-security there
          // is no gate, and honouring an unchecked placement would hand
          // `organization_admin` the RBAC-write authority it is deliberately
          // denied (auto-org-admin-grant.ts keeps it read-only on those
          // tables precisely so a fresh org admin cannot rebind themselves).
          beforeCreateInvitation: async ({ invitation, inviter, organization }: any) => {
            // [#25083] A cloud-managed environment creates no invitation at
            // all: the organisation that hosts it invites its people in the
            // cloud. The `before` hook refuses `/organization/invite-member`
            // first, resends included; this arm is the second line, for any
            // other path that reaches the hook. First here, before the role
            // cap and the placement gate, because no invitation is issuable
            // whatever its role or placement.
            if (isCloudManaged()) {
              const { APIError } = await import('better-auth/api');
              throw new APIError('CONFLICT', {
                message: CLOUD_MANAGED_REFUSAL_MESSAGES.invitation,
                code: CLOUD_MANAGED_REFUSAL_CODE,
              });
            }
            const inviterUserId = inviter?.id ?? inviter?.userId ?? null;
            const organizationId = organization?.id ?? invitation?.organizationId;

            // [#3697] Role cap — FIRST, and for EVERY invitation, placement or
            // not: the escalation it closes (invite an `admin`, acceptance
            // auto-elevates to `organization_admin` → tenant admin) needs no
            // placement intent at all. Skipped for a plain `member` invitation,
            // which can never trip the cap — so the ordinary path pays nothing.
            if (!isPlainMemberInvitation(invitation?.role)) {
              // [#23945] Each refusal carries its ADR-0112 code beside its
              // message, the way better-auth's own `owner` refusal on this
              // endpoint does. A membership read that THROWS never reaches
              // this verdict: `resolveMembershipRole` answers it as an outage
              // (503 `SERVICE_UNAVAILABLE`), not as a refusal.
              const refusal = invitationRoleCapFailure(
                invitation?.role,
                await this.resolveMembershipRole(inviterUserId, organizationId),
              );
              if (refusal) {
                const { APIError } = await import('better-auth/api');
                throw new APIError('FORBIDDEN', { message: refusal.message, code: refusal.code });
              }
            }

            const intent = readInvitationPlacementIntent(invitation);
            if (!intent) return;

            const svc = await this.config.invitationPlacement?.().catch(() => undefined);
            if (!svc) {
              const { APIError } = await import('better-auth/api');
              throw new APIError('FORBIDDEN', {
                message:
                  'Invitation placement (business unit + positions) requires the delegated-administration runtime; this deployment cannot authorize it.',
                code: INVITE_PLACEMENT_UNSUPPORTED_CODE,
              });
            }

            try {
              await svc.assertIssuable({
                intent,
                // WHO is issuing — not a context. The service resolves this
                // user's real grants through the shared authz resolver; a
                // hand-built context here would carry no positions and refuse
                // every delegate.
                actorUserId: inviterUserId,
                organizationId,
              });
            } catch (err: any) {
              // [#24243] Only the gate's own refusal is a scope verdict. A throw
              // that is not one (the issuer's grants could not be read) reached
              // no verdict, so it answers 503 with its code rather than wearing
              // the refusal's 403, its code and a driver's message.
              if (!isInvitationPlacementGateRefusal(err)) {
                throw await invitationPlacementReadFaultApiError(err);
              }
              const { APIError } = await import('better-auth/api');
              throw new APIError('FORBIDDEN', {
                message: err?.message ?? 'Invitation placement is outside your delegated administration scope.',
                code: INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE_CODE,
              });
            }
          },
          // [ADR-0105 D8] Accept-time application + host seam. The placement
          // the issuance gate approved lands WITH the better-auth membership,
          // so the invitee arrives already in the right unit and role. The
          // apply is idempotent (a replayed acceptance converges) and
          // failure-isolated — a placement miss must not undo a valid
          // membership; the host seam still fires either way.
          afterAcceptInvitation: async ({ invitation, member, user, organization }: any) => {
            const intent = readInvitationPlacementIntent(invitation);
            if (intent) {
              try {
                const svc = await this.config.invitationPlacement?.();
                if (svc) {
                  await svc.apply({
                    intent,
                    userId: String(user?.id ?? member?.userId),
                    organizationId: organization?.id ?? invitation?.organizationId ?? member?.organizationId,
                    grantedBy: invitation?.inviterId ?? invitation?.inviter_id ?? null,
                  });
                }
              } catch (err: any) {
                console.warn(
                  '[auth] invitation placement failed (membership kept):',
                  err?.message ?? String(err),
                );
              }
            }

            const cb = this.config.onInvitationAccepted;
            if (typeof cb !== 'function') return;
            try {
              await cb({
                invitationId: invitation?.id,
                organizationId: organization?.id ?? invitation?.organizationId ?? member?.organizationId,
                userId: user?.id ?? member?.userId,
                memberId: member?.id,
                role: member?.role ?? invitation?.role,
                email: invitation?.email,
                invitation,
                member,
              });
            } catch (err: any) {
              console.warn('[auth] onInvitationAccepted callback failed:', err?.message ?? String(err));
            }
          },
          beforeUpdateOrganization: async ({ organization, member }: any) => {
            const newSlug = organization?.slug;
            const orgId = member?.organizationId;
            if (!newSlug || !orgId) return;

            // [#21941] The guard reads only what this composition registers,
            // and FAILS CLOSED when a registered read cannot answer.
            //
            //  - NO DATA ENGINE ⇒ the guard does not apply. Only a standalone
            //    `AuthManager` lacks one (`AuthPlugin` declares ObjectQL a hard
            //    dependency), and it then runs on better-auth's in-memory store:
            //    no engine registers `sys_environment`, so no environment can
            //    reference the organization.
            //  - `sys_environment` NOT REGISTERED ⇒ the guard does not apply,
            //    for the same reason, and nothing is read. It is a cloud-provided
            //    object (`CLOUD_PROVIDED_OBJECT_NAMES`), so this is the
            //    open-source composition's answer. The question is the
            //    registry's own (`getSchema`), never a caught throw; an engine
            //    that cannot be asked reads as before — it is asked, and a fault
            //    refuses.
            //  - A REGISTERED READ THAT THROWS ⇒ refused, `503
            //    SERVICE_UNAVAILABLE` (`slugGuardReadFaultApiError`). It used to
            //    end the hook without refusing, which let the slug change through
            //    whenever either read faulted.
            const rawEngine = this.config.dataEngine;
            if (!rawEngine) return;
            const schemaOf = (rawEngine as { getSchema?: (object: string) => unknown }).getSchema;
            if (typeof schemaOf === 'function' && !schemaOf.call(rawEngine, 'sys_environment')) return;

            // Both reads run as the platform (`withSystemContext`): this hook
            // IS the slug guard — the organization id is the `where`, not the
            // reader — so neither read reaches the engine with no principal
            // and no opt-in (the security middleware's former principal-less
            // hand-off, which ADR-0096 D5 replaced with a refusal).
            const dataEngine = withSystemContext(rawEngine) as any;

            let currentSlug: string | undefined;
            try {
              const current = await dataEngine.findOne('sys_organization', {
                where: { id: orgId },
              });
              currentSlug = current?.slug;
            } catch (err) {
              throw await slugGuardReadFaultApiError('sys_organization', err);
            }
            if (!currentSlug || currentSlug === newSlug) return;

            let activeEnvs = 0;
            try {
              const envs = await dataEngine.find('sys_environment', {
                where: { organization_id: orgId },
              });
              activeEnvs = (envs ?? []).filter(
                (e: any) => e?.status !== 'archived' && e?.status !== 'failed',
              ).length;
            } catch (err) {
              throw await slugGuardReadFaultApiError('sys_environment', err);
            }

            if (activeEnvs > 0) {
              const { APIError } = await import('better-auth/api');
              // [#24243] The message states only what the guard read: environment
              // rows by `organization_id`, counted by `status`. No hostname is
              // read, so none is named as a remedy.
              throw new APIError('FORBIDDEN', {
                message:
                  `Cannot change the organization slug while the organization has ${activeEnvs} ` +
                  `active environment(s), meaning any environment that is neither archived nor ` +
                  `failed. Archive those environments first, or keep the current slug.`,
                code: ORGANIZATION_SLUG_LOCKED_CODE,
              });
            }
          },
          // [#24948] The teams, their members and the organization-admin
          // grants are the organization's own auth structure, and better-auth's
          // delete leaves them behind. They go here, inside the request's
          // transaction (`handleRequest`), after the `hooks.before` refusal has
          // found no records left. The Default Organization is the
          // last-administrator guard's to answer, so its structure is not
          // touched: when that guard admits the delete, the engine's own
          // refusal still holds while anything names it.
          beforeDeleteOrganization: async ({ organization }: any) => {
            const engine = this.getDataEngine();
            const organizationId = organization?.id;
            if (!engine || typeof organizationId !== 'string' || !organizationId) return;
            if (await isDefaultOrganizationTarget(engine, organization, postureEnforcesWall(resolveTenancyPosture()))) return;
            await removeOrganizationAuthStructure(engine, organizationId);
          },
        },
        // No mailer is wired in framework yet — log the accept URL so
        // operators / UI can fall back to copy-paste flows. Replace this
        // with a real mail integration when available.
        sendInvitationEmail: async ({ email: recipientEmail, invitation, organization: org, inviter }) => {
          // The accept-invitation page is a Console SPA route; the Console
          // builds the very same link for its "copy invitation link" action
          // (`${origin}${BASE_URL}accept-invitation/<id>`). Compose it through
          // the single-source helper so the `/_console` prefix and absolute
          // https origin are guaranteed.
          const acceptUrl = this.getConsolePageUrl(`/accept-invitation/${invitation.id}`);
          // #2766 V1.5 — placeholder addresses are never real recipients.
          if (isPlaceholderEmail(recipientEmail)) {
            throw new Error(
              `Invitation email refused: ${recipientEmail} is a placeholder address (PLACEHOLDER_EMAIL).`,
            );
          }
          const emailService = this.getEmailService();
          if (!emailService) {
            // #2766 — the accept URL is a bearer credential; only print it in
            // dev, never in production logs.
            const dev = (globalThis as any)?.process?.env?.NODE_ENV !== 'production';
            console.warn(
              `[AuthManager] Invitation email not configured. ` +
              `To: ${recipientEmail} (org: ${org?.name ?? invitation.organizationId}, ` +
              `role: ${invitation.role}, inviter: ${inviter?.user?.email ?? 'unknown'})` +
              (dev ? ` URL: ${acceptUrl}` : ' (accept URL suppressed outside dev)'),
            );
            return;
          }
          // #14641 — the invitee's OWN stored language, when the address
          // already carries a `sys_user` row. Two branches, and the split is
          // the whole point:
          //
          //  1. the address HAS a row — an existing platform user invited into
          //     a second organization, or a re-invitation (better-auth's
          //     `create-invitation` refuses only an address that is already a
          //     member of THIS org, measured in the installed 1.7.x
          //     `routes/crud-invites.mjs`, so an existing account being invited
          //     elsewhere reaches this callback normally). Their column is a
          //     language they chose for themselves — the same authority the
          //     reset / verification sends read since commit 35e94c96b.
          //  2. NO row — a genuinely new invitee. Their language is still truly
          //     unknown at invitation time, so the deployment default stands,
          //     exactly as before.
          //
          // Matched EXACTLY on the address, which is safe here rather than
          // merely tolerable: better-auth lowercases the invitee address on the
          // invite route (`crud-invites.mjs` — both the create and the resend
          // branch) and lowercases the stored `user.email` on sign-up
          // (`api/routes/sign-up.mjs`), so both sides of this predicate are
          // already in the same case. A spelling that resolves no row lands on
          // the deployment default, which is the documented floor rather than a
          // failure.
          const storedLocale = await this.storedRecipientLocale({ email: recipientEmail });
          // #14319 — DELIBERATELY no request argument, and the only one of
          // the five sends without one. better-auth DOES hand this callback
          // a `ctx.request`, but it is the INVITER's: stamping their
          // browser language onto the invitee's mail would recreate this
          // very card one seat over. The 2026-09-02 ruling enumerates
          // signup, sign-in and password reset — sends where the requester
          // IS the recipient — and the superseded 2026-08-13 ruling named
          // invitations as its own counterexample. #13881's ruling item 3
          // fixes the chain as RECIPIENT locale → deployment default, so
          // the inviter direction stays rejected: what #14641 added above
          // is the invitee's own column, never the inviter's header.
          const mailLocale = this.emailLocaleArg(undefined, storedLocale);
          // #24154 — `{{role}}` names the membership role by its option LABEL
          // in the mail's own locale (`成员`, not `member`): every body of the
          // template interpolates this one value, so the zh-CN mail stops
          // printing the stored enum inside a Chinese sentence. Never throws;
          // a value with no label is named as stored, with one warn.
          const roleLabel = await invitationRoleLabel(invitation.role || '', mailLocale.locale, {
            getI18n: this.config.getI18n,
            warn: (msg, meta) =>
              this.config.logger ? this.config.logger.warn(msg, meta) : console.warn(msg, meta),
          });
          try {
            await emailService.sendTemplate({
              template: 'auth.invitation',
              to: recipientEmail,
              ...mailLocale,
              data: {
                inviter: {
                  name: inviter?.user?.name ?? inviter?.user?.email ?? 'A teammate',
                  email: inviter?.user?.email ?? '',
                },
                organization: { name: org?.name ?? invitation.organizationId },
                role: roleLabel,
                acceptUrl,
                appName: this.getAppName(),
              },
              relatedObject: 'sys_invitation',
              relatedId: invitation.id,
              // commit b706af987 — the invitation HOLDS its organization; thread it so
              // the sys_email row is stamped: tenant mail. Mail about a person
              // (reset / verification / magic link) is identity mail instead.
              ...(invitation.organizationId
                ? { organizationId: String(invitation.organizationId) }
                : {}),
            });
          } catch (err: any) {
            // Do NOT rethrow: the invitation row was already persisted by
            // better-auth; an email-transport failure must not turn the
            // invite request into a 500. The admin can resend the invite.
            console.error(`[AuthManager] sendInvitationEmail failed (swallowed): ${err?.message ?? err}`);
          }
        },
      } satisfies OrganizationOptions;
      const organizationPlugin: any = organization(organizationOptions);

      // [#16569] `GET /organization/list-user-invitations` — make the vendor's
      // listing honour the `requireEmailVerificationOnInvitation: false`
      // declared above, the way `accept-invitation`, `reject-invitation` and
      // `get-invitation` already do. better-auth 1.7.2's `listUserInvitations`
      // refuses every unverified session UNCONDITIONALLY (it never reads the
      // option), so on exactly the no-mailer deployment the declaration exists
      // for, an invitee could accept an invitation but never list it and the
      // SDK's `organizations.invitations.listMine()` inbox was empty-by-403.
      // Rebuilt IN PLACE on this plugin's own endpoints record — the same
      // shape as `applyPlatformAdminImpersonation` above, for the same reasons
      // (one owner for the path; every hook keyed on it still fires; the
      // request contract is the vendor's own options object, never a copy).
      // The listing itself stays the vendor's `getOrgAdapter(...)
      // .listUserInvitations(sessionEmail)`: no second definition of which
      // rows a session may see. `list-user-invitations-verification.ts`
      // carries the full reading.
      const listingRewired = await applyDeclaredInvitationVerificationToListing(
        organizationPlugin,
        organizationOptions,
      );
      if (!listingRewired) {
        // The vendor renamed or dropped the endpoint. Say so loudly: the
        // route then falls back to the vendor's own handler, which refuses
        // every unverified session — an empty inbox, not an open door.
        // `warn`, not `error` (AGENTS.md → Degradation log levels): the
        // system is VISIBLY smaller — the inbox answers a 403 the caller sees
        // — and nothing claims a persistence it did not perform.
        console.warn(
          '[AuthManager] better-auth\'s organization plugin no longer exposes a ' +
          '`listUserInvitations` endpoint at /organization/list-user-invitations, ' +
          'so the declared `requireEmailVerificationOnInvitation` could NOT be ' +
          'applied to the invitation inbox. Unverified users will be refused ' +
          '(403 EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION) until ' +
          'list-user-invitations-verification.ts is updated for the new vendor shape.',
        );
      }
      return organizationPlugin;
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

  /**
   * Create database configuration using ObjectQL adapter
   *
   * better-auth resolves the `database` option as follows:
   * - `undefined`            → in-memory adapter
   * - `typeof fn === "function"` → treated as `DBAdapterInstance`, called with `(options)`
   * - otherwise              → forwarded to Kysely adapter factory (pool/dialect)
   *
   * A raw `CustomAdapter` object would fall into the third branch and fail
   * silently.  We therefore wrap the ObjectQL adapter in a factory function
   * so it is correctly recognised as a `DBAdapterInstance`.
   */
  private createDatabaseConfig(): Promise<any> {
    // [#25224 cut 7] The body moved to `auth-manager-database-secret.ts` (see `DatabaseSecretHost`).
    const readConfig = () => this.config;
    const host: Pick<DatabaseSecretHost, 'config' | 'stageUserCreatedInRequest'> = {
      get config() { return readConfig(); },
      stageUserCreatedInRequest: (...a) => this.stageUserCreatedInRequest(...a),
    };
    return createDatabaseConfig.call(host);
  }

  /**
   * Generate a secure secret if not provided
   */
  /** The auth secret, resolved once — see {@link resolvedAuthSecret}. */
  private resolveAuthSecret(): string {
    // [#25224 cut 7] The body moved to `auth-manager-database-secret.ts` (see `DatabaseSecretHost`).
    const readConfig = () => this.config;
    const readResolvedAuthSecret = () => this.resolvedAuthSecret;
    const writeResolvedAuthSecret = (v: AuthManager['resolvedAuthSecret']) => { this.resolvedAuthSecret = v; };
    const host: Pick<DatabaseSecretHost, 'config' | 'generateSecret' | 'resolvedAuthSecret'> = {
      get config() { return readConfig(); },
      generateSecret: (...a) => this.generateSecret(...a),
      get resolvedAuthSecret() { return readResolvedAuthSecret(); },
      set resolvedAuthSecret(v) { writeResolvedAuthSecret(v); },
    };
    return resolveAuthSecret.call(host);
  }

  private generateSecret(): string {
    // [#25224 cut 7] The body moved to `auth-manager-database-secret.ts`; it reads no member of this class.
    return generateSecret();
  }

  /**
   * Update the base URL at runtime.
   *
   * This **must** be called before the first request triggers lazy
   * initialisation of the better-auth instance — typically from a
   * `kernel:ready` hook where the actual server port is known.
   *
   * If the auth instance has already been created this is a no-op and
   * a warning is emitted.
   */
  setRuntimeBaseUrl(url: string): void {
    // [#17176] A build already IN FLIGHT counts as created: it has read (or is
    // about to read) the standing config, and it is now the one instance every
    // later caller receives. Reporting only on `this.auth` would let this
    // silently no-op instead of saying so.
    if (this.auth || this.authBuild) {
      console.warn(
        '[AuthManager] setRuntimeBaseUrl() called after the auth instance was already created — ignoring. ' +
        'Ensure this method is called before the first request.',
      );
      return;
    }
    this.config = { ...this.config, baseUrl: url };
  }

  /**
   * Merge runtime configuration into the manager.
   *
   * Settings-backed auth policy can change after the manager is constructed.
   * better-auth itself is created lazily, so changing config before the first
   * request is enough. If an instance already exists, reset it so the next
   * request rebuilds with the new policy.
   */
  applyConfigPatch(
    patch: Partial<AuthManagerOptions>,
    options: {
      /**
       * [#20389] Who declared the patch's `emailAndPassword.requireEmailVerification`.
       * Defaults to `deployment` (host code); the settings binding passes
       * `console` for a value an administrator stored, and `deployment` for an
       * `OS_AUTH_REQUIRE_EMAIL_VERIFICATION` env override.
       */
      requireEmailVerificationFrom?: VerificationDeclarant;
    } = {},
  ): void {
    const next: AuthManagerOptions = {
      ...this.config,
      ...patch,
      ...(patch.emailAndPassword
        ? {
          emailAndPassword: {
            ...(this.config.emailAndPassword ?? {}),
            ...patch.emailAndPassword,
          },
        }
        : {}),
      ...(patch.plugins
        ? {
          plugins: {
            ...(this.config.plugins ?? {}),
            ...patch.plugins,
          },
        }
        : {}),
    };

    if ('socialProviders' in patch) {
      next.socialProviders = patch.socialProviders;
    }

    // [#11739] The audience declaration replaces WHOLE (never a deep merge —
    // a posture switch changes which sibling keys are even legal, so merging
    // stale domains under a new posture would manufacture the inert shapes
    // the entry validation refuses). Validate the MERGED result before it
    // becomes current: a patch that would leave the audience configuration
    // unusable — off-vocabulary posture, inert keys, verification
    // contradiction — is refused loudly here and the standing config keeps
    // ruling (the settings-boundary posture of #5152: reject, never coerce).
    if ('audience' in patch) {
      next.audience = patch.audience;
    }
    // [#20389] A patch that sets `requireEmailVerification` from the
    // deployment re-declares the deployment's opt-out; one from the console
    // leaves it as it stood (the console can agree with it, never make it).
    const deploymentDeclaredVerificationOff =
      patch.emailAndPassword !== undefined &&
      'requireEmailVerification' in patch.emailAndPassword &&
      (options.requireEmailVerificationFrom ?? 'deployment') === 'deployment'
        ? patch.emailAndPassword.requireEmailVerification === false
        : this.deploymentDeclaredVerificationOff;
    if ('audience' in patch || 'emailAndPassword' in patch) {
      assertAudienceConfig(next.audience, next.emailAndPassword, {
        verificationDeclaredBy: deploymentDeclaredVerificationOff ? 'deployment' : 'console',
      });
    }
    // [#13816] Same entry validation the constructor runs, on the MERGED
    // plugins block: a patch must not be able to smuggle the
    // scim-with-admin-declined contradiction past boot. Refused loudly here
    // and the standing config keeps ruling.
    if ('plugins' in patch) {
      assertScimAdminCoherence(next.plugins);
    }

    this.config = next;
    this.deploymentDeclaredVerificationOff = deploymentDeclaredVerificationOff;
    // [#17176] An in-flight build is discarded alongside a materialised one:
    // it was composed from the pre-patch config, so adopting it would serve
    // the superseded configuration to every later caller. `getOrCreateAuth()`
    // checks its own identity before installing, so the disowned build resolves
    // to its callers and installs nothing.
    if ((this.auth || this.authBuild) && !patch.authInstance) {
      this.auth = null;
      this.authBuild = null;
    }
  }

  /**
   * [#11739] The deployment's audience posture **as it stands right now** —
   * the `getMembershipPolicy()` pattern: the ONE source every consumer reads
   * (the validateUserInfo admission gate, the better-auth wiring's forced
   * email verification, and `getPublicConfig()`'s `features.audiencePosture`),
   * so a config patch reaches all of them without a restart and no captured
   * constructor option can go stale against the live setting. Undeclared ⇒
   * `invite_only` (epic #11723 ruling — no legacy/undeclared limbo).
   */
  getAudience(): ResolvedAudience {
    return resolveAudience(this.config.audience);
  }

  /**
   * ADR-0093 D1 — the deployment's membership policy **as it stands right now**.
   *
   * The ONE source EVERY membership-writing path reads (#5152):
   *   - sign-up: the reconciler composed into `user.create.after` (below);
   *   - backfill: `AuthPlugin`'s ADR-0093 D6 pass over pre-existing member-less
   *     users, which used to read the plugin's CONSTRUCTOR options instead;
   *   - `POST /admin/create-user`: the endpoint-side belt-and-suspenders bind
   *     in `admin-user-endpoints.ts`, reached through
   *     `AdminUserEndpointDeps.getMembershipPolicy`.
   *
   * That list was written as "both membership paths" while the admin endpoint
   * handed the reconciler a literal `'auto'` — a third writer, outside the
   * accounting, binding under `invite-only` where the other two correctly did
   * not. Enumerate every writer here: a path that is not in this list is a
   * path that can disagree with the deployment's policy.
   *
   * That split mattered because `this.config` is what {@link applyConfigPatch}
   * targets: once `auth.membership_policy` became a platform setting, the
   * constructor options stopped being current the moment an admin saved the
   * form. Sign-up would honour the new policy while the backfill kept running
   * the old one — and the backfill binds in BULK. Read the policy through here,
   * never off a captured option, so a settings change reaches both without a
   * restart.
   */
  getMembershipPolicy(): MembershipPolicy {
    return this.config.membershipPolicy ?? 'auto';
  }

  /**
   * [ADR-0093 D2] Run the membership reconciler for one user — the ONE place
   * this manager assembles its inputs.
   *
   * Two seams call it, and the whole point is that they cannot disagree:
   *
   *  - `user.create.after`, the creation seam every path flows through (email
   *    signup, admin create-user, bulk import, SSO JIT);
   *  - `session.create.before`, which settles the membership before resolving
   *    the session's active organization so a user's FIRST session is not
   *    minted tenant-less (#8247 rule 2 / #8245) — and ONLY for a session
   *    minted in the request that created the user (ADR-0093 D7: membership is
   *    decided at creation; see {@link isCreatedInThisRequest}).
   *
   * Assembling the deps at each call site instead would let the two drift on
   * the axis that matters most: the POLICY. `getMembershipPolicy()` reads a
   * live platform setting (#5152) — a captured constructor option would keep
   * one seam auto-binding after an admin switched the deployment to
   * `invite-only`, which is the exact defect that made the accessor exist. The
   * target-org resolution is shared for the same reason: "which organization"
   * must never be answered two ways.
   *
   * Never throws — `reconcileMembership` already guarantees that, and the guard
   * stands anyway because both callers are hooks where a bookkeeping failure
   * must not fail user creation or sign-in. The OUTCOME is returned (rather
   * than swallowed) so the session seam can tell "a membership now exists" from
   * "policy says there will never be one" and skip a pointless re-read;
   * `undefined` means the reconciler could not be consulted at all.
   */
  private settleMembership(userId: unknown): Promise<ReconcileOutcome | undefined> {
    // [#25224 cut 8] The body moved to `auth-manager-membership-admission.ts` (see `MembershipAdmissionHost`).
    const readConfig = () => this.config;
    const host: Pick<MembershipAdmissionHost, 'config' | 'getMembershipPolicy'> = {
      get config() { return readConfig(); },
      getMembershipPolicy: (...a) => this.getMembershipPolicy(...a),
    };
    return settleMembership.call(host, userId);
  }

  /**
   * An external sign-in's `locale` claim → `sys_user.locale`, staged by the
   * `validateUserInfo` seam and settled on the session the sign-in mints.
   * The rule and its record: `idp-locale-claim.ts`.
   */
  private readonly idpLocale = new IdpLocaleSync({
    getEngine: () => this.getDataEngine() as never,
    getSupportedLocales: () => {
      try {
        const locales = this.config.getI18n?.()?.getLocales?.();
        return Array.isArray(locales) ? locales : undefined;
      } catch {
        return undefined;
      }
    },
    resolveAuth: () => this.linkingContext(),
    warn: (message, meta) => this.config.logger?.warn?.(message, meta),
  });

  /**
   * [ADR-0093 D7] The users created in each in-flight better-auth request,
   * keyed by that request's endpoint context — the object better-auth hands
   * every database hook of one endpoint call and that `objectql-adapter`'s
   * `onRecordCreated` reads from the same call. Values are user ids.
   *
   * Why the session seam needs it: `user.create.after` is deferred past the
   * creation's transaction, so the session a sign-up mints is created BEFORE
   * the reconciler has bound anyone. The session seam therefore settles the
   * membership itself — but only for the user this same request created. Any
   * other member-less user signing in is not mid-creation, and membership is
   * decided at creation, never re-decided at sign-in.
   *
   * The id is captured from the adapter's own `create` result, so recognising
   * the user needs no read of the store (a read that, on a driver writing
   * through another connection, could miss the row).
   *
   * A `WeakMap` because the scope IS the request: the entry dies with the
   * endpoint context, so nothing staged here can outlive the call that staged
   * it and be read by a later sign-in.
   */
  private usersCreatedInRequest = new WeakMap<object, Set<string>>();

  /** Record that the current request created the user `userId`. */
  private stageUserCreatedInRequest(ctx: unknown, userId: unknown): void {
    if (!ctx || typeof ctx !== 'object' || typeof userId !== 'string' || !userId) return;
    let staged = this.usersCreatedInRequest.get(ctx);
    if (!staged) {
      staged = new Set();
      this.usersCreatedInRequest.set(ctx, staged);
    }
    staged.add(userId);
  }

  /** Is `userId` a user the current request created? In-memory only. */
  private isCreatedInThisRequest(ctx: unknown, userId: string): boolean {
    if (!ctx || typeof ctx !== 'object') return false;
    return this.usersCreatedInRequest.get(ctx)?.has(userId) === true;
  }

  // ── [#11739] Audience posture — admission gate + self-registration grant ──

  /**
   * Self-registration grants staged between the admission gate (which runs
   * just before the user row is inserted and is the last point that may
   * REFUSE) and `user.create.after` (the first point the created user id
   * exists). Keyed by lowercased email — better-auth lowercases the address
   * on `createUser`, and an in-flight duplicate email cannot create twice
   * (unique). Entries are pruned by age so an admission whose creation never
   * completed cannot leak.
   */
  private pendingSelfRegistrationGrants = new Map<
    string,
    { setName: string; stagedAtMs: number }
  >();

  private static readonly SELF_REG_GRANT_STAGE_TTL_MS = 10 * 60 * 1000;

  /**
   * [#12751] Owner-verified stamps staged by the admission gate for the
   * composed `user.create.before` hook — same shape and lifetime discipline
   * as {@link pendingSelfRegistrationGrants} (keyed by lowercased email;
   * better-auth lowercases the address on `createUser`, and an in-flight
   * duplicate cannot create twice). One entry only ever exists for the
   * declared platform owner's address on a walled deployment; TTL pruning
   * keeps an admission whose creation never completed from leaking into an
   * unrelated later creation of the same address.
   */
  private pendingOwnerVerifiedStamps = new Map<string, { stagedAtMs: number }>();

  private static readonly OWNER_STAMP_STAGE_TTL_MS = 10 * 60 * 1000;

  /**
   * [#14157] Addresses the deployment's OWN boot command is provisioning right
   * now — see {@link stageOperatorProvisioning} for why this exists and why it
   * is not the bootstrap probe.
   *
   * [#14373] Keyed by email, but admission also requires the per-stage
   * `ticket` below — see {@link stageOperatorProvisioning} for why the
   * address alone stopped being enough.
   */
  private pendingOperatorProvisioning = new Map<string, { stagedAtMs: number; ticket: string }>();

  /**
   * Deliberately short. The window this covers is a single in-process
   * `signUpEmail` call that the caller also clears in a `finally`; the TTL is
   * only the floor under a caller killed between the two.
   */
  private static readonly OPERATOR_PROVISIONING_STAGE_TTL_MS = 60 * 1000;

  /**
   * [#14373] Body field the ticket's random value rides on for the single
   * in-process `signUpEmail` call it admits. `signUpEmailBodySchema` in
   * better-auth is `z.object({...}).and(z.record(z.string(), z.any()))`, so
   * an unrecognized key survives validation on `ctx.body` untouched — this
   * rides that catch-all rather than a declared `additionalFields` column,
   * so it never becomes a `sys_user` field. The name is deliberately
   * internal-looking; nothing public ever sends this key, so its presence in
   * a request is itself the credential this seam demands (see
   * {@link isOperatorProvisioning}).
   */
  static readonly OPERATOR_PROVISIONING_TICKET_FIELD = '__osOperatorProvisioningTicket';

  /**
   * Page size of the bootstrap population probe ({@link isBootstrapCreation}).
   * Matches the bound the dev-admin seed reads with, so the two ask the same
   * question of the same window.
   */
  private static readonly BOOTSTRAP_USER_PROBE_LIMIT = 50;

  /**
   * Page size of the pending-invitation probe ({@link hasPendingInvitationFor}).
   * Unlike the bootstrap probe's limit this is NOT a bound on the answer — the
   * probe's read is narrowed to one address and its page chain is exhausted —
   * so the value only trades round trips against page size.
   */
  /**
   * [#15587] Page bound for the sign-up uniqueness probe
   * ({@link hasExistingUserFor}). One matching row IS the answer, so this only
   * has to be large enough that a store which folds case or accents cannot
   * push the real row off the page behind near-misses.
   */
  private static readonly EXISTING_USER_PROBE_LIMIT = 50;

  private static readonly PENDING_INVITATION_PROBE_PAGE = 50;

  /**
   * Termination guarantee for that page chain, not a ceiling on the answer:
   * reaching it would mean 10k pending invitations addressed to a single
   * person, and it is reported at error level rather than answered silently.
   */
  private static readonly PENDING_INVITATION_PROBE_MAX_PAGES = 200;

  /**
   * `error` when the host logger carries it, else the guaranteed `warn` channel (#9754).
   *
   * ⛔ Call through the PROPERTY — never through an extracted reference.
   * `(logger?.error ?? logger?.warn)?.(…)` evaluates to the *function* and then
   * invokes it, so the call runs with `this === undefined`. A plain-closure
   * logger survives that; `@objectstack/core`'s class-based `ObjectLogger` does
   * not — its `error` reaches for `this.writeErrorLike` (and `warn`/`info` for
   * `this.write`) and throws `Cannot read properties of undefined`. Measured on
   * a real composed EE boot: every audience refusal routed through here became
   * `HTTP 500 null`, because the throw escaped the caller's `catch` when that
   * handler called this helper a second time — so the operator lost the very
   * verdict this method exists to report.
   *
   * The branch below keeps BOTH halves of the contract: the `error`→`warn`
   * fallback (#9754) and the receiver.
   */
  private audienceLogError(message: string, meta?: Record<string, unknown>): void {
    const logger = this.config.logger as
      | { error?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void; info?: (m: string, meta?: any) => void }
      | undefined;
    if (logger?.error) logger.error(message, meta);
    else logger?.warn?.(message, meta);
  }

  /**
   * The effective local-verification requirement for an implicit account
   * link — `true` unless the operator explicitly set
   * `account.accountLinking.requireLocalEmailVerified: false`. See
   * `implicit-account-linking.ts` for the rules and the operator override.
   */
  private implicitLinkRequiresLocalEmailVerified(): boolean {
    return (this.config as any)?.account?.accountLinking?.requireLocalEmailVerified !== false;
  }

  /**
   * better-auth's auth context read off the auth instance — the store for the
   * implicit-linking hooks when a call carries no endpoint context (a
   * server-side `auth.api.*` call or an internal-adapter write).
   */
  private async linkingContext(): Promise<LinkingAuthContext | undefined> {
    try {
      const auth: any = await this.getOrCreateAuth();
      const context = await auth?.$context;
      return context?.adapter && context?.internalAdapter ? (context as LinkingAuthContext) : undefined;
    } catch {
      return undefined;
    }
  }

  /** OAuth providerIds that are OPERATOR-REGISTERED identity authorities (enterprise `oidcProviders`, incl. the cloud platform IdP). */
  private enterpriseOAuthProviderIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const p of this.config.oidcProviders ?? []) {
      const id = (p as { providerId?: unknown } | undefined)?.providerId;
      if (typeof id === 'string' && id) ids.add(id);
    }
    return ids;
  }

  /**
   * The better-auth `user.validateUserInfo` gate — [#11739]'s ONE enforcement
   * point. Semantics (creation classes, invitation carve-out, pinned domain
   * matching, fail postures) live in `audience-posture.ts`; this method owns
   * only the I/O the pure decision needs: the zero-user bootstrap probe, the
   * pending-invitation lookup, and the declared permission set's completeness
   * check. Answers `undefined` to admit, `{ error, errorDescription }` to
   * refuse (the vendor surfaces it as a 403 whose `code` is ours; browser
   * OAuth flows redirect to the error URL carrying the same code).
   *
   * [#11767] The vendor's second argument — the endpoint context — is
   * deliberately UNREAD for the population probes below: both take their own
   * ctx-independent data path, because sourcing THEIR I/O from the request
   * context is exactly what made the bootstrap bypass inert (see {@link
   * isBootstrapCreation}). [#14373] carves one narrow exception: the operator
   * ticket's random value (see `stageOperatorProvisioning`), which travels
   * only as a `ctx.body` field and has no other channel to reach this gate —
   * `data.user` here is `internalAdapter.createUser`'s own input, not the raw
   * request body, so it never carries an undeclared key. That is a plain read
   * of an already-parsed value, not a re-derived I/O probe, so it does not
   * reopen what #11767 closed.
   */
  private validateAudienceAdmission(
    data: {
      user?: Record<string, unknown>;
      source?: { action?: string; method?: string; oauth?: { providerId?: string } };
    },
    ctx?: unknown,
  ): Promise<{ error: string; errorDescription?: string } | undefined> {
    // [#25224 cut 8] The body moved to `auth-manager-membership-admission.ts` (see `MembershipAdmissionHost`).
    const readConfig = () => this.config;
    const host: Pick<MembershipAdmissionHost, 'audienceLogError' | 'config' | 'enterpriseOAuthProviderIds' | 'getAudience' | 'hasPendingInvitationFor' | 'isBootstrapCreation' | 'isOperatorProvisioning' | 'selfRegistrationSetResolvable' | 'stageOwnerVerifiedStamp' | 'stageSelfRegistrationGrant'> = {
      audienceLogError: (...a) => this.audienceLogError(...a),
      get config() { return readConfig(); },
      enterpriseOAuthProviderIds: (...a) => this.enterpriseOAuthProviderIds(...a),
      getAudience: (...a) => this.getAudience(...a),
      hasPendingInvitationFor: (...a) => this.hasPendingInvitationFor(...a),
      isBootstrapCreation: (...a) => this.isBootstrapCreation(...a),
      isOperatorProvisioning: (...a) => this.isOperatorProvisioning(...a),
      selfRegistrationSetResolvable: (...a) => this.selfRegistrationSetResolvable(...a),
      stageOwnerVerifiedStamp: (...a) => this.stageOwnerVerifiedStamp(...a),
      stageSelfRegistrationGrant: (...a) => this.stageSelfRegistrationGrant(...a),
    };
    return validateAudienceAdmission.call(host, data, ctx);
  }

  /**
   * Zero HUMAN users exist — the first-run owner wizard / seeded admin
   * creating the very first account (a fresh install must never lock its
   * operator out). {@link isHumanUserRow} owns the population predicate and
   * says why it is humans rather than rows. An unanswerable probe reads as
   * NOT bootstrap (gate stays on) — fail closed is deliberate here, which is
   * exactly why the probe must be ANSWERABLE at every seam that asks.
   *
   * ## Why this reads the data engine and not `ctx.context.adapter`
   *
   * The first spelling of this probe was `adapter.findOne({ model: 'user',
   * where: [] })`, copied from the `disableSignUp` bypass below. On the real
   * ObjectQL engine that call does not answer — it THROWS. `where: []` lowers
   * to an empty filter, and `requireFindOnePredicate` (#4419) refuses a
   * `findOne` that selects no particular record rather than hand back an
   * arbitrary row. The `catch` turned that refusal into `false`, so EVERY
   * bootstrap creation read as "not bootstrap" and the `invite_only` default
   * refused the operator's own first account — with the in-memory harness
   * green throughout, because a fake engine has no such guard.
   *
   * So the probe is expressed the way it can actually be answered: a bounded
   * `find` through `withSystemReadContext`, the same ctx-independent data
   * path {@link hasPendingInvitationFor} uses one frame away. `find` carries
   * no #4419 predicate requirement — asking for a PAGE is a well-posed
   * question in a way that asking for an unspecified single row is not.
   */
  private async isBootstrapCreation(): Promise<boolean> {
    const engine = this.config.dataEngine;
    if (!engine || typeof (engine as any).find !== 'function') return false;
    try {
      const reader = withSystemReadContext(engine) as any;
      const rows: any[] = await reader.find(SystemObjectName.USER, {
        limit: AuthManager.BOOTSTRAP_USER_PROBE_LIMIT,
      });
      if (rows.some(isHumanUserRow)) return false;
      // A page that came back FULL of non-human rows cannot prove there is no
      // human on the next page — fail closed rather than guess.
      return rows.length < AuthManager.BOOTSTRAP_USER_PROBE_LIMIT;
    } catch {
      return false;
    }
  }

  /**
   * A pending, unexpired `sys_invitation` row exists for this email.
   *
   * ## Why the address goes into the QUERY rather than into a memory scan
   *
   * The first spelling read `{ status: 'pending' }` with `limit: 200` and
   * matched the address in JS. That is a CEILING, not a bound: past 200
   * concurrently-pending invitations in one environment, an invitee outside
   * the first page was not found, so under the `invite_only` default their
   * registration was refused with `SELF_REGISTRATION_CLOSED` — the invitation
   * lane silently failing for the TAIL of a large rollout, with no signal to
   * the administrator or the invitee. A 500-employee onboarding reaches it.
   *
   * The scan existed to make the match case-insensitive, on the stated belief
   * that invitation addresses are stored as the inviter typed them while
   * better-auth lowercases the registrant's. Measured on the then-installed
   * better-auth 1.7.1, that belief is wrong on BOTH halves — the vendor
   * normalizes each side before this gate ever sees it:
   *
   *  - `organization/invite-member` lowercases `ctx.body.email` and carries
   *    that value into `createInvitation` (and into the resend path), so the
   *    stored `sys_invitation.email` is already the normalized form;
   *  - `internalAdapter.createUser` lowercases `user.email` *before* it calls
   *    `validateUserInfo`, so the address this gate is asked about is already
   *    normalized too.
   *
   * The vendor's own reads agree: `findPendingInvitation`,
   * `listUserInvitations` and `findMemberByEmail` all query with
   * `email.toLowerCase()`. A mixed-case row would therefore be unredeemable
   * by `accept-invitation` and invisible in the invitee's own inbox — the old
   * tolerance admitted a registrant to an invitation they could never accept.
   *
   * So the address is pushed into the query (`sys_invitation.email` carries a
   * declared index) and the page chain is EXHAUSTED. That removes the ceiling
   * without putting a read of the environment's whole pending population on
   * the self-serve sign-up path: a page here is "pending invitations
   * addressed to this one person", which the vendor bounds by refusing a
   * second pending invitation per organization.
   *
   * The JS comparison is KEPT and is not dead. `=` folds case on some
   * collations (MySQL's default) and folds accents with it, so every returned
   * row is re-checked against the normalized target: a case-only difference
   * still matches — identical to the old behaviour on such a store — while an
   * accent-only difference does not, so a folding collation cannot WIDEN what
   * counts as an invitation. Expiry stays in JS for the reason it was there:
   * a row with no readable `expires_at` keeps reading as live, which an
   * `expires_at: { $gt: … }` predicate would silently narrow away.
   *
   * Unanswerable ⇒ no carve-out (fail CLOSED): the `catch` returns false, so
   * the declared posture applies rather than an unverified admission.
   */
  private async hasPendingInvitationFor(email: string): Promise<boolean> {
    const engine = this.config.dataEngine;
    if (!engine || typeof (engine as any).find !== 'function') return false;
    const target = email.trim().toLowerCase();
    if (!target) return false;
    try {
      const reader = withSystemReadContext(engine) as any;
      const nowMs = Date.now();
      const page = AuthManager.PENDING_INVITATION_PROBE_PAGE;
      const seenIds = new Set<unknown>();
      for (let pageIndex = 0; pageIndex < AuthManager.PENDING_INVITATION_PROBE_MAX_PAGES; pageIndex++) {
        const offset = pageIndex * page;
        const rows: any[] = await reader.find('sys_invitation', {
          where: { status: 'pending', email: target },
          limit: page,
          // Omitted on the first page so the ordinary single-page read sends
          // exactly the option shape every driver already answers.
          ...(offset > 0 ? { offset } : {}),
        });
        const idsBefore = seenIds.size;
        for (const row of rows) {
          if (row?.id != null) seenIds.add(row.id);
          const rowEmail = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
          if (rowEmail !== target) continue;
          const expires = row?.expires_at ?? row?.expiresAt;
          if (expires != null) {
            const expMs = new Date(expires as any).getTime();
            if (Number.isFinite(expMs) && expMs <= nowMs) continue;
          }
          return true;
        }
        // Exhausted: a short page is the end of the chain. The second arm is
        // the termination guarantee against a driver that accepts `offset`
        // and ignores it — a page that carried no row id this loop had not
        // already read cannot carry a new answer either, and looping forever
        // on the sign-up path would be worse than the ceiling being removed.
        if (rows.length < page) return false;
        if (seenIds.size === idsBefore && rows.some((r) => r?.id != null)) return false;
      }
      // Unreachable on any real population (that is 10k pending invitations
      // addressed to ONE person). Loud rather than silent: the defect this
      // method closes was a boundary nobody could see from either side.
      this.audienceLogError(
        '[audience] pending-invitation probe hit its page ceiling — the carve-out is being refused '
          + 'without having read every pending invitation for this address.',
        { pages: AuthManager.PENDING_INVITATION_PROBE_MAX_PAGES, pageSize: page },
      );
      return false;
    } catch {
      return false;
    }
  }

  /**
   * [#15587] Does a `sys_user` row already carry this address? Asked on the
   * `/sign-up/email` before-hook so the uniqueness refusal is raised as an
   * explicit 422 instead of being converted into a synthetic 200 by
   * better-auth's anti-enumeration shield — see the call site for the
   * mechanism and for why the question is asked AFTER the audience gate.
   *
   * ## Fail-open here is not fail-open overall
   *
   * An unanswerable probe returns `false` and the request FALLS THROUGH to the
   * vendor, which runs its own `findUserByEmail` and decides. This pre-check
   * only ever NARROWS an answer the vendor was going to give: it can turn a
   * synthetic 200 into the honest 422, and it can never admit a creation the
   * vendor would have refused. That is the opposite of
   * {@link hasPendingInvitationFor}, whose `false` must fail CLOSED because it
   * grants a carve-out — the two neighbours differ on purpose.
   *
   * ## Matching, and why the JS re-check narrows
   *
   * The address is pushed into the query (`sys_user.email` carries a declared
   * index) with a bounded page, and every returned row is re-checked in JS
   * against the normalized target. `=` folds case on some collations (MySQL's
   * default) and folds ACCENTS with it, so the store alone could report a row
   * for an address that is merely accent-adjacent — a refusal nothing
   * justifies. Case-only differences still match, which is correct: the
   * vendor lowercases `user.email` on `createUser`, so a case variant IS the
   * same account. The re-check therefore only ever removes false positives —
   * the safe direction for a rule whose output is a refusal.
   *
   * A page that comes back FULL is not evidence of anything beyond it, but it
   * does not need to be: one matching row is the whole answer, and no row in
   * a full page matching means the store answered a different question than
   * we asked (a driver ignoring the predicate), which falls through to the
   * vendor exactly like an unanswerable probe.
   */
  private async hasExistingUserFor(email: string): Promise<boolean> {
    const engine = this.config.dataEngine;
    if (!engine || typeof (engine as any).find !== 'function') return false;
    const target = email.trim().toLowerCase();
    if (!target) return false;
    try {
      const reader = withSystemReadContext(engine) as any;
      const rows: any[] = await reader.find(SystemObjectName.USER, {
        where: { email: target },
        limit: AuthManager.EXISTING_USER_PROBE_LIMIT,
      });
      return rows.some(
        (row) => typeof row?.email === 'string' && row.email.trim().toLowerCase() === target,
      );
    } catch (error) {
      // The fall-through DIRECTION stays (see above): the vendor runs its own
      // `findUserByEmail` and still decides. What must not stay is the
      // SILENCE. A total engine outage is loud by itself — the vendor's read
      // goes through the same engine and the request answers 500 — but a
      // failure specific to THIS query shape, or a transient one, is answered
      // by the duplicate shield with a synthetic 200, which is #15587 exactly:
      // the defect re-opens with no other signal anywhere. Measured by driving
      // a throw scoped to this probe's own signature: the pre-fix response came
      // back, and nothing named the probe. So the refusal that did not happen
      // says so here, at the same level and through the same facility the
      // sibling probe uses at its page ceiling.
      this.audienceLogError(
        '[audience] the sign-up existing-user probe could not be answered, so the uniqueness '
          + 'refusal was NOT raised for this request — falling through to better-auth, whose '
          + 'duplicate shield answers a synthetic 200 when email verification is forced on. '
          + 'A sign-up for an already-registered address may report success and write nothing.',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return false;
    }
  }

  /**
   * [#25060, ruling 1B on #25040] May a sign-up for an address that already has
   * an account answer like a successful sign-up, instead of the explicit
   * refusal? Asked by the `/sign-up/email` before-hook only once the audience
   * gate admitted the caller and {@link hasExistingUserFor} found the row. All
   * three must hold, and each one that fails keeps today's refusal:
   *
   * 1. **The posture permits self-registration** (`open`, `email_domain`).
   *    `invite_only` is unchanged by the ruling, and so is every other path a
   *    posture admits there.
   * 2. **The vendor's anti-enumeration shield is on** — read off the options
   *    the vendor itself reads for it (`requireEmailVerification` on, or
   *    `autoSignIn` off). Only there is a new sign-up's answer free of a
   *    session, so only there can an existing address get the same shape; and
   *    only there does the vendor call `onExistingUserSignUp`, the mail half.
   *    Under `open` with verification declared off a new sign-up is signed in
   *    at once, and mirroring that would mean a session for someone else's
   *    account. (Where the shield is off the vendor would refuse identically
   *    anyway; the refusal stays ours so it never rests on that.)
   * 3. **Mail is actually delivered** ({@link existingAddressSignUpMailable}).
   *    The ruling's precondition: the success answer is honest only because a
   *    mail follows it, and a success with no mail is the black hole the
   *    refusal replaced.
   *
   * A pure read: nothing is cached, so a posture or transport change between
   * two requests is honoured on the next one.
   */
  private existingAddressSignUpAnswersSuccess(
    vendorEmailAndPassword: { requireEmailVerification?: boolean; autoSignIn?: boolean } | undefined,
  ): boolean {
    const shieldOn =
      vendorEmailAndPassword?.requireEmailVerification === true || vendorEmailAndPassword?.autoSignIn === false;
    return shieldOn && this.existingAddressSignUpMailable();
  }

  /**
   * [#25060] The posture and transport half of
   * {@link existingAddressSignUpAnswersSuccess}, which the mail send asks again
   * on its own: the vendor's hook also fires on the one path that never reached
   * that decision (an unanswerable {@link hasExistingUserFor} falls through to
   * the vendor), and there it must not mail under `invite_only` either.
   */
  private existingAddressSignUpMailable(): boolean {
    return audiencePermitsSelfRegistration(this.getAudience().posture) && this.isEmailDeliveryLive();
  }

  /**
   * [#25060] Is mail sent through the wired email service actually delivered?
   * The one reader of `IEmailService.isConfigured()` — the deliverability fact
   * the contract gives the package that owns the transport (plugin-email
   * answers `false` for its `log` transport in every environment, and follows a
   * transport swapped from the mail settings at runtime). Read at call time,
   * never cached at boot.
   *
   * ⛔ An implementation WITHOUT the member is NOT live: the contract says an
   * absent member is unknown, and the flow asking — a success answer that only
   * a mail makes honest — must fail to its refusal on unknown. Hence not
   * {@link hasEmailTransport} / {@link isEmailServiceAvailable}, which answer
   * "a service object is wired" — true on every default boot, whose transport
   * logs instead of sending. A throwing member is unknown too.
   */
  private isEmailDeliveryLive(): boolean {
    const email = this.getEmailService();
    if (!email || typeof email.isConfigured !== 'function') return false;
    try {
      return email.isConfigured() === true;
    } catch {
      return false;
    }
  }

  /**
   * [#25060, ruling 1B on #25040] Tell the holder of an address that someone
   * tried to sign up with it — the mail that makes the success answer
   * {@link existingAddressSignUpAnswersSuccess} allowed honest. Wired as the
   * vendor's `emailAndPassword.onExistingUserSignUp`, which hands over the
   * existing row.
   *
   * - **Template:** `auth.existing_account_sign_up`, declared beside every
   *   other auth mail in plugin-email's built-in templates (four locales), so a
   *   deployment overrides it the same way.
   * - **Locale:** the recipient's stored `sys_user.locale`, then the deployment
   *   default — ⛔ no request rung: the requester is not the recipient, and an
   *   anonymous caller's browser language must not choose the language of a
   *   mail to someone else (the invitation sends' ladder).
   * - **Links:** the Console's sign-in and forgot-password pages. No token is
   *   minted: a reset link here would be a credential sent because a stranger
   *   asked.
   *
   * ⛔ Never throws. The answer is already decided and the vendor would only
   * log a throw; a send that fails is reported here at error level, once per
   * request, because the caller was told success on the promise of this mail.
   * That residual is the same one a failed verification send leaves for a new
   * address.
   */
  private async sendExistingAccountSignUpNotice(user: { id: string; email: string; name?: string | null }): Promise<void> {
    if (!this.existingAddressSignUpMailable()) return;
    // A placeholder address (a phone-only account) has no mailbox to tell.
    if (!user?.email || isPlaceholderEmail(user.email)) return;
    const email = this.getEmailService();
    if (!email) return;
    try {
      const storedLocale = user.id ? await this.storedRecipientLocale({ id: user.id }) : undefined;
      const result = await email.sendTemplate({
        template: 'auth.existing_account_sign_up',
        to: { address: user.email, ...(user.name ? { name: user.name } : {}) },
        ...this.emailLocaleArg(undefined, storedLocale),
        data: {
          user: { name: user.name || user.email, email: user.email, ...(user.id ? { id: user.id } : {}) },
          signInUrl: this.getConsolePageUrl('/login'),
          resetPasswordUrl: this.getConsolePageUrl('/forgot-password'),
          appName: this.getAppName(),
        },
        relatedObject: 'sys_user',
        ...(user.id ? { relatedId: user.id } : {}),
        // [ADR-0131 D7, Q2 A] A notice to the account holder: identity mail.
        identityMail: true,
      });
      if (result?.status === 'failed') throw new Error(result.error ?? 'delivery failed');
    } catch (error) {
      this.audienceLogError(
        '[auth] a sign-up for an address that already has an account was answered as a success, but '
          + 'the mail telling that account\'s holder could NOT be sent — they will not learn of the attempt, '
          + 'and the person signing up gets no mail pointing them to sign-in or password reset. Check the '
          + 'mail transport (Setup › Mail, "Send test email").',
        { userId: user.id, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * [ADR-0131 D3/D4] The declared set would GRANT: the security catalog holds
   * it and the activation ledger does not switch it off — the resolver's own
   * reading ({@link permissionSetInEffect}). The grant names the set by name
   * ({@link settleSelfRegistrationGrant}), so no `sys_permission_set` row is
   * read. A read that fails answers `false`: the admission refuses.
   */
  private async selfRegistrationSetResolvable(setName: string): Promise<boolean> {
    const engine = this.config.dataEngine;
    if (!engine || typeof (engine as any).find !== 'function') return false;
    try {
      const reader = withSystemReadContext(engine) as any;
      return await permissionSetInEffect(engine, (object, query) => reader.find(object, query), setName);
    } catch {
      return false;
    }
  }

  /** [#12751] Stage the owner-verified stamp for the address being created. */
  private stageOwnerVerifiedStamp(email: string): void {
    this.prunePendingOwnerVerifiedStamps();
    this.pendingOwnerVerifiedStamps.set(email.trim().toLowerCase(), { stagedAtMs: Date.now() });
  }

  /**
   * [#12751] Consume the staged stamp for this address — one shot: the entry
   * is deleted on read, so exactly one creation can be born verified per
   * admission, and nothing survives for any later write to inherit.
   */
  private takeOwnerVerifiedStamp(email: string): boolean {
    this.prunePendingOwnerVerifiedStamps();
    const key = email.trim().toLowerCase();
    if (!this.pendingOwnerVerifiedStamps.has(key)) return false;
    this.pendingOwnerVerifiedStamps.delete(key);
    return true;
  }

  private prunePendingOwnerVerifiedStamps(): void {
    const cutoff = Date.now() - AuthManager.OWNER_STAMP_STAGE_TTL_MS;
    for (const [key, value] of this.pendingOwnerVerifiedStamps) {
      if (value.stagedAtMs < cutoff) this.pendingOwnerVerifiedStamps.delete(key);
    }
  }

  /**
   * [#14157] Declare that the deployment's own boot command is provisioning
   * this address right now, so its creation is judged as the **operator**
   * class it actually is rather than as a self-registration.
   *
   * ## Why this exists instead of widening the bootstrap probe
   *
   * The dev-admin seed provisions through the real `signUpEmail` pipeline (it
   * must: that is what produces a hashed credential and runs the sign-up
   * hooks), and until now its admission rode on
   * {@link isBootstrapCreation} — "zero HUMAN users". That is a **public
   * self-registration carve-out**: it is what lets an unknown visitor's first
   * sign-up through under `invite_only`. Its population predicate therefore
   * has to keep counting humans, because the population it is protecting
   * against is humans.
   *
   * The seed's precondition is a different question — "does a LOGIN exist?"
   * (`dev-admin-seed-gate.ts`) — and #14157 is what happens when the two are
   * conflated: an app that seeds people in `defineStack({ data })` makes the
   * database non-zero-user before the seed runs, and the dev admin is never
   * minted. Fixing only the seed's own gate does not help, because the
   * admission still refuses: **measured**, with 13 seeded people and zero
   * accounts, `api.signUpEmail` comes back `SELF_REGISTRATION_CLOSED` under
   * the default `invite_only` posture.
   *
   * So the seed says what it *is* instead of inferring admission from a
   * population it does not own. That is the same claim
   * `walled-owner-operator-stamp.ts` already makes about this account —
   * "provisioned by the deployment's own boot command with operator-known
   * credentials" — and it moves no public door: nothing outside this process
   * can stage a ticket, the only caller is hard-gated to
   * `NODE_ENV==='development'`, the ticket names ONE address, the caller
   * clears it in a `finally`, and anything that outlives that is pruned by
   * {@link OPERATOR_PROVISIONING_STAGE_TTL_MS}.
   *
   * ## [#14373] Why the address alone stopped being the whole ticket
   *
   * The address is **not a secret**: `admin@objectos.ai` is the documented
   * default and the boot banner prints it (with the password) once the seed
   * completes. "The address is the operator's own" is true but does not
   * narrow the attacker set the way it would for an unguessable value — a
   * stranger's OWN concurrent `POST /sign-up/email` for that same address,
   * arriving while this ticket is staged, would satisfy an email-only peek at
   * BOTH admission seams and get admitted as `operator` class: past the
   * `disableSignUp` bypass, and (since the stamp only cares about the
   * creation class) potentially email-verified at creation too — a stranger
   * would not merely read as the operator, their row would BECOME the
   * account at that address, since a unique-email constraint lets only one of
   * the two concurrent `signUpEmail` calls actually land. Milliseconds and
   * `NODE_ENV==='development'` are true today, but both are properties of the
   * *caller*, not of what the ticket asserts.
   *
   * So the ticket now also carries a random, unguessable `ticket` string,
   * returned here and threaded by the caller into the SAME `signUpEmail`
   * call's body under {@link OPERATOR_PROVISIONING_TICKET_FIELD} — see
   * `AuthPlugin.maybeSeedDevAdmin`. {@link isOperatorProvisioning} requires an
   * exact match on both email AND this ticket, so admission now asks "did
   * THIS process's own boot command make THIS exact call" rather than "does
   * the address match" — a stranger's request, however precisely it times
   * the window, carries no value that was ever transmitted anywhere for them
   * to replay. Not a stronger *guess* — a different question.
   */
  stageOperatorProvisioning(email: string): string {
    this.prunePendingOperatorProvisioning();
    const ticket = this.generateOperatorProvisioningTicket();
    this.pendingOperatorProvisioning.set(email.trim().toLowerCase(), { stagedAtMs: Date.now(), ticket });
    return ticket;
  }

  /** [#14157] Drop the ticket staged by {@link stageOperatorProvisioning}. */
  clearOperatorProvisioning(email: string): void {
    this.pendingOperatorProvisioning.delete(email.trim().toLowerCase());
  }

  /**
   * [#14373] 128 bits from WebCrypto, hex-encoded — same `getRandomValues`
   * baseline `resolvePasswordHasher`'s WebContainer salt uses, so this stays
   * portable to hosts without `node:crypto`. Never persisted, never logged,
   * never sent anywhere but the one in-process `signUpEmail` body call that
   * consumes it.
   */
  private generateOperatorProvisioningTicket(): string {
    const bytes = (globalThis as any).crypto.getRandomValues(new Uint8Array(16));
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  /**
   * [#14157] Is this address being provisioned by the deployment's own boot
   * command? A PEEK, not a consume: both admission seams (the `disableSignUp`
   * bypass and `validateAudienceAdmission`) ask about the same single
   * creation, so a one-shot read here would admit at the first seam and refuse
   * at the second. The ticket's lifetime is bounded by its owner's `finally`
   * and by the TTL instead.
   *
   * [#14373] `ticket` is REQUIRED to match the value {@link
   * stageOperatorProvisioning} returned — see that method's doc for why the
   * address alone is no longer sufficient. A missing, wrong-typed, or
   * mismatched ticket reads as "not provisioning", the same as no ticket at
   * all; there is no email-only fallback path.
   */
  isOperatorProvisioning(email: unknown, ticket?: unknown): boolean {
    if (typeof email !== 'string' || email.trim() === '') return false;
    this.prunePendingOperatorProvisioning();
    const entry = this.pendingOperatorProvisioning.get(email.trim().toLowerCase());
    if (!entry) return false;
    return typeof ticket === 'string' && ticket === entry.ticket;
  }

  private prunePendingOperatorProvisioning(): void {
    const cutoff = Date.now() - AuthManager.OPERATOR_PROVISIONING_STAGE_TTL_MS;
    for (const [key, value] of this.pendingOperatorProvisioning) {
      if (value.stagedAtMs < cutoff) this.pendingOperatorProvisioning.delete(key);
    }
  }

  /**
   * [#14157] The bootstrap window, as a PUBLIC read — "can a first-run owner
   * still be created here?".
   *
   * `GET /auth/bootstrap-status` answers the console's first-run routing
   * question, and it used to answer it by counting `sys_user` rows, which
   * makes it the one call site that disagrees with the three
   * {@link isHumanUserRow} consumers: on a database still carrying the legacy
   * `usr_system` service row it reports an owner while the audience gate and
   * plugin-security's first-user detection both say the first human is still
   * ahead — i.e. the console withholds the setup flow that the platform is
   * standing ready to admit and promote. Reading THIS method keeps the console
   * from ever offering a first-run creation the admission gate would refuse,
   * and from ever hiding one it would allow.
   *
   * Never throws; an unanswerable probe reads as "no window" — the same
   * fail-closed direction the admission gate takes, and the same answer the
   * route's own catch produced.
   */
  async hasBootstrapWindow(): Promise<boolean> {
    return this.isBootstrapCreation();
  }

  private stageSelfRegistrationGrant(email: string, setName: string): void {
    this.prunePendingSelfRegistrationGrants();
    this.pendingSelfRegistrationGrants.set(email.trim().toLowerCase(), {
      setName,
      stagedAtMs: Date.now(),
    });
  }

  private prunePendingSelfRegistrationGrants(): void {
    const cutoff = Date.now() - AuthManager.SELF_REG_GRANT_STAGE_TTL_MS;
    for (const [key, value] of this.pendingSelfRegistrationGrants) {
      if (value.stagedAtMs < cutoff) this.pendingSelfRegistrationGrants.delete(key);
    }
  }

  /**
   * [ADR-0131 D3/D9 — the self-registration grant settles on the first
   * membership] The `user.create.after` half of an admitted self-registration.
   * The grant is an organization row (D3), so it is written WITH a membership,
   * owned by that membership's organization, under every posture:
   *
   *  - the registrant already holds one (`single`, where the reconciler bound
   *    the Default Organization a moment earlier in the same hook, or a host
   *    hook that provisioned a personal organization first) → the grant lands
   *    now, owned by it;
   *  - it holds none (a wall: the registrant joins or creates an organization
   *    later, possibly days and restarts later) → the grant is PERSISTED as a
   *    pending claim ({@link persistSelfRegistrationGrantClaim}) and lands when
   *    the first `sys_member` row for the user is written
   *    ({@link settleDeferredSelfRegistrationGrant}). Nothing is written to
   *    `sys_user_permission_set` without an organization.
   *
   * A failure here is reported at the DURABILITY level (`error` when the sink
   * carries it): the system keeps looking normal from the outside while a
   * grant the configuration claims has not landed — the declared≠enforced
   * state #11739 exists to close. The consequence and the fix ride the first
   * line.
   */
  private async settleSelfRegistrationGrant(user: any): Promise<void> {
    let staged: { setName: string; stagedAtMs: number } | undefined;
    try {
      const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
      const userId = typeof user?.id === 'string' ? user.id : '';
      if (!email || !userId) return;
      this.prunePendingSelfRegistrationGrants();
      staged = this.pendingSelfRegistrationGrants.get(email);
      if (!staged) return;
      this.pendingSelfRegistrationGrants.delete(email);
      const engine = this.config.dataEngine;
      if (!engine) {
        this.reportUngrantedSelfRegistrant(userId, staged.setName, 'no data engine is available');
        return;
      }
      const sys = withSystemReadContext(engine) as any;
      // A user created moments ago holds at most the one membership its own
      // creation bound, so the first row found is THE first membership.
      const memberships: any[] = await sys.find('sys_member', { where: { user_id: userId }, limit: 1 });
      const organizationId = memberships[0]?.organization_id;
      if (typeof organizationId === 'string' && organizationId) {
        await this.landSelfRegistrationGrant(engine, userId, staged.setName, organizationId);
        return;
      }
      await this.persistSelfRegistrationGrantClaim(engine, userId, staged.setName);
    } catch (error) {
      this.reportUngrantedSelfRegistrant(
        typeof user?.id === 'string' ? user.id : '(unknown)',
        staged?.setName ?? '(unknown)',
        (error as Error)?.message ?? String(error),
      );
    }
  }

  /**
   * Write the self-registration grant, owned by `organizationId` — the
   * organization of the membership it travels with. Idempotent: a grant the
   * user already holds naming this set settles the question.
   *
   * [ADR-0131 D3/D4] The grant names the declared set BY NAME — the name
   * admission asked the security catalog and the activation ledger about — so
   * no `sys_permission_set` row is read to write it, and none needs to exist.
   * Already held? Asked by the same name, in any organization: the grant is
   * the self-registrant's one declared set, so a second membership (or a
   * replayed claim) writes no second grant.
   */
  private landSelfRegistrationGrant(
    engine: unknown,
    userId: string,
    setName: string,
    organizationId: string,
  ): Promise<void> {
    // [#25224 cut 8] The body moved to `auth-manager-membership-admission.ts` (see `MembershipAdmissionHost`).
    const readConfig = () => this.config;
    const host: Pick<MembershipAdmissionHost, 'config'> = {
      get config() { return readConfig(); },
    };
    return landSelfRegistrationGrant.call(host, engine, userId, setName, organizationId);
  }

  /**
   * The `identifier` prefix of a pending self-registration grant claim — a
   * `sys_verification` row whose identifier is this prefix plus the user id
   * and whose `value` is the declared set's name.
   *
   * Why `sys_verification`, and not a new object or a column: it is the auth
   * layer's existing store of one-shot claims keyed on an identifier with an
   * expiry (reset tokens, OTPs, magic links), it survives a restart, and it is
   * deployment-level — no organization column (ADR-0131 D1, fate 1), so a
   * claim held before any organization exists is not an organization-less
   * tenant row. Nothing the user row or account records tells a self-registrant
   * apart from an invited, operator-created or bootstrap user (admission
   * decides that from the request, not from stored state), so the claim is the
   * one persisted fact that does.
   */
  private static readonly SELF_REG_GRANT_CLAIM_PREFIX = 'self-registration-grant:';

  /**
   * How long a pending claim waits for the first membership. better-auth's
   * own verification cleanup deletes expired rows, and an expired claim is
   * never honoured, so a registrant who first joins an organization after
   * this window holds only the deployment's baseline.
   */
  private static readonly SELF_REG_GRANT_CLAIM_TTL_MS = 365 * 24 * 60 * 60 * 1000;

  /**
   * Persist the pending grant for a registrant who belongs to no organization
   * yet. Refused (reported, nothing written) when the engine offers no
   * middleware seam: the claim could never settle there, and a claim nothing
   * will consume is the declared≠enforced state this path closes.
   */
  private async persistSelfRegistrationGrantClaim(engine: unknown, userId: string, setName: string): Promise<void> {
    if (!AuthManager.firstMembershipObservedEngines.has(engine as object)) {
      this.reportUngrantedSelfRegistrant(
        userId,
        setName,
        'the user belongs to no organization yet and the data engine offers no middleware seam on which the ' +
          'first membership could settle the grant',
      );
      return;
    }
    const sys = withSystemReadContext(engine as never) as any;
    await sys.insert(
      'sys_verification',
      {
        id: `ver_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        identifier: `${AuthManager.SELF_REG_GRANT_CLAIM_PREFIX}${userId}`,
        value: setName,
        expires_at: new Date(Date.now() + AuthManager.SELF_REG_GRANT_CLAIM_TTL_MS),
      },
      { context: { isSystem: true } },
    );
    this.config.logger?.info?.(
      '[audience] the self-registrant belongs to no organization yet — the declared permission set is granted ' +
        'with their first membership',
      { userId, permissionSet: setName },
    );
  }

  /** The engines whose `sys_member` inserts {@link observeFirstMemberships} watches. */
  private static readonly firstMembershipObservedEngines = new WeakSet<object>();

  /**
   * Register, once per engine, the middleware that settles a pending
   * self-registration grant when a `sys_member` row is written. A data-layer
   * seam rather than one hook per membership path, because the first
   * membership arrives through several writers — better-auth's organization
   * create (the creator as owner) and invitation acceptance, its server-side
   * add-member, the membership reconciler, the Default Organization bootstrap
   * and host hooks — and every one of them inserts through this engine.
   */
  private observeFirstMemberships(engine: unknown): void {
    if (!engine || typeof engine !== 'object') return;
    const register = (engine as { registerMiddleware?: unknown }).registerMiddleware;
    if (typeof register !== 'function') return;
    if (AuthManager.firstMembershipObservedEngines.has(engine)) return;
    try {
      (register as (fn: (opCtx: any, next: () => Promise<void>) => Promise<void>) => void).call(
        engine,
        async (opCtx: any, next: () => Promise<void>) => {
          await next();
          if (opCtx?.object !== 'sys_member') return;
          if (opCtx?.operation !== 'insert' && opCtx?.operation !== 'create') return;
          const written = opCtx?.result ?? opCtx?.data;
          for (const row of Array.isArray(written) ? written : [written]) {
            const userId = row?.user_id;
            const organizationId = row?.organization_id;
            if (typeof userId !== 'string' || !userId) continue;
            if (typeof organizationId !== 'string' || !organizationId) continue;
            await this.settleDeferredSelfRegistrationGrant(engine, userId, organizationId);
          }
        },
      );
      AuthManager.firstMembershipObservedEngines.add(engine);
    } catch {
      // An engine that refuses the registration has no seam: a registrant with
      // no organization is then reported ungranted at sign-up, never parked.
    }
  }

  /**
   * Land a pending self-registration grant on the user's first membership,
   * owned by that membership's organization. The claim is CONSUMED before the
   * grant is written — read, deleted by id, then acted on — so it is honoured
   * once; a later membership finds no claim and writes no second grant.
   */
  private async settleDeferredSelfRegistrationGrant(
    engine: unknown,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    let setName: string | undefined;
    try {
      const sys = withSystemReadContext(engine as never) as any;
      const claims: any[] = await sys.find('sys_verification', {
        where: {
          identifier: `${AuthManager.SELF_REG_GRANT_CLAIM_PREFIX}${userId}`,
          expires_at: { $gt: new Date() },
        },
        limit: 1,
      });
      const claim = claims[0];
      if (!claim?.id) return;
      // `value` is `internal: true`: the engine's read path strips it, so it is
      // recovered through the privileged accessor (`internal-field-readback.ts`).
      await recoverInternalFieldsForSystemRead(engine as never, 'sys_verification', claim, ['value']);
      await sys.delete('sys_verification', { where: { id: claim.id }, context: { isSystem: true } });
      setName = typeof claim.value === 'string' && claim.value ? claim.value : undefined;
      if (!setName) {
        this.reportUngrantedSelfRegistrant(userId, '(unreadable)', 'the pending grant claim carries no set name');
        return;
      }
      await this.landSelfRegistrationGrant(engine, userId, setName, organizationId);
    } catch (error) {
      this.reportUngrantedSelfRegistrant(userId, setName ?? '(unknown)', (error as Error)?.message ?? String(error));
    }
  }

  private reportUngrantedSelfRegistrant(userId: string, setName: string, cause: string): void {
    // [#25224 cut 8] The body moved to `auth-manager-membership-admission.ts` (see `MembershipAdmissionHost`).
    const host: Pick<MembershipAdmissionHost, 'audienceLogError'> = {
      audienceLogError: (...a) => this.audienceLogError(...a),
    };
    return reportUngrantedSelfRegistrant.call(host, userId, setName, cause);
  }

  /**
   * Inject (or replace) the outbound email service used by better-auth
   * callbacks. Safe to call after construction but BEFORE the first
   * request hits the auth handler — callbacks read this via
   * {@link getEmailService} when invoked.
   *
   * AuthPlugin calls this on `kernel:ready` once `ctx.getService('email')`
   * resolves. For tests / serverless, callers may invoke directly.
   */
  setEmailService(email: IEmailService | undefined): void {
    this.config.emailService = email;
  }

  /** @internal Used by callback closures. */
  private getEmailService(): IEmailService | undefined {
    return this.config.emailService;
  }

  /**
   * [commit bf8d129b5] Whether an outbound email transport is wired RIGHT NOW.
   *
   * The one public read of the fact every verification link depends on: with
   * no transport the `sendVerificationEmail` callback has nowhere to send, so
   * an address can only ever become verified through a federated sign-in. The
   * boot check in `walled-owner-verification-path.ts` asks this rather than
   * re-deriving it from config, because the transport can arrive two ways —
   * host-supplied at construction, or injected on `kernel:ready` once the
   * kernel `email` service resolves — and only this object sees both.
   */
  public hasEmailTransport(): boolean {
    return !!this.config.emailService;
  }

  /**
   * #8019 — mail the address a change-email request would move the account
   * AWAY from. Maintainer ruling 2026-08-12: 「notify the OLD address — do not
   * gate on it」.
   *
   * ⛔ **This method must never throw, and must never be awaited for its
   * effect on the flow.** It is the "do not gate" half of the ruling, and the
   * enforcement lives right here: every failure — no transport wired, template
   * not seeded, SMTP down, a `status: 'failed'` delivery — is swallowed. The
   * sibling auth callbacks above do the opposite ON PURPOSE (a verification
   * mail that cannot be sent must surface, or the user is stuck on a verify
   * screen forever); this one is a notification about a change that proceeds
   * either way, so letting it raise would convert the notice into exactly the
   * blocking step the ruling refuses.
   *
   * ⛔ No undo/rollback link is passed, and the template declares no hole for
   * one: a one-click revert is a separate flow and a separate decision.
   *
   * The locale is named through the #14319 ladder: the caller's own
   * `Accept-Language` first ({@link authEmailLocaleFromRequest}), then the
   * deployment default (#8195, {@link setDefaultEmailLocale}). The request rung
   * is legitimate here precisely because the recipient IS the caller — this
   * notice goes to the account's CURRENT address, i.e. to the person who just
   * asked to change it. With neither rung answering, the argument is omitted
   * entirely and `EmailService`'s ladder resolves its documented `en-US`
   * default exactly as before.
   *
   * Commit 35e94c96b layered the per-recipient stored preference on TOP of both rungs:
   * `sys_user.locale` (#13881, ruling 2026-09-01) when the account holds one,
   * then this request's `Accept-Language`, then the deployment default. The
   * request rung did not lose its argument — it is still what answers for an
   * account with no stored column — it lost the tie, per the #14788 option-D
   * ruling of 2026-09-03. (#14641 then gave the invitation sends the SAME top
   * rung, on the address / phone number rather than a user id — an invitee who
   * ALREADY holds a row gets their own language, and only a genuinely new
   * invitee still takes the deployment default.)
   */
  private sendChangeEmailNotice(
    from: { email: string; name?: string; id?: string },
    newEmail: string,
    requestSource?: unknown,
  ): Promise<void> {
    // [#25224 cut 5] The body moved to `auth-manager-email-sms-delivery.ts` (see `EmailSmsDeliveryHost`).
    const readConfig = () => this.config;
    const host: Pick<EmailSmsDeliveryHost, 'config' | 'emailLocaleArg' | 'getAppName' | 'getEmailService' | 'storedRecipientLocale'> = {
      get config() { return readConfig(); },
      emailLocaleArg: (...a) => this.emailLocaleArg(...a),
      getAppName: (...a) => this.getAppName(...a),
      getEmailService: (...a) => this.getEmailService(...a),
      storedRecipientLocale: (...a) => this.storedRecipientLocale(...a),
    };
    return sendChangeEmailNotice.call(host, from, newEmail, requestSource);
  }

  /**
   * Inject (or replace) the outbound SMS service used by the phone-number
   * OTP callbacks and the SMS invite path (#2780). Mirrors
   * {@link setEmailService}: resolved lazily per send, so it is safe to set
   * after construction — AuthPlugin wires it on `kernel:ready` once
   * `ctx.getService('sms')` (service-sms) resolves.
   */
  setSmsService(sms: ISmsService | undefined): void {
    this.config.smsService = sms;
  }

  /** @internal Used by callback closures. */
  private getSmsService(): ISmsService | undefined {
    return this.config.smsService;
  }

  /** Lazy per-number OTP send guard (#2780) — see otp-send-guard.ts. */
  private _otpSendGuard?: OtpSendGuard;
  private getOtpSendGuard(): OtpSendGuard {
    // [#25224 cut 5] The body moved to `auth-manager-email-sms-delivery.ts` (see `EmailSmsDeliveryHost`).
    const readOtpSendGuard = () => this._otpSendGuard;
    const writeOtpSendGuard = (v: AuthManager['_otpSendGuard']) => { this._otpSendGuard = v; };
    const readConfig = () => this.config;
    const host: Pick<EmailSmsDeliveryHost, '_otpSendGuard' | 'config'> = {
      get _otpSendGuard() { return readOtpSendGuard(); },
      set _otpSendGuard(v) { writeOtpSendGuard(v); },
      get config() { return readConfig(); },
    };
    return getOtpSendGuard.call(host);
  }

  /**
   * #2780 — admission check for the OTP send endpoints, called from the
   * `hooks.before` middleware (see the `/phone-number/*` branch there for
   * why it cannot live in the `sendOTP` callback). Consumes one unit of the
   * per-number budget and throws TOO_MANY_REQUESTS when the cooldown /
   * hourly cap is exhausted. No-op while OTP is undeliverable — the send
   * callback then fails loudly with 400 SMS_SERVICE_REQUIRED instead.
   */
  assertPhoneOtpSendAllowed(phone: string): Promise<void> {
    // [#25224 cut 5] The body moved to `auth-manager-email-sms-delivery.ts` (see `EmailSmsDeliveryHost`).
    const host: Pick<EmailSmsDeliveryHost, 'getOtpSendGuard' | 'isPhoneOtpDeliverable'> = {
      getOtpSendGuard: (...a) => this.getOtpSendGuard(...a),
      isPhoneOtpDeliverable: (...a) => this.isPhoneOtpDeliverable(...a),
    };
    return assertPhoneOtpSendAllowed.call(host, phone);
  }

  /**
   * #2780 — deliver a phone OTP through the SMS service.
   *
   * Security posture (all named requirements of #2780):
   *  - No deliverable SMS service ⇒ throw a 400 `SMS_SERVICE_REQUIRED`
   *    `APIError` (loud, and a status the caller can branch on).
   *  - The per-number cooldown + hourly cap live in the `hooks.before`
   *    admission check, NOT here: better-auth stores the fresh code before
   *    invoking this callback, so a rejection at this point would still
   *    rotate (invalidate) the previously delivered code — letting a
   *    blocked resend or an endpoint-spamming attacker void a user's valid
   *    OTP. See the `/phone-number/*` branch in `hooks.before`.
   *  - The code is embedded in the message body ONLY — it must never reach
   *    a log line or an error message (the SmsService logs masked numbers
   *    and statuses, never bodies).
   */
  private deliverPhoneOtp(phone: string, code: string): Promise<void> {
    // [#25224 cut 5] The body moved to `auth-manager-email-sms-delivery.ts` (see `EmailSmsDeliveryHost`).
    const readConfig = () => this.config;
    const host: Pick<EmailSmsDeliveryHost, 'config' | 'getAppName' | 'getSmsService' | 'isPhoneOtpDeliverable' | 'renderPhoneSmsBody' | 'storedRecipientLocale'> = {
      get config() { return readConfig(); },
      getAppName: (...a) => this.getAppName(...a),
      getSmsService: (...a) => this.getSmsService(...a),
      isPhoneOtpDeliverable: (...a) => this.isPhoneOtpDeliverable(...a),
      renderPhoneSmsBody: (...a) => this.renderPhoneSmsBody(...a),
      storedRecipientLocale: (...a) => this.storedRecipientLocale(...a),
    };
    return deliverPhoneOtp.call(host, phone, code);
  }

  /**
   * #2780 — send the SMS variant of an import invitation: the account
   * exists (placeholder email, phone identity) and the user should sign in
   * with a verification code, then set a password. Carries NO credential —
   * the OTP is requested by the user themself at the sign-in page.
   *
   * Throws when no SMS service is wired (callers gate on
   * {@link isSmsServiceAvailable} first).
   */
  sendPhoneInviteSms(phone: string): Promise<void> {
    // [#25224 cut 5] The body moved to `auth-manager-email-sms-delivery.ts` (see `EmailSmsDeliveryHost`).
    const host: Pick<EmailSmsDeliveryHost, 'getAppName' | 'getCanonicalOrigin' | 'getConsolePageUrl' | 'getSmsService' | 'renderPhoneSmsBody' | 'storedRecipientLocale'> = {
      getAppName: (...a) => this.getAppName(...a),
      getCanonicalOrigin: (...a) => this.getCanonicalOrigin(...a),
      getConsolePageUrl: (...a) => this.getConsolePageUrl(...a),
      getSmsService: (...a) => this.getSmsService(...a),
      renderPhoneSmsBody: (...a) => this.renderPhoneSmsBody(...a),
      storedRecipientLocale: (...a) => this.storedRecipientLocale(...a),
    };
    return sendPhoneInviteSms.call(host, phone);
  }

  /**
   * #2815 — the deployment-default locale for auth SMS bodies, sourced from
   * the live `localization.locale` setting. AuthPlugin pushes it on
   * `kernel:ready` and on every settings change (same pattern as
   * {@link setAppName}). Unset ⇒ the built-in English text.
   *
   * Commit 35e94c96b — this is now the SECOND rung, not the whole answer. The OTP send
   * reads the recipient's own `sys_user.locale` first (#13881, ruling
   * 2026-09-01, the same column the messaging channels resolve per recipient)
   * and falls here when the account holds none. #14641 gave the SMS INVITE
   * path the same rung, matched on `phone_number` — though the one in-repo
   * caller (identity import) creates a row that never carries a `locale`, so
   * that flow still lands HERE in practice. This rung answers when the
   * number resolves no row, or the row names no language.
   */
  setDefaultSmsLocale(locale: string | undefined): void {
    this.smsLocale = locale?.trim() || undefined;
  }
  private smsLocale?: string;

  /**
   * #8195 — the deployment-default locale named on every auth **email**, so the
   * localized `sys_email_template` rows can be selected at all.
   *
   * This is the SECOND rung of a two-rung ladder, not the whole of it. The
   * request's own `Accept-Language` outranks it — see
   * {@link authEmailLocaleFromRequest}, which carries the operative ruling.
   * What lands here is the deployment's declaration, used when the request
   * asked for nothing this platform ships a row for, or when there is no
   * request at all (invitations, scheduled and admin-initiated mail).
   *
   * The deployment's declaration has two producers of its own (#14591): the
   * workspace's `localization.locale` (ADR-0053) whenever the operator has
   * explicitly set one, and `II18nService.getDefaultLocale()` — the app
   * artifact's build-time `i18n.defaultLocale` — standing underneath it. Email
   * read only the build-time half before, so a workspace that switched to
   * Chinese in Setup received Chinese auth SMS and English auth mail. That
   * precedence is resolved in `AuthPlugin`; this setter stays a plain sink for
   * whichever of the two won, and the request rung is applied above it at send
   * time.
   *
   * AuthPlugin pushes the value on `kernel:ready`, exactly as it pushes
   * {@link setDefaultSmsLocale}. Unset ⇒ nothing is named and `EmailService`'s
   * ladder resolves its documented `en-US` default.
   *
   * ⚠️ Ruling history, because this rung used to be the ONLY one. The
   * 2026-08-13 ruling made the deployment default the whole answer and
   * REJECTED `Accept-Language` outright, reasoning that auth mail is
   * frequently sent outside the triggering request — invitations,
   * admin-initiated resets — so a per-device header was the wrong authority
   * for it. **That ruling was superseded on 2026-09-02** (#14319): cloud
   * self-service signup has no workspace yet, so no deployment default can
   * represent that user at all, and English mail to a Chinese signup was the
   * measured result. The 2026-08-13 reasoning did not simply lose — it is why
   * the request rung applies only where the requester IS the recipient, and
   * why the invitation send below still reads this rung.
   *
   * Per-user locale EXISTS since #13881 (maintainer ruling 2026-09-01):
   * `sys_user.locale`, resolved per recipient by service-messaging for
   * notification mail (`recipient-locale.ts`). Commit 35e94c96b layered it on top of
   * this ladder for the sends that hold a recipient row — reset, verification
   * and the change-email notice — so the order is stored → request → this
   * rung, per the #14788 option-D ruling of 2026-09-03. Nothing here changed:
   * this is still what answers when neither rung above names a locale, which
   * is every send to an account that never set one. #14641 then reached the
   * invitation send too — but only through the STORED rung, matched on the
   * invitee's address: an invitation to an address with no `sys_user` row (the
   * common case) still reads exactly this rung, and the inviter's
   * `Accept-Language` remains rejected on that send.
   */
  setDefaultEmailLocale(locale: string | undefined): void {
    this.emailLocale = normalizeAuthEmailLocale(locale);
  }
  private emailLocale?: string;

  /**
   * Commit 35e94c96b — the ladder's TOP rung: the recipient's own `sys_user.locale`,
   * read best-effort off the identity row.
   *
   * Returns `undefined` for every shape that cannot name a language — no data
   * engine, no matching row, an unset column, or a value
   * {@link normalizeRecipientLocale} refuses. ⛔ It must never throw and must
   * never be the reason a send fails: a language is a courtesy, delivery is
   * not, and every caller below layers the remaining rungs underneath. That is
   * the same posture `service-messaging`'s email channel takes on the
   * notification path (`email-channel.ts` retries address-only and warns), and
   * the ruling's item 3 — no path may dead-letter because of the locale read.
   *
   * The read is one row on an indexed predicate, projected to the single
   * column, under a system context — the recipient's own language must resolve
   * regardless of who triggered the send, which is exactly the
   * admin-initiated case commit 35e94c96b fixed, and the INVITER-triggered case
   * #14641 added. Three predicates, one per caller shape: `sys_user.id` (the
   * sends that hold a user row), the unique `phone_number` (the SMS sends,
   * which are handed a number and nothing else), and the unique `email` (the
   * two sends handed an address for an account that may not exist yet — the
   * invitation since #14641 and the magic link since #15106). All three are
   * `unique: true` in the better-auth `user` table this object is backed by
   * (`@better-auth/core` `db/get-tables.mjs`).
   */
  private storedRecipientLocale(where: Record<string, unknown>): Promise<string | undefined> {
    // [#25224 cut 5] The body moved to `auth-manager-email-sms-delivery.ts` (see `EmailSmsDeliveryHost`).
    const host: Pick<EmailSmsDeliveryHost, 'getDataEngine'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
    };
    return storedRecipientLocale.call(host, where);
  }

  /**
   * The `locale` fragment spread into every auth `sendTemplate` call.
   *
   * Spread-when-set rather than always-passed: an explicit `locale: undefined`
   * and an absent key travel the same path today, but only the absent key is
   * what the ladder's "no locale means the DOCUMENTED default" contract is
   * written against.
   *
   * Commit 35e94c96b — three rungs now, in the order ruled for #14788 on 2026-09-03
   * (option D): the recipient's own **stored** `sys_user.locale` → the
   * **request**'s `Accept-Language` (#14319) → the **deployment** default
   * (#8195). The recorded reasoning is that a value the user chose is stronger
   * evidence of intent than the `Accept-Language` the browser just sent — and
   * the case that forces the order is the send where the requester is NOT the
   * recipient (an admin-initiated password reset), where the request rung
   * carries the *admin's* browser language onto the *user's* mail.
   *
   * `storedLocale` arrives already through {@link normalizeRecipientLocale}
   * (see {@link storedRecipientLocale}); {@link normalizeAuthEmailLocale} then
   * maps it onto the row spelling, exactly as the deployment rung is mapped.
   * Deliberately NOT the narrower `authEmailLocaleFromRequest` treatment, which
   * requires a hit in `AUTH_EMAIL_TEMPLATE_LOCALES`: that narrowing exists
   * because "a per-request header is a weaker claim than a deployment's
   * declaration", and a column the user set for themselves is not the weak
   * claim — a tenant overlaying `en-GB` rows must be able to ask for them.
   *
   * A caller with no recipient row in hand passes nothing and gets exactly the
   * two-rung #14319 behaviour.
   */
  private emailLocaleArg(requestSource?: unknown, storedLocale?: string): { locale?: string } {
    const locale =
      normalizeAuthEmailLocale(storedLocale) ??
      authEmailLocaleFromRequest(requestSource) ??
      this.emailLocale;
    return locale ? { locale } : {};
  }

  /**
   * #2815 — resolve an auth SMS body: the tenant's
   * `sys_notification_template` row for `(topic, 'sms', locale chain)` when
   * one exists, else the built-in bilingual text. Template lookups are
   * best-effort — an outage must never block an OTP send.
   *
   * Commit 35e94c96b — `storedLocale` is the recipient's own `sys_user.locale` when the
   * caller could resolve one ({@link storedRecipientLocale}); the deployment
   * default stands underneath it. There is NO request rung on this surface:
   * the ruled ladder's middle rung is the request's `Accept-Language`, and an
   * SMS body is chosen at delivery time from a phone number — the send-OTP
   * route hands the callback `{ phoneNumber, code }` and nothing else
   * (measured against the installed better-auth 1.7.x, not assumed). So the
   * ruled chain collapses here to stored → deployment, with the built-in `en`
   * row as {@link phoneSmsLocaleChain}'s terminal floor exactly as before.
   *
   * A caller that passes nothing — or one whose recipient resolves no row —
   * gets exactly the deployment default, as before commit 35e94c96b. #14641 made the
   * SMS invite path a passer rather than an abstainer; it is no longer the
   * standing example of a caller that names nothing.
   *
   * The template row is read in the organization this deployment-level act
   * resolves to — `tenancy.defaultOrgId()`, the same answer the membership
   * reconciler binds a new user to (ADR-0093 D3): the Default Organization
   * when no wall is requested, `null` under a requested wall, where no row is
   * read and the built-in text is sent (`phone-sms-texts.ts`, "Which
   * organization's row"). No tenancy service, or a failed resolution, is
   * `null` too: the built-in text, never a blocked send.
   */
  private renderPhoneSmsBody(
    topic: string,
    data: Record<string, unknown>,
    storedLocale?: string,
  ): Promise<string> {
    // [#25224 cut 5] The body moved to `auth-manager-email-sms-delivery.ts` (see `EmailSmsDeliveryHost`).
    const readConfig = () => this.config;
    const readSmsLocale = () => this.smsLocale;
    const host: Pick<EmailSmsDeliveryHost, 'config' | 'getDataEngine' | 'smsLocale'> = {
      get config() { return readConfig(); },
      getDataEngine: (...a) => this.getDataEngine(...a),
      get smsLocale() { return readSmsLocale(); },
    };
    return renderPhoneSmsBody.call(host, topic, data, storedLocale);
  }

  /**
   * Override the brand name surfaced in built-in auth emails (`{{appName}}`),
   * sourced from the live `branding.workspace_name` setting.
   *
   * AuthPlugin calls this on `kernel:ready` (and again whenever the setting
   * changes) once the `settings` service resolves. Passing `undefined` clears
   * the override so resolution falls back to the configured `appName`. The
   * value only reflects an *explicitly set* setting — when the operator has
   * not customised it, AuthPlugin passes `undefined` so a deployment's
   * configured `appName` (e.g. `OS_APP_NAME`) keeps precedence.
   *
   * The TOTP issuer reads the same value, but when the better-auth instance
   * is BUILT (see `createAuthInstance`), not per enrollment: an override set
   * after the build reaches it at the next rebuild.
   */
  setAppName(name: string | undefined): void {
    this.appNameOverride = name?.trim() || undefined;
  }
  private appNameOverride?: string;

  /**
   * @internal The deployment's product name: `{{appName}}` in built-in
   * templates, and the TOTP issuer handed to better-auth as its `appName`.
   */
  private getAppName(): string {
    return this.appNameOverride ?? this.config.appName ?? 'ObjectStack';
  }

  /**
   * Get the underlying better-auth instance
   * Useful for advanced use cases
   */
  getAuthInstance(): Promise<Auth<any>> {
    return this.getOrCreateAuth();
  }

  /**
   * Handle an authentication request
   * Forwards the request directly to better-auth's universal handler
   *
   * better-auth catches internal errors (database / adapter / ORM) and
   * returns a 500 Response instead of throwing.  We therefore inspect the
   * response status and log server errors so they are not silently swallowed.
   *
   * @param request - Web standard Request object
   * @param transport - What the transport knows about the request that a Fetch
   *   `Request` does not carry: `remoteAddress` is its peer address
   *   (`IHttpRequest.remoteAddress`). Omitted, the request's client address is
   *   established from trusted forwarded headers alone, and is undetermined
   *   when `trustProxy` is not declared. Either way the vendored library is
   *   handed that address and no other (`client-address-vendor.ts`).
   * @returns Web standard Response object
   */
  handleRequest(request: Request, transport?: { remoteAddress?: string }): Promise<Response> {
    // [#25224 cut 10] The body moved to `auth-manager-request-routing.ts` (see `RequestRoutingHost`).
    const host: Pick<RequestRoutingHost, 'betterAuthEndpointPath' | 'getOrCreateAuth' | 'resolveClientAddress' | 'runSubjectErasureAtomically'> = {
      betterAuthEndpointPath: (...a) => this.betterAuthEndpointPath(...a),
      getOrCreateAuth: (...a) => this.getOrCreateAuth(...a),
      resolveClientAddress: (...a) => this.resolveClientAddress(...a),
      runSubjectErasureAtomically: (...a) => this.runSubjectErasureAtomically(...a),
    };
    return handleRequest.call(host, request, transport);
  }

  /**
   * [#16025] The `basePath` string this manager hands better-auth: the
   * configured value VERBATIM, or the shipped default when nothing is
   * configured. Unchanged from before this card — only the reading of it moved
   * here, so `getBasePath()` and this cannot drift apart by accident.
   *
   * [#16384] The fallback is `DEFAULT_AUTH_BASE_PATH`, not a re-typed literal
   * — see that constant's docblock above.
   *
   * ## ⛔ Never normalise here
   *
   * better-auth stamps the OAuth access-token `iss` from `ctx.context.baseURL`,
   * which is `baseURL` + THIS string (`@better-auth/oauth-provider` 1.7.2:
   * `iss: jwtPluginOptions?.jwt?.issuer ?? ctx.context.baseURL`, and this
   * manager sets no `jwt.issuer`), while `verifyMcpAccessToken` hands
   * `jose.jwtVerify` `issuer: getAuthIssuer()` — the configured value with a
   * leading slash ADDED and a trailing one KEPT. `jose` compares `iss` by exact
   * string, so the two agree only while this string is the configured one.
   * Measured on bare better-auth 1.7.2 + `@better-auth/oauth-provider` 1.7.2
   * (memory adapter, this manager's own plugin wiring), a real
   * `client_credentials` token, configured `basePath: '/api/v1/auth/'`:
   *
   *     handed '/api/v1/auth/'   ctx.baseURL …/auth/   iss …/auth/   verifier …/auth/   ->  OK
   *     handed '/api/v1/auth'    ctx.baseURL …/auth    iss …/auth    verifier …/auth/   ->  REJECTED
   *                                    ERR_JWT_CLAIM_VALIDATION_FAILED: unexpected "iss" claim value
   *
   * ⇒ normalising this string rejects every MCP access token the deployment
   * mints, for as long as a trailing slash is configured — fail-closed, and
   * permanent. A draft of this card did exactly that. `getBasePath()` is the
   * NORMALISED view an HTTP adapter mounts on and is deliberately NOT this;
   * making the two one value moves a published OAuth identifier, which is
   * #16399's decision, not this card's.
   */
  private configuredBasePath(): string {
    return this.config.basePath || DEFAULT_AUTH_BASE_PATH;
  }

  /**
   * [#16399] The configured base path with a leading slash GUARANTEED and
   * everything else left alone. This is the one place in this file that adds a
   * leading slash; every other base-path reader is derived from it.
   *
   * ## ⛔ This mirrors better-auth's rule — it is not a normalisation of ours
   *
   * better-auth resolves the string it is handed exactly this way before
   * composing `ctx.context.baseURL`, the value `@better-auth/oauth-provider`
   * 1.7.2 stamps as the access-token `iss`. So `getAuthIssuer()` is
   * `getCanonicalOrigin()` + this, and the pair cannot drift. Measured on a
   * real `betterAuth()` built by `createAuthInstance`, reading
   * `(await auth.$context).baseURL`:
   *
   *     handed 'api/v1/auth'      ctx.baseURL  http://localhost:3000/api/v1/auth
   *     handed '/api/v1/auth'     ctx.baseURL  http://localhost:3000/api/v1/auth
   *     handed '/api/v1/auth/'    ctx.baseURL  http://localhost:3000/api/v1/auth/
   *     handed 'api/v1/auth/'     ctx.baseURL  http://localhost:3000/api/v1/auth/
   *     handed '/api/v1/auth///'  ctx.baseURL  http://localhost:3000/api/v1/auth///
   *
   * ⇒ a trailing slash SURVIVES into the issuer, so stripping one here would
   * make this manager's own verifier reject every token its AS mints — the
   * fail-closed break `configuredBasePath()` above records. ⛔ Never strip
   * anything in this method. Stripping belongs one layer down in
   * `getBasePath()`, which is a MOUNT path, not a published identifier.
   */
  private rootedBasePath(): string {
    const configured = this.configuredBasePath();
    return configured.startsWith('/') ? configured : `/${configured}`;
  }

  /**
   * [#16025] The path prefix better-auth's routes are reachable under, in the
   * single NORMALISED spelling an HTTP adapter can mount: a leading slash added
   * when absent, trailing slashes stripped.
   *
   * ## Why this is public
   *
   * An HTTP adapter that mounts this service has to know where its routes live,
   * and it had no member that answers THAT question. `config` is private. The
   * value was not unreachable, though, and an earlier draft of this docblock
   * said it was: `getAuthIssuer()` is public and its URL PATH is the configured
   * base path (`http://localhost:3000/api/v1/auth`) — `auth-plugin.ts:3176`
   * already reads a path that way, off `getMcpResourceUrl()`. What an adapter
   * would have been doing is parsing a path back out of an OAuth issuer
   * identifier, which is a different contract that happens to contain the
   * answer. A dedicated accessor is the cleaner design; being the ONLY exposure
   * was never the reason for it.
   *
   * `@objectstack/hono`'s `createHonoApp` mounted the auth surface under its OWN
   * `prefix` option instead, whose default (`/api`) does not compose with this
   * one (`/api/v1/auth`), so on the documented embed better-auth was never
   * reached at all — measured, on a real boot:
   *
   *     POST /api/auth/sign-in/email  (valid shape, wrong password)  ->  200 {}
   *     POST /api/v1/auth/delete-user                                ->  401 {"message":"Unauthorized","code":"UNAUTHORIZED"}
   *
   * ## ⛔ What this method is NOT — stated because the first spelling claimed it
   *
   * **It is NOT the string handed to better-auth.** `createAuthInstance` passes
   * `configuredBasePath()`, the configured value verbatim, and the two differ
   * exactly when the configured spelling carries a trailing slash or lacks a
   * leading one. That difference is deliberate and load-bearing — see
   * `configuredBasePath()` for the token rejection normalising there causes.
   * What the two DO share is the wire paths they serve: better-call strips a
   * trailing slash when routing and better-auth adds a missing leading one, so
   * a mount at `/api/v1/auth/*` reaches a better-auth configured with
   * `/api/v1/auth/` — measured on the same probe, which drove its whole OAuth
   * exchange through that mount.
   *
   * **It is NOT the single definition of the base path — but there IS one, one
   * layer down [#16399].** FOUR readers of `this.config.basePath` existed in
   * this file; #16025 left THREE, each with its own normaliser. There is now
   * exactly ONE read of `this.config.basePath` in this file
   * (`configuredBasePath()`) and one chain above it:
   *
   *     configuredBasePath()   the configured value VERBATIM — what better-auth is handed
   *       └─ rootedBasePath()  + a leading slash when absent (better-auth's own rule)
   *            ├─ getAuthIssuer()      = origin + this          (published `iss`)
   *            └─ getBasePath()        = this, trailing slashes stripped   (mount path)
   *                 └─ getMcpResourceUrl()  = origin + this minus `/auth` + `/mcp`
   *
   * ⇒ a fourth normaliser cannot be added without deleting a link of that
   * chain. The two remaining values still DIFFER, and deliberately so: an
   * issuer must mirror what better-auth stamps (trailing slash and all), while
   * a mount path and the MCP resource URL must be canonical.
   *
   * ## ⛔ No value moves — what this card actually changed here
   *
   * Every one of the three readers answers exactly what it answered on the
   * merge base, for every configured spelling. `betterAuthEndpointPath` already
   * applied this normalisation; better-auth already received the raw configured
   * string. What is new is that the normalisation has a name and is PUBLIC, so
   * an adapter can mount on it. A configured `'/'` still normalises to `''`,
   * unchanged from before.
   *
   * ## What the collapsed readers actually disagreed about
   *
   * As STRINGS, and not as behaviour — measured, not inferred. A configured
   * `'api/v1/auth'` reaches better-auth without its leading slash while the
   * ownership walk tests `'/api/v1/auth'`; but better-auth/better-call tolerate
   * the missing slash, so `handleRequest` answers `200` and `ownsRoute` answers
   * `true` on the SAME request. The divergence is LATENT — and ⛔ it is NOT
   * repaired here, only given one name per side: the mount and the ownership
   * walk read `getBasePath()`, better-auth still receives the configured
   * spelling. Repairing it means changing what better-auth is configured with,
   * which is the very move measured above to reject live tokens.
   */
  getBasePath(): string {
    return this.rootedBasePath().replace(/\/+$/, '');
  }

  /**
   * [#15417] Does better-auth ROUTE this request — i.e. is the path one its own
   * router owns, whatever it then answers?
   *
   * The auth catch-all yields the request to the rest of the Hono chain when
   * better-auth answers 404 (#4088), and it needs this to tell the two very
   * different 404s apart: "I do not serve this path" (yieldable — that is how
   * `plugin-hono-server`'s `/auth/me/*` routes stay reachable in either
   * registration order) from "I serve it and the answer is 404" (NOT yieldable
   * — a disabled capability's refusal is an answer, and handing it to a
   * downstream wildcard is how it becomes `200 {}`). The mechanism, the
   * measurement and the matching rules live in
   * `better-auth-route-ownership.ts`.
   *
   * Keyed on the live instance and rebuilt whenever that instance is replaced,
   * so a re-created auth (config change, test re-boot) never answers from a
   * stale table. Returns `false` — the yielding, pre-#15417 answer — for any
   * request it cannot decide, so a failure to enumerate can never take the
   * #4088 surface down with it.
   */
  ownsRoute(request: Request): Promise<boolean> {
    // [#25224 cut 10] The body moved to `auth-manager-request-routing.ts` (see `RequestRoutingHost`).
    const readRouteOwnership = () => this.routeOwnership;
    const writeRouteOwnership = (v: AuthManager['routeOwnership']) => { this.routeOwnership = v; };
    const readRouteOwnershipFor = () => this.routeOwnershipFor;
    const writeRouteOwnershipFor = (v: AuthManager['routeOwnershipFor']) => { this.routeOwnershipFor = v; };
    const host: Pick<RequestRoutingHost, 'betterAuthEndpointPath' | 'getOrCreateAuth' | 'routeOwnership' | 'routeOwnershipFor'> = {
      betterAuthEndpointPath: (...a) => this.betterAuthEndpointPath(...a),
      getOrCreateAuth: (...a) => this.getOrCreateAuth(...a),
      get routeOwnership() { return readRouteOwnership(); },
      set routeOwnership(v) { writeRouteOwnership(v); },
      get routeOwnershipFor() { return readRouteOwnershipFor(); },
      set routeOwnershipFor(v) { writeRouteOwnershipFor(v); },
    };
    return ownsRoute.call(host, request);
  }

  /** Memoized `auth.api` ownership table, and the instance it was built from. */
  private routeOwnership?: BetterAuthRouteOwnership;
  private routeOwnershipFor?: unknown;

  /**
   * The better-auth endpoint path (`/admin/remove-user`) this request addresses,
   * or `undefined` when it is not under the configured `basePath`.
   *
   * The same spelling better-auth's own `ctx.path` uses, so the sets keyed by it
   * — `SESSION_ERASURE_PATHS`, the break-glass guard's path tests — are all
   * talking about one thing.
   */
  private betterAuthEndpointPath(request: Request): string | undefined {
    // [#25224 cut 10] The body moved to `auth-manager-request-routing.ts` (see `RequestRoutingHost`).
    const host: Pick<RequestRoutingHost, 'getBasePath'> = {
      getBasePath: (...a) => this.getBasePath(...a),
    };
    return betterAuthEndpointPath.call(host, request);
  }

  /**
   * [#7724] Run a subject-erasure request as ONE unit of work: every write it
   * makes commits together, or none of them do.
   *
   * Placed at the REQUEST seam rather than inside better-auth's route, because
   * re-implementing `/admin/remove-user` here would duplicate its permission
   * check, its self-removal check and its not-found check — and a duplicated
   * security check is where the two copies drift apart. This wrapper reads no
   * bodies and makes no authorization decision; better-auth's handler runs
   * exactly as before, and the only thing added is the transaction it runs in.
   *
   * The engine's `transaction()` (ADR-0034) publishes its handle into the
   * ambient store, so every adapter write on the way down joins it without the
   * adapter knowing — which is why this needs no change in `objectql-adapter.ts`.
   *
   * Two declared limits, both inherited rather than introduced:
   * - a datasource whose driver has no `beginTransaction` runs the callback
   *   with no transaction and no rollback (ADR-0119 D1). The engine warns once
   *   per driver. Failing CLOSED instead (`{ require: true }`) was considered
   *   and rejected: it would make user removal impossible on those datasources,
   *   which is the very defect this card is fixing.
   * - side effects outside the datasource (a sent email, secondary-storage
   *   session state) are not transactional and are not undone by a rollback.
   *   `/admin/remove-user` sends nothing, so no path here relies on it.
   *
   * [#24948] `/organization/delete` runs here too, on the same terms and for
   * the same reason: the vendor's member, invitation and organization deletes
   * are separate adapter calls, and the teams and grants removed by
   * `beforeDeleteOrganization` must roll back with them.
   */
  private async runSubjectErasureAtomically(
    run: () => Promise<Response>,
  ): Promise<Response> {
    const engine = this.config.dataEngine as
      | (IDataEngine & {
          transaction?: <T>(callback: (trxCtx: any, info: any) => Promise<T>) => Promise<T>;
        })
      | undefined;
    // `transaction` is an ObjectQL capability, not an `IDataEngine` member — an
    // engine without it (a test double, a foreign engine) keeps the previous
    // behaviour rather than being refused.
    if (typeof engine?.transaction !== 'function') return run();

    try {
      return await engine.transaction(async () => {
        const response = await run();
        // better-auth RETURNS its faults; see `SubjectErasureRollback`. Any 4xx/5xx
        // means the erasure did not complete, so whatever part of it already
        // landed must not survive. 2xx commits; so does the 302 that
        // `/delete-user/callback` answers with on success.
        if (response.status >= 400) throw new SubjectErasureRollback(response);
        return response;
      });
    } catch (err) {
      // The rollback has happened by the time this runs — hand the client the
      // response better-auth composed, now with no partial writes behind it.
      if (err instanceof SubjectErasureRollback) return err.response;
      throw err;
    }
  }

  /**
   * Get the better-auth API for programmatic access
   * Use this for server-side operations (e.g., creating users, checking sessions)
   */
  async getApi(): Promise<Auth<any>['api']> {
    const auth = await this.getOrCreateAuth();
    return auth.api;
  }

  /**
   * [#14360] `identity.reconcileUser` — the host half of SCIM `active`.
   *
   * `@better-auth/scim` 1.7.0 removed its own `banned` write (1.6.30 mapped
   * `active` onto the admin plugin's ban and refused a deactivation without
   * that plugin; on the installed 1.7.2 the substring `ban` occurs zero times
   * in the package) and replaced it with this optional callback: the vendor
   * computes the user's AGGREGATE lifecycle state — `active` is true while
   * any participating SCIM source says so — inside the request's
   * transaction, calls the host, and then revokes the user's sessions when
   * the state is inactive (`dist/index.mjs`, the identity facade's
   * `reconcileUser`). Without a host implementation an IdP's `active: false`
   * revoked sessions and wrote nothing: `sys_user.banned` stayed false and a
   * local-password user signed straight back in, while ADR-0134, the
   * generated docs and the #13816 refusal all asserted the ban.
   *
   * This method restores declared = enforced by routing the state to the
   * platform's OWN ban write (`user-ban-write.ts`):
   *
   *  - `active: false` on a row that is not banned ⇒ `applyUserBan` with
   *    `SCIM_DEACTIVATION_BAN_REASON` and no expiry. The vendor's
   *    `session.create` hook (`BANNED_USER`) then refuses sign-in — the same
   *    enforcement the admin ban has, because it is the same write. On a row
   *    that is ALREADY banned with an expiry (an administrator's timed ban),
   *    the deactivation makes that ban permanent — `banExpires` is cleared,
   *    `banned` and the administrator's reason are left untouched — because
   *    the vendor's session hook auto-lifts an expired ban and would admit a
   *    principal the IdP still holds deactivated, and this callback is not
   *    re-invoked until the IdP mutates that user again.
   *  - `active: true` on a row banned WITH that reason ⇒ `applyUserUnban`.
   *    A ban carrying any other reason was placed by an administrator and is
   *    not the IdP's to lift: an attribute sync (every SCIM PUT carries
   *    `active: true`) must not silently re-admit a user banned for cause.
   *    Known collision, documented rather than reserved: an administrator
   *    who types the reason `Deactivated via SCIM` on the admin mount
   *    produces a ban this rule reads as the IdP's, so an `active: true`
   *    lifts it. Reserving the string on the admin mount would change that
   *    surface, which is not this hook's to do.
   *  - Anything else is a no-op. The callback is contractually idempotent
   *    ("Implementations must be idempotent") and the vendor invokes it on
   *    EVERY user mutation, so a PATCH that changes only `displayName`
   *    touches no ban column.
   *
   * A consequence worth stating: on 1.7.2 a SCIM `DELETE /Users/{id}` no
   * longer deletes the better-auth user (the vendor tombstones the source);
   * it leaves the user with no active source, so this callback disables the
   * account — by the SAME branch as `active: false`, including over an
   * administrator's timed ban, whose `banExpires` a DELETE therefore clears
   * too: a deprovision cannot be outlived by an expiry the administrator set.
   * For the same reason a DELETE is judged by the `beforeUpdate` guard below
   * and never by any `beforeDelete` — deleting the last administrator through
   * SCIM is refused exactly as deactivating them is. Re-provisioning through
   * the tombstone re-links the same user, the state turns active, and the
   * SCIM ban is lifted by the second bullet.
   *
   * The break-glass last-administrator guard (ADR-0135 D5.2, #5892) is an
   * ENGINE `beforeUpdate` hook on `sys_user`, so it judges this write exactly
   * as it judges the admin mount's: deactivating the last administrator
   * throws its 403 `PERMISSION_DENIED`, the adapter rethrows it as an
   * `APIError`, the vendor re-throws `APIError`s unchanged out of this
   * callback (`runSCIMApplicationCallback`, measured on 1.7.2 — any other
   * throw becomes a SCIM 500 "SCIM identity reconciliation failed" carrying
   * the original as `cause`), and the IdP receives a SCIM error with
   * `status: "403"` and the guard's own explanation. The ban is ONE write,
   * so it never half-lands: the account stays enabled and nothing is
   * skipped silently.
   *
   * What ALSO rolls back: the vendor runs this callback inside
   * `runWithTransaction`, which on this adapter is a real engine transaction
   * while `scimRequestScope` is set — and `handleRequest` opens that scope
   * around every SCIM protocol request (#14522; it was once stamped inside
   * `verifyBearerToken` with `enterWith` and never reached the writes). So
   * the vendor's own `scimUser.active = false` write, made before this
   * callback, is rolled back with the refusal, and the SCIM resource keeps
   * reading `active: true` for the account that stayed enabled — pinned by
   * the #14360 suite's face (c).
   *
   * Deliberately NOT applied here: the last-LOCAL-credential guard the admin
   * mount re-runs (`isLastLocalCredentialHolder`). That guard protects the
   * password escape hatch from an administrator's click; on this path the
   * identity provider is the authority for the user it deprovisions, and
   * keeping a departed user's password alive because it happened to be the
   * last one is the wrong direction for a deprovisioning contract. 1.6.x
   * never applied it on the SCIM path either — the vendor wrote the column
   * straight through the adapter.
   *
   * Every read and write goes through `context.database` — the adapter the
   * vendor bound to its transaction — never through an `internalAdapter`
   * resolved outside it, so the ban commits or rolls back with the SCIM
   * mutation it belongs to.
   */
  private async reconcileScimUserLifecycle(
    state: SCIMIdentityState,
    context: SCIMTransactionContext,
  ): Promise<void> {
    const db = context.database;
    const user = await db.findOne<{ banned?: unknown; banReason?: unknown; banExpires?: unknown }>({
      model: 'user',
      where: [{ field: 'id', value: state.userId }],
    });
    if (!user) {
      // The vendor holds a `scimSubject` for this user inside the same
      // transaction, so a missing row is an invariant break, not a state to
      // reconcile. Thrown, not logged: the vendor turns it into a SCIM 500
      // and rolls the mutation back — a deactivation that cannot find its
      // account must not report success.
      throw new Error(
        `[auth] SCIM identity reconciliation: better-auth user '${state.userId}' has no sys_user row`,
      );
    }
    const writer = {
      updateUser: (id: string, data: Record<string, unknown>) =>
        db.update({ model: 'user', where: [{ field: 'id', value: id }], update: data }),
    };
    const banned = user.banned === true;
    if (!state.active) {
      if (banned) {
        // Already disabled — by an earlier SCIM pass or by an administrator.
        // An administrator's TIMED ban is made permanent: the vendor's session
        // hook auto-lifts an expired ban, and nothing re-invokes this callback
        // until the IdP mutates the user again — so left alone, the expiry
        // would re-admit a principal the IdP still holds deactivated. The
        // reason stays the administrator's; only the expiry goes.
        if (user.banExpires !== null && user.banExpires !== undefined) {
          await writer.updateUser(state.userId, { banExpires: null, updatedAt: new Date() });
        }
        return;
      }
      await applyUserBan(writer, state.userId, {
        banReason: SCIM_DEACTIVATION_BAN_REASON,
        banExpires: null,
      });
      return;
    }
    if (!banned) return;
    // An administrator's ban is not the IdP's to lift.
    if (user.banReason !== SCIM_DEACTIVATION_BAN_REASON) return;
    await applyUserUnban(writer, state.userId);
  }

  /**
   * Get the underlying better-auth context for low-level operations such as
   * `internalAdapter.createAccount` / `password.hash`.
   *
   * Used by routes that need to write to better-auth's tables outside the
   * normal endpoint surface — currently only `set-initial-password`, which
   * provisions a credential account for SSO-onboarded users so they can
   * sign in with email/password going forward.
   */
  async getAuthContext(): Promise<any> {
    const auth = await this.getOrCreateAuth();
    return (auth as any).$context;
  }

  // ---------------------------------------------------------------------------
  // MCP OAuth 2.1 resource-server support (#2698)
  //
  // The embedded @better-auth/oauth-provider plugin is the AUTHORIZATION
  // server; the runtime dispatcher's `/api/v1/mcp` endpoint is the RESOURCE
  // server. These helpers are the resource-server half: canonical issuer /
  // resource URLs (also used to build the RFC 9728 protected-resource
  // metadata) and local verification of the JWT access tokens the provider
  // mints (signed by the jwt plugin, validated against our own JWKS —
  // in-process, no self-HTTP hop, no client credentials needed).
  // ---------------------------------------------------------------------------

  /**
   * [#24186] The one forced keyring re-read a token signed by an unknown key
   * earns: when the last one started, and its answer while it is in flight.
   *
   * There is no held key set here. `verifyMcpAccessToken` reads the keyring
   * through the signer's own reader on every call, so it is held only under
   * both halves of the cross-request caching rule (`signing-key-read-cache.ts`).
   */
  private unknownKeyReread?: { readonly startedAtMs: number; pending?: Promise<JSONWebKeySet | undefined> };

  /** Canonical origin of this deployment (config `baseUrl`, auto-detected in dev). */
  private getCanonicalOrigin(): string {
    const raw = (this.config.baseUrl || 'http://localhost:3000').trim().replace(/\/$/, '');
    // Guarantee an absolute origin with a scheme. A bare host (e.g. baseUrl
    // configured as `cloud.objectos.ai`) yields relative-looking links that
    // email clients won't linkify and that break when clicked — prepend
    // https:// so invitation / OAuth URLs open correctly.
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }

  /**
   * Absolute URL of a page served by the Console SPA. The Console is mounted
   * under `uiBasePath` (default `/_console`) — it owns `/login`, `/register`,
   * `/oauth/consent`, `/auth/device`, `/accept-invitation/:id`, … — so EVERY
   * link we hand to a user (email, SMS, OAuth redirect, device flow) must be
   * `${origin}${uiBasePath}${path}`. This is the single source of truth for
   * that composition: build page links through here, never by hand, so a bare
   * host (missing scheme) or a missing `/_console` prefix can't creep back in
   * one link at a time. Set `uiBasePath` in AuthConfig if Console is mounted
   * elsewhere.
   */
  private getConsolePageUrl(path: string): string {
    const uiBase = (this.config.uiBasePath ?? '/_console').replace(/\/$/, '');
    const rel = path.startsWith('/') ? path : `/${path}`;
    return `${this.getCanonicalOrigin()}${uiBase}${rel}`;
  }

  /**
   * The public reader of {@link getConsolePageUrl}: the absolute URL of a
   * Console page, `${origin}${uiBasePath}${path}`. It returns exactly what the
   * private composer computes and composes nothing of its own, so a caller
   * outside this class (the identity import's invitation, which hands it to
   * better-auth as the reset request's `redirectTo`) gets the same link every
   * email and SMS this class sends, and no second link builder exists.
   */
  getConsoleUrl(path: string): string {
    return this.getConsolePageUrl(path);
  }

  /**
   * The OAuth issuer identifier: better-auth's `baseURL` INCLUDING `basePath`
   * (e.g. `https://acme.example.com/api/v1/auth`) — this is the `iss` claim
   * the jwt plugin stamps on access tokens and what the AS metadata reports.
   *
   * ⛔ [#16399] This value is NOT canonicalised, and must not be: it has to
   * equal what better-auth composes from the string `createAuthInstance` hands
   * it, byte for byte, because `verifyMcpAccessToken` gives jose this string as
   * `issuer` and jose compares `iss` by exact string. `rootedBasePath()` is
   * that composition — see its docblock for the measured table, and
   * `auth-manager-base-path.test.ts` for the pin against a real `betterAuth()`.
   * Stripping a configured trailing slash here rejects every MCP access token
   * the deployment mints.
   */
  getAuthIssuer(): string {
    return `${this.getCanonicalOrigin()}${this.rootedBasePath()}`;
  }

  /**
   * The MCP resource identifier (RFC 8707 `resource` / token `aud`):
   * `<origin><apiPrefix>/mcp`. Derived from the auth basePath so the two can
   * never disagree about the API prefix.
   *
   * ## [#16399] Derived from the NORMALISED base path, unlike `getAuthIssuer()`
   *
   * This one is a location on this host — `auth-plugin.ts` reads a path back
   * out of it with `new URL(...).pathname` to mount the RFC 9728 §3.1
   * path-inserted well-known route — so it takes `getBasePath()`, not the
   * configured spelling. Before that it read `this.config.basePath` directly
   * and added no leading slash, so a `basePath` written without one produced a
   * value that is not a URL at all:
   *
   *     basePath 'api/v1/auth'  ->  http://localhost:3000api/v1/mcp
   *
   * `new URL()` THROWS on that (`3000api` is not a port), and
   * `@better-auth/oauth-provider` 1.7.2 refuses it outright — measured, at
   * plugin init: `skipping resource seed for http://localhost:3000api/v1/mcp —
   * resource identifier … must be an absolute URI (RFC 8707 §2)`. So the
   * `sys_oauth_resource` row is never seeded, `enforcePerClientResources`
   * stays at its `true` default, and every MCP client is refused for want of a
   * link row. That input class could never mint or match a token, which is why
   * repairing it re-selects nothing.
   */
  getMcpResourceUrl(): string {
    const apiPrefix = this.getBasePath().replace(/\/auth$/, '');
    return `${this.getCanonicalOrigin()}${apiPrefix}/mcp`;
  }

  /**
   * Whether the OAuth track for MCP is live on this deployment: the embedded
   * AS must be enabled AND the canonical origin must satisfy the OAuth 2.1
   * transport rule (TLS on a public host; plain HTTP accepted on a loopback
   * or private / link-local address — {@link isOAuthEligibleBaseUrl}). When
   * this is false the MCP endpoint is API-key-only and no OAuth metadata is
   * advertised.
   */
  isMcpOAuthEnabled(): boolean {
    return (
      resolveOidcProviderEnabled(this.config.plugins) &&
      isOAuthEligibleBaseUrl(this.getCanonicalOrigin())
    );
  }

  /**
   * Absolute URL of the RFC 9728 protected-resource metadata document —
   * advertised in `WWW-Authenticate` on 401s from `/api/v1/mcp` so clients
   * can bootstrap the flow. `null` when the OAuth track is off (API keys
   * remain; nothing is advertised, fail-closed).
   */
  getMcpResourceMetadataUrl(): string | null {
    if (!this.isMcpOAuthEnabled()) return null;
    return `${this.getCanonicalOrigin()}/.well-known/oauth-protected-resource`;
  }

  /**
   * RFC 9728 protected-resource metadata for the MCP endpoint. Served at
   * `/.well-known/oauth-protected-resource` (and its path-inserted variant)
   * by the auth plugin's discovery routes.
   */
  getMcpProtectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.getMcpResourceUrl(),
      authorization_servers: [this.getAuthIssuer()],
      // offline_access lets clients hold refresh tokens for long-lived
      // connections; the tool-family scopes bound what the tools expose.
      scopes_supported: [...MCP_OAUTH_SCOPES, 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: `${this.getAppName()} MCP`,
    };
  }

  /**
   * Verify an OAuth 2.1 Bearer ACCESS TOKEN minted by THIS deployment's
   * authorization server and resolve the principal it is bound to.
   *
   * Verification is local and fail-closed (`null` on ANY doubt): JWS
   * signature against our own JWKS, `iss` must be this deployment's issuer,
   * `aud` must be the MCP resource URL (tokens minted for other audiences —
   * userinfo, plain OIDC SSO — do NOT unlock MCP), `exp`/`nbf` enforced by
   * jose.
   *
   * [#24186] The key set is read on every call through the signer's own
   * keyring reader — better-auth's `getJwks`, the document `/jwks` serves —
   * and is never held here. So a `sys_jwks` write that passes this process's
   * engine reaches the very next verification, and the reader's TTL bounds a
   * write it cannot see, such as one on another node. A token signed by a key
   * the set does not carry is retried ONCE against a forced fresh read before
   * it is refused. That read is shared while it is in flight and runs at most
   * once per `UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS`, so tokens naming keys that
   * do not exist cost at most one keyring read per interval. Only the public
   * projection `/jwks` publishes is ever handed to jose.
   *
   * A `client_credentials` (M2M) token is REFUSED here — the MCP surface is
   * principal-bound by design; headless callers use API keys. The
   * discriminator is the `sub`/`client_id` PAIR, read as RFC 9068 defines it
   * for a JWT access token: §2.2 makes `client_id` REQUIRED, and §2.2.3.1
   * fixes what `sub` means beside it — the resource OWNER for a grant that
   * had one, and "an identifier the authorization server uses to indicate the
   * client application" for a grant that did not. So a token whose `sub`
   * equals its own `client_id` (or its `azp` spelling) states, in the
   * authorization server's own words, that NO human delegated it, and a token
   * carrying neither client claim is refused as well: the check cannot run on
   * it, and a check that cannot run must not silently pass (Route & surface
   * ownership §3).
   *
   * ⛔ Not `sid`, and ⛔ not a `sys_user` lookup. `sid` does separate today's
   * two token shapes, but it is an OIDC session-management convenience the
   * installed provider ALREADY gates per-client on ID tokens
   * (`enableEndSession || backchannelLogoutUri`) — a bump that gates it on
   * access tokens too would 401 every human on this surface, which is the
   * failure this method must not have. A `sys_user` read would make a
   * deliberately LOCAL, I/O-free verifier depend on the data engine and turn
   * a transient store error into a 401 for a legitimate human, and a row's
   * existence is not humanity anyway (`isHumanUserRow` exists because
   * `usr_system` is a row and not a person).
   *
   * Revocation note: JWT access tokens are not server-tracked, so
   * revocation takes effect at expiry (≤1h default); refresh tokens ARE
   * revocable immediately via `/oauth2/revoke`.
   *
   * The caller (runtime dispatcher) maps the returned principal through
   * `resolveAuthzContext` — the single shared authorization resolver — so
   * OAuth is a second *provenance* for the principal, never a second authz
   * model.
   *
   * [#24166] `organizationId` is the organization the user's consent bound,
   * read from the token's `organization_id` claim, which this deployment's
   * authorization server mints from the consent's reference and from nothing
   * else (`postLogin.consentReferenceId` / `customAccessTokenClaims` in the
   * provider options). It is absent when the token carries no such claim: a
   * consent made with no active organization, or a refresh family started
   * before consents bound one. It is a record, not an authorization — the
   * caller vets it on every request by the rule that vets a session's active
   * organization (`vetOrganizationClaim`, `@objectstack/core`), as the
   * `IAuthService` contract states.
   */
  verifyMcpAccessToken(
    token: string,
  ): Promise<{ userId: string; scopes: string[]; clientId?: string; organizationId?: string } | null> {
    // [#25224 cut 9] The body moved to `auth-manager-mcp-access-token.ts` (see `McpAccessTokenHost`).
    const host: Pick<McpAccessTokenHost, 'getApi' | 'getAuthIssuer' | 'getMcpResourceUrl' | 'isMcpOAuthEnabled' | 'rereadKeyringForUnknownKey'> = {
      getApi: (...a) => this.getApi(...a),
      getAuthIssuer: (...a) => this.getAuthIssuer(...a),
      getMcpResourceUrl: (...a) => this.getMcpResourceUrl(...a),
      isMcpOAuthEnabled: (...a) => this.isMcpOAuthEnabled(...a),
      rereadKeyringForUnknownKey: (...a) => this.rereadKeyringForUnknownKey(...a),
    };
    return verifyMcpAccessToken.call(host, token);
  }

  /**
   * [#24186] The forced fresh keyring read a token signed by an unknown key
   * earns, bounded twice:
   *
   *  - **single-flight** — a read already in flight is joined, never repeated;
   *  - **a floor** — no new one starts sooner than
   *    `UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS` after the last one STARTED, so a
   *    stream of tokens naming keys that do not exist costs at most one
   *    keyring read per interval. Inside the floor the answer is `undefined`
   *    and the token is refused, as it would have been without the retry.
   *
   * The read retires the keyring the signer's reader holds for this engine
   * first, so it goes to the table rather than to the set that just failed.
   * A failed read still spends the interval: a keyring that cannot be read is
   * not read again on every token.
   */
  private rereadKeyringForUnknownKey(api: unknown): Promise<JSONWebKeySet | undefined> {
    // [#25224 cut 9] The body moved to `auth-manager-mcp-access-token.ts` (see `McpAccessTokenHost`).
    const readConfig = () => this.config;
    const readUnknownKeyReread = () => this.unknownKeyReread;
    const writeUnknownKeyReread = (v: AuthManager['unknownKeyReread']) => { this.unknownKeyReread = v; };
    const host: Pick<McpAccessTokenHost, 'config' | 'unknownKeyReread'> = {
      get config() { return readConfig(); },
      get unknownKeyReread() { return readUnknownKeyReread(); },
      set unknownKeyReread(v) { writeUnknownKeyReread(v); },
    };
    return rereadKeyringForUnknownKey.call(host, api);
  }

  // ---------------------------------------------------------------------------
  // Device Flow (CLI browser-based login)
  //
  // The device authorization flow (RFC 8628) is now handled entirely by
  // better-auth's `device-authorization` plugin. Endpoints are exposed at
  // `${basePath}/device/{code,token,approve,deny}` and persisted in
  // `sys_device_code`. Enable via `plugins.deviceAuthorization: true` in
  // AuthPluginConfig.
  // ---------------------------------------------------------------------------

  /**
   * SSO-only ("enforced") login mode: the login UI hides the local password
   * form + self-registration so the team signs in via the IdP only.
   * `OS_AUTH_SSO_ONLY` (when set) wins over the `ssoOnlyMode` config knob —
   * parity with the `disableSignUp` env override — so a deployment can force
   * it regardless of the per-env/config value. Break-glass is preserved: this
   * NEVER disables `emailAndPassword.enabled`; it only forces `disableSignUp`
   * and signals the UI to hide the password form. Generic over the IdP.
   */
  private resolveSsoOnly(): boolean {
    return readSsoOnlyEnv() ?? (this.config.ssoOnlyMode ?? false);
  }

  /**
   * Is local self-registration forced off, whatever `disableSignUp` says?
   * Under SSO-only ({@link resolveSsoOnly}), and [#25083] on a cloud-managed
   * environment, whose people the hosting organisation invites in the cloud.
   * Read by the wiring and by `getPublicConfig()` alike, so the advertised
   * flag cannot disagree with the wired one. Break-glass is untouched: neither
   * case disables `emailAndPassword.enabled`.
   */
  private signUpForcedOff(): boolean {
    return this.resolveSsoOnly() || isCloudManaged();
  }

  /**
   * The tenancy posture ACTUALLY IN FORCE on this deployment — the one fact
   * both `organization/create`'s gate and `/auth/config`'s
   * `features.multiOrgEnabled` are derived from, so the two can never disagree.
   *
   * The `tenancy` service is authoritative because it is the only thing that
   * knows whether a requested wall is actually STANDING: it probes the
   * enterprise `org-scoping` runtime and resolves an unenforceable request down
   * to `single` + `degraded` (ADR-0093 D5 / ADR-0105 D1). Only a lean embedding
   * that never registered the service falls back to `resolveTenancyPosture()`,
   * the operator's REQUEST read from env.
   *
   * ⛔ Never `resolveMultiOrgEnabled()`. ADR-0105 D1 DEMOTED that boolean to a
   * back-compat INPUT of `resolveTenancyPosture()`, so it reads `false` on a
   * deployment configured with only the authoritative `OS_TENANCY_POSTURE` —
   * the exact inversion of the declared contract. It shipped twice: cloud#1020
   * (the EE licence gate) and #5233, where a fully walled
   * `OS_TENANCY_POSTURE=isolated` deployment 403'd `organization/create`, so
   * every org-less user's guided "create your workspace" path dead-ended while
   * `/auth/config` advertised the capability as present.
   *
   * [#5261] EFFECTIVE, not requested — this is a deliberate, BREAKING capability
   * contraction over what #5233 shipped. The gate used to judge
   * `postureEnforcesWall(resolveTenancyPosture())`, the operator's request, which
   * came apart from `/auth/config` on exactly one deployment shape: ADR-0093 D5
   * degradation (a wall was asked for, the `@objectstack/organizations`
   * runtime is absent, so nothing isolates anything). There the console hid the
   * "Create organization" action while the API happily minted organizations whose
   * boundary NO engine enforces — a declared-but-unenforced security property,
   * ADR-0049's canonical failure, at the deployment layer. Reading the effective
   * posture retires that shape: a deployment without an organization wall cannot
   * mint an organization, whether it never asked for a wall or asked and did not
   * get one.
   *
   * Consequence, accepted knowingly: a deployment running WITHOUT the enterprise
   * runtime can no longer create organizations at all, no matter which env knobs
   * it sets. `serve.ts` already refuses to boot that shape unless the operator
   * passes `OS_ALLOW_DEGRADED_TENANCY=1`; from here on, the org-create route is
   * refused there too rather than half-working.
   *
   * Read live on every call — never cached. The posture is process-level config
   * and the service's own probe is lazy, so freezing either at plugin-build time
   * would make the gate unable to see a provider that registers later in the
   * same boot (the recorded-verdict defect AGENTS.md's startup-registry rule
   * names).
   */
  private multiOrgPostureEffective(): boolean {
    return postureEnforcesWall(this.effectiveTenancyPosture());
  }

  /**
   * The effective posture itself. Single derivation, two readers — the gate
   * above and `getPublicConfig()`'s `features.multiOrgEnabled` /
   * `features.tenancyPosture` — because #5233 was only hard to see thanks to
   * those two sites answering from different facts.
   */
  private effectiveTenancyPosture(): TenancyPosture {
    return this.config.getTenancy?.()?.posture ?? resolveTenancyPosture();
  }

  getPublicConfig() {
    // Extract social providers info (without sensitive data)
    const socialProviders = [];
    if (this.config.socialProviders) {
      for (const [id, providerConfig] of Object.entries(this.config.socialProviders)) {
        if (providerConfig.enabled !== false) {
          // Map provider ID to friendly name
          const nameMap: Record<string, string> = {
            google: 'Google',
            github: 'GitHub',
            microsoft: 'Microsoft',
            apple: 'Apple',
            facebook: 'Facebook',
            twitter: 'Twitter',
            discord: 'Discord',
            gitlab: 'GitLab',
            linkedin: 'LinkedIn',
          };

          socialProviders.push({
            id,
            name: nameMap[id] || id.charAt(0).toUpperCase() + id.slice(1),
            enabled: true,
            type: 'social' as const,
          });
        }
      }
    }

    // Append OIDC providers
    if (this.config.oidcProviders?.length) {
      for (const p of this.config.oidcProviders) {
        socialProviders.push({
          id: p.providerId,
          name: p.name ?? (p.providerId.charAt(0).toUpperCase() + p.providerId.slice(1)),
          enabled: true,
          type: 'oidc' as const,
        });
      }
    }

    // Extract email/password config (safe fields only). Deployment env can
    // lock registration policy; otherwise we fall back to configured/settings
    // `emailAndPassword.disableSignUp` (default `false`).
    const emailPasswordConfig: Partial<EmailAndPasswordConfig> = this.config.emailAndPassword ?? {};
    const disableSignUpFromEnv = readDisableSignUpEnv();
    // SSO-only ("enforced") hides the local password form + self-registration.
    // `enabled` stays true (break-glass), but signup is forced off and the UI
    // suppresses the password form via `features.ssoEnforced` below. A
    // cloud-managed environment forces signup off too (`signUpForcedOff`).
    const ssoOnly = this.resolveSsoOnly();
    // [#11739] The audience posture, resolved once for this response: the
    // forced-verification mirror below and `features.audiencePosture` must
    // answer from the same read the enforcement path uses (getAudience —
    // the getMembershipPolicy pattern). Note `disableSignUp` is deliberately
    // NOT forced by the posture: under invite_only the sign-up route still
    // admits a pending invitee, so hiding the form entirely would dead-end
    // invited users — the posture rides its own key instead.
    const audience = this.getAudience();
    const emailPassword = {
      enabled: emailPasswordConfig.enabled !== false, // Default to true
      disableSignUp: this.signUpForcedOff() ? true : (disableSignUpFromEnv ?? emailPasswordConfig.disableSignUp ?? false),
      // Mirrors the wiring in createAuthInstance() through the SAME resolver:
      // a self-registration-permitting posture forces verification ON, except
      // an `open` deployment's explicit opt-out (#20389) — the advertised flag
      // must not disagree with the wired one.
      requireEmailVerification: resolveEmailVerificationRequirement(
        audience.posture,
        emailPasswordConfig.requireEmailVerification,
      ),
    };

    // Extract enabled features
    const pluginConfig: Partial<AuthPluginConfig> = this.config.plugins ?? {};
    // Multi-org capability (UI org-switcher, "create org" action, etc.).
    // ADR-0093 D4 / ADR-0105 D1 — the `tenancy` service is the single source of
    // truth. Prefer it; fall back to the resolved POSTURE only when it isn't
    // wired (e.g. a lean embedding). `multiOrgEnabled` reflects ACTUAL
    // capability — any posture that enforces an organization wall (`group` or
    // `isolated`) — so a degraded deployment (requested but no isolation
    // resolves to `single`) reports `false` and the org-management UI hides
    // instead of rendering broken.
    //
    // [#5233] That fallback used to read `resolveMultiOrgEnabled()`, the
    // boolean ADR-0105 D1 demoted, which reports `false` on a deployment that
    // sets only the authoritative `OS_TENANCY_POSTURE` — the same stale
    // contract that broke the org-create gate, one site over. It reads the
    // posture now, so an unwired-tenancy embedding advertises the capability
    // its gate actually allows.
    //
    // [#5261] `effectiveTenancyPosture()` is now literally the SAME call the
    // `organization/create` gate makes, so this flag cannot advertise a
    // capability the route refuses (or hide one it allows) on any deployment
    // shape — including ADR-0093 D5 degradation, where the two used to split.
    const tenancy = this.config.getTenancy?.();
    const tenancyPosture = this.effectiveTenancyPosture();
    const multiOrgEnabled = postureEnforcesWall(tenancyPosture);
    const degradedTenancy = tenancy?.degraded ?? false;

    // Legal links shown beneath the login / register cards. Defaults to
    // the public ObjectStack pages so vanilla deployments don't link to
    // dead `#` anchors; operators who deploy ObjectStack on their own
    // domain typically override these with their own legal docs via the
    // `OS_TERMS_URL` / `OS_PRIVACY_URL` env vars. Set the env var to the
    // empty string to suppress the link entirely.
    const DEFAULT_TERMS_URL = 'https://objectstack.ai/terms';
    const DEFAULT_PRIVACY_URL = 'https://objectstack.ai/privacy';
    const rawTermsUrl = (globalThis as any)?.process?.env?.OS_TERMS_URL;
    const rawPrivacyUrl = (globalThis as any)?.process?.env?.OS_PRIVACY_URL;
    const resolveLegalUrl = (raw: unknown, fallback: string): string | undefined => {
      if (typeof raw !== 'string') return fallback;
      const trimmed = raw.trim();
      // Explicit empty string (`OS_TERMS_URL=`) opts out of the link.
      if (trimmed === '') return undefined;
      return trimmed;
    };
    const termsUrl = resolveLegalUrl(rawTermsUrl, DEFAULT_TERMS_URL);
    const privacyUrl = resolveLegalUrl(rawPrivacyUrl, DEFAULT_PRIVACY_URL);

    const twoFactorFromEnv = readBooleanEnv('OS_AUTH_TWO_FACTOR');

    // [#7481, maintainer ruling 2026-08-11] `passkeys` / `magicLink` are
    // deliberately NOT advertised here — see PUBLIC_AUTH_FEATURES_NOT_ADVERTISED
    // in @objectstack/spec/kernel. Both were served from introduction with no
    // login UI at any consumer, so a deployer could flip a flag that did nothing
    // anywhere (declared = enforced). They come back with the UI (objectui#4179).
    // `magicLink`'s server endpoints are unaffected: `plugins.magicLink` still
    // wires better-auth's magic-link plugin in buildPluginList().
    const features = {
      twoFactor: twoFactorFromEnv ?? pluginConfig.twoFactor ?? false,
      organization: pluginConfig.organization ?? true,
      multiOrgEnabled,
      // ADR-0105 D1 — WHICH posture is in force. `multiOrgEnabled` stays the
      // capability gate; this tells the console how to render org context: under
      // `group` the org switcher picks the WRITE target while reads span every
      // organization the member belongs to ("all my organizations" views).
      tenancyPosture,
      // [#11739] WHICH audience posture is in force (invite_only |
      // email_domain | open) — a value, not a flag (registered in
      // PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS beside tenancyPosture). Lets the
      // login surface render honest messaging instead of a sign-up form the
      // server will refuse. An off-vocabulary config value reports the safe
      // coercion (invite_only) here while the enforcement path refuses with
      // AUTH_CONFIG_ERROR — display never fails open.
      audiencePosture: audience.posture,
      // ADR-0093 D5 — brand the degraded state everywhere an operator looks.
      // True iff multi-org was requested but tenant isolation is inactive
      // (booted only because OS_ALLOW_DEGRADED_TENANCY=1). The console can
      // surface a warning banner off this flag.
      degradedTenancy,
      // Shared decision point with `buildPluginList()` — the /auth/config
      // response MUST match what's actually wired, otherwise the frontend
      // renders UI for endpoints that 404.
      oidcProvider: resolveOidcProviderEnabled(pluginConfig),
      // Coarse "is the @better-auth/sso plugin wired" flag. The `/auth/config`
      // route refines this to "usable" (≥1 provider configured) via
      // `isSsoUsable()` so the login UI can hide the "Sign in with SSO" button
      // both when SSO is off AND when it's on but no IdP exists yet.
      sso: this.isSsoWired(),
      // SSO-only ("enforced"): tell the login UI to hide the local password
      // form + self-registration. A break-glass "use a password" link remains
      // for the env owner / local admin. Driven by `ssoOnlyMode` / `OS_AUTH_SSO_ONLY`.
      ssoEnforced: ssoOnly,
      deviceAuthorization: pluginConfig.deviceAuthorization ?? false,
      // Mirrors `enabled.admin` in buildPluginList() (SCIM forces the admin
      // plugin on, ADR-0134) — previously `?? false`, which advertised the
      // admin surface as absent in SCIM-enabled deployments where it was
      // actually mounted, hiding the admin sys_user actions (#2766 V1).
      // Shares resolveScimEnabled with the mount path (#13816) so the
      // advertised flag can never disagree with the wired plugin list; the
      // explicit-false-with-SCIM corner is unreachable here — construction
      // refuses it (assertScimAdminCoherence).
      admin: pluginConfig.admin ?? resolveScimEnabled(pluginConfig),
      // #2766 V1.5 — mirrors `enabled.phoneNumber` in buildPluginList().
      phoneNumber: (pluginConfig as any).phoneNumber ?? false,
      // #2780 — OTP sign-in / self-service reset is only advertised when the
      // SMS path can actually deliver (plugin on + deliverable SMS service),
      // so the login UI never shows a dead "sign in with code" option.
      phoneNumberOtp: ((pluginConfig as any).phoneNumber ?? false) && this.isPhoneOtpDeliverable(),
      // The managed (cloud-hosted, SSO-only) mode, from the one accessor every
      // judgement site reads (ruling 6341690661 on #25083, Q2 D / Q3 A). A
      // hide-when-on flag: the console hides the doors that add people.
      cloudManaged: isCloudManaged(),
      ...(termsUrl ? { termsUrl } : {}),
      ...(privacyUrl ? { privacyUrl } : {}),
    };

    // Dev-only login hint (15.1 third-party eval): the empty-DB auto-seeded
    // admin was invisible — nothing on the login page said the account
    // exists, so new users signed up into an empty non-admin workspace.
    // `devSeedResult` is set at boot by the auth plugin ONLY under
    // NODE_ENV==='development' (seeding boot, or later boots while the
    // account still verifies against the default password), so this field
    // can never appear in production. The env re-check is defense in depth.
    const devSeedAdmin =
      (globalThis as any)?.process?.env?.NODE_ENV === 'development' && this.devSeedResult
        ? { email: this.devSeedResult.email, password: this.devSeedResult.password }
        : undefined;

    return {
      emailPassword,
      socialProviders,
      features,
      ...(devSeedAdmin ? { devSeedAdmin } : {}),
    };
  }

  /**
   * Coarse "is the domain-routed `@better-auth/sso` plugin wired" flag.
   * Resolved with the EXACT logic that decides whether the plugin is mounted
   * in `buildPlugins()` (`pluginConfig.sso ?? ssoFromEnv ?? false`) so the
   * advertised capability can never disagree with the actual `/sign-in/sso`
   * route. An explicit `plugins.sso` wins over `OS_SSO_ENABLED`; the env var
   * decides only when the config leaves it unset (#13439, maintainer ruling
   * 2026-08-31).
   * Public so `AuthPlugin` can gate the Setup-nav "SSO Providers" entry on it
   * (captures both self-host `OS_SSO_ENABLED` and the cloud per-env
   * `planAllowsSso` config, since that arrives via `plugins.sso`).
   */
  public isSsoWired(): boolean {
    // Same parser as `buildPluginList` (`readBooleanEnv`) so the advertised
    // capability can never disagree with the actually-mounted route.
    const ssoFromEnv = readBooleanEnv('OS_SSO_ENABLED');
    return this.config.plugins?.sso ?? ssoFromEnv ?? false;
  }

  /**
   * Whether opt-in DNS domain-verification (ADR-0135 D6) is wired — i.e. the
   * `/sso/request-domain-verification` + `/sso/verify-domain` endpoints are
   * mounted (and the hard "domain must be verified to log in" gate is active).
   * Resolved with the EXACT logic `buildPluginList` uses for the `sso()`
   * `domainVerification.enabled` option, so the bridge can return a clear
   * "not enabled for this environment" instead of a bare 404 when off.
   * Implies `isSsoWired()` (the sso plugin must be loaded to honor it).
   */
  public isSsoDomainVerificationEnabled(): boolean {
    if (!this.isSsoWired()) return false;
    const fromEnv = readBooleanEnv('OS_SSO_DOMAIN_VERIFICATION');
    return this.config.plugins?.ssoDomainVerification ?? fromEnv ?? false;
  }

  /**
   * Whether enterprise SSO is actually *usable*, not merely wired: the plugin
   * is on AND at least one `sys_sso_provider` row exists. Per-email domain→IdP
   * matching still happens at `/sign-in/sso`; this answers the coarser "is
   * there any point showing the SSO button at all", so a freshly-enabled but
   * unconfigured SSO setup doesn't advertise a button that errors for everyone.
   *
   * Fails OPEN to the wired flag when providers can't be counted (no data
   * engine, query error) — a config-introspection hiccup must never make the
   * login page hide a button that genuinely works.
   */
  public async isSsoUsable(): Promise<boolean> {
    if (!this.isSsoWired()) return false;
    const engine = this.getDataEngine();
    if (!engine) return true; // wired but can't verify — fall open
    try {
      const count = await withSystemReadContext(engine).count('sys_sso_provider');
      return typeof count === 'number' ? count > 0 : true;
    } catch {
      return true; // provider introspection failed — keep the wired behaviour
    }
  }

  /**
   * Extra `trustedOrigins` entries derived from an external-SSO registration
   * request. For a `POST /sso/register` | `/sso/update-provider`, parse the
   * (cloned) body and return the PUBLIC-ROUTABLE origins of the declared
   * `issuer` / `oidcConfig` endpoints so `@better-auth/sso`'s discovery
   * validation accepts a customer IdP registered at runtime (ADR-0135 D6) without
   * the operator pre-listing it in boot config. Only public-routable hosts are
   * returned — private / internal / loopback hosts are never auto-trusted
   * (better-auth's `isPublicRoutableHost`, the same predicate its own
   * sub-endpoint check uses). Best-effort: any parse error yields `[]`.
   */
  private async ssoDiscoveryTrustedOrigins(request: unknown): Promise<string[]> {
    try {
      const req = request as { url?: string; method?: string; clone?: () => Request } | undefined;
      if (!req || typeof req.clone !== 'function' || !req.url) return [];
      if ((req.method ?? 'GET').toUpperCase() !== 'POST') return [];
      const path = new URL(req.url).pathname;
      if (!/\/sso\/(register|update-provider)$/.test(path)) return [];
      const body = await req.clone().json().catch(() => null);
      if (!body || typeof body !== 'object') return [];
      const oidc = (body as any).oidcConfig ?? {};
      const candidates = [
        (body as any).issuer,
        oidc.discoveryEndpoint,
        oidc.authorizationEndpoint,
        oidc.tokenEndpoint,
        oidc.jwksEndpoint,
        oidc.userInfoEndpoint,
      ].filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (!candidates.length) return [];
      const { isPublicRoutableHost } = await import('@better-auth/core/utils/host');
      const out: string[] = [];
      for (const c of candidates) {
        try {
          const u = new URL(c);
          if (isPublicRoutableHost(u.hostname) && !out.includes(u.origin)) out.push(u.origin);
        } catch { /* skip malformed URL */ }
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Resolve the acting user (+ their active org) for a before-hook gate,
   * hook-order-independent. Tries the standard cookie session first, then falls
   * back to explicit token resolution (bearer or the session cookie's token
   * part) — the bearer plugin may convert `Authorization: Bearer` to a session
   * AFTER this global before-hook runs. Returns `null` when no valid session
   * can be resolved (→ caller lets `sessionMiddleware` issue the 401).
   *
   * [#25059] By default a session read that FAILED answers `null` too, the
   * same value as no session. `failedReadThrows` tells the two apart for a
   * caller whose fall-through would let writes run uncounted: when no actor
   * was resolved and the explicit token read itself threw, that throw
   * propagates. A request with no credential, a credential the store does not
   * hold, an expired session, a credential that does not parse or one
   * carrying a control character still answers `null`.
   */
  /**
   * [Ruling 6355206139 E2] The reads `narrowDirectoryForExternalCaller` makes,
   * bound to this manager's engine under the system read context. With no
   * engine every caller reads as no member, so nothing is narrowed — the
   * mock-mode status quo.
   */
  private externalDirectoryDoorDeps(): ExternalDirectoryDoorDeps {
    const engine = this.config.dataEngine;
    const sys = engine ? (withSystemReadContext(engine) as any) : undefined;
    const first = async (object: string, where: Record<string, unknown>) => {
      if (!sys) return undefined;
      const rows: any[] = await sys.find(object, { where, limit: 1 });
      return Array.isArray(rows) ? rows[0] : undefined;
    };
    return {
      resolveActor: (ctx) => this.resolveActor(ctx),
      readMemberRole: async (userId, organizationId) =>
        (await first('sys_member', { user_id: userId, organization_id: organizationId }))?.role,
      readUserEmail: async (userId) => (await first('sys_user', { id: userId }))?.email,
      resolveOrganizationSlug: async (slug) => (await first('sys_organization', { slug }))?.id,
      readUserTeamIds: async (userId) => {
        if (!sys) return [];
        const rows: any[] = await sys.find('sys_team_member', { where: { user_id: userId }, fields: ['team_id'], limit: 1000 });
        return (Array.isArray(rows) ? rows : [])
          .map((r) => r?.team_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      },
      isExternalRole: isExternalMembershipRole,
    };
  }

  private resolveActor(
    ctx: any,
    options?: { failedReadThrows?: boolean },
  ): Promise<{ userId: string; activeOrgId?: string } | null> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts`; it reads no member of this class.
    return resolveActor(ctx, options);
  }

  /**
   * ADR-0068 D2, asked on its own: is `userId` a PLATFORM admin?
   *
   * ⭐ [#10348] This is NOT a judge. It is this manager's engine binding over
   * `hasPlatformAdminStanding` — the one place in the tree that turns a user id
   * into that boolean, in `core/security/resolve-authz-context.ts`, whose header
   * states that every entry point must resolve authorization through it and
   * never re-read `sys_*_permission_set` itself. This file used to do exactly
   * what that forbids, twice: here, and again inside the `customSession`
   * callback. Both copies are gone; both callers land here, and this method
   * performs no derivation of its own. Adding one back is the regression.
   *
   * The three call sites are `/sso/register`'s ADR-0135 D6 before-hook, the
   * `/admin/impersonate-user` oracle (both the caller and the protected-target
   * question), and the `customSession` payload — which is why the payload can
   * no longer report a different answer from the gates.
   *
   * [#10949] What the copies had drifted away from, and what the authority
   * applies: the ADR-0091 validity window on the grant, the ADR-0049 `active`
   * flag on the catalogue row, and a lookup of `admin_full_access` BY ID rather
   * than by name over a page of the catalogue. The first two mean an expired or
   * deactivated grant no longer authorizes anything; the third means an
   * environment with more permission sets than that page held can no longer
   * demote every platform admin at once.
   *
   * Deliberately does NOT admit organization owners/admins — the authority
   * derives the `PLATFORM_ADMIN` rung from the UNSCOPED capability grant alone,
   * so an org owner/admin (and a TENANT_ADMIN-posture principal) is refused.
   * [#10009] That boundary was established when `/sso/register` stopped asking
   * the org question; it is pinned, at both gates, in
   * `platform-admin-standing.consolidation.test.ts`.
   *
   * ⛔ The legacy `user.role === 'admin'` scalar is NOT consulted. ⛔ Nor is any
   * caller-supplied seed: the predicate takes `(engine, userId)` and reads the
   * stored rows, so nothing about a request can supply part of its own verdict.
   *
   * The authority reads with system identity, so the lookups are not themselves
   * RLS-scoped to the acting — possibly non-privileged — user. Fails CLOSED
   * (returns false) on an empty id, a missing engine, or any lookup error: this
   * backs security gates, and an unverifiable actor must never pass.
   */
  private isPlatformAdminUserId(userId: string): Promise<boolean> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts` (see `ActorGuardHost`).
    const host: Pick<ActorGuardHost, 'getDataEngine'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
    };
    return isPlatformAdminUserId.call(host, userId);
  }

  /**
   * ADR-0069 D3 at a vendor-served platform-admin door (SSO-provider
   * registration, update and delete; the `admin` plugin's role-scalar
   * actions): refuse
   * `actor` when the authentication policy holds them, with the refusal the
   * session gate gives, and return otherwise.
   *
   * These doors are better-auth endpoints whose session `customSession` never
   * decorates, so the posture is ASKED, never read off the request: the session
   * gate's own carrier ({@link computeAuthGate} — the first entry of
   * {@link resolveUserAuthGates}, the ONE per-user posture computation) for the
   * organization the actor's session operates in, judged by `judgeHeldSession`
   * (`platform-admin-gate.ts`), which is `judgePlatformAdmin`'s held refusal.
   * No second computation and no second decision. It fails OPEN exactly where
   * that computation does (an unreadable posture holds no one).
   *
   * Thrown as a better-auth `APIError` carrying the judge's ADR-0112 body, so
   * the vendor endpoint answers `403` with the posture's own code and message.
   */
  private assertActorNotHeld(actor: { userId: string; activeOrgId?: string }): Promise<void> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts` (see `ActorGuardHost`).
    const host: Pick<ActorGuardHost, 'computeAuthGate'> = {
      computeAuthGate: (...a) => this.computeAuthGate(...a),
    };
    return assertActorNotHeld.call(host, actor);
  }

  /**
   * [#8289] Answer `/organization/remove-member`'s PERMISSION denial with the
   * `403 YOU_ARE_NOT_ALLOWED_TO_*` envelope its siblings use, ahead of the
   * vendor handler that would answer it with the sole-owner invariant's `400`.
   *
   * `remove-member-permission-guard.ts` carries the full reading of the vendor
   * defect and of the two properties that make pre-empting it safe. The shape
   * here follows from them:
   *
   *  - **Silent on the sole-owner path.** A caller removing THEMSELVES while
   *    carrying the creator role is the one reading under which the vendor's
   *    message is true, so the guard returns and lets the vendor answer.
   *  - **FAIL-OPEN on anything unresolvable.** Unlike the `/sso/register` gate,
   *    this is not a security boundary — better-auth still enforces the whole
   *    policy after us, and refuses everything it refused before. The guard only
   *    RESTATES a refusal the vendor is already going to make, so a lookup that
   *    cannot be completed must fall back to today's behaviour (the vendor's own
   *    answer), never to an invented refusal. Failing closed here would turn an
   *    engine hiccup into a 403 on a legitimate owner's removal.
   *  - **The permission half is the vendor's own `hasPermission`**, called with
   *    the same roles map we hand the org plugin, so this never becomes a second
   *    spelling of the authorization question.
   */
  /**
   * [#24948] `/organization/delete` admission: refuse 409 `DELETE_RESTRICTED`,
   * naming every table and its row count, while the organization still owns
   * records (`organization-delete.ts` carries the contract and the exclusion
   * set).
   *
   * Only for a caller the vendor itself admits — a member whose role holds
   * `organization: ['delete']`, asked of the vendor's own `hasPermission`, as
   * {@link assertRemoveMemberPermitted} does — so a caller it refuses gets its
   * refusal, and no count. What the vendor itself answers falls through to it:
   * no session, no organization id, no membership, no permission, no
   * organization row. A READ this decides on that fails does not fall
   * through [#25059], the session read included (`resolveActor` with
   * `failedReadThrows`): the vendor's own reads could then succeed and its writes
   * run with nothing counted, so it refuses here with 503
   * `SERVICE_UNAVAILABLE` ({@link organizationDeleteReadFaultBody}), and so
   * does a failure deciding whether the target is the Default Organization.
   * The COUNT does not fall through either: it is the guard, and a guard that
   * could not be evaluated must not pass, so its failure propagates. The
   * Default Organization is asked the last-administrator guard's question
   * first (a 403), then its own record count (the same 409), both here, before
   * the first write.
   */
  private assertOrganizationDeletable(ctx: any): Promise<void> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts` (see `ActorGuardHost`).
    const readOrgRolesMap = () => this.orgRolesMap;
    const readOrganizationDeleteStandingJudge = () => this.organizationDeleteStandingJudge;
    const host: Pick<ActorGuardHost, 'getDataEngine' | 'orgRolesMap' | 'organizationDeleteStandingJudge' | 'resolveActor'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
      get orgRolesMap() { return readOrgRolesMap(); },
      get organizationDeleteStandingJudge() { return readOrganizationDeleteStandingJudge(); },
      resolveActor: (...a) => this.resolveActor(...a),
    };
    return assertOrganizationDeletable.call(host, ctx);
  }

  private assertRemoveMemberPermitted(ctx: any): Promise<void> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts` (see `ActorGuardHost`).
    const readOrgRolesMap = () => this.orgRolesMap;
    const host: Pick<ActorGuardHost, 'getDataEngine' | 'orgRolesMap' | 'resolveActor'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
      get orgRolesMap() { return readOrgRolesMap(); },
      resolveActor: (...a) => this.resolveActor(...a),
    };
    return assertRemoveMemberPermitted.call(host, ctx);
  }

  /**
   * [#9714] `/revoke-session` admission gate — refuse (404, standard
   * `RESOURCE_NOT_FOUND`) when the supplied token identifies no session
   * belonging to the caller, instead of letting the vendor's unconditional
   * success line answer `{ status: true }` over a skipped delete.
   *
   * The predicate is the vendor's own (`findSession(token)?.session.userId ===
   * <caller>`), asked through the same `internalAdapter.findSession` the
   * handler calls — never a second spelling of it. Everything the guard cannot
   * decide falls through to the vendor: unauthenticated callers (its session
   * middleware answers 401), a non-string token (its zod body schema answers
   * 400), an adapter read failure (never convert "could not look" into "does
   * not exist"). Zero-match and foreign-token answers are byte-identical — no
   * existence oracle. Full reading: `revoke-session-match-guard.ts`.
   */
  private assertRevokeSessionIdentifiesRecord(ctx: any): Promise<void> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts` (see `ActorGuardHost`).
    const host: Pick<ActorGuardHost, 'resolveActor'> = {
      resolveActor: (...a) => this.resolveActor(...a),
    };
    return assertRevokeSessionIdentifiesRecord.call(host, ctx);
  }

  /**
   * [#10069] `/admin/revoke-user-session` admission gate — refuse (404,
   * standard `RESOURCE_NOT_FOUND`) when the supplied token identifies no
   * session at all, instead of letting the vendor's unconditional success
   * line answer `{ success: true }` over a delete that dispatched nothing.
   *
   * NOT the #9714 predicate: this route has no ownership dimension — the
   * caller is an admin acting on arbitrary users, so the question is only
   * "does any session carry this token". And it is asked strictly AFTER the
   * vendor's own permission question ({@link adminMayRevokeUserSessions},
   * the vendor's `hasPermission` with the LIVE mounted-plugin options), so
   * every caller the vendor would refuse falls through to the vendor's own
   * 401/403 and never learns whether the token exists. Everything else the
   * guard cannot decide falls through too: a non-string token (the vendor's
   * zod body schema answers 400), an adapter read failure (never convert
   * "could not look" into "does not exist"). Full reading:
   * `admin-revoke-user-session-match-guard.ts`.
   */
  private assertAdminRevokeUserSessionIdentifiesRecord(ctx: any): Promise<void> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts`; it reads no member of this class.
    return assertAdminRevokeUserSessionIdentifiesRecord(ctx);
  }

  /**
   * [#3697] The issuer's own better-auth membership role in `orgId` — the
   * input to the invitation role cap.
   *
   * `beforeCreateInvitation` receives `inviter` as the *session user*, not the
   * member row (better-auth's `crud-invites.mjs` passes `session.user`), so
   * the role has to be read back. Read through `withSystemReadContext`: an
   * org-scoped RLS read performed as a non-privileged delegate could return
   * nothing and silently grade them as unresolved.
   *
   * Returns `null` when the role is not established — missing keys, no
   * engine, or a read that answered with no usable membership row. That
   * grades BELOW a plain member, so the cap refuses anything above a `member`
   * invitation with `INVITE_ISSUER_UNVERIFIED`: this backs a security gate,
   * and an issuer it cannot check confers nothing — "no engine to read" is
   * "cannot check", never "the cap does not apply".
   *
   * [#23945] A read that THROWS is not one of those answers: it throws
   * `503 SERVICE_UNAVAILABLE` ({@link invitationRoleCapReadFaultApiError}), so
   * an outage is never reported as a verdict about the issuer. Still no
   * invitation is created.
   *
   * Multiple membership rows (legacy duplicates) are joined so the highest
   * grade among them wins — the cap must judge the authority they actually
   * hold, not whichever row came back first.
   */
  private resolveMembershipRole(
    userId: unknown,
    orgId: unknown,
  ): Promise<string | null> {
    // [#25224 cut 1] The body moved to `auth-manager-actor-guards.ts` (see `ActorGuardHost`).
    const host: Pick<ActorGuardHost, 'getDataEngine'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
    };
    return resolveMembershipRole.call(host, userId, orgId);
  }

  /**
   * Compose the framework's identity-source stamp (`account.create.after`)
   * and the default active-org stamp (`session.create.before`) with any
   * host-supplied `databaseHooks`, preserving ALL. The cloud passes
   * `user.create.after` (personal-org provisioning) + `session.create.before`
   * (active-org) — its session hook chains FIRST and this default only fills
   * the field when still unset, so the host keeps precedence. If a host ever
   * adds its own `account.create.after` we chain it after the stamp rather
   * than silently dropping one.
   */
  private composeDatabaseHooks(
    host?: BetterAuthOptions['databaseHooks'],
  ): BetterAuthOptions['databaseHooks'] {
    // [#25224 cut 4] The body moved to `auth-manager-database-hooks.ts` (see `DatabaseHooksHost`).
    const readConfig = () => this.config;
    const readIdpLocale = () => this.idpLocale;
    const hookHost: Pick<DatabaseHooksHost, 'audienceLogError' | 'config' | 'idpLocale' | 'isCreatedInThisRequest' | 'linkingContext' | 'settleMembership' | 'settleSelfRegistrationGrant' | 'stampIdentitySource' | 'takeOwnerVerifiedStamp'> = {
      audienceLogError: (...a) => this.audienceLogError(...a),
      get config() { return readConfig(); },
      get idpLocale() { return readIdpLocale(); },
      isCreatedInThisRequest: (...a) => this.isCreatedInThisRequest(...a),
      linkingContext: (...a) => this.linkingContext(...a),
      settleMembership: (...a) => this.settleMembership(...a),
      settleSelfRegistrationGrant: (...a) => this.settleSelfRegistrationGrant(...a),
      stampIdentitySource: (...a) => this.stampIdentitySource(...a),
      takeOwnerVerifiedStamp: (...a) => this.takeOwnerVerifiedStamp(...a),
    };
    return composeDatabaseHooks.call(hookHost, host);
  }

  /**
   * [#12981] One durability-degradation line for an identity write this manager
   * asked for and did NOT get.
   *
   * ## Why every call site below needs this and not a comment
   *
   * The eight seams that call this were a bare `catch` carrying only a
   * "best-effort" comment. That rationale is sound about CONTROL FLOW — a
   * counter write must never turn a valid sign-in into a 500 — and it is the
   * durability class exactly as
   * AGENTS.md → "Degradation log levels" defines it: the write was refused, the
   * request answered 200, and NOTHING downstream looks wrong. The lockout
   * counter simply stops counting; the password-history ring simply stops
   * growing. "Best-effort" is a statement about whether to THROW. It was being
   * read as a statement about whether to REPORT, and those are different
   * decisions.
   *
   * ## The level is `warn`, and that is deliberately NOT this batch's call
   *
   * AGENTS.md rules a lost write is an `error`. `AuthManagerOptions.logger`
   * (this file, ~line 671) declares `{ info?; warn }` and NO `error`, and it is
   * re-exported from the package `index.ts`, so adding `error?` is a
   * published-shape change. #12981's ruling routes that LEVEL question to
   * the published-sink ruling (commit e238c79f0) and tells this batch to fix the
   * SILENCE only — the same split batches 1 and 2 landed for `plugin-security`'s
   * two exported sinks. `warn` is the guaranteed channel here and the lowest
   * level a reader still reads as a failure, so nothing is lost but loudness.
   *
   * ⛔ Call `warn` through the PROPERTY, never through an extracted reference —
   * `@objectstack/core`'s `ObjectLogger` is class-based and its `warn` reaches
   * for `this.write`, so a detached call throws. The hazard and its measured
   * cost are written up on {@link audienceLogError}; this helper is the same
   * discipline for the durability channel.
   */
  private logDurabilityDegradation(
    message: string,
    error: unknown,
    meta?: Record<string, unknown>,
  ): void {
    this.config.logger?.warn(message, {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Maintain `sys_user.source` (cloud ADR-0024 D4 provenance) as accounts are linked.
   * Drives the managed-vs-native user-mgmt gating: a managed (`idp-provisioned`)
   * user holds no local credential, so the password / identity-edit actions
   * hide for them — preventing a managed user from self-minting a local
   * password that would bypass enforced SSO.
   *
   * Two cases, both break-glass safe and idempotent (only writes on a real
   * change, so trackHistory stays quiet):
   *
   *  • A **federated** account (any non-`credential` provider — the cloud-as-IdP
   *    `objectstack-cloud` provider OR a customer's own OIDC/SAML IdP) is
   *    linked AND the user holds NO local credential → mark `idp-provisioned`.
   *    A user who already has a `credential` account (an env-native user who
   *    linked SSO) is left `env-native` — they keep a usable password.
   *
   *  • A **credential** account is created (local signup, or the break-glass
   *    owner's password set via set-initial-password — which can land AFTER the
   *    first SSO link) → ensure `env-native`. This flips a previously-stamped
   *    owner back, so the break-glass admin never loses self-service password
   *    management.
   *
   * Best-effort: any failure leaves the prior value (the gate fails open — a
   * managed user might transiently show a password action that simply errors —
   * never a hard login failure).
   */
  private stampIdentitySource(account: any, _ctx?: unknown): Promise<void> {
    // [#25224 cut 4] The body moved to `auth-manager-database-hooks.ts` (see `DatabaseHooksHost`).
    const host: Pick<DatabaseHooksHost, 'getDataEngine' | 'logDurabilityDegradation'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return stampIdentitySource.call(host, account, _ctx);
  }

  /**
   * ADR-0069 D1 — reject a password that doesn't meet the configured character-
   * class complexity. No-op when `passwordRequireComplexity` is off. Counts the
   * four classes (upper / lower / digit / symbol) present and throws
   * `PASSWORD_POLICY_VIOLATION` when fewer than `passwordMinClasses` are used.
   */
  private assertPasswordComplexity(password: string): Promise<void> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readConfig = () => this.config;
    const host: Pick<PasswordSessionPolicyHost, 'config'> = {
      get config() { return readConfig(); },
    };
    return assertPasswordComplexity.call(host, password);
  }

  /**
   * #2766 V1 — public seam for the admin user-management routes, which accept
   * admin-supplied passwords outside the better-auth endpoint hooks that
   * normally run assertPasswordComplexity.
   */
  public async checkPasswordComplexity(password: string): Promise<void> {
    return this.assertPasswordComplexity(password);
  }

  /**
   * ADR-0069 — is any authentication-policy gate enabled? Cheap, synchronous;
   * lets the transport seams skip session lookups entirely when off (the
   * default), keeping the gate zero-overhead until an admin opts in.
   */
  public isAuthGateActive(): boolean {
    // Per-org MFA (no global flag) can still activate the gate — keep the cheap
    // sync check honest by consulting a lazily-refreshed cache. Same for
    // admin-issued must-change-password flags (#2766 V1).
    this.refreshOrgMfaCacheIfStale();
    this.refreshMustChangeCacheIfStale();
    return (
      Math.floor(Number(this.config.passwordExpiryDays) || 0) > 0 ||
      this.config.mfaRequired === true ||
      this._orgMfaCache.value ||
      this._mustChangeCache.value
    );
  }

  /**
   * #2766 V1.5 — is the phoneNumber plugin wired? Mirrors `enabled.phoneNumber`
   * in buildPluginList() / `features.phoneNumber` in getPublicConfig().
   */
  public isPhoneNumberEnabled(): boolean {
    return ((this.config.plugins ?? {}) as any).phoneNumber === true;
  }

  /**
   * #2766 V2 — is an email transport wired? The identity import endpoint
   * rejects the invite password policy up front when it isn't, instead of
   * creating N accounts whose invitation emails all silently fail.
   */
  public isEmailServiceAvailable(): boolean {
    return !!this.getEmailService();
  }

  /**
   * #2780 — is an SMS service wired? Gate for the import SMS-invite variant
   * (mirrors {@link isEmailServiceAvailable} for the invite policy).
   */
  public isSmsServiceAvailable(): boolean {
    return !!this.getSmsService();
  }

  /**
   * #2780 — can a phone OTP actually reach a handset? True when an SMS
   * service is wired AND it is either backed by a real provider or we are
   * outside production (the dev LogSmsTransport prints the message, so local
   * OTP flows stay testable end-to-end). In production an unconfigured
   * log-only service keeps OTP OFF — advertising it would strand every user
   * at a code that never arrives.
   */
  public isPhoneOtpDeliverable(): boolean {
    const sms = this.getSmsService();
    if (!sms) return false;
    if (typeof sms.isConfigured !== 'function' || sms.isConfigured()) return true;
    return (globalThis as any)?.process?.env?.NODE_ENV !== 'production';
  }

  /**
   * #2766 V1 — flip the "someone must change their password" cache on this
   * node the moment an admin issues a flag, so the gate is enforced on the
   * flagged user's very next request instead of after the cache TTL. Called by
   * the admin create-user / set-user-password routes.
   */
  public noteMustChangePasswordIssued(): void {
    this._mustChangeCache = { value: true, at: Date.now() };
  }

  /**
   * #2766 V1 — refresh the "any user has must_change_password" cache in the
   * background when stale (60s TTL). Mirrors refreshOrgMfaCacheIfStale: the
   * flag clears itself once no flagged users remain, returning the gate to
   * zero overhead.
   */
  private refreshMustChangeCacheIfStale(): void {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readMustChangeCache = () => this._mustChangeCache;
    const writeMustChangeCache = (v: AuthManager['_mustChangeCache']) => { this._mustChangeCache = v; };
    const readMustChangeRefreshing = () => this._mustChangeRefreshing;
    const writeMustChangeRefreshing = (v: AuthManager['_mustChangeRefreshing']) => { this._mustChangeRefreshing = v; };
    const host: Pick<PasswordSessionPolicyHost, '_mustChangeCache' | '_mustChangeRefreshing' | 'getDataEngine'> = {
      get _mustChangeCache() { return readMustChangeCache(); },
      set _mustChangeCache(v) { writeMustChangeCache(v); },
      get _mustChangeRefreshing() { return readMustChangeRefreshing(); },
      set _mustChangeRefreshing(v) { writeMustChangeRefreshing(v); },
      getDataEngine: (...a) => this.getDataEngine(...a),
    };
    return refreshMustChangeCacheIfStale.call(host);
  }

  /**
   * ADR-0069 — refresh the "any org requires MFA" cache in the background when
   * stale (60s TTL). Fire-and-forget: a brand-new per-org requirement activates
   * the gate on the next request, never blocking this one. No-op when global MFA
   * is already on (the gate is active regardless).
   */
  private refreshOrgMfaCacheIfStale(): void {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readOrgMfaCache = () => this._orgMfaCache;
    const writeOrgMfaCache = (v: AuthManager['_orgMfaCache']) => { this._orgMfaCache = v; };
    const readOrgMfaRefreshing = () => this._orgMfaRefreshing;
    const writeOrgMfaRefreshing = (v: AuthManager['_orgMfaRefreshing']) => { this._orgMfaRefreshing = v; };
    const readConfig = () => this.config;
    const host: Pick<PasswordSessionPolicyHost, '_orgMfaCache' | '_orgMfaRefreshing' | 'config' | 'getDataEngine'> = {
      get _orgMfaCache() { return readOrgMfaCache(); },
      set _orgMfaCache(v) { writeOrgMfaCache(v); },
      get _orgMfaRefreshing() { return readOrgMfaRefreshing(); },
      set _orgMfaRefreshing(v) { writeOrgMfaRefreshing(v); },
      get config() { return readConfig(); },
      getDataEngine: (...a) => this.getDataEngine(...a),
    };
    return refreshOrgMfaCacheIfStale.call(host);
  }

  /**
   * ADR-0069 — the auth-policy gate posture for a SESSION: the first, most
   * urgent posture {@link resolveUserAuthGates} reports for its user in its
   * active organization that holds this session, else undefined.
   *
   * What a posture holds is its declared scope (`AUTH_GATE_SCOPES`, #23287,
   * ruling C′ item 1): `account` holds every credential of the user,
   * `credential` holds the password sign-in alone. Which postures hold a
   * session therefore depends on what the session is:
   *
   *  - a session the user signed in to themselves is held by every scope: it
   *    IS the password sign-in a `credential` posture holds;
   *  - an IMPERSONATION session (`options.impersonation`, read off
   *    `session.impersonatedBy`) is not the user's password sign-in. It is
   *    minted from the administrator's own session, which passed its own
   *    posture check at the impersonation door. So only an `account`-scope
   *    posture holds it: the first one the list reports, wherever it sits
   *    (`accountScopeAuthGate`, the reading the API-key admission seam gives
   *    a key, the other credential that is not the password sign-in). A target
   *    held by both the forced reset and enforced MFA answers `MFA_REQUIRED`
   *    on it, never nothing (#24762, ruling 6288774214 items 1 and 2).
   *
   * The other callers ask for a user's own session (`options` omitted), so
   * their answer is the list's first entry, as it always was.
   */
  private async computeAuthGate(
    userId: string,
    activeOrgId: string | undefined,
    _twoFactorEnabledHint: boolean,
    options: { impersonation?: boolean } = {},
  ): Promise<AuthGate | undefined> {
    const gates = await this.resolveUserAuthGates(userId, { organizationId: activeOrgId });
    if (options.impersonation === true) return accountScopeAuthGate(gates) ?? undefined;
    return gates[0];
  }

  /**
   * [ADR-0069 · #23287, ruling C′ item 3] Every authentication-policy posture
   * `userId` holds right now, most urgent first; `[]` when no policy holds
   * them. The ONE per-user posture computation (`IAuthService.resolveUserAuthGates`):
   *
   *  - the session gate takes its first entry, and on an impersonation session
   *    its first `account`-scope entry ({@link computeAuthGate}, onto
   *    `user.authGate` in `customSession`);
   *  - the API-key admission seam (`resolveApiKeyAdmission`, `@objectstack/core`)
   *    asks it for a key's owner and holds the key on an `account`-scope entry
   *    (`AUTH_GATE_SCOPES`);
   *  - keyed by user id, so a caller outside both seams can ask it too.
   *
   * `organizationId` is the organization the credential operates in: an
   * organization may require MFA above the global floor.
   *
   * Order, most urgent first: the administrator's forced reset, then natural
   * password expiry, then enforced MFA. The user's own session shows the
   * first; a key, and an impersonation session, are held only by an
   * `account`-scope entry, wherever it sits in the list — a user whose
   * password expired AND who owes MFA enrolment holds their keys on the MFA
   * entry even though their session shows the expiry.
   *
   * No-op (no read) when no gate feature is enabled. Fails OPEN on any lookup
   * error, answering `[]` — a transient hiccup must never lock a compliant user
   * out, through either credential.
   */
  /**
   * [#23367, ruling A] The API-key lifecycle policy in force
   * (`IAuthService.resolveApiKeyLifecyclePolicy`), every number defaulted to
   * the ruling's: 90-day default expiry, one-year ceiling, 90-day inactivity.
   * Read by the signing door (`POST /keys`) and the key-admission seam
   * (`resolveApiKeyAdmission`) alike, so the two can never disagree.
   */
  public resolveApiKeyLifecyclePolicy(): ApiKeyLifecyclePolicy {
    const days = (value: unknown, fallback: number, min: number): number => {
      const n = Math.floor(Number(value));
      return Number.isFinite(n) && n >= min ? n : fallback;
    };
    const startedAt = typeof this.config.apiKeyPolicyStartedAt === 'string'
      && !Number.isNaN(Date.parse(this.config.apiKeyPolicyStartedAt))
      ? this.config.apiKeyPolicyStartedAt
      : undefined;
    const maxExpiryDays = days(this.config.apiKeyMaxExpiryDays, API_KEY_MAX_EXPIRY_DAYS, 1);
    return {
      // The ceiling rules the default too: a default longer than the ceiling
      // would mint the very key the ceiling refuses to sign.
      defaultExpiryDays: Math.min(maxExpiryDays, days(this.config.apiKeyDefaultExpiryDays, API_KEY_DEFAULT_EXPIRY_DAYS, 1)),
      maxExpiryDays,
      inactivityDays: days(this.config.apiKeyInactivityDays, API_KEY_INACTIVITY_DAYS, 0),
      ...(startedAt ? { startedAt } : {}),
    };
  }

  /**
   * [#23772] `IAuthService.mintPrincipalSession`: a short-lived session for
   * the requesting user's own principal, in-process only (no route reaches
   * it). Human principals only, refused before anything is minted; at most
   * `PRINCIPAL_SESSION_MAX_TTL_SECONDS`; never renewed by a read on either
   * lane (the `session.update.before` guard in `composeDatabaseHooks`); ended
   * by the returned `revoke`. `principal-session-mint.ts` owns all of it.
   */
  public async mintPrincipalSession(
    context: ExecutionContext,
    options?: PrincipalSessionMintOptions,
  ): Promise<PrincipalSession> {
    return mintPrincipalSession(
      {
        authContext: async () => (await this.getAuthContext()) as PrincipalSessionAuthContext,
        resolveUserAuthGates: (userId, opts) => this.resolveUserAuthGates(userId, opts),
      },
      context,
      options,
    );
  }

  public resolveUserAuthGates(
    userId: string,
    options: { organizationId?: string } = {},
  ): Promise<AuthGate[]> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readMustChangeCache = () => this._mustChangeCache;
    const readOrgMfaCache = () => this._orgMfaCache;
    const readConfig = () => this.config;
    const host: Pick<PasswordSessionPolicyHost, '_mustChangeCache' | '_orgMfaCache' | 'config' | 'getDataEngine' | 'refreshMustChangeCacheIfStale' | 'refreshOrgMfaCacheIfStale'> = {
      get _mustChangeCache() { return readMustChangeCache(); },
      get _orgMfaCache() { return readOrgMfaCache(); },
      get config() { return readConfig(); },
      getDataEngine: (...a) => this.getDataEngine(...a),
      refreshMustChangeCacheIfStale: (...a) => this.refreshMustChangeCacheIfStale(...a),
      refreshOrgMfaCacheIfStale: (...a) => this.refreshOrgMfaCacheIfStale(...a),
    };
    return resolveUserAuthGates.call(host, userId, options);
  }

  /**
   * ADR-0069 D1 — stamp `sys_user.password_changed_at = now` after a password is
   * set (sign-up / change / reset). Best-effort; never throws. Written as a Date
   * (never epoch-ms) per ADR-0074.
   */
  private stampPasswordChangedAt(userId: string): Promise<void> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const host: Pick<PasswordSessionPolicyHost, 'getDataEngine' | 'logDurabilityDegradation'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return stampPasswordChangedAt.call(host, userId);
  }

  /**
   * ADR-0069 D1 — parse the bounded `previous_password_hashes` JSON column into
   * a string[] of hashes, tolerating null / malformed values.
   */
  private parseHashes(raw: unknown): string[] {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts`; it reads no member of this class.
    return parseHashes(raw);
  }

  /**
   * ADR-0069 D1 — resolve the user whose password is being changed. For
   * `/change-password` the caller is authenticated (session); for
   * `/reset-password` the user is carried by the reset token's verification
   * value (the same lookup better-auth's own handler uses).
   *
   * [#8049] `/change-password` goes through {@link resolveActor}, the shared
   * hook-order-independent resolver — NOT a bare `getSessionFromCtx`. That call
   * reads the session COOKIE, and better-auth orders `options.hooks.before`
   * (this hook) ahead of every plugin before-hook, including `bearer()`'s —
   * which is precisely what converts `Authorization: Bearer` into that cookie.
   * So on the bearer lane the cookie does not exist yet and the bare call
   * resolves null, while better-auth's own password write (running after the
   * conversion) succeeds: a 200 with nothing stamped.
   *
   * This is one resolution site on purpose. THREE behaviours hang off the id it
   * returns — the `password_changed_at` / `must_change_password` stamp, ADR-0069
   * D1's password-reuse REJECTION, and the history append — so a lane this
   * cannot see is not merely a lane that stays flagged: it is a lane where a
   * declared security control silently does not run. Resolving the principal
   * correctly here fixes all three at once; a second stamp site would fix the
   * visible one and leave the control transport-dependent.
   */
  private resolvePasswordChangeUserId(ctx: any): Promise<string | undefined> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const host: Pick<PasswordSessionPolicyHost, 'resolveActor'> = {
      resolveActor: (...a) => this.resolveActor(...a),
    };
    return resolvePasswordChangeUserId.call(host, ctx);
  }

  /**
   * ADR-0069 D1 — throw `PASSWORD_REUSE` when `candidate` matches the user's
   * current password or any hash in the bounded history. Reuses better-auth's
   * native `password.verify` (passed in) rather than re-hashing. Returns the
   * current hash (for the after-hook to append) when the candidate is fresh, or
   * undefined when the feature is off / nothing to compare.
   */
  private assertPasswordNotReused(
    userId: string,
    candidate: string,
    verify?: (data: { password: string; hash: string }) => Promise<boolean>,
  ): Promise<string | undefined> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readConfig = () => this.config;
    const host: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'parseHashes'> = {
      get config() { return readConfig(); },
      getDataEngine: (...a) => this.getDataEngine(...a),
      parseHashes: (...a) => this.parseHashes(...a),
    };
    return assertPasswordNotReused.call(host, userId, candidate, verify);
  }

  /**
   * ADR-0069 D1 — append `oldHash` to the bounded password-history ring after a
   * successful change/reset. Best-effort; never throws.
   */
  private recordPasswordHistory(userId: string, oldHash: string): Promise<void> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readConfig = () => this.config;
    const host: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'logDurabilityDegradation' | 'parseHashes'> = {
      get config() { return readConfig(); },
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
      parseHashes: (...a) => this.parseHashes(...a),
    };
    return recordPasswordHistory.call(host, userId, oldHash);
  }

  /**
   * ADR-0069 D2 — throw `ACCOUNT_LOCKED` when the identity is currently locked
   * out (brute-force protection). No-op when lockout is disabled
   * (`lockoutThreshold <= 0`) or no data engine is wired. Fails OPEN on a
   * lookup error: an infra hiccup must never block every login.
   *
   * The lock it enforces is the one held by the account the credential check
   * resolves the identifier to ({@link findSignInAccount}), so it holds for
   * every spelling of the address that signs in to that account.
   *
   * The refusal is a refused sign-in of the account it names, so — given the
   * endpoint context `ctx` — it writes that account's `login_failed` row with
   * the refusal's own code before throwing (`auth-session-audit.ts`).
   */
  private assertAccountNotLocked(email: string, ctx?: unknown): Promise<void> {
    // [#25224 cut 2] The body moved to `auth-manager-sign-in-lockout.ts` (see `SignInLockoutHost`).
    const readConfig = () => this.config;
    const host: Pick<SignInLockoutHost, 'config' | 'findSignInAccount' | 'getDataEngine'> = {
      get config() { return readConfig(); },
      findSignInAccount: (...a) => this.findSignInAccount(...a),
      getDataEngine: (...a) => this.getDataEngine(...a),
    };
    return assertAccountNotLocked.call(host, email, ctx);
  }

  /**
   * ADR-0069 D2 — record a sign-in outcome for lockout accounting. On failure
   * increments `failed_login_count` and, once it reaches `lockoutThreshold`,
   * stamps `locked_until = now + lockoutDurationMinutes`. On success resets
   * both (only writing when there is something to clear, to avoid a no-op
   * history row on every login). No-op when lockout is disabled. Never throws —
   * a counter write must not turn a valid login into an error.
   *
   * The counter it moves is the one held by the account the credential check
   * resolves the identifier to ({@link findSignInAccount}) — the account the
   * gate above enforces — so every refused attempt on that account counts
   * toward one lock, and every success on it clears that lock, whatever
   * spelling of the address the attempt carried.
   *
   * Resolves to the lock it stamped — the account, the expiry and the
   * threshold — when THIS call wrote `locked_until` and the write landed, and
   * to `undefined` otherwise. That is the lockout transition the
   * `account_locked` row records, so a lock that was never written is never
   * reported as one.
   */
  private recordSignInOutcome(
    email: string,
    success: boolean,
  ): Promise<{ userId: string; lockedUntil: Date; threshold: number } | undefined> {
    // [#25224 cut 2] The body moved to `auth-manager-sign-in-lockout.ts` (see `SignInLockoutHost`).
    const readConfig = () => this.config;
    const host: Pick<SignInLockoutHost, 'config' | 'findSignInAccount' | 'getDataEngine' | 'logDurabilityDegradation'> = {
      get config() { return readConfig(); },
      findSignInAccount: (...a) => this.findSignInAccount(...a),
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return recordSignInOutcome.call(host, email, success);
  }

  /**
   * Write the account events for a refused `/sign-in/email`: one
   * `login_failed` row for the account the sign-in named, carrying the
   * refusal's machine code, and — when this attempt stamped the ADR-0069 D2
   * lockout (`lockStamped`, from {@link recordSignInOutcome}) — one
   * `account_locked` row. Independent of the lockout configuration: a refused
   * sign-in is recorded whether or not a threshold is set.
   *
   * ⛔ The submitted identifier is used only to FIND the account and is never
   * recorded; an identifier that resolves to no account writes nothing
   * (`auth-session-audit.ts`, account events). The password is never read.
   * Never throws — the refusal is already decided and the sink swallows.
   */
  private auditRefusedSignIn(
    ctx: any,
    email: string,
    lockStamped: { userId: string; lockedUntil: Date; threshold: number } | undefined,
  ): Promise<void> {
    // [#25224 cut 2] The body moved to `auth-manager-sign-in-lockout.ts` (see `SignInLockoutHost`).
    const readConfig = () => this.config;
    const host: Pick<SignInLockoutHost, 'config' | 'resolveSignInAccountId'> = {
      get config() { return readConfig(); },
      resolveSignInAccountId: (...a) => this.resolveSignInAccountId(...a),
    };
    return auditRefusedSignIn.call(host, ctx, email, lockStamped);
  }

  /**
   * The id of the account a password sign-in for `email` is checked against,
   * or `undefined` — {@link findSignInAccount}'s answer, so the `login_failed`
   * row names the account the credential check actually judged and the lock
   * gate and counter hold.
   */
  private resolveSignInAccountId(email: string): Promise<string | undefined> {
    // [#25224 cut 2] The body moved to `auth-manager-sign-in-lockout.ts` (see `SignInLockoutHost`).
    const host: Pick<SignInLockoutHost, 'findSignInAccount' | 'getDataEngine' | 'logDurabilityDegradation'> = {
      findSignInAccount: (...a) => this.findSignInAccount(...a),
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return resolveSignInAccountId.call(host, email);
  }

  /**
   * ADR-0069 D2 — the ONE answer to "which account does this password sign-in
   * name", read by the lock gate ({@link assertAccountNotLocked}), the counter
   * ({@link recordSignInOutcome}) and the account events
   * ({@link resolveSignInAccountId}): the `sys_user` row with `fields`
   * (plus `id`), or `undefined` when the identifier names no account.
   *
   * It asks exactly what better-auth's `/sign-in/email` credential check asks
   * (1.7.12, re-read 2026-10-21 for #25096:
   * `internalAdapter.findUserByEmail(email.toLowerCase())`, an
   * equality match of the `email` column against the lower-cased address,
   * which is also the spelling `internalAdapter.createUser` stores), so the
   * gate, the counter, the ledger and the credential check name one account
   * for every identifier the credential check resolves to it.
   *
   * The lockout state lives on that row (`failed_login_count` /
   * `locked_until`) and every write to it is by the row's `id`, so one account
   * holds one counter. ⛔ Never resolve the account any other way on this
   * path: the lockout holds exactly as far as it names the account the
   * credential check names.
   *
   * Throws what the engine throws; each caller keeps its own failure posture
   * (the gate fails open, the counter and the ledger report the lost write).
   */
  private findSignInAccount(
    engine: IDataEngine,
    email: string,
    fields: readonly string[],
  ): Promise<({ id: string } & Record<string, unknown>) | undefined> {
    // [#25224 cut 2] The body moved to `auth-manager-sign-in-lockout.ts`; it reads no member of this class.
    return findSignInAccount(engine, email, fields);
  }

  /**
   * ADR-0069 D2 (#3690) — project the operator's lockout settings onto
   * better-auth's own `twoFactor({ accountLockout })` contract, so the second
   * factor obeys the same policy as the password stage above.
   *
   * Deliberately reuses `lockoutThreshold` / `lockoutDurationMinutes` rather
   * than introducing a parallel `two_factor_lockout_*` pair: an admin who
   * tightens sign-in to 3 attempts reasonably reads that as "the login flow is
   * tightened", and before this the second factor silently stayed at
   * better-auth's 10 — the stricter door was the looser one, with nothing in
   * the UI saying so. Following better-auth's own field shape (rather than
   * inventing ObjectStack settings on top of it) also means a future upstream
   * addition here shows up as a new option, not a conflict.
   *
   * `undefined` when the threshold is 0/absent — better-auth's defaults (on,
   * 10 attempts, 15 minutes) then stand. That is NOT mapped to
   * `enabled: false`: `0` is the password stage's "off", and a deployment may
   * leave THAT stage unlocked because other controls cover it (per-IP rate
   * limiting, a captcha, an IdP in front). The second factor is the last door
   * before a session is issued, so it is not turned off by a setting that
   * never mentioned it. Both stages remain explicitly configurable; only the
   * "unset" case differs, and it differs toward locking.
   *
   * Note the plugin ALSO caps attempts per challenge at a hardcoded 5
   * (`beginAttempt(5)` in its totp / backup-code verifiers), which no option
   * reaches. A threshold above 5 therefore still forces a fresh challenge
   * every 5 guesses; the account budget is what accumulates across them.
   */
  private resolveTwoFactorAccountLockout():
  { enabled: boolean; maxFailedAttempts: number; durationSeconds: number } | undefined {
    // [#25224 cut 2] The body moved to `auth-manager-sign-in-lockout.ts` (see `SignInLockoutHost`).
    const readConfig = () => this.config;
    const host: Pick<SignInLockoutHost, 'config'> = {
      get config() { return readConfig(); },
    };
    return resolveTwoFactorAccountLockout.call(host);
  }

  /**
   * ADR-0069 D7 — stamp `last_login_at` (+ `last_login_ip` when known) on a
   * successful sign-in. Best-effort and always fire-and-forget safe: a login
   * audit write must never turn a valid login into an error, and it runs
   * unconditionally (unlike lockout accounting, which is gated on a threshold).
   *
   * [#8144] The write is ATTRIBUTED to the user who just signed in. Before this
   * it went out as a bare `{ isSystem: true }`, so the audit writer recorded it
   * with `user_id: null` — and since nothing else wrote a `login` row, that
   * unattributed `update sys_user` row was the *only* trace a sign-in left
   * behind (#7675's reproduction). `attributedUserId` is the platform's one
   * channel for "the human CREDITED for a write the system authorized" (#4586,
   * `auth-actor-attribution.ts`); it travels as provenance, no security
   * middleware reads it, and it never becomes the subject the write authorizes
   * as — `isSystem: true` stays exactly where it is.
   *
   * Passed EXPLICITLY rather than through `authSystemWriteContext()`: the
   * ambient actor scope is filled by better-auth's global before-hook from the
   * request's session, and on `/sign-in/email` there is no session yet when
   * that hook runs. The one path that knows who this is, is this one.
   *
   * Attributed rather than EXCLUDED (the ruling allowed either). Suppressing it
   * would mean adding `last_login_at`/`last_login_ip` to the CRUD writer's
   * repo-wide `NOISE_FIELDS`, which deletes the `last_login_ip` change trail —
   * a login from a new address is exactly the kind of thing a compliance ledger
   * is read for — for every object and every deployment. The defect the ruling
   * named is the missing actor, and this is that actor.
   */
  private stampLastLogin(userId: string, ip: string | undefined): Promise<void> {
    // [#25224 cut 2] The body moved to `auth-manager-sign-in-lockout.ts` (see `SignInLockoutHost`).
    const host: Pick<SignInLockoutHost, 'getDataEngine' | 'logDurabilityDegradation'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return stampLastLogin.call(host, userId, ip);
  }

  /**
   * ADR-0069 D2 — clear a user's lockout state (admin "Unlock" action).
   * Resets `failed_login_count` and `locked_until`. Returns false when no data
   * engine is wired or the user does not exist.
   *
   * [#3690] Clears BOTH stages. Sign-in can lock at the password check
   * (`sys_user`) or at the second factor (`sys_two_factor`), and the two keep
   * independent counters — so unlocking only the first left a 2FA-locked user
   * with no admin escape hatch at all, waiting out the duration. That was
   * survivable while the second factor sat on better-auth's 10-attempt default;
   * with the threshold now operator-configurable (3 is a reasonable choice),
   * it is a lock admins will hit routinely.
   */
  public unlockUser(userId: string): Promise<boolean> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const host: Pick<PasswordSessionPolicyHost, 'getDataEngine' | 'logDurabilityDegradation'> = {
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return unlockUser.call(host, userId);
  }

  /**
   * ADR-0069 D4 — idle / absolute session enforcement, run per request from
   * `customSession`. Revokes (expires in place + stamps
   * revoked_at/revoke_reason) when a limit is exceeded so better-auth returns
   * no session on the NEXT request; otherwise touches `last_activity_at`
   * (throttled to once a minute). [#25343] The touch runs on every deployment,
   * limits or not; with both off, a per-process 60-second memo per session
   * skips the `sys_session` read too. Best-effort — never throws.
   */
  private enforceSessionControls(sessionId: string | undefined, createdAtHint: unknown): Promise<void> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readConfig = () => this.config;
    const host: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'logDurabilityDegradation'> = {
      get config() { return readConfig(); },
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return enforceSessionControls.call(host, sessionId, createdAtHint);
  }

  /**
   * ADR-0069 D4 — concurrent-session cap, run from the sign-in after-hook.
   * Keeps the newest `maxConcurrentSessions` live sessions for the user and
   * revokes the rest (oldest first). No-op when off. Best-effort.
   */
  private enforceConcurrentCap(userId: string): Promise<void> {
    // [#25224 cut 3] The body moved to `auth-manager-password-session-policy.ts` (see `PasswordSessionPolicyHost`).
    const readConfig = () => this.config;
    const host: Pick<PasswordSessionPolicyHost, 'config' | 'getDataEngine' | 'logDurabilityDegradation'> = {
      get config() { return readConfig(); },
      getDataEngine: (...a) => this.getDataEngine(...a),
      logDurabilityDegradation: (...a) => this.logDurabilityDegradation(...a),
    };
    return enforceConcurrentCap.call(host, userId);
  }

  /**
   * ADR-0069 D5 — is `ip` within the configured allow-list? True (allow) when no
   * ranges are configured: nothing is judged then. With ranges configured, true
   * only for an address inside one of them, and FALSE for an undetermined
   * address (`undefined` / empty): an allow-list is a gate, and a gate that
   * opens for "unknown" is open to anyone who can make themselves unknown.
   * Supports IPv4 CIDR + exact IPv4/IPv6 (IPv4-mapped IPv6 compares as IPv4).
   *
   * `ip` must be the address the server established
   * ({@link resolveClientAddress}), never a header read by the caller.
   */
  public isClientIpAllowed(ip: string | undefined): boolean {
    const ranges = this.config.allowedIpRanges;
    if (!ranges || ranges.length === 0) return true;
    if (!ip) return false; // undetermined → refused
    return ranges.some((r) => ipMatchesRange(ip, r));
  }

  /**
   * The client address this deployment establishes for a request: the
   * platform's client-address trust rule (`./client-address.ts`, shared with the
   * runtime's inbound rate limiter) applied with this deployment's
   * {@link AuthManagerOptions.trustProxy}. Forwarded headers count only when
   * `trustProxy` is declared; otherwise the transport's `remoteAddress`;
   * `undefined` when neither is available. The ADR-0069 D5 allow-list judges
   * this address and the D7 login audit stamps it.
   */
  public resolveClientAddress(transport: {
    headers?: Record<string, string | string[] | undefined>;
    remoteAddress?: string;
  }): string | undefined {
    return resolveClientAddress({
      ...(transport.headers ? { headers: transport.headers } : {}),
      ...(transport.remoteAddress ? { remoteAddress: transport.remoteAddress } : {}),
      trustProxy: this.config.trustProxy === true,
    });
  }

  /** Whether this deployment declared `server.trustProxy` ({@link AuthManagerOptions.trustProxy}). */
  public trustsForwardedHeaders(): boolean {
    return this.config.trustProxy === true;
  }

  /**
   * Returns the data engine wired into this auth manager. Used by route
   * handlers (e.g. bootstrap-status) that need to query identity tables
   * directly without going through better-auth.
   */
  public getDataEngine(): IDataEngine | undefined {
    return this.config.dataEngine;
  }
}
