// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine } from '../engine.js';

/**
 * HTTP built-in node — `http_request` (foundational outbound I/O).
 *
 * Part of the platform baseline, so the core {@link AutomationServicePlugin}
 * seeds it directly (ADR-0018). The `connector_action` node was deliberately
 * NOT kept in the baseline: it is an *integration* concern that depends on a
 * connector registry the platform does not ship — the integration layer (or a
 * marketplace plugin) registers it via `engine.registerNodeExecutor()` when
 * connectors are present.
 *
 * ADR-0018 §M3 target: route `http_request` through the service-messaging
 * outbox (retry / idempotency / dead-letter) under the canonical `http` type.
 * Today it is a bare `fetch()`.
 */
export function registerHttpNodes(engine: AutomationEngine, ctx: PluginContext): void {
        // http_request node executor
        engine.registerNodeExecutor({
            type: 'http_request',
            descriptor: defineActionDescriptor({
                type: 'http_request', version: '1.0.0', name: 'HTTP Request',
                description: 'Call an external HTTP endpoint. (ADR-0018: migrates to outbox-backed `http`.)',
                icon: 'globe', category: 'io', source: 'builtin',
                // ADR-0018 §M3 target: route via service-messaging outbox for
                // retry/idempotency/dead-letter. Today this is a bare fetch().
                needsOutbox: false, supportsRetry: true,
                paradigms: ['flow', 'workflow_rule', 'approval'],
            }),
            async execute(node, _variables, _context) {
                const config = node.config as Record<string, unknown> | undefined;
                const url = config?.url as string | undefined;
                const method = (config?.method as string) ?? 'GET';
                const headers = config?.headers as Record<string, string> | undefined;
                const body = config?.body;

                if (!url) {
                    return { success: false, error: 'http_request: url is required' };
                }

                const response = await fetch(url, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : undefined,
                });
                const data = await response.json();

                return {
                    success: response.ok,
                    output: { response: data, status: response.status },
                    error: response.ok ? undefined : `HTTP ${response.status}`,
                };
            },
        });

        ctx.logger.info('[HTTP] 1 built-in node executor registered (http_request)');
}
