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
 * | issuer                    | issuer                         |
 * | accountId                 | account_id                     |
 * | accessToken               | access_token                   |
 * | refreshToken              | refresh_token                  |
 * | idToken                   | id_token                       |
 * | accessTokenExpiresAt      | access_token_expires_at        |
 * | refreshTokenExpiresAt     | refresh_token_expires_at       |
 * | createdAt                 | created_at                     |
 * | updatedAt                 | updated_at                     |
 *
 * better-auth 1.7 restructured account identity by adding a REQUIRED `issuer`
 * naming the authority that vouched for the account id. Every account lookup
 * keys on (issuer, accountId) — `findAccountByKey` / `findAccountOwnerByKey`
 * filter on `issuer` — so an unmapped or unstamped `issuer` means sign-in
 * finds no account at all.
 *
 * ⚠️ THE FIELD NAME FLIP-FLOPPED ACROSS THE 1.7 PRE-RELEASES, so read it off
 * the installed version, never off memory. `1.7.0-rc.2` renamed `accountId` →
 * `providerAccountId`; **stable `1.7.0`/`1.7.1` renamed it BACK to
 * `accountId`** while keeping `issuer`. Measured on the installed 1.7.1:
 * `getAuthTables({}).account.fields` is
 * `issuer, accountId, providerId, userId, …` — no `providerAccountId` at all.
 * Carrying the rc.2 spelling into the stable line left `accountId` unmapped,
 * so the adapter asked for a column named `accountId` and every sign-up
 * answered 500 `Unknown field 'accountId' on object 'sys_account'` (#3002).
 * `better-auth-schema-parity.test.ts` is the gate that catches exactly this.
 *
 * `accountId` keeps the existing `account_id` column: same value throughout
 * the rename round-trip, so no data ever moved. `issuer` is a new column,
 * stamped on legacy rows by backfillAccountIssuer() at boot (see
 * backfill-account-issuer.ts) with the synthetic issuers better-auth mints
 * itself: `local:credential` for password accounts and
 * `local:oauth:<providerId>` for OAuth providers that carry no issuer of
 * their own.
 */
export const AUTH_ACCOUNT_CONFIG = {
  modelName: SystemObjectName.ACCOUNT, // 'sys_account'
  fields: {
    userId: 'user_id',
    providerId: 'provider_id',
    issuer: 'issuer',
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
  /**
   * [ADR-0105 D8] Placement intent rides the invitation better-auth already
   * creates, so acceptance can apply it atomically with the membership
   * (`additionalFields` is better-auth's own extension seam — no shadow
   * table, no second write to keep in sync).
   *
   * These ARE client-suppliable (input stays on) because a placement intent
   * is a REQUEST, not an authority: the `beforeCreateInvitation` hook runs
   * unconditionally and authorizes the pair against the ISSUER's `adminScope`
   * (ADR-0090 D12) via the `invitation-placement` service, rejecting the whole
   * invitation when the unit is outside their subtree or a position
   * distributes a set they may not hand out. Marking them `input: false`
   * instead would not add safety — it would simply make the feature
   * unreachable, since the hook has no other channel to receive the request.
   */
  additionalFields: {
    businessUnitId: {
      type: 'string',
      required: false,
      fieldName: 'business_unit_id',
    },
    positions: {
      type: 'string[]',
      required: false,
      fieldName: 'positions',
    },
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
 * | memberCount             | member_count             |
 * | createdAt               | created_at               |
 * | updatedAt               | updated_at               |
 *
 * better-auth 1.7.0-rc.1 added `memberCount` — the durable seat counter the
 * plugin guard-increments to reserve capacity before inserting a membership
 * row. It is written on EVERY team insert (`memberCount: 0`), so leaving it
 * unmapped made the adapter emit a camelCase `memberCount` column that
 * `sys_team` never provisioned: `organization/create` auto-creates a default
 * team when `teams.enabled`, so org creation 500'd after the org row had
 * already committed. See #3624.
 */
export const AUTH_TEAM_SCHEMA = {
  modelName: SystemObjectName.TEAM, // 'sys_team'
  fields: {
    organizationId: 'organization_id',
    memberCount: 'member_count',
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
 * | membershipKey           | membership_key           |
 * | createdAt               | created_at               |
 *
 * `membershipKey` landed with `team.memberCount` in 1.7.0-rc.1: a SHA-256
 * digest of [teamId, userId] the plugin writes on every membership insert and
 * whose UNIQUE constraint collapses concurrent adds. Same failure mode as
 * `memberCount` if left unmapped — a camelCase column no table provisions —
 * so add-team-member 500s. See #3624.
 */
export const AUTH_TEAM_MEMBER_SCHEMA = {
  modelName: SystemObjectName.TEAM_MEMBER, // 'sys_team_member'
  fields: {
    teamId: 'team_id',
    userId: 'user_id',
    membershipKey: 'membership_key',
    createdAt: 'created_at',
  },
} as const;

// ---------------------------------------------------------------------------
// Two-Factor plugin – twoFactor table
// ---------------------------------------------------------------------------

/**
 * better-auth Two-Factor plugin `twoFactor` model mapping.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack)  |
 * |:------------------------|:--------------------------|
 * | backupCodes             | backup_codes              |
 * | userId                  | user_id                   |
 * | failedVerificationCount | failed_verification_count |
 * | lockedUntil             | locked_until              |
 *
 * 1.7 added the lockout pair `failedVerificationCount` / `lockedUntil`: the
 * verify endpoint guard-increments the counter on every wrong code and stamps
 * `lockedUntil` once it crosses `maxFailedAttempts`. Unmapped, those writes
 * addressed camelCase columns `sys_two_factor` never provisioned, so a wrong
 * 2FA code 500'd on the failure path instead of being counted. Found by
 * `better-auth-schema-parity.test.ts` while closing #3624.
 */
export const AUTH_TWO_FACTOR_SCHEMA = {
  modelName: SystemObjectName.TWO_FACTOR, // 'sys_two_factor'
  fields: {
    backupCodes: 'backup_codes',
    userId: 'user_id',
    failedVerificationCount: 'failed_verification_count',
    lockedUntil: 'locked_until',
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
// Phone-number plugin – user field additions (#2766 V1.5)
// ---------------------------------------------------------------------------

/**
 * Phone-number plugin adds sign-in-identifier fields to the `user` model.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | phoneNumber             | phone_number             |
 * | phoneNumberVerified     | phone_number_verified    |
 */
export const AUTH_PHONE_NUMBER_USER_FIELDS = {
  phoneNumber: 'phone_number',
  phoneNumberVerified: 'phone_number_verified',
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
 * | clientDiscoveryId          | client_discovery_id             |
 * | clientCredentialsScopes    | client_credentials_scopes       |
 * | applicationType            | type                            |
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
 * | jwksUri                    | jwks_uri                        |
 * | backchannelLogoutUri       | backchannel_logout_uri          |
 * | backchannelLogoutSessionRequired | backchannel_logout_session_required |
 * | dpopBoundAccessTokens      | dpop_bound_access_tokens        |
 *
 * The last three rows arrived with the stable 1.7 line (#3002), and two of
 * them are new columns rather than renames:
 *
 *   - `applicationType` is the OIDC `application_type` and is the stable
 *     spelling of the field `1.7.0-rc.2` called `type` — it maps onto the
 *     EXISTING `type` column, so no data moves and the column keeps its
 *     meaning. Left unmapped it resolves to a column named `applicationType`,
 *     which `sys_oauth_application` does not have.
 *   - `clientDiscoveryId` and `clientCredentialsScopes` are genuinely new
 *     upstream fields; both are declared on `sys_oauth_application`.
 *
 * `oauth-provider-schema-parity.test.ts` is the gate: it resolves every model
 * field the way the adapter does (`field.fieldName ?? key`) and fails when the
 * resolved column is not declared. A camelCase name in its failure output
 * means the mapping is missing, not just the column.
 */
export const AUTH_OAUTH_CLIENT_SCHEMA = {
  modelName: SystemObjectName.OAUTH_APPLICATION, // 'sys_oauth_application'
  fields: {
    clientId: 'client_id',
    clientSecret: 'client_secret',
    clientDiscoveryId: 'client_discovery_id',
    clientCredentialsScopes: 'client_credentials_scopes',
    applicationType: 'type',
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
    jwksUri: 'jwks_uri',
    backchannelLogoutUri: 'backchannel_logout_uri',
    backchannelLogoutSessionRequired: 'backchannel_logout_session_required',
    dpopBoundAccessTokens: 'dpop_bound_access_tokens',
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
 * | camelCase (better-auth) | snake_case (ObjectStack)     |
 * |:------------------------|:-----------------------------|
 * | clientId                | client_id                    |
 * | sessionId               | session_id                   |
 * | userId                  | user_id                      |
 * | referenceId             | reference_id                 |
 * | authorizationCodeId     | authorization_code_id        |
 * | requestedUserInfoClaims | requested_user_info_claims   |
 * | refreshId               | refresh_id                   |
 * | expiresAt               | expires_at                   |
 * | createdAt               | created_at                   |
 *
 * (`resources`, `revoked`, and `confirmation` are single-word columns —
 * camelCase equals snake_case, so they need no remap; the columns still
 * exist on `sys_oauth_access_token`.)
 */
export const AUTH_OAUTH_ACCESS_TOKEN_SCHEMA = {
  modelName: SystemObjectName.OAUTH_ACCESS_TOKEN, // 'sys_oauth_access_token'
  fields: {
    clientId: 'client_id',
    sessionId: 'session_id',
    userId: 'user_id',
    referenceId: 'reference_id',
    authorizationCodeId: 'authorization_code_id',
    requestedUserInfoClaims: 'requested_user_info_claims',
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
 * | camelCase (better-auth)  | snake_case (ObjectStack)     |
 * |:-------------------------|:-----------------------------|
 * | clientId                 | client_id                    |
 * | sessionId                | session_id                   |
 * | userId                   | user_id                      |
 * | referenceId              | reference_id                 |
 * | authorizationCodeId      | authorization_code_id        |
 * | requestedUserInfoClaims  | requested_user_info_claims   |
 * | expiresAt                | expires_at                   |
 * | createdAt                | created_at                   |
 * | rotatedAt                | rotated_at                   |
 * | rotationReplayResponse   | rotation_replay_response     |
 * | rotationReplayExpiresAt  | rotation_replay_expires_at   |
 * | authTime                 | auth_time                    |
 *
 * (`resources`, `revoked`, and `confirmation` are single-word columns —
 * camelCase equals snake_case, so they need no remap.)
 */
export const AUTH_OAUTH_REFRESH_TOKEN_SCHEMA = {
  modelName: SystemObjectName.OAUTH_REFRESH_TOKEN, // 'sys_oauth_refresh_token'
  fields: {
    clientId: 'client_id',
    sessionId: 'session_id',
    userId: 'user_id',
    referenceId: 'reference_id',
    authorizationCodeId: 'authorization_code_id',
    requestedUserInfoClaims: 'requested_user_info_claims',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    rotatedAt: 'rotated_at',
    rotationReplayResponse: 'rotation_replay_response',
    rotationReplayExpiresAt: 'rotation_replay_expires_at',
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
 * | camelCase (better-auth) | snake_case (ObjectStack)   |
 * |:------------------------|:---------------------------|
 * | clientId                | client_id                  |
 * | userId                  | user_id                    |
 * | referenceId             | reference_id               |
 * | requestedUserInfoClaims | requested_user_info_claims |
 * | createdAt               | created_at                 |
 * | updatedAt               | updated_at                 |
 *
 * (`resources` is a single-word column — no remap needed.)
 */
export const AUTH_OAUTH_CONSENT_SCHEMA = {
  modelName: SystemObjectName.OAUTH_CONSENT, // 'sys_oauth_consent'
  fields: {
    clientId: 'client_id',
    userId: 'user_id',
    referenceId: 'reference_id',
    requestedUserInfoClaims: 'requested_user_info_claims',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

// ---------------------------------------------------------------------------
// OAuth Provider plugin – oauthResource / oauthClientResource /
// oauthClientAssertion tables (new in @better-auth/oauth-provider 1.7)
// ---------------------------------------------------------------------------

/**
 * `@better-auth/oauth-provider` plugin `oauthResource` model mapping.
 *
 * Registry of protected resources (RFC 8707 resource indicators) plus the
 * per-resource token policy. Used by the MCP OAuth track (`resource=<mcp
 * url>` audience binding) and any future resource-server registrations.
 *
 * | camelCase (better-auth)       | snake_case (ObjectStack)            |
 * |:------------------------------|:------------------------------------|
 * | accessTokenTtl                | access_token_ttl                    |
 * | refreshTokenTtl               | refresh_token_ttl                   |
 * | signingAlgorithm              | signing_algorithm                   |
 * | signingKeyId                  | signing_key_id                      |
 * | allowedScopes                 | allowed_scopes                      |
 * | customClaims                  | custom_claims                       |
 * | dpopBoundAccessTokensRequired | dpop_bound_access_tokens_required   |
 * | policyVersion                 | policy_version                      |
 * | createdAt                     | created_at                          |
 * | updatedAt                     | updated_at                          |
 *
 * (`identifier`, `name`, `disabled`, and `metadata` are single-word columns —
 * no remap needed.)
 */
export const AUTH_OAUTH_RESOURCE_SCHEMA = {
  modelName: SystemObjectName.OAUTH_RESOURCE, // 'sys_oauth_resource'
  fields: {
    accessTokenTtl: 'access_token_ttl',
    refreshTokenTtl: 'refresh_token_ttl',
    signingAlgorithm: 'signing_algorithm',
    signingKeyId: 'signing_key_id',
    allowedScopes: 'allowed_scopes',
    customClaims: 'custom_claims',
    dpopBoundAccessTokensRequired: 'dpop_bound_access_tokens_required',
    policyVersion: 'policy_version',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

/**
 * `@better-auth/oauth-provider` plugin `oauthClientResource` model mapping.
 *
 * Join table granting a registered client access to a registered resource.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | clientId                | client_id                |
 * | resourceId              | resource_id              |
 * | createdAt               | created_at               |
 */
export const AUTH_OAUTH_CLIENT_RESOURCE_SCHEMA = {
  modelName: SystemObjectName.OAUTH_CLIENT_RESOURCE, // 'sys_oauth_client_resource'
  fields: {
    clientId: 'client_id',
    resourceId: 'resource_id',
    createdAt: 'created_at',
  },
} as const;

/**
 * `@better-auth/oauth-provider` plugin `oauthClientAssertion` model mapping.
 *
 * Consumed `private_key_jwt` / `client_secret_jwt` assertion JTIs (RFC 7523
 * replay prevention). The row id IS the consumed jti; `expiresAt` bounds
 * how long it must be remembered.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | expiresAt               | expires_at               |
 */
export const AUTH_OAUTH_CLIENT_ASSERTION_SCHEMA = {
  modelName: SystemObjectName.OAUTH_CLIENT_ASSERTION, // 'sys_oauth_client_assertion'
  fields: {
    expiresAt: 'expires_at',
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

/**
 * Builds the `schema` option for better-auth's `phoneNumber()` plugin
 * (#2766 V1.5). The plugin extends the user model with `phoneNumber` /
 * `phoneNumberVerified`; both differ from their snake_case column names and
 * are mapped explicitly.
 */
export function buildPhoneNumberPluginSchema() {
  return {
    user: {
      fields: AUTH_PHONE_NUMBER_USER_FIELDS,
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
    oauthResource: AUTH_OAUTH_RESOURCE_SCHEMA,
    oauthClientResource: AUTH_OAUTH_CLIENT_RESOURCE_SCHEMA,
    oauthClientAssertion: AUTH_OAUTH_CLIENT_ASSERTION_SCHEMA,
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
 * itself is thin.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | providerId              | provider_id              |
 * | oidcConfig              | oidc_config              |
 * | samlConfig              | saml_config              |
 * | userId                  | user_id                  |
 * | organizationId          | organization_id          |
 * | issuer / domain         | (same name — no remap) |
 * | domainVerified          | domain_verified          |
 *
 * ## Coverage, measured 2026-08-20 against `@better-auth/sso@1.7.1`
 *
 * The previous note here said only "Mirrors `@better-auth/sso@1.6.20`'s
 * `BaseSSOProvider`" — a field-surface claim about a version two minors behind
 * the installed one, which nobody had re-checked. Re-measured by resolving the
 * plugin's real model the way the adapter does (`field.fieldName ?? key`) over
 * `getAuthTables({ plugins: [sso()] }).ssoProvider.fields`:
 *
 *  - `sso()` declares 7 fields — `issuer`, `oidcConfig`, `samlConfig`,
 *    `userId`, `providerId`, `organizationId`, `domain` — exactly the members
 *    of the shipped `BaseSSOProvider` type
 *    (`dist/index-CZytzKv6.d.mts:189-197`).
 *  - `sso({ domainVerification: { enabled: true } })` — the shape
 *    `OS_SSO_DOMAIN_VERIFICATION` turns on — adds an 8th, `domainVerified`.
 *  - Every one of those 8 resolves to a column `sys_sso_provider` declares.
 *    Nothing in the map is orphaned, and nothing in the model is unmapped.
 *
 * ⚠️ Unlike the core models, this mapping has **no parity gate**:
 * `better-auth-schema-parity.test.ts` deliberately passes `getAuthTables()` no
 * `sso` plugin, so an upstream field added to `ssoProvider` would land here
 * silently. Until that changes, re-run the resolution above by hand when the
 * `@better-auth/sso` pin moves — the check is one `getAuthTables` call.
 */
export const AUTH_SSO_PROVIDER_SCHEMA = {
  modelName: 'sys_sso_provider',
  fields: {
    providerId: 'provider_id',
    oidcConfig: 'oidc_config',
    samlConfig: 'saml_config',
    userId: 'user_id',
    organizationId: 'organization_id',
    // DNS domain-ownership proof (ADR-0024 ②). @better-auth/sso writes
    // `domainVerified` on its `ssoProvider` model when domain verification is
    // enabled; map it so the env can surface a verified/unverified badge. The
    // one-time `domainVerificationToken` is NOT a provider column — it lives in
    // the verification table and is returned only from request-domain-verification.
    domainVerified: 'domain_verified',
  },
} as const;

// NOTE: there is intentionally no `buildSsoPluginSchema()`. The original reason
// was that the plugin exposed NO `schema` option (true of 1.6.20) — that is no
// longer why. Measured 2026-08-19 against the installed `@better-auth/sso@1.7.1`:
// `SSOOptions.schema.ssoProvider.{modelName,fields,additionalFields}` exists and
// the runtime honours it, so the mapping above COULD be handed to the plugin.
// It is still consumed at the ADAPTER layer instead (AUTH_MODEL_TO_PROTOCOL +
// field resolution in objectql-adapter.ts), which is now a deliberate choice
// about where the bridge lives rather than a limitation of the dependency;
// revisiting it is the open architecture question on #8224. See ADR-0024.

// ---------------------------------------------------------------------------
// SCIM plugin – scimProvider table (@better-auth/scim)
// ---------------------------------------------------------------------------

/**
 * `@better-auth/scim` plugin `scimProvider` model mapping.
 *
 * Each row is a SCIM connection: a bearer token an external IdP (Okta / Entra)
 * uses to auto-provision / deprovision THIS environment's users — the env is
 * the SCIM Service Provider (ADR-0071). This plugin hardcodes its model and
 * exposes NO `schema` option — still true of the installed
 * `@better-auth/scim@1.7.0-rc.1` (`SCIMOptions` declares no `schema` /
 * `modelName` / `fields` member at all; measured 2026-08-19). It is no longer
 * true of `@better-auth/sso@1.7.1`, which this doc used to lean on for the
 * comparison and which now accepts one (#8224). So for scim — and for scim
 * alone — the ADAPTER layer (AUTH_MODEL_TO_PROTOCOL + field resolution in
 * objectql-adapter.ts) is the only available route: the mapping cannot be
 * handed to the plugin.
 *
 * | camelCase (better-auth) | snake_case (ObjectStack) |
 * |:------------------------|:-------------------------|
 * | providerId              | provider_id              |
 * | scimToken               | scim_token               |
 * | organizationId          | organization_id          |
 * | userId                  | user_id                  |
 */
export const AUTH_SCIM_PROVIDER_SCHEMA = {
  modelName: 'sys_scim_provider',
  fields: {
    providerId: 'provider_id',
    scimToken: 'scim_token',
    organizationId: 'organization_id',
    userId: 'user_id',
  },
} as const;

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
