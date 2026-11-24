/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5694 — the standing unpublished-changes line, above the composer
 * while the bound package has pending drafts, gone when the count is zero.
 *
 * objectstack#34610 — the line publishes nothing: the screen's one Publish is
 * the shell's bar. The line points to it while the main area shows the draft,
 * offers to show the draft otherwise, and shows a receipt when a publish from
 * the bar lands. Its count is the app's drafts, the draft bar's scope: its
 * package and its ADR-0146 customization pair, off the env-wide `_drafts`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { PendingDraftsBar } from '../PendingDraftsBar.js';
import { emitMetadataRefresh, emitPublishReceipt } from '../../../assistant/assistantBus.js';

let draftRows: Array<Record<string, unknown>> = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  draftRows = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(draftRows)),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

describe('PendingDraftsBar (objectui#5694, objectstack#34610)', () => {
  it('renders nothing when the package has no pending drafts, and nothing when unbound', async () => {
    const { container, rerender } = render(<PendingDraftsBar packageId="app.k9qk" idle />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/meta/_drafts',
        expect.objectContaining({ credentials: 'include' }),
      ),
    );
    expect(q(container, 'pending-drafts-bar')).toBeNull();
    rerender(<PendingDraftsBar packageId={undefined} idle />);
    expect(q(container, 'pending-drafts-bar')).toBeNull();
  });

  it("counts the app's drafts: its package and its customization pair, never another app's", async () => {
    draftRows = [
      { type: 'object', name: 'task', packageId: 'app.k9qk' },
      { type: 'view', name: 'task.all', packageId: 'app.k9qk.custom' },
      { type: 'object', name: 'note', packageId: 'app.other' },
      { type: 'flow', name: 'loose_flow', packageId: null },
    ];
    const { container } = render(<PendingDraftsBar packageId="app.k9qk" idle draftBarShown />);
    await waitFor(() => expect(q(container, 'pending-drafts-bar')).toBeTruthy());
    expect(q(container, 'pending-drafts-bar-sentence')?.textContent).toMatch(/^2 unpublished changes/);
  });

  it('bound to the pair, it counts the same app', async () => {
    draftRows = [
      { type: 'object', name: 'task', packageId: 'app.k9qk' },
      { type: 'view', name: 'task.all', packageId: 'app.k9qk.custom' },
      { type: 'object', name: 'note', packageId: 'app.other' },
    ];
    const { container } = render(<PendingDraftsBar packageId="app.k9qk.custom" idle draftBarShown />);
    await waitFor(() => expect(q(container, 'pending-drafts-bar')).toBeTruthy());
    expect(q(container, 'pending-drafts-bar-sentence')?.textContent).toMatch(/^2 unpublished changes/);
  });

  it('draws no Publish: while the main area shows the draft it points to the draft bar', async () => {
    draftRows = [
      { type: 'dashboard', name: 'task_dashboard', packageId: 'app.k9qk' },
      { type: 'object', name: 'task', packageId: 'app.k9qk' },
    ];
    const onShowDraft = vi.fn();
    const { container } = render(
      <PendingDraftsBar packageId="app.k9qk" idle draftBarShown onShowDraft={onShowDraft} />,
    );
    await waitFor(() => expect(q(container, 'pending-drafts-bar')).toBeTruthy());
    const bar = q(container, 'pending-drafts-bar') as HTMLElement;
    expect(bar.textContent).toContain('2 unpublished changes. Publish them from the draft bar at the top.');
    expect(bar.querySelector('button')).toBeNull();
  });

  it('with the main area elsewhere it offers to show the draft, which is not a publish', async () => {
    draftRows = [{ type: 'object', name: 'task', packageId: 'app.k9qk' }];
    const onShowDraft = vi.fn();
    const { container } = render(<PendingDraftsBar packageId="app.k9qk" idle onShowDraft={onShowDraft} />);
    await waitFor(() => expect(q(container, 'pending-drafts-show-draft')).toBeTruthy());
    expect(q(container, 'pending-drafts-bar')?.textContent).toContain('Show the draft to review and publish');
    fireEvent.click(q(container, 'pending-drafts-show-draft') as HTMLElement);
    expect(onShowDraft).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('publish-drafts'), expect.anything());
  });

  it("a publish from the shell's bar becomes the chat's receipt, until drafts are pending again", async () => {
    draftRows = [{ type: 'object', name: 'task', packageId: 'app.k9qk' }];
    const { container } = render(<PendingDraftsBar packageId="app.k9qk" idle draftBarShown />);
    await waitFor(() => expect(q(container, 'pending-drafts-bar')).toBeTruthy());

    // The draft bar publishes the package: the drafts go, the receipt lands.
    draftRows = [];
    act(() => {
      emitPublishReceipt({ packageId: 'app.k9qk' });
      emitMetadataRefresh();
    });
    await waitFor(() => expect(q(container, 'publish-receipt')).toBeTruthy());
    expect(q(container, 'pending-drafts-bar')).toBeNull();
    expect(q(container, 'publish-receipt')?.textContent).toContain('Published. Your changes are live.');

    // The next build drafts again: the line replaces the receipt for good.
    draftRows = [{ type: 'field', name: 'task.due', packageId: 'app.k9qk' }];
    act(() => emitMetadataRefresh());
    await waitFor(() => expect(q(container, 'pending-drafts-bar')).toBeTruthy());
    expect(q(container, 'publish-receipt')).toBeNull();
    draftRows = [];
    act(() => emitMetadataRefresh());
    await waitFor(() => expect(q(container, 'pending-drafts-bar')).toBeNull());
    expect(q(container, 'publish-receipt')).toBeNull();
  });

  it("another package's publish is not this conversation's receipt; dismissing hides it", async () => {
    const { container } = render(<PendingDraftsBar packageId="app.k9qk" idle />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => emitPublishReceipt({ packageId: 'app.other' }));
    expect(q(container, 'publish-receipt')).toBeNull();
    // The app's own publish, named by its pair, is this conversation's.
    act(() => emitPublishReceipt({ packageId: 'app.k9qk.custom' }));
    expect(q(container, 'publish-receipt')).toBeTruthy();
    fireEvent.click(q(container, 'publish-receipt-dismiss') as HTMLElement);
    expect(q(container, 'publish-receipt')).toBeNull();
    act(() => emitPublishReceipt({ packageId: null }));
    expect(q(container, 'publish-receipt')).toBeTruthy();
    fireEvent.click(q(container, 'publish-receipt-dismiss') as HTMLElement);
    expect(q(container, 'publish-receipt')).toBeNull();
  });
});
