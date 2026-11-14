// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The body a route handler reads as `req.body`: parsed by its declared
 * content type, or REFUSED, never invented (#23914).
 *
 * Module-private on purpose: nothing here is re-exported from this package's
 * entry. `@objectstack/hono`'s `createHonoApp` answers the same refusal with
 * the same `code` and `message`, and a test there drives both doors with one
 * body and asserts the two answers are equal.
 *
 * ## The defect
 *
 * The adapter used to build `body` as `{}` and overwrite it only on success:
 * a declared `application/json` body that did not parse fell through
 * `c.req.json()` and then `c.req.parseBody()` (which answers `{}` for that
 * media type) with both failures swallowed, and every other media type went
 * to `parseBody()`, which answers `{}` without reading anything. So the
 * handler received `{}`, a value indistinguishable from a real empty object.
 * Measured on a fresh `objectstack dev` showcase boot, `main` `2054a0888c`:
 *
 *     POST /api/v1/data/showcase_account/query
 *       {"where": {"status": "churned"}}          200, 2 rows
 *       the same, closing brace missing           200, 14 rows (every row)
 *       { not json                                200, 14 rows
 *       the valid body sent as text/plain         200, 14 rows
 *     PATCH /api/v1/data/showcase_account/ID
 *       {"name": "HACKED"   (truncated)           200, no field changed, updated_at bumped
 *     POST /api/v1/data/showcase_account
 *       {"name": "…"        (truncated)           400 VALIDATION_FAILED "Account Name is required"
 *
 * The query door is the silent-WIDENING class the api-backend checklist names
 * (`api-backend.query-contract-matrix`): "a malformed query body must never
 * degrade into an unfiltered 200 full read".
 *
 * ## What a reading answers
 *
 * - **Declared JSON** (`application/json`, matched case-insensitively): the
 *   body is read as text and parsed. Empty or whitespace-only is `{}`, as
 *   before; the REST data doors document that an empty body is an empty query.
 *   Anything else that does not parse is a refusal.
 * - **A form** (`multipart/form-data`, `application/x-www-form-urlencoded`):
 *   parsed as before. A parse failure is a refusal.
 * - **Any other media type, or none** (`text/plain`,
 *   `application/octet-stream`, …): nothing is read here, as before. When the
 *   request carries a body by its framing headers, reading `req.body` is a
 *   refusal; when it carries none, `req.body` is `{}`, as before.
 *
 * ## Why the refusal is raised when `req.body` is READ, not before the handler
 *
 * One transport serves two kinds of route, and only a route knows which kind
 * it is. A JSON door reads `req.body`. A byte door reads `req.rawBody()` and
 * never touches `req.body`, and it takes whatever media type the file has.
 * Measured on the same boot: the storage presign answers
 * `headers: { "content-type": "application/json" }` for a `.json` file, so
 * the raw PUT of a JSON-with-comments file (a `tsconfig.json`) arrives as
 * declared JSON that does not parse, and it is stored, `200`; a `.txt` file
 * arrives as `text/plain`, `200`. A refusal before the handler would turn both
 * uploads into `400`s. Raised on read, the refusal reaches exactly the
 * handlers that would otherwise have acted on an invented `{}`.
 *
 * The thrown value stops the handler at the read. The adapter then answers
 * with this refusal, whatever the handler made of the throw (see `runHandler`
 * in `adapter.ts`): the request's body was never readable, so no other answer
 * describes it.
 *
 * ## Why a body is judged present by its framing headers
 *
 * RFC 9112 §6.3: a request carries a body when it declares `Content-Length`
 * or `Transfer-Encoding`. Reading the bytes to find out would buffer an upload
 * before the storage routes' declared-length check refuses it (#22283), and
 * `Request.body` cannot answer either: `@hono/node-server` hands every
 * non-GET/HEAD request a stream, an empty one included. An in-process
 * `Request` built without those headers is therefore read as having no body.
 *
 * ## A body over the limit (`./body-limit.ts`)
 *
 * The transport's request-body limit is checked first: a declared length over
 * it is never read, and reading `req.body` refuses with `413
 * PAYLOAD_TOO_LARGE`, on the same read-time path as the refusals above, so a
 * byte door that reads `rawBody()` instead is untouched. A JSON or form body
 * with no declared length is read up to the limit and kept; past it, reading
 * `req.body` refuses with 413, and `rawBody()` still hands a byte door every
 * byte.
 *
 * The message names the failure and never echoes the body.
 */

import type { Context } from 'hono';
import { parseBody } from 'hono/utils/body';
import { RequestBodyTooLarge, requestBodyGuardOf } from './body-limit';

/**
 * The refusal, as a DECLARED ADR-0112 throw: `status` and a registered `code`
 * (`INVALID_REQUEST` is on `ERROR_CODE_LEDGER`), so `declaredEnvelopeForThrow`
 * renders it, and so does any handler's own classification it passes through.
 */
export class RequestBodyRefusal extends Error {
    readonly status = 400;
    readonly code = 'INVALID_REQUEST';

    constructor(message: string) {
        super(message);
        this.name = 'RequestBodyRefusal';
    }
}

export type RequestBodyReading =
    | { readonly body: unknown; readonly refusal?: undefined }
    | { readonly refusal: RequestBodyRefusal | RequestBodyTooLarge };

/** The refusal tail every message ends with: what the transport did NOT do. */
const NOT_EMPTY = 'It was refused rather than read as an empty body';

export const MALFORMED_JSON_BODY_MESSAGE =
    `The request body could not be parsed as JSON (it was sent as application/json). ${NOT_EMPTY}: `
    + 'send a well-formed JSON document, or no body at all.';

export const UNREADABLE_BODY_MESSAGE = `The request body could not be read. ${NOT_EMPTY}.`;

/** A media type as the client spelled it, echoed only when it is a plain token pair. */
function namedMediaType(mediaType: string): string {
    if (mediaType === '') return 'with no Content-Type';
    return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(mediaType)
        ? `as ${mediaType}`
        : 'with an unrecognised Content-Type';
}

function malformedFormMessage(mediaType: string): string {
    return `The request body could not be parsed as form data (it was sent ${namedMediaType(mediaType)}). ${NOT_EMPTY}.`;
}

function unreadMediaTypeMessage(mediaType: string): string {
    return `The request body was sent ${namedMediaType(mediaType)}, which this server does not read into a `
        + `request body. ${NOT_EMPTY}: send it as application/json.`;
}

/** RFC 9112 §6.3 — see the module note. A `Content-Length` that is not `0` counts as a body. */
function declaresBody(c: Context): boolean {
    const length = c.req.header('content-length');
    if (length !== undefined && length.trim() !== '') return Number(length) !== 0;
    return c.req.header('transfer-encoding') !== undefined;
}

/**
 * A JSON or form body with no declared length, read up to the limit from the
 * ORIGINAL body and kept (`./body-limit.ts`, `RequestBodyGuard.hold`), so a
 * byte door that reads `rawBody()` afterwards still receives every byte. `null`
 * when the reading is the plain `c.req` one: a declared length within the
 * limit (the guard counts it, and it cannot pass the limit), a body something
 * upstream already read, or an app with no guard.
 */
async function heldBody(c: Context): Promise<{ bytes: Uint8Array } | { tooLarge: RequestBodyTooLarge } | null> {
    const guard = requestBodyGuardOf(c);
    if (!guard || guard.declaresLength || guard.pulled() || c.req.raw.bodyUsed || !guard.original.body) return null;
    const held = await guard.hold();
    return held.bytes ? { bytes: held.bytes } : { tooLarge: new RequestBodyTooLarge(guard.limit) };
}

/** The 413 refusal when the read that just failed was the guard refusing a body past the limit. */
function tooLargeIfTripped(c: Context): RequestBodyTooLarge | undefined {
    const guard = requestBodyGuardOf(c);
    return guard?.tripped() ? new RequestBodyTooLarge(guard.limit) : undefined;
}

export async function readRequestBody(c: Context): Promise<RequestBodyReading> {
    const lowered = (c.req.header('content-type') ?? '').toLowerCase();

    // A declared length over the limit is never read: reading `req.body`
    // refuses with 413, and `rawBody()` still serves a byte door, which bounds
    // the body by its own limit (`./body-limit.ts`).
    const guard = requestBodyGuardOf(c);
    if (guard?.declaredOverLimit) return { refusal: new RequestBodyTooLarge(guard.limit) };

    const mediaType = lowered.split(';')[0]!.trim();
    const isForm = mediaType === 'multipart/form-data' || mediaType === 'application/x-www-form-urlencoded';
    let heldBytes: Uint8Array | undefined;
    if (lowered.includes('application/json') || isForm) {
        let held: Awaited<ReturnType<typeof heldBody>>;
        try {
            held = await heldBody(c);
        } catch {
            return { refusal: new RequestBodyRefusal(UNREADABLE_BODY_MESSAGE) };
        }
        if (held && 'tooLarge' in held) return { refusal: held.tooLarge };
        heldBytes = held?.bytes;
    }

    if (lowered.includes('application/json')) {
        // `text()` fills the same Hono body cache `json()` did (`json()` is
        // `text()` then `JSON.parse`), so `rawBody()` still reads the bytes; a
        // held body is decoded the way `text()` decodes (UTF-8, a BOM dropped).
        let text: string;
        try {
            text = heldBytes ? new TextDecoder().decode(heldBytes) : await c.req.text();
        } catch {
            return { refusal: tooLargeIfTripped(c) ?? new RequestBodyRefusal(UNREADABLE_BODY_MESSAGE) };
        }
        if (text.trim() === '') return { body: {} };
        try {
            return { body: JSON.parse(text) };
        } catch {
            return { refusal: new RequestBodyRefusal(MALFORMED_JSON_BODY_MESSAGE) };
        }
    }

    if (isForm) {
        try {
            if (!heldBytes) return { body: await c.req.parseBody() };
            const request = new Request(c.req.url, {
                method: 'POST',
                headers: { 'content-type': c.req.header('content-type') ?? mediaType },
                body: heldBytes as BodyInit,
            });
            return { body: await parseBody(request) };
        } catch {
            return { refusal: tooLargeIfTripped(c) ?? new RequestBodyRefusal(malformedFormMessage(mediaType)) };
        }
    }

    // Not read here: `application/octet-stream` stays consumable through
    // `req.rawBody()`, and so does every other media type.
    return declaresBody(c)
        ? { refusal: new RequestBodyRefusal(unreadMediaTypeMessage(mediaType)) }
        : { body: {} };
}
