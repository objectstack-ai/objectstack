// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * System Object Names — Protocol Layer Constants
 *
 * These constants define the canonical, protocol-level names for system objects.
 * All API calls, SDK references, permissions checks, and metadata lookups MUST use
 * these names instead of hardcoded strings or physical table names.
 *
 * The actual storage table name is derived from the object name; the mapping
 * between protocol name and storage name is handled by the
 * ObjectQL Engine / Driver layer.
 *
 * @example
 * ```ts
 * import { SystemObjectName } from '@objectstack/spec/system';
 *
 * // Always use the constant for API / SDK / permission references
 * const users = await engine.find(SystemObjectName.USER, { ... });
 * ```
 */
export const SystemObjectName = {
  /** Authentication: user identity */
  USER: 'sys_user',
  /** Authentication: active session */
  SESSION: 'sys_session',
  /** Authentication: OAuth / credential account */
  ACCOUNT: 'sys_account',
  /** Authentication: email / phone verification */
  VERIFICATION: 'sys_verification',
  /** Authentication: organization (multi-org support) */
  ORGANIZATION: 'sys_organization',
  /** Authentication: organization member */
  MEMBER: 'sys_member',
  /** Authentication: organization invitation */
  INVITATION: 'sys_invitation',
  /** Authentication: team within an organization */
  TEAM: 'sys_team',
  /** Authentication: team membership */
  TEAM_MEMBER: 'sys_team_member',
  /** Authentication: API key for programmatic access */
  API_KEY: 'sys_api_key',
  /** Authentication: two-factor authentication credentials */
  TWO_FACTOR: 'sys_two_factor',
  /** Authentication: registered OAuth/OIDC client application (when this server acts as an IdP) */
  OAUTH_APPLICATION: 'sys_oauth_application',
  /** Authentication: issued OAuth/OIDC access token */
  OAUTH_ACCESS_TOKEN: 'sys_oauth_access_token',
  /** Authentication: issued OAuth/OIDC refresh token (linked to a session) */
  OAUTH_REFRESH_TOKEN: 'sys_oauth_refresh_token',
  /** Authentication: recorded user consent for a given OAuth client + scopes */
  OAUTH_CONSENT: 'sys_oauth_consent',
  /** Authentication: registered OAuth protected resource (RFC 8707 resource indicator) */
  OAUTH_RESOURCE: 'sys_oauth_resource',
  /** Authentication: client ↔ protected-resource grant (RFC 8707) */
  OAUTH_CLIENT_RESOURCE: 'sys_oauth_client_resource',
  /** Authentication: consumed client-assertion JTI (RFC 7523 replay prevention) */
  OAUTH_CLIENT_ASSERTION: 'sys_oauth_client_assertion',
  /** Authentication: pending device-authorization (RFC 8628) request */
  DEVICE_CODE: 'sys_device_code',
  /** Authentication: JWKS key pair used to sign OIDC ID tokens / JWT access tokens */
  JWKS: 'sys_jwks',
  /** Authentication: user preferences (theme, locale, etc.) */
  USER_PREFERENCE: 'sys_user_preference',
  /** Security: position definition (flat capability-distribution group, ADR-0090 D3) */
  POSITION: 'sys_position',
  /** Security: permission set grouping */
  PERMISSION_SET: 'sys_permission_set',
  /** Audit: system audit log */
  AUDIT_LOG: 'sys_audit_log',
  /** System metadata storage */
  METADATA: 'sys_metadata',
  /** Realtime: user presence state */
  PRESENCE: 'sys_presence',
} as const;

/** Union type of all system object names */
export type SystemObjectName = typeof SystemObjectName[keyof typeof SystemObjectName];

/**
 * Well-known `sys_user` ids — deterministic identities the platform relies on.
 *
 * The actual rows are provisioned by the runtime at boot; these constants are
 * the canonical references for code that needs to bind to them (e.g. the seed
 * loader binding `os.user` to the system identity).
 */
export const SystemUserId = {
  /**
   * Reserved well-known id for the legacy non-loginable system service account.
   *
   * NO LONGER AUTO-PROVISIONED. Ownership now works without it: seeds leave
   * `owner_id` NULL (and `cel`os.user.id`` resolves to NULL at seed time, since
   * the owning admin does not exist yet), and the first-admin bootstrap
   * (`claimSeedOwnership`) re-owns those NULL rows to the promoted human admin.
   * The runtime never mints a `usr_system` row.
   *
   * This constant survives only for backward compatibility: DBs created by an
   * older runtime may still contain a `usr_system` row, so the first-admin
   * exclusion guards (it must never be mistaken for a human admin) and the
   * ownership handoff (which also claims any `owner_id = usr_system` rows) keep
   * referencing it. On a fresh boot no such row exists and those references are
   * harmless no-ops.
   */
  SYSTEM: 'usr_system',
} as const;

/** Union type of all well-known system user ids */
export type SystemUserId = typeof SystemUserId[keyof typeof SystemUserId];

/**
 * System Field Names — Protocol Layer Constants
 *
 * These constants define the canonical, protocol-level names for common system fields.
 * All API calls, SDK references, and permission checks MUST use these constants
 * instead of hardcoded strings or physical column names.
 *
 * The actual storage column name may differ via `FieldSchema.columnName`.
 *
 * @example
 * ```ts
 * import { SystemFieldName } from '@objectstack/spec/system';
 *
 * // Use the constant to reference the owner field in queries
 * const myRecords = await engine.find('project', {
 *   filters: [SystemFieldName.OWNER_ID, '=', currentUserId],
 * });
 * ```
 */
export const SystemFieldName = {
  /** Primary key */
  ID: 'id',
  /** Record creation timestamp */
  CREATED_AT: 'created_at',
  /** Record last-updated timestamp */
  UPDATED_AT: 'updated_at',
  /** Record owner (lookup to user) */
  OWNER_ID: 'owner_id',
  /** Tenant isolation key */
  TENANT_ID: 'tenant_id',
  /** Foreign key to user on session / account objects */
  USER_ID: 'user_id',
  /** Soft-delete timestamp */
  DELETED_AT: 'deleted_at',
} as const;

/** Union type of all system field names */
export type SystemFieldName = typeof SystemFieldName[keyof typeof SystemFieldName];

/**
 * Storage Name Mapping — Protocol ↔ Physical Name Resolution
 *
 * Provides pure utility functions for resolving protocol-level names to
 * physical storage names and vice-versa.
 *
 * These helpers are intended for use inside the ObjectQL Engine and Driver layers.
 * They are intentionally stateless — they receive the object definition and return
 * the resolved name.
 */
export const StorageNameMapping = {
  /**
   * Resolve the physical table name for an object.
   *
   * The full prefixed object name IS the physical table name. Since every
   * object in a stack is required by `defineStack()` to start with the
   * package namespace (e.g. `todo_task`, `crm_account`), tables for
   * different packages cannot collide even when installed into the same
   * database.
   *
   * Legacy compatibility: if `object.name` is in the old FQN form
   * `{namespace}__{shortName}` (double underscore), the namespace prefix
   * is stripped to recover the historical table name. New code should
   * not produce that shape — `defineStack()` validates against it.
   *
   * @param object - Object definition (at minimum `{ name: string }`)
   * @returns The physical table / collection name to use in storage operations.
   *
   * @example resolveTableName({ name: 'todo_task' })   // 'todo_task'
   * @example resolveTableName({ name: 'crm_account' }) // 'crm_account'
   * @example resolveTableName({ name: 'sys_user' })    // 'sys_user'
   * @example resolveTableName({ name: 'crm__account' }) // 'account' (legacy)
   */
  resolveTableName(object: { name: string }): string {
    const idx = object.name.indexOf('__');
    return idx === -1 ? object.name : object.name.slice(idx + 2);
  },

  /**
   * Resolve the physical column name for a field.
   * Falls back to `fieldKey` when `columnName` is not set on the field.
   *
   * @param fieldKey - The protocol-level field key (snake_case identifier).
   * @param field    - Field definition (at minimum `{ columnName?: string }`).
   * @returns The physical column name to use in storage operations.
   */
  resolveColumnName(fieldKey: string, field: { columnName?: string }): string {
    return field.columnName ?? fieldKey;
  },

  /**
   * Build a complete field-key → column-name map for an entire object.
   *
   * @param fields - The fields record from an ObjectSchema.
   * @returns A record mapping every protocol field key to its physical column name.
   */
  buildColumnMap(fields: Record<string, { columnName?: string }>): Record<string, string> {
    const map: Record<string, string> = {};
    for (const key of Object.keys(fields)) {
      map[key] = fields[key].columnName ?? key;
    }
    return map;
  },

  /**
   * Build a reverse column-name → field-key map for an entire object.
   * Useful for translating storage-layer results back to protocol-level field keys.
   *
   * @param fields - The fields record from an ObjectSchema.
   * @returns A record mapping every physical column name back to its protocol field key.
   */
  buildReverseColumnMap(fields: Record<string, { columnName?: string }>): Record<string, string> {
    const map: Record<string, string> = {};
    for (const key of Object.keys(fields)) {
      const col = fields[key].columnName ?? key;
      map[col] = key;
    }
    return map;
  },
} as const;
