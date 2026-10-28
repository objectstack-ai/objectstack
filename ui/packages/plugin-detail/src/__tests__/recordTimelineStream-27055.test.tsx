/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Target 3 — the timeline is ONE stream: discussion
 * (`sys_comment`), activity (`sys_activity`) and field changes
 * (`sys_audit_log`) merged newest first, filtered by the chips 全部 / 活动 /
 * 讨论 / 变更, system entries drawn as one compact muted line, and
 * 「查看全部 N 条 →」 at the foot.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import {
  auditEntriesToFeedItems,
  filterTimelineStream,
  mergeTimelineStream,
  RecordFieldChangesContext,
} from '../recordTimelineStream';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { RecordActivityRenderer } from '../renderers/record-activity';
import { DefaultRecordPageContext } from '../defaultRecordPage';

afterEach(cleanup);

const comment: FeedItem = { id: 'c1', type: 'comment', actor: 'Ada', body: 'Budget is set', createdAt: '2026-10-23T10:00:00Z' };
const call: FeedItem = { id: 'a1', type: 'task', actor: 'Dev', body: 'Logged a call', createdAt: '2026-10-28T10:20:00Z' };
const updated = { id: 'a2', type: 'field_change', actor: 'Dev', body: 'updated', createdAt: '2026-10-27T16:05:00Z', activityType: 'updated' } as FeedItem;
const created = { id: 'a3', type: 'field_change', actor: 'Dev', body: 'Created the lead', createdAt: '2026-10-16T09:00:00Z', activityType: 'created' } as FeedItem;
const audit = auditEntriesToFeedItems(
  [
    { id: 1, created_at: '2026-10-27T16:05:00Z', user_name: 'Dev', changes: [{ field: 'status', label: 'Status', from: 'New', to: 'Contacted' }] },
    { id: 2, created_at: '2026-10-16T09:00:00Z', user_name: 'Dev', action: 'create' },
  ],
  { unknownUser: 'Unknown' },
);

describe('the stream, pure (objectstack#27055)', () => {
  it('turns audit entries that changed a field into field_change items, and only those', () => {
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: 'field_change', actor: 'Dev', id: 'audit:1' });
    expect(audit[0].fieldChanges?.[0]).toMatchObject({ field: 'status', fieldLabel: 'Status', oldDisplayValue: 'New', newDisplayValue: 'Contacted' });
  });

  it('merges newest first, and counts an update once when the audit has it', () => {
    const stream = mergeTimelineStream([comment, call, updated, created], audit);
    expect(stream.map((i) => i.id)).toEqual(['a1', 'audit:1', 'c1', 'a3']);
    // Without field changes the activity's own update stays.
    expect(mergeTimelineStream([comment, updated], null).map((i) => i.id)).toEqual(['a2', 'c1']);
  });

  it('the four chips', () => {
    const stream = mergeTimelineStream([comment, call, created], audit);
    expect(filterTimelineStream(stream, 'all')).toHaveLength(4);
    expect(filterTimelineStream(stream, 'discussion').map((i) => i.id)).toEqual(['c1']);
    expect(filterTimelineStream(stream, 'changes').map((i) => i.id)).toEqual(['audit:1', 'a3']);
    expect(filterTimelineStream(stream, 'activity').map((i) => i.id)).toEqual(['a1']);
  });
});

describe('RecordActivityTimeline — the stream face', () => {
  const items = mergeTimelineStream([comment, call, created], audit);

  it('draws chips instead of the dropdown, and system entries as compact lines', () => {
    const { container } = render(<RecordActivityTimeline items={items} variant="stream" titleLabel="Timeline" />);
    expect(container.querySelectorAll('[data-stream-filter]')).toHaveLength(4);
    expect(screen.queryByRole('combobox')).toBeNull();
    const lines = Array.from(container.querySelectorAll('[data-stream-system-row]')).map((l) => l.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Status New → Contacted');
    // A comment keeps its full row.
    expect(screen.getByText('Budget is set')).toBeTruthy();
  });

  it('CONTROL — the panel face keeps its dropdown and no compact lines', () => {
    const { container } = render(<RecordActivityTimeline items={items} />);
    expect(container.querySelector('[data-stream-filter]')).toBeNull();
    expect(container.querySelector('[data-stream-system-row]')).toBeNull();
  });
});

describe('record:activity on the default record page is the stream', () => {
  const many: FeedItem[] = Array.from({ length: 25 }, (_, i) => ({
    id: `c${i}`,
    type: 'comment',
    actor: 'Ada',
    body: `Note ${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  }));

  const mount = (onDefaultPage: boolean) =>
    render(
      <DefaultRecordPageContext.Provider value={onDefaultPage}>
        <DiscussionContextProvider items={[call, ...many]} loading={false}>
          <RecordFieldChangesContext.Provider value={audit}>
            <RecordActivityRenderer schema={{ type: 'record:activity', showCompleted: true } as any} />
          </RecordFieldChangesContext.Provider>
        </DiscussionContextProvider>
      </DefaultRecordPageContext.Provider>,
    );

  it('merges the field changes in, pages at 20, and 「查看全部 N 条」 shows the rest', () => {
    const { container } = mount(true);
    expect(container.querySelector('[data-stream-filters]')).toBeTruthy();
    const viewAll = container.querySelector('[data-stream-view-all]') as HTMLButtonElement;
    expect(viewAll).toBeTruthy();
    // 25 notes + the call + the audit change.
    expect(viewAll.textContent).toContain('27');
    fireEvent.click(viewAll);
    expect(container.querySelector('[data-stream-view-all]')).toBeNull();
  });

  it('a chip filters the whole stream, not the first page', () => {
    const { container } = mount(true);
    fireEvent.click(container.querySelector('[data-stream-filter="changes"]')!);
    expect(container.querySelectorAll('[data-stream-system-row]')).toHaveLength(1);
    fireEvent.click(container.querySelector('[data-stream-filter="activity"]')!);
    expect(screen.getByText('Logged a call')).toBeTruthy();
  });

  it('CONTROL — elsewhere the block keeps its panel face and ignores the field changes', () => {
    const { container } = mount(false);
    expect(container.querySelector('[data-stream-filters]')).toBeNull();
    expect(container.querySelector('[data-stream-system-row]')).toBeNull();
  });
});
