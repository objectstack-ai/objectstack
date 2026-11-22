// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * InboxBell — the bell and its side panel (notifications, approvals,
 * activity), wired onto the shared user feeds. Drawn by the phone top bar and,
 * from 768 px up, beside the app sidebar's search (objectstack#36112), where
 * the desktop draws no top bar.
 *
 * The rows, badge addends and mark-read paths come from `useInboxBell`, the
 * one wiring of `sharedUserFeeds` onto an `InboxPopover`, so every bell and the
 * `global:notifications` page block agree about a row's read state. The reads
 * are scoped to the user, not to the app in the URL.
 * @module
 */

import { useCallback, useState } from 'react';
import type { ActivityItem } from './ActivityFeed.js';
import { InboxPopover } from './InboxPopover.js';
import { useSharedActivityFeed, type ActivityFeedReading } from '../hooks/sharedUserFeeds.js';
import { useInboxBell } from '../hooks/useInboxBell.js';

export interface InboxBellProps {
  /** Activity rows a host hands over; they win over the shared feed. */
  activities?: ActivityItem[];
}

export function InboxBell({ activities }: InboxBellProps) {
  // The Activity tab's feed is read when the bell is about to open (a pointer
  // over it, focus, a click), never on every console open: no badge reads it.
  // A caller who may not read `sys_activity` is offered no Activity tab.
  const [activityWanted, setActivityWanted] = useState(false);
  const wantActivity = useCallback(() => setActivityWanted(true), []);
  const apiActivity = useSharedActivityFeed({ enabled: activityWanted && !activities });
  const {
    notifications,
    unreadCount,
    pendingApprovalsCount,
    pendingApprovals,
    refreshPendingApprovals,
    markAllRead,
    markRead,
    markManyRead,
  } = useInboxBell();
  const activity: ActivityFeedReading = activities
    ? { value: activities, status: 'ready', readable: true }
    : apiActivity;

  // `contents` keeps the wrapper out of its row's flex layout; the open
  // intent still reaches it from the bell inside.
  return (
    <span
      className="contents"
      data-testid="inbox-bell-intent"
      onPointerEnter={wantActivity}
      onFocus={wantActivity}
      onClickCapture={wantActivity}
    >
      <InboxPopover
        notifications={notifications}
        unreadCount={unreadCount}
        pendingApprovalsCount={pendingApprovalsCount}
        activity={activity}
        onMarkAllRead={markAllRead}
        onMarkRead={markRead}
        onMarkManyRead={markManyRead}
        pendingApprovals={pendingApprovals}
        onApprovalDecided={refreshPendingApprovals}
      />
    </span>
  );
}
