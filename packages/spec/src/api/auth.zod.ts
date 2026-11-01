// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { EffectiveObjectPermissionSchema } from '../security/permission.zod';

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
  /**
   * `null` is accepted alongside a string and alongside the key being absent.
   * better-auth owns this column, stores it nullable, and serialises it
   * present-and-null for a user who never set an avatar, so every `/auth/*`
   * session body the platform produces carries `"image": null` (#17235). The
   * declaration was the thing that was wrong: AGENTS.md Prime Directive #12's
   * default (fix the producer, never widen the consumer) rests on a premise it
   * states out loud - that we own both ends - which does not hold for a
   * third-party model, so its exit clause is the operative sentence.
   *
   * `.nullish()`, NOT `.nullable()`: the key's ABSENCE is a legal shape today
   * and no producer was ever measured omitting it, so retiring that shape
   * would be a narrowing riding along with a widening. Pure widening only.
   */
  image: z.string().nullish().describe('Avatar URL'),
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
    '`SessionUser.language` was removed in @objectstack/spec 17.4.0 (ADR-0049 enforce-or-remove) — ' +
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

// ==========================================
// GET /auth/me/permissions
// ==========================================

/**
 * [#28508] The anonymous answer of `GET /auth/me/permissions`: a caller with no
 * session is told only that, at 200, so the console can tell "signed out" from
 * a fault. Strict: nothing about any user is disclosed here.
 */
export const MePermissionsAnonymousResponseSchema = lazySchema(() => z.object({
  authenticated: z.literal(false).describe('No session: the caller is anonymous.'),
}).strict());

/**
 * [#28508] The authenticated answer of `GET /auth/me/permissions`: the caller's
 * effective permissions, resolved once by the server so the console never
 * re-derives them (`@objectstack/plugin-hono-server`, `current-user-endpoints.ts`).
 *
 * Three bodies take this one shape:
 *
 * - **full** — a stack with SecurityPlugin: every key present;
 * - **closed** — the server knew the caller but failed to compute the grants:
 *   every key present and empty, `hasAnyQueue: false`;
 * - **degraded** — no SecurityPlugin (or no metadata service): `systemPermissions`
 *   and `tabPermissions` are ABSENT on purpose. Absent means "unknown", which
 *   the console fails open on, because there the server enforces nothing
 *   either; present-and-empty means "none". The two must never be conflated.
 *
 * Strict: an undeclared key is refused, so a key the server starts sending is
 * declared here first (`Clause-②`).
 */
export const MePermissionsAuthenticatedResponseSchema = lazySchema(() => z.object({
  authenticated: z.literal(true).describe('A session was resolved for the caller.'),
  userId: z.string().describe('The caller\'s user id.'),
  tenantId: z.string().nullable().describe('The caller\'s active organization id, or null when the session has none.'),
  positions: z.array(z.string()).describe(
    'The security positions the caller holds (ADR-0068 D3): built-in identity names plus assigned positions, scope-resolved.',
  ),
  permissionSets: z.array(z.string()).describe('The names of the permission sets resolved for the caller.'),
  objects: z.record(z.string(), EffectiveObjectPermissionSchema).describe(
    'The effective object permissions, keyed by object name — the map `current_user.can()` reads on the server.',
  ),
  fields: z.record(z.string(), z.object({
    readable: z.boolean().describe('The caller may read the field.'),
    editable: z.boolean().describe('The caller may edit the field on some row (a row-conditioned entry is reported as its lock).'),
  }).strict()).describe('The effective field permissions, keyed `object.field`.'),
  systemPermissions: z.array(z.string()).optional().describe(
    'The effective system capabilities (ADR-0066). Absent only on the degraded body, where it means unknown; '
    + 'an empty array means none.',
  ),
  tabPermissions: z.record(z.string(), z.enum(['visible', 'hidden', 'default_on', 'default_off'])).optional().describe(
    'The effective app tab visibilities, keyed by app name. Absent only on the degraded body.',
  ),
  hasAnyQueue: z.boolean().describe(
    'Whether the caller\'s organization has at least one ownership queue: a declared queue the activation ledger '
    + 'has not switched off, or a `sys_queue` row of the organization. Resolved server-side through the '
    + 'ownership-queue service, so a member who may not read `sys_queue` still gets the answer; no names and no '
    + 'counts are disclosed. False when no ownership-queue service is registered, and on the closed body.',
  ),
}).strict());

/**
 * [#28508] The response of `GET /auth/me/permissions`, discriminated by
 * `authenticated`. The console reads it once per session.
 */
export const MePermissionsResponseSchema = lazySchema(() => z.discriminatedUnion('authenticated', [
  MePermissionsAnonymousResponseSchema,
  MePermissionsAuthenticatedResponseSchema,
]));

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
export type MePermissionsAnonymousResponse = z.input<typeof MePermissionsAnonymousResponseSchema>;
export type MePermissionsAuthenticatedResponse = z.input<typeof MePermissionsAuthenticatedResponseSchema>;
export type MePermissionsResponse = z.input<typeof MePermissionsResponseSchema>;
