// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/service-messaging
 *
 * Outbound notification dispatch (ADR-0012, M1 minimal slice). Ships the
 * `MessagingChannel` seam, the `MessagingService` registry + `emit()` fan-out,
 * and the always-on `inbox` channel. The baseline `notify` flow node
 * (service-automation) dispatches through `kernel.getService('messaging')`.
 *
 * Deferred to follow-up milestones: durable outbox / retry / cluster-lock /
 * dead-letter, the topic catalog + per-user preference matrix, renderers, and
 * the email / webhook / push / IM channels. The seam is shaped so those land
 * without breaking callers.
 */

// Plugin
export { MessagingServicePlugin } from './messaging-service-plugin.js';
export type { MessagingServicePluginOptions } from './messaging-service-plugin.js';

// Service + types
export { MessagingService, NOTIFICATION_EVENT_OBJECT } from './messaging-service.js';
export type {
    DeliveryOutcome,
    EmitResult,
    EmitInput,
    Audience,
    AudienceSpec,
    MessagingServiceContext,
} from './messaging-service.js';

// Recipient resolution (ADR-0030 P1)
export {
    RecipientResolver,
    USER_OBJECT,
    MEMBER_OBJECT,
    TEAM_MEMBER_OBJECT,
} from './recipient-resolver.js';
export type {
    RecipientResolverOptions,
    RecipientResolverLogger,
    ResolveContext,
} from './recipient-resolver.js';

// Channel seam
export { createInboxChannel, INBOX_OBJECT, RECEIPT_OBJECT } from './inbox-channel.js';
export type { InboxChannelOptions } from './inbox-channel.js';
export type {
    MessagingChannel,
    MessagingChannelContext,
    Notification,
    Delivery,
    SendResult,
    ErrorClass,
} from './channel.js';

// Objects (metadata definitions)
export { InboxMessage, NotificationReceipt } from './objects/index.js';
