// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/ai` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-7).
 * Dispatches to the AI service's registered route handlers (the
 * `__aiRoutes` table the AI plugin caches on the request kernel), enforcing
 * each route's declared `auth` contract and threading the resolved actor
 * into handlers. NOTE: receives the FULL cleanPath (no prefix strip) — the
 * legacy branch passed `cleanPath` whole and the matcher re-prefixes
 * `/api/v1` internally; preserved verbatim.
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createAiDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/ai',
        handler: (req, context) =>
            handleAIRequest(deps, req.path, req.method, req.body, req.query, context),
    };
}

/**
 * Handle AI service routes (/ai/chat, /ai/models, /ai/conversations, etc.)
 * Resolves the AI service and its built-in route handlers, then dispatches.
 */
export async function handleAIRequest(deps: DomainHandlerDeps, subPath: string, method: string, body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    let aiService: any;
    try {
        aiService = await deps.resolveService('ai');
    } catch {
        // AI service not registered
    }

    if (!aiService) {
        // The console polls `GET /ai/agents` on every navigation to decide
        // whether to show AI affordances. Reporting that as a 404 turns the
        // normal "no AI service configured" state (the open-source default —
        // service-ai is a Cloud/Enterprise package) into console error-log
        // spam on every page. An empty list conveys the same information
        // without looking like a fault. Every other /ai/* route still 404s.
        if (method === 'GET' && subPath === '/ai/agents') {
            return { handled: true, response: { status: 200, body: { agents: [] } } };
        }
        return {
            handled: true,
            response: {
                status: 404,
                body: { success: false, error: { message: 'AI service is not configured', code: 404 } },
            },
        };
    }

    // The AI service exposes route definitions via buildAIRoutes.
    // We match the request path against known AI route patterns.
    const fullPath = `/api/v1${subPath}`;

    // Build a simple param-extracting matcher for route patterns like /api/v1/ai/conversations/:id
    const matchRoute = (pattern: string, path: string): Record<string, string> | null => {
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');
        if (patternParts.length !== pathParts.length) return null;
        const params: Record<string, string> = {};
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                params[patternParts[i].substring(1)] = pathParts[i];
            } else if (patternParts[i] !== pathParts[i]) {
                return null;
            }
        }
        return params;
    };

    // Try to get route definitions from the AI service's cached routes
    const routes = deps.getRegisteredAiRoutes() as Array<{
        method: string; path: string; handler: (req: any) => Promise<any>; auth?: boolean;
    }> | undefined;

    if (!routes) {
        return {
            handled: true,
            response: {
                status: 503,
                body: { success: false, error: { message: 'AI service routes not yet initialized', code: 503 } },
            },
        };
    }

    for (const route of routes) {
        if (route.method !== method) continue;
        const params = matchRoute(route.path, fullPath);
        if (params === null) continue;

        // Enforce the route's declared `auth` contract. Nothing upstream
        // does: `enforceAuthGate` only covers ADR-0069 password/MFA gates
        // and `enforceProjectMembership` bails when the request is
        // anonymous or unscoped — so without this an anonymous caller
        // reached `auth: true` handlers (e.g. GET /ai/status) and got the
        // adapter/model config back. Gate when the deployment requires
        // auth; an authenticated user (or an internal system context)
        // passes, matching the REST `enforceAuth` seam. Off → unchanged.
        if (route.auth !== false) {
            const gec: any = context.executionContext;
            // `requireAuth && route.auth !== false` is the AI-route contract;
            // the shared function owns the anonymous decision itself.
            if (shouldDenyAnonymous({ requireAuth: deps.isAuthRequired(), userId: gec?.userId, isSystem: gec?.isSystem })) {
                return {
                    handled: true,
                    response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
                };
            }
        }

        // Resolve `req.user` from the already-resolved ExecutionContext so
        // AI route handlers can attribute the call to the authenticated
        // actor (drives auto-titled conversations, permission-aware
        // tools, HITL conversation linkage, …). Falls back to undefined
        // for anonymous requests (only reachable when the deployment does
        // NOT require auth — the gate above rejects them otherwise).
        const ec: any = context.executionContext;
        // `ai_seat` is synthesized into ec.permissions by resolveExecutionContext
        // (the single, scope-correct source — security/resolve-execution-context.ts),
        // so it flows through here with no extra per-request lookup.
        const user = ec?.userId
            ? {
                userId: ec.userId,
                id: ec.userId,
                displayName: ec.userDisplayName ?? ec.userName ?? ec.userId,
                email: ec.userEmail,
                roles: Array.isArray(ec.positions) ? ec.positions : [],
                permissions: Array.isArray(ec.permissions) ? ec.permissions : [],
                organizationId: ec.tenantId,
            }
            : undefined;

        const result = await route.handler({
            body,
            params,
            query,
            headers: context.request?.headers,
            user,
        });

        if (result.stream && result.events) {
            // Return a streaming result for the adapter to handle
            return {
                handled: true,
                result: {
                    type: 'stream',
                    contentType: result.vercelDataStream
                        ? 'text/plain; charset=utf-8'
                        : 'text/event-stream',
                    events: result.events,
                    vercelDataStream: result.vercelDataStream,
                    headers: {
                        'Content-Type': result.vercelDataStream
                            ? 'text/plain; charset=utf-8'
                            : 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    },
                },
            };
        }

        return {
            handled: true,
            response: {
                status: result.status,
                body: result.body,
            },
        };
    }

    return {
        handled: true,
        response: deps.routeNotFound(subPath),
    };
}
