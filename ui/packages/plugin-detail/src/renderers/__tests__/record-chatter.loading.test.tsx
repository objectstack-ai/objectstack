/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `record:chatter` / `record:discussion` — the loading signal reaches the
 * panel (objectui#3209).
 *
 * #3205 gave `RecordActivityTimeline` the branch that renders a loading row
 * instead of the empty copy, and `RecordChatterPanel` already forwarded
 * `loading` to it in both positions. The chain was still dead on this hop:
 * this renderer passed `items` and every handler off `DiscussionContext` but
 * dropped `loading`, even though `DiscussionContextValue` declares it and
 * `record:activity` was already reading it. So a hand-placed
 * `record:discussion` spent the host's whole feed fetch asserting
 * "No comments yet" — a factual claim about the record, made before the
 * fetch that would answer it had returned.
 *
 * The assertions are on what the USER sees (loading row vs. empty copy), not
 * on "a prop was forwarded": the prop travelling and the render branch firing
 * are two different facts, and only together are they the fix.
 */

import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordChatterRenderer } from '../record-chatter';

const EMPTY_COMMENTS = 'No comments yet';
// U+2026, matching `detail.loading` in the en pack (objectui#3878).
const LOADING = 'Loading…';

const ITEMS: FeedItem[] = [
  {
    id: 'c-1',
    type: 'comment',
    actor: 'Ada',
    body: 'Already on screen',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
];

beforeEach(() => {
  cleanup();
});

describe('record:chatter — the host loading signal reaches the rendered panel', () => {
  it.each(['bottom', 'right', 'left'] as const)(
    'renders the loading row, not the empty copy, while the host feed is fetching (position: %s)',
    (position) => {
      render(
        <DiscussionContextProvider items={[]} loading>
          <RecordChatterRenderer schema={{ position } as any} />
        </DiscussionContextProvider>,
      );

      expect(screen.getByTestId('activity-loading')).toBeTruthy();
      expect(screen.getByText(LOADING)).toBeTruthy();
      // The regression itself: no "this record has no comments" claim while
      // the host's fetch is still in flight.
      expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
    },
  );

  it('falls through to the empty copy once the host fetch has settled with no items', () => {
    render(
      <DiscussionContextProvider items={[]} loading={false}>
        <RecordChatterRenderer schema={{ position: 'bottom' } as any} />
      </DiscussionContextProvider>,
    );

    expect(screen.getByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('shows the rows once they land, with no loading row left behind', () => {
    const view = render(
      <DiscussionContextProvider items={[]} loading>
        <RecordChatterRenderer schema={{ position: 'bottom' } as any} />
      </DiscussionContextProvider>,
    );
    expect(screen.getByTestId('activity-loading')).toBeTruthy();

    view.rerender(
      <DiscussionContextProvider items={ITEMS as any} loading={false}>
        <RecordChatterRenderer schema={{ position: 'bottom' } as any} />
      </DiscussionContextProvider>,
    );

    expect(screen.getByText('Already on screen')).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
  });

  it('a host that never reports loading still gets the empty copy, not a spinner', () => {
    // `loading` is optional on DiscussionContextValue: a host that owns no
    // fetch (or a standalone preview) says nothing, and "nothing" means
    // settled — the panel must not invent a loading state of its own.
    render(
      <DiscussionContextProvider items={[]}>
        <RecordChatterRenderer schema={{ position: 'bottom' } as any} />
      </DiscussionContextProvider>,
    );

    expect(screen.getByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('renders the empty copy with no DiscussionContext at all', () => {
    // Standalone previews mount the block with no host — it composes, and it
    // does not hang on a spinner it has no way to clear.
    render(<RecordChatterRenderer schema={{ position: 'bottom' } as any} />);

    expect(screen.getByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });
});
