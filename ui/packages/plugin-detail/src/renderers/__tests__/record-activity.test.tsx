/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:activity` — the feed has a source, and the bound record decides it
 * (objectui#3165).
 *
 * Before #3165 the renderer called `useRecordContext()`, threw the result away
 * and rendered `<RecordActivityTimeline items={[]}>` with the empty array
 * hard-coded — so every one of its eleven declared inputs was a filter or an
 * affordance over a feed that was structurally empty. `apps/console`'s
 * record-reach probe caught that behaviourally (two different records,
 * byte-identical DOM, zero data calls) and ledgered it; this suite is the
 * unit-level statement of the same property, plus the precedence rules the fix
 * introduced.
 *
 * What is asserted, in the order it matters:
 *   1. with nothing but a record context, the block FETCHES, scoped to that
 *      record — the property whose absence was the bug;
 *   2. the declared read-side inputs change what is rendered;
 *   3. a host that owns the feed (`items`, or a mounted DiscussionContext)
 *      wins, and the block does not fetch a second copy;
 *   4. the write-path switches are wired to that host's handlers, so
 *      `showCommentInput` / `enableMentions` are real switches rather than
 *      decoration;
 *   5. `showSubscriptionToggle` is pinned as the ONE documented gap — asserted
 *      inert on purpose, so the day a subscription backend exists this test
 *      fails and the "NOT IMPLEMENTED" note at the registration site has to be
 *      deleted with it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { RecordContextProvider, DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityRenderer } from '../record-activity';

const COMPOSER_PLACEHOLDER = 'Leave a comment… (Ctrl+Enter to submit)';
const EMPTY_FEED = 'No activity recorded';

/** Rows as `sys_activity` returns them for one record. */
const ROWS = [
  {
    id: 'act-1',
    type: 'updated',
    summary: 'Stage: draft to qualified',
    timestamp: '2026-01-02T00:00:00.000Z',
    actor_name: 'Grace',
  },
  {
    id: 'act-2',
    type: 'commented',
    summary: 'lives in sys_comment, not here',
    timestamp: '2026-01-03T00:00:00.000Z',
    actor_name: 'Ada',
  },
  {
    id: 'act-3',
    type: 'completed',
    summary: 'Follow-up call closed',
    timestamp: '2026-01-04T00:00:00.000Z',
    actor_name: 'Ada',
  },
  {
    id: 'act-4',
    type: 'system',
    summary: 'Assignment rule ran',
    timestamp: '2026-01-05T00:00:00.000Z',
  },
];

const makeDataSource = (rows: unknown[] = ROWS) =>
  ({ find: vi.fn().mockResolvedValue({ data: rows }) }) as any;

const mountBound = (
  schema: Record<string, unknown>,
  dataSource: any,
  wrap: (node: React.ReactNode) => React.ReactNode = (n) => n,
  recordId = 'rec-alpha',
) =>
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId={recordId}
      data={{ id: recordId, name: 'Alpha' }}
      dataSource={dataSource}
    >
      {wrap(<RecordActivityRenderer schema={schema as any} />)}
    </RecordContextProvider>,
  );

beforeEach(() => {
  cleanup();
});

describe('record:activity — self-fetch scoped to the bound record', () => {
  it('reads sys_activity for THIS record when no host owns the feed', async () => {
    const dataSource = makeDataSource();
    mountBound({}, dataSource);

    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const [object, query] = dataSource.find.mock.calls[0];
    expect(object).toBe('sys_activity');
    expect(query.$filter).toEqual({ object_name: 'crm_account', record_id: 'rec-alpha' });
    // Newest first, one row past the window so "Load more" can be honest.
    expect(query.$orderby).toEqual({ timestamp: 'desc' });
    expect(query.$top).toBe(21); // spec default limit 20, +1

    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.getByText('Assignment rule ran')).toBeTruthy();
  });

  it('re-scopes the fetch when the bound record changes', async () => {
    const dataSource = makeDataSource();
    const view = mountBound({}, dataSource);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][1].$filter.record_id).toBe('rec-alpha');

    view.rerender(
      <RecordContextProvider
        objectName="crm_account"
        recordId="rec-bravo"
        data={{ id: 'rec-bravo', name: 'Bravo' }}
        dataSource={dataSource}
      >
        <RecordActivityRenderer schema={{} as any} />
      </RecordContextProvider>,
    );

    await waitFor(() =>
      expect(
        dataSource.find.mock.calls.some((c: any[]) => c[1]?.$filter?.record_id === 'rec-bravo'),
      ).toBe(true),
    );
  });

  it('skips the comment/mention rows — their content lives in sys_comment', async () => {
    mountBound({ showCompleted: true }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByText('lives in sys_comment, not here')).toBeNull();
  });

  it('fetches nothing and renders an empty feed with no record bound', async () => {
    render(<RecordActivityRenderer schema={{} as any} />);
    await waitFor(() => expect(screen.getByText(EMPTY_FEED)).toBeTruthy());
  });

  it('treats a missing sys_activity table as "no activity", not an error', async () => {
    const dataSource = { find: vi.fn().mockRejectedValue(new Error('404 not provisioned')) } as any;
    mountBound({}, dataSource);
    expect(await screen.findByText(EMPTY_FEED)).toBeTruthy();
  });
});

describe('record:activity — the declared read-side inputs change what is rendered', () => {
  it('hides completed activities by default and shows them on request', async () => {
    const view = mountBound({}, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByText('Follow-up call closed')).toBeNull();
    view.unmount();

    mountBound({ showCompleted: true }, makeDataSource());
    expect(await screen.findByText('Follow-up call closed')).toBeTruthy();
  });

  it('types narrows the feed to the listed feed item types', async () => {
    mountBound({ types: ['system'] }, makeDataSource());
    expect(await screen.findByText('Assignment rule ran')).toBeTruthy();
    expect(screen.queryByText('Stage: draft to qualified')).toBeNull();
  });

  it('unifiedTimeline:false un-mixes field changes out of the stream', async () => {
    mountBound({ unifiedTimeline: false }, makeDataSource());
    expect(await screen.findByText('Assignment rule ran')).toBeTruthy();
    expect(screen.queryByText('Stage: draft to qualified')).toBeNull();
  });

  it('limit caps the scoped read and the rendered page, and offers to grow it', async () => {
    const dataSource = makeDataSource();
    mountBound({ limit: 1, showCompleted: true }, dataSource);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][1].$top).toBe(2); // limit + 1

    // Only the newest surviving item is on the first page.
    expect(await screen.findByText('Assignment rule ran')).toBeTruthy();
    expect(screen.queryByText('Follow-up call closed')).toBeNull();

    // "Load more" grows the window by `limit` — and re-asks for a window that
    // size, rather than paging client-side over rows it never fetched.
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Follow-up call closed')).toBeTruthy();
    await waitFor(() =>
      expect(dataSource.find.mock.calls.some((c: any[]) => c[1]?.$top === 3)).toBe(true),
    );
  });

  it('filterMode seeds which slice of the feed the panel opens on', async () => {
    mountBound({ filterMode: 'changes_only' }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByText('Assignment rule ran')).toBeNull();
  });

  it('an unrecognised filterMode falls back to "all" rather than a filter nothing matches', async () => {
    // objectui#3151's posture: an unknown filter token is skipped, never turned
    // into a predicate that can only ever be empty.
    mountBound({ filterMode: 'not_a_mode' }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.getByText('Assignment rule ran')).toBeTruthy();
  });

  it('showFilterToggle:false removes the filter dropdown', async () => {
    const view = mountBound({}, makeDataSource());
    expect(await screen.findByLabelText('Filter activity')).toBeTruthy();
    view.unmount();

    mountBound({ showFilterToggle: false }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByLabelText('Filter activity')).toBeNull();
  });
});

const HOST_ITEMS: FeedItem[] = [
  {
    id: 'h1',
    type: 'comment',
    actor: 'Ada',
    body: 'host supplied',
    createdAt: '2026-02-01T00:00:00.000Z',
  },
];

describe('record:activity — a host that owns the feed wins', () => {
  it('presents `items` from the node and does not fetch', async () => {
    const dataSource = makeDataSource();
    mountBound({ items: HOST_ITEMS }, dataSource);
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('reads `properties.items` too — the spec bridge preserves the raw bag', async () => {
    const dataSource = makeDataSource();
    mountBound({ properties: { items: HOST_ITEMS } }, dataSource);
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('presents a mounted DiscussionContext feed and does not fetch a second copy', async () => {
    const dataSource = makeDataSource();
    mountBound({}, dataSource, (node) => (
      <DiscussionContextProvider items={HOST_ITEMS as any}>{node}</DiscussionContextProvider>
    ));
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('still applies the declared filters to a host feed', async () => {
    mountBound({ types: ['task'] }, makeDataSource(), (node) => (
      <DiscussionContextProvider items={HOST_ITEMS as any}>{node}</DiscussionContextProvider>
    ));
    await waitFor(() => expect(screen.getByText(EMPTY_FEED)).toBeTruthy());
  });
});

describe('record:activity — the write-path switches are wired to the host handlers', () => {
  const withHost =
    (extra: Record<string, unknown> = {}) =>
    (node: React.ReactNode) => (
      <DiscussionContextProvider items={HOST_ITEMS as any} onAddComment={vi.fn()} {...(extra as any)}>
        {node}
      </DiscussionContextProvider>
    );

  it('showCommentInput renders the composer once a host supplies onAddComment', async () => {
    mountBound({}, makeDataSource(), withHost());
    expect(await screen.findByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeTruthy();
  });

  it('showCommentInput:false hides it even when the host CAN persist a comment', async () => {
    mountBound({ showCommentInput: false }, makeDataSource(), withHost());
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(screen.queryByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeNull();
  });

  it('with no host handler the feed stays read-only — no composer to mislead the author', async () => {
    mountBound({ showCommentInput: true }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeNull();
  });

  it('enableMentions passes the host suggestions through, and false withholds them', async () => {
    const mentionSuggestions = [{ id: 'u1', label: 'Ada Lovelace' }];

    const on = mountBound({}, makeDataSource(), withHost({ mentionSuggestions }));
    const composerOn = await screen.findByPlaceholderText(COMPOSER_PLACEHOLDER);
    fireEvent.change(composerOn, { target: { value: '@' } });
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    on.unmount();

    mountBound({ enableMentions: false }, makeDataSource(), withHost({ mentionSuggestions }));
    const composerOff = await screen.findByPlaceholderText(COMPOSER_PLACEHOLDER);
    fireEvent.change(composerOff, { target: { value: '@' } });
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });
});

describe('record:activity — showSubscriptionToggle is the one documented gap', () => {
  it('renders nothing whatever it is set to, because no subscription backend exists', async () => {
    mountBound({ showSubscriptionToggle: true }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    // The bell would carry one of these aria-labels. Neither can appear: the
    // timeline needs a RecordSubscription value AND a persist handler, and the
    // platform has no object to read or write one from. Pinned so that the day
    // that backend lands, this test fails and the "NOT IMPLEMENTED" note on the
    // input declaration must be deleted with it (objectui#3165).
    expect(screen.queryByLabelText('Subscribe to notifications')).toBeNull();
    expect(screen.queryByLabelText('Unsubscribe from notifications')).toBeNull();
  });
});
