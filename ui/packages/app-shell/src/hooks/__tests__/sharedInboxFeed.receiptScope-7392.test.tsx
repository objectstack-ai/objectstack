/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7392 — the inbox tick asks for the receipts it can USE, not the
 * user's whole receipt history.
 *
 * ## What was measured, and what it cost
 *
 * Every inbox tick issued `sys_notification_receipt` filtered by `user_id` +
 * `channel:'inbox'` with `$top: 200` and no cursor of any kind, beside the
 * `sys_inbox_message` read's `$top: 20` — at 10 s foregrounded, 60 s hidden.
 * `mergeInboxRows` then used the receipts as a lookup table keyed by
 * `notification_id` while mapping over the MESSAGE rows, so a receipt outside
 * that window of 20 was fetched, indexed, and dropped. Two orders of magnitude
 * of payload, re-fetched in full six times a minute, to decorate at most 20
 * rows.
 *
 * ## The one way this could have gone silently wrong — and why it does not
 *
 * The receipt set feeds the bell's badge, and a receipt is not a "read" marker:
 * `delivered` is a receipt and is NOT read (`READ_STATES`). So "read only the
 * receipts of the listed messages" invites the failure of turning an unread
 * TOTAL into "unread among the newest 20" with no error and no red test.
 *
 * It does not, and the reason is upstream of this change. The badge is
 * `unreadTopics + pendingApprovalsCount` (`InboxPopover`), and `unreadTopics`
 * folds the rows this feed produces — `mergeInboxRows`' output, which is one
 * row per `sys_inbox_message` row and therefore bounded by that read's
 * `$top: 20`, never by the receipt set. Home's `unreadTopicCount` (#4329)
 * folds the same rows with the same function. The inbox addend has been
 * window-sized since #4225 gave both surfaces one feed; the receipts only ever
 * supplied read-state to rows the MESSAGE query had already chosen. Narrowing
 * them to those same rows' ids therefore changes no number — which is what the
 * `badge` case below asserts against a fixture holding 180 receipts that the
 * narrowing drops.
 *
 * ## Why the fake backend honours the filter
 *
 * A fake that ignores `$filter` answers every query with the same rows, so the
 * "after" row count would echo the fixture rather than measure the read. This
 * one applies `user_id`, `channel` and `$in` and then `$top`, so the number of
 * rows a tick delivers is a reading of the query the feed actually wrote.
 *
 * ## Reverse verification — direction predicted first, then MEASURED
 *
 * Predicted: restoring the old read (`{ user_id, channel }`, `$top: 200`,
 * unconditional) turns the payload cases RED and leaves `badge` and
 * `read-state` GREEN. Measured, with that read put back on the committed fix
 * and the tree restored afterwards by blob hash: **6 failed, 5 passed** across
 * this file and the #7249 cadence pin. The prediction was right about the
 * direction and wrong about the count, and the gap is the interesting part:
 *
 *   - `read-state` stayed GREEN — the only case in this file that did. The old
 *     read carried the same answer; it carried more rows to get there. That is
 *     the behaviour-preservation half, and it holds under BOTH reads.
 *   - `badge` went red, but NOT on the badge. Its `unreadTopics` equality — the
 *     assertion that would catch an unread total quietly becoming a window — is
 *     evaluated first and passed under the old read too. What failed after it
 *     is the row arithmetic beside it (`expected +0 to be 180`: nothing was
 *     dropped, because nothing was narrowed). ⇒ the number is invariant and the
 *     payload is not, asserted in one case, which is why the two live together.
 *   - the three payload cases and the new empty-window case in
 *     `sharedInboxFeed.cadence-7249` went red as predicted, the last of them
 *     with `expected 7 to be +0` — one receipt read per tick for a window with
 *     nothing to join.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

/** The `mine` window the message read lists — `$top: 20`, newest first. */
const WINDOW_SIZE = 20;
/** How many notifications this user has accumulated receipts for, all time. */
const HISTORY_SIZE = 200;
/** Receipt states that count as READ — the feed's `READ_STATES`, restated. */
const READ_STATES = new Set(['read', 'clicked', 'dismissed']);

const notifId = (i: number) => `ntf_${String(i).padStart(3, '0')}`;

/**
 * The newest `WINDOW_SIZE` messages. `notification_id` descends with
 * `created_at`, so the window is `ntf_001` … `ntf_020`.
 */
const WINDOW_ROWS: Array<Record<string, unknown>> = Array.from({ length: WINDOW_SIZE }, (_, i) => ({
  id: `ibx_${i + 1}`,
  user_id: 'u1',
  notification_id: notifId(i + 1),
  topic: i % 2 === 0 ? 'collab.assignment' : 'approval.request',
  title: `Message ${i + 1}`,
  created_at: `2026-09-${String(WINDOW_SIZE - i).padStart(2, '0')}T09:00:00Z`,
}));

/**
 * Every receipt this user holds on the inbox channel — one per notification,
 * as the object's `{ fields: ['notification_id', 'user_id', 'channel'], unique:
 * true }` key allows. Every third is READ; the rest are `delivered`, which is a
 * receipt that is NOT read.
 *
 * Rows for another user and for another channel sit alongside them so the two
 * equality clauses of the filter stay load-bearing: a query that dropped them
 * would over-answer, and the row counts below would say so.
 */
const RECEIPT_STORE: Array<Record<string, unknown>> = [
  ...Array.from({ length: HISTORY_SIZE }, (_, i) => ({
    id: `rcp_${i + 1}`,
    notification_id: notifId(i + 1),
    user_id: 'u1',
    channel: 'inbox',
    state: (i + 1) % 3 === 0 ? 'read' : 'delivered',
  })),
  { id: 'rcp_other_user', notification_id: notifId(1), user_id: 'u2', channel: 'inbox', state: 'read' },
  { id: 'rcp_other_chan', notification_id: notifId(2), user_id: 'u1', channel: 'email', state: 'read' },
];

/** Which window notifications the store says are read — the expected answer. */
const READ_IN_WINDOW = new Set(
  RECEIPT_STORE.filter(
    (r) =>
      r.user_id === 'u1' &&
      r.channel === 'inbox' &&
      READ_STATES.has(String(r.state)) &&
      WINDOW_ROWS.some((m) => m.notification_id === r.notification_id),
  ).map((r) => String(r.notification_id)),
);

interface ReceiptQuery {
  $filter?: Record<string, unknown>;
  $top?: number;
}

/** Every `sys_notification_receipt` read, with the rows it answered with. */
const receiptReads: Array<{ query: ReceiptQuery; rowsDelivered: number }> = [];
let inboxRows: Array<Record<string, unknown>> = WINDOW_ROWS;

/**
 * Applies the filter the way the data layer does: equality for a scalar
 * comparand, membership for `{ $in: [...] }` (`convertFiltersToAST` lowers that
 * spelling to `in`), then `$top` as a ceiling.
 */
function answerReceipts(query: ReceiptQuery): Array<Record<string, unknown>> {
  const filter = query.$filter ?? {};
  const matched = RECEIPT_STORE.filter((row) =>
    Object.entries(filter).every(([field, comparand]) => {
      const actual = row[field];
      if (comparand && typeof comparand === 'object' && '$in' in comparand) {
        const members = (comparand as { $in: unknown }).$in;
        return Array.isArray(members) && members.some((m) => m === actual);
      }
      return comparand === actual;
    }),
  );
  return typeof query.$top === 'number' ? matched.slice(0, query.$top) : matched;
}

const fakeAdapter = {
  find: (object: string, query: unknown) => {
    if (object === 'sys_inbox_message') return Promise.resolve({ data: inboxRows });
    if (object === 'sys_notification_receipt') {
      const data = answerReceipts((query ?? {}) as ReceiptQuery);
      receiptReads.push({ query: (query ?? {}) as ReceiptQuery, rowsDelivered: data.length });
      return Promise.resolve({ data });
    }
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
import { groupNotifications } from '../../layout/inboxGrouping';

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

/** Mount the feed and let its first tick complete. */
async function firstTick() {
  const view = renderHook(() => useSharedInboxFeed());
  await settle();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  receiptReads.length = 0;
  inboxRows = WINDOW_ROWS;
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  // Approvals degrade to 0 (404): the inbox is this suite's only subject.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('objectui#7392 — the receipt read is scoped to the listed messages', () => {
  it('names the window\'s notification ids as the comparand, and bounds $top by them', async () => {
    await firstTick();

    expect(receiptReads).toHaveLength(1);
    const { query } = receiptReads[0];
    expect(query.$filter).toEqual({
      user_id: 'u1',
      channel: 'inbox',
      notification_id: { $in: WINDOW_ROWS.map((m) => m.notification_id) },
    });
    // The key `(notification_id, user_id, channel)` is unique, so the ids the
    // filter names ARE the ceiling — an exact bound, not a guessed headroom.
    expect(query.$top).toBe(WINDOW_SIZE);
    expect(query.$top).not.toBe(HISTORY_SIZE);
  });

  it('delivers the window\'s receipts instead of the whole history — the card\'s closing criterion', async () => {
    await firstTick();

    // What the read this replaces asked for, measured on the same fixture: its
    // filter was `user_id` + `channel` alone, ceilinged at 200.
    const wouldHaveDelivered = answerReceipts({
      $filter: { user_id: 'u1', channel: 'inbox' },
      $top: HISTORY_SIZE,
    }).length;
    expect(wouldHaveDelivered).toBe(HISTORY_SIZE);

    // What this one delivers. The gap is the finding; the control above is
    // what stops a shrunken fixture from reading as a narrowed query.
    expect(receiptReads[0].rowsDelivered).toBe(WINDOW_SIZE);
  });

  it('keeps every read-state the old, wider read carried', async () => {
    const { result } = await firstTick();

    const rows = result.current.value;
    expect(rows).toHaveLength(WINDOW_SIZE);
    // Not "some row is read": the whole window, row by row, against the store.
    expect(rows.map((r) => `${r.notification_id}:${r.is_read}`)).toEqual(
      WINDOW_ROWS.map(
        (m) => `${m.notification_id}:${READ_IN_WINDOW.has(String(m.notification_id))}`,
      ),
    );
    // The fixture must contain both answers, or the assertion above is vacuous.
    expect(READ_IN_WINDOW.size).toBeGreaterThan(0);
    expect(READ_IN_WINDOW.size).toBeLessThan(WINDOW_SIZE);
  });

  it('leaves the badge\'s inbox addend exactly where it was', async () => {
    const { result } = await firstTick();

    // `unreadTopics` as `InboxPopover` computes it — the badge's first addend,
    // and the same fold `useHomeInbox.unreadTopicCount` applies (#4329).
    const unreadTopics = groupNotifications(result.current.value).reduce(
      (n, g) => n + (g.unreadCount > 0 ? 1 : 0),
      0,
    );
    const expectedTopics = groupNotifications(
      WINDOW_ROWS.map((m) => ({
        id: String(m.id),
        notification_id: String(m.notification_id),
        type: String(m.topic),
        title: String(m.title),
        is_read: READ_IN_WINDOW.has(String(m.notification_id)),
        created_at: String(m.created_at),
      })),
    ).reduce((n, g) => n + (g.unreadCount > 0 ? 1 : 0), 0);

    expect(unreadTopics).toBe(expectedTopics);
    // And the receipts the narrowing dropped could not have moved it: none of
    // them belongs to a message this window lists.
    const dropped = HISTORY_SIZE - receiptReads[0].rowsDelivered;
    expect(dropped).toBe(HISTORY_SIZE - WINDOW_SIZE);
    expect(
      RECEIPT_STORE.filter(
        (r) =>
          r.user_id === 'u1' &&
          r.channel === 'inbox' &&
          !WINDOW_ROWS.some((m) => m.notification_id === r.notification_id),
      ),
    ).toHaveLength(dropped);
  });

  it('asks once per notification when two messages share one notification event', async () => {
    inboxRows = [
      { id: 'ibx_a', user_id: 'u1', notification_id: notifId(1), topic: 't', title: 'A', created_at: '2026-09-20T09:00:00Z' },
      { id: 'ibx_b', user_id: 'u1', notification_id: notifId(1), topic: 't', title: 'B', created_at: '2026-09-19T09:00:00Z' },
    ];

    await firstTick();

    // The ids are a query comparand, not a count: a repeat would widen the
    // request's text for an answer the unique key already bounds at one row.
    expect(receiptReads[0].query.$filter?.notification_id).toEqual({ $in: [notifId(1)] });
    expect(receiptReads[0].query.$top).toBe(1);
  });

  it('issues no receipt read when the window lists nothing joinable', async () => {
    // Two ways to have nothing to join, both real: an empty inbox, and rows
    // that carry no `notification_id` (legacy / synthetic — never receipted,
    // therefore always unread, which `mergeInboxRows` already answers alone).
    inboxRows = [];
    await firstTick();
    expect(receiptReads).toHaveLength(0);

    __resetSharedUserFeeds();
    // objectui#12980 — these cases start past the console's first paint.
    __markFirstPainted();
    inboxRows = [
      { id: 'ibx_legacy', user_id: 'u1', topic: 'legacy', title: 'No event id', created_at: '2026-09-20T09:00:00Z' },
    ];
    const { result } = await firstTick();

    expect(receiptReads).toHaveLength(0);
    // …and the row still arrives, unread, rather than being dropped with the read.
    expect(result.current.value.map((r) => r.is_read)).toEqual([false]);
  });
});
