// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 4] The record-sharing routes of `RestServer` — the per-record
 * share family (`GET` / `POST {basePath}/data/:object/:id/shares` and
 * `DELETE …/shares/:shareId`) and the sharing-rule family (list, create, read,
 * delete and evaluate under `{basePath}/sharing/rules`) — moved out of
 * `rest-server.ts` whole.
 *
 * A MOVE, not a redesign. The two functions below are the bodies of
 * `RestServer#registerSharingEndpoints` and
 * `RestServer#registerSharingRuleEndpoints` as they stood, each re-indented one
 * level and otherwise unedited: the same routes, registered in the same order,
 * by the same handlers, answering the same bodies. Each body's local helpers —
 * the share family's `respondError`, `respondSharingError`,
 * `sharingDeclaredExtra` and `sharingFaultMessage`, the rule family's
 * `handleError` — moved with it, unchanged. The two registrars share ONE module
 * because they are one capability (the rule family's own docblock calls itself
 * a mirror of the share family); they still share no code, exactly as before.
 *
 * ## How the moved bodies reach the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps both private methods
 * — the published `dist/*.d.ts` lists their names, docblocks and positions —
 * and each body is one host literal ({@link SharingRouteHost},
 * {@link SharingRuleRouteHost}) plus `.call(host, basePath)`. A method is
 * handed over as a closure that calls it on the server at call time, so a test
 * double or spy set on the server is still the one the body reaches.
 *
 * Each field was checked on its own, not inherited from an earlier slice:
 *
 * - `config` and `routeManager` go BY VALUE. The share body reads `config`
 *   once, at its first line (`crud.dataPrefix`), and both bodies read
 *   `routeManager` only for their `register` calls, all of which run while
 *   registration runs. The class assigns `config` only in its constructor, and
 *   its one `routeManager` reassignment wraps `registerMetadataEndpointsInner`,
 *   never these registrars.
 * - `sharingServiceProvider` and `sharingRulesServiceProvider` go as GETTERS.
 *   Each body's `resolveService` reads its provider at REQUEST time, and neither
 *   field is `readonly`, so a value copied at registration could part from it.
 *   The getter reads the field the handler read, when it read it.
 *
 * Module-level helpers stay where they were and are imported from the modules
 * `rest-server.ts` imports them from; the bodies read nothing declared in
 * `rest-server.ts` itself, so no export was added anywhere and the published
 * surface does not move.
 */

import { INTERNAL_ERROR_MESSAGE, sendError as sendEnvelopeError } from '@objectstack/types';
// [#8073] The closed ADR-0112 error vocabulary: the share family's single
// refusal emitter types its `code` parameter as the vocabulary.
import type { ErrorCode } from '@objectstack/spec/api';
// [#11683] The catalog's own floor for "a required `code` and no more specific
// one" — see `respondSharingError` below, where the nested ADR-0112 envelope
// declares `code` REQUIRED while the flat classification it re-dresses
// legitimately carries none.
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import {
    boundedDeclaredUserMessage,
    classifiedRefusalAnswer,
    nestedRefusalEnvelope,
    sandboxFaultAnswer,
} from './error-response.js';
import { logError } from './log.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import type { RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerSharingEndpoints} reads — every one
 * of them, and no other. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for why `sharingServiceProvider` is a getter.
 */
export interface SharingRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    readonly sharingServiceProvider: RestServer['sharingServiceProvider'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/**
 * The `RestServer` members {@link registerSharingRuleEndpoints} reads — every
 * one of them, and no other, typed as {@link SharingRouteHost}'s are. See the
 * module header for why `sharingRulesServiceProvider` is a getter.
 */
export interface SharingRuleRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly sharingRulesServiceProvider: RestServer['sharingRulesServiceProvider'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/**
 * Register record-level sharing endpoints — `RestServer#registerSharingEndpoints`'
 * body, called by that method with the server as `this`. The method's own
 * docblock, which the published declaration carries, names the routes.
 */
export function registerSharingEndpoints(this: SharingRouteHost, basePath: string): void {
    const { crud } = this.config;
    const dataPath = `${basePath}${crud.dataPrefix}`;
    const isScoped = basePath.includes('/environments/:environmentId');

    const resolveService = async (environmentId?: string) => {
        if (!this.sharingServiceProvider) return undefined;
        try { return await this.sharingServiceProvider(environmentId); }
        catch { return undefined; }
    };
    /**
     * [#8111] The ONE refusal emitter for the record-sharing family — the
     * 501, all five mapped verdicts and all three 500s go through it, so
     * "list, grant and revoke answer the same shape" is a property of the
     * code rather than of nine literals that happen to agree.
     *
     * Before this, the family carried BOTH dialects ADR-0112 D5 retires:
     * `respond501` was flat `{ code, message }` and every other arm was
     * `{ code, error: '<bare string>' }`, so `body.error.code` — the one
     * position D5 declares — read `undefined` on all nine. #7035
     * (PR #7293) had already removed both from this file's `/meta`
     * refusals, #7981 (PR #8071) from `registerSecurityEndpoints` and
     * #8073 (PR #8174) from the `/security/explain` pair.
     *
     * Emitted through the SHARED builder (`sendError` from
     * `@objectstack/types`, imported as `sendEnvelopeError` — see the note
     * at the import). That is what makes this the reference shape by
     * construction rather than a tenth local literal agreeing with the nine
     * it replaced, and it types `code` to the closed ADR-0112 vocabulary
     * for free.
     *
     * ⛔ Status codes are untouched and no code VALUE moves: only the
     * POSITION of `code` and `message` changes.
     */
    const respondError = (
        res: any,
        status: number,
        code: ErrorCode,
        message: string,
        // [#12510] The shared writer's OWN `extra` type, referenced rather
        // than restated: this wrapper decides POSITION (the nested D5
        // envelope), never which channels exist. A local `{ declaredCode?:
        // string }` would be a second, narrower declaration of a set
        // `sendError` already owns — the shape that silently stops
        // forwarding the next channel admitted there.
        extra?: Parameters<typeof sendEnvelopeError>[4],
    ): void => sendEnvelopeError(res, status, code, message, extra);

    const respond501 = (res: any) => respondError(
        res, 501, 'NOT_IMPLEMENTED',
        'Sharing service is not configured on this deployment',
    );
    /**
     * [#12693] The `extra` this family's TWO NON-CLASSIFIED exits owe a
     * producer that marked its refusal: the 500 fault terminal below, and
     * the ADR-0111 prefix arm inside {@link respondSharingError}.
     *
     * Neither reaches {@link classifiedRefusalAnswer} — the 500 terminal
     * because a declared server fault is deliberately not a refusal
     * (that function's own docblock rules it back to "the catching route's
     * own terminal", which is these three arms), the prefix arm because it
     * runs precisely when the classification answered `undefined`. So
     * neither holds a `refusal.body` to re-dress, and the one line the
     * classified arm uses (`refusal.body.userMessage`, #12669) is NOT
     * reusable here. What is reusable is the RULE, and
     * {@link boundedDeclaredUserMessage} is that rule asked of the raw
     * thrown error instead of the classification: `declaredUserMessage`'s
     * presence answer with #5423's bound applied, one definition, shared
     * with the `/data` door rather than copied beside it.
     *
     * Measured on `15bf9e859` before the repair, one producer per exit
     * through the real routes on both doors:
     *
     * ```text
     * throw { code: 'SHARE_STORE_DOWN', status: 503, userMessage: '…' }
     *   share door : 500 SHARES_LIST_FAILED        — no mark
     *   /data door : 503 SERVICE_UNAVAILABLE       — mark carried
     * throw Error('NOT_FOUND: no such record …') + userMessage
     *   share door : 404 NOT_FOUND                 — no mark
     *   /data door : 500 INTERNAL_ERROR            — mark carried
     * ```
     *
     * ⛔ The mark is the ONLY thing this adds, and the two doors' other
     * disagreements visible in that measurement stay exactly as they are:
     * the share family folds a declared 503 into its own 500 terminal, and
     * it interpolates the caught message where `/data` withholds 5xx prose
     * unconditionally (#5437). Both are deliberate and argued in
     * {@link sharingFaultMessage} and the #11683 docblock below; the
     * `/data` door's status for the prefix arm differs for a third
     * deliberate reason — the prefix idiom is this service's local
     * convention and no shared classifier can read it (ADR-0111).
     *
     * ⛔ Riding the mark across a FAULT terminal is not a re-opening of
     * #5437 either, and the reason is `withDeclaredUserMessage`'s, not a
     * second one: the withheld text is prose the producer never addressed
     * to the caller, while this field exists only because an author wrote
     * caller-facing text onto it. A genuine crash carries no mark and its
     * envelope is byte-identical to before.
     */
    const sharingDeclaredExtra = (
        error: any,
    ): { userMessage: string } | undefined => {
        const userMessage = boundedDeclaredUserMessage(error);
        return userMessage === undefined ? undefined : { userMessage };
    };
    // [ADR-0111] The service enforces authorization (D1/D4/D5/D7) and
    // signals the verdict via message prefixes, the plugin's established
    // error idiom — this maps them onto HTTP. Returns true when handled.
    //
    // [#8111] The prefix is a SERVER-INTERNAL service→REST derivation.
    // ⚠️ [#13095] This comment used to claim the MECHANISM guaranteed
    // that: "it is stripped below and never reaches the wire". That was
    // true of the prefix-idiom arm it was written about and FALSE for the
    // classified limb #11683 added beside it, which re-dresses
    // `resolveErrorResponse`'s answer — an answer that shipped the prefix
    // inside the sentence until the 2026-08-31 ruling converged that arm
    // onto the same declared-code-anchored strip. Even now the strip is
    // ANCHORED (it removes only a prefix restating the declared code), so
    // "never reaches the wire" is not a mechanism anyone may lean on.
    // What holds instead is MEASURED, not guaranteed: no consumer
    // branches on the prefix in the wire `error` text — censused at
    // #8111's claim and re-censused 2026-09-01 (objectstack + objectui:
    // zero wire readers; every `startsWith(CODE)` hit is this file's own
    // route mappings or an in-process producer-side check; `cloud` was
    // not reachable and is NOT measured). The prefix idiom itself stays
    // exactly as it is; #8111 moved only the response SHAPE.
    //
    // [#11683] …and it stays exactly as it is here too. What moved is that
    // the prefix read is no longer the FIRST question, and no longer the
    // only one. It is the ADR-0111 idiom for producers that declare
    // nothing else, and the census that made it safe to keep is still
    // true: every throw site in `plugin-sharing/src/sharing-service.ts`
    // (11 of them, re-censused at claim) is a bare `Error` carrying one of
    // these prefixes and NO `code`, NO `status`. Backward compatibility is
    // therefore not a courtesy — it is the only channel this service has.
    //
    // What it could never read is a refusal that DID declare itself, and
    // two of those reach these three catches today:
    //
    //   - `plugin-sharing`'s own write gate throws
    //     `{ code: 'FORBIDDEN', status: 403 }` (`sharing-plugin.ts`).
    //     `FORBIDDEN` is not one of the five, so a refusal that declared
    //     403 twice over was answered `500 SHARE_*_FAILED`.
    //   - A sandboxed hook on the `sys_record_share` write arrives with
    //     the QuickJS debug wrapper on `.message` and the business text on
    //     `.innerMessage`. The wrapper IS the prefix, so nothing matched
    //     and the wrapper was interpolated verbatim into the 500 — #11588's
    //     leak on a branch #11588 did not reach.
    //
    // Both are asked FIRST now, through {@link classifiedRefusalAnswer} —
    // the `/data` door's own classification, so this family cannot answer
    // a refusal differently from every other face that catches it. A
    // declaration outranking a message read is the whole point: this
    // route's defect was that classification was a property of how the
    // sentence happened to start.
    //
    // ⛔ The DIALECT does not move. #8111 converted these arms onto the
    // nested ADR-0112 D5 envelope and the `check:route-envelope` ratchet
    // only ticks down, so the classification is re-dressed through
    // `respondError` rather than sent by `handleRouteError` (which speaks
    // the flat dialect). Vocabulary and position stay two decisions.
    const respondSharingError = (res: any, error: any): boolean => {
        // A refusal the producer classified — answered exactly as `/data`
        // answers it. `undefined` for everything else, which falls to the
        // prefix idiom below and then to the caller's own 500 arm, both
        // unchanged.
        const refusal = classifiedRefusalAnswer(error);
        if (refusal) {
            // `code` is REQUIRED by the nested envelope, and the flat
            // classification legitimately carries none for an undeclared
            // sandbox refusal (ADR-0112 D4 governs the semantic-CODE
            // channel: the producer names the condition on the CODE axis,
            // so nothing is invented for the half it did not name; the ADR
            // rules no HTTP status here, and the phrase is
            // `error-response.ts`'s own prose rather than an ADR
            // quotation). The
            // catalog's own floor fills the required field —
            // `standardErrorCodeForHttpStatus`, whose docblock exists for
            // exactly this ("Total by construction: a producer can always
            // fill a required `code`") and which is the same derivation
            // `resolveThrownHttpError` applies at every other door. This
            // is the one place the two dialects genuinely differ: the flat
            // body may omit `code`, the nested one may not.
            //
            // [#12510] …and the producer's OWN spelling travels with it.
            // An UNREGISTERED thrown code is demoted by the shared rule to
            // a `declaredCode` sibling (ADR-0112 #9232) — the open,
            // author-authored channel `ApiErrorSchema` has declared since
            // #9106. This family used to drop it: the classification below
            // was already holding the demoted string and only `code` and
            // the message were re-dressed, so an app's spelling vanished
            // here while the flat `/data` door carried it. Nothing invalid
            // shipped — the closed `code` still carried the member the
            // status derives — which is exactly what made the loss silent
            // and one-directional: a consumer told by ADR-0112 to read
            // `declaredCode` found nothing at this door.
            //
            // ⛔ The reason that used to stand here said `sendError`'s
            // `extra` would not accept the field. That was true when it was
            // written and false since #11719 / `db8c288` (PR #12403) added
            // `declaredCode` to the writer's `Pick`. A stale sentence that
            // discourages a repair costs more than one that misdescribes a
            // mechanism, so it is recorded rather than merely deleted.
            //
            // ⛔ Read the CLASSIFICATION's field, never the resolver's raw
            // `thrown.declaredCode`. Presence MEANS demotion
            // (`ApiErrorSchema.declaredCode`'s documented invariant) and
            // the raw field is set for a REGISTERED spelling too —
            // measured: a producer throwing `{ code: 'RECORD_LOCKED',
            // status: 409 }` resolves with `declaredCode: 'RECORD_LOCKED'`
            // sitting beside an identical `code`, and forwarding that would
            // put two spellings of one fact on every registered refusal.
            // `refusal.body.declaredCode` is the answer AFTER
            // `demotedDeclaredCode` (`error-response.ts`'s
            // `thrownCodeFields`, the same one definition the dispatcher
            // door reads), so the invariant arrives with the value.
            //
            // ⭐ Why re-dress rather than re-resolve: this door asks
            // {@link classifiedRefusalAnswer} ONCE and re-dresses that one
            // answer, exactly as it does for `status`, `code` and the
            // message. Calling the resolver a second time here would be a
            // second answer to a question already asked — the shape that
            // let two `/api/v1/packages` doors drift apart (#12405). The
            // pair is carried, not recomputed: `code` and `declaredCode`
            // leave this door as the pair `thrownCodeFields` produced.
            const code = typeof refusal.body.code === 'string'
                ? refusal.body.code as ErrorCode
                : standardErrorCodeForHttpStatus(refusal.status);
            const declaredCode = typeof refusal.body.declaredCode === 'string'
                ? refusal.body.declaredCode
                : undefined;
            // [#12669] …and so does the sentence the producer addressed to
            // the CALLER. The flat `/data` door attaches it in
            // `withDeclaredUserMessage` (`error-response.ts`, commit 79c46da90) and
            // the one classification asked above is already holding the
            // result; this family dropped it at the same re-dress, with the
            // same one-directional silence — an author's own remedy text
            // reaching `/data` and vanishing here.
            //
            // ⛔ `userMessage` and `declaredCode` are NOT symmetric, and
            // the next reader will assume they are because they arrive on
            // the same line. `declaredCode` is read from the CLASSIFICATION
            // because presence there MEANS demotion — an invariant the raw
            // thrown field does not carry, which is the whole subject of
            // the paragraphs above (⛔ not restated here: #12510 owns that
            // derivation and one reason with two copies is this lane's own
            // recurring defect). `userMessage` has NO invariant left for a
            // caller to re-derive. `declaredUserMessage` already decided
            // PRESENCE — the field exists on an error only because its
            // producer deliberately wrote end-user text with no host state
            // onto it (an application hook, or a platform refusal carrying
            // static guidance such as the packaged-permission-set lock's;
            // platform and driver diagnostics never set it) — and
            // `truncateClientMessage` already applied #5423's bound to the
            // value. Reading `refusal.body.userMessage` IS the rule; there
            // is no second function to run it through, and running one
            // would be a second answer to a question the classification
            // has already answered.
            //
            // The `typeof` guard below is therefore not that invariant. It
            // is the same non-string floor `code` and `declaredCode` carry
            // two lines up: a producer may put anything on a thrown object,
            // and a number arriving in a string channel is the #3842 drift.
            //
            // ⛔ SCOPE: `userMessage` only. The producer's structured
            // context — the flat body's top-level `issues` — is the other
            // half of #12669 and is deliberately NOT forwarded here. The
            // nested envelope's channel for it is `ApiError.details`, so
            // mapping one onto the other is a SHAPE decision on a contract
            // field rather than a rename, and #12669 is open on it.
            const userMessage = typeof refusal.body.userMessage === 'string'
                ? refusal.body.userMessage
                : undefined;
            respondError(
                res, refusal.status, code, String(refusal.body.error ?? ''),
                {
                    ...(declaredCode !== undefined ? { declaredCode } : {}),
                    ...(userMessage !== undefined ? { userMessage } : {}),
                },
            );
            return true;
        }
        const msg = String(error?.message ?? error ?? '');
        const map: Array<[ErrorCode, number]> = [
            ['VALIDATION_FAILED', 400],
            ['PERMISSION_DENIED', 403],
            ['NOT_FOUND', 404],
            ['CONFLICT', 409],
            ['SHARING_NOT_ENABLED', 422],
        ];
        for (const [code, status] of map) {
            if (msg.startsWith(code)) {
                // [#12693] …and the producer's own sentence to the caller
                // rides this arm too. ⛔ Only the sentence: the PREFIX
                // read, the status it decides and the stripping below are
                // untouched — see {@link sharingDeclaredExtra}.
                respondError(
                    res, status, code,
                    msg.replace(new RegExp(`^${code}:\\s*`), ''),
                    sharingDeclaredExtra(error),
                );
                return true;
            }
        }
        return false;
    };
    /**
     * [#11683] The text the three 500 arms may put on the wire.
     *
     * The arms interpolate the caught error's own message, and that is
     * unchanged for every ordinary fault — `sharing-envelope.test.ts` pins
     * a plain `Error('boom')` arriving as `boom` and it still does.
     *
     * The one shape it withholds is a SANDBOX error that reached a 500 at
     * all, which after the classification above means one thing: a hook
     * body that CRASHED rather than refused (`isScriptFaultMessage`,
     * #7543). Its `.message` is the QuickJS debug wrapper and its
     * `.innerMessage` is a `TypeError: …` — the wrapper the card measured
     * leaking, wrapped around a runtime fault the caller must not read
     * either. `/data` answers that case `INTERNAL_ERROR_MESSAGE` through
     * {@link UNCLASSIFIED_FAULT}; this says the same sentence, so the leak
     * is closed on this family unconditionally rather than only for the
     * refusals the classification door catches.
     *
     * The full wrapper still reaches the operator: every caller logs the
     * whole error object immediately above its `respondError`.
     *
     * [#22885] …and the sandbox read is the doors' own now. The runner's
     * OWN fault (a denied capability, a missing `ctx.api` method, a
     * budget) carries no `innerMessage`, so the read above let it through
     * and these arms relayed the runner's diagnostic text. The sentence is
     * {@link sandboxFaultAnswer}'s, the answer the other hand-built
     * families give every sandbox fault, so a crash, a declared 5xx and an
     * own fault read one withheld sentence here as there. ⛔ Only the
     * SENTENCE: this family's own `500` and `SHARE_*_FAILED` code stay the
     * recorded exception the write-route ledger names (#22764's
     * `OWN_FAULT_TERMINAL`), a decision this does not take. The
     * `innerMessage` read stays for any sandbox origin that answer declines.
     */
    const sharingFaultMessage = (error: any): string => {
        const fault = sandboxFaultAnswer(error);
        if (fault !== undefined) return nestedRefusalEnvelope(fault).message;
        return typeof error?.innerMessage === 'string' && error.innerMessage
            ? INTERNAL_ERROR_MESSAGE
            : String(error?.message ?? error).slice(0, 500);
    };

    // GET — list shares on a record. [ADR-0111 D5] Management-gated in the
    // service: invisible record → 404, visible-but-not-manager → 403.
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/:object/:id/shares`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const rows = await svc.listShares(req.params.object, req.params.id, context ?? {});
                res.json({ data: rows });
            } catch (error: any) {
                if (respondSharingError(res, error)) return;
                logError('[REST] List shares error:', error);
                // The 500 arms keep their 500-char cap: an unexpected
                // fault's message is not a contract, and truncating it
                // stays a sanitization step — only the position moves.
                respondError(
                    res, 500, 'SHARES_LIST_FAILED', sharingFaultMessage(error),
                    sharingDeclaredExtra(error),
                );
            }
        },
        metadata: { summary: 'List per-record sharing grants', tags: ['sharing'] },
    });

    // POST — grant access. [ADR-0111 D1/D7] Authorization + posture live
    // in the service; this route only maps verdicts (403/404/422/400).
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/:object/:id/shares`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const body = req.body ?? {};
                const input = {
                    object: req.params.object,
                    recordId: req.params.id,
                    recipientType: body.recipientType ?? body.recipient_type,
                    recipientId: body.recipientId ?? body.recipient_id,
                    accessLevel: body.accessLevel ?? body.access_level,
                    source: body.source,
                    sourceId: body.sourceId ?? body.source_id,
                    reason: body.reason,
                };
                const row = await svc.grant(input, context ?? {});
                res.status(201).json(row);
            } catch (error: any) {
                if (respondSharingError(res, error)) return;
                logError('[REST] Grant share error:', error);
                respondError(
                    res, 500, 'SHARE_GRANT_FAILED', sharingFaultMessage(error),
                    sharingDeclaredExtra(error),
                );
            }
        },
        metadata: { summary: 'Grant a per-record share to a principal', tags: ['sharing'] },
    });

    // DELETE — revoke a share by id. [ADR-0111 D4] The URL's
    // (object, id) is forwarded as the revoke scope so a share id can only
    // be revoked through the record it belongs to; the service enforces
    // management authority and the manual-source rule (409).
    this.routeManager.register({
        method: 'DELETE',
        path: `${dataPath}/:object/:id/shares/:shareId`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                await svc.revoke(
                    req.params.shareId,
                    context ?? {},
                    { object: req.params.object, recordId: req.params.id },
                );
                res.status(204).end();
            } catch (error: any) {
                if (respondSharingError(res, error)) return;
                logError('[REST] Revoke share error:', error);
                respondError(
                    res, 500, 'SHARE_REVOKE_FAILED', sharingFaultMessage(error),
                    sharingDeclaredExtra(error),
                );
            }
        },
        metadata: { summary: 'Revoke a per-record share by id', tags: ['sharing'] },
    });
}

/**
 * Register sharing-rule endpoints — `RestServer#registerSharingRuleEndpoints`'
 * body, called by that method with the server as `this`. The method's own
 * docblock, which the published declaration carries, names the routes.
 */
export function registerSharingRuleEndpoints(this: SharingRuleRouteHost, basePath: string): void {
    // Sharing-rule routes live at the top of the API surface (e.g.
    // `/api/v1/sharing/rules`) — they administer rules across the whole
    // tenant rather than acting on a single CRUD object, so anchoring
    // them on `basePath` keeps them out of the `/data/:object` namespace
    // where greedy CRUD matchers would otherwise swallow them.
    const dataPath = basePath;
    const isScoped = basePath.includes('/environments/:environmentId');

    const resolveService = async (environmentId?: string) => {
        if (!this.sharingRulesServiceProvider) return undefined;
        try { return await this.sharingRulesServiceProvider(environmentId); }
        catch { return undefined; }
    };
    const respond501 = (res: any) => res.status(501).json({
        code: 'NOT_IMPLEMENTED',
        message: 'Sharing-rule service is not configured on this deployment',
    });
    const handleError = (err: any, res: any, defaultCode: string) => {
        const msg = String(err?.message ?? err ?? '');
        if (msg.startsWith('VALIDATION_FAILED')) {
            return res.status(400).json({ code: 'VALIDATION_FAILED', error: msg.replace(/^VALIDATION_FAILED:\s*/, '') });
        }
        // [ADR-0111 D6] The service gates every verb on `manage_sharing`
        // (enforced there so non-REST callers are covered too) — map its
        // verdict rather than burying it in a 500.
        if (msg.startsWith('PERMISSION_DENIED')) {
            return res.status(403).json({ code: 'PERMISSION_DENIED', error: msg.replace(/^PERMISSION_DENIED:\s*/, '') });
        }
        if (msg.startsWith('RULE_NOT_FOUND')) {
            return res.status(404).json({ code: 'RULE_NOT_FOUND', error: msg.replace(/^RULE_NOT_FOUND:?\s*/, '') });
        }
        // [ADR-0111 D7 / #8207] `POST .../evaluate` reconciles through
        // `SharingService.grant`, whose inertness guard now runs for the
        // evaluator's system context too. A rule pointed at an object no
        // sharing gate consults therefore refuses here instead of silently
        // materialising rows nothing reads — and the admin who asked for
        // the evaluation needs to be told WHICH object and WHY, not handed
        // an opaque 500. Same code→status pair the per-record shares routes
        // already publish (`respondSharingError`), so no new contract.
        //
        // ⚠️ Built through the SHARED `sendError` envelope, unlike the three
        // arms above it. Those are the flat dialect — `code` beside `error`
        // instead of inside it, so `body.error.code` reads `undefined` —
        // held down by the `check:route-envelope` ratchet, which only ticks
        // DOWN. A new arm copying its neighbours' shape is exactly what that
        // ratchet exists to stop, so this one answers the envelope
        // `BaseResponseSchema` declares. The asymmetry is the ratchet
        // working; converting the other three is outstanding envelope-
        // position work owned by that ratchet, not a rider on this card.
        //
        // ⚠️ Two card citations stood here and both were stale by the time
        // anyone read them: #7035 closed 2026-08-10 (PR #7293, three `/meta`
        // 501 handlers), and #8111 closed 2026-08-12 (PR #8212) having
        // converged the record-sharing family it named. The ratchet's own
        // baseline is the live owner of what is left; a closed card number
        // is not.
        if (msg.startsWith('SHARING_NOT_ENABLED')) {
            return sendEnvelopeError(
                res, 422, 'SHARING_NOT_ENABLED',
                msg.replace(/^SHARING_NOT_ENABLED:\s*/, ''),
            );
        }
        // [#22719] A refusal none of the prefix arms above can read is asked
        // of the `/data` door's own classification before the 500 below
        // relays `.message`. For a sandboxed hook's refusal `.message` is
        // the QuickJS debug wrapper, so `POST /rules`, `DELETE
        // /rules/:idOrName` and `POST .../evaluate` answered `500` with
        // `hook '<name>' threw: Error: …` where every conforming write door
        // answers the hook's own sentence. A refusal that DECLARED its
        // envelope (`status`/`statusCode` + `code`) is answered at its own
        // status too, as on every door that asks this.
        //
        // AFTER the prefix arms, deliberately: each of them answers a 4xx
        // this family already publishes, and none can read a sandbox error
        // (its `.message` opens with the wrapper, never a prefix), so asking
        // here moves only what used to reach the 500. Emitted in the nested
        // envelope like `SHARING_NOT_ENABLED` above, for that arm's reason.
        const refusal = classifiedRefusalAnswer(err);
        if (refusal) {
            const nested = nestedRefusalEnvelope(refusal);
            return sendEnvelopeError(res, nested.status, nested.code, nested.message, nested.extra);
        }
        logError(`[REST] sharing-rule ${defaultCode}:`, err);
        // [#22764] …and a sandboxed body the doors answer as a FAULT — one
        // that crashed, or a refusal that declared a 5xx — answers as the
        // doors do, logged above and withheld from the caller. The 500
        // below relayed the QuickJS wrapper around the native error text.
        // Nested, for the classified arm's reason.
        const fault = sandboxFaultAnswer(err);
        if (fault) {
            const nested = nestedRefusalEnvelope(fault);
            return sendEnvelopeError(res, nested.status, nested.code, nested.message, nested.extra);
        }
        return res.status(500).json({ code: defaultCode, error: msg.slice(0, 500) });
    };

    // LIST
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/sharing/rules`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                // [#6877] `object` reached `listRules` as an array; a
                // repeated `?activeOnly=true` stopped matching and listed the
                // INACTIVE rules too.
                if (refuseRepeatedQueryParams(req, res, ['object', 'activeOnly'])) return;
                const rows = await svc.listRules({
                    object: req.query?.object,
                    activeOnly: req.query?.activeOnly === 'true' || req.query?.activeOnly === true,
                }, context ?? {});
                res.json({ data: rows });
            } catch (err: any) { handleError(err, res, 'RULE_LIST_FAILED'); }
        },
        metadata: { summary: 'List sharing rules', tags: ['sharing'] },
    });

    // CREATE / UPSERT
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/sharing/rules`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const body = req.body ?? {};
                // Field-by-field pluck (not a schema parse): the authoring
                // spec shape — CEL `condition` + `sharedWith{type,value}` —
                // is not the runtime shape this endpoint takes, so unknown
                // keys are dropped rather than rejected. [#3896] That made
                // a typo (`criterias`) indistinguishable from "no criteria",
                // which used to mean "share every record". `defineRule` now
                // refuses a match-all criteria, so the typo surfaces as a
                // 400 naming the field instead of a silent 201.
                const input = {
                    name: body.name,
                    label: body.label,
                    description: body.description,
                    object: body.object ?? body.object_name,
                    criteria: body.criteria ?? body.criteria_json,
                    recipientType: body.recipientType ?? body.recipient_type,
                    recipientId: body.recipientId ?? body.recipient_id,
                    accessLevel: body.accessLevel ?? body.access_level,
                    active: body.active,
                };
                const row = await svc.defineRule(input, context ?? {});
                res.status(201).json(row);
            } catch (err: any) { handleError(err, res, 'RULE_DEFINE_FAILED'); }
        },
        metadata: { summary: 'Create or upsert a sharing rule', tags: ['sharing'] },
    });

    // GET
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/sharing/rules/:idOrName`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const row = await svc.getRule(req.params.idOrName, context ?? {});
                if (!row) return res.status(404).json({ code: 'RULE_NOT_FOUND' });
                res.json(row);
            } catch (err: any) { handleError(err, res, 'RULE_GET_FAILED'); }
        },
        metadata: { summary: 'Get a sharing rule by id or name', tags: ['sharing'] },
    });

    // DELETE
    this.routeManager.register({
        method: 'DELETE',
        path: `${dataPath}/sharing/rules/:idOrName`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                await svc.deleteRule(req.params.idOrName, context ?? {});
                res.status(204).end();
            } catch (err: any) { handleError(err, res, 'RULE_DELETE_FAILED'); }
        },
        metadata: { summary: 'Delete a sharing rule and its materialised grants', tags: ['sharing'] },
    });

    // EVALUATE
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/sharing/rules/:idOrName/evaluate`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const result = await svc.evaluateRule(req.params.idOrName, context ?? {});
                res.json(result);
            } catch (err: any) { handleError(err, res, 'RULE_EVALUATE_FAILED'); }
        },
        metadata: { summary: 'Re-evaluate a sharing rule and reconcile grants', tags: ['sharing'] },
    });
}
