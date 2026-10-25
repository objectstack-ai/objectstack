/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How `RecordDetailView` partitions the framework-injected system columns
 * (spec `FIELD_GROUP_SYSTEM_FIELDS`) between its two treatments:
 *
 *  - the four audit-provenance columns (`AUDIT_FIELD_NAMES`, single source in
 *    `@object-ui/types`) are rendered as a single subtle one-line
 *    `<RecordMetaFooter>` (see `@object-ui/plugin-detail`) so provenance stays
 *    discoverable without a heavy "System Information" panel;
 *  - every other system column is hidden from the auto-generated body
 *    sections outright — tenancy / soft-delete bookkeeping carries no business
 *    value on a detail page. Authors who really want to surface one can
 *    assign it to a `fieldGroups` group explicitly (explicit listing wins).
 *
 * `HIDDEN_SYSTEM_FIELD_NAMES` is derived as spec-set minus audit-set rather
 * than restated (objectui#3017): a system column the framework starts
 * injecting tomorrow is bookkeeping until someone deliberately surfaces it,
 * so it should default to hidden without waiting for a hand-list edit here.
 * `record-detail-system-fields.test.ts` pins the partition's invariants.
 */

import { AUDIT_FIELD_NAMES } from '@object-ui/types';
import { FIELD_GROUP_SYSTEM_FIELDS } from '@objectstack/spec/data';

export { AUDIT_FIELD_NAMES };

/** Framework-injected bookkeeping columns hidden from detail body sections. */
export const HIDDEN_SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set(
  [...FIELD_GROUP_SYSTEM_FIELDS].filter((name) => !AUDIT_FIELD_NAMES.has(name)),
);
