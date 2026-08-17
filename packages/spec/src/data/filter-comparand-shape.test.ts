// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9228] The comparand-SHAPE door, at the face `parseFilterAST` reaches.
 *
 * The rule ("a list operator takes a list") is #5869's and shipped at the
 * engine's lowering seam, where it covered every query that reaches a driver
 * THROUGH the engine — and nothing else. A caller that lowers a filter with
 * `parseFilterAST` and calls a driver directly met no gate: `InMemoryDriver`'s
 * own conformance suite does exactly that, and so does an embedder. mingo's
 * coercion of a non-array `$in`/`$nin` operand hid it until mingo 7.2.3 removed
 * the coercion; from 7.2.4 on the same input escapes as
 * `TypeError: b.filter is not a function` — no `code`, no `status`, no field
 * name, straight to the caller.
 *
 * This file pins the door at the face itself. The ENGINE's binding of the same
 * one implementation keeps its own suite (`engine-filter-array-lowering.test.ts`,
 * `@objectstack/objectql`), which is what proves the move changed no verdict
 * there.
 */

import { describe, it, expect } from 'vitest';
import { StandardErrorCode } from '../api/errors.zod';
import { parseFilterAST, VALID_AST_OPERATORS } from './filter.zod';
import { assertListComparandShapes } from './filter-comparand-shape';

type Refusal = Error & { code?: string; status?: number };

const refusalOf = (run: () => unknown): Refusal => {
  try {
    run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected the shape door to refuse this filter, but it returned');
};

/**
 * Which `$` operator an authoring spelling lowers to, derived by LOWERING one
 * rather than by reading a table this file would then be a second copy of.
 * A two-element array is legal for all three list operators, so the probe never
 * trips the door it is used to find.
 */
const loweredOperatorOf = (op: string): string | undefined => {
  const lowered = parseFilterAST([['probe', op, ['a', 'b']]]) as Record<string, unknown> | undefined;
  const spec = lowered?.probe;
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return undefined;
  return Object.keys(spec).find((key) => key.startsWith('$'));
};

describe('the list-comparand shape door (#5869) runs inside parseFilterAST (#9228)', () => {
  // ── the escape this card closes ────────────────────────────────────────

  it.each([
    ['in', 'in'],
    ['nin', 'nin'],
    ['not_in', 'not_in'],
    // The spelling the driver-memory vocabulary suite fed a scalar to, which
    // is how the hole was found at all.
    ['notin', 'notin'],
  ])('refuses a scalar comparand on the membership spelling %s', (_label, op) => {
    const err = refusalOf(() => parseFilterAST([['name', op, 'alpha']]));
    // ADR-0112 class 1. BOTH halves, never just "it throws": before this door
    // the same input threw too — a raw mingo `TypeError` with neither field
    // set, which is the failure this assertion has to be able to see.
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  it('refuses the OBJECT passthrough form too, not only the lowered array', () => {
    // `parseFilterAST({...})` returns a FilterCondition unchanged apart from
    // the doors; a direct driver caller hands it exactly this.
    for (const where of [{ name: { $nin: 'alpha' } }, { name: { $in: 'alpha' } }]) {
      const err = refusalOf(() => parseFilterAST(where));
      expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(err.status).toBe(400);
    }
  });

  it.each([
    ['null', { stage: { $in: null } }],
    ['a number', { amount: { $nin: 10 } }],
    ['a plain object', { stage: { $in: { a: 1 } } }],
    ['a Date', { at: { $in: new Date('2026-01-01') } }],
  ])('refuses a comparand that is %s — every non-list, not just strings', (_label, where) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  it.each([
    ['a scalar', [['amount', 'between', 5]]],
    ['a 1-tuple', [['amount', 'between', [1]]]],
    ['a 3-tuple', [['amount', 'between', [1, 2, 3]]]],
  ])('refuses a $between comparand that is %s', (_label, where) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  // ── the wording contract (#5346 / #5348), unchanged by the move ────────

  it('names the operator, the field, what arrived, where, and the fix', () => {
    const err = refusalOf(() => parseFilterAST([['stage', 'not_in', 'won']]));
    expect(err.message).toMatch(/Operator "\$nin"/);
    expect(err.message).toMatch(/field "stage"/);
    expect(err.message).toMatch(/Received string \("won"\)/);
    expect(err.message).toMatch(/where\.stage\.\$nin/);
    expect(err.message).toMatch(/\["won"\]/);
    expect(err.message).toMatch(/"!=" \(\$ne\)/);
    expect(err.message).toMatch(/not_in/);
    expect(err.message).toMatch(/NOT applied/);
    expect(err.message).toMatch(/UNFILTERED result set/);
  });

  it('a spec-level caller gets NO entry-point prefix; a caller that names one keeps it', () => {
    // The `context` parameter is the engine's #5346 wording contract, and it is
    // the reason `@objectstack/objectql` could delegate here without changing a
    // single pinned message. Without one the message starts at its first
    // load-bearing word rather than at a stray ": ".
    expect(refusalOf(() => parseFilterAST([['stage', 'in', 'won']])).message)
      .toMatch(/^Operator "\$in"/);
    expect(refusalOf(() => parseFilterAST([['stage', 'in', 'won']], "find('deal')")).message)
      .toMatch(/^find\('deal'\): Operator "\$in"/);
    expect(refusalOf(() => assertListComparandShapes({ stage: { $in: 'won' } }, "count('deal')")).message)
      .toMatch(/^count\('deal'\): /);
  });

  it('the whole refusal fits under the 500-char client bound (#5423)', () => {
    // `rest-server.ts` truncates a declared-4xx message at 500 before it
    // reaches the client, and the "NOT applied" sentence sits at the END — so
    // an overflow loses exactly the sentence the refusal exists to deliver.
    for (const where of [
      [['stage', 'not_in', 'won']],
      [['stage', 'in', 'won']],
      [['amount', 'between', 5]],
    ]) {
      const err = refusalOf(() => parseFilterAST(where, "find('deal')"));
      expect(err.message.length, JSON.stringify(where)).toBeLessThan(500);
      expect(err.message, JSON.stringify(where)).toMatch(/UNFILTERED result set/);
    }
  });

  it('walks $and / $or / $not, and reports the offender by its own path', () => {
    expect(refusalOf(() => parseFilterAST(['and', ['amount', '>', 5], ['stage', 'nin', 'won']])).message)
      .toMatch(/where\.\$and\[1\]\.stage\.\$nin/);
    expect(refusalOf(() => parseFilterAST({ $not: { stage: { $in: 'won' } } })).message)
      .toMatch(/where\.\$not\.stage\.\$in/);
    expect(refusalOf(() => parseFilterAST({ $or: [{ stage: { $in: 'won' } }] })).message)
      .toMatch(/where\.\$or\[0\]\.stage\.\$in/);
  });

  // ── the reconciliation pin: the message's spelling list vs the vocabulary ─

  it('every AST spelling that lowers to a list operator is refused AND named', () => {
    // The refusal's "Authoring spellings" list is hand-written (deriving it
    // from `AST_OPERATOR_MAP` would be an import cycle — `filter.zod.ts`
    // imports the door). This is what keeps it honest: add `not_in_any` to the
    // vocabulary without adding it to that list and this test says so, in the
    // same edit rather than a release later.
    const membership = [...VALID_AST_OPERATORS].filter((op) => {
      const lowered = loweredOperatorOf(op);
      return lowered === '$in' || lowered === '$nin';
    });
    // Guards the loop from passing vacuously.
    expect(membership.sort()).toEqual(['in', 'nin', 'not_in', 'notin']);
    for (const op of membership) {
      const err = refusalOf(() => parseFilterAST([['name', op, 'alpha']]));
      expect(err.status, op).toBe(400);
      expect(err.message, `"${op}" is refused but the refusal does not name it`)
        .toContain(op);
    }
    // `between` is the third list operator and its own message names its own
    // spelling; it is checked here so a fourth list operator cannot arrive
    // with neither branch covering it.
    expect([...VALID_AST_OPERATORS].filter((op) => loweredOperatorOf(op) === '$between'))
      .toEqual(['between']);
  });

  // ── what must KEEP working — the door is narrow, not merely present ─────

  it('lowers every legal list comparand untouched', () => {
    expect(parseFilterAST([['stage', 'in', ['won', 'lost']]])).toEqual({ stage: { $in: ['won', 'lost'] } });
    expect(parseFilterAST([['stage', 'not_in', ['lost']]])).toEqual({ stage: { $nin: ['lost'] } });
    expect(parseFilterAST([['amount', 'between', [5, 25]]])).toEqual({ amount: { $between: [5, 25] } });
  });

  it('an EMPTY list is a declared predicate, not a malformed one', () => {
    // `$in: []` matches nothing, `$nin: []` matches everything. Arity is not
    // this door's business for membership; only "is it a list at all".
    expect(parseFilterAST({ stage: { $in: [] } })).toEqual({ stage: { $in: [] } });
    expect(parseFilterAST({ stage: { $nin: [] } })).toEqual({ stage: { $nin: [] } });
  });

  it('leaves alone everything it deliberately does not judge', () => {
    // A field spec with no `$` key is a deep-equality / nested-relation
    // comparand, not an operator bag — descending into one would invent a
    // contract no backend agrees with.
    expect(parseFilterAST({ author: { name: 'x' } })).toEqual({ author: { name: 'x' } });
    // A scalar operator carrying an array is answered per driver, not here.
    expect(parseFilterAST({ tags: { $eq: ['a', 'b'] } })).toEqual({ tags: { $eq: ['a', 'b'] } });
    // An implicit-equality array comparand keeps its array-equality semantics.
    expect(parseFilterAST({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] });
    // An unknown `$` key at node level belongs to the by-name refusals
    // downstream, which carry the specific prescription.
    expect(parseFilterAST({ $wat: [{ stage: { $in: ['won'] } }] }))
      .toEqual({ $wat: [{ stage: { $in: ['won'] } }] });
    // Nothing to walk.
    expect(parseFilterAST(undefined)).toBeUndefined();
    expect(parseFilterAST([])).toBeUndefined();
  });

  it('returns the SAME reference on the passthrough path — the door allocates nothing', () => {
    const where = { stage: { $in: ['won'] } };
    expect(parseFilterAST(where)).toBe(where);
  });
});
