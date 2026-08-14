// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_audience_binding_suggestion — a package's install-time SUGGESTION to
 * bind one of its permission sets to an audience anchor (ADR-0090 D5/D9).
 *
 * A package declaring `isDefault: true` on a permission set is asking the
 * admin: "bind this set to the `everyone` position so authenticated users
 * get it by default". It is NEVER auto-bound — installing a package must not
 * silently widen every tenant user's access. This table is the queryable
 * surface between the two moments: rows are produced (pending) when the
 * declaration is observed — boot seeding, package-door publish, or the
 * suggested-bindings list endpoint syncing against installed manifests — and
 * resolved when a tenant admin confirms (the binding row is created under
 * the D5/D9 anchor gate + D12 delegated-admin gate) or dismisses.
 *
 * Rows are system-managed: the API surface is read-only (get/list); state
 * changes flow exclusively through the `security` service confirm/dismiss
 * methods so the gates cannot be sidestepped by a generic data write.
 *
 * @namespace sys
 */
export const SysAudienceBindingSuggestion = ObjectSchema.create({
  name: 'sys_audience_binding_suggestion',
  label: 'Audience Binding Suggestion',
  pluralLabel: 'Audience Binding Suggestions',
  icon: 'shield-question',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Package-suggested audience-anchor binding awaiting admin confirmation (ADR-0090 D5/D9).',
  titleFormat: '{package_id}: {permission_set_name} → {anchor}',
  highlightFields: ['package_id', 'permission_set_name', 'anchor', 'status'],

  fields: {
    id: Field.text({
      label: 'Suggestion ID',
      required: true,
      readonly: true,
      description: 'UUID of the suggestion row.',
    }),

    package_id: Field.text({
      label: 'Package',
      required: true,
      readonly: true,
      description: 'Owning package that ships the suggested permission set (ADR-0086 D3 provenance).',
    }),

    permission_set_name: Field.text({
      label: 'Permission Set',
      required: true,
      readonly: true,
      description: 'Name of the suggested permission set (resolved against sys_permission_set at confirm time).',
    }),

    anchor: Field.select({
      label: 'Audience Anchor',
      required: true,
      readonly: true,
      defaultValue: 'everyone',
      description: 'Audience anchor position the package suggests binding to (ADR-0090 D9).',
      options: [
        { value: 'everyone', label: 'Everyone' },
        { value: 'guest', label: 'Guest' },
      ],
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      defaultValue: 'pending',
      description: 'pending = awaiting admin decision; confirmed = binding exists; dismissed = admin declined.',
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'dismissed', label: 'Dismissed' },
      ],
    }),

    resolved_by: Field.lookup('sys_user', {
      label: 'Resolved By',
      required: false,
      description: 'Admin who confirmed/dismissed. Empty on a confirmed row means the binding was observed (e.g. bound at boot or by hand), not confirmed through the prompt.',
    }),

    resolved_at: Field.datetime({
      label: 'Resolved At',
      required: false,
      description: 'When the suggestion left the pending state.',
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
  },

  indexes: [
    // [#8577] Scope spelled EXPLICITLY (ADR-0120 D1). On a DECLARED index bare
    // `unique: true` is the positional spelling of `'global'` — the listed
    // columns VERBATIM — so `(package_id, permission_set_name, anchor)` was an
    // installation-wide key on a tenant-scoped object.
    //
    // ⚠️ This is not the class's usual naming oracle. The key is the owning
    // package's id, the PACKAGE'S OWN permission-set name and the anchor —
    // the SAME TRIPLE for every tenant that installs the same package — while
    // the row is per-tenant by construction (produced when the declaration is
    // observed, resolved when a TENANT ADMIN confirms). So the second and every
    // later organization to install a package never got its suggestion row:
    // its admins were never prompted and its users never received the package's
    // default permission set. ADR-0090 D5/D9 exists so this is never
    // auto-bound; the effect was that for every tenant after the first it was
    // never bound AT ALL, and nothing said so —
    // `syncAudienceBindingSuggestions` swallows the insert failure in a bare
    // `catch` (read as a benign concurrent-sync race).
    //
    // Measured live before the fix (real SqlDriver, better-sqlite3,
    // OS_TENANCY_POSTURE=isolated, this shipped declaration):
    // org_jia creates (com.acme.crm, sales_readonly, everyone) 201 / org_yi the
    // SAME triple 409 UNIQUE_VIOLATION / org_yi (com.acme.crm, other_set,
    // everyone) 201 / org_yi (com.other.pkg, sales_readonly, everyone) 201 /
    // org_yi (com.acme.crm, sales_readonly, guest) 201 / org_yi's own GET on
    // the colliding triple 0 rows. And through the REAL sync on a real engine:
    // org_jia created 1, org_yi created 0 with no throw and no log line.
    //
    // ⚠️ This is the STORAGE half only. `syncAudienceBindingSuggestions` still
    // reads and writes through a tenant-less `{ isSystem: true }` context, so
    // the shipped path writes ONE organization-less row every tenant reads —
    // measured, and filed as #8617. Until that lands, this respelling is what
    // makes a per-organization row possible, not what produces one.
    { fields: ['package_id', 'permission_set_name', 'anchor'], unique: 'organization' },
    { fields: ['status'] },
    { fields: ['package_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Read-only over the generic data API — confirm/dismiss go through the
    // `security` service so the anchor + delegated-admin gates always apply.
    apiMethods: ['get', 'list'],
  },
});
