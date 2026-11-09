/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Why a recycle-bin restore was refused, in the user's language
 * (ADR-0148 D2).
 *
 * A restore refuses with a reason and never forces a write. The restore door
 * (`POST {data}/:object/recycle-bin/:entryId/restore`) answers each reason as
 * its own code in the ADR-0112 envelope, with the rows it names in
 * `details`; this module turns that code into one sentence. Every code the
 * door answers has its own pack key under `recycleBin.refusal`, so a refusal
 * never reads as a generic failure. A code it does not know answers
 * `undefined`, and the caller keeps its generic failure copy.
 *
 * One reader for every surface that restores: the Undo action on a delete
 * toast and the admin recycle-bin page both call it. The host's translator is
 * injected, so `@object-ui/core` takes no i18n dependency; so are the label
 * resolvers, since only the host holds the object definitions.
 */

/** Translate a key — the host's `t`. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Labels the host can resolve; each falls back to the machine name. */
export interface RecycleBinRefusalLabels {
  /** The label of an object, by name. */
  objectLabel?: (object: string) => string | undefined;
  /** The label of a field of an object. */
  fieldLabel?: (object: string, field: string) => string | undefined;
}

/**
 * Each code the restore door answers → its `recycleBin.refusal.*` key. The
 * four 409s are the spec's `RECYCLE_BIN_RESTORE_REFUSAL_CODES`; the other
 * three are the door's own answers (the entry is gone, the caller may not
 * restore it, the deployment has no recycle bin).
 */
export const RECYCLE_BIN_RESTORE_REFUSAL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  RESTORE_UNIQUE_VALUE_TAKEN: 'recycleBin.refusal.uniqueValueTaken',
  RESTORE_PARENT_PURGED: 'recycleBin.refusal.parentPurged',
  RESTORE_PACKAGE_UNINSTALLED: 'recycleBin.refusal.packageUninstalled',
  RESTORE_PARENT_IN_RECYCLE_BIN: 'recycleBin.refusal.parentInRecycleBin',
  RECORD_NOT_FOUND: 'recycleBin.refusal.notFound',
  PERMISSION_DENIED: 'recycleBin.refusal.permissionDenied',
  NOT_IMPLEMENTED: 'recycleBin.refusal.notAvailable',
});

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The sentence for a refused restore, or `undefined` when `error` carries no
 * code this module knows (the caller then shows its generic failure).
 *
 * The code is read from `error.code`, where the SDK puts the envelope's
 * `error.code`; the rows the refusal names from `error.details`.
 */
export function recycleBinRestoreRefusalText(
  t: Translate,
  error: unknown,
  labels: RecycleBinRefusalLabels = {},
): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = text((error as { code?: unknown }).code);
  const key = code ? RECYCLE_BIN_RESTORE_REFUSAL_KEYS[code] : undefined;
  if (!key) return undefined;
  const details = ((error as { details?: unknown }).details ?? {}) as Record<string, unknown>;
  const objectName = text(details.object);
  const parentName = text(details.parentObject);
  const fieldName = text(details.field);
  const objectLabelOf = (name: string | undefined) => (name ? labels.objectLabel?.(name) || name : '');
  return t(key, {
    object: objectLabelOf(objectName),
    parent: objectLabelOf(parentName),
    field: fieldName ? (objectName && labels.fieldLabel?.(objectName, fieldName)) || fieldName : '',
  });
}
