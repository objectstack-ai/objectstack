/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The row a list cell's save leaves on screen (objectstack#35685).
 *
 * A select-first grid saves each committed cell and redraws only that row,
 * never the whole table: the row the user edited, with the edit, and with what
 * the server answered the write with, so a value a server hook rewrote shows
 * as stored. The rows around it are not read again, so nothing else moves.
 */

/** The id a record value names: its own `_id` / `id`, or the scalar itself. */
function referenceIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const id = o._id ?? o.id;
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  return undefined;
}

/**
 * Whether the server's `answered` value names the very records the row
 * already draws as `held`. A write answer carries a lookup as its id while the
 * row the grid read carries the expanded record, label and all; the expanded
 * one stays, since it is the same record.
 */
function namesSameRecords(held: unknown, answered: unknown): boolean {
  const heldIsRecord = held !== null && typeof held === 'object' && !Array.isArray(held);
  if (heldIsRecord && (typeof answered === 'string' || typeof answered === 'number')) {
    return referenceIdOf(held) === String(answered);
  }
  if (Array.isArray(held) && Array.isArray(answered) && held.length === answered.length
    && held.some((item) => item !== null && typeof item === 'object')) {
    return held.every((item, i) => {
      const a = referenceIdOf(item);
      return a !== undefined && a === referenceIdOf(answered[i]);
    });
  }
  return false;
}

/**
 * The row to draw once a save of `changes` on `row` landed with `answer`.
 *
 * `{ ...row, ...changes }` is what the cell showed while the save ran; over it
 * goes every key of the answer the row carries (the edited keys among them),
 * so a server-side rewrite wins. A key the row never read stays out: the grid
 * did not ask for it. An answer that is not a record (a backend that answers
 * the write with nothing) leaves the edit as sent.
 */
export function mergeSavedRow(
  row: Record<string, unknown>,
  changes: Record<string, unknown>,
  answer: unknown,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...row, ...changes };
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return merged;
  for (const [key, value] of Object.entries(answer as Record<string, unknown>)) {
    if (!(key in merged)) continue;
    if (namesSameRecords(merged[key], value)) continue;
    merged[key] = value;
  }
  return merged;
}

/**
 * One record's saved row, drawn in place of the row the grid read while that
 * read is the one on screen. `base` is the row object the grid read: once a
 * load hands the grid a new object for the record, the patch no longer
 * applies, and the load's row is drawn.
 */
export interface RowPatch {
  base: unknown;
  row: Record<string, unknown>;
}
