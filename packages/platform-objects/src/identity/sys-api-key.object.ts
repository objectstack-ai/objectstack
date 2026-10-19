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
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  // [#19054] The stamp-only organization declaration that used to sit here
  // (`organizationField: 'active_organization_id'`, the stamp-only ruling) is
  // GONE from the authorable surface in protocol 18 (ADR-0049 enforce-or-remove;
  // maintainer ruling 2026-09-18, verbatim and untranslated:
  // 「organizationField 撤出可授权面 同意你的建议」).
  //
  // ⛔ Nothing about this table's behaviour changed, and ⛔ nothing here needs
  // to replace it. The fact it carried — "platform rows about a `sys_api_key`
  // row are stamped from `active_organization_id`, not from any wall" — now
  // lives in `@objectstack/metadata-core`'s
  // `PLATFORM_STAMP_ORGANIZATION_COLUMNS`, keyed by this object's name, read by
  // the three sanctioned platform-row writers (audit stamping, the approval-row
  // writer, the automation-run recorder) and by nothing else. It was authorable
  // by every application and declared, repo-wide, only here; a fact about one
  // table we ship is not a knob customers configure.
  //
  // `enabled: false` states explicitly what this table's shape already
  // implies, and is measured behavior-identical to having no `tenancy` block
  // for THIS object on every read path: injection bails on
  // `managedBy: 'better-auth'` before tenancy is consulted
  // (`resolveInjectedSystemColumns`), the SQL driver's `computeTenantField`
  // resolves null either way (no `organization_id`, no `tenantField`), the
  // Layer 0 wall is exempt either way (no `organization_id` column), and the
  // memory/mongo boot guards count only an explicit `enabled: true`. ⛔ Never
  // "upgrade" this to `enabled: true` or move the column to
  // `tenancy.tenantField`: both wall the credential table on an equality that
  // excludes NULL, and every pre-#8287 key vanishes from its own owner's
  // "My Keys" list — the defect #8287 exists to have removed (see the
  // `active_organization_id` field comment below).
  tenancy: { enabled: false },
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
    // "Create Key" mints through the one mint path, `POST /api/v1/keys`
    // (`@objectstack/runtime` `domains/keys.ts`) — the same route the console's
    // own key-minting surfaces call. Not the data API: `create` stays off in
    // `apiMethods` below, and the route pins the row to the CALLER (`user_id`
    // and the active organization are never read from the body), so an admin
    // on Setup's "All" view mints their own key exactly as a user on the
    // Account app's "My Keys" view does. The route answers the raw key ONCE
    // (only its hash is stored), so the response is revealed in a
    // `resultDialog` the user must close — a toast would lose it.
    // `two-factor-one-shot-reveal.test.ts` holds every action on this route to
    // that reveal.
    {
      name: 'create_api_key',
      label: 'Create Key',
      icon: 'plus-circle',
      variant: 'primary',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/keys',
      description: 'Create a key for a script or integration. The key acts as you, with your access, in the organization you are working in now.',
      refreshAfter: true,
      // The route reads `name` (and an optional `expires_at`) and nothing else;
      // a key named nothing is stored as "API Key", so the name is required
      // here to keep the list readable.
      params: [
        { field: 'name', required: true },
      ],
      resultDialog: {
        title: 'API key created',
        description: 'Copy the key now — it is shown only once and cannot be recovered. If it leaks, revoke it and create a new one.',
        acknowledge: 'I have saved the key',
        fields: [
          { path: 'key', label: 'API Key', format: 'secret' },
        ],
      },
    },
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
    // [#21972] Declared FIRST on purpose: a route that names no view opens the
    // first declared list view, so a caller-scoped view (`mine`) is never
    // first. Setup's `nav_api_keys` names this view; the Account app's entry
    // names `mine`.
    all_keys: {
      type: 'grid',
      name: 'all_keys',
      label: 'All',
      data: { provider: 'object', object: 'sys_api_key' },
      columns: ['name', 'prefix', 'user_id', 'active_organization_id', 'expires_at', 'last_used_at', 'revoked'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      // This object is `managedBy: 'better-auth'`, so with no declaration the
      // console draws the shared identity-object fallback ("created by the
      // authentication provider … not added by hand here") — wrong for keys,
      // which are created by hand on this very page.
      emptyState: {
        title: 'No API keys yet',
        message: 'Create a key for scripts and integrations with Create Key; the key is shown once, when it is created.',
      },
    },
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
      emptyState: {
        title: 'You have no API keys yet',
        message: 'Create a key for your scripts and integrations with Create Key; the key is shown once, when it is created.',
      },
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
      emptyState: {
        title: 'No active API keys',
        message: 'Every key that has not been revoked is listed here.',
      },
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
      emptyState: {
        title: 'No revoked keys',
        message: 'A key moves here when it is revoked; clients using it lose access until it is restored.',
      },
    },
  },

  // [ADR-0095 D1, 2026-10-18 note] This object's default row scope: the one
  // policy plugin-security's shipped permission sets spread for it today
  // (the `_self` carve-outs in `default-permission-sets.ts`), moved here
  // verbatim. Layer 0 is inert on this table (no organization column), so Layer 1
  // silence is to mean this scope, not no filter. Not read yet: the sets keep
  // carrying the same literal, and the security plugin's collection is to apply
  // this key when no held set carries a policy for the object. An `extend`
  // contribution cannot set or loosen it (refused at registration).
  defaultRowScope: {
    name: 'sys_api_key_self',
    operation: 'all',
    using: 'user_id == current_user.id',
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

    // [#23367, ruling A] The description used to read "Automatically updated
    // on each API call" while nothing wrote the column at all. Its one writer
    // is now the shared key-admission seam (`resolveApiKeyAdmission`,
    // `@objectstack/core`), throttled to one write per key per hour; the
    // inactivity expiry reads it.
    last_used_at: Field.datetime({
      label: 'Last Used At',
      required: false,
      readonly: true,
      description:
        'Recorded when the key is used, at most once an hour. A key with no recorded use for the inactivity window (90 days by default) is refused until replaced',
      group: 'Lifecycle',
    }),

    revoked: Field.boolean({
      label: 'Revoked',
      defaultValue: false,
      group: 'Lifecycle',
    }),

    // Why the key was revoked, recorded only where the reason changes WHO may
    // restore it. An administrator's forced password reset revokes the user's
    // keys by default because the reset may answer a compromise, so the owner
    // must not be the one to reopen such a key: only a platform administrator
    // restores it, and the owner creates a new key instead.
    //
    // One writer stamps it (plugin-auth `forced-reset-revocation.ts`, beside
    // `revoked: true`), and one hook keeps it in step with `revoked`
    // (plugin-auth `api-key-restore-guard.ts`): it refuses the owner's restore
    // of a key carrying this reason, clears the reason on every restore it
    // admits, and leaves it alone when a revoked key is revoked again.
    // `readonly` for ADR-0092 D4's form-rendering reason: it is not on the D2
    // whitelist, so no data-API write may set or clear it.
    revoked_reason: Field.select({
      label: 'Revoke Reason',
      required: false,
      readonly: true,
      options: [
        { label: 'Administrator password reset', value: 'admin_password_reset' },
      ],
      description:
        'Set when an administrator\'s forced password reset revoked this key. Only a platform administrator can restore such a key; its owner creates a new one. Cleared when the key is restored. Empty for a key revoked from the API Keys list.',
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
      // [commit 3954fb7df] Exact producer bound: the only writer is
      // `packages/core/src/security/api-key.ts` (`hashApiKey` — "sha256(raw)
      // hex — store this in sys_api_key.key"), a fixed 64-hex-char digest.
      // better-auth's apiKey plugin is not loaded, so no other producer exists.
      maxLength: 64,
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
    { fields: ['key'], unique: 'global' },
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
