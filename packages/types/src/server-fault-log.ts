// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14310] The one rule for "a 5xx must never be silent", shared by every
 * transport that turns a fault into an HTTP envelope.
 *
 * ## The hole this closes
 *
 * A 500 that leaves no server-side line is diagnosed from the browser or not
 * at all. Measured on `main`: a plain `Error` thrown out of a dispatcher route
 * answered `500 INTERNAL_ERROR` with **zero** log records at any level — the
 * only evidence was the client's console and the response body. The failure
 * that motivated this had been reachable for a week and nobody saw it, which
 * is AGENTS.md "Route & surface ownership §3 — absence must be loud" inverted.
 *
 * The reporting that DID exist was not a substitute, in two independent ways:
 *
 *  1. `ErrorReporter.captureException` is an APM channel and defaults to
 *     `NoopErrorReporter`. A dev server — the surface an operator actually
 *     watches — wires no reporter, so the capture was a no-op every time.
 *  2. It is fed by `res.__obsRecordedError`, which only the THROWN exit sets.
 *     A dispatcher route that catches its own fault and RETURNS a 5xx envelope
 *     (`deps.errorFromThrown`, which is how every `/packages` handler answers)
 *     records nothing, so even a wired reporter never saw those.
 *
 * This module is the log half, and it is deliberately not the reporter half:
 * an APM capture is opt-in telemetry, a log line is the operator's floor.
 *
 * ## Why it lives here
 *
 * Same argument, and the same package, as `resolveThrownHttpError` one file
 * over: a rule two doors must agree on cannot live inside one of them.
 * `@objectstack/runtime` depends on `@objectstack/rest`, so an import between
 * the two doors could only ever point one way — which is exactly why the
 * "what status does this throw mean" rule was moved here in #8016. "Is this
 * answer worth an operator's attention" is the same kind of rule, read by the
 * same two doors, so it gets the same home rather than a second one.
 *
 * Living beside {@link sendError} is what makes the REST side automatic: that
 * writer is the single exit for every nested-envelope 5xx, so the direct-mount
 * registrars need no per-door call and cannot forget one. Each transport logs
 * at its own single exit, so a fault costs one line and never two.
 *
 * ## `error` level, and why that clears the default
 *
 * The requirement is that the line survives `--log-level`'s DEFAULT. The CLI
 * default is `warn` (`packages/cli/src/utils/log-level.ts`) and `error` (40)
 * outranks `warn` (30) in `LEVEL_PRIORITY`, so an `error` record passes the
 * default threshold without any bypass of the level system. An operator who
 * asks for `--log-level silent` still gets silence: that is a deliberate
 * instruction, not the default this issue is about.
 *
 * ## 5xx only
 *
 * 4xx stays quiet, deliberately and at this one gate rather than at each call
 * site. A client error is the caller's mistake and the response already
 * explains it; logging them is how the `/meta` `?state=draft` probe once
 * printed 45 stack traces in one browsing session. `isServerFault` is the
 * whole rule: at or above 500.
 *
 * ## [#14656] The one exception: a DECLARED CAPABILITY ABSENCE
 *
 * Maintainer ruling 2026-09-03 (decision batch #23, verbatim reply 「同意」 to
 * this card's B + C): the #14310 rule above stands **for faults**. A 5xx the
 * platform chose because the deployment did not install an OPTIONAL SERVICE —
 * `capabilityUnavailable`'s `501 NOT_IMPLEMENTED` on `/api/v1/notifications`
 * without `service-messaging`, and the `503 SERVICE_UNAVAILABLE` siblings — is
 * a CONFIGURATION FACT, not a fault. It is reported **once per route per
 * process**, at `warn`, naming the missing service, and then stays quiet for
 * that route.
 *
 * What it fixes, measured on a stock showcase boot (#14656 comment, 2026-09-04):
 * `GET /api/v1/ai/*` printed one `error` line per request, and Studio opens it
 * unprompted — a channel this repo had just built to mean "an operator must
 * look" was being trained into noise by a deployment that is working exactly as
 * configured. AGENTS.md's own degradation rule already grades this family:
 * "a capability is not enabled, an optional service never showed up" is
 * FUNCTIONAL degradation, `warn`/`info`, and only DURABILITY degradation earns
 * `error`.
 *
 * Four properties, each load-bearing, all of them the ruling's own words:
 *
 *  1. **One predicate, one place.** It is applied INSIDE this funnel rather
 *     than at each door, so the REST writer ({@link sendError}, one file over)
 *     and the runtime dispatcher read the same answer by construction — there
 *     is no per-door spelling to drift, and no door can opt out by forgetting
 *     a call. "The REST door and the dispatcher read the same predicate" is
 *     the constraint; being unable to spell it twice is stronger than agreeing
 *     to spell it once.
 *  2. **It reuses the declared-5xx vocabulary that already exists.**
 *     {@link declaresServerFault} is the repo's one "the producer declared
 *     this shape" predicate (`status >= 500` plus a non-empty string `code`) —
 *     the same read `@objectstack/rest`'s `declaredServerFaultAnswer` gates on.
 *     ⛔ Nothing new is invented to recognise an absence: the ADR-0112 `code`
 *     the producer already declared IS the declaration.
 *  3. **The dedupe key is (route, process).** A restart reports again. ⛔ NOT a
 *     global "first N" throttle — that is the shape that hides the SECOND
 *     route, and it is named in the ruling as the thing not to build.
 *  4. **The wire does not move.** This decides a log level and a count. No
 *     status, code or body byte changes, at either door.
 */

import type { Logger } from '@objectstack/spec/contracts';
import type { StandardErrorCode } from '@objectstack/spec/api';
import { declaresServerFault } from './error-leak.js';

/** The request coordinates an operator needs to find the failing call. */
export interface ServerFaultRequest {
    /** HTTP method, e.g. `GET`. */
    method?: string;
    /** Request path as served, e.g. `/api/v1/packages`. */
    path?: string;
    /** Correlation id — the `X-Request-Id` echoed on the response. */
    requestId?: string;
}

/** One fault, as the emitting door knows it. */
export interface ServerFaultLogInput {
    /** The HTTP status about to be written. Below 500 nothing is logged. */
    status: number;
    /**
     * The original thrown value, when the door still holds it. Carries the
     * stack; the wire body never does, because a 5xx message is withheld.
     */
    error?: unknown;
    /** The envelope's `code`, when the door resolved one. */
    code?: string;
    /**
     * The message to print when {@link ServerFaultLogInput.error} carries
     * none — a declared fault built from a string rather than a throw.
     */
    message?: string;
    /** Where the call came in. */
    request?: ServerFaultRequest;
}

/** The prefix every fault line carries, so an operator can grep one token. */
export const SERVER_FAULT_LOG_PREFIX = '[5xx]';

/**
 * THE predicate. A response is a server fault worth a line exactly when its
 * status is 5xx. Exported so a door can decide without restating `>= 500`.
 */
export function isServerFault(status: number): boolean {
    return typeof status === 'number' && status >= 500;
}

/**
 * [#14656] The ADR-0112 codes that answer **"this deployment did not install
 * that"** rather than **"something broke"**.
 *
 * Two members, and the ruling names both: the `NOT_IMPLEMENTED` /
 * `SERVICE_UNAVAILABLE` family a platform chooses when an optional service is
 * absent. `packages/runtime`'s `capabilityUnavailable` is the producer that
 * motivated the card — its `501` carries `serviceUnavailableMessage(slot)`,
 * the same remedy sentence discovery publishes for that slot, which is what
 * makes "naming the missing service" a property of the existing message rather
 * than a second string composed here.
 *
 * ⛔ Deliberately NOT derived from `HttpStatusErrorCodeMap` (`@objectstack/spec`),
 * whose 501/503 rows happen to hold these two spellings today. That map answers
 * "what code names this status when a producer declared none" — a different
 * question, and binding to it would let an edit there silently re-scope which
 * faults this funnel quiets. The membership is typed as {@link StandardErrorCode}
 * instead, so the two literals are proved to be catalogued codes at compile
 * time while the SET stays this card's own, reviewable decision.
 */
const CAPABILITY_ABSENCE_CODES: readonly StandardErrorCode[] = ['NOT_IMPLEMENTED', 'SERVICE_UNAVAILABLE'];

/**
 * The suppression, said out loud on the one line that IS printed. An operator
 * who greps a whole day's log and finds exactly one of these must be able to
 * tell "it happened once" from "it is reported once" without reading this file.
 */
const CAPABILITY_ABSENCE_NOTE = '(declared capability absence — reported once per route per process)';

/**
 * THE predicate: is this envelope a declared capability absence?
 *
 * Both halves are required, and both come from vocabulary that already exists:
 *
 *  - {@link declaresServerFault} — the producer declared a 5xx SHAPE (`status`
 *    at or above 500 with a non-empty string `code`). A door that hands this
 *    funnel a bare throw declares nothing here, so a `TypeError` that resolved
 *    to 500 can never reach the quiet branch however its message reads.
 *  - {@link CAPABILITY_ABSENCE_CODES} — and the declared code is one the
 *    ruling names.
 *
 * ⚠️ It reads the ENVELOPE the door is about to write, never `input.error`.
 * The thrown exit (`errorResponseBase`, `@objectstack/runtime`) passes the
 * throw and no `code`, so a thrown `{ status: 501, code: 'NOT_IMPLEMENTED' }`
 * keeps its per-request `error` line. That is the fail-LOUD direction and it is
 * deliberate: this card quiets the answers a door composed as a configuration
 * fact, and a door that composed an envelope has the envelope to show for it.
 */
function isDeclaredCapabilityAbsence(input: ServerFaultLogInput): boolean {
    if (!declaresServerFault({ status: input.status, code: input.code })) return false;
    return (CAPABILITY_ABSENCE_CODES as readonly string[]).includes(input.code as string);
}

/**
 * The `(route, process)` key's route half, built from the SAME coordinates the
 * line prints — so the key can never name a route the reader cannot see.
 *
 * `undefined` when the door supplied no coordinates at all. It is then NOT
 * deduped: an un-keyed bucket would collapse every route a door cannot name
 * into one entry, which is precisely the "global first N" shape the ruling
 * forbids for hiding the second route. Reporting every time is the loud
 * direction, and the door's own remedy is to supply its route.
 *
 * `@objectstack/runtime`'s `instrumentRouteHandler` parks the route PATTERN
 * (`/api/v1/ai/*`), not the raw URL — "lower cardinality than a raw path", its
 * own note — so the live key space is bounded by the mounted route set. A
 * transport that parked raw paths would key more finely, which costs extra
 * lines and hides nothing.
 */
function capabilityAbsenceRouteKey(request: ServerFaultRequest | undefined): string | undefined {
    const method = request?.method;
    const path = request?.path;
    if (method === undefined && path === undefined) return undefined;
    return `${method ?? ''} ${path ?? ''}`;
}

/**
 * The per-PROCESS half of the key: routes already reported. Module scope IS the
 * process scope the ruling asks for — a restart starts empty and reports again.
 */
const REPORTED_CAPABILITY_ABSENCE_ROUTES = new Set<string>();

/**
 * A ceiling on that registry, because a process that never restarts must not
 * grow one unbounded. At the ceiling the registry stops ADDING rather than
 * evicting: an unrecorded route reports every time (loud), where an eviction
 * policy would silently re-quiet whichever route was pushed out. Well above any
 * mounted route set; reaching it means a transport is keying on raw paths, and
 * the symptom is extra lines rather than missing ones.
 */
const CAPABILITY_ABSENCE_ROUTE_CEILING = 512;

/**
 * Claim the one report this route gets in this process. `true` exactly when
 * THIS occurrence is the one that speaks.
 */
function claimCapabilityAbsenceReport(request: ServerFaultRequest | undefined): boolean {
    const key = capabilityAbsenceRouteKey(request);
    if (key === undefined) return true;
    if (REPORTED_CAPABILITY_ABSENCE_ROUTES.has(key)) return false;
    if (REPORTED_CAPABILITY_ABSENCE_ROUTES.size >= CAPABILITY_ABSENCE_ROUTE_CEILING) return true;
    REPORTED_CAPABILITY_ABSENCE_ROUTES.add(key);
    return true;
}

/**
 * Normalize a thrown value to an `Error`, because `Logger.error`'s second
 * parameter is typed to one and a `throw 'string'` must not cost the line.
 * Returns `undefined` when there was no throw at all (a declared fault), so
 * the logger is not handed an empty synthetic stack.
 */
function toError(thrown: unknown): Error | undefined {
    if (thrown === undefined || thrown === null) return undefined;
    if (thrown instanceof Error) return thrown;
    const wrapped = new Error(typeof thrown === 'string' ? thrown : safeStringify(thrown));
    // The synthetic stack points at THIS file and would mislead; the value's
    // own text is the whole of what the producer gave us.
    wrapped.stack = undefined;
    return wrapped;
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/**
 * The human half of the line: `[5xx] 500 GET /api/v1/packages — <message>`.
 * Split out so both the emitted record and a test can name the same string.
 */
export function serverFaultLogMessage(input: ServerFaultLogInput): string {
    const err = toError(input.error);
    const text = err?.message || input.message || 'Unhandled server fault';
    const where = [input.request?.method, input.request?.path].filter(Boolean).join(' ');
    return `${SERVER_FAULT_LOG_PREFIX} ${input.status}${where ? ` ${where}` : ''} — ${text}`;
}

/**
 * The structured half. `status`/`code`/`requestId` are what a log search keys
 * on; `method`/`path` repeat the message's coordinates because a JSON sink
 * indexes fields, not prose.
 */
export function serverFaultLogMeta(input: ServerFaultLogInput): Record<string, unknown> {
    return {
        status: input.status,
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.request?.method !== undefined ? { method: input.request.method } : {}),
        ...(input.request?.path !== undefined ? { path: input.request.path } : {}),
        ...(input.request?.requestId !== undefined ? { requestId: input.request.requestId } : {}),
    };
}

/**
 * Emit EXACTLY ONE record for a 5xx, or nothing at all.
 *
 * `error` level for a fault — every 5xx, every request, which is #14310's whole
 * rule. `warn` level ONCE PER ROUTE PER PROCESS for a
 * {@link isDeclaredCapabilityAbsence declared capability absence}, which is
 * #14656's ruled exception and the only branch that can be silent above 500.
 *
 * Returns whether a record was emitted, so a caller that must not double-log
 * can branch on the answer rather than re-deriving the 5xx test. A suppressed
 * repeat answers `false`: nothing was emitted, and that is the honest answer
 * rather than a claim about what the first occurrence did.
 *
 * `logger` is optional: a door with no injected logger falls back to the
 * matching `console` method, because the point of this function is that the
 * line exists even on a surface nobody configured. ⚠️ `Logger.warn` takes
 * `(message, meta)` and has no slot for an `Error` — which costs nothing here,
 * because a declared absence is an envelope a door COMPOSED and never a throw,
 * so there is no stack to carry. Emission never throws — a logging failure must
 * not become a second fault on top of the one being reported.
 */
export function logServerFault(
    input: ServerFaultLogInput,
    logger?: Logger,
): boolean {
    if (!isServerFault(input.status)) return false;
    const absence = isDeclaredCapabilityAbsence(input);
    // The claim is made BEFORE any emission and only for the quiet family, so a
    // sink that throws below cannot cost this route its one report, and a fault
    // never touches the registry at all.
    if (absence && !claimCapabilityAbsenceReport(input.request)) return false;
    const message = absence
        ? `${serverFaultLogMessage(input)} ${CAPABILITY_ABSENCE_NOTE}`
        : serverFaultLogMessage(input);
    const meta = serverFaultLogMeta(input);
    const err = toError(input.error);
    try {
        if (logger) {
            if (absence) logger.warn(message, meta);
            else logger.error(message, err, meta);
            return true;
        }
        const sink = (globalThis as {
            console?: {
                error?: (...args: unknown[]) => void;
                warn?: (...args: unknown[]) => void;
            };
        }).console;
        if (absence) sink?.warn?.(message, meta);
        else sink?.error?.(message, { ...meta, ...(err?.stack ? { stack: err.stack } : {}) });
        return true;
    } catch {
        // Log emission must never throw — the original fault is still answered.
        return false;
    }
}

/**
 * Read request coordinates off whatever request object the transport hands
 * the door. Adapters disagree on the spelling (`path` / `url` /
 * `originalUrl`), and the request id may be on the object (set by
 * `instrumentRouteHandler`) or only on the incoming header — so both are
 * read here, once, instead of at each call site.
 */
export function describeFaultRequest(req: unknown): ServerFaultRequest {
    const r = req as {
        method?: unknown;
        path?: unknown;
        url?: unknown;
        originalUrl?: unknown;
        requestId?: unknown;
        headers?: Record<string, unknown>;
    } | undefined | null;
    if (!r || typeof r !== 'object') return {};
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    const headerId = r.headers
        ? str(r.headers['x-request-id']) ?? str(r.headers['X-Request-Id'])
        : undefined;
    const method = str(r.method);
    const path = str(r.path) ?? str(r.url) ?? str(r.originalUrl);
    const requestId = str(r.requestId) ?? headerId;
    return {
        ...(method !== undefined ? { method } : {}),
        ...(path !== undefined ? { path } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
    };
}
