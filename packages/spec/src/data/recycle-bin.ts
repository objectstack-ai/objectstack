// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [ADR-0148 D5, Rollout step 2] The recycle bin's spec half (card #30235,
// parent #3146; ruling 6629858351, D7's eight choices ratified 6659364907).
// Every name below is DECLARED here and READ elsewhere: the engine's delete,
// restore, purge and empty paths and the TTL reap land with #30237, the
// Console's admin page and toast with #30239, and the cloud distribution is
// the retention hook's one caller. Nothing in this module writes or reads the
// bin at runtime.

import { z } from 'zod';

/**
 * The recycle bin: one system object, one entry per delete operation
 * (ADR-0148 D1).
 *
 * On delete the engine snapshots the rows the delete removes, the master and
 * its master-detail cascade in cascade order, into one entry of this object,
 * and then deletes physically as before. A restore writes the rows back under
 * their original ids; a purge removes the entry. No read path filters on it.
 * The object is declared by `@objectstack/platform-objects` (`SysRecycleBin`)
 * and stored by the default datasource, like every `sys_*` object.
 */
export const RECYCLE_BIN_OBJECT = 'sys_recycle_bin' as const;

/**
 * The environment variable that sets the default retention, in days
 * (ADR-0148 D3). Read when the host's retention resolver answers nothing.
 * Its value follows {@link RecycleBinRetentionDaysEnvSchema}.
 */
export const RECYCLE_BIN_RETENTION_DAYS_ENV = 'OS_RECYCLE_BIN_RETENTION_DAYS' as const;

/**
 * The retention default, in days, when neither the host's retention resolver
 * nor {@link RECYCLE_BIN_RETENTION_DAYS_ENV} answers (ADR-0148 D3).
 */
export const RECYCLE_BIN_DEFAULT_RETENTION_DAYS = 30 as const;

/**
 * The host retention resolver hook (ADR-0148 D3).
 *
 * The same pattern as the runtime config plugin's `resolveFeatures`: the host
 * passes the hook in, and the framework calls it with the same opaque token
 * `resolveFeatures` receives. The framework never interprets the token. It
 * knows days, never plans: no plan name, catalog or entitlement is named on
 * this side of the hook.
 *
 * The answer is a positive whole number of days, or `undefined` for nothing.
 * Nothing keeps the default: {@link RECYCLE_BIN_RETENTION_DAYS_ENV}, else
 * {@link RECYCLE_BIN_DEFAULT_RETENTION_DAYS}. Any other answer (zero, a
 * negative or fractional number, `NaN`, `null`, a string) is refused as a
 * configuration defect with {@link recycleBinRetentionRefusal}; it is never
 * read as "purge now" or "keep forever".
 *
 * The engine asks once per delete operation and stamps the answer on the
 * entry as its purge deadline, so a later change of the host's answer never
 * shortens a window a person was already shown.
 */
export type RecycleBinRetentionResolver = (token: string | undefined) => number | undefined;

/**
 * Where a retention value came from — named in the refusal text, so the
 * operator knows which setting to fix.
 */
export type RecycleBinRetentionSource = 'resolver' | 'env';

/**
 * The refusal text for a retention value that is not a positive whole number
 * of days. One sentence set for both sources, so the hook's caller and the
 * operator who set the variable read the same rule.
 */
export function recycleBinRetentionRefusal(source: RecycleBinRetentionSource, value: unknown): string {
  const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);
  const where = source === 'resolver'
    ? 'The host retention resolver answered'
    : `${RECYCLE_BIN_RETENTION_DAYS_ENV} is set to`;
  const fix = source === 'resolver'
    ? 'Answer a positive whole number of days, or undefined to keep the default.'
    : `Set it to a positive whole number of days, or unset it to keep the default of ${RECYCLE_BIN_DEFAULT_RETENTION_DAYS}.`;
  return `${where} ${shown}, which is not a recycle-bin retention: the retention is a positive whole number ` +
    `of days, and zero or a value that is not such a number is a configuration defect, never "purge now" or ` +
    `"keep forever". ${fix}`;
}

/**
 * A retention the host retention resolver answers: a positive whole number of
 * days. `undefined` (nothing) is checked before this schema, by the caller.
 */
export const RecycleBinRetentionDaysSchema = z.number({
  error: (issue) => recycleBinRetentionRefusal('resolver', issue.input),
}).int({
  error: (issue) => recycleBinRetentionRefusal('resolver', issue.input),
}).positive({
  error: (issue) => recycleBinRetentionRefusal('resolver', issue.input),
}).describe('Recycle-bin retention in days: a positive whole number');

/**
 * The value {@link RECYCLE_BIN_RETENTION_DAYS_ENV} may hold: the decimal
 * digits of a positive whole number of days, no sign, no leading zero. An
 * unset or empty variable keeps the default; the caller checks that first.
 */
export const RecycleBinRetentionDaysEnvSchema = z.string().regex(/^[1-9][0-9]*$/, {
  error: (issue) => recycleBinRetentionRefusal('env', issue.input),
}).describe(`${RECYCLE_BIN_RETENTION_DAYS_ENV}: the decimal digits of a positive whole number of days`);

/**
 * One snapshotted row of a recycle-bin entry: the object, the id it is
 * restored under, and the row's values as they stood at delete time.
 * Secret-channel refs are left out of `values` (ADR-0148 D4): a restored
 * record's secret fields come back empty.
 */
export const RecycleBinSnapshotRowSchema = z.object({
  object: z.string().min(1).describe('Object name of the deleted row'),
  id: z.string().min(1).describe('The row id, restored unchanged'),
  values: z.record(z.string(), z.unknown())
    .describe('The row as it stood at delete time, secret-channel refs left out'),
}).describe('One snapshotted row of a recycle-bin entry');

/**
 * A reference the delete cleared (a `set_null` lookup pointing at a removed
 * row). A restore re-links it only if the field still holds no value
 * (ADR-0148 D2): a reference somebody pointed elsewhere since stays put.
 */
export const RecycleBinClearedReferenceSchema = z.object({
  object: z.string().min(1).describe('Object of the live row whose reference was cleared'),
  id: z.string().min(1).describe('Id of the live row whose reference was cleared'),
  field: z.string().min(1).describe('The lookup field the delete cleared'),
  value: z.string().min(1).describe('The id the field held, a row in this entry'),
}).describe('A set_null reference the delete cleared, re-linked on restore when still empty');

/**
 * The snapshot a recycle-bin entry holds (ADR-0148 D1): the cascade set, the
 * master first and its details in cascade order, and the references the
 * delete cleared. The entry is the unit of restore: a detail that went with
 * its master comes back with its master, never alone.
 */
export const RecycleBinSnapshotSchema = z.object({
  rows: z.array(RecycleBinSnapshotRowSchema).min(1)
    .describe('The removed rows, the master first, then its details in cascade order'),
  clearedReferences: z.array(RecycleBinClearedReferenceSchema)
    .describe('The set_null references the delete cleared'),
}).describe('The cascade set a recycle-bin entry holds');

/**
 * The three reasons a restore refuses (ADR-0148 D2), each a code in the
 * ADR-0112 envelope, registered under `@objectstack/objectql` in the
 * error-code ledger. A restore refuses with the reason and never forces a
 * write; each reason is permanent for that entry.
 *
 * - `RESTORE_UNIQUE_VALUE_TAKEN`: a unique value of a snapshotted row is held
 *   by a live row now.
 * - `RESTORE_PARENT_PURGED`: a row's master-detail parent is neither live nor
 *   in the bin.
 * - `RESTORE_PACKAGE_UNINSTALLED`: an object of the entry no longer exists in
 *   the registry; its package was uninstalled.
 *
 * All three answer HTTP 409: the entry is intact, and the live state conflicts
 * with writing it back.
 */
export const RECYCLE_BIN_RESTORE_REFUSAL_CODES = Object.freeze({
  uniqueValueTaken: 'RESTORE_UNIQUE_VALUE_TAKEN',
  parentPurged: 'RESTORE_PARENT_PURGED',
  packageUninstalled: 'RESTORE_PACKAGE_UNINSTALLED',
} as const);

/** One of the three restore refusal codes. */
export type RecycleBinRestoreRefusalCode =
  (typeof RECYCLE_BIN_RESTORE_REFUSAL_CODES)[keyof typeof RECYCLE_BIN_RESTORE_REFUSAL_CODES];

/** The HTTP status every restore refusal answers. */
export const RECYCLE_BIN_RESTORE_REFUSAL_STATUS = 409 as const;

// [#30235] named here; [#30237] the engine's restore emits it, and adds it to
// `DataEventType` and `RealtimeEventType` in the change that emits it, spelled
// through this constant.
/**
 * The event a restore emits (ADR-0148 D2). A restore is never a create: a
 * flow triggered on record creation does not fire, flow enrollments are not
 * restored, audit records a restore as a restore, and rollups recompute from
 * the rows that are back.
 *
 * NAMED, NOT YET EMITTED. `DataEventType` and `RealtimeEventType` list only
 * the events the engine emits, so a subscription can never wait on a name
 * that does not fire; this name joins both in the change that emits it.
 */
export const RECORD_RESTORED_EVENT = 'data.record.restored' as const;

/**
 * The two recycle-bin grants, object permission keys (ADR-0148 D2):
 *
 * - `allowRestoreOwnDeleted`: restore the entries of this object the caller
 *   deleted.
 * - `manageRecycleBin`: list every entry of this object, restore any, and
 *   purge them (emptying the bin purges every entry the caller manages).
 *
 * New spellings on purpose: the retired `allowRestore` / `allowPurge` stay
 * tombstoned.
 */
export const RECYCLE_BIN_GRANT_KEYS = Object.freeze({
  restoreOwnDeleted: 'allowRestoreOwnDeleted',
  manage: 'manageRecycleBin',
} as const);
