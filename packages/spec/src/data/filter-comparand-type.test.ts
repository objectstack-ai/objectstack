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
  NowAnchorSchema,
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

describe('the accepted set — one set, defined at the shared door for every driver', () => {
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
      '$like', '$ilike', '$null', '$exists', '$empty',
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

  it.each(refused)('refuses %s as an $in member — each member is a comparand in its own right', (_name, value) => {
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

  it('the undefined prescription is position-safe: it names the null predicate by its ruled spellings, at every position it is emitted at', () => {
    // "Write null for the null predicate" was position-agnostic advice: followed
    // at `$gt: undefined` it produced `$gt: null`, refused one door over since
    // the 2026-09-01 ruling; at an `$in` member it produced `$in: [null]`,
    // refused since 2026-08-31. The sentence names COMPLETE spellings instead —
    // the pair the ruling names — so following it never lands in a refusal.
    const positions: Array<[Record<string, unknown>, string]> = [
      [{ owner: undefined }, 'where.owner'],
      [{ owner: { $eq: undefined } }, 'where.owner.$eq'],
      [{ owner: { $gt: undefined } }, 'where.owner.$gt'],
      [{ owner: { $lte: undefined } }, 'where.owner.$lte'],
      [{ owner: { $in: [undefined] } }, 'where.owner.$in[0]'],
    ];
    for (const [where, path] of positions) {
      const err = refusalOf(() => normalizeFilterComparandTypes(where));
      expect(err?.code, path).toBe('INVALID_FILTER');
      expect(err?.status, path).toBe(400);
      expect(err?.message, path).toContain(path);
      expect(err?.message, path).toContain('{"$eq": null}');
      expect(err?.message, path).toContain('{"$ne": null}');
      expect(err?.message, path).toMatch(/omit the key/);
      // The defect's own spelling: an instruction to write a bare null INTO the
      // position the sentence was emitted at.
      expect(err?.message, path).not.toMatch(/Write null\b/);
      expect(err?.message.length, path).toBeLessThan(500); // the client bound (#5423)
    }
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

describe('bigint — accepted, and NARROWED copy-on-write (the memory crash cell dies here)', () => {
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
  it('leaves a FieldReference alone at every position — cross-field push-down, scalar comparison and the `$eq` lowering own its fate', () => {
    for (const filter of [
      { amount: { $gt: { $field: 'budget' } } },
      { amount: { $eq: { $field: 'budget' } } },
      { amount: { $field: 'budget' } },
      { amount: { $in: [{ $field: 'budget' }] } },
    ]) {
      expect(normalizeFilterComparandTypes(filter)).toBe(filter);
    }
  });

  it('does not descend into a no-$-key plain object — nested-relation / deep-equality structure', () => {
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

  it('does not judge a non-array list-operator comparand — that SHAPE is refused 400 by the engine’s shape gate', () => {
    const filter = { stage: { $in: 'won' } };
    expect(normalizeFilterComparandTypes(filter)).toBe(filter);
  });

  it('keeps the zero-operator constraint for the driver refusal that names it', () => {
    const filter = { qty: {} };
    expect(normalizeFilterComparandTypes(filter)).toBe(filter);
  });
});

describe('parseFilterAST is the compile face that runs the door', () => {
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

describe('[#26413] the now-anchor is closed at the door, as NowAnchorSchema declares', () => {
  const EXTRA_KEY_ANCHORS: Array<[string, Record<string, unknown>, string]> = [
    ['a subDays beside an integer offset', { $now: true, addDays: -30, subDays: 7 }, 'subDays'],
    ['a note beside a { $field } offset', { $now: true, addDays: { $field: 'sla_days' }, note: 'x' }, 'note'],
    ['the resolved form the engine hands the executors', { $now: '2026-03-03T12:00:00.000Z', addDays: 0, note: 'x' }, 'note'],
  ];

  it('the door\'s key set is the schema\'s shape: $now and addDays, nothing else', () => {
    expect(Object.keys(NowAnchorSchema.shape).sort()).toEqual(['$now', 'addDays']);
  });

  it('refuses an undeclared key at every scalar comparison, naming the key', () => {
    for (const [label, anchor, key] of EXTRA_KEY_ANCHORS) {
      for (const op of ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']) {
        const err = refusalOf(() => normalizeFilterComparandTypes({ opened_at: { [op]: anchor } }));
        expect(err?.code, `${label} ${op}`).toBe('INVALID_FILTER');
        expect(err?.status, `${label} ${op}`).toBe(400);
        expect(err?.message, `${label} ${op}`).toContain(`undeclared key "${key}"`);
        expect(err?.message, `${label} ${op}`).toContain('the anchor takes $now and addDays only');
      }
    }
  });

  it('refuses it under $and / $or / $not and through parseFilterAST\'s two forms', () => {
    const anchor = { $now: true, addDays: 1, subDays: 1 };
    for (const filter of [
      { $and: [{ status: 'open' }, { opened_at: { $lt: anchor } }] },
      { $or: [{ opened_at: { $gte: anchor } }] },
      { $not: { opened_at: { $lt: anchor } } },
    ]) {
      expect(refusalOf(() => normalizeFilterComparandTypes(filter))?.code, JSON.stringify(filter)).toBe('INVALID_FILTER');
    }
    expect(refusalOf(() => parseFilterAST({ opened_at: { $lt: anchor } }))?.code).toBe('INVALID_FILTER');
    expect(refusalOf(() => parseFilterAST(['opened_at', '<', anchor]))?.code).toBe('INVALID_FILTER');
  });

  it('names every undeclared key, and names it before a malformed offset', () => {
    const err = refusalOf(() => normalizeFilterComparandTypes({ opened_at: { $lt: { $now: true, subDays: 7, note: 'x' } } }));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.message).toContain('undeclared key "subDays", "note"');
  });

  it('keeps a well-formed anchor, on both offset arms and in its resolved form, by reference', () => {
    for (const anchor of [
      { $now: true, addDays: -30 },
      { $now: true, addDays: { $field: 'sla_days' } },
      { $now: '2026-03-03T12:00:00.000Z', addDays: 0 },
    ]) {
      const filter = { opened_at: { $lt: anchor } };
      expect(normalizeFilterComparandTypes(filter)).toBe(filter);
    }
  });
});

describe('[#26413 review] the subDays clause answers subDays alone, so a one-key refusal stays inside the bound', () => {
  const NOT_APPLIED_TAIL = 'an unapplied filter would have returned the UNFILTERED result set.';

  it('names the subDays rule when subDays is among the keys, and only then', () => {
    const subDays = refusalOf(() => normalizeFilterComparandTypes({ opened_at: { $lt: { $now: true, addDays: -30, subDays: 7 } } }));
    expect(subDays?.message).toContain('there is no subDays: a negative addDays subtracts');
    const note = refusalOf(() => normalizeFilterComparandTypes({ opened_at: { $lt: { $now: true, addDays: -30, note: 'x' } } }));
    expect(note?.code).toBe('INVALID_FILTER');
    expect(note?.message).toContain('undeclared key "note" — the anchor takes $now and addDays only.');
    expect(note?.message).not.toContain('subDays');
  });

  it('a one-key refusal under the engine prefix, under $and, keeps its last sentence under 500 characters', () => {
    // The contract review's measured case was 496 characters with the clause
    // printed for `note`; a longer field and a path under `$and` pushed it over.
    const err = refusalOf(() => normalizeFilterComparandTypes(
      { $and: [{ status: 'open' }, { review_opened_at: { $lte: { $now: true, addDays: -30, note: 'x' } } }] },
      "find('support_ticket')",
    ));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err!.message.length).toBeLessThanOrEqual(500);
    expect(err!.message.endsWith(NOT_APPLIED_TAIL)).toBe(true);
  });
});

describe('[#26601] a dotted addDays offset is refused at the door, on a reference and on an anchor', () => {
  const REF = 'contract_type.review_sla_days';
  /** `driver-sql`'s reason for the same refusal on every SQL read, verbatim. */
  const SQL_REASON = `the addDays offset "${REF}" is a dotted path, and SQL push-down compiles same-table `
    + 'column references only (no relation traversal, no alias-qualified columns).';
  const COMPARANDS: Array<[string, Record<string, unknown>]> = [
    ['the { $field, addDays } pair', { $field: 'review_due_at', addDays: { $field: REF } }],
    ['the now-anchor', { $now: true, addDays: { $field: REF } }],
    ['the now-anchor in its resolved form', { $now: '2026-03-03T12:00:00.000Z', addDays: { $field: REF } }],
  ];

  it('refuses it at every scalar comparison, in the SQL read\'s own words, with the envelope', () => {
    for (const [label, comparand] of COMPARANDS) {
      for (const op of ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']) {
        const err = refusalOf(() => normalizeFilterComparandTypes({ review_started_at: { [op]: comparand } }));
        expect(err?.code, `${label} ${op}`).toBe(StandardErrorCode.enum.INVALID_FILTER);
        expect(err?.status, `${label} ${op}`).toBe(400);
        expect(err?.message, `${label} ${op}`).toContain(`at where.review_started_at.${op} is refused: ${SQL_REASON}`);
      }
    }
  });

  it('refuses it under $and / $or / $not and through parseFilterAST\'s two forms', () => {
    for (const [label, comparand] of COMPARANDS) {
      for (const filter of [
        { $and: [{ status: 'open' }, { review_started_at: { $lt: comparand } }] },
        { $or: [{ review_started_at: { $gte: comparand } }] },
        { $not: { review_started_at: { $lt: comparand } } },
      ]) {
        expect(refusalOf(() => normalizeFilterComparandTypes(filter))?.code, `${label} ${JSON.stringify(filter)}`).toBe('INVALID_FILTER');
      }
      expect(refusalOf(() => parseFilterAST({ review_started_at: { $lt: comparand } }))?.code, label).toBe('INVALID_FILTER');
      expect(refusalOf(() => parseFilterAST(['review_started_at', '<', comparand]))?.code, label).toBe('INVALID_FILTER');
    }
  });

  it('the refusal at the measure-filter position keeps its last sentence under 500 characters', () => {
    const err = refusalOf(() => normalizeFilterComparandTypes(
      { $and: [{ status: 'open' }, { contract_review_started_at: { $lte: { $now: true, addDays: { $field: 'contract_type_of_the_agreement.review_sla_days_offset' } } } }] },
      "aggregate('clm_contract_review')",
      'aggregations[0].filter',
    ));
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err!.message.length).toBeLessThanOrEqual(500);
    expect(err!.message.endsWith('an unapplied filter would have returned the UNFILTERED result set.')).toBe(true);
  });

  it('CONTROL: a same-record offset column, a literal offset and a dotted BASE reference are kept by reference', () => {
    for (const comparand of [
      { $field: 'review_due_at', addDays: { $field: 'review_sla_days' } },
      { $now: true, addDays: { $field: 'review_sla_days' } },
      { $now: true, addDays: -3 },
      // The reference's own `$field` is not this rule's: memory walks it, SQL refuses it.
      { $field: 'contract_type.review_due_at' },
      { $field: 'contract_type.review_due_at', addDays: 2 },
    ]) {
      const filter = { review_started_at: { $lt: comparand } };
      expect(normalizeFilterComparandTypes(filter), JSON.stringify(comparand)).toBe(filter);
    }
  });

  it('CONTROL: the bare implicit form keeps its own fate — an operator spec named $field, not judged here', () => {
    const filter = { review_started_at: { $field: 'review_due_at', addDays: { $field: REF } } };
    expect(normalizeFilterComparandTypes(filter)).toBe(filter);
  });
});
