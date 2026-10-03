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
import {
  FieldOperatorsSchema,
  parseFilterAST,
  RangeOperatorSchema,
  VALID_AST_OPERATORS,
} from './filter.zod';
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
 * trips the door it is used to find. The EQUALITY spellings do refuse it, since
 * the 2026-09-23 arm (#19757) — and they answer `undefined` either way: before
 * that arm they lowered it to the implicit form, which carries no `$` key.
 * [#19886] The `$ne` spellings refuse it too, since ruling A; the `$ne` pins
 * below find their spellings with a SCALAR probe instead.
 * [#21448] So does every other scalar spelling now, ordering and text alike.
 * A spelling that refuses the list probe is therefore asked again with ONE
 * value, which every scalar operator accepts and every list operator refuses,
 * so each spelling still lowers through exactly one of the two probes. The
 * equality spellings still answer `undefined`: one value lowers them to the
 * implicit form, which carries no `$` key.
 */
const loweredOperatorOf = (op: string): string | undefined => {
  const lowerWith = (probe: unknown): Record<string, unknown> | undefined =>
    parseFilterAST([['probe', op, probe]]) as Record<string, unknown> | undefined;
  let lowered: Record<string, unknown> | undefined;
  try {
    lowered = lowerWith(['a', 'b']);
  } catch {
    try {
      lowered = lowerWith('a');
    } catch {
      return undefined;
    }
  }
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
      // by commit a60c913de — the same two-door question, one endpoint spelling over.
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
  // went on lowering such a range unchanged (until commit a60c913de).

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
  // this door still lowers them unchanged — measured for commit a60c913de and filed
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

  // ── the EQUALITY-slot arm, ruled 2026-09-23 (#19757) ───────────────────
  //
  // Ruling 5793368540, letter 乙: an array in the implicit-equality slot is
  // refused at this face, for every driver at once; ⛔ no alias, ⛔ no grace
  // window. Before it, `{ tags: ['a'] }` passed this door and was refused by
  // the SQL family and `driver-memory`, excluded every row on
  // `@objectstack/formula`, and was ANSWERED by `driver-mongodb` as MongoDB's
  // array equality — the pins below were each measured RED on the face as it
  // stood (see the PR's firing control).

  it.each([
    ['the lowered array form, "equals"', [['tags', 'equals', ['a']]], 'where.tags'],
    ['the lowered array form, "="', [['tags', '=', ['a', 'b']]], 'where.tags'],
    ['the object passthrough — implicit', { tags: ['a'] }, 'where.tags'],
    ['an EMPTY array — still an array in this slot', { tags: [] }, 'where.tags'],
    ['the object passthrough — explicit $eq', { tags: { $eq: ['a'] } }, 'where.tags.$eq'],
    ['explicit $eq with an EMPTY array', { tags: { $eq: [] } }, 'where.tags.$eq'],
    ['nested under $and (lowered)', ['and', ['amount', '>', 5], ['tags', 'eq', ['a']]], 'where.$and[1].tags'],
    ['nested under $or', { $or: [{ stage: 'won' }, { tags: ['a'] }] }, 'where.$or[1].tags'],
    ['nested under $not', { $not: { tags: { $eq: ['a'] } } }, 'where.$not.tags.$eq'],
  ])('refuses an ARRAY in the equality slot — %s', (_label, where, path) => {
    const err = refusalOf(() => parseFilterAST(where));
    // ADR-0112 class 1, both halves: on the face as it stood, every one of
    // these RETURNED — there was no error at all to carry either field.
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
    expect(err.message).toContain(`at ${path}.`);
  });

  it('the implicit-equality refusal names the slot and prescribes $in and $contains by their spec spellings', () => {
    const err = refusalOf(() => parseFilterAST([['tags', 'equals', ['a', 'b']]]));
    // The leading sentence is driver-memory's own for this condition, kept
    // verbatim (one condition, one wording across packages).
    expect(err.message).toMatch(
      /^The implicit-equality comparand on field "tags" requires a single comparable value, but received an array \(\["a","b"\]\) at where\.tags\./,
    );
    // The ruling's prescription: the declared list operator and the
    // array-containment operator, spec spelling AND authoring spelling.
    expect(err.message).toContain('"one of these values" use {"$in": […]} (authoring: in)');
    expect(err.message).toContain(
      '"the stored list holds a value" on a multi-value field, {"$contains": "…"} (authoring: contains)',
    );
    expect(err.message).toContain('an $or of those for any-of');
    expect(err.message).toMatch(/The filter was NOT applied, .*UNFILTERED result set\.$/);
  });

  it('the $eq refusal names the operator it was written with, and the same two remedies', () => {
    const err = refusalOf(() => parseFilterAST({ tags: { $eq: ['a'] } }));
    expect(err.message).toMatch(
      /^Operator "\$eq" on field "tags" requires a single comparable value, but received an array \(\["a"\]\) at where\.tags\.\$eq\./,
    );
    expect(err.message).toContain('{"$in": […]} (authoring: in)');
    expect(err.message).toContain('{"$contains": "…"} (authoring: contains)');
    // A caller-supplied context keeps its prefix, as on every sibling arm.
    expect(refusalOf(() => assertListComparandShapes({ tags: ['a'] }, "find('deal')")).message)
      .toMatch(/^find\('deal'\): The implicit-equality comparand on field "tags"/);
  });

  it('every AST spelling that lowers to EQUALITY refuses an array — the vocabulary, read at source', () => {
    // Derived by LOWERING a scalar rather than from a hand list: a spelling is
    // an equality spelling when `[f, op, 'x']` lowers to the implicit form.
    // (`in` / `between` refuse a scalar probe outright — they are list
    // operators, so a throw here is a "no", not a failure.)
    const equality = [...VALID_AST_OPERATORS].filter((op) => {
      try {
        const lowered = parseFilterAST([['probe', op, 'x']]) as Record<string, unknown> | undefined;
        return lowered?.probe === 'x';
      } catch {
        return false;
      }
    });
    // Guards the loop from passing vacuously.
    expect(equality.sort()).toEqual(['=', '==', 'eq', 'equals']);
    for (const op of equality) {
      const err = refusalOf(() => parseFilterAST([['tags', op, ['a']]]));
      expect(err.code, op).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(err.status, op).toBe(400);
      expect(err.message, op).toMatch(/^The implicit-equality comparand on field "tags"/);
    }
  });

  it('the two prescribed operators are DECLARED — the refusal invents no spelling', () => {
    // The message spells `$in` / `in` and `$contains` / `contains` by hand
    // (`filter.zod.ts` imports the door, so deriving them would be a cycle).
    // This is what keeps them the vocabulary's own: both are keys of the
    // enforced operator schema, and each authoring spelling lowers to its `$`
    // spelling through the one AST table.
    const declared = Object.keys(FieldOperatorsSchema.shape);
    expect(declared).toContain('$in');
    expect(declared).toContain('$contains');
    expect(loweredOperatorOf('in')).toBe('$in');
    expect(loweredOperatorOf('contains')).toBe('$contains');
    // …and the prescribed spellings actually lower and pass this door.
    expect(parseFilterAST([['tags', 'in', ['a', 'b']]])).toEqual({ tags: { $in: ['a', 'b'] } });
    expect(parseFilterAST([['tags', 'contains', 'a']])).toEqual({ tags: { $contains: 'a' } });
    expect(parseFilterAST({ $or: [{ tags: { $contains: 'a' } }, { tags: { $contains: 'b' } }] }))
      .toEqual({ $or: [{ tags: { $contains: 'a' } }, { tags: { $contains: 'b' } }] });
  });

  it('LIT CONTROL — every scalar equality comparand keeps passing, null predicate first', () => {
    // `{ f: null }` and `$eq: null` ARE the has-no-value predicate (#5332);
    // the arm is array-shaped and nothing wider.
    expect(parseFilterAST({ tags: null })).toEqual({ tags: null });
    expect(parseFilterAST({ tags: { $eq: null } })).toEqual({ tags: { $eq: null } });
    expect(parseFilterAST([['tags', 'equals', null]])).toEqual({ tags: null });
    expect(parseFilterAST({ tags: 'a' })).toEqual({ tags: 'a' });
    expect(parseFilterAST({ n: 0 })).toEqual({ n: 0 });
    expect(parseFilterAST({ on: false })).toEqual({ on: false });
    expect(parseFilterAST({ tags: { $eq: '' } })).toEqual({ tags: { $eq: '' } });
    const day = new Date('2026-07-01T00:00:00.000Z');
    expect(parseFilterAST({ at: day })).toEqual({ at: day });
    expect(parseFilterAST({ at: { $eq: day } })).toEqual({ at: { $eq: day } });
    // #7597's promotion: a `{ $field }` comparand on an equality spelling is
    // lowered to `$eq` and is not an array — untouched.
    expect(parseFilterAST([['amount', '=', { $field: 'budget' }]]))
      .toEqual({ amount: { $eq: { $field: 'budget' } } });
  });

  it('LIT CONTROL — every array-valued operator the vocabulary declares keeps its array', () => {
    // Read off the enforced schema rather than listed: the operators whose
    // declared comparand ACCEPTS an array — exactly the list operators, so a
    // fourth array-valued operator added to the schema lands in the loop
    // without an edit here. [#19889] `$eq` left the set when the schema door
    // began refusing an array there too (ruling A, record 5805248669), in this
    // face's words — `filter-equality-array-schema-door.test.ts` pins that
    // door. [#19886] `$ne` left it the same way (ruling A, record 5805254639),
    // and it is no longer skipped below: the set IS the list operators now, and
    // `filter-ne-array-schema-door.test.ts` pins the `$ne` door.
    const arrayValued = Object.keys(FieldOperatorsSchema.shape).filter((op) =>
      FieldOperatorsSchema.safeParse({ [op]: ['a', 'b'] }).success);
    expect(arrayValued.sort()).toEqual(['$between', '$in', '$nin']);
    for (const op of arrayValued) {
      expect(parseFilterAST({ tags: { [op]: ['a', 'b'] } }), op).toEqual({ tags: { [op]: ['a', 'b'] } });
    }
    // The empty lists stay the declared predicates they are.
    expect(parseFilterAST({ tags: { $in: [] } })).toEqual({ tags: { $in: [] } });
    expect(parseFilterAST({ tags: { $nin: [] } })).toEqual({ tags: { $nin: [] } });
    // `$contains` is declared with a STRING comparand — the array-containment
    // operator takes ONE member, which is why the refusal says `"…"`.
    expect(FieldOperatorsSchema.safeParse({ $contains: ['a'] }).success).toBe(false);
  });

  it('an array INSIDE a no-$-key field spec is still not descended into', () => {
    // The nested-relation / deep-equality boundary this door has always kept:
    // the arm judges the field's own slot, never the inside of a nested
    // condition it does not walk.
    expect(parseFilterAST({ author: { tags: ['a'] } })).toEqual({ author: { tags: ['a'] } });
  });

  // ── the `$ne` arm, ruling A on #19886 (record 5805254639) ─────────────
  //
  // 「The shared comparand-shape face refuses an array under `$ne` for every
  // driver … one remedy text, naming the declared list-negation operator by
  // its spec spelling」 — ⛔ no alias, ⛔ no window. A `todo` stood here until
  // that ruling, because a green pin would have read as a ruling nobody made.
  // Before the arm, every row below RETURNED from this face (measured on
  // `origin/main` `9e7824a4`, and again by this PR's ablation).

  it.each([
    ['the lowered array form, "ne"', [['tags', 'ne', ['a']]], 'where.tags.$ne'],
    ['the lowered array form, "not_equals"', [['tags', 'not_equals', ['a', 'b']]], 'where.tags.$ne'],
    ['the lowered array form, "!="', [['tags', '!=', ['a']]], 'where.tags.$ne'],
    ['the object passthrough', { tags: { $ne: ['a'] } }, 'where.tags.$ne'],
    ['an EMPTY array — still an array in a one-value slot', { tags: { $ne: [] } }, 'where.tags.$ne'],
    ['nested under $and (lowered)', ['and', ['amount', '>', 5], ['tags', 'neq', ['a']]], 'where.$and[1].tags.$ne'],
    ['nested under $or', { $or: [{ stage: 'won' }, { tags: { $ne: ['a'] } }] }, 'where.$or[1].tags.$ne'],
    ['nested under $not', { $not: { tags: { $ne: ['a'] } } }, 'where.$not.tags.$ne'],
    ['beside a legal $eq on the same field', { tags: { $eq: 'x', $ne: ['a'] } }, 'where.tags.$ne'],
  ])('refuses an ARRAY under $ne — %s', (_label, where, path) => {
    const err = refusalOf(() => parseFilterAST(where));
    // ADR-0112 class 1, both halves.
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
    expect(err.message).toContain(`at ${path}.`);
    // The `$ne` sentence, never the equality slot's.
    expect(err.message).toMatch(/^Operator "\$ne" on field "tags" requires a single comparable value, but received an array/);
  });

  it('the $ne refusal names the operator and prescribes $nin, by its spec and authoring spellings, and nothing else', () => {
    const err = refusalOf(() => parseFilterAST([['tags', 'not_equals', ['a', 'b']]]));
    // The leading sentence is driver-memory's `arrayComparandError` for `$ne`,
    // word for word (one condition, one wording across packages).
    expect(err.message).toMatch(
      /^Operator "\$ne" on field "tags" requires a single comparable value, but received an array \(\["a","b"\]\) at where\.tags\.\$ne\. /,
    );
    // The ruling's prescription: the declared list-negation operator.
    expect(err.message).toContain('For "none of these values" use {"$nin": […]} (authoring: nin, not_in, notin).');
    expect(err.message).toMatch(/The filter was NOT applied, .*UNFILTERED result set\.$/);
    // ONE remedy: the equality slot's two operators are the wrong answer for
    // a negation, and `$notContains` (a STRING operator) is not a list one.
    expect(err.message).not.toContain('$in"');
    expect(err.message).not.toContain('$contains');
    expect(err.message).not.toContain('$notContains');
    // A caller-supplied context keeps its prefix, as on every sibling arm.
    expect(refusalOf(() => assertListComparandShapes({ tags: { $ne: ['a'] } }, "find('deal')")).message)
      .toMatch(/^find\('deal'\): Operator "\$ne" on field "tags"/);
  });

  it('every AST spelling that lowers to $ne refuses an array — the vocabulary, read at source', () => {
    // Found with a SCALAR probe: an array would now trip the very arm being
    // looked for. (`in` / `between` refuse a scalar outright; a throw is a "no".)
    const inequality = [...VALID_AST_OPERATORS].filter((op) => {
      try {
        const lowered = parseFilterAST([['probe', op, 'x']]) as Record<string, unknown> | undefined;
        const spec = lowered?.probe as Record<string, unknown> | undefined;
        return spec !== null && typeof spec === 'object' && Object.keys(spec).join() === '$ne';
      } catch {
        return false;
      }
    });
    // Guards the loop from passing vacuously.
    expect(inequality.sort()).toEqual(['!=', '<>', 'ne', 'neq', 'not_equals', 'notequals']);
    for (const op of inequality) {
      const err = refusalOf(() => parseFilterAST([['tags', op, ['a']]]));
      expect(err.code, op).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(err.status, op).toBe(400);
      expect(err.message, op).toMatch(/^Operator "\$ne" on field "tags"/);
    }
  });

  it('the prescribed operator is DECLARED and its spellings are the vocabulary\'s — the refusal invents nothing', () => {
    // `$nin` is spelled by hand in the shared text (`filter.zod.ts` imports
    // the face, so deriving it would be a cycle). What keeps it the
    // vocabulary's own: it is a key of the enforced operator schema, and the
    // spellings the message lists are EXACTLY the ones that lower to it.
    expect(Object.keys(FieldOperatorsSchema.shape)).toContain('$nin');
    const ninSpellings = [...VALID_AST_OPERATORS].filter((op) => loweredOperatorOf(op) === '$nin').sort();
    expect(ninSpellings).toEqual(['nin', 'not_in', 'notin']);
    const message = refusalOf(() => parseFilterAST({ tags: { $ne: ['a'] } })).message;
    expect(message).toContain(`(authoring: ${ninSpellings.join(', ')})`);
    // …and the prescribed spelling actually lowers and passes this face.
    expect(parseFilterAST([['tags', 'not_in', ['a', 'b']]])).toEqual({ tags: { $nin: ['a', 'b'] } });
    expect(parseFilterAST({ tags: { $nin: ['a', 'b'] } })).toEqual({ tags: { $nin: ['a', 'b'] } });
  });

  it('LIT CONTROL — every non-array $ne comparand keeps passing, the has-a-value predicate first', () => {
    // `$ne: null` IS the has-a-value predicate (#5332); the arm is array-shaped
    // and nothing wider.
    expect(parseFilterAST({ tags: { $ne: null } })).toEqual({ tags: { $ne: null } });
    expect(parseFilterAST([['tags', 'ne', null]])).toEqual({ tags: { $ne: null } });
    expect(parseFilterAST({ tags: { $ne: 'a' } })).toEqual({ tags: { $ne: 'a' } });
    expect(parseFilterAST([['tags', '!=', 'a']])).toEqual({ tags: { $ne: 'a' } });
    expect(parseFilterAST({ n: { $ne: 0 } })).toEqual({ n: { $ne: 0 } });
    expect(parseFilterAST({ on: { $ne: false } })).toEqual({ on: { $ne: false } });
    expect(parseFilterAST({ tags: { $ne: '' } })).toEqual({ tags: { $ne: '' } });
    const day = new Date('2026-07-01T00:00:00.000Z');
    expect(parseFilterAST({ at: { $ne: day } })).toEqual({ at: { $ne: day } });
    // `$ne` is one of the six comparisons a `{ $field }` reference may be the
    // whole comparand of — not an array, untouched.
    expect(parseFilterAST([['amount', '!=', { $field: 'budget' }]]))
      .toEqual({ amount: { $ne: { $field: 'budget' } } });
  });

  it('a $ne array INSIDE a no-$-key field spec is still not descended into', () => {
    // The nested-relation / deep-equality boundary the equality arm keeps too:
    // this face judges the field's own operator map, never the inside of a
    // nested condition it does not walk.
    expect(parseFilterAST({ author: { tags: { $ne: ['a'] } } })).toEqual({ author: { tags: { $ne: ['a'] } } });
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
      // The 2026-09-23 equality-slot arm (#19757): two prescriptions plus the
      // received list. The long list is the tallest this arm assembles — its
      // preview is cut at the shared 60-char bound — so it is the row that
      // proves the "NOT applied" tail survives the wire.
      { close_date: ['a'] },
      { close_date: { $eq: ['a'] } },
      { close_date: ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc'] },
      { $or: [{ close_date: [] }] },
      // The `$ne` arm (#19886, ruling A): one prescription plus the received
      // list, the long list cut at the same 60-char preview bound.
      { close_date: { $ne: ['a'] } },
      { close_date: { $ne: ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc'] } },
      { $not: { $or: [{ close_date: { $ne: [] } }] } },
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
    // ⚠️ Two rows used to sit HERE, pinning `{ tags: { $eq: ['a', 'b'] } }` and
    // `{ tags: ['a', 'b'] }` as shapes this door passes through for the driver
    // to answer. Both are INVERTED by the 2026-09-23 ruling (#19757) — they
    // pinned exactly the open slot that ruling closes — and now live, refused,
    // in the equality-slot section below. ⛔ Not re-spelled into some other
    // passing shape: what they asserted is no longer true of this door.
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

// ── the one-value arm for every other scalar operator (#21448) ─────────────
//
// The triage ruling (record 5958292323): "A list at a scalar operator (`$gt`,
// `$gte`, `$lt`, `$lte`, `$eq`, `$ne` and the rest of the scalar set) is a
// shape error, whatever the column type." `$eq` and `$ne` keep their own arms
// and remedies (above). Before this arm every row below RETURNED from this
// face (measured on `origin/main` `b94a2a727`, and again by this PR's
// ablation), and the analytics lowering bound the list's first member.

describe('[#21448] a LIST at every other scalar operator is refused — whatever the column type', () => {
  /** The declared vocabulary, read off the enforced operator schema. */
  const declared = Object.keys(FieldOperatorsSchema.shape);
  /** Its list half: the operators whose enforced slot ACCEPTS an array. */
  const arrayValued = declared.filter((op) => FieldOperatorsSchema.safeParse({ [op]: ['a', 'b'] }).success);
  /** The arm's operators: the one-value half, less the equality pair and its own two arms. */
  const oneValueOperators = declared.filter((op) => !arrayValued.includes(op) && op !== '$eq' && op !== '$ne');

  it('the judged operators are the schema\'s one-value half, derived — a new scalar operator joins by itself', () => {
    // Guards the loops below from passing vacuously, and names what the
    // derivation finds today: the ordering, text and flag operators.
    expect(arrayValued.sort()).toEqual(['$between', '$in', '$nin']);
    expect([...oneValueOperators].sort()).toEqual([
      '$contains', '$empty', '$endsWith', '$exists', '$gt', '$gte', '$icontains', '$ilike',
      '$like', '$lt', '$lte', '$notContains', '$null', '$startsWith',
    ]);
  });

  it.each([
    ['a pair', [10, 99]],
    ['one member', [10]],
    ['two strings', ['a', 'z']],
    ['an EMPTY list — still a list in a one-value slot', []],
  ])('refuses %s at every one of them, in the envelope, naming the operator and the path', (_label, list) => {
    for (const op of oneValueOperators) {
      const err = refusalOf(() => assertListComparandShapes({ f: { [op]: list } }));
      // ADR-0112 class 1, both halves.
      expect(err.code, op).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(err.status, op).toBe(400);
      expect(err.message, op).toMatch(
        new RegExp(`^Operator "\\${op}" on field "f" requires a single comparable value, but received an array `),
      );
      expect(err.message, op).toContain(`at where.f.${op}.`);
    }
  });

  it.each([
    ['nested under $and', { $and: [{ g: 1 }, { f: { $gt: [1] } }] }, 'where.$and[1].f.$gt'],
    ['nested under $or', { $or: [{ g: 1 }, { f: { $contains: ['a'] } }] }, 'where.$or[1].f.$contains'],
    ['nested under $not', { $not: { f: { $lte: [1, 2] } } }, 'where.$not.f.$lte'],
    ['beside a legal operator on the same field', { f: { $gte: 1, $lt: [9] } }, 'where.f.$lt'],
  ])('refuses it at its own path — %s', (_label, where, path) => {
    const err = refusalOf(() => parseFilterAST(where));
    expect(err.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(err.status).toBe(400);
    expect(err.message).toContain(`at ${path}.`);
  });

  it('every AST spelling that carries its value to one of these operators refuses a list — the FilterArray spelling', () => {
    // Derived by LOWERING one value: a spelling carries its value when
    // `[f, op, 'a']` lowers to `{ f: { $op: 'a' } }` with `$op` in the arm's
    // set. (`is_null` and friends lower to a hard-coded flag and carry no value,
    // so they are not this loop's.)
    const carrying = [...VALID_AST_OPERATORS].filter((op) => {
      try {
        const spec = (parseFilterAST([['f', op, 'a']]) as Record<string, unknown> | undefined)?.f;
        if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false;
        const [key, value] = Object.entries(spec as Record<string, unknown>)[0] ?? [];
        return key !== undefined && oneValueOperators.includes(key) && value === 'a';
      } catch {
        return false;
      }
    });
    // Guards the loop: the twenty ordering spellings and the text spellings.
    expect(carrying).toEqual(expect.arrayContaining(['>', 'gt', 'after', '<=', 'before', 'contains', 'starts_with', 'like']));
    for (const op of carrying) {
      const err = refusalOf(() => parseFilterAST([['f', op, ['a', 'z']]]));
      expect(err.code, op).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(err.status, op).toBe(400);
      expect(err.message, op).toMatch(/^Operator "\$[A-Za-z]+" on field "f" requires a single comparable value/);
    }
  });

  it('names the list it received, and prescribes ONE value, $in and $between by their spec and authoring spellings', () => {
    const err = refusalOf(() => parseFilterAST({ amount: { $gt: [10, 99] } }));
    // The leading sentence is driver-memory's own for this condition.
    expect(err.message).toMatch(
      /^Operator "\$gt" on field "amount" requires a single comparable value, but received an array \(\[10,99\]\) at where\.amount\.\$gt\. Write ONE value\. /,
    );
    expect(err.message).toContain('"one of these values" use {"$in": […]} (authoring: in)');
    expect(err.message).toContain('for a range, {"$between": [min, max]} (authoring: between)');
    expect(err.message).toMatch(/The filter was NOT applied, .*UNFILTERED result set\.$/);
    // The two prescribed operators are DECLARED, and each authoring spelling
    // lowers to its `$` spelling through the one AST table.
    expect(declared).toEqual(expect.arrayContaining(['$in', '$between']));
    expect(loweredOperatorOf('in')).toBe('$in');
    expect(loweredOperatorOf('between')).toBe('$between');
    // A caller-supplied context keeps its prefix, as on every sibling arm.
    expect(refusalOf(() => assertListComparandShapes({ amount: { $gt: [10] } }, "find('deal')")).message)
      .toMatch(/^find\('deal'\): Operator "\$gt" on field "amount"/);
  });

  it('a list at a FLAG is this arm\'s too; a non-boolean scalar flag is still not this face\'s', () => {
    // How many values comes before which value: the boolean rule (#5347 /
    // #5369) is downstream of this face on every door and keeps judging a
    // scalar flag.
    expect(refusalOf(() => parseFilterAST({ deleted_at: { $null: [true] } })).message)
      .toMatch(/^Operator "\$null" on field "deleted_at" requires a single comparable value/);
    expect(parseFilterAST({ deleted_at: { $null: 'x' } })).toEqual({ deleted_at: { $null: 'x' } });
  });

  it('LIT CONTROL — the list operators keep their lists, one value passes, and the other arms keep their words', () => {
    // The controls the ruling names: a list at `$in` / `$nin`, a scalar at `$gt`.
    expect(parseFilterAST({ s: { $in: ['a', 'b'] } })).toEqual({ s: { $in: ['a', 'b'] } });
    expect(parseFilterAST({ s: { $nin: ['a'] } })).toEqual({ s: { $nin: ['a'] } });
    expect(parseFilterAST({ s: { $in: [] } })).toEqual({ s: { $in: [] } });
    expect(parseFilterAST({ n: { $between: [1, 5] } })).toEqual({ n: { $between: [1, 5] } });
    expect(parseFilterAST({ n: { $gt: 10 } })).toEqual({ n: { $gt: 10 } });
    // Every one-value comparand the vocabulary declares keeps passing.
    const day = new Date('2026-07-01T00:00:00.000Z');
    for (const where of [
      { n: { $gte: 'a' } }, { n: { $lt: day } }, { n: { $lte: { $field: 'm' } } },
      { s: { $contains: 'a' } }, { s: { $like: 'a%' } }, { s: { $exists: false } }, { s: { $empty: true } },
    ]) {
      expect(parseFilterAST(where), JSON.stringify(where)).toEqual(where);
    }
    // The older arms answer first, in their own words.
    expect(refusalOf(() => parseFilterAST({ n: { $gt: null } })).message)
      .toContain('does not accept a null comparand');
    expect(refusalOf(() => parseFilterAST({ s: { $eq: ['a'] } })).message).toContain('{"$contains": "…"}');
    expect(refusalOf(() => parseFilterAST({ s: { $ne: ['a'] } })).message).toContain('{"$nin": […]}');
    // Not judged here: an operator outside the vocabulary (refused downstream,
    // by name), a nested list inside `$in`, and a no-`$`-key field spec.
    expect(parseFilterAST({ s: { $wat: ['a'] } })).toEqual({ s: { $wat: ['a'] } });
    expect(parseFilterAST({ s: { $in: [['a']] } })).toEqual({ s: { $in: [['a']] } });
    expect(parseFilterAST({ acct: { amount: { $gt: [1] } } })).toEqual({ acct: { amount: { $gt: [1] } } });
  });

  it('the whole refusal fits under the 500-char client bound (#5423)', () => {
    // The sibling arms' bound test above, on this arm: one prescription pair
    // plus the received list, the long list cut at the shared 60-char preview
    // bound, at every one of its operators, under the same context prefix.
    for (const op of oneValueOperators) {
      for (const where of [
        { close_date: { [op]: ['a'] } },
        { close_date: { [op]: ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc'] } },
        { $not: { $or: [{ close_date: { [op]: [] } }] } },
      ]) {
        const err = refusalOf(() => parseFilterAST(where, "find('deal')"));
        expect(err.message.length, `${op} ${JSON.stringify(where)}`).toBeLessThan(500);
        expect(err.message, `${op} ${JSON.stringify(where)}`).toMatch(/UNFILTERED result set\.$/);
      }
    }
  });
});
