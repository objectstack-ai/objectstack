/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record page's activity reads as dense one-line rows (objectstack#35602):
 * entries grouped under a day heading, one line per entry, a run of field
 * edits by the same person on the same day folded into one expandable row
 * (display only), an approval as one line with 「看审批」, and a comment box
 * that is one line until it is focused.
 *
 * The test DOM has no layout engine, so heights are measured in the browser
 * (the PR's before/after table); this file pins the structure.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline, foldStreamChanges } from '../RecordActivityTimeline';
import { mergeTimelineStream } from '../recordTimelineStream';

afterEach(cleanup);

const today = (minute: number) => {
  const d = new Date();
  d.setHours(9, minute, 0, 0);
  return d.toISOString();
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const edit = (id: string, actorId: string, createdAt: string): FeedItem =>
  ({
    id,
    type: 'field_change',
    actor: actorId === 'u1' ? 'Ada Lovelace' : 'Grace Hopper',
    actorId,
    body: 'updated',
    createdAt,
    activityType: 'updated',
  }) as FeedItem;

describe('dense activity rows (objectstack#35602)', () => {
  it('folds consecutive edits by the same person on the same day, and only those', () => {
    const entries = foldStreamChanges([
      edit('a', 'u1', today(5)),
      edit('b', 'u1', today(4)),
      edit('c', 'u1', today(3)),
      edit('d', 'u2', today(2)),
      edit('e', 'u1', daysAgo(3)),
    ]);
    const kinds = entries.map((e: any) => (e.kind === 'fold' ? `fold:${e.items.length}` : 'item'));
    expect(kinds).toEqual(['fold:3', 'item', 'item']);
  });

  it('draws a fold as one row that expands to its edits, without changing the items', () => {
    const items = mergeTimelineStream(
      [edit('a', 'u1', today(5)), edit('b', 'u1', today(4)), edit('c', 'u1', today(3))],
      null,
    );
    const { container } = render(<RecordActivityTimeline items={items} variant="stream" titleLabel="Timeline" />);
    const fold = container.querySelector('[data-testid="activity-fold"]');
    expect(fold).not.toBeNull();
    expect(fold!.getAttribute('data-fold-count')).toBe('3');
    expect(container.querySelector('[data-testid="activity-fold-entries"]')).toBeNull();
    const toggle = fold!.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      container.querySelectorAll('[data-testid="activity-fold-entries"] [data-stream-row]').length,
    ).toBe(3);
  });

  it('groups entries under a day heading, today first', () => {
    const comment = (id: string, createdAt: string): FeedItem => ({
      id,
      type: 'comment',
      actor: 'Ada Lovelace',
      body: `Note ${id}`,
      createdAt,
    });
    const { container } = render(
      <RecordActivityTimeline items={[comment('c1', today(1)), comment('c2', daysAgo(5))]} />,
    );
    const days = Array.from(container.querySelectorAll('[data-stream-day]'));
    expect(days.length).toBe(2);
    const labels = days.map((d) => d.querySelector('[data-stream-day-label]')?.textContent);
    expect(labels[0]).toMatch(/Today|今天|detail\.streamToday/);
    expect(days[0].querySelectorAll('[data-stream-comment-row]').length).toBe(1);
    expect(days[1].querySelectorAll('[data-stream-comment-row]').length).toBe(1);
  });

  it('draws a comment as its header line plus the text, with the time in the header', () => {
    const { container } = render(
      <RecordActivityTimeline
        items={[{ id: 'c1', type: 'comment', actor: 'Ada Lovelace', body: 'Sent the quote.', createdAt: today(1) }]}
      />,
    );
    const row = container.querySelector('[data-stream-comment-row]')!;
    expect(row.querySelector('[data-feed-when]')).not.toBeNull();
    expect(row.textContent).toContain('Sent the quote.');
  });

  it('draws an approval as one line, with 「看审批」 only where the host can open the approvals', () => {
    const approval: FeedItem = {
      id: 'ap1',
      type: 'approval',
      actor: 'Grace Hopper',
      body: 'Submitted for approval',
      createdAt: today(1),
    };
    const { container, rerender } = render(<RecordActivityTimeline items={[approval]} />);
    const row = container.querySelector('[data-stream-approval-row]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-stream-view-approval]')).toBeNull();
    const onViewApprovals = vi.fn();
    rerender(<RecordActivityTimeline items={[approval]} onViewApprovals={onViewApprovals} />);
    const button = container.querySelector('[data-stream-view-approval]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    fireEvent.click(button);
    expect(onViewApprovals).toHaveBeenCalledTimes(1);
  });

  it('keeps the comment box to one line until it is focused', () => {
    const { container } = render(
      <RecordActivityTimeline items={[]} variant="stream" titleLabel="Timeline" onAddComment={vi.fn()} />,
    );
    const box = container.querySelector('[data-composer-collapsed]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.getAttribute('data-composer-collapsed')).toBe('true');
    const textarea = box.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('rows')).toBe('1');
    fireEvent.focus(textarea);
    expect(box.getAttribute('data-composer-collapsed')).toBe('false');
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });
});
