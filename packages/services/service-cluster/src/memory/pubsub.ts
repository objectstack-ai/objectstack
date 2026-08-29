// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    IPubSub,
    PubSubHandler,
    PublishOptions,
    SubscribeOptions,
    Unsubscribe,
} from '@objectstack/spec/contracts';

/**
 * In-memory PubSub for single-process deployments and tests.
 *
 * Behavior:
 *   - Synchronous fan-out: every subscriber's handler is invoked in the
 *     same tick that `publish()` resolves. Handler errors are swallowed
 *     and logged via `onError` (so one bad subscriber can't poison the bus).
 *   - Delivery is at-most-once: one synchronous in-process attempt per
 *     subscriber, with no persistence, no retry and no replay. A handler that
 *     throws loses that message outright — the error is swallowed above and
 *     nothing redelivers it — and a publish to a channel nobody is subscribed
 *     to at that moment is a silent no-op. This matches what `IPubSub`
 *     documents: no shipped driver exceeds at-most-once, so handlers must be
 *     idempotent **and** tolerate loss.
 *   - No cross-process delivery — use the redis/postgres/nats driver for
 *     real multi-node setups.
 */
export interface MemoryPubSubOptions {
    /** Optional error sink for handler exceptions. Defaults to console.error. */
    onError?: (err: unknown, channel: string) => void;
    /** Optional node id surfaced as `fromNode` on every message. */
    nodeId?: string;
}

interface Subscription {
    channel: string;
    handler: PubSubHandler<unknown>;
}

export class MemoryPubSub implements IPubSub {
    private readonly subs = new Map<string, Set<Subscription>>();
    private readonly onError: (err: unknown, channel: string) => void;
    private readonly nodeId?: string;
    private closed = false;

    constructor(opts: MemoryPubSubOptions = {}) {
        this.onError =
            opts.onError ??
            ((err, channel) => {
                // eslint-disable-next-line no-console
                console.error(`[MemoryPubSub] handler error on channel "${channel}":`, err);
            });
        this.nodeId = opts.nodeId;
    }

    async publish<T = unknown>(
        channel: string,
        payload: T,
        _opts?: PublishOptions,
    ): Promise<void> {
        if (this.closed) throw new Error('MemoryPubSub is closed');
        const bucket = this.subs.get(channel);
        if (!bucket || bucket.size === 0) return;
        const publishedAt = Date.now();
        // Snapshot so handler-driven unsubscribes during dispatch are safe.
        const snapshot = Array.from(bucket);
        for (const sub of snapshot) {
            try {
                const result = sub.handler({
                    channel,
                    payload,
                    publishedAt,
                    fromNode: this.nodeId,
                });
                if (result && typeof (result as Promise<void>).then === 'function') {
                    (result as Promise<void>).catch((err) => this.onError(err, channel));
                }
            } catch (err) {
                this.onError(err, channel);
            }
        }
    }

    subscribe<T = unknown>(
        channel: string,
        handler: PubSubHandler<T>,
        _opts?: SubscribeOptions,
    ): Unsubscribe {
        if (this.closed) throw new Error('MemoryPubSub is closed');
        let bucket = this.subs.get(channel);
        if (!bucket) {
            bucket = new Set();
            this.subs.set(channel, bucket);
        }
        const sub: Subscription = { channel, handler: handler as PubSubHandler<unknown> };
        bucket.add(sub);
        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            const b = this.subs.get(channel);
            if (!b) return;
            b.delete(sub);
            if (b.size === 0) this.subs.delete(channel);
        };
    }

    async close(): Promise<void> {
        this.closed = true;
        this.subs.clear();
    }
}
