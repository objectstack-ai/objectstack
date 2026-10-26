/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:chatter` / `record:discussion` REFUSE a `feed.limit` the contract
 * rejects, and say so (objectui#10145, ruled STOP).
 *
 * `RecordChatterProps.feed` is `RecordActivityProps`, whose `limit` is
 * `z.number().int().positive().default(20)`, so these two blocks resolve their
 * page size through the same `normalizeLimit` as `record:activity`. Until
 * objectui#10145 that resolver ran `Number(value)` first and read `'2'` as a
 * two-row page; the spec refuses a string outright, so the page now falls back
 * to the default and the renderer names the refused value on the developer
 * channel.
 *
 * The observable is the number of ROOT rows the panel shows: with six comments
 * on hand, a two-row page shows two, and the default page (20) shows all six.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordChatterRenderer } from '../record-chatter';

/** Six root comments, oldest first. */
const SIX: FeedItem[] = Array.from({ length: 6 }, (_, i) => ({
  id: `c${i + 1}`,
  type: 'comment',
  actor: 'Ada',
  body: `Comment number ${i + 1}`,
  createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
})) as FeedItem[];

const handlers = { onAddComment: vi.fn(), onAddReply: vi.fn(), onToggleReaction: vi.fn() };

function mount(type: string, limit: unknown) {
  return render(
    <DiscussionContextProvider items={SIX as any} loading={false} {...handlers}>
      <RecordChatterRenderer schema={{ type, position: 'bottom', feed: { limit } } as any} />
    </DiscussionContextProvider>,
  );
}

const shownRows = () => screen.queryAllByText(/Comment number \d/).length;

describe.each(['record:chatter', 'record:discussion'])('%s — `feed.limit` admits only a positive integer number (objectui#10145)', (blockName) => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const rowCapWarnings = () =>
    (warn.mock.calls as unknown[][])
      .map((args) => args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '))
      .filter((text) => text.includes('row cap'));

  it('CONTROL — a usable NUMBER cap narrows the page, silently', () => {
    mount(blockName, 2);
    expect(shownRows()).toBe(2);
    expect(rowCapWarnings()).toEqual([]);
  });

  it.each([
    ['a numeric string', '2', '"2" (string)'],
    ['a padded numeric string', ' 2 ', '" 2 " (string)'],
    ['a boolean', true, 'true (boolean)'],
    ['an array', [2], '[2] (array)'],
  ])('refuses %s — the page falls back to the default and one warning names the block', (_label, authored, spelled) => {
    mount(blockName, authored);
    // Default page (20) over six rows: all six, ⛔ not the two `Number()` read.
    expect(shownRows()).toBe(6);
    const hits = rowCapWarnings();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain(`${blockName} feed row cap`);
    expect(hits[0]).toContain(`declared limit: ${spelled}`);
  });
});
