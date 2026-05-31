// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    MessagingChannel,
    MessagingChannelContext,
    Notification,
} from './channel.js';

/** Per-delivery outcome record returned from {@link MessagingService.emit}. */
export interface DeliveryOutcome {
    readonly channel: string;
    readonly recipient: string;
    readonly ok: boolean;
    readonly externalId?: string;
    readonly error?: string;
}

/** Aggregate result of fanning one notification out to its channels. */
export interface EmitResult {
    readonly deliveries: DeliveryOutcome[];
    readonly delivered: number;
    readonly failed: number;
}

/**
 * MessagingService — the M1-minimal outbound dispatcher (ADR-0012).
 *
 * Holds the `MessagingChannel` registry and implements `emit()`: it fans a
 * notification out to `(channel × recipient)` deliveries and calls each
 * channel's `send()`. The always-on `inbox` channel is registered by the
 * plugin; other channels (email/webhook/push/IM) register themselves.
 *
 * Deliberately *not* in this milestone (see ADR-0012 §M1 vs the deferred
 * scope): the durable outbox, retry schedule, cluster-lock, dead-letter, the
 * topic catalog, the per-user preference matrix, renderers, and middleware.
 * `emit()` is synchronous best-effort fan-out; failures are reported in the
 * result rather than persisted for retry. The seam (`MessagingChannel`,
 * `Notification`) is shaped so those land without breaking callers.
 */
export class MessagingService {
    private readonly channels = new Map<string, MessagingChannel>();

    constructor(private readonly ctx: MessagingChannelContext) {}

    /** Register a channel implementation. A duplicate id warns and replaces. */
    registerChannel(channel: MessagingChannel): void {
        if (this.channels.has(channel.id)) {
            this.ctx.logger.warn(`[messaging] channel '${channel.id}' already registered; replacing`);
        }
        this.channels.set(channel.id, channel);
        this.ctx.logger.info(`[messaging] channel registered: ${channel.id}`);
    }

    /** Remove a channel. No-op when absent. */
    unregisterChannel(id: string): void {
        this.channels.delete(id);
    }

    /** Look up a channel by id. */
    getChannel(id: string): MessagingChannel | undefined {
        return this.channels.get(id);
    }

    /** All registered channel ids. */
    getRegisteredChannels(): string[] {
        return [...this.channels.keys()];
    }

    /**
     * Fan a notification out to its channels and recipients. Each
     * `(channel, recipient)` pair becomes one `send()` call. An unregistered
     * channel, or a channel that throws, is reported as a failed delivery —
     * it never aborts the rest of the fan-out.
     */
    async emit(notification: Notification): Promise<EmitResult> {
        const channels = notification.channels?.length ? notification.channels : ['inbox'];
        const recipients = notification.recipients ?? [];
        const deliveries: DeliveryOutcome[] = [];

        for (const channelId of channels) {
            const channel = this.channels.get(channelId);
            if (!channel) {
                // Surface the gap per recipient so the caller sees who missed out.
                for (const recipient of recipients) {
                    deliveries.push({
                        channel: channelId,
                        recipient,
                        ok: false,
                        error: `channel '${channelId}' not registered`,
                    });
                }
                this.ctx.logger.warn(`[messaging] emit: channel '${channelId}' not registered`);
                continue;
            }

            for (const recipient of recipients) {
                try {
                    const result = await channel.send(this.ctx, {
                        notification,
                        channel: channelId,
                        recipient,
                    });
                    deliveries.push({
                        channel: channelId,
                        recipient,
                        ok: result.ok,
                        externalId: result.externalId,
                        error: result.error,
                    });
                } catch (err) {
                    deliveries.push({
                        channel: channelId,
                        recipient,
                        ok: false,
                        error: (err as Error)?.message ?? String(err),
                    });
                }
            }
        }

        const delivered = deliveries.filter((d) => d.ok).length;
        return { deliveries, delivered, failed: deliveries.length - delivered };
    }
}
