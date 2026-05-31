// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
    Delivery,
    ErrorClass,
    MessagingChannel,
    MessagingChannelContext,
    SendResult,
} from './channel.js';

/** The object the inbox channel writes rows to. */
export const INBOX_OBJECT = 'sys_inbox_message';

export interface InboxChannelOptions {
    /**
     * Resolve the runtime data engine. Returns `undefined` when no data layer
     * is registered (e.g. a minimal test stack) — the channel then warns and
     * reports a no-op success rather than throwing, matching the platform's
     * built-in CRUD-node degradation.
     */
    getData(): IDataEngine | undefined;
    /** Object name override (default {@link INBOX_OBJECT}). */
    objectName?: string;
    /** Clock injection for deterministic tests. Defaults to `new Date()`. */
    now?(): string;
}

/**
 * The always-on `inbox` channel (ADR-0012 §4).
 *
 * Unlike email/webhook/push, inbox is direction-reversed: there is no outbound
 * call — we write a `sys_inbox_message` row in our own DB and the user's client
 * pulls it. So it needs no connector/transport. One delivery → one row keyed by
 * the recipient user id.
 */
export function createInboxChannel(opts: InboxChannelOptions): MessagingChannel {
    const objectName = opts.objectName ?? INBOX_OBJECT;
    const now = opts.now ?? (() => new Date().toISOString());

    return {
        id: 'inbox',

        async send(ctx: MessagingChannelContext, delivery: Delivery): Promise<SendResult> {
            const data = opts.getData();
            const n = delivery.notification;

            if (!data) {
                ctx.logger.warn(
                    `[inbox] no data engine registered; inbox row for '${delivery.recipient}' not persisted`,
                );
                return { ok: true };
            }

            const row: Record<string, unknown> = {
                user_id: delivery.recipient,
                topic: n.topic,
                title: n.title,
                body_md: n.body,
                severity: n.severity ?? 'info',
                action_url: n.actionUrl,
                read: false,
                created_at: now(),
            };

            try {
                const created = await data.insert(objectName, row);
                const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
                return { ok: true, externalId: id != null ? String(id) : undefined };
            } catch (err) {
                return { ok: false, error: `inbox insert failed: ${(err as Error).message}` };
            }
        },

        classifyError(_err: unknown): ErrorClass {
            // A failed local insert is almost always transient (lock/timeout).
            return 'retryable';
        },
    };
}
