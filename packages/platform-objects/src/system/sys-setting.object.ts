// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_setting — Generic K/V store backing the SettingsManifest contract
 *
 * Single physical table that holds *every* value for *every* settings
 * namespace declared by a `SettingsManifest`. Plugins MUST NOT define
 * per-namespace tables (e.g. `sys_mail_config`); they declare a manifest
 * and the value persists here.
 *
 * Row identity: (organization_id, namespace, key, scope, user_id?).
 *
 * ⚠️ `scope` is the CASCADE LAYER, not the tenant. It names which rung of the
 * resolution ladder below a row sits on; WHICH organization owns the row is
 * carried by the kernel-injected `organization_id` column, and by nothing else
 * (#8555). `scope='tenant'` therefore means "the organization layer" — one row
 * PER organization, not one row for the installation.
 *
 * Resolution order (handled by `SettingsService.get`):
 *   1. process.env override                    (source='env',     locked=true)
 *   2. sys_setting WHERE scope='global'        (source='global')
 *   3. sys_setting WHERE scope='tenant'        (source='tenant')
 *   4. sys_setting WHERE scope='user'          (source='user')
 *   5. manifest specifier.default              (source='default')
 *
 * Encryption: rows with `encrypted=true` store ciphertext in `value_enc`
 * and leave `value` null. The plain value is never written to audit log
 * or history snapshots — only an `'<encrypted>'` placeholder + a digest.
 *
 * managedBy: 'engine-owned' — the admin grid in Setup is a diagnostic surface
 * only; all writes flow through `SettingsService.set()` so the resolver
 * stays the single source of truth.
 *
 * See ADR-0007 (Settings Manifest + K/V Store + Resolver).
 *
 * @namespace sys
 */
export const SysSetting = ObjectSchema.create({
  name: 'sys_setting',
  label: 'Setting',
  pluralLabel: 'Settings',
  icon: 'sliders',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Generic K/V store backing the SettingsManifest contract.',
  displayNameField: 'key',
  nameField: 'key', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{namespace}.{key}',
  highlightFields: ['namespace', 'key', 'scope', 'updated_at'],

  listViews: {
    by_namespace: {
      type: 'grid',
      name: 'by_namespace',
      label: 'By Namespace',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['namespace', 'key', 'scope', 'encrypted', 'updated_by', 'updated_at'],
      sort: [{ field: 'namespace', order: 'asc' }, { field: 'key', order: 'asc' }],
      grouping: { fields: [{ field: 'namespace', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 200 },
    },
    tenant_only: {
      type: 'grid',
      name: 'tenant_only',
      label: 'Tenant',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['namespace', 'key', 'encrypted', 'updated_by', 'updated_at'],
      filter: [{ field: 'scope', operator: 'equals', value: 'tenant' }],
      sort: [{ field: 'namespace', order: 'asc' }, { field: 'key', order: 'asc' }],
      pagination: { pageSize: 200 },
    },
    user_only: {
      type: 'grid',
      name: 'user_only',
      label: 'User',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['user_id', 'namespace', 'key', 'updated_at'],
      filter: [{ field: 'scope', operator: 'equals', value: 'user' }],
      sort: [{ field: 'user_id', order: 'asc' }, { field: 'namespace', order: 'asc' }],
      pagination: { pageSize: 200 },
    },
    all_settings: {
      type: 'grid',
      name: 'all_settings',
      label: 'All',
      data: { provider: 'object', object: 'sys_setting' },
      columns: ['namespace', 'key', 'scope', 'user_id', 'encrypted', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    id: Field.text({
      label: 'Setting ID',
      required: true,
      readonly: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    namespace: Field.text({
      label: 'Namespace',
      required: true,
      maxLength: 64,
      description: 'Manifest namespace (e.g. mail, branding, feature_flags).',
    }),

    key: Field.text({
      label: 'Key',
      required: true,
      maxLength: 128,
      description: 'Specifier key inside the namespace (snake_case).',
    }),

    // The option list is the storage-side mirror of `SpecifierScopeSchema`
    // (`packages/spec/src/system/settings-manifest.zod.ts`), which is the
    // reference truth for the cascade's layers. Keep the two in step —
    // `sys-setting.scope-options.test.ts` pins the parity, and the sibling
    // audit object (`sys_setting_audit.scope`) mirrors the same three.
    // A fourth option lived here declaring `runtime` (#6036): the spec enum
    // never accepted it, `SettingsService` never mentioned it, and no write
    // path could produce such a row — a declared-but-unenforced value domain
    // of exactly the ADR-0049 kind. Removed rather than implemented.
    scope: Field.select(
      [
        { label: 'Global', value: 'global' },
        { label: 'Tenant', value: 'tenant' },
        { label: 'User',   value: 'user' },
      ],
      {
        label: 'Scope',
        required: true,
        defaultValue: 'tenant',
        description: 'Which layer of the config-resolution hierarchy this row belongs to.',
      },
    ),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      description: 'Owning user when scope=user; null otherwise.',
    }),

    value: Field.json({
      label: 'Value',
      description: 'JSON-encoded value. Null when encrypted=true (see value_enc).',
    }),

    encrypted: Field.boolean({
      label: 'Encrypted',
      defaultValue: false,
      description: 'When true, the value is stored encrypted-at-rest in value_enc; value column is null.',
    }),

    locked: Field.boolean({
      label: 'Locked',
      defaultValue: false,
      description:
        'When true, lower-scope rows cannot override this value; writes against lower scopes return 409. ' +
        'Used by platform administrators to pin a global value for all tenants (Phase 2 cascade).',
    }),

    locked_reason: Field.text({
      label: 'Lock Reason',
      description: 'Human-readable explanation surfaced in the UI tooltip when locked=true.',
    }),

    value_enc: Field.text({
      label: 'Encrypted Value',
      readonly: true,
      description: 'Ciphertext payload (KMS-wrapped). Set only when encrypted=true.',
    }),

    updated_by: Field.lookup('sys_user', {
      label: 'Updated By',
      readonly: true,
      description: 'Last actor who wrote this row via SettingsService.set().',
    }),
  },

  indexes: [
    // Primary lookup path: (namespace, key, scope, user_id?) is what
    // SettingsService.get hits on every resolve. The composite UNIQUE
    // covers both the row-identity constraint and the read path.
    //
    // [#8555] Scope spelled EXPLICITLY (ADR-0120 D1). On a DECLARED index bare
    // `unique: true` is the positional spelling of `'global'` — the listed
    // columns verbatim — so this was an installation-wide key on a
    // tenant-scoped object.
    //
    // The card left the direction open: if `scope` itself encoded tenancy, the
    // right end state was an explicit `'global'`. It does not. `scope` is the
    // cascade LAYER (`global | tenant | user`, a priority ladder — see
    // `scopeRank` in `SettingsService`), and the organization is carried by
    // `organization_id`: `loadRows` says so outright ("per-tenant isolation for
    // `tenant`-scope rows is still enforced by the engine"), and the `lifecycle`
    // manifest depends on it — `retention_overrides` is `scope: 'tenant'` so
    // that "regulated tenants set years; dev sets days ... one deployment can
    // carry both". A per-organization value is the feature, so the key is
    // per-organization.
    //
    // Measured live before the fix, real driver, OS_TENANCY_POSTURE=isolated:
    //   scope='user'   org_jia 201 / org_yi SAME 409 UNIQUE_VIOLATION
    //                  / org_yi unused 201 / org_yi's own GET 0 rows
    //   scope='tenant' org_jia 201 / org_yi SAME *201*
    //   scope='global' platform 201 / platform SAME *201*
    // The 409 is the #8323 cross-tenant existence oracle. The two 201s are a
    // SECOND defect this respelling does NOT fix: `user_id` is NULL on every
    // `tenant`/`global` row and SQL UNIQUE is NULL-distinct, so the declared
    // row identity is void on those limbs — even within ONE organization.
    // Closing it means null-safety on an author-declared column plus a
    // duplicate pre-flight for databases that already carry duplicates, so it
    // is #8629 rather than a rider here: this respelling is a pure relaxation
    // and applies to any database, while that one is a TIGHTENING that cannot
    // build its index on an installation which has already accumulated the
    // duplicates this hole permits.
    //
    // The organization key part is NULL-safe (`COALESCE(organization_id,
    // '__global__')`, ADR-0120 D3), which is what preserves the `scope='global'`
    // LAYER: platform rows carry no organization, so they share one bucket and
    // stay unique among themselves — the installation-wide platform default the
    // resolver reads at rung 2 survives, without the whole index being global.
    { fields: ['namespace', 'key', 'scope', 'user_id'], unique: 'organization' },
    // Common range read: full namespace dump for SettingsService.getNamespace.
    { fields: ['namespace', 'scope'], unique: false },
    // Per-user listing on the user-prefs scope.
    { fields: ['user_id', 'namespace'], unique: false },
  ],

  enable: {
    // History on settings is opt-in per namespace (handled at service
    // layer when needed) to avoid bloating sys_history with churn from
    // feature flags and similar high-frequency toggles.
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // Direct data API exposed for the admin grid view, but writes from
    // the UI MUST go through /api/settings/:namespace so the resolver
    // and audit hooks fire. The grid is diagnostic-only.
    apiMethods: ['get', 'list'],
  },
});
