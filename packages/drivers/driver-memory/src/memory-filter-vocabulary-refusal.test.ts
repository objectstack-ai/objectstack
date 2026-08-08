// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5324/#5328] This driver refuses what it cannot evaluate — loudly, in the
 * ADR-0112 envelope, on BOTH of its filter faces.
 *
 * # One defect, two directions
 *
 * `normalizeFilterCondition` had two ways of not refusing a filter it could not
 * compile, in one `switch`:
 *
 * | shape | before | driver-sql, same input |
 * |---|---|---|
 * | unknown `$op` (`default: result[op] = val`) | handed to mingo → `MingoError` with no `code`, no `status` → a 500-shaped body | `INVALID_FILTER` / 400 |
 * | malformed `$between` (arm written conditionally) | the whole constraint vanished; `find` returned `[]` | `INVALID_FILTER` / 400 |
 *
 * One silently became a 500, the other silently became an empty result set —
 * opposite directions, one cause: **the shape that could not be evaluated was
 * not refused.** #3948 and #4436 already settled that an uncompilable filter is
 * a loud refusal rather than a silent answer, and #5240 settled that it speaks
 * one envelope; this is that rule reaching driver-memory's live query path.
 *
 * # Why "unknown operator" is written generically
 *
 * #5324 was filed on `$not`, which is a special case — a DECLARED combinator
 * this driver's live path did not implement (fixed by compiling it, see
 * `memory-driver-document-not.test.ts`, not by refusing it). The leak it was
 * filed on is general: `default:` passed EVERY unrecognised `$op` through, so
 * `{ name: { $sounds_like: 'x' } }` escaped the envelope by the identical route.
 * A `$not`-shaped fix would have left that half a 500.
 *
 * # Both faces
 *
 * Each case is asserted through `InMemoryDriver.find` (mingo) AND through
 * `match` (the reference matcher). They are one gate now, and this is the test
 * that says so — a regression that re-forks them fails here rather than being
 * discovered by a conformance table that only runs one of them (#5240).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const ROWS = [
  { id: '1', stage: 'won', owner: 'u1', score: 10 },
  { id: '2', stage: 'lost', owner: 'u2', score: 20 },
  { id: '3', stage: 'open', owner: 'u1', score: 30 },
];

/**
 * The exact text `driver-sql` produces for the same two conditions, copied from
 * `sql-driver.ts`. Kept as literals rather than imported: driver-memory does not
 * depend on driver-sql (and must not), so the twin invariant #4436 established
 * is held by pinning the other side's wording here — the same way
 * `memory-filter-refusal-envelope.test.ts` pins the envelope itself.
 */
const DRIVER_SQL_WORDING = {
  unknownOperator: (op: string, field: string) => `Unsupported filter operator "${op}" on field "${field}".`,
  malformedBetween: (field: string) => `Operator "$between" on field "${field}" requires a [min, max] value array.`,
};

describe('[#5324/#5328] a filter this driver cannot evaluate is refused, not answered', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.syncSchema('deal', {
      fields: {
        id: { type: 'text', name: 'id' },
        stage: { type: 'text', name: 'stage' },
        owner: { type: 'text', name: 'owner' },
        score: { type: 'number', name: 'score' },
      },
    });
    for (const row of ROWS) await driver.create('deal', { ...row });
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', { fields: ['id'], where: where as FilterCondition });
    return (rows as Array<Record<string, unknown>>).map((r) => String(r.id)).sort();
  };

  /** The refusal raised by the LIVE query path (normalize → mingo). */
  const liveRefusal = async (where: unknown): Promise<WireBearingError> => {
    try {
      await ids(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the live query path to refuse this filter, but it answered');
  };

  /** The refusal raised by the REFERENCE matcher, for the same filter. */
  const matcherRefusal = (where: unknown): WireBearingError => {
    try {
      ROWS.filter((r) => match(r, where));
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the reference matcher to refuse this filter, but it answered');
  };

  /** Every refusal in this package carries the same wire identity (#4436). */
  const expectEnvelope = (err: WireBearingError): void => {
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    // Driver-internal wording never ships to a client (#3867).
    expect(err.message).not.toContain('[driver-memory]');
  };

  // ── #5324: an operator outside the vocabulary ──────────────────────────────

  /**
   * Deliberately more than one, and deliberately not just `$not`. The passthrough
   * was generic, so the fix has to be — and each of these reached mingo
   * unchanged before it. `$where` / `$expr` are the sharpest: they are real
   * MongoDB operators, so an engine that implements them would have EVALUATED
   * an operator the Filter Protocol never declared.
   */
  const PSEUDO_OPERATORS: Array<[string, unknown]> = [
    ['$sounds_like', 'won'],
    ['$elemMatch', { stage: 'won' }],
    ['$size', 2],
    ['$type', 'string'],
    ['$mod', [2, 0]],
    ['$where', 'return true'],
    ['$expr', { $eq: ['$stage', 'won'] }],
    // Field-level `$not` — mingo implements it, so this one was not even an
    // error before: it silently evaluated an operator no other backend accepts
    // (driver-sql, driver-mongodb and objectql's `having` all refuse it) and
    // that this package's own matcher ignored, i.e. answered "matches every row".
    ['$not', { $eq: 'won' }],
  ];

  for (const [op, comparand] of PSEUDO_OPERATORS) {
    it(`refuses "${op}" in a field constraint, on both faces`, async () => {
      const where = { stage: { [op]: comparand } };

      const live = await liveRefusal(where);
      expectEnvelope(live);
      expect(live.message).toContain(DRIVER_SQL_WORDING.unknownOperator(op, 'stage'));

      const reference = matcherRefusal(where);
      expectEnvelope(reference);
      expect(reference.message).toBe(live.message);
    });
  }

  /**
   * [#5702] REPLACED, not re-spelled. This case used to be
   * `refuses "$options" with no "$regex" to modify, on both faces` and it pinned
   * the companion rule #5324 added while `$regex`/`$options` were still
   * ALLOWLISTED members of this driver's vocabulary (they were, because
   * plugin-auth's adapter produced `$regex` on the authentication path).
   *
   * That producer was flipped by #5710 and both spellings are retired by #4706,
   * so the companion rule has no surviving shape to judge: `$options` is now
   * refused on sight, with or without a `$regex` beside it. Keeping the old
   * assertion would have kept passing — the filter still throws — while pinning
   * a message that PRESCRIBES the retired form (`{ "$regex": "abc",
   * "$options": "i" }`), which is the failure mode where a green test documents
   * the wrong contract.
   */
  for (const [label, where, mustMention] of [
    ['a bare $regex', { stage: { $regex: 'W' } }, ['$regex', '$icontains']],
    ['a bare $options', { stage: { $options: 'i' } }, ['$options', '$icontains']],
    [
      '$regex WITH $options — one mistake, one fix',
      { stage: { $regex: 'W', $options: 'i' } },
      ['$regex', '$options', '$icontains'],
    ],
  ] as const) {
    it(`refuses ${label}, naming the replacement, on both faces`, async () => {
      const live = await liveRefusal(where);
      expectEnvelope(live);
      expect(live.message).toContain('RETIRED');
      for (const mention of mustMention) expect(live.message).toContain(mention);

      // Both faces, one sentence — the #5324 invariant, which is exactly what a
      // retirement must not be allowed to fork: this driver's matcher is the one
      // surface in the repo that really evaluated `$regex`.
      const reference = matcherRefusal(where);
      expectEnvelope(reference);
      expect(reference.message).toBe(live.message);
    });
  }

  it('names the position, so a refusal deep in a scope tree is actionable', async () => {
    const err = await liveRefusal({ $or: [{ owner: 'u1' }, { $and: [{ stage: { $sounds_like: 'won' } }] }] });
    expectEnvelope(err);
    expect(err.message).toContain('filter.$or[1].$and[0].stage');
  });

  it('refuses an undeclared combinator in a NODE position, on both faces', async () => {
    // The document-level half of the same passthrough: `normalizeFilterCondition`
    // copied any `$`-key it did not recognise straight into the mingo query.
    // `FilterConditionSchema` declares exactly three (LOGICAL_OPERATORS).
    for (const key of ['$nor', '$where', '$comment', '$text']) {
      const where = { [key]: [{ stage: 'won' }] };
      const live = await liveRefusal(where);
      expectEnvelope(live);
      expect(live.message).toContain(`Unsupported filter combinator "${key}"`);
      expect(matcherRefusal(where).message).toBe(live.message);
    }
  });

  // ── #5328: a malformed `$between` ──────────────────────────────────────────

  /**
   * The four malformed comparands the issue names. Every one of them used to
   * return `[]` from `find` — "the range matched nothing", indistinguishable
   * from a range that genuinely matched nothing — while the reference matcher
   * answered the OPPOSITE (it skipped the comparison, so every row matched).
   */
  const MALFORMED_BETWEEN: Array<[string, unknown]> = [
    ['not an array', 5],
    ['one element', [5]],
    ['three elements', [5, 10, 15]],
    ['an object instead of a [min, max] pair', { min: 5, max: 10 }],
    ['a string that merely looks like a range', '5,10'],
    ['null', null],
  ];

  for (const [label, comparand] of MALFORMED_BETWEEN) {
    it(`refuses $between with ${label}, on both faces`, async () => {
      const where = { score: { $between: comparand } };

      const live = await liveRefusal(where);
      expectEnvelope(live);
      expect(live.message).toContain(DRIVER_SQL_WORDING.malformedBetween('score'));

      const reference = matcherRefusal(where);
      expectEnvelope(reference);
      expect(reference.message).toBe(live.message);
    });
  }

  it('the two faces used to answer a malformed $between OPPOSITELY — pinned as one refusal', async () => {
    // The single sharpest fact in #5328: `{ score: { $between: 5 } }` returned
    // NO rows from `find` and EVERY row from `match`. One package, one filter,
    // two contradictory silent answers, neither of them a range.
    const where = { score: { $between: 5 } };
    expect((await liveRefusal(where)).message).toBe(matcherRefusal(where).message);
  });

  it('a well-formed $between is untouched, including the calendar-day rewrite it feeds', async () => {
    expect(await ids({ score: { $between: [10, 20] } })).toEqual(['1', '2']);
    expect(ROWS.filter((r) => match(r, { score: { $between: [10, 20] } })).map((r) => r.id)).toEqual(['1', '2']);
  });

  // ── malformed combinator operands, the same shape one position over ────────

  it('refuses a combinator operand that is not a filter node', async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ $or: 'nope' }, /requires an array of filter conditions/],
      [{ $and: { stage: 'won' } }, /requires an array of filter conditions/],
      [{ $or: [null] }, /not a filter condition object/],
      [{ $and: ['stage'] }, /not a filter condition object/],
      [{ $or: [[{ stage: 'won' }]] }, /not a filter condition object/],
      [{ $not: 'won' }, /not a filter condition object/],
      [{ $not: [{ stage: 'won' }] }, /not a filter condition object/],
    ];
    for (const [where, pattern] of cases) {
      const live = await liveRefusal(where);
      expectEnvelope(live);
      expect(live.message).toMatch(pattern);
      expect(matcherRefusal(where).message).toBe(live.message);
    }
  });

  // ── the gate did not catch anything it should not ──────────────────────────

  describe('every legal shape answers exactly as before', () => {
    const LEGAL: Array<[unknown, string[]]> = [
      [{ stage: 'won' }, ['1']],
      [{ score: { $gt: 15 } }, ['2', '3']],
      [{ score: { $gte: 10, $lte: 20 } }, ['1', '2']],
      [{ stage: { $in: ['won', 'lost'] } }, ['1', '2']],
      [{ stage: { $nin: ['won'] } }, ['2', '3']],
      [{ stage: { $ne: 'won' } }, ['2', '3']],
      [{ stage: { $contains: 'o' } }, ['1', '2', '3']],
      [{ stage: { $notContains: 'o' } }, []],
      [{ stage: { $startsWith: 'w' } }, ['1']],
      [{ stage: { $endsWith: 'n' } }, ['1', '3']],
      // Two regex-producing operators on one field — the `_multiRegex` promotion.
      [{ stage: { $startsWith: 'o', $endsWith: 'n' } }, ['3']],
      [{ stage: { $null: false } }, ['1', '2', '3']],
      [{ stage: { $null: true } }, []],
      [{ stage: { $exists: true } }, ['1', '2', '3']],
      // [#5702] `{ stage: { $regex: 'W', $options: 'i' } } → ['1']` used to sit
      // here, as a LEGAL shape. It is not one any more — #4706 retired both
      // spellings and this driver refuses them — so it moved to the refusal
      // table above rather than being deleted: the shape still has to have a
      // pinned answer, only the answer changed from a row list to a refusal.
      [{ score: { $between: [10, 20] } }, ['1', '2']],
      [{ $or: [{ stage: 'won' }, { owner: 'u2' }] }, ['1', '2']],
      [{ $and: [{ owner: 'u1' }, { score: { $gt: 15 } }] }, ['3']],
      [{ $not: { stage: 'won' } }, ['2', '3']],
      [{ $or: [{ stage: 'won' }, {}] }, ['1', '2', '3']],
      [{}, ['1', '2', '3']],
    ];

    for (const [where, expected] of LEGAL) {
      it(`${JSON.stringify(where)} → [${expected.join(', ')}]`, async () => {
        expect(await ids(where)).toEqual(expected);
      });
    }
  });

  it('the refusal does not depend on the RECORD being tested', () => {
    // Same argument as #5240's: both faces short-circuit, so a gate inside
    // evaluation would refuse for some rows and answer for others — a filter
    // that is valid or invalid by luck of the data. The walk runs first.
    for (const row of ROWS) {
      expect(() => match(row, { stage: 'nothing-matches-this', score: { $between: 5 } })).toThrow(/\[min, max\]/);
      expect(() => match(row, { $or: [{ stage: 'won' }, { owner: { $sounds_like: 'u1' } }] })).toThrow(/Unsupported filter operator/);
    }
  });
});
