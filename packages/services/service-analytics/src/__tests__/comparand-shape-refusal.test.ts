// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5234] Both of this package's filter doors refuse a comparand shape they
 * cannot express, instead of compiling it into a nonsense predicate.
 *
 * The defect this pins is `driver-sql`'s (issue #5234 is filed against it), but
 * the same `String()` tolerance had THREE implementations in this repo, and
 * tightening one of them alone would have produced "whichever face took the
 * query is the answer you get" — the split #5146 / #5332 / #5567 each spent a
 * round removing. So the guard lands at this package's two doors as well:
 *
 *   - **`filter-normalizer.ts`'s `fieldLeaves`** — the analytics `where` door,
 *     and the ONLY producer of leaf nodes here, so one refusal covers all three
 *     consumers of the tree: `NativeSQLStrategy` (the statement that executes),
 *     `ObjectQLStrategy.generateSql` (the `/analytics/sql` echo) and
 *     `ObjectQLStrategy.convertFilter` (the engine path).
 *   - **`read-scope-sql.ts`'s `compileOperator`** — the ADR-0021 D-C read-scope
 *     (tenant + RLS) lowering, which compiles a `FilterCondition` that never
 *     passes through the normalizer.
 *
 * # The measured splits this closes
 *
 * Two, both real on `main` before this change:
 *
 * | filter | analytics `where` door | `read-scope-sql` | `driver-sql` |
 * |---|---|---|---|
 * | `{name: {$contains: ['al','be']}}` | `%al%` (reads `values[0]`) | `%al,be%` | `%al,be%` |
 * | `{name: {$contains: {$field: 'x'}}}` | `%[object Object]%` | `%[object Object]%` | REFUSED (#5041) |
 *
 * The first row is one package answering its own question two ways — an array
 * comparand loses every member after the first on one door and is joined with
 * commas on the other. The second is this package binding a pattern for a shape
 * `driver-sql` has refused since #5041.
 *
 * # Reverse verification — direction predicted BEFORE running it
 *
 * Plain before-green / after-red on the guard's removal: each `refusalOf` here
 * resolves rather than throwing if `assertCompilableComparand` (normalizer) or
 * `assertRenderableText` / `assertCompilableMembers` (read scope) are deleted.
 * No inversion and no count-shaped gate is involved. Measured by disabling all
 * three call sites and re-running this file: **17 failed / 8 passed**. The 8 are
 * the `keeps` blocks and the predicate table at the bottom — they are the other
 * half of the proof, pinning that every shape which compiled before still
 * compiles, so the guard is shown to be narrow and not merely present.
 *
 * # Envelopes differ ON PURPOSE, diagnosis does not
 *
 * The analytics door answers `INVALID_FILTER` / 400 — a caller authored that
 * filter. The read scope answers `READ_SCOPE_COMPILE_FAILED` / 500 fail-closed —
 * a policy produced it, and #5367 ruled that route withholds its message. One
 * sentence, two envelopes; `comparand-shape.ts` owns the sentence.
 *
 * # [#7693] The family's fifth member
 *
 * The LIKE-family loops below drive `TEXT_PATTERN_OPERATORS` by name, and they
 * used to name FOUR operators. `$icontains` arrived after this fence (#6520)
 * and got the read-scope door's `assertRenderableText` call but not the entry
 * in that set, so `{name: {$icontains: {foo: 1}}}` reproduced row 2 of the
 * table above exactly — `%[object Object]%` on the `where` door, REFUSED on the
 * read-scope one — one operator with two answers inside one package. #7693
 * added the entry; the loops now name all five, and the `where`-door arm of the
 * `$icontains` row is the case that only passes because of it (the read-scope
 * arm was already green and is here as the no-regression control).
 */

import { describe, it, expect } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';

import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import {
  isBindableComparand,
  isRenderableTextComparand,
} from '../comparand-shape.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

function refusalOf(run: () => unknown): WireBearingError {
  try {
    run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the compiler to refuse this filter, but it returned');
}

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where } as any);
const scope = (where: unknown) => compileScopedFilterToSql(where as FilterCondition, 'person');

// ── The analytics `where` door ───────────────────────────────────────────────

describe('[#5234] the analytics `where` door refuses an uncompilable comparand', () => {
  describe('shape 1 — an `$in` / `$nin` member that cannot be bound', () => {
    it("the issue's repro — `{ status: { $in: ['a', { foo: 1 }] } }`", () => {
      const err = refusalOf(() => tree({ status: { $in: ['a', { foo: 1 }] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('index 1');
      expect(err.message).toContain('$in');
      expect(err.message).toContain('{"foo":1}');
    });

    it('`$nin` too — the direction there is WIDER, not narrower', () => {
      const err = refusalOf(() => tree({ status: { $nin: [{ foo: 1 }] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('index 0');
      expect(err.message).toContain('$nin loses the exclusion');
    });

    it('a nested-array member is refused as well', () => {
      const err = refusalOf(() => tree({ status: { $in: ['a', [1, 2]] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('index 1');
    });
  });

  describe('shape 2 — a LIKE-family comparand with no faithful text rendering', () => {
    // [#7693] `$icontains` is the fifth member — see this file's header.
    for (const op of ['$contains', '$notContains', '$startsWith', '$endsWith', '$icontains'] as const) {
      it(`\`${op}\` refuses an object comparand`, () => {
        const err = refusalOf(() => tree({ name: { [op]: { foo: 1 } } }));
        expect(err.code, op).toBe('INVALID_FILTER');
        expect(err.status, op).toBe(400);
        expect(err.message, op).toContain(op);
        expect(err.message, op).toContain('StringOperatorSchema');
      });
    }

    it('an ARRAY comparand is refused — this door used to silently drop every member but the first', () => {
      const err = refusalOf(() => tree({ name: { $contains: ['al', 'be'] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('an array');
    });

    it('`{$field: …}` is refused here, converging with `driver-sql`', () => {
      // Not a special case: a field reference is an object, and this door had no
      // opinion about objects at all. `driver-sql` has refused it since #5041.
      //
      // ⚠️ [#7598] The convergence claim was re-measured after #5222 gave
      // `driver-sql` a real cross-field compiler, because that change was assumed
      // to have made this comment stale. It did NOT, for THIS case: #5222's
      // boundary admits the six scalar comparison operators and leaves the LIKE
      // family in its refusal arm (`$contains against a field reference is
      // refused` — a column-side LIKE pattern cannot be metacharacter-escaped
      // portably, and an unescaped one is the `%`-matches-every-row bypass). So
      // this pin still converges, verbatim, and is deliberately unchanged.
      //
      // What #5222 DID open is a position neither predicate in
      // `comparand-shape.ts` is ever asked about — the whole comparand of a
      // scalar comparison, which was BOUND rather than refused. That cell is
      // pinned in `cross-field-reference-refusal.test.ts` against the shared
      // corpus, not here, because it is a different question about a different
      // position.
      const err = refusalOf(() => tree({ name: { $contains: { $field: 'status' } } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('$field');
      // The wording stays the LIKE-family one — the #7598 gate deliberately does
      // not reach this operator, so a reader can tell the two refusals apart.
      expect(err.message).toContain('StringOperatorSchema');
    });
  });

  describe('the guard is narrow — every shape that normalised before still does', () => {
    it('keeps the legitimate `$in` member types', () => {
      expect(tree({ status: { $in: ['a', 'b'] } })).toEqual({
        kind: 'leaf', member: 'status', operator: 'in', values: ['a', 'b'],
      });
      expect(tree({ status: { $in: ['a', null, 5, true] } })).toEqual({
        kind: 'leaf', member: 'status', operator: 'in', values: ['a', null, 5, true],
      });
    });

    it('keeps every primitive LIKE comparand, including the two #5526 pinned', () => {
      // `{$contains: 5}` → `%5%` and `{$contains: null}` → `%null%` agree across
      // driver-sql, driver-memory and both faces here. #5526 kept them on
      // purpose; refusing them would have created a split, not closed one.
      expect(tree({ name: { $contains: 5 } })).toEqual({
        kind: 'leaf', member: 'name', operator: 'contains', values: [5],
      });
      expect(tree({ name: { $contains: null } })).toEqual({
        kind: 'leaf', member: 'name', operator: 'contains', values: [null],
      });
      expect(tree({ name: { $startsWith: 'x_' } })).toEqual({
        kind: 'leaf', member: 'name', operator: 'startsWith', values: ['x_'],
      });
    });

    it('`{$eq: {…}}` is deliberately UNTOUCHED — a separate account', () => {
      // #5526 pinned `toSqlBindValue({a:1})` → `'{"a":1}'`. Refusing it is the
      // analytics-side half of #5041, which this change does not open.
      //
      // ⚠️ [#7598] Still true, and now load-bearing in a second way: the
      // field-reference gate added there covers this very operator, so this case
      // is what proves the gate keys on the SHAPE `{$field: <string>}` and not on
      // "an object comparand". A gate that had widened to every object would turn
      // this row red — which is why the row is worth keeping rather than being
      // folded into the block above.
      expect(tree({ name: { $eq: { a: 1 } } })).toEqual({
        kind: 'leaf', member: 'name', operator: 'equals', values: [{ a: 1 }],
      });
      // The same distinction one step finer: `$field` present but NOT a string is
      // the ordinary object account too, exactly as on `driver-sql`, whose
      // `fieldReferenceOf` requires `typeof ref === 'string'`.
      expect(tree({ name: { $eq: { $field: 5 } } })).toEqual({
        kind: 'leaf', member: 'name', operator: 'equals', values: [{ $field: 5 }],
      });
    });
  });
});

// ── The read-scope door ──────────────────────────────────────────────────────

describe('[#5234] the read-scope lowering refuses the same two shapes, fail-closed', () => {
  it('an `$in` object member is refused rather than bound', () => {
    const err = refusalOf(() => scope({ status: { $in: ['a', { foo: 1 }] } }));
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.status).toBe(500);
    expect(err.message).toContain('read-scope-sql');
    expect(err.message).toContain('index 1');
  });

  it('a `$nin` object member is refused — pre-fix that exclusion silently did not happen', () => {
    // `NOT IN ('[object Object]')` excludes nothing. On a tenant/RLS predicate
    // an exclusion that does not happen is over-reach, which is the same reading
    // #5347 / #5324 made on this file.
    const err = refusalOf(() => scope({ status: { $nin: [{ foo: 1 }] } }));
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.message).toContain('index 0');
  });

  it('a `$between` bound is a comparand in its own right', () => {
    const err = refusalOf(() => scope({ score: { $between: [{ a: 1 }, 10] } }));
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.message).toContain('index 0');
  });

  // [#7693] `$icontains` was ALREADY refused on this door — it is in the loop as
  // the no-regression control for the entry added on the other one.
  for (const op of ['$contains', '$notContains', '$startsWith', '$endsWith', '$icontains'] as const) {
    it(`\`${op}\` refuses an object comparand instead of binding '%[object Object]%'`, () => {
      const err = refusalOf(() => scope({ name: { [op]: { foo: 1 } } }));
      expect(err.code, op).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err.status, op).toBe(500);
      expect(err.message, op).toContain(op);
    });
  }

  it('an ARRAY LIKE comparand is refused — the other half of the measured split', () => {
    const err = refusalOf(() => scope({ name: { $contains: ['al', 'be'] } }));
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.message).toContain('an array');
  });

  describe('the guard is narrow here too', () => {
    it('keeps binding every legitimate `$in` member', () => {
      expect(scope({ status: { $in: ['a', null, 7, true] } }).params).toEqual(['a', null, 7, true]);
    });

    it('keeps every primitive LIKE comparand', () => {
      expect(scope({ name: { $contains: 5 } }).params).toEqual(['%5%', '\\']);
      expect(scope({ name: { $contains: null } }).params).toEqual(['%null%', '\\']);
      expect(scope({ name: { $startsWith: '_admin' } }).params).toEqual(['\\_admin%', '\\']);
    });

    it('an empty `$in` / `$nin` still lowers to its boolean constant, not a refusal', () => {
      // The member scan runs AFTER the arity identities (#5134), so the empty
      // list keeps compiling to `1 = 0` / `1 = 1` rather than becoming an error.
      expect(scope({ status: { $in: [] } }).sql).toContain('1 = 0');
      expect(scope({ status: { $nin: [] } }).sql).toContain('1 = 1');
    });
  });
});

// ── The rule itself ──────────────────────────────────────────────────────────

describe('[#5234] the two predicates, stated once', () => {
  it('`isBindableComparand` admits exactly what a driver can bind', () => {
    for (const v of [null, undefined, 'x', 0, 1.5, 9n, true, false, new Date(), new Uint8Array([1])]) {
      expect(isBindableComparand(v), String(v)).toBe(true);
    }
    for (const v of [{}, { a: 1 }, [1, 2], { $field: 'x' }, () => 1]) {
      expect(isBindableComparand(v), JSON.stringify(v) ?? 'fn').toBe(false);
    }
  });

  it('`isRenderableTextComparand` is that set minus binary', () => {
    // A buffer BINDS but renders to nothing a caller meant, which is why the two
    // questions are two predicates rather than one with a flag.
    expect(isBindableComparand(new Uint8Array([1]))).toBe(true);
    expect(isRenderableTextComparand(new Uint8Array([1]))).toBe(false);
    for (const v of [null, undefined, 'x', 0, 9n, true, new Date()]) {
      expect(isRenderableTextComparand(v), String(v)).toBe(true);
    }
    for (const v of [{}, { a: 1 }, [1, 2]]) {
      expect(isRenderableTextComparand(v), JSON.stringify(v)).toBe(false);
    }
  });
});
