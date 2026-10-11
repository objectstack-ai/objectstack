// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/approvals/act` domain — the ADR-0043 action page, reached through the
 * dispatcher (ADR-0076 D11 step ③'s shape: the dispatcher owns registration,
 * and one route bridges to one service slot; `/auth` is the precedent).
 *
 * ## What it serves, and for whom
 *
 * The session-less page an approver reaches from the approve / reject link in
 * an e-mail or IM message. A self-hosted kernel serves it already: the approvals
 * plugin mounts `GET` / `POST /api/v1/approvals/act` straight on the host's raw
 * Hono app (`plugin-approvals`, `mountActionPages`). A hosted tenant kernel owns
 * no socket and therefore no raw app, so on that shape the path answered
 * `ROUTE_NOT_FOUND` and every action link in every message was dead. This
 * domain is the hosted door (#22438, ruling A, segment 2): it forwards the
 * request to the request kernel's `approvals` slot — the transport-neutral
 * `IApprovalService.handleActionPage(request)` member — and returns that
 * member's `Response` as it is. The raw-app mount is untouched and is not a
 * caller; nothing here mounts the path a second time on a kernel that has one.
 *
 * ## The request is forwarded, never read
 *
 * The token rides in the `token` query parameter on `GET` and in the `token`
 * field of a form body on `POST`. This domain reads neither: the member owns
 * both reads, and the request it receives is the transport's own
 * (`context.request`). That is why the `@objectstack/hono` catch-all leaves the
 * raw request's body unread (the same change) — a body the transport had
 * already consumed would reach the member empty, and the member would tell the
 * approver their live link is invalid. That failure is answered loudly here
 * instead (see {@link handleApprovalsActRequest}), never as a page.
 *
 * ## The token is the only credential
 *
 * No anonymous-deny, no session read, no `ExecutionContext` handed on — the
 * holder of an action link has no session by design, and the member authorizes
 * from the token alone (ADR-0043). The dispatcher's two preamble gates were
 * aligned with that: the ADR-0069 auth-policy gate allow-lists the exact act
 * path (`packages/core`, `isAuthGateAllowlisted`), and the project-membership
 * gate skips it (`HttpDispatcher.enforceProjectMembership`), so a signed-in
 * caller is treated exactly like an anonymous one — as on the self-hosted
 * mount, which has neither gate.
 *
 * ## Absence is a typed answer, never `ROUTE_NOT_FOUND`
 *
 * `handleActionPage` is optional on the contract, and the `approvals` slot is
 * empty on a stack without the approvals plugin. Either way the route IS
 * mounted and what is missing is the implementation behind it, so the answer
 * is `501 NOT_IMPLEMENTED` (the `/auth` domain's answer to the same shape, and
 * `unavailable.ts`'s reasoning). `ROUTE_NOT_FOUND` would tell the holder of a
 * live link that the URL is wrong.
 *
 * ## Methods
 *
 * `GET` renders and `POST` redeems — the member's two methods. `HEAD` is
 * answered the way the self-hosted mount answers it: Hono serves a `HEAD` on a
 * `GET` route by running the `GET` handler and returning its status and
 * headers with no body, so this domain does the same against the member
 * (forwarded as a `GET`, which never decides — it only renders). Every other
 * method is not claimed and falls through as it does for any domain that
 * declares its methods.
 */

import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import type { IApprovalService } from '@objectstack/spec/contracts';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * The one path this domain claims — exactly, with no sub-paths: the action
 * page is one route, and `/approvals/act/x` is not part of it (the ADR-0069
 * allow-list in `packages/core` admits the same exact path and nothing under
 * it). Shared with the membership gate's skip, so the two cannot drift apart.
 */
export const APPROVALS_ACT_ROUTE = '/approvals/act';

/** The methods the route claims — see the module note on `HEAD`. */
export const APPROVALS_ACT_METHODS = ['GET', 'HEAD', 'POST'] as const;

/** The slot the member lives on (`ApprovalsServicePlugin` registers it). */
const APPROVALS_SLOT = 'approvals';

export function createApprovalsActDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: APPROVALS_ACT_ROUTE,
        match: 'exact',
        methods: [...APPROVALS_ACT_METHODS],
        handler: (req, context) => handleApprovalsActRequest(deps, req.method, context),
    };
}

/**
 * Forward the request to the request kernel's `approvals.handleActionPage` and
 * return its `Response` untouched.
 *
 * `method` is the dispatcher's; the member reads the method off the request
 * itself. They are the same value on every transport that reaches this domain
 * (the `@objectstack/hono` catch-all passes `c.req.method`, which IS the raw
 * request's), and the one place they are made to differ is the `HEAD` branch
 * below, on purpose.
 */
export async function handleApprovalsActRequest(
    deps: DomainHandlerDeps,
    method: string,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    const service = await deps.resolveService(context, APPROVALS_SLOT, context.environmentId) as
        Pick<IApprovalService, 'handleActionPage'> | undefined;
    if (!service) {
        return {
            handled: true,
            response: deps.error(
                'Approval action pages are not available: no approvals service is registered for this '
                + 'environment. Register @objectstack/plugin-approvals to serve them.',
                501,
            ),
        };
    }
    if (typeof service.handleActionPage !== 'function') {
        return {
            handled: true,
            response: deps.error(
                'Approval action pages are not available: the approvals service registered for this '
                + 'environment does not implement handleActionPage.',
                501,
            ),
        };
    }

    const request = context.request as Request;
    const logger = deps.logger ?? console;

    // A POST's token is in its body. A body the transport already read cannot
    // be read again, and the member would answer "this link is no longer
    // valid" for a live link — a transport fault shown to the approver as
    // their own. It is a server fault, answered as one and logged here.
    if (method === 'POST' && request?.bodyUsed === true) {
        logger?.error?.(
            '[approvals] the request body was consumed before the /approvals/act domain could forward it: '
            + 'the HTTP transport must hand the dispatcher the request with its body unread; the client was '
            + 'answered 500 rather than the "invalid link" page the member would have rendered',
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }

    try {
        if (method === 'HEAD') {
            // Hono answers a HEAD on the self-hosted mount's GET route with
            // `new Response(null, getResponse)` — the GET's status and headers,
            // no body. Built here the same way, so the answer does not depend
            // on whether the transport strips a HEAD body itself.
            const page = await service.handleActionPage(
                new Request(request.url, { method: 'GET', headers: request.headers }),
            );
            await page.body?.cancel();
            return {
                handled: true,
                result: new Response(null, { status: page.status, statusText: page.statusText, headers: page.headers }),
            };
        }
        return { handled: true, result: await service.handleActionPage(request) };
    } catch (err) {
        // As `/auth` (#5085): the member owns the routing and the reads, so a
        // throw out of it is unattributable here and its message never reaches
        // the client. The original error goes to the server log.
        logger?.error?.(
            '[approvals] the approvals service threw while serving an action page; the client was answered '
            + 'with a sanitised 500: the message is withheld unconditionally, and this line is where the '
            + 'original error is read',
            err instanceof Error ? err : new Error(String(err)),
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }
}
