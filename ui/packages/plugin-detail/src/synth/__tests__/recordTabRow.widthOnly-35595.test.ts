/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35595 — the record tab row folds by WIDTH only: every related
 * list is a candidate for the row in its order, whether or not it has
 * records, and the tabs that do not fit go into 「更多 N ▾」. Supersedes
 * objectstack#28469, which sank the empty lists into the dropdown even on a
 * row with room for them (that partition, `partitionRecordTabsByRecords` /
 * `arrangeRecordTabRow`, is retired with this card).
 */

import { describe, it, expect } from 'vitest';
import * as recordTabRow from '../recordTabRow';
import { layoutRecordTabRow } from '../recordTabRow';

interface Tab {
  id: string;
  count?: number | null;
}

// The HotCRM contact the old card was read on: 7 inbound lists in their order.
const PANELS: Tab[] = [
  { id: 'attendee', count: 7 },
  { id: 'lead.converted_contact', count: 0 },
  { id: 'lead.duplicate_contact', count: 0 },
  { id: 'case', count: 2 },
  { id: 'contract', count: 1 },
  { id: 'quote', count: 2 },
  { id: 'campaign_member', count: 3 },
];
const HIDDEN: Tab[] = [{ id: 'opportunity', count: 0 }];
const GAP = 16;
const MORE = 40;
const widthOf = (tab: Tab) => (tab.id === 'overview' ? 60 : tab.id === 'timeline' ? 70 : 80);

/** The row the page draws: 概览, the lists in order, 动态 last — what each slot and the dropdown hold, by id. */
function drawRow(panels: readonly Tab[], available: number, activeId = 'overview', hidden: readonly Tab[] = HIDDEN) {
  const row: Tab[] = [{ id: 'overview' }, ...panels, { id: 'timeline', count: 2 }];
  const layout = layoutRecordTabRow({
    widths: row.map(widthOf),
    available,
    gap: GAP,
    moreWidth: MORE,
    activeIndex: Math.max(0, row.findIndex((tab) => tab.id === activeId)),
    alwaysInDropdown: hidden.length,
  });
  return {
    row: layout.shown.map((index) => row[index].id),
    dropdown: [...layout.overflow.map((index) => row[index].id), ...hidden.map((t) => t.id)],
  };
}

describe('the record tab row folds by width only (objectstack#35595)', () => {
  it('a row with room for every tab shows every list, the empty ones in their place', () => {
    expect(drawRow(PANELS, 2000, 'overview', [])).toEqual({
      row: ['overview', ...PANELS.map((t) => t.id), 'timeline'],
      dropdown: [],
    });
  });

  it('a narrow row keeps the front of the order and folds the rest, empty or not, in order', () => {
    // Budget 500 - 40 - 16 = 444: 概览 60 + four lists of 80, with gaps = 444.
    expect(drawRow(PANELS, 500, 'overview', [])).toEqual({
      row: ['overview', 'attendee', 'lead.converted_contact', 'lead.duplicate_contact', 'case'],
      dropdown: ['contract', 'quote', 'campaign_member', 'timeline'],
    });
  });

  it('CONTROL: the counts never decide a slot — the same row with every count 0 or every count 3 lays out alike', () => {
    const allEmpty = PANELS.map((t) => ({ ...t, count: 0 }));
    const allFull = PANELS.map((t) => ({ ...t, count: 3 }));
    expect(drawRow(allEmpty, 500)).toEqual(drawRow(PANELS, 500));
    expect(drawRow(allFull, 500)).toEqual(drawRow(PANELS, 500));
  });

  it('the active tab takes the last slot when it would have folded', () => {
    expect(drawRow(PANELS, 500, 'quote', [])).toEqual({
      row: ['overview', 'attendee', 'lead.converted_contact', 'lead.duplicate_contact', 'quote'],
      dropdown: ['case', 'contract', 'campaign_member', 'timeline'],
    });
  });

  it('the records-first partition is retired from the module', () => {
    expect('partitionRecordTabsByRecords' in recordTabRow).toBe(false);
    expect('arrangeRecordTabRow' in recordTabRow).toBe(false);
  });
});
