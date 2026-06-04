// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';

/**
 * Structural view of `@objectstack/service-messaging`'s service (ADR-0012),
 * declared locally so service-automation does not take a runtime dependency on
 * it — mirrors the `ConnectorRegistrySurface` pattern. The `notify` node
 * resolves whatever object is registered under the `messaging` service and
 * dispatches through this shape; if no such service is present the node
 * degrades to a no-op success.
 */
export interface MessagingServiceSurface {
    emit(input: {
        topic: string;
        audience: string[];
        payload?: Record<string, unknown>;
        severity?: string;
        dedupKey?: string;
        source?: { object: string; id: string };
        actorId?: string;
        channels?: string[];
    }): Promise<{ notificationId: string; delivered: number; failed: number }>;
}

/** Coerce a config value (string | string[]) into a clean string[]. */
function toStringList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
}

/**
 * `notify` built-in node (ADR-0012) — outbound notification.
 *
 * Baseline node and the human-notification counterpart to `http_request`
 * ("raw call") and `connector_action` ("call a registered integration"):
 * `notify` hands a topic + recipients + message to the platform's messaging
 * service, which fans it out across the user's channels (inbox by default).
 *
 * Like the CRUD nodes degrade without a data engine, `notify` degrades to a
 * warning + success when no `messaging` service is registered — the capability
 * simply isn't installed in that stack. Install `MessagingServicePlugin`
 * (`@objectstack/service-messaging`) and the same flow starts delivering, with
 * no flow edit. This is the seam that fixes the "notify drops on the floor"
 * gap (#1292) once messaging is present.
 */
export function registerNotifyNode(engine: AutomationEngine, ctx: PluginContext): void {
    const getMessaging = (): MessagingServiceSurface | undefined => {
        try {
            return ctx.getService<MessagingServiceSurface>('messaging');
        } catch {
            return undefined;
        }
    };

    engine.registerNodeExecutor({
        type: 'notify',
        descriptor: defineActionDescriptor({
            type: 'notify', version: '1.0.0', name: 'Notify',
            description: 'Send an outbound notification to users via the messaging service (inbox / email / push / …).',
            icon: 'bell', category: 'io', source: 'builtin',
            supportsRetry: true,
            // Delivery is outbox-backed inside the messaging service (ADR-0030
            // emit → sys_notification_delivery), so it inherits retry/dead-letter.
            needsOutbox: true,
            paradigms: ['flow', 'approval'],
        }),
        async execute(node, variables, context) {
            const cfg = (node.config ?? {}) as Record<string, unknown>;

            const recipients = toStringList(interpolate(cfg.recipients ?? cfg.to ?? [], variables, context));
            const title = String(interpolate(cfg.title ?? cfg.subject ?? '', variables, context) ?? '');
            const body = String(interpolate(cfg.message ?? cfg.body ?? '', variables, context) ?? '');
            const channels = toStringList(cfg.channels);
            const topic = cfg.topic ? String(cfg.topic) : undefined;
            const severity = cfg.severity ? String(cfg.severity) : undefined;
            const actionUrl = cfg.actionUrl
                ? String(interpolate(cfg.actionUrl, variables, context) ?? '')
                : undefined;
            const payload = cfg.payload
                ? (interpolate(cfg.payload, variables, context) as Record<string, unknown>)
                : undefined;

            if (!title) return { success: false, error: 'notify: title (or subject) is required' };
            if (recipients.length === 0) {
                return { success: false, error: 'notify: at least one recipient is required' };
            }

            const messaging = getMessaging();
            if (!messaging) {
                ctx.logger.warn(
                    `[notify] no messaging service registered; notification "${title}" not delivered`,
                );
                return {
                    success: true,
                    output: { delivered: 0, failed: 0, skipped: true },
                };
            }

            try {
                // ADR-0030 single ingress: hand the messaging service a topic +
                // audience + payload; it writes the L2 event and materializes
                // per channel. title/body/url ride in the payload (templates in
                // a later phase fall back to these).
                const result = await messaging.emit({
                    topic: topic ?? 'notify',
                    audience: recipients,
                    payload: { ...(payload ?? {}), title, body, url: actionUrl },
                    severity,
                    channels: channels.length ? channels : undefined,
                });
                return {
                    success: true,
                    output: {
                        notificationId: result.notificationId,
                        delivered: result.delivered,
                        failed: result.failed,
                    },
                };
            } catch (err) {
                return { success: false, error: `notify failed: ${(err as Error).message}` };
            }
        },
    });

    ctx.logger.info('[Notify] 1 built-in node executor registered (notify)');
}
