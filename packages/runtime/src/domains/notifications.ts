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
import { MarkNotificationsReadRequestSchema } from '@objectstack/spec/api';
import type { INotificationService } from '@objectstack/spec/contracts';
import { isServiceServeable } from '../service-serveable.js';
import { validationFailure, fieldsFromZodIssues } from '../validation-failure.js';
import { capabilityUnavailable } from './unavailable.js';
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
    // [#4127] Typed against the contract instead of `as any`, so a call this
    // file makes that `INotificationService` does not declare is a compile
    // error rather than a runtime discovery. That is the check missing when
    // #4087 shipped a `/storage` handler calling `upload(key, data)` with two
    // wrong arguments for months.
    const service = await deps.resolveService(context, 
        CoreServiceName.enum.notification,
        context.environmentId,
    ) as INotificationService | undefined;
    // [#4058] Three ways to have no inbox capability, one answer. The
    // `listInbox` probe was already here and, by accident, kept the known
    // fabricating stub off this surface (the dev one implements `send` /
    // `sendBatch` only). `isServiceServeable` makes that explicit rather than
    // incidental: a self-declared non-handler (`handlerReady: false`, ADR-0076
    // D12) is an empty slot even if it grows a `listInbox` later. A `degraded`
    // inbox that really serves keeps serving.
    //
    // [#4127] The probe STAYS, and it is not a duck-type any more: `listInbox`
    // is now a declared OPTIONAL method. Optional because an inbox needs a
    // durable store, and a send-only provider (SMTP, Twilio, a Slack webhook)
    // fills this slot legitimately without one — a fact `handlerReady` cannot
    // express, since the slot is serveable and only this capability is absent.
    // The dev stub implementing exactly `send`/`sendBatch` was never a bug on
    // its part: it followed the contract, and the contract was the incomplete
    // thing.
    //
    // 501 rather than the `handled: false` this used to return — `/notifications`
    // is mounted, so that produced a ROUTE_NOT_FOUND whose hint ("check the API
    // discovery endpoint") pointed at a page that correctly does not list the
    // route. See ./unavailable.ts. The slot key is `notification`, singular.
    if (!service || !isServiceServeable(service) || typeof service.listInbox !== 'function') {
        return capabilityUnavailable(deps, 'notification');
    }
    // Narrowed for the routes below: the entry probe established `listInbox`.
    const inbox = service as INotificationService & Required<Pick<INotificationService, 'listInbox'>>;

    const userId: string | undefined = context.executionContext?.userId;
    if (!userId) {
        return { handled: true, response: deps.error('Authentication required', 401) };
    }

    const m = method.toUpperCase();
    // split+filter drops leading/trailing/duplicate slashes without a regex
    // over request-controlled input (CodeQL js/polynomial-redos) — same
    // treatment the security domain got for the identical latent pattern.
    // Surfaced when the extraction (#3507) made this line "changed code":
    // the legacy `.replace(/\/+$/, '')` had carried the trap since ADR-0030.
    const subPath = path.split('/').filter(Boolean).join('/');

    // Each write route probes its OWN method rather than riding the entry
    // `listInbox` probe (#4127). The three are separately optional on the
    // contract, so "has an inbox to read" does not imply "has read-state to
    // write" — and the same-shaped `handled: false` is what an absent
    // capability already answers everywhere else in this file. Before the
    // methods were declared, the entry probe was the only thing standing
    // between a list-only provider and a `TypeError` on `markRead`.

    // GET /notifications — list the user's inbox joined with read-state.
    if (subPath === '' && m === 'GET') {
        const read = query?.read === undefined ? undefined : String(query.read) === 'true';
        const limit = query?.limit ? Number(query.limit) : undefined;
        const type = query?.type ? String(query.type) : undefined;
        const result = await inbox.listInbox(userId, { read, type, limit });
        return { handled: true, response: deps.success(result) };
    }

    // POST /notifications/read — mark specific notifications read.
    if (subPath === 'read' && m === 'POST') {
        if (typeof inbox.markRead !== 'function') return capabilityUnavailable(deps, 'notification');
        // [#3899] Validate against the declared contract
        // (`MarkNotificationsReadRequestSchema`, catalog `requestSchema`).
        // The old read was `Array.isArray(body?.ids) ? … : []`, so
        // `{"notificationIds": [...]}` or `{"ids": "n1"}` silently became
        // `markRead(userId, [])` — a success envelope, `readCount: 0`, and an
        // unread badge that never cleared. The wrong key is now a 400 naming
        // the field, thrown in the shape both dispatcher error exits map
        // (#3918); the analytics entry gate is the precedent (#3878).
        const parsed = MarkNotificationsReadRequestSchema.safeParse(body ?? {});
        if (!parsed.success) {
            const fields = fieldsFromZodIssues(parsed.error.issues);
            throw validationFailure(
                `Invalid mark-read body — expected { ids: string[] }: ${fields.map((f) => `${f.field}: ${f.message}`).join('; ')}`,
                fields,
            );
        }
        const result = await inbox.markRead(userId, parsed.data.ids);
        return { handled: true, response: deps.success(result) };
    }

    // POST /notifications/read/all — mark all of the user's inbox read.
    if (subPath === 'read/all' && m === 'POST') {
        if (typeof inbox.markAllRead !== 'function') return capabilityUnavailable(deps, 'notification');
        const result = await inbox.markAllRead(userId);
        return { handled: true, response: deps.success(result) };
    }

    return { handled: false };
}
