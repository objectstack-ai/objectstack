/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #4289 — one missing-resource answer used to retire the inbox feed for the
 * whole page, and BOTH panels with it.
 *
 * ## What the card recorded, and what had moved under it
 *
 * #4289 was filed against `AppHeader`'s own poll: a `notificationsUnavailableRef`
 * that latched on one 404 and was cleared by nothing — while `useHomeInbox`,
 * reading the same object with the same filter, simply retried. One transient
 * missing-resource answer therefore reproduced the #4110 / #4230 three-way
 * signature (bell empty under both filters, Home's card correct, no requests on
 * open) from a cause nobody was looking for.
 *
 * That poll no longer exists — #4225 / PR #4327 deleted it and pointed both
 * surfaces at `sharedUserFeeds`' inbox feed. The asymmetry the card described is
 * gone, but it closed in the WRONG DIRECTION: the surviving reader is the
 * latching one. `markUnavailable()` set `unavailable = true`, and `refresh()`,
 * `schedule()` and `onVisibilityChange()` all returned early on it, so nothing
 * short of a key change (a different user or adapter) or a page reload could
 * revive the feed. A remount did not; returning to the tab did not; a later
 * successful read never happened because no later read was issued. The blast
 * radius grew rather than shrank: the bell and Home's action centre now die
 * together, and the "Home still works" contrast that made the old signature
 * diagnosable is no longer available to whoever triages the next report.
 *
 * ## Why a transient 404 is reachable — the predicate is STATUS-shaped
 *
 * `isMissingResource` is `httpStatus === 404 || status === 404 ||
 * errorCodeIs(err, 'OBJECT_NOT_FOUND')`, and its two status arms are already
 * pinned true WITHOUT any error code
 * (`sharedUserFeeds.isMissingResource.test.ts`, "is true for a plain `status`
 * 404 as well"). The ObjectStack client stamps `error.httpStatus = res.status`
 * on every non-ok response before it inspects the body at all
 * (`packages/client/src/index.ts`), so a 404 produced ANYWHERE in the transport
 * — an edge router or reverse proxy with no healthy upstream mid-deploy, a host
 * answering its catch-all for `/api/v1/data/...` before the API is mounted —
 * arrives here indistinguishable from the registry's considered
 * `404 OBJECT_NOT_FOUND`. Only the second population is the answer #4315 ruled
 * on; the first is a lost race that used to cost the session its inbox.
 *
 * ## What these pin
 *
 * A bounded recovery, and the bound. Retirement keeps its meaning — the poll
 * stops, the status stays `ready`, the affirmative empty copy stays earned —
 * but a retired feed re-probes at most `UNAVAILABLE_PROBE_LIMIT` times, no more
 * often than `UNAVAILABLE_PROBE_MS`, and any of those probes that answers with
 * rows brings the feed (and both panels) back. A deployment that genuinely has
 * no messaging pipeline pays those few reads once and is then silent for the
 * rest of the page, which is the noise argument the retirement was built on.
 *
 * Reverse verification (direction predicted BEFORE running, measured in this PR):
 *   - the recovery cases are RED on `origin/main` — the feed never re-reads, so
 *     the rows waiting behind the transient 404 are never seen;
 *   - the "identical UX" control is GREEN on `origin/main` and stays green: a
 *     permanently-missing object still answers `ready` with an empty value and
 *     never renders an error, before and after;
 *   - the "spends its budget and then stops" case is RED on `origin/main` in the
 *     OPPOSITE direction from the recovery cases — main issues FEWER reads (1)
 *     than the bound, not more. It is the noise ceiling, so it has to be able to
 *     fail upward; that it also fails downward today is what makes it evidence
 *     that the probes exist at all rather than a tautology.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/** `null` is the pre-auth session; every case here is one signed-in user. */
let userFixture: { id: string } | null = { id: 'u1' };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: userFixture }),
}));

/** Rows the inbox read answers with once it stops rejecting. */
const ROWS = [
  {
    id: 'ibx_1',
    user_id: 'u1',
    notification_id: 'ntf_1',
    topic: 'approval.reminder',
    title: 'Approval request 1 needs your decision',
    action_url: '/apps/crm/sys_approval_request/record/a_1',
    created_at: '2026-08-11T09:00:00Z',
  },
];

/**
 * A missing-resource rejection. `code` is optional on purpose: the transport
 * 404 that the card is about carries a status and no semantic code at all, and
 * the predicate accepts it either way — which is precisely why the two
 * populations cannot be told apart at this seam.
 */
function objectMissing(withCode: boolean): Promise<never> {
  const err = new Error('Object not found: sys_inbox_message') as Error & {
    httpStatus?: number;
    code?: string;
  };
  err.httpStatus = 404;
  if (withCode) err.code = 'OBJECT_NOT_FOUND';
  return Promise.reject(err);
}

/** What `find('sys_inbox_message')` does for the current case. */
let inboxBehaviour: () => Promise<unknown> = async () => ({ data: [] });
const findCalls: Array<{ object: string }> = [];
const fakeAdapter = {
  find: (object: string) => {
    findCalls.push({ object });
    if (object === 'sys_inbox_message') return inboxBehaviour();
    // Receipts and activity answer emptily — neither is this suite's subject.
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

import {
  UNAVAILABLE_PROBE_LIMIT,
  UNAVAILABLE_PROBE_MS,
  useSharedInboxFeed,
  __resetSharedUserFeeds, __markFirstPainted,
} from '../sharedUserFeeds';
import { useHomeInbox } from '../useHomeInbox';

const inboxReads = () => findCalls.filter((c) => c.object === 'sys_inbox_message').length;

/** Let the attach-time read settle without moving the clock past a probe. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
/** Move the clock, flushing the promises each timer wakes. */
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  userFixture = { id: 'u1' };
  findCalls.length = 0;
  inboxBehaviour = async () => ({ data: [] });
  // Module-scoped stores outlive any one render tree, so cases would otherwise
  // inherit each other's rows, status and retirement.
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  // Approvals degrade to 0 (404) so nothing here depends on the REST feed.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('#4289 — a transient missing-resource answer does not cost the session its inbox', () => {
  it('re-probes after retiring, and comes back when the read answers', async () => {
    // The card's scenario on the machinery that replaced it: ONE 404 during
    // bootstrap, rows available from the very next read. On `origin/main` the
    // next read never happens.
    let reads = 0;
    inboxBehaviour = () => {
      reads += 1;
      return reads === 1 ? objectMissing(true) : Promise.resolve({ data: ROWS });
    };

    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();

    // Retired: an answer, not an error — that part is unchanged and stays so.
    expect(result.current.status).toBe('ready');
    expect(result.current.value).toEqual([]);
    expect(inboxReads()).toBe(1);

    await advance(UNAVAILABLE_PROBE_MS);

    expect(inboxReads()).toBe(2);
    expect(result.current.status).toBe('ready');
    expect(result.current.value).toHaveLength(1);
    expect(result.current.value[0].title).toBe('Approval request 1 needs your decision');
  });

  it('recovers from a code-less transport 404 too, not just OBJECT_NOT_FOUND', async () => {
    // The population the reachability argument rests on. A proxy 404 has a
    // status and nothing else; the predicate takes it, so the recovery has to.
    let reads = 0;
    inboxBehaviour = () => {
      reads += 1;
      return reads === 1 ? objectMissing(false) : Promise.resolve({ data: ROWS });
    };

    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();
    expect(result.current.value).toEqual([]);

    await advance(UNAVAILABLE_PROBE_MS);

    expect(result.current.value).toHaveLength(1);
  });

  it('brings BOTH surfaces back — the bell and Home read one feed (#4225)', async () => {
    // #4289's asymmetry closed in the wrong direction when the read converged:
    // the surviving reader was the latching one, so a single lost race took the
    // bell AND the action centre, removing the "Home still works" contrast that
    // made the #4110 / #4230 signature diagnosable in the first place.
    let reads = 0;
    inboxBehaviour = () => {
      reads += 1;
      return reads === 1 ? objectMissing(true) : Promise.resolve({ data: ROWS });
    };

    const { result } = renderHook(() => ({
      bell: useSharedInboxFeed(),
      home: useHomeInbox(),
    }));
    await settle();

    expect(result.current.bell.value).toEqual([]);
    expect(result.current.home.notifications).toEqual([]);
    expect(result.current.home.unreadTopicCount).toBe(0);

    await advance(UNAVAILABLE_PROBE_MS);

    // One read served both, exactly as #4225 requires — and it revived both.
    expect(inboxReads()).toBe(2);
    expect(result.current.bell.value).toHaveLength(1);
    expect(result.current.home.notifications).toHaveLength(1);
    expect(result.current.home.unreadTopicCount).toBe(1);
  });

  it('resumes its normal cadence once revived, rather than staying on probes', async () => {
    // Recovery is not a one-shot read: a feed that answers is a live feed
    // again, polling at the bell's 10s (ADR-0030 L5) like one that never
    // failed. Pinned because "it came back once" and "it is working" are
    // different claims, and only the second one is a bell.
    let reads = 0;
    inboxBehaviour = () => {
      reads += 1;
      return reads === 1 ? objectMissing(true) : Promise.resolve({ data: ROWS });
    };

    renderHook(() => useSharedInboxFeed());
    await settle();
    await advance(UNAVAILABLE_PROBE_MS);
    const atRevival = inboxReads();

    // Half the probe cadence at the foreground poll rate is many ticks; the
    // exact number is the cadence's business, that there ARE more is this
    // case's.
    await advance(UNAVAILABLE_PROBE_MS / 2);
    expect(inboxReads()).toBeGreaterThan(atRevival + 1);
  });
});

describe('#4289 — the recovery is BOUNDED, and a genuinely absent object still reads as an answer', () => {
  /** The community build with no service-messaging: every read, forever. */
  const alwaysMissing = () => objectMissing(true);

  it('CONTROL: a permanently-missing object answers `ready`-and-empty, never an error', async () => {
    // #4315's ruling, untouched. This is the case the retirement exists for and
    // the one clause of it that may not move: a deployment without the
    // messaging pipeline has nothing waiting, so Home's affirmative empty copy
    // stays earned and no error line is ever rendered. Green before this change
    // and green after — the probes are invisible at this surface by design.
    inboxBehaviour = alwaysMissing;

    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();

    for (let i = 0; i < 8; i += 1) {
      await advance(UNAVAILABLE_PROBE_MS);
      expect(result.current.status).toBe('ready');
      expect(result.current.value).toEqual([]);
    }
    // …and the whole page's worth of reads stays inside the ceiling. This half
    // is the noise bound the retirement was built to hold.
    expect(inboxReads()).toBeLessThanOrEqual(1 + UNAVAILABLE_PROBE_LIMIT);
  });

  it('spends its probe budget and then stops for good', async () => {
    // The ceiling, asserted exactly. An hour on a community build costs the
    // first read plus the budget and not one request more — against the ~360
    // an un-retired 10s poll would have issued.
    inboxBehaviour = alwaysMissing;

    renderHook(() => useSharedInboxFeed());
    await settle();

    await advance(UNAVAILABLE_PROBE_MS * (UNAVAILABLE_PROBE_LIMIT + 4));
    expect(inboxReads()).toBe(1 + UNAVAILABLE_PROBE_LIMIT);

    await advance(60 * 60_000);
    expect(inboxReads()).toBe(1 + UNAVAILABLE_PROBE_LIMIT);
  });

  it('does not let tab-flipping burn the budget faster than the cadence', async () => {
    // `visibilitychange` is a refetch trigger the store already honours, and it
    // is user-driven — so it may re-probe, but it may not turn a user switching
    // tabs into a request storm against an object that is not there. The
    // cadence gates both paths, not just the timer.
    inboxBehaviour = alwaysMissing;

    renderHook(() => useSharedInboxFeed());
    await settle();
    expect(inboxReads()).toBe(1);

    for (let i = 0; i < 20; i += 1) {
      document.dispatchEvent(new Event('visibilitychange'));
      await advance(50);
    }

    expect(inboxReads()).toBe(1);
  });

  it('re-probes when the user returns to the tab after the cadence has elapsed', async () => {
    // The other half of the same rule: coming back to a tab that has been away
    // long enough is exactly when a bell should be current, and it is the hook
    // the store already uses for its `markFailed` branch (#4225).
    let reads = 0;
    inboxBehaviour = () => {
      reads += 1;
      return reads === 1 ? objectMissing(true) : Promise.resolve({ data: ROWS });
    };

    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();
    expect(result.current.value).toEqual([]);

    // Away long enough that a probe is due, with the tab hidden so no timer
    // beat us to it, then back.
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await advance(UNAVAILABLE_PROBE_MS + 1_000);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(result.current.value).toHaveLength(1);
  });
});
