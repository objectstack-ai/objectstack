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

/**
 * Why a channel is not available for a tenant.
 *
 * A SMALL CLOSED SET, deliberately: it is recorded on `sys_notification`, so
 * every value here is a column value an operator filters and reports on. The
 * same literals are inlined on the object's `suppressed_channels` field
 * description (`packages/platform-objects/src/audit/sys-notification.object.ts`)
 * — `packages/platform-objects` is a LOWER layer than this package and cannot
 * import from it, so the two copies are held equal by an executable assertion
 * (`channel-availability.test.ts`) rather than by a shared import.
 *
 * ⛔ Not a free-text field: a reason nobody declared is a reason nothing can
 * aggregate.
 */
export const CHANNEL_UNAVAILABLE_REASONS = ['transport_not_configured'] as const;

/** One value of {@link CHANNEL_UNAVAILABLE_REASONS}. */
export type ChannelUnavailableReason = (typeof CHANNEL_UNAVAILABLE_REASONS)[number];

/**
 * The tenant context an availability query is answered against.
 *
 * Carries the organization and nothing else: availability is a property of
 * `(tenant × channel)`, not of a recipient or a topic, which is what lets
 * fan-out ask ONCE PER CHANNEL PER EMIT instead of once per delivery.
 */
export interface ChannelAvailabilityQuery {
    /** Tenant whose configuration decides the answer; absent on single-tenant / background emits. */
    readonly organizationId?: string;
}

/** A channel's answer to {@link MessagingChannel.isAvailable}. */
export type ChannelAvailability =
    | { readonly available: true }
    | { readonly available: false; readonly reason: ChannelUnavailableReason };

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

    /**
     * Optional: can this tenant send on this channel AT ALL right now?
     *
     * Consulted by fan-out BEFORE any `sys_notification_delivery` row is
     * written. A channel that answers `{ available: false }` gets no delivery
     * rows for that emit; the suppression and its reason are recorded on the
     * `sys_notification` event instead. Without it, every such row is work the
     * pipeline is guaranteed to fail at — a delivery record that exists only to
     * dead-letter.
     *
     * OPTIONAL, and absence means AVAILABLE — today's behaviour, unchanged, for
     * every channel implementation that never heard of this member. ⛔ That
     * default is not a convenience: inverting it would silently mute every
     * channel a third party ships.
     *
     * This is a PRE-SEND fact, not a send attempt: it must not perform the
     * delivery's own I/O, and it is called once per channel per emit, never per
     * recipient. A channel whose answer is expensive is responsible for its own
     * caching — fan-out holds none, because a cache here serves a stale answer
     * across a live configuration change.
     *
     * A throw is treated as AVAILABLE (fail-open) and logged: an availability
     * probe that breaks must not become a notification outage.
     */
    isAvailable?(
        ctx: MessagingChannelContext,
        query: ChannelAvailabilityQuery,
    ): ChannelAvailability | Promise<ChannelAvailability>;
}
