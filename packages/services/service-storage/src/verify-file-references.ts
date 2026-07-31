// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { FILE_REFERENCE_TYPES, isFileIdToken, RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
import { keysetWalk } from '@objectstack/types';

/**
 * File-reference reconciliation (ADR-0104 D3 wave 2) — the executable form of
 * the ADR's R4 acceptance gate.
 *
 * Compares GROUND TRUTH (what records' file-class fields actually hold) against
 * RECORDED OWNERSHIP (`sys_file.ref_object` / `ref_id` / `ref_field`). The
 * ownership columns are what a later, gated change will let authorise deleting
 * file bytes, and a ledger may not be given that power until it has been shown
 * to agree with reality — so this exists to be run, repeatedly, before that
 * change may merge.
 *
 * Discrepancies are split by whether they can cause DATA LOSS once collection
 * is enabled, because only that class blocks:
 *
 *  - `unowned_reference` (**blocking**) — a record holds a file that nothing
 *    owns. With collection on, the file looks free and its bytes go.
 *  - `foreign_owner` (**blocking**) — a record holds a file owned by a
 *    different slot. That reference is invisible to the lifecycle, so when the
 *    recorded owner releases, the bytes go while this record still points at
 *    them.
 *  - `shared_reference` (**blocking**) — one file held by two or more slots,
 *    i.e. exclusivity was violated and copy-on-claim did not run. Same failure
 *    as above, and it also means one file's ACL is serving two parents.
 *  - `stale_owner` (advisory) — a file is owned by a slot that no longer holds
 *    it. Fails toward retention: the file is simply never collected.
 *  - `unreferenced_file` (advisory) — a committed file nothing points at.
 *    Storage cost, not a correctness problem.
 *
 * The scan is read-only. It never writes, never tombstones, and never deletes.
 */

// Raw-form reads: on a live kernel the engine's read resolver expands stored
// ids to `{ id, url, … }` in place, which would hide every held reference
// from this scan (false stale_owner noise — and a missed unowned_reference
// would falsely pass the gate). The scan's subject is the stored form.
const SYSTEM_CTX = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true } as const;

/** Records read per page while scanning an object. */
const SCAN_PAGE_SIZE = 500;

export type FileReferenceIssueKind =
  | 'unowned_reference'
  | 'foreign_owner'
  | 'shared_reference'
  | 'stale_owner'
  | 'unreferenced_file';

/** Issue kinds that would let a later reap delete bytes something still holds. */
export const BLOCKING_ISSUE_KINDS: ReadonlySet<FileReferenceIssueKind> = new Set([
  'unowned_reference',
  'foreign_owner',
  'shared_reference',
] as const);

export interface FileReferenceIssue {
  kind: FileReferenceIssueKind;
  fileId: string;
  /** The slot this issue is reported against, when it has one. */
  object?: string;
  recordId?: string;
  field?: string;
  detail: string;
}

export interface FileReferenceReport {
  /** Objects that declare at least one file-class field. */
  scannedObjects: string[];
  scannedRecords: number;
  /** Distinct (file, slot) references actually held by records. */
  heldReferences: number;
  /** `sys_file` rows carrying an owner. */
  ownedFiles: number;
  issues: FileReferenceIssue[];
  counts: Record<FileReferenceIssueKind, number>;
  blocking: number;
  /**
   * Zero blocking issues. The gate: this must hold on real tenant data, on
   * consecutive runs, before collection may be enabled.
   */
  ok: boolean;
  /** True when a bound was hit, so `ok` covers only what was scanned. */
  truncated: boolean;
}

/** Engine surface the scan needs — duck-typed, like the other storage seams. */
export interface VerifyReferencesEngine {
  getObject(name: string): any | undefined;
  getConfigs?(): Record<string, any>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
}

export interface VerifyReferencesOptions {
  /** Restrict the scan to these objects (default: every object with a file field). */
  objects?: string[];
  /** Safety bound on records read per object. Exceeding it sets `truncated`. */
  maxRecordsPerObject?: number;
  /** Include the advisory `unreferenced_file` sweep (an extra full sys_file read). */
  includeUnreferenced?: boolean;
}

function slotKey(object: string, recordId: string, field: string): string {
  return `${object}${recordId}${field}`;
}

function fileFieldsOf(engine: VerifyReferencesEngine, objectName: string): string[] {
  const schema: any = engine.getObject(objectName);
  if (!schema?.fields) return [];
  return Object.entries(schema.fields)
    .filter(([, def]: [string, any]) => def && FILE_REFERENCE_TYPES.has(def.type))
    .map(([name]) => name);
}

function idTokensIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => isFileIdToken(v)) as string[];
  return isFileIdToken(value) ? [value] : [];
}

/**
 * Scan records and `sys_file` ownership, and report where they disagree.
 */
export async function verifyFileReferences(
  engine: VerifyReferencesEngine,
  options: VerifyReferencesOptions = {},
): Promise<FileReferenceReport> {
  const maxPerObject = options.maxRecordsPerObject ?? 100_000;
  const issues: FileReferenceIssue[] = [];
  let truncated = false;

  const candidates =
    options.objects ??
    (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);
  const scannedObjects = candidates.filter(
    (name) => name !== 'sys_file' && fileFieldsOf(engine, name).length > 0,
  );

  // ── 1. Ground truth: what do records actually hold? ────────────────
  /** fileId → the slots holding it. */
  const held = new Map<string, Array<{ object: string; recordId: string; field: string }>>();
  let scannedRecords = 0;

  for (const object of scannedObjects) {
    const fileFields = fileFieldsOf(engine, object);
    // Seek by `id` rather than counting from the start (#4363). This scan
    // decides which files are still referenced, and a row it never visits is
    // reported as an unreferenced file — the wrong answer with the shape of a
    // clean run. An offset walk cannot promise it visits every row.
    const walk = keysetWalk<Record<string, unknown>>(
      (q) => engine.find(object, { ...q, fields: ['id', ...fileFields], context: { ...SYSTEM_CTX } }),
      { pageSize: SCAN_PAGE_SIZE, max: maxPerObject },
    );
    try {
      for await (const page of walk.pages()) {
        for (const record of page) {
          const recordId = record?.id;
          if (recordId == null) continue;
          scannedRecords++;
          for (const field of fileFields) {
            for (const fileId of new Set(idTokensIn(record[field]))) {
              const list = held.get(fileId) ?? [];
              list.push({ object, recordId: String(recordId), field });
              held.set(fileId, list);
            }
          }
        }
      }
    } catch {
      // Unreadable object — skip rather than abort the whole scan. An object
      // with no `id` column (a federated table, ADR-0015) lands here too, and
      // skipping it is the honest outcome: it cannot be walked exhaustively,
      // so it must not contribute a "nothing holds this file" conclusion.
      continue;
    }
    if (walk.truncated) truncated = true;
  }

  // ── 2. Recorded ownership ─────────────────────────────────────────
  /** fileId → the slot recorded as its owner. */
  const owned = new Map<string, { object: string; recordId: string; field: string }>();
  const owners = keysetWalk<Record<string, unknown>>(
    (q) => engine.find('sys_file', {
      ...q,
      fields: ['id', 'ref_object', 'ref_id', 'ref_field', 'status'],
      context: { ...SYSTEM_CTX },
    }),
    { where: { ref_object: { $ne: null } }, pageSize: SCAN_PAGE_SIZE },
  );
  try {
    for await (const page of owners.pages()) {
      for (const row of page) {
        // A driver without `$ne` support may hand back unowned rows too — filter
        // here rather than trusting the predicate round-tripped.
        if (row?.id == null || !row.ref_object || row.ref_id == null) continue;
        owned.set(String(row.id), {
          object: String(row.ref_object),
          recordId: String(row.ref_id),
          field: String(row.ref_field ?? ''),
        });
      }
    }
  } catch {
    // Same posture as the record scan: an unreadable ledger is not evidence.
  }

  // ── 3. Diff ───────────────────────────────────────────────────────
  let heldReferences = 0;
  for (const [fileId, slots] of held) {
    heldReferences += slots.length;

    if (slots.length > 1) {
      issues.push({
        kind: 'shared_reference',
        fileId,
        detail:
          `held by ${slots.length} slots (` +
          slots.map((s) => `${s.object}/${s.recordId}.${s.field}`).join(', ') +
          ') — field references must be exclusive; copy-on-claim did not run',
      });
    }

    const owner = owned.get(fileId);
    if (!owner) {
      const s = slots[0];
      issues.push({
        kind: 'unowned_reference',
        fileId,
        object: s.object,
        recordId: s.recordId,
        field: s.field,
        detail: `held by ${s.object}/${s.recordId}.${s.field} but no sys_file owner is recorded`,
      });
      continue;
    }
    for (const s of slots) {
      if (slotKey(s.object, s.recordId, s.field) !== slotKey(owner.object, owner.recordId, owner.field)) {
        issues.push({
          kind: 'foreign_owner',
          fileId,
          object: s.object,
          recordId: s.recordId,
          field: s.field,
          detail:
            `held by ${s.object}/${s.recordId}.${s.field} but owned by ` +
            `${owner.object}/${owner.recordId}.${owner.field}`,
        });
      }
    }
  }

  for (const [fileId, owner] of owned) {
    const slots = held.get(fileId);
    const stillHeld = slots?.some(
      (s) => slotKey(s.object, s.recordId, s.field) === slotKey(owner.object, owner.recordId, owner.field),
    );
    if (!stillHeld) {
      issues.push({
        kind: 'stale_owner',
        fileId,
        object: owner.object,
        recordId: owner.recordId,
        field: owner.field,
        detail:
          `owned by ${owner.object}/${owner.recordId}.${owner.field}, which no longer holds it — ` +
          'retained rather than collected (safe)',
      });
    }
  }

  // ── 4. Advisory: committed files nothing points at ────────────────
  if (options.includeUnreferenced) {
    const files = keysetWalk<Record<string, unknown>>(
      (q) => engine.find('sys_file', {
        ...q,
        fields: ['id', 'ref_object', 'scope'],
        context: { ...SYSTEM_CTX },
      }),
      { where: { status: 'committed' }, pageSize: SCAN_PAGE_SIZE },
    );
    try {
      for await (const page of files.pages()) {
        for (const row of page) {
          const id = row?.id == null ? null : String(row.id);
          // attachments-scope files are governed by sys_attachment, not by the
          // ownership columns — not this scan's business.
          if (!id || row.ref_object || row.scope === 'attachments') continue;
          if (held.has(id)) continue;
          issues.push({
            kind: 'unreferenced_file',
            fileId: id,
            detail: 'committed but neither owned nor held by any field — storage cost, not data risk',
          });
        }
      }
    } catch {
      // Same posture as the record scan above.
    }
  }

  const counts = {
    unowned_reference: 0,
    foreign_owner: 0,
    shared_reference: 0,
    stale_owner: 0,
    unreferenced_file: 0,
  } as Record<FileReferenceIssueKind, number>;
  for (const issue of issues) counts[issue.kind]++;
  const blocking = issues.filter((i) => BLOCKING_ISSUE_KINDS.has(i.kind)).length;

  return {
    scannedObjects,
    scannedRecords,
    heldReferences,
    ownedFiles: owned.size,
    issues,
    counts,
    blocking,
    ok: blocking === 0,
    truncated,
  };
}

/** Render a report as human-readable lines (CLI / CI log output). */
export function formatFileReferenceReport(report: FileReferenceReport): string {
  const lines: string[] = [];
  lines.push(
    `Scanned ${report.scannedRecords} record(s) across ${report.scannedObjects.length} object(s) ` +
      `with file fields; ${report.heldReferences} reference(s) held, ${report.ownedFiles} file(s) owned.`,
  );
  if (report.truncated) {
    lines.push('⚠ Scan was truncated by maxRecordsPerObject — this verdict covers only what was read.');
  }
  if (report.issues.length === 0) {
    lines.push('✅ No discrepancies: recorded ownership matches what records hold.');
    return lines.join('\n');
  }
  for (const kind of [
    'unowned_reference',
    'foreign_owner',
    'shared_reference',
    'stale_owner',
    'unreferenced_file',
  ] as FileReferenceIssueKind[]) {
    const of = report.issues.filter((i) => i.kind === kind);
    if (of.length === 0) continue;
    lines.push(
      `\n${BLOCKING_ISSUE_KINDS.has(kind) ? '❌ BLOCKING' : '•  advisory'} — ${kind} (${of.length}):`,
    );
    for (const i of of.slice(0, 20)) lines.push(`   ${i.fileId}: ${i.detail}`);
    if (of.length > 20) lines.push(`   … and ${of.length - 20} more`);
  }
  lines.push(
    report.ok
      ? '\n✅ No blocking discrepancies. Advisory items above cost storage, not data.'
      : `\n❌ ${report.blocking} blocking discrepancy(ies). Enabling collection now could delete ` +
          'bytes a record still references.',
  );
  return lines.join('\n');
}
