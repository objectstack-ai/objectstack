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
 * {@link resolveReadableParentIds} (`@objectstack/core`): one
 * caller-scoped engine read per parent object, so the parent's own OWD/sharing,
 * RLS and object-level CRUD decide. This module only chooses WHICH rows are
 * judged that way and turns the answer into a WHERE.
 *
 * Mechanism: for one read, pre-scan the parent pairs the query would touch
 * under SYSTEM context (bounded, in the caller's own order), ask which of those
 * parent OBJECTS the caller may read at all (the security service's
 * object-level read admission — see "A skipped object is not an access
 * attempt" below), ask which of those parents the caller can read (one read
 * per admitted parent object, never one per row), and return one branch per
 * parent object for the gate to AND into `ctx.ast.where`:
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
 *    the object-level read admission refuses it, or that parent read refuses
 *    or throws;
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
 *
 * ## A skipped object is not an access attempt
 *
 * The streams name many parent objects — every platform object the CRUD
 * mirror writes — and a caller typically holds no object-level read on most of
 * them. Read as the caller, each such object is refused by plugin-security's
 * middleware, which logs every refusal at WARN: one line per object per read,
 * twice for a list (its rows and its `total`), on every page that shows the
 * activity feed. Those lines are not access attempts — the gate excluding
 * those rows is the expected answer — and they buried the real denials.
 *
 * So before any parent object is read as the caller, the gate asks the
 * security service's `canReadObject` (`ISecurityService`, `@objectstack/spec`)
 * — the middleware's own object-level read gate, arm for arm (its capability
 * AND-gate, its CRUD grant, its fail-closed posture and principal arms), which
 * answers without logging or throwing — and reads only the objects it admits.
 * An object it refuses contributes no readable id, exactly as its refused
 * engine read did, so the emitted WHERE and the rows served are unchanged; it
 * is just never read. ⛔ It is asked with the caller's own envelope (minus the
 * operation-private keys, as {@link resolveReadableParentIds} sends it): no
 * second derivation of authority, and no muting of the middleware's log — a
 * caller's own read of that object still logs its denial once.
 *
 * The admission only ever NARROWS what is read: an admitted object is still
 * read as the caller, and that read still decides row scope, sharing, RLS and
 * every gate the middleware runs after its object-level arms. Fails CLOSED:
 * an admission that throws, or answers anything but `true`, refuses that
 * object. With no security service composed, or one whose contract omits the
 * optional `canReadObject`, there is no admission to ask, and every parent
 * object is read as the caller: the engine's middleware still decides, so the
 * absence can leave the answer only as it is, never widen it.
 */

import { resolveReadableParentIds, withoutOperationPrivateKeys } from '@objectstack/core';
import type { ISecurityService, SecurityContext } from '@objectstack/spec/contracts';
import {
  type CommentAccessEngine,
  type CommentAccessLogger,
  type CommentReadMiddlewareCtx,
} from './comment-access-hooks.js';

/**
 * The single member of the security service's contract the gate consults: the
 * object-level read admission. OPTIONAL on the contract, so the gate handles
 * its absence by construction (see the module header).
 */
export type ParentObjectReadAdmission = Pick<ISecurityService, 'canReadObject'>;

/**
 * Resolves the security service on every read: the security plugin may
 * register after this one, and a resolver captured at install time would pin
 * "no service" for the life of the process.
 */
export type ParentObjectReadAdmissionSource = () => ParentObjectReadAdmission | null | undefined;

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

/**
 * The parent objects of `objects` the caller may read at all, by the security
 * service's object-level read admission — or `null` when none is composed (no
 * service, or one without the optional `canReadObject`), in which case every
 * object is left to the caller-scoped read. Asked once per object, before any
 * of them is read as the caller; see the module header.
 */
async function admittedParentObjects(
  objects: Iterable<string>,
  callerEnvelope: Record<string, unknown>,
  getAdmission: ParentObjectReadAdmissionSource,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
): Promise<Set<string> | null> {
  let admission: ParentObjectReadAdmission | null | undefined;
  try {
    admission = getAdmission();
  } catch {
    // `getService` throws on an empty slot: no security service is composed.
    admission = undefined;
  }
  const canReadObject = admission?.canReadObject;
  if (typeof canReadObject !== 'function') return null;

  const admitted = new Set<string>();
  for (const object of objects) {
    try {
      // `=== true`: an answer that is not a plain yes refuses (fail closed).
      if ((await canReadObject.call(admission, object, { ...callerEnvelope } as SecurityContext)) === true) {
        admitted.add(object);
      }
    } catch (err) {
      // The contract: a throw is a refusal. It is a fault, not a denial, so it
      // is said — and this object's rows are excluded, never read unjudged.
      logger.warn(
        `[audit] ${gate.seam}: the object-level read admission for '${object}' failed — its rows are ` +
          `excluded from this read (fail-closed) (${(err as Error)?.message ?? err})`,
      );
    }
  }
  return admitted;
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
 *
 * `getAdmission` resolves the security service whose object-level read
 * admission is asked before any parent object is read as the caller (module
 * header, "A skipped object is not an access attempt").
 */
export async function computeParentRecordFilter(
  engine: CommentAccessEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
  getAdmission: ParentObjectReadAdmissionSource,
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

  // 2. The one readability answer — one caller-scoped read per parent object
  //    the caller may read at all. An object the object-level admission
  //    refuses is not read: it contributes no readable id, as its refused read
  //    did, and it logs no denial for a skip the caller never asked for.
  const branches: Array<Record<string, unknown>> = [];
  if (byObject.size > 0) {
    const callerEnvelope = withoutOperationPrivateKeys((ctx.context ?? {}) as Record<string, unknown>);
    const admitted = await admittedParentObjects(byObject.keys(), callerEnvelope, getAdmission, logger, gate);
    const idSets = new Map<string, Set<string>>();
    for (const [object, ids] of byObject) {
      if (admitted && !admitted.has(object)) continue;
      idSets.set(object, new Set(ids.keys()));
    }
    const readable = idSets.size > 0 ? await resolveReadableParentIds(engine, ctx.context, idSets) : new Map<string, Set<string>>();

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
