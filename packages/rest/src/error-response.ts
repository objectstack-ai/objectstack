// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How a thrown thing becomes an HTTP answer — ADR-0112's concern, at the REST
 * boundary.
 *
 * [#8850] Moved here from `rest-server.ts`, where this code sat at module level
 * ahead of the `RestServer` class for historical rather than structural
 * reasons: none of it reads class state, and the class body is not its subject.
 * The move is a MOVE — every function below is byte-identical to the version
 * that lived in `rest-server.ts`, with one deliberate exception recorded so a
 * reviewer does not have to find it: {@link mapDataError}'s docblock had drifted
 * away from its function (it was stranded above an unrelated import) and is
 * reattached here.
 *
 * ⛔ This is NOT the ADR-0076 D11 decomposition, which the maintainer ruling of
 * 2026-08-15 on #5949 closed (option B). No `registerXxxEndpoints` method moved,
 * and none is going to; the justification here is coherence alone.
 *
 * What the file owns, in the order a thrown error meets it:
 *
 *   classification  {@link mapDataError} — the error → `{ status, body }` table,
 *                   with {@link declaredHttpStatus}, {@link isScriptFaultMessage}
 *                   and {@link missingRelationIsObject} as its judgements and
 *                   {@link DATA_STORE_FAULT} / {@link UNCLASSIFIED_FAULT} as its
 *                   two sanitised 5xx terminals.
 *   resolution      {@link resolveErrorResponse} — the same answer WITHOUT
 *                   emitting it, so the logging decision and the responder can
 *                   never form two opinions (#4886).
 *   emission        `sendThrownError` / `sendDeclaredFault` / `handleRouteError`
 *                   — the doors a route catch block and a deciding handler use.
 *                   block uses.
 *   log verdict     {@link isExpectedRouteError} and friends — whether a
 *                   response is a fault worth "[REST] Unhandled error".
 *   response shaping `droppedFieldsHeaderValue` / `applyDroppedFieldsHeader` —
 *                   the one pair here that is not error classification: they
 *                   decorate a SUCCESSFUL write (#3431). They travelled with the
 *                   block because they are the rest of "what this boundary puts
 *                   on the wire", and splitting them out would have created a
 *                   third module for two functions.
 *
 * Export surface: `mapDataError` is the only member this code has ever been
 * public in, and `rest-server.ts` re-exports it from here unchanged — the three
 * test files that `import { mapDataError } from './rest-server.js'` are
 * untouched by the move. The rest is exported only as far as `rest-server.ts`
 * needs it and is absent from the package index, exactly as before.
 */

import {
    looksLikeInternalErrorLeak,
    isUniqueViolationError,
    uniqueViolationColumn,
    matchMissingColumnOfRelation,
    declaresServerFault,
    resolveThrownHttpError,
    demotedDeclaredCode,
    INTERNAL_ERROR_MESSAGE,
} from '@objectstack/types';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import type { ErrorCode } from '@objectstack/spec/api';
import { logError } from './log.js';

/**
 * How many characters of a domain error's OWN message reach the client.
 *
 * Deliberately the same 500 the two status-passthrough branches have always
 * used — #5423 changed what happens AT the bound, not where the bound sits.
 */
const CLIENT_MESSAGE_MAX = 500;

/**
 * [#5423] Bound an explicit-status domain error's message by TRUNCATING it,
 * never by replacing it wholesale.
 *
 * Both status-passthrough branches (in {@link mapDataError} and
 * {@link resolveErrorResponse}) used to swap any message of 500+ characters for
 * the literal `'Request failed'` — `code` and `status` landed as usual and the
 * entire body text vanished. That inverted the incentive on every carefully
 * worded rejection in the repo: the driver-sql filter refusals exist ONLY to
 * tell an author which operator/field they got wrong and how the spec declares
 * it, and the two longest of them (#5158's unlowered `FilterArray`, #5347's
 * `$null` non-boolean comparand) were already over the line — so the more
 * precisely a rejection was written, the more certainly the client received
 * nothing but `{ "code": "INVALID_FILTER", "error": "Request failed" }`.
 * Adding `status: 400` to make a message client-visible (#4436's intent) made
 * it strictly LESS readable in that band.
 *
 * Truncation keeps the part that is worth reading. These messages front-load
 * the main clause — the operator, the field, the path, what arrived and what
 * the spec declares — and back-load attribution and issue numbers, which
 * belong in the log rather than the response.
 *
 * The bound is NOT a leak defence and never was: length is not a proxy for
 * "contains SQL", a 200-character driver dump passed the old gate untouched,
 * and these messages have already cleared `looksLikeInternalErrorLeak` /
 * `isSqlLeak` before reaching here. Same shape as the drivers' own
 * `safeShapePreview` (`packages/drivers/driver-sql`), which previews rather
 * than erases.
 *
 * [#5437] That last paragraph turned out to be the other branch's bug report:
 * `resolveErrorResponse` was applying this same bound to 5xx messages, where
 * "short" meant "shipped verbatim" and driver errors are short. Its half of the
 * passthrough is now 4xx-only, so this helper is reached only by messages
 * written for the caller. Both call sites are therefore 4xx today.
 */
function truncateClientMessage(message: string): string {
    return message.length < CLIENT_MESSAGE_MAX
        ? message
        : `${message.slice(0, CLIENT_MESSAGE_MAX - 1)}…`;
}

/**
 * [#5462] The envelope for "the data store failed and the client cannot fix
 * it": a sanitised 500 carrying the catalog's `DATABASE_ERROR`.
 *
 * The SQL-leak branch has emitted exactly this for as long as it has existed;
 * it is a function now only so the missing-relation branch above it cannot
 * drift into a second spelling of the same verdict. 500 is deliberately outside
 * `isExpectedDataStatus`, which is what buys the log line the silent 404 never
 * had — `handleRouteError` prints `[REST] Unhandled error` and `sendThrownError`'s
 * `logWithheldServerFault` (#5437) covers the routes that bypass it, so the
 * withheld driver text always lands somewhere an operator can read it.
 */
const DATA_STORE_FAULT = (): { status: number; body: Record<string, unknown> } => ({
    status: 500,
    body: { error: 'Internal data error', code: 'DATABASE_ERROR' },
});

/**
 * [#5489] The envelope for "nothing in this mapper recognised the error": a
 * sanitised 500 carrying the catalog's `INTERNAL_ERROR`.
 *
 * This is `mapDataError`'s TERMINAL branch, and until now it answered
 * `{ status: 400, error: <the raw message> }`. Both halves of that were wrong
 * in the same direction:
 *
 *  - **400 says the CALLER is at fault**, and an SDK reads it as "do not
 *    retry, fix the request". The errors that actually reach here are the ones
 *    no branch above could attribute to the request at all — a metadata store
 *    that cannot be read (`matchEndpoint` throws rather than answering an empty
 *    set, precisely so an outage does not masquerade as a miss; ADR-0110 D3),
 *    or a plain handler bug (`TypeError: x is not a function`). Both are server
 *    faults that a caller cannot fix and a caller SHOULD retry. Measured on
 *    `GET /api/v1/meta/api` with a store that throws
 *    `Error('metadata store unreachable')`: HTTP 400 (#5224 / PR #5487 left the
 *    assertion at `>= 400` rather than pin this as intended).
 *  - **The raw message shipped verbatim**, which is the exact discipline
 *    #5437/#5464 closed one branch up: a declared 5xx drops its prose because
 *    length was never a proxy for leakage. An error that matched no heuristic
 *    is the LEAST attributable text in the file — this branch is reached only
 *    because `looksLikeInternalErrorLeak` said nothing, and #5462 already
 *    recorded that a negative from a keyword heuristic is not evidence of
 *    safety. The words still reach the operator: 500 is outside
 *    `isExpectedDataStatus`, so `handleRouteError` prints `[REST] Unhandled
 *    error` with the whole error, and `sendThrownError`'s `logWithheldServerFault`
 *    covers the routes that bypass it.
 *
 * `INTERNAL_ERROR` rather than {@link DATA_STORE_FAULT}'s `DATABASE_ERROR`, and
 * the distinction is deliberate: `DATA_STORE_FAULT` is emitted where the
 * evidence NAMES a store failure (a driver's missing-relation phrasing, a
 * `looksLikeInternalErrorLeak` hit), so it can honestly say "database". Here
 * the defining fact is that there is no evidence of anything — sending a
 * handler `TypeError` back as `DATABASE_ERROR` would point an operator at a
 * database that is fine. `INTERNAL_ERROR` is not a third vocabulary either: it
 * is what `standardErrorCodeForHttpStatus(500)` yields (`HttpStatusErrorCodeMap`
 * in `@objectstack/spec`) — the catalog's own floor for "500 with no more
 * specific code" — and the message is the same `INTERNAL_ERROR_MESSAGE` the
 * declared-5xx branch of {@link resolveErrorResponse} already emits.
 *
 * What did NOT move: every branch above this one. A client error is a 4xx here
 * because a producer DECLARED `status` in the 4xx band or because a branch
 * matched it by `code`/name/phrasing — validation, permission, unknown object,
 * unknown field, not-null drift, unique violation, the sandbox unwraps. This
 * branch is the one that had nothing to go on, and "no idea" is a server-side
 * answer, not a client-side one.
 */
const UNCLASSIFIED_FAULT = (): { status: number; body: Record<string, unknown> } => ({
    status: 500,
    body: { error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' },
});

/**
 * [#7543] Does an unwrapped sandbox message name a JS RUNTIME fault rather than
 * a business refusal the hook body deliberately reported?
 *
 * The two sandbox-unwrap branches below exist for ONE shape: a hook or action
 * body that runs `throw new Error('删除被阻断：仍有未结清的发票')`, i.e. an
 * author writing a business rule whose message IS the remedy. They answer 400
 * with that message verbatim and deliberately no `code` (see each branch).
 *
 * A body that instead CRASHES — `ctx.input.title.trim()` where `title` is the
 * number `12345` — also arrives as a thrown error, so it entered the same
 * branch and its raw `TypeError: not a function` went out as the client-facing
 * message of a 400 with no `code`. That is two contract breaks at once: an
 * internal runtime fault echoed verbatim, and a body outside the ledgered
 * envelope (a client keying on `code` gets nothing).
 *
 * The classification this restores is NOT new policy — it is the ruling
 * {@link UNCLASSIFIED_FAULT} already records one door down, which names this
 * exact case ("or a plain handler bug (`TypeError: x is not a function`) …
 * server faults that a caller cannot fix and a caller SHOULD retry"). The
 * sandbox unwraps simply sit ABOVE that branch and were intercepting the crash
 * before it could reach the answer the file had already settled on. Same
 * separation `quickjs-runner`'s own `sandboxFault` path draws (#4431/#3951):
 * the sandbox REFUSING is a fault, and so is the body FAULTING — only the
 * body's deliberate `throw` is an answer addressed to the caller.
 *
 * **Matched by constructor name, not by phrasing.** These eight are the ECMA-262
 * native error constructors (plus SpiderMonkey's `InternalError`, which QuickJS
 * also raises for stack exhaustion); the sandbox stringifies a thrown error as
 * `<name>: <message>`, so the name is structural evidence rather than a keyword
 * heuristic over prose. `Error:` is deliberately absent — a plain `Error` is the
 * documented way to author a refusal, and `userFacingMessage` strips that prefix
 * upstream anyway.
 *
 * **Deliberate, accepted cost:** a body that expresses a business rule as
 * `throw new RangeError('数量超出范围')` now gets the sanitised 500 instead of
 * its own words. That authoring style is not the documented one, and erring
 * toward "a native error name means a crash" is the fail-safe direction — the
 * opposite default is what shipped `TypeError: not a function` to a client.
 *
 * The words are not lost: 500 is outside `isExpectedDataStatus`, so
 * `handleRouteError` prints `[REST] Unhandled error` with the whole error, and
 * `sendThrownError`'s `logWithheldServerFault` (#5437) covers the routes that bypass
 * it — the same operator path {@link UNCLASSIFIED_FAULT} relies on.
 */
const NATIVE_ERROR_NAME_RE =
    /^(?:Type|Reference|Range|Syntax|URI|Eval|Internal|Aggregate)Error(?::|$)/;

function isScriptFaultMessage(message: string): boolean {
    return NATIVE_ERROR_NAME_RE.test(message.trim());
}

/**
 * [#5462] Does a driver's missing-relation message name the very object this
 * request asked for?
 *
 * Both halves must hold. `object` is the object the ROUTE named (`undefined` on
 * every metadata / UI / discovery route — they call `handleRouteError(res,
 * error)`), and the relation name is whatever the driver's phrasing carries:
 *
 *   SQLite    `SQLITE_ERROR: no such table: acct`      → `acct`
 *   SQLite    `no such table: main.acct`               → `acct` (schema stripped)
 *   Postgres  `relation "public.acct" does not exist`  → `acct`
 *   generic   `table not found`                        → nothing to attribute
 *
 * Prime Directive #6 is what makes the comparison sound rather than a guess:
 * the object `name` IS the table name, always, with no `tableName` mapping to
 * launder it. So "the missing table is not the object you asked for" really
 * does mean the failure is somewhere other than the caller's object — an
 * auxiliary table, a system table, or the metadata plane itself.
 *
 * A message that names NO relation is unattributable and therefore not a
 * match: the fail-loud direction is what this issue asked for, and there is no
 * producer of the bare `table not found` phrasing in this repo to regress.
 */
/**
 * [#7525] The HTTP status a producer DECLARED for this error, or `undefined`
 * when it declared none — read over BOTH spellings the repo's producers use,
 * `status` first and `statusCode` second.
 *
 * **This is the seam the hook-refusal defect lived on.** `mapDataError`'s
 * passthrough asked `typeof error.status === 'number'` and nothing else, while
 * an engine lifecycle hook that refuses a write declares its status as
 * `statusCode`:
 *
 * ```ts
 * // plugin-approvals/src/lifecycle-hooks.ts
 * err.code = 'RECORD_LOCKED'; err.statusCode = 409;   // a pending lockRecord approval
 * err.code = 'FORBIDDEN';     err.statusCode = 403;   // a forged delegation row
 * ```
 *
 * So the refusal never reached the passthrough at all: it fell past every
 * structured branch, matched no message heuristic, and left through
 * `UNCLASSIFIED_FAULT` as `500 INTERNAL_ERROR` with no `code` — for a
 * deliberate, well-understood business refusal, on every direct `/api/v1/data`
 * caller. #5582 widened that same passthrough's *range* (4xx -> 400-599) and is
 * not the fix here; the status was being dropped one question earlier, at
 * "did the producer declare one".
 *
 * **Why the boundary rather than the two hooks.** `status` -> `statusCode` -> default
 * is already what EVERY other HTTP exit in this repo reads — `runtime`'s
 * `HttpDispatcher.errorFromThrown` (#3867), `dispatcher-plugin.errorResponseBase`,
 * `endpoint-executor`, `domains/actions`, `plugin-hono-server`'s user endpoints.
 * `mapDataError` was the one exit that read a single spelling, which is why one
 * thrown error came back as `403` through a dispatcher route and as `500`
 * through `/api/v1/data`. Teaching the two approvals hooks to spell it `status`
 * would fix two producers and leave the boundary answering 500 for the next
 * one — including `runtime`'s own `action-execution.ts`, which throws
 * `{ statusCode: 503 | 501 | 400 }`, and `metadata-protocol`'s
 * `{ statusCode: 404 }`. The producers are well-behaved; the exit was strict
 * about a spelling nobody standardised.
 *
 * ⚠️ Deliberately NOT the same question as {@link declaresServerFault}, whose
 * `status`-only read is UNCHANGED and stays that way (#5811): that predicate is
 * a *disclosure* rule — "may this message be withheld" — and was ruled to not
 * depend on which spelling a producer reached for. This is *status resolution*,
 * the read that has always been two-spelling everywhere else.
 *
 * The band is the same 400-599 {@link resolveErrorResponse} opens, so a
 * nonsense status is not a declaration. A non-numeric `status` falls through to
 * `statusCode` rather than blocking it, which is what makes better-auth's
 * `APIError` (`{ statusCode: 403, status: 'FORBIDDEN' }` — the status field is a
 * STRING there) resolve to the status it meant instead of to nothing.
 */
function declaredHttpStatus(error: any): number | undefined {
    const declared =
        (typeof error?.status === 'number' ? error.status : undefined) ??
        (typeof error?.statusCode === 'number' ? error.statusCode : undefined);
    if (declared === undefined || !(declared >= 400 && declared < 600)) return undefined;
    return declared;
}

/**
 * [#9232] The flat door's `code` fields for a THROWN error: the closed
 * ADR-0112 `code`, plus the open `declaredCode` sibling when the producer's own
 * spelling did not survive into it.
 *
 * ## Why this exists
 *
 * The 2026-08-16 ruling on #9106 made `error.code` a closed vocabulary at every
 * door and demoted an unregistered thrown spelling to a `declaredCode` sibling.
 * That ruling's scope named the doors served by `resolveThrownHttpError` — the
 * dispatcher exits and the direct-mount package registrar — and left THIS one
 * out, because the flat dialect puts `code` at the body's TOP level rather than
 * in `error.code`. So the flat responder went on passing a caught error's
 * `code` through verbatim, and an ADR sentence amended to read "closed at every
 * door" was contradicted by an observable door: exactly the reader ambiguity
 * #9106 was filed to remove, one door over. The 2026-08-17 ruling on #9232
 * closed it — body POSITION is not a carve-out from the vocabulary.
 *
 * ## Why it delegates rather than restating the rule
 *
 * `resolveThrownHttpError` / {@link demotedDeclaredCode} (`@objectstack/types`,
 * anchored in `scripts/adr-anchors/`) are the ONE definition of both spellings,
 * and the three dispatcher exits read them rather than re-deriving them. A
 * fourth open-coded `ErrorCode.safeParse(...)` here would be a second
 * definition of one rule — the shape that let two doors answer differently in
 * the first place. The status this boundary already resolved is passed in as
 * the fallback, so the demote is computed against the status the client will
 * actually receive.
 *
 * ## The three answers, and why "no code" stays "no code"
 *
 *  - the producer spelled a REGISTERED code  → `{ code }`, verbatim, unchanged.
 *  - the producer spelled an UNREGISTERED one → `{ code, declaredCode }`: the
 *    member the status derives, and the producer's string beside it. Presence
 *    of `declaredCode` means demotion, exactly as `ApiErrorSchema.declaredCode`
 *    documents for the nested envelope.
 *  - the producer spelled NO string code → `{}`. Nothing is invented: ADR-0112
 *    says the PRODUCER names the condition, so a half-declaration is honoured
 *    for the half that was declared. That is the answer this file already gave
 *    (see the 5xx arm of {@link mapDataError}) and it is deliberately preserved
 *    — narrowing the vocabulary must not start ADDING codes to bodies that
 *    carried none.
 *
 * ⚠️ "No string code" is what `resolveThrownHttpError` means by it, which is
 * stricter than the truthiness check {@link resolveErrorResponse}'s two arms
 * used to apply: a NON-string truthy `code` — a numeric driver errno — is
 * context rather than a wire code (the drift #3842 removed), so it no longer
 * reaches the flat body at all. It could not have been a legal ADR-0112 code in
 * any case; a number in the field callers branch on is the loudest possible
 * violation of a closed vocabulary. All four flat arms now ask ONE question.
 */
function thrownCodeFields(error: any, status: number): { code?: string; declaredCode?: string } {
    const thrown = resolveThrownHttpError(error, status);
    if (thrown.declaredCode === undefined) return {};
    const demoted = demotedDeclaredCode(thrown);
    return { code: thrown.code, ...(demoted !== undefined ? { declaredCode: demoted } : {}) };
}

/**
 * [#8264] Postgres' missing-relation template, anchored on the QUOTED
 * identifier the driver always emits — never on the bare "does not exist"
 * tail, which is ordinary business English. Module-scoped (not re-compiled
 * per {@link mapDataError} call) and named, not inlined, so both of its
 * readers share the literal same pattern. See the long note above
 * `looksLikeMissingRelation`'s definition, further down this file, for why
 * this is one width, not "two widths, on purpose".
 */
const RELATION_DOES_NOT_EXIST = /\brelation\s+["'`][^"'`]+["'`]\s+does not exist/i;

function missingRelationIsObject(raw: string, object: string | undefined): boolean {
    if (!object) return false;
    const named =
        /no such table:?\s*["'`[]?([a-z0-9_.$]+)/i.exec(raw) ||
        /relation\s+["'`]?([a-z0-9_.$]+)["'`]?\s+does not exist/i.exec(raw);
    const relation = named?.[1]?.toLowerCase().split('.').pop();
    return relation !== undefined && relation === object.toLowerCase();
}

/**
 * Map a data-layer error to a clean HTTP response. Unknown-object errors are
 * surfaced as a 404 with `code: 'OBJECT_NOT_FOUND'` so clients can distinguish
 * "object isn't registered" from real server faults. Anything else becomes a
 * 400 (bad request) preserving prior behavior. Genuine 500s are still logged.
 *
 * Two sources produce that 404, and since #3770 the FIRST one is the primary:
 *  - `code: 'OBJECT_NOT_FOUND'` from the protocol's registry gate
 *    (`assertObjectRegistered`) — an authoritative, driver-independent answer
 *    raised before the object name is ever turned into a table name.
 *  - Driver error strings (SQLite "no such table", PG "relation does not
 *    exist", …) — retained as the safety net for the *other* failure, an
 *    object that IS registered but whose physical table is missing (metadata /
 *    schema drift), plus engine-direct callers that bypass the protocol.
 *    Before #3770 this string match was the ONLY thing producing the 404,
 *    which is why an unregistered object whose table happened to exist was
 *    served instead of rejected.
 *
 * `PermissionDeniedError` (thrown by `SecurityPlugin`) MUST be caught
 * before the unknown-object heuristic, otherwise its message —
 * "[Security] Access denied: operation 'insert' on object 'sys_user' is
 * not permitted …" — trips the `'<obj>' … not` substring check and
 * returns a misleading 404.
 */
export function mapDataError(error: any, object?: string): { status: number; body: Record<string, unknown> } {
    // Referential-integrity restrict on delete → 409 with the dependent count.
    // Surfaced FIRST so the structured fields survive the generic catch-alls.
    if (error?.code === 'DELETE_RESTRICTED') {
        return {
            status: 409,
            body: {
                error: error?.message ?? 'Cannot delete: dependent records exist',
                code: 'DELETE_RESTRICTED',
                // [#7307] `error` is the END USER's half — localized, labels
                // only — because Console renders it verbatim in a toast.
                // `developerMessage` is the other half the engine now splits
                // out: the API names and the `deleteBehavior:'cascade'` remedy,
                // in a field no user-facing surface reads. Shipping it here is
                // what keeps the guidance REACHABLE for the app builder who is
                // hitting this over HTTP — dropping it at the transport would
                // move the defect rather than fix it. It discloses nothing the
                // envelope did not already carry: `dependentObject` and
                // `object` are API names on the same body.
                ...(typeof error?.developerMessage === 'string' && error.developerMessage.length > 0
                    ? { developerMessage: error.developerMessage }
                    : {}),
                ...(error?.dependentObject ? { dependentObject: error.dependentObject } : {}),
                ...(typeof error?.dependentCount === 'number' ? { dependentCount: error.dependentCount } : {}),
                ...(object ? { object } : {}),
            },
        };
    }
    // Optimistic-Concurrency-Control mismatch → 409 with current state.
    // Surfaced FIRST so the structured fields (`currentVersion`,
    // `currentRecord`) are preserved instead of being squashed into the
    // generic SQL-leak / catch-all paths below.
    if (error?.code === 'CONCURRENT_UPDATE' || error?.name === 'ConcurrentUpdateError') {
        return {
            status: 409,
            body: {
                error: error?.message ?? 'Record was modified by another user',
                code: 'CONCURRENT_UPDATE',
                ...(error?.currentVersion ? { currentVersion: error.currentVersion } : {}),
                ...(error?.currentRecord ? { currentRecord: error.currentRecord } : {}),
                ...(object ? { object } : {}),
            },
        };
    }
    // A declared datasource that is refused by the host policy, or failed to
    // connect under OS_ALLOW_DRIVER_CONNECT_FAILURE → 503 (framework#3828).
    // Handled before the catch-alls because nothing about the REQUEST is wrong:
    // the deployment cannot serve this object right now. 503 (not 500) is the
    // honest answer — it is a dependency outage or a policy state, it may clear,
    // and it tells a caller/proxy that retrying elsewhere or later is sensible.
    // The message is already sanitised at the throw site (no DSN, host, or
    // operator-facing policy reason), so it is safe to pass through verbatim.
    if (error?.code === 'ERR_DATASOURCE_UNAVAILABLE') {
        return {
            status: 503,
            body: {
                error: error?.message ?? 'The datasource for this object is not available',
                code: 'ERR_DATASOURCE_UNAVAILABLE',
                ...(error?.datasource ? { datasource: error.datasource } : {}),
                ...(error?.kind ? { reason: error.kind } : {}),
                ...(object ? { object } : {}),
            },
        };
    }
    // Validation failures → 400 with per-field envelope. Handled FIRST
    // because the validator throws a typed error before any SQL ever
    // runs, and we want callers to differentiate "your payload was
    // invalid" (fixable client-side) from generic 400s.
    if (error?.code === 'VALIDATION_FAILED' || error?.name === 'ValidationError') {
        return {
            status: 400,
            body: {
                error: error?.message ?? 'Validation failed',
                code: 'VALIDATION_FAILED',
                fields: Array.isArray(error?.fields) ? error.fields : [],
                ...(object ? { object } : {}),
            },
        };
    }
    // Capability gates (#2707 feeds / #2727 files): plugin-audit's engine
    // hooks reject sys_comment / sys_attachment inserts fail-closed when the
    // TARGET object's capability flag disallows them. 403 like
    // CLONE_DISABLED; surfaced by `code` because the generic data routes map
    // through here (they never reach sendThrownError's `.status` passthrough).
    // `error.object` names the gated TARGET object (not the join table), so
    // prefer it.
    if (error?.code === 'FEEDS_DISABLED' || error?.code === 'FILES_DISABLED') {
        return {
            status: 403,
            body: {
                error: error?.message ?? 'This capability is disabled for the target object',
                code: error.code,
                ...(error?.object || object ? { object: error?.object ?? object } : {}),
            },
        };
    }
    // Attachment access gates (#2755): service-storage's engine hooks reject
    // sys_attachment writes fail-closed when the caller cannot see the parent
    // record (create) or is neither the uploader nor a parent editor
    // (delete). Same mapping rationale as the capability gates above.
    if (error?.code === 'ATTACHMENT_PARENT_ACCESS' || error?.code === 'ATTACHMENT_DELETE_DENIED') {
        return {
            status: 403,
            body: {
                error: error?.message ?? 'Attachment access denied',
                code: error.code,
                ...(error?.object || object ? { object: error?.object ?? object } : {}),
            },
        };
    }
    // Comment access gates (#4630): plugin-audit's engine hooks reject
    // sys_comment writes fail-closed when the caller cannot read the record
    // behind `thread_id` (create) or is neither the author nor a parent editor
    // (update/delete). Uses the STANDARD catalog code rather than a bespoke
    // one (ADR-0112: generic permission conditions take the catalog), and is
    // matched here — ahead of the generic 4xx passthrough — for the same
    // reason as the attachment gates: `error.object` names the record's object
    // (not the join/comment table) and the passthrough would drop it.
    if (error?.code === 'RECORD_NOT_ACCESSIBLE') {
        return {
            status: 403,
            body: {
                error: error?.message ?? 'Record access denied',
                code: 'RECORD_NOT_ACCESSIBLE',
                ...(error?.object || object ? { object: error?.object ?? object } : {}),
            },
        };
    }
    // Short-circuit: explicit security denial → 403. Match by `code` /
    // `name` to avoid pulling a runtime dependency on plugin-security.
    if (
        error?.code === 'PERMISSION_DENIED' ||
        error?.name === 'PermissionDeniedError' ||
        (typeof error?.message === 'string' && error.message.startsWith('[Security] Access denied'))
    ) {
        return {
            status: 403,
            body: {
                error: error?.message ?? 'Permission denied',
                code: 'PERMISSION_DENIED',
                ...(object ? { object } : {}),
            },
        };
    }
    // Sandboxed hook/action bodies (QuickJS) throw SandboxError whose
    // `.message` carries a `<kind> '<name>' threw: <msg>` debug wrapper for
    // server logs, with the original business message preserved on
    // `.innerMessage` (see runtime/src/sandbox/quickjs-runner.ts). End users
    // must see only the business message — a hook's `throw new Error('删除被
    // 阻断…')` is a deliberate business rule, not a fault — the same unwrap
    // the custom-action route performs in http-dispatcher's handleAction.
    // The full wrapper still reaches server logs via the callers'
    // "[REST] Unhandled error" logging and the BodyRunner's own error log.
    // Deliberately NO `code` field: older @objectstack/client builds (still
    // bundled in deployed consoles) prepend any `code` to the human-readable
    // message, which would reintroduce the English noise this branch removes.
    if (typeof error?.innerMessage === 'string' && error.innerMessage) {
        // [#7543] …but only when the body REPORTED something. A body that
        // CRASHED arrives here too, and its `TypeError: not a function` is an
        // internal fault, not a business message — see
        // {@link isScriptFaultMessage}.
        if (isScriptFaultMessage(error.innerMessage)) return UNCLASSIFIED_FAULT();
        return {
            status: 400,
            body: {
                error: error.innerMessage,
                ...(object ? { object } : {}),
            },
        };
    }
    // [#3770] Object does not exist — thrown by the protocol's registry gate
    // (`assertObjectRegistered`, which covers every data entry point) and by
    // `cloneData`. Mapped to the SAME envelope the driver-string branch below
    // produces, so one condition has exactly one wire code (`OBJECT_NOT_FOUND`,
    // a `StandardErrorCode` member) no matter which layer detected it — the
    // point of #3770 is that this 404 no longer depends on a driver erroring
    // on a missing table. Must precede the generic 4xx passthrough, which
    // would otherwise ship the internal SCREAMING_CASE code verbatim.
    if (error?.code === 'OBJECT_NOT_FOUND') {
        const name = error?.object ?? object;
        return {
            status: 404,
            body: {
                error: name ? `Object '${name}' is not registered` : 'Object not found',
                code: 'OBJECT_NOT_FOUND',
                ...(name ? { object: name } : {}),
            },
        };
    }
    // [#4134] Unknown field named by a READ — the protocol's list normalizer
    // refusing to lower a query parameter that matches no field into an
    // implicit filter that could only ever match zero rows. Emitted in the SAME
    // envelope as the driver-string branch below (which catches the write-path
    // form of the identical mistake), so one condition has one wire shape no
    // matter which layer noticed it. Must precede the generic 4xx passthrough,
    // which would ship the message but drop `field`.
    if (error?.code === 'INVALID_FIELD') {
        const name = error?.object ?? object;
        return {
            status: 400,
            body: {
                error: String(error?.message ?? 'Request references a field that does not exist'),
                code: 'INVALID_FIELD',
                ...(typeof error?.field === 'string' && error.field ? { field: error.field } : {}),
                ...(name ? { object: name } : {}),
            },
        };
    }
    // Generic passthrough for domain errors that already carry an explicit
    // HTTP status (e.g. plugin-sharing's record-scope denial: status 403 +
    // code FORBIDDEN) — mirrors sendThrownError's `.status` handling, which the
    // generic data routes bypass by calling mapDataError directly (#2926 ⑦).
    // Placed AFTER the structured-code branches above (409s carry rich fields
    // this envelope would drop).
    //
    // [#5582] The range is 400–599, the same door {@link resolveErrorResponse}
    // opens. It used to stop at 4xx, argued as "5xx messages keep going through
    // the sanitizing heuristics below so internal/SQL details never reach the
    // client verbatim" — which was the right FEAR and the wrong CURE, and
    // #5437/#5464 already ruled on it one door over. Two consequences, both
    // measured:
    //
    //  - **The declaration was destroyed to protect the prose.** The two
    //    doors gave opposite answers to one question ("the producer declared a
    //    status"): a `502` reporting an unreachable upstream came back as
    //    `500 INTERNAL_ERROR` on every CRUD data route and as `502` on every
    //    metadata/UI/discovery route. 502/503 are not synonyms of 500 — they
    //    are `isExpectedDataStatus` lifecycle outcomes, and proxies and retry
    //    policies read them differently.
    //  - **The status was then re-derived from the message TEXT**, which is
    //    exactly what {@link resolveErrorResponse}'s docblock forbids: an error
    //    that declared its own condition had that condition overwritten by a
    //    keyword heuristic, or (matching none) by `UNCLASSIFIED_FAULT`. Since
    //    #5907 that is live rather than theoretical: `driver-sql` and
    //    `driver-turso` throw `status: 501` / `code: NOT_IMPLEMENTED` for a
    //    spec-declared aggregate function the backend cannot compile
    //    (`count_distinct` / `array_agg` / `string_agg`), those functions clear
    //    the protocol's shape gate, and the throw reaches these routes — so the
    //    caller was told `500 INTERNAL_ERROR` ("the server fell over") instead
    //    of `501 NOT_IMPLEMENTED` ("this backend does not implement that
    //    declared capability"). The ADR-0112 code was overwritten, not just the
    //    status.
    //
    // The fear is answered structurally instead, by the arm below: in the 5xx
    // band the message is dropped UNCONDITIONALLY, so no phrasing a producer
    // can pick — deliberately or by accident — carries driver text past this
    // boundary. Sanitising here is strictly tighter than the old fallthrough,
    // which shipped a 5xx's raw words verbatim whenever they tripped no
    // keyword (`connect ECONNREFUSED 10.0.0.5:5432` did exactly that until
    // #5489 turned the terminal branch into a sanitised 500).
    //
    // Not a diagnostics loss: every caller pairs this with
    // `logUnexpectedRouteError`, whose `logWithheldServerFault` half (#5437)
    // fires precisely when a response dropped the error's own message — so the
    // 502/503 band that `isExpectedRouteError` keeps quiet still leaves the
    // operator a line carrying the full original error.
    //
    // [#7525] The gate is {@link declaredHttpStatus} rather than an in-line read
    // of `error.status`: the same 400-599 band, asked over both spellings a
    // producer may have declared it in. See that docblock for why an engine
    // hook's refusal never reached this branch at all.
    const declaredStatus = declaredHttpStatus(error);
    if (declaredStatus !== undefined) {
        // [#5582] A declared server fault: keep the status, keep the
        // machine-readable `code`, drop the prose. Byte-identical to
        // {@link resolveErrorResponse}'s 5xx arm — one condition, one wire
        // answer, whichever door caught it.
        //
        // The `code` rides along on {@link declaresServerFault}, the criterion
        // `@objectstack/types` already owns for "this producer DECLARED a
        // server fault" (`status >= 500` *and* a non-empty string `code`; PR
        // #6122, pinned by `error-leak.test.ts`, read by the analytics route
        // here and by `runtime`'s dispatcher). Inside this branch its status
        // half is already true, so what it adds is the `code` half — and it
        // adds it as a TESTED predicate rather than a fourth open-coded
        // truthiness check, which is what keeps a numeric driver `errno` or an
        // empty string from landing on the wire as an ADR-0112 code.
        //
        // A 5xx with NO code passes its status through carrying no code at all,
        // deliberately: ADR-0112 says the PRODUCER names the condition, so a
        // half-declaration is honoured for the half that was declared and
        // nothing is invented for the half that was not. That is the answer
        // `resolveErrorResponse` already gives the same shape
        // (`rest-5xx-message-sanitization.test.ts` §"a dynamically-assigned
        // status is treated identically"), and inventing `INTERNAL_ERROR` here
        // would put a code on the wire the producer never wrote — while
        // re-deriving the status from the message text is the defect this
        // branch exists to remove.
        //
        // [#7525] It is asked over the RESOLVED status — `declaresServerFault({
        // status: declaredStatus, code: error?.code })` — not over the raw
        // error, and the two arguments are the predicate's entire input, so
        // nothing about its verdict is loosened. Asking it over the raw error
        // instead would split this branch against itself: a producer declaring
        // `{ statusCode: 503, code: 'SERVICE_UNAVAILABLE' }` would take the 5xx
        // arm (the status resolved) and then be told it declared no server
        // fault (the `status` field being absent), shipping a 503 with its
        // ADR-0112 code silently dropped. The predicate's OWN read stays
        // `status`-only for its own callers — this is one call site handing it
        // the status this boundary just resolved.
        //
        // [#9232] The `code` that rides along is now the NARROWED one:
        // {@link thrownCodeFields} answers with the closed member and puts an
        // unregistered spelling in `declaredCode` beside it. `declaresServerFault`
        // still decides WHETHER a code rides — its non-empty-string half is the
        // same question `thrownCodeFields` asks internally, so the two agree by
        // construction and this arm's body-shape decision is unchanged.
        if (declaredStatus >= 500) {
            return {
                status: declaredStatus,
                body: {
                    error: INTERNAL_ERROR_MESSAGE,
                    ...(declaresServerFault({ status: declaredStatus, code: error?.code })
                        ? thrownCodeFields(error, declaredStatus)
                        : {}),
                },
            };
        }
        // [#5423] The 4xx arm is UNCHANGED by #5582: a 4xx message is addressed
        // TO the caller and is the remedy, so it keeps its wording, its
        // `object`, and the bound as a TRUNCATION rather than a replacement.
        // An over-long message is TRUNCATED, not swapped for generic text
        // (#5423) — see {@link truncateClientMessage}. A missing or empty one
        // still degrades to `'Request failed'`: there is nothing to truncate.
        const msg = typeof error?.message === 'string' && error.message.length > 0
            ? truncateClientMessage(error.message)
            : 'Request failed';
        // [#9232] Same narrowing as the 5xx arm above. The gate this replaces
        // (`typeof error?.code === 'string' && error.code`) is exactly the
        // question {@link thrownCodeFields} asks, so which bodies carry a
        // `code` at all is unchanged here; only the VALUE can move, and only
        // for a spelling the ADR-0112 union does not contain.
        return {
            status: declaredStatus,
            body: {
                error: msg,
                ...thrownCodeFields(error, declaredStatus),
                ...(object ? { object } : {}),
            },
        };
    }

    // [#6250] Unique-constraint conflict → 409 `UNIQUE_VIOLATION`.
    //
    // The verdict is the shared `isUniqueViolationError` predicate
    // (`@objectstack/types`), and BOTH halves of that sentence are the fix.
    //
    // **Why it moved up here.** This branch used to live *inside* the
    // `looksLikeInternalErrorLeak(raw)` true-branch below, so a conflict was
    // recognised only if the message first looked like a server-internals leak
    // — two unrelated questions, one nested inside the other. MySQL is where
    // they disagree. `ER_DUP_ENTRY: Duplicate entry 'a@b.com' for key
    // 'idx_email_unique'` matches not one of the leak heuristic's limbs
    // (`sqlite_` / `sqlstate` / `constraint failed` / `unique constraint` /
    // `foreign key` / a leading `insert into `/`update `/`select `/`delete
    // from `), so it never reached the `if` at all and fell out of
    // `UNCLASSIFIED_FAULT` as `500 INTERNAL_ERROR` — on EVERY unique conflict
    // in a MySQL deployment, against an API contract that registers
    // `UNIQUE_VIOLATION` (`error-code-ledger.zod.ts`). The front end could not
    // tell "this email is taken" from "the server fell over". SQLite and
    // Postgres hid it: their prose happens to contain `unique constraint`.
    //
    // The fix is deliberately NOT to teach the leak heuristic about MySQL.
    // That heuristic decides what text is unsafe to echo; widening it to reach
    // a status mapping would make an information-disclosure rule depend on a
    // conflict vocabulary, and every future dialect would have to be taught to
    // both. Asking the conflict question by name, first and independently, is
    // the #5841 `isMissingTableError` move — and it leaves the leak classifier
    // byte-identical, so nothing else it guards is reclassified.
    //
    // **Why the predicate rather than more substrings.** The message is only
    // one of the two channels drivers use. Postgres surfaces SQLSTATE `23505`
    // and mysql2 an `ER_DUP_ENTRY` / `errno 1062` — measured, a Postgres error
    // carrying the code but a plain message was also a 500 here. The predicate
    // reads code, errno, message and one step of `cause`; a substring added to
    // this file would have been the fifth private vocabulary, which is the
    // defect #6250 is named for.
    //
    // **The body still says nothing the driver said.** The message is fixed
    // text and the only interpolated values are the object name the ROUTE
    // supplied and — since #7821 — the conflicting FIELD, and that second one
    // is safe for the same reason the first is: it does not come from the
    // driver's prose, it comes from `uniqueViolationColumn`, which hands back
    // only a bare `[A-Za-z_][A-Za-z0-9_$]*` identifier it could determine is a
    // COLUMN. The withholding this branch exists to enforce is unchanged:
    // MySQL's text embeds the offending USER DATA (`Duplicate entry
    // 'acme@example.com' …`) and Postgres' embeds the index name, and neither
    // can reach the wire — `uniqueViolationColumn` refuses index names outright
    // and the table qualifier is stripped (`sys_user.email` → `email`). Pinned,
    // per dialect, in `rest-unique-violation-dialects.test.ts`. The full text
    // still reaches the operator: `handleRouteError` / `logWithheldServerFault`
    // log the original error untouched.
    //
    // **[#7821] Why `field` at all — parity, not a new feature.** The bulk /
    // import path has named the colliding column since #6544
    // (`sanitizeRowError` → `uniqueViolationColumn` → "A record with this
    // `email` already exists."), while this branch — holding the same error
    // object, one import away from the same helper — answered "a value". So the
    // platform gave two different answers to one constraint depending only on
    // whether the write arrived one row at a time or in a batch, and a client
    // that wanted to render its own localized message could not name the field
    // either, because the body carried no `field`. Both halves are fixed here:
    // the wire gets `field`, and the default sentence reaches parity.
    //
    // ⚠️ The bulk path is deliberately NOT touched. Convergence is upward only:
    // it already names the field and must keep naming it exactly as it does.
    //
    // **Passing the error OBJECT, not `error.message`, is the point.**
    // `sanitizeRowError` only ever holds a string, so it reads the message
    // channel alone. This site has the whole error, and `uniqueViolationColumn`
    // additionally reads `detail` and one step of `cause` — which is where the
    // column actually is for the Postgres driver we ship: node-postgres keeps
    // its `DETAIL: Key (email)=(…)` line on `error.detail` and off the message.
    // Measured on `origin/main`: that shape resolves `email` from the object and
    // `undefined` from `err.message`.
    //
    // **When it cannot tell, it says nothing.** `uniqueViolationColumn` returns
    // `undefined` for an index name (MySQL's `for key 'idx_email_unique'`,
    // SQLite's `index 'x'`), for a composite key, and for any dialect it does
    // not parse — and then this branch emits the unnamed sentence and NO `field`
    // key at all. That degradation is the contract, not a fallback: a wrong
    // field name is worse than none, because it sends the user to correct an
    // input that was never the problem.
    if (isUniqueViolationError(error)) {
        const field = uniqueViolationColumn(error);
        return {
            status: 409,
            body: {
                error: field
                    ? `A record with this ${field} already exists`
                    : 'A record with this value already exists',
                code: 'UNIQUE_VIOLATION',
                ...(field ? { field } : {}),
                ...(object ? { object } : {}),
            },
        };
    }

    const raw = String(error?.message ?? error ?? '');
    const lower = raw.toLowerCase();

    // Fallback for the same sandbox wrapper when the SandboxError instance
    // (and its `innerMessage`) was lost crossing a rethrow/serialization
    // boundary: strip the debug wrapper from the raw message. A leading
    // default `Error: ` name is dropped.
    //
    // [#7543] A non-default name (`TypeError: …`) used to be KEPT here and
    // shipped as the 400's message "as useful context". It is useful context —
    // for an OPERATOR, in the log, which is where it still goes. On the wire it
    // was a raw runtime fault presented to a client as their own mistake. This
    // door and the `innerMessage` door above produce byte-identical bodies, so
    // they must classify identically or the fix would depend on whether the
    // SandboxError instance happened to survive the rethrow.
    const sandboxWrapper = /^(?:hook|action) '[^']*' threw:\s*(.+)$/s.exec(raw);
    if (sandboxWrapper) {
        const msg = sandboxWrapper[1].startsWith('Error: ')
            ? sandboxWrapper[1].slice('Error: '.length)
            : sandboxWrapper[1];
        if (isScriptFaultMessage(msg)) return UNCLASSIFIED_FAULT();
        return {
            status: 400,
            body: {
                error: msg,
                ...(object ? { object } : {}),
            },
        };
    }

    // EnvironmentKernelFactory: project missing database_url/driver — typically
    // means provisioning is in flight or the project record was never
    // fully provisioned. 503 (with Retry-After implied) is more accurate
    // than the default 400/500: clients can poll until the project is
    // active.
    if (
        raw.includes('[EnvironmentKernelFactory]') &&
        (lower.includes('missing database_url') || lower.includes('not found'))
    ) {
        const isProvisioning = lower.includes("status='provisioning'") || lower.includes("status='pending'");
        const isFailed = lower.includes("status='failed'");
        return {
            status: isProvisioning ? 503 : isFailed ? 502 : 404,
            body: {
                error: raw,
                code: isProvisioning
                    ? 'PROJECT_PROVISIONING'
                    : isFailed
                        ? 'PROJECT_PROVISIONING_FAILED'
                        : 'PROJECT_NOT_FOUND',
            },
        };
    }

    // Record-level not-found from ObjectQL (`getData` / `updateData` /
    // `deleteData`). These are normal client mistakes (stale UI link,
    // hand-typed id, deleted record) and should be a quiet 404 — not
    // a "[REST] Unhandled error" log entry that scares operators.
    if (
        error?.code === 'RECORD_NOT_FOUND' ||
        /^Record\s+\S+\s+not found in\s+\S+/i.test(raw)
    ) {
        return {
            status: 404,
            body: {
                error: raw,
                code: 'RECORD_NOT_FOUND',
                ...(object ? { object } : {}),
            },
        };
    }

    // Schema-mismatch & required-field violations are CLIENT errors (a bad
    // payload the caller can fix), not server faults — so map them to a
    // structured 4xx BEFORE the unknown-object / SQL-leak branches, which
    // would otherwise bury them in a generic 404 or 500. Driver phrasing
    // varies by dialect; cover SQLite / Postgres / MySQL:
    //   unknown column → SQLite "table X has no column named c" /
    //                     "no such column: c"; Postgres 'column "c" of
    //                     relation "X" does not exist'; MySQL "Unknown
    //                     column 'c' in 'field list'".
    //   not-null       → SQLite "NOT NULL constraint failed: X.c";
    //                     Postgres 'null value in column "c" ... violates
    //                     not-null constraint'; MySQL "Column 'c' cannot
    //                     be null".
    // NOTE: this is a last-resort safety net — the validation layer should
    // ideally reject these before they reach the driver (see follow-ups on
    // unknown-field rejection + provenance-aware required checks).
    // [#6615] The Postgres limb is the shared `matchMissingColumnOfRelation`
    // rather than a fourth open-coded copy of that phrase: its message contains
    // a legal missing-TABLE phrase as a substring, and `service-analytics` and
    // `metadata` each had to repair the same superstring hole. Same regex as
    // before, same position last in the chain — only its owner moved.
    const unknownColumn =
        /has no column named\s+["'`]?([a-z0-9_]+)/i.exec(raw)?.[1] ??
        /no such column:\s*["'`]?([a-z0-9_.]+)/i.exec(raw)?.[1] ??
        /unknown column\s+["'`]([a-z0-9_]+)["'`]/i.exec(raw)?.[1] ??
        matchMissingColumnOfRelation(raw);
    if (unknownColumn) {
        const field = unknownColumn.split('.').pop();
        return {
            status: 400,
            body: {
                error: field
                    ? `Unknown field '${field}'${object ? ` on object '${object}'` : ''}`
                    : 'Request references a field that does not exist',
                code: 'INVALID_FIELD',
                ...(field ? { field } : {}),
                ...(object ? { object } : {}),
            },
        };
    }

    const notNull =
        /not null constraint failed:\s*\S*?\.([a-z0-9_]+)/i.exec(raw) ||
        /null value in column\s+["'`]([a-z0-9_]+)["'`]/i.exec(raw) ||
        /column\s+["'`]([a-z0-9_]+)["'`]\s+cannot be null/i.exec(raw);
    if (notNull) {
        const field = notNull[1];
        // The metadata required-check (`record-validator`) runs BEFORE the
        // driver, so a NOT NULL violation that reaches this far means metadata
        // did NOT consider the field required — i.e. the physical column has
        // drifted from metadata (#2186), not a genuine missing-required-field.
        // We keep the `VALIDATION_FAILED` / `required` envelope for back-compat
        // (form UIs key off it) but add an actionable `hint` so the message
        // stops being misleading.
        return {
            status: 400,
            body: {
                error: `${field} is required`,
                code: 'VALIDATION_FAILED',
                fields: [{ field, code: 'required', message: `${field} is required` }],
                hint:
                    `If '${field}' is optional in your object metadata, the database column is still NOT NULL — ` +
                    `the physical schema has drifted from metadata. Run 'os migrate' to reconcile ` +
                    `(or reset the dev database).`,
                ...(object ? { object } : {}),
            },
        };
    }

    // [#5462] A driver saying "that relation is missing" is an unknown-OBJECT
    // verdict only when the missing relation IS the object the request named.
    //
    // These three limbs are the only ones in the heuristic below whose text is
    // written by the DATABASE rather than by ObjectStack, and the database has
    // no idea which of its tables the caller asked for. `sys_metadata` going
    // away produces exactly the same words as a business object that was never
    // registered — so the whole metadata plane collapsing came back as
    // `404 {"error":"Object not found","code":"OBJECT_NOT_FOUND"}`, telling the
    // caller to check their spelling, and 404 is an `isExpectedDataStatus`, so
    // the infrastructure fault left NOT ONE LINE in the server log. Reproduced
    // in process on the real engine + protocol: `PUT /api/v1/meta/object/acct`
    // against a driver that fails every access with `SQLITE_ERROR: no such
    // table: sys_metadata` answered 404 with zero log lines (see
    // `rest-unknown-object-heuristic.test.ts`).
    //
    // #5437/#5464 fixed the sibling half — a producer that DECLARES `status:
    // 5xx` is sanitised and logged. It deliberately did not touch the heuristic,
    // and this path never reaches that branch: `saveMetaItem` rethrows the raw
    // driver `Error` with no `status` and no `code` at all, so the whole
    // message-text machinery below is what judges it.
    //
    // The criterion is attribution, and it takes BOTH halves: a request object
    // to attribute to, and a relation name the phrasing actually carries. When
    // either is missing the message cannot be shown to be about the object the
    // caller asked for, and per the direction on this issue the safe way to be
    // wrong is LOUD — a 500 that is sanitised and logged — never a silent 404.
    // That covers the metadata/UI/discovery routes for free: they call
    // `handleRouteError(res, error)` with no object at all, which is the exact
    // shape this issue was raised on.
    //
    // The engine-authored limbs keep the old reading. `unknown object`,
    // `object not found`, `[ObjectQL] No driver available for object '<name>'`
    // and the quoted-object-name catch-all are OUR vocabulary about a named
    // object — they mean what they say, and #3770's registry gate (which throws
    // `code: 'OBJECT_NOT_FOUND'` and is matched far above) is the primary
    // producer of this 404 anyway; the driver-string limb has been a legacy
    // safety net since.
    //
    // [#8264] The Postgres limb used to be a two-`includes()` conjunction —
    // `relation` and `does not exist` anywhere in the message, not necessarily
    // the same sentence. `does not exist` is ordinary business English ("This
    // relation does not exist in the diagram" — the exact negative case
    // `error-leak.test.ts` pins for #8132's shared leak predicate), so that
    // reading could re-verdict a legitimate business message through EITHER
    // consumer below: the 500 gate right here, or the `looksLikeUnknownObject`
    // 404 limb two lines further down (both read this same const). Anchored on
    // Postgres' own errmsg template — a QUOTED identifier — the same technique
    // #8132 used for `looksLikeInternalErrorLeak` in `@objectstack/types`.
    //
    // Deliberately NOT a call into that shared predicate: it answers a
    // different question ("may this message be withheld from the client at
    // all?"), and its other limbs — `sqlite_`, `unique constraint`,
    // `foreign key`, a bare SQL statement — have nothing to do with THIS
    // question (is this specifically an unknown-relation condition, for the
    // 404-vs-500 split below?). `relation-sub-object.ts` documents "two
    // widths, on purpose" for a neighbouring pair of consumers for exactly
    // this reason — different questions get different patterns even when they
    // share a substring. That precedent does NOT extend to the two USES right
    // here, though: both the 500 gate and the 404 limb are asking this file's
    // one question, and `missingRelationIsObject` below already gates the 500
    // path on attribution — so one width for both is correct, not "two
    // widths, on purpose" a second time. See the reverse-verification note in
    // `rest-unknown-object-heuristic.test.ts` for both paths measured.
    const looksLikeMissingRelation =
        lower.includes('no such table') ||
        RELATION_DOES_NOT_EXIST.test(raw) ||
        lower.includes('table not found');
    if (looksLikeMissingRelation && !missingRelationIsObject(raw, object)) {
        return DATA_STORE_FAULT();
    }

    const looksLikeUnknownObject =
        looksLikeMissingRelation ||
        lower.includes('unknown object') ||
        lower.includes('object not found') ||
        lower.includes('no driver available') ||
        (object !== undefined && lower.includes(`'${object.toLowerCase()}'`) && lower.includes('not'));
    if (looksLikeUnknownObject) {
        return {
            status: 404,
            body: {
                error: object ? `Object '${object}' is not registered` : 'Object not found',
                code: 'OBJECT_NOT_FOUND',
                object,
            },
        };
    }
    // Default: do NOT leak raw SQL or driver internals. If the message
    // looks like a SQL/driver dump, replace it with a generic envelope
    // and rely on server logs for the full diagnostic.
    //
    // [#3867] The heuristic itself now lives in `@objectstack/types`
    // (`looksLikeInternalErrorLeak`) so the OTHER HTTP boundary — the
    // dispatcher-plugin routes (`/analytics`, `/packages`, `/i18n`, …) — can
    // apply the same rule. Before #3867 that boundary applied none and
    // returned raw SQL to clients. Behaviour here is unchanged; only the
    // predicate's home moved.
    if (looksLikeInternalErrorLeak(raw)) {
        // [#6250] The unique-constraint 409 used to be nested HERE, keyed on
        // `unique constraint` / `unique violation`. Both substrings are now
        // limbs of the shared `isUniqueViolationError` predicate, which runs
        // far above this line and unconditionally — so this branch cannot
        // narrow the verdict, and a conflict no longer has to look like a leak
        // to be recognised as one. What is left here is the original job:
        // withhold text that would ship driver internals.
        return DATA_STORE_FAULT();
    }
    return UNCLASSIFIED_FAULT();
}

/**
 * The CLASSIFICATION door: a THROWN thing becomes a sanitized HTTP answer.
 * Ensures raw driver messages (SQLite/Postgres dumps, stack traces,
 * unique-constraint payloads with table names, etc.) never reach clients.
 * Honors structured errors that already carry an explicit `status` so callers
 * can surface domain-specific codes (e.g. 422 from a metadata save
 * validator), and routes everything else through `mapDataError` so the
 * security / validation / SQL-leak / unknown-object envelopes apply
 * uniformly across CRUD, batch, metadata, UI and discovery routes.
 *
 * [#9098] Named `sendError` until this change, which was a collision with the
 * SHARED envelope writer of the same name in `@objectstack/types` — a
 * different arity, a different envelope dialect and a different strictness.
 * The two were never interchangeable, and the collision was not cosmetic: the
 * cross-door parity note in `packages/runtime` cited "`sendError`'s closed
 * `ErrorCode` parameter" as the reason the REST door could not put an
 * unregistered code on the wire, which is true of the `@objectstack/types`
 * one and false of this one — so the door's real hole read as closed. Three
 * separate comments in `rest-server.ts` had each been written to warn the
 * reader off the same conflation. Prose had already failed; the names are
 * different now.
 *
 * ⛔ `error` stays `any` DELIBERATELY, and that is now a statement about the
 * PARAMETER only. This is a caught value — a driver error, a `TypeError`,
 * anything a `catch` can bind — so there is no type to demand of it; what a
 * caught error may CARRY is not narrowed at the signature and cannot be. What
 * #9098 closed is the AUTHOR-side hole: see {@link sendDeclaredFault}.
 *
 * [#9232] What IS narrowed now is the wire answer. The public-contract decision
 * this docblock used to defer ("narrowing what a thrown error may emit is an
 * ADR-0112 call, not an internal typing one") was made by the maintainer on
 * 2026-08-17: `code` is a closed vocabulary at every door, with no carve-out for
 * body position, so an unregistered thrown spelling is demoted to a
 * `declaredCode` sibling in the flat body exactly as the dispatcher door demotes
 * it in the nested one. The demote is computed by {@link thrownCodeFields},
 * which reads the shared `resolveThrownHttpError` / `demotedDeclaredCode` pair
 * rather than restating the rule. An `error: any` parameter and a closed wire
 * vocabulary are no longer in tension: the door accepts anything and answers in
 * the declared vocabulary, which is what a classification door is for.
 */
export function sendThrownError(res: any, error: any, object?: string): void {
    const resolved = resolveErrorResponse(error, object);
    // [#5437] The client no longer reads a 5xx's own words; the operator must.
    logWithheldServerFault(error, resolved);
    res.status(resolved.status).json(resolved.body);
}

/**
 * [#9098] The AUTHOR-side door: a refusal this repo's own code DECIDED, with
 * `code` typed to the closed ADR-0112 vocabulary.
 *
 * ## The hole this closes
 *
 * A handler that decides a refusal does not throw — it constructs the answer.
 * Until this function existed, the only way to emit one in the flat dialect
 * was to hand an object literal to the classification door above, whose
 * `error: any` accepts any spelling at all. So an author could put a fresh,
 * unregistered `code` on the wire with no type error, no lint and no review
 * signal — the body would then fail `ApiErrorSchema` (and, because
 * `BaseResponseSchema` embeds it, the WHOLE body) at the only place anyone
 * would notice: a client's parse. `FIELD_VISIBILITY_UNRESOLVED` shipped in
 * exactly that state and was found by a gate sweep, not by the door.
 *
 * `code: ErrorCode` makes the same mistake a compile error at the call site.
 * The five author-declared emissions this repo had are routed through here,
 * and `packages/rest`'s `tsc --noEmit` compiles every one of them — so the
 * narrowing is checked by the build rather than asserted by a comment.
 *
 * ## What it deliberately does NOT change
 *
 * The wire answer is byte-identical to what the classification door produced
 * for the same literal: this delegates to {@link sendThrownError} rather than
 * re-implementing the response, so the #5437 5xx prose-withholding, the #5423
 * 4xx truncation and the FLAT `{ error, code }` dialect all still apply,
 * unchanged and in one place.
 *
 * ⛔ In particular this is NOT a migration to the `@objectstack/types`
 * envelope writer. That one emits the NESTED `{ success: false, error: { code,
 * message } }` and applies no sanitization — routing these emissions through
 * it would move the envelope POSITION and would re-open the #5437 leak class by
 * shipping a declared 5xx's own prose. Narrowing the vocabulary and moving the
 * dialect are two separate decisions.
 *
 * Both halves of that sentence have since been settled, in opposite directions,
 * so read it as a live boundary rather than as pending work: the VOCABULARY is
 * closed at this door as of #9232 (see {@link thrownCodeFields}), while the
 * POSITION is still the flat one and is held by the `check:route-envelope`
 * ratchet's entry for this file — whose end state is converting these bodies
 * onto the shared `sendOk` / `sendError` pair. ⚠️ #7035 is NOT that card and
 * has not been since 2026-08-10: it closed with PR #7293 having converged three
 * `/meta` 501 handlers only, and the citation that used to stand here called it
 * an open finding long after it was neither.
 */
export function sendDeclaredFault(
    res: any,
    fault: { code: ErrorCode; status: number; message: string },
): void {
    sendThrownError(res, fault);
}

/**
 * [ADR-0106 D6 tier 3] Refuse an object-schema read whose field visibility
 * could not be evaluated.
 *
 * An unhealthy security service must not auto-open a disclosure hole, and the
 * only safe closed form is an *error*: visible, retryable, never cached. The
 * two answers this exists to rule out are (a) the unmasked body — D3's
 * fetch → mask → send ordering means the cached full document never reaches the
 * wire on this path — and (b) an empty-fields `200`, which is a silently wrong
 * UI and cacheable poison at once.
 *
 * 503 rather than 500: the condition is an unhealthy dependency and a retry is
 * the right client behaviour.
 *
 * [#9098] Emits through {@link sendDeclaredFault}, so `FIELD_VISIBILITY_UNRESOLVED`
 * is now checked against the closed ADR-0112 vocabulary at COMPILE time. It was
 * this call — an object literal handed to an `error: any` parameter — that put
 * an unregistered code on the wire for as long as it did (#8885 registered it;
 * this makes the next one impossible rather than merely findable). The wire
 * answer is unchanged: 503, `code`, and the #5437-withheld prose.
 */
export function sendFieldVisibilityFault(res: any, objectName: string): void {
    sendDeclaredFault(res, {
        code: 'FIELD_VISIBILITY_UNRESOLVED',
        message: `Field visibility for object '${objectName}' could not be evaluated; the object schema is not being served.`,
        status: 503,
    });
}

/**
 * [#5437] Log the ORIGINAL error whenever a server fault's own message was
 * withheld from the response body.
 *
 * This is the other half of "the client does not read it, the log keeps it".
 * Sanitising a 5xx is only free of cost while the withheld text is still
 * somewhere an operator can find it — otherwise tightening the boundary would
 * trade a leak for a blind spot, and the `sys_metadata` persistence failure
 * this issue was raised on is exactly the fault an operator must be able to
 * diagnose (the in-memory registry has already diverged from the database).
 *
 * `sendThrownError` had no logging at all, so its 5xx band went from "the client can
 * read the driver error" straight to "nobody can" without this. The routes that
 * exit through `handleRouteError` already print the whole error object for a
 * genuine fault — this fires only in the gap that predicate leaves: 502/503,
 * which `isExpectedDataStatus` classifies as normal lifecycle outcomes and
 * therefore does not log, and whose message this boundary now drops too.
 *
 * No-ops when nothing was withheld (the resolved body still carries the error's
 * own message), so an untouched passthrough does not gain a log line.
 */
function logWithheldServerFault(
    error: any,
    resolved: { status: number; body: Record<string, unknown> },
): void {
    if (resolved.status < 500) return;
    const original = typeof error?.message === 'string' ? error.message : '';
    if (!original || resolved.body?.error === original) return;
    logError('[REST] 5xx message withheld from client; original error:', error);
}

/**
 * The wire response `sendThrownError` would emit for a thrown route error,
 * WITHOUT emitting it. Split out of `sendThrownError` so the logging decision
 * (`handleRouteError`) reads the exact status/body the client is about to get
 * instead of forming a second opinion that can drift from the responder — the
 * drift this whole seam exists to prevent (#4886).
 */
function resolveErrorResponse(error: any, object?: string): { status: number; body: Record<string, unknown> } {
    // [#3770] `OBJECT_NOT_FOUND` is deliberately excluded from this
    // status-passthrough: `mapDataError` owns its canonical envelope
    // (`OBJECT_NOT_FOUND`), and short-circuiting here would ship a second wire
    // code for the same condition depending on which route caught it.
    //
    // [#7525] Deliberately still a `status`-only read HERE. An error that
    // declares its status as `statusCode` instead is not skipped — it falls to
    // `mapDataError` below, whose {@link declaredHttpStatus} gate reads both
    // spellings and answers with the same status/code/withhold rules this arm
    // applies. So the two doors already agree on the wire answer, and this one
    // is not duplicating the two-spelling read to say so.
    const passThroughStatus = error?.code !== 'OBJECT_NOT_FOUND'
        && typeof error?.status === 'number' && error.status >= 400 && error.status < 600;
    if (passThroughStatus) {
        // [#5437] A declared 5xx never ships its own message text.
        //
        // Until now this branch's range was 400-599 while `mapDataError`'s
        // sibling branch stopped at 4xx *on purpose* — "5xx messages keep going
        // through the sanitizing heuristics below so internal/SQL details never
        // reach the client verbatim". Two opposite verdicts on one question,
        // and every route that reports through `sendThrownError` (metadata, UI,
        // discovery, batch) got the permissive one: a declared 500 shorter than
        // `CLIENT_MESSAGE_MAX` was returned word for word, past `isSqlLeak`,
        // past `looksLikeInternalErrorLeak`, past `Internal data error`.
        //
        // That is not dormant code. `metadata-protocol` interpolated the raw
        // driver error into two client-facing 500s — `Failed to persist
        // customization overlay to sys_metadata: ${dbError.message}` and
        // `Failed to delete customization overlay: ${err.message}` — and a real
        // driver line (`SQLITE_ERROR: no such table: sys_metadata`, `relation
        // "sys_metadata" does not exist`, a unique-constraint payload naming
        // columns) is nowhere near 500 characters, so it arrived intact. Length
        // was never a proxy for leakage; on this side of the bound it failed
        // OPEN.
        //
        // [#5264 / #5783] ONE of those two is now gone: `saveMetaItem`'s legacy
        // raw-engine branch was deleted, taking its `OVERLAY_PERSISTENCE_FAILED`
        // catch — the persist half — with it, and the code has been unregistered
        // from the ADR-0112 ledger since nothing could emit it. The DELETE half
        // is untouched and still live (`deleteMetaItem`'s catch: a 500 assigned
        // to an already-constructed error, no `code`), which is what
        // `rest-5xx-message-sanitization.test.ts` §1 walks in process. Read the
        // paragraph above as the history that produced this branch, not as a
        // present-tense census of its producers.
        //
        // The cure is structural rather than another predicate: in the 5xx band
        // the message is dropped unconditionally, so there is no phrasing a
        // producer can pick — deliberately or by accident — that gets driver
        // text past this boundary. A keyword gate would only move the question
        // to "does the heuristic know this dialect", which is the failure mode
        // that produced this bug.
        //
        // Sanitising HERE rather than by falling through to `mapDataError` is
        // the point: `mapDataError` derives a status from the message TEXT, so
        // handing it a declared 5xx re-labels the fault as something else
        // entirely — the overlay-delete 500 comes back as `404 OBJECT_NOT_FOUND`
        // ("no such table" trips the unknown-object heuristic) and the atomic
        // batch's `501 NOT_IMPLEMENTED` as `404 Object '<name>' is not
        // registered` (its text carries the quoted object name and "cannot"),
        // both of which then read as *expected* statuses and stop being logged
        // at all. Worse, a 5xx whose text matches no heuristic
        // falls out of `mapDataError`'s terminal `{ status: 400, error: raw }`
        // — still verbatim, now wearing a client-error status. So: keep the
        // status the producer declared, keep the machine-readable `code` (a
        // SCREAMING_SNAKE constant is not a leak, and it is what a client keys
        // on), drop the prose.
        //
        // Accepted cost, recorded so it is not rediscovered as a bug: a
        // self-authored 5xx body — the atomic batch's "retry without
        // options.atomic, or probe capabilities.transactionalBatch on
        // /discovery first" (`501 NOT_IMPLEMENTED`) — reaches the client as the
        // generic sentence plus its `code`. The full text still reaches the
        // server log (see `logWithheldServerFault`), which is the side of the
        // boundary that sentence was written for. Producers that owe a caller
        // an actionable 5xx sentence should say it without interpolating the
        // driver's — tracked separately.
        //
        // [#9232] The surviving `code` is the NARROWED one — see
        // {@link thrownCodeFields}. This arm's old gate was bare truthiness, so
        // it also admitted a non-string `code`; that limb is gone with the
        // narrowing, and the four flat arms now ask one question.
        if (error.status >= 500) {
            return {
                status: error.status,
                body: {
                    error: INTERNAL_ERROR_MESSAGE,
                    ...thrownCodeFields(error, error.status),
                },
            };
        }
        // [#5423] 4xx keeps the bound as a TRUNCATION, not a replacement: a 4xx
        // message is addressed TO the caller and is the remedy. Unchanged by
        // #5437 — see {@link truncateClientMessage}.
        const safeMsg = typeof error.message !== 'string'
            ? 'Request failed'
            : truncateClientMessage(error.message);
        // [#9232] Narrowed, same as the three arms above.
        return {
            status: error.status,
            body: {
                error: safeMsg,
                ...thrownCodeFields(error, error.status),
                ...(Array.isArray(error.issues) ? { issues: error.issues } : {}),
            },
        };
    }
    return mapDataError(error, object);
}

/**
 * Whether a mapped data-error status represents an *expected* client/lifecycle
 * outcome (and therefore shouldn't be logged as "[REST] Unhandled error").
 *  - 403 PERMISSION_DENIED is a normal RBAC denial
 *  - 404 unknown object / project not found is a normal client mistake
 *  - 502/503 mean the underlying project is provisioning or failed; the
 *    handler will emit the response and the operator can inspect
 *    sys_environment.metadata.provisioningError if needed.
 */
function isExpectedDataStatus(status: number): boolean {
    return status === 403 || status === 404 || status === 409 || status === 502 || status === 503;
}

/**
 * Malformed-query rejections from the list normalizer (`findData`). They are
 * 400s the CALLER caused by naming a parameter the API does not have
 * (`UNSUPPORTED_QUERY_PARAM`, #2926 ⑩), a field the object does not have
 * (`INVALID_FIELD`, #4134 / #4226 / #4254), or a filter/sort/aggregation
 * value the spec cannot read (`INVALID_FILTER` #4181, `INVALID_SORT` #4226,
 * `INVALID_QUERY` #4254) — a client mistake the response already explains,
 * not a server fault worth an "[REST] Unhandled error" line per request.
 * The filter and sort codes joined this list late: both shipped without it,
 * so every rejection they produced was ALSO logged as an unhandled error.
 */
function isExpectedQueryRejection(body: Record<string, unknown> | undefined): boolean {
    return body?.code === 'UNSUPPORTED_QUERY_PARAM'
        || body?.code === 'INVALID_FIELD'
        || body?.code === 'INVALID_REQUEST'
        || body?.code === 'INVALID_FILTER'
        || body?.code === 'INVALID_SORT'
        || body?.code === 'INVALID_QUERY';
}

/**
 * THE predicate. Whether a resolved error response is an *expected* outcome —
 * something the client caused or a normal lifecycle state — rather than a
 * server fault worth an "[REST] Unhandled error" line plus a stack trace.
 *
 * The union of the three conditions the data routes had each open-coded:
 *  - `isExpectedDataStatus` — 403/404/409/502/503 lifecycle outcomes
 *  - `isExpectedQueryRejection` — the client-caused 400 vocabulary
 *  - `VALIDATION_FAILED` — the per-field 400 envelope
 *
 * It is deliberately NOT "any 4xx". [#5489] That used to be argued from
 * `mapDataError`'s final fallback, which degraded an error it recognised
 * nothing about to an UN-CODED 400 — the bucket a genuine handler bug (a
 * `TypeError`, say) landed in, so a predicate widened to "any 4xx is expected"
 * would have silenced it. That fallback is now {@link UNCLASSIFIED_FAULT}'s
 * 500, which this predicate cannot treat as expected at all
 * (`isExpectedDataStatus` names 502/503 and nothing else in the 5xx band), so
 * the handler bug is loud STRUCTURALLY rather than by this sentence. The
 * narrowness still matters for what remains in the un-coded 4xx band — the
 * sandbox unwraps' business-rule 400s — and for the next author tempted to
 * simplify the predicate down to a status range.
 *
 * [#4886] Every route catch now decides through this one function. Before, the
 * metadata family logged unconditionally — the designer's `?state=draft` probe
 * made `NO_DRAFT` (a structured 404, and the overwhelmingly common answer for
 * any artifact nobody is editing) print 45 stack traces in one browsing
 * session — while the data family open-coded four different spellings of
 * "expected" at 12 sites. `isExpectedQueryRejection`'s own docblock records the
 * previous lap of exactly this drift: the filter and sort codes shipped without
 * joining the list, so every rejection they produced was logged as an unhandled
 * error too. One predicate, one door, so there is no third lap.
 */
export function isExpectedRouteError(status: number, body: Record<string, unknown> | undefined): boolean {
    return isExpectedDataStatus(status)
        || isExpectedQueryRejection(body)
        || body?.code === 'VALIDATION_FAILED';
}

/**
 * Log "[REST] Unhandled error" only when `resolved` is a genuine fault. For
 * catch blocks that must emit their own response shape (the CRUD handlers that
 * respond straight from a `mapDataError` envelope, one of which rewrites 400 →
 * 404 on the wire) — they keep their responder and share only the verdict.
 */
export function logUnexpectedRouteError(error: any, resolved: { status: number; body: Record<string, unknown> }): void {
    if (!isExpectedRouteError(resolved.status, resolved.body)) {
        logError('[REST] Unhandled error:', error);
        return;
    }
    // [#5437] An "expected" status can still have had its message withheld —
    // 502/503 are lifecycle outcomes this predicate deliberately keeps quiet,
    // but a declared one no longer ships its own text either. One line, never
    // two: a genuine fault already printed the whole error above.
    logWithheldServerFault(error, resolved);
}

/**
 * The single door a route catch block should use: resolve the response once,
 * log it only if it is a real fault, then send it. Wire behaviour is identical
 * to a bare `sendThrownError(res, error, object)` — this only decides whether the log
 * line is printed.
 */
export function handleRouteError(res: any, error: any, object?: string): void {
    const resolved = resolveErrorResponse(error, object);
    logUnexpectedRouteError(error, resolved);
    res.status(resolved.status).json(resolved.body);
}

/**
 * [#3431] `X-ObjectStack-Dropped-Fields` — surface the engine's LEGAL write
 * strips (static `readonly` #2948 / TRUE `readonlyWhen` #3042 / #3043 create
 * ingress) on the REST write response so an API caller isn't left to diff the
 * returned row to discover a field never landed (same silent-success class as
 * flow-side #3407). The strip is legitimate — the write still succeeded — so the
 * STATUS CODE is unchanged (200/201); this is a warning header, not a failure.
 *
 * Format: one `field;reason=<reason>` token per dropped field, comma-space
 * joined — e.g. `approval_status;reason=readonly` or
 * `owner;reason=readonly, locked_at;reason=readonly_when`. Field API names are
 * identifiers, so they never contain the `;`/`,`/`=` delimiters. Returns '' when
 * nothing was dropped. The same events also ride the response body's
 * `droppedFields` (the structured/cross-origin-safe channel).
 */
function droppedFieldsHeaderValue(events: DroppedFieldsEvent[] | undefined): string {
    if (!events?.length) return '';
    return events
        .flatMap((e) => e.fields.map((f) => `${f};reason=${e.reason}`))
        .join(', ');
}

/**
 * Set the `X-ObjectStack-Dropped-Fields` header from a data-write protocol
 * result, tolerating both the Hono-style `res.header(name, value)` used
 * elsewhere in this file and the node/Express-style `res.setHeader`. No-ops when
 * the result carried no drops (or the response object supports neither method).
 */
export function applyDroppedFieldsHeader(res: any, result: unknown): void {
    const header = droppedFieldsHeaderValue((result as { droppedFields?: DroppedFieldsEvent[] } | null)?.droppedFields);
    if (!header) return;
    if (typeof res?.header === 'function') res.header('X-ObjectStack-Dropped-Fields', header);
    else if (typeof res?.setHeader === 'function') res.setHeader('X-ObjectStack-Dropped-Fields', header);
}
