// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared body of a dispatcher bridge to a plugin's own-row door (#36506):
 * one exact claim of a door's method and path shapes, forwarded to one
 * transport-neutral member on the REQUEST kernel's service slot. Not a domain
 * itself; `personal-views.ts`, `attachments.ts` and `print.ts` are its callers.
 *
 * ## Why a bridge, and for which kernel
 *
 * A plugin that mounts a door on the kernel's `http.server` serves it only
 * where there is one. A hosted tenant kernel owns no socket and so registers no
 * `http.server`: its host mounts `createHonoApp`'s `/api/v1/*` catch-all,
 * which hands every request no other route claims to `dispatch()`, and with no
 * domain for the door's path the answer was the dispatcher's
 * `404 ROUTE_NOT_FOUND`. The bridge is ruling A on #22438, applied to each
 * member of the class: the dispatcher owns the registration (ADR-0076 D11),
 * the plugin serves the request through one member that runs the very
 * registration its self-hosted mount runs, and the self-hosted mount is
 * untouched. `comments.ts` is the same bridge, written out for its three
 * doors.
 *
 * ## The claim is exact
 *
 * The registry claims the prefix for the doors' methods only; the handler then
 * claims only the doors' method and path shapes and answers every other one
 * with the dispatcher's ordinary miss, exactly what it answered before the
 * domain existed. The member never runs for one.
 *
 * ## The request is forwarded, never read
 *
 * Neither the body nor the parsed `body` handed to `dispatch()` is read here:
 * the member owns the read, and what it receives is the transport's own
 * request (`context.request`), at the door's wire path. A request that arrived
 * under the environment-scoped spelling is handed on with its URL rewritten to
 * the wire path and its body still unread. A body the transport already
 * consumed would reach the member empty, so that is answered loudly as a
 * server fault instead.
 *
 * ## The member is the only judge of the caller
 *
 * No anonymous-deny, no session read, no `ExecutionContext` handed on: the
 * member resolves the caller from the request's own credentials, the rule the
 * self-hosted mount applies. ⛔ These paths have NO entry on either
 * dispatcher preamble gate (the ADR-0069 auth-gate allow-list, and
 * `HttpDispatcher.enforceProjectMembership`), so a session that still owes an
 * authentication step, or a signed-in caller who is not a member of the
 * request's environment, is stopped before the member runs: stricter than the
 * self-hosted mount, never looser.
 *
 * ## The slot is the REQUEST kernel's, read per request
 *
 * The member is looked up with `getRequestKernelService`: the request's own
 * resolved kernel, never the host kernel's scoped fallback. Each of these
 * doors writes a row through the engine of the kernel whose member serves it,
 * so a tenant kernel that lacks the member must answer `501`, ⛔ never be
 * served by the host's member over the host's data. Read on every request,
 * never recorded (AGENTS.md, "Startup registry reads"). An empty slot or a
 * service without the member answers `501 NOT_IMPLEMENTED`, ⛔ never the
 * dispatcher's `404 ROUTE_NOT_FOUND`: the route IS mounted, and what is
 * missing is the implementation behind it.
 *
 * ## The `501` is in the request's language when the bridge names its noun
 *
 * [#37273] The two `501` sentences are the operation-message catalog's
 * (`own_door_service_unregistered`, `own_door_member_missing`), rendered in
 * the request's top `Accept-Language` tag (`preferredLocaleFromHeader`, no
 * q-value negotiation: the platform's existing reading, and the print door's
 * own for its 5xx). The bridge holds no `ExecutionContext` and no `i18n`
 * service, so the header is the only source and no `errors.own_door_*`
 * override is consulted. The door's noun is a catalog key too
 * ({@link OwnDoorBridge.nounKey}), required so no bridge ships an English-only
 * `501`; a plural noun ({@link OwnDoorBridge.nounPlural}) reads the `_plural`
 * pair of sentences, so the English verb agrees. Only the language moves: the
 * code and the status are unchanged, and no `userMessage` is added. The slot, member and
 * package names are identifiers and stay as written.
 */

import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { operationUserMessage } from '@objectstack/core';
import { preferredLocaleFromHeader } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRequest, DomainRoute } from '../domain-handler-registry.js';

/** One door's method and route pattern, as a dispatcher path (API prefix stripped). */
export interface OwnDoorShape {
    readonly method: 'DELETE' | 'PATCH' | 'PUT' | 'POST';
    readonly pattern: string;
}

/** What one bridge forwards, and to whom. */
export interface OwnDoorBridge {
    /** The prefix the registry claims (a segment claim, narrowed by the handler). */
    readonly prefix: string;
    /** The doors, in the self-hosted mount's order. */
    readonly doors: readonly OwnDoorShape[];
    /** The service slot the member lives on. */
    readonly slot: string;
    /** The member's name on that slot's service. */
    readonly member: string;
    /** The package that registers the slot, named in the `501` for an empty slot. */
    readonly producer: string;
    /** The doors' noun for answers and log lines, e.g. `the personal view door`. */
    readonly noun: string;
    /**
     * [#37273] The operation-message catalog key of {@link noun} (its English
     * text is `noun`'s, byte for byte), which puts the bridge's `501` in the
     * request's language. Required (#37610): a bridge cannot ship English-only.
     */
    readonly nounKey: string;
    /**
     * [#37610] {@link noun} is plural (`the … doors`): the `501` reads the
     * catalog's `_plural` sentences, so the English says "are".
     */
    readonly nounPlural?: true;
    /** The log tag, e.g. `personal-views`. */
    readonly tag: string;
}

/** The wire prefix the doors are mounted under by their plugins (their routes are fixed at `/api/v1`). */
const DOOR_WIRE_PREFIX = '/api/v1';

/**
 * Is `method path` one of `doors`? `path` is the dispatcher's clean path; each
 * `:id` matches one non-empty segment.
 */
export function matchOwnDoorPath(doors: readonly OwnDoorShape[], method: string, path: string): boolean {
    const verb = method.toUpperCase();
    const got = path.split('/');
    return doors.some((door) => {
        if (door.method !== verb) return false;
        const want = door.pattern.split('/');
        return want.length === got.length
            && want.every((segment, i) => (segment.startsWith(':') ? got[i].length > 0 : segment === got[i]));
    });
}

/** The registry entry for `bridge`. */
export function createOwnDoorBridgeDomain(deps: DomainHandlerDeps, bridge: OwnDoorBridge): DomainRoute {
    return {
        prefix: bridge.prefix,
        match: 'segment',
        methods: [...new Set(bridge.doors.map((door) => door.method))],
        handler: (req, context) => handleOwnDoorBridgeRequest(deps, bridge, req, context),
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

/** Forward one door request to the request kernel's member and return its `Response` untouched. */
export async function handleOwnDoorBridgeRequest(
    deps: DomainHandlerDeps,
    bridge: OwnDoorBridge,
    req: DomainRequest,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // Not one of the doors: the dispatcher's ordinary miss, the answer the
    // path got before this domain existed.
    if (!matchOwnDoorPath(bridge.doors, req.method, req.path)) {
        return { handled: true, response: deps.routeNotFound(req.path) };
    }

    // A kernel that throws for an unregistered name reads as an empty slot.
    let service: Record<string, unknown> | null | undefined;
    try {
        service = await deps.getRequestKernelService(context, bridge.slot) as Record<string, unknown> | null | undefined;
    } catch {
        service = undefined;
    }
    if (!service) {
        return {
            handled: true,
            response: deps.error(
                notImplementedSentence(bridge, context, 'own_door_service_unregistered', { producer: bridge.producer }),
                501,
            ),
        };
    }
    const member = service[bridge.member];
    if (typeof member !== 'function') {
        return {
            handled: true,
            response: deps.error(
                notImplementedSentence(bridge, context, 'own_door_member_missing', { member: bridge.member }),
                501,
            ),
        };
    }

    const request = context.request as Request;
    const logger = deps.logger ?? console;

    if (request?.bodyUsed === true) {
        logger?.error?.(
            `[${bridge.tag}] the request body was consumed before the ${bridge.prefix} domain could forward it: `
            + 'the HTTP transport must hand the dispatcher the request with its body unread; the client was '
            + 'answered 500 rather than the answer the door would have given',
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }

    try {
        const result = await (member as (request: Request) => Promise<Response>).call(service, atWirePath(request, req.path));
        return { handled: true, result };
    } catch (err) {
        // As `/comments`: the member owns every answer it means to give, so a
        // throw out of it is unattributable here and its message never reaches
        // the client. The original error goes to the server log.
        logger?.error?.(
            `[${bridge.tag}] the ${bridge.slot} service threw while serving ${bridge.noun}; the client was answered `
            + 'with a sanitised 500: the message is withheld unconditionally, and this line is where the '
            + 'original error is read',
            err instanceof Error ? err : new Error(String(err)),
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }
}

/** A `501` sentence of the catalog, in the request's top `Accept-Language` tag. */
function notImplementedSentence(
    bridge: OwnDoorBridge,
    context: HttpProtocolContext,
    messageKey: 'own_door_service_unregistered' | 'own_door_member_missing',
    params: Record<string, string>,
): string {
    const caller = { locale: requestLocaleOf(context) };
    const noun = operationUserMessage(bridge.nounKey, caller);
    const key = bridge.nounPlural ? `${messageKey}_plural` : messageKey;
    return operationUserMessage(key, caller, { door: capitalize(noun), slot: bridge.slot, ...params });
}

/**
 * The request's top `Accept-Language` tag, from a fetch `Request` or a plain
 * header record: the language of an own door's `501` (#37610: the comment and
 * webhook redelivery doors read it too).
 */
export function requestLocaleOf(context: HttpProtocolContext): string | undefined {
    const headers = (context.request as { headers?: unknown } | undefined)?.headers as
        | { get?: (name: string) => string | null }
        | Record<string, unknown>
        | undefined;
    if (!headers) return undefined;
    const value = typeof headers.get === 'function'
        ? headers.get('accept-language')
        : (headers as Record<string, unknown>)['accept-language'] ?? (headers as Record<string, unknown>)['Accept-Language'];
    const header = Array.isArray(value) ? value[0] : value;
    return preferredLocaleFromHeader(typeof header === 'string' ? header : undefined);
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
