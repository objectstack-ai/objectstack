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
  + '(#7481, ADR-0049) — it was served from introduction and consumed by nothing: no login '
  + 'UI in any client reads it, and no better-auth passkey plugin is wired behind it, so a '
  + 'deployer who set `plugins.passkeys: true` flipped a switch that changed no behaviour '
  + 'anywhere. Delete the key. There is no replacement flag to read: passkey sign-in is not '
  + 'a capability this platform offers yet. It returns to this payload in the change that '
  + 'ships the login UI (objectui#4179), classified in PUBLIC_AUTH_FEATURES again at that '
  + 'point — do not re-add it ahead of a consumer.';

const MAGIC_LINK_UNADVERTISED =
  '`features.magicLink` was removed from GET /api/v1/auth/config in @objectstack/spec 17 '
  + '(#7481, ADR-0049) — the ADVERTISEMENT was inert, not the capability: no client renders '
  + 'a magic-link sign-in affordance off this flag, so it only told a deployer that a UI '
  + 'existed when none did. Delete the key. The server side is unchanged and still yours to '
  + 'call: `AuthPluginConfig.plugins.magicLink` wires better-auth\'s magic-link plugin, and '
  + '`/api/v1/auth/magic-link/send` + `/magic-link/verify` answer exactly as before — drive '
  + 'them from your own UI, or wait for objectui#4179, which restores this flag along with '
  + 'the login UI that reads it.';

/**
 * Auth Features Configuration (Public)
 */
export const AuthFeaturesConfigSchema = lazySchema(() => z.object({
  twoFactor: z.boolean().default(false).describe('Two-factor authentication enabled'),
  passkeys: retiredKey(PASSKEYS_UNADVERTISED),
  magicLink: retiredKey(MAGIC_LINK_UNADVERTISED),
  organization: z.boolean().default(false).describe('Multi-tenant organization support enabled'),
  ssoEnforced: z.boolean().optional().describe(
    'SSO-only login enforced: the UI hides the local password form + self-registration (a break-glass "use a password" link remains)',
  ),
  phoneNumber: z.boolean().optional().describe(
    'Phone-number sign-in enabled (phone + password, #2766 V1.5)',
  ),
  phoneNumberOtp: z.boolean().optional().describe(
    'Phone-number OTP sign-in and self-service password reset available — requires the phoneNumber plugin plus a deliverable SMS service (#2780)',
  ),
}));

/**
 * Get Auth Config Response
 *
 * Returns the public authentication configuration that the frontend
 * can use to render appropriate login UI (social provider buttons, etc.)
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
  interval: z.number().default(2).describe('Recommended polling interval in seconds'),
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
