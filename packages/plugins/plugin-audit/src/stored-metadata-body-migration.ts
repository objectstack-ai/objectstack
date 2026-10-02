// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21120] One-off rewrite of the at-rest cleartext copies this plugin's writer
 * left behind.
 *
 * `writeAudit` COPIES the whole audited row into `sys_audit_log.new_value` /
 * `old_value` and `sys_activity.metadata` at write time. For a
 * `sys_metadata` / `sys_metadata_history` row that copy carried the stored
 * metadata BODY — a datasource body's credential material included — into a
 * second, admin-readable, at-rest store. The writer now projects that body
 * through the shared redactor before it records it (`audit-writers.ts`), but
 * the writer only reaches NEW writes: rows copied before the fix keep their
 * cleartext. This module rewrites them.
 *
 * ## Pure planner, driven runner
 *
 * The decision — "does this stored audit/activity value carry a metadata body,
 * and what does the redacted copy look like?" — is pure and I/O-free
 * ({@link planAuditRowPatch} / {@link planActivityRowPatch}), so every verdict
 * is unit-testable against a stored row and the runner cannot decide policy in
 * the middle of a write sequence. {@link migrateStoredMetadataBodyCopies}
 * drives them over the two tables through the engine, rewriting only the rows a
 * planner changed.
 *
 * ## One redactor, fail-closed
 *
 * The body is projected through the SAME {@link redactStoredMetadataBody} every
 * read exit uses — never a second rule set. The `type` that selects the
 * redactor is read from the stored snapshot itself (a create/delete snapshot is
 * the whole row, so it carries the `type` column); an update diff keeps only the
 * changed keys, so a snapshot that changed the body but not the type has no
 * `type` to read — the runner supplies it from the live `sys_metadata` row when
 * that row still exists, and the planner FAILS CLOSED when neither answers,
 * dropping the body from the recorded copy rather than leaving it cleartext.
 *
 * ## Idempotent, its own verification
 *
 * A second run finds nothing to rewrite — a redacted snapshot has no credential
 * left to withhold — so re-running and reading a clean report is the check, the
 * same posture `os migrate summary-nulls` takes. No `sys_migration` flag is
 * recorded: nothing gates irreversible behaviour on this rewrite.
 *
 * ## [#21207] The stored content hash of the same rows
 *
 * The same copies also carried the copied row's stored CONTENT HASH
 * (`checksum`, and the history row's `previous_checksum`) — a hash over the
 * whole stored body, withheld credential material included, i.e. an offline
 * verifier for a guess at that material — and the protocol wrote both hashes
 * of a refused optimistic-lock write into the decision-audit note
 * (`sys_metadata_audit.note`, `code = 'metadata_conflict'`), which the writer
 * then copied into the ledger and the activity feed again. The writers no
 * longer do (fork three of the maintainer's ruling on #21207: a copy never
 * carries the hash; the history table stays the lineage), and this rewrite now
 * also drops the two columns from the copies already written
 * ({@link withoutStoredHashColumns}) and withholds the hashes in the notes and
 * their copies ({@link planDecisionNotePatch}) — the one operator-run rewrite
 * this family already has, extended to a derived column of the same rows, never
 * a second rewrite path.
 */

import {
  redactStoredMetadataBody,
  STORED_METADATA_BODY_COLUMN,
  STORED_METADATA_BODY_OBJECTS,
  STORED_METADATA_TYPE_COLUMN,
} from '@objectstack/spec/kernel';
import type { IDataEngine } from '@objectstack/spec/contracts';

/** The two audit-family tables this writer copies stored metadata bodies into. */
export const STORED_METADATA_BODY_AUDIT_OBJECTS = ['sys_audit_log', 'sys_activity'] as const;

/**
 * [#21207] The stored CONTENT-HASH columns of a stored-metadata-body row:
 * `checksum` (both tables) and the history table's `previous_checksum`. Never
 * copied by the audit writer (`audit-writers.ts`), dropped from the copies
 * already written by this rewrite. The same list as
 * `@objectstack/metadata-protocol`'s `STORED_METADATA_HASH_COLUMNS`, which this
 * plugin cannot import; `stored-metadata-body-family.pin.test.ts` pins it to the
 * object definitions.
 */
export const STORED_METADATA_HASH_COLUMNS: readonly string[] = Object.freeze(['checksum', 'previous_checksum']);

/**
 * [#21207] The history table's change note, which can QUOTE a stored content
 * hash (`publish draft (hash …)` on rows written before the publish door stated
 * its own message). A copy keeps the note and withholds each quote.
 */
export const STORED_METADATA_HASH_NOTE_COLUMN = 'change_note';

/** An unkeyed content hash quoted in free text (the keyed form's `hmac-sha256:` prefix is not one). */
const QUOTED_STORED_HASH = /(?<![\w-])sha256:[0-9a-f]{64}/g;

/** Free text with each quoted stored content hash `(withheld)`. */
export function withheldStoredHashTokens(text: string): string {
  return text.replace(QUOTED_STORED_HASH, '(withheld)');
}

/** [#21207] The decision-audit table whose conflict notes named both stored hashes. */
export const METADATA_DECISION_AUDIT_OBJECT = 'sys_metadata_audit';

/** The persisted code of an optimistic-concurrency refusal's decision-audit row. */
// adr0112-ok: D6b — the persisted audit column's own vocabulary, not a wire code
const CONFLICT_NOTE_CODE = 'metadata_conflict';

/** The conflict note's one sentence, as every writer of it has spelled it. */
const CONFLICT_NOTE = /^expected parent (.+) but current is (.+)$/;

/**
 * Drop the stored content-hash columns from one parsed ledger snapshot (or one
 * half of an activity pair), and withhold each hash its change note quotes.
 * Unchanged when it carries neither.
 */
export function withoutStoredHashColumns(snapshot: unknown): { changed: boolean; value: unknown } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { changed: false, value: snapshot };
  }
  const record = snapshot as Record<string, unknown>;
  const note = record[STORED_METADATA_HASH_NOTE_COLUMN];
  const withheldNote = typeof note === 'string' ? withheldStoredHashTokens(note) : note;
  const hasHash = STORED_METADATA_HASH_COLUMNS.some((column) => column in record);
  if (!hasHash && withheldNote === note) return { changed: false, value: snapshot };
  const out: Record<string, unknown> = { ...record };
  for (const column of STORED_METADATA_HASH_COLUMNS) delete out[column];
  if (withheldNote !== note) out[STORED_METADATA_HASH_NOTE_COLUMN] = withheldNote;
  return { changed: true, value: out };
}

/**
 * The conflict note with each side's value withheld — `null` kept, anything
 * else `(withheld)` — exactly the sentence the protocol writes now; `undefined`
 * for a note that is not that sentence or already withholds both sides.
 */
function withheldConflictNote(note: unknown): string | undefined {
  if (typeof note !== 'string') return undefined;
  const match = CONFLICT_NOTE.exec(note);
  if (!match) return undefined;
  const side = (value: string) => (value === 'null' ? 'null' : '(withheld)');
  const rewritten = `expected parent ${side(match[1] as string)} but current is ${side(match[2] as string)}`;
  return rewritten === note ? undefined : rewritten;
}

/** A decision-audit row (or a ledger snapshot of one) that is a conflict refusal: its code says so, or it carries none. */
function isConflictDecision(record: Record<string, unknown>): boolean {
  return record.code === undefined || record.code === CONFLICT_NOTE_CODE;
}

/** Withhold the hashes in the note of one parsed snapshot of a decision-audit row. */
function withheldNoteSnapshot(snapshot: unknown): { changed: boolean; value: unknown } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { changed: false, value: snapshot };
  const record = snapshot as Record<string, unknown>;
  if (!isConflictDecision(record)) return { changed: false, value: snapshot };
  const note = withheldConflictNote(record.note);
  return note === undefined ? { changed: false, value: snapshot } : { changed: true, value: { ...record, note } };
}

/** Parse → apply `step` → re-serialize one stored JSON string column. A non-string / unparseable value is left as-is. */
function rewriteSerialized(
  serialized: unknown,
  step: (parsed: unknown) => { changed: boolean; value: unknown },
): { changed: boolean; value: unknown } {
  if (typeof serialized !== 'string' || serialized === '') return { changed: false, value: serialized };
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { changed: false, value: serialized };
  }
  const { changed, value } = step(parsed);
  return changed ? { changed: true, value: JSON.stringify(value) } : { changed: false, value: serialized };
}

/**
 * [#21207] The patch that withholds the stored hashes a conflict's
 * decision-audit note named, for one row of `table`, or `null` when there is
 * nothing to withhold:
 *
 *  - `sys_metadata_audit` — the note itself (`code = 'metadata_conflict'`);
 *  - `sys_audit_log` / `sys_activity` — the ledger snapshot / activity pair the
 *    writer copied a `sys_metadata_audit` row into.
 *
 * Each value becomes `(withheld)` and a `null` side stays `null` — the sentence
 * the protocol writes since this card, so a rewritten note and a new one read
 * the same. Idempotent.
 */
export function planDecisionNotePatch(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> | null {
  if (table === METADATA_DECISION_AUDIT_OBJECT) {
    if (!isConflictDecision(row)) return null;
    const note = withheldConflictNote(row.note);
    return note === undefined ? null : { note };
  }
  if (row.object_name !== METADATA_DECISION_AUDIT_OBJECT) return null;
  if (table === 'sys_audit_log') {
    const patch: Record<string, unknown> = {};
    for (const column of ['new_value', 'old_value']) {
      const out = rewriteSerialized(row[column], withheldNoteSnapshot);
      if (out.changed) patch[column] = out.value;
    }
    return Object.keys(patch).length > 0 ? patch : null;
  }
  if (table === 'sys_activity') {
    const out = rewriteSerialized(row.metadata, (parsed) => {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { changed: false, value: parsed };
      const pair = parsed as Record<string, unknown>;
      const oldR = withheldNoteSnapshot(pair.old);
      const newR = withheldNoteSnapshot(pair.new);
      if (!oldR.changed && !newR.changed) return { changed: false, value: parsed };
      return { changed: true, value: { ...pair, old: oldR.value, new: newR.value } };
    });
    return out.changed ? { metadata: out.value } : null;
  }
  return null;
}

/** Whether a copy row is about a stored-metadata-body row — its `object_name` says so, or it names none. */
function copiesStoredMetadataRow(row: Record<string, unknown>): boolean {
  return row.object_name === undefined || row.object_name === null
    || (STORED_METADATA_BODY_OBJECTS as ReadonlySet<string>).has(String(row.object_name));
}

/** Redact the body AND drop the content-hash columns of one parsed snapshot of a stored-metadata row. */
function redactStoredMetadataSnapshot(
  snapshot: unknown,
  typeHint: string | undefined,
  dropHashes: boolean,
): { changed: boolean; value: unknown } {
  const body = redactLedgerSnapshotBody(snapshot, typeHint);
  if (!dropHashes) return body;
  const hashes = withoutStoredHashColumns(body.value);
  return { changed: body.changed || hashes.changed, value: hashes.value };
}

/** The rewrite reads and writes as the platform, never as a user. */
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * Redact the metadata body nested inside one parsed ledger snapshot — a
 * `sys_audit_log.new_value`/`old_value` object, or one half (`old` / `new`) of
 * a `sys_activity.metadata` pair. Returns the snapshot unchanged when it
 * carries no body, a copy with the body projected when it does, and a copy with
 * the body column DROPPED when the body cannot be judged (fail-closed).
 *
 * `typeHint` is consulted only when the snapshot subset carries no `type`
 * column of its own.
 */
export function redactLedgerSnapshotBody(
  snapshot: unknown,
  typeHint?: string,
): { changed: boolean; value: unknown } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { changed: false, value: snapshot };
  }
  const record = snapshot as Record<string, unknown>;
  if (!(STORED_METADATA_BODY_COLUMN in record)) return { changed: false, value: snapshot };

  const ownType = record[STORED_METADATA_TYPE_COLUMN];
  const type = typeof ownType === 'string' && ownType !== '' ? ownType : typeHint;
  const outcome = redactStoredMetadataBody(type, record[STORED_METADATA_BODY_COLUMN]);
  if (outcome.ok) {
    if (outcome.body === record[STORED_METADATA_BODY_COLUMN]) return { changed: false, value: snapshot };
    return { changed: true, value: { ...record, [STORED_METADATA_BODY_COLUMN]: outcome.body } };
  }
  const { [STORED_METADATA_BODY_COLUMN]: _withheld, ...rest } = record;
  return { changed: true, value: rest };
}

/**
 * Parse → redact (and, for a stored-metadata row's copy, drop the content-hash
 * columns) → re-serialize one stored JSON string column. A non-string /
 * unparseable value is left as-is.
 */
function redactSerializedSnapshot(
  serialized: unknown,
  typeHint: string | undefined,
  dropHashes: boolean,
): { changed: boolean; value: unknown } {
  return rewriteSerialized(serialized, (parsed) => redactStoredMetadataSnapshot(parsed, typeHint, dropHashes));
}

/**
 * The patch for one `sys_audit_log` row about a stored-metadata-body object, or
 * `null` when the row holds no credential body to rewrite — and [#21207] no
 * stored content hash to drop.
 */
export function planAuditRowPatch(
  row: Record<string, unknown>,
  typeHint?: string,
): { new_value?: unknown; old_value?: unknown } | null {
  const dropHashes = copiesStoredMetadataRow(row);
  const patch: { new_value?: unknown; old_value?: unknown } = {};
  const nv = redactSerializedSnapshot(row.new_value, typeHint, dropHashes);
  if (nv.changed) patch.new_value = nv.value;
  const ov = redactSerializedSnapshot(row.old_value, typeHint, dropHashes);
  if (ov.changed) patch.old_value = ov.value;
  return nv.changed || ov.changed ? patch : null;
}

/**
 * The patch for one `sys_activity` row about a stored-metadata-body object, or
 * `null` when it holds no credential body — and [#21207] no stored content hash
 * to drop. `sys_activity.metadata` is the serialized pair `{ old, new }`, each
 * half a ledger snapshot.
 */
export function planActivityRowPatch(
  row: Record<string, unknown>,
  typeHint?: string,
): { metadata: string } | null {
  const serialized = row.metadata;
  if (typeof serialized !== 'string' || serialized === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const pair = parsed as Record<string, unknown>;
  const dropHashes = copiesStoredMetadataRow(row);
  const oldR = redactStoredMetadataSnapshot(pair.old, typeHint, dropHashes);
  const newR = redactStoredMetadataSnapshot(pair.new, typeHint, dropHashes);
  if (!oldR.changed && !newR.changed) return null;
  return { metadata: JSON.stringify({ ...pair, old: oldR.value, new: newR.value }) };
}

/**
 * The engine surface the runner needs — the REAL data-engine contract's three
 * members, picked rather than re-declared, so every call below is checked
 * against the signatures the engine actually serves (`update` takes the row's
 * `id` INSIDE `data`, and the execution context rides the trailing options).
 */
export type StoredMetadataBodyMigrationEngine = Pick<IDataEngine, 'find' | 'findOne' | 'update'>;

/** Log sink — the guaranteed `warn` fallback plus optional `info` (#9754 shape). */
export interface MigrationLogger {
  info?(message: string): void;
  warn(message: string): void;
}

/** What one migration run did (or would do in dry-run). */
export interface StoredMetadataBodyMigrationReport {
  apply: boolean;
  /** Per audit-family object: rows scanned and rows rewritten (or that would be). */
  readonly byObject: Record<string, { scanned: number; rewritten: number }>;
  /** Rows a planner changed, total across the two tables. */
  rewritten: number;
  /** Rows read, total. */
  scanned: number;
  /** Rows an `update` threw on (apply mode) — re-run to finish them. */
  failures: number;
}

function asArray(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && Array.isArray((result as { records?: unknown }).records)) {
    return (result as { records: Record<string, unknown>[] }).records;
  }
  return [];
}

/**
 * Rewrite every `sys_audit_log` / `sys_activity` row that copied a stored
 * metadata body in cleartext, projecting the body through the shared redactor
 * — and [#21207] every copy that carries a stored content hash (dropped) and
 * every conflict note in `sys_metadata_audit` and its copies that names one
 * (withheld). Dry-run by default; `apply` writes. Idempotent.
 */
export async function migrateStoredMetadataBodyCopies(
  engine: StoredMetadataBodyMigrationEngine,
  logger: MigrationLogger,
  options: { apply?: boolean } = {},
): Promise<StoredMetadataBodyMigrationReport> {
  const apply = options.apply === true;
  const report: StoredMetadataBodyMigrationReport = {
    apply,
    byObject: {},
    rewritten: 0,
    scanned: 0,
    failures: 0,
  };

  // Best-effort `record_id` → metadata `type` resolver: an update diff snapshot
  // may carry no `type` column, so the live `sys_metadata` row answers it when
  // it still exists. A miss leaves the planner to fail closed.
  const typeCache = new Map<string, string | undefined>();
  const resolveType = async (recordId: unknown): Promise<string | undefined> => {
    if (typeof recordId !== 'string' || recordId === '') return undefined;
    if (typeCache.has(recordId)) return typeCache.get(recordId);
    let type: string | undefined;
    try {
      const row = await engine.findOne('sys_metadata', { where: { id: recordId } }, { context: SYSTEM_CTX });
      const t = row?.[STORED_METADATA_TYPE_COLUMN];
      type = typeof t === 'string' && t !== '' ? t : undefined;
    } catch {
      type = undefined;
    }
    typeCache.set(recordId, type);
    return type;
  };

  // [#21207] The copies of a decision-audit row are read too (its conflict
  // note named both stored hashes), and so is the decision-audit table itself.
  const copiedObjects = [...STORED_METADATA_BODY_OBJECTS, METADATA_DECISION_AUDIT_OBJECT];
  const tables: ReadonlyArray<{ object: string; where: Record<string, unknown> }> = [
    ...STORED_METADATA_BODY_AUDIT_OBJECTS.map((object) => ({ object, where: { object_name: { $in: copiedObjects } } })),
    // A PREDICATE on the persisted `code` column (ADR-0112 D6b, the audit
    // column's own vocabulary), written in operator form: it reads rows by the
    // code they carry and stamps none.
    { object: METADATA_DECISION_AUDIT_OBJECT, where: { code: { $eq: CONFLICT_NOTE_CODE } } },
  ];
  for (const { object, where } of tables) {
    report.byObject[object] = { scanned: 0, rewritten: 0 };
    let rows: Record<string, unknown>[];
    try {
      const result = await engine.find(object, { where }, { context: SYSTEM_CTX });
      rows = asArray(result);
    } catch (e) {
      // A table this run could not read is NOT a clean table: counted as a
      // failure so the run says so (and the command exits non-zero) instead of
      // reporting "nothing to rewrite" for rows it never looked at.
      report.failures += 1;
      logger.warn(
        `[stored-metadata-body-migration] could not read ${object} — its rows were NOT examined: ` +
          `${(e as Error)?.message ?? String(e)}`,
      );
      continue;
    }

    for (const row of rows) {
      report.scanned += 1;
      report.byObject[object].scanned += 1;
      // [#21207] A decision-audit row, or a copy of one: its conflict note.
      const isDecision = object === METADATA_DECISION_AUDIT_OBJECT || row.object_name === METADATA_DECISION_AUDIT_OBJECT;
      const patch = isDecision
        ? planDecisionNotePatch(object, row)
        : object === 'sys_audit_log'
          ? planAuditRowPatch(row, await resolveType(row.record_id))
          : planActivityRowPatch(row, await resolveType(row.record_id));
      if (!patch) continue;
      report.rewritten += 1;
      report.byObject[object].rewritten += 1;
      if (!apply) continue;
      const id = row.id;
      if (typeof id !== 'string' || id === '') {
        report.failures += 1;
        logger.warn(`[stored-metadata-body-migration] ${object} row has no id — cannot rewrite`);
        continue;
      }
      try {
        // A single-id write: the engine reads the target from `data.id`. Run as
        // the platform — a system caller is exempt from the static-readonly
        // strip every audit/activity field carries, so the rewrite is stored.
        await engine.update(object, { ...patch, id }, { context: SYSTEM_CTX });
      } catch (e) {
        report.failures += 1;
        logger.warn(
          `[stored-metadata-body-migration] failed to rewrite ${object}/${id}: ${(e as Error)?.message ?? String(e)}`,
        );
      }
    }
  }

  logger.info?.(
    `[stored-metadata-body-migration] ${apply ? 'rewrote' : 'would rewrite'} ${report.rewritten} of ${report.scanned} ` +
      `audit/activity/decision row(s) carrying a stored metadata body or a stored content hash` +
      (report.failures > 0 ? ` (${report.failures} failed — re-run to finish)` : ''),
  );
  return report;
}
