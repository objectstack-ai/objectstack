/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's tab row, laid out by the width it has
 * (objectstack#27524, Target 8): 「概览」, then one tab per panel, as many as
 * fit; the rest go into the 「+N ▾」 dropdown.
 *
 * Pure, so the rule reads and tests apart from any layout engine: the
 * component measures its tabs and its container, and asks this which tabs
 * the row shows.
 *
 *  - Everything fits (and no hidden panel waits for the dropdown): every tab
 *    is shown and the row has no dropdown.
 *  - Otherwise the dropdown's trigger takes its width from the row, and the
 *    tabs fill what is left in their order, stopping at the first that does
 *    not fit.
 *  - 「概览」 is always shown, and so is at least one tab after it.
 *  - The active tab is always shown: where it would have fallen into the
 *    dropdown, it takes the row's last slot and the tab it displaced goes
 *    into the dropdown instead.
 *
 * Which tabs are candidates for the row at all is {@link arrangeRecordTabRow}'s
 * answer (objectstack#28469): the related lists with records come first, and
 * the empty ones wait in the dropdown.
 */
export interface RecordTabRowLayoutInput {
  /** Each tab's width, in the row's order; index 0 is 「概览」. */
  widths: readonly number[];
  /** The row's own width (its container's). */
  available: number;
  /** The space between two tabs, and between the last tab and the trigger. */
  gap: number;
  /** The dropdown trigger's width (「+N ▾」). */
  moreWidth: number;
  /** The active tab's index into `widths`. */
  activeIndex: number;
  /**
   * Tabs that are never on the row — the hidden panels', which sit at the end
   * of the dropdown. Any makes the dropdown exist, whatever fits.
   */
  alwaysInDropdown: number;
}

export interface RecordTabRowLayout {
  /** The indexes of the tabs on the row, in the order they are drawn. */
  shown: number[];
  /** The indexes of the tabs in the dropdown, in their order (the hidden panels' come after these). */
  overflow: number[];
}

const rowWidth = (widths: readonly number[], indexes: readonly number[], gap: number): number =>
  indexes.reduce((sum, index, position) => sum + widths[index] + (position > 0 ? gap : 0), 0);

export function layoutRecordTabRow(input: RecordTabRowLayoutInput): RecordTabRowLayout {
  const { widths, available, gap, moreWidth, alwaysInDropdown } = input;
  const count = widths.length;
  if (count === 0) return { shown: [], overflow: [] };
  const all = widths.map((_, index) => index);
  const active = input.activeIndex > 0 && input.activeIndex < count ? input.activeIndex : 0;

  if (alwaysInDropdown === 0 && rowWidth(widths, all, gap) <= available) return { shown: all, overflow: [] };

  // The trigger is drawn: what the tabs may take is the row less it.
  const budget = available - moreWidth - gap;
  const chosen = new Set<number>([0]);
  if (active > 0) chosen.add(active);
  let used = rowWidth(widths, Array.from(chosen), gap);
  for (let index = 1; index < count; index += 1) {
    if (index === active) continue;
    if (used + gap + widths[index] > budget) break;
    chosen.add(index);
    used += gap + widths[index];
  }
  // 「概览」 plus at least one more, whatever the width.
  if (chosen.size < 2 && count > 1) chosen.add(1);

  // In index order: the tabs taken from the front stay in their order, and an
  // active tab from further on lands after them — the row's last slot.
  const shown = Array.from(chosen).sort((a, b) => a - b);
  const overflow = all.filter((index) => !chosen.has(index));
  return { shown, overflow };
}

/** What the arrangement reads of a tab: its id and its count. */
export interface ArrangedRecordTab {
  id: string;
  /** The panel's count; absent or `null` while it is not known. */
  count?: number | null;
}

/**
 * The related panels' tabs split by whether their list has records
 * (objectstack#28469, Target 1) — the rule the right column already applies to
 * its panels (objectstack#27524, Target 2), so the two surfaces agree on the
 * same lists.
 *
 * A stable partition of the reader's arrangement: every panel whose count is
 * not `0` keeps its relative order (a reader's drag still decides among them),
 * then every panel whose count is `0`, in the same order. A count that is not
 * known yet (loading, or a refused read) is not `0`: that tab stays where the
 * arrangement puts it. Computed when the row is drawn and never written back
 * into the stored arrangement.
 */
export function partitionRecordTabsByRecords<T extends ArrangedRecordTab>(
  panels: readonly T[],
): { withRecords: T[]; empty: T[] } {
  const withRecords: T[] = [];
  const empty: T[] = [];
  for (const panel of panels) (panel.count === 0 ? empty : withRecords).push(panel);
  return { withRecords, empty };
}

/**
 * The tabs the row may show and the empty tabs its dropdown lists
 * (objectstack#28469, Targets 1 and 3).
 *
 * An empty list's tab never takes a slot on the row, even when the row has
 * room for it — except the active one: a link that opens an empty list (a
 * `?related=` deep link) keeps that tab on the row, after every other
 * candidate, so {@link layoutRecordTabRow} draws it in the row's last slot.
 */
export function arrangeRecordTabRow<T extends ArrangedRecordTab>(
  tabs: readonly T[],
  emptyTabs: readonly T[],
  activeId: string,
): { row: T[]; empty: T[] } {
  const active = emptyTabs.find((tab) => tab.id === activeId);
  if (!active) return { row: [...tabs], empty: [...emptyTabs] };
  return { row: [...tabs, active], empty: emptyTabs.filter((tab) => tab !== active) };
}
