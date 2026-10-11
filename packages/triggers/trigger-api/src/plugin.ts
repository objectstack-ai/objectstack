// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { ITriggerApiService } from '@objectstack/spec/contracts';
import { ApiTrigger } from './api-trigger.js';
import type { FlowTrigger, QueueServiceSurface } from './api-trigger.js';

/**
 * The slice of the automation engine this plugin needs. Declared structurally
 * so the plugin does not take a build dependency on
 * `@objectstack/service-automation`.
 */
interface AutomationTriggerRegistry {
    registerTrigger(trigger: FlowTrigger): void;
    unregisterTrigger?(type: string): void;
}

/** The slice of the Hono host server this plugin needs. */
interface HttpServerSurface {
    getRawApp(): {
        post(path: string, handler: (c: any) => Promise<unknown> | unknown): void;
    } | null;
}

/** Mount point for inbound hooks on the host HTTP server. */
export const HOOKS_PATH = '/api/v1/automation/hooks/:flowName/:hookId';

/**
 * [#22774] The service slot this plugin fills: `ITriggerApiService`
 * (`@objectstack/spec/contracts`). The key is the package's own name, the
 * name ADR-0041 §2 gives the trigger family, as the contract's docblock
 * declares it.
 */
const TRIGGER_API_SLOT = 'trigger-api';

/**
 * [#22774] The slice of a Hono context the inbound-hook door reads and answers
 * through, and nothing more: the raw body as text, two request headers, and
 * `json(body, status)`.
 *
 * Both faces of the door hand {@link serveInboundHook} one of these. The
 * self-hosted mount hands it the real Hono context, so its answers are the ones
 * it always gave. The `trigger-api` service's `handleInboundHook` hands it
 * {@link requestDoorContext} over a web-standard `Request`. So both faces run
 * ONE copy of the door: one body read, one pair of header names, one
 * {@link ApiTrigger.handleRequest} (the hook match, the secret read, the
 * verifier and every status), and one way of answering.
 */
interface InboundHookDoorContext<R> {
    req: { text(): Promise<string>; header(name: string): string | undefined };
    json(body: unknown, status: number): R;
}

/**
 * [#22774] A web-standard `Request` as the door's context, answering the way
 * Hono's `c.json` answers: the body is `JSON.stringify(body)` and the one
 * header is `Content-Type: application/json`.
 *
 * The body is read with `request.text()`, which is what Hono's `c.req.text()`
 * reads (the raw request's own `text()`), so the verifier sees the bytes the
 * sender signed, read once and never re-serialised. A header is read as Hono's
 * `c.req.header(name)` reads it: `headers.get(name)`, absent as `undefined`.
 */
function requestDoorContext(request: Request): InboundHookDoorContext<Response> {
    return {
        req: {
            text: () => request.text(),
            header: (name) => request.headers.get(name) ?? undefined,
        },
        json: (body, status) => new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        }),
    };
}

/**
 * [#22774] The inbound-hook door, `POST /api/v1/automation/hooks/:flowName/:hookId`,
 * ONE body behind two faces: the self-hosted raw-app mount, and the
 * `trigger-api` service's transport-neutral `handleInboundHook`. Neither face
 * carries a rule of its own, so they cannot drift: the same hook match, the
 * same per-hook secret, the same constant-time verifier before anything is
 * enqueued, and the same answer for every outcome.
 *
 * The path parameters arrive as `hook`, from the route each face matched, and
 * are never re-parsed from a URL. The mount is not a caller of the member, and
 * nothing here mounts anything.
 */
async function serveInboundHook<R>(
    trigger: ApiTrigger,
    c: InboundHookDoorContext<R>,
    hook: { readonly flowName: string; readonly hookId: string },
): Promise<R> {
    const rawBody = await c.req.text();
    const out = await trigger.handleRequest({
        flowName: hook.flowName,
        hookId: hook.hookId,
        rawBody,
        signatureHeader: c.req.header('x-objectstack-signature'),
        idempotencyKey: c.req.header('x-idempotency-key') || undefined,
    });
    return c.json(out.body, out.status);
}

/**
 * ApiTriggerPlugin (ADR-0041 Tier 1)
 *
 * Makes `type: 'api'` flows actually fire. The automation engine derives an
 * `api` binding from the flow; this plugin provides the concrete trigger:
 *
 *  - mounts `POST /api/v1/automation/hooks/:flowName/:hookId` on the host
 *    Hono app (resolved via the `http.server` service, then its deprecated
 *    `http-server` alias);
 *  - [#22774] registers the `trigger-api` service, whose
 *    `handleInboundHook(request, hook)` serves the same door from a
 *    web-standard `Request`, for a kernel with no raw app;
 *  - validates hookId + HMAC signature (`x-objectstack-signature`,
 *    GitHub/Stripe style, constant-time) against the flow's start-node
 *    config;
 *  - **enqueues** the payload (`queue` service) and ACKs 202 — flow
 *    execution happens on the queue consumer, never in-band with the
 *    inbound request (ADR-0041 §5: boundary triggers must not let a slow
 *    flow drop or block events). `x-idempotency-key` passes through to the
 *    queue's dedup window.
 *
 * Webhook payloads surface to the flow as the trigger record (`$record` /
 * `record.*` / bare field references) — the same authoring surface
 * record-change flows use.
 */
export class ApiTriggerPlugin implements Plugin {
    name = 'com.objectstack.trigger.api';
    type = 'standard' as const;
    version = '1.0.0';
    dependencies = ['com.objectstack.service.queue'];

    async init(ctx: PluginContext): Promise<void> {
        ctx.logger.info('API trigger plugin initialized');
    }

    async start(ctx: PluginContext): Promise<void> {
        // Resolve at kernel:ready — the automation engine, queue service, and
        // HTTP server may all start after this plugin.
        ctx.hook('kernel:ready', async () => {
            const automation = this.resolveService<AutomationTriggerRegistry>(ctx, 'automation');
            if (!automation || typeof automation.registerTrigger !== 'function') {
                ctx.logger.warn(
                    'ApiTriggerPlugin: automation service not available — api trigger NOT installed, '
                        + 'and the trigger-api service not registered',
                );
                return;
            }
            if (!this.resolveService<QueueServiceSurface>(ctx, 'queue')) {
                ctx.logger.warn('ApiTriggerPlugin: queue service not available — inbound posts will 503 until one is registered');
            }

            const trigger = new ApiTrigger(
                () => this.resolveService<QueueServiceSurface>(ctx, 'queue'),
                ctx.logger,
            );
            automation.registerTrigger(trigger);

            // [#22774] The `trigger-api` service, registered wherever the
            // trigger is: where no trigger is installed the slot stays empty,
            // and the member's caller answers its typed absence (the
            // contract's rule), just as no route is mounted here then.
            const service: ITriggerApiService = {
                handleInboundHook: (request, hook) => serveInboundHook(trigger, requestDoorContext(request), hook),
            };
            ctx.registerService(TRIGGER_API_SLOT, service);

            // [#22774] The server is read as `http.server` first, then the
            // deprecated `http-server` alias, as `plugin-webhooks` and
            // `plugin-approvals` read it. The canonical name is the only one
            // present on every provider path: `runtime.ts`'s `config.server`
            // path registers no alias, so an alias-only read never mounted the
            // door there. `resolveService` asks each name in its own `try`,
            // because `getService` throws on an empty slot. Where both names
            // are registered (`plugin-hono-server` registers one server under
            // both), the first answers, so the path is mounted once.
            const http = this.resolveService<HttpServerSurface>(ctx, 'http.server')
                ?? this.resolveService<HttpServerSurface>(ctx, 'http-server');
            const rawApp = http && typeof http.getRawApp === 'function' ? http.getRawApp() : null;
            if (!rawApp) {
                ctx.logger.warn(
                    'ApiTriggerPlugin: HTTP server not available — hooks endpoint not mounted '
                        + '(the trigger-api service still serves it to a caller that forwards the request)',
                );
                return;
            }
            rawApp.post(HOOKS_PATH, async (c: any) => serveInboundHook(trigger, c, {
                flowName: c.req.param('flowName'),
                hookId: c.req.param('hookId'),
            }));
            ctx.logger.info(`ApiTriggerPlugin: api trigger registered, hooks mounted at POST ${HOOKS_PATH}`);
        });
    }

    private resolveService<T>(ctx: PluginContext, name: string): T | null {
        try {
            return ctx.getService<T>(name) ?? null;
        } catch {
            return null;
        }
    }
}
