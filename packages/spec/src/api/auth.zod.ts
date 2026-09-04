// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';

/**
 * Authentication Service Protocol
 * 
 * Defines the standard API contracts for Identity, Session Management,
 * and Access Control.
 */

// ==========================================
// Authentication Types
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const AuthProvider = z.enum([
  'local',
  'google',
  'github',
  'microsoft',
  'ldap',
  'saml'
]);

export const SessionUserSchema = lazySchema(() => z.object({
  id: z.string().describe('User ID'),
  email: z.string().email().describe('Email address'),
  emailVerified: z.boolean().default(false).describe('Is email verified?'),
  name: z.string().describe('Display name'),
  image: z.string().optional().describe('Avatar URL'),
  username: z.string().optional().describe('Username (optional)'),
  roles: z.array(z.string()).optional().default([]).describe('Assigned role IDs'),
  tenantId: z.string().optional().describe('Current tenant ID'),
  /**
   * `language` RETIRED (#14788, ADR-0049 enforce-or-remove; maintainer ruling
   * 2026-09-03, option D). It was declared with a permanent default of `'en'`
   * and had no producer and no consumer anywhere: no session endpoint ever
   * wrote it, no client ever read it, so a reader trusting the contract got a
   * constant that was not the user's language. The signed-in user's language
   * has ONE read face — `GET /auth/me/localization`, whose `locale` projects
   * the user's own `sys_user.locale` when set, then the request's
   * `Accept-Language`, then the deployment default. No replacement field is
   * added here until a session endpoint really produces one.
   *
   * Tombstoned, not deleted: this schema is a non-strict `z.object`, so a
   * plain deletion would let a producer still writing `language` parse clean
   * and lose the key silently (the ADR-0104 silent-strip shape). `retiredKey()`
   * makes writing it a `tsc` error and a parse error carrying the fix.
   * Registered as `api/SessionUser:language` under protocol major 18 plus the
   * D3 semantic entry `session-user-language-retired`; a RESPONSE surface, so
   * there is no authored source for a D2 conversion to rewrite.
   */
  language: retiredKey(
    '`SessionUser.language` was removed in @objectstack/spec 17.4.0 (#14788, ADR-0049) — ' +
    'it was declared with a permanent default of `\'en\'` and never produced by any session ' +
    'endpoint nor read by any client, so a reader keying on it saw a constant, not the ' +
    "user's language. Delete the key. Read the signed-in user's language from " +
    '`GET /auth/me/localization` (`locale`: the user\'s own `sys_user.locale` when set → ' +
    "the request's `Accept-Language` → the deployment default).",
  ),
  timezone: z.string().optional().describe('Preferred timezone'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}));

export const SessionSchema = lazySchema(() => z.object({
  id: z.string(),
  expiresAt: z.string().datetime(),
  token: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  userId: z.string(),
}));

// ==========================================
// Requests
// ==========================================

export const LoginType = z.enum(['email', 'username', 'phone', 'magic-link', 'social']);

export const LoginRequestSchema = lazySchema(() => z.object({
  type: LoginType.default('email').describe('Login method'),
  email: z.string().email().optional().describe('Required for email/magic-link'),
  username: z.string().optional().describe('Required for username login'),
  password: z.string().optional().describe('Required for password login'),
  provider: z.string().optional().describe('Required for social (google, github)'),
  redirectTo: z.string().optional().describe('Redirect URL after successful login'),
}));

export const RegisterRequestSchema = lazySchema(() => z.object({
  email: z.string().email(),
  password: z.string(),
  name: z.string(),
  image: z.string().optional(),
}));

export const RefreshTokenRequestSchema = lazySchema(() => z.object({
  refreshToken: z.string().describe('Refresh token'),
}));

// ==========================================
// Responses
// ==========================================

export const SessionResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    session: SessionSchema.describe('Active Session Info'),
    user: SessionUserSchema.describe('Current User Details'),
    token: z.string().optional().describe('Bearer token if not using cookies'),
  }),
}));

export const UserProfileResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: SessionUserSchema,
}));

export type AuthProvider = z.input<typeof AuthProvider>;
export type SessionUser = z.input<typeof SessionUserSchema>;
/** Post-parse shape of {@link SessionUser} — defaults applied, transforms run (ADR-0122). */
export type SessionUserParsed = z.infer<typeof SessionUserSchema>;
export type Session = z.input<typeof SessionSchema>;
export type LoginType = z.input<typeof LoginType>;
export type LoginRequest = z.input<typeof LoginRequestSchema>;
/** Post-parse shape of {@link LoginRequest} — defaults applied, transforms run (ADR-0122). */
export type LoginRequestParsed = z.infer<typeof LoginRequestSchema>;
export type RegisterRequest = z.input<typeof RegisterRequestSchema>;
export type RefreshTokenRequest = z.input<typeof RefreshTokenRequestSchema>;
export type SessionResponse = z.input<typeof SessionResponseSchema>;
/** Post-parse shape of {@link SessionResponse} — defaults applied, transforms run (ADR-0122). */
export type SessionResponseParsed = z.infer<typeof SessionResponseSchema>;
export type UserProfileResponse = z.input<typeof UserProfileResponseSchema>;
/** Post-parse shape of {@link UserProfileResponse} — defaults applied, transforms run (ADR-0122). */
export type UserProfileResponseParsed = z.infer<typeof UserProfileResponseSchema>;
