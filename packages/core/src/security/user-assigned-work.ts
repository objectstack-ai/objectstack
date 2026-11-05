// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30205] A banned user's open work: how much of it there is, and one
 * optional bulk hand-over to someone else.
 *
 * Banning a user signs them out and keeps them out, but the records they own
 * and the records assigned to them stay where they were, and nobody is told.
 * This module answers the two questions an administrator has at that moment —
 * "how many records does this person hold?" and "hand them to someone" — and
 * the predicate the write path uses to stop new work landing on a banned user.
 *
 * ## Which records count
 *
 * Every business object's user reference: a field whose target is
 * {@link USER_OBJECT} (a `user` field, or a `lookup` to it). That includes the
 * platform's `owner_id`, which is itself a lookup to the user object, and the
 * app's own fields such as an `assignee`. Left out, on purpose:
 *
 * - `readonly` and `system` fields: `created_by` / `updated_by` record who did
 *   something, not who holds the work, and moving them would rewrite history.
 * - platform tables (`sys_*`) and `managedBy` objects: `sys_user_permission_set.user_id`
 *   is a grant, not work, and moving it would move the person's permissions.
 * - a column the platform registers but provisions no storage for (an injected
 *   anchor on a federated object, `unprovisionedInjectedColumns`).
 *
 * A multi-valued user field is counted (any member names the user) but never
 * transferred: replacing one member of a list is a different edit from
 * reassigning a record, and the answer says `transferable: false`.
 *
 * ## Whose reads and writes
 *
 * The CALLER's. Every count and every row read runs under the caller's own
 * context, so RBAC, row-level security and sharing decide what is counted —
 * "across the objects the administrator can read" — and an object the caller
 * cannot read is named in `unreadable` instead of being reported as zero.
 * Every transfer write is an ordinary `update` under the same context, so
 * sharing, validation rules and hooks apply to each row as they would to a
 * hand edit, and a row the caller may not change is reported as a failure.
 * Nothing here elevates except reading the TARGET user's ban state, which is
 * a fact about the user and not about the caller's visibility (see
 * {@link isUserBanInForce}).
 *
 * ## Bounded, repeatable, never in the ban's way
 *
 * At most {@link USER_ASSIGNED_WORK_FIELD_CAP} (object, field) pairs are
 * counted, and the answer says `truncated` past that. One transfer call moves
 * at most {@link USER_WORK_TRANSFER_ROW_CAP} rows and answers how many still
 * name the user (`remaining`), so a caller repeats it until that is zero. The
 * ban itself neither waits for nor depends on any of this: a ban can be urgent.
 */

import { referenceTargetOf, unprovisionedInjectedColumns } from '@objectstack/spec/data';

/** The platform user object every user reference targets. */
const USER_OBJECT = 'sys_user';

/** At most this many (object, field) pairs are counted in one answer. */
export const USER_ASSIGNED_WORK_FIELD_CAP = 200;

/** At most this many rows are moved by one transfer call. */
export const USER_WORK_TRANSFER_ROW_CAP = 500;

/** At most this many failed rows are described per (object, field) pair. */
export const USER_WORK_FAILURE_SAMPLE = 10;

/**
 * Is this user row's ban in force?
 *
 * `banned` is `true` and the ban has no expiry, or one still in the future.
 * better-auth leaves `banned` true past `ban_expires` until the user's next
 * sign-in clears it, and such a user CAN sign in again, so an expired ban is
 * not in force. A row that is not an object, or has no `banned: true`, is not
 * banned.
 */
export function isUserBanInForce(row: unknown, now: number = Date.now()): boolean {
  if (!row || typeof row !== 'object') return false;
  const { banned, ban_expires: expires } = row as { banned?: unknown; ban_expires?: unknown };
  if (banned !== true) return false;
  if (expires === null || expires === undefined || expires === '') return true;
  const at = expires instanceof Date ? expires.getTime() : new Date(expires as string | number).getTime();
  // An expiry that does not parse cannot prove the ban lifted.
  if (Number.isNaN(at)) return true;
  return at > now;
}

/** One user reference a record can hold work through. */
export interface UserAssignedWorkField {
  object: string;
  field: string;
  /** A multi-valued user field: counted, never transferred. */
  multiple: boolean;
}

interface ObjectLike {
  name?: unknown;
  managedBy?: unknown;
  fields?: unknown;
}

/**
 * The user references the records of `objects` hold work through, in
 * declaration order, and whether the cap cut the list short.
 */
export function userAssignedWorkFields(
  objects: Iterable<unknown>,
  cap: number = USER_ASSIGNED_WORK_FIELD_CAP,
): { fields: UserAssignedWorkField[]; truncated: boolean } {
  const fields: UserAssignedWorkField[] = [];
  for (const candidate of objects) {
    const obj = candidate as ObjectLike;
    const name = typeof obj?.name === 'string' ? obj.name : undefined;
    if (!name || name.startsWith('sys_')) continue;
    if (obj.managedBy !== undefined && obj.managedBy !== null) continue;
    if (!obj.fields || typeof obj.fields !== 'object') continue;
    const phantom = new Set(unprovisionedInjectedColumns(obj as any));
    for (const [field, def] of Object.entries(obj.fields as Record<string, unknown>)) {
      if (phantom.has(field)) continue;
      if (referenceTargetOf(def) !== USER_OBJECT) continue;
      const d = def as { readonly?: unknown; system?: unknown; multiple?: unknown };
      if (d.readonly === true || d.system === true) continue;
      if (fields.length >= cap) return { fields, truncated: true };
      fields.push({ object: name, field, multiple: d.multiple === true });
    }
  }
  return { fields, truncated: false };
}

/**
 * The slice of the data engine this module reads and writes through — the
 * engine's own public methods, so every call takes the ordinary path.
 */
export interface UserWorkEngine {
  getConfigs(): Record<string, unknown>;
  count(object: string, query?: any): Promise<number>;
  find(object: string, query?: any): Promise<any[]>;
  update(object: string, data: any, options?: any): Promise<unknown>;
}

/** The filter that matches the records a field holds `userId` in. */
function holdsUser(ref: UserAssignedWorkField, userId: string): Record<string, unknown> {
  return { [ref.field]: ref.multiple ? { $contains: userId } : userId };
}

/** One (object, field) pair's count. */
export interface UserAssignedWorkCount {
  object: string;
  field: string;
  count: number;
  transferable: boolean;
}

/** What {@link countUserAssignedWork} answers. */
export interface UserAssignedWorkSummary {
  userId: string;
  /** Every pair with at least one record, in declaration order. */
  objects: UserAssignedWorkCount[];
  /** The sum of `objects[].count`: record-field holdings, not distinct records. */
  total: number;
  /** More pairs exist than were counted. */
  truncated: boolean;
  /** Objects whose count the caller's read refused or could not run. */
  unreadable: string[];
}

/** Per-pair counts of the records that hold `userId`, read as the caller. */
export async function countUserAssignedWork(
  engine: UserWorkEngine,
  userId: string,
  context: unknown,
): Promise<UserAssignedWorkSummary> {
  const { fields, truncated } = userAssignedWorkFields(Object.values(engine.getConfigs() ?? {}));
  const objects: UserAssignedWorkCount[] = [];
  const unreadable = new Set<string>();
  let total = 0;
  for (const ref of fields) {
    if (unreadable.has(ref.object)) continue;
    let count: number;
    try {
      count = await engine.count(ref.object, { where: holdsUser(ref, userId), context });
    } catch {
      unreadable.add(ref.object);
      continue;
    }
    if (!(count > 0)) continue;
    objects.push({ object: ref.object, field: ref.field, count, transferable: !ref.multiple });
    total += count;
  }
  return { userId, objects, total, truncated, unreadable: [...unreadable] };
}

/** A refusal of the transfer as a whole, before any row moves. */
export class UserWorkTransferRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: 'VALIDATION_ERROR' | 'RESOURCE_NOT_FOUND',
    message: string,
    readonly field?: { field: string; code: 'reference_not_found' | 'reference_user_banned' },
  ) {
    super(message);
    this.name = 'UserWorkTransferRefusal';
  }
}

/** One row a transfer could not move. */
export interface UserWorkTransferFailure {
  id: string;
  code: string;
  message: string;
}

/** One (object, field) pair's transfer outcome. */
export interface UserWorkTransferOutcome {
  object: string;
  field: string;
  updated: number;
  failed: number;
  /** The first {@link USER_WORK_FAILURE_SAMPLE} failures. */
  failures: UserWorkTransferFailure[];
}

/** What {@link transferUserAssignedWork} answers. */
export interface UserWorkTransferReport {
  fromUserId: string;
  toUserId: string;
  objects: UserWorkTransferOutcome[];
  updated: number;
  failed: number;
  /** Records the caller can read that still hold the user in a transferable field. */
  remaining: number;
}

function failureOf(id: unknown, err: unknown): UserWorkTransferFailure {
  const e = err as { code?: unknown; message?: unknown } | null;
  return {
    id: String(id),
    code: typeof e?.code === 'string' && e.code.length > 0 ? e.code : 'UPDATE_FAILED',
    message: String(e?.message ?? err).slice(0, 500),
  };
}

/**
 * Move up to {@link USER_WORK_TRANSFER_ROW_CAP} records from `fromUserId` to
 * `toUserId`, field by field, each as an ordinary update under the caller's
 * context. `objects`, when given, limits the transfer to those object names.
 *
 * Refuses before any write when the target is the source, names no user, or
 * names a user whose ban is in force ({@link UserWorkTransferRefusal}).
 */
export async function transferUserAssignedWork(
  engine: UserWorkEngine,
  fromUserId: string,
  toUserId: string,
  context: unknown,
  options: { objects?: readonly string[]; rowCap?: number } = {},
): Promise<UserWorkTransferReport> {
  if (fromUserId === toUserId) {
    throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR', 'toUserId must name a different user than the one whose work is transferred');
  }
  // The target's existence and ban state are facts about the user, read the
  // way the write path's reference check reads them: past the caller's row
  // visibility, inside the caller's tenant.
  const elevated = { ...((context as object | undefined) ?? {}), isSystem: true };
  const [target] = await engine.find(USER_OBJECT, {
    where: { id: toUserId },
    fields: ['id', 'banned', 'ban_expires'],
    limit: 1,
    context: elevated,
  });
  if (!target) {
    throw new UserWorkTransferRefusal(404, 'RESOURCE_NOT_FOUND', `No user has id "${toUserId}"`, { field: 'toUserId', code: 'reference_not_found' });
  }
  if (isUserBanInForce(target)) {
    throw new UserWorkTransferRefusal(400, 'VALIDATION_ERROR', `User "${toUserId}" is banned and cannot be assigned new records; pick an active user`, { field: 'toUserId', code: 'reference_user_banned' });
  }

  const only = options.objects && options.objects.length > 0 ? new Set(options.objects) : undefined;
  const { fields } = userAssignedWorkFields(Object.values(engine.getConfigs() ?? {}));
  const refs = fields.filter((ref) => !ref.multiple && (!only || only.has(ref.object)));
  let budget = options.rowCap ?? USER_WORK_TRANSFER_ROW_CAP;
  const objects: UserWorkTransferOutcome[] = [];
  let updated = 0;
  let failed = 0;
  let remaining = 0;
  for (const ref of refs) {
    let rows: any[] = [];
    if (budget > 0) {
      try {
        rows = await engine.find(ref.object, { where: holdsUser(ref, fromUserId), fields: ['id'], limit: budget, context });
      } catch {
        // An object the caller cannot read holds nothing this caller can move.
        continue;
      }
    }
    const outcome: UserWorkTransferOutcome = { object: ref.object, field: ref.field, updated: 0, failed: 0, failures: [] };
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.id === undefined || row?.id === null) continue;
      budget -= 1;
      try {
        await engine.update(ref.object, { [ref.field]: toUserId }, { where: { id: row.id }, context });
        outcome.updated += 1;
      } catch (err) {
        outcome.failed += 1;
        if (outcome.failures.length < USER_WORK_FAILURE_SAMPLE) outcome.failures.push(failureOf(row.id, err));
      }
    }
    try {
      remaining += await engine.count(ref.object, { where: holdsUser(ref, fromUserId), context });
    } catch {
      // Counted as unknown: the rows moved above are reported either way.
    }
    if (outcome.updated > 0 || outcome.failed > 0) objects.push(outcome);
    updated += outcome.updated;
    failed += outcome.failed;
  }
  return { fromUserId, toUserId, objects, updated, failed, remaining };
}
