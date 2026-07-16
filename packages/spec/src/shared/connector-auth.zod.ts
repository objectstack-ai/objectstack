// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * SHARED CONNECTOR AUTHENTICATION SCHEMAS
 * These schemas are used by connectors and integrations for external auth.
 * They define "How we authenticate TO other systems", not "How users authenticate TO us".
 */

/**
 * OAuth2 Authentication Schema
 */
import { lazySchema } from './lazy-schema';
export const ConnectorOAuth2Schema = lazySchema(() => z.object({
  type: z.literal('oauth2'),
  authorizationUrl: z.string().url().describe('OAuth2 authorization endpoint'),
  tokenUrl: z.string().url().describe('OAuth2 token endpoint'),
  clientId: z.string().describe('OAuth2 client ID'),
  clientSecret: z.string().describe('OAuth2 client secret (typically from ENV)'),
  scopes: z.array(z.string()).optional().describe('Requested OAuth2 scopes'),
  redirectUri: z.string().url().optional().describe('OAuth2 redirect URI'),
  refreshToken: z.string().optional().describe('Refresh token for token renewal'),
  tokenExpiry: z.number().optional().describe('Token expiry timestamp'),
}));

/**
 * API Key Authentication Schema
 */
export const ConnectorAPIKeySchema = lazySchema(() => z.object({
  type: z.literal('api-key'),
  key: z.string().describe('API key value'),
  headerName: z.string().default('X-API-Key').describe('HTTP header name for API key'),
  paramName: z.string().optional().describe('Query parameter name (alternative to header)'),
}));

/**
 * Basic Authentication Schema
 */
export const ConnectorBasicAuthSchema = lazySchema(() => z.object({
  type: z.literal('basic'),
  username: z.string().describe('Username'),
  password: z.string().describe('Password'),
}));

/**
 * Bearer Token Authentication Schema
 */
export const ConnectorBearerAuthSchema = lazySchema(() => z.object({
  type: z.literal('bearer'),
  token: z.string().describe('Bearer token'),
}));

/**
 * No Authentication Schema
 */
export const ConnectorNoAuthSchema = lazySchema(() => z.object({
  type: z.literal('none'),
}));

/**
 * Unified Connector Auth Configuration Schema
 */
export const ConnectorAuthConfigSchema = lazySchema(() => z.discriminatedUnion('type', [
  ConnectorOAuth2Schema,
  ConnectorAPIKeySchema,
  ConnectorBasicAuthSchema,
  ConnectorBearerAuthSchema,
  ConnectorNoAuthSchema,
]));

export type ConnectorAuthConfig = z.infer<typeof ConnectorAuthConfigSchema>;

/**
 * The **static** subset of {@link ConnectorAuthConfig} — the open-source auth
 * tier a generic executor can apply with no token-acquisition flow (`none` /
 * `api-key` / `basic` / `bearer`). This is the shape a provider factory receives
 * *after* a declarative instance's {@link ConnectorInstanceAuth} `credentialRef`
 * has been resolved to its secret at materialization (ADR-0096). OAuth2 —
 * authorization-code/refresh lifecycle — is the enterprise tier (ADR-0015).
 */
export type ResolvedConnectorAuth = Extract<
  ConnectorAuthConfig,
  { type: 'none' | 'api-key' | 'basic' | 'bearer' }
>;

// ============================================================================
// Declarative connector-instance auth (ADR-0096)
//
// Auth for a provider-bound declarative `connectors:` entry. Unlike
// ConnectorAuthConfigSchema — the runtime shape, which carries the *resolved*
// secret inline (a plugin passes `{ type: 'bearer', token }`) — this shape
// carries a `credentialRef` **reference** that the automation service resolves
// through the secrets/env layer at boot. There is deliberately no field to
// inline a secret here: stack metadata is authored, versioned, and shipped, so
// a raw token must never live in it (ADR-0096 §3). OAuth2 is intentionally
// absent (enterprise tier, ADR-0015).
// ============================================================================

/** No authentication — the upstream is public. */
export const ConnectorInstanceNoAuthSchema = lazySchema(() => z.object({
  type: z.literal('none'),
}));

/** Bearer-token auth; the token is resolved from `credentialRef` at boot. */
export const ConnectorInstanceBearerAuthSchema = lazySchema(() => z.object({
  type: z.literal('bearer'),
  credentialRef: z.string().min(1).describe(
    'Secrets-layer reference (e.g. an env-var name in the open tier) resolved to the bearer token at materialization. Never an inline token.',
  ),
}));

/** API-key auth; the key is resolved from `credentialRef` at boot. */
export const ConnectorInstanceAPIKeyAuthSchema = lazySchema(() => z.object({
  type: z.literal('api-key'),
  credentialRef: z.string().min(1).describe(
    'Secrets-layer reference resolved to the API key at materialization. Never an inline key.',
  ),
  headerName: z.string().optional().describe('HTTP header carrying the key (default X-API-Key).'),
  paramName: z.string().optional().describe('Query parameter carrying the key (alternative to header).'),
}));

/** Basic auth; the password is resolved from `credentialRef` at boot. */
export const ConnectorInstanceBasicAuthSchema = lazySchema(() => z.object({
  type: z.literal('basic'),
  username: z.string().describe('Username (not a secret; safe to keep in metadata).'),
  credentialRef: z.string().min(1).describe(
    'Secrets-layer reference resolved to the password at materialization. Never an inline password.',
  ),
}));

/**
 * Declarative connector-instance auth: a discriminated union whose secret-bearing
 * variants carry a `credentialRef` instead of an inline secret (ADR-0096 §3).
 * Consumed by the `auth` field on a provider-bound `connectors:` entry.
 */
export const ConnectorInstanceAuthSchema = lazySchema(() => z.discriminatedUnion('type', [
  ConnectorInstanceNoAuthSchema,
  ConnectorInstanceBearerAuthSchema,
  ConnectorInstanceAPIKeyAuthSchema,
  ConnectorInstanceBasicAuthSchema,
]));

export type ConnectorInstanceAuth = z.infer<typeof ConnectorInstanceAuthSchema>;
