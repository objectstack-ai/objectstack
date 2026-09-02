// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
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
 * ApiTriggerPlugin (ADR-0041 Tier 1)
 *
 * Makes `type: 'api'` flows actually fire. The automation engine derives an
 * `api` binding from the flow; this plugin provides the concrete trigger:
 *
 *  - mounts `POST /api/v1/automation/hooks/:flowName/:hookId` on the host
 *    Hono app (resolved via the `http-server` service);
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
                ctx.logger.warn('ApiTriggerPlugin: automation service not available — api trigger NOT installed');
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

            const http = this.resolveService<HttpServerSurface>(ctx, 'http-server');
            const rawApp = http && typeof http.getRawApp === 'function' ? http.getRawApp() : null;
            if (!rawApp) {
                ctx.logger.warn('ApiTriggerPlugin: HTTP server not available — hooks endpoint not mounted');
                return;
            }
            rawApp.post(HOOKS_PATH, async (c: any) => {
                const rawBody = await c.req.text();
                const out = await trigger.handleRequest({
                    flowName: c.req.param('flowName'),
                    hookId: c.req.param('hookId'),
                    rawBody,
                    signatureHeader: c.req.header('x-objectstack-signature'),
                    idempotencyKey: c.req.header('x-idempotency-key') || undefined,
                });
                return c.json(out.body, out.status);
            });
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
