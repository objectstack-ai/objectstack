// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The JSON body of a request to one of this package's own Hono routes —
 * parsed, `{}` when there is none, or a `400` refusal when it was declared as
 * JSON and does not parse (#23914). Module-private: not exported from this
 * package's entry.
 *
 * ## The defect
 *
 * Each route read its body as `try { body = await c.req.json() } catch { body = {} }`,
 * so a truncated or garbled body was handled exactly like no body: the route
 * then answered for a request the client never sent, such as
 * `400 "package_id is required"` for a body that carried `package_id` and a
 * missing brace. The HTTP transports (`@objectstack/plugin-hono-server`,
 * `@objectstack/hono`) had the same swallow and refuse it the same way now,
 * with the same `code` and the same message words.
 *
 * ## What a reading answers
 *
 * - A body that parses: that value, as before. `c.req.json()` is asked first,
 *   exactly as before, so every input it accepted is accepted unchanged.
 * - A body that does not parse, sent as `application/json` (matched
 *   case-insensitively) and not blank: `400 INVALID_REQUEST` (a code on
 *   `ERROR_CODE_LEDGER`) in the declared envelope. The message names the parse
 *   failure and never echoes the body.
 * - No body, a blank one, or one that does not declare JSON: `{}`, as before.
 *   These routes are JSON doors and nothing sends them another media type;
 *   narrowing that is not this change.
 */

export type JsonBodyReading =
    | { readonly ok: true; readonly body: any }
    | { readonly ok: false; readonly response: Response };

const MALFORMED_JSON_BODY_MESSAGE =
    'The request body could not be parsed as JSON (it was sent as application/json). It was refused rather than '
    + 'read as an empty body: send a well-formed JSON document, or no body at all.';

const UNREADABLE_BODY_MESSAGE = 'The request body could not be read. It was refused rather than read as an empty body.';

function refused(c: any, message: string): JsonBodyReading {
    return { ok: false, response: c.json({ success: false, error: { code: 'INVALID_REQUEST', message } }, 400) };
}

export async function readJsonRequestBody(c: any): Promise<JsonBodyReading> {
    try {
        return { ok: true, body: await c.req.json() };
    } catch {
        const declaresJson = String(c.req.header('content-type') ?? '').toLowerCase().includes('application/json');
        if (!declaresJson) return { ok: true, body: {} };
        // Hono's `json()` is `text()` then `JSON.parse`, and caches the text
        // it read, so this is the same bytes, not a second read of the stream.
        let text: string;
        try {
            text = await c.req.text();
        } catch {
            return refused(c, UNREADABLE_BODY_MESSAGE);
        }
        if (text.trim() === '') return { ok: true, body: {} };
        return refused(c, MALFORMED_JSON_BODY_MESSAGE);
    }
}
