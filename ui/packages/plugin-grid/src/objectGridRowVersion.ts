/**
 * The optimistic-concurrency helpers of `ObjectGrid` (`./ObjectGrid.tsx`): the
 * row's version token, the version a row save sends, and the conflict and
 * batch-save outcome types, moved out of that file verbatim
 * (objectstack#25994, slice 1).
 */

import type { DataTableSchema } from '@object-ui/types';

/**
 * The row key that carries a record's optimistic-concurrency token
 * (objectui#12292): `updated_at`, the key the record surfaces send as
 * `If-Match`.
 */
export const OCC_TOKEN_FIELD = 'updated_at';

/**
 * The concurrency token a row carries, read exactly as the record surfaces read
 * it (`occVersionOf` in `plugin-form`, the save in `plugin-detail`'s
 * `InlineEditSaveBar`): a non-empty string `updated_at`. Anything else (a
 * backend without timestamps, a row read without the column) answers
 * `undefined`, and the write goes out unguarded, as it did before.
 */
export function rowVersionOf(row: unknown): string | undefined {
  const v = (row as Record<string, unknown> | null | undefined)?.[OCC_TOKEN_FIELD];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** What this grid remembers about its last landed write to one record. */
export interface WrittenRowVersion {
  /** The token the row carried when that write was made: the read it superseded. */
  readVersion: string;
  /** The token of the record the server answered that write with. */
  version: string;
}

/**
 * The `ifMatch` a row save sends: the rule `plugin-form`'s `versionToSend`
 * applies to a form that stays open (objectui#10565), applied to a row.
 *
 * A saved row keeps the token it was READ with until the grid re-reads it, and
 * that token stopped being current the moment this grid's own write landed. So
 * while the row still carries the read a landed write superseded, the version
 * that write answered with is sent. A row carrying any other token is a newer
 * read, and its token wins. A row with no token stays unguarded.
 */
export function rowVersionToSend(
  written: WrittenRowVersion | undefined,
  readVersion: string | undefined,
): string | undefined {
  if (!readVersion) return undefined;
  return written && written.readVersion === readVersion ? written.version : readVersion;
}

/** The three ways out of `ConcurrentUpdateDialog`, by its own button names. */
export type RowConflictChoice = 'reload' | 'overwrite' | 'cancel';

/**
 * The per-row outcome the table's `onBatchSave` slot reads, derived from the
 * slot's declared return rather than restated here.
 */
export type BatchSaveOutcome = Exclude<
  Awaited<ReturnType<NonNullable<DataTableSchema['onBatchSave']>>>,
  void
>;
