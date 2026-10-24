/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AiPendingActionsInbox` on a deployment with no AI service (objectui#11736).
 *
 * The open edition answers `501` on `/api/v1/ai/pending-actions`. Before the
 * fix the inbox rendered the error alert and, beneath it, the "No actions
 * waiting" empty state. That reads as a live approval queue that happens to be
 * empty, on a deployment that has no queue at all. The page also re-polled the
 * dead endpoint every five seconds while it stayed open.
 *
 * These pins hold both halves, and the live control the card asks for: with a
 * working endpoint, an empty queue still shows "No actions waiting" and the
 * poll continues. The empty-state title is asserted by its English copy
 * because the card names that copy as the thing a reader sees. No
 * `I18nProvider` is mounted, so it comes from the component's defaults map
 * (see `AiPendingActionsInbox.noProviderFallback.test.tsx` for why that stays
 * in its own file).
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { AiPendingActionsInbox } from '../AiPendingActionsInbox';

const POLL = 5_000;
const EMPTY_TITLE = 'No actions waiting';
const REMEDY = 'The AI service is not available on this deployment.';

function answer(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(respond: (n: number) => Response) {
  let n = 0;
  const fetchMock = vi.fn(async () => respond(++n));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AiPendingActionsInbox: an errored read shows the error, not an empty queue (objectui#11736)', () => {
  it('on a 501 it shows the server message, no empty state, and stops polling', async () => {
    const fetchMock = stubFetch(() =>
      answer(501, { success: false, error: { code: 'NOT_IMPLEMENTED', message: REMEDY } }),
    );
    render(<AiPendingActionsInbox pollInterval={POLL} />);
    await settle();

    expect(screen.getByText(REMEDY)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(10 * POLL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(REMEDY)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('on a transient failure it shows the error, no empty state, and the empty state returns once the read answers', async () => {
    const fetchMock = stubFetch((n) =>
      n === 1 ? answer(503, { error: { message: 'Service Unavailable' } }) : answer(200, { items: [], total: 0 }),
    );
    render(<AiPendingActionsInbox pollInterval={POLL} />);
    await settle();

    expect(screen.getByText('Service Unavailable')).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();

    // Backed off: the retry comes after twice the interval, not after one.
    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(POLL);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(screen.queryByText('Service Unavailable')).toBeNull();
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy();
  });
});

describe('AiPendingActionsInbox: live control, a working endpoint (objectui#11736)', () => {
  it('an empty queue shows "No actions waiting" and the poll continues', async () => {
    const fetchMock = stubFetch(() => answer(200, { items: [], total: 0 }));
    render(<AiPendingActionsInbox pollInterval={POLL} />);
    await settle();

    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(3 * POLL);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy();
  });
});
