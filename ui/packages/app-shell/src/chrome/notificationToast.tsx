/**
 * The console's `toast` surface.
 *
 * `NotificationProvider` presents four of the five spec display types through
 * surface components (#3014); `toast` is the one it delegates, and in the
 * console that delegate is sonner. This module is that bridge — it is the
 * ONLY place a notification becomes a sonner call, so the mapping (severity →
 * variant, `duration: 0` → persistent, first action → the toast's action
 * button) lives in one testable function rather than inline in the shell.
 *
 * Non-toast display types never reach here: the provider routes them to
 * `NotificationBanners` / `NotificationSnackbar` / `NotificationAlerts` /
 * `NotificationInline` instead.
 */

import { toast } from 'sonner';
import {
  resolveNotificationPosition,
  type NotificationItem,
  type NotificationSeverityLevel,
  type ResolvedNotificationConfig,
} from '@object-ui/react';
import { isLucideIconName, LazyIcon, TOASTER_POSITIONS } from '@object-ui/components';

/**
 * Typed as `Record<NotificationSeverityLevel, …>` so a new severity in the spec
 * `NotificationSeveritySchema` fails type-check here until it has a variant,
 * rather than silently rendering as a neutral toast.
 */
const TOAST_BY_SEVERITY: Record<NotificationSeverityLevel, (message: string, data?: unknown) => unknown> = {
  info: (message, data) => toast.info(message, data as never),
  success: (message, data) => toast.success(message, data as never),
  warning: (message, data) => toast.warning(message, data as never),
  error: (message, data) => toast.error(message, data as never),
};

/**
 * Present one `displayType: 'toast'` notification through sonner.
 *
 * Duration follows the notification contract: `0` means persistent (sonner's
 * `Infinity`), and an absent duration defers to the `ConsoleToaster` default
 * rather than being invented here.
 *
 * Position follows the same rule, and it is the one that had to be settled: a
 * DECLARED position (the notification's own, else `config.defaultPosition`) is
 * passed per-toast so the contract always wins, and an UNDECLARED one omits the
 * key entirely so the sonner container keeps placing it. That container is host
 * chrome — it also serves the console's many direct `toast.*` calls, which are
 * not spec notifications — so it stays the fallback authority, never a
 * competing one.
 */
export function presentNotificationToast(
  notification: NotificationItem,
  config?: Pick<ResolvedNotificationConfig, 'defaultPosition'>,
): void {
  const show = TOAST_BY_SEVERITY[notification.severity] ?? TOAST_BY_SEVERITY.info;
  // A toast carries at most one action button — sonner has one `action` slot,
  // and a notification needing more than one belongs on a banner or an alert.
  const action = notification.actions?.[0];
  // The spec `icon` override, matching what the four surface components do.
  // Only a REAL Lucide name is passed: `LazyIcon` degrades an unknown one to a
  // `Database` glyph, whereas omitting the key leaves ConsoleToaster's severity
  // icon in place — the better fallback for a typo.
  const icon = isLucideIconName(notification.icon)
    ? <LazyIcon name={notification.icon} className="h-4 w-4" />
    : undefined;
  const declared = resolveNotificationPosition(notification, config);
  const position = declared ? TOASTER_POSITIONS[declared] : undefined;

  show(notification.title, {
    description: notification.message,
    duration: notification.duration === 0 ? Infinity : notification.duration,
    dismissible: notification.dismissible,
    ...(icon ? { icon } : {}),
    ...(position ? { position } : {}),
    ...(action ? { action: { label: action.label, onClick: action.onClick } } : {}),
  });
}
