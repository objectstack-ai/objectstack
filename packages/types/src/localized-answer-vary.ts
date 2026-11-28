// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37828] An error answer whose body carries a `userMessage` says it varies
 * by the request's language.
 *
 * ## Why
 *
 * A `userMessage` is the end user's sentence, rendered in the caller's language:
 * the request's top `Accept-Language` tag first, then the workspace default
 * (`operationUserMessage`, `@objectstack/core`, and every producer that renders
 * through `renderOperationMessage`). So two requests that differ only in
 * `Accept-Language` get two different bodies, and the response has to say so.
 * Without `Vary: Accept-Language` a cache may answer one caller's language to
 * another. That matters most where the status is cacheable by default, such as
 * the by-id read's `404 RECORD_NOT_FOUND` (RFC 9110 §15.1 lists 404, 405, 410,
 * 414 and 501).
 *
 * ## The rule, and why it ignores the status
 *
 * The header goes on every error answer that carries a `userMessage`, whatever
 * its status. `Vary` describes what the representation depends on, so it is
 * true of a `400` or a `403` that carries one as much as of a `404`, and it
 * does no harm on a status no cache stores. Keying it on the body rather than
 * on a table of cacheable statuses means there is no second list to keep in
 * step with the RFCs (seat ruling, claim record 7231826005).
 *
 * ## Who asks
 *
 * The exits that render a refusal body, each asking {@link answerVariesByLanguage}
 * about the body it is about to send. They read the body rather than the throw,
 * so the flat `/data` envelope (`{ error, code, userMessage }`, `@objectstack/rest`)
 * and the nested ADR-0112 envelope (`{ success: false, error: { code, message,
 * userMessage } }`, the Hono catch-all and the dispatcher's exit) are asked one
 * question:
 *
 *  - `@objectstack/rest`: the `/data` read routes' catch (`crud-routes.ts`);
 *  - `@objectstack/hono`: `thrownJson`, both of `createHonoApp`'s catch arms;
 *  - `@objectstack/runtime`: `dispatcher-plugin`'s `errorResponseBase`.
 *
 * Those three answer a THROW. An answer a dispatcher domain catches and composes
 * itself is RETURNED instead (`HttpDispatcher.errorFromThrown`, `deps.error`
 * with a `userMessage`, the dispatch foot's `PERMISSION_DENIED`, the `/actions`
 * door), and it leaves through the two exits that send a returned answer, which
 * ask the same question of its body (#38123):
 *
 *  - `@objectstack/runtime`: `dispatcher-plugin`'s `sendResultBase`;
 *  - `@objectstack/hono`: `createHonoApp`'s `toResponse`.
 *
 * Each exit adds the token with its host's APPEND form, never a set, so a `Vary`
 * already on the response (CORS's `Origin`, compression's `Accept-Encoding`)
 * keeps its tokens.
 */

/** The request header a localized `userMessage` is chosen by. */
export const LOCALIZED_ANSWER_VARY = 'Accept-Language';

/** A non-empty string, the one shape `declaredUserMessage` lets onto the wire. */
function isUserMessage(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0;
}

/**
 * Whether a refusal body carries a `userMessage`, in either envelope: at the top
 * level (the flat `/data` body) or under `error` (the ADR-0112 nested body).
 * Pure; reads nothing but the two slots.
 */
export function answerVariesByLanguage(body: unknown): boolean {
    if (body === null || typeof body !== 'object') return false;
    const record = body as { userMessage?: unknown; error?: unknown };
    if (isUserMessage(record.userMessage)) return true;
    const nested = record.error;
    return nested !== null && typeof nested === 'object' && isUserMessage((nested as { userMessage?: unknown }).userMessage);
}
