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
import { parseFilterAST, RangeOperatorSchema, VALID_AST_OPERATORS } from './filter.zod';
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

  it('refuses ONLY null among the MEMBERS — falsy and empty-ish members are values', () => {
    // The carve-out is null-shaped and nothing wider: #5041's and #5234's
    // member questions stand untouched, and every falsy VALUE keeps working.
    expect(parseFilterAST({ n: { $in: [0, false, ''] } })).toEqual({ n: { $in: [0, false, ''] } });
    expect(parseFilterAST({ n: { $nin: [0, false, ''] } })).toEqual({ n: { $nin: [0, false, ''] } });
    // A falsy ENDPOINT is still an endpoint — `0` is a bound like any other.
    expect(parseFilterAST({ n: { $between: [0, 0] } })).toEqual({ n: { $between: [0, 0] } });
    // ⚠️ `{ at: { $between: ['', ''] } }` was pinned HERE as a value that
    // passes. That row — and only that row — is INVERTED by the 2026-09-20
    // ruling (#19071); it now lives in the blank-endpoint section below. The
    // `$in` / `$nin` rows above are untouched, because falsy VALUES are values
    // and a range ENDPOINT is a different question.
  });

  // ── the BLANK endpoint carve-out, ruled 2026-09-20 (#19071) ────────────

  it.each([
    ['both sides blank', { at: { $between: ['', ''] } }],
    ['a blank MAX', { at: { $between: ['2026-07-01', ''] } }],
    ['a blank MIN', { at: { $between: ['', '2026-07-31'] } }],
    ['an absent MAX', { at: { $between: ['2026-07-01', undefined] } }],
    ['an absent MIN', { at: { $between: [undefined, '2026-07-31'] } }],
    ['the lowered array form', [['at', 'between', ['', '2026-07-31']]]],
  ])('refuses a BLANK $between ENDPOINT — %s', (_label, where) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  it('the blank-bound refusal names the SIDE and prescribes both remedies', () => {
    // 2026-09-20: the refusal 「naming the blank side and carrying the same
    // guidance as the schema door」 — with a padded pair both bounds are
    // present, and the author is the one person who cannot see which is empty.
    const err = refusalOf(() => parseFilterAST({ close_date: { $between: ['2026-07-01', ''] } }));
    expect(err.message)
      .toMatch(/^Operator "\$between" on field "close_date" requires two non-blank bounds/);
    expect(err.message).toContain('an empty string at where.close_date.$between[1] (the MAX bound)');
    expect(err.message).toContain('{"$gte": min} / {"$lte": max}');
    expect(err.message).toMatch(/Authoring spellings: between\./);
    expect(err.message).toMatch(/UNFILTERED result set/);
    expect(refusalOf(() => parseFilterAST({ close_date: { $between: ['', '2026-07-31'] } })).message)
      .toContain('where.close_date.$between[0] (the MIN bound)');
    // An ABSENT bound says so in words: `undefined` inside an array renders as
    // `null` through JSON.stringify, and null is the one blank spelling this
    // message is NOT about.
    expect(refusalOf(() => parseFilterAST({ close_date: { $between: [5, undefined] } })).message)
      .toContain('Received undefined at where.close_date.$between[1] (the MAX bound)');
  });

  it('a blank bound is refused at its own path inside $and / $or / $not too', () => {
    expect(refusalOf(() => parseFilterAST({ $not: { at: { $between: ['', 'M'] } } })).message)
      .toContain('where.$not.at.$between[0]');
    expect(refusalOf(() => parseFilterAST({ $or: [{ at: { $between: ['A', ''] } }] })).message)
      .toContain('where.$or[0].at.$between[1]');
  });

  it('the null bound keeps the 2026-08-31 ruling\'s own message — two spellings, two remedies', () => {
    // An author who wrote `null` was reaching for absence; an author who left
    // a bound empty was reaching for a bound. If this went red the null author
    // would be sent to a scalar comparison instead of the null predicate.
    const err = refusalOf(() => parseFilterAST({ at: { $between: ['2026-07-01', null] } }));
    expect(err.message).toContain('requires two non-null bounds');
    expect(err.message).toContain('{"at": {"$null": true}}');
    expect(err.message).not.toContain('non-blank');
    // null is checked FIRST, so a pair that is blank on one side and null on
    // the other keeps the message it has had since 2026-08-31.
    expect(refusalOf(() => parseFilterAST({ at: { $between: ['', null] } })).message)
      .toContain('requires two non-null bounds');
  });

  it('answers every endpoint spelling exactly as the SCHEMA door does', () => {
    // The defect this ruling closes was one published sentence
    // (`RANGE_ENDPOINT_DESCRIPTION`) with two truth values, so the pin is the
    // AGREEMENT itself rather than a second hand-written list that can drift
    // from the door it is supposed to match.
    const endpointPairs: Array<[string, unknown[]]> = [
      ["['', '']", ['', '']],
      ["['2026-01-01', '']", ['2026-01-01', '']],
      ["['', '2026-12-31']", ['', '2026-12-31']],
      ['[5, undefined]', [5, undefined]],
      ['[undefined, 5]', [undefined, 5]],
      ['[null, 1]', [null, 1]],
      ['[1, null]', [1, null]],
      // Controls that must stay LEGAL at BOTH doors — a red here would mean a
      // door started reading falsiness, or shortness, instead of blankness.
      ['[0, 0]', [0, 0]],
      ["['0', '9']", ['0', '9']],
      ["['A', 'M']", ['A', 'M']],
      ["['08:00:00', '18:00:00']", ['08:00:00', '18:00:00']],
      ["['2026-01-01', '2026-12-31']", ['2026-01-01', '2026-12-31']],
      // ⛔ Whitespace-only is NOT judged, at EITHER door: the 2026-09-17 ruling
      // is the empty string, `filter.test.ts` pins the schema side of this very
      // row, and a trim here would re-open the split in the other direction.
      ["['   ', 'M']", ['   ', 'M']],
      // The 2026-08-11 `{ $field }` carve-out (#7596), reaching this door
      // under #19377 — the same two-door question, one endpoint spelling over.
      ["[{ $field }, 'M']", [{ $field: 'a' }, 'M']],
      ["['A', { $field }]", ['A', { $field: 'b' }]],
      ['[{ $field }, { $field }]', [{ $field: 'a' }, { $field: 'b' }]],
      // A non-string referent is still the SHAPE the author wrote, at both
      // doors: the schema door reads `'$field' in value` and so does this one.
      ['[{ $field: 42 }, M]', [{ $field: 42 }, 'M']],
      // A plain object that is NOT a reference was already refused at both
      // doors, each with its own wording — the row is here so the loop cannot
      // be read as "every object endpoint is the #7596 refusal now".
      ["[{ nope: 1 }, 'M']", [{ nope: 1 }, 'M']],
    ];
    const refused: string[] = [];
    for (const [label, pair] of endpointPairs) {
      const schemaRefuses = !RangeOperatorSchema.safeParse({ $between: pair }).success;
      let runtimeRefuses = false;
      try {
        parseFilterAST({ close_date: { $between: pair } });
      } catch {
        runtimeRefuses = true;
      }
      expect(runtimeRefuses, `${label}: schema refuses=${schemaRefuses}`).toBe(schemaRefuses);
      if (schemaRefuses) refused.push(label);
    }
    // Guards the loop from passing vacuously in either direction.
    expect(refused).toHaveLength(12);
  });

  // ── the `{ $field }` endpoint carve-out, ruled 2026-08-11 (#7596) ──────
  //
  // The ruling is the oldest of the four and the last to reach this door: it
  // removed `FieldReferenceSchema` from both endpoint unions and published the
  // sentence "A { $field } reference is NOT an endpoint shape", while this door
  // went on lowering such a range unchanged (#19377).

  it.each([
    ['a reference as the MIN bound', { at: { $between: [{ $field: 'a' }, 'M'] } }],
    ['a reference as the MAX bound', { at: { $between: ['A', { $field: 'b' }] } }],
    ['both bounds references', { at: { $between: [{ $field: 'a' }, { $field: 'b' }] } }],
    ['a reference with a non-string referent', { at: { $between: [{ $field: 42 }, 'M'] } }],
    ['the lowered array form', [['at', 'between', [{ $field: 'a' }, 'M']]]],
  ])('refuses a { $field } $between ENDPOINT — %s', (_label, where) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
  });

  it('the reference refusal names the SIDE and prescribes the two-bound spelling', () => {
    // The author who wrote a reference was reaching for a column-to-column
    // comparison, which the platform HAS one operator over — so the remedy is
    // a different filter, not a different literal, and the message says so.
    const err = refusalOf(() => parseFilterAST({ close_date: { $between: [{ $field: 'a' }, 'M'] } }));
    expect(err.message).toMatch(
      /^Operator "\$between" on field "close_date" does not accept a \{ "\$field": … \} reference/,
    );
    expect(err.message).toContain('at where.close_date.$between[0], the MIN bound');
    expect(err.message).toContain('{"$gte": {"$field": "a"}, "$lte": {"$field": "b"}}');
    expect(err.message).toMatch(/Authoring spellings: between\./);
    expect(err.message).toMatch(/UNFILTERED result set/);
    expect(refusalOf(() => parseFilterAST({ close_date: { $between: ['A', { $field: 'b' }] } })).message)
      .toContain('at where.close_date.$between[1], the MAX bound');
    // ⛔ The in-memory evaluator is NOT offered as an escape: it does not
    // resolve a list member either, it fails silently instead of loudly, so
    // naming it would send an author to the one path that answers a wrong row
    // set rather than an error. The schema door's twin holds the same line.
    expect(err.message).not.toContain('matchesFilter');
  });

  it('a reference bound is refused at its own path inside $and / $or / $not too', () => {
    expect(refusalOf(() => parseFilterAST({ $not: { at: { $between: [{ $field: 'a' }, 'M'] } } })).message)
      .toContain('where.$not.at.$between[0]');
    expect(refusalOf(() => parseFilterAST({ $or: [{ at: { $between: ['A', { $field: 'b' }] } }] })).message)
      .toContain('where.$or[0].at.$between[1]');
  });

  it('the three older endpoint carve-outs keep their own messages', () => {
    // This check is LAST inside the arm, so every pair that already carried a
    // refusal keeps the one it had. A red here means a pair was re-routed and
    // an author who wrote `null` is now being sent to a scalar comparison.
    expect(refusalOf(() => parseFilterAST({ at: { $between: [{ $field: 'a' }, null] } })).message)
      .toContain('requires two non-null bounds');
    expect(refusalOf(() => parseFilterAST({ at: { $between: [{ $field: 'a' }, ''] } })).message)
      .toContain('requires two non-blank bounds');
    expect(refusalOf(() => parseFilterAST({ at: { $between: [{ $field: 'a' }] } })).message)
      .toContain('requires a [min, max] value array');
    // And a plain object that is not a reference keeps the comparand-TYPE
    // door's own sentence, one step further on.
    expect(refusalOf(() => parseFilterAST({ at: { $between: [{ nope: 1 }, 'M'] } })).message)
      .toContain('plain object');
  });

  it('LIT CONTROL — legal ranges and the reference\'s own ORDERING slots still pass', () => {
    // Without these the refusal could be a blanket rejection of `$between`, or
    // of the reference itself, and every assertion above would still be green.
    expect(parseFilterAST({ at: { $between: ['A', 'M'] } }))
      .toEqual({ at: { $between: ['A', 'M'] } });
    expect(parseFilterAST({ n: { $between: [0, 100] } })).toEqual({ n: { $between: [0, 100] } });
    expect(parseFilterAST({ at: { $between: ['2026-01-01', '2026-12-31'] } }))
      .toEqual({ at: { $between: ['2026-01-01', '2026-12-31'] } });
    // #5222's shipped capability: the reference IS a whole comparand of the
    // four ordering operators, which is what this refusal prescribes. Refusing
    // it there would delete the escape the message names.
    for (const op of ['$gt', '$gte', '$lt', '$lte']) {
      expect(parseFilterAST({ a: { [op]: { $field: 'b' } } }))
        .toEqual({ a: { [op]: { $field: 'b' } } });
    }
    // The two-bound spelling the message prescribes must itself lower.
    expect(parseFilterAST({ a: { $gte: { $field: 'b' }, $lte: { $field: 'c' } } }))
      .toEqual({ a: { $gte: { $field: 'b' }, $lte: { $field: 'c' } } });
  });

  it('re-routes the pairs the comparand-TYPE door used to answer — convergence, pinned', () => {
    // ⚠️ This is the one part of the delta that is NOT "was accepted, is now
    // refused". A pair whose OTHER element the comparand-TYPE door would have
    // refused now meets this door first, so it answers with the reference
    // sentence instead of the type one: same code, same status, and the schema
    // door already answered every one of these with the reference message, so
    // the two doors CONVERGE rather than diverge. Pinned rather than left to
    // the reader, because "nothing else changed" is not true of these rows.
    const mixed = refusalOf(() => parseFilterAST({ at: { $between: [{ $field: 'a' }, { nope: 1 }] } }));
    expect(mixed.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(mixed.status).toBe(400);
    expect(mixed.message).toContain('does not accept a { "$field": … } reference');
    // …and it names the REFERENCE's index, not the other element's.
    expect(mixed.message).toContain('where.at.$between[0]');
    // A non-string referent, and a reference reached through the PROTOTYPE, are
    // the shape the author wrote — at both doors. The TYPE door would have
    // called each of them a plain object and prescribed a literal, which is the
    // wrong remedy for someone who was reaching for a column.
    for (const bound of [{ $field: 42 }, Object.create({ $field: 'a' }) as object]) {
      expect(refusalOf(() => parseFilterAST({ at: { $between: [bound, 'M'] } })).message)
        .toContain('does not accept a { "$field": … } reference');
    }
    // A pair carrying NO reference is untouched: it still reaches the TYPE door
    // and still answers with the TYPE door's own sentence.
    expect(refusalOf(() => parseFilterAST({ at: { $between: [{ nope: 1 }, 'M'] } })).message)
      .toContain('plain object');
  });

  it.todo(
    'the $in / $nin MEMBER positions of the same 2026-08-11 ruling still DISAGREE across the two '
    + 'doors — FieldOperatorsSchema refuses a { $field } member, parseFilterAST lowers it '
    + 'unchanged (measured on this branch). Filed separately; ⛔ not pinned green here, because a '
    + 'green pin would read as a ruling nobody made',
  );

  // ⚠️ `$in` / `$nin` MEMBERS carrying a `{ $field }` reference are the SAME
  // #7596 ruling one position over, published by `SET_MEMBER_DESCRIPTION`, and
  // this door still lowers them unchanged — measured under #19377 and filed
  // separately. ⛔ Deliberately NOT pinned here in either direction: pinning a
  // measured defect green reads as a ruling nobody made, and refusing it would
  // be a narrowing of a published face this card was never given.

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
      // The 2026-09-20 blank carve-out (#19071): the named side and both
      // prescriptions ride the same unrelaxed bound.
      { close_date: { $between: ['2026-07-01', ''] } },
      { close_date: { $between: ['', '2026-07-31'] } },
      { close_date: { $between: [5, undefined] } },
      // The 2026-08-11 reference carve-out (#7596): the two-bound prescription
      // is the longest thing this arm assembles, inside the same bound.
      { close_date: { $between: [{ $field: 'a' }, 'M'] } },
      { close_date: { $between: ['A', { $field: 'b' }] } },
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
    // An implicit-equality array comparand is passed through for the driver to
    // answer; what it MEANS is not this door's ruling (see the comparand door's
    // own list of the cases it deliberately does not rule).
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
