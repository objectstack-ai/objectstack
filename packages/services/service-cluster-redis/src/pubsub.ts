// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Redis } from 'ioredis';
import type {
    IPubSub,
    PubSubHandler,
    PublishOptions,
    SubscribeOptions,
    Unsubscribe,
} from '@objectstack/spec/contracts';
import { duplicateForPubSub } from './client.js';

/**
 * Wire-format envelope sent over Redis. Adds `fromNode` and
 * `publishedAt` so subscribers see the same surface as the memory
 * driver. The user payload is nested under `p` to avoid colliding with
 * reserved keys.
 */
interface RedisPubSubEnvelope {
    n?: string;
    t: number;
    p: unknown;
}

export interface RedisPubSubOptions {
    /** Already-connected client used for PUBLISH. */
    client: Redis;
    /** Optional node id surfaced as `fromNode` on every delivered message. */
    nodeId?: string;
    /** Key namespace prefix applied to every channel (default: 'os:'). */
    keyPrefix?: string;
    /** Error sink for subscriber handler exceptions. */
    onError?: (err: unknown, channel: string) => void;
}

/**
 * Redis pub/sub implementation of {@link IPubSub}.
 *
 * Uses two ioredis clients under the hood:
 *   - `publisher` (caller-provided) — runs PUBLISH commands
 *   - `subscriber` (auto-duplicated) — held in subscribe mode, can't run
 *     regular commands per Redis protocol
 *
 * Delivery semantics match Redis pub/sub: at-most-once, fire-and-forget,
 * no persistence. For at-least-once + replay use the planned `streams`
 * adapter (separate driver).
 *
 * Channel names are prefixed with `keyPrefix` before being sent to
 * Redis, so the same Redis instance can host multiple isolated
 * ObjectStack deployments.
 */
export class RedisPubSub implements IPubSub {
    private readonly publisher: Redis;
    private readonly subscriber: Redis;
    private readonly nodeId?: string;
    private readonly keyPrefix: string;
    private readonly onError: (err: unknown, channel: string) => void;
    private readonly subs = new Map<string, Set<PubSubHandler<unknown>>>();
    private closed = false;

    constructor(opts: RedisPubSubOptions) {
        this.publisher = opts.client;
        this.subscriber = duplicateForPubSub(opts.client);
        this.nodeId = opts.nodeId;
        this.keyPrefix = opts.keyPrefix ?? 'os:';
        this.onError =
            opts.onError ??
            ((err, channel) => {
                console.error(`[RedisPubSub] handler error on "${channel}":`, err);
            });

        this.subscriber.on('message', (raw: string, data: string) => {
            this.dispatch(raw, data);
        });
    }

    /**
     * Durability contract (P1-5): this awaits the Redis `PUBLISH` command (so the
     * message left this node), but Redis pub/sub is **at-most-once** — there is no
     * delivery guarantee to subscribers and no replay for a node that was down or
     * slow at publish time. This is acceptable **only** for events that are pure
     * cache-invalidation hints, never the source of truth.
     *
     * In particular `metadata.changed` is such a hint: the durable record of every
     * metadata mutation is the transactional write to `sys_metadata`
     * (+ `sys_metadata_history`). A subscriber that misses the event keeps serving
     * its cached schema until its next reload and **loses no data** — it self-heals
     * on restart / reload against the DB. Do not route any state that must be
     * delivered exactly-once through this channel; use a durable outbox instead.
     */
    async publish<T = unknown>(
        channel: string,
        payload: T,
        _opts?: PublishOptions,
    ): Promise<void> {
        if (this.closed) throw new Error('RedisPubSub is closed');
        const envelope: RedisPubSubEnvelope = {
            n: this.nodeId,
            t: Date.now(),
            p: payload,
        };
        await this.publisher.publish(this.prefixed(channel), JSON.stringify(envelope));
    }

    subscribe<T = unknown>(
        channel: string,
        handler: PubSubHandler<T>,
        _opts?: SubscribeOptions,
    ): Unsubscribe {
        if (this.closed) throw new Error('RedisPubSub is closed');
        const prefixed = this.prefixed(channel);
        let bucket = this.subs.get(prefixed);
        if (!bucket) {
            bucket = new Set();
            this.subs.set(prefixed, bucket);
            // Fire-and-forget; if subscribe fails the next publish will
            // simply not deliver — caller can resubscribe.
            void this.subscriber.subscribe(prefixed).catch((err) => {
                this.onError(err, channel);
            });
        }
        const wrapped = handler as PubSubHandler<unknown>;
        bucket.add(wrapped);

        let disposed = false;
        return () => {
            if (disposed) return;
            disposed = true;
            const b = this.subs.get(prefixed);
            if (!b) return;
            b.delete(wrapped);
            if (b.size === 0) {
                this.subs.delete(prefixed);
                void this.subscriber.unsubscribe(prefixed).catch(() => { /* swallow */ });
            }
        };
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        this.subs.clear();
        try { await this.subscriber.quit(); } catch { /* swallow */ }
        // We don't quit `publisher` — caller owns it.
    }

    private prefixed(channel: string): string {
        return `${this.keyPrefix}ps:${channel}`;
    }

    private dispatch(prefixedChannel: string, data: string): void {
        const bucket = this.subs.get(prefixedChannel);
        if (!bucket || bucket.size === 0) return;

        let envelope: RedisPubSubEnvelope;
        try {
            envelope = JSON.parse(data) as RedisPubSubEnvelope;
        } catch (err) {
            this.onError(err, prefixedChannel);
            return;
        }

        // Strip our keyPrefix so the handler sees the logical channel.
        const logical = prefixedChannel.startsWith(`${this.keyPrefix}ps:`)
            ? prefixedChannel.slice(`${this.keyPrefix}ps:`.length)
            : prefixedChannel;

        const snapshot = Array.from(bucket);
        for (const handler of snapshot) {
            try {
                const result = handler({
                    channel: logical,
                    payload: envelope.p,
                    publishedAt: envelope.t,
                    fromNode: envelope.n,
                });
                if (result && typeof (result as Promise<void>).then === 'function') {
                    (result as Promise<void>).catch((err) =>
                        this.onError(err, logical),
                    );
                }
            } catch (err) {
                this.onError(err, logical);
            }
        }
    }
}
