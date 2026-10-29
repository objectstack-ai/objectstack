// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
// ADR-0069 — the authentication-policy gate's ONE decision, asked by the
// redeliver door on the session it already reads (see `serveRedeliver`).
import { evaluateAuthGate, type RequestAuthService } from '@objectstack/core';
import type {
    AuthSessionApi,
    IDataEngine,
    II18nService,
    IMetadataService,
    IRealtimeService,
    ISecurityService,
    IWebhookService,
} from '@objectstack/spec/contracts';
import {
    canDecideRedeliverEntitlement,
    judgeRedeliverEntitlement,
    redeliverTenancyResolver,
} from './redeliver-entitlement.js';
import type { EnqueueHttpInput } from '@objectstack/service-messaging';
import { inProcessSessionReadInput } from '@objectstack/types';
import { AutoEnqueuer, type AutoEnqueuerOptions } from './auto-enqueuer.js';

/** What the auth service's in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;
import { SysWebhook } from './sys-webhook.object.js';
import {
    DeclaredWebhookSource,
    DECLARED_WEBHOOK_NAME_GUARD_PACKAGE,
    bindDeclaredWebhookNameGuard,
    readDeclaredWebhookNames,
} from './declared-webhooks.js';
import { migrateLegacyWebhookSecrets } from './migrate-webhook-secrets.js';
import { createWebhookRedeliverGuard } from './redeliver-guard.js';
import { bindWebhookProvenanceStamp, unbindWebhookProvenanceStamp } from './webhook-provenance.js';
import {
    bindWebhookHeadersShapeGate,
    unbindWebhookHeadersShapeGate,
} from './webhook-headers-gate.js';
import {
    bindWebhookLegacyCleartextGate,
    unbindWebhookLegacyCleartextGate,
} from './webhook-legacy-cleartext.js';

/**
 * Structural view of `@objectstack/service-messaging`'s HTTP-outbox surface
 * (ADR-0018 M3) — declared locally so this plugin doesn't take a hard runtime
 * import on the service. Webhook deliveries are enqueued onto the shared
 * `sys_http_delivery` outbox and drained by the messaging `HttpDispatcher`.
 */
interface MessagingHttpSurface {
    isHttpDeliveryReady(): boolean;
    enqueueHttp(input: EnqueueHttpInput): Promise<string>;
    /**
     * [#10740] Takes the REQUESTING caller's organization. Declared with the
     * required-but-nullable `tenantId` the service declares, so this plugin
     * cannot call the endpoint's backing method without deciding what tenant
     * the request carries — the omission this structural view would otherwise
     * type-check happily.
     */
    redeliverHttp(
        id: string,
        options: { tenantId: string | undefined },
    ): Promise<{ id: string; status: string }>;
    /**
     * [#8069] Where this plugin's veto over redelivering `source: 'webhook'`
     * rows is installed. Declared REQUIRED on this structural view even though
     * the import is type-only: a messaging build without it cannot enforce the
     * refusal, and {@link WebhookOutboxPlugin.installRedeliverGuard} says so at
     * `error` rather than arming the endpoint with a guarantee nothing keeps.
     */
    registerRedeliverGuard(
        source: string,
        guard: (row: { source: string; refId: string }) => Promise<string | undefined>,
    ): void;
}

/**
 * [#22756] The service slot this plugin fills: `IWebhookService`
 * (`@objectstack/spec/contracts`), named after the plugin's platform
 * capability token, as the contract's docblock declares it.
 */
const WEBHOOKS_SLOT = 'webhooks';

/**
 * [ADR-0131 D6 regime C] The service slot the declared-webhook reader is bound
 * to (`DeclaredWebhookReader`), which the activation door
 * (`POST /api/v1/security/_activation/webhook/:name`) asks whether a name is
 * declared — the reader the dispatcher and the redelivery veto use, so the
 * three cannot disagree. The sharing-rule door's `sharingRules` is the pattern.
 */
const DECLARED_WEBHOOKS_SLOT = 'declaredWebhooks';

/**
 * [#22756] The slice of a Hono context the redeliver door reads and answers
 * through, and nothing more: the request's headers (the caller's credentials),
 * its JSON body, and `json(body, status)`.
 *
 * Both faces of the door hand {@link WebhookOutboxPlugin.serveRedeliver} one of
 * these. The self-hosted mount hands it the real Hono context, so its answers
 * are the ones it always gave. The `webhooks` service's `handleRedeliver` hands
 * it {@link requestDoorContext} over a web-standard `Request`. So both faces run
 * ONE copy of the door's rules: who may press it, whose rows it reaches, and
 * what each refusal answers.
 */
interface RedeliverDoorContext<R> {
    req: { raw: { headers: Headers }; json(): Promise<any> };
    json(body: unknown, status?: number): R;
}

/**
 * [#22756] A web-standard `Request` as the door's context, answering the way
 * Hono's `c.json` answers: the body is `JSON.stringify(body)`, the one header is
 * `Content-Type: application/json`, and the status defaults to `200`.
 *
 * The body is read with `request.json()`, which parses exactly what Hono's
 * `c.req.json()` parses (the body's text, then `JSON.parse`), so a body that is
 * not JSON is refused the same way at both faces.
 */
function requestDoorContext(request: Request): RedeliverDoorContext<Response> {
    return {
        req: { raw: request, json: () => request.json() },
        json: (body, status) => new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        }),
    };
}

/**
 * [#24910] Which of the auto-enqueuer's three prerequisites this kernel holds:
 * the data engine (it reads the subscriptions), the realtime service (its ONLY
 * source of record events — nothing else feeds it) and messaging (the outbox
 * it enqueues onto). Read once, at `kernel:ready`, when every plugin's
 * `init()` has registered its services, so an absence is final.
 */
interface AutoEnqueueGap {
    readonly hasEngine: boolean;
    readonly hasRealtime: boolean;
    readonly hasMessaging: boolean;
}

/** What the auto-enqueuer runs with on this kernel, decided once at `kernel:ready`. */
type AutoEnqueueWiring =
    /** The host turned it off itself (`autoEnqueue: false`) — deliberate, nothing to report. */
    | { readonly kind: 'off' }
    | {
        readonly kind: 'ready';
        readonly engine: IDataEngine;
        readonly realtime: IRealtimeService;
        readonly messaging: MessagingHttpSurface;
    }
    | { readonly kind: 'gap'; readonly gap: AutoEnqueueGap };

/**
 * [#24910] Why the auto-enqueuer is not running, and the composition change
 * that starts it, as one sentence: the reason and the fix the boot report owes
 * (AGENTS.md "Degradation log levels").
 */
function autoEnqueueGapReason(gap: AutoEnqueueGap): string {
    const missing: string[] = [];
    const fixes: string[] = [];
    if (!gap.hasRealtime) {
        missing.push('the realtime service (the only source of the record events it dispatches)');
        fixes.push("add 'realtime' to `requires`");
    }
    if (!gap.hasMessaging) {
        missing.push('the messaging service (the outbox it enqueues onto)');
        fixes.push("add 'messaging' to `requires` (a `--preset minimal` boot mounts none of the always-on capabilities)");
    }
    if (!gap.hasEngine) {
        missing.push('the ObjectQL data engine (it reads the subscriptions)');
        fixes.push('mount the ObjectQL data engine');
    }
    return `the webhook auto-enqueuer is disabled because ${missing.join(' and ')} `
        + `${missing.length === 1 ? 'is' : 'are'} not available. Fix: ${fixes.join('; ')}, then restart.`;
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
 *   - the redeliver door: the self-hosted `POST /api/v1/webhooks/redeliver`
 *     mount, and the `webhooks` service's transport-neutral `handleRedeliver`
 *     (`IWebhookService`), which serve one set of rules.
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
    /** [ADR-0131 D2/D6] The declared-webhook reader, bound once the data engine is known. */
    private declaredSource: DeclaredWebhookSource | undefined;

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
                // The table's write doors, the legacy-secret sweep and the
                // declared-webhook reader FIRST — this only needs the data
                // engine, so it must not be gated behind the auto-enqueue
                // dispatch prerequisites (realtime + messaging).
                await this.bootWebhookTable(ctx);
                // [#22756] The redelivery veto, and beside it the `webhooks`
                // service — gated on the engine and messaging alone, like the
                // step above, and never on the auto-enqueue prerequisites. It
                // runs before the enqueuer writes its first row (#8069), and
                // before the mount below is mounted.
                const servedAsService = this.bootRedeliverDoor(ctx, autoEnqueueOpt);
                await this.bootAutoEnqueue(ctx, autoEnqueueOpt);
                const mounted = this.registerAdminRoutes(ctx);
                if (servedAsService || mounted) this.reportRedeliverEntitlementDecider(ctx);
            });
        }

        ctx.logger.info?.('[webhook-outbox] initialised (delivery via shared messaging HTTP outbox)', {
            autoEnqueue: autoEnqueueOpt !== false,
        });
    }

    /**
     * Teardown — the kernel's ONLY teardown hook.
     *
     * [#10772] This body used to be spelled `dispose()`. `Plugin`
     * (`@objectstack/core`'s `types.ts`) declares `init()`, `start?(ctx)` and
     * `destroy?()` and no `dispose()`, and `ObjectKernel.performShutdown()` /
     * `LiteKernel.destroy()` walk the plugins in reverse calling
     * `plugin.destroy()` — so after `await kernel.shutdown()` had RESOLVED the
     * auto-enqueuer was still running and both engine hooks were still bound.
     * Measured on the same revision: `dispose()` had ZERO callers anywhere in
     * the repo, so this teardown had never run in any process at all.
     *
     * Idempotent: `boundEngine` is cleared as it is unbound, so a second
     * teardown is a no-op rather than a second unbind.
     */
    async destroy(): Promise<void> {
        await this.autoEnqueuer?.stop();
        if (this.boundEngine) {
            try { unbindWebhookProvenanceStamp(this.boundEngine); } catch { /* best effort */ }
            try { unbindWebhookHeadersShapeGate(this.boundEngine); } catch { /* best effort */ }
            try { unbindWebhookLegacyCleartextGate(this.boundEngine); } catch { /* best effort */ }
            try { (this.boundEngine as any).unregisterHooksByPackage?.(DECLARED_WEBHOOK_NAME_GUARD_PACKAGE); } catch { /* best effort */ }
            this.boundEngine = undefined;
        }
    }

    /**
     * Retained alias for {@link destroy}. Kept because it is public API of an
     * exported class: an embedder may have learned to call it directly
     * precisely BECAUSE the kernel never did, and deleting it would break them.
     * Same signature, same return type — a direct caller sees no change.
     */
    async dispose(): Promise<void> {
        await this.destroy();
    }

    private getMessaging(ctx: PluginContext): MessagingHttpSurface | undefined {
        const svc = this.tryGetService<MessagingHttpSurface>(ctx, ['messaging']);
        return svc && typeof svc.enqueueHttp === 'function' ? svc : undefined;
    }

    /**
     * The `sys_webhook` table's write doors, its legacy-secret sweep, and the
     * declared-webhook reader.
     *
     * [ADR-0131 D2, D6] Declared webhooks are no longer materialized: the boot
     * seeder (`bootstrapDeclaredWebhooks`) is retired, a fresh boot writes no
     * `sys_webhook` row for one, and the dispatcher, the redelivery veto and the
     * activation door read the declaration through one
     * {@link DeclaredWebhookSource}, bound here to the `declaredWebhooks` slot.
     * The ownership ceremony settles the 18.0 seeder's rows before a database
     * is certified; `declared-webhooks.ts` says how a row holding a declared
     * name is read.
     *
     * Gated on the DATA ENGINE alone — deliberately independent of the
     * auto-enqueue dispatch prerequisites (realtime + messaging): the write
     * doors, the sweep and the activation door serve on a kernel that
     * dispatches nothing. Runs before {@link bootAutoEnqueue}, which reads the
     * reader bound here.
     */
    private async bootWebhookTable(ctx: PluginContext): Promise<void> {
        const engine = this.tryGetService<IDataEngine>(ctx, ['objectql', 'data']);
        if (!engine) {
            ctx.logger.warn?.('[webhook] sys_webhook write doors and the declared-webhook reader not bound — no data engine available');
            return;
        }
        // Bind the provenance stamp so an admin edit of a seeded row is
        // recorded: the ownership ceremony keeps an edited copy as a clone
        // rather than deleting it (`webhook-provenance.ts`).
        this.boundEngine = engine;
        bindWebhookProvenanceStamp(engine as any, ctx.logger as any);
        // [#8566] And the headers_secret shape gate, BEFORE the sweep below
        // runs its first write — a validation door that arms after the first
        // write it is meant to judge is not a door. It covers every write path
        // at once (the generic data API included, which is the measured
        // trigger), so the plugin's own writers deliberately carry no second
        // check of their own.
        bindWebhookHeadersShapeGate(engine as any, ctx.logger as any);
        // And the retired credential location: a write that puts `secret` or
        // `headers` back into `definition_json` is refused at the door, since
        // the delivery path refuses such a row too. Bound before the sweep for
        // the same reason — it passes it by construction.
        bindWebhookLegacyCleartextGate(engine as any, ctx.logger as any);
        let metadataService: IMetadataService | undefined;
        try { metadataService = ctx.getService<IMetadataService>('metadata'); } catch { /* optional */ }
        this.declaredSource = new DeclaredWebhookSource(engine, metadataService, ctx.logger as any);
        ctx.registerService(DECLARED_WEBHOOKS_SLOT, this.declaredSource);
        // And the declared-name guard: a row that took a declared name would
        // withhold the declaration for the whole deployment, so no non-system
        // write may take one (409 `RESOURCE_CONFLICT`).
        bindDeclaredWebhookNameGuard(engine as any, this.declaredSource);
        // [#7799] Then heal the rows that still hold a key in cleartext — the
        // rows the ownership ceremony leaves: authored ones, clones, and seeded
        // rows no package declares.
        try {
            await migrateLegacyWebhookSecrets(engine, ctx.logger as any);
        } catch (err: any) {
            ctx.logger.warn?.('[webhook] legacy signing-secret sweep failed (rows left unchanged)', {
                error: err?.message ?? String(err),
            });
        }
    }

    /**
     * [#24910] What the auto-enqueuer runs with on this kernel: off by the
     * host's own choice, ready with its three prerequisites, or missing some of
     * them. Read at `kernel:ready` — every `init()` has registered its services
     * by then, so a missing one is a fact of this composition, not a boot that
     * has not finished.
     */
    private resolveAutoEnqueueWiring(
        ctx: PluginContext,
        opt: boolean | AutoEnqueuerOptions,
    ): AutoEnqueueWiring {
        if (opt === false) return { kind: 'off' };
        const engine = this.tryGetService<IDataEngine>(ctx, ['objectql', 'data']);
        const realtime = this.tryGetService<IRealtimeService>(ctx, ['realtime']);
        const messaging = this.getMessaging(ctx);
        if (engine && realtime && messaging) return { kind: 'ready', engine, realtime, messaging };
        return { kind: 'gap', gap: { hasEngine: !!engine, hasRealtime: !!realtime, hasMessaging: !!messaging } };
    }

    /**
     * [#24910] Say once that the auto-enqueuer is not running — at `error` when
     * the stack DECLARES webhooks, `warn` when it declares none.
     *
     * By AGENTS.md's one question (Degradation log levels): with declarations
     * present the system looks normal from outside — every record write answers
     * 200, the declaration says the webhook is active — while not one delivery
     * it claims is ever enqueued. That is the durability class, so the line
     * owes the consequence and the fix, and says it here, once, before any
     * write rather than once per lost event. With nothing declared the kernel
     * is visibly smaller than it could be (no webhook to lose yet), which is the
     * functional class: `warn`, as before.
     */
    private reportAutoEnqueueGap(ctx: PluginContext, gap: AutoEnqueueGap): void {
        const declared = readDeclaredWebhookNames(
            this.tryGetService<IDataEngine>(ctx, ['objectql', 'data']),
            this.tryGetService<IMetadataService>(ctx, ['metadata']),
        );
        if (declared.length > 0) {
            ctx.logger.error?.(
                `[webhook-auto-enqueuer] the ${declared.length} webhook${declared.length === 1 ? '' : 's'} this stack `
                    + `declares (${declared.join(', ')}) will NEVER be delivered: record writes still succeed and nothing `
                    + `else reports the loss, but no delivery is ever enqueued — ${autoEnqueueGapReason(gap)}`,
                undefined,
                { ...gap, declared },
            );
            return;
        }
        ctx.logger.warn?.(
            '[webhook-auto-enqueuer] disabled — ObjectQL, Realtime, or Messaging service not available',
            { ...gap },
        );
    }

    private async bootAutoEnqueue(
        ctx: PluginContext,
        opt: boolean | AutoEnqueuerOptions,
    ): Promise<void> {
        const wiring = this.resolveAutoEnqueueWiring(ctx, opt);
        if (wiring.kind === 'off') return;
        if (wiring.kind === 'gap') {
            this.reportAutoEnqueueGap(ctx, wiring.gap);
            return;
        }
        const { engine, realtime, messaging } = wiring;
        if (!messaging.isHttpDeliveryReady()) {
            ctx.logger.warn?.(
                '[webhook-auto-enqueuer] messaging HTTP outbox not ready (no data engine / reliableDelivery off) — webhook deliveries will not be durable',
            );
        }

        const enqOpts = (typeof opt === 'object' ? opt : {}) as AutoEnqueuerOptions;
        // [#8069] The redelivery veto is already installed: `bootRedeliverDoor`
        // ran first, so no delivery row can ever exist while the refusal that
        // protects it does not. [#22756] It is installed THERE, and not here,
        // because this function returns early without realtime or with
        // `autoEnqueue: false`, and the door serves on those kernels too.
        this.autoEnqueuer = new AutoEnqueuer(
            engine,
            realtime,
            (input) => messaging.enqueueHttp(input),
            {
                ...enqOpts,
                ...(this.declaredSource ? { declaredWebhooks: this.declaredSource } : {}),
                logger: ctx.logger,
            },
        );
        await this.autoEnqueuer.start();
        ctx.registerService('webhook.autoEnqueuer', this.autoEnqueuer);
        ctx.logger.info?.('[webhook-auto-enqueuer] started (enqueues source=webhook onto sys_http_delivery)');
    }

    /**
     * [#22756] Install the #8069 redelivery veto, and register the `webhooks`
     * service beside it.
     *
     * The veto needs the data engine (it reads the subscription) and messaging
     * (it is installed there). It does NOT need realtime or auto-enqueue: it
     * judges a row being REPLAYED, and a row can be replayed on a kernel that
     * enqueues nothing. It used to be installed inside {@link bootAutoEnqueue},
     * which returns early without realtime or with `autoEnqueue: false`, so on
     * those kernels the door served while the veto was never installed.
     *
     * The service is registered only once the veto is installed, so no kernel
     * serves `handleRedeliver` without it. Where the veto cannot be installed
     * the slot stays empty, and the member's caller answers its typed absence
     * (the contract's rule) rather than a door with no veto.
     *
     * `subscriptionsObject` is read from the auto-enqueue options, as before,
     * so a host that renamed its subscriptions object keeps the veto reading it.
     *
     * Returns whether the `webhooks` service was registered (the door's
     * service face is served).
     */
    private bootRedeliverDoor(ctx: PluginContext, opt: boolean | AutoEnqueuerOptions): boolean {
        const engine = this.tryGetService<IDataEngine>(ctx, ['objectql', 'data']);
        const messaging = this.getMessaging(ctx);
        if (!engine || !messaging) {
            ctx.logger.warn?.(
                '[webhook-outbox] redeliver veto not installed and the webhooks service not registered '
                    + '— the data engine or the messaging service is not available',
                { hasEngine: !!engine, hasMessaging: !!messaging },
            );
            return false;
        }
        const subscriptionsObject = typeof opt === 'object' ? opt.subscriptionsObject : undefined;
        if (!this.installRedeliverGuard(ctx, messaging, engine, subscriptionsObject)) return false;

        const service: IWebhookService = {
            handleRedeliver: (request: Request) =>
                this.serveRedeliver(ctx, messaging, requestDoorContext(request)),
        };
        ctx.registerService(WEBHOOKS_SLOT, service);
        return true;
    }

    /**
     * Absence must be loud: a redeliver door that is served (on either face)
     * on a kernel with no security service to decide webhook administration
     * answers `503 SERVICE_UNAVAILABLE` to EVERY caller
     * ({@link judgeRedeliverEntitlement}). Said once, at `kernel:ready` — after
     * every plugin's `init()` and `start()`, so the registry this reads is
     * complete — naming the remedy, rather than left to be discovered one
     * request at a time in the server log.
     *
     * `warn`, not `error`, by AGENTS.md's one question: the door is visibly
     * unavailable (every press answers 503 with the remedy), and nothing that
     * claims to persist goes missing. The door still decides per request, so a
     * security service that is present answers as usual whatever this said.
     */
    private reportRedeliverEntitlementDecider(ctx: PluginContext): void {
        const security = this.tryGetService<unknown>(ctx, ['security']);
        if (canDecideRedeliverEntitlement(security)) return;
        ctx.logger.warn?.(
            '[webhook-outbox] no security service is registered to decide who may administer webhooks, '
                + 'so the redeliver door (POST /api/v1/webhooks/redeliver and the webhooks service\'s '
                + 'handleRedeliver) answers 503 SERVICE_UNAVAILABLE to every caller. Fix: compose the '
                + 'security plugin (@objectstack/plugin-security).',
            { hasSecurityService: security !== undefined },
        );
    }

    /**
     * [#8069] Register {@link createWebhookRedeliverGuard} with messaging, so
     * `redeliver()` refuses a webhook row whose signing configuration is no
     * longer available — for EVERY caller, not just the
     * `POST /api/v1/webhooks/redeliver` route.
     *
     * Absence is loud, and `error` is the right level by AGENTS.md's one
     * question: with no guard installed the endpoint still answers 200 and the
     * dispatcher still reports a delivery, while the fail-closed signing
     * guarantee the system claims (#7799) is not actually being kept. That is a
     * durability/consistency degradation wearing a functional one's clothes.
     *
     * [#22756] Returns whether the guard is installed: the `webhooks` service
     * is registered only when it is.
     */
    private installRedeliverGuard(
        ctx: PluginContext,
        messaging: MessagingHttpSurface,
        engine: IDataEngine,
        subscriptionsObject?: string,
    ): boolean {
        if (typeof messaging.registerRedeliverGuard !== 'function') {
            ctx.logger.error?.(
                '[webhook-outbox] messaging service exposes no registerRedeliverGuard() — redelivery '
                    + 'of a webhook whose signing configuration is gone CANNOT be refused, so an operator '
                    + 'pressing redeliver may send a delivery that can no longer be authenticated '
                    + '(an unsigned send, which webhook delivery otherwise never makes). The POST '
                    + '/api/v1/webhooks/redeliver endpoint is reachable by any '
                    + 'caller entitled to administer webhooks; the webhooks service is not registered. Fix: upgrade '
                    + '@objectstack/service-messaging to a build that implements registerRedeliverGuard.',
            );
            return false;
        }
        messaging.registerRedeliverGuard(
            'webhook',
            createWebhookRedeliverGuard(engine, subscriptionsObject, this.declaredSource),
        );
        ctx.logger.debug?.('[webhook-outbox] redeliver guard installed for source=webhook');
        return true;
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
     * available. The door itself is {@link serveRedeliver}, handed the Hono
     * context as it is, so the mount answers what it always answered.
     *
     * [#22756] The server is read as `http.server` first, then the deprecated
     * `http-server` alias, as `plugin-approvals` reads it. The canonical name
     * is the only one present on every provider path: `runtime.ts`'s
     * `config.server` path registers no alias, so an alias-only read never
     * mounted the door there. `tryGetService` asks each name in its own `try`,
     * because `getService` throws on an empty slot. Where both names are
     * registered (`plugin-hono-server` registers one server under both), the
     * first answers, so the path is mounted once.
     *
     * Returns whether the path was mounted.
     */
    private registerAdminRoutes(ctx: PluginContext): boolean {
        const http = this.tryGetService<any>(ctx, ['http.server', 'http-server']);
        if (!http || typeof http.getRawApp !== 'function') {
            ctx.logger.debug?.('[webhook-outbox] HTTP server not available; redeliver endpoint not mounted');
            return false;
        }
        const rawApp = http.getRawApp();
        const messaging = this.getMessaging(ctx);
        if (!rawApp || !messaging) return false;

        rawApp.post('/api/v1/webhooks/redeliver', async (c: any) => this.serveRedeliver(ctx, messaging, c));

        ctx.logger.info?.('[webhook-outbox] redeliver endpoint mounted at POST /api/v1/webhooks/redeliver');
        return true;
    }

    /**
     * The redeliver door: `POST /api/v1/webhooks/redeliver`. Delegates to
     * `messaging.redeliverHttp(deliveryId, …)`. Auth is the better-auth session
     * cookie, and a signed-in caller must also be entitled to ADMINISTER
     * WEBHOOKS ({@link judgeRedeliverEntitlement}, `redeliver-entitlement.ts`):
     * asked right after authentication and before the body is read, so an
     * unentitled caller is answered `403` before any row-specific detail.
     *
     * [#22756] ONE body, two faces. The self-hosted mount
     * ({@link registerAdminRoutes}) hands it the Hono context; the `webhooks`
     * service's `handleRedeliver` hands it a `Request` through
     * {@link requestDoorContext}. Neither face carries a rule of its own, so
     * they cannot drift: the same caller, the same tenant, the same veto and
     * the same answer for every refusal. The mount is not a caller of the
     * member, and nothing here mounts anything.
     *
     * [#10740] Which is precisely why the caller's ACTIVE ORGANIZATION is
     * resolved here and threaded into the call. `sys_http_delivery` is
     * tenant-scoped, and this is the one door on it a request can reach: an
     * unscoped replay from here is an authenticated user reaching another
     * organization's delivery row on a walled deployment. With the tenant
     * threaded, a row outside the caller's organization is simply not found.
     * The tenant threaded is the organization the entitlement gate ADMITTED the
     * caller in (the composition's vetted `tenantId`), never the raw session
     * claim: on a walled posture a claim no current membership backs is
     * dropped there, and the gate refuses rather than replay with no scope.
     *
     * ⚠️ A session with no active organization threads `undefined`, and the
     * driver's tenant-audit line then fires for that write. That is deliberate:
     * the deployment could not tell us who is asking, and reporting the gap is
     * the correct outcome. ⛔ It is never repaired with `bypassTenantAudit`,
     * which would silence the report without closing anything.
     */
    private async serveRedeliver<R>(
        ctx: PluginContext,
        messaging: MessagingHttpSurface,
        c: RedeliverDoorContext<R>,
    ): Promise<R> {
        const session = await this.resolveSession(ctx, c);
        // ADR-0069 — a session the authentication policy HOLDS (an expired
        // password, enforced MFA not yet enrolled) is gated out of every
        // protected resource until it remediates, and replaying a delivery is
        // one. Asked first, as REST's `enforceAuth` asks it, on the session
        // this door reads once for everything below; the answer is REST's:
        // `403` with the gate's own `code` and `message`, in this door's
        // envelope. Both faces (the raw mount and `handleRedeliver`) pass here.
        //
        // No request path is passed: the allow-list exempts remediation and
        // bootstrap routes, this door is neither, and its service face has no
        // route of its own (the host chooses the URL), so a path would only
        // let a host's choice exempt it. An empty path earns no exemption.
        const gate = evaluateAuthGate(session?.user, '');
        if (gate) {
            return c.json({ success: false, error: { code: gate.code, message: gate.message } }, 403);
        }
        const userId = session?.user?.id;
        if (typeof userId !== 'string' || userId.length === 0) {
            return c.json(
                { success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to redeliver webhook deliveries.' } },
                401,
            );
        }
        // [ADR-0124 D1] Entitlement, server-side, before the body is read and
        // before any row is looked up: every refusal from here is about the
        // caller, never about a delivery.
        //
        // [#10740] `session.session.activeOrganizationId` is the canonical
        // spelling of the caller's active organization CLAIM (better-auth's
        // organization plugin; see `plugin-auth/auth-schema-config.ts`). Read
        // from the one place it lives — a `??` chain over alternative
        // spellings would make a MISSING organization indistinguishable from
        // a differently-shaped one, and the missing case is the one that must
        // stay visible. The gate vets it; the replay below uses the verdict's.
        const activeOrgClaim = session?.session?.activeOrganizationId;
        const verdict = await judgeRedeliverEntitlement({
            headers: c.req.raw.headers,
            ql: this.tryGetService<IDataEngine>(ctx, ['objectql', 'data']),
            authService: this.tryGetService<RequestAuthService>(ctx, ['auth']),
            tenancy: redeliverTenancyResolver(ctx),
            security: this.tryGetService<Pick<ISecurityService, 'explain'>>(ctx, ['security']),
            userId,
            activeOrganizationId: typeof activeOrgClaim === 'string' && activeOrgClaim.length > 0
                ? activeOrgClaim
                : undefined,
            logError: (message, err) => ctx.logger.error?.(message, err as Error),
        });
        if (!verdict.admitted) {
            const { refusal } = verdict;
            return c.json({ success: false, error: { code: refusal.code, message: refusal.message } }, refusal.status);
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
            // [#10740] The organization the gate admitted the caller in — the
            // composition's vetted `tenantId` — is the replay's scope.
            const tenantId = verdict.tenantId;
            const row = await messaging.redeliverHttp(deliveryId, { tenantId });
            ctx.logger.info?.('[webhook-outbox] redelivered', { deliveryId, requestedBy: userId, tenantId });
            return c.json({ success: true, data: { id: row.id, status: row.status } });
        } catch (err: any) {
            const code = err?.code;
            if (code === 'RESOURCE_NOT_FOUND') {
                return c.json({ success: false, error: { code, message: err.message } }, 404);
            }
            // [#8069] `DELIVERY_NEVER_SENT` is a refusal, not a server
            // fault: the row is a parked record of a delivery that was
            // never prepared, and re-sending it would be a FIRST delivery —
            // unsigned, because the secret that would have signed it is
            // what went missing. 409 alongside the eligibility refusal, so
            // an operator tool can present both the same way; without this
            // arm it would surface as a 500 and read as a transient glitch
            // worth retrying.
            if (code === 'DELIVERY_NOT_ELIGIBLE' || code === 'DELIVERY_NEVER_SENT') {
                return c.json({ success: false, error: { code, message: err.message } }, 409);
            }
            ctx.logger.error?.('[webhook-outbox] redeliver failed', err as Error);
            return c.json(
                { success: false, error: { code: 'INTERNAL_ERROR', message: err?.message ?? String(err) } },
                500,
            );
        }
    }

    /**
     * [#10740] The better-auth session envelope (`{ user, session }`) for this
     * request, or `undefined`.
     *
     * Widened from the previous `resolveSessionUserId` because the route now
     * needs two facts from ONE lookup: who is asking (`user.id`, the
     * authentication gate) and which organization they are asking as
     * (`session.activeOrganizationId`, the tenant threaded into the write).
     * Resolving them separately would mean two `getSession` calls that can
     * disagree.
     *
     * [#24222] Typed as `AuthSessionApi` declares the answer, not `any`: the
     * route's three reads (`user.id`, `user` for the posture gate,
     * `session.activeOrganizationId`) are all declared there.
     */
    private async resolveSession(ctx: PluginContext, c: any): Promise<SessionRead | null> {
        try {
            const authService: any = this.tryGetService<any>(ctx, ['auth']);
            if (!authService) return undefined;
            let api: any = authService.api;
            if (!api && typeof authService.getApi === 'function') {
                api = await authService.getApi();
            }
            if (!api?.getSession) return undefined;
            return await api.getSession(inProcessSessionReadInput(c.req.raw.headers));
        } catch {
            return undefined;
        }
    }
}
