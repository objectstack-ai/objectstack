// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5234] The two comparand shapes #5041 deliberately left open are refused, in
 * the same ADR-0112 envelope every other filter refusal here speaks.
 *
 * `assertCompilableComparand` landed with #5041 (PR #5223) carrying an explicit
 * "Deliberately NOT extended" note about:
 *
 *   1. a non-`$field` OBJECT member of an `$in` / `$nin` list, and
 *   2. an object comparand on the `LIKE` family, which `String()` renders as the
 *      literal `'[object Object]'`.
 *
 * The reason recorded there was that both are fail-closed — they narrow the
 * result set — and therefore a lesser class than the bare `TypeError` #5041
 * measured. **Both halves of that reading were measured wrong on `main` before
 * this change, and the measurements are the fixtures below.**
 *
 * # What the pre-fix driver actually answered
 *
 * `ROWS` deliberately contains a row whose `name` is the literal text
 * `[object Object]` — `r_literal`. It is not a curiosity: it is what turns
 * "returns zero rows" into "returns the WRONG rows", and every LIKE case here is
 * an exact-set assertion against it.
 *
 * | filter | pre-fix answer | why that is not "fail-closed" |
 * |---|---|---|
 * | `{name: {$contains: {}}}` | `['r_literal']` | MATCHED a row. A pattern nobody wrote selected a real record. |
 * | `{name: {$notContains: {}}}` | everything EXCEPT `r_literal` | EXCLUDED a real record for a reason nothing records. |
 * | `{status: {$nin: [{…}]}}` | every row | the exclusion the caller wrote silently did not happen — over-reach, not narrowing. |
 * | `{status: {$in: ['a', {…}]}}` | `['r_a']` | answered exactly as if the second member had never been written. |
 * | `{name: {$contains: ['al','be']}}` | `LIKE '%al,be%'` | while `service-analytics`'s `where` door binds `%al%` for the same filter — a live split, closed by refusing both. |
 *
 * # Reverse verification — direction predicted BEFORE running it
 *
 * Plain **before-green / after-red on the guard's removal**: every `refusalOf`
 * assertion below fails if the two new arms of `assertCompilableComparand` are
 * deleted, because the driver resolves instead of throwing. There is no
 * inversion here (the guard adds arms rather than reordering a `??` chain) and
 * no count-shaped gate downstream, so the two exotic directions #5046 / #5018
 * describe do not apply.
 *
 * Measured by disabling each arm in turn and re-running this file together with
 * `sql-driver-out-of-contract-filter-input.test.ts` (48 tests across the two,
 * re-measured on `main` at d367f03 — i.e. after #6210's `DriverQuery` narrowing):
 *
 *   - LIKE arm disabled → **8 failed / 40 passed**. The eighth is in the other
 *     file: the superseded `{ $startsWith: {} }` pin, which is the point of
 *     having replaced it rather than deleted it.
 *   - member arm disabled → **4 failed / 44 passed** — the `$in`, `$nin`,
 *     nested-array and `$between` cases. The `$field` member case is NOT among
 *     them, and that is the arm ordering being verified rather than a gap:
 *     #5041's cross-field refusal still answers first for that shape.
 *
 * The counts are here because a bare "reverting turns it red" claims nothing
 * checkable — if a later change makes one of these arms unreachable, the count
 * moves and the next reader can see that it did. The FAILURE counts are the
 * load-bearing half; the pass counts drift as neighbouring tests are added (they
 * read 32 / 36 when this file was first written, against 40 tests).
 *
 * The analytics side answers the same way, measured the same way: reverting
 * `read-scope-sql.ts` and `filter-normalizer.ts` to their pre-#5234 `main`
 * versions turns `comparand-shape-refusal.test.ts` **17 failed / 41 passed**.
 * `like-metacharacter-escape.test.ts` stays GREEN under that revert, and that is
 * correct rather than a hole: it pins the two packages' PREDICATES against each
 * other, while this refusal file pins that the doors actually call them. Both
 * are needed — parity with nothing calling it is #4984's dead-rule shape.
 *
 * The row-set assertions are the other half, and they are what makes the
 * refusals meaningful rather than self-referential: `keeps` pins that every
 * comparand shape which WORKS today still works, so the guard is proven narrow
 * and not merely present.
 *
 * # Why primitives are NOT refused
 *
 * `filter.zod.ts` declares the LIKE comparand `z.string()`, so a strict reading
 * would refuse `{$contains: 5}` too. Measured, that is the wrong move: `%5%` is
 * the answer this driver, `driver-memory` and both `service-analytics` faces all
 * give today, and #5526 pinned `{$contains: null}` → `%null%` on purpose. Only
 * OBJECTS — the values for which `String()` has no faithful answer — are
 * refused. `Date` stays accepted for the same reason (`driver-turso`'s
 * allow-list keeps it as its one declared object conversion).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import type { FilterCondition } from '@objectstack/spec/data';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

/**
 * `r_literal` is the decoy that turns every "silently zero rows" claim into a
 * checkable one: it is the row a `'[object Object]'` pattern selects.
 * `r_five` does the same job for the number comparand that must KEEP working.
 */
const ROWS = [
  { id: 'r_a', name: 'alpha', status: 'a' },
  { id: 'r_b', name: 'beta', status: 'b' },
  { id: 'r_literal', name: '[object Object]', status: 'c' },
  { id: 'r_five', name: '5', status: 'd' },
];

describe('[#5234] SqlDriver refuses the two comparand shapes that compiled to a silent nonsense predicate', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'probe',
        fields: {
          id: { type: 'text', name: 'id' },
          name: { type: 'text', name: 'name' },
          status: { type: 'text', name: 'status' },
        },
      } as any,
    ]);
    for (const row of ROWS) await driver.create('probe', row);
  });

  // No `object` key: #6210 narrowed the driver query parameter to `DriverQuery`,
  // whose object is the first argument and nothing else. Kept in step here rather
  // than cast away — a rejection test that builds its query off-contract stops
  // exercising the shape a caller can actually send.
  const find = (where: unknown) =>
    driver.find('probe', { fields: ['id'], where: where as FilterCondition });

  const ids = async (where: unknown): Promise<string[]> =>
    ((await find(where)) as Array<{ id: string }>).map((r) => r.id).sort();

  // ── Shape 1: a non-`$field` object member of an `$in` / `$nin` list ─────────

  describe('shape 1 — an `$in` / `$nin` list member that cannot be bound', () => {
    it("the issue's repro — `{ status: { $in: ['a', { foo: 1 }] } }` — carries the full envelope", async () => {
      const err = await refusalOf(() => find({ status: { $in: ['a', { foo: 1 }] } }));

      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      // The index is the only thing telling the bad entry from its legitimate
      // neighbour, so it is part of the contract, not decoration.
      expect(err.message).toContain('index 1');
      expect(err.message).toContain('$in');
      expect(err.message).toContain('status');
      expect(err.message).toContain('{"foo":1}');
      // Pre-fix this filter RESOLVED with ['r_a'] — the member vanished.
      expect(err).not.toBeInstanceOf(TypeError);
    });

    it('`$nin` is refused too — its pre-fix direction was WIDER, not narrower', async () => {
      // `NOT IN ('[object Object]')` excluded nothing: pre-fix this returned all
      // four rows while claiming to exclude one. On a read-scope lowering that is
      // over-reach (#5347 / #5324), which is why the issue's "fail-closed, lower
      // risk" framing does not survive this case.
      const err = await refusalOf(() => find({ status: { $nin: [{ foo: 1 }] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('index 0');
      expect(err.message).toContain('$nin loses the exclusion');
    });

    it('a nested-ARRAY member is refused with the same message, not a bare bind error', async () => {
      // Pre-fix this one DID throw — but as a raw knex/SQLite `TypeError` with
      // no `code` and no `status`, i.e. exactly the #5041 defect at a different
      // spelling. Same shape, same class, one envelope.
      const err = await refusalOf(() => find({ status: { $in: ['a', [1, 2]] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('index 1');
    });

    it('the `$field` member refusal from #5041 still answers first, unchanged', async () => {
      // A `$field` member is also unbindable, so the two arms overlap. The
      // cross-field message is the more actionable one and must keep winning.
      const err = await refusalOf(() => find({ status: { $in: ['a', { $field: 'name' }] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('Cross-field comparison');
      expect(err.message).toContain('at index 1');
    });

    it('a `$between` bound is a comparand in its own right and gets the same envelope', async () => {
      // Already inside the member scan's radius since #5041 (it scans any array
      // for `$field`); before this change a non-`$field` object there produced a
      // bare bind error instead of a catalogued one.
      const err = await refusalOf(() => find({ status: { $between: [{ a: 1 }, 'z'] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('index 0');
    });

    it('a scalar operator handed an array keeps its OWN message', async () => {
      // The member scan is scoped to $in/$nin/$between precisely so this case
      // does not start reporting "index 0 of its list" for a list `$eq` never
      // takes. This is the pre-#5234 message, unchanged.
      const err = await refusalOf(() => find({ status: { $eq: ['a', { foo: 1 }] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('requires a single comparable value');
      expect(err.message).not.toContain('index');
    });
  });

  // ── Shape 2: an object comparand on the LIKE family ────────────────────────

  describe('shape 2 — a LIKE-family comparand with no faithful text rendering', () => {
    it("the issue's repro — `{ name: { $contains: {} } }` — MATCHED a real row pre-fix", async () => {
      // The pre-fix answer was `['r_literal']`, not `[]`: the fixture stores the
      // exact text `String({})` produces. "Silently zero rows" understated it.
      const err = await refusalOf(() => find({ name: { $contains: {} } }));

      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$contains');
      expect(err.message).toContain('name');
      expect(err.message).toContain('[object Object]');
      // Name the declaration being enforced — this refusal is `z.string()` made
      // real, not a new rule (Prime Directive #12).
      expect(err.message).toContain('StringOperatorSchema');
    });

    // [#5702] This list IS `TEXT_PATTERN_OPERATORS` — the operators whose
    // comparand becomes the TEXT of a LIKE pattern — so it follows that set's
    // membership. `$regex` left it (retired, #4706) and `$icontains` joined it.
    //
    // Re-spelled rather than merely dropped, because the row was pinning a real
    // condition and the new member needs it more, not less: `$icontains` is the
    // one text operator whose comparand is ALSO gated on the validating walk,
    // so without a row here nothing would notice if the two gates ever
    // disagreed about an object. (Which one fires is deliberately not asserted —
    // both answer `INVALID_FILTER` / 400 naming the operator, which is the
    // contract; the walk simply runs first.) The retired spelling's own refusal
    // is pinned in `sql-driver-icontains-and-retired-operators.test.ts`.
    for (const op of ['$contains', '$notContains', '$startsWith', '$endsWith', '$icontains'] as const) {
      it(`\`${op}\` refuses an object comparand`, async () => {
        const err = await refusalOf(() => find({ name: { [op]: { foo: 1 } } }));
        expect(err.code, op).toBe('INVALID_FILTER');
        expect(err.status, op).toBe(400);
        expect(err.message, op).toContain(op);
      });
    }

    it('an ARRAY comparand is refused — it answered two ways inside `service-analytics`', async () => {
      // This driver (and `read-scope-sql`) bind `%al,be%` via `String(array)`;
      // the analytics `where` door reads `values[0]` and binds `%al%`. Refusing
      // it closes a live split rather than opening one.
      const err = await refusalOf(() => find({ name: { $contains: ['al', 'be'] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('an array');
      // NOT reported as a bad list member: `$contains` takes no list.
      expect(err.message).not.toContain('index');
    });

    it('the `$field` refusal from #5041 still answers first on this family too', async () => {
      const err = await refusalOf(() => find({ name: { $contains: { $field: 'status' } } }));
      expect(err.message).toContain('Cross-field comparison');
    });
  });

  // ── The narrowness proof: everything that worked still works ───────────────

  describe('the guard is narrow — every comparand shape that compiled before still does', () => {
    it('`$in` keeps binding every legitimate member type', async () => {
      expect(await ids({ status: { $in: ['a', 'b'] } })).toEqual(['r_a', 'r_b']);
      // null in an IN list is standard SQL and matches nothing — not an error.
      expect(await ids({ status: { $in: ['a', null] } })).toEqual(['r_a']);
      expect(await ids({ status: { $in: ['a', 5, true] } })).toEqual(['r_a']);
      expect(await ids({ status: { $in: ['a', new Date('2020-01-01')] } })).toEqual(['r_a']);
      expect(await ids({ status: { $nin: ['a', 'b', 'c'] } })).toEqual(['r_five']);
    });

    it('a binary member binds — bindable is the test, not "primitive"', async () => {
      // `isBindableComparand` admits `ArrayBuffer.isView`, matching what the
      // write path (`formatInput`) accepts. Refusing it would have been a
      // narrower fence than the driver's own classification.
      expect(await ids({ status: { $in: ['a', new Uint8Array([1, 2])] } })).toEqual(['r_a']);
    });

    it('the LIKE family keeps every primitive comparand, including the two #5526 pinned', async () => {
      expect(await ids({ name: { $contains: 'alp' } })).toEqual(['r_a']);
      // `%5%` — agrees with driver-memory and both analytics faces. #5526 kept
      // this deliberately; refusing it would have created a split.
      expect(await ids({ name: { $contains: 5 } })).toEqual(['r_five']);
      // `%null%`, not `%%`. #5526 converged analytics onto this driver's reading.
      expect(await ids({ name: { $contains: null } })).toEqual([]);
      expect(await ids({ name: { $contains: true } })).toEqual([]);
      expect(await ids({ name: { $startsWith: 'be' } })).toEqual(['r_b']);
      expect(await ids({ name: { $endsWith: 'ta' } })).toEqual(['r_b']);
      // `[object Object]` carries no `a`, so `r_literal` is legitimately kept
      // here — the decoy earns its place on both sides of the partition.
      expect(await ids({ name: { $notContains: 'a' } })).toEqual(['r_five', 'r_literal']);
    });

    it('a `Date` comparand still renders — the one object form the allow-list keeps', async () => {
      // `driver-turso`'s allow-list keeps `Date` as its single declared object
      // conversion, so refusing it here would have forked local from remote.
      await expect(find({ name: { $contains: new Date('2020-01-01') } })).resolves.toEqual([]);
    });
  });
});
