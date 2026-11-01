/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28469 — the record page's tab row puts the related lists with
 * records first and sinks the empty ones into 「+N ▾」, the rule the right
 * column already applies to its panels (objectstack#27524, Target 2): a stable
 * partition of the reader's arrangement, an unknown count kept in place, an
 * empty list never on the row unless it is the active tab, which then takes
 * the row's last slot.
 */

import { describe, it, expect } from 'vitest';
import { arrangeRecordTabRow, layoutRecordTabRow, partitionRecordTabsByRecords } from '../recordTabRow';

interface Tab {
  id: string;
  count?: number | null;
}

// The HotCRM contact the card was read on: 7 inbound lists in arrangement order.
const PANELS: Tab[] = [
  { id: 'attendee', count: 7 },
  { id: 'lead.converted_contact', count: 0 },
  { id: 'lead.duplicate_contact', count: 0 },
  { id: 'case', count: 2 },
  { id: 'contract', count: 1 },
  { id: 'quote', count: 2 },
  { id: 'campaign_member', count: 3 },
];
const LEAD: Tab[] = [{ id: 'overview' }, { id: 'timeline', count: 0 }];
const HIDDEN: Tab[] = [{ id: 'opportunity', count: 0 }];
const GAP = 16;
const MORE = 40;
const widthOf = (tab: Tab) => (tab.id === 'overview' ? 60 : tab.id === 'timeline' ? 70 : 80);

/** The row the page draws: partition, arrange, lay out — what each slot and the dropdown hold, by id. */
function drawRow(panels: readonly Tab[], available: number, activeId = 'overview') {
  const { withRecords, empty } = partitionRecordTabsByRecords(panels);
  const { row, empty: folded } = arrangeRecordTabRow([...LEAD, ...withRecords], empty, activeId);
  const layout = layoutRecordTabRow({
    widths: row.map(widthOf),
    available,
    gap: GAP,
    moreWidth: MORE,
    activeIndex: Math.max(0, row.findIndex((tab) => tab.id === activeId)),
    alwaysInDropdown: folded.length + HIDDEN.length,
  });
  return {
    row: layout.shown.map((index) => row[index].id),
    dropdown: [...layout.overflow.map((index) => row[index].id), ...folded.map((t) => t.id), ...HIDDEN.map((t) => t.id)],
  };
}

describe('the record tab row puts lists with records first (objectstack#28469)', () => {
  it('counts [7, 0, 0, 2, 1, 2, 3]: the non-empty tabs on the row; the dropdown lists the overflowed ones, then the empty, then the hidden', () => {
    // Budget 500 - 40 - 16 = 444: 概览 60 + 动态 70 + three panels of 80, with gaps = 434.
    expect(drawRow(PANELS, 500)).toEqual({
      row: ['overview', 'timeline', 'attendee', 'case', 'contract'],
      dropdown: ['quote', 'campaign_member', 'lead.converted_contact', 'lead.duplicate_contact', 'opportunity'],
    });
  });

  it('an empty list never takes a slot, even on a row with room for every tab', () => {
    expect(drawRow(PANELS, 2000)).toEqual({
      row: ['overview', 'timeline', 'attendee', 'case', 'contract', 'quote', 'campaign_member'],
      dropdown: ['lead.converted_contact', 'lead.duplicate_contact', 'opportunity'],
    });
  });

  it('the partition is stable: the arrangement decides the order within each group', () => {
    const { withRecords, empty } = partitionRecordTabsByRecords(PANELS);
    expect(withRecords.map((t) => t.id)).toEqual(['attendee', 'case', 'contract', 'quote', 'campaign_member']);
    expect(empty.map((t) => t.id)).toEqual(['lead.converted_contact', 'lead.duplicate_contact']);
  });

  it('a count not known yet (null, absent) counts as non-empty and stays where the arrangement puts it', () => {
    const panels: Tab[] = [{ id: 'a', count: null }, { id: 'b', count: 0 }, { id: 'c' }, { id: 'd', count: 4 }];
    const { withRecords, empty } = partitionRecordTabsByRecords(panels);
    expect(withRecords.map((t) => t.id)).toEqual(['a', 'c', 'd']);
    expect(empty.map((t) => t.id)).toEqual(['b']);
    expect(drawRow(panels, 2000).row).toEqual(['overview', 'timeline', 'a', 'c', 'd']);
  });

  it('an active empty tab (a ?related= link to an empty list) is on the row, in its last slot', () => {
    // Narrow: the active empty tab takes the last slot, displacing the panels that no longer fit.
    expect(drawRow(PANELS, 500, 'lead.duplicate_contact')).toEqual({
      row: ['overview', 'timeline', 'attendee', 'case', 'lead.duplicate_contact'],
      dropdown: ['contract', 'quote', 'campaign_member', 'lead.converted_contact', 'opportunity'],
    });
    // Wide: after every list with records.
    expect(drawRow(PANELS, 2000, 'lead.converted_contact')).toEqual({
      row: ['overview', 'timeline', 'attendee', 'case', 'contract', 'quote', 'campaign_member', 'lead.converted_contact'],
      dropdown: ['lead.duplicate_contact', 'opportunity'],
    });
  });

  it('a row whose panels are all empty or all with records changes nothing else', () => {
    const allEmpty = PANELS.map((t) => ({ ...t, count: 0 }));
    expect(drawRow(allEmpty, 2000)).toEqual({ row: ['overview', 'timeline'], dropdown: [...PANELS.map((t) => t.id), 'opportunity'] });
    const allFull = PANELS.map((t) => ({ ...t, count: 1 }));
    expect(drawRow(allFull, 2000).row).toEqual(['overview', 'timeline', ...PANELS.map((t) => t.id)]);
  });
});
