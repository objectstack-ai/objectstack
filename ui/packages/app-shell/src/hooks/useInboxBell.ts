/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useInboxBell — everything an {@link InboxPopover} needs, from the shared feeds.
 *
 * The rows, the badge number and the three mark-read paths used to live inline
 * in `AppHeader`, which was fine while the header held the only bell. It no
 * longer does: `global:notifications` is a spec `PageComponentType` member an
 * author may declare on a page (`f99932a42`), and its renderer has to reach
 * the SAME inbox — the one ADR-0012/ADR-0030 defines and `sharedUserFeeds`
 * already serves to the header and to Home's action centre.
 *
 * Copying the wiring into the renderer was the alternative, and this repo has
 * measured what that costs twice already: #4225 (two owners of one read issued
 * it twice per page) and #4316 (two derivations of read-state disagreed, so the
 * bell showed zero unread while Home listed five of the same rows as waiting).
 * One hook, two consumers — the two surfaces have no representable state in
 * which they disagree, because there is no second read and no second overlay.
 *
 * NOTHING is fetched here: `useSharedInboxFeed` / `useSharedPendingApprovalsCount`
 * own the polling, its cadence, its hidden-tab throttle and its failure backoff.
 * This hook adds only the optimistic read overlay and the mark-read writes.
 *
 * @module
 */
import { useCallback, useMemo, useState } from 'react';
import { bearerAuthHeaders } from '../utils/authToken.js';
import { useSharedInboxFeed, useSharedPendingApprovalsCount, type SharedFeedStatus } from './sharedUserFeeds.js';
import { useInboxArrivalNotifier } from './useInboxArrivalNotifier.js';
import type { InboxNotification } from '../layout/inboxGrouping.js';

/**
 * Same stable-reference rule the header used: a fresh empty Set per render
 * would re-run every memo that depends on the overlay.
 */
const EMPTY_READ_IDS: ReadonlySet<string> = new Set<string>();

export interface InboxBell {
  /** The shared inbox rows, with this surface's optimistic read flips applied. */
  notifications: InboxNotification[];
  /**
   * Whether the rows are an ANSWER (`sharedUserFeeds`' four-word dialect).
   * Surfaced because the arrival announcer may only scan a `ready` snapshot —
   * a `loading` / `error` one carries the last value, not this cycle's.
   */
  status: SharedFeedStatus;
  /** Raw unread ROW count (the popover folds it into topics itself). */
  unreadCount: number;
  /** The badge's second addend — pending approvals waiting on this user. */
  pendingApprovalsCount: number;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markManyRead: (ids: string[]) => Promise<void>;
}

export function useInboxBell(): InboxBell {
  /**
   * In-header notifications (ADR-0030), from the shared user feed (#4225).
   *
   * The rows are `sys_inbox_message` (the L5 in-app materialization, `mine`
   * scope) joined with `sys_notification_receipt` for read-state — the bell
   * does not read the re-modeled `sys_notification` L2 event (which carries no
   * recipient/read columns).
   */
  const { value: inboxMessages, status } = useSharedInboxFeed();

  /**
   * Optimistic read-state, layered over the shared rows.
   *
   * Mark-read used to mutate the header's own `notifications` state; the rows
   * are shared, so a consumer may not write to them — one surface's optimistic
   * flip must not become another's fact before the server agrees. Holding the
   * flipped ids locally keeps the click instant while the next poll (which
   * reads the persisted receipt) supersedes it.
   */
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(EMPTY_READ_IDS);
  const notifications = useMemo(
    () =>
      locallyRead.size === 0
        ? inboxMessages
        : inboxMessages.map((n) => (locallyRead.has(n.id) ? { ...n, is_read: true } : n)),
    [inboxMessages, locallyRead],
  );

  /**
   * M11.C15: pending approvals count — the topbar shortcut, and the second
   * addend of the bell badge (`unreadTopics + pendingApprovalsCount`).
   *
   * Shared with Home's To-do card (#4197): one polled request serves both, so
   * the badge and the card can no longer disagree.
   */
  const pendingApprovalsCount = useSharedPendingApprovalsCount();

  const unreadCount = notifications.reduce((n, x) => n + (x.is_read ? 0 : 1), 0);

  // Read-state lives in `sys_notification_receipt`, keyed
  // (notification_id, user_id, channel) — ADR-0030. That object is
  // engine-owned (ADR-0103: `enable.apiMethods` = get/list), so the generic
  // data API REJECTS receipt writes — a direct create/update here silently
  // failed and the next poll flipped rows back to unread. Mark-read goes
  // through the framework's dedicated REST surface instead
  // (`POST /api/v1/notifications/read[/all]`), which upserts the receipt
  // server-side keyed by the notification EVENT id. Rows without a
  // `notification_id` (legacy/synthetic) can't be keyed, so they update
  // optimistically but don't persist.
  const postMarkRead = useCallback(async (subPath: 'read' | 'read/all', ids?: string[]) => {
    const serverUrl = (import.meta.env?.VITE_SERVER_URL || '').replace(/\/$/, '');
    await fetch(`${serverUrl}/api/v1/notifications/${subPath}`, {
      method: 'POST',
      credentials: 'include',
      // Bearer too — see utils/authToken (#2548 split-origin fix).
      headers: { 'Content-Type': 'application/json', ...bearerAuthHeaders() },
      body: JSON.stringify(ids ? { ids } : {}),
    });
  }, []);

  /** Flip rows read in the local overlay — never in the shared feed's rows. */
  const markLocallyRead = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setLocallyRead((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const markRead = useCallback(async (id: string) => {
    const target = notifications.find(n => n.id === id);
    markLocallyRead([id]);
    if (!target?.notification_id) return;
    try { await postMarkRead('read', [target.notification_id]); } catch { /* best-effort */ }
  }, [notifications, markLocallyRead, postMarkRead]);

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter(n => !n.is_read);
    if (!unread.length) return;
    markLocallyRead(notifications.map(n => n.id));
    try { await postMarkRead('read/all'); } catch { /* best-effort */ }
  }, [notifications, markLocallyRead, postMarkRead]);

  // Per-group "mark all of this type read" (#2765): the inbox coalesces
  // repeats of the same (topic, title) into one expandable row, and this marks
  // every member read in a SINGLE request instead of one POST per row (a
  // scheduled-digest group can hold 20). Rows without a `notification_id`
  // (legacy/synthetic) still flip optimistically but can't be keyed server-side.
  const markManyRead = useCallback(async (ids: string[]) => {
    const idSet = new Set(ids);
    const notifIds = notifications
      .filter(n => idSet.has(n.id) && !n.is_read)
      .map(n => n.notification_id)
      .filter((v): v is string => !!v);
    markLocallyRead(ids);
    if (!notifIds.length) return;
    try { await postMarkRead('read', notifIds); } catch { /* best-effort */ }
  }, [notifications, markLocallyRead, postMarkRead]);

  /**
   * objectui#7011 — announce what newly ARRIVED (toast while the tab is
   * visible, a system notification while it is hidden).
   *
   * Mounted here rather than in `AppHeader` for the reason this hook exists at
   * all: it is the ONE wiring of the shared feed onto a bell, so the header
   * bell and the `global:notifications` page block announce by the same rules
   * and through the same `markRead`. Mounting both at once is safe — the seen
   * set that decides what is new is module-scoped, so the first scan of a
   * snapshot takes its arrivals and the second finds none.
   *
   * It is given `notifications` (the overlay applied) rather than the raw feed
   * rows so a row the user just marked read in this tab cannot be announced by
   * a poll that has not yet seen the receipt.
   */
  useInboxArrivalNotifier({ notifications, status, markRead });

  return {
    notifications,
    status,
    unreadCount,
    pendingApprovalsCount,
    markAllRead,
    markRead,
    markManyRead,
  };
}
