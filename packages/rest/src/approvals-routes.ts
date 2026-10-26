// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 3] The approval routes of `RestServer` — the request list and
 * read, the two decisions (`approve`, `reject`), `recall`, the two flow moves
 * (`revise`, `resubmit`), the four thread interactions (`reassign`, `remind`,
 * `request-info`, `comment`) and the audit trail — moved out of
 * `rest-server.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerApprovalsEndpoints` as it stood, re-indented one level
 * and otherwise unedited: the same routes, registered in the same order, by
 * the same handlers, answering the same bodies. `handleApprovalError`'s prefix
 * map and the three route factories (`decisionRoute`, `flowMoveRoute`,
 * `threadRoute`) moved with it, unchanged.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps its private
 * `registerApprovalsEndpoints` — the published `dist/*.d.ts` lists its name,
 * docblock and position — and its body is one {@link ApprovalsRouteHost}
 * literal plus `registerApprovalsEndpoints.call(host, basePath)`. A method is
 * handed over as a closure that calls it on the server at call time, so a test
 * double or spy set on the server is still the one the body reaches.
 *
 * Each field was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. The body reads it only while registration
 *   runs — every `register` call, the three route factories' included, since
 *   each factory is invoked during registration — and the class's one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - `approvalsServiceProvider` goes as a GETTER. `resolveService` reads it at
 *   REQUEST time, and the field is not `readonly`, so a value copied at
 *   registration could part from it. The getter reads the field the handler
 *   read, when it read it.
 *
 * Module-level helpers stay where they were and are imported:
 * `APPROVAL_REQUEST_LIST_PARAMS`, `UNDECLARED_WHOLE_NUMBER_PARAM` and
 * `readDeclaredQueryNumber` from `rest-server.ts`, which already exported all
 * three; the rest from the modules `rest-server.ts` imports them from. No
 * export was added anywhere, so the published surface does not move.
 */

// [#13807] The recogniser half of the stranded-decision carrier — see
// `handleApprovalError` below. Constructor and reader share one module in
// `@objectstack/types` because the producer is a PLUGIN and rest cannot
// import one.
import { strandedDecisionDetails, sendError as sendEnvelopeError, sendOk } from '@objectstack/types';
import {
    classifiedRefusalAnswer,
    nestedRefusalEnvelope,
    sandboxFaultAnswer,
    handleRouteError,
} from './error-response.js';
import { logError } from './log.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import {
    APPROVAL_REQUEST_LIST_PARAMS,
    UNDECLARED_WHOLE_NUMBER_PARAM,
    readDeclaredQueryNumber,
    type RestServer,
} from './rest-server.js';

/**
 * The `RestServer` members {@link registerApprovalsEndpoints} reads — every one
 * of them, and no other. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for why `approvalsServiceProvider` is a getter.
 */
/**
 * [#26314] The closed query-parameter set of
 * `GET {basePath}/approvals/records/:object/:recordId/lock`: EMPTY.
 * **Measured**: the handler reads the object and the record id from the path
 * and nothing from the query string, and neither do the helpers it calls
 * (`resolveExecCtx` reads the session and headers). A name sent there is
 * refused with the located 400 (AGENTS.md route rule 5), never dropped.
 */
export const APPROVAL_RECORD_LOCK_PARAMS: readonly string[] = [];

export interface ApprovalsRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly approvalsServiceProvider: RestServer['approvalsServiceProvider'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/**
 * Register approval endpoints — `RestServer#registerApprovalsEndpoints`' body,
 * called by that method with the server as `this`. The method's own docblock,
 * which the published declaration carries, names the routes.
 */
export function registerApprovalsEndpoints(this: ApprovalsRouteHost, basePath: string): void {
    // Approval routes live at the top of the API surface (e.g.
    // `/api/v1/approvals/requests/:id/approve`). Approvals are a
    // cross-cutting capability — a request is not a record on a single
    // CRUD object, so anchoring it on `basePath` (instead of
    // `${basePath}/data`) keeps the URL semantics honest.
    const dataPath = basePath;
    const isScoped = basePath.includes('/environments/:environmentId');

    const resolveService = async (environmentId?: string) => {
        if (!this.approvalsServiceProvider) return undefined;
        try { return await this.approvalsServiceProvider(environmentId); }
        catch { return undefined; }
    };
    const respond501 = (res: any) => res.status(501).json({
        code: 'NOT_IMPLEMENTED',
        message: 'Approvals service is not configured on this deployment',
    });
    const handleApprovalError = (res: any, err: any): boolean => {
        const msg = String(err?.message ?? err ?? '');
        const mapping: Array<[RegExp, number, string]> = [
            [/^VALIDATION_FAILED/, 400, 'VALIDATION_FAILED'],
            [/^DUPLICATE_REQUEST/, 409, 'DUPLICATE_REQUEST'],
            [/^INVALID_STATE/, 409, 'INVALID_STATE'],
            [/^THROTTLED/, 429, 'THROTTLED'],
            [/^FORBIDDEN/, 403, 'FORBIDDEN'],
            [/^REQUEST_NOT_FOUND/, 404, 'REQUEST_NOT_FOUND'],
            // #4420 — the request and its flow run disagree about whether
            // the work can still proceed. A conflict, like INVALID_STATE:
            // the row is fine, the run behind it is not.
            [/^RESUME_TARGET_LOST/, 409, 'RESUME_TARGET_LOST'],
            // The outcome IS recorded and its run is stranded — a genuine
            // server-side inconsistency, but named, so the client can say
            // which run needs an operator instead of showing a bare 500.
            [/^RESUME_FAILED/, 500, 'RESUME_FAILED'],
            // The write IS recorded and NOT rolled back, but the updated
            // row is invisible inside the caller's organization scope, so
            // the result envelope cannot be built. Same class as
            // RESUME_FAILED — a genuine server-side inconsistency, named
            // (commit 5b3ff63cc): read the request back with a system or
            // matching-organization context.
            [/^READ_BACK_FAILED/, 500, 'READ_BACK_FAILED'],
        ];
        // [#13807, maintainer ruling 2026-09-04 batch #37] The
        // machine-readable half of a stranded decision, when the service
        // attached one. The status code does NOT move — a recorded
        // decision whose run strands is still a failure and the ruling
        // upholds that — but the body stops being prose only: `finalized`
        // says the decision stands, `decision` / `runId` name what and
        // where, and `repairable` carries the engine's own `'stranded'`
        // discriminator through instead of dying at the door.
        //
        // Before this, a caller reading 500 had exactly one honest move —
        // assume the rejection did not happen — and it was the wrong one:
        // the row IS terminal and the record's mirrored status HAS moved.
        // An operator had to regex the run id out of a sentence.
        //
        // ⛔ Presence-gated, never synthesised. `strandedDecisionDetails`
        // returns `undefined` for any error that did not carry a complete
        // envelope, and this then answers exactly the body it always did —
        // a `RESUME_FAILED` from a caller with no decision to report must
        // not be dressed up as one.
        const stranded = strandedDecisionDetails(err);
        for (const [re, status, code] of mapping) {
            if (re.test(msg)) {
                // [#13095] The strip is anchored to the CODE this row just
                // answered — the same declared-code anchoring
                // `withoutDeclaredCodePrefix` (error-response.ts) and
                // `respondSharingError`'s prefix arm apply, converged here
                // by the 2026-08-31 ruling. The blanket
                // SCREAMING_SNAKE-colon regex that used to sit here
                // (`/^[A-Z_]+:\s*/`) is exactly the shape #12975 rejected:
                // it could eat a token the wire carries nowhere else (a
                // message opening with a DIFFERENT capitalised word and a
                // colon), where the anchored form can only ever remove a
                // duplicate of the `code` already on the wire.
                res.status(status).json({
                    code,
                    error: msg.replace(new RegExp(`^${code}:\\s*`), ''),
                    // Anchored to the code the envelope describes, for the
                    // same reason the strip above is: these four facts are
                    // about a recorded-decision-with-stranded-run and
                    // about nothing else.
                    ...(code === 'RESUME_FAILED' && stranded ? stranded : {}),
                });
                return true;
            }
        }
        // [#22719] A refusal no prefix above matches is asked of the `/data`
        // door's own classification before the caller's outer 500 relays
        // `.message`. For a sandboxed hook's refusal `.message` is the
        // QuickJS debug wrapper, so all nine write routes here answered
        // `500 APPROVAL_*_FAILED` with `hook '<name>' threw: Error: …` where
        // every conforming write door answers the hook's own sentence; a
        // refusal declaring `status`/`statusCode` + `code` is answered at
        // its own status too.
        //
        // AFTER the mapping, deliberately: every row above answers a code
        // this family publishes, and none can read a sandbox error (its
        // `.message` opens with the wrapper), so asking here moves only what
        // used to reach the 500. Nested envelope, for the reason the
        // sharing-rule family's `SHARING_NOT_ENABLED` arm gives: a new arm
        // does not copy the flat `{ code, error }` dialect.
        const refusal = classifiedRefusalAnswer(err);
        if (refusal) {
            const nested = nestedRefusalEnvelope(refusal);
            sendEnvelopeError(res, nested.status, nested.code, nested.message, nested.extra);
            return true;
        }
        // [#22764] A sandboxed body the doors answer as a FAULT — one that
        // crashed, or a refusal that declared a 5xx — answers as the doors
        // do rather than reaching the caller's outer `500
        // APPROVAL_*_FAILED`, which relayed the QuickJS wrapper around the
        // native error text. Logged here because answering it skips the
        // outer arm's log line, and the operator is now the only reader.
        const fault = sandboxFaultAnswer(err);
        if (fault) {
            logError('[REST] approval error:', err);
            const nested = nestedRefusalEnvelope(fault);
            sendEnvelopeError(res, nested.status, nested.code, nested.message, nested.extra);
            return true;
        }
        return false;
    };

    // ── Requests ──────────────────────────────────────────────
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/approvals/requests`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) {
                    // No approvals plugin loaded — return empty list rather than 501
                    // so Console badge polls don't spam the error log on deployments
                    // that don't run an approvals workflow.
                    res.json({ data: [] });
                    return;
                }
                // [#7527] The closed parameter set for this route, measured
                // from what the handler below actually reads. A name outside
                // it is REFUSED, never dropped: `?assignedToMe=true` used to
                // answer 200 with the whole list, and an ignored filter is
                // indistinguishable from one that matched everything. Paging
                // (`limit`/`offset`) and the snake_case alias spellings are
                // in the set because the handler honours them — a whitelist
                // built from the filters alone would break paging.
                if (refuseUnknownQueryParams(req, res, APPROVAL_REQUEST_LIST_PARAMS)) return;
                // [#6877] `approverId` / `approver_id` are the model case
                // for the multi-valued side and are therefore NOT listed:
                // the block immediately below reads their array arm ON
                // PURPOSE. Everything else here narrows the list to one
                // value and is declared single-valued.
                if (refuseRepeatedQueryParams(req, res, [
                    'object', 'recordId', 'record_id', 'status',
                    'submitterId', 'submitter_id', 'q', 'limit', 'offset',
                ])) return;
                const q = req.query ?? {};
                // `approverId` accepts a single id, a comma-separated
                // list, or the param repeated (→ array). Normalise all
                // three to a string[] so the Console can resolve "my
                // pending approvals" across every identity (user id /
                // email / role:<r>) in ONE request rather than looping.
                const rawApprover = q.approverId ?? q.approver_id;
                const approverIds = (Array.isArray(rawApprover) ? rawApprover : (rawApprover != null ? [rawApprover] : []))
                    .flatMap((s: any) => String(s).split(','))
                    .map((s: string) => s.trim())
                    .filter(Boolean);
                // [#20139] Read, not coerced. `?limit=abc` (or `Infinity`) was
                // `NaN`, dropped by an `isFinite` guard, and answered with the
                // UNPAGED 500-row window and no `total` — a caller asking for a
                // page got a different shape of answer; `?offset=abc` was dropped
                // to the first page. `?limit=` / `?offset=` became `Number('')` =
                // 0: a ONE-row page, or the service's 50-row paged mode the caller
                // never asked for — so empty is refused here, not read as absent.
                // No request schema is declared for this door, so both read as
                // whole numbers; the service's own `[1, 200]` clamp is unchanged.
                //
                // Caught HERE, not by the catch below: that one answers every
                // throw `500 APPROVAL_REQUEST_LIST_FAILED`, and a query value the
                // door cannot read is the caller's `400`.
                let limit: number | undefined;
                let offset: number | undefined;
                try {
                    limit = readDeclaredQueryNumber(q, 'limit',
                        UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: false });
                    offset = readDeclaredQueryNumber(q, 'offset',
                        UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: false });
                } catch (refusal: any) {
                    handleRouteError(res, refusal);
                    return;
                }
                const listFilter = {
                    object: q.object,
                    recordId: q.recordId ?? q.record_id,
                    status: q.status,
                    approverId: approverIds.length ? approverIds : undefined,
                    submitterId: q.submitterId ?? q.submitter_id,
                    q: typeof q.q === 'string' ? q.q : undefined,
                    limit,
                    offset,
                };
                const rows = await svc.listRequests(listFilter, context ?? {});
                // `total` only when the caller pages — counting costs a
                // second query and unpaged callers don't need it.
                if (listFilter.limit != null && typeof svc.countRequests === 'function') {
                    const total = await svc.countRequests(listFilter, context ?? {});
                    res.json({ data: rows, total });
                    return;
                }
                res.json({ data: rows });
            } catch (error: any) {
                logError('[REST] List approval requests error:', error);
                res.status(500).json({ code: 'APPROVAL_REQUEST_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
            }
        },
        metadata: { summary: 'List approval requests', tags: ['approvals'] },
    });

    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/approvals/requests/:id`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const row = await svc.getRequest(req.params.id, context ?? {});
                if (!row) {
                    res.status(404).json({ code: 'REQUEST_NOT_FOUND', error: `Approval request '${req.params.id}' not found` });
                    return;
                }
                res.json(row);
            } catch (error: any) {
                logError('[REST] Get approval request error:', error);
                res.status(500).json({ code: 'APPROVAL_REQUEST_GET_FAILED', error: String(error?.message ?? error).slice(0, 500) });
            }
        },
        metadata: { summary: 'Get an approval request by id', tags: ['approvals'] },
    });

    // [#26314] Is this record held by a locking approval — answered to every
    // caller who can read the record (#25934 ruling A), so a non-participant's
    // page shows the lock instead of offering an edit the server refuses.
    // `IApprovalService.getRecordLock` carries the rule: the record is read AS
    // THE CALLER, and an unreadable record answers `null`, the same as a
    // record id that does not exist — so this door answers both with the same
    // 404, and the payload is `{ locked }` alone. Optional on the contract, so
    // an implementation without it answers 501, never a guess.
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/approvals/records/:object/:recordId/lock`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (refuseUnknownQueryParams(req, res, APPROVAL_RECORD_LOCK_PARAMS)) return;
                const svc = await resolveService(environmentId);
                if (!svc || typeof svc.getRecordLock !== 'function') return respond501(res);
                const { object, recordId } = req.params;
                const lock = await svc.getRecordLock(object, recordId, context ?? {});
                if (!lock) {
                    // One body for both causes, byte for byte: the sentence
                    // names neither the id nor why, so it cannot tell them apart.
                    sendEnvelopeError(res, 404, 'RECORD_NOT_FOUND', `No such '${object}' record`);
                    return;
                }
                sendOk(res, { locked: lock.locked === true });
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: { summary: 'Whether a record is held by a locking approval', tags: ['approvals'] },
    });

    // Record a decision on a node-driven request. Both branches funnel
    // through the contract's `decide()`, which finalizes the request and
    // resumes the owning flow run down the matching `approve` / `reject`
    // edge.
    //
    // On the `actorId` these routes forward (#3800): it is a HINT, not the
    // acting identity. The service pins the actor to the authenticated
    // caller and accepts a body value only when it can prove the caller
    // holds that identity — a slot keyed by a `type:value` literal or by
    // the caller's email, which the Console legitimately sends. It is
    // forwarded rather than dropped for exactly those cases; naming anyone
    // else is `FORBIDDEN` at the service, never here.
    const decisionRoute = (decision: 'approve' | 'reject') => {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/approvals/requests/:id/${decision}`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    try {
                        const out = await svc.decide(req.params.id, {
                            decision,
                            actorId: body.actorId ?? body.actor_id ?? context?.userId,
                            comment: body.comment,
                            attachments: body.attachments,
                            // #3447 P2: author-declared decision outputs — the
                            // service validates keys against the node's
                            // `decisionOutputs` whitelist before any write.
                            outputs: body.outputs,
                        }, context ?? {});
                        res.json(out);
                    } catch (err: any) {
                        if (handleApprovalError(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError(`[REST] ${decision} approval error:`, error);
                    res.status(500).json({ code: `APPROVAL_${decision.toUpperCase()}_FAILED`, error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: `${decision[0].toUpperCase()}${decision.slice(1)} an approval request`, tags: ['approvals'] },
        });
    };
    decisionRoute('approve');
    decisionRoute('reject');

    // Recall — submitter withdraws a pending request. Mirrors the decision
    // routes' error mapping; the service enforces submitter-only access.
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/approvals/requests/:id/recall`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc || typeof svc.recall !== 'function') return respond501(res);
                const body = req.body ?? {};
                try {
                    const out = await svc.recall(req.params.id, {
                        actorId: body.actorId ?? body.actor_id ?? context?.userId,
                        comment: body.comment,
                    }, context ?? {});
                    res.json(out);
                } catch (err: any) {
                    if (handleApprovalError(res, err)) return;
                    throw err;
                }
            } catch (error: any) {
                logError('[REST] recall approval error:', error);
                res.status(500).json({ code: 'APPROVAL_RECALL_FAILED', error: String(error?.message ?? error).slice(0, 500) });
            }
        },
        metadata: { summary: 'Recall (withdraw) an approval request', tags: ['approvals'] },
    });

    // Send back for revision / resubmit (ADR-0044). Both move the flow (the
    // request finalizes `returned` and the run parks at a wait point; a
    // resubmit re-enters the approval node), so — like recall — they are
    // dedicated routes rather than thread interactions. The service enforces
    // access (send-back = a pending approver; resubmit = the submitter) and
    // returns the flow outcome (`autoRejected` / `resumed`) verbatim.
    const flowMoveRoute = (
        action: 'revise' | 'resubmit',
        invoke: (svc: any, id: string, body: any, context: any) => Promise<unknown>,
    ) => {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/approvals/requests/:id/${action}`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    try {
                        const out = await invoke(svc, req.params.id, body, context ?? {});
                        res.json(out);
                    } catch (err: any) {
                        if (handleApprovalError(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError(`[REST] ${action} approval error:`, error);
                    res.status(500).json({ code: `APPROVAL_${action.toUpperCase()}_FAILED`, error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: `${action} an approval request`, tags: ['approvals'] },
        });
    };
    flowMoveRoute('revise', (svc, id, body, context) => {
        if (typeof svc.sendBack !== 'function') throw new Error('VALIDATION_FAILED: revise is not supported');
        return svc.sendBack(id, {
            actorId: body.actorId ?? body.actor_id ?? context?.userId,
            comment: body.comment,
        }, context);
    });
    flowMoveRoute('resubmit', (svc, id, body, context) => {
        if (typeof svc.resubmit !== 'function') throw new Error('VALIDATION_FAILED: resubmit is not supported');
        return svc.resubmit(id, {
            actorId: body.actorId ?? body.actor_id ?? context?.userId,
            comment: body.comment,
        }, context);
    });

    // Thread interactions — reassign / remind / request-info / comment.
    // None of these move the flow; they update approver slots or the
    // audit thread. Registered generically: the service method enforces
    // the per-action permission (slot holder / submitter / participant).
    const threadRoute = (
        action: 'reassign' | 'remind' | 'request-info' | 'comment',
        invoke: (svc: any, id: string, body: any, context: any) => Promise<unknown>,
    ) => {
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/approvals/requests/:id/${action}`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    try {
                        const out = await invoke(svc, req.params.id, body, context ?? {});
                        res.json(out);
                    } catch (err: any) {
                        if (handleApprovalError(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError(`[REST] ${action} approval error:`, error);
                    res.status(500).json({ code: `APPROVAL_${action.toUpperCase().replace('-', '_')}_FAILED`, error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: `${action} on an approval request`, tags: ['approvals'] },
        });
    };
    threadRoute('reassign', (svc, id, body, context) => {
        if (typeof svc.reassign !== 'function') throw new Error('VALIDATION_FAILED: reassign is not supported');
        return svc.reassign(id, {
            actorId: body.actorId ?? body.actor_id ?? context?.userId,
            to: body.to, from: body.from, comment: body.comment,
        }, context);
    });
    threadRoute('remind', (svc, id, body, context) => {
        if (typeof svc.remind !== 'function') throw new Error('VALIDATION_FAILED: remind is not supported');
        return svc.remind(id, {
            actorId: body.actorId ?? body.actor_id ?? context?.userId,
            comment: body.comment,
        }, context);
    });
    threadRoute('request-info', (svc, id, body, context) => {
        if (typeof svc.requestInfo !== 'function') throw new Error('VALIDATION_FAILED: request-info is not supported');
        return svc.requestInfo(id, {
            actorId: body.actorId ?? body.actor_id ?? context?.userId,
            comment: body.comment,
        }, context);
    });
    threadRoute('comment', (svc, id, body, context) => {
        if (typeof svc.comment !== 'function') throw new Error('VALIDATION_FAILED: comment is not supported');
        return svc.comment(id, {
            actorId: body.actorId ?? body.actor_id ?? context?.userId,
            comment: body.comment,
            attachments: body.attachments,
        }, context);
    });

    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/approvals/requests/:id/actions`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const rows = await svc.listActions(req.params.id, context ?? {});
                res.json({ data: rows });
            } catch (error: any) {
                logError('[REST] List approval actions error:', error);
                res.status(500).json({ code: 'APPROVAL_ACTIONS_FAILED', error: String(error?.message ?? error).slice(0, 500) });
            }
        },
        metadata: { summary: 'List actions (audit trail) for an approval request', tags: ['approvals'] },
    });
}
