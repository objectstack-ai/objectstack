// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 1] The data-action routes of `RestServer` — record clone, the
 * synchronous and asynchronous import doors, the import-job reads, undo and
 * cancel, and the streaming export — moved out of `rest-server.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerDataActionEndpoints` as it stood, re-indented one level
 * and otherwise unedited: the same routes, registered in the same order, by
 * the same handlers, answering the same bodies.
 *
 * ## How the moved body reaches the class — the shape every later slice repeats
 *
 * - The class keeps its private `registerDataActionEndpoints`, with its name,
 *   docblock and position unchanged: the published `dist/*.d.ts` lists all
 *   three. Its body is now one object literal and one call —
 *   `registerDataActionEndpoints.call(host, basePath)`.
 * - That literal is a {@link DataActionRouteHost}: EVERY class member the body
 *   reads, and no other. The body still says `this.…`, and `this` is the
 *   literal. No member of `RestServer` becomes public or protected, and no
 *   cast is involved: the class reads each private member inside its own body
 *   to build the literal, so `tsc` checks every entry against the member it
 *   forwards (and `noUnusedLocals` still sees a member that only this body
 *   reads as read).
 * - A METHOD is handed over as a closure that calls it on the server at call
 *   time (`(...a) => this.member(...a)`), never as a bound or copied
 *   function. A method replaced on the instance or its prototype after the
 *   routes are registered — a test double, a spy — is therefore still the one
 *   the body reaches, exactly as before the move.
 * - A FIELD is handed over by value when the literal is built. That equals the
 *   live read it replaces only because every field this body reads is either
 *   `readonly` (`cancelledImportJobs`) or read only while registration runs
 *   (`config`, `routeManager`). A field read at REQUEST time that can be
 *   reassigned would need a getter instead; a later slice checks that per
 *   field rather than inheriting this sentence.
 * - Module-level helpers stay in `rest-server.ts` and are imported from it.
 *   They are exported there for this module only; the package entry does not
 *   re-export them, so the published surface does not move. The one exception
 *   is the `ServerScopedDataRequest` type, which moved HERE instead: exporting
 *   a type alias from `rest-server.ts` was measured to change the published
 *   declaration file, where exporting a function or a constant does not.
 */

import type {
    FindDataRequest,
    CreateDataRequest,
    UpdateDataRequest,
    DeleteDataRequest,
} from '@objectstack/spec/api';
// [#20061] The DECLARED request schema the import-job list door parses its
// numeric parameters through — see `readDeclaredQueryNumber` in `rest-server.ts`.
import { ListImportJobsRequestSchema } from '@objectstack/spec/api';
// The async-import row ceiling has exactly one definition, in the spec, whose
// TSDoc is its public statement (commit a92b1793c). rest is the only enforcer, so it reads
// that export rather than re-declaring the literal beside a "mirrors spec" comment.
import { IMPORT_JOB_MAX_ROWS } from '@objectstack/spec/api';
import { runImport } from '@objectstack/core';
import {
    buildFieldMetaMap,
    referenceFieldNames,
    headerLabel,
    formatRowCells,
    formatRowForJson,
    cellFontColor,
    exportContentDisposition,
    type ExportFieldMeta,
} from './export-format.js';
import { prepareImportRequest } from './import-prepare.js';
import { readTemplateMode } from './import-template.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { handleRouteError } from './error-response.js';
import { logError } from './log.js';
import {
    DATA_EXPORT_PARAMS,
    IMPORT_JOB_OBJECT,
    IMPORT_JOB_UNDO_MAX_ROWS,
    UNDECLARED_WHOLE_NUMBER_PARAM,
    capImportResults,
    createXlsxStream,
    importJobToProgress,
    importJobToSummary,
    importJobUndoable,
    newImportJobId,
    parseUndoLog,
    readDeclaredQueryNumber,
    rowsToCsv,
    type RestServer,
} from './rest-server.js';

// [#23050 slice 1] Moved here from `rest-server.ts`, verbatim, because this module is
// the first one outside that file to need it: exporting it from there changed the
// published `dist/*.d.ts`. The CRUD, form and batch doors still in `rest-server.ts`
// import it from here.
/**
 * [#15866] The DATA doors' sibling of {@link TransportScopedMetaRequest}, and
 * the reason it is a SECOND alias rather than a widening of the first: the data
 * routes layer on TWO server-side members, and only one of them is the meta
 * doors' transport key.
 *
 *   - `environmentId` — identical to the meta case and covered by the same
 *     ruling (2026-08-18, commit 2a29caa53): `resolveProtocol(environmentId)` picks the
 *     target kernel BEFORE the call, `@objectstack/metadata-protocol`'s data
 *     methods never read it off the request, and `protocol.zod.ts` records the
 *     exclusion schema-side. The doors still spread it (long-standing wire
 *     shape), so it is declared here rather than smuggled past the compiler.
 *   - `context` — the SERVER-DERIVED execution context from
 *     {@link RestServer.resolveExecCtx}. The implementation genuinely reads it
 *     (`findData`/`getData`/`createData`/`updateData`/`deleteData` all declare
 *     `context?: any` and forward it so the RBAC/RLS middleware can enforce),
 *     so unlike `environmentId` it IS consumed — but it still must not join the
 *     request schema, because that schema is the catalog's published
 *     `requestSchema` and a CALLER-supplied `context` is a privilege escalation:
 *     `metadata-protocol.findData` deletes any inbound `context` unconditionally
 *     for exactly that reason (`if (opCtx.context?.isSystem) return next()`
 *     skips the whole RLS/FLS/CRUD chain). Declared-here is what keeps it
 *     server-only AND compiled.
 *
 * ⛔ Never add a third member here to make a literal fit. A key a caller may
 * send belongs in the spec schema; a key the door invents belongs in neither.
 * What this buys is the guard #15866 was filed for: a field ADDED to
 * `DeleteDataRequestSchema` / `UpdateDataRequestSchema` (and their siblings)
 * as REQUIRED now reddens this file at build, naming the door that would
 * otherwise have gone on not sending it.
 *
 * ⚠️ Scope of the restored check, stated so it is not overread: these handlers
 * declare `req: any`, so every key sourced from `req` is `any` on the way in.
 * What the compiler regains here is the KEY SET — an undeclared member (TS2353)
 * and a missing required member (TS2739/TS2741) — not the value types of keys
 * read off the request bag.
 *
 * ⭐ [#16337] The one slot this alias could NOT cover is now covered too, and
 * the helper that covered for it is gone. #15866 left three server-built
 * `findData` literals — the import-job listing, the export chunk loop and the
 * public reference picker — speaking the UNDECLARED wire dialect (`$filter`,
 * `$top`, `$skip`, `$orderby`, `$expand`, `filters`, `select`, `sort`) and
 * routed them through a `wireDialectQuery` helper that cast the `query` member
 * to `FindDataRequest['query']`. All three now build the CANONICAL QueryAST
 * (`object`, `where`, `orderBy`, `limit`, `offset`, `fields`, `expand`), so the
 * `query` slot compiles against the declared contract like every other member
 * and the helper has been retired with this card.
 *
 * ⚠️ The rewrite is a spelling change ONLY, and that is measurable rather than
 * asserted: `@objectstack/metadata-protocol`'s `findData` folds every alias
 * spelling onto the canonical key by the spec's own table
 * (`RPC_QUERY_ALIAS_SLOTS`) and moves the value verbatim, so both dialects
 * reach `engine.find` as the same option bag. `rest-server-canonical-query-ast
 * .test.ts` drives the before/after pairs through the real normalizer and
 * asserts that equality, so a future edit that changes the option bag while
 * still compiling reddens there.
 *
 * ⛔ Server-built means server-built: the wire aliases stay accepted at the
 * HTTP door for CALLERS. Declaring them there is #16066's spec half and is not
 * this file's business.
 */
export type ServerScopedDataRequest<R> = R & { environmentId?: string; context?: unknown };

/**
 * The `RestServer` members {@link registerDataActionEndpoints} reads — every
 * one of them, and no other. Each is typed AS the class member (an indexed
 * access on the class), so a change to a member's signature on the class is a
 * change here too, and naming a member the class does not have is a compile
 * error. See the module header for why fields and methods are handed over
 * differently.
 */
export interface DataActionRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    readonly cancelledImportJobs: RestServer['cancelledImportJobs'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    enforceApiAccess: RestServer['enforceApiAccess'];
    enforceImportTemplateGates: RestServer['enforceImportTemplateGates'];
    enforceExportPermission: RestServer['enforceExportPermission'];
    translateMetaItem: RestServer['translateMetaItem'];
    resolveMessageTranslator: RestServer['resolveMessageTranslator'];
    resolveSecurityService: RestServer['resolveSecurityService'];
    answerImportTemplate: RestServer['answerImportTemplate'];
}

/**
 * Register object-specific action endpoints that don't fit the generic CRUD
 * shape — `RestServer#registerDataActionEndpoints`' body, called by that method
 * with the server as `this`. The method's own docblock, which the published
 * declaration carries, describes the routes.
 */
export function registerDataActionEndpoints(this: DataActionRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    const { crud } = this.config;
    const dataPath = `${basePath}${crud.dataPrefix}`;

    // POST /data/:object/:id/clone — duplicate a record (gated by the
    // object's `enable.clone` capability, default on). Optional JSON body
    // `{ overrides?: {...} }` (or a bare field map) is applied on top of
    // the copied values, e.g. to set a new name or clear a unique field.
    // Distinct path segment (`/clone`) keeps it clear of the greedy
    // `/data/:object/:id` matchers.
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/:object/:id/clone`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (await this.enforceApiAccess(req, res, p, environmentId, 'create')) return;
                const cloneData = (p as any).cloneData;
                if (typeof cloneData !== 'function') {
                    res.status(501).json({ code: 'NOT_IMPLEMENTED', error: 'Clone not supported by this protocol' });
                    return;
                }
                const body = req.body ?? {};
                // Accept both `{ overrides: {...} }` and a bare field map so
                // callers can POST overrides directly without nesting.
                const overrides = (body && typeof body === 'object' && 'overrides' in body)
                    ? body.overrides
                    : body;
                const result = await cloneData.call(p, {
                    object: req.params.object,
                    id: req.params.id,
                    ...(overrides && typeof overrides === 'object' ? { overrides } : {}),
                    ...(environmentId ? { environmentId } : {}),
                    ...(context ? { context } : {}),
                });
                res.status(201).json(result);
            } catch (error: any) {
                // Clone's domain errors (CLONE_DISABLED/RECORD_NOT_FOUND)
                // carry an explicit `.status`; `handleRouteError` resolves
                // that passthrough itself and logs only genuine faults.
                handleRouteError(res, error, req.params?.object);
            }
        },
        metadata: {
            summary: 'Clone a record (gated by enable.clone)',
            tags: ['data', 'clone'],
        },
    });

    // POST /data/:object/import  — bulk CSV/JSON ingestion (M10.9)
    //
    // Body shapes:
    //   { format: 'csv', csv: '...header,row,...', dryRun?: boolean, mapping?: {<csvCol>:<field>} }
    //   { format: 'json', rows: [...], dryRun?: boolean }
    //
    // Returns per-row outcome so a UI can present an import report.
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/:object/import`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const objectName = String(req.params.object || '');
                if (!objectName) {
                    res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                    return;
                }
                if (await this.enforceApiAccess(req, res, p, environmentId, 'import')) return;
                const body = req.body ?? {};

                // Parse + validate the payload (shared with the async job route).
                // The synchronous path caps at 5k rows; larger files must use the
                // async import-job endpoint.
                const prep = await prepareImportRequest(body, {
                    p, objectName, environmentId, maxRows: 5000,
                    // Accept locale-translated option labels (what the localized
                    // export / import template contain) as select-cell synonyms.
                    localizeSchema: (schema: any) => this.translateMetaItem(req, 'object', environmentId, schema),
                });
                if (!prep.ok) {
                    if (prep.status === 413) prep.error += ' Use an async import job for larger files.';
                    res.status(prep.status).json({ code: prep.code, error: prep.error });
                    return;
                }
                const { rows, writeMode, dryRun } = prep.prepared;

                // [#3391] Import gate — stage 2 (precise). Stage 1 above is a
                // coarse `create ∨ update` check that 405s fully-closed objects
                // BEFORE the (potentially large) CSV parse. Now that the write
                // mode is known, re-gate precisely: insert→create, update→update,
                // upsert→create∧update. Catches e.g. an object that grants only
                // `create` receiving an update-mode import.
                if (await this.enforceApiAccess(req, res, p, environmentId, 'import', { writeMode })) return;

                // Delegate the per-row coercion + upsert loop to the shared
                // runner (also used by the async import-job worker).
                const summary = await runImport({
                    p, objectName, environmentId, context, ...prep.prepared,
                    // #3957 — lets the row report resolve a deployment's
                    // `validation.field.*` message overrides.
                    translate: await this.resolveMessageTranslator(environmentId, req),
                });

                res.json({
                    object: objectName,
                    dryRun,
                    writeMode,
                    total: rows.length,
                    ok: summary.ok,
                    errors: summary.errors,
                    created: summary.created,
                    updated: summary.updated,
                    skipped: summary.skipped,
                    results: summary.results,
                });
            } catch (error: any) {
                handleRouteError(res, error, String(req.params?.object || ''));
            }
        },
        metadata: {
            summary: 'Bulk-import rows into an object (CSV or JSON, with optional dry-run)',
            tags: ['data', 'import'],
        },
    });

    // ── Asynchronous import jobs (P1) ──────────────────────────────────
    //
    // For files too large for the synchronous route (up to 50k rows), the
    // client POSTs the whole payload once; the server persists a
    // `sys_import_job`, responds immediately with a jobId, then processes
    // the batch in the background — updating progress on the job row as it
    // streams. Callers poll progress/results and list history. These routes
    // are registered inside registerDataActionEndpoints (before the greedy
    // CRUD `:object/:id`), so the literal `import/jobs` segments win.

    // Shared loader: fetch one job row by id. Used by the read routes, the
    // cancel route, and the background worker's durable cancellation checks.
    const loadImportJob = async (p: any, jobId: string, environmentId?: string, context?: any): Promise<any | undefined> => {
        // [#16337] The FOURTH server-built `findData` literal in this file,
        // and the one the card's three did not name — because nothing could
        // see it: `p` is `any`, so this call was type-checked by nothing at
        // all and its `$filter` / `$top` wire spellings cost no diagnostic.
        // Annotating the literal is what puts it back under the same
        // compiler check as its three siblings; canonicalising it is the
        // same mechanical rewrite (`$filter`→`where`, `$top`→`limit`).
        const jobLoadRequest: ServerScopedDataRequest<FindDataRequest> = {
            object: IMPORT_JOB_OBJECT,
            query: { object: IMPORT_JOB_OBJECT, where: { id: jobId }, limit: 1 },
            ...(environmentId ? { environmentId } : {}),
            ...(context ? { context } : {}),
        };
        const r = await p.findData(jobLoadRequest);
        const rows = Array.isArray(r?.records) ? r.records
            : Array.isArray(r?.data) ? r.data
                : Array.isArray(r?.rows) ? r.rows
                    : Array.isArray(r) ? r : [];
        return rows[0];
    };

    // POST /data/:object/import/jobs — create an async import job.
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/:object/import/jobs`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const objectName = String(req.params.object || '');
                if (!objectName) {
                    res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                    return;
                }
                if (await this.enforceApiAccess(req, res, p, environmentId, 'import')) return;

                const prep = await prepareImportRequest(req.body ?? {}, {
                    p, objectName, environmentId, maxRows: IMPORT_JOB_MAX_ROWS,
                    // Same round-trip i18n synonyms as the synchronous route.
                    localizeSchema: (schema: any) => this.translateMetaItem(req, 'object', environmentId, schema),
                });
                if (!prep.ok) {
                    if (prep.status === 413) prep.error += ` This is the async import ceiling; split the file into batches of ${IMPORT_JOB_MAX_ROWS}.`;
                    res.status(prep.status).json({ code: prep.code, error: prep.error });
                    return;
                }
                const prepared = prep.prepared;

                // [#3391] Import gate — stage 2 (precise), see the synchronous
                // route: now that writeMode is resolved, re-gate precisely
                // (insert→create, update→update, upsert→create∧update).
                if (await this.enforceApiAccess(req, res, p, environmentId, 'import', { writeMode: prepared.writeMode })) return;

                const jobId = newImportJobId();
                const createdAt = new Date().toISOString();
                const createdBy = String((context as any)?.userId ?? (context as any)?.user?.id ?? '') || undefined;
                const jobRow: Record<string, any> = {
                    id: jobId,
                    object_name: objectName,
                    status: 'pending',
                    total_rows: prepared.rows.length,
                    processed_rows: 0,
                    created_count: 0,
                    updated_count: 0,
                    skipped_count: 0,
                    error_count: 0,
                    write_mode: prepared.writeMode,
                    dry_run: prepared.dryRun,
                    run_automations: prepared.runAutomations,
                    treat_as_historical: prepared.treatAsHistorical,
                    created_at: createdAt,
                    ...(createdBy ? { created_by: createdBy } : {}),
                };

                // Resolved NOW, while the request is still alive: the worker
                // below runs after the 201 response, when `req` (and its
                // headers) are no longer safe to read (#3957).
                const messageTranslator = await this.resolveMessageTranslator(environmentId, req);

                try {
                    // [ADR-0103] sys_import_job rows are engine-owned — the import
                    // worker owns their lifecycle, and the object is locked to
                    // ['get','list']. Persist system-elevated so the engine-owned
                    // write guard admits it; attribution is preserved because
                    // `created_by` is stamped explicitly on the row above.
                    const jobCreateRequest: ServerScopedDataRequest<CreateDataRequest> = { object: IMPORT_JOB_OBJECT, data: jobRow, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) };
                    await p.createData(jobCreateRequest);
                } catch (err: any) {
                    logError('[REST] Failed to persist import job:', err);
                    res.status(500).json({ code: 'IMPORT_JOB_CREATE_FAILED', error: 'Could not create import job' });
                    return;
                }

                // Respond immediately; process in the background.
                res.status(201).json({ jobId, object: objectName, status: 'pending', total: prepared.rows.length, createdAt });

                // Background worker. Fire-and-forget: it owns its own error
                // handling and persists terminal state to the job row.
                const patch = async (data: Record<string, any>) => {
                    try {
                        // [ADR-0103] engine-owned
                        const jobPatchRequest: ServerScopedDataRequest<UpdateDataRequest> = { object: IMPORT_JOB_OBJECT, id: jobId, data, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) };
                        await p.updateData(jobPatchRequest);
                    } catch (err) {
                        logError('[REST] import job progress write failed:', err);
                    }
                };
                // Record undo instructions for small non-dry-run jobs so the
                // import can be logically rolled back later.
                const captureUndo = !prepared.dryRun && prepared.rows.length <= IMPORT_JOB_UNDO_MAX_ROWS;
                void (async () => {
                    // Cancelled while still pending? Don't start (and don't let
                    // the 'running' patch below overwrite the durable 'cancelled').
                    if (this.cancelledImportJobs.has(jobId)) {
                        this.cancelledImportJobs.delete(jobId);
                        await patch({ status: 'cancelled', completed_at: new Date().toISOString() });
                        return;
                    }
                    await patch({ status: 'running', started_at: new Date().toISOString() });
                    try {
                        const summary = await runImport({
                            p, objectName, environmentId, context, ...prepared,
                            translate: messageTranslator,
                            captureUndo,
                            progressEvery: 200,
                            onProgress: (pr) => patch({
                                processed_rows: pr.processed,
                                created_count: pr.created,
                                updated_count: pr.updated,
                                skipped_count: pr.skipped,
                                error_count: pr.errors,
                            }),
                            shouldCancel: async () => {
                                if (this.cancelledImportJobs.has(jobId)) return true;
                                // Durable fallback: the cancel route also writes
                                // status='cancelled' to the job row, so a cancel
                                // accepted by another process (or after a restart
                                // dropped the in-memory flag) still stops the worker.
                                try {
                                    const row = await loadImportJob(p, jobId, environmentId, context);
                                    return String(row?.status ?? '') === 'cancelled';
                                } catch { return false; }
                            },
                        });
                        // A cancel that lands after the last checkpoint must still
                        // win the terminal state: the cancel route already marked
                        // the durable row 'cancelled', and a late 'succeeded' here
                        // would silently overwrite it (framework#2824). Counts stay
                        // truthful either way — they reflect what was written.
                        let finalStatus = summary.cancelled ? 'cancelled' : 'succeeded';
                        if (finalStatus === 'succeeded' && this.cancelledImportJobs.has(jobId)) finalStatus = 'cancelled';
                        if (finalStatus === 'succeeded') {
                            try {
                                const row = await loadImportJob(p, jobId, environmentId, context);
                                if (String(row?.status ?? '') === 'cancelled') finalStatus = 'cancelled';
                            } catch { /* keep succeeded */ }
                        }
                        await patch({
                            status: finalStatus,
                            processed_rows: summary.processed,
                            created_count: summary.created,
                            updated_count: summary.updated,
                            skipped_count: summary.skipped,
                            error_count: summary.errors,
                            results: capImportResults(summary.results),
                            completed_at: new Date().toISOString(),
                            ...(summary.undoLog ? { undo_log: summary.undoLog } : {}),
                        });
                    } catch (err: any) {
                        await patch({
                            status: 'failed',
                            error: String(err?.message ?? err).slice(0, 1000),
                            completed_at: new Date().toISOString(),
                        });
                    } finally {
                        this.cancelledImportJobs.delete(jobId);
                    }
                })();
            } catch (error: any) {
                handleRouteError(res, error, String(req.params?.object || ''));
            }
        },
        metadata: {
            summary: 'Create an asynchronous import job (large files, up to 50k rows)',
            tags: ['data', 'import'],
        },
    });

    // POST /data/import/jobs/:jobId/cancel — request cancellation.
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/import/jobs/:jobId/cancel`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const jobId = String(req.params.jobId || '');
                const row = await loadImportJob(p, jobId, environmentId, context);
                if (!row) {
                    res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                    return;
                }
                const status = String(row.status ?? '');
                if (status === 'pending' || status === 'running') {
                    // Signal the in-process worker and mark the durable row.
                    this.cancelledImportJobs.add(jobId);
                    try {
                        // [ADR-0103] engine-owned
                        const jobCancelRequest: ServerScopedDataRequest<UpdateDataRequest> = { object: IMPORT_JOB_OBJECT, id: jobId, data: { status: 'cancelled', completed_at: new Date().toISOString() }, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) };
                        await p.updateData(jobCancelRequest);
                    } catch { /* worker will still stop via the in-memory flag */ }
                }
                res.json({ success: true });
            } catch (error: any) {
                handleRouteError(res, error, '');
            }
        },
        metadata: { summary: 'Cancel an in-flight import job', tags: ['data', 'import'] },
    });

    // POST /data/import/jobs/:jobId/undo — logical rollback of a finished
    // job: delete the records it created and restore the fields it updated
    // to their pre-import values (from the captured undo log).
    this.routeManager.register({
        method: 'POST',
        path: `${dataPath}/import/jobs/:jobId/undo`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const jobId = String(req.params.jobId || '');
                const row = await loadImportJob(p, jobId, environmentId, context);
                if (!row) {
                    res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                    return;
                }
                if (row.reverted_at) {
                    res.status(409).json({ code: 'ALREADY_REVERTED', error: 'This import has already been undone' });
                    return;
                }
                if (!importJobUndoable(row)) {
                    res.status(422).json({ code: 'NOT_UNDOABLE', error: 'This import cannot be undone (too large, still running, or nothing was written)' });
                    return;
                }
                const objectName = String(row.object_name ?? '');
                const log = parseUndoLog(row.undo_log)!;
                // Undo automations too: reversing writes shouldn't re-fire triggers.
                // Skip the state machine as well (#3479): restoring a prior snapshot
                // re-writes the row's earlier state, which need not be a legal
                // transition from where it is now — an undo reinstates an established
                // fact, it does not walk the FSM.
                //
                // For a historical import (#3493/#3549), the undo write must mirror
                // the import's own write context: carry `preserveAudit` so restoring
                // `u.before` re-writes the captured `updated_at`/`updated_by` (and any
                // business `readonly` fields in the snapshot) verbatim, rather than
                // stamping-now / stripping them. Without this, undoing a historical
                // import would silently rewrite the audit timeline the import took
                // pains to preserve. A normal import keeps the default (stamp/strip).
                const writeCtx = {
                    ...(context ?? {}),
                    skipAutomations: true,
                    skipStateMachine: true,
                    ...(row.treat_as_historical ? { preserveAudit: true } : {}),
                };
                let deleted = 0, restored = 0, failed = 0;

                // Delete created records first (they didn't exist before).
                for (const id of log.created) {
                    try {
                        const undoDeleteRequest: ServerScopedDataRequest<DeleteDataRequest> = { object: objectName, id, context: writeCtx, ...(environmentId ? { environmentId } : {}) };
                        await p.deleteData(undoDeleteRequest);
                        deleted++;
                    } catch { failed++; }
                }
                // Restore the touched fields on updated records.
                for (const u of log.updated) {
                    try {
                        const undoRestoreRequest: ServerScopedDataRequest<UpdateDataRequest> = { object: objectName, id: u.id, data: u.before, context: writeCtx, ...(environmentId ? { environmentId } : {}) };
                        await p.updateData(undoRestoreRequest);
                        restored++;
                    } catch { failed++; }
                }

                const undoStampRequest: ServerScopedDataRequest<UpdateDataRequest> = {
                    object: IMPORT_JOB_OBJECT, id: jobId,
                    data: { reverted_at: new Date().toISOString() },
                    context: { ...(context as any), isSystem: true }, // [ADR-0103] engine-owned
                    ...(environmentId ? { environmentId } : {}),
                };
                await p.updateData(undoStampRequest);
                res.json({ success: true, jobId, object: objectName, deleted, restored, failed });
            } catch (error: any) {
                handleRouteError(res, error, '');
            }
        },
        metadata: { summary: 'Undo (logically roll back) a finished import job', tags: ['data', 'import'] },
    });

    // GET /data/import/jobs/:jobId/results — progress + capped per-row report.
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/import/jobs/:jobId/results`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const jobId = String(req.params.jobId || '');
                const row = await loadImportJob(p, jobId, environmentId, context);
                if (!row) {
                    res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                    return;
                }
                const stored = row.results;
                const items = Array.isArray(stored?.items) ? stored.items : Array.isArray(stored) ? stored : [];
                res.json({ ...importJobToProgress(row), results: items, resultsTruncated: !!stored?.truncated });
            } catch (error: any) {
                handleRouteError(res, error, '');
            }
        },
        metadata: { summary: 'Import job results (capped per-row report)', tags: ['data', 'import'] },
    });

    // GET /data/import/jobs/:jobId — live progress counters.
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/import/jobs/:jobId`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const jobId = String(req.params.jobId || '');
                const row = await loadImportJob(p, jobId, environmentId, context);
                if (!row) {
                    res.status(404).json({ code: 'NOT_FOUND', error: `No import job ${jobId}` });
                    return;
                }
                res.json(importJobToProgress(row));
            } catch (error: any) {
                handleRouteError(res, error, '');
            }
        },
        metadata: { summary: 'Import job progress', tags: ['data', 'import'] },
    });

    // GET /data/import/jobs — history list (newest first).
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/import/jobs`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                // [#6877] `?status=queued&status=running` dropped the filter
                // entirely (the `typeof` guard), and a repeated `?limit=`
                // fell back to the default page — both answered 200 with a
                // row set the caller did not ask for.
                if (refuseRepeatedQueryParams(req, res, ['object', 'status', 'limit', 'offset'])) return;
                const q = req.query ?? {};
                const filter: Record<string, any> = {};
                if (typeof q.object === 'string' && q.object) filter.object_name = q.object;
                if (typeof q.status === 'string' && q.status) filter.status = q.status;
                // [#20061] Parsed through the DECLARED `ListImportJobsRequestSchema`
                // (limit `int().min(1).max(200).default(50)`, offset
                // `int().min(0).default(0)`) rather than clamped: `?limit=0` used to
                // answer the 50-row default and `?limit=500` 200 rows, both `200`.
                // Absent and empty keep the declared defaults, as they always did.
                const limit = readDeclaredQueryNumber(q, 'limit',
                    ListImportJobsRequestSchema.shape.limit, { emptyIsAbsent: true });
                const offset = readDeclaredQueryNumber(q, 'offset',
                    ListImportJobsRequestSchema.shape.offset, { emptyIsAbsent: true });
                const jobsListRequest: ServerScopedDataRequest<FindDataRequest> = {
                    object: IMPORT_JOB_OBJECT,
                    // [#16337] Canonical QueryAST, not the wire dialect this
                    // literal used to speak (`$filter` / `$orderby` / `$top` /
                    // `$skip`). The normalizer folds those onto exactly these
                    // keys and the record sort form onto exactly this node
                    // list, so the option bag reaching `engine.find` is
                    // unchanged — pinned in `rest-server-canonical-query-ast.test.ts`.
                    query: {
                        object: IMPORT_JOB_OBJECT,
                        where: filter,
                        orderBy: [{ field: 'created_at', order: 'desc' }],
                        limit,
                        offset,
                    },
                    ...(environmentId ? { environmentId } : {}),
                    ...(context ? { context } : {}),
                };
                const r: any = await p.findData(jobsListRequest);
                const rows = Array.isArray(r?.records) ? r.records
                    : Array.isArray(r?.data) ? r.data
                        : Array.isArray(r?.rows) ? r.rows
                            : Array.isArray(r) ? r : [];
                res.json({ jobs: rows.map(importJobToSummary) });
            } catch (error: any) {
                handleRouteError(res, error, '');
            }
        },
        metadata: { summary: 'List import jobs (history)', tags: ['data', 'import'] },
    });

    // GET /data/:object/export  — streaming export (M10.21 / C.21)
    //
    // Query params:
    //   format=csv|json|xlsx (default: csv. json emits a JSON array, xlsx a workbook.)
    //   fields=a,b,c        (default: derive from object schema; falls back to keys of the first row)
    //   filter=<json>       ($filter as URL-encoded JSON, same shape as list endpoint)
    //   search=<term>       (full-text term, same semantics as the list endpoint's
    //                        $search; composes with `filter` rather than replacing it)
    //   searchFields=a,b    (optional ADR-0061 override for which fields `search` scans)
    //   orderby=field:desc  (optional ordering, mirrors $orderby semantics)
    //   header=false        (omit the header row for csv / xlsx; default true)
    //   limit=<n>           (default 10000, hard cap 50000)
    //   page=<n>            (driver chunk size, default 500, max 5000)
    //   template=true       (an xlsx IMPORT template instead of the data — see
    //                        `answerImportTemplate`; `false` or absent is the export)
    //
    // Values are formatted for readability from the object schema: lookup /
    // user fields resolve to a name (via injected $expand), select fields to
    // their option label, booleans to 是/否, dates to YYYY-MM-DD. When the
    // schema is unavailable the raw stored values stream through unchanged.
    //
    // [#8373] `datetime` cells render in the caller's BUSINESS timezone
    // (`ExecutionContext.timezone`), so the file agrees with the screen;
    // with no timezone resolved they render in UTC, as they always did.
    // `date` stays a timezone-naive calendar day (ADR-0053).
    //
    // A zero-row result still emits the header row when the column set is
    // authoritative (the security service's readable projection, or an explicit
    // `fields=`). The import template is `template=true`, not this. Without a
    // projection it stays headerless, so FLS-hidden column names never leak.
    //
    // Streams the response so 50k-row exports do not buffer in memory; the
    // xlsx path pipes exceljs' streaming writer straight onto the response.
    // Filename suggests `${objectLabel}-${YYYYMMDD}-${HHMMSS}.${ext}` for
    // browsers (localized label via RFC 5987 `filename*`, ASCII fallback
    // from the API name — see exportContentDisposition).
    //
    // xlsx only: select / radio cells are coloured with their option's
    // `color` as the font colour (white cell background) when the effective
    // limit is <= 10000. Larger exports drop styling for performance and set
    // `X-Export-Styles: dropped` (else `applied`); csv / json are unaffected.
    this.routeManager.register({
        method: 'GET',
        path: `${dataPath}/:object/export`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                const objectName = String(req.params.object || '');
                if (!objectName) {
                    res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                    return;
                }
                // [#20896] Which door's gates judge the request is decided by
                // what the caller ASKED for: `template=true` asks for the
                // import template, which the IMPORT door's gates judge (see
                // `enforceImportTemplateGates`); everything else is the
                // export, judged exactly as before. Only the `template`
                // value is read here, so a template request that also names
                // a row parameter is still one — and is refused 400 below,
                // after these gates, as it was after the export's.
                if (readTemplateMode({ template: req.query?.template }).kind === 'template') {
                    if (await this.enforceImportTemplateGates(req, res, p, environmentId, objectName, context)) return;
                } else {
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'export')) return;
                    // [#3544] …then the USER-level one. The object may expose
                    // export while THIS caller's permission sets deny it.
                    if (await this.enforceExportPermission(req, res, environmentId, objectName, context)) return;
                }
                // [#6877] The worst measured outcome on this surface:
                // `?limit=1&limit=2` → `Number([...])` is `NaN` → `NaN || 0`
                // is `0` → `Math.max(1, 0)` is `1`, so the caller downloaded
                // a ONE-ROW export with a 200 and no indication. `?filter=`
                // was the second: an array passes `typeof … === 'object'`,
                // so `['{…}','{…}']` was handed to `findData` as the filter.
                //
                // `fields` and `searchFields` are NOT listed — both already
                // read the array arm on purpose (`Array.isArray(q.fields)`
                // a few lines down), and columns are genuinely a list.
                // [#7606] Recognition runs BEFORE arity, per the rule stated
                // in `query-allowlist.ts`: "I do not know this parameter"
                // outranks "this parameter I do know was supplied twice", so
                // a request committing both errors is told the more
                // fundamental one. Both gates answer the SAME envelope here
                // (nested ADR-0112 `VALIDATION_ERROR`), so composing them
                // adds no second dialect to this route — the divergence
                // recorded in #8001 is between the LIST route's
                // `INVALID_FILTER` and this one, and is left exactly as it
                // was: `filter` is inside the closed set below, so a
                // repeated `?filter=` still reaches the multiplicity gate
                // and still answers what it answered before.
                if (refuseUnknownQueryParams(req, res, DATA_EXPORT_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res,
                    ['format', 'header', 'limit', 'page', 'filter', 'search', 'orderby', 'template'])) return;
                const q = req.query ?? {};
                // [#18386] `?template=true` answers the import template and
                // returns before a single export header is set, so without it
                // everything below runs exactly as it did before the mode
                // existed.
                const templateMode = readTemplateMode(q);
                if (templateMode.kind === 'refused') {
                    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: templateMode.message } });
                    return;
                }
                if (templateMode.kind === 'template') {
                    await this.answerImportTemplate(req, res, p, environmentId, objectName, context, q);
                    return;
                }
                const fmtRaw = String(q.format ?? 'csv').toLowerCase();
                const format: 'csv' | 'json' | 'xlsx' =
                    fmtRaw === 'json' ? 'json' : fmtRaw === 'xlsx' ? 'xlsx' : 'csv';
                // Header row toggle (csv / xlsx). Default on; `header=false` omits it.
                const includeHeader = String(q.header ?? 'true').toLowerCase() !== 'false';
                const HARD_CAP = 50_000;
                const MAX_CHUNK = 5_000;
                // Styled xlsx (per-cell font colour from select options) is far
                // heavier than a bare value dump, so cap it well below HARD_CAP;
                // above this the export still succeeds, just without colours.
                const STYLE_ROW_CAP = 10_000;
                // [#20062] Read, not coerced: `?limit=abc` (and `?limit=`) used to
                // become `Number(…) || 0` → `Math.max(1, 0)` → a ONE-row export
                // answered `200`. No request schema is declared for this door, so
                // the reading is "a whole number"; the floor and the cap below
                // are this door's own and are unchanged.
                const limitParam = readDeclaredQueryNumber(q, 'limit',
                    UNDECLARED_WHOLE_NUMBER_PARAM, { emptyIsAbsent: false });
                const requestedLimit = limitParam !== undefined ? Math.max(1, limitParam) : 10_000;
                const limit = Math.min(requestedLimit, HARD_CAP);
                // [#20139] Deliberately NOT read through `readDeclaredQueryNumber`
                // — the one ledgered exemption of the family's census
                // (`rest-server-query-number-census.test.ts`, which also pins
                // why). `page` sets only the CHUNK size of the `findData` loop
                // below: whatever it holds, readable or not, the export streams
                // the same rows in the same order, so no value of it can widen or
                // substitute the answer, and refusing one would turn a correct
                // export into a `400`.
                const chunkSize = Math.min(MAX_CHUNK, Math.max(50, q.page != null ? Number(q.page) || 500 : 500));
                // Colour cells only for xlsx within the style cap; decided up
                // front (before streaming) since we can't know the true row
                // count until the stream drains.
                const styled = format === 'xlsx' && limit <= STYLE_ROW_CAP;

                let filter: any = undefined;
                if (typeof q.filter === 'string' && q.filter.length > 0) {
                    try { filter = JSON.parse(q.filter); }
                    catch {
                        res.status(400).json({ code: 'INVALID_FILTER', error: 'filter must be JSON' });
                        return;
                    }
                } else if (q.filter && typeof q.filter === 'object') {
                    filter = q.filter;
                }

                // Full-text term, same semantics as the list endpoint's `$search`.
                // Without it this route could only ever mirror the FILTER half of a
                // list, so a user who searched and then exported downloaded the
                // unsearched superset — more rows than the screen showed, with
                // nothing to indicate it. `$search` composes with `$filter` inside
                // `findData`, so both halves apply.
                const search = typeof q.search === 'string' && q.search.trim().length > 0
                    ? q.search.trim()
                    : undefined;
                // ADR-0061 override for which fields the term scans. Only meaningful
                // alongside `search`; ignored on its own, exactly as in findData.
                let searchFields: string[] | undefined;
                if (typeof q.searchFields === 'string' && q.searchFields.length > 0) {
                    searchFields = q.searchFields.split(',').map((s: string) => s.trim()).filter(Boolean);
                } else if (Array.isArray(q.searchFields)) {
                    searchFields = q.searchFields.filter((s: any) => typeof s === 'string' && s.length > 0);
                }
                if (searchFields && searchFields.length === 0) searchFields = undefined;

                let orderby: any = undefined;
                if (typeof q.orderby === 'string' && q.orderby.length > 0) {
                    // Accept "field:dir,field2:dir" shorthand or a JSON object.
                    if (q.orderby.startsWith('{') || q.orderby.startsWith('[')) {
                        // [#4181] Same rule as `filter` two blocks up: a sort
                        // the server cannot parse is refused, not dropped.
                        // Lower stakes than a dropped filter (the row SET is
                        // unchanged, only its order), but a caller taking
                        // "latest N" via orderby+top silently got an
                        // arbitrary N.
                        try {
                            orderby = JSON.parse(q.orderby);
                        } catch {
                            res.status(400).json({ code: 'INVALID_REQUEST', error: 'orderby must be JSON' });
                            return;
                        }
                    } else {
                        const obj: Record<string, 'asc' | 'desc'> = {};
                        for (const part of q.orderby.split(',')) {
                            const [field, dir] = part.split(':').map((s: string) => s.trim());
                            if (field) obj[field] = dir?.toLowerCase() === 'desc' ? 'desc' : 'asc';
                        }
                        if (Object.keys(obj).length > 0) orderby = obj;
                    }
                }

                // Resolve fields: explicit param > schema fields > derived from first row.
                let fields: string[] | undefined;
                // Whether `fields` (the export columns) were derived from the object
                // schema rather than an explicit `?fields=` request. Only schema-derived
                // headers are narrowed to the FLS-readable set (#3391); an explicit
                // request is honored as asked (values still masked to empty).
                let fieldsFromSchema = false;
                if (typeof q.fields === 'string' && q.fields.length > 0) {
                    fields = q.fields.split(',').map((s: string) => s.trim()).filter(Boolean);
                } else if (Array.isArray(q.fields)) {
                    fields = q.fields.filter((s: any) => typeof s === 'string' && s.length > 0);
                }

                // Field metadata drives readable formatting (lookup names, select
                // labels, 是/否, formatted dates) and the $expand that resolves
                // references. Best-effort: when the schema is unavailable the export
                // falls back to raw values, byte-identical to the un-formatted path.
                let metaMap = new Map<string, ExportFieldMeta>();
                // Localized object display label (e.g. 合同) — drives the
                // suggested download filename below.
                let objectLabel: string | undefined;
                try {
                    // Field metadata comes from the same place `findData` resolves
                    // the object: `getMetaItem` is registry-first (DB fallback), so
                    // it returns the live `ObjectSchema` whose `fields` is an object
                    // map. The read hands back the envelope `{ type, name, item }`
                    // — one shape, unconditionally, since #5563 — so the schema
                    // document is read straight off `.item`. Legacy
                    // `getObjectSchema` is consulted as a last resort so existing
                    // test doubles keep working.
                    let schema: any = undefined;
                    if (typeof (p as any).getMetaItem === 'function') {
                        const res: any = await (p as any).getMetaItem({ type: 'object', name: objectName });
                        schema = res?.item;
                    }
                    if (!schema && typeof (p as any).getObjectSchema === 'function') {
                        schema = await (p as any).getObjectSchema(objectName, environmentId);
                    }
                    // Localize field labels to the request locale (Accept-Language /
                    // `?locale=`) the same way the metadata endpoints do, so the
                    // export header row matches the UI column headers instead of
                    // leaking the raw, untranslated `field.label` values.
                    schema = await this.translateMetaItem(req, 'object', environmentId, schema);
                    if (typeof schema?.label === 'string' && schema.label.length > 0) {
                        objectLabel = schema.label;
                    }
                    metaMap = buildFieldMetaMap(schema);
                    if (!fields || fields.length === 0) {
                        const names = [...metaMap.keys()];
                        if (names.length > 0) { fields = names; fieldsFromSchema = true; }
                    }
                } catch { /* fall back to first-row derivation + raw values */ }

                // Expand reference fields so lookup/user ids resolve to their record
                // (and thus a name). Batched $in inside findData — no N+1.
                const expandFields = referenceFieldNames(metaMap);

                // [#8373] The clock every `datetime` cell below renders in.
                // The business timezone is ALREADY on the context resolved
                // at the top of this handler (`resolveLocalizationContext`'s
                // platform-default → global → tenant cascade, assembled onto
                // `ExecutionContext.timezone`) — the export formatter simply
                // never asked for it, so every date/datetime column streamed
                // UTC while the UI rendered the business zone. `undefined`
                // keeps the historical UTC rendering, byte for byte.
                const timezone = typeof (context as any)?.timezone === 'string' && (context as any).timezone
                    ? String((context as any).timezone)
                    : undefined;

                // [#3547] Column projection ≡ list's field-level security — the
                // LONG-TERM correct path. Ask the security service which fields the
                // caller may READ under this context (the SAME field mask the read
                // middleware applies, so it can never drift) and narrow the
                // schema-derived header to that set BEFORE streaming. This replaces
                // inferring readability from the first masked data chunk (#3498): it
                // is immune to an all-readable-but-all-null column (which a driver may
                // omit from every row) and to an empty result set (which left the
                // masked-row inference with nothing to narrow). Explicit `?fields=`
                // requests are honored as asked (fieldsFromSchema=false → untouched;
                // values still masked to empty by the read path). When no security
                // service is reachable (no plugin-security / single-kernel without a
                // provider) the per-chunk masked-row inference below remains as the
                // fallback, so there is zero regression.
                let readableProjected = false;
                if (fieldsFromSchema && fields && fields.length > 0) {
                    try {
                        const security = await this.resolveSecurityService(environmentId, req);
                        if (security && typeof security.getReadableFields === 'function') {
                            const readable = await security.getReadableFields(objectName, context);
                            if (Array.isArray(readable)) {
                                const readableSet = new Set(readable);
                                fields = fields.filter((f) => readableSet.has(f));
                                readableProjected = true;
                            }
                        }
                    } catch { /* fall back to the masked-row inference below */ }
                }

                // Prepare streaming response. Set headers BEFORE first write.
                if (format === 'csv') {
                    res.header('Content-Type', 'text/csv; charset=utf-8');
                } else if (format === 'xlsx') {
                    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                } else {
                    res.header('Content-Type', 'application/json; charset=utf-8');
                }
                // [#8484] Same `timezone` the cells below render in — the
                // filename's stamp and the file's contents must not read
                // two different clocks. `undefined` keeps the historical
                // process-local stamp (NOT UTC — see the function's doc).
                res.header('Content-Disposition', exportContentDisposition(objectName, objectLabel, format, timezone));
                res.header('X-Export-Format', format);
                res.header('X-Export-Limit', String(limit));
                // Signal whether select-option colours were applied. Only
                // meaningful for xlsx; 'dropped' means the limit exceeded the
                // style cap so the workbook is colourless but complete.
                if (format === 'xlsx') res.header('X-Export-Styles', styled ? 'applied' : 'dropped');
                res.header('Cache-Control', 'no-store');

                let exported = 0;
                let firstChunk = true;
                let skip = 0;
                if (format === 'json') res.write('[');
                const xlsx = format === 'xlsx' ? await createXlsxStream(res, styled) : null;

                while (exported < limit) {
                    const take = Math.min(chunkSize, limit - exported);
                    const findArgs: ServerScopedDataRequest<FindDataRequest> = {
                        object: objectName,
                        // [#16337] Canonical QueryAST. `expand` is spelled as
                        // the relation map the AST declares rather than as the
                        // comma list `$expand` accepted: the normalizer lowers
                        // that list to `{name: {object: name}}`, which is what
                        // this builds directly — same map, one fewer dialect.
                        // (The nested `object` naming the RELATION rather than
                        // its target is the normalizer's own lowering, kept
                        // byte-identical here on purpose.)
                        query: {
                            object: objectName,
                            ...(filter ? { where: filter } : {}),
                            ...(search ? { search } : {}),
                            ...(search && searchFields ? { searchFields } : {}),
                            ...(orderby ? { orderBy: orderby } : {}),
                            ...(expandFields.length > 0
                                ? {
                                    expand: Object.fromEntries(
                                        expandFields.map((rel): [string, { object: string }] => [rel, { object: rel }]),
                                    ),
                                }
                                : {}),
                            limit: take,
                            offset: skip,
                        },
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    };
                    const result: any = await p.findData(findArgs);
                    // `findData` returns `{ object, records, total, hasMore }`;
                    // accept the legacy `data` / `rows` aliases and a bare array
                    // so test doubles and alternate protocols keep working.
                    const rows: any[] = Array.isArray(result?.records) ? result.records
                        : Array.isArray(result?.data) ? result.data
                            : Array.isArray(result?.rows) ? result.rows
                                : Array.isArray(result) ? result : [];

                    if (rows.length === 0) break;

                    // Derive fields from the first row if schema lookup failed.
                    if ((!fields || fields.length === 0) && firstChunk) {
                        fields = Object.keys(rows[0] ?? {});
                    }

                    // [#3391] Column projection ≡ list's field-level security —
                    // FALLBACK path when the #3547 security-service projection above
                    // was unavailable (`!readableProjected`). The read middleware
                    // (FieldMasker) DELETES unreadable keys from each row, so a
                    // schema-derived header would still leak the *names* of FLS-hidden
                    // columns as empty cells. Narrow the schema-derived header to the
                    // keys actually present across the first masked chunk (their ∩
                    // with schema fields is implicit — `fields` already came from
                    // `metaMap.keys()`), so export headers match list's readable
                    // columns. Explicit `?fields=` requests are left untouched (values
                    // still masked to empty, as with list `$select`); a fully empty
                    // first chunk leaves the header as-is (same as today — no worse).
                    if (!readableProjected && fieldsFromSchema && firstChunk && fields && fields.length > 0) {
                        const readable = new Set<string>();
                        for (const row of rows) {
                            if (row && typeof row === 'object') {
                                for (const k of Object.keys(row)) readable.add(k);
                            }
                        }
                        if (readable.size > 0) {
                            fields = fields.filter((f) => readable.has(f));
                        }
                    }

                    if (format === 'csv') {
                        const text = rowsToCsv(fields ?? [], rows, firstChunk && includeHeader, metaMap, timezone);
                        res.write(text);
                    } else if (format === 'xlsx') {
                        if (firstChunk && includeHeader) {
                            xlsx!.ws.addRow((fields ?? []).map((f) => headerLabel(f, metaMap))).commit();
                        }
                        const cols = fields ?? [];
                        for (const row of rows) {
                            const r = xlsx!.ws.addRow(formatRowCells(row, cols, metaMap, timezone));
                            if (styled) {
                                cols.forEach((f, i) => {
                                    const argb = cellFontColor(row?.[f], metaMap.get(f));
                                    if (argb) r.getCell(i + 1).font = { color: { argb } };
                                });
                            }
                            r.commit();
                        }
                    } else {
                        for (let i = 0; i < rows.length; i++) {
                            const prefix = (firstChunk && i === 0) ? '' : ',';
                            res.write(prefix + JSON.stringify(formatRowForJson(rows[i], metaMap, timezone)));
                        }
                    }
                    firstChunk = false;
                    exported += rows.length;
                    skip += rows.length;
                    if (rows.length < take) break;
                }
                // [#3547] Zero rows: still emit the header when the column set is
                // AUTHORITATIVE. "Export columns don't depend on row content" is
                // only true if it also holds at zero rows — and the readable
                // projection above is derived from schema + context, so an empty
                // result has an exact header to write (which also makes an empty
                // export a usable import template). An explicit `?fields=` is
                // authoritative for the same reason: the caller named the columns.
                //
                // Deliberately NOT emitted when the header is schema-derived and
                // the projection was unavailable (`fieldsFromSchema &&
                // !readableProjected`): the masked-row fallback has no rows to
                // narrow with, so writing the full schema header would name
                // FLS-hidden columns — precisely the leak #3391 closes. That path
                // keeps today's headerless empty file.
                if (
                    firstChunk && includeHeader && fields && fields.length > 0 &&
                    (readableProjected || !fieldsFromSchema)
                ) {
                    if (format === 'csv') {
                        res.write(rowsToCsv(fields, [], true, metaMap));
                    } else if (format === 'xlsx') {
                        xlsx!.ws.addRow(fields.map((f) => headerLabel(f, metaMap))).commit();
                    }
                    // json has no header concept — the empty array is already correct.
                }

                if (format === 'json') {
                    res.write(']');
                    res.end();
                } else if (format === 'xlsx') {
                    await xlsx!.finalize();
                } else {
                    res.end();
                }
            } catch (error: any) {
                // Best-effort error envelope; if headers already sent the
                // client receives a truncated stream which signals failure.
                try { handleRouteError(res, error, String(req.params?.object || '')); }
                catch { try { res.end(); } catch { /* swallow */ } }
            }
        },
        metadata: {
            summary: 'Streaming export of object rows (CSV, JSON, or XLSX)',
            tags: ['data', 'export'],
        },
    });
}
