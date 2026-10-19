// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/webhooks/redeliver` domain — the webhook redeliver door, reached through
 * the dispatcher (ADR-0076 D11 step ③'s shape: the dispatcher owns
 * registration, and one route bridges to one service slot; `/approvals/act` is
 * the precedent this mirrors).
 *
 * ## What it serves, and for whom
 *
 * The operator button that sends a finished webhook delivery again. A
 * self-hosted kernel serves it already: plugin-webhooks mounts
 * `POST /api/v1/webhooks/redeliver` straight on the host's raw Hono app
 * (`registerAdminRoutes`). A hosted tenant kernel owns no socket and therefore
 * no raw app, so on that shape the path answered `ROUTE_NOT_FOUND` while the
 * `webhooks` slot sat registered with the member that serves it. This domain is
 * the hosted door (#22755, segment 2 of #22564's stage 2; ruling A on #22438):
 * it forwards the request to the request kernel's `webhooks` slot — the
 * transport-neutral `IWebhookService.handleRedeliver(request)` member — and
 * returns that member's `Response` as it is. The raw-app mount is untouched and
 * is not a caller; nothing here mounts the path a second time on a kernel that
 * has one.
 *
 * ## The request is forwarded, never read
 *
 * The `deliveryId` rides in the JSON body. This domain reads neither the body
 * nor the parsed `body` the transport hands `dispatch()`: the member owns the
 * read, and the request it receives is the transport's own
 * (`context.request`), which the `@objectstack/hono` catch-all leaves unread. A
 * body the transport had already consumed would reach the member empty, and
 * the member would tell the operator their request is not JSON. That failure is
 * answered loudly here instead (see {@link handleWebhooksRedeliverRequest}).
 *
 * ## The member is the only judge of the caller
 *
 * No anonymous-deny, no session read, no `ExecutionContext` handed on. The
 * member resolves the caller from the request's own credentials through the
 * kernel's `auth` service — the rule the self-hosted mount applies — so both
 * kernel shapes judge the same caller by one rule, in one place, and an
 * anonymous call is refused here exactly as the mount refuses it
 * (`401 UNAUTHENTICATED`, the member's own body). A second rule in this file
 * would be a second copy of the door that could drift from the first.
 *
 * ⛔ Unlike `/approvals/act`, this path has NO entry on either dispatcher
 * preamble gate: it is not on the ADR-0069 auth-gate allow-list in
 * `packages/core`, and `HttpDispatcher.enforceProjectMembership` does not skip
 * it. The credential here IS the session, not a token, so both gates apply as
 * they apply to every session-authenticated route: a session that still owes
 * an authentication step, or a signed-in caller who is not a member of the
 * request's environment, is stopped before the member runs. The dispatcher
 * door is stricter than the self-hosted mount, never looser — the contract's
 * own statement (`IWebhookService.handleRedeliver`).
 *
 * ## The slot is resolved per request, never at registration
 *
 * plugin-webhooks registers the `webhooks` slot at `kernel:ready`, after the
 * redelivery veto installs, and only if it installs. A lookup at registration
 * would therefore record an absence the same boot then contradicts (AGENTS.md,
 * "Startup registry reads"). The slot and its member are read on every request
 * and nothing about their absence is kept.
 *
 * ## Absence is a typed answer, never `ROUTE_NOT_FOUND`
 *
 * `handleRedeliver` is optional on the contract, and the `webhooks` slot is
 * empty on a stack without plugin-webhooks — or with it, when its veto could
 * not be installed. Either way the route IS mounted and what is missing is the
 * implementation behind it, so the answer is `501 NOT_IMPLEMENTED` (the
 * `/approvals/act` and `/auth` answer to the same shape, and `unavailable.ts`'s
 * reasoning). `ROUTE_NOT_FOUND` would tell an operator the URL is wrong.
 *
 * ## Methods
 *
 * `POST` only — the member's one method, and the only one the self-hosted
 * mount serves. The member does not match the method (the contract's status
 * table has no `405`), so the claim does: every other method is not claimed and
 * falls through to the dispatcher's ordinary miss, and the member never runs
 * for it.
 */

import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import type { IWebhookService } from '@objectstack/spec/contracts';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * The one path this domain claims — exactly, with no sub-paths: the redeliver
 * door is one route, and `/webhooks/redeliver/x` is not part of it.
 */
export const WEBHOOKS_REDELIVER_ROUTE = '/webhooks/redeliver';

/** The one method the route claims — see the module note on methods. */
export const WEBHOOKS_REDELIVER_METHODS = ['POST'] as const;

/** The slot the member lives on (`WebhookOutboxPlugin` registers it). */
const WEBHOOKS_SLOT = 'webhooks';

export function createWebhooksRedeliverDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: WEBHOOKS_REDELIVER_ROUTE,
        match: 'exact',
        methods: [...WEBHOOKS_REDELIVER_METHODS],
        handler: (_req, context) => handleWebhooksRedeliverRequest(deps, context),
    };
}

/**
 * Forward the request to the request kernel's `webhooks.handleRedeliver` and
 * return its `Response` untouched.
 */
export async function handleWebhooksRedeliverRequest(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    const service = await deps.resolveService(context, WEBHOOKS_SLOT, context.environmentId) as
        Pick<IWebhookService, 'handleRedeliver'> | undefined;
    if (!service) {
        return {
            handled: true,
            response: deps.error(
                'Webhook redelivery is not available: no webhooks service is registered. '
                + '@objectstack/plugin-webhooks registers it once its redelivery veto is installed, which needs '
                + 'the data engine and @objectstack/service-messaging; the boot log names the one that is missing.',
                501,
            ),
        };
    }
    if (typeof service.handleRedeliver !== 'function') {
        return {
            handled: true,
            response: deps.error(
                'Webhook redelivery is not available: the registered webhooks service '
                + 'does not implement handleRedeliver.',
                501,
            ),
        };
    }

    const request = context.request as Request;
    const logger = deps.logger ?? console;

    // The `deliveryId` is in the body. A body the transport already read
    // cannot be read again, and the member would answer "Request body must be
    // JSON." for a well-formed request — a transport fault shown to the
    // operator as their own. It is a server fault, answered as one and logged.
    if (request?.bodyUsed === true) {
        logger?.error?.(
            '[webhooks] the request body was consumed before the /webhooks/redeliver domain could forward it: '
            + 'the HTTP transport must hand the dispatcher the request with its body unread; the client was '
            + 'answered 500 rather than the "not JSON" refusal the member would have given',
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }

    try {
        return { handled: true, result: await service.handleRedeliver(request) };
    } catch (err) {
        // As `/approvals/act` and `/auth`: the member owns the reads and every
        // answer it means to give, so a throw out of it is unattributable here
        // and its message never reaches the client. The original error goes to
        // the server log.
        logger?.error?.(
            '[webhooks] the webhooks service threw while serving a redeliver request; the client was answered '
            + 'with a sanitised 500: the message is withheld unconditionally, and this line is where the '
            + 'original error is read',
            err instanceof Error ? err : new Error(String(err)),
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }
}
