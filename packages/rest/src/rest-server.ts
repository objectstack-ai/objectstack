// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    IHttpServer, resolveAuthzContext, resolveLocalizationContext, isAuthGateAllowlisted,
    effectiveTenancyPosture,
    assembleExecutionContext, normalizeAuthGate, type AuthGate,
    shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS,
    // [#7678] ADR-0090 D5/D9 suggested-binding `?status=` vocabulary — the one
    // owner, shared with the runtime dispatcher's `/security` domain.
    isAudienceBindingSuggestionStatus, unknownAudienceBindingSuggestionStatusMessage,
} from '@objectstack/core';
import {
    isMcpServerEnabled,
    looksLikeInternalErrorLeak,
    declaresServerFault,
    INTERNAL_ERROR_MESSAGE,
} from '@objectstack/types';
import {
    allowPerfDisclosure,
    isPerfDisclosurePrincipal,
    OBSERVABILITY_METRICS_SERVICE,
} from '@objectstack/observability';
// [ADR-0106 / #3682] Metadata-plane FLS. One projection, one fingerprint,
// shared with the runtime `/metadata` dispatcher — see
// `@objectstack/metadata-core`'s `object-schema-fls.ts` for why the normalizer
// lives there rather than beside either set of exits.
import {
    ObjectSchemaMaskEvaluationError,
    applyObjectSchemaMask,
    foldVisibilityFingerprintIntoEtag,
    isObjectSchemaMaskExempt,
    isObjectSchemaMaskingEnabled,
    normalizeIfNoneMatch,
    resolveObjectSchemaMaskPosture,
    OBJECT_SCHEMA_MASK_NOT_APPLICABLE,
    type ObjectSchemaMaskPosture,
} from '@objectstack/metadata-core';
import { RouteManager, type RouteEntry } from './route-manager.js';
// [#6877] Query-parameter multiplicity. `IHttpRequest.query` declares
// `string | string[]`; the array arm is real (`NodeHttpServer` produces it,
// measured over a socket on #6878) and this file used it as a string at ~50
// read points. Each handler below declares WHICH of its parameters are
// single-valued; genuinely multi-valued ones (`select`, `expand`, `objects`,
// `fields`, `searchFields`, `approverId`) are deliberately never listed.
// [#7390] The filter slot is the one arity judgement the shared normalizer
// structurally cannot make (a filter AST IS an array), so the querystring
// ingress — the only layer that knows it is one — makes it instead.
import { refuseRepeatedQueryParams, assertFilterParamSuppliedOnce } from './query-multiplicity.js';
// [#7527] The other half of the same discipline: a parameter this route does
// not KNOW is refused rather than dropped. See `query-allowlist.ts` for why an
// ignored filter is the one wrong answer a caller cannot detect.
import { refuseUnknownQueryParams } from './query-allowlist.js';
import type { DirectMountedRoute, MountedRouteSource } from './direct-mount.js';
import { RestServerConfig, RestApiConfig, CrudEndpointsConfig, MetadataEndpointsConfig, BatchEndpointsConfig, RouteGenerationConfig } from '@objectstack/spec/api';
import { DataProtocol, MetadataProtocol } from '@objectstack/spec/api';
// [#8073] The closed ADR-0112 error vocabulary, so the explain family's single
// refusal emitter types its `code` parameter as the vocabulary rather than as
// `string` — an invented code is a compile error at the call site instead of a
// runtime surprise on whichever arm a test happens to drive.
import type { ErrorCode } from '@objectstack/spec/api';
// The async-import row ceiling has exactly one definition, in the spec, whose
// TSDoc is its public statement (#6535). rest is the only enforcer, so it reads
// that export rather than re-declaring the literal beside a "mirrors spec" comment.
import { IMPORT_JOB_MAX_ROWS } from '@objectstack/spec/api';
import { PUBLIC_FORM_SERVER_MANAGED_FIELDS } from '@objectstack/spec/security';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { preferredLocaleFromHeader } from '@objectstack/spec/system';
import type { ISecurityService } from '@objectstack/spec/contracts';
import {
    resolveEffectiveApiMethods,
    effectiveOperationsArray,
    apiExposureDenialReason,
    DATA_ACTION_TO_API_OPERATION,
} from '@objectstack/spec/data';
// [#8013] The SHARED envelope writer (#3973), aliased: this module already has a
// module-scope `sendError` of its own — the sanitizing responder that maps a
// THROWN error onto a status — and the two are not interchangeable. This one
// emits the declared `{ success: false, error: { code, message } }` for a refusal
// the handler DECIDED, with `code` typed to the closed ADR-0112 vocabulary rather
// than `string`. Adding a call site here moves no `check:route-envelope` count:
// the body literal lives in `@objectstack/types` (the pinned `SHARED_BUILDER`),
// and this file is audited `dialectOnly` for the two non-conforming dialects it
// still emits — which this deliberately is not.
import { sendError as sendEnvelopeError } from '@objectstack/types';

/**
 * The protocol slice the REST layer actually consumes (ADR-0076 D9 / #2462
 * A1.5): wire-normalized data CRUD plus the metadata control plane — not the
 * full `ObjectStackProtocol` union. Server-only extensions (drafts, history,
 * diagnostics, clone, …) are feature-detected via runtime casts and so don't
 * widen this contract.
 */
export type RestProtocol = DataProtocol & MetadataProtocol;
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
import { runImport } from './import-runner.js';
import { prepareImportRequest } from './import-prepare.js';
import { enrichOpenApiWithEndpoints } from './openapi-endpoints.js';
import { buildBuiltinPaths } from './openapi-builtin-paths.js';
import {
    isEndpointMatchAuthority,
    selectServedEndpoints,
    type EndpointMatchAuthority,
} from './served-endpoints.js';

import { logError, logWarn } from './log.js';
// [#8850] The ADR-0112 error/fault-classification prologue — how a thrown thing
// becomes an HTTP answer — was module-level code sitting ahead of this class for
// historical reasons and now lives in its own module. A move, not a redesign:
// same functions, same wire answers, and `mapDataError` re-exported below so the
// surface `./rest-server.js` has always offered is byte-identical.
import {
    mapDataError,
    sendError,
    sendFieldVisibilityFault,
    handleRouteError,
    logUnexpectedRouteError,
    isExpectedRouteError,
    applyDroppedFieldsHeader,
} from './error-response.js';
export { mapDataError };

/**
 * Whether a metadata type's user-facing labels are localized at the REST
 * boundary by `translateMetadataDocument`.
 *
 * DERIVED from the spec's translator dispatch. This used to be a hand-copied
 * literal set under a "keep in sync with the type dispatch" comment — the
 * shape #3786 was filed about: adding a translator in spec silently left the
 * REST boundary serving that type untranslated, with no error anywhere.
 * Reading the answer from `TRANSLATABLE_METADATA_TYPES` means there is no
 * second list to forget.
 *
 * Resolved lazily and memoised, so `@objectstack/spec/system` stays off the
 * module-init path exactly as it was before — the same `await import` the
 * translate helpers below already perform, and a module-cache hit after the
 * first call.
 */
let translatableMetaTypes: ReadonlySet<string> | undefined;
async function isTranslatableMetaType(type: string): Promise<boolean> {
    if (!translatableMetaTypes) {
        ({ TRANSLATABLE_METADATA_TYPES: translatableMetaTypes } = await import('@objectstack/spec/system'));
    }
    return translatableMetaTypes.has(type);
}


/**
 * The ADR-0114 D3 mapper — Zod issue codes → the closed `FieldErrorCode`
 * catalog, with the #5014 union-branch expansion — lived here module-locally
 * until #8124 moved it to `@objectstack/spec` (`api/zod-issues-to-fields.ts`),
 * beside the catalog it is total over. The move exists because
 * `@objectstack/types`' `fieldsFromZodIssues` (the helper the runtime domain
 * routes emit through) was still passing `issue.code` through raw, and `types`
 * cannot import this package to share the compliant copy — the dependency
 * arrow points rest → types, never back. One implementation of D3's table in
 * the repo; a second is the drift the ADR exists to prevent.
 *
 * Re-exported unchanged: this module's routes call it exactly as before, and
 * `zod-field-codes.test.ts` / `zod-union-fields.test.ts` keep pinning the
 * shared implementation to the wire contract this transport always had.
 */
import { zodIssuesToFields } from '@objectstack/spec/api';
export { zodIssuesToFields };

/** Extra context for a gate check: import `writeMode` precision / bulk∧child. */
interface ApiAccessOpts {
    writeMode?: string;
    bulkChild?: string;
}

/**
 * [#7912] The nav-servability gate handed to `filterAppForUser`: given the
 * `objectName` a `type: 'object'` entry targets (and the entry itself, for the
 * diagnostic), answer whether the destination can serve a `list`.
 *
 * `true` = serve the entry. That includes every case this layer cannot judge —
 * an object absent from metadata, or metadata that could not be read at all —
 * because the gate is a SURFACE-AREA control, not an authorization boundary,
 * and the same fail-open reasoning `loadObjectItems` records applies here.
 *
 * `appName` is passed in rather than captured because ONE gate serves the whole
 * app list: the list route resolves object metadata once and gates every app
 * with the same closure, so the app being filtered is a per-call fact.
 */
type NavServabilityGate = (objectName: string, entry: any, appName: string) => boolean;

/**
 * Pure per-object API-exposure check: given an object's `enable` block, decide
 * whether `operation` is denied on the *external* REST surface (ADR-0049 /
 * #1889 / #3391). Returns the `{ status, body }` to send, or `null` when
 * allowed. Shared by the single-record routes (`enforceApiAccess`) and the
 * cross-object batch route so both honour the SAME gate.
 *
 * #3391: the decision comes from the spec's single derivation source of truth
 * (`resolveEffectiveApiMethods` / `isApiOperationAllowed`), so the three-state
 * whitelist (`undefined` unrestricted / `[]` deny-all / subset) and the derived
 * verbs (import⊆create∨update, export⊆list, bulk∧child, …) are resolved
 * identically everywhere. The 405 body's `allowed` array is the EFFECTIVE
 * operation set (enum-ordered), the single "effective" channel the frontend
 * consumes — never the raw whitelist.
 *
 * [#7912] The two-step ORDER those primitives compose into — `apiEnabled`
 * first and independently, the whitelist second — is now the spec's
 * `apiExposureDenialReason`, and this function is its ENVELOPE half: it turns
 * the reason into the 404/405 body this surface sends. The extraction is what
 * lets the nav-servability prune below (and the authoring-time lint that warns
 * about the same entry) reach the identical verdict without a second spelling
 * of the order to drift from this one.
 */
export function apiAccessDenialFromEnable(
    enable: any,
    objectName: string,
    operation: string,
    opts?: ApiAccessOpts,
): { status: number; body: Record<string, unknown> } | null {
    // Canonicalization stays HERE: `operation` arrives as a runtime action name
    // on this surface, while the spec helper's contract is a canonical
    // `ApiOperation`.
    const canonical = DATA_ACTION_TO_API_OPERATION[operation] ?? operation;
    const reason = apiExposureDenialReason(enable, canonical, opts);
    if (!reason) return null;
    if (reason === 'api-disabled') {
        return {
            status: 404,
            body: {
                error: `Object '${objectName}' is not exposed via the API`,
                code: 'OBJECT_API_DISABLED',
                object: objectName,
            },
        };
    }
    return {
        status: 405,
        body: {
            error: `API operation '${operation}' is not allowed on object '${objectName}'`,
            code: 'OBJECT_API_METHOD_NOT_ALLOWED',
            object: objectName,
            allowed: effectiveOperationsArray(resolveEffectiveApiMethods(enable)),
        },
    };
}

/**
 * [#7527] The closed query-parameter set of `GET {basePath}/approvals/requests`.
 *
 * Measured from the handler's own reads, not from the card or the docs: the
 * five filters (`object`, `recordId`, `status`, `approverId`, `submitterId`),
 * the free-text `q`, the paging pair (`limit`, `offset`), and the snake_case
 * alias spellings the handler honours for the three camelCase filters. A name
 * outside this set is refused with a located `400` instead of being dropped.
 *
 * Exported so the pin tests assert against THIS array rather than a
 * hand-copied second list that can drift away from what the route accepts.
 */
export const APPROVAL_REQUEST_LIST_PARAMS: readonly string[] = [
    'object',
    'recordId', 'record_id',
    'status',
    'approverId', 'approver_id',
    'submitterId', 'submitter_id',
    'q',
    'limit', 'offset',
];

/**
 * [#7606] The closed query-parameter set of `GET {basePath}/data/:object/:id`.
 *
 * **Measured**, at `registerCrudEndpoints`' read-record handler, from the ONE
 * line that reads the query — `const { select, expand } = req.query || {}`.
 * The handler destructures exactly these two names and forwards nothing else,
 * so every other parameter on this route is dropped in the fullest sense: it
 * never reaches `getData` at all.
 *
 * ⚠️ The accepted names deliberately EXCLUDE the CANONICAL spelling of one
 * slot. The spec's alias table (`RPC_QUERY_ALIAS_SLOTS`) declares the fields
 * slot as canonical `fields` with alias `select`, and the expand slot as
 * canonical `expand` with alias `populate` — but this route folds no aliases,
 * so `fields` / `populate` are not synonyms for anything this handler reads.
 * Putting them in the allowlist unfolded would advertise a capability the
 * handler does not implement — the declared-≠-enforced trap in the other
 * direction, and strictly worse than refusing them: a caller sending
 * `?fields=title` would pass recognition, then silently get back the FULL
 * record because nothing downstream of the gate consumes the name. Refusing
 * them instead makes the gap self-reporting — the located `400` names
 * `select` / `expand` as what this route accepts.
 *
 * **[#8039] Settled by maintainer ruling, 2026-08-12 — record, not an open
 * question.** Three shapes were on the table for the mismatch between this
 * route's two names and the spec's alias table: (1) fold
 * `RPC_QUERY_ALIAS_SLOTS` onto this route, so `fields` / `populate` start
 * working here too; (2) keep this narrow set, but refuse the alias-table
 * spellings loudly instead of dropping them; (3) keep + document as-is. The
 * ruling took **option 2**, which is exactly what `refuseUnknownQueryParams`
 * below already does — `fields` and `populate` are refused the same way any
 * other unrecognised name is, naming `select` / `expand` as the accepted
 * pair. ⛔ **Option 1 was explicitly rejected** and stays rejected here:
 * folding the alias table onto this ONE route is surface expansion on a
 * public route with no measured pull behind it, and doing it for this route
 * alone would leave every other data route's ingress inconsistent in the
 * opposite direction. The only thing that changes this: a ruling that
 * declares `RPC_QUERY_ALIAS_SLOTS` universal across ALL data routes, landed
 * as one card applying the fold everywhere at once — never a quiet widening
 * of this route's set in isolation.
 */
export const DATA_RECORD_READ_PARAMS: readonly string[] = ['select', 'expand'];

/**
 * [#7606] The closed query-parameter set of `GET {basePath}/data/:object/export`.
 *
 * **Measured** from the export handler's own reads of `q = req.query ?? {}`,
 * every one of them: the output controls (`format`, `header`), the paging pair
 * (`limit`, and `page` — which on this route is the streaming CHUNK size, not
 * a page number), the row-selection axes (`filter`, `search`, `searchFields`,
 * `orderby`) and the column selection (`fields`).
 *
 * ⚠️ …and `locale`, **which the handler body never mentions**. It is read one
 * frame down, by `extractLocale` behind the `translateMetaItem` call that
 * localises the header row — the "anything middleware reads" clause of the
 * measuring rule, and the single name on this route that a read of the handler
 * alone gets wrong. Omitting it would 400 every `?locale=zh-CN` export that
 * works today, turning localised column headers into an outage: precisely the
 * silent-widening-traded-for-a-loud-incident failure the policy warns about,
 * committed by the change meant to prevent it. The measurement is only
 * finished when the helpers the handler calls have been read too.
 *
 * `fields` and `searchFields` are in this set but are deliberately absent from
 * the route's sibling multiplicity declaration: both read their array arm on
 * purpose (columns are genuinely a list). Recognition and arity are separate
 * questions and a name can be answered differently by each.
 *
 * ⚠️ Dropping `limit` from this array would convert a silent-widening bug into
 * a loud export outage — the preservation half of
 * `rest-server-closed-query-params.test.ts` exists to make that impossible to
 * land, and pins `locale` by name for the reason above.
 */
export const DATA_EXPORT_PARAMS: readonly string[] = [
    'format', 'header',
    'limit', 'page',
    'filter', 'search', 'searchFields', 'orderby',
    'fields',
    'locale',
];

/**
 * [#7606] The closed query-parameter set of `GET {basePath}/search`.
 *
 * **Measured** from the cross-object search handler: the term under both
 * spellings it honours (`q`, and the `query` fallback the very next line
 * reads), the object scope (`objects`), and the two result caps (`limit`,
 * `perObject`). A dropped `?objects=` here is the widening case in its purest
 * form — the search silently fans out across every object instead of the one
 * the caller named.
 */
export const GLOBAL_SEARCH_PARAMS: readonly string[] = [
    'q', 'query', 'objects', 'limit', 'perObject',
];

/** Platform object backing async import jobs (see sys-import-job.object.ts). */
const IMPORT_JOB_OBJECT = 'sys_import_job';
/** Cap on per-row results persisted on the job (failures first). */
const IMPORT_JOB_RESULTS_CAP = 500;
/** Undo (logical rollback) is only recorded for jobs at or under this row
 *  count — larger jobs skip the undo log to bound the stored before-snapshots. */
const IMPORT_JOB_UNDO_MAX_ROWS = 5_000;

/** Generate a sortable-ish, collision-resistant import job id. */
function newImportJobId(): string {
    return `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Cap a results list to {@link IMPORT_JOB_RESULTS_CAP}, keeping failures first. */
function capImportResults(results: Array<{ ok: boolean }>): { items: any[]; truncated: boolean } {
    if (results.length <= IMPORT_JOB_RESULTS_CAP) return { items: results, truncated: false };
    const failures = results.filter(r => !r.ok);
    const successes = results.filter(r => r.ok);
    const items = [...failures, ...successes].slice(0, IMPORT_JOB_RESULTS_CAP);
    return { items, truncated: true };
}

/** Parse the persisted undo log (json column may arrive as object or string). */
function parseUndoLog(raw: any): { created: string[]; updated: Array<{ id: string; before: Record<string, any> }> } | undefined {
    if (!raw) return undefined;
    let v = raw;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return undefined; } }
    if (!v || typeof v !== 'object') return undefined;
    const created = Array.isArray(v.created) ? v.created.map(String) : [];
    const updated = Array.isArray(v.updated)
        ? v.updated.filter((u: any) => u && u.id != null).map((u: any) => ({ id: String(u.id), before: u.before ?? {} }))
        : [];
    return { created, updated };
}

/** True when a job can still be undone: it wrote data (undo log present with
 *  entries), hasn't already been reverted, and finished in a terminal state. */
function importJobUndoable(row: any): boolean {
    if (row?.reverted_at) return false;
    const status = String(row?.status ?? '');
    if (status !== 'succeeded' && status !== 'cancelled') return false;
    const log = parseUndoLog(row?.undo_log);
    return !!log && (log.created.length > 0 || log.updated.length > 0);
}

/** Map a persisted `sys_import_job` row to the ImportJobProgress DTO. */
function importJobToProgress(row: any): Record<string, any> {
    const total = Number(row?.total_rows ?? 0);
    const processed = Number(row?.processed_rows ?? 0);
    return {
        undoable: importJobUndoable(row),
        ...(row?.reverted_at ? { revertedAt: String(row.reverted_at) } : {}),
        jobId: String(row?.id ?? ''),
        object: String(row?.object_name ?? ''),
        status: String(row?.status ?? 'pending'),
        dryRun: !!row?.dry_run,
        writeMode: String(row?.write_mode ?? 'insert'),
        total,
        processed,
        created: Number(row?.created_count ?? 0),
        updated: Number(row?.updated_count ?? 0),
        skipped: Number(row?.skipped_count ?? 0),
        errors: Number(row?.error_count ?? 0),
        percentComplete: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : (processed > 0 ? 100 : 0),
        ...(row?.error ? { error: String(row.error) } : {}),
        ...(row?.started_at ? { startedAt: String(row.started_at) } : {}),
        ...(row?.completed_at ? { completedAt: String(row.completed_at) } : {}),
        createdAt: String(row?.created_at ?? ''),
    };
}

/** Map a persisted `sys_import_job` row to the ImportJobSummary DTO (list). */
function importJobToSummary(row: any): Record<string, any> {
    const p = importJobToProgress(row);
    return {
        jobId: p.jobId, object: p.object, status: p.status,
        total: p.total, processed: p.processed,
        created: p.created, updated: p.updated, skipped: p.skipped, errors: p.errors,
        createdAt: p.createdAt,
        undoable: p.undoable,
        ...(p.completedAt ? { completedAt: p.completedAt } : {}),
        ...(p.revertedAt ? { revertedAt: p.revertedAt } : {}),
    };
}

/**
 * Escape a single value into an RFC-4180 CSV cell. Values containing
 * commas, quotes, CR, or LF are wrapped in double-quotes with embedded
 * quotes doubled. `null` / `undefined` become an empty cell. Objects and
 * arrays are serialised as compact JSON so nested data round-trips
 * without flattening surprises.
 */
function formatCsvCell(value: any): string {
    if (value === null || value === undefined) return '';
    let s: string;
    if (typeof value === 'string') s = value;
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') s = String(value);
    else if (value instanceof Date) s = value.toISOString();
    else { try { s = JSON.stringify(value); } catch { s = String(value); } }
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * Serialise a list of rows to RFC-4180 CSV text. Caller supplies the ordered
 * list of field names and a (possibly empty) field-metadata map. With metadata,
 * the header row uses field labels and cell values are formatted to readable
 * display values (lookup names, select labels, 是/否, formatted dates). With an
 * empty map the output is byte-identical to the raw, un-formatted behaviour.
 *
 * `timezone` (#8373) is the caller's business timezone, used to render
 * `datetime` cells in the same clock the UI shows; absent, they render in UTC.
 */
function rowsToCsv(
    fields: string[],
    rows: Array<Record<string, any>>,
    includeHeader: boolean,
    metaMap: Map<string, ExportFieldMeta>,
    timezone?: string,
): string {
    const lines: string[] = [];
    if (includeHeader) lines.push(fields.map(f => formatCsvCell(headerLabel(f, metaMap))).join(','));
    for (const row of rows) {
        lines.push(formatRowCells(row, fields, metaMap, timezone).map(formatCsvCell).join(','));
    }
    return lines.join('\r\n') + (lines.length > 0 ? '\r\n' : '');
}

/**
 * Bridge exceljs' streaming workbook writer onto the chunked HTTP response.
 *
 * exceljs writes to a Node stream; we pipe a PassThrough's `data` events into
 * `res.write` (which the hono server encodes — strings via TextEncoder, binary
 * Buffers/Uint8Arrays enqueued verbatim) so the xlsx bytes stream straight to
 * the client without buffering the whole workbook in memory. `useStyles:false`
 * keeps the writer lean for large (20k+ row) exports.
 *
 * Returns the worksheet to append rows to and a `finalize()` that commits the
 * workbook and resolves once the last byte has been flushed and the response
 * ended. Dynamically imported so `node:stream` / `exceljs` stay out of the
 * module's static graph.
 */
async function createXlsxStream(res: any, useStyles = false): Promise<{
    ws: any;
    finalize: () => Promise<void>;
}> {
    const { PassThrough } = await import('node:stream');
    const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));

    const passthrough = new PassThrough();
    const done = new Promise<void>((resolve, reject) => {
        passthrough.on('data', (chunk: Buffer) => { res.write(chunk); });
        passthrough.on('end', () => { try { res.end(); } catch { /* swallow */ } resolve(); });
        passthrough.on('error', reject);
    });

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: passthrough, useStyles });
    const ws = wb.addWorksheet('Export');

    return {
        ws,
        finalize: async () => {
            await ws.commit();
            await wb.commit();
            await done;
        },
    };
}

/**
 * Structural subset of `KernelManager` that RestServer needs in order to
 * resolve a per-project protocol at request time. Typed locally to avoid
 * an @objectstack/runtime → @objectstack/rest → @objectstack/runtime
 * package cycle.
 */
export interface RestKernelManager {
    getOrCreate(environmentId: string): Promise<{
        getServiceAsync<T = unknown>(name: string): Promise<T>;
    }>;
}

/**
 * Normalized REST Server Configuration
 * All nested properties are required after normalization
 */
type NormalizedRestServerConfig = {
    api: {
        version: string;
        basePath: string;
        apiPath: string | undefined;
        enableCrud: boolean;
        enableMetadata: boolean;
        enableUi: boolean;
        enableBatch: boolean;
        enableDiscovery: boolean;
        enableOpenApi: boolean;
        enableSearch?: boolean;
        enableProjectScoping: boolean;
        projectResolution: 'required' | 'optional' | 'auto';
        documentation: RestApiConfig['documentation'];
        responseFormat: RestApiConfig['responseFormat'];
    };
    crud: {
        operations: {
            create: boolean;
            read: boolean;
            update: boolean;
            delete: boolean;
            list: boolean;
        };
        patterns: CrudEndpointsConfig['patterns'];
        dataPrefix: string;
        objectParamStyle: 'path' | 'query';
    };
    metadata: {
        prefix: string;
        enableCache: boolean;
        cacheTtl: number;
        /**
         * [ADR-0106 D8] Per-caller FLS masking of served object schemas.
         * Default **on**; `false` opts a deployment out of the metadata-plane
         * mask entirely (the data plane is unaffected either way).
         */
        maskObjectFields: boolean;
        endpoints: {
            types: boolean;
            items: boolean;
            item: boolean;
            schema: boolean;
        };
    };
    batch: {
        maxBatchSize: number;
        enableBatchEndpoint: boolean;
        operations: {
            createMany: boolean;
            updateMany: boolean;
            deleteMany: boolean;
            upsertMany: boolean;
        };
        defaultAtomic: boolean;
    };
    routes: {
        includeObjects: string[] | undefined;
        excludeObjects: string[] | undefined;
        nameTransform: 'none' | 'plural' | 'kebab-case' | 'camelCase';
        overrides: RouteGenerationConfig['overrides'];
    };
};

/**
 * RestServer
 * 
 * Provides automatic REST API endpoint generation for ObjectStack.
 * Generates standard RESTful CRUD endpoints, metadata endpoints, and batch operations
 * based on the configured protocol provider.
 * 
 * Features:
 * - Automatic CRUD endpoint generation (GET, POST, PUT, PATCH, DELETE)
 * - Metadata API endpoints (/meta)
 * - Batch operation endpoints (/batch, /createMany, /updateMany, /deleteMany)
 * - Discovery endpoint
 * - Configurable path prefixes and patterns
 * 
 * @example
 * const restServer = new RestServer(httpServer, protocolProvider, {
 *   api: {
 *     version: 'v1',
 *     basePath: '/api'
 *   },
 *   crud: {
 *     dataPrefix: '/data'
 *   }
 * });
 * 
 * restServer.registerRoutes();
 */
/**
 * Minimal env registry shape consumed by the REST server for hostname →
 * environmentId resolution and `X-Environment-Id` header validation on unscoped
 * routes. Mirrors the surface of `EnvironmentDriverRegistry` defined in
 * `@objectstack/service-cloud`.
 */
export interface RestEnvRegistry {
    resolveByHostname(hostname: string): Promise<{ environmentId: string } | null | undefined>;
    /**
     * Look up a project by id. Returns a truthy value (typically an
     * `IDataDriver`) when the project exists and is bound, `null` when
     * unknown. The REST server only uses the truthiness; it does not
     * touch the driver itself (the actual driver is loaded later via
     * `KernelManager.getOrCreate(environmentId)`).
     */
    resolveById?(environmentId: string): Promise<unknown | null>;
}

/**
 * Request → environment resolution seam (ADR-0076 D11 step ④, #2462).
 *
 * When the host registers a `kernel-resolver` service (the ADR-0006 seam the
 * HTTP dispatcher already consumes), `RestApiPlugin` wraps it in this shape so
 * the REST server resolves a request's environment through the SAME strategy
 * as the dispatcher — one answer per host for "which environment does this
 * request belong to" — instead of the REST server's own parallel
 * hostname/header chain.
 *
 * Contract: a normal return is FINAL — `undefined` means the resolver decided
 * the request is unscoped (e.g. a control-plane route), and the legacy
 * built-in chain must NOT second-guess it. Only a thrown error falls back to
 * the legacy chain, so a misbehaving resolver degrades to pre-seam behavior
 * instead of taking down REST routing.
 */
export interface RestRequestEnvResolver {
    resolveRequestEnvironmentId(req: unknown): Promise<string | undefined>;
}

/**
 * One route this server knows is mounted, and how it got there (#5822).
 *
 * `RouteEntry` plus `source`: `route-manager` for the routes this server
 * registered itself, `direct-mount` for the ones a bypassing registrar mounted
 * on the same host server and reported through
 * {@link RestServer.recordDirectMountedRoutes}. Both are equally mounted and
 * equally documented; the column exists because the route ledger audits them
 * per source, and because a debugging reader deserves to know which registrar
 * to look in.
 */
export interface MountedRoute extends RouteEntry {
    readonly source: MountedRouteSource;
}

export class RestServer {
    private protocol: RestProtocol;
    private config: NormalizedRestServerConfig;
    private routeManager: RouteManager;
    /**
     * Routes mounted on the SAME host server by a registrar that bypasses
     * `RouteManager`, as reported by the composition step that called it
     * (#5822). Facts, not intentions: a registrar the boot never called
     * contributes nothing here, so `getRoutes()` and the OpenAPI document stay
     * silent about it. See `direct-mount.ts`.
     */
    private readonly directMountedRoutes: MountedRoute[] = [];
    private kernelManager?: RestKernelManager;
    private envRegistry?: RestEnvRegistry;
    /**
     * Host-injected request→environment resolver (ADR-0076 D11 step ④). When
     * present it is the AUTHORITY for unscoped-route environment resolution;
     * the legacy `envRegistry` chain below only runs when this is absent or
     * throws. See {@link RestRequestEnvResolver}.
     */
    private requestEnvResolver?: RestRequestEnvResolver;
    /**
     * Short-TTL cache for `hostname → environmentId` (P1-4). `resolveByHostname`
     * is a control-plane lookup (typically a DB query) that otherwise runs on
     * *every* unscoped request; caching it — including negative results, so
     * unknown hosts don't hammer the registry — removes that per-request cost.
     * The TTL is short so a newly-bound hostname becomes routable quickly.
     */
    private readonly hostnameCache = new Map<string, { value: { environmentId: string } | null; expiresAt: number }>();
    private readonly hostnameCacheTtlMs = 30_000;
    /**
     * Request-scoped memoization for `resolveExecCtx`. A single HTTP request
     * resolves the SAME execution context (identity + RBAC/RLS + localization)
     * many times — the data operation itself, app-nav RBAC filtering, dashboard
     * widget gating, the auth gate, etc. Each resolution is ~16 sequential
     * queries (the `resolveAuthzContext` aggregation plus localization), so a
     * request that resolves twice pays for duplicate authz and repeated
     * localization. Keyed by the per-request `req` object (a `WeakMap`, so the
     * entry is collected with the request — naturally request-scoped, no TTL,
     * no cross-request leak) and the input `environmentId`. We cache the
     * in-flight Promise so concurrent callers share one resolution.
     */
    private readonly execCtxMemo = new WeakMap<object, Map<string, Promise<any | undefined>>>();
    /**
     * [#7912] De-duplication keys for the nav-servability prune log — one line
     * per `app|entry|object|reason` per process. See
     * {@link resolveNavServability}: a console session re-fetches `/meta/app`
     * on every navigation, so an unthrottled warning would bury its own first
     * occurrence. Process-lifetime by design (the set is bounded by the number
     * of dead nav entries authored, not by traffic).
     */
    private readonly navPruneLogged = new Set<string>();
    private defaultEnvironmentIdProvider?: () => string | undefined;
    private authServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private objectQLProvider?: (environmentId?: string) => Promise<any | undefined>;
    private emailServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private sharingServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private reportsServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private approvalsServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private sharingRulesServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private i18nServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private analyticsServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    private settingsServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    /** [ADR-0090] `security` service resolver — used by the
     *  /security/suggested-bindings (D5/D9) and /security/explain (D6)
     *  routes (plugin-security). */
    private securityServiceProvider?: (environmentId?: string) => Promise<any | undefined>;
    /** Sync probe: is a kernel service registered? Single-env path for nav
     *  capability gates (ADR-0057 D10) — resolveExecCtx sets no kernel in
     *  single-kernel deployments, so this prevents the gate failing open. */
    private serviceExistsProvider?: (name: string) => boolean;
    /**
     * [#5224] `metadata` service resolver — the endpoint matcher behind
     * `IMetadataService.matchEndpoint`, and therefore the ONE authority on
     * which declared `api` route the runtime actually serves. Read by the two
     * machine-readable endpoint faces (`GET /meta/api`, `GET /openapi.json`)
     * so neither announces a declaration that answers 404.
     */
    private metadataServiceProvider?: (environmentId?: string) => Promise<unknown>;
    /**
     * One-shot latch for the "no matcher wired" degradation notice below, so a
     * host that never wired {@link metadataServiceProvider} says so once per
     * server rather than once per request.
     */
    private warnedMissingEndpointAuthority = false;
    /**
     * In-flight async import jobs the caller has asked to cancel. The worker
     * checks membership at each progress boundary and stops cooperatively. This
     * is process-local (single-node); the persisted `sys_import_job.status` is
     * the durable source of truth a restarted/other node reads.
     */
    private readonly cancelledImportJobs = new Set<string>();

    constructor(
        server: IHttpServer,
        protocol: RestProtocol,
        config: RestServerConfig = {},
        kernelManager?: RestKernelManager,
        envRegistry?: RestEnvRegistry,
        defaultEnvironmentIdProvider?: () => string | undefined,
        authServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        objectQLProvider?: (environmentId?: string) => Promise<any | undefined>,
        emailServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        sharingServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        reportsServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        approvalsServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        sharingRulesServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        i18nServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        analyticsServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        settingsServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        serviceExistsProvider?: (name: string) => boolean,
        securityServiceProvider?: (environmentId?: string) => Promise<any | undefined>,
        requestEnvResolver?: RestRequestEnvResolver,
        metadataServiceProvider?: (environmentId?: string) => Promise<unknown>,
    ) {
        this.protocol = protocol;
        this.config = this.normalizeConfig(config);
        this.routeManager = new RouteManager(server);
        this.kernelManager = kernelManager;
        this.envRegistry = envRegistry;
        this.defaultEnvironmentIdProvider = defaultEnvironmentIdProvider;
        this.authServiceProvider = authServiceProvider;
        this.objectQLProvider = objectQLProvider;
        this.emailServiceProvider = emailServiceProvider;
        this.sharingServiceProvider = sharingServiceProvider;
        this.reportsServiceProvider = reportsServiceProvider;
        this.approvalsServiceProvider = approvalsServiceProvider;
        this.sharingRulesServiceProvider = sharingRulesServiceProvider;
        this.i18nServiceProvider = i18nServiceProvider;
        this.analyticsServiceProvider = analyticsServiceProvider;
        this.settingsServiceProvider = settingsServiceProvider;
        this.serviceExistsProvider = serviceExistsProvider;
        this.securityServiceProvider = securityServiceProvider;
        this.requestEnvResolver = requestEnvResolver;
        this.metadataServiceProvider = metadataServiceProvider;
    }

    /**
     * Resolve the endpoint matcher for this request — the authority the two
     * machine-readable endpoint faces consult before announcing anything
     * (#5224).
     *
     * Same lookup chain as {@link resolveProtocol}: the per-request kernel when
     * one is resolvable (a multi-tenant host must ask the REQUEST's own
     * matcher, or one environment's declarations would describe another's
     * URLs), else the single-kernel provider `rest-api-plugin` wires.
     *
     * Returns `undefined` when nothing in the chain can answer — including when
     * the resolved occupant of the `metadata` slot carries no `matchEndpoint`,
     * which is a legal shape (the contract method is optional). Callers must
     * decide what an ABSENT authority means for their surface rather than
     * having a verdict invented here; see the call sites.
     */
    private async resolveEndpointMatchAuthority(
        environmentId?: string,
        req?: any,
    ): Promise<EndpointMatchAuthority | undefined> {
        let envId: string | undefined;
        try {
            // Shared resolution entry point (ADR-0076 D11 step 4), the same one
            // `resolveProtocol` / `resolveI18nService` use — so the face reads
            // the matcher of the environment whose items it just enumerated.
            envId = await this.resolveRequestEnvironmentId(environmentId, req);
        } catch { /* fall through to the single-kernel provider */ }

        if (envId && envId !== 'platform' && this.kernelManager) {
            try {
                const kernel = await this.kernelManager.getOrCreate(envId);
                const svc = await kernel.getServiceAsync<unknown>('metadata');
                if (isEndpointMatchAuthority(svc)) return svc;
            } catch { /* fall through */ }
        }
        if (this.metadataServiceProvider) {
            try {
                const svc = await this.metadataServiceProvider(envId);
                if (isEndpointMatchAuthority(svc)) return svc;
            } catch { /* an unreachable provider is an ABSENT authority */ }
        }
        return undefined;
    }

    /**
     * Resolve the `metadata` service for this request — the whole occupant of
     * the slot, unfiltered.
     *
     * The same two-step chain {@link resolveEndpointMatchAuthority} walks
     * (per-request kernel, then the single-kernel provider `rest-api-plugin`
     * wires), separated out because that method narrows its answer to the ONE
     * capability it needs and returns `undefined` for a service that lacks it.
     * A caller after a different optional member (`getPublished`, #7526) must
     * not have "the service is absent" and "the service does not do that"
     * collapsed into one answer before it sees them.
     *
     * `undefined` means nothing in the chain answered. Deciding what an absent
     * service means for a given surface is the call site's business.
     */
    private async resolveMetadataService(environmentId?: string, req?: any): Promise<unknown | undefined> {
        let envId: string | undefined;
        try {
            envId = await this.resolveRequestEnvironmentId(environmentId, req);
        } catch { /* fall through to the single-kernel provider */ }

        if (envId && envId !== 'platform' && this.kernelManager) {
            try {
                const kernel = await this.kernelManager.getOrCreate(envId);
                const svc = await kernel.getServiceAsync<unknown>('metadata');
                if (svc) return svc;
            } catch { /* fall through */ }
        }
        if (this.metadataServiceProvider) {
            try {
                const svc = await this.metadataServiceProvider(envId);
                if (svc) return svc;
            } catch { /* an unreachable provider is an absent service */ }
        }
        return undefined;
    }

    /**
     * Say — once per server — that no endpoint matcher is reachable, so the
     * endpoint faces cannot promise they describe only served routes.
     *
     * Loud rather than silent (AGENTS.md, Route & surface ownership Rule 3):
     * without the authority these surfaces fall back to enumerating what is
     * STORED, which is exactly the pre-#5224 behaviour and exactly the state
     * that can advertise a route answering 404. Reported at `error` because the
     * consequence is a contract face that may lie, and the remedy is a wiring
     * change the operator can make.
     */
    private notifyMissingEndpointAuthority(surface: string): void {
        if (this.warnedMissingEndpointAuthority) return;
        this.warnedMissingEndpointAuthority = true;
        logError(
            `[REST] no endpoint matcher is reachable (no \`metadata\` service with \`matchEndpoint\`), so ${surface} ` +
                `cannot narrow declared \`api\` items to the ones this runtime actually serves. It is enumerating ` +
                `what is STORED instead, which may advertise routes that answer 404. Wire the metadata service ` +
                `into the REST server (rest-api-plugin does this) to restore the guarantee.`,
        );
    }

    /**
     * Resolve the protocol for a given request. When `environmentId` is present
     * and a KernelManager is wired, fetch the per-project kernel's
     * `protocol` service so metadata / data / UI reads hit the project's
     * own registry and datastore.
     *
     * When `environmentId` is absent on an unscoped route and an `envRegistry`
     * is wired (runtime mode), the resolution chain is:
     *   1. Hostname → environmentId (`envRegistry.resolveByHostname`)
     *   2. `X-Environment-Id` header → environmentId (`envRegistry.resolveById`)
     *   3. Default-project fallback (`defaultEnvironmentIdProvider`, set by
     *      `createSingleEnvironmentPlugin`)
     *   4. Control-plane protocol captured at boot.
     *
     * Special case: `environmentId === 'platform'` is a reserved virtual id used
     * by Studio to address the control plane through the regular project
     * URL shape (`/projects/platform/...`). It is NOT a row in the projects
     * table, so we must never call `KernelManager.getOrCreate('platform')`.
     * Instead, return the control-plane protocol directly. This lets Studio
     * (and any other client) speak a single, uniform URL family without
     * duplicating route logic for the platform surface.
     */
    /**
     * Cached wrapper around `envRegistry.resolveByHostname` (P1-4). Returns the
     * cached result while fresh; on a miss it queries the registry and caches the
     * outcome (positive *and* negative) for {@link hostnameCacheTtlMs}. Registry
     * errors are not cached so a transient control-plane blip self-heals on the
     * next request.
     */
    private async resolveHostnameCached(host: string): Promise<{ environmentId: string } | null | undefined> {
        const now = Date.now();
        const hit = this.hostnameCache.get(host);
        if (hit && hit.expiresAt > now) return hit.value;
        const result = (await this.envRegistry!.resolveByHostname(host)) ?? null;
        this.hostnameCache.set(host, { value: result, expiresAt: now + this.hostnameCacheTtlMs });
        return result;
    }

    /**
     * Resolve the environment a request targets. THE single entry point for
     * every unscoped-route environment decision (protocol, i18n, exec-ctx,
     * analytics, …) so they can never disagree about which kernel a request
     * belongs to.
     *
     * Chain: explicit id → host-injected {@link RestRequestEnvResolver}
     * (ADR-0076 D11 step ④ — the dispatcher's ADR-0006 `kernel-resolver`
     * strategy; its normal return, including `undefined`, is final) → legacy
     * built-in chain (tenant hostname → `X-Environment-Id` header) → single-
     * project default. Returns undefined for control-plane requests.
     */
    private async resolveRequestEnvironmentId(environmentId?: string, req?: any): Promise<string | undefined> {
        if (environmentId) return environmentId;
        // 1. Host-injected resolver seam. Where wired (cloud runtime), this is
        //    the SAME strategy instance the HTTP dispatcher uses, so REST and
        //    dispatcher routes always agree on a request's environment —
        //    including the session-driven fallbacks the legacy chain below
        //    never had. Normal returns are final; only a throw degrades to
        //    the legacy chain.
        if (req && this.requestEnvResolver) {
            try {
                return await this.requestEnvResolver.resolveRequestEnvironmentId(req);
            } catch { /* resolver failure → legacy chain */ }
        }
        if (req && this.envRegistry && this.kernelManager) {
            const host = this.extractHostname(req);
            if (host) {
                try {
                    const result = await this.resolveHostnameCached(host);
                    if (result?.environmentId) return result.environmentId;
                } catch {
                    // fall through to next strategy
                }
            }
            // 2. `X-Environment-Id` request header → environmentId. Lets clients
            //    explicitly target a project when the URL is unscoped and
            //    no hostname binding exists (e.g. a single shared origin
            //    serving multiple compiled bundles via OS_PROJECT_ARTIFACTS).
            //    We validate the id through the env registry to avoid
            //    routing to a non-existent kernel.
            if (typeof this.envRegistry.resolveById === 'function') {
                const headerVal = this.extractProjectIdHeader(req);
                if (headerVal) {
                    try {
                        const driver = await this.envRegistry.resolveById(headerVal);
                        if (driver) return headerVal;
                    } catch {
                        // fall through to default fallback
                    }
                }
            }
        }
        // 3. Single-project default fallback. Registered by
        //    `createSingleEnvironmentPlugin()` so bare `/api/v1/data/...` URLs
        //    (no `/projects/<id>` prefix, no hostname mapping, no header)
        //    resolve to the lone project's kernel rather than the control
        //    plane.
        if (this.defaultEnvironmentIdProvider) {
            try {
                const def = this.defaultEnvironmentIdProvider();
                if (def) return def;
            } catch { /* fall through */ }
        }
        return undefined;
    }

    private async resolveProtocol(environmentId?: string, req?: any): Promise<RestProtocol> {
        if (environmentId === 'platform') return this.protocol;
        const envId = await this.resolveRequestEnvironmentId(environmentId, req);
        if (!envId || !this.kernelManager) return this.protocol;
        const kernel = await this.kernelManager.getOrCreate(envId);
        return kernel.getServiceAsync<RestProtocol>('protocol');
    }

    /**
     * Resolve the i18n service for the request's project (or control plane
     * when no project id is in scope). Returns `undefined` when no service is
     * registered, so callers can short-circuit and skip translation rather
     * than failing.
     *
     * Mirrors `resolveProtocol`'s lookup chain: explicit `environmentId` from the
     * route → kernel-managed `i18n` service. Control-plane / unscoped
     * requests intentionally return `undefined` because the platform kernel
     * does not own per-app translation bundles.
     */
    private async resolveI18nService(environmentId?: string, req?: any): Promise<any | undefined> {
        if (environmentId === 'platform') return undefined;
        // Shared resolution entry point (D11④) — previously this method
        // hand-copied the hostname/header/default chain; now every consumer
        // gets the one answer from resolveRequestEnvironmentId.
        environmentId = await this.resolveRequestEnvironmentId(environmentId, req);
        // Multi-tenant kernel lookup first; falls back to the single-kernel
        // provider supplied by RestApiPlugin in dev / standalone mode.
        if (environmentId && this.kernelManager) {
            try {
                const kernel = await this.kernelManager.getOrCreate(environmentId);
                const svc = await kernel.getServiceAsync<any>('i18n');
                if (svc) return svc;
            } catch { /* fall through */ }
        }
        if (this.i18nServiceProvider) {
            try {
                return await this.i18nServiceProvider(environmentId);
            } catch { return undefined; }
        }
        return undefined;
    }

    /**
     * Reject anonymous requests with HTTP 401 — unconditionally (#3963: the
     * `api.requireAuth` opt-out is retired). Returns `true` if the response was
     * sent and the caller should stop
     * processing. Returns `false` to continue.
     *
     * The check is intentionally narrow: only `context?.userId` counts as
     * "authenticated". `isSystem` flags are never set on inbound HTTP
     * requests (they're internal-only), so they cannot bypass this gate.
     */
    private enforceAuth(req: any, res: any, context: any): boolean {
        // ADR-0069 — authentication-policy gate (password expiry, enforced MFA).
        // Independent of the anonymous-deny: a gated session (carrying `authGate`) is
        // blocked from protected resources, while the core allow-list keeps auth
        // + remediation reachable. Runs before the anonymous check.
        const gate = context?.authGate;
        // Exemption requires a REAL, non-empty path — mirrors the sibling seam
        // (`shouldDenyAnonymous`, core/src/security/anonymous-deny.ts:122).
        //
        // ⚠️ `isAuthGateAllowlisted(undefined)` returns `true` (it treats "no
        // path" as allow-listed). Passed the raw value, a request whose `path`
        // is absent or empty read as allow-listed on EVERY route, so the gate
        // did not fire for a session policy says must be blocked — fail-OPEN by
        // omission. No shipped transport reaches here without a `path` (the
        // hono adapter sets it at all three request-construction sites), so this
        // is the default being made safe, not a live bypass being closed (#7432).
        const pathExempt =
            typeof req?.path === 'string' && req.path.length > 0 && isAuthGateAllowlisted(req.path);
        if (gate && req?.method !== 'OPTIONS' && !pathExempt) {
            res.status(403).json({ error: { code: gate.code, message: gate.message } });
            return true;
        }
        // Shared anonymous-deny decision (#2567). Pass no `path`: the REST
        // control-plane routes are registered WITHOUT `enforceAuth`, so this
        // seam only ever guards data/meta — deny unconditionally when anonymous,
        // exactly as before (the allowlist is reserved for a future umbrella
        // seam). `isSystem` is never set on inbound HTTP, so it cannot bypass.
        if (shouldDenyAnonymous({
            userId: context?.userId,
            isSystem: context?.isSystem,
            method: req?.method,
        })) {
            res.status(ANONYMOUS_DENY_STATUS).json(ANONYMOUS_DENY_BODY);
            return true;
        }
        return false;
    }

    /**
     * Enforce object-level API exposure (ObjectSchema `enable.apiEnabled` /
     * `enable.apiMethods`) on the REST data surface — the *external* API boundary
     * only. Internal callers (hooks, flows, raw objectql) are unaffected, which is
     * the point: `apiEnabled` controls automatic API exposure, not data access.
     *
     * - `enable.apiEnabled === false` → object hidden from the API (404, so its
     *   existence isn't revealed).
     * - `enable.apiMethods` (non-empty whitelist) → unlisted operations rejected (405).
     *
     * Default-allow: objects with no `enable` block (or `apiEnabled` unset/true and
     * no `apiMethods` whitelist) behave exactly as before — no regression. A
     * metadata-read failure does not block (the data call itself needs the same
     * metadata and will surface the error). Returns `true` when the request was
     * blocked (response already sent).
     *
     * ## Unknown objects (#3770)
     *
     * An object this gate cannot find in metadata is passed through — there is no
     * declared exposure policy to enforce on it, so there is nothing for this gate
     * to decide. What CLOSES it is downstream, and it is worth naming precisely
     * because the previous note here named the wrong thing ("let the data path
     * 404" — a fallback that did not exist):
     *
     *  1. `protocol.assertObjectRegistered` (#3770) rejects every data entry point
     *     for an object absent from the schema registry with 404
     *     `OBJECT_NOT_FOUND`, BEFORE the engine turns the name into a table name.
     *     That is the real 404, and unlike the old assumption it does not depend
     *     on a driver happening to error on a missing table — which is why an
     *     unregistered object whose physical table DID exist used to be served.
     *  2. plugin-security's `getObjectSecurityMeta` (#3545) reports an
     *     `unresolved` posture for the same object, and the engine middleware,
     *     `canExport` and `getReadableFields` fail CLOSED on it.
     *
     * Neither is a reason to widen this gate: (1) is the existence answer and (2)
     * is the authorization answer. Do not relax the pass-through on the assumption
     * that some other layer 404s — verify which one, as #3770 did.
     *
     * See ADR-0049 (#1889): shipping a non-enforcing `apiEnabled` is false security.
     */
    private async enforceApiAccess(
        req: any,
        res: any,
        p: RestProtocol,
        environmentId: string | undefined,
        operation: string,
        opts?: ApiAccessOpts,
    ): Promise<boolean> {
        const objectName = req?.params?.object;
        if (!objectName) return false;
        const items = await this.loadObjectItems(p, environmentId);
        const obj = items.find((o: any) => o?.name === objectName);
        // [#3770] Unknown object → no declared exposure policy to enforce here;
        // the data path's registry gate 404s it. See the doc comment above.
        if (!obj) return false;
        const denial = apiAccessDenialFromEnable(obj.enable, objectName, operation, opts);
        if (denial) {
            res.status(denial.status).json(denial.body);
            return true;
        }
        return false;
    }

    /**
     * [#3939] Enforce the deployment's batch-size cap on a bulk write route.
     * Returns `true` when a response was sent (the caller must return).
     *
     * The cap was declared in three places in `batch.zod.ts` (`.max(200)` on
     * `BatchUpdateRequestSchema` / `UpdateManyRequestSchema` /
     * `DeleteManyRequestSchema`, plus "max 200" in the docs) and enforced in
     * exactly one route — the cross-object `/batch`, which checked the
     * CONFIGURED `maxBatchSize` rather than the hardcoded 200. Every per-object
     * bulk route accepted an unbounded list.
     *
     * That went from nuisance to real with #3897: `deleteMany` now deletes per
     * id by primary key (so `deleteBehavior` cascades run and each row gets its
     * own result), which turns a 10k-id body into 10k sequential engine
     * round-trips inside one request instead of one statement.
     *
     * The cap is deployment policy — `RestServerConfig.batch.maxBatchSize`
     * (1..1000, default 200) — so it lives here and the schemas carry shape
     * only. One place decides it, and it is the place that knows the
     * deployment's configured value.
     */
    private enforceBatchSize(res: any, count: number, max: number, object?: string): boolean {
        if (count <= max) return false;
        res.status(400).json({
            error: `Batch too large: ${count} records (max ${max})`,
            code: 'BATCH_TOO_LARGE',
            count,
            max,
            ...(object ? { object } : {}),
        });
        return true;
    }

    /**
     * [#3544] Enforce the USER-LEVEL export axis on a bulk-egress route, after
     * {@link enforceApiAccess} has cleared the object-level one. Returns `true`
     * when a response was sent (the caller must return).
     *
     * The two gates answer different questions and so carry different statuses:
     * `enforceApiAccess` is about the OBJECT ("does this object expose export at
     * all" → 405), this one is about the CALLER ("may YOU export it" → 403).
     *
     * It has to exist as its own check because `export ⊆ list`: the export route
     * streams through `findData`, which the engine middleware sees as a plain
     * `find` and gates on `allowRead`. Nothing downstream ever looks at
     * `allowExport`, so without this the bit would only hide the client's Export
     * button while `curl` still drained the table — declared, not enforced
     * (AGENTS.md Prime Directive #10).
     *
     * Fail stance mirrors the deployment's own posture. No security service (no
     * `plugin-security`, so no permission sets exist anywhere) → allow, matching
     * every other permission gate here and `/me/permissions`' documented
     * fail-open. Service PRESENT but unable to answer → fail CLOSED: it resolves
     * permission sets to decide, and a resolution failure must never read as a
     * grant (ADR-0049).
     */
    private async enforceExportPermission(
        req: any,
        res: any,
        environmentId: string | undefined,
        objectName: string,
        context: any,
    ): Promise<boolean> {
        const security = await this.resolveSecurityService(environmentId, req);
        if (!security || typeof security.canExport !== 'function') return false;
        let allowed: boolean;
        try {
            allowed = await security.canExport(objectName, context);
        } catch {
            allowed = false; // access-narrowing answer → a throw is a denial
        }
        if (allowed) return false;
        res.status(403).json({
            code: 'EXPORT_NOT_PERMITTED',
            error: `Export is not permitted on object '${objectName}' for this user`,
            object: objectName,
        });
        return true;
    }

    /**
     * Load the object metadata items for the current protocol/environment,
     * coerced to a plain array. Returns `[]` when metadata is unavailable so
     * callers fail OPEN (the data call itself needs the same metadata and will
     * surface any real error). Shared by `enforceApiAccess` (one object) and the
     * cross-object batch route (all ops, fetched once).
     */
    private async loadObjectItems(p: RestProtocol, environmentId: string | undefined): Promise<any[]> {
        try {
            const r: any = await (p as any).getMetaItems?.({
                type: 'object',
                ...(environmentId ? { environmentId } : {}),
            });
            return Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
        } catch (err) {
            // [#3545] The API-exposure gate fails OPEN when object metadata can't
            // be read: the exposure whitelist is a SURFACE-AREA control, not the
            // authorization boundary (auth + CRUD/FLS/RLS still enforce on the
            // data call, which needs the same metadata and surfaces the real
            // error), and failing closed here would 405 every request during the
            // normal cold-start window. But a THROWN read is a real fault
            // (metadata store down / corrupt schema doc), NOT a legitimately-empty
            // registry (a `[]` return, e.g. a fresh deployment) — so LOG it. Left
            // silent, a persistent metadata outage, during which the gate allows
            // every operation unchecked, is indistinguishable from healthy
            // operation. Still returns `[]` (fail-open preserved). See #3545.
            logWarn(
                '[REST] api-exposure gate: object metadata read failed — failing open ' +
                    '(auth + CRUD/FLS/RLS still enforce on the data call)',
                (err as Error)?.message ?? err,
            );
            return [];
        }
    }

    /**
     * Resolve the request's execution context (RBAC/RLS/FLS) by looking up
     * the better-auth session via the project's `auth` service. Returns
     * `undefined` for anonymous requests so callers can pass `context` as-is
     * to the protocol layer (the SecurityPlugin treats undefined as anon).
     */
    private async resolveExecCtx(environmentId: string | undefined, req: any): Promise<any | undefined> {
        // Request-scoped memoization — see `execCtxMemo`. The same `req` flows
        // unchanged through every handler call, so its identity keys the memo;
        // the input `environmentId` is part of the key because one host can route
        // multiple environments. Anonymous (`undefined`) resolutions are cached
        // too so repeat callers don't re-run getSession. Fall back to a direct
        // resolve when there is no object to key on.
        if (!req || typeof req !== 'object') return this.computeExecCtx(environmentId, req);
        const key = environmentId ?? '\u0000default';
        let perReq = this.execCtxMemo.get(req);
        if (!perReq) { perReq = new Map(); this.execCtxMemo.set(req, perReq); }
        const cached = perReq.get(key);
        if (cached) return cached;
        const pending = this.computeExecCtx(environmentId, req);
        perReq.set(key, pending);
        return pending;
    }

    /**
     * [#7033 / #7023] Resolve a caller's execution context for a DIRECT-MOUNT
     * package route (`@objectstack/rest`'s `registerPackageRoutes`), which does
     * not run inside a `registerXxxEndpoints` handler and so cannot reach the
     * private {@link resolveExecCtx} on its own. The package gate reads the
     * SAME identity/RBAC resolution the `/meta` REST gate does — never a second
     * source — so the two capability cohorts cannot drift. `environmentId` comes
     * from the scoped route param (`/environments/:environmentId/packages`) when
     * present, `undefined` for the unscoped mount.
     */
    resolvePackageRouteExecutionContext(req: any): Promise<any | undefined> {
        const environmentId = req?.params?.environmentId ?? undefined;
        return this.resolveExecCtx(environmentId, req).catch(() => undefined);
    }

    /**
     * [#7749] The acting identity recorded on a metadata WRITE — the single
     * producer for every `/meta` route that stamps an `actor` (save, delete,
     * publish, rollback, compound save).
     *
     * ## What was wrong
     *
     * All five sites resolved the actor inline as
     *
     * ```
     * req.headers['x-actor'] ?? req.headers['X-Actor'] ?? req.user?.id ?? req.userId
     * ```
     *
     * and NOTHING on this transport ever sets `req.user` or `req.userId` —
     * this server resolves identity through {@link resolveExecCtx} (better-auth
     * → `resolveAuthzContext`), which puts it on the returned ExecutionContext,
     * never back onto the raw request. So a bearer-authenticated admin's PUT
     * yielded `undefined`, and the protocol's own defaults took over: the audit
     * row recorded the sentinel `'system'` (`recordMetadataAudit`:
     * `actor ?? 'system'`) and the history row recorded `NULL` (#4556:
     * `actor ?? null`). The trail could not answer "who changed this" for any
     * client that did not know to hand-set a non-standard header.
     *
     * The two dead limbs are not widened here with a third — that would leave
     * the same "a value everything reads and nothing writes" shape one level
     * down. They are replaced by the identity resolution this server actually
     * performs, the SAME one the route's own `manage_metadata` capability gate
     * reads a few lines earlier, so the caller a write is ATTRIBUTED to can
     * never drift from the caller it was AUTHORIZED against. `resolveExecCtx`
     * is memoized per request, so the three routes that already resolved a
     * context for their gate pay nothing extra for this.
     *
     * ## Precedence — deliberately unchanged (#7749)
     *
     * `X-Actor` still outranks the authenticated identity, exactly as the
     * expression above read. That ordering was masked while the other limbs
     * were always `undefined`; it becomes load-bearing the moment this method
     * produces one. Whether an authenticated caller may keep attributing a
     * metadata write to somebody else by sending a header is a security
     * semantics question for the audit contract, not something to settle as a
     * side effect of fixing the producer — so it is measured and reported on
     * the issue rather than quietly reordered here.
     *
     * Anonymous / internal writes are unaffected: no resolved principal → no
     * context → `undefined` → the protocol's `'system'` / `NULL` defaults still
     * apply. A machine write is never stamped with a real user.
     */
    private async resolveMetaWriteActor(
        environmentId: string | undefined,
        req: any,
    ): Promise<string | undefined> {
        const header = req?.headers?.['x-actor'] ?? req?.headers?.['X-Actor'];
        // A well-formed header wins, as before. A PRESENT-but-unusable header
        // (repeated → array, or empty) falls through to the session rather than
        // suppressing attribution: recording the real caller beats recording
        // `'system'` for a malformed request, and it keeps "no usable header →
        // the authenticated identity" a single rule.
        if (typeof header === 'string' && header) return header;
        const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
        const userId = (ctx as any)?.userId;
        return typeof userId === 'string' && userId ? userId : undefined;
    }

    /**
     * [ADR-0046 §6.7] The audience-evaluation view of the caller for book/doc
     * gating. `permissionSets` resolves through the security service's
     * `resolvePermissionSetNames` — the SAME resolution as data-plane
     * enforcement (positions expanded, additive baseline), so the docs gate
     * can never drift from it. `permissionSets` stays undefined when the
     * service is absent or resolution fails; `audienceAllows` then DENIES
     * permission-set-gated audiences (fail closed, ADR-0049). Resolution is
     * skipped unless `needPermissionSets` — callers pass true only when a
     * `{ permissionSet }` audience is actually in play.
     */
    private async resolveAudienceCaller(
        environmentId: string | undefined,
        req: any,
        opts: { needPermissionSets: boolean },
    ): Promise<{ authenticated: boolean; permissionSets?: string[] }> {
        const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
        const authenticated = !!ctx?.userId;
        if (!authenticated || !opts.needPermissionSets || !this.securityServiceProvider) {
            return { authenticated };
        }
        try {
            const svc = await this.securityServiceProvider(environmentId);
            if (!svc || typeof svc.resolvePermissionSetNames !== 'function') return { authenticated };
            const names = await svc.resolvePermissionSetNames(ctx);
            return { authenticated, permissionSets: Array.isArray(names) ? names : [] };
        } catch {
            return { authenticated }; // unresolved holdings → gated audiences deny
        }
    }

    /**
     * Canonical SINGULAR form of the `:type` path segment.
     *
     * The metadata routes accept either spelling — the protocol's `getMetaItems`
     * normalizes singular↔plural and serves both — and Prime Directive #3 makes
     * PLURAL the canonical REST spelling (`/api/v1/meta/books`). So every gate
     * keyed on the type must compare against the normalized form. The three
     * ADR-0046 §6.7 audience gates below each tested `req.params.type === 'book'`
     * literally, which meant `GET /meta/books` served the list with the gate
     * never running: a `{ permissionSet }`-gated book (an *Admin Guide*) came
     * back to a caller who does not hold the set, and an `org` book came back to
     * an anonymous reader on a publicly-served deployment. Same route, gate
     * enforced on one spelling of it.
     *
     * Calling this at each gate is NOT the durable form — #6241 proved it.
     * Eight days after #3984, the single-item read's cache-branch condition
     * still excluded `doc`/`book` by literal comparison, so the plural read
     * skipped the branch that holds the gate and the same authorization hole
     * came back on the same route. The handlers therefore normalize ONCE at
     * the top (`const metaType = RestServer.metaTypeSingular(req.params.type)`)
     * and every gate reads that local: a gate added later has no raw param in
     * scope to compare against.
     */
    private static metaTypeSingular(type: unknown): string {
        const t = typeof type === 'string' ? type : '';
        return PLURAL_TO_SINGULAR[t] ?? t;
    }

    /**
     * [#3963] Is this request a READ of the audience-gated book/doc surface —
     * the one metadata surface whose own declaration (`book.audience`) can
     * authorize an anonymous caller?
     *
     * Used by the `/meta` umbrella gate to grant an anonymous caller
     * REACHABILITY of these three routes, so `audience: 'public'` works on a
     * secure-by-default deployment instead of only on one that opened its whole
     * data plane. Authorization stays with the handler's §6.7 gate, which admits
     * `'public'` only.
     *
     * The predicate is keyed on the REGISTERED route path plus the normalized
     * `:type` param — not on `req.path` string-matching — so a route added later
     * cannot accidentally fall inside it, and the plural spelling cannot fall
     * outside it (#3984).
     */
    private static isPublicAudienceRead(
        entry: Readonly<Record<string, unknown>>,
        req: { method?: unknown; params?: Record<string, unknown> },
    ): boolean {
        const method = String(req?.method ?? entry?.method ?? '').toUpperCase();
        if (method !== 'GET') return false; // reads only — never a write or a publish
        const path = typeof entry?.path === 'string' ? entry.path : '';
        // `GET /meta/book/:name/tree` — the type segment is literal here.
        if (path.endsWith('/book/:name/tree')) return true;
        // `GET /meta/:type` and `GET /meta/:type/:name` — book/doc only. Every
        // other type (object, field, view, flow, …) keeps the anonymous deny.
        if (!/\/:type(\/:name)?$/.test(path)) return false;
        const type = RestServer.metaTypeSingular(req?.params?.type);
        return type === 'book' || type === 'doc';
    }

    /** Whether any of these books carries a `{ permissionSet }` audience. */
    private static anyPermissionSetAudience(books: readonly any[]): boolean {
        return books.some(
            (b) => b && typeof b === 'object' && b.audience && typeof b.audience === 'object'
                && typeof b.audience.permissionSet === 'string',
        );
    }

    /** Coerce a getMetaItems result (array | {items}) into an array. */
    private static metaItemsArray(raw: unknown): any[] {
        if (Array.isArray(raw)) return raw;
        if (raw && typeof raw === 'object' && Array.isArray((raw as any).items)) return (raw as any).items;
        return [];
    }

    /** Fetch every book of the environment, shaped for the audience resolver. */
    private async fetchAudienceBooks(p: any, environmentId: string | undefined): Promise<any[]> {
        const raw = await p.getMetaItems({
            type: 'book',
            ...(environmentId ? { environmentId } : {}),
        } as any).catch(() => []);
        return RestServer.metaItemsArray(raw).map((b: any) =>
            b && typeof b === 'object' ? { ...b, packageId: b._packageId } : b,
        );
    }

    /** Heavy path behind `resolveExecCtx` — resolve identity + RBAC/RLS + localization. */
    private async computeExecCtx(environmentId: string | undefined, req: any): Promise<any | undefined> {
        try {
            // For multi-tenant hosts (objectos), incoming requests on unscoped
            // URLs like `/api/v1/data/:object` arrive with `environmentId === undefined`.
            // Resolve through the shared entry point (D11④) so getSession()
            // finds the right per-project auth service — the same answer the
            // route's protocol resolver got. Without this, hostname-routed
            // requests fall through to defaultEnvironmentIdProvider/
            // authServiceProvider (neither of which is wired in objectos) and
            // every authenticated user sees 401.
            environmentId = await this.resolveRequestEnvironmentId(environmentId, req);
            // Look up the auth service in the right kernel. For unscoped
            // single-environment apps the kernelManager will hand us the lone
            // tenant kernel; for multi-environment hosts we use the resolved
            // environmentId.
            let authService: any;
            let kernel: any;
            if (environmentId && environmentId !== 'platform' && this.kernelManager) {
                kernel = await this.kernelManager.getOrCreate(environmentId);
                authService = await kernel.getServiceAsync('auth').catch(() => undefined);
            }
            if (!authService && this.defaultEnvironmentIdProvider && this.kernelManager) {
                try {
                    const def = this.defaultEnvironmentIdProvider();
                    if (def) {
                        kernel = await this.kernelManager.getOrCreate(def);
                        authService = await kernel.getServiceAsync('auth').catch(() => undefined);
                    }
                } catch { /* fall through */ }
            }
            // Single-kernel deployment fallback — no kernelManager, but
            // the plugin wired an `authServiceProvider` that hits the
            // local kernel directly.
            if (!authService && this.authServiceProvider) {
                authService = await this.authServiceProvider(environmentId).catch(() => undefined);
            }
            if (!authService) return undefined;
            // The auth service may be the AuthManager wrapper (which exposes
            // `getApi()`) or the raw better-auth instance (which exposes
            // `.api` directly). Normalize to the raw API object.
            let api: any = authService.api;
            if (!api && typeof authService.getApi === 'function') {
                api = await authService.getApi();
            }
            if (!api?.getSession) return undefined;

            // better-auth's `getSession` requires a Web `Headers` instance
            // (it calls `headers.get('cookie')`). Adapter req.headers may
            // already be one, or a plain object — normalize.
            const rawHeaders: any = req?.headers;
            let headers: any;
            if (rawHeaders && typeof rawHeaders.get === 'function') {
                headers = rawHeaders;
            } else if (rawHeaders && typeof rawHeaders === 'object') {
                headers = new (globalThis as any).Headers();
                for (const [k, v] of Object.entries(rawHeaders)) {
                    if (Array.isArray(v)) v.forEach((x) => headers.append(k, String(x)));
                    else if (v != null) headers.set(k, String(v));
                }
            } else {
                return undefined;
            }

            // Resolve the data engine for this scope (shared by the resolver below).
            const ql: any = kernel
                ? await kernel.getServiceAsync('objectql').catch(() => undefined)
                : (this.objectQLProvider ? await this.objectQLProvider(environmentId).catch(() => undefined) : undefined);

            // Delegate ALL identity + role/permission/RLS aggregation to the SINGLE
            // shared resolver (`resolveAuthzContext`, @objectstack/core) — the same one
            // the runtime dispatcher uses, so the REST and dispatcher entry points can
            // never drift on authorization. (This path previously kept its own copy that
            // silently omitted sys_user_position / sys_position_permission_set / platform_admin /
            // ai_seat — see the resolver's module doc.)
            const getSession = async (h: any) => {
                try { return await api.getSession({ headers: h }); } catch { return undefined; }
            };
            // [#8287] The EFFECTIVE tenancy posture, from the kernel's `tenancy`
            // service — the same source plugin-security reconciles for the Layer 0
            // wall, so API-key admission and the wall agree. Absent ⇒ undefined ⇒
            // no posture-conditional refusal (behaviour unchanged).
            let tenancyPosture;
            try {
                tenancyPosture = effectiveTenancyPosture(await kernel.getServiceAsync('tenancy') as any);
            } catch {
                tenancyPosture = undefined;
            }
            const authz = await resolveAuthzContext({ ql, headers, getSession, tenancyPosture });
            // [#6216] The anonymous contract IS the shared assembler's default
            // entry: no resolved principal → no context → 401. Taken early here
            // only so an anonymous request does not pay for the localization and
            // auth-gate reads it would never use; `assembleExecutionContext`
            // below re-affirms the same rule.
            if (!authz.userId) return undefined;

            const settings = this.settingsServiceProvider
                ? await this.settingsServiceProvider(environmentId).catch(() => undefined)
                : undefined;
            const localization = await resolveLocalizationContext({
                ql,
                settings,
                tenantId: authz.tenantId,
                userId: authz.userId,
            });

            // ADR-0069 — authentication-policy gate posture. Only when a gate
            // feature is active (cheap sync check) do we re-read the session for
            // its `user.authGate` (computed in customSession). enforceAuth() then
            // blocks protected resources for a gated user. Zero cost when off.
            //
            // [#7280] Normalized through the shared `normalizeAuthGate` instead
            // of copied verbatim: the session user crosses an external boundary
            // as `any`, and `ExecutionContext.authGate` now DECLARES the shape
            // (`{ code, message }`), so this is where the declaration is met —
            // a gate with a blank message no longer rides into a 403 body as
            // `undefined`.
            let authGate: AuthGate | undefined;
            try {
                if (typeof authService.isAuthGateActive === 'function' && authService.isAuthGateActive()) {
                    const gatedSession: any = await getSession(headers).catch(() => undefined);
                    authGate = normalizeAuthGate(gatedSession?.user) ?? undefined;
                }
            } catch { /* gate is best-effort — never break context resolution */ }

            // [#6216 — maintainer ruling 2026-08-08, Option A] The assembly of
            // the ExecutionContext itself is now the SINGLE shared one
            // (`assembleExecutionContext`, @objectstack/core), the same module
            // the runtime / MCP dispatcher assembles through. Before this, the
            // step AFTER `resolveAuthzContext` was two hand-written copies and
            // the copies drifted: #6071 (this face never set `principalKind`,
            // so every enforcement judgment reading it was silently never-true
            // here) and #6206 / #6551 (a dropped `accessible_org_ids` produced
            // real 403s on the share-link faces). The field set is closed by
            // type there, so a new `ExecutionContext` field cannot land on one
            // face and miss another.
            //
            // This face takes the FAIL-CLOSED DEFAULT entry — no resolved
            // principal → no context → `enforceAuth` answers 401. The runtime
            // face takes the explicit guest entry instead. Both behaviours are
            // unchanged; the divergence is now named API rather than drift.
            const base = assembleExecutionContext({
                authz,
                // OAuth access tokens are honoured on the `/mcp` door alone
                // (`acceptOAuthAccessToken`), precisely so coarse tool-family
                // scopes cannot ride onto REST — so `principalKind: 'agent'`,
                // `onBehalfOf` and `oauthScopes` are not representable here.
                oauth: undefined,
                localization,
                // [#3957] The request's OWN locale wins over the workspace
                // default; the precedence itself lives in the shared assembler.
                requestLocale: this.extractLocale(req),
                // A NAMED divergence, deliberately preserved (#6216): this
                // transport has never carried the better-auth session bearer on
                // the envelope, and `ExecutionContext.accessToken` is a
                // PUBLISHED hook surface (`session.accessToken`, hook.zod.ts).
                // Widening it to a second transport is a product decision, not
                // a refactor — so REST withholds it on the record.
                accessToken: undefined,
                // [ADR-0069 / #7280] This face DOES carry the gate: its consumer
                // is ten lines up (`enforceAuth` → 403 `{ code, message }`). It
                // used to be spread on AFTER assembly behind an `as any`, which
                // is precisely how it stayed outside the closed field set; it is
                // a declared `ExecutionContext` field and an assembler input now.
                authGate,
            });
            // Unreachable: the anonymous early-return above already took this
            // branch. Kept because the shared entry — not this method — is the
            // authority on what an anonymous request yields.
            if (!base) return undefined;

            const execCtx = {
                ...base,
                // Internal: resolved kernel so the nav-serving path can probe
                // requiresService capability gates (ADR-0057 D10). NOT an
                // authorization input — never read by RLS/permission logic, and
                // NOT an `ExecutionContext` field — hence the cast, which now
                // covers this key alone.
                __kernel: kernel,
            } as any;

            // [#2408 / #3361] Open the per-request `Server-Timing` disclosure gate
            // for an admin/service principal — the REST-server analog of the runtime
            // dispatcher's `timedResolveExecutionContext`. This is the SOLE gate-opener
            // on the `os serve`/`dev` data + metadata routes (which the RestServer
            // owns, shadowing the Hono plugin's CRUD): without it the documented
            // admin-gated `X-OS-Debug-Timing` path never emits on the standard server.
            // A no-op when perf-tuning is off or already global (no ambient gate), and
            // the memoized resolve runs once per request so the gate opens exactly once.
            if (isPerfDisclosurePrincipal(execCtx)) allowPerfDisclosure();

            return execCtx;
        } catch {
            return undefined;
        }
    }

    /**
     * Filter an `App` metadata item by the current user's `systemPermissions`.
     *
     * - Drops the app entirely when it is UNPUBLISHED (`_unpublished: true`,
     *   ADR-0045 §3) and the caller is not a builder. Note the key: `hidden` is
     *   navigation presentation and is deliberately NOT consulted (#4829).
     * - Drops the app entirely if its top-level `requiredPermissions` are not
     *   a subset of the user's system permissions.
     * - Recursively strips child navigation entries (groups, items) whose
     *   `requiredPermissions` are not satisfied. Empty groups collapse so
     *   the sidebar doesn't render a label with no children — [#7380] a
     *   `type: 'group'` with no SURVIVING children is dropped whether it was
     *   emptied by the gate or authored `children: []`. Only `group` collapses;
     *   an `object` entry is its own target and is served however many children
     *   it has. See the rule at the `filterNav` branch for the measurement.
     * - [#4722] Applies the SAME item gate to every `areas[].navigation` tree.
     *   Both trees are the same shape and the keys mean the same thing in both,
     *   so `filterNav` is reused — there is deliberately no second
     *   implementation to drift. Before this, an item gated inside an area was
     *   enforced by the shell alone: the entry (with its `objectName` /
     *   `pageName` / `componentRef` target) still shipped in the `/meta` body,
     *   so reading the JSON defeated it.
     * - [#7912] SERVABILITY: drops a `type: 'object'` entry whose destination
     *   object could not answer a `list` for anyone — see `servabilityGate`.
     *
     * NOT gated here: `visible` (CEL) at any level, and `requiresObject` — both
     * are still evaluated client-side only. That asymmetry is deliberate and
     * pinned in `rest.test.ts`: server-side CEL needs a bound `user` context
     * that this layer does not have, and is its own change.
     *
     * ⚠️ [#7912] `requiresObject` STAYS on that list, and the servability gate
     * is not it wearing a new hat. `requiresObject` asks whether the named
     * object is REGISTERED — a question about deployment composition, whose
     * answer this filter deliberately leaves to the client (the maintainer
     * ruling of 2026-08-12 rejected re-meaning the key server-side precisely
     * because the docblock calls that asymmetry deliberate). The servability
     * gate asks a different question of an object that IS registered: does its
     * own `enable` block let the destination answer at all? An entry whose
     * object this layer cannot find is therefore SERVED, not pruned — the
     * `requiresObject` pin and #3770's "no declared policy ⇒ nothing to
     * enforce" both survive unchanged.
     *
     * Returns `null` when the app should be withheld from the user entirely.
     * Returns a shallow copy with filtered `navigation` / `areas` otherwise —
     * the original is never mutated so cached metadata stays clean.
     *
     * Takes the **app document itself**, never the `getMetaItem` envelope
     * (#5563). Both callers now hand it a document: the list path always did,
     * and the single-item route unwraps `.item` once, gates the document, and
     * rebuilds the envelope around the result. Filtering an envelope would be a
     * silent no-op (its `.navigation` is undefined), bypassing BOTH
     * `requiredPermissions` and the ADR-0057 D10 `requiresService` gate — which
     * is why this used to sniff the shape. There is one shape now.
     */
    private filterAppForUser(
        item: any,
        sysPerms: Set<string>,
        serviceGate?: (name: string) => boolean,
        servabilityGate?: NavServabilityGate,
    ): any | null {
        return this.filterAppForUserWithReason(item, sysPerms, serviceGate, servabilityGate).app;
    }

    /**
     * {@link filterAppForUser}, plus WHICH gate withheld the app.
     *
     * The gate above collapses three different refusals into one `null`, and for
     * the LIST route that is exactly right — every one of them means "not in
     * your list". The by-name route is where they stop being the same answer
     * (#8013).
     *
     * ## Why the caller needs the reason
     *
     * `GET /meta/app/<name>` answered a 404-equivalent for all three, so an
     * app the session may never use and an app that does not exist were
     * BYTE-IDENTICAL on the wire. The console has nothing to branch on, so it
     * renders its only copy for an absent app — "it may still be publishing" —
     * over a permanent authorization denial. Measured cost (objectui#4252): two
     * acceptance-test batches spent chasing a "platform defect" that was a
     * missing permission-set binding.
     *
     * ## Only ONE of the three converts, and that is the whole design
     *
     * The maintainer ruling (2026-08-12) licenses an explicit denial for
     * `permission` alone. The other two keep answering absence, for reasons
     * that are not stylistic:
     *
     *  - `unpublished` — ADR-0045 §3 says an unpublished app is *externally
     *    unobservable*, not merely unlisted. A 403 confirms existence, which is
     *    precisely what that contract withholds; `meta-app-publish-gate.test.ts`
     *    has pinned the 404-over-403 choice since #4829 and it stands.
     *  - `service` — an absent optional kernel service (ADR-0057 D10) is a
     *    deployment fact about the platform, not a statement about this caller.
     *    Nothing is denied TO the session, so there is no denial to report.
     *
     * That partition is the security boundary of #8013, and it cuts one way
     * only: a denial for `permission` makes an app the caller may not use
     * observable BY NAME, which the ruling accepts because a by-name probe
     * already implies the name. Widening it to a name that resolves to nothing
     * would make every app name on the platform enumerable — a different and
     * unruled change. Hence `withheld` is set from the branch that fired, never
     * inferred from `app == null` at the call site.
     *
     * Ordering is load-bearing for the same reason: `unpublished` is judged
     * FIRST, so an app that is both unpublished and permission-gated reports
     * `unpublished` and stays absent. ADR-0045 §3 wins over the disclosure.
     */
    private filterAppForUserWithReason(
        item: any,
        sysPerms: Set<string>,
        serviceGate?: (name: string) => boolean,
        servabilityGate?: NavServabilityGate,
    ): { app: any | null; withheld?: 'unpublished' | 'permission' | 'service' } {
        if (!item || typeof item !== 'object') return { app: item };
        // ADR-0045 §3 (as revised 2026-08, #4829) — the publish gate. An
        // UNPUBLISHED app is externally unobservable, not merely unlisted: only
        // builders (studio/setup access) receive it at all, for direct-URL
        // preview. THIS is the visibility gate; the launcher's client-side
        // filtering is a listing courtesy.
        //
        // ⛔ It judges `_unpublished`, the machine-managed key, and NOT `hidden`.
        // `hidden` is navigation presentation — "not in the App Switcher, reach
        // it from the avatar menu" — and reading it here made those two
        // contracts one boolean. #4829 measured the cost: `account`, the
        // platform's own personal-settings app, is authored `hidden: true` for
        // exactly the reason its spec docblock gives, so this branch erased it
        // from `GET /meta/app` for every user without builder access — password,
        // avatar, sessions, inbox all 404 — while any admin saw a healthy
        // system. A hidden app is fully routable and permission-checked here;
        // only `_unpublished` withholds it.
        if (item._unpublished === true && !sysPerms.has('studio.access') && !sysPerms.has('setup.access')) {
            return { app: null, withheld: 'unpublished' };
        }
        const reqApp = Array.isArray(item.requiredPermissions) ? item.requiredPermissions : [];
        if (reqApp.length > 0 && !reqApp.every((p: string) => sysPerms.has(p))) {
            return { app: null, withheld: 'permission' };
        }
        // ADR-0057 D10 — capability gate: hide when the named kernel service is
        // absent. Fail-open when the gate can't be probed (serviceGate undefined).
        if (typeof item.requiresService === 'string' && serviceGate && serviceGate(item.requiresService) === false) {
            return { app: null, withheld: 'service' };
        }
        const nav = Array.isArray(item.navigation) ? item.navigation : null;
        const areas = Array.isArray(item.areas) ? item.areas : null;
        if (!nav && !areas) return { app: item };

        const filterNav = (entries: any[]): any[] => {
            const out: any[] = [];
            for (const e of entries) {
                if (!e || typeof e !== 'object') continue;
                const req = Array.isArray(e.requiredPermissions) ? e.requiredPermissions : [];
                if (req.length > 0 && !req.every((p: string) => sysPerms.has(p))) continue;
                if (typeof e.requiresService === 'string' && serviceGate && serviceGate(e.requiresService) === false) continue;
                // [#7912] SERVABILITY — the gate this filter had no vocabulary
                // for. A `type: 'object'` entry names its destination in
                // `objectName`; the object's own `enable` block decides whether
                // a `list` can be answered there, and that decision takes no
                // user, no permissions and no context. So an entry whose
                // destination is API-disabled (404 `OBJECT_API_DISABLED`) or
                // whose whitelist omits `list` (405
                // `OBJECT_API_METHOD_NOT_ALLOWED`) is dead for EVERY persona,
                // platform admin included — which is why no combination of
                // `requiredPermissions` on the entry could ever prune it
                // (#7544 shipped exactly that combination for a year).
                //
                // The verdict comes from the same derivation the data route
                // enforces (`apiExposureDenialReason`, #3391), reached through
                // the gate the caller built — never a second reading of
                // `enable` here.
                if (servabilityGate && e.type === 'object' && typeof e.objectName === 'string') {
                    const appName = typeof item.name === 'string' ? item.name : '(unnamed)';
                    if (servabilityGate(e.objectName, e, appName) === false) continue;
                }
                // [#7380] A `group` is judged on what SURVIVES, never on how it
                // got there. Both childless shapes render the same dead sidebar
                // label, so both are dropped:
                //   - BECAME empty — authored with children, all gated away;
                //   - STARTED empty — authored `children: []`.
                // The old guard (`children.length > 0`) sent the second shape
                // down the else branch, which never reaches the drop rule, so a
                // declared-empty group shipped as a bare label the docblock
                // above already promised it would not. That shape is not a
                // corner case: `setup.app.ts` is authored entirely out of it —
                // nine `children: []` contribution slots (ADR-0029 D7) that
                // `Registry.applyNavContributions` fills on read, BEFORE this
                // filter runs. So a slot a capability plugin filled arrives here
                // with children and survives; a slot left empty because its
                // capability is disabled arrives `[]` and is now dropped, which
                // is exactly the "a disabled capability contributes nothing and
                // its slot stays empty" case `setup.app.ts` documents.
                //
                // The rule is `type === 'group'` ONLY, and stays that way. The
                // union nests on two branches (`NAV_VARIANTS_ACCEPTING_CHILDREN`
                // = `object` | `group`), and an `object` entry is its own
                // navigation target — `{ type: 'object', objectName: 'lead',
                // children: [] }` is a live link to the lead list, not a label,
                // so emptiness says nothing about whether to serve it. A group
                // cannot be a target: `GroupNavItemSchema` is a `strictObject`
                // over the base keys plus `expanded`/`children` and declares no
                // `objectName` / `pageName` / `componentRef` / `url` — it
                // REJECTS them — and its docblock reads "Does not perform
                // navigation itself." Measured against that before the change
                // (#7380): 41 `type: 'group'` entries across the shipped apps
                // (`account`, `setup`, `studio`), the examples (`app-crm`,
                // `app-showcase`, `app-todo`) and the spec's nav type-assertion
                // fixtures. 16 are childless — the 9 `setup` slots and 7 spec
                // fixtures; the three example apps have none — and ZERO of the
                // 41 carry `objectName` / `pageName` / `componentRef` / `url` or
                // any other target. So the drop is unconditional: there is no
                // standalone childless-group shape in the tree to spare.
                //
                // A group with NO `children` key is covered by the same rule for
                // the same reason — same dead label. It is unreachable through
                // the spec (`children` is required on both the input and output
                // group branches; `app.nav-type-assertions.ts` pins that with a
                // `@ts-expect-error`), but this filter reads untyped documents
                // off the metadata store, so leaving it out would just reopen
                // the bypass one keyword over.
                if (Array.isArray(e.children)) {
                    const kids = filterNav(e.children);
                    if (e.type === 'group' && kids.length === 0) continue;
                    out.push({ ...e, children: kids });
                } else {
                    if (e.type === 'group') continue;
                    out.push(e);
                }
            }
            return out;
        };

        // [#4722] `areas[]` carries no gate of its own — the area-level `visible`
        // / `requiredPermissions` keys were retired in 17.0.0 (#4651, ADR-0049)
        // and are NOT revived here. What is enforced is the gate on the items
        // INSIDE an area, through the very same `filterNav` the top-level tree
        // uses, so the two trees can never disagree about what a key means.
        //
        // Collapse rule: an area whose authored tree is emptied BY the gate is
        // dropped (a bare area label with nothing reachable under it is not a
        // useful response), while an area authored `navigation: []` is passed
        // through untouched — filtering reports what the caller may not see, it
        // does not tidy the metadata.
        //
        // [#7380] That second half is where an area and a `group` now DIVERGE,
        // deliberately: `filterNav` drops a childless group however it got that
        // way, an area authored empty still ships. The reason is what the two
        // shapes are. A group is a sidebar label and nothing else, so childless
        // it renders dead — and the shipped `setup` app authors nine of them as
        // contribution SLOTS, which makes "declared empty" the normal steady
        // state of an unfilled one rather than an authoring slip. An area is a
        // top-level workspace the shell can select and route to on its own; an
        // author who ships `navigation: []` has declared an area that is not
        // populated yet, and this filter is not the layer that judges that.
        // What is NOT divergent is the walk: an area whose entries are all
        // childless groups empties through the very same `filterNav` and is
        // dropped by the rule above — one implementation, as everywhere else.
        const filterAreas = (list: any[]): any[] => {
            const out: any[] = [];
            for (const a of list) {
                if (!a || typeof a !== 'object') continue;
                const anav = Array.isArray(a.navigation) ? a.navigation : null;
                if (!anav || anav.length === 0) { out.push(a); continue; }
                const kids = filterNav(anav);
                if (kids.length === 0) continue;
                out.push({ ...a, navigation: kids });
            }
            return out;
        };

        return {
            app: {
                ...item,
                ...(nav ? { navigation: filterNav(nav) } : {}),
                ...(areas ? { areas: filterAreas(areas) } : {}),
            },
        };
    }

    /**
     * ADR-0057 D10 (dashboards): strip dashboard widgets whose `requiresService`
     * capability gate names a kernel service that isn't registered — the same
     * "server is the authoritative visibility gate" rule already applied to app
     * nav entries (see {@link filterAppForUser}). Without this, a widget bound to
     * an optional service renders a dead tile in deployments where the service is
     * off (e.g. the Organizations KPI under multi-tenant `org-scoping`, which is
     * absent in a single-tenant runtime while its nav entry is correctly hidden).
     *
     * Fail-open when the gate can't be probed (serviceGate undefined). Never
     * mutates the original — returns a shallow copy only when a widget is dropped.
     *
     * Takes the **dashboard document**, never the `getMetaItem` envelope — see
     * {@link filterAppForUser} for why that distinction stopped being a runtime
     * question in #5563.
     */
    private filterDashboardForUser(item: any, serviceGate?: (name: string) => boolean): any {
        if (!item || typeof item !== 'object' || !serviceGate) return item;
        if (!Array.isArray(item.widgets)) return item;
        const widgets = item.widgets.filter(
            (w: any) => !(w && typeof w.requiresService === 'string' && serviceGate(w.requiresService) === false),
        );
        return widgets.length === item.widgets.length ? item : { ...item, widgets };
    }

    /**
     * Probe which `requiresService` capability gates referenced anywhere in
     * `items` are actually registered in the runtime kernel. Returns `null`
     * when the kernel can't be probed — callers then SKIP service gating
     * (fail-open, matching the prior "send everything, let the client hide"
     * behaviour). ADR-0057 addendum D10.
     *
     * `items` are metadata **documents** (#5563) — the single-item route
     * unwraps the envelope before probing, exactly as it does before gating.
     */
    private async resolveRegisteredServices(kernel: any, items: any[]): Promise<Set<string> | null> {
        // Prefer the per-request kernel (multi-env, resolved via kernelManager).
        // Fall back to the single-env service-existence provider — in single-kernel
        // deployments resolveExecCtx never sets a kernel, so without this the gate
        // would fail open (ADR-0057 D10).
        let probe: ((name: string) => Promise<boolean>) | null = null;
        if (kernel && typeof kernel.getServiceAsync === 'function') {
            probe = async (name) => { try { return (await kernel.getServiceAsync(name)) != null; } catch { return false; } };
        } else if (this.serviceExistsProvider) {
            const exists = this.serviceExistsProvider;
            probe = async (name) => { try { return exists(name) === true; } catch { return false; } };
        }
        if (!probe) return null;
        const wanted = new Set<string>();
        const walk = (e: any): void => {
            if (!e || typeof e !== 'object') return;
            if (typeof e.requiresService === 'string') wanted.add(e.requiresService);
            // [#4722] EVERY child list, not the first one that happens to be an
            // array. An app may carry `navigation` AND `areas` at once, and now
            // that `filterAppForUser` gates the trees under `areas[]` too, a
            // service named only in there must be probed — an unprobed name is
            // absent from `registered`, and the gate would read that as "service
            // missing" and strip a live entry. Fail-closed by omission is still
            // wrong; the probe set must cover exactly what the gate walks.
            for (const key of ['navigation', 'areas', 'children', 'widgets'] as const) {
                const kids = (e as any)[key];
                if (Array.isArray(kids)) for (const k of kids) walk(k);
            }
        };
        for (const it of items) walk(it);
        if (wanted.size === 0) return new Set();
        const registered = new Set<string>();
        for (const name of wanted) { if (await probe(name)) registered.add(name); }
        return registered;
    }

    /**
     * [#7912] Build the nav-servability gate for one request: which objects can
     * actually answer a `list` on the external REST surface.
     *
     * ## Shape, and why it mirrors `resolveRegisteredServices`
     *
     * Same contract as the ADR-0057 D10 service gate one method up: resolve the
     * facts ONCE per request, hand `filterAppForUser` a closure, and return
     * `null` when the facts cannot be established so the caller skips the gate
     * entirely. Nav filtering already runs over a whole app list; re-reading
     * object metadata per entry would turn one read into dozens.
     *
     * ## Fail-open, in three distinct cases — each deliberate
     *
     *  1. **Metadata unreadable** — `loadObjectItems` answers `[]` and logs.
     *     This method then answers `null` (no gate), so nothing is pruned. The
     *     alternative fails CLOSED during every cold start, emptying the
     *     sidebar of a healthy deployment; #3545 already settled that trade for
     *     the data-route twin and the same reasoning binds harder here, where
     *     the consequence is a user staring at an app with no navigation.
     *  2. **Object not in metadata** — served. There is no declared exposure
     *     policy to enforce (#3770), and "is this object registered at all?" is
     *     `requiresObject`'s question, which this layer deliberately does not
     *     answer (see {@link filterAppForUser}).
     *  3. **No `enable` block** — served, by `apiExposureDenialReason`'s own
     *     default-open contract. An object that declares nothing restricts
     *     nothing.
     *
     * Only case (3)'s opposite — a declared `enable` that refuses `list` — ever
     * prunes.
     *
     * ## The prune is LOGGED, never silent
     *
     * The maintainer ruling of 2026-08-12 makes the author-visible diagnostic a
     * mandatory companion, not an optional one: "a prune the author cannot see
     * is the same failure one layer over — no silent dead rows, and no silent
     * repairs." The authoring-time half of that is
     * `validate-nav-object-servability` in `@objectstack/lint`, which refuses
     * the stack at `os validate` / `os build` / `os lint` before it can ever be
     * served. This log is the serving-side half, for an entry that reached a
     * running deployment anyway (a `sys_metadata` overlay row, or a stack built
     * before the lint existed): it names the app, the entry id, the object AND
     * the condition, so the pruned row is discoverable from the server log
     * rather than being an unexplained gap in a menu.
     *
     * One line per `app|entry|object|reason` per process — a console session
     * re-fetches `/meta/app` on every navigation, and an unthrottled log would
     * bury the first occurrence under thousands of repeats.
     */
    private async resolveNavServability(
        p: RestProtocol,
        environmentId: string | undefined,
    ): Promise<NavServabilityGate | null> {
        const items = await this.loadObjectItems(p, environmentId);
        // Case (1): nothing to judge with. `loadObjectItems` has already logged
        // a THROWN read; a legitimately empty registry is silent and equally
        // ungated, which is correct — an empty registry declares no policy.
        if (items.length === 0) return null;
        const enableByName = new Map<string, any>();
        for (const o of items) {
            if (o && typeof o.name === 'string') enableByName.set(o.name, o.enable);
        }
        return (objectName: string, entry: any, appName: string): boolean => {
            // Case (2): unknown object → no declared policy to enforce here.
            if (!enableByName.has(objectName)) return true;
            const reason = apiExposureDenialReason(enableByName.get(objectName), 'list');
            if (!reason) return true;
            const entryId = (entry && (entry.id ?? entry.label)) ?? '(unnamed)';
            const key = `${appName}|${entryId}|${objectName}|${reason}`;
            if (!this.navPruneLogged.has(key)) {
                this.navPruneLogged.add(key);
                logWarn(
                    `[REST] [#7912] nav entry '${entryId}' pruned from app '${appName}': its destination ` +
                        `object '${objectName}' cannot serve a list — ` +
                        (reason === 'api-disabled'
                            ? `\`enable.apiEnabled: false\` (the list answers 404 OBJECT_API_DISABLED for every user).`
                            : `\`enable.apiMethods\` does not grant \`list\` (the list answers 405 ` +
                              `OBJECT_API_METHOD_NOT_ALLOWED for every user).`) +
                        ` Remove the entry, or expose the object — \`os validate\` refuses this stack ` +
                        `(nav-object-unservable).`,
                );
            }
            return false;
        };
    }

    /**
     * Build a `TranslationBundle` (`Record<locale, TranslationData>`) from an
     * `II18nService` instance. Returns `undefined` when no locales are
     * registered so callers can avoid translation work.
     */
    private buildTranslationBundle(i18n: any): any | undefined {
        if (!i18n || typeof i18n.getLocales !== 'function' || typeof i18n.getTranslations !== 'function') {
            return undefined;
        }
        const locales: string[] = i18n.getLocales();
        if (!locales.length) return undefined;
        const bundle: Record<string, any> = {};
        for (const locale of locales) {
            const data = i18n.getTranslations(locale);
            if (data && typeof data === 'object') bundle[locale] = data;
        }
        return Object.keys(bundle).length ? bundle : undefined;
    }

    /**
     * [#8284] The packaged (code-layer) base declaration of an OBJECT, for the
     * localization boundary — `translateObject`'s
     * `TranslateDocumentOptions.packagedBase`.
     *
     * The i18n catalog is keyed by object name and is the packaged translation
     * of the packaged declaration, so it must yield to any scalar that has
     * been authored on top of that declaration: a code-shipped
     * `objectExtensions` label, and the tenant's own Studio rename — which
     * answered `200` and then appeared on neither of the two reads a writable
     * form derives from (maintainer ruling 2026-08-13; the comparison itself
     * lives in `@objectstack/spec/system`, which is where the rule belongs —
     * this method only hands it the value it cannot see).
     *
     * `undefined` on every uncertainty, and that is contractual rather than
     * defensive: the spec-side rule reads absence as "no baseline known" and
     * falls back to the pre-#8284 `catalog ?? document`, so a host whose
     * protocol predates this method (or a partial protocol double) keeps
     * exactly the behaviour it has today instead of losing its translations.
     *
     * Feature-detected because `RestProtocol` is the ADR-0076 D9 wire slice
     * and server-only extensions are detected via runtime casts rather than
     * widening it — the same shape `getMetaItemLayered` is consumed with.
     */
    private packagedObjectBase(p: any, type: string, name: unknown): unknown {
        if (type !== 'object') return undefined;
        if (typeof name !== 'string' || name === '') return undefined;
        if (!p || typeof p.getPackagedObjectBase !== 'function') return undefined;
        try {
            return p.getPackagedObjectBase(name);
        } catch {
            return undefined;
        }
    }

    /**
     * Parse the highest-priority locale from an `Accept-Language` header.
     * Falls back to a `?locale=` query parameter, then to the i18n service's
     * default locale. Returns `undefined` when no preference is expressed
     * (callers will then return untranslated metadata).
     */
    private extractLocale(req: any, i18n?: any): string | undefined {
        const headers = req?.headers;
        let header: string | undefined;
        if (headers) {
            header = typeof headers.get === 'function'
                ? headers.get('accept-language') ?? undefined
                : headers['accept-language'] ?? headers['Accept-Language'];
        }
        // Shared parse — the runtime dispatcher resolves the same header the
        // same way, so a message and the labels around it can't disagree (#3957).
        const preferred = preferredLocaleFromHeader(header);
        if (preferred) return preferred;
        // [#6877] One of the read points that was ALREADY safe: the `typeof`
        // guard sends a repeated `?locale=` to the i18n default rather than
        // into the array arm. Left as a guard rather than converted to the
        // refusal gate because this helper is shared by ~10 routes and has no
        // `res` — refusing here would need every caller to thread one through,
        // for a parameter whose worst case is falling back to the default
        // locale. Recorded so the asymmetry reads as a decision.
        const queryLocale = req?.query?.locale;
        if (typeof queryLocale === 'string' && queryLocale.length > 0) return queryLocale;
        if (i18n && typeof i18n.getDefaultLocale === 'function') {
            const def = i18n.getDefaultLocale();
            if (typeof def === 'string' && def.length > 0) return def;
        }
        return undefined;
    }

    /**
     * An `II18nService.t`-compatible lookup for the request's environment, or
     * `undefined` when no i18n service is registered. Handed to the import
     * runner so its own messages resolve a deployment's `validation.field.*`
     * overrides — the engine gets the same hook via `ObjectQLPlugin` (#3957).
     */
    private async resolveMessageTranslator(
        environmentId: string | undefined,
        req: any,
    ): Promise<((key: string, locale: string, params?: Record<string, unknown>) => string) | undefined> {
        const i18n = await this.resolveI18nService(environmentId, req);
        if (!i18n || typeof i18n.t !== 'function') return undefined;
        return (key, locale, params) => i18n.t(key, locale, params);
    }

    /**
     * Translate a single metadata **document** (view or action) when an i18n
     * service is registered for the request's project and the requested
     * locale yields a match. Falls through unchanged for unsupported types
     * or missing translations.
     *
     * Takes the document, never the `getMetaItem` envelope (#5563): nav/field
     * labels live on the document, so translating an envelope's top level
     * (which has no `navigation`) would leave the menu untranslated. Route
     * handlers that hold an envelope go through
     * {@link translateMetaEnvelope} instead of asking, at runtime, which shape
     * they were handed.
     */
    private async translateMetaItem(req: any, type: string, environmentId: string | undefined, item: any, i18nService?: any): Promise<any> {
        if (!item || typeof item !== 'object') return item;
        // [#6349] Normalize HERE, not at the call sites. `isTranslatableMetaType`
        // reads `TRANSLATABLE_METADATA_TYPES`, which is DERIVED from
        // `METADATA_DOCUMENT_TRANSLATORS`' keys — and those are singular-only
        // (`view`/`action`/`object`/`app`/`dashboard`/`page`), matching
        // `translateMetadataDocument`'s "Canonical metadata type string". The
        // `/meta` handlers hand this helper the RAW `:type` path segment, and
        // Prime Directive #3 makes PLURAL the canonical REST spelling, so the
        // documented spelling missed the set and the whole localization was
        // skipped: same route, same document, `?locale=zh-CN`, only the
        // spelling differing —
        //
        //     singular "app"  :: label = "XLABELX"  ← translated
        //     plural   "apps" :: label = "Setup"    ← raw English
        //
        // This is #3984's family (per-type judgements seeing only the singular)
        // landing on the i18n predicate instead of on a gate. It folds at the
        // HELPER rather than at the four call sites for the reason #6241 proved
        // the hard way: a normalization the callers own is one a later caller
        // forgets. The helper owns "does this type translate", so it owns the
        // spelling that question is asked in. `metaTypeSingular` leaves an
        // unmapped type untouched, so nothing that was untranslatable becomes
        // translatable — the set is unchanged, only the spellings that reach it.
        const metaType = RestServer.metaTypeSingular(type);
        if (!(await isTranslatableMetaType(metaType))) return item;
        // The cached read path resolves the i18n service up-front (to build a
        // locale-aware ETag) and passes it here so we don't repeat the
        // potentially registry-hitting lookup on every request.
        const i18n = i18nService !== undefined ? i18nService : await this.resolveI18nService(environmentId, req);
        // A missing bundle is NOT a bail-out: `translateMetadataDocument`
        // still applies built-in fallbacks (e.g. the injected system-field
        // labels `owner_id`/`created_*`/`updated_*` on custom objects, which
        // ship no per-object translation entries).
        const bundle = this.buildTranslationBundle(i18n);
        const locale = this.extractLocale(req, i18n);
        if (!locale) return item;
        const { translateMetadataDocument } = await import('@objectstack/spec/system');
        // [#8284] The packaged baseline the catalog is a translation OF — see
        // `packagedObjectBase`. Resolved through the request's own protocol so
        // a multi-tenant read asks the kernel that actually serves it.
        const packagedBase = metaType === 'object'
            ? this.packagedObjectBase(
                await this.resolveProtocol(environmentId, req).catch(() => undefined),
                metaType,
                (item as any)?.name,
            )
            : undefined;
        return translateMetadataDocument(metaType, item, bundle, { locale, packagedBase });
    }

    /**
     * Translate the document inside a `GET /meta/:type/:name` response
     * envelope and hand the envelope back with that document in place.
     *
     * This is the ONE place the single-item read paths rebuild their response
     * body, so every one of them — cached, non-cached, compound-name — answers
     * the spec's `GetMetaItemResponseSchema` shape (#5563). `envelope` supplies
     * the identity and the ADR-0008 OCC carriers (`lock`, `provenance`, …);
     * `document` is the (possibly RBAC-filtered, possibly locale-collapsed)
     * metadata document that belongs under `item`.
     */
    private async translateMetaEnvelope(
        req: any,
        type: string,
        environmentId: string | undefined,
        envelope: Record<string, any>,
        document: any,
        i18nService?: any,
    ): Promise<any> {
        return {
            ...envelope,
            item: await this.translateMetaItem(req, type, environmentId, document, i18nService),
        };
    }

    /**
     * Serve the three-layer diagnostic projection (`code` / `overlay` /
     * `effective`) declared by `GetMetaItemLayeredResponseSchema`.
     *
     * ONE implementation behind TWO entry points (#5882): the canonical
     * `GET /meta/:type/:name/layers`, and the deprecated
     * `GET /meta/:type/:name?layers=true` it replaces. Extracted rather than
     * duplicated precisely because the deprecation window's promise is that the
     * old spelling answers *the same body* — two copies would let that stop
     * being true without anything failing.
     *
     * Not translated and not cached, both deliberately: this is a diagnostic
     * view of what is STORED at each layer, so locale-collapsing it (or serving
     * it from the published-value cache) would misreport the thing being
     * diagnosed.
     */
    private async serveMetaItemLayered(
        req: any,
        res: any,
        environmentId: string | undefined,
        p: any,
        maskPosture: ObjectSchemaMaskPosture,
    ): Promise<void> {
        // ADR-0048 — thread `?package=` so the layered (Studio editor) view is
        // package-scoped; the editor passes the edited item's owning package,
        // not the studio app's.
        //
        // [#6877] ONE owning package, so repetition is refused rather than
        // resolved: `?package=a&package=b` used to reach
        // `getMetaItemLayered({ packageId: ['a','b'] })`. Gated in the helper,
        // not in its two callers, so both entry points answer identically.
        if (refuseRepeatedQueryParams(req, res, ['package'])) return;
        const layeredPackageId = req.query?.package || undefined;
        const layered = await p.getMetaItemLayered({
            type: req.params.type,
            name: req.params.name,
            ...(layeredPackageId ? { packageId: layeredPackageId } : {}),
            ...(environmentId ? { environmentId } : {}),
        });
        // [ADR-0106 D5(4)] The layered view is a schema-bearing exit —
        // `code`, `overlay` and `effective` are each a full object schema.
        // Both entry points (the canonical `/layers` path and the deprecated
        // `?layers=` flag) pass their request's resolved posture in, so the
        // extraction cannot turn the mask into a one-entry-point detour.
        if (maskPosture.kind === 'project') {
            for (const layer of ['code', 'overlay', 'effective'] as const) {
                const masked = this.maskObjectDocument(
                    res, maskPosture, req.params.name, (layered as any)?.[layer],
                );
                if (!masked) return;
                if (layered && typeof layered === 'object') (layered as any)[layer] = masked.document;
            }
        }
        if (maskPosture.kind === 'undetermined') {
            res.header('Cache-Control', 'private, no-store');
        }
        res.json(layered);
    }

    /**
     * [ADR-0106 D2/D4/D6/D7/D8] Build this request's object-schema masker — a
     * per-object-name posture resolver whose caller context and `security`
     * service are resolved ONCE.
     *
     * Every exit that serves object schemas (single cached, single uncached,
     * layered, compound-name, and the list read) goes through the returned
     * function, so "which outlets mask" is one decision rather than five
     * (ADR-0106 D5 — "every schema-serving outlet, or the mask is decoration").
     *
     * Answers the not-applicable passthrough for every non-`object` type, so a
     * call site can stand unconditionally at an exit that serves all types.
     * `metaType` must be the NORMALIZED type (`/meta/objects/x` is the canonical
     * plural spelling; a gate comparing the raw param is a gate the canonical
     * spelling walks past — #3984 / #6241).
     *
     * The returned function REJECTS with {@link ObjectSchemaMaskEvaluationError}
     * on D6 tier 3 — the security service threw. Call sites answer 5xx via
     * {@link sendFieldVisibilityFault}; they must never fall back to the
     * unmasked body.
     */
    private async resolveObjectMasker(
        environmentId: string | undefined,
        req: any,
        metaType: string,
    ): Promise<(objectName: string) => Promise<ObjectSchemaMaskPosture>> {
        if (metaType !== 'object' || !this.config.metadata.maskObjectFields) {
            const fixed: ObjectSchemaMaskPosture = metaType !== 'object'
                ? OBJECT_SCHEMA_MASK_NOT_APPLICABLE
                : { kind: 'passthrough', reason: 'disabled' };
            return async () => fixed;
        }
        // Resolved ONCE per request, not once per item: the list read asks the
        // same caller about every object it serves.
        const context = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
        const security = await this.resolveSecurityService(environmentId, req);
        const telemetry = {
            warn: (message: string, meta: Record<string, unknown>) => logWarn(message, meta),
            counter: (name: string, labels: Record<string, string>) => {
                // Best-effort: the D6 middle tier must be OBSERVABLE, but a
                // deployment without a metrics registry still serves the read.
                // The structured warn above is the floor.
                try {
                    (context as any)?.__kernel?.getService?.(OBSERVABILITY_METRICS_SERVICE)?.counter?.(name, labels);
                } catch { /* metrics are never load-bearing */ }
            },
        };
        return (objectName: string) => resolveObjectSchemaMaskPosture({
            objectName,
            context,
            security: security as any,
            enabled: true,
            telemetry,
        });
    }

    /**
     * Apply {@link resolveObjectMaskPosture}'s verdict to one served document
     * (ADR-0106 D1/D3).
     *
     * Returns `null` after answering 5xx when the projection would leave the
     * schema with no fields at all — `getReadableFields` answers `[]` only where
     * its own posture read failed closed (#3545), and D6 rules an empty-fields
     * `200` out ("silently wrong UI **and** cacheable poison").
     */
    private maskObjectDocument<T>(
        res: any,
        posture: ObjectSchemaMaskPosture,
        objectName: string,
        document: T,
    ): { document: T; fingerprint: string } | null {
        const masked = applyObjectSchemaMask(document, posture);
        if (masked.emptied) {
            sendFieldVisibilityFault(res, objectName);
            return null;
        }
        return { document: masked.document, fingerprint: masked.fingerprint };
    }

    /**
     * Translate a list of metadata documents using `translateMetaItem`.
     *
     * Normalizes the `:type` spelling for the same reason, and on the same
     * terms, as {@link translateMetaItem} — see the note there (#6349). The
     * list route is one of the three that hands this the raw path segment, and
     * splitting the fix (list normalized, single-item not) would trade one
     * missing translation for the far harder "the list is localized but the
     * detail page it links to is not".
     */
    private async translateMetaItems(req: any, type: string, environmentId: string | undefined, items: any): Promise<any> {
        const metaType = RestServer.metaTypeSingular(type);
        if (!(await isTranslatableMetaType(metaType))) return items;
        // `getMetaItems` may hand back a bare array or an `{ items: [...] }`
        // envelope. Unwrap so list responses are localized the same way the
        // single-item route is; a non-array, non-envelope value is returned
        // untouched.
        const arr: any[] | null = Array.isArray(items)
            ? items
            : (items && typeof items === 'object' && Array.isArray(items.items) ? items.items : null);
        if (!arr) return items;
        const i18n = await this.resolveI18nService(environmentId, req);
        // Missing bundle ≠ bail-out — see `translateMetaItem`.
        const bundle = this.buildTranslationBundle(i18n);
        const locale = this.extractLocale(req, i18n);
        if (!locale) return items;
        const { translateMetadataDocument } = await import('@objectstack/spec/system');
        // [#8284] One protocol resolution for the whole page; the lookup
        // itself is a synchronous in-memory registry read per element.
        const p = metaType === 'object'
            ? await this.resolveProtocol(environmentId, req).catch(() => undefined)
            : undefined;
        // `getMetaItems` elements are metadata documents (the list envelope is
        // the OUTER `{ type, items }`), so every element translates directly —
        // #5563 removed the per-element shape sniff that stood here.
        const translated = arr.map((item) => translateMetadataDocument(metaType, item, bundle, {
            locale,
            packagedBase: this.packagedObjectBase(p, metaType, item?.name),
        }));
        return Array.isArray(items) ? translated : { ...items, items: translated };
    }

    /**
     * Translate the `entries` payload returned by `getMetaTypes()` — applies
     * the active locale to each entry's `label`, `description`, and the
     * nested `form` layout (section labels, field labels, helpText,
     * placeholders) via `metadataForms.<type>` translation namespace.
     *
     * No-ops when no i18n service / locale / matching bundle entry exists,
     * so this is safe to call unconditionally from the `/meta` handler.
     */
    private async translateMetaTypesResponse(req: any, environmentId: string | undefined, payload: any): Promise<any> {
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entries)) return payload;
        const i18n = await this.resolveI18nService(environmentId, req);
        const bundle = this.buildTranslationBundle(i18n);
        if (!bundle) return payload;
        const locale = this.extractLocale(req, i18n);
        if (!locale) return payload;
        const {
            resolveMetadataTypeLabel,
            resolveMetadataTypeDescription,
            resolveMetadataFormLabels,
        } = await import('@objectstack/spec/system');
        const opts = { locale } as const;
        const entries = payload.entries.map((entry: any) => {
            if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') return entry;
            const next: any = { ...entry };
            next.label = resolveMetadataTypeLabel(bundle, entry.type, entry.label ?? entry.type, opts);
            const desc = resolveMetadataTypeDescription(bundle, entry.type, entry.description, opts);
            if (desc !== undefined) next.description = desc;
            if (entry.form) {
                next.form = resolveMetadataFormLabels(entry.form, entry.type, bundle, opts);
            }
            return next;
        });
        return { ...payload, entries };
    }

    /**
     * Pull the request hostname (without port) from a Node-style `req` or
     * a Fetch-style request wrapper. Returns undefined when no Host header
     * is available.
     */
    private extractHostname(req: any): string | undefined {
        const headers = req?.headers;
        let host: string | undefined;
        if (headers) {
            if (typeof headers.get === 'function') {
                host = headers.get('host') ?? undefined;
            } else {
                host = headers.host ?? headers.Host;
            }
        }
        if (!host && typeof req?.hostname === 'string') host = req.hostname;
        if (!host && typeof req?.url === 'string') {
            // Fetch-style requests expose the hostname via `req.url` even
            // when the (forbidden) `Host` header has been stripped by the
            // runtime. This branch keeps hostname-routing working when
            // tests build a `Request` object through `app.fetch(...)`.
            try {
                host = new (globalThis as any).URL(req.url).host;
            } catch { /* ignore */ }
        }
        if (!host) return undefined;
        return String(host).split(':')[0].toLowerCase();
    }

    /**
     * Pull the `X-Environment-Id` header from a Node- or Fetch-style request.
     * Header names are case-insensitive; we probe both casings to cover
     * adapters that don't normalize headers (e.g. raw Node http).
     */
    private extractProjectIdHeader(req: any): string | undefined {
        const headers = req?.headers;
        if (!headers) return undefined;
        let val: unknown;
        if (typeof headers.get === 'function') {
            val = headers.get('x-environment-id') ?? headers.get('X-Environment-Id');
        } else {
            val = headers['x-environment-id'] ?? headers['X-Environment-Id'];
        }
        if (Array.isArray(val)) val = val[0];
        if (typeof val !== 'string') return undefined;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    
    /**
     * Normalize configuration with defaults
     */
    private normalizeConfig(config: RestServerConfig): NormalizedRestServerConfig {
        const api = (config.api ?? {}) as Partial<RestApiConfig>;
        const crud = (config.crud ?? {}) as Partial<CrudEndpointsConfig>;
        const metadata = (config.metadata ?? {}) as Partial<MetadataEndpointsConfig>;
        const batch = (config.batch ?? {}) as Partial<BatchEndpointsConfig>;
        const routes = (config.routes ?? {}) as Partial<RouteGenerationConfig>;
        
        return {
            api: {
                version: api.version ?? 'v1',
                basePath: api.basePath ?? '/api',
                apiPath: api.apiPath,
                enableCrud: api.enableCrud ?? true,
                enableMetadata: api.enableMetadata ?? true,
                enableUi: api.enableUi ?? true,
                enableBatch: api.enableBatch ?? true,
                enableDiscovery: api.enableDiscovery ?? true,
                enableOpenApi: (api as any).enableOpenApi ?? true,
                enableSearch: (api as any).enableSearch ?? true,
                enableProjectScoping: api.enableProjectScoping ?? false,
                projectResolution: api.projectResolution ?? 'auto',
                documentation: api.documentation,
                responseFormat: api.responseFormat,
            },
            crud: {
                // Per key, not per object: since ADR-0122 `crud.operations` is the
                // AUTHOR state, so a caller may enable three of the five and leave the
                // rest to the schema's own per-key `.default(true)`. `??` on the whole
                // object would only have filled it when it was absent entirely.
                operations: {
                    create: crud.operations?.create ?? true,
                    read: crud.operations?.read ?? true,
                    update: crud.operations?.update ?? true,
                    delete: crud.operations?.delete ?? true,
                    list: crud.operations?.list ?? true,
                },
                patterns: crud.patterns,
                dataPrefix: crud.dataPrefix ?? '/data',
                objectParamStyle: crud.objectParamStyle ?? 'path',
            },
            metadata: {
                prefix: metadata.prefix ?? '/meta',
                enableCache: metadata.enableCache ?? true,
                cacheTtl: metadata.cacheTtl ?? 3600,
                // [ADR-0106 D8] Default ON — masking is the platform default and
                // ships with the current major. Read through `as any` for the
                // same reason `api.enableOpenApi` / `api.enableSearch` above are:
                // `MetadataEndpointsConfigSchema` lives in `packages/spec` and
                // giving this key a declared seat there is a separate change.
                // `isObjectSchemaMaskingEnabled` also honours the
                // `OS_ALLOW_UNMASKED_OBJECT_METADATA` escape hatch, which is the
                // knob the runtime `/metadata` dispatcher shares (it has no REST
                // config to read).
                maskObjectFields: isObjectSchemaMaskingEnabled((metadata as any).maskObjectFields),
                endpoints: {
                    types: metadata.endpoints?.types ?? true,
                    items: metadata.endpoints?.items ?? true,
                    item: metadata.endpoints?.item ?? true,
                    schema: metadata.endpoints?.schema ?? true,
                },
            },
            batch: {
                maxBatchSize: batch.maxBatchSize ?? 200,
                enableBatchEndpoint: batch.enableBatchEndpoint ?? true,
                operations: {
                    createMany: batch.operations?.createMany ?? true,
                    updateMany: batch.operations?.updateMany ?? true,
                    deleteMany: batch.operations?.deleteMany ?? true,
                    upsertMany: batch.operations?.upsertMany ?? true,
                },
                defaultAtomic: batch.defaultAtomic ?? true,
            },
            routes: {
                includeObjects: routes.includeObjects,
                excludeObjects: routes.excludeObjects,
                nameTransform: routes.nameTransform ?? 'none',
                overrides: routes.overrides,
            },
        };
    }
    
    /**
     * The full API base path — THE base for this deployment's REST surface.
     *
     * [#6306] Public because it is the single source of truth, not merely a
     * convenience: `rest-api-plugin.ts` threads this very value into the
     * direct-mount registrars (`packages.*`, `datasources/:name/external/*`)
     * so those nine routes mount under the same prefix as everything the
     * RouteManager registers. It used to recompute `${basePath}/${version}`
     * for itself, which silently dropped `apiPath` — the two expressions
     * agree only while `apiPath` is unset, so a deployment that set it got
     * two API prefixes at once: 83 routes under `{apiPath}` and 9 left behind
     * at `/api/v1`, invisible to `{apiPath}/openapi.json` (whose section is
     * filtered to this base) and to `/discovery`.
     *
     * The fix is the SHARING, not the expression: do not copy the `??` chain
     * to a second site — copying it is precisely how the divergence happened.
     * Call this.
     */
    getApiBasePath(): string {
        const { api } = this.config;
        return api.apiPath ?? `${api.basePath}/${api.version}`;
    }

    /**
     * Get the project-scoped base path for a given unscoped base.
     * Example: `/api/v1` → `/api/v1/environments/:environmentId`.
     */
    private getScopedBasePath(basePath: string): string {
        return `${basePath}/environments/:environmentId`;
    }

    /**
     * Register all REST API routes
     *
     * When `enableProjectScoping` is true, routes are registered under
     * `/api/v1/environments/:environmentId/...`. The `projectResolution` strategy
     * controls whether unscoped legacy routes remain available:
     *   - `required` → only scoped routes registered.
     *   - `optional` / `auto` → both scoped and unscoped routes registered.
     */
    registerRoutes(): void {
        const basePath = this.getApiBasePath();
        const { enableProjectScoping, projectResolution } = this.config.api;

        const registerForBase = (bp: string) => {
            if (this.config.api.enableDiscovery) {
                this.registerDiscoveryEndpoints(bp);
            }
            if (this.config.api.enableOpenApi ?? true) {
                this.registerOpenApiEndpoints(bp);
            }
            if (this.config.api.enableMetadata) {
                this.registerMetadataEndpoints(bp);
            }
            if (this.config.api.enableUi) {
                this.registerUiEndpoints(bp);
            }
            if (this.config.api.enableSearch ?? true) {
                this.registerSearchEndpoints(bp);
            }
            this.registerEmailEndpoints(bp);
            // Public (anonymous) form endpoints — opt-in via FormView.sharing.
            // Registered BEFORE the greedy `/data/:object` matcher so the
            // `/forms/:slug` and `/forms/:slug/submit` paths can't be
            // shadowed by a literal object named "forms".
            this.registerFormEndpoints(bp);
            // Capability routes (sharing rules, reports, approvals) live at
            // the top of the API surface (`/api/v1/{capability}/...`) rather
            // than under `/data/`, so they don't collide with the greedy
            // CRUD `/:object` matcher and don't pretend to be records on a
            // single object.
            this.registerSharingEndpoints(bp);
            this.registerSharingRuleEndpoints(bp);
            this.registerReportsEndpoints(bp);
            this.registerApprovalsEndpoints(bp);
            this.registerAnalyticsEndpoints(bp);
            this.registerSecurityEndpoints(bp);
            this.registerSecurityExplainEndpoints(bp);
            // Data-action routes (e.g. GET /data/:object/export, POST
            // /data/:object/import) use static-literal action segments that
            // MUST be registered BEFORE the greedy GET /data/:object/:id
            // matcher in registerCrudEndpoints — the router is first-match-wins
            // with no specificity sorting (see route-manager.ts), so otherwise
            // a request to `.../export` is captured by `:id` and "export" is
            // treated as a record id (404 RECORD_NOT_FOUND). This mirrors the
            // /meta/:type/:name/references-before-/meta/:type/:name convention.
            // Safe in the other direction too: registerDataActionEndpoints has
            // no greedy 2-segment `:object/:id` routes (only literal actions and
            // deeper `:id/clone`, `:id/shares` paths), so it cannot shadow any
            // CRUD literal.
            this.registerDataActionEndpoints(bp);
            if (this.config.api.enableCrud) {
                this.registerCrudEndpoints(bp);
            }
            if (this.config.api.enableBatch) {
                this.registerBatchEndpoints(bp);
            }
        };

        if (enableProjectScoping) {
            const scopedBase = this.getScopedBasePath(basePath);
            if (projectResolution === 'required') {
                // Strict: only scoped routes
                registerForBase(scopedBase);
            } else {
                // 'optional' | 'auto' — keep both so legacy callers keep working
                registerForBase(basePath);
                registerForBase(scopedBase);
            }
        } else {
            registerForBase(basePath);
        }
    }
    
    /**
     * Is `/mcp` actually serveable — i.e. is the MCP service registered with
     * the shape `handleMcpRequest` needs?
     *
     * `true`/`false` are answers; `null` means "could not probe". The route
     * itself is served by the runtime dispatcher (`domains/mcp.ts`), which
     * 501s on `!mcp || typeof mcp.handleHttpRequest !== 'function'` — so this
     * probe exists to keep our `/discovery` from advertising a route that
     * would 501 (#4024).
     *
     * Same two probe paths as {@link resolveRegisteredServices} (ADR-0057
     * D10): the per-request kernel for multi-env hosts, else the single-env
     * `serviceExistsProvider` — which `rest-api-plugin` always wires. Via the
     * kernel we can check the SHAPE; the single-env provider answers existence
     * only, which is the dominant case (the dispatcher's own service-aware
     * discovery covers the wrong-shape case).
     */
    private async probeMcpServeable(req: any): Promise<boolean | null> {
        try {
            let environmentId: string | undefined = req?.params?.environmentId;
            if ((!environmentId || environmentId === ':environmentId') && this.defaultEnvironmentIdProvider) {
                try { environmentId = this.defaultEnvironmentIdProvider() || undefined; } catch { /* ignore */ }
            }
            if (environmentId && environmentId !== 'platform' && this.kernelManager) {
                const kernel: any = await this.kernelManager.getOrCreate(environmentId);
                if (kernel && typeof kernel.getServiceAsync === 'function') {
                    const svc: any = await kernel.getServiceAsync('mcp').catch(() => undefined);
                    return typeof svc?.handleHttpRequest === 'function';
                }
            }
            if (this.serviceExistsProvider) return this.serviceExistsProvider('mcp') === true;
        } catch { /* fall through to "cannot probe" */ }
        return null;
    }

    /**
     * Register discovery endpoints
     */
    private registerDiscoveryEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/environments/:environmentId');
        const discoveryHandler = async (req: any, res: any) => {
                try {
                    const discovery = await this.protocol.getDiscovery();

                    // Override discovery information with actual server configuration
                    discovery.version = this.config.api.version;

                    // Substitute the resolved environmentId into the advertised routes so
                    // clients can consume them verbatim (e.g. /api/v1/environments/abc/data).
                    const realBase = isScoped
                        ? basePath.replace(':environmentId', req.params?.environmentId ?? ':environmentId')
                        : basePath;

                    if (discovery.routes) {
                        // Ensure routes match the actual mounted paths
                        if (this.config.api.enableCrud) {
                            discovery.routes.data = `${realBase}${this.config.crud.dataPrefix}`;
                        }

                        if (this.config.api.enableMetadata) {
                            discovery.routes.metadata = `${realBase}${this.config.metadata.prefix}`;
                        }

                        if (this.config.api.enableUi) {
                            discovery.routes.ui = `${realBase}/ui`;
                        }

                        // MCP (Streamable HTTP) is a default-on core capability —
                        // advertise it unless OS_MCP_SERVER_ENABLED=false opts the
                        // env out, so the objectui Integrations page surfaces the
                        // connect card. The /mcp route is mounted bare (not
                        // project-scoped), so point at the unscoped base. This
                        // `/discovery` (served by @objectstack/rest) is separate
                        // from the dispatcher's getDiscoveryInfo — both must
                        // advertise `mcp` on the same terms.
                        //
                        // Enabled is NOT the same as serveable (#4024). The flag
                        // alone used to gate this, on the reasoning that `os serve`
                        // auto-loads plugin-mcp from the same flag. But that
                        // lockstep belongs to the CLI: `@objectstack/rest` has no
                        // `@objectstack/mcp` dependency, mounts no /mcp route and
                        // performs no auto-load, so an embedder that skips
                        // plugin-mcp had `mcp` advertised here while the route
                        // 501'd — the `declared ≠ enforced` failure #3369 forbids.
                        // A `null` probe means we genuinely cannot tell; keep the
                        // old flag-only answer there rather than hiding a working
                        // endpoint (fail-open, ADR-0057 D10) — the dispatcher's own
                        // discovery is service-aware and stays authoritative.
                        const mcpServeable = await this.probeMcpServeable(req);
                        if (isMcpServerEnabled() && mcpServeable !== false) {
                            const unscopedBase = isScoped
                                ? basePath.replace(/\/(environments|projects)\/:environmentId$/, '')
                                : basePath;
                            discovery.routes.mcp = `${unscopedBase}/mcp`;
                        } else {
                            delete discovery.routes.mcp;
                        }

                        // Align auth route with the versioned base path if present.
                        // Auth is a control-plane concern, so use the unscoped base.
                        if (discovery.routes.auth) {
                            const unscopedBase = isScoped
                                ? basePath.replace(/\/projects\/:environmentId$/, '')
                                : basePath;
                            discovery.routes.auth = `${unscopedBase}/auth`;
                        }

                        // [#6633] Direct-mount surfaces — the mounted ⇒ advertised
                        // half of ADR-0076 D12. `routes.packages` and
                        // `routes.datasources` are PROJECTIONS of the recorded
                        // direct mounts (#5822): the advertised base is read off
                        // the very route arrays the registrars iterated to mount,
                        // so advertisement and mounting derive from one fact and
                        // cannot drift. Since #6306 those registrars mount at
                        // this server's own `getApiBasePath()` — the single
                        // base — so an `apiPath` deployment advertises
                        // `{apiPath}/packages` and `{apiPath}/datasources`.
                        // That move landed with NO edit in this block, which is
                        // exactly the property #6633 was built to provide.
                        //
                        // A boot that mounted nothing (no `package` service ⇒
                        // the registrar was never called) advertises nothing:
                        // the protocol's service-presence `packages` entry is
                        // deleted rather than left to promise a 404 — this
                        // server knows the mount fact, which is strictly better
                        // knowledge than service presence.
                        const direct = this.getDirectMountRouteBases(
                            isScoped ? (req.params?.environmentId ?? ':environmentId') : undefined,
                        );
                        if (direct.packages) discovery.routes.packages = direct.packages;
                        else delete discovery.routes.packages;
                        if (direct.datasources) discovery.routes.datasources = direct.datasources;
                        else delete discovery.routes.datasources;

                        // [#6714] Email surface — same mounted ⇒ advertised
                        // discipline, over the RouteManager recording:
                        // `registerEmailEndpoints` registers
                        // `POST {base}/email/send` at THIS server's base (it
                        // follows `apiPath`), and the advertisement is a
                        // projection of that recorded row — never recomputed —
                        // so the SDK's `getRoute('email')` follows the real
                        // mount instead of the `/api/v1` convention the client
                        // used to hard-code (a live 404 on any `apiPath`
                        // deployment). Not mounted ⇒ not advertised.
                        const emailBase = this.getMountedEmailRouteBase(
                            isScoped ? (req.params?.environmentId ?? ':environmentId') : undefined,
                        );
                        if (emailBase) discovery.routes.email = emailBase;
                        else delete discovery.routes.email;
                    }

                    // Cross-object atomic batch capability (#3298). `declared ===
                    // enforced`: advertise it only when THIS server actually mounts
                    // the `/batch` route (`api.enableBatch`, gated in
                    // registerBatchEndpoints) AND the runtime engine can honour a
                    // transaction (the protocol derived that from `engine.transaction`).
                    // AND-ing the two keeps us from advertising an endpoint that would
                    // 404 (batch disabled) or 501 (engine without `transaction()`), so
                    // a client can safely drop its non-atomic fallback on `true`.
                    const caps = ((discovery as any).capabilities ??= {}) as Record<
                        string,
                        { enabled: boolean; description?: string }
                    >;
                    const runtimeSupportsTx = !!caps.transactionalBatch?.enabled;
                    caps.transactionalBatch = {
                        enabled: runtimeSupportsTx && this.config.api.enableBatch !== false,
                        description:
                            'Atomic cross-object batch endpoint (POST {basePath}/batch): all-or-nothing '
                            + 'create/update/delete across objects in one transaction, with intra-batch '
                            + '{ $ref: <opIndex> } parent references (#1604 / ADR-0034).',
                    };

                    // [#7541] Global search — the same two-layer AND, for the
                    // same reason. The protocol answered whether IT can serve a
                    // search (`typeof searchAll === 'function'`, the predicate
                    // `registerSearchEndpoints` 501s on); this server answers
                    // whether it MOUNTED the route at all (`api.enableSearch`,
                    // the flag gated in registerRoutes). A deployment that opts
                    // out gets a 404, so advertising the protocol's `true`
                    // unqualified would re-open the declared ≠ enforced gap one
                    // layer up from the one this issue closed. Neither half is a
                    // fallback for a wrong bit: each layer states the fact only
                    // it knows, and `enabled` is their conjunction.
                    //
                    // The flag is read with the mount's own `?? true` spelling
                    // rather than the equivalent `!== false` — same predicate,
                    // same characters, so the two cannot be edited apart.
                    caps.search = {
                        enabled: !!caps.search?.enabled && (this.config.api.enableSearch ?? true),
                    };

                    // Attach scoping metadata so clients can detect dual-mode routing.
                    (discovery as any).scoping = {
                        enabled: this.config.api.enableProjectScoping,
                        resolution: this.config.api.projectResolution,
                        scoped: isScoped,
                        environmentId: isScoped ? req.params?.environmentId : undefined,
                    };

                    res.json(discovery);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            };

        // Register at basePath (e.g. /api/v1)
        this.routeManager.register({
            method: 'GET',
            path: basePath,
            handler: discoveryHandler,
            metadata: {
                summary: 'Get API discovery information',
                tags: ['discovery'],
            },
        });

        // Register at basePath/discovery (e.g. /api/v1/discovery)
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/discovery`,
            handler: discoveryHandler,
            metadata: {
                summary: 'Get API discovery information',
                tags: ['discovery'],
            },
        });
    }

    /**
     * Register OpenAPI 3.1 spec + interactive docs viewer.
     *
     *   GET <basePath>/openapi.json   → enriched OpenAPI document
     *   GET <basePath>/docs           → Scalar-rendered HTML (CDN, no dep)
     *
     * Enrichment at request time:
     *   - servers[0].url           — derived from the request's Host header
     *   - paths                    — the BUILT-IN route section, produced here
     *                                from this server's own mounted routes and
     *                                REPLACING whatever the static artifact
     *                                carried (#5588, see below)
     *   - paths                    — `{object}` placeholders expanded into
     *                                one concrete path per registered object
     *                                from the protocol's discovery metadata
     *   - paths                    — one entry per declared `api` endpoint
     *                                (#5040 E6, see openapi-endpoints.ts)
     *
     * This package is the SOLE owner of the route (ADR-0076, proven by the
     * real boot in #5078), which is why the endpoint documentation joins this
     * pipeline instead of a `generateOpenApi` on some metadata service — that
     * would have been the second owner ADR-0076 forbids. The dispatcher's
     * probe for such a method was deleted in the same change.
     *
     * #5588 extended that ownership to the built-in routes themselves. The
     * static artifact's built-in section was written against a literal `/api`
     * base and a real boot found 0 of its 10 operations reachable — wrong
     * prefix, `PUT` where the server answers `PATCH`, two paths nobody serves.
     * A static artifact cannot get this right in principle, because `apiPath`
     * is per-deployment configuration. So the section is produced HERE, from
     * `routeManager.getAll()`, and the incoming `paths` are DISCARDED rather
     * than merged — a merge with a wrong section republishes the wrong
     * section, and the spec-side generator is still emitting one until #5744
     * (leg 2) removes it. See `openapi-builtin-paths.ts` for the coverage rule.
     *
     * The base spec is loaded lazily from @objectstack/spec/openapi.json
     * (shipped pre-generated by spec's build pipeline) so we don't pay
     * the cost of regenerating on every request, and a missing or
     * malformed file degrades to a stub instead of crashing. What survives
     * from it is what `packages/spec` genuinely owns: `components.schemas`,
     * `info`, `securitySchemes` (and the document-level `security`).
     */
    private registerOpenApiEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/environments/:environmentId');

        const openApiHandler = async (req: any, res: any) => {
            try {
                const spec = await this.loadOpenApiSpec();
                if (!spec) {
                    res.status?.(503);
                    res.json({
                        error: { code: 'OPENAPI_UNAVAILABLE', message: 'OpenAPI spec is not bundled with this runtime.' },
                    });
                    return;
                }

                // Clone shallowly so per-request mutations (server URL,
                // expanded paths) don't bleed into the cached base spec.
                let enriched: any = { ...spec, servers: [...(spec.servers ?? [])] };

                // 1) Override servers[0] with the actual request origin so
                //    "Try it" works straight from the docs viewer.
                const host = req.headers?.host ?? req.headers?.['host'];
                const proto = (req.headers?.['x-forwarded-proto'] as string)
                    || (req.protocol as string)
                    || 'http';
                if (host) {
                    enriched.servers = [
                        { url: `${proto}://${host}`, description: 'Current server' },
                        ...(spec.servers ?? []),
                    ];
                }

                // 2) Produce the built-in route section from this server's own
                //    route table and DISCARD whatever the static artifact
                //    carried (#5588, maintainer ruling C). Every row here is a
                //    route the router will match: same table, read at request
                //    time, so the prefix follows `apiPath`, the verbs are the
                //    registered ones, and a route that is not mounted cannot be
                //    described. `getRoutes()` is the whole surface — since
                //    #5822 that includes the direct-mount registrars' routes,
                //    but only the ones this boot actually mounted and reported.
                //    The filtering to THIS base (and away from the project-
                //    scoped mirror, which gets its own document) is
                //    `buildBuiltinPaths`'s.
                const builtin = buildBuiltinPaths(this.getRoutes(), basePath);
                enriched.paths = builtin.paths;
                // The tag list describes that same section, so it is produced
                // with it rather than inherited from the artifact — otherwise a
                // document whose operations carry rest's tags would advertise
                // spec's (`CRUD`/`Metadata`/`Discovery`, which nothing uses).
                enriched.tags = builtin.tags;

                // Metadata-driven enrichment (steps 3 and 4) reads through one
                // resolved protocol, but each step carries its own `try`: they
                // describe different surfaces, and a failure to enumerate one
                // must not silently blank the other.
                let protocol: RestProtocol | undefined;
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    protocol = await this.resolveProtocol(environmentId, req);
                } catch {
                    // Enrichment is best-effort — never fail the spec serve.
                }

                // 3) Expand `{object}` path placeholders into concrete
                //    routes for every registered data object. Falls back
                //    silently if discovery isn't available. Since #5588 the
                //    templates it expands are the real ones (`/api/v1/data/
                //    {object}` and its siblings), not the phantom `/api/
                //    {object}`.
                try {
                    const items = await protocol?.getMetaItems?.({ type: 'object' }).catch(() => null) as any;
                    const objects: string[] = Array.isArray(items?.items)
                        ? items.items.map((i: any) => i?.name).filter(Boolean)
                        : Array.isArray(items)
                          ? items.map((i: any) => i?.name).filter(Boolean)
                          : [];
                    if (objects.length > 0 && enriched.paths) {
                        const expanded: Record<string, unknown> = {};
                        for (const [p, def] of Object.entries(enriched.paths)) {
                            if (p.includes('{object}')) {
                                // Keep the template under x-template for tooling
                                // that wants the generic shape, and emit one
                                // concrete copy per registered object.
                                expanded[p] = { ...(def as object), 'x-template': true };
                                for (const obj of objects) {
                                    expanded[p.replace('{object}', obj)] = def;
                                }
                            } else {
                                expanded[p] = def;
                            }
                        }
                        enriched.paths = expanded;
                    }
                } catch {
                    // Enrichment is best-effort — never fail the spec serve.
                }

                // 4) Fold in the endpoints declared as `api` metadata (#5040
                //    E6). Same enumeration root as the `{object}` expansion
                //    above — this document is the ONE documentation face for
                //    `/openapi.json`, which this package alone serves (#5078,
                //    ADR-0076): declared endpoints join it here rather than
                //    growing a second generator somewhere else.
                //
                //    Since the E7 flip a non-empty `apis:` publishes, so this
                //    enumeration returns real declarations on a deployment that
                //    has them and the document grows a path entry per endpoint.
                //    Where nothing is declared the enumeration is empty and
                //    `enrichOpenApiWithEndpoints` hands `enriched` straight
                //    back, byte for byte.
                try {
                    const apiResult = await protocol?.getMetaItems?.({ type: 'api' });
                    const apiItems: unknown[] = Array.isArray((apiResult as any)?.items)
                        ? (apiResult as any).items
                        : Array.isArray(apiResult) ? apiResult as unknown[] : [];
                    const endpointLogger = {
                        error: (message: string, meta?: unknown) =>
                            meta === undefined ? logError(message) : logError(message, meta),
                    };

                    // [#5224] Enumerated is not served. This document is what
                    // SDKs, codegen and AI clients build clients FROM, so it
                    // describes only the declarations the endpoint matcher will
                    // actually answer — asked of the matcher itself, the sole
                    // holder of that verdict. A stored row the matcher cannot
                    // see used to arrive here and be published as a real path,
                    // `security: []` and all, while every request to it 404'd.
                    let documentable: unknown[] = apiItems;
                    const authority = apiItems.length > 0
                        ? await this.resolveEndpointMatchAuthority(
                            isScoped ? req.params?.environmentId : undefined,
                            req,
                        )
                        : undefined;
                    if (apiItems.length > 0 && !authority) {
                        this.notifyMissingEndpointAuthority('GET /openapi.json');
                    } else if (authority) {
                        // The matcher's OWN parsed endpoint is documented, not
                        // the stored JSON: schema defaults are materialized on
                        // it (most importantly `authRequired`), so the document
                        // describes the value the runtime acts on rather than a
                        // re-parse of the same row on a second code path.
                        documentable = (await selectServedEndpoints(apiItems, authority, endpointLogger))
                            .map((s) => s.endpoint);
                    }

                    enriched = enrichOpenApiWithEndpoints(enriched, documentable, endpointLogger);
                } catch (err: any) {
                    // A store that cannot be read must not take the document
                    // down with it — but say so, because a silently endpoint-
                    // less document looks exactly like a correct one.
                    logError('[REST] openapi.json endpoint enrichment skipped:', err?.message ?? err);
                }

                // Surface the runtime version so consumers don't pin to
                // the spec package's compile-time version.
                if (enriched.info) {
                    enriched.info = {
                        ...enriched.info,
                        version: this.config.api.version || enriched.info.version,
                    };
                }

                res.json(enriched);
            } catch (error: any) {
                logError('[REST] openapi.json error:', error);
                sendError(res, error);
            }
        };

        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/openapi.json`,
            handler: openApiHandler,
            metadata: {
                summary: 'OpenAPI 3.1 specification (machine-readable)',
                tags: ['openapi'],
            },
        });

        // Scalar HTML viewer — single inline page that loads the spec from
        // the sibling /openapi.json endpoint. No build-time bundling, no
        // server-side render cost.
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/docs`,
            handler: async (req: any, res: any) => {
                // Resolve the openapi.json URL relative to the current
                // request so the docs page works for any host / scoped
                // base path (e.g. /api/v1 vs /api/v1/environments/abc).
                const reqPath: string = req.path || req.url || `${basePath}/docs`;
                // Strip the trailing /docs to get the API base.
                const apiBase = reqPath.replace(/\/docs\/?$/, '');
                const specUrl = `${apiBase}/openapi.json`;
                const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ObjectStack API Docs</title>
</head>
<body>
<script id="api-reference" data-url="${specUrl}"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
                if (res.setHeader) res.setHeader('content-type', 'text/html; charset=utf-8');
                if (res.send) res.send(html);
                else if (res.body) res.body = html;
                else res.json?.(html);
            },
            metadata: {
                summary: 'Interactive API docs (Scalar viewer)',
                tags: ['openapi'],
            },
        });
    }

    /**
     * Lazily load the OpenAPI spec JSON shipped by @objectstack/spec.
     * Cached after first read. Resilient to missing files / parse errors
     * so a degraded environment still boots.
     */
    private _openApiSpecCache: any | null | undefined = undefined;
    private async loadOpenApiSpec(): Promise<any | null> {
        if (this._openApiSpecCache !== undefined) return this._openApiSpecCache;
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — node built-in, no @types/node in this package
            const mod: any = await import('module');
            const requireFn = mod.createRequire((import.meta as any).url);
            const pkgJsonPath: string = requireFn.resolve('@objectstack/spec/package.json');
            // @ts-ignore
            const pathMod: any = await import('path');
            // @ts-ignore
            const fsMod: any = await import('fs');
            const specPath = pathMod.join(pathMod.dirname(pkgJsonPath), 'json-schema', 'openapi.json');
            const raw = await fsMod.promises.readFile(specPath, 'utf-8');
            this._openApiSpecCache = JSON.parse(raw);
            return this._openApiSpecCache;
        } catch (err: any) {
            logError('[REST] Failed to load OpenAPI spec:', err?.message ?? err);
            this._openApiSpecCache = null;
            return null;
        }
    }
    
    /**
     * Register the metadata routes behind the SAME anonymous-deny gate the
     * `/data` routes use.
     *
     * `registerMetadataEndpoints` builds ~17 `/meta/*` routes but — unlike the
     * `/data` handlers — never calls {@link enforceAuth}: its handlers assumed
     * the anonymous-deny rejected anonymous callers "upstream", yet nothing
     * upstream covers `/meta`, so an anonymous caller could read object / field
     * schemas. On a tenant-less runtime host those are SYSTEM-object schemas and
     * the host is publicly reachable — a real leak.
     *
     * Rather than add the gate to every handler (and have the next new route
     * forget it — the exact failure mode that caused this), wrap the route
     * registrar for the duration of registration so every meta route, present
     * and future, inherits it. An authenticated user passes exactly as on
     * `/data`; the one exception is the declaration-derived public-book read
     * (#3963), handled just below.
     */
    private registerMetadataEndpoints(basePath: string): void {
        const realRouteManager = this.routeManager;
        const guardedRouteManager = {
            register: (entry: { handler: unknown; [k: string]: unknown }) => {
                const inner = entry.handler;
                if (typeof inner !== 'function') return realRouteManager.register(entry as any);
                return realRouteManager.register({
                    ...entry,
                    handler: async (req: any, res: any) => {
                        // `req.params.environmentId` is present only on the
                        // scoped `/environments/:id/meta/...` variant — mirrors
                        // the `isScoped ? req.params.environmentId : undefined`
                        // each `/data` handler derives.
                        const environmentId = req?.params?.environmentId;
                        const context = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                        // [#3963] `audience: 'public'` is a DECLARED capability, so it
                        // must not depend on a deployment flipping its whole data plane
                        // open. An anonymous read of the
                        // book/doc surface skips the anonymous-deny and is authorized
                        // instead by the ADR-0046 §6.7 audience gate inside the handler
                        // — the same declaration-derived shape ADR-0056 Option A chose
                        // for public form submission (`publicFormGrant`).
                        //
                        // Deliberately narrow, in three independent ways:
                        //  1. only when NO context resolved. An authenticated caller
                        //     still goes through `enforceAuth` unchanged, so the
                        //     ADR-0069 auth-policy gate (expired password, enforced
                        //     MFA) keeps applying to a gated session's book reads;
                        //  2. only GET, and only the book/doc routes (see
                        //     {@link isPublicAudienceRead}) — `/meta/object` stays 401
                        //     for anonymous, which is the whole point of the umbrella
                        //     gate;
                        //  3. the handler still decides. `audienceAllows` returns true
                        //     for `'public'` ONLY; `org` and `{ permissionSet }` books
                        //     require `caller.authenticated`, and unresolvable holdings
                        //     fail closed. This grants REACHABILITY, not authorization.
                        const anonymousPublicRead = !context?.userId
                            && RestServer.isPublicAudienceRead(entry, req);
                        if (!anonymousPublicRead && this.enforceAuth(req, res, context)) return;
                        return (inner as (rq: any, rs: any) => unknown)(req, res);
                    },
                } as any);
            },
        } as unknown as RouteManager;
        this.routeManager = guardedRouteManager;
        try {
            this.registerMetadataEndpointsInner(basePath);
        } finally {
            this.routeManager = realRouteManager;
        }
    }

    private registerMetadataEndpointsInner(basePath: string): void {
        const { metadata } = this.config;
        const metaPath = `${basePath}${metadata.prefix}`;
        const isScoped = basePath.includes('/environments/:environmentId');

        // GET /meta - List all metadata types
        //
        // Also mounted at `/meta/types`, the spelling the dispatcher's `/meta`
        // branch has always implemented (`parts[0] === 'types'`) and the
        // spelling `route-ledger.ts` has always declared. ONE handler, two
        // paths, deliberately: the dispatcher's two branches return the same
        // `protocol.getMetaTypes()` body, so a second REST handler would be a
        // second thing to keep true.
        if (metadata.endpoints.types !== false) {
            const listMetaTypes = async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const types = await p.getMetaTypes();
                    const translated = await this.translateMetaTypesResponse(req, environmentId, types);
                    res.header('Vary', 'Accept-Language');
                    res.json(translated);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            };
            this.routeManager.register({
                method: 'GET',
                path: metaPath,
                handler: listMetaTypes,
                metadata: {
                    summary: 'List all metadata types',
                    tags: ['metadata'],
                },
            });

            // GET /meta/types — REGISTERED BEFORE `/meta/:type`, and that is
            // the entire fix (#7526).
            //
            // The branch existed in the dispatcher and the row existed in the
            // ledger; the REST mount is a THIRD place and nobody wrote it here.
            // So `/meta/types` fell into the `:type` catch-all below and
            // answered `{"type":"types","items":[]}` — byte-shaped like
            // `/meta/zzz_not_a_type`, a 200 no client can tell from "that type
            // is empty". Hono is first-match-wins (MEASURED, not assumed —
            // `plugin-hono-server`'s `mounted-route-introspection.test.ts`
            // registers a literal and a `:param` sibling in both orders and
            // pins that the later one never runs), so moving this below
            // `/meta/:type` silently re-breaks it — the same shape that already
            // put `diagnostics` / `_drafts` / `_migrate-stored` above it. The
            // order is pinned by `meta-route-registration-order.test.ts`.
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/types`,
                handler: listMetaTypes,
                metadata: {
                    summary: 'List all metadata types (explicit `/types` spelling)',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/diagnostics - Cross-type spec-validation sweep
        //
        // Returns every metadata entry that fails its registered Zod
        // schema, scoped to the environment (and optionally org /
        // package) of the request. Powers the Studio governance
        // dashboard and `os doctor`-style CLI checks.
        //
        // Registered BEFORE `/meta/:type` so the `diagnostics` segment
        // is not captured as a `:type` parameter.
        if (metadata.endpoints.items !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/diagnostics`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).getMetaDiagnostics !== 'function') {
                            res.status(501).json({
                                error: { code: 'NOT_IMPLEMENTED', message: 'protocol.getMetaDiagnostics() is not available in this kernel' },
                            });
                            return;
                        }
                        // [#6877] All three narrow the diagnostics query to ONE
                        // value each; the `as string` casts are exactly the
                        // laundering that kept `tsc` silent about the array arm.
                        if (refuseRepeatedQueryParams(req, res, ['severity', 'type', 'package'])) return;
                        const severityParam = (req.query?.severity as string | undefined) ?? 'error';
                        const severity = severityParam === 'warning' ? 'warning' : 'error';
                        const result = await (p as any).getMetaDiagnostics({
                            type: (req.query?.type as string | undefined) || undefined,
                            severity,
                            packageId: (req.query?.package as string | undefined) || undefined,
                        });
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata entries that fail spec validation',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/_drafts - Pending DRAFT items (ADR-0033)
        //
        // Surfaces draft-state metadata that the active-only `/meta/:type`
        // list hides, so the console can show a "pending changes" view and
        // draft-aware package contents (a just-built app package no longer
        // looks empty). Optionally narrowed by `?packageId=` and/or `?type=`.
        //
        // Registered BEFORE `/meta/:type` so the `_drafts` segment is not
        // captured as a `:type` parameter.
        if (metadata.endpoints.items !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/_drafts`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        // [ADR-0106 D5(4) / #6599] `_drafts` is an AUTHORING
                        // surface — the console's pending-changes view and
                        // draft-aware package reads — not a general read. A
                        // pending object draft carries its full `fields` map, so
                        // serving it unfiltered leaks every hidden field's
                        // label, type, options, formula and `requiredPermissions`
                        // to any authenticated caller, which is the disclosure
                        // ADR-0106 closes one route over. The other `/meta`
                        // exits MASK per field; this one GATES per caller, on the
                        // SAME `systemPermissions` judgement D4 uses for its
                        // read exemption (`isObjectSchemaMaskExempt`) — a caller
                        // who could not see a field on `/meta/object` has no
                        // authoring reason to see the draft that carries it. The
                        // gate is intentionally independent of the D8 field-mask
                        // escape hatch: opting out of per-field masking is not
                        // consent to expose pending drafts to non-authors.
                        //
                        // Gate FIRST — before resolving the protocol — so an
                        // unauthorized caller cannot use the 501-vs-200 answer to
                        // probe which kernels support drafts (same posture as
                        // `_migrate-stored` below).
                        const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                        if (!isObjectSchemaMaskExempt(ctx)) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: 'Reading pending metadata drafts requires an authoring capability (studio.access, setup.access or manage_metadata).',
                                },
                            });
                            return;
                        }
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).listDrafts !== 'function') {
                            res.status(501).json({
                                error: { code: 'NOT_IMPLEMENTED', message: 'protocol.listDrafts() is not available in this kernel' },
                            });
                            return;
                        }
                        // [#6877] Both narrow the draft list to one package /
                        // one type; an array reached `listDrafts` untouched.
                        if (refuseRepeatedQueryParams(req, res, ['packageId', 'type'])) return;
                        const result = await (p as any).listDrafts({
                            packageId: (req.query?.packageId as string | undefined) || undefined,
                            type: (req.query?.type as string | undefined) || undefined,
                        });
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List pending draft metadata items',
                    tags: ['metadata'],
                },
            });
        }

        // POST /meta/_migrate-stored — rewrite stored sys_metadata rows into
        // today's canonical shape (ADR-0087; #4327 / #4454 / #4498).
        //
        // The server-side form of `os migrate meta --stored`. The CLI form
        // needs shell access to the deployment's database, which a hosted
        // operator does not have — so without this route the stored-metadata
        // chain has no finish line on a managed deployment, only the per-read
        // conversion that runs forever. Flow rows are covered here for free:
        // `migrateStoredMetadata` resolves the automation engine from the
        // services registry (#4498), and a server always has a live one.
        //
        // Registered BEFORE `/meta/:type` so the leading-underscore segment is
        // not captured as a `:type` parameter (same reason as `_drafts`).
        if (metadata.endpoints.items !== false) {
            this.routeManager.register({
                method: 'POST',
                path: `${metaPath}/_migrate-stored`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        // Gate FIRST — before resolving the protocol — so an
                        // unauthorized caller cannot use the 501 vs 200 answer
                        // to probe which kernels can be migrated.
                        //
                        // This rewrites every eligible row in the deployment,
                        // so unlike the single-item `PUT /meta/:type/:name` it
                        // demands an explicit capability rather than only a
                        // session. `manage_metadata` is ADR-0066 D1's authoring
                        // capability, and a canonicalization rewrite is
                        // authoring; `isSystem` bypasses, matching every other
                        // capability gate on the platform.
                        const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                        const held = new Set<string>(
                            Array.isArray(ctx?.systemPermissions) ? ctx!.systemPermissions : [],
                        );
                        if (!ctx?.isSystem && !held.has('manage_metadata')) {
                            res.status(403).json({
                                error: {
                                    code: 'FORBIDDEN',
                                    message: 'Rewriting stored metadata requires the `manage_metadata` capability.',
                                },
                            });
                            return;
                        }
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).migrateStoredMetadata !== 'function') {
                            res.status(501).json({
                                error: {
                                    code: 'NOT_IMPLEMENTED',
                                    message: 'protocol.migrateStoredMetadata() is not available in this kernel',
                                },
                            });
                            return;
                        }
                        const rawTypes = (req.body as any)?.types;
                        const types = Array.isArray(rawTypes)
                            ? rawTypes.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
                            : [];
                        // Preview by default — `apply` must be explicitly true,
                        // the same posture the CLI takes. A caller who sends an
                        // empty body gets a report and no writes.
                        const report = await (p as any).migrateStoredMetadata({
                            apply: (req.body as any)?.apply === true,
                            ...(types.length > 0 ? { types } : {}),
                            // Attributed to the caller: this writes history +
                            // audit rows, and "who ran the migration" is the
                            // question those rows exist to answer.
                            actor: ctx?.userId
                                ? `${ctx.userId} (POST ${metadata.prefix}/_migrate-stored)`
                                : `POST ${metadata.prefix}/_migrate-stored`,
                        });
                        res.json(report);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Rewrite stored metadata rows into the canonical protocol shape',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type - List items of a type
        if (metadata.endpoints.items !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type`,
                handler: async (req: any, res: any) => {
                    try {
                        // [#6877] Five single-valued parameters on this list
                        // route, declared together at the top so the gate cannot
                        // be missed by whichever branch reads its parameter
                        // several hundred lines down: `?object=` (the view
                        // switcher's `String(req.query.object)`, which turned
                        // `['a','b']` into the object name `'a,b'` — a name no
                        // view has, so the switcher silently emptied) and
                        // `?include=` (repeated, it stopped equalling
                        // `'content'`, so a caller who asked for doc bodies got
                        // the slimmed list back with a 200).
                        //
                        // [#7566] `?id=` joined them when the app branch below
                        // started honouring it. It is declared HERE, with the
                        // rest, rather than beside the filter that reads it, for
                        // the reason this block exists: a filter that arrives as
                        // `['crm','account']` and is compared against one app
                        // name matches nothing, and an empty app list is exactly
                        // the plausible-looking wrong answer #7566 was filed
                        // against. Refused, not resolved — see
                        // `query-multiplicity.ts` for why picking one of two
                        // conflicting intents is worse than a 400.
                        if (refuseRepeatedQueryParams(req, res, ['package', 'preview', 'object', 'include', 'id'])) return;
                        const packageId = req.query?.package || undefined;
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        // ADR-0033/0037 draft-overlay preview: `?preview=draft`
                        // overlays pending drafts on the active list, exactly as
                        // the runtime dispatcher's /metadata/:type route does —
                        // the console's draft preview (Live Canvas) reads THIS
                        // route, so dropping the flag here silently renders the
                        // published-only world.
                        const previewDrafts = typeof req.query?.preview === 'string'
                            && req.query.preview.toLowerCase() === 'draft';
                        const items = await p.getMetaItems({
                            type: req.params.type,
                            packageId,
                            ...(previewDrafts ? { previewDrafts: true } : {}),
                            ...(environmentId ? { environmentId } : {}),
                        } as any);

                        // RBAC-filter app metadata for authenticated users so
                        // privileged apps (Studio, Setup, etc.) and gated nav
                        // items are stripped before reaching the client. We
                        // intentionally leave anonymous responses untouched —
                        // the anonymous-deny gate blocks
                        // them upstream; when disabled, the demo / public
                        // surface keeps its prior behaviour.
                        //
                        // `getMetaItems` is typed as `{type, items[]}` but the
                        // objectql implementation actually returns the raw
                        // array. Handle both shapes defensively.
                        let visible: any = items;

                        // [#5224] `api` is a CONTRACT face, so it announces only
                        // the declarations the endpoint matcher will actually
                        // serve — the same set `/openapi.json` documents, asked
                        // of the same authority.
                        //
                        // The special case is `api`-only and stays that way on
                        // purpose: for every other type "listed" and "in effect"
                        // are the same fact, resolved by the one reader that
                        // enumerated them. For `api` they are not — a declared
                        // route is served by `IMetadataService.matchEndpoint`,
                        // whose index is a different reader with a different
                        // reach, and it is the SOLE holder of that verdict. So
                        // the special case is not "api is special", it is "api
                        // is the one type whose service verdict lives somewhere
                        // this route cannot see without asking".
                        //
                        // `?preview=draft` is exempt: that surface exists to
                        // answer "what is PENDING", which is by construction not
                        // the served set (a draft is not live and is not meant to
                        // look live). Filtering it would empty the drafts view of
                        // a type whose drafts are legitimately unserved. Codegen
                        // and SDK clients read the plain list, which is filtered.
                        if (RestServer.metaTypeSingular(req.params.type) === 'api' && !previewDrafts) {
                            const raw = visible as unknown;
                            const list = RestServer.metaItemsArray(raw);
                            if (list.length > 0) {
                                const authority = await this.resolveEndpointMatchAuthority(environmentId, req);
                                if (!authority) {
                                    this.notifyMissingEndpointAuthority('GET /meta/api');
                                } else {
                                    // A `matchEndpoint` throw propagates: its
                                    // contract distinguishes an unreadable store
                                    // from a miss, so this route FAILS (through
                                    // `handleRouteError`) rather than claiming
                                    // the deployment declares nothing. Measured:
                                    // that failure is currently reported as 400,
                                    // because an unrecognised error lands on
                                    // `mapDataError`'s terminal fallback — a
                                    // pre-existing classification on every error
                                    // this route reports, not something this
                                    // narrowing chose. Filed separately; do not
                                    // read the propagation here as a promise
                                    // about which status arrives.
                                    const servedList = await selectServedEndpoints(list, authority, {
                                        error: (message: string, meta?: unknown) =>
                                            meta === undefined ? logError(message) : logError(message, meta),
                                    });
                                    // The STORED item is what this face answers
                                    // with — its `_packageId` / `_provenance` /
                                    // `_diagnostics` decorations are read by the
                                    // Studio list, and dropping them here would
                                    // be a second, unannounced change.
                                    const filtered = servedList.map((s) => s.item);
                                    visible = Array.isArray(raw) ? filtered : { ...(raw as any), items: filtered };
                                }
                            }
                        }

                        if (RestServer.metaTypeSingular(req.params.type) === 'app') {
                            const raw = items as unknown;
                            const list: any[] | null = Array.isArray(raw)
                                ? (raw as any[])
                                : (raw && typeof raw === 'object' && Array.isArray((raw as any).items))
                                    ? ((raw as any).items as any[])
                                    : null;
                            if (list) {
                                const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                                if (ctx?.userId) {
                                    const sysPerms = new Set<string>(
                                        Array.isArray(ctx.systemPermissions) ? ctx.systemPermissions : [],
                                    );
                                    const registered = await this.resolveRegisteredServices((ctx as any).__kernel, list);
                                    const serviceGate = registered ? (n: string) => registered.has(n) : undefined;
                                    // [#7912] Resolved ONCE for the whole list —
                                    // object metadata is a per-request fact, not
                                    // a per-app one.
                                    const servabilityGate = await this.resolveNavServability(p, environmentId) ?? undefined;
                                    const filtered = list
                                        .map((it: any) => this.filterAppForUser(it, sysPerms, serviceGate, servabilityGate))
                                        .filter((it: any) => it != null);
                                    visible = Array.isArray(raw)
                                        ? filtered
                                        : { ...(raw as any), items: filtered };
                                }
                            }
                        }

                        // [#7566] `GET /meta/app?id=<app>` — the app-list filter,
                        // which until now was accepted and then dropped.
                        //
                        // Nothing on this route had ever read `id`: the block
                        // above narrows the list by PERMISSION and the branches
                        // around it by `?object=` / `?include=` / `?package=`, so
                        // `?id=crm` and `?id=not_an_app` produced the same three
                        // apps, byte for byte. A caller cannot tell a working
                        // filter from a dropped one — a client that asks for one
                        // app and renders `items[0]` gets a plausible, wrong
                        // answer, and a bogus id can never come back empty.
                        //
                        // ⚠️ Runs AFTER the RBAC filter above, on `visible`
                        // rather than on `items`. The two orders produce the same
                        // SET (both are pure filters), but not the same
                        // disclosure: narrowing first would hand `?id=<an
                        // unpublished app>` a one-element list to gate, and any
                        // future non-total gate — one that strips a field instead
                        // of dropping the document — would then be answering
                        // about an app the caller may not observe at all
                        // (ADR-0045 §3). Permission decides what exists for this
                        // caller; the filter narrows what they asked for within
                        // it, never the reverse.
                        //
                        // The match is on `name`, the App document's identity —
                        // `AppSchema.name`, "App unique machine name", the same
                        // key `GET /meta/app/:name` addresses and the same key
                        // the metadata store merges overlays on. `AppSchema`
                        // declares no `id` of its own (`id` appears on nav items
                        // and areas, never on the app), so there is no second
                        // identity to disagree with.
                        //
                        // A filter that matches nothing answers `200` with an
                        // EMPTY list, not a 404 — measured against this route's
                        // siblings, not chosen: `?package=<no such package>` and
                        // `/meta/view?object=<no such object>` both serve an
                        // empty list here, and the only meta 404 is the
                        // single-item address `GET /meta/:type/:name`. An empty
                        // list is the honest answer to "which apps have this id",
                        // and it is already observably different from the defect,
                        // which answered with all of them.
                        //
                        // Empty and absent spellings still mean "no filter", the
                        // same falsy gate `?package=` on this route has always
                        // used. The repeated spelling was refused at the top of
                        // the handler (#6877), so what arrives here is a string.
                        //
                        // Its own block rather than a line inside the branch
                        // above, because the two answer different questions:
                        // that branch is guarded on a resolved `ctx?.userId` and
                        // decides what this caller may observe, while narrowing
                        // to the app you named is not a privilege and must not
                        // acquire that guard's conditions.
                        const appIdFilter = RestServer.metaTypeSingular(req.params.type) === 'app'
                            ? req.query?.id
                            : undefined;
                        if (typeof appIdFilter === 'string' && appIdFilter !== '') {
                            const raw = visible as unknown;
                            // Only the two shapes this route serves are narrowed
                            // — a bare array or the `{ items: [] }` envelope.
                            // Anything else is left alone rather than replaced
                            // with an invented empty envelope: a filter must not
                            // be the thing that changes the response's shape.
                            const list: any[] | null = Array.isArray(raw)
                                ? (raw as any[])
                                : (raw && typeof raw === 'object' && Array.isArray((raw as any).items))
                                    ? ((raw as any).items as any[])
                                    : null;
                            if (list) {
                                const matched = list.filter(
                                    (a: any) => a && typeof a === 'object' && a.name === appIdFilter,
                                );
                                visible = Array.isArray(raw) ? matched : { ...(raw as any), items: matched };
                            }
                        }

                        // ADR-0057 D10: gate dashboard widgets by `requiresService`
                        // the same way app nav entries are gated above.
                        if (RestServer.metaTypeSingular(req.params.type) === 'dashboard') {
                            const raw = visible as unknown;
                            const list: any[] | null = Array.isArray(raw)
                                ? (raw as any[])
                                : (raw && typeof raw === 'object' && Array.isArray((raw as any).items))
                                    ? ((raw as any).items as any[])
                                    : null;
                            if (list) {
                                const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                                const registered = await this.resolveRegisteredServices((ctx as any)?.__kernel, list);
                                const serviceGate = registered ? (n: string) => registered.has(n) : undefined;
                                if (serviceGate) {
                                    const filtered = list.map((it: any) => this.filterDashboardForUser(it, serviceGate));
                                    visible = Array.isArray(raw)
                                        ? filtered
                                        : { ...(raw as any), items: filtered };
                                }
                            }
                        }

                        // View switcher query: GET /meta/view?object=<object>
                        // returns ONLY the independent ViewItems bound to that
                        // object (the `package` layer of "Object has-many
                        // View"), sorted for the switcher / left rail. The
                        // aggregated container and other objects' views are
                        // excluded. Runtime `shared` / `personal` views
                        // (sys_view_definition) are merged client-side via the
                        // generic data API.
                        if (RestServer.metaTypeSingular(req.params.type) === 'view' && req.query?.object) {
                            const obj = String(req.query.object);
                            const raw = visible as unknown;
                            const list: any[] | null = Array.isArray(raw)
                                ? (raw as any[])
                                : (raw && typeof raw === 'object' && Array.isArray((raw as any).items))
                                    ? ((raw as any).items as any[])
                                    : null;
                            if (list) {
                                const filtered = list
                                    .filter((v: any) => v && typeof v === 'object' && v.viewKind && v.object === obj)
                                    .sort((a: any, b: any) =>
                                        ((a.order ?? 0) as number) - ((b.order ?? 0) as number) ||
                                        String(a.name).localeCompare(String(b.name)));
                                visible = Array.isArray(raw) ? filtered : { ...(raw as any), items: filtered };
                            }
                        }

                        // ADR-0046 §6.7 — book list is audience-filtered: anonymous
                        // callers see only `public` books; `{ permissionSet }`-gated
                        // books require the caller to hold the named set (resolved
                        // through the security service; unresolvable → fail closed).
                        if (RestServer.metaTypeSingular(req.params.type) === 'book') {
                            const raw = visible as unknown;
                            const list = RestServer.metaItemsArray(raw);
                            if (list.length > 0) {
                                const { audienceAllows } = await import('@objectstack/spec/system');
                                const caller = await this.resolveAudienceCaller(environmentId, req, {
                                    needPermissionSets: RestServer.anyPermissionSetAudience(list),
                                });
                                const filtered = list.filter((b: any) =>
                                    b && typeof b === 'object' && audienceAllows((b as any).audience, caller));
                                visible = Array.isArray(raw) ? filtered : { ...(raw as any), items: filtered };
                            }
                        }

                        // ADR-0046 §6.7 — doc list is audience-filtered by each
                        // doc's EFFECTIVE audience (union over the books that
                        // claim it; unclaimed docs default to `org`). Runs on the
                        // raw items (before locale collapse) so `_packageId`
                        // provenance is still present for membership scoping.
                        if (RestServer.metaTypeSingular(req.params.type) === 'doc') {
                            const raw = visible as unknown;
                            const list = RestServer.metaItemsArray(raw);
                            if (list.length > 0) {
                                const { audienceAllows, docAudienceAllows, resolveDocAudiences } =
                                    await import('@objectstack/spec/system');
                                const books = await this.fetchAudienceBooks(p, environmentId);
                                const caller = await this.resolveAudienceCaller(environmentId, req, {
                                    needPermissionSets: RestServer.anyPermissionSetAudience(books),
                                });
                                let filtered: any[];
                                if (caller.authenticated && !RestServer.anyPermissionSetAudience(books)) {
                                    // Fast path: with no gated book anywhere, every
                                    // effective audience admits an authenticated caller.
                                    filtered = list;
                                } else {
                                    const corpus = list
                                        .filter((d: any) => d && typeof d === 'object')
                                        .map((d: any) => ({
                                            name: d.name,
                                            group: d.group,
                                            tags: d.tags,
                                            order: d.order,
                                            packageId: d._packageId,
                                        }));
                                    const audiences = resolveDocAudiences(books as any, corpus);
                                    filtered = list.filter((d: any) => {
                                        if (!d || typeof d !== 'object') return false;
                                        const eff = audiences.get(d.name);
                                        return eff
                                            ? docAudienceAllows(eff, caller)
                                            : audienceAllows('org', caller);
                                    });
                                }
                                visible = Array.isArray(raw) ? filtered : { ...(raw as any), items: filtered };
                            }
                        }

                        // ADR-0046 i18n: collapse each doc to the request
                        // locale (localized label/description, `translations`
                        // map dropped) before the content-strip step below.
                        if (RestServer.metaTypeSingular(req.params.type) === 'doc') {
                            const locale = this.extractLocale(req);
                            const { resolveDocLocale } = await import('@objectstack/spec/system');
                            const raw = visible as unknown;
                            const list: any[] | null = Array.isArray(raw)
                                ? (raw as any[])
                                : (raw && typeof raw === 'object' && Array.isArray((raw as any).items))
                                    ? ((raw as any).items as any[])
                                    : null;
                            if (list) {
                                const localized = list.map((it: any) =>
                                    it && typeof it === 'object' ? resolveDocLocale(it as any, locale) : it);
                                visible = Array.isArray(raw) ? localized : { ...(raw as any), items: localized };
                            }
                        }

                        // ADR-0046: `doc` list responses omit `content` by
                        // default — manuals are the one metadata payload that
                        // grows unbounded, and the list surface only needs
                        // name + label. `?include=content` opts back in; the
                        // single-item GET /meta/doc/:name always returns the
                        // full body.
                        if (RestServer.metaTypeSingular(req.params.type) === 'doc' && req.query?.include !== 'content') {
                            const raw = visible as unknown;
                            const list: any[] | null = Array.isArray(raw)
                                ? (raw as any[])
                                : (raw && typeof raw === 'object' && Array.isArray((raw as any).items))
                                    ? ((raw as any).items as any[])
                                    : null;
                            if (list) {
                                const slim = list.map((it: any) => {
                                    if (!it || typeof it !== 'object') return it;
                                    const { content: _content, ...rest } = it;
                                    return rest;
                                });
                                visible = Array.isArray(raw) ? slim : { ...(raw as any), items: slim };
                            }
                        }

                        // [ADR-0106 D5(2)] The list read — each item projected
                        // the same way, through the same masker. The posture is
                        // per OBJECT (one caller may read every field of `lead`
                        // and half of `account`), so the masker is resolved once
                        // and asked per item.
                        {
                            const listMetaType = RestServer.metaTypeSingular(req.params.type);
                            if (listMetaType === 'object') {
                                const raw = visible as unknown;
                                const list = RestServer.metaItemsArray(raw);
                                if (list.length > 0) {
                                    const masker = await this.resolveObjectMasker(environmentId, req, listMetaType);
                                    const projected: any[] = [];
                                    let undetermined = false;
                                    for (const item of list) {
                                        const objectName = String((item as any)?.name ?? '');
                                        let posture: ObjectSchemaMaskPosture;
                                        try {
                                            posture = await masker(objectName);
                                        } catch (maskError: any) {
                                            if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                                                // D6 tier 3 — one unevaluable
                                                // object fails the whole list
                                                // rather than serving it with a
                                                // silent hole in the projection.
                                                sendFieldVisibilityFault(res, objectName);
                                                return;
                                            }
                                            throw maskError;
                                        }
                                        if (posture.kind === 'undetermined') undetermined = true;
                                        const masked = this.maskObjectDocument(res, posture, objectName, item);
                                        if (!masked) return;
                                        projected.push(masked.document);
                                    }
                                    if (undetermined) res.header('Cache-Control', 'private, no-store');
                                    visible = Array.isArray(raw) ? projected : { ...(raw as any), items: projected };
                                }
                            }
                        }

                        const translated = await this.translateMetaItems(req, req.params.type, environmentId, visible);
                        res.header('Vary', 'Accept-Language');
                        res.json(translated);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata items of a type',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type/:name - Get specific item
        if (metadata.endpoints.item !== false) {
            // Phase 3a-references: /meta/:type/:name/references must be
            // registered BEFORE /meta/:type/:name so the more-specific
            // path wins under any first-match router strategy.
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:name/references`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).findReferencesToMeta !== 'function') {
                            res.json({ references: [] });
                            return;
                        }
                        const result = await (p as any).findReferencesToMeta({
                            type: req.params.type,
                            name: req.params.name,
                            ...(environmentId ? { environmentId } : {}),
                        });
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata items that reference this item',
                    tags: ['metadata'],
                },
            });

            // [#5882] GET /meta/:type/:name/layers — the three-layer diagnostic
            // projection as its OWN resource. Registered BEFORE
            // /meta/:type/:name for the same first-match reason as
            // /references above, and before /meta/:type/:section/:name, which
            // would otherwise capture this path with section=<name>,
            // name="layers".
            //
            // This path exists because the projection used to be reachable only
            // as `GET /meta/:type/:name?layers=true` — the same route answering
            // a SECOND, undeclared body shape depending on a query flag, while
            // `packages/spec` declared one `responseSchema` for it. The ruled
            // fix (maintainer, 2026-08-06) was one path per response shape,
            // deliberately NOT teaching the route declaration to express
            // "two shapes chosen by a flag": that would add a primitive every
            // future tool has to understand, and conditional response selection
            // is exactly where codegen and AI-written clients go wrong.
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:name/layers`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        // [ADR-0106 D2/D5] The dedicated path is its own
                        // schema-serving outlet — it resolves the caller's
                        // field-visibility posture exactly like the plain meta
                        // read does, with the NORMALIZED type (#3984 / #6241).
                        const layeredMetaType = RestServer.metaTypeSingular(req.params.type);
                        let maskPosture: ObjectSchemaMaskPosture;
                        try {
                            maskPosture = await (await this.resolveObjectMasker(environmentId, req, layeredMetaType))(req.params.name);
                        } catch (maskError: any) {
                            if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                                sendFieldVisibilityFault(res, req.params.name);
                                return;
                            }
                            throw maskError;
                        }
                        if (typeof (p as any).getMetaItemLayered !== 'function') {
                            // A dedicated path cannot fall through to the plain
                            // read the way the `?layers=` flag did — answering
                            // the merged `{ type, name, item }` envelope here
                            // would be answering a different resource with a
                            // shape this path never declares.
                            res.status(501).json({
                                error: 'Layered metadata view not supported by protocol implementation',
                                code: 'NOT_IMPLEMENTED',
                            });
                            return;
                        }
                        await this.serveMetaItemLayered(req, res, environmentId, p, maskPosture);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get a metadata item as its three layers (code / overlay / effective)',
                    tags: ['metadata'],
                },
            });

            // ADR-0046 §6 — GET /meta/book/:name/tree
            // Resolve a book spine against the docs that exist *now* into a
            // rendered tree (membership is DERIVED, never stored — §6.2.1). An
            // unknown name is treated as a package id and resolved against the
            // implicit per-package book (§6.4). Anonymous requests only see a
            // book whose `audience` is `public` (§6.7 read-layer gating).
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/book/:name/tree`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const prot = await this.resolveProtocol(environmentId, req);
                        const locale = this.extractLocale(req);
                        // [#6877] One package scopes the book lookup.
                        if (refuseRepeatedQueryParams(req, res, ['package'])) return;
                        const packageId = req.query?.package || undefined;
                        const { resolveBookTree, deriveImplicitPackageBook, audienceAllows, resolveDocAudiences, docAudienceAllows, resolveDocLocale } =
                            await import('@objectstack/spec/system');

                        const norm = (raw: any): any[] =>
                            Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);

                        const books = norm(await prot.getMetaItems({
                            type: 'book',
                            ...(packageId ? { packageId } : {}),
                            ...(environmentId ? { environmentId } : {}),
                        } as any));
                        let book = books.find((b: any) => b && b.name === req.params.name);
                        if (!book) {
                            // Unknown name → the implicit per-package book (§6.4).
                            book = deriveImplicitPackageBook(req.params.name, req.params.name);
                        }

                        // §6.7 — the book's audience gates the whole tree:
                        // anonymous → `public` only; `{ permissionSet }` →
                        // the caller must hold the named set (fail closed
                        // when holdings cannot be resolved, ADR-0049).
                        const audienceBooks = books.map((b: any) =>
                            b && typeof b === 'object' ? { ...b, packageId: b._packageId } : b);
                        const caller = await this.resolveAudienceCaller(environmentId, req, {
                            needPermissionSets: RestServer.anyPermissionSetAudience([book, ...audienceBooks]),
                        });
                        if (!audienceAllows((book as any).audience, caller)) {
                            if (!caller.authenticated) {
                                sendError(res, { code: 'UNAUTHENTICATED', message: 'This documentation requires sign-in', status: 401 });
                            } else {
                                sendError(res, { code: 'PERMISSION_DENIED', message: 'This documentation is limited to holders of a permission set you do not have', status: 403 });
                            }
                            return;
                        }

                        const docs = norm(await prot.getMetaItems({
                            type: 'doc',
                            ...(packageId ? { packageId } : {}),
                            ...(environmentId ? { environmentId } : {}),
                        } as any))
                            .map((d: any) => (d && typeof d === 'object' ? resolveDocLocale(d, locale) : d))
                            .map((d: any) => ({
                                name: d.name,
                                label: d.label,
                                description: d.description,
                                order: d.order,
                                group: d.group,
                                tags: d.tags,
                                packageId: d._packageId,
                            }));

                        const tree = resolveBookTree(book as any, docs, (book as any)._packageId);

                        // §6.7 — the tree's ENTRIES are additionally filtered by
                        // each doc's effective audience (union over claiming
                        // books, unclaimed → org), so an anonymous reader of a
                        // public book never sees nav entries that would 401 on
                        // fetch, and gated-only docs stay out of non-holders'
                        // trees. The book gate above passed, so this only ever
                        // narrows further for anonymous / non-holder callers.
                        const gatedTreePossible = !caller.authenticated
                            || RestServer.anyPermissionSetAudience(audienceBooks);
                        if (gatedTreePossible) {
                            const audiences = resolveDocAudiences(audienceBooks as any, docs);
                            tree.groups = tree.groups
                                .map((g: any) => ({
                                    ...g,
                                    entries: g.entries.filter((e: any) =>
                                        !e.doc || docAudienceAllows(audiences.get(e.doc), caller)),
                                }))
                                .filter((g: any) => g.entries.some((e: any) => e.doc || e.href));
                        }
                        res.json(tree);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Resolve a documentation book spine into its rendered tree (ADR-0046 §6)',
                    tags: ['metadata'],
                },
            });

            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:name`,
                handler: async (req: any, res: any) => {
                    try {
                        // [#6877] Declared at the top for the same reason #3984
                        // normalizes `:type` here: this handler reads its query
                        // parameters from four different branches hundreds of
                        // lines apart (`?layers=`, `?state=`, `?preview=`,
                        // `?package=`), and a per-branch gate is one a new branch
                        // inherits by accident rather than by construction.
                        if (refuseRepeatedQueryParams(req, res, ['layers', 'state', 'preview', 'package'])) return;
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);

                        // [#3984 / #6241] Normalize the `:type` segment ONCE,
                        // here at the top, and let every gate below read THIS
                        // value. The route serves both spellings and Prime
                        // Directive #3 makes the plural one canonical
                        // (`/meta/books/:name`), so any gate comparing the raw
                        // param is a gate the canonical spelling walks past.
                        //
                        // #3984 ruled this shape for exactly that reason ("每个
                        // handler 顶部归一一次,后续所有闸门都用归一后的值"), and
                        // #6241 is why the ruling is written into the code
                        // rather than trusted to memory: eight days after
                        // #3984 landed, the cache-branch condition below still
                        // excluded `doc`/`book` by LITERAL comparison, so
                        // `GET /meta/books/:name` took the cached branch and
                        // the §6.7 audience gate — which lives in the uncached
                        // branch — never ran at all. Measured on the real
                        // server, one `{ permissionSet }`-gated book, one
                        // signed-in caller holding no set:
                        //
                        //     singular "book"  :: cachedCalls=0 status=[403]
                        //     plural   "books" :: cachedCalls=1 status=[]  ← full body served
                        //
                        // A new per-type gate added below inherits the
                        // normalization by default now; there is no raw param
                        // in scope for it to compare against by accident.
                        const metaType = RestServer.metaTypeSingular(req.params.type);

                        // [ADR-0106 D2/D5] Resolve the caller's field-visibility
                        // posture ONCE, here, before any fetch — every exit
                        // below (layered, cached, uncached) projects through
                        // THIS value. Resolving per-branch is how an outlet gets
                        // forgotten; resolving before the fetch is what makes
                        // D3's `fetch → mask → send` ordering structural rather
                        // than a convention.
                        let maskPosture: ObjectSchemaMaskPosture;
                        try {
                            maskPosture = await (await this.resolveObjectMasker(environmentId, req, metaType))(req.params.name);
                        } catch (maskError: any) {
                            if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                                sendFieldVisibilityFault(res, req.params.name);
                                return;
                            }
                            throw maskError;
                        }

                        // Phase 3a-layered-get: opt-in 3-state view when client
                        // asks for `?layers=true` (or any non-empty value).
                        // Skips the cache path entirely — layered view is a
                        // diagnostic endpoint, not on the hot read path.
                        //
                        // [#5563 → #5882] DEPRECATED SPELLING. This flag makes one
                        // route answer a SECOND resource representation — three
                        // layers side by side (`code` / `overlay` / `effective`),
                        // where `effective` is what the plain read returns — while
                        // the route declares a single `responseSchema`. #5563
                        // converged the ordinary read and left this half open
                        // because collapsing the layers into
                        // `GetMetaItemResponseSchema`'s single `item` would delete
                        // the diagnostic outright.
                        //
                        // #5882 closed it the other way (maintainer ruling, 2026-08-06):
                        // the projection is now its own path,
                        // `GET /meta/:type/:name/layers`, declared by
                        // `GetMetaItemLayeredResponseSchema`. One path, one shape.
                        //
                        // This branch stays for a deprecation window so existing
                        // callers (Studio's metadata editor) are not broken by the
                        // move. It answers the IDENTICAL body — same helper, not a
                        // copy — and advertises the successor in the response
                        // headers, so a client can discover the migration without
                        // reading the changelog. Delete this branch (and the
                        // headers with it) once the callers have moved.
                        const wantLayered = req.query?.layers !== undefined && req.query?.layers !== '';
                        if (wantLayered && typeof (p as any).getMetaItemLayered === 'function') {
                            // RFC 9745 `Deprecation` + RFC 8288 `Link` — the same
                            // machine-readable pairing `versioning.zod.ts` already
                            // describes for retiring API versions, applied to a
                            // retiring query flag. No `Sunset` date: choosing the
                            // hard cut-off is a maintainer call, and an invented
                            // date is worse than none.
                            res.header('Deprecation', 'true');
                            res.header(
                                'Link',
                                `<${metaPath}/${req.params.type}/${req.params.name}/layers>; rel="successor-version"`,
                            );
                            await this.serveMetaItemLayered(req, res, environmentId, p, maskPosture);
                            return;
                        }

                        // Check if cached version is available.
                        // For `app` metadata we skip the cache path so the
                        // per-user RBAC filter below can apply without
                        // corrupting shared ETags across admin vs member
                        // viewers of the same app schema. Drafts also
                        // bypass cache: the cache is keyed on the
                        // published checksum and drafts are out-of-band.
                        const isAppType = metaType === 'app';
                        const isDraftRead = typeof req.query?.state === 'string'
                            && req.query.state.toLowerCase() === 'draft';
                        // ADR-0033/0037 — `?preview=draft` overlays a pending
                        // draft on the active item (draft wins, falls back to
                        // active). Must also bypass the cache: ETags are keyed
                        // on the published checksum, so a cached 304 would pin
                        // the preview to the stale published world.
                        const previewDrafts = typeof req.query?.preview === 'string'
                            && req.query.preview.toLowerCase() === 'draft';
                        // ADR-0048 — a `?package=` read is package-scoped
                        // (prefer-local). The cached path keys ETags on
                        // type+name only and does NOT thread `packageId` into
                        // `getMetaItemCached`, so two installed packages shipping
                        // the same type/name would share one cache entry and the
                        // scope hint would be silently dropped. Bypass the cache
                        // when a package scope is requested so the disambiguating
                        // `getMetaItem(type, name, packageId)` path runs.
                        const packageScoped = typeof req.query?.package === 'string'
                            && req.query.package.length > 0;
                        // `doc` and `book` bypass the shared cache: their §6.7
                        // audience gate is per-caller, and a shared ETag would
                        // leak gated content across viewers.
                        //
                        // [#6241] That sentence was already here while the
                        // exclusion beneath it compared the RAW param against
                        // the literals `'doc'` / `'book'`, so the canonical
                        // plural spelling took the cached branch and shipped
                        // the gated body. The exclusion is not incidental
                        // tidying — it is the stated security invariant above,
                        // and it now reads the normalized `metaType`.
                        //
                        // The predicate is ONE named value shared with the §6.7
                        // gate in the uncached branch (`isAudienceGatedType`),
                        // so "which types bypass the cache" and "which types
                        // are audience-gated" can no longer drift apart: the
                        // bypass exists only to make that gate reachable, and a
                        // future third gated type joins both sites at once.
                        //
                        // [#5881] `dashboard` bypasses it too, and the reason is
                        // NOT the one above — worth writing down, because the
                        // obvious reading says a dashboard needn't bypass at all.
                        // Its ADR-0057 D10 widget gate (`filterDashboardForUser`,
                        // below) is per-DEPLOYMENT — it asks which optional kernel
                        // services are registered — never per-caller, so there is
                        // no cross-viewer leak to avoid. What rules out sharing
                        // the cached path is the validator itself: the ETag is
                        // `simpleHash(locale + JSON.stringify(item))` over the
                        // UNFILTERED document (metadata-protocol `getMetaItemCached`),
                        // so it cannot express the gate dimension at all, and
                        // `notModified` is decided inside the protocol before this
                        // layer could re-judge it. Gating the cached body would
                        // therefore ship a filtered body under a validator that
                        // identifies the unfiltered one.
                        //
                        // That mismatch is not academic, because the two have
                        // different lifetimes. Within one boot the registered-service
                        // set is fixed (`Kernel.use()` throws once bootstrap has
                        // started, and no deregistration API exists), so the gate
                        // verdict is stable per process — but `Cache-Control:
                        // private, no-cache` means the client STORES the body and
                        // revalidates, and that stored body outlives the process.
                        // A redeploy that turns the optional service off does not
                        // change the document, so the ETag is unchanged, every
                        // revalidation answers 304, and the stale unfiltered body
                        // stands: the dead tile D10 exists to prevent, now cached
                        // indefinitely. Bypassing costs nothing to weigh against
                        // that — `getMetaItemCached` delegates to `getMetaItem`,
                        // so the server does identical work either way and only
                        // the 304's saved body bytes are given up.
                        //
                        // Compared on the NORMALIZED type, like every other
                        // exclusion in this condition (`/meta/dashboards/x` is
                        // the canonical plural spelling under Prime Directive
                        // #3, and an exclusion it could be spelled around would
                        // not be an exclusion). The `doc` / `book` literals
                        // that stood at the end of this condition had exactly
                        // that hole; #6241 closed it.
                        const isDashboardType = metaType === 'dashboard';
                        // ADR-0046 §6.7 — the two audience-gated types. Read by
                        // the cache exclusion here AND by the gate itself in
                        // the uncached branch below; one predicate, two sites.
                        const isAudienceGatedType = metaType === 'book' || metaType === 'doc';
                        if (metadata.enableCache && p.getMetaItemCached && !isAppType && !isDashboardType && !isDraftRead && !previewDrafts && !packageScoped && !isAudienceGatedType) {
                            // [ADR-0106 D3] When a projection applies, the
                            // protocol is NOT allowed to judge the conditional
                            // request: `getMetaItemCached` hashes the UNFILTERED
                            // document, so a `304` decided there would pin this
                            // caller to a body no mask ever touched — the same
                            // validator-vs-served-body mismatch #5881 recorded
                            // for the dashboard gate. The comparison moves below,
                            // against the fingerprinted ETag, which is the one
                            // that identifies what we are actually sending.
                            const maskApplies = maskPosture.kind !== 'passthrough';
                            const cacheRequest = {
                                ifNoneMatch: maskApplies ? undefined : (req.headers['if-none-match'] as string),
                                ifModifiedSince: req.headers['if-modified-since'] as string,
                            };

                            // Resolve the response locale up-front and fold it
                            // into the cache key. The body is translated below
                            // (`translateMetaItem`) *after* this validator runs,
                            // so without a locale-aware ETag a language switch
                            // would return a stale-locale 304 (issue #1319).
                            const cacheI18n = await this.resolveI18nService(environmentId, req);
                            const cacheLocale = this.extractLocale(req, cacheI18n);

                            const result = await p.getMetaItemCached({
                                type: req.params.type,
                                name: req.params.name,
                                cacheRequest,
                                ...(cacheLocale ? { locale: cacheLocale } : {}),
                                ...(environmentId ? { environmentId } : {}),
                            } as any);

                            if (result.notModified) {
                                res.status(304).send();
                                return;
                            }

                            // [ADR-0106 D1/D3] fetch → mask → send. The shared
                            // cache still stores ONE full schema per (type,
                            // name, locale, environment) — no caller dimension
                            // in the key — and what varies per caller is this
                            // projection plus the validator below.
                            let cachedDocument: any = result.data;
                            let visibilityFingerprint = '';
                            if (maskPosture.kind === 'project') {
                                const masked = this.maskObjectDocument(res, maskPosture, req.params.name, cachedDocument);
                                if (!masked) return;
                                cachedDocument = masked.document;
                                visibilityFingerprint = masked.fingerprint;
                            }

                            // [ADR-0106 D6 tier 2] Visibility undetermined →
                            // the body is unmasked, so it must not be stored or
                            // revalidated under a SHARED validator: a later 304
                            // would hand this body to a caller whose projection
                            // did resolve. No ETag, no Last-Modified, no-store.
                            if (maskPosture.kind === 'undetermined') {
                                res.header('Cache-Control', 'private, no-store');
                                res.header('Vary', 'Accept-Language');
                                res.json(await this.translateMetaEnvelope(
                                    req, req.params.type, environmentId,
                                    { type: metaType, name: req.params.name },
                                    cachedDocument, cacheI18n,
                                ));
                                return;
                            }

                            // Set cache headers
                            if (result.etag) {
                                // [ADR-0106 D3] Fold the caller's field-visibility
                                // fingerprint into the shared validator. An
                                // unrestricted caller denies nothing → the
                                // fingerprint is empty → the ETag is byte-identical
                                // to the pre-ADR one. A cohort shares 304s; a
                                // permission change moves the fingerprint and
                                // self-invalidates the stale 304.
                                const value = foldVisibilityFingerprintIntoEtag(result.etag.value, visibilityFingerprint);
                                const etagValue = result.etag.weak
                                    ? `W/"${value}"`
                                    : `"${value}"`;
                                res.header('ETag', etagValue);
                                if (maskApplies && normalizeIfNoneMatch(req.headers['if-none-match']) === value) {
                                    res.status(304).send();
                                    return;
                                }
                            }
                            if (result.lastModified) {
                                res.header('Last-Modified', new Date(result.lastModified).toUTCString());
                            }
                            if (result.cacheControl) {
                                // `max-age` is a placeholder directive in the
                                // array; its real value is appended from the
                                // `maxAge` field. Strip the bare token before
                                // joining so the two never collide into the
                                // malformed `public, max-age, max-age=3600`.
                                const parts: string[] = result.cacheControl.directives
                                    .filter((d: string) => d !== 'max-age');
                                if (result.cacheControl.maxAge != null) {
                                    parts.push(`max-age=${result.cacheControl.maxAge}`);
                                }
                                res.header('Cache-Control', parts.join(', '));
                            }

                            res.header('Vary', 'Accept-Language');
                            // [#5563] `getMetaItemCached` hands back the metadata
                            // document with the envelope already stripped
                            // (`result.data`; it does `const item = result?.item`
                            // internally). This branch is the DEFAULT — `enableCache`
                            // defaults to `true` — so leaving it unwrapped made the
                            // one shape `packages/spec` declares for this route the
                            // one a default deployment could never obtain. Rebuild
                            // the declared envelope here, in the REST layer that
                            // owns the response contract.
                            //
                            // `type` is folded to the canonical singular exactly as
                            // `metadata-protocol` folds it (#4432), so `/meta/objects/x`
                            // and `/meta/object/x` cannot answer two different `type`
                            // values across a configuration switch. The cached read
                            // carries no `lock` — it is the fast published-value path
                            // and never consulted the lock resolver; a caller that
                            // needs the ADR-0008 OCC carriers reads the uncached path.
                            const cachedEnvelope = {
                                type: metaType,
                                name: req.params.name,
                            };
                            res.json(await this.translateMetaEnvelope(
                                req, req.params.type, environmentId, cachedEnvelope, cachedDocument, cacheI18n,
                            ));
                        } else {
                            // Non-cached version
                            const packageId = req.query?.package || undefined;
                            const stateParam = typeof req.query?.state === 'string'
                                ? req.query.state.toLowerCase()
                                : undefined;
                            const envelope = await p.getMetaItem({
                                type: req.params.type,
                                name: req.params.name,
                                packageId,
                                ...(stateParam === 'draft' ? { state: 'draft' } : {}),
                                ...(previewDrafts ? { previewDrafts: true } : {}),
                            } as any) as Record<string, any>;

                            // [#5563] `getMetaItem` answers the envelope
                            // `{ type, name, item, lock, … }`. Unwrap ONCE here;
                            // every gate below operates on the document, and the
                            // envelope is rebuilt around the result at `res.json`.
                            // Nothing downstream asks which shape it holds.
                            let visible: any = envelope?.item;
                            // Same per-user RBAC filtering as the list endpoint:
                            // for `app` items, drop entirely (404) when the user
                            // lacks the app's `requiredPermissions`, and strip
                            // forbidden nav entries from the returned schema.
                            if (isAppType && visible) {
                                const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                                if (ctx?.userId) {
                                    const sysPerms = new Set<string>(
                                        Array.isArray(ctx.systemPermissions) ? ctx.systemPermissions : [],
                                    );
                                    const registered = await this.resolveRegisteredServices((ctx as any).__kernel, [visible]);
                                    const serviceGate = registered ? (n: string) => registered.has(n) : undefined;
                                    // [#7912] Same gate as the list route — the
                                    // by-name route must not serve a nav entry
                                    // the list route prunes, or reading the
                                    // single-app JSON defeats the filter (the
                                    // #4722 lesson, one gate over).
                                    const servabilityGate = await this.resolveNavServability(p, environmentId) ?? undefined;
                                    const gated = this.filterAppForUserWithReason(visible, sysPerms, serviceGate, servabilityGate);
                                    visible = gated.app;
                                    if (visible == null) {
                                        // [#8013] A PERMISSION denial is reported as
                                        // one — everything else keeps answering
                                        // absence. See
                                        // {@link filterAppForUserWithReason} for why
                                        // only this one of the three gates converts,
                                        // and why the reason comes from the branch
                                        // that fired rather than from `null`.
                                        //
                                        // The condition is generic, so it takes the
                                        // ADR-0112 STANDARD catalog code rather than
                                        // a bespoke synonym — 403 `PERMISSION_DENIED`,
                                        // which is also what
                                        // `standardErrorCodeForHttpStatus(403)`
                                        // answers. objectui#4252 branches on exactly
                                        // this `code`.
                                        //
                                        // Written through the shared `sendError`
                                        // (`@objectstack/types`), aliased because this
                                        // module has a local function of that name.
                                        // That builder emits the DECLARED envelope
                                        // `{ success: false, error: { code, message } }`,
                                        // so the console reads `body.error.code` — the
                                        // same accessor as the absence answer below,
                                        // rather than a second dialect to special-case.
                                        if (gated.withheld === 'permission') {
                                            sendEnvelopeError(
                                                res,
                                                403,
                                                'PERMISSION_DENIED',
                                                `You do not have permission to open the '${req.params.name}' app.`,
                                            );
                                            return;
                                        }
                                        res.status(404).json({
                                            error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' },
                                        });
                                        return;
                                    }
                                }
                            }

                            // ADR-0057 D10: gate dashboard widgets by `requiresService`
                            // (mirrors the app-nav gate above) so the console never
                            // renders a tile bound to an absent optional service.
                            //
                            // [#5881] This is now on the DEFAULT path. It reads as
                            // ordinary code either way, which is exactly why the
                            // defect was invisible: `enableCache` defaults to true
                            // and `dashboard` was not excluded above, so every
                            // default deployment took the cached branch and this
                            // gate ran only where an operator had turned the cache
                            // off. Declared, tested, and never executed in
                            // production — the exclusion above is what makes the
                            // ADR's "the server is the authoritative gate" true
                            // rather than merely written down.
                            if (isDashboardType && visible) {
                                const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                                const registered = await this.resolveRegisteredServices((ctx as any)?.__kernel, [visible]);
                                const serviceGate = registered ? (n: string) => registered.has(n) : undefined;
                                if (serviceGate) visible = this.filterDashboardForUser(visible, serviceGate);
                            }

                            // ADR-0046 §6.7 — audience gate on single-item reads.
                            // A `book` is gated by its own audience; a `doc` by its
                            // EFFECTIVE audience (union over the books that claim
                            // it, unclaimed → org). 401 for anonymous, 403 for an
                            // authenticated non-holder; fail closed when holdings
                            // cannot be resolved (ADR-0049).
                            if (isAudienceGatedType && visible) {
                                const { audienceAllows, docAudienceAllows, resolveDocAudiences } =
                                    await import('@objectstack/spec/system');
                                // The document under audience test. [#5563] This
                                // used to unwrap an envelope-or-document here;
                                // `visible` is always the document now, so the
                                // name is all that is left — and it is worth
                                // keeping, because `audience` is read off the
                                // DOCUMENT and reading it off an envelope would
                                // silently grant everyone (`undefined` audience).
                                const target = visible;
                                let caller: { authenticated: boolean; permissionSets?: string[] };
                                let allowed: boolean;
                                if (metaType === 'book') {
                                    caller = await this.resolveAudienceCaller(environmentId, req, {
                                        needPermissionSets: RestServer.anyPermissionSetAudience([target]),
                                    });
                                    allowed = audienceAllows(target?.audience, caller);
                                } else {
                                    const books = await this.fetchAudienceBooks(p, environmentId);
                                    caller = await this.resolveAudienceCaller(environmentId, req, {
                                        needPermissionSets: RestServer.anyPermissionSetAudience(books),
                                    });
                                    if (caller.authenticated && !RestServer.anyPermissionSetAudience(books)) {
                                        allowed = true; // no gated book anywhere → org suffices
                                    } else {
                                        const corpus = RestServer.metaItemsArray(await p.getMetaItems({
                                            type: 'doc',
                                            ...(environmentId ? { environmentId } : {}),
                                        } as any).catch(() => []))
                                            .filter((d: any) => d && typeof d === 'object')
                                            .map((d: any) => ({
                                                name: d.name,
                                                group: d.group,
                                                tags: d.tags,
                                                order: d.order,
                                                packageId: d._packageId,
                                            }));
                                        const audiences = resolveDocAudiences(books as any, corpus);
                                        allowed = docAudienceAllows(audiences.get(target?.name), caller);
                                    }
                                }
                                if (!allowed) {
                                    if (!caller.authenticated) {
                                        sendError(res, { code: 'UNAUTHENTICATED', message: 'This documentation requires sign-in', status: 401 });
                                    } else {
                                        sendError(res, { code: 'PERMISSION_DENIED', message: 'This documentation is limited to holders of a permission set you do not have', status: 403 });
                                    }
                                    return;
                                }
                            }

                            // ADR-0046 i18n: collapse the doc to the request
                            // locale (label/description/content) and drop the
                            // `translations` map so consumers get one body.
                            if (metaType === 'doc' && visible) {
                                const locale = this.extractLocale(req);
                                const { resolveDocLocale } = await import('@objectstack/spec/system');
                                visible = resolveDocLocale(visible as any, locale);
                            }

                            // [ADR-0106 D1/D5(1)] The uncached exit. Same
                            // posture, same projection — this branch serves
                            // `?state=draft`, `?preview=draft`, `?package=` and
                            // any deployment with `enableCache: false`, so a
                            // mask that lived only in the cached branch would be
                            // walked past by a query parameter (#5881's shape,
                            // in reverse).
                            if (maskPosture.kind === 'project') {
                                const masked = this.maskObjectDocument(res, maskPosture, req.params.name, visible);
                                if (!masked) return;
                                visible = masked.document;
                            } else if (maskPosture.kind === 'undetermined') {
                                res.header('Cache-Control', 'private, no-store');
                            }

                            res.header('Vary', 'Accept-Language');
                            res.json(await this.translateMetaEnvelope(
                                req, req.params.type, environmentId, envelope, visible,
                            ));
                        }
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get specific metadata item',
                    tags: ['metadata'],
                },
            });
        }

        // PUT /meta/:type/:name - Save metadata item
        // We always register this route, but return 501 if protocol doesn't support it
        // This makes it discoverable even if not implemented
        this.routeManager.register({
            method: 'PUT',
            path: `${metaPath}/:type/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#6603] Authoring capability gate — the SAME mechanism
                    // `POST /meta/_migrate-stored` uses next door, deliberately
                    // not a second way of demanding the same capability.
                    //
                    // Two independent reasons, either sufficient:
                    //
                    //  1. **The ADR-0106 round-trip.** D1 removes an unreadable
                    //     field WHOLE from a served object schema, and this
                    //     route persists the body it is handed. So a non-exempt
                    //     caller's ordinary GET → edit a label → PUT used to
                    //     store the schema back MINUS the fields masked out of
                    //     their own read — silent deletion of fields they were
                    //     never allowed to see, with nothing in the exchange
                    //     saying so. Refusing the write is the write-side answer
                    //     the masking needs: it makes "whoever may write a
                    //     schema is whoever sees all of it" an enforced
                    //     invariant instead of a coincidence, rather than
                    //     teaching `saveMetaItem` that absent means keep (which
                    //     would make field DELETION inexpressible for everyone).
                    //  2. It closes a hole that predates masking entirely: any
                    //     authenticated session could clobber any metadata item.
                    //
                    // Gate FIRST — before the protocol is resolved — so an
                    // unauthorized caller cannot use the 501-vs-200 answer to
                    // probe which kernels implement saving, and so nothing is
                    // written before the refusal. `manage_metadata` is
                    // ADR-0066 D1's authoring capability and saving a metadata
                    // item is authoring; `isSystem` bypasses, matching every
                    // other capability gate on the platform.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                    const held = new Set<string>(
                        Array.isArray(ctx?.systemPermissions) ? ctx!.systemPermissions : [],
                    );
                    if (!ctx?.isSystem && !held.has('manage_metadata')) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: 'Saving a metadata item requires the `manage_metadata` capability.',
                            },
                        });
                        return;
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!p.saveMetaItem) {
                        // [#7035] ADR-0112 envelope: the semantic code lives at
                        // `error.code`, NOT as a sibling of `error`. This site
                        // used to answer `{ error: '<msg>', code: 'NOT_IMPLEMENTED' }`
                        // while `POST /meta/_migrate-stored` a few hundred lines
                        // up answered the nested shape for the same condition,
                        // so a client reading `err.error.code` got `undefined`
                        // here — and `undefined` takes the "no code" branch, not
                        // an error branch. `NOT_IMPLEMENTED` is unchanged: it is
                        // already the standard-catalog code ADR-0112 maps 501 to
                        // (`spec/src/api/errors.zod.ts` — the catalog member and
                        // `standardErrorCodeForHttpStatus(501)`).
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'Save operation not supported by protocol implementation',
                            },
                        });
                        return;
                    }

                    // Accept both `{ ...itemFields }` (bare) and `{ metadata: {...} }`
                    // / `{ item: {...} }` envelope shapes. Studio and direct API
                    // callers historically use either; ADR-0005 settles on
                    // unwrapping to a single payload before persistence.
                    const body = req.body ?? {};
                    const item = (body && typeof body === 'object' && 'metadata' in body)
                        ? (body as any).metadata
                        : (body && typeof body === 'object' && 'item' in body)
                            ? (body as any).item
                            : body;

                    // Opt-in OCC under ADR-0008 PR-10d.3: callers (Studio,
                    // CLI) may set `If-Match: <sha256:...>` to enforce that
                    // the overlay row has not advanced since they last read
                    // it. A `null`/empty body or no header preserves the
                    // legacy last-write-wins behaviour.
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const parentVersion = typeof ifMatchHeader === 'string'
                        ? ifMatchHeader.replace(/^"|"$/g, '') // strip ETag-style quotes
                        : undefined;
                    // [#7749] Header, else the request's authenticated identity — one
                    // producer, shared by every `/meta` write (see resolveMetaWriteActor).
                    const actor = await this.resolveMetaWriteActor(environmentId, req);
                    // Phase 3a-destructive: `?force=true` opts past the
                    // destructive-change safety check. Accept any truthy
                    // string ('true', '1', 'yes') for resilience.
                    //
                    // [#6877] THE sharp one on this surface. The `typeof` ternary
                    // below falls to `!!forceRaw` for anything that is not a
                    // string, and a non-empty array is truthy — so
                    // `?force=false&force=false`, a caller repeating an explicit
                    // OPT-OUT, turned the destructive-change guard ON. An
                    // inversion, on a destructive verb, reported as 200.
                    if (refuseRepeatedQueryParams(req, res, ['force', 'package', 'mode'])) return;
                    const forceRaw = req.query?.force;
                    const force = typeof forceRaw === 'string'
                        ? ['true', '1', 'yes', 'on'].includes(forceRaw.toLowerCase())
                        : !!forceRaw;

                    // Software-package binding (Studio package authoring).
                    // `?package=<id>` binds the saved row to that package
                    // (sys_metadata.package_id). 'all'/empty = env-local overlay.
                    const packageRaw = req.query?.package;
                    const packageId = typeof packageRaw === 'string' && packageRaw && packageRaw !== 'all'
                        ? packageRaw
                        : undefined;

                    const result = await p.saveMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        item,
                        ...(environmentId ? { environmentId } : {}),
                        ...(parentVersion !== undefined ? { parentVersion } : {}),
                        ...(actor ? { actor } : {}),
                        ...(force ? { force: true } : {}),
                        ...(packageId ? { packageId } : {}),
                        ...((typeof req.query?.mode === 'string'
                            && req.query.mode.toLowerCase() === 'draft')
                            ? { mode: 'draft' } : {}),
                    } as any);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Save specific metadata item',
                tags: ['metadata'],
            },
        });

        // DELETE /meta/:type/:name - Reset metadata item to artifact default
        // Removes a customization overlay row from sys_metadata (ADR-0005).
        // Returns 200 even when no overlay existed (idempotent reset).
        this.routeManager.register({
            method: 'DELETE',
            path: `${metaPath}/:type/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#7019] Same gate, same mechanism as the `PUT` twins —
                    // but the argument for it is NOT the ADR-0106 round trip,
                    // and saying so matters. Nothing is masked here and nothing
                    // is round-tripped: this route discards a customization
                    // overlay outright, so before this gate an authenticated
                    // session holding no authoring capability at all could
                    // reset any customized metadata item in the deployment to
                    // its artifact default — and with `?dropStorage=true`, drop
                    // the object's physical table with it.
                    //
                    // It belongs with the two PUTs because deleting a
                    // customization is authoring it (ADR-0066 D1), and because
                    // the fix is the same four lines — not because it is the
                    // same argument.
                    //
                    // Gate FIRST — before the protocol is resolved — so the
                    // 501-vs-200 answer leaks no kernel capability, and, the
                    // point here, so the refusal happens with the overlay row
                    // still intact. A gate that answers 403 after
                    // `deleteMetaItem` has run would still be the bug.
                    // `isSystem` bypasses, as everywhere else.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                    const held = new Set<string>(
                        Array.isArray(ctx?.systemPermissions) ? ctx!.systemPermissions : [],
                    );
                    if (!ctx?.isSystem && !held.has('manage_metadata')) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: 'Resetting a metadata item requires the `manage_metadata` capability.',
                            },
                        });
                        return;
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).deleteMetaItem) {
                        // [#7035] ADR-0112 envelope. This site was the worst of
                        // the three shapes: a BARE STRING `error`, with no code
                        // at all — so neither `err.error.code` nor `err.code`
                        // resolved, and `err.error.message` read `undefined`
                        // too. `NOT_IMPLEMENTED` is the standard-catalog code
                        // for 501 (ADR-0112; `standardErrorCodeForHttpStatus`).
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'Reset operation not supported by protocol implementation',
                            },
                        });
                        return;
                    }
                    // Mirror saveMetaItem's OCC + actor plumbing (ADR-0008
                    // PR-10d wiring): `If-Match` pins the expected current
                    // version so concurrent edits get a 409 instead of a
                    // silent reset; `X-Actor` — or, since #7749, the request's
                    // authenticated identity — flows into the history
                    // tombstone row.
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const parentVersion = typeof ifMatchHeader === 'string'
                        ? ifMatchHeader.replace(/^"|"$/g, '')
                        : undefined;
                    // [#7749] Header, else the request's authenticated identity — one
                    // producer, shared by every `/meta` write (see resolveMetaWriteActor).
                    const actor = await this.resolveMetaWriteActor(environmentId, req);

                    // [#6877] `?state=` and the destructive `?dropStorage=`
                    // both fail SAFE on an array today (the comparisons stop
                    // matching), but "the wrong answer happens to be the
                    // conservative one" is not a rule a caller can rely on and
                    // is not what the request asked for.
                    if (refuseRepeatedQueryParams(req, res, ['state', 'dropStorage'])) return;
                    const stateParam = typeof req.query?.state === 'string'
                        && req.query.state.toLowerCase() === 'draft'
                        ? 'draft' as const
                        : undefined;

                    // `?dropStorage=true` also tears down the object's physical
                    // table (object + active only). Used by the "discard a
                    // previewed object" flow so a publish-to-preview leaves no
                    // orphan table. Destructive — opt-in, defaults off.
                    const dropStorage = req.query?.dropStorage === 'true' || req.query?.dropStorage === '1';

                    const result = await (p as any).deleteMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        ...(environmentId ? { environmentId } : {}),
                        ...(parentVersion !== undefined ? { parentVersion } : {}),
                        ...(actor ? { actor } : {}),
                        ...(stateParam ? { state: stateParam } : {}),
                        ...(dropStorage ? { dropStorage: true } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Reset metadata item to artifact default (deletes customization overlay)',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:name/history — durable change-log for one item.
        // Returns the sys_metadata_history events that the Studio "History"
        // tab renders as an audit timeline. Overlay-only metadata types
        // (view/dashboard/report/email_template) return real events;
        // non-overlay types return `{ events: [] }` (the legacy raw-engine
        // path does not record history).
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/:type/:name/history`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).historyMetaItem) {
                        res.status(501).json({
                            error: 'History query not supported by protocol implementation',
                        });
                        return;
                    }
                    // [#6877] `Number(['1','2'])` is `NaN`, which the
                    // `Number.isFinite` spreads below drop — so a repeated
                    // `?limit=` silently returned the UNLIMITED history instead
                    // of the page the caller asked for.
                    if (refuseRepeatedQueryParams(req, res, ['sinceSeq', 'limit'])) return;
                    const sinceSeq = req.query?.sinceSeq !== undefined
                        ? Number(req.query.sinceSeq)
                        : undefined;
                    const limit = req.query?.limit !== undefined
                        ? Number(req.query.limit)
                        : undefined;
                    const result = await (p as any).historyMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        ...(environmentId ? { environmentId } : {}),
                        ...(sinceSeq !== undefined && Number.isFinite(sinceSeq) ? { sinceSeq } : {}),
                        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List durable history events for a metadata item',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:name/audit — ADR-0010 §3.6 / Phase 4.1.
        // Compliance trail for the metadata-protection layer: returns
        // recent sys_metadata_audit rows (save/publish/rollback/delete/
        // reset attempts, both allowed and denied) so Studio's "审计
        // 日志 / Audit log" tab can show who tried what and whether
        // a lock blocked it. Empty array on environments where the
        // table is not yet provisioned.
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/:type/:name/audit`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (typeof (p as any).auditMetaItem !== 'function') {
                        res.json({ events: [] });
                        return;
                    }
                    // [#6877] Same `Number(...)` → `NaN` → dropped-limit shape as
                    // the history twin above.
                    if (refuseRepeatedQueryParams(req, res, ['limit'])) return;
                    const limit = req.query?.limit !== undefined
                        ? Number(req.query.limit)
                        : undefined;
                    // [#8747] SCOPE THE READ. Without an organization this
                    // route returned every tenant's audit rows for a
                    // `(type, name)` — measured, not inferred — and it carries
                    // no capability gate (unlike its `PUT` twin, which gates on
                    // `manage_metadata`), so the cohort was any authenticated
                    // principal of any tenant, on the published SDK surface.
                    //
                    // The organization comes from `resolveExecCtx`, which this
                    // file already calls in 40+ handlers including the `PUT`
                    // twin — `computeExecCtx` assembles `tenantId` from the
                    // shared `resolveAuthzContext` (an API key's principal
                    // tenant, else the session's `activeOrganizationId`).
                    //
                    // ⚠️ This deliberately does NOT mint the seam the
                    // `/published` route's comment forbids further down this
                    // file: no `resolveActiveOrganizationId`, no new org
                    // plumbing in `packages/rest`. It reads a field the
                    // execution context already carries. `?? null` keeps the
                    // fail-closed direction — an unresolved organization reads
                    // env-wide rows, never everyone's.
                    //
                    // `environmentId` is GONE from this payload, and that is a
                    // deletion of dead weight rather than a behaviour change:
                    // `auditMetaItem`'s request type never declared it and its
                    // body never read it. Environment scoping is unaffected
                    // because it comes from WHICH protocol `resolveProtocol`
                    // hands back — the same reasoning the `/published` route
                    // states below — not from the request payload. It is still
                    // read on the two lines that need it.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                    const result = await (p as any).auditMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        organizationId: ctx?.tenantId ?? null,
                        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'List protection-audit events for a metadata item',
                tags: ['metadata'],
            },
        });

        // POST /meta/:type/:name/publish — promote the pending draft
        // overlay to live. 404 [no_draft] when nothing to publish.
        this.routeManager.register({
            method: 'POST',
            path: `${metaPath}/:type/:name/publish`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).publishMetaItem) {
                        res.status(501).json({
                            error: 'Publish operation not supported by protocol implementation',
                        });
                        return;
                    }
                    // [#7749] Header, else the request's authenticated identity — one
                    // producer, shared by every `/meta` write (see resolveMetaWriteActor).
                    const actor = await this.resolveMetaWriteActor(environmentId, req);
                    const body = (req.body && typeof req.body === 'object') ? req.body : {};
                    const message = typeof body.message === 'string' ? body.message : undefined;
                    const result = await (p as any).publishMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        ...(environmentId ? { environmentId } : {}),
                        ...(actor ? { actor } : {}),
                        ...(message ? { message } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Publish the pending draft overlay (promotes draft → active)',
                tags: ['metadata'],
            },
        });

        // POST /meta/:type/:name/rollback — restore a historical version
        // as the new live overlay. Body: { toVersion: <number>, message? }.
        this.routeManager.register({
            method: 'POST',
            path: `${metaPath}/:type/:name/rollback`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).rollbackMetaItem) {
                        res.status(501).json({
                            error: 'Rollback operation not supported by protocol implementation',
                        });
                        return;
                    }
                    // [#6877] The `Number(...)` below already refuses an array
                    // — but as `INVALID_REQUEST` "'toVersion' (positive integer)
                    // is required", which tells a caller who supplied two valid
                    // integers that they supplied none. Refusing the multiplicity
                    // by name says what actually happened.
                    if (refuseRepeatedQueryParams(req, res, ['toVersion'])) return;
                    const body = (req.body && typeof req.body === 'object') ? req.body : {};
                    const toVersionRaw = body.toVersion ?? body.version ?? req.query?.toVersion;
                    const toVersion = Number(toVersionRaw);
                    if (!Number.isFinite(toVersion) || toVersion < 1) {
                        res.status(400).json({
                            error: `'toVersion' (positive integer) is required`,
                            code: 'INVALID_REQUEST',
                        });
                        return;
                    }
                    // [#7749] Header, else the request's authenticated identity — one
                    // producer, shared by every `/meta` write (see resolveMetaWriteActor).
                    const actor = await this.resolveMetaWriteActor(environmentId, req);
                    const message = typeof body.message === 'string' ? body.message : undefined;
                    const result = await (p as any).rollbackMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        toVersion,
                        ...(environmentId ? { environmentId } : {}),
                        ...(actor ? { actor } : {}),
                        ...(message ? { message } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Restore the body at the given history version as the new live row',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:name/diff?from=N&to=M — structural diff
        // between two historical versions (or one version vs current).
        this.routeManager.register({
            method: 'GET',
            path: `${metaPath}/:type/:name/diff`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).diffMetaItem) {
                        res.status(501).json({
                            error: 'Diff operation not supported by protocol implementation',
                        });
                        return;
                    }
                    const parseV = (raw: any): number | undefined => {
                        if (raw === undefined || raw === null || raw === '') return undefined;
                        const n = Number(raw);
                        return Number.isFinite(n) ? n : undefined;
                    };
                    // [#6877] `parseV` returns `undefined` for `NaN`, and the
                    // spreads below then omit the bound entirely — so a repeated
                    // `?from=` quietly diffed a different pair of versions and
                    // answered 200.
                    if (refuseRepeatedQueryParams(req, res, ['from', 'fromVersion', 'to', 'toVersion'])) return;
                    const fromVersion = parseV(req.query?.from ?? req.query?.fromVersion);
                    const toVersion = parseV(req.query?.to ?? req.query?.toVersion);
                    const result = await (p as any).diffMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        ...(environmentId ? { environmentId } : {}),
                        ...(fromVersion !== undefined ? { fromVersion } : {}),
                        ...(toVersion !== undefined ? { toVersion } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Diff two metadata versions (from/to query params; omit for previous-vs-current)',
                tags: ['metadata'],
            },
        });

        // GET /meta/objects/:name/state/:field?from=:state — ADR-0020 D3.3
        // legal-next-state introspection. [#7526]
        //
        // Ledgered since #3563 (`route-ledger.ts`, `meta.getLegalNextStates`)
        // and implemented in the dispatcher's `/meta` branch — but REST's ~17
        // `/meta` routes topped out at THREE path segments and this one needs
        // four, so no registration here could ever deliver it and it answered
        // Hono's `notFound`, byte-identical to an unmounted path.
        //
        // Registered BEFORE the compound `/:type/:section/:name/published`
        // twin below, which it collides with on exactly one shape:
        // `/meta/objects/x/state/published`. Two literal segments (`objects`,
        // `state`) beat one, so the FSM reading wins that path — a field
        // literally named `published` is the ambiguity, and answering it as
        // "the published version of the compound name objects/x/state" would
        // be the less likely of the two by a wide margin.
        //
        // `/object` as well as `/objects`: `metadata-protocol` folds the two
        // spellings (#4432) and the dispatcher branch accepts both, so the
        // REST mount that replaces it must not be pickier than what it
        // replaces.
        for (const objectsSegment of ['objects', 'object']) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/${objectsSegment}/:name/state/:field`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const name = String(req.params?.name ?? '');
                        const field = String(req.params?.field ?? '');
                        // [#6877 shape] `?from=` narrows to ONE current state;
                        // an array would reach `legalNextStates` as a
                        // stringified pair and match no transition key.
                        if (refuseRepeatedQueryParams(req, res, ['from'])) return;
                        const from = req.query?.from !== undefined ? String(req.query.from) : undefined;
                        const ql = this.objectQLProvider
                            ? await this.objectQLProvider(environmentId).catch(() => undefined)
                            : undefined;
                        const schema = (ql as any)?.registry?.getObject?.(name);
                        if (!schema) {
                            // `{ error: { code, message } }`, the envelope
                            // `BaseResponseSchema` declares — not the bare
                            // `{ error: 'string' }` the dispatcher branch this
                            // mirrors emits. `pnpm check:route-envelope`
                            // ratchets both non-conforming shapes DOWN only, so
                            // a new route arrives conforming or not at all.
                            res.status(404).json({
                                error: { code: 'NOT_FOUND', message: 'Object not found' },
                            });
                            return;
                        }
                        // Dynamic import, matching the dispatcher branch this
                        // mirrors: `@objectstack/objectql` is a devDependency
                        // here, so a deployment serving REST without the data
                        // engine must degrade rather than fail to load.
                        let legalNextStates:
                            | ((s: { validations?: unknown[] } | null | undefined, f: string, c: string) => string[] | null)
                            | undefined;
                        try {
                            ({ legalNextStates } = await import('@objectstack/objectql'));
                        } catch {
                            legalNextStates = undefined;
                        }
                        if (typeof legalNextStates !== 'function') {
                            res.status(501).json({
                                error: {
                                    code: 'NOT_IMPLEMENTED',
                                    message: 'State-machine introspection is not available in this runtime',
                                },
                            });
                            return;
                        }
                        // `next: null` = no FSM governs the field; `next: []` =
                        // a declared dead end. Same three-valued answer the
                        // dispatcher gives, because a UI asking "where can this
                        // record go" must be able to tell those apart.
                        const next = from === undefined ? null : legalNextStates(schema, field, from);
                        res.json({ object: name, field, from: from ?? null, next });
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'List the legal next states declared by an object field\'s state machine',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type/:name/published — ADR-0033 published snapshot. [#7526]
        //
        // Ledgered since #3563 (`meta.getPublished`) and implemented in the
        // dispatcher, but never mounted here — so the request fell into the
        // compound-name route below with `section=:name, name='published'`,
        // which answered a protection-envelope stub. Identical before and
        // after publish, identical for a name that does not exist: a route
        // that structurally could not 404.
        //
        // Both arities, mirroring the `getItem` / `saveItem` twins: the SDK
        // documents `getPublished('lead', 'views/all_leads')`, and a compound
        // name is how every other read on this surface addresses a
        // sub-resource. REGISTERED BEFORE `/:type/:section/:name` — the
        // three-segment form collides with it exactly the way `/history` and
        // `/audit` do, and Hono is first-match-wins.
        for (const publishedPath of [
            `${metaPath}/:type/:name/published`,
            `${metaPath}/:type/:section/:name/published`,
        ]) {
            this.routeManager.register({
                method: 'GET',
                path: publishedPath,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const type = String(req.params?.type ?? '');
                        const section = req.params?.section;
                        const name = section
                            ? `${section}/${req.params?.name ?? ''}`
                            : String(req.params?.name ?? '');
                        // [#8278] The AUTHORITATIVE published store is consulted
                        // first: the `state:'active'` `sys_metadata` overlay row.
                        // Mirrors the dispatcher fix (#8031 / PR #8254,
                        // `packages/runtime/src/domains/meta.ts`) onto the
                        // transport that actually serves the cloud runtime — the
                        // two doors answered the same question from two stores,
                        // and only one of them had been corrected.
                        //
                        // Two publish lifecycles write to two different places:
                        //
                        //   - `MetadataManager.publishPackage` snapshots a body
                        //     into the row-local `publishedDefinition` key of its
                        //     own in-memory registry — the ADR-0016-era package
                        //     publish, which is what `getPublished` below reads.
                        //   - `publishPackageDrafts` / `promoteDraft` flips the
                        //     artifact's `sys_metadata` row `state:'draft' →
                        //     'active'`. ADR-0027 (E)(5) defines sealing a publish
                        //     as exactly that flip, `SysMetadataRepository` names
                        //     `'active'` "the published, live overlay", and
                        //     ADR-0033 §2 routes EVERY runtime authoring write
                        //     into that same ADR-0027 draft — so promoting it is
                        //     what "published" means for anything authored at
                        //     runtime. Those items were absent from the registry
                        //     `getPublished` consults, so this route answered 404
                        //     about an item that IS published.
                        //
                        // `getMetaItemLayered` is the narrow primitive on purpose.
                        // Its overlay layer is a strict `state:'active'` lookup
                        // that never reads a draft, and it reports that layer
                        // SEPARATELY from the code layer — so a null overlay is
                        // positively "no runtime-published row" and falls through
                        // to the untouched `getPublished` path below, which keeps a
                        // code-published item resolving to byte-identical bytes.
                        // The broader `getMetaItem` would not do: it folds the code
                        // layer into its own answer, so this route could no longer
                        // tell the two stores apart.
                        //
                        // NO `organizationId`, and that is the ONE deliberate
                        // divergence from the dispatcher twin, which resolves one
                        // and passes it. `packages/rest` carries no
                        // `resolveActiveOrganizationId` and no org plumbing at all
                        // — the same seam `package-routes.ts` names at its
                        // `deletePackage` call ("the dispatcher twin owns that
                        // seam"). Inventing org plumbing here to close a 404 would
                        // be a new seam smuggled in under a bug fix. Omitting it
                        // reads the env-wide (`organization_id: null`) row, which
                        // is symmetric with what an org-less `publishPackageDrafts`
                        // (`request.organizationId ?? null`) writes — so this door
                        // resolves exactly the publishes this door can produce.
                        // Environment scoping still holds: it comes from WHICH
                        // protocol `resolveProtocol` hands back, not from the
                        // request payload (`getMetaItemLayered` declares no
                        // `environmentId` member).
                        let publishedProtocol: any;
                        try {
                            publishedProtocol = await this.resolveProtocol(environmentId, req);
                        } catch { /* fall through to the code/package snapshot below */ }
                        if (typeof publishedProtocol?.getMetaItemLayered === 'function') {
                            try {
                                const layered = await publishedProtocol.getMetaItemLayered({ type, name });
                                if (layered?.overlay !== undefined && layered?.overlay !== null) {
                                    res.json(layered.overlay);
                                    return;
                                }
                            } catch (overlayError: any) {
                                // [#5532] The overlay read is NOT blanket-swallowed,
                                // and this is the second deliberate divergence from
                                // the dispatcher twin. `getMetaItemLayered` documents
                                // that it throws `503 SERVICE_UNAVAILABLE` ONLY when a
                                // read that would decide a layer did not happen; the
                                // benign "table not provisioned yet" case genuinely
                                // means "no overlay row" and returns normally with
                                // `overlay: null`. So a throw here is an availability
                                // failure, and falling through would let it reach the
                                // client as `404 Not found` — an availability failure
                                // reported as an existence fact, which is exactly the
                                // #5532 defect this package pins in
                                // `rest-meta-outage-vs-miss.test.ts`. A declared
                                // status is re-thrown so `handleRouteError` renders
                                // the producer's own 503; anything undeclared (a
                                // third-party protocol throwing something shapeless)
                                // still falls through, so this cannot make the
                                // code-published path newly fail closed.
                                if (typeof overlayError?.status === 'number') throw overlayError;
                            }
                        }

                        const svc = await this.resolveMetadataService(environmentId, req);
                        if (typeof (svc as any)?.getPublished !== 'function') {
                            res.status(501).json({
                                error: {
                                    code: 'NOT_IMPLEMENTED',
                                    message: 'metadata.getPublished() is not available in this kernel',
                                },
                            });
                            return;
                        }
                        const data = await (svc as any).getPublished(type, name);
                        // The 404 this route could never produce before. An
                        // item that exists but was never published still
                        // answers 200 with its current definition — that is
                        // `getPublished`'s documented fallback, and it is a
                        // different fact from "no such item".
                        if (data === undefined) {
                            res.status(404).json({
                                error: { code: 'NOT_FOUND', message: 'Not found' },
                            });
                            return;
                        }
                        res.json(data);
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get the published version of a metadata item',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type/:section/:name - Get specific item with compound name
        // Compound names express sub-resources of a type (e.g. a view of an
        // object, a flow under an automation). The protocol layer treats
        // `<section>/<name>` as a single opaque key.
        if (metadata.endpoints.item !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:section/:name`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const compoundName = `${req.params.section}/${req.params.name}`;
                        // [#6877] Same single owning package as the single-segment
                        // read this route mirrors.
                        if (refuseRepeatedQueryParams(req, res, ['package'])) return;
                        const packageId = req.query?.package || undefined;
                        const envelope = await p.getMetaItem({
                            type: req.params.type,
                            name: compoundName,
                            packageId,
                        } as any) as Record<string, any>;
                        // [ADR-0106 D5(4)] Compound names express sub-resources,
                        // and no object uses one today — but this route serves
                        // EVERY type through one generic `getMetaItem`, so the
                        // question it answers for `object` is the same question
                        // the single-item route answers. Running the projection
                        // here costs one predicate on a path that will never
                        // reach it, and leaves no exit whose coverage depends on
                        // a naming convention holding.
                        let compoundDocument: any = envelope?.item;
                        const compoundType = RestServer.metaTypeSingular(req.params.type);
                        let compoundPosture: ObjectSchemaMaskPosture;
                        try {
                            compoundPosture = await (await this.resolveObjectMasker(environmentId, req, compoundType))(compoundName);
                        } catch (maskError: any) {
                            if (maskError instanceof ObjectSchemaMaskEvaluationError) {
                                sendFieldVisibilityFault(res, compoundName);
                                return;
                            }
                            throw maskError;
                        }
                        if (compoundPosture.kind === 'project') {
                            const masked = this.maskObjectDocument(res, compoundPosture, compoundName, compoundDocument);
                            if (!masked) return;
                            compoundDocument = masked.document;
                        } else if (compoundPosture.kind === 'undetermined') {
                            res.header('Cache-Control', 'private, no-store');
                        }
                        res.header('Vary', 'Accept-Language');
                        res.json(await this.translateMetaEnvelope(
                            req, req.params.type, environmentId, envelope, compoundDocument,
                        ));
                    } catch (error: any) {
                        handleRouteError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get specific metadata item by compound name',
                    tags: ['metadata'],
                },
            });
        }

        // PUT /meta/:type/:section/:name - Save metadata item with compound name
        this.routeManager.register({
            method: 'PUT',
            path: `${metaPath}/:type/:section/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    // [#7019] The compound-name twin of the gate #6603 put on
                    // `PUT /meta/:type/:name` — WORD FOR WORD the same
                    // mechanism, because it is word for word the same
                    // operation: one generic `saveMetaItem`, reached by a name
                    // spelled in two segments instead of one.
                    //
                    // Gating only the single-segment door left this one as a
                    // bypass of it, and that was measured rather than reasoned:
                    // with #6603's gate in place, the identical ADR-0106
                    // GET → edit a label → PUT still round-tripped a MASKED
                    // object schema back into the store through here, deleting
                    // the fields the caller was never allowed to see. Same
                    // caller, same object, same loss, one route over.
                    //
                    // Independently of masking, this door also served the older
                    // hole for EVERY metadata type: any authenticated session
                    // could clobber any metadata item.
                    //
                    // Gate FIRST — before the protocol is resolved — so an
                    // unauthorized caller cannot use the 501-vs-200 answer to
                    // probe which kernels implement saving, and so nothing is
                    // written before the refusal. `isSystem` bypasses, matching
                    // every other capability gate on the platform.
                    const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                    const held = new Set<string>(
                        Array.isArray(ctx?.systemPermissions) ? ctx!.systemPermissions : [],
                    );
                    if (!ctx?.isSystem && !held.has('manage_metadata')) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: 'Saving a metadata item requires the `manage_metadata` capability.',
                            },
                        });
                        return;
                    }
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!p.saveMetaItem) {
                        // [#7035] ADR-0112 envelope. Converged together with the
                        // single-segment `PUT /meta/:type/:name` above, because
                        // the two refusals were BYTE-IDENTICAL (see the comment
                        // block on the gate: "WORD FOR WORD the same mechanism").
                        // Fixing one and leaving its literal twin would leave the
                        // wrong template in the file next to the right one, which
                        // is the harm #7035 is about — a copier copies whichever
                        // line they scrolled to.
                        res.status(501).json({
                            error: {
                                code: 'NOT_IMPLEMENTED',
                                message: 'Save operation not supported by protocol implementation',
                            },
                        });
                        return;
                    }

                    const compoundName = `${req.params.section}/${req.params.name}`;
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const parentVersion = typeof ifMatchHeader === 'string'
                        ? ifMatchHeader.replace(/^"|"$/g, '')
                        : undefined;
                    // [#7749] Header, else the request's authenticated identity — one
                    // producer, shared by every `/meta` write (see resolveMetaWriteActor).
                    const actor = await this.resolveMetaWriteActor(environmentId, req);

                    // [#6877] The `typeof` guard below dropped a repeated
                    // `?package=` to `undefined`, i.e. wrote the row as an
                    // env-local overlay instead of into the package the caller
                    // named — a silent change of where the save LANDS.
                    if (refuseRepeatedQueryParams(req, res, ['package'])) return;
                    const packageRaw = req.query?.package;
                    const packageId = typeof packageRaw === 'string' && packageRaw && packageRaw !== 'all'
                        ? packageRaw
                        : undefined;

                    const result = await p.saveMetaItem({
                        type: req.params.type,
                        name: compoundName,
                        item: req.body,
                        ...(environmentId ? { environmentId } : {}),
                        ...(parentVersion !== undefined ? { parentVersion } : {}),
                        ...(actor ? { actor } : {}),
                        ...(packageId ? { packageId } : {}),
                    } as any);
                    res.json(result);
                } catch (error: any) {
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Save specific metadata item by compound name',
                tags: ['metadata'],
            },
        });
    }

    /**
     * Register UI endpoints
     */
    private registerUiEndpoints(basePath: string): void {
        const uiPath = `${basePath}/ui`;
        const isScoped = basePath.includes('/environments/:environmentId');

        // GET /ui/view/:object/:type - Resolve view for object
        this.routeManager.register({
            method: 'GET',
            path: `${uiPath}/view/:object/:type`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    if (p.getUiView) {
                        const view = await p.getUiView({
                            object: req.params.object,
                            type: req.params.type as any,
                            ...(environmentId ? { environmentId } : {}),
                        } as any);
                        res.json(view);
                    } else {
                        res.status(501).json({ error: 'UI View resolution not supported by protocol implementation', code: 'NOT_IMPLEMENTED' });
                    }
                } catch (error: any) {
                    handleRouteError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Resolve UI View for object',
                tags: ['ui'],
            },
        });
    }
    
    /**
     * Register CRUD endpoints for data operations
     */
    private registerCrudEndpoints(basePath: string): void {
        const { crud } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/environments/:environmentId');

        const operations = crud.operations;

        // GET /data/:object - List/query records
        if (operations.list) {
            this.routeManager.register({
                method: 'GET',
                path: `${dataPath}/:object`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'list')) return;
                        // [#6877] Still NOT arity-gated as a whole, for the
                        // reason it never was: this route hands the WHOLE query
                        // record to `findData`, whose normalizer
                        // (`metadata-protocol`) owns every parameter's arity — the
                        // `$`-alias table, the implicit field-equality bucket, and
                        // the `$select`/`$expand`/`$searchFields` params that are
                        // legitimately multi-valued. Declaring an arity list here
                        // would be this file guessing at another package's
                        // contract.
                        //
                        // [#7390] ONE slot is the exception, and structurally so
                        // rather than by taste. A filter AST *is* an array
                        // (`['status','=','open']`), so #7386's arity gate cannot
                        // read `Array.isArray` as evidence of repetition on the
                        // filter slot: the normalizer serves this querystring and
                        // `POST /data/:object/query`'s arbitrary-JSON body through
                        // one door and cannot tell them apart. THIS layer can — on
                        // a querystring an array is a repeated parameter and can be
                        // nothing else — so the filter slot's arity is judged here,
                        // and only here, leaving the normalizer free of a heuristic.
                        //
                        // Refused, never resolved (maintainer ruling 2026-08-11 on
                        // #7390): last-wins and AND-merge are each a silent choice
                        // between two intents a caller actually expressed. Before
                        // this line the common shape was answered with the WRONG
                        // diagnosis — `malformedFilterArrayError`, telling a caller
                        // whose filters were both well-formed to check their AST
                        // syntax — and the rarer `?filter=status&filter=%3D&filter=open`
                        // spelled a valid AST and returned 200 with a filter nobody
                        // expressed. It throws rather than responding so both keep
                        // the envelope this route's other filter refusals already
                        // use; see the helper for why.
                        assertFilterParamSuppliedOnce(req.query);
                        const result = await p.findData({
                            object: req.params.object,
                            query: req.query,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Query records',
                    tags: ['data', 'crud'],
                },
            });
        }

        // GET /data/:object/:id - Get single record
        if (operations.read) {
            this.routeManager.register({
                method: 'GET',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        // [#6877] NOT gated, and this is a measured verdict
                        // rather than a name-based one: `GetDataRequest.select` /
                        // `.expand` are declared `z.array(z.string())`, and the
                        // consumer signature is
                        // `getData({ …, expand?: string | string[], select?: string | string[] })`
                        // — it splits the comma form itself and passes an array
                        // straight through. `?select=a&select=b` is therefore
                        // ALREADY correct end to end, and refusing it (or
                        // flattening it) would be the regression. The card listed
                        // this line under "array flows downstream"; measurement
                        // says the downstream was built for it.
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'get')) return;
                        // [#7606] Closed parameter set, AFTER the capability
                        // gates for the same reason #7527 put it there: which
                        // parameters a route understands is information, and a
                        // caller who may not read this object should not learn
                        // the shape of its ingress before being refused.
                        //
                        // This gate RESPONDS rather than throwing, which on this
                        // route is load-bearing and not a style choice: the catch
                        // below rewrites every 400 into a 404 (a bad id is a
                        // miss, not a malformed request). A refusal routed
                        // through it would reach the caller as "no such record"
                        // — the silent-drop defect wearing a different status.
                        if (refuseUnknownQueryParams(req, res, DATA_RECORD_READ_PARAMS)) return;
                        const { select, expand } = req.query || {};
                        const result = await p.getData({
                            object: req.params.object,
                            id: req.params.id,
                            ...(select != null ? { select } : {}),
                            ...(expand != null ? { expand } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status === 400 ? 404 : mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Get record by ID',
                    tags: ['data', 'crud'],
                },
            });
        }

        // POST /data/:object - Create record
        if (operations.create) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'create')) return;
                        // [#3899] The wire body IS the record. Validate the
                        // assembled protocol request (`CreateDataRequestSchema`,
                        // catalog `requestSchema`) so a non-record body — an
                        // array, a string, a number — answers 400 instead of
                        // reaching the engine as `data`. Per-field checks stay
                        // downstream (object metadata / validation rules); this
                        // gate is about the SHAPE the contract declares.
                        const { CreateDataRequestSchema } = await import('@objectstack/spec/api');
                        const createInput = { object: req.params.object, data: req.body ?? {} };
                        const parsedCreate = (CreateDataRequestSchema as any).safeParse(createInput);
                        if (!parsedCreate.success) {
                            res.status(400).json({
                                error: 'Invalid create request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedCreate.error?.issues, createInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        const result = await p.createData({
                            object: req.params.object,
                            data: req.body ?? {},
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        // [#3431] Advertise fields the #3043 create ingress strip
                        // dropped via the response header (body also carries
                        // `droppedFields`). Status stays 201.
                        applyDroppedFieldsHeader(res, result);
                        res.status(201).json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Create record',
                    tags: ['data', 'crud'],
                },
            });
        }

        // POST /data/:object/query — Spec-shape advanced query (QueryAST in body).
        // Supports server-side aggregation via { groupBy, aggregations, where, ... }
        // per spec/data/query.zod.ts. Mirrors what `client.data.query()` posts.
        // Returns FindDataResponse = { object, records, total? }.
        if (operations.list) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/query`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'list')) return;
                        // [#3899] Validate the QueryAST body against the declared
                        // contract (`FindDataRequestSchema`, catalog `requestSchema`).
                        // A malformed body used to be forwarded as-is — and since a
                        // dropped/mistyped clause does not narrow a query, it WIDENS
                        // it, `{"filter": …}` degraded into an unfiltered full read
                        // with a 200. The PATH object is written last (#3946) so a
                        // body `object` can neither dodge the `enforceApiAccess`
                        // gate above nor move the read. Validation only: the merged
                        // ORIGINAL body is forwarded, not the parse output, so the
                        // schema cannot inject defaults the engine did not receive
                        // before (the analytics-entry precedent, #3878).
                        const { FindDataRequestSchema } = await import('@objectstack/spec/api');
                        const rawQuery = req.body ?? {};
                        const query = (rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery))
                            ? { ...rawQuery, object: req.params.object }
                            : rawQuery; // non-object bodies go to the schema as-is and fail with `query: invalid_type`
                        const findInput = { object: req.params.object, query };
                        const parsedFind = (FindDataRequestSchema as any).safeParse(findInput);
                        if (!parsedFind.success) {
                            res.status(400).json({
                                error: 'Invalid query request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedFind.error?.issues, findInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        const result = await p.findData({
                            object: req.params.object,
                            query,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Advanced query (QueryAST in body)',
                    tags: ['data', 'crud'],
                },
            });
        }

        // PATCH /data/:object/:id - Update record
        if (operations.update) {
            this.routeManager.register({
                method: 'PATCH',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // OCC: clients opt in by sending either the standard
                        // `If-Match` header or an `expectedVersion` field in
                        // the JSON body. Body wins when both are present
                        // (lets callers override per-request without
                        // touching headers). See ConcurrentUpdateError in
                        // packages/objectql/src/protocol.ts.
                        const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                        const bodyVersion = (req.body && typeof req.body === 'object')
                            ? (req.body as any).expectedVersion
                            : undefined;
                        const expectedVersion = bodyVersion ?? ifMatchHeader;
                        // Strip the meta field out of the data payload so it
                        // doesn't get written as a column.
                        let data = req.body;
                        if (data && typeof data === 'object' && 'expectedVersion' in (data as any)) {
                            const { expectedVersion: _drop, ...rest } = data as any;
                            data = rest;
                        }
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'update')) return;
                        // [#3899] Same gate as create: the wire body is the bare
                        // field patch (`expectedVersion` already stripped above),
                        // validated as the assembled `UpdateDataRequestSchema`
                        // request so a non-record body 400s instead of reaching
                        // the engine.
                        const { UpdateDataRequestSchema } = await import('@objectstack/spec/api');
                        const updateInput = {
                            object: req.params.object,
                            id: req.params.id,
                            data: data ?? {},
                            ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
                        };
                        const parsedUpdateOne = (UpdateDataRequestSchema as any).safeParse(updateInput);
                        if (!parsedUpdateOne.success) {
                            res.status(400).json({
                                error: 'Invalid update request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedUpdateOne.error?.issues, updateInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        const result = await p.updateData({
                            object: req.params.object,
                            id: req.params.id,
                            data: data ?? {},
                            ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        // [#3431] Advertise any LEGALLY-stripped write fields via
                        // the response header before serialising (the body also
                        // carries `droppedFields`). Status stays 200.
                        applyDroppedFieldsHeader(res, result);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Update record',
                    tags: ['data', 'crud'],
                },
            });
        }

        // DELETE /data/:object/:id - Delete record
        if (operations.delete) {
            this.routeManager.register({
                method: 'DELETE',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // OCC: same opt-in protocol as PATCH (`If-Match`
                        // header or `expectedVersion` query string). DELETE
                        // has no JSON body, so we only accept the header
                        // and a query parameter.
                        // [#6877] `String(['1','2'])` is `'1,2'` — an OCC token
                        // no row carries, so a repeated `?expectedVersion=` turned
                        // an optimistic-concurrency check into a guaranteed
                        // conflict on a DESTRUCTIVE verb.
                        if (refuseRepeatedQueryParams(req, res, ['expectedVersion'])) return;
                        const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                        const queryVersion = (req.query && typeof req.query === 'object')
                            ? (req.query as any).expectedVersion
                            : undefined;
                        const expectedVersion = queryVersion ?? ifMatchHeader;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'delete')) return;
                        const result = await p.deleteData({
                            object: req.params.object,
                            id: req.params.id,
                            ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        logUnexpectedRouteError(error, mapped);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Delete record',
                    tags: ['data', 'crud'],
                },
            });
        }
    }
    
    /**
     * Register object-specific action endpoints that don't fit the
     * generic CRUD shape — domain operations where the protocol does its
     * own orchestration and we just need a thin HTTP route.
     *
     * POST {basePath}/data/:object/:id/clone — record clone (gated by
     * `enable.clone`). This is object-agnostic by design: it works for any
     * authored object regardless of namespace, unlike a hardcoded
     * per-object route would.
     */
    private registerDataActionEndpoints(basePath: string): void {
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
            const r = await p.findData({
                object: IMPORT_JOB_OBJECT,
                query: { $filter: { id: jobId }, $top: 1 },
                ...(environmentId ? { environmentId } : {}),
                ...(context ? { context } : {}),
            });
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
                        await (p as any).createData({ object: IMPORT_JOB_OBJECT, data: jobRow, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) });
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
                            await (p as any).updateData({ object: IMPORT_JOB_OBJECT, id: jobId, data, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) }); // [ADR-0103] engine-owned
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
                            await (p as any).updateData({ object: IMPORT_JOB_OBJECT, id: jobId, data: { status: 'cancelled', completed_at: new Date().toISOString() }, context: { ...(context as any), isSystem: true }, ...(environmentId ? { environmentId } : {}) }); // [ADR-0103] engine-owned
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
                            await (p as any).deleteData({ object: objectName, id, context: writeCtx, ...(environmentId ? { environmentId } : {}) });
                            deleted++;
                        } catch { failed++; }
                    }
                    // Restore the touched fields on updated records.
                    for (const u of log.updated) {
                        try {
                            await (p as any).updateData({ object: objectName, id: u.id, data: u.before, context: writeCtx, ...(environmentId ? { environmentId } : {}) });
                            restored++;
                        } catch { failed++; }
                    }

                    await (p as any).updateData({
                        object: IMPORT_JOB_OBJECT, id: jobId,
                        data: { reverted_at: new Date().toISOString() },
                        context: { ...(context as any), isSystem: true }, // [ADR-0103] engine-owned
                        ...(environmentId ? { environmentId } : {}),
                    });
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
                    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
                    const offset = Math.max(0, Number(q.offset) || 0);
                    const r = await (p as any).findData({
                        object: IMPORT_JOB_OBJECT,
                        query: { $filter: filter, $orderby: { created_at: 'desc' }, $top: limit, $skip: offset },
                        ...(environmentId ? { environmentId } : {}),
                        ...(context ? { context } : {}),
                    });
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
        // `fields=`), so an empty export doubles as an import template. Without a
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
                    if (await this.enforceApiAccess(req, res, p, environmentId, 'export')) return;
                    // [#3544] …then the USER-level one. The object may expose
                    // export while THIS caller's permission sets deny it.
                    if (await this.enforceExportPermission(req, res, environmentId, objectName, context)) return;
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
                        ['format', 'header', 'limit', 'page', 'filter', 'search', 'orderby'])) return;
                    const q = req.query ?? {};
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
                    const requestedLimit = q.limit != null ? Math.max(1, Number(q.limit) || 0) : 10_000;
                    const limit = Math.min(requestedLimit, HARD_CAP);
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
                        const findArgs: any = {
                            object: objectName,
                            query: {
                                ...(filter ? { $filter: filter } : {}),
                                ...(search ? { $search: search } : {}),
                                ...(search && searchFields ? { $searchFields: searchFields } : {}),
                                ...(orderby ? { $orderby: orderby } : {}),
                                ...(expandFields.length > 0 ? { $expand: expandFields.join(',') } : {}),
                                $top: take,
                                $skip: skip,
                            },
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result: any = await (p as any).findData(findArgs);
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

    /**
     * [#3547] Resolve the environment's `security` service — the ENVIRONMENT's
     * kernel service first (its evaluator / FieldMasker are bound to that
     * kernel's data engine), the host provider as the single-kernel fallback.
     * Mirrors the resolver in registerSecurityExplainEndpoints. Returns
     * `undefined` when no security service is reachable (no plugin-security /
     * single-kernel without a provider), so callers degrade gracefully.
     *
     * Typed as a PARTIAL {@link ISecurityService}: an implementation may omit a
     * method it cannot honour, so every call site must keep feature-detecting
     * (`typeof svc.x === 'function'`) rather than assume the full surface.
     */
    private async resolveSecurityService(
        environmentId?: string,
        req?: any,
    ): Promise<Partial<ISecurityService> | undefined> {
        try {
            const envId = await this.resolveRequestEnvironmentId(environmentId, req);
            if (envId && envId !== 'platform' && this.kernelManager) {
                const kernel = await this.kernelManager.getOrCreate(envId);
                const svc = await kernel.getServiceAsync<any>('security').catch(() => undefined);
                if (svc) return svc;
            }
        } catch { /* fall back to the host provider */ }
        if (!this.securityServiceProvider) return undefined;
        try { return await this.securityServiceProvider(environmentId); }
        catch { return undefined; }
    }

    /**
     * Register global cross-object search endpoint (M10.5).
     * GET {basePath}/search?q=acme&objects=lead,account&limit=20&perObject=5
     */
    private registerSearchEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/environments/:environmentId');
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/search`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const p = await this.resolveProtocol(environmentId, req);
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const searchAll = (p as any).searchAll;
                    if (typeof searchAll !== 'function') {
                        res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Search not supported by this protocol' });
                        return;
                    }
                    // [#6877] `String(['a','b'])` searched for the literal
                    // term `'a,b'`. `objects` is NOT listed: the next line reads
                    // its array arm deliberately — a cross-object search over a
                    // LIST of objects is the whole point of the parameter.
                    // [#7606] Recognition before arity, same order and same
                    // envelope as the export route — see `query-allowlist.ts`.
                    // A dropped `?objects=` is the widening case at its worst:
                    // the term fans out across every searchable object while the
                    // caller believes they scoped it to one.
                    if (refuseUnknownQueryParams(req, res, GLOBAL_SEARCH_PARAMS)) return;
                    if (refuseRepeatedQueryParams(req, res, ['q', 'query', 'limit', 'perObject'])) return;
                    const q = String(req.query?.q ?? req.query?.query ?? '');
                    const objectsParam = req.query?.objects;
                    const objects = typeof objectsParam === 'string'
                        ? objectsParam.split(',').map((s: string) => s.trim()).filter(Boolean)
                        : Array.isArray(objectsParam) ? objectsParam : undefined;
                    const result = await searchAll.call(p, {
                        q,
                        objects,
                        limit: req.query?.limit ? Number(req.query.limit) : undefined,
                        perObject: req.query?.perObject ? Number(req.query.perObject) : undefined,
                        ...(context ? { context } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error);
                    logUnexpectedRouteError(error, mapped);
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Global cross-object search',
                tags: ['search'],
            },
        });
    }

    /**
     * Register email endpoints (M11.B1 / M10.7).
     *
     * POST {basePath}/email/send — send a transactional email via the
     * `IEmailService` provider registered by EmailServicePlugin. Returns
     * 501 when no provider is wired so deployments without email
     * configured fail cleanly.
     *
     * Request body:
     *   {
     *     to: "a@b.com" | ["a@b.com", { name, address }],
     *     from?: ..., cc?: ..., bcc?: ..., replyTo?: ...,
     *     subject: string,
     *     text?: string, html?: string,  // at least one required
     *     attachments?: [{ filename, content, contentType?, cid? }],
     *     headers?: { [name]: value },
     *     relatedObject?: string, relatedId?: string,
     *   }
     */
    private registerEmailEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/environments/:environmentId');
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/email/send`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;

                    if (!this.emailServiceProvider) {
                        res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Email service is not configured on this deployment',
                        });
                        return;
                    }
                    const emailService = await this.emailServiceProvider(environmentId).catch(() => undefined);
                    if (!emailService || typeof emailService.send !== 'function') {
                        res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Email service is not configured on this deployment',
                        });
                        return;
                    }

                    const body = req.body ?? {};
                    if (!body || typeof body !== 'object') {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'JSON body required' });
                        return;
                    }
                    // Stamp sentBy from the authenticated context when caller didn't supply one.
                    const input = {
                        ...body,
                        ...(body.sentBy === undefined && (context as any)?.userId
                            ? { sentBy: (context as any).userId }
                            : {}),
                    };

                    try {
                        const result = await emailService.send(input);
                        if (result?.status === 'sent') {
                            res.status(200).json(result);
                        } else {
                            // failed / queued — still surface to client with 200 so clients can branch on status.
                            res.status(200).json(result);
                        }
                    } catch (err: any) {
                        // Validation errors from normalizeMessage are surfaced as 400.
                        const message = String(err?.message ?? err ?? 'send failed');
                        if (message.startsWith('VALIDATION_FAILED')) {
                            res.status(400).json({
                                code: 'VALIDATION_FAILED',
                                error: message.replace(/^VALIDATION_FAILED:\s*/, ''),
                            });
                            return;
                        }
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Email send unhandled error:', error);
                    res.status(500).json({
                        code: 'EMAIL_SEND_FAILED',
                        error: String(error?.message ?? error ?? 'send failed').slice(0, 500),
                    });
                }
            },
            metadata: {
                summary: 'Send a transactional email via the configured EmailService',
                tags: ['email'],
            },
        });
    }

    /**
     * Register public (anonymous) form endpoints.
     *
     * Public forms are opt-in: a `FormView` becomes accessible to anonymous
     * visitors only when `sharing.allowAnonymous === true` AND a
     * `sharing.publicLink` slug is configured. Two routes are registered:
     *
     *   GET  {basePath}/forms/:slug          → resolved form spec
     *   POST {basePath}/forms/:slug/submit   → INSERT record (no auth required)
     *
     * Both routes bypass `enforceAuth` even though anonymous-deny is on for the
     * deployment (e.g. ObjectOS multi-tenant). Security is delegated to the
     * `guest_portal` permission set carried on the execution context — the
     * SecurityPlugin enforces INSERT-only access to the target object. If
     * the deployment hasn't registered a `guest_portal` profile, the
     * security middleware falls open with `permissions: []` (no userId),
     * matching the existing anonymous-access semantics; deployers must
     * keep secure-by-default deployments paired with a `guest_portal`
     * profile (the CRM example does this) to enforce the INSERT-only
     * contract.
     *
     * The matched FormView's parent ViewSchema is found by scanning
     * `protocol.getMetaItems({ type: 'view' })`. For each entry we inspect
     * `form.sharing` and every entry in `formViews`; the first FormView
     * whose `sharing.publicLink` matches `/forms/:slug` (or just `:slug`)
     * wins. The response carries the matched form view under `form` and
     * the inferred target object, matching what the frontend's
     * `mapViewSpecToEmbeddableConfig` expects.
     */
    private registerFormEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/environments/:environmentId');

        const slugMatchesPublicLink = (publicLink: string | undefined, slug: string): boolean => {
            if (!publicLink || typeof publicLink !== 'string') return false;
            // Accept `/forms/:slug`, `forms/:slug`, or a bare slug.
            const normalized = publicLink.replace(/^\/+/, '').replace(/^forms\//, '');
            return normalized === slug;
        };

        const findPublicFormView = (views: any[], slug: string): { view: any; form: any; object: string } | null => {
            for (const view of views ?? []) {
                if (!view || typeof view !== 'object') continue;
                const candidates: Array<{ form: any; key?: string }> = [];
                // Authoring/nested shape (defineView): { form, formViews: { key: {...} } }.
                if (view.form && view.form.sharing) candidates.push({ form: view.form });
                const formViews = view.formViews;
                if (formViews && typeof formViews === 'object') {
                    for (const [key, fv] of Object.entries(formViews)) {
                        if (fv && typeof fv === 'object' && (fv as any).sharing) {
                            candidates.push({ form: fv as any, key });
                        }
                    }
                }
                // Flattened registered shape (getMetaItems → one item per view:
                // { name, object, viewKind:'form', config:{ data, sections, sharing } }).
                // A form view carries its sharing under `config`; without this branch
                // public-form resolution silently fails for the standard view metadata.
                if (view.viewKind === 'form' && view.config && typeof view.config === 'object'
                    && (view.config as any).sharing) {
                    candidates.push({ form: view.config, key: view.name });
                }
                for (const c of candidates) {
                    const sharing = c.form?.sharing;
                    if (!sharing || sharing.allowAnonymous !== true) continue;
                    if (!slugMatchesPublicLink(sharing.publicLink, slug)) continue;
                    const objectName =
                        c.form?.data?.object ??
                        view?.list?.data?.object ??
                        view?.form?.data?.object ??
                        view?.object;
                    if (!objectName) continue;
                    return { view, form: c.form, object: objectName };
                }
            }
            return null;
        };

        const resolveFormBySlug = async (
            environmentId: string | undefined,
            req: any,
            slug: string,
        ): Promise<{ view: any; form: any; object: string } | null> => {
            const p = await this.resolveProtocol(environmentId, req);
            if (typeof (p as any).getMetaItems !== 'function') return null;
            const result: any = await (p as any).getMetaItems({
                type: 'view',
                ...(environmentId ? { environmentId } : {}),
            });
            const items: any[] = Array.isArray(result?.items)
                ? result.items
                : Array.isArray(result)
                    ? result
                    : [];
            return findPublicFormView(items, slug);
        };

        // GET /forms/:slug — resolve and return the public form spec
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/forms/:slug`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const slug = String(req.params?.slug ?? '').trim();
                    if (!slug) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'slug is required' });
                        return;
                    }
                    const match = await resolveFormBySlug(environmentId, req, slug);
                    if (!match) {
                        res.status(404).json({
                            code: 'FORM_NOT_FOUND',
                            error: `No public form configured at /forms/${slug}`,
                        });
                        return;
                    }
                    // Embed the target object's schema — limited to exactly the
                    // fields the form's sections DECLARE — so anonymous
                    // front-ends can render the form without a separate,
                    // auth-protected meta lookup.
                    //
                    // [#6601] "Exactly" is load-bearing and used not to be. The
                    // narrowing read `allowed.size === 0 || allowed.has(name)`,
                    // so a form with no sections (or sections declaring no
                    // fields) fell through to EVERY non-server-managed field of
                    // the object — published to an ANONYMOUS caller, with
                    // labels, types, picklist option values and formula
                    // expressions. A form created before its sections are wired
                    // is an ordinary authoring mid-state, so that was reachable
                    // without an exotic configuration, and this comment claimed
                    // the opposite. Publication is a DECLARATION now: declare no
                    // fields and nothing is published (AGENTS.md "Explicit
                    // composition over default magic").
                    //
                    // Do NOT reach for the submit handler as the backstop here.
                    // It enforces a field whitelist on WRITES, which cannot
                    // bound a READ disclosure — and when #6601 landed, its own
                    // accepted set still degenerated identically for a
                    // section-less form (`allowedFields.size === 0 ||`), so
                    // narrowing this schema to "what submit would accept" would
                    // have republished precisely the set being removed. #6920
                    // has since closed that write-side twin, so the two planes
                    // now agree — but they agree by each enforcing the
                    // declaration itself, NOT by one deferring to the other.
                    let objectSchema: any = null;
                    try {
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).getMetaItems === 'function') {
                            const r: any = await (p as any).getMetaItems({
                                type: 'object',
                                ...(environmentId ? { environmentId } : {}),
                            });
                            const items: any[] = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
                            const obj = items.find((o: any) => o?.name === match.object);
                            if (obj && obj.fields && typeof obj.fields === 'object') {
                                const allowed = new Set<string>();
                                for (const sec of match.form?.sections ?? []) {
                                    for (const f of sec?.fields ?? []) {
                                        if (typeof f === 'string') allowed.add(f);
                                        else if (f?.field) allowed.add(f.field);
                                    }
                                }
                                const fields: Record<string, any> = {};
                                for (const [name, def] of Object.entries(obj.fields)) {
                                    // [#3022] Server-managed anchors are never
                                    // renderable/writable on the anonymous form
                                    // surface — the submit route refuses them, so
                                    // don't advertise them here even when a form
                                    // (mis)declares one in a section.
                                    if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)) continue;
                                    // [#6601] Declared or not published. An empty
                                    // `allowed` yields an empty `fields`.
                                    if (!allowed.has(name)) continue;
                                    fields[name] = def;
                                }
                                objectSchema = { name: obj.name, label: obj.label, fields };
                                // Localize labels / help text / option labels so anonymous
                                // clients render in the visitor's preferred language. The
                                // form payload is otherwise un-translated (resolveFormBySlug
                                // returns the raw view spec), so we hydrate the schema here.
                                try {
                                    const i18n = await this.resolveI18nService(environmentId, req);
                                    const bundle = this.buildTranslationBundle(i18n);
                                    const locale = this.extractLocale(req, i18n);
                                    if (bundle && locale) {
                                        const { translateMetadataDocument } = await import('@objectstack/spec/system');
                                        // [#8284] Same rule as the two `/meta/object`
                                        // reads: the catalog yields to a scalar the
                                        // package's own extension or the tenant
                                        // authored. The public form must not be the
                                        // one surface still serving the packaged
                                        // string back at a tenant who renamed it.
                                        objectSchema = translateMetadataDocument('object', objectSchema, bundle, {
                                            locale,
                                            packagedBase: this.packagedObjectBase(p, 'object', objectSchema?.name),
                                        });
                                    }
                                } catch (e: any) {
                                    logError('[REST] Public form schema translation failed:', e);
                                }
                            }
                        }
                    } catch (e: any) {
                        logError('[REST] Public form schema load failed:', e);
                    }
                    // Anonymous public forms must NEVER include a lookup or
                    // master-detail field unless the form designer has
                    // explicitly opted-in via `publicPicker` on that field's
                    // section entry (mirroring Airtable's "Allow linking to
                    // existing records" toggle). Strip non-conforming
                    // lookups defensively here so a stray spec mistake can
                    // never expose unrestricted record search to the
                    // internet — the related `/forms/:slug/lookup/:field`
                    // endpoint also re-validates `publicPicker` server-side.
                    const safeForm = (() => {
                        if (!match.form || !Array.isArray(match.form.sections)) return match.form;
                        const allow = (name: string, cfg: any): boolean => {
                            // [#3022] A declared server-managed anchor (e.g. a
                            // FormView listing `owner_id`) is a spec mistake —
                            // drop it from the rendered sections so the form
                            // never collects a value the submit route refuses.
                            if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)) return false;
                            const def = objectSchema?.fields?.[name];
                            const t = def?.type;
                            // `user` is a lookup specialized to sys_user — same risk as a
                            // raw lookup: surfacing it on an anonymous public form would
                            // expose unrestricted user search to the internet. Gate it
                            // behind the same `publicPicker` opt-in.
                            if (t !== 'lookup' && t !== 'master_detail' && t !== 'user') return true;
                            return !!cfg?.publicPicker;
                        };
                        const sections = match.form.sections.map((sec: any) => {
                            const fields = (sec?.fields ?? []).filter((f: any) => {
                                const name = typeof f === 'string' ? f : f?.field;
                                if (!name) return false;
                                const cfg = typeof f === 'string' ? {} : f;
                                return allow(name, cfg);
                            });
                            return { ...sec, fields };
                        });
                        return { ...match.form, sections };
                    })();
                    res.header('Vary', 'Accept-Language');
                    res.json({
                        slug,
                        object: match.object,
                        label: match.view?.label ?? match.form?.label,
                        form: safeForm,
                        objectSchema,
                    });
                } catch (error: any) {
                    logError('[REST] Public form resolve error:', error);
                    res.status(500).json({
                        code: 'FORM_RESOLVE_FAILED',
                        error: String(error?.message ?? error ?? 'resolve failed').slice(0, 500),
                    });
                }
            },
            metadata: {
                summary: 'Resolve a public form spec by slug (anonymous)',
                tags: ['forms', 'public'],
            },
        });

        // POST /forms/:slug/submit — INSERT a record on the target object
        // with the `guest_portal` permission set attached.
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/forms/:slug/submit`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const slug = String(req.params?.slug ?? '').trim();
                    if (!slug) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'slug is required' });
                        return;
                    }
                    const match = await resolveFormBySlug(environmentId, req, slug);
                    if (!match) {
                        res.status(404).json({
                            code: 'FORM_NOT_FOUND',
                            error: `No public form configured at /forms/${slug}`,
                        });
                        return;
                    }

                    // Only allow the fields declared on the matched FormView.
                    // This prevents a public visitor from stuffing privileged
                    // columns (owner_id, status, internal_notes, …) into the
                    // row. Object hooks (`beforeInsert`) are still responsible
                    // for stamping server-side defaults — see the CRM
                    // `lead.hook.ts` / `case.hook.ts` for the canonical pattern.
                    const allowedFields = new Set<string>();
                    for (const section of match.form?.sections ?? []) {
                        for (const f of section?.fields ?? []) {
                            if (typeof f === 'string') allowedFields.add(f);
                            else if (f?.field) allowedFields.add(f.field);
                        }
                    }
                    // [#6920] A form that declares NO fields collects nothing, so
                    // it has nothing to accept — refuse instead of inserting.
                    //
                    // The filter below used to read
                    // `allowedFields.size === 0 || allowedFields.has(k)`, and that
                    // fall-through was not "accept every field of the object": it
                    // accepted every KEY THE CALLER SENT, minus the anchors and the
                    // three prototype keys — measured as
                    // `["email","internal_margin","internal_tier","not_even_a_field",
                    // "status","subject"]` on a `sections: []` form, `not_even_a_field`
                    // not being a field of the object at all. On an ANONYMOUS surface
                    // that is unbounded mass assignment across the target object, and
                    // the form created-before-its-sections-are-wired mid-state reaches
                    // it without anything exotic.
                    //
                    // Symmetric with #6601 on the read side of the same pair: declare
                    // it or it is not published / not accepted, one rule on both planes
                    // (AGENTS.md "Explicit composition over default magic"). Post-#6601
                    // such a form publishes `fields: {}`, so no legitimate client can
                    // even learn what to send here.
                    //
                    // REFUSAL, not a silent discard: dropping the keys would leave the
                    // `201` intact while swallowing data the caller believes it wrote —
                    // exactly the silence AGENTS.md's warn-vs-error rule forbids. The
                    // author's fix is to wire the sections, so the message says that;
                    // the code is the standard ADR-0112 catalog's generic 400
                    // (`HttpStatusErrorCodeMap[400]`), not a minted synonym, and the
                    // message names no object, field or slug — this reply is readable
                    // by anyone on the internet.
                    //
                    // NOTE the #3022 pin ('zero declared sections: business fields fall
                    // through, anchors do NOT') asserted this fall-through as intended.
                    // Re-judged by maintainer ruling 5229989845 (2026-08-09): the
                    // anchor half is preserved and still pinned; the fall-through half
                    // was the wrong invariant.
                    if (allowedFields.size === 0) {
                        res.status(400).json({
                            code: 'VALIDATION_ERROR',
                            error: 'This form declares no fields, so it cannot accept a submission. '
                                + "Wire the fields it collects into the form's sections and publish it again.",
                        });
                        return;
                    }
                    // [#3022] System-managed anchors (owner_id, organization_id,
                    // audit columns, id, …) are NEVER client-suppliable on this
                    // anonymous surface, even when a FormView explicitly declares
                    // one in a section (the insert-forge of #3004, with no
                    // credentials at all). The SecurityPlugin's publicFormGrant
                    // branch strips the same set at the data layer, so this filter
                    // and the engine boundary cannot drift.
                    const rawBody = (req.body && typeof req.body === 'object') ? req.body : {};
                    const filteredData: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(rawBody)) {
                        if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(k)) continue;
                        // JSON.parse yields `__proto__` as an OWN key; assigning it
                        // here would REPLACE filteredData's prototype and smuggle
                        // inherited anchors past every own-property check downstream.
                        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
                        if (allowedFields.has(k)) filteredData[k] = v;
                    }

                    // ADR-0056 (Option A): authorization DERIVED from the declared
                    // form — a narrow create grant scoped to exactly this form's target
                    // object. The SecurityPlugin honors `publicFormGrant` (create + the
                    // immediate read-back, that object ONLY), so public forms work under
                    // secure-by-default (anonymous-deny) WITHOUT a deployment-configured
                    // `guest_portal`. `guest_portal` + `anonymous` are kept for back-compat
                    // with object hooks (guest detection via falsy `ctx.user?.id`).
                    const context: any = {
                        publicFormGrant: { object: match.object },
                        permissions: ['guest_portal'],
                        anonymous: true,
                    };

                    const p = await this.resolveProtocol(environmentId, req);
                    const result = await p.createData({
                        object: match.object,
                        data: filteredData,
                        ...(environmentId ? { environmentId } : {}),
                        context,
                    } as any);
                    res.status(201).json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error);
                    // Distinct message (this is not the "unhandled" channel),
                    // same shared verdict — see `isExpectedRouteError`.
                    if (!isExpectedRouteError(mapped.status, mapped.body)) {
                        logError('[REST] Public form submit error:', error);
                    }
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Submit an anonymous public form',
                tags: ['forms', 'public'],
            },
        });

        // GET /forms/:slug/lookup/:field — scoped picker for public-form
        // lookup widgets. Mirrors Airtable's per-form linked-record search:
        // the field MUST be declared in the form spec with an explicit
        // `publicPicker` block; otherwise the request is rejected with 403.
        // Records are projected to `publicPicker.displayFields`, capped at
        // `publicPicker.maxResults` (hard ceiling 50), and pre-filtered by
        // `publicPicker.filter`. Anonymous visitors can search but cannot
        // enumerate / paginate, so a leaked endpoint cannot exfiltrate the
        // table.
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/forms/:slug/lookup/:field`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const slug = String(req.params?.slug ?? '').trim();
                    const fieldName = String(req.params?.field ?? '').trim();
                    if (!slug || !fieldName) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'slug and field are required' });
                        return;
                    }
                    const match = await resolveFormBySlug(environmentId, req, slug);
                    if (!match) {
                        res.status(404).json({
                            code: 'FORM_NOT_FOUND',
                            error: `No public form configured at /forms/${slug}`,
                        });
                        return;
                    }

                    // Locate the field config and require an opt-in
                    // `publicPicker` block. Without it the lookup is
                    // considered private — return 403, not 404, so a
                    // misconfigured form is loud rather than silent.
                    // [#3022] Server-managed anchors are unwritable on this
                    // surface (the submit route strips them), so a picker on
                    // one (e.g. a declared `owner_id` + `publicPicker`, which
                    // would open anonymous sys_user search) is refused outright.
                    let fieldCfg: any = null;
                    if (!PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(fieldName)) {
                        for (const sec of match.form?.sections ?? []) {
                            for (const f of sec?.fields ?? []) {
                                const name = typeof f === 'string' ? f : f?.field;
                                if (name === fieldName) {
                                    fieldCfg = typeof f === 'string' ? {} : f;
                                    break;
                                }
                            }
                            if (fieldCfg) break;
                        }
                    }
                    const picker = fieldCfg?.publicPicker;
                    if (!picker) {
                        res.status(403).json({
                            code: 'LOOKUP_NOT_PUBLIC',
                            error: `Field "${fieldName}" is not enabled for public lookup on this form`,
                        });
                        return;
                    }

                    // Resolve the referenced object — prefer the explicit
                    // `publicPicker.object` override, fall back to the
                    // field def on the parent object.
                    const p = await this.resolveProtocol(environmentId, req);
                    let referenceTo: string | undefined = picker.object;
                    if (!referenceTo && typeof (p as any).getMetaItems === 'function') {
                        try {
                            const r: any = await (p as any).getMetaItems({
                                type: 'object',
                                ...(environmentId ? { environmentId } : {}),
                            });
                            const items: any[] = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
                            const obj = items.find((o: any) => o?.name === match.object);
                            const def = obj?.fields?.[fieldName];
                            // [#7486] `reference` FIRST — it is the canonical
                            // key on `FieldSchema`, and `data/field.zod.ts`
                            // folds `relatedTo` / `referenceTo` / `target` /
                            // `targetObject` / `lookupObject` all onto it at
                            // parse. Reading only the legacy spellings meant a
                            // well-formed object schema carried NONE of them,
                            // the chain resolved `undefined`, and the route
                            // answered 500 — making `publicPicker.object`
                            // de-facto required while the schema and docs
                            // present it as an optional override. The legacy
                            // spellings stay after it for stored pre-fold rows,
                            // which never went through the alias table.
                            referenceTo = def?.reference
                                ?? def?.referenceTo
                                ?? def?.target
                                ?? def?.options?.objectName;
                        } catch {/* ignore */}
                    }
                    if (!referenceTo) {
                        res.status(500).json({
                            code: 'LOOKUP_TARGET_MISSING',
                            error: `Could not resolve referenced object for "${fieldName}"`,
                        });
                        return;
                    }

                    const displayFields: string[] = Array.isArray(picker.displayFields) && picker.displayFields.length > 0
                        ? picker.displayFields.slice(0, 5)
                        : ['name'];
                    const hardCap = 50;
                    const maxResults = Math.min(Math.max(1, Number(picker.maxResults) || 20), hardCap);
                    // [#6877] Same `String(array)` join as `/search`: the
                    // picker searched for `'a,b'` and showed an empty list.
                    if (refuseRepeatedQueryParams(req, res, ['q'])) return;
                    const q = String(req.query?.q ?? '').trim().slice(0, 100);

                    // Compose filters: form-defined static filter first,
                    // then the search predicate over displayFields. The
                    // search predicate uses `contains` on the first
                    // display field so non-indexed columns still work.
                    const filters: any[] = [];
                    if (Array.isArray(picker.filter)) filters.push(...picker.filter);
                    if (q) filters.push({ field: displayFields[0], operator: 'contains', value: q });

                    const context: any = {
                        permissions: ['guest_portal'],
                        anonymous: true,
                    };

                    const result: any = await (p as any).findData({
                        object: referenceTo,
                        query: {
                            limit: maxResults,
                            offset: 0,
                            filters,
                            select: ['id', ...displayFields],
                            // [#7485] Ordering is FIXED — first display field,
                            // ascending. This used to read `picker.sort`, a key
                            // `FormFieldPublicPickerSchema` (#7467) deliberately
                            // never declared: enforced by the route, authorable
                            // nowhere. The maintainer ruled retire-the-read over
                            // declare-the-key — zero measured pull for a
                            // permanently-maintained public key on an
                            // UNAUTHENTICATED surface. A pre-schema stored row
                            // still carrying `sort` is IGNORED, not an error.
                            sort: [{ field: displayFields[0], order: 'asc' }],
                        },
                        ...(environmentId ? { environmentId } : {}),
                        context,
                    } as any);

                    // Project the response server-side too — never trust
                    // that the driver respected `select`.
                    const rows: any[] = Array.isArray(result?.data) ? result.data : Array.isArray(result?.items) ? result.items : [];
                    const projected = rows.slice(0, maxResults).map((row: any) => {
                        const out: any = { id: row?.id };
                        for (const f of displayFields) {
                            if (row && Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
                        }
                        return out;
                    });
                    res.json({
                        data: projected,
                        total: projected.length,
                        truncated: rows.length >= maxResults,
                        displayFields,
                    });
                } catch (error: any) {
                    const mapped = mapDataError(error);
                    // Distinct message (this is not the "unhandled" channel),
                    // same shared verdict — see `isExpectedRouteError`.
                    if (!isExpectedRouteError(mapped.status, mapped.body)) {
                        logError('[REST] Public form lookup error:', error);
                    }
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Scoped lookup picker for a public form field (anonymous)',
                tags: ['forms', 'public'],
            },
        });
    }

    /**
     * Register record-level sharing endpoints (M11.C17).
     *
     * Surfaces `ISharingService` over HTTP so the UI can list, create
     * and revoke per-record grants without going through ObjectQL. The
     * three routes mirror the share-management drawer in Salesforce /
     * ServiceNow:
     *
     *   GET    {basePath}/data/:object/:id/shares
     *   POST   {basePath}/data/:object/:id/shares
     *   DELETE {basePath}/data/:object/:id/shares/:shareId
     *
     * All three resolve via `sharingServiceProvider`; routes return 501
     * when no sharing service is configured so a deployment without the
     * `@objectstack/plugin-sharing` plugin fails cleanly.
     */
    /**
     * ADR-0021 — analytics dataset preview/query endpoint.
     *
     *   POST {basePath}/analytics/dataset/query
     *   body: { dataset?: <inline Dataset>, datasetName?: string, selection: DatasetSelection }
     *
     * Compiles the dataset (an inline draft for Studio preview, or a saved one
     * by name) and runs the selection through the analytics service's
     * `queryDataset`, threading the request ExecutionContext so tenant/RLS
     * scoping (ADR-0021 D-C) applies. Returns 501 when no analytics service
     * (or one without `queryDataset`) is configured, so a deployment without
     * `@objectstack/service-analytics` fails cleanly.
     */
    private registerAnalyticsEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/environments/:environmentId');
        // Resolve the ENVIRONMENT's analytics service first — its strategy
        // bridges are bound to the env kernel's own data engine. The host
        // provider (whose 'data' is the host kernel's engine) is only a
        // fallback: serving a tenant's dataset query from the host engine
        // reads the WRONG database and silently aggregates over nothing
        // (the staging "Total Spend: 0 on a populated table" incident).
        const resolveService = async (environmentId?: string, req?: any) => {
            try {
                const envId = await this.resolveRequestEnvironmentId(environmentId, req);
                if (envId && envId !== 'platform' && this.kernelManager) {
                    const kernel = await this.kernelManager.getOrCreate(envId);
                    const svc = await kernel.getServiceAsync<any>('analytics').catch(() => undefined);
                    if (svc) return svc;
                }
            } catch { /* fall back to the host service */ }
            if (!this.analyticsServiceProvider) return undefined;
            try { return await this.analyticsServiceProvider(environmentId); }
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
                        return res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Analytics dataset query is not available on this deployment (no analytics service with queryDataset).',
                        });
                    }

                    const body = req.body ?? {};
                    const selection = body.selection;
                    if (!selection || !Array.isArray(selection.measures) || selection.measures.length === 0) {
                        return res.status(400).json({
                            code: 'VALIDATION_FAILED',
                            message: 'body.selection.measures must be a non-empty array of measure names.',
                        });
                    }

                    // ADR-0037 P3 — draft data preview: the canvas / preview
                    // pages pass the flag so (a) the dataset lookup sees
                    // draft-overlaid definitions and (b) the selection runs
                    // over the pending seed draft's rows when one exists.
                    // [#6877] A repeated `?preview=draft&preview=draft` stopped
                    // equalling `'draft'`, so the Studio preview silently ran
                    // over PUBLISHED rows and looked like the draft had no data.
                    if (refuseRepeatedQueryParams(req, res, ['preview'])) return;
                    const previewDrafts = body.previewDrafts === true || req.query?.preview === 'draft';

                    // Resolve the dataset definition: inline draft (Studio
                    // preview) or a saved dataset by name.
                    let dataset = body.dataset;
                    if (!dataset && body.datasetName) {
                        const p = await this.resolveProtocol(environmentId, req);
                        const items = await (p as any).getMetaItems?.({ type: 'dataset', previewDrafts }).catch(() => null);
                        const list = Array.isArray(items?.items) ? items.items : (Array.isArray(items) ? items : []);
                        dataset = list.find((d: any) => d?.name === body.datasetName);
                        if (!dataset) {
                            return res.status(404).json({ code: 'NOT_FOUND', message: `Dataset "${body.datasetName}" not found.` });
                        }
                    }
                    if (!dataset) {
                        return res.status(400).json({ code: 'VALIDATION_FAILED', message: 'Provide body.dataset (inline) or body.datasetName.' });
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
                        return res.status(400).json({
                            code: 'VALIDATION_FAILED',
                            message: 'Invalid dataset definition.',
                            detail: String(verr?.message ?? verr).slice(0, 1000),
                        });
                    }

                    const result = await svc.queryDataset(
                        dataset,
                        selection,
                        context ?? undefined,
                        previewDrafts ? { previewDrafts: true } : undefined,
                    );
                    res.json(result);
                } catch (error: any) {
                    const msg = String(error?.message ?? error ?? '');
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
                        return res.status(envelopeStatus).json({ code: envelopeCode, message: msg.slice(0, 1000) });
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
                    const outward = declaresServerFault(error) || looksLikeInternalErrorLeak(msg)
                        ? INTERNAL_ERROR_MESSAGE
                        : msg.slice(0, 500);
                    res.status(500).json({ code: 'ANALYTICS_QUERY_FAILED', error: outward });
                }
            },
            metadata: { summary: 'Run a semantic-layer dataset (preview/query)', tags: ['analytics'] },
        });
    }

    /**
     * [ADR-0090 D6] Access-explanation endpoint — the REST face of the
     * explain engine (framework#2696).
     *
     *   GET  {basePath}/security/explain?object=…&operation=…&userId=…
     *   POST {basePath}/security/explain   body: { object, operation, userId?,
     *                                              recordId? | recordIds? }
     *
     * [#8326] `recordIds` (max 200, exclusive with `recordId`) is the batch
     * form of the record-grained question: one `(object, operation)` pair
     * answered per record in one round trip — `records[i]` answers
     * `recordIds[i]`; each entry is the verdict the singular form returns for
     * that id (see `ExplainRequestSchema`'s TSDoc for the full contract).
     *
     * Delegates to the security service's `explain(request, callerContext)`
     * (`SecurityPlugin.explainAccessForCaller`) — the same code paths the
     * enforcement middleware runs, so the report is explained by
     * construction. Caller authorization lives in the SERVICE, not here:
     * explaining ANOTHER user requires `manage_users` or a delegated
     * `adminScope` covering that user (D12); the service's
     * `PermissionDeniedError` maps to 403. The route itself only insists on
     * an authenticated caller (an access report is sensitive even about
     * oneself, and the anonymous `guest` posture is not this endpoint's
     * business) and returns 501 when no security service exposing `explain`
     * is mounted (a deployment without `@objectstack/plugin-security`).
     */
    private registerSecurityExplainEndpoints(basePath: string): void {
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
         * `@objectstack/types`, imported as `sendEnvelopeError` because this
         * module has a local `sendError` of its own — the sanitizing responder
         * for THROWN errors, a different thing). That is what makes this the
         * reference shape by construction rather than a ninth local literal
         * agreeing with the eight it replaced, and it types `code` to the
         * closed vocabulary for free.
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
                logError('[REST] Security explain error:', error);
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

    private registerSharingEndpoints(basePath: string): void {
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
         * `@objectstack/types`, imported as `sendEnvelopeError` because this
         * module has a local `sendError` of its own — the sanitizing responder
         * for THROWN errors, a different thing). That is what makes this the
         * reference shape by construction rather than a tenth local literal
         * agreeing with the nine it replaced, and it types `code` to the
         * closed ADR-0112 vocabulary for free.
         *
         * ⛔ Status codes are untouched and no code VALUE moves: only the
         * POSITION of `code` and `message` changes.
         */
        const respondError = (
            res: any,
            status: number,
            code: ErrorCode,
            message: string,
        ): void => sendEnvelopeError(res, status, code, message);

        const respond501 = (res: any) => respondError(
            res, 501, 'NOT_IMPLEMENTED',
            'Sharing service is not configured on this deployment',
        );
        // [ADR-0111] The service enforces authorization (D1/D4/D5/D7) and
        // signals the verdict via message prefixes, the plugin's established
        // error idiom — this maps them onto HTTP. Returns true when handled.
        //
        // [#8111] The prefix is a SERVER-INTERNAL service→REST derivation: it
        // is stripped below and never reaches the wire, so no consumer can
        // read it (censused at claim — the only in-repo `startsWith(CODE)`
        // readers are this file's own route mappings plus one
        // `plugin-approvals` check on an error it threw itself in-process).
        // It therefore stays exactly as it is; only the response SHAPE moved.
        const respondSharingError = (res: any, error: any): boolean => {
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
                    respondError(
                        res, status, code,
                        msg.replace(new RegExp(`^${code}:\\s*`), ''),
                    );
                    return true;
                }
            }
            return false;
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
                    respondError(res, 500, 'SHARES_LIST_FAILED', String(error?.message ?? error).slice(0, 500));
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
                    respondError(res, 500, 'SHARE_GRANT_FAILED', String(error?.message ?? error).slice(0, 500));
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
                    respondError(res, 500, 'SHARE_REVOKE_FAILED', String(error?.message ?? error).slice(0, 500));
                }
            },
            metadata: { summary: 'Revoke a per-record share by id', tags: ['sharing'] },
        });
    }

    /**
     * Register sharing-rule endpoints (M10.17). Mirrors the existing
     * sharing endpoints but operates on `sys_sharing_rule` rows.
     *
     *   GET    {basePath}/sharing/rules?object=&activeOnly=
     *   POST   {basePath}/sharing/rules
     *   GET    {basePath}/sharing/rules/:idOrName
     *   DELETE {basePath}/sharing/rules/:idOrName
     *   POST   {basePath}/sharing/rules/:idOrName/evaluate
     *
     * Returns 501 when no sharing-rule service is configured.
     */
    private registerSharingRuleEndpoints(basePath: string): void {
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
            // arms above it. Those are #7035's declared debt — `code` beside
            // `error` instead of inside it, so `body.error.code` reads
            // `undefined` — held down by the `check:route-envelope` ratchet,
            // which only ticks DOWN. A new arm copying its neighbours' shape is
            // exactly what that ratchet exists to stop, so this one answers the
            // envelope `BaseResponseSchema` declares. The asymmetry is the
            // ratchet working; converting the other three is #8111's unfinished
            // half for this route family, not a rider on this card.
            if (msg.startsWith('SHARING_NOT_ENABLED')) {
                return sendEnvelopeError(
                    res, 422, 'SHARING_NOT_ENABLED',
                    msg.replace(/^SHARING_NOT_ENABLED:\s*/, ''),
                );
            }
            logError(`[REST] sharing-rule ${defaultCode}:`, err);
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

    /**
     * Register the security admin endpoints (ADR-0090 D5/D9) — suggested
     * audience bindings. A package permission set declaring `isDefault: true`
     * is an install-time SUGGESTION to bind it to the `everyone` position;
     * these routes surface pending suggestions and let a tenant admin resolve
     * them. The `security` service (plugin-security) does the real gating:
     * tenant-admin pre-check on all three, and confirm writes the binding
     * with the caller's execution context so the audience-anchor and
     * delegated-admin gates enforce it — never auto-bound, never system.
     *
     *   GET  {basePath}/security/suggested-bindings?status=&packageId=
     *   POST {basePath}/security/suggested-bindings/:id/confirm
     *   POST {basePath}/security/suggested-bindings/:id/dismiss
     *
     * Routes return 501 when the `security` service is not registered
     * (deployment without plugin-security). Typed service errors carry their
     * HTTP status (403 permission / 404 not found / 409 state).
     *
     * ## One envelope for every refusal these three routes make (#7981)
     *
     * Every arm below answers the ADR-0112 D5 body — `{ error: { code,
     * message } }`, semantic code nested, HTTP status on the transport — and
     * emits it through the ONE `respondError` helper, so the three cannot
     * drift apart again. Before this they answered three mutually
     * incompatible shapes on routes a single client calls in sequence:
     * `{ error: { code, message } }` from the validation refusals,
     * `{ code, message }` from the 501, and `{ code, error: '<string>' }`
     * from the thrown-service-error arm — the bare-string `error` dialect
     * #7035 (PR #7293) retired from this file's `/meta` 501s. So `error.code`
     * read `undefined` on exactly the arm carrying the typed 403/404/409
     * codes a consumer is most likely to branch on.
     */
    private registerSecurityEndpoints(basePath: string): void {
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
        const respondError = (res: any, status: number, code: string, message: string) =>
            res.status(status).json({ error: { code, message } });
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
            logError(`[REST] suggested-bindings ${defaultCode}:`, err);
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

        // CONFIRM — creates the anchor binding as the caller (gated write)
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
            metadata: { summary: 'Confirm a suggested audience binding (creates the everyone/guest binding)', tags: ['security'] },
        });

        // DISMISS — records the admin's decline; nothing is bound
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
            metadata: { summary: 'Dismiss a suggested audience binding', tags: ['security'] },
        });
    }

    /**
     * Register saved-report + scheduled-digest endpoints (M11.C16).
     *
     * Surfaces `IReportService` over HTTP so the UI can build,
     * run, and schedule reports without dropping to ObjectQL. Routes
     * live at the top of the API surface (alongside `/approvals` and
     * `/sharing`) — reports are a tenant-wide capability, not a record
     * on a specific CRUD object:
     *
     *   GET    {basePath}/reports?object=&ownerId=
     *   POST   {basePath}/reports
     *   GET    {basePath}/reports/:id
     *   DELETE {basePath}/reports/:id
     *   POST   {basePath}/reports/:id/run
     *   POST   {basePath}/reports/:id/schedule
     *   GET    {basePath}/reports/:id/schedules
     *   DELETE {basePath}/reports/schedules/:scheduleId
     *
     * All routes return 501 when `reportsServiceProvider` is unset so
     * a deployment without `@objectstack/plugin-reports` fails cleanly.
     */
    private registerReportsEndpoints(basePath: string): void {
        // Reports live at the top of the API surface (e.g. `/api/v1/reports`)
        // rather than under `/data/`, because a report is a first-class
        // capability whose definition is tenant-wide (not a record on a
        // particular object).
        const dataPath = basePath;
        const isScoped = basePath.includes('/environments/:environmentId');

        const resolveService = async (environmentId?: string) => {
            if (!this.reportsServiceProvider) return undefined;
            try { return await this.reportsServiceProvider(environmentId); }
            catch { return undefined; }
        };
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Reports service is not configured on this deployment',
        });
        const handleValidation = (res: any, err: any): boolean => {
            const msg = String(err?.message ?? err ?? '');
            if (msg.startsWith('VALIDATION_FAILED')) {
                res.status(400).json({
                    code: 'VALIDATION_FAILED',
                    error: msg.replace(/^VALIDATION_FAILED:\s*/, ''),
                });
                return true;
            }
            if (msg.startsWith('REPORT_NOT_FOUND')) {
                res.status(404).json({ code: 'REPORT_NOT_FOUND', error: msg });
                return true;
            }
            return false;
        };

        // GET — list reports.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/reports`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    // [#6877] Straight passthrough — both reached `listReports`
                    // as arrays.
                    if (refuseRepeatedQueryParams(req, res, ['object', 'ownerId'])) return;
                    const q = req.query ?? {};
                    const rows = await svc.listReports({ object: q.object, ownerId: q.ownerId }, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List reports error:', error);
                    res.status(500).json({ code: 'REPORTS_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List saved reports', tags: ['reports'] },
        });

        // POST — save (upsert) a report.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/reports`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    try {
                        const row = await svc.saveReport(req.body ?? {}, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        if (handleValidation(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Save report error:', error);
                    res.status(500).json({ code: 'REPORT_SAVE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Create or update a saved report', tags: ['reports'] },
        });

        // GET — single report.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/reports/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const row = await svc.getReport(req.params.id, context ?? {});
                    if (!row) {
                        res.status(404).json({ code: 'REPORT_NOT_FOUND', error: `Report ${req.params.id} not found` });
                        return;
                    }
                    res.json(row);
                } catch (error: any) {
                    logError('[REST] Get report error:', error);
                    res.status(500).json({ code: 'REPORT_GET_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Get a saved report by id', tags: ['reports'] },
        });

        // DELETE — drop report + cascade schedules.
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/reports/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    // [#7523] Deny-as-404, with the two deny arms collapsed onto ONE
                    // response. `deleteReport()` is silently idempotent for an id that
                    // does not exist but throws REPORT_NOT_FOUND for a report the
                    // caller does not own — two shapes that used to reach the caller
                    // as 204-vs-500 and let an authenticated prober read another
                    // owner's report ids straight off the status code. Splitting them
                    // 204-vs-404 would only re-dress the same oracle, so both arms are
                    // answered here, before the delete fires, by the one call the
                    // surface already keeps blind to the difference: `getReport()`
                    // returns null for an unknown id AND for another owner's id
                    // alike (#2980). The response is emitted by `handleValidation`
                    // from a synthesised REPORT_NOT_FOUND, i.e. the exact code path
                    // the thrown arm takes below — one emitter, so status and body
                    // cannot drift apart.
                    const visible = await svc.getReport(req.params.id, context ?? {});
                    if (!visible) {
                        handleValidation(res, new Error(`REPORT_NOT_FOUND: ${req.params.id}`));
                        return;
                    }
                    await svc.deleteReport(req.params.id, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
                    // REPORT_NOT_FOUND → 404, VALIDATION_FAILED → 400. Reached only
                    // when an IReportService gates in `deleteReport()` without also
                    // blinding `getReport()`; routing it through the same helper keeps
                    // that implementation's arms indistinguishable too.
                    if (handleValidation(res, error)) return;
                    logError('[REST] Delete report error:', error);
                    res.status(500).json({ code: 'REPORT_DELETE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Delete a saved report (cascades schedules)', tags: ['reports'] },
        });

        // POST — execute a report by id.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/reports/:id/run`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    try {
                        const result = await svc.run(req.params.id, context ?? {});
                        res.json(result);
                    } catch (err: any) {
                        if (handleValidation(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Run report error:', error);
                    res.status(500).json({ code: 'REPORT_RUN_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Execute a saved report and return rendered output', tags: ['reports'] },
        });

        // POST — schedule a report.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/reports/:id/schedule`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    try {
                        const row = await svc.scheduleReport({
                            reportId: req.params.id,
                            recipients: body.recipients ?? [],
                            name: body.name,
                            intervalMinutes: body.intervalMinutes ?? body.interval_minutes,
                            cronExpression: body.cronExpression ?? body.cron_expression,
                            timezone: body.timezone,
                            format: body.format,
                            subjectTemplate: body.subjectTemplate ?? body.subject_template,
                            ownerId: body.ownerId ?? body.owner_id,
                            active: body.active,
                        }, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        if (handleValidation(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Schedule report error:', error);
                    res.status(500).json({ code: 'REPORT_SCHEDULE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Create a recurring email schedule for a report', tags: ['reports'] },
        });

        // GET — list schedules for a report.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/reports/:id/schedules`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    const rows = await svc.listSchedules({ reportId: req.params.id }, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List schedules error:', error);
                    res.status(500).json({ code: 'SCHEDULES_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List schedules for a report', tags: ['reports'] },
        });

        // DELETE — drop a schedule.
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/reports/schedules/:scheduleId`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(environmentId);
                    if (!svc) return respond501(res);
                    // [#7603] Both deny arms — an unknown scheduleId and another
                    // owner's — reach the caller as the one 404 emitted by the
                    // single `handleValidation` call below, because
                    // `unscheduleReport` is contracted to throw the SAME
                    // `REPORT_NOT_FOUND: <scheduleId>` for both, before the delete
                    // fires. It used to resolve silently for the unknown id, which
                    // landed here as a 204 and let a prober read another owner's
                    // schedule ids off the status code (#7523's oracle, in the
                    // 404-vs-204 costume its card warned about).
                    //
                    // Unlike the sibling `DELETE /reports/:id`, this route cannot
                    // pre-empt the two arms itself: that one collapses them with
                    // `getReport()`, already blind to the difference (#2980),
                    // whereas the caller here presents a scheduleId and
                    // `IReportService` exposes no by-id schedule read to be blind
                    // with — `listSchedules` is keyed by reportId. So the blinding
                    // is the service's obligation (stated on the contract), and the
                    // route's job is to keep ONE emitter for whatever it throws.
                    await svc.unscheduleReport(req.params.scheduleId, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
                    if (handleValidation(res, error)) return; // REPORT_NOT_FOUND → 404 (deny-as-404, anti-enumeration)
                    logError('[REST] Unschedule report error:', error);
                    res.status(500).json({ code: 'SCHEDULE_DELETE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Delete a report schedule by id', tags: ['reports'] },
        });
    }

    /**
     * Register approval endpoints (ADR-0019: approval as a flow node).
     *
     * Approval is no longer a standalone process engine — a flow's Approval
     * node opens a request and suspends the run; a decision resumes it. There
     * are no process-authoring or submit routes anymore.
     *
     * Routes (all under {basePath}/approvals):
     *   GET    /requests                        — list (filters: status, object, recordId, approverId, submitterId)
     *   GET    /requests/:id                    — get request
     *   POST   /requests/:id/approve            — record an approve decision (resumes the flow)
     *   POST   /requests/:id/reject             — record a reject decision (resumes the flow)
     *   GET    /requests/:id/actions            — audit trail
     *
     * Returns 501 when `approvalsServiceProvider` is unset so deployments
     * without `@objectstack/plugin-approvals` fail cleanly.
     */
    private registerApprovalsEndpoints(basePath: string): void {
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
            ];
            for (const [re, status, code] of mapping) {
                if (re.test(msg)) {
                    res.status(status).json({ code, error: msg.replace(/^[A-Z_]+:\s*/, '') });
                    return true;
                }
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
                    const limit = q.limit != null ? Number(q.limit) : undefined;
                    const offset = q.offset != null ? Number(q.offset) : undefined;
                    const listFilter = {
                        object: q.object,
                        recordId: q.recordId ?? q.record_id,
                        status: q.status,
                        approverId: approverIds.length ? approverIds : undefined,
                        submitterId: q.submitterId ?? q.submitter_id,
                        q: typeof q.q === 'string' ? q.q : undefined,
                        limit: Number.isFinite(limit) ? limit : undefined,
                        offset: Number.isFinite(offset) ? offset : undefined,
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

    /**
     * Register batch operation endpoints
     */
    private registerBatchEndpoints(basePath: string): void {
        const { crud, batch } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/environments/:environmentId');

        const operations = batch.operations;
        // [#3939] One cap, read once, applied by every bulk route below via
        // {@link enforceBatchSize} — see that method for why it lives here and
        // not in the Zod schemas.
        const maxBatch = batch.maxBatchSize ?? 200;

        // POST /batch — cross-object transactional batch (issue #1604 / ADR-0034).
        // Runs heterogeneous create/update/delete across objects in ONE engine
        // transaction (commit all or roll back all). Intra-batch references: a
        // field value of `{ $ref: <earlier op index> }` resolves to that op's
        // created id, so a child can reference its parent (master-detail). The
        // request is validated against the spec contract, and each op is gated by
        // the SAME per-object API-exposure rules (enable.apiEnabled / apiMethods)
        // as the single-record routes before any transaction is opened.
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/batch`,
            handler: async (req: any, res: any) => {
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const context = await this.resolveExecCtx(environmentId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const ql = this.objectQLProvider ? await this.objectQLProvider(environmentId) : undefined;
                    if (!ql || typeof ql.transaction !== 'function') {
                        // Typed like every other 501 on this server (clone/search,
                        // #4067) so a client can key on the code, not the prose.
                        res.status(501).json({ error: 'Transactional batch not supported by this runtime', code: 'NOT_IMPLEMENTED' });
                        return;
                    }

                    // Validate the request against the spec contract (Zod-First).
                    const { CrossObjectBatchRequestSchema } = await import('@objectstack/spec/api');
                    const parsed = (CrossObjectBatchRequestSchema as any).safeParse(req.body ?? {});
                    if (!parsed.success) {
                        res.status(400).json({ error: 'Invalid batch request', code: 'VALIDATION_FAILED', issues: parsed.error?.issues });
                        return;
                    }
                    const ops: Array<{ object: string; action: 'create' | 'update' | 'delete'; id?: string; data?: Record<string, any> }> = parsed.data.operations;
                    // All-or-nothing by construction: refuse a request that asks for
                    // non-atomic semantics rather than silently applying atomically
                    // (honest contract). Per-object partial batches use the
                    // POST /data/:object/batch route instead.
                    if (parsed.data.atomic === false) {
                        res.status(400).json({ error: 'Cross-object batch is always atomic; use POST /data/:object/batch for non-atomic per-object batches', code: 'BATCH_NOT_ATOMIC' });
                        return;
                    }
                    if (ops.length === 0) { res.json({ results: [] }); return; }
                    // [#3939] Same check, same envelope as every other bulk route
                    // now — this one used to be the only one that capped at all,
                    // and it answered without a `code` for clients to key on.
                    if (this.enforceBatchSize(res, ops.length, maxBatch)) return;

                    // update/delete need a target id — the schema can't express this
                    // conditionally, so surface it as a 400 up front.
                    for (const op of ops) {
                        if ((op.action === 'update' || op.action === 'delete') && op.id == null && op.data?.id == null) {
                            res.status(400).json({ error: `Operation '${op.action}' on '${op.object}' requires an id`, code: 'VALIDATION_FAILED' });
                            return;
                        }
                    }

                    // Enforce object-level API exposure (enable.apiEnabled /
                    // apiMethods) for EVERY op BEFORE opening the transaction — the
                    // batch write surface must honour the same per-object gate as the
                    // single-record routes (ADR-0049 / #1889). Metadata is fetched
                    // once; each distinct (object, action) is checked once.
                    const p = await this.resolveProtocol(environmentId, req);
                    const items = await this.loadObjectItems(p, environmentId);
                    if (items.length > 0) {
                        const byName = new Map<string, any>(items.map((o: any) => [o?.name, o]));
                        const checked = new Set<string>();
                        for (const op of ops) {
                            const key = `${op.object}\u0000${op.action}`;
                            if (checked.has(key)) continue;
                            checked.add(key);
                            const obj = byName.get(op.object);
                            if (!obj) continue; // unknown object → surfaced by the op inside the tx
                            // [#3391] Cross-object batch is a bulk surface: gate each op
                            // as `bulk ∧ child(op.action)` — the object must grant the
                            // `bulk` primitive AND the specific write it performs.
                            const denial = apiAccessDenialFromEnable(obj.enable, op.object, 'bulk', { bulkChild: op.action });
                            if (denial) { res.status(denial.status).json(denial.body); return; }
                        }
                    }

                    // Resolve `{ $ref: <opIndex> }` values against results collected
                    // so far. A ref MUST point at an earlier create whose id is known;
                    // anything else is a 400 (never a silent null FK).
                    const resolveRefs = (data: any, out: any[]): any => {
                        if (!data || typeof data !== 'object') return data;
                        const result: any = Array.isArray(data) ? [] : {};
                        for (const [k, v] of Object.entries(data)) {
                            if (v && typeof v === 'object' && '$ref' in (v as any)) {
                                const idx = (v as any).$ref;
                                const ref = typeof idx === 'number' ? out[idx] : undefined;
                                const refId = ref && (ref.id ?? ref._id);
                                if (refId == null) {
                                    const err: any = new Error(`Unresolved $ref ${JSON.stringify(idx)} on field '${k}' — must reference an earlier create in the same batch`);
                                    err.status = 400;
                                    err.code = 'BATCH_UNRESOLVED_REF';
                                    throw err;
                                }
                                result[k] = refId;
                            } else {
                                result[k] = v;
                            }
                        }
                        return result;
                    };

                    // [#3794] Write-observability on THIS surface too. The engine
                    // strips `readonly` / `readonlyWhen` writes silently, and every
                    // other write path already reports what it dropped (#3431/#3455)
                    // — but this one did not, and it is precisely the path the
                    // console's record form takes for a master-detail save. Result:
                    // a user edited a `readonlyWhen`-locked field, got "updated
                    // successfully", and the value never changed with nothing said
                    // (#3794 problem 2). Each event is tagged with its operation
                    // index, since `results` entries are bare record echoes with no
                    // envelope to hang a per-row list on.
                    const dropped: Array<DroppedFieldsEvent & { index: number }> = [];
                    const results = await ql.transaction(async (trxCtx: any) => {
                        const out: any[] = [];
                        for (const [index, op] of ops.entries()) {
                            const data = resolveRefs(op.data, out);
                            if (op.action === 'create') {
                                // [#3835] Go through the protocol's create ingress —
                                // the SAME one `POST /data/:object` uses — rather than
                                // calling `ql.insert` directly. The engine's INSERT path
                                // is static-`readonly`-exempt by design (#3413), so the
                                // #3043 strip that stops a non-system caller from seeding
                                // a read-only column lives at that ingress. Bypassing it
                                // here made `readonly` mean two different things on two
                                // create paths: rejected on the single route, written
                                // through the batch. `createData` also owns the platform-
                                // object carve-out (a `sys_`/`managedBy` object's own
                                // guard must REJECT a forged value, not silently swallow
                                // it), which is why this routes to the ingress instead of
                                // re-implementing the strip here — one create ingress,
                                // and a future change to its policy covers the batch for
                                // free. `trxCtx` carries the caller's context (including
                                // `isSystem`) plus the open transaction, so the strip
                                // decides exactly as it does on the single route and the
                                // insert still joins this transaction.
                                const created: any = await p.createData({ object: op.object, data, context: trxCtx } as any);
                                for (const e of (created?.droppedFields ?? []) as DroppedFieldsEvent[]) {
                                    dropped.push({ ...e, index });
                                }
                                out.push(created?.record);
                            } else if (op.action === 'update') {
                                // Update needs no ingress detour for the WRITE half:
                                // the engine enforces both static `readonly` (#2948)
                                // and `readonlyWhen` (#3042) on its own update path,
                                // and reports them through this listener.
                                const onFieldsDropped = (e: DroppedFieldsEvent) => { dropped.push({ ...e, index }); };
                                const id = op.id ?? data?.id;
                                const updated = await ql.update(op.object, { ...data, id }, { context: trxCtx, onFieldsDropped });
                                // [#7823] …but the RESPONSE half moved to the ingress
                                // (A-prime ruling, 2026-08-13): the engine no longer
                                // strips `internal: true` fields from its write
                                // results, so this direct-`ql.update` mouth must
                                // apply the shared strip itself before the row rides
                                // `results` out to the caller. Reached through the
                                // protocol instance because this package does not
                                // depend on `@objectstack/metadata-protocol` (same
                                // duck-typing as the `createManyData` probes).
                                // Dormant today — no `internal`-flagged object grants
                                // `bulk` — wired so the flag's guarantee does not
                                // depend on that staying true.
                                (p as any).omitInternalWriteFields?.(op.object, updated);
                                out.push(updated);
                            } else { // 'delete'
                                out.push(await ql.delete(op.object, { where: { id: op.id }, context: trxCtx }));
                            }
                        }
                        return out;
                    }, context);

                    res.json({ results, ...(dropped.length > 0 ? { droppedFields: dropped } : {}) });
                } catch (error: any) {
                    // Log only genuine server faults; client 4xx (validation,
                    // unresolved ref, atomic rollback of a bad op) are expected.
                    // This site used to judge on `status >= 500` alone, which
                    // also swallowed the un-coded 400 `mapDataError` degrades an
                    // UNRECOGNISED error to — a handler `TypeError` inside a
                    // batch transaction vanished here. The shared predicate
                    // keeps that one loud while staying quiet on the coded 4xx.
                    handleRouteError(res, error);
                }
            },
            metadata: {
                summary: 'Cross-object transactional batch (atomic create/update/delete across objects)',
                tags: ['data', 'batch'],
            },
        });

        // POST /data/:object/batch - Generic batch endpoint
        if (batch.enableBatchEndpoint && this.protocol.batchData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/batch`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ child(body.operation) — the object must grant
                        // the `bulk` primitive AND the batched write kind.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: req.body?.operation })) return;
                        // [#3899] Validate against the declared contract
                        // (`BatchUpdateRequestSchema`, catalog `requestSchema`) —
                        // this route used to hand the body straight to the
                        // protocol, so `{ operation: 'updat', records: {} }`
                        // reached the engine as-is. Validation only: the ORIGINAL
                        // body is forwarded, not the parse output, so
                        // `BatchOptionsSchema`'s defaults (e.g. `atomic: true`)
                        // are not injected into a request that never sent them.
                        const { BatchUpdateRequestSchema } = await import('@objectstack/spec/api');
                        const batchInput = req.body ?? {};
                        const parsedBatch = (BatchUpdateRequestSchema as any).safeParse(batchInput);
                        if (!parsedBatch.success) {
                            res.status(400).json({
                                error: 'Invalid batch request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedBatch.error?.issues, batchInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] Cap AFTER the shape check, so a caller gets the
                        // more specific answer first.
                        if (this.enforceBatchSize(res, parsedBatch.data.records.length, maxBatch, req.params?.object)) return;
                        const result = await p.batchData!({
                            object: req.params.object,
                            request: req.body,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Batch operations',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/createMany - Bulk create
        if (operations.createMany && this.protocol.createManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/createMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ create — createMany requires the `bulk` primitive.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: 'create' })) return;
                        // [#3899] Body IS the records array on this route (what
                        // `client.data.createMany` posts). Validate the assembled
                        // protocol request (`CreateManyDataRequestSchema`, catalog
                        // `requestSchema`) so `{ records: [...] }` — updateMany's
                        // envelope, an easy cross-route slip — or any other
                        // non-array body 400s instead of reaching the engine as a
                        // single garbage "record".
                        const { CreateManyDataRequestSchema } = await import('@objectstack/spec/api');
                        const createManyInput = { object: req.params.object, records: req.body ?? [] };
                        const parsedCreateMany = (CreateManyDataRequestSchema as any).safeParse(createManyInput);
                        if (!parsedCreateMany.success) {
                            res.status(400).json({
                                error: 'Invalid createMany request — the body must be a JSON array of record objects',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedCreateMany.error?.issues, createManyInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] Cap AFTER the shape check.
                        if (this.enforceBatchSize(res, parsedCreateMany.data.records.length, maxBatch, req.params?.object)) return;
                        const result = await p.createManyData!({
                            object: req.params.object,
                            records: req.body || [],
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.status(201).json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Create multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/updateMany - Bulk update
        if (operations.updateMany && this.protocol.updateManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/updateMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ update — updateMany requires the `bulk` primitive.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: 'update' })) return;
                        // [#3933] Validate against the spec contract, and write the
                        // PATH object last. The body used to be spread over
                        // `object: req.params.object`, so `{"object":"other", …}`
                        // moved the write to a different object than the one
                        // `enforceApiAccess` had just cleared — that gate reads
                        // `req.params.object`, so `enable.apiEnabled` / `apiMethods`
                        // (ADR-0049) was enforced on A while B was written. Zod also
                        // strips unknown keys, which keeps a body `context` from
                        // becoming the execution context on a deployment where none
                        // resolves (e.g. an anonymous public-book read, #3963).
                        const { UpdateManyDataRequestSchema } = await import('@objectstack/spec/api');
                        const updateManyInput = { ...(req.body ?? {}), object: req.params.object };
                        const parsedUpdate = (UpdateManyDataRequestSchema as any).safeParse(updateManyInput);
                        if (!parsedUpdate.success) {
                            res.status(400).json({
                                error: 'Invalid updateMany request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsedUpdate.error?.issues, updateManyInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] Cap AFTER the shape check, so a caller gets the
                        // more specific answer first.
                        if (this.enforceBatchSize(res, parsedUpdate.data.records.length, maxBatch, req.params?.object)) return;
                        const result = await p.updateManyData!({
                            ...parsedUpdate.data,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Update multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/deleteMany - Bulk delete
        if (operations.deleteMany && this.protocol.deleteManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/deleteMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        // [#3391] bulk ∧ delete — deleteMany requires the `bulk` primitive.
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk', { bulkChild: 'delete' })) return;
                        // [#3897] Validate against the spec contract instead of
                        // splatting the raw body into the protocol request. Zod
                        // object schemas STRIP unknown keys, which is what makes
                        // this a security boundary and not just an error message:
                        // `options` is narrowed to `BatchOptions`, so a body key
                        // (`options.where`, `options.multi`) can no longer ride
                        // into the engine's delete options, and a top-level
                        // `context` can no longer forge the caller's principal on
                        // a route reachable without auth. The protocol layer
                        // refuses the same shapes independently (defence in
                        // depth) — this stops them one hop earlier, with a 400
                        // the caller can act on.
                        // [#3933] The PATH object is written LAST for the same
                        // reason: `enforceApiAccess` gates on `req.params.object`,
                        // so a body `object` would move the delete to an object
                        // whose exposure policy was never checked.
                        const { DeleteManyDataRequestSchema } = await import('@objectstack/spec/api');
                        const deleteManyInput = { ...(req.body ?? {}), object: req.params.object };
                        const parsed = (DeleteManyDataRequestSchema as any).safeParse(deleteManyInput);
                        if (!parsed.success) {
                            res.status(400).json({
                                error: 'Invalid deleteMany request',
                                code: 'VALIDATION_FAILED',
                                fields: zodIssuesToFields(parsed.error?.issues, deleteManyInput),
                                object: req.params?.object,
                            });
                            return;
                        }
                        // [#3939] The cap that matters most: since #3897 this
                        // route deletes per id, so the list length IS the engine
                        // round-trip count.
                        if (this.enforceBatchSize(res, parsed.data.ids.length, maxBatch, req.params?.object)) return;
                        const result = await p.deleteManyData!({
                            ...parsed.data,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        handleRouteError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Delete multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }
    }

    
    /**
     * Get the route manager
     */
    getRouteManager(): RouteManager {
        return this.routeManager;
    }

    /**
     * Record routes a bypassing registrar mounted on this server's host
     * `IHttpServer` (#5822).
     *
     * Called by the composition step that invoked the registrar
     * (`mountAndRecordDirectRoutes`), with the array the registrar returned —
     * which is the array it iterated to mount, so this records what happened
     * rather than what was intended. Nothing here re-derives, re-checks or
     * re-orders that fact; a registrar that was never called reports nothing,
     * which is how "not mounted ⇒ not enumerable" survives.
     */
    recordDirectMountedRoutes(routes: readonly DirectMountedRoute[]): void {
        for (const route of routes) {
            this.directMountedRoutes.push({ ...route, source: 'direct-mount' });
        }
    }

    /**
     * [#6633] The advertised bases for the direct-mount surfaces, derived from
     * the RECORDED mounts themselves — never recomputed from config.
     *
     * This is the load-bearing half of the mounted ⇒ advertised parity
     * (ADR-0076 D12): the registrars mount at whatever base the plugin threads
     * in (since #6306 that is `getApiBasePath()`), the recorder keeps the
     * very arrays they iterated to mount (#5822), and this method projects the
     * advertised `routes.packages` / `routes.datasources` out of those arrays.
     * One expression, two consumers — a future change that moves the mount
     * moves the advertisement with it, and a change that touches only one side
     * goes red on the parity pin
     * (`discovery-advertised-direct-mounts.parity.test.ts`).
     *
     * @param scopedEnvironmentId when the discovery response being built is
     *   served from the environment-scoped mount, the resolved environment id
     *   (or the `:environmentId` placeholder when unresolved); `undefined` for
     *   the unscoped mount.
     */
    getDirectMountRouteBases(scopedEnvironmentId?: string): { packages?: string; datasources?: string } {
        const SCOPED_SEGMENT = '/environments/:environmentId';
        let packagesUnscoped: string | undefined;
        let packagesScoped: string | undefined;
        let datasources: string | undefined;
        for (const { method, path } of this.directMountedRoutes) {
            // The package registrar's list route (`GET {base}/packages`) IS the
            // surface base — recorded verbatim, recognised, never rebuilt.
            if (method === 'GET' && path.endsWith('/packages')) {
                if (path.includes(SCOPED_SEGMENT)) packagesScoped = path;
                else packagesUnscoped = path;
            }
            // Every federation route sits under
            // `{base}/datasources/:name/external/…`; the advertised base is
            // `{base}/datasources`.
            const extAt = path.indexOf('/datasources/:name/external/');
            if (extAt >= 0 && datasources === undefined) {
                datasources = `${path.slice(0, extAt)}/datasources`;
            }
        }
        // A scoped discovery response advertises the scoped packages mount when
        // one is recorded (with the caller's environment id substituted, the
        // same move the `data`/`metadata` overrides make); the unscoped mount
        // is the answer everywhere else. No cross-over in the unscoped case:
        // advertising a `:environmentId` pattern to an unscoped caller would be
        // a URL nothing can consume.
        const packages = scopedEnvironmentId !== undefined
            ? (packagesScoped?.replace(':environmentId', scopedEnvironmentId) ?? packagesUnscoped)
            : packagesUnscoped;
        return { packages, datasources };
    }

    /**
     * [#6714] The advertised base for the email surface, projected from the
     * RECORDED route registrations — never recomputed from config.
     *
     * Same mounted ⇒ advertised discipline as {@link getDirectMountRouteBases}
     * (ADR-0076 D12), over the other recording: `registerEmailEndpoints`
     * registers `POST {base}/email/send` through the RouteManager, so the
     * RouteManager's table — the very rows the registrar wrote to mount — is
     * the mount fact this method projects. A future change that moves the
     * email mount moves the advertisement with it, and a change that touches
     * only one side goes red on the parity pin
     * (`discovery-advertised-direct-mounts.parity.test.ts`).
     *
     * @param scopedEnvironmentId when the discovery response being built is
     *   served from the environment-scoped mount, the resolved environment id
     *   (or the `:environmentId` placeholder when unresolved); `undefined` for
     *   the unscoped mount.
     * @returns the advertised `routes.email` base (`{mountBase}/email` — the
     *   consumer appends `/send`), or `undefined` when no email route is
     *   recorded for this boot.
     */
    getMountedEmailRouteBase(scopedEnvironmentId?: string): string | undefined {
        const SCOPED_SEGMENT = '/environments/:environmentId';
        const SEND_SUFFIX = '/email/send';
        let unscoped: string | undefined;
        let scoped: string | undefined;
        for (const { method, path } of this.routeManager.getAll()) {
            // The email registrar's send route (`POST {base}/email/send`) IS
            // the surface: the advertised base is the recorded path minus the
            // `/send` leaf — recognised, never rebuilt.
            if (method !== 'POST' || !path.endsWith(SEND_SUFFIX)) continue;
            const base = path.slice(0, -'/send'.length);
            if (path.includes(SCOPED_SEGMENT)) scoped = base;
            else unscoped = base;
        }
        // Same scoped/unscoped selection as the packages projection above: a
        // scoped discovery response advertises the scoped mount when one is
        // recorded (environment id substituted), the unscoped mount answers
        // everywhere else, and an unscoped caller is never handed a
        // `:environmentId` pattern nothing can consume.
        return scopedEnvironmentId !== undefined
            ? (scoped?.replace(':environmentId', scopedEnvironmentId) ?? unscoped)
            : unscoped;
    }

    /**
     * Get all routes mounted for this boot — the whole surface this server
     * knows about, RouteManager's table and the recorded direct mounts alike.
     *
     * This is the introspection seam: the OpenAPI built-in section
     * (`buildBuiltinPaths`), the route-ledger conformance guard and every
     * debugging reader ask exactly this one question. Before #5822 it answered
     * only for `routeManager`, so nine mounted routes — eight of them SDK
     * capabilities — were invisible to all three.
     */
    getRoutes(): MountedRoute[] {
        return [
            ...this.routeManager.getAll().map((route): MountedRoute => ({ ...route, source: 'route-manager' })),
            ...this.directMountedRoutes,
        ];
    }
}
