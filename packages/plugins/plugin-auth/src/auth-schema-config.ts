// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SystemObjectName } from '@objectstack/spec/system';

/**
 * better-auth ↔ ObjectStack Schema Mapping
 *
 * better-auth uses camelCase field names internally (e.g. `emailVerified`, `userId`)
 * while ObjectStack's protocol layer uses snake_case (e.g. `email_verified`, `user_id`).
 *
 * These constants declare the `modelName` and `fields` mappings for each core auth
 * model, following better-auth's official schema customisation API
 * ({@link https://www.better-auth.com/docs/concepts/database}).
 *
 * The mappings serve two purposes:
 * 1. `modelName` — maps the default model name to the ObjectStack protocol name
 *    (e.g. `user` → `sys_user`).
 * 2. `fields`   — maps camelCase field names to their snake_case database column
 *    equivalents. Only fields whose names differ need to be listed; fields that
 *    are already identical (e.g. `email`, `name`, `token`) are omitted.
 *
 * These mappings are consumed by:
 * - The `betterAuth()` configuration in {@link AuthManager} so that
 *   `getAuthTables()` builds the correct schema.
 * - The ObjectQL adapter factory (via `createAdapterFactory`) which uses the
 *   schema to transform data and where-clauses automatically.
 */

// ---------------------------------------------------------------------------
// User model
// ---------------------------------------------------------------------------

/**
 * better-auth `user` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | emailVerified           | email_verified           |
 * | createdAt               | created_at               |
 * | updatedAt               | updated_at               |
 */
export const AUTH_USER_CONFIG = {
  modelName: SystemObjectName.USER, // 'sys_user'
  fields: {
    emailVerified: 'email_verified',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Session model
// ---------------------------------------------------------------------------

/**
 * better-auth `session` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | userId                  | user_id                  |
 * | expiresAt               | expires_at               |
 * | createdAt               | created_at               |
 * | updatedAt               | updated_at               |
 * | ipAddress               | ip_address               |
 * | userAgent               | user_agent               |
 */
export const AUTH_SESSION_CONFIG = {
  modelName: SystemObjectName.SESSION, // 'sys_session'
  fields: {
    userId: 'user_id',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    ipAddress: 'ip_address',
    userAgent: 'user_agent',
  },
} as const;

// ---------------------------------------------------------------------------
// Account model
// ---------------------------------------------------------------------------

/**
 * better-auth `account` model mapping.
 *
 * | camelCase (better-auth)   | snake_case (ObjectStack)       |
 * |:--------------------------|:-------------------------------|
 * | userId                    | user_id                        |
 * | providerId                | provider_id                    |
 * | accountId                 | account_id                     |
 * | accessToken               | access_token                   |
 * | refreshToken              | refresh_token                  |
 * | idToken                   | id_token                       |
 * | accessTokenExpiresAt      | access_token_expires_at        |
 * | refreshTokenExpiresAt     | refresh_token_expires_at       |
 * | createdAt                 | created_at                     |
 * | updatedAt                 | updated_at                     |
 */
export const AUTH_ACCOUNT_CONFIG = {
  modelName: SystemObjectName.ACCOUNT, // 'sys_account'
  fields: {
    userId: 'user_id',
    providerId: 'provider_id',
    accountId: 'account_id',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    idToken: 'id_token',
    accessTokenExpiresAt: 'access_token_expires_at',
    refreshTokenExpiresAt: 'refresh_token_expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Verification model
// ---------------------------------------------------------------------------

/**
 * better-auth `verification` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | expiresAt               | expires_at               |
 * | createdAt               | created_at               |
 * | updatedAt               | updated_at               |
 */
export const AUTH_VERIFICATION_CONFIG = {
  modelName: SystemObjectName.VERIFICATION, // 'sys_verification'
  fields: {
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

// ===========================================================================
// Plugin Table Mappings
// ===========================================================================
//
// better-auth plugins (organization, two-factor, etc.) introduce additional
// tables with their own camelCase field names.  The mappings below are passed
// to the plugin's `schema` option so that `createAdapterFactory` transforms
// them to snake_case automatically, just like the core models above.
// ===========================================================================

// ---------------------------------------------------------------------------
// Organization plugin – organization table
// ---------------------------------------------------------------------------

/**
 * better-auth Organization plugin `organization` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | createdAt               | created_at               |
 * | updatedAt               | updated_at               |
 */
export const AUTH_ORGANIZATION_SCHEMA = {
  modelName: SystemObjectName.ORGANIZATION, // 'sys_organization'
  fields: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Organization plugin – member table
// ---------------------------------------------------------------------------

/**
 * better-auth Organization plugin `member` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | organizationId          | organization_id          |
 * | userId                  | user_id                  |
 * | createdAt               | created_at               |
 */
export const AUTH_MEMBER_SCHEMA = {
  modelName: SystemObjectName.MEMBER, // 'sys_member'
  fields: {
    organizationId: 'organization_id',
    userId: 'user_id',
    createdAt: 'created_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Organization plugin – invitation table
// ---------------------------------------------------------------------------

/**
 * better-auth Organization plugin `invitation` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | organizationId          | organization_id          |
 * | inviterId               | inviter_id               |
 * | expiresAt               | expires_at               |
 * | createdAt               | created_at               |
 * | teamId                  | team_id                  |
 */
export const AUTH_INVITATION_SCHEMA = {
  modelName: SystemObjectName.INVITATION, // 'sys_invitation'
  fields: {
    organizationId: 'organization_id',
    inviterId: 'inviter_id',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    teamId: 'team_id',
  },
} as const;

// ---------------------------------------------------------------------------
// Organization plugin – session additional fields
// ---------------------------------------------------------------------------

/**
 * Organization plugin adds `activeOrganizationId` (and optionally
 * `activeTeamId`) to the session model. These field mappings are
 * injected via the organization plugin's `schema.session.fields`.
 */
export const AUTH_ORG_SESSION_FIELDS = {
  activeOrganizationId: 'active_organization_id',
  activeTeamId: 'active_team_id',
} as const;

// ---------------------------------------------------------------------------
// Organization plugin – team table (optional, when teams enabled)
// ---------------------------------------------------------------------------

/**
 * better-auth Organization plugin `team` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | organizationId          | organization_id          |
 * | createdAt               | created_at               |
 * | updatedAt               | updated_at               |
 */
export const AUTH_TEAM_SCHEMA = {
  modelName: SystemObjectName.TEAM, // 'sys_team'
  fields: {
    organizationId: 'organization_id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Organization plugin – teamMember table (optional, when teams enabled)
// ---------------------------------------------------------------------------

/**
 * better-auth Organization plugin `teamMember` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | teamId                  | team_id                  |
 * | userId                  | user_id                  |
 * | createdAt               | created_at               |
 */
export const AUTH_TEAM_MEMBER_SCHEMA = {
  modelName: SystemObjectName.TEAM_MEMBER, // 'sys_team_member'
  fields: {
    teamId: 'team_id',
    userId: 'user_id',
    createdAt: 'created_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Two-Factor plugin – twoFactor table
// ---------------------------------------------------------------------------

/**
 * better-auth Two-Factor plugin `twoFactor` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | backupCodes             | backup_codes             |
 * | userId                  | user_id                  |
 */
export const AUTH_TWO_FACTOR_SCHEMA = {
  modelName: SystemObjectName.TWO_FACTOR, // 'sys_two_factor'
  fields: {
    backupCodes: 'backup_codes',
    userId: 'user_id',
  },
} as const;

/**
 * Two-Factor plugin adds a `twoFactorEnabled` field to the user model.
 */
export const AUTH_TWO_FACTOR_USER_FIELDS = {
  twoFactorEnabled: 'two_factor_enabled',
} as const;

// ---------------------------------------------------------------------------
// Admin plugin – user/session field additions
// ---------------------------------------------------------------------------

/**
 * Admin plugin adds platform-level admin fields to the `user` model.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | banReason               | ban_reason               |
 * | banExpires              | ban_expires              |
 *
 * `role` and `banned` already have matching snake_case names and are
 * therefore omitted from this mapping (better-auth's database hooks
 * read them by the auto-derived column names).
 */
export const AUTH_ADMIN_USER_FIELDS = {
  banReason: 'ban_reason',
  banExpires: 'ban_expires',
} as const;

/**
 * Admin plugin adds an `impersonatedBy` field to the session model
 * recording the operator user id when an admin impersonates someone.
 */
export const AUTH_ADMIN_SESSION_FIELDS = {
  impersonatedBy: 'impersonated_by',
} as const;

// ---------------------------------------------------------------------------
// OAuth Provider plugin – oauthClient table
// ---------------------------------------------------------------------------

/**
 * `@better-auth/oauth-provider` plugin `oauthClient` model mapping.
 *
 * The model name (`oauthClient`) is mapped to the existing
 * `sys_oauth_application` table to preserve data continuity from the
 * deprecated `oidc-provider` plugin.
 *
 * | camelCase (better-auth)    | snake_case (ObjectStack)        |
 * |:---------------------------|:--------------------------------|
 * | clientId                   | client_id                       |
 * | clientSecret               | client_secret                   |
 * | skipConsent                | skip_consent                    |
 * | enableEndSession           | enable_end_session              |
 * | subjectType                | subject_type                    |
 * | userId                     | user_id                         |
 * | createdAt                  | created_at                      |
 * | updatedAt                  | updated_at                      |
 * | redirectUris               | redirect_uris                   |
 * | postLogoutRedirectUris     | post_logout_redirect_uris       |
 * | tokenEndpointAuthMethod    | token_endpoint_auth_method      |
 * | grantTypes                 | grant_types                     |
 * | responseTypes              | response_types                  |
 * | requirePKCE                | require_pkce                    |
 * | softwareId                 | software_id                     |
 * | softwareVersion            | software_version                |
 * | softwareStatement          | software_statement              |
 * | referenceId                | reference_id                    |
 */
export const AUTH_OAUTH_CLIENT_SCHEMA = {
  modelName: SystemObjectName.OAUTH_APPLICATION, // 'sys_oauth_application'
  fields: {
    clientId: 'client_id',
    clientSecret: 'client_secret',
    skipConsent: 'skip_consent',
    enableEndSession: 'enable_end_session',
    subjectType: 'subject_type',
    userId: 'user_id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    redirectUris: 'redirect_uris',
    postLogoutRedirectUris: 'post_logout_redirect_uris',
    tokenEndpointAuthMethod: 'token_endpoint_auth_method',
    grantTypes: 'grant_types',
    responseTypes: 'response_types',
    requirePKCE: 'require_pkce',
    softwareId: 'software_id',
    softwareVersion: 'software_version',
    softwareStatement: 'software_statement',
    referenceId: 'reference_id',
  },
} as const;

/**
 * @deprecated Use {@link AUTH_OAUTH_CLIENT_SCHEMA}. Retained as an alias for
 * historical imports; the new package renamed `oauthApplication` → `oauthClient`.
 */
export const AUTH_OAUTH_APPLICATION_SCHEMA = AUTH_OAUTH_CLIENT_SCHEMA;

// ---------------------------------------------------------------------------
// OAuth Provider plugin – oauthAccessToken table
// ---------------------------------------------------------------------------

/**
 * `@better-auth/oauth-provider` plugin `oauthAccessToken` model mapping.
 *
 * In the new package, access tokens and refresh tokens are stored in
 * **separate** models. `oauthAccessToken` no longer carries a refresh token;
 * see {@link AUTH_OAUTH_REFRESH_TOKEN_SCHEMA} for the companion model.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | clientId                | client_id                |
 * | sessionId               | session_id               |
 * | userId                  | user_id                  |
 * | referenceId             | reference_id             |
 * | refreshId               | refresh_id               |
 * | expiresAt               | expires_at               |
 * | createdAt               | created_at               |
 */
export const AUTH_OAUTH_ACCESS_TOKEN_SCHEMA = {
  modelName: SystemObjectName.OAUTH_ACCESS_TOKEN, // 'sys_oauth_access_token'
  fields: {
    clientId: 'client_id',
    sessionId: 'session_id',
    userId: 'user_id',
    referenceId: 'reference_id',
    refreshId: 'refresh_id',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
  },
} as const;

// ---------------------------------------------------------------------------
// OAuth Provider plugin – oauthRefreshToken table
// ---------------------------------------------------------------------------

/**
 * `@better-auth/oauth-provider` plugin `oauthRefreshToken` model mapping.
 *
 * Refresh tokens are linked to a session (via `session_id`) and to the
 * issuing client. Each access token rotation produces a new refresh-token
 * row.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | clientId                | client_id                |
 * | sessionId               | session_id               |
 * | userId                  | user_id                  |
 * | referenceId             | reference_id             |
 * | expiresAt               | expires_at               |
 * | createdAt               | created_at               |
 * | authTime                | auth_time                |
 */
export const AUTH_OAUTH_REFRESH_TOKEN_SCHEMA = {
  modelName: SystemObjectName.OAUTH_REFRESH_TOKEN, // 'sys_oauth_refresh_token'
  fields: {
    clientId: 'client_id',
    sessionId: 'session_id',
    userId: 'user_id',
    referenceId: 'reference_id',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    authTime: 'auth_time',
  },
} as const;

// ---------------------------------------------------------------------------
// OAuth Provider plugin – oauthConsent table
// ---------------------------------------------------------------------------

/**
 * `@better-auth/oauth-provider` plugin `oauthConsent` model mapping.
 *
 * The new package dropped the boolean `consentGiven` flag — the presence of
 * a row implies consent was given for the listed scopes. A new
 * `referenceId` column was added for client-supplied correlation.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | clientId                | client_id                |
 * | userId                  | user_id                  |
 * | referenceId             | reference_id             |
 * | createdAt               | created_at               |
 * | updatedAt               | updated_at               |
 */
export const AUTH_OAUTH_CONSENT_SCHEMA = {
  modelName: SystemObjectName.OAUTH_CONSENT, // 'sys_oauth_consent'
  fields: {
    clientId: 'client_id',
    userId: 'user_id',
    referenceId: 'reference_id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Device Authorization plugin – deviceCode table
// ---------------------------------------------------------------------------

/**
 * better-auth `device-authorization` plugin `deviceCode` model mapping.
 *
 * Implements RFC 8628 (OAuth 2.0 Device Authorization Grant). Stores
 * pending device-flow requests issued via `POST /device/code`, polled at
 * `POST /device/token`, and approved/denied via `POST /device/{approve,deny}`.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | deviceCode              | device_code              |
 * | userCode                | user_code                |
 * | userId                  | user_id                  |
 * | expiresAt               | expires_at               |
 * | lastPolledAt            | last_polled_at           |
 * | pollingInterval         | polling_interval         |
 * | clientId                | client_id                |
 */
export const AUTH_DEVICE_CODE_SCHEMA = {
  modelName: SystemObjectName.DEVICE_CODE, // 'sys_device_code'
  fields: {
    deviceCode: 'device_code',
    userCode: 'user_code',
    userId: 'user_id',
    expiresAt: 'expires_at',
    lastPolledAt: 'last_polled_at',
    pollingInterval: 'polling_interval',
    clientId: 'client_id',
  },
} as const;

/**
 * Builds the `schema` option for better-auth's `twoFactor()` plugin.
 *
 * @returns An object suitable for `twoFactor({ schema: … })`
 */
export function buildTwoFactorPluginSchema() {
  return {
    twoFactor: AUTH_TWO_FACTOR_SCHEMA,
    user: {
      fields: AUTH_TWO_FACTOR_USER_FIELDS,
    },
  };
}

/**
 * Builds the `schema` option for better-auth's `admin()` plugin.
 *
 * The admin plugin extends the user model with `role`/`banned`/`banReason`/
 * `banExpires` and the session model with `impersonatedBy`. Only the
 * snake_case-differing fields are mapped explicitly.
 */
export function buildAdminPluginSchema() {
  return {
    user: {
      fields: AUTH_ADMIN_USER_FIELDS,
    },
    session: {
      fields: AUTH_ADMIN_SESSION_FIELDS,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: build organization plugin schema option
// ---------------------------------------------------------------------------

/**
 * Builds the `schema` option for better-auth's `organization()` plugin.
 *
 * The organization plugin accepts a `schema` sub-option that allows
 * customising model names and field names for each table it manages.
 * This helper assembles the correct snake_case mappings from the
 * individual `AUTH_*_SCHEMA` constants above.
 *
 * @returns An object suitable for `organization({ schema: … })`
 */
export function buildOrganizationPluginSchema() {
  return {
    organization: AUTH_ORGANIZATION_SCHEMA,
    member: AUTH_MEMBER_SCHEMA,
    invitation: AUTH_INVITATION_SCHEMA,
    team: AUTH_TEAM_SCHEMA,
    teamMember: AUTH_TEAM_MEMBER_SCHEMA,
    session: {
      fields: AUTH_ORG_SESSION_FIELDS,
    },
  };
}

// ---------------------------------------------------------------------------
// JWT plugin – jwks table
// ---------------------------------------------------------------------------

/**
 * better-auth `jwt` plugin `jwks` model mapping.
 *
 * The JWT plugin maintains a small set of rotating asymmetric key pairs
 * used to sign and verify issued JWTs (id_tokens for OIDC, JWT access
 * tokens). It is required by the `@better-auth/oauth-provider` plugin.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | publicKey               | public_key               |
 * | privateKey              | private_key              |
 * | createdAt               | created_at               |
 * | expiresAt               | expires_at               |
 */
export const AUTH_JWKS_SCHEMA = {
  modelName: SystemObjectName.JWKS, // 'sys_jwks'
  fields: {
    publicKey: 'public_key',
    privateKey: 'private_key',
    createdAt: 'created_at',
    expiresAt: 'expires_at',
  },
} as const;

/**
 * Builds the `schema` option for better-auth's `jwt()` plugin.
 *
 * @returns An object suitable for `jwt({ schema: … })`
 */
export function buildJwtPluginSchema() {
  return {
    jwks: AUTH_JWKS_SCHEMA,
  };
}

// ---------------------------------------------------------------------------
// Helper: build OAuth provider plugin schema option
// ---------------------------------------------------------------------------

/**
 * Builds the `schema` option for `@better-auth/oauth-provider`'s
 * `oauthProvider()` plugin.
 *
 * The plugin manages four tables: `oauthClient` (registered client apps —
 * mapped to ObjectStack's `sys_oauth_application` table for backwards
 * compatibility), `oauthAccessToken` (issued access tokens),
 * `oauthRefreshToken` (issued refresh tokens, linked to a session), and
 * `oauthConsent` (recorded user consents).
 *
 * @returns An object suitable for `oauthProvider({ schema: … })`
 */
export function buildOauthProviderPluginSchema() {
  return {
    oauthClient: AUTH_OAUTH_CLIENT_SCHEMA,
    oauthAccessToken: AUTH_OAUTH_ACCESS_TOKEN_SCHEMA,
    oauthRefreshToken: AUTH_OAUTH_REFRESH_TOKEN_SCHEMA,
    oauthConsent: AUTH_OAUTH_CONSENT_SCHEMA,
  };
}

/**
 * @deprecated Use {@link buildOauthProviderPluginSchema}. Retained as an
 * alias for callers that imported the previous name during the migration
 * from the deprecated `better-auth/plugins/oidc-provider` plugin.
 */
export const buildOidcProviderPluginSchema = buildOauthProviderPluginSchema;

// ---------------------------------------------------------------------------
// SSO plugin – ssoProvider table (@better-auth/sso)
// ---------------------------------------------------------------------------

/**
 * `@better-auth/sso` plugin `ssoProvider` model mapping.
 *
 * Each row is an external OIDC/SAML IdP this environment federates login to
 * (the relying-party side — ADR-0024's OPEN per-env SSO mechanism). The
 * protocol detail lives in JSON blobs (`oidcConfig` / `samlConfig`); the model
 * itself is thin. Mirrors @better-auth/sso@1.6.20's `BaseSSOProvider`.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | providerId              | provider_id              |
 * | oidcConfig              | oidc_config              |
 * | samlConfig              | saml_config              |
 * | userId                  | user_id                  |
 * | organizationId          | organization_id          |
 * | issuer / domain         | (same name — no remap) |
 */
export const AUTH_SSO_PROVIDER_SCHEMA = {
  modelName: 'sys_sso_provider',
  fields: {
    providerId: 'provider_id',
    oidcConfig: 'oidc_config',
    samlConfig: 'saml_config',
    userId: 'user_id',
    organizationId: 'organization_id',
  },
} as const;

// NOTE: there is intentionally no `buildSsoPluginSchema()`. Unlike
// `oauthProvider`, the @better-auth/sso plugin exposes NO `schema` option
// (verified vs 1.6.20), so the mapping above cannot be handed to the plugin —
// it must be consumed at the ADAPTER layer (AUTH_MODEL_TO_PROTOCOL + field
// resolution in objectql-adapter.ts). See ADR-0024.

// ---------------------------------------------------------------------------
// Helper: build device-authorization plugin schema option
// ---------------------------------------------------------------------------

/**
 * Builds the `schema` option for better-auth's `deviceAuthorization()` plugin.
 *
 * The plugin manages a single `deviceCode` table tracking pending RFC 8628
 * device-flow requests. This helper returns the snake_case mappings that
 * point the plugin at ObjectStack's `sys_device_code` object.
 *
 * @returns An object suitable for `deviceAuthorization({ schema: … })`
 */
export function buildDeviceAuthorizationPluginSchema() {
  return {
    deviceCode: AUTH_DEVICE_CODE_SCHEMA,
  };
}
