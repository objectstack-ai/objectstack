// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7598] Both of this package's SQL-lowering doors answer a `{ $field }`
 * comparand the same way — a loud refusal — instead of binding the reference
 * object as a value.
 *
 * ## What was actually wrong, which is NOT what the issue said
 *
 * #7598 was filed reading "`service-analytics`' compilers still REFUSE `$field`,
 * so a CEL field-to-field RLS rule 400s on those faces". Measured on
 * `origin/main` (`5823d593d`) before any change here, nothing 400'd. For the six
 * scalar comparison operators — exactly the ones #5222 taught `driver-sql` to
 * compile — both doors COMPILED, and bound the reference object as the
 * comparison's value:
 *
 * | face | `{ amount: { $gt: { $field: 'budget' } } }` |
 * |---|---|
 * | `read-scope-sql` | `"person"."amount" > ?` · bind list `[{"$field":"budget"}]` |
 * | analytics `where` → `NativeSQLStrategy` | `WHERE amount > $1` · bound to the JSON TEXT `{"$field":"budget"}` |
 * | analytics `where` → `/analytics/sql` echo | `WHERE amount > $1` · bound to the reference OBJECT |
 * | analytics `where` → ObjectQL engine | `{amount:{$gt:{$field:'budget'}}}` — reached `driver-sql`, which compiles it CORRECTLY since #5222 |
 *
 * So the defect was a silent wrong answer, not a refusal: a syntactically
 * perfect predicate comparing a column against a value no row can hold. On the
 * read-scope door that is an ADMIN's RLS predicate quietly answering the wrong
 * row set, which is why it is graded above the `where` door's empty chart. The
 * gates that were assumed to be catching this — `isBindableComparand` /
 * `isRenderableTextComparand` — were never ASKED about that position: both doors
 * consult them for the LIKE family and for `$in`/`$nin`/`$between` MEMBERS only.
 * They had not drifted from `driver-sql`; they were answering a different
 * question.
 *
 * ## The corpus is the shared one, driven through both faces
 *
 * `CROSS_FIELD_CASES` / `CROSS_FIELD_REFUSALS` are exported from
 * `@objectstack/driver-sql` (`cross-field-conformance-cases.ts`) precisely so a
 * second face can be held to the same table, and this suite is that second
 * consumer. Held here in the direction the measurement supports: **every case in
 * both arms is REFUSED on both analytics doors.** The supported arm's refusals
 * are the asymmetry #7598 exists to record, stated as an executable fact — when
 * the capability lands here, those cases flip from "refused" to row sets and
 * this file is what says so.
 *
 * ⚠️ Corpus `messageIncludes` are deliberately NOT asserted: those pin
 * `driver-sql`'s wordings, and this package's refusals are its own (a driver
 * message naming `initObjects` declarations would be a lie here). The envelope
 * is asserted for every case; the wordings are asserted separately, per door,
 * against the sentences `comparand-shape.ts` owns.
 *
 * ## Reverse verification — direction predicted BEFORE running it
 *
 * Plain before-green / after-red, with one predicted asymmetry. Removing the two
 * `assertNoFieldReferenceComparand` call sites must:
 *
 *   - turn every case in the `$field`-in-a-scalar-comparand blocks RED, and red
 *     by RESOLVING rather than by throwing something else — which is why
 *     `refusalOf` reports "returned" rather than letting a bare `toThrow` count
 *     a differently-caused throw as a pass;
 *   - leave the LIKE-family and list-member blocks GREEN, because those refusals
 *     predate this change and come from the #5234 gates. That half is the proof
 *     the new gate is NARROW rather than merely present.
 *
 * Measured with both call sites disabled, over this file and
 * `comparand-shape-refusal.test.ts` together: **87 failed / 47 passed**, and
 * every failure reads `expected the compiler to refuse this filter, but it
 * returned …` — the predicted cells, failing in the predicted MANNER rather than
 * by some other throw. Both halves of the prediction held under a targeted
 * re-read of the output:
 *
 *   - not one LIKE-family or `$in` / `$nin` corpus case went red, so the new
 *     gate is proven NARROW and those refusals are proven to come from the
 *     #5234 gates rather than from this one;
 *   - the two `$between`-endpoint cases went red on the `where` door only. On
 *     the read-scope door they stayed green, because `assertCompilableMembers`
 *     already refused them there — which is exactly why `$between` had to be
 *     named on the `where` door: its branch in `fieldLeaves` lowers to `gte` /
 *     `lte` before any shape gate is consulted, so it was the one comparand
 *     position on that door no gate had ever seen;
 *   - `comparand-shape-refusal.test.ts` stayed green in full (1 file failed, 1
 *     passed), confirming nothing in the #5234 pins depends on this change.
 *
 * ## The one cell that did NOT refuse on the `where` door — CLOSED by #7693
 *
 * This file used to end in a RECORDED GAP block: `$icontains` was absent from
 * `comparand-shape.ts`'s `TEXT_PATTERN_OPERATORS`, so the analytics `where`
 * door applied NO comparand-shape gate to it at all — a #5234-class hole that
 * arrived with the operator itself (#6520 added `$icontains` to
 * `MONGO_TO_CUBE_OP` and to `read-scope-sql`'s `assertRenderableText`, but not
 * to that set). #7598 left it alone deliberately and filed it as #7693.
 *
 * #7693 added the entry, so the pin FLIPPED: the block at the bottom now
 * asserts the refusal it used to record the absence of, and the corpus loop
 * below no longer has to filter the operator out of `CROSS_FIELD_REFUSALS`.
 *
 * Reverse-verified by deleting the entry again and re-running the WHOLE
 * package: **5 failed / 1553 passed** (green: 1558 / 0). The five are exactly
 * the `where`-door cells — the three new ones here, this file's now-unfiltered
 * corpus case, and `comparand-shape-refusal.test.ts`'s fifth loop member. What
 * stayed GREEN is the other half of the proof: every read-scope `$icontains`
 * assertion (that door's refusal comes from its own `assertRenderableText`, not
 * from this entry), and every narrowness control below — a well-formed
 * `$icontains` comparand compiles identically in both states, so the entry is
 * shown to close a hole rather than retire the operator #6520 added.
 */

import { describe, it, expect } from 'vitest';
import {
  CROSS_FIELD_CASES,
  CROSS_FIELD_REFUSALS,
} from '@objectstack/driver-sql';
import type { FilterCondition } from '@objectstack/spec/data';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import {
  CROSS_FIELD_COMPARISON_OPERATORS,
  isFieldReference,
} from '../comparand-shape.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * A refusal, or a failure that names the direction. `toThrow()` alone would let
 * a differently-caused throw count as a pass, and — the direction that actually
 * bites here — would report "the promise resolved" as the whole diagnosis when
 * the defect is a compiler that RETURNS a predicate it should not have built.
 */
function refusalOf(run: () => unknown): WireBearingError {
  let returned: unknown;
  try {
    returned = run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error(
    `expected the compiler to refuse this filter, but it returned ${JSON.stringify(returned)}`,
  );
}

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where } as any);
const scope = (where: unknown) => compileScopedFilterToSql(where as FilterCondition, 'deal');

/** Does this filter put a reference in a position #5222 made the drivers COMPILE? */
function usesScalarCrossField(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return false;
  if (Array.isArray(filter)) return filter.some(usesScalarCrossField);
  return Object.entries(filter as Record<string, unknown>).some(([key, value]) => {
    if (CROSS_FIELD_COMPARISON_OPERATORS.has(key) && isFieldReference(value)) return true;
    return usesScalarCrossField(value);
  });
}

// ── The shared corpus, through both doors ────────────────────────────────────

describe("[#7598] the #5222 corpus's SUPPORTED arm is refused by both analytics doors", () => {
  // Every case here RETURNS ROWS on `driver-sql` / `driver-sqlite-wasm`. That
  // these same filters are refused two doors away IS the asymmetry #7598
  // records — pinned so it cannot be closed, or widened, without this file
  // saying so.
  for (const testCase of CROSS_FIELD_CASES) {
    it(`the \`where\` door refuses: ${testCase.name}`, () => {
      const err = refusalOf(() => tree(testCase.filter));
      expect(err.code, testCase.name).toBe('INVALID_FILTER');
      expect(err.status, testCase.name).toBe(400);
      expect(err.message, testCase.name).toContain('$field');
    });

    it(`the read-scope door refuses: ${testCase.name}`, () => {
      const err = refusalOf(() => scope(testCase.filter));
      expect(err.code, testCase.name).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err.status, testCase.name).toBe(500);
      expect(err.message, testCase.name).toContain('read-scope-sql');
      expect(err.message, testCase.name).toContain('$field');
    });
  }
});

describe("[#7598] the #5222 corpus's REFUSAL arm stays refused on both doors", () => {
  // These are refused on the drivers too, so this block asserts CONVERGENCE
  // rather than asymmetry.
  //
  // [#7693] The corpus is driven WHOLE. It used to be filtered — `$icontains`
  // was the single exception on the `where` door, because it was missing from
  // `TEXT_PATTERN_OPERATORS` — and dropping that filter is half of this card's
  // proof: `$icontains against a field reference is refused` is a corpus case
  // that only passes here once the entry exists.
  for (const testCase of CROSS_FIELD_REFUSALS) {
    it(`the \`where\` door refuses: ${testCase.name}`, () => {
      const err = refusalOf(() => tree(testCase.filter));
      expect(err.code, testCase.name).toBe('INVALID_FILTER');
      expect(err.status, testCase.name).toBe(400);
    });

    it(`the read-scope door refuses: ${testCase.name}`, () => {
      const err = refusalOf(() => scope(testCase.filter));
      expect(err.code, testCase.name).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err.status, testCase.name).toBe(500);
    });
  }

  it('the two arms are answered by DIFFERENT gates, not by one blanket refusal', () => {
    // Otherwise every assertion above would hold for a compiler that refused
    // `{$field}` everywhere with one sentence — which is the thing #5240 says
    // sends an operator to the wrong repair. The supported arm hits the new
    // capability gate; the LIKE family and list members keep the #5234 wordings.
    expect(refusalOf(() => tree({ amount: { $gt: { $field: 'budget' } } })).message)
      .toContain('does not compile into a column-to-column comparison');
    expect(refusalOf(() => tree({ stage: { $contains: { $field: 'owner' } } })).message)
      .toContain('StringOperatorSchema');
    expect(refusalOf(() => tree({ amount: { $in: [{ $field: 'budget' }, 1] } })).message)
      .toContain('cannot be bound as a SQL parameter');
    expect(refusalOf(() => scope({ amount: { $gt: { $field: 'budget' } } })).message)
      .toContain('does not compile into a column-to-column comparison');
    expect(refusalOf(() => scope({ stage: { $contains: { $field: 'owner' } } })).message)
      .toContain('StringOperatorSchema');
    expect(refusalOf(() => scope({ amount: { $in: [{ $field: 'budget' }, 1] } })).message)
      .toContain('cannot be bound as a SQL parameter');
  });

  it('every corpus case that uses a SCALAR cross-field position is covered', () => {
    // The corpus is imported, so a case added upstream arrives here silently.
    // This asserts the two arms between them really do exercise the position
    // this card is about — a corpus that drifted to zero such cases would leave
    // every loop above vacuously green (#5821's empty-input-set class).
    const covered = [...CROSS_FIELD_CASES, ...CROSS_FIELD_REFUSALS]
      .filter((c) => usesScalarCrossField(c.filter));
    expect(covered.length).toBeGreaterThan(20);
  });
});

// ── What the refusal replaced: nothing binds any more ────────────────────────

describe('[#7598] the reference object never reaches a bind list again', () => {
  // The defect was not "an error was missing" — it was a VALUE in the bind list.
  // Asserting the throw alone would stay green for a compiler that threw after
  // pushing the comparand, which is the exact `params`-alignment hazard both
  // modules' headers warn about (#5297).
  it('read-scope: a refusal leaves no partially-bound predicate behind', () => {
    for (const filter of [
      { amount: { $gt: { $field: 'budget' } } },
      { $and: [{ stage: 'won' }, { amount: { $eq: { $field: 'budget' } } }] },
      { $not: { amount: { $gt: { $field: 'budget' } } } },
    ]) {
      const err = refusalOf(() => scope(filter));
      expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    }
  });

  it('read-scope: the identical filter with a LITERAL comparand still compiles', () => {
    // The narrowness control for this door: only the reference shape moved.
    expect(scope({ amount: { $gt: 5 } })).toEqual({
      sql: '"deal"."amount" > ?',
      params: [5],
    });
  });

  it('`where` door: the identical filter with a LITERAL comparand still compiles', () => {
    expect(tree({ amount: { $gt: 5 } })).toEqual({
      kind: 'leaf', member: 'amount', operator: 'gt', values: [5],
    });
  });

  it('a `$between` with literal bounds still lowers to its two leaves', () => {
    // `$between` is the position no shape gate on the `where` door ever saw, so
    // its narrowness control is worth stating explicitly.
    expect(tree({ amount: { $between: [1, 9] } })).toEqual({
      kind: 'and',
      children: [
        { kind: 'leaf', member: 'amount', operator: 'gte', values: [1] },
        { kind: 'leaf', member: 'amount', operator: 'lte', values: [9] },
      ],
    });
    expect(scope({ amount: { $between: [1, 9] } }).params).toEqual([1, 9]);
  });
});

// ── The gate keys on the SHAPE, not on "an object" ───────────────────────────

describe('[#7598] the field-reference shape is read exactly as `driver-sql` reads it', () => {
  it('extra keys do not disqualify a reference — `formula` ignores them too', () => {
    const err = refusalOf(() => tree({ amount: { $gt: { $field: 'budget', extra: 1 } } }));
    expect(err.code).toBe('INVALID_FILTER');
    // #5222 measured this cell driver-side and moved its own test to the
    // supported arm for it: a narrower reading would let the remainder be
    // re-bound as a literal on one face and ignored on another.
    expect(err.message).toContain('budget');
  });

  it('a NON-STRING `$field` is not a reference — it stays the object account', () => {
    // `driver-sql`'s `fieldReferenceOf` requires `typeof ref === 'string'`, and
    // this package mirrors that spelling rather than inventing a third reading.
    expect(tree({ amount: { $gt: { $field: 5 } } })).toEqual({
      kind: 'leaf', member: 'amount', operator: 'gt', values: [{ $field: 5 }],
    });
    expect(scope({ amount: { $gt: { $field: 5 } } }).params).toEqual([{ $field: 5 }]);
  });

  it('an ordinary object comparand is untouched — #5234 left that account open', () => {
    expect(tree({ amount: { $eq: { a: 1 } } })).toEqual({
      kind: 'leaf', member: 'amount', operator: 'equals', values: [{ a: 1 }],
    });
  });
});

// ── The path this refusal deliberately does NOT touch ────────────────────────

describe('[#7598] a read scope keeps working on the ObjectQL engine path', () => {
  const CUBE: Cube = {
    name: 'deals',
    title: 'Deals',
    sql: 'deal',
    measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
    dimensions: {
      id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
      amount: { name: 'amount', label: 'Amount', type: 'number', sql: 'amount' },
      budget: { name: 'budget', label: 'Budget', type: 'number', sql: 'budget' },
    },
    public: false,
  } as unknown as Cube;

  it('the reference reaches `engine.aggregate` intact, never `read-scope-sql`', async () => {
    // Load-bearing for `read-scope-sql`'s header claim that this change refuses
    // a shape without removing the one path that serves it. `ObjectQLStrategy`
    // ANDs the scope into the `FilterCondition` it hands the engine, so the
    // reference travels to `driver-sql` — which compiles it under the four #5222
    // rulings, with the declared-field and tenant-column metadata it owns and
    // this package does not.
    let seen: unknown;
    const ctx = {
      getCube: (n: string) => (n === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getReadScope: () => ({ amount: { $gt: { $field: 'budget' } } }),
      executeAggregate: async (_o: string, opts: { filter?: unknown }) => {
        seen = opts.filter;
        return [];
      },
    } as unknown as StrategyContext;

    await new ObjectQLStrategy().execute(
      { cube: 'deals', measures: ['total'], dimensions: ['id'], timezone: 'UTC' } as AnalyticsQuery,
      ctx,
    );
    expect(seen).toEqual({ amount: { $gt: { $field: 'budget' } } });
  });
});

// ── The gap #7598 recorded here, CLOSED by #7693 ─────────────────────────────

describe('[#7693] `$icontains` is fenced on the `where` door, like its four siblings', () => {
  // This block is the FLIPPED #7598 pin. It used to assert that
  // `tree({stage: {$icontains: {$field: 'owner'}}})` RETURNED a leaf, with the
  // read-scope refusal beside it for contrast; the contrast is now a
  // convergence, and the block only goes green when
  // `TEXT_PATTERN_OPERATORS` actually carries the operator.

  it('a `{$field}` comparand is refused on BOTH doors now, not just one', () => {
    const where = refusalOf(() => tree({ stage: { $icontains: { $field: 'owner' } } }));
    expect(where.code).toBe('INVALID_FILTER');
    expect(where.status).toBe(400);
    // The LIKE-family wording, not the #7598 cross-field one: `$icontains` is a
    // pattern operator, so the diagnosis a caller gets is "this position holds
    // the TEXT of a pattern" — the same sentence `$contains` gets, which is what
    // makes the two operators one answer rather than two.
    expect(where.message).toContain('StringOperatorSchema');
    expect(where.message).toContain('$icontains');

    const scoped = refusalOf(() => scope({ stage: { $icontains: { $field: 'owner' } } }));
    expect(scoped.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(scoped.status).toBe(500);
  });

  it('the plain malformed comparand `{foo: 1}` is refused rather than bound as `%[object Object]%`', () => {
    // #5234's own shape, at the operator its fence never reached. Measured
    // pre-fix on `origin/main` @ `b54aaab`: this filter compiled to the leaf
    // `{operator: 'icontains', values: [{foo: 1}]}`, and
    // `NativeSQLStrategy.generateSql` bound `'%[object Object]%'` into a
    // syntactically perfect, parameterised `LIKE` nobody wrote.
    const where = refusalOf(() => tree({ name: { $icontains: { foo: 1 } } }));
    expect(where.code).toBe('INVALID_FILTER');
    expect(where.status).toBe(400);
    expect(where.message).toContain('[object Object]');

    // The envelope `$contains` gets, said about the same shape — the point of
    // the card is that these two rows are now identical apart from the operator.
    const sibling = refusalOf(() => tree({ name: { $contains: { foo: 1 } } }));
    expect(where.code).toBe(sibling.code);
    expect(where.status).toBe(sibling.status);
    expect(where.message.replace('$icontains', '$contains')).toBe(sibling.message);
  });

  it('an ARRAY comparand is refused too — the other half of the #5234 shape', () => {
    const err = refusalOf(() => tree({ name: { $icontains: ['al', 'be'] } }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('an array');
  });

  it('the fence is NARROW — every legitimate `$icontains` comparand still compiles', () => {
    // The control group. `$icontains` reached this door ungated, so a gate that
    // over-reached would silently retire a working operator (#6520's whole
    // subject) rather than close a hole.
    expect(tree({ name: { $icontains: 'admin' } })).toEqual({
      kind: 'leaf', member: 'name', operator: 'icontains', values: ['admin'],
    });
    expect(tree({ name: { $icontains: 5 } })).toEqual({
      kind: 'leaf', member: 'name', operator: 'icontains', values: [5],
    });
    expect(tree({ name: { $icontains: null } })).toEqual({
      kind: 'leaf', member: 'name', operator: 'icontains', values: [null],
    });
    // …and the sibling door is unmoved, which is the no-regression half.
    expect(scope({ name: { $icontains: 'admin' } }).params).toEqual(['%admin%', '\\']);
  });
});
