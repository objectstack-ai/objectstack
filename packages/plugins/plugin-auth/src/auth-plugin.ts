// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
import type { BetterAuthOptions } from 'better-auth';
import { AuthConfig, type SocialProviderConfig, SystemObjectName, SystemUserId } from '@objectstack/spec/system';
import {
  // ADR-0048 — the Setup/Studio/Account apps moved to their own packages
  // (@objectstack/{setup,studio,account}); plugin-auth no longer registers them.
  SystemOverviewDashboard,
  SystemOverviewDatasets,
} from '@objectstack/platform-objects/apps';
import { SysOrganizationDetailPage, SysUserDetailPage } from '@objectstack/platform-objects/pages';
import { AuthManager, type AuthManagerOptions } from './auth-manager.js';
import { runSetInitialPassword } from './set-initial-password.js';
import { runRegisterSsoProviderFromForm } from './register-sso-provider.js';
import {
  authIdentityObjects,
  authPluginManifestHeader,
} from './manifest.js';

/**
 * Auth Plugin Options
 * Extends AuthConfig from spec with additional runtime options
 */
export interface AuthPluginOptions extends Partial<AuthConfig> {
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
   * Application-specific organization roles to register with Better-Auth's
   * organization plugin so invitations to those roles aren't rejected with
   * ROLE_NOT_FOUND. Forwarded as-is to AuthManager. See
   * {@link AuthManagerOptions.additionalOrgRoles} for details.
   */
  additionalOrgRoles?: string[];

  /**
   * Pass-through to better-auth's `databaseHooks` option. Used by
   * platform consumers (objectos kernel) to attach a
   * `user.create.after` hook that auto-provisions a personal
   * organization for JIT-created SSO users — better-auth's adapter
   * bypasses kernel-level ObjectQL middleware, so this is the only
   * hook point that fires for every user creation path (email signup,
   * social/OIDC sign-in, admin-created accounts).
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
  type = 'standard';
  version = '1.0.0';
  dependencies: string[] = ['com.objectstack.engine.objectql']; // manifest service required
  
  private options: AuthPluginOptions;
  private authManager: AuthManager | null = null;
  private configuredSocialProviders: SocialProviderConfig | undefined;

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

  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing Auth Plugin...');

    // Validate required configuration
    if (!this.options.secret) {
      throw new Error('AuthPlugin: secret is required');
    }

    // Get data engine service for database operations
    const dataEngine = ctx.getService<any>('data');
    if (!dataEngine) {
      ctx.logger.warn('No data engine service found - auth will use in-memory storage');
    }

    const authConfig: AuthManagerOptions & AuthPluginOptions = {
      ...this.options,
      dataEngine,
    };
    this.applyEnvSocialProviderFallbacks(authConfig);

    // Open extension point for packages that contribute auth providers
    // (enterprise SSO, hosted control-plane SSO, etc.) without forking
    // framework's AuthPlugin. Handlers mutate the draft config in place.
    await ctx.trigger('auth:configure', authConfig, ctx);
    this.configuredSocialProviders = authConfig.socialProviders
      ? { ...authConfig.socialProviders }
      : undefined;

    // Initialize auth manager with data engine
    this.authManager = new AuthManager(authConfig);

    // Register auth service
    ctx.registerService('auth', this.authManager);

    ctx.getService<{ register(m: any): void }>('manifest').register({
      ...authPluginManifestHeader,
      ...(this.options.manifestDatasource
        ? { defaultDatasource: this.options.manifestDatasource }
        : {}),
      objects: authIdentityObjects,
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

    ctx.logger.info('Auth Plugin initialized successfully');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Starting Auth Plugin...');

    if (!this.authManager) {
      throw new Error('Auth manager not initialized');
    }

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
          await this.bindAuthSettings(ctx);

          let emailSvc: any;
          try { emailSvc = ctx.getService<any>('email'); } catch { emailSvc = undefined; }
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

          // Bind the email brand name (`{{appName}}`) to the live
          // `branding.workspace_name` setting so the admin UI can rename the
          // product without a redeploy. Only an *explicitly set* value
          // overrides the configured `appName` — when the operator hasn't
          // customised it (resolver returns the manifest default), we clear
          // the override so the deployment's `appName` (e.g. `OS_APP_NAME`)
          // keeps precedence. Mirrors EmailServicePlugin's settings binding.
          try {
            const settings = ctx.getService<any>('settings');
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
            }
          } catch {
            // settings service is optional — keep the configured appName.
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
        const engine: any = ctx.getService<any>('objectql');
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

    // Register auth middleware on ObjectQL engine (if available)
    try {
      const ql = ctx.getService<any>('objectql');
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
   * Bind the small open-source auth settings namespace to better-auth config.
   *
   * Only explicit settings values (stored or OS_AUTH_* env overrides) affect
   * runtime config. Manifest defaults are UI defaults and do not mask code or
   * deployment configuration.
   */
  private async bindAuthSettings(ctx: PluginContext): Promise<void> {
    if (!this.authManager) return;

    let settings: any;
    try {
      settings = ctx.getService<any>('settings');
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

    let ql: any;
    try { ql = ctx.getService<any>('objectql'); } catch { /* unavailable */ }
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
        return c.json({ success: false, error: { code: 'auth_config_error', message: err.message } }, 500);
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
        return c.json({ success: false, error: { code: 'internal', message: err.message } }, 500);
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
          return c.json({ success: false, error: { code: 'invalid_request', message: 'client_id is required' } }, 400);
        }
        if (typeof disabled !== 'boolean') {
          return c.json({ success: false, error: { code: 'invalid_request', message: 'disabled must be a boolean' } }, 400);
        }

        const authApi = await this.authManager!.getApi();
        const session = await authApi.getSession({ headers: c.req.raw.headers });
        if (!session?.user?.id) {
          return c.json({ success: false, error: { code: 'unauthorized', message: 'Sign in first' } }, 401);
        }
        // The customSession plugin synthesizes `user.role = 'admin'` for
        // platform admins (admin_full_access permission set) and active-org
        // owners/admins; anyone else is denied.
        if ((session.user as any).role !== 'admin') {
          return c.json({ success: false, error: { code: 'forbidden', message: 'Admin role required' } }, 403);
        }

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
          return c.json({ success: false, error: { code: 'unavailable', message: 'Data engine unavailable' } }, 503);
        }

        const existing = await dataEngine.findOne('sys_oauth_application', {
          where: { client_id: clientId },
        });
        if (!existing) {
          return c.json({ success: false, error: { code: 'not_found', message: 'OAuth client not found' } }, 404);
        }

        const updated = await dataEngine.update('sys_oauth_application', {
          id: existing.id,
          disabled,
          updated_at: new Date(Math.floor(Date.now() / 1000) * 1000),
        });
        if (!updated) {
          return c.json({ success: false, error: { code: 'internal', message: 'Unable to update OAuth client' } }, 500);
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
        return c.json({ success: false, error: { code: 'internal', message: err.message } }, 500);
      }
    });

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
    // (via the better-auth handler) so the admin gate, the public-routable
    // trustedOrigins allowance, discovery hydration, and secret handling all
    // still run. No bespoke persistence. Retire when the action framework
    // gains nested-param support.
    rawApp.post(`${basePath}/admin/sso/register`, async (c: any) => {
      try {
        const { status, body } = await runRegisterSsoProviderFromForm(
          (req) => this.authManager!.handleRequest(req),
          c.req.raw,
        );
        return c.json(body, status as any);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] sso/register bridge failed', err);
        return c.json({ success: false, error: { code: 'internal', message: err.message } }, 500);
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
          return c.json({ success: false, error: { code: 'invalid_request', message: 'userId is required' } }, 400);
        }

        const authApi = await this.authManager!.getApi();
        const session = await authApi.getSession({ headers: c.req.raw.headers });
        if (!session?.user?.id) {
          return c.json({ success: false, error: { code: 'unauthorized', message: 'Sign in first' } }, 401);
        }
        // Platform-admin gate. Accept any of the equivalent signals the
        // customSession plugin may carry (ADR-0068): the derived
        // `isPlatformAdmin` alias, the canonical `platform_admin` in roles[],
        // or the legacy admin-plugin `role` scalar.
        const u: any = session.user;
        const isAdmin =
          u?.isPlatformAdmin === true ||
          (Array.isArray(u?.roles) && u.roles.includes('platform_admin')) ||
          u?.role === 'admin';
        if (!isAdmin) {
          return c.json({ success: false, error: { code: 'forbidden', message: 'Admin role required' } }, 403);
        }

        const ok = await this.authManager!.unlockUser(userId);
        if (!ok) {
          return c.json({ success: false, error: { code: 'not_found', message: 'User not found or data engine unavailable' } }, 404);
        }
        return c.json({ success: true, data: { userId } });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] unlock-user failed', err);
        return c.json({ success: false, error: { code: 'internal', message: err.message } }, 500);
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
          return c.json({ success: false, error: { code: 'invalid_request', message: 'name is required' } }, 400);
        }
        if (typeof redirectUrlsInput !== 'string' || redirectUrlsInput.trim().length === 0) {
          return c.json({ success: false, error: { code: 'invalid_request', message: 'redirectURLs is required' } }, 400);
        }

        const redirectUris = redirectUrlsInput
          .split(/[\r\n]+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        if (redirectUris.length === 0) {
          return c.json({ success: false, error: { code: 'invalid_request', message: 'redirectURLs must contain at least one URL' } }, 400);
        }

        const allowedTypes = new Set(['web', 'native', 'user-agent-based']);
        const safeType = typeof type === 'string' && allowedTypes.has(type) ? type : 'web';

        const authApi: any = await this.authManager!.getApi();
        if (!authApi?.createOAuthClient) {
          return c.json({ success: false, error: { code: 'unavailable', message: 'OIDC provider is not enabled on this environment' } }, 503);
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
          const code = err?.body?.error ?? 'oauth_register_failed';
          const message = err?.body?.error_description ?? err?.message ?? 'Unable to register OAuth client';
          return c.json({ success: false, error: { code, message } }, status);
        }

        // Mirror the response shape consumed by the action's resultDialog
        // (`client.client_id`, `client.client_secret`).
        return c.json({ success: true, data: { client: result } });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        ctx.logger.error('[AuthPlugin] sys-oauth-application/register failed', err);
        return c.json({ success: false, error: { code: 'internal', message: err.message } }, 500);
      }
    });

    // Register wildcard route to forward all auth requests to better-auth.
    // better-auth is configured with basePath matching our route prefix, so we
    // forward the original request directly — no path rewriting needed.
    rawApp.all(`${basePath}/*`, async (c: any) => {
      try {
        // Forward the original request to better-auth handler
        const response = await this.authManager!.handleRequest(c.req.raw);

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
    // Honour the same `OS_OIDC_PROVIDER_ENABLED` env-var override that
    // `AuthManager.buildPlugins()` uses — without this check the
    // discovery routes would NOT mount when an operator flipped the
    // env var on without editing the config file, leaving external
    // OIDC clients unable to discover the IdP.
    const oidcEnv = (globalThis as any)?.process?.env?.OS_OIDC_PROVIDER_ENABLED;
    const oidcFromEnv = oidcEnv != null ? String(oidcEnv).toLowerCase() === 'true' : undefined;
    const oidcEnabled = oidcFromEnv ?? this.options.plugins?.oidcProvider ?? false;
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

    ctx.logger.info(
      'OIDC discovery endpoints mounted at /.well-known/{oauth-authorization-server,openid-configuration}',
    );
  }
}
