// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D1 / D3] The recycle bin's removal side: the permanent
 * delete, purging one entry, and emptying an object's entries.
 *
 * ## One verb: `purge`
 *
 * All three are dispatched through the middleware chain as the `purge`
 * operation, on the BUSINESS object the rows belong to, so the one grant that
 * authorizes the verb governs all three (`manageRecycleBin`, ADR-0148 D5, Q3
 * ruled A: only a recycle-bin manager deletes for good). Until
 * `@objectstack/plugin-security` maps the verb to that grant, its fail-closed
 * backstop for the destructive verbs (`DESTRUCTIVE_OPERATIONS`) refuses every
 * caller that is not the system. A composition without the security plugin
 * authorizes nothing, as for every other verb.
 *
 *   - `ObjectQL.delete(object, { where: { id }, permanent: true })`: the by-id
 *     delete, with its hooks, cascade and events, that writes no entry. Its
 *     `where.id` is the live row's, so the security plugin's by-id pre-image
 *     check judges the row as it judges a delete ({@link readPermanentDelete}).
 *   - `ObjectQL.purge(entryId)`: the entry's `object_name` is the object; the
 *     dispatch carries no id ({@link purgeRecycleBinEntry}).
 *   - `ObjectQL.empty(object)`: every entry of one object, one dispatch, one
 *     authorization; the dispatch carries no id ({@link emptyRecycleBin}).
 *
 * ## Why `purge` never carries an AST (#7809)
 *
 * The security plugin's AST path hands `opCtx.operation` to the RLS compiler
 * raw, and the compiler knows `select` / `insert` / `update` / `delete` only.
 * So `purge` and `empty` dispatch with no `ast`, and the permanent delete is
 * refused unless it is a by-id delete (a predicate delete carries its `where`
 * as an AST). `engine-middleware-operation-vocabulary.test.ts` pins both.
 *
 * ## Why raw
 *
 * An entry is engine-owned bookkeeping, as at capture (`capture.ts`): it is
 * read and removed through the bin's driver, with the caller's driver options,
 * so the caller's organization scopes the read and the removal.
 */

import { RECYCLE_BIN_OBJECT } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { OperationContext } from '../engine-top-level.js';
import { recycleBinTakesObject } from './capture.js';

/** What {@link purgeRecycleBinEntry} and {@link emptyRecycleBin} read off the engine. */
export interface RecycleBinRemovalHost {
  readonly _registry: { getObject(name: string): unknown };
  getDriver(object: string): any;
  buildDriverOptions(object: string, execCtx?: ExecutionContext): any;
  executeWithMiddleware(ctx: OperationContext, executor: () => Promise<any>): Promise<any>;
}

/** The options `ObjectQL.purge` and `ObjectQL.empty` take. */
export interface RecycleBinRemovalOptions {
  /** The caller; it scopes the entries to its organization and is authorized for `purge`. */
  context?: ExecutionContext;
}

/** How many entry ids one page of {@link emptyRecycleBin}'s fallback reads. */
const EMPTY_PAGE_SIZE = 500;

/** A `400 VALIDATION_ERROR` refusal of a recycle-bin call's own shape. */
function recycleBinCallRefusal(message: string, developerMessage: string, object: string | undefined, param: string): Error {
  const err: any = new Error(message);
  err.developerMessage = developerMessage;
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.httpStatus = 400;
  err.param = param;
  if (object !== undefined) err.object = object;
  return err;
}

/** The refusal for a platform object, whose deletes the bin never takes. */
function platformObjectRefusal(object: string, param: string, what: string): Error {
  return recycleBinCallRefusal(
    `'${object}' is a platform object: its deletes never enter the recycle bin, so ${what}.`,
    `${what.charAt(0).toUpperCase()}${what.slice(1)}: the recycle bin takes no object in the platform namespaces ` +
      `(sys_, cloud_, ai_), so '${object}' has no entries and its plain delete is already permanent.`,
    object,
    param,
  );
}

/**
 * Read a delete's `permanent` key: `true` when the delete is permanent. Throws
 * `400 VALIDATION_ERROR` when the key is not a boolean, or is `true` on a delete
 * that cannot be permanent:
 *
 *   - a delete that is not by id, or that asks `multi: true`: the bin takes a
 *     by-id delete only, so there is nothing to skip, and a predicate delete
 *     carries an AST, which `purge` never does (#7809);
 *   - a platform object, which the bin never takes.
 *
 * Called before the operation context is built, so a refusal runs no
 * middleware and no hook.
 */
export function readPermanentDelete(
  object: string,
  options: { permanent?: unknown; multi?: unknown } | undefined,
  dispatchKind: 'by-id' | 'multi' | 'reject',
): boolean {
  const permanent = options?.permanent;
  if (permanent === undefined || permanent === false) return false;
  if (permanent !== true) {
    throw recycleBinCallRefusal(
      `The delete's 'permanent' option must be true or false: got ${JSON.stringify(permanent)}.`,
      `EngineDeleteOptions.permanent is a boolean; ${typeof permanent} given on a delete of '${object}'.`,
      object,
      'permanent',
    );
  }
  if (dispatchKind !== 'by-id' || options?.multi === true) {
    throw recycleBinCallRefusal(
      `A permanent delete names one record by its id: 'permanent' is refused on a delete by filter.`,
      `permanent: true is honoured on a by-id delete of '${object}' only (where: { id }, no multi: true). ` +
        'Only a by-id delete enters the recycle bin, so a delete by filter has no entry to skip; delete each record ' +
        'by its id to delete it for good.',
      object,
      'permanent',
    );
  }
  if (!recycleBinTakesObject(object)) throw platformObjectRefusal(object, 'permanent', "'permanent' has nothing to skip");
  return true;
}

/**
 * The body of `ObjectQL.purge`: remove one recycle-bin entry, so its rows can
 * no longer be restored. `true` when the entry was removed; `false` when no
 * entry with that id is visible to the caller's organization, or the
 * composition registers no bin.
 *
 * The entry is read first, raw and scoped to the caller's organization, for
 * the object its rows belong to; the removal is then dispatched as `purge` on
 * that object, and runs only if the chain lets it through.
 */
export async function purgeRecycleBinEntry(
  this: RecycleBinRemovalHost,
  entryId: string | number,
  options?: RecycleBinRemovalOptions,
): Promise<boolean> {
  if (!((typeof entryId === 'string' && entryId !== '') || (typeof entryId === 'number' && Number.isFinite(entryId)))) {
    throw recycleBinCallRefusal(
      'A purge names the recycle-bin entry by its id.',
      `ObjectQL.purge(entryId) takes the entry id as a non-empty string or a number; got ${JSON.stringify(entryId)}.`,
      undefined,
      'entryId',
    );
  }
  if (!this._registry.getObject(RECYCLE_BIN_OBJECT)) return false;
  const context = options?.context;
  const driver = this.getDriver(RECYCLE_BIN_OBJECT);
  const rows = ((await driver.find(
    RECYCLE_BIN_OBJECT,
    { object: RECYCLE_BIN_OBJECT, where: { id: entryId }, fields: ['id', 'object_name'], limit: 1 },
    this.buildDriverOptions(RECYCLE_BIN_OBJECT, context),
  )) ?? []) as Array<Record<string, unknown>>;
  const entry = rows[0];
  if (entry?.id == null || typeof entry.object_name !== 'string' || entry.object_name === '') return false;
  const opCtx: OperationContext = { object: entry.object_name, operation: 'purge', options: { context }, context };
  return (await this.executeWithMiddleware(opCtx, async () => {
    const removed = await driver.delete(RECYCLE_BIN_OBJECT, entry.id as string | number, this.buildDriverOptions(RECYCLE_BIN_OBJECT, opCtx.context));
    return removed === true || (typeof removed === 'number' && removed > 0);
  })) === true;
}

/**
 * The body of `ObjectQL.empty`: remove every recycle-bin entry of one object
 * that the caller's organization holds. Answers how many were removed; `0`
 * when the composition registers no bin.
 *
 * One dispatch of `purge` on `object`, so one authorization covers the whole
 * act. `object` may name an object that is no longer registered (its package
 * was uninstalled): its entries can still be emptied. A platform object is
 * refused, since the bin never takes one.
 */
export async function emptyRecycleBin(
  this: RecycleBinRemovalHost,
  object: string,
  options?: RecycleBinRemovalOptions,
): Promise<number> {
  if (typeof object !== 'string' || object === '') {
    throw recycleBinCallRefusal(
      'Emptying the recycle bin names the object whose entries are removed.',
      `ObjectQL.empty(object) takes the object name as a non-empty string; got ${JSON.stringify(object)}.`,
      undefined,
      'object',
    );
  }
  if (!recycleBinTakesObject(object)) throw platformObjectRefusal(object, 'object', 'there is nothing to empty');
  if (!this._registry.getObject(RECYCLE_BIN_OBJECT)) return 0;
  const context = options?.context;
  const opCtx: OperationContext = { object, operation: 'purge', options: { context }, context };
  return await this.executeWithMiddleware(opCtx, async () => {
    const driver = this.getDriver(RECYCLE_BIN_OBJECT);
    const driverOptions = this.buildDriverOptions(RECYCLE_BIN_OBJECT, opCtx.context);
    const where = { object_name: object };
    if (typeof driver.deleteMany === 'function') {
      return (await driver.deleteMany(RECYCLE_BIN_OBJECT, { object: RECYCLE_BIN_OBJECT, where }, driverOptions)) as number;
    }
    // A driver with no `deleteMany`: remove the entries one by one, a page of
    // ids at a time. A page that removes nothing ends the loop, so an entry the
    // driver will not remove cannot hold it forever.
    let removed = 0;
    for (;;) {
      const page = ((await driver.find(
        RECYCLE_BIN_OBJECT,
        { object: RECYCLE_BIN_OBJECT, where, fields: ['id'], limit: EMPTY_PAGE_SIZE },
        driverOptions,
      )) ?? []) as Array<Record<string, unknown>>;
      let removedHere = 0;
      for (const row of page) {
        if (row?.id == null) continue;
        const answer = await driver.delete(RECYCLE_BIN_OBJECT, row.id as string | number, driverOptions);
        if (answer === true || (typeof answer === 'number' && answer > 0)) removedHere += 1;
      }
      removed += removedHere;
      if (page.length < EMPTY_PAGE_SIZE || removedHere === 0) return removed;
    }
  });
}
