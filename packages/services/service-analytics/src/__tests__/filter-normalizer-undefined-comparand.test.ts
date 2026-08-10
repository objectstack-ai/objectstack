// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6386, on #6050's ruling B] `undefined` in a comparand position of the
 * analytics `where` is REFUSED — `INVALID_FILTER` / 400 — and `null` is not.
 *
 * ## What was wrong
 *
 * #6050 ruled (2026-08-07, ruling B) that `undefined` where a comparand belongs
 * is refused, and landed it on `driver-sql` / `driver-turso`. #6125 pushed it to
 * this package's OTHER door, `read-scope-sql.ts` (PR #6390). This door — the
 * `where` the CALLER writes — had never been named by any of those rulings, and
 * it read the one shape SEVEN ways. Measured on `origin/main` (`5faa23ca3`) by
 * calling `normalizeAnalyticsFilterTree({ where })` directly:
 *
 * | `where`                       | normalized to                     | reading |
 * |---|---|---|
 * | `{d: undefined}`              | `null`                            | the WHOLE where dropped — query ran with NO filter |
 * | `{stage:'won', d: undefined}` | `stage equals 'won'`              | the `d` conjunct vanished in silence |
 * | `{$not: {d: undefined}}`      | `NOT (d set)`, i.e. `d IS NULL`   | a predicate the author never wrote |
 * | `{d: {$eq: undefined}}`       | `d equals [null]`                 | a value comparison, NOT `$eq: null`'s `notSet` |
 * | `{d: {$gt: undefined}}`       | `d gt [null]`                     | ditto |
 * | `{d: {$in: [undefined]}}`     | `d in [null]`                     | ditto |
 * | `{d: {$ne: undefined}}`       | `d notSet OR d notEquals [null]`  | ditto |
 *
 * The first three WIDEN, which is the failure mode `filter-normalizer.ts` has
 * forbidden inside `fieldLeaves` since #4128 — "NEVER drop: a missing predicate
 * does not narrow the query, it WIDENS it … That failure mode is #3650's" —
 * while its own entry line, `if (raw === undefined) continue;`, did exactly that.
 *
 * Row three is not merely "one conjunct fewer": #5146's null-safe rewrite splits
 * the leaf into `{d: {$null: false}} AND {d: undefined}`, the entry gate dropped
 * the second half, and the surviving guard was then negated — so a predicate GREW
 * OUT of a discarded leaf.
 *
 * ⚠️ The direction is silently WRONG RESULTS, not a permission bypass. Read scope
 * is compiled by the other door (`read-scope-sql.ts` → `applyReadScope`) and never
 * passes through here, so a caller still saw only rows it was entitled to — just
 * more of them than it asked for. What was lost is the ANSWER: an analytics
 * figure, a report total, an aggregate, wrong with nothing to read.
 *
 * ## The four blocks, and which one is the change
 *
 * `the seven measured readings` is the change: run it against pre-#6386 code and
 * all seven fail, because all seven COMPILE.
 *
 * `the null control group` is the risk. `null` is a declared comparand with
 * settled semantics (#5332 for the predicate, #5526 for the type), and the way
 * this change could do harm is by refusing it alongside `undefined` — the two
 * live one `===` apart in every polarity table in the module. Every row passes
 * both before and after, tree for tree.
 *
 * `the #5146 rewrite cannot swallow the leaf` is the gate-SIDE question. The gate
 * sits in `fieldLeaves`, downstream of `nullSafeNegationOperand`, so whether row
 * three throws or merely changes shape depends on the rewrite carrying the
 * author's spec through. Measured, not assumed — PR #6390 hit the same trap on
 * the sibling door, and its reasoning does not transfer (that module's polarity
 * tables are uniformly `=== null`; this one mixes `=== null` for `$eq`/`$ne`
 * with IDENTITY reads for `$null`/`$exists`).
 *
 * `what the sweep deliberately leaves alone` records the boundary of the ruling.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Ordinary direction, and with TWO independent knobs because the fix has two
 * halves that each cover a different subset:
 *
 *   - **A — restore `if (raw === undefined) continue;` only.** Predicted: the
 *     three FIELD-position rows go red (they compile again) plus the combinator
 *     rows, while the four OPERATOR/list rows stay GREEN — the `fieldLeaves`
 *     gate still catches those.
 *   - **B — remove the `assertDefinedComparands` call only.** Predicted: every
 *     refusal row goes red. ⚠️ B alone does NOT restore `origin/main`: with the
 *     entry line still deleted, `{d: undefined}` compiles to `equals [null]`
 *     rather than dropping to `null`. Only A+B together reproduce the old
 *     readings, which is the proof the two halves are independent.
 *
 * Both measured; the counts are in the PR body. The `null` control group stays
 * green under every configuration — it never depended on either half.
 *
 * ## Scope, so a later reader does not "finish the job"
 *
 * ⛔ `comparand()`'s `undefined` → `null` normalisation (#5526) and the strict
 * `wrapper[opKey] === null` branch that decides null-predicate-vs-value-comparison
 * (#5332) are RULED and are not touched. The gate refuses an INPUT; it reopens
 * neither. The normalisation is now unreachable from this door, and retiring it
 * is #5526's decision to make on its own terms, not a cleanup rider here.
 * ⛔ `@objectstack/formula` reads the same `undefined` as a THIRD semantics — "the
 * key is absent from the record" — the open question in #5299, untouched.
 * ⛔ `read-scope-sql.ts` is the sibling door and is not touched here; its own
 * refusal landed in PR #6390 with a different envelope on purpose (500: it
 * compiles a platform artifact, this door receives caller input).
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
 * The seven readings #6386 measured, one row each, with the `path` the refusal
 * must name. `wasReadAs` is the pre-fix normalisation — recorded so the row says
 * what it is protecting against, not merely that something throws.
 */
const MEASURED: Array<{ name: string; where: unknown; path: string; wasReadAs: string }> = [
  {
    name: '① a single-key where — the whole filter disappeared',
    where: { d: undefined },
    path: '"d"',
    wasReadAs: 'null — no predicate at all, so the query ran UNFILTERED',
  },
  {
    name: '② one conjunct of several — that conjunct disappeared',
    where: { stage: 'won', d: undefined },
    path: '"d"',
    wasReadAs: "only `stage equals 'won'` survived",
  },
  {
    name: '③ inside a $not — a predicate GREW from the discarded leaf',
    where: { $not: { d: undefined } },
    path: '"d"',
    wasReadAs: 'NOT (d set) — i.e. `d IS NULL`, which the author never wrote',
  },
  {
    name: '④ $eq — a value comparison, not $eq: null’s null predicate',
    where: { d: { $eq: undefined } },
    path: '"d".$eq',
    wasReadAs: 'd equals [null]',
  },
  {
    name: '⑤ $gt — an ordering comparison against NULL, UNKNOWN for every row',
    where: { d: { $gt: undefined } },
    path: '"d".$gt',
    wasReadAs: 'd gt [null]',
  },
  {
    name: '⑥ a member of a $in list',
    where: { d: { $in: [undefined] } },
    path: '"d".$in[0]',
    wasReadAs: 'd in [null]',
  },
  {
    name: '⑦ $ne — the null-safe guard wrapped a comparison against NULL',
    where: { d: { $ne: undefined } },
    path: '"d".$ne',
    wasReadAs: 'd notSet OR d notEquals [null]',
  },
];

/**
 * Comparand positions beyond the issue's seven, measured in the same round.
 *
 * Two of them are where this gate deliberately diverges from `read-scope-sql`'s
 * twin, and in both cases because THIS module accepts the enclosing shape that
 * one refuses outright — so a "comparand is undefined" answer is the truest
 * thing to say here and would have been a mislabel there.
 */
const BEYOND_THE_TABLE: Array<{ name: string; where: unknown; path: string; wasReadAs: string }> = [
  {
    name: 'a member of the BARE-ARRAY implicit $in (twin refuses the array itself)',
    where: { d: [1, undefined] },
    path: '"d"[1]',
    wasReadAs: 'd in [1, null]',
  },
  {
    name: "a $between bound — lowered to the leaf's comparand",
    where: { d: { $between: [undefined, 5] } },
    path: '"d".$between[0]',
    wasReadAs: 'd gte [null] AND d lte [5]',
  },
  {
    name: 'a member of a $nin list',
    where: { d: { $nin: [undefined] } },
    path: '"d".$nin[0]',
    wasReadAs: 'd notSet OR d notIn [null]',
  },
  {
    name: 'the LIKE family, whose comparand the spec declares a string',
    where: { d: { $contains: undefined } },
    path: '"d".$contains',
    wasReadAs: "d contains [null] — LIKE '%null%' since #5526",
  },
  {
    name: 'a NESTED relation, refused on the DOTTED member (twin refuses nesting itself)',
    where: { profile: { verified: undefined } },
    path: '"profile.verified"',
    wasReadAs: 'profile.verified equals [null]',
  },
  {
    name: 'a branch of a $and',
    where: { $and: [{ d: undefined }] },
    path: '"d"',
    wasReadAs: 'null — the branch reduced to TRUE and the $and to nothing',
  },
  {
    name: 'ONE branch of a $or — TRUE absorbed the whole disjunction (#5325)',
    where: { $or: [{ d: undefined }, { stage: 1 }] },
    path: '"d"',
    wasReadAs: 'null — the surviving `stage` branch was absorbed too, so EVERY row',
  },
];

/**
 * `null` — the comparand that must NOT move. One row per position the sweep
 * touches, each with the tree it compiled to before this change and must still.
 */
const NULL_CONTROL: Array<{ name: string; where: unknown; tree: unknown }> = [
  {
    name: '{d: null} → the null predicate (#5332)',
    where: { d: null },
    tree: { kind: 'leaf', member: 'd', operator: 'notSet', values: [] },
  },
  {
    name: '{$eq: null} → notSet, the SAME predicate as {d: null} (#5332)',
    where: { d: { $eq: null } },
    tree: { kind: 'leaf', member: 'd', operator: 'notSet', values: [] },
  },
  {
    name: '{$ne: null} → set, and it stays total (no null guard)',
    where: { d: { $ne: null } },
    tree: { kind: 'leaf', member: 'd', operator: 'set', values: [] },
  },
  {
    name: '{$gt: null} → a real comparison binding NULL (#5526)',
    where: { d: { $gt: null } },
    tree: { kind: 'leaf', member: 'd', operator: 'gt', values: [null] },
  },
  {
    name: '{$in: [null]} → a list member, not a predicate',
    where: { d: { $in: [null] } },
    tree: { kind: 'leaf', member: 'd', operator: 'in', values: [null] },
  },
  {
    name: '{$nin: [null]} → null-safe guarded (#5298)',
    where: { d: { $nin: [null] } },
    tree: {
      kind: 'or',
      children: [
        { kind: 'leaf', member: 'd', operator: 'notSet', values: [] },
        { kind: 'leaf', member: 'd', operator: 'notIn', values: [null] },
      ],
    },
  },
  {
    name: '{$between: [null, 5]} → lowered to two bounds',
    where: { d: { $between: [null, 5] } },
    tree: {
      kind: 'and',
      children: [
        { kind: 'leaf', member: 'd', operator: 'gte', values: [null] },
        { kind: 'leaf', member: 'd', operator: 'lte', values: [5] },
      ],
    },
  },
  {
    name: "{$contains: null} → LIKE '%null%' (#5526)",
    where: { d: { $contains: null } },
    tree: { kind: 'leaf', member: 'd', operator: 'contains', values: [null] },
  },
  {
    name: '{$null: true} → notSet',
    where: { d: { $null: true } },
    tree: { kind: 'leaf', member: 'd', operator: 'notSet', values: [] },
  },
  {
    name: '{$exists: false} → notSet',
    where: { d: { $exists: false } },
    tree: { kind: 'leaf', member: 'd', operator: 'notSet', values: [] },
  },
  {
    name: '{$not: {d: null}} → NOT(notSet), no guard (already total)',
    where: { $not: { d: null } },
    tree: { kind: 'not', child: { kind: 'leaf', member: 'd', operator: 'notSet', values: [] } },
  },
  {
    name: '{$not: {d: {$ne: null}}} → NOT(set), the #5332 arm of the guard table',
    where: { $not: { d: { $ne: null } } },
    tree: { kind: 'not', child: { kind: 'leaf', member: 'd', operator: 'set', values: [] } },
  },
  {
    name: '{d: [1, null]} → a bare-array $in carrying null',
    where: { d: [1, null] },
    tree: { kind: 'leaf', member: 'd', operator: 'in', values: [1, null] },
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#6386] the seven measured readings are now ONE refusal', () => {
  for (const c of [...MEASURED, ...BEYOND_THE_TABLE]) {
    it(`refuses ${c.name} (was: ${c.wasReadAs})`, () => {
      const err = refusalFor(c.where);
      expect(err, 'compiled instead of refusing — the #3650 widening is back').toBeInstanceOf(Error);
      expect(String(err?.message)).toContain(`comparand at ${c.path} is undefined`);
      // The envelope every refusal in this module carries since #5352, and the
      // one #6050 chose for this shape: caller input, so 400.
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
    });
  }

  it('says ONE thing, differing only in `path` and the field it repairs (#5240)', () => {
    // Erase the two things that legitimately vary — the position and the field
    // name the repair hints quote — and every message must be the same string.
    // Two variables rather than one: unlike `read-scope-sql`'s twin, this
    // wording PRESCRIBES (`{ "d": null }`), so the field appears outside the
    // path as well.
    const generic = [...MEASURED, ...BEYOND_THE_TABLE].map((c) => {
      const field = c.path.replace(/^"/, '').replace(/".*$/, '');
      const err = refusalFor(c.where);
      // ⚠️ Load-bearing, and measured: without it this case is VACUOUSLY green
      // whenever nothing throws — every row maps to the same `"undefined"`
      // string, the set has one member, and a set-size assertion reads that as
      // "one wording". Removing the gate turned all 14 rows silent and this
      // case stayed green until the guard was added.
      expect(err, `${c.name} did not refuse — the wording check would pass on nothing`).toBeInstanceOf(Error);
      return String(err?.message)
        .replace(`comparand at ${c.path} is`, 'comparand at <path> is')
        // `split`/`join` rather than `replaceAll` — this package's tsconfig `lib`
        // predates ES2021, and a new tsc error here would widen a shrink-only
        // ledger (`check:type-check-debt`).
        .split(`"${field}"`).join('"<field>"');
    });
    expect(new Set(generic).size, `expected one wording, got:\n${[...new Set(generic)].join('\n\n')}`).toBe(1);
  });

  it('names the two repairs and the producer to fix, not just the refusal', () => {
    const message = String(refusalFor({ d: undefined })?.message);
    // The author's two legitimate spellings…
    expect(message).toContain('{ "d": null }');
    expect(message).toContain('{ "d": { "$null": true } }');
    expect(message).toContain('omit the key entirely');
    // …both consequences it used to have, since this door has two…
    expect(message).toContain('the key was dropped outright');
    expect(message).toContain('became a comparison against null');
    // …and where the fix belongs. Unlike the sibling read-scope door, the
    // producer here IS the caller, so the message must not send them to an
    // admin-authored policy.
    expect(message).toContain('The producer to fix is whoever BUILT this where');
    expect(message).toContain('undefined cannot cross JSON');
  });
});

describe('[#6386] the `null` control group does not move', () => {
  for (const c of NULL_CONTROL) {
    it(`unchanged: ${c.name}`, () => {
      expect(refusalFor(c.where), 'null was refused alongside undefined — the harm direction').toBeUndefined();
      expect(treeFor(c.where)).toEqual(c.tree);
    });
  }

  it('distinguishes null from undefined in the SAME position, both operators', () => {
    // The whole risk in one assertion: the two are one `===` apart in every
    // polarity table in the module, so a `== null` anywhere would collapse them.
    expect(treeFor({ d: { $eq: null } })).toEqual({ kind: 'leaf', member: 'd', operator: 'notSet', values: [] });
    expect(refusalFor({ d: { $eq: undefined } })?.code).toBe('INVALID_FILTER');
    expect(treeFor({ d: { $ne: null } })).toEqual({ kind: 'leaf', member: 'd', operator: 'set', values: [] });
    expect(refusalFor({ d: { $ne: undefined } })?.code).toBe('INVALID_FILTER');
  });

  it('an ABSENT `where` is still "no constraint", not a refusal', () => {
    // `lowerAnalyticsWhere` answers `null` for these before `buildNode` runs.
    // The refusal is about a KEY INSIDE a `where`; a missing `where` is the
    // legitimate way to say "no filter" and must stay silent.
    expect(treeFor(undefined)).toBeNull();
    expect(normalizeAnalyticsFilterTree({})).toBeNull();
    expect(treeFor({})).toBeNull();
    expect(treeFor([])).toBeNull();
  });
});

describe('[#6386] the #5146 rewrite cannot swallow the leaf — the gate side is load-bearing', () => {
  // The gate lives in `fieldLeaves`, DOWNSTREAM of `nullSafeNegationOperand`, so
  // `{$not: {…}}` throws only if the rewrite carries the author's spec through.
  // One case per rewrite path that can carry a swept comparand.
  const REWRITE_PATHS: Array<{ name: string; where: unknown; path: string }> = [
    {
      name: "`requireValue` — pushes {k: {$null: false}}, {k: spec}; spec kept by reference",
      where: { $not: { d: undefined } },
      path: '"d"',
    },
    {
      name: '`requireValue` via an operator spec',
      where: { $not: { d: { $eq: undefined } } },
      path: '"d".$eq',
    },
    {
      name: '`allowNull` — pushes {$or: [{k: {$null: true}}, {k: spec}]} ($ne’s polarity)',
      where: { $not: { d: { $ne: undefined } } },
      path: '"d".$ne',
    },
    {
      name: 'the nested-relation recursion, which guards the DOTTED member',
      where: { $not: { profile: { verified: undefined } } },
      path: '"profile.verified"',
    },
    {
      name: 'a list member inside a negation',
      where: { $not: { d: { $in: [undefined] } } },
      path: '"d".$in[0]',
    },
  ];

  for (const c of REWRITE_PATHS) {
    it(`throws rather than changing shape: ${c.name}`, () => {
      const err = refusalFor(c.where);
      expect(err, 'the rewrite swallowed the leaf and the gate blessed the new shape').toBeInstanceOf(Error);
      expect(String(err?.message)).toContain(`comparand at ${c.path} is undefined`);
    });
  }

  it('there is no `none`-disposition case to write, and this is why', () => {
    // `nullGuardForFieldSpec` answers 'none' only when EVERY operator satisfies
    // `operatorIsNullTotal`, which for an `undefined` comparand is false on every
    // operator this gate sweeps ($eq/$ne compare `value === null`; $in/$nin need
    // an empty array). So the only field specs reaching 'none' while holding an
    // `undefined` are the `$null` / `$exists` flags — deliberately not swept, and
    // asserted below to compile exactly as before.
    expect(refusalFor({ $not: { d: { $null: undefined } } })).toBeUndefined();
    expect(treeFor({ $not: { d: { $null: undefined } } })).toEqual({
      kind: 'not',
      child: { kind: 'leaf', member: 'd', operator: 'set', values: [] },
    });
  });
});

describe('[#6386] what the sweep deliberately leaves alone', () => {
  it('$null / $exists carry a declared BOOLEAN flag, not a comparand', () => {
    // Same call as `read-scope-sql`'s twin. ⚠️ The two modules read the flag
    // DIFFERENTLY — identity here, truthiness there — so this module answers
    // `{$null: undefined}` with `set` while that one answers `IS NOT NULL` by a
    // different route. Which reading is right is the boolean-DOMAIN question
    // (#5347 / #5369, measured on the sibling door as #6387); refusing it here as
    // an "undefined comparand" would decide it sideways and mislabel a flag.
    expect(treeFor({ d: { $null: undefined } })).toEqual({ kind: 'leaf', member: 'd', operator: 'set', values: [] });
    expect(treeFor({ d: { $exists: undefined } })).toEqual({ kind: 'leaf', member: 'd', operator: 'set', values: [] });
  });

  it('a combinator with an undefined value gets its own, truer refusal', () => {
    // Deleting `buildNode`'s entry `continue` did not create four new refusals —
    // it let each key kind reach the branch that already had the best thing to
    // say. #5240's rule read in the direction that matters: a second wording for
    // a shape refused either way only sends the author to the wrong repair.
    expect(String(refusalFor({ $and: undefined })?.message)).toContain('"$and" requires an array of filter objects');
    expect(String(refusalFor({ $or: undefined })?.message)).toContain('"$or" requires an array of filter objects');
    expect(String(refusalFor({ $not: undefined })?.message)).toContain('"$not" requires a filter object');
    expect(String(refusalFor({ $nor: undefined })?.message)).toContain('Unsupported top-level filter operator');
    // …all still in the same envelope, so the REST face answers 400 for every one.
    for (const where of [{ $and: undefined }, { $or: undefined }, { $not: undefined }, { $nor: undefined }]) {
      expect(refusalFor(where)?.code).toBe('INVALID_FILTER');
      expect(refusalFor(where)?.status).toBe(400);
    }
  });

  it('a non-$ SIBLING of an operator is now REFUSED — the pin this case held flipped (#6444)', () => {
    // ⚠️ FLIPPED, not deleted. Until #6444 this case PINNED the measurement
    // that `{d: {$eq: 1, nested: <anything>}}` silently dropped `nested` — a
    // different defect from #6386's, filed separately per Prime Directive #10
    // and ruled Option A (refuse) on 2026-08-08. The full position list, the
    // two-rewrite message contract and the pure-shape control groups live in
    // `filter-normalizer-mixed-wrapper.test.ts`; this case keeps the SAME two
    // inputs the pin measured, so the record of what changed stays readable:
    // both rows compiled to `d equals [1]` then, both refuse now, and the
    // `undefined` row is why the refusal is value-INDEPENDENT — the drop never
    // read the sibling's value, and neither does the gate that replaced it.
    for (const where of [{ d: { $eq: 1, nested: undefined } }, { d: { $eq: 1, nested: 'x' } }]) {
      const err = refusalFor(where);
      expect(err, 'the non-$ sibling was silently dropped again — #6444 regressed').toBeInstanceOf(Error);
      expect(String(err?.message)).toContain('"d" mixes $-operator keys ($eq) with non-$ sibling key(s) "nested"');
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
    }
  });

  it('every ACCEPTED shape the module already had still compiles identically', () => {
    // The other half of "the refusal set moved by exactly one condition": a gate
    // that over-reached would show up here as a throw.
    expect(treeFor({ stage: 'won' })).toEqual({ kind: 'leaf', member: 'stage', operator: 'equals', values: ['won'] });
    expect(treeFor({ amount: { $between: [10, 20] } })).toEqual({
      kind: 'and',
      children: [
        { kind: 'leaf', member: 'amount', operator: 'gte', values: [10] },
        { kind: 'leaf', member: 'amount', operator: 'lte', values: [20] },
      ],
    });
    expect(treeFor({ stage: { $in: [] } })).toEqual({ kind: 'const', value: false });
    expect(treeFor({ $and: [] })).toBeNull();
    expect(treeFor({ $or: [] })).toEqual({ kind: 'const', value: false });
    expect(treeFor({ $not: {} })).toEqual({ kind: 'const', value: false });
    expect(treeFor([['stage', '=', 'won']])).toEqual({
      kind: 'leaf', member: 'stage', operator: 'equals', values: ['won'],
    });
  });
});
