// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel } from './inbox-channel.js';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { NotificationDispatcher, type DispatchCluster } from './dispatcher.js';
import { createEmailChannel } from './email-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import {
    InboxMessage,
    NotificationReceipt,
    NotificationDelivery,
    NotificationPreference,
    NotificationSubscription,
    NotificationTemplate,
} from './objects/index.js';

export interface MessagingServicePluginOptions {
    /**
     * Register the always-on `inbox` channel during init (default `true`).
     * Set `false` only for tests that want an empty registry.
     */
    registerInbox?: boolean;
    /**
     * Run the durable delivery outbox + dispatcher (ADR-0030 P1) when a data
     * engine is available (default `true`). When off (or no engine), `emit()`
     * fans out inline best-effort (P0 behavior).
     */
    reliableDelivery?: boolean;
    /** Outbox/dispatcher partition count (default 8). */
    partitionCount?: number;
    /** Dispatcher tick interval in ms (default 500). */
    dispatchIntervalMs?: number;
    /**
     * Topics that bypass the per-user preference matrix (ADR-0030 P2) — e.g.
     * security/system alerts users must not be able to mute. Exact match, or a
     * `prefix.` entry for a prefix match (default none).
     */
    mandatoryTopics?: readonly string[];
}

/**
 * MessagingServicePlugin — registers the `messaging` service (ADR-0012 /
 * ADR-0030).
 *
 * After bootstrap, `kernel.getService('messaging')` is a {@link MessagingService}
 * with the always-on `inbox` channel registered. The baseline `notify` flow
 * node dispatches through it; flows therefore stop being no-ops once this
 * plugin is installed. Other channels (email/webhook/push/IM) register
 * themselves on this same service.
 *
 * At `kernel:ready` (engine available) the plugin wires the reliable-delivery
 * path: a `SqlNotificationOutbox` over `sys_notification_delivery` plus a
 * `NotificationDispatcher` that drains it with retry/backoff/dead-letter.
 * `emit()` then enqueues durable deliveries instead of fanning out inline.
 *
 * @example
 * ```ts
 * const kernel = new ObjectKernel();
 * kernel.use(new AutomationServicePlugin()); // ships the `notify` node
 * kernel.use(new MessagingServicePlugin());  // backs it with delivery
 * await kernel.bootstrap();
 * ```
 */
export class MessagingServicePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    version = '1.0.0';
    type = 'standard' as const;
    dependencies = ['com.objectstack.engine.objectql'];

    private readonly options: Required<MessagingServicePluginOptions>;
    private dispatcher?: NotificationDispatcher;

    constructor(options: MessagingServicePluginOptions = {}) {
        this.options = {
            registerInbox: true,
            reliableDelivery: true,
            partitionCount: 8,
            dispatchIntervalMs: 500,
            mandatoryTopics: [],
            ...options,
        };
    }

    async init(ctx: PluginContext): Promise<void> {
        // Shared lazy data-engine resolver — used to persist the L2
        // `sys_notification` event in `emit()`, by the inbox channel to
        // materialize rows, and (at kernel:ready) to back the outbox. Resolved
        // lazily so it works regardless of plugin init order.
        const getData = (): IDataEngine | undefined => {
            try {
                return ctx.getService<IDataEngine>('data') ?? ctx.getService<IDataEngine>('objectql');
            } catch {
                return undefined;
            }
        };

        const service = new MessagingService({
            logger: ctx.logger,
            getData,
            mandatoryTopics: this.options.mandatoryTopics,
        });

        if (this.options.registerInbox) {
            service.registerChannel(createInboxChannel({ getData }));
        }

        ctx.registerService('messaging', service);

        // Register the messaging objects so their rows can be written. The
        // preference/subscription objects (ADR-0030 P2) are Studio-configurable,
        // so contribute them to the Setup app's Configuration slot (ADR-0029 D7)
        // — they appear in nav only when this plugin is installed.
        ctx.getService<{ register(m: unknown): void }>('manifest').register({
            id: 'com.objectstack.service.messaging',
            name: 'Messaging Service',
            version: '1.0.0',
            type: 'plugin',
            scope: 'system',
            objects: [
                InboxMessage,
                NotificationReceipt,
                NotificationDelivery,
                NotificationPreference,
                NotificationSubscription,
                NotificationTemplate,
            ],
            navigationContributions: [
                {
                    app: 'setup',
                    group: 'group_configuration',
                    priority: 120,
                    items: [
                        { id: 'nav_notification_preferences', type: 'object', label: 'Notification Preferences', objectName: 'sys_notification_preference', icon: 'bell-ring', requiresObject: 'sys_notification_preference' },
                        { id: 'nav_notification_subscriptions', type: 'object', label: 'Notification Subscriptions', objectName: 'sys_notification_subscription', icon: 'rss', requiresObject: 'sys_notification_subscription' },
                        { id: 'nav_notification_templates', type: 'object', label: 'Notification Templates', objectName: 'sys_notification_template', icon: 'file-text', requiresObject: 'sys_notification_template' },
                    ],
                },
            ],
        });

        // Email channel (ADR-0030 P3): register when an `email` service is
        // present. Resolved at kernel:ready so init order with the email plugin
        // doesn't matter; absent email ⇒ no channel (a notify(channels:['email'])
        // then reports "not registered" rather than silently no-opping). The
        // dispatcher looks channels up dynamically, so registering after it is fine.
        if (typeof ctx.hook === 'function') {
            const templateStore = new NotificationTemplateStore({ getData });
            const getEmail = () => {
                try {
                    return ctx.getService<import('./email-channel.js').EmailSenderSurface>('email');
                } catch {
                    return undefined;
                }
            };
            ctx.hook('kernel:ready', async () => {
                if (getEmail()) {
                    service.registerChannel(createEmailChannel({ getEmail, getData, store: templateStore }));
                    ctx.logger.info('[messaging] email channel registered (renders sys_notification_template)');
                }
            });
        }

        // Reliable delivery (P1): wire the outbox + dispatcher once the engine
        // is resolvable. Until then `emit()` runs inline best-effort.
        if (this.options.reliableDelivery && typeof ctx.hook === 'function') {
            ctx.hook('kernel:ready', async () => {
                const engine = getData();
                if (!engine) {
                    ctx.logger.warn('[messaging] no data engine at kernel:ready — reliable delivery disabled (inline fan-out)');
                    return;
                }
                const outbox = new SqlNotificationOutbox(engine, { partitionCount: this.options.partitionCount });
                service.setOutbox(outbox);

                let cluster: DispatchCluster | undefined;
                try {
                    cluster = ctx.getService<DispatchCluster>('cluster');
                } catch {
                    cluster = undefined; // single-node fallback in the dispatcher
                }

                this.dispatcher = new NotificationDispatcher({
                    nodeId: `notify-${process.pid}-${randomUUID().slice(0, 8)}`,
                    outbox,
                    channels: service,
                    channelContext: { logger: ctx.logger },
                    cluster,
                    partitionCount: this.options.partitionCount,
                    intervalMs: this.options.dispatchIntervalMs,
                    logger: ctx.logger,
                });
                this.dispatcher.start();
                ctx.logger.info(
                    `[messaging] reliable delivery on (outbox + dispatcher, ${this.options.partitionCount} partitions${cluster ? ', clustered' : ', single-node'})`,
                );
            });
        }

        ctx.logger.info(
            `[messaging] service registered with channels: ${service.getRegisteredChannels().join(', ') || '(none)'}`,
        );
    }

    /** Stop the dispatcher loop on shutdown. */
    async stop(): Promise<void> {
        await this.dispatcher?.stop();
        this.dispatcher = undefined;
    }
}
