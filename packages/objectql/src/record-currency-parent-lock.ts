// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2, amended 2026-11-09 by #31743] Once a record has a child row
 * that follows its currency, a change of the record's code field is refused.
 *
 * ## The rule, as the amendment states it
 *
 * "Once a record has at least one child row whose amount's `currencyField`
 * follows it through `master_detail`, an update that changes the record's code
 * field, to another code or to blank, is refused." The child stores no code of
 * its own: its amounts were converted at write (D5) from the code the parent
 * held then, so a parent code that moved would leave every stored home amount
 * converted from a code the parent no longer holds. The amendment picked this
 * lock over rewriting the children in cascade.
 *
 * - **Who follows.** A child object with a `record`-mode amount whose
 *   `currencyField` is `MASTER_DETAIL.CODE`, where `MASTER_DETAIL` is a
 *   `master_detail` field naming this object, and `CODE` the field written.
 *   Read off the registered objects ({@link currencyFollowersOf}), indexed once
 *   per registry revision.
 * - **What is a change.** A non-blank stored code that the write makes blank or
 *   different. "Writing the same code again is not a change. Neither is setting
 *   a code on a record whose code is blank": a child amount beside a blank
 *   parent code is refused at its own write (D8 rule 4), so no child was
 *   converted from a code the parent never had.
 * - **Which rows follow.** Any row of a following child object that names the
 *   record in its `master_detail`, whatever its amount holds. "A child row in
 *   the recycle bin still follows its parent" (ADR-0148): an entry whose
 *   snapshot holds such a row counts until it is restored or purged. "Follows"
 *   is read at each write and never recorded, so the lock lifts once the last
 *   following row is gone.
 *
 * ## The answer
 *
 * `VALIDATION_FAILED` / 400, the record-write envelope, before anything is
 * written, with one `invalid_value` finding on each code field the write would
 * change. The message names the child object or objects whose rows follow the
 * code, and says the code can change once no child row follows it.
 *
 * ## Where it stands
 *
 * On the engine's update path, by id and by predicate, after the final payload
 * is settled (every hook and strip has run), so REST, import, flows and bulk
 * updates all meet it. The reads run under the write's elevated,
 * organization-kept authority: a writer who cannot read the children is still
 * refused, and never by another organization's rows. Free for an object no
 * child follows, and for a payload that touches no followed code field.
 */

import { RECYCLE_BIN_OBJECT } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { isRecordCurrencyBlank, recordCurrencyFieldOf, recordCurrencyPathOf } from './validation/record-currency-code.js';
import { ValidationError } from './validation/record-validator.js';
import { parseSnapshot } from './recycle-bin/restore.js';

/** A child object whose record-mode amounts follow a parent's code field through a `master_detail`. */
export interface CurrencyFollower {
  /** The child object. */
  readonly childObject: string;
  /** Its `master_detail` field naming the parent. */
  readonly via: string;
  /** The parent's code field the child's amounts follow. */
  readonly codeField: string;
  /** The child's amounts that follow it, in declaration order. */
  readonly amountFields: readonly string[];
}

interface RegistryLike {
  getAllObjects(): unknown[];
  getObject(name: string): unknown;
  readonly objectRevision?: number;
}

interface FollowerIndex {
  readonly revision: number | undefined;
  readonly byParent: ReadonlyMap<string, readonly CurrencyFollower[]>;
}

const INDEXES = new WeakMap<object, FollowerIndex>();

function fieldsOf(obj: unknown): Record<string, unknown> | undefined {
  const fields = (obj as { fields?: unknown } | null | undefined)?.fields;
  return fields !== null && typeof fields === 'object' && !Array.isArray(fields) ? (fields as Record<string, unknown>) : undefined;
}

function buildFollowerIndex(registry: RegistryLike): Map<string, CurrencyFollower[]> {
  const byParent = new Map<string, CurrencyFollower[]>();
  for (const child of registry.getAllObjects()) {
    const childObject = (child as { name?: unknown } | null)?.name;
    const fields = fieldsOf(child);
    if (typeof childObject !== 'string' || !fields) continue;
    const grouped = new Map<string, { parent: string; via: string; codeField: string; amountFields: string[] }>();
    for (const [amountField, def] of Object.entries(fields)) {
      const pointer = recordCurrencyFieldOf(def);
      const path = pointer === undefined ? undefined : recordCurrencyPathOf(pointer, fields);
      if (!path || path.master === undefined) continue;
      const key = `${path.via}\u0000${path.code}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = { parent: path.master, via: path.via, codeField: path.code, amountFields: [] };
        grouped.set(key, entry);
      }
      entry.amountFields.push(amountField);
    }
    for (const { parent, ...follower } of grouped.values()) {
      const list = byParent.get(parent) ?? [];
      list.push({ childObject, ...follower });
      byParent.set(parent, list);
    }
  }
  return byParent;
}

/**
 * Every child that follows a code field of `parent`, read off the registered
 * objects. Indexed once per registry `objectRevision` (the counter every
 * metadata mutation moves); a registry that keeps none is read afresh.
 */
export function currencyFollowersOf(registry: RegistryLike, parent: string): readonly CurrencyFollower[] {
  const revision = typeof registry.objectRevision === 'number' ? registry.objectRevision : undefined;
  let index = revision === undefined ? undefined : INDEXES.get(registry);
  if (!index || index.revision !== revision) {
    index = { revision, byParent: buildFollowerIndex(registry) };
    if (revision !== undefined) INDEXES.set(registry, index);
  }
  return index.byParent.get(parent) ?? [];
}

/**
 * The objects whose recycle-bin entries can hold a row of `child`: the child
 * itself, deleted on its own, and every object a cascade reaches it from (the
 * targets of its relation fields, transitively). A superset is harmless: it is
 * only the filter of one read.
 */
function binRootsOf(registry: RegistryLike, child: string): string[] {
  const seen = new Set<string>([child]);
  const queue = [child];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const def of Object.values(fieldsOf(registry.getObject(next)) ?? {})) {
      const { type, reference } = (def ?? {}) as { type?: unknown; reference?: unknown };
      if ((type !== 'master_detail' && type !== 'lookup') || typeof reference !== 'string' || seen.has(reference)) continue;
      seen.add(reference);
      queue.push(reference);
    }
  }
  return [...seen];
}

/** The reads the lock makes, supplied by the engine under the write's elevated, organization-kept authority. */
export interface ParentCurrencyLockReads {
  /** Up to `limit` rows of `object` matching `where`, each with `fields`. */
  findRows(object: string, where: Record<string, unknown>, fields: readonly string[], limit: number): Promise<Array<Record<string, unknown>>>;
  /** The recycle-bin entries whose `object_name` is one of `roots` (an empty list when the bin is not registered). */
  binEntries(roots: readonly string[]): Promise<Array<Record<string, unknown>>>;
}

/** What {@link parentCurrencyLockReads} reads through: the engine, or a host facet of it. */
export interface ParentCurrencyLockHost {
  readonly _registry: { getObject(name: string): unknown };
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
  getDriver(object: string): { find(object: string, ast: unknown, options?: unknown): Promise<unknown> };
  buildDriverOptions(object: string, context?: ExecutionContext): unknown;
}

/**
 * The reads the lock makes: the following child rows through the engine's
 * read, and the recycle-bin entries raw through the bin's driver, as the bin's
 * own listing door reads them, both under `elevated`: the write's elevated,
 * organization-kept context (`ObjectQL.referenceCheckContext`), so a writer
 * who cannot read a child is still refused, and never by another
 * organization's row.
 */
export function parentCurrencyLockReads(host: ParentCurrencyLockHost, elevated: ExecutionContext): ParentCurrencyLockReads {
  return {
    findRows: async (object, where, fields, limit) => {
      const rows = await host.find(object, { where, fields: [...fields], limit, context: elevated });
      return (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
    },
    binEntries: async (roots) => {
      if (!host._registry.getObject(RECYCLE_BIN_OBJECT)) return [];
      const rows = await host.getDriver(RECYCLE_BIN_OBJECT).find(
        RECYCLE_BIN_OBJECT,
        { object: RECYCLE_BIN_OBJECT, where: { object_name: { $in: [...roots] } } },
        host.buildDriverOptions(RECYCLE_BIN_OBJECT, elevated),
      );
      return (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
    },
  };
}

/** The comparable spelling of a stored code: trimmed text, blank as `undefined`. */
function codeOf(value: unknown): unknown {
  if (isRecordCurrencyBlank(value)) return undefined;
  return typeof value === 'string' ? value.trim() : value;
}

/** Does any of `fields` of a parent object have a child that follows it? The update path asks it before reading any row. */
export function touchesFollowedCurrencyCode(
  registry: RegistryLike,
  object: string,
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!payload) return false;
  return currencyFollowersOf(registry, object).some((f) => Object.prototype.hasOwnProperty.call(payload, f.codeField));
}

interface Following {
  readonly follower: CurrencyFollower;
  readonly parentId: string;
  readonly binned: boolean;
}

/**
 * Refuse an update that changes the code field of a record a child row
 * follows — see the module header.
 *
 * @param priorRows the stored rows the update writes (one for a by-id update,
 *                  the matched rows for a predicate update)
 * @param payload   the FINAL payload, laid over each of them
 * @throws ValidationError `VALIDATION_FAILED` with one `invalid_value` finding per locked code field
 */
export async function assertFollowedCurrencyCodesUnchanged(
  registry: RegistryLike,
  reads: ParentCurrencyLockReads,
  object: string,
  payload: Record<string, unknown> | null | undefined,
  priorRows: ReadonlyArray<Record<string, unknown> | null | undefined>,
): Promise<void> {
  if (!payload) return;
  const followers = currencyFollowersOf(registry, object).filter((f) => Object.prototype.hasOwnProperty.call(payload, f.codeField));
  if (followers.length === 0) return;

  // The records whose code each followed field would change, with the code each holds now.
  const changed = new Map<string, Map<string, unknown>>();
  for (const codeField of new Set(followers.map((f) => f.codeField))) {
    const next = codeOf(payload[codeField]);
    for (const row of priorRows) {
      if (!row || row.id === undefined || row.id === null || row.id === '') continue;
      const held = codeOf(row[codeField]);
      if (held === undefined || Object.is(held, next)) continue;
      let ids = changed.get(codeField);
      if (!ids) {
        ids = new Map();
        changed.set(codeField, ids);
      }
      ids.set(String(row.id), held);
    }
  }
  if (changed.size === 0) return;

  const following: Following[] = [];
  for (const follower of followers) {
    const ids = changed.get(follower.codeField);
    if (!ids || ids.size === 0) continue;
    const live = await reads.findRows(follower.childObject, { [follower.via]: { $in: [...ids.keys()] } }, ['id', follower.via], 1);
    const hit = live.find((row) => row?.[follower.via] != null && ids.has(String(row[follower.via])));
    if (hit) {
      following.push({ follower, parentId: String(hit[follower.via]), binned: false });
      continue;
    }
    for (const entry of await reads.binEntries(binRootsOf(registry, follower.childObject))) {
      const binnedRow = parseSnapshot(entry?.snapshot)?.rows.find(
        (r) => r.object === follower.childObject && r.values[follower.via] != null && ids.has(String(r.values[follower.via])),
      );
      if (binnedRow) {
        following.push({ follower, parentId: String(binnedRow.values[follower.via]), binned: true });
        break;
      }
    }
  }
  if (following.length === 0) return;

  const findings = [...new Set(following.map((f) => f.follower.codeField))].map((codeField) => {
    const here = following.filter((f) => f.follower.codeField === codeField);
    const [first] = here;
    const held = changed.get(codeField)?.get(first.parentId);
    const next = codeOf(payload[codeField]);
    const children = [...new Set(here.map((f) => f.follower.childObject))];
    const childList = children.map((c) => `'${c}'`).join(', ');
    const named = here.map((f) => `'${f.follower.childObject}.${f.follower.amountFields.join(`', '${f.follower.childObject}.`)}' through '${f.follower.via}'`).join('; ');
    return {
      field: codeField,
      code: 'invalid_value' as const,
      message: `'${codeField}' on '${object}' (record ${first.parentId}) cannot change from '${String(held)}' to `
        + (next === undefined ? 'blank' : `'${String(next)}'`)
        + `: rows of ${childList} follow this record's currency (${named})`
        + (here.some((f) => f.binned) ? ', a deleted row in the recycle bin included' : '')
        + `, and their stored home amounts were converted from '${String(held)}'. The update was not written. `
        + `The code can change once no child row follows it: delete those rows (and purge them from the recycle `
        + `bin) or move them to another '${object}' record, then change the code. Writing the same code again is `
        + 'not a change.',
    };
  });
  throw new ValidationError(findings);
}
