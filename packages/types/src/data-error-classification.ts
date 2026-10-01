// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How a thrown thing is CLASSIFIED into an HTTP-shaped answer — ADR-0112's
 * table, without emitting it.
 *
 * Moved here unchanged from `@objectstack/rest` (`error-response.ts`, the
 * classification half: {@link mapDataError} through `classifyDataError`),
 * beside the primitives it composes (`error-leak.ts`, `thrown-http-error.ts`,
 * `unique-violation.ts`, `relation-sub-object.ts`, `native-error-name.ts`).
 * The half is pure: it reads no response object and writes no log line. The
 * EMISSION half (`sendThrownError`, `resolveErrorResponse`,
 * `handleRouteError`, the log verdicts) stays in `rest`, which re-exports
 * every public name below and imports the rest from here.
 *
 * Why it moved: the bulk-import runner adopts {@link mapDataError}'s verdict
 * for each failed row, and the runner moved to `@objectstack/core` so the
 * connector sync executor can write through it. ⛔ Never a copy: a synced row
 * and an import-door row speak ONE code vocabulary because one table judges
 * both. Docblocks below that name an emitter (`resolveErrorResponse`,
 * `handleRouteError`, …) name it in `@objectstack/rest`.
 */

import {
    looksLikeInternalErrorLeak,
    declaresServerFault,
    INTERNAL_ERROR_MESSAGE,
} from './error-leak.js';
import { isUniqueViolationError, uniqueViolationColumn } from './unique-violation.js';
import { matchMissingColumnOfRelation } from './relation-sub-object.js';
import {
    resolveThrownHttpError,
    demotedDeclaredCode,
    declaredUserMessage,
    declaredRefusalMessage,
} from './thrown-http-error.js';
import { isNativeErrorName } from './native-error-name.js';

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
 * **Matched by constructor name, not by phrasing**, and since #17681 by the ONE
 * reader — {@link isNativeErrorName} in `@objectstack/types`, which owns the
 * name list, the `^` anchor and the deliberate absence of a bare `Error:`. This
 * file held the original copy; `@objectstack/objectql` and
 * `@objectstack/runtime` each kept their own because the rule lived HERE and
 * neither could reach it, and all three now read the one helper. ⛔ Do not
 * re-inline the pattern: a name learned at one door and not the others is the
 * same throw answered as a refusal at one boundary and a crash at the next.
 *
 * What stays local is the TRIM — `userFacingMessage` strips a leading `Error: `
 * upstream, so what arrives here may still be padded, and the helper
 * deliberately does not trim for its callers.
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
function isScriptFaultMessage(message: string): boolean {
    return isNativeErrorName(message.trim());
}

/**
 * [#11588] The caller-addressed BUSINESS text a sandboxed hook/action body
 * threw, or `undefined` when this error is not a sandbox refusal.
 *
 * QuickJS bodies throw a `SandboxError` whose `.message` is the
 * `<kind> '<name>' threw: <msg>` debug wrapper and whose `.innerMessage` is the
 * text the author addressed to the end user (see
 * `runtime/src/sandbox/quickjs-runner.ts`). The wrapper "belongs in server
 * logs" — {@link classifyDataError}'s unwrap door exists precisely to keep it
 * off the wire. This is that door's read, named once so the door ABOVE it in
 * {@link resolveErrorResponse} can ask the same question instead of shipping
 * `error.message` raw.
 *
 * Both conditions are the door's, in the door's order:
 *
 *  - a non-empty string `.innerMessage`, which is what makes this a sandbox
 *    error at all;
 *  - NOT {@link isScriptFaultMessage}. A body that CRASHED arrives with the
 *    same shape, and its `TypeError: not a function` is an internal fault
 *    rather than a business message (#7543). This answers `undefined` there,
 *    so a crash is never mistaken for authored text.
 *
 * ⛔ It is deliberately a READ of a field the sandbox populated, never a
 * pattern-strip of the wrapper off `.message`. Stripping prose by regex would
 * also rewrite a plain error whose own text happens to contain `threw:`, and
 * the caller's message is the remedy on a 4xx (#5423) — the one thing this
 * boundary must not paraphrase. `rest-hook-refusal-message-parity.test.ts` §5
 * is the control that keeps it a read.
 *
 * Exported for the SECOND boundary that has to ask the same question:
 * `/analytics/dataset/query` builds its own `{ code, message }` envelope inline
 * in `rest-server.ts` and shares no branch with either door here. It reads this
 * rather than re-deriving the unwrap, so the analytics face and the `/data`
 * face cannot drift into two answers for one refusal — the door-disagreement
 * shape #7525/#8016 keeps producing when a boundary open-codes the read.
 */
export function sandboxBusinessMessage(error: any): string | undefined {
    if (typeof error?.innerMessage !== 'string' || !error.innerMessage) return undefined;
    if (isScriptFaultMessage(error.innerMessage)) return undefined;
    return error.innerMessage;
}

/**
 * [commit 1c7adc73d] The sentence a declared-code structured arm relays to the caller:
 * {@link sandboxBusinessMessage} first, `error.message` second.
 *
 * ## The defect this retires
 *
 * `classifyDataError` surfaces the bespoke arms ABOVE its sandbox unwrap door,
 * deliberately, "so the structured fields survive the generic catch-alls" —
 * and every arm built its sentence from `error?.message`. For a sandboxed
 * producer `error.message` IS the `<kind> '<name>' threw: <msg>` debug wrapper,
 * and the unwrap door that would have read `.innerMessage` sits below the arms
 * and was never reached. So one hook refusal came back as two sentences
 * depending on the route: the bulk door answered `Opportunity is closed.` and
 * the single-record `/data` door answered
 * `hook 'guard' threw: Error: Opportunity is closed.`
 *
 * #11588 repaired exactly this class one door over — it named
 * {@link sandboxBusinessMessage} and taught {@link resolveErrorResponse}'s
 * declared-status passthrough to read it. The arms were not in that card's
 * scope, so the wrapper kept reaching a client with the direction reversed
 * rather than closed. This is that same rule, asked once here instead of
 * re-opined per arm — the third local opinion is what produced the divergence.
 *
 * ## Why the bulk door does not change
 *
 * {@link resolveErrorResponse} declines the shared consult outright for a
 * sandbox-origin error (commit 6d178a408's `isSandboxOrigin` guard), so this read is
 * unreachable from that door and every bulk / metadata / UI route answers
 * byte-for-byte what it answered before. The repair lands on
 * {@link mapDataError} alone, which is where the defect was.
 *
 * ## ⛔ What this deliberately does NOT decide
 *
 * Fault classification. A sandboxed **CRASH** (#7543) no longer reaches this
 * function at all: commit cf6e0a193 put {@link isSandboxCrash} ABOVE the code-gated arms
 * in {@link classifyDataError}, so a crashed body is answered by
 * {@link UNCLASSIFIED_FAULT} whatever code it declared, and the other door
 * declines the consult for a sandbox producer outright (the section above).
 * ⛔ The ruling that decided it, its fence and its negative control are stated
 * ONCE, on {@link isSandboxCrash} — read them there rather than a second time
 * here. `error-response-sandbox-arm-message.test.ts` §4 records the verdict,
 * now CONVERGED. {@link sandboxBusinessMessage} still declines a crash by
 * contract, so this function keeps no opinion of its own about one.
 *
 * ⚠️ CONVERGED was the no-declared-status case only until #17273: a crash that
 * DECLARED a status used to leave {@link resolveErrorResponse} at that status,
 * wrapper and all, through a passthrough commit cf6e0a193 did not touch. That door now
 * asks the SAME {@link isSandboxCrash} gate before its passthrough, so the
 * question has one answer at both doors for every band — flipped from ACCEPTED
 * DIVERGENCE to CONVERGED in
 * `error-response-structured-arm-door-parity.test.ts` §4 rather than deleted.
 *
 * ⛔ Deliberately a READ of the field the sandbox populated, never a
 * pattern-strip of the wrapper off `.message` — {@link sandboxBusinessMessage}
 * carries that argument, and this function must not grow a second one.
 */
function armSentence(error: any): unknown {
    return sandboxBusinessMessage(error) ?? error?.message;
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
 *
 * [#15685] Exported so the `/meta/:type/:name/references` door can ask THIS
 * question — "did the producer declare a status, in either spelling" — instead
 * of re-deriving it beside its own refusal arm. A read, not a policy: the
 * export moves no wire byte, and `error-response.ts` is not part of
 * `@objectstack/rest`'s package entry, so nothing published changes either.
 */
export function declaredHttpStatus(error: any): number | undefined {
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
 *    D4 governs the semantic-CODE channel — `error.code` closed at every door,
 *    the producer's own spelling honoured beside it as `declaredCode` — so a
 *    half-declaration is honoured for the half that was DECLARED.
 *
 *    ⚠️ Axis, stated once here because the other sites echo this file: the
 *    ADR rules the CODE. It does not rule what HTTP status an undeclared
 *    throw deserves, and "the PRODUCER names the condition" is this file's
 *    own prose for the code rule — the sentence does not appear in
 *    ADR-0112 and must not be cited as though it ruled the status axis.
 *    Read unqualified it was taken for a status ruling once already, and
 *    argued for a `500` on a contract question the ADR is silent on.
 *
 *    That is the answer this file already gave
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
 *
 * [commit cad8b42f0] Five arms, since the sandbox unwrap door joined them. It emitted no
 * `code` at all, so #9232 found nothing there to narrow and left it out — and
 * an exit that never speaks the vocabulary is the one a vocabulary sweep
 * cannot see. `rest-thrown-code-vocabulary.test.ts`'s `ARMS` table enumerates
 * all five.
 */
function thrownCodeFields(error: any, status: number): { code?: string; declaredCode?: string } {
    const thrown = resolveThrownHttpError(error, status);
    if (thrown.declaredCode === undefined) return {};
    const demoted = demotedDeclaredCode(thrown);
    return { code: thrown.code, ...(demoted !== undefined ? { declaredCode: demoted } : {}) };
}

/**
 * [#12975] The caller-facing half of an ADR-0111 `CODE: message` throw — the
 * message with the leading restatement of the producer's OWN declared `code`
 * removed, or the message unchanged when it carries no such restatement.
 *
 * ## The rule, and why it is anchored to the declared code
 *
 * Maintainer ruling, 2026-08-29, on the `/data` door shipping `FORBIDDEN:` in
 * front of a localized refusal: ONE envelope semantics — `error` is HUMAN
 * LANGUAGE and `code` is the MACHINE TOKEN, and the token is already carried
 * separately by {@link thrownCodeFields} above. The prefix is therefore removed
 * *because* the same fact rides the `code` axis, and that is exactly the
 * condition this function tests: the message opens with the producer's own
 * `code`, followed by a colon.
 *
 * ⛔ NOT a blanket SCREAMING_SNAKE-then-colon strip, and the difference is the
 * whole safety argument. The broader shape removes a token the wire may carry
 * NOWHERE else — a 4xx that declared a `status` but no `code` gets `{}` from
 * {@link thrownCodeFields} (ADR-0112's own rule: nothing is invented for the
 * half the producer did not name), so a blind strip would delete the token
 * outright rather than move it to its axis. It also eats any sentence that
 * merely opens with a capitalised word and a colon — driver prose such as a
 * SQLite "no such table" line included. Anchored to the declared code, the
 * strip can only ever remove a DUPLICATE of something already on the wire.
 *
 * ⚠️ The anchor is the PRODUCER's spelling (`error.code`), not the narrowed
 * wire `code`. An unregistered spelling is demoted to a `declaredCode` sibling
 * by {@link thrownCodeFields} (#9232) while the prefix restates the spelling
 * the producer actually wrote, so comparing against the narrowed value would
 * miss precisely the idiom this reads. Either way the token still reaches the
 * wire — as `code`, or as the `declaredCode` beside it.
 *
 * This is the shape `respondSharingError`'s ADR-0111 prefix arm already applies
 * in `rest-server.ts` (it strips the prefix naming the code it just answered),
 * rather than a third local rule: strip the prefix that names the code being
 * answered, never an arbitrary one.
 */
function withoutDeclaredCodePrefix(message: string, error: any): string {
    const declared = typeof error?.code === 'string' && error.code.length > 0
        ? error.code
        : undefined;
    if (declared === undefined || !message.startsWith(declared)) return message;
    const separator = /^:\s*/.exec(message.slice(declared.length));
    return separator === null
        ? message
        : message.slice(declared.length + separator[0].length);
}

/**
 * [#11718] The DECLARED-SERVER-FAULT relay, as one definition instead of a
 * shape each door re-derives: a producer that declared a 5xx keeps its
 * `status` and its ADR-0112 `code`, and loses only its prose.
 *
 * Answers `undefined` for everything else — no declared status, a declared
 * 4xx, a status outside 400–599 — so a caller can ask it first and keep its
 * own arm for the rest.
 *
 * ## Why this is a function and not a fourth copy
 *
 * #11718 measured one producer-declared `{ status: 503, code:
 * 'SERVICE_UNAVAILABLE' }` through two doors and got two answers:
 *
 * ```
 * POST /api/v1/data/:object              → 503 {"error":"Internal server error","code":"SERVICE_UNAVAILABLE"}
 * POST /api/v1/analytics/dataset/query   → 500 {"code":"ANALYTICS_QUERY_FAILED","error":"Internal server error"}
 * ```
 *
 * The analytics dataset face built its 5xx body by hand, so #5582's relay —
 * argued on the ground that `502`/`503` are `isExpectedDataStatus` lifecycle
 * outcomes that proxies and retry policies read differently from a `500` —
 * simply never reached it. It is the same failure mode {@link
 * classifiedRefusalAnswer} was extracted for one arm earlier: a third local
 * opinion at this boundary is precisely how two faces come to disagree. So the
 * arm is imported, not restated.
 *
 * ⚠️ Its gate is `declaredHttpStatus(...) >= 500`, NOT `declaresServerFault`
 * alone. The two differ on a 5xx that declared no `code`, and the difference is
 * load-bearing: a producer declaring `{ status: 503 }` and nothing else still
 * gets its status relayed, carrying no code at all. Nothing is invented for the
 * half that was not declared — see the paragraph in {@link mapDataError}'s arm
 * this body was lifted from. Gating on `declaresServerFault` instead would
 * silently keep collapsing that shape onto `500`, which is the very defect,
 * one case narrower.
 *
 * ## [#16146] …and the PROSE is withheld only from a FAULT
 *
 * The paragraph above is about the STATUS and is unchanged. What this arm
 * could not see until #16335 landed is that a producer-declared 5xx may be a
 * deliberate REFUSAL whose message is authored FOR the caller — the
 * `/meta/:type/:name/references` door's ADR-0110 D3 `501` is the measured one,
 * and it reached the wire as `"Internal server error"`. The director seat
 * ruled that distinction a producer-side DECLARATION on the published ADR-0112
 * envelope (decision batch #58, 2026-09-06, option C), ⛔ not a status
 * heuristic and ⛔ not a second allow-list. So this arm asks
 * {@link declaredRefusalMessage} — the ONE read all three withhold arms make
 * (`@objectstack/types`) — and keeps that message under the same
 * {@link truncateClientMessage} bound a 4xx message gets (#5423: truncate,
 * never replace).
 *
 * ⛔ NOT "declared 5xx prose is relayed now". Absent the declaration this arm
 * answers the bytes it always answered, which is what keeps the default
 * fail-closed: a rewrap that drops the flag, a driver that never set it, and a
 * producer that declared only `status` + `code` are all still withheld.
 * `declaresServerFault` keeps the live call below and gains a second live
 * reader inside that shared function.
 */
export function declaredServerFaultAnswer(
    error: any,
): { status: number; body: Record<string, unknown> } | undefined {
    const declaredStatus = declaredHttpStatus(error);
    if (declaredStatus === undefined || declaredStatus < 500) return undefined;
    // [#16146] The declaration is read HERE, INSIDE the shared arm, never in
    // the `withDeclaredUserMessage` wrapper one frame up: the analytics dataset
    // door (`rest-server.ts`, #11718) calls this function BARE, so a relay
    // written into the wrapper would cover `/data` and miss that door.
    const refusal = boundedDeclaredRefusalMessage(error);
    return {
        status: declaredStatus,
        body: {
            error: refusal ?? INTERNAL_ERROR_MESSAGE,
            ...(declaresServerFault({ status: declaredStatus, code: error?.code })
                ? thrownCodeFields(error, declaredStatus)
                : {}),
        },
    };
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
 *
 * [commit 79c46da90] The exported face is a WRAPPER: classification happens in
 * {@link classifyDataError} below (this docblock's subject, byte-for-byte the
 * old `mapDataError`), and the wrapper then rides the producer's declared
 * `userMessage` onto whatever body classification chose — see
 * {@link withDeclaredUserMessage} for the rule and its one deliberate
 * asymmetry.
 */
export function mapDataError(error: any, object?: string): { status: number; body: Record<string, unknown> } {
    return withDeclaredUserMessage(error, classifyDataError(error, object));
}

/**
 * [commit 79c46da90] Carry a producer-marked user-facing refusal text onto a classified
 * wire body — the REST door's half of the objectui#5210 ruling (producer-side
 * opt-in; the console render half is objectui's).
 *
 * The rule is deliberately BRANCH-AGNOSTIC: whatever envelope classification
 * chose — the structured-code 403s, the declared-status passthrough (the
 * measured exit for an engine hook's refusal, #7525), the sandbox unwrap's
 * 400, even the sanitised fault terminals — a `userMessage` the producer
 * declared on the thrown error reaches the body verbatim (truncated at the
 * same {@link CLIENT_MESSAGE_MAX} bound as the 4xx `error` text, by the same
 * argument: #5423's truncate-never-replace). One sentence, no branch table,
 * status-agnostic by construction, which is what the ruling asked the marking
 * to be.
 *
 * Why riding it across the FAULT terminals is safe rather than a #5437/#7543
 * regression: those disciplines withhold text the producer never addressed to
 * the caller — driver prose, a crash's `TypeError: …`. `userMessage` is the
 * opposite by construction: it exists on an error only because an author
 * deliberately wrote user-facing text onto it (`declaredUserMessage` answers
 * `undefined` for everything else — platform and driver code never sets the
 * field), so carrying it discloses nothing that was not authored for exactly
 * this audience. A genuine crash carries no marking and its envelope is
 * byte-identical to before. The one thing the marking never does is move the
 * STATUS or the `code` — a marked crash is still the sanitised 500.
 */
function withDeclaredUserMessage(
    error: any,
    mapped: { status: number; body: Record<string, unknown> },
): { status: number; body: Record<string, unknown> } {
    const userMessage = boundedDeclaredUserMessage(error);
    if (userMessage === undefined) return mapped;
    return { status: mapped.status, body: { ...mapped.body, userMessage } };
}

/**
 * [#12693] The wire VALUE of {@link withDeclaredUserMessage}'s rule: the
 * sentence a producer marked, with #5423's bound already applied — or
 * `undefined` when it marked none.
 *
 * The rule itself is unchanged and still stated once, in the docblock above:
 * `declaredUserMessage` (`@objectstack/types`) decides PRESENCE and
 * {@link truncateClientMessage} decides the BOUND. This is that same pair
 * lifted out of the body-merging wrapper so a caller that has no body to merge
 * into can ask it.
 *
 * ## Why an export rather than the wrapper
 *
 * The record-share family in `rest-server.ts` has two exits that never reach
 * {@link classifiedRefusalAnswer} — its 500 fault terminal, and its ADR-0111
 * message-prefix arm — and therefore hold no classification `{ status, body }`
 * to ride the mark onto. They hold the raw thrown error and build their
 * envelope by hand. Handing them the wrapper would mean inventing a flat body
 * for them to merge into and then unpicking it, and open-coding
 * `declaredUserMessage(error)` at the exits instead would leave #5423's bound
 * applied at some marks and not others — a per-exit answer to a question this
 * file already owns, which is the drift {@link classifiedRefusalAnswer}'s own
 * docblock was written against.
 *
 * ⛔ What this does NOT decide is the ENVELOPE, and that stays true for every
 * future caller: it answers a string, and where that string lands — the flat
 * body's top level, the nested ADR-0112 `ApiError.userMessage` — is the
 * caller's dialect decision, exactly as #9232 keeps vocabulary and position
 * apart.
 */
export function boundedDeclaredUserMessage(error: unknown): string | undefined {
    const userMessage = declaredUserMessage(error);
    return userMessage === undefined ? undefined : truncateClientMessage(userMessage);
}

/**
 * [#16146] This package's wire VALUE for a producer-DECLARED 5xx refusal: the
 * message the producer authored for its caller, with #5423's bound applied —
 * or `undefined` when the throw declared a fault, which is the default.
 *
 * Same split as the pair above, for the same reason. `declaredRefusalMessage`
 * (`@objectstack/types`) decides PRESENCE — that is the ONE definition all
 * three withhold arms read, and the runtime dispatcher exit reads it directly
 * — and {@link truncateClientMessage} decides the BOUND, which is a per-DOOR
 * question: the ruling's own text says a kept refusal is "bounded exactly as a
 * 4xx message is", and in this package a 4xx message is bounded at
 * {@link CLIENT_MESSAGE_MAX} by truncation, never by replacement.
 *
 * ⛔ Nothing here re-derives the declaration. Both REST arms and the
 * `/meta/:type/:name/references` door call THIS, so the bound is applied at
 * every mark rather than at some of them — the drift
 * {@link boundedDeclaredUserMessage}'s own docblock was written against.
 *
 * ⚠️ Truncation cuts the TAIL, and a refusal is the one message shape that
 * routinely back-loads its remedy ("Ask the owning object instead: …"). The
 * measured `/references` sentence is 410 characters, so it survives whole; a
 * producer writing a longer one owes the caller a front-loaded remedy.
 */
export function boundedDeclaredRefusalMessage(error: unknown): string | undefined {
    const refusal = declaredRefusalMessage(error);
    return refusal === undefined ? undefined : truncateClientMessage(refusal);
}

/**
 * [#11588 / #7543 / commit 6d178a408] Did this error come out of a sandboxed body?
 *
 * `SandboxError.innerMessage` is the QuickJS side-channel: `message` carries a
 * `<kind> '<name>' threw: <msg>` DEBUG WRAPPER written for the server log, and
 * the sentence addressed to the caller is `innerMessage`. Every arm in
 * {@link structuredCodeAnswer} ships `error.message`, so a sandboxed producer
 * is a DIFFERENT producer for their purposes and is answered by the unwrap
 * door instead — the rule commit 10220a7bf already wrote into the `DUPLICATE_RECORD`
 * arm's `name` gate, stated once here for the arms that need it by POSITION.
 *
 * Deliberately NOT {@link sandboxBusinessMessage}: that one declines a CRASH
 * (#7543) so the crash reaches the fault terminal, and a crash carrying a
 * bespoke `code` must reach the unwrap door too rather than an arm that would
 * dress the wrapper up as a refusal.
 */
function isSandboxOrigin(error: any): boolean {
    return typeof error?.innerMessage === 'string' && error.innerMessage.length > 0;
}

/**
 * [commit cf6e0a193] Did a sandboxed body CRASH — as opposed to reporting a refusal?
 *
 * The two reads {@link sandboxBusinessMessage} already makes, asked from the
 * other side: a sandbox origin ({@link isSandboxOrigin}) whose unwrapped
 * sentence names a JS runtime fault ({@link isScriptFaultMessage}). One
 * predicate, so the question "is this a crash" has one answer in this file
 * rather than a second open-coded read — the door-disagreement shape
 * #7525/#8016/#11588 keep producing whenever a boundary re-derives a read this
 * file already owns.
 *
 * ## Why {@link classifyDataError} asks it FIRST
 *
 * Maintainer ruling, 2026-09-04 (decision batch #27), on this card — option B,
 * verbatim 「同意」: *"A declared code is the author's statement about the
 * failure mode they **handled**. A crash (`isScriptFaultMessage`, #7543) is not
 * that mode, so it is classified as a fault"* — and so the crash terminal that
 * lived INSIDE the unwrap door now sits above the code-gated arms, which are
 * asked before that door. It is the same terminal, moved, not a second one:
 * ⛔ there is exactly one `isScriptFaultMessage` gate on this path.
 *
 * Before this card the answer depended on whether the crashing body happened to
 * declare a code an arm recognises: a crash carrying `DELETE_RESTRICTED` was
 * answered `409` with the QuickJS debug wrapper as its client-facing sentence,
 * while the same crash carrying no declared code reached the sanitised
 * {@link UNCLASSIFIED_FAULT}. The ruling on that: *"an internal stack-shaped
 * sentence at a business status is both a leak and a lie to the client about
 * what happened"*.
 *
 * ⛔ What this deliberately does NOT touch, in the ruling's own words: *"Ordinary
 * declared refusals (a hook that throws a business error carrying a code, no
 * crash) are **untouched** — only the crash branch moves."* A business refusal
 * fails {@link isScriptFaultMessage}, and a non-sandbox producer fails
 * {@link isSandboxOrigin}, so both keep every byte of the arm's answer —
 * `error-response-sandbox-arm-message.test.ts` §1-§3 are the standing controls
 * and §4 pins the negative control per arm.
 *
 * ⛔ Nor does it widen the `developerMessage` channel: #7543's existing rule for
 * a fault is what {@link UNCLASSIFIED_FAULT} emits, unchanged — status, the
 * catalog's `INTERNAL_ERROR`, and no prose from the crash.
 */
function isSandboxCrash(error: any): boolean {
    return isSandboxOrigin(error) && isScriptFaultMessage(error.innerMessage);
}

/**
 * [commit 6d178a408, contract-review condition 4] A structured arm answering a **5xx**
 * never displaces a status the producer declared in the **4xx** band — asked by
 * BOTH doors, so the answer cannot depend on which one caught the error.
 *
 * The 5xx band is fenced out of this card in both directions: a producer-declared
 * 5xx keeps {@link resolveErrorResponse}'s prose-withholding arm (#5437 / #5582 /
 * #5907), and — this rule — a 5xx-answering arm never overrides a caller-facing
 * 4xx the producer named. Only one arm answers a 5xx today
 * (`ERR_DATASOURCE_UNAVAILABLE`'s 503) and its producer declares no `status` at
 * all, so this changes nothing on the wire; it is here because the review
 * measured the two doors giving `503` and `400` for the same synthesised error,
 * which made "identical by construction" false in a shape no test held.
 *
 * ⛔ Deliberately NOT the guard-1 rule as well. A producer-declared 5xx meeting a
 * 4xx arm is a DIFFERENT question, answered per door on purpose and pinned as a
 * named divergence in `error-response-structured-arm-door-parity.test.ts` §4
 * rather than silently converged here.
 */
function fiveXxArmDisplacesDeclared4xx(
    error: any,
    structured: { status: number } | undefined,
): boolean {
    if (structured === undefined || structured.status < 500) return false;
    const declared = error?.status;
    return typeof declared === 'number' && declared >= 400 && declared < 500;
}

/**
 * [commit 10220a7bf / commit 65846bc46] Is this thrown value the ENGINE's unique-violation
 * envelope — `@objectstack/objectql`'s `DuplicateRecordError`?
 *
 * Gated on the envelope, name AND code, not on the code alone: a hook that
 * deliberately throws the registered `DUPLICATE_RECORD` from a sandbox body is
 * a different producer speaking a member of the vocabulary and keeps its own
 * sentence and its own code (`rest-duplicate-record-arm.test.ts` §5). The
 * class is recognised by its declared contract rather than by `instanceof`
 * so the import runner's row report, which never sees the class, applies the
 * identical rule. `metadata-protocol`'s `toRowApiError` carries the same
 * predicate for the batch rows — one rule, stated at each boundary that
 * crosses to a client, so a whole-request failure and a row agree on which
 * throws are the engine's envelope.
 *
 * The arm in {@link structuredCodeAnswer} spells the same two-part gate
 * INLINE rather than calling this: `error-response-sandbox-arm-message.test.ts`
 * §6 keys every arm of that classification by its `error?.code === '…'`
 * literal (the drift guard that proves each producer-sentence relay asks the
 * shared sandbox rule), and an arm hidden behind a call would drop out of
 * that scan. Two spellings of one predicate in one file, each pinned: the
 * import-row pin drives this function, the arm test drives the arm.
 */
export function isEngineDuplicateRecordEnvelope(error: unknown): boolean {
    const e = error as { code?: unknown; name?: unknown } | null | undefined;
    return e?.code === 'DUPLICATE_RECORD' && e?.name === 'DuplicateRecordError';
}

/**
 * [commit 6d178a408] The bespoke structured arms, in ONE place, so BOTH REST error doors
 * can ask them FIRST.
 *
 * ## The defect this retires
 *
 * `classifyDataError` has always surfaced these arms ahead of its own
 * declared-status passthrough, "so the structured fields survive the generic
 * catch-alls". {@link resolveErrorResponse} — the door every route reporting
 * through {@link handleRouteError} / {@link sendThrownError} uses (createMany,
 * updateMany, deleteMany, batch, clone, the import/export routes and the
 * metadata / UI families) — takes its OWN declared-status passthrough BEFORE
 * delegating here, so on those routes the arms were never reached at all. One
 * refusal, two bodies, decided by which route caught it:
 *
 *   engine `DELETE_RESTRICTED`  (status 409) → `developerMessage`,
 *       `dependentObject`, `dependentCount`, `object` all dropped
 *   `ConcurrentUpdateError`     (status 409) → `currentVersion`,
 *       `currentRecord`, `object` dropped
 *   `DuplicateRecordError`      (status 409) → `field`, `object`,
 *       `developerMessage` dropped, and `code` left as the engine spelling
 *       `DUPLICATE_RECORD` instead of the wire's `UNIQUE_VIOLATION`
 *   `FEEDS_DISABLED` / `FILES_DISABLED` / `ATTACHMENT_PARENT_ACCESS` /
 *       `ATTACHMENT_DELETE_DENIED` / `RECORD_NOT_ACCESSIBLE` (status 403)
 *       → `object` dropped
 *   engine `INVALID_FIELD`      (status 400) → `field`, `object` dropped
 *
 * ## Why a shared classification rather than a second exclusion list
 *
 * The passthrough already carried one exclusion, and it is this same argument
 * accepted once for one code:
 *
 * > [#3770] `OBJECT_NOT_FOUND` is deliberately excluded from this
 * > status-passthrough: `mapDataError` owns its canonical envelope, and
 * > short-circuiting here would ship a second wire code for the same condition
 * > depending on which route caught it.
 *
 * That exclusion never grew past its first case, which is what produced the
 * five rows above. A list that must be extended by hand for every new arm
 * fails the same way again; a classification both doors ASK cannot, because
 * adding an arm here fixes both doors at once. Pinned door-to-door in
 * `error-response-structured-arm-door-parity.test.ts` rather than asserted.
 *
 * ## The boundary
 *
 * Every arm here is decided on what the PRODUCER DECLARED — its `code`, or the
 * error `name` where a class is the contract. Nothing here reads message TEXT
 * to decide WHICH condition this is; that is the line, and it is why the
 * `PERMISSION_DENIED` arm (whose third limb sniffs a `[Security] Access denied`
 * prefix) stays in {@link classifyDataError} below rather than being lifted.
 * Answering `undefined` means "no bespoke arm knows this error" — the caller
 * decides what that means for its own door, and
 * {@link fiveXxArmDisplacesDeclared4xx} is the one condition BOTH doors put on
 * taking the answer.
 *
 * ## What the `UNIQUE_VIOLATION` answer restores, per driver
 *
 * Corrected under the contract review of commit 6d178a408 (condition 7), which measured the
 * earlier statement backwards.
 *
 * On the **SQL** drivers the bulk doors answered `409 UNIQUE_VIOLATION` with the
 * curated sentence and `field` until #14095: the raw driver error declares no
 * `status`, so it fell past the declared-status passthrough into
 * `isUniqueViolationError` below. #14095's envelope DOES declare one, so from
 * then on those doors answered the engine spelling. This restores them.
 *
 * On **driver-memory** the wire CODE was already `UNIQUE_VIOLATION` before
 * #14095 and never moved: its raw refusal declares `code = 'UNIQUE_VIOLATION'`
 * and `status = 409` itself (`memory-unique-constraint.ts`, `conflictRefusal`),
 * so it took the passthrough — which relays a REGISTERED code verbatim through
 * {@link thrownCodeFields}. What changes for that driver is the SENTENCE: its
 * raw message quotes the offending values as JSON, and the curated one does
 * not. ⛔ So "the code is new there" is the wrong way round; the withheld value
 * is the change.
 *
 * ## One wire spelling on the route — the rows too (commit 65846bc46)
 *
 * The contract review of commit 6d178a408 (condition 2) disclosed a fork this file's "one
 * condition, one wire code" framing did not cover: the DOORS answered a
 * `DuplicateRecordError` as `UNIQUE_VIOLATION` (the ruling commit 10220a7bf implemented, the arm
 * below), while a batch or import ROW did not go through this classification
 * at all — `metadata-protocol`'s `toRowApiError` put the thrown REGISTERED
 * code on the row verbatim and `import-runner`'s row report did the same — so
 * after commit 6d178a408 a whole-request failure on `POST /data/:object/batch` or
 * `POST /data/:object/import` said `UNIQUE_VIOLATION` while a row on the SAME
 * route said `DUPLICATE_RECORD`.
 *
 * Maintainer ruling (2026-09-03, commit 65846bc46): a unique-constraint refusal has ONE
 * wire spelling on every route, `UNIQUE_VIOLATION` — the standard-catalog
 * member the published protocol docs give for the 409 constraint-violation
 * body. The row derivations now apply the same mapping this arm applies, keyed
 * the same way ({@link isEngineDuplicateRecordEnvelope}: registered code AND
 * class name, never message text): `toRowApiError` for the rows of
 * `POST /data/:object/batch`, and `toFailedResult` for the import runner's
 * row reports. The single-record door's code did not move (the refusal commit 10220a7bf built
 * stands), no ledger waiver was added — the duplication is removed, not
 * declared — and the ENGINE's thrown identity is unchanged:
 * `DuplicateRecordError.code` is still `DUPLICATE_RECORD` in-process; only
 * what crosses the HTTP boundary spells `UNIQUE_VIOLATION`.
 */
function structuredCodeAnswer(
    error: any,
    object?: string,
): { status: number; body: Record<string, unknown> } | undefined {
    // Referential-integrity restrict on delete → 409 with the dependent count.
    // Surfaced FIRST so the structured fields survive the generic catch-alls.
    if (error?.code === 'DELETE_RESTRICTED') {
        return {
            status: 409,
            body: {
                error: armSentence(error) ?? 'Cannot delete: dependent records exist',
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
                error: armSentence(error) ?? 'Record was modified by another user',
                code: 'CONCURRENT_UPDATE',
                ...(error?.currentVersion ? { currentVersion: error.currentVersion } : {}),
                ...(error?.currentRecord ? { currentRecord: error.currentRecord } : {}),
                ...(object ? { object } : {}),
            },
        };
    }
    // [commit 10220a7bf] The engine's insert-conflict envelope → 409 `UNIQUE_VIOLATION`,
    // with the structured `field` restored.
    //
    // Since #14095 `engine.insert` answers a driver's unique violation with the
    // `DuplicateRecordError` envelope — `code: 'DUPLICATE_RECORD'`, `status:
    // 409`, `object`, `field` when the dialect determinably named a column,
    // the driver error whole on `cause`. It DECLARES a status, so it reached
    // the declared-status passthrough below first and left through it: status
    // right, `field` gone, and the platform's own sentence in `error`, while
    // the `isUniqueViolationError` arm further down — holding the curated
    // end-user wording and the `field` key since #7821 — was never reached
    // for an insert conflict any more. Surfaced FIRST, beside the two
    // structured 409s above, for the same reason they are: the structured
    // field must survive the generic catch-alls.
    //
    // **The wire `code` stays `UNIQUE_VIOLATION`** (triage ruling on the card,
    // 2026-09-02: the answer that changes nothing for clients — every consumer
    // branching on this conflict today reads `UNIQUE_VIOLATION`, and renaming
    // a wire code under existing consumers is a published-contract change,
    // not a door's call). **No `declaredCode` beside it.** `DUPLICATE_RECORD`
    // is a `StandardErrorCode` member, and `ApiErrorSchema.declaredCode`
    // (`packages/spec/src/api/contract.zod.ts`, with its docblock) together
    // with ADR-0112's "presence means demotion" amendment define the field as
    // the demoted spelling of an UNREGISTERED code — absent when the
    // producer's code IS a vocabulary member. So the field stays ABSENT here
    // (contract review on the card, 2026-09-02), and the engine's spelling
    // stays in-process exactly as every dialect code (`SQLITE_CONSTRAINT_UNIQUE`,
    // `23505`, `ER_DUP_ENTRY`) always has at the `isUniqueViolationError` arm
    // below. ADR-0112's 2026-08-29 scope correction declares the hand-written
    // `declaredCode` emission population to be exactly one site; this arm is
    // not a second. Pinned in `rest-duplicate-record-arm.test.ts`: §0 (both
    // codes parse as `ErrorCode` — the reason) and §1 (`not.toHaveProperty`).
    //
    // **Two sentences — the `DELETE_RESTRICTED` split above.** `error` is the
    // curated end-user sentence the #6250/#7821 arm has always produced: fixed
    // text plus, at most, the bare column identifier the ENGINE resolved
    // through `uniqueViolationColumn` (`field` is read off the envelope, not
    // re-derived — the envelope is the contract). `developerMessage` is the
    // engine's own sentence (`message`): it names the object and the column
    // and carries no value. The envelope's own `developerMessage` is
    // deliberately NOT relayed — it addresses the in-process caller of
    // `engine.insert` ("attached as `cause`", and the in-process spelling
    // beside the wire one), and `cause` never reaches this wire.
    //
    // **The body echoes nothing the driver said.** `cause` never reaches the
    // wire and the sentence is fixed text. This matters most for
    // `driver-memory`, whose raw refusal declares `status: 409` itself and so
    // ALREADY took the passthrough before #14095 — with a message quoting the
    // offending values as JSON. The envelope removed that; this arm keeps it
    // removed.
    //
    // ⚠️ Gated on the ENVELOPE — name AND code — not on the code alone as the
    // two siblings above are, and the difference is load-bearing: they relay
    // `error.message`, this arm REPLACES it. A hook that deliberately throws
    // the registered `DUPLICATE_RECORD` from a sandbox body is a different
    // producer speaking a member of the vocabulary; it keeps the answer the
    // sandbox unwrap door gives it today (its own sentence, its own code —
    // `rest-thrown-code-vocabulary.test.ts` §2) rather than having its
    // sentence swapped for this one and the QuickJS debug wrapper shipped as
    // `developerMessage`.
    if (error?.code === 'DUPLICATE_RECORD' && error?.name === 'DuplicateRecordError') {
        const field = typeof error?.field === 'string' && error.field.length > 0 ? error.field : undefined;
        const refused = typeof error?.object === 'string' && error.object.length > 0 ? error.object : object;
        return {
            status: 409,
            body: {
                error: field
                    ? `A record with this ${field} already exists`
                    : 'A record with this value already exists',
                code: 'UNIQUE_VIOLATION',
                ...(typeof error?.message === 'string' && error.message.length > 0
                    ? { developerMessage: error.message }
                    : {}),
                ...(field ? { field } : {}),
                ...(refused ? { object: refused } : {}),
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
                error: armSentence(error) ?? 'The datasource for this object is not available',
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
                error: armSentence(error) ?? 'Validation failed',
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
                error: armSentence(error) ?? 'This capability is disabled for the target object',
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
                error: armSentence(error) ?? 'Attachment access denied',
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
                error: armSentence(error) ?? 'Record access denied',
                code: 'RECORD_NOT_ACCESSIBLE',
                ...(error?.object || object ? { object: error?.object ?? object } : {}),
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
    // [commit 6d178a408, corrected under contract-review condition 5] Gated on
    // `!isSandboxOrigin` because this arm used to sit BELOW the sandbox unwrap
    // door and now sits above it. The clause is that POSITION, written down —
    // and position is its WHOLE justification here. ⛔ Not the sibling arm's
    // reason: this arm ships a FIXED sentence (`Object '…' is not registered`),
    // never `error.message`, so no debug wrapper could reach the wire through
    // it. What the clause preserves is which DOOR answers a sandboxed producer:
    // on `origin/main` the unwrap door (#11588 / #7543) got there first and
    // shipped `innerMessage` with the producer's declared status, and without
    // this clause the lift would have taken that answer away from it.
    //
    // One measured consequence, stated rather than left to be rediscovered: a
    // sandboxed producer declaring a **5xx** with this code used to fall PAST
    // the unwrap door (declared >= 500) into this arm and answer `404`. It now
    // keeps its declared 5xx with the prose withheld, on both doors. That is
    // #5582's rule rather than this arm's, and it is a status move on the
    // single-record door — pinned in
    // `error-response-structured-arm-door-parity.test.ts` §4.
    if (error?.code === 'OBJECT_NOT_FOUND' && !isSandboxOrigin(error)) {
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
    // envelope as the driver-string branch below (which classifies a driver's
    // missing-column text, and since #20701 says so rather than "Unknown
    // field"), so one wire shape serves both. Must precede the generic 4xx passthrough,
    // which would ship the message but drop `field`.
    // [commit 6d178a408] `!isSandboxOrigin`: the same clause as the arm above, and here
    // it carries the sentence reason TOO — this arm really does ship
    // `error.message`, which for a sandboxed producer is the QuickJS debug
    // wrapper #11588 exists to keep off this wire. The same declared-5xx status
    // move recorded above applies to this code as well.
    if (error?.code === 'INVALID_FIELD' && !isSandboxOrigin(error)) {
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
    return undefined;
}

function classifyDataError(error: any, object?: string): { status: number; body: Record<string, unknown> } {
    // [commit cf6e0a193] A sandboxed CRASH is a fault before it is anything else — above
    // the arms, because the arms are asked before the unwrap door that used to
    // hold this terminal. Maintainer ruling 2026-09-04 (batch #27), option B:
    // a crash "reaches the unwrap door's sanitised 500 whatever code it
    // declares". See {@link isSandboxCrash} for the ruling and its fence.
    //
    // ⛔ The terminal is not duplicated — it MOVED here from inside the unwrap
    // door below, which is why that door now reads a body that REPORTED.
    if (isSandboxCrash(error)) return UNCLASSIFIED_FAULT();
    // [commit 6d178a408] The bespoke structured arms first, exactly as they were inline
    // here — same arms, same order, same position — now stated once so
    // {@link resolveErrorResponse} can ask them before ITS passthrough too.
    //
    // The one condition on taking their answer is
    // {@link fiveXxArmDisplacesDeclared4xx}, asked at BOTH doors: a 5xx arm does
    // not override a 4xx the producer declared. Without it this door answered
    // `503` where the other answered the declared `400`, for the same error.
    const structured = structuredCodeAnswer(error, object);
    if (structured !== undefined && !fiveXxArmDisplacesDeclared4xx(error, structured)) return structured;
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
                error: armSentence(error) ?? 'Permission denied',
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
    //
    // [commit cad8b42f0] The `code` the producer declared rides too — via
    // {@link thrownCodeFields}, the same one definition the three arms around
    // it use. This branch used to omit `code` unconditionally, and that
    // omission is what the card measured: a QuickJS hook throwing
    // `{ code: 'RECORD_LOCKED', status: 409 }` reached the client with the
    // status and no machine-readable code, so a caller could tell "frozen
    // record" from "value already taken" only by substring-matching localised
    // prose — the failure mode the ADR-0112 enum exists to remove.
    //
    // The old rationale, recorded because it was load-bearing until it wasn't:
    // "older @objectstack/client builds (still bundled in deployed consoles)
    // prepend any `code` to the human-readable message". Both halves are now
    // false, measured rather than assumed:
    //
    //  - The shipping client does the OPPOSITE by explicit rule. Its error
    //    construction keeps `.message` to "the server's human-readable message
    //    — no `[ObjectStack]` branding and no `CODE:` prefix" and attaches the
    //    code programmatically as `error.code` (`packages/client/src/index.ts`,
    //    the `fetch` failure path).
    //  - "Older bundled client, current server" is not a supported pairing.
    //    #4007 retired the compat read for exactly that combination: SDK and
    //    server ship on one release train (a changesets fixed group), and
    //    ADR-0112 renamed the code VALUES anyway, so a code an old console
    //    could mis-render is a code it could no longer match either.
    //
    // And the omission was never the status policy it looked like from
    // outside. It dropped `code` on a declared 400 exactly as on a declared
    // 409, and KEPT it on a declared 5xx by falling through to the passthrough
    // below — so one sandboxed producer got its code on 503 and lost it on
    // 409. What made the card's reading look status-shaped is which codes have
    // a bespoke arm ABOVE this one: `DELETE_RESTRICTED` and
    // `VALIDATION_FAILED` do and never reach here, `RECORD_LOCKED` /
    // `DUPLICATE_VALUE` / `FORBIDDEN` do not and did.
    //
    // ⛔ Nothing is invented for a producer that declared no code:
    // `thrownCodeFields` answers `{}` there, which is ADR-0112's rule and the
    // answer the sibling arms already give (`rest-thrown-code-vocabulary.test.ts`
    // §3). Adding `code` here narrows nothing and widens nothing about the
    // VOCABULARY either — an unregistered spelling is demoted to
    // `declaredCode` by the same shared resolver, so this door stops being the
    // one flat exit #9232 could not reach.
    //
    // [#11588] The same two reads, in the same order, are named as
    // {@link sandboxBusinessMessage} for the declared-status passthrough in
    // {@link resolveErrorResponse}, which sits ABOVE this door and used to ship
    // the wrapper verbatim. This door keeps its own spelling because its crash
    // case is a TERMINAL (the sanitised 500) rather than a fall-through, which
    // is a different answer to the same question; the two are held together by
    // a door-to-door pin (`rest-hook-refusal-message-parity.test.ts` §4) rather
    // than by this comment.
    if (typeof error?.innerMessage === 'string' && error.innerMessage) {
        // [#7543] …and by the time control reaches here the body REPORTED
        // something: a body that CRASHED arrives at this function too, and its
        // `TypeError: not a function` is an internal fault rather than a
        // business message — {@link isScriptFaultMessage}. "Deliberately FIRST:
        // a crash outranks everything else about the error, including a stray
        // declared `status`" is unchanged as a rule; [commit cf6e0a193] moved the gate
        // that applies it to the TOP of this function ({@link isSandboxCrash}),
        // because the code-gated arms above are asked before this door and were
        // answering a crash with a business status and the wrapper prose. So
        // this branch keeps its meaning and loses its guard — the guard did not
        // disappear, it out-ranks more of the file than it used to.
        // [commit 8f266f1cd] A body that NAMES its own HTTP status is asking to be served
        // with it — the same #7867 rule `domains/actions.ts` applies on the
        // custom-action route. The QuickJS side-channel carries a body-thrown
        // error's declared `status` out of the VM onto `SandboxError.status`,
        // and this branch used to answer 400 unconditionally, so a deliberate
        // `e.status = 403` was dead on arrival at this door while the actions
        // door honoured it — the #7525/#8016 door-disagreement shape, one
        // branch earlier. The read is {@link declaredHttpStatus}: the same
        // both-spellings 400-599 band as the passthrough below, so a nonsense
        // or out-of-band status is not a declaration and the undeclared
        // default stays exactly the 400-with-verbatim-message the dogfood
        // pins (`hook-error-format.dogfood.test.ts`) require.
        const declared = declaredHttpStatus(error);
        if (declared === undefined || declared < 500) {
            // [commit cad8b42f0] `status` is resolved BEFORE the code fields are asked
            // for, and handed to {@link thrownCodeFields} as the fallback, so
            // an unregistered spelling demotes against the status the client
            // actually receives rather than against a default — the #9232 §5
            // rule, applied here for the first time.
            const status = declared ?? 400;
            return {
                status,
                body: {
                    error: error.innerMessage,
                    ...thrownCodeFields(error, status),
                    ...(object ? { object } : {}),
                },
            };
        }
        // A declared SERVER-band status is not a business refusal addressed to
        // the caller in its own words — it is a producer-declared server
        // fault, and this file already has exactly one arm for that: the
        // declared-status passthrough below, whose 5xx half keeps the status
        // and withholds the prose unconditionally (#5582). Fall through to it
        // rather than duplicating the arm here — one condition, one wire
        // answer. (The structured `code` branches in between keep outranking
        // the passthrough for this producer exactly as they do for every
        // other — the #7525 §5 pins.)
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
        // server fault" (`status >= 500` *and* a non-empty string `code`;
        // commit 64cd01082, pinned by `error-leak.test.ts`, read by the analytics route
        // here and by `runtime`'s dispatcher). Inside this branch its status
        // half is already true, so what it adds is the `code` half — and it
        // adds it as a TESTED predicate rather than a fourth open-coded
        // truthiness check, which is what keeps a numeric driver `errno` or an
        // empty string from landing on the wire as an ADR-0112 code.
        //
        // A 5xx with NO code passes its status through carrying no code at all,
        // deliberately: ADR-0112 D4 governs the semantic-CODE channel — the
        // producer names the condition on the CODE axis (see the
        // `resolveThrownHttpError` docblock above for why the phrase is this
        // file's own prose and not an ADR quotation) — so a
        // half-declaration is honoured for the half that was declared and
        // nothing is invented for the half that was not. The status half is
        // kept on #5582/#7525's rule, not the ADR's: ADR-0112 rules no HTTP
        // status here. That is the answer
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
        //
        // [#11718] The arm's BODY now lives in {@link declaredServerFaultAnswer},
        // unchanged — every paragraph above still describes it, and this call is
        // the only reader of it that existed before. It was lifted out so the
        // `/analytics/dataset/query` face could answer a declared 5xx with the
        // same bytes rather than a second hand-built envelope; `/data`'s answer
        // is the reference and does not move.
        const declaredServerFault = declaredServerFaultAnswer(error);
        if (declaredServerFault !== undefined) {
            return declaredServerFault;
        }
        // [#5423] The 4xx arm is UNCHANGED by #5582: a 4xx message is addressed
        // TO the caller and is the remedy, so it keeps its wording, its
        // `object`, and the bound as a TRUNCATION rather than a replacement.
        // An over-long message is TRUNCATED, not swapped for generic text
        // (#5423) — see {@link truncateClientMessage}. A missing or empty one
        // still degrades to `'Request failed'`: there is nothing to truncate.
        //
        // [#12975] …and the sentence it keeps is the HUMAN half only. A
        // producer using the ADR-0111 `CODE: message` idiom restates on the
        // MESSAGE axis a token this body already carries on the `code` axis
        // ({@link thrownCodeFields}, three lines down), and that restatement
        // was reaching Console's toast in front of a localized sentence —
        // `FORBIDDEN: 您无权修改或删除这条记录…` — where it was the only
        // non-human fragment left in the user's face. Maintainer ruling,
        // 2026-08-29: one envelope semantics, `error` = human language,
        // `code` = the machine token. {@link withoutDeclaredCodePrefix} carries
        // why the strip is anchored to the producer's declared code rather than
        // to a SCREAMING_SNAKE shape.
        //
        // ⛔ The strip runs BEFORE the bound, not after: #5423's budget belongs
        // to the text addressed to the caller and the prefix is not that text,
        // so truncating first would spend part of the caller's 500 characters
        // on a token they must not read.
        //
        // A message that is NOTHING BUT the prefix degrades to 'Request failed'
        // through the same limb an absent or empty one takes — there is no
        // human half to ship, and the token rides `code` regardless.
        const authored = typeof error?.message === 'string'
            ? withoutDeclaredCodePrefix(error.message, error)
            : '';
        const msg = authored.length > 0
            ? truncateClientMessage(authored)
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
    //
    // [#20701] The sentence says what the DATABASE said — the table has no
    // such column — and never "Unknown field". This branch sees only the
    // driver's text, not the object's field map, while the engine's
    // declared-field door refuses an undeclared write key before any driver
    // runs, in its own words, and the read doors gate undeclared filter names
    // the same way. So a request that gets this far usually names a field the
    // object DECLARES whose column is missing: metadata and the physical
    // schema have drifted, and "Unknown field" sent the author hunting for a
    // typo in a correct declaration. (A formula column was the common case;
    // the engine strips that value now, reason `computed`.) `code`, `status`,
    // `field` and `object` are unchanged.
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
                    ? `The database table${object ? ` of object '${object}'` : ''} has no column for field '${field}'. `
                        + `If the object declares '${field}', its database schema has drifted from the metadata: `
                        + `run 'os migrate' to reconcile.`
                    : 'The request references a column the database table does not have.',
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
        // driver and judges `required` only; nothing before the driver reads
        // `storage.notNull`. ADR-0113 D1 / D2 keep the write contract
        // (`required`) and the column constraint (`storage.notNull`) apart on
        // purpose, so a NOT NULL violation that reaches this far is NOT by itself
        // evidence of drift: an object that declares `storage: { notNull: true }`
        // without `required` lands here on a healthy schema, and `os migrate`
        // changes nothing for it. Drift (#2186) is the other way in: the column
        // is NOT NULL and the metadata declares neither. This branch sees the
        // driver's text and the object's name, never the field map, and telling
        // the two apart would take a registry read, so the `hint` leads with the
        // remedy that holds for both (the column requires a value: provide it, or
        // declare the field `required`) and names drift only as the case that is
        // conditional on the declaration.
        // We keep the `VALIDATION_FAILED` / `required` envelope for back-compat
        // (form UIs key off it); `code`, `status`, `fields` and the sentence
        // are the same for both.
        return {
            status: 400,
            body: {
                error: `${field} is required`,
                code: 'VALIDATION_FAILED',
                fields: [{ field, code: 'required', message: `${field} is required` }],
                hint:
                    `The database column for '${field}' requires a value: provide it, or declare the field \`required\` in the object metadata. ` +
                    `If the object declares neither \`required\` nor \`storage: { notNull: true }\` for '${field}', ` +
                    `the physical schema has drifted from metadata instead: run 'os migrate' to reconcile ` +
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

// The members above that are not `export`ed where they are declared, but that
// `@objectstack/rest`'s emission half (`error-response.ts`) composes. Listed
// here rather than by editing their declarations, so the moved block stays
// byte-identical to the one that left `rest`.
export {
    truncateClientMessage,
    thrownCodeFields,
    withoutDeclaredCodePrefix,
    withDeclaredUserMessage,
    isSandboxOrigin,
    isSandboxCrash,
    fiveXxArmDisplacesDeclared4xx,
    structuredCodeAnswer,
};
