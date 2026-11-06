// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `export` row in the compliance ledger: one durable, run-level row per
 * data export the REST export door (`GET /data/:object/export`) streamed.
 *
 * ## The gap this closes
 *
 * `export` left `sys_audit_log.action` under ADR-0087 (#8147) because nothing
 * wrote it: no export of any object, the ledger itself included, left a row.
 * The rule that retired it (审计面宁窄勿谎, a value only together with its
 * writer) is the rule that lets it back, with this writer, its tests and the
 * view that lists its rows in the same change.
 *
 * ## Who calls it
 *
 * The export door in `@objectstack/rest` (`data-action-routes.ts`), once per
 * export that cleared the door's gates and began reading, whether the stream
 * then completed or failed. It resolves this writer through the `audit` service
 * slot (beside `recordAuthEvent` and `recordActionInvocation`) and hands over
 * an EVENT, never a row: the row shape is this package's, for the reason
 * `auth-event-audit.ts` gives ("a second package hand-assembling ledger rows
 * would be a second de-facto definition of that shape").
 *
 * A request the door refused before reading (the object's `export` exposure,
 * the caller's export permission `EXPORT_NOT_PERMITTED`, a malformed query
 * parameter) is not an export and writes no row: no row of data left, and the
 * caller was answered the refusal. The import template (`?template=true`)
 * carries no record and writes none either.
 *
 * ## The row
 *
 * The incumbent run-level shape of plugin-auth's admin user-import row
 * (`admin-import-users.ts`, `action: 'import'`):
 *
 *  - `action: 'export'`, `record_id: null` (an export is about a set of rows,
 *    not one record), `object_name` = the exported object;
 *  - `user_id` / `actor` / `tenant_id` from the caller's envelope, with the
 *    CRUD mirror's rules (`actor` stays two-valued, ADR-0118 D1/D5);
 *  - no `old_value` / `new_value`: an export is not a field diff;
 *  - `metadata`: `format`, `row_count`, the row limit (`limit`,
 *    `requested_limit`, `limit_cap`, `limit_capped`), `truncated`, a bounded
 *    `filter` summary, `search` (whether a term was applied), `search_fields`,
 *    `outcome`, and on a failure the HTTP `status` and the error's machine code;
 *    `performed_by` / `on_behalf_of` when an agent performed the call and
 *    `impersonated_by` under an impersonation session, the pairs the CRUD
 *    mirror and the action-invocation row write.
 *
 * ## No exported value, ever
 *
 * The row records WHAT was asked, never what was in it: the filter is reduced
 * to its field names and operators ({@link summarizeExportFilter}, every
 * comparand dropped), the search term to the fact that one was applied, and a
 * failure to its status and machine code (never the error's text, which a
 * driver can fill with a comparand). Nothing here reads a row of the export.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isMissingTableError } from '@objectstack/types';
import {
  auditFailureCauseKey,
  auditFailureCauseSummary,
  createFieldPresenceProbe,
} from './audit-writers.js';
import type { AuthEventAuditLogger } from './auth-event-audit.js';
import { IMPERSONATED_BY_KEY, impersonatorOf } from './impersonation-attribution.js';

/** The `sys_audit_log.action` value this writer emits. */
export const DATA_EXPORT_AUDIT_ACTION = 'export' as const;

/** How the export ended: the stream completed, or it failed after reading began. */
export type DataExportOutcome = 'succeeded' | 'failed';

/**
 * One export, in the vocabulary of what HAPPENED. The door builds it; this
 * writer turns it into a row.
 */
export interface DataExportAuditEvent {
  /**
   * The caller's envelope. Read for `userId`, `actor`, `tenantId`,
   * `performedBy` and `impersonatedBy` — nothing else.
   */
  context:
    | Pick<ExecutionContext, 'userId' | 'actor' | 'tenantId' | 'performedBy' | 'impersonatedBy'>
    | undefined;
  /** The exported object's name. */
  objectName: string;
  /** The served format the file was written in (`csv`, `json`, `xlsx`). */
  format: string;
  /** Rows written into the file. */
  rowCount: number;
  /** The row limit the export ran under, after the door's cap. */
  limit: number;
  /** The row limit the caller asked for (the door's default when it named none). */
  requestedLimit: number;
  /** The door's hard row cap. */
  limitCap: number;
  /**
   * The file stopped at {@link limit} while the read did not say the result
   * set ended there: rows that matched are not in the file.
   */
  truncated: boolean;
  /**
   * The query as the door read it. Reduced to names and operators before it
   * reaches the row: the comparands and the search term are never recorded.
   */
  readQuery?: { filter?: unknown; search?: unknown; searchFields?: unknown };
  outcome: DataExportOutcome;
  /** On a failure: the HTTP status the door answered. */
  status?: number;
  /** On a failure: the error's machine code, as the door answered it. */
  errorCode?: string;
}

/** What {@link createDataExportAuditWriter} adds to the `audit` slot. */
export interface DataExportAuditWriter {
  /**
   * Record one export in `sys_audit_log`. Never throws — an audit write must
   * never change the file a caller downloads — and reports a lost row loudly,
   * once per cause.
   */
  recordDataExport(event: DataExportAuditEvent): Promise<void>;
}

export interface DataExportAuditWriterOptions {
  /** Resolve the data engine at CALL time — see `AuthEventAuditSinkOptions.getEngine`. */
  getEngine(): IDataEngine | undefined;
  logger?: AuthEventAuditLogger;
}

/** The most `{ field, op }` terms a filter summary keeps. */
export const EXPORT_FILTER_SUMMARY_MAX_TERMS = 32;

/** The deepest a filter summary walks into nested logic. */
const EXPORT_FILTER_SUMMARY_MAX_DEPTH = 16;

/** The most `search_fields` names the row keeps. */
const EXPORT_SEARCH_FIELDS_MAX = 32;

/**
 * A field path the summary records: machine-name segments joined by dots
 * (a relation path), bounded. Anything else is caller text in a field
 * position, recorded as `?` rather than verbatim.
 */
const FIELD_PATH = /^[A-Za-z_][A-Za-z0-9_]{0,63}(?:\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,3}$/;

/** An operator the summary records: a `$`-key, an infix word or an infix symbol. */
const OPERATOR = /^(?:\$[A-Za-z][A-Za-z0-9]{0,31}|[A-Za-z][A-Za-z_]{0,31}|=|==|!=|<>|>|>=|<|<=)$/;

/** The logical keys of the object dialect; their values are sub-conditions, never comparands. */
const LOGICAL_KEYS = new Set(['$and', '$or', '$not', '$nor']);

/** The logical words of the array dialect (`['and', c1, c2]`, `[c1, 'or', c2]`). */
const ARRAY_LOGIC_WORDS = new Set(['and', 'or', 'not']);

/** One recorded term of a filter: which field it reads and how. Never the comparand. */
export interface ExportFilterTerm {
  field: string;
  op: string;
}

/** A filter reduced to its terms, and how many terms past the bound were left out. */
export interface ExportFilterSummary {
  terms: ExportFilterTerm[];
  omitted: number;
}

function recordedField(path: string): string {
  return FIELD_PATH.test(path) ? path : '?';
}

function recordedOperator(op: string): string {
  return OPERATOR.test(op) ? op : '?';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Reduce an export's `filter` to the fields it reads and the operators it
 * applies — the one place a filter crosses into the ledger, and the reason no
 * comparand can: only KEYS and operator tokens are read, every value position
 * is dropped unread.
 *
 * Both filter dialects the door accepts are walked: the object dialect
 * (`{ field: value }`, `{ field: { $op: value } }`, `$and` / `$or` / `$not`,
 * a nested relation path) and the array dialect (`[field, op, value]`,
 * `['and', ...]`, `[c1, 'or', c2]`, a list of conditions). A field position
 * that is not a machine-name path, or an operator token of no operator's
 * shape, is recorded as `?`. Terms are de-duplicated in first-seen order and
 * bounded at {@link EXPORT_FILTER_SUMMARY_MAX_TERMS}; the rest are counted in
 * `omitted`.
 */
export function summarizeExportFilter(filter: unknown): ExportFilterSummary {
  const terms: ExportFilterTerm[] = [];
  const seen = new Set<string>();
  let omitted = 0;

  const add = (field: string, op: string): void => {
    const term = { field: recordedField(field), op: recordedOperator(op) };
    const key = JSON.stringify([term.field, term.op]);
    if (seen.has(key)) return;
    seen.add(key);
    if (terms.length >= EXPORT_FILTER_SUMMARY_MAX_TERMS) {
      omitted++;
      return;
    }
    terms.push(term);
  };

  /** One field's condition: an operator map, a nested relation path, or a comparand (implicit equality). */
  const walkFieldCondition = (path: string, condition: unknown, depth: number): void => {
    if (depth > EXPORT_FILTER_SUMMARY_MAX_DEPTH) return;
    if (!isPlainObject(condition)) {
      // A comparand: `{ field: value }` is equality. The value is not read.
      add(path, '$eq');
      return;
    }
    const keys = Object.keys(condition);
    if (keys.length === 0) {
      add(path, '$eq');
      return;
    }
    for (const key of keys) {
      if (key.startsWith('$')) {
        if (key === '$not' && isPlainObject(condition[key])) {
          // `{ field: { $not: { $op: value } } }` — the negated operators, under this field.
          add(path, '$not');
          walkFieldCondition(path, condition[key], depth + 1);
        } else {
          add(path, key);
        }
      } else {
        // A nested relation path: `{ owner: { name: … } }`.
        walkFieldCondition(`${path}.${key}`, condition[key], depth + 1);
      }
    }
  };

  const walk = (node: unknown, depth: number): void => {
    if (depth > EXPORT_FILTER_SUMMARY_MAX_DEPTH || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      if (node.length === 3 && typeof node[0] === 'string' && typeof node[1] === 'string'
        && !ARRAY_LOGIC_WORDS.has(node[0].toLowerCase())) {
        // A comparison node: `[field, op, value]`. The value is not read.
        add(node[0], node[1].toLowerCase());
        return;
      }
      for (const child of node) {
        if (typeof child === 'string') continue; // a logic word between or before conditions
        walk(child, depth + 1);
      }
      return;
    }
    if (!isPlainObject(node)) return; // a bare scalar is no condition
    for (const [key, value] of Object.entries(node)) {
      if (LOGICAL_KEYS.has(key)) {
        if (Array.isArray(value)) for (const child of value) walk(child, depth + 1);
        else walk(value, depth + 1);
      } else if (key.startsWith('$')) {
        // An operator with no field above it: record that it was applied, not its operand.
        add('?', key);
      } else {
        walkFieldCondition(key, value, depth + 1);
      }
    }
  };

  walk(filter, 0);
  return { terms, omitted };
}

/** JSON that cannot throw on a cyclic/odd value — same rule as the CRUD writer. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function wholeNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined;
}

/** The `searchFields` override as names only, each a field path or `?`, bounded. */
function searchFieldNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, EXPORT_SEARCH_FIELDS_MAX)
    .map(recordedField);
}

/**
 * The row for one export — exported so the shape is pinned without an engine.
 * `objectHasField` answers whether the deployed ledger has the
 * conditionally-present `actor` column (`createFieldPresenceProbe`).
 */
export function buildDataExportAuditRow(
  event: DataExportAuditEvent,
  objectHasField: (objectName: string, field: string) => boolean = () => true,
): Record<string, unknown> {
  const ctx = event.context ?? {};
  const userId = nonEmpty(ctx.userId);
  const performedBy = nonEmpty(ctx.performedBy?.clientId);
  const query = event.readQuery ?? {};

  const limit = wholeNumber(event.limit);
  const requestedLimit = wholeNumber(event.requestedLimit);
  const limitCap = wholeNumber(event.limitCap);
  const metadata: Record<string, unknown> = {
    format: nonEmpty(event.format) ?? null,
    row_count: wholeNumber(event.rowCount) ?? 0,
    limit: limit ?? null,
    requested_limit: requestedLimit ?? null,
    limit_cap: limitCap ?? null,
    // The request named more rows than the door's cap allows.
    limit_capped: requestedLimit !== undefined && limitCap !== undefined && requestedLimit > limitCap,
    truncated: event.truncated === true,
  };
  if (query.filter !== undefined && query.filter !== null) {
    const summary = summarizeExportFilter(query.filter);
    metadata.filter = summary.terms;
    if (summary.omitted > 0) metadata.filter_terms_omitted = summary.omitted;
  }
  // Whether a full-text term narrowed the file — never the term: it is text
  // the caller expects to find IN the exported cells.
  metadata.search = typeof query.search === 'string' && query.search.trim() !== '';
  const searchFields = metadata.search ? searchFieldNames(query.searchFields) : undefined;
  if (searchFields) metadata.search_fields = searchFields;
  metadata.outcome = event.outcome === 'failed' ? 'failed' : 'succeeded';
  if (event.outcome === 'failed') {
    if (typeof event.status === 'number') metadata.status = event.status;
    const errorCode = nonEmpty(event.errorCode);
    if (errorCode) metadata.error_code = errorCode;
  }
  // [ADR-0090 D10 rule 4] The same pair, under the same names, the CRUD mirror
  // writes for a delegated write — present only when an agent performed the
  // call, so the two shapes stay distinguishable by absence.
  if (performedBy) {
    metadata.performed_by = performedBy;
    metadata.on_behalf_of = userId ?? null;
  }
  // The impersonating administrator, under the key the CRUD mirror writes,
  // present only when an impersonation session made the call.
  const impersonatedBy = impersonatorOf(ctx);
  if (impersonatedBy) metadata[IMPERSONATED_BY_KEY] = impersonatedBy;

  const row: Record<string, unknown> = {
    action: DATA_EXPORT_AUDIT_ACTION,
    user_id: userId ?? null,
    object_name: nonEmpty(event.objectName) ?? null,
    // Run-level: an export is about a set of rows, so it names no record —
    // the ledger's read gate serves it as a row about no record
    // (`audit-log-read-visibility.ts`).
    record_id: null,
    old_value: null,
    new_value: null,
    // [ADR-0131 D7] The organization the export ran in — the attribution
    // column the `sys_audit_log_org` row policy scopes readers on.
    tenant_id: nonEmpty(ctx.tenantId) ?? null,
    metadata: safeStringify(metadata),
  };
  if (objectHasField('sys_audit_log', 'actor')) {
    // ADR-0014 D2's principal label, by the CRUD mirror's rule: the user, else
    // a service principal the host put on the envelope, else null.
    row.actor = userId ?? nonEmpty(ctx.actor) ?? null;
  }
  return row;
}

/** Create the data-export writer for the `audit` service slot. */
export function createDataExportAuditWriter(opts: DataExportAuditWriterOptions): DataExportAuditWriter {
  const { getEngine, logger } = opts;
  let probe: ((objectName: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;

  /**
   * Report a lost row — once per CAUSE (`auditFailureCauseKey`), the rule the
   * auth-event sink and the action-invocation writer follow. A durability
   * degradation, so `error`, falling back to `warn`, never to silence. Names
   * the object and the cause; never the event's query.
   */
  const reportedCauses = new Set<string>();
  const reportWriteFailure = (event: DataExportAuditEvent, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      const cause = auditFailureCauseKey('sys_audit_log', err);
      if (reportedCauses.has(cause)) {
        logger?.debug?.('Data-export audit write failed (already reported)', {
          object: event.objectName,
          err: detail,
          cause,
        });
        return;
      }
      reportedCauses.add(cause);
      const message =
        `Data-export audit write FAILED (${auditFailureCauseSummary(err, detail)}) — the compliance trail ` +
        'is now INCOMPLETE. The export itself was answered exactly as it would have been without the ' +
        'ledger: the caller holds the file, so nothing downstream looks broken; only the `sys_audit_log` ' +
        'row recording WHO exported WHICH object, how many rows and under which filter never landed, and ' +
        'nothing retries it. Every later export failing THIS WAY loses its row the same way (this CAUSE is ' +
        'reported ONCE — raise the log level to `debug` to see the rest; a DIFFERENT cause gets its own ' +
        '`error` line). ' +
        (isMissingTableError(err, 'sys_audit_log')
          ? 'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 ' +
            '§3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered, ' +
            'so a "no such table" here usually means the write ran against a DIFFERENT datasource than the ' +
            'one the table was created in. Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on ' +
            'the primary datasource.'
          : 'Fix: resolve the driver fault quoted at the head of this line on the connection this write ran ' +
            'on — every export that hits it loses its row until it is resolved.');
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), { object: event.objectName });
      } else {
        logger?.warn?.(message, { object: event.objectName, err: detail });
      }
    } catch {
      /* logging must never break the export's answer */
    }
  };

  /**
   * Write the ledger row. A NAMED callee so `pnpm check:durability-log-level`
   * anchors on it (`DURABILITY_CRITICAL_CALLEES`): a later edit cannot walk
   * the failure report above back down to `warn`.
   */
  const persistDataExportAuditRow = async (engine: IDataEngine, row: Record<string, unknown>): Promise<void> => {
    await engine.insert('sys_audit_log', row, { context: { isSystem: true } });
  };

  return {
    async recordDataExport(event: DataExportAuditEvent): Promise<void> {
      if (!event || typeof event.objectName !== 'string' || event.objectName === '') return;
      const engine = getEngine();
      if (!engine) return;
      if (probe === undefined || probedEngine !== engine) {
        probe = createFieldPresenceProbe(engine);
        probedEngine = engine;
      }
      let row: Record<string, unknown>;
      try {
        row = buildDataExportAuditRow(event, probe);
      } catch (err) {
        // A row that cannot be built is a row that does not land: reported as one.
        reportWriteFailure(event, err);
        return;
      }
      try {
        await persistDataExportAuditRow(engine, row);
      } catch (err) {
        // #5226's class on the export seam: a DURABILITY degradation — the
        // file was served, the system looks normal, and the row that says who
        // exported it is simply absent.
        reportWriteFailure(event, err);
      }
    },
  };
}
