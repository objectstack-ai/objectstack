// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Coerced HTTP **query parameters**, checked at the point they are coerced.
 *
 * A query string carries no types: every value arrives as a string (or, when a
 * parameter is repeated, as an array of them), so a domain handler that wants a
 * number or a boolean has to convert. The failure this module exists to stop is
 * what happens when that conversion is written as a bare coercion —
 * `Number(query.limit)`, `String(query.type)`, `String(query.read) === 'true'`.
 * A coercion does not fail; it **invents** a value and serves it. Every such
 * defect is therefore a `200` with the wrong answer rather than a `400`:
 *
 *   ?limit=abc      →  NaN     →  a poisoned window handed to a service
 *   ?read=1         →  false   →  the UNREAD half of the inbox, silently
 *   ?type=a&type=b  →  'a,b'   →  a topic nothing matches, silently
 *
 * Two cards found the identical shape on two routes — #6928 on
 * `GET /api/v1/notifications` (fixed in PR #7299) and #7300 on
 * `GET /api/v1/automation/:name/runs` — so the parsers PR #7299 wrote
 * module-local in `domains/notifications.ts` live here now: one consumer did
 * not justify a shared module, a second one does, and the alternative is a
 * second hand-rolled refusal for the same condition drifting away from the
 * first.
 *
 * The refusal is the house shape, not a new channel: `validationFailure` — the
 * duck-typed `{ code: 'VALIDATION_FAILED', fields[] }` that BOTH dispatcher
 * error exits map to `400` with `details.fields[]` (#3918). No new spec
 * spelling either: ADR-0112's registered `VALIDATION_FAILED` and ADR-0114's
 * closed field-level catalog (`FieldErrorCode`) already say all of this.
 *
 * What these parsers deliberately do NOT do is police RANGE. A value that is
 * out of range but in domain (`?limit=1000`) is the service's declared business
 * — the notifications inbox clamps it, the automation engine slices by it — and
 * a boundary that started refusing those would be changing an answer that was
 * already defensible. These gates add a refusal for values that were never of
 * the declared type at all.
 */

import type { FieldErrorCode } from '@objectstack/spec/api';
import { validationFailure } from './validation-failure.js';

/**
 * Render a rejected query value for a human, without echoing an unbounded
 * caller-supplied string into the response body.
 */
function describeQueryValue(raw: unknown): string {
    if (typeof raw === 'string') {
        return JSON.stringify(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
    }
    if (Array.isArray(raw)) return `a repeated parameter (${raw.length} values)`;
    if (raw !== null && typeof raw === 'object') return 'a structured value';
    return String(raw);
}

/** One malformed query parameter, refused. `code` is an ADR-0114 catalog member. */
export function invalidQueryParam(param: string, code: FieldErrorCode, expected: string, raw: unknown): Error {
    const message =
        `Invalid \`${param}\` query parameter — expected ${expected}, received ${describeQueryValue(raw)}`;
    return validationFailure(message, [{ field: param, code, message }]);
}

/**
 * A TRI-state boolean filter: absent means "no filter", so `undefined` has to
 * stay reachable and must never collapse into `false`.
 *
 * Written for `?read=` on the notifications inbox, which was
 * `String(query.read) === 'true'` and therefore answered `false` for every
 * spelling that was not exactly `true`. `?read=1`, `?read=TRUE` and `?read=`
 * served the UNREAD half to a caller who had asked for the read half — or for
 * nothing in particular — and said so to nobody. A wire contract that declares
 * `z.boolean()` has exactly two spellings; a third is refused rather than
 * guessed.
 *
 * ACCEPTED: absent → `undefined`; `'true'` → `true`; `'false'` → `false`; a
 * real boolean (what an in-process `dispatch()` delegation can hand over) →
 * itself.
 */
export function parseBooleanParam(param: string, raw: unknown): boolean | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw invalidQueryParam(param, 'invalid_boolean', '`true` or `false`', raw);
}

/**
 * A whole-number parameter — the window sizes both `?limit=` defects were filed
 * against (#6928, #7300).
 *
 * `Number(query.limit)` answers `NaN` for `?limit=abc`, and NaN then survives
 * the guards downstream, because the two idioms services use to default a
 * missing window both let it through: `limit ?? 20` does not catch NaN, and
 * neither does `Math.min(Math.max(limit, 1), 200)`. What the service does with
 * it from there is its own accident — an empty page from `slice(0, NaN)`, or a
 * `find({ limit: NaN })` sent to a driver — and in no case a 400.
 *
 * REFUSED: values that are not a whole number at all — `abc`, `10abc`, `1.5`,
 * `Infinity`, a repeated `?limit=1&limit=2`, a structured value.
 *
 * NOT refused, deliberately: an out-of-RANGE number. Range is the consuming
 * service's declared contract (clamp, slice, or reject with its own message),
 * and this gate must not start answering 400 for a value that already had a
 * defensible answer.
 *
 * The falsy gate is the one both call sites already had
 * (`query.limit ? Number(query.limit) : undefined`): absent, `null`, `''` and
 * `0` have always meant "no limit here", and they keep meaning that instead of
 * becoming a new 400.
 */
export function parseIntegerParam(param: string, raw: unknown): number | undefined {
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
        throw invalidQueryParam(param, 'invalid_number', 'a whole number', raw);
    }
    return parsed;
}

/**
 * A single-string parameter — a topic filter, an opaque pagination cursor.
 *
 * The failure it closes is the repeated parameter: `?type=a&type=b` arrives as
 * an ARRAY from every query parser these routes run behind, and `String([...])`
 * turned it into the single value `'a,b'` — a filter matching nothing, served
 * as a 200. A structured value (`?cursor[$ne]=x`) is the same class.
 *
 * Any string is passed through VERBATIM, including the empty one and one that
 * names nothing live: "no rows of that type" is a legitimate empty answer,
 * unlike "no rows of a type you did not ask for". `null` is treated as absent
 * — it is not a string, so no caller could have meant it as one, and the
 * declared option is optional.
 */
export function parseStringParam(param: string, raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') {
        throw invalidQueryParam(param, 'invalid_type', 'a single string', raw);
    }
    return raw;
}
