/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A relative time never breaks word by word in a narrow record drawer
 * (objectstack#34614).
 *
 * Measured in Chromium on the real components at a 380 px drawer: the meta
 * line's "Updated by NAME · 2 days ago" drew "2 / days / ago" on three lines,
 * and an activity entry's header drew "3 天前" as "3" over "天前", because
 * each time sat in a row that could only shrink it. Now the time (with its
 * leading dot where it has one) is one unbreakable piece, and the row wraps
 * BETWEEN its pieces, so the whole piece moves to the next line.
 *
 * The test DOM resolves no Tailwind and has no layout engine, so this file
 * pins the class shape only; it measures no width.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordMetaFooter } from '../RecordMetaFooter';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { ThreadedReplies } from '../ThreadedReplies';
import { activityRowToFeedItem, type SysActivityRow } from '../renderers/recordActivityFeed';
import { mergeTimelineStream } from '../recordTimelineStream';

afterEach(cleanup);

const tokens = (el: Element | null): string[] => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('the meta line keeps "· time" on one line (objectstack#34614)', () => {
  const data = {
    created_at: daysAgo(3),
    created_by: 'Jianguo Zhuang',
    updated_at: daysAgo(2),
    updated_by: 'Ada Lovelace',
  };

  it('draws the dot and the time inside one unbreakable unit', () => {
    const { container } = render(<RecordMetaFooter data={data} />);
    const units = Array.from(container.querySelectorAll('[data-record-meta-when]'));
    expect(units).toHaveLength(2);
    for (const unit of units) {
      expect(tokens(unit)).toContain('whitespace-nowrap');
      expect(unit.querySelector('time')).not.toBeNull();
      expect(unit.textContent?.startsWith('·')).toBe(true);
    }
  });

  it('lets each entry wrap between label, user and the time unit', () => {
    const { container } = render(<RecordMetaFooter data={data} />);
    const entries = Array.from(container.querySelectorAll('[data-record-meta-entry]'));
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(tokens(entry)).toContain('flex-wrap');
  });

  it('CONTROL — an entry with no actor carries the time unit without a dot', () => {
    const { container } = render(<RecordMetaFooter data={{ created_at: daysAgo(3) }} />);
    const unit = container.querySelector('[data-record-meta-when]');
    expect(tokens(unit)).toContain('whitespace-nowrap');
    expect(unit?.textContent?.includes('·')).toBe(false);
  });
});

describe('activity entries keep their time on one line (objectstack#34614)', () => {
  const comment: FeedItem = {
    id: 'c1',
    type: 'comment',
    actor: 'Jianguo Zhuang',
    body: 'Sent the revised quote.',
    createdAt: daysAgo(3),
  };

  it("an entry's header wraps between pieces and its time never breaks", () => {
    const { container } = render(<RecordActivityTimeline items={[comment]} />);
    const when = container.querySelector('[data-feed-when]');
    expect(tokens(when)).toContain('whitespace-nowrap');
    expect(tokens(when?.parentElement ?? null)).toContain('flex-wrap');
  });

  it("a folded run's header does the same", () => {
    const at = (minute: number) => new Date(Date.now() - 3 * 86_400_000 + minute * 60_000).toISOString();
    const row = (id: string, minute: number): SysActivityRow => ({
      id,
      type: 'updated',
      summary: `Updated ${id}`,
      timestamp: at(minute),
      actor_id: null,
      changed_fields: ['num_sent'],
    });
    const items = [row('a-1', 0), row('a-2', 1)]
      .map((r) => activityRowToFeedItem(r, 'System'))
      .filter((i): i is FeedItem => i !== null);
    const { container } = render(<RecordActivityTimeline items={items} />);
    const count = container.querySelector('[data-testid="activity-fold-count"]');
    expect(count).not.toBeNull();
    const when = count!.parentElement!.querySelector('[data-feed-when]');
    expect(tokens(when)).toContain('whitespace-nowrap');
    expect(tokens(count!.parentElement)).toContain('flex-wrap');
  });

  it('a compact system line keeps "· time" as one unbreakable unit after a break opportunity', () => {
    const change = {
      id: 'a2',
      type: 'field_change',
      actor: 'Ada Lovelace',
      body: 'updated',
      createdAt: daysAgo(3),
      activityType: 'updated',
    } as FeedItem;
    const { container } = render(
      <RecordActivityTimeline items={mergeTimelineStream([change], null)} variant="stream" titleLabel="Timeline" />,
    );
    const unit = container.querySelector('[data-stream-system-row] [data-stream-when]');
    expect(tokens(unit)).toContain('whitespace-nowrap');
    expect(unit?.textContent?.startsWith('· ')).toBe(true);
    // The space before the unit is OUTSIDE it, so the line can still break there.
    expect(unit?.previousSibling?.textContent).toBe(' ');
    // The line reads exactly as it did: "… · Ada Lovelace · 3d ago".
    expect(container.querySelector('[data-stream-system-row] p')?.textContent).toContain('Ada Lovelace · ');
  });

  it("a reply's header wraps between pieces and its time never breaks", () => {
    const reply: FeedItem = { id: 'r1', type: 'comment', actor: 'Ada Lovelace', body: 'Thanks', createdAt: daysAgo(3), parentId: 'c1' };
    const { container } = render(<ThreadedReplies parentItem={comment} replies={[reply]} />);
    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    const when = container.querySelector('[data-feed-when]');
    expect(when).not.toBeNull();
    expect(tokens(when)).toContain('whitespace-nowrap');
    expect(tokens(when?.parentElement ?? null)).toContain('flex-wrap');
  });
});
