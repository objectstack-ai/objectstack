// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from './lazy-schema';
import { strictObject } from './strict-object';

/**
 * SHARED CONNECTOR AUTHENTICATION SCHEMAS
 * These schemas are used by connectors and integrations for external auth.
 * They define "How we authenticate TO other systems", not "How users authenticate TO us".
 *
 * ⚠️ Two shapes live here, and which one a door accepts is load-bearing (#7990):
 *
 *  - {@link ConnectorAuthConfigSchema} is the RUNTIME shape — every non-`none`
 *    variant REQUIRES its secret inline (`token` / `key` / `password`),
 *    because it describes what a provider factory receives AFTER resolution,
 *    or what a plugin hands to `registerConnector`. It must never be accepted
 *    at an authoring/publish door: a published connector row is stored whole
 *    in `sys_metadata`, so an inline secret is cleartext at rest.
 *    `DeclarativeConnectorEntrySchema` enforces that refusal on every authored
 *    entry (descriptor or instance) since #7990.
 *  - {@link ConnectorInstanceAuthSchema} is the AUTHORED shape — secret-bearing
 *    variants carry a `credentialRef` reference resolved through the
 *    secrets/env layer (ADR-0097 §3, ADR-0143 D3), never the secret.
 */

/**
 * Prescription for the retired runtime `oauth2` variant of
 * {@link ConnectorAuthConfigSchema} (ADR-0143 D7).
 *
 * The variant inlined a client secret and a refresh token, and nothing
 * consumed it: no provider factory read it (they take
 * {@link ResolvedConnectorAuth}, the four static kinds) and no authored door
 * accepted it (`DeclarativeConnectorEntrySchema` refuses any non-`none`
 * `authentication`). ADR-0143 D7 retires it rather than redefining it as a
 * resolved shape: an OAuth2 credential is a grant whose tokens are runtime
 * state, answered per dispatch (D4), so it is declared on a provider-bound
 * instance's `auth` and never handed to a connector inline.
 *
 * Like the retired view `api` data source this retires a VALUE of the
 * discriminator, not a key, so there is no `retiredKey()` tombstone to hang
 * the prescription on: the union's own `error` map carries it, keyed on
 * `input.type === 'oauth2'`, and every other unknown discriminator keeps zod's
 * default report. The D3 semantic entry
 * `connector-auth-config-oauth2-retired` carries the judgement an upgrader
 * owes; there is no D2 conversion, because the replacement lives on another
 * surface and needs a secret moved out of the source.
 */
const CONNECTOR_AUTH_CONFIG_OAUTH2_RETIRED =
  "`authentication: { type: 'oauth2' }` was removed in @objectstack/spec 18 (ADR-0143 D7) — the runtime "
  + 'variant inlined a client secret and a refresh token and no provider ever read it, so a connector that '
  + 'declared it was dispatched without the credential. Declare the connector as a provider-bound instance '
  + "(`provider: 'openapi' | 'rest' | 'mcp'`) with `auth: { type: 'oauth2', grant, tokenUrl, clientId, "
  + "credentialRef, ... }`, where `credentialRef` names the client secret in the secrets layer, and set "
  + "`authentication` to `{ type: 'none' }` or drop it. The platform obtains, stores and refreshes the "
  + 'tokens itself; a refresh token never appears in a definition.';

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
  // The `oauth2` variant (`ConnectorOAuth2Schema`) was REMOVED here (ADR-0143
  // D7); see `CONNECTOR_AUTH_CONFIG_OAUTH2_RETIRED` above for what replaces it
  // and the `error` map below for how an author meets it.
  ConnectorAPIKeySchema,
  ConnectorBasicAuthSchema,
  ConnectorBearerAuthSchema,
  ConnectorNoAuthSchema,
], {
  // The retired variant's prescription, raised at `type` for exactly the
  // spelling that used to be legal; a literal comparison, so any other unknown
  // value meets zod's own report listing the live variants.
  error: (issue) => {
    const input = issue.input;
    return typeof input === 'object' && input !== null
      && (input as { type?: unknown }).type === 'oauth2'
      ? CONNECTOR_AUTH_CONFIG_OAUTH2_RETIRED
      : undefined;
  },
}));

export type ConnectorAuthConfig = z.input<typeof ConnectorAuthConfigSchema>;
/** Post-parse shape of {@link ConnectorAuthConfig} — defaults applied, transforms run (ADR-0122). */
export type ConnectorAuthConfigParsed = z.infer<typeof ConnectorAuthConfigSchema>;

/**
 * The **static** subset of {@link ConnectorAuthConfig} — what a generic
 * executor can apply with no token-acquisition flow (`none` / `api-key` /
 * `basic` / `bearer`). This is the shape a provider factory receives *after* a
 * declarative instance's {@link ConnectorInstanceAuth} `credentialRef` has been
 * resolved to its secret at materialization (ADR-0097).
 *
 * It stays the four static kinds (ADR-0143 D4): the grant-bearing kinds
 * (`oauth2`, `app-credential`) are not resolved once at materialization but
 * per dispatch, and reach a provider as the `credentialHandle` member of
 * `ConnectorProviderContext`, never as a value of this type.
 */
export type ResolvedConnectorAuth = Extract<
  ConnectorAuthConfig,
  { type: 'none' | 'api-key' | 'basic' | 'bearer' }
>;

// ============================================================================
// Declarative connector-instance auth (ADR-0097)
//
// Auth for a provider-bound declarative `connectors:` entry. Unlike
// ConnectorAuthConfigSchema — the runtime shape, which carries the *resolved*
// secret inline (a plugin passes `{ type: 'bearer', token }`) — this shape
// carries a `credentialRef` **reference** that the automation service resolves
// through the secrets/env layer. There is deliberately no field to inline a
// secret here: stack metadata is authored, versioned, and shipped, so a raw
// token must never live in it (ADR-0097 §3, ADR-0143 D3).
//
// The four static kinds resolve once, at materialization. The two grant-bearing
// kinds ADR-0143 D2 adds — `oauth2` (D2.1) and `app-credential` (D2.2) — are
// open tier (ADR-0143 D1, which reverses the enterprise placement ADR-0097 §3
// recorded) and resolve per dispatch (D4): their tokens are runtime state in a
// connection record, never metadata. The third D2 kind, `signed`, enters this
// union only with its signers and test vectors (D2.3).
// ============================================================================

/** No authentication — the upstream is public. */
export const ConnectorInstanceNoAuthSchema = lazySchema(() => z.object({
  type: z.literal('none'),
}));
export type ConnectorInstanceNoAuth = z.input<typeof ConnectorInstanceNoAuthSchema>;

/** Bearer-token auth; the token is resolved from `credentialRef` when the instance materializes. */
export const ConnectorInstanceBearerAuthSchema = lazySchema(() => z.object({
  type: z.literal('bearer'),
  credentialRef: z.string().min(1).describe(
    'Secrets-layer reference (e.g. an env-var name in the open tier) resolved to the bearer token at materialization. Never an inline token.',
  ),
}));
export type ConnectorInstanceBearerAuth = z.input<typeof ConnectorInstanceBearerAuthSchema>;

/** API-key auth; the key is resolved from `credentialRef` when the instance materializes. */
export const ConnectorInstanceAPIKeyAuthSchema = lazySchema(() => z.object({
  type: z.literal('api-key'),
  credentialRef: z.string().min(1).describe(
    'Secrets-layer reference resolved to the API key at materialization. Never an inline key.',
  ),
  headerName: z.string().optional().describe('HTTP header carrying the key (default X-API-Key).'),
  paramName: z.string().optional().describe('Query parameter carrying the key (alternative to header).'),
}));
export type ConnectorInstanceAPIKeyAuth = z.input<typeof ConnectorInstanceAPIKeyAuthSchema>;

/** Basic auth; the password is resolved from `credentialRef` when the instance materializes. */
export const ConnectorInstanceBasicAuthSchema = lazySchema(() => z.object({
  type: z.literal('basic'),
  username: z.string().describe('Username (not a secret; safe to keep in metadata).'),
  credentialRef: z.string().min(1).describe(
    'Secrets-layer reference resolved to the password at materialization. Never an inline password.',
  ),
}));
export type ConnectorInstanceBasicAuth = z.input<typeof ConnectorInstanceBasicAuthSchema>;

/**
 * The guidance an inline secret meets on a grant-bearing instance kind: the
 * strict shape refuses the key by name and sends the author to
 * `credentialRef` (ADR-0143 D3 / Acceptance: "an inline secret on any variant
 * is refused at publish with a located error").
 */
function inlineSecretGuidance(kind: string, secret: string): string {
  return `Not authorable on \`auth: { type: '${kind}' }\`. The ${secret} is a credential, and a connector `
    + 'definition is stored whole and shipped with the app — put the value in the secrets layer (an '
    + 'environment variable in the open tier) and name it with `credentialRef`.';
}

/**
 * The tokens a grant mints are runtime state (ADR-0143 D3), so an author who
 * writes one into the definition is told where it comes from instead.
 */
function runtimeTokenGuidance(kind: string): string {
  return `Not authorable on \`auth: { type: '${kind}' }\`. Tokens are obtained, refreshed and stored by `
    + 'the platform at run time (the access token in memory, a refresh token encrypted in the connection '
    + 'record) and never appear in a connector definition. Delete the key.';
}

/**
 * The RFC 6749 grants an `oauth2` instance may declare (ADR-0143 D2.1). Closed:
 * a new grant is a spec change together with its implementation, never a
 * free-form value (Prime Directive #12).
 */
export const ConnectorOAuth2GrantSchema = z.enum(['authorization_code', 'client_credentials'])
  .describe('OAuth2 grant (RFC 6749): `authorization_code` (an administrator connects once; PKCE S256 always) or `client_credentials` (no user step).');
export type ConnectorOAuth2Grant = z.infer<typeof ConnectorOAuth2GrantSchema>;

/**
 * OAuth2 auth for a provider-bound instance (ADR-0143 D2.1).
 *
 * Carries what the grant needs and no secret: the client secret is a
 * `credentialRef`; the access token, a refresh token and a dynamically
 * registered client are runtime state in the instance's connection record
 * (D3), obtained and refreshed per dispatch (D4). `authorization_code` always
 * uses PKCE with `S256` — there is deliberately no switch to turn it off.
 *
 * Which keys are required depends on where the instance points, so two rules
 * live elsewhere:
 *  - Here, the rules that hold for every instance: `client_credentials` has no
 *    authorization step (no `authorizationUrl`) and is only for a confidential
 *    client (RFC 6749 §4.4, so `credentialRef` is required beside `clientId`);
 *    and a client secret belongs to a pre-registered `clientId`.
 *  - On `DeclarativeConnectorEntrySchema`, the rule that needs the instance's
 *    provider: `tokenUrl`, `clientId` and (for `authorization_code`)
 *    `authorizationUrl` are required, except on `provider: 'mcp'` over an http
 *    transport, where the provider discovers the endpoints and registers a
 *    client through the MCP authorization flow.
 *
 * How a pre-registered client authenticates at the token endpoint
 * (`client_secret_basic` or `client_secret_post`) is not a key here: D2.1
 * lists what the variant carries, and a client registered dynamically is
 * assigned its method by the registration. The server slice that runs the
 * grant owns that choice.
 */
export const ConnectorInstanceOAuth2AuthSchema = lazySchema(() => strictObject({
  surface: "this `oauth2` connector auth",
  history: 'This shape is strict from birth — the `oauth2` instance kind had no earlier spelling, so an unknown key here was never accepted.',
  guidance: {
    clientSecret: inlineSecretGuidance('oauth2', 'client secret'),
    secret: inlineSecretGuidance('oauth2', 'client secret'),
    accessToken: runtimeTokenGuidance('oauth2'),
    refreshToken: runtimeTokenGuidance('oauth2'),
    token: runtimeTokenGuidance('oauth2'),
    pkce: 'Not authorable. `authorization_code` always uses PKCE with S256 (ADR-0143 D2.1); there is no switch. Delete the key.',
  },
  // A different word for the same intent, out of reach of edit distance.
  aliases: { audience: 'resource' },
}, {
  type: z.literal('oauth2'),
  grant: ConnectorOAuth2GrantSchema,
  authorizationUrl: z.string().url().optional().describe(
    'Authorization endpoint. Required for `authorization_code` (except `provider: \'mcp\'` over http, which discovers it); refused on `client_credentials`.',
  ),
  tokenUrl: z.string().url().optional().describe(
    'Token endpoint. Required (except `provider: \'mcp\'` over http, which discovers it).',
  ),
  scopes: z.array(z.string().min(1)).optional().describe('Scopes to request; sent space-separated.'),
  resource: z.string().url().optional().describe(
    'Resource indicator (RFC 8707) — the API the token is for, where the authorization server asks for one (some call it the audience).',
  ),
  clientId: z.string().min(1).optional().describe(
    'OAuth2 client id (not a secret). Required (except `provider: \'mcp\'` over http, where the provider may register a client dynamically).',
  ),
  credentialRef: z.string().min(1).optional().describe(
    'Secrets-layer reference resolved to the client secret. Omit only for a public client; required for `client_credentials`. Never an inline secret.',
  ),
}).superRefine((auth, ctx) => {
  if (auth.grant === 'client_credentials' && auth.authorizationUrl !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['authorizationUrl'],
      message: '`authorizationUrl` is refused on `grant: \'client_credentials\'` — that grant has no authorization step; the client exchanges its credentials at `tokenUrl` directly. Delete the key, or use `grant: \'authorization_code\'` if an administrator should connect the instance.',
    });
  }
  if (auth.credentialRef !== undefined && auth.clientId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['credentialRef'],
      message: 'A client secret belongs to a pre-registered client: declare its `clientId` beside `credentialRef`, or omit both on `provider: \'mcp\'` over http to let the provider register a client.',
    });
  }
  if (auth.grant === 'client_credentials' && auth.clientId !== undefined && auth.credentialRef === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['credentialRef'],
      message: '`grant: \'client_credentials\'` is only for a confidential client (RFC 6749 §4.4): name the client secret with `credentialRef`.',
    });
  }
}));
export type ConnectorInstanceOAuth2Auth = z.input<typeof ConnectorInstanceOAuth2AuthSchema>;

/**
 * The vendors whose app-credential exchange the platform implements (ADR-0143
 * D2.2). Closed: each value names one exchange — the token endpoint, its
 * request and response, where the token rides on the outgoing call —
 * implemented and tested in the shared transport, so nothing about it is
 * authored. A new vendor is a spec change together with its exchange.
 */
export const ConnectorAppCredentialVendorSchema = z.enum(['feishu', 'dingtalk', 'wecom'])
  .describe('Vendor whose app-credential token exchange to run: `feishu`, `dingtalk` or `wecom`.');
export type ConnectorAppCredentialVendor = z.infer<typeof ConnectorAppCredentialVendorSchema>;

/**
 * Vendor app-credential auth for a provider-bound instance (ADR-0143 D2.2):
 * the non-interactive exchange of an app id and secret for a short-lived access
 * token, which is not an RFC 6749 grant. The app secret is a `credentialRef`;
 * the token is runtime state, re-derived from the secret whenever it expires
 * (D3, D4).
 */
export const ConnectorInstanceAppCredentialAuthSchema = lazySchema(() => strictObject({
  surface: "this `app-credential` connector auth",
  history: 'This shape is strict from birth — the `app-credential` instance kind had no earlier spelling, so an unknown key here was never accepted.',
  guidance: {
    appSecret: inlineSecretGuidance('app-credential', 'app secret'),
    secret: inlineSecretGuidance('app-credential', 'app secret'),
    corpSecret: inlineSecretGuidance('app-credential', 'app secret'),
    accessToken: runtimeTokenGuidance('app-credential'),
    token: runtimeTokenGuidance('app-credential'),
  },
  // The vendors' own words for the app id: Feishu's `app_id`, DingTalk's
  // `appKey` / `clientId`, WeCom's `corpId`.
  aliases: { appKey: 'appId', corpId: 'appId', clientId: 'appId' },
}, {
  type: z.literal('app-credential'),
  vendor: ConnectorAppCredentialVendorSchema,
  appId: z.string().min(1).describe(
    "The vendor's app identifier (not a secret): Feishu `app_id`, DingTalk `appKey`, WeCom `corpid`.",
  ),
  credentialRef: z.string().min(1).describe(
    'Secrets-layer reference resolved to the app secret (WeCom: the application `corpsecret`). Never an inline secret.',
  ),
}));
export type ConnectorInstanceAppCredentialAuth = z.input<typeof ConnectorInstanceAppCredentialAuthSchema>;

/**
 * Declarative connector-instance auth: a discriminated union whose secret-bearing
 * variants carry a `credentialRef` instead of an inline secret (ADR-0097 §3,
 * ADR-0143 D3). Consumed by the `auth` field on a provider-bound `connectors:`
 * entry. Closed: an unknown `type` is refused at publish.
 */
export const ConnectorInstanceAuthSchema = lazySchema(() => z.discriminatedUnion('type', [
  ConnectorInstanceNoAuthSchema,
  ConnectorInstanceBearerAuthSchema,
  ConnectorInstanceAPIKeyAuthSchema,
  ConnectorInstanceBasicAuthSchema,
  ConnectorInstanceOAuth2AuthSchema,
  ConnectorInstanceAppCredentialAuthSchema,
]));

export type ConnectorInstanceAuth = z.input<typeof ConnectorInstanceAuthSchema>;
