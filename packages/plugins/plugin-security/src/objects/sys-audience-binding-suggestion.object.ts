// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_audience_binding_suggestion — a package's install-time SUGGESTION to
 * give one of its permission sets to every signed-in member through the
 * `everyone` audience anchor (ADR-0090 D5/D9), and the deployment's decision
 * on it.
 *
 * A package declaring `isDefault: true` on a permission set is asking: "give
 * this set to everyone who signs in". It is NEVER auto-bound — installing a
 * package must not silently widen every user's access. Rows are produced
 * (pending) when the declaration is observed — boot, package-door publish, or
 * the suggested-bindings list endpoint — and resolved when a caller holding
 * `manage_metadata` (under a wall, the platform operator) accepts or dismisses
 * it. An acceptance is ONE decision for the whole deployment and it takes
 * effect: the security plugin derives the `everyone` anchor's definition as
 * the baseline plus every accepted set (#22801 → A).
 *
 * The record is deployment-level, so every row is owned by the Default
 * Organization (ADR-0131 D3/D5); a row another organization owns was a tenant
 * administrator's per-organization answer before the acceptance was
 * deployment-level, and is not read.
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
  description: 'Package-suggested everyone-anchor grant and the deployment-level decision on it (ADR-0090 D5/D9).',
  titleFormat: '{package_id}: {permission_set_name} → {anchor}',
  highlightFields: ['package_id', 'permission_set_name', 'anchor', 'status'],

  fields: {
    id: Field.text({
      label: 'Suggestion ID',
      required: true,
      readonly: true,
      description: 'UUID of the suggestion row.',
    }),

    // [commit f64668d3c, route A] Both key columns below declare a bound derived by
    // referenced-column transitivity, and the producer is named per column so
    // the derivation is vetoable in review rather than taken on trust. The pair
    // is the object's declared unique key `(package_id, permission_set_name,
    // anchor)`; unbounded, both were emitted TEXT, MySQL refused the index with
    // `ER_BLOB_KEY_WITHOUT_LENGTH`, and the object landed registered-but-broken
    // — the per-tenant uniqueness this table depends on silently absent.
    //
    // The bounds were derived when the confirm path materialized the set into
    // `sys_permission_set` (its `name` and `package_id` columns). The confirm
    // now reads the set from the security catalog instead; the bounds stand,
    // because the same values still name a package and a set there, and no
    // stored row exceeds them.

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
      // permission set whose name exceeds 100 characters could be materialized,
      // so no suggestion naming one was ever confirmable. Bounding at 100
      // therefore refused nothing that was storable.
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
      description: 'Name of the suggested permission set (resolved in the security catalog at confirm time).',
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
      description: 'pending = awaiting a decision; confirmed = the everyone definition carries the set (accepted, or observed in the baseline); dismissed = declined or revoked.',
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'dismissed', label: 'Dismissed' },
      ],
    }),

    deployment_decision: Field.boolean({
      label: 'Deployment Decision',
      required: false,
      defaultValue: false,
      readonly: true,
      description: 'True when a manage_metadata holder accepted or dismissed the suggestion for the whole deployment. Only an accepted row with this flag widens the everyone anchor; a row resolved without it was observed, or decided by a tenant administrator before the acceptance was deployment-level, and is re-opened unless the baseline already names the set.',
    }),

    resolved_by: Field.lookup('sys_user', {
      label: 'Resolved By',
      required: false,
      description: 'Who accepted or dismissed. Empty on a confirmed row means the set was observed in the everyone definition (the deployment baseline), not accepted through the prompt.',
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
    //
    // Since #22801 → A every row is the Default Organization's (the record is
    // deployment-level), so within the rows this surface reads the key is
    // unique per deployment; another organization's rows are earlier
    // per-organization answers, kept unread.
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
