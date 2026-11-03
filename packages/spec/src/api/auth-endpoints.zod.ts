// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Authentication Endpoint Specification
 * 
 * Defines the canonical HTTP endpoints for the authentication service.
 * Based on better-auth v1.4.18 endpoint conventions.
 * 
 * NOTE: ObjectStack's auth implementation uses better-auth library which has
 * established endpoint conventions. This spec documents those conventions as
 * the canonical API contract.
 */

// ==========================================
// Endpoint Path Definitions
// ==========================================

/**
 * Authentication Endpoint Paths
 * 
 * These are the paths relative to the auth base route (e.g., /api/v1/auth).
 * Based on better-auth's endpoint structure.
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { TenancyPostureSchema } from '../security/tenancy-posture';
import { AUDIENCE_POSTURES } from '../system/auth-config.zod';
export const AuthEndpointPaths = {
  // Email/Password Authentication
  signInEmail: '/sign-in/email',
  signUpEmail: '/sign-up/email',
  signOut: '/sign-out',

  // Session Management
  getSession: '/get-session',

  // Password Management
  forgetPassword: '/forget-password',
  resetPassword: '/reset-password',

  // Email Verification
  sendVerificationEmail: '/send-verification-email',
  verifyEmail: '/verify-email',

  // OAuth (dynamic based on provider)
  // authorize: '/authorize/:provider'
  // callback: '/callback/:provider'

  // 2FA (when enabled)
  twoFactorEnable: '/two-factor/enable',
  twoFactorVerify: '/two-factor/verify',

  // Passkeys (when enabled)
  passkeyRegister: '/passkey/register',
  passkeyAuthenticate: '/passkey/authenticate',

  // Magic Links (when enabled)
  magicLinkSend: '/magic-link/send',
  magicLinkVerify: '/magic-link/verify',

  // Device Flow (CLI browser-based login)
  deviceRequest: '/device/request',
  deviceToken: '/device/token',
  deviceApprove: '/device/approve',
} as const;

/**
 * HTTP Method + Path Specification
 * 
 * Defines the complete HTTP contract for each endpoint.
 */
export const AuthEndpointSchema = lazySchema(() => z.object({
  /** Sign in with email and password */
  signInEmail: z.object({
    method: z.literal('POST'),
    path: z.literal(AuthEndpointPaths.signInEmail),
    description: z.literal('Sign in with email and password'),
  }),
  
  /** Register new user with email and password */
  signUpEmail: z.object({
    method: z.literal('POST'),
    path: z.literal(AuthEndpointPaths.signUpEmail),
    description: z.literal('Register new user with email and password'),
  }),
  
  /** Sign out current user */
  signOut: z.object({
    method: z.literal('POST'),
    path: z.literal(AuthEndpointPaths.signOut),
    description: z.literal('Sign out current user'),
  }),
  
  /** Get current user session */
  getSession: z.object({
    method: z.literal('GET'),
    path: z.literal(AuthEndpointPaths.getSession),
    description: z.literal('Get current user session'),
  }),
  
  /** Request password reset email */
  forgetPassword: z.object({
    method: z.literal('POST'),
    path: z.literal(AuthEndpointPaths.forgetPassword),
    description: z.literal('Request password reset email'),
  }),
  
  /** Reset password with token */
  resetPassword: z.object({
    method: z.literal('POST'),
    path: z.literal(AuthEndpointPaths.resetPassword),
    description: z.literal('Reset password with token'),
  }),
  
  /** Send email verification */
  sendVerificationEmail: z.object({
    method: z.literal('POST'),
    path: z.literal(AuthEndpointPaths.sendVerificationEmail),
    description: z.literal('Send email verification link'),
  }),
  
  /** Verify email with token */
  verifyEmail: z.object({
    method: z.literal('GET'),
    path: z.literal(AuthEndpointPaths.verifyEmail),
    description: z.literal('Verify email with token'),
  }),
}));

/**
 * Endpoint Aliases
 * 
 * Common aliases for better developer experience.
 * These map to the canonical better-auth endpoints.
 */
export const AuthEndpointAliases = {
  login: AuthEndpointPaths.signInEmail,
  register: AuthEndpointPaths.signUpEmail,
  logout: AuthEndpointPaths.signOut,
  me: AuthEndpointPaths.getSession,
} as const;

/**
 * Full Endpoint URLs
 * 
 * Helper to construct full endpoint URLs given a base path.
 */
export function getAuthEndpointUrl(basePath: string, endpoint: keyof typeof AuthEndpointPaths): string {
  const cleanBase = basePath.replace(/\/$/, '');
  return `${cleanBase}${AuthEndpointPaths[endpoint]}`;
}

/**
 * Endpoint Mapping
 * 
 * Maps common/legacy endpoint names to canonical better-auth paths.
 * This allows clients to use simpler names while maintaining compatibility.
 */
export const EndpointMapping = {
  '/login': AuthEndpointPaths.signInEmail,
  '/register': AuthEndpointPaths.signUpEmail,
  '/logout': AuthEndpointPaths.signOut,
  '/me': AuthEndpointPaths.getSession,
  '/refresh': AuthEndpointPaths.getSession, // Session refresh handled by better-auth automatically
} as const;

// ==========================================
// Auth Configuration Discovery
// ==========================================

/**
 * Auth Provider Information (Public)
 *
 * Public-facing information about an OAuth/social provider.
 * Does NOT include sensitive configuration (clientSecret, etc.)
 */
export const AuthProviderInfoSchema = lazySchema(() => z.object({
  id: z.string().describe('Provider ID (e.g., google, github, microsoft, okta)'),
  name: z.string().describe('Display name (e.g., Google, GitHub)'),
  enabled: z.boolean().describe('Whether this provider is enabled'),
  /** Distinguishes built-in social providers from custom OIDC/OAuth2 entries */
  type: z.enum(['social', 'oidc']).default('social').describe('Provider type'),
}));

/**
 * Email/Password Configuration (Public)
 */
export const EmailPasswordConfigPublicSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Whether email/password auth is enabled'),
  disableSignUp: z.boolean().optional().describe('Whether new user registration is disabled'),
  requireEmailVerification: z.boolean().optional().describe('Whether email verification is required'),
}));

/**
 * `passkeys` / `magicLink` were withdrawn from the `/api/v1/auth/config` payload
 * in #7481 (maintainer ruling 2026-08-11) — see
 * `PUBLIC_AUTH_FEATURES_NOT_ADVERTISED` in `kernel/public-auth-features.ts` for
 * the standing record and the condition under which they come back.
 *
 * The two prescriptions differ because the two capabilities differ: nothing at
 * all is behind `passkeys`, while `magicLink`'s better-auth endpoints are live
 * and only their advertisement was withdrawn. A single shared string would have
 * told half the readers something false.
 */
const PASSKEYS_UNADVERTISED =
  '`features.passkeys` was removed from GET /api/v1/auth/config in @objectstack/spec 17 '
  + '(ADR-0049) — it was served from introduction and consumed by nothing: no login '
  + 'UI in any client reads it, and no better-auth passkey plugin is wired behind it, so a '
  + 'deployer who set `plugins.passkeys: true` flipped a switch that changed no behaviour '
  + 'anywhere. Delete the key. There is no replacement flag to read: passkey sign-in is not '
  + 'a capability this platform offers yet. It returns to this payload in the change that '
  + 'ships the login UI, classified in PUBLIC_AUTH_FEATURES again at that '
  + 'point — do not re-add it ahead of a consumer.';

const MAGIC_LINK_UNADVERTISED =
  '`features.magicLink` was removed from GET /api/v1/auth/config in @objectstack/spec 17 '
  + '(ADR-0049) — the ADVERTISEMENT was inert, not the capability: no client renders '
  + 'a magic-link sign-in affordance off this flag, so it only told a deployer that a UI '
  + 'existed when none did. Delete the key. The server side is unchanged and still yours to '
  + 'call: `AuthPluginConfig.plugins.magicLink` wires better-auth\'s magic-link plugin, and '
  + '`/api/v1/auth/magic-link/send` + `/magic-link/verify` answer exactly as before — drive '
  + 'them from your own UI, or wait for the console release that restores this flag along with '
  + 'the login UI that reads it.';

/**
 * Auth Features Configuration (Public)
 */
export const AuthFeaturesConfigSchema = lazySchema(() => z.object({
  twoFactor: z.boolean().default(false).describe('Two-factor authentication enabled'),
  passkeys: retiredKey(PASSKEYS_UNADVERTISED),
  magicLink: retiredKey(MAGIC_LINK_UNADVERTISED),
  organization: z.boolean().default(false).describe('Multi-tenant organization support enabled'),
  // Served by plugin-auth (`getPublicConfig()`, refined by `isSsoUsable()` in
  // the `/config` route) and by the hono adapter's `/auth/config` route, which
  // applies the same refinement; read by the console LoginForm (#29344).
  sso: z.boolean().optional().describe(
    'Enterprise SSO sign-in usable: the domain-routed SSO plugin is wired AND at least one SSO provider is configured, so the login UI offers its "Sign in with SSO" entry; '
    + 'false when SSO is off, or on with no provider yet. The served value is that usable answer (isSsoUsable), not the coarse wired flag: '
    + 'GET /auth/config refines it before answering, and falls open to the wired flag when providers cannot be counted. '
    + 'Unlike ssoEnforced, which takes the password form away, this only says whether the SSO entry exists; absent means not usable',
  ),
  ssoEnforced: z.boolean().optional().describe(
    'SSO-only login enforced: the UI hides the local password form + self-registration (a break-glass "use a password" link remains)',
  ),
  phoneNumber: z.boolean().optional().describe(
    'Phone-number sign-in enabled (phone + password, V1.5)',
  ),
  phoneNumberOtp: z.boolean().optional().describe(
    'Phone-number OTP sign-in and self-service password reset available — requires the phoneNumber plugin plus a deliverable SMS service',
  ),
  cloudManaged: z.boolean().optional().describe(
    'Managed (cloud-hosted, SSO-only) mode: people arrive through the identity provider, so the UI hides inviting, creating users and setting their passwords; absent means not managed',
  ),
  turnstileSiteKey: z.string().optional().describe(
    'Public Cloudflare Turnstile site key, present only while the opt-in sign-up challenge is on: the sign-up form renders the widget and sends its token in the x-captcha-response header; absent means no challenge',
  ),
  // The keys below are served by plugin-auth `getPublicConfig()` (auth-manager.ts,
  // the `features` literal) and classified in PUBLIC_AUTH_FEATURES (flags) or
  // PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS (values); the registry-to-schema pin in
  // auth-endpoints.test.ts keeps the three key sets equal (#29473).
  multiOrgEnabled: z.boolean().optional().describe(
    'Multi-organization capability: true when the effective tenancy posture enforces an organization wall (group or isolated), the same answer the create-organization door gives; '
    + 'false on a single posture, and on a degraded deployment that asked for isolation but has none. The console offers creating, switching and leaving organizations only when it is on; '
    + 'the flag is default-on, so absent reads as on',
  ),
  tenancyPosture: TenancyPostureSchema.optional().describe(
    'Which tenancy posture is in force (single, group or isolated): the effective posture, from the same derivation as multiOrgEnabled. A value, not a gate: multiOrgEnabled stays the capability flag, '
    + 'while this tells the console how to render organization context (under group the organization switcher picks the write target and reads span every organization the member belongs to)',
  ),
  audiencePosture: z.enum(AUDIENCE_POSTURES).optional().describe(
    'Who may self-register into this environment (invite_only, email_domain or open): the posture the sign-up path enforces, reported as invite_only when the configured value is off-vocabulary. '
    + 'A value, not a gate: emailPassword.disableSignUp stays the boolean that hides the sign-up form, while this lets the login page say that registration is by invitation instead of offering a form the server refuses',
  ),
  degradedTenancy: z.boolean().optional().describe(
    'Degraded tenancy: true when multi-organization isolation was requested but is not active (the deployment booted only because OS_ALLOW_DEGRADED_TENANCY=1), so no engine enforces organization boundaries; '
    + 'the console can raise an operator warning off it. A status signal, not a capability gate; absent means not degraded',
  ),
  oidcProvider: z.boolean().optional().describe(
    'Embedded OIDC authorization server wired, from the same decision that mounts it, so OAuth applications can be registered and managed; on by default alongside the MCP surface. '
    + 'It says nothing about sign-in providers, which socialProviders lists; the flag is default-on, so absent reads as on',
  ),
  deviceAuthorization: z.boolean().optional().describe(
    'Device authorization (browser-approved CLI login) wired, so the device-code endpoints answer; when false the console device-approval page says device authorization is not enabled instead of calling them. '
    + 'Absent means not wired',
  ),
  admin: z.boolean().optional().describe(
    'Admin plugin wired (forced on whenever SCIM is enabled), so user administration (creating, banning, unlocking and impersonating users, setting their passwords) is available; '
    + 'the console shows those actions only when it is true. Absent means not wired',
  ),
  termsUrl: z.string().optional().describe(
    'Terms-of-service link shown beneath the login and register cards: the trimmed OS_TERMS_URL value when set, otherwise the public ObjectStack terms page; absent when the operator set OS_TERMS_URL to an empty or blank (whitespace-only) value to suppress the link',
  ),
  privacyUrl: z.string().optional().describe(
    'Privacy-policy link shown beneath the login and register cards: the trimmed OS_PRIVACY_URL value when set, otherwise the public ObjectStack privacy page; absent when the operator set OS_PRIVACY_URL to an empty or blank (whitespace-only) value to suppress the link',
  ),
}));

/**
 * Get Auth Config Response
 *
 * Returns the public authentication configuration that the frontend
 * can use to render appropriate login UI (social provider buttons, etc.)
 *
 * `devSeedAdmin` is deliberately NOT declared here. plugin-auth adds it at the
 * top level only under NODE_ENV=development, while the auto-seeded admin still
 * signs in with its default password, and it carries that email and password.
 * A published response contract would advertise a credential-bearing field that
 * no production deployment serves; its one reader, the console LoginPage, reads
 * the raw response and never parses it through this schema.
 */
export const GetAuthConfigResponseSchema = lazySchema(() => z.object({
  emailPassword: EmailPasswordConfigPublicSchema.describe('Email/password authentication config'),
  socialProviders: z.array(AuthProviderInfoSchema).describe('Available social/OAuth providers'),
  features: AuthFeaturesConfigSchema.describe('Enabled authentication features'),
}));

// ==========================================
// Type Exports
// ==========================================

export type AuthEndpoint = z.input<typeof AuthEndpointSchema>;
export type AuthEndpointPath = typeof AuthEndpointPaths[keyof typeof AuthEndpointPaths];
export type AuthEndpointAlias = keyof typeof AuthEndpointAliases;
export type EndpointMappingKey = keyof typeof EndpointMapping;
export type AuthProviderInfo = z.input<typeof AuthProviderInfoSchema>;
/** Post-parse shape of {@link AuthProviderInfo} — defaults applied, transforms run (ADR-0122). */
export type AuthProviderInfoParsed = z.infer<typeof AuthProviderInfoSchema>;
export type EmailPasswordConfigPublic = z.input<typeof EmailPasswordConfigPublicSchema>;
export type AuthFeaturesConfig = z.input<typeof AuthFeaturesConfigSchema>;
/** Post-parse shape of {@link AuthFeaturesConfig} — defaults applied, transforms run (ADR-0122). */
export type AuthFeaturesConfigParsed = z.infer<typeof AuthFeaturesConfigSchema>;
export type GetAuthConfigResponse = z.input<typeof GetAuthConfigResponseSchema>;
/** Post-parse shape of {@link GetAuthConfigResponse} — defaults applied, transforms run (ADR-0122). */
export type GetAuthConfigResponseParsed = z.infer<typeof GetAuthConfigResponseSchema>;

// ==========================================
// Device Flow (CLI Browser-Based Login)
// ==========================================

/**
 * Response from POST /api/v1/auth/device/request
 * The CLI displays verificationUrl and polls deviceToken with the code.
 */
export const DeviceRequestResponseSchema = lazySchema(() => z.object({
  code: z.string().describe('Short-lived device code used for polling'),
  verificationUrl: z.string().url().describe('URL the user should open in a browser'),
  expiresAt: z.string().datetime().describe('ISO timestamp when the code expires'),
  // Renamed from `interval` (#15677, #14478 ruling B): the unit lived only in
  // the describe prose. Verified NOT an RFC 8628 mirror before renaming —
  // this schema already renames every RFC field it carries (`code` is not
  // `device_code`, `verificationUrl` is not `verification_uri`, `expiresAt` is
  // not `expires_in`, and carries an ISO-8601 string where the RFC has a
  // relative lifetime), so it mirrors no standard as a set and cannot claim
  // the standard fixes this one name.
  intervalSeconds: z.number().default(2).describe('Recommended polling interval in seconds'),

  /** Tombstone for the rename above (#15677, ruling B on #14478). */
  interval: retiredKey(
    '`DeviceRequestResponse.interval` was renamed to `intervalSeconds` in @objectstack/spec 17 — '
    + 'the polling cadence is a duration and its unit lived only in the '
    + 'describe prose. Rename the key to `intervalSeconds`; the value (seconds) is unchanged. '
    + 'This response is not an RFC 8628 device-authorization payload — it renames every RFC '
    + 'field it carries — so the standard does not fix the bare spelling here.',
  ),
}));

/**
 * Response from GET /api/v1/auth/device/token?code=…
 * Returns pending until the user approves, then returns the token.
 */
export const DeviceTokenResponseSchema = lazySchema(() => z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
  }),
  z.object({
    status: z.literal('approved'),
    token: z.string().describe('Bearer token to store in credentials file'),
    user: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string().optional(),
    }),
  }),
  z.object({
    status: z.literal('expired'),
  }),
]));

export type DeviceRequestResponse = z.input<typeof DeviceRequestResponseSchema>;
/** Post-parse shape of {@link DeviceRequestResponse} — defaults applied, transforms run (ADR-0122). */
export type DeviceRequestResponseParsed = z.infer<typeof DeviceRequestResponseSchema>;
export type DeviceTokenResponse = z.input<typeof DeviceTokenResponseSchema>;
