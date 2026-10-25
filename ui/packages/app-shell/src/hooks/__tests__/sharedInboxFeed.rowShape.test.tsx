/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5203 — the produced inbox row carries exactly what it declares.
 *
 * ## What this is the other half of
 *
 * `InboxNotification` (`layout/inboxGrouping.ts`) used to declare an
 * `actor_name` that was dead at both ends: `mergeInboxRows` below never mapped
 * it, neither consumer (`InboxPopover`, `useHomeInbox`) read it, and
 * `sys_inbox_message` then had no actor column for it to be mapped FROM. The
 * declaration was removed; `inboxGrouping.test.ts` carries the TYPE PIN that
 * stops it being re-declared.
 *
 * ## The actor that DID come back, and why that is not a reversal
 *
 * objectui#8667 adds `actor_id` to the mapped set. The objectui#5203 retirement
 * rested on "no column to map from", and for an actor ID that stopped being
 * true when `sys_inbox_message` gained the `actor_id` lookup
 * (objectstack#16974). It is still true for a NAME, so `actor_name` stays out
 * and the second case below still holds. The route is the one this suite
 * exists to enforce: one more EXPLICIT field in the producer's literal and one
 * more entry in `DECLARED_KEYS`, never a pass-through.
 *
 * A type pin alone cannot see the direction this contract is most likely to rot
 * in, because that direction does not go through the type at all: the producer
 * builds its row from an explicit field-by-field literal, and the cheap
 * "improvement" is to spread the raw `sys_inbox_message` record into it
 * (`{ ...m, is_read }`). That compiles, it is invisible to `tsc`, and it
 * silently re-admits every raw column the backend happens to grow — including
 * an `actor_name` — as an undeclared de-facto field on the UI shape. So this
 * suite feeds the producer a raw row LOADED with columns it does not map and
 * asserts the produced row's key set, not just the absence of one key.
 *
 * ## Reverse verification (direction predicted BEFORE running, measured in this PR)
 *
 *   - replace the producer's explicit literal with a `{ ...m }` pass-through ⇒
 *     both cases here go RED (extra keys present, `actor_name` among them),
 *     while the `inboxGrouping.test.ts` type pin stays GREEN — which is why the
 *     type pin cannot stand in for this one, and both are here;
 *   - re-declare `actor_name` on `InboxNotification` ⇒ this suite stays GREEN
 *     (a declaration nobody fills changes no runtime shape) and the type pin
 *     goes RED. Opposite directions, one per instrument.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/** One signed-in user — the inbox feed reads nothing without one. */
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

/**
 * A `sys_inbox_message` row as the L5 materialization writes it, PLUS the
 * columns the UI shape does not map. `severity` and `delivery_id` are real
 * columns on the object today; `actor_name` is deliberately NOT (this is the
 * hypothetical future column the retired field was an invitation to add) — the
 * point of including it is that the producer's answer must be the same either
 * way: an unmapped column does not reach the UI shape.
 *
 * `actor_id` IS a real column (objectstack#16974) and it IS mapped. Its value is
 * a concrete id distinct from the recipient's `user_id`, so the mapping
 * assertion below cannot be satisfied by copying the wrong column.
 */
const RAW_ROW = {
  id: 'ibx_1',
  user_id: 'u1',
  notification_id: 'ntf_1',
  delivery_id: 'dlv_1',
  actor_id: 'u_zhangsan',
  topic: 'collab.assignment',
  title: 'Assigned to you: Ship it',
  body_md: 'Zhang San assigned you a task.',
  severity: 'info',
  action_url: '/apps/crm/showcase_task/t_42',
  created_at: '2026-08-18T09:00:00Z',
  actor_name: 'Li Si',
};

/**
 * The same row as a server older than the `actor_id` column returns it: the key
 * is ABSENT, not null. It is the control for "an older server behaves exactly
 * as before".
 */
const LEGACY_ROW: Record<string, unknown> = { ...RAW_ROW, id: 'ibx_legacy' };
delete LEGACY_ROW.actor_id;

/** What the fake adapter answers the `sys_inbox_message` read with. */
let inboxRows: unknown[] = [RAW_ROW];

/** The keys `mergeInboxRows` maps — the whole of `InboxNotification`. */
const DECLARED_KEYS = [
  'action_url',
  'actor_id',
  'body',
  'created_at',
  'id',
  'is_read',
  'notification_id',
  'receipt_id',
  'title',
  'type',
];

const fakeAdapter = {
  find: (object: string) => {
    if (object === 'sys_inbox_message') return Promise.resolve({ data: inboxRows });
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

import { useSharedInboxFeed, __resetSharedUserFeeds, __markFirstPainted } from '../sharedUserFeeds';

/** Let the attach-time read settle without moving the clock past a poll. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  // Module-scoped stores outlive any one render tree.
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  inboxRows = [RAW_ROW];
  // Approvals degrade to 0 (404) so nothing here depends on the REST feed.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('objectui#5203 — the inbox producer maps fields, it does not pass rows through', () => {
  it('produces exactly the declared key set from a raw row carrying more', async () => {
    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();

    expect(result.current.status).toBe('ready');
    expect(result.current.value).toHaveLength(1);

    const row = result.current.value[0];
    expect(Object.keys(row).sort()).toEqual(DECLARED_KEYS);
    // The mapping itself still works — otherwise the key-set assertion above
    // could be satisfied by a producer that maps nothing.
    expect(row.title).toBe('Assigned to you: Ship it');
    expect(row.type).toBe('collab.assignment');
    expect(row.body).toBe('Zhang San assigned you a task.');
    expect(row.action_url).toBe('/apps/crm/showcase_task/t_42');
    // The actor, from ITS column: not the recipient's `user_id` ('u1').
    expect(row.actor_id).toBe('u_zhangsan');
  });

  it('produces the SAME key set from an older server\'s row that has no `actor_id`, with the actor null', async () => {
    // The control has to be real: the key is absent from the raw row.
    expect(Object.hasOwn(LEGACY_ROW, 'actor_id')).toBe(false);
    inboxRows = [LEGACY_ROW];

    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();

    expect(result.current.status).toBe('ready');
    const row = result.current.value[0];
    expect(row.id).toBe('ibx_legacy');
    expect(Object.keys(row).sort()).toEqual(DECLARED_KEYS);
    // "No known actor" — the value the arrival filter announces exactly as before.
    expect(row.actor_id).toBeNull();
  });

  it('does not carry `actor_name` even when the raw row has one', async () => {
    // The card's field by name, so a future reader grepping for it lands here
    // rather than on one of the live `actor_name` fields elsewhere in this
    // package (`sys_activity` -> `ActivityItem`, approval activity rows).
    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();

    // Via `unknown`: `InboxNotification` has no index signature, which is the
    // point — the key being probed is not addressable on the declared shape.
    const row = result.current.value[0] as unknown as Record<string, unknown>;
    expect(Object.hasOwn(row, 'actor_name')).toBe(false);
    expect(row.actor_name).toBeUndefined();
  });
});
