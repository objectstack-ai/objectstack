// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/analytics` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-2). Bridges to whatever provides the `analytics` service slot: the
 * service-analytics engine when installed, or the ObjectQLPlugin degraded
 * fallback otherwise (deliberate fallback + `replaceService`, see ADR-0076
 * D10/D12) — which is exactly why route registration stays dispatcher-owned.
 */

import { CoreServiceName } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createAnalyticsDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/analytics',
        handler: (req, context) =>
            handleAnalyticsRequest(deps, req.path.substring(10), req.method, req.body, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleAnalytics`. */
export async function handleAnalyticsRequest(
    deps: DomainHandlerDeps,
    path: string,
    method: string,
    body: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    const analyticsService = await deps.getService(CoreServiceName.enum.analytics);
    if (!analyticsService) return { handled: false }; // 404 handled by caller if unhandled

    const m = method.toUpperCase();
    const subPath = path.replace(/^\/+/, '');

    // POST /analytics/query
    if (subPath === 'query' && m === 'POST') {
        // [#2852] Pass the request's execution context so the analytics
        // service scopes each object by its per-object read filter (tenant +
        // RLS). Without it, `getReadScope(object, undefined)` returned no
        // filter and the query ran UNSCOPED — an authenticated caller saw
        // rows RLS would otherwise hide.
        const result = await analyticsService.query(body, context?.executionContext);
        return { handled: true, response: deps.success(result) };
    }

    // GET /analytics/meta
    if (subPath === 'meta' && m === 'GET') {
        const result = await analyticsService.getMeta();
        return { handled: true, response: deps.success(result) };
    }

    // POST /analytics/sql (Dry-run or debug)
    if (subPath === 'sql' && m === 'POST') {
        // [#2852] Scope the generated SQL to the caller too, so a preview
        // reflects the same per-object read filter the real query applies.
        const result = await analyticsService.generateSql(body, context?.executionContext);
        return { handled: true, response: deps.success(result) };
    }

    return { handled: false };
}
