// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D5] The recycle bin's listing: the entries of one object,
 * newest first, for a caller that manages that object's bin.
 *
 * ## Who may list
 *
 * `manageRecycleBin` is the grant that lists every entry of an object
 * (`RECYCLE_BIN_GRANT_KEYS.manage`, ADR-0148 D5). The listing carries no
 * operation the security layer's object gate answers: `sys_recycle_bin`
 * serves no generic data method, and a read of the bin is not a read of the
 * object its rows came from. So the engine asks the grant itself, as the
 * restore asks whose entry it is (`restore.ts`,
 * {@link callerRecycleBinManagement}): the caller's effective permission on the
 * object, as the registered resolver answers it, folded by the spec's
 * `objectPermissionGrants` (read bounds it, `modifyAllRecords` implies it).
 * No resolver registered, a resolver that throws, or a map with no entry for
 * the object: refused `403 PERMISSION_DENIED`. Fail closed. The system lists
 * every entry ({@link assertCallerManagesRecycleBin}).
 *
 * ## What it answers
 *
 * Each entry as the bin holds it, the snapshot included, unmasked. Field-level
 * security on the live object is the caller's to apply (the REST door does,
 * `recycle-bin-routes.ts`): the engine holds no field mask, and the snapshot
 * may hold rows of several objects.
 *
 * ## The tenant wall
 *
 * As at the removal side (`purge.ts`, {@link recycleBinWallDenies}): a caller
 * the wall denies sees no entry, and the read is scoped by the caller's
 * organization through the bin's driver options.
 */

import { RECYCLE_BIN_GRANT_KEYS, RECYCLE_BIN_OBJECT, type RecycleBinSnapshot } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { callerRecycleBinManagement, parseSnapshot, type RecycleBinRestoreHost } from './restore.js';
import { recycleBinCallRefusal, recycleBinPlatformObjectRefusal, recycleBinWallDenies } from './purge.js';
import { recycleBinTakesObject } from './capture.js';

/** What {@link listRecycleBin} reads off the engine. */
export type RecycleBinListHost = Pick<
  RecycleBinRestoreHost,
  '_registry' | 'logger' | 'effectiveObjectPermissionsResolver' | 'getDriver' | 'buildDriverOptions' | 'engineLayer0Verdict'
>;

/**
 * [ADR-0148 D1, #30237] The recycle-bin half of `ObjectQL.delete`'s options:
 * `onRecycleBinEntry` is told the id of the entry a by-id delete wrote, once
 * the driver reports the row removed, so the data door can answer
 * `DeleteDataResponse.recycleBinEntryId`, the entry a caller offers to undo.
 * Not called when the delete wrote no entry (a platform object, a delete by
 * predicate or with `multi: true`, `permanent: true`, a composition with no
 * bin) or the driver removed nothing.
 *
 * A function, so it lives beside `EngineDeleteOptions` rather than on it, as
 * update's `WriteObservabilityOptions` do: a callback has no JSON Schema, the
 * spec's options type stays the serialisable bag, and the hook face
 * (`HookDeleteOptions`) does not inherit it.
 */
export interface RecycleBinDeleteObservability {
  onRecycleBinEntry?: (entryId: string) => void;
}

/** The most entries one page of {@link listRecycleBin} answers. */
export const RECYCLE_BIN_LIST_MAX_LIMIT = 200;

/** The page size {@link listRecycleBin} answers when the caller names none. */
export const RECYCLE_BIN_LIST_DEFAULT_LIMIT = 50;

/** The options `ObjectQL.listRecycleBin` takes. */
export interface RecycleBinListOptions {
  /** The caller; it scopes the entries to its organization and must manage the object's bin. */
  context?: ExecutionContext;
  /** How many entries to answer, 1 to {@link RECYCLE_BIN_LIST_MAX_LIMIT}; default {@link RECYCLE_BIN_LIST_DEFAULT_LIMIT}. */
  limit?: number;
  /** How many entries to skip, newest first; default 0. */
  offset?: number;
}

/** One entry as `ObjectQL.listRecycleBin` answers it. */
export interface RecycleBinListedEntry {
  readonly id: string;
  readonly object: string;
  readonly recordId: string;
  readonly recordCount: number;
  /** The rows the delete removed and the references it cleared; `undefined` when the stored snapshot does not parse. */
  readonly snapshot: RecycleBinSnapshot | undefined;
  readonly deletedBy: string | undefined;
  readonly deletedAt: string | undefined;
  readonly retentionDays: number | undefined;
  readonly purgeAfter: string | undefined;
}

/** What `ObjectQL.listRecycleBin` answers. */
export interface RecycleBinListResult {
  readonly object: string;
  readonly entries: readonly RecycleBinListedEntry[];
  /** Whether at least one more entry follows this page. */
  readonly hasMore: boolean;
}

/**
 * The refusal of a listing to a caller that does not manage the object's
 * recycle bin: `403 PERMISSION_DENIED`, the code the object gate answers.
 */
function notManagerRefusal(object: string, unanswered: boolean): Error {
  const err: any = new Error(
    'Listing the recycle bin of this object needs the recycle-bin manager permission on it.',
  );
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.httpStatus = 403;
  err.developerMessage =
    `Listing the recycle-bin entries of '${object}' needs '${RECYCLE_BIN_GRANT_KEYS.manage}' on '${object}' (ADR-0148 D5). ` +
    (unanswered
      ? 'No effective-permission resolver answered for this caller, so the listing failed closed.'
      : `The caller's effective permission on '${object}' does not grant it.`);
  err.object = object;
  return err;
}

/**
 * [#30237, ADR-0148 D5] Whether `context` may list the recycle bin of
 * `object`: the system may; any other caller only when its effective
 * permissions grant `manageRecycleBin` on the object. Throws `403
 * PERMISSION_DENIED` otherwise, and when no resolver answers. Fail closed.
 */
export async function assertCallerManagesRecycleBin(
  this: Pick<RecycleBinListHost, 'effectiveObjectPermissionsResolver' | 'logger'>,
  object: string,
  context: ExecutionContext | undefined,
): Promise<void> {
  if (context?.isSystem === true) return;
  const answer = await callerRecycleBinManagement.call(this, object, context, 'listing');
  if (answer !== 'manages') throw notManagerRefusal(object, answer === 'unanswered');
}

/** A whole number in `[min, max]`, or the refusal naming `param`. */
function pageNumber(value: unknown, fallback: number, min: number, max: number, param: string, object: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw recycleBinCallRefusal(
      `The recycle-bin listing's '${param}' must be a whole number from ${min} to ${max}.`,
      `ObjectQL.listRecycleBin('${object}', { ${param} }) takes a whole number from ${min} to ${max}; got ${JSON.stringify(value)}.`,
      object,
      param,
    );
  }
  return value;
}

function textOrUndefined(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The body of `ObjectQL.listRecycleBin`: one page of the entries of `object`
 * that the caller's organization holds, newest first. An empty page when the
 * composition registers no bin, or the tenant wall denies the caller. A
 * platform object (`sys_`, `cloud_`, `ai_`) is refused `400`: the bin never
 * takes one. `object` may name an object that is no longer registered (its
 * package was uninstalled): its entries are still listed, as `empty` still
 * removes them.
 */
export async function listRecycleBin(
  this: RecycleBinListHost,
  object: string,
  options?: RecycleBinListOptions,
): Promise<RecycleBinListResult> {
  if (typeof object !== 'string' || object === '') {
    throw recycleBinCallRefusal(
      'Listing the recycle bin names the object whose entries are listed.',
      `ObjectQL.listRecycleBin(object) takes the object name as a non-empty string; got ${JSON.stringify(object)}.`,
      undefined,
      'object',
    );
  }
  if (!recycleBinTakesObject(object)) throw recycleBinPlatformObjectRefusal(object, 'object', 'there is nothing to list');
  const limit = pageNumber(options?.limit, RECYCLE_BIN_LIST_DEFAULT_LIMIT, 1, RECYCLE_BIN_LIST_MAX_LIMIT, 'limit', object);
  const offset = pageNumber(options?.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset', object);
  const context = options?.context;
  await assertCallerManagesRecycleBin.call(this, object, context);
  if (!this._registry.getObject(RECYCLE_BIN_OBJECT)) return { object, entries: [], hasMore: false };
  if (recycleBinWallDenies.call(this, context)) return { object, entries: [], hasMore: false };
  const rows = ((await this.getDriver(RECYCLE_BIN_OBJECT).find(
    RECYCLE_BIN_OBJECT,
    {
      object: RECYCLE_BIN_OBJECT,
      where: { object_name: object },
      orderBy: [{ field: 'deleted_at', order: 'desc' }, { field: 'id', order: 'desc' }],
      limit: limit + 1,
      ...(offset > 0 ? { offset } : {}),
    },
    this.buildDriverOptions(RECYCLE_BIN_OBJECT, context),
  )) ?? []) as Array<Record<string, unknown>>;
  const entries: RecycleBinListedEntry[] = [];
  for (const row of rows.slice(0, limit)) {
    if (row?.id == null || row.object_name !== object) continue;
    entries.push({
      id: String(row.id),
      object,
      recordId: row.record_id == null ? '' : String(row.record_id),
      recordCount: numberOrUndefined(row.record_count) ?? 0,
      snapshot: parseSnapshot(row.snapshot),
      deletedBy: textOrUndefined(row.deleted_by),
      deletedAt: textOrUndefined(row.deleted_at),
      retentionDays: numberOrUndefined(row.retention_days),
      purgeAfter: textOrUndefined(row.purge_after),
    });
  }
  return { object, entries, hasMore: rows.length > limit };
}
