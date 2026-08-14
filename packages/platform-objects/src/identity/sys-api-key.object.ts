// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_api_key — System API Key Object
 *
 * API keys for programmatic/machine access to the platform.
 *
 * Field `key` stores a hashed value and is marked hidden so it never
 * leaks into default list/form rendering; the raw token is only
 * returned once on creation via the auth plugin API.
 *
 * @namespace sys
 */
export const SysApiKey = ObjectSchema.create({
  name: 'sys_api_key',
  label: 'API Key',
  pluralLabel: 'API Keys',
  icon: 'key-round',
  isSystem: true,
  managedBy: 'better-auth',
  // [ADR-0092 D4 / ADR-0103] Declares the generic EDIT affordance, which is
  // what lets `enable.apiMethods` keep `update` below: `managedBy` objects run
  // through `reconcileManagedApiMethods`, which strips any write verb the
  // resolved affordances do not grant. Without this line the declaration and
  // the runtime disagree again — silently, one layer deeper than #7727's
  // method gate. `create` / `delete` stay bucket-default (off): minting is
  // `POST /api/v1/keys` and rows are retired by revoking, not deleting.
  //
  // The affordance is safe to open only because the enforcement it fronts
  // already exists (D4's sequencing rule — affordance never ships ahead of
  // the guard): ADR-0092 D2's guard clamps every user-context update on this
  // table to the registered column whitelist, which lists `revoked` alone.
  // Per D4's form-rendering constraint, every column outside that whitelist
  // is marked `readonly` below, so the edit form cannot offer a write the
  // server will refuse.
  userActions: { edit: true },
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'API keys for programmatic access',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{name}',
  highlightFields: ['name', 'prefix', 'user_id', 'expires_at', 'revoked'],

  // Custom actions — sys_api_key is managed-by 'better-auth' but the
  // `revoked` boolean is a column we control via the data API. These row
  // actions use the generic PATCH /api/v1/data/sys_api_key/{id} endpoint with
  // `bodyExtra` to set the `revoked` flag explicitly. The `target` below is
  // the authority on that path; this comment used to omit `/data/`.
  actions: [
    {
      name: 'revoke_api_key',
      label: 'Revoke API Key',
      icon: 'shield-off',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_api_key/{id}',
      bodyExtra: { revoked: true },
      confirmText: 'Revoke this API key? Any clients using it will immediately lose access.',
      successMessage: 'API key revoked',
      refreshAfter: true,
    },
    {
      name: 'restore_api_key',
      label: 'Restore API Key',
      icon: 'shield-check',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_api_key/{id}',
      bodyExtra: { revoked: false },
      confirmText: 'Restore this revoked API key? Existing clients holding the key will regain access.',
      successMessage: 'API key restored',
      refreshAfter: true,
    },
  ],

  listViews: {
    mine: {
      type: 'grid',
      name: 'mine',
      label: 'My Keys',
      data: { provider: 'object', object: 'sys_api_key' },
      // [#8287] `active_organization_id` is shown here deliberately: the card's
      // complaint was a valid-looking credential whose reach the owner could
      // not see. The column IS the reach, so the "My Keys" list states it.
      columns: ['name', 'prefix', 'active_organization_id', 'expires_at', 'last_used_at', 'revoked'],
      filter: [
        { field: 'user_id', operator: 'equals', value: '{current_user_id}' },
      ],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'user_id', 'expires_at', 'last_used_at'],
      filter: [{ field: 'revoked', operator: 'equals', value: false }],
      sort: [{ field: 'last_used_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    revoked: {
      type: 'grid',
      name: 'revoked',
      label: 'Revoked',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'user_id', 'expires_at', 'updated_at'],
      filter: [{ field: 'revoked', operator: 'equals', value: true }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    all_keys: {
      type: 'grid',
      name: 'all_keys',
      label: 'All',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'user_id', 'active_organization_id', 'expires_at', 'last_used_at', 'revoked'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    // The five fields below are `readonly` for one reason (ADR-0092 D4's
    // form-rendering constraint): they are set on the mint path and are NOT on
    // the identity write guard's column whitelist, so a user-context write to
    // any of them is refused 403. With `userActions.edit` open, leaving them
    // writable in the form would advertise an edit the server rejects — the
    // declared-≠-enforced shape this object already paid for once (#7727).
    name: Field.text({
      label: 'Name',
      required: true,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'Human-readable label for the API key',
      group: 'Identity',
    }),

    prefix: Field.text({
      label: 'Prefix',
      required: false,
      readonly: true,
      maxLength: 16,
      description: 'Visible prefix for identifying the key (e.g., "osk_")',
      group: 'Identity',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'Owner',
      required: true,
      readonly: true,
      description: 'User who owns this API key',
      group: 'Identity',
    }),

    // ── Access ───────────────────────────────────────────────────
    //
    // [#8287] The organization this key authenticates INTO. Set once, on the
    // mint path, from the minter's active organization (inherited — there is
    // deliberately no org parameter and no cross-org key); the verifier reads
    // it back and `resolveAuthzContext` establishes it as the request's active
    // organization, which is what lets the ADR-0105 Layer 0 wall match. Before
    // this column a minted key carried no organization at all, so under the
    // `isolated` posture (`organization_id = activeOrganizationId`) no row
    // could ever match and the whole key surface read nothing while the console
    // went on offering minting.
    //
    // ⚠️ The NAME is load-bearing, and it is `active_organization_id` — the
    // `sys_session.active_organization_id` spelling — NOT `organization_id`.
    // Two reasons, one semantic and one measured:
    //
    //  - Semantic: this value is not "the organization that owns this row", it
    //    is "the organization this credential makes ACTIVE". A session carries
    //    exactly the same fact under exactly this name, and both are read into
    //    `ExecutionContext.tenantId` by the one shared resolver. One concept,
    //    one name (ADR-0089).
    //  - Measured: `objectHasOrgIdField` (plugin-security `security-plugin.ts`)
    //    tests for the literal `organization_id`, and `computeTenantLayer0Filter`
    //    (`tenant-layer.ts`) exempts objects without it. Naming this column
    //    `organization_id` would therefore make `sys_api_key` ITSELF org-walled,
    //    and both walled postures exclude NULL: every pre-existing org-less row
    //    would vanish from the console's "My Keys" list FOR ITS OWN OWNER, and
    //    under `group` those rows still authenticate — a live credential its
    //    owner can no longer see or revoke. New keys would fare little better:
    //    a key minted in org A disappears from its owner's list whenever they
    //    switch to org B. `sys_api_key` is an owner-scoped credential table
    //    like `sys_user` / `sys_session` / `sys_account`; it is scoped by the
    //    Layer 1 `sys_api_key_self` policy (`user_id == current_user.id`), and
    //    keeping it that way is what stops this fix from creating a fresh
    //    instance of the very silent-empty class it exists to remove.
    active_organization_id: Field.lookup('sys_organization', {
      label: 'Active Organization',
      required: false,
      readonly: true,
      description:
        'Organization this key authenticates into — inherited from the minter at creation and established as the request’s active organization',
      group: 'Access',
    }),

    scopes: Field.textarea({
      label: 'Scopes',
      required: false,
      readonly: true,
      description: 'JSON array of permission scopes',
      group: 'Access',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    expires_at: Field.datetime({
      label: 'Expires At',
      required: false,
      readonly: true,
      group: 'Lifecycle',
    }),

    last_used_at: Field.datetime({
      label: 'Last Used At',
      required: false,
      readonly: true,
      description: 'Automatically updated on each API call',
      group: 'Lifecycle',
    }),

    revoked: Field.boolean({
      label: 'Revoked',
      defaultValue: false,
      group: 'Lifecycle',
    }),

    // ── Secret (hidden by default) ──────────────────────────────
    //
    // [#7728] `internal: true` is what makes the description below TRUE. It was
    // false on every build before this flag existed: `hidden` is a UI contract
    // ("Hidden from default UI"), never a serialization one, and the engine's
    // credential read mask collects by field TYPE — so this `text` column was
    // collected by nothing and the stored SHA-256 hash came back on get-by-id,
    // on list, on an explicit `?select=id,key` and in the PATCH body.
    //
    // Still `text`, deliberately. `Field.secret` would encrypt at rest and
    // replace the column with a `sys_secret` ref, destroying the
    // `where: { key: hashApiKey(raw) }` lookup `resolveApiKeyPrincipal` uses —
    // i.e. it would break authentication to fix a disclosure. `internal` is
    // read-side only: storage, the index and the verifier's filter are
    // untouched, and `POST /api/v1/keys` still returns the raw secret once.
    key: Field.text({
      label: 'Hashed Key',
      required: true,
      hidden: true,
      readonly: true,
      internal: true,
      description: 'Hashed API key value — never exposed to clients',
      group: 'Secret',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'API Key ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['key'], unique: true },
    { fields: ['user_id'] },
    { fields: ['prefix'] },
    { fields: ['revoked'] },
    // [#8287] Not for the verify path — that matches the unique `key` hash and
    // reads the organization off the row it already has. This serves the
    // administrative direction ("which keys authenticate into this org?"),
    // which is the query a tenant admin runs when a membership ends.
    { fields: ['active_organization_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // #1591 / #7727 — reads, plus `update` for the revoke/restore lifecycle.
    //
    // `create` and `delete` stay off: minting is `POST /api/v1/keys` (the only
    // path that can return the raw secret once) and rows are retired by
    // revoking, not deleting, so history survives.
    //
    // `update` is here because the two row actions above declare a PATCH
    // against the data API, and a method gate that answers 405 first makes
    // those actions dead on arrival — a declared affordance the runtime never
    // honours (#7727). Opening the METHOD does not open the COLUMNS: this
    // object is `managedBy: 'better-auth'`, so ADR-0092 D2's identity write
    // guard still fail-closed rejects user-context writes, and the only
    // opening is its per-object update whitelist. `revoked` is registered
    // there (plugin-auth `managed-extension-fields.ts`); every other column —
    // `key`, `user_id`, `expires_at`, `name`, … — is stripped, and a PATCH
    // that touches nothing else is refused 403 `PERMISSION_DENIED` rather
    // than degrading into a silent no-op.
    //
    // The batch primitive stays off DELIBERATELY (#7802), which is why this is
    // the monorepo's only single-record-write whitelist without it. Revoking is
    // a one-row, one-column gesture: the console renders no checkbox column for
    // this object (no bulk action can arise — the grid's only implicit one is
    // bulk-delete, and this object grants no delete affordance), and promoting
    // a row action into a view's `bulkActions` fans out per row through the
    // action runner rather than calling `/batch`. So the primitive would open
    // `POST /data/sys_api_key/batch` and the `*Many` routes to API clients for
    // no caller. The decision is on the record — with its evidence and the
    // conditions that would reverse it — in `SINGLE_RECORD_WRITE_ONLY` in
    // `@objectstack/spec`'s `data/api-methods-batch-conformance.test.ts`, whose
    // stale-entry check fails if `bulk` is added here without retiring it.
    apiMethods: ['get', 'list', 'update'],
  },
});
