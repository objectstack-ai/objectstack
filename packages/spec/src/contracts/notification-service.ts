// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * INotificationService - Notification Service Contract
 * 
 * Defines the interface for sending notifications in ObjectStack.
 * Concrete implementations (Email, Push, SMS, Slack, etc.)
 * should implement this interface.
 * 
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete notification provider implementations.
 * 
 * Aligned with CoreServiceName 'notification' in core-services.zod.ts.
 */

/**
 * Supported notification delivery channels.
 *
 * [#4538] Re-exported from the zod source (`NotificationChannelSchema`,
 * system/notification.zod.ts) instead of a hand-written mirror union — the
 * member sets had stayed identical only by discipline, and one declaration
 * per name is the rule (#4446).
 *
 * ⚠️ PARTIALLY ENFORCED — the delivery channels actually registered by
 * `service-messaging` are `inbox`, `email`, and `sms` only (#3197). Messages
 * addressed to an unregistered channel are dead-lettered, not delivered.
 */
import type { NotificationChannel } from '../system/notification.zod';
export type { NotificationChannel } from '../system/notification.zod';

/**
 * A notification message to be sent
 */
export interface NotificationMessage {
    /** Notification channel to use */
    channel: NotificationChannel;
    /** Recipient identifier (email, phone, user ID, etc.) */
    to: string | string[];
    /** Notification subject/title */
    subject?: string;
    /** Notification body content */
    body: string;
    /** Template identifier (if using a pre-defined template) */
    templateId?: string;
    /** Template variable values */
    templateData?: Record<string, unknown>;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Result of sending a notification
 */
export interface NotificationResult {
    /** Whether the notification was sent successfully */
    success: boolean;
    /** Unique identifier for tracking */
    messageId?: string;
    /** Error message if sending failed */
    error?: string;
}

/**
 * Filters for {@link INotificationService.listInbox}. Mirrors
 * `ListNotificationsRequestSchema` — now EXACTLY, key for key.
 *
 * It used to mirror it "minus `cursor`": #4127 dropped the key from this
 * internal contract because no implementation paginates by cursor, while the
 * wire schema kept declaring it to callers for another nine majors. That split
 * is what #6361 closed — the wire half was removed in protocol 17 (maintainer
 * ruling 2026-08-07, Option A), so the two faces of one query finally agree and
 * this interface no longer has to explain a subtraction. The `declared ≠
 * enforced` gap this file exists to close (#4127) is closed on both faces.
 *
 * `limit` stays advisory on purpose: implementations CLAMP rather than refuse
 * (the platform inbox windows at 50 and bounds requests into 1..200), which is
 * why neither this interface nor the wire schema declares a maximum.
 */
export interface InboxQuery {
    /** Filter by read state; omitted returns both. */
    read?: boolean;
    /** Filter by notification type/topic. */
    type?: string;
    /** Maximum rows to return. Implementations may clamp. */
    limit?: number;
}

/**
 * One inbox row. Mirrors `NotificationSchema` (`api/protocol.zod.ts`) — the
 * shape the dispatcher serializes straight to the wire.
 */
export interface InboxNotification {
    /** Stable notification id — what `markRead` takes. */
    id: string;
    /** Notification type/topic. */
    type: string;
    /** Display title. */
    title: string;
    /** Body text. */
    body: string;
    /** Whether this user has read it. */
    read: boolean;
    /** URL to open when the notification is clicked. */
    actionUrl?: string;
    /** ISO-8601 creation timestamp. */
    createdAt: string;
}

/**
 * Result of {@link INotificationService.listInbox}.
 *
 * Its two members carry deliberately DIFFERENT bounds (#6363): `notifications`
 * is the requested page, `unreadCount` is the whole matching inbox.
 */
export interface InboxListResult {
    /**
     * The `limit`-bounded window — at most {@link InboxQuery.limit} rows
     * (implementations may clamp), newest first. One page of the inbox, not
     * the whole of it.
     */
    notifications: InboxNotification[];
    /**
     * Total unread across the user's whole matching inbox — NOT the window
     * above (#6363). The same quantity the wire contract publishes as
     * `ListNotificationsResponseSchema.unreadCount` ("Total number of unread
     * notifications", `api/protocol.zod.ts`).
     *
     * This is the number a bell badge shows, so it must not saturate at the
     * page size: do not re-derive it by counting `notifications`, and do not
     * clamp it to `notifications.length`. Counting over the window is exactly
     * the defect #6363 fixed — a user with 60 unread was told 50, and
     * `?limit=10` told them 10.
     *
     * {@link InboxQuery.read} does not zero it either: asking for the READ half
     * of an inbox is not a claim that nothing is unread.
     */
    unreadCount: number;
}

/** Result of {@link INotificationService.markRead} / `markAllRead`. */
export interface MarkReadResult {
    success: boolean;
    /** How many notifications this call actually transitioned to read. */
    readCount: number;
}

export interface INotificationService {
    /**
     * Send a notification
     * @param message - The notification message to send
     * @returns Result indicating success or failure
     */
    send(message: NotificationMessage): Promise<NotificationResult>;

    /**
     * Send multiple notifications in a batch
     * @param messages - Array of notification messages
     * @returns Array of results for each message
     */
    sendBatch?(messages: NotificationMessage[]): Promise<NotificationResult[]>;

    /**
     * List available notification channels
     * @returns Array of supported channel names
     */
    getChannels?(): NotificationChannel[];

    /* ------------------------------------------------------------------ */
    /*  Inbox — the READ half of the slot (#4127)                          */
    /* ------------------------------------------------------------------ */

    /**
     * List the user's in-app inbox, joined with read-state.
     *
     * [#4127] Declared here because the dispatcher's `/notifications` domain
     * has always called it — three SDK-expressed routes (`notifications.list`
     * / `.markRead` / `.markAllRead`) rest on this trio, while the contract
     * described only the send half. The consequence was not academic: the dev
     * notification stub implements `send` / `sendBatch` and nothing else
     * *because it followed this file*, so the one implementation written to
     * the contract was the one the domain had to duck-type past.
     *
     * OPTIONAL on purpose, and the runtime probe stays. An inbox needs a
     * durable store (`service-messaging` joins `sys_notification` against its
     * receipt spine); a send-only provider — SMTP, Twilio, a Slack webhook —
     * fills this slot legitimately with no inbox at all. `handlerReady` cannot
     * express that: the slot IS serveable, one capability of it is absent. So
     * the domain still asks `typeof service.listInbox === 'function'` — but
     * that is now a declared optional capability being probed, not a method
     * invented at the call site.
     *
     * Shapes mirror the wire contract the domain serializes untouched —
     * `ListNotificationsResponseSchema` / `MarkNotificationsReadResponseSchema`
     * (`api/protocol.zod.ts`).
     */
    listInbox?(userId: string, options?: InboxQuery): Promise<InboxListResult>;

    /**
     * Mark specific notifications read for this user.
     * @param userId - Owner of the inbox
     * @param ids - Notification ids to mark; unknown ids are ignored
     */
    markRead?(userId: string, ids: readonly string[]): Promise<MarkReadResult>;

    /**
     * Mark every unread notification in this user's inbox read.
     * @param userId - Owner of the inbox
     */
    markAllRead?(userId: string): Promise<MarkReadResult>;
}
