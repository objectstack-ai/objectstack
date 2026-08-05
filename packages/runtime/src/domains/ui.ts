// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/ui` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-3).
 * Serves rendered view metadata from the `protocol` service.
 *
 * Routes (path is the sub-path after `/ui`):
 *   GET /view/:object[/:type]   → getUiView (type also accepted as ?type=)
 */

import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { capabilityUnavailable } from './unavailable.js';

export function createUiDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/ui',
        handler: (req, context) =>
            handleUiRequest(deps, req.path.substring(3), req.query, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleUi`. */
export async function handleUiRequest(
    deps: DomainHandlerDeps,
    path: string,
    query: any,
    _context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // GET /ui/view/:object (with optional type param)
    if (parts[0] === 'view' && parts[1]) {
        const objectName = parts[1];
        // Support both path param /view/obj/list AND query param /view/obj?type=list
        const type = parts[2] || query?.type || 'list';

        const protocol = await deps.resolveService(_context, 'protocol');

        if (protocol && typeof protocol.getUiView === 'function') {
            try {
                const result = await protocol.getUiView({ object: objectName, type });
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        } else {
            // 501, not the 503 this used to answer: 503 claims the condition
            // is temporary, but an uninstalled MetadataPlugin does not become
            // installed by retrying. The message now names that remedy, and is
            // the same sentence discovery reports for the slot (#4146).
            return capabilityUnavailable(deps, 'ui');
        }
    }

    return { handled: false };
}
