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
 *
 * ## Later — objectstack#35410 took the receipt read off the critical path
 *
 * The id-scoped read could only start once the message read had answered,
 * which made it the page's last request layer. The tick now reads the newest
 * `WINDOW_SIZE` receipts IN PARALLEL with the newest `WINDOW_SIZE` messages
 * (the inbox channel writes each message's `delivered` receipt right after
 * the message), and keeps the id-scoped read only for listed ids that the
 * parallel read did not carry. The unique key makes that exact; the window
 * bounds the rows. The fake below therefore honours `$orderby` too.
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
 * One clock for both objects: notification `i` was delivered `i` hours before
 * the newest, and its `delivered` receipt was written with its message — the
 * inbox channel writes the receipt right after the message.
 */
const deliveredAt = (i: number) => new Date(Date.UTC(2026, 8, 30, 9) - i * 3_600_000).toISOString();

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
  created_at: deliveredAt(i + 1),
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
    created_at: deliveredAt(i + 1),
  })),
  // Newer than every u1 inbox receipt, so a read that dropped either equality
  // clause would carry them inside its window and show it in the row counts.
  { id: 'rcp_other_user', notification_id: notifId(1), user_id: 'u2', channel: 'inbox', state: 'read', created_at: deliveredAt(0) },
  { id: 'rcp_other_chan', notification_id: notifId(2), user_id: 'u1', channel: 'email', state: 'read', created_at: deliveredAt(0) },
];

/** What the fake receipt collection holds — swapped by the cases that need another history. */
let receiptStore: Array<Record<string, unknown>> = RECEIPT_STORE;

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
  $orderby?: Record<string, 'asc' | 'desc'>;
  $top?: number;
}

/** Every `sys_notification_receipt` read, with the rows it answered with. */
const receiptReads: Array<{ query: ReceiptQuery; rowsDelivered: number }> = [];
let inboxRows: Array<Record<string, unknown>> = WINDOW_ROWS;
/** How many `sys_inbox_message` reads went out. */
let messageReads = 0;
/** When set, the message read answers with this instead of `inboxRows`. */
let inboxGate: Promise<{ data: unknown[] }> | null = null;
/** Receipts unavailable: every receipt read rejects. */
let receiptsFail = false;

/**
 * Applies the filter the way the data layer does: equality for a scalar
 * comparand, membership for `{ $in: [...] }` (`convertFiltersToAST` lowers that
 * spelling to `in`), then `$orderby` on `created_at`, then `$top` as a ceiling.
 */
function answerReceipts(
  query: ReceiptQuery,
  store: Array<Record<string, unknown>> = receiptStore,
): Array<Record<string, unknown>> {
  const filter = query.$filter ?? {};
  const filtered = store.filter((row) =>
    Object.entries(filter).every(([field, comparand]) => {
      const actual = row[field];
      if (comparand && typeof comparand === 'object' && '$in' in comparand) {
        const members = (comparand as { $in: unknown }).$in;
        return Array.isArray(members) && members.some((m) => m === actual);
      }
      return comparand === actual;
    }),
  );
  const direction = query.$orderby?.created_at;
  const matched = direction
    ? [...filtered].sort((a, b) => {
        const order = String(a.created_at).localeCompare(String(b.created_at));
        return direction === 'desc' ? -order : order;
      })
    : filtered;
  return typeof query.$top === 'number' ? matched.slice(0, query.$top) : matched;
}

/** How many rows every receipt read of the tick delivered, together. */
const rowsDelivered = () => receiptReads.reduce((n, r) => n + r.rowsDelivered, 0);

const fakeAdapter = {
  find: (object: string, query: unknown) => {
    if (object === 'sys_inbox_message') {
      messageReads += 1;
      return inboxGate ?? Promise.resolve({ data: inboxRows });
    }
    if (object === 'sys_notification_receipt') {
      if (receiptsFail) {
        receiptReads.push({ query: (query ?? {}) as ReceiptQuery, rowsDelivered: 0 });
        return Promise.reject(Object.assign(new Error('boom'), { httpStatus: 500 }));
      }
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

import {
  useSharedInboxFeed,
  __resetSharedUserFeeds,
  __markFirstPainted,
  UNAVAILABLE_PROBE_LIMIT,
} from '../sharedUserFeeds';
import { groupNotifications, type InboxNotification } from '../../layout/inboxGrouping';

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
/** One foreground poll tick (`INBOX_POLL_MS`, restated). */
const nextTick = () => act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

/** `unreadTopics` as `InboxPopover` computes it — the badge's inbox addend (#4329 folds the same). */
const unreadTopicsOf = (rows: InboxNotification[]) =>
  groupNotifications(rows).reduce((n, g) => n + (g.unreadCount > 0 ? 1 : 0), 0);

/** The same fold over the message rows, read-state taken from `read`. */
const expectedUnreadTopics = (rows: Array<Record<string, unknown>>, read: ReadonlySet<string>) =>
  unreadTopicsOf(
    rows.map((m) => ({
      id: String(m.id),
      notification_id: String(m.notification_id),
      type: String(m.topic),
      title: String(m.title),
      is_read: read.has(String(m.notification_id)),
      created_at: String(m.created_at),
    })),
  );

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
  receiptStore = RECEIPT_STORE;
  messageReads = 0;
  inboxGate = null;
  receiptsFail = false;
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
  it('reads the receipt window beside the message window, and asks for nothing else when it carries every listed id', async () => {
    await firstTick();

    // One read: the window carried every listed id, so no id-scoped follow-up.
    expect(receiptReads).toHaveLength(1);
    const { query } = receiptReads[0];
    expect(query.$filter).toEqual({ user_id: 'u1', channel: 'inbox' });
    expect(query.$orderby).toEqual({ created_at: 'desc' });
    // The window's size, the message read's own `$top` — not the history.
    expect(query.$top).toBe(WINDOW_SIZE);
    expect(query.$top).not.toBe(HISTORY_SIZE);
  });

  it('delivers the window\'s receipts instead of the whole history — the card\'s closing criterion', async () => {
    await firstTick();

    // What the read objectui#7392 replaced asked for, measured on the same
    // fixture: its filter was `user_id` + `channel` alone, ceilinged at 200.
    const wouldHaveDelivered = answerReceipts({
      $filter: { user_id: 'u1', channel: 'inbox' },
      $top: HISTORY_SIZE,
    }).length;
    expect(wouldHaveDelivered).toBe(HISTORY_SIZE);

    // What this tick delivers, across every receipt read it sent. The control
    // above is what stops a shrunken fixture from reading as a narrowed query.
    expect(rowsDelivered()).toBe(WINDOW_SIZE);
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

    expect(unreadTopicsOf(result.current.value)).toBe(expectedUnreadTopics(WINDOW_ROWS, READ_IN_WINDOW));
    // And the receipts the narrowing dropped could not have moved it: none of
    // them belongs to a message this window lists.
    const dropped = HISTORY_SIZE - rowsDelivered();
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
    // Both rows carry a notification whose receipt is far older than the
    // receipt window, so only the id-scoped follow-up can answer it.
    inboxRows = [
      { id: 'ibx_a', user_id: 'u1', notification_id: notifId(150), topic: 't', title: 'A', created_at: deliveredAt(150) },
      { id: 'ibx_b', user_id: 'u1', notification_id: notifId(150), topic: 't', title: 'B', created_at: deliveredAt(151) },
    ];

    await firstTick();

    expect(receiptReads).toHaveLength(2);
    // The ids are a query comparand, not a count: a repeat would widen the
    // request's text for an answer the unique key already bounds at one row.
    expect(receiptReads[1].query.$filter?.notification_id).toEqual({ $in: [notifId(150)] });
    expect(receiptReads[1].query.$top).toBe(1);
  });

  it('stops reading receipts once the window lists nothing joinable', async () => {
    // Two ways to have nothing to join, both real: an empty inbox, and rows
    // that carry no `notification_id` (legacy / synthetic — never receipted,
    // therefore always unread, which `mergeInboxRows` already answers alone).
    inboxRows = [];
    await firstTick();
    // The page load cannot know the window is empty before it answers: the
    // parallel read goes out once, beside the message read …
    expect(receiptReads).toHaveLength(1);
    await nextTick();
    // … and once a window has answered empty, the next tick asks for none.
    expect(messageReads).toBe(2);
    expect(receiptReads).toHaveLength(1);

    inboxRows = [
      { id: 'ibx_legacy', user_id: 'u1', topic: 'legacy', title: 'No event id', created_at: deliveredAt(0) },
    ];
    // Long enough for the next tick whatever the idle backoff has grown to.
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(messageReads).toBeGreaterThan(2);
    expect(receiptReads).toHaveLength(1);

    // A window that lists something joinable again brings the read back.
    inboxRows = WINDOW_ROWS;
    const before = messageReads;
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(messageReads).toBeGreaterThan(before);
    expect(receiptReads.length).toBeGreaterThan(1);
  });

  it('keeps an unjoinable row, unread, rather than dropping it with the read', async () => {
    inboxRows = [
      { id: 'ibx_legacy', user_id: 'u1', topic: 'legacy', title: 'No event id', created_at: deliveredAt(0) },
    ];
    const { result } = await firstTick();

    // The parallel window read went out (nothing was known yet); no id-scoped
    // follow-up did, because the row names no id to ask for.
    expect(receiptReads).toHaveLength(1);
    expect(result.current.value.map((r) => r.is_read)).toEqual([false]);
  });
});

describe('objectstack#35410 — the receipt read no longer waits on the message read', () => {
  it('starts the receipt read before the message read has answered', async () => {
    let answerMessages: (value: { data: unknown[] }) => void = () => {};
    inboxGate = new Promise((resolve) => {
      answerMessages = resolve;
    });

    const { result } = renderHook(() => useSharedInboxFeed());
    await settle();

    // The message read is still pending, and the receipt read is already out:
    // the two share one request layer.
    expect(messageReads).toBe(1);
    expect(receiptReads).toHaveLength(1);
    expect(result.current.status).toBe('loading');

    answerMessages({ data: WINDOW_ROWS });
    await settle();

    expect(result.current.status).toBe('ready');
    expect(receiptReads).toHaveLength(1);
    expect(result.current.value.map((r) => `${r.notification_id}:${r.is_read}`)).toEqual(
      WINDOW_ROWS.map(
        (m) => `${m.notification_id}:${READ_IN_WINDOW.has(String(m.notification_id))}`,
      ),
    );
  });

  it('asks by id only for the listed messages the receipt window missed, and gets their read-state right', async () => {
    // The oldest listed message carries a notification whose receipt is older
    // than the receipt window — as a receipt written after its delivery, or a
    // newer receipt with no listed message, would leave it.
    const window = WINDOW_ROWS.map((m, i) =>
      i === WINDOW_SIZE - 1 ? { ...m, notification_id: notifId(150) } : m,
    );
    inboxRows = window;
    const readInWindow = new Set(
      window
        .map((m) => String(m.notification_id))
        .filter((nid) => RECEIPT_STORE.some((r) => r.user_id === 'u1' && r.channel === 'inbox' && r.notification_id === nid && READ_STATES.has(String(r.state)))),
    );
    // The fixture must hold the follow-up's answer as READ, or the pin is vacuous.
    expect(readInWindow.has(notifId(150))).toBe(true);

    const { result } = await firstTick();

    expect(receiptReads).toHaveLength(2);
    expect(receiptReads[1].query.$filter).toEqual({
      user_id: 'u1',
      channel: 'inbox',
      notification_id: { $in: [notifId(150)] },
    });
    expect(receiptReads[1].query.$top).toBe(1);
    // Bounded by the window plus the ids it missed — never the history.
    expect(rowsDelivered()).toBe(WINDOW_SIZE + 1);
    expect(result.current.value.map((r) => `${r.notification_id}:${r.is_read}`)).toEqual(
      window.map((m) => `${m.notification_id}:${readInWindow.has(String(m.notification_id))}`),
    );
    expect(unreadTopicsOf(result.current.value)).toBe(expectedUnreadTopics(window, readInWindow));
  });

  it('counts every listed message unread when the user holds no receipts at all', async () => {
    receiptStore = [];

    const { result } = await firstTick();

    expect(result.current.value).toHaveLength(WINDOW_SIZE);
    expect(result.current.value.every((r) => r.is_read === false && r.receipt_id === null)).toBe(true);
    expect(unreadTopicsOf(result.current.value)).toBe(expectedUnreadTopics(WINDOW_ROWS, new Set()));
    expect(rowsDelivered()).toBe(0);
  });

  it('lets a read, clicked or dismissed receipt win over a delivered one, in either order', async () => {
    for (const state of ['read', 'clicked', 'dismissed']) {
      for (const advancedFirst of [false, true]) {
        __resetSharedUserFeeds();
        __markFirstPainted();
        receiptReads.length = 0;
        inboxRows = [WINDOW_ROWS[0]];
        const nid = notifId(1);
        const delivered = { id: 'rcp_delivered', notification_id: nid, user_id: 'u1', channel: 'inbox', state: 'delivered', created_at: deliveredAt(1) };
        const advanced = { id: 'rcp_advanced', notification_id: nid, user_id: 'u1', channel: 'inbox', state, created_at: deliveredAt(1) };
        receiptStore = advancedFirst ? [advanced, delivered] : [delivered, advanced];

        const { result, unmount } = await firstTick();

        expect(result.current.value.map((r) => [r.is_read, r.receipt_id])).toEqual([[true, 'rcp_advanced']]);
        expect(unreadTopicsOf(result.current.value)).toBe(0);
        unmount();
      }
    }
  });

  it('still renders every listed message, unread, when receipts are unavailable — and sends no follow-up', async () => {
    receiptsFail = true;

    const { result } = await firstTick();

    expect(result.current.status).toBe('ready');
    expect(result.current.value).toHaveLength(WINDOW_SIZE);
    expect(result.current.value.every((r) => r.is_read === false)).toBe(true);
    expect(receiptReads).toHaveLength(1);
  });

  it('still retires the poll when the inbox object is missing, whatever the receipt read answers', async () => {
    inboxGate = Promise.reject(Object.assign(new Error('Object not found'), { code: 'OBJECT_NOT_FOUND', httpStatus: 404 }));
    inboxGate.catch(() => {});

    const { result } = await firstTick();

    expect(result.current.status).toBe('ready');
    expect(result.current.value).toEqual([]);
    expect(receiptReads).toHaveLength(1);
    // Half an hour of cadence later the feed has spent its bounded probes
    // (#4289) and stopped, the parallel receipt read notwithstanding.
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    expect(messageReads).toBe(1 + UNAVAILABLE_PROBE_LIMIT);
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    expect(messageReads).toBe(1 + UNAVAILABLE_PROBE_LIMIT);
    expect(result.current.value).toEqual([]);
  });
});
