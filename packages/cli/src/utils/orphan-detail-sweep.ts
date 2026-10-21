// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isControlledByParentMasterField } from '@objectstack/spec/data';
import type { DanglingReference, DanglingReferenceReport, ObjectQL } from '@objectstack/objectql';

/**
 * [#24964] The plan behind `os db orphans`: the detail rows whose REQUIRED
 * master-detail master does not exist, and what deleting each one removes.
 *
 * ## Where the rows come from
 *
 * A system-context write is exempt from the write-time reference check (seed
 * replay and package install write in an order that only resolves once the
 * batch completes), so a platform or elevated-script write can store a
 * master-detail id that names no master. Such a row's access derives from a
 * master that does not exist, so no user door reads or deletes it, and the
 * dangling-reference audit (`ObjectQL.inspectDanglingReferences`) reports it
 * and, by design, never rewrites it. This plan is that audit's report, read for
 * one question an operator can act on.
 *
 * ## The judgements are the engine's, never restated here
 *
 * - **Which rows are orphans** is the audit's `dangling` bucket — the engine's
 *   own existence probe, the one the write-path guard uses — kept to the
 *   findings on a REQUIRED `master_detail` field. "Required master-detail" is
 *   `isControlledByParentMasterField` from `@objectstack/spec/data`: a
 *   `master_detail` declared `required: true`, and nothing else. That is the
 *   one place the spec spells it.
 * - **What a delete removes** is `ObjectQL.inspectCascadeDelete`: the cascade
 *   set the engine's own by-id delete collects, read through the same walk. A
 *   list of "which relations cascade" kept in this file would be free to
 *   disagree with the delete it previews.
 *
 * ## Unknown is not absent, and nothing unknown is deleted
 *
 * - The audit's `undetermined` values (a target object that is not
 *   registered, has no driver, or whose read failed) are counted and never
 *   listed as orphans. The audit counts them; it does not itemise them.
 * - A dangling reference on any other field (a plain `lookup`, a `master_detail`
 *   that is not required) is NAMED in `otherDangling` and never deleted: its row
 *   does not depend on that master for its existence.
 * - An orphan whose cascade could not be read is WITHHELD, with the reason,
 *   and never deleted. "The probe failed" is not "there are no deeper details".
 * - A bounded scan says what it did not read (`truncatedObjects`,
 *   `unscannedObjects`, `unreadableObjects`). Every row it does list is proven
 *   dangling on its own, so an incomplete scan narrows the deletion and never
 *   widens it.
 *
 * Read-only by construction: nothing here holds a write verb.
 */

/** The slice of the engine the plan reads. Typed off the engine itself, so it cannot drift from it. */
export type OrphanDetailEngine = Pick<ObjectQL, 'getConfigs' | 'inspectDanglingReferences' | 'inspectCascadeDelete'>;

/** One required master-detail field on an orphan row, naming a master that does not exist. */
export interface OrphanDetailField {
  field: string;
  /** The master object the field declares. */
  master: string;
  /** The stored master id, which names no row of `master`. */
  missingMasterId: string;
}

/** A record, as the cascade set names it. */
export interface RecordRef {
  object: string;
  id: string;
}

/** A detail row whose required master is missing, and what deleting it removes. */
export interface OrphanDetailRow {
  object: string;
  recordId: string;
  fields: OrphanDetailField[];
  /** The deeper details the delete's cascade removes with it — the root excluded. */
  cascade: RecordRef[];
}

/** An orphan that is NOT deleted, and why. */
export interface WithheldOrphanDetailRow {
  object: string;
  recordId: string;
  fields: OrphanDetailField[];
  reason: string;
}

export interface OrphanDetailPlan {
  /** Objects declaring a required master-detail field — the ones the audit read. */
  objects: string[];
  /** Objects with such a field whose table this database does not have: nothing is stored there. */
  notRead: string[];
  /** Rows the audit read and examined. */
  scanned: number;
  /** The deletable rows, in the audit's order. */
  orphans: OrphanDetailRow[];
  /** Orphans the plan will not delete, each with its reason. */
  withheld: WithheldOrphanDetailRow[];
  /** Dangling references on the scanned objects that are not a required master-detail. Never deleted. */
  otherDangling: DanglingReference[];
  /** Reference values on the scanned objects whose target could not be probed. Not orphans. */
  undetermined: number;
  unreadableObjects: string[];
  truncatedObjects: string[];
  unscannedObjects: string[];
  aborted: boolean;
  /** `true` only when every row of every scanned object was read and every probe could run. */
  complete: boolean;
  counts: {
    orphans: number;
    deeperDetails: number;
    withheld: number;
    otherDangling: number;
    undetermined: number;
  };
  /** What an operator must read before acting, in plain sentences. */
  notes: string[];
}

/** One identity for a record across the plan, the export and the delete. */
export function recordKey(object: string, id: string): string {
  return JSON.stringify([object, id]);
}

/** The objects that declare at least one required master-detail field, in registration order. */
export function objectsWithRequiredMaster(configs: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [name, obj] of Object.entries(configs)) {
    const fields = (obj as { fields?: unknown } | null | undefined)?.fields;
    if (!fields || typeof fields !== 'object') continue;
    if (Object.values(fields as Record<string, unknown>).some((f) => isControlledByParentMasterField(f))) out.push(name);
  }
  return out;
}

/** Is `finding` on a required master-detail field of its object? */
function isRequiredMasterFinding(configs: Record<string, unknown>, finding: DanglingReference): boolean {
  const fields = (configs[finding.objectName] as { fields?: Record<string, unknown> } | undefined)?.fields;
  return isControlledByParentMasterField(fields?.[finding.field]);
}

/**
 * The orphans in a dangling-reference report, one entry per row, its fields
 * gathered: a row with two required masters both missing is one orphan.
 */
export function orphanFindings(
  configs: Record<string, unknown>,
  report: Pick<DanglingReferenceReport, 'dangling'>,
): { orphans: Array<Omit<OrphanDetailRow, 'cascade'>>; other: DanglingReference[] } {
  const byRow = new Map<string, Omit<OrphanDetailRow, 'cascade'>>();
  const other: DanglingReference[] = [];
  for (const finding of report.dangling) {
    if (!isRequiredMasterFinding(configs, finding)) {
      other.push(finding);
      continue;
    }
    const key = recordKey(finding.objectName, finding.recordId);
    let row = byRow.get(key);
    if (!row) {
      row = { object: finding.objectName, recordId: finding.recordId, fields: [] };
      byRow.set(key, row);
    }
    row.fields.push({ field: finding.field, master: finding.target, missingMasterId: finding.value });
  }
  return { orphans: [...byRow.values()], other };
}

export async function planOrphanDetailSweep(input: {
  engine: OrphanDetailEngine;
  /** The audit's budget, per object and overall. */
  maxRows: number;
  /** Did the boot measure this object's table absent? Such a table is not read: it stores nothing. */
  absent?: (object: string) => boolean;
}): Promise<OrphanDetailPlan> {
  const configs = input.engine.getConfigs() as Record<string, unknown>;
  const declaring = objectsWithRequiredMaster(configs);
  const notRead = declaring.filter((name) => input.absent?.(name) === true);
  const objects = declaring.filter((name) => !notRead.includes(name));

  const empty: DanglingReferenceReport = {
    scanned: 0, dangling: [], undetermined: 0, unreadableObjects: [], truncatedObjects: [],
    unscannedObjects: [], aborted: false,
  };
  const report = objects.length === 0
    ? empty
    : await input.engine.inspectDanglingReferences({ objects, rowsPerObject: input.maxRows, maxRows: input.maxRows });

  const { orphans: found, other } = orphanFindings(configs, report);
  const orphans: OrphanDetailRow[] = [];
  const withheld: WithheldOrphanDetailRow[] = [];
  for (const row of found) {
    let members: RecordRef[];
    try {
      members = await input.engine.inspectCascadeDelete(row.object, row.recordId);
    } catch (error) {
      withheld.push({
        ...row,
        reason: 'what deleting it would remove could not be read, so it is not deleted: '
          + (error instanceof Error ? error.message : String(error)),
      });
      continue;
    }
    const root = recordKey(row.object, row.recordId);
    orphans.push({ ...row, cascade: members.filter((m) => recordKey(m.object, m.id) !== root) });
  }

  const unscannedObjects = report.unscannedObjects ?? [];
  const aborted = report.aborted === true;
  const notes: string[] = [];
  if (report.truncatedObjects.length > 0) {
    notes.push(
      `These objects hold more rows than --max-rows (${input.maxRows}), so only the first ${input.maxRows} of each `
      + `were read, and their other rows are not in this report: ${report.truncatedObjects.join(', ')}. `
      + 'Re-run with a larger --max-rows to read them.',
    );
  }
  if (unscannedObjects.length > 0) {
    notes.push(
      `The --max-rows budget (${input.maxRows}) ran out before these objects were read, so none of their rows is in `
      + `this report: ${unscannedObjects.join(', ')}.`,
    );
  }
  if (report.unreadableObjects.length > 0) {
    notes.push(
      `The rows of these objects could not be read, so none of them is in this report: ${report.unreadableObjects.join(', ')}.`,
    );
  }
  if (report.undetermined > 0) {
    notes.push(
      `${report.undetermined} reference value(s) on the scanned objects name a record whose object could not be `
      + 'checked (it is not registered, has no driver, or its read failed). Unknown is not missing: none of '
      + 'them is listed as an orphan, and none is deleted.',
    );
  }
  if (other.length > 0) {
    notes.push(
      `${other.length} other stored reference(s) on the scanned objects name a record that does not exist, on a `
      + 'field that is not a required master-detail. They are listed so you can see them; this command never '
      + 'deletes their rows, because those rows do not depend on that record to exist.',
    );
  }
  if (aborted) notes.push('The scan was called off before it finished, so its silence about the rest proves nothing.');

  return {
    objects,
    notRead,
    scanned: report.scanned,
    orphans,
    withheld,
    otherDangling: other,
    undetermined: report.undetermined,
    unreadableObjects: report.unreadableObjects,
    truncatedObjects: report.truncatedObjects,
    unscannedObjects,
    aborted,
    complete: !aborted && report.undetermined === 0 && report.unreadableObjects.length === 0
      && report.truncatedObjects.length === 0 && unscannedObjects.length === 0,
    counts: {
      orphans: orphans.length,
      deeperDetails: orphans.reduce((n, o) => n + o.cascade.length, 0),
      withheld: withheld.length,
      otherDangling: other.length,
      undetermined: report.undetermined,
    },
    notes,
  };
}

/** Every record a `--delete` run of this plan removes, orphans and deeper details, each once. */
export function recordsToDelete(plan: Pick<OrphanDetailPlan, 'orphans'>): RecordRef[] {
  const seen = new Set<string>();
  const out: RecordRef[] = [];
  for (const orphan of plan.orphans) {
    for (const ref of [{ object: orphan.object, id: orphan.recordId }, ...orphan.cascade]) {
      const key = recordKey(ref.object, ref.id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/** The pre-delete export: every record the run deletes, as stored, written before the first delete. */
export interface OrphanDetailExport {
  /** Format marker, so a restorer can refuse a document it does not know. */
  format: 'objectstack.orphan-detail.pre-delete-export.v1';
  generatedAt: string;
  /** The command that produced it, for the operator reading it months later. */
  producedBy: string;
  warning: string;
  /** Why each row is deleted: the report this run made. */
  orphans: OrphanDetailRow[];
  /** Each record the run deletes, as the driver stores it. */
  rows: Array<{ object: string; id: string; row: Record<string, unknown> }>;
}

export const ORPHAN_EXPORT_RESTORE_HINT =
  'To restore a record, re-insert its `row` into the table named by `object` with every column verbatim, '
  + 'the id included. Restore a deeper detail after the orphan it belongs to. Restoring an orphan does not '
  + 'restore its master: the master it names did not exist when it was deleted.';

/**
 * Build the export for the records a `--delete` run is about to remove.
 *
 * ⛔ Throws rather than leaving a record out: a record the export cannot hold
 * is a record that would be deleted with no copy anywhere.
 */
export function buildOrphanDetailExport(input: {
  plan: Pick<OrphanDetailPlan, 'orphans'>;
  /** The stored rows, keyed by {@link recordKey}, as read from the driver. */
  rawRows: ReadonlyMap<string, Record<string, unknown>>;
  producedBy: string;
  now?: () => Date;
}): OrphanDetailExport {
  const rows: OrphanDetailExport['rows'] = [];
  for (const ref of recordsToDelete(input.plan)) {
    const raw = input.rawRows.get(recordKey(ref.object, ref.id));
    if (!raw) {
      throw new Error(
        `Cannot build the pre-delete export: no stored row was read for ${ref.object}/${ref.id}, which this run `
        + 'would delete. Refusing to delete a record the export cannot hold.',
      );
    }
    rows.push({ object: ref.object, id: ref.id, row: raw });
  }
  return {
    format: 'objectstack.orphan-detail.pre-delete-export.v1',
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    producedBy: input.producedBy,
    warning:
      'This file holds every record the run deleted, as stored: business data, with whatever it contained. '
      + 'Protect it as you protect a database backup, and delete it only once you are certain the sweep was '
      + `correct. ${ORPHAN_EXPORT_RESTORE_HINT}`,
    orphans: input.plan.orphans,
    rows,
  };
}

/** The records a read-back export holds, by {@link recordKey} — the check made before the first delete. */
export function exportedKeys(doc: Partial<OrphanDetailExport> | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const r of doc?.rows ?? []) {
    if (r && typeof r.object === 'string' && typeof r.id === 'string' && r.row && typeof r.row === 'object') {
      keys.add(recordKey(r.object, r.id));
    }
  }
  return keys;
}
