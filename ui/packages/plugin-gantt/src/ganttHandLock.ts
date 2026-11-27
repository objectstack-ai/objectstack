/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Gantt's reads of the field hand lock (objectstack#37448, the two-tier
 * field-lock model of `@objectstack/spec` `Field`, ruling record 7180466652).
 *
 * Every in-chart write is an edit by hand — a bar's drag and edge resize (the
 * start / end fields), the progress handle (the progress field), the title and
 * dates edited in place, the auto-schedule and conflict reschedule (the dates
 * again) and a drawn dependency link (the dependencies field) — so each reads
 * the one verdict of `@object-ui/core`, never `readonly` alone:
 *
 * - {@link ganttHandLockedInteractions}, the STATIC half
 *   (`fieldStaticallyReadOnlyByHand`): a gesture that can only write a field
 *   locked on every record is not drawn;
 * - {@link ganttPatchByHand}, the FULL verdict over the stored record
 *   (`fieldReadOnlyByHand`, `readonlyWhen` and `uiReadonlyWhen` included),
 *   judged on the write itself, so every commit path — undo and redo too —
 *   meets it.
 */
import { fieldReadOnlyByHand, fieldStaticallyReadOnlyByHand, type FieldHandLockDef } from '@object-ui/core';
import type { GanttInteractions } from './GanttView';

/** The field definitions the verdict reads, keyed by field name. */
export type GanttLockDefs = Record<string, FieldHandLockDef | undefined> | undefined;

/** The Gantt block's write targets. */
export interface GanttWriteFields {
  startDateField: string;
  endDateField: string;
  progressField?: string;
  dependenciesField?: string;
}

/**
 * The author's interaction switches, narrowed by the static hand lock: a move
 * writes both dates, so either locked closes it; a resize writes one edge, so
 * only both locked closes it (the write gate refuses the locked edge); the
 * progress handle and the link UI write one field each. The switches only
 * narrow: an authored `false` stays `false`.
 */
export function ganttHandLockedInteractions(
  authored: GanttInteractions | undefined,
  defs: GanttLockDefs,
  fields: GanttWriteFields,
): GanttInteractions | undefined {
  const locked = (name: string | undefined): boolean => !!name && fieldStaticallyReadOnlyByHand(defs?.[name]);
  const startLocked = locked(fields.startDateField);
  const endLocked = locked(fields.endDateField);
  const closed: GanttInteractions = {
    ...(startLocked || endLocked ? { move: false } : {}),
    ...(startLocked && endLocked ? { resize: false } : {}),
    ...(locked(fields.progressField) ? { progress: false } : {}),
    ...(locked(fields.dependenciesField) ? { link: false } : {}),
  };
  if (Object.keys(closed).length === 0) return authored;
  return { ...(authored ?? {}), ...closed };
}

/** The outcome of judging one write: what to send, or a refusal. */
export type GanttPatchVerdict =
  | { kind: 'write'; patch: Record<string, unknown> }
  | { kind: 'refused'; field: string };

/** Does `next` leave the stored value where it is? Dates compare as instants. */
function sameStoredValue(next: unknown, stored: unknown): boolean {
  if (next === stored) return true;
  if (next == null || stored == null) return false;
  if (typeof next === 'string' && typeof stored === 'string') {
    const a = Date.parse(next);
    const b = Date.parse(stored);
    return !Number.isNaN(a) && a === b;
  }
  return false;
}

/**
 * Judge a patch over the record it writes: a field read-only by hand over that
 * record whose value the patch CHANGES refuses the whole patch (the chart puts
 * the bar back); one the patch leaves unchanged is dropped from it, so an
 * in-place edit of the title does not send the locked dates it echoes back.
 */
export function ganttPatchByHand(
  patch: Record<string, unknown>,
  stored: Record<string, unknown>,
  defs: GanttLockDefs,
  scope: Record<string, unknown> | undefined,
): GanttPatchVerdict {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    const def = defs?.[field];
    if (!fieldReadOnlyByHand(def, stored, { scope, fieldContext: `field '${field}'` })) {
      out[field] = value;
      continue;
    }
    if (sameStoredValue(value, stored[field])) continue;
    return { kind: 'refused', field };
  }
  return { kind: 'write', patch: out };
}
