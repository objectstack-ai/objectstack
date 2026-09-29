// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IRealtimeService,
  RealtimeEventPayload,
  RealtimeEventHandler,
  RealtimeSubscriptionOptions,
} from '@objectstack/spec/contracts';

/**
 * Internal subscription entry.
 */
interface Subscription {
  id: string;
  channel: string;
  handler: RealtimeEventHandler;
  options?: RealtimeSubscriptionOptions;
}

/**
 * Default safety cap on active subscriptions. This adapter is process-local
 * (the v1 single-instance contract — see launch-readiness.md P0-5); an
 * unbounded subscription map would grow until the pod OOMs under a subscription
 * leak or an abusive client. The cap is a backstop: `subscribe` throws once
 * it's reached. Operators raise `maxSubscriptions` for high-fan-out nodes;
 * `maxSubscriptions: 0` opts out entirely (unbounded — only for tests).
 */
export const DEFAULT_MAX_SUBSCRIPTIONS = 50_000;

/**
 * Configuration options for InMemoryRealtimeAdapter.
 */
export interface InMemoryRealtimeAdapterOptions {
  /**
   * Maximum number of subscriptions allowed. Defaults to
   * {@link DEFAULT_MAX_SUBSCRIPTIONS}; `0` = unbounded (explicit opt-out).
   */
  maxSubscriptions?: number;
}

/**
 * In-memory pub/sub adapter implementing IRealtimeService.
 *
 * Uses a Map-backed subscription store with channel-based routing.
 * Supports event type and object filtering via subscription options.
 *
 * Suitable for single-process environments, development, and testing.
 * For production multi-instance deployments, use a Redis-backed adapter.
 *
 * @example
 * ```ts
 * const realtime = new InMemoryRealtimeAdapter();
 *
 * const subId = await realtime.subscribe('records', (event) => {
 *   console.log('Received:', event.type, event.payload);
 * }, { object: 'account', eventTypes: ['data.record.created'] });
 *
 * // The shape the ObjectQL engine publishes for an insert: the envelope's
 * // `payload` is the spec's `DataEvent`, and the row itself is `payload.after`.
 * const timestamp = new Date().toISOString();
 * await realtime.publish({
 *   type: 'data.record.created',
 *   object: 'account',
 *   payload: {
 *     id: crypto.randomUUID(), type: 'data.record.created', object: 'account',
 *     recordId: 'acc-1', after: { id: 'acc-1', name: 'Acme' }, timestamp,
 *   },
 *   timestamp,
 * });
 *
 * await realtime.unsubscribe(subId);
 * ```
 */
export class InMemoryRealtimeAdapter implements IRealtimeService {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly channelIndex = new Map<string, Set<string>>();
  private counter = 0;
  private readonly maxSubscriptions: number;

  constructor(options: InMemoryRealtimeAdapterOptions = {}) {
    this.maxSubscriptions = options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;
  }

  async publish(event: RealtimeEventPayload): Promise<void> {
    // Deliver to all channel subscriptions that match filters.
    //
    // ⚠️ TRUSTED fan-out (#2992 / ADR-0096 D4): there is NO per-recipient
    // authorization here — `matchesSubscription` filters by object/event type
    // only, `Subscription` carries no principal, and the engine publishes the
    // full record body. Safe ONLY while every subscriber is server-internal.
    // A client transport must not be wired to this path until delivery
    // re-checks each recipient's authority (or payloads become id-only); the
    // authz conformance matrix (`realtime-delivery-authz`) pins this.
    for (const sub of this.subscriptions.values()) {
      if (this.matchesSubscription(event, sub)) {
        try {
          await sub.handler(event);
        } catch {
          // Swallow handler errors to avoid breaking the publish loop
        }
      }
    }
  }

  async subscribe(
    channel: string,
    handler: RealtimeEventHandler,
    options?: RealtimeSubscriptionOptions,
  ): Promise<string> {
    if (this.maxSubscriptions > 0 && this.subscriptions.size >= this.maxSubscriptions) {
      throw new Error(
        `Maximum subscription limit reached (${this.maxSubscriptions}). ` +
        'Unsubscribe from existing channels before adding new subscriptions.',
      );
    }

    const id = `sub-${++this.counter}`;
    const sub: Subscription = { id, channel, handler, options };
    this.subscriptions.set(id, sub);

    // Maintain channel index for efficient lookups
    if (!this.channelIndex.has(channel)) {
      this.channelIndex.set(channel, new Set());
    }
    this.channelIndex.get(channel)!.add(id);

    return id;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;

    this.subscriptions.delete(subscriptionId);

    // Clean up channel index
    const channelSubs = this.channelIndex.get(sub.channel);
    if (channelSubs) {
      channelSubs.delete(subscriptionId);
      if (channelSubs.size === 0) {
        this.channelIndex.delete(sub.channel);
      }
    }
  }

  /**
   * Get the number of active subscriptions.
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get all active channel names.
   */
  getChannels(): string[] {
    return Array.from(this.channelIndex.keys());
  }

  /**
   * Check if an event matches a subscription's filters.
   */
  private matchesSubscription(event: RealtimeEventPayload, sub: Subscription): boolean {
    const opts = sub.options;
    if (!opts) return true;

    // Filter by object name
    if (opts.object && event.object !== opts.object) {
      return false;
    }

    // Filter by event types
    if (opts.eventTypes && opts.eventTypes.length > 0) {
      if (!opts.eventTypes.includes(event.type)) {
        return false;
      }
    }

    return true;
  }
}
