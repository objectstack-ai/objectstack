// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { randomUUID } from 'node:crypto';
import type { AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';

/**
 * HTTP built-in node — canonical `http` (ADR-0018 M3) + deprecated aliases.
 *
 * `http` is the single outbound-callout verb the platform offers Flow, Workflow
 * Rules and Approval. It replaces the five divergent names (`http_request` /
 * `http_call` / `webhook` / …) which are kept as **deprecated aliases** of
 * `http` for back-compat (registered via {@link AutomationEngine.registerNodeAlias}).
 *
 * Two execution modes:
 *
 *  - **Durable (`config.durable: true`)** — fire-and-forget callout enqueued
 *    onto the `service-messaging` HTTP outbox (`sys_http_delivery`), inheriting
 *    retry / idempotency / dead-letter. The flow gets back `{ deliveryId }` and
 *    does NOT block on the response. This closes the "`http_request` is a bare
 *    fetch with no retry" reliability gap (ADR-0018 §4). When no messaging HTTP
 *    outbox is wired the node degrades to the inline call below.
 *
 *  - **Request/response (default)** — a synchronous `fetch()` returning
 *    `{ response, status }` to the flow, preserving the historical `http_request`
 *    behavior so existing flows that read the response keep working. (The ADR's
 *    `isAsync` suspend-and-resume variant is future work.)
 */

/** Structural view of `service-messaging`'s HTTP outbox surface (ADR-0018 M3). */
interface MessagingHttpSurface {
    isHttpDeliveryReady?(): boolean;
    enqueueHttp?(input: {
        source: string;
        refId: string;
        dedupKey: string;
        label?: string;
        url: string;
        method?: string;
        headers?: Record<string, string>;
        signingSecret?: string;
        timeoutMs?: number;
        payload: unknown;
    }): Promise<string>;
}

const HTTP_TYPE = 'http' as const;

export function registerHttpNodes(engine: AutomationEngine, ctx: PluginContext): void {
    const getMessaging = (): MessagingHttpSurface | undefined => {
        try {
            return ctx.getService<MessagingHttpSurface>('messaging');
        } catch {
            return undefined;
        }
    };

    engine.registerNodeExecutor({
        type: HTTP_TYPE,
        descriptor: defineActionDescriptor({
            type: HTTP_TYPE,
            version: '1.0.0',
            name: 'HTTP',
            description:
                'Call an external HTTP endpoint. With `durable: true`, the call is enqueued on the '
                + 'messaging outbox with retry / dead-letter; otherwise it runs inline and returns the response.',
            icon: 'globe',
            category: 'io',
            source: 'builtin',
            // Capable of outbox-backed durable delivery (used when durable:true
            // and the messaging HTTP outbox is wired).
            needsOutbox: true,
            supportsRetry: true,
            paradigms: ['flow', 'approval'],
            configSchema: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string', description: 'Target URL' },
                    method: { type: 'string', description: 'HTTP method (default GET; POST when durable)' },
                    headers: { type: 'object', description: 'Request headers' },
                    body: { description: 'Request body (JSON-serialised)' },
                    durable: {
                        type: 'boolean',
                        description: 'Fire-and-forget via the durable outbox (retry/dead-letter) instead of inline request/response',
                    },
                    timeoutMs: { type: 'number', description: 'Per-request timeout (ms)' },
                    signingSecret: { type: 'string', description: 'HMAC-SHA256 secret → X-Objectstack-Signature' },
                },
            },
        }),
        async execute(node, variables, context) {
            const raw = (node.config ?? {}) as Record<string, unknown>;
            const cfg = interpolate(raw, variables, context) as Record<string, unknown>;

            const url = cfg.url as string | undefined;
            if (!url) return { success: false, error: 'http: url is required' };

            const durable = cfg.durable === true;
            const headers = cfg.headers as Record<string, string> | undefined;
            const body = cfg.body;
            const timeoutMs = typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs : undefined;
            const signingSecret = cfg.signingSecret as string | undefined;

            // ── Durable mode: enqueue onto the messaging HTTP outbox ──────────
            if (durable) {
                const messaging = getMessaging();
                if (messaging?.isHttpDeliveryReady?.() && messaging.enqueueHttp) {
                    try {
                        const deliveryId = await messaging.enqueueHttp({
                            source: 'flow',
                            refId: node.id,
                            dedupKey: randomUUID(),
                            label: `flow:${node.id}`,
                            url,
                            method: (cfg.method as string) ?? 'POST',
                            headers,
                            signingSecret,
                            timeoutMs,
                            payload: body ?? {},
                        });
                        return { success: true, output: { deliveryId, enqueued: true } };
                    } catch (err) {
                        return { success: false, error: `http (durable) failed to enqueue: ${(err as Error).message}` };
                    }
                }
                // No outbox available — degrade to a best-effort inline call.
                ctx.logger.warn(
                    `[http] node '${node.id}' requested durable delivery but no messaging HTTP outbox is wired; falling back to inline fetch`,
                );
            }

            // ── Request/response mode (default; preserves http_request) ───────
            const method = (cfg.method as string) ?? 'GET';
            const controller = new AbortController();
            const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
            try {
                const response = await fetch(url, {
                    method,
                    headers,
                    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });
                const data = await readBody(response);
                return {
                    success: response.ok,
                    output: { response: data, status: response.status },
                    error: response.ok ? undefined : `HTTP ${response.status}`,
                };
            } catch (err) {
                const e = err as { name?: string; message?: string };
                const msg = e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e?.message ?? String(err);
                return { success: false, error: `http: ${msg}` };
            } finally {
                if (timer) clearTimeout(timer);
            }
        },
    });

    // ADR-0018 M3: collapse the divergent outbound verbs onto `http`. Old saved
    // flows / workflow rules / approval actions keep running via these aliases.
    engine.registerNodeAlias('http_request', HTTP_TYPE, { name: 'HTTP Request', needsOutbox: true });
    engine.registerNodeAlias('http_call', HTTP_TYPE, { name: 'HTTP Call', needsOutbox: true });
    engine.registerNodeAlias('webhook', HTTP_TYPE, { name: 'Webhook', needsOutbox: true });

    ctx.logger.info('[HTTP] http executor registered (+ deprecated aliases: http_request, http_call, webhook)');
}

/** Read a response body as JSON, falling back to text (empty body → null). */
async function readBody(response: { json(): Promise<unknown>; text(): Promise<string> }): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        try {
            const text = await response.text();
            return text || null;
        } catch {
            return null;
        }
    }
}
