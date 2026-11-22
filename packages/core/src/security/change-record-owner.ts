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
 * ## Cascade (ruling point 4, phase 2)
 *
 * A relationship opts in on the CHILD's reference field, beside
 * `deleteBehavior`: `transferBehavior: 'cascade'` (`@objectstack/spec`'s
 * `FieldSchema`). {@link transferCascadeRelations} lists an object's declared
 * cascades whose child offers Change Owner itself
 * (`transferCascadeIneligibilityReason`: structurally eligible, not a
 * `controlled_by_parent` detail, its switch on) — the candidates the dialog
 * offers as ticks. A request names the ticked ones in `cascade`; one that names
 * anything else is refused as a whole, before any write, so an undeclared
 * relationship is never cascaded. A cascade takes a person target only.
 *
 * The semantics are the ruled default and the only one: for each record that
 * moved, the child rows that point at it AND are owned by its PREVIOUS owner
 * (read, as the caller, just before the move) go to the new owner. Each is an
 * ordinary by-id update under the caller's context, so it passes the caller's
 * own transfer verdict on the child object, and a row it does not pass is
 * reported with its id, code and sentence, never skipped. One call cascades at
 * most {@link USER_WORK_TRANSFER_ROW_CAP} rows; past that the outcome counts the
 * rows it left with the previous owner (`remaining`) instead of moving them. A
 * record whose previous owner was nobody (it sat in a queue) or was already the
 * new owner cascades nothing. Rows the caller cannot read are outside the
 * cascade, as they are outside the caller's list; a relationship whose rows the
 * caller's read refuses as a whole is reported as such (`readFailure`).
 */

import {
  referenceTargetOf,
  resolveUserActionTransfer,
  transferCascadeIneligibilityReason,
  transferIneligibilityReason,
} from '@objectstack/spec/data';
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
  /** Every registered object definition — read to find the cascades declared to an object. */
  getConfigs?(): Record<string, unknown>;
  /** A disabled package's object serves no data door, so it is no cascade's child. */
  readonly registry?: UserWorkEngine['registry'];
  /** Counts the rows a capped cascade left with the previous owner. */
  count?(object: string, query?: any): Promise<number>;
}

/** One relationship a Change Owner cascades along: the child object, and its reference field to the parent. */
export interface ChangeOwnerCascadeRelation {
  object: string;
  field: string;
}

/** A declared cascade the dialog may offer: the relationship, with the labels the child serves. */
export interface ChangeOwnerCascadeCandidate extends ChangeOwnerCascadeRelation {
  /** The child object's declared label, or its name. */
  label: string;
  /** The reference field's declared label, or its name. */
  fieldLabel: string;
}

/** One cascaded relationship's outcome: the #30205 per-pair shape, every refused row listed. */
export interface ChangeOwnerCascadeOutcome extends UserWorkTransferOutcome {
  /** Rows owned by the previous owner that the row cap left unmoved (the call moves at most the cap). */
  remaining: number;
  /** The caller's read of this relationship's rows was refused or failed for at least one record: those rows did not move. */
  readFailure?: { code: string; message: string };
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
  }): Promise<unknown>;
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
  /** One outcome per relationship the request named in `cascade`, in its order; absent when it named none. */
  cascade?: ChangeOwnerCascadeOutcome[];
}

/** What a bulk Change Owner answers: the #30205 per-object outcome, every failure listed. */
export interface ChangeOwnerReport extends UserWorkTransferOutcome {
  /** The new owner, or `null` when the records were moved to {@link queue}. */
  ownerId: string | null;
  /** The queue the moved records now sit in; absent for a person target. */
  queue?: string;
  /** Whether the new owner was sent a notification (at most one, for the whole call). */
  notified: boolean;
  /** One outcome per relationship the request named in `cascade`, in its order; absent when it named none. */
  cascade?: ChangeOwnerCascadeOutcome[];
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
 * service, a fault in it) is answered as `notified: false`. A queue target, or
 * a caller who took the records themselves, has nobody to tell.
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
    await messaging.emit({
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
    return true;
  } catch {
    return false;
  }
}

/** A declared label, or the name. */
function labelOf(def: AnyRec | undefined, name: string): string {
  return typeof def?.label === 'string' && def.label.length > 0 ? def.label : name;
}

/** The field definitions of an object, keyed by name, from either registered `fields` shape. */
function fieldEntries(def: AnyRec): Array<[string, AnyRec]> {
  const fields = def.fields;
  if (Array.isArray(fields)) {
    return fields
      .map((f) => asRecord(f))
      .filter((f): f is AnyRec => f !== undefined && typeof f.name === 'string')
      .map((f) => [f.name as string, f]);
  }
  const record = asRecord(fields);
  if (!record) return [];
  return Object.entries(record)
    .map(([name, f]): [string, AnyRec | undefined] => [name, asRecord(f)])
    .filter((e): e is [string, AnyRec] => e[1] !== undefined);
}

/** The object a reference field points at, or `undefined` (an unreadable carrier included). */
function targetOf(field: AnyRec): string | undefined {
  try {
    return referenceTargetOf(field);
  } catch {
    return undefined;
  }
}

/**
 * The cascades declared to `parent` (ruling point 4): every served object's
 * `lookup` / `master_detail` field that points at `parent` and declares
 * `transferBehavior: 'cascade'`, on a child that offers Change Owner itself
 * (`transferCascadeIneligibilityReason` answers nothing). The parse refuses the
 * declaration on any other child; this reads the registered definitions again,
 * because a definition can reach the registry without that parse. Objects of a
 * disabled package are left out, as the data door serves none of their rows.
 * In registration and declaration order.
 */
export function transferCascadeRelations(engine: Pick<ChangeOwnerEngine, 'getConfigs' | 'registry'>, parent: string): ChangeOwnerCascadeCandidate[] {
  const configs = typeof engine.getConfigs === 'function' ? engine.getConfigs() ?? {} : {};
  const disabled = engine.registry?.isObjectPackageDisabled?.bind(engine.registry);
  const out: ChangeOwnerCascadeCandidate[] = [];
  for (const candidate of Object.values(configs)) {
    const child = asRecord(candidate);
    const name = typeof child?.name === 'string' ? child.name : undefined;
    if (!child || !name) continue;
    if (disabled && disabled(name) === true) continue;
    const declared = fieldEntries(child).filter(([, f]) =>
      f.transferBehavior === 'cascade' && (f.type === 'lookup' || f.type === 'master_detail') && targetOf(f) === parent);
    if (declared.length === 0) continue;
    if (transferCascadeIneligibilityReason(child) !== undefined) continue;
    for (const [field, def] of declared) {
      out.push({ object: name, field, label: labelOf(child, name), fieldLabel: labelOf(def, field) });
    }
  }
  return out;
}

/**
 * The relationships a request names in `cascade`, judged before any write:
 * each must be one of {@link transferCascadeRelations}' answers for `object`,
 * named once, and a cascade needs a person target. Throws `400
 * VALIDATION_ERROR` naming the first offender; answers `[]` when none is named.
 */
function cascadeRelationsOf(
  engine: ChangeOwnerEngine,
  object: string,
  cascade: readonly ChangeOwnerCascadeRelation[] | undefined,
  target: ChangeOwnerTarget,
): ChangeOwnerCascadeRelation[] {
  if (!cascade || cascade.length === 0) return [];
  if (target.queue !== undefined) {
    throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR',
      'cascade hands related records to the new owner, and a queue target has none; leave cascade out when moving records to a queue');
  }
  const declared = new Set(transferCascadeRelations(engine, object).map((c) => `${c.object}.${c.field}`));
  const seen = new Set<string>();
  const out: ChangeOwnerCascadeRelation[] = [];
  for (const rel of cascade) {
    const key = `${rel.object}.${rel.field}`;
    if (!declared.has(key)) {
      throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR',
        `'${key}' is not a Change Owner cascade of '${object}': a relationship cascades only where the child's ` +
        `reference field to '${object}' declares transferBehavior: 'cascade' and the child offers Change Owner itself`);
    }
    if (seen.has(key)) {
      throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR', `cascade names '${key}' more than once; name each relationship once`);
    }
    seen.add(key);
    out.push({ object: rel.object, field: rel.field });
  }
  return out;
}

/**
 * Each record's owner as the caller reads it just before the move: the
 * cascade's "previous owner". A record the caller cannot read is absent, and
 * cascades nothing (its own move fails and is reported).
 */
async function previousOwners(
  engine: ChangeOwnerEngine,
  object: string,
  ids: readonly string[],
  context: unknown,
): Promise<Map<string, string | null>> {
  const rows = await engine.find(object, {
    where: ids.length === 1 ? { id: ids[0] } : { id: { $in: [...ids] } },
    fields: ['id', SystemFieldName.OWNER_ID],
    limit: ids.length,
    context,
  });
  const owners = new Map<string, string | null>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = asRecord(row);
    if (r?.id === undefined || r.id === null) continue;
    const owner = r[SystemFieldName.OWNER_ID];
    const ownerId = typeof owner === 'string' || typeof owner === 'number'
      ? String(owner)
      : (asRecord(owner)?.id != null ? String(asRecord(owner)!.id) : null);
    owners.set(String(r.id), ownerId && ownerId.length > 0 ? ownerId : null);
  }
  return owners;
}

/**
 * Move, for each moved record, the rows of each named relationship that point
 * at it and are owned by its previous owner, to `newOwner` — as the caller,
 * one by-id update each, at most `cap` rows in all. Every refused row is listed.
 */
async function runCascade(
  engine: ChangeOwnerEngine,
  relations: readonly ChangeOwnerCascadeRelation[],
  moved: ReadonlyArray<{ id: string; previousOwner: string | null | undefined }>,
  newOwner: string,
  context: unknown,
  cap: number,
  describe: UserWorkFailureDescriber | undefined,
): Promise<ChangeOwnerCascadeOutcome[]> {
  const outcomes: ChangeOwnerCascadeOutcome[] = relations.map((r) => ({
    object: r.object, field: r.field, updated: 0, failed: 0, failures: [], remaining: 0,
  }));
  let budget = cap;
  for (const { id: parentId, previousOwner } of moved) {
    if (!previousOwner || previousOwner === newOwner) continue;
    for (let i = 0; i < relations.length; i++) {
      const rel = relations[i]!;
      const outcome = outcomes[i]!;
      const where = { [rel.field]: parentId, [SystemFieldName.OWNER_ID]: previousOwner };
      let failedHere = 0;
      if (budget > 0) {
        let rows: unknown[];
        try {
          rows = await engine.find(rel.object, { where, fields: ['id'], limit: budget, context });
        } catch (err) {
          if (!outcome.readFailure) {
            const { code, message } = failureOf(parentId, err, rel.object, describe);
            outcome.readFailure = { code, message };
          }
          continue;
        }
        for (const row of Array.isArray(rows) ? rows : []) {
          const childId = asRecord(row)?.id;
          if (childId === undefined || childId === null) continue;
          budget -= 1;
          try {
            const written = await engine.update(rel.object, { [SystemFieldName.OWNER_ID]: newOwner }, { where: { id: childId }, context });
            if (written === null || written === undefined || written === 0) {
              throw recordNotFoundError(rel.object, String(childId), context as Parameters<typeof recordNotFoundError>[2]);
            }
            outcome.updated += 1;
          } catch (err) {
            outcome.failed += 1;
            failedHere += 1;
            outcome.failures.push(failureOf(childId, err, rel.object, describe));
          }
          if (budget === 0) break;
        }
      }
      // The cap is spent: count what this parent's relationship still holds
      // with the previous owner, past the rows that were tried and refused.
      if (budget === 0 && typeof engine.count === 'function') {
        try {
          const left = await engine.count(rel.object, { where, context });
          outcome.remaining += Math.max(0, left - failedHere);
        } catch {
          // Unknown: the rows moved and refused above are reported either way.
        }
      }
    }
  }
  return outcomes;
}

/**
 * Change the owner of one record, as the caller. Throws the write path's own
 * refusal for a row the caller may not move (the route answers it as the
 * `/data` door answers the same throw), `404 RECORD_NOT_FOUND` for a row the
 * caller cannot reach, and the whole-call refusals of
 * {@link changeRecordsOwner}.
 */
export async function changeRecordOwner(
  engine: ChangeOwnerEngine,
  object: string,
  id: string,
  target: ChangeOwnerTarget,
  context: unknown,
  options: {
    notify?: boolean;
    messaging?: ChangeOwnerMessaging;
    /** The declared relationships to cascade along (ruling point 4); refused as a whole when any is not declared. */
    cascade?: readonly ChangeOwnerCascadeRelation[];
    describeFailure?: UserWorkFailureDescriber;
    rowCap?: number;
  } = {},
): Promise<ChangeOwnerResult> {
  const def = offeredDefinition(engine, object, target);
  const relations = cascadeRelationsOf(engine, object, options.cascade, target);
  await assertTarget(engine, target, context);
  const before = relations.length > 0 ? await previousOwners(engine, object, [id], context) : undefined;
  const written = await engine.update(object, ownerChangeSet(target), { where: { id }, context });
  if (written === null || written === undefined || written === 0) {
    throw recordNotFoundError(object, id, context as Parameters<typeof recordNotFoundError>[2]);
  }
  const ownerId = target.ownerId ?? null;
  const cascade = before && ownerId !== null
    ? await runCascade(engine, relations, [{ id, previousOwner: before.get(id) }], ownerId, context,
      options.rowCap ?? USER_WORK_TRANSFER_ROW_CAP, options.describeFailure)
    : undefined;
  const notified = options.notify === true
    ? await notifyNewOwner(options.messaging, { object, label: objectLabel(object, def), ownerId, ids: [id], context })
    : false;
  return {
    object, id, ownerId, ...(target.queue !== undefined ? { queue: target.queue } : {}), notified,
    ...(cascade ? { cascade } : {}),
  };
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
  options: {
    notify?: boolean;
    messaging?: ChangeOwnerMessaging;
    describeFailure?: UserWorkFailureDescriber;
    rowCap?: number;
    /** The declared relationships to cascade along (ruling point 4); refused as a whole when any is not declared. */
    cascade?: readonly ChangeOwnerCascadeRelation[];
  } = {},
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
  const relations = cascadeRelationsOf(engine, object, options.cascade, target);
  await assertTarget(engine, target, context);
  const before = relations.length > 0 ? await previousOwners(engine, object, ids, context) : undefined;

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
      const written = await engine.update(object, { ...changeSet }, { where: { id }, context });
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
  if (before && report.ownerId !== null) {
    report.cascade = await runCascade(engine, relations, moved.map((id) => ({ id, previousOwner: before.get(id) })),
      report.ownerId, context, cap, options.describeFailure);
  }
  if (options.notify === true) {
    report.notified = await notifyNewOwner(options.messaging, {
      object, label: objectLabel(object, def), ownerId: report.ownerId, ids: moved, context,
    });
  }
  return report;
}
