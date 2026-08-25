// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Better-Auth Configuration Protocol
 * 
 * Defines the configuration required to initialize the Better-Auth kernel.
 * Used in server-side configuration injection.
 */

import { lazySchema } from '../shared/lazy-schema';
export const AuthProviderConfigSchema = lazySchema(() => z.object({
  id: z.string().describe('Provider ID (github, google)'),
  clientId: z.string().describe('OAuth Client ID'),
  clientSecret: z.string().describe('OAuth Client Secret'),
  scope: z.array(z.string()).optional().describe('Requested permissions'),
}));

export const AuthPluginConfigSchema = lazySchema(() => z.object({
  organization: z.boolean().default(true).describe('Enable Organization/Teams support (frontend AuthProvider expects this enabled)'),
  twoFactor: z.boolean().default(false).describe('Enable 2FA'),
  passkeys: z.boolean().default(false).describe('Enable Passkey support'),
  passwordRejectBreached: z.boolean().default(false).describe(
    "Reject passwords found in the Have I Been Pwned breach corpus (enables better-auth's haveibeenpwned plugin)",
  ),
  magicLink: z.boolean().default(false).describe('Enable Magic Link login'),
  /**
   * Enable better-auth's `oidc-provider` plugin so that ObjectStack itself
   * acts as an OpenID Connect Identity Provider for downstream applications.
   *
   * When enabled, the server exposes the standard OIDC endpoints under the
   * configured auth route (e.g. `/api/v1/auth/.well-known/openid-configuration`,
   * `/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo`,
   * `/oauth2/register`, `/oauth2/consent`, `/oauth2/endsession`). Four
   * data-plane tables (`sys_oauth_application`, `sys_oauth_access_token`,
   * `sys_oauth_refresh_token`, `sys_oauth_consent`) back the registered
   * OAuth clients, issued tokens, and recorded user consents.
   *
   * Backed by `@better-auth/oauth-provider` (the standalone replacement for
   * the deprecated `better-auth/plugins/oidc-provider` plugin).
   */
  oidcProvider: z.boolean().default(false).describe(
    'Enable the OpenID Connect provider plugin (acts as an OIDC IdP)',
  ),
  /**
   * Allow OAuth 2.0 Dynamic Client Registration (RFC 7591) against the
   * embedded authorization server (`POST /oauth2/register`, unauthenticated).
   *
   * DCR is what lets a *generic* MCP client (claude.ai custom connectors,
   * Claude Desktop, Claude Code) connect self-serve to ANY deployment: since
   * every deployment is its own authorization server, clients cannot ship
   * pre-registered client IDs — they must be able to register themselves.
   *
   * Tri-state on purpose: when left UNSET it follows the MCP server surface
   * (`OS_MCP_SERVER_ENABLED`) — on when MCP is on, off otherwise. Set it (or
   * the `OS_OIDC_DCR_ENABLED` env var, which wins) to force either way.
   */
  dynamicClientRegistration: z.boolean().optional().describe(
    'Allow unauthenticated RFC 7591 Dynamic Client Registration (default: follows OS_MCP_SERVER_ENABLED)',
  ),
  /**
   * Enable better-auth's `device-authorization` plugin so that CLIs and
   * other input-constrained devices can sign in via the standard
   * RFC 8628 OAuth 2.0 Device Authorization Grant.
   *
   * Endpoints exposed under the auth route:
   *   - `POST /device/code`     — request device & user codes
   *   - `POST /device/token`    — poll for the issued session token
   *   - `GET  /device`          — verify a user code (status check)
   *   - `POST /device/approve`  — browser-side approve (signed-in user)
   *   - `POST /device/deny`     — browser-side deny (signed-in user)
   *
   * Persists pending requests in the `sys_device_code` table.
   */
  deviceAuthorization: z.boolean().default(false).describe(
    'Enable RFC 8628 Device Authorization Grant (CLI / TV-style login)',
  ),
  /**
   * Enable better-auth's `admin` plugin so platform admins can ban / unban
   * users, set their password (out-of-band recovery), impersonate them for
   * support sessions, and assign global platform roles.
   *
   * Endpoints exposed under the auth route:
   *   - `POST /admin/ban-user` / `POST /admin/unban-user`
   *   - `POST /admin/set-user-password`
   *   - `POST /admin/impersonate-user` / `POST /admin/stop-impersonating`
   *   - `POST /admin/set-role`
   *   - `POST /admin/create-user` / `POST /admin/remove-user`
   *   - `POST /admin/list-users` / `POST /admin/list-user-sessions`
   *   - `POST /admin/revoke-user-session(s)`
   *
   * The plugin augments `sys_user` with `role`, `banned`, `ban_reason`,
   * `ban_expires` and `sys_session` with `impersonated_by`. These columns
   * are mapped to snake_case by `buildAdminPluginSchema()`.
   *
   * Only callers whose user has a platform admin role (default: `admin`)
   * can hit these endpoints; better-auth enforces this internally.
   */
  admin: z.boolean().default(false).describe(
    'Enable platform admin operations (ban/unban, set-password, impersonate, set-role)',
  ),
  /**
   * Enable better-auth's `phone-number` plugin so a phone number is a
   * first-class sign-in identifier (#2766 V1.5). The phone+password surface
   * (`POST /sign-in/phone-number`) always works; the OTP flows
   * (`/phone-number/send-otp` + `/verify` for sign-in/verification,
   * `/phone-number/request-password-reset` + `/reset-password` for
   * self-service reset) additionally require a configured SMS delivery
   * service (`@objectstack/service-sms`, #2780) and stay loudly NOT_SUPPORTED
   * without one. Employees without an email address are created with a
   * generated placeholder address (never a real recipient — see
   * placeholder-email.ts) and sign in with phone + password or phone OTP.
   *
   * The plugin augments `sys_user` with `phone_number` (unique) and
   * `phone_number_verified`, mapped to snake_case by
   * `buildPhoneNumberPluginSchema()`.
   */
  phoneNumber: z.boolean().default(false).describe(
    'Enable phone-number sign-in (phone + password; OTP sign-in/reset when an SMS service is configured)',
  ),
}));

/**
 * Mutual TLS (mTLS) Configuration Schema
 * 
 * Enables client certificate authentication for zero-trust architectures.
 */
export const MutualTLSConfigSchema = lazySchema(() => z.object({
  /** Enable mutual TLS authentication */
  enabled: z.boolean()
    .default(false)
    .describe('Enable mutual TLS authentication'),

  /** Require client certificates for all connections */
  clientCertRequired: z.boolean()
    .default(false)
    .describe('Require client certificates for all connections'),

  /** PEM-encoded CA certificates or file paths for trust validation */
  trustedCAs: z.array(z.string())
    .describe('PEM-encoded CA certificates or file paths'),

  /** Certificate Revocation List URL */
  crlUrl: z.string()
    .optional()
    .describe('Certificate Revocation List (CRL) URL'),

  /** Online Certificate Status Protocol URL */
  ocspUrl: z.string()
    .optional()
    .describe('Online Certificate Status Protocol (OCSP) URL'),

  /** Certificate validation strictness level */
  certificateValidation: z.enum(['strict', 'relaxed', 'none'])
    .describe('Certificate validation strictness level'),

  /** Allowed Common Names on client certificates */
  allowedCNs: z.array(z.string())
    .optional()
    .describe('Allowed Common Names (CN) on client certificates'),

  /** Allowed Organizational Units on client certificates */
  allowedOUs: z.array(z.string())
    .optional()
    .describe('Allowed Organizational Units (OU) on client certificates'),

  /** Certificate pinning configuration */
  pinning: z.object({
    /** Enable certificate pinning */
    enabled: z.boolean().describe('Enable certificate pinning'),
    /** Array of pinned certificate hashes */
    pins: z.array(z.string()).describe('Pinned certificate hashes'),
  })
    .optional()
    .describe('Certificate pinning configuration'),
}));

export type MutualTLSConfig = z.input<typeof MutualTLSConfigSchema>;
/** Post-parse shape of {@link MutualTLSConfig} — defaults applied, transforms run (ADR-0122). */
export type MutualTLSConfigParsed = z.infer<typeof MutualTLSConfigSchema>;

/**
 * Social / OAuth Provider Configuration
 *
 * Maps provider id → { clientId, clientSecret, ... }.
 * Keys must match Better-Auth built-in provider names (google, github, etc.).
 */
export const SocialProviderConfigSchema = lazySchema(() => z.record(
  z.string(),
  z.object({
    clientId: z.string().describe('OAuth Client ID'),
    clientSecret: z.string().describe('OAuth Client Secret'),
    enabled: z.boolean().default(true).describe('Enable this provider (default: true)'),
    scope: z.array(z.string()).optional().describe('Additional OAuth scopes'),
  }).catchall(z.unknown()),
).optional().describe(
  'Social/OAuth provider map forwarded to better-auth socialProviders. ' +
  'Keys are provider ids (google, github, apple, …).'
));

/**
 * OIDC / Generic OAuth2 Provider Configuration
 *
 * Used for enterprise SSO via better-auth's genericOAuth plugin.
 * Supports any OIDC-compliant provider (Okta, Azure AD, Keycloak, etc.)
 * by specifying a discovery URL.
 */
export const OidcProviderConfigSchema = lazySchema(() => z.object({
  providerId: z.string().describe('Unique identifier for this provider (e.g., okta, azure-ad)'),
  name: z.string().optional().describe('Display name shown in the UI (defaults to providerId)'),
  discoveryUrl: z.string().optional().describe(
    'OIDC discovery URL (.well-known/openid-configuration). ' +
    'When provided, authorizationUrl/tokenUrl/userInfoUrl are fetched automatically.'
  ),
  issuer: z.string().optional().describe('Expected issuer identifier for token validation'),
  authorizationUrl: z.string().optional().describe('OAuth2 authorization endpoint (optional if discoveryUrl is set)'),
  tokenUrl: z.string().optional().describe('OAuth2 token endpoint (optional if discoveryUrl is set)'),
  userInfoUrl: z.string().optional().describe('OAuth2 userinfo endpoint (optional if discoveryUrl is set)'),
  clientId: z.string().describe('OAuth2 client ID'),
  clientSecret: z.string().describe('OAuth2 client secret'),
  scopes: z.array(z.string()).optional().describe('Requested scopes (default: openid email profile)'),
  pkce: z.boolean().optional().describe('Enable PKCE (recommended for public clients)'),
}).describe('OIDC / Generic OAuth2 provider configuration for enterprise SSO'));

export const OidcProvidersConfigSchema = lazySchema(() => z.array(OidcProviderConfigSchema).optional().describe(
  'List of OIDC/OAuth2 providers for enterprise SSO. ' +
  'Product or enterprise packages can pass this directly or contribute it through auth:configure.'
));

export type OidcProviderConfig = z.input<typeof OidcProviderConfigSchema>;
export type OidcProvidersConfig = z.input<typeof OidcProvidersConfigSchema>;


export const EmailAndPasswordConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(true).describe('Enable email/password auth'),
  disableSignUp: z.boolean().optional().describe('Disable new user registration via email/password'),
  requireEmailVerification: z.boolean().optional().describe(
    'Require email verification before creating a session'
  ),
  minPasswordLength: z.number().optional().describe('Minimum password length (default 8)'),
  maxPasswordLength: z.number().optional().describe('Maximum password length (default 128)'),
  resetPasswordTokenExpiresIn: z.number().optional().describe(
    'Reset-password token TTL in seconds (default 3600)'
  ),
  autoSignIn: z.boolean().optional().describe('Auto sign-in after sign-up (default true)'),
  revokeSessionsOnPasswordReset: z.boolean().optional().describe(
    'Revoke all other sessions on password reset'
  ),
}).optional().describe('Email and password authentication options forwarded to better-auth'));

/**
 * Email Verification Configuration
 */
export const EmailVerificationConfigSchema = lazySchema(() => z.object({
  sendOnSignUp: z.boolean().optional().describe(
    'Automatically send verification email after sign-up'
  ),
  sendOnSignIn: z.boolean().optional().describe(
    'Send verification email on sign-in when not yet verified'
  ),
  autoSignInAfterVerification: z.boolean().optional().describe(
    'Auto sign-in the user after email verification'
  ),
  expiresIn: z.number().optional().describe(
    'Verification token TTL in seconds (default 3600)'
  ),
}).optional().describe('Email verification options forwarded to better-auth'));

/**
 * Audience posture — the ONE declaration answering "who may become a user of
 * an app built on this environment" (#11739 / epic #11723).
 *
 * Before this existed, the answer was an emergent property of
 * `emailAndPassword.disableSignUp` + `emailVerification` + `ssoOnlyMode` +
 * plugin-auth's `membershipPolicy` + an implicit fallback permission set —
 * five uncoordinated switches whose combined default was open
 * self-registration with no email verification. Nobody chose that combination
 * and no AI-authored app could declare otherwise. The vocabulary is CLOSED
 * (maintainer ruling 2026-08-24, epic #11723) and the undeclared default is
 * the safe end: `invite_only`.
 *
 * Follow the `MembershipPolicy` precedent (`@objectstack/plugin-auth`,
 * reconcile-membership.ts): a runtime value list, an `isX()` entry guard, and
 * a LOUD refusal of off-vocabulary values — never a silent coercion to a
 * permissive branch (its docblock records the fail-open typo that made the
 * precedent exist).
 */
export const AUDIENCE_POSTURES = ['invite_only', 'email_domain', 'open'] as const;

export type AudiencePosture = (typeof AUDIENCE_POSTURES)[number];

/** Type guard over {@link AUDIENCE_POSTURES}. */
export function isAudiencePosture(value: unknown): value is AudiencePosture {
  return (AUDIENCE_POSTURES as readonly string[]).includes(value as string);
}

/**
 * Whether a posture PERMITS self-registration (someone becoming a user by
 * their own act, with no per-user operator act). `invite_only` does not —
 * admission there comes only from an explicit operator-side act (a pending
 * invitation, admin create/import, SCIM provisioning, an operator-registered
 * identity provider).
 */
export function audiencePermitsSelfRegistration(posture: AudiencePosture): boolean {
  return posture === 'email_domain' || posture === 'open';
}

/**
 * One declared email domain: bare lowercase-comparable hostname labels with at
 * least one dot (`acme.com`, `mail.acme.com`). No scheme, no `@`, no leading
 * dot, no wildcard — subdomains are NOT implied and need their own entries
 * (the matching rules are pinned on the enforcement side, plugin-auth's
 * `audience-posture.ts`).
 */
const AUDIENCE_EMAIL_DOMAIN_SHAPE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/**
 * The audience declaration. Every invariant here is mirrored — and enforced
 * against the LIVE config — by plugin-auth's entry validation
 * (`assertAudienceConfig`), because this schema guards the authoring surface
 * while the runtime receives plain objects; the two must refuse the same
 * shapes (ADR-0078: a declared-but-inert or open-but-unverified configuration
 * is refused at declaration, never silently accepted).
 */
export const AudienceConfigSchema = lazySchema(() => z.object({
  /**
   * Who may become a user of this environment's apps:
   *
   * - `invite_only` (default): self-registration is CLOSED. A user comes into
   *   existence only through an operator-side act — a pending invitation
   *   (which admits the invitee's own sign-up), admin create-user / bulk
   *   import, SCIM provisioning, or an operator-registered identity provider.
   * - `email_domain`: self-registration is open ONLY to addresses whose domain
   *   is on {@link allowedEmailDomains}. Email verification is forced on.
   * - `open`: anyone may self-register. Email verification is forced on.
   */
  posture: z.enum(AUDIENCE_POSTURES).default('invite_only').describe(
    'Who may self-register into this environment: invite_only (default — operator acts only), ' +
    'email_domain (allowlisted email domains), or open (anyone). ' +
    'Any posture other than invite_only forces email verification on.',
  ),
  /**
   * Required (non-empty) when `posture: 'email_domain'`; refused under any
   * other posture (a domain list that gates nothing is the ADR-0078
   * "declared but inert" defect). Matching is case-insensitive and EXACT per
   * entry — `mail.acme.com` is not admitted by `acme.com`.
   */
  allowedEmailDomains: z.array(
    z.string().regex(
      AUDIENCE_EMAIL_DOMAIN_SHAPE,
      'a domain entry is a bare hostname with at least one dot (e.g. "acme.com") — no scheme, no "@", no wildcard',
    ),
  ).optional().describe(
    'Email domains admitted to self-register under posture email_domain (exact, case-insensitive match; ' +
    'subdomains need their own entries). Required non-empty for email_domain; refused under other postures.',
  ),
  /**
   * The permission set a SELF-REGISTRANT receives, by `sys_permission_set`
   * name. Required whenever the posture permits self-registration — the
   * implicit `member_default` fallback is exactly the undeclared grant this
   * card retires (declaring `member_default` explicitly is fine). Refused for
   * `invite_only` (inert there: invited/provisioned users receive grants from
   * their invitation placement or operator assignment, not from this key).
   * The enforcement side refuses admission when the named set cannot be
   * resolved (dangling declaration ⇒ nobody is admitted ungranted), and
   * refuses `admin_full_access` at entry (a self-registrant must never
   * receive the platform-admin set).
   */
  selfRegistrationPermissionSet: z.string().min(1).optional().describe(
    'sys_permission_set name granted to each self-registrant. Required when posture is email_domain or open; ' +
    'refused for invite_only. admin_full_access is refused.',
  ),
}).superRefine((value, ctx) => {
  const posture = value.posture ?? 'invite_only';
  const permitsSelfRegistration = audiencePermitsSelfRegistration(posture);
  if (posture === 'email_domain') {
    if (!value.allowedEmailDomains || value.allowedEmailDomains.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedEmailDomains'],
        message:
          "posture 'email_domain' requires a non-empty allowedEmailDomains list — " +
          'an email-domain gate with no domains admits nobody and reads as misconfiguration, not policy. ' +
          "Declare the domains, or use posture 'invite_only'.",
      });
    }
  } else if (value.allowedEmailDomains !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowedEmailDomains'],
      message:
        `allowedEmailDomains is only read under posture 'email_domain' — under '${posture}' it would be ` +
        'declared but inert (ADR-0078), and an operator reading it would believe a wall exists that does not. ' +
        'Remove it, or set posture to email_domain.',
    });
  }
  if (value.allowedEmailDomains) {
    const seen = new Set<string>();
    for (let i = 0; i < value.allowedEmailDomains.length; i++) {
      const lowered = value.allowedEmailDomains[i].toLowerCase();
      if (seen.has(lowered)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allowedEmailDomains', i],
          message: `duplicate domain entry '${value.allowedEmailDomains[i]}' (matching is case-insensitive)`,
        });
      }
      seen.add(lowered);
    }
  }
  if (permitsSelfRegistration) {
    if (!value.selfRegistrationPermissionSet) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selfRegistrationPermissionSet'],
        message:
          `posture '${posture}' permits self-registration, so the permission set a self-registrant receives ` +
          'must be DECLARED (selfRegistrationPermissionSet) — the implicit member_default fallback is retired ' +
          '(#11739; declaring member_default explicitly is allowed).',
      });
    } else if (value.selfRegistrationPermissionSet === 'admin_full_access') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selfRegistrationPermissionSet'],
        message:
          "selfRegistrationPermissionSet must not be 'admin_full_access' — an unscoped platform-admin grant " +
          'to every self-registrant is never a declarable audience.',
      });
    }
  } else if (value.selfRegistrationPermissionSet !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['selfRegistrationPermissionSet'],
      message:
        "selfRegistrationPermissionSet is only read under a posture that permits self-registration — under " +
        "'invite_only' it is declared but inert (ADR-0078). Remove it, or open the posture deliberately.",
    });
  }
}));

export type AudienceConfig = z.input<typeof AudienceConfigSchema>;
/** Post-parse shape of {@link AudienceConfig} — defaults applied, transforms run (ADR-0122). */
export type AudienceConfigParsed = z.infer<typeof AudienceConfigSchema>;

/**
 * Advanced / Low-level Better-Auth Options
 */
export const AdvancedAuthConfigSchema = lazySchema(() => z.object({
  crossSubDomainCookies: z.object({
    enabled: z.boolean().describe('Enable cross-subdomain cookies'),
    additionalCookies: z.array(z.string()).optional().describe('Extra cookies shared across subdomains'),
    domain: z.string().optional().describe(
      'Cookie domain override — defaults to root domain derived from baseUrl'
    ),
  }).optional().describe(
    'Share auth cookies across subdomains (critical for *.example.com multi-tenant)'
  ),
  useSecureCookies: z.boolean().optional().describe('Force Secure flag on cookies'),
  disableCSRFCheck: z.boolean().optional().describe(
    '⚠ Disable CSRF check — security risk, use with caution'
  ),
  cookiePrefix: z.string().optional().describe('Prefix for auth cookie names'),
}).optional().describe('Advanced / low-level Better-Auth options'));

export const AuthConfigSchema = lazySchema(() => z.object({
  secret: z.string().optional().describe('Encryption secret'),
  baseUrl: z.string().optional().describe('Base URL for auth routes'),
  /**
   * Basename under which the auth UI SPA (Console) is mounted, used to
   * construct absolute redirect URLs for OAuth/OIDC, device-authorization
   * verification, and password-reset emails.
   *
   * Defaults to `/_console` (the standard Console mount point shipped by
   * `@objectstack/console`). Override only if you host Console on a custom
   * path. Trailing slashes are stripped.
   */
  uiBasePath: z.string().default('/_console').describe(
    'Basename where the auth UI (Console) is mounted (default `/_console`)',
  ),
  databaseUrl: z.string().optional().describe('Database connection string'),
  providers: z.array(AuthProviderConfigSchema).optional(),
  plugins: AuthPluginConfigSchema.optional(),
  session: z.object({
    expiresIn: z.number().default(60 * 60 * 24 * 7).describe('Session duration in seconds'),
    updateAge: z.number().default(60 * 60 * 24).describe('Session update frequency'),
  }).optional(),
  trustedOrigins: z.array(z.string()).optional().describe(
    'Trusted origins for CSRF protection. Supports wildcards (e.g. "https://*.example.com"). ' +
    'The baseUrl origin is always trusted implicitly.'
  ),
  socialProviders: SocialProviderConfigSchema,
  oidcProviders: OidcProvidersConfigSchema,
  emailAndPassword: EmailAndPasswordConfigSchema,
  emailVerification: EmailVerificationConfigSchema,
  /**
   * Audience posture (#11739) — who may become a user of this environment's
   * apps. Undeclared ⇒ `invite_only` (the safe default; maintainer ruling
   * 2026-08-24 on epic #11723 — no legacy/undeclared limbo).
   *
   * Cross-field invariant, enforced by plugin-auth at config entry (this
   * schema cannot see `emailAndPassword` from inside the sub-object, and the
   * runtime receives plain objects): a posture that permits self-registration
   * (`email_domain` / `open`) FORCES `emailAndPassword.requireEmailVerification`
   * on — an explicit `requireEmailVerification: false` beside such a posture
   * is refused loudly at boot (an unverified allowlisted-domain signup is
   * colleague impersonation; it makes the domain gate decorative).
   */
  audience: AudienceConfigSchema.optional().describe(
    'Audience posture: who may self-register into this environment ' +
    '(invite_only — the default — | email_domain | open). See AudienceConfigSchema.',
  ),
  advanced: AdvancedAuthConfigSchema,
  /**
   * SSO-only ("enforced") login mode. When `true`, the login UI hides the
   * local email/password form and self-registration so the team signs in via
   * the configured IdP only (cloud-as-IdP, or an external OIDC/SAML provider).
   * The break-glass password endpoint stays enabled — managed (IdP-provisioned)
   * users simply hold no local credential, while the env owner retains a
   * password escape hatch. Generic over the IdP; orthogonal to which providers
   * are wired. Self-host can also set this via `OS_AUTH_SSO_ONLY=true`.
   */
  ssoOnlyMode: z.boolean().optional().describe(
    'SSO-only login: hide the local password form + self-registration (the break-glass password endpoint stays enabled)',
  ),
  mutualTls: MutualTLSConfigSchema.optional().describe('Mutual TLS (mTLS) configuration'),
}).catchall(z.unknown()));

export type AuthProviderConfig = z.input<typeof AuthProviderConfigSchema>;
export type AuthPluginConfig = z.input<typeof AuthPluginConfigSchema>;
/** Post-parse shape of {@link AuthPluginConfig} — defaults applied, transforms run (ADR-0122). */
export type AuthPluginConfigParsed = z.infer<typeof AuthPluginConfigSchema>;
export type SocialProviderConfig = z.input<typeof SocialProviderConfigSchema>;
/** Post-parse shape of {@link SocialProviderConfig} — defaults applied, transforms run (ADR-0122). */
export type SocialProviderConfigParsed = z.infer<typeof SocialProviderConfigSchema>;
export type EmailAndPasswordConfig = z.input<typeof EmailAndPasswordConfigSchema>;
/** Post-parse shape of {@link EmailAndPasswordConfig} — defaults applied, transforms run (ADR-0122). */
export type EmailAndPasswordConfigParsed = z.infer<typeof EmailAndPasswordConfigSchema>;
export type EmailVerificationConfig = z.input<typeof EmailVerificationConfigSchema>;
export type AdvancedAuthConfig = z.input<typeof AdvancedAuthConfigSchema>;
export type AuthConfig = z.input<typeof AuthConfigSchema>;
/** Post-parse shape of {@link AuthConfig} — defaults applied, transforms run (ADR-0122). */
export type AuthConfigParsed = z.infer<typeof AuthConfigSchema>;
