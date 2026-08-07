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
  language: z.string().default('en').describe('Preferred language'),
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

export type AuthProvider = z.infer<typeof AuthProvider>;
export type SessionUser = z.infer<typeof SessionUserSchema>;
/** Post-parse shape of {@link SessionUser} — defaults applied, transforms run (ADR-0122). */
export type SessionUserParsed = z.infer<typeof SessionUserSchema>;
export type SessionUserInput = z.input<typeof SessionUserSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type LoginType = z.infer<typeof LoginType>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
/** Post-parse shape of {@link LoginRequest} — defaults applied, transforms run (ADR-0122). */
export type LoginRequestParsed = z.infer<typeof LoginRequestSchema>;
export type LoginRequestInput = z.input<typeof LoginRequestSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
/** Post-parse shape of {@link SessionResponse} — defaults applied, transforms run (ADR-0122). */
export type SessionResponseParsed = z.infer<typeof SessionResponseSchema>;
export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;
/** Post-parse shape of {@link UserProfileResponse} — defaults applied, transforms run (ADR-0122). */
export type UserProfileResponseParsed = z.infer<typeof UserProfileResponseSchema>;
