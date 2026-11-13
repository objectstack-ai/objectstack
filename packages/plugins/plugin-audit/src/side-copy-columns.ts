// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32442, GHSA-2985-5f64-8wgh] Columns a ledger copy of a row never carries
 * because their stored value is ANOTHER record's field values, served on its
 * own row only through its owner's per-reader narrowing. A copy cannot be
 * narrowed that way, so it holds none of them.
 *
 * One list, read by every place that holds a copy to it:
 *
 *  - the audit writer (`ledgerView` in `audit-writers.ts`) omits the columns
 *    from every new `sys_audit_log` / `sys_activity` copy at write time;
 *  - the at-rest rewrite (`side-copy-migration.ts`) removes them from copies
 *    written before;
 *  - until that rewrite has run, the two serve-time redactions drop them
 *    (`activity-field-redaction.ts`, `audit-log-field-redaction.ts`) and the
 *    two query guards refuse a non-system query that names a carrying column
 *    when its reach includes a listed object (`parent-field-query-guard.ts`).
 *
 * The list follows `key-material-copy.ts`: closed, declared, by object name.
 */

/** Per object: the columns no ledger copy of its rows carries. */
export const SIDE_COPY_COLUMNS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  // The approvals request's subject snapshot (`plugin-approvals`).
  ['sys_approval_request', Object.freeze(['payload_json'])],
]);

/** The objects {@link SIDE_COPY_COLUMNS} lists. */
export const SIDE_COPY_OBJECTS: readonly string[] = [...SIDE_COPY_COLUMNS.keys()];

/** The listed columns of `objectName` — empty for an object the list does not name. */
export function sideCopyColumnsOf(objectName: unknown): readonly string[] {
  return typeof objectName === 'string' ? SIDE_COPY_COLUMNS.get(objectName) ?? [] : [];
}

/**
 * Omit the listed columns from one copy of an `objectName` row, IN PLACE.
 * Returns whether any column was removed, so the at-rest rewrite is idempotent.
 */
export function omitSideCopyFromCopy(objectName: unknown, copy: Record<string, unknown>): boolean {
  let changed = false;
  for (const column of sideCopyColumnsOf(objectName)) {
    if (!(column in copy)) continue;
    delete copy[column];
    changed = true;
  }
  return changed;
}
