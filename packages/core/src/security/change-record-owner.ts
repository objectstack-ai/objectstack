// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35402] The Change Owner action's server half: hand one record, or a list
 * of records, to another owner — a person, or an ownership queue — as the
 * caller, on an object that offers the action.
 *
 * The direction is the maintainer's (#35315, rulings 7000556646 and
 * 7000907189): a dedicated Change Owner action, not a plain editable owner
 * field, offered where the object is structurally eligible, its switch is on,
 * and the caller holds the transfer verdict on the record.
 *
 * ## Which objects (ruling point 1, point 2)
 *
 * {@link changeOwnerOffRefusal} asks the spec's one resolution,
 * `resolveUserActionTransfer` (`@objectstack/spec/data`,
 * `user-action-transfer.ts`): structural eligibility first, which no switch can
 * widen, then `userActions.transfer`, then the default `sharingModel` implies
 * (off on a `controlled_by_parent` detail). An object that answers `enabled:
 * false` is refused as a whole, before any row is read or written, `403
 * CHANGE_OWNER_DISABLED` — whoever asks, a holder of `modifyAllRecords`
 * included (ruling point 3: that bit implies the transfer grant, and the
 * object switch is what keeps the action off objects whose owner means
 * nothing). The switch gates THIS action only: a plain `owner_id` update stays
 * governed by the transfer grant alone (ruling point 2), so imports and hooks
 * are unaffected. The switch's per-record predicates (`visibleWhen` /
 * `disabledWhen`) are the console's, as they are for the CRUD entries beside
 * it; this module reads the object-level answer.
 *
 * ## Whose writes (the permission)
 *
 * The CALLER's. Each record moves by one ordinary by-id `update` under the
 * caller's context, so the write path's ownership-anchor gate (plugin-security,
 * step 3.5 of the authz middleware) adjudicates it exactly as it adjudicates a
 * hand edit of `owner_id`: edit on the record and the transfer grant
 * (`allowTransfer`, or `modifyAllRecords`, #3004 semantics unchanged), a claim
 * of an unowned record the sharing model admits the caller to (ADR-0142 D4),
 * and a move to another queue only with the grant (ADR-0142 D3). That gate is
 * the verdict the explain engine's `transfer` operation reports for a record
 * (`explain-engine.ts`, held to the enforcement by its parity suites), so the
 * endpoint and the console's visibility read one rule, and no second
 * permission check is written here. Sharing, validation rules and hooks apply
 * to each row as they would to a hand edit, and the sharing service recomputes
 * on the write as on any other owner change.
 *
 * ## The target
 *
 * Exactly one of a person (`ownerId`) or an ownership queue (`queue`,
 * ADR-0142). A person must exist and not be banned
 * ({@link assertAssignableUser}, the hand-over's own check), refused once
 * before any write. A queue is written as ADR-0142 D3 spells "sits in Q":
 * `queue = Q` and `owner_id` empty, on an object that carries the queue
 * column; whether Q resolves in the row's organization is the write gate's
 * question, answered per row.
 *
 * ## Bulk (ruling, Bulk)
 *
 * Per-row by-id updates under the caller's context, every failure reported
 * with its row's id — never skipped, never sampled — in the #30205 report's
 * shape ({@link ChangeOwnerReport} extends `UserWorkTransferOutcome`). One
 * call takes at most {@link USER_WORK_TRANSFER_ROW_CAP} ids, the hand-over's
 * own row cap; a longer list is refused, not truncated. A predicate update
 * carrying `owner_id` is never issued: it has no pre-image and the owner guard
 * refuses it.
 *
 * Cascade to related records is phase 2 (a separate card), not here.
 */

import { resolveUserActionTransfer, transferIneligibilityReason } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';
import { objectNotFoundError } from '../utils/object-not-found.js';
import { recordNotFoundError } from '../utils/record-not-found.js';
import {
  assertAssignableUser,
  failureOf,
  USER_WORK_TRANSFER_ROW_CAP,
  UserWorkTransferRefusal,
  type UserWorkEngine,
  type UserWorkFailureDescriber,
  type UserWorkTransferOutcome,
} from './user-assigned-work.js';

/** The code an object that does not offer Change Owner is refused with (403). */
export const CHANGE_OWNER_DISABLED = 'CHANGE_OWNER_DISABLED';

/** [ADR-0142 D3] The ownership-queue column a queue target is written to. */
const QUEUE_FIELD = 'queue';

/**
 * The write options every owner change passes besides its address and context.
 *
 * The answer is what was saved, not what was asked. A `readonlyWhen` lock on
 * `owner_id` or `queue` that holds for the row makes the engine strip that
 * key; without `strictReadonlyWrites` the write would commit without it and
 * this module would still answer "moved", and tell the new owner, for a record
 * that never moved. Under the flag the strip is refused before anything is
 * written, and {@link writeOwner} answers that refusal as the row's own: `403
 * FIELD_NOT_ACCESSIBLE`, naming the locked column. The single form throws it,
 * the bulk form lists the row under `failures` with that code, and no
 * notification names it. A queue target writes both keys, so a lock on either
 * refuses the whole row rather than half-moving it.
 */
const OWNER_WRITE_OPTIONS = { strictReadonlyWrites: true } as const;

/**
 * The row's refusal for an owner write the engine refused under
 * `strictReadonlyWrites`, or `undefined` for any other throw. The engine's own
 * sentence speaks to a developer about write options; the person changing the
 * owner reads which column is locked and that nothing changed. `403
 * FIELD_NOT_ACCESSIBLE`, as the record-file door answers the same refusal.
 */
function lockedOwnerRefusal(err: unknown, object: string, id: string): Error | undefined {
  const e = err as { code?: unknown; fields?: unknown } | null;
  // The engine's code for a write `strictReadonlyWrites` refused (`@objectstack/objectql`'s, read here, never stamped).
  if (!e || e.code !== 'ERR_READONLY_FIELD_REJECTED') return undefined;
  const fields = Array.isArray(e.fields) && e.fields.length > 0 ? e.fields.map(String) : [SystemFieldName.OWNER_ID];
  const named = fields.map((f) => `${object}.${f}`).join(', ');
  const refusal = new Error(
    `The owner of ${object} record ${id} was not changed: ${named} ${fields.length === 1 ? 'is' : 'are'} read-only ` +
    'on this record in its current state, so nothing was written',
  ) as Error & { code?: string; status?: number; fields?: string[] };
  refusal.code = 'FIELD_NOT_ACCESSIBLE';
  refusal.status = 403;
  refusal.fields = fields;
  return refusal;
}

/**
 * One record's owner write: a by-id update under the caller's context with
 * {@link OWNER_WRITE_OPTIONS}, a locked owner or queue answered as
 * {@link lockedOwnerRefusal}. Answers what the engine answers.
 */
async function writeOwner(engine: ChangeOwnerEngine, object: string, id: string, changeSet: AnyRec, context: unknown): Promise<unknown> {
  try {
    return await engine.update(object, changeSet, { where: { id }, context, ...OWNER_WRITE_OPTIONS });
  } catch (err) {
    throw lockedOwnerRefusal(err, object, id) ?? err;
  }
}

/** The notification topic a notified new owner receives. */
export const CHANGE_OWNER_NOTIFICATION_TOPIC = 'record.owner_changed';

/**
 * The new owner's notification title, as catalog ids of the `messages` face and
 * their English text. The notice rides `keyedText`, so the messaging service
 * renders it per recipient, in the new owner's own language, at delivery; the
 * English is the literal it delivers whenever a key cannot be rendered.
 *
 * The entries in every shipped locale live in `@objectstack/service-messaging`'s
 * bundle (`translations/messages.ts`), beside the topic in its platform topic
 * list: this package loads no bundle of its own. That bundle's `en` entries ARE
 * these strings, so the two cannot drift.
 *
 * Holes: `{{object}}`, the object's label (itself rendered in the recipient's
 * language from `objects.<object>.label`, else the declared label), and, for a
 * bulk move of two or more, `{{count}}`.
 */
export const CHANGE_OWNER_NOTIFICATION_TEXT = {
  recordOwnerChangedTitle: 'You are now the owner of this {{object}} record',
  recordsOwnerChangedTitle: 'You are now the owner of {{count}} {{object}} records',
} as const;

/** `{{name}}` holes filled in English, for the literal a recipient reads when no key renders. */
function fillEnglish(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (hole, name: string) => params[name] ?? hole);
}

/** Who takes the records: a person, or an ownership queue. Exactly one. */
export type ChangeOwnerTarget = { ownerId: string; queue?: undefined } | { queue: string; ownerId?: undefined };

/**
 * The slice of the data engine this module reads and writes through — the
 * engine's own public methods, so every write takes the ordinary path.
 */
export interface ChangeOwnerEngine extends Pick<UserWorkEngine, 'find' | 'update'> {
  /** The registered object definition, `undefined` when no object has the name. */
  getSchema(object: string): unknown;
}

/** The `messaging` service member a notification is sent through, declared structurally. */
export interface ChangeOwnerMessaging {
  emit(input: {
    topic: string;
    audience: string[];
    severity?: 'info';
    source?: { object: string; id: string };
    actorId?: string;
    organizationId?: string;
    payload?: Record<string, unknown>;
    /** The title as catalog keys, rendered per recipient at delivery (`EmitInput.keyedText`). */
    keyedText?: {
      titleKey: string;
      params: Record<string, string | { key: string; fallback: string }>;
    };
  }): Promise<ChangeOwnerEmitResult>;
}

/**
 * The part of the messaging service's `EmitResult` this module reads: how many
 * deliveries a channel accepted inline, and how many rows the outbox took.
 */
export interface ChangeOwnerEmitResult {
  readonly delivered: number;
  readonly enqueued: number;
}

/** Whether an emit's answer reports a delivered or an enqueued row. */
function emitReachedSomeone(result: ChangeOwnerEmitResult | null | undefined): boolean {
  const delivered = result?.delivered;
  const enqueued = result?.enqueued;
  return (typeof delivered === 'number' && delivered > 0) || (typeof enqueued === 'number' && enqueued > 0);
}

/** What one record's Change Owner answers. */
export interface ChangeOwnerResult {
  object: string;
  id: string;
  /** The new owner, or `null` when the record now sits in {@link queue}. */
  ownerId: string | null;
  /** The queue the record now sits in; absent for a person target. */
  queue?: string;
  /** Whether the new owner was sent a notification. */
  notified: boolean;
}

/** What a bulk Change Owner answers: the #30205 per-object outcome, every failure listed. */
export interface ChangeOwnerReport extends UserWorkTransferOutcome {
  /** The new owner, or `null` when the records were moved to {@link queue}. */
  ownerId: string | null;
  /** The queue the moved records now sit in; absent for a person target. */
  queue?: string;
  /** Whether the new owner was sent a notification (at most one, for the whole call). */
  notified: boolean;
}

type AnyRec = Record<string, unknown>;

function asRecord(value: unknown): AnyRec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRec) : undefined;
}

/**
 * Why `def` does not offer the Change Owner action, as one sentence naming
 * the object — or `undefined` when it does. The structural clause comes from
 * `transferIneligibilityReason`; a switched-off object names whether its
 * author closed it or the `controlled_by_parent` default did.
 */
export function changeOwnerOffReason(object: string, def: unknown): string | undefined {
  if (resolveUserActionTransfer(def).enabled) return undefined;
  const ineligible = transferIneligibilityReason(def);
  if (ineligible) return `'${object}' does not offer Change Owner: ${ineligible}`;
  const authored = asRecord(asRecord(def)?.userActions)?.transfer;
  if (authored !== undefined && authored !== null) {
    return `'${object}' turns Change Owner off (userActions.transfer)`;
  }
  return `'${object}' is a controlled_by_parent detail, whose access follows its master, so Change Owner is off ` +
    'on it unless the object sets userActions.transfer to true';
}

/** The refusal of a whole Change Owner call on an object that does not offer the action. */
export function changeOwnerOffRefusal(object: string, reason: string): Error {
  const err = new Error(reason) as Error & { code?: string; status?: number; object?: string };
  err.code = CHANGE_OWNER_DISABLED;
  err.status = 403;
  err.object = object;
  return err;
}

/**
 * The object's definition, when it offers Change Owner and can take the
 * target; throws otherwise, before anything is read or written: `404
 * OBJECT_NOT_FOUND`, `403 CHANGE_OWNER_DISABLED`, or `400 VALIDATION_ERROR`
 * for a queue target on an object with no queue column.
 */
function offeredDefinition(engine: ChangeOwnerEngine, object: string, target: ChangeOwnerTarget): AnyRec {
  const def = asRecord(engine.getSchema(object));
  if (!def) throw objectNotFoundError(object);
  const reason = changeOwnerOffReason(object, def);
  if (reason) throw changeOwnerOffRefusal(object, reason);
  if (target.queue !== undefined) {
    const fields = asRecord(def.fields);
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, QUEUE_FIELD)) {
      throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR',
        `'${object}' has no ownership queue column, so its records cannot be moved to a queue; name a person in ownerId instead`);
    }
  }
  return def;
}

/** The change-set one record's owner change writes. */
function ownerChangeSet(target: ChangeOwnerTarget): AnyRec {
  return target.queue !== undefined
    ? { [SystemFieldName.OWNER_ID]: null, [QUEUE_FIELD]: target.queue }
    : { [SystemFieldName.OWNER_ID]: target.ownerId };
}

/** Refuse a person target that names no user or a banned one, once, before any write. */
async function assertTarget(engine: ChangeOwnerEngine, target: ChangeOwnerTarget, context: unknown): Promise<void> {
  if (target.ownerId !== undefined) await assertAssignableUser(engine, target.ownerId, context, 'ownerId');
}

function objectLabel(object: string, def: AnyRec): string {
  return typeof def.label === 'string' && def.label.length > 0 ? def.label : object;
}

/**
 * Tell the new owner, when asked to. Never fails the call: the records have
 * moved, and a notification the deployment cannot send (no `messaging`
 * service, a fault in it) is answered as `notified: false`, as is one the
 * service took but sent nowhere (a muted topic, an unavailable channel: zero
 * delivered and zero enqueued). A queue target, or a caller who took the
 * records themselves, has nobody to tell.
 */
async function notifyNewOwner(
  messaging: ChangeOwnerMessaging | undefined,
  input: { object: string; label: string; ownerId: string | null; ids: string[]; context: unknown },
): Promise<boolean> {
  const { object, label, ownerId, ids, context } = input;
  if (!messaging || typeof messaging.emit !== 'function' || ownerId === null || ids.length === 0) return false;
  const ctx = asRecord(context);
  const actorId = ctx?.userId != null ? String(ctx.userId) : undefined;
  if (actorId === ownerId) return false;
  const organizationId = ctx?.tenantId != null ? String(ctx.tenantId) : undefined;
  const single = ids.length === 1;
  const messageId: keyof typeof CHANGE_OWNER_NOTIFICATION_TEXT = single ? 'recordOwnerChangedTitle' : 'recordsOwnerChangedTitle';
  const count = String(ids.length);
  try {
    const result = await messaging.emit({
      topic: CHANGE_OWNER_NOTIFICATION_TOPIC,
      audience: [ownerId],
      severity: 'info',
      ...(single ? { source: { object, id: ids[0]! } } : {}),
      ...(actorId ? { actorId } : {}),
      ...(organizationId ? { organizationId } : {}),
      payload: {
        title: fillEnglish(CHANGE_OWNER_NOTIFICATION_TEXT[messageId], { object: label, count }),
        object,
        recordIds: ids,
      },
      keyedText: {
        titleKey: `messages.${messageId}`,
        params: {
          object: { key: `objects.${object}.label`, fallback: label },
          ...(single ? {} : { count }),
        },
      },
    });
    return emitReachedSomeone(result);
  } catch {
    return false;
  }
}

/**
 * Change the owner of one record, as the caller. Throws the write path's own
 * refusal for a row the caller may not move (the route answers it as the
 * `/data` door answers the same throw), `403 FIELD_NOT_ACCESSIBLE` when a
 * `readonlyWhen` lock holds `owner_id` or `queue` on the row, `404
 * RECORD_NOT_FOUND` for a row the caller cannot reach, and the whole-call
 * refusals of {@link changeRecordsOwner}.
 */
export async function changeRecordOwner(
  engine: ChangeOwnerEngine,
  object: string,
  id: string,
  target: ChangeOwnerTarget,
  context: unknown,
  options: { notify?: boolean; messaging?: ChangeOwnerMessaging } = {},
): Promise<ChangeOwnerResult> {
  const def = offeredDefinition(engine, object, target);
  await assertTarget(engine, target, context);
  const written = await writeOwner(engine, object, id, ownerChangeSet(target), context);
  if (written === null || written === undefined || written === 0) {
    throw recordNotFoundError(object, id, context as Parameters<typeof recordNotFoundError>[2]);
  }
  const ownerId = target.ownerId ?? null;
  const notified = options.notify === true
    ? await notifyNewOwner(options.messaging, { object, label: objectLabel(object, def), ownerId, ids: [id], context })
    : false;
  return { object, id, ownerId, ...(target.queue !== undefined ? { queue: target.queue } : {}), notified };
}

/**
 * Change the owner of up to {@link USER_WORK_TRANSFER_ROW_CAP} records, as
 * the caller, one by-id update each, and report every row that did not move.
 *
 * Refuses the whole call before any write: an empty list, a list longer than
 * the cap, a repeated id (`400 VALIDATION_ERROR`), an object that does not
 * offer the action (`403 CHANGE_OWNER_DISABLED`), and a target the single form
 * refuses.
 */
export async function changeRecordsOwner(
  engine: ChangeOwnerEngine,
  object: string,
  ids: readonly string[],
  target: ChangeOwnerTarget,
  context: unknown,
  options: { notify?: boolean; messaging?: ChangeOwnerMessaging; describeFailure?: UserWorkFailureDescriber; rowCap?: number } = {},
): Promise<ChangeOwnerReport> {
  const cap = options.rowCap ?? USER_WORK_TRANSFER_ROW_CAP;
  if (ids.length === 0) {
    throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR', 'ids must list at least one record id');
  }
  if (ids.length > cap) {
    throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR',
      `ids lists ${ids.length} records; one Change Owner call takes at most ${cap}. Send the rest in further calls`);
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR', `ids lists "${id}" more than once; name each record once`);
    }
    seen.add(id);
  }
  const def = offeredDefinition(engine, object, target);
  await assertTarget(engine, target, context);

  const changeSet = ownerChangeSet(target);
  const report: ChangeOwnerReport = {
    object,
    field: SystemFieldName.OWNER_ID,
    ownerId: target.ownerId ?? null,
    ...(target.queue !== undefined ? { queue: target.queue } : {}),
    updated: 0,
    failed: 0,
    failures: [],
    notified: false,
  };
  const moved: string[] = [];
  for (const id of ids) {
    try {
      const written = await writeOwner(engine, object, id, { ...changeSet }, context);
      if (written === null || written === undefined || written === 0) {
        throw recordNotFoundError(object, id, context as Parameters<typeof recordNotFoundError>[2]);
      }
      report.updated += 1;
      moved.push(id);
    } catch (err) {
      report.failed += 1;
      report.failures.push(failureOf(id, err, object, options.describeFailure));
    }
  }
  if (options.notify === true) {
    report.notified = await notifyNewOwner(options.messaging, {
      object, label: objectLabel(object, def), ownerId: report.ownerId, ids: moved, context,
    });
  }
  return report;
}
