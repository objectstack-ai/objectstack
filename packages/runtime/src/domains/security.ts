// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/security` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-2). The security admin surface (ADR-0090 D5/D9): suggested audience
 * bindings. A package's `isDefault: true` permission set is an install-time
 * SUGGESTION to bind it to the `everyone` position; these routes let an
 * admin see and resolve those suggestions. The `security` service does the
 * real gating (tenant-admin pre-check, and the confirm write runs under the
 * audience-anchor + delegated-admin gates with the caller's execution
 * context — never auto-bound, never system).
 *
 * NOTE (cross-repo, see #2462 step-① re-scope): cloud's per-env kernels can
 * reach this via `dispatch()` delegation (`/share-links` pattern), so the
 * handler must keep working from the registry exactly as from the if-chain.
 *
 * Routes:
 *   GET  /security/suggested-bindings?status=&packageId=   → list (reconciles first)
 *   POST /security/suggested-bindings/:id/confirm          → create the anchor binding
 *   POST /security/suggested-bindings/:id/dismiss          → decline the suggestion
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createSecurityDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/security',
        match: 'segment',
        handler: (req, context) =>
            handleSecurityRequest(deps, req.path.substring(9), req.method, req.body, req.query, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleSecurity`. */
export async function handleSecurityRequest(
    deps: DomainHandlerDeps,
    path: string,
    method: string,
    _body: any,
    query: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    const service = await deps.resolveService('security', context.environmentId) as any;
    if (!service || typeof service.listAudienceBindingSuggestions !== 'function') {
        return { handled: true, response: deps.error('Security service not available', 503) };
    }

    const ec = context.executionContext;
    // Admin surface — anonymous is denied UNCONDITIONALLY (#2567, #3963):
    // even before the opt-out was retired this seam never honoured it, so an
    // anonymous caller could never list or confirm audience bindings. Shares
    // the decision + body with every other HTTP seam.
    if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem })) {
        return {
            handled: true,
            response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
        };
    }

    const m = method.toUpperCase();
    // split+filter drops leading/trailing/duplicate slashes without a
    // regex over request-controlled input (CodeQL js/polynomial-redos).
    const parts = path.split('/').filter(Boolean);
    if (parts[0] !== 'suggested-bindings') return { handled: false };

    try {
        // GET /security/suggested-bindings
        if (parts.length === 1 && m === 'GET') {
            const status = query?.status ? String(query.status) : undefined;
            const packageId = query?.packageId ? String(query.packageId) : undefined;
            const result = await service.listAudienceBindingSuggestions(ec, { status, packageId });
            return { handled: true, response: deps.success(result) };
        }

        // POST /security/suggested-bindings/:id/confirm|dismiss
        if (parts.length === 3 && m === 'POST') {
            const id = decodeURIComponent(parts[1]);
            if (parts[2] === 'confirm') {
                const result = await service.confirmAudienceBindingSuggestion(ec, id);
                return { handled: true, response: deps.success(result) };
            }
            if (parts[2] === 'dismiss') {
                const result = await service.dismissAudienceBindingSuggestion(ec, id);
                return { handled: true, response: deps.success(result) };
            }
        }

        return { handled: false };
    } catch (err: any) {
        // The service throws typed errors carrying their HTTP status:
        // PermissionDeniedError → 403, SuggestionNotFoundError → 404,
        // SuggestionStateError → 409. Read via `errorFromThrown` so `status`
        // counts too, not just `statusCode` — the rest of the codebase's domain
        // errors use the former (#3867).
        return { handled: true, response: deps.errorFromThrown(err, 500) };
    }
}
