/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { isEmptyValue } from '@object-ui/core';

/**
 * The per-lane total a board's column headers paint (objectui#11629).
 *
 * `@objectstack/spec` declares `summarizeField` on the view-level
 * `KanbanConfig` — "Field to sum at top of column (e.g. amount)" — and
 * `ListView`'s kanban branch relays it onto the generated `object-kanban` node.
 * Until objectui#11629 nothing under this package read it, so a board authored
 * with `summarizeField` showed the card count and no total.
 *
 * ## Why a context rather than a prop
 *
 * The same reason, and the same shape, as `KanbanRecordsSettledContext`: the
 * producer is `ObjectKanban` (it holds the object definition, so it knows how
 * the cards format the field) and the consumer is `KanbanImpl`'s column header,
 * with `KanbanBoardCore`'s `Suspense`/`lazy` boundary in between. A member of
 * the published `KanbanRendererProps` (or of its `schema` bag) would be a new
 * key on a published payload for a value no caller outside this package sets.
 * This module is NOT re-exported from `index.tsx`, so nothing here reaches the
 * published surface.
 *
 * ## ⚠️ The default is `null`, and that is load-bearing
 *
 * No provider means no total: `KanbanRenderer` (the exported React component)
 * and every board whose node carries no `summarizeField` render the header
 * exactly as they did before.
 */
export interface KanbanColumnSummary {
  /** The record field each lane totals — the view's `summarizeField`. */
  field: string;
  /** The field's display label: the tooltip and the screen-reader name of the total. */
  label: string;
  /**
   * Paints a total through the field's own cell renderer — the one the cards
   * use for that field — so a currency field totals as currency and a number
   * field keeps its declared `scale`. No format code of its own.
   */
  renderTotal: (total: number) => ReactNode;
}

export const KanbanColumnSummaryContext = createContext<KanbanColumnSummary | null>(null);

/** Read the lane-total channel above. Package-private — see the interface's doc. */
export function useKanbanColumnSummary(): KanbanColumnSummary | null {
  return useContext(KanbanColumnSummaryContext);
}

/**
 * The decimal places in one number's shortest spelling, exponent included —
 * the twin of `widestFractionDigits` in `@object-ui/plugin-grid`'s
 * `useColumnSummary` (the grid footer's `Sum`), which rounds a computed
 * result to the widest input for the same reason: a sum of `0.1` and `0.2`
 * must read `0.3`, never the binary residue `0.30000000000000004` that a
 * `number` field declaring no `scale` would otherwise print. Capped at 20, as
 * there.
 */
function fractionDigitsOf(value: number): number {
  const [mantissa, exponent] = String(value).split('e');
  const point = mantissa.indexOf('.');
  const fraction = point === -1 ? 0 : mantissa.length - point - 1;
  return Math.min(Math.max(fraction - (exponent ? Number(exponent) : 0), 0), 20);
}

/**
 * The sum of `field` over one lane's cards, or `null` when the lane holds a
 * value that is not a number.
 *
 * - An absent, `null` or empty value counts as `0` (`isEmptyValue`, the floor
 *   the card cells use), so a lane of unestimated cards totals `0`, and an
 *   empty lane totals `0`.
 * - A number counts as itself; a numeric string counts as `Number(value)`,
 *   the coercion the number and currency cell renderers apply before they
 *   format the same value on the card.
 * - Anything else — a non-numeric string, an object, a boolean — makes the
 *   total unknowable, and `null` says so. The header then shows no total:
 *   ⛔ never `NaN`, and never a sum that quietly skipped a row.
 */
export function sumLaneField(
  cards: ReadonlyArray<Record<string, unknown>>,
  field: string,
): number | null {
  let total = 0;
  let widest = 0;
  for (const card of cards) {
    const raw = card[field];
    if (isEmptyValue(raw)) continue;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value)) return null;
    total += value;
    widest = Math.max(widest, fractionDigitsOf(value));
  }
  return widest === 0 ? total : Number(total.toFixed(widest));
}
