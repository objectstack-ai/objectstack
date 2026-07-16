// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    IHttpServer, resolveAuthzContext, resolveLocalizationContext, isAuthGateAllowlisted,
    shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS,
} from '@objectstack/core';
import { isMcpServerEnabled } from '@objectstack/types';
import { RouteManager } from './route-manager.js';
import { RestServerConfig, RestApiConfig, CrudEndpointsConfig, MetadataEndpointsConfig, BatchEndpointsConfig, RouteGenerationConfig } from '@objectstack/spec/api';
import { DataProtocol, MetadataProtocol } from '@objectstack/spec/api';
import { PUBLIC_FORM_SERVER_MANAGED_FIELDS } from '@objectstack/spec/security';

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
import { prepareImportRequest, isMetaEnvelope } from './import-prepare.js';

// Node-safe logger — avoids importing 'console' which is absent from ES2020 lib typings.
const logError = (...args: unknown[]) => (globalThis as any).console?.error(...args);

/**
 * Metadata types whose user-facing labels are localized at the REST boundary
 * via `translateMetadataDocument`. Keep in sync with the type dispatch in
 * `@objectstack/spec/system`'s `translateMetadataDocument`.
 */
const TRANSLATABLE_META_TYPES = new Set(['view', 'action', 'object', 'app', 'dashboard']);


/**
 * Map a data-layer error to a clean HTTP response. Unknown-object errors
 * (SQLite "no such table", PG "relation does not exist", protocol
 * "object not found", etc.) are surfaced as a 404 with `code: 'object_not_found'`
 * so clients can distinguish "object isn't registered" from real server
 * faults. Anything else becomes a 400 (bad request) preserving prior
 * behavior. Genuine 500s are still logged.
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
    // through here (they never reach sendError's `.status` passthrough).
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
        return {
            status: 400,
            body: {
                error: error.innerMessage,
                ...(object ? { object } : {}),
            },
        };
    }
    // Generic passthrough for domain errors that already carry an explicit
    // HTTP status (e.g. plugin-sharing's record-scope denial: status 403 +
    // code FORBIDDEN) — mirrors sendError's `.status` handling, which the
    // generic data routes bypass by calling mapDataError directly (#2926 ⑦).
    // Placed AFTER the structured-code branches above (409s carry rich
    // fields this envelope would drop) and deliberately limited to 4xx:
    // 5xx messages keep going through the sanitizing heuristics below so
    // internal/SQL details never reach the client verbatim.
    if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
        const msg = typeof error?.message === 'string' && error.message.length > 0 && error.message.length < 500
            ? error.message
            : 'Request failed';
        return {
            status: error.status,
            body: {
                error: msg,
                ...(typeof error?.code === 'string' && error.code ? { code: error.code } : {}),
                ...(object ? { object } : {}),
            },
        };
    }

    const raw = String(error?.message ?? error ?? '');
    const lower = raw.toLowerCase();

    // Fallback for the same sandbox wrapper when the SandboxError instance
    // (and its `innerMessage`) was lost crossing a rethrow/serialization
    // boundary: strip the debug wrapper from the raw message. A leading
    // default `Error: ` name is dropped; non-default names (`TypeError: …`)
    // are kept — they signal a genuine script bug rather than a deliberately
    // thrown business rule, which is useful context.
    const sandboxWrapper = /^(?:hook|action) '[^']*' threw:\s*(.+)$/s.exec(raw);
    if (sandboxWrapper) {
        const msg = sandboxWrapper[1].startsWith('Error: ')
            ? sandboxWrapper[1].slice('Error: '.length)
            : sandboxWrapper[1];
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
    const unknownColumn =
        /has no column named\s+["'`]?([a-z0-9_]+)/i.exec(raw) ||
        /no such column:\s*["'`]?([a-z0-9_.]+)/i.exec(raw) ||
        /unknown column\s+["'`]([a-z0-9_]+)["'`]/i.exec(raw) ||
        /column\s+["'`]([a-z0-9_]+)["'`]\s+of relation\s+\S+\s+does not exist/i.exec(raw);
    if (unknownColumn) {
        const field = unknownColumn[1]?.split('.').pop();
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

    const looksLikeUnknownObject =
        lower.includes('no such table') ||
        lower.includes('relation') && lower.includes('does not exist') ||
        lower.includes('table not found') ||
        lower.includes('unknown object') ||
        lower.includes('object not found') ||
        lower.includes('no driver available') ||
        (object !== undefined && lower.includes(`'${object.toLowerCase()}'`) && lower.includes('not'));
    if (looksLikeUnknownObject) {
        return {
            status: 404,
            body: {
                error: object ? `Object '${object}' is not registered` : 'Object not found',
                code: 'object_not_found',
                object,
            },
        };
    }
    // Default: do NOT leak raw SQL or driver internals. If the message
    // looks like a SQL/driver dump, replace it with a generic envelope
    // and rely on server logs for the full diagnostic.
    const looksLikeSqlLeak =
        lower.includes('sqlite_') ||
        lower.includes('sqlstate') ||
        lower.startsWith('insert into ') ||
        lower.startsWith('update ') ||
        lower.startsWith('select ') ||
        lower.startsWith('delete from ') ||
        lower.includes('constraint failed') ||
        lower.includes('unique constraint') ||
        lower.includes('foreign key');
    if (looksLikeSqlLeak) {
        // Surface unique-constraint violations as a structured 409 so
        // the UI can map them to "this value already exists".
        if (lower.includes('unique constraint') || lower.includes('unique violation')) {
            return {
                status: 409,
                body: {
                    error: 'A record with this value already exists',
                    code: 'UNIQUE_VIOLATION',
                    ...(object ? { object } : {}),
                },
            };
        }
        return {
            status: 500,
            body: { error: 'Internal data error', code: 'DATABASE_ERROR' },
        };
    }
    return { status: 400, body: { error: raw || 'Bad request' } };
}

/**
 * Centralized error responder for all REST handlers. Ensures raw driver
 * messages (SQLite/Postgres dumps, stack traces, unique-constraint
 * payloads with table names, etc.) never reach clients. Honors
 * structured errors that already carry an explicit `status` so callers
 * can surface domain-specific codes (e.g. 422 from a metadata save
 * validator), and routes everything else through `mapDataError` so the
 * security / validation / SQL-leak / unknown-object envelopes apply
 * uniformly across CRUD, batch, metadata, UI and discovery routes.
 */
function sendError(res: any, error: any, object?: string): void {
    if (typeof error?.status === 'number' && error.status >= 400 && error.status < 600) {
        const safeMsg = typeof error.message === 'string' && error.message.length < 500
            ? error.message
            : 'Request failed';
        res.status(error.status).json({
            error: safeMsg,
            ...(error.code ? { code: error.code } : {}),
            ...(Array.isArray(error.issues) ? { issues: error.issues } : {}),
        });
        return;
    }
    const mapped = mapDataError(error, object);
    res.status(mapped.status).json(mapped.body);
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

/** Platform object backing async import jobs (see sys-import-job.object.ts). */
const IMPORT_JOB_OBJECT = 'sys_import_job';
/** Hard ceiling on rows per async import job (mirrors spec IMPORT_JOB_MAX_ROWS). */
const IMPORT_JOB_MAX_ROWS = 50_000;
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
 */
function rowsToCsv(
    fields: string[],
    rows: Array<Record<string, any>>,
    includeHeader: boolean,
    metaMap: Map<string, ExportFieldMeta>,
): string {
    const lines: string[] = [];
    if (includeHeader) lines.push(fields.map(f => formatCsvCell(headerLabel(f, metaMap))).join(','));
    for (const row of rows) {
        lines.push(formatRowCells(row, fields, metaMap).map(formatCsvCell).join(','));
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
        requireAuth: boolean;
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

export class RestServer {
    private protocol: RestProtocol;
    private config: NormalizedRestServerConfig;
    private routeManager: RouteManager;
    private kernelManager?: RestKernelManager;
    private envRegistry?: RestEnvRegistry;
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
     * Resolve the environment a request targets: explicit id → tenant hostname
     * → `X-Environment-Id` header → single-project default. Returns undefined
     * for control-plane requests. Shared by every per-environment service
     * resolution (protocol, analytics, …) so they can never disagree about
     * which kernel a request belongs to.
     */
    private async resolveRequestEnvironmentId(environmentId?: string, req?: any): Promise<string | undefined> {
        if (environmentId) return environmentId;
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
        // Mirror resolveProtocol's fallback chain so unscoped routes (single-
        // project dev servers, hostname-routed multi-tenants, X-Environment-Id
        // headers) can still pick up per-project translation bundles.
        if (!environmentId && req && this.envRegistry && this.kernelManager) {
            const host = this.extractHostname(req);
            if (host) {
                try {
                    const result = await this.resolveHostnameCached(host);
                    if (result?.environmentId) environmentId = result.environmentId;
                } catch { /* fall through */ }
            }
            if (!environmentId && typeof this.envRegistry.resolveById === 'function') {
                const headerVal = this.extractProjectIdHeader(req);
                if (headerVal) {
                    try {
                        const driver = await this.envRegistry.resolveById(headerVal);
                        if (driver) environmentId = headerVal;
                    } catch { /* fall through */ }
                }
            }
        }
        if (!environmentId && this.defaultEnvironmentIdProvider) {
            try {
                const def = this.defaultEnvironmentIdProvider();
                if (def) environmentId = def;
            } catch { /* fall through */ }
        }
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
     * Reject anonymous requests with HTTP 401 when `api.requireAuth` is set.
     * Returns `true` if the response was sent and the caller should stop
     * processing. Returns `false` to continue.
     *
     * The check is intentionally narrow: only `context?.userId` counts as
     * "authenticated". `isSystem` flags are never set on inbound HTTP
     * requests (they're internal-only), so they cannot bypass this gate.
     */
    private enforceAuth(req: any, res: any, context: any): boolean {
        // ADR-0069 — authentication-policy gate (password expiry, enforced MFA).
        // Independent of `requireAuth`: a gated session (carrying `authGate`) is
        // blocked from protected resources, while the core allow-list keeps auth
        // + remediation reachable. Runs before the anonymous check.
        const gate = context?.authGate;
        if (gate && req?.method !== 'OPTIONS' && !isAuthGateAllowlisted(req?.path)) {
            res.status(403).json({ error: { code: gate.code, message: gate.message } });
            return true;
        }
        // Shared anonymous-deny decision (#2567). Pass no `path`: the REST
        // control-plane routes are registered WITHOUT `enforceAuth`, so this
        // seam only ever guards data/meta — deny unconditionally when anonymous,
        // exactly as before (the allowlist is reserved for a future umbrella
        // seam). `isSystem` is never set on inbound HTTP, so it cannot bypass.
        if (shouldDenyAnonymous({
            requireAuth: this.config.api.requireAuth,
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
     * no `apiMethods` whitelist) behave exactly as before — no regression. Unknown
     * objects fall through to the normal 404 path. A metadata-read failure does not
     * block (the data call itself needs the same metadata and will surface the
     * error). Returns `true` when the request was blocked (response already sent).
     *
     * See ADR-0049 (#1889): shipping a non-enforcing `apiEnabled` is false security.
     */
    private async enforceApiAccess(
        req: any,
        res: any,
        p: RestProtocol,
        environmentId: string | undefined,
        operation: string,
    ): Promise<boolean> {
        const objectName = req?.params?.object;
        if (!objectName) return false;
        let enable: any;
        try {
            const r: any = await (p as any).getMetaItems?.({
                type: 'object',
                ...(environmentId ? { environmentId } : {}),
            });
            const items: any[] = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
            const obj = items.find((o: any) => o?.name === objectName);
            if (!obj) return false; // unknown object → let the data path 404
            enable = obj.enable;
        } catch {
            return false; // metadata unavailable → don't block (data call needs it too)
        }
        if (!enable) return false;
        if (enable.apiEnabled === false) {
            res.status(404).json({
                error: `Object '${objectName}' is not exposed via the API`,
                code: 'OBJECT_API_DISABLED',
                object: objectName,
            });
            return true;
        }
        if (Array.isArray(enable.apiMethods) && enable.apiMethods.length > 0 && !enable.apiMethods.includes(operation)) {
            res.status(405).json({
                error: `API operation '${operation}' is not allowed on object '${objectName}'`,
                code: 'OBJECT_API_METHOD_NOT_ALLOWED',
                object: objectName,
                allowed: enable.apiMethods,
            });
            return true;
        }
        return false;
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
            // The route's protocol resolver already maps hostname → environmentId
            // (see resolveProtocol). We mirror that here so getSession() can
            // find the right per-project auth service. Without this, the
            // hostname-routed requests fall through to defaultEnvironmentIdProvider/
            // authServiceProvider (neither of which is wired in objectos) and
            // every authenticated user sees 401.
            if (!environmentId && req && this.envRegistry && this.kernelManager) {
                const host = this.extractHostname(req);
                if (host) {
                    try {
                        const result = await this.resolveHostnameCached(host);
                        if (result?.environmentId) environmentId = result.environmentId;
                    } catch { /* fall through */ }
                }
                if (!environmentId && typeof this.envRegistry.resolveById === 'function') {
                    const headerVal = this.extractProjectIdHeader(req);
                    if (headerVal) {
                        try {
                            const driver = await this.envRegistry.resolveById(headerVal);
                            if (driver) environmentId = headerVal;
                        } catch { /* fall through */ }
                    }
                }
            }
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
            const authz = await resolveAuthzContext({ ql, headers, getSession });
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
            let authGate: any;
            try {
                if (typeof authService.isAuthGateActive === 'function' && authService.isAuthGateActive()) {
                    const gatedSession: any = await getSession(headers).catch(() => undefined);
                    if (gatedSession?.user?.authGate) authGate = gatedSession.user.authGate;
                }
            } catch { /* gate is best-effort — never break context resolution */ }

            return {
                userId: authz.userId,
                tenantId: authz.tenantId,
                email: authz.email,
                positions: authz.positions,
                permissions: authz.permissions,
                systemPermissions: authz.systemPermissions,
                ...(authz.tabPermissions ? { tabPermissions: authz.tabPermissions } : {}),
                // [ADR-0095 D2 / #2947] Carry the derived posture rung so the
                // enforcement side reads the SAME value the resolver computed,
                // instead of dropping it here (the boundary this issue closes).
                ...(authz.posture ? { posture: authz.posture } : {}),
                isSystem: false,
                org_user_ids: authz.org_user_ids,
                ...(authGate ? { authGate } : {}),
                ...(localization.timezone ? { timezone: localization.timezone } : {}),
                ...(localization.locale ? { locale: localization.locale } : {}),
                ...(localization.currency ? { currency: localization.currency } : {}),
                // Internal: resolved kernel so the nav-serving path can probe
                // requiresService capability gates (ADR-0057 D10). NOT an
                // authorization input — never read by RLS/permission logic.
                __kernel: kernel,
            } as any;
        } catch {
            return undefined;
        }
    }

    /**
     * Filter an `App` metadata item by the current user's `systemPermissions`.
     *
     * - Drops the app entirely if its top-level `requiredPermissions` are not
     *   a subset of the user's system permissions.
     * - Recursively strips child navigation entries (groups, items) whose
     *   `requiredPermissions` are not satisfied. Empty groups collapse so
     *   the sidebar doesn't render a label with no children.
     *
     * Returns `null` when the app should be hidden from the user. Returns a
     * shallow copy with a filtered `navigation` tree otherwise — the original
     * is never mutated so cached metadata stays clean.
     */
    private filterAppForUser(item: any, sysPerms: Set<string>, serviceGate?: (name: string) => boolean): any | null {
        if (!item || typeof item !== 'object') return item;
        // getMetaItem returns an envelope { type, name, item: <app>, ... } while the
        // list path passes the raw app. Unwrap + re-wrap so gating runs on both —
        // filtering the envelope directly is a silent no-op (its .navigation is
        // undefined), which would bypass BOTH requiredPermissions and the ADR-0057
        // D10 requiresService gate.
        if (isMetaEnvelope(item)) {
            const body = this.filterAppForUser((item as any).item, sysPerms, serviceGate);
            return body == null ? null : { ...(item as any), item: body };
        }
        // ADR-0045: an unpublished app (`hidden: true`) is externally
        // unobservable — only builders (studio/setup access) receive it at all,
        // for direct-URL preview. The launcher's client-side hidden filter is a
        // listing courtesy; THIS is the visibility gate.
        if (item.hidden === true && !sysPerms.has('studio.access') && !sysPerms.has('setup.access')) {
            return null;
        }
        const reqApp = Array.isArray(item.requiredPermissions) ? item.requiredPermissions : [];
        if (reqApp.length > 0 && !reqApp.every((p: string) => sysPerms.has(p))) {
            return null;
        }
        // ADR-0057 D10 — capability gate: hide when the named kernel service is
        // absent. Fail-open when the gate can't be probed (serviceGate undefined).
        if (typeof item.requiresService === 'string' && serviceGate && serviceGate(item.requiresService) === false) {
            return null;
        }
        const nav = Array.isArray(item.navigation) ? item.navigation : null;
        if (!nav) return item;

        const filterNav = (entries: any[]): any[] => {
            const out: any[] = [];
            for (const e of entries) {
                if (!e || typeof e !== 'object') continue;
                const req = Array.isArray(e.requiredPermissions) ? e.requiredPermissions : [];
                if (req.length > 0 && !req.every((p: string) => sysPerms.has(p))) continue;
                if (typeof e.requiresService === 'string' && serviceGate && serviceGate(e.requiresService) === false) continue;
                if (Array.isArray(e.children) && e.children.length > 0) {
                    const kids = filterNav(e.children);
                    // Drop empty groups so the sidebar doesn't render a label
                    // with nothing under it (matches AppSidebar UX).
                    if (e.type === 'group' && kids.length === 0) continue;
                    out.push({ ...e, children: kids });
                } else {
                    out.push(e);
                }
            }
            return out;
        };

        return { ...item, navigation: filterNav(nav) };
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
     */
    private filterDashboardForUser(item: any, serviceGate?: (name: string) => boolean): any {
        if (!item || typeof item !== 'object' || !serviceGate) return item;
        if (isMetaEnvelope(item)) {
            const body = this.filterDashboardForUser((item as any).item, serviceGate);
            return body === (item as any).item ? item : { ...(item as any), item: body };
        }
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
            if (isMetaEnvelope(e)) { walk((e as any).item); return; }
            if (typeof e.requiresService === 'string') wanted.add(e.requiresService);
            const kids = Array.isArray(e.navigation) ? e.navigation
                : Array.isArray(e.children) ? e.children
                // Dashboard widgets carry their own `requiresService` gate.
                : Array.isArray(e.widgets) ? e.widgets : null;
            if (kids) for (const k of kids) walk(k);
        };
        for (const it of items) walk(it);
        if (wanted.size === 0) return new Set();
        const registered = new Set<string>();
        for (const name of wanted) { if (await probe(name)) registered.add(name); }
        return registered;
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
        if (typeof header === 'string' && header.length > 0) {
            const top = header.split(',')[0]?.split(';')[0]?.trim();
            if (top) return top;
        }
        const queryLocale = req?.query?.locale;
        if (typeof queryLocale === 'string' && queryLocale.length > 0) return queryLocale;
        if (i18n && typeof i18n.getDefaultLocale === 'function') {
            const def = i18n.getDefaultLocale();
            if (typeof def === 'string' && def.length > 0) return def;
        }
        return undefined;
    }

    /**
     * Translate a single metadata document (view or action) when an i18n
     * service is registered for the request's project and the requested
     * locale yields a match. Falls through unchanged for unsupported types
     * or missing translations.
     */
    private async translateMetaItem(req: any, type: string, environmentId: string | undefined, item: any, i18nService?: any): Promise<any> {
        if (!item || typeof item !== 'object') return item;
        if (!TRANSLATABLE_META_TYPES.has(type)) return item;
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
        // `getMetaItem` returns an envelope `{ type, name, item, lock, ... }`
        // whose translatable document is nested at `.item`; the cached read
        // path hands us the already-unwrapped document. Translate whichever
        // shape we received — nav/field labels live on the inner doc, so
        // translating the envelope's top level (which has no `navigation`)
        // would leave the menu untranslated.
        if (isMetaEnvelope(item)) {
            return { ...item, item: translateMetadataDocument(type, item.item, bundle, { locale }) };
        }
        return translateMetadataDocument(type, item, bundle, { locale });
    }

    /**
     * Translate a list of metadata documents using `translateMetaItem`.
     */
    private async translateMetaItems(req: any, type: string, environmentId: string | undefined, items: any): Promise<any> {
        if (!TRANSLATABLE_META_TYPES.has(type)) return items;
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
        const translated = arr.map((item) =>
            isMetaEnvelope(item)
                ? { ...item, item: translateMetadataDocument(type, item.item, bundle, { locale }) }
                : translateMetadataDocument(type, item, bundle, { locale }),
        );
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
                requireAuth: (api as any).requireAuth ?? true, // secure-by-default (ADR-0056 D2; mirrors RestApiConfigSchema)
                documentation: api.documentation,
                responseFormat: api.responseFormat,
            },
            crud: {
                operations: crud.operations ?? {
                    create: true,
                    read: true,
                    update: true,
                    delete: true,
                    list: true,
                },
                patterns: crud.patterns,
                dataPrefix: crud.dataPrefix ?? '/data',
                objectParamStyle: crud.objectParamStyle ?? 'path',
            },
            metadata: {
                prefix: metadata.prefix ?? '/meta',
                enableCache: metadata.enableCache ?? true,
                cacheTtl: metadata.cacheTtl ?? 3600,
                endpoints: metadata.endpoints ?? {
                    types: true,
                    items: true,
                    item: true,
                    schema: true,
                },
            },
            batch: {
                maxBatchSize: batch.maxBatchSize ?? 200,
                enableBatchEndpoint: batch.enableBatchEndpoint ?? true,
                operations: batch.operations ?? {
                    createMany: true,
                    updateMany: true,
                    deleteMany: true,
                    upsertMany: true,
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
     * Get the full API base path
     */
    private getApiBasePath(): string {
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
                        // advertise `mcp` (single source: isMcpServerEnabled).
                        if (isMcpServerEnabled()) {
                            const unscopedBase = isScoped
                                ? basePath.replace(/\/(environments|projects)\/:environmentId$/, '')
                                : basePath;
                            (discovery.routes as any).mcp = `${unscopedBase}/mcp`;
                        } else {
                            delete (discovery.routes as any).mcp;
                        }

                        // Align auth route with the versioned base path if present.
                        // Auth is a control-plane concern, so use the unscoped base.
                        if (discovery.routes.auth) {
                            const unscopedBase = isScoped
                                ? basePath.replace(/\/projects\/:environmentId$/, '')
                                : basePath;
                            discovery.routes.auth = `${unscopedBase}/auth`;
                        }
                    }

                    // Attach scoping metadata so clients can detect dual-mode routing.
                    (discovery as any).scoping = {
                        enabled: this.config.api.enableProjectScoping,
                        resolution: this.config.api.projectResolution,
                        scoped: isScoped,
                        environmentId: isScoped ? req.params?.environmentId : undefined,
                    };

                    res.json(discovery);
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
     *   - paths                    — `{object}` placeholders expanded into
     *                                one concrete path per registered object
     *                                from the protocol's discovery metadata
     *
     * The base spec is loaded lazily from @objectstack/spec/openapi.json
     * (shipped pre-generated by spec's build pipeline) so we don't pay
     * the cost of regenerating on every request, and a missing or
     * malformed file degrades to a stub instead of crashing.
     */
    private registerOpenApiEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/environments/:environmentId');

        const openApiHandler = async (req: any, res: any) => {
            try {
                const spec = await this.loadOpenApiSpec();
                if (!spec) {
                    res.status?.(503);
                    res.json({
                        error: 'openapi_unavailable',
                        message: 'OpenAPI spec is not bundled with this runtime.',
                    });
                    return;
                }

                // Clone shallowly so per-request mutations (server URL,
                // expanded paths) don't bleed into the cached base spec.
                const enriched: any = { ...spec, servers: [...(spec.servers ?? [])] };

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

                // 2) Expand `{object}` path placeholders into concrete
                //    routes for every registered data object. Falls back
                //    silently if discovery isn't available.
                try {
                    const environmentId = isScoped ? req.params?.environmentId : undefined;
                    const protocol = await this.resolveProtocol(environmentId, req);
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
     * Register the metadata routes behind the SAME `requireAuth` gate the
     * `/data` routes use.
     *
     * `registerMetadataEndpoints` builds ~17 `/meta/*` routes but — unlike the
     * `/data` handlers — never calls {@link enforceAuth}: its handlers assumed
     * the `requireAuth` gate rejected anonymous callers "upstream", yet nothing
     * upstream covers `/meta`, so on a `requireAuth` deployment an anonymous
     * caller could read object / field schemas. On a tenant-less runtime host
     * those are SYSTEM-object schemas and the host is publicly reachable — a
     * real leak.
     *
     * Rather than add the gate to every handler (and have the next new route
     * forget it — the exact failure mode that caused this), wrap the route
     * registrar for the duration of registration so every meta route, present
     * and future, inherits it. The check is a no-op when `requireAuth` is off
     * (demo / single-tenant), so the previously-public metadata surface there
     * is unchanged; an authenticated user passes exactly as on `/data`.
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
                        if (this.enforceAuth(req, res, context)) return;
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
        if (metadata.endpoints.types !== false) {
            this.routeManager.register({
                method: 'GET',
                path: metaPath,
                handler: async (req: any, res: any) => {
                    try {
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);
                        const types = await p.getMetaTypes();
                        const translated = await this.translateMetaTypesResponse(req, environmentId, types);
                        res.header('Vary', 'Accept-Language');
                        res.json(translated);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
                    }
                },
                metadata: {
                    summary: 'List all metadata types',
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
                                error: 'not_implemented',
                                message: 'protocol.getMetaDiagnostics() is not available in this kernel',
                            });
                            return;
                        }
                        const severityParam = (req.query?.severity as string | undefined) ?? 'error';
                        const severity = severityParam === 'warning' ? 'warning' : 'error';
                        const result = await (p as any).getMetaDiagnostics({
                            type: (req.query?.type as string | undefined) || undefined,
                            severity,
                            packageId: (req.query?.package as string | undefined) || undefined,
                        });
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
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
                        const p = await this.resolveProtocol(environmentId, req);
                        if (typeof (p as any).listDrafts !== 'function') {
                            res.status(501).json({
                                error: 'not_implemented',
                                message: 'protocol.listDrafts() is not available in this kernel',
                            });
                            return;
                        }
                        const result = await (p as any).listDrafts({
                            packageId: (req.query?.packageId as string | undefined) || undefined,
                            type: (req.query?.type as string | undefined) || undefined,
                        });
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
                    }
                },
                metadata: {
                    summary: 'List pending draft metadata items',
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
                        // the existing `requireAuth` gate (when enabled) blocks
                        // them upstream; when disabled, the demo / public
                        // surface keeps its prior behaviour.
                        //
                        // `getMetaItems` is typed as `{type, items[]}` but the
                        // objectql implementation actually returns the raw
                        // array. Handle both shapes defensively.
                        let visible: any = items;
                        if (req.params.type === 'app') {
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
                                    const filtered = list
                                        .map((it: any) => this.filterAppForUser(it, sysPerms, serviceGate))
                                        .filter((it: any) => it != null);
                                    visible = Array.isArray(raw)
                                        ? filtered
                                        : { ...(raw as any), items: filtered };
                                }
                            }
                        }

                        // ADR-0057 D10: gate dashboard widgets by `requiresService`
                        // the same way app nav entries are gated above.
                        if (req.params.type === 'dashboard') {
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
                        if (req.params.type === 'view' && req.query?.object) {
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
                        if (req.params.type === 'book') {
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
                        if (req.params.type === 'doc') {
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
                        if (req.params.type === 'doc') {
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
                        if (req.params.type === 'doc' && req.query?.include !== 'content') {
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

                        const translated = await this.translateMetaItems(req, req.params.type, environmentId, visible);
                        res.header('Vary', 'Accept-Language');
                        res.json(translated);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
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
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata items that reference this item',
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
                                sendError(res, { code: 'unauthorized', message: 'This documentation requires sign-in', status: 401 });
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
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
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
                        const environmentId = isScoped ? req.params?.environmentId : undefined;
                        const p = await this.resolveProtocol(environmentId, req);

                        // Phase 3a-layered-get: opt-in 3-state view when client
                        // asks for `?layers=true` (or any non-empty value).
                        // Skips the cache path entirely — layered view is a
                        // diagnostic endpoint, not on the hot read path.
                        const wantLayered = req.query?.layers !== undefined && req.query?.layers !== '';
                        if (wantLayered && typeof (p as any).getMetaItemLayered === 'function') {
                            // ADR-0048 — thread `?package=` so the layered (Studio
                            // editor) view is package-scoped; the editor passes the
                            // edited item's owning package, not the studio app's.
                            const layeredPackageId = req.query?.package || undefined;
                            const layered = await (p as any).getMetaItemLayered({
                                type: req.params.type,
                                name: req.params.name,
                                ...(layeredPackageId ? { packageId: layeredPackageId } : {}),
                                ...(environmentId ? { environmentId } : {}),
                            });
                            res.json(layered);
                            return;
                        }

                        // Check if cached version is available.
                        // For `app` metadata we skip the cache path so the
                        // per-user RBAC filter below can apply without
                        // corrupting shared ETags across admin vs member
                        // viewers of the same app schema. Drafts also
                        // bypass cache: the cache is keyed on the
                        // published checksum and drafts are out-of-band.
                        const isAppType = req.params.type === 'app';
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
                        if (metadata.enableCache && p.getMetaItemCached && !isAppType && !isDraftRead && !previewDrafts && !packageScoped && req.params.type !== 'doc' && req.params.type !== 'book') {
                            const cacheRequest = {
                                ifNoneMatch: req.headers['if-none-match'] as string,
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

                            // Set cache headers
                            if (result.etag) {
                                const etagValue = result.etag.weak
                                    ? `W/"${result.etag.value}"`
                                    : `"${result.etag.value}"`;
                                res.header('ETag', etagValue);
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
                            res.json(await this.translateMetaItem(req, req.params.type, environmentId, result.data, cacheI18n));
                        } else {
                            // Non-cached version
                            const packageId = req.query?.package || undefined;
                            const stateParam = typeof req.query?.state === 'string'
                                ? req.query.state.toLowerCase()
                                : undefined;
                            const item = await p.getMetaItem({
                                type: req.params.type,
                                name: req.params.name,
                                packageId,
                                ...(stateParam === 'draft' ? { state: 'draft' } : {}),
                                ...(previewDrafts ? { previewDrafts: true } : {}),
                            } as any);

                            // Same per-user RBAC filtering as the list endpoint:
                            // for `app` items, drop entirely (404) when the user
                            // lacks the app's `requiredPermissions`, and strip
                            // forbidden nav entries from the returned schema.
                            let visible: any = item;
                            if (isAppType && item) {
                                const ctx = await this.resolveExecCtx(environmentId, req).catch(() => undefined);
                                if (ctx?.userId) {
                                    const sysPerms = new Set<string>(
                                        Array.isArray(ctx.systemPermissions) ? ctx.systemPermissions : [],
                                    );
                                    const registered = await this.resolveRegisteredServices((ctx as any).__kernel, [item]);
                                    const serviceGate = registered ? (n: string) => registered.has(n) : undefined;
                                    visible = this.filterAppForUser(item, sysPerms, serviceGate);
                                    if (visible == null) {
                                        res.status(404).json({
                                            error: 'not_found',
                                            message: 'Metadata item not found or access denied.',
                                        });
                                        return;
                                    }
                                }
                            }

                            // ADR-0057 D10: gate dashboard widgets by `requiresService`
                            // (mirrors the app-nav gate above) so the console never
                            // renders a tile bound to an absent optional service.
                            if (req.params.type === 'dashboard' && visible) {
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
                            if ((req.params.type === 'book' || req.params.type === 'doc') && visible) {
                                const { audienceAllows, docAudienceAllows, resolveDocAudiences } =
                                    await import('@objectstack/spec/system');
                                const target = isMetaEnvelope(visible) ? (visible as any).item : visible;
                                let caller: { authenticated: boolean; permissionSets?: string[] };
                                let allowed: boolean;
                                if (req.params.type === 'book') {
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
                                        sendError(res, { code: 'unauthorized', message: 'This documentation requires sign-in', status: 401 });
                                    } else {
                                        sendError(res, { code: 'PERMISSION_DENIED', message: 'This documentation is limited to holders of a permission set you do not have', status: 403 });
                                    }
                                    return;
                                }
                            }

                            // ADR-0046 i18n: collapse the doc to the request
                            // locale (label/description/content) and drop the
                            // `translations` map so consumers get one body.
                            if (req.params.type === 'doc' && visible) {
                                const locale = this.extractLocale(req);
                                const { resolveDocLocale } = await import('@objectstack/spec/system');
                                visible = isMetaEnvelope(visible)
                                    ? { ...visible, item: resolveDocLocale(visible.item as any, locale) }
                                    : resolveDocLocale(visible as any, locale);
                            }

                            res.header('Vary', 'Accept-Language');
                            res.json(await this.translateMetaItem(req, req.params.type, environmentId, visible));
                        }
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
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
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!p.saveMetaItem) {
                        res.status(501).json({ error: 'Save operation not supported by protocol implementation' });
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
                    const actorHeader = req.headers?.['x-actor'] ?? req.headers?.['X-Actor']
                        ?? req.user?.id ?? req.userId;
                    const actor = typeof actorHeader === 'string' ? actorHeader : undefined;
                    // Phase 3a-destructive: `?force=true` opts past the
                    // destructive-change safety check. Accept any truthy
                    // string ('true', '1', 'yes') for resilience.
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
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!(p as any).deleteMetaItem) {
                        res.status(501).json({
                            error: 'Reset operation not supported by protocol implementation',
                        });
                        return;
                    }
                    // Mirror saveMetaItem's OCC + actor plumbing (ADR-0008
                    // PR-10d wiring): `If-Match` pins the expected current
                    // version so concurrent edits get a 409 instead of a
                    // silent reset; `X-Actor` (or req.user) flows into the
                    // history tombstone row.
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const parentVersion = typeof ifMatchHeader === 'string'
                        ? ifMatchHeader.replace(/^"|"$/g, '')
                        : undefined;
                    const actorHeader = req.headers?.['x-actor'] ?? req.headers?.['X-Actor']
                        ?? req.user?.id ?? req.userId;
                    const actor = typeof actorHeader === 'string' ? actorHeader : undefined;

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
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
                    const limit = req.query?.limit !== undefined
                        ? Number(req.query.limit)
                        : undefined;
                    const result = await (p as any).auditMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        ...(environmentId ? { environmentId } : {}),
                        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
                    const actorHeader = req.headers?.['x-actor'] ?? req.headers?.['X-Actor']
                        ?? req.user?.id ?? req.userId;
                    const actor = typeof actorHeader === 'string' ? actorHeader : undefined;
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
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
                    const body = (req.body && typeof req.body === 'object') ? req.body : {};
                    const toVersionRaw = body.toVersion ?? body.version ?? req.query?.toVersion;
                    const toVersion = Number(toVersionRaw);
                    if (!Number.isFinite(toVersion) || toVersion < 1) {
                        res.status(400).json({
                            error: `'toVersion' (positive integer) is required`,
                            code: 'invalid_request',
                        });
                        return;
                    }
                    const actorHeader = req.headers?.['x-actor'] ?? req.headers?.['X-Actor']
                        ?? req.user?.id ?? req.userId;
                    const actor = typeof actorHeader === 'string' ? actorHeader : undefined;
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
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
                }
            },
            metadata: {
                summary: 'Diff two metadata versions (from/to query params; omit for previous-vs-current)',
                tags: ['metadata'],
            },
        });

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
                        const packageId = req.query?.package || undefined;
                        const item = await p.getMetaItem({
                            type: req.params.type,
                            name: compoundName,
                            packageId,
                        } as any);
                        res.header('Vary', 'Accept-Language');
                        res.json(await this.translateMetaItem(req, req.params.type, environmentId, item));
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
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
                    const p = await this.resolveProtocol(environmentId, req);
                    if (!p.saveMetaItem) {
                        res.status(501).json({ error: 'Save operation not supported by protocol implementation' });
                        return;
                    }

                    const compoundName = `${req.params.section}/${req.params.name}`;
                    const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                    const parentVersion = typeof ifMatchHeader === 'string'
                        ? ifMatchHeader.replace(/^"|"$/g, '')
                        : undefined;
                    const actorHeader = req.headers?.['x-actor'] ?? req.headers?.['X-Actor']
                        ?? req.user?.id ?? req.userId;
                    const actor = typeof actorHeader === 'string' ? actorHeader : undefined;

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
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
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
                        res.status(501).json({ error: 'UI View resolution not supported by protocol implementation' });
                    }
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error, req.params?.object);
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
                        const result = await p.findData({
                            object: req.params.object,
                            query: req.query,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (isExpectedDataStatus(mapped.status) || mapped.body?.code === 'UNSUPPORTED_QUERY_PARAM') {
                            res.status(mapped.status).json(mapped.body);
                        } else {
                            logError("[REST] Unhandled error:", error);
                            res.status(mapped.status).json(mapped.body);
                        }
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
                        const { select, expand } = req.query || {};
                        const context = await this.resolveExecCtx(environmentId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'get')) return;
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
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
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
                        const result = await p.createData({
                            object: req.params.object,
                            data: req.body,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.status(201).json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
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
                        const result = await p.findData({
                            object: req.params.object,
                            query: req.body || {},
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status)) logError("[REST] Unhandled error:", error);
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
                        const result = await p.updateData({
                            object: req.params.object,
                            id: req.params.id,
                            data,
                            ...(expectedVersion ? { expectedVersion: String(expectedVersion) } : {}),
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
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
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
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
                    // carry an explicit `.status`; fall back to mapDataError for
                    // driver/validation faults. Only log genuine server faults.
                    const status = typeof error?.status === 'number'
                        ? error.status
                        : mapDataError(error, req.params?.object).status;
                    if (!isExpectedDataStatus(status) && error?.code !== 'VALIDATION_FAILED') logError('[REST] Unhandled error:', error);
                    sendError(res, error, req.params?.object);
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

                    // Delegate the per-row coercion + upsert loop to the shared
                    // runner (also used by the async import-job worker).
                    const summary = await runImport({
                        p, objectName, environmentId, context, ...prep.prepared,
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
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, String(req.params?.object || ''));
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
                        created_at: createdAt,
                        ...(createdBy ? { created_by: createdBy } : {}),
                    };

                    try {
                        await (p as any).createData({ object: IMPORT_JOB_OBJECT, data: jobRow, context, ...(environmentId ? { environmentId } : {}) });
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
                            await (p as any).updateData({ object: IMPORT_JOB_OBJECT, id: jobId, data, context, ...(environmentId ? { environmentId } : {}) });
                        } catch (err) {
                            logError('[REST] import job progress write failed:', err);
                        }
                    };
                    // Record undo instructions for small non-dry-run jobs so the
                    // import can be logically rolled back later.
                    const captureUndo = !prepared.dryRun && prepared.rows.length <= IMPORT_JOB_UNDO_MAX_ROWS;
                    void (async () => {
                        await patch({ status: 'running', started_at: new Date().toISOString() });
                        try {
                            const summary = await runImport({
                                p, objectName, environmentId, context, ...prepared,
                                captureUndo,
                                progressEvery: 200,
                                onProgress: (pr) => patch({
                                    processed_rows: pr.processed,
                                    created_count: pr.created,
                                    updated_count: pr.updated,
                                    skipped_count: pr.skipped,
                                    error_count: pr.errors,
                                }),
                                shouldCancel: () => this.cancelledImportJobs.has(jobId),
                            });
                            await patch({
                                status: summary.cancelled ? 'cancelled' : 'succeeded',
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
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, String(req.params?.object || ''));
                }
            },
            metadata: {
                summary: 'Create an asynchronous import job (large files, up to 50k rows)',
                tags: ['data', 'import'],
            },
        });

        // Shared loader for the read routes: fetch one job row by id.
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
                            await (p as any).updateData({ object: IMPORT_JOB_OBJECT, id: jobId, data: { status: 'cancelled', completed_at: new Date().toISOString() }, context, ...(environmentId ? { environmentId } : {}) });
                        } catch { /* worker will still stop via the in-memory flag */ }
                    }
                    res.json({ success: true });
                } catch (error: any) {
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, '');
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
                    const writeCtx = { ...(context ?? {}), skipAutomations: true };
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
                        context, ...(environmentId ? { environmentId } : {}),
                    });
                    res.json({ success: true, jobId, object: objectName, deleted, restored, failed });
                } catch (error: any) {
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, '');
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
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, '');
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
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, '');
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
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, '');
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
                            res.status(400).json({ code: 'INVALID_REQUEST', error: 'filter must be JSON' });
                            return;
                        }
                    } else if (q.filter && typeof q.filter === 'object') {
                        filter = q.filter;
                    }

                    let orderby: any = undefined;
                    if (typeof q.orderby === 'string' && q.orderby.length > 0) {
                        // Accept "field:dir,field2:dir" shorthand or a JSON object.
                        if (q.orderby.startsWith('{') || q.orderby.startsWith('[')) {
                            try { orderby = JSON.parse(q.orderby); } catch { /* leave undefined */ }
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
                        // map. The read hands back an envelope `{ type, name, item }`;
                        // the schema document lives at `.item` (a cached/bare read may
                        // already be unwrapped). Legacy `getObjectSchema` is consulted
                        // as a last resort so existing test doubles keep working.
                        let schema: any = undefined;
                        if (typeof (p as any).getMetaItem === 'function') {
                            const res = await (p as any).getMetaItem({ type: 'object', name: objectName });
                            schema = isMetaEnvelope(res) ? res.item : res;
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
                            if (names.length > 0) fields = names;
                        }
                    } catch { /* fall back to first-row derivation + raw values */ }

                    // Expand reference fields so lookup/user ids resolve to their record
                    // (and thus a name). Batched $in inside findData — no N+1.
                    const expandFields = referenceFieldNames(metaMap);

                    // Prepare streaming response. Set headers BEFORE first write.
                    if (format === 'csv') {
                        res.header('Content-Type', 'text/csv; charset=utf-8');
                    } else if (format === 'xlsx') {
                        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    } else {
                        res.header('Content-Type', 'application/json; charset=utf-8');
                    }
                    res.header('Content-Disposition', exportContentDisposition(objectName, objectLabel, format));
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

                        if (format === 'csv') {
                            const text = rowsToCsv(fields ?? [], rows, firstChunk && includeHeader, metaMap);
                            res.write(text);
                        } else if (format === 'xlsx') {
                            if (firstChunk && includeHeader) {
                                xlsx!.ws.addRow((fields ?? []).map((f) => headerLabel(f, metaMap))).commit();
                            }
                            const cols = fields ?? [];
                            for (const row of rows) {
                                const r = xlsx!.ws.addRow(formatRowCells(row, cols, metaMap));
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
                                res.write(prefix + JSON.stringify(formatRowForJson(rows[i], metaMap)));
                            }
                        }
                        firstChunk = false;
                        exported += rows.length;
                        skip += rows.length;
                        if (rows.length < take) break;
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
                    logError('[REST] Unhandled error:', error);
                    // Best-effort error envelope; if headers already sent the
                    // client receives a truncated stream which signals failure.
                    try { sendError(res, error, String(req.params?.object || '')); }
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
                    if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== 'VALIDATION_FAILED') {
                        logError('[REST] Unhandled error:', error);
                    }
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
     * Both routes bypass `enforceAuth` even when `requireAuth=true` on the
     * deployment (e.g. ObjectOS multi-tenant). Security is delegated to the
     * `guest_portal` permission set carried on the execution context — the
     * SecurityPlugin enforces INSERT-only access to the target object. If
     * the deployment hasn't registered a `guest_portal` profile, the
     * security middleware falls open with `permissions: []` (no userId),
     * matching the existing anonymous-access semantics; deployers must
     * keep `requireAuth=true` deployments paired with a `guest_portal`
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
                    // Embed the target object's schema (limited to fields
                    // referenced by the form) so anonymous front-ends can
                    // render the form without a separate, auth-protected
                    // meta lookup. The submit handler still enforces the
                    // field whitelist server-side.
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
                                    // don't advertise them here (declared or via
                                    // the zero-sections all-fields expansion).
                                    if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)) continue;
                                    if (allowed.size === 0 || allowed.has(name)) {
                                        fields[name] = def;
                                    }
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
                                        objectSchema = translateMetadataDocument('object', objectSchema, bundle, { locale });
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
                    // [#3022] System-managed anchors (owner_id, organization_id,
                    // audit columns, id, …) are NEVER client-suppliable on this
                    // anonymous surface — not via an explicit section declaration,
                    // and not via the zero-declared-sections fallback below (which
                    // otherwise passes the raw body through and previously let a
                    // visitor forge record ownership). The SecurityPlugin's
                    // publicFormGrant branch strips the same set at the data layer,
                    // so this filter and the engine boundary cannot drift.
                    const rawBody = (req.body && typeof req.body === 'object') ? req.body : {};
                    const filteredData: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(rawBody)) {
                        if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(k)) continue;
                        // JSON.parse yields `__proto__` as an OWN key; assigning it
                        // here would REPLACE filteredData's prototype and smuggle
                        // inherited anchors past every own-property check downstream.
                        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
                        if (allowedFields.size === 0 || allowedFields.has(k)) filteredData[k] = v;
                    }

                    // ADR-0056 (Option A): authorization DERIVED from the declared
                    // form — a narrow create grant scoped to exactly this form's target
                    // object. The SecurityPlugin honors `publicFormGrant` (create + the
                    // immediate read-back, that object ONLY), so public forms work under
                    // secure-by-default (requireAuth) WITHOUT a deployment-configured
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
                    if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== 'VALIDATION_FAILED') {
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
                            referenceTo = def?.referenceTo ?? def?.target ?? def?.options?.objectName;
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
                            sort: picker.sort ?? [{ field: displayFields[0], order: 'asc' }],
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
                    if (!isExpectedDataStatus(mapped.status)) {
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
                    // Dataset-compiler D-C / unsupported-aggregate / read-scope
                    // errors are client-side mistakes — surface as 400.
                    if (/not declared in the dataset|not backed by a declared relationship|not supported by the v1 dataset runtime|read-scope-sql/.test(msg)) {
                        return res.status(400).json({ code: 'DATASET_INVALID', message: msg.slice(0, 1000) });
                    }
                    logError('[REST] Analytics dataset query error:', error);
                    res.status(500).json({ code: 'ANALYTICS_QUERY_FAILED', error: msg.slice(0, 500) });
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
     *   POST {basePath}/security/explain   body: { object, operation, userId? }
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

        const handler = async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;
                if (!context?.userId) {
                    // Even on requireAuth=false deployments the explain surface
                    // stays authenticated-only — it is an admin diagnosis tool.
                    return res.status(401).json({
                        code: 'UNAUTHORIZED',
                        message: 'The access-explanation endpoint requires an authenticated caller.',
                    });
                }

                const svc = await resolveService(environmentId, req);
                if (!svc || typeof svc.explain !== 'function') {
                    return res.status(501).json({
                        code: 'NOT_IMPLEMENTED',
                        message: 'Access explanation is not available on this deployment (no security service with explain).',
                    });
                }

                // GET reads the request from the query string, POST from the
                // body — one contract (ExplainRequestSchema), two transports.
                const src = req.method === 'GET' ? (req.query ?? {}) : (req.body ?? {});
                const { ExplainRequestSchema } = await import('@objectstack/spec/security');
                const parsed = (ExplainRequestSchema as any).safeParse({
                    object: src.object,
                    operation: src.operation ?? 'read',
                    ...(src.userId != null && src.userId !== '' ? { userId: src.userId } : {}),
                    // [C2 / ADR-0095] Optional record id — explains ONE concrete
                    // row at record granularity; omitted stays object-level.
                    ...(src.recordId != null && src.recordId !== '' ? { recordId: src.recordId } : {}),
                });
                if (!parsed.success) {
                    return res.status(400).json({
                        code: 'VALIDATION_FAILED',
                        message: 'Invalid explain request — expected { object: string, operation: read|create|update|delete|transfer|restore|purge, userId?: string, recordId?: string }.',
                        detail: String(parsed.error?.message ?? '').slice(0, 1000),
                    });
                }

                const decision = await svc.explain(parsed.data, context);
                res.json(decision);
            } catch (error: any) {
                const msg = String(error?.message ?? error ?? '');
                if (
                    error?.code === 'PERMISSION_DENIED' ||
                    error?.name === 'PermissionDeniedError' ||
                    msg.startsWith('[Security] Access denied')
                ) {
                    return res.status(403).json({ code: 'PERMISSION_DENIED', message: msg.slice(0, 1000) });
                }
                logError('[REST] Security explain error:', error);
                res.status(500).json({ code: 'EXPLAIN_FAILED', error: msg.slice(0, 500) });
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
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Sharing service is not configured on this deployment',
        });

        // GET — list shares on a record.
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
                    logError('[REST] List shares error:', error);
                    res.status(500).json({ code: 'SHARES_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List per-record sharing grants', tags: ['sharing'] },
        });

        // POST — grant access.
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
                    try {
                        const row = await svc.grant(input, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        const msg = String(err?.message ?? err ?? '');
                        if (msg.startsWith('VALIDATION_FAILED')) {
                            res.status(400).json({
                                code: 'VALIDATION_FAILED',
                                error: msg.replace(/^VALIDATION_FAILED:\s*/, ''),
                            });
                            return;
                        }
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Grant share error:', error);
                    res.status(500).json({ code: 'SHARE_GRANT_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Grant a per-record share to a principal', tags: ['sharing'] },
        });

        // DELETE — revoke a share by id.
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
                    await svc.revoke(req.params.shareId, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
                    logError('[REST] Revoke share error:', error);
                    res.status(500).json({ code: 'SHARE_REVOKE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
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
            if (msg.startsWith('RULE_NOT_FOUND')) {
                return res.status(404).json({ code: 'RULE_NOT_FOUND', error: msg.replace(/^RULE_NOT_FOUND:?\s*/, '') });
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
                    const input = {
                        name: body.name,
                        label: body.label,
                        description: body.description,
                        object: body.object ?? body.object_name,
                        criteria: body.criteria,
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
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Security service is not configured on this deployment',
        });
        const handleError = (err: any, res: any, defaultCode: string) => {
            const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
            if (status !== 500) {
                return res.status(status).json({ code: err?.code ?? defaultCode, error: String(err?.message ?? err) });
            }
            logError(`[REST] suggested-bindings ${defaultCode}:`, err);
            return res.status(500).json({ code: defaultCode, error: String(err?.message ?? err).slice(0, 500) });
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
                    const result = await svc.listAudienceBindingSuggestions(context ?? {}, {
                        status: req.query?.status ? String(req.query.status) : undefined,
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
                    await svc.deleteReport(req.params.id, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
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
                    await svc.unscheduleReport(req.params.scheduleId, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
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

        // POST /batch — cross-object transactional batch (issue #1604).
        // Runs heterogeneous create/update/delete across objects in ONE engine
        // transaction (commit all or roll back all). Intra-batch references:
        // a field value of `{ $ref: <earlier op index> }` resolves to that op's
        // created id, so a child can reference its parent (master-detail).
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
                        res.status(501).json({ error: 'Transactional batch not supported by this runtime' });
                        return;
                    }
                    const ops: any[] = Array.isArray(req.body?.operations) ? req.body.operations : [];
                    const max = batch.maxBatchSize ?? 200;
                    if (ops.length === 0) { res.json({ results: [] }); return; }
                    if (ops.length > max) { res.status(400).json({ error: `Batch too large (max ${max})` }); return; }

                    const resolveRefs = (data: any, out: any[]): any => {
                        if (!data || typeof data !== 'object') return data;
                        const result: any = Array.isArray(data) ? [] : {};
                        for (const [k, v] of Object.entries(data)) {
                            if (v && typeof v === 'object' && '$ref' in (v as any)) {
                                const ref = out[(v as any).$ref];
                                result[k] = (ref && (ref.id ?? ref._id)) ?? null;
                            } else {
                                result[k] = v;
                            }
                        }
                        return result;
                    };

                    const results = await ql.transaction(async (trxCtx: any) => {
                        const out: any[] = [];
                        for (const op of ops) {
                            const action = String(op?.action || 'create');
                            const object = String(op?.object || '');
                            if (!object) throw new Error('Each operation requires an `object`');
                            const data = resolveRefs(op.data, out);
                            if (action === 'create') {
                                out.push(await ql.insert(object, data, { context: trxCtx }));
                            } else if (action === 'update') {
                                const id = op.id ?? data?.id;
                                out.push(await ql.update(object, { ...data, id }, { context: trxCtx }));
                            } else if (action === 'delete') {
                                out.push(await ql.delete(object, { where: { id: op.id }, context: trxCtx }));
                            } else {
                                throw new Error(`Unknown batch action: ${action}`);
                            }
                        }
                        return out;
                    }, context);

                    res.json({ results });
                } catch (error: any) {
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error);
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
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'bulk')) return;
                        const result = await p.batchData!({
                            object: req.params.object,
                            request: req.body,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
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
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'create')) return;
                        const result = await p.createManyData!({
                            object: req.params.object,
                            records: req.body || [],
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.status(201).json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
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
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'update')) return;
                        const result = await p.updateManyData!({
                            object: req.params.object,
                            ...req.body,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
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
                        if (await this.enforceApiAccess(req, res, p, environmentId, 'delete')) return;
                        const result = await p.deleteManyData!({
                            object: req.params.object,
                            ...req.body,
                            ...(environmentId ? { environmentId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
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
     * Get all registered routes
     */
    getRoutes() {
        return this.routeManager.getAll();
    }
}
