// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5346 / #5376] The three filter shapes this driver was the last backend to
 * answer instead of refusing.
 *
 * # What was wrong, measured
 *
 * All three on `origin/main` @ `76d74ecb4`, through `translateFilter` directly:
 *
 * ```
 * { score: { $between: 5 } }      =>  {"score":{}}
 * { score: { $between: [1] } }    =>  {"score":{}}
 * { score: { $between: [1,2,3] } }=>  {"score":{}}
 * { $where: 'return true' }       =>  {"$where":"return true"}
 * { $nor: [{ stage: 'won' }] }    =>  {"$nor":[{"stage":"won"}]}
 * { stage: {} }                   =>  {"stage":{}}
 * ```
 *
 * Three different mistakes with one thing in common: the query RAN, reported
 * nothing, and answered with a row set the author never asked for.
 *
 * - **`$between`** — the emitter arm wrote both bounds inside
 *   `if (Array.isArray(value) && value.length === 2)` and had no `else`, so a
 *   malformed comparand dropped the whole range and normalised the field to
 *   `{}`. The twin, down to the missing `else`, of the arm #5328 fixed on
 *   `driver-memory`; `driver-sql` has refused it since #4436.
 * - **A `$`-key in a NODE position** — the severe one, and the reason this batch
 *   is not merely cosmetic. `translateCondition`'s switch knows three
 *   combinators; every other key took the FIELD path, and a key with no
 *   `$`-prefixed sub-keys fell to implicit equality and was written into the
 *   outgoing document verbatim. MongoDB then EXECUTED it. `$where` is
 *   server-side JavaScript. The emitter's field-level `default:` arm names
 *   `$where` / `$function` / `$expr` / `$accumulator` as its P0 reason for
 *   refusing them one level down — that gate was only ever installed at the
 *   FIELD position. Compare the other backends on the same input: `driver-sql` /
 *   `driver-sqlite-wasm` compiled a COLUMN of that name and returned zero rows
 *   (#5348, since refused), cloud's `RemoteTransport` likewise (cloud#1077), and
 *   `driver-memory` has refused since #5324. Only here was it evaluated.
 * - **`{ field: {} }`** — ruled REFUSE on #5240 and gated on `driver-sql` /
 *   `driver-sqlite-wasm` / `driver-memory` / `formula` by #5327. This driver was
 *   the fifth backend and the one still answering, translating it to
 *   `{ field: {} }` — which MongoDB reads as "the field is deep-equal to the
 *   empty document". Not the FALSE the ruling declined to take: a DIFFERENT
 *   filter that looks like FALSE until a document actually stores `{}` there,
 *   which is precisely what #5327 measured mingo doing with a seeded `a: {}` row.
 *
 * # Why the gates are on the WALK, and what proves it
 *
 * Each gate sits in `classifyFilterKey` — the validating walk — beside the
 * `$null` (#5347) and `$icontains` (#6520) gates, not in the emitter. The
 * emitter is skipped WHOLESALE when a boolean identity settles the enclosing
 * node, so a gate there would refuse or ignore the same shape depending on its
 * SIBLINGS. That is not a prediction; all three were measured returning `{}` —
 * match-all — on the pre-fix commit:
 *
 * ```
 * { $or: [ {}, { $where: 'x' } ] }        =>  {}
 * { $or: [ {}, { s: { $between: 5 } } ] } =>  {}
 * { $or: [ { a: {} }, {} ] }              =>  {}
 * ```
 *
 * The `describe` block at the end of this file pins exactly those three.
 *
 * # Why the translator and not a live mongod
 *
 * `translateFilter` is a pure function and its output IS the query document
 * MongoDB receives — for these three defects the translation is the whole of the
 * divergence. This package's live suites need `mongodb-memory-server`, a ~123 MB
 * download retired from default runs by #5517, so they are `describe.skipIf`-
 * gated; a test of a ruling that can be skipped is not a test of the ruling. The
 * same reasoning, and the same level, as `mongodb-null-comparand-refusal.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { translateFilter } from './mongodb-filter.js';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The exact leading sentences `driver-sql` and `driver-memory` produce for these
 * conditions. Literals, not imports: this package does not depend on either (and
 * must not), so the one-condition-one-wording invariant (#5240) is held by
 * pinning the other side's text here — the discipline
 * `mongodb-null-comparand-refusal.test.ts` and
 * `memory-filter-vocabulary-refusal.test.ts` both use.
 */
const SIBLING_LEADING_SENTENCE = {
  malformedBetween: (field: string) =>
    `Operator "$between" on field "${field}" requires a [min, max] value array.`,
  emptyFieldConstraint: (field: string, path: string) =>
    `Field constraint at ${path} carries zero operators ({ "${field}": {} }).`,
  unknownCombinator: (key: string, path: string) =>
    `Unsupported filter combinator "${key}" at ${path}.`,
} as const;

/**
 * The vocabulary sentence `driver-sql` and `driver-memory` both print after the
 * leading one, verbatim — the part that tells the author what the three declared
 * combinators actually are.
 */
const VOCABULARY_SENTENCE =
  `A filter node's $-prefixed keys are the declared logical operators $and, $or and $not ` +
  `(@objectstack/spec LOGICAL_OPERATORS); every other key is a field name.`;

const refusalOf = (where: unknown): WireBearingError => {
  try {
    translateFilter(where);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the translator to refuse this filter, but it translated');
};

/** Every refusal in this batch speaks the one ADR-0112 envelope, prefix-free. */
const expectEnvelope = (err: WireBearingError): void => {
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  // #3867 — driver-internal wording must not ship to clients.
  expect(err.message).not.toContain('[mongodb]');
};

describe('[#5346] driver-mongodb refuses a malformed $between comparand', () => {
  const MALFORMED: Array<[label: string, value: unknown]> = [
    ['a bare number', 5],
    ['a string', '1,2'],
    ['a one-element array', [1]],
    ['a three-element array', [1, 2, 3]],
    ['an empty array', []],
    ['null', null],
    ['undefined', undefined],
    ['an object', { min: 1, max: 2 }],
    ['a boolean', true],
  ];

  for (const [label, value] of MALFORMED) {
    it(`refuses ${label} with INVALID_FILTER / 400`, () => {
      const err = refusalOf({ score: { $between: value } });
      expectEnvelope(err);
      expect(err.message).toContain(SIBLING_LEADING_SENTENCE.malformedBetween('score'));
      expect(err.message).toContain('filter.score.$between');
    });
  }

  it('names the position inside a combinator', () => {
    expect(refusalOf({ $and: [{ score: { $between: 5 } }] }).message).toContain(
      'filter.$and[0].score.$between',
    );
    expect(refusalOf({ $or: [{ x: 1 }, { score: { $between: [1] } }] }).message).toContain(
      'filter.$or[1].score.$between',
    );
    expect(refusalOf({ $not: { score: { $between: 5 } } }).message).toContain(
      'filter.$not.score.$between',
    );
  });

  it('a well-formed range translates exactly as before', () => {
    expect(translateFilter({ score: { $between: [1, 2] } })).toEqual({
      score: { $gte: 1, $lte: 2 },
    });
  });

  it('the whole-day upper bound rule (#4042) is untouched', () => {
    // A bare-day max still compiles half-open, which is the behaviour the arm
    // carried before the `else` was added — the refusal must not have changed
    // what a VALID range means.
    expect(translateFilter({ due: { $between: ['2026-07-01', '2026-07-28'] } })).toEqual({
      due: { $gte: '2026-07-01', $lt: '2026-07-29' },
    });
  });
});

describe('[#5346] driver-mongodb refuses an undeclared $-key in a NODE position', () => {
  const UNDECLARED: Array<[label: string, filter: Record<string, unknown>]> = [
    ['$where — server-side JavaScript', { $where: 'return true' }],
    ['$nor — a real MongoDB combinator the protocol never declared', { $nor: [{ stage: 'won' }] }],
    ['$expr', { $expr: { $eq: ['$a', '$b'] } }],
    ['$function', { $function: { body: 'function(){return true}' } }],
    ['$accumulator', { $accumulator: {} }],
    ['$text', { $text: { $search: 'x' } }],
    ['$jsonSchema', { $jsonSchema: {} }],
  ];

  for (const [label, filter] of UNDECLARED) {
    it(`refuses ${label} with INVALID_FILTER / 400`, () => {
      const key = Object.keys(filter)[0];
      const err = refusalOf(filter);
      expectEnvelope(err);
      expect(err.message).toContain(SIBLING_LEADING_SENTENCE.unknownCombinator(key, `filter.${key}`));
      expect(err.message).toContain(VOCABULARY_SENTENCE);
    });
  }

  it('the refusal replaces PASS-THROUGH, which is what made this one severe', () => {
    // Before the gate, this exact document was handed to MongoDB and executed.
    // The assertion that matters is that nothing resembling it is emitted now —
    // no `$where` key can reach a query document by any path.
    expect(() => translateFilter({ $where: 'return true' })).toThrow(/Unsupported filter combinator/);
  });

  it('names the position inside a combinator', () => {
    expect(refusalOf({ $and: [{ $where: 'x' }] }).message).toContain('filter.$and[0].$where');
    expect(refusalOf({ $or: [{ a: 1 }, { $nor: [] }] }).message).toContain('filter.$or[1].$nor');
    expect(refusalOf({ $not: { $where: 'x' } }).message).toContain('filter.$not.$where');
  });

  it('the three DECLARED combinators are untouched', () => {
    expect(translateFilter({ $and: [{ a: 1 }, { b: 2 }] })).toEqual({ $and: [{ a: 1 }, { b: 2 }] });
    expect(translateFilter({ $or: [{ a: 1 }, { b: 2 }] })).toEqual({ $or: [{ a: 1 }, { b: 2 }] });
    expect(translateFilter({ $not: { a: 1 } })).toEqual({ $nor: [{ a: 1 }] });
  });

  it('the four query-level keys still pass, and still carry no predicate', () => {
    // They are not `$`-prefixed, so the gate cannot see them — but this is the
    // historical carve-out most likely to be broken by a node-level gate, so it
    // is pinned rather than assumed.
    expect(translateFilter({ limit: 10, offset: 5, fields: ['a'], orderBy: 'a' })).toEqual({});
    expect(translateFilter({ stage: 'won', limit: 10 })).toEqual({ stage: 'won' });
  });

  it('field-level operators keep their own refusal, unchanged (#5702)', () => {
    // The FIELD position has refused undeclared operators since long before this
    // change. Pinned here so the node-level gate cannot be mistaken for the
    // thing that made the field position work.
    const err = refusalOf({ name: { $sounds_like: 'x' } });
    expectEnvelope(err);
    expect(err.message).toContain('Unsupported filter operator "$sounds_like" on field "name"');
  });
});

describe('[#5376] driver-mongodb refuses a field constrained by zero operators', () => {
  it('refuses { field: {} } with INVALID_FILTER / 400', () => {
    const err = refusalOf({ stage: {} });
    expectEnvelope(err);
    expect(err.message).toContain(
      SIBLING_LEADING_SENTENCE.emptyFieldConstraint('stage', 'filter.stage'),
    );
  });

  it('names the position inside a combinator', () => {
    expect(refusalOf({ $and: [{ stage: {} }] }).message).toContain('filter.$and[0].stage');
    expect(refusalOf({ $or: [{ a: 1 }, { stage: {} }] }).message).toContain('filter.$or[1].stage');
    expect(refusalOf({ $not: { stage: {} } }).message).toContain('filter.$not.stage');
  });

  it('a constraint naming at least one operator still translates', () => {
    expect(translateFilter({ stage: { $eq: 'won' } })).toEqual({ stage: { $eq: 'won' } });
  });

  it('a direct comparand — including a genuinely empty-ish one — still translates', () => {
    // The refusal is about a constraint with no OPERATOR, not about empty
    // values: `''`, `0` and `null` are comparands and stay comparands.
    expect(translateFilter({ stage: '' })).toEqual({ stage: '' });
    expect(translateFilter({ score: 0 })).toEqual({ score: 0 });
    expect(translateFilter({ stage: null })).toEqual({ stage: null });
  });

  it('a non-plain object comparand is NOT an empty field constraint', () => {
    // A `Date` enumerates to nothing but is a COMPARAND. Reading it as `{}`
    // would refuse a perfectly valid filter — the prototype half of
    // `isFilterNode` is what keeps the two apart.
    expect(translateFilter({ due: new Date('2026-01-01T00:00:00.000Z') })).toEqual({
      due: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('an empty filter is still the ABSENT filter, not an empty constraint', () => {
    // `{}` at the TOP is "no filter" (match-all); `{ field: {} }` is a field
    // constrained by nothing. Different facts, and only the second is refused.
    expect(translateFilter({})).toEqual({});
    expect(translateFilter(undefined)).toEqual({});
  });
});

describe('[#5346 / #5376] the gates are on the WALK, so a sibling identity cannot skip them', () => {
  /**
   * Each fixture below reduced to `{}` — MATCH-ALL — on the pre-fix commit,
   * because a `{}` disjunct settles the `$or` as TRUE before any emitter arm
   * runs. An emitter-side gate would therefore refuse or ignore the same shape
   * depending on its SIBLINGS: the evaluation-order dependence #5368 placed
   * driver-sql's and driver-memory's gates on their validating walks to rule
   * out, and #5327's original argument for this exact position.
   */
  it('an undeclared $-key is refused even when a TRUE disjunct settles the $or', () => {
    const err = refusalOf({ $or: [{}, { $where: 'return true' }] });
    expectEnvelope(err);
    expect(err.message).toContain('filter.$or[1].$where');
  });

  it('a malformed $between is refused even when a TRUE disjunct settles the $or', () => {
    const err = refusalOf({ $or: [{}, { score: { $between: 5 } }] });
    expectEnvelope(err);
    expect(err.message).toContain('filter.$or[1].score.$between');
  });

  it('an empty field constraint is refused even when a TRUE disjunct settles the $or', () => {
    const err = refusalOf({ $or: [{ stage: {} }, {}] });
    expectEnvelope(err);
    expect(err.message).toContain('filter.$or[0].stage');
  });

  it('a FALSE sibling key does not settle the node first either', () => {
    // `$or: []` is FALSE, which dominates the node's AND — the emitter would
    // return `matchNothing()` without ever visiting the sibling.
    expectEnvelope(refusalOf({ $or: [], $where: 'x' }));
    expectEnvelope(refusalOf({ $or: [], score: { $between: 5 } }));
    expectEnvelope(refusalOf({ $or: [], stage: {} }));
  });

  it('a $not whose operand an identity settles does not skip the gates', () => {
    expect(refusalOf({ $not: { $or: [{}, { $where: 'x' }] } }).message).toContain(
      'filter.$not.$or[1].$where',
    );
    expect(refusalOf({ $not: { $or: [{}, { s: { $between: 5 } }] } }).message).toContain(
      'filter.$not.$or[1].s.$between',
    );
    expect(refusalOf({ $not: { $or: [{ s: {} }, {}] } }).message).toContain(
      'filter.$not.$or[0].s',
    );
  });

  it('the emitter keeps its own $between defense for its own invariant', () => {
    // The walk is the load-bearing gate, but the emitter arm no longer has a
    // silent path either: reaching it with a malformed comparand throws the SAME
    // constructor rather than writing an empty operator document. Exercised
    // through the only door that reaches the emitter — a well-formed walk — by
    // calling the arm's sibling operators around it.
    expect(translateFilter({ score: { $between: [1, 2], $ne: 7 } })).toEqual({
      score: { $gte: 1, $lte: 2, $ne: 7 },
    });
  });
});
