// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D1] The recycle bin's write side: one entry per delete
 * operation, snapshotted before the physical delete.
 *
 * ## Where it runs
 *
 * `ObjectQL.delete`'s by-id branch, inside `runByIdDelete`, so it shares that
 * branch's unit of work:
 *
 *   1. {@link openRecycleBinCapture}, before the cascade: is this delete one
 *      the bin takes (see "Which deletes enter the bin"), is the bin there,
 *      and what is the retention. A retention defect refuses the delete here,
 *      before anything is written.
 *   2. {@link RecycleBinCapture.onCollected}, handed to
 *      `cascadeDeleteRelations`: once the cascade set is collected and its
 *      restricts judged, and before the walk deletes or clears anything, the
 *      set's rows are read as they stand. The walk then records each `set_null`
 *      reference it clears on the set ({@link CascadeDeleteSet.clearedReferences}).
 *   3. {@link RecycleBinCapture.write}, after the walk and before the root row
 *      is removed: the entry is written raw through the bin's driver, with the
 *      driver options of this unit of work, so a transaction that covers the
 *      bin's driver covers the entry too.
 *   4. {@link RecycleBinWrittenEntry.compensate}, when the root row's removal
 *      throws and no transaction covered the entry: the entry is removed, so a
 *      failed delete leaves no entry for a row that is still live.
 *
 * ## Which deletes enter the bin (v1, seat ruling on #30237 Q6)
 *
 * A by-id delete of a business object (a name outside `sys_`) that is the
 * ROOT of its cascade. Not: a delete by predicate (`multi: true`, a lifecycle
 * reap), a child the cascade deletes (it is a row of its root's entry), and a
 * `sys_*` object. A `sys_*` row the cascade reaches is left out of the
 * snapshot too.
 *
 * ## Why raw, and not `engine.insert`
 *
 * The entry is engine-owned bookkeeping about a delete, not a record anyone
 * created: `engine.insert` would run the bin through insert hooks, the audit
 * and activity mirrors and the security middleware (which refuses a
 * user-context write to an engine-owned object). `sys_secret` is written the
 * same way, for the same reason.
 */

import {
  RECYCLE_BIN_OBJECT,
  RecycleBinEntrySchema,
  type RecycleBinClearedReference,
  type RecycleBinEntry,
  type RecycleBinSnapshotRow,
} from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { Logger } from '@objectstack/core';
import { redactBoundStatement } from '@objectstack/types';
import { cascadeMemberKey, cascadeSetHas, type CascadeDeleteSet } from '../engine-top-level.js';
import { declaredColumnSet } from '../declared-read-columns.js';
import { deletedSecretColumns } from '../engine-secret-internal-fields.js';
import { resolveTenantFieldName } from '../tenancy/system-write-organization.js';
import { recycleBinPurgeAfter, resolveRecycleBinRetentionDays, type RecycleBinRetentionSettings } from './retention.js';

/**
 * Does a delete of `object` enter the bin at all? The v1 reach: every object
 * outside the `sys_` namespace. The by-id and root-of-cascade conditions are
 * the caller's ({@link openRecycleBinCapture}).
 */
export function recycleBinTakesObject(object: string): boolean {
  return !object.startsWith('sys_');
}

/** The notice that the composition registers no bin, given once per engine. */
const MISSING_BIN_NOTICE = 'missing-bin';

/** How many ids one snapshot read names: the cascade walk's own `$in` batch. */
const SNAPSHOT_READ_BATCH = 500;

/** The engine members the capture reads. */
export interface RecycleBinCaptureHost {
  readonly _registry: { getObject(name: string): unknown };
  readonly logger: Pick<Logger, 'info' | 'error'>;
  readonly cascadeDeleteSets: { getStore(): CascadeDeleteSet | undefined };
  readonly recycleBinRetention: RecycleBinRetentionSettings | undefined;
  /** The once-per-engine notices already given ({@link MISSING_BIN_NOTICE}). */
  readonly recycleBinNotices: Set<string>;
  getDriver(object: string): any;
  buildDriverOptions(object: string, execCtx?: ExecutionContext): any;
}

/** One cascade member, in the order the snapshot lists it. */
interface Member {
  readonly object: string;
  readonly id: string;
}

/**
 * The set's members, the root first and then breadth-first along the
 * cascading edges the collection walk recorded: a master always before its
 * details, which is the order a restore writes them back in. A member no edge
 * reaches (none should be) follows, so nothing collected is dropped.
 */
export function cascadeMembersInOrder(set: CascadeDeleteSet, root: Member): Member[] {
  const out: Member[] = [];
  const seen = new Set<string>();
  const queue: Member[] = [root];
  while (queue.length > 0) {
    const next = queue.shift()!;
    const key = cascadeMemberKey(next.object, next.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
    for (const edge of set.cascadeEdges.get(key) ?? []) {
      queue.push({ object: edge.object, id: String(edge.id) });
    }
  }
  for (const [object, ids] of set.members) {
    for (const id of ids) {
      const key = cascadeMemberKey(object, id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ object, id });
    }
  }
  return out;
}

/**
 * A row's values as the snapshot keeps them: the declared columns, the
 * `secret` columns left out (ADR-0148 D4: the delete releases their handles,
 * so a restored record's secret fields come back empty).
 */
function snapshotValues(schema: unknown, row: Record<string, unknown>): Record<string, unknown> {
  const declared = declaredColumnSet(schema as { fields?: unknown });
  const secrets = new Set(deletedSecretColumns(schema as Parameters<typeof deletedSecretColumns>[0]));
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (declared && !declared.has(key)) continue;
    if (secrets.has(key)) continue;
    values[key] = value;
  }
  return values;
}

/** The entry {@link RecycleBinCapture.write} wrote, for the caller to undo. */
export interface RecycleBinWrittenEntry {
  /** The entry's id as the driver answered it; `undefined` when it answered none. */
  readonly id: string | undefined;
  /**
   * Remove the entry when the root row's removal failed. A no-op when a
   * transaction covered the entry, since its rollback removes the entry with
   * everything else. A failure to remove it is logged at `error` and never
   * replaces the delete's own error.
   */
  compensate(): Promise<void>;
}

/**
 * One delete operation's capture: opened before the cascade, filled when the
 * cascade set is collected, written after the walk.
 */
export class RecycleBinCapture {
  private rows: RecycleBinSnapshotRow[] | undefined;
  private set: CascadeDeleteSet | undefined;

  constructor(
    private readonly host: RecycleBinCaptureHost,
    readonly object: string,
    readonly id: string,
    private readonly context: ExecutionContext | undefined,
    readonly retentionDays: number,
  ) {}

  /**
   * Handed to `cascadeDeleteRelations`: called once, with the delete's own
   * freshly collected set, after its restricts are judged and before the walk
   * writes. Reads every member's row raw, inside this unit of work.
   */
  readonly onCollected = async (set: CascadeDeleteSet): Promise<void> => {
    this.set = set;
    set.clearedReferences = [];
    const ordered = cascadeMembersInOrder(set, { object: this.object, id: this.id })
      .filter((m) => recycleBinTakesObject(m.object));
    const byObject = new Map<string, string[]>();
    for (const m of ordered) {
      const ids = byObject.get(m.object);
      if (ids) ids.push(m.id); else byObject.set(m.object, [m.id]);
    }
    const read = new Map<string, Record<string, unknown>>();
    for (const [object, ids] of byObject) {
      const schema = this.host._registry.getObject(object);
      const driver = this.host.getDriver(object);
      const options = this.host.buildDriverOptions(object, this.context);
      for (let i = 0; i < ids.length; i += SNAPSHOT_READ_BATCH) {
        const batch = ids.slice(i, i + SNAPSHOT_READ_BATCH);
        const where = batch.length === 1 ? { id: batch[0] } : { id: { $in: batch } };
        const rows = ((await driver.find(object, { object, where }, options)) ?? []) as Record<string, unknown>[];
        for (const row of rows) {
          if (row?.id == null) continue;
          read.set(cascadeMemberKey(object, row.id), snapshotValues(schema, row));
        }
      }
    }
    this.rows = [];
    for (const m of ordered) {
      const values = read.get(cascadeMemberKey(m.object, m.id));
      if (values) this.rows.push({ object: m.object, id: m.id, values });
    }
  };

  /**
   * Write the entry, after the walk and before the root row is removed.
   * `undefined` when there is nothing to keep: the root row was not there to
   * read (the delete removes nothing), or the set was never handed over.
   */
  async write(): Promise<RecycleBinWrittenEntry | undefined> {
    const rows = this.rows;
    if (!rows || rows.length === 0 || rows[0].object !== this.object || rows[0].id !== this.id) {
      if (!this.set) {
        // The cascade never handed its set over: an engine defect, not a
        // configuration. The delete still runs; the lost snapshot is loud.
        this.host.logger.error('[recycle-bin] the cascade set was never collected; this delete has no recycle-bin entry', undefined, {
          object: this.object, id: this.id,
        });
      }
      return undefined;
    }
    const deletedAt = new Date();
    const deletedBy = this.deletedBy();
    const organizationId = this.organizationOf(rows[0].values);
    const clearedReferences: RecycleBinClearedReference[] = [...(this.set?.clearedReferences ?? [])];
    const entry: RecycleBinEntry = RecycleBinEntrySchema.parse({
      object_name: this.object,
      record_id: this.id,
      record_count: rows.length,
      snapshot: { rows, clearedReferences },
      ...(deletedBy !== undefined ? { deleted_by: deletedBy } : {}),
      deleted_at: deletedAt.toISOString(),
      retention_days: this.retentionDays,
      purge_after: recycleBinPurgeAfter(deletedAt, this.retentionDays),
    });
    const row: Record<string, unknown> = { ...entry };
    if (organizationId !== undefined) row.organization_id = organizationId;
    const driver = this.host.getDriver(RECYCLE_BIN_OBJECT);
    const options = this.host.buildDriverOptions(RECYCLE_BIN_OBJECT, this.context);
    const written = (await driver.create(RECYCLE_BIN_OBJECT, row, options)) as { id?: unknown } | null;
    const id = written?.id == null ? undefined : String(written.id);
    const covered = options?.transaction != null;
    const host = this.host;
    const object = this.object;
    const recordId = this.id;
    return {
      id,
      async compensate(): Promise<void> {
        if (covered) return;
        if (id === undefined) {
          host.logger.error('[recycle-bin] the delete failed and its entry cannot be removed: the driver returned no entry id', undefined, {
            object, id: recordId,
          });
          return;
        }
        try {
          await driver.delete(RECYCLE_BIN_OBJECT, id, options);
        } catch (error) {
          // The driver's fault, bound values stripped: it may quote the row.
          const redacted = redactBoundStatement(error);
          host.logger.error(
            '[recycle-bin] the delete failed and removing its entry failed too; the entry names a record that is still live',
            redacted instanceof Error ? redacted : undefined,
            { object, id: recordId, entry: id },
          );
        }
      },
    };
  }

  /**
   * Who deleted the rows, as the audit ledger credits a write: the subject the
   * delete was authorized as, else the human credited for a delete the system
   * authorized on their behalf (`attributedUserId`, a better-auth-originated
   * write). `undefined` for the system's own deletes. It is the person whose
   * entries `allowRestoreOwnDeleted` lets restore.
   */
  private deletedBy(): string | undefined {
    const context = this.context as { userId?: unknown; attributedUserId?: unknown } | undefined;
    for (const candidate of [context?.userId, context?.attributedUserId]) {
      if (typeof candidate === 'string' && candidate !== '') return candidate;
    }
    return undefined;
  }

  /**
   * The organization that owns the entry: the root row's own, read off its
   * tenant column, else the deleting context's. An entry belongs to the
   * organization whose record it holds, so the organization's delete removes
   * it (the bin's tenant column cascades) and its listing is that
   * organization's.
   */
  private organizationOf(values: Record<string, unknown>): string | undefined {
    const tenantField = resolveTenantFieldName(this.host._registry.getObject(this.object));
    const own = tenantField ? values[tenantField] : undefined;
    if (typeof own === 'string' && own !== '') return own;
    const fromContext = (this.context as { tenantId?: unknown } | undefined)?.tenantId;
    return typeof fromContext === 'string' && fromContext !== '' ? fromContext : undefined;
  }
}

/**
 * Open the capture for one by-id delete, before its cascade: `undefined` when
 * the delete does not enter the bin. Throws the retention refusal when the
 * host's resolver or `OS_RECYCLE_BIN_RETENTION_DAYS` holds a defect, before
 * the delete has written anything.
 */
export function openRecycleBinCapture(
  this: RecycleBinCaptureHost,
  object: string,
  id: string | number,
  context: ExecutionContext | undefined,
): RecycleBinCapture | undefined {
  if (!recycleBinTakesObject(object)) return undefined;
  // A child the cascade deletes is a row of its root's entry, never an entry.
  const inherited = this.cascadeDeleteSets.getStore();
  if (inherited && cascadeSetHas(inherited.members, object, id)) return undefined;
  if (!this._registry.getObject(RECYCLE_BIN_OBJECT)) {
    // A composition without `PlatformObjectsPlugin` has no bin, and claims
    // none: no restore door reads one. That is reduced functionality, not a
    // write that failed to land, so `info` (AGENTS.md, "Degradation log
    // levels"). Said once per engine, on its first delete that would have
    // entered the bin.
    if (!this.recycleBinNotices.has(MISSING_BIN_NOTICE)) {
      this.recycleBinNotices.add(MISSING_BIN_NOTICE);
      this.logger.info(`[recycle-bin] ${RECYCLE_BIN_OBJECT} is not registered, so deletes are not kept in a recycle bin`, {
        object,
      });
    }
    return undefined;
  }
  const days = resolveRecycleBinRetentionDays(this.recycleBinRetention);
  return new RecycleBinCapture(this, object, String(id), context, days);
}
