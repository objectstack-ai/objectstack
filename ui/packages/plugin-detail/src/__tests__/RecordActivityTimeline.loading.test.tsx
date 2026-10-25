/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * "Fetching" is not "empty" (objectui#3205).
 *
 * `RecordActivityTimeline` declared a `loading` prop and destructured it into
 * `_loading`, so nothing in the file ever read it: for the whole duration of a
 * feed fetch the panel rendered `DataEmptyState` — "No activity recorded" — and
 * then contradicted itself when the rows landed. The empty copy is a factual
 * claim about the record; it may only be made once the fetch that would fill
 * the feed has settled.
 *
 * The three layers of the chain are pinned separately, because the bug lived
 * at exactly one of them while the other two were already correct:
 *   1. the timeline reads the prop at all;
 *   2. `RecordChatterPanel` forwards it (both positions — sidebar and inline);
 *   3. `record:activity` computes a live one (#3165) and the block therefore
 *      shows the loading row, not the empty copy, while its own fetch is in
 *      flight.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { RecordChatterPanel } from '../RecordChatterPanel';
import { RecordActivityRenderer } from '../renderers/record-activity';

const EMPTY_ACTIVITY = 'No activity recorded';
const EMPTY_COMMENTS = 'No comments yet';
// U+2026, matching `detail.loading` in the en pack (objectui#3878).
const LOADING = 'Loading…';

const ITEMS: FeedItem[] = [
  {
    id: 'act-1',
    type: 'comment',
    actor: 'Ada',
    body: 'Already on screen',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
];

beforeEach(() => {
  cleanup();
});

describe('RecordActivityTimeline — loading is read, not discarded', () => {
  it('shows a loading row instead of the empty state while the feed is fetching', () => {
    render(<RecordActivityTimeline items={[]} loading />);

    expect(screen.getByTestId('activity-loading')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(LOADING)).toBeTruthy();
    // The regression itself: no "this record has no activity" claim mid-fetch.
    expect(screen.queryByText(EMPTY_ACTIVITY)).toBeNull();
  });

  it('shows the empty state once loading has settled with no items', () => {
    render(<RecordActivityTimeline items={[]} loading={false} />);

    expect(screen.getByText(EMPTY_ACTIVITY)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('defaults to the empty state when no host passes `loading` at all', () => {
    render(<RecordActivityTimeline items={[]} />);

    expect(screen.getByText(EMPTY_ACTIVITY)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('honours a custom `emptyLabel` only after the fetch settles', () => {
    const view = render(
      <RecordActivityTimeline items={[]} loading emptyLabel={EMPTY_COMMENTS} />,
    );
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();

    view.rerender(
      <RecordActivityTimeline items={[]} loading={false} emptyLabel={EMPTY_COMMENTS} />,
    );
    expect(screen.getByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('keeps a feed that is already on screen instead of blanking it on refresh', () => {
    // A refresh / "Load more" round-trip must not replace the rows the reader
    // is looking at with a spinner — hence the branch is `loading && empty`,
    // not `loading` alone. ("Load more" carries its own spinner.)
    render(<RecordActivityTimeline items={ITEMS} loading />);

    expect(screen.getByText('Already on screen')).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
    expect(screen.queryByText(EMPTY_ACTIVITY)).toBeNull();
  });

  it('still suppresses the empty copy while loading when collapseWhenEmpty is set', () => {
    // `collapseWhenEmpty` is about the EMPTY state ("collapse when there are
    // no items"); mid-fetch we do not yet know whether there are items, so the
    // loading row is what a host asking to collapse-when-empty gets.
    render(<RecordActivityTimeline items={[]} loading collapseWhenEmpty />);

    expect(screen.getByTestId('activity-loading')).toBeTruthy();
    expect(screen.queryByText(EMPTY_ACTIVITY)).toBeNull();
  });

  it('does not mistake a filtered-out feed for a fetch in flight', () => {
    // Items exist but the active filter excludes them: that is genuinely
    // empty, not loading.
    render(
      <RecordActivityTimeline items={ITEMS} filterMode="tasks_only" loading={false} />,
    );

    expect(screen.getByText(EMPTY_ACTIVITY)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });
});

describe('RecordChatterPanel — the loading pass-through holds end to end', () => {
  it.each(['right', 'left', 'bottom'] as const)(
    'forwards loading to the embedded timeline (position: %s)',
    (position) => {
      render(
        <RecordChatterPanel items={[]} config={{ position }} loading />,
      );

      expect(screen.getByTestId('activity-loading')).toBeTruthy();
      // The panel overrides the empty copy with its own label — neither
      // wording may appear mid-fetch.
      expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
      expect(screen.queryByText(EMPTY_ACTIVITY)).toBeNull();
    },
  );

  it('falls through to the panel empty copy once loading settles', () => {
    render(
      <RecordChatterPanel items={[]} config={{ position: 'bottom' }} loading={false} />,
    );

    expect(screen.getByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });
});

describe('record:activity — the self-fetch shows loading, never the empty copy', () => {
  it('renders the loading row while the sys_activity fetch is in flight', async () => {
    let resolveFind: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFind = resolve;
    });
    const dataSource = { find: vi.fn().mockReturnValue(pending) } as any;

    render(
      <RecordContextProvider
        objectName="crm_account"
        recordId="rec-alpha"
        data={{ id: 'rec-alpha', name: 'Alpha' }}
        dataSource={dataSource}
      >
        <RecordActivityRenderer schema={{} as any} />
      </RecordContextProvider>,
    );

    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(screen.getByTestId('activity-loading')).toBeTruthy();
    expect(screen.queryByText(EMPTY_ACTIVITY)).toBeNull();

    resolveFind({
      data: [
        {
          id: 'act-1',
          type: 'updated',
          summary: 'Stage: draft to qualified',
          timestamp: '2026-01-02T00:00:00.000Z',
          actor_name: 'Grace',
        },
      ],
    });

    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
    expect(screen.queryByText(EMPTY_ACTIVITY)).toBeNull();
  });

  it('shows the empty copy once a fetch settles with no rows', async () => {
    const dataSource = { find: vi.fn().mockResolvedValue({ data: [] }) } as any;

    render(
      <RecordContextProvider
        objectName="crm_account"
        recordId="rec-alpha"
        data={{ id: 'rec-alpha', name: 'Alpha' }}
        dataSource={dataSource}
      >
        <RecordActivityRenderer schema={{} as any} />
      </RecordContextProvider>,
    );

    expect(await screen.findByText(EMPTY_ACTIVITY)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });
});
