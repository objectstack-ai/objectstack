// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 5] The analytics dataset route of `RestServer` —
 * `POST {basePath}/analytics/dataset/query`, the semantic-layer dataset
 * preview/query door — moved out of `rest-server.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerAnalyticsEndpoints` as it stood, re-indented one level
 * and otherwise unedited: the same route, registered at the same position, by
 * the same handler, answering the same bodies. The body's local
 * `resolveService` moved with it, unchanged, and so did the imports only this
 * body read, each with its comment where it had one.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps the private method —
 * the published `dist/*.d.ts` lists its name, docblock and position — and the
 * body is one host literal ({@link AnalyticsRouteHost}) plus
 * `.call(host, basePath)`. A method is handed over as a closure that calls it
 * on the server at call time, so a test double or spy set on the server is
 * still the one the body reaches.
 *
 * Each field was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. The body reads it only for its one
 *   `register` call, which runs while registration runs, and the class's one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - `analyticsServiceProvider` goes as a GETTER. The body's `resolveService`
 *   reads it at REQUEST time, and the field is not `readonly`, so a value
 *   copied at registration could part from it. The getter reads the field the
 *   handler read, when it read it. (`kernelManager` went the same way until
 *   #30011 moved the environment-kernel lookup into the provider itself.)
 *
 * Module-level helpers stay where they were and are imported from the modules
 * `rest-server.ts` imports them from. The one helper declared in
 * `rest-server.ts` itself, `mayReadPendingDrafts` (the draft-read admission
 * that `meta-draft-read-door-census.test.ts` holds to a bare delegation), is
 * exported from there and imported here: one declaration, never a copy. The
 * package entry does not re-export it, so the published surface does not move.
 *
 * ## [#32200] The batch door, and the one judgment both doors share
 *
 * `POST {basePath}/analytics/dataset/query/batch` answers several single-door
 * bodies in one request (`DatasetQueryBatchRequest` → `DatasetQueryBatchResponse`
 * in `@objectstack/spec/api`). What the single door judges about one body now
 * lives in {@link answerDatasetQuery}, which answers `{ status, body }` instead
 * of writing the response: the single door writes that pair unchanged, and the
 * batch door calls it once per query. There is no second copy of the
 * resolution or the admission, so a later change to either moves both doors.
 */

import {
    INTERNAL_ERROR_MESSAGE,
    declaresServerFault,
    demotedDeclaredCode,
    looksLikeInternalErrorLeak,
    resolveThrownHttpError,
    sendError,
    sendOk,
} from '@objectstack/types';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import type { ApiError, DatasetQueryBatchEntry, GetMetaItemRequest } from '@objectstack/spec/api';
import { DATASET_QUERY_BATCH_MAX_QUERIES, DatasetQueryBatchRequestSchema } from '@objectstack/spec/api';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import {
    boundedDeclaredUserMessage,
    classifiedRefusalAnswer,
    declaredServerFaultAnswer,
    sandboxBusinessMessage,
    sandboxFaultAnswer,
} from './error-response.js';
// [#17551] The `POST …/analytics/dataset/query` door parse — the half of the
// analytics family this route never had. See the module header for the
// measurement that decides its shape.
import { datasetSelectionRefusal } from './analytics-selection-door.js';
// [#29156] …and the door parse for the body AROUND `selection`.
import { datasetQueryBodyRefusal } from './analytics-dataset-body-door.js';
import { logError } from './log.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { mayReadPendingDrafts, metaItemPackageBinding, type RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerAnalyticsEndpoints} reads — every
 * one of them, and no other. Each is typed AS the class member (an indexed
 * access on the class), so a change to a member's signature on the class is a
 * change here too, and naming a member the class does not have is a compile
 * error. See the module header for why `analyticsServiceProvider` is a
 * getter.
 */
export interface AnalyticsRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly analyticsServiceProvider: RestServer['analyticsServiceProvider'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    resolveProtocol: RestServer['resolveProtocol'];
    translateMetaItem: RestServer['translateMetaItem'];
}

/**
 * Register the analytics dataset preview/query endpoint —
 * `RestServer#registerAnalyticsEndpoints`' body, called by that method with
 * the server as `this`. The method's own docblock, which the published
 * declaration carries, names the route and its contract.
 */
export function registerAnalyticsEndpoints(this: AnalyticsRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    // The ENVIRONMENT's analytics service — its strategy bridges are bound to
    // the env kernel's own data engine. Serving a tenant's dataset query from
    // the host engine reads the WRONG database and silently aggregates over
    // nothing (the staging "Total Spend: 0 on a populated table" incident).
    //
    // [#30011] The provider resolves the environment's kernel itself now, as
    // its four siblings do, so this asks it for the REQUEST's environment
    // (the shared resolver's answer) and nothing else. The host provider is
    // no longer a fallback: the door answers from the request's environment
    // alone. When the environment's kernel carries no analytics service, or
    // could not be acquired, the answer is the 501 below.
    const resolveService = async (environmentId: string | undefined, req: any) => {
        if (!this.analyticsServiceProvider) return undefined;
        try {
            const envId = await this.resolveRequestEnvironmentId(environmentId, req);
            return await this.analyticsServiceProvider(envId);
        }
        catch { return undefined; }
    };

    this.routeManager.register({
        method: 'POST',
        path: `${basePath}/analytics/dataset/query`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;

                const svc = await resolveService(environmentId, req);
                if (!svc || typeof svc.queryDataset !== 'function') {
                    return res.status(501).json(DATASET_QUERY_NOT_IMPLEMENTED);
                }

                // [#32200] Everything this door judges about ONE body is
                // {@link answerDatasetQuery}, which the batch door below calls
                // once per query: one judgment, never a second copy.
                const answer = await answerDatasetQuery.call(this, req.body ?? {}, { req, environmentId, context, svc });
                // The bare `AnalyticsResult` on a 200, exactly as before the
                // body moved (`res.json(result)`, no status call); a refusal
                // with the status and body the shared judgment chose.
                if (answer.status === 200) return res.json(answer.body);
                return res.status(answer.status).json(answer.body);
            } catch (error: any) {
                const answer = datasetQueryFaultAnswer(error);
                res.status(answer.status).json(answer.body);
            }
        },
        metadata: { summary: 'Run a semantic-layer dataset (preview/query)', tags: ['analytics'] },
    });

    // [#32200] The batch door: several single-door bodies in one request, so a
    // dashboard render sends one POST instead of one per widget. Mounted beside
    // the single door with the same identity, environment and service
    // resolution. Each query is answered by {@link answerDatasetQuery}, the
    // single door's own judgment, as the same caller; this handler adds only
    // what belongs to the batch: its shape, its URL's query string, and the
    // house envelope around one entry per query (`DatasetQueryBatchResponse`).
    //
    // ⛔ A house-envelope door end to end. A refusal that depends on no query
    // (an identity refusal, no analytics service, a fault before any query
    // runs) answers the whole request with the status the single door answers
    // it with, but in `{ success: false, error: { code, message } }` through
    // `sendError`, never the single door's bare bodies.
    this.routeManager.register({
        method: 'POST',
        path: `${basePath}/analytics/dataset/query/batch`,
        handler: async (req: any, wire: any) => {
            // Every refusal written on `res` leaves on the wire in the house
            // error envelope ({@link houseEnvelopeResponse}), so the shared
            // gates below are asked exactly as the single door asks them.
            const res = houseEnvelopeResponse(wire);
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;

                const svc = await resolveService(environmentId, req);
                if (!svc || typeof svc.queryDataset !== 'function') {
                    return res.status(501).json(DATASET_QUERY_NOT_IMPLEMENTED);
                }

                const body = req.body;
                const shape = DatasetQueryBatchRequestSchema.safeParse(body);
                if (!shape.success) {
                    return sendError(res, 400, 'VALIDATION_FAILED', datasetQueryBatchShapeMessage(shape.error.issues));
                }

                // The batch URL's `?preview=` and `?package=` are read ONCE,
                // for every query, as the single door reads its own: a repeated
                // value names no one intent and refuses the whole batch before
                // any query runs. The same gate the single door asks, so the
                // one-element array it unwraps here is unwrapped for every
                // query below. Whether a caller may READ drafts is still judged
                // per query, as that caller, inside {@link answerDatasetQuery}.
                if (refuseRepeatedQueryParams(req, res, ['preview', 'package'])) return;

                // The caller's own objects, never the parse output: the single
                // door judges the body it was sent.
                const queries: unknown[] = body.queries;
                const request: DatasetQueryRequest = { req, environmentId, context, svc };
                const results = await inRequestOrder(queries, DATASET_QUERY_BATCH_CONCURRENCY, async (query) =>
                    datasetQueryBatchEntry(await answerDatasetQuery.call(this, query, request)));
                sendOk(res, { results });
            } catch (error: any) {
                const answer = datasetQueryFaultAnswer(error);
                res.status(answer.status).json(answer.body);
            }
        },
        metadata: { summary: 'Run several semantic-layer dataset queries in one request', tags: ['analytics'] },
    });
}

/**
 * [#32072] A package-scoped resolver's refusal, by class or by shape: `code`
 * `RESOURCE_CONFLICT` with a `refusal` whose `status` is `'refused'`. The same
 * predicate the `/meta` dispatcher reads (`isPackageScopedRefusal` in
 * `@objectstack/runtime`'s `domains/meta.ts`), so one refusal is a 409 at both
 * doors whichever copy of the class threw it.
 */
function isPackageScopedRefusal(e: unknown): e is { code: 'RESOURCE_CONFLICT'; refusal: PackageScopedNameRefusedError['refusal'] } {
    if (e instanceof PackageScopedNameRefusedError) return true;
    const thrown = e as { code?: unknown; refusal?: { status?: unknown } } | null | undefined;
    return thrown?.code === 'RESOURCE_CONFLICT' && thrown.refusal?.status === 'refused';
}

// ─────────────────────────────────────────────────────────────────────────────
// [#32200] One body's judgment, shared by the single door and the batch door
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One dataset-query body's answer: the HTTP status and the body the single
 * door writes for it. A 200's body is the bare `AnalyticsResult`; any other
 * status carries the door's refusal body exactly as the door builds it.
 */
export interface DatasetQueryAnswer {
    readonly status: number;
    readonly body: any;
}

/**
 * The request-level facts every body of one request is judged against: the
 * request (its query string, its locale), its environment, its caller and the
 * environment's analytics service. Resolved once per request by the door.
 */
interface DatasetQueryRequest {
    readonly req: any;
    readonly environmentId: string | undefined;
    readonly context: any;
    readonly svc: any;
}

/**
 * The single door's 501 body, and the batch door's whole-request 501 (in the
 * house envelope there). One sentence for the one condition.
 */
const DATASET_QUERY_NOT_IMPLEMENTED = {
    code: 'NOT_IMPLEMENTED',
    message: 'Analytics dataset query is not available on this deployment (no analytics service with queryDataset).',
} as const;

/**
 * How many of a batch's queries run at once.
 *
 * Bounded, and not 1, on purpose. Before the batch door a dashboard render
 * sent one `POST` per widget and the browser ran them side by side, at most six
 * at a time on an HTTP/1.1 origin. Running a batch one query after another
 * would make one render's latency the SUM of its queries (18 on Chart Gallery),
 * slower than the requests it replaces. Running all of them at once would put
 * up to {@link DATASET_QUERY_BATCH_MAX_QUERIES} executor calls behind one
 * request. Six keeps the parallelism the per-widget requests already had and
 * no more. The answer's order does not depend on it: `results[i]` is written
 * at index `i` ({@link inRequestOrder}).
 */
const DATASET_QUERY_BATCH_CONCURRENCY = 6;

/**
 * Run a gate that WRITES its refusal on a response (`enforceAuth`,
 * `refuseRepeatedQueryParams`) against a recorder, and answer what it wrote:
 * `undefined` when it let the request through, else the status and body it
 * chose, unchanged. This is how a judgment that answers instead of writing
 * asks those gates without a second copy of them.
 */
function writtenAnswer(gate: (recorder: { status(code: number): any; json(body: unknown): any }) => boolean): DatasetQueryAnswer | undefined {
    let status = 200;
    let body: unknown;
    const recorder = {
        status(code: number) { status = code; return recorder; },
        json(written: unknown) { body = written; return recorder; },
    };
    return gate(recorder) ? { status, body } : undefined;
}

/**
 * The batch door's response. A refusal written on it (status 400 or above) by a
 * gate the batch shares with the single door (`enforceAuth`,
 * `refuseRepeatedQueryParams`, the 501, the fault classification) leaves on
 * `wire` in the house error envelope, mapped as an entry's refusal is
 * ({@link sendWholeBatchRefusal}), with the status the gate chose. A body
 * already in the house envelope (`sendOk`, `sendError`) passes through as
 * written. This is what makes the batch a house-envelope door end to end
 * while it asks those gates exactly as the single door does.
 */
function houseEnvelopeResponse(wire: any): { status(code: number): any; json(body: unknown): any } {
    let status = 200;
    const res = {
        status(code: number) { status = code; return res; },
        json(body: unknown) {
            if (status >= 400 && !(isRecord(body) && body.success === false)) sendWholeBatchRefusal(wire, { status, body });
            else wire.status(status).json(body);
            return res;
        },
    };
    return res;
}

/**
 * Map `items` through `run` with at most `limit` calls in flight, and answer
 * the results in the order of `items`, whatever order the calls finish in.
 */
async function inRequestOrder<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            results[index] = await run(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * The sentence of a whole-batch 400. The shape is judged by
 * `DatasetQueryBatchRequestSchema`, the contract's one declaration of it (not a
 * second reading here); this only words its first issue, naming the bound when
 * that is what was exceeded.
 */
function datasetQueryBatchShapeMessage(issues: readonly { code: string; path: readonly PropertyKey[]; message: string }[]): string {
    const issue = issues[0];
    const path = issue?.path ?? [];
    if (issue?.code === 'too_big' && path.length === 1 && path[0] === 'queries') {
        return `body.queries carries more than ${DATASET_QUERY_BATCH_MAX_QUERIES} dataset queries; `
            + `a batch carries at most ${DATASET_QUERY_BATCH_MAX_QUERIES}. Send the rest in another batch. No query was run.`;
    }
    const where = ['body', ...path.map(String)].join('.');
    return `Invalid dataset query batch: ${where}: ${issue?.message ?? 'malformed'}. `
        + 'A batch is `{ queries: [...] }`, 1 to '
        + `${DATASET_QUERY_BATCH_MAX_QUERIES} JSON objects, each one \`POST /analytics/dataset/query\` body. No query was run.`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One batch answer entry (`DatasetQueryBatchEntry`) from the single door's
 * answer to that query: `{ data }` for a 200, else `{ status, error }` with the
 * door's refusal MAPPED into the house error envelope (`ApiErrorSchema`), as
 * the entry schema states. The single door does not answer every refusal in
 * that shape, so each member is read from where the door puts it:
 *
 * - `code`: the member `resolveThrownHttpError` derives, the rule every door
 *   follows. A vocabulary code is kept; a code outside the vocabulary (the
 *   declared-4xx arm relays the thrown code as written) moves to `declaredCode`
 *   and `code` carries the member the status derives; and a refusal with NO
 *   code (a declared or sandboxed 5xx whose producer declared a status only)
 *   takes the member the status derives. A `declaredCode` the door already
 *   wrote (its 5xx arms demote it themselves) is kept as written.
 * - `message`: the door's sentence. Its 5xx arms carry no `message`; the text
 *   they carry under `error` is the outward text, already withheld as the door
 *   withholds it, and that is what `message` takes.
 * - `details`: where the door's refusal has them (the field-addressed
 *   `details.fields[]` of the body and selection doors).
 * - `userMessage`: a member of `ApiErrorSchema`, carried whenever the door's
 *   refusal carries it (its three `markExtra` arms and the classified refusal).
 * - Singular `detail` is LEFT OUT. The door writes it on one refusal, the
 *   400 "Invalid dataset definition.", as the dataset parse error's message
 *   cut at 1000 characters: Zod's JSON rendering of its issues, which the cut
 *   can leave unparseable. That is free text, not field-addressed refusal
 *   data, so it has no place in `details` (whose field-addressed member is
 *   `fields[]`), and `ApiErrorSchema` declares no member for it.
 *
 * The entry's `status` is the door's status, the authority; `httpStatus` is
 * not written.
 */
function datasetQueryBatchEntry(answer: DatasetQueryAnswer): DatasetQueryBatchEntry {
    if (answer.status >= 200 && answer.status < 300) return { data: answer.body };
    return { status: answer.status, error: datasetQueryRefusalError(answer) };
}

/** The `ApiErrorSchema` mapping of one refusal; {@link datasetQueryBatchEntry} says how. */
function datasetQueryRefusalError(answer: DatasetQueryAnswer): ApiError {
    const body = isRecord(answer.body) ? answer.body : {};
    // The nested `{ error: { code, message } }` refusals (`enforceAuth`'s,
    // `refuseRepeatedQueryParams`') carry their members one level down.
    const refusal = isRecord(body.error) ? body.error : body;
    const spelled = typeof refusal.code === 'string' && refusal.code.length > 0 ? refusal.code : undefined;
    const thrown = resolveThrownHttpError({ status: answer.status, ...(spelled !== undefined ? { code: spelled } : {}) }, answer.status);
    const declaredCode = typeof refusal.declaredCode === 'string' ? refusal.declaredCode : demotedDeclaredCode(thrown);
    const message = typeof refusal.message === 'string' ? refusal.message
        : typeof body.error === 'string' ? body.error
        : INTERNAL_ERROR_MESSAGE;
    return {
        code: thrown.code,
        message,
        ...(declaredCode !== undefined ? { declaredCode } : {}),
        ...(isRecord(refusal.details) ? { details: refusal.details } : {}),
        ...(typeof refusal.userMessage === 'string' ? { userMessage: refusal.userMessage } : {}),
    };
}

/**
 * Answer a refusal that depends on no query for the whole batch: the status the
 * single door answers it with, in the house error envelope, mapped exactly as
 * an entry's refusal is ({@link datasetQueryRefusalError}).
 */
function sendWholeBatchRefusal(res: any, answer: DatasetQueryAnswer): void {
    const { code, message, ...extra } = datasetQueryRefusalError(answer);
    sendError(res, answer.status, code, message, extra);
}

/**
 * [#32200] Everything `POST /analytics/dataset/query` judges about ONE body,
 * answered as `{ status, body }` instead of written: the outer-body check, the
 * selection parse, the `?package=` / `?preview=` reads and the per-caller draft
 * admission, the dataset resolution (by package, ADR-0150 D3, with its 409
 * naming the holders), the dataset parse, `queryDataset`, and the
 * classification of anything thrown on the way ({@link datasetQueryFaultAnswer}).
 *
 * The single door writes the answer unchanged, and the batch door calls this
 * once per query and maps each answer into an entry. ⛔ It is the ONE copy of
 * that judgment: a change to the resolve or admission order is made here and
 * moves both doors together. Nothing here reads another query's answer, so one
 * query's refusal never decides which dataset another query runs.
 *
 * The body below is the single door's, moved here unchanged except that each
 * `res.status(x).json(y)` is now `return { status: x, body: y }`.
 */
async function answerDatasetQuery(
    this: AnalyticsRouteHost,
    body: any,
    request: DatasetQueryRequest,
): Promise<DatasetQueryAnswer> {
    const { req, environmentId, context, svc } = request;
    try {
        // [#29156] The OUTER body first: the four keys this handler
        // reads are the only ones it understands, and any other key
        // used to be dropped without a word — a `runtimeFilter` beside
        // `selection` answered 200 with the unfiltered aggregate. The
        // same pass refuses `dataset` beside `datasetName`, where the
        // inline definition used to win silently.
        // {@link datasetQueryBodyRefusal} carries the measurement.
        const bodyRefusal = await datasetQueryBodyRefusal(body);
        if (bodyRefusal) {
            return { status: bodyRefusal.status, body: bodyRefusal.body };
        }
        const selection = body.selection;
        if (!selection || !Array.isArray(selection.measures) || selection.measures.length === 0) {
            return {
                status: 400,
                body: {
                    code: 'VALIDATION_FAILED',
                    message: 'body.selection.measures must be a non-empty array of measure names.',
                },
            };
        }

        // [PR #17548] …and every OTHER member of `selection` had no
        // door at all, so a malformed one travelled into
        // `dataset-executor` and was answered by whatever the face
        // behind it happened to do with it — while the sibling
        // routes (`/analytics/query`, `/analytics/sql`) lift the
        // identical failure to a 400 at the entry. One family, two
        // postures, decided by which door the client knocked on.
        //
        // [#17551, ruled] The parse is the WHOLE selection, against
        // `DatasetSelectionSchema` — the one declaration of this
        // wire shape, authored in `packages/spec` beside the
        // sibling routes' own request body. ⛔ Never the siblings'
        // schema: `selection` is a `DatasetSelection`, which
        // carries no `cube` and has four members of its own, so
        // `AnalyticsQueryRequestSchema` would 400 every real
        // dashboard widget. PR #17548 could only door the seven
        // members whose declarations coincided; the four that were
        // left — `runtimeFilter`, `dateGranularity`, `compareTo`,
        // `totals` — are what this closes. {@link datasetSelectionRefusal}
        // carries both measurements.
        //
        // Validation-only: the caller's `selection` is what reaches
        // `queryDataset` below, never a parse output.
        const selectionRefusal = await datasetSelectionRefusal(selection);
        if (selectionRefusal) {
            return { status: selectionRefusal.status, body: selectionRefusal.body };
        }

        // ADR-0037 P3 — draft data preview: the canvas / preview
        // pages pass the flag so (a) the dataset lookup sees
        // draft-overlaid definitions and (b) the selection runs
        // over the pending seed draft's rows when one exists.
        // [#6877] A repeated `?preview=draft&preview=draft` stopped
        // equalling `'draft'`, so the Studio preview silently ran
        // over PUBLISHED rows and looked like the draft had no data.
        // [#32072] …and `?package=`, the exact qualifier below, for
        // the same reason: a repeated value names no one package.
        //
        // [#32200] The gate writes its refusal on a response; this judgment
        // answers instead of writing, so the gate writes onto a recorder and
        // its status and body are answered unchanged ({@link writtenAnswer}).
        // The batch door asks the same gate over its own URL before any query
        // runs, so for a batch this finds nothing repeated.
        const repeated = writtenAnswer((recorder) => refuseRepeatedQueryParams(req, recorder, ['preview', 'package']));
        if (repeated) return repeated;
        // [#20338] …for a caller who may read drafts: both halves
        // serve unpublished work (a draft definition, a pending
        // seed's rows). Anyone else runs over the published
        // dataset and live rows, as if the flag were absent — a
        // draft-only `datasetName` is this door's own 404 —
        // {@link mayReadPendingDrafts} says why that, and not a refusal.
        const previewDrafts = (body.previewDrafts === true || req.query?.preview === 'draft')
            && mayReadPendingDrafts(context);

        // Resolve the dataset definition: inline draft (Studio
        // preview) or a saved dataset by name.
        let dataset = body.dataset;
        if (!dataset && body.datasetName) {
            const p = await this.resolveProtocol(environmentId, req);
            // [#32072, ADR-0150 D3/D5] The saved dataset is read BY
            // NAME, through the protocol's one by-name read, never
            // picked out of the list. `dataset` is one of the types
            // whose by-name readers consult `(package, name)`
            // (`PACKAGE_SCOPED_READ_TYPES`, objectql), so that read is
            // the package-scoped resolver's:
            //  - a bare name is a caller with no package: the
            //    environment's own item, else the one package holder;
            //    a name two packages hold is refused naming both
            //    (`409 RESOURCE_CONFLICT`). The `list.find` that stood
            //    here served the first one listed;
            //  - `?package=X` is the exact qualifier `/meta` reads
            //    under the same name ({@link metaItemPackageBinding}):
            //    X's dataset, or a refusal naming its holders — never
            //    another package's, and not a dependency closure.
            // With one holder the item is the one the list carried, so
            // the answer does not move (step-0 reading: every saved
            // dataset of the booted showcase, byte for byte).
            //
            // A protocol with no by-name read has no resolver to ask,
            // so the door fails CLOSED: `503`, never a first match
            // (epic ruling 6729233545).
            if (typeof p?.getMetaItem !== 'function') {
                throw Object.assign(
                    new Error(
                        `The dataset "${body.datasetName}" could not be resolved: this deployment's metadata `
                        + 'protocol has no by-name read. This is a server-side fault, not a missing dataset.',
                    ),
                    { code: 'SERVICE_UNAVAILABLE', status: 503, refusal: true },
                );
            }
            const packageId = metaItemPackageBinding(req.query?.package);
            const datasetRequest: GetMetaItemRequest = {
                type: 'dataset',
                name: body.datasetName,
                ...(packageId !== undefined ? { packageId } : {}),
                ...(previewDrafts ? { previewDrafts } : {}),
            };
            // [#31774] A read that FAILED is not a read that came
            // back without the name. The `.catch(() => null)` that
            // stood here turned a metadata-store outage into an
            // empty list, so the door answered `404 "Dataset … not
            // found."`: a dashboard told its user the dataset was
            // gone, and the operator read a 404 instead of an
            // outage. The AI tool `query_dataset` answers the same
            // failed read `503 SERVICE_UNAVAILABLE`, so this door
            // does too.
            //
            // The refusal is THROWN, declared, into this handler's
            // own catch, never answered by hand: its declared-5xx arm
            // (`declaredServerFaultAnswer`, #11718) is the one this
            // door already answers every producer-declared 503 with,
            // and its `logError` runs first, so the store's own text
            // — withheld from the client like every 5xx's (#5437) —
            // reaches the operator on `cause`. `refusal: true` lets
            // the sentence below, which this code wrote for the
            // caller, through that arm.
            //
            // Unchanged: a read that succeeds without the name is the
            // `404` below. [#32072] The resolver's refusal is not a
            // failed read: it is rethrown as thrown, a declared
            // `409 RESOURCE_CONFLICT` naming every candidate, which
            // the catch below answers through its ADR-0112 arm. It is
            // told apart by class OR by shape, the `/meta`
            // dispatcher's predicate ({@link isPackageScopedRefusal}),
            // so a refusal from another copy of `@objectstack/core`
            // is still a 409 and never a 503.
            let read: any;
            try {
                read = await p.getMetaItem(datasetRequest);
            } catch (readError) {
                if (readError instanceof PackageScopedNameRefusedError) throw readError;
                if (isPackageScopedRefusal(readError)) throw new PackageScopedNameRefusedError(readError.refusal);
                throw Object.assign(
                    new Error(
                        `The dataset "${body.datasetName}" could not be resolved: the dataset read failed. `
                        + 'This is a server-side fault, not a missing dataset.',
                    ),
                    { code: 'SERVICE_UNAVAILABLE', status: 503, refusal: true, cause: readError },
                );
            }
            dataset = read?.item;
            if (!dataset) {
                return { status: 404, body: { code: 'NOT_FOUND', message: `Dataset "${body.datasetName}" not found.` } };
            }
            // [#14253] Localize the SAVED definition here, at the
            // metadata boundary, the same way `/meta/:type` does.
            //
            // A dataset's dimension and measure `label`s are drawn
            // on the dashboard — chart axes, legends, the caption
            // under a metric tile — and they get there through the
            // QUERY, not through `/meta/datasets`:
            // `AnalyticsService` copies `dataset.measures[].label`
            // onto `AnalyticsResult.fields[].label` ("for
            // legends/KPIs"). So translating only the metadata read
            // would have closed the door nobody draws through and
            // left the one in the issue's screenshot open — the
            // covered-at-one-door asymmetry this repo keeps paying
            // for. Translating the DEFINITION carries through the
            // existing enrichment untouched, so nothing downstream
            // learns about bundles: the analytics service stays
            // free of i18n, and there is no second resolution path.
            //
            // ⛔ The INLINE branch is deliberately not translated:
            // a Studio preview posts a draft the designer is
            // editing, which carries no saved name to address a
            // bundle entry with, and overwriting a draft's copy
            // would misreport what the designer is about to save.
            dataset = await this.translateMetaItem(req, 'dataset', environmentId, dataset);
        }
        if (!dataset) {
            return { status: 400, body: { code: 'VALIDATION_FAILED', message: 'Provide body.dataset (inline) or body.datasetName.' } };
        }

        // A SERVED document is not a valid input to the schema that
        // produced it: the read path stamps `_diagnostics` on every
        // item `getMetaItems` returns, and since #4001
        // `DatasetSchema` is CLOSED — so the parse below rejected
        // our OWN annotation with `unrecognized_keys`, answering
        // 400 "Invalid dataset definition." for every saved dataset,
        // i.e. every widget on every dataset-bound dashboard. Same
        // shape as the cold-boot flow bind (cloud#971).
        //
        // Stripped on BOTH branches, not just the `datasetName`
        // read: the Studio dataset preview posts its draft INLINE,
        // and that draft is the document the designer GET-loaded —
        // decorations and all. A genuinely hand-authored draft
        // never carries these keys, so the strip is a no-op there.
        dataset = stripReadDecorations(dataset);

        // Validate against the spec schema so a malformed draft
        // yields a clean 400 instead of a runtime throw.
        try {
            const { DatasetSchema } = await import('@objectstack/spec/ui');
            dataset = (DatasetSchema as any).parse(dataset);
        } catch (verr: any) {
            return {
                status: 400,
                body: {
                    code: 'VALIDATION_FAILED',
                    message: 'Invalid dataset definition.',
                    detail: String(verr?.message ?? verr).slice(0, 1000),
                },
            };
        }

        const result = await svc.queryDataset(
            dataset,
            selection,
            context ?? undefined,
            previewDrafts ? { previewDrafts: true } : undefined,
        );
        return { status: 200, body: result };
    } catch (error: any) {
        return datasetQueryFaultAnswer(error);
    }
}

/**
 * [#32200] The single door's classification of a thrown error — its former
 * `catch` block, moved here unchanged except that each write is now returned.
 * {@link answerDatasetQuery} answers its own throws through it, and both doors
 * answer a throw from before any body is judged (identity or service
 * resolution) through it too.
 */
function datasetQueryFaultAnswer(error: any): DatasetQueryAnswer {
    const msg = String(error?.message ?? error ?? '');
    // [#11588] The text addressed to the CALLER, which for a
    // sandboxed hook refusal is the business message rather than
    // the `hook '<name>' threw: Error: …` QuickJS debug wrapper
    // sitting on `.message`. This route builds its envelope by
    // hand and shares no branch with `classifyDataError`'s
    // unwrap door or with `resolveErrorResponse`'s passthrough,
    // so it shipped the wrapper on every hook refusal while the
    // single-row `/data` routes served the author's sentence —
    // one refusal, two wordings, decided by which face caught it.
    // {@link sandboxBusinessMessage} is imported rather than
    // re-derived precisely so a third answer cannot appear here.
    //
    // Deliberately scoped to what the CLIENT reads. `logError`
    // below still receives the whole error, wrapper and all —
    // that is the half the wrapper was written for. And
    // `looksLikeInternalErrorLeak` below still reads the RAW
    // `msg`: feeding it the unwrapped text could only make it
    // withhold LESS, and a leak predicate must never be handed a
    // narrower input than the one it was calibrated on.
    //
    // Neither arm's STATUS moves. ① keeps answering the declared
    // 4xx and ③ keeps answering 500; only the sentence changes.
    //
    // [#11684] …and that last sentence was the defect report
    // for the card below: leaving the status alone left an
    // UNDECLARED sandbox refusal in ③, answering 500 where the
    // `/data` door answers 400 for the identical throw. ①b now
    // sits between the two arms and moves exactly that class.
    // The sentence this line computes is unchanged.
    const clientMsg = sandboxBusinessMessage(error) ?? msg;

    // ── [#12710] The producer's marked sentence, resolved once ─
    // Commit 79c46da90's `userMessage` channel is STATUS- and BRANCH-agnostic
    // by construction: `withDeclaredUserMessage` applies it ONCE at
    // the `/data` door's exit, over whatever envelope classification
    // chose. This door has no such wrapper — it builds ①, ③a and ③b
    // by hand — so the rule was applied at none of them, and one
    // producer's sentence reached the client on `POST /data/:object`
    // and vanished here for the identical throw (measured door to
    // door in `analytics-fault-user-message.test.ts` §3).
    //
    // Resolved ONCE here rather than at each terminal so this door
    // has a single answer to "is there a mark, and how long may it
    // be": {@link boundedDeclaredUserMessage} is that pair
    // (`declaredUserMessage`'s presence answer + #5423's bound)
    // shared with the `/data` door rather than copied beside it,
    // the same way the record-share family's two hand-built exits
    // ask it (#12693).
    //
    // ⛔ Deliberately NOT spread onto ①b below. That arm re-dresses
    // {@link classifiedRefusalAnswer}'s body, which already carries
    // the mark, so a second application there would be one rule
    // applied twice. Scope here is by ARM, not by door.
    //
    // ⛔ And riding it across the FAULT terminals ③a/③b does not
    // re-open #5367/#5437/#5811. Those withhold prose the producer
    // never addressed to the caller — driver text, a crash's
    // `TypeError` — while this field exists on an error only
    // because an author deliberately wrote caller-facing text onto
    // it. The prose stays withheld byte for byte, neither the
    // status nor the `code` moves, and an UNMARKED throw's envelope
    // is byte-identical to before (pinned, §4).
    const marked = boundedDeclaredUserMessage(error);
    const markExtra = marked === undefined ? {} : { userMessage: marked };
    // ── [#5352] ① The ADR-0112 envelope, read FIRST ──────────
    // A thrown error that already carries `code` + a 4xx
    // `status` has ANSWERED the classification question. This
    // route used to discard both and re-derive the answer from
    // the message text below, so every producer that took
    // ADR-0112 seriously was punished for it: analytics'
    // filter refusals (`INVALID_FILTER`/400 — a misspelled
    // operator in a dashboard widget, #3948/#5240/#5325/#5334),
    // the measure source-field gate (`INVALID_FIELD`/400,
    // #4437) and the cube-existence gate (`CUBE_NOT_FOUND`/404,
    // #3867) all landed as `500 ANALYTICS_QUERY_FAILED` — read
    // by the author as "the platform is broken" and by ops
    // alerting as a 5xx. The same mistakes answer 400 on
    // `/data`; one condition must not get two wire shapes
    // because a different face caught it.
    //
    // BOTH halves are required, deliberately. A 4xx status with
    // no code would force this route to invent one, which is
    // the consumer-side leniency ADR-0112 exists to remove — a
    // producer that ships half an envelope has a bug of its own
    // and should be found, not papered over here.
    //
    // 4xx ONLY: a 5xx-status error keeps going through the
    // `ANALYTICS_QUERY_FAILED` envelope below, so an internal
    // fault can never be re-labelled as the caller's fault (and
    // keeps its `logError` line). [#5367] It also has its MESSAGE
    // withheld there — declaring a server fault is declaring that
    // the detail is the operator's, not the caller's.
    const envelopeStatus = typeof error?.status === 'number' ? error.status : undefined;
    const envelopeCode = typeof error?.code === 'string' && error.code.length > 0 ? error.code : undefined;
    if (envelopeStatus !== undefined && envelopeStatus >= 400 && envelopeStatus < 500 && envelopeCode) {
        return { status: envelopeStatus, body: { code: envelopeCode, message: clientMsg.slice(0, 1000), ...markExtra } };
    }
    // ── [#11684] ①b The refusal ① could not read ─────────────
    // ① answers a refusal that declared BOTH halves of the
    // envelope, spelled `status`. Two classified refusals fell
    // past it into ③ and were reported to the caller as server
    // faults:
    //
    //   - **An UNDECLARED sandboxed hook refusal.** A hook body
    //     running `throw new Error('month-end close is in
    //     progress')` — the most common shape an app author
    //     writes — declares no `status` and no `code`, so ①
    //     never opened. Measured: `500 ANALYTICS_QUERY_FAILED`
    //     here against `400` with the same sentence on
    //     `POST /data/:object`, i.e. one hook body, one
    //     `throw`, two statuses decided by whether the caller
    //     hit a dashboard tile or a list view.
    //   - **The `statusCode` spelling** (#7525). ①'s read is
    //     `error.status` alone, and `plugin-approvals`'
    //     lifecycle hooks — plus `runtime`'s
    //     `action-execution.ts` and `metadata-protocol` — spell
    //     it `statusCode`. Same refusal, same declaration, 500.
    //
    // {@link classifiedRefusalAnswer} is the `/data` door's own
    // classification, imported rather than re-derived for the
    // same reason {@link sandboxBusinessMessage} above it is: a
    // third local opinion at this boundary is precisely how the
    // two faces came to disagree. It answers `undefined` for
    // everything ③ still owns — a declared 5xx, a crashed body
    // (#7543), a driver fault, anything unclassified — so ③'s
    // reach is unchanged except for the two shapes named above.
    //
    // ⛔ This is NOT a widening of ①'s both-halves gate. That
    // gate is #5352's ruling for producers that ship half an
    // ADR-0112 envelope, it still stands, and the seam encodes
    // it. What crosses here without a `code` is the SANDBOX
    // limb, where "no code" is not half a declaration: the
    // author declared the condition by reporting it, and
    // `classifyDataError`'s unwrap door has answered that with
    // 400 and the verbatim sentence since it existed
    // (`hook-error-format.dogfood.test.ts`). Nothing is
    // invented — a refusal that declared no code is answered
    // with no code, exactly as `/data` answers it.
    const refusal = classifiedRefusalAnswer(error);
    if (refusal) {
        const { error: refusalText, ...refusalFields } = refusal.body;
        return {
            status: refusal.status,
            body: {
                ...refusalFields,
                message: String(refusalText ?? clientMsg).slice(0, 1000),
            },
        };
    }
    // ── ② … is GONE. The message-sniffing list is retired ────
    // [#5367] `/analytics/dataset/query` used to classify six
    // error families by matching hardcoded substrings of their
    // message text, which made their HTTP status a property of
    // their WORDING: rephrasing a message — no logic change, no
    // test red, no gate red — moved the error from 400 to 500.
    // Prime Directive #12 tolerates an accommodation like that
    // only while it is declared, loud, tested AND removable on a
    // schedule; #5352 shipped the first three and #5367 was the
    // schedule. It is now paid off in full:
    //
    //   - FIVE families throw `datasetInvalidError`
    //     (`DATASET_INVALID` / 400) from `service-analytics`'s
    //     `dataset-refusal.ts` and are served by ① —
    //     `dataset-compiler` (undeclared relationship path,
    //     unsupported aggregate), `dataset-executor` (order key,
    //     totals grouping), `native-sql-strategy` (join outside
    //     the allowlist).
    //   - The SIXTH — `read-scope-sql`'s ten fail-closed RLS
    //     lowering refusals — was re-judged by the maintainer on
    //     2026-08-06 and is now `READ_SCOPE_COMPILE_FAILED` /
    //     **500**. Its inputs are an admin-authored policy and a
    //     compiler-generated join alias, never the caller's, so
    //     `400 DATASET_INVALID` both misattributed the fault and
    //     echoed RLS policy field names back to the tenant. A
    //     declared 5xx is 4xx-only-① 's business no longer, so it
    //     falls to ③ BY DECLARATION.
    //
    // ⛔ Do not reintroduce a message test here. Give the refusal
    // a `code`/`status` and the branches above and below serve it.
    //
    // ── ③ The 500 — and it does not ship internals ───────────
    // [#5520] This route built its 5xx body by hand and echoed
    // the message verbatim, so a driver error arrived here with
    // the generated statement prefixed to it (knex's format is
    // `<sql> - <cause>`) and the caller received the physical
    // table and column names of the query:
    //
    //   {"code":"ANALYTICS_QUERY_FAILED","error":"SELECT bogus_dim AS
    //    \"bogus_dim\", COUNT(*) … FROM \"crm_account\" GROUP BY
    //    bogus_dim - no such column: bogus_dim"}
    //
    // The SIBLING analytics face never did: `/analytics/query`
    // exits through `dispatcher-plugin.errorResponseBase`, which
    // applies `looksLikeInternalErrorLeak` to any >=500 message
    // (#3867) — which is why the same mistake read "Internal
    // server error" there and dumped SQL here. One boundary
    // property, one shared predicate; this is the application
    // that was missing, not a new rule. Classification is
    // untouched (still `500 ANALYTICS_QUERY_FAILED`), and the
    // full text still reaches the operator through `logError`
    // immediately below — the log line is now the only copy.
    //
    // [#5367] `looksLikeInternalErrorLeak` is a heuristic over
    // SQL/driver PHRASING, and the read-scope refusals do not
    // speak it: measured, all ten messages
    // (`[read-scope-sql] unsafe field identifier "…"`, …) return
    // FALSE from it, so retiring ② alone would have moved the RLS
    // policy content from a 400 body to a 500 body instead of
    // out of the response. Widening the heuristic to recognise
    // them would be more message sniffing — the very thing #5367
    // removes. So the withhold is DECLARED instead: a producer
    // that says `status >= 500` with a `code` has declared a
    // server fault, and a server fault's detail belongs in the
    // log, not in the caller's body. That is a structural rule
    // over the ADR-0112 envelope, not a guess about prose, and it
    // leaves #5667's tiering intact for UNDECLARED 5xx errors —
    // a bare `Error` still goes through the heuristic, so a
    // self-authored fault ("no strategy can handle query …")
    // stays readable.
    //
    // [#5811] That rule is no longer written here. The sibling
    // face — `/analytics/query`, exiting through
    // `dispatcher-plugin.errorResponseBase` — had the identical
    // leak (measured: 11/11 read-scope messages echoed verbatim),
    // so the criterion was promoted to `declaresServerFault` in
    // `@objectstack/types`, beside the heuristic it complements,
    // and both boundaries read it. #5808 deliberately left it
    // in-line while there was one consumer; this is the second.
    // The verdict here is unchanged in every case — the predicate
    // is the same `status >= 500` + non-empty `code` test, reading
    // the same two fields ① derives `envelopeStatus`/`envelopeCode`
    // from.
    logError('[REST] Analytics dataset query error:', error);
    // ── [#11718] ③a A DECLARED 5xx is RELAYED, not collapsed ──
    // Measured door-to-door: one producer-declared
    // `{ status: 503, code: 'SERVICE_UNAVAILABLE' }` answered
    // `503 SERVICE_UNAVAILABLE` on `POST /data/:object` and
    // `500 ANALYTICS_QUERY_FAILED` here. #5582's argument is
    // that `502`/`503` are `isExpectedDataStatus` LIFECYCLE
    // outcomes — a proxy retries them and alerts differently —
    // so collapsing them onto `500` destroys the declaration.
    // That ruling landed one door over and never reached this
    // one, because this arm built its 5xx body by hand.
    //
    // ⛔ This does NOT re-open #5352/#5367/#5811. Those rule the
    // PROSE, and the prose is still withheld — byte-identical,
    // `INTERNAL_ERROR_MESSAGE`, from the same shared arm — and
    // the full text still reaches the operator through the
    // `logError` line ABOVE this branch, which is deliberately
    // placed first so a relayed status cannot buy a producer its
    // way past the log. What moves is the CLASSIFICATION the
    // producer declared and this route was overwriting.
    //
    // {@link declaredServerFaultAnswer} is `/data`'s own arm,
    // imported for the reason {@link classifiedRefusalAnswer}
    // above it is: a third local opinion at this boundary is how
    // the two faces came to disagree in the first place. The
    // SIBLING analytics face already agreed with `/data` —
    // `/analytics/query` relays both halves through
    // `dispatcher-plugin.errorResponseBase` (measured: a
    // read-scope refusal reaches the client as `500`
    // `READ_SCOPE_COMPILE_FAILED`, pinned in
    // `analytics-query-read-scope-withhold.test.ts`) — so this
    // face was the only one of three collapsing the declaration.
    //
    // ⚠️ Consequence, deliberate and named: a declared 5xx now
    // carries the PRODUCER's code, so `read-scope-sql`'s ten
    // fail-closed refusals answer `500 READ_SCOPE_COMPILE_FAILED`
    // here instead of `500 ANALYTICS_QUERY_FAILED`. Their
    // 2026-08-06 ruling is untouched in substance — a SERVER
    // fault, `500`, policy content withheld — and the code they
    // now carry is the one they declare and the one the sibling
    // face has always shipped. `ANALYTICS_QUERY_FAILED` remains
    // this route's answer for an UNDECLARED fault, below.
    //
    // [#22764] A sandboxed body the doors answer as a FAULT is
    // asked first, for the order the doors ask it in: a body
    // that CRASHED is a fault whatever status it declared
    // (#17273), so it must not reach the declared-5xx relay, and
    // it never reaches ③b, whose `clientMsg` is the QuickJS
    // wrapper around the native error text for a crash (the
    // business read declines one). A sandboxed refusal that
    // declared a 5xx answers here too, the same bytes ③a gives
    // it: one classification, `/data`'s.
    const declaredFault = sandboxFaultAnswer(error) ?? declaredServerFaultAnswer(error);
    if (declaredFault) {
        return { status: declaredFault.status, body: { ...declaredFault.body, ...markExtra } };
    }
    // ── ③b The generic 500, for a fault nobody declared ──────
    // `declaresServerFault` is kept in the withhold test rather
    // than dropped as dead: it reads `error.status` alone and is
    // not bounded above, so a nonsense `status: 700` with a code
    // still reaches here (`declaredHttpStatus` requires < 600)
    // and must keep the withhold it has had since #5367.
    const outward = declaresServerFault(error) || looksLikeInternalErrorLeak(msg)
        ? INTERNAL_ERROR_MESSAGE
        : clientMsg.slice(0, 500);
    return { status: 500, body: { code: 'ANALYTICS_QUERY_FAILED', error: outward, ...markExtra } };
}