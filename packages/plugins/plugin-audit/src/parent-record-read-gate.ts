// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The parent-record read gate: a row about a record is readable when that
 * record is readable. One mechanism for the two append-only streams in this
 * package that name their parent in the ADR-0052 §5 ActivityPointer pair
 * (`object_name`, `record_id`):
 *
 *  - the activity stream's gate (`activity-read-visibility.ts`);
 *  - the compliance ledger's gate (`audit-log-read-visibility.ts`).
 *
 * Both are written once, as the system, and read by many callers. Neither
 * object has an owner column, and the parent is a different object on every
 * row, so neither OWD/sharing nor RLS can narrow them.
 *
 * ⛔ Nothing here derives readability. "Can this caller read that record" is
 * {@link resolveReadableParentIds} (`comment-access-hooks.ts`): one
 * caller-scoped engine read per parent object, so the parent's own OWD/sharing,
 * RLS and object-level CRUD decide. This module only chooses WHICH rows are
 * judged that way and turns the answer into a WHERE.
 *
 * Mechanism: for one read, pre-scan the parent pairs the query would touch
 * under SYSTEM context (bounded, in the caller's own order), ask which of those
 * parents the caller can read (one read per parent object, never one per row),
 * and return one branch per parent object for the gate to AND into
 * `ctx.ast.where`:
 *
 *     { $or: [ { object_name: OBJECT, record_id: { $in: READABLE_IDS } }, ... ] }
 *
 * Fails CLOSED. A row that names no parent this module can authorize is
 * excluded:
 *  - no `object_name` or no `record_id`, or an `object_name` that is not a
 *    machine name;
 *  - a parent record that no longer exists: the parent read finds nothing, so
 *    there is nothing to judge readability on;
 *  - a parent object the caller cannot read, or that the engine does not know:
 *    that parent read refuses or throws;
 *  - a row naming the gated object itself: probing it would re-enter the gate.
 *
 * The one declared exception is a gate's {@link ParentRecordGate.outsideClass}:
 * rows that name NO record and that the gate states are not about one. Those
 * are kept by their stored id, so the branch can only match rows the pre-scan
 * saw. A gate that declares none (the activity stream) excludes them too.
 *
 * The one declared exemption is a gate's
 * {@link ParentRecordGate.exemptCapability}: a caller holding that capability
 * is not narrowed by the gate at all — no pre-scan, so no pre-scan bound, and
 * nothing ANDed in. Only this gate is skipped: the object's own grant, the other
 * read seams on it (a field redaction, a query guard) and every other gate
 * still apply. Held means the caller's resolved `systemPermissions`, the one
 * capability set the request's authorization resolver stamps on the execution
 * context and every other capability check reads. A gate that declares none
 * (the activity stream) exempts no caller.
 */

import {
  resolveReadableParentIds,
  type CommentAccessEngine,
  type CommentAccessLogger,
  type CommentReadMiddlewareCtx,
} from './comment-access-hooks.js';

/** The engine reads a parent-record read gate answers for. */
export const PARENT_GATE_READ_OPS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/** Bound on the per-read candidate pre-scan — the comment gate's bound. Beyond
 * it the filter fails CLOSED (the un-scanned rows are excluded, never leaked). */
export const PARENT_GATE_SCAN_LIMIT = 2_000;

const SYSTEM_CTX = { isSystem: true } as const;

/** Object machine-name shape (`ObjectSchema.name` in packages/spec). */
const OBJECT_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** The columns every gate pre-scans: the parent pair. */
const PARENT_COLUMNS = ['object_name', 'record_id'] as const;

/** The record a row is about. */
export interface ParentRecord {
  object: string;
  recordId: string;
}

/**
 * The rows of a gated object that name no record and are not about one, so
 * the record gate has nothing to judge them by.
 */
export interface OutsideClassRows {
  /** The columns {@link test} reads, beyond the parent pair. */
  fields: readonly string[];
  /** Called only for a row that names no parent record. */
  test(row: Record<string, unknown>): boolean;
}

/** What one gate is: its object, its log label, its sentinel and its class. */
export interface ParentRecordGate {
  /** The gated object. */
  object: string;
  /** Names the gate in its log lines. */
  seam: string;
  /** No real row matches it — the fail-closed answer. */
  denyAll: Readonly<Record<string, unknown>>;
  /** Absent: every row that names no parent record is excluded. */
  outsideClass?: OutsideClassRows;
  /**
   * A capability whose holder this gate does not narrow. Absent: no caller is
   * exempt. Must name a capability the platform declares and grants
   * deliberately; the ledger's is pinned against `PLATFORM_CAPABILITIES`.
   */
  exemptCapability?: string;
}

/**
 * Whether the caller holds `capability`: its resolved `systemPermissions`, as
 * the request's authorization resolver stamped them on the execution context.
 * Absent, or not a list, is not held.
 */
function callerHoldsCapability(context: CommentReadMiddlewareCtx['context'], capability: string): boolean {
  const held = context?.systemPermissions;
  return Array.isArray(held) && held.includes(capability);
}

/**
 * The parent OBJECT a row of `gatedObject` names, or `null` when it names none
 * a gate can authorize.
 */
export function parseParentObject(
  row: Record<string, unknown> | null | undefined,
  gatedObject: string,
): string | null {
  const object = row?.object_name;
  if (typeof object !== 'string' || !OBJECT_NAME_RE.test(object)) return null;
  if (object === gatedObject) return null;
  return object;
}

/**
 * The parent record a row of `gatedObject` names, or `null` when it names none
 * a gate can authorize — which every gate treats as DENY unless the row is
 * declared outside its class.
 */
export function parseParentRecord(
  row: Record<string, unknown> | null | undefined,
  gatedObject: string,
): ParentRecord | null {
  const object = parseParentObject(row, gatedObject);
  const recordId = row?.record_id;
  if (object === null) return null;
  if (typeof recordId !== 'string' && typeof recordId !== 'number') return null;
  if (String(recordId) === '') return null;
  return { object, recordId: String(recordId) };
}

/** AND `filter` into the read's WHERE, never replacing the caller's own. */
export function andIntoWhere(ctx: CommentReadMiddlewareCtx, filter: unknown): void {
  if (!ctx.ast) return;
  ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, filter] } : filter;
}

/**
 * The parent-visibility WHERE for one read of `gate.object`: `null` when the
 * caller holds the gate's exempt capability or the query matches no rows
 * (nothing to narrow), one `$in` branch per parent object holding the readable
 * ids (plus the outside-class rows' ids), or the gate's deny-all sentinel.
 */
export async function computeParentRecordFilter(
  engine: CommentAccessEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
): Promise<unknown | null> {
  // 0. The gate's declared exemption, decided before anything is scanned, so a
  //    holder's broad read never meets the pre-scan bound.
  if (gate.exemptCapability && callerHoldsCapability(ctx.context, gate.exemptCapability)) return null;

  // 1. The parent pairs the query would touch, read under SYSTEM context (the
  //    caller may not see the rows yet; that is what is being decided). The
  //    caller's own order rides along, so on a table larger than the scan
  //    bound the window scanned is the window the caller pages through.
  const orderBy = (ctx.ast as { orderBy?: unknown } | undefined)?.orderBy;
  const fields: string[] = [...PARENT_COLUMNS];
  if (gate.outsideClass) {
    for (const f of ['id', ...gate.outsideClass.fields]) if (!fields.includes(f)) fields.push(f);
  }
  const candidates = await engine.find(gate.object, {
    where: (ctx.ast?.where as Record<string, unknown>) ?? {},
    fields,
    ...(Array.isArray(orderBy) && orderBy.length > 0 ? { orderBy } : {}),
    limit: PARENT_GATE_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return null;
  if (candidates.length >= PARENT_GATE_SCAN_LIMIT) {
    // Not silent (fail-closed truncation): rows beyond the scan window are
    // excluded, so a very broad read may omit rows the caller could see. A
    // record timeline scopes by `object_name` + `record_id` and never hits it.
    logger.warn(
      `[audit] ${gate.seam}: candidate pre-scan hit the ${PARENT_GATE_SCAN_LIMIT}-row cap; ` +
        'the visibility filter for this broad read is fail-closed and may omit visible rows — ' +
        'scope the query by object_name and record_id',
    );
  }

  /** parent object → (record id as compared → the value as STORED). The stored
   * value is what the emitted filter carries, so it can only match rows the
   * pre-scan actually saw spelled that way. */
  const byObject = new Map<string, Map<string, unknown>>();
  /** Stored ids of the rows declared outside the gate's class. */
  const outside: unknown[] = [];
  for (const row of candidates) {
    const parent = parseParentRecord(row, gate.object);
    if (!parent) {
      const id = row.id;
      if (gate.outsideClass && (typeof id === 'string' || typeof id === 'number') && String(id) !== '' &&
        gate.outsideClass.test(row)) {
        outside.push(id);
      }
      continue;
    }
    let ids = byObject.get(parent.object);
    if (!ids) byObject.set(parent.object, (ids = new Map()));
    if (!ids.has(parent.recordId)) ids.set(parent.recordId, row.record_id);
  }
  if (byObject.size === 0 && outside.length === 0) return gate.denyAll;

  // 2. The one readability answer — one caller-scoped read per parent object.
  const branches: Array<Record<string, unknown>> = [];
  if (byObject.size > 0) {
    const idSets = new Map<string, Set<string>>();
    for (const [object, ids] of byObject) idSets.set(object, new Set(ids.keys()));
    const readable = await resolveReadableParentIds(engine, ctx.context, idSets);

    // 3. One branch per parent object that kept at least one readable record.
    for (const [object, ids] of byObject) {
      const visible = readable.get(object);
      if (!visible) continue;
      const kept: unknown[] = [];
      for (const [recordId, stored] of ids) if (visible.has(recordId)) kept.push(stored);
      if (kept.length) branches.push({ object_name: object, record_id: { $in: kept } });
    }
  }
  if (outside.length) branches.push({ id: { $in: outside } });
  if (branches.length === 0) return gate.denyAll;
  return branches.length === 1 ? branches[0] : { $or: branches };
}
