/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36193 — a slotted page's `discussion` slot holding
 * `record:chatter` (or `record:discussion`) is drawn on the record page's 动态
 * tab. While the comment panel beside the record holds the comments
 * (objectstack#36075), that block draws the system entries alone: no comment
 * and no reply, no composer, no Comments-only filter, a count without the
 * comments, and the 动态 heading rather than 「讨论」.
 *
 * CONTROLS: without the panel (the phone, or no host saying), and off the
 * default page (a page an author composed whole), the block is as it was.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordChatterRenderer } from '../record-chatter';
import { RecordCommentsInPanelContext } from '../../recordTimelineStream';
import { DefaultRecordPageContext } from '../../defaultRecordPage';

afterEach(cleanup);

const comment: FeedItem = { id: 'c1', type: 'comment', actor: 'Ada', body: 'Follow up on the renewal quote', createdAt: '2026-11-21T10:00:00Z' };
const reply: FeedItem = { id: 'c2', type: 'comment', actor: 'Ada', body: 'Got it', parentId: 'c1', createdAt: '2026-11-21T10:05:00Z' };
const system: FeedItem = { id: 's1', type: 'system', actor: 'System', body: 'Owner changed to Ada', createdAt: '2026-11-20T09:00:00Z' };

function mount({
  inPanel,
  onDefaultPage = true,
  items = [system, comment, reply],
  type = 'record:chatter',
  commentsDenied = false,
}: { inPanel: boolean; onDefaultPage?: boolean; items?: FeedItem[]; type?: string; commentsDenied?: boolean }) {
  return render(
    <DefaultRecordPageContext.Provider value={onDefaultPage}>
      <RecordCommentsInPanelContext.Provider value={inPanel}>
        <DiscussionContextProvider items={items as any[]} loading={false} commentsDenied={commentsDenied} onAddComment={() => undefined}>
          <RecordChatterRenderer schema={{ type, position: 'bottom', collapsible: false } as any} />
        </DiscussionContextProvider>
      </RecordCommentsInPanelContext.Provider>
    </DefaultRecordPageContext.Provider>,
  );
}

const heading = (container: HTMLElement) => container.querySelector('h2')?.textContent ?? '';

describe('record:chatter on the 动态 tab while the comments are in the panel (objectstack#36193)', () => {
  it.each(['record:chatter', 'record:discussion'])('%s: system entries only, no comment box, no Discussion heading, the count without comments', (type) => {
    const { container } = mount({ inPanel: true, type });
    expect(container.textContent).toContain('Owner changed to Ada');
    expect(container.textContent).not.toContain('Follow up on the renewal quote');
    expect(container.textContent).not.toContain('Got it');
    expect(container.querySelector('textarea')).toBeNull();
    expect(heading(container)).not.toMatch(/Discussion/);
    expect(container.querySelector('[data-testid="activity-count"]')?.textContent).toContain('1');
  });

  it('no system history: the empty line names activity, not comments', () => {
    const { container } = mount({ inPanel: true, items: [comment, reply] });
    expect(container.textContent).not.toContain('Follow up on the renewal quote');
    expect(container.textContent).not.toMatch(/No comments yet/);
  });

  it('a refused comment read is the panel\'s to say, not this block\'s', () => {
    const { container } = mount({ inPanel: true, commentsDenied: true });
    expect(container.textContent).toContain('Owner changed to Ada');
    expect(container.querySelector('[data-testid="activity-count"]')?.textContent).toContain('1');
  });

  it('CONTROL — without the panel (the phone) the block keeps its comments, composer and heading', () => {
    const { container } = mount({ inPanel: false });
    expect(container.textContent).toContain('Follow up on the renewal quote');
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(heading(container)).toMatch(/Discussion/);
  });

  it('CONTROL — off the default page (an authored page) the flag changes nothing', () => {
    const { container } = mount({ inPanel: true, onDefaultPage: false });
    expect(container.textContent).toContain('Follow up on the renewal quote');
    expect(container.querySelector('textarea')).toBeTruthy();
  });
});
