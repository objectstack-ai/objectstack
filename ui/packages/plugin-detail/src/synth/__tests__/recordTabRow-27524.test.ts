/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Target 8 — how many tabs the record page's tab row
 * shows, from its own width: as many as fit, the rest in 「+N ▾」; 「概览」 plus
 * at least one more always; the active tab always on the row, in the last
 * slot when it would have fallen into the dropdown.
 */

import { describe, it, expect } from 'vitest';
import { layoutRecordTabRow } from '../recordTabRow';

// 概览 60 · 动态 70 · 任务 60 · 活动 60 · 营销活动成员 120 · 活动参与者 100 · 重复线索 90
const WIDTHS = [60, 70, 60, 60, 120, 100, 90];
const GAP = 16;
const MORE = 40;
const layout = (available: number, activeIndex = 0, alwaysInDropdown = 0) =>
  layoutRecordTabRow({ widths: WIDTHS, available, gap: GAP, moreWidth: MORE, activeIndex, alwaysInDropdown });

describe('layoutRecordTabRow (objectstack#27524, Target 8)', () => {
  it('a wide row shows every tab and no dropdown', () => {
    // 560 + 6 gaps of 16 = 656.
    expect(layout(656)).toEqual({ shown: [0, 1, 2, 3, 4, 5, 6], overflow: [] });
    expect(layout(1200)).toEqual({ shown: [0, 1, 2, 3, 4, 5, 6], overflow: [] });
  });

  it('a medium row shows what fits beside the trigger, in order, and folds the rest', () => {
    // Budget 480 - 40 - 16 = 424: 60+16+70+16+60+16+60 = 298; +16+120 = 434 > 424.
    expect(layout(480)).toEqual({ shown: [0, 1, 2, 3], overflow: [4, 5, 6] });
  });

  it('a narrow row still shows 「概览」 and one more', () => {
    expect(layout(200)).toEqual({ shown: [0, 1], overflow: [2, 3, 4, 5, 6] });
    expect(layout(0)).toEqual({ shown: [0, 1], overflow: [2, 3, 4, 5, 6] });
  });

  it('the active tab is always shown: past the fold it takes the last slot, and the tab it displaced folds', () => {
    // At 480 the row fits 0..3; 营销活动成员 (4, 120 wide) active displaces 活动 (3).
    expect(layout(480, 4)).toEqual({ shown: [0, 1, 2, 4], overflow: [3, 5, 6] });
    // A narrower active tab displaces nothing it does not have to: 重复线索 (6, 90) fits beside 0..3.
    expect(layout(480, 6)).toEqual({ shown: [0, 1, 2, 3, 6], overflow: [4, 5] });
    // An active tab the row reaches anyway keeps its place.
    expect(layout(480, 2)).toEqual({ shown: [0, 1, 2, 3], overflow: [4, 5, 6] });
    // Narrow: 「概览」 and the active tab.
    expect(layout(200, 5)).toEqual({ shown: [0, 5], overflow: [1, 2, 3, 4, 6] });
  });

  it('hidden panels make the dropdown exist even when every tab would fit', () => {
    const wide = layout(1200, 0, 2);
    expect(wide.shown).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(wide.overflow).toEqual([]);
    // The trigger's width is taken from the row: at 656 the last tab no longer fits.
    expect(layout(656, 0, 2)).toEqual({ shown: [0, 1, 2, 3, 4, 5], overflow: [6] });
  });

  it('a row of 「概览」 alone, or of no tabs, has nothing to fold', () => {
    expect(layoutRecordTabRow({ widths: [60], available: 0, gap: GAP, moreWidth: MORE, activeIndex: 0, alwaysInDropdown: 0 })).toEqual({
      shown: [0],
      overflow: [],
    });
    expect(layoutRecordTabRow({ widths: [], available: 100, gap: GAP, moreWidth: MORE, activeIndex: 0, alwaysInDropdown: 0 })).toEqual({
      shown: [],
      overflow: [],
    });
  });
});
