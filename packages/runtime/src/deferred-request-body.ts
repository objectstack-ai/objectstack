// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A request body handed to `dispatch()` UNREAD, so the domain reads it only
 * after its anonymous decision (ADR-0138 D2) — never the mount ahead of it.
 *
 * ## Why the mount cannot read it
 *
 * `IHttpRequest.body` may REFUSE when it is read: the standard transport
 * (`@objectstack/plugin-hono-server`) throws its `400 INVALID_REQUEST` from the
 * read of a body it could not parse, and answers the request with that refusal
 * whatever the handler then does. The standalone mounts in
 * `dispatcher-plugin.ts` used to read `req.body` to build `dispatch()`'s
 * arguments, so the refusal fired before `dispatch()` ran — ahead of the
 * domain's anonymous floor, which ADR-0138 D2 makes the domain's FIRST
 * statement. An anonymous caller sending an unparseable JSON body was answered
 * `400` where the same request with a readable body is answered `401`: the
 * anonymous answer depended on whether the body parsed. `createHonoApp`
 * (`@objectstack/hono`) never had this order, because it hands `dispatch()` a
 * body whose refusal is raised only when a domain reads it.
 *
 * ## The two halves
 *
 * - {@link deferRequestBody} (the mount): the `body` argument for `dispatch()`,
 *   holding the request and reading nothing.
 * - {@link readDispatchedBody} (the domain): called once the domain's anonymous
 *   decision has admitted the caller. A deferred body is read there, from the
 *   request, so a refusal is the transport's, unchanged; any other value (what
 *   `createHonoApp`, a test, or an internal caller hands `dispatch()`) is
 *   returned as it is.
 *
 * Reading the body THEN — rather than handing the domain no body at all, the
 * shape the bodiless doors use — is what keeps the admitted caller's answer: a
 * signed-in request with an unparseable body still gets the transport's
 * refusal, and a readable one the domain's answer to what it says.
 *
 * ## A deferred body read without being resolved is a programming error
 *
 * The value {@link deferRequestBody} returns throws on every read — a
 * property, `in`, its keys, a spread, `JSON.stringify` — with a message naming
 * the missing {@link readDispatchedBody} call. Holding it is not a read:
 * `typeof` is `'object'`, and passing it along or testing it with `??` touch
 * nothing, so `dispatch()` and a domain's own gates carry it untouched. A
 * domain that forgot to resolve it fails loudly on its first read instead of
 * acting on an invented empty body.
 */

/** The request a deferred body is read from: the transport's `IHttpRequest` (`body` may throw on read). */
interface BodyBearingRequest {
    readonly body?: unknown;
}

/** Deferred bodies → their request. Keyed by identity, so recognising one touches none of its traps. */
const DEFERRED_BODIES = new WeakMap<object, BodyBearingRequest>();

/** The `name` of the error a read of an unresolved deferred body throws: a programming error, never a request's. */
export const UNRESOLVED_REQUEST_BODY_READ = 'UnresolvedRequestBodyRead';

const UNRESOLVED_READ_MESSAGE =
    'A request body handed to dispatch() unread was read before the domain resolved it. '
    + 'A domain resolves the body with readDispatchedBody(body) once its anonymous decision has admitted the caller, '
    + 'and reads only the value that call returns.';

/**
 * The `body` argument a mount hands `dispatch()`: `req.body`, NOT yet read.
 * The domain reads it with {@link readDispatchedBody} after its anonymous
 * decision; until then nothing reads it, so a body the transport refuses is
 * refused only for a caller the domain admitted.
 */
export function deferRequestBody(req: BodyBearingRequest): unknown {
    const unresolved = (): never => {
        const error = new Error(UNRESOLVED_READ_MESSAGE);
        error.name = UNRESOLVED_REQUEST_BODY_READ;
        throw error;
    };
    const deferred = new Proxy(Object.create(null) as object, {
        get: unresolved,
        has: unresolved,
        ownKeys: unresolved,
        getOwnPropertyDescriptor: unresolved,
        getPrototypeOf: unresolved,
        set: unresolved,
        defineProperty: unresolved,
        deleteProperty: unresolved,
    });
    DEFERRED_BODIES.set(deferred, req);
    return deferred;
}

/**
 * The body a domain acts on, read once its anonymous decision has admitted the
 * caller. A body {@link deferRequestBody} deferred is read now, from its
 * request — which may throw the transport's refusal, and must be left to
 * propagate (`IHttpRequest.body`: a handler never carries on past it). Any
 * other value is returned unchanged.
 */
export function readDispatchedBody(body: unknown): unknown {
    if (typeof body !== 'object' || body === null) return body;
    const req = DEFERRED_BODIES.get(body);
    return req === undefined ? body : req.body;
}
