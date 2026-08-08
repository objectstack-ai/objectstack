// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5352] Every analytics filter refusal carries the ADR-0112 envelope — and
 * the refusal SET did not move.
 *
 * ## What was wrong
 *
 * `filter-normalizer.ts` refuses nine distinct malformed filters, and #3948 /
 * #5240 / #5325 / #5334 each argued the same case for one of them: a filter the
 * compiler cannot express must be REFUSED, because dropping the predicate does
 * not narrow the query, it WIDENS it to rows the author excluded — a chart
 * drawn over the whole dataset that looks like a working chart.
 *
 * All correct, and all invisible to the caller. Seven of the nine refusals were
 * bare `throw new Error(…)`. `rest-server.ts`'s `/analytics/dataset/query`
 * catch had no `code`/`status` to read, so it fell through to
 * `500 ANALYTICS_QUERY_FAILED` — which an author reads as "the platform is
 * broken" (not "your filter has a typo") and ops alerting counts as a 5xx.
 * The SAME misspelled operator on `find()` has answered `400 INVALID_FILTER`
 * since #3948, so one authoring mistake had two wire shapes chosen by which
 * face happened to catch it.
 *
 * ## The two halves of this file, and why the second one exists
 *
 * `describe('the refusal SET is unchanged')` pins WHICH inputs are refused and
 * what the accepted ones compile to. Every assertion in it passes both BEFORE
 * and AFTER #5352 — that is its entire job. #5352 changes the SHAPE of an
 * error and nothing about the judgement that produced it, and "we only touched
 * the envelope" is a claim worth being able to re-run rather than assert.
 *
 * `describe('every refusal carries the ADR-0112 envelope')` is the change. Run
 * it against pre-#5352 code and every case fails with `code` / `status`
 * `undefined`, while the block above stays green.
 *
 * The nine sites are enumerated deliberately: #5352's body listed four bullets
 * (five sites), but a half-enveloped module is indistinguishable from an
 * unenveloped one at the REST boundary — an author who writes `{$not: 5}`
 * deserves the same 400 as one who writes `{$nott: {…}}`.
 */

import { describe, it, expect } from 'vitest';
import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';

/** The ADR-0112 fields a refusal must carry. */
interface FilterRefusal extends Error {
  code?: unknown;
  status?: unknown;
}

/** Run the normalizer over a `where` and return the error it threw, if any. */
function refusalFor(where: unknown): FilterRefusal | undefined {
  try {
    normalizeAnalyticsFilterTree({ where });
    return undefined;
  } catch (e) {
    return e as FilterRefusal;
  }
}

/**
 * Every refusing site in `filter-normalizer.ts`, one input each.
 *
 * `issueBullet` records whether #5352's body named the site. The two `false`
 * rows are the sites the bullets missed — same file, same class, same one-line
 * change; leaving them bare would have kept the defect alive for two spellings
 * of the same authoring mistake.
 *
 * `addedAfter5352` marks a refusal that did not EXIST when #5352 ran, so
 * `issueBullet` has no meaning for it. The distinction is kept rather than
 * folded in because this file's ledger case is a historical record of what
 * #5352 covered — a row silently joining the `issueBullet: false` set would
 * rewrite that record — while the ledger's OTHER job, "this list is every
 * refusing site in the module", has to keep up with the module. A new site
 * arrives here so the envelope block below covers it automatically.
 */
const REFUSALS: Array<{
  name: string;
  where: unknown;
  message: RegExp;
  issueBullet: boolean;
  addedAfter5352?: string;
}> = [
  {
    name: 'operator outside the vocabulary (#3948)',
    where: { stage: { $sortOf: 'won' } },
    message: /Unsupported filter operator "\$sortOf" on "stage"/,
    issueBullet: true,
  },
  {
    name: 'field constraint with zero operators (#5240)',
    where: { stage: {} },
    message: /carries a field constraint with zero operators/,
    issueBullet: true,
  },
  {
    name: '$between without exactly two bounds',
    where: { amount: { $between: [10] } },
    message: /needs a two-element \[min, max\] array/,
    issueBullet: true,
  },
  // FLIPPED with the #5322 ruling: these two entries were "$and/$or with an
  // empty array". The refusing SITE is unchanged (the combinator guard #5352's
  // body bulleted, hence issueBullet stays true) but its empty-array half
  // graduated to a boolean identity — `{$and: []}` = TRUE, `{$or: []}` = FALSE,
  // asserted in ACCEPTED below — so the site's remaining refusal is the
  // non-array spelling, still carrying the same envelope.
  {
    name: '$and that is not an array',
    where: { $and: 'won' },
    message: /"\$and" requires an array of filter objects/,
    issueBullet: true,
  },
  {
    name: '$or that is not an array',
    where: { $or: { stage: 'won' } },
    message: /"\$or" requires an array of filter objects/,
    issueBullet: true,
  },
  {
    name: '$or branch that is not a filter object',
    where: { $or: [{ stage: 'won' }, 'nope'] },
    message: /branches must be filter objects/,
    issueBullet: true,
  },
  {
    name: '$not of a non-object',
    where: { $not: 5 },
    message: /"\$not" requires a filter object/,
    issueBullet: false,
  },
  {
    name: 'unsupported TOP-LEVEL operator',
    where: { $nor: [{ stage: 'won' }] },
    message: /Unsupported top-level filter operator "\$nor"/,
    issueBullet: false,
  },
  {
    name: 'a `where` array that cannot be lowered (#5334)',
    where: [{ stage: 'won' }],
    message: /received a 'where' array that is not a filter/,
    issueBullet: true,
  },
  {
    // [#6386] `undefined` in a comparand position. Before it, `{stage: undefined}`
    // was not refused at all — `buildNode` dropped the key, so a single-key
    // `where` ran with NO filter. The full seven-reading table, the `null`
    // control group and the position list live in
    // `filter-normalizer-undefined-comparand.test.ts`; this row exists so the
    // envelope block below covers the tenth site the way it covers the nine.
    name: 'an undefined comparand (#6386)',
    where: { stage: undefined },
    message: /comparand at "stage" is undefined/,
    issueBullet: false,
    addedAfter5352: '#6386',
  },
  {
    // [#6444] A field wrapper mixing $-operator keys with non-$ siblings.
    // Before it, the non-$ siblings were silently DROPPED — `fieldLeaves`'s
    // operator arm iterated `opKeys` only and returned, so
    // `{amount: {gte: 10, $lte: 20}}` (the missing-$ typo) lost its lower
    // bound with nothing to read. The full position list, the two-rewrite
    // message contract and the pure-shape control groups live in
    // `filter-normalizer-mixed-wrapper.test.ts`; this row exists so the
    // envelope block below covers the eleventh site the way it covers the ten.
    name: 'a mixed $/non-$ field wrapper (#6444)',
    where: { amount: { gte: 10, $lte: 20 } },
    message: /"amount" mixes \$-operator keys \(\$lte\) with non-\$ sibling key\(s\) "gte"/,
    issueBullet: false,
    addedAfter5352: '#6444',
  },
];

/**
 * Inputs that must keep being ACCEPTED, with what they compile to.
 *
 * The other half of "only the shape changed": a refusal-shape edit that
 * accidentally widened the refusal would show up here as a throw, and one that
 * changed the compiled predicate would show up as a tree mismatch. Both are
 * green before and after #5352.
 */
const ACCEPTED: Array<{ name: string; where: unknown; tree: unknown }> = [
  {
    name: 'implicit equality',
    where: { stage: 'won' },
    tree: { kind: 'leaf', member: 'stage', operator: 'equals', values: ['won'] },
  },
  {
    name: 'an explicit operator',
    where: { amount: { $gte: 10 } },
    // [#5526] `values` is `unknown[]`, so the number the author wrote stays a
    // number instead of being encoded to `'10'` and guessed back.
    tree: { kind: 'leaf', member: 'amount', operator: 'gte', values: [10] },
  },
  {
    name: '$between lowered to its two bounds',
    where: { amount: { $between: [10, 20] } },
    tree: {
      kind: 'and',
      children: [
        { kind: 'leaf', member: 'amount', operator: 'gte', values: [10] },
        { kind: 'leaf', member: 'amount', operator: 'lte', values: [20] },
      ],
    },
  },
  {
    name: 'a disjunction',
    where: { $or: [{ stage: 'won' }, { stage: 'lost' }] },
    tree: {
      kind: 'or',
      children: [
        { kind: 'leaf', member: 'stage', operator: 'equals', values: ['won'] },
        { kind: 'leaf', member: 'stage', operator: 'equals', values: ['lost'] },
      ],
    },
  },
  {
    // #5325: an empty `$in` is the FALSE constant, not an absent predicate.
    name: 'an empty $in as the FALSE constant (#5325)',
    where: { stage: { $in: [] } },
    tree: { kind: 'const', value: false },
  },
  {
    // #5325: `{}` constrains nothing, which is the constant TRUE (`null`).
    name: 'an empty filter object as TRUE (#5325)',
    where: {},
    tree: null,
  },
  {
    // #5322: the AND identity — a conjunction of zero conditions constrains
    // nothing. Was in REFUSALS ("requires a non-empty array") until the ruling.
    name: 'an empty $and as TRUE (#5322)',
    where: { $and: [] },
    tree: null,
  },
  {
    // #5322: the OR identity — a disjunction of zero conditions matches
    // nothing. Fail-closed for a scope whose disjunct list looped to zero items.
    name: 'an empty $or as the FALSE constant (#5322)',
    where: { $or: [] },
    tree: { kind: 'const', value: false },
  },
  {
    // #5334: `[]` is "no filter", not a failed filter.
    name: 'an empty `where` array as "no filter" (#5334)',
    where: [],
    tree: null,
  },
  {
    // #5334: the lowerable array spelling compiles to the object spelling's tree.
    name: 'a lowerable FilterArray (#5334)',
    where: [['stage', '=', 'won']],
    tree: { kind: 'leaf', member: 'stage', operator: 'equals', values: ['won'] },
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5352] the refusal SET is unchanged — only the error shape moved', () => {
  for (const c of REFUSALS) {
    it(`still REFUSES: ${c.name}`, () => {
      const err = refusalFor(c.where);
      expect(err, `${c.name} was accepted — the refusal set moved`).toBeInstanceOf(Error);
      // The message is pinned too: the REST fallback list still classifies by
      // message text for the non-filter families, so a wording drift here is
      // the kind of thing that must be a deliberate edit.
      expect(String(err?.message)).toMatch(c.message);
    });
  }

  for (const c of ACCEPTED) {
    it(`still ACCEPTS (and compiles identically): ${c.name}`, () => {
      expect(refusalFor(c.where), `${c.name} was refused — the refusal set moved`).toBeUndefined();
      expect(normalizeAnalyticsFilterTree({ where: c.where })).toEqual(c.tree);
    });
  }

  it('carries no `where` at all → no constraint, no error', () => {
    expect(normalizeAnalyticsFilterTree({})).toBeNull();
  });
});

describe('[#5352] every refusal carries the ADR-0112 envelope (INVALID_FILTER / 400)', () => {
  for (const c of REFUSALS) {
    it(`${c.name} → code INVALID_FILTER, status 400`, () => {
      const err = refusalFor(c.where);
      expect(err).toBeInstanceOf(Error);
      // Read as the REST boundary reads them — `error.code` / `error.status`,
      // the two fields `rest-server.ts` now classifies on.
      expect(err?.code, 'a refusal with no `code` lands as 500 ANALYTICS_QUERY_FAILED').toBe('INVALID_FILTER');
      expect(err?.status, 'a refusal with no `status` lands as 500 ANALYTICS_QUERY_FAILED').toBe(400);
    });
  }

  it('covers every refusing site in the module, including the two the issue did not list', () => {
    // A structural guard rather than a count for its own sake: #5352's body
    // enumerated four bullets, and enveloping only those would have left
    // `{$not: 5}` and `{$nor: […]}` answering 500 while their neighbours
    // answered 400 — the same one-condition-two-shapes split the issue is about.
    // Sites added AFTER #5352 are excluded from that historical set (see the
    // `addedAfter5352` note on REFUSALS) and enumerated on their own below.
    expect(REFUSALS.filter((c) => !c.issueBullet && !c.addedAfter5352).map((c) => c.name)).toEqual([
      '$not of a non-object',
      'unsupported TOP-LEVEL operator',
    ]);
    expect(REFUSALS.filter((c) => c.addedAfter5352).map((c) => `${c.name} · ${c.addedAfter5352}`)).toEqual([
      'an undefined comparand (#6386) · #6386',
      'a mixed $/non-$ field wrapper (#6444) · #6444',
    ]);
    expect(REFUSALS).toHaveLength(11);
  });
});
