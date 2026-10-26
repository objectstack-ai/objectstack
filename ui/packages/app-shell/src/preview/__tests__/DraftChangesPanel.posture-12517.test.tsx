/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12517 — the pending-changes sheet opens in one of two postures.
 *
 * `confirm` (the Studio's Publish): every row expanded, a per-type summary
 * line above the list, focus on the footer's Publish all. `review` (the
 * Studio's Changes, and the default every other host gets): rows collapsed,
 * focus on the list, the footer button present but not focused, no summary.
 *
 * The CONTROL is the mount the Home page, `DraftPreviewBar` and
 * `CommitTimeline` use: no `posture` prop at all. It must read exactly as the
 * review posture does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    // Interpolating, so the summary line reads as an author would see it.
    t: (_k: string, o?: Record<string, unknown> & { defaultValue?: string }) =>
      (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(o?.[name] ?? '')),
    language: 'en',
  }),
}));

import { DraftChangesPanel, type DraftChangesPosture } from '../DraftChangesPanel';

// Three drafts of two types: the summary line has something to count.
const DRAFT_ROWS = [
  { type: 'object', name: 'st_ticket', packageId: 'com.x', label: 'Ticket' },
  { type: 'object', name: 'st_queue', packageId: 'com.x', label: 'Queue' },
  { type: 'page', name: 'st_home', packageId: 'com.x', label: 'Home' },
];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  if (url.includes('/_drafts')) return ok({ drafts: DRAFT_ROWS });
  if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'st_queue' }]);
  if (/\/meta\/page(\?|$)/.test(url)) return ok([]);
  if (url.includes('state=draft')) return ok({ name: 'x', label: 'Draft label' });
  return { ok: false, status: 404, json: async () => ({}) };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

function Host({ posture, open = true }: { posture?: DraftChangesPosture; open?: boolean }) {
  return (
    <DraftChangesPanel
      open={open}
      onOpenChange={() => {}}
      packageId="com.x"
      onPublish={() => {}}
      {...(posture ? { posture } : {})}
    />
  );
}

async function renderHost(posture?: DraftChangesPosture) {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  const utils = render(<Host posture={posture} />);
  // Every row classified: each badge has replaced its spinner.
  await waitFor(() => expect(screen.getAllByText(/^(New|Update)$/)).toHaveLength(DRAFT_ROWS.length));
  return utils;
}

const toggles = () => screen.getAllByTestId('draft-entry-toggle');

function expectReviewPosture() {
  for (const toggle of toggles()) expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryAllByTestId('draft-entry-detail')).toHaveLength(0);
  expect(screen.getByTestId('draft-changes-list')).toHaveFocus();
  // The footer is there — review never hides the way to publish — but unfocused.
  const publish = screen.getByTestId('draft-changes-publish');
  expect(publish).toBeInTheDocument();
  expect(publish).not.toHaveFocus();
  expect(screen.queryByTestId('draft-changes-summary')).toBeNull();
}

describe('objectui#12517 — the pending-changes sheet opens in a posture', () => {
  it('confirm: every row expanded, the summary line counted by type, focus on Publish all', async () => {
    // No frame shows a collapsed row: the expansion lands in the commit that
    // first renders the list, not in a passive effect after it is painted
    // (under load the observer below fired in that gap, and so would a paint).
    let collapsedSeen = 0;
    const observer = new MutationObserver(() => {
      collapsedSeen += document.querySelectorAll('[data-testid="draft-entry-toggle"][aria-expanded="false"]').length;
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    await renderHost('confirm');
    observer.disconnect();
    expect(collapsedSeen).toBe(0);
    expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-posture', 'confirm');
    for (const toggle of toggles()) expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getAllByTestId('draft-entry-detail')).toHaveLength(DRAFT_ROWS.length));
    expect(screen.getByTestId('draft-changes-publish')).toHaveFocus();
    // One segment per type group, counted. The stubbed `t()` cannot
    // plural-select, so the words' number is pinned against the real packs in
    // `DraftChangesPanel.summaryPlural-13147.test.tsx`, not here.
    expect(screen.getByTestId('draft-changes-summary')).toHaveTextContent(/^3 items · 2 \S+ · 1 \S+$/);
  });

  it('review: rows collapsed, focus on the list, Publish all present but not focused', async () => {
    await renderHost('review');
    expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-posture', 'review');
    expectReviewPosture();
  });

  it('CONTROL: a host that passes no posture (Home, DraftPreviewBar, CommitTimeline) gets review', async () => {
    await renderHost(undefined);
    expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-posture', 'review');
    expectReviewPosture();
  });

  it('confirm: a row the author collapses stays collapsed while the rows classify', async () => {
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<Host posture="confirm" />);
    await waitFor(() => expect(toggles()).toHaveLength(DRAFT_ROWS.length));
    await waitFor(() => expect(toggles()[0]).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.click(toggles()[0]);
    await waitFor(() => expect(screen.getAllByText(/^(New|Update)$/)).toHaveLength(DRAFT_ROWS.length));
    expect(toggles()[0]).toHaveAttribute('aria-expanded', 'false');
    expect(toggles()[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('the posture is read on each open: Publish then Changes opens collapsed the second time', async () => {
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { rerender } = render(<Host posture="confirm" />);
    await waitFor(() => expect(screen.getByTestId('draft-changes-publish')).toHaveFocus());
    for (const toggle of toggles()) expect(toggle).toHaveAttribute('aria-expanded', 'true');

    rerender(<Host posture="confirm" open={false} />);
    await waitFor(() => expect(screen.queryByTestId('draft-changes-panel')).toBeNull());
    await act(async () => {
      rerender(<Host posture="review" />);
    });
    await waitFor(() => expect(screen.getAllByText(/^(New|Update)$/)).toHaveLength(DRAFT_ROWS.length));
    expectReviewPosture();
  });
});
