// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7597] An equality triple whose comparand is a `{ $field }` reference lowers
 * to the EXPLICIT `$eq`, not to the bare implicit-equality form.
 *
 * ## The defect, as measured on `main`
 *
 * `parseFilterAST` lowered the same authored intent two different ways
 * depending only on how the operator was spelled:
 *
 * | authored | lowered to | fate |
 * |---|---|---|
 * | `['amount', '>', { $field: 'budget' }]` | `{ amount: { $gt: { $field: 'budget' } } }` | works on both paths |
 * | `['amount', '=', { $field: 'budget' }]` | `{ amount: { $field: 'budget' } }` | matches NOTHING, silently |
 *
 * The equality spellings drop the operator because a LITERAL comparand's
 * implicit-equality form is `{ field: value }` — correct for a literal, and for
 * a field reference it produces a field spec whose only key is `$field`. Every
 * consumer reads an all-`$` key set as an OPERATOR SPEC, and no backend
 * implements an operator called `$field`: the in-memory evaluator
 * (`@objectstack/formula` `matches-filter.ts`) dispatches it to `evalOp`, which
 * has no arm for it and returns its fail-closed `false`, so the filter matched
 * no record on the very path that produced it; `driver-sql` saw an operator
 * named `$field` and refused (#5222 gave that refusal wording naming `$eq`).
 *
 * ## What this file pins, and what it deliberately does not
 *
 * The fix branches on the COMPARAND, never on the operator: a literal keeps the
 * implicit-equality lowering it has always had. And it is a change to the ARRAY
 * SUGAR only — a hand-authored `{ amount: { $field: 'budget' } }`
 * `FilterCondition` keeps exactly today's fate on every backend, because the
 * evaluator's unknown-operator posture is #6520's decision and #7597's ruling
 * left it standing.
 *
 * The execution half — that the lowered filter returns the SAME rows in memory
 * and through SQL push-down — lives in the driver suites, where the rows are:
 * `cross-field-conformance-cases.ts`'s authoring arm, run by
 * `sql-driver-cross-field-conformance.test.ts` and its `driver-sqlite-wasm`
 * twin.
 */

import { describe, it, expect } from 'vitest';
import { parseFilterAST, isFilterAST, VALID_AST_OPERATORS } from './filter.zod';

/**
 * The spellings `AST_OPERATOR_MAP` folds onto `$eq` — the whole set the sink
 * reads as implicit equality, and therefore the whole set the defect covered.
 * The vocabulary sweep at the bottom of this file is what keeps this list from
 * silently going short.
 */
const EQUALITY_SPELLINGS = ['=', '==', 'equals', 'eq'] as const;

const REF = { $field: 'budget' } as const;

describe('[#7597] equality triples with a `{ $field }` comparand', () => {
  // ── The fix ───────────────────────────────────────────────────────────────

  for (const op of EQUALITY_SPELLINGS) {
    it(`['amount', '${op}', ref] lowers to the explicit { $eq: ref }`, () => {
      expect(parseFilterAST(['amount', op, REF])).toEqual({
        amount: { $eq: { $field: 'budget' } },
      });
    });
  }

  it('uppercase and mixed-case spellings lower the same way', () => {
    // The sink folds case before it looks the operator up, and a stored view
    // legitimately carries `Equals`. A fix applied to the lowercase branch
    // only would leave the defect alive at a spelling the same authoring tool
    // produces.
    expect(parseFilterAST(['amount', 'EQUALS', REF])).toEqual({ amount: { $eq: REF } });
    expect(parseFilterAST(['amount', 'Eq', REF])).toEqual({ amount: { $eq: REF } });
  });

  it('the reference survives the lowering unchanged, dotted paths included', () => {
    // The sink does not judge the reference — whether a dotted path is
    // COMPILABLE is the driver's call (`driver-sql` refuses one, the memory
    // evaluator walks it), and rewriting or rejecting it here would move that
    // decision to a layer that cannot see the object's fields.
    expect(parseFilterAST(['amount', '=', { $field: 'account.budget' }])).toEqual({
      amount: { $eq: { $field: 'account.budget' } },
    });
  });

  // ── The other spellings are untouched ────────────────────────────────────

  it('an ordering triple still lowers to its own operator', () => {
    expect(parseFilterAST(['amount', '>', REF])).toEqual({ amount: { $gt: REF } });
    expect(parseFilterAST(['amount', 'gt', REF])).toEqual({ amount: { $gt: REF } });
  });

  it('a LITERAL comparand keeps the implicit-equality lowering', () => {
    // The half a comparand-blind fix would have broken: `{ a: 5 }` is the
    // established output for every literal, it is what the drivers'
    // implicit-equality arms read, and #7597 changes none of it. The branch is
    // on the comparand being a field reference, not on the operator.
    expect(parseFilterAST(['amount', '=', 5])).toEqual({ amount: 5 });
    expect(parseFilterAST(['stage', 'equals', 'won'])).toEqual({ stage: 'won' });
    expect(parseFilterAST(['stage', '=', null])).toEqual({ stage: null });
    expect(parseFilterAST(['stage', '=', ['a', 'b']])).toEqual({ stage: ['a', 'b'] });
  });

  it('an object comparand that is NOT a field reference keeps implicit equality', () => {
    // `FieldReferenceSchema` is `{ $field: string }`. An object without that
    // key is an ordinary (deep-equality) comparand and must not be promoted
    // into a `$eq` the drivers would then have to un-recognise.
    expect(parseFilterAST(['author', '=', { name: 'ada' }])).toEqual({ author: { name: 'ada' } });
  });

  it('a `$field` whose value is not a STRING is not a field reference', () => {
    // The predicate matches `driver-sql`'s `fieldReferenceOf`, which requires a
    // string. A non-string carrier is not a reference on ANY path, so it keeps
    // the literal lowering and is refused downstream as the uncompilable
    // object it is — rather than being handed to the drivers as a `$eq`
    // reference they do not recognise.
    expect(parseFilterAST(['amount', '=', { $field: 42 }])).toEqual({ amount: { $field: 42 } });
  });

  // ── The sugar's own structures ───────────────────────────────────────────

  it('the lowering applies at the leaf, so nesting cannot route around it', () => {
    expect(parseFilterAST(['and', ['amount', '=', REF], ['stage', '=', 'won']])).toEqual({
      $and: [{ amount: { $eq: REF } }, { stage: 'won' }],
    });
    expect(parseFilterAST(['or', ['amount', 'eq', REF], ['stage', '=', 'lost']])).toEqual({
      $or: [{ amount: { $eq: REF } }, { stage: 'lost' }],
    });
    expect(parseFilterAST([['amount', '=', REF], ['stage', '=', 'won']])).toEqual({
      $and: [{ amount: { $eq: REF } }, { stage: 'won' }],
    });
  });

  it('`isFilterAST` still accepts the triple — the fix is downstream of the gate', () => {
    // The two functions are a pair: a shape accepted by the gate and lowered
    // to nothing (or to the wrong thing) is how a filter gets DROPPED, which
    // widens the query instead of narrowing it (#3948). The gate reads the
    // OPERATOR, so a comparand change must not move it.
    for (const op of EQUALITY_SPELLINGS) {
      expect(isFilterAST(['amount', op, REF])).toBe(true);
    }
  });

  // ── The vocabulary sweep: no spelling may drop the operator ──────────────

  it('NO operator in the vocabulary lowers a reference comparand to a bare field spec', () => {
    // The drift pin, and the reason this file does not merely list four
    // spellings. The bare form is precisely "the lowered field spec's ONLY key
    // is `$field`" — the shape nothing implements. Sweeping the exported
    // vocabulary means a fifth `$eq` spelling entering `AST_OPERATOR_MAP`
    // cannot re-open the defect at a name this file never heard of.
    const offenders: string[] = [];
    for (const op of VALID_AST_OPERATORS) {
      const lowered = parseFilterAST(['amount', op, REF]) as Record<string, unknown>;
      const spec = lowered?.amount;
      if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
        const keys = Object.keys(spec as Record<string, unknown>);
        if (keys.length === 1 && keys[0] === '$field') offenders.push(op);
      }
    }
    expect(offenders, 'these spellings lower a `{ $field }` comparand to a bare, unimplemented field spec').toEqual([]);
  });
});
