/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12439 — a tab hidden for HIDDEN_POLL_STOP_MS stops polling, and
 * coming back to it resumes with one immediate read per feed.
 *
 * A backgrounded tab used to poll approvals and the inbox every 60 s forever,
 * which kept scale-to-zero backends awake around the clock. These pins count
 * the requests both polled feeds actually send, under fake timers and a
 * `document.hidden` driver (the `sharedInboxFeed.cadence-7249` technique):
 *
 *  - under the cut-off, the hidden cadence is today's 60 s;
 *  - past it, nothing goes out, however long the tab stays hidden;
 *  - the return sends exactly one read per feed, then the foreground cadence;
 *  - a visible spell restarts the clock — "continuously hidden" is the rule;
 *  - the feeds take the answer from the shared `hiddenTabPollStop` module, not
 *    from a copy of the clock of their own.
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
  // objectui#13044 — the real MetadataProvider reads an object by name through
  // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
  getObjectSchema(this: { getClient(): any }, name: string) {
    return this.getClient()
      .meta.getItem('object', name)
      .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
  },
  getClient: () => undefined,
};
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

/**
 * The real shared clock, with one override: `forceSuspended` makes it answer
 * "suspended" whatever the tab is doing. That is how the last case proves the
 * feeds ask THIS module, rather than deciding from a clock of their own.
 */
let forceSuspended = false;
vi.mock('../hiddenTabPollStop', async (importOriginal) => {
  const real = await importOriginal<typeof import('../hiddenTabPollStop')>();
  return { ...real, isPollingSuspended: () => forceSuspended || real.isPollingSuspended() };
});

import {
  useSharedInboxFeed,
  useSharedPendingApprovalsCount,
  __resetSharedUserFeeds, __markFirstPainted,
} from '../sharedUserFeeds';
import { HIDDEN_POLL_STOP_MS } from '../hiddenTabPollStop';

/** The declared cadences, restated as the pins' units. */
const INBOX_POLL_MS = 10_000;
const APPROVALS_POLL_MS = 30_000;
const HIDDEN_POLL_MS = 60_000;

const approvalsReads = () =>
  (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
    String(c[0]).includes('/api/v1/approvals/requests'),
  ).length;
const inboxReads = () => inboxFinds.length;
const reads = () => ({ approvals: approvalsReads(), inbox: inboxReads() });

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

/** Flip the tab and fire the event the browser fires. */
async function switchTab(hidden: boolean): Promise<void> {
  setHidden(hidden);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
}

function mountBothFeeds() {
  return renderHook(() => {
    useSharedInboxFeed();
    useSharedPendingApprovalsCount();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  forceSuspended = false;
  inboxFinds.length = 0;
  setHidden(false);
  // Resets the shared hidden-tab clock too.
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{"data":[]}', { status: 200 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setHidden(false);
});

describe('objectui#12439 — a forgotten tab stops polling', () => {
  it('keeps the 60 s hidden cadence under the cut-off, then sends nothing at all', async () => {
    setHidden(true);
    mountBothFeeds();
    await settle();
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });

    // Under the cut-off: today's hidden cadence, unchanged — the mount read
    // plus one per HIDDEN_POLL_MS tick that comes due before HIDDEN_POLL_STOP_MS.
    await advance(HIDDEN_POLL_STOP_MS - 1);
    const ticksBeforeStop = Math.ceil(HIDDEN_POLL_STOP_MS / HIDDEN_POLL_MS) - 1;
    expect(reads()).toEqual({ approvals: 1 + ticksBeforeStop, inbox: 1 + ticksBeforeStop });

    // Past it: not one more request, however long the tab stays hidden.
    const atStop = reads();
    await advance(6 * HIDDEN_POLL_STOP_MS);
    expect(reads()).toEqual(atStop);
    // … and nothing is left armed to send one later.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns with exactly one immediate read per feed, then the foreground cadence', async () => {
    setHidden(true);
    mountBothFeeds();
    await settle();
    await advance(2 * HIDDEN_POLL_STOP_MS);
    const suspended = reads();

    await switchTab(false);

    expect(reads()).toEqual({ approvals: suspended.approvals + 1, inbox: suspended.inbox + 1 });

    // One minute visible: the foreground cadence of each feed, after the return
    // read — not the hidden one, and not a second loop on top.
    const window = 60_000;
    await advance(window);
    expect(reads()).toEqual({
      approvals: suspended.approvals + 1 + window / APPROVALS_POLL_MS,
      inbox: suspended.inbox + 1 + window / INBOX_POLL_MS,
    });
  });

  it('restarts the clock on each hide — a visible spell resets it', async () => {
    setHidden(true);
    mountBothFeeds();
    await settle();

    // Hidden for most of the window, a one-second look, hidden again.
    const firstHide = HIDDEN_POLL_STOP_MS - 2 * HIDDEN_POLL_MS;
    await advance(firstHide);
    await switchTab(false);
    await advance(1_000);
    await switchTab(true);
    const secondHideAt = firstHide + 1_000;

    // Where the FIRST hide's cut-off would have fallen, the feeds still poll:
    // the second hide started a fresh clock.
    await advance(HIDDEN_POLL_STOP_MS - secondHideAt + 1_000);
    const pastFirstCutoff = reads();
    await advance(3 * HIDDEN_POLL_MS);
    const later = reads();
    expect(later.approvals).toBeGreaterThan(pastFirstCutoff.approvals);
    expect(later.inbox).toBeGreaterThan(pastFirstCutoff.inbox);

    // And the second clock runs out in its turn.
    await advance(HIDDEN_POLL_STOP_MS);
    const atSecondStop = reads();
    await advance(HIDDEN_POLL_STOP_MS);
    expect(reads()).toEqual(atSecondStop);
  });

  it('asks the shared hiddenTabPollStop clock, not a copy of its own', async () => {
    // A visible tab polls at the foreground cadence — unless the shared module
    // says polling is suspended. Both feeds obeying it is the proof that they
    // read the rule from one place.
    forceSuspended = true;
    mountBothFeeds();
    await settle();
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });

    await advance(5 * APPROVALS_POLL_MS);
    expect(reads()).toEqual({ approvals: 1, inbox: 1 });
  });
});
