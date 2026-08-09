// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, HttpConfigSchema } from '@objectstack/spec/automation';
import type { HttpConfigParsed } from '@objectstack/spec/automation';
import { randomUUID } from 'node:crypto';
import type { AutomationEngine } from '../engine.js';
import { refuseNode } from '../guard-refusal.js';
import { interpolate } from './template.js';
import { parseNodeConfig } from './parse-config.js';

/**
 * HTTP built-in node — canonical `http` (ADR-0018 M3).
 *
 * `http` is the single outbound-callout verb the platform offers Flow, Workflow
 * Rules and Approval. It supersedes the older divergent names (`http_request` /
 * `http_call` / `webhook`), which were removed in 11.0 — author `http`.
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
 *    suspend-and-resume variant is future work. ADR-0018 called it the `isAsync`
 *    path; that descriptor key was retired in #6748 — a suspending HTTP node
 *    would declare `supportsPause: true` plus a `resumeAuthority` and return
 *    `suspend: true`, which is the mechanism the engine actually enforces.)
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
            // Parsed AFTER interpolation — unique among the contract-carrying
            // builtins, because this executor reads the interpolated config
            // wholesale, so that is the shape its contract describes: a `{token}`
            // in a typed slot (`timeoutMs`, `durable`) resolves to the value's
            // real type before the contract sees it (whole-token interpolation
            // preserves types).
            const parsed = parseNodeConfig<HttpConfigParsed>('http', node.id, HttpConfigSchema, interpolate(raw, variables, context));
            if (!parsed.ok) return parsed.refusal;
            const cfg = parsed.config;

            const url = cfg.url;
            if (!url) return refuseNode('http: url is required');

            const durable = cfg.durable === true;
            const headers = cfg.headers;
            const body = cfg.body;
            const timeoutMs = cfg.timeoutMs;
            const signingSecret = cfg.signingSecret;

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
                            method: cfg.method ?? 'POST',
                            headers,
                            signingSecret,
                            timeoutMs,
                            payload: body ?? {},
                        });
                        // #4354 — the outbox row IS a durable effect this run
                        // caused, even though the upstream call happens later.
                        return { success: true, output: { deliveryId, enqueued: true }, metrics: { acted: 1 } };
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
            const method = cfg.method ?? 'GET';
            // #4354 — unlike a connector action, an HTTP call's effect IS
            // knowable: the method says it. A GET reads and can never write, so
            // it reports a real `0`; anything else is a mutating call.
            const reads = /^(GET|HEAD|OPTIONS)$/i.test(method);
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
                    // A mutating call the upstream ACCEPTED is one effect. One it
                    // rejected is unknown, not zero: a 500 can arrive after the
                    // write landed, and claiming `0` there would let a run report
                    // it changed nothing while it had.
                    metrics: reads
                        ? { acted: 0 }
                        : response.ok
                            ? { acted: 1 }
                            : { unmeasuredEffect: true },
                };
            } catch (err) {
                const e = err as { name?: string; message?: string };
                const msg = e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e?.message ?? String(err);
                // A timed-out or aborted mutating request may well have landed —
                // the response is what we lost, not necessarily the write.
                return {
                    success: false,
                    error: `http: ${msg}`,
                    metrics: reads ? { acted: 0 } : { unmeasuredEffect: true },
                };
            } finally {
                if (timer) clearTimeout(timer);
            }
        },
    });

    ctx.logger.info('[HTTP] http executor registered');
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
