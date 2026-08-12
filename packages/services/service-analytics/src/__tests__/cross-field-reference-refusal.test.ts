// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7598] Where a `{ $field }` comparand is answered in this package, now that
 * the routing ruling has landed — and which refusals survived it.
 *
 * ## What was actually wrong, which is NOT what the issue said
 *
 * #7598 was filed reading "`service-analytics`' compilers still REFUSE `$field`,
 * so a CEL field-to-field RLS rule 400s on those faces". Measured on
 * `origin/main` (`5823d593d`) before any change, nothing 400'd. For the six
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
 * perfect predicate comparing a column against a value no row can hold. The
 * gates that were assumed to be catching it — `isBindableComparand` /
 * `isRenderableTextComparand` — were never ASKED about that position. They had
 * not drifted from `driver-sql`; they were answering a different question.
 *
 * ## Two changes, and this file pins the SECOND one's end state
 *
 * #7694 stopped the bind by REFUSING the shape on both doors — the shipped
 * interim, while the routing question went to the maintainer. **The 2026-08-12
 * ruling (Q1 = B) replaced that with routing**: `NativeSQLStrategy.canHandle`
 * declines a query whose `where` or read scope carries a scalar reference, the
 * query falls through to the ObjectQL/engine path, and `driver-sql` compiles the
 * comparison under the four #5222 rulings with the metadata it owns. The
 * capability is AVAILABLE, and the security rules live in exactly one place.
 *
 * So this file no longer asserts a `where`-door refusal for the supported arm —
 * it asserts the LOWERING that carries the reference to the engine, which is the
 * step the routing depends on. That the rows actually come back is a separate
 * question and a separate suite: `cross-field-engine-fallback.test.ts` runs the
 * whole road against a real SQLite engine. This file is the unit half — what
 * each compiler in this package does with the shape, asserted where it is cheap
 * and exact.
 *
 * ## The refusals that survived, and why each one did
 *
 * Not every `{ $field }` position was routed. Three classes stayed refused HERE,
 * and each converges with `driver-sql`'s own #5222 refusal arm rather than
 * diverging from it:
 *
 *   - the LIKE family (`isRenderableTextComparand`) — a column-side LIKE pattern
 *     cannot be metacharacter-escaped portably;
 *   - `$in` / `$nin` MEMBERS (`isBindableComparand`) — the memory evaluator does
 *     not resolve a reference inside a list either, so there is no semantics to
 *     be equivalent TO;
 *   - `$between` ENDPOINTS, which is the one that had to be argued rather than
 *     inherited. This door LOWERS `$between` into a `gte` leaf and an `lte` leaf,
 *     so a routed endpoint reference would reach the driver wearing an operator
 *     #5222 COMPILES — succeeding here while the identical filter is refused on
 *     both SQL drivers and removed from the spec by #7596. See
 *     `filter-normalizer.ts`'s `assertNoFieldReferenceComparand`.
 *
 * And the read-scope door keeps its refusal WHOLE, in its own envelope: after
 * the ruling its remaining caller is `ObjectQLStrategy.generateSql`, the
 * `/analytics/sql` echo, which has no faithful rendering of the total
 * column-to-column predicate the engine path runs. 「一致的响亮答案,不半渲染」.
 *
 * ## Reverse verification — direction predicted BEFORE running it
 *
 * The predictions, written first:
 *
 *   1. Restoring the scalar arm in `assertCompilableComparand` (i.e. undoing the
 *      ruling) must turn the `where`-door LOWERING assertions below RED **and**
 *      take `cross-field-engine-fallback.test.ts` down with them — because that
 *      gate sits in `fieldLeaves`, the one leaf producer for all three consumers
 *      of the tree, so it refuses the engine path it was meant to route to.
 *      That coupling is the whole reason the arm had to go, so it is the
 *      prediction worth measuring.
 *   2. Removing the `$between` arm must turn ONLY the `$between` cells red here,
 *      and must ALSO make the engine-fallback suite's two `$between` refusal
 *      cells red by RESOLVING — the laundering, demonstrated rather than argued.
 *   3. Removing the `#7598` arm of `operatorIsNullTotal` must turn exactly six
 *      corpus cases red in the fallback suite (three `$ne` class pairs, the
 *      self-`$ne` control, and the two `$not`-of-`$eq` cases) plus one cell
 *      here, and nothing else.
 *
 * Measured — see the PR body for the run output.
 */

import { describe, it, expect } from 'vitest';
import {
  CROSS_FIELD_CASES,
  CROSS_FIELD_REFUSALS,
} from '@objectstack/driver-sql';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import {
  CROSS_FIELD_COMPARISON_OPERATORS,
  findCrossFieldComparand,
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

/** Every leaf comparand the normalizer produced, structure discarded. */
function leafComparands(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, any>;
  if (n.kind === 'leaf') return [...(n.values ?? [])];
  if (n.kind === 'not') return leafComparands(n.child);
  if (Array.isArray(n.children)) return n.children.flatMap(leafComparands);
  return [];
}

/** Does this filter put a reference in a position #5222 made the drivers COMPILE? */
const usesScalarCrossField = (filter: unknown): boolean =>
  findCrossFieldComparand(filter) !== null;

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

// ── The supported arm: routed, not refused ───────────────────────────────────

describe("[#7598] the #5222 corpus's SUPPORTED arm is ROUTED by the `where` door, not refused", () => {
  for (const testCase of CROSS_FIELD_CASES) {
    it(`the \`where\` door lowers it with the reference intact: ${testCase.name}`, () => {
      // The step the routing rests on. `canHandle` declines the query, so the
      // tree this produces is compiled by `ObjectQLStrategy.convertFilter` into
      // the `FilterCondition` `engine.aggregate` receives — and a reference that
      // did not survive THIS lowering could not survive that one. Asserting the
      // comparand rather than the whole tree keeps the assertion about the one
      // thing this file is measuring.
      const refs = leafComparands(tree(testCase.filter)).filter(isFieldReference);
      expect(refs.length, testCase.name).toBeGreaterThan(0);
    });

    it(`the read-scope door still refuses it (the /analytics/sql echo): ${testCase.name}`, () => {
      // Unchanged by the ruling, and deliberately: this lowering's remaining
      // caller is the display echo, which cannot render the total predicate the
      // engine path runs. #7598 Q2 = A kept the #5367 envelope verbatim.
      const err = refusalOf(() => scope(testCase.filter));
      expect(err.code, testCase.name).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err.status, testCase.name).toBe(500);
      expect(err.message, testCase.name).toContain('read-scope-sql');
      expect(err.message, testCase.name).toContain('$field');
    });
  }

  it('the `$eq` spelling reaches the engine as an EXPLICIT `$eq`, not a bare field spec', () => {
    // The one spelling that would have broken silently. `convertFilter`'s
    // `equals` arm returns the comparand BARE for a literal (`{amount: 5}` is
    // implicit equality and every backend reads it), which for a reference
    // produces `{amount: {$field: 'budget'}}` — a field spec whose only key is
    // `$field`, which no backend reads as an equality. That is #7597's defect at
    // the spec's lowering sink, arriving here through a different door; the fix
    // branches on the COMPARAND, exactly as #7597's did.
    expect(engineFilterFor({ amount: { $eq: { $field: 'budget' } } }))
      .toEqual({ amount: { $eq: { $field: 'budget' } } });
    // The literal keeps its implicit-equality lowering — the narrowness control.
    expect(engineFilterFor({ amount: { $eq: 5 } })).toEqual({ amount: 5 });
    // …and the five siblings were never affected: they emit their operator
    // explicitly, so they are asserted as the control that the fix is narrow.
    expect(engineFilterFor({ amount: { $gt: { $field: 'budget' } } }))
      .toEqual({ amount: { $gt: { $field: 'budget' } } });
  });

  it('a scalar reference takes NO null guard — the driver writes the predicate total', () => {
    // The measured interaction that six corpus cases turned on. `$ne`'s
    // negative-polarity totalisation (#5298) is right for a literal — a NULL
    // column must satisfy `$ne: 5` — and WRONG for a reference, whose NULL
    // semantics are decided by the referent as well. Unguarded, `$ne` excludes
    // the both-NULL row, which is what the corpus, both SQL drivers and the
    // memory evaluator all say.
    expect(tree({ amount: { $ne: { $field: 'budget' } } })).toEqual({
      kind: 'leaf', member: 'amount', operator: 'notEquals', values: [{ $field: 'budget' }],
    });
    // …and the literal keeps its guard, unchanged. This pair is the whole claim.
    expect(tree({ amount: { $ne: 5 } })).toEqual({
      kind: 'or',
      children: [
        { kind: 'leaf', member: 'amount', operator: 'notSet', values: [] },
        { kind: 'leaf', member: 'amount', operator: 'notEquals', values: [5] },
      ],
    });
  });
});

/** The `FilterCondition` `ObjectQLStrategy` would hand `engine.aggregate`. */
function engineFilterFor(where: unknown): Record<string, unknown> {
  const strategy = new ObjectQLStrategy() as unknown as {
    applyFilterNode(
      node: unknown,
      cube: Cube,
      filter: Record<string, unknown>,
      conjuncts: unknown[],
    ): void;
  };
  const filter: Record<string, unknown> = {};
  const conjuncts: Record<string, unknown>[] = [];
  strategy.applyFilterNode(tree(where), CUBE, filter, conjuncts);
  if (conjuncts.length) filter.$and = [...((filter.$and as unknown[]) ?? []), ...conjuncts];
  return filter;
}

// ── The refusal arm: split by who answers it ─────────────────────────────────

describe("[#7598] the #5222 corpus's REFUSAL arm — routed, or refused at this door", () => {
  for (const testCase of CROSS_FIELD_REFUSALS) {
    const routed = usesScalarCrossField(testCase.filter);

    it(
      routed
        ? `the \`where\` door ROUTES it to the driver's gate: ${testCase.name}`
        : `the \`where\` door refuses it here: ${testCase.name}`,
      () => {
        if (routed) {
          // The four #5222 rulings — dotted paths, undeclared columns, the
          // tenant-isolation column, the comparison class — are enforced by
          // `driver-sql` with `initObjects` metadata this package cannot see.
          // Re-implementing them here is precisely what the ruling rejected as
          // option A, so this door must pass the shape THROUGH. That the driver
          // then refuses it is asserted end-to-end in
          // `cross-field-engine-fallback.test.ts`.
          expect(leafComparands(tree(testCase.filter)).filter(isFieldReference).length)
            .toBeGreaterThan(0);
          return;
        }
        const err = refusalOf(() => tree(testCase.filter));
        expect(err.code, testCase.name).toBe('INVALID_FILTER');
        expect(err.status, testCase.name).toBe(400);
      },
    );

    it(`the read-scope door refuses: ${testCase.name}`, () => {
      const err = refusalOf(() => scope(testCase.filter));
      expect(err.code, testCase.name).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err.status, testCase.name).toBe(500);
    });
  }

  it('the surviving `where`-door refusals are answered by DIFFERENT gates, each with its own wording', () => {
    // Otherwise every assertion above would hold for a compiler that refused
    // `{$field}` everywhere with one sentence — which is the thing #5240 says
    // sends an operator to the wrong repair.
    expect(refusalOf(() => tree({ stage: { $contains: { $field: 'owner' } } })).message)
      .toContain('StringOperatorSchema');
    expect(refusalOf(() => tree({ amount: { $in: [{ $field: 'budget' }, 1] } })).message)
      .toContain('cannot be bound as a SQL parameter');
    expect(refusalOf(() => tree({ amount: { $between: [{ $field: 'budget' }, 100] } })).message)
      .toContain('may not be a field reference on any backend');
    // …and the scalar position is not refused at all here any more.
    expect(tree({ amount: { $gt: { $field: 'budget' } } })).toEqual({
      kind: 'leaf', member: 'amount', operator: 'gt', values: [{ $field: 'budget' }],
    });
  });

  it('the `$between` refusal names the laundering it prevents, not a bind failure', () => {
    // The repair a `$between` author needs is different from the one a
    // read-scope author needs, so the two sentences are different (#5240 in the
    // direction that separates rather than merges).
    const err = refusalOf(() => tree({ amount: { $between: [0, { $field: 'budget' }] } }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('index 1');
    expect(err.message).toContain('#7596');
    // It points at the spelling that IS served, rather than at "use a literal"
    // alone — the capability exists one operator away.
    expect(err.message).toContain('"$gte"');
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

  it('the routing detector agrees with the operator set it is built from', () => {
    // `findCrossFieldComparand` is what `canHandle` declines on, so a drift
    // between it and `CROSS_FIELD_COMPARISON_OPERATORS` would silently narrow
    // the decline — and a narrowed decline is a silent bind, not an error.
    for (const op of CROSS_FIELD_COMPARISON_OPERATORS) {
      expect(findCrossFieldComparand({ amount: { [op]: { $field: 'budget' } } }), op)
        .toEqual({ op, field: 'amount', ref: 'budget' });
    }
    // …and it finds one however deeply it is nested, because a reference three
    // combinators down still needs the engine path.
    expect(findCrossFieldComparand({
      $or: [{ stage: 'won' }, { $not: { $and: [{ amount: { $gt: { $field: 'budget' } } }] } }],
    })).toEqual({ op: '$gt', field: 'amount', ref: 'budget' });
    // …and it does NOT fire on the positions this door still refuses, which is
    // what keeps those refusals reachable instead of routed past.
    expect(findCrossFieldComparand({ stage: { $contains: { $field: 'owner' } } })).toBeNull();
    expect(findCrossFieldComparand({ amount: { $in: [{ $field: 'budget' }] } })).toBeNull();
    expect(findCrossFieldComparand({ amount: { $between: [{ $field: 'budget' }, 1] } })).toBeNull();
  });
});

// ── What the read-scope refusal replaced: nothing binds any more ─────────────

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
    // #5222 measured this cell driver-side and moved its own test to the
    // supported arm for it: a narrower reading would let the remainder be
    // re-bound as a literal on one face and ignored on another.
    expect(findCrossFieldComparand({ amount: { $gt: { $field: 'budget', extra: 1 } } }))
      .toEqual({ op: '$gt', field: 'amount', ref: 'budget' });
    const err = refusalOf(() => scope({ amount: { $gt: { $field: 'budget', extra: 1 } } }));
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.message).toContain('budget');
  });

  it('a NON-STRING `$field` is not a reference — it stays the object account', () => {
    // `driver-sql`'s `fieldReferenceOf` requires `typeof ref === 'string'`, and
    // this package mirrors that spelling rather than inventing a third reading.
    // It is therefore NOT routed either: it binds as JSON, exactly as any other
    // object comparand does, which is the account #5234 left open on purpose.
    expect(findCrossFieldComparand({ amount: { $gt: { $field: 5 } } })).toBeNull();
    expect(tree({ amount: { $gt: { $field: 5 } } })).toEqual({
      kind: 'leaf', member: 'amount', operator: 'gt', values: [{ $field: 5 }],
    });
    expect(scope({ amount: { $gt: { $field: 5 } } }).params).toEqual([{ $field: 5 }]);
  });

  it('an ordinary object comparand is untouched — #5234 left that account open', () => {
    expect(findCrossFieldComparand({ amount: { $eq: { a: 1 } } })).toBeNull();
    expect(tree({ amount: { $eq: { a: 1 } } })).toEqual({
      kind: 'leaf', member: 'amount', operator: 'equals', values: [{ a: 1 }],
    });
  });
});

// ── The path the routing lands on ────────────────────────────────────────────

describe('[#7598] a read scope reaches the ObjectQL engine path intact', () => {
  it('the reference reaches `engine.aggregate` intact, never `read-scope-sql`', async () => {
    // Load-bearing for `read-scope-sql`'s header claim that its refusal serves
    // the display echo without removing the path that SERVES the rule.
    // `ObjectQLStrategy` ANDs the scope into the `FilterCondition` it hands the
    // engine, so the reference travels to `driver-sql` — which compiles it under
    // the four #5222 rulings, with the declared-field and tenant-column metadata
    // it owns and this package does not.
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
