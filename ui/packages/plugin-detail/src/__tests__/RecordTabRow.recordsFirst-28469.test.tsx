/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28469 — the record page's tab row as drawn: the related lists
 * with records on the row, the empty ones in 「+N ▾」 after the folded tabs,
 * behind a separator and in a muted face, the hidden panels' tabs last; an
 * active empty tab on the row; and, through `RecordPageColumns`, a page whose
 * counts arrive with its payload draws that order on its first render, with
 * no tab moving after. The rule itself is pinned in
 * `synth/__tests__/recordTabRow-28469.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelatedCountStore } from '@object-ui/components';
import { RecordContextProvider } from '@object-ui/react';
import { RecordTabRow, RECORD_TAB_OVERVIEW, type RecordTab } from '../RecordTabRow';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => <section data-node={schema?.type} />,
}));

import { RecordPageColumns } from '../RecordPageColumns';
import { RECORD_PAGE_TIMELINE_PANEL, buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';

const TABS: RecordTab[] = [
  { id: RECORD_TAB_OVERVIEW, label: 'Overview' },
  { id: 'timeline', label: 'Activity', count: 0 },
  { id: 'attendee.contact_id', label: 'Attendees', count: 7 },
  { id: 'case.contact_id', label: 'Cases', count: 2 },
];
const EMPTY: RecordTab[] = [
  { id: 'lead.converted_contact', label: 'Leads (converted)', count: 0 },
  { id: 'lead.duplicate_contact', label: 'Leads (duplicate)', count: 0 },
];
const HIDDEN: RecordTab[] = [{ id: 'opportunity.contact_id', label: 'Opportunities', count: 0 }];
const WIDTHS: Record<string, number> = { overview: 60, timeline: 70 };
const MORE = 40;
let rowWidth = 2000;

const shownIds = () => Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.getAttribute('data-record-tab'));
const more = () => document.querySelector('[data-record-tab-more]');

describe('RecordTabRow: empty lists wait in the dropdown (objectstack#28469)', () => {
  beforeEach(() => {
    rowWidth = 2000;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      let width = 0;
      if (this.hasAttribute('data-record-tab-row')) width = rowWidth;
      else if (this.hasAttribute('data-record-tab-measure-more')) width = MORE;
      else if (this.hasAttribute('data-record-tab-measure')) width = WIDTHS[this.textContent?.startsWith('Overview') ? 'overview' : this.textContent?.startsWith('Activity') ? 'timeline' : ''] ?? 80;
      return { width, height: 36, top: 0, left: 0, right: width, bottom: 36, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a row with room for every tab still keeps the empty ones off it; 「+N」 counts them', () => {
    render(<RecordTabRow tabs={TABS} emptyTabs={EMPTY} hiddenTabs={HIDDEN} activeId="overview" onSelect={vi.fn()} />);
    expect(shownIds()).toEqual(TABS.map((tab) => tab.id));
    expect(more()?.textContent).toBe('+3');
  });

  it('the dropdown lists the folded tabs, then the empty ones behind a separator in a muted face, then the hidden ones', async () => {
    // Budget 330 - 40 - 16 = 274: Overview 60 · Activity 70 · Attendees 80 (= 242), then Cases folds.
    rowWidth = 330;
    const onSelect = vi.fn();
    render(<RecordTabRow tabs={TABS} emptyTabs={EMPTY} hiddenTabs={HIDDEN} activeId="overview" onSelect={onSelect} />);
    expect(shownIds()).toEqual(['overview', 'timeline', 'attendee.contact_id']);
    expect(more()?.textContent).toBe('+4');
    const user = userEvent.setup();
    await user.click(more()!);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('data-record-tab-menu-item'))).toEqual([
      'case.contact_id',
      'lead.converted_contact',
      'lead.duplicate_contact',
      'opportunity.contact_id',
    ]);
    expect(items.map((item) => item.hasAttribute('data-record-tab-empty'))).toEqual([false, true, true, false]);
    // A separator between the folded tabs and the empty ones, another before the hidden ones.
    const menu = screen.getByRole('menu');
    const order = Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]')).map((el) =>
      el.getAttribute('role') === 'separator' ? '|' : el.getAttribute('data-record-tab-menu-item'),
    );
    expect(order).toEqual(['case.contact_id', '|', 'lead.converted_contact', 'lead.duplicate_contact', '|', 'opportunity.contact_id']);
    // The empty tabs' counts read muted, as the right column's empty fold does; a folded tab's does not.
    const chip = (item: Element) => item.querySelector('[data-record-tab-count]')!;
    expect(chip(items[1]).className).toContain('text-muted-foreground');
    expect(chip(items[0]).className).not.toContain('text-muted-foreground');
    await user.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith('lead.converted_contact');
  });

  it('an active empty tab (a ?related= link) is on the row, in its last slot, and leaves the dropdown', () => {
    render(
      <RecordTabRow tabs={TABS} emptyTabs={EMPTY} hiddenTabs={HIDDEN} activeId="lead.duplicate_contact" onSelect={vi.fn()} />,
    );
    expect(shownIds()).toEqual([...TABS.map((tab) => tab.id), 'lead.duplicate_contact']);
    expect(document.querySelector('[aria-selected="true"]')?.getAttribute('data-record-tab')).toBe('lead.duplicate_contact');
    expect(more()?.textContent).toBe('+2');
    cleanup();
    // Narrow (budget 274): it takes the last slot from Attendees, which folds.
    rowWidth = 330;
    render(
      <RecordTabRow tabs={TABS} emptyTabs={EMPTY} hiddenTabs={HIDDEN} activeId="lead.duplicate_contact" onSelect={vi.fn()} />,
    );
    expect(shownIds()).toEqual(['overview', 'timeline', 'lead.duplicate_contact']);
  });
});

const RELATED = [
  { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
  { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
  { objectName: 'call', relationshipField: 'lead_id', title: 'Calls' },
  { objectName: 'event', relationshipField: 'lead_id', title: 'Events' },
];
const TOTALS: Record<string, number> = { task: 0, note: 3, call: 0, event: 1 };
const columnsOf = () =>
  buildDefaultPageColumns(buildDefaultPageSchema({ name: 'lead', fields: {} }, { related: RELATED, hideDiscussion: false }))!;

function renderPage(find: ReturnType<typeof vi.fn>) {
  const dataSource = { find, getObjectSchema: vi.fn(async () => ({ fields: {} })) };
  return render(
    <RecordContextProvider objectName="lead" recordId="lead-1" dataSource={dataSource as any}>
      <RecordPageColumns tier="wide" columns={columnsOf()} onEnlargeRelated={vi.fn()} relatedFieldsOf={() => ({})} />
    </RecordContextProvider>,
  );
}

/** Watch the tab list: every tab added, removed or moved is a child-list record. */
function watchTabList(): { moves: () => number; stop: () => void } {
  const list = document.querySelector('[role="tablist"]')!;
  let moves = 0;
  const observer = new MutationObserver((records) => {
    moves += records.filter((record) => record.type === 'childList').length;
  });
  observer.observe(list, { childList: true });
  return {
    moves: () => moves + observer.takeRecords().filter((record) => record.type === 'childList').length,
    stop: () => observer.disconnect(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('the record page draws the final tab order at first paint (objectstack#28469, Target 2)', () => {
  beforeEach(() => RelatedCountStore._reset());
  afterEach(() => cleanup());

  it('counts that arrive with the page payload: the first render already has the lists with records first, and no tab moves after', async () => {
    // The page payload's answers, seeded before the page draws (objectstack#27627).
    const seeded = RELATED.map((list) => {
      const read = Promise.resolve({ total: TOTALS[list.objectName], rows: [] });
      RelatedCountStore.seed(list.objectName, list.relationshipField, 'lead-1', undefined, 1, read);
      return read;
    });
    await Promise.all(seeded);
    await settle();
    const find = vi.fn(async () => ({ data: [], total: 0 }));
    renderPage(find);
    const final = ['overview', RECORD_PAGE_TIMELINE_PANEL, 'note.parent_id', 'event.lead_id'];
    expect(shownIds()).toEqual(final);
    const watch = watchTabList();
    await settle();
    await waitFor(() => expect(document.querySelector('[data-record-tab="note.parent_id"] [data-record-tab-count]')?.textContent).toBe('3'));
    await settle();
    expect(shownIds()).toEqual(final);
    expect(watch.moves()).toBe(0);
    watch.stop();
    // No count was read again: the payload answered them.
    expect(find).not.toHaveBeenCalled();
  });

  it('control: counts read after the page draws move the empty tabs once they land — what the observer above would have seen', async () => {
    const find = vi.fn(async (objectName: string) => ({ data: [], total: TOTALS[objectName] }));
    renderPage(find);
    // Not known yet: every tab where the arrangement puts it.
    expect(shownIds()).toEqual(['overview', RECORD_PAGE_TIMELINE_PANEL, 'task.lead_id', 'note.parent_id', 'call.lead_id', 'event.lead_id']);
    const watch = watchTabList();
    await waitFor(() => expect(shownIds()).toEqual(['overview', RECORD_PAGE_TIMELINE_PANEL, 'note.parent_id', 'event.lead_id']));
    expect(watch.moves()).toBeGreaterThan(0);
    watch.stop();
  });
});
