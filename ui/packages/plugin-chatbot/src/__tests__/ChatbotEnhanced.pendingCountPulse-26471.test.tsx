/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26471 — a draft card's 发布 (N) follows a publish it did not
 * run. The chat banner (and Studio) publish the package, then fire the host's
 * live-metadata pulse; the card re-reads its package's pending count from the
 * same `fetchPendingDraftCount` its first read used, and a count of 0 draws
 * the Published badge instead of the button.
 *
 * Pinned:
 *  - 发布 (2) → pulse → the fetch now answers 0 → no 发布, Published shown;
 *  - a re-render alone fetches nothing (the count is re-read on a pulse, not
 *    per render);
 *  - unmount unsubscribes, and a later pulse fetches nothing.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';
import { detectDraftResult } from '../mapMessages';

afterEach(() => {
  cleanup();
});

const PACKAGE_ID = 'app.crm';

/** One assistant message whose single tool part drafted a field into `app.crm`. */
function draftedMessage(): ChatbotEnhancedMessage {
  const draftReview = detectDraftResult({
    status: 'drafted',
    type: 'object',
    name: 'crm_account',
    summary: 'Added field Priority',
    changedKeys: ['fields'],
    packageId: PACKAGE_ID,
  });
  if (!draftReview) throw new Error('fixture is not a drafted envelope');
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolInvocations: [{ toolCallId: 't1', toolName: 'add_field', state: 'output-available', draftReview }],
  };
}

/** The host's pulse, shaped like app-shell's `subscribeMetadataRefresh` / `emitMetadataRefresh`. */
function makePulse() {
  const listeners = new Set<() => void>();
  return {
    listeners,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: () => {
      for (const l of listeners) l();
    },
  };
}

function chat(pulse: ReturnType<typeof makePulse>, fetchPendingDraftCount: (pkg: string) => Promise<number>) {
  return (
    <ChatbotEnhanced
      messages={[draftedMessage()]}
      onSendMessage={vi.fn()}
      onPublishDrafts={vi.fn()}
      publishDraftsLabel="发布"
      publishedLabel="已发布"
      fetchPendingDraftCount={fetchPendingDraftCount}
      subscribeMetadataRefresh={pulse.subscribe}
    />
  );
}

describe('objectstack#26471 — the draft card re-reads its pending count on the metadata pulse', () => {
  it('发布 (2), then a publish elsewhere fires the pulse and the card stops offering 发布', async () => {
    const pulse = makePulse();
    let pending = 2;
    const fetchPendingDraftCount = vi.fn(async (_pkg: string) => pending);
    const { rerender } = render(chat(pulse, fetchPendingDraftCount));

    expect(await screen.findByTestId('draft-publish')).toHaveTextContent('发布 (2)');
    expect(fetchPendingDraftCount).toHaveBeenCalledTimes(1);
    expect(fetchPendingDraftCount).toHaveBeenCalledWith(PACKAGE_ID);

    // A re-render with nothing new is not a reason to read again.
    rerender(chat(pulse, fetchPendingDraftCount));
    expect(fetchPendingDraftCount).toHaveBeenCalledTimes(1);

    // The banner published the package and pulsed; the server now has 0 pending.
    pending = 0;
    await act(async () => {
      pulse.emit();
    });

    expect(fetchPendingDraftCount).toHaveBeenCalledTimes(2);
    expect(fetchPendingDraftCount).toHaveBeenLastCalledWith(PACKAGE_ID);
    expect(screen.queryByTestId('draft-publish')).not.toBeInTheDocument();
    expect(screen.getByText('已发布')).toBeInTheDocument();
  });

  it('unmount unsubscribes: a later pulse reads nothing', async () => {
    const pulse = makePulse();
    const fetchPendingDraftCount = vi.fn(async (_pkg: string) => 2);
    const { unmount } = render(chat(pulse, fetchPendingDraftCount));

    expect(await screen.findByTestId('draft-publish')).toHaveTextContent('发布 (2)');
    expect(pulse.listeners.size).toBe(1);

    unmount();
    expect(pulse.listeners.size).toBe(0);

    pulse.emit();
    expect(fetchPendingDraftCount).toHaveBeenCalledTimes(1);
  });
});
