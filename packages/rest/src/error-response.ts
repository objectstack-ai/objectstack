// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How a thrown thing becomes an HTTP answer — ADR-0112's concern, at the REST
 * boundary.
 *
 * [commit 8664a2c99] Moved here from `rest-server.ts`, where this code sat at module level
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
 *
 * [#20919] The CLASSIFICATION half (`mapDataError` through
 * `classifyDataError`) moved, byte-identical, to `@objectstack/types`
 * (`data-error-classification.ts`), so the bulk-import runner it judges rows
 * for could move to `@objectstack/core` without a second copy. This file keeps
 * resolution, emission, the log verdict and response shaping, and re-exports
 * the classification names it always exported, so no importer changes.
 */

import {
    declaredRefusalMessage,
    INTERNAL_ERROR_MESSAGE,
    boundedDeclaredRefusalMessage,
    declaredHttpStatus,
    fiveXxArmDisplacesDeclared4xx,
    isSandboxCrash,
    isSandboxOrigin,
    mapDataError,
    sandboxBusinessMessage,
    structuredCodeAnswer,
    thrownCodeFields,
    truncateClientMessage,
    withDeclaredUserMessage,
    withoutDeclaredCodePrefix,
} from '@objectstack/types';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import type { ErrorCode } from '@objectstack/spec/api';
import { logError } from './log.js';

export {
    sandboxBusinessMessage,
    declaredHttpStatus,
    declaredServerFaultAnswer,
    mapDataError,
    boundedDeclaredUserMessage,
    boundedDeclaredRefusalMessage,
    isEngineDuplicateRecordEnvelope,
} from '@objectstack/types';

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
 * an unregistered code on the wire for as long as it did (commit 30b1c636a registered it;
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
    // [#17273] A sandboxed body that CRASHED is a fault before it is anything
    // else — the SAME terminal ordering commit cf6e0a193 gave {@link classifyDataError},
    // asked here so the ruling reaches the other door too.
    //
    // Commit cf6e0a193 converged the single `/data` door and named the residue rather
    // than rediscovering it: {@link isSandboxCrash} went ABOVE that function's
    // code-gated arms, so a crashed body reaches {@link UNCLASSIFIED_FAULT}
    // whatever it declared — while THIS door kept answering the declared
    // status with the QuickJS debug wrapper as its client-facing sentence,
    // because {@link sandboxBusinessMessage} declines a crash (#7543) and the
    // passthrough below therefore fell back to `error.message`. One crash, two
    // answers, decided by which route caught it — and the one this door gave
    // put the runner's `TypeError: …` text on the wire at a business status.
    //
    // The ruling that decides it is the one commit cf6e0a193 implemented, quoted on {@link isSandboxCrash}
    // and NOT restated here: *"A declared code is the author's statement about
    // the failure mode they **handled**. A crash … is not that mode, so it is
    // classified as a fault"*, against *"an internal stack-shaped sentence at a
    // business status is both a leak and a lie to the client about what
    // happened"*. What that card could not take was the STATUS this door's
    // passthrough decides — the #11588 fence — so it recorded the gap as an
    // ACCEPTED DIVERGENCE instead. This card is that follow-up, and the
    // divergence pin flips with it.
    //
    // Answered through {@link mapDataError} rather than by returning
    // {@link UNCLASSIFIED_FAULT} here, for the reason the consult commit 6d178a408 added below
    // gives: same terminal, same {@link withDeclaredUserMessage} wrapper,
    // nothing for a future edit to desynchronise. Both doors now read ONE
    // `isSandboxCrash` gate; ⛔ do not grow a second opinion about a crash in
    // this function.
    //
    // ⛔ Deliberately NOT band-scoped. The card names the declared-**4xx**
    // passthrough, and a band condition here would converge that shape while
    // leaving a crash declaring a **5xx** answering `503 DELETE_RESTRICTED`
    // where the single door already answers `500 INTERNAL_ERROR` — a NEW named
    // divergence minted by the repair for the divergence. The 5xx arm's
    // unconditional prose-drop (#5437 / #5582 / #5907) is not narrowed by this:
    // the terminal withholds prose too, and what moves for that shape is the
    // status and the declared `code`, both of which shrink to the sanitised
    // pair. Guard 1 of commit 6d178a408's consult is about a producer-declared 5xx that is NOT a
    // crash and is untouched — `error-response-structured-arm-door-parity.test.ts`
    // §4 pins both shapes, side by side.
    if (isSandboxCrash(error)) return mapDataError(error, object);
    // [commit 6d178a408] The bespoke structured arms are asked BEFORE this door's
    // declared-status passthrough, because that ordering is the whole defect
    // this card reports: an engine envelope declaring `status: 409` left
    // through the passthrough and never reached the arm that owns its wire
    // body, so `DELETE_RESTRICTED` lost `developerMessage` /
    // `dependentObject` / `dependentCount`, `ConcurrentUpdateError` lost
    // `currentVersion` / `currentRecord`, and `DuplicateRecordError` lost
    // `field` and kept the engine's `code` — on every route reporting through
    // {@link handleRouteError} / {@link sendThrownError}, while the
    // single-record `/data` routes calling `mapDataError` directly got the
    // curated envelope. One refusal, two bodies.
    //
    // This GENERALISES the exclusion the arm below already carried rather than
    // adding a second one — see {@link structuredCodeAnswer}, which holds the
    // #3770 ruling this applies and the measured per-code delta.
    //
    // Answered through `mapDataError` rather than by returning the arm's body
    // here, so the two doors are identical BY CONSTRUCTION — same arm, same
    // {@link withDeclaredUserMessage} wrapper, nothing for a future edit to
    // desynchronise. The second classification pass is on an error path and
    // the function is pure.
    //
    // Three guards, each one a boundary this card was fenced away from:
    //
    //  - a producer-declared **5xx** keeps the passthrough's 5xx arm. Its
    //    unconditional prose-drop (#5437 / #5582 / #5907, argued at length
    //    below) is load-bearing and is NOT narrowed here; this card is about
    //    ordering for 4xx codes that have a bespoke arm, nothing else.
    //  - an arm that answers a **5xx** (`ERR_DATASOURCE_UNAVAILABLE`'s 503)
    //    never displaces a declared 4xx either — the same band, fenced from
    //    the other side. Measured: its producer declares no `status` at all,
    //    so this guard changes nothing today and states the boundary anyway.
    //  - a **sandbox** REFUSAL keeps the unwrap answer it has today. The arms
    //    ship `error.message`, which for a sandboxed body is the QuickJS debug
    //    wrapper #11588 exists to keep off this wire; the passthrough below
    //    reads {@link sandboxBusinessMessage} instead and is the right door
    //    for it. [#17273] A sandboxed CRASH no longer reaches either — the
    //    terminal above this comment takes it, so "sandbox producer" here now
    //    means the refusal half only.
    const structured = isSandboxOrigin(error) ? undefined : structuredCodeAnswer(error, object);
    const declaresServerBand = typeof error?.status === 'number' && error.status >= 500 && error.status < 600;
    if (structured !== undefined
        && !fiveXxArmDisplacesDeclared4xx(error, structured)
        && structured.status < 500
        && !declaresServerBand) {
        return mapDataError(error, object);
    }
    // [#3770] `OBJECT_NOT_FOUND` is deliberately excluded from this
    // status-passthrough: `mapDataError` owns its canonical envelope
    // (`OBJECT_NOT_FOUND`), and short-circuiting here would ship a second wire
    // code for the same condition depending on which route caught it.
    //
    // [commit 6d178a408] The consult above now answers that for every DECLARED-code
    // producer, so this clause survives for exactly one residue: a SANDBOXED
    // body throwing `OBJECT_NOT_FOUND`, which the consult declines. Measured:
    // without the clause that error takes the 4xx arm below and loses
    // `object`. ⛔ Not a list to extend — a new bespoke code belongs in
    // {@link structuredCodeAnswer}, where both doors read it.
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
        // narrowing, and the flat arms now ask one question (five of them since
        // commit cad8b42f0 brought the sandbox unwrap door into the vocabulary).
        // [commit 79c46da90] Both passthrough arms ride a producer-declared `userMessage`
        // onto the body, the same rule as the exported `mapDataError` wrapper —
        // see {@link withDeclaredUserMessage}. On the 5xx arm the PROSE is
        // still withheld (#5437); the marked channel is authored user text, not
        // the message being withheld, so carrying it is not a re-opening.
        //
        // [#16146] …unless the producer DECLARED the 5xx to be a refusal. This
        // is the second of the three arms that withhold BECAUSE the status was
        // declared, and it reads the same {@link declaredRefusalMessage} the
        // first one does rather than re-deriving the condition — "one rule,
        // every door inherits" (#12509). The accepted cost recorded eight
        // paragraphs up — a self-authored 5xx sentence reaching the client as
        // the generic one — is now paid off for exactly the producers that
        // declare `refusal: true`, and unchanged for every producer that does
        // not. Note the two facts are independent: `userMessage` still rides
        // both branches, addressed to the END USER, while this releases the
        // DIAGNOSTIC `message` to the caller who asked.
        if (error.status >= 500) {
            const refusal = boundedDeclaredRefusalMessage(error);
            return withDeclaredUserMessage(error, {
                status: error.status,
                body: {
                    error: refusal ?? INTERNAL_ERROR_MESSAGE,
                    ...thrownCodeFields(error, error.status),
                },
            });
        }
        // [#5423] 4xx keeps the bound as a TRUNCATION, not a replacement: a 4xx
        // message is addressed TO the caller and is the remedy. Unchanged by
        // #5437 — see {@link truncateClientMessage}.
        //
        // [#11588] …and for a SANDBOX refusal the text addressed to the caller
        // is `.innerMessage`, not `.message` — see
        // {@link sandboxBusinessMessage}. Without this read, every route that
        // reports through `handleRouteError` (batch, createMany, updateMany,
        // deleteMany, clone, and the metadata/UI/import/export families that
        // share the exit) shipped the QuickJS DEBUG WRAPPER to the end user:
        // `hook 'guard' threw: Error: Opportunity is closed.` where the
        // single-row `PATCH` on the same object answered `Opportunity is
        // closed.` One hook, one refusal, two different sentences depending on
        // which route the caller happened to use.
        //
        // ⛔ This is NOT the reorder it looks like from the card. The unwrap
        // door lives in `mapDataError`, BELOW this arm, and moving it above is
        // ruled out by this arm's own argument two paragraphs up: `mapDataError`
        // derives a status from the message TEXT, so a declared 5xx handed to
        // it comes back re-labelled (`404 OBJECT_NOT_FOUND` for the
        // overlay-delete fault) and stops being logged. The passthrough stays
        // exactly where it is and keeps deciding the STATUS; only the sentence
        // it reads for the caller changes. Nothing about the 5xx arm above —
        // #5437/#5582's unconditional prose withhold — moves, and a sandbox
        // refusal declaring a 5xx still exits there with the prose dropped.
        //
        // What this restores is an invariant THIS DOCBLOCK already asserts. The
        // #7525 paragraph at the top of the arm says an error declaring
        // `statusCode` instead "falls to `mapDataError` below … So the two
        // doors already agree on the wire answer". For a sandbox refusal that
        // sentence was false: `statusCode` fell through and was unwrapped,
        // `status` was answered here from the wrapper, and one hook produced
        // two message shapes on one route depending on the spelling its author
        // picked. The two doors agree again now — pinned door-to-door rather
        // than asserted, in `rest-hook-refusal-message-parity.test.ts` §4.
        //
        // [#17273] CLOSED — the paragraph that stood here recorded, as
        // measured and NOT repaired, that a body which CRASHED while carrying
        // a declared 4xx `status` still answered with that status and the
        // wrapper. That gap is gone: the {@link isSandboxCrash} terminal at
        // the TOP of this function takes the crash before this arm is reached,
        // so `sandboxBusinessMessage`'s #7543 decline no longer decides what a
        // crash gets here — nothing does, because a crash never arrives. The
        // STATUS this arm decides is unmoved for everything that still reaches
        // it, which is every sandboxed REFUSAL.
        const businessMessage = sandboxBusinessMessage(error);
        // [#13095] The sentence this arm hands the caller is the HUMAN half
        // only — the same #12975 rule `classifyDataError`'s declared-4xx arm
        // applies, spread here by the 2026-08-31 maintainer ruling (option 1:
        // one envelope semantics on every `/data` exit). This arm is checked
        // BEFORE it delegates to `mapDataError`, so every route that reports
        // through `handleRouteError` / `sendThrownError` (batch, createMany,
        // updateMany, deleteMany, clone, and the record-share classified arm,
        // which re-dresses this very answer through `classifiedRefusalAnswer`)
        // was still shipping the ADR-0111 `CODE:` prefix the by-id door had
        // stopped shipping — one refusal, two readings, decided by which
        // route caught it.
        //
        // Anchored to the DECLARED code ({@link withoutDeclaredCodePrefix} —
        // ⛔ never a SCREAMING_SNAKE pattern; that function's docblock carries
        // the safety argument), and run BEFORE the bound for #12975's reason:
        // the prefix is not text addressed to the caller, so it must not
        // spend the caller's #5423 budget. A message that is nothing but the
        // prefix has no human half to ship and degrades to 'Request failed',
        // the sibling arm's rule travelling WITH the strip.
        //
        // ⛔ What deliberately does NOT converge here: a genuinely EMPTY
        // string message still ships as itself. This arm's degrade is keyed
        // on the TYPE, unlike `classifyDataError`'s sibling which also checks
        // length — a standing pin (`rest-hook-refusal-message-parity.test.ts`)
        // this card's ruling did not authorise moving. The 'Request failed'
        // limb below therefore fires only when the STRIP emptied a non-empty
        // message, never for a message that arrived empty.
        const addressed = businessMessage !== undefined
            ? businessMessage
            : typeof error.message === 'string' ? error.message : undefined;
        const authored = addressed === undefined
            ? undefined
            : withoutDeclaredCodePrefix(addressed, error);
        const safeMsg = authored === undefined
            ? 'Request failed'
            : authored.length === 0 && addressed !== undefined && addressed.length > 0
                ? 'Request failed'
                : truncateClientMessage(authored);
        // [#9232] Narrowed, same as the three arms above.
        //
        // [commit f5cc78b63] …and the body names the OBJECT the door was called with,
        // the limb {@link classifyDataError}'s generic declared-status
        // passthrough has always ended on. Without it the two copies of one
        // passthrough differed by exactly one key, which is the residue
        // commit 6d178a408 left behind: after that commit the doors agree for every code
        // a BESPOKE arm classifies, and disagree for every code that reaches
        // the GENERIC passthrough. Measured on `main` @ `a12b15e394`, one
        // error object, both doors:
        //
        //     { code: 'DUPLICATE_RECORD', status: 409 }   // no `name`, no arm
        //       mapDataError(err, 'duly_note')
        //         409 {"error":"…","code":"DUPLICATE_RECORD","object":"duly_note"}
        //       sendThrownError(res, err, 'duly_note')
        //         409 {"error":"…","code":"DUPLICATE_RECORD"}
        //
        // One refusal, two bodies, decided by which route caught it — the
        // shape commit 6d178a408 fixed, one arm over. It also closes that commit's second
        // residue: `recordNotFoundError` (`@objectstack/core`) declares
        // `code`, `status = 404` AND `object`, so its declared status carries
        // it past the `RECORD_NOT_FOUND` arm below into THIS passthrough on
        // every route reporting through {@link handleRouteError} /
        // {@link sendThrownError}, while the single-record `/data` door
        // reached the same generic arm in `classifyDataError` and shipped the
        // name.
        //
        // ⛔ The 5xx arm above deliberately does NOT gain this limb. Its
        // sibling there is {@link declaredServerFaultAnswer}, which names no
        // object either, so the two doors already agree in that band — adding
        // it would CREATE the disagreement this limb removes, and would put a
        // caller-supplied name into a body whose whole rule (#5437 / #5582) is
        // that a declared server fault says nothing beyond status and code.
        //
        // Appended LAST, so every key an existing body already carried keeps
        // the position it had: this widens the body by one optional key and
        // moves nothing. The name comes from the door's `object` ARGUMENT, not
        // from `error.object` — the same read every sibling arm makes, so a
        // route that passes nothing still answers exactly the bytes it answers
        // today (`classifiedRefusalAnswer` calls this door with no object at
        // all, and its families' key sets are unmoved).
        return withDeclaredUserMessage(error, {
            status: error.status,
            body: {
                error: safeMsg,
                ...thrownCodeFields(error, error.status),
                ...(Array.isArray(error.issues) ? { issues: error.issues } : {}),
                ...(object ? { object } : {}),
            },
        });
    }
    return mapDataError(error, object);
}

/**
 * [#11683 / #11684] The wire answer the `/data` door gives for a refusal the
 * PRODUCER classified — or `undefined` when it classified nothing and the
 * catching route's own fault terminal is the honest answer.
 *
 * ## Why this exists as an export rather than as a rule each route re-states
 *
 * Two route families build their error body by hand and share no branch with
 * either door in this file: `/analytics/dataset/query` and the three
 * record-share routes, both in `rest-server.ts`. Both re-derived
 * classification locally — analytics from an in-line `error.status` +
 * `error.code` read, the share family from `message.startsWith(CODE)` over
 * five literal prefixes — and both landed a *different* answer from `/data`
 * for one refusal. That is the door-disagreement shape #7525/#8016/#11588 keep
 * producing whenever a boundary open-codes a read this file already owns;
 * {@link sandboxBusinessMessage} was named for exactly that reason one card
 * earlier, and this is its status-side counterpart. A route that asks this
 * cannot drift, because there is nothing left at the route to drift.
 *
 * ## The two limbs, and why each is a limb
 *
 * A refusal is *classified* when the producer said which condition it is. This
 * repo has already ruled on two ways of saying so, and this function is their
 * union — not a third rule:
 *
 *  1. **A declared ADR-0112 envelope** — a `status`/`statusCode`
 *     ({@link declaredHttpStatus}, both spellings, #7525) in the 4xx band
 *     *and* a non-empty string `code`. **Both halves, deliberately**, which is
 *     #5352's standing ruling on the analytics arm this sits beside: a 4xx
 *     with no code would force a hand-built envelope to invent one, and a
 *     producer shipping half an envelope has a bug that should be found rather
 *     than papered over here. This function does not reopen that.
 *  2. **A sandboxed body's business `throw`** — {@link sandboxBusinessMessage}
 *     reads non-`undefined`, i.e. the QuickJS body REPORTED something rather
 *     than CRASHED (#7543). A missing `code` is *not* half an envelope here:
 *     the producer is a metadata-app author writing `throw new Error('…')`,
 *     and `classifyDataError`'s unwrap door has answered that with `400` plus
 *     the verbatim sentence since it existed — pinned end to end by
 *     `hook-error-format.dogfood.test.ts` and by
 *     `rest-hook-refusal-message-parity.test.ts` §3. Nothing is invented for
 *     the code that was not declared either: `thrownCodeFields` answers `{}`,
 *     which is ADR-0112's own rule.
 *
 * ## What it deliberately refuses to answer
 *
 * A **5xx**, declared or resolved. A server fault is not a refusal addressed
 * to the caller, so it belongs to the catching route's own terminal — which is
 * where the analytics `500 ANALYTICS_QUERY_FAILED` envelope and the share
 * family's `SHARE_*_FAILED` codes keep living, message-withholding
 * ({@link declaresServerFault}, #5811) and all. Both bands are checked: the
 * declared one before resolution, so a declared 5xx never reaches
 * {@link resolveErrorResponse}'s heuristics at all, and the resolved one
 * after, so an error that looked classified but resolves to
 * {@link UNCLASSIFIED_FAULT} or {@link DATA_STORE_FAULT} is handed back rather
 * than dressed up as a refusal.
 *
 * ## What it does NOT decide
 *
 * The DIALECT. It returns the classification — `{ status, body }`, the same
 * flat shape {@link handleRouteError} would send — and the caller re-dresses
 * it in whatever envelope that route publishes. The record-share family
 * answers the NESTED ADR-0112 D5 envelope (#8111) and must keep doing so; the
 * analytics face answers its own flat `{ code, message }`. Deciding the wire
 * POSITION here would have moved one of them, and vocabulary and position are
 * two separate decisions — ADR-0112's #9232 amendment says so in as many
 * words.
 */
export function classifiedRefusalAnswer(
    error: any,
): { status: number; body: Record<string, unknown> } | undefined {
    const declared = declaredHttpStatus(error);
    // A declared server fault is not a refusal, whatever else it carries.
    if (declared !== undefined && declared >= 500) return undefined;
    const declaresEnvelope =
        declared !== undefined
        && typeof error?.code === 'string'
        && error.code.length > 0;
    if (!declaresEnvelope && sandboxBusinessMessage(error) === undefined) return undefined;
    const resolved = resolveErrorResponse(error);
    return resolved.status < 500 ? resolved : undefined;
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
 *
 * [#16146] A producer-declared REFUSAL is not a fault, and the ruling
 * (decision batch #58, 2026-09-06) says the log follows the same field the
 * wire does: "a declared refusal is not logged as `[REST] Unhandled error`".
 * Before this, the `/references` 501 printed a stack on every unanswerable
 * target while the sibling refusal at the same door — hand-built into the
 * nested envelope — printed nothing, so one door's two refusals differed in
 * the log as well as on the wire. The read is the SAME
 * {@link declaredRefusalMessage} the three withhold arms make, ⛔ not a second
 * opinion about which statuses are "expected": a refusal that declared no
 * relayable prose (empty message, or prose the leak heuristic caught) is
 * withheld like a fault and is still logged like one.
 *
 * `logWithheldServerFault` below then no-ops by its own rule — the resolved
 * body carries the error's own message — so a relayed refusal costs no line at
 * all, and a TRUNCATED one still hands the operator the full text.
 */
export function logUnexpectedRouteError(error: any, resolved: { status: number; body: Record<string, unknown> }): void {
    if (!isExpectedRouteError(resolved.status, resolved.body) && declaredRefusalMessage(error) === undefined) {
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
 * [#18402] Would the classification door answer this caught value with a
 * BARE `404 RESOURCE_NOT_FOUND` — no code the producer chose, nothing else
 * riding along?
 *
 * ## Why a predicate rather than a second reading of the error
 *
 * A handler that owns ONE absence answer has to recognise the absences its
 * producers THROW, and the tempting spelling — `error?.status === 404 &&
 * error?.code === 'RESOURCE_NOT_FOUND'` — is a second opinion about what a
 * caught value means. It disagrees with this door on every shape the door
 * classifies rather than reads: a producer that declares a status and no code,
 * an unregistered spelling that {@link thrownCodeFields} demotes to
 * `declaredCode` while deriving `code` from the status, a structured arm that
 * owns its own envelope. Each disagreement is one arm of one route quietly
 * answering a different body again — the exact class the caller was fixing.
 *
 * So this ASKS the door. `resolveErrorResponse` is the function that would
 * have rendered the value one line later; reading its verdict means the
 * handler's fork and the fallback it forks away from can never drift apart.
 * The function is pure and this runs on an error path, so the second
 * classification pass costs nothing worth naming — the same argument
 * {@link resolveErrorResponse} already makes for its own `mapDataError`
 * re-entry.
 *
 * ## ⛔ Why it is NOT "the status is 404"
 *
 * MEASURED, and the measurement is the reason this function has three
 * conditions instead of one. `404` on a metadata route is not a synonym for
 * "you get nothing": `metadata-protocol` throws `{ code: 'NO_DRAFT', status:
 * 404 }` from the Studio designer's draft probe — pinned byte-for-byte in
 * `rest-expected-error-logging.test.ts` and `rest-4xx-message-truncation.test.ts`
 * — and that refusal says the ITEM is there and its DRAFT is not. Folding it
 * into an absence would tell a designer the object does not exist while it
 * plainly does: the #5532 flattening, one pair over, minted by the repair for
 * a sibling of it.
 *
 * So the question is asked about the ANSWER, not the status:
 *
 *  - `status` is 404, and
 *  - `code` is `RESOURCE_NOT_FOUND`, i.e. the producer named that member. ⚠️
 *    MEASURED: a producer that declares a 404 and NO code at all does not get
 *    one derived into its BODY — {@link thrownCodeFields} answers `{}`,
 *    ADR-0112's rule that nothing is invented for the half the producer did
 *    not name — so that answer is false here and keeps the shape it had.
 *    Folding it in would mean inventing the member the ADR declines to
 *    invent, and
 *  - no `declaredCode` sits beside it. Presence MEANS demotion (see
 *    `ApiErrorSchema`): the producer spelled a code the ledger does not know,
 *    and ADR-0112 keeps that spelling as the open, author-authored channel.
 *    Converting such an answer would delete the one field it exists to carry.
 *
 * ⚠️ This predicate does NOT decide what a route answers — it only recognises
 * an answer. The 503 an unreadable metadata store throws (#5532) resolves to
 * 503 and is false here, which is the distinction that must never be
 * flattened.
 */
export function thrownAnswerIsBareNotFound(error: any, object?: string): boolean {
    const resolved = resolveErrorResponse(error, object);
    return resolved.status === 404
        && resolved.body?.code === 'RESOURCE_NOT_FOUND'
        && resolved.body?.declaredCode === undefined;
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
