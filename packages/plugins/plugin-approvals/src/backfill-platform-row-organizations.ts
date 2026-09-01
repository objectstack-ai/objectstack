// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * backfill-platform-row-organizations — the ONE-OFF repair sweep for the
 * platform rows the pre-#10101 writers stranded with no organization.
 *
 * ## What this repairs, and what it deliberately does not
 *
 * #10101 (landed as PR #11311) fixed the WRITERS: a `sys_approval_request` and
 * a `sys_automation_run` are now stamped from the SUBJECT record's own
 * organization, with the acting context as the ruled fallback. It wrote
 * nothing to existing rows, so the population produced before it persists —
 * measured on cloud#1395 as pending approval requests that LOCK the record
 * they are about while being invisible in every organization-scoped inbox,
 * their own owner's included, plus unattributed automation-run history.
 *
 * This module is that backfill, on the maintainer's 2026-08-23 ruling
 * (direction 3): a one-off, idempotent sweep deriving each stranded row's
 * organization from its SUBJECT record, **only for rows whose subject HAS an
 * organization**, dry-run first.
 *
 * ⛔ Rows whose subject ALSO has no organization are OUT OF THE RULING. They
 * are counted and reported (`skipped.subjectHasNoOrganization`) and never
 * written: the acting-context fallback the WRITERS apply is not available to a
 * repair — the acting context is gone — and inventing one is exactly the
 * "fabricate an organization" option (Option C) that stayed vetoed on
 * cloud#1395. A reported count is the deliverable for those rows.
 *
 * ⛔ It does NOT touch the write path, and it does NOT unify anybody's
 * organization column. Both the column it READS on a subject and the column it
 * WRITES on a platform row are resolved from the registered schema through the
 * ONE shared resolver (`createRecordOrganizationResolver`,
 * `@objectstack/metadata-core`) — never hard-coded to `organization_id`. That
 * is what keeps `sys_api_key`'s deliberate divergence intact: its
 * `tenancy.organizationField: 'active_organization_id'` (stamp-only, #8778)
 * wins limb 0 of the resolver, so a platform row ABOUT an API key is repaired
 * from that column, and the credential table itself is never written to. A
 * sweep written on the intuition "unify everything onto one organization
 * field" would flatten that fork; asking the schema cannot.
 *
 * ## Subject precedence — live record first, write-time snapshot second
 *
 * The same order `openNodeRequest` resolves with
 * (`organizationOf(object, liveRecord, triggerSnapshot)`), and for the same
 * reason one level up: a repair exists to put the row behind the wall its
 * subject is behind NOW. The snapshot is the fallback for a subject that has
 * since been deleted (`payload_json` for an approval request, `context_json`'s
 * `record` for a paused automation run — terminal run rows carry no context
 * blob, so they resolve from the live record or not at all). Every planned row
 * records which of the two answered (`resolvedFrom`), so a dry-run reader can
 * see the snapshot-derived rows without re-deriving them.
 *
 * ⚠️ This is the one place the sweep reads differently from the automation
 * WRITER, which resolves from the trigger snapshot alone — it is serializing
 * in-memory state and has no live read available at that moment. A repair
 * does. The issue names this ("subject-record re-read at repair time") as
 * blast radius to be deliberate about rather than as a thing to avoid.
 *
 * ## Child rows move with their parent
 *
 * `sys_approval_action` and `sys_approval_approver` are stamped from the same
 * `requestOrg` as their request ("all three move together"), so they are swept
 * from the PARENT ROW's organization rather than re-resolved from the subject
 * — one resolution per request, never two answers for one request. Sweeping
 * them by their own null also makes an interrupted run self-completing: a
 * child left behind by a partial write is repaired on the next run, and the
 * run after that writes nothing.
 *
 * ## Idempotency
 *
 * Every scan is `WHERE <organization column> IS NULL`, and every write fills
 * that column, so a repaired row cannot match again. Rows deliberately skipped
 * (subject without an organization, unaddressable, missing) keep matching and
 * keep being skipped — they are re-reported, never re-written. `planned` and
 * `written` are both 0 on a second run over an unchanged database, and
 * `backfill-platform-row-organizations.test.ts` asserts exactly that rather
 * than asserting the property in prose.
 *
 * ## Usage
 *
 * Not exported from the package index and not shipped in `dist` — this is a
 * one-off operational module, not platform surface. Run it server-side from a
 * boot context that already holds an engine:
 *
 * ```ts
 * const report = await planPlatformRowOrganizationBackfill(engine);
 * console.log(formatBackfillReport(report));   // dry run: writes nothing
 * ```
 *
 * Rollback posture is stated on the PR: the dry-run report names every row id
 * it would touch, so the undo is to write the previous value (NULL) back to
 * exactly those ids.
 */

import { createRecordOrganizationResolver } from '@objectstack/metadata-core';

/**
 * The engine surface the sweep needs — a structural subset of `ApprovalEngine`
 * / the ObjectQL engine, declared here so the module can be driven by a test
 * double without pulling the service in.
 *
 * `getSchema` is what the shared resolver probes for. An engine without it
 * resolves every organization column to `null`, which would make the sweep a
 * silent no-op — so the report says so out loud instead (see `notes`).
 */
export interface BackfillEngine {
  find(object: string, options?: unknown): Promise<unknown[]>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
  getSchema?(object: string): unknown;
}

/** A child table stamped from its parent platform row's organization. */
export interface BackfillChild {
  /** The child object name. */
  object: string;
  /** The child column naming its parent platform row. */
  parentField: string;
}

/** One platform table the sweep repairs, plus how to find its subject. */
export interface BackfillTarget {
  /** The platform object carrying stranded rows. */
  object: string;
  /** Column naming the SUBJECT's object. */
  subjectObjectField: string;
  /** Column naming the SUBJECT's record id. */
  subjectIdField: string;
  /** JSON column carrying the write-time subject snapshot, if the row has one. */
  snapshotField?: string;
  /** Path to the record inside the parsed snapshot (`[]` = the snapshot IS the record). */
  snapshotPath?: readonly string[];
  /** Status column, reported as a per-status breakdown so retention posture stays visible. */
  statusField?: string;
  /** Tables stamped from THIS row's organization. */
  children?: readonly BackfillChild[];
}

/**
 * The tables the ruling's population lives in.
 *
 * `sys_automation_run` is swept in EVERY status, deliberately. Its terminal
 * (`completed` / `failed`) history is subject to the object's declared
 * retention (`maxAge: '30d'`, `onlyWhen: status in [completed, failed]`), so
 * those rows age out on their own — but retention is a configurable sweep, an
 * install that has it disabled keeps them forever, and the 30-day window is
 * precisely the window an operator investigating this defect reads. The
 * ruling's criterion is the subject's organization, not the row's status, so
 * no status carve-out is encoded here; the per-status breakdown in the report
 * is what keeps the retention fact visible to whoever reads the dry run.
 */
export const BACKFILL_TARGETS: readonly BackfillTarget[] = [
  {
    object: 'sys_approval_request',
    subjectObjectField: 'object_name',
    subjectIdField: 'record_id',
    // `payload_json` is `JSON.stringify(input.record)` — the subject record
    // itself, snapshotted at submission time.
    snapshotField: 'payload_json',
    snapshotPath: [],
    statusField: 'status',
    children: [
      { object: 'sys_approval_action', parentField: 'request_id' },
      { object: 'sys_approval_approver', parentField: 'request_id' },
    ],
  },
  {
    object: 'sys_automation_run',
    subjectObjectField: 'trigger_object',
    subjectIdField: 'trigger_record_id',
    // `context_json` is the serialized AutomationContext; the trigger record
    // sits at `.record`. Written on every paused row, and — since #13909 —
    // on the one class of TERMINAL row that carries a restorable suspension
    // (a run whose resume consumed its pause and then failed downstream).
    // Every other terminal row still has none, so those still resolve from the
    // live subject or not at all. Nothing here needs to branch on which: a row
    // that HAS the snapshot uses it, exactly as a paused row does.
    snapshotField: 'context_json',
    snapshotPath: ['record'],
    statusField: 'status',
  },
];

/** Which candidate answered for a planned row. */
export type SubjectProvenance = 'live-record' | 'snapshot' | 'parent-row';

/** One row the sweep would write, named in full so the dry run is auditable. */
export interface PlannedRow {
  object: string;
  id: string;
  /** The column on THIS row that carries its organization (schema-resolved). */
  organizationField: string;
  /** The value that would be written. */
  organization: string;
  subjectObject: string | null;
  subjectId: string | null;
  resolvedFrom: SubjectProvenance;
  status?: string | null;
}

/** Why a scanned row was left alone. */
export interface BackfillSkips {
  /** ⛔ Out of the ruling: the subject exists and has no organization either. */
  subjectHasNoOrganization: number;
  /** The row names no subject object / record id at all. */
  subjectUnaddressable: number;
  /** The subject row is gone and no write-time snapshot survives it. */
  subjectNotFound: number;
  /** A child row whose parent has (and would get) no organization. */
  parentHasNoOrganization: number;
}

/** Per-object plan and outcome — the unit the dry-run report is broken out by. */
export interface ObjectPlan {
  object: string;
  /** `subject-derived` for a platform row, `parent-derived` for its children. */
  role: 'subject-derived' | 'parent-derived';
  /** The schema-resolved organization column, or `null` when it has none here. */
  organizationField: string | null;
  scanned: number;
  planned: number;
  written: number;
  skipped: BackfillSkips;
  /** Planned rows per status value, when the object declares a status column. */
  plannedByStatus: Record<string, number>;
  /** Ids skipped as out-of-ruling — reported so the count is checkable, never written. */
  outOfRulingScopeIds: string[];
  /** Planned rows whose write threw. Reported, never retried, never fatal. */
  failures: Array<{ id: string; error: string }>;
  rows: PlannedRow[];
  /** Conditions a reader must see, e.g. "this engine exposes no such column". */
  notes: string[];
}

/** The whole sweep's plan / outcome. */
export interface BackfillReport {
  /** `true` when nothing was written. */
  dryRun: boolean;
  objects: ObjectPlan[];
  totals: {
    scanned: number;
    planned: number;
    written: number;
    outOfRulingScope: number;
  };
}

/** Options both halves of the sweep accept. */
export interface BackfillOptions {
  /**
   * Execution context for every read/write. Defaults to a system context —
   * the sweep has to see rows across every organization, exactly as the
   * writers' `SYSTEM_CTX` does.
   */
  context?: unknown;
  /** Rows per page while scanning. */
  pageSize?: number;
  /** Hard ceiling per object, so a pathological table cannot spin forever. */
  maxRowsPerObject?: number;
  /**
   * `false` writes. Defaults to `true`: a sweep over existing data that
   * defaults to writing is one typo away from an unplanned migration, and the
   * ruling puts the dry run first anyway.
   */
  dryRun?: boolean;
}

const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] };
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 100_000;
/** Id batches for subject / parent lookups. */
const LOOKUP_CHUNK = 100;

function emptySkips(): BackfillSkips {
  return {
    subjectHasNoOrganization: 0,
    subjectUnaddressable: 0,
    subjectNotFound: 0,
    parentHasNoOrganization: 0,
  };
}

function newObjectPlan(object: string, role: ObjectPlan['role'], organizationField: string | null): ObjectPlan {
  return {
    object,
    role,
    organizationField,
    scanned: 0,
    planned: 0,
    written: 0,
    skipped: emptySkips(),
    plannedByStatus: {},
    outOfRulingScopeIds: [],
    failures: [],
    rows: [],
    notes: [],
  };
}

/** `''` and `null` and a non-string all mean "no organization here". */
function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function rowId(row: unknown): string | null {
  const raw = (row as Record<string, unknown> | null)?.id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw === 'number') return String(raw);
  return null;
}

function parseSnapshot(raw: unknown, path: readonly string[]): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A snapshot that will not parse is not a subject — the row falls through
    // to the live record, or is reported as unresolved. Never a throw: one
    // corrupt blob must not abort a sweep over thousands of healthy rows.
    return null;
  }
  let cursor: unknown = parsed;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor && typeof cursor === 'object' && !Array.isArray(cursor)
    ? (cursor as Record<string, unknown>)
    : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Page through every row of `object` whose organization column is unset.
 *
 * Ordered by `id` so the pages partition the population instead of
 * overlapping, and read in full BEFORE anything is written — a plan built
 * while writing would move rows out from under its own offset.
 */
async function scanUnstampedRows(
  engine: BackfillEngine,
  object: string,
  organizationField: string,
  options: Required<Pick<BackfillOptions, 'pageSize' | 'maxRowsPerObject'>> & { context: unknown },
  plan: ObjectPlan,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < options.maxRowsPerObject; offset += options.pageSize) {
    let page: unknown[];
    try {
      page = await engine.find(object, {
        where: { [organizationField]: null },
        limit: options.pageSize,
        offset,
        orderBy: [{ field: 'id', order: 'asc' }],
        context: options.context,
      });
    } catch (err) {
      // An install that does not mount the owning plugin has no such table.
      // Named, not thrown: one absent table must not cost the sweep the other
      // three, and a reader has to be able to tell "no stranded rows" from
      // "never looked".
      plan.notes.push(`scan of '${object}' failed — ${String((err as Error)?.message ?? err)}`);
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
  engine: BackfillEngine,
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
      // An object that is not registered on this install (a plugin that is not
      // mounted) answers with a throw. That is "subject not found", not a
      // reason to abort the sweep.
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
 * Build the sweep's plan — the DRY RUN. Reads only; `written` is 0 on every
 * object it returns.
 *
 * This is the deliverable in its own right: it is the only thing that shows
 * what will move before a single row is written.
 */
export async function planPlatformRowOrganizationBackfill(
  engine: BackfillEngine,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const context = options.context ?? SYSTEM_CONTEXT;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRowsPerObject = options.maxRowsPerObject ?? DEFAULT_MAX_ROWS;
  const scanOptions = { context, pageSize, maxRowsPerObject };
  // ⛔ ONE resolver for the whole sweep, and the only source of "which column
  // carries this object's organization" on either side of the copy.
  const resolver = createRecordOrganizationResolver(engine);
  const objects: ObjectPlan[] = [];

  for (const target of BACKFILL_TARGETS) {
    const organizationField = resolver.organizationFieldFor(target.object);
    const plan = newObjectPlan(target.object, 'subject-derived', organizationField);
    objects.push(plan);
    if (!organizationField) {
      // Not an error: a single-tenant install genuinely has no such column, and
      // so does an engine double with no `getSchema`. Both must be LOUD — a
      // backfill that silently sweeps nothing is the worst possible outcome,
      // because it reads exactly like a clean database.
      plan.notes.push(
        `no organization column resolved for '${target.object}' — nothing scanned. `
        + 'On a multi-tenant install this means the engine exposed no schema for the object; '
        + 'on a single-tenant install it is expected.',
      );
      continue;
    }

    const rows = await scanUnstampedRows(engine, target.object, organizationField, scanOptions, plan);
    plan.scanned = rows.length;

    // Group the addressable rows by subject object so the live re-read is one
    // query per object rather than one per row.
    const bySubjectObject = new Map<string, Set<string>>();
    for (const row of rows) {
      const subjectObject = nonEmpty(row[target.subjectObjectField]);
      const subjectId = nonEmpty(row[target.subjectIdField]);
      if (!subjectObject || !subjectId) continue;
      let ids = bySubjectObject.get(subjectObject);
      if (!ids) bySubjectObject.set(subjectObject, (ids = new Set<string>()));
      ids.add(subjectId);
    }
    const liveByObject = new Map<string, Map<string, Record<string, unknown>>>();
    for (const [subjectObject, ids] of bySubjectObject) {
      liveByObject.set(subjectObject, await readById(engine, subjectObject, [...ids], context));
    }

    // The organization each planned parent row would carry, for the child pass.
    const parentOrganizations = new Map<string, string>();

    for (const row of rows) {
      const id = rowId(row);
      if (!id) {
        plan.skipped.subjectUnaddressable += 1;
        continue;
      }
      const status = target.statusField ? (row[target.statusField] ?? null) : undefined;
      const subjectObject = nonEmpty(row[target.subjectObjectField]);
      const subjectId = nonEmpty(row[target.subjectIdField]);
      if (!subjectObject || !subjectId) {
        // A scheduled sweep has no ONE subject, by construction. Nothing to
        // derive from, and nothing to invent.
        plan.skipped.subjectUnaddressable += 1;
        continue;
      }
      const live = liveByObject.get(subjectObject)?.get(subjectId) ?? null;
      const snapshot = target.snapshotField
        ? parseSnapshot(row[target.snapshotField], target.snapshotPath ?? [])
        : null;
      if (!live && !snapshot) {
        plan.skipped.subjectNotFound += 1;
        continue;
      }
      // Equivalent to `organizationOf(subjectObject, live, snapshot)` — the
      // resolver returns the first non-empty value across its candidates, in
      // order — split in two calls only so the row can record WHICH candidate
      // answered. Same resolver, same precedence, one resolution.
      const fromLive = live ? resolver.organizationOf(subjectObject, live) : null;
      const organization = fromLive ?? (snapshot ? resolver.organizationOf(subjectObject, snapshot) : null);
      if (!organization) {
        // ⛔ Out of the ruling — the subject has no organization either.
        plan.skipped.subjectHasNoOrganization += 1;
        plan.outOfRulingScopeIds.push(id);
        continue;
      }
      plan.planned += 1;
      const statusKey = status == null ? 'unknown' : String(status);
      if (target.statusField) plan.plannedByStatus[statusKey] = (plan.plannedByStatus[statusKey] ?? 0) + 1;
      parentOrganizations.set(id, organization);
      plan.rows.push({
        object: target.object,
        id,
        organizationField,
        organization,
        subjectObject,
        subjectId,
        resolvedFrom: fromLive ? 'live-record' : 'snapshot',
        status: status === undefined ? undefined : (status as string | null),
      });
    }

    for (const child of target.children ?? []) {
      objects.push(await planChild(engine, resolver, child, parentOrganizations, target.object, scanOptions));
    }
  }

  return { dryRun: true, objects, totals: totalsOf(objects) };
}

/**
 * Plan one child table. A child's organization is its PARENT ROW's — never a
 * second resolution from the subject, which is what "all three move together"
 * means in code.
 */
async function planChild(
  engine: BackfillEngine,
  resolver: ReturnType<typeof createRecordOrganizationResolver>,
  child: BackfillChild,
  plannedParents: ReadonlyMap<string, string>,
  parentObject: string,
  scanOptions: { context: unknown; pageSize: number; maxRowsPerObject: number },
): Promise<ObjectPlan> {
  const organizationField = resolver.organizationFieldFor(child.object);
  const plan = newObjectPlan(child.object, 'parent-derived', organizationField);
  if (!organizationField) {
    plan.notes.push(`no organization column resolved for '${child.object}' — nothing scanned.`);
    return plan;
  }
  const rows = await scanUnstampedRows(engine, child.object, organizationField, scanOptions, plan);
  plan.scanned = rows.length;

  // Parents this run is NOT already planning have to be read: a child left
  // behind by an interrupted run hangs off a parent that already carries its
  // organization.
  const unknownParents = new Set<string>();
  for (const row of rows) {
    const parentId = nonEmpty(row[child.parentField]);
    if (parentId && !plannedParents.has(parentId)) unknownParents.add(parentId);
  }
  const parentRows = unknownParents.size
    ? await readById(engine, parentObject, [...unknownParents], scanOptions.context)
    : new Map<string, Record<string, unknown>>();
  const parentOrganizationField = resolver.organizationFieldFor(parentObject);

  for (const row of rows) {
    const id = rowId(row);
    const parentId = nonEmpty(row[child.parentField]);
    if (!id || !parentId) {
      plan.skipped.subjectUnaddressable += 1;
      continue;
    }
    const organization = plannedParents.get(parentId)
      ?? (parentOrganizationField ? nonEmpty(parentRows.get(parentId)?.[parentOrganizationField]) : null);
    if (!organization) {
      plan.skipped.parentHasNoOrganization += 1;
      continue;
    }
    plan.planned += 1;
    plan.rows.push({
      object: child.object,
      id,
      organizationField,
      organization,
      subjectObject: parentObject,
      subjectId: parentId,
      resolvedFrom: 'parent-row',
    });
  }
  return plan;
}

function totalsOf(objects: readonly ObjectPlan[]): BackfillReport['totals'] {
  return objects.reduce(
    (acc, o) => ({
      scanned: acc.scanned + o.scanned,
      planned: acc.planned + o.planned,
      written: acc.written + o.written,
      outOfRulingScope: acc.outOfRulingScope + o.skipped.subjectHasNoOrganization,
    }),
    { scanned: 0, planned: 0, written: 0, outOfRulingScope: 0 },
  );
}

/**
 * Render a report as the operator-facing text — broken out per object, which
 * is what the ruling asks the dry run to be readable as.
 */
export function formatBackfillReport(report: BackfillReport): string {
  const lines: string[] = [];
  lines.push(
    report.dryRun
      ? 'Platform-row organization backfill — DRY RUN (nothing written)'
      : 'Platform-row organization backfill — APPLIED',
  );
  lines.push('='.repeat(62));
  for (const plan of report.objects) {
    lines.push('');
    lines.push(`${plan.object}  [${plan.role}]`);
    lines.push(`  organization column : ${plan.organizationField ?? '(none resolved)'}`);
    lines.push(`  scanned (unstamped) : ${plan.scanned}`);
    lines.push(`  ${report.dryRun ? 'would write' : 'written   '}          : ${report.dryRun ? plan.planned : plan.written}`);
    if (Object.keys(plan.plannedByStatus).length) {
      const byStatus = Object.entries(plan.plannedByStatus)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([status, n]) => `${status}=${n}`)
        .join(' ');
      lines.push(`    by status         : ${byStatus}`);
    }
    lines.push(`  skipped — subject has no organization (OUT OF RULING) : ${plan.skipped.subjectHasNoOrganization}`);
    if (plan.outOfRulingScopeIds.length) {
      lines.push(`    ids               : ${plan.outOfRulingScopeIds.join(', ')}`);
    }
    lines.push(`  skipped — no subject named on the row                 : ${plan.skipped.subjectUnaddressable}`);
    lines.push(`  skipped — subject gone, no surviving snapshot         : ${plan.skipped.subjectNotFound}`);
    lines.push(`  skipped — parent row has no organization              : ${plan.skipped.parentHasNoOrganization}`);
    for (const row of plan.rows) {
      lines.push(
        `    ${row.id} -> ${row.organizationField}=${row.organization}`
        + ` (from ${row.resolvedFrom}: ${row.subjectObject}/${row.subjectId}`
        + `${row.status ? `, status=${row.status}` : ''})`,
      );
    }
    for (const failure of plan.failures) {
      lines.push(`  ✗ ${failure.id} NOT written — ${failure.error}`);
    }
    for (const note of plan.notes) lines.push(`  ⚠️  ${note}`);
  }
  lines.push('');
  lines.push('-'.repeat(62));
  lines.push(
    `TOTAL scanned=${report.totals.scanned} `
    + `${report.dryRun ? 'would-write' : 'written'}=${report.dryRun ? report.totals.planned : report.totals.written} `
    + `out-of-ruling(subject has no organization)=${report.totals.outOfRulingScope}`,
  );
  return lines.join('\n');
}

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
export async function applyPlatformRowOrganizationBackfill(
  engine: BackfillEngine,
  plan: BackfillReport,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const context = options.context ?? SYSTEM_CONTEXT;
  for (const objectPlan of plan.objects) {
    objectPlan.written = 0;
    objectPlan.failures = [];
    for (const row of objectPlan.rows) {
      try {
        await engine.update(
          objectPlan.object,
          { id: row.id, [row.organizationField]: row.organization },
          { context },
        );
        objectPlan.written += 1;
      } catch (err) {
        objectPlan.failures.push({ id: row.id, error: String((err as Error)?.message ?? err) });
      }
    }
  }
  return { dryRun: false, objects: plan.objects, totals: totalsOf(plan.objects) };
}

/**
 * Plan, then (unless `dryRun`) write — the whole sweep in one call.
 *
 * Idempotent by construction rather than by a guard: the plan is built from
 * `WHERE <organization column> IS NULL`, and every write fills that column, so
 * a second call over an unchanged database plans nothing and writes nothing.
 * `backfill-platform-row-organizations.test.ts` asserts that second run rather
 * than describing it.
 */
export async function runPlatformRowOrganizationBackfill(
  engine: BackfillEngine,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const plan = await planPlatformRowOrganizationBackfill(engine, options);
  if (options.dryRun !== false) return plan;
  return applyPlatformRowOrganizationBackfill(engine, plan, options);
}
