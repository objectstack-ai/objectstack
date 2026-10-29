/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * openInboxNotification — the one "open a notification" action.
 *
 * A notification has more than one door: the top-bar bell's popover row and
 * the Home page's "My work → Notifications" row open the same message. They
 * used to carry two copies of the open logic, and the copies drifted: the bell
 * marked the message read before following its link, while the Home row only
 * followed the link, so a notification opened from Home stayed unread on the
 * server and kept the bell badged. Both doors now call this function, so they
 * cannot answer differently about what opening a notification does.
 *
 * Opening a notification, in order:
 *
 *  1. Spend it: `markRead(id)`. Always first, and whatever the link turns out
 *     to be — a linkless notification is still read once the user opened it.
 *  2. Resolve its `action_url` with `resolveNotificationTarget` (app-relative
 *     links are hosted under `hostAppSegment`).
 *  3. No link at all ⇒ `openInbox()` — the full inbox page, where a linkless
 *     notification can still be read in full.
 *  4. A link ⇒ `beforeFollow()` (the bell closes its popover), then an
 *     external URL opens in a new tab and a console route goes to `goTo`.
 *
 * What differs per door is passed in, never re-decided here: how the door
 * leaves the page (the bell asks first while the page holds unsaved edits),
 * what it does before following a link, and where its "open the inbox" lands.
 *
 * @module
 */
import { resolveNotificationTarget } from '../utils/appRoute.js';

/** The two fields of a notification row that opening it reads. */
export interface OpenableNotification {
  /** The inbox row id — the id the door's `markRead` is keyed by. */
  id: string;
  /** The materialization's `action_url` (ADR-0030 L5); absent ⇒ no link. */
  actionUrl?: string | null;
}

/** What one door supplies to the shared action. */
export interface NotificationDoor {
  /** Mark the row read — the inbox's own write, never a second copy of it. */
  markRead: (id: string) => void | Promise<void>;
  /** Leave for a console route (already hosted under an app). */
  goTo: (path: string) => void;
  /** The notification carries no link: open the full inbox instead. */
  openInbox: () => void;
  /** Runs once a link is about to be followed (e.g. close a popover). */
  beforeFollow?: () => void;
}

/**
 * Open one notification through `door`: mark it read, then follow its link or,
 * without one, open the inbox. See the module docblock for the order.
 */
export function openInboxNotification(
  notification: OpenableNotification,
  hostAppSegment: string,
  door: NotificationDoor,
): void {
  void door.markRead(notification.id);
  const target = resolveNotificationTarget(notification.actionUrl, hostAppSegment);
  if (!target) {
    door.openInbox();
    return;
  }
  door.beforeFollow?.();
  if (target.kind === 'external') {
    window.open(target.url, '_blank', 'noopener,noreferrer');
    return;
  }
  door.goTo(target.path);
}
