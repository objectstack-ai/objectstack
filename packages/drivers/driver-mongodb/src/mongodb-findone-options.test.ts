// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#4419 — what `MongoDBDriver.findOne` puts on the wire, asserted
 * without a server.
 *
 * The defect this pins was invisible in the rows: `findOne` used to call
 * `collection.findOne(filter, { session, projection: { _id: 0 } })` — no
 * `sort`, no `skip`, no field projection — so `orderBy`, `offset` and `fields`
 * were dropped between the contract and the wire. An untouched four-document
 * collection comes back in insertion order every time, which happens to be
 * stable, so a row-level assertion can pass against a driver that sorts nothing
 * at all. The `FindOptions` object is where the bug is legible.
 *
 * It runs the shared {@link FINDONE_CASES} twice over:
 *
 *  1. **What was emitted** — the `sort` / `projection` / `skip` handed to
 *     Mongo, including the cases whose expectation is that NO sort was imposed
 *     (#4363), which is not observable in rows at all.
 *  2. **What those options select** — the same cases executed against an
 *     in-process collection that applies them by MongoDB's documented order
 *     (sort → skip → limit → project). This is what makes the expected ids
 *     falsifiable HERE rather than only on a CI runner that can download a
 *     mongod, and it is deliberately narrow: it is checking the case table, not
 *     standing in for the server. `mongodb-findone-query.test.ts` runs the same
 *     table against a real mongod for that.
 *
 * A stand-in more permissive than the real engine turns a suite into a green
 * light for broken code — the hazard #4419 itself calls out. Hence the split:
 * this file never decides whether the driver is correct, only whether the
 * options and the expectations agree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MongoDBDriver } from './mongodb-driver.js';
import { FINDONE_CASES, FINDONE_ROWS, type FindOneRow } from './mongodb-findone-cases.js';

interface Seen { filter: any; options: any }

/** Apply a Mongo sort spec (ordered keys, ±1) to a row list. */
function applySort(rows: FindOneRow[], sort: Record<string, number> | undefined): FindOneRow[] {
  if (!sort) return rows;
  return [...rows].sort((x, y) => {
    for (const [key, dir] of Object.entries(sort)) {
      const a = (x as any)[key];
      const b = (y as any)[key];
      if (a === b) continue;
      return (a < b ? -1 : 1) * (dir as number);
    }
    return 0;
  });
}

/** The `where` shapes {@link FINDONE_CASES} uses, as Mongo would match them. */
function matches(row: FindOneRow, filter: any): boolean {
  for (const [key, cond] of Object.entries(filter ?? {})) {
    const value = (row as any)[key];
    if (cond && typeof cond === 'object' && '$in' in (cond as any)) {
      if (!(cond as any).$in.includes(value)) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

/**
 * A driver wired to a fake `Db` — no connect(), no server. `getCollection` is
 * `this.db.collection(name)`, so replacing `db` is enough to observe every call
 * the real code path makes. (Spying on a Collection does NOT work: the real
 * `getCollection` builds a fresh instance per call, which is what made the
 * first version of this suite pass locally and fail on CI.)
 */
function makeDriver(rows: readonly FindOneRow[] = FINDONE_ROWS) {
  const seen: { findOne: Seen[]; find: Seen[] } = { findOne: [], find: [] };
  const run = (filter: any, options: any) => {
    let out = applySort(rows.filter((r) => matches(r, filter)), options?.sort);
    if (typeof options?.skip === 'number') out = out.slice(options.skip);
    if (typeof options?.limit === 'number') out = out.slice(0, options.limit);
    const projection = options?.projection ?? {};
    const keep = Object.keys(projection).filter((k) => projection[k] === 1);
    if (keep.length === 0) return out.map((r) => ({ ...r }));
    return out.map((r) => Object.fromEntries(keep.map((k) => [k, (r as any)[k]])));
  };
  const collection = {
    findOne: async (filter: any, options: any) => {
      seen.findOne.push({ filter, options });
      return run(filter, { ...options, limit: 1 })[0] ?? null;
    },
    find: (filter: any, options: any) => {
      seen.find.push({ filter, options });
      const out = run(filter, options);
      return { toArray: async () => out };
    },
  };
  const driver = new MongoDBDriver({ url: 'mongodb://unused/', database: 'unused' });
  (driver as any).db = { collection: () => collection };
  return { driver, seen };
}

describe('MongoDBDriver.findOne hands Mongo the whole query (#4419)', () => {
  let driver: MongoDBDriver;
  let seen: { findOne: Seen[]; find: Seen[] };

  beforeEach(() => {
    const made = makeDriver();
    driver = made.driver;
    seen = made.seen;
  });

  const lastFindOne = () => seen.findOne.at(-1)!;

  // ── 1. what the driver emitted ──────────────────────────────────────

  for (const c of FINDONE_CASES) {
    it(`emits the right options — ${c.name}`, async () => {
      await driver.findOne('account', { ...c.query } as any);
      const { options } = lastFindOne();

      // `undefined` here is a real assertion, not an absent one: it is the
      // #4363 carve-out (no order imposed on an unsorted single-row lookup).
      expect(options.sort).toEqual(c.expectSort);
      expect(options.skip).toBe(c.expectSkip);

      if (c.expectKeys) {
        const projected = Object.entries(options.projection ?? {})
          .filter(([, v]) => v === 1)
          .map(([k]) => k);
        expect(new Set(projected)).toEqual(new Set(c.expectKeys));
      }
      expect(options.projection?._id).toBe(0); // never leaks Mongo's own key
    });
  }

  it('translates the predicate, as it always did', async () => {
    await driver.findOne('account', { where: { id: 'a' }, limit: 1 });
    expect(lastFindOne().filter).toMatchObject({ id: 'a' });
  });

  it('the transaction session still rides through', async () => {
    const session = { id: 'sess-1' } as any;
    await driver.findOne(
      'account',
      { where: { id: 'a' }, limit: 1 },
      { transaction: session } as any,
    );
    expect(lastFindOne().options.session).toBe(session);
  });

  // ── 2. what those options select ────────────────────────────────────

  for (const c of FINDONE_CASES) {
    it(`selects the right row — ${c.name}`, async () => {
      const row = await driver.findOne('account', { ...c.query } as any);
      expect(row === null ? null : String((row as any).id)).toBe(c.expectId);
      if (c.expectKeys && row) expect(new Set(Object.keys(row))).toEqual(new Set(c.expectKeys));
    });
  }

  // ── find() is unchanged: the carve-out is findOne-only ──────────────

  it('an unordered PAGED find still gets a deterministic order imposed', async () => {
    await driver.find('account', { limit: 2, offset: 0 });
    expect(seen.find.at(-1)!.options.sort).toEqual({ id: 1 });
  });

  it('an unordered, unpaged find still gets none — that rule is unchanged', async () => {
    await driver.find('account', {});
    expect(seen.find.at(-1)!.options.sort).toBeUndefined();
  });
});
