// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/notifications` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-2). In-app notifications (ADR-0030): the inbox surface backed by the
 * messaging service registered under the `notification` slot. Reads the L5
 * `sys_inbox_message` + `sys_notification_receipt` join; mark-read upserts
 * the receipt keyed `(notification_id, user_id, channel:'inbox')`. The
 * routes are `auth: true`, so an authenticated user is required.
 *
 * NOTE (cross-repo, see #2462 step-① re-scope): this domain has NO other
 * HTTP owner anywhere — cloud hosts reach it through the `dispatch()`
 * delegation, so this handler must keep working from the registry exactly
 * as it did from the if-chain.
 *
 * Routes (path is the sub-path after `/notifications`):
 *   GET  ''          → listInbox    (query: read, type, limit)
 *   POST /read       → markRead     (body: { ids: string[] })
 *   POST /read/all   → markAllRead
 */

import { CoreServiceName } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createNotificationsDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/notifications',
        handler: (req, context) =>
            handleNotificationRequest(deps, req.path.substring(14), req.method, req.body, req.query, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleNotification`. */
export async function handleNotificationRequest(
    deps: DomainHandlerDeps,
    path: string,
    method: string,
    body: any,
    query: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    const service = await deps.resolveService(CoreServiceName.enum.notification, context.environmentId) as any;
    if (!service || typeof service.listInbox !== 'function') return { handled: false };

    const userId: string | undefined = context.executionContext?.userId;
    if (!userId) {
        return { handled: true, response: deps.error('Authentication required', 401) };
    }

    const m = method.toUpperCase();
    const subPath = path.replace(/^\/+/, '').replace(/\/+$/, '');

    // GET /notifications — list the user's inbox joined with read-state.
    if (subPath === '' && m === 'GET') {
        const read = query?.read === undefined ? undefined : String(query.read) === 'true';
        const limit = query?.limit ? Number(query.limit) : undefined;
        const type = query?.type ? String(query.type) : undefined;
        const result = await service.listInbox(userId, { read, type, limit });
        return { handled: true, response: deps.success(result) };
    }

    // POST /notifications/read — mark specific notifications read.
    if (subPath === 'read' && m === 'POST') {
        const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => String(x)) : [];
        const result = await service.markRead(userId, ids);
        return { handled: true, response: deps.success(result) };
    }

    // POST /notifications/read/all — mark all of the user's inbox read.
    if (subPath === 'read/all' && m === 'POST') {
        const result = await service.markAllRead(userId);
        return { handled: true, response: deps.success(result) };
    }

    return { handled: false };
}
