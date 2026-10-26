/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `displayType: 'banner'` — a persistent, page-width strip.
 *
 * Unlike the overlay surfaces, a banner is IN FLOW: it takes vertical space and
 * pushes the content down, which is what makes it read as a standing condition
 * ("you are viewing a draft", "the connection dropped") rather than as an event
 * that just happened. Placement is therefore the host's: mount this at the top
 * of the content area, inside the `NotificationProvider`.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import {
  useNotifications,
  useNotificationsByPresentation,
  visibleNotificationStack,
} from '@object-ui/react';
import { cn } from '../lib/utils';
import { Button } from '../ui/button';
import { notificationActionVariant, notificationIcon, notificationSeverityStyle } from './severity';

export interface NotificationBannersProps {
  /** Extra classes for the banner stack container. */
  className?: string;
}

/**
 * Renders every active `banner` notification as a stacked strip.
 *
 * @example
 * ```tsx
 * <main>
 *   <NotificationBanners />
 *   <Outlet />
 * </main>
 * ```
 */
export function NotificationBanners({ className }: NotificationBannersProps) {
  const banners = useNotificationsByPresentation('banner');
  const { dismiss, config } = useNotifications();

  if (banners.length === 0) return null;

  // `maxVisible` / `stackDirection` come from the provider config — the spec's
  // own knobs — instead of a cap this component invents for itself.
  const visible = visibleNotificationStack(banners, config);

  return (
    <div className={cn('flex w-full flex-col', className)} data-notification-surface="banner">
      {visible.map((notification) => {
        const { tone } = notificationSeverityStyle(notification.severity);
        const Icon = notificationIcon(notification);
        return (
          <div
            key={notification.id}
            role="status"
            data-severity={notification.severity}
            className={cn(
              'flex w-full items-center gap-3 border-b px-4 py-2.5 text-sm',
              tone,
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium">{notification.title}</span>
              {notification.message ? (
                <span className="min-w-0 opacity-90">{notification.message}</span>
              ) : null}
            </div>
            {notification.actions?.map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant={notificationActionVariant(action.variant)}
                className="h-7 shrink-0"
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
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
      })}
    </div>
  );
}

NotificationBanners.displayName = 'NotificationBanners';
