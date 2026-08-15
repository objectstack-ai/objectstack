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

/*
 * `ApiKey` / `ApiKeySchema` / `ApiKeyParsed` are NOT declared here (#8715,
 * maintainer-ruled DELETE 2026-08-15; ADR-0049 enforce-or-remove).
 *
 * The schema that stood here documented better-auth's `apiKey` PLUGIN shape —
 * a plugin this platform does not load: `start`, `lastRefetchAt`, `enabled`
 * (the real column is `revoked`, opposite polarity), `rateLimitEnabled` /
 * `rateLimitTimeWindow` / `rateLimitMax` / `remaining` (no per-key rate-limit
 * surface exists anywhere), `permissions`, `metadata`, camelCase
 * `organizationId`. It had ZERO consumers in framework, cloud or objectui
 * outside its own unit test, and one table ended up with two declarations of
 * which the published one was fiction — the AGENTS.md PD #10 shape.
 *
 * The single declaration of the `sys_api_key` table is the ObjectSchema in
 * `@objectstack/platform-objects` (`identity/sys-api-key.object.ts`): columns
 * `name, prefix, user_id, active_organization_id, scopes, expires_at,
 * last_used_at, revoked, key, id, created_at, updated_at` (snake_case — this
 * is persisted-record vocabulary, not a wire DTO). Rows are minted by
 * `POST /api/v1/keys` (`runtime/src/domains/keys.ts`) and verified by
 * `core/src/security/api-key.ts`; neither ever read the deleted schema.
 *
 * Need the persisted record? Read the `sys_api_key` object. Need the mint/
 * verify behaviour? It lives behind the endpoints above, keyed by the `osk_`
 * prefix. Per-key rate limiting returns only via the ENFORCE route of
 * ADR-0049 — the executor first, the vocabulary second.
 */

