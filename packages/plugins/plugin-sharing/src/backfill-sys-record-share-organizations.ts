// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * backfill-sys-record-share-organizations — the ONE-OFF repair sweep for the
 * `sys_record_share` rows the pre-#14484 `SharingService.grant` stranded with
 * no organization.
 *
 * ## What this repairs, and why it is not optional
 *
 * #14484 fixed the WRITER: `SharingService.grant` now stamps
 * `organization_id` on every insert and update of `sys_record_share` — a
 * rule-materialised grant carries the granting rule's organization, a direct
 * grant the shared record's. It wrote nothing to existing rows, and on a WALLED
 * deployment that asymmetry is the cliff the card names:
 *
 *   - the SQL driver's own tenant predicate is NULL-TOLERANT —
 *     `(organization_id = :tenantId OR organization_id IS NULL)` — so an
 *     unstamped grant stayed readable by every bare-context reader;
 *   - but Layer 0 (`plugin-security`'s `computeTenantLayer0Filter`) AND-composes
 *     a STRICT `organization_id = <active org>` above it, and the conjunction is
 *     the strict equality alone.
 *
 * ⇒ the day anything reads this table under a tenant context, every
 * organization-less grant becomes invisible — not refused, simply "this person
 * was never granted access". Forward-only stamping would split the table in
 * two: new grants walled, every existing grant gone. The backfill is what keeps
 * the observable behaviour uniform. (`single` posture is inert —
 * `computeTenantLayer0Filter` returns `null` — so nothing here changes for a
 * single-tenant install beyond the column being filled.)
 *
 * ## Maintainer order — `sys_record_share` and nothing else
 *
 * The tree's precedents for this shape are
 * `plugin-approvals/src/backfill-platform-row-organizations.ts` and
 * `service-storage/src/backfill-sys-file-organizations.ts`, and both require a
 * MAINTAINER ORDER PER TABLE. The 2026-09-02 ruling on #14484 (decision batch
 * #11 item 3, maintainer verbatim 「#13564 转维护者处理；其他同意」 — "其他同意"
 * adopts A: tenant-scoped, writer-repaired, existing rows backfilled from the
 * record they grant access to) IS that order, and it is the order for
 * `sys_record_share` ALONE. ⛔ Do not extend
 * {@link SYS_RECORD_SHARE_BACKFILL_OBJECT} to a second table; a second table
 * needs its own ruling.
 *
 * ## Deriving the organization — from the RECORD the grant is about
 *
 * A grant row says "principal P has level L on (object O, record R)". R lives
 * in exactly one organization, so the grant's organization is R's — read off
 * the column O is actually walled by ({@link resolveTenantFieldName}: ADR-0066
 * opt-out → declared `tenancy.tenantField` → injected `organization_id`), the
 * same column the wall will scope O's rows by. The ruling calls this derivation
 * "derivable and lossless", which is why no stored-population survey precedes
 * it: the maintainer's standing 「不考虑存量」 applies to surveys, not to a
 * derivation.
 *
 * ⛔ Nothing is guessed. The recipient (`recipient_id`) and the granter
 * (`granted_by`) are NOT subjects: a user may belong to many organizations, so
 * deriving from either would invent an answer the row does not carry. A rule
 * row (`source_id`) is not consulted either: the writer stamps the rule's
 * organization at write time because the rule's sweep ran under it, but for a
 * row at rest the record is the one subject that is both present and
 * unambiguous — and every organization-scoped rule's sweep only ever matched
 * records in its own organization (#10119), so the two answers agree wherever
 * both exist.
 *
 * ## ⭐ Orphans — the choice the ruling left to the implementer, and why
 *
 * A grant row whose record no longer exists is an orphan. The ruling offered
 * "delete" or "leave NULL with a logged count". This sweep LEAVES THEM NULL,
 * COUNTS them ({@link SysRecordShareBackfillResidue.recordNotFound},
 * `totals.orphans`) and LOGS the count — and never deletes anything, for one
 * reason: the invariant "record gone ⇒ the row cannot describe any access" is
 * already owned, by `record-orphan-cleanup.ts` and the `kernel:bootstrapped`
 * sweep `SharingService.sweepOrphanedRecordShares` (#5103). That sweep runs on
 * every boot, ahead of the rule-grant passes, and deletes exactly this
 * population. A second deleter here would be the fork that module exists to
 * prevent — two copies of one invariant, each with its own chunk size, its
 * own "a failed probe deletes NOTHING" rule, drifting apart. So the orphan
 * count this sweep reports is the population the next boot reclaims, and a
 * non-zero count after a boot is a finding about the sweep, not about this
 * module.
 *
 * ## The residue is the deliverable, not the leftovers
 *
 * ⭐ Rows that cannot be derived stay NULL and are REPORTED —
 * {@link SysRecordShareBackfillReport.totals}`.residualNull`, broken out by
 * reason in {@link SysRecordShareBackfillResidue}, and printed by
 * {@link formatSysRecordShareOrganizationBackfillReport}. Those rows remain
 * invisible to every tenant-scoped reader on a walled deployment, and that is
 * the maintainer's to see — ⛔ never silently accepted. The count is reported
 * for a DRY RUN too, which is what makes the dry run a decision document
 * rather than a preview.
 *
 * ## Idempotency
 *
 * The scan is `WHERE <organization column> IS NULL` and every write fills that
 * column, so a repaired row cannot match again: `planned` and `written` are
 * both 0 on a second run over an unchanged database. Rows deliberately left
 * alone keep matching and keep being REPORTED, never re-written.
 * `backfill-sys-record-share-organizations.test.ts` asserts the second run
 * rather than describing it.
 *
 * ## Usage
 *
 * Not exported from the package index and not shipped in `dist` — this is a
 * one-off operational module, not platform surface (the same posture as both
 * precedents). Run it server-side from a context that holds an engine:
 *
 * ```ts
 * const report = await planSysRecordShareOrganizationBackfill(engine);
 * console.log(formatSysRecordShareOrganizationBackfillReport(report));  // writes nothing
 * // …read it, then:
 * await applySysRecordShareOrganizationBackfill(engine, report);
 * ```
 *
 * Rollback posture: the dry run names every row id it would touch and the value
 * it would write, so the undo is to write the previous value (NULL) back to
 * exactly those ids.
 */

import { resolveTenantFieldName } from '@objectstack/objectql';

/**
 * The ONE object this sweep repairs. ⛔ Scope-pinned by the 2026-09-02 ruling
 * on #14484 — a second table needs its own maintainer order (see the module
 * doc).
 */
export const SYS_RECORD_SHARE_BACKFILL_OBJECT = 'sys_record_share';

/** The columns naming the record a grant is about (ADR-0052 §5 pointer pair). */
const SUBJECT_OBJECT_FIELD = 'object_name';
const SUBJECT_ID_FIELD = 'record_id';

/**
 * The sweep's elevation. It has to see rows across every organization — a
 * walled read would hide from it exactly the rows it exists to find — and it
 * writes with the derived organization threaded as `tenantId`, the shape a
 * repaired writer uses (see {@link applySysRecordShareOrganizationBackfill}).
 */
const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 100_000;
/** Id batches for the subject-record lookups. */
const LOOKUP_CHUNK = 100;

/**
 * The engine surface the sweep needs — a structural subset of the ObjectQL
 * engine, declared here so the module can be driven by a test double without
 * pulling the service in.
 *
 * `getSchema` is what the column resolution probes. An engine without it
 * resolves every organization column to `null`, which would make the sweep a
 * silent no-op — so the report says so out loud instead (see `notes`).
 */
export interface SysRecordShareBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown[]>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
  getSchema?(object: string): unknown;
}

/**
 * Structural on purpose, and `warn` is REQUIRED: the orphan count — the one
 * line the ruling asks this module to log — lands on `warn`, and a logger
 * without a guaranteed `warn` is one that line can be lost into (#9754's
 * silence rule). Deliberately NO `error` member (see `record-orphan-cleanup.ts`
 * for why that shape declares none).
 */
export interface SysRecordShareBackfillLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn: (msg: any, ...rest: any[]) => void;
}

/** The record a grant is about, and the organization it resolved to. */
export interface SysRecordShareSubject {
  object: string;
  id: string;
  /** `null` when the record is gone, unwalled, or carries no value. */
  organization: string | null;
}

/** One row the sweep would write, named in full so the dry run is auditable. */
export interface PlannedSysRecordShareRow {
  id: string;
  /** The column on `sys_record_share` that carries its organization (schema-resolved). */
  organizationField: string;
  /** The value that would be written. */
  organization: string;
  /** The record it was derived from, so the derivation is checkable without re-running it. */
  subject: SysRecordShareSubject;
}

/**
 * ⭐ Why each residual row is still NULL. Every counter here is a row that
 * stays invisible under a wall, so the breakdown — not just the total — is the
 * reportable outcome.
 */
export interface SysRecordShareBackfillResidue {
  /** The row carries no usable id, or no `(object_name, record_id)` pair. */
  unaddressable: number;
  /** The record's object has no schema this engine can read — the wall column is unknowable. */
  subjectObjectUnknown: number;
  /** The record's object has no organization column at all (ADR-0066 opt-out, or none injected). */
  subjectNotOrganizationScoped: number;
  /** The record could not be READ (driver error, unmounted table). "Could not ask" is not "gone". */
  subjectReadFailed: number;
  /**
   * ⭐ ORPHAN — the record no longer exists. Left NULL and counted; the #5103
   * boot sweep (`sweepOrphanedRecordShares`) is the one deleter of this
   * population. See the module doc.
   */
  recordNotFound: number;
  /** The record exists and is organization-scoped, but carries no organization itself. */
  recordHasNoOrganization: number;
}

/** One row the sweep left alone, with the reason, so the residue is checkable. */
export interface ResidualSysRecordShareRow {
  id: string;
  reason: keyof SysRecordShareBackfillResidue;
  subject: SysRecordShareSubject | null;
}

/** The whole sweep's plan / outcome. */
export interface SysRecordShareBackfillReport {
  /** `true` when nothing was written. */
  dryRun: boolean;
  /** The schema-resolved organization column on `sys_record_share`, or `null`. */
  organizationField: string | null;
  /** Rows matching `<organization column> IS NULL` at scan time. */
  scanned: number;
  /** Rows the sweep would write (dry run) — see {@link PlannedSysRecordShareRow}. */
  planned: number;
  /** Rows actually written. Always 0 on a dry run. */
  written: number;
  rows: PlannedSysRecordShareRow[];
  /** ⭐ Rows left NULL, one entry each, with the reason. */
  residualRows: ResidualSysRecordShareRow[];
  residue: SysRecordShareBackfillResidue;
  /** Planned rows whose write threw. Reported, never retried, never fatal. */
  failures: Array<{ id: string; error: string }>;
  /** Conditions a reader must see, e.g. "this engine exposes no such column". */
  notes: string[];
  totals: {
    scanned: number;
    planned: number;
    written: number;
    /**
     * ⭐ Rows still carrying a NULL organization when this run finished. On a
     * dry run that is every scanned row (nothing was written); on an applied
     * run it is what the maintainer is being asked to look at.
     */
    residualNull: number;
    /** ⭐ The orphan count — `residue.recordNotFound`, surfaced by name because the ruling asks for it. */
    orphans: number;
  };
}

/** Options both halves of the sweep accept. */
export interface SysRecordShareBackfillOptions {
  /**
   * Execution context for every READ. Defaults to a system context — the sweep
   * has to see rows across every organization, and a walled read would hide
   * from it exactly the rows it exists to find. Writes always thread the
   * derived organization as well (see {@link applySysRecordShareOrganizationBackfill}).
   */
  context?: unknown;
  /** Rows per page while scanning. */
  pageSize?: number;
  /** Hard ceiling, so a pathological table cannot spin forever. */
  maxRows?: number;
  /**
   * `false` writes. Defaults to `true`: a sweep over existing data that
   * defaults to writing is one typo away from an unplanned migration, and the
   * ruling puts the dry run first anyway.
   */
  dryRun?: boolean;
  /** Where the orphan count and the run summary are logged. Optional; the report carries both regardless. */
  logger?: SysRecordShareBackfillLogger;
}

// ---------------------------------------------------------------------------
// Column resolution — the WALL column, asked of the schema
// ---------------------------------------------------------------------------

/**
 * "Which column is THIS object walled by?", resolved from the registered
 * schema through the engine's own {@link resolveTenantFieldName} and memoized
 * per object. `undefined` (not `null`) when the schema itself could not be
 * read — the caller reports that as a different residue from "no column".
 */
function createWallColumnResolver(engine: SysRecordShareBackfillEngine) {
  const cache = new Map<string, string | null | undefined>();
  return (objectName: string): string | null | undefined => {
    if (cache.has(objectName)) return cache.get(objectName);
    let resolved: string | null | undefined;
    if (typeof engine.getSchema !== 'function') {
      resolved = undefined;
    } else {
      let schema: unknown;
      try {
        schema = engine.getSchema(objectName);
      } catch {
        schema = undefined;
      }
      resolved = schema ? resolveTenantFieldName(schema) : undefined;
    }
    cache.set(objectName, resolved);
    return resolved;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `''`, `null` and a non-string all mean "no value here". */
function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function rowId(row: unknown): string | null {
  const raw = (row as Record<string, unknown> | null)?.id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw === 'number') return String(raw);
  return null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function emptyResidue(): SysRecordShareBackfillResidue {
  return {
    unaddressable: 0,
    subjectObjectUnknown: 0,
    subjectNotOrganizationScoped: 0,
    subjectReadFailed: 0,
    recordNotFound: 0,
    recordHasNoOrganization: 0,
  };
}

function totalsOf(
  report: Omit<SysRecordShareBackfillReport, 'totals'>,
): SysRecordShareBackfillReport['totals'] {
  return {
    scanned: report.scanned,
    planned: report.planned,
    written: report.written,
    // ⭐ Every scanned row that did not get written is still NULL. On a dry run
    // `written` is 0, so this is the whole scan — which is the honest answer to
    // "what is still invisible if I stop here?".
    residualNull: report.scanned - report.written,
    orphans: report.residue.recordNotFound,
  };
}

/**
 * Page through every `sys_record_share` row whose organization column is unset.
 *
 * Ordered by `id` so the pages partition the population instead of overlapping,
 * and read in full BEFORE anything is written — a plan built while writing
 * would move rows out from under its own offset.
 */
async function scanUnstampedGrants(
  engine: SysRecordShareBackfillEngine,
  organizationField: string,
  options: { context: unknown; pageSize: number; maxRows: number },
  notes: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < options.maxRows; offset += options.pageSize) {
    let page: unknown[];
    try {
      page = await engine.find(SYS_RECORD_SHARE_BACKFILL_OBJECT, {
        where: { [organizationField]: null },
        limit: options.pageSize,
        offset,
        orderBy: [{ field: 'id', order: 'asc' }],
        context: options.context,
      });
    } catch (err) {
      // Named, not thrown: a reader has to be able to tell "no stranded rows"
      // from "never looked".
      notes.push(
        `scan of '${SYS_RECORD_SHARE_BACKFILL_OBJECT}' failed — ${String((err as Error)?.message ?? err)}`,
      );
      break;
    }
    const rows = Array.isArray(page) ? page : [];
    for (const row of rows) {
      if (row && typeof row === 'object') out.push(row as Record<string, unknown>);
    }
    if (rows.length < options.pageSize) break;
  }
  return out;
}

/**
 * Read the subject records of one object by id, projected to the wall column.
 * Throws on a read failure — the caller MUST treat that as "could not ask",
 * never as "none of them exist" (the same rule `findLiveRecordIds` in
 * `record-orphan-cleanup.ts` states for the orphan sweep).
 */
async function readSubjects(
  engine: SysRecordShareBackfillEngine,
  object: string,
  organizationField: string,
  ids: readonly string[],
  context: unknown,
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  for (const batch of chunk(ids, LOOKUP_CHUNK)) {
    const rows = await engine.find(object, {
      where: { id: { $in: batch } },
      fields: ['id', organizationField],
      limit: batch.length,
      context,
    });
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = rowId(row);
      if (id) found.set(id, row as Record<string, unknown>);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Plan (the dry run)
// ---------------------------------------------------------------------------

/**
 * Build the sweep's plan — the DRY RUN. Reads only; `written` is 0.
 *
 * This is the deliverable in its own right: it is the only thing that shows
 * both what will move and — ⭐ via {@link SysRecordShareBackfillReport.residue}
 * — what will still be invisible after it moves, the orphan count included.
 */
export async function planSysRecordShareOrganizationBackfill(
  engine: SysRecordShareBackfillEngine,
  options: SysRecordShareBackfillOptions = {},
): Promise<SysRecordShareBackfillReport> {
  const context = options.context ?? SYSTEM_CONTEXT;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const wallColumnOf = createWallColumnResolver(engine);

  const notes: string[] = [];
  const rows: PlannedSysRecordShareRow[] = [];
  const residualRows: ResidualSysRecordShareRow[] = [];
  const residue = emptyResidue();
  const organizationField = wallColumnOf(SYS_RECORD_SHARE_BACKFILL_OBJECT) ?? null;

  const base: Omit<SysRecordShareBackfillReport, 'totals'> = {
    dryRun: true,
    organizationField,
    scanned: 0,
    planned: 0,
    written: 0,
    rows,
    residualRows,
    residue,
    failures: [],
    notes,
  };

  if (!organizationField) {
    // Not an error, but it MUST be loud: a backfill that silently sweeps
    // nothing reads exactly like a clean database.
    notes.push(
      `no organization column resolved for '${SYS_RECORD_SHARE_BACKFILL_OBJECT}' — nothing scanned. `
      + 'On a multi-tenant install this means the engine exposed no schema for the object; '
      + 'on an install that opted the object out of system fields it is expected.',
    );
    return finish(base, options.logger);
  }

  const grants = await scanUnstampedGrants(
    engine,
    organizationField,
    { context, pageSize, maxRows },
    notes,
  );
  base.scanned = grants.length;

  // ── Address every row, and group the subjects by object ─────────────────
  const addressable: Array<{ id: string; object: string; recordId: string }> = [];
  const idsByObject = new Map<string, Set<string>>();
  for (const row of grants) {
    const id = rowId(row);
    const object = nonEmpty(row[SUBJECT_OBJECT_FIELD]);
    const recordId = nonEmpty(row[SUBJECT_ID_FIELD]);
    if (!id || !object || !recordId) {
      residue.unaddressable += 1;
      if (id) residualRows.push({ id, reason: 'unaddressable', subject: null });
      continue;
    }
    addressable.push({ id, object, recordId });
    let ids = idsByObject.get(object);
    if (!ids) idsByObject.set(object, (ids = new Set<string>()));
    ids.add(recordId);
  }

  // ── One subject read per object, projected to ITS wall column ───────────
  // `undefined` in `subjectsByObject` = the read failed for the whole object;
  // an absent map entry = the object was never read (no column to read by).
  const subjectsByObject = new Map<string, Map<string, Record<string, unknown>> | undefined>();
  for (const [object, ids] of idsByObject) {
    const column = wallColumnOf(object);
    if (!column) continue;
    try {
      subjectsByObject.set(object, await readSubjects(engine, object, column, [...ids], context));
    } catch (err) {
      subjectsByObject.set(object, undefined);
      notes.push(
        `subject read on '${object}' failed — ${String((err as Error)?.message ?? err)}. `
        + `Its grant rows were left in place (could not ask is not gone).`,
      );
    }
  }

  // ── Decide each grant ───────────────────────────────────────────────────
  for (const { id, object, recordId } of addressable) {
    const column = wallColumnOf(object);
    const leave = (reason: keyof SysRecordShareBackfillResidue, organization: string | null = null) => {
      residue[reason] += 1;
      residualRows.push({ id, reason, subject: { object, id: recordId, organization } });
    };
    if (column === undefined) { leave('subjectObjectUnknown'); continue; }
    if (column === null) { leave('subjectNotOrganizationScoped'); continue; }
    if (!subjectsByObject.has(object)) { leave('subjectReadFailed'); continue; }
    const subjects = subjectsByObject.get(object);
    if (subjects === undefined) { leave('subjectReadFailed'); continue; }
    const record = subjects.get(recordId);
    if (!record) { leave('recordNotFound'); continue; }
    const organization = nonEmpty(record[column]);
    if (!organization) { leave('recordHasNoOrganization'); continue; }
    base.planned += 1;
    rows.push({
      id,
      organizationField,
      organization,
      subject: { object, id: recordId, organization },
    });
  }

  return finish(base, options.logger);
}

/** Seal a report's totals and emit the two log lines the ruling asks for. */
function finish(
  report: Omit<SysRecordShareBackfillReport, 'totals'>,
  logger: SysRecordShareBackfillLogger | undefined,
): SysRecordShareBackfillReport {
  const sealed = { ...report, totals: totalsOf(report) };
  if (sealed.residue.recordNotFound > 0) {
    // ⭐ The orphan count, logged — the half of the ruling's "leave NULL with a
    // logged count" that the report alone cannot deliver to an operator's log.
    logger?.warn?.(
      `[sharing] sys_record_share organization backfill: ${sealed.residue.recordNotFound} grant row(s) `
        + 'reference a record that no longer exists — left NULL, not deleted; the #5103 orphan sweep '
        + '(`sweepOrphanedRecordShares`, kernel:bootstrapped) reclaims them on the next boot',
      { orphans: sealed.residue.recordNotFound, dryRun: sealed.dryRun },
    );
  }
  logger?.info?.(
    `[sharing] sys_record_share organization backfill ${sealed.dryRun ? 'DRY RUN' : 'APPLIED'}`,
    sealed.totals,
  );
  return sealed;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Write the plan. Each planned row gets ONE update carrying its id and its
 * resolved organization column — nothing else on the row is touched, which is
 * what makes the undo expressible as "write NULL back to these ids".
 *
 * The derived organization is threaded as `tenantId` on the write context too,
 * beside the elevation: the shape #8844 prescribes for a system write and the
 * one the repaired writer uses. On this verb the driver's scope keeps the NULL
 * row in reach (`organization_id = ? OR IS NULL`, #2734), so the write lands
 * exactly on the row the plan named.
 *
 * A row whose write throws is RECORDED and the sweep continues: a driver
 * rejecting one row must not cost the other N-1 their repair, and a half-done
 * sweep is safe here precisely because the next run picks up exactly what is
 * still unstamped.
 *
 * ⛔ Takes a plan rather than building one, so the rows written are the rows a
 * human read in the dry run — not a fresh scan that may have moved.
 */
export async function applySysRecordShareOrganizationBackfill(
  engine: SysRecordShareBackfillEngine,
  plan: SysRecordShareBackfillReport,
  options: SysRecordShareBackfillOptions = {},
): Promise<SysRecordShareBackfillReport> {
  const failures: SysRecordShareBackfillReport['failures'] = [];
  let written = 0;
  for (const row of plan.rows) {
    try {
      await engine.update(
        SYS_RECORD_SHARE_BACKFILL_OBJECT,
        { id: row.id, [row.organizationField]: row.organization },
        { context: { ...SYSTEM_CONTEXT, tenantId: row.organization } },
      );
      written += 1;
    } catch (err) {
      failures.push({ id: row.id, error: String((err as Error)?.message ?? err) });
    }
  }
  const applied: Omit<SysRecordShareBackfillReport, 'totals'> = {
    ...plan,
    dryRun: false,
    written,
    failures,
  };
  return finish(applied, options.logger);
}

/**
 * Plan, then (unless `dryRun`) write — the whole sweep in one call.
 *
 * Idempotent by construction rather than by a guard: the plan is built from
 * `WHERE <organization column> IS NULL`, and every write fills that column, so
 * a second call over an unchanged database plans nothing and writes nothing.
 */
export async function runSysRecordShareOrganizationBackfill(
  engine: SysRecordShareBackfillEngine,
  options: SysRecordShareBackfillOptions = {},
): Promise<SysRecordShareBackfillReport> {
  const plan = await planSysRecordShareOrganizationBackfill(engine, options);
  if (options.dryRun !== false) return plan;
  return applySysRecordShareOrganizationBackfill(engine, plan, options);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

/** Human-readable label per residue bucket — the reason, stated as a fact. */
const RESIDUE_LABELS: Record<keyof SysRecordShareBackfillResidue, string> = {
  unaddressable: 'row carries no usable id or no (object_name, record_id) pair',
  subjectObjectUnknown: "the record's object has no schema this engine can read — wall column unknowable",
  subjectNotOrganizationScoped: "the record's object has no organization column at all",
  subjectReadFailed: 'the record could not be READ (could not ask is not gone)',
  recordNotFound: 'ORPHAN — the record no longer exists (left NULL; the #5103 boot sweep deletes these)',
  recordHasNoOrganization: 'the record exists, is organization-scoped, and carries no organization itself',
};

/**
 * Render a report as the operator-facing text.
 *
 * ⭐ The residual-NULL total and the orphan count are printed for a dry run as
 * well as an applied one, and the residue is broken out by reason: those rows
 * stay invisible to every tenant-scoped reader on a walled deployment, and the
 * ruling makes that residue the maintainer's to see rather than something the
 * sweep may quietly accept.
 */
export function formatSysRecordShareOrganizationBackfillReport(
  report: SysRecordShareBackfillReport,
): string {
  const lines: string[] = [];
  lines.push(
    report.dryRun
      ? 'sys_record_share organization backfill — DRY RUN (nothing written)'
      : 'sys_record_share organization backfill — APPLIED',
  );
  lines.push('='.repeat(66));
  lines.push(`organization column : ${report.organizationField ?? '(none resolved)'}`);
  lines.push(`scanned (unstamped) : ${report.scanned}`);
  lines.push(`${report.dryRun ? 'would write' : 'written   '}          : ${report.dryRun ? report.planned : report.written}`);
  for (const row of report.rows) {
    lines.push(
      `    ${row.id} -> ${row.organizationField}=${row.organization} `
      + `(from ${row.subject.object}/${row.subject.id})`,
    );
  }
  for (const failure of report.failures) {
    lines.push(`  ✗ ${failure.id} NOT written — ${failure.error}`);
  }

  lines.push('');
  lines.push('-'.repeat(66));
  lines.push(`RESIDUAL NULL (still invisible under a wall) : ${report.totals.residualNull}`);
  lines.push(`ORPHANS (record gone; left NULL, counted)    : ${report.totals.orphans}`);
  for (const key of Object.keys(report.residue) as Array<keyof SysRecordShareBackfillResidue>) {
    lines.push(`  ${key.padEnd(30)} ${String(report.residue[key]).padStart(6)}  — ${RESIDUE_LABELS[key]}`);
  }
  for (const row of report.residualRows) {
    const subject = row.subject ? ` (${row.subject.object}/${row.subject.id})` : '';
    lines.push(`    ${row.id} stays NULL — ${row.reason}${subject}`);
  }
  for (const note of report.notes) lines.push(`  ⚠️  ${note}`);

  lines.push('');
  lines.push('-'.repeat(66));
  lines.push(
    `TOTAL scanned=${report.totals.scanned} `
    + `${report.dryRun ? 'would-write' : 'written'}=${report.dryRun ? report.totals.planned : report.totals.written} `
    + `residual-null=${report.totals.residualNull} orphans=${report.totals.orphans}`,
  );
  return lines.join('\n');
}
