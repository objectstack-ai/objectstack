/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36193 — while the comment panel holds the record's comments
 * (objectstack#36075), the 概览 tab's 「最近动态」 card lists the system
 * history alone: no comment, no reply, no 「讨论」 heading, a count of the
 * system entries only, and no card at all when there is no system history.
 *
 * The case that broke it: a slotted page whose `discussion` slot holds
 * `record:chatter`. The chatter block draws the timeline's panel face — the
 * 「讨论 (N)」 heading, the 全部动态 filter, every comment and its replies —
 * and the card drew it as it came. The default `record:activity` stream
 * already dropped the comments (objectstack#36075); it is the CONTROL here.
 *
 * Drawn through the real page (`buildDefaultPageSchema` →
 * `buildDefaultPageColumns` → `RecordPageColumns`, real block renderers).
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordPageColumns } from '../RecordPageColumns';
import { RecordCommentsInPanelContext } from '../recordTimelineStream';
import { buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
import { railStreamNodes } from '../RecordSummaryRail';
import '../index';

afterEach(cleanup);

const comment: FeedItem = { id: 'c1', type: 'comment', actor: 'Ada', body: 'Follow up on the renewal quote', createdAt: '2026-11-21T10:00:00Z' };
const reply: FeedItem = { id: 'c2', type: 'comment', actor: 'Ada', body: 'Got it', parentId: 'c1', createdAt: '2026-11-21T10:05:00Z' };
const system: FeedItem = { id: 's1', type: 'system', actor: 'System', body: 'Owner changed to Ada', createdAt: '2026-11-20T09:00:00Z' };

const OBJECT = { name: 'account', label: 'Account', fields: { name: { name: 'name', type: 'text' } } };

const chatterColumns = () =>
  buildDefaultPageColumns(
    buildDefaultPageSchema(OBJECT as any, {
      slots: { discussion: { type: 'record:chatter', id: 'account_chatter', properties: {} } },
    } as any),
  )!;
const activityColumns = () => buildDefaultPageColumns(buildDefaultPageSchema(OBJECT as any, {}))!;

function draw(columns: ReturnType<typeof chatterColumns>, items: FeedItem[], inPanel: boolean) {
  return render(
    <RecordCommentsInPanelContext.Provider value={inPanel}>
      <DiscussionContextProvider items={items as any[]} loading={false} onAddComment={(async () => {}) as any}>
        <RecordPageColumns tier="wide" columns={columns} onEnlargeRelated={() => {}} />
      </DiscussionContextProvider>
    </RecordCommentsInPanelContext.Provider>,
  );
}

const CARD = '[data-record-summary-card="timeline"]';
const cardOf = (container: HTMLElement) => container.querySelector(CARD) as HTMLElement | null;
const shown = (card: HTMLElement | null) => !!card && !card.closest('[hidden]') && !card.hasAttribute('hidden');

describe('the 最近动态 card while the comments are in the panel (objectstack#36193)', () => {
  it('a slotted record:chatter stream: system history only, no 讨论 heading, the system count', async () => {
    const { container } = draw(chatterColumns(), [system, comment, reply], true);
    const card = cardOf(container)!;
    await waitFor(() => expect(card.textContent).toContain('Owner changed to Ada'));
    expect(card.textContent).not.toContain('Follow up on the renewal quote');
    expect(card.textContent).not.toContain('Got it');
    expect(card.textContent).not.toMatch(/Discussion|讨论/);
    expect(card.querySelector('[data-record-timeline-peek]')).toBeTruthy();
    expect(card.querySelector('textarea')).toBeNull();
    await waitFor(() => expect(card.querySelector('[data-record-summary-card-count]')?.textContent).toBe('1'));
    expect(shown(card)).toBe(true);
  });

  it('no system history: the card is not drawn, a comment does not bring it back', async () => {
    const { container } = draw(chatterColumns(), [comment, reply], true);
    await waitFor(() => expect(shown(cardOf(container))).toBe(false));
  });

  it('CONTROL — without the panel the chatter card is the page\'s own: comments and all', async () => {
    const { container } = draw(chatterColumns(), [system, comment], false);
    const card = cardOf(container)!;
    await waitFor(() => expect(card.textContent).toContain('Follow up on the renewal quote'));
  });

  it('CONTROL — the default record:activity stream already lists the system history only', async () => {
    const { container } = draw(activityColumns(), [system, comment, reply], true);
    const card = cardOf(container)!;
    await waitFor(() => expect(card.textContent).toContain('Owner changed to Ada'));
    expect(card.textContent).not.toContain('Follow up on the renewal quote');
  });

  it('railStreamNodes hands the nodes back untouched without the panel, and leaves record:activity alone', () => {
    const nodes = [{ type: 'record:chatter', properties: { feed: { types: ['comment', 'system'] } } }, { type: 'record:activity' }];
    expect(railStreamNodes(nodes, false)).toBe(nodes);
    const drawn = railStreamNodes(nodes, true);
    expect(drawn[0]).toEqual({ type: 'record:activity', properties: { types: ['comment', 'system'] } });
    expect(drawn[1]).toBe(nodes[1]);
  });
});
