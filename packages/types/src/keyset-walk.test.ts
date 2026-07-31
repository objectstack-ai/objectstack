// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `keysetWalk` — the seek-based batch walk (#4363).
 *
 * The load-bearing cases are the two an offset walk gets wrong, and they are
 * asserted against a fake store that behaves the way a database does:
 *
 *  1. **Mutation during the walk.** A backfill updates every row it reads and a
 *     rebuild deletes; with an offset those shift rows past the cursor and they
 *     are never visited. Here the store is mutated mid-walk and every row must
 *     still be seen exactly once.
 *  2. **The cursor must compose with the caller's filter, not overwrite it.** A
 *     caller whose own `where` constrains the key column must not have that
 *     constraint replaced by the seek predicate — the walk would then return
 *     rows the caller excluded.
 *
 * The rest pins the boundaries a partial scan hides behind: short final page,
 * `max` truncation reported rather than silently passed off as completion, and
 * a keyless row stopping the walk instead of spinning on the same page.
 */

import { describe, it, expect } from 'vitest';
import { keysetWalk, type KeysetPageQuery } from './keyset-walk.js';

interface Row extends Record<string, unknown> {
  id: string;
  status: string;
}

/** Ids are deliberately not in insertion order, so "id order" is visibly chosen. */
const seed = (): Row[] => [
  { id: 'r07', status: 'open' },
  { id: 'r03', status: 'done' },
  { id: 'r11', status: 'open' },
  { id: 'r01', status: 'open' },
  { id: 'r09', status: 'done' },
  { id: 'r05', status: 'open' },
  { id: 'r12', status: 'done' },
  { id: 'r02', status: 'open' },
];

/**
 * A store that executes the subset of the filter language the walk emits:
 * the caller's flat equality `where`, `$and`, and `{ key: { $gt } }`.
 */
function makeStore(rows: Row[]) {
  const matches = (row: Row, where: unknown): boolean => {
    if (where == null) return true;
    const w = where as Record<string, any>;
    if (Array.isArray(w.$and)) return w.$and.every((c: unknown) => matches(row, c));
    return Object.entries(w).every(([field, cond]) => {
      if (cond && typeof cond === 'object' && '$gt' in cond) return String(row[field]) > String(cond.$gt);
      if (cond && typeof cond === 'object' && '$in' in cond) return (cond.$in as unknown[]).includes(row[field]);
      return row[field] === cond;
    });
  };

  return {
    rows,
    read: async (q: KeysetPageQuery): Promise<Row[]> => {
      const key = q.orderBy[0]!.field;
      return rows
        .filter((r) => matches(r, q.where))
        .sort((a, b) => String(a[key]).localeCompare(String(b[key])))
        .slice(0, q.limit);
    },
  };
}

const collect = async (walk: { pages(): AsyncGenerator<Row[]> }) => {
  const seen: string[] = [];
  for await (const page of walk.pages()) seen.push(...page.map((r) => r.id));
  return seen;
};

describe('keysetWalk', () => {
  it('visits every row exactly once, in key order', async () => {
    const store = makeStore(seed());
    const walk = keysetWalk<Row>(store.read, { pageSize: 3 });
    expect(await collect(walk)).toEqual([...seed()].map((r) => r.id).sort());
    expect(walk.scanned).toBe(8);
    expect(walk.truncated).toBe(false);
  });

  it('applies the caller filter to every page', async () => {
    const store = makeStore(seed());
    const walk = keysetWalk<Row>(store.read, { where: { status: 'open' }, pageSize: 2 });
    expect(await collect(walk)).toEqual(['r01', 'r02', 'r05', 'r07', 'r11']);
  });

  it('keeps every row when the walk DELETES as it goes — the offset failure', async () => {
    // An index rebuild deletes what it has processed. With `offset` the
    // remaining rows shift left under the cursor and roughly half are never
    // visited. Seeking past the last key cannot be shifted.
    const store = makeStore(seed());
    const seen: string[] = [];
    const walk = keysetWalk<Row>(store.read, { pageSize: 2 });
    for await (const page of walk.pages()) {
      for (const row of page) {
        seen.push(row.id);
        const at = store.rows.findIndex((r) => r.id === row.id);
        if (at >= 0) store.rows.splice(at, 1);
      }
    }
    expect(seen.sort()).toEqual([...seed()].map((r) => r.id).sort());
    expect(store.rows).toHaveLength(0);
  });

  it('keeps every row when the walk UPDATES as it goes', async () => {
    // A backfill rewrites each row it reads. The key does not move, so the
    // walk does not either.
    const store = makeStore(seed());
    const seen: string[] = [];
    const walk = keysetWalk<Row>(store.read, { pageSize: 3 });
    for await (const page of walk.pages()) {
      for (const row of page) {
        seen.push(row.id);
        row.status = 'processed';
      }
    }
    expect(seen.sort()).toEqual([...seed()].map((r) => r.id).sort());
    expect(store.rows.every((r) => r.status === 'processed')).toBe(true);
  });

  it('composes the cursor with a caller filter on the SAME column, never overwriting it', async () => {
    // The subtle one: spreading the seek into the caller's object would drop
    // this `$in` and hand back rows the caller excluded.
    const store = makeStore(seed());
    const walk = keysetWalk<Row>(store.read, {
      where: { id: { $in: ['r01', 'r05', 'r11'] } },
      pageSize: 2,
    });
    expect(await collect(walk)).toEqual(['r01', 'r05', 'r11']);
  });

  it('reports `max` truncation instead of passing a partial scan off as complete', async () => {
    const store = makeStore(seed());
    const walk = keysetWalk<Row>(store.read, { pageSize: 3, max: 5 });
    const seen = await collect(walk);
    expect(seen).toHaveLength(5);
    expect(walk.scanned).toBe(5);
    expect(walk.truncated).toBe(true);
  });

  it('is NOT truncated when the source ends at exactly `max`', async () => {
    // The source was exhausted at exactly the cap; nothing was withheld, so
    // reporting truncation here would send a caller looking for rows that do
    // not exist. This is what the one-row overshoot probe buys.
    const store = makeStore(seed());
    const walk = keysetWalk<Row>(store.read, { pageSize: 3, max: 8 });
    expect(await collect(walk)).toHaveLength(8);
    expect(walk.truncated).toBe(false);
  });

  it('is truncated when `max` lands exactly on a page boundary with rows left', async () => {
    const store = makeStore(seed());
    const walk = keysetWalk<Row>(store.read, { pageSize: 3, max: 6 });
    expect(await collect(walk)).toHaveLength(6);
    expect(walk.truncated).toBe(true);
  });

  it('stops instead of spinning when the reader ignores the seek', async () => {
    // A reader that drops the `$gt` hands back the same page forever. Before
    // this guard the walk hung — and a hang is the one failure nobody can read
    // off a CI log. It now stops and says it was truncated.
    let calls = 0;
    const walk = keysetWalk<Row>(
      async (q) => {
        calls++;
        if (calls > 50) throw new Error('walk did not terminate');
        return seed().slice(0, q.limit); // seek ignored
      },
      { pageSize: 2 },
    );
    const seen = await collect(walk);
    expect(seen).toHaveLength(4); // two pages, then the cursor failed to advance
    expect(walk.truncated).toBe(true);
    expect(calls).toBeLessThan(5);
  });

  it('stops instead of spinning when a row has no key', async () => {
    const store = makeStore([{ id: 'r01', status: 'open' }, { id: undefined as any, status: 'open' }]);
    const walk = keysetWalk<Row>(
      async (q) => store.rows.slice(0, q.limit),
      { pageSize: 2 },
    );
    const seen = await collect(walk);
    expect(seen).toHaveLength(2);
    expect(walk.truncated).toBe(true);
  });

  it('issues the seek the driver can serve from an index', async () => {
    // The emitted query is the point: ascending on the key, and a `$gt` on it
    // from page two onward. An implementation that kept an offset would still
    // return the right rows here and cost O(n²) doing it, so the query shape
    // is what has to be asserted.
    const store = makeStore(seed());
    const queries: KeysetPageQuery[] = [];
    const walk = keysetWalk<Row>(
      async (q) => {
        queries.push(q);
        return store.read(q);
      },
      { pageSize: 3 },
    );
    await collect(walk);

    expect(queries[0]!.orderBy).toEqual([{ field: 'id', order: 'asc' }]);
    expect(queries[0]!.where).toBeUndefined();
    expect(queries[1]!.where).toEqual({ id: { $gt: 'r03' } });
    expect(queries[2]!.where).toEqual({ id: { $gt: 'r09' } });
    expect(queries.every((q) => !('offset' in q))).toBe(true);
  });

  it('seeks on a caller-chosen key column', async () => {
    const store = makeStore(seed());
    const queries: KeysetPageQuery[] = [];
    const walk = keysetWalk<Row>(
      async (q) => {
        queries.push(q);
        return store.read(q);
      },
      { pageSize: 3, key: 'status' },
    );
    await collect(walk);
    expect(queries[0]!.orderBy).toEqual([{ field: 'status', order: 'asc' }]);
    expect(queries[1]!.where).toEqual({ status: { $gt: 'done' } });
  });
});
