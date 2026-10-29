// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 6] The security routes of `RestServer` — the access-explanation
 * family (`GET` / `POST {basePath}/security/explain` and
 * `GET {basePath}/security/my-delegable-scope`) and the suggested audience
 * bindings (`GET {basePath}/security/suggested-bindings`, with its
 * `/:id/confirm` and `/:id/dismiss`) — moved out of `rest-server.ts` whole.
 *
 * A MOVE, not a redesign. The two functions below are the bodies of
 * `RestServer#registerSecurityExplainEndpoints` and
 * `RestServer#registerSecurityEndpoints` as they stood, each re-indented one
 * level and otherwise unedited: the same routes, registered in the same order,
 * by the same handlers, answering the same bodies. Each body's local helpers
 * moved with it, unchanged — the explain family's `resolveService` and
 * `respondError`, the suggested-binding family's `resolveService`,
 * `respondError`, `respond501` and `handleError` — and so did the imports only
 * these bodies read, each with its comment where it had one. The two
 * registrars share ONE module because they are one `security` family (the
 * explain family's emitter docblock names the other its immediately adjacent
 * registrar); they still share no code, exactly as before.
 *
 * ## How the moved bodies reach the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps both private methods
 * — the published `dist/*.d.ts` lists their names, docblocks and positions —
 * and each body is one host literal ({@link SecurityExplainRouteHost},
 * {@link SecurityRouteHost}) plus `.call(host, basePath)`. A method is handed
 * over as a closure that calls it on the server at call time, so a test double
 * or spy set on the server is still the one the body reaches.
 *
 * Each field was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. Both bodies read it only for their
 *   `register` calls, all of which run while registration runs, and the
 *   class's one `routeManager` reassignment wraps
 *   `registerMetadataEndpointsInner`, never these registrars.
 * - `kernelManager` (read by the explain body) and `securityServiceProvider`
 *   (read by both) go as GETTERS. Each body's `resolveService` reads them at
 *   REQUEST time, and neither field is `readonly`, so a value copied at
 *   registration could part from it. The getter reads the field the handler
 *   read, when it read it.
 *
 * Module-level helpers stay where they were and are imported from the modules
 * `rest-server.ts` imports them from; the bodies read nothing declared in
 * `rest-server.ts` itself, so no export was added anywhere and the published
 * surface does not move.
 */

// `sendError`, aliased exactly as `rest-server.ts` aliases it: the note at that
// file's import says why the alias names the envelope DIALECT, and the explain
// family's emitter docblock below points at it.
import { sendError as sendEnvelopeError } from '@objectstack/types';
// [#7678] ADR-0090 D5/D9 suggested-binding `?status=` vocabulary — the one
// owner, shared with the runtime dispatcher's `/security` domain.
import { isAudienceBindingSuggestionStatus, unknownAudienceBindingSuggestionStatusMessage } from '@objectstack/core';
// [#8073] The closed ADR-0112 error vocabulary, so the explain family's single
// refusal emitter types its `code` parameter as the vocabulary rather than as
// `string` — an invented code is a compile error at the call site instead of a
// runtime surprise on whichever arm a test happens to drive.
import type { ErrorCode } from '@objectstack/spec/api';
// [#11683] The catalog's own floor for "a required `code` and no more specific
// one" — see its use in the explain family's classified-refusal arm below (and
// `respondSharingError`'s in `sharing-routes.ts`), where the nested ADR-0112
// envelope declares `code` REQUIRED while the flat classification it re-dresses
// legitimately carries none.
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { classifiedRefusalAnswer, nestedRefusalEnvelope, sandboxFaultAnswer } from './error-response.js';
import { logError } from './log.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import type { RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerSecurityExplainEndpoints} reads —
 * every one of them, and no other. Each is typed AS the class member (an
 * indexed access on the class), so a change to a member's signature on the
 * class is a change here too, and naming a member the class does not have is a
 * compile error. See the module header for why `kernelManager` and
 * `securityServiceProvider` are getters.
 */
export interface SecurityExplainRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly kernelManager: RestServer['kernelManager'];
    readonly securityServiceProvider: RestServer['securityServiceProvider'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/**
 * The `RestServer` members {@link registerSecurityEndpoints} reads — every one
 * of them, and no other, typed as {@link SecurityExplainRouteHost}'s are. See
 * the module header for why `securityServiceProvider` is a getter.
 */
export interface SecurityRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly securityServiceProvider: RestServer['securityServiceProvider'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/**
 * Register the access-explanation endpoints —
 * `RestServer#registerSecurityExplainEndpoints`' body, called by that method
 * with the server as `this`. The method's own docblock, which the published
 * declaration carries, names the routes and their contract.
 */
export function registerSecurityExplainEndpoints(this: SecurityExplainRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    // Resolve the ENVIRONMENT's security service first (its resolver /
    // evaluator / RLS compiler are bound to the env kernel's own data
    // engine); the host provider is the single-kernel fallback.
    const resolveService = async (environmentId?: string, req?: any) => {
        try {
            const envId = await this.resolveRequestEnvironmentId(environmentId, req);
            if (envId && envId !== 'platform' && this.kernelManager) {
                const kernel = await this.kernelManager.getOrCreate(envId);
                const svc = await kernel.getServiceAsync<any>('security').catch(() => undefined);
                if (svc) return svc;
            }
        } catch { /* fall back to the host service */ }
        if (!this.securityServiceProvider) return undefined;
        try { return await this.securityServiceProvider(environmentId); }
        catch { return undefined; }
    };

    /**
     * [#8073] The ONE refusal emitter for this route family — every arm of
     * both handlers goes through it, so "explain and my-delegable-scope
     * answer the same shape" is a property of the code rather than of
     * eight literals that happen to agree.
     *
     * Before this, the family carried BOTH dialects ADR-0112 D5 retires:
     * the 401/501/400/403 arms were flat `{ code, message }` and the two
     * 500s were `{ code, error: 'a bare string' }`, so `body.error.code` —
     * the one position D5 declares — read `undefined` on all six. #7035
     * (PR #7293) had already removed both from this file's `/meta`
     * refusals and #7981 (PR #8071) from `registerSecurityEndpoints`, the
     * immediately ADJACENT registrar: a client calling `explain` and then
     * `suggested-bindings` met two shapes inside one `security` family.
     *
     * Emitted through the SHARED builder (`sendError` from
     * `@objectstack/types`, imported as `sendEnvelopeError` — see the note
     * at the import). That is what makes this the reference shape by
     * construction rather than a ninth local literal agreeing with the
     * eight it replaced, and it types `code` to the closed vocabulary for
     * free.
     *
     * ⛔ Status codes are untouched: only the POSITION of `code` and
     * `message` moves. `detail` — the 400 arm's Zod-issue dump — moves to
     * `error.details`, the slot `ApiErrorSchema` actually declares for
     * structured context; as a top-level sibling it was undeclared.
     */
    const respondError = (
        res: any,
        status: number,
        code: ErrorCode,
        message: string,
        details?: unknown,
    ): void => sendEnvelopeError(
        res, status, code, message,
        details === undefined ? undefined : { details },
    );

    const handler = async (req: any, res: any) => {
        try {
            const environmentId = isScoped ? req.params?.environmentId : undefined;
            const context = await this.resolveExecCtx(environmentId, req);
            if (this.enforceAuth(req, res, context)) return;
            if (!context?.userId) {
                // The explain surface stays authenticated-only — it is an
                // admin diagnosis tool. (Anonymous is already 401ed above.)
                return respondError(
                    res, 401, 'UNAUTHORIZED',
                    'The access-explanation endpoint requires an authenticated caller.',
                );
            }

            const svc = await resolveService(environmentId, req);
            if (!svc || typeof svc.explain !== 'function') {
                return respondError(
                    res, 501, 'NOT_IMPLEMENTED',
                    'Access explanation is not available on this deployment (no security service with explain).',
                );
            }

            // GET reads the request from the query string, POST from the
            // body — one contract (ExplainRequestSchema), two transports.
            //
            // [#6877] The other read point that was already safe, and for the
            // structural reason rather than by luck: every field goes through
            // `ExplainRequestSchema.safeParse` below, whose members are
            // `z.string()`, so an array is refused as `400 VALIDATION_FAILED`
            // by the schema itself. A schema at the boundary is the shape the
            // refusal gate is imitating, so there is nothing to add here.
            const src = req.method === 'GET' ? (req.query ?? {}) : (req.body ?? {});
            const { ExplainRequestSchema } = await import('@objectstack/spec/security');
            // [#8326] GET-transport normalization ONLY: a query string
            // cannot spell a one-element array (`?recordIds=a` parses to
            // the bare string), so a lone string is wrapped on GET. On
            // POST the body is JSON and can say what it means — a string
            // where the contract says array stays a 400, not a wrap.
            const rawRecordIds = req.method === 'GET' && typeof src.recordIds === 'string' && src.recordIds !== ''
                ? [src.recordIds]
                : src.recordIds;
            const parsed = (ExplainRequestSchema as any).safeParse({
                object: src.object,
                operation: src.operation ?? 'read',
                ...(src.userId != null && src.userId !== '' ? { userId: src.userId } : {}),
                // [C2 / ADR-0095] Optional record id — explains ONE concrete
                // row at record granularity; omitted stays object-level.
                ...(src.recordId != null && src.recordId !== '' ? { recordId: src.recordId } : {}),
                // [#8326] Optional batch of record ids — the schema owns the
                // cap (200), the min (1), and recordId/recordIds mutual
                // exclusion, so every refusal is the one 400 below.
                ...(rawRecordIds != null ? { recordIds: rawRecordIds } : {}),
            });
            if (!parsed.success) {
                return respondError(
                    res, 400, 'VALIDATION_FAILED',
                    'Invalid explain request — expected { object: string, operation: read|create|update|delete|transfer|restore|purge, userId?: string, recordId?: string, recordIds?: string[] (max 200, exclusive with recordId) }.',
                    String(parsed.error?.message ?? '').slice(0, 1000),
                );
            }

            const { recordIds, ...singularRequest } = parsed.data as { recordIds?: string[] } & Record<string, unknown>;
            if (!recordIds) {
                // Singular / object-level — the pre-#8326 path, byte-identical.
                const decision = await svc.explain(parsed.data, context);
                return res.json(decision);
            }

            // [#8326] Batch form — transport amortization of the SINGULAR
            // evaluation, not a new semantic: the object-level trace is one
            // object-level explain, and each per-record verdict is the
            // singular record-grained explain for that id, relayed
            // verbatim. "Batch answer ≡ N singular answers" is therefore a
            // property of the construction, and the agreement test pins it
            // from staying that way by accident.
            const decision = await svc.explain(singularRequest, context);
            const verdictById = new Map<string, unknown>();
            for (const id of new Set(recordIds)) {
                const single = await svc.explain({ ...singularRequest, recordId: id }, context);
                // A service without record-grained support answers no
                // record verdict; fail CLOSED (a hidden button beats a
                // shown-then-403), with no decidedBy fabricated.
                verdictById.set(id, single?.record ?? { recordId: id, visible: false });
            }
            // Ordering contract: records[i] answers recordIds[i] — same
            // order, same length, duplicates answered per position.
            res.json({ ...decision, records: recordIds.map((id) => verdictById.get(id)) });
        } catch (error: any) {
            const msg = String(error?.message ?? error ?? '');
            if (
                error?.code === 'PERMISSION_DENIED' ||
                error?.name === 'PermissionDeniedError' ||
                msg.startsWith('[Security] Access denied')
            ) {
                return respondError(res, 403, 'PERMISSION_DENIED', msg.slice(0, 1000));
            }
            // [#18253] The name asked about is not a declared object
            // (`ExplainObjectNotFoundError`, plugin-security `errors.ts`) —
            // a REFUSAL, not a fault, so it keeps its declared answer
            // instead of falling to the 500 below. 404 `OBJECT_NOT_FOUND`
            // is what this package already answers for an unregistered
            // object name (`mapDataError`, `error-response.ts`), emitted
            // here through this family's ONE refusal emitter so the body
            // is the same ADR-0112 D5 envelope every other arm sends.
            // Matched by `code`/`name`, exactly as the 403 arm above is:
            // `@objectstack/plugin-security` is not a dependency of this
            // package, and the thrown shape is the contract (#8016).
            if (error?.code === 'OBJECT_NOT_FOUND' || error?.name === 'ExplainObjectNotFoundError') {
                return respondError(res, 404, 'OBJECT_NOT_FOUND', msg.slice(0, 1000));
            }
            // [#20603] A refusal the SERVICE classified: an ADR-0112 `code`
            // with a 4xx `status` (either spelling), or a sandboxed body's
            // business `throw`. It is the caller's answer, not this route's
            // fault. The measured producer is the explain engine answering
            // enforcement's own refusal, `INVALID_FILTER` / 400, for a
            // row-level filter the record matcher cannot evaluate: in a
            // record-grained explanation, and since #20604 in an
            // object-level one and for a `recordId` no row carries. The
            // find that explain describes answers 400 for the same filter.
            // This arm used to answer `500 EXPLAIN_FAILED`, so a client
            // read an outage where the platform meant "this policy cannot
            // be evaluated".
            //
            // The classification is {@link classifiedRefusalAnswer}, the
            // `/data` door's own, imported for the same reason the analytics
            // and record-share doors import it (#11684): a local list of
            // codes here would be a third opinion on a question that file
            // owns. It answers `undefined` for everything the 500 below
            // still owns: a declared 5xx, half an envelope (a code without
            // a status, #5352), a crashed sandbox body, an unclassified
            // fault. The 403 and 404 arms above keep running first,
            // because they also match refusals that declare no status.
            //
            // Re-dressed through this family's ONE emitter, as the
            // record-share family re-dresses it: `code` is required by the
            // nested envelope and the sandbox limb legitimately carries
            // none, so the catalog's status floor fills it. The message is
            // the classification's, which unwraps a sandbox wrapper and
            // applies the `/data` door's bound.
            //
            // ⛔ Scope: status, code and message. The classification's
            // `declaredCode` and `userMessage` siblings are not forwarded,
            // because this family's emitter has no slot for them (its fifth
            // argument is `details`) and no arm of the family forwards
            // them today. Adding that slot is a change to the whole family.
            const refusal = classifiedRefusalAnswer(error);
            if (refusal) {
                const code = typeof refusal.body.code === 'string'
                    ? refusal.body.code as ErrorCode
                    : standardErrorCodeForHttpStatus(refusal.status);
                return respondError(res, refusal.status, code, String(refusal.body.error ?? ''));
            }
            logError('[REST] Security explain error:', error);
            // [#22764] A sandboxed body the doors answer as a fault (a
            // crash, or a refusal declaring a 5xx) answers as the doors do,
            // instead of the QuickJS wrapper relayed below. Status, code
            // and message only, the refusal arm's scope above.
            const fault = sandboxFaultAnswer(error);
            if (fault) {
                const nested = nestedRefusalEnvelope(fault);
                return respondError(res, nested.status, nested.code, nested.message);
            }
            // The 500 arm keeps its 500-char cap: an unexpected fault's
            // message is not a contract, and truncating it stays a
            // sanitization step — only the position of the words moves.
            respondError(res, 500, 'EXPLAIN_FAILED', msg.slice(0, 500));
        }
    };

    this.routeManager.register({
        method: 'GET',
        path: `${basePath}/security/explain`,
        handler,
        metadata: { summary: 'Explain why a principal can (or cannot) perform an operation on an object (ADR-0090 D6)', tags: ['security'] },
    });
    this.routeManager.register({
        method: 'POST',
        path: `${basePath}/security/explain`,
        handler,
        metadata: { summary: 'Explain why a principal can (or cannot) perform an operation on an object (ADR-0090 D6)', tags: ['security'] },
    });

    /**
     * [ADR-0090 D12 / ADR-0105 D8] What the CALLER may delegate.
     *
     *   GET {basePath}/security/my-delegable-scope
     *
     * The read half of the delegated-admin gate, shaped for a picker: the
     * business units the caller may place people into and the positions
     * they may assign. A scoped-invitation form narrows its options with
     * this instead of listing the whole tree and letting the user find the
     * boundary by being refused.
     *
     * Strictly SELF-scoped — no `userId` parameter, by design. The caller's
     * own resolved sets are the only input, so it discloses nothing beyond
     * the authority they already hold, and there is no "describe someone
     * else's authority" surface to authorize (unlike `explain`, which has
     * one and gates it). An authenticated caller is still required.
     */
    const delegableHandler = async (req: any, res: any) => {
        try {
            const environmentId = isScoped ? req.params?.environmentId : undefined;
            const context = await this.resolveExecCtx(environmentId, req);
            if (this.enforceAuth(req, res, context)) return;
            if (!context?.userId) {
                return respondError(
                    res, 401, 'UNAUTHORIZED',
                    'The delegable-scope endpoint requires an authenticated caller.',
                );
            }

            const svc = await resolveService(environmentId, req);
            if (!svc || typeof svc.describeDelegableScope !== 'function') {
                return respondError(
                    res, 501, 'NOT_IMPLEMENTED',
                    'Delegated administration is not available on this deployment (no security service with describeDelegableScope).',
                );
            }

            res.json(await svc.describeDelegableScope(context));
        } catch (error: any) {
            const msg = String(error?.message ?? error ?? '');
            logError('[REST] Delegable scope error:', error);
            respondError(res, 500, 'DELEGABLE_SCOPE_FAILED', msg.slice(0, 500));
        }
    };

    this.routeManager.register({
        method: 'GET',
        path: `${basePath}/security/my-delegable-scope`,
        handler: delegableHandler,
        metadata: {
            summary: "The caller's delegable scope: business units they may place into and positions they may assign (ADR-0090 D12 / ADR-0105 D8)",
            tags: ['security'],
        },
    });
}

/**
 * Register the suggested-audience-binding endpoints —
 * `RestServer#registerSecurityEndpoints`' body, called by that method with the
 * server as `this`. The method's own docblock, which the published declaration
 * carries, names the routes and their one refusal envelope.
 */
export function registerSecurityEndpoints(this: SecurityRouteHost, basePath: string): void {
    const dataPath = basePath;
    const isScoped = basePath.includes('/environments/:environmentId');

    const resolveService = async (environmentId?: string) => {
        if (!this.securityServiceProvider) return undefined;
        try {
            const svc = await this.securityServiceProvider(environmentId);
            return svc && typeof svc.listAudienceBindingSuggestions === 'function' ? svc : undefined;
        } catch { return undefined; }
    };
    /**
     * The ONE refusal emitter for this route family (#7981) — every arm
     * goes through it, so "the three answer the same shape" is a property
     * of the code rather than of three literals that happen to agree.
     * `refuseRepeatedQueryParams` writes the identical body from
     * `query-multiplicity.ts`; that helper is shared with the whole file
     * and stays the reference point rather than being re-implemented here.
     */
    // [#22719] `extra` carries the declared channels of a classified refusal
    // (`declaredCode`, `userMessage`) inside the same `error` object; every
    // other arm passes none and writes exactly `{ code, message }`.
    const respondError = (
        res: any, status: number, code: string, message: string,
        extra?: { declaredCode?: string; userMessage?: string },
    ) => res.status(status).json({ error: { code, message, ...extra } });
    const respond501 = (res: any) => respondError(
        res, 501, 'NOT_IMPLEMENTED', 'Security service is not configured on this deployment',
    );
    const handleError = (err: any, res: any, defaultCode: string) => {
        const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
        if (status !== 500) {
            // The typed arm: plugin-security's PermissionDeniedError (403),
            // SuggestionNotFoundError (404) and SuggestionStateError (409)
            // each carry `code` + `statusCode`. The status mapping is
            // unchanged — only the position of the code moves.
            return respondError(res, status, err?.code ?? defaultCode, String(err?.message ?? err));
        }
        // [#22719] A refusal the typed arm cannot read is asked of the
        // `/data` door's own classification before the 500 below relays
        // `.message`. A sandboxed hook's refusal carries no `statusCode`
        // (the sandbox lifts `status` only), so `confirm` and `dismiss`
        // answered `500` with the QuickJS debug wrapper
        // where every conforming write door answers the hook's own
        // sentence; a refusal declaring `status` + `code` is answered at
        // its own status too. The typed arm above is untouched, and the
        // answer leaves through this family's one emitter.
        const refusal = classifiedRefusalAnswer(err);
        if (refusal) {
            const nested = nestedRefusalEnvelope(refusal);
            return respondError(res, nested.status, nested.code, nested.message, nested.extra);
        }
        logError(`[REST] suggested-bindings ${defaultCode}:`, err);
        // [#22764] A sandboxed body the doors answer as a fault (a crash, or
        // a refusal declaring a 5xx) answers as the doors do, through this
        // family's one emitter, instead of the wrapper relayed below.
        const fault = sandboxFaultAnswer(err);
        if (fault) {
            const nested = nestedRefusalEnvelope(fault);
            return respondError(res, nested.status, nested.code, nested.message, nested.extra);
        }
        // The 500 arm keeps its 500-char cap: an unexpected fault's message
        // is not a contract, and truncating it stays a sanitization step.
        return respondError(res, 500, defaultCode, String(err?.message ?? err).slice(0, 500));
    };

    // LIST (reconciles against installed packages / declared sets first)
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/security/suggested-bindings`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                // [#6877] Both are `String(array)` joins — `?status=a&status=b`
                // filtered on the single status `'a,b'` and returned nothing.
                if (refuseRepeatedQueryParams(req, res, ['status', 'packageId'])) return;
                // [#7678] …and a single well-formed but UNKNOWN `?status=`
                // did the same thing one layer on: the service's contract
                // declares exactly three values, anything else matched no
                // row, and the caller got 200 with an empty list — which
                // reads as "there are no suggestions" rather than "your
                // filter was not a status". The runtime dispatcher's twin of
                // this route had refused it since #4127; this live route
                // never did. Same predicate, imported — not a second copy of
                // the vocabulary.
                const status = req.query?.status ? String(req.query.status) : undefined;
                if (status !== undefined && !isAudienceBindingSuggestionStatus(status)) {
                    // [#7981] Same body as before — emitted through the
                    // shared helper now, so this arm is the reference
                    // point by construction instead of by coincidence.
                    return respondError(
                        res, 400, 'VALIDATION_ERROR',
                        unknownAudienceBindingSuggestionStatusMessage(status),
                    );
                }
                const result = await svc.listAudienceBindingSuggestions(context ?? {}, {
                    status,
                    packageId: req.query?.packageId ? String(req.query.packageId) : undefined,
                });
                res.json({ data: result });
            } catch (err: any) { handleError(err, res, 'SUGGESTION_LIST_FAILED'); }
        },
        metadata: { summary: 'List suggested audience bindings (ADR-0090 D5/D9)', tags: ['security'] },
    });

    // CONFIRM — the deployment-level acceptance; `everyone` is re-derived
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/security/suggested-bindings/:id/confirm`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const result = await svc.confirmAudienceBindingSuggestion(context ?? {}, String(req.params.id));
                res.json({ data: result });
            } catch (err: any) { handleError(err, res, 'SUGGESTION_CONFIRM_FAILED'); }
        },
        metadata: { summary: 'Accept a suggested audience binding for the deployment (everyone carries the set)', tags: ['security'] },
    });

    // DISMISS — declines a pending suggestion, or revokes an accepted one
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/security/suggested-bindings/:id/dismiss`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                const result = await svc.dismissAudienceBindingSuggestion(context ?? {}, String(req.params.id));
                res.json({ data: result });
            } catch (err: any) { handleError(err, res, 'SUGGESTION_DISMISS_FAILED'); }
        },
        metadata: { summary: 'Dismiss a suggested audience binding, or revoke an accepted one', tags: ['security'] },
    });

    // REOPEN — takes a dismissal (a decline or a revoke) back: the row is
    // pending again and grants nothing until confirmed (#27149). The member is
    // OPTIONAL on `ISecurityService`, so a service without it is a 501 naming
    // the door, never a call into `undefined`. Its 500 terminal is the
    // standard `INTERNAL_ERROR`: no family code is registered for it.
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/security/suggested-bindings/:id/reopen`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const svc = await resolveService(environmentId);
                if (!svc) return respond501(res);
                if (typeof svc.reopenAudienceBindingSuggestion !== 'function') {
                    return respondError(
                        res, 501, 'NOT_IMPLEMENTED',
                        "This deployment's security service does not implement re-opening a dismissed " +
                            'audience-binding suggestion, so the dismissal stands.',
                    );
                }
                const result = await svc.reopenAudienceBindingSuggestion(context ?? {}, String(req.params.id));
                res.json({ data: result });
            } catch (err: any) { handleError(err, res, 'INTERNAL_ERROR'); }
        },
        metadata: { summary: 'Re-open a dismissed or revoked suggested audience binding (pending again; nothing granted until accepted)', tags: ['security'] },
    });
}
