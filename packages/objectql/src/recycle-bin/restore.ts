// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D2] The recycle bin's restore: one entry written back
 * under its original ids, its cleared references re-linked, its roll-ups
 * recomputed, and `data.record.restored` published for every row that came
 * back.
 *
 * ## One verb: `restore`
 *
 * `ObjectQL.restore(entryId)` is dispatched through the middleware chain as the
 * `restore` operation, on the BUSINESS object the entry's master row belongs
 * to, with no `ast` and no id, as `purge(entryId)` is (`purge.ts`). The verb is
 * outside the hook namespace (`ENGINE_OPERATION_VERBS.restore = false`), so
 * `beforeRestore` / `afterRestore` stay plain names a plugin may dispatch.
 * Until `@objectstack/plugin-security` maps the verb to its grants
 * (`allowRestoreOwnDeleted` / `manageRecycleBin`, ADR-0148 D5), its fail-closed
 * backstop for the destructive verbs (`DESTRUCTIVE_OPERATIONS`) refuses every
 * caller that is not the system.
 *
 * ## The entry is the unit (ADR-0148 D2)
 *
 * Every row of the entry comes back, the master first and its details after it
 * in the order the snapshot lists them, or none does. A restore that would
 * write something it should not refuses BEFORE it writes, with one of the four
 * 409 codes (`RECYCLE_BIN_RESTORE_REFUSAL_CODES`), and the entry stays:
 *
 *   - `RESTORE_PACKAGE_UNINSTALLED`: an object of the entry is no longer
 *     registered;
 *   - `RESTORE_PARENT_PURGED`: a row's master-detail parent is neither live, nor
 *     a row of this entry, nor held by another entry (as its master or as a row
 *     of its cascade), or its object is no longer registered;
 *   - `RESTORE_PARENT_IN_RECYCLE_BIN`: a row's master-detail parent is not live
 *     but is held by another entry; the refusal names that entry, and restoring
 *     it first lets this one through. It is answered only when none of the
 *     permanent refusals stands for any row. Either way a detail is never
 *     written back under a parent that is not there;
 *   - `RESTORE_UNIQUE_VALUE_TAKEN`: a live row now holds a unique value of a
 *     snapshotted row, or its id. The probe reads as the caller; a value held
 *     where the caller cannot read (a `unique: 'global'` field across
 *     organizations) is refused by the store's own constraint at the write, and
 *     that violation is answered with the same code.
 *
 * The writes then run in one unit of work: in one transaction when every
 * object involved is stored by the bin's driver, and otherwise with each write
 * undone on failure, as the capture compensates (`capture.ts`).
 *
 * ## Why raw
 *
 * The rows are written through each object's driver, not `engine.insert`: a
 * restore is not a create (ADR-0148 D2), so no insert hook runs, no default or
 * autonumber is issued and `created_by` / `created_at` stand as the snapshot
 * holds them. The re-link of a cleared reference is the opposite case: it
 * edits a live row, so it goes through `engine.update` with the restore's
 * context, as the delete's `set_null` clear went (`engine-cascade-planning.ts`).
 */

import {
  RECYCLE_BIN_OBJECT,
  RecycleBinSnapshotSchema,
  type RecycleBinClearedReference,
  type RecycleBinSnapshotRow,
} from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { Logger } from '@objectstack/core';
import { isUniqueViolationError, keysetWalk, redactBoundStatement, uniqueViolationColumn } from '@objectstack/types';
import type { OperationContext } from '../engine-top-level.js';
import { declaredMultiValued } from '../engine-top-level.js';
import { SummaryRecomputeError, type SummaryRecomputeFailure } from '../summary-errors.js';
import { resolveTenantFieldName } from '../tenancy/system-write-organization.js';
import { recycleBinCallRefusal } from './purge.js';

/** What {@link restoreRecycleBinEntry} reads off the engine. */
export interface RecycleBinRestoreHost {
  readonly _registry: { getObject(name: string): unknown };
  readonly logger: Pick<Logger, 'warn' | 'error'>;
  getDriver(object: string): any;
  buildDriverOptions(object: string, execCtx?: ExecutionContext): any;
  executeWithMiddleware(ctx: OperationContext, executor: () => Promise<any>): Promise<any>;
  transaction<T>(callback: (trxCtx: any) => Promise<T>, baseContext?: any): Promise<T>;
  update(object: string, data: any, options?: any): Promise<unknown>;
  recomputeSummaries(childObject: string, records: any, previous: any, execCtx?: ExecutionContext): Promise<SummaryRecomputeFailure[]>;
  publishDataEvent(
    action: 'restored',
    object: string,
    input: { recordId: unknown; after?: unknown; organizationRow?: unknown; context?: ExecutionContext },
  ): Promise<void>;
}

/** The options `ObjectQL.restore` takes. */
export interface RecycleBinRestoreOptions {
  /** The caller; it scopes the entry to its organization and is authorized for `restore`. */
  context?: ExecutionContext;
}

/** What `ObjectQL.restore` answers for an entry it wrote back. */
export interface RecycleBinRestoreResult {
  /** The entry that was restored, and is now removed. */
  readonly entryId: string;
  /** The object of the entry's master row. */
  readonly object: string;
  /** The id of the entry's master row, restored unchanged. */
  readonly recordId: string;
  /** Every row written back, the master first: object and id. */
  readonly rows: ReadonlyArray<{ readonly object: string; readonly id: string }>;
  /** How many cleared references were re-linked. */
  readonly relinked: number;
}

/** A field as the restore reads it off an object's schema. */
interface FieldDef {
  readonly type?: unknown;
  readonly reference?: unknown;
  readonly unique?: unknown;
  readonly multiple?: unknown;
}

function fieldsOf(schema: unknown): Record<string, FieldDef> {
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  return fields && typeof fields === 'object' ? (fields as Record<string, FieldDef>) : {};
}

/** A stored value that holds something: not `null`, `undefined` or `''`. */
function holdsValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/** The refusal envelope every restore refusal shares (ADR-0112, status 409). */
function stampRefusal(err: any, message: string, developerMessage: string, details: Record<string, unknown>): Error {
  err.message = message;
  err.developerMessage = developerMessage;
  err.status = 409;
  err.httpStatus = 409;
  for (const [key, value] of Object.entries(details)) if (value !== undefined) err[key] = value;
  return err;
}

/** `RESTORE_PACKAGE_UNINSTALLED`: an object of the entry is no longer registered. */
function packageUninstalledRefusal(entryId: string, object: string): Error {
  const err: any = new Error();
  err.code = 'RESTORE_PACKAGE_UNINSTALLED';
  return stampRefusal(
    err,
    `This record cannot be restored: '${object}' no longer exists, because the package that defined it was uninstalled.`,
    `Recycle-bin entry '${entryId}' holds rows of '${object}', which the registry no longer has. ` +
      'A restore writes nothing for an object that does not exist; reinstall its package to restore the entry, or purge it.',
    { object, entryId },
  );
}

/** `RESTORE_PARENT_PURGED`: a row's master-detail parent is neither live nor in the recycle bin. */
function parentPurgedRefusal(
  entryId: string,
  row: { object: string; id: string },
  field: string,
  parent: { object: string; id: string },
): Error {
  const err: any = new Error();
  err.code = 'RESTORE_PARENT_PURGED';
  return stampRefusal(
    err,
    'This record cannot be restored: the record it belongs to was deleted for good.',
    `Recycle-bin entry '${entryId}' holds '${row.object}' '${row.id}', whose master-detail parent ` +
      `'${parent.object}' '${parent.id}' (field '${field}') is neither live, nor a row of this entry, nor the record ` +
      'of another recycle-bin entry. A detail is never written back under a parent that is not there.',
    { object: row.object, recordId: row.id, field, entryId, parentObject: parent.object, parentId: parent.id },
  );
}

/**
 * `RESTORE_PARENT_IN_RECYCLE_BIN`: a row's master-detail parent is not live but
 * is held by ANOTHER recycle-bin entry, as its master or as a row of its cascade. Unlike the other three, the
 * refusal is not permanent: it names that entry (`parentEntryId`), and
 * restoring it first lets this one through (ruling 6710220841 on #30237).
 */
function parentInRecycleBinRefusal(
  entryId: string,
  row: { object: string; id: string },
  field: string,
  parent: { object: string; id: string },
  parentEntryId: string,
): Error {
  const err: any = new Error();
  err.code = 'RESTORE_PARENT_IN_RECYCLE_BIN';
  return stampRefusal(
    err,
    'This record cannot be restored yet: the record it belongs to is in the recycle bin. Restore that record first.',
    `Recycle-bin entry '${entryId}' holds '${row.object}' '${row.id}', whose master-detail parent ` +
      `'${parent.object}' '${parent.id}' (field '${field}') is not live: it is the record of recycle-bin entry ` +
      `'${parentEntryId}'. Restore that entry first; a detail is never written back under a parent that is not there.`,
    { object: row.object, recordId: row.id, field, entryId, parentObject: parent.object, parentId: parent.id, parentEntryId },
  );
}

/** `RESTORE_UNIQUE_VALUE_TAKEN`: a live row holds a unique value of a snapshotted row. */
function uniqueValueTakenRefusal(entryId: string, row: { object: string; id: string }, field: string | undefined, cause?: unknown): Error {
  const err: any = new Error();
  err.code = 'RESTORE_UNIQUE_VALUE_TAKEN';
  const named = field !== undefined ? `'${field}'` : 'a unique value';
  stampRefusal(
    err,
    field === 'id'
      ? `This record cannot be restored: a record with its id exists again.`
      : `This record cannot be restored: another record now holds a value it must keep unique (${named}).`,
    `Recycle-bin entry '${entryId}' holds '${row.object}' '${row.id}', and a live row of '${row.object}' now holds ` +
      `${field === 'id' ? 'its id' : `its value of ${named}`}. A restore never forces a write over a live row: change ` +
      'or delete that row, then restore the entry again.',
    { object: row.object, recordId: row.id, field, entryId },
  );
  if (cause !== undefined) err.cause = redactBoundStatement(cause);
  return err;
}

/** A stored snapshot, read off a driver that may hand JSON back as text; `undefined` when it does not parse. */
function parseSnapshot(stored: unknown) {
  let value = stored;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = undefined; }
  }
  const parsed = RecycleBinSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The entry's stored snapshot; an entry whose snapshot does not parse cannot be restored. */
function readSnapshot(entryId: string, stored: unknown) {
  const snapshot = parseSnapshot(stored);
  if (snapshot === undefined) {
    // The bin is engine-owned and its snapshot engine-written: an entry that
    // does not parse is a defect in the store, not a caller's mistake.
    const err: any = new Error(`Recycle-bin entry '${entryId}' holds a snapshot that does not parse, so it cannot be restored.`);
    err.entryId = entryId;
    throw err;
  }
  return snapshot;
}

/**
 * The live value a re-link writes, or `undefined` when the reference has been
 * changed since the delete and stays as it is (ADR-0148 D2: "only if nothing
 * has changed it since"):
 *
 *   - single-valued: re-linked while the field still holds no value;
 *   - multi-valued: the delete removed one member and kept the rest
 *     (`remainderAfterMemberRemoval`), so the member is added back while the
 *     field no longer holds it.
 */
export function relinkedValue(field: FieldDef | undefined, current: unknown, value: string): unknown {
  if (declaredMultiValued(field as { type?: unknown; multiple?: unknown } | undefined)) {
    const members: unknown[] = Array.isArray(current) ? current : holdsValue(current) ? [current] : [];
    if (members.some((m) => String(m) === value)) return undefined;
    return [...members, value];
  }
  return holdsValue(current) ? undefined : value;
}

/**
 * The body of `ObjectQL.restore`: write one recycle-bin entry back. Answers
 * what came back, or `null` when no entry with that id is visible to the
 * caller's organization, or the composition registers no bin.
 */
export async function restoreRecycleBinEntry(
  this: RecycleBinRestoreHost,
  entryId: string | number,
  options?: RecycleBinRestoreOptions,
): Promise<RecycleBinRestoreResult | null> {
  if (!((typeof entryId === 'string' && entryId !== '') || (typeof entryId === 'number' && Number.isFinite(entryId)))) {
    throw recycleBinCallRefusal(
      'A restore names the recycle-bin entry by its id.',
      `ObjectQL.restore(entryId) takes the entry id as a non-empty string or a number; got ${JSON.stringify(entryId)}.`,
      undefined,
      'entryId',
    );
  }
  if (!this._registry.getObject(RECYCLE_BIN_OBJECT)) return null;
  const context = options?.context;
  const binDriver = this.getDriver(RECYCLE_BIN_OBJECT);
  const found = ((await binDriver.find(
    RECYCLE_BIN_OBJECT,
    { object: RECYCLE_BIN_OBJECT, where: { id: entryId }, fields: ['id', 'object_name', 'record_id', 'snapshot'], limit: 1 },
    this.buildDriverOptions(RECYCLE_BIN_OBJECT, context),
  )) ?? []) as Array<Record<string, unknown>>;
  const entry = found[0];
  if (entry?.id == null || typeof entry.object_name !== 'string' || entry.object_name === '') return null;
  const id = String(entry.id);
  const snapshot = readSnapshot(id, entry.snapshot);
  const opCtx: OperationContext = { object: entry.object_name, operation: 'restore', options: { context }, context };
  return await this.executeWithMiddleware(opCtx, async () => {
    await judgeRestore.call(this, id, snapshot.rows, opCtx.context);
    const relinked = await writeBack.call(this, id, snapshot.rows, snapshot.clearedReferences, opCtx.context);

    // Roll-ups recompute from the rows that are back (ADR-0148 D2), one call
    // per object, as an insert recomputes from the rows it wrote.
    const byObject = new Map<string, Array<Record<string, unknown>>>();
    for (const row of snapshot.rows) {
      const record = { ...row.values, id: row.id };
      const rows = byObject.get(row.object);
      if (rows) rows.push(record); else byObject.set(row.object, [record]);
    }
    const failures: SummaryRecomputeFailure[] = [];
    for (const [object, records] of byObject) {
      failures.push(...await this.recomputeSummaries(object, records, null, opCtx.context));
    }

    // One `data.record.restored` per row that came back: a restore is its own
    // event, never a create (ADR-0148 D2), so a record-created trigger does not fire.
    for (const row of snapshot.rows) {
      const record = { ...row.values, id: row.id };
      await this.publishDataEvent('restored', row.object, { recordId: row.id, after: record, organizationRow: record, context: opCtx.context });
    }

    const result: RecycleBinRestoreResult = {
      entryId: id,
      object: entry.object_name as string,
      recordId: typeof entry.record_id === 'string' ? entry.record_id : snapshot.rows[0].id,
      rows: snapshot.rows.map((r) => ({ object: r.object, id: r.id })),
      relinked,
    };
    if (failures.length > 0) throw new SummaryRecomputeError(failures, result);
    return result;
  });
}

/**
 * Refuse, before anything is written, a restore that would write what it
 * should not. Reads only, as the caller.
 *
 * Every row is judged for the PERMANENT refusals first (package uninstalled,
 * parent purged, id or unique value taken), and only then is a parent that is
 * in the bin answered: `RESTORE_PARENT_IN_RECYCLE_BIN` tells the caller that
 * restoring another entry first lets this one through, which is false while a
 * permanent reason stands, so it never hides one.
 */
async function judgeRestore(
  this: RecycleBinRestoreHost,
  entryId: string,
  rows: RecycleBinSnapshotRow[],
  context: ExecutionContext | undefined,
): Promise<void> {
  // 1. Every object of the entry still exists.
  for (const row of rows) {
    if (!this._registry.getObject(row.object)) throw packageUninstalledRefusal(entryId, row.object);
  }
  const inEntry = new Set(rows.map((r) => `${r.object}\u0000${r.id}`));
  const isLive = async (object: string, where: Record<string, unknown>): Promise<boolean> => {
    const live = ((await this.getDriver(object).find(
      object,
      { object, where, fields: ['id'], limit: 1 },
      this.buildDriverOptions(object, context),
    )) ?? []) as unknown[];
    return live.length > 0;
  };
  /** The first parent found in the bin, answered once nothing permanent stands. */
  let inBin: { row: RecycleBinSnapshotRow; field: string; parent: { object: string; id: string }; parentEntryId: string } | undefined;
  for (const row of rows) {
    const schema = this._registry.getObject(row.object);
    const fields = fieldsOf(schema);
    // 2. Every master-detail parent is live, or comes back with this entry.
    for (const [field, def] of Object.entries(fields)) {
      if (def?.type !== 'master_detail' || typeof def.reference !== 'string') continue;
      const value = row.values[field];
      if (!holdsValue(value)) continue;
      const parent = { object: def.reference, id: String(value) };
      if (inEntry.has(`${parent.object}\u0000${parent.id}`)) continue;
      // A parent whose object is no longer registered can be neither live nor
      // restored (its own entry would refuse RESTORE_PACKAGE_UNINSTALLED), so it
      // is gone for good, whatever the bin holds.
      if (!this._registry.getObject(parent.object)) throw parentPurgedRefusal(entryId, row, field, parent);
      if (await isLive(parent.object, { id: parent.id })) continue;
      const parentEntryId = await parentEntryOf.call(this, parent, entryId, context);
      if (parentEntryId === undefined) throw parentPurgedRefusal(entryId, row, field, parent);
      inBin ??= { row, field, parent, parentEntryId };
    }
    // 3. No live row holds its id, or a unique value of it.
    if (await isLive(row.object, { id: row.id })) throw uniqueValueTakenRefusal(entryId, row, 'id');
    const tenantField = resolveTenantFieldName(schema);
    for (const [field, def] of Object.entries(fields)) {
      if (field === 'id' || !(def?.unique === true || def?.unique === 'organization' || def?.unique === 'global')) continue;
      const value = row.values[field];
      if (!holdsValue(value) || (typeof value === 'object')) continue;
      const where: Record<string, unknown> = { [field]: value };
      // A per-organization unique value is unique within the row's own organization.
      if (def.unique !== 'global' && tenantField && holdsValue(row.values[tenantField])) where[tenantField] = row.values[tenantField];
      if (await isLive(row.object, where)) throw uniqueValueTakenRefusal(entryId, row, field);
    }
  }
  // 4. Nothing permanent stands: a parent in the bin is the one reason left.
  if (inBin) throw parentInRecycleBinRefusal(entryId, inBin.row, inBin.field, inBin.parent, inBin.parentEntryId);
}

/** How many entries one page of {@link parentEntryOf}'s snapshot walk reads. */
const PARENT_SCAN_PAGE_SIZE = 200;

/**
 * The OTHER entry that holds a parent, as its master or as a row of its
 * cascade, when one does: named in the refusal. Reads the entries the caller
 * can see.
 *
 * A parent is the master of an entry when it was deleted by id, and a detail
 * of one when it went with ITS master's cascade (`account ← contact ← task`:
 * the task deleted alone, then the account, whose entry holds the contact). The
 * first is one indexed read on `object_name` / `record_id`; the second has no
 * column to read, so the entries are walked a page at a time, by key, and each
 * snapshot's rows searched. The walk runs only on the refusal path.
 */
async function parentEntryOf(
  this: RecycleBinRestoreHost,
  parent: { object: string; id: string },
  entryId: string,
  context: ExecutionContext | undefined,
): Promise<string | undefined> {
  const driver = this.getDriver(RECYCLE_BIN_OBJECT);
  const driverOptions = this.buildDriverOptions(RECYCLE_BIN_OBJECT, context);
  const asMaster = ((await driver.find(
    RECYCLE_BIN_OBJECT,
    { object: RECYCLE_BIN_OBJECT, where: { object_name: parent.object, record_id: parent.id }, fields: ['id'], limit: 1 },
    driverOptions,
  )) ?? []) as Array<Record<string, unknown>>;
  if (asMaster[0]?.id != null) return String(asMaster[0].id);
  const walk = keysetWalk<Record<string, unknown>>(
    async (q) => ((await driver.find(
      RECYCLE_BIN_OBJECT,
      { object: RECYCLE_BIN_OBJECT, ...(q.where !== undefined ? { where: q.where } : {}), orderBy: q.orderBy, limit: q.limit, fields: ['id', 'snapshot'] },
      driverOptions,
    )) ?? []) as Array<Record<string, unknown>>,
    { pageSize: PARENT_SCAN_PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const entry of page) {
      if (entry.id == null || String(entry.id) === entryId) continue;
      const snapshot = parseSnapshot(entry.snapshot);
      if (snapshot?.rows.some((r) => r.object === parent.object && r.id === parent.id)) return String(entry.id);
    }
  }
  if (walk.truncated) {
    // A store that did not apply the seek: the walk stopped rather than spin,
    // and the parent is answered as purged, a refusal either way.
    this.logger.warn('[recycle-bin] the walk for a parent\'s entry stopped before the end of the bin', {
      entry: entryId, parentObject: parent.object, parentId: parent.id, scanned: walk.scanned,
    });
  }
  return undefined;
}

/** One write the unit made, and how to undo it when no transaction covers it. */
interface Done {
  readonly covered: boolean;
  undo(): Promise<void>;
}

/**
 * Write the entry back in one unit of work: the rows, master first; the
 * re-links; the entry's removal. Answers how many references were re-linked.
 */
async function writeBack(
  this: RecycleBinRestoreHost,
  entryId: string,
  rows: RecycleBinSnapshotRow[],
  clearedReferences: RecycleBinClearedReference[],
  context: ExecutionContext | undefined,
): Promise<number> {
  const binDriver = this.getDriver(RECYCLE_BIN_OBJECT);
  const objects = new Set<string>([...rows.map((r) => r.object), ...clearedReferences.map((r) => r.object)]);
  const oneStore = [...objects].every((o) => !this._registry.getObject(o) || this.getDriver(o) === binDriver);
  const run = async (writeContext: ExecutionContext | undefined): Promise<number> => {
    const done: Done[] = [];
    try {
      for (const row of rows) {
        const driver = this.getDriver(row.object);
        const driverOptions = this.buildDriverOptions(row.object, writeContext);
        try {
          await driver.create(row.object, { ...row.values, id: row.id }, driverOptions);
        } catch (error) {
          if (isUniqueViolationError(error)) throw uniqueValueTakenRefusal(entryId, row, uniqueViolationColumn(error), error);
          throw error;
        }
        done.push({
          covered: driverOptions?.transaction != null,
          undo: async () => { await driver.delete(row.object, row.id, driverOptions); },
        });
      }
      let relinked = 0;
      for (const ref of clearedReferences) {
        const schema = this._registry.getObject(ref.object);
        if (!schema) continue;
        const field = fieldsOf(schema)[ref.field];
        const driver = this.getDriver(ref.object);
        const driverOptions = this.buildDriverOptions(ref.object, writeContext);
        const live = ((await driver.find(
          ref.object,
          { object: ref.object, where: { id: ref.id }, fields: ['id', ref.field], limit: 1 },
          driverOptions,
        )) ?? []) as Array<Record<string, unknown>>;
        if (live.length === 0) continue;
        const previous = live[0][ref.field];
        const next = relinkedValue(field, previous, ref.value);
        if (next === undefined) continue;
        await this.update(ref.object, { id: ref.id, [ref.field]: next }, { context: writeContext });
        relinked += 1;
        // Through `engine.update`, so the re-link publishes `data.record.updated`
        // when it lands, and its undo publishes one more: a restore that fails
        // after a re-link outside a transaction leaves two update events for a
        // row that ends as it began.
        done.push({
          covered: driverOptions?.transaction != null,
          undo: async () => { await this.update(ref.object, { id: ref.id, [ref.field]: previous ?? null }, { context: writeContext }); },
        });
      }
      // The entry goes last: a restore that did not land keeps its entry.
      await binDriver.delete(RECYCLE_BIN_OBJECT, entryId, this.buildDriverOptions(RECYCLE_BIN_OBJECT, writeContext));
      return relinked;
    } catch (error) {
      for (const step of done.reverse()) {
        if (step.covered) continue;
        try {
          await step.undo();
        } catch (undoError) {
          const redacted = redactBoundStatement(undoError);
          this.logger.error(
            '[recycle-bin] a restore failed and undoing one of its writes failed too; a restored row or a re-linked reference stays',
            redacted instanceof Error ? redacted : undefined,
            { entry: entryId },
          );
        }
      }
      throw error;
    }
  };
  if (!oneStore) {
    this.logger.warn('[recycle-bin] this restore spans more than one datasource, so it runs without a transaction; a failed write is undone write by write', {
      entry: entryId, objects: [...objects],
    });
    return run(context);
  }
  return this.transaction(async (trxCtx: ExecutionContext) => run(trxCtx), context);
}
