/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Target 5 — 动态 is a panel: the first panel of the
 * record page's right column, the same shape as the related panels (「动态」
 * and the stream's count; the header row opens the 动态 tab), holding a
 * one-line composer, the newest three entries (five when wide) and
 * 「查看全部 N 条 →」 to the 动态 tab — no chips, no column. Drawn here with
 * the real `record:activity` block on the default record page.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DiscussionContextProvider, SchemaRenderer } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordTimelinePanel } from '../RecordTimelinePanel';
import { DefaultRecordPageContext } from '../defaultRecordPage';
import { RecordFieldChangesContext, auditEntriesToFeedItems } from '../recordTimelineStream';
import { buildDefaultTimeline } from '../synth/buildDefaultPageSchema';
import '../index';

afterEach(cleanup);

const notes: FeedItem[] = Array.from({ length: 6 }, (_, i) => ({
  id: `c${i}`,
  type: 'comment',
  actor: 'Ada',
  body: `Note ${i}`,
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
}));
// A reply to the newest note: it sits under its comment in the tab, never as a peek line.
const reply: FeedItem = { id: 'r1', type: 'comment', actor: 'Bo', body: 'A reply', parentId: 'c5', createdAt: new Date(Date.UTC(2026, 9, 1, 0, 30)).toISOString() };
const audit = auditEntriesToFeedItems(
  [{ id: 1, created_at: new Date(Date.UTC(2026, 9, 1, 0, 20)).toISOString(), user_name: 'Dev', changes: [{ field: 'status', label: 'Status', from: 'New', to: 'Contacted' }] }],
  { unknownUser: 'Unknown' },
);

function mount({
  entries = 3,
  items = [...notes, reply],
  changes = audit,
  loading = false,
  onViewAll = vi.fn(),
  onAddComment,
}: {
  entries?: number;
  items?: FeedItem[];
  changes?: FeedItem[] | null;
  loading?: boolean;
  onViewAll?: () => void;
  onAddComment?: (text: string) => Promise<void>;
} = {}) {
  const view = render(
    <DefaultRecordPageContext.Provider value>
      <DiscussionContextProvider items={items as any[]} loading={loading} onAddComment={onAddComment as any}>
        <RecordFieldChangesContext.Provider value={changes}>
          <RecordTimelinePanel nodes={[buildDefaultTimeline()]} entries={entries} onViewAll={onViewAll} />
        </RecordFieldChangesContext.Provider>
      </DiscussionContextProvider>
    </DefaultRecordPageContext.Provider>,
  );
  return { ...view, onViewAll };
}

const peekLines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-record-timeline-peek-row]')).map((row) => row.textContent ?? '');

describe('the 动态 panel (objectstack#27524, Target 5)', () => {
  it('is a panel: 「动态」 (Activity) and the whole stream\'s count; the header row opens the 动态 tab', async () => {
    const { container, onViewAll } = mount();
    const panel = container.querySelector('[data-record-timeline-panel]') as HTMLElement;
    expect(panel.getAttribute('aria-label')).toBe('Activity');
    // Six notes + the reply + the audit change.
    await waitFor(() => expect(panel.querySelector('[data-record-timeline-count]')?.textContent).toBe('8'));
    const open = panel.querySelector('[data-record-timeline-panel-open]') as HTMLButtonElement;
    expect(open.getAttribute('title')).toContain('8');
    fireEvent.click(open);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('peeks: the newest three roots as one line each, no chips, no load-more — 「查看全部 N 条 →」 opens the tab', () => {
    const { container, onViewAll } = mount();
    // Newest first: the change (00:20), Note 5 (00:05), Note 4 — the reply (00:30) is not a root.
    const lines = peekLines(container);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Status New → Contacted');
    expect(lines[1]).toContain('Note 5');
    expect(lines[2]).toContain('Note 4');
    expect(lines.join(' ')).not.toContain('A reply');
    expect(container.querySelector('[data-stream-filters]')).toBeNull();
    expect(container.querySelector('[data-stream-load-more]')).toBeNull();
    const viewAll = container.querySelector('[data-record-timeline-view-all]') as HTMLButtonElement;
    expect(viewAll.textContent).toContain('8');
    fireEvent.click(viewAll);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('wide: five entries', () => {
    const { container } = mount({ entries: 5 });
    expect(peekLines(container)).toHaveLength(5);
  });

  it('no 「查看全部」 when the stream holds no more than it draws', () => {
    const { container } = mount({ items: notes.slice(0, 1) });
    // One note + the audit change: two lines, all of it.
    expect(peekLines(container)).toHaveLength(2);
    expect(container.querySelector('[data-record-timeline-view-all]')).toBeNull();
  });

  it('no count while the feed loads: the count is unknown, not 0', () => {
    const { container } = mount({ items: [], changes: null, loading: true });
    expect(container.querySelector('[data-record-timeline-count]')).toBeNull();
    expect(screen.getByTestId('activity-loading')).toBeTruthy();
  });

  it('the composer is one line until pressed, then the full composer, focused; a sent note folds it back', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = mount({ onAddComment });
    const oneLine = container.querySelector('[data-record-timeline-composer]') as HTMLButtonElement;
    expect(oneLine.textContent).toBe('Write a note… @ to mention');
    expect(container.querySelector('textarea')).toBeNull();
    fireEvent.click(oneLine);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    fireEvent.change(textarea, { target: { value: 'Called back' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith('Called back', undefined));
    await waitFor(() => expect(container.querySelector('[data-record-timeline-composer]')).not.toBeNull());
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('CONTROL — outside the panel the same block is the full stream: chips, every entry of the page, paging', () => {
    const { container } = render(
      <DefaultRecordPageContext.Provider value>
        <DiscussionContextProvider items={[...notes, reply] as any[]} loading={false}>
          <RecordFieldChangesContext.Provider value={audit}>
            <RecordTimelinePanelFree />
          </RecordFieldChangesContext.Provider>
        </DiscussionContextProvider>
      </DefaultRecordPageContext.Provider>,
    );
    expect(container.querySelector('[data-stream-filters]')).not.toBeNull();
    expect(container.querySelector('[data-record-timeline-peek]')).toBeNull();
    expect(screen.getByText('Note 0')).toBeTruthy();
  });
});


/** The page's 动态 node drawn bare — as the 动态 tab draws it. */
function RecordTimelinePanelFree() {
  return <SchemaRenderer schema={buildDefaultTimeline()} />;
}
