/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Canonical names of the framework-managed system / audit / ownership columns
 * that `applySystemFields` auto-provisions onto business objects (record
 * identity, audit `*_at` / `*_by`, soft-delete bookkeeping, and the
 * reassignable ownership / tenant FKs).
 *
 * This is the DISPLAY-oriented set: it deliberately includes the *editable*
 * ownership/tenant lookups (`owner_id`, `organization_id`, `tenant_id`,
 * `company_id`, `space`) so that surfaces which separate bookkeeping from
 * business data — auto-derived list columns, record pickers, related lists —
 * don't lead with them. It is intentionally BROADER than the inline-edit
 * "never editable" set (`owner_id` IS reassignable), which lives separately in
 * `@object-ui/plugin-detail`.
 *
 * Prefer {@link isSystemManagedField}, which also honours the spec `system`
 * flag (the single source of truth stamped by the registry) so future injected
 * fields are covered without touching this list.
 */
export const SYSTEM_MANAGED_FIELD_NAMES: ReadonlySet<string> = new Set<string>([
  // Record identity
  'id', '_id', '__v', '_version', '_rev',
  // Audit
  'created', 'created_at', 'createdAt', 'created_by', 'createdBy',
  'modified', 'modified_by',
  'updated_at', 'updatedAt', 'updated_by', 'updatedBy',
  // Soft-delete / lifecycle bookkeeping
  'deleted', 'deleted_at', 'deletedAt', 'is_deleted', 'instance_state', 'locked',
  // Ownership / tenancy (framework-injected, editable)
  'owner_id', 'organization_id', 'tenant_id', 'company_id', 'space',
]);

/**
 * The four audit-provenance columns `applySystemFields` injects on every
 * business object, keyed by display role.
 *
 * Single source for the surfaces that treat provenance specially
 * (objectui#3017): `RecordMetaFooter` (`@object-ui/plugin-detail`) renders
 * exactly these four as the one-line footer, and `RecordDetailView`
 * (`@object-ui/app-shell`) excludes the same four from the auto-generated
 * body sections so they only appear in that footer. The snake_case values are
 * the wire names the framework stores — they are a strict subset of the
 * spec's `FIELD_GROUP_SYSTEM_FIELDS` (asserted in `system-fields.test.ts`).
 */
export const AUDIT_FIELD_BY_ROLE = {
  createdAt: 'created_at',
  createdBy: 'created_by',
  updatedAt: 'updated_at',
  updatedBy: 'updated_by',
} as const;

/** Wire name of one audit-provenance column. */
export type AuditFieldName = (typeof AUDIT_FIELD_BY_ROLE)[keyof typeof AUDIT_FIELD_BY_ROLE];

/** {@link AUDIT_FIELD_BY_ROLE} as a set, for name-filtering call sites. */
export const AUDIT_FIELD_NAMES: ReadonlySet<string> = new Set<string>(
  Object.values(AUDIT_FIELD_BY_ROLE),
);

/**
 * Whether a field is a framework-managed system / audit / ownership column
 * rather than an author-declared business field.
 *
 * Branches on the spec `system` flag first — the single source of truth the
 * registry (`applySystemFields`) stamps on every field it injects — and falls
 * back to {@link SYSTEM_MANAGED_FIELD_NAMES} for metadata that predates the
 * flag or arrives without it. Default list-column derivation uses this so
 * injected fields (notably `owner_id`, which is non-hidden and non-readonly
 * because ownership is reassignable) never lead the auto-derived columns.
 */
export function isSystemManagedField(
  name: string,
  field?: { system?: boolean } | null,
): boolean {
  return field?.system === true || SYSTEM_MANAGED_FIELD_NAMES.has(name);
}
