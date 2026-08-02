// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema } from './i18n.zod';

/**
 * Notification Type Schema
 * Defines the visual presentation style of the notification.
 */
import { lazySchema } from '../shared/lazy-schema';
export const NotificationTypeSchema = lazySchema(() => z.enum([
  'toast',
  'snackbar',
  'banner',
  'alert',
  'inline',
]).describe('Notification presentation style'));

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * Notification Severity Schema
 * Indicates the urgency and visual treatment of the notification.
 */
export const NotificationSeveritySchema = lazySchema(() => z.enum([
  'info',
  'success',
  'warning',
  'error',
]).describe('Notification severity level'));

export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

/**
 * Notification Position Schema
 * Screen position for rendering notifications.
 */
export const NotificationPositionSchema = lazySchema(() => z.enum([
  'top_left',
  'top_center',
  'top_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
]).describe('Screen position for notification placement'));

export type NotificationPosition = z.infer<typeof NotificationPositionSchema>;

/**
 * Notification Action Schema
 * Defines an interactive action button within a notification.
 */
export const NotificationActionSchema = lazySchema(() => z.object({
  label: I18nLabelSchema.describe('Action button label'),
  action: z.string().describe('Action identifier to execute'),
  variant: z.enum(['primary', 'secondary', 'link']).default('primary')
    .describe('Button variant style'),
}).describe('Notification action button'));

export type NotificationAction = z.infer<typeof NotificationActionSchema>;

// [#4610] `NotificationSchema` / `Notification` and `NotificationConfigSchema`
// / `NotificationConfig` were removed from this module (dual-source cleanup,
// #4535 C3). The `./ui` "notification instance" and "notification system
// config" wrappers had ZERO consumers across framework, cloud and objectui —
// only the presentation vocabulary above (type/severity/position/action) is
// consumed (objectui pins its toaster implementation against it). The bare
// name `Notification(Schema)` now belongs to `@objectstack/spec/api` alone:
// the REST inbox-row contract served by `/api/v1/notifications` (ADR-0030's
// bell reads that shape). `NotificationConfig(Schema)` left the export
// surface entirely — its `./system` twin was equally consumer-free and
// contradicted ADR-0030's accepted delivery model.
