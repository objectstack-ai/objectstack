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
 * The canonical, protocol-level SPELLING of each column the platform manages
 * rather than the author. All API calls, SDK references, and permission checks
 * MUST use these constants instead of hardcoded strings or physical column
 * names.
 *
 * The physical storage column always equals the field key (the driver does not
 * support per-field column overrides; external objects map columns via
 * `external.columnMap`, ADR-0062 D7 / ADR-0015).
 *
 * ## ⚠️ This is a NAME registry, not the injected-column SET
 *
 * WHICH of these columns exists on a given object is decided PER OBJECT by
 * `applySystemFields()` (`@objectstack/objectql` registry), from that object's
 * own declarations: `ownership: 'org' | 'none'` withholds `owner_id`,
 * `tenancy.enabled: false` withholds `organization_id`, and
 * `systemFields: false` / `managedBy: 'better-auth'` disable the pass
 * entirely. So the SAME NAME can be a system column on one object and an
 * ordinary authored business field on another — a business field named
 * `owner`, say (cloud#979, an observed failure: it was treated as a system
 * column, so seeded rows left it blank).
 *
 * A consumer asking **"is this field system-managed ON THIS OBJECT?"** must
 * therefore NOT test membership in this table. Branch on the per-field
 * `Field.system` flag (`@objectstack/spec/data`) — `applySystemFields` stamps
 * it on every column it injects, and no authored field carries it. That flag
 * is the per-object answer; this table only answers "what is the canonical
 * spelling of the column that plays role X".
 *
 * Related declarations, each with a different job — do not conflate them:
 * - `FIELD_GROUP_SYSTEM_FIELDS` (`@objectstack/spec/data`) — names excluded
 *   from a default form/detail layout.
 * - `PUBLIC_FORM_SERVER_MANAGED_FIELDS` (`@objectstack/spec/security`) — names
 *   never client-suppliable on the anonymous surface, pinned by objectql's
 *   `system-managed-fields-conformance.test.ts` to be exactly (what open-core
 *   injects ∪ documented reserved names).
 *
 * Every entry below records whether open-core actually INJECTS it, because
 * that is the distinction hand-copied lists keep getting wrong
 * (framework#4330, cloud#982 — where three copies had drifted onto
 * `tenant_id`/`org_id`/`space`, two of which no injection site has ever
 * produced).
 *
 * @example
 * ```ts
 * import { SystemFieldName } from '@objectstack/spec/system';
 *
 * // Use the constant to reference the owner field in queries
 * const myRecords = await engine.find('project', {
 *   where: { [SystemFieldName.OWNER_ID]: currentUserId },
 * });
 * ```
 */
export const SystemFieldName = {
  /** Primary key. Provisioned by the driver, not by `applySystemFields`. */
  ID: 'id',
  /** Record creation timestamp. INJECTED (audit provenance). */
  CREATED_AT: 'created_at',
  /** User who created the record (lookup to user). INJECTED (audit provenance). */
  CREATED_BY: 'created_by',
  /** Record last-updated timestamp. INJECTED (audit provenance). */
  UPDATED_AT: 'updated_at',
  /** User who last modified the record (lookup to user). INJECTED (audit provenance). */
  UPDATED_BY: 'updated_by',
  /** Record owner (lookup to user). INJECTED unless `ownership: 'business_unit' | 'org' | 'none'`. */
  OWNER_ID: 'owner_id',
  /**
   * Record-level business-unit ownership — the middle tier between
   * {@link SystemFieldName.OWNER_ID} (a person) and
   * {@link SystemFieldName.ORGANIZATION_ID} (the tenant wall): *which department
   * / legal entity does this row belong to*. A lookup to `sys_business_unit`.
   *
   * **INJECTED** (ADR-0117 D1, landed in #5677) — `applySystemFields` provisions
   * the column on every ownership-eligible object. Withheld on `managedBy` /
   * `sys_*` tables and under `ownership: 'org' | 'none'`. Note its reach is
   * WIDER than {@link SystemFieldName.OWNER_ID}'s rather than identical to it:
   * it also covers `ownership: 'business_unit'`, the tier that carries this
   * anchor and deliberately no owning person. The per-object derivation both the
   * engine and author-time lint read is `resolveInjectedSystemColumns`
   * (`@objectstack/spec/data`) — its table, not this sentence, is the authority
   * on the per-tier answer.
   *
   * The unit-owned TIER is **authorable** as of #5678: `ObjectSchema`'s
   * `ownership` enum reads `'user' | 'business_unit' | 'org' | 'none'`, so an
   * author can declare `ownership: 'business_unit'` and get this column with no
   * `owner_id` — D1's row, end to end. It was deliberately REJECTED until then,
   * and the ordering mattered: #5677 had to flip the injection judgement to an
   * allow-list FIRST, or the tier's first appearance would have been stamped
   * `owner_id` — the inverse of what it means. Both directions of that sequence
   * are pinned in `packages/spec/src/data/object.test.ts`.
   *
   * The column is still provisioned but **inert**: it is shaped after
   * `organization_id` (`readonly`, `hidden`), not after `owner_id`, because it
   * is a server-stamped scope anchor — and the stamping middleware (ADR-0117
   * D2/D4) has not landed, so nothing writes a value yet. See
   * `applySystemFields`' injection site (`packages/objectql/src/registry.ts`)
   * for why that shape presumes nothing about the undecided D2 policy.
   *
   * The NAME was reserved here by ADR-0117 (Accepted, D1/D3 scoped) ahead of the
   * injection so the canonical spelling had one reference from the start, and so
   * consumers stopped inventing their own (`business_unit_id`, `bu_id`,
   * `dept_id` …) — the drift mode framework#4330 / cloud#982 already paid for
   * with `tenant_id`/`org_id`/`space`.
   *
   * It is on the public-form denylist as defense-in-depth: it is a kernel-owned
   * ownership anchor, and a forged value on the anonymous surface would move the
   * row behind another department's wall — the same forge class
   * `owner_id`/`organization_id` are denied for. Denying it before it existed
   * was free and fail-closed; adding it only now that open-core injects it would
   * have been a hole with a release in it.
   *
   * @see docs/adr/0117-owning-business-unit-record-stamp.md
   */
  OWNING_BUSINESS_UNIT_ID: 'owning_business_unit_id',
  /**
   * THE tenant isolation key — a lookup to `sys_organization`. INJECTED unless
   * tenancy is disabled for the object; org-scoping populates it on insert and
   * it stays NULL on single-tenant stacks.
   */
  ORGANIZATION_ID: 'organization_id',
  /**
   * Legacy / enterprise tenant alias. **NOT injected by open-core** — nothing
   * provisions this column. It is stamped (from the session's *organization*
   * id, `objectql` plugin) only on an object that DECLARES it, and it stays on
   * the public-form denylist as defense-in-depth. Use
   * {@link SystemFieldName.ORGANIZATION_ID} for tenant scoping; this constant
   * exists so the legacy spelling still has one canonical reference.
   */
  TENANT_ID: 'tenant_id',
  /**
   * Foreign key to user on session / account objects. **Authored**, not
   * injected — an ordinary business object may legitimately declare its own
   * `user_id` lookup, so this name must never be used to classify a column as
   * system-managed.
   */
  USER_ID: 'user_id',
  /**
   * Soft-delete timestamp. **NOT injected by `applySystemFields`** — written by
   * the lifecycle / trash layer at runtime.
   */
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

  // resolveColumnName / buildColumnMap / buildReverseColumnMap were removed with
  // `field.columnName` (#2377, ADR-0049): the SQL driver hardcodes the physical
  // column = field key, so these had zero call sites. External-object physical
  // mapping lives in `external.columnMap` (ADR-0062 D7 / ADR-0015).
} as const;
