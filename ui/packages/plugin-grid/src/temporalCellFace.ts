/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The date-family face a grid CELL paints, read once and drawn by every grid
 * surface that shows a date-family value outside its cell: a group's heading
 * (objectui#13234), a group header's `min` / `max` and a column footer's
 * `min` / `max` (objectstack#32119). One resolve, one formatter, so none of
 * them draws a time differently from the cell under it.
 */

import { formatDate, formatDateTime, formatRelativeDate } from '@object-ui/fields';
import { toDisplayDate } from '@object-ui/core';
import { resolveGridCellRendering, type GridCellFieldLike } from './cellRendererResolution';

/**
 * [objectui#13234] The face a date-family CELL paints: the renderer key from
 * the cells' one shared resolve (`resolveGridCellRendering`), and the object
 * field's `format`, which is the `format` the cell's field metadata carries.
 */
export interface TemporalCellFace {
  rendererType: 'date' | 'datetime';
  format?: string;
}

/**
 * The date-family face the cell of `field` paints, or `undefined` when its
 * cell paints none. `field.type` is whatever the caller's cell reads (an
 * authored column `type` over the object field's).
 */
export function temporalCellFaceOf(field: GridCellFieldLike | null | undefined): TemporalCellFace | undefined {
  const { rendererType } = resolveGridCellRendering(field);
  if (rendererType !== 'date' && rendererType !== 'datetime') return undefined;
  return { rendererType, format: field?.format || undefined };
}

/**
 * The instant a stored date-family value names, in epoch milliseconds, under
 * the cells' own floor and parse: `undefined` for an empty or unparsable value,
 * exactly the values {@link temporalCellText} draws nothing for.
 */
export function temporalInstant(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  // The cells' floor: every falsy scalar is empty, the numeric epoch included.
  if (!value) return undefined;
  // The cells' validity guard, the shared parse step.
  const time = toDisplayDate(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/**
 * The stored value among `values` that names the earliest (`min`) or the
 * latest (`max`) instant, as stored, so it is drawn through the cell's face;
 * `undefined` when none of them names an instant. Ordered by
 * {@link temporalInstant}, never by the stored text, so a `date` and an
 * offset-bearing `datetime` order as times.
 */
export function temporalExtreme(values: Iterable<unknown>, type: 'min' | 'max'): unknown {
  let extreme: unknown;
  let extremeTime: number | undefined;
  for (const value of values) {
    const time = temporalInstant(value);
    if (time === undefined) continue;
    if (extremeTime === undefined || (type === 'min' ? time < extremeTime : time > extremeTime)) {
      extreme = value;
      extremeTime = time;
    }
  }
  return extreme;
}

/**
 * [objectui#13234] A stored `date` / `datetime` value, drawn as the grid's
 * cell draws the same value. `undefined` for a value the cell has no face for
 * (empty or unparsable), so the caller keeps its own text: a group band keeps
 * the group's own label ("(empty)" for an empty key, the stored text
 * otherwise), and an aggregate is left out.
 *
 * The formatting CALLS are the cells' own, with the cells' arguments:
 * `DateCellRenderer` in a grid column (`inGridColumn`, objectstack#25884)
 * paints `formatDate(value, format || undefined, …)`, the absolute default
 * face when no `format` is declared;
 * `DateTimeCellRenderer` paints `formatRelativeDate` for `'relative'`, the
 * compact face for no format and for `'short'`, and `formatDateTime` with the
 * authored word otherwise (the compact face's string is the cell's two halves
 * joined by the one space the cell draws between them). No date is formatted
 * here. The face SELECTION is the one part those renderers do not export, and
 * it is restated here only: `groupDateHeading-13234.test.tsx` holds every
 * group heading, and every date-family `min` / `max`, to the cell under it
 * for every face, so a move on either side turns it red.
 *
 * A heading names a DAY, not one row's deadline, so it reads the face's
 * neutral phrase: `dueLike`'s "Overdue" wording and red are a per-row verdict
 * (`settledWhen` is judged per row), and the rows of one group can judge it
 * differently. An aggregate's extreme reads the same neutral phrase.
 */
export function temporalCellText(
  face: TemporalCellFace,
  value: unknown,
  locale: string | undefined,
): string | undefined {
  if (temporalInstant(value) === undefined) return undefined;
  const key = value as string | number;
  if (face.rendererType === 'date') return formatDate(key, face.format || undefined, { locale });
  // A `datetime` cell renders an INSTANT, from the engine's parse.
  const instant = new Date(key);
  const style = !face.format || face.format === 'short' ? 'compact' : face.format;
  return style === 'relative'
    ? formatRelativeDate(instant, { locale })
    : formatDateTime(instant, { style, locale });
}
