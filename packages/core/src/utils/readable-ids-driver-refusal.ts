// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3] The one refusal every driver answers for a `ReadableIds` leaf
 * it will not evaluate, and the walk that finds such a leaf.
 *
 * ## What a driver is handed
 *
 * The engine composes every `ReadableIds` leaf at its executor boundary,
 * immediately before the driver call (D2), so a driver that compiles the leaf
 * receives the COMPOSED form (`isComposedReadableIds`) and only as the
 * comparand of `$in`. Anything else is a composition fault, not an author
 * error, and every driver answers it with the same envelope (ADR-0112):
 * `INTERNAL_ERROR` / 500, a message naming the driver, the leaf and the remedy.
 * ⛔ Not `INVALID_FILTER`: no author can spell the leaf, so no author can fix
 * the filter.
 *
 * - an UNCOMPOSED leaf (`isReadableIds`) at any position — a direct driver
 *   call that bypassed the seam. Fail closed: ⛔ never evaluated as "no
 *   restriction", which would serve every row of the child;
 * - a composed leaf anywhere but a `$in` comparand;
 * - a composed leaf on a driver that does not compile it (`driver-mongodb`
 *   until a pipeline form is measured, ADR-0139 open item O3).
 *
 * ## Why here
 *
 * Four compilers answer it — `driver-sql` (and the two drivers that inherit
 * its compiler), Turso's remote transport, `driver-memory` and
 * `driver-mongodb` — and none of them imports another. A copy each is how one
 * refusal comes to answer one fault four ways, so the walk and the words live
 * on the floor all four already stand on, beside
 * `json-column-operator-refusal.ts`, which the drivers share for the same
 * reason. Each driver keeps its own logger: the refusal is logged at `error`
 * once per driver instance (see {@link ReadableIdsRefusalLog}).
 *
 * ⛔ No `DriverCapabilities` bit: a driver answers by compiling or refusing,
 * so there is nothing for the engine to read.
 */

import {
  filterSubtreeProvenanceOf,
  isComposedReadableIds,
  isReadableIds,
  markFilterSubtreeProvenance,
  type ComposedReadableIds,
} from '@objectstack/spec/data';

/** Where a leaf a driver will not evaluate sits, and which one it is. */
export interface MisplacedReadableIds {
  /** The path of the leaf in the filter, `where.record_id.$in` style. */
  readonly at: string;
  /** The parent object the leaf names. */
  readonly object: string;
  /**
   * - `uncomposed` — a `ReadableIds.of(...)` leaf that never passed the
   *   engine's composition seam;
   * - `misplaced` — a composed leaf outside a `$in` comparand;
   * - `unsupported` — a composed leaf on a driver that does not compile it.
   */
  readonly kind: 'uncomposed' | 'misplaced' | 'unsupported';
}

/**
 * The first leaf in `where` this driver will not evaluate, or `null`.
 *
 * `compilesComposed` is the driver's own answer: `true` for a driver that
 * compiles the composed leaf (a composed `$in` comparand is then legal and
 * not descended into — its `scope` is the PARENT's filter, compiled against
 * the parent), `false` for one that refuses it (every composed leaf is then
 * `unsupported`).
 *
 * The walk is the engine's own (`collectComposableReadableIds`): plain
 * objects and arrays only, cycle-safe, no other prototype descended into.
 */
export function findMisplacedReadableIds(
  where: unknown,
  compilesComposed: boolean,
  path = 'where',
): MisplacedReadableIds | null {
  const onPath = new Set<object>();
  const visit = (value: unknown, at: string, asInComparand: boolean): MisplacedReadableIds | null => {
    if (value === null || typeof value !== 'object') return null;
    if (isReadableIds(value)) return { at, object: value.object, kind: 'uncomposed' };
    if (isComposedReadableIds(value)) {
      if (!compilesComposed) return { at, object: value.object, kind: 'unsupported' };
      return asInComparand ? null : { at, object: value.object, kind: 'misplaced' };
    }
    if (onPath.has(value)) return null;
    const isArray = Array.isArray(value);
    if (!isArray) {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return null;
    }
    onPath.add(value);
    try {
      if (isArray) {
        const list = value as unknown[];
        for (let i = 0; i < list.length; i++) {
          const found = visit(list[i], `${at}[${i}]`, false);
          if (found) return found;
        }
      } else {
        for (const key of Object.keys(value)) {
          const found = visit((value as Record<string, unknown>)[key], `${at}.${key}`, key === '$in');
          if (found) return found;
        }
      }
      return null;
    } finally {
      onPath.delete(value);
    }
  };
  return visit(where, path, false);
}

/**
 * `where` with the comparand of every composed `$in` leaf replaced by
 * `answer(leaf)`, copy-on-write: a subtree holding no leaf is returned by
 * reference, the caller's tree is never edited (the leaf is frozen, and the
 * hooks' AST is the caller's), and a rewritten node carries the
 * filter-subtree provenance mark of the node it replaces, so a refusal raised
 * inside it resolves to the same author / policy attribution it did before.
 *
 * Asked only after {@link findMisplacedReadableIds} answered `null` for the
 * same `where`, so every composed leaf the walk meets sits in a `$in`.
 * For a driver that evaluates the leaf by rewriting it — `driver-memory`
 * into the readable id list, Turso's remote face into its resolved semi-join.
 */
export function replaceComposedReadableIds<T>(where: T, answer: (leaf: ComposedReadableIds) => unknown): T {
  const onPath = new Set<object>();
  const rewrite = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object' || isComposedReadableIds(value)) return value;
    if (onPath.has(value)) return value;
    const isArray = Array.isArray(value);
    if (!isArray) {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return value;
    }
    onPath.add(value);
    try {
      if (isArray) {
        let out: unknown[] | undefined;
        (value as unknown[]).forEach((item, i) => {
          const next = rewrite(item);
          if (next !== item) (out ??= [...(value as unknown[])])[i] = next;
        });
        return out ?? value;
      }
      let out: Record<string, unknown> | undefined;
      for (const key of Object.keys(value)) {
        const item = (value as Record<string, unknown>)[key];
        const next = key === '$in' && isComposedReadableIds(item) ? answer(item) : rewrite(item);
        if (next !== item) (out ??= { ...(value as Record<string, unknown>) })[key] = next;
      }
      if (out === undefined) return value;
      const mark = filterSubtreeProvenanceOf(value);
      return mark === null ? out : markFilterSubtreeProvenance(out, mark);
    } finally {
      onPath.delete(value);
    }
  };
  return rewrite(where) as T;
}

/** The ADR-0112 envelope of the refusal: a composition fault, never `INVALID_FILTER`. */
export type ReadableIdsDriverRefusalError = Error & {
  code: 'INTERNAL_ERROR';
  status: 500;
  httpStatus: 500;
};

/**
 * The refusal for `site`, raised by `driver` (its package name, e.g.
 * `driver-sql`). The message names the driver, the leaf and the remedy; the
 * read was not run.
 */
export function readableIdsDriverRefusal(
  driver: string,
  site: MisplacedReadableIds,
  // Why this driver does not compile the composed leaf — read for `unsupported` only.
  unsupportedReason = 'no pipeline form of the tenant-walled semi-join is measured for this driver yet',
): ReadableIdsDriverRefusalError {
  const leaf = `${site.at} holds a ReadableIds leaf, "the ids of '${site.object}' this caller may read"`;
  let message: string;
  switch (site.kind) {
    case 'uncomposed':
      message =
        `[${driver}] ${leaf}, UNCOMPOSED: it reached the driver without passing the engine's composition ` +
        'seam, and the driver refuses it rather than read it as no restriction. The query was NOT run. ' +
        'Read through the ObjectQL engine (find / findOne / count / aggregate), which composes every ' +
        'leaf with the caller\'s read scope before any driver call; never hand a driver ReadableIds.of() directly.';
      break;
    case 'misplaced':
      message =
        `[${driver}] ${leaf}, composed, outside a $in comparand. The leaf is legal only as the comparand ` +
        'of $in on a pointer field ({ record_id: { $in: leaf } }); the query was NOT run. Place it there, ' +
        'or write the predicate without it.';
      break;
    case 'unsupported':
      message =
        `[${driver}] ${leaf}, composed, and ${driver} does not compile it: ${unsupportedReason}. ` +
        'The query was NOT run, rather than ' +
        'answer a short or an unscoped list. Bind the object and its parent to a SQL-family or memory ' +
        'datasource, or read this object through its bounded probe, chosen before the leaf is written.';
      break;
  }
  const err = new Error(message) as ReadableIdsDriverRefusalError;
  err.code = 'INTERNAL_ERROR';
  err.status = 500;
  err.httpStatus = 500;
  return err;
}

/** The slice of a driver's logger the refusal needs. */
export interface ReadableIdsRefusalLog {
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * The refusal for `site`, logged at `error` the FIRST time `driver`'s
 * instance refuses (`state.logged` is that instance's own flag), and returned
 * for the caller to throw. A composition fault means every such read on this
 * driver fails, so one line names it; the caller sees every refusal.
 */
export function refuseReadableIdsOnce(
  driver: string,
  site: MisplacedReadableIds,
  log: ReadableIdsRefusalLog | undefined,
  state: { logged: boolean },
  unsupportedReason?: string,
): ReadableIdsDriverRefusalError {
  const err = readableIdsDriverRefusal(driver, site, unsupportedReason);
  if (!state.logged) {
    state.logged = true;
    log?.error(`${err.message} Logged once for this driver; later refusals answer the caller the same way.`, {
      code: err.code,
      object: site.object,
      at: site.at,
      kind: site.kind,
    });
  }
  return err;
}
