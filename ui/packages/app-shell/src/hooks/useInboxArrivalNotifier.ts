/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useInboxArrivalNotifier — turn a new inbox row into something the user
 * actually perceives (objectui#7011).
 *
 * The inbox has been silent since it was built: `sharedUserFeeds` polls
 * `sys_inbox_message`, the rows land in the store, the bell badge counts them,
 * and a user not staring at the bell learns nothing. This hook is the whole of
 * the announcement, and it is mounted from `useInboxBell` — the one wiring of
 * the shared feed onto a bell — so every surface that shows the inbox
 * announces it, and none of them announces it twice (the seen set that decides
 * is module-scoped; see `inboxArrivals.ts`).
 *
 * ## What it deliberately is NOT
 *
 * Presentation only. Nothing here touches the transport: no cadence is changed,
 * no request is added, and no push channel (WebSocket / SSE) is opened — those
 * are framework-side platform work with their own project. The consequence is
 * accepted rather than worked around: a backgrounded tab polls at 60 s, so a
 * desktop notification can be up to about a minute late. Shaving that by
 * speeding the poll up would trade a server-wide cost for one surface's
 * latency, which is the trade the card refused.
 *
 * And the 60 s holds only for the first 10 minutes of a continuous hide
 * (`HIDDEN_POLL_STOP_MS`, `hiddenTabPollStop.ts`, objectui#12439). After that
 * the shared feed stops polling, so a message that arrives later raises NO
 * desktop notification while the tab stays hidden: nothing reads it until the
 * user comes back, when the feed refetches at once and the message arrives as
 * the ordinary in-page toast and bell badge. That cost was accepted so that a
 * forgotten tab stops keeping a scale-to-zero backend awake around the clock.
 *
 * ## The two surfaces are mutually exclusive, by the tab's visibility
 *
 * A visible tab gets the in-page toast; a hidden one gets the system
 * notification and no toast. They are not two channels a user might get both
 * of: a toast fired into a hidden tab is a toast that expires unseen, and a
 * system notification raised over a tab the user is looking at is an OS-level
 * interruption for something already on their screen.
 *
 * @module
 */

import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { presentNotificationToast } from '../chrome/notificationToast.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { resolveHostAppSegment, resolveNotificationTarget } from '../utils/appRoute.js';
import type { InboxNotification } from '../layout/inboxGrouping.js';
import type { SharedFeedStatus } from './sharedUserFeeds.js';
import { claimInboxArrivals, digestArrivals } from './inboxArrivals.js';
import { showDesktopNotification } from './desktopNotifications.js';
import { useNotificationPreferences } from './notificationPreferences.js';

export interface InboxArrivalNotifierInput {
  /** The bell's rows, newest first — the same array the popover renders. */
  notifications: InboxNotification[];
  /**
   * The feed's status. Only `ready` is scanned: `loading` and `error` snapshots
   * carry the LAST value, and priming the session memory off a stale read would
   * either announce nothing ever again or announce the whole inbox once the
   * real answer lands.
   */
  status: SharedFeedStatus;
  /** Mark one row read — the bell's own write, so there is no second overlay. */
  markRead: (id: string) => void | Promise<void>;
}

/**
 * Watch the bell's rows and announce what newly arrived.
 *
 * Returns nothing: the announcement is the effect. Mounting it twice in one
 * tree is safe (see the module header).
 */
export function useInboxArrivalNotifier({
  notifications,
  status,
  markRead,
}: InboxArrivalNotifierInput): void {
  const { t } = useObjectTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const params = useParams();
  const { currentAppName } = useNavigationContext();
  const { apps } = useMetadata();
  const preferences = useNotificationPreferences();

  const hostAppSegment = resolveHostAppSegment(apps, currentAppName ?? params.appName);

  /**
   * Everything the announcement needs but must not RE-TRIGGER on. The scan
   * effect runs on the rows and nothing else: a route change, a metadata load
   * or a preference flip must not re-enter it. (It would be harmless — a second
   * scan of a claimed snapshot finds nothing — but "harmless because the store
   * absorbs it" is a worse guarantee than not running.)
   */
  const latest = useRef({ markRead, navigate, hostAppSegment, preferences, t });
  useEffect(() => {
    latest.current = { markRead, navigate, hostAppSegment, preferences, t };
  });

  /**
   * Open one message: mark it read and go where it points.
   *
   * Same reading as the bell's own row click — `resolveNotificationTarget`, and
   * the full inbox page when a row carries no link (a real state: the producer
   * leaves `action_url` undefined when an emit has neither a `payload.url` nor
   * a `source`). Written once here and shared by the toast's action button and
   * the system notification's click, so the two cannot answer differently.
   */
  const openMessage = useCallback((row: InboxNotification) => {
    const { markRead: mark, navigate: go, hostAppSegment: segment } = latest.current;
    void mark(row.id);
    const target = resolveNotificationTarget(row.action_url, segment);
    if (!target) {
      go(`/apps/${segment}/sys_inbox_message?view=mine`);
      return;
    }
    if (target.kind === 'external') {
      window.open(target.url, '_blank', 'noopener,noreferrer');
      return;
    }
    go(target.path);
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !userId) return;

    // Claim BEFORE consulting the preferences. A user who switches toasts on
    // mid-session must not be greeted by every message that arrived while they
    // were off — those were seen by the session, they were simply not
    // announced. Claiming first also makes the first answered read prime the
    // memory even for a user who has everything switched off, so switching
    // something on later announces the NEXT message and not the inbox.
    const arrivals = claimInboxArrivals(userId, notifications);
    const digest = digestArrivals(arrivals);
    if (!digest) return;

    const { preferences: prefs, t: translate } = latest.current;

    /**
     * One announcement per cycle, worded by the inbox's own `(topic, title)`
     * collapse: one group is one thing to say and says it; several groups
     * summarize. `groups[0].items.length` carries the repeat count for a single
     * topic that fired several times in one cycle — the same coalescing the
     * bell shows as `Scheduled project digest x10`.
     */
    const single = digest.groups.length === 1;
    const group = digest.groups[0];
    const title = single
      ? group.title || group.type
      : translate('notifications.arrivalMany', {
          count: digest.count,
          defaultValue: '{{count}} new messages',
        });
    const body = single
      ? group.items.length > 1
        ? translate('notifications.arrivalRepeats', {
            count: group.items.length,
            defaultValue: '{{count}} new messages on this topic',
          })
        : (digest.target.body ?? undefined) || undefined
      : digest.target.title;

    // ⭐ Toast and desktop notification are mutually exclusive, decided here and
    // nowhere else. `visibilityState` rather than `document.hidden` because it
    // is the card's own criterion and it distinguishes `prerender` too.
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';

    if (visible) {
      if (!prefs.preferences.toast) return;
      presentNotificationToast({
        id: `inbox-arrival-${digest.target.id}`,
        title,
        ...(body ? { message: body } : {}),
        severity: 'info',
        createdAt: new Date(),
        icon: 'Bell',
        actions: [
          {
            label: translate('notifications.arrivalOpen', { defaultValue: 'View' }),
            onClick: () => openMessage(digest.target),
          },
        ],
      });
      return;
    }

    // Hidden tab. Silence unless the user opted in AND the browser granted it —
    // an un-granted browser gets exactly today's behaviour, which is the card's
    // "completely silent, as it is now" regression criterion.
    if (!prefs.preferences.desktop || prefs.desktopPermission !== 'granted') return;
    showDesktopNotification({
      title,
      ...(body ? { body } : {}),
      // Collapse on the topic, so several cycles spent away leave one tray
      // entry per topic rather than a wall of them.
      tag: `objectui-inbox-${group.type || group.key}`,
      onActivate: () => openMessage(digest.target),
    });
  }, [notifications, status, userId, openMessage]);
}
