// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6444, ruled Option A on 2026-08-08] A field wrapper mixing `$`-operator
 * keys with non-`$` sibling keys is REFUSED — `INVALID_FILTER` / 400 — and the
 * two pure shapes on either side of it do not move.
 *
 * ## What was wrong
 *
 * The value-independent sibling of #6386, in the same function. `fieldLeaves`'s
 * operator arm iterated `opKeys` only and returned, and the nested-relation
 * flatten sits after that early return — so with even one `$` key in the
 * wrapper, every non-`$` sibling was silently dropped, whatever its value.
 * Measured on `origin/main` (`1a53a0253`) by calling
 * `normalizeAnalyticsFilterTree({ where })` directly:
 *
 * | `where`                                   | normalized to             | reading |
 * |---|---|---|
 * | `{d: {$eq: 1, nested: 'x'}}`              | `d equals [1]`            | the `nested` conjunct vanished in silence |
 * | `{d: {$eq: 1, nested: undefined}}`        | `d equals [1]`            | same — value-independent, unlike #6386 |
 * | `{amount: {gte: 10, $lte: 20}}`           | `amount lte 20`           | the missing-`$` typo: the LOWER BOUND silently gone |
 * | `{$not: {d: {$eq: 1, nested: 'x'}}}`      | `NOT(d set AND d = 1)`    | the sibling vanished INSIDE the negation |
 * | `{$not: {d: {$null: true, nested: 'x'}}}` | `NOT(d set AND d notSet)` | a CONTRADICTION that negates to TRUE — every row |
 *
 * Every row WIDENS — a dropped conjunct does not narrow the query (#3650 /
 * #4128), the failure mode this module's own `MONGO_TO_CUBE_OP` miss-branch
 * comment forbids. The last row is the strangest: `nullGuardForFieldSpec`
 * judged the wrapper while the sibling still existed (`requireValue`), the
 * sibling then vanished in `fieldLeaves`, and the surviving guard was
 * contradictory — so the negation returned the WHOLE dataset.
 *
 * ## The ruling, and what the message owes (#6444, 2026-08-08)
 *
 * Option A — refuse, through the module's one envelope (#5352). Option B
 * (flatten the siblings as nested paths) was rejected: it would compile the
 * likely-real cause — a dropped `$` — into a predicate on a non-existent
 * member `amount.gte`. Because the refused shape has TWO legitimate repairs
 * answering two intents the module cannot tell apart, the message must name
 * the offending non-`$` key(s) and show BOTH rewrites: the operator spelling
 * (`gte` → `$gte`) and the nested-relation form — asserted below as the
 * message contract, not prose.
 *
 * ## The blocks, and which one is the change
 *
 * `the mixed wrapper is ONE refusal` is the change: run it against pre-#6444
 * code and every row fails, because every row COMPILES (dropping siblings).
 *
 * `the two pure shapes do not move` is the risk. The gate must move the
 * refusal set by EXACTLY the mixed shape: all-`$` wrappers keep compiling,
 * all-non-`$` wrappers keep flattening to dotted members. An over-reaching
 * gate shows up there as a throw.
 *
 * `the #5146 rewrite cannot swallow the wrapper` is the gate-side question,
 * same as #6386's: the gate sits in `fieldLeaves`, downstream of
 * `nullSafeNegationOperand`. For a MIXED wrapper the carry-through is
 * structural: a non-`$` key never satisfies `operatorIsNullTotal`, so
 * `nullGuardForFieldSpec` never answers `none` for one — the disposition is
 * always `requireValue`/`allowNull`, both of which push the spec by
 * reference, so the gate always sees the author's wrapper.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Ordinary direction, one knob (the `assertUnmixedFieldWrapper` call in
 * `fieldLeaves`). Predicted with the call removed: every refusal row in this
 * file goes red (the mixed shapes compile again, siblings dropped), the
 * flipped pin in `filter-normalizer-undefined-comparand.test.ts` goes red,
 * and the #6444 ledger row in `filter-refusal-envelope.test.ts` goes red —
 * while both pure-shape control blocks and the #6386/`null` groups stay
 * green (they never depended on this gate). One deliberate exception stays
 * green in THIS file too: `{d: {$eq: undefined, nested: 'x'}}` is refused by
 * the #6386 gate, not this one. Measured counts are in the PR body.
 *
 * ## Scope, so a later reader does not "finish the job"
 *
 * ⛔ `read-scope-sql.ts` is the sibling door; it has ALWAYS failed closed on
 * this shape (`compileField`'s non-`$`-key check) and is not touched — this
 * change makes the two doors give one answer, in this door's own envelope
 * (400: the `where` is caller input; that door compiles a platform artifact
 * and answers 500).
 * ⛔ `$null` / `$exists` flag semantics (#5347 / #5369 / #6387), `comparand()`
 * (#5526) and the null-predicate identity (#5332) are RULED elsewhere and
 * untouched; the `null` control group lives in
 * `filter-normalizer-undefined-comparand.test.ts` and did not move.
 * ⛔ The other compiler faces (#5930's five) are out of scope per the ruling;
 * the per-face statement is in PR #6444's body per the #6410 checklist.
 */

import { describe, it, expect } from 'vitest';
import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';

/** The ADR-0112 fields a refusal must carry. */
interface FilterRefusal extends Error {
  code?: unknown;
  status?: unknown;
}

function refusalFor(where: unknown): FilterRefusal | undefined {
  try {
    normalizeAnalyticsFilterTree({ where });
    return undefined;
  } catch (e) {
    return e as FilterRefusal;
  }
}

function treeFor(where: unknown): unknown {
  return normalizeAnalyticsFilterTree({ where });
}

/**
 * The mixed shapes, one per position the wrapper can sit in. `field` is the
 * member the refusal must name (for a nested mix, the DOTTED member —
 * `fieldLeaves` recurses before the gate sees it). `opKeys`/`nonOpKeys` are
 * the two lists the message quotes, in wrapper key order. `wasReadAs` is the
 * pre-fix normalisation — recorded so each row says what it protects against.
 */
const MIXED: Array<{
  name: string;
  where: unknown;
  field: string;
  opKeys: string[];
  nonOpKeys: string[];
  wasReadAs: string;
}> = [
  {
    name: '① operator + nested member in one wrapper',
    where: { d: { $eq: 1, nested: 'x' } },
    field: 'd',
    opKeys: ['$eq'],
    nonOpKeys: ['nested'],
    wasReadAs: "d equals [1] — `nested` dropped in silence",
  },
  {
    name: '② the same mix with an undefined sibling VALUE (value-independent)',
    where: { d: { $eq: 1, nested: undefined } },
    field: 'd',
    opKeys: ['$eq'],
    nonOpKeys: ['nested'],
    wasReadAs: 'd equals [1] — the drop never read the value (#6386 pinned this)',
  },
  {
    name: '③ the canonical agent typo — an operator missing its $',
    where: { amount: { gte: 10, $lte: 20 } },
    field: 'amount',
    opKeys: ['$lte'],
    nonOpKeys: ['gte'],
    wasReadAs: 'amount lte 20 — the LOWER BOUND silently gone',
  },
  {
    name: '④ a $between beside a stray member',
    where: { d: { $between: [1, 5], nested: 'x' } },
    field: 'd',
    opKeys: ['$between'],
    nonOpKeys: ['nested'],
    wasReadAs: 'd gte [1] AND d lte [5] — the range survived, the member did not',
  },
  {
    name: '⑤ a $null flag beside a stray member',
    where: { d: { $null: true, nested: 'x' } },
    field: 'd',
    opKeys: ['$null'],
    nonOpKeys: ['nested'],
    wasReadAs: 'd notSet — the flag survived, the member did not',
  },
  {
    name: '⑥ the mix one relation DOWN, refused on the DOTTED member',
    where: { profile: { verified: { $eq: 1, extra: 'x' } } },
    field: 'profile.verified',
    opKeys: ['$eq'],
    nonOpKeys: ['extra'],
    wasReadAs: 'profile.verified equals [1]',
  },
  {
    name: '⑦ inside a $and branch',
    where: { $and: [{ d: { $eq: 1, nested: 'x' } }] },
    field: 'd',
    opKeys: ['$eq'],
    nonOpKeys: ['nested'],
    wasReadAs: 'd equals [1]',
  },
  {
    name: '⑧ inside a $or branch — the branch quietly LOST a conjunct',
    where: { $or: [{ d: { gte: 1, $lte: 2 } }, { stage: 'won' }] },
    field: 'd',
    opKeys: ['$lte'],
    nonOpKeys: ['gte'],
    wasReadAs: "(d lte 2) OR (stage = 'won') — the branch widened, so the whole $or did",
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#6444] a mixed $/non-$ field wrapper is ONE refusal', () => {
  for (const c of MIXED) {
    it(`refuses ${c.name} (was: ${c.wasReadAs})`, () => {
      const err = refusalFor(c.where);
      expect(err, 'compiled instead of refusing — the #3650 sibling-drop widening is back').toBeInstanceOf(Error);
      const message = String(err?.message);
      // Names the field, the operator side, and — the ruling requirement —
      // every offending non-$ key.
      expect(message).toContain(`"${c.field}" mixes $-operator keys (${c.opKeys.join(', ')})`);
      for (const k of c.nonOpKeys) expect(message).toContain(`"${k}"`);
      // The envelope every refusal in this module carries since #5352: the
      // `where` is caller input, so 400. A bare toThrow() would carry one bit
      // where this defect has two (the ADR-0112 refusal-test rule).
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
    });
  }

  it('names EVERY offending sibling when there are several, not just the first', () => {
    const err = refusalFor({ d: { $eq: 1, a: 1, b: 2 } });
    expect(err).toBeInstanceOf(Error);
    const message = String(err?.message);
    expect(message).toContain('non-$ sibling key(s) "a", "b"');
    // Both get the operator rewrite, so the author repairs the wrapper once.
    expect(message).toContain('"a" → "$a"');
    expect(message).toContain('"b" → "$b"');
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
  });

  it('says ONE thing, differing only in the field and the two key lists (#5240)', () => {
    // Erase the parts that legitimately vary and every message must be the
    // same string. Restricted to the single-op/single-sibling rows so the
    // erased skeletons are comparable; the multi-sibling wording is asserted
    // in its own case above. Longest tokens first, so `"$gte"` is consumed
    // before a bare `"gte"` replacement could split it.
    const generic = MIXED.map((c) => {
      const err = refusalFor(c.where);
      // Load-bearing (measured on #6386's twin of this case): without it the
      // wording check is VACUOUSLY green when nothing throws — every row maps
      // to the same "undefined" string.
      expect(err, `${c.name} did not refuse — the wording check would pass on nothing`).toBeInstanceOf(Error);
      const k = c.nonOpKeys[0];
      return String(err?.message)
        .split(`"${c.field}.${k}"`).join('"<field>.<key>"')
        .split(`(${c.opKeys.join(', ')})`).join('(<ops>)')
        .split(`"$${k}"`).join('"$<key>"')
        .split(`"${k}" → `).join('"<key>" → ')
        .split(`"${k}"`).join('"<key>"')
        .split(`"${c.field}"`).join('"<field>"');
    });
    expect(new Set(generic).size, `expected one wording, got:\n${[...new Set(generic)].join('\n\n')}`).toBe(1);
  });

  it('shows BOTH legal rewrites — the two intents it cannot disambiguate (ruling req.)', () => {
    const message = String(refusalFor({ amount: { gte: 10, $lte: 20 } })?.message);
    // Intent 1 — an operator missing its $: the prefixed spelling, named
    // key-by-key and shown in place.
    expect(message).toContain('"gte" → "$gte"');
    expect(message).toContain('{ "amount": { "$gte": ... } }');
    // Intent 2 — a nested-relation member: a wrapper of its own, the dotted
    // member it compiles to, and the explicit $and (one JSON object cannot
    // spell the same field key twice).
    expect(message).toContain('{ "amount": { "gte": ... } }');
    expect(message).toContain('"amount.gte"');
    expect(message).toContain('"$and"');
    // …and why it refuses rather than picking: the drop it replaces WIDENED.
    expect(message).toContain('WIDENS');
    expect(message).toContain('read-scope-sql.ts');
  });
});

describe('[#6444] the #5146 rewrite cannot swallow the wrapper', () => {
  // The gate lives in `fieldLeaves`, DOWNSTREAM of `nullSafeNegationOperand`.
  // A mixed wrapper reaches it because a non-$ key never satisfies
  // `operatorIsNullTotal`, so `nullGuardForFieldSpec` never answers `none` for
  // one — `requireValue` and `allowNull` both push the author's spec by
  // REFERENCE. One case per rewrite path that can carry a mixed wrapper.
  const REWRITE_PATHS: Array<{ name: string; where: unknown; field: string }> = [
    {
      name: '`requireValue` — pushes {k: {$null: false}}, {k: spec}; spec kept by reference',
      where: { $not: { d: { $eq: 1, nested: 'x' } } },
      field: 'd',
    },
    {
      name: 'a null-total operator whose SIBLING forces the guard (was the every-row contradiction)',
      where: { $not: { d: { $null: true, nested: 'x' } } },
      field: 'd',
    },
    {
      name: '`$eq: null` beside a sibling — null-total op, still guarded because of the mix',
      where: { $not: { d: { $eq: null, nested: 'x' } } },
      field: 'd',
    },
    {
      name: 'the nested-relation recursion in `guardFieldEntry`, which guards the DOTTED member',
      where: { $not: { profile: { verified: { $eq: 1, extra: 2 } } } },
      field: 'profile.verified',
    },
  ];

  for (const c of REWRITE_PATHS) {
    it(`throws rather than changing shape: ${c.name}`, () => {
      const err = refusalFor(c.where);
      expect(err, 'the rewrite swallowed the wrapper and the gate blessed the new shape').toBeInstanceOf(Error);
      expect(String(err?.message)).toContain(`"${c.field}" mixes $-operator keys`);
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
    });
  }
});

describe('[#6444] the two pure shapes do not move', () => {
  it('an ALL-non-$ wrapper still flattens to the dotted member (the nested-relation path)', () => {
    // The pin the issue's own control row named: the ONLY reason the siblings
    // were droppable is that this legitimate path sat after the early return.
    expect(treeFor({ d: { nested: 'x' } })).toEqual({
      kind: 'leaf', member: 'd.nested', operator: 'equals', values: ['x'],
    });
    expect(treeFor({ a: { b: { c: 1 } } })).toEqual({
      kind: 'leaf', member: 'a.b.c', operator: 'equals', values: [1],
    });
    // A nested member carrying an OPERATOR wrapper (all-$ one level down) is
    // legal on both levels and keeps compiling.
    expect(treeFor({ profile: { verified: { $eq: true } } })).toEqual({
      kind: 'leaf', member: 'profile.verified', operator: 'equals', values: [true],
    });
  });

  it('an ALL-$ wrapper still compiles exactly as before, multi-operator included', () => {
    expect(treeFor({ amount: { $gte: 10, $lte: 20 } })).toEqual({
      kind: 'and',
      children: [
        { kind: 'leaf', member: 'amount', operator: 'gte', values: [10] },
        { kind: 'leaf', member: 'amount', operator: 'lte', values: [20] },
      ],
    });
    expect(treeFor({ d: { $null: true } })).toEqual({ kind: 'leaf', member: 'd', operator: 'notSet', values: [] });
    expect(treeFor({ d: { $exists: false } })).toEqual({ kind: 'leaf', member: 'd', operator: 'notSet', values: [] });
    expect(treeFor({ stage: { $in: [] } })).toEqual({ kind: 'const', value: false });
  });

  it('the neighbouring refusals keep their OWN wordings — the set moved by exactly one shape', () => {
    // #5240's zero-operator refusal is disjoint by construction ({} has no
    // keys of either kind) and must not borrow the mixed wording.
    expect(String(refusalFor({ stage: {} })?.message)).toContain('zero operators');
    // #3948's vocabulary refusal still owns the all-$-but-unknown wrapper.
    expect(String(refusalFor({ stage: { $sortOf: 'won' } })?.message)).toContain('Unsupported filter operator');
  });

  it('a mixed wrapper whose $-comparand is undefined is refused by the #6386 gate first', () => {
    // Measured ordering, pinned as a fact rather than a contract:
    // `assertDefinedComparands` runs at `fieldLeaves`'s entry, this gate in the
    // wrapper arm below it. Both refusals share the envelope, so the REST face
    // answers 400 either way — which is why the ordering is allowed to be an
    // implementation fact.
    const err = refusalFor({ d: { $eq: undefined, nested: 'x' } });
    expect(String(err?.message)).toContain('comparand at "d".$eq is undefined');
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
  });
});
