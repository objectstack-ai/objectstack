// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * backfill-sys-file-organizations — the ONE-OFF repair sweep for the `sys_file`
 * rows the pre-#12745 `createFile` stranded with no organization.
 *
 * ## What this repairs, and why it is not optional
 *
 * #12745 fixed the WRITER: `StorageMetadataStore.createFile` now threads the
 * acting session's organization, so a new row reaches the driver's
 * `injectTenantOnInsert` with a `tenantId` to stamp from. It wrote nothing to
 * existing rows, and on a WALLED deployment that asymmetry is not cosmetic:
 *
 *   - the SQL driver's own tenant predicate is NULL-TOLERANT —
 *     `(organization_id = :tenantId OR organization_id IS NULL)` — so an
 *     unstamped row stayed readable by everyone;
 *   - but Layer 0 (`plugin-security`'s `computeTenantLayer0Filter`) AND-composes
 *     a STRICT `organization_id = <active org>` above it, and
 *     `bootstrap-declared-permissions.ts` states the consequence in terms:
 *     "Layer 0's strict `organization_id = :tenant` AND-composes over the
 *     driver's compatibility arm and the conjunction is the strict equality
 *     alone."
 *
 * ⇒ forward-only stamping would split the table in two: new files org-walled,
 * every existing NULL-org file invisible to EVERY principal. The backfill is
 * what keeps the observable behaviour uniform. (`single` posture is inert —
 * `computeTenantLayer0Filter` returns `null` — so nothing here changes for
 * single-tenant installs; the sweep simply finds no organization to derive.)
 *
 * ## Maintainer order — `sys_file` and nothing else
 *
 * The tree's precedent for this shape is
 * `plugin-approvals/src/backfill-platform-row-organizations.ts`, and that
 * precedent requires a MAINTAINER ORDER PER TABLE. The 2026-08-28 ruling on
 * #12745 (「12745 A回，其他同意。」 — A with backfill) IS that order, and it is
 * the order for `sys_file` ALONE. ⛔ Do not extend {@link SYS_FILE_BACKFILL_OBJECT}
 * to a second table, however similar it looks: `sys_upload_session` sits in the
 * same package with the same NULL column and is deliberately NOT swept here.
 *
 * ## Deriving the organization — from the SUBJECT, only when there is exactly one
 *
 * A `sys_file` row is the blob ledger entry; the organization it belongs to is
 * the organization of whatever HOLDS it. There are exactly two holder channels
 * in the tree, and the sweep reads both:
 *
 *  1. **Field-reference ownership** (ADR-0104 D3 wave 2) — `ref_object` /
 *     `ref_id` name the single record whose field owns this file. Exclusive by
 *     construction: at most one such slot exists per file.
 *  2. **The attachments surface** — `sys_attachment` join rows
 *     (`file_id` → `parent_object` / `parent_id`). Deliberately MANY: one file
 *     may be attached to many records.
 *
 * Every named holder is resolved, and the row is stamped **only when every one
 * of them answered and they all answered the SAME organization**. Two holders
 * in two organizations, or one holder in an organization beside another holder
 * with none, is an AMBIGUOUS file — and an ambiguous file must stay NULL:
 * stamping it into one organization is precisely the silent read-loss this
 * sweep exists to prevent, aimed at the other holder instead.
 *
 * ⛔ Nothing is guessed. In particular the uploader (`owner_id`) is NOT a
 * subject: a user may belong to many organizations, so deriving from them
 * would invent an answer the data does not carry. That is the "fabricate an
 * organization" option the precedent records as vetoed.
 *
 * ## The residue is the deliverable, not the leftovers
 *
 * ⭐ Rows that cannot be derived unambiguously stay NULL and are REPORTED —
 * {@link SysFileBackfillReport.totals}`.residualNull`, broken out by reason in
 * {@link SysFileBackfillResidue}, and printed by
 * {@link formatSysFileOrganizationBackfillReport}. Those rows remain invisible
 * to every principal on a walled deployment, and that is the maintainer's to
 * see — ⛔ never silently accepted. The count is reported for a DRY RUN too,
 * which is what makes the dry run a decision document rather than a preview.
 *
 * ## Which column, on either side of the copy
 *
 * Both the column WRITTEN on `sys_file` and the column READ on a subject are
 * resolved from the registered schema by {@link createWallOrganizationResolver}
 * — never hard-coded to `organization_id`, so an object declaring
 * `tenancy.tenantField` is read by the column it is actually walled by.
 *
 * ⛔ It deliberately does NOT reach for `@objectstack/metadata-core`'s
 * `createRecordOrganizationResolver`, and the divergence from the precedent is
 * the point of this paragraph. That resolver's limb 0 reads
 * `tenancy.organizationField`, a STAMP-ONLY key whose consumers are scope-pinned
 * by the #8778 ruling (widened by name on cloud#1395) to exactly three
 * platform-row writers; a fourth needs its own maintainer ruling. It would also
 * be the WRONG question here. That key answers "which column says who this row
 * is ABOUT"; this sweep needs "which column is this subject WALLED by", because
 * the whole purpose is to put the file behind the same wall as its holder.
 * `sys_api_key` is the shipped object where the two diverge on purpose — a
 * credential table that must stay unwalled (`tenancy.enabled: false`) while
 * recording an organization under `active_organization_id`. Stamping a file
 * from that column would wall the file into an organization its holder is not
 * walled into. So the resolution here mirrors the driver's own
 * `computeTenantField` (ADR-0066 opt-out → declared `tenantField` → injected
 * `organization_id`) and stops there.
 *
 * ## Idempotency
 *
 * The scan is `WHERE <organization column> IS NULL` and every write fills that
 * column, so a repaired row cannot match again: `planned` and `written` are
 * both 0 on a second run over an unchanged database. Rows deliberately left
 * alone keep matching and keep being REPORTED, never re-written.
 * `backfill-sys-file-organizations.test.ts` asserts the second run rather than
 * describing it.
 *
 * ## Usage
 *
 * Not exported from the package index and not shipped in `dist` — this is a
 * one-off operational module, not platform surface (the same posture as the
 * approvals precedent). Run it server-side from a context that holds an engine:
 *
 * ```ts
 * const report = await planSysFileOrganizationBackfill(engine);
 * console.log(formatSysFileOrganizationBackfillReport(report));  // writes nothing
 * // …read it, then:
 * await applySysFileOrganizationBackfill(engine, report);
 * ```
 *
 * Rollback posture: the dry run names every row id it would touch and the value
 * it would write, so the undo is to write the previous value (NULL) back to
 * exactly those ids.
 */

import { isTenancyDisabled } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

/**
 * The ONE object this sweep repairs. ⛔ Scope-pinned by the 2026-08-28 ruling
 * on #12745 — a second table needs its own maintainer order (see the module
 * doc).
 */
export const SYS_FILE_BACKFILL_OBJECT = 'sys_file';

/** The attachments join table, and the columns naming a file's holder record. */
const ATTACHMENT_OBJECT = 'sys_attachment';
const ATTACHMENT_FILE_FIELD = 'file_id';
const ATTACHMENT_PARENT_OBJECT_FIELD = 'parent_object';
const ATTACHMENT_PARENT_ID_FIELD = 'parent_id';

/** The field-reference owner columns on `sys_file` itself (ADR-0104 D3 wave 2). */
const REF_OBJECT_FIELD = 'ref_object';
const REF_ID_FIELD = 'ref_id';

const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] };
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 100_000;
/** Id batches for holder / subject lookups. */
const LOOKUP_CHUNK = 100;

/**
 * The engine surface the sweep needs — a structural subset of the ObjectQL
 * engine, declared here so the module can be driven by a test double without
 * pulling the service in.
 *
 * `getSchema` is what the column resolver probes for. An engine without it
 * resolves every organization column to `null`, which would make the sweep a
 * silent no-op — so the report says so out loud instead (see `notes`).
 */
export interface SysFileBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown[]>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
  getSchema?(object: string): unknown;
}

/** Which holder channel named the subject a planned row was derived from. */
export type SysFileSubjectProvenance = 'field-reference' | 'attachment';

/** One holder of a file, and the organization it resolved to. */
export interface SysFileSubject {
  object: string;
  id: string;
  via: SysFileSubjectProvenance;
  /** `null` when the holder is unreadable, unwalled, or carries no value. */
  organization: string | null;
}

/** One row the sweep would write, named in full so the dry run is auditable. */
export interface PlannedSysFileRow {
  id: string;
  /** The column on `sys_file` that carries its organization (schema-resolved). */
  organizationField: string;
  /** The value that would be written. */
  organization: string;
  /** Every holder that answered, so the derivation is checkable without re-running it. */
  subjects: SysFileSubject[];
}

/**
 * ⭐ Why each residual row is still NULL. Every counter here is a row that
 * stays invisible under a wall, so the breakdown — not just the total — is the
 * reportable outcome.
 */
export interface SysFileBackfillResidue {
  /** The row carries no id the sweep can address. */
  unaddressable: number;
  /** No field reference and no attachment row — nothing holds this file. */
  noSubject: number;
  /** Holders are named but none of them could be read (deleted / unmounted object). */
  subjectNotFound: number;
  /** Every readable holder lives on an object with no organization column at all. */
  subjectNotOrganizationScoped: number;
  /** Holders are org-scoped, but every one of them carries a NULL organization. */
  subjectHasNoOrganization: number;
  /**
   * ⛔ Out of the ruling: the holders do not agree on ONE organization — either
   * two holders name two organizations, or one answered and another did not.
   * Stamping either answer would hide the file from the other holder's readers.
   */
  ambiguousSubjects: number;
}

/** One row the sweep left alone, with the reason, so the residue is checkable. */
export interface ResidualSysFileRow {
  id: string;
  reason: keyof SysFileBackfillResidue;
  /** The organizations the holders offered — 0, or 2+ when ambiguous. */
  candidateOrganizations: string[];
  subjects: SysFileSubject[];
}

/** The whole sweep's plan / outcome. */
export interface SysFileBackfillReport {
  /** `true` when nothing was written. */
  dryRun: boolean;
  /** The schema-resolved organization column on `sys_file`, or `null`. */
  organizationField: string | null;
  /** Rows matching `<organization column> IS NULL` at scan time. */
  scanned: number;
  /** Rows the sweep would write (dry run) — see {@link PlannedSysFileRow}. */
  planned: number;
  /** Rows actually written. Always 0 on a dry run. */
  written: number;
  rows: PlannedSysFileRow[];
  /** ⭐ Rows left NULL, one entry each, with the reason. */
  residualRows: ResidualSysFileRow[];
  residue: SysFileBackfillResidue;
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
  };
}

/** Options both halves of the sweep accept. */
export interface SysFileBackfillOptions {
  /**
   * Execution context for every read/write. Defaults to a system context — the
   * sweep has to see rows across every organization, and a walled read would
   * hide from it exactly the rows it exists to find.
   */
  context?: unknown;
  /** Rows per page while scanning. */
  pageSize?: number;
  /** Hard ceiling, so a pathological table cannot spin forever. */
  maxRowsPerObject?: number;
  /**
   * `false` writes. Defaults to `true`: a sweep over existing data that
   * defaults to writing is one typo away from an unplanned migration, and the
   * ruling puts the dry run first anyway.
   */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Column resolution — the WALL column, asked of the schema
// ---------------------------------------------------------------------------

/**
 * "Which column is THIS object walled by?", resolved from the registered
 * schema and memoized per object.
 *
 * Mirrors `SqlDriver.computeTenantField` limb for limb — ADR-0066 opt-out
 * first, then a declared `tenancy.tenantField` that the object really has,
 * then the injected `organization_id` — because that is the platform's single
 * existing answer to the question, and a file stamped by a different rule
 * would be walled by one column and read through another.
 *
 * ⛔ It stops short of `tenancy.organizationField` on purpose; the module doc
 * carries the argument (scope-pinned key, and the wrong question for a wall).
 */
export function createWallOrganizationResolver(engine: SysFileBackfillEngine): {
  organizationFieldFor(objectName: string): string | null;
  organizationOf(objectName: string, record: unknown): string | null;
} {
  const fieldSetCache = new Map<string, Set<string> | null>();
  const columnCache = new Map<string, string | null>();

  const schemaOf = (objectName: string): unknown => {
    try {
      return typeof engine.getSchema === 'function' ? engine.getSchema(objectName) : null;
    } catch {
      // Best-effort in both directions: an object this install does not mount
      // resolves to "no organization column", which the caller reports rather
      // than treating as an error.
      return null;
    }
  };

  const hasField = (objectName: string, field: string): boolean => {
    let set = fieldSetCache.get(objectName);
    if (set === undefined) {
      set = null;
      const fields = (schemaOf(objectName) as { fields?: unknown } | null)?.fields;
      if (Array.isArray(fields)) {
        set = new Set<string>(
          fields.map((f) => (f as { name?: unknown })?.name).filter((n): n is string => typeof n === 'string'),
        );
      } else if (fields && typeof fields === 'object') {
        set = new Set<string>(Object.keys(fields as Record<string, unknown>));
      }
      fieldSetCache.set(objectName, set);
    }
    return set != null && set.has(field);
  };

  const organizationFieldFor = (objectName: string): string | null => {
    const hit = columnCache.get(objectName);
    if (hit !== undefined) return hit;
    const schema = schemaOf(objectName);
    let resolved: string | null = null;
    if (schema && typeof schema === 'object' && !isTenancyDisabled(schema)) {
      const declared = (schema as { tenancy?: { tenantField?: unknown } }).tenancy?.tenantField;
      if (typeof declared === 'string' && declared.length > 0 && hasField(objectName, declared)) {
        resolved = declared;
      } else if (hasField(objectName, SystemFieldName.ORGANIZATION_ID)) {
        resolved = SystemFieldName.ORGANIZATION_ID;
      }
    }
    columnCache.set(objectName, resolved);
    return resolved;
  };

  const organizationOf = (objectName: string, record: unknown): string | null => {
    const column = organizationFieldFor(objectName);
    if (!column || !record || typeof record !== 'object') return null;
    return nonEmpty((record as Record<string, unknown>)[column]);
  };

  return { organizationFieldFor, organizationOf };
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

function emptyResidue(): SysFileBackfillResidue {
  return {
    unaddressable: 0,
    noSubject: 0,
    subjectNotFound: 0,
    subjectNotOrganizationScoped: 0,
    subjectHasNoOrganization: 0,
    ambiguousSubjects: 0,
  };
}

function totalsOf(report: Omit<SysFileBackfillReport, 'totals'>): SysFileBackfillReport['totals'] {
  return {
    scanned: report.scanned,
    planned: report.planned,
    written: report.written,
    // ⭐ Every scanned row that did not get written is still NULL. On a dry run
    // `written` is 0, so this is the whole scan — which is the honest answer to
    // "what is still invisible if I stop here?".
    residualNull: report.scanned - report.written,
  };
}

/**
 * Page through every `sys_file` row whose organization column is unset.
 *
 * Ordered by `id` so the pages partition the population instead of overlapping,
 * and read in full BEFORE anything is written — a plan built while writing
 * would move rows out from under its own offset.
 */
async function scanUnstampedFiles(
  engine: SysFileBackfillEngine,
  organizationField: string,
  options: { context: unknown; pageSize: number; maxRowsPerObject: number },
  notes: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < options.maxRowsPerObject; offset += options.pageSize) {
    let page: unknown[];
    try {
      page = await engine.find(SYS_FILE_BACKFILL_OBJECT, {
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
        `scan of '${SYS_FILE_BACKFILL_OBJECT}' failed — ${String((err as Error)?.message ?? err)}`,
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

/** Read a set of records by id, keyed by id. */
async function readById(
  engine: SysFileBackfillEngine,
  object: string,
  ids: readonly string[],
  context: unknown,
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  for (const batch of chunk(ids, LOOKUP_CHUNK)) {
    let rows: unknown[] = [];
    try {
      rows = await engine.find(object, {
        where: { id: { $in: batch } },
        limit: batch.length,
        context,
      });
    } catch {
      // An object this install does not mount answers with a throw. That is
      // "subject not found", not a reason to abort the sweep.
      rows = [];
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = rowId(row);
      if (id) found.set(id, row as Record<string, unknown>);
    }
  }
  return found;
}

/**
 * Every attachment holder of the scanned files, grouped by file id.
 *
 * One paged read per batch of file ids rather than one per file: the join table
 * is the hot side of this sweep.
 */
async function readAttachmentHolders(
  engine: SysFileBackfillEngine,
  fileIds: readonly string[],
  context: unknown,
  notes: string[],
): Promise<Map<string, Array<{ object: string; id: string }>>> {
  const byFile = new Map<string, Array<{ object: string; id: string }>>();
  for (const batch of chunk(fileIds, LOOKUP_CHUNK)) {
    let rows: unknown[] = [];
    try {
      rows = await engine.find(ATTACHMENT_OBJECT, {
        where: { [ATTACHMENT_FILE_FIELD]: { $in: batch } },
        context,
      });
    } catch (err) {
      // ⚠️ Loud: without the attachments channel a shared file looks like it
      // has no holder at all, and "no subject" would be reported where
      // "could not look" is the truth.
      notes.push(
        `attachment lookup on '${ATTACHMENT_OBJECT}' failed — ${String((err as Error)?.message ?? err)}. `
        + 'Files held only through the attachments surface are reported as having no subject in this run.',
      );
      continue;
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const fileId = nonEmpty(record[ATTACHMENT_FILE_FIELD]);
      const parentObject = nonEmpty(record[ATTACHMENT_PARENT_OBJECT_FIELD]);
      const parentId = nonEmpty(record[ATTACHMENT_PARENT_ID_FIELD]);
      if (!fileId || !parentObject || !parentId) continue;
      let holders = byFile.get(fileId);
      if (!holders) byFile.set(fileId, (holders = []));
      if (!holders.some((h) => h.object === parentObject && h.id === parentId)) {
        holders.push({ object: parentObject, id: parentId });
      }
    }
  }
  return byFile;
}

// ---------------------------------------------------------------------------
// Plan (the dry run)
// ---------------------------------------------------------------------------

/**
 * Build the sweep's plan — the DRY RUN. Reads only; `written` is 0.
 *
 * This is the deliverable in its own right: it is the only thing that shows
 * both what will move and — ⭐ via {@link SysFileBackfillReport.residue} — what
 * will still be invisible after it moves.
 */
export async function planSysFileOrganizationBackfill(
  engine: SysFileBackfillEngine,
  options: SysFileBackfillOptions = {},
): Promise<SysFileBackfillReport> {
  const context = options.context ?? SYSTEM_CONTEXT;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRowsPerObject = options.maxRowsPerObject ?? DEFAULT_MAX_ROWS;
  const resolver = createWallOrganizationResolver(engine);

  const notes: string[] = [];
  const rows: PlannedSysFileRow[] = [];
  const residualRows: ResidualSysFileRow[] = [];
  const residue = emptyResidue();
  const organizationField = resolver.organizationFieldFor(SYS_FILE_BACKFILL_OBJECT);

  const base: Omit<SysFileBackfillReport, 'totals'> = {
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
      `no organization column resolved for '${SYS_FILE_BACKFILL_OBJECT}' — nothing scanned. `
      + 'On a multi-tenant install this means the engine exposed no schema for the object; '
      + 'on an install that opted the object out of system fields it is expected.',
    );
    return { ...base, totals: totalsOf(base) };
  }

  const files = await scanUnstampedFiles(
    engine,
    organizationField,
    { context, pageSize, maxRowsPerObject },
    notes,
  );
  base.scanned = files.length;

  // ── Collect every holder the scanned files name, in one pass ──────────────
  const addressable: Array<{ id: string; row: Record<string, unknown> }> = [];
  for (const row of files) {
    const id = rowId(row);
    if (!id) {
      residue.unaddressable += 1;
      continue;
    }
    addressable.push({ id, row });
  }

  const attachmentHolders = addressable.length
    ? await readAttachmentHolders(engine, addressable.map((f) => f.id), context, notes)
    : new Map<string, Array<{ object: string; id: string }>>();

  // Group holder ids by object so the subject re-read is one query per object
  // rather than one per file.
  const holdersByFile = new Map<string, Array<{ object: string; id: string; via: SysFileSubjectProvenance }>>();
  const idsByObject = new Map<string, Set<string>>();
  for (const { id, row } of addressable) {
    const holders: Array<{ object: string; id: string; via: SysFileSubjectProvenance }> = [];
    const refObject = nonEmpty(row[REF_OBJECT_FIELD]);
    const refId = nonEmpty(row[REF_ID_FIELD]);
    if (refObject && refId) holders.push({ object: refObject, id: refId, via: 'field-reference' });
    for (const holder of attachmentHolders.get(id) ?? []) {
      if (holders.some((h) => h.object === holder.object && h.id === holder.id)) continue;
      holders.push({ ...holder, via: 'attachment' });
    }
    holdersByFile.set(id, holders);
    for (const holder of holders) {
      let ids = idsByObject.get(holder.object);
      if (!ids) idsByObject.set(holder.object, (ids = new Set<string>()));
      ids.add(holder.id);
    }
  }

  const liveByObject = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [object, ids] of idsByObject) {
    liveByObject.set(object, await readById(engine, object, [...ids], context));
  }

  // ── Decide each file ─────────────────────────────────────────────────────
  for (const { id } of addressable) {
    const holders = holdersByFile.get(id) ?? [];
    if (holders.length === 0) {
      residue.noSubject += 1;
      residualRows.push({ id, reason: 'noSubject', candidateOrganizations: [], subjects: [] });
      continue;
    }

    const subjects: SysFileSubject[] = [];
    let readable = 0;
    let orgScoped = 0;
    for (const holder of holders) {
      const record = liveByObject.get(holder.object)?.get(holder.id) ?? null;
      if (record) readable += 1;
      if (resolver.organizationFieldFor(holder.object)) orgScoped += 1;
      subjects.push({
        object: holder.object,
        id: holder.id,
        via: holder.via,
        organization: record ? resolver.organizationOf(holder.object, record) : null,
      });
    }

    const answered = subjects.filter((s) => s.organization != null);
    const distinct = [...new Set(answered.map((s) => s.organization as string))];

    if (distinct.length === 1 && answered.length === subjects.length) {
      base.planned += 1;
      rows.push({ id, organizationField, organization: distinct[0]!, subjects });
      continue;
    }

    // Everything below stays NULL and is reported. The reason is chosen from
    // the most specific fact available, so a reader can act on it.
    const reason: keyof SysFileBackfillResidue =
      distinct.length > 0
        ? 'ambiguousSubjects'          // 2+ organizations, or one holder answered and another did not
        : readable === 0
          ? 'subjectNotFound'
          : orgScoped === 0
            ? 'subjectNotOrganizationScoped'
            : 'subjectHasNoOrganization';
    residue[reason] += 1;
    residualRows.push({ id, reason, candidateOrganizations: distinct, subjects });
  }

  return { ...base, totals: totalsOf(base) };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Write the plan. Each planned row gets ONE update carrying its id and its
 * resolved organization column — nothing else on the row is touched, which is
 * what makes the undo expressible as "write NULL back to these ids".
 *
 * A row whose write throws is RECORDED and the sweep continues: a driver
 * rejecting one row must not cost the other N-1 their repair, and a half-done
 * sweep is safe here precisely because the next run picks up exactly what is
 * still unstamped.
 *
 * ⛔ Takes a plan rather than building one, so the rows written are the rows a
 * human read in the dry run — not a fresh scan that may have moved.
 */
export async function applySysFileOrganizationBackfill(
  engine: SysFileBackfillEngine,
  plan: SysFileBackfillReport,
  options: SysFileBackfillOptions = {},
): Promise<SysFileBackfillReport> {
  const context = options.context ?? SYSTEM_CONTEXT;
  const failures: SysFileBackfillReport['failures'] = [];
  let written = 0;
  for (const row of plan.rows) {
    try {
      await engine.update(
        SYS_FILE_BACKFILL_OBJECT,
        { id: row.id, [row.organizationField]: row.organization },
        { context },
      );
      written += 1;
    } catch (err) {
      failures.push({ id: row.id, error: String((err as Error)?.message ?? err) });
    }
  }
  const applied: Omit<SysFileBackfillReport, 'totals'> = {
    ...plan,
    dryRun: false,
    written,
    failures,
  };
  return { ...applied, totals: totalsOf(applied) };
}

/**
 * Plan, then (unless `dryRun`) write — the whole sweep in one call.
 *
 * Idempotent by construction rather than by a guard: the plan is built from
 * `WHERE <organization column> IS NULL`, and every write fills that column, so
 * a second call over an unchanged database plans nothing and writes nothing.
 */
export async function runSysFileOrganizationBackfill(
  engine: SysFileBackfillEngine,
  options: SysFileBackfillOptions = {},
): Promise<SysFileBackfillReport> {
  const plan = await planSysFileOrganizationBackfill(engine, options);
  if (options.dryRun !== false) return plan;
  return applySysFileOrganizationBackfill(engine, plan, options);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

/** Human-readable label per residue bucket — the reason, stated as a fact. */
const RESIDUE_LABELS: Record<keyof SysFileBackfillResidue, string> = {
  unaddressable: 'row carries no usable id',
  noSubject: 'nothing holds this file (no field reference, no attachment)',
  subjectNotFound: 'every holder named on the row is unreadable / gone',
  subjectNotOrganizationScoped: 'every holder lives on an object with no organization column',
  subjectHasNoOrganization: 'holders are organization-scoped but carry no organization',
  ambiguousSubjects: 'holders do not agree on ONE organization (OUT OF RULING — never guessed)',
};

/**
 * Render a report as the operator-facing text.
 *
 * ⭐ The residual-NULL total is printed for a dry run as well as an applied
 * one, and broken out by reason: those rows stay invisible to every principal
 * on a walled deployment, and the ruling makes that residue the maintainer's
 * to see rather than something the sweep may quietly accept.
 */
export function formatSysFileOrganizationBackfillReport(report: SysFileBackfillReport): string {
  const lines: string[] = [];
  lines.push(
    report.dryRun
      ? 'sys_file organization backfill — DRY RUN (nothing written)'
      : 'sys_file organization backfill — APPLIED',
  );
  lines.push('='.repeat(66));
  lines.push(`organization column : ${report.organizationField ?? '(none resolved)'}`);
  lines.push(`scanned (unstamped) : ${report.scanned}`);
  lines.push(`${report.dryRun ? 'would write' : 'written   '}          : ${report.dryRun ? report.planned : report.written}`);
  for (const row of report.rows) {
    const from = row.subjects
      .map((s) => `${s.via}:${s.object}/${s.id}=${s.organization ?? '(none)'}`)
      .join(', ');
    lines.push(`    ${row.id} -> ${row.organizationField}=${row.organization} (from ${from})`);
  }
  for (const failure of report.failures) {
    lines.push(`  ✗ ${failure.id} NOT written — ${failure.error}`);
  }

  lines.push('');
  lines.push('-'.repeat(66));
  lines.push(`RESIDUAL NULL (still invisible under a wall) : ${report.totals.residualNull}`);
  for (const key of Object.keys(report.residue) as Array<keyof SysFileBackfillResidue>) {
    lines.push(`  ${key.padEnd(30)} ${String(report.residue[key]).padStart(6)}  — ${RESIDUE_LABELS[key]}`);
  }
  for (const row of report.residualRows) {
    const candidates = row.candidateOrganizations.length
      ? ` candidates=[${row.candidateOrganizations.join(', ')}]`
      : '';
    lines.push(`    ${row.id} stays NULL — ${row.reason}${candidates}`);
  }
  for (const note of report.notes) lines.push(`  ⚠️  ${note}`);

  lines.push('');
  lines.push('-'.repeat(66));
  lines.push(
    `TOTAL scanned=${report.totals.scanned} `
    + `${report.dryRun ? 'would-write' : 'written'}=${report.dryRun ? report.totals.planned : report.totals.written} `
    + `residual-null=${report.totals.residualNull}`,
  );
  return lines.join('\n');
}
