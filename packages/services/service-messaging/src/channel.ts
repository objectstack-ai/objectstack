// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `MessagingChannel` seam (ADR-0012).
 *
 * A channel does the I/O for one transport — write an inbox row, POST a
 * webhook, send an email, push to APNs/FCM. Everything *around* the I/O
 * (recipient resolution, preference checks, fan-out, and — in later
 * milestones — outbox/retry/cluster-lock) is owned by the messaging service,
 * not the channel. This is the M1-minimal shape of the full interface in
 * ADR-0012 §2: the optional `inbound`/`sessions` blocks (ADR-0013) and the
 * richer `capabilities`/`resolveAddresses` surface are deferred.
 *
 * Per ADR-0022, a concrete channel's transport (provider auth, base URL,
 * rate-limit handling) should sit on top of a `Connector`; the channel adds
 * only the messaging semantics. The always-on `inbox` channel has no external
 * transport — it writes a row in our own DB — so it needs no connector.
 */

/**
 * A platform → user notification, before fan-out to channels.
 *
 * This is the *internal* per-recipient unit the service hands to channels. The
 * public ingress is {@link EmitInput} on `MessagingService.emit`, which writes
 * the L2 `sys_notification` event first and then derives one of these per
 * resolved recipient.
 */
export interface Notification {
    /** Id of the L2 `sys_notification` event this delivery materializes. */
    readonly notificationId?: string;
    /** Tenant stamp propagated to materialization rows so RLS matches the recipient. */
    readonly organizationId?: string;
    /** Topic id, e.g. `contract.approval_requested`. Optional in M1-minimal. */
    readonly topic?: string;
    /** Short headline shown in the inbox / email subject / push title. */
    readonly title: string;
    /** Body text (Markdown for inbox/email; plain for push). */
    readonly body: string;
    /** Severity hint for rendering / filtering. */
    readonly severity?: 'info' | 'warning' | 'critical';
    /**
     * Recipients. M1-minimal resolves an explicit list of user ids only;
     * `role:*` / `owner_of:*` resolver prefixes are reserved for a later
     * milestone and currently pass through verbatim.
     */
    readonly recipients: string[];
    /** Channels to fan out to. Defaults to `['inbox']` (always on). */
    readonly channels?: string[];
    /** Optional deep-link surfaced as the inbox row's call-to-action. */
    readonly actionUrl?: string;
    /**
     * User who caused the event (mentioner, assigner) — the same semantics as
     * `sys_notification.actor_id`, projected onto the per-recipient unit so a
     * channel can materialize it without reading the L2 event back.
     *
     * Carried end to end: `EmitInput.actorId` → here → (P1) the delivery row's
     * snapshotted payload → back onto this field in the dispatcher → the
     * `sys_inbox_message.actor_id` column. Consumers use it for the standard
     * "do not notify me of my own action" rule, a purely local comparison.
     *
     * Absent on a digest delivery by construction: a collapsed group has no
     * single actor.
     */
    readonly actorId?: string;
    /** Arbitrary structured payload carried to renderers / webhook receivers. */
    readonly payload?: Record<string, unknown>;
}

/** One channel × one recipient unit of work handed to a channel's `send()`. */
export interface Delivery {
    readonly notification: Notification;
    /** The channel id this delivery targets (e.g. `inbox`). */
    readonly channel: string;
    /** The single recipient (user id / address) this delivery targets. */
    readonly recipient: string;
}

/**
 * Error classification (ADR-0012 §2). The dispatcher uses it to decide retry
 * vs. dead-letter vs. recipient invalidation. M1-minimal has no outbox, so it
 * is advisory only, but channels declare it so the seam is stable.
 */
export type ErrorClass =
    | 'retryable'
    | 'permanent'
    | 'invalid_recipient'
    | 'rate_limited'
    | 'duplicate';

/** Outcome of a single delivery attempt. */
export interface SendResult {
    /** Whether the attempt succeeded. */
    readonly ok: boolean;
    /** Provider/row id for the delivered artifact, when available. */
    readonly externalId?: string;
    /** Failure detail when `ok` is false. */
    readonly error?: string;
}

/** Minimal context handed to a channel — just a logger in M1. */
export interface MessagingChannelContext {
    readonly logger: {
        info(...args: unknown[]): void;
        warn(...args: unknown[]): void;
        error(...args: unknown[]): void;
    };
}

/** The seam a channel implements. See file header for the division of labour. */
export interface MessagingChannel {
    /** Stable id: `inbox` | `email` | `webhook` | `push` | `slack` | … */
    readonly id: string;

    /**
     * Perform a single delivery attempt. The service has already fanned out per
     * recipient; the channel only does the I/O and reports the outcome.
     */
    send(ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult>;

    /** Optional: classify a thrown error for the (future) outbox. */
    classifyError?(err: unknown): ErrorClass;
}
