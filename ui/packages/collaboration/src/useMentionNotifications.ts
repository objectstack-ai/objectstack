/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo } from 'react';
import type { MentionNotification } from '@object-ui/types';

export interface MentionNotificationsConfig {
  /** Current user ID to filter notifications for */
  currentUserId: string;
  /** Initial notifications */
  initialNotifications?: MentionNotification[];
  /** Callback when a notification should be delivered (email/push) */
  onDeliver?: (notification: MentionNotification) => void | Promise<void>;
}

export interface MentionNotificationsResult {
  /** All notifications for the current user */
  notifications: MentionNotification[];
  /** Unread notifications count */
  unreadCount: number;
  /** Add a new mention notification (triggered when @mention is detected) */
  addNotification: (notification: MentionNotification) => void;
  /** Mark a notification as read */
  markAsRead: (notificationId: string) => void;
  /** Mark all notifications as read */
  markAllAsRead: () => void;
  /** Dismiss/remove a notification */
  dismiss: (notificationId: string) => void;
  /** Clear all notifications */
  clearAll: () => void;
}

/**
 * Hook for managing @mention notifications with delivery support.
 *
 * Tracks mention notifications for the current user and provides
 * callbacks for delivery via email/push channels.
 */
export function useMentionNotifications({
  currentUserId,
  initialNotifications = [],
  onDeliver,
}: MentionNotificationsConfig): MentionNotificationsResult {
  const [notifications, setNotifications] = useState<MentionNotification[]>(
    initialNotifications.filter(n => n.recipientId === currentUserId),
  );

  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications],
  );

  const addNotification = useCallback(
    (notification: MentionNotification) => {
      if (notification.recipientId !== currentUserId) return;
      setNotifications(prev => {
        if (prev.some(n => n.id === notification.id)) return prev;
        return [notification, ...prev];
      });
      onDeliver?.(notification);
    },
    [currentUserId, onDeliver],
  );

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === notificationId ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((notificationId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    unreadCount,
    addNotification,
    markAsRead,
    markAllAsRead,
    dismiss,
    clearAll,
  };
}
