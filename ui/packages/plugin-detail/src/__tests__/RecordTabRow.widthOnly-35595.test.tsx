/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35595 — the record page's tab row as drawn: every related list
 * on the row in its order, an empty one muted and with no number, the width
 * the only fold (「更多 N ▾」, whose items keep their counts), and — through
 * `RecordPageColumns` — 概览, the lists, 附件, 审批 and 动态, drawn at first
 * paint with no tab moving after the counts land. Supersedes objectstack#28469
 * (empty lists in the dropdown), whose pins this file replaces. The width rule
 * itself is pinned in `synth/__tests__/recordTabRow.widthOnly-35595.test.ts`.
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
  { id: 'attendee.contact_id', label: 'Attendees', count: 7 },
  { id: 'lead.converted_contact', label: 'Leads (converted)', count: 0 },
  { id: 'case.contact_id', label: 'Cases', count: 2 },
  { id: 'approvals', label: 'Approvals', dot: true },
  { id: 'timeline', label: 'Activity', count: 3 },
];
const HIDDEN: RecordTab[] = [{ id: 'opportunity.contact_id', label: 'Opportunities', count: 0 }];
const WIDTHS: Record<string, number> = { overview: 60, timeline: 70 };
const MORE = 40;
let rowWidth = 2000;

const shownIds = () => Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.getAttribute('data-record-tab'));
const more = () => document.querySelector('[data-record-tab-more]');
const tab = (id: string) => document.querySelector(`[data-record-tab="${id}"]`);

function stubLayout() {
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
    else if (this.hasAttribute('data-record-tab-measure'))
      width = WIDTHS[this.textContent?.startsWith('Overview') ? 'overview' : this.textContent?.startsWith('Activity') ? 'timeline' : ''] ?? 80;
    return { width, height: 36, top: 0, left: 0, right: width, bottom: 36, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

describe('RecordTabRow: the width is the only fold (objectstack#35595)', () => {
  beforeEach(() => {
    rowWidth = 2000;
    stubLayout();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a row with room shows every tab: an empty list in its place, muted, with no number', () => {
    render(<RecordTabRow tabs={TABS} activeId="overview" onSelect={vi.fn()} />);
    expect(shownIds()).toEqual(TABS.map((t) => t.id));
    expect(more()).toBeNull();
    const empty = tab('lead.converted_contact')!;
    expect(empty.hasAttribute('data-record-tab-empty')).toBe(true);
    expect(empty.querySelector('[data-record-tab-count]')).toBeNull();
    expect(empty.querySelector('[data-record-tab-label]')!.className).toContain('opacity-70');
    // CONTROL: a list with records carries its count and no muted label.
    const cases = tab('case.contact_id')!;
    expect(cases.hasAttribute('data-record-tab-empty')).toBe(false);
    expect(cases.querySelector('[data-record-tab-count]')?.textContent).toBe('2');
    expect(cases.querySelector('[data-record-tab-label]')!.className).not.toContain('opacity-70');
  });

  it('the 审批 tab carries a dot, not a count', () => {
    render(<RecordTabRow tabs={TABS} activeId="overview" onSelect={vi.fn()} />);
    expect(tab('approvals')!.querySelector('[data-record-tab-dot]')).not.toBeNull();
    expect(tab('approvals')!.querySelector('[data-record-tab-count]')).toBeNull();
    // CONTROL: no other tab draws one.
    expect(document.querySelectorAll('[role="tab"] [data-record-tab-dot]').length).toBe(1);
  });

  it('narrow: the tail folds into 「更多 N ▾」 (the hidden lists counted), whose items keep their counts', async () => {
    // Budget 330 - 40 - 16 = 274: Overview 60 · Attendees 80 · Leads 80 (= 252), then Cases folds.
    rowWidth = 330;
    const onSelect = vi.fn();
    render(<RecordTabRow tabs={TABS} hiddenTabs={HIDDEN} activeId="overview" onSelect={onSelect} />);
    expect(shownIds()).toEqual(['overview', 'attendee.contact_id', 'lead.converted_contact']);
    expect(more()?.textContent).toBe('More 4');
    expect(more()?.getAttribute('data-record-tab-more')).toBe('4');
    const user = userEvent.setup();
    await user.click(more()!);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('data-record-tab-menu-item'))).toEqual([
      'case.contact_id',
      'approvals',
      'timeline',
      'opportunity.contact_id',
    ]);
    expect(items[0].querySelector('[data-record-tab-count]')?.textContent).toBe('2');
    expect(items[2].querySelector('[data-record-tab-count]')?.textContent).toBe('3');
    expect(items[1].querySelector('[data-record-tab-dot]')).not.toBeNull();
    await user.click(items[0]);
    expect(onSelect).toHaveBeenCalledWith('case.contact_id');
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
  buildDefaultPageColumns(
    buildDefaultPageSchema({ name: 'lead', fields: {}, enable: { files: true } } as any, { related: RELATED, hideDiscussion: false }),
  )!;

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
// 概览, every list in `relatedLists` order, 附件, then 动态 last (objectstack#34590).
const FINAL = ['overview', 'task.lead_id', 'note.parent_id', 'call.lead_id', 'event.lead_id', 'attachments', RECORD_PAGE_TIMELINE_PANEL];

describe('the record page draws every tab at first paint, and none moves (objectstack#35595)', () => {
  beforeEach(() => RelatedCountStore._reset());
  afterEach(() => cleanup());

  it('counts read after the page draws: the final order is there before they land, and nothing moves when they do', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const find = vi.fn(async (objectName: string) => {
      await gate;
      return { data: [], total: TOTALS[objectName] ?? 0 };
    });
    renderPage(find);
    expect(shownIds()).toEqual(FINAL);
    const watch = watchTabList();
    release();
    await waitFor(() => expect(tab('note.parent_id')?.querySelector('[data-record-tab-count]')?.textContent).toBe('3'));
    await settle();
    expect(shownIds()).toEqual(FINAL);
    expect(watch.moves()).toBe(0);
    watch.stop();
    // The empty lists keep their places, muted, with no number; no 「更多」 on a wide row.
    expect(tab('task.lead_id')?.hasAttribute('data-record-tab-empty')).toBe(true);
    expect(tab('call.lead_id')?.hasAttribute('data-record-tab-empty')).toBe(true);
    expect(tab('event.lead_id')?.querySelector('[data-record-tab-count]')?.textContent).toBe('1');
    expect(more()).toBeNull();
  });

  it('a list whose count is refused keeps its place, with no number and not muted', async () => {
    const find = vi.fn(async (objectName: string) => {
      if (objectName === 'task') throw new Error('refused');
      return { data: [], total: TOTALS[objectName] ?? 0 };
    });
    renderPage(find);
    await waitFor(() => expect(tab('note.parent_id')?.querySelector('[data-record-tab-count]')?.textContent).toBe('3'));
    expect(shownIds()).toEqual(FINAL);
    expect(tab('task.lead_id')?.querySelector('[data-record-tab-count]')).toBeNull();
    expect(tab('task.lead_id')?.hasAttribute('data-record-tab-empty')).toBe(false);
  });
});
