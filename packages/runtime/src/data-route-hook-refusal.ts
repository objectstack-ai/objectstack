// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#38232] The runtime dispatcher's answer to a sandboxed hook's refusal on a
 * `/data/:object` route: `RestServer`'s answer for the same throw
 * (`mapDataError`, `@objectstack/types`), lifted into this transport's
 * envelope.
 *
 * ## Why the dispatcher answers it
 *
 * `callDataWrite` (`domains/data.ts`) and `dispatch()`'s foot catch let such a
 * refusal leave `dispatch()`, and the host's catch-all answered it. The one in
 * this repository is `@objectstack/hono`'s `createHonoApp`, whose recogniser
 * (`declaredEnvelopeForThrow`, `@objectstack/plugin-hono-server`) serves only a
 * throw carrying a REGISTERED code. So, on that host:
 *
 *  - a hook's own code (`OVERLAP`, `CREDIT_LIMIT`: the codes a hook's
 *    `refusals` catalogue declares) answered `500 INTERNAL_ERROR`, with no
 *    `userMessage` and no `details.refusals`, so the person refused saw a
 *    server error instead of the app's sentence;
 *  - a registered code kept its status and `details.refusals`, but a
 *    `userMessage` the REST routes cut at `CLIENT_MESSAGE_MAX` reached the
 *    caller whole.
 *
 * The NOT NULL arm beside this one's call (#26031) answers a driver refusal
 * here for the same reason, and in the same way: the classification's own
 * answer, never a reading of the throw made here. ⛔ The recogniser is not
 * widened instead: its registered-code condition is the gate every direct-mount
 * route answers through, and it is not this route's to move.
 *
 * ## What is answered here
 *
 * Exactly a sandboxed body's REPORTED refusal: {@link sandboxBusinessMessage}
 * answers (a body that threw, and did not crash). That is the throw
 * `classifyDataError`'s unwrap door answers, so the status, `code`, demoted
 * `declaredCode`, bounded `userMessage` and whole `details.refusals` are the
 * REST routes' by construction. A crash, the sandbox's own fault and every
 * other throw are left to the code that answered them before.
 *
 * ## The envelope
 *
 * The REST body is flat (`{ error, code, declaredCode, userMessage, object,
 * details }`); this transport's is the ADR-0112 nested one. `error` becomes
 * `message`; `code` stays `code`; `declaredCode` and `userMessage` are the
 * declared siblings of `code` (`ApiErrorSchema`); every other member of the
 * flat body is context, and joins `details`, as the NOT NULL arm's members do.
 */

import { mapDataError, sandboxBusinessMessage } from '@objectstack/types';

/** What `dispatch()`'s foot catch builds its envelope from. */
export interface DataRouteHookRefusalAnswer {
    status: number;
    message: string;
    code?: string;
    details?: Record<string, unknown>;
    extra?: Record<string, unknown>;
}

/** The flat body's members that are not context: the sentence, the code, and the code's declared siblings. */
const ENVELOPE_KEYS = new Set(['error', 'code', 'declaredCode', 'userMessage', 'details']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The answer to `error`, thrown on the `/data/:object` route that names
 * `object`, when it is a sandboxed hook's refusal; `undefined` otherwise.
 */
export function dataRouteHookRefusalAnswer(error: unknown, object: string): DataRouteHookRefusalAnswer | undefined {
    if (sandboxBusinessMessage(error) === undefined) return undefined;
    const { status, body } = mapDataError(error, object);

    const context = Object.fromEntries(Object.entries(body).filter(([key]) => !ENVELOPE_KEYS.has(key)));
    const details = { ...context, ...(isRecord(body.details) ? body.details : {}) };
    const extra = {
        ...(typeof body.declaredCode === 'string' ? { declaredCode: body.declaredCode } : {}),
        ...(typeof body.userMessage === 'string' ? { userMessage: body.userMessage } : {}),
    };

    return {
        status,
        message: typeof body.error === 'string' ? body.error : String(body.error),
        ...(typeof body.code === 'string' ? { code: body.code } : {}),
        ...(Object.keys(details).length > 0 ? { details } : {}),
        ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
}
