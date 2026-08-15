// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { coerceRow, type RefResolver, type RefMatch } from './import-coerce.js';
import type { ExportFieldMeta } from './export-format.js';
import type { ValidationMessageTranslator } from '@objectstack/spec/system';
import type { ValidateDataIssue, ValidateDataRequest, ValidateDataResponse } from '@objectstack/spec/api';
import { bulkWrite, withTransientRetry, defaultIsTransientError, type BulkWriteRowResult } from '@objectstack/core';
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';

/**
 * import-runner — the shared row-processing core for bulk import.
 *
 * Both the synchronous `POST /data/:object/import` route and the asynchronous
 * import-job worker feed rows through {@link runImport}. Extracting the loop
 * keeps the two paths byte-for-byte identical in coercion, upsert matching, and
 * per-row reporting — the async worker only adds progress persistence and
 * cancellation on top.
 *
 * Rows resolved to a CREATE are batched through `p.createManyData` (the
 * engine's array-form `insert()` — one round-trip per batch, with transient
 * retry and per-row degradation on a logical/validation failure) instead of
 * one `p.createData` call per row — see framework#2678. A protocol that
 * doesn't implement `createManyData` falls back to the original per-row
 * `createData` path unchanged.
 *
 * ## The dry run asks; it does not predict (#4633 ruling D)
 *
 * A dry run's contract is that it reports the verdict the real write produces.
 * It used to keep that promise with a hand-copied mirror of a slice of the
 * engine's rules (`import-coerce.ts`), which structurally could not cover the
 * rest of the family — measured on a `Field.address`, where the dry run formed
 * no verdict at all and the write answered `VALIDATION_FAILED`.
 *
 * So the dry-run branch below calls {@link ImportProtocolLike.validateData}
 * (#6037) instead: the engine runs the same `validateRecord` /
 * `evaluateValidationRules` `insert()` runs, under this deployment's own
 * ADR-0104 posture, and persists nothing. Agreement is by construction rather
 * than by a copy kept in step by hand.
 */

export type ImportAction = 'created' | 'updated' | 'skipped' | 'failed';

export interface ImportRowResult {
  row: number;
  ok: boolean;
  action: ImportAction;
  id?: string;
  field?: string;
  error?: string;
  code?: string;
  /**
   * Findings this deployment ADMITS rather than rejects — today, ADR-0104
   * value shapes under a warn-first posture (#4633). The row is `ok`: the
   * write stores it and logs the same complaint. Present on dry-run rows,
   * where they are the difference between "this row is fine" and "this row is
   * fine HERE"; a real write has no equivalent channel to report them on.
   */
  warnings?: ValidateDataIssue[];
}

/** Running tallies handed to {@link RunImportOptions.onProgress}. */
export interface ImportProgress {
  processed: number;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Records exactly what a non-dry-run import changed, so the job can be undone:
 * created records are deleted, and updated records have the touched fields
 * restored to their pre-import values. Only the fields the import wrote are
 * captured (keyed to `before`), keeping the log precise and bounded.
 */
export interface ImportUndoLog {
  /** Ids of records this import created (delete to undo). */
  created: string[];
  /** Per updated record: the touched fields' values *before* the import. */
  updated: Array<{ id: string; before: Record<string, any> }>;
}

export interface ImportRunSummary extends ImportProgress {
  ok: number;
  results: ImportRowResult[];
  cancelled: boolean;
  /** Present only when `captureUndo` was set — the reversal instructions. */
  undoLog?: ImportUndoLog;
}

/** Minimal protocol surface the runner needs (find / create / update). */
export interface ImportProtocolLike {
  findData(args: any): Promise<any>;
  createData(args: any): Promise<any>;
  updateData(args: any): Promise<any>;
  /**
   * Optional bulk-create primitive. When present, `runImport` batches
   * CREATE-resolved rows through it instead of one `createData` call per
   * row — see framework#2678. Must resolve to `{ records: any[] }` with one
   * record per input row, in the same order.
   */
  createManyData?(args: { object: string; records: any[]; context?: any; environmentId?: string }): Promise<{ records: any[] }>;
  /**
   * Optional partial-success bulk create (framework#3172). When present it is
   * preferred over `createManyData`: one outcome per input row, in order — a
   * row that fails validation is a per-row verdict, so a bad row never forces
   * the whole-batch degradation that re-runs beforeInsert hooks on the good
   * rows.
   */
  insertManyData?(args: { object: string; records: any[]; context?: any; environmentId?: string }): Promise<{ outcomes: Array<{ ok: boolean; record?: any; error?: unknown }> }>;
  /**
   * Validate-only (#6037 — #4633 ruling D). The write path's verdict on a
   * candidate row, with nothing persisted. The dry run routes through THIS
   * rather than re-deriving a verdict of its own.
   *
   * Optional for the same reason it is optional on `DataProtocol`: it is
   * additive to a shipped contract. A protocol that omits it is not handed a
   * substitute — the runner does not fabricate a verdict from a copy of the
   * engine's rules, which is the defect this replaced. That is a capability
   * gate, not leniency, and it is the honest answer for a protocol whose write
   * is not the engine's write at all: plugin-auth's identity import creates
   * users through better-auth, so an engine-derived preview would report
   * findings ITS write never produces — a false alarm dressed as coverage.
   * Such a dry run reports coercion + create/update/skip resolution only.
   */
  validateData?(args: ValidateDataRequest & { context?: any; environmentId?: string }): Promise<ValidateDataResponse>;
}

export interface RunImportOptions {
  /** Protocol/engine to read & write through. */
  p: ImportProtocolLike;
  objectName: string;
  environmentId?: string;
  /** Exec context threaded onto reads and (with automation toggle) writes. */
  context?: any;
  /** Already-mapped rows (source columns renamed to target fields). */
  rows: Array<Record<string, any>>;
  /** Field metadata for value coercion (name→id lookups, select codes, …). */
  metaMap: Map<string, ExportFieldMeta>;
  writeMode: 'insert' | 'update' | 'upsert';
  matchFields: string[];
  dryRun: boolean;
  runAutomations: boolean;
  /** #3479 / #3493 — treat rows as established historical facts. The write
   *  context carries `skipStateMachine` (mid-lifecycle values aren't rejected by
   *  the object's `state_machine` `initialStates`/`transitions`) AND
   *  `preserveAudit` (a supplied `updated_at`/`updated_by` and audit/business
   *  `readonly` fields are preserved rather than stamped-now / stripped).
   *  Optional here (runner default is off); `prepareImportRequest` always sets it. */
  treatAsHistorical?: boolean;
  trimWhitespace: boolean;
  nullValues?: string[];
  createMissingOptions: boolean;
  skipBlankMatchKey: boolean;
  /**
   * Progress callback, invoked every {@link RunImportOptions.progressEvery}
   * processed rows and once at the end. May be async; the runner awaits it so a
   * DB write of progress completes before the next chunk.
   */
  onProgress?: (p: ImportProgress) => void | Promise<void>;
  /**
   * Rows between onProgress calls (default 200). Also the flush boundary for
   * buffered creates — a batch never grows past this before being written,
   * so progress numbers stay accurate at every reported checkpoint.
   */
  progressEvery?: number;
  /**
   * Cooperative cancellation. Checked at each progress boundary; when it returns
   * truthy the runner stops and returns `cancelled: true` with partial results.
   */
  shouldCancel?: () => boolean | Promise<boolean>;
  /**
   * When true (and not a dry run), accumulate an {@link ImportUndoLog} so the
   * import can be reverted later. Callers gate this on row count to bound the
   * stored snapshot size.
   */
  captureUndo?: boolean;
  /**
   * `II18nService.t`-compatible lookup so this runner's own messages (cell
   * coercion) resolve a deployment's `validation.field.*` overrides — the same
   * hook the engine gets (#3957). The locale itself rides `context.locale`.
   * Validation verdicts are rendered by the engine, on both halves, so they
   * need no hook here: the dry run's sentences come back already rendered
   * from `validateData` and the write's from `ValidationError`.
   */
  translate?: ValidationMessageTranslator;
}

/** Extracts a created/updated record's id regardless of which response shape the protocol returned. */
function extractRecordId(rec: any): string | undefined {
  const id = rec?.id ?? rec?.record?.id;
  return id != null ? String(id) : undefined;
}

/** Does this text begin with a SQL statement? (leaked driver query builder output) */
function looksLikeSql(text: string): boolean {
  return /^\s*(insert|update|delete|select|with|replace)\s/i.test(text);
}

/** Strip a `table.column` (or quoted) constraint target down to a bare column name. */
function bareColumn(raw: string): string {
  const col = raw.trim().replace(/[`"']/g, '');
  const dot = col.lastIndexOf('.');
  return dot >= 0 ? col.slice(dot + 1) : col;
}

/**
 * The sentence used when the row conflicts but no column is determinable
 * (#6544). Deliberately the same wording `mapDataError` puts in the 409
 * `UNIQUE_VIOLATION` body, so the importer and the API say one thing about one
 * condition rather than two.
 */
const UNNAMED_CONFLICT = 'A record with this value already exists.';

/**
 * Turn a raw write error into a message safe to hand back to the importer.
 *
 * Driver / query-builder errors (knex et al.) embed the *entire* failing SQL
 * statement in `err.message` — e.g. ``insert into `sys_user` (...) values
 * (...) - UNIQUE constraint failed: sys_user.phone_number``. Surfacing that
 * verbatim is both unreadable and an information disclosure of the schema
 * (framework#3566). This maps the common constraint failures to human wording
 * and, as a backstop, never lets a raw SQL statement escape to the client.
 *
 * The unique-violation verdict and the conflicting column both come from
 * `@objectstack/types` (#6544). This site used to carry its own three-dialect
 * regex chain — one of the four private vocabularies #6250 inventoried, which
 * between them disagreed about MySQL. Two consequences of adopting the shared
 * pair, both intended:
 *
 *  - the verdict widens: a conflict recognised only by a channel the old chain
 *    did not read (Postgres' bare constraint name, for one) now gets conflict
 *    wording instead of falling through to the SQL backstop; and
 *  - the *naming* narrows: `uniqueViolationColumn` refuses to answer with an
 *    index name, so **MySQL rows no longer name a column** — they used to name
 *    the index (`for key 'idx_email_unique'`) as if it were one, pointing the
 *    user at a field that does not exist. See that function's doc comment.
 */
export function sanitizeRowError(raw: unknown): string {
  const msg = typeof raw === 'string' ? raw.trim() : '';
  if (!msg) return 'Row failed';

  // UNIQUE — surface the offending column when the dialect determinably named
  // one (it maps to a user-facing import column, so naming it is helpful, not a
  // schema leak); otherwise say so generically rather than guess.
  if (isUniqueViolationError(msg)) {
    const column = uniqueViolationColumn(msg);
    return column ? `A record with this ${column} already exists.` : UNNAMED_CONFLICT;
  }

  // NOT NULL — a required value is missing.
  const notNull = /not null constraint failed:\s*([^\s,)]+)/i.exec(msg);
  if (notNull) return `${bareColumn(notNull[1])} is required.`;

  // Backstop: anything that still reads as a SQL statement must not reach the
  // client. Prefer the driver's trailing reason (after `... - <reason>`) when
  // it is itself not SQL; otherwise fall back to a generic message.
  if (looksLikeSql(msg)) {
    const sep = msg.lastIndexOf(' - ');
    const reason = sep >= 0 ? msg.slice(sep + 3).trim() : '';
    if (reason && !looksLikeSql(reason)) return reason.slice(0, 300);
    return 'The database rejected this row (a value may be invalid or already in use).';
  }

  return msg.slice(0, 300);
}

/**
 * A row report built from a write failure.
 *
 * When the failure is the engine's `ValidationError` it carries `fields[]` —
 * the same `{ field, code, message }` triple `validateData` reports — and the
 * row report is built from it rather than from the wrapper. Two reasons, and
 * the second is the load-bearing one (#4633):
 *
 *  1. It names the offending COLUMN, which is what an import UI highlights. A
 *     bare `VALIDATION_FAILED` with no `field` made the caller re-read the
 *     sentence to find out which cell to fix.
 *  2. It is the same shape the dry run now reports, so the two halves agree
 *     on `field` and `code`, not merely on "this row failed". Before, a
 *     `min: 0` violation was `min_value` on the dry run and `VALIDATION_FAILED`
 *     on the write — an agreement gap hidden inside a report that looked right.
 *
 * `code` therefore speaks one vocabulary across the whole row report: the
 * field-level catalog (ADR-0114) that `coerceRow`'s cell failures already use.
 */
function toFailedResult(rowNo: number, err: unknown): ImportRowResult {
  const e = err as { code?: unknown; message?: unknown; fields?: unknown } | null | undefined;
  const fields = Array.isArray(e?.fields) ? (e.fields as Array<{ field?: unknown; code?: unknown }>) : [];
  const first = fields[0];
  const code = first?.code ?? e?.code ?? 'IMPORT_ROW_FAILED';
  const message = sanitizeRowError(e?.message);
  return {
    row: rowNo, ok: false, action: 'failed', error: message, code: String(code),
    ...(first?.field != null && first.field !== '' ? { field: String(first.field) } : {}),
  };
}

/** Upper bound on rows in one createManyData batch (framework#2678 suggests 100-500). */
const MAX_CREATE_BATCH_SIZE = 200;

/**
 * Yield one macrotask so the host's event loop can service pending I/O.
 * With a synchronous storage driver (better-sqlite3 and the wasm fallback)
 * every `await` in the row loop resolves as a microtask, so a large import
 * otherwise monopolizes the event loop for its whole duration: HTTP cancel
 * and progress requests sit unserviced, and the cooperative `shouldCancel`
 * flag has nobody able to set it (framework#2824).
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });

export function runImport(opts: RunImportOptions): Promise<ImportRunSummary> {
  const {
    p, objectName, environmentId, context, rows, metaMap, translate: messageTranslator,
    writeMode, matchFields, dryRun, runAutomations, treatAsHistorical,
    trimWhitespace, nullValues, createMissingOptions, skipBlankMatchKey,
    onProgress, shouldCancel, captureUndo,
  } = opts;
  const collectUndo = !!captureUndo && !dryRun;
  const undoLog: ImportUndoLog = { created: [], updated: [] };
  // Snapshot only the fields the import touched, so undo restores exactly what
  // changed. A field absent before the import is recorded as null → undo clears
  // it. Never captured on dry runs (nothing was written).
  const captureBefore = (before: Record<string, any>, written: Record<string, any>): Record<string, any> => {
    const snap: Record<string, any> = {};
    for (const k of Object.keys(written)) snap[k] = before[k] ?? null;
    return snap;
  };
  const progressEvery = Math.max(1, opts.progressEvery ?? 200);

  const findRows = (r: any): any[] =>
    Array.isArray(r?.records) ? r.records
      : Array.isArray(r?.data) ? r.data
        : Array.isArray(r?.rows) ? r.rows
          : Array.isArray(r) ? r : [];
  const findArgsBase = (query: any) => ({
    object: '',
    query,
    ...(environmentId ? { environmentId } : {}),
    ...(context ? { context } : {}),
  });

  // Reference resolver: name/email/id → referenced record id. Cached per
  // (object, display) so a name repeated across rows costs one query.
  const refCache = new Map<string, RefMatch>();
  const resolveRef: RefResolver = async (referenceObject, display, meta) => {
    const cacheKey = `${referenceObject}::${display}`;
    const cached = refCache.get(cacheKey);
    if (cached) return cached;
    // Try an exact id first (authoritative + unique when the user pasted an id),
    // then the configured display field, then the usual human identifiers.
    // De-dupe so a field isn't queried twice. The first candidate field to match
    // wins; if that field matches >1 record we stop and report ambiguity rather
    // than silently linking the first.
    const candidates = [...new Set([
      'id',
      ...(meta.displayField ? [meta.displayField] : []),
      'name', 'title', 'label', 'full_name', 'email', 'username',
    ])];
    const lookup = async (): Promise<RefMatch> => {
      let match: RefMatch = {};
      for (const f of candidates) {
        try {
          const r = await p.findData({
            ...findArgsBase({ $filter: { [f]: display }, $top: 2 }),
            object: referenceObject,
          });
          const recs = findRows(r);
          if (recs.length === 0) continue;
          if (recs.length > 1) { match = { ambiguous: true, matchedField: f }; break; }
          if (recs[0]?.id != null) { match = { id: String(recs[0].id), matchedField: f }; break; }
        } catch { /* field absent on target object — try the next candidate */ }
      }
      return match;
    };
    let match = await lookup();
    // A miss may just mean the referenced row is still buffered as a pending
    // create — the same-file "later row references an earlier CREATE" case that
    // the batched-create rework regressed. Flush the buffer and retry the
    // lookup once: the buffered rows are all EARLIER than this one (resolveRef
    // runs mid row-loop), so the flush is safe and, once drained, a no-op.
    // Only a reference to THIS object can be satisfied from the buffer, so we
    // don't flush for a miss on some other object (framework#3148).
    if (!match.id && !match.ambiguous && referenceObject === objectName && pendingCreates.length > 0) {
      await flushPendingCreates();
      match = await lookup();
    }
    // Cache only a definitive verdict. A bare miss ({}) is deliberately NOT
    // cached: the referenced row may be created by a later flush, and a
    // negative-cache entry would pin the miss forever (the pre-fix regression).
    if (match.id != null || match.ambiguous) refCache.set(cacheKey, match);
    return match;
  };

  // Locate an existing record for update/upsert by matchFields. Returns the
  // record, or a sentinel: 'blank' (a match field was empty), 'none' (no
  // match), 'ambiguous' (>1 match — too risky to update).
  const findExisting = async (
    data: Record<string, any>,
  ): Promise<Record<string, any> | 'blank' | 'none' | 'ambiguous'> => {
    const filter: Record<string, any> = {};
    for (const f of matchFields) {
      const v = data[f];
      if (v === undefined || v === null || v === '') return 'blank';
      filter[f] = v;
    }
    const r = await p.findData({ ...findArgsBase({ $filter: filter, $top: 2 }), object: objectName });
    const recs = findRows(r);
    if (recs.length === 0) return 'none';
    if (recs.length > 1) return 'ambiguous';
    return recs[0];
  };

  const writeCtx = {
    ...(context ?? {}),
    skipAutomations: !runAutomations,
    // #3479 / #3493 — a "historical" import carries curated established facts:
    //   - skipStateMachine: the engine skips the state_machine rule (initialStates
    //     on insert, transitions on update) so mid-lifecycle rows aren't rejected;
    //   - preserveAudit: the ORIGINAL timeline is kept — a supplied
    //     updated_at/updated_by survives (not stamped now), and the audit/business
    //     readonly fields survive the upsert-update readonly strip.
    // Default off: a normal import walks the FSM and auto-stamps as usual.
    ...(treatAsHistorical ? { skipStateMachine: true, preserveAudit: true } : {}),
  };

  /**
   * The dry run's verdict for one coerced row — asked of the engine, never
   * derived here (#4633 ruling D). `null` means this protocol offers no
   * validate-only operation, so no engine verdict exists to report; the caller
   * falls back to the coercion + resolution verdict it already has rather than
   * inventing one.
   *
   * Runs on EVERY dry run, whatever `runAutomations` says. The write's
   * `beforeInsert` hooks fire before validation and could in principle derive
   * a field this reports on — a boundary #6037 documents and deliberately does
   * not close, because firing user-authored hooks (mail, outbound calls,
   * writes to other objects) inside a preview is the retired `validateOnly`
   * defect in a new spelling. Gating on `!runAutomations` instead would leave
   * the DEFAULT dry run (`runAutomations` has defaulted to true since #2922)
   * with no validation at all, which is the false all-clear this card exists
   * to close.
   */
  const previewVerdict = async (
    data: Record<string, any>,
    mode: 'insert' | 'update',
  ): Promise<NonNullable<ValidateDataResponse['results']>[number] | null> => {
    if (typeof p.validateData !== 'function') return null;
    const res = await p.validateData({
      object: objectName, data, mode,
      // The SAME context the write would carry, so a historical import's
      // `skipStateMachine` and the caller's locale reach validation here
      // exactly as they reach it on the write path.
      context: writeCtx,
      ...(environmentId ? { environmentId } : {}),
    });
    return res?.results?.[0] ?? null;
  };

  /**
   * Compose a row's `error` from the engine's findings the way
   * `ValidationError` composes its own message — author-written rule text when
   * there is one, `field (code)` otherwise, joined by `; `. Presentation only:
   * the verdict and every sentence in it come from the engine. It is spelled
   * out here because `validateData` returns structured findings rather than a
   * rendered message, and the two halves must read identically.
   */
  const composeValidationMessage = (issues: ValidateDataIssue[]): string =>
    issues.map((f) => (f.message?.trim() ? f.message : `${f.field} (${f.code})`)).join('; ') || 'Validation failed';

  // Sparse-indexed by row position `i` (not push-only): CREATE rows are
  // resolved immediately but their write is deferred to a later batch flush,
  // so their result would otherwise land out of order relative to
  // immediately-written update/skip rows interleaved between them.
  const results: ImportRowResult[] = new Array(rows.length);
  let okCount = 0, errCount = 0, created = 0, updated = 0, skipped = 0;
  let cancelled = false;

  const snapshot = (processed: number): ImportProgress => ({
    processed, total: rows.length, created, updated, skipped, errors: errCount,
  });

  // CREATE rows are buffered here and flushed through `p.createManyData`
  // (one round-trip per batch) when the protocol supports it. A protocol
  // without `createManyData` never buffers — `canBulkCreate` is false and
  // creates fall back to the original inline per-row `createData` call.
  const canBulkCreate = typeof p.createManyData === 'function';
  // Partial-success flush (framework#3172): preferred when the protocol
  // offers it — a row that fails validation is a per-row verdict from one
  // batch call, so a bad row never forces the whole-batch degradation that
  // re-runs beforeInsert hooks on its siblings.
  const canPartialCreate = typeof p.insertManyData === 'function';
  const pendingCreates: Array<{ index: number; rowNo: number; data: Record<string, any> }> = [];
  // bulkWrite is at-least-once: a retry (or a mismatch-driven degradation) may
  // re-run a create whose prior attempt already committed. Every buffered
  // CREATE row is therefore pre-assigned a client-generated id at flush time
  // (framework#3173) — stable across attempts — so a retry can recheck by id
  // ($in) and re-insert only the rows that truly did not land. This is exact
  // for EVERY write mode (including pure insert with legitimate duplicate
  // rows, where a natural-key recheck could not distinguish copies).
  let lastBatchUncertain = false;
  // Set when a flush's write succeeded but its post-write roll-up summary
  // recompute exhausted retries (framework#3147). The rows ARE written; we mark
  // them created-with-a-warning code rather than failing (or re-writing) them.
  let flushSummaryStale = false;
  const isUncertainOutcome = (e: unknown) =>
    defaultIsTransientError(e) || (e as { code?: unknown } | null)?.code === 'ERR_BULK_RESULT_MISMATCH';
  // A post-write summary recompute failure (ERR_SUMMARY_RECOMPUTE) means the
  // records were written; recover the written records from the error rather
  // than letting the write look failed (which would re-create → duplicate).
  const recoverSummaryStale = (e: unknown): unknown[] | null => {
    const err = e as { code?: unknown; written?: unknown } | null;
    if (err?.code === 'ERR_SUMMARY_RECOMPUTE') {
      flushSummaryStale = true;
      return Array.isArray(err.written) ? err.written : (err.written != null ? [err.written] : []);
    }
    return null;
  };
  // Exact idempotency recheck (framework#3173): buffered CREATE rows carry a
  // pre-assigned id, so "did the lost-response attempt actually commit?" is
  // answered precisely by an id $in query — no natural key, no clocks, and
  // legitimate duplicate rows (pure insert mode) resolve correctly because
  // each copy has its own id.
  const recheckByIds = async (chunk: Array<Record<string, any>>): Promise<Map<string, any>> => {
    const ids = chunk.map((r) => r.id).filter((v) => v != null && v !== '');
    if (ids.length === 0) return new Map();
    const r = await p.findData({
      ...findArgsBase({ $filter: { id: { $in: ids } }, $top: ids.length }),
      object: objectName,
    });
    return new Map(findRows(r).map((rec: any) => [String(rec.id), rec]));
  };
  const flushPendingCreates = async (): Promise<void> => {
    if (pendingCreates.length === 0) return;
    flushSummaryStale = false;
    const batch = pendingCreates.splice(0, pendingCreates.length);
    // Pre-assign ids once per row (framework#3173) — the closures below see
    // the same row objects on every retry attempt, so the ids are stable. An
    // id the user supplied explicitly is respected.
    for (const b of batch) {
      if (b.data.id == null || b.data.id === '') b.data.id = randomUUID();
    }
    // Recheck helper shared by both write paths: on attempt > 1 split the
    // chunk into rows that already landed (by id) and rows still to create.
    const splitByExisting = async (chunk: Array<Record<string, any>>) => {
      const existingByIdx = new Map<number, Record<string, any>>();
      const toCreate: Array<Record<string, any>> = [];
      const found = await recheckByIds(chunk);
      chunk.forEach((row, i) => {
        const hit = row.id != null ? found.get(String(row.id)) : undefined;
        if (hit) existingByIdx.set(i, hit); else toCreate.push(row);
      });
      return { existingByIdx, toCreate };
    };
    const writeResults: BulkWriteRowResult[] = await bulkWrite(
      batch.map(b => b.data),
      {
        // Flush cadence follows progressEvery, but the write batch itself is
        // capped independently — a caller-supplied progressEvery far above
        // the issue's suggested 100-500 rows/batch must not translate into
        // one oversized multi-row INSERT statement.
        batchSize: Math.min(progressEvery, MAX_CREATE_BATCH_SIZE),
        // Partial-success path (framework#3172): per-row verdicts from one
        // call; a bad row never degrades the batch.
        ...(canPartialCreate ? {
          writeBatchPartial: async (chunk: Array<Record<string, any>>, { attempt }: { attempt: number }) => {
            let toCreate = chunk;
            let existingByIdx = new Map<number, Record<string, any>>();
            if (attempt > 1) {
              ({ existingByIdx, toCreate } = await splitByExisting(chunk));
            }
            try {
              let freshOutcomes: Array<{ ok: boolean; record?: any; error?: unknown }>;
              if (toCreate.length === 0) {
                freshOutcomes = [];
              } else {
                try {
                  freshOutcomes = (await p.insertManyData!({
                    object: objectName, records: toCreate, context: writeCtx,
                    ...(environmentId ? { environmentId } : {}),
                  })).outcomes;
                } catch (e) {
                  // Rows written but summary recompute failed: recover the
                  // outcome array carried on the error (framework#3147).
                  const recovered = recoverSummaryStale(e);
                  if (!recovered) throw e;
                  freshOutcomes = recovered as Array<{ ok: boolean; record?: any; error?: unknown }>;
                }
              }
              if (!Array.isArray(freshOutcomes) || freshOutcomes.length !== toCreate.length) {
                throw Object.assign(
                  new Error(`insertManyData returned ${Array.isArray(freshOutcomes) ? `${freshOutcomes.length} outcome(s)` : String(typeof freshOutcomes)} for ${toCreate.length} row(s)`),
                  { code: 'ERR_BULK_RESULT_MISMATCH' },
                );
              }
              lastBatchUncertain = false;
              let k = 0;
              return chunk.map((_row, i) => existingByIdx.has(i)
                ? { ok: true, record: existingByIdx.get(i)! }
                : freshOutcomes[k++]);
            } catch (e) {
              lastBatchUncertain = isUncertainOutcome(e);
              throw e;
            }
          },
        } : {}),
        writeBatch: async (chunk, { attempt }) => {
          let toCreate = chunk;
          let existingByIdx = new Map<number, Record<string, any>>();
          if (attempt > 1) {
            // A prior attempt may have committed before its response was lost:
            // recheck by pre-assigned id and only create the missing rows.
            ({ existingByIdx, toCreate } = await splitByExisting(chunk));
          }
          try {
            let createdRecords: any[];
            if (toCreate.length === 0) {
              createdRecords = [];
            } else {
              try {
                createdRecords = (await p.createManyData!({
                  object: objectName, records: toCreate, context: writeCtx,
                  ...(environmentId ? { environmentId } : {}),
                })).records;
              } catch (e) {
                // Records written but summary recompute failed: recover them.
                const recovered = recoverSummaryStale(e);
                if (!recovered) throw e;
                createdRecords = recovered;
              }
            }
            // Surface a short/non-array createManyData return as a failed batch
            // (framework#3151) rather than padding the reassembly with undefined
            // — this drops into per-row degradation, which rechecks first.
            if (!Array.isArray(createdRecords) || createdRecords.length !== toCreate.length) {
              throw Object.assign(
                new Error(`createManyData returned ${Array.isArray(createdRecords) ? `${createdRecords.length} record(s)` : String(typeof createdRecords)} for ${toCreate.length} row(s)`),
                { code: 'ERR_BULK_RESULT_MISMATCH' },
              );
            }
            lastBatchUncertain = false;
            // Reassemble one record per input row: rechecked-existing rows use
            // the found record, the rest are consumed in order from created.
            let k = 0;
            return chunk.map((_row, i) => existingByIdx.has(i) ? existingByIdx.get(i)! : createdRecords[k++]);
          } catch (e) {
            lastBatchUncertain = isUncertainOutcome(e);
            throw e;
          }
        },
        writeOne: async (row, { attempt }) => {
          if (attempt > 1 || lastBatchUncertain) {
            const found = await recheckByIds([row]);
            const hit = row.id != null ? found.get(String(row.id)) : undefined;
            if (hit) return hit; // already committed by a prior attempt
          }
          try {
            return await p.createData({
              object: objectName, data: row, context: writeCtx,
              ...(environmentId ? { environmentId } : {}),
            });
          } catch (e) {
            const recovered = recoverSummaryStale(e);
            if (recovered) return recovered[0]; // record written; summary stale
            throw e;
          }
        },
      },
    );
    for (const res of writeResults) {
      const { index, rowNo } = batch[res.index];
      if (res.ok) {
        const id = extractRecordId(res.record);
        okCount++; created++;
        if (collectUndo && id != null) undoLog.created.push(id);
        results[index] = { row: rowNo, ok: true, action: 'created', id,
          ...(flushSummaryStale ? { code: 'SUMMARY_RECOMPUTE_FAILED' } : {}) };
      } else {
        errCount++;
        results[index] = toFailedResult(rowNo, res.error);
      }
    }
  };

  return (async () => {
    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 1;
      try {
        // 1. Coerce every cell to its storage value (+ resolve lookups).
        const { data, errors } = await coerceRow(rows[i], metaMap, {
          trimWhitespace, nullValues, createMissingOptions, resolveRef,
          // Cell-coercion failures land in the same row report as the engine's
          // validation errors, so they speak the same language (#3957).
          locale: context?.locale, translate: messageTranslator,
          // [#8485] The clock an offset-free datetime cell is read in. Already
          // on the resolved context beside `locale` (the localization cascade's
          // `ExecutionContext.timezone`) — the SAME value the export renders
          // cells in (#8373), which is what makes the round trip an inverse
          // instead of a host-`TZ` lottery. Absent ⇒ UTC, as the export writes.
          timezone: typeof context?.timezone === 'string' && context.timezone
            ? String(context.timezone) : undefined,
        });
        if (errors.length > 0) {
          const first = errors[0];
          errCount++;
          results[i] = { row: rowNo, ok: false, action: 'failed', field: first.field, code: first.code, error: first.message };
        } else {
          // 2. Decide create vs update vs skip.
          let existing: Record<string, any> | 'blank' | 'none' | 'ambiguous' = 'none';
          let handled = false;
          if (writeMode !== 'insert') {
            existing = await findExisting(data);
            if (existing === 'ambiguous') {
              errCount++;
              results[i] = { row: rowNo, ok: false, action: 'failed', code: 'AMBIGUOUS_MATCH', error: `matchFields matched more than one ${objectName} record` };
              handled = true;
            } else if (existing === 'blank' && (skipBlankMatchKey || writeMode === 'update')) {
              // Blank match key: skip when asked, else fall through to create.
              skipped++;
              results[i] = { row: rowNo, ok: true, action: 'skipped', code: 'BLANK_MATCH_KEY' };
              handled = true;
            }
          }

          if (!handled) {
            const willUpdate = existing && typeof existing === 'object';
            const willCreate = !willUpdate && (writeMode === 'insert' || writeMode === 'upsert');

            if (!willUpdate && !willCreate) {
              // update mode, no match → skip.
              skipped++;
              results[i] = { row: rowNo, ok: true, action: 'skipped', code: 'NO_MATCH' };
            } else if (dryRun) {
              // Ask the engine for the verdict this row would get (#4633).
              // The write path needs no counterpart: `validateRecord` runs
              // there for real, after the hooks, and the row report is built
              // from the very same findings by `toFailedResult`.
              const verdict = await previewVerdict(data, willUpdate ? 'update' : 'insert');
              if (verdict && !verdict.valid) {
                errCount++;
                const first = verdict.errors[0];
                results[i] = {
                  row: rowNo, ok: false, action: 'failed',
                  ...(first?.field ? { field: first.field } : {}),
                  code: first?.code ?? 'VALIDATION_FAILED',
                  error: composeValidationMessage(verdict.errors),
                };
              } else {
                okCount++;
                // A warn-first deployment ADMITS some findings; the row is ok
                // because the write would store it, and the complaint rides
                // along so "accepted for now" is visible rather than silent.
                const admitted = verdict?.warnings?.length ? { warnings: verdict.warnings } : {};
                if (willUpdate) { updated++; results[i] = { row: rowNo, ok: true, action: 'updated', id: String((existing as any).id ?? '') || undefined, ...admitted }; }
                else { created++; results[i] = { row: rowNo, ok: true, action: 'created', ...admitted }; }
              }
            } else if (willUpdate) {
              const target = existing as Record<string, any>;
              let res2: unknown;
              let updateSummaryStale = false;
              try {
                res2 = await withTransientRetry(() => p.updateData({ object: objectName, id: target.id, data, context: writeCtx, ...(environmentId ? { environmentId } : {}) }));
              } catch (e) {
                // Record updated but summary recompute failed (framework#3147):
                // the update landed, so recover rather than fail the row.
                const recovered = recoverSummaryStale(e);
                if (!recovered) throw e;
                res2 = recovered[0]; updateSummaryStale = true;
              }
              const id = extractRecordId(res2) ?? String(target.id);
              okCount++; updated++;
              if (collectUndo && target.id != null) {
                undoLog.updated.push({ id: String(target.id), before: captureBefore(target, data) });
              }
              results[i] = { row: rowNo, ok: true, action: 'updated', id,
                ...(updateSummaryStale ? { code: 'SUMMARY_RECOMPUTE_FAILED' } : {}) };
            } else if (canBulkCreate) {
              // Buffer — the actual write happens in a batched flush below.
              pendingCreates.push({ index: i, rowNo, data });
            } else {
              // No bulk-create primitive on this protocol: original inline path.
              // Wrap in transient retry to match the update path above (L352)
              // and the batched create path (bulkWrite's internal retry) — a
              // single `fetch failed` blip must not silently drop the row
              // (framework#3150).
              const res2 = await withTransientRetry(() => p.createData({ object: objectName, data, context: writeCtx, ...(environmentId ? { environmentId } : {}) }));
              const id = extractRecordId(res2);
              okCount++; created++;
              if (collectUndo && id != null) undoLog.created.push(id);
              results[i] = { row: rowNo, ok: true, action: 'created', id };
            }
          }
        }
      } catch (err: any) {
        errCount++;
        results[i] = toFailedResult(rowNo, err);
      }

      const processed = i + 1;
      if (processed % progressEvery === 0 || processed === rows.length) {
        // Flush before reporting/cancelling so counts and `processed` reflect
        // every row up to this checkpoint, not just decided-but-unwritten ones.
        await flushPendingCreates();
        if (onProgress) await onProgress(snapshot(processed));
      }
      if (processed < rows.length && processed % progressEvery === 0) {
        // Yield BEFORE polling the flag: a cancel request can only set it
        // once its HTTP handler gets event-loop time (framework#2824).
        await yieldToEventLoop();
        if (shouldCancel && (await shouldCancel())) { cancelled = true; break; }
      }
    }

    await flushPendingCreates();
    const compacted = results.filter((r): r is ImportRowResult => r !== undefined);

    return {
      ...snapshot(compacted.length), ok: okCount, results: compacted, cancelled,
      ...(collectUndo ? { undoLog } : {}),
    };
  })();
}
