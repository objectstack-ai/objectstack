// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] The comparand-type door — unit pins for the module itself, and for
 * `parseFilterAST` as the compile face that runs it.
 *
 * The cross-driver pins (each accepted type compiles on every driver path, each
 * refused type gets the loud refusal) live in
 * `filter-comparand-type-conformance.ts` and the five driver suites that
 * import it; this file pins the door's own contract — the set, the envelope,
 * the copy-on-write narrowing, and the boundaries it deliberately does not
 * cross.
 */

import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_FILTER_COMPARAND_TYPES,
  ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE,
  FILTER_COMPARAND_BIGINT_EXACT_LIMIT,
  isAcceptedFilterComparand,
  normalizeFilterComparandTypes,
  parseFilterAST,
  FieldOperatorsSchema,
} from './index';
import { StandardErrorCode } from '../api/errors.zod';

/** The refusal, caught — `toThrow()` alone carries one bit where this needs three (#6142/#6050). */
function refusalOf(fn: () => unknown): (Error & { code?: string; status?: number }) | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
}

class Money {
  constructor(readonly v: number) {}
}

describe('the accepted set (#7872 ruling)', () => {
  it('is exactly the measured superset — string | number | bigint | boolean | null | Date', () => {
    expect([...ACCEPTED_FILTER_COMPARAND_TYPES]).toEqual([
      'string', 'number', 'bigint', 'boolean', 'null', 'Date',
    ]);
    // The sentence the SQL family's refusals quote — byte-identical to the
    // wording driver-turso pinned before the door existed, so reconciling that
    // driver to the door changes no message.
    expect(ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE)
      .toBe('a string, number, bigint, boolean, null or Date');
  });

  it('isAcceptedFilterComparand answers the six types TRUE and the measured divergence rows FALSE', () => {
    for (const v of ['x', 0, 100, NaN, 10n, true, false, null, new Date()]) {
      expect(isAcceptedFilterComparand(v), String(typeof v)).toBe(true);
    }
    for (const v of [undefined, Symbol('x'), () => 1, new Map(), new Set(), new Money(1), {}, { a: 1 }, [1]]) {
      expect(isAcceptedFilterComparand(v), Object.prototype.toString.call(v)).toBe(false);
    }
  });

  it('the door code is the registered ADR-0112 code — the literal cannot drift from the enum', () => {
    // `data/` cannot import `api/` (the reverse edge would be a cycle), so the
    // module spells the literal; this pin is what keeps the two identical.
    const err = refusalOf(() => normalizeFilterComparandTypes({ qty: Symbol('x') }));
    expect(err?.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
  });

  it('the judged operator vocabulary is reconciled against FieldOperatorsSchema — a new operator cannot skip the door silently', () => {
    // The door hardcodes two sets (scalar-comparand + list-comparand) for
    // walk-cost reasons; this pins their union to the schema's own keys.
    const declared = Object.keys(FieldOperatorsSchema.shape).sort();
    const judgedScalar = [
      '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
      '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
      '$like', '$ilike', '$null', '$exists',
    ];
    const judgedList = ['$in', '$nin', '$between'];
    expect([...judgedScalar, ...judgedList].sort()).toEqual(declared);
    // …and behaviourally: every declared scalar slot refuses a Symbol.
    for (const op of judgedScalar) {
      const err = refusalOf(() => normalizeFilterComparandTypes({ qty: { [op]: Symbol('x') } }));
      expect(err?.code, op).toBe('INVALID_FILTER');
      expect(err?.status, op).toBe(400);
    }
  });
});

describe('refusals — the measured divergence rows die at the door', () => {
  // The #7956 matrix rows, at the operator form, the implicit-equality form,
  // and as list members: previously crash (memory × BigInt beyond range),
  // silent zero rows (memory), refusal (SQL family), or a silently EDITED wire
  // document (mongo × undefined → {} = match everything, the worst cell).
  const refused: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['a function', () => 1],
    ['a Symbol', Symbol('x')],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a class instance', new Money(100)],
  ];

  it.each(refused)('refuses %s at the operator form { qty: { $eq: V } }', (_name, value) => {
    const err = refusalOf(() => normalizeFilterComparandTypes({ qty: { $eq: value } }));
    expect(err).not.toBeNull();
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
    expect(err?.message).toContain('where.qty.$eq');
    expect(err?.message).toContain(ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE);
    expect(err?.message).toContain('NOT applied');
    expect(err?.message.length).toBeLessThan(500); // the client bound (#5423)
  });

  it.each(refused)('refuses %s at the implicit-equality form { qty: V } — the mongo worst cell arrives here', (_name, value) => {
    const err = refusalOf(() => normalizeFilterComparandTypes({ qty: value }));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
    expect(err?.message).toContain('where.qty');
  });

  it.each(refused)('refuses %s as an $in member — each member is a comparand in its own right (#5234)', (_name, value) => {
    const err = refusalOf(() => normalizeFilterComparandTypes({ qty: { $in: [100, value] } }));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.message).toContain('where.qty.$in[1]');
  });

  it('the undefined refusal names the accident and the null prescription — it is the one value that arrives by mistake', () => {
    const err = refusalOf(() => normalizeFilterComparandTypes({ owner: undefined }));
    expect(err?.message).toMatch(/undefined/);
    expect(err?.message).toMatch(/null/);
    expect(err?.message).toMatch(/omit/);
  });

  it('refuses a PLAIN OBJECT where a scalar operator comparand belongs — the SQL family already did', () => {
    const err = refusalOf(() => normalizeFilterComparandTypes({ qty: { $eq: { a: 1 } } }));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.message).toContain('a plain object');
  });

  it('refuses inside $and / $or / $not — the walk reaches every literal position', () => {
    for (const filter of [
      { $and: [{ ok: 1 }, { qty: Symbol('x') }] },
      { $or: [{ qty: { $ne: new Map() } }] },
      { $not: { qty: undefined } },
    ]) {
      const err = refusalOf(() => normalizeFilterComparandTypes(filter));
      expect(err?.code, JSON.stringify(Object.keys(filter))).toBe('INVALID_FILTER');
    }
  });

  it('a refusal fires on the FIRST bad comparand and names its path', () => {
    const err = refusalOf(() =>
      normalizeFilterComparandTypes({ $and: [{ a: 1 }, { b: { $in: ['x', Symbol('y')] } }] }));
    expect(err?.message).toContain('where.$and[1].b.$in[1]');
  });
});

describe('bigint — accepted, and NARROWED copy-on-write (#7872; the memory crash cell dies here)', () => {
  it('narrows an exact-range bigint to its number, without touching the caller’s object', () => {
    const original = { qty: { $eq: BigInt(100) } };
    const out = normalizeFilterComparandTypes(original);
    expect(out).toEqual({ qty: { $eq: 100 } });
    expect(typeof (out as any).qty.$eq).toBe('number');
    // Copy-on-write: the caller's bag is not edited under them…
    expect(typeof original.qty.$eq).toBe('bigint');
    // …and a filter with nothing to narrow returns the SAME reference.
    const clean = { qty: { $eq: 100 } };
    expect(normalizeFilterComparandTypes(clean)).toBe(clean);
  });

  it('narrows at the implicit form, inside list members, and under combinators', () => {
    expect(normalizeFilterComparandTypes({ qty: 100n })).toEqual({ qty: 100 });
    expect(normalizeFilterComparandTypes({ qty: { $in: [1n, 2] } })).toEqual({ qty: { $in: [1, 2] } });
    expect(normalizeFilterComparandTypes({ qty: { $between: [1n, 9n] } }))
      .toEqual({ qty: { $between: [1, 9] } });
    expect(normalizeFilterComparandTypes({ $or: [{ qty: { $gt: 5n } }] }))
      .toEqual({ $or: [{ qty: { $gt: 5 } }] });
  });

  it('2^53 itself is the last exact value — accepted on both signs', () => {
    const max = FILTER_COMPARAND_BIGINT_EXACT_LIMIT;
    expect(normalizeFilterComparandTypes({ qty: max })).toEqual({ qty: 2 ** 53 });
    expect(normalizeFilterComparandTypes({ qty: -max })).toEqual({ qty: -(2 ** 53) });
  });

  it('a bigint beyond ±2^53 is refused loudly — precision loss must not answer silently', () => {
    const err = refusalOf(() =>
      normalizeFilterComparandTypes({ qty: FILTER_COMPARAND_BIGINT_EXACT_LIMIT + 1n }));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
    expect(err?.message).toContain('2^53');
    expect(err?.message.length).toBeLessThan(500);
  });
});

describe('boundaries the door deliberately does not cross', () => {
  it('leaves a FieldReference alone at every position — #5222/#7596/#7597 own its fate', () => {
    for (const filter of [
      { amount: { $gt: { $field: 'budget' } } },
      { amount: { $eq: { $field: 'budget' } } },
      { amount: { $field: 'budget' } },
      { amount: { $in: [{ $field: 'budget' }] } },
    ]) {
      expect(normalizeFilterComparandTypes(filter)).toBe(filter);
    }
  });

  it('does not descend into a no-$-key plain object — nested-relation / deep-equality structure (#5869 boundary)', () => {
    const filter = { author: { name: 'x' } };
    expect(normalizeFilterComparandTypes(filter)).toBe(filter);
  });

  it('does not judge arrays outside the list operators — their semantics are per-driver today', () => {
    const filter = { tags: ['a', 'b'] };
    expect(normalizeFilterComparandTypes(filter)).toBe(filter);
    const eq = { tags: { $eq: ['a', 'b'] } };
    expect(normalizeFilterComparandTypes(eq)).toBe(eq);
  });

  it('does not judge an unknown or retired operator’s comparand — the downstream refusals carry the prescriptions', () => {
    const unknown = { qty: { $wat: Symbol('x') } };
    expect(normalizeFilterComparandTypes(unknown)).toBe(unknown);
    const retired = { name: { $regex: 'ac.*' } };
    expect(normalizeFilterComparandTypes(retired)).toBe(retired);
  });

  it('does not judge a non-array list-operator comparand — that SHAPE belongs to the engine’s #5869 gate', () => {
    const filter = { stage: { $in: 'won' } };
    expect(normalizeFilterComparandTypes(filter)).toBe(filter);
  });

  it('keeps the zero-operator constraint for the driver refusal that names it (#5240)', () => {
    const filter = { qty: {} };
    expect(normalizeFilterComparandTypes(filter)).toBe(filter);
  });
});

describe('parseFilterAST is the compile face that runs the door (#7872)', () => {
  it('judges the OBJECT passthrough — the form that used to leave unexamined', () => {
    const err = refusalOf(() => parseFilterAST({ qty: { $eq: Symbol('x') } }));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
  });

  it('judges the lowered AST form — a bad comparand in a triple is refused, not lowered', () => {
    const err = refusalOf(() => parseFilterAST(['qty', '=', new Map()]));
    expect(err?.code).toBe('INVALID_FILTER');
    const nested = refusalOf(() => parseFilterAST(['and', ['a', '=', 1], ['qty', '=', undefined]]));
    expect(nested?.code).toBe('INVALID_FILTER');
  });

  it('narrows a bigint arriving through either form', () => {
    expect(parseFilterAST(['qty', '=', BigInt(100)])).toEqual({ qty: 100 });
    expect(parseFilterAST({ qty: { $eq: BigInt(100) } })).toEqual({ qty: { $eq: 100 } });
  });

  it('returns the SAME object reference for a clean passthrough — the historical contract survives the door', () => {
    const filter = { status: 'active', qty: { $gt: 5 } };
    expect(parseFilterAST(filter)).toBe(filter);
  });

  it('lowers a clean AST exactly as before the door', () => {
    expect(parseFilterAST(['status', '=', 'active'])).toEqual({ status: 'active' });
    expect(parseFilterAST(['and', ['priority', '=', 'high'], ['status', '=', 'active']]))
      .toEqual({ $and: [{ priority: 'high' }, { status: 'active' }] });
    expect(parseFilterAST([])).toBeUndefined();
    expect(parseFilterAST(null)).toBeUndefined();
  });
});
