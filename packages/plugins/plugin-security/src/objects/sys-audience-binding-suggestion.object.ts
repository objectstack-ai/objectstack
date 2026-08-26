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

    // [#11374 route A] Both key columns below declare a bound derived by
    // referenced-column transitivity, and the producer is named per column so
    // the derivation is vetoable in review rather than taken on trust. The pair
    // is the object's declared unique key `(package_id, permission_set_name,
    // anchor)`; unbounded, both were emitted TEXT, MySQL refused the index with
    // `ER_BLOB_KEY_WITHOUT_LENGTH`, and the object landed registered-but-broken
    // — the per-tenant uniqueness this table depends on silently absent.
    //
    // The transitivity is not an analogy here, it is the confirm path itself:
    // `confirmAudienceBindingSuggestion` resolves the row by
    // `find('sys_permission_set', { name: row.permission_set_name })` and, when
    // that misses, materializes it via `upsertPackagePermissionSet(ql,
    // declared.set, row.package_id)` — which writes these two values into
    // `sys_permission_set.name` and `sys_permission_set.package_id`. So a
    // suggestion is confirmable exactly when its two key values fit the columns
    // `sys_permission_set` declares, and those columns are what bound these.

    package_id: Field.text({
      label: 'Package',
      required: true,
      readonly: true,
      // Producer: the owning package's manifest id (`manifest.id`, or the
      // `_packageId` the metadata layer stamps) — `collectDeclaredSuggestions`
      // reads one of those two and `syncAudienceBindingSuggestions` writes it
      // here verbatim. Bounded at 255 because the SAME boot pass writes the
      // SAME value into `sys_permission_set.package_id` (maxLength: 255), and
      // every landed column of this value class agrees: `sys_capability
      // .package_id`, `sys_metadata.package_id`, `sys_metadata_commit
      // .package_id`. A package id too wide for those cannot own a
      // materialized permission set, so it cannot produce a confirmable
      // suggestion either. Measured against the in-repo corpus, the longest
      // real reverse-domain package id is 57 characters — the floor is cleared
      // with room to spare.
      maxLength: 255,
      description: 'Owning package that ships the suggested permission set (ADR-0086 D3 provenance).',
    }),

    permission_set_name: Field.text({
      label: 'Permission Set',
      required: true,
      readonly: true,
      // Producer: the declared set's own `name` (spec `PermissionSetSchema
      // .name`), written here as `d.set.name`. Bounded at 100 by
      // referenced-column transitivity from `sys_permission_set.name`
      // (maxLength: 100) — the column this value must resolve against, as this
      // field's own description says and as the confirm path literally does.
      //
      // The ceiling is MEASURED at the write seam, not inferred from the
      // declaration. On a real ObjectQL engine over a real SqlDriver, inserting
      // a longer name into `sys_permission_set` is refused before the driver is
      // reached:
      //   len 101 → ValidationError: API Name must be ≤ 100 characters (got 101)
      //   len 120 / 255 / 256 / 300 → the same refusal
      // (`objectql`'s `record-validator.ts` `max_length` check). So no
      // permission set whose name exceeds 100 characters can exist, and a
      // suggestion naming one could never be confirmed:
      // `confirmAudienceBindingSuggestion` answers `SuggestionStateError`
      // ("Permission set '…' is not materialized in sys_permission_set").
      // Bounding at 100 therefore refuses nothing that is storable today.
      //
      // 100 and not the 255 its `package_id` sibling takes: the two columns
      // reference DIFFERENT columns and inherit their widths independently.
      // The in-package precedent for exactly this shape is
      // `sys_user_position.position` — "Position machine name (references
      // sys_position.name)", maxLength 100 against `sys_position.name`'s 100.
      //
      // ⚠️ The bound is transitive, not intrinsic: `PermissionSetSchema.name`
      // is `SnakeCaseIdentifierSchema`, which carries `.min(2)` and NO `.max()`,
      // so the SPEC does not bound identifier length — every cap on this value
      // class comes from the columns that store it. Filed separately; if
      // `sys_permission_set.name` is ever widened, the pin beside this file is
      // where this bound is re-derived rather than rediscovered on MySQL.
      maxLength: 100,
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
