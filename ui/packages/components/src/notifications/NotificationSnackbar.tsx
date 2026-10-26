/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `displayType: 'snackbar'` — a bottom-anchored transient with ONE action.
 *
 * Deliberately not a sonner variant. A snackbar is singular (a new one replaces
 * the current, it does not stack), bottom-anchored regardless of the toast
 * position config, and carries at most one action — "Undo" being the archetype.
 * Routing it through the toast stack is exactly the collapse #3014 is about: it
 * would look like a toast, so the spec's fifth member would mean nothing.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import {
  resolveNotificationPosition,
  useNotifications,
  useNotificationsByPresentation,
} from '@object-ui/react';
import { cn } from '../lib/utils';
import { Button } from '../ui/button';
import {
  NOTIFICATION_POSITION_CLASSES,
  notificationActionVariant,
  notificationIcon,
  notificationSeverityStyle,
} from './severity';

export interface NotificationSnackbarProps {
  /** Extra classes for the snackbar container. */
  className?: string;
}

/**
 * Renders the most recent `snackbar` notification, bottom-anchored by default.
 *
 * @example
 * ```tsx
 * <NotificationProvider>
 *   <App />
 *   <NotificationSnackbar />
 * </NotificationProvider>
 * ```
 */
export function NotificationSnackbar({ className }: NotificationSnackbarProps) {
  const snackbars = useNotificationsByPresentation('snackbar');
  const { dismiss, config, pauseAutoDismiss, resumeAutoDismiss } = useNotifications();

  // Newest-first — a snackbar supersedes rather than stacks.
  const notification = snackbars[0];
  if (!notification) return null;

  const { iconTone } = notificationSeverityStyle(notification.severity);
  const Icon = notificationIcon(notification);
  // The spec frames a snackbar as carrying "an optional single action"; extra
  // actions belong on a banner or an alert.
  const action = notification.actions?.[0];
  // A declared position wins; nothing declared keeps the snackbar's own bottom
  // anchor rather than being moved by a default nobody asked for.
  const position = resolveNotificationPosition(notification, config);
  const anchor = position
    ? NOTIFICATION_POSITION_CLASSES[position]
    : 'bottom-4 left-1/2 -translate-x-1/2';
  const enterFrom = position?.startsWith('top')
    ? 'motion-safe:slide-in-from-top-4'
    : 'motion-safe:slide-in-from-bottom-4';

  return (
    <div
      className={cn(
        'fixed z-50 flex w-[min(28rem,calc(100vw-2rem))]',
        anchor,
        'items-center gap-3 rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg',
        'motion-safe:animate-in motion-safe:fade-in',
        enterFrom,
        className,
      )}
      role="status"
      aria-live="polite"
      data-notification-surface="snackbar"
      data-severity={notification.severity}
      data-position={position}
      // Spec `pauseOnHover` — hold the auto-dismiss timer while the pointer is
      // on the snackbar, so its single action stays clickable.
      onPointerEnter={config.pauseOnHover ? () => pauseAutoDismiss(notification.id) : undefined}
      onPointerLeave={config.pauseOnHover ? () => resumeAutoDismiss(notification.id) : undefined}
    >
      {/* eslint-disable-next-line react-hooks/static-components -- notificationIcon returns a module-cached stable component per name, not one created during render */}
      <Icon className={cn('h-4 w-4 shrink-0', iconTone)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{notification.title}</div>
        {notification.message ? (
          <div className="truncate text-xs text-muted-foreground">{notification.message}</div>
        ) : null}
      </div>
      {action ? (
        <Button
          size="sm"
          variant={notificationActionVariant(action.variant)}
          className="h-7 shrink-0 font-semibold uppercase tracking-wide"
          onClick={() => {
            action.onClick();
            dismiss(notification.id);
          }}
        >
          {action.label}
        </Button>
      ) : null}
      {notification.dismissible === false ? null : (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          aria-label={`Dismiss ${notification.title}`}
          onClick={() => dismiss(notification.id)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

NotificationSnackbar.displayName = 'NotificationSnackbar';
