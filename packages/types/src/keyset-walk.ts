// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Seek-based (keyset) pagination for the batch walks that read a whole object.
 *
 * # Why this exists rather than `limit`/`offset`
 *
 * A background walk that pages with a growing `offset` — rebuild an index,
 * verify file references, backfill a projection — is wrong in two ways that a
 * seek fixes at once.
 *
 * **It can skip rows.** `LIMIT n OFFSET k` is a slice of an arrangement, and
 * the arrangement has to be the *same* one on every page for the slices to
 * partition the set. Drivers now guarantee that for a single read
 * (objectstack#4363), but not across a walk that *mutates as it goes*: a
 * backfill that updates each page, or a rebuild that deletes, changes the very
 * set the next offset counts into. Rows shift past the cursor and are never
 * visited. For a verifier that decides which files are still referenced, or an
 * index rebuild that deletes what it did not see, a skipped row is not a slow
 * page — it is a wrong answer that looks like a clean run. A seek predicate
 * carries the position *in the data* instead of counting from the start, so an
 * update cannot move a row past it and a delete cannot shift one under it.
 *
 * **It is quadratic.** The database must produce and discard every skipped row
 * to honor an offset, so walking n rows in pages of p costs O(n²/p). On a
 * 2M-row table the last pages were measured at ~1.1 s each against ~0.09 s for
 * the first. A seek starts each page at the cursor, so every page costs the
 * same: O(n) for the walk, and index-served throughout.
 *
 * # What it requires
 *
 * A column that is **unique and orderable** — `id` by default, which every
 * object this driver-managed platform creates carries. An object without one
 * (a federated table, ADR-0015) cannot be walked this way; callers that scan
 * arbitrary registry objects already skip what they cannot read, and that is
 * the correct outcome here too rather than a silent partial scan.
 *
 * # Shape
 *
 * `read` is the caller's own query — this owns the loop, the cursor and the
 * `where` merge, and nothing else. Deliberately one implementation rather than
 * the six hand-rolled copies it replaces: the cursor merge is the part that is
 * easy to get subtly wrong (an object whose own `where` already constrains the
 * key), and six copies of it drift silently.
 *
 * @example
 * const walk = keysetWalk<Row>(
 *   (q) => engine.find('sys_approval_request', { ...q, fields: ['id'], context: SYSTEM_CTX }),
 *   { where: { status: 'pending' }, pageSize: 500 },
 * );
 * for await (const page of walk.pages()) { … }
 * if (walk.truncated) { … }
 */

/** The query a {@link keysetWalk} hands its reader: the caller's `where`, narrowed by the cursor. */
export interface KeysetPageQuery {
  /** The caller's `where`, AND-ed with the seek predicate once the walk has a cursor. */
  where?: unknown;
  /** Always ascending on the key column — the walk's order IS the seek order. */
  orderBy: Array<{ field: string; order: 'asc' }>;
  /** Page size. */
  limit: number;
}

export interface KeysetWalkOptions {
  /** The caller's filter, applied to every page. */
  where?: unknown;
  /** Rows per page. */
  pageSize: number;
  /**
   * Stop after this many rows and set {@link KeysetWalk.truncated}. Omit for an
   * unbounded walk. A cap is not a failure — it is how a scan bounds its own
   * cost — but it must be reported, or a partial scan reads as a complete one.
   */
  max?: number;
  /** Unique, orderable column to seek on. Defaults to `id`. */
  key?: string;
}

export interface KeysetWalk<T> {
  /** Pages, in key order, until the source is exhausted or `max` is reached. */
  pages(): AsyncGenerator<T[]>;
  /** Rows yielded so far. */
  readonly scanned: number;
  /** True when `max` stopped the walk before the source was exhausted. */
  readonly truncated: boolean;
}

/**
 * AND the seek predicate onto the caller's filter.
 *
 * Uses `$and` rather than spreading the key into the same object: a caller
 * whose own `where` already constrains the key column (`{ id: { $in: [...] } }`)
 * would otherwise have that constraint silently overwritten by the cursor, and
 * the walk would return rows the caller excluded. `$and` composes instead of
 * colliding, and every driver executes it.
 */
function withCursor(where: unknown, key: string, cursor: unknown): unknown {
  const seek = { [key]: { $gt: cursor } };
  if (where == null) return seek;
  if (typeof where === 'object' && Object.keys(where as object).length === 0) return seek;
  return { $and: [where, seek] };
}

/**
 * Walk an object by seeking past the last key rather than counting from the
 * start. See the module comment for why every batch scan should.
 *
 * `read` receives a {@link KeysetPageQuery} and returns the page; the caller
 * owns everything else about the query (projection, context, object name).
 */
export function keysetWalk<T extends Record<string, unknown>>(
  read: (query: KeysetPageQuery) => Promise<T[]>,
  options: KeysetWalkOptions,
): KeysetWalk<T> {
  const key = options.key ?? 'id';
  const pageSize = options.pageSize;
  let scanned = 0;
  let truncated = false;

  async function* pages(): AsyncGenerator<T[]> {
    let cursor: unknown = undefined;
    for (;;) {
      const want = options.max == null ? pageSize : Math.min(pageSize, options.max - scanned);
      if (want <= 0) {
        truncated = true;
        return;
      }

      // When `max` clips this page, ask for ONE more row than we will yield.
      // That extra row is the difference between "the cap stopped us" and "the
      // source ended at exactly the cap" — without it a walk that read
      // everything still reports `truncated`, and a caller acting on that goes
      // looking for rows that were never withheld.
      const clipped = options.max != null && want < pageSize;
      const page = await read({
        where: cursor === undefined ? options.where : withCursor(options.where, key, cursor),
        orderBy: [{ field: key, order: 'asc' }],
        limit: clipped ? want + 1 : want,
      });
      if (!Array.isArray(page) || page.length === 0) return;

      const overflow = clipped && page.length > want;
      const emit = overflow ? page.slice(0, want) : page;
      scanned += emit.length;
      yield emit;

      if (overflow) {
        truncated = true;
        return;
      }

      const last = emit[emit.length - 1]?.[key];
      // A row without the key column cannot advance the cursor, and continuing
      // would re-read the same page forever. Stop and report it as truncation
      // rather than spin: a walk that cannot seek is not a walk that finished.
      if (last === undefined || last === null) {
        truncated = true;
        return;
      }
      // The same stop for a reader that did not APPLY the seek — the cursor
      // comes back no further along than it went in, so the next page would be
      // this page again, forever. Production drivers execute the predicate;
      // a test double or a future reader that quietly drops it would otherwise
      // hang rather than fail, and a hang is the one failure nobody can read.
      if (cursor !== undefined && !(String(last) > String(cursor))) {
        truncated = true;
        return;
      }
      cursor = last;

      // A short page means the source is exhausted.
      if (emit.length < want) return;
      // Reaching the cap on a full, unclipped page: more rows may remain, and
      // the next iteration's `want <= 0` reports that as truncation.
      if (options.max != null && scanned >= options.max && !clipped) continue;
      if (options.max != null && scanned >= options.max) return;
    }
  }

  return {
    pages,
    get scanned() {
      return scanned;
    },
    get truncated() {
      return truncated;
    },
  };
}
