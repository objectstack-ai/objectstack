// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IRealtimeService - Realtime / PubSub Service Contract
 *
 * Defines the interface for realtime event subscription and publishing
 * in ObjectStack. Concrete implementations (WebSocket, SSE, Socket.IO, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete realtime transport implementations.
 *
 * Aligned with CoreServiceName 'realtime' in core-services.zod.ts.
 */

/**
 * A realtime event payload
 */
export interface RealtimeEventPayload {
    /** Event type (e.g. 'record.created', 'record.updated') */
    type: string;
    /** Object name the event relates to */
    object?: string;
    /** Event data */
    payload: Record<string, unknown>;
    /** Timestamp (ISO 8601) */
    timestamp: string;
}

/**
 * Handler function for realtime event subscriptions
 */
export type RealtimeEventHandler = (event: RealtimeEventPayload) => void | Promise<void>;

/**
 * Subscription options for filtering events
 */
export interface RealtimeSubscriptionOptions {
    /** Object name to filter events for */
    object?: string;
    /** Event types to listen for */
    eventTypes?: string[];
    /**
     * Additional filter conditions.
     *
     * ⚠️ EXPERIMENTAL — declared but NOT evaluated by the in-memory adapter
     * (`matchesSubscription` reads only `object` + `eventTypes`). Do not rely
     * on it to narrow delivery, and NEVER as an authorization mechanism
     * (see the identity-admission note on {@link IRealtimeService}).
     */
    filter?: Record<string, unknown>;
}

/**
 * Enhanced subscription filter for metadata and data events
 */
export interface RealtimeSubscriptionFilter {
    /** Metadata type filter (object, view, agent, tool, etc.) */
    type?: string;
    /** Package ID filter */
    packageId?: string;
    /** Event types to listen for */
    eventTypes?: string[];
    /** Record ID filter (for data events) */
    recordId?: string;
    /** Field names filter (for data events) */
    fields?: string[];
}

/**
 * ⚠️ Identity admission — READ BEFORE WIRING A CLIENT TRANSPORT (#2992,
 * ADR-0096 D4).
 *
 * This contract currently serves TRUSTED, SERVER-INTERNAL subscribers only
 * (webhook auto-enqueuer, knowledge sync). Delivery is a pure fan-out with
 * **no per-recipient authorization seam**: subscriptions carry no principal,
 * `matchesSubscription` filters only by object name + event type, and the
 * engine publishes the FULL record body (`after` row) — rows and fields a
 * subscriber's own `find` would hide under RLS/FLS/tenant scoping.
 *
 * Before ANY end-user transport ships (`handleUpgrade` WebSocket, SSE, a REST
 * subscribe route, or a real client in `@objectstack/client`), the delivery
 * path MUST gain one of:
 *   1. a per-recipient re-check on delivery — the subscription carries the
 *      subscriber's `ExecutionContext` and every event is re-authorized
 *      (RLS/FLS/tenant) against it before the handler fires; or
 *   2. id-only payloads — the client re-fetches the record under its own
 *      authority.
 *
 * Wiring a transport without this is a fall-open (full-authority broadcast,
 * cross-tenant). The authz conformance matrix pins this posture
 * (`realtime-delivery-authz` row + transport tripwire probes in
 * `dogfood/test/authz-conformance.test.ts`) so CI blocks it, not review.
 */
export interface IRealtimeService {
    /**
     * Publish an event to all subscribers
     * @param event - The event to publish
     */
    publish(event: RealtimeEventPayload): Promise<void>;

    /**
     * Subscribe to realtime events
     * @param channel - Channel/topic name
     * @param handler - Event handler function
     * @param options - Optional subscription filters
     * @returns Subscription identifier for unsubscribing
     */
    subscribe(channel: string, handler: RealtimeEventHandler, options?: RealtimeSubscriptionOptions): Promise<string>;

    /**
     * Unsubscribe from a channel
     * @param subscriptionId - Subscription identifier returned by subscribe()
     */
    unsubscribe(subscriptionId: string): Promise<void>;

    /**
     * Handle an incoming HTTP upgrade request (WebSocket handshake)
     *
     * ⚠️ Deliberately UNIMPLEMENTED platform-wide: implementing this hands
     * external clients the unauthorized fan-out described on the interface —
     * satisfy the identity-admission requirement above first (#2992).
     *
     * @param request - Standard Request object
     * @returns Standard Response object
     */
    handleUpgrade?(request: Request): Promise<Response>;

    /**
     * The path clients connect to for this service's **mounted** channel, or
     * `undefined`/absent when nothing is mounted.
     *
     * [#14646] This is the producer half of the one definition of a
     * subscribable channel (`isSubscribableChannel`, `@objectstack/spec/api`):
     * discovery advertises `services.realtime` — `route`, `handlerReady`,
     * `enabled` — and `capabilities.websockets` from this one answer, because
     * no open-core producer mounts a realtime transport and therefore neither
     * discovery builder can supply the route out of its own route table. Only
     * an implementation that really serves a transport knows where a host put
     * it.
     *
     * Deliberately about the *channel*, not about a handshake: SSE mounts a
     * plain GET and never upgrades, so gating on {@link handleUpgrade} would
     * have refused a legitimate transport.
     *
     * ⛔ Return a route ONLY when requests to it are actually served. A route
     * named here is advertised verbatim, so naming an unserved one re-creates
     * the `declared ≠ enforced` gap ADR-0076 D12 exists to close — the same
     * defect, one layer up, that made discovery advertise a realtime service
     * with no surface in the first place.
     *
     * Not implemented by `@objectstack/service-realtime`: it is an in-process
     * pub/sub bus with no wire surface (maintainer ruling A, 2026-09-04 —
     * realtime stays out of open core), so on a stock boot discovery reports
     * `enabled: false` and there is nothing to subscribe to.
     *
     * @returns the mounted channel path (e.g. `/api/v1/realtime`), or `undefined`
     */
    getChannelRoute?(): string | undefined;

    /**
     * Subscribe to metadata events (convenience method)
     * @param filter - Subscription filter
     * @param handler - Event handler function
     * @returns Subscription identifier for unsubscribing
     */
    subscribeMetadata?(filter: RealtimeSubscriptionFilter, handler: RealtimeEventHandler): Promise<string>;

    /**
     * Subscribe to data events (convenience method)
     * @param filter - Subscription filter
     * @param handler - Event handler function
     * @returns Subscription identifier for unsubscribing
     */
    subscribeData?(filter: RealtimeSubscriptionFilter, handler: RealtimeEventHandler): Promise<string>;
}
