// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { MessagingService } from './messaging-service.js';
import type { MessagingChannel } from './channel.js';
import { createInboxChannel } from './inbox-channel.js';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { DEFAULT_MAX_IDLE_INTERVAL_MS, NotificationDispatcher, type DispatchCluster } from './dispatcher.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { createEmailChannel } from './email-channel.js';
import { createSmsChannel } from './sms-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import { NotificationTextRenderer, type NotificationTextI18n } from './notification-text.js';
import {
    InboxMessage,
    NotificationReceipt,
    NotificationDelivery,
    NotificationPreference,
    NotificationSubscription,
    NotificationTemplate,
    HttpDelivery,
} from './objects/index.js';
// The L2 event this service writes on every `emit()`. It is OWNED by
// platform-objects (it is in `PLATFORM_OBJECTS_BY_PACKAGE`), and — like
// service-job with `SysJob` and service-queue with `SysJobQueue` — the service
// that owns the BEHAVIOUR is the one that contributes it to the manifest.
// It was parked in AuditPlugin until ADR-0030 landed; that migration is done
// (#4154), and AuditPlugin is an OPTIONAL pair in the CLI, so leaving it there
// meant this service's single ingress depended on another plugin being
// installed to register the table it writes.
import { SysNotification } from '@objectstack/platform-objects/audit';

/**
 * [#22984] Whether the engine's `ObjectQLPlugin` resolved `skipSchemaSync` (the
 * option, else `OS_SKIP_SCHEMA_SYNC=1`). `ObjectQLPlugin.init()` publishes that
 * value on the engine instance as an undeclared property, so it is probed here:
 * an engine nothing published it on (a test double, a foreign engine) reads as
 * not set. ⛔ Never a second read of the environment: the option and the env
 * var must not disagree between the engine's boot and this service's.
 */
function bootSchemaSyncSkipped(engine: IDataEngine): boolean {
    return (engine as unknown as { skipSchemaSync?: unknown }).skipSchemaSync === true;
}

/**
 * What an operator loses while `objectName`'s storage is missing, for
 * {@link provisionFailureLine}. The four pipeline objects are written as a SIDE
 * EFFECT of other actions — `emit()` writes the event, then the delivery outbox
 * row, the inbox row and its receipt — and the callers that emit (an approval
 * step, an @mention) catch a failed emit and complete anyway. So the loss there
 * is invisible from the action that caused it.
 */
function lostWithoutStorage(objectName: string): string {
    switch (objectName) {
        case 'sys_notification':
        case 'sys_notification_delivery':
        case 'sys_inbox_message':
        case 'sys_notification_receipt':
            return (
                'Notifications are written as a side effect of other actions, so an approval step or an @mention ' +
                'keeps completing while the notification rows it needs here cannot land.'
            );
        default:
            return 'Every write to it fails until it exists.';
    }
}

/**
 * The ONE line `provisionSystemTables` prints when an object's DDL throws — at
 * `error`, carrying both halves AGENTS.md "Degradation log levels" asks of a
 * durability degradation: ① the consequence, and that the deployment keeps
 * looking healthy; ② the fix. Both remedies are measured: this provisioning
 * runs on every boot that runs DDL, and `os migrate apply` creates all eight
 * of these tables.
 */
function provisionFailureLine(objectName: string): string {
    return (
        `[messaging] could not provision ${objectName} storage — its storage was NOT created. ` +
        `${lostWithoutStorage(objectName)} The boot still completes and the deployment keeps looking healthy. ` +
        "Fix: resolve the driver's refusal (in this record's meta), then restart, since this provisioning runs on " +
        'every boot, or run `os migrate apply`, which creates the missing storage (`os migrate plan` lists it as ' +
        `\`create_table:${objectName}\`). If the boot log also carries \`Schema sync FAILED for object ` +
        `'${objectName}'\`, that is the same refusal.`
    );
}

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
    /** Dispatcher tick interval in ms while there is work (default 500). */
    dispatchIntervalMs?: number;
    /**
     * [#17610, #17623] Ceiling in ms for the idle backoff of BOTH dispatchers —
     * notification and outbound-HTTP — the way `dispatchIntervalMs` and
     * `partitionCount` already govern both (default 30000). Consecutive ticks
     * that claim nothing double the interval from `dispatchIntervalMs` up to
     * this; a tick that claims work snaps it back, and the write that makes work
     * wakes its dispatcher at once — `emit()` enqueueing deliveries,
     * `enqueueHttp()` enqueueing a callout, `redeliverHttp()` resetting one.
     * While idle it bounds how late a dispatcher notices work nobody woke it
     * for: a deferred delivery coming due (retry, quiet hours, digest window), a
     * row enqueued by another process, a crashed node's claim passing its
     * timeout. A value at or below `dispatchIntervalMs` disables the backoff.
     */
    dispatchMaxIdleIntervalMs?: number;
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
/**
 * A resolve-on-use channel mount (#18050): ask the transport resolver on EVERY
 * lookup, build the channel object once, announce the bind once.
 *
 * The shape is the one `createLazyCounterStore` (plugin-auth) established for
 * the same hazard and AGENTS.md cites as the cure: nothing is resolved at
 * start, so plugin order decides nothing. Two properties are deliberate:
 *
 * - **The transport presence is re-read every call, never memoised.** That is
 *   the whole fix — memoising it would restore the one-shot verdict in a new
 *   place. A transport that appears later mounts the channel; one that goes
 *   away unmounts it again, which lands on the SAME refusal a composition
 *   without the transport has always produced.
 * - **The channel OBJECT is memoised**, so a mounted channel keeps its identity
 *   (and whatever it holds — template store handles, per-channel state) across
 *   lookups instead of being rebuilt per delivery row.
 */
function lazyChannelMount(opts: {
    resolveTransport: () => unknown;
    create: () => MessagingChannel;
    announce: string;
    logger: { info(msg: string): void };
}): () => MessagingChannel | undefined {
    let channel: MessagingChannel | undefined;
    return () => {
        if (!opts.resolveTransport()) return undefined;
        if (!channel) {
            channel = opts.create();
            opts.logger.info(opts.announce);
        }
        return channel;
    };
}

export class MessagingServicePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    /**
     * Services init() registers on every path (ADR-0116, #4131) — lets the
     * kernel name this plugin when a consumer requires one before it inits.
     */
    providesServices = ['messaging', 'notification'];
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
            dispatchMaxIdleIntervalMs: DEFAULT_MAX_IDLE_INTERVAL_MS,
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

        // Lazy `email` service resolver — shared by the email channel (send +
        // sendTemplate) and the inbox channel's render-only template path
        // (#9225): one resolver in plugin-email, two channels. Probed at
        // delivery time (never captured at boot) so plugin init order and
        // live service replacement don't matter.
        const getEmail = () => {
            try {
                return ctx.getService<import('./email-channel.js').EmailSenderSurface>('email');
            } catch {
                return undefined;
            }
        };
        // #9205 / #13881 — the DEPLOYMENT DEFAULT locale for template
        // resolution: the second rung of the per-recipient chain
        // (`recipient-locale.ts`: the recipient's own `sys_user.locale`, else
        // this). Probed lazily at delivery time (not captured at boot) so it
        // tracks live `localization.locale` / stack-config changes; same
        // ruled source as the auth emails' deployment rung (#8195:
        // `II18nService.getDefaultLocale()`). No request exists at async
        // delivery time, so `Accept-Language` is not a rung. Both hops
        // probed: `getService` throws for an unregistered service, and
        // `getDefaultLocale` is optional on the contract — either missing
        // leaves the locale unset, which lands the documented en-US default.
        const getDefaultTemplateLocale = (): string | undefined => {
            try {
                const i18n = ctx.getService<{ getDefaultLocale?: () => string }>('i18n');
                const locale = typeof i18n?.getDefaultLocale === 'function' ? i18n.getDefaultLocale() : undefined;
                return typeof locale === 'string' && locale.trim() ? locale : undefined;
            } catch {
                return undefined;
            }
        };

        // [#24978] The `i18n` service whose catalog a keyed notification text
        // is rendered from — probed at delivery time, never captured at boot,
        // for the reasons `getDefaultTemplateLocale` above is.
        const getI18n = (): NotificationTextI18n | undefined => {
            try {
                return ctx.getService<NotificationTextI18n>('i18n');
            } catch {
                return undefined;
            }
        };
        // ONE renderer for both delivery paths: the service's inline fan-out
        // and (below) the dispatcher, so a recipient's keyed text is rendered
        // the same way whichever path delivers it.
        const textRenderer = new NotificationTextRenderer({
            getData,
            getI18n,
            getDefaultLocale: getDefaultTemplateLocale,
            logger: ctx.logger,
        });

        const service = new MessagingService({
            logger: ctx.logger,
            getData,
            mandatoryTopics: this.options.mandatoryTopics,
            textRenderer,
        });

        if (this.options.registerInbox) {
            service.registerChannel(createInboxChannel({ getData, getEmail, getDefaultTemplateLocale }));
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
                SysNotification,
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

        // Email channel (ADR-0030 P3) + SMS channel (#2780): mounted through a
        // LAZY PROVIDER, so the mount TRACKS the transport service instead of
        // recording a verdict about it (#18050).
        //
        // Both used to read the service registry once, inside this hook, and
        // register the channel only `if (getEmail())`. The comment on that
        // guard — "the dispatcher looks channels up dynamically, so registering
        // after it is fine" — was true of the dispatcher and contradicted by
        // the guard beneath it: the `if` ran EXACTLY ONCE, at `kernel:ready`,
        // and nothing revisited it. A transport registered a moment later (a
        // plugin ordered after this one registering from its own `kernel:ready`
        // handler, `kernel:bootstrapped`, `kernel:listening`, or any runtime
        // mount) never got its channel, and every `notify(channels:['email'])`
        // was refused as "not registered" for the life of the process — the
        // three-part "Startup registry reads" shape AGENTS.md names, cured here
        // by its first cure: resolve where it is USED, not where you start.
        //
        // ⛔ What this does NOT change: while the transport is absent the
        // provider answers nothing, so the channel is not mounted and fan-out
        // refuses it exactly as before — no delivery row, and no
        // `sys_notification.suppressed_channels` entry, because an absent mount
        // is a COMPOSITION fact and that column answers "why can this TENANT
        // not send" (#18041's boundary, pinned in unregistered-channel.test.ts).
        // Whether a MOUNTED channel can send is the separate question
        // `isAvailable` answers.
        if (typeof ctx.hook === 'function') {
            const templateStore = new NotificationTemplateStore({ getData });
            ctx.hook('kernel:ready', async () => {
                service.registerChannelProvider('email', lazyChannelMount({
                    resolveTransport: getEmail,
                    create: () => createEmailChannel({ getEmail, getData, store: templateStore, getDefaultTemplateLocale }),
                    announce: '[messaging] email channel registered (renders sys_notification_template; notify `template` refs resolve sys_email_template by (name, locale) — resolved per recipient: sys_user.locale, else the deployment default)',
                    logger: ctx.logger,
                }));
            });

            // SMS channel (#2780): same pattern as email — mounted while an
            // `sms` service (service-sms) is resolvable, unmounted while it is
            // not, decided per lookup rather than once.
            const getSms = () => {
                try {
                    return ctx.getService<import('./sms-channel.js').SmsSenderSurface>('sms');
                } catch {
                    return undefined;
                }
            };
            ctx.hook('kernel:ready', async () => {
                service.registerChannelProvider('sms', lazyChannelMount({
                    resolveTransport: getSms,
                    create: () => createSmsChannel({ getSms, getData, store: templateStore, getDefaultTemplateLocale }),
                    announce: '[messaging] sms channel registered (renders sys_notification_template — resolved per recipient: sys_user.locale, else the deployment default)',
                    logger: ctx.logger,
                }));
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
                // [#17610] Resolved at call time: the dispatcher is constructed
                // below, and after destroy() the hook is a no-op.
                service.setOutbox(outbox, { onEnqueued: () => this.dispatcher?.wake() });

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
                    maxIdleIntervalMs: this.options.dispatchMaxIdleIntervalMs,
                    logger: ctx.logger,
                    textRenderer,
                });
                this.dispatcher.start();
                ctx.logger.info(
                    `[messaging] reliable delivery on (outbox + dispatcher, ${this.options.partitionCount} partitions${cluster ? ', clustered' : ', single-node'}, idle backoff up to ${Math.max(this.options.dispatchIntervalMs, this.options.dispatchMaxIdleIntervalMs)}ms)`,
                );

                // ADR-0018 M3: generic outbound-HTTP outbox + dispatcher. Backs
                // the Flow `http` node (and, going forward, webhook fan-out) with
                // the same retry / dead-letter substrate as notifications.
                const httpOutbox = new SqlHttpOutbox(engine, { partitionCount: this.options.partitionCount });
                // [#17623] The same seam as `setOutbox` above, resolved at call
                // time for the same reasons.
                service.setHttpOutbox(httpOutbox, { onEnqueued: () => this.httpDispatcher?.wake() });
                this.httpDispatcher = new HttpDispatcher({
                    nodeId: `http-${process.pid}-${randomUUID().slice(0, 8)}`,
                    outbox: httpOutbox,
                    cluster,
                    partitionCount: this.options.partitionCount,
                    intervalMs: this.options.dispatchIntervalMs,
                    maxIdleIntervalMs: this.options.dispatchMaxIdleIntervalMs,
                    logger: ctx.logger,
                });
                this.httpDispatcher.start();
                ctx.logger.info(
                    `[messaging] HTTP delivery on (sys_http_delivery outbox + dispatcher, ${this.options.partitionCount} partitions, idle backoff up to ${Math.max(this.options.dispatchIntervalMs, this.options.dispatchMaxIdleIntervalMs)}ms)`,
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
     *
     * [#22985] A failed provision is reported at `error`, once per object
     * ({@link provisionFailureLine}): the boot completes and the deployment
     * looks healthy while the table does not exist, and the pipeline tables
     * are written as a side effect of actions that complete without them. That
     * is the durability class AGENTS.md "Degradation log levels" sends to
     * `error`; `check:durability-log-level` holds it there.
     *
     * [#22984] It is boot-time DDL, so it honours `skipSchemaSync` /
     * `OS_SKIP_SCHEMA_SYNC=1` the way the engine's own boot sync does: a
     * deployment that declared its DDL managed out-of-band ("Use after running
     * migrations manually") gets no table created behind its back. The value is
     * the one `ObjectQLPlugin` resolved (`bootSchemaSyncSkipped`); when it
     * is set this returns before any DDL or existence probe (the flag protects a
     * cold-start budget) and says once, at `info`, what it did not provision and
     * why. Not `warn`: nothing is degraded, because the operator declared this.
     * `os migrate apply`, the documented path, was measured to create all eight
     * tables. `syncObjectSchema` itself stays ungated, because it is also how a
     * runtime publish gives a new object its table.
     */
    private async provisionSystemTables(engine: IDataEngine, ctx: PluginContext): Promise<void> {
        const objects = [
            // The L2 event is provisioned with the rest of the pipeline it
            // heads. Its table was previously created lazily by the SQL driver
            // on the first `emit()` — which works only where the object is
            // REGISTERED, and until #4154 that registration came from the
            // optional AuditPlugin rather than from this service.
            SysNotification,
            InboxMessage,
            NotificationReceipt,
            NotificationDelivery,
            NotificationPreference,
            NotificationSubscription,
            NotificationTemplate,
            HttpDelivery,
        ];
        // [#22984] FIRST: see the docblock. One line, naming every skipped object.
        if (bootSchemaSyncSkipped(engine)) {
            ctx.logger.info(
                `[messaging] ${objects.map((obj) => (obj as { name: string }).name).join(', ')} NOT provisioned at boot — ` +
                    "the boot's schema sync is skipped (`skipSchemaSync` / OS_SKIP_SCHEMA_SYNC=1), declaring this " +
                    "deployment's DDL managed out-of-band, so this service issues none either. `os migrate apply` creates " +
                    'any that are missing (`os migrate plan` lists them as `create_table`).',
            );
            return;
        }
        // [#12482] `syncObjectSchema?` is declared on the IDataEngine contract
        // (optional — only engines owning drivers and DDL answer); the
        // pre-#12482 `as unknown as` structural recovery is gone. The runtime
        // probe stays: engines without on-demand DDL skip provisioning.
        const sync = engine.syncObjectSchema;
        if (typeof sync !== 'function') return;
        for (const obj of objects) {
            const name = (obj as { name: string }).name;
            try {
                await sync.call(engine, name);
            } catch (err) {
                // A DURABILITY degradation, so `error` (AGENTS.md "Degradation
                // log levels"): the boot completes and the deployment looks
                // healthy while this table does not exist. Once per object per
                // boot, never per write; the boot is deliberately NOT failed.
                // The driver's refusal goes in meta, not in the message: a
                // multi-line driver error would split the record, and only its
                // first fragment would carry the level.
                ctx.logger.error(provisionFailureLine(name), undefined, {
                    object: name,
                    error: (err as Error)?.message ?? String(err),
                });
            }
        }
    }

    /**
     * The kernel's teardown hook (`Plugin.destroy`, core `types.ts`) — the ONLY
     * teardown entry point `ObjectKernel.performShutdown()` and
     * `LiteKernel.destroy()` invoke.
     *
     * [#9371] IT USED TO BE `stop()`, WHICH NOTHING CALLED. The method below
     * carried the docblock "Stop the dispatcher loop … on shutdown" and was
     * correct in every respect except its NAME: `Plugin` declares `destroy?()`
     * and no `stop()`, so the kernel walked past this plugin at shutdown and
     * both `setInterval` dispatchers went on ticking after `await
     * kernel.shutdown()` resolved. `start()` `unref()`s the timers, so a
     * long-lived process still EXITS — which is exactly why this stayed
     * invisible in production and surfaced somewhere else entirely.
     *
     * WHERE IT SURFACED. Under vitest the worker process is very much alive
     * during teardown, so a tick fires after the test file is over, reads
     * `sys_notification_delivery` / `sys_http_delivery` through a driver the
     * suite already disconnected, and `SqlDriver`'s console fallback warns.
     * `console.*` inside a worker is an RPC to the main process
     * (`onUserConsoleLog`); one created after `rpcDone()` has taken its
     * snapshot is rejected by vitest's `$rejectPendingCalls` as
     * `EnvironmentTeardownError: [vitest-worker]: Closing rpc while
     * "onUserConsoleLog" was pending`. Nobody awaits that promise, so it lands
     * as an UNHANDLED REJECTION and fails the run — with every test passing.
     * That is #9371: `examples/app-showcase` green at 334/334 and 337/337, exit
     * 1, a merge-queue eviction each time. The window is the duration of
     * `rpcDone()`, which is why it only ever fired on a loaded queue runner and
     * never on the PR-side run of the identical diff.
     *
     * So this is a teardown-contract fix, not a test fix: a plugin that owns
     * timers must release them on the hook the kernel actually calls.
     */
    async destroy(): Promise<void> {
        await this.dispatcher?.stop();
        this.dispatcher = undefined;
        await this.httpDispatcher?.stop();
        this.httpDispatcher = undefined;
    }

    /**
     * Retained alias for {@link destroy}. Kept because it is public API of an
     * exported class and removing it would break any embedder that learned to
     * call it precisely BECAUSE the kernel never did. Callers should prefer
     * kernel shutdown; direct callers keep working.
     */
    async stop(): Promise<void> {
        await this.destroy();
    }
}
