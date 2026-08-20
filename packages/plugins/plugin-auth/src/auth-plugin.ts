// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
import type { BetterAuthOptions } from 'better-auth';
import {
  AuthConfig,
  type SocialProviderConfig,
  type SettingsChangeHandler,
  type SettingsUnsubscribe,
  SystemObjectName,
  SystemUserId,
} from '@objectstack/spec/system';
import {
  // ADR-0048 — the Setup/Studio/Account apps moved to their own packages
  // (@objectstack/{setup,studio,account}); plugin-auth no longer registers them.
  SystemOverviewDashboard,
  SystemOverviewDatasets,
} from '@objectstack/platform-objects/apps';
import { SysOrganizationDetailPage, SysUserDetailPage } from '@objectstack/platform-objects/pages';
import { resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall, type OrgScopingEntitlement } from '@objectstack/spec/security';
import type { IDataEngine, IEmailService, II18nService, IObjectQLEngine, ISmsService } from '@objectstack/spec/contracts';
import {
  AuthManager,
  resolveOidcProviderEnabled,
  readMcpServerEnabledEnv,
  type AuthManagerOptions,
} from './auth-manager.js';
import { ensureDefaultOrganization } from './ensure-default-organization.js';
import { recoverInternalFieldsForSystemRead } from './internal-field-readback.js';
import { runAttributedToUser } from './auth-actor-attribution.js';
import type { AuthEventAuditSurface } from './auth-session-audit.js';
import type { ResolvedSocialProvider } from './backfill-account-issuer.js';
import { createTenancyService, type TenancyService } from './tenancy-service.js';
import {
  backfillMemberships,
  isMembershipPolicy,
  MEMBERSHIP_POLICIES,
  type MembershipPolicy,
} from './reconcile-membership.js';
import {
  registerIdentityWriteGuard,
  registerManagedUpdateWhitelist,
  type SecondaryStorageLike,
} from './identity-write-guard.js';
import { registerLastAdminGuard } from './last-admin-guard.js';
import { registerMemberRoleCanonicalization } from './member-role-canonical.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { MANAGED_EXTENSION_EDITABLE_FIELDS } from './managed-extension-fields.js';
import { runSetInitialPassword } from './set-initial-password.js';
import { runRegisterSsoProviderFromForm, runRegisterSamlProviderFromForm, runRequestDomainVerification, runVerifyDomain } from './register-sso-provider.js';
import { runResendVerificationEmail } from './send-verification-email.js';
import type { CounterStore } from './rate-limit-storage.js';
import {
  authIdentityObjects,
  authObjectExtensions,
  authPluginManifestHeader,
} from './manifest.js';
import { scheduleLegacySsoSecretMigration } from './sso-client-secret.js';
import { judgePlatformAdmin, type PlatformAdminActor } from './platform-admin-gate.js';
import {
  runAdminBanUser,
  runAdminUnbanUser,
  type AdminBanEndpointDeps,
} from './admin-ban-endpoints.js';


/**
 * The `settings` slot, as this plugin reads it.
 *
 * [#4251] `service-settings` registers its `SettingsService` here and the slot
 * carries no `packages/spec` contract, so this declares the two resolver methods
 * this plugin calls. Structural on purpose — plugin-auth must not depend on
 * service-settings, which is optional (both readers below already return early
 * when the slot is empty or the method is missing).
 */
interface SettingsReadSurface {
  /** Resolve one key; `source` distinguishes a stored/env value from a manifest default. */
  get(
    namespace: string,
    key: string,
    ctx?: Record<string, unknown>,
  ): Promise<{ value?: unknown; source?: string } | undefined>;
  /** Resolve a whole namespace as `key → { value, source }`. */
  getNamespace(
    namespace: string,
    ctx?: Record<string, unknown>,
  ): Promise<{ values: Record<string, { value?: unknown; source?: string } | undefined> }>;
  /**
   * Re-run a binding when the namespace changes — how the brand name, SMS
   * locale and auth namespace stay live without a redeploy. Optional: an
   * implementation without a change bus leaves the initial read in place, which
   * is what the `typeof … === 'function'` guards at each call site already say.
   *
   * The handler and unsubscribe types are the SPEC's
   * (`@objectstack/spec/system`), not re-declared here — the change bus has a
   * published contract even though the slot does not.
   */
  subscribe?(
    namespace: string | undefined,
    handler: SettingsChangeHandler,
  ): SettingsUnsubscribe;
}

/**
 * The `protocol` slot's metadata reader, as the user-import route uses it.
 *
 * [#4251] `protocol` is a deliberately UNCONTRACTED slot (see
 * `UNCONTRACTED_SLOTS` in `eslint.config.mjs`), so the one method this route
 * needs is declared here rather than erased. It reads `sys_user`'s field
 * definitions so imported values are coerced to their declared types —
 * best-effort by contract: without it the import still runs, uncoerced.
 */
interface MetaItemReaderSurface {
  getMetaItem(ref: { type: string; name: string }): Promise<any>;
}

/**
 * Auth Plugin Options
 * Extends AuthConfig from spec with additional runtime options
 */
export interface AuthPluginOptions extends Partial<AuthConfig> {
  /**
   * ADR-0093 D1 — deployment membership policy. `'auto'` (default) auto-binds
   * every new user to the single-org default org via the reconciler; invite-only
   * deployments set `'invite-only'` to grant membership solely through explicit
   * flows (invite / add-member / SSO JIT / host hooks).
   * @default 'auto'
   */
  membershipPolicy?: MembershipPolicy;

  /**
   * Whether to automatically register auth routes
   * @default true
   */
  registerRoutes?: boolean;
  
  /**
   * Base path for auth routes
   * @default '/api/v1/auth'
   */
  basePath?: string;

  /**
   * Override the datasource that owns the identity tables (sys_user,
   * sys_session, …) when AuthPlugin's manifest is registered.
   *
   * Defaults to `'cloud'` (control-plane DB) so the historical
   * single-tenant control-plane behaviour is preserved. Per-project
   * kernels in objectos pass `'default'` so identity tables live in the
   * project's own database — each project owns its own users.
   */
  manifestDatasource?: string;

  /**
   * `additionalOrgRoles` was REMOVED in ADR-0108 (#3723) — see
   * {@link AuthManagerOptions} for the FROM → TO migration. The membership-role
   * vocabulary is closed (`owner` / `admin` / `delegated_admin` / `member`);
   * an app's own business roles are POSITIONS, assigned through
   * `sys_user_position` or an invitation carrying placement (ADR-0105 D8).
   */

  /**
   * ADR-0081 D1 — single-org default-organization bootstrap. In single-org
   * mode (`OS_MULTI_ORG_ENABLED` unset/false) nothing else ever creates an
   * organization, so sessions carry no `activeOrganizationId` and better-auth
   * `organization/invite-member` has no org to resolve — i.e. no way to add a
   * user at all. When enabled (default), the plugin idempotently creates the
   * `Default Organization` (slug `default`) and binds the first platform
   * admin as `owner`, on `kernel:ready` and after every
   * `sys_user_permission_set` insert. Inert in multi-org mode — the
   * enterprise organizations package owns the bootstrap there.
   * @default true
   */
  autoDefaultOrganization?: boolean;

  /**
   * Pass-through to better-auth's `databaseHooks` option. Used by
   * platform consumers (objectos kernel) to attach a
   * `user.create.after` hook that auto-provisions a personal
   * organization for JIT-created SSO users.
   *
   * This is the seam to use because it is the ONE hook point every user
   * creation path flows through (email signup, social/OIDC sign-in,
   * admin-created accounts, SSO JIT) and ADR-0093 D2 gives such invariants a
   * single owner there. It is NOT because better-auth's adapter escapes the
   * data layer: it writes through the same ObjectQL instance and its
   * middleware/lifecycle-hook chain does run — see
   * `AuthManagerOptions.databaseHooks` for the hop-by-hop correction (#4802).
   */
  databaseHooks?: BetterAuthOptions['databaseHooks'];
}

/**
 * Authentication Plugin
 * 
 * Provides authentication and identity services for ObjectStack applications.
 * 
 * **Dual-Mode Operation:**
 * - **Server mode** (HonoServerPlugin active): Registers HTTP routes at basePath,
 *   forwarding all auth requests to better-auth's universal handler.
 * - **MSW/Mock mode** (no HTTP server): Gracefully skips route registration but
 *   still registers the `auth` service, allowing HttpDispatcher.handleAuth() to
 *   simulate auth flows (sign-up, sign-in, etc.) for development and testing.
 * 
 * Features:
 * - Session management
 * - User registration/login
 * - OAuth providers (Google, GitHub, etc.)
 * - Organization/team support
 * - 2FA, passkeys, magic links
 * 
 * This plugin registers:
 * - `auth` service (auth manager instance) — always
 * - `app.com.objectstack.system` service (system object definitions) — always
 * - HTTP routes for authentication endpoints — only when HTTP server is available
 * 
 * Integrates with better-auth library to provide comprehensive
 * authentication capabilities including email/password, OAuth, 2FA,
 * magic links, passkeys, and organization support.
 */
export class AuthPlugin implements Plugin {
  name = 'com.objectstack.auth';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['auth', 'tenancy'];
  type = 'standard';
  version = '1.0.0';
  dependencies: string[] = ['com.objectstack.engine.objectql'];
  /**
   * What that dependency is FOR, stated so the kernel can check it (#4187).
   * `init()` resolves both synchronously with no fallback: `data` builds the
   * AuthManager config, `manifest` registers the auth objects. ObjectQL
   * registers both unconditionally and the hard dependency above hoists it
   * ahead, so this never changes whether the boot succeeds — it changes what
   * a broken composition SAYS, and replaces the trailing `// manifest service
   * required` comment with the machine-checked form of the same claim.
   */
  requiresServices = ['data', 'manifest'];


  private options: AuthPluginOptions;
  private authManager: AuthManager | null = null;
  /** ADR-0093 D4 — the tenancy service registered in init(); reused at kernel:ready. */
  private tenancy: TenancyService | null = null;
  private configuredSocialProviders: SocialProviderConfig | undefined;
  // ADR-0092 D6 — the EFFECTIVE better-auth secondaryStorage (host-supplied or
  // the kernel-cache adapter wired in init). The identity write guard's
  // session-snapshot refresh reads through this; undefined = refresh no-ops.
  private effectiveSecondaryStorage: AuthManagerOptions['secondaryStorage'];

  /**
   * Memoized `bindAuthSettings()` run — see {@link ensureAuthSettingsBound}.
   */
  private authSettingsBinding: Promise<void> | null = null;

  constructor(options: AuthPluginOptions = {}) {
    this.options = {
      registerRoutes: true,
      basePath: '/api/v1/auth',
      ...options
    };
  }

  /**
   * Open-source provider fallback: enable Google sign-in from conventional
   * provider env vars when the application did not configure Google itself.
   * Enterprise / product packages can contribute richer provider sets through
   * the `auth:configure` hook below.
   */
  private applyEnvSocialProviderFallbacks(config: AuthManagerOptions & AuthPluginOptions): void {
    const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
    if (String(env?.OS_AUTH_GOOGLE_ENABLED ?? 'true').toLowerCase() === 'false') return;
    const googleClientId = env?.GOOGLE_CLIENT_ID;
    const googleClientSecret = env?.GOOGLE_CLIENT_SECRET;
    if (!googleClientId || !googleClientSecret) return;

    const socialProviders = {
      ...(config.socialProviders ?? {}),
    } as NonNullable<AuthPluginOptions['socialProviders']>;

    if (!socialProviders.google) {
      socialProviders.google = {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        enabled: true,
      };
      config.socialProviders = socialProviders;
    }
  }

  /**
   * The social providers better-auth built for this runtime, straight off its
   * own context — each one carrying the `accountIssuer` it will key its
   * accounts by. Read rather than reconstructed: reconstructing it from the
   * configured ids is exactly the guess that mis-stamped Google links.
   *
   * Returns `undefined` when the instance cannot be reached (auth not built
   * yet, or a host-supplied instance that exposes no context) — the backfill
   * then falls back to the id-derived issuers and reports what it cannot
   * resolve, which is the pre-existing behaviour, not a new failure.
   */
  private async resolveInstantiatedSocialProviders(
    ctx: PluginContext,
  ): Promise<ResolvedSocialProvider[] | undefined> {
    try {
      const auth = await this.authManager?.getAuthInstance();
      const context = await (auth as any)?.$context;
      const providers = context?.socialProviders;
      if (!Array.isArray(providers)) return undefined;
      return providers.filter((p: any) => typeof p?.id === 'string' && p.id);
    } catch (e) {
      ctx.logger.warn?.(
        '[auth] could not read better-auth\'s instantiated social providers — account issuers fall back to the id-derived values',
        { error: (e as Error)?.message },
      );
      return undefined;
    }
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing Auth Plugin...');

    // Validate required configuration
    if (!this.options.secret) {
      throw new Error('AuthPlugin: secret is required');
    }

    // Get data engine service for database operations. This plugin declares a
    // hard dependency on ObjectQL (which registers `data` unconditionally), so
    // the service is always present here.
    //
    // There used to be an `if (!dataEngine) warn('…auth will use in-memory
    // storage')` guard under this line. It could never fire and the fallback it
    // named did not exist: `getService` THROWS for an unregistered service, it
    // does not return undefined, and the hard dependency means a kernel without
    // the engine fails earlier still with "Dependency … not found". A branch
    // that advertises a tolerance the composition forbids is worse than no
    // branch — it reads as a supported degraded mode (#4187). AuthManager keeps
    // its own `dataEngine?` guards because it is usable outside this plugin.
    const dataEngine = ctx.getService<IDataEngine>('data');

    const authConfig: AuthManagerOptions & AuthPluginOptions = {
      ...this.options,
      dataEngine,
      logger: ctx.logger,
      // ADR-0093 D2/D3 — the membership reconciler consults the tenancy service
      // (lazily, at hook-fire time — the service is registered below, after the
      // `auth` service) to resolve the target org. membershipPolicy defaults to
      // 'auto' in the reconciler.
      getTenancy: () => {
        try {
          return ctx.getService<TenancyService>('tenancy');
        } catch {
          return undefined;
        }
      },
      // [#8144] The compliance ledger's non-CRUD ingress, resolved LAZILY at
      // session-hook fire time (i.e. per request, long after boot). AuditPlugin
      // is an optional pair in the CLI, so a miss is the ordinary case, not a
      // degradation to report: no audit plugin means no `login`/`logout` rows,
      // which is exactly the behaviour before this card. Deliberately NOT an
      // `optionalDependencies` entry — nothing in `init()` consumes it, so
      // there is no boot ordering to constrain.
      getAuditSink: () => {
        try {
          return ctx.getService<AuthEventAuditSurface>('audit');
        } catch {
          return undefined;
        }
      },
    };

    // ADR-0069 D2 — cross-node rate-limit counters, backed by the kernel
    // `cache` service and resolved LAZILY (#4772).
    //
    // This used to be an eager `getServiceAsync('cache')` probe right here,
    // whose answer was frozen for the life of the process. `init()` runs before
    // CacheServicePlugin registers the service (21ms earlier in a showcase cold
    // start), so the probe resolved `undefined` in deployments that HAVE a cache
    // configured, and the warning it printed sent operators to provision Redis
    // for a problem they did not have. Worse than the misdiagnosis: the
    // degradation was real and permanent — the counters never reached the shared
    // store even once it came up, so a multi-node deployment's limits were never
    // enforced globally. `createLazyCacheRateLimitStorage` resolves the service
    // at the moment a counter is consumed, which is strictly after `kernel:ready`
    // and therefore after ANY plugin ordering, and warns only when a counter
    // genuinely has nowhere shared to count.
    //
    // Deliberately `rateLimit.customStorage`, NOT `secondaryStorage`: a
    // `secondaryStorage` also relocates the SESSION of record into the cache
    // (better-auth's `createSession` skips the `sys_session` row and
    // `findSession` answers from the snapshot without reading the database),
    // which would silently disable the ADR-0069 D4 session controls — idle
    // timeout, absolute max and concurrent cap all revoke by writing that row.
    // Whether the session of record should live in the cache at all is #4785.
    // A host that supplies `secondaryStorage` itself still wins and keeps
    // better-auth's own `storage: 'secondary-storage'` counters.
    //
    // The SAME resolution carries ObjectStack's own per-number OTP send budget
    // (#2780) below — that counter had the identical hole (#4790): it counted
    // in `secondaryStorage` when a host supplied one and per-process otherwise,
    // which under the standard `serve` composition (nobody supplies one) meant
    // every node granted the same phone number its own cooldown + hourly cap.
    // The currency there is paid SMS, so an N-node deployment was billed for up
    // to N× the declared budget.
    //
    // The `cache` service is registered ASYNC — `getService` throws for it, so
    // resolve via `getServiceAsync` and treat any failure (not registered, or
    // not yet ready) as "no shared cache, ask again later".
    const resolveCache = async (): Promise<CounterStore | undefined> => {
      let cache: any;
      try {
        cache = await (ctx as { getServiceAsync?: (n: string) => Promise<unknown> })
          .getServiceAsync?.('cache');
      } catch {
        return undefined;
      }
      if (cache && typeof cache.get === 'function' && typeof cache.set === 'function') return cache;
      return undefined;
    };

    {
      const { createLazyCacheRateLimitStorage, createLazyCounterStore } = await import(
        './rate-limit-storage.js'
      );
      if (!authConfig.secondaryStorage) {
        authConfig.rateLimitStorage = createLazyCacheRateLimitStorage({
          resolveCache,
          logger: ctx.logger,
        });
      }
      // #4790 — ObjectStack's own counters. Wired even when the host supplied a
      // `secondaryStorage` (AuthManager prefers that store for the budget and
      // then never calls this resolver), so the two decisions stay independent.
      authConfig.sharedCounterStore = createLazyCounterStore({
        resolveCache,
        logger: ctx.logger,
        subject: 'per-number OTP send budget (#2780)',
        degradedImpact:
          'The budget is still enforced, but PER NODE: every node grants the same phone number its own ' +
          'cooldown and hourly cap, so an N-node deployment can send up to N× the configured number of ' +
          'PAID SMS to one number (#4790)',
      });
    }

    this.applyEnvSocialProviderFallbacks(authConfig);

    // Open extension point for packages that contribute auth providers
    // (enterprise SSO, hosted control-plane SSO, etc.) without forking
    // framework's AuthPlugin. Handlers mutate the draft config in place.
    await ctx.trigger('auth:configure', authConfig, ctx);
    this.configuredSocialProviders = authConfig.socialProviders
      ? { ...authConfig.socialProviders }
      : undefined;

    // [ADR-0105 D8] Lazy handle to plugin-security's `invitation-placement`
    // service. LAZY on purpose: plugin-security starts after plugin-auth, so
    // an eager lookup here would always miss and silently disable scoped
    // invitations. Resolved per hook invocation instead; `undefined` (no
    // plugin-security) makes a placement-carrying invitation fail closed.
    authConfig.invitationPlacement = async () => {
      try {
        const svc =
          (await (ctx as { getServiceAsync?: (n: string) => Promise<unknown> }).getServiceAsync?.(
            'invitation-placement',
          )) ?? ctx.getService?.('invitation-placement');
        return svc as never;
      } catch {
        return undefined;
      }
    };

    // Initialize auth manager with data engine
    this.authManager = new AuthManager(authConfig);
    // ADR-0092 D6 — remember the storage better-auth will actually use so the
    // identity write guard can keep cached session snapshots coherent.
    this.effectiveSecondaryStorage = authConfig.secondaryStorage;

    // Register auth service
    ctx.registerService('auth', this.authManager);

    // ADR-0093 D4 / ADR-0105 D1 — register the `tenancy` service (single source
    // of truth for the tenancy POSTURE). Registered AFTER `auth` so `auth` stays
    // the plugin's first service registration (consumers and tests rely on that
    // ordering). The `isolated` posture derives `isolationActive` from the
    // presence of the `org-scoping` service (registered by
    // @objectstack/organizations when installed), so the enterprise package
    // needs no change to light it up; `group` is enforced by the open engine and
    // never probes. `getService` is a cheap registry lookup and org-scoping
    // registers AFTER plugin-auth, so the probe is deferred to first read
    // (start()/request time).
    const tenancy: TenancyService = createTenancyService({
      requested: resolveTenancyPosture(),
      probeIsolation: () => {
        try {
          return !!ctx.getService('org-scoping');
        } catch {
          return false;
        }
      },
      // [ADR-0105 D12] Which walled postures the installed multi-org runtime
      // entitles. The open side ASKS rather than assuming "package present ⇒
      // every posture": whether `group` and `isolated` are one commercial tier
      // or two is packaging policy, and that belongs to the commercial runtime.
      // A runtime that declares nothing keeps today's behavior (both).
      probeEntitledPostures: () => {
        try {
          return ctx.getService<OrgScopingEntitlement>('org-scoping')?.supportedPostures;
        } catch {
          return undefined;
        }
      },
      getEngine: () => {
        try {
          return ctx.getService('objectql');
        } catch {
          return undefined;
        }
      },
      logger: ctx.logger,
    });
    ctx.registerService('tenancy', tenancy);
    this.tenancy = tenancy;

    ctx.getService<{ register(m: any): void }>('manifest').register({
      ...authPluginManifestHeader,
      ...(this.options.manifestDatasource
        ? { defaultDatasource: this.options.manifestDatasource }
        : {}),
      // [ADR-0108 / #3723] Registered as authored: nothing widens the
      // `sys_invitation.role` / `sys_member.role` selects at boot. The closed
      // four-name vocabulary those objects declare statically
      // (`BUILTIN_MEMBERSHIP_ROLE_OPTIONS`) is the whole list, and it is the
      // write-side guardrail that keeps an ungoverned capability grant
      // unrepresentable.
      objects: authIdentityObjects,
      // [#8009] `sys_sso_provider.oidc_client_secret` — the encrypted home of the
      // OIDC client secret that used to sit in cleartext inside `oidc_config`.
      // See `manifest.ts` for why the field is declared here and not on the
      // object file.
      objectExtensions: authObjectExtensions,
      // ADR-0048 — Setup/Studio/Account apps (and the Setup nav contributions)
      // moved to their own one-app packages (@objectstack/{setup,studio,account}),
      // each registering under its own package id so /apps/<packageId> resolves
      // unambiguously. plugin-auth keeps only the auth objects + their pages.
      // Slotted record-detail pages for system objects — currently
      // sys_organization gets a Members / Invitations / Teams tab strip
      // (see SysOrganizationDetailPage for the rationale and the
      // intentionally-omitted OAuth / SSO tabs).
      pages: [SysOrganizationDetailPage, SysUserDetailPage],
      // List views for each Setup-nav object are defined on the schema
      // itself via the canonical `listViews` map (e.g.
      // sys_user.listViews.{all_users,unverified,two_factor}). Registering
      // top-level views here is the legacy pre-M10.30c pattern — it caused
      // duplicate "Users"/"Roles"/"Sessions" tabs to appear alongside the
      // schema-derived ones, sometimes referencing nonexistent fields
      // (e.g. legacy `users.view` had phone/status/active columns that do
      // not exist on sys_user). Schema-embedded listViews is the single
      // source of truth.
      dashboards: [SystemOverviewDashboard],
      // ADR-0021 — datasets backing the System Overview dashboard's widgets.
      datasets: SystemOverviewDatasets,
      // ADR-0024 / cloud#551 — surface "SSO Providers" (sys_sso_provider) in the
      // Setup app's Access Control group, but ONLY when the external-IdP RP is
      // wired (self-host `OS_SSO_ENABLED`, or the cloud per-env `planAllowsSso`
      // arriving via `plugins.sso`). Without the gate the entry would render an
      // empty list + a "Register" button whose endpoint 404s when SSO is off.
      // Owning-plugin-contributes pattern (ADR-0029 K2), mirroring plugin-security.
      ...(this.authManager.isSsoWired()
        ? {
            navigationContributions: [
              {
                app: 'setup',
                group: 'group_access_control',
                // After Roles/Permission-Sets (100) and Sharing (200), near API Keys (300).
                priority: 250,
                items: [
                  {
                    id: 'nav_sso_providers',
                    type: 'object',
                    label: 'SSO Providers',
                    objectName: 'sys_sso_provider',
                    icon: 'log-in',
                    requiredPermissions: ['manage_platform_settings'],
                  },
                ],
              },
            ],
          }
        : {}),
    });

    // [ADR-0108 / #3723] There is no organization-role derivation any more.
    //
    // A `kernel:ready` hook used to walk the registered `position` /
    // `permission` metadata and widen both the better-auth role map and the two
    // `role` selects, so every host got app-declared roles with no wiring. That
    // made an UNGOVERNED capability channel automatic in every deployment: a
    // name stored in `sys_member.role` is projected into
    // `current_user.positions` with none of ADR-0090 D12's controls. Positions
    // are the governed channel, and an invitation carrying placement
    // (ADR-0105 D8) is the one-step admission flow that replaces it.
    ctx.logger.info('Auth Plugin initialized successfully');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Starting Auth Plugin...');

    if (!this.authManager) {
      throw new Error('Auth manager not initialized');
    }

    // [#8009] Move any provider row still holding a CLEARTEXT OIDC client
    // secret in `oidc_config` into the encrypted column. Registered
    // unconditionally (not under `registerRoutes`) because the disposition of
    // an already-stored secret does not depend on whether this process serves
    // the auth routes. The returned unsubscribe is deliberately dropped: the
    // engine outlives the plugin and there is no `stop()` to unwind it in.
    ctx.hook('kernel:ready', async () => {
      let ql: IDataEngine | undefined;
      try { ql = ctx.getService<IDataEngine>('objectql'); } catch { ql = undefined; }
      if (!ql) {
        try { ql = ctx.getService<IDataEngine>('data'); } catch { ql = undefined; }
      }
      if (!ql) return;
      scheduleLegacySsoSecretMigration(ql, ctx.logger);
    });

    // Setup App translations are now loaded by `PlatformObjectsPlugin`
    // (in @objectstack/platform-objects). Translation bundles belong with
    // the package that defines them; auth-plugin no longer piggy-backs on
    // its kernel:ready hook for this.

    // Defer HTTP route registration to kernel:ready hook.
    // This ensures all plugins (including HonoServerPlugin) have completed
    // their init and start phases before we attempt to look up the
    // http-server service — making AuthPlugin resilient to plugin
    // loading order.
    if (this.options.registerRoutes) {
      ctx.hook('kernel:ready', async () => {
        // Inject the email service if available so better-auth callbacks
        // (sendResetPassword / sendVerificationEmail / sendInvitationEmail
        // / sendMagicLink) can actually deliver mail. Resolved here on
        // kernel:ready so EmailServicePlugin has had a chance to register.
        if (this.authManager) {
          await this.ensureAuthSettingsBound(ctx);

          let emailSvc: IEmailService | undefined;
          try { emailSvc = ctx.getService<IEmailService>('email'); } catch { emailSvc = undefined; }
          if (emailSvc) {
            this.authManager.setEmailService(emailSvc);
            ctx.logger.info('Auth: email service wired (transactional mail enabled)');
          } else {
            // No email service. The verification / password-reset callbacks now
            // THROW when invoked without a transport (so an explicit resend
            // reports a real error rather than faking success). If verification
            // is REQUIRED, that means every signup would be stuck — surface the
            // misconfiguration loudly at boot instead of one failure per signup.
            const requiresEmail = !!this.authManager.getPublicConfig?.()?.emailPassword?.requireEmailVerification;
            if (requiresEmail) {
              ctx.logger.error(
                'Auth: email verification is REQUIRED but NO email service is registered — '
                + 'verification & password-reset emails will FAIL and new users will be locked '
                + 'out at sign-in. Register an email service (e.g. EmailServicePlugin + OS_EMAIL_*) '
                + 'or disable verification (OS_AUTH_REQUIRE_EMAIL_VERIFICATION=false).',
              );
            } else {
              ctx.logger.info('Auth: no email service registered — transactional mail disabled');
            }
          }

          // #2780 — inject the SMS service so the phoneNumber plugin's OTP
          // callbacks (send-otp / password-reset OTP) and the import
          // SMS-invite path can deliver. Same lazy-resolution contract as
          // the email service: absent ⇒ OTP endpoints keep failing loudly
          // (NOT_SUPPORTED) while phone+password sign-in still works.
          let smsSvc: ISmsService | undefined;
          try { smsSvc = ctx.getService<ISmsService>('sms'); } catch { smsSvc = undefined; }
          if (smsSvc) {
            this.authManager.setSmsService(smsSvc);
            if (this.authManager.isPhoneNumberEnabled()) {
              ctx.logger.info(
                this.authManager.isPhoneOtpDeliverable()
                  ? 'Auth: sms service wired (phone-number OTP sign-in / reset enabled)'
                  : 'Auth: sms service present but NOT configured with a real provider — phone-number OTP stays disabled in production',
              );
            }
          } else if (this.authManager.isPhoneNumberEnabled()) {
            ctx.logger.info('Auth: no sms service registered — phone-number OTP disabled (password sign-in only)');
          }

          // Bind the email brand name (`{{appName}}`) to the live
          // `branding.workspace_name` setting so the admin UI can rename the
          // product without a redeploy. Only an *explicitly set* value
          // overrides the configured `appName` — when the operator hasn't
          // customised it (resolver returns the manifest default), we clear
          // the override so the deployment's `appName` (e.g. `OS_APP_NAME`)
          // keeps precedence. Mirrors EmailServicePlugin's settings binding.
          try {
            const settings = ctx.getService<SettingsReadSurface>('settings');
            if (settings && typeof settings.get === 'function') {
              const applyBrand = async () => {
                try {
                  const resolved = await settings.get('branding', 'workspace_name', {});
                  const explicit = resolved && resolved.source !== 'default'
                    ? resolved.value
                    : undefined;
                  this.authManager?.setAppName(
                    typeof explicit === 'string' ? explicit : undefined,
                  );
                } catch (err: any) {
                  ctx.logger.warn(
                    'Auth: failed to apply branding.workspace_name: ' + (err?.message ?? err),
                  );
                }
              };
              await applyBrand();
              if (typeof settings.subscribe === 'function') {
                settings.subscribe('branding', () => {
                  void applyBrand();
                });
                ctx.logger.info('Auth: bound appName to settings namespace=branding');
              }

              // #2815 — bind the auth SMS locale to the deployment default
              // (`localization.locale`) so OTP/invitation texts render in the
              // workspace language. Live-rebinds on settings changes.
              const applySmsLocale = async () => {
                try {
                  const resolved = await settings.get('localization', 'locale', {});
                  const value = resolved?.value;
                  this.authManager?.setDefaultSmsLocale(
                    typeof value === 'string' ? value : undefined,
                  );
                } catch (err: any) {
                  ctx.logger.warn(
                    'Auth: failed to apply localization.locale: ' + (err?.message ?? err),
                  );
                }
              };
              await applySmsLocale();
              if (typeof settings.subscribe === 'function') {
                settings.subscribe('localization', () => {
                  void applySmsLocale();
                });
              }
            }
          } catch {
            // settings service is optional — keep the configured appName.
          }

          // #8195 — name the deployment-default locale on every auth EMAIL, so
          // the localized `sys_email_template` rows become reachable through
          // the platform's own send path instead of sitting dormant.
          //
          // Maintainer ruling 2026-08-13: the source is
          // `II18nService.getDefaultLocale()`, resolved here at the plugin
          // layer. `Accept-Language` is rejected — auth mail is routinely sent
          // outside the triggering request (invitations, admin-initiated
          // resets), so a per-device request header is the wrong authority.
          //
          // Both hops are probed rather than assumed: `getService` THROWS for
          // an unregistered service (i18n is not a required dependency of
          // auth), and `getDefaultLocale` is OPTIONAL on the contract. Either
          // one missing must leave the locale unset, which is precisely the
          // pre-#8195 behaviour — `EmailService` resolves its documented
          // `en-US` default.
          try {
            const i18n = ctx.getService<II18nService>('i18n');
            const locale =
              typeof i18n?.getDefaultLocale === 'function' ? i18n.getDefaultLocale() : undefined;
            this.authManager?.setDefaultEmailLocale(
              typeof locale === 'string' ? locale : undefined,
            );
            if (typeof locale === 'string' && locale.trim()) {
              ctx.logger.info(`Auth: bound auth email locale to i18n default=${locale}`);
            }
          } catch {
            // i18n service is optional — leave the email locale unset.
          }

          // #2815 — seed the built-in bilingual auth SMS templates into
          // sys_notification_template (insert-if-missing; tenant edits are
          // never overwritten). Only meaningful when phone sign-in is on;
          // the table may not exist yet on a fresh env (messaging provisions
          // it at kernel:ready), so failures log-and-continue.
          if (this.authManager.isPhoneNumberEnabled()) {
            const engine = this.authManager.getDataEngine();
            if (engine) {
              const { seedPhoneSmsTemplates } = await import('./phone-sms-texts.js');
              await seedPhoneSmsTemplates(engine, ctx.logger);
            }
          }
        }

        let httpServer: IHttpServer | null = null;
        try {
          httpServer = ctx.getService<IHttpServer>('http-server');
        } catch {
          // Service not found — expected in MSW/mock mode
        }

        if (httpServer) {
          // Auto-detect the actual server URL when no explicit baseUrl was
          // configured, or when the configured baseUrl uses a different port
          // than the running server (e.g. port 3000 configured but 3002 bound).
          // getPort() is optional on IHttpServer; duck-type check for it.
          const serverWithPort = httpServer as IHttpServer & { getPort?: () => number };
          if (this.authManager && typeof serverWithPort.getPort === 'function') {
            const actualPort = serverWithPort.getPort();
            if (actualPort) {
              const configuredUrl = this.options.baseUrl || 'http://localhost:3000';
              const configuredOrigin = new URL(configuredUrl).origin;
              const actualUrl = `http://localhost:${actualPort}`;

              // Only auto-correct the port when the configured URL is already a
              // localhost URL (development mode). In production (Vercel/cloud) the
              // configured baseUrl is the real public hostname — never overwrite it
              // with a localhost URL, which would break OAuth callback URLs.
              const configuredIsLocalhost = configuredOrigin.startsWith('http://localhost');
              if (configuredIsLocalhost && configuredOrigin !== actualUrl) {
                this.authManager.setRuntimeBaseUrl(actualUrl);
                ctx.logger.info(
                  `Auth baseUrl auto-updated to ${actualUrl} (configured: ${configuredUrl})`,
                );
              }
            }
          }

          // Route registration errors should propagate (server misconfiguration)
          this.registerAuthRoutes(httpServer, ctx);
          ctx.logger.info(`Auth routes registered at ${this.options.basePath}`);
        } else {
          ctx.logger.warn(
            'No HTTP server available — auth routes not registered. ' +
            'Auth service is still available for MSW/mock environments via HttpDispatcher.'
          );
        }
      });
    }

    // Dev-only: provision a known, loginable platform admin on an empty DB.
    // Registered as its own kernel:ready hook (independent of registerRoutes)
    // so it runs whenever the runtime boots in development.
    ctx.hook('kernel:ready', async () => {
      await this.maybeSeedDevAdmin(ctx);
    });

    // better-auth 1.7 resolves every account by (issuer, accountId).
    // Rows written before the upgrade have no issuer and are therefore
    // invisible to sign-in, so stamp them once at boot. Idempotent: a database
    // whose rows already carry the right issuer costs one empty query.
    //
    // The providers are handed over as better-auth INSTANTIATED them, because
    // the issuer is theirs to declare and only they know it — Google names
    // `https://accounts.google.com`, GitHub names nothing and takes the
    // synthetic fallback. Deriving it from the configured ids instead is what
    // stamped Google links with a value sign-in never looks them up under.
    ctx.hook('kernel:ready', async () => {
      try {
        const ql = ctx.getService<IDataEngine>('objectql');
        if (!ql) return;
        const { backfillAccountIssuer } = await import('./backfill-account-issuer.js');
        await backfillAccountIssuer(ql, {
          logger: ctx.logger,
          socialProviders: await this.resolveInstantiatedSocialProviders(ctx),
          socialProviderIds: Object.keys(this.configuredSocialProviders ?? {}),
          oidcProviderIssuers: Object.fromEntries(
            (this.options.oidcProviders ?? [])
              .filter((p): p is typeof p & { issuer: string } => typeof p.issuer === 'string' && !!p.issuer)
              .map((p) => [p.providerId, p.issuer]),
          ),
        });
      } catch (e) {
        ctx.logger.warn?.('[auth] account issuer backfill failed', {
          error: (e as Error).message,
        });
      }
    });

    // [#8317] The one-off half of the ruling: rows written BEFORE the
    // canonicalisation hook above — or written outside ObjectQL entirely by an
    // operator SQL fix-up, an import or a SCIM group remap — still carry a
    // non-canonical `sys_member.role`, and each one is a live authorization
    // inversion (owner to us, plain member to better-auth). The pass is
    // convergent, idempotent and reports a census of every distinct spelling it
    // found, so a database already canonical costs one query.
    ctx.hook('kernel:ready', async () => {
      try {
        const ql = ctx.getService<IDataEngine>('objectql');
        if (!ql) return;
        const { canonicalizeStoredMemberRoles } = await import('./member-role-canonical.js');
        await canonicalizeStoredMemberRoles(ql, { logger: ctx.logger });
      } catch (e) {
        ctx.logger.warn?.('[auth] sys_member.role canonicalisation pass failed', {
          error: (e as Error).message,
        });
      }
    });

    // ADR-0081 D1 — single-org default-organization bootstrap. Every WALLED
    // posture (`group` and `isolated`) keeps its existing owner: the enterprise
    // organizations package, which runs the same idempotent helper with the
    // seed-ownership step injected. One crisp owner per posture, and the open
    // package never bootstraps an organization for a deployment whose
    // multi-organization runtime it does not provide.
    if (this.options.autoDefaultOrganization !== false && !postureEnforcesWall(resolveTenancyPosture())) {
      const runEnsure = async () => {
        try {
          const ql = ctx.getService<IDataEngine>('objectql');
          if (!ql) return;
          const res = await ensureDefaultOrganization(ql, { logger: ctx.logger });
          if (res.defaultOrgCreated) {
            ctx.logger.info(
              `[auth] created Default Organization ${res.defaultOrgId} for the platform admin (single-org)`,
            );
          }
        } catch (e) {
          ctx.logger.warn?.('[auth] ensureDefaultOrganization failed', {
            error: (e as Error).message,
          });
        }
      };
      ctx.hook('kernel:ready', runEnsure);
      // Re-run after every admin grant — covers the "first sign-up promoted
      // to platform admin" case where kernel:ready fired before any user
      // existed (same wiring the multi-org bootstrap uses).
      try {
        const ql = ctx.getService<IObjectQLEngine>('objectql');
        if (ql && typeof ql.registerMiddleware === 'function') {
          ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
            await next();
            if (
              opCtx?.object === 'sys_user_permission_set' &&
              (opCtx?.operation === 'insert' || opCtx?.operation === 'create')
            ) {
              await runEnsure();
            }
          });
        }
      } catch {
        /* objectql optional in mock mode — the kernel:ready pass still runs */
      }
    }

    // ADR-0093 D6 — backfill memberships for pre-existing member-less users
    // (historical create-user / import rows from before the reconciler existed).
    // Registered AFTER the default-org bootstrap hook so a target org exists by
    // the time it runs. `backfillMemberships` self-guards: it no-ops under
    // `invite-only` policy and in multi-org (tenancy.defaultOrgId() → null),
    // where a wrong org guess would be a data-exposure bug, not a convenience.
    // Opt out entirely via OS_SKIP_MEMBERSHIP_BACKFILL=1 (operators who curate
    // memberships by hand).
    if (String(process.env.OS_SKIP_MEMBERSHIP_BACKFILL ?? '').trim() !== '1') {
      // Serialize runs so overlapping triggers (kernel:ready + one or more
      // `app:seeded` from multiple app bundles) don't race the same scan and
      // trip the (organization_id, user_id) unique index into warn noise.
      let backfillChain: Promise<void> = Promise.resolve();
      const runBackfill = (source: string): Promise<void> => {
        backfillChain = backfillChain.then(async () => {
          try {
            // #5152 — the policy this pass runs under is a SETTING, so bind the
            // namespace before reading it. This hook is registered in `init()`
            // and therefore fires ahead of the one in `start()` that normally
            // binds; without this the first pass of a fresh boot would run the
            // pre-settings policy. Idempotent and shared with that hook.
            await this.ensureAuthSettingsBound(ctx);
            const ql = ctx.getService<IDataEngine>('objectql');
            const tenancy = this.tenancy;
            // #5152 — the policy is read off the AuthManager, the same object
            // the sign-up reconciler reads and the same one `applyConfigPatch`
            // targets. It used to be `this.options.membershipPolicy`, a
            // constructor option that no settings change can reach: an admin
            // switching to `invite-only` stopped sign-up auto-binds while this
            // pass kept bulk-binding every member-less user. No `??` fallback
            // to the options here on purpose — a second reading of the policy
            // is exactly the defect. The manager exists from `init()`, so the
            // guard is a precondition, not a degraded mode.
            const manager = this.authManager;
            if (!ql || !tenancy || !manager) return;
            const res = await backfillMemberships(ql, {
              policy: manager.getMembershipPolicy(),
              resolveTargetOrg: () => tenancy.defaultOrgId(),
              logger: ctx.logger,
            });
            if (res.bound > 0) {
              ctx.logger.info(
                `[auth] membership backfill (${source}) bound ${res.bound} member-less user(s) to the default organization (ADR-0093 D6)`,
                res,
              );
            }
          } catch (e) {
            ctx.logger.warn?.('[auth] membership backfill failed', {
              source,
              error: (e as Error).message,
            });
          }
        });
        return backfillChain;
      };
      ctx.hook('kernel:ready', () => runBackfill('kernel:ready'));
      // #2996: app seeds insert `sys_user` via raw engine.insert, bypassing
      // better-auth's `user.create.after` reconciler. A seed that overruns
      // OS_INLINE_SEED_BUDGET_MS finishes in the background AFTER kernel:ready,
      // so its users miss the one-shot backfill above. Re-run the (idempotent)
      // backfill when the app plugin signals seed settle.
      ctx.hook('app:seeded', () => runBackfill('app:seeded'));
    }

    // Identity-source provenance for accounts created OUTSIDE better-auth's
    // `databaseHooks` — @better-auth/scim creates `sys_account` at the adapter
    // level, which BYPASSES `account.create.after` / `stampIdentitySource`. This
    // ObjectQL `afterInsert` hook stamps `source=idp_provisioned` regardless of
    // the creation path, so SCIM-provisioned users are correctly marked as the
    // managed mirror (ADR-0024 D4 / ADR-0071 verification #1). It mirrors the
    // federated branch of `stampIdentitySource`, is idempotent, and never breaks
    // the insert. Complementary to (not a replacement for) the OAuth-path stamp.
    ctx.hook('kernel:ready', async () => {
      try {
        // Use the kernel's ObjectQL engine (available + hookable at kernel:ready);
        // the auth manager's getDataEngine() is not yet wired this early.
        const engine = ctx.getService<IObjectQLEngine>('objectql');
        if (!engine || typeof engine.registerHook !== 'function') return;
        const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] };
        engine.registerHook('afterInsert', async (hookCtx: any) => {
          try {
            if (hookCtx?.object !== 'sys_account') return;
            const acct: any = hookCtx.result ?? {};
            const providerId = acct.provider_id ?? acct.providerId;
            const userId = acct.user_id ?? acct.userId;
            // Only federated/SCIM accounts mark the user managed; a local
            // password (`credential`) keeps the user env-native.
            if (!userId || !providerId || providerId === 'credential') return;
            // QueryAST options use `where` (not `filter`); a wrong key is silently
            // ignored and counts every row — the bug that shipped env_native.
            const credCount = await engine.count('sys_account', {
              where: { user_id: userId, provider_id: 'credential' }, context: SYSTEM_CTX,
            });
            if (typeof credCount === 'number' && credCount > 0) return;
            const u = await engine.findOne('sys_user', {
              where: { id: userId }, fields: ['id', 'source'], context: SYSTEM_CTX,
            });
            if (u && u.source !== 'idp_provisioned') {
              await engine.update('sys_user', { id: userId, source: 'idp_provisioned' }, { context: SYSTEM_CTX });
            }
          } catch {
            // Provenance must never break account creation.
          }
        }, { packageId: 'com.objectstack.plugin-auth' });
        ctx.logger.info('Identity-source afterInsert stamp registered on sys_account (SCIM-safe)');
      } catch {
        // Engine not available — skip; OAuth path still stamps via databaseHooks.
      }
    });

    // ADR-0092 D2/D6 — generic identity write guard. Every object whose
    // schema declares `managedBy: 'better-auth'` gets fail-closed protection
    // against USER-CONTEXT writes through the generic data path; the only
    // opening is the per-object update whitelist (sys_user → profile fields).
    // Internal writes (better-auth adapter, isSystem plugin/system contexts)
    // bypass — see identity-write-guard.ts for the full contract.
    ctx.hook('kernel:ready', async () => {
      try {
        const engine = ctx.getService<IObjectQLEngine>('objectql');
        if (!engine || typeof engine.registerHook !== 'function') return;
        registerManagedUpdateWhitelist(SystemObjectName.USER, SYS_USER_PROFILE_EDIT_FIELDS);
        // [ADR-0105 D7] Extension fields ObjectStack adds to better-auth-managed
        // tables ride the SAME whitelist — no second mechanism. better-auth
        // neither reads nor writes them, so they are editable through the
        // ordinary path under normal FLS / requiredPermissions; its own protocol
        // fields stay rejected. `managed-extension-fields.test.ts` proves the two
        // populations are disjoint at the pinned better-auth version.
        for (const [object, fields] of Object.entries(MANAGED_EXTENSION_EDITABLE_FIELDS)) {
          if (object === SystemObjectName.USER) continue; // sys_user tiering above
          registerManagedUpdateWhitelist(object, fields);
        }
        // [#8317] Canonicalise `sys_member.role` on every ObjectQL write, at
        // priority 5 — AHEAD of both guards below. better-auth reads that
        // column with a raw `split(',')` (no trim, no lower-case), so a stored
        // `Owner` / `' owner'` is an owner to our grade ladder and a plain
        // member to the vendor, and its "only an owner may remove an owner"
        // branch never fires: an org admin could remove an owner. Normalising
        // at the write makes that disagreement unrepresentable instead of
        // adjudicated per-reader (maintainer ruling 2026-08-13, option A), and
        // it runs first so both guards judge the value's normal form.
        registerMemberRoleCanonicalization(engine, {
          packageId: 'com.objectstack.plugin-auth.member-role-canonical',
          logger: ctx.logger,
        });
        registerIdentityWriteGuard(engine, {
          packageId: 'com.objectstack.plugin-auth.identity-write-guard',
          logger: ctx.logger,
          getSecondaryStorage: () =>
            this.effectiveSecondaryStorage as SecondaryStorageLike | undefined,
        });
        // [cloud ADR-0024 D5.2] Break-glass — the same identity write
        // chokepoints, guarding a different question: not "may this caller
        // write identity tables" (above, and system writes bypass it by
        // design) but "may this WRITE happen at all". A `banned = true` (#5892)
        // or a row DELETE (#5941) on `sys_user`, and — since #5978 — any write
        // to `sys_member` / `sys_user_permission_set` that revokes the last
        // administrator's STANDING while leaving their user row untouched, is
        // refused for EVERY context, `isSystem` included: the paths that
        // actually lock an org out are the system ones (better-auth's admin
        // ban, remove-user and updateMemberRole, driven by a SCIM
        // `active: false` / `DELETE /Users/{id}` / group remap). Since #6084 it
        // also covers `sys_permission_set`: deleting or renaming the
        // `admin_full_access` row un-makes every platform admin at once, and
        // the zero-admin bootstrap exemption then switched the guard off for
        // all of the above. All eight hooks register at priority 20 so the
        // ADR-0092 checks above (10) still answer first for user-context
        // callers. See last-admin-guard.ts.
        registerLastAdminGuard(engine, {
          packageId: 'com.objectstack.plugin-auth.last-admin-guard',
          logger: ctx.logger,
        });
      } catch {
        // Engine not available (mock mode) — permission-set defaults remain
        // the only gate, exactly the pre-guard status quo.
      }
    });

    // Register auth middleware on ObjectQL engine (if available)
    try {
      const ql = ctx.getService<IObjectQLEngine>('objectql');
      if (ql && typeof ql.registerMiddleware === 'function') {
        ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
          // If context already has userId or isSystem, skip auth resolution
          if (opCtx.context?.userId || opCtx.context?.isSystem) {
            return next();
          }
          // Future: resolve session from AsyncLocalStorage or request context
          await next();
        });
        ctx.logger.info('Auth middleware registered on ObjectQL engine');
      }
    } catch (_e) {
      ctx.logger.debug('ObjectQL engine not available, skipping auth middleware registration');
    }

    ctx.logger.info('Auth Plugin started successfully');
  }

  /**
   * Bind the auth settings namespace once, whoever asks first.
   *
   * Two `kernel:ready` hooks need the settings applied, and they fire in
   * REGISTRATION order, which is the opposite of the order they need
   * (#5152): the ADR-0093 D6 membership backfill is registered in `init()`,
   * the settings binding in `start()`. Left alone, the very first backfill of
   * a fresh boot would read the pre-settings policy and bulk-bind every
   * pre-existing member-less user on a deployment whose stored setting says
   * `invite-only` — the exact failure the setting exists to prevent, on the
   * one pass nobody gets to observe before it has happened.
   *
   * So neither hook owns the binding: both await this, the first one through
   * performs it, and the memoized promise keeps `settings.subscribe` from
   * being registered twice.
   */
  private ensureAuthSettingsBound(ctx: PluginContext): Promise<void> {
    this.authSettingsBinding ??= this.bindAuthSettings(ctx);
    return this.authSettingsBinding;
  }

  /**
   * Bind the small open-source auth settings namespace to better-auth config.
   *
   * Only explicit settings values (stored or OS_AUTH_* env overrides) affect
   * runtime config. Manifest defaults are UI defaults and do not mask code or
   * deployment configuration.
   *
   * Call through {@link ensureAuthSettingsBound}, never directly.
   */
  private async bindAuthSettings(ctx: PluginContext): Promise<void> {
    if (!this.authManager) return;

    let settings: SettingsReadSurface | undefined;
    try {
      settings = ctx.getService<SettingsReadSurface>('settings');
    } catch {
      return;
    }
    if (!settings || typeof settings.getNamespace !== 'function') return;

    const applySettings = async (): Promise<void> => {
      if (!this.authManager) return;
      try {
        const payload = await settings.getNamespace('auth');
        const values: Record<string, unknown> = {};
        const sources: Record<string, string | undefined> = {};
        for (const [key, entry] of Object.entries(payload.values as Record<string, any>)) {
          values[key] = entry?.value;
          sources[key] = entry?.source;
        }

        const isExplicit = (key: string) => (sources[key] ?? 'default') !== 'default';
        const asBoolean = (value: unknown, fallback: boolean): boolean => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'string') return value.toLowerCase() !== 'false';
          if (typeof value === 'number') return value !== 0;
          return fallback;
        };
        const asTrimmedString = (value: unknown): string | undefined => {
          if (typeof value !== 'string') return undefined;
          const trimmed = value.trim();
          return trimmed ? trimmed : undefined;
        };
        const asPositiveInt = (value: unknown): number | undefined => {
          const n = Math.floor(Number(value));
          return Number.isFinite(n) && n > 0 ? n : undefined;
        };

        const patch: Partial<AuthManagerOptions> = {};
        const emailAndPassword: Partial<NonNullable<AuthConfig['emailAndPassword']>> = {};
        if (isExplicit('email_password_enabled')) {
          emailAndPassword.enabled = asBoolean(values.email_password_enabled, true);
        }
        if (isExplicit('signup_enabled')) {
          emailAndPassword.disableSignUp = !asBoolean(values.signup_enabled, true);
        }
        if (isExplicit('require_email_verification')) {
          emailAndPassword.requireEmailVerification = asBoolean(
            values.require_email_verification,
            false,
          );
        }

        // ADR-0093 D1 / #5152 — membership policy. `signup_enabled` says whether
        // people may self-register; this says what they join when they do, and
        // the two are halves of one platform posture, so it rides the same
        // settings seam. Only an EXPLICIT value applies: the manifest default
        // (`auto`) is a UI default and must not mask a deployment that set the
        // policy at construction.
        //
        // An unrecognised value is REJECTED, never coerced to `auto`. The
        // settings service enforces the option table on `setMany`, but an
        // `OS_AUTH_MEMBERSHIP_POLICY` env value bypasses that path entirely, and
        // silently reading a typo'd `invite_only` as `auto` would leave an
        // operator believing the wall is up while every sign-up is auto-bound —
        // invisible until someone finds a stranger in their org. `error`, not
        // `warn`: nothing looks broken afterwards.
        if (isExplicit('membership_policy')) {
          const raw = values.membership_policy;
          if (isMembershipPolicy(raw)) {
            patch.membershipPolicy = raw;
          } else {
            ctx.logger.error(
              `[auth] membership_policy '${String(raw)}' is not a valid policy — IGNORED, the deployment keeps its current policy ` +
                `('${this.authManager.getMembershipPolicy()}') and new sign-ups will continue to follow it. ` +
                `Set auth.membership_policy (or OS_AUTH_MEMBERSHIP_POLICY) to one of: ${MEMBERSHIP_POLICIES.join(', ')}.`,
            );
          }
        }
        // Password policy — better-auth enforces these bounds on sign-up and
        // password reset. Ignore malformed/non-positive values (keep the default).
        if (isExplicit('password_min_length')) {
          const n = asPositiveInt(values.password_min_length);
          if (n !== undefined) emailAndPassword.minPasswordLength = n;
        }
        if (isExplicit('password_max_length')) {
          const n = asPositiveInt(values.password_max_length);
          if (n !== undefined) emailAndPassword.maxPasswordLength = n;
        }
        if (Object.keys(emailAndPassword).length > 0) {
          patch.emailAndPassword = emailAndPassword as AuthManagerOptions['emailAndPassword'];
        }

        // Breached-password rejection (ADR-0069 D1) — enables better-auth's
        // native `haveibeenpwned` plugin via the plugin-config gate. Default
        // off; only an explicit toggle applies (manifest defaults must not
        // mask the deployment env var). See buildPluginList() for the seam.
        if (isExplicit('password_reject_breached')) {
          patch.plugins = {
            ...(patch.plugins ?? {}),
            passwordRejectBreached: asBoolean(values.password_reject_breached, false),
          } as AuthManagerOptions['plugins'];
        }

        // Password complexity (ADR-0069 D1) — custom validator in the before
        // hook (better-auth only enforces length). Only explicit values apply.
        if (isExplicit('password_require_complexity')) {
          patch.passwordRequireComplexity = asBoolean(values.password_require_complexity, false);
        }
        if (isExplicit('password_min_classes')) {
          const n = asPositiveInt(values.password_min_classes);
          if (n !== undefined) patch.passwordMinClasses = Math.min(4, Math.max(1, n));
        }
        if (isExplicit('password_history_count')) {
          // 0 disables → use a non-negative reader (asPositiveInt rejects 0).
          const n = Math.floor(Number(values.password_history_count));
          if (Number.isFinite(n) && n >= 0) patch.passwordHistoryCount = Math.min(24, n);
        }
        if (isExplicit('password_expiry_days')) {
          // 0 disables expiry → non-negative reader.
          const n = Math.floor(Number(values.password_expiry_days));
          if (Number.isFinite(n) && n >= 0) patch.passwordExpiryDays = Math.min(3650, n);
        }

        // Enforced MFA (ADR-0069 D3). Enabling it also turns the twoFactor
        // plugin on so the /two-factor/* enrollment endpoints exist — otherwise
        // gated users would have no way to comply.
        if (isExplicit('mfa_required')) {
          const on = asBoolean(values.mfa_required, false);
          patch.mfaRequired = on;
          if (on) {
            patch.plugins = {
              ...(patch.plugins ?? {}),
              twoFactor: true,
            } as AuthManagerOptions['plugins'];
          }
        }
        if (isExplicit('mfa_grace_period_days')) {
          const n = Math.floor(Number(values.mfa_grace_period_days));
          if (Number.isFinite(n) && n >= 0) patch.mfaGracePeriodDays = Math.min(90, n);
        }

        // Session lifetime — days → seconds for better-auth's `session`
        // (`expiresIn` = absolute lifetime; `updateAge` = refresh threshold).
        const session: { expiresIn?: number; updateAge?: number } = {};
        if (isExplicit('session_expiry_days')) {
          const d = asPositiveInt(values.session_expiry_days);
          if (d !== undefined) session.expiresIn = d * 86_400;
        }
        if (isExplicit('session_refresh_days')) {
          const d = asPositiveInt(values.session_refresh_days);
          if (d !== undefined) session.updateAge = d * 86_400;
        }
        if (Object.keys(session).length > 0) {
          patch.session = session as AuthManagerOptions['session'];
        }

        // Session controls (ADR-0069 D4) — idle / absolute / concurrent. 0 = off;
        // non-negative reader so an explicit 0 disables.
        const asNonNeg = (v: unknown): number | undefined => {
          const n = Math.floor(Number(v));
          return Number.isFinite(n) && n >= 0 ? n : undefined;
        };
        if (isExplicit('session_idle_timeout_minutes')) {
          const n = asNonNeg(values.session_idle_timeout_minutes);
          if (n !== undefined) patch.sessionIdleTimeoutMinutes = n;
        }
        if (isExplicit('session_absolute_max_hours')) {
          const n = asNonNeg(values.session_absolute_max_hours);
          if (n !== undefined) patch.sessionAbsoluteMaxHours = n;
        }
        if (isExplicit('max_concurrent_sessions_per_user')) {
          const n = asNonNeg(values.max_concurrent_sessions_per_user);
          if (n !== undefined) patch.maxConcurrentSessions = n;
        }

        // Network gating (ADR-0069 D5) — parse the CIDR/IP textarea into a list.
        if (isExplicit('allowed_ip_ranges')) {
          const raw = asTrimmedString(values.allowed_ip_ranges) ?? '';
          patch.allowedIpRanges = raw
            .split(/[\n,]+/)
            .map((r) => r.trim())
            .filter(Boolean);
        }

        // Anti-abuse (ADR-0069 D2) — account lockout (custom, per-identity)
        // and rate-limit tuning (better-auth-native, per-IP). `asPositiveInt`
        // rejects 0/malformed; lockout_threshold uses a non-negative reader so
        // an explicit 0 can turn the feature off.
        const asNonNegativeInt = (value: unknown): number | undefined => {
          const n = Math.floor(Number(value));
          return Number.isFinite(n) && n >= 0 ? n : undefined;
        };
        if (isExplicit('lockout_threshold')) {
          const n = asNonNegativeInt(values.lockout_threshold);
          if (n !== undefined) patch.lockoutThreshold = n;
        }
        if (isExplicit('lockout_duration_minutes')) {
          const n = asPositiveInt(values.lockout_duration_minutes);
          if (n !== undefined) patch.lockoutDurationMinutes = n;
        }
        if (isExplicit('rate_limit_max') || isExplicit('rate_limit_window_seconds')) {
          const max = asPositiveInt(values.rate_limit_max) ?? 10;
          const window = asPositiveInt(values.rate_limit_window_seconds) ?? 60;
          // Tighten the auth-mutating endpoints; better-auth keeps its own
          // defaults for everything else. customRules support `*` wildcards.
          patch.rateLimit = {
            enabled: true,
            window,
            max,
            customRules: {
              '/sign-in/email': { window, max },
              '/sign-up/email': { window, max },
              '/request-password-reset': { window, max },
              '/reset-password': { window, max },
              // #2780 — OTP endpoints cost an SMS per hit (pumping abuse);
              // the per-number cooldown (otp-send-guard.ts) is always on,
              // this adds the operator-tuned per-IP dimension. The plugin
              // also ships its own /phone-number* default (10/min).
              '/phone-number/send-otp': { window, max },
              '/phone-number/request-password-reset': { window, max },
              '/phone-number/verify': { window, max },
              '/phone-number/reset-password': { window, max },
            },
          } as AuthManagerOptions['rateLimit'];
        }

        if (
          isExplicit('google_enabled') ||
          isExplicit('google_client_id') ||
          isExplicit('google_client_secret')
        ) {
          const socialProviders = {
            ...(this.configuredSocialProviders ?? {}),
          } as NonNullable<SocialProviderConfig>;
          const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
          const googleEnabledFromEnv = env?.OS_AUTH_GOOGLE_ENABLED != null
            ? asBoolean(env.OS_AUTH_GOOGLE_ENABLED, true)
            : undefined;
          const googleClientId = asTrimmedString(values.google_client_id) ?? env?.GOOGLE_CLIENT_ID;
          const googleClientSecret = asTrimmedString(values.google_client_secret) ?? env?.GOOGLE_CLIENT_SECRET;
          if (googleEnabledFromEnv ?? (isExplicit('google_enabled') ? asBoolean(values.google_enabled, true) : true)) {
            if (!socialProviders.google && googleClientId && googleClientSecret) {
              socialProviders.google = {
                clientId: googleClientId,
                clientSecret: googleClientSecret,
                enabled: true,
              };
            }
          } else {
            delete socialProviders.google;
          }
          patch.socialProviders = Object.keys(socialProviders).length > 0
            ? socialProviders
            : undefined;
        }

        if (Object.keys(patch).length > 0) {
          this.authManager.applyConfigPatch(patch);
        }
      } catch (err: any) {
        ctx.logger.warn('Auth: failed to apply auth settings: ' + (err?.message ?? err));
      }
    };

    await applySettings();
    if (typeof settings.subscribe === 'function') {
      settings.subscribe('auth', () => {
        void applySettings();
      });
      ctx.logger.info('Auth: bound to settings namespace=auth');
    }
  }

  async destroy(): Promise<void> {
    // Cleanup if needed
    this.authManager = null;
  }

  /**
   * Dev-only admin bootstrap.
   *
   * On an EMPTY database (zero users), provision a well-known, loginable
   * admin (admin@objectos.ai / admin123 by default) so backend debugging
   * never blocks on a first-run sign-up wizard. The account is created
   * through better-auth's real server-side `signUpEmail` pipeline (hashed
   * credential + the same hooks the HTTP endpoint runs), so it is fully
   * loginable; plugin-security's first-user middleware then promotes it to
   * platform admin automatically.
   *
   * This replaces two earlier, divergent seeds:
   *   • the CLI-side HTTP seed (`os dev`), which POSTed the public sign-up
   *     endpoint from the parent process — racing server readiness and
   *     targeting a hard-coded port that broke under dev port auto-shift; and
   *   • plugin-dev's raw `sys_user` insert, which produced a credential-less,
   *     un-loginable row.
   * Running it in-process needs no port and no readiness polling.
   *
   * Idempotent and non-destructive: it only ever acts on a zero-user DB and
   * never touches an existing account, so a custom password is never
   * overwritten.
   *
   * HARD-GATED to development (NODE_ENV==='development'): a known-credential
   * admin can never be provisioned in production. Opt out within dev via
   * OS_SEED_ADMIN=0 (or false/off/no).
   */
  private async maybeSeedDevAdmin(ctx: PluginContext): Promise<void> {
    if (process.env.NODE_ENV !== 'development') return;
    const flag = String(process.env.OS_SEED_ADMIN ?? '').trim().toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(flag)) return;

    const email = process.env.OS_SEED_ADMIN_EMAIL?.trim() || 'admin@objectos.ai';
    const password = process.env.OS_SEED_ADMIN_PASSWORD?.trim() || 'admin123';
    const name = process.env.OS_SEED_ADMIN_NAME?.trim() || 'Dev Admin';

    let ql: IDataEngine | undefined;
    try { ql = ctx.getService<IDataEngine>('objectql'); } catch { /* unavailable */ }
    if (!ql || typeof ql.find !== 'function') return;

    try {
      // Only seed when no HUMAN user exists yet. A fresh DB still contains
      // the system service account (SystemUserId.SYSTEM, role='system'),
      // which must NOT count — mirror plugin-security's first-user detection
      // so the seed fires on a genuinely empty DB. Any real human user (or a
      // prior sign-up) disables the seed for good; we never touch or
      // overwrite an existing account.
      const rows = await ql
        .find(SystemObjectName.USER, { where: {}, limit: 50 }, { context: { isSystem: true } })
        .catch(() => []);
      const humans = (Array.isArray(rows) ? rows : [])
        .filter((u: any) => u && u.id !== SystemUserId.SYSTEM && u.role !== 'system');
      if (humans.length > 0) {
        ctx.logger.debug('[auth] dev admin seed skipped — a user already exists');
        // `os dev` defaults to a persistent DB, so the seed fires exactly
        // once — but the startup banner and the Console login hint read
        // `devSeedResult`, which used to be set only on the seeding boot.
        // Re-arm it on every later dev boot for as long as the credentials
        // actually still work (account exists AND still carries the default
        // password), so returning users keep seeing how to sign in.
        await this.maybeReportExistingSeedAdmin(ctx, ql, humans, email, password);
        return;
      }

      if (!this.authManager) return;
      const api: any = await this.authManager.getApi();
      if (typeof api?.signUpEmail !== 'function') {
        ctx.logger.warn('[auth] dev admin seed skipped — signUpEmail unavailable');
        return;
      }

      // Real auth pipeline: creates sys_user + a hashed `credential` account
      // and runs the sign-up hooks. The dev-mode OS_DISABLE_SIGNUP bypass
      // (auth-manager.ts) lets this through on an empty DB even when sign-up
      // is otherwise disabled.
      await api.signUpEmail({ body: { email, password, name } });
      ctx.logger.info(`🔑 Dev admin seeded: ${email} / ${password}`);
      // Surface the credentials in the `serve` startup banner. The
      // ctx.logger line above is swallowed by serve's boot-quiet window
      // (the seed runs during runtime.start(), before stdout is restored),
      // so the CLI reads this off the `auth` service and prints it after
      // the banner instead.
      this.authManager.devSeedResult = { email, password };
    } catch (err: any) {
      // Best-effort. The common benign case is a race where a real sign-up
      // landed first (unique-email violation) — treat as "already seeded".
      ctx.logger.warn(`[auth] dev admin seed skipped: ${err?.message ?? err}`);
    }
  }

  /**
   * Boots after the seeding one: surface the dev credentials again if (and
   * only if) the seed account still exists with the DEFAULT password —
   * verified against the stored credential hash with better-auth's native
   * `password.verify`, so the hint disappears the boot after an admin
   * changes the password. Only reachable from `maybeSeedDevAdmin`'s
   * NODE_ENV==='development' gate; `devSeedResult` therefore never exists in
   * production, which is what keeps `getPublicConfig().devSeedAdmin` (the
   * login-page hint) dev-only by construction. Best-effort: any lookup or
   * verify failure just leaves the hint off.
   */
  private async maybeReportExistingSeedAdmin(
    ctx: PluginContext,
    ql: any,
    humans: any[],
    email: string,
    password: string,
  ): Promise<void> {
    try {
      if (!this.authManager) return;
      const seedUser = humans.find(
        (u: any) => typeof u?.email === 'string' && u.email.toLowerCase() === email.toLowerCase(),
      );
      if (!seedUser?.id) return;

      const accounts = await ql
        .find(
          'sys_account',
          { where: { user_id: seedUser.id, provider_id: 'credential' }, limit: 1 },
          { context: { isSystem: true } },
        )
        .catch(() => []);
      // [#8676] `sys_account.password` is `internal: true`, so the row above
      // arrives without it — the engine's strip has no `isSystem` carve-out.
      // Recover it through the privileged accessor; otherwise this probe reads
      // `undefined` on every boot and the dev credential hint silently stops
      // appearing (fails soft, which is why it would never be noticed).
      await recoverInternalFieldsForSystemRead(ql, 'sys_account', accounts, ['password']);
      const hash = Array.isArray(accounts) ? accounts[0]?.password : undefined;
      if (typeof hash !== 'string' || hash.length === 0) return;

      const authCtx: any = await this.authManager.getAuthContext();
      const verify = authCtx?.password?.verify;
      if (typeof verify !== 'function') return;
      const stillDefault = await verify.call(authCtx.password, { password, hash });
      if (stillDefault === true) {
        this.authManager.devSeedResult = { email, password };
        ctx.logger.debug('[auth] dev admin still on default credentials — surfacing the hint');
      }
    } catch (err: any) {
      ctx.logger.debug(`[auth] dev seed-admin probe skipped: ${err?.message ?? err}`);
    }
  }

  /**
   * Register authentication routes with HTTP server
   * 
   * Uses better-auth's universal handler for all authentication requests.
   * This forwards all requests under basePath to better-auth, which handles:
   * - Email/password authentication
   * - OAuth providers (Google, GitHub, etc.)
   * - Session management
   * - Password reset
   * - Email verification
   * - 2FA, passkeys, magic links (if enabled)
   */
  private registerAuthRoutes(httpServer: IHttpServer, ctx: PluginContext): void {
    if (!this.authManager) return;

    const basePath = this.options.basePath || '/api/v1/auth';

    // Get raw Hono app to use native wildcard routing
    // Type assertion is safe here because we explicitly require Hono server as a dependency
    if (!('getRawApp' in httpServer) || typeof (httpServer as any).getRawApp !== 'function') {
      ctx.logger.error('HTTP server does not support getRawApp() - wildcard routing requires Hono server');
      throw new Error(
        'AuthPlugin requires HonoServerPlugin for wildcard routing support. ' +
        'Please ensure HonoServerPlugin is loaded before AuthPlugin.'
      );
    }

    const rawApp = (httpServer as any).getRawApp();

    // ── ADR-0069 D5 — network gating (IP allow-list) ──────────────────────
    // Reject auth requests from a client IP outside the configured ranges,
    // BEFORE they reach better-auth. Registered first so it runs ahead of the
    // routes below. The public render helpers (/config, /bootstrap-status) are
    // exempt so a blocked client still gets a clean login page + error. No-op
    // (and no IP parse) when no ranges are configured.
    if (typeof rawApp.use === 'function') rawApp.use(`${basePath}/*`, async (c: any, next: any) => {
      const mgr = this.authManager;
      if (!mgr || typeof mgr.isClientIpAllowed !== 'function') return next();
      const path: string = c.req.path || '';
      if (path.endsWith('/config') || path.endsWith('/bootstrap-status')) return next();
      const fwd = c.req.header('x-forwarded-for');
      const ip =
        (typeof fwd === 'string' && fwd.split(',')[0].trim()) ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        undefined;
      if (!mgr.isClientIpAllowed(ip)) {
        return c.json(
          { success: false, error: { code: 'IP_NOT_ALLOWED', message: 'Sign-in is not allowed from your network.' } },
          403,
        );
      }
      return next();
    });

    // Register /config before the wildcard so it takes precedence.
    // better-auth has no /config endpoint, so without this explicit route
    // the wildcard below forwards the request and better-auth returns 404.
    rawApp.get(`${basePath}/config`, async (c: any) => {
      try {
        const config = this.authManager!.getPublicConfig();
        // Refine the coarse "SSO wired" flag to "SSO usable" (≥1 provider
        // configured) so the login UI also hides the "Sign in with SSO" button
        // when SSO is enabled but no IdP exists yet — not just when it's off.
        // Only queries when wired; falls open on any error (see isSsoUsable).
        if (config.features?.sso) {
          config.features.sso = await this.authManager!.isSsoUsable();
        }
        return c.json({ success: true, data: config });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return c.json({ success: false, error: { code: 'AUTH_CONFIG_ERROR', message: err.message } }, 500);
      }
    });

    // Bootstrap status — does an owner exist yet? Used by the Account SPA's
    // root route to decide between rendering /login (normal flow) and
    // /setup (first-run owner creation). Public, unauthenticated; only
    // returns a boolean so it can be polled before the user has any
    // credentials.
    rawApp.get(`${basePath}/bootstrap-status`, async (c: any) => {
      try {
        const dataEngine = this.authManager!.getDataEngine();
        if (!dataEngine) {
          // No data engine wired (e.g. MSW/mock mode) — assume bootstrapped
          // so the SPA falls through to its normal login flow.
          return c.json({ hasOwner: true });
        }
        const count = await dataEngine.count('sys_user', {});
        return c.json({ hasOwner: (count ?? 0) > 0 });
      } catch (error) {
        ctx.logger.warn('[AuthPlugin] bootstrap-status check failed; assuming bootstrapped', error as Error);
        return c.json({ hasOwner: true });
      }
    });

    // Device Authorization Grant (RFC 8628) endpoints — `/device/code`,
    // `/device/token`, `/device/approve`, `/device/deny`, `/device` — are
    // provided by better-auth's `device-authorization` plugin and reach
    // the wildcard handler below. Enable via
    // `AuthPluginConfig.deviceAuthorization`.

    // Set an INITIAL local password for users who signed in via SSO and
    // have no `credential` account yet. This is the "Set local password"
    // affordance on a per-environment kernel — it lets a user that the
    // platform onboarded via the objectstack-cloud OAuth provider sign in
    // with email/password against this environment going forward without
    // needing the SSO round-trip. Requires a valid session (so we know
    // which user is asking) and refuses if a credential already exists
    // (the user should use better-auth's /change-password endpoint in
    // that case so the current password is verified).
    //
    // The body is `runSetInitialPassword` (shared with the cloud
    // AuthProxyPlugin) so both mount points wrap better-auth's server-only
    // `auth.api.setPassword` identically — see set-initial-password.ts.
    rawApp.post(`${basePath}/set-initial-password`, async (c: any) => {
      try {
        const authApi = await this.authManager!.getApi();
        const { status, body } = await runSetInitialPassword(authApi as any, c.req.raw);
        return c.json(body, status);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] set-initial-password failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // OAuth admin: toggle the `disabled` flag on a registered OAuth client.
    //
    // Why this lives here (and not as a plain data-layer UPDATE on
    // sys_oauth_application): better-auth 1.6.11's stock admin update
    // endpoint (`/admin/oauth2/update-client`) does NOT accept `disabled`
    // in its Zod body schema, so the field gets silently stripped before
    // it reaches `updateClientEndpoint`. The column exists, the runtime
    // honours it everywhere (introspect, token, authorize, public-client
    // lookup), but no client-facing API can flip it.
    //
    // We close the gap by writing through better-auth's own adapter under
    // the `/api/v1/auth/*` namespace so all OAuth-application mutations
    // remain auth-routed (no generic data-layer bypass for the `oauth_client`
    // model). When upstream adds `disabled` to `adminUpdateOAuthClient`'s
    // schema, this route can be deleted and the sys_oauth_application
    // action retargeted to the stock endpoint.
    //
    // Upstream tracking: https://github.com/better-auth/better-auth
    rawApp.post(`${basePath}/admin/oauth2/toggle-disabled`, async (c: any) => {
      try {
        let body: any = {};
        try { body = await c.req.json(); } catch { body = {}; }
        const clientId: unknown = body?.client_id;
        const disabled: unknown = body?.disabled;
        if (typeof clientId !== 'string' || clientId.length === 0) {
          return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'client_id is required' } }, 400);
        }
        if (typeof disabled !== 'boolean') {
          return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'disabled must be a boolean' } }, 400);
        }

        // Platform-admin gate (ADR-0068 D2) — one shared judge for every
        // ObjectStack `/admin/*` mount; see platform-admin-gate.ts.
        const authApi = await this.authManager!.getApi();
        const session = await authApi.getSession({ headers: c.req.raw.headers });
        const verdict = judgePlatformAdmin(session);
        if (!verdict.ok) return c.json(verdict.refusal.body, verdict.refusal.status);

        // Write through the same ObjectQL data engine that better-auth's
        // adapter uses. We target the snake_case table name (`sys_oauth_application`,
        // mapped from better-auth's internal `oauthClient` model via
        // `auth-schema-config.ts`) because `$context.adapter`'s model-lookup
        // helper does not see plugin-provided model names from outside
        // better-auth's own endpoint invocation context. This is the same
        // physical row the better-auth runtime reads at introspect / token
        // / authorize time, so the toggle is fully honoured.
        const dataEngine: any = this.authManager!.getDataEngine();
        if (!dataEngine) {
          return c.json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Data engine unavailable' } }, 503);
        }

        const existing = await dataEngine.findOne('sys_oauth_application', {
          where: { client_id: clientId },
        });
        if (!existing) {
          return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'OAuth client not found' } }, 404);
        }

        const updated = await dataEngine.update('sys_oauth_application', {
          id: existing.id,
          disabled,
          updated_at: new Date(Math.floor(Date.now() / 1000) * 1000),
        });
        if (!updated) {
          return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to update OAuth client' } }, 500);
        }

        return c.json({
          success: true,
          data: {
            client_id: clientId,
            disabled,
          },
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] toggle-disabled failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ── ADR-0068 D2/D4 — the ONE platform-admin gate helper for every raw
    // `/admin/*` mount below (see platform-admin-gate.ts for the judge and
    // its unit-tested posture matrix). Returns the admitted actor, or the
    // refusal Response to hand straight back. Hoisted here (#9653) so the
    // four `/admin/sso/*` bridges and the #2766 admin-user block share one
    // spelling instead of accreting per-mount copies.
    const gateAdmin = async (c: any): Promise<PlatformAdminActor | Response> => {
      const authApi = await this.authManager!.getApi();
      const session = await (authApi as any).getSession({ headers: c.req.raw.headers });
      const verdict = judgePlatformAdmin(session);
      if (!verdict.ok) return c.json(verdict.refusal.body, verdict.refusal.status);
      return verdict.actor;
    };

    // ────────────────────────────────────────────────────────────────────
    // SSO admin: register an external OIDC IdP from the flat metadata form
    // (ADR-0024). `@better-auth/sso`'s POST /sso/register expects the protocol
    // fields NESTED under `oidcConfig` ({ clientId, clientSecret,
    // discoveryEndpoint, scopes, mapping }). The `sys_sso_provider`
    // `register_sso_provider` action collects FLAT form fields (the action
    // param schema has no nested-path support), so posting them straight to
    // /sso/register lands them at the top level where better-auth's Zod schema
    // strips them → a provider with `oidc_config = null` that can never
    // complete a login. This thin bridge reshapes the flat form body into the
    // nested shape and RE-DISPATCHES it through the real /sso/register endpoint
    // (via the better-auth handler) so the public-routable trustedOrigins
    // allowance, discovery hydration, and secret handling all still run. No
    // bespoke persistence. Retire when the action framework gains nested-param
    // support.
    //
    // #9653 — ADR-0068 D4: the platform-admin gate runs HERE, before the
    // bridge delegates. Registering an identity provider is a platform-
    // operator action, and the delegated authorization is NOT a substitute:
    // measured on the installed @better-auth/sso 1.7.1, the vendor's
    // /sso/register admits ANY authenticated user when no organizationId is
    // supplied (the org-admin check is inside `if (ctx.body.organizationId)`),
    // and the auth-manager before-hook that narrows this admits org
    // owners/admins, who are not platform admins (ADR-0068). Gating first
    // also un-masks the refusal labels: an anonymous caller used to get the
    // capability error (404 SSO_REGISTER_FAILED), never a 401. Anonymous-
    // first ordering — identity error before capability error — so the gate
    // runs ahead of the bridge's own body validation.
    rawApp.post(`${basePath}/admin/sso/register`, async (c: any) => {
      try {
        const gated = await gateAdmin(c);
        if (gated instanceof Response) return gated;
        const { status, body } = await runRegisterSsoProviderFromForm(
          (req) => this.authManager!.handleRequest(req),
          c.req.raw,
        );
        return c.json(body, status as any);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] sso/register bridge failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // ADR-0069 D2 — admin: clear a brute-force lockout on an account.
    // Lockout (`sys_user.locked_until` / `failed_login_count`) is a custom,
    // per-identity mechanism with no better-auth endpoint, so this route owns
    // the "Unlock" affordance (sys_user `unlock_user` action). Admin-guarded
    // server-side; mirrors the toggle-disabled route's session+role check.
    rawApp.post(`${basePath}/admin/unlock-user`, async (c: any) => {
      try {
        let body: any = {};
        try { body = await c.req.json(); } catch { body = {}; }
        const userId: unknown = body?.userId ?? body?.user_id;
        if (typeof userId !== 'string' || userId.length === 0) {
          return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'userId is required' } }, 400);
        }

        // Platform-admin gate (ADR-0068 D2) — see platform-admin-gate.ts.
        const authApi = await this.authManager!.getApi();
        const session = await authApi.getSession({ headers: c.req.raw.headers });
        const verdict = judgePlatformAdmin(session);
        if (!verdict.ok) return c.json(verdict.refusal.body, verdict.refusal.status);

        const ok = await this.authManager!.unlockUser(userId);
        if (!ok) {
          return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found or data engine unavailable' } }, 404);
        }
        return c.json({ success: true, data: { userId } });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] unlock-user failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // #2766 V1 — admin direct user management. `sys_user` CRUD is suppressed
    // (managedBy better-auth), and until now the only add-a-teammate path was
    // the email-dependent invite flow. These routes let a platform admin
    // create a login-capable account (better-auth pipeline: scrypt hash +
    // credential sys_account) and (re)set passwords, with an optional
    // generated temporary password + a must-change-on-first-login flag.
    //
    // Both routes run the same ADR-0068 platform-admin gate as unlock-user
    // above, then call trusted server-side better-auth surfaces — see
    // admin-user-endpoints.ts for why the stock role check doesn't fit.
    //
    // NOTE: /admin/set-user-password intentionally SHADOWS better-auth's
    // native route (registered before the catch-all below). The native
    // handler only accepts the legacy `role === 'admin'` scalar, which
    // ADR-0068 platform admins may not carry; this wrapper accepts the
    // canonical platform-admin signals and adds the force-change stamp.
    {
      const adminUserDeps = (): import('./admin-user-endpoints.js').AdminUserEndpointDeps => ({
        getAuthApi: () => this.authManager!.getApi() as any,
        getAuthContext: () => this.authManager!.getAuthContext(),
        getDataEngine: () => this.authManager!.getDataEngine(),
        assertPasswordComplexity: (pw: string) => this.authManager!.checkPasswordComplexity(pw),
        noteMustChangePasswordIssued: () => this.authManager!.noteMustChangePasswordIssued(),
        phoneNumberEnabled: () => this.authManager!.isPhoneNumberEnabled(),
        // ADR-0093 D3 — mode-aware create-user bind: multi-org resolves NO
        // target org (never grab the bootstrap default org in a multi-tenant
        // deployment); single-org resolves the default org.
        getTenancy: () => this.tenancy ?? undefined,
        logger: ctx.logger,
      });
      // Gate: the shared `gateAdmin` hoisted above the SSO mounts (#9653).

      rawApp.post(`${basePath}/admin/create-user`, async (c: any) => {
        try {
          const actor = await gateAdmin(c);
          if (actor instanceof Response) return actor;
          const authApi: any = await this.authManager!.getApi();
          if (typeof authApi.createUser !== 'function') {
            return c.json(
              { success: false, error: { code: 'NOT_IMPLEMENTED', message: 'The better-auth admin plugin is not enabled (auth.plugins.admin)' } },
              501,
            );
          }
          const { runAdminCreateUser } = await import('./admin-user-endpoints.js');
          // [#4586] This route authorized the admin itself (`gateAdmin`) and
          // then drives better-auth SERVER-SIDE, so it never passes through
          // `AuthManager.handleRequest` and the request-scoped actor seam is
          // not open. Open it here with the actor already in hand, so the
          // identity rows this creates — and the membership the reconciler
          // binds in `user.create.after` — are credited to the admin instead
          // of recorded as the system. Attribution only: the route's own
          // authorization already happened above, and the writes stay system.
          const { status, body } = await runAttributedToUser(actor.id, () =>
            runAdminCreateUser(adminUserDeps(), c.req.raw, actor),
          );
          return c.json(body, status as any);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          ctx.logger.error('[AuthPlugin] admin/create-user failed', err);
          return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
        }
      });

      // ── #9652: ban / unban, re-mounted with the ADR-0068 gate ────────────
      //
      // These SHADOW better-auth's native `/admin/ban-user` and
      // `/admin/unban-user`. The vendor's `admin` plugin authorizes on the
      // legacy `user.role === 'admin'` scalar that ADR-0068 D2 stopped
      // synthesizing, and it exposes no option that can be pointed at
      // ObjectStack's predicate — a MEASURED property of the installed
      // version, written up in admin-ban-endpoints.ts. The result was that the
      // `sys_user` Ban / Unban buttons 403'd for every platform admin on any
      // deployment with the admin plugin on (SCIM forces it, ADR-0071).
      //
      // ⚠️ Shadowing detaches better-auth hooks keyed on the path: the
      // break-glass last-local-credential guard used to fire on
      // `/admin/ban-user` from `auth-manager.ts`. `runAdminBanUser` re-runs it
      // from the shared module.
      const adminBanDeps = (): AdminBanEndpointDeps => ({
        getAuthContext: () => this.authManager!.getAuthContext(),
      });

      /**
       * Refuse when the admin plugin is off, exactly as create-user does.
       *
       * Without this the shadowing mounts would answer 200 on a deployment
       * that has no admin plugin — writing `banned: true` while the vendor's
       * session hook that ENFORCES a ban is not loaded. That is a
       * declared-but-not-enforced ban: the console reports success and the
       * banned user signs straight back in. `banUser` on the api surface is
       * the same seam create-user tests for.
       */
      const adminPluginMissing = async (c: any): Promise<Response | undefined> => {
        const authApi: any = await this.authManager!.getApi();
        if (typeof authApi.banUser === 'function') return undefined;
        return c.json(
          { success: false, error: { code: 'NOT_IMPLEMENTED', message: 'The better-auth admin plugin is not enabled (auth.plugins.admin)' } },
          501,
        );
      };

      rawApp.post(`${basePath}/admin/ban-user`, async (c: any) => {
        try {
          const actor = await gateAdmin(c);
          if (actor instanceof Response) return actor;
          const unavailable = await adminPluginMissing(c);
          if (unavailable) return unavailable;
          // Attributed to the admin for the same reason create-user is: the
          // write is driven server-side and never passes through
          // `AuthManager.handleRequest`, so the request-scoped actor seam is
          // not open unless we open it here.
          const { status, body } = await runAttributedToUser(actor.id, () =>
            runAdminBanUser(adminBanDeps(), actor, c.req.raw),
          );
          return c.json(body, status as any);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          ctx.logger.error('[AuthPlugin] admin/ban-user failed', err);
          return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
        }
      });

      rawApp.post(`${basePath}/admin/unban-user`, async (c: any) => {
        try {
          const actor = await gateAdmin(c);
          if (actor instanceof Response) return actor;
          const unavailable = await adminPluginMissing(c);
          if (unavailable) return unavailable;
          const { status, body } = await runAttributedToUser(actor.id, () =>
            runAdminUnbanUser(adminBanDeps(), actor, c.req.raw),
          );
          return c.json(body, status as any);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          ctx.logger.error('[AuthPlugin] admin/unban-user failed', err);
          return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
        }
      });

      rawApp.post(`${basePath}/admin/set-user-password`, async (c: any) => {
        try {
          const actor = await gateAdmin(c);
          if (actor instanceof Response) return actor;
          const { runAdminSetUserPassword } = await import('./admin-user-endpoints.js');
          const { status, body } = await runAdminSetUserPassword(adminUserDeps(), c.req.raw, actor);
          return c.json(body, status as any);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          ctx.logger.error('[AuthPlugin] admin/set-user-password failed', err);
          return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
        }
      });

      // #2766 V2 — identity bulk import (re-scoped #2758). Reuses the generic
      // import framework's parsing + row engine but writes every row through
      // better-auth (hash + credential account) — see admin-import-users.ts
      // for the password policies (invite / temporary) and deliberate limits
      // (sync ≤500 rows, no undo, profile-only upsert updates).
      rawApp.post(`${basePath}/admin/import-users`, async (c: any) => {
        try {
          const actor = await gateAdmin(c);
          if (actor instanceof Response) return actor;
          const { runAdminImportUsers } = await import('./admin-import-users.js');
          // [#4251] Resolved from `protocol`, not `metadata`. `getMetaItem` is a
          // PROTOCOL method (`ObjectStackProtocolImplementation`, registered by
          // MetadataProtocolPlugin); the `metadata` slot holds MetadataManager,
          // which has never had it. So `metadataService?.getMetaItem` was always
          // falsy and the field-coercion dep was never passed — an import row's
          // values reached `sys_user` uncoerced, with the branch that says
          // otherwise sitting right here. Invisible while the lookup was `any`:
          // typing it to the slot's contract is what turned the dead probe into
          // a compile error.
          const metaReader = (() => {
            try { return ctx.getService?.<MetaItemReaderSurface>('protocol'); } catch { return undefined; }
          })();
          // [#4586] Same seam as create-user: server-side better-auth calls,
          // credited to the admin who ran the import.
          const { status, body } = await runAttributedToUser(actor.id, () =>
            runAdminImportUsers(
            {
              getAuthApi: () => this.authManager!.getApi() as any,
              getDataEngine: () => this.authManager!.getDataEngine(),
              ...(typeof metaReader?.getMetaItem === 'function'
                ? { getMetaItem: (ref: { type: string; name: string }) => metaReader.getMetaItem(ref) }
                : {}),
              phoneNumberEnabled: () => this.authManager!.isPhoneNumberEnabled(),
              emailServiceAvailable: () => this.authManager!.isEmailServiceAvailable(),
              // #2780 — SMS invites need the phone plugin (the invitee's
              // first sign-in is a phone OTP) plus deliverable SMS.
              smsInviteAvailable: () =>
                this.authManager!.isPhoneNumberEnabled() && this.authManager!.isPhoneOtpDeliverable(),
              sendInviteSms: (phone: string) => this.authManager!.sendPhoneInviteSms(phone),
              noteMustChangePasswordIssued: () => this.authManager!.noteMustChangePasswordIssued(),
              logger: ctx.logger,
            },
            c.req.raw,
            actor,
            ),
          );
          return c.json(body, status as any);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          ctx.logger.error('[AuthPlugin] admin/import-users failed', err);
          return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
        }
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // #9941 — organization/add-member. better-auth declares `addMember`
    // WITHOUT an HTTP path (server-only `auth.api.addMember`; measured on the
    // installed 1.7.1), so the catch-all never mounts it — yet the
    // `sys_member` `add_member` toolbar action has always targeted this URL,
    // and on a multi-org posture it is the only UI path that can attach an
    // existing user to an organization. This mount restores that declared
    // surface behind the shared ADR-0068 platform-admin gate (attaching a
    // user without their consent is a platform-operator action, and the
    // vendor endpoint does no authorization of its own). Ledgered as
    // `server-only` in auth-route-ledger.ts; logic in
    // organization-add-member.ts.
    rawApp.post(`${basePath}/organization/add-member`, async (c: any) => {
      try {
        const actor = await gateAdmin(c);
        if (actor instanceof Response) return actor;
        const { runOrganizationAddMember } = await import('./organization-add-member.js');
        // [#4586] Same seam as create-user: the write is driven server-side
        // and never passes through `AuthManager.handleRequest`, so open the
        // attribution seam here — the `sys_member` row this creates is
        // credited to the admin instead of recorded as the system.
        const { status, body } = await runAttributedToUser(actor.id, () =>
          runOrganizationAddMember({ getAuthApi: () => this.authManager!.getApi() as any }, c.req.raw),
        );
        return c.json(body, status as any);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] organization/add-member failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // ADR-0069 P3 — register a SAML 2.0 IdP. Mirrors the OIDC bridge above:
    // the metadata `register_saml_provider` action posts FLAT fields; the shared
    // helper reshapes them into better-auth's nested `samlConfig` (deriving the
    // per-provider ACS URL) and re-dispatches through /sso/register so the
    // admin gate + provisioning all run. Returns SP ACS + metadata URLs.
    rawApp.post(`${basePath}/admin/sso/register-saml`, async (c: any) => {
      try {
        // #9653 — same ADR-0068 D4 platform-admin gate as /admin/sso/register
        // above, judged before the bridge delegates.
        const gated = await gateAdmin(c);
        if (gated instanceof Response) return gated;
        const { status, body } = await runRegisterSamlProviderFromForm(
          (req) => this.authManager!.handleRequest(req),
          c.req.raw,
        );
        return c.json(body, status as any);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] sso/register-saml bridge failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // SSO domain verification (ADR-0024 ②, opt-in OS_SSO_DOMAIN_VERIFICATION).
    // Re-dispatch through @better-auth/sso's /sso/{request-domain-verification,
    // verify-domain} (so the per-provider admin gate runs) and reshape into the
    // `{ success, data }` envelope the action `resultDialog` / toast reads:
    // request returns the ready-to-paste DNS TXT record, verify returns a clear
    // success/error. A 404 from the inner endpoint = feature OFF for this env.
    rawApp.post(`${basePath}/admin/sso/request-domain-verification`, async (c: any) => {
      try {
        // #9653 — same ADR-0068 D4 platform-admin gate as /admin/sso/register
        // above; the identity answer comes before the capability answer, so an
        // anonymous caller gets 401 even while OS_SSO_DOMAIN_VERIFICATION is off.
        const gated = await gateAdmin(c);
        if (gated instanceof Response) return gated;
        const { status, body } = await runRequestDomainVerification(
          (req) => this.authManager!.handleRequest(req),
          c.req.raw,
        );
        return c.json(body, status as any);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] sso/request-domain-verification bridge failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    rawApp.post(`${basePath}/admin/sso/verify-domain`, async (c: any) => {
      try {
        // #9653 — same ADR-0068 D4 platform-admin gate as /admin/sso/register.
        const gated = await gateAdmin(c);
        if (gated instanceof Response) return gated;
        const { status, body } = await runVerifyDomain(
          (req) => this.authManager!.handleRequest(req),
          c.req.raw,
        );
        return c.json(body, status as any);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] sso/verify-domain bridge failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // OAuth self-service: register an OAuth application for the signed-in
    // user. Thin wrapper over better-auth's `/oauth2/create-client`
    // endpoint (session-required, auto-stamps `user_id` from the session).
    //
    // Why this wrapper exists: the Account-app action surfaces a
    // user-friendly textarea for "Redirect URLs" (one per line), but
    // better-auth's Zod body schema requires `redirect_uris: string[]`.
    // The metadata-driven action runner POSTs param values verbatim, so
    // without a translation layer the upstream call fails validation with
    // `Invalid input: expected array, received string`. We split the
    // textarea on newlines, trim, drop empties, and forward to
    // `createOAuthClient` so the row gets persisted with the caller's
    // user_id and shows up in the `mine` listView.
    //
    // Upstream alternative would be enabling `allowDynamicClientRegistration`
    // on `/oauth2/register`, but DCR has additional security implications
    // (rate limiting, scope restriction) we don't want to enable broadly
    // just to fix UX. Keeping the wrapper scoped to the self-service flow.
    rawApp.post(`${basePath}/sys-oauth-application/register`, async (c: any) => {
      try {
        let body: any = {};
        try { body = await c.req.json(); } catch { body = {}; }

        const name: unknown = body?.name;
        const redirectUrlsInput: unknown = body?.redirectURLs;
        const type: unknown = body?.type;

        if (typeof name !== 'string' || name.trim().length === 0) {
          return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'name is required' } }, 400);
        }
        if (typeof redirectUrlsInput !== 'string' || redirectUrlsInput.trim().length === 0) {
          return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'redirectURLs is required' } }, 400);
        }

        const redirectUris = redirectUrlsInput
          .split(/[\r\n]+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        if (redirectUris.length === 0) {
          return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'redirectURLs must contain at least one URL' } }, 400);
        }

        const allowedTypes = new Set(['web', 'native', 'user-agent-based']);
        const safeType = typeof type === 'string' && allowedTypes.has(type) ? type : 'web';

        const authApi: any = await this.authManager!.getApi();
        if (!authApi?.createOAuthClient) {
          return c.json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'OIDC provider is not enabled on this environment' } }, 503);
        }

        // Forward request headers so better-auth can resolve the caller's
        // session (sessionMiddleware on /oauth2/create-client). Without
        // the session the row would lack `user_id` and never appear in
        // the My Applications view.
        let result: any;
        try {
          result = await authApi.createOAuthClient({
            body: {
              client_name: name.trim(),
              redirect_uris: redirectUris,
              type: safeType,
            },
            headers: c.req.raw.headers,
          });
        } catch (err: any) {
          const status = typeof err?.status === 'number' ? err.status : 500;
          // better-auth's `body.error` is an arbitrary upstream string, so it
          // cannot be `error.code` — that field is a closed set (ADR-0112) and
          // an unbounded source defeats it. Keep the code ours and carry the
          // upstream discriminator in `details` where it stays inspectable.
          const upstream = typeof err?.body?.error === 'string' ? err.body.error : undefined;
          const message = err?.body?.error_description ?? err?.message ?? 'Unable to register OAuth client';
          return c.json({
            success: false,
            error: {
              code: 'OAUTH_REGISTER_FAILED',
              message,
              ...(upstream ? { details: { upstreamError: upstream } } : {}),
            },
          }, status);
        }

        // Mirror the response shape consumed by the action's resultDialog
        // (`client.client_id`, `client.client_secret`).
        return c.json({ success: true, data: { client: result } });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] sys-oauth-application/register failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // Self-service resend of the email-verification link. SHADOWS better-auth's
    // native `/send-verification-email` (registered before the catch-all below).
    //
    // The stock route REQUIRES `{ email }` in the body, but the `sys_user`
    // `resend_verification_email` action — the record-header button, the
    // "email unverified" record alert, and the record-section quick action —
    // fires with an EMPTY body (no dialog, and the alert `action` reference
    // can't carry params). That bounced with `[body.email] ... received
    // undefined`, breaking every resend affordance. This wrapper defaults the
    // address to the caller's own session email when the body omits it, then
    // re-dispatches through the real route (via handleRequest, which bypasses
    // this wrapper — no recursion). An explicit `email` passes through
    // untouched, so the admin / verify-screen path is unchanged.
    rawApp.post(`${basePath}/send-verification-email`, async (c: any) => {
      try {
        const { status, body } = await runResendVerificationEmail(
          (req) => this.authManager!.handleRequest(req),
          c.req.raw,
        );
        return c.json(body, status);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] send-verification-email failed', err);
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
      }
    });

    // Register wildcard route to forward all auth requests to better-auth.
    // better-auth is configured with basePath matching our route prefix, so we
    // forward the original request directly — no path rewriting needed.
    //
    // [#4088] This catch-all owns the whole auth namespace, and it used to be
    // TERMINAL: it returned better-auth's response unconditionally, including
    // the 404 better-auth produces for a path it does not implement. Any OTHER
    // plugin's route under `${basePath}/*` was therefore reachable only if it
    // happened to register FIRST — Hono runs handlers matching a path in
    // registration order and the first to return a Response wins. That made a
    // load-bearing surface depend on `kernel.use()` order:
    // `plugin-hono-server` mounts `/auth/me/permissions` and
    // `/auth/me/localization` from its own `kernel:ready` hook, the console's
    // entire permission layer reads the former, and `core`'s auth gate
    // allow-lists the latter — all of it silently 404s if AuthPlugin is used
    // before HonoServerPlugin. Same class as #2567 and #4018: an invariant held
    // by ordering luck rather than enforced.
    //
    // So a 404 now means "better-auth does not own this path" and we yield to
    // whatever else matched, in either registration order. Deliberately narrow:
    // 401/403 are real better-auth answers, not disclaimers of ownership, and
    // when nothing downstream answers we return better-auth's own 404 verbatim
    // so the wire shape for a genuinely unclaimed auth path is unchanged.
    // Precedence still favours the namespace owner — better-auth wins every
    // path it implements, and only its leftovers are up for grabs.
    rawApp.all(`${basePath}/*`, async (c: any, next: any) => {
      try {
        // Forward the original request to better-auth handler
        const response = await this.authManager!.handleRequest(c.req.raw);

        if (response.status === 404) {
          await next();
          // A non-404 downstream means something else answered — hand that back.
          // NOT `c.finalized`: reaching the end of the chain with nothing
          // matched runs Hono's notFound handler, which sets a response and
          // flips `finalized` to true, so it cannot tell "someone answered"
          // from "nobody did". Status can. The one thing this trades away is a
          // downstream route's own 404 BODY (better-auth's 404 is returned in
          // its place); the status is identical either way, and no route under
          // this prefix answers 404 today — `/auth/me/*` answer 200 with an
          // `authenticated: false` payload for an anonymous caller.
          if (c.res && c.res.status !== 404) return;
          // Assign, don't `return`: the IP-gate `rawApp.use()` above puts a
          // middleware in this chain, and Hono's compose only assigns a
          // handler's returned Response while `c.finalized` is false. The
          // notFound above already flipped it, so a `return response` here is
          // silently dropped and the caller gets Hono's "404 Not Found" text
          // instead of better-auth's JSON. Setting `c.res` is not subject to
          // that condition.
          c.res = response;
          return;
        }

        // better-auth catches internal errors and returns error Responses
        // without throwing, so the catch block below would never trigger.
        // We proactively log server errors here for observability.
        if (response.status >= 500) {
          try {
            const body = await response.clone().text();
            ctx.logger.error('[AuthPlugin] better-auth returned server error', new Error(`HTTP ${response.status}: ${body}`));
          } catch {
            ctx.logger.error('[AuthPlugin] better-auth returned server error', new Error(`HTTP ${response.status}: (unable to read body)`));
          }
        }

        // Public-cache JWKS: it's static JSON that only changes when the
        // signing key rotates (default ~30 days). better-auth doesn't set
        // any Cache-Control header, so every relying party currently
        // re-fetches it on every JWT verification (≈700 ms warm against a
        // Container DO + Neon). Add a conservative public cache so CF's
        // edge can short-circuit repeated fetches. The 5-min freshness +
        // 24 h SWR window is well inside better-auth's default rotation
        // and matches what most IdPs publish (Auth0, Cognito, Google).
        try {
          const url = c.req.url as string;
          if (response.ok && /\/jwks(\?|$)/.test(url)) {
            const existing = response.headers.get('cache-control');
            if (!existing) {
              response.headers.set(
                'cache-control',
                'public, max-age=300, stale-while-revalidate=86400',
              );
            }
          }
        } catch { /* best-effort header annotation */ }

        return response;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('Auth request error:', err);
        
        // Return error response
        return new Response(
          JSON.stringify({
            success: false,
            error: err.message,
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    });

    // OIDC / OAuth 2.0 Authorization Server Metadata (RFC 8414) and
    // OpenID Connect Discovery 1.0 require the well-known documents to be
    // served from the **root** of the issuer URL — not under our auth
    // basePath. `@better-auth/oauth-provider` ships dedicated helpers for
    // this case (`oauthProviderAuthServerMetadata` /
    // `oauthProviderOpenIdConfigMetadata`) which we mount here so external
    // OIDC clients can discover the IdP at the canonical paths.
    //
    // Shared decision point with `AuthManager.buildPluginList()`
    // (`resolveOidcProviderEnabled`: env override → config → follows
    // OS_MCP_SERVER_ENABLED) — without this the discovery routes would not
    // mount when an operator flipped the env var on without editing the
    // config file, leaving external OIDC/MCP clients unable to discover
    // the authorization server.
    const oidcEnabled = resolveOidcProviderEnabled(this.options.plugins);
    if (oidcEnabled) {
      void this.registerOidcDiscoveryRoutes(rawApp, ctx).catch((error) => {
        ctx.logger.error('Failed to register OIDC discovery routes', error as Error);
      });
    }

    ctx.logger.info(`Auth routes registered: All requests under ${basePath}/* forwarded to better-auth`);
  }

  /**
   * Mount the OIDC / OAuth 2.0 well-known discovery documents at the root
   * URL. Required by RFC 8414 §3 and OpenID Connect Discovery 1.0 §4 — the
   * documents must live at `/.well-known/{oauth-authorization-server,openid-configuration}`
   * relative to the issuer, not under the auth basePath.
   */
  private async registerOidcDiscoveryRoutes(rawApp: any, ctx: PluginContext): Promise<void> {
    const auth = await this.authManager!.getAuthInstance();

    // The oauthProvider plugin may have been skipped by the optional-plugin
    // isolation in AuthManager.buildPluginList (a failing optional plugin no
    // longer fails the whole instance — the 15.1.0 lesson). Advertising
    // .well-known discovery documents for an IdP whose endpoints are not
    // mounted would send every external client into 404s, so skip the mounts
    // and say why. Core auth is already up at this point.
    const degradedOidc = this.authManager!
      .getDegradedAuthFeatures()
      .find((d) => d.feature === 'oidcProvider');
    if (degradedOidc) {
      ctx.logger.error(
        'OIDC provider is configured but its better-auth plugin failed to initialize; ' +
          'skipping /.well-known discovery mounts. External SSO/MCP clients cannot use this ' +
          `deployment as an IdP until the underlying error is fixed: ${degradedOidc.error}`,
      );
      return;
    }

    const { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } = await import(
      '@better-auth/oauth-provider'
    );

    const authServerHandler = oauthProviderAuthServerMetadata(auth as any);
    const openidConfigHandler = oauthProviderOpenIdConfigMetadata(auth as any);

    // Cache-Control for OIDC discovery docs. These describe stable issuer
    // configuration (endpoints, supported scopes, signing algs); they
    // change only on app redeploy. CF edge can short-circuit repeated
    // fetches and dramatically cut SSO first-call latency.
    const DISCOVERY_CACHE = 'public, max-age=300, stale-while-revalidate=86400';
    const withDiscoveryCache = async (handler: (req: Request) => Promise<Response> | Response, req: Request): Promise<Response> => {
      const resp = await handler(req);
      try {
        if (resp.ok && !resp.headers.get('cache-control')) {
          resp.headers.set('cache-control', DISCOVERY_CACHE);
        }
      } catch { /* best-effort */ }
      return resp;
    };

    rawApp.get('/.well-known/oauth-authorization-server', (c: any) => withDiscoveryCache(authServerHandler, c.req.raw));
    rawApp.get('/.well-known/openid-configuration', (c: any) => withDiscoveryCache(openidConfigHandler, c.req.raw));

    // RFC 8414 §3.1 path-insertion variant. Our issuer identifier carries a
    // path component (`<origin>/api/v1/auth`), so spec-conforming clients
    // (including every MCP client bootstrapping from protected-resource
    // metadata) request `/.well-known/oauth-authorization-server/api/v1/auth`
    // — alias it to the same document.
    const basePath = (this.options.basePath ?? '/api/v1/auth').replace(/\/$/, '');
    rawApp.get(`/.well-known/oauth-authorization-server${basePath}`, (c: any) =>
      withDiscoveryCache(authServerHandler, c.req.raw),
    );

    // ── MCP protected-resource metadata (RFC 9728, #2698) ──────────────
    // `/api/v1/mcp` is an OAuth 2.1 protected resource; its metadata points
    // clients at THIS deployment's embedded authorization server. Mounted
    // only when the MCP OAuth track is live (MCP surface on + AS on + TLS
    // rule satisfied — loopback exempt): when it is off, nothing is
    // advertised and the endpoint stays API-key-only, fail-closed.
    const manager = this.authManager!;
    if (readMcpServerEnabledEnv() && typeof manager.isMcpOAuthEnabled === 'function') {
      if (manager.isMcpOAuthEnabled()) {
        const prmHandler = () => {
          const body = JSON.stringify(manager.getMcpProtectedResourceMetadata());
          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json', 'cache-control': DISCOVERY_CACHE },
          });
        };
        const mcpPath = new URL(manager.getMcpResourceUrl()).pathname; // e.g. /api/v1/mcp
        rawApp.get('/.well-known/oauth-protected-resource', prmHandler);
        // RFC 9728 §3.1 path-insertion variant for the resource's own path.
        rawApp.get(`/.well-known/oauth-protected-resource${mcpPath}`, prmHandler);
        ctx.logger.info(
          `MCP protected-resource metadata mounted at /.well-known/oauth-protected-resource (resource: ${mcpPath})`,
        );
      } else {
        ctx.logger.warn(
          'MCP server is enabled but the OAuth track is NOT live (base URL fails the OAuth 2.1 TLS rule — ' +
            'https required, loopback exempt). /api/v1/mcp stays API-key-only; no OAuth metadata is advertised.',
        );
      }
    }

    ctx.logger.info(
      'OIDC discovery endpoints mounted at /.well-known/{oauth-authorization-server,openid-configuration}',
    );
  }
}
