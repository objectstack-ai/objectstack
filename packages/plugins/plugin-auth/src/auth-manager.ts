// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Auth, BetterAuthOptions } from 'better-auth';
// better-auth value imports (betterAuth + plugins) are deferred via dynamic
// import() in getOrCreateAuth() / buildPluginList() so that disabled plugins
// never get loaded into the process. See Stage 2F (RSS investigation).
import type {
  AuthConfig,
  EmailAndPasswordConfig,
  AuthPluginConfig,
  OidcProvidersConfig,
} from '@objectstack/spec/system';
import type { IDataEngine } from '@objectstack/core';
import type { IEmailService, ISmsService } from '@objectstack/spec/contracts';
import { readEnvWithDeprecation, resolveTenancyPosture, resolveOrgLimit, isMcpServerEnabled } from '@objectstack/types';
import {
  mapMembershipRole,
  BUILTIN_IDENTITY_PLATFORM_ADMIN,
  MEMBERSHIP_ROLE_DELEGATED_ADMIN,
} from '@objectstack/spec';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { MCP_OAUTH_SCOPES } from '@objectstack/spec/ai';
import { createObjectQLAdapterFactory, withSystemReadContext } from './objectql-adapter.js';
import { runWithAuthActorScope, setAuthActorResolver } from './auth-actor-attribution.js';
import { SESSION_ERASURE_PATHS } from './session-tombstone.js';
import {
  invitationRoleCapFailure,
  isPlainMemberInvitation,
  isOrgAdminGrade,
} from './invitation-role-cap.js';
import { isPlaceholderEmail } from './placeholder-email.js';
import { reconcileMembership, type MembershipPolicy } from './reconcile-membership.js';
import type { TenancyService } from './tenancy-service.js';
import { OtpSendGuard, assertOtpCooldownSeconds } from './otp-send-guard.js';
import type { CounterStore } from './rate-limit-storage.js';
import {
  PHONE_SMS_TOPICS,
  builtinPhoneSmsBody,
  interpolatePhoneSms,
  loadPhoneSmsTemplateBody,
} from './phone-sms-texts.js';
import {
  AUTH_USER_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_ACCOUNT_CONFIG,
  AUTH_VERIFICATION_CONFIG,
  buildOrganizationPluginSchema,
  buildTwoFactorPluginSchema,
  buildOauthProviderPluginSchema,
  buildDeviceAuthorizationPluginSchema,
  buildJwtPluginSchema,
  buildAdminPluginSchema,
  buildPhoneNumberPluginSchema,
} from './auth-schema-config.js';
import {
  createHostUsableJwksReader,
  probeEd25519Support,
  protectGetSessionJwtHook,
  resolveJwtSigningAlgorithm,
} from './jwt-key-algorithm.js';

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
    // eslint-disable-next-line no-console
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
 * OAuth 2.1 §1.5 transport rule for the MCP OAuth track: authorization/token
 * exchanges and bearer usage require TLS, with loopback exempt (dev). A
 * plain-HTTP non-loopback deployment keeps the API-key track only — the
 * OAuth surface (protected-resource metadata, bearer acceptance) stays dark,
 * fail-closed, and is logged once at mount time.
 */
export function isOAuthEligibleBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host.endsWith('.localhost')
    );
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
   * NOT_SUPPORTED (the pre-SMS behaviour) instead of silently logging.
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
   * Display name used by built-in auth email templates (`{{appName}}`
   * placeholder). Defaults to `'ObjectStack'` when omitted.
   */
  appName?: string;

  /**
   * ADR-0081 D1 — default active-org on session create. When enabled
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
   * Optional structured logger (the kernel `ctx.logger`) for best-effort
   * bookkeeping surfaces such as the ADR-0093 membership reconciler. Omitted →
   * those surfaces run silently (they already fail closed to no-op).
   */
  logger?: { info?: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void };

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
   * session) from a client IP outside these CIDR / exact ranges are rejected
   * with `IP_NOT_ALLOWED` at the auth-route middleware. Requires a trusted proxy
   * to set `x-forwarded-for` / `cf-connecting-ip`; fails OPEN when the client IP
   * can't be determined (so a missing proxy header is a no-op, not a lockout).
   */
  allowedIpRanges?: string[];

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

/** ADR-0069 D5 — does `ip` match `range` (IPv4 CIDR `a.b.c.d/n`, or exact IP)? */
export function ipMatchesRange(ip: string, range: string): boolean {
  const r = (range || '').trim();
  if (!r) return false;
  if (r.includes('/')) {
    const [base, bitsStr] = r.split('/');
    const bits = Number(bitsStr);
    const ipInt = ipv4ToInt(ip);
    const baseInt = ipv4ToInt(base);
    if (ipInt === null || baseInt === null || !(bits >= 0 && bits <= 32)) {
      return ip.trim() === base.trim(); // non-IPv4-CIDR → exact-match fallback
    }
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
  }
  return ip.trim() === r;
}

/**
 * #6039 / #2814 — the error code an SMS service reports a QUOTA refusal with.
 *
 * `SmsService.send()` cannot throw an HTTP-shaped error: it is a kernel service
 * with no idea who is calling. It reports the deployment's daily cost ceiling
 * being hit as a normal failed result whose `error` carries the service's
 * `CODE: message` envelope — here `TOO_MANY_REQUESTS: daily SMS quota
 * exhausted`. Turning that back into an HTTP answer is the auth endpoint's job,
 * which is why the mapping lives here (see {@link isSmsQuotaRefusal}).
 *
 * **Source of truth**: `SMS_QUOTA_EXCEEDED_CODE` in
 * `packages/services/service-sms/src/sms-daily-quota.ts` (exported alongside
 * `SMS_QUOTA_EXCEEDED_ERROR`).
 *
 * **Why it is restated instead of imported**: `@objectstack/service-sms` already
 * depends on THIS package — its day counter imports `InProcessCounterStore` /
 * `incrementFixedWindow` from `@objectstack/plugin-auth` — so importing the
 * constant back would close a dependency cycle. This is the same call, in the
 * other direction, that `normalizeSmsRecipient` makes in
 * `packages/services/service-sms/src/sms-service.ts` ("Same shape rule as
 * plugin-auth's `normalizePhoneNumber` … kept local: the two packages must not
 * depend on each other").
 *
 * Only the CODE crosses the boundary — a closed-vocabulary ADR-0112 error code,
 * not prose. The message half of the envelope is service-owned and may be
 * reworded without touching this file.
 */
const SMS_QUOTA_EXCEEDED_CODE = 'TOO_MANY_REQUESTS';

/**
 * #6039 — is this `SendSmsResult.error` the quota wall's refusal?
 *
 * Matched as a PREFIX of the service's `CODE: message` envelope, never as a
 * substring: a transport failure puts the provider's raw text in `error`
 * (`SmsService` truncates it and reports it verbatim), and one that happens to
 * mention the code mid-sentence is still a transport failure — 500, not 429.
 */
function isSmsQuotaRefusal(error: string | undefined): boolean {
  return typeof error === 'string' && error.startsWith(`${SMS_QUOTA_EXCEEDED_CODE}:`);
}

/**
 * #6039 — the 429 an SMS quota refusal must reach the caller as.
 *
 * better-call (better-auth's router) maps ONLY `APIError` to a real HTTP status:
 * `isAPIError(err) = err instanceof APIError || err?.name === 'APIError'`
 * (better-call@1.3.7 `dist/utils.mjs:57`), consumed at `dist/router.mjs:93`,
 * where everything else takes the `console.error` + `500 / null body` branch.
 * A plain `Error` therefore buried `TOO_MANY_REQUESTS` in a server log while the
 * per-number wall on the same endpoint ({@link AuthManager.assertPhoneOtpSendAllowed})
 * answered 429 — one endpoint, two voices.
 *
 * The message follows the per-number wall's shape and carries NO budget detail:
 * no ceiling, no remaining count, no reset clock. #2814's requirement is that
 * the two walls be indistinguishable from outside — an attacker must not learn
 * which budget they hit, and a legitimate caller needs no more than "not now".
 * (The per-number wall names its own retry window because it can compute one;
 * this wall states no time it cannot honestly promise.)
 */
async function smsQuotaExceededApiError(message: string): Promise<Error> {
  const { APIError } = await import('better-auth/api');
  return new APIError(SMS_QUOTA_EXCEEDED_CODE, { message });
}

export class AuthManager {
  private auth: Auth<any> | null = null;
  private config: AuthManagerOptions;
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
   * when it provisions the well-known admin on an empty DB). The `serve`
   * command reads this after boot to surface the credentials in the startup
   * banner. Undefined when no seed ran (production, opt-out, or a DB that
   * already had a user).
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

    // WebContainer (StackBlitz) compatibility — install a synchronous
    // AsyncLocalStorage polyfill for better-auth's request-state global
    // BEFORE better-auth ever instantiates its own. See the helper for the
    // full rationale.
    installWebContainerRequestStatePolyfill();

    // Use provided auth instance
    if (config.authInstance) {
      this.auth = config.authInstance;
    }
    // Don't create auth instance automatically to avoid database initialization errors
    // It will be created lazily when needed
  }

  /**
   * Get or create the better-auth instance (lazy initialization)
   */
  private async getOrCreateAuth(): Promise<Auth<any>> {
    if (!this.auth) {
      this.auth = await this.createAuthInstance();
    }
    return this.auth;
  }

  /**
   * Create a better-auth instance from configuration
   */
  private async createAuthInstance(): Promise<Auth<any>> {
    const { betterAuth } = await import('better-auth');
    const { createAuthMiddleware } = await import('better-auth/api');
    const plugins = await this.buildPluginList();
    const passwordHasher = await this.resolvePasswordHasher();
    const betterAuthConfig: BetterAuthOptions = {
      // Base configuration
      secret: this.config.secret || this.generateSecret(),
      // Absolute origin (getCanonicalOrigin prepends https:// when baseUrl is a
      // bare host) so the reset-password / verify-email / magic-link URLs
      // better-auth derives from baseURL are always clickable links.
      baseURL: this.getCanonicalOrigin(),
      basePath: this.config.basePath || '/api/v1/auth',

      // Database adapter configuration
      database: this.createDatabaseConfig(),

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
      },
      account: {
        ...AUTH_ACCOUNT_CONFIG,
        // Allow OIDC/OAuth callbacks to implicitly link the incoming
        // identity to a pre-existing local user when the emails match.
        //
        // ObjectStack's platform SSO ("objectstack-cloud" provider) is the
        // canonical case: cloud is the IdP for every project, so a user
        // arriving via SSO is — by construction — the same person who was
        // auto-seeded as the project owner when the project was created.
        // Without trusting the provider, better-auth's safety check rejects
        // the link with `error=account_not_linked` because the seeded user
        // row has `emailVerified=false` (no actual verification ever runs
        // in the IdP-mediated flow). See packages/plugins/plugin-auth/
        // node_modules/better-auth/dist/oauth2/link-account.mjs:22.
        //
        // Custom-deployment consumers can extend the trusted set via
        // `config.account.accountLinking.trustedProviders`; we always
        // include `objectstack-cloud` because it is the platform IdP.
        accountLinking: {
          enabled: true,
          // better-auth's account-linking gate has TWO independent clauses
          // (see link-account.mjs:22). Trusting the provider only satisfies
          // the first clause; the second — `requireLocalEmailVerified &&
          // !dbUser.user.emailVerified` — still blocks linking when the
          // pre-existing local user row has `emailVerified=false` (the
          // default for owner-seeded rows). Disabling the local-email gate
          // is safe here because the OAuth side is what we actually trust:
          // the incoming identity was verified by the IdP. Consumers who
          // need the stricter behavior can override via config.
          requireLocalEmailVerified: false,
          ...((this.config as any)?.account?.accountLinking ?? {}),
          trustedProviders: Array.from(new Set([
            'objectstack-cloud',
            ...((this.config as any)?.account?.accountLinking?.trustedProviders ?? []),
          ])),
        },
      },
      verification: {
        ...AUTH_VERIFICATION_CONFIG,
      },

      // Social / OAuth providers
      ...(this.config.socialProviders ? { socialProviders: this.config.socialProviders as any } : {}),

      // Email and password configuration.
      // `disableSignUp`: env overrides config/settings so deployments can
      // lock the registration policy without relying on UI state.
      emailAndPassword: (() => {
        const disableSignUpFromEnv = readDisableSignUpEnv();
        // SSO-only ("enforced") forces self-registration off (the managed team
        // signs in via the IdP). `enabled` stays true so the break-glass
        // password endpoint keeps working for the env owner / local admin.
        const effectiveDisableSignUp = this.resolveSsoOnly()
          ? true
          : (disableSignUpFromEnv ?? this.config.emailAndPassword?.disableSignUp);
        return {
          enabled: this.config.emailAndPassword?.enabled ?? true,
          ...(passwordHasher ? { password: passwordHasher } : {}),
          ...(effectiveDisableSignUp != null
            ? { disableSignUp: effectiveDisableSignUp } : {}),
          ...(this.config.emailAndPassword?.requireEmailVerification != null
            ? { requireEmailVerification: this.config.emailAndPassword.requireEmailVerification } : {}),
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
        sendResetPassword: async ({ user, url, token }: { user: { id: string; email: string; name?: string }; url: string; token: string }) => {
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
          const ttlSec = this.config.emailAndPassword?.resetPasswordTokenExpiresIn ?? 60 * 60;
          // Surface both template-resolution throws and transport failures
          // (status:'failed'); resilience is preserved by better-auth's
          // background-task handling (see sendVerificationEmail) and the
          // forget-password route always returns {status:true}, so this never
          // leaks whether an address exists nor turns the request into a 500.
          const result = await email.sendTemplate({
            template: 'auth.password_reset',
            to: { address: user.email, ...(user.name ? { name: user.name } : {}) },
            data: {
              user: { name: user.name || user.email, email: user.email, id: user.id },
              resetUrl: url,
              token,
              expiresInMinutes: Math.round(ttlSec / 60),
              appName: this.getAppName(),
            },
            relatedObject: 'sys_user',
            relatedId: user.id,
          });
          if (result?.status === 'failed') {
            throw new Error(
              `Password-reset email could not be sent to ${user.email}: ${result.error ?? 'delivery failed'}`,
            );
          }
        },
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
          sendVerificationEmail: async ({ user, url, token }: { user: { id: string; email: string; name?: string }; url: string; token: string }) => {
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
            const result = await email.sendTemplate({
              template: 'auth.verify_email',
              to: { address: user.email, ...(user.name ? { name: user.name } : {}) },
              data: {
                user: { name: user.name || user.email, email: user.email, id: user.id },
                verificationUrl: url,
                token,
                expiresInMinutes: Math.round(ttlSec / 60),
                appName: this.getAppName(),
              },
              relatedObject: 'sys_user',
              relatedId: user.id,
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

          // ── ADR-0024: admin-gate self-service SSO provider registration ──
          // `@better-auth/sso`'s POST /sso/register only checks org-admin when
          // `body.organizationId` is present (index.mjs: `if (ctx.body
          // .organizationId) { … hasOrgAdminRole … }`). A GLOBAL (org-less)
          // provider therefore passes with nothing but a valid session — so any
          // authenticated member can register an env-wide external IdP, a JIT-
          // provisioning / login-routing vector. Require the caller to be a
          // platform admin OR an owner/admin of their active org, regardless of
          // whether `organizationId` is supplied. Unauthenticated requests fall
          // through to better-auth's `sessionMiddleware` (→ 401). Fail-CLOSED:
          // an unverifiable actor is denied. (D5.1's `/oauth2/authorize` gate is
          // a different surface — the OP issuing codes, not the env's RP config.)
          if (ctx?.path === '/sso/register') {
            const actor = await this.resolveActor(ctx);
            if (actor?.userId) {
              const ok = await this.isOrgOrPlatformAdmin(actor.userId, actor.activeOrgId);
              if (!ok) {
                const { APIError } = await import('better-auth/api');
                throw new APIError('FORBIDDEN', {
                  message:
                    'Only an organization owner/admin or a platform admin can ' +
                    'register an SSO provider.',
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
            let isLastLocalCredential = false;
            try {
              const adapter = ctx.context.adapter;
              let targetId: string | undefined = ctx?.body?.userId ?? ctx?.body?.user_id;
              if (!targetId && ctx.path === '/delete-user') {
                const { getSessionFromCtx } = await import('better-auth/api');
                const s: any = await getSessionFromCtx(ctx as any).catch(() => null);
                targetId = s?.user?.id ?? s?.session?.userId;
              }
              if (targetId) {
                // Only guard when the target actually holds a local credential —
                // removing a credential-less (managed) user can't cause lockout.
                const targetCred = await adapter.findOne({
                  model: 'account',
                  where: [
                    { field: 'userId', value: targetId },
                    { field: 'providerId', value: 'credential' },
                  ],
                });
                if (targetCred) {
                  const creds: any[] = await adapter.findMany({
                    model: 'account',
                    where: [{ field: 'providerId', value: 'credential' }],
                  });
                  const otherHolders = new Set(
                    (creds ?? [])
                      .map((a: any) => a?.userId ?? a?.user_id)
                      .filter((id: any) => id && id !== targetId),
                  );
                  isLastLocalCredential = otherHolders.size === 0;
                }
              }
            } catch {
              // Fail-open — never block a legitimate op on a lookup error.
            }
            if (isLastLocalCredential) {
              const { APIError } = await import('better-auth/api');
              throw new APIError('CONFLICT', {
                message:
                  'Cannot remove the last local password login. At least one ' +
                  'break-glass account with a password must remain so an identity-' +
                  'provider outage can never lock the organization out. Add another ' +
                  'local password first, then retry.',
                code: 'LAST_LOCAL_CREDENTIAL',
              });
            }
            // fall through to better-auth's own handler
          }

          // ── ADR-0069 D2: account lockout (gate) ─────────────────────
          // Reject a sign-in for a locked identity BEFORE better-auth checks
          // the password — a lock must hold even against the correct password.
          if (ctx?.path === '/sign-in/email') {
            const email = typeof ctx?.body?.email === 'string' ? ctx.body.email : '';
            if (email) await this.assertAccountNotLocked(email);
            return;
          }

          if (ctx?.path !== '/sign-up/email') return;
          const ep = ctx?.context?.options?.emailAndPassword;
          if (!ep?.disableSignUp) return;
          try {
            const adapter = ctx.context.adapter;
            const existing = await adapter.findOne({ model: 'user', where: [] });
            if (!existing) {
              ctx.context.__osDisableSignUpOrig = ep.disableSignUp;
              ep.disableSignUp = false;
            }
          } catch {
            // Adapter not ready → keep disableSignUp on.
          }
        }),
        after: createAuthMiddleware(async (ctx: any) => {
          // ── ADR-0069 D2: account lockout (counter) ──────────────────
          // better-auth catches an INVALID_EMAIL_OR_PASSWORD APIError and runs
          // the after-hook with it on `ctx.context.returned`; a success leaves
          // the session payload there. Count failures, reset on success.
          if (ctx?.path === '/sign-in/email') {
            const email = typeof ctx?.body?.email === 'string' ? ctx.body.email : '';
            if (email) {
              let succeeded = true;
              try {
                const { isAPIError } = await import('better-auth/api');
                succeeded = !isAPIError(ctx?.context?.returned);
              } catch {
                succeeded = !(ctx?.context?.returned instanceof Error);
              }
              await this.recordSignInOutcome(email, succeeded);
              if (succeeded) {
                const uid = ctx?.context?.returned?.user?.id;
                if (typeof uid === 'string') await this.enforceConcurrentCap(uid);
                // ADR-0069 D7 — login audit: stamp last_login_at/ip on success.
                // Independent of lockout config (recordSignInOutcome no-ops when
                // lockout is off). IP from the trusted forwarded headers, same
                // precedence as the D5 allow-list middleware.
                if (typeof uid === 'string') {
                  const hdr = (k: string): string =>
                    ((ctx?.headers?.get?.(k) ?? ctx?.request?.headers?.get?.(k)) as string) || '';
                  const fwd = hdr('x-forwarded-for');
                  const ip =
                    (fwd && fwd.split(',')[0].trim()) ||
                    hdr('cf-connecting-ip') ||
                    hdr('x-real-ip') ||
                    undefined;
                  await this.stampLastLogin(uid, ip);
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
            if (signupOk && typeof newUserId === 'string') await this.stampPasswordChangedAt(newUserId);
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
        // Sync with OS_CORS_ORIGIN env var (comma-separated)
        const corsOrigin = readEnvWithDeprecation('OS_CORS_ORIGIN', 'CORS_ORIGIN', { silent: true });
        if (corsOrigin && corsOrigin !== '*') {
          corsOrigin.split(',').map(s => s.trim()).filter(Boolean).forEach(o => {
            if (!origins.includes(o)) origins.push(o);
          });
        }
        // When CORS allows all origins (default) and no explicit trustedOrigins,
        // trust all localhost ports in development for convenience. Also trust
        // `*.localhost` subdomains so per-project tenant subdomains (the dev
        // default root domain — see project-provisioning.ts) pass CSRF checks
        // without operators having to configure trustedOrigins manually.
        if (!origins.length && (!corsOrigin || corsOrigin === '*')) {
          origins.push('http://localhost:*');
          origins.push('http://*.localhost:*');
          origins.push('https://*.localhost:*');
        }
        // ── ADR-0024: runtime self-service external-IdP registration ───────
        // `@better-auth/sso`'s `validateDiscoveryUrl` requires the IdP's
        // *discovery* origin to be in `trustedOrigins` — even for a publicly-
        // routable IdP (stricter than its own sub-endpoint check, which allows
        // any public host). Without help that breaks ADR-0024's "register your
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

      // Advanced options (cross-subdomain cookies, secure cookies, CSRF, etc.)
      ...(this.config.advanced ? {
        advanced: {
          ...(this.config.advanced.crossSubDomainCookies
            ? { crossSubDomainCookies: this.config.advanced.crossSubDomainCookies } : {}),
          ...(this.config.advanced.useSecureCookies != null
            ? { useSecureCookies: this.config.advanced.useSecureCookies } : {}),
          ...(this.config.advanced.disableCSRFCheck != null
            ? { disableCSRFCheck: this.config.advanced.disableCSRFCheck } : {}),
          ...(this.config.advanced.cookiePrefix != null
            ? { cookiePrefix: this.config.advanced.cookiePrefix } : {}),
        },
      } : {}),
    };

    return betterAuth(betterAuthConfig);
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
  private async addOptionalPlugin(
    plugins: any[],
    feature: string,
    build: () => Promise<any | any[]>,
  ): Promise<void> {
    try {
      const built = await build();
      for (const p of Array.isArray(built) ? built : [built]) plugins.push(p);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.degradedFeatures.set(feature, message);
      console.error(
        `[AuthManager] Optional auth feature "${feature}" failed to initialize and is DISABLED ` +
        `for this process — its endpoints will 404. Core email/password + session auth is unaffected. ` +
        `Fix the underlying error (often a better-auth version mismatch) and restart. Cause: ${message}`,
        err,
      );
    }
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
   *    fallback. On a host without Ed25519 we install better-auth's
   *    `adapter.getJwks` keyring seam so unusable keys are not offered at all
   *    and a fresh ES256 key is minted instead. Rows are hidden, never
   *    deleted — moving back to a host with Ed25519 restores them.
   *
   * Belt-and-braces, on every host: a signing failure degrades the
   * `set-auth-jwt` header instead of 500ing `/get-session`.
   */
  private async buildJwtPlugin(jwt: (options: any) => any): Promise<any> {
    if (!this.ed25519ProbeResult) this.ed25519ProbeResult = probeEd25519Support();
    const { keyPairConfig, ed25519Supported } = await resolveJwtSigningAlgorithm(
      () => this.ed25519ProbeResult!,
    );

    if (!ed25519Supported) {
      // Functional, not durability: the deployment is fully operational on
      // ES256. Worth one line because it changes what /jwks publishes and what
      // `alg` issued tokens carry, which an operator debugging a relying party
      // otherwise cannot correlate to anything.
      console.warn(
        `[AuthManager] This host's WebCrypto has no Ed25519 (crypto.subtle.generateKey({name:'Ed25519'}) fails), ` +
          `so JWTs are signed with ${keyPairConfig.alg} instead of better-auth's default EdDSA. ` +
          `Any existing EdDSA key in sys_jwks is hidden from the JWKS on this host — it cannot be imported here — ` +
          `and a fresh ${keyPairConfig.alg} key is minted on first use. The rows are not deleted.`,
      );
    }

    const jwtPlugin = jwt({
      schema: buildJwtPluginSchema(),
      jwks: { keyPairConfig },
      // The keyring override is installed ONLY on a host that needs it, so a
      // normal deployment runs better-auth's stock read path with no
      // ObjectStack code in it and nothing to regress.
      ...(ed25519Supported
        ? {}
        : { adapter: { getJwks: createHostUsableJwksReader() } }),
    });

    const protectedHook = protectGetSessionJwtHook(jwtPlugin, (error) =>
      this.reportJwtSigningFailure(error, keyPairConfig.alg),
    );
    if (!protectedHook) {
      // The guard could not attach — better-auth moved or renamed the hook.
      // Say so rather than shipping a build that looks protected and is not.
      console.error(
        '[AuthManager] Could not attach the JWT signing guard to better-auth\'s /get-session hook ' +
          '(its `hooks.after` shape changed). A JWT signing failure will now 500 every /get-session ' +
          'instead of degrading to a missing set-auth-jwt header. See objectstack#3585 and re-check ' +
          'the better-auth version in better-auth-schema-parity.test.ts.',
      );
    }

    return jwtPlugin;
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
    const message = (error as any)?.message ?? String(error);
    this.degradedFeatures.set('jwtSigning', message);
    if (this.jwtSigningFailureReported) return;
    this.jwtSigningFailureReported = true;
    console.error(
      `[AuthManager] JWT signing failed with alg "${alg}", so /get-session responses carry no ` +
        `set-auth-jwt header and OIDC/MCP token issuance will not work. The session itself is valid — ` +
        `sign-in and cookie auth are unaffected. Common causes: this host's WebCrypto cannot use the ` +
        `algorithm of the key in sys_jwks, or OS_AUTH_SECRET changed since the key was encrypted. ` +
        `Set OS_OIDC_PROVIDER_ENABLED=false if this deployment does not need to act as an IdP. ` +
        `Cause: ${message}`,
      error,
    );
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
    const ssoFromEnv = readBooleanEnv('OS_SSO_ENABLED');
    const scimFromEnv = readBooleanEnv('OS_SCIM_ENABLED');
    // Opt-in DNS domain-verification for external SSO providers (ADR-0024 ②).
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
    // forces `admin` on (organization already defaults on). See ADR-0071.
    const scimEffective = scimFromEnv ?? (pluginConfig as any).scim ?? false;
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
      sso: ssoFromEnv ?? (pluginConfig as any).sso ?? false,
      ssoDomainVerification: ssoDomainVerifyFromEnv ?? (pluginConfig as any).ssoDomainVerification ?? false,
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
          customOrgRoles = built;
        }
      } catch {
        customOrgRoles = undefined;
      }
      return organization({
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
              });
            }
            if (!this.multiOrgPostureEffective()) {
              const { APIError } = await import('better-auth/api');
              throw new APIError('FORBIDDEN', {
                message:
                  'Creating additional organizations is disabled on this deployment.',
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
            const inviterUserId = inviter?.id ?? inviter?.userId ?? null;
            const organizationId = organization?.id ?? invitation?.organizationId;

            // [#3697] Role cap — FIRST, and for EVERY invitation, placement or
            // not: the escalation it closes (invite an `admin`, acceptance
            // auto-elevates to `organization_admin` → tenant admin) needs no
            // placement intent at all. Skipped for a plain `member` invitation,
            // which can never trip the cap — so the ordinary path pays nothing.
            if (!isPlainMemberInvitation(invitation?.role)) {
              const capFailure = invitationRoleCapFailure(
                invitation?.role,
                await this.resolveMembershipRole(inviterUserId, organizationId),
              );
              if (capFailure) {
                const { APIError } = await import('better-auth/api');
                throw new APIError('FORBIDDEN', { message: capFailure });
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
              const { APIError } = await import('better-auth/api');
              throw new APIError('FORBIDDEN', {
                message: err?.message ?? 'Invitation placement is outside your delegated administration scope.',
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

            const dataEngine = this.config.dataEngine as any;
            if (!dataEngine) return;

            let currentSlug: string | undefined;
            try {
              const current = await dataEngine.findOne('sys_organization', {
                where: { id: orgId },
              });
              currentSlug = current?.slug;
            } catch {
              return;
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
            } catch {
              return;
            }

            if (activeEnvs > 0) {
              const { APIError } = await import('better-auth/api');
              throw new APIError('FORBIDDEN', {
                message:
                  `Cannot change organization slug while ${activeEnvs} active ` +
                  `environment(s) still reference it. Archive those environments ` +
                  `or rename their hostnames first.`,
              });
            }
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
          try {
            await emailService.sendTemplate({
              template: 'auth.invitation',
              to: recipientEmail,
              data: {
                inviter: {
                  name: inviter?.user?.name ?? inviter?.user?.email ?? 'A teammate',
                  email: inviter?.user?.email ?? '',
                },
                organization: { name: org?.name ?? invitation.organizationId },
                role: invitation.role || '',
                acceptUrl,
                appName: this.getAppName(),
              },
              relatedObject: 'sys_invitation',
              relatedId: invitation.id,
            });
          } catch (err: any) {
            // Do NOT rethrow: the invitation row was already persisted by
            // better-auth; an email-transport failure must not turn the
            // invite request into a 500. The admin can resend the invite.
            console.error(`[AuthManager] sendInvitationEmail failed (swallowed): ${err?.message ?? err}`);
          }
        },
      });
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
        return admin({
          schema: buildAdminPluginSchema(),
        });
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
      // (NOT_SUPPORTED) instead of silently logging. signUpOnVerification
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
      return magicLink({
        sendMagicLink: async ({ email: recipientEmail, url, token }) => {
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
          try {
            await emailService.sendTemplate({
              template: 'auth.magic_link',
              to: recipientEmail,
              data: {
                magicLinkUrl: url,
                token,
                expiresInMinutes: 10,
                appName: this.getAppName(),
              },
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
        // better-auth's oauth-provider cannot see the well-known documents we
        // mount ourselves at the issuer ROOT (RFC 8414 §3 requires them there,
        // not under the auth basePath) — registerOidcDiscoveryRoutes serves
        // /.well-known/oauth-authorization-server AND the path-insertion variant
        // (`…/api/v1/auth`) the notice names. Its "Please ensure … exists"
        // reminder is therefore a false positive on every stock example.
        //
        // #3420 root cause of the DOUBLE print: the notice fires in the
        // oauth-provider plugin's `init(ctx)`, which better-auth runs once per
        // `betterAuth()` construction — and the instance is built more than once
        // at boot (an initial lazy build, then a rebuild once boot-time auth
        // *settings* are applied — applyConfigPatch() nulls the cached instance
        // so the next request rebuilds with the new policy). Gating the emitter
        // here silences the one requirement we've already satisfied across every
        // build path, independent of how many times auth is constructed, so an
        // official dev boot stays warning-free.
        silenceWarnings: { oauthAuthServerConfig: true },
        // ── MCP OAuth track (#2698) ────────────────────────────────
        // Coarse tool-family scopes for the platform's own MCP endpoint,
        // advertised alongside the standard OIDC scopes. Names are
        // single-sourced in @objectstack/spec so AS / resource server /
        // tool layer cannot drift.
        scopes: ['openid', 'profile', 'email', 'offline_access', ...MCP_OAUTH_SCOPES],
        // MCP clients bind tokens to the resource via RFC 8707
        // (`resource=<mcp url>`); the AS only mints audiences it knows.
        // The auth base (better-auth's default audience) stays valid for
        // plain OIDC SSO flows.
        validAudiences: [this.getAuthIssuer(), this.getMcpResourceUrl()],
        // RFC 7591 Dynamic Client Registration. `allowUnauthenticated…` is
        // required: MCP clients register BEFORE any user is logged in (the
        // whole point of the self-serve flow). Registration is rate-limited
        // by the plugin, clients get only the scopes advertised above, and
        // every token still requires an interactive PKCE login + consent —
        // an anonymous registration mints no authority by itself.
        allowDynamicClientRegistration: dcr,
        allowUnauthenticatedClientRegistration: dcr,
      })];
      });
    }

    // External SSO (OIDC / SAML) relying-party — lets this environment federate
    // login to a customer's own IdP (Okta / Entra / Google …). Per-env, runtime-
    // registered providers live in `sys_sso_provider` (ADR-0024: the OPEN SSO
    // mechanism — cloud-free for self-host). Endpoints mount under
    // /api/v1/auth/sso/{register,providers,delete-provider,callback,…}.
    //
    // Toggle with `OS_SSO_ENABLED` (mirrors `OS_OIDC_PROVIDER_ENABLED`).
    if (enabled.sso) {
      await this.addOptionalPlugin(plugins, 'sso', async () => {
      const { sso } = await import('@better-auth/sso');
      // NOTE: the `ssoProvider` model is bridged to `sys_sso_provider` by the
      // better-auth adapter / a global model map, not per-plugin here (see
      // AUTH_SSO_PROVIDER_SCHEMA).
      //
      // That bridge dates from 1.6.20, where @better-auth/sso hardcoded the
      // model and read no `schema` option. Re-checked against the pinned
      // 1.7.0-rc.2 (`node_modules/@better-auth/sso/dist`) on 2026-08-12: that is
      // no longer true — `SSOOptions.schema.ssoProvider` now exists
      // (index-D1yk91me.d.mts) and the runtime honours `modelName` plus a
      // per-field `fieldName` map (index.mjs, the plugin's `schema:` block). The
      // adapter-level bridge is kept as-is here because it is what the rest of
      // the auth stack is wired to; whether to move it onto the plugin option is
      // a separate change, not a silent one. Only the mapping surface below was
      // re-verified in depth — see register-sso-provider.ts for the
      // `oidcConfig.mapping` strict-object findings.
      //
      // `organizationProvisioning.defaultRole` (ADR-0024 V1): a first-time
      // federated login is JIT-provisioned into the user's domain-matched org
      // with this role, so a member who arrives via an external IdP lands with
      // an explicit default role (belt-and-suspenders over SecurityPlugin's
      // `member_default` fallback, which already grants baseline access to any
      // authenticated user). Requires the `organization` plugin — on by default.
      // `domainVerification.enabled` (ADR-0024 ②, opt-in via OS_SSO_DOMAIN_VERIFICATION):
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
    // (the paid Identity lifecycle, ADR-0071). The env is the SCIM Service
    // Provider; endpoints mount under /api/v1/auth/scim/v2/{Users,…} (SCIM 2.0)
    // and /api/v1/auth/scim/{generate-token,…} (management). `active:false` →
    // ban + session revoke (needs the admin plugin, forced on above); org-scoped
    // tokens need the organization plugin. Like @better-auth/sso it hardcodes
    // its `scimProvider` model (no schema option) — bridged to `sys_scim_provider`
    // via AUTH_MODEL_TO_PROTOCOL. Toggle with `OS_SCIM_ENABLED`.
    //
    // storeSCIMToken: 'hashed' — never persist the bearer in cleartext; the
    // plaintext is returned exactly once from generate-token (for the IdP admin).
    if (enabled.scim) {
      await this.addOptionalPlugin(plugins, 'scim', async () => {
        const { scim } = await import('@better-auth/scim');
        return scim({ storeSCIMToken: 'hashed' });
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
    // `roles: string[]` array (ADR-0068 D1/D2): the stored `user.role` scalar
    // split on commas, PLUS the active membership mapped to canonical
    // `org_owner`/`org_admin`/`org_member`, PLUS `platform_admin` when the user
    // holds the admin_full_access permission set. `user.isPlatformAdmin` is a
    // derived alias of `'platform_admin' in positions`.
    //
    // IMPORTANT: `user.role` is NOT overwritten anymore — consumers must gate
    // on `positions[]` / `isPlatformAdmin` (e.g. via objectui's useIsWorkspaceAdmin),
    // never on `user.role === 'admin'`. Consumers that match individual role
    // names (e.g. the Console approvals inbox resolving `role:<name>` approvers)
    // also read `positions` — business names such as `manager` survive only there.
    // The raw membership role stays on the organization plugin's `member` payload.
    //
    // Better-auth's `sys_user` table doesn't carry a `role` column. We derive
    // it from two sources:
    //
    //   1. **Platform admin** — a `sys_user_permission_set` row that points at
    //      the `admin_full_access` permission set with `organization_id = null`
    //      (seeded by `bootstrapPlatformAdmin`).
    //   2. **Organization admin** — a `sys_member` row in the user's *active*
    //      organization (`session.activeOrganizationId`) with role `owner` or
    //      `admin`. Org owners/admins are entitled to manage org-scoped
    //      metadata such as saved list views, dashboards, etc.
    //
    // ADR-0068 D2: rather than synthesizing `user.role = 'admin'`, both paths now
    // contribute CANONICAL names to `user.positions` (platform_admin / org_*),
    // and `user.isPlatformAdmin` is a derived alias. The raw membership role
    // remains available via the `organization` plugin's `member` payload.
    const dataEngine = this.config.dataEngine;
    if (dataEngine) {
      const { customSession } = await import('better-auth/plugins/custom-session');
      plugins.push(customSession(async ({ user, session }) => {
        if (!user?.id) return { user, session };

        const isPlatformAdmin = async (): Promise<boolean> => {
          try {
            const links = await dataEngine.find('sys_user_permission_set', {
              where: { user_id: user.id },
              limit: 50,
            });
            const platformLinks = (Array.isArray(links) ? links : []).filter(
              (l: any) => !l.organization_id,
            );
            if (platformLinks.length === 0) return false;
            const sets = await dataEngine.find('sys_permission_set', { limit: 50 });
            const adminSet = (Array.isArray(sets) ? sets : []).find(
              (r: any) => r.name === 'admin_full_access',
            );
            if (!adminSet) return false;
            return platformLinks.some(
              (l: any) => l.permission_set_id === adminSet.id,
            );
          } catch {
            return false;
          }
        };

        // ADR-0068 D2 — surface CANONICAL org_* role names (not a boolean flag):
        // a membership owner/admin/member maps to org_owner/org_admin/org_member.
        const activeOrgRoles = async (): Promise<string[]> => {
          try {
            const orgId = (session as any)?.activeOrganizationId;
            if (!orgId) return [];
            const members = await dataEngine.find('sys_member', {
              where: { user_id: user.id, organization_id: orgId },
              limit: 5,
            });
            const out: string[] = [];
            for (const m of (Array.isArray(members) ? members : [])) {
              const raw = typeof m?.role === 'string' ? m.role : '';
              for (const r of raw.split(',').map((s: string) => s.trim()).filter(Boolean)) {
                const mapped = mapMembershipRole(r);
                if (!out.includes(mapped)) out.push(mapped);
              }
            }
            return out;
          } catch {
            return [];
          }
        };

        // ADR-0068 D1/D2 (renamed ADR-0090 D3) — emit ONE canonical
        // positions[] (identity names + position names), with NO singular
        // overwrite. isPlatformAdmin is a DERIVED alias of
        // `'platform_admin' in positions`, retained for back-compat clients.
        const platformAdmin = await isPlatformAdmin();
        const orgRoles = await activeOrgRoles();
        const storedRole = typeof (user as any).role === 'string' ? (user as any).role : '';
        const positions = Array.from(new Set([
          ...storedRole.split(',').map((s: string) => s.trim()).filter(Boolean),
          ...orgRoles,
          ...(platformAdmin ? [BUILTIN_IDENTITY_PLATFORM_ADMIN] : []),
        ]));

        // ADR-0069 — authentication-policy gate posture (password expiry,
        // enforced MFA). Computed only when a gate feature is enabled (else
        // zero extra reads on the hot path); surfaced as `user.authGate` for
        // the transport seams to enforce. See computeAuthGate().
        // ADR-0069 D4 — session controls (idle / absolute). Best-effort;
        // revokes the session in place when exceeded (next request → 401).
        await this.enforceSessionControls((session as any)?.id, (session as any)?.createdAt);

        const authGate = await this.computeAuthGate(
          user.id,
          (session as any)?.activeOrganizationId,
          (user as any)?.twoFactorEnabled === true,
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
  private createDatabaseConfig(): any {
    // Use ObjectQL adapter factory if dataEngine is provided
    if (this.config.dataEngine) {
      // createObjectQLAdapterFactory returns an AdapterFactory
      // (options => DBAdapter) which better-auth invokes via getBaseAdapter().
      // The factory is created by better-auth's createAdapterFactory and
      // automatically applies modelName/fields transformations declared in
      // the betterAuth config above.
      return createObjectQLAdapterFactory(this.config.dataEngine);
    }

    // Fallback warning if no dataEngine is provided
    console.warn(
      '⚠️  WARNING: No dataEngine provided to AuthManager! ' +
      'Using in-memory storage. This is NOT suitable for production. ' +
      'Please provide a dataEngine instance (e.g., ObjectQL) in AuthManagerOptions.'
    );

    // Return a minimal in-memory configuration as fallback
    // This allows the system to work in development/testing without a real database
    return undefined; // better-auth will use its default in-memory adapter
  }

  /**
   * Generate a secure secret if not provided
   */
  private generateSecret(): string {
    const envSecret = readEnvWithDeprecation('OS_AUTH_SECRET', ['AUTH_SECRET', 'BETTER_AUTH_SECRET'], { silent: true });
    if (envSecret) return envSecret;

    // No secret configured. In production this is FATAL: a predictable
    // `dev-secret-<timestamp>` makes session tokens forgeable (session
    // forgery). Refuse to boot rather than run insecurely.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[auth] OS_AUTH_SECRET is required in production but is not set. ' +
        'Refusing to boot with a temporary development secret — session tokens ' +
        'would be forgeable. Set OS_AUTH_SECRET to a strong random value.'
      );
    }

    // Development / test only: fall back to an ephemeral secret, loudly.
    const fallbackSecret = 'dev-secret-' + Date.now();
    console.warn(
      '⚠️  WARNING: No OS_AUTH_SECRET environment variable set! ' +
      'Using a temporary development secret. ' +
      'This is NOT secure for production use. ' +
      'Please set OS_AUTH_SECRET in your environment variables.'
    );
    return fallbackSecret;
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
    if (this.auth) {
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
  applyConfigPatch(patch: Partial<AuthManagerOptions>): void {
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

    this.config = next;
    if (this.auth && !patch.authInstance) {
      this.auth = null;
    }
  }

  /**
   * ADR-0093 D1 — the deployment's membership policy **as it stands right now**.
   *
   * The ONE source both membership paths read (#5152):
   *   - sign-up: the reconciler composed into `user.create.after` (below);
   *   - backfill: `AuthPlugin`'s ADR-0093 D6 pass over pre-existing member-less
   *     users, which used to read the plugin's CONSTRUCTOR options instead.
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
    if (!this._otpSendGuard) {
      const otpCfg = this.config.phoneOtp ?? {};
      // WHERE the budget is counted decides whether it is a budget at all
      // (#4790): counted per process, a declared "5 per hour" is 5×N across N
      // nodes. Precedence, most deliberate first:
      //  1. a host-supplied `secondaryStorage` — an explicit cross-node KV;
      //  2. `sharedCounterStore` — AuthPlugin's lazily-resolved kernel `cache`,
      //     which also announces the degraded (no cache) case loudly;
      //  3. neither → the guard's own bounded per-process store.
      const storeOption = this.config.secondaryStorage
        ? { storage: this.config.secondaryStorage }
        : this.config.sharedCounterStore
          ? { resolveStore: this.config.sharedCounterStore }
          : {};
      this._otpSendGuard = new OtpSendGuard({
        ...(otpCfg.cooldownSeconds != null ? { cooldownSeconds: otpCfg.cooldownSeconds } : {}),
        ...(otpCfg.maxPerHour != null ? { maxPerHour: otpCfg.maxPerHour } : {}),
        ...storeOption,
      });
    }
    return this._otpSendGuard;
  }

  /**
   * #2780 — admission check for the OTP send endpoints, called from the
   * `hooks.before` middleware (see the `/phone-number/*` branch there for
   * why it cannot live in the `sendOTP` callback). Consumes one unit of the
   * per-number budget and throws TOO_MANY_REQUESTS when the cooldown /
   * hourly cap is exhausted. No-op while OTP is undeliverable — the send
   * callback then fails loudly with NOT_SUPPORTED instead.
   */
  async assertPhoneOtpSendAllowed(phone: string): Promise<void> {
    if (!phone || !this.isPhoneOtpDeliverable()) return;
    const decision = await this.getOtpSendGuard().checkAndRecord(phone);
    if (!decision.ok) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('TOO_MANY_REQUESTS', {
        message: `Too many verification codes requested for this phone number. Retry in ${decision.retryAfterSeconds ?? 60}s.`,
      });
    }
  }

  /**
   * #2780 — deliver a phone OTP through the SMS service.
   *
   * Security posture (all named requirements of #2780):
   *  - No SMS service ⇒ throw NOT_SUPPORTED (loud, like the pre-SMS wiring).
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
  private async deliverPhoneOtp(phone: string, code: string): Promise<void> {
    const sms = this.getSmsService();
    if (!sms || !this.isPhoneOtpDeliverable()) {
      // Absent service, or a log-only transport in production (the code
      // would vanish into a log no user can read) — fail loudly, exactly
      // like the pre-SMS wiring.
      throw new Error(
        'NOT_SUPPORTED: phone-number OTP requires a configured SMS delivery service. ' +
        'Phone sign-in is password-based (POST /sign-in/phone-number).',
      );
    }
    const otpCfg = this.config.phoneOtp ?? {};
    const minutes = Math.max(1, Math.round((otpCfg.expiresIn ?? 300) / 60));
    // #2815 — localised, tenant-customisable body: a sys_notification_template
    // row for (auth.phone_otp, sms, deployment locale) wins; the built-in
    // bilingual text is the fallback. Purpose-neutral wording on purpose —
    // one provider template covers sign-in and reset, and the SMS reveals
    // nothing about what the code unlocks.
    const body = await this.renderPhoneSmsBody(PHONE_SMS_TOPICS.otp, {
      code,
      appName: this.getAppName(),
      minutes,
    });
    const result = await sms.send({
      to: phone,
      body,
      // Template-only providers (Aliyun) substitute into a registered OTP
      // template; `code` is the conventional variable name.
      templateParams: { code },
    });
    if (result.status === 'failed') {
      // #6039 — the deployment's daily SMS quota refused this send. Answer it
      // the way the per-number wall on this same endpoint answers: a real
      // `APIError`, hence 429 TOO_MANY_REQUESTS instead of a 500 with a null
      // body. Everything else stays a plain Error — a transport outage IS a
      // server-side failure and 500 is the honest answer for it.
      if (isSmsQuotaRefusal(result.error)) {
        throw await smsQuotaExceededApiError(
          'Too many verification codes requested. Please try again later.',
        );
      }
      // `result.error` is transport detail (never the code) — safe to surface.
      throw new Error(`Phone OTP could not be sent: ${result.error ?? 'SMS delivery failed'}`);
    }
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
  async sendPhoneInviteSms(phone: string): Promise<void> {
    const sms = this.getSmsService();
    if (!sms) {
      throw new Error('SMS_SERVICE_REQUIRED: no SMS service is configured for this deployment.');
    }
    // #2815 — localised, tenant-customisable body (see deliverPhoneOtp).
    // `loginUrl` points at the actual Console sign-in page; `baseUrl` (bare
    // origin) is kept for backward-compatibility with tenant-overridden
    // templates that still interpolate `{{baseUrl}}`.
    const body = await this.renderPhoneSmsBody(PHONE_SMS_TOPICS.invite, {
      appName: this.getAppName(),
      baseUrl: this.getCanonicalOrigin(),
      loginUrl: this.getConsolePageUrl('/login'),
    });
    const result = await sms.send({ to: phone, body, templateParams: { content: body } });
    if (result.status === 'failed') {
      // #6039 — same quota wall, same outward shape as the OTP path above.
      // (The one in-repo caller, admin import-users, catches this per row and
      // records INVITE_SMS_FAILED rather than failing the request — so what
      // changes there is that the row's message no longer carries the raw
      // service envelope. The 429 matters for any caller that surfaces this
      // rejection directly, which is what a public AuthManager method must be
      // correct for.)
      if (isSmsQuotaRefusal(result.error)) {
        throw await smsQuotaExceededApiError(
          'Too many SMS messages requested. Please try again later.',
        );
      }
      throw new Error(`Invitation SMS failed: ${result.error ?? 'SMS delivery failed'}`);
    }
  }

  /**
   * #2815 — the deployment-default locale for auth SMS bodies, sourced from
   * the live `localization.locale` setting. AuthPlugin pushes it on
   * `kernel:ready` and on every settings change (same pattern as
   * {@link setAppName}). Unset ⇒ the built-in English text.
   *
   * Per-user locale is not resolved yet — `sys_user` carries no locale
   * column; when it grows one, resolution should prefer it (#2815).
   */
  setDefaultSmsLocale(locale: string | undefined): void {
    this.smsLocale = locale?.trim() || undefined;
  }
  private smsLocale?: string;

  /**
   * #2815 — resolve an auth SMS body: the tenant's
   * `sys_notification_template` row for `(topic, 'sms', locale chain)` when
   * one exists, else the built-in bilingual text. Template lookups are
   * best-effort — an outage must never block an OTP send.
   */
  private async renderPhoneSmsBody(topic: string, data: Record<string, unknown>): Promise<string> {
    const template =
      (await loadPhoneSmsTemplateBody(this.getDataEngine(), topic, this.smsLocale)) ??
      builtinPhoneSmsBody(topic, this.smsLocale);
    return interpolatePhoneSms(template, data);
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
   */
  setAppName(name: string | undefined): void {
    this.appNameOverride = name?.trim() || undefined;
  }
  private appNameOverride?: string;

  /** @internal `{{appName}}` placeholder value for built-in templates. */
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
   * @returns Web standard Response object
   */
  async handleRequest(request: Request): Promise<Response> {
    // Dev DX: better-auth's CSRF protection rejects state-changing requests
    // (e.g. `/sign-in/email`) with a 403 when neither `Origin` nor `Referer`
    // is present. Browsers always send one; non-browser API clients (curl,
    // fetch from a script, integration tests) often don't, so they hit an
    // opaque 403 in local dev. A request with *no* Origin header is never a
    // browser-driven cross-site attack — CSRF is fundamentally cross-origin —
    // so in non-production we synthesize a same-origin `Origin` from the
    // request URL. It matches the dev localhost trusted-origins set, so the
    // CSRF check passes without weakening protection in production (gated on
    // NODE_ENV, the same dev signal used for the fallback auth secret above).
    if (
      process.env.NODE_ENV !== 'production' &&
      !request.headers.get('origin') &&
      !request.headers.get('referer')
    ) {
      try {
        const headers = new Headers(request.headers);
        headers.set('origin', new URL(request.url).origin);
        request = new Request(request, { headers });
      } catch {
        /* malformed URL — leave the request untouched */
      }
    }

    const auth = await this.getOrCreateAuth();
    // better-auth's HTTP entrypoint (`createBetterAuth.handler`) wraps execution
    // in `runWithAdapter` but NOT `runWithRequestState`. Endpoints that read
    // request-state via `defineRequestState()` (e.g. `should-session-refresh`,
    // `oauth`) therefore throw "No request state found" when reached via HTTP.
    // The `customSession` plugin triggers this by invoking the inner
    // `getSession()` endpoint directly, bypassing `to-auth-endpoints`'
    // auto-wrap. We establish the ALS store here so all downstream endpoint
    // calls inherit a valid request-state WeakMap.
    const { runWithRequestState } = await import('@better-auth/core/context');
    // [#4586] Open the actor-attribution scope around the WHOLE request, so
    // every write better-auth makes on the way — adapter writes, the
    // membership reconciler in `user.create.after`, anything a plugin hook
    // triggers — can be credited to the human who made the request. Opening it
    // costs nothing: the scope starts empty, the before-hook drops a resolver
    // in, and the session is looked up only if some write asks. Attribution
    // only — the authorization subject of those writes is unchanged (system).
    // `await`, not a bare return: both scope helpers are generic over their
    // callback, so the composed call is typed `Promise< Promise< Response > >`.
    // The previous single call site flattened it with the `await` below.
    const runHandler = async (): Promise<Response> =>
      await runWithAuthActorScope(() =>
        runWithRequestState(new WeakMap(), () => auth.handler(request)),
      );

    // [#7724] A subject-erasure request is ONE unit of work, and better-auth
    // does not treat it as one: `internalAdapter.deleteUser` deletes the
    // sessions, then the accounts, then the user, in three unrelated adapter
    // calls with no transaction (verified in better-auth 1.7.0-rc.2 —
    // `dist/db/internal-adapter.mjs` mentions no transaction at all). Anything
    // that refuses the LAST of those three leaves the first two committed: the
    // credential rows are gone, the `sys_user` row is not, and the deployment
    // is left with an identity that still occupies the org roster and can no
    // longer sign in. Nothing tells the operator, and there is no way back.
    const endpointPath = this.betterAuthEndpointPath(request);
    const response =
      endpointPath !== undefined && SESSION_ERASURE_PATHS.has(endpointPath)
        ? await this.runSubjectErasureAtomically(runHandler)
        : await runHandler();

    if (response.status >= 500) {
      try {
        const body = await response.clone().text();
        console.error('[AuthManager] better-auth returned error:', response.status, body);
      } catch {
        console.error('[AuthManager] better-auth returned error:', response.status, '(unable to read body)');
      }
    }

    return response;
  }

  /**
   * The better-auth endpoint path (`/admin/remove-user`) this request addresses,
   * or `undefined` when it is not under the configured `basePath`.
   *
   * The same spelling better-auth's own `ctx.path` uses, so the sets keyed by it
   * — `SESSION_ERASURE_PATHS`, the break-glass guard's path tests — are all
   * talking about one thing.
   */
  private betterAuthEndpointPath(request: Request): string | undefined {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return undefined;
    }
    const configured = this.config.basePath || '/api/v1/auth';
    const base = (configured.startsWith('/') ? configured : `/${configured}`).replace(/\/+$/, '');
    if (!pathname.startsWith(base)) return undefined;
    const endpoint = pathname.slice(base.length).replace(/\/+$/, '');
    return endpoint.startsWith('/') ? endpoint : undefined;
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

  /** Cached JWKS for local access-token verification (5-minute TTL). */
  private jwksCache?: { jwks: any; fetchedAtMs: number };
  private static readonly JWKS_CACHE_TTL_MS = 5 * 60_000;

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
   * The OAuth issuer identifier: better-auth's `baseURL` INCLUDING `basePath`
   * (e.g. `https://acme.example.com/api/v1/auth`) — this is the `iss` claim
   * the jwt plugin stamps on access tokens and what the AS metadata reports.
   */
  getAuthIssuer(): string {
    const basePath = this.config.basePath || '/api/v1/auth';
    return `${this.getCanonicalOrigin()}${basePath.startsWith('/') ? basePath : `/${basePath}`}`;
  }

  /**
   * The MCP resource identifier (RFC 8707 `resource` / token `aud`):
   * `<origin><apiPrefix>/mcp`. Derived from the auth basePath so the two can
   * never disagree about the API prefix.
   */
  getMcpResourceUrl(): string {
    const basePath = this.config.basePath || '/api/v1/auth';
    const apiPrefix = basePath.replace(/\/auth\/?$/, '');
    return `${this.getCanonicalOrigin()}${apiPrefix}/mcp`;
  }

  /**
   * Whether the OAuth track for MCP is live on this deployment: the embedded
   * AS must be enabled AND the canonical origin must satisfy the OAuth 2.1
   * transport rule (TLS, loopback exempt). When this is false the MCP
   * endpoint is API-key-only and no OAuth metadata is advertised.
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
   * jose. Client-credentials (M2M) tokens carry no `sub` and are rejected:
   * the MCP surface is principal-bound by design; headless callers use API
   * keys. Revocation note: JWT access tokens are not server-tracked, so
   * revocation takes effect at expiry (≤1h default); refresh tokens ARE
   * revocable immediately via `/oauth2/revoke`.
   *
   * The caller (runtime dispatcher) maps the returned principal through
   * `resolveAuthzContext` — the single shared authorization resolver — so
   * OAuth is a second *provenance* for the principal, never a second authz
   * model.
   */
  async verifyMcpAccessToken(
    token: string,
  ): Promise<{ userId: string; scopes: string[]; clientId?: string } | null> {
    try {
      if (!token || token.split('.').length !== 3) return null; // not a JWS compact token
      if (!this.isMcpOAuthEnabled()) return null;

      const { createLocalJWKSet, jwtVerify } = await import('jose');

      const now = Date.now();
      if (!this.jwksCache || now - this.jwksCache.fetchedAtMs > AuthManager.JWKS_CACHE_TTL_MS) {
        const api = await this.getApi();
        const jwks = await (api as any).getJwks?.();
        if (!jwks || !Array.isArray(jwks.keys)) return null;
        this.jwksCache = { jwks, fetchedAtMs: now };
      }

      const { payload } = await jwtVerify(token, createLocalJWKSet(this.jwksCache.jwks), {
        issuer: this.getAuthIssuer(),
        audience: this.getMcpResourceUrl(),
      });

      const userId = typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
      if (!userId) return null;
      const scopes =
        typeof payload.scope === 'string'
          ? payload.scope.split(' ').filter(Boolean)
          : [];
      const clientId = typeof (payload as any).azp === 'string' ? (payload as any).azp : undefined;
      return { userId, scopes, ...(clientId ? { clientId } : {}) };
    } catch {
      return null; // unknown/expired/wrong-audience/garbage → no principal
    }
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
   * degradation (a wall was asked for, the enterprise `@objectstack/organizations`
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
    // suppresses the password form via `features.ssoEnforced` below.
    const ssoOnly = this.resolveSsoOnly();
    const emailPassword = {
      enabled: emailPasswordConfig.enabled !== false, // Default to true
      disableSignUp: ssoOnly ? true : (disableSignUpFromEnv ?? emailPasswordConfig.disableSignUp ?? false),
      requireEmailVerification: emailPasswordConfig.requireEmailVerification ?? false,
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
      // plugin on, ADR-0071) — previously `?? false`, which advertised the
      // admin surface as absent in SCIM-enabled deployments where it was
      // actually mounted, hiding the admin sys_user actions (#2766 V1).
      admin: pluginConfig.admin ?? (readBooleanEnv('OS_SCIM_ENABLED') ?? (pluginConfig as any).scim ?? false),
      // #2766 V1.5 — mirrors `enabled.phoneNumber` in buildPluginList().
      phoneNumber: (pluginConfig as any).phoneNumber ?? false,
      // #2780 — OTP sign-in / self-service reset is only advertised when the
      // SMS path can actually deliver (plugin on + deliverable SMS service),
      // so the login UI never shows a dead "sign in with code" option.
      phoneNumberOtp: ((pluginConfig as any).phoneNumber ?? false) && this.isPhoneOtpDeliverable(),
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
   * in `buildPlugins()` (`ssoFromEnv ?? pluginConfig.sso ?? false`) so the
   * advertised capability can never disagree with the actual `/sign-in/sso`
   * route. `OS_SSO_ENABLED` (when set) wins over the config-file setting.
   * Public so `AuthPlugin` can gate the Setup-nav "SSO Providers" entry on it
   * (captures both self-host `OS_SSO_ENABLED` and the cloud per-env
   * `planAllowsSso` config, since that arrives via `plugins.sso`).
   */
  public isSsoWired(): boolean {
    // Same parser as `buildPluginList` (`readBooleanEnv`) so the advertised
    // capability can never disagree with the actually-mounted route.
    const ssoFromEnv = readBooleanEnv('OS_SSO_ENABLED');
    return ssoFromEnv ?? (this.config.plugins as any)?.sso ?? false;
  }

  /**
   * Whether opt-in DNS domain-verification (ADR-0024 ②) is wired — i.e. the
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
    return fromEnv ?? (this.config.plugins as any)?.ssoDomainVerification ?? false;
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
   * validation accepts a customer IdP registered at runtime (ADR-0024) without
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
   */
  private async resolveActor(
    ctx: any,
  ): Promise<{ userId: string; activeOrgId?: string } | null> {
    try {
      const { getSessionFromCtx } = await import('better-auth/api');
      const s: any = await getSessionFromCtx(ctx as any);
      const userId = s?.user?.id ?? s?.session?.userId;
      if (userId) {
        return {
          userId: String(userId),
          activeOrgId:
            s?.session?.activeOrganizationId ?? s?.activeOrganizationId ?? undefined,
        };
      }
    } catch { /* fall through to explicit token resolution */ }
    try {
      const hdr = (k: string): string =>
        ((ctx?.headers?.get?.(k) ?? ctx?.request?.headers?.get?.(k)) as string) || '';
      let token: string | undefined;
      // `session.token` stores the UNSIGNED value, but a credential reaches us
      // in either spelling: `bearer()` hands clients the SIGNED `<token>.<sig>`
      // in `set-auth-token` (and accepts both back), while the cookie always
      // carries the signed form. Strip the signature on BOTH branches — the
      // cookie branch always did, and a bearer branch that did not silently
      // resolved nothing for the exact credential the documented API lane hands
      // out, which is indistinguishable from "not signed in".
      const unsigned = (v: string): string => v.split('.')[0];
      const bm = /^Bearer\s+(.+)$/i.exec(hdr('authorization'));
      if (bm?.[1]) token = unsigned(bm[1].trim());
      if (!token) {
        const cm = /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=([^;]+)/.exec(hdr('cookie'));
        if (cm?.[1]) token = unsigned(decodeURIComponent(cm[1]));
      }
      if (token) {
        const sess: any = await (ctx as any).context.adapter.findOne({
          model: 'session',
          where: [{ field: 'token', value: token }],
        });
        const exp = sess?.expiresAt ?? sess?.expires_at;
        if (sess && (!exp || new Date(exp).getTime() > Date.now())) {
          const userId = String(sess.userId ?? sess.user_id ?? '');
          if (userId) {
            return {
              userId,
              activeOrgId:
                sess.activeOrganizationId ?? sess.active_organization_id ?? undefined,
            };
          }
        }
      }
    } catch { /* unresolved → null */ }
    return null;
  }

  /**
   * True when `userId` is a platform admin (a `sys_user_permission_set` row
   * pointing at `admin_full_access` with `organization_id = null`) OR an
   * owner/admin member of `activeOrgId` (any org membership with role
   * owner/admin when no active org is set). Reads through
   * `withSystemReadContext` so the lookups are not themselves RLS-scoped to the
   * acting (possibly non-privileged) user. Fails CLOSED (returns false) on any
   * lookup error — this backs a security gate, so an unverifiable actor must
   * never pass.
   *
   * [#5942] The membership half asks {@link isOrgAdminGrade} — the single grade
   * ladder in `invitation-role-cap.ts`, shared with the break-glass ban guard —
   * so "which membership is an administrator" has exactly one answer inside
   * plugin-auth. The platform-admin half above is unchanged and still has its
   * own derivations elsewhere (`resolve-authz-context.ts` is authoritative).
   */
  private async isOrgOrPlatformAdmin(
    userId: string,
    activeOrgId?: string,
  ): Promise<boolean> {
    const engine = this.getDataEngine();
    if (!engine) return false;
    const sys = withSystemReadContext(engine);
    try {
      // 1) platform admin — admin_full_access permission set, org-less link.
      const links = await sys.find('sys_user_permission_set', {
        where: { user_id: userId },
        limit: 50,
      });
      const platformLinks = (Array.isArray(links) ? links : []).filter(
        (l: any) => !l.organization_id,
      );
      if (platformLinks.length) {
        const sets = await sys.find('sys_permission_set', { limit: 50 });
        const adminSet = (Array.isArray(sets) ? sets : []).find(
          (r: any) => r.name === 'admin_full_access',
        );
        if (adminSet && platformLinks.some((l: any) => l.permission_set_id === adminSet.id)) {
          return true;
        }
      }
      // 2) org owner/admin — membership role in the active org (or any org).
      const where: any = { user_id: userId };
      if (activeOrgId) where.organization_id = activeOrgId;
      const members = await sys.find('sys_member', { where, limit: 10 });
      for (const m of (Array.isArray(members) ? members : [])) {
        // [#5942] The ONE grade ladder answers "does this membership administer
        // the org" — never a hand-copied `role === 'owner' || role === 'admin'`.
        // The copy that used to live here was case-SENSITIVE and string-only, so
        // a `sys_member.role` of `Owner` / `ADMIN` / `['owner']` was refused
        // here while `last-admin-ban-guard.ts` — same question, same ladder —
        // counted that row AS an administrator. Two spellings of one security
        // question cannot disagree if there is only one spelling.
        if (isOrgAdminGrade(m?.role)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
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
   * Returns `null` when the role cannot be established — missing keys, no
   * engine, no membership row, or a lookup error. That grades BELOW a plain
   * member, so the cap refuses anything above a `member` invitation: this
   * backs a security gate, and an unverifiable issuer must confer nothing.
   * Multiple membership rows (legacy duplicates) are joined so the highest
   * grade among them wins — the cap must judge the authority they actually
   * hold, not whichever row came back first.
   */
  private async resolveMembershipRole(
    userId: unknown,
    orgId: unknown,
  ): Promise<string | null> {
    const uid = typeof userId === 'string' && userId !== '' ? userId : null;
    const oid = typeof orgId === 'string' && orgId !== '' ? orgId : null;
    if (!uid || !oid) return null;
    const engine = this.getDataEngine();
    if (!engine) return null;
    try {
      const members = await withSystemReadContext(engine).find('sys_member', {
        where: { user_id: uid, organization_id: oid },
        limit: 10,
      });
      const roles = (Array.isArray(members) ? members : [])
        .map((m: any) => (typeof m?.role === 'string' ? m.role : ''))
        .filter((r: string) => r.length > 0);
      return roles.length > 0 ? roles.join(',') : null;
    } catch {
      return null;
    }
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
    const stamp = (account: any, ctx: any) => this.stampIdentitySource(account, ctx);
    const hostAccountAfter = (host as any)?.account?.create?.after;
    const after = hostAccountAfter
      ? async (account: any, ctx: any) => {
          await stamp(account, ctx);
          return hostAccountAfter(account, ctx);
        }
      : stamp;

    // ADR-0081 D1 — default active-org on session create. Without it, a user
    // with memberships logs in with `activeOrganizationId = null`: better-auth
    // org endpoints can't resolve an active org (single-org invite dead-end)
    // and `{current_org_id}` nav tokens fall back to list views. Resolve the
    // caller's sys_member row (owner-preferred, else oldest) and stamp the
    // draft. Host hook runs first and wins; errors are swallowed so login
    // never fails on this bookkeeping. Opt out via `autoActiveOrganization:
    // false`.
    const hostSessionBefore = (host as any)?.session?.create?.before;
    const defaultActiveOrg = async (session: any) => {
      try {
        if (!session || session.activeOrganizationId) return;
        const userId = session.userId;
        if (!userId) return;
        const engine = this.config.dataEngine;
        if (!engine) return;
        // sys_member is org/user-scoped in host stacks — read with the system
        // context so the pre-session lookup (no org on the caller yet) works.
        const reader = withSystemReadContext(engine);
        let row: any;
        try {
          row = await reader.findOne('sys_member', {
            where: { user_id: userId, role: 'owner' },
          });
        } catch {
          row = undefined;
        }
        if (!row?.organization_id) {
          try {
            row = await reader.findOne('sys_member', { where: { user_id: userId } });
          } catch {
            row = undefined;
          }
        }
        const orgId = row?.organization_id;
        if (!orgId) return;
        return { data: { ...session, activeOrganizationId: orgId } };
      } catch {
        return; // never break session create
      }
    };
    const sessionBefore =
      this.config.autoActiveOrganization !== false
        ? async (session: any, ctx: any) => {
            let draft = session;
            if (hostSessionBefore) {
              const hostResult = await hostSessionBefore(session, ctx);
              if (hostResult && typeof hostResult === 'object' && 'data' in hostResult) {
                draft = (hostResult as any).data;
              }
              // The host hook fully handled it → keep its result shape.
              if (draft?.activeOrganizationId) return { data: draft };
            }
            return (await defaultActiveOrg(draft)) ?? (draft === session ? undefined : { data: draft });
          }
        : hostSessionBefore;

    // ADR-0093 D2 — the single owner of the membership invariant. Composed into
    // `user.create.after`, the one seam EVERY creation path flows through
    // (email signup, admin create-user, bulk import, SSO JIT). Host hook (e.g.
    // the cloud's personal-org provisioning) chains FIRST and wins; the
    // reconciler then yields to whatever membership exists, so there is never a
    // double bind. Best-effort — never fails user creation.
    const hostUserAfter = (host as any)?.user?.create?.after;
    const membershipReconciler = async (user: any) => {
      try {
        await reconcileMembership(this.config.dataEngine, user?.id, {
          // #5152 — read through the accessor, not `this.config` directly: it is
          // the single source the backfill path reads too.
          policy: this.getMembershipPolicy(),
          resolveTargetOrg: async () => {
            const tenancy = this.config.getTenancy?.();
            // Single-org → default org; multi-org → none (invite/JIT own it).
            return tenancy ? await tenancy.defaultOrgId() : null;
          },
          logger: this.config.logger,
        });
      } catch {
        // reconcileMembership never throws, but guard the hook regardless —
        // membership bookkeeping must never break user creation.
      }
    };
    const userAfter = hostUserAfter
      ? async (user: any, ctx: any) => {
          const hostResult = await hostUserAfter(user, ctx);
          await membershipReconciler(user);
          return hostResult;
        }
      : async (user: any) => {
          await membershipReconciler(user);
        };

    return {
      ...(host ?? {}),
      account: {
        ...((host as any)?.account ?? {}),
        create: {
          ...((host as any)?.account?.create ?? {}),
          after,
        },
      },
      user: {
        ...((host as any)?.user ?? {}),
        create: {
          ...((host as any)?.user?.create ?? {}),
          after: userAfter,
        },
      },
      ...(sessionBefore
        ? {
            session: {
              ...((host as any)?.session ?? {}),
              create: {
                ...((host as any)?.session?.create ?? {}),
                before: sessionBefore,
              },
            },
          }
        : {}),
    } as BetterAuthOptions['databaseHooks'];
  }

  /**
   * Maintain `sys_user.source` (ADR-0024 D4 provenance) as accounts are linked.
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
  private async stampIdentitySource(account: any, _ctx?: unknown): Promise<void> {
    try {
      const providerId = account?.providerId ?? account?.provider_id;
      const userId = account?.userId ?? account?.user_id;
      if (!userId || !providerId) return;
      const engine = this.getDataEngine();
      if (!engine) return;
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

      if (providerId === 'credential') {
        // Gained a local password → env-native. Only write if currently
        // managed (avoids a no-op history row on every local signup).
        const u = await engine.findOne('sys_user', {
          where: { id: userId }, fields: ['id', 'source'], context: SYSTEM_CTX,
        } as any);
        if (u && u.source === 'idp_provisioned') {
          await engine.update('sys_user', { id: userId, source: 'env_native' }, { context: SYSTEM_CTX } as any);
        }
        return;
      }

      // Federated link → managed, unless a local credential already exists.
      const credentialCount = await engine.count('sys_account', {
        where: { user_id: userId, provider_id: 'credential' },
        context: SYSTEM_CTX,
      } as any);
      if (typeof credentialCount === 'number' && credentialCount > 0) return;
      await engine.update('sys_user', { id: userId, source: 'idp_provisioned' }, { context: SYSTEM_CTX } as any);
    } catch {
      // Provenance stamp must never break federated login. Leave the prior value.
    }
  }

  /**
   * ADR-0069 D1 — reject a password that doesn't meet the configured character-
   * class complexity. No-op when `passwordRequireComplexity` is off. Counts the
   * four classes (upper / lower / digit / symbol) present and throws
   * `PASSWORD_POLICY_VIOLATION` when fewer than `passwordMinClasses` are used.
   */
  private async assertPasswordComplexity(password: string): Promise<void> {
    if (!this.config.passwordRequireComplexity) return;
    const min = Math.min(4, Math.max(1, Math.floor(Number(this.config.passwordMinClasses) || 3)));
    const classes =
      (/[a-z]/.test(password) ? 1 : 0) +
      (/[A-Z]/.test(password) ? 1 : 0) +
      (/[0-9]/.test(password) ? 1 : 0) +
      (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
    if (classes < min) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('BAD_REQUEST', {
        message:
          `Password must include at least ${min} of: uppercase, lowercase, ` +
          'digit, symbol.',
        code: 'PASSWORD_POLICY_VIOLATION',
      });
    }
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
    if (this._mustChangeRefreshing) return;
    if (Date.now() - this._mustChangeCache.at < 60_000) return;
    const engine = this.getDataEngine();
    if (!engine) return;
    this._mustChangeRefreshing = true;
    void (async () => {
      try {
        const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
        const n = await engine.count('sys_user', {
          where: { must_change_password: true }, context: SYSTEM_CTX,
        } as any);
        this._mustChangeCache = { value: typeof n === 'number' && n > 0, at: Date.now() };
      } catch {
        // leave the prior value; try again after the TTL
      } finally {
        this._mustChangeRefreshing = false;
      }
    })();
  }

  /**
   * ADR-0069 — refresh the "any org requires MFA" cache in the background when
   * stale (60s TTL). Fire-and-forget: a brand-new per-org requirement activates
   * the gate on the next request, never blocking this one. No-op when global MFA
   * is already on (the gate is active regardless).
   */
  private refreshOrgMfaCacheIfStale(): void {
    if (this.config.mfaRequired === true) return;
    if (this._orgMfaRefreshing) return;
    if (Date.now() - this._orgMfaCache.at < 60_000) return;
    const engine = this.getDataEngine();
    if (!engine) return;
    this._orgMfaRefreshing = true;
    void (async () => {
      try {
        const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
        const n = await engine.count('sys_organization', {
          where: { require_mfa: true }, context: SYSTEM_CTX,
        } as any);
        this._orgMfaCache = { value: typeof n === 'number' && n > 0, at: Date.now() };
      } catch {
        // leave the prior value; try again after the TTL
      } finally {
        this._orgMfaRefreshing = false;
      }
    })();
  }

  /**
   * ADR-0069 — compute the auth-policy gate posture for a session. Returns an
   * `{ code, message }` when the user is currently blocked (e.g. password
   * expired), else undefined. No-op (and no DB read) when no gate feature is
   * enabled. Fails OPEN on any lookup error — a transient hiccup must never lock
   * a compliant user out.
   */
  private async computeAuthGate(
    userId: string,
    _activeOrgId: string | undefined,
    _twoFactorEnabledHint: boolean,
  ): Promise<{ code: string; message: string } | undefined> {
    const expiryDays = Math.floor(Number(this.config.passwordExpiryDays) || 0);
    const mfaGlobal = this.config.mfaRequired === true;
    // Per-org tightening: an org may require MFA above the global floor.
    const orgMaybeRequires = !mfaGlobal && !!_activeOrgId && this._orgMfaCache.value;
    // #2766 V1 — an admin-issued must-change-password flag activates the gate
    // even with every config feature off (per-user state, cached like org MFA).
    const mustChangeMaybe = this._mustChangeCache.value;
    if (expiryDays <= 0 && !mfaGlobal && !orgMaybeRequires && !mustChangeMaybe) {
      return undefined; // no gate feature active
    }
    const engine = this.getDataEngine();
    if (!engine || !userId) return undefined;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const u = await engine.findOne('sys_user', {
        where: { id: userId },
        fields: ['password_changed_at', 'two_factor_enabled', 'mfa_required_at', 'must_change_password'],
        context: SYSTEM_CTX,
      } as any);

      // Effective MFA requirement: global floor OR the active org's require_mfa.
      let mfaRequired = mfaGlobal;
      if (!mfaRequired && orgMaybeRequires) {
        const org = await engine.findOne('sys_organization', {
          where: { id: _activeOrgId }, fields: ['require_mfa'], context: SYSTEM_CTX,
        } as any);
        mfaRequired = org?.require_mfa === true || org?.require_mfa === 1;
      }

      // ── Admin-issued force change (#2766 V1) ──────────────────────────
      // Reuses the PASSWORD_EXPIRED code so the existing transport-seam 403
      // handling and the Console change-password redirect apply unchanged;
      // the semantic is identical ("must change password to continue").
      if (u?.must_change_password === true || u?.must_change_password === 1) {
        return {
          code: 'PASSWORD_EXPIRED',
          message: 'You must change your password before continuing.',
        };
      }

      // ── Password expiry ───────────────────────────────────────────────
      if (expiryDays > 0) {
        const changed = u?.password_changed_at;
        // Null = never expires (existing accounts on upgrade) until next change.
        if (changed && Date.now() - new Date(changed).getTime() > expiryDays * 86_400_000) {
          return {
            code: 'PASSWORD_EXPIRED',
            message: 'Your password has expired. Please change it to continue.',
          };
        }
      }

      // ── Enforced MFA ──────────────────────────────────────────────────
      // A user without TOTP enrolled is blocked once their grace window
      // elapses. The clock (`mfa_required_at`) starts the first time we see
      // them required-but-unenrolled (stamped lazily, best-effort).
      if (mfaRequired && !(u?.two_factor_enabled === true || u?.two_factor_enabled === 1)) {
        const graceDays = Math.max(0, Math.floor(Number(this.config.mfaGracePeriodDays ?? 7)));
        let requiredAt = u?.mfa_required_at;
        if (!requiredAt) {
          requiredAt = new Date();
          // Best-effort: start the grace clock; never block on the write.
          engine
            .update('sys_user', { id: userId, mfa_required_at: requiredAt }, { context: SYSTEM_CTX } as any)
            .catch(() => undefined);
        }
        const elapsedMs = Date.now() - new Date(requiredAt).getTime();
        if (elapsedMs > graceDays * 86_400_000) {
          return {
            code: 'MFA_REQUIRED',
            message:
              'Multi-factor authentication is required. Please set up an authenticator app to continue.',
          };
        }
      }
    } catch {
      return undefined; // fail-open
    }
    return undefined;
  }

  /**
   * ADR-0069 D1 — stamp `sys_user.password_changed_at = now` after a password is
   * set (sign-up / change / reset). Best-effort; never throws. Written as a Date
   * (never epoch-ms) per ADR-0074.
   */
  private async stampPasswordChangedAt(userId: string): Promise<void> {
    const engine = this.getDataEngine();
    if (!engine || !userId) return;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      // #2766 V1 — a completed password change also satisfies any pending
      // admin-issued force-change flag, so clear it in the same write.
      await engine.update(
        'sys_user',
        { id: userId, password_changed_at: new Date(), must_change_password: false },
        { context: SYSTEM_CTX } as any,
      );
    } catch {
      // audit stamp is best-effort — never break a valid password change
    }
  }

  /**
   * ADR-0069 D1 — parse the bounded `previous_password_hashes` JSON column into
   * a string[] of hashes, tolerating null / malformed values.
   */
  private parseHashes(raw: unknown): string[] {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((h): h is string => typeof h === 'string' && !!h) : [];
    } catch {
      return [];
    }
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
  private async resolvePasswordChangeUserId(ctx: any): Promise<string | undefined> {
    if (ctx?.path === '/change-password') {
      return (await this.resolveActor(ctx))?.userId;
    }
    if (ctx?.path === '/reset-password') {
      const token = typeof ctx?.body?.token === 'string' ? ctx.body.token : '';
      if (!token) return undefined;
      try {
        const v: any = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
        const raw = v?.value;
        if (!raw) return undefined;
        if (typeof raw === 'string') {
          const t = raw.trim();
          if (t.startsWith('{') || t.startsWith('"')) {
            try {
              const o = JSON.parse(t);
              return (typeof o === 'string' ? o : o?.userId) ?? undefined;
            } catch {
              return t;
            }
          }
          return t;
        }
        return raw?.userId ?? undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * ADR-0069 D1 — throw `PASSWORD_REUSE` when `candidate` matches the user's
   * current password or any hash in the bounded history. Reuses better-auth's
   * native `password.verify` (passed in) rather than re-hashing. Returns the
   * current hash (for the after-hook to append) when the candidate is fresh, or
   * undefined when the feature is off / nothing to compare.
   */
  private async assertPasswordNotReused(
    userId: string,
    candidate: string,
    verify?: (data: { password: string; hash: string }) => Promise<boolean>,
  ): Promise<string | undefined> {
    const count = Math.floor(Number(this.config.passwordHistoryCount) || 0);
    if (count <= 0 || typeof verify !== 'function') return undefined;
    const engine = this.getDataEngine();
    if (!engine) return undefined;
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    let account: any;
    try {
      account = await engine.findOne('sys_account', {
        where: { user_id: userId, provider_id: 'credential' },
        fields: ['id', 'password', 'previous_password_hashes'],
        context: SYSTEM_CTX,
      } as any);
    } catch {
      return undefined; // fail-open on lookup error
    }
    if (!account?.id) return undefined;
    const currentHash = typeof account.password === 'string' ? account.password : '';
    const compareList = [currentHash, ...this.parseHashes(account.previous_password_hashes)].filter(Boolean);
    for (const h of compareList) {
      let match = false;
      try { match = await verify({ password: candidate, hash: h }); } catch { match = false; }
      if (match) {
        const { APIError } = await import('better-auth/api');
        throw new APIError('BAD_REQUEST', {
          message: `For security you can't reuse one of your last ${count} passwords. Please choose a different one.`,
          code: 'PASSWORD_REUSE',
        });
      }
    }
    return currentHash;
  }

  /**
   * ADR-0069 D1 — append `oldHash` to the bounded password-history ring after a
   * successful change/reset. Best-effort; never throws.
   */
  private async recordPasswordHistory(userId: string, oldHash: string): Promise<void> {
    const count = Math.floor(Number(this.config.passwordHistoryCount) || 0);
    if (count <= 0 || !oldHash) return;
    const engine = this.getDataEngine();
    if (!engine) return;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const account = await engine.findOne('sys_account', {
        where: { user_id: userId, provider_id: 'credential' },
        fields: ['id', 'previous_password_hashes'],
        context: SYSTEM_CTX,
      } as any);
      if (!account?.id) return;
      const prev = this.parseHashes(account.previous_password_hashes);
      const next = [oldHash, ...prev.filter((h) => h !== oldHash)].slice(0, count);
      await engine.update(
        'sys_account',
        { id: account.id, previous_password_hashes: JSON.stringify(next) },
        { context: SYSTEM_CTX } as any,
      );
    } catch {
      // history maintenance is best-effort — never break a valid password change
    }
  }

  /**
   * ADR-0069 D2 — throw `ACCOUNT_LOCKED` when the identity is currently locked
   * out (brute-force protection). No-op when lockout is disabled
   * (`lockoutThreshold <= 0`) or no data engine is wired. Fails OPEN on a
   * lookup error: an infra hiccup must never block every login.
   */
  private async assertAccountNotLocked(email: string): Promise<void> {
    const threshold = Number(this.config.lockoutThreshold) || 0;
    if (threshold <= 0) return;
    const engine = this.getDataEngine();
    if (!engine) return;
    let locked = false;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const u = await engine.findOne('sys_user', {
        where: { email }, fields: ['id', 'locked_until'], context: SYSTEM_CTX,
      } as any);
      const lu = u?.locked_until;
      locked = !!(lu && new Date(lu).getTime() > Date.now());
    } catch {
      return; // fail-open
    }
    if (locked) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('FORBIDDEN', {
        message:
          'This account is temporarily locked after too many failed sign-in ' +
          'attempts. Try again later or ask an administrator to unlock it.',
        code: 'ACCOUNT_LOCKED',
      });
    }
  }

  /**
   * ADR-0069 D2 — record a sign-in outcome for lockout accounting. On failure
   * increments `failed_login_count` and, once it reaches `lockoutThreshold`,
   * stamps `locked_until = now + lockoutDurationMinutes`. On success resets
   * both (only writing when there is something to clear, to avoid a no-op
   * history row on every login). No-op when lockout is disabled. Never throws —
   * a counter write must not turn a valid login into an error.
   */
  private async recordSignInOutcome(email: string, success: boolean): Promise<void> {
    const threshold = Number(this.config.lockoutThreshold) || 0;
    if (threshold <= 0) return;
    const engine = this.getDataEngine();
    if (!engine) return;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const u = await engine.findOne('sys_user', {
        where: { email },
        fields: ['id', 'failed_login_count', 'locked_until'],
        context: SYSTEM_CTX,
      } as any);
      if (!u?.id) return;
      if (success) {
        if ((Number(u.failed_login_count) || 0) !== 0 || u.locked_until) {
          await engine.update(
            'sys_user',
            { id: u.id, failed_login_count: 0, locked_until: null },
            { context: SYSTEM_CTX } as any,
          );
        }
        return;
      }
      const next = (Number(u.failed_login_count) || 0) + 1;
      const patch: Record<string, unknown> = { id: u.id, failed_login_count: next };
      if (next >= threshold) {
        const mins = Number(this.config.lockoutDurationMinutes) || 15;
        patch.locked_until = new Date(Date.now() + mins * 60_000);
      }
      await engine.update('sys_user', patch, { context: SYSTEM_CTX } as any);
    } catch {
      // Lockout accounting is best-effort — never break the auth response.
    }
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
    const threshold = Number(this.config.lockoutThreshold) || 0;
    if (threshold <= 0) return undefined;
    const minutes = Number(this.config.lockoutDurationMinutes) || 15;
    return {
      enabled: true,
      maxFailedAttempts: threshold,
      durationSeconds: minutes * 60,
    };
  }

  /**
   * ADR-0069 D7 — stamp `last_login_at` (+ `last_login_ip` when known) on a
   * successful sign-in. Best-effort and always fire-and-forget safe: a login
   * audit write must never turn a valid login into an error, and it runs
   * unconditionally (unlike lockout accounting, which is gated on a threshold).
   */
  private async stampLastLogin(userId: string, ip: string | undefined): Promise<void> {
    const engine = this.getDataEngine();
    if (!engine || !userId) return;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const patch: Record<string, unknown> = { id: userId, last_login_at: new Date() };
      // Cap to the column width (IPv6 textual max 45) — a malformed/oversized
      // forwarded header must not blow up the write.
      if (ip) patch.last_login_ip = ip.slice(0, 45);
      await engine.update('sys_user', patch, { context: SYSTEM_CTX } as any);
    } catch {
      // Login audit is best-effort — never break the auth response.
    }
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
  public async unlockUser(userId: string): Promise<boolean> {
    const engine = this.getDataEngine();
    if (!engine || !userId) return false;
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
    const u = await engine.findOne('sys_user', {
      where: { id: userId }, fields: ['id'], context: SYSTEM_CTX,
    } as any);
    if (!u?.id) return false;
    await engine.update(
      'sys_user',
      { id: userId, failed_login_count: 0, locked_until: null },
      { context: SYSTEM_CTX } as any,
    );
    // Best-effort and deliberately after the primary write: a user with no
    // enrolment (or an environment where 2FA was never switched on) must still
    // get a successful unlock, and the password-stage clear is the part the
    // admin asked for.
    try {
      const enrolments = await engine.find('sys_two_factor', {
        where: { user_id: String(userId) }, fields: ['id'], context: SYSTEM_CTX,
      } as any);
      for (const row of (enrolments ?? []) as Array<{ id?: string }>) {
        if (!row?.id) continue;
        await engine.update(
          'sys_two_factor',
          { id: row.id, failed_verification_count: 0, locked_until: null },
          { context: SYSTEM_CTX } as any,
        );
      }
    } catch {
      // Never turn a successful password-stage unlock into a failure.
    }
    return true;
  }

  /**
   * ADR-0069 D4 — idle / absolute session enforcement, run per request from
   * `customSession`. No-op when both are off. Revokes (expires in place +
   * stamps revoked_at/revoke_reason) when a limit is exceeded so better-auth
   * returns no session on the NEXT request; otherwise touches `last_activity_at`
   * (throttled to once a minute). Best-effort — never throws.
   */
  private async enforceSessionControls(sessionId: string | undefined, createdAtHint: unknown): Promise<void> {
    const idleMin = Math.floor(Number(this.config.sessionIdleTimeoutMinutes) || 0);
    const absHrs = Math.floor(Number(this.config.sessionAbsoluteMaxHours) || 0);
    if (idleMin <= 0 && absHrs <= 0) return;
    const engine = this.getDataEngine();
    if (!engine || !sessionId) return;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const srow = await engine.findOne('sys_session', {
        where: { id: sessionId },
        fields: ['id', 'created_at', 'last_activity_at', 'revoked_at'],
        context: SYSTEM_CTX,
      } as any);
      if (!srow?.id || srow.revoked_at) return;
      const now = Date.now();
      let reason: string | undefined;
      if (absHrs > 0) {
        const created = srow.created_at ?? createdAtHint;
        if (created && now - new Date(created as any).getTime() > absHrs * 3_600_000) reason = 'absolute_max';
      }
      if (!reason && idleMin > 0) {
        const last = srow.last_activity_at ?? srow.created_at ?? createdAtHint;
        if (last && now - new Date(last as any).getTime() > idleMin * 60_000) reason = 'idle_timeout';
      }
      if (reason) {
        await engine.update(
          'sys_session',
          { id: sessionId, expires_at: new Date(now - 1000), revoked_at: new Date(now), revoke_reason: reason },
          { context: SYSTEM_CTX } as any,
        ).catch(() => undefined);
        return;
      }
      if (idleMin > 0) {
        const la = srow.last_activity_at ? new Date(srow.last_activity_at as any).getTime() : 0;
        if (now - la > 60_000) {
          await engine.update('sys_session', { id: sessionId, last_activity_at: new Date(now) }, { context: SYSTEM_CTX } as any).catch(() => undefined);
        }
      }
    } catch {
      // session controls are best-effort — never break a request
    }
  }

  /**
   * ADR-0069 D4 — concurrent-session cap, run from the sign-in after-hook.
   * Keeps the newest `maxConcurrentSessions` live sessions for the user and
   * revokes the rest (oldest first). No-op when off. Best-effort.
   */
  private async enforceConcurrentCap(userId: string): Promise<void> {
    const cap = Math.floor(Number(this.config.maxConcurrentSessions) || 0);
    if (cap <= 0 || !userId) return;
    const engine = this.getDataEngine();
    if (!engine) return;
    try {
      const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
      const rows = await engine.find('sys_session', {
        where: { user_id: userId },
        fields: ['id', 'created_at', 'expires_at', 'revoked_at'],
        limit: 200,
        context: SYSTEM_CTX,
      } as any);
      const now = Date.now();
      const live = (Array.isArray(rows) ? rows : [])
        .filter((sn: any) => !sn.revoked_at && (!sn.expires_at || new Date(sn.expires_at).getTime() > now))
        .sort((a: any, b: any) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
      for (const sn of live.slice(cap)) {
        await engine.update(
          'sys_session',
          { id: sn.id, expires_at: new Date(now - 1000), revoked_at: new Date(now), revoke_reason: 'concurrent_cap' },
          { context: SYSTEM_CTX } as any,
        ).catch(() => undefined);
      }
    } catch {
      // best-effort — never break a successful sign-in
    }
  }

  /**
   * ADR-0069 D5 — is `ip` within the configured allow-list? True (allow) when no
   * ranges are configured, OR when the IP can't be determined (fail-open so a
   * misconfigured proxy never locks everyone out — an admin enabling this must
   * ensure forwarded headers are trusted). Supports IPv4 CIDR + exact IPv4/IPv6.
   */
  public isClientIpAllowed(ip: string | undefined): boolean {
    const ranges = this.config.allowedIpRanges;
    if (!ranges || ranges.length === 0) return true;
    if (!ip) return true; // undetermined → fail-open
    return ranges.some((r) => ipMatchesRange(ip, r));
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
