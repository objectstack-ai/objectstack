/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * System / audit field names that are **never user-editable** — the framework's
 * `applySystemFields` owns them (created_x, updated_x, modified_x) plus record
 * identity and soft-delete bookkeeping. Used by the inline-edit gate so a
 * double-click / pencil is never offered on them, even when a detail schema
 * happens to surface one and doesn't flag it `readonly`.
 *
 * Intentionally NARROWER than the display-oriented system-field sets in
 * `deriveLookupColumns.ts` / `RecordDetailDrawer.tsx`: it deliberately EXCLUDES
 * `owner_id` / `organization_id` / `tenant_id` / `company_id` / `space`, which
 * are legitimately editable in some contexts (e.g. reassigning the owner). This
 * set is only the immutable, framework-managed bookkeeping fields.
 */
export const NON_EDITABLE_SYSTEM_FIELDS = new Set<string>([
  'id', '_id', '__v',
  'created', 'created_at', 'createdAt', 'created_by',
  'modified', 'modified_by',
  'updated_at', 'updatedAt', 'updated_by',
  'deleted_at', 'is_deleted', 'deleted',
  'instance_state',
]);
