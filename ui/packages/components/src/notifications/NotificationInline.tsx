/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `displayType: 'inline'` — rendered in place by the surface that raised it.
 *
 * The whole point of `inline` is proximity: a validation summary belongs above
 * the form that failed, not in a corner of the viewport. So this component
 * floats nothing and positions nothing — it renders where you put it, and a
 * `scope` matches it to its raiser so two forms on one page don't show each
 * other's messages.
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

export interface NotificationInlineProps {
  /**
   * Routing key — renders only notifications raised with the same `scope`.
   * Omit on both ends for the page-level inline outlet.
   */
  scope?: string;
  /** Extra classes for the stack container. */
  className?: string;
}

/**
 * Renders the `inline` notifications raised for `scope`, in place.
 *
 * @example
 * ```tsx
 * // in the form that raises them
 * notify({ title: 'Fix 2 fields', severity: 'error', displayType: 'inline', scope: 'contact-form' });
 *
 * <NotificationInline scope="contact-form" className="mb-4" />
 * ```
 */
export function NotificationInline({ scope, className }: NotificationInlineProps) {
  const items = useNotificationsByPresentation('inline', scope);
  const { dismiss, config } = useNotifications();

  if (items.length === 0) return null;

  // Same `maxVisible` / `stackDirection` contract as the banner stack.
  const visible = visibleNotificationStack(items, config);

  return (
    <div
      className={cn('flex w-full flex-col gap-2', className)}
      data-notification-surface="inline"
      data-scope={scope}
    >
      {visible.map((notification) => {
        const { tone } = notificationSeverityStyle(notification.severity);
        const Icon = notificationIcon(notification);
        return (
          <div
            key={notification.id}
            role="status"
            data-severity={notification.severity}
            className={cn('flex items-start gap-3 rounded-md border px-3 py-2 text-sm', tone)}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{notification.title}</div>
              {notification.message ? (
                <div className="opacity-90">{notification.message}</div>
              ) : null}
              {notification.actions?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {notification.actions.map((action) => (
                    <Button
                      key={action.label}
                      size="sm"
                      variant={notificationActionVariant(action.variant)}
                      className="h-7"
                      onClick={action.onClick}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            {notification.dismissible === false ? null : (
              <Button
                size="icon"
                variant="ghost"
                className="-mr-1 h-6 w-6 shrink-0"
                aria-label={`Dismiss ${notification.title}`}
                onClick={() => dismiss(notification.id)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

NotificationInline.displayName = 'NotificationInline';
