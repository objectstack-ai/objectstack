// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D7 / ADR-0092 D2] Extension fields ObjectStack adds to
 * better-auth-managed objects, and which of them a generic write surface may
 * edit.
 *
 * ## Two field populations on one table
 *
 * A `managedBy: 'better-auth'` object carries two kinds of column:
 *
 *  - **Protocol fields** — better-auth's own (`email`, `slug`, `sys_member.role`,
 *    …). Mutations must flow through better-auth's endpoints so hashing, token
 *    signing, invitation flows and membership invariants all fire. The identity
 *    write guard rejects direct writes to them, full stop.
 *  - **Extension fields** — columns ObjectStack (or an app) adds for platform
 *    concerns better-auth knows nothing about: `sys_user.manager_id`,
 *    `sys_organization.require_mfa`, and the ADR-0105 D6 group-structure
 *    fields. better-auth never reads or writes these, so they can be edited
 *    through the ordinary path under normal FLS / `requiredPermissions`.
 *
 * ADR-0092 made the *guard* registry-driven with a per-object update whitelist;
 * `sys_user → {name, image}` was its first and only entry. This module is the
 * home for the rest, so "which fields on a managed table are ours, and which of
 * those are editable" is answered in ONE place instead of per call site.
 *
 * ## The collision rule (D7)
 *
 * An extension field name must NEVER collide with better-auth's own schema
 * surface for that table. A collision would silently transfer ownership of a
 * column on a library upgrade — our writes would start clobbering better-auth
 * state, or vice versa, with no error anywhere. `managed-extension-fields.test.ts`
 * derives better-auth's real field surface from `getAuthTables()` at the PINNED
 * version and fails the build on any overlap, so the upgrade that would cause
 * this is the moment someone finds out.
 */

/** Object name → the extension fields ObjectStack declares on it. */
export const MANAGED_EXTENSION_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  sys_user: new Set([
    'manager_id',
    'primary_business_unit_id',
    'ai_access',
    'phone_number',
    'source',
  ]),
  sys_organization: new Set([
    // ADR-0069 D3 — per-org MFA tightening above the global floor.
    'require_mfa',
    // ADR-0105 D6 — group structure. Reporting dimension ONLY: no permission
    // inheritance walks this reference (lint-enforced).
    'parent_organization_id',
    'sort_order',
  ]),
};

/**
 * Object name → the extension fields a generic write surface (edit form, data
 * API) may update, subject to the usual FLS / `requiredPermissions` checks.
 *
 * A subset of {@link MANAGED_EXTENSION_FIELDS} by construction: listing a field
 * as ours does NOT make it editable. `manager_id` / `primary_business_unit_id`
 * / `ai_access` stay admin-surface-only (ADR-0092 D1's tier table), and
 * `primary_business_unit_id` is a projection plugin-sharing maintains — a hand
 * edit would be overwritten on the next reconcile.
 */
export const MANAGED_EXTENSION_EDITABLE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  sys_organization: new Set([
    'require_mfa',
    'parent_organization_id',
    'sort_order',
  ]),
};

/** The extension fields declared on `object`, or an empty set. */
export function managedExtensionFields(object: string): ReadonlySet<string> {
  return MANAGED_EXTENSION_FIELDS[object] ?? new Set<string>();
}

/** The generically-editable extension fields on `object`, or an empty set. */
export function managedExtensionEditableFields(object: string): ReadonlySet<string> {
  return MANAGED_EXTENSION_EDITABLE_FIELDS[object] ?? new Set<string>();
}
