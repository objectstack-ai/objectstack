// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the batch row results and row errors, the client-facing failure text and code, seed validation, and the metadata store and read failure errors.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
import { declaredHttpStatus, declaredUserMessage, isSandboxOrigin, resolveThrownHttpError, sandboxBusinessMessage } from '@objectstack/types';
import type { ApiError, BatchOperationResult } from '@objectstack/spec/api';
import { ErrorCode, standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { zodIssuesToMetadataIssues } from './protocol-metadata-issues.js';
import type { MetadataIssueEntry } from './protocol-metadata-issues.js';
import type { MetadataWriteFace } from './protocol-destructive-change.js';

/**
 * One row of a bulk-write result — exactly the `BatchOperationResult` the spec
 * declares (`BatchOperationResultSchema`, spec/api/batch.zod.ts). Aliased to
 * the spec type so tsc pins every batch loop in this file to the wire contract:
 * declared = delivered (#4793; the conformance pin in
 * protocol.batch-row-conformance.test.ts holds the runtime side).
 *
 * History: this was a deliberately divergent legacy shape (`error: string`,
 * `record`, no `index`) that predated the schema; ADR-0119 D4 left it in place
 * so a wire-visible change would not ride along on a bug fix, and #4793 is
 * that tracked reconciliation, shipped in the v17 major window. The rollback
 * marking (#4620) is structured with it: `ROLLED_BACK` / `NOT_ATTEMPTED` are
 * `ApiError.code` values, not message-string prefixes.
 */
export type BatchDataRowResult = BatchOperationResult;

/**
 * Map a thrown per-row batch error into the wire's `ApiError` (#4793).
 *
 * `code` keeps the thrown error's own code when it is part of the declared
 * vocabulary (StandardErrorCode ∪ ERROR_CODE_LEDGER — an invented code would
 * make the row fail `BatchOperationResultSchema.parse`, exactly the drift the
 * conformance pin exists to catch loudly rather than ship). Otherwise it
 * derives from the HTTP status when the error carries one, falling back to
 * INTERNAL_ERROR — an unclassified engine throw is a 500 in row form.
 *
 * `message` is {@link clientFacingRowFailureText}'s decision (#8502): a caught
 * sentence reaches a caller only when its producer declared a client-facing
 * refusal. `fallback` is what the row says otherwise — it names the operation
 * and quotes nothing.
 *
 * ⛔ `fallback` is REQUIRED, not defaulted. All three catches that build a row
 * know their operation, and a default would let a fourth one be added that
 * silently reports the wrong verb.
 *
 * ## `httpStatus` reads the DECLARATION, not one spelling of it (#8570)
 *
 * This limb read `err.status` and nothing else, so of the producers measured at
 * these catches — a real `ObjectQL` over a real `SqlDriver`, driven through all
 * three bulk-write loops — two well-defined client refusals shipped a row with
 * no status at all:
 *
 * | producer | code | `.status` | `.statusCode` | validation shape | was | is |
 * |---|---|---|---|---|---|---|
 * | {@link rowRequiredIdError} | VALIDATION_FAILED | **400** | — | no | 400 | 400 |
 * | `recordNotFoundError` (`@objectstack/core`) | RECORD_NOT_FOUND | **404** | — | no | 404 | 404 |
 * | objectql `ValidationError` | VALIDATION_FAILED | — | — | **yes** | — | **400** |
 * | plugin-approvals' record lock | RECORD_LOCKED | — | **409** | no | — | **409** |
 * | an app hook throwing a bare `Error` | — | — | — | no | — | — |
 * | driver fault (`SqliteError`, …) | SQLITE_* | — | — | no | — | — |
 *
 * The first two are siblings of the last four *in the same response*: a caller
 * branching on `httpStatus` to tell "fix your input" from "the server broke"
 * got an answer for some failure rows and nothing for others, with no signal
 * saying which. The single-spelling defect is #7525's, fixed there at the HTTP
 * door; this is the same defect on the row.
 *
 * The question is answered by {@link resolveThrownHttpError}, IMPORTED — the
 * `message` limb beside it already delegates there (#8502), and a second local
 * chain would be the third derivation of "what status is this throw" in one
 * function. ⛔ Do not re-spell it as `status ?? statusCode ?? validation`.
 *
 * ## ⛔ `declaredStatus`, never `status` — the over-broad direction is real
 *
 * That resolver answers for EVERY throw: its `status` is 500 for a bare hook
 * `Error` and for a `SqliteError`, because 500 is the caller's fallback.
 * Stamping that would put `httpStatus: 500` on the last two rows of the table,
 * which never carried one — an ADDITION to the wire for those populations, and
 * a claim the producer never made. `declaredStatus` is the same resolution
 * minus the fallback: present exactly when the throw declared a status in one
 * of the three spellings, absent otherwise. So a declared refusal gains the
 * status it always meant, and an undeclared fault keeps carrying none.
 *
 * The gate is DECLARED-ness and deliberately not the 4xx band that
 * {@link clientFacingRowFailureText} uses. That limb decides disclosure of free
 * text, where a 5xx must be withheld; this one decides a number the producer
 * itself authored, and a row already ships `httpStatus: 503` today when the
 * refusal spells `.status` — narrowing to 4xx would WITHDRAW a status the wire
 * carries, which is a different decision from this one.
 *
 * Both limbs read the same resolution for a second reason: they must agree.
 * Deriving `code` from `err.status` while `httpStatus` came from
 * `declaredStatus` would mint incoherent rows — `{ code: 'INTERNAL_ERROR',
 * httpStatus: 409 }` for a `statusCode`-spelled refusal whose own code the
 * ledger does not know.
 *
 * ## One wire spelling for a unique-constraint refusal (commit 65846bc46)
 *
 * The engine answers a driver's unique-constraint refusal with its
 * `DuplicateRecordError` envelope — `code: 'DUPLICATE_RECORD'`, `status: 409`,
 * the driver's error whole on `cause`. `DUPLICATE_RECORD` is a registered
 * member, so the verbatim limb above used to put it on the row as-is, while
 * every WHOLE-REQUEST door in `@objectstack/rest` answers the same class as
 * `UNIQUE_VIOLATION` — the standard-catalog member the published protocol
 * docs give for the 409 constraint-violation body. After commit 6d178a408 the two
 * spellings sat side by side in one route's responses: a whole-request
 * failure on `POST /data/:object/batch` said `UNIQUE_VIOLATION`, a row on the
 * same route said `DUPLICATE_RECORD`.
 *
 * Maintainer ruling (2026-09-03, recorded in commit 65846bc46): one wire spelling on every route,
 * `UNIQUE_VIOLATION`; the row reports it too. So this limb maps the engine's
 * envelope to the wire spelling BEFORE the verbatim registered-code rule —
 * keyed exactly as the whole-request arm keys it (`error-response.ts`'s
 * `structuredCodeAnswer`: the registered code AND the class name), never by
 * message text. `httpStatus` still reads the declared 409 and `message` is
 * still the envelope's platform sentence (a declared 4xx, so it is quoted); the
 * driver's text stays on `cause`, which never reaches the row.
 *
 * ⛔ The engine's thrown identity is NOT renamed: `DuplicateRecordError.code`
 * stays `DUPLICATE_RECORD` (an in-process caller — a hook, a flow node —
 * branches on that). What moves is what a ROW REPORTS across the HTTP
 * boundary. And a producer that merely SPEAKS `DUPLICATE_RECORD` — a hook
 * throwing the registered code without being the engine's class — keeps its
 * own code on the row, the same discrimination the whole-request arm makes.
 *
 * ## [#24561] A sandboxed body's refusal is not a server fault in row form
 *
 * The `INTERNAL_ERROR` default assumes an error that declared nothing is a
 * fault. A sandboxed hook body's bare `throw new Error('…')` declares no status
 * or code either, yet every data door (`/data`, `/createMany`, `/import`)
 * serves it as a `400` refusal in the body's words, so a batch row said
 * `INTERNAL_ERROR` beside the doors' `VALIDATION_ERROR` for the same refusal.
 * {@link sandboxRefusalSentence} is the one test both limbs ask: when it
 * answers, the `code` limb derives from the `400` the doors serve (the
 * `declared ?? 400` of `classifyDataError`, `@objectstack/types`). A code or
 * status the body DID declare still wins, as for every other producer.
 *
 * ⛔ `httpStatus` is NOT stamped for it. That limb carries only a status the
 * producer declared (above), and this body declared none.
 */
export function toRowApiError(err: any, fallback: string): ApiError {
    const thrown = isEngineDuplicateRecordEnvelope(err)
        ? 'UNIQUE_VIOLATION'
        : typeof err?.code === 'string' && ErrorCode.safeParse(err.code).success
            ? (err.code as ApiError['code'])
            : undefined;
    const { declaredStatus } = resolveThrownHttpError(err);
    const servedStatus = declaredStatus ?? (sandboxRefusalSentence(err) !== undefined ? 400 : undefined);
    return {
        code: thrown ?? (servedStatus !== undefined ? standardErrorCodeForHttpStatus(servedStatus) : 'INTERNAL_ERROR'),
        message: clientFacingRowFailureText(err, fallback),
        ...(declaredStatus !== undefined ? { httpStatus: declaredStatus } : {}),
    };
}

/**
 * [commit 65846bc46] Is this thrown value the ENGINE's unique-violation envelope?
 *
 * The same two-part gate `@objectstack/rest`'s whole-request arm applies —
 * the registered code AND the class name — so a batch row and a whole-request
 * failure recognise the engine's envelope by one rule. Name alone would miss
 * nothing today but would let a future class of the same name speak a
 * different code; code alone would swallow a hook that deliberately throws
 * the registered `DUPLICATE_RECORD` from its own body, which is a different
 * producer speaking a member of the vocabulary and keeps its own spelling.
 * The class itself is not imported: this package does not depend on
 * `@objectstack/objectql`, and the envelope's contract is its declared
 * `code` / `name` / `status`, not its prototype.
 */
function isEngineDuplicateRecordEnvelope(err: unknown): boolean {
    const e = err as { code?: unknown; name?: unknown } | null | undefined;
    return e?.code === 'DUPLICATE_RECORD' && e?.name === 'DuplicateRecordError';
}

/**
 * [#7426] Carry a wrapped error's `code` onto its re-wrap — but only when that
 * code is part of the DECLARED vocabulary.
 *
 * ## What it fixes
 *
 * {@link ObjectStackProtocolImplementation.deleteMetaItem} is the one verb in
 * this file that re-wraps rather than rethrows: its two catches build a fresh
 * `Error` carrying the "failed to delete" context, and they carried `status`
 * forward while dropping `code`. Every sibling verb translates `ConflictError`
 * and then `throw err`s the original untouched, so `code` survives there. The
 * consequence was topology-dependent: a `SysMetadataRepository` refusal — the
 * only refusal a CONTROL-PLANE kernel can produce for these types, since
 * `deleteMetaItem`'s own two-tier block is skipped when `environmentId` is
 * undefined — reached the caller as **403 with `code: undefined`**, its code
 * surviving only as prose inside the message, while the identical refusal on a
 * project kernel arrived with `NOT_OVERRIDABLE` intact. ADR-0112 makes the code
 * the machine-readable half of a refusal; a 403 without one is what the ledger
 * exists to prevent.
 *
 * ## Why it is a PREDICATE and not `e.code = err.code`
 *
 * That re-wrap is the exit of every non-conflict failure on the path — genuine
 * driver faults as much as refusals — so an unconditional copy would put a
 * driver's own dialect (`42P01`, `SQLITE_CONSTRAINT`, `ECONNREFUSED`) into the
 * field `ApiErrorSchema.code` declares as a closed union (ADR-0112 D4), which
 * is the drift the ledger exists to stop. The gate is therefore membership in
 * `StandardErrorCode ∪ ERROR_CODE_LEDGER` — verbatim the predicate
 * {@link toRowApiError} above already applies to decide which thrown code may
 * become a wire code. One rule, one place to change it, and a code the engine
 * DID register (`ERR_DATASOURCE_UNAVAILABLE`) is as welcome as one this package
 * threw.
 *
 * ## What it deliberately does not touch
 *
 * `status`. The repository catch's `err?.status ?? 500` and the legacy catch's
 * literal `500` are unchanged — the second is a path with no authorization gate
 * on it, where every failure really is a fault, and moving either is a separate
 * contract decision. Only the `code` rule is unified across the two exits, so
 * the envelope does not vary by which failure kind produced it.
 */
function carryCatalogedErrorCode(target: Error, source: unknown): void {
    const code = (source as { code?: unknown } | null | undefined)?.code;
    if (typeof code === 'string' && ErrorCode.safeParse(code).success) {
        (target as Error & { code?: string }).code = code;
    }
}

/**
 * [#8136] Whether a caught error **declared itself a client-facing refusal** —
 * a 4xx `status` in the ADR-0112 envelope — and its sentence may therefore be
 * quoted back to the caller.
 *
 * ## The rule this answers, and why it is a POSITIVE list
 *
 * This package used to interpolate whatever it caught into the message it
 * threw (`Failed to delete customization overlay: ${err.message}`) and into the
 * `error` strings it collects for a caller. A driver failure on `sys_metadata`
 * therefore reached a client verbatim — `SQLITE_ERROR: no such table:
 * sys_metadata` on a 500, and the same text inside `failed[].error` on the
 * `PACKAGE_DELETE_PARTIAL` 400, where no message-level withhold at any HTTP
 * boundary can reach it because it is not the message. Three downstream
 * sanitizers each had a hole because of it.
 *
 * The cure is Prime Directive #12's: pay the consumer-side tolerance down at
 * the producer. So the question asked here is **not** "does this text look like
 * a driver dump?" — that is `looksLikeInternalErrorLeak`, a heuristic over
 * phrasing, and a phrasing test can only ever know the dialects someone has
 * met. It is the inverse and bounded question: **did we author this sentence
 * for a caller?** A producer that declared 4xx has said the failure is the
 * caller's to fix and has written the remedy into the message — the
 * self-correcting refusals `SysMetadataRepository` raises (`ITEM_LOCKED`,
 * `WRITABLE_PACKAGE_REQUIRED`, `NO_DRAFT`, …) are exactly that, and they
 * must survive intact. Everything else is withheld by DEFAULT, so a dialect
 * this repo has never run is handled correctly without anyone having enumerated
 * it.
 *
 * ## ⛔ NOT the complement of `declaresServerFault`
 *
 * The obvious-looking `!declaresServerFault(err)` (`@objectstack/types`, #5811)
 * is the wrong direction and would reinstate the whole defect: a bare `Error`
 * from a driver declares NOTHING, so it fails that test and would be quoted —
 * and a bare driver `Error` is precisely the case measured here. The two
 * predicates answer different halves and neither is the other's negation:
 * `declaresServerFault` asks a BOUNDARY whether to withhold a declared fault's
 * detail; this asks a PRODUCER whether it is allowed to quote at all, and an
 * undeclared error is never allowed.
 *
 * ## Why `status` alone, when the sibling code rule also checks the catalog
 *
 * {@link carryCatalogedErrorCode} gates on membership in `StandardErrorCode ∪
 * ERROR_CODE_LEDGER` because it writes `ApiErrorSchema.code`, a closed union a
 * driver's own dialect must never enter. A message is free text, so the
 * catalog does not bound it, and the two readings coincide on every refusal
 * that reaches these exits today (each declares both halves). Where they could
 * differ, status-alone is the safe direction: requiring a catalogued code too
 * would blank an authored refusal that happens to carry an uncatalogued one —
 * deleting a #4277 self-correcting message, which is a usability regression in
 * exchange for no disclosure gain.
 *
 * The withheld text never leaves the server: every call site rides the original
 * error on `cause`, which `handleRouteError` / `logWithheldServerFault` print
 * whole — the same posture {@link metadataStoreUnavailableError} already takes.
 */
export function declaresClientRefusal(err: unknown): boolean {
    const status = (err as { status?: unknown } | null | undefined)?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * [#8136] The client-facing sentence for a failed overlay delete: the caller's
 * own refusal when they declared one, and otherwise a stable line that names
 * the operation and quotes nothing.
 *
 * Both of {@link ObjectStackProtocolImplementation.deleteMetaItem}'s re-wrap
 * exits share it, for the reason {@link carryCatalogedErrorCode} gives about
 * `code`: the envelope must not vary by which path served the delete.
 *
 * The `Failed to delete customization overlay` prefix is unchanged, byte for
 * byte — it is the operation description a caller needs and several pins read
 * it. What changes is what follows the colon.
 */
function overlayDeleteFailureMessage(err: unknown, type: string, name: string): string {
    if (declaresClientRefusal(err)) {
        const declared = (err as { message?: unknown } | null | undefined)?.message;
        if (typeof declared === 'string' && declared.length > 0) {
            return `Failed to delete customization overlay: ${declared}`;
        }
    }
    return `Failed to delete customization overlay for ${type}/${name}. `
        + 'The metadata store rejected the delete; the reason is in the server log. '
        + 'Retry once the metadata database is reachable.';
}

/**
 * [#8136] The per-item `error` string a collector puts on its response — the
 * caller's own refusal when they declared one, otherwise a stable fallback.
 *
 * The counterpart of {@link overlayDeleteFailureMessage} for the paths that
 * report failure as DATA rather than by throwing. That distinction is why the
 * producer is the only place this can be fixed: `deletePackage`'s `failed[]`
 * and `cleanups[]` ride onto a `PACKAGE_DELETE_PARTIAL` 400 inside `details`,
 * so no 5xx message withhold at any HTTP boundary ever sees them.
 *
 * @param fallback - what to say when nothing may be quoted. Already the
 *   existing no-message fallback at every call site (`'delete failed'`,
 *   `'cleanup failed'`), so the withheld case reuses the sentence the caller
 *   could already receive rather than inventing a second vocabulary.
 *
 * [#8443] EXPORTED (via `index.ts`) for the same reason `recordNotFoundError`
 * is: `@objectstack/runtime`'s package-publish door carries a seed-apply
 * fallback for protocols that do not self-apply, and it reports failure as
 * data on the same `seedApplied` field this package's `applySeedBodies` does.
 * A second private restatement of the rule over there is exactly how the rule
 * drifts out of sync — the withhold and the quote must be ONE decision, in one
 * place, for both producers. `declaresClientRefusal` stays private on purpose:
 * nothing outside this file needs the raw predicate, and an exported surface
 * with no consumer is the "declared but nobody pulls it" shape AGENTS.md
 * treats as debt.
 */
export function clientFacingFailureText(err: unknown, fallback: string): string {
    if (declaresClientRefusal(err)) {
        const declared = (err as { message?: unknown } | null | undefined)?.message;
        if (typeof declared === 'string' && declared.length > 0) return declared;
    }
    return fallback;
}

/**
 * [#24561] The sentence a sandboxed hook body's business refusal says on a
 * batch row, or `undefined` when this error is not one.
 *
 * The read is `sandboxBusinessMessage` (`@objectstack/types`), the one every
 * sibling door makes (the import runner, `/data`, `/createMany`), never a
 * pattern-strip of the wrapper off `.message`. It already declines a body
 * that CRASHED and the sandbox's own fault. The one condition added here is
 * the doors' own: a refusal that declared a server-band status is answered as
 * a fault with its text withheld (`classifyDataError`'s `declared < 500`, read
 * through the same `declaredHttpStatus`), so it is not a sentence for a row
 * either.
 *
 * Both limbs of {@link toRowApiError} ask this, so the row's `code` and
 * `message` cannot disagree about whether a refusal was disclosed.
 */
function sandboxRefusalSentence(err: unknown): string | undefined {
    const sentence = sandboxBusinessMessage(err);
    if (sentence === undefined) return undefined;
    const declared = declaredHttpStatus(err);
    return declared === undefined || declared < 500 ? sentence : undefined;
}

/**
 * [#8502] The per-row `errors[].message` a bulk data write puts on its
 * response — the producer's own refusal when it declared one, otherwise a
 * stable sentence naming the operation.
 *
 * The third sink in this family, after #8333's `failed[].error` and #8442's
 * seed `errors[].message`, and the same defect: `toRowApiError` interpolated
 * `err.message` unconditionally, so a driver fault under `deleteManyData`
 * answered `{ code: 'INTERNAL_ERROR', message: 'SQLITE_ERROR: no such table:
 * leave_request' }` on a per-row result riding a **200**. No HTTP boundary's
 * 5xx withhold reaches it, because it is not the response's message — it is
 * response DATA. It also multiplies: `reconcileStoppedBatch` and
 * `buildRolledBackBatchResponse` interpolate the causal row's message into
 * every `NOT_ATTEMPTED` / `ROLLED_BACK` sibling, so one leaked sentence is
 * repeated across the batch.
 *
 * ## Why this asks the BOUNDARY RESOLVER rather than {@link declaresClientRefusal}
 *
 * The question is #8136's, unchanged: **did a producer author this sentence
 * for a caller?** What differs is the population that answers it. This sink
 * sits under `engine.insert` / `update` / `delete`, so it receives every
 * refusal the data path can raise — and MEASURED on the real stack (a real
 * `ObjectQL` over a real `SqlDriver`, driven through all three loops), that
 * population declares itself in THREE spellings, only one of which
 * `declaresClientRefusal` reads:
 *
 * | producer | code | `status` | `statusCode` | validation shape |
 * |---|---|---|---|---|
 * | {@link rowRequiredIdError} | VALIDATION_FAILED | **400** | — | no |
 * | `recordNotFoundError` (`@objectstack/core`) | RECORD_NOT_FOUND | **404** | — | no |
 * | objectql `ValidationError` | VALIDATION_FAILED | — | — | **yes** |
 * | plugin-approvals' record lock | RECORD_LOCKED | — | **409** | no |
 * | an app hook throwing a bare `Error` | — | — | — | no |
 * | driver fault (`SqliteError`, …) | SQLITE_* | — | — | no |
 *
 * The first two are the only ones a `status`-only test admits. The third is
 * the population #8442 met on the seed channel: an objectql `ValidationError`
 * carries `code: 'VALIDATION_FAILED'` and deliberately NO `status`, because
 * per `@objectstack/types`' `validation-failure.ts` deciding it means 400 is
 * "the job of whichever boundary serves it". The fourth is this sink's own,
 * and neither sibling card met it: `plugin-approvals` binds a GLOBAL
 * `beforeUpdate` hook whose `lockedError` throws `statusCode` — the spelling
 * `resolveThrownHttpError` reads "because both are produced in this repo",
 * after reading only one of them made `/api/v1/data` answer 500 to a
 * deliberate `409 RECORD_LOCKED` (#7525).
 *
 * So the test is not "does it carry `status` 4xx" but **"would the boundary
 * that serves this throw call it a client refusal?"** — and that question
 * already has exactly one implementation, {@link resolveThrownHttpError},
 * which folds all three declarations into one status. It is IMPORTED, never
 * re-spelled: a fourth local spelling of "this is a 4xx" is how a batch row
 * and the single-record `PATCH` of the same object would start disagreeing
 * about the same error. ⛔ Do not replace this with a hand-written
 * `status ?? statusCode ?? validation` chain for being cheaper to read.
 *
 * ## ⛔ Still a POSITIVE list — the undeclared case is withheld
 *
 * A hook that throws a bare `Error` has its sentence withheld, and that is the
 * measured cost of the rule, not an oversight: at this sink an undeclared hook
 * throw is indistinguishable from an undeclared driver throw, which is the
 * whole hole. The remedy is at the producer and now has three accepted
 * spellings — a 4xx `status`, a 4xx `statusCode`, or the `VALIDATION_FAILED`
 * shape `validationFailure()` builds — so declaring is cheaper than the
 * workaround, which is the direction that makes authored code hard to get
 * wrong. The same reasoning #8333 applied when it fixed P9's undeclared
 * `ZodError` at the producer rather than loosening the collector.
 *
 * ## The operator half
 *
 * The withheld sentence never leaves the server: it is logged here, at the one
 * point where the decision is made, so no call site can withhold without
 * logging. `console.warn` and not `error` deliberately — nothing claimed to be
 * persisted was silently dropped (the row reports `success: false` and the
 * counters reconcile), which is the AGENTS.md judgment question the durability
 * levels turn on.
 *
 * ## [commit 93d2d679b] …and the DISCLOSED row deliberately logs NOTHING
 *
 * Since #14095 a driver unique violation arrives here already wrapped in the
 * engine's `DUPLICATE_RECORD` envelope, which declares `status: 409` — so the
 * row is disclosed and this function returns before the `console.warn` above.
 * That was filed as a possibly LOST diagnostic: withholding used to be what
 * carried the driver's own sentence to an operator, and disclosure removes
 * that carrier.
 *
 * Measured on the real stack rather than reasoned about — a real `SqlDriver`
 * over better-sqlite3 through this very sink, in `@objectstack/runtime`'s
 * `batch-row-driver-text-real-driver.integration.test.ts` — the sentence is
 * NOT lost: the engine's own insert door logs the envelope's `cause`
 * (#14095 / commit 9d7f7259f, `e instanceof DuplicateRecordError ? e.cause : e`,
 * because the platform logger serializes only `message` and `stack`), so
 * `UNIQUE constraint failed: bd_note.email` is in the server log with the
 * failing column intact. The diagnostic moved one hop; it was not deleted.
 *
 * ⛔ So do NOT add a log line to the disclosed branch. It would restate what
 * the engine already logged, once per duplicate row of a batch, at a site
 * where the failure was handed to the CALLER — the third answer AGENTS.md's
 * degradation rule names, which is "not a degradation at all". The invariant
 * this function owes is one-directional and is pinned in BOTH directions by
 * that integration file: it logs when it WITHHOLDS, and is silent when it
 * does not.
 *
 * ## [#24561] A sandboxed body's refusal is read the way every sibling door reads it
 *
 * The undeclared hook above is an IN-PROCESS hook. A sandboxed (QuickJS) hook
 * body is a different producer: its runner puts the body's own sentence on
 * `SandboxError.innerMessage` for the caller and keeps the
 * `hook '<name>' threw: …` debug wrapper on `.message` for the log. `/data`,
 * `/createMany` and `/import` answer that sentence; this sink withheld it as a
 * fault, so `POST /data/:object/batch` alone said "the reason is in the server
 * log" for a refusal the hook wrote for the caller. The sentence is now read
 * through {@link sandboxRefusalSentence} FIRST, which is
 * `sandboxBusinessMessage` (`@objectstack/types`), the import runner's read.
 *
 * And a sandbox origin's `.message` is never quoted, whatever it declared.
 * It is the wrapper, written for the log: a refusal that declared a 4xx used
 * to be quoted from there, wrapper and all, and so did a body that CRASHED
 * with a declared 4xx, which every data door answers `500` with its text
 * withheld. (The runner's own faults never declare a status, so the 4xx
 * branch cannot reach them.) What stays withheld is what the doors withhold:
 * a crash, the runner's own fault, a refusal that declared a 5xx, and every
 * non-sandbox error that declared no 4xx.
 */
function clientFacingRowFailureText(err: unknown, fallback: string): string {
    const sentence = sandboxRefusalSentence(err);
    if (sentence !== undefined) return sentence;
    // 500 as the fallback status: an error that declared nothing is a server
    // fault in row form, exactly what `toRowApiError`'s own code limb assumes.
    const { status } = resolveThrownHttpError(err, 500);
    if (status >= 400 && status < 500 && !isSandboxOrigin(err)) {
        const declared = (err as { message?: unknown } | null | undefined)?.message;
        if (typeof declared === 'string' && declared.length > 0) return declared;
    }
    console.warn(
        '[Protocol] Withheld a caught error\'s text from a batch row: the producer declared no '
        + 'client-facing refusal (no 4xx status or statusCode, not the VALIDATION_FAILED shape, and not a '
        + 'sandboxed body\'s business refusal), so its '
        + 'sentence must not be quoted back on response data. The row says: '
        + `"${fallback}" — cause (withheld from the response):`,
        err,
    );
    return fallback;
}

/**
 * [#8441] The client-facing `code` for a failed row on a batch verb's
 * `failed[]` — the caught error's own code when the CATALOG declares it, and
 * otherwise a catalogued stand-in.
 *
 * ## The measurement
 *
 * The sibling of {@link clientFacingFailureText}, one field over, and it needs
 * a DIFFERENT rule. #8333 closed the `error` limb at these same two collectors
 * and left this one explicitly alone. Measured afterwards — on the fixed branch,
 * with the message withhold already in place — `publishPackageDrafts` still
 * answered `{ error: 'publish failed', code: 'SQLITE_ERROR' }`: the sentence
 * withheld and the driver's own dialect still shipping beside it, on response
 * DATA that no HTTP boundary's withhold can reach. `revertCommit` measured the
 * same, `{ error: 'revert failed', code: 'SQLITE_ERROR' }`.
 *
 * ## ⛔ NOT {@link declaresClientRefusal}'s question
 *
 * That predicate asks whether a producer AUTHORED this sentence for a caller,
 * because a message is free text and no catalog bounds it. This field is
 * `ApiErrorSchema.code`: a CLOSED union (ADR-0112 D4) whose membership test
 * this file already has — {@link carryCatalogedErrorCode}'s, itself verbatim
 * {@link toRowApiError}'s. So the question here is **"is this code in the
 * catalog?"**, and asking the 4xx question instead would be the wrong test on
 * the wrong field twice over: it would admit `SQLITE_ERROR` from any producer
 * that happened to declare a 4xx, and it would reject
 * `ERR_DATASOURCE_UNAVAILABLE` — a code the ledger registered.
 *
 * ## Why it SUBSTITUTES rather than drops the limb
 *
 * `code` is the half a client BRANCHES on. `BATCH_ABORTED` rides the same
 * array, and the Studio publish form highlights the offending field from
 * `INVALID_METADATA` plus the structured `issues` beside it. Deleting the limb
 * would trade a real authoring surface for a disclosure narrower than the one
 * #8333 already closed — a worse deal than doing nothing. So a catalogued code
 * passes through untouched, and only an uncatalogued one is replaced: by the
 * status-derived standard code when the error declared a status, otherwise
 * `INTERNAL_ERROR`. That derivation is {@link toRowApiError}'s, reused rather
 * than restated, so there is one rule and one place to change it. ⛔ No code is
 * minted here — ADR-0114's catalog already names every value this returns.
 *
 * ## What it deliberately does not touch
 *
 * An error carrying **no** code still produces **no** limb: `...(code ? …)` is
 * the shape both call sites had, and it is preserved. Minting a code where the
 * wire never carried one is an ADDITION to the response — a separate contract
 * decision, and the same posture {@link carryCatalogedErrorCode} takes toward
 * `status`. `issues` is unchanged for the same reason it was out of #8333's
 * scope: it is structured authoring feedback, and no driver error carries it.
 *
 * The other two `failed[]` collectors that build this limb —
 * `discardPackageDrafts` and `deletePackage` — need no filter and got none.
 * Measured under the same failing driver: their rows carry no `code` at all.
 * Both wrap exactly one call, {@link
 * ObjectStackProtocolImplementation.deleteMetaItem}, whose two re-wrap exits
 * ALREADY run {@link carryCatalogedErrorCode}, so an uncatalogued driver code
 * never survives to them. Adding a second filter there would be consumer-side
 * tolerance over a producer that does not need it (Prime Directive #12) —
 * the same call #8136 recorded at those sites for the message.
 */
export function clientFacingFailureCode(err: unknown): string | undefined {
    const code = (err as { code?: unknown } | null | undefined)?.code;
    if (!code) return undefined;
    if (typeof code === 'string' && ErrorCode.safeParse(code).success) return code;
    const status = (err as { status?: unknown } | null | undefined)?.status;
    return typeof status === 'number' ? standardErrorCodeForHttpStatus(status) : 'INTERNAL_ERROR';
}

/**
 * [#8333] The seed-request schema rejection, DECLARED — a 422 refusal with the
 * same envelope `saveMetaItem` raises for a failed overlay parse.
 *
 * ## Why this exists rather than a wider rule at the collector
 *
 * {@link ObjectStackProtocolImplementation.applySeedBodies} reports failure as
 * DATA (`seedApplied.error`), and #8136's rule quotes a caught sentence only
 * when the error DECLARED itself a client-facing refusal. Measured on
 * `origin/main`, that catch receives two populations:
 *
 *  1. **driver text** — a `sys_metadata` read failing underneath the loader's
 *     dependency-graph walk arrives verbatim, and `seedApplied` rides on a
 *     `200` publish response, so no HTTP boundary can withhold it;
 *  2. **the seed bodies' own schema rejection** — `SeedLoaderRequestSchema`
 *     used to `parse()`, so a malformed seed reached the same catch as a raw
 *     `ZodError`. That is AUTHORING feedback and it must survive — but it
 *     declared nothing, so the #8136 rule would have blanked it.
 *
 * ⛔ The wrong cure is loosening the rule at the collector: that turns a
 * positive list into a guess and re-admits population 1. The right one is the
 * direction #8136 set — **declare the refusal at its own producer**. So the
 * parse becomes a `safeParse` and its rejection is minted here as a real
 * ADR-0112 envelope (422 / `INVALID_METADATA` / structured `issues`), which
 * then satisfies {@link declaresClientRefusal} on its own merits and is quoted
 * back to the author unchanged by a collector that needed no special case.
 *
 * The author is also strictly better off: the old path stringified a whole
 * `ZodError`, so `seedApplied.error` was a multi-line JSON dump of raw zod
 * internals. The curated findings {@link zodIssuesToMetadataIssues} produces
 * for every other authoring surface ride this error's `issues` — surfaced on
 * `seedApplied.issues` by the catches (#10524) — and the message is their
 * one-sentence headline.
 *
 * [#8443] EXPORTED alongside {@link clientFacingFailureText}: the runtime
 * package-publish door parses the SAME `SeedLoaderRequestSchema` in its own
 * seed-apply fallback and hits the identical two-population catch, so it needs
 * the identical declaration — same sentence, same `INVALID_METADATA`/422, same
 * curated `issues`. Minting a second 422 over there would give one authoring
 * mistake two different envelopes depending on which protocol served the
 * publish.
 */
export function seedRequestValidationError(zodIssues: unknown): Error {
    const issues = zodIssuesToMetadataIssues(zodIssues);
    // [#10524] `message` is a HEADLINE — count plus `path [zod code]`
    // locators — never a restatement of the issue prose: the same `issues`
    // array rides the error structurally, and the catches that surface this
    // refusal thread it onto `seedApplied.issues` beside the headline, so
    // the author's curated per-key prose still arrives exactly once.
    const err = new Error(
        `The published seed bodies failed spec validation: `
        + metadataIssueHeadline(issues),
    );
    (err as any).code = 'INVALID_METADATA';
    (err as any).status = 422;
    (err as any).issues = issues;
    return err;
}

/**
 * [#10524] The one-sentence headline for a refusal whose per-path detail
 * rides `issues[]` structurally: total count plus up to three
 * `path [zod code]` locators. Restating the issue MESSAGES here is exactly
 * the duplication #10524 removed — every console rendering both channels
 * showed each finding twice — so the message names WHERE and HOW MANY and
 * leaves the prose to the structured channel. The leading count subsumes the
 * old `(+N more)` tail. The author-time gate composes its own analogue with
 * `[rule]` locators (`runtime-authoring-gate.ts`), deliberately: rule ids
 * and zod codes are different vocabularies and folding them into one helper
 * would blur which one a reader is looking at.
 */
function metadataIssueHeadline(issues: MetadataIssueEntry[]): string {
    const locators = issues.slice(0, 3)
        .map((i) => `${i.path || '<root>'}${i.code ? ` [${i.code}]` : ''}`)
        .join('; ');
    return `${issues.length} issue${issues.length === 1 ? '' : 's'} — ${locators}`;
}

/**
 * [commit d806081dd] The `422 INVALID_METADATA` findings clause, rendered PER FACE.
 *
 * The refusal is raised in one place ({@link
 * ObjectStackProtocolImplementation.saveMetaItem}'s overlay spec check) and
 * quoted onto whatever response the caller's catch builds, so one clause is
 * read on every face at once — and the faces do not agree on whether the
 * structured `issues[]` array reaches the consumer beside it. Where it does,
 * restating the prose here is the #10524 duplication exactly: every console
 * rendering both channels shows each finding twice. Where it does NOT, this
 * clause is the SOLE carrier and trimming it deletes the author's
 * prescription from the wire outright.
 *
 * ## The polarity is the load-bearing decision, not the wording
 *
 * Silence renders the FULL prose — byte-identical to what every face carried
 * before this card. Only a face that positively declares it carries the
 * structured channel gets the headline. That direction is deliberate and is
 * the opposite of a convenience default:
 *
 *  - the destructive direction (deleting prose) requires an explicit,
 *    reviewable declaration at a call site, so it can never happen by
 *    omission;
 *  - a new write door added later, or one whose author never read this
 *    comment, keeps the complete sentence. The failure mode of forgetting is
 *    a redundant sentence on a console, not an author who is told a body is
 *    invalid and never told which key.
 *
 * ⛔ Do not invert this to "trim by default, message-only faces opt out".
 * Measured on `origin/main` for THIS gate (see
 * `protocol.invalid-metadata-422-face-inventory.test.ts`): four of the seven
 * callers are message-only, and two of them live in OTHER packages
 * (`@objectstack/runtime`'s ADR-0045 visibility flip, `plugin-security`'s
 * permission-set projection) where no face can be stated without making the
 * field caller-settable. Under the inverted polarity those two lose their
 * prescription silently — and `plugin-security`'s remedy sentence
 * ("make the record body spec-valid (the error names the offending key)")
 * is written on the assumption that this clause names it.
 *
 * ⚠️ Unlike the 409's {@link destructiveChangeRemedy}, whose faces differ on
 * WHAT REMEDY EXISTS, the faces here differ only on WHETHER A SECOND CHANNEL
 * CARRIES THE SAME FACTS. Nothing is withheld from anyone: `err.issues` is
 * attached identically on every face, and the headline still names how many
 * findings there are and where they are.
 */
export function specValidationFindings(
    face: MetadataWriteFace | undefined,
    issues: MetadataIssueEntry[],
): string {
    switch (face) {
        case 'meta-envelope':
        case 'meta-dispatch':
            // The door answers with an ADR-0112 error envelope that carries
            // `issues[]` beside the message (`@objectstack/rest`'s
            // `sendError` threads a top-level `issues`; `@objectstack/runtime`'s
            // dispatcher threads `details.issues`). The prose lives there,
            // once. Same headline grammar the seed refusal and the author-time
            // gate compose — count plus `path [zod code]` locators.
            //
            // ⚠️ [#11095] TWO faces, one case, on purpose. The dispatcher split
            // off `'meta-envelope'` because the 409 needed a different REMEDY
            // there — nothing about the 422 moved, and this door's structured
            // channel (`details.issues`) is the very one the comment above
            // names. Letting `'meta-dispatch'` fall to the default instead would
            // have re-introduced the duplication commit d806081dd removed on one door only, with
            // every 409 test green: the polarity below is "declare to trim", so
            // a face that stops declaring loses the trim SILENTLY. Pinned in
            // `protocol.destructive-409-face-inventory.test.ts`'s [#11095]
            // section, which asserts the 422 clause did not move under it.
            return metadataIssueHeadline(issues);
        default:
            // Byte-identical to the clause before commit d806081dd: the first three findings
            // as `<path>: <message>`, then a `(+N more)` tail. Read by
            // `duplicatePackage`'s `failed[].error`, `migrateStoredMetadata`'s
            // `rows[].reason`, `importUnmanagedPackage`'s rolled-back refusal
            // (`'package-unmanaged-import'`, whose one door relays no
            // `issues[]` — see `MetadataWriteFace`), and the two
            // out-of-package log faces — none of which carry `issues[]` to
            // their caller.
            return issues.slice(0, 3)
                .map((i: { path: string; message: string }) => `${i.path || '<root>'}: ${i.message}`)
                .join('; ')
                + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '');
    }
}

/**
 * A batch row that names no record id for an operation that needs one — a
 * caller error, so it carries VALIDATION_FAILED / 400 rather than falling
 * through {@link toRowApiError}'s unclassified-throw default (#4793).
 */
export function rowRequiredIdError(operation: 'update' | 'delete'): Error {
    const err = new Error(`Record id is required for ${operation}`) as Error & { code?: string; status?: number };
    err.code = 'VALIDATION_FAILED';
    err.status = 400;
    return err;
}

/**
 * [#5532] The client-facing sentence for "the `sys_metadata` overlay read
 * failed, so I do not know whether this item exists".
 *
 * Deliberately does NOT interpolate the driver's own message. #5437 records
 * why: the REST boundary drops a 5xx's prose unconditionally, and the two
 * write-side 500s in this very file (`Failed to persist customization overlay
 * to sys_metadata: ${dbError.message}`) are the specimen that made it drop —
 * a driver line is nowhere near the length bound, so it arrived intact. The
 * driver error still reaches the operator: it rides as `cause` on the thrown
 * error, and `handleRouteError` / `logWithheldServerFault` print the whole
 * object.
 */
const METADATA_STORE_UNAVAILABLE_MESSAGE =
    'The metadata store could not be read, so whether this item exists is unknown. '
    + 'Retry once the metadata database is reachable.';

/**
 * [#5532] A `sys_metadata` READ that failed for a reason that is NOT "the table
 * has not been provisioned yet" — i.e. the rows may well exist and simply were
 * not seen.
 *
 * 503, not 500: nothing about the REQUEST is wrong, the condition is a
 * dependency outage that may clear, and a caller/proxy SHOULD retry. That is
 * the same verdict `mapDataError` already gives `ERR_DATASOURCE_UNAVAILABLE`.
 * `SERVICE_UNAVAILABLE` is the standard catalog's own code for 503
 * (`HttpStatusErrorCodeMap[503]`, ADR-0112) — a catalogued code rather than an
 * invented string, and no new ledger vocabulary for a distinction no consumer
 * measures today.
 */
export function metadataStoreUnavailableError(cause: unknown): Error {
    const err = new Error(METADATA_STORE_UNAVAILABLE_MESSAGE) as Error & {
        code?: string;
        status?: number;
        cause?: unknown;
    };
    err.code = 'SERVICE_UNAVAILABLE';
    err.status = 503;
    err.cause = cause;
    return err;
}

/**
 * [#12536] The producer-side CLASSIFICATION every `sys_metadata` read failure
 * now passes through — the one door, so that "is this a store fault or an
 * application refusal?" is answered once instead of per call site.
 *
 * ## The defect it closes
 *
 * A metadata app's sandboxed hook on `sys_metadata` may REFUSE a read and mark
 * its refusal with `userMessage` — the producer-side opt-in commit 79c46da90 added, where the
 * field's PRESENCE is the marking (maintainer ruling, 2026-08-19, objectui#5210
 * option 1). Every such refusal used to be handed straight to {@link
 * metadataStoreUnavailableError}, which builds a FRESH error carrying only
 * `code` / `status` / `cause`. `declaredUserMessage` reads the TOP level and
 * never `cause`, so the mark died at the producer: measured on `origin/main`,
 * a marked `beforeFind` refusal and a `connect ECONNREFUSED` came out of
 * `getMetaItems` as the same `503 SERVICE_UNAVAILABLE` with the same sentence
 * and `declaredUserMessage === undefined` on both. A hook author's localized
 * refusal could not reach an end user through this limb at all, and the
 * console substituted its #3821 generic string.
 *
 * ## The ruling this implements
 *
 * Maintainer, 2026-08-27 (verbatim: 「同意」), option B: a producer-marked
 * application refusal must NOT be wrapped as a store-unavailable error in the
 * first place. It travels its OWN refusal category with the author's text
 * intact; a genuine store fault keeps #8136's deliberately non-quoting 503,
 * untouched. Both prior rulings stand — they stop colliding here.
 *
 * ⛔ The declined shortcut, recorded so nobody re-implements it: forwarding the
 * mark ACROSS the 503 (a `cause` fall-through in `declaredUserMessage`, or a
 * `userMessage` copied onto the store-unavailable error). That would open a
 * quoting exception in the one door #8136 built to quote nothing, and the
 * typical failure of that shape is passing the whole cause chain through —
 * a silent leak. Nothing from `cause` crosses the 503 door: this function
 * either builds the refusal INSTEAD of the 503, or leaves the 503 exactly as
 * it was.
 */
export function metadataReadFailureError(cause: unknown): Error {
    // {@link declaredUserMessage} is THE read — "never with an inline `typeof`
    // probe" is that function's own instruction, and it is why a blank or
    // non-string `userMessage` is not a declaration here either.
    const marked = declaredUserMessage(cause);
    if (marked !== undefined) return markedApplicationRefusalError(cause, marked);
    return metadataStoreUnavailableError(cause);
}

/**
 * [#12536] The refusal category a producer-MARKED failure travels in, built so
 * the author's text survives verbatim and nothing else from the cause does.
 *
 * ## What is quoted, and what is not
 *
 * `message` is the marked text itself. That is the one string the producer
 * declared is addressed to the end user (commit 79c46da90), so quoting it discloses
 * nothing that was not authored for a caller — and it is the ONLY thing taken
 * from the cause. The cause's own `message` is a diagnostic and is NOT read:
 * it rides on `cause`, which `handleRouteError` / `logWithheldServerFault`
 * print whole for the operator, the same posture {@link
 * metadataStoreUnavailableError} takes.
 *
 * ## Status and code are RESOLVED, never re-spelled
 *
 * `resolveThrownHttpError` is imported for both, for the reason {@link
 * clientFacingRowFailureText} gives: a fourth local spelling of "what did this
 * throw declare?" is how two seams start disagreeing about one error. It folds
 * `status`, `statusCode` and the validation shape into one status, and gives
 * the code rule this file already applies elsewhere — a catalogued `.code`
 * passes through, anything else demotes to the status-derived standard code,
 * so `ApiErrorSchema`'s closed union (ADR-0112 D4) can never receive a
 * driver's dialect.
 *
 * The fallback status is 400, and it is NOT invented here: it is what the REST
 * sandbox door already answers for a hook refusal that named no status of its
 * own (`error-response.ts`, commit 8f266f1cd — `declared ?? 400`, pinned by
 * `hook-error-format.dogfood.test.ts`). A hook that DID name one keeps it
 * (#7867: "an error that NAMES its own HTTP status is asking to be served with
 * it"), which is also why this is status-agnostic in the way the `userMessage`
 * contract requires — a 400, 403, 409 or 503 refusal may all carry the mark.
 */
function markedApplicationRefusalError(cause: unknown, userMessage: string): Error {
    const { status, code } = resolveThrownHttpError(cause, MARKED_REFUSAL_UNDECLARED_STATUS);
    const err = new Error(userMessage) as Error & {
        code?: string;
        status?: number;
        userMessage?: string;
        cause?: unknown;
    };
    err.code = code;
    err.status = status;
    err.userMessage = userMessage;
    err.cause = cause;
    return err;
}

/**
 * [#12536] The status a marked refusal takes when its producer named none —
 * the REST sandbox door's own `declared ?? 400` (commit 8f266f1cd), reused rather than
 * chosen again, so the metadata read door and the hook door classify one
 * undeclared hook refusal identically.
 */
const MARKED_REFUSAL_UNDECLARED_STATUS = 400;

/**
 * [#12536] Carry a producer's `userMessage` mark onto an error this file is
 * re-wrapping — the exact sibling of {@link carryCatalogedErrorCode}, one
 * field over.
 *
 * A re-wrap that drops the mark destroys the channel commit 79c46da90 added just as completely
 * as building a fresh error does, and for the same reason: `declaredUserMessage`
 * reads the TOP level, never `cause`. Copying only the marked field quotes
 * nothing else — the cause's diagnostic `message` stays governed by whichever
 * withhold rule that exit already applies (#8136), unchanged.
 */
function carryDeclaredUserMessage(target: Error, source: unknown): void {
    const marked = declaredUserMessage(source);
    if (marked !== undefined) (target as Error & { userMessage?: string }).userMessage = marked;
}

/**
 * [#5532] The terminal "this metadata item does not exist" — structured, so it
 * stops falling out of `mapDataError`'s catch-all.
 *
 * A miss is a 404 with the catalog's own not-found code
 * (`HttpStatusErrorCodeMap[404] === 'RESOURCE_NOT_FOUND'`, and the spelling
 * `GET /meta/:type/:name` already emits from its app-visibility gate). Before
 * this, the throw was a bare `Error`: no `status`, no `code`, so it reached the
 * REST boundary's terminal branch and was answered — verbatim as a 400 before
 * #5489, as a sanitised `500 INTERNAL_ERROR` after it. Both are wrong answers
 * for a plain miss, in opposite directions; neither could be told apart from a
 * genuine fault by any client.
 */
function metadataItemNotFoundError(type: string, name: string): Error {
    const err = new Error(`Metadata item ${type}/${name} not found`) as Error & {
        code?: string;
        status?: number;
    };
    err.code = 'RESOURCE_NOT_FOUND';
    err.status = 404;
    return err;
}

/** What one pass of the `batchData` record loop produced (ADR-0119 D4). */
export type BatchDataLoopOutcome = { results: BatchDataRowResult[]; succeeded: number; failed: number };

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { carryCatalogedErrorCode, carryDeclaredUserMessage, metadataIssueHeadline, metadataItemNotFoundError, overlayDeleteFailureMessage };
