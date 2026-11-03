/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28737 — the 动态 stream's count is the host's where it has one.
 *
 * The record page payload counts the stream on the server (`timeline`), and
 * the page then holds only the newest activity rows, the 动态 panel's. So the
 * panel's count chip, its 「查看全部 N 条」, the 动态 tab's count and the tab
 * row's probe all name the host's count (`RecordTimelineTotalContext`), never
 * the size of the rows held — and still name nothing while the feed loads or
 * a read is refused. Without a host count, each counts the rows it holds.
 *
 * And the types the stream draws no entry for are ONE definition with the
 * server's count: the activity reading maps exactly
 * `RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES` to no entry, and an update steps
 * aside for a field change by `RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { DiscussionContextProvider, SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES, RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE } from '@objectstack/spec/api';
import type { FeedItem } from '@object-ui/types';
import { RecordTimelinePanel } from '../RecordTimelinePanel';
import { DefaultRecordPageContext } from '../defaultRecordPage';
import {
  RecordFieldChangesContext,
  RecordTimelineCountContext,
  RecordTimelineTotalContext,
  auditEntriesToFeedItems,
  mergeTimelineStream,
} from '../recordTimelineStream';
import { RecordTimelineCountProbe } from '../renderers/record-activity';
import { ACTIVITY_TYPE_TO_FEED_TYPE } from '../renderers/recordActivityFeed';
import { buildDefaultTimeline } from '../synth/buildDefaultPageSchema';
import '../index';

afterEach(cleanup);

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();
// What the page holds: a comment and the 动态 panel's five activity rows.
const held: FeedItem[] = [
  { id: 'c1', type: 'comment', actor: 'Ada', body: 'Called back', createdAt: at(1) },
  ...Array.from({ length: 5 }, (_, i): FeedItem => ({
    id: `a${i}`,
    type: 'system',
    actor: 'System',
    body: `Step ${i}`,
    createdAt: at(10 + i),
  })),
];
const SERVED = 341;

function mount({
  total = SERVED as number | null,
  items = held,
  loading = false,
  activityDenied = false,
}: { total?: number | null; items?: FeedItem[]; loading?: boolean; activityDenied?: boolean } = {}) {
  return render(
    <DefaultRecordPageContext.Provider value>
      <DiscussionContextProvider items={items as any[]} loading={loading} activityDenied={activityDenied}>
        <RecordFieldChangesContext.Provider value={null}>
          <RecordTimelineTotalContext.Provider value={total}>
            <RecordTimelinePanel nodes={[buildDefaultTimeline()]} entries={5} onViewAll={vi.fn()} />
          </RecordTimelineTotalContext.Provider>
        </RecordFieldChangesContext.Provider>
      </DiscussionContextProvider>
    </DefaultRecordPageContext.Provider>,
  );
}

const chipOf = (container: HTMLElement) => container.querySelector('[data-record-timeline-count]')?.textContent ?? null;

describe('objectstack#28737 — the 动态 panel names the host\'s count of the whole stream', () => {
  it('the count chip and 「查看全部 N 条」 name the served total, not the six rows held', async () => {
    const { container } = mount();
    await waitFor(() => expect(chipOf(container)).toBe(String(SERVED)));
    const viewAll = container.querySelector('[data-record-timeline-view-all]') as HTMLButtonElement;
    expect(viewAll.textContent).toContain(String(SERVED));
    // The panel still draws the newest rows it holds.
    expect(container.querySelectorAll('[data-record-timeline-peek-row]')).toHaveLength(5);
  });

  it('a served 0 is a count: the chip says 0', async () => {
    const { container } = mount({ total: 0, items: [] });
    await waitFor(() => expect(chipOf(container)).toBe('0'));
  });

  it('names no count while the feed loads, or when a read was refused, whatever the host counted', () => {
    expect(chipOf(mount({ loading: true }).container)).toBeNull();
    cleanup();
    expect(chipOf(mount({ activityDenied: true }).container)).toBeNull();
  });

  it('CONTROL — without a host count, the chip counts the rows held', async () => {
    const { container } = mount({ total: null });
    await waitFor(() => expect(chipOf(container)).toBe(String(held.length)));
  });
});

describe('objectstack#28737 — the 动态 tab and the tab row\'s probe report the host\'s count', () => {
  it('the stream drawn in full reports the served total while 全部 is on', async () => {
    const reported = vi.fn();
    render(
      <DefaultRecordPageContext.Provider value>
        <DiscussionContextProvider items={held as any[]} loading={false}>
          <RecordTimelineTotalContext.Provider value={SERVED}>
            <RecordTimelineCountContext.Provider value={reported}>
              <RecordTimelinePanelNodes />
            </RecordTimelineCountContext.Provider>
          </RecordTimelineTotalContext.Provider>
        </DiscussionContextProvider>
      </DefaultRecordPageContext.Provider>,
    );
    await waitFor(() => expect(reported).toHaveBeenLastCalledWith(SERVED));
  });

  it('the probe reports the served total, and the rows\' count without one', async () => {
    const probe = (total: number | null) => {
      const onCount = vi.fn();
      render(
        <DiscussionContextProvider items={held as any[]} loading={false}>
          <RecordTimelineTotalContext.Provider value={total}>
            <RecordTimelineCountProbe nodes={[buildDefaultTimeline()]} onCount={onCount} />
          </RecordTimelineTotalContext.Provider>
        </DiscussionContextProvider>,
      );
      return onCount;
    };
    const served = probe(SERVED);
    await waitFor(() => expect(served).toHaveBeenLastCalledWith(SERVED));
    cleanup();
    const own = probe(null);
    await waitFor(() => expect(own).toHaveBeenLastCalledWith(held.length));
  });
});

describe('objectstack#28737 — the types the stream draws no entry for are one definition with the server\'s count', () => {
  it('the activity reading maps exactly RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES to no entry', () => {
    const undrawn = Object.keys(ACTIVITY_TYPE_TO_FEED_TYPE).filter((type) => ACTIVITY_TYPE_TO_FEED_TYPE[type] === undefined);
    expect(undrawn.sort()).toEqual([...RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES].sort());
  });

  it('an update steps aside for a field change by RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE, and nothing else does', () => {
    const update = { id: 'u1', type: 'field_change', actor: 'Ada', body: '', createdAt: at(2), activityType: RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE } as FeedItem;
    const created = { id: 'n1', type: 'field_change', actor: 'Ada', body: '', createdAt: at(0), activityType: 'created' } as FeedItem;
    const changes = auditEntriesToFeedItems(
      [{ id: 1, created_at: at(2), user_name: 'Ada', changes: [{ field: 'status', from: 'a', to: 'b' }] }],
      { unknownUser: 'Unknown' },
    );
    expect(mergeTimelineStream([update, created], changes).map((item) => item.id)).toEqual(['audit:1', 'n1']);
    expect(mergeTimelineStream([update, created], []).map((item) => item.id)).toEqual(['u1', 'n1']);
  });
});

/** The default page's 动态 block drawn in full (outside the panel). */
function RecordTimelinePanelNodes() {
  return <SchemaRenderer schema={toRenderableSchema(buildDefaultTimeline())} />;
}
