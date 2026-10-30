/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#27626 — the inbox and approvals feeds poll only as the fallback
 * of a push channel, and then at 60 s or slower.
 *
 * The bell polled `sys_inbox_message` every 10 s and `approvals/requests` every
 * 30 s on every console page; one measuring tab had sent more than 110 000
 * requests in a working day. The platform serves no realtime channel today
 * (discovery's `websockets` capability is off), so the fallback is what runs,
 * and the seam a host would report a channel through is pinned beside it:
 *
 *  - no channel: each feed reads at mount, then once per 60 s — never sooner;
 *  - a channel open: no poll at all, however long the page stays up, and a
 *    pushed change reads exactly the feed it names, once;
 *  - the channel closing: one read per feed at once, then the 60 s fallback;
 *  - returning to the tab while the channel is open reads nothing.
 *
 * Counted as requests both feeds actually send, under fake timers (the
 * `sharedUserFeeds.hiddenStop-12439` technique).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', email: 'u1@example.com' } }),
}));

const inboxFinds: string[] = [];
const fakeAdapter = {
  find: (object: string) => {
    if (object === 'sys_inbox_message') inboxFinds.push(object);
    return Promise.resolve({ data: [] });
  },
  getObjectSchema(this: { getClient(): any }, name: string) {
    return this.getClient()
      .meta.getItem('object', name)
      .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
  },
  getClient: () => undefined,
};
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

import {
  useSharedInboxFeed,
  useSharedPendingApprovalsCount,
  setUserFeedPushChannelOpen,
  notifyUserFeedPushed,
  __resetSharedUserFeeds,
  __markFirstPainted,
} from '../sharedUserFeeds';

/** The fallback cadence the card asks for: 60 s or slower. */
const FALLBACK_MS = 60_000;

const approvalsReads = () =>
  (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
    String(c[0]).includes('/api/v1/approvals/requests'),
  ).length;
const reads = () => ({ approvals: approvalsReads(), inbox: inboxFinds.length });

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

function mountBothFeeds() {
  return renderHook(() => {
    useSharedInboxFeed();
    useSharedPendingApprovalsCount();
  });
}

async function setChannel(open: boolean): Promise<void> {
  await act(async () => {
    setUserFeedPushChannelOpen(open);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  inboxFinds.length = 0;
  setHidden(false);
  __resetSharedUserFeeds();
  __markFirstPainted();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{"data":[],"total":0}', { status: 200 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setHidden(false);
  __resetSharedUserFeeds();
});

describe('objectstack#27626 — the bell polls only as the fallback of a push channel', () => {
  it('with no channel, each feed reads at mount and then once per 60 s, never sooner', async () => {
    mountBothFeeds();
    await settle();
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });

    await advance(FALLBACK_MS - 1);
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });

    await advance(1);
    expect(reads()).toEqual({ approvals: 2, inbox: 2 });

    await advance(9 * FALLBACK_MS);
    expect(reads()).toEqual({ approvals: 11, inbox: 11 });
  });

  it('with a channel open, nothing polls, and a pushed change reads only its own feed', async () => {
    mountBothFeeds();
    await settle();
    await setChannel(true);
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });

    await advance(10 * FALLBACK_MS);
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      notifyUserFeedPushed('inbox');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads()).toEqual({ approvals: 1, inbox: 2 });

    await act(async () => {
      notifyUserFeedPushed('approvals');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads()).toEqual({ approvals: 2, inbox: 2 });

    // A pushed read arms no poll behind it.
    await advance(10 * FALLBACK_MS);
    expect(reads()).toEqual({ approvals: 2, inbox: 2 });
  });

  it('a channel already open when the bell mounts reads once and then waits for pushes', async () => {
    await setChannel(true);
    mountBothFeeds();
    await settle();
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });

    await advance(10 * FALLBACK_MS);
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });
  });

  it('the channel closing reads each feed once at once, then resumes the 60 s fallback', async () => {
    mountBothFeeds();
    await settle();
    await setChannel(true);
    await advance(5 * FALLBACK_MS);
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });

    await setChannel(false);
    expect(reads()).toEqual({ approvals: 2, inbox: 2 });

    await advance(FALLBACK_MS - 1);
    expect(reads()).toEqual({ approvals: 2, inbox: 2 });
    await advance(1);
    expect(reads()).toEqual({ approvals: 3, inbox: 3 });
  });

  it('returning to the tab while the channel is open reads nothing', async () => {
    mountBothFeeds();
    await settle();
    await setChannel(true);

    setHidden(true);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(reads()).toEqual({ approvals: 1, inbox: 1 });
  });

  it('a pushed change for a feed nobody shows reads nothing', async () => {
    const { unmount } = mountBothFeeds();
    await settle();
    unmount();
    await act(async () => {
      notifyUserFeedPushed('inbox');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });
  });
});
