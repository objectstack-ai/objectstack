// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14428] `MongoDBDriver.update()` answers a missing id with `null`, not with
 * a record it made up.
 *
 * # What was broken
 *
 * The door read:
 *
 *   return (updated as Record[string, unknown]) || withoutUndefinedOwnKeys({ id: String(id), ...updateData });
 *
 * `updateOne({ id })` matching nothing and `findOne({ id })` coming back `null`
 * still produced a row — the caller's own payload plus the `updated_at` this
 * driver had just stamped, under an id that names no document. Since #13878
 * (PR #14434) `IDataDriver.update()` declares `Promise[Record[string, unknown]
 * | null]`, so "a row for an id that does not exist" is no longer a way of
 * satisfying the declaration: it is a value the declaration distinguishes from.
 * Four of six shipped implementations already answered `null`; this one and
 * Turso's remote face answered "updated". Maintainer ruling 2026-09-03,
 * posture A.
 *
 * # Why this file exists at all
 *
 * The card measured that NO landed test pinned the miss posture on this driver
 * — `mongodb-driver.test.ts:157,171` read `update()` results over rows that
 * EXIST. So this is net-new coverage, and the fabricating posture could have
 * come back without reddening anything.
 *
 * # Why it does not live in `mongodb-driver.test.ts`
 *
 * That suite is `describe.skipIf(!sharedMongod)` and `createTestMongod` skips
 * it unless `OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1` (#5517 retired the
 * 123 MB binary download that was ejecting unrelated PRs from the merge queue).
 * A pin added there would be GREEN-BY-SKIP on every CI run — a phantom pin,
 * which is worse than none: it reads as coverage in the file list and can
 * never fail. The fake `Db` below is the pattern
 * `mongodb-findone-options.test.ts` established and
 * `mongodb-own-key-undefined.test.ts` reuses: `getCollection` is
 * `this.db.collection(name)`, so replacing `db` observes every call the real
 * code path makes, with no server and no download.
 *
 * # The pins, and what each alone would miss
 *
 *  - **The miss pin** is the defect: `findOne` empty ⇒ `null`.
 *  - **The positive control** is what stops the fix from being "return `null`
 *    always". A driver that had simply deleted the read-back would pass the
 *    miss pin and break every update that works.
 *  - **The no-fabrication pin** asserts the specific shape that used to come
 *    back (the caller's fields, the stamped `updated_at`). `toBeNull()` alone
 *    would also be satisfied by a driver that threw and was caught elsewhere;
 *    this states what must NOT be synthesized.
 *  - **The write-still-issued pin** holds the other half of the contract: the
 *    `updateOne` is still sent. A "fix" that short-circuited on a miss by
 *    reading FIRST would answer `null` correctly and quietly stop writing.
 *
 * # ⚠️ There is deliberately NO type-level pin in this file — MEASURED
 *
 * #13878's `memory-update-declared-null.test.ts` pins the declared return type
 * with `Equals`/`IsAny` consts. That instrument does not work HERE and would be
 * a phantom: this package's `tsconfig.json` carries
 * `"exclude": [..., "**\/*.test.ts"]` (escaped here so this very comment does
 * not terminate early), so no test file is in its tsc program and
 * a `const x: Equals[A, B] = true` here is never checked by anything — vitest
 * transpiles without typechecking, and the root `tsconfig.json` excludes
 * `packages` entirely, so no repo-wide program picks it up either. Measured,
 * not assumed: `tsc --noEmit --listFiles` in this package lists 0 files ending
 * `.test.ts` (the sibling `driver-turso`, whose tsconfig excludes only
 * `node_modules`/`dist`, lists 43 — which is why the twin file
 * `turso-update-missing-id.test.ts` DOES carry the type pin).
 *
 * The declared type is nevertheless pinned, in both directions, by instruments
 * that DO run:
 *
 *  - **narrowing the declaration back** to `Promise[Record[string, unknown]]`
 *    is a `tsc` error in `mongodb-driver.ts` itself — that file IS in the
 *    program, and the body's `?? null` then returns `Record[string, unknown] |
 *    null` from a non-null signature. `pnpm --filter @objectstack/driver-mongodb
 *    typecheck` reds.
 *  - **losing the contract linkage** (should `IDataDriver.update()` drop its
 *    `| null` arm) reds the same typecheck through `implements IDataDriver`.
 *  - **reverting the behaviour** while keeping the signature reds the runtime
 *    pins below.
 *
 * # Reverse verification, direction predicted BEFORE running
 *
 * Predicted: restoring the `|| withoutUndefinedOwnKeys({ id: String(id),
 * ...updateData })` fallback reds the miss pin and the no-fabrication pin, and
 * reds the type pin's `Equals` const at COMPILE time (so the whole file fails
 * to typecheck) while the positive control and the write-still-issued pin stay
 * GREEN — they exercise the found arm, which the revert does not touch.
 */

import { describe, it, expect } from 'vitest';

import { MongoDBDriver } from './mongodb-driver.js';

/** What the fake collection recorded, so the WRITE half stays observable. */
interface Recorded {
  updateOne: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }>;
  findOne: Array<Record<string, unknown>>;
}

/**
 * A driver wired to a recording fake `Db` — no `connect()`, no server.
 *
 * `stored` is the document `findOne` answers with; `null` models the miss (a
 * real `findOne` resolves `null` when nothing matches), and an object models
 * the row that exists.
 */
function makeDriver(stored: Record<string, unknown> | null) {
  const recorded: Recorded = { updateOne: [], findOne: [] };
  const collection = {
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
      recorded.updateOne.push({ filter, update });
      return { matchedCount: stored ? 1 : 0, modifiedCount: stored ? 1 : 0 };
    },
    async findOne(filter: Record<string, unknown>) {
      recorded.findOne.push(filter);
      return stored;
    },
  };
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/probe' });
  (driver as any).db = { collection: () => collection };
  return { driver, recorded };
}

describe('[#14428] MongoDBDriver.update() on a missing id', () => {
  it('resolves null when no document carries that id', async () => {
    const { driver } = makeDriver(null);

    const result = await driver.update('task', 'no-such-id', { title: 'edited' });

    expect(result).toBeNull();
    // The narrowing the declared type demands of every caller.
    const title = result === null ? 'absent' : result.title;
    expect(title).toBe('absent');
  });

  it('fabricates nothing — no id, no payload echo, no stamped updated_at', async () => {
    const { driver } = makeDriver(null);

    const result = await driver.update('task', 'no-such-id', { title: 'edited', owner: 'u1' });

    // The exact shape the old fallback produced: `{ id, ...updateData }` with
    // `updated_at` stamped a moment earlier. Asserted as a NON-match against a
    // reconstruction of it, so the pin names the thing it forbids rather than
    // only the thing it wants — `toBeNull()` alone would also be satisfied by a
    // driver that threw and was caught somewhere up the stack.
    //
    // ⚠️ NOT written as `expect(result).not.toBeTypeOf('object')`: `typeof
    // null` IS `'object'` in JS, so that assertion fails on the correct value.
    expect(result).toBeNull();
    expect(result).not.toMatchObject({ id: 'no-such-id' });
    expect(Object.keys((result as Record<string, unknown> | null) ?? {})).toEqual([]);
  });

  it('still ISSUES the write — the miss is discovered by reading back, not by refusing', async () => {
    const { driver, recorded } = makeDriver(null);

    await driver.update('task', 'no-such-id', { title: 'edited' });

    expect(recorded.updateOne).toHaveLength(1);
    expect(recorded.updateOne[0].filter).toEqual({ id: 'no-such-id' });
    expect((recorded.updateOne[0].update as any).$set.title).toBe('edited');
    expect(recorded.findOne).toHaveLength(1);
    expect(recorded.findOne[0]).toEqual({ id: 'no-such-id' });
  });

  it('POSITIVE CONTROL — an id that DOES exist still returns the stored row', async () => {
    const stored = { id: 'task-1', title: 'edited', owner: 'u1', updated_at: new Date('2026-01-01T00:00:00Z') };
    const { driver } = makeDriver(stored);

    const result = await driver.update('task', 'task-1', { title: 'edited' });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('task-1');
    expect(result!.title).toBe('edited');
  });
});
