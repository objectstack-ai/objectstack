/**
 * Change Owner in the Console (objectstack#35403): which records offer it, and
 * how its answers read.
 *
 * The direction and the scope are the maintainer's (#35315, rulings 7000556646
 * and 7000907189): a dedicated Change Owner action, not an editable owner
 * field; offered where three facts hold —
 *
 *  1. the object is structurally eligible (the platform injects its
 *     reassignable `owner_id`, and the object does not pin it `readonly`), and
 *  2. the object's switch `userActions.transfer` is on (default: on, off for a
 *     `controlled_by_parent` detail) — both answered by the spec's ONE
 *     resolution, `resolveUserActionTransfer` (`@objectstack/spec/data`), the
 *     same one the server's Change Owner endpoint refuses by; and
 *  3. the caller holds the transfer verdict: on a record, the explain engine's
 *     `transfer` operation for that record (`useRecordVerdict(..., 'transfer')`
 *     in `@object-ui/plugin-detail`, joined to the record page's one read).
 *
 * ⛔ No permission arithmetic here: the switch is the spec's, the record
 * verdict the server's, and every row of a bulk change is judged by the server
 * again, which reports each row it did not move.
 */

import * as React from 'react';
import { resolveUserActionTransfer, type UserActionTransferResolution } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';
import { partitionRowsByPredicate } from '@object-ui/core';
import { useRowPredicate } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { useRecordVerdict } from '@object-ui/plugin-detail';

/** The record's owner column, as the spec names it. */
export const CHANGE_OWNER_FIELD: typeof SystemFieldName.OWNER_ID = SystemFieldName.OWNER_ID;

/** [ADR-0142 D3] The ownership-queue column a queue target is written to. */
export const CHANGE_OWNER_QUEUE_FIELD: typeof SystemFieldName.QUEUE = SystemFieldName.QUEUE;

/** The slice of an object definition Change Owner reads. */
export interface ChangeOwnerObjectDef {
  name?: string;
  label?: unknown;
  fields?: Record<string, unknown> | unknown[];
  [key: string]: unknown;
}

/**
 * Facts 1 and 2: whether the object offers the action at all, and its
 * per-record predicates. An absent definition offers nothing.
 */
export function changeOwnerObjectOffer(objectDef: unknown): UserActionTransferResolution {
  if (!objectDef) return { enabled: false };
  return resolveUserActionTransfer(objectDef);
}

/** The field definition the object serves under `name`, from either `fields` shape. */
function servedField(objectDef: ChangeOwnerObjectDef | null | undefined, name: string): Record<string, unknown> | undefined {
  const fields = objectDef?.fields;
  if (Array.isArray(fields)) {
    const hit = fields.find((f) => (f as { name?: unknown } | null)?.name === name);
    return hit && typeof hit === 'object' ? (hit as Record<string, unknown>) : undefined;
  }
  if (!fields || typeof fields !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(fields, name)) return undefined;
  const def = (fields as Record<string, unknown>)[name];
  return def && typeof def === 'object' ? (def as Record<string, unknown>) : {};
}

/**
 * Whether a queue is offered as a target: only where the object carries the
 * ownership-queue column (ADR-0142 D3). The server refuses a queue target on
 * any other object.
 */
export function offersQueueTarget(objectDef: ChangeOwnerObjectDef | null | undefined): boolean {
  return servedField(objectDef, CHANGE_OWNER_QUEUE_FIELD) !== undefined;
}

/**
 * The object's own label for its owner field ("Assigned To", "Person", …), as
 * the object serves it, or `undefined` when it serves none (the caller then
 * asks its translation).
 */
export function declaredOwnerLabel(objectDef: ChangeOwnerObjectDef | null | undefined): string | undefined {
  const label = servedField(objectDef, CHANGE_OWNER_FIELD)?.label;
  return typeof label === 'string' && label.length > 0 ? label : undefined;
}

/** The person id a stored or expanded owner value names, or `undefined` for none. */
export function ownerIdOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (typeof value === 'number') return String(value);
  const id = (value as { id?: unknown; _id?: unknown } | null | undefined)?.id
    ?? (value as { _id?: unknown } | null | undefined)?._id;
  if (typeof id === 'string') return id || undefined;
  return typeof id === 'number' ? String(id) : undefined;
}

/** A record's id as the endpoint takes it, or `undefined` for a row without one. */
export function recordIdOf(row: unknown): string | undefined {
  const r = row as { id?: unknown; _id?: unknown } | null | undefined;
  const id = r?.id ?? r?._id;
  if (typeof id === 'string') return id || undefined;
  return typeof id === 'number' ? String(id) : undefined;
}

/** What the record page's header reads to draw Change Owner. */
export interface RecordChangeOwnerOffer {
  /** Draw the action: all three facts hold, the third as a definite allow. */
  offered: boolean;
  /** `userActions.transfer.disabledWhen` holds for this record: drawn, not pressable. */
  disabled: boolean;
  /** Whether the record's transfer verdict is worth asking at all (facts 1 and 2). */
  asks: boolean;
}

/**
 * The record page's Change Owner gate. The verdict is read three-state and
 * the action drawn only on a definite allow: an unanswered verdict, a refused
 * read, a deployment that explains nothing, all draw no action — Change Owner
 * exists only where the server says it applies, as the queue Claim beside it.
 * `visibleWhen` fails closed and `disabledWhen` fails soft, as on the CRUD
 * entries (`userActions.edit` / `.delete`) beside it.
 */
export function useRecordChangeOwnerOffer(
  objectDef: ChangeOwnerObjectDef | null | undefined,
  recordId: string | undefined,
  record: Record<string, unknown> | null | undefined,
): RecordChangeOwnerOffer {
  const resolution = React.useMemo(() => changeOwnerObjectOffer(objectDef), [objectDef]);
  const fields = objectDef?.fields as Record<string, unknown> | undefined;
  const visible = useRowPredicate(resolution.predicates?.visibleWhen ?? true, record ?? undefined, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:transfer:visibleWhen',
    fields: fields as never,
  });
  const disabledPred = useRowPredicate(resolution.predicates?.disabledWhen, record ?? undefined, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:transfer:disabledWhen',
    fields: fields as never,
  });
  const asks = resolution.enabled && !!objectDef?.name && !!recordId;
  const verdict = useRecordVerdict(objectDef?.name, recordId, 'transfer', asks);
  return {
    offered: asks && visible && verdict === true,
    disabled: resolution.predicates?.disabledWhen != null && disabledPred,
    asks,
  };
}

/**
 * A list's bulk Change Owner gate: facts 1 and 2, and the caller's
 * object-level transfer grant as `/me/permissions` reports it — the server's
 * own update rule for the owner field (edit and `allowTransfer`, or
 * `modifyAllRecords`; `checkField(…, 'write')` on `owner_id`, objectui#12103).
 * A list asks no record verdict: each selected row is judged by the endpoint,
 * which reports every row it did not move.
 */
export function useListChangeOwnerOffered(objectDef: ChangeOwnerObjectDef | null | undefined): boolean {
  const perms = usePermissions();
  const enabled = React.useMemo(() => changeOwnerObjectOffer(objectDef).enabled, [objectDef]);
  const name = objectDef?.name;
  return enabled && !!name && perms.checkField(name, CHANGE_OWNER_FIELD, 'write');
}

/**
 * The selected rows a bulk Change Owner acts on: those the switch's
 * `visibleWhen` admits, evaluated per record and failing closed — the same
 * fold the grid's bulk Delete runs over `userActions.delete.visibleWhen`. The
 * rest are counted, and the dialog says how many it left out.
 */
export function changeOwnerEligibleRows<TRow extends Record<string, unknown>>(
  objectDef: ChangeOwnerObjectDef | null | undefined,
  rows: readonly TRow[],
  scope: Record<string, unknown>,
): { eligible: TRow[]; skipped: number } {
  const visibleWhen = changeOwnerObjectOffer(objectDef).predicates?.visibleWhen;
  return partitionRowsByPredicate(visibleWhen as never, rows, {
    scope,
    fields: objectDef?.fields as never,
    label: 'transfer',
  });
}

/**
 * How a bulk answer reads (objectstack#35403, carried nit N1). The endpoint
 * admits a row whose owner already IS the person picked — an echo — and counts
 * it in `updated`. The dialog does not call such a row moved: its owner did
 * not change. So a row the endpoint did not report as failed reads
 * `unchanged` when the row, as the list read it, already named that person,
 * and `moved` otherwise. A queue target has no person to compare, so every
 * admitted row reads moved.
 */
export function readChangeOwnerReport(
  report: { updated: number; failed: number; failures: ReadonlyArray<{ id: string; code: string; message: string }> },
  rows: ReadonlyArray<Record<string, unknown>>,
  target: { ownerId?: string; queue?: string },
): { moved: number; unchanged: number; failed: number } {
  let unchanged = 0;
  if (target.ownerId !== undefined) {
    const failedIds = new Set(report.failures.map((f) => f.id));
    for (const row of rows) {
      const id = recordIdOf(row);
      if (id === undefined || failedIds.has(id)) continue;
      if (ownerIdOf(row[CHANGE_OWNER_FIELD]) === target.ownerId) unchanged += 1;
    }
  }
  unchanged = Math.min(unchanged, report.updated);
  return { moved: report.updated - unchanged, unchanged, failed: report.failed };
}
