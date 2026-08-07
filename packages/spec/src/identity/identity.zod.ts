// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Identity & User Model Specification
 * 
 * Defines the standard user, account, and session data models for ObjectStack.
 * These schemas represent "who is logged in" and their associated data.
 * 
 * This is separate from authentication configuration (auth.zod.ts) which
 * defines "how to login".
 */

/**
 * User Schema
 * Core user identity data model
 */
import { lazySchema } from '../shared/lazy-schema';
export const UserSchema = lazySchema(() => z.object({
  /**
   * Unique user identifier
   */
  id: z.string().describe('Unique user identifier'),
  
  /**
   * User's email address (primary identifier)
   */
  email: z.string().email().describe('User email address'),
  
  /**
   * Email verification status
   */
  emailVerified: z.boolean().default(false).describe('Whether email is verified'),
  
  /**
   * User's display name
   */
  name: z.string().optional().describe('User display name'),
  
  /**
   * User's profile image URL
   */
  image: z.string().url().optional().describe('Profile image URL'),
  
  /**
   * Account creation timestamp
   */
  createdAt: z.string().datetime().describe('Account creation timestamp'),
  
  /**
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),
}));

export type User = z.input<typeof UserSchema>;
/** Post-parse shape of {@link User} — defaults applied, transforms run (ADR-0122). */
export type UserParsed = z.infer<typeof UserSchema>;

/**
 * Account Schema
 * Links external OAuth/OIDC/SAML accounts to a user
 */
export const AccountSchema = lazySchema(() => z.object({
  /**
   * Unique account identifier
   */
  id: z.string().describe('Unique account identifier'),
  
  /**
   * Associated user ID
   */
  userId: z.string().describe('Associated user ID'),
  
  /**
   * Account type/provider
   */
  type: z.enum([
    'oauth',
    'oidc',
    'email',
    'credentials',
    'saml',
    'ldap',
  ]).describe('Account type'),
  
  /**
   * Provider name (e.g., 'google', 'github', 'okta')
   */
  provider: z.string().describe('Provider name'),
  
  /**
   * Provider account ID
   */
  providerAccountId: z.string().describe('Provider account ID'),
  
  /**
   * OAuth refresh token
   */
  refreshToken: z.string().optional().describe('OAuth refresh token'),
  
  /**
   * OAuth access token
   */
  accessToken: z.string().optional().describe('OAuth access token'),
  
  /**
   * Token expiry timestamp
   */
  expiresAt: z.number().optional().describe('Token expiry timestamp (Unix)'),
  
  /**
   * OAuth token type
   */
  tokenType: z.string().optional().describe('OAuth token type'),
  
  /**
   * OAuth scope
   */
  scope: z.string().optional().describe('OAuth scope'),
  
  /**
   * OAuth ID token
   */
  idToken: z.string().optional().describe('OAuth ID token'),
  
  /**
   * Session state
   */
  sessionState: z.string().optional().describe('Session state'),
  
  /**
   * Account creation timestamp
   */
  createdAt: z.string().datetime().describe('Account creation timestamp'),
  
  /**
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),
}));

export type Account = z.input<typeof AccountSchema>;

/*
 * The bare `Session` / `SessionSchema` names are NOT declared here (#4641).
 *
 * This module used to carry a second `Session` declaration alongside the one in
 * `api/auth.zod.ts`, so which shape a consumer got depended only on whether they
 * imported from `@objectstack/spec/identity` or `@objectstack/spec/api` — the
 * #4411 trap, and the two shapes did not even agree on field names (`expires` vs
 * `expiresAt`, `sessionToken` vs `token`).
 *
 * The `./api` declaration is the live one: it is embedded in
 * `SessionResponseSchema`, the body served for `AuthEndpointPaths.getSession`
 * (`/get-session`, `/me`, `/refresh`). The declaration that stood here had no
 * importer anywhere in framework, cloud or objectui outside its own unit test,
 * was wired into no parent schema, and had drifted from the table it claimed to
 * describe: the ENFORCED session record is the `sys_session` ObjectSchema in
 * `@objectstack/platform-objects` (`identity/sys-session.object.ts`), which
 * spells the columns `token` / `expires_at` and has no `fingerprint` at all.
 *
 * Need the wire shape? `import type { Session } from '@objectstack/spec/api'`.
 * Need the persisted record? Read the `sys_session` object — it is what the
 * migration and the auth plugin actually enforce.
 */

/**
 * Verification Token Schema
 * Email verification and password reset tokens
 */
export const VerificationTokenSchema = lazySchema(() => z.object({
  /**
   * Token identifier (email or phone)
   */
  identifier: z.string().describe('Token identifier (email or phone)'),
  
  /**
   * Verification token
   */
  token: z.string().describe('Verification token'),
  
  /**
   * Token expiry timestamp
   */
  expires: z.string().datetime().describe('Token expiry timestamp'),
  
  /**
   * Token creation timestamp
   */
  createdAt: z.string().datetime().describe('Token creation timestamp'),
}));

export type VerificationToken = z.input<typeof VerificationTokenSchema>;

/**
 * API Key Schema
 *
 * Aligns with better-auth's API key plugin capabilities.
 * Provides programmatic access to ObjectStack APIs (CI/CD, service-to-service, CLI).
 *
 * @see https://www.better-auth.com/docs/plugins/api-key
 */
export const ApiKeySchema = lazySchema(() => z.object({
  /**
   * Unique API key identifier
   */
  id: z.string().describe('API key identifier'),

  /**
   * Human-readable name for the key
   */
  name: z.string().describe('API key display name'),

  /**
   * Key prefix (visible portion for identification, e.g., "os_pk_ab")
   */
  start: z.string().optional().describe('Key prefix for identification'),

  /**
   * Custom prefix for the key (e.g., "os_pk_")
   */
  prefix: z.string().optional().describe('Custom key prefix'),

  /**
   * User ID of the key owner
   */
  userId: z.string().describe('Owner user ID'),

  /**
   * Organization ID the key is scoped to (optional)
   */
  organizationId: z.string().optional().describe('Scoped organization ID'),

  /**
   * Key expiration timestamp (null = never expires)
   */
  expiresAt: z.string().datetime().optional().describe('Expiration timestamp'),

  /**
   * Creation timestamp
   */
  createdAt: z.string().datetime().describe('Creation timestamp'),

  /**
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),

  /**
   * Last used timestamp
   */
  lastUsedAt: z.string().datetime().optional().describe('Last used timestamp'),

  /**
   * Last refetch timestamp (for cached permission checks)
   */
  lastRefetchAt: z.string().datetime().optional().describe('Last refetch timestamp'),

  /**
   * Whether this key is enabled
   */
  enabled: z.boolean().default(true).describe('Whether the key is active'),

  /**
   * Rate limiting: enabled flag
   */
  rateLimitEnabled: z.boolean().optional().describe('Whether rate limiting is enabled'),

  /**
   * Rate limiting: time window in milliseconds
   */
  rateLimitTimeWindow: z.number().int().min(0).optional().describe('Rate limit window (ms)'),

  /**
   * Rate limiting: max requests per window
   */
  rateLimitMax: z.number().int().min(0).optional().describe('Max requests per window'),

  /**
   * Rate limiting: remaining requests in current window
   */
  remaining: z.number().int().min(0).optional().describe('Remaining requests'),

  /**
   * Permissions assigned to this key (granular access control)
   */
  permissions: z.record(z.string(), z.boolean()).optional()
    .describe('Granular permission flags'),

  /**
   * Scopes assigned to this key (high-level access categories)
   */
  scopes: z.array(z.string()).optional()
    .describe('High-level access scopes'),

  /**
   * Custom metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata'),
}));

export type ApiKey = z.input<typeof ApiKeySchema>;
/** Post-parse shape of {@link ApiKey} — defaults applied, transforms run (ADR-0122). */
export type ApiKeyParsed = z.infer<typeof ApiKeySchema>;
