// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { TemplateExpressionInputSchema } from '../shared/expression.zod';

/**
 * Email Template Schema
 * 
 * Defines the structure and content of email notifications.
 * Supports variables for personalization and file attachments.
 * 
 * @example
 * ```json
 * {
 *   "id": "welcome-email",
 *   "subject": "Welcome to {{company_name}}",
 *   "body": "<h1>Welcome {{user_name}}!</h1>",
 *   "bodyType": "html",
 *   "variables": ["company_name", "user_name"],
 *   "attachments": [
 *     {
 *       "name": "guide.pdf",
 *       "url": "https://example.com/guide.pdf"
 *     }
 *   ]
 * }
 * ```
 */
import { lazySchema } from '../shared/lazy-schema';
export const EmailTemplateSchema = lazySchema(() => z.object({
  /**
   * Unique identifier for the email template
   */
  id: z.string().describe('Template identifier'),

  /**
   * Email subject line (supports variable interpolation)
   */
  subject: TemplateExpressionInputSchema.describe('Email subject — supports {{var}} interpolation'),

  /**
   * Email body content
   */
  body: TemplateExpressionInputSchema.describe('Email body content — supports {{var}} interpolation'),

  /**
   * Content type of the email body
   * @default 'html'
   */
  bodyType: z.enum(['text', 'html', 'markdown']).optional().default('html').describe('Body content type'),

  /**
   * List of template variables for dynamic content
   */
  variables: z.array(z.string()).optional().describe('Template variables'),

  /**
   * File attachments to include with the email
   */
  attachments: z.array(z.object({
    name: z.string().describe('Attachment filename'),
    url: z.string().url().describe('Attachment URL'),
  })).optional().describe('Email attachments'),
}));

/**
 * SMS Template Schema
 * 
 * Defines the structure of SMS text message notifications.
 * Includes character limits and variable support.
 * 
 * @example
 * ```json
 * {
 *   "id": "verification-sms",
 *   "message": "Your code is {{code}}",
 *   "maxLength": 160,
 *   "variables": ["code"]
 * }
 * ```
 */
export const SMSTemplateSchema = lazySchema(() => z.object({
  /**
   * Unique identifier for the SMS template
   */
  id: z.string().describe('Template identifier'),

  /**
   * SMS message content (supports variable interpolation)
   */
  message: TemplateExpressionInputSchema.describe('SMS message content — supports {{var}} interpolation'),

  /**
   * Maximum character length for the SMS
   * @default 160
   */
  maxLength: z.number().optional().default(160).describe('Maximum message length'),

  /**
   * List of template variables for dynamic content
   */
  variables: z.array(z.string()).optional().describe('Template variables'),
}));

/**
 * Push Notification Schema
 * 
 * Defines mobile and web push notification structure.
 * Supports rich notifications with actions and badges.
 * 
 * @example
 * ```json
 * {
 *   "title": "New Message",
 *   "body": "You have a new message from John",
 *   "icon": "https://example.com/icon.png",
 *   "badge": 5,
 *   "data": {"messageId": "msg_123"},
 *   "actions": [
 *     {"action": "view", "title": "View"},
 *     {"action": "dismiss", "title": "Dismiss"}
 *   ]
 * }
 * ```
 */
export const PushNotificationSchema = lazySchema(() => z.object({
  /**
   * Notification title
   */
  title: z.string().describe('Notification title'),

  /**
   * Notification body text
   */
  body: TemplateExpressionInputSchema.describe('Notification body — supports {{var}} interpolation'),

  /**
   * Icon URL to display with notification
   */
  icon: z.string().url().optional().describe('Notification icon URL'),

  /**
   * Badge count to display on app icon
   */
  badge: z.number().optional().describe('Badge count'),

  /**
   * Custom data payload
   */
  data: z.record(z.string(), z.unknown()).optional().describe('Custom data'),

  /**
   * Action buttons for the notification
   */
  actions: z.array(z.object({
    action: z.string().describe('Action identifier'),
    title: z.string().describe('Action button title'),
  })).optional().describe('Notification actions'),
}));

/**
 * In-App Notification Schema
 * 
 * Defines in-application notification banners and toasts.
 * Includes severity levels and auto-dismiss settings.
 * 
 * @example
 * ```json
 * {
 *   "title": "System Update",
 *   "message": "New features are now available",
 *   "type": "info",
 *   "actionUrl": "/updates",
 *   "dismissible": true,
 *   "expiresAt": 1704067200000
 * }
 * ```
 */
export const InAppNotificationSchema = lazySchema(() => z.object({
  /**
   * Notification title
   */
  title: z.string().describe('Notification title'),

  /**
   * Notification message content
   */
  message: TemplateExpressionInputSchema.describe('Notification message — supports {{var}} interpolation'),

  /**
   * Notification severity type
   */
  type: z.enum(['info', 'success', 'warning', 'error']).describe('Notification type'),

  /**
   * Optional URL to navigate to when clicked
   */
  actionUrl: z.string().optional().describe('Action URL'),

  /**
   * Whether the notification can be dismissed by the user
   * @default true
   */
  dismissible: z.boolean().optional().default(true).describe('User dismissible'),

  /**
   * Timestamp when notification expires (Unix milliseconds)
   */
  expiresAt: z.number().optional().describe('Expiration timestamp'),
}));

/**
 * Notification Channel Enum
 *
 * Supported notification delivery channels.
 *
 * ⚠️ PARTIALLY ENFORCED — the delivery channels actually registered by
 * `service-messaging` are `inbox`, `email`, and `sms` (#3197). `push`,
 * `slack`, `teams`, and `webhook` have no delivery implementation, and the
 * dispatcher dead-letters any message addressed to an unregistered channel.
 * Note also the naming drift: this enum says `in-app` while the implemented
 * channel registers as `inbox` (which this enum does not contain) —
 * reconcile before wiring this enum into the runtime.
 */
export const NotificationChannelSchema = lazySchema(() => z.enum([
  'email',
  'sms',
  'push',
  'in-app',
  'slack',
  'teams',
  'webhook',
]).describe('Notification delivery channel (implemented today: inbox, email, sms — push/slack/teams/webhook are not yet implemented and dead-letter; see #3197)'));

// [#4610] `NotificationConfigSchema` / `NotificationConfig` were removed from
// this module (dual-source cleanup, #4535 C3). The "unified notification
// management protocol" wrapper (channel + template + recipients + schedule +
// retryPolicy + tracking) had ZERO consumers across framework, cloud and
// objectui, was wired into no parent schema, and predates ADR-0030's accepted
// delivery architecture: the real vocabulary is `NotificationService.emit`
// (single ingress, `@objectstack/spec/contracts`), the `notify` flow node
// (`NotifyConfigSchema`, `@objectstack/spec/automation`) and the sys_*
// notification objects. Its `./ui` twin was removed in the same change; the
// bare name left the spec export surface entirely. The channel/template
// vocabulary below stays: `NotificationChannel` is re-exported by
// `@objectstack/spec/contracts` and consumed by `service-messaging`.

// Type exports
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;
export type SMSTemplate = z.infer<typeof SMSTemplateSchema>;
export type PushNotification = z.infer<typeof PushNotificationSchema>;
export type InAppNotification = z.infer<typeof InAppNotificationSchema>;
