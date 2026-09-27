// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20116] The SAVE door (`FilterConditionSchema`) refuses exactly the comparand
 * slots the QUERY faces refuse — at the top level and in every `$and` / `$or` /
 * `$not` member, and not inside a nested-relation condition, which the face
 * never descends. The two dataset carriers, charted through the analytics
 * `where` door that DOES descend a relation, refuse the same slots inside one
 * (§5), asking the same function.
 *
 * Measured on `origin/main` `af32cf9a` before the change: `DatasetSchema`
 * (filter and measure filter), a dashboard widget `filter` and a report
 * `runtimeFilter` each answered `success: true` for `{ stage: { $null: 'x' } }`,
 * `{ stage: { $exists: 'false' } }`, `{ stage: { $null: null } }`,
 * `{ amount: { $gt: null } }`, `{ stage: { $in: 'won' } }`,
 * `{ stage: { $in: ['won', null] } }`, `{ amount: { $between: [null, 5] } }`
 * and `{ stage: { $ne: ['won', 'lost'] } }`, while `assertListComparandShapes`
 * refused every one but the flags with `INVALID_FILTER` / 400 and every query
 * face refuses the flags (#5347 / #5369).
 *
 * ## What would make these pins worthless, and what stops it
 *
 * - **A hand list of arms.** §1 derives the operators from
 *   `FieldOperatorsSchema`'s declared shape, and the face-judged cells by
 *   asking the face about every operator × comparand in a shape battery. A new
 *   operator, or a new face arm on any battery shape, lands in the table by
 *   itself, and the door has to answer it the face's way.
 * - **A door that refuses everything.** §1 asserts EQUALITY of verdicts per
 *   cell, so an over-wide door is as red as a narrow one, and §4 runs the
 *   controls through both doors.
 * - **A new face arm refused in the face's raw words.** The door falls back to
 *   the face's own message for an arm it has no sentence for; §2 fails on the
 *   face's location clause (` at where.`) in any door message.
 */

import { describe, expect, it } from 'vitest';

import { StandardErrorCode } from '../api/errors.zod';
import { DashboardSchema } from '../ui/dashboard.zod';
import { DatasetMeasureSchema, DatasetSchema } from '../ui/dataset.zod';
import { ReportSchema } from '../ui/report.zod';
import { assertListComparandShapes } from './filter-comparand-shape';
import { isRefusedTextComparand } from './filter-text-comparand';
import { FieldOperatorsSchema, FilterConditionSchema } from './filter.zod';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };

/** The face's refusal of `where`, or `undefined` when it accepts. */
function faceRefusal(where: unknown): (Error & { code?: string; status?: number }) | undefined {
  try {
    assertListComparandShapes(where);
  } catch (error) {
    return error as Error & { code?: string; status?: number };
  }
  return undefined;
}

/** Issues whose path starts with `prefix` (dot-joined). */
function issuesUnder(result: Parsed, prefix: string): Issue[] {
  if (result.success) return [];
  return result.error!.issues.filter((i) => {
    const joined = i.path.join('.');
    return joined === prefix || joined.startsWith(`${prefix}.`);
  });
}

/** The one issue at exactly `path`, failing loudly on none or several. */
function issueAt(result: Parsed, path: string): Issue {
  expect(result.success, `expected a refusal at ${path}`).toBe(false);
  const issues = result.error!.issues.filter((i) => i.path.join('.') === path);
  expect(issues, `issues raised: ${JSON.stringify(result.error!.issues.map((i) => i.path))}`).toHaveLength(1);
  return issues[0]!;
}

/** Unwrap `.optional()` layers to the slot's own type name. */
function slotType(schema: unknown): string | undefined {
  let node = schema as { def?: { type?: string; innerType?: unknown } } | undefined;
  while (node?.def?.type === 'optional') node = node.def.innerType as typeof node;
  return node?.def?.type;
}

// ---------------------------------------------------------------------------
// The table: every declared operator × a battery of comparand shapes
// ---------------------------------------------------------------------------

/** The declared operator vocabulary — the enforced copy's own keys. */
const OPERATORS = Object.keys((FieldOperatorsSchema as unknown as { shape: Record<string, unknown> }).shape);

/** The slots `FieldOperatorsSchema` declares `z.boolean()` — the flag arm's operators. */
const BOOLEAN_SLOTS = OPERATORS.filter(
  (op) => slotType((FieldOperatorsSchema as unknown as { shape: Record<string, unknown> }).shape[op]) === 'boolean',
);

const DAY = new Date('2026-07-01T00:00:00.000Z');

/** One comparand of every shape class a face arm keys on, and the neighbours it must not. */
const BATTERY: ReadonlyArray<readonly [label: string, comparand: unknown]> = [
  ['a string', 'won'],
  ['the string "false"', 'false'],
  ['the empty string', ''],
  ['a number', 5],
  ['zero', 0],
  ['true', true],
  ['false', false],
  ['null', null],
  ['undefined', undefined],
  ['a Date', DAY],
  ['a { $field } reference', { $field: 'budget' }],
  ['a plain object', { a: 1 }],
  ['an empty list', []],
  ['a one-member list', ['won']],
  ['a pair', [1, 5]],
  ['a whitespace pair', [' ', 'M']],
  ['a triple', [1, 2, 3]],
  ['a list holding null', ['won', null]],
  ['a pair with a null MIN', [null, 5]],
  ['a pair with a blank MIN', ['', 5]],
  ['a pair with a { $field } MIN', [{ $field: 'a' }, 5]],
  ['a list of one { $field }', [{ $field: 'a' }]],
  ['a nested list', [[1]]],
];

/** What the query faces answer for one operator slot: the shape face, and the flag rule. */
function queryFacesRefuse(op: string, comparand: unknown): boolean {
  if (faceRefusal({ f: { [op]: comparand } })) return true;
  return BOOLEAN_SLOTS.includes(op) && typeof comparand !== 'boolean';
}

/** The pre-existing `$icontains` arm (#19514), which judges at any depth and is not this card's. */
function textArmRefuses(op: string, comparand: unknown): boolean {
  return op === '$icontains' && isRefusedTextComparand(comparand);
}

/** The positions the door must answer the face's way, and where the slot then sits. */
const POSITIONS: ReadonlyArray<readonly [label: string, wrap: (e: Record<string, unknown>) => unknown, prefix: string]> = [
  ['top level', (e) => e, 'f'],
  ['an $and member', (e) => ({ $and: [{ g: 1 }, e] }), '$and.1.f'],
  ['an $or member', (e) => ({ $or: [e] }), '$or.0.f'],
  ['under $not', (e) => ({ $not: e }), '$not.f'],
];

describe('#20116 §1 — the enumeration: the save door refuses exactly what the query faces refuse', () => {
  it('the table is derived, not hand-listed, and covers every arm the face and the flag rule judge', () => {
    // The vocabulary is the enforced copy's, so a new operator joins the table.
    expect(OPERATORS).toEqual(expect.arrayContaining(['$eq', '$ne', '$gt', '$in', '$nin', '$between', '$null', '$exists']));
    expect(BOOLEAN_SLOTS.sort()).toEqual(['$exists', '$null']);
    // Every operator the face judges today refuses at least one battery shape —
    // the guard against a battery that silently stopped reaching an arm.
    const faceJudged = OPERATORS.filter((op) => BATTERY.some(([, c]) => faceRefusal({ f: { [op]: c } })));
    expect(faceJudged.sort()).toEqual(['$between', '$eq', '$gt', '$gte', '$in', '$lt', '$lte', '$ne', '$nin']);
  });

  for (const [position, wrap, prefix] of POSITIONS) {
    it(`every operator × comparand cell, ${position}`, () => {
      const mismatches: string[] = [];
      let refused = 0;
      for (const op of OPERATORS) {
        for (const [label, comparand] of BATTERY) {
          const expected = queryFacesRefuse(op, comparand) || textArmRefuses(op, comparand);
          const got = issuesUnder(FilterConditionSchema.safeParse(wrap({ f: { [op]: comparand } })), `${prefix}.${op}`);
          if (expected) refused += 1;
          if ((got.length > 0) !== expected) {
            mismatches.push(`${op} ← ${label}: faces ${expected ? 'REFUSE' : 'ACCEPT'}, door ${got.length > 0 ? 'REFUSE' : 'ACCEPT'}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
      // Guards the loop against passing vacuously.
      expect(refused).toBeGreaterThan(40);
    });
  }

  it('the implicit-equality slot, every battery shape that is a comparand there', () => {
    for (const [label, comparand] of BATTERY) {
      if (comparand !== null && typeof comparand === 'object' && !Array.isArray(comparand) && !(comparand instanceof Date)) {
        continue; // a plain object in this slot is a nested condition, not a comparand
      }
      const expected = faceRefusal({ f: comparand }) !== undefined;
      const got = issuesUnder(FilterConditionSchema.safeParse({ f: comparand }), 'f');
      expect(got.length > 0, label).toBe(expected);
    }
  });

  it('inside a nested-relation condition the door answers as the face does — it never descends one', () => {
    for (const op of OPERATORS) {
      for (const [label, comparand] of BATTERY) {
        const where = { acct: { f: { [op]: comparand } } };
        // The face leaves the relation alone, whatever sits in it.
        expect(faceRefusal(where), `${op} ← ${label}`).toBeUndefined();
        const got = issuesUnder(FilterConditionSchema.safeParse(where), `acct.f.${op}`);
        // Only the #19514 text arm, which walks nested relations on purpose, may fire here.
        expect(got.length > 0, `${op} ← ${label}`).toBe(textArmRefuses(op, comparand));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §2 The envelope and the words, per arm
// ---------------------------------------------------------------------------

describe('#20116 §2 — each refusal: issue code, path and the prescription', () => {
  /** The face's message for `where`, with its ` at <facePath>.` location replaced by `.`. */
  function faceSentenceWithoutLocation(where: unknown, facePath: string): string {
    const face = faceRefusal(where);
    expect(face, `the face accepted ${JSON.stringify(where)}`).toBeDefined();
    expect(face!.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(face!.status).toBe(400);
    const location = ` at ${facePath}.`;
    // The clause is really there, exactly once, so removing it is not vacuous.
    expect(face!.message.split(location)).toHaveLength(2);
    return face!.message.replace(location, '.');
  }

  it.each([
    ['a non-list $in', { stage: { $in: 'won' } }, 'stage.$in', 'where.stage.$in'],
    ['a non-list $nin', { stage: { $nin: 7 } }, 'stage.$nin', 'where.stage.$nin'],
    ['a scalar $between', { amount: { $between: 5 } }, 'amount.$between', 'where.amount.$between'],
    ['a one-bound $between', { amount: { $between: [1] } }, 'amount.$between', 'where.amount.$between'],
    ['a three-bound $between', { amount: { $between: [1, 2, 3] } }, 'amount.$between', 'where.amount.$between'],
    ['a $ne list — the appended member', { stage: { $ne: ['won', 'lost'] } }, 'stage.$ne', 'where.stage.$ne'],
    ['an empty $ne list', { stage: { $ne: [] } }, 'stage.$ne', 'where.stage.$ne'],
    ['an implicit list (#19889, unchanged)', { stage: ['won'] }, 'stage', 'where.stage'],
    ['a $eq list (#19889, unchanged)', { stage: { $eq: ['won'] } }, 'stage.$eq', 'where.stage.$eq'],
  ])('%s — the face\'s sentence, less its location', (_label, where, issuePath, facePath) => {
    const issue = issueAt(FilterConditionSchema.safeParse(where), issuePath);
    expect(issue.code).toBe('custom');
    expect(issue.message).toBe(faceSentenceWithoutLocation(where, facePath));
  });

  it('the $in prescription names the list spelling, the equality alternative and the authoring spelling', () => {
    const { message } = issueAt(FilterConditionSchema.safeParse({ stage: { $in: 'won' } }), 'stage.$in');
    expect(message).toMatch(/^Operator "\$in" on field "stage" requires an ARRAY of values\. Received string \("won"\)\. /);
    expect(message).toContain('write ["won"] for a single value, or use "=" ($eq) to compare against it');
    expect(message).toContain('Authoring spellings: in.');
    expect(message).not.toContain(' at where.');
  });

  it('the $ne prescription is $nin, and the field is named', () => {
    const { message } = issueAt(FilterConditionSchema.safeParse({ stage: { $ne: ['won', 'lost'] } }), 'stage.$ne');
    expect(message).toMatch(/^Operator "\$ne" on field "stage" requires a single comparable value, but received an array/);
    expect(message).toContain('{"$nin": […]}');
    expect(message).not.toContain('{"$in": […]}');
  });

  it.each([
    ['$gt: null', { amount: { $gt: null } }, 'amount.$gt', { $gt: null }, '$gt'],
    ['$gte: null', { amount: { $gte: null } }, 'amount.$gte', { $gte: null }, '$gte'],
    ['$lt: null', { amount: { $lt: null } }, 'amount.$lt', { $lt: null }, '$lt'],
    ['$lte: null', { amount: { $lte: null } }, 'amount.$lte', { $lte: null }, '$lte'],
    ['a null $in member', { stage: { $in: ['won', null] } }, 'stage.$in.1', { $in: ['won', null] }, '$in.1'],
    ['a null $nin member', { stage: { $nin: [null] } }, 'stage.$nin.0', { $nin: [null] }, '$nin.0'],
    ['a null $between MIN', { amount: { $between: [null, 5] } }, 'amount.$between.0', { $between: [null, 5] }, '$between.0'],
    ['a null $between MAX', { amount: { $between: [1, null] } }, 'amount.$between.1', { $between: [1, null] }, '$between.1'],
    ['a blank $between MIN', { amount: { $between: ['', 5] } }, 'amount.$between.0', { $between: ['', 5] }, '$between.0'],
    ['a { $field } $between MAX', { amount: { $between: [1, { $field: 'b' }] } }, 'amount.$between.1', { $between: [1, { $field: 'b' }] }, '$between.1'],
  ])('%s — the enforced operator slot\'s sentence, at the member or endpoint', (_label, where, issuePath, slotInput, slotPath) => {
    // The face refuses it on every query…
    const face = faceRefusal(where);
    expect(face?.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(face?.status).toBe(400);
    // …and the save door refuses it at the slot, in the words
    // `FieldOperatorsSchema` already prints for the same comparand.
    const issue = issueAt(FilterConditionSchema.safeParse(where), issuePath);
    expect(issue.code).toBe('custom');
    expect(issue.message).toBe(issueAt(FieldOperatorsSchema.safeParse(slotInput), slotPath).message);
  });

  it('the null-ordering and null-member prescriptions are the null predicate', () => {
    expect(issueAt(FilterConditionSchema.safeParse({ amount: { $gt: null } }), 'amount.$gt').message)
      .toContain('{"$eq": null} is "has no value", {"$ne": null} is "has a value"');
    expect(issueAt(FilterConditionSchema.safeParse({ stage: { $in: ['won', null] } }), 'stage.$in.1').message)
      .toContain('{"$or": [{"$in": […]}, {"$null": true}]}');
  });

  it.each([
    ['$null: "x"', { stage: { $null: 'x' } }, 'stage.$null', 'a string ("x")'],
    ['$exists: "false" — the string, truthy', { stage: { $exists: 'false' } }, 'stage.$exists', 'a string ("false")'],
    ['$null: null', { stage: { $null: null } }, 'stage.$null', 'null'],
    ['$exists: 1', { stage: { $exists: 1 } }, 'stage.$exists', 'a number (1)'],
    ['$null: an array', { stage: { $null: [true] } }, 'stage.$null', 'an array ([true])'],
  ])('a non-boolean flag, %s — the query faces\' sentence and prescription', (_label, where, issuePath, received) => {
    const op = issuePath.split('.').pop()!;
    const issue = issueAt(FilterConditionSchema.safeParse(where), issuePath);
    expect(issue.code).toBe('custom');
    // `driver-sql`'s first sentence, word for word, which the analytics door keeps too.
    expect(issue.message).toMatch(
      new RegExp(`^Operator "\\${op}" on field "stage" requires a boolean comparand \\(true or false\\)\\. `),
    );
    expect(issue.message).toContain(`Received ${received}.`);
    expect(issue.message).toContain(`@objectstack/spec FieldOperatorsSchema declares ${op} as a boolean`);
    const [whenTrue, whenFalse] = op === '$null' ? ['has no value', 'has a value'] : ['has a value', 'has no value'];
    expect(issue.message).toContain(
      `Write the boolean itself: "${op}": true matches rows whose "stage" ${whenTrue}, "${op}": false rows whose "stage" ${whenFalse}.`,
    );
    expect(issue.message.length).toBeLessThan(500);
  });

  it('no door message carries the face\'s location — every face arm has a save-door sentence', () => {
    for (const op of OPERATORS) {
      for (const [, comparand] of BATTERY) {
        const result = FilterConditionSchema.safeParse({ f: { [op]: comparand } });
        for (const issue of issuesUnder(result, `f.${op}`)) {
          expect(issue.message, `${op} ← ${JSON.stringify(comparand)}`).not.toContain(' at where.');
        }
      }
    }
  });

  it('every refused slot of one document is reported, each at its own path', () => {
    const result = FilterConditionSchema.safeParse({
      stage: { $null: 'x', $in: 'won' },
      amount: { $gt: null, $between: [null, 5] },
      $or: [{ owner: { $ne: ['a'] } }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.')).sort()).toEqual([
      '$or.0.owner.$ne',
      'amount.$between.0',
      'amount.$gt',
      'stage.$in',
      'stage.$null',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §3 The stored carriers refuse on save, at their own paths
// ---------------------------------------------------------------------------

describe('#20116 §3 — the stored carriers', () => {
  const dataset = (extra: Record<string, unknown>) => ({
    name: 'deals_ds',
    label: 'Deals',
    object: 'deal',
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'deal_count', aggregate: 'count' }],
    ...extra,
  });
  const dashboard = (filter: unknown) => ({
    name: 'sales',
    label: 'Sales',
    widgets: [{ id: 'won_deals', type: 'metric', dataset: 'deals', values: ['total'], filter }],
  });
  const report = (runtimeFilter: unknown) => ({
    name: 'pipeline', label: 'Pipeline', type: 'summary',
    dataset: 'sales', rows: ['stage'], values: ['revenue'], runtimeFilter,
  });

  /** The collector's members, each with the slot path it is refused at. */
  const MEMBERS: ReadonlyArray<readonly [where: Record<string, unknown>, slot: string]> = [
    [{ stage: { $null: 'x' } }, 'stage.$null'],
    [{ stage: { $exists: 'false' } }, 'stage.$exists'],
    [{ stage: { $null: null } }, 'stage.$null'],
    [{ amount: { $gt: null } }, 'amount.$gt'],
    [{ stage: { $in: 'won' } }, 'stage.$in'],
    [{ stage: { $in: ['won', null] } }, 'stage.$in.1'],
    [{ amount: { $between: [null, 5] } }, 'amount.$between.0'],
    [{ stage: { $ne: ['won', 'lost'] } }, 'stage.$ne'],
  ];

  it.each(MEMBERS)('%j — refused by the dataset filter, a measure filter, a widget filter and a report runtimeFilter', (where, slot) => {
    const expected = issueAt(FilterConditionSchema.safeParse(where), slot).message;
    expect(issueAt(DatasetSchema.safeParse(dataset({ filter: where })), `filter.${slot}`).message).toBe(expected);
    const measure = dataset({ measures: [{ name: 'deal_count', aggregate: 'count', filter: where }] });
    expect(issueAt(DatasetSchema.safeParse(measure), `measures.0.filter.${slot}`).message).toBe(expected);
    expect(issueAt(DashboardSchema.safeParse(dashboard(where)), `widgets.0.filter.${slot}`).message).toBe(expected);
    expect(issueAt(ReportSchema.safeParse(report(where)), `runtimeFilter.${slot}`).message).toBe(expected);
  });

  it('CONTROL — the same carriers publish the boolean flags and keep them', () => {
    for (const where of [{ stage: { $null: true } }, { stage: { $null: false } }, { stage: { $exists: true } }, { stage: { $exists: false } }]) {
      const parsed = DatasetSchema.safeParse(dataset({ filter: where }));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(parsed.data!.filter).toEqual(where);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 CONTROLS — what the face judges but passes stays accepted at BOTH doors
// ---------------------------------------------------------------------------

describe('#20116 §4 — what stays accepted, at both doors', () => {
  it.each([
    ['$null: true', { stage: { $null: true } }],
    ['$null: false', { stage: { $null: false } }],
    ['$exists: true', { stage: { $exists: true } }],
    ['$exists: false', { stage: { $exists: false } }],
    ['$eq: null — the has-no-value predicate', { stage: { $eq: null } }],
    ['$ne: null — the has-a-value predicate', { stage: { $ne: null } }],
    ['$ne: a scalar', { stage: { $ne: 'lost' } }],
    ['$eq: a { $field } reference', { amount: { $eq: { $field: 'budget' } } }],
    ['$ne: a { $field } reference', { amount: { $ne: { $field: 'budget' } } }],
    ['$gt: a { $field } reference', { amount: { $gt: { $field: 'budget' } } }],
    ['$lte: a { $field } reference', { amount: { $lte: { $field: 'budget' } } }],
    ['a column-to-column range as two bounds', { amount: { $gte: { $field: 'a' }, $lte: { $field: 'b' } } }],
    ['$gt: a Date', { closed_at: { $gt: DAY } }],
    ['$gte: an ISO day', { closed_at: { $gte: '2026-01-01' } }],
    ['$in: [] — matches nothing', { stage: { $in: [] } }],
    ['$nin: [] — matches everything', { stage: { $nin: [] } }],
    ['$in keeps its list', { stage: { $in: ['won', 'lost'] } }],
    ['$in: a { $field } member — the face does not judge members', { stage: { $in: [{ $field: 'x' }] } }],
    ['$between keeps its pair', { amount: { $between: [1, 9] } }],
    ['$between: a whitespace endpoint — the schema door never judged one', { code: { $between: [' ', 'M'] } }],
    ['$between: falsy endpoints are endpoints', { amount: { $between: [0, 0] } }],
    ['relation traversal with no comparand operator', { acct: { region: 'NA' } }],
    ['a member shape INSIDE a nested relation — the face never descends one', { acct: { stage: { $in: ['won', null] } } }],
    ['a flag INSIDE a nested relation — the drivers never descend one either', { acct: { stage: { $null: 'x' } } }],
    ['every one of the above under $and / $or / $not', {
      $and: [{ stage: { $ne: null } }], $or: [{ amount: { $gt: { $field: 'b' } } }], $not: { stage: { $in: [] } },
    }],
  ])('%s', (_label, where) => {
    expect(faceRefusal(where)).toBeUndefined();
    const result = FilterConditionSchema.safeParse(where);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    // Accepted means KEPT: the door returns the document it was given.
    expect(result.data).toEqual(where);
  });
});

// ---------------------------------------------------------------------------
// §5 Inside a nested relation, the ANALYTICS carriers answer as the analytics door
// ---------------------------------------------------------------------------

describe('#20116 §5 — inside a nested relation, the dataset carriers refuse what the analytics door refuses', () => {
  // The analytics `where` door flattens a nested relation to dotted members and
  // hands each entry to the same query faces it hands a top-level entry. The
  // dataset carriers' own walk (`refuseNestedRelationComparands`, #20207's)
  // reaches those entries and asks the same function the shared walk asks, so
  // the table is §1's, one relation down, on both carriers.
  const dataset = (filter: unknown) => ({
    name: 'deals_ds',
    label: 'Deals',
    object: 'deal',
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'deal_count', aggregate: 'count' }],
    filter,
  });

  it.each([
    ['one hop', (e: Record<string, unknown>) => ({ acct: e }), 'acct.f'],
    ['two hops, under $or', (e: Record<string, unknown>) => ({ $or: [{ acct: { owner: e } }] }), '$or.0.acct.owner.f'],
  ] as const)('every operator × comparand cell, %s', (_label, wrap, prefix) => {
    const mismatches: string[] = [];
    let refused = 0;
    for (const op of OPERATORS) {
      for (const [label, comparand] of BATTERY) {
        const expected = queryFacesRefuse(op, comparand) || textArmRefuses(op, comparand);
        const filter = wrap({ f: { [op]: comparand } });
        const scoped = issuesUnder(DatasetSchema.safeParse(dataset(filter)), `filter.${prefix}.${op}`);
        const measure = issuesUnder(
          DatasetMeasureSchema.safeParse({ name: 'deal_count', aggregate: 'count', filter }),
          `filter.${prefix}.${op}`,
        );
        if (expected) refused += 1;
        if ((scoped.length > 0) !== expected || (measure.length > 0) !== expected) {
          mismatches.push(`${op} ← ${label}: faces ${expected ? 'REFUSE' : 'ACCEPT'}, dataset ${scoped.length > 0 ? 'REFUSE' : 'ACCEPT'}, measure ${measure.length > 0 ? 'REFUSE' : 'ACCEPT'}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(refused).toBeGreaterThan(40);
  });

  it.each([
    [{ acct: { stage: { $null: 'x' } } }, 'acct.stage.$null'],
    [{ acct: { stage: { $exists: 'false' } } }, 'acct.stage.$exists'],
    [{ acct: { stage: { $null: null } } }, 'acct.stage.$null'],
    [{ acct: { amount: { $gt: null } } }, 'acct.amount.$gt'],
    [{ acct: { stage: { $in: 'won' } } }, 'acct.stage.$in'],
    [{ acct: { stage: { $in: ['won', null] } } }, 'acct.stage.$in.1'],
    [{ acct: { amount: { $between: [null, 5] } } }, 'acct.amount.$between.0'],
    [{ acct: { stage: { $ne: ['won', 'lost'] } } }, 'acct.stage.$ne'],
  ] as const)('the collector\'s nested member %j — one issue per carrier, in the top-level sentence', (filter, slot) => {
    // The same words as the top-level form: the field named is the leaf, as
    // the analytics door names it, and the issue path carries the relation.
    const leaf = slot.split('.').slice(1).join('.');
    const topLevel = { [leaf.split('.')[0]!]: (filter.acct as Record<string, unknown>)[leaf.split('.')[0]!] };
    const expected = issueAt(FilterConditionSchema.safeParse(topLevel), leaf).message;
    const scoped = issueAt(DatasetSchema.safeParse(dataset(filter)), `filter.${slot}`);
    expect(scoped.code).toBe('custom');
    expect(scoped.message).toBe(expected);
    const measure = issueAt(DatasetMeasureSchema.safeParse({ name: 'deal_count', aggregate: 'count', filter }), `filter.${slot}`);
    expect(measure.message).toBe(expected);
  });

  it('CONTROL — the null predicate, references, empty lists and flags pass inside a relation, and are kept', () => {
    const filter = {
      acct: {
        stage: { $ne: null, $in: [] },
        owner: { region: { $eq: null } },
        amount: { $gt: { $field: 'floor' }, $between: [1, 9] },
        active: { $null: false, $exists: true },
      },
    };
    const parsed = DatasetSchema.safeParse(dataset(filter));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data!.filter).toEqual(filter);
  });
});
