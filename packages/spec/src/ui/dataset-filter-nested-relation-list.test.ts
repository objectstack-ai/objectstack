// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20080] A list in the EQUALITY slot inside a NESTED-RELATION condition is
 * refused when a dataset or measure filter is SAVED, in the words the analytics
 * `where` door refuses it with when that filter is CHARTED.
 *
 * Measured before the change, on `origin/main` `9e7824a445`:
 * `DatasetSchema.safeParse` with `filter: { account: { region: ['a'] } }`, and
 * with a measure `filter` of `{ account: { region: { $eq: ['a'] } } }`, both
 * answered `success: true`, while the analytics door flattens the relation to
 * the dotted member `account.region` and refuses the list with
 * `INVALID_FILTER` / 400. The dataset saved clean and every chart on it failed.
 *
 * Triage record 5825670610 (remedy A) routed the fix to the two analytics
 * carriers and left the shared `FilterConditionSchema` as ruling A on #19889
 * (record 5805248669) put it: the engine reads such a spec as a deep-equality
 * comparand, so the shared door does not descend it.
 *
 * ## What would make these pins worthless, and what stops it
 *
 * - A refinement that refuses everything passes every REFUSE row. §4 runs each
 *   control through both carriers and requires the parse to succeed AND keep
 *   the filter, so an over-wide walk goes red there.
 * - "Same words" read as "similar words". §2 builds the analytics door's own
 *   refusal — the one-entry node it hands the shared face, with the path of the
 *   node that holds the entry — and compares the carrier's issue message to it
 *   for EQUALITY, after removing only the location clause the face appends. §2
 *   also proves that clause is really there, so the removal is not vacuous.
 * - A second report of a refusal the shared schema already makes. §3 requires
 *   EXACTLY ONE issue at a top-level list's path, so a walk that judged
 *   outside a nested relation as well goes red there.
 */

import { describe, expect, it } from 'vitest';

import { StandardErrorCode } from '../api/errors.zod';
import { assertListComparandShapes } from '../data/filter-comparand-shape';
import { FilterConditionSchema } from '../data/filter.zod';
import { DatasetMeasureSchema, DatasetSchema } from './dataset.zod';

type Issue = { path: PropertyKey[]; message: string };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };

/** The one issue at `path` (dot-joined), failing loudly on none or several. */
function issueAt(result: Parsed, path: string): Issue {
  expect(result.success, `expected a refusal at ${path}`).toBe(false);
  const issues = (result.error?.issues ?? []).filter((i) => i.path.join('.') === path);
  expect(
    issues,
    `issues raised: ${JSON.stringify((result.error?.issues ?? []).map((i) => i.path))}`,
  ).toHaveLength(1);
  return issues[0]!;
}

/**
 * The analytics door's refusal of one field entry: `assertNoListInEqualitySlot`
 * hands `{ [field]: spec }` to the shared face with the path of the node that
 * holds the entry (`where.account` for `{ account: { region: [...] } }`).
 */
function analyticsDoorRefusal(field: string, spec: unknown, holder: string): Error & { code?: string; status?: number } {
  try {
    assertListComparandShapes({ [field]: spec }, undefined, holder);
  } catch (error) {
    return error as Error & { code?: string; status?: number };
  }
  throw new Error(`the face accepted ${JSON.stringify({ [field]: spec })} at ${holder}`);
}

const dataset = (extra: Record<string, unknown>) => ({
  name: 'deals_ds',
  label: 'Deals',
  object: 'deal',
  include: ['account', 'account.owner'],
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'deal_count', aggregate: 'count' }],
  ...extra,
});

const withScope = (filter: unknown) => dataset({ filter });
const withMeasureFilter = (filter: unknown) =>
  dataset({ measures: [{ name: 'deal_count', aggregate: 'count', filter }] });

/**
 * Each nested-relation shape: the filter, its path under `filter`, the field
 * the door names, the list, whether it is the `$eq` spelling, and the path of
 * the node the analytics door hands to the face.
 */
const REFUSED: ReadonlyArray<readonly [
  label: string,
  filter: unknown,
  issuePath: string,
  field: string,
  list: unknown[],
  eq: boolean,
  holder: string,
]> = [
  ['implicit, two members', { account: { region: ['a', 'b'] } }, 'account.region', 'region', ['a', 'b'], false, 'where.account'],
  ['implicit, one member', { account: { region: ['a'] } }, 'account.region', 'region', ['a'], false, 'where.account'],
  ['implicit, EMPTY — still an array in this slot', { account: { region: [] } }, 'account.region', 'region', [], false, 'where.account'],
  ['$eq, two members', { account: { region: { $eq: ['a', 'b'] } } }, 'account.region.$eq', 'region', ['a', 'b'], true, 'where.account'],
  ['$eq, EMPTY', { account: { region: { $eq: [] } } }, 'account.region.$eq', 'region', [], true, 'where.account'],
  ['$eq beside another operator', { account: { region: { $ne: 'x', $eq: ['a'] } } }, 'account.region.$eq', 'region', ['a'], true, 'where.account'],
  ['two relation hops deep', { account: { owner: { region: ['a'] } } }, 'account.owner.region', 'region', ['a'], false, 'where.account.owner'],
  ['beside a scalar sibling in the relation', { account: { tier: 'gold', region: ['a'] } }, 'account.region', 'region', ['a'], false, 'where.account'],
  ['under $and', { $and: [{ stage: 'won' }, { account: { region: ['a'] } }] }, '$and.1.account.region', 'region', ['a'], false, 'where.$and[1].account'],
  ['under $or', { $or: [{ account: { region: { $eq: ['a'] } } }] }, '$or.0.account.region.$eq', 'region', ['a'], true, 'where.$or[0].account'],
  ['under $not', { $not: { account: { region: ['a'] } } }, '$not.account.region', 'region', ['a'], false, 'where.$not.account'],
  ['under $not over $or', { $not: { $or: [{ stage: 'won' }, { account: { region: ['a'] } }] } }, '$not.$or.1.account.region', 'region', ['a'], false, 'where.$not.$or[1].account'],
];

// ---------------------------------------------------------------------------
// §1 Both carriers refuse, at the list's own path
// ---------------------------------------------------------------------------

describe('§1 — both analytics carriers refuse a list inside a nested relation, at save', () => {
  it.each(REFUSED)('DatasetSchema.filter refuses %s', (_label, filter, issuePath) => {
    const issue = issueAt(DatasetSchema.safeParse(withScope(filter)), `filter.${issuePath}`);
    expect(issue.message).toMatch(/requires a single comparable value, but received an array/);
  });

  it.each(REFUSED)('a measure filter refuses %s, through DatasetSchema', (_label, filter, issuePath) => {
    issueAt(DatasetSchema.safeParse(withMeasureFilter(filter)), `measures.0.filter.${issuePath}`);
  });

  it.each(REFUSED)('DatasetMeasureSchema refuses %s on its own', (_label, filter, issuePath) => {
    issueAt(DatasetMeasureSchema.safeParse({ name: 'deal_count', aggregate: 'count', filter }), `filter.${issuePath}`);
  });

  it('refuses every such list in one document, on both carriers at once', () => {
    const result = DatasetSchema.safeParse(dataset({
      filter: { account: { region: ['a'], tier: { $eq: ['gold'] } } },
      measures: [{ name: 'deal_count', aggregate: 'count', filter: { account: { owner: { region: [] } } } }],
    }));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.')).sort()).toEqual([
      'filter.account.region',
      'filter.account.tier.$eq',
      'measures.0.filter.account.owner.region',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §2 The carrier prints the analytics door's sentence
// ---------------------------------------------------------------------------

describe('§2 — the carrier refusal is the analytics door\'s sentence', () => {
  it.each(REFUSED)('%s', (_label, filter, issuePath, field, list, eq, holder) => {
    const door = analyticsDoorRefusal(field, eq ? { $eq: list } : list, holder);
    // The door's refusal is the ADR-0112 class-1 envelope the face throws.
    expect(door.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(door.status).toBe(400);
    // The one clause only the door can write is really there, exactly once…
    const location = ` at ${holder}.${field}${eq ? '.$eq' : ''}.`;
    expect(door.message.split(location)).toHaveLength(2);
    // …and removing it leaves the carrier's message, character for character.
    const carrier = issueAt(DatasetSchema.safeParse(withScope(filter)), `filter.${issuePath}`);
    expect(carrier.message).toBe(door.message.replace(location, '.'));
  });

  it('names the leaf field and both remedies, as the door does', () => {
    const message = issueAt(
      DatasetSchema.safeParse(withScope({ account: { region: ['a', 'b'] } })),
      'filter.account.region',
    ).message;
    expect(message).toMatch(/^The implicit-equality comparand on field "region" requires a single comparable value/);
    expect(message).toContain('For "one of these values" use {"$in": […]} (authoring: in)');
    expect(message).toContain('{"$contains": "…"} (authoring: contains), an $or of those for any-of.');
    expect(message).toMatch(/The filter was NOT applied, .*UNFILTERED result set\.$/);
  });
});

// ---------------------------------------------------------------------------
// §3 A list the shared schema already refuses is refused once, not twice
// ---------------------------------------------------------------------------

describe('§3 — outside a nested relation the shared schema answers, once', () => {
  it.each([
    ['top level, implicit', { region: ['a'] }, 'region', /^The implicit-equality comparand on field "region"/],
    ['top level, $eq', { region: { $eq: ['a'] } }, 'region.$eq', /^Operator "\$eq" on field "region"/],
    ['under $and', { $and: [{ region: ['a'] }] }, '$and.0.region', /^The implicit-equality comparand on field "region"/],
    ['under $not', { $not: { region: { $eq: [] } } }, '$not.region.$eq', /^Operator "\$eq" on field "region"/],
  ] as const)('%s', (_label, filter, issuePath, opening) => {
    const issue = issueAt(DatasetSchema.safeParse(withScope(filter)), `filter.${issuePath}`);
    expect(issue.message).toMatch(opening);
    issueAt(DatasetMeasureSchema.safeParse({ name: 'deal_count', aggregate: 'count', filter }), `filter.${issuePath}`);
  });
});

// ---------------------------------------------------------------------------
// §4 CONTROLS — accepted on both carriers, and kept
// ---------------------------------------------------------------------------

describe('§4 — what a nested relation may still carry', () => {
  const day = new Date('2026-07-01T00:00:00.000Z');
  it.each([
    ['a scalar', { account: { region: 'a' } }],
    ['a scalar, two hops deep', { account: { owner: { region: 'a' } } }],
    ['null — the has-no-value predicate', { account: { region: null } }],
    ['a Date', { account: { closed_at: day } }],
    ['$eq: a scalar', { account: { region: { $eq: 'a' } } }],
    ['$eq: null', { account: { region: { $eq: null } } }],
    ['$eq: a { $field } reference', { account: { amount: { $eq: { $field: 'budget' } } } }],
    ['$in keeps its list', { account: { region: { $in: ['a', 'b'] } } }],
    ['$in: [] stays the declared predicate', { account: { region: { $in: [] } } }],
    ['$nin keeps its list', { account: { region: { $nin: ['a'] } } }],
    ['$between keeps its pair', { account: { score: { $between: [1, 9] } } }],
    ['a scalar under $and', { $and: [{ account: { region: 'a' } }] }],
  ])('%s', (_label, filter) => {
    const scoped = DatasetSchema.safeParse(withScope(filter));
    expect(scoped.success, JSON.stringify(scoped.error?.issues)).toBe(true);
    // Accepted means KEPT: the carrier returns the filter it was given.
    expect(scoped.data!.filter).toEqual(filter);
    const measure = DatasetMeasureSchema.safeParse({ name: 'deal_count', aggregate: 'count', filter });
    expect(measure.success, JSON.stringify(measure.error?.issues)).toBe(true);
    expect(measure.data!.filter).toEqual(filter);
  });

  it('$ne carrying a list inside a relation is refused on both carriers, in the door\'s $ne sentence', () => {
    // This row sat in the table above as "not yet at this save door (#20116)".
    // #20116 routes every slot this walk reaches through the query faces'
    // verdict, so the shape the analytics door refuses on chart is refused here.
    const filter = { account: { region: { $ne: ['a'] } } };
    const door = analyticsDoorRefusal('region', { $ne: ['a'] }, 'where.account');
    expect(door.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(door.status).toBe(400);
    const location = ' at where.account.region.$ne.';
    expect(door.message.split(location)).toHaveLength(2);
    const scoped = issueAt(DatasetSchema.safeParse(withScope(filter)), 'filter.account.region.$ne');
    expect(scoped.message).toBe(door.message.replace(location, '.'));
    expect(scoped.message).toContain('{"$nin": […]}');
    const measure = issueAt(DatasetMeasureSchema.safeParse({ name: 'deal_count', aggregate: 'count', filter }), 'filter.account.region.$ne');
    expect(measure.message).toBe(scoped.message);
  });

  it('the shared FilterConditionSchema keeps its own reach — ruling A is untouched', () => {
    for (const filter of [{ account: { region: ['a'] } }, { account: { region: { $eq: ['a'] } } }]) {
      const result = FilterConditionSchema.safeParse(filter);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      expect(result.data).toEqual(filter);
    }
  });
});
