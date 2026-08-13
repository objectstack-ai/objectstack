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
 * #7359 added the near neighbour of a coercion — a declared filter the
 * boundary never read at all, which is the same 200-with-the-wrong-answer with
 * the narrowing dropped instead of invented:
 *
 *   ?status=failed  →  (nothing) →  EVERY run, as if all of them had failed
 *
 * Its gate is {@link parseEnumParam}, and it lives here for the reason the
 * others do: the moment a closed-set filter is honoured, the value outside the
 * set needs a refusal, and that refusal must be the same one every route makes.
 *
 * The refusal is the house shape, not a new channel: `validationFailure` — the
 * duck-typed `{ code: 'VALIDATION_FAILED', fields[] }` that BOTH dispatcher
 * error exits map to `400` with `details.fields[]` (#3918). No new spec
 * spelling either: ADR-0112's registered `VALIDATION_FAILED` and ADR-0114's
 * closed field-level catalog (`FieldErrorCode`) already say all of this.
 *
 * What these parsers do NOT do, by default, is police RANGE. A value that is
 * out of range but in domain (`?limit=1000`) is the service's declared business
 * — the notifications inbox clamps it, the automation engine slices by it — and
 * a boundary that started refusing those would be changing an answer that was
 * already defensible. So range enforcement is opt-in, per call site
 * ({@link parseIntegerParam}'s `bounds`), read off the call site's own
 * declared schema rather than re-listed — never switched on module-wide.
 *
 * #8054 is that opt-in's origin case, and the same shape as #7359 one field
 * over: `ListRunsRequestSchema` had always declared `limit`'s range
 * (`.min(1).max(100)`), and the boundary was not reading it —
 *
 *   ?limit=0    →  200, zero rows   →  "this flow has never run", confidently
 *   ?limit=101  →  200, cap ignored →  a result-set size nothing had asked for
 *
 * — so that one call site now threads its own bounds through; every other
 * caller of `parseIntegerParam` is unaffected, because it passes none.
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
 * Inclusive numeric bounds a call site may pass to {@link parseIntegerParam}
 * so it can police RANGE on top of type — read off the caller's own declared
 * schema (`ExistingSchema.shape.limit.unwrap().minValue` / `.maxValue`),
 * never re-listed as literals. That is the #7359 discipline
 * ({@link parseEnumParam} reading `ExecutionStatus.options`) applied to a
 * bounded number instead of a closed set: the wire's declared range and the
 * boundary's enforced range cannot drift, because they are the same read.
 */
export interface IntegerParamBounds {
    /** Inclusive lower bound — a value below it is refused as `min_value`. */
    readonly min?: number;
    /** Inclusive upper bound — a value above it is refused as `max_value`. */
    readonly max?: number;
}

/**
 * A whole-number parameter — the window sizes both `?limit=` defects were filed
 * against (#6928, #7300), and, once `bounds` is supplied, the RANGE defect
 * #8054 filed against the same parameter.
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
 * RANGE (`bounds`) is opt-in, per call site, and OFF unless a bounds object is
 * passed — a caller that omits the third argument is byte-for-byte the
 * pre-#8054 gate: an out-of-range number (`?limit=1000`) reaches the service
 * unrefused, exactly as before, because range used to be nobody's job at this
 * boundary. #8054 found the one call site (`ListRunsRequestSchema`'s `limit`)
 * that HAD declared a range and was not enforcing it — `?limit=0` answered
 * "no runs" with a 200, and `?limit=101` was served uncapped — so that call
 * site now threads its own `.min()`/`.max()` through as `bounds`, and a value
 * outside them is refused with the ADR-0114 field code the property name
 * already mirrors (`min_value` / `max_value`), the same shape
 * {@link parseEnumParam}'s `invalid_option` refusal takes for `status`.
 *
 * The falsy gate is the one both call sites already had
 * (`query.limit ? Number(query.limit) : undefined`): absent, `null`, `''` and
 * an in-process (non-string) `0` have always meant "no limit here", and they
 * keep meaning that — checked BEFORE `bounds`, so they never become a new 400
 * even when a `min` above 0 is supplied. Only a numeric STRING (`?limit=0`,
 * truthy as a string) reaches the bounds check.
 */
export function parseIntegerParam(
    param: string,
    raw: unknown,
    bounds?: IntegerParamBounds,
): number | undefined {
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
        throw invalidQueryParam(param, 'invalid_number', 'a whole number', raw);
    }
    if (bounds?.min !== undefined && parsed < bounds.min) {
        throw invalidQueryParam(param, 'min_value', `a whole number >= ${bounds.min}`, raw);
    }
    if (bounds?.max !== undefined && parsed > bounds.max) {
        throw invalidQueryParam(param, 'max_value', `a whole number <= ${bounds.max}`, raw);
    }
    return parsed;
}

/**
 * A CLOSED-SET parameter — a filter whose declared values are an enum on the
 * wire (`?status=failed` on `GET /api/automation/:name/runs`, whose
 * `ListRunsRequestSchema` bounds it to the eight `ExecutionStatus` members).
 *
 * Written for #7359, which is the third shape in this module's family and the
 * one that fails widest. The other two are coercions that invent a value; this
 * one is a filter the boundary never read at all. `status` was declared on the
 * wire, absent from `IAutomationService.listRuns`'s options, and never built
 * into the handler's option object — so `?status=failed` was dropped silently
 * and the caller was answered `200` with **every** run of the flow. A
 * monitoring caller paging for failures read the first 20 runs of any status
 * and concluded those were the failures.
 *
 * Once such a parameter is honoured, a value outside the set has no safe
 * reading left. `?status=faild` cannot mean "no filter" — the caller plainly
 * asked to narrow — and it cannot mean the empty result either, because
 * "no runs are `faild`" and "no runs failed" are the same sentence to a caller
 * who cannot see the typo. So it is refused, in the house shape: the closed
 * ADR-0114 catalog already carries `invalid_option` for exactly this
 * constraint ("not a member of the field's declared options").
 *
 * REFUSED: a non-empty string outside `allowed` (`invalid_option`); anything
 * that was never a single string at all — a repeated `?status=a&status=b`, a
 * structured `?status[$ne]=x`, a number (`invalid_type`, the same mapping
 * {@link parseStringParam} makes for the same condition).
 *
 * ACCEPTED as "no filter": absent, `null`, and the EMPTY string. The empty
 * spelling is the one judgement call here and it follows
 * {@link parseIntegerParam}'s falsy gate rather than
 * {@link parseBooleanParam}'s refusal, because the prior answers differ in
 * kind. `?read=` used to serve the UNREAD half — a wrong answer, so refusing it
 * strictly improved on it. `?status=` used to serve every run, which is
 * precisely what "no filter" means, so it already had a defensible answer and
 * this gate must not turn it into a new `400`. It is also the spelling an "All
 * statuses" `<select>` submits, and that client is asking for exactly what it
 * gets.
 */
export function parseEnumParam<T extends string>(
    param: string,
    raw: unknown,
    allowed: readonly T[],
): T | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string') {
        throw invalidQueryParam(param, 'invalid_type', 'a single string', raw);
    }
    if (!(allowed as readonly string[]).includes(raw)) {
        throw invalidQueryParam(param, 'invalid_option', `one of ${allowed.join(', ')}`, raw);
    }
    return raw as T;
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
