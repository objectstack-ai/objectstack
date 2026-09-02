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

  // ── the null carve-out, ruled 2026-08-31 (#13357; $between is #13495) ──

  it.each([
    ['$in, lowered array form', [['stage', 'in', [null]]]],
    ['$in, object passthrough', { stage: { $in: [null] } }],
    ['$nin, lowered array form', [['stage', 'not_in', [null]]]],
    ['$nin, object passthrough', { stage: { $nin: [null] } }],
    ['$in with a real neighbour', { stage: { $in: ['won', null] } }],
  ])('refuses a null list MEMBER — %s', (_label, where) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  it.each([
    ['[null, null]', { at: { $between: [null, null] } }],
    ['[null, max]', { at: { $between: [null, '2026-07-15'] } }],
    ['[min, null]', { at: { $between: ['2026-07-01', null] } }],
  ])('refuses a null $between BOUND — %s', (_label, where) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  it('the null-member refusal prescribes the ruling\'s explicit spelling', () => {
    // 2026-08-31: 「等于 X 或为空」的合法拼法是显式的 $or + $null — the
    // refusal must spell it out, in both halves, and still name operator,
    // field, position and authoring spellings (the #5346/#5348 contract).
    const err = refusalOf(() => parseFilterAST({ stage: { $nin: [null] } }));
    expect(err.message).toMatch(/^Operator "\$nin" on field "stage"/);
    expect(err.message).toContain('where.stage.$nin[0]');
    expect(err.message).toContain('{"$or": [{"stage": {"$in": […]}}, {"stage": {"$null": true}}]}');
    expect(err.message).toContain('{"$null": false}');
    expect(err.message).toMatch(/Authoring spellings: nin, not_in, notin/);
    expect(err.message).toMatch(/UNFILTERED result set/);
  });

  it('the null-bound refusal points at the offending index and the working alternatives', () => {
    const err = refusalOf(() => parseFilterAST({ at: { $between: ['2026-07-01', null] } }));
    expect(err.message).toMatch(/^Operator "\$between" on field "at" requires two non-null bounds/);
    expect(err.message).toContain('where.at.$between[1]');
    expect(err.message).toContain('"$gte"/"$lte"');
    expect(err.message).toContain('{"at": {"$null": true}}');
    expect(err.message).toMatch(/UNFILTERED result set/);
  });

  it('a null member is refused at its own path inside $and / $or / $not too', () => {
    expect(refusalOf(() => parseFilterAST({ $not: { stage: { $in: [null] } } })).message)
      .toContain('where.$not.stage.$in[0]');
    expect(refusalOf(() => parseFilterAST({ $or: [{ stage: { $nin: [null] } }] })).message)
      .toContain('where.$or[0].stage.$nin[0]');
  });

  it('refuses ONLY null — falsy and empty-ish members are values, not absence', () => {
    // The carve-out is null-shaped and nothing wider: #5041's and #5234's
    // member questions stand untouched, and every falsy VALUE keeps working.
    expect(parseFilterAST({ n: { $in: [0, false, ''] } })).toEqual({ n: { $in: [0, false, ''] } });
    expect(parseFilterAST({ n: { $nin: [0, false, ''] } })).toEqual({ n: { $nin: [0, false, ''] } });
    expect(parseFilterAST({ at: { $between: ['', ''] } })).toEqual({ at: { $between: ['', ''] } });
    expect(parseFilterAST({ n: { $between: [0, 0] } })).toEqual({ n: { $between: [0, 0] } });
  });

  // ── the ordering carve-out, ruled 2026-09-01 (#14080) ──────────────────

  it.each([
    ['$gt, object passthrough', { n: { $gt: null } }],
    ['$gte, object passthrough', { n: { $gte: null } }],
    ['$lt, object passthrough', { n: { $lt: null } }],
    ['$lte, object passthrough', { n: { $lte: null } }],
    ['$gt, lowered array form (">")', [['n', '>', null]]],
    ['$gte, lowered array form ("gte")', [['n', 'gte', null]]],
    ['$lt, lowered array form ("before")', [['n', 'before', null]]],
    ['$lte, lowered array form ("less_than_or_equal")', [['n', 'less_than_or_equal', null]]],
    ['$gt with a real neighbour in the same bag', { n: { $gte: 0, $gt: null } }],
  ])('refuses a null ORDERING comparand — %s', (_label, where) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  it('the null-ordering refusal prescribes the ruled null predicates', () => {
    // 2026-09-01: 「拒绝信息点名可用拼法(`$eq: null` / `$ne: null` 是已裁的
    // null 谓词)」 — the refusal names both halves, and still names operator,
    // field, position and authoring spellings (the #5346/#5348 contract).
    const err = refusalOf(() => parseFilterAST({ close_date: { $gte: null } }));
    expect(err.message)
      .toMatch(/^Operator "\$gte" on field "close_date" does not accept a null comparand/);
    expect(err.message).toContain('(at where.close_date.$gte)');
    expect(err.message).toContain('{"$eq": null} is "has no value"');
    expect(err.message).toContain('{"$ne": null} is "has a value"');
    expect(err.message)
      .toMatch(/Authoring spellings: >=, gte, greater_than_or_equal, greaterthanorequal, greaterorequal\./);
    expect(err.message).toMatch(/UNFILTERED result set/);
  });

  it('a null ordering comparand is refused at its own path inside $and / $or / $not too', () => {
    expect(refusalOf(() => parseFilterAST({ $not: { n: { $lt: null } } })).message)
      .toContain('where.$not.n.$lt');
    expect(refusalOf(() => parseFilterAST({ $or: [{ n: { $lte: null } }] })).message)
      .toContain('where.$or[0].n.$lte');
    expect(refusalOf(() => parseFilterAST(['and', ['amount', '>', 5], ['n', '<=', null]])).message)
      .toMatch(/where\.\$and\[1\]\.n\.\$lte/);
  });

  it('refuses ONLY null in the ordering slots — the null PREDICATES and every value keep passing', () => {
    // `$eq: null` / `$ne: null` ARE the null predicate (#5332) and are the
    // spellings the refusal prescribes; they must keep passing this face.
    expect(parseFilterAST({ n: { $eq: null } })).toEqual({ n: { $eq: null } });
    expect(parseFilterAST({ n: { $ne: null } })).toEqual({ n: { $ne: null } });
    expect(parseFilterAST({ n: null })).toEqual({ n: null });
    // Every non-null comparand type the slots declare, and the { $field }
    // reference (#5222) — the carve-out is null-shaped and nothing wider.
    expect(parseFilterAST({ n: { $gt: 0 } })).toEqual({ n: { $gt: 0 } });
    expect(parseFilterAST({ n: { $gte: '' } })).toEqual({ n: { $gte: '' } });
    expect(parseFilterAST({ at: { $lt: '2026-07-01' } })).toEqual({ at: { $lt: '2026-07-01' } });
    expect(parseFilterAST({ a: { $lte: { $field: 'b' } } })).toEqual({ a: { $lte: { $field: 'b' } } });
    expect(parseFilterAST([['n', '>', 0]])).toEqual({ n: { $gt: 0 } });
    const day = new Date('2026-07-01T00:00:00.000Z');
    expect(parseFilterAST({ at: { $gt: day } })).toEqual({ at: { $gt: day } });
    // `undefined` stays the TYPE door's refusal, with that door's own sentence
    // — strictly `null` here, so the two messages never compete for one input.
    expect(refusalOf(() => parseFilterAST({ n: { $gt: undefined } })).message)
      .toMatch(/^Filter comparand at where\.n\.\$gt is undefined/);
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
      // The 2026-08-31 null carve-out (#13357/#13495): the prescribed $or +
      // $null spelling makes these the LONGEST messages this door assembles,
      // so they live inside the same unrelaxed bound.
      { stage: { $in: [null] } },
      { stage: { $nin: [null] } },
      { close_date: { $between: [null, null] } },
      { close_date: { $between: ['2026-07-01', null] } },
      // The 2026-09-01 ordering carve-out (#14080): `$gte` / `$lte` carry the
      // longest spelling lists, so they are the tallest of the four.
      { close_date: { $gte: null } },
      { close_date: { $lte: null } },
      { close_date: { $gt: null } },
      { close_date: { $lt: null } },
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

  it('every AST spelling that lowers to an ORDERING operator is refused on null AND named', () => {
    // The same reconciliation for the 2026-09-01 carve-out (#14080): the
    // door's `ORDERING_COMPARAND_OPERATORS` spelling lists are hand-written
    // for the same import-cycle reason, and this is what keeps them honest.
    const ordering = [...VALID_AST_OPERATORS].filter((op) => {
      const lowered = loweredOperatorOf(op);
      return lowered === '$gt' || lowered === '$gte' || lowered === '$lt' || lowered === '$lte';
    });
    // Guards the loop from passing vacuously — twenty spellings, four operators.
    expect(ordering.sort()).toEqual([
      '<', '<=', '>', '>=', 'after', 'before',
      'greater_than', 'greater_than_or_equal', 'greaterorequal', 'greaterthan', 'greaterthanorequal',
      'gt', 'gte',
      'less_than', 'less_than_or_equal', 'lessorequal', 'lessthan', 'lessthanorequal',
      'lt', 'lte',
    ]);
    for (const op of ordering) {
      const err = refusalOf(() => parseFilterAST([['n', op, null]]));
      expect(err.code, op).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(err.status, op).toBe(400);
      expect(err.message, `"${op}" is refused but the refusal does not name it`)
        .toContain(`${op}`);
    }
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
