/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Notification surfaces — one per spec `NotificationTypeSchema` member.
 *
 * | `displayType` | Surface | Placement |
 * |---|---|---|
 * | `toast` | the host's `onToast` delegate (sonner in the console) | overlay, host-owned |
 * | `snackbar` | {@link NotificationSnackbar} | bottom-anchored, one at a time |
 * | `banner` | {@link NotificationBanners} | in flow, top of the content area |
 * | `alert` | {@link NotificationAlerts} | blocking dialog, FIFO queue |
 * | `inline` | {@link NotificationInline} | in place, at the raising surface |
 *
 * Every one of these used to be handed to `onToast` regardless of type, so all
 * five looked identical (#3014).
 */

export { NotificationBanners, type NotificationBannersProps } from './NotificationBanners';
export { NotificationSnackbar, type NotificationSnackbarProps } from './NotificationSnackbar';
export { NotificationAlerts, type NotificationAlertsProps } from './NotificationAlerts';
export { NotificationInline, type NotificationInlineProps } from './NotificationInline';
export {
  NOTIFICATION_ACTION_BUTTON_VARIANTS,
  NOTIFICATION_POSITION_CLASSES,
  NOTIFICATION_SEVERITY_STYLES,
  notificationActionVariant,
  notificationIcon,
  notificationSeverityStyle,
  type NotificationSeverityStyle,
} from './severity';
