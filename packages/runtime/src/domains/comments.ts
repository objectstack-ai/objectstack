// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/comments` domain — the three comment doors, reached through the dispatcher
 * (ADR-0076 D11 step ③'s shape: the dispatcher owns registration, and one
 * route bridges to one service slot; `/webhooks/redeliver` is the precedent
 * this mirrors).
 *
 * ## What it serves, and for whom
 *
 * The three server doors a member reaches without an object-level grant for
 * the write they make: `DELETE /comments/reactions/:id` (remove your own
 * reaction), `PUT /comments/:id/resolution` (resolve or reopen a thread you
 * can read) and `DELETE /comments/:id` (remove a comment you wrote). A
 * self-hosted kernel serves them already: plugin-audit mounts them on the
 * kernel's `http.server` (`mountCommentDoors`). A hosted tenant kernel owns no
 * socket and therefore no `http.server`, so on that shape every unreact,
 * resolve and own-comment delete answered the host's unmatched
 * `404 ENDPOINT_NOT_FOUND` (#36469). This domain is the hosted door (ruling A
 * on #22438, applied to this member of the class): it forwards the request to
 * the request kernel's `comments` slot — the transport-neutral
 * `ICommentDoorsService.handleCommentDoor(request)` member — and returns that
 * member's `Response` as it is. The self-hosted mount is untouched and is not
 * a caller.
 *
 * ## Exactly three shapes are claimed
 *
 * The registry claims `/comments` and everything under it for `PUT` and
 * `DELETE`; the handler then claims only the three method and path shapes
 * ({@link matchCommentDoorPath}) and answers every other one with the
 * dispatcher's ordinary miss (`404 ROUTE_NOT_FOUND`), exactly what it answered
 * before this domain existed; the member never runs for one. `GET`, `POST`
 * and `PATCH` are never claimed.
 *
 * ## The request is forwarded, never read
 *
 * The resolution door reads `{ "resolved": boolean }` from the JSON body. This
 * domain reads neither the body nor the parsed `body` the transport hands
 * `dispatch()`: the member owns the read, and the request it receives is the
 * transport's own (`context.request`). A body the transport had already
 * consumed would reach the member empty, so that is answered loudly here as a
 * server fault instead.
 *
 * The member matches the door's own wire path (`/api/v1/comments/…`). A
 * request that arrived under another spelling of the same path — the
 * environment-scoped `/api/v1/environments/:id/comments/…` — is handed on with
 * its URL rewritten to the wire path and its body still unread.
 *
 * ## The member is the only judge of the caller
 *
 * No anonymous-deny, no session read, no `ExecutionContext` handed on: the
 * member resolves the caller from the request's own credentials, the rule the
 * self-hosted mount applies. ⛔ These paths have NO entry on either dispatcher
 * preamble gate: they are not on the ADR-0069 auth-gate allow-list, and
 * `HttpDispatcher.enforceProjectMembership` does not skip them. The credential
 * is the session, so a session that still owes an authentication step, or a
 * signed-in caller who is not a member of the request's environment, is
 * stopped before the member runs: stricter than the self-hosted mount, never
 * looser.
 *
 * ## The slot is resolved per request, and absence is a typed answer
 *
 * Read on every request, never recorded (AGENTS.md, "Startup registry
 * reads"). An empty `comments` slot (a stack without plugin-audit) or a slot
 * whose service has no `handleCommentDoor` answers `501 NOT_IMPLEMENTED`,
 * ⛔ never `ENDPOINT_NOT_FOUND`: the route IS mounted, and what is missing is
 * the implementation behind it.
 */

import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import type { ICommentDoorsService } from '@objectstack/spec/contracts';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRequest, DomainRoute } from '../domain-handler-registry.js';

/** The prefix the domain claims (a segment claim, narrowed by the handler). */
export const COMMENTS_DOMAIN_PREFIX = '/comments';

/** The methods the registry claims for the prefix; the handler narrows further. */
export const COMMENTS_DOMAIN_METHODS = ['PUT', 'DELETE'] as const;

/** The three door shapes, as dispatcher paths (API prefix stripped), in the mount's order. */
export const COMMENT_DOOR_PATHS = [
    { method: 'DELETE', pattern: '/comments/reactions/:id' },
    { method: 'PUT', pattern: '/comments/:id/resolution' },
    { method: 'DELETE', pattern: '/comments/:id' },
] as const;

/** The wire prefix the doors are mounted under by plugin-audit (its routes are fixed at `/api/v1`). */
const DOOR_WIRE_PREFIX = '/api/v1';

/** The slot the member lives on (`AuditPlugin` registers it). */
const COMMENTS_SLOT = 'comments';

/**
 * Is `method path` one of the three comment doors? `path` is the dispatcher's
 * clean path; each `:id` matches one non-empty segment.
 */
export function matchCommentDoorPath(method: string, path: string): boolean {
    const verb = method.toUpperCase();
    const got = path.split('/');
    return COMMENT_DOOR_PATHS.some((door) => {
        if (door.method !== verb) return false;
        const want = door.pattern.split('/');
        return want.length === got.length
            && want.every((segment, i) => (segment.startsWith(':') ? got[i].length > 0 : segment === got[i]));
    });
}

export function createCommentsDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: COMMENTS_DOMAIN_PREFIX,
        match: 'segment',
        methods: [...COMMENTS_DOMAIN_METHODS],
        handler: (req, context) => handleCommentsRequest(deps, req, context),
    };
}

/**
 * The transport's request, addressed at the door's wire path. Handed on as it
 * is when it already is; otherwise a copy at the wire path whose body is the
 * original's unread stream.
 */
function atWirePath(request: Request, cleanPath: string): Request {
    const url = new URL(request.url);
    const wirePath = DOOR_WIRE_PREFIX + cleanPath;
    if (url.pathname === wirePath) return request;
    url.pathname = wirePath;
    const init: RequestInit & { duplex?: 'half' } = {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
    };
    if (request.body) {
        init.body = request.body;
        init.duplex = 'half';
    }
    return new Request(url, init);
}

/**
 * Forward a comment door request to the request kernel's
 * `comments.handleCommentDoor` and return its `Response` untouched.
 */
export async function handleCommentsRequest(
    deps: DomainHandlerDeps,
    req: DomainRequest,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // Not one of the three doors: the dispatcher's ordinary miss, the answer
    // the path got before this domain existed.
    if (!matchCommentDoorPath(req.method, req.path)) return { handled: true, response: deps.routeNotFound(req.path) };

    const service = await deps.resolveService(context, COMMENTS_SLOT, context.environmentId) as
        Pick<ICommentDoorsService, 'handleCommentDoor'> | undefined;
    if (!service) {
        return {
            handled: true,
            response: deps.error(
                'The comment doors are not available: no comments service is registered. '
                + '@objectstack/plugin-audit registers it; compose AuditPlugin on this kernel.',
                501,
            ),
        };
    }
    if (typeof service.handleCommentDoor !== 'function') {
        return {
            handled: true,
            response: deps.error(
                'The comment doors are not available: the registered comments service '
                + 'does not implement handleCommentDoor.',
                501,
            ),
        };
    }

    const request = context.request as Request;
    const logger = deps.logger ?? console;

    if (request?.bodyUsed === true) {
        logger?.error?.(
            '[comments] the request body was consumed before the /comments domain could forward it: '
            + 'the HTTP transport must hand the dispatcher the request with its body unread; the client was '
            + 'answered 500 rather than the refusal the door would have given',
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }

    try {
        return { handled: true, result: await service.handleCommentDoor(atWirePath(request, req.path)) };
    } catch (err) {
        // As `/webhooks/redeliver`: the member owns every answer it means to
        // give, so a throw out of it is unattributable here and its message
        // never reaches the client. The original error goes to the server log.
        logger?.error?.(
            '[comments] the comments service threw while serving a comment door request; the client was answered '
            + 'with a sanitised 500: the message is withheld unconditionally, and this line is where the '
            + 'original error is read',
            err instanceof Error ? err : new Error(String(err)),
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }
}
