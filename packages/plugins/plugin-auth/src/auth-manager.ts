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
import type { IEmailService } from '@objectstack/spec/contracts';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';
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
} from './auth-schema-config.js';

/**
 * Extended options for AuthManager
 */
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
   * Application-specific organization roles to register with Better-Auth's
   * organization plugin. Each name becomes a valid role for invitations and
   * member assignments without going through Better-Auth's default
   * `owner|admin|member` whitelist.
   *
   * The ObjectStack SecurityPlugin handles real RBAC enforcement by matching
   * these role names against `permission` metadata (PermissionSets / Profiles),
   * so Better-Auth only needs to accept them as opaque strings. Each role is
   * registered with the minimum access-control privileges (equivalent to
   * Better-Auth's `member` role) so it cannot inadvertently grant org-level
   * admin capabilities.
   *
   * Typical source: the union of `permission` metadata names that have
   * `isProfile: true`, collected from the loaded stack at CLI boot.
   *
   * @example ['sales_rep', 'sales_manager', 'service_agent']
   */
  additionalOrgRoles?: string[];

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
   * Display name used by built-in auth email templates (`{{appName}}`
   * placeholder). Defaults to `'ObjectStack'` when omitted.
   */
  appName?: string;

  /**
   * Pass-through to better-auth's `databaseHooks` option. better-auth fires
   * these around its own adapter writes (e.g. when `genericOAuth` creates
   * a JIT user during SSO login), which the kernel-level ObjectQL
   * middleware does NOT observe — better-auth's adapter goes through
   * `dataEngine` directly, bypassing the `ql.registerMiddleware` chain.
   *
   * The platform uses this to attach a `user.create.after` hook that
   * auto-provisions a personal organization for every newly-created user
   * (mirroring what SecurityPlugin's middleware does for direct
   * ObjectQL inserts) so SSO-arriving users don't land on the empty
   * "create organization" screen.
   */
  databaseHooks?: BetterAuthOptions['databaseHooks'];
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
export class AuthManager {
  private auth: Auth<any> | null = null;
  private config: AuthManagerOptions;

  constructor(config: AuthManagerOptions) {
    this.config = config;

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
    const plugins = await this.buildPluginList();
    const passwordHasher = await this.resolvePasswordHasher();
    const betterAuthConfig: BetterAuthOptions = {
      // Base configuration
      secret: this.config.secret || this.generateSecret(),
      baseURL: this.config.baseUrl || 'http://localhost:3000',
      basePath: this.config.basePath || '/api/v1/auth',

      // Database adapter configuration
      database: this.createDatabaseConfig(),

      // Model/field mapping: camelCase (better-auth) → snake_case (ObjectStack)
      // These declarations tell better-auth the actual table/column names used
      // by ObjectStack's protocol layer, enabling automatic transformation via
      // createAdapterFactory.
      user: {
        ...AUTH_USER_CONFIG,
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

      // Email and password configuration
      emailAndPassword: {
        enabled: this.config.emailAndPassword?.enabled ?? true,
        ...(passwordHasher ? { password: passwordHasher } : {}),
        ...(this.config.emailAndPassword?.disableSignUp != null
          ? { disableSignUp: this.config.emailAndPassword.disableSignUp } : {}),
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
          const email = this.getEmailService();
          if (!email) {
            console.warn(
              `[AuthManager] Password-reset requested for ${user.email} but no email service is wired. URL: ${url}`,
            );
            return;
          }
          const ttlSec = this.config.emailAndPassword?.resetPasswordTokenExpiresIn ?? 60 * 60;
          try {
            await email.sendTemplate({
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
          } catch (err: any) {
            console.error(`[AuthManager] sendResetPassword failed: ${err?.message ?? err}`);
            throw err;
          }
        },
      },

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
              console.warn(
                `[AuthManager] Verification email requested for ${user.email} but no email service is wired. URL: ${url}`,
              );
              return;
            }
            const ttlSec = this.config.emailVerification?.expiresIn ?? 60 * 60;
            try {
              await email.sendTemplate({
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
            } catch (err: any) {
              console.error(`[AuthManager] sendVerificationEmail failed: ${err?.message ?? err}`);
              throw err;
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

      // better-auth plugins — registered based on AuthPluginConfig flags
      plugins,

      // Database hooks (fired by better-auth's adapter writes — these run
      // for SSO JIT-provisioning too, unlike kernel-level ObjectQL
      // middleware which better-auth's adapter bypasses).
      ...(this.config.databaseHooks ? { databaseHooks: this.config.databaseHooks } : {}),

      // Trusted origins for CSRF protection (supports wildcards like "https://*.example.com")
      // Auto-includes origins from CORS_ORIGIN env var so CORS and CSRF stay in sync.
      ...(() => {
        const origins: string[] = [...(this.config.trustedOrigins || [])];
        // Sync with CORS_ORIGIN env var (comma-separated)
        const corsOrigin = process.env.CORS_ORIGIN;
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
    const isWebContainer =
      typeof globalThis !== 'undefined' &&
      (Boolean((globalThis as any).process?.versions?.webcontainer) ||
        Boolean((globalThis as any).process?.env?.SHELL?.includes?.('jsh')) ||
        Boolean((globalThis as any).process?.env?.STACKBLITZ));
    if (!isWebContainer) return undefined;
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
   * Build the list of better-auth plugins based on AuthPluginConfig flags.
   *
   * Each plugin that introduces its own database tables is configured with
   * a `schema` option containing the appropriate snake_case field mappings,
   * so that `createAdapterFactory` transforms them automatically.
   */
  private async buildPluginList(): Promise<any[]> {
    const pluginConfig: Partial<AuthPluginConfig> = this.config.plugins ?? {};
    const plugins: any[] = [];

    // Defaults — kept in sync with `AuthPluginConfigSchema` in
    // @objectstack/spec/system/auth-config.zod.ts. The frontend AuthProvider
    // (in @object-ui/app-shell) calls `/api/v1/auth/organization/list` on
    // every load; making the org plugin opt-out (default true) avoids
    // 404s and the noisy "Failed to load organizations" warning.
    const enabled = {
      organization: pluginConfig.organization ?? true,
      twoFactor: pluginConfig.twoFactor ?? false,
      passkeys: pluginConfig.passkeys ?? false,
      magicLink: pluginConfig.magicLink ?? false,
      oidcProvider: pluginConfig.oidcProvider ?? false,
      deviceAuthorization: pluginConfig.deviceAuthorization ?? false,
      admin: pluginConfig.admin ?? false,
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
      const { organization } = await import('better-auth/plugins/organization');
      // Build a `roles` map that registers each app-supplied org role
      // (e.g. CRM's sales_rep, sales_manager) as a valid Better-Auth role
      // so invitations to those roles aren't rejected with ROLE_NOT_FOUND.
      // Real RBAC enforcement is handled by ObjectStack's SecurityPlugin,
      // which matches the role name against `permission` metadata
      // (PermissionSets). Here we register them with minimum org-plugin
      // capabilities (same as the built-in `member` role) so they cannot
      // inadvertently grant org-level admin powers.
      let customOrgRoles: Record<string, any> | undefined;
      const extra = this.config.additionalOrgRoles;
      if (extra && extra.length > 0) {
        try {
          const accessMod = await import('better-auth/plugins/organization/access');
          const { defaultAc, memberAc, defaultRoles: importedDefaultRoles } = accessMod as any;
          // Better-Auth's `hasPermission` does `{...options.roles || defaultRoles}`
          // (precedence: `||` then spread). When we pass our own `roles`, the
          // built-in owner/admin/member are silently dropped, so even the org
          // owner loses `invitation:create` and every mutation 403s. We must
          // re-include the defaults alongside our extras.
          const defaultRoles = importedDefaultRoles || null;
          if (defaultAc && memberAc && typeof memberAc.statements === 'object') {
            const built: Record<string, any> = defaultRoles ? { ...defaultRoles } : {};
            const stmts = memberAc.statements;
            for (const name of extra) {
              if (!name) continue;
              if (built[name]) continue;
              built[name] = defaultAc.newRole(stmts);
            }
            customOrgRoles = built;
          }
        } catch {
          customOrgRoles = undefined;
        }
      }
      plugins.push(organization({
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
          const baseUrl = (this.config.baseUrl ?? '').replace(/\/$/, '');
          const acceptUrl = `${baseUrl}/accept-invitation/${invitation.id}`;
          const emailService = this.getEmailService();
          if (!emailService) {
            console.warn(
              `[AuthManager] Invitation email not configured. ` +
              `To: ${recipientEmail} (org: ${org?.name ?? invitation.organizationId}, ` +
              `role: ${invitation.role}, inviter: ${inviter?.user?.email ?? 'unknown'}) ` +
              `URL: ${acceptUrl}`,
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
            console.error(`[AuthManager] sendInvitationEmail failed: ${err?.message ?? err}`);
            throw err;
          }
        },
      }));
    }

    if (enabled.twoFactor) {
      const { twoFactor } = await import('better-auth/plugins/two-factor');
      plugins.push(twoFactor({
        schema: buildTwoFactorPluginSchema(),
      }));
    }

    if (enabled.admin) {
      const { admin } = await import('better-auth/plugins/admin');
      // Platform admin: ban/unban, set-password, impersonate, set-role.
      // Schema mapping ensures the plugin's added user/session columns
      // match ObjectStack's snake_case conventions (ban_reason,
      // ban_expires, impersonated_by). `role` and `banned` are already
      // snake_case-compatible.
      plugins.push(admin({
        schema: buildAdminPluginSchema(),
      }));
    }

    if (enabled.magicLink) {
      const { magicLink } = await import('better-auth/plugins/magic-link');
      // magic-link reuses the `verification` table — no extra schema mapping needed.
      plugins.push(magicLink({
        sendMagicLink: async ({ email: recipientEmail, url, token }) => {
          const emailService = this.getEmailService();
          if (!emailService) {
            console.warn(
              `[AuthManager] Magic-link requested for ${recipientEmail} but no email service is wired. URL: ${url}`,
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
      }));
    }

    // OIDC / Generic OAuth2 providers (enterprise SSO via genericOAuth plugin)
    if (this.config.oidcProviders?.length) {
      const { genericOAuth } = await import('better-auth/plugins/generic-oauth');
      plugins.push(genericOAuth({
        config: this.config.oidcProviders.map(p => ({
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
      }));
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
      // The new @better-auth/oauth-provider package requires the `jwt`
      // plugin (used to sign id_tokens / JWT access tokens). Register it
      // automatically — it is otherwise an internal implementation detail
      // and forcing every consumer to opt in would be poor DX.
      const { jwt } = await import('better-auth/plugins');
      plugins.push(jwt({ schema: buildJwtPluginSchema() }));

      const { oauthProvider } = await import('@better-auth/oauth-provider');
      const baseUrl = (this.config.baseUrl ?? '').replace(/\/$/, '');
      plugins.push(oauthProvider({
        // Account SPA renders both pages — see apps/account.
        loginPage: `${baseUrl}/_account/login`,
        consentPage: `${baseUrl}/_account/oauth/consent`,
        schema: buildOauthProviderPluginSchema(),
      }));
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
      const { deviceAuthorization } = await import('better-auth/plugins/device-authorization');
      const baseUrl = (this.config.baseUrl ?? '').replace(/\/$/, '');
      plugins.push(deviceAuthorization({
        verificationUri: `${baseUrl}/_account/auth/device`,
        schema: buildDeviceAuthorizationPluginSchema(),
      }));
    }

    // customSession() — augments the session payload with a derived `role`
    // field so frontend gating (e.g. AppShell's `isAdmin = user.role === 'admin'`)
    // works without each consumer having to re-query permission sets.
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
    // Either path synthesizes `user.role = 'admin'` so the frontend can gate
    // metadata-edit affordances uniformly. The raw membership role remains
    // available via the `organization` plugin's `member` payload for
    // finer-grained checks.
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

        const isActiveOrgAdmin = async (): Promise<boolean> => {
          try {
            const orgId = (session as any)?.activeOrganizationId;
            if (!orgId) return false;
            const members = await dataEngine.find('sys_member', {
              where: { user_id: user.id, organization_id: orgId },
              limit: 5,
            });
            return (Array.isArray(members) ? members : []).some((m: any) => {
              // better-auth org plugin stores roles as either a single string
              // or a comma-separated list (e.g. `"owner,admin"`). Treat any
              // membership that includes `owner` or `admin` as administrative.
              const raw = typeof m?.role === 'string' ? m.role : '';
              const roles = raw.split(',').map((s: string) => s.trim().toLowerCase());
              return roles.includes('owner') || roles.includes('admin');
            });
          } catch {
            return false;
          }
        };

        const promote = (await isPlatformAdmin()) || (await isActiveOrgAdmin());
        if (!promote) return { user, session };
        return { user: { ...user, role: 'admin' }, session };
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
    const envSecret = process.env.AUTH_SECRET;

    if (!envSecret) {
      // In production, a secret MUST be provided
      // For development/testing, we'll use a fallback but warn about it
      const fallbackSecret = 'dev-secret-' + Date.now();

      console.warn(
        '⚠️  WARNING: No AUTH_SECRET environment variable set! ' +
        'Using a temporary development secret. ' +
        'This is NOT secure for production use. ' +
        'Please set AUTH_SECRET in your environment variables.'
      );

      return fallbackSecret;
    }

    return envSecret;
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

  /** @internal `{{appName}}` placeholder value for built-in templates. */
  private getAppName(): string {
    return this.config.appName ?? 'ObjectStack';
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
    const auth = await this.getOrCreateAuth();
    const response = await auth.handler(request);

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
   * Get the better-auth API for programmatic access
   * Use this for server-side operations (e.g., creating users, checking sessions)
   */
  async getApi(): Promise<Auth<any>['api']> {
    const auth = await this.getOrCreateAuth();
    return auth.api;
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

    // Extract email/password config (safe fields only)
    const emailPasswordConfig: Partial<EmailAndPasswordConfig> = this.config.emailAndPassword ?? {};
    const emailPassword = {
      enabled: emailPasswordConfig.enabled !== false, // Default to true
      disableSignUp: emailPasswordConfig.disableSignUp ?? false,
      requireEmailVerification: emailPasswordConfig.requireEmailVerification ?? false,
    };

    // Extract enabled features
    const pluginConfig: Partial<AuthPluginConfig> = this.config.plugins ?? {};
    const features = {
      twoFactor: pluginConfig.twoFactor ?? false,
      passkeys: pluginConfig.passkeys ?? false,
      magicLink: pluginConfig.magicLink ?? false,
      organization: pluginConfig.organization ?? true,
      oidcProvider: pluginConfig.oidcProvider ?? false,
      deviceAuthorization: pluginConfig.deviceAuthorization ?? false,
    };

    return {
      emailPassword,
      socialProviders,
      features,
    };
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
