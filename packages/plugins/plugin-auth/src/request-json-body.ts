// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The JSON body of a request to one of this package's own routes: parsed,
 * `{}` when there is none, or a refusal MESSAGE when it was declared as JSON
 * and does not parse (#24032). Module-private: `index.ts` does not re-export
 * it, and no package entry carries it.
 *
 * ## The defect
 *
 * Nine body readers here were spelled
 * `try { body = await request.json() } catch { body = {} }` (three of them over
 * `c.req.json()`), so a truncated or garbled body was read exactly like no
 * body, and the route answered for a request the client never sent. As the
 * card measured it, on a fresh `objectstack dev` showcase boot with an admin
 * session: `POST /api/v1/auth/admin/unlock-user` with `{"userId": "usr_nobody"` (the
 * closing brace missing), sent as `application/json`, answered
 * `400 "userId is required"` for a body that carried `userId`. The one-click
 * `send-verification-email` resend reads `{}` as "send to my own address", so
 * a truncated body naming another address mailed the caller instead.
 *
 * The HTTP transports (`@objectstack/plugin-hono-server`, `@objectstack/hono`)
 * and `@objectstack/cloud-connection`'s own routes refuse the same input with
 * the same `code` and the same message words. None of them exports the
 * refusal (a shared export would widen a package's public surface), so this
 * package carries its own copy of the two messages.
 *
 * ## What a reading answers
 *
 * - A body that parses as JSON: that value, as before, whatever its
 *   `Content-Type`. These routes have never read the media type to PARSE (a
 *   valid JSON body sent as `text/plain` is read), and they still do not;
 *   `JSON.parse` over `text()` is what `request.json()` does.
 * - A body sent as `application/json` (matched case-insensitively) that is not
 *   blank and does not parse: `ok: false`, answered `400` with the registered
 *   code `INVALID_REQUEST` (`ERROR_CODE_LEDGER`) in the declared envelope. The
 *   message names the parse failure and never echoes the body.
 * - A body sent as `application/json` that cannot be READ at all (the stream
 *   failed): `ok: false`, the same code with the unreadable message.
 * - No body, a blank one (empty or whitespace only), or one that does not
 *   declare JSON and does not parse: `{}`, as before. An empty body is a real
 *   request here: the `sys_user` resend action fires with none.
 *
 * It answers a MESSAGE, never a response: each route builds its own `400`
 * body, in its own module, beside every other refusal it builds.
 */

/** `ok: false` is answered `400` with the code `INVALID_REQUEST` and this `message`. */
export type JsonBodyReading =
  | { readonly ok: true; readonly body: any }
  | { readonly ok: false; readonly message: string };

/** The refusal tail every message ends with: what the route did NOT do. */
const NOT_EMPTY = 'It was refused rather than read as an empty body';

export const MALFORMED_JSON_BODY_MESSAGE =
  `The request body could not be parsed as JSON (it was sent as application/json). ${NOT_EMPTY}: `
  + 'send a well-formed JSON document, or no body at all.';

export const UNREADABLE_BODY_MESSAGE = `The request body could not be read. ${NOT_EMPTY}.`;

function declaresJson(request: Request): boolean {
  return (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

export async function readJsonRequestBody(request: Request): Promise<JsonBodyReading> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return declaresJson(request) ? { ok: false, message: UNREADABLE_BODY_MESSAGE } : { ok: true, body: {} };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    if (text.trim() === '' || !declaresJson(request)) return { ok: true, body: {} };
    return { ok: false, message: MALFORMED_JSON_BODY_MESSAGE };
  }
}
