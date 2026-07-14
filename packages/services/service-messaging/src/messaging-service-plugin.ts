// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel } from './inbox-channel.js';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { NotificationDispatcher, type DispatchCluster } from './dispatcher.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { createEmailChannel } from './email-channel.js';
import { createSmsChannel } from './sms-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import {
    InboxMessage,
    NotificationReceipt,
    NotificationDelivery,
    NotificationPreference,
    NotificationSubscription,
    NotificationTemplate,
    HttpDelivery,
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
    private httpDispatcher?: HttpDispatcher;

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

        // ADR-0030: the messaging service also backs the `notification` core
        // service slot — it owns the in-app inbox + receipts, so it answers the
        // `/api/v1/notifications` REST surface (list / mark-read / mark-all-read)
        // via its inbox read API. Registering it here makes the dispatcher
        // resolve + advertise those routes (`hasNotification`). The legacy
        // INotificationService `send()` abstraction is unused; nothing consumes
        // the slot expecting it.
        ctx.registerService('notification', service);

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
                HttpDelivery,
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

        // ADR-0029 D8 — contribute this service's object translations to the
        // i18n service on kernel:ready (the i18n plugin may register after
        // this one).
        if (typeof ctx.hook === 'function') {
            ctx.hook('kernel:ready', async () => {
                try {
                    const i18n = ctx.getService<any>('i18n');
                    if (i18n && typeof i18n.loadTranslations === 'function') {
                        const { MessagingTranslations } = await import('./translations/index.js');
                        for (const [locale, data] of Object.entries(MessagingTranslations)) {
                            i18n.loadTranslations(locale, data as Record<string, unknown>);
                        }
                    }
                } catch { /* i18n optional */ }
            });
        }

        // Provision the physical tables for this service's system objects
        // up-front, once the engine is ready. The inbox channel materializes
        // sys_inbox_message + sys_notification_receipt rows on first delivery,
        // so the tables are otherwise lazy-created on first WRITE — a freshly
        // provisioned env that READS the inbox / notifications before any
        // message has been delivered hits "no such table", logged as a
        // `Find operation failed` ERROR on every page load. Runs independently
        // of `reliableDelivery` (the inbox tables are needed either way) and is
        // idempotent. See {@link provisionSystemTables}.
        if (typeof ctx.hook === 'function') {
            ctx.hook('kernel:ready', async () => {
                const engine = getData();
                if (engine) await this.provisionSystemTables(engine, ctx);
            });
        }

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

            // SMS channel (#2780): same pattern as email — register when an
            // `sms` service (service-sms) is present at kernel:ready; absent
            // sms ⇒ no channel, so a notify(channels:['sms']) reports "not
            // registered" rather than silently no-opping.
            const getSms = () => {
                try {
                    return ctx.getService<import('./sms-channel.js').SmsSenderSurface>('sms');
                } catch {
                    return undefined;
                }
            };
            ctx.hook('kernel:ready', async () => {
                if (getSms()) {
                    service.registerChannel(createSmsChannel({ getSms, getData, store: templateStore }));
                    ctx.logger.info('[messaging] sms channel registered (renders sys_notification_template)');
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

                // ADR-0018 M3: generic outbound-HTTP outbox + dispatcher. Backs
                // the Flow `http` node (and, going forward, webhook fan-out) with
                // the same retry / dead-letter substrate as notifications.
                const httpOutbox = new SqlHttpOutbox(engine, { partitionCount: this.options.partitionCount });
                service.setHttpOutbox(httpOutbox);
                this.httpDispatcher = new HttpDispatcher({
                    nodeId: `http-${process.pid}-${randomUUID().slice(0, 8)}`,
                    outbox: httpOutbox,
                    cluster,
                    partitionCount: this.options.partitionCount,
                    intervalMs: this.options.dispatchIntervalMs,
                    logger: ctx.logger,
                });
                this.httpDispatcher.start();
                ctx.logger.info(
                    `[messaging] HTTP delivery on (sys_http_delivery outbox + dispatcher, ${this.options.partitionCount} partitions)`,
                );
            });
        }

        // Retention is owned by the platform LifecycleService (ADR-0057): the
        // pipeline objects (sys_notification / delivery / receipt / inbox)
        // declare one 90d `lifecycle` window and the Reaper enforces it — the
        // plugin-local NotificationRetention sweeper this used to wire is
        // retired (ADR-0057 §6: lifecycle is a platform primitive, owned once).
        // Override windows per environment/tenant via the `lifecycle`
        // settings namespace (`retention_overrides`).

        ctx.logger.info(
            `[messaging] service registered with channels: ${service.getRegisteredChannels().join(', ') || '(none)'}`,
        );
    }

    /**
     * Provision the physical tables for this service's system objects up-front.
     *
     * These objects are lazy-created on first WRITE (the SQL driver issues DDL
     * when the first row is inserted), so an env that READS them first — the
     * Console bell / inbox queries sys_inbox_message + sys_notification_receipt
     * before any notification has been delivered — hits "no such table", which
     * the engine logs as a `Find operation failed` ERROR on every page load.
     * Creating the tables at kernel:ready makes a new env consistent from the
     * start. Idempotent (the driver only creates a table when absent), so it is
     * safe on every boot; per-object failures are isolated.
     */
    private async provisionSystemTables(engine: IDataEngine, ctx: PluginContext): Promise<void> {
        // `syncObjectSchema` lives on the concrete ObjectQL engine, not the
        // IDataEngine contract; engines without on-demand DDL skip provisioning.
        const sync = (engine as unknown as { syncObjectSchema?: (name: string) => Promise<void> }).syncObjectSchema;
        if (typeof sync !== 'function') return;
        const objects = [
            InboxMessage,
            NotificationReceipt,
            NotificationDelivery,
            NotificationPreference,
            NotificationSubscription,
            NotificationTemplate,
            HttpDelivery,
        ];
        for (const obj of objects) {
            try {
                await sync.call(engine, (obj as { name: string }).name);
            } catch (err) {
                ctx.logger.warn(`[messaging] could not provision ${(obj as { name: string }).name} storage — ${(err as Error)?.message ?? err}`);
            }
        }
    }

    /** Stop the dispatcher loop + retention sweep on shutdown. */
    async stop(): Promise<void> {
        await this.dispatcher?.stop();
        this.dispatcher = undefined;
        await this.httpDispatcher?.stop();
        this.httpDispatcher = undefined;
    }
}
