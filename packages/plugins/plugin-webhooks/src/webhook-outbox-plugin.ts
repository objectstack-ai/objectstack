// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type {
    IDataEngine,
    II18nService,
    IMetadataService,
    IRealtimeService,
} from '@objectstack/spec/contracts';
import type { EnqueueHttpInput } from '@objectstack/service-messaging';
import { AutoEnqueuer, type AutoEnqueuerOptions } from './auto-enqueuer.js';
import { SysWebhook } from './sys-webhook.object.js';
import { bootstrapDeclaredWebhooks } from './bootstrap-declared-webhooks.js';
import { migrateLegacyWebhookSecrets } from './migrate-webhook-secrets.js';
import { bindWebhookProvenanceStamp, unbindWebhookProvenanceStamp } from './webhook-provenance.js';

/**
 * Structural view of `@objectstack/service-messaging`'s HTTP-outbox surface
 * (ADR-0018 M3) — declared locally so this plugin doesn't take a hard runtime
 * import on the service. Webhook deliveries are enqueued onto the shared
 * `sys_http_delivery` outbox and drained by the messaging `HttpDispatcher`.
 */
interface MessagingHttpSurface {
    isHttpDeliveryReady(): boolean;
    enqueueHttp(input: EnqueueHttpInput): Promise<string>;
    redeliverHttp(id: string): Promise<{ id: string; status: string }>;
}

export interface WebhookOutboxPluginOptions {
    /**
     * Auto-enqueue config. When enabled (default `true` if the realtime + data
     * engine services are available), the plugin subscribes to `data.record.*`
     * events and enqueues a delivery onto the shared messaging HTTP outbox for
     * every matching `sys_webhook` row.
     *
     * Set `false` to disable and enqueue webhooks imperatively elsewhere.
     */
    autoEnqueue?: boolean | AutoEnqueuerOptions;
}

/**
 * Wires webhook fan-out on top of the shared outbound-HTTP delivery substrate
 * (ADR-0018 M3).
 *
 * Webhooks are no longer their own delivery engine: the durable outbox, the
 * cluster-coordinated dispatcher, the retry/backoff/dead-letter schedule, and
 * the retention sweep all live in `@objectstack/service-messaging`
 * (`sys_http_delivery` + `HttpDispatcher`). This plugin owns only the
 * webhook-specific concerns:
 *   - the `sys_webhook` configuration object,
 *   - the {@link AutoEnqueuer} that turns `data.record.*` events into outbox
 *     rows (`source: 'webhook'`), and
 *   - the redeliver admin endpoint.
 *
 * End-to-end flow:
 *
 *   engine.insert('contact', {...})
 *     → engine publishes data.record.created via IRealtimeService
 *     → AutoEnqueuer matches active sys_webhook rows in O(1)
 *     → messaging.enqueueHttp() runs fire-and-forget (off the write path)
 *     → messaging HttpDispatcher claims and POSTs (cluster-coordinated, retried)
 *
 * **Requires** `MessagingServicePlugin` (`@objectstack/service-messaging`),
 * which is a foundational, always-on capability.
 */
export class WebhookOutboxPlugin implements Plugin {
    name = 'com.objectstack.plugin-webhook-outbox';
    version = '2.0.0';
    type = 'standard' as const;
    dependencies = ['com.objectstack.service.messaging'];
    /**
     * `init()` registers this plugin's schema through `manifest` with no
     * fallback. Until #4187 that was safe only TRANSITIVELY — messaging happens
     * to depend on ObjectQL, which provides `manifest` — so the guarantee would
     * have evaporated silently the day messaging stopped depending on the
     * engine, and the failure would have surfaced as an unrelated plugin's
     * init crash. Declaring the requirement directly makes the kernel check it
     * regardless of what messaging depends on.
     */
    requiresServices = ['manifest'];

    private autoEnqueuer: AutoEnqueuer | undefined;
    /** Engine the provenance hook was bound to, so `dispose()` can unbind it. */
    private boundEngine: any;

    constructor(private readonly options: WebhookOutboxPluginOptions = {}) {}

    async init(ctx: PluginContext): Promise<void> {
        // Register the webhook config object (ADR-0029 K2.a). The delivery
        // telemetry now lives in messaging's `sys_http_delivery`, so the nav's
        // "Deliveries" entry points there (filtered to source=webhook in views).
        const manifest = ctx.getService<{ register(m: any): void }>('manifest');
        if (manifest && typeof manifest.register === 'function') {
            manifest.register({
                id: 'com.objectstack.plugin-webhook-outbox.schema',
                namespace: 'sys',
                version: this.version,
                type: 'plugin',
                scope: 'system',
                name: 'Webhook Schemas',
                description: 'Registers sys_webhook (configuration). Deliveries use messaging\'s sys_http_delivery outbox.',
                objects: [SysWebhook],
                navigationContributions: [
                    {
                        app: 'setup',
                        group: 'group_integrations',
                        priority: 100,
                        items: [
                            { id: 'nav_webhooks', type: 'object', label: 'Webhooks', objectName: 'sys_webhook', icon: 'webhook', requiresObject: 'sys_webhook' },
                            { id: 'nav_http_deliveries', type: 'object', label: 'HTTP Deliveries', objectName: 'sys_http_delivery', icon: 'send', requiresObject: 'sys_http_delivery' },
                        ],
                    },
                ],
            });
        } else {
            ctx.logger.warn?.(
                '[webhook-outbox] manifest service unavailable — sys_webhook will NOT appear in REST or Studio nav. Register MetadataService before WebhookOutboxPlugin.',
            );
        }

        // ADR-0029 D8 — contribute object translations once i18n is up.
        if (typeof (ctx as any).hook === 'function') {
            (ctx as any).hook('kernel:ready', async () => {
                try {
                    const i18n = ctx.getService<II18nService>('i18n');
                    if (i18n && typeof i18n.loadTranslations === 'function') {
                        const { WebhooksTranslations } = await import('./translations/index.js');
                        for (const [locale, data] of Object.entries(WebhooksTranslations)) {
                            i18n.loadTranslations(locale, data as Record<string, unknown>);
                        }
                    }
                } catch { /* i18n optional */ }
            });
        }

        const autoEnqueueOpt = this.options.autoEnqueue ?? true;

        if (typeof (ctx as any).hook === 'function') {
            (ctx as any).hook('kernel:ready', async () => {
                // Materialize declared webhooks FIRST — this only needs the data
                // engine, so it must not be gated behind the auto-enqueue
                // dispatch prerequisites (realtime + messaging). Otherwise a
                // deployment without realtime would silently fail to materialize
                // declared webhooks — the very no-op this bridge closes (#3461).
                await this.bootDeclaredWebhooks(ctx);
                await this.bootAutoEnqueue(ctx, autoEnqueueOpt);
                this.registerAdminRoutes(ctx);
            });
        }

        ctx.logger.info?.('[webhook-outbox] initialised (delivery via shared messaging HTTP outbox)', {
            autoEnqueue: autoEnqueueOpt !== false,
        });
    }

    async dispose(): Promise<void> {
        await this.autoEnqueuer?.stop();
        if (this.boundEngine) {
            try { unbindWebhookProvenanceStamp(this.boundEngine); } catch { /* best effort */ }
            this.boundEngine = undefined;
        }
    }

    private getMessaging(ctx: PluginContext): MessagingHttpSurface | undefined {
        const svc = this.tryGetService<MessagingHttpSurface>(ctx, ['messaging']);
        return svc && typeof svc.enqueueHttp === 'function' ? svc : undefined;
    }

    /**
     * [#3461] Bridge the declarative authoring surface to the dispatcher:
     * materialize stack/connector-declared `webhook` metadata into `sys_webhook`
     * rows so the auto-enqueuer (and the Studio UI) can see them.
     *
     * Gated on the DATA ENGINE alone — deliberately independent of the
     * auto-enqueue dispatch prerequisites (realtime + messaging). Materializing
     * rows is a pure write; a deployment that mounts the webhook plugin without
     * realtime must still get its declared webhooks into the table (and the
     * Setup UI), even if nothing dispatches them yet. Runs before
     * {@link bootAutoEnqueue} so the enqueuer's first cache refresh sees the rows.
     */
    private async bootDeclaredWebhooks(ctx: PluginContext): Promise<void> {
        const engine = this.tryGetService<IDataEngine>(ctx, ['objectql', 'data']);
        if (!engine) {
            ctx.logger.warn?.('[webhook] declared-webhook bootstrap skipped — no data engine available');
            return;
        }
        // Bind the provenance stamp so an admin edit freezes a seeded row.
        this.boundEngine = engine;
        bindWebhookProvenanceStamp(engine as any, ctx.logger as any);
        let metadataService: IMetadataService | undefined;
        try { metadataService = ctx.getService<IMetadataService>('metadata'); } catch { /* optional */ }
        try {
            await bootstrapDeclaredWebhooks(engine, metadataService, ctx.logger as any);
        } catch (err: any) {
            ctx.logger.warn?.('[webhook] declared-webhook bootstrap failed (dispatcher still serves admin rows)', {
                error: err?.message ?? String(err),
            });
        }
        // [#7799] Then heal the rows the seeder cannot touch. Package rows are
        // rewritten above; `managed_by: 'admin'` and `customized: true` rows are
        // deliberately frozen against re-seeding, and those are precisely the
        // ones holding hand-authored production keys in cleartext. Runs AFTER
        // the seeder so a row it just rewrote is already secret-free and the
        // sweep is a no-op on it.
        try {
            await migrateLegacyWebhookSecrets(engine, ctx.logger as any);
        } catch (err: any) {
            ctx.logger.warn?.('[webhook] legacy signing-secret sweep failed (rows left unchanged)', {
                error: err?.message ?? String(err),
            });
        }
    }

    private async bootAutoEnqueue(
        ctx: PluginContext,
        opt: boolean | AutoEnqueuerOptions,
    ): Promise<void> {
        if (opt === false) return;
        const engine = this.tryGetService<IDataEngine>(ctx, ['objectql', 'data']);
        const realtime = this.tryGetService<IRealtimeService>(ctx, ['realtime']);
        const messaging = this.getMessaging(ctx);
        if (!engine || !realtime || !messaging) {
            ctx.logger.warn?.(
                '[webhook-auto-enqueuer] disabled — ObjectQL, Realtime, or Messaging service not available',
                { hasEngine: !!engine, hasRealtime: !!realtime, hasMessaging: !!messaging },
            );
            return;
        }
        if (!messaging.isHttpDeliveryReady()) {
            ctx.logger.warn?.(
                '[webhook-auto-enqueuer] messaging HTTP outbox not ready (no data engine / reliableDelivery off) — webhook deliveries will not be durable',
            );
        }

        const enqOpts = (typeof opt === 'object' ? opt : {}) as AutoEnqueuerOptions;
        this.autoEnqueuer = new AutoEnqueuer(
            engine,
            realtime,
            (input) => messaging.enqueueHttp(input),
            { ...enqOpts, logger: ctx.logger },
        );
        await this.autoEnqueuer.start();
        ctx.registerService('webhook.autoEnqueuer', this.autoEnqueuer);
        ctx.logger.info?.('[webhook-auto-enqueuer] started (enqueues source=webhook onto sys_http_delivery)');
    }

    private tryGetService<T>(ctx: PluginContext, names: string[]): T | undefined {
        for (const n of names) {
            try {
                const svc = ctx.getService<T>(n);
                if (svc) return svc;
            } catch {
                // fall through
            }
        }
        return undefined;
    }

    /**
     * Mount POST /api/v1/webhooks/redeliver on the host Hono app, if one is
     * available. Delegates to `messaging.redeliverHttp(deliveryId)`. Auth is the
     * better-auth session cookie — every authenticated user counts.
     */
    private registerAdminRoutes(ctx: PluginContext): void {
        const http = this.tryGetService<any>(ctx, ['http-server']);
        if (!http || typeof http.getRawApp !== 'function') {
            ctx.logger.debug?.('[webhook-outbox] HTTP server not available; redeliver endpoint not mounted');
            return;
        }
        const rawApp = http.getRawApp();
        const messaging = this.getMessaging(ctx);
        if (!rawApp || !messaging) return;

        rawApp.post('/api/v1/webhooks/redeliver', async (c: any) => {
            const userId = await this.resolveSessionUserId(ctx, c);
            if (!userId) {
                return c.json(
                    { success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to redeliver webhook deliveries.' } },
                    401,
                );
            }
            let body: any;
            try {
                body = await c.req.json();
            } catch {
                return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Request body must be JSON.' } }, 400);
            }
            const deliveryId = typeof body?.deliveryId === 'string' ? body.deliveryId.trim() : '';
            if (!deliveryId) {
                return c.json(
                    { success: false, error: { code: 'MISSING_REQUIRED_FIELD', message: 'Body must include `deliveryId: string`.' } },
                    400,
                );
            }
            try {
                const row = await messaging.redeliverHttp(deliveryId);
                ctx.logger.info?.('[webhook-outbox] redelivered', { deliveryId, requestedBy: userId });
                return c.json({ success: true, data: { id: row.id, status: row.status } });
            } catch (err: any) {
                const code = err?.code;
                if (code === 'RESOURCE_NOT_FOUND') {
                    return c.json({ success: false, error: { code, message: err.message } }, 404);
                }
                if (code === 'DELIVERY_NOT_ELIGIBLE') {
                    return c.json({ success: false, error: { code, message: err.message } }, 409);
                }
                ctx.logger.error?.('[webhook-outbox] redeliver failed', err as Error);
                return c.json(
                    { success: false, error: { code: 'INTERNAL_ERROR', message: err?.message ?? String(err) } },
                    500,
                );
            }
        });

        ctx.logger.info?.('[webhook-outbox] redeliver endpoint mounted at POST /api/v1/webhooks/redeliver');
    }

    private async resolveSessionUserId(ctx: PluginContext, c: any): Promise<string | undefined> {
        try {
            const authService: any = this.tryGetService<any>(ctx, ['auth']);
            if (!authService) return undefined;
            let api: any = authService.api;
            if (!api && typeof authService.getApi === 'function') {
                api = await authService.getApi();
            }
            if (!api?.getSession) return undefined;
            const session = await api.getSession({ headers: c.req.raw.headers });
            const uid = session?.user?.id;
            return typeof uid === 'string' && uid.length > 0 ? uid : undefined;
        } catch {
            return undefined;
        }
    }
}
