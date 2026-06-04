// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
import type { BetterAuthOptions } from 'better-auth';
import { AuthConfig, SystemObjectName, SystemUserId } from '@objectstack/spec/system';
import {
  SETUP_APP,
  SETUP_NAV_CONTRIBUTIONS,
  STUDIO_APP,
  ACCOUNT_APP,
  SystemOverviewDashboard,
} from '@objectstack/platform-objects/apps';
import { SysOrganizationDetailPage, SysUserDetailPage } from '@objectstack/platform-objects/pages';
import { AuthManager } from './auth-manager.js';
import { runSetInitialPassword } from './set-initial-password.js';
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

  constructor(options: AuthPluginOptions = {}) {
    this.options = {
      registerRoutes: true,
      basePath: '/api/v1/auth',
      ...options
    };
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

    // Initialize auth manager with data engine
    this.authManager = new AuthManager({
      ...this.options,
      dataEngine,
    });

    // Register auth service
    ctx.registerService('auth', this.authManager);

    ctx.getService<{ register(m: any): void }>('manifest').register({
      ...authPluginManifestHeader,
      ...(this.options.manifestDatasource
        ? { defaultDatasource: this.options.manifestDatasource }
        : {}),
      objects: authIdentityObjects,
      // The platform Setup App is a static metadata artifact (lives in
      // @objectstack/platform-objects/apps). plugin-auth is the natural
      // owner of its registration since it loads first among the trio
      // (auth + security + audit) that supplies the underlying objects.
      apps: [SETUP_APP, STUDIO_APP, ACCOUNT_APP],
      // ADR-0029 D7 — the Setup App is a shell of group anchors; its entries
      // for platform-objects-owned objects are contributed here. Capability
      // plugins (e.g. plugin-webhooks) contribute their own slots' entries.
      navigationContributions: SETUP_NAV_CONTRIBUTIONS,
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
          try {
            const emailSvc = ctx.getService<any>('email');
            if (emailSvc) {
              this.authManager.setEmailService(emailSvc);
              ctx.logger.info('Auth: email service wired (transactional mail enabled)');
            }
          } catch {
            ctx.logger.info('Auth: no email service registered — auth callbacks will log instead of sending');
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

    // Register /config before the wildcard so it takes precedence.
    // better-auth has no /config endpoint, so without this explicit route
    // the wildcard below forwards the request and better-auth returns 404.
    rawApp.get(`${basePath}/config`, (c: any) => {
      try {
        const config = this.authManager!.getPublicConfig();
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


