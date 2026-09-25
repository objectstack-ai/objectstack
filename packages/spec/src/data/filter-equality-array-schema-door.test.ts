// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19889] An ARRAY in the EQUALITY slot is refused at the SCHEMA door, in the
 * comparand-shape face's own words.
 *
 * Ruled 2026-09-24 (letter A, record 5805248669):
 *
 * 1. `FilterConditionSchema` (implicit equality) and `FieldOperatorsSchema.$eq`
 *    refuse an array comparand at parse, with the SAME remedy text the shared
 *    compile face emits — one constant, two doors.
 * 4. Pins: implicit and `$eq` arrays refused; scalars and `{ $field }` still
 *    pass; the parse-door message equals the compile-face message.
 *
 * Measured before the change, on `origin/main` `a0920b42dc`:
 * `DatasetSchema.safeParse` with `filter: { stage: ['won', 'lost'] }`, and with
 * a measure `filter` of `{ stage: { $eq: ['won', 'lost'] } }`, both answered
 * `success: true`, and so did `FilterConditionSchema` and
 * `FieldOperatorsSchema` on the bare shapes — while `assertListComparandShapes`
 * refused both with `INVALID_FILTER` / 400. So a stored filter published clean
 * and then failed every query that used it.
 *
 * ## What would make these pins worthless, and what stops it
 *
 * - A door that refuses EVERYTHING passes every REFUSE row. §4 runs each
 *   control through BOTH doors and requires both to accept, so an over-wide
 *   arm goes red there, and so does an arm that drifts off the face's reach.
 * - "Same message" read as "similar message". §3 compares the two doors'
 *   strings for EQUALITY, after removing only the one clause the face adds and
 *   the schema door cannot know (`at <path>`; the issue's own `path` carries
 *   the location instead). §3 also proves that clause is really there, so the
 *   removal is not vacuous.
 */

import { describe, expect, it } from 'vitest';

import { StandardErrorCode } from '../api/errors.zod';
import { DashboardSchema } from '../ui/dashboard.zod';
import { DatasetSchema } from '../ui/dataset.zod';
import { ReportSchema } from '../ui/report.zod';
import { assertListComparandShapes } from './filter-comparand-shape';
import {
  EqualityOperatorSchema,
  FieldOperatorsSchema,
  FilterConditionSchema,
  NormalizedFilterSchema,
  parseFilterAST,
} from './filter.zod';

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

/** The face's refusal of `where`, failing loudly when the face accepts it. */
function faceRefusal(where: unknown): Error & { code?: string; status?: number } {
  try {
    assertListComparandShapes(where);
  } catch (error) {
    return error as Error & { code?: string; status?: number };
  }
  throw new Error(`the face accepted ${JSON.stringify(where)}`);
}

/** Each equality-slot shape, with its zod issue path and the face's own location. */
const REFUSED: ReadonlyArray<readonly [label: string, where: unknown, issuePath: string, facePath: string]> = [
  ['implicit, two members', { stage: ['won', 'lost'] }, 'stage', 'where.stage'],
  ['implicit, one member', { stage: ['won'] }, 'stage', 'where.stage'],
  ['implicit, EMPTY — still an array in this slot', { stage: [] }, 'stage', 'where.stage'],
  ['$eq, two members', { stage: { $eq: ['won', 'lost'] } }, 'stage.$eq', 'where.stage.$eq'],
  ['$eq, EMPTY', { stage: { $eq: [] } }, 'stage.$eq', 'where.stage.$eq'],
  ['implicit, under $and', { $and: [{ tags: ['a'] }] }, '$and.0.tags', 'where.$and[0].tags'],
  ['implicit, under $or', { $or: [{ stage: 'won' }, { tags: ['a'] }] }, '$or.1.tags', 'where.$or[1].tags'],
  ['$eq, under $not', { $not: { tags: { $eq: ['a'] } } }, '$not.tags.$eq', 'where.$not.tags.$eq'],
];

// ---------------------------------------------------------------------------
// §1 FilterConditionSchema refuses both spellings, at the slot's own path
// ---------------------------------------------------------------------------

describe('#19889 §1 — FilterConditionSchema refuses an array in the equality slot', () => {
  it.each(REFUSED)('refuses %s', (_label, where, issuePath) => {
    const issue = issueAt(FilterConditionSchema.safeParse(where), issuePath);
    expect(issue.message).toMatch(/requires a single comparable value, but received an array/);
  });

  it('refuses every equality slot in one document, not only the first', () => {
    const result = FilterConditionSchema.safeParse({ stage: ['won'], owner: { $eq: ['a', 'b'] } });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.')).sort()).toEqual(['owner.$eq', 'stage']);
  });
});

// ---------------------------------------------------------------------------
// §2 FieldOperatorsSchema.$eq refuses — the enforced copy and the documented one
// ---------------------------------------------------------------------------

describe('#19889 §2 — the $eq operator slot refuses an array', () => {
  it.each([
    ['FieldOperatorsSchema (the enforced copy)', FieldOperatorsSchema],
    ['EqualityOperatorSchema (the documentation copy)', EqualityOperatorSchema],
  ])('%s refuses $eq: [...] at $eq', (_label, schema) => {
    const issue = issueAt(schema.safeParse({ $eq: ['won', 'lost'] }), '$eq');
    expect(issue.message).toMatch(/^Operator "\$eq" requires a single comparable value/);
    expect(issueAt(schema.safeParse({ $eq: [] }), '$eq').message).toMatch(/received an array \(\[\]\)/);
  });

  it('the normalized AST — which validates field conditions against FieldOperatorsSchema — refuses it', () => {
    expect(NormalizedFilterSchema.safeParse({ $and: [{ stage: { $eq: ['won'] } }] }).success).toBe(false);
    // Control: the same member with a scalar is a normalized field condition.
    expect(NormalizedFilterSchema.safeParse({ $and: [{ stage: { $eq: 'won' } }] }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 The parse-door message IS the compile-face message
// ---------------------------------------------------------------------------

describe('#19889 §3 — one text, two doors', () => {
  it.each(REFUSED)('%s — the schema door prints the face\'s sentence', (_label, where, issuePath, facePath) => {
    const face = faceRefusal(where);
    // The face is the ADR-0112 class-1 refusal it has been since #19757.
    expect(face.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(face.status).toBe(400);
    // The one clause only the face can write is really there, exactly once…
    const location = ` at ${facePath}.`;
    expect(face.message.split(location)).toHaveLength(2);
    // …and removing it leaves the schema door's message, character for character.
    const schema = issueAt(FilterConditionSchema.safeParse(where), issuePath);
    expect(schema.message).toBe(face.message.replace(location, '.'));
  });

  it('the FilterArray spelling reaches the face through parseFilterAST with the same sentence', () => {
    let lowered: Error | undefined;
    try {
      parseFilterAST([['stage', '=', ['won', 'lost']]]);
    } catch (error) {
      lowered = error as Error;
    }
    expect(lowered?.message).toBe(faceRefusal({ stage: ['won', 'lost'] }).message);
  });

  it('the operator slot prints the same sentence, less the field it cannot see', () => {
    const face = faceRefusal({ stage: { $eq: ['won', 'lost'] } }).message;
    const slot = issueAt(FieldOperatorsSchema.safeParse({ $eq: ['won', 'lost'] }), '$eq').message;
    expect(face).toContain(' on field "stage"');
    expect(slot).toBe(face.replace(' on field "stage"', '').replace(' at where.stage.$eq.', '.'));
  });

  it('the remedy the author is handed on save names both operators and the unapplied-filter reason', () => {
    const message = issueAt(FilterConditionSchema.safeParse({ tags: ['a', 'b'] }), 'tags').message;
    expect(message).toContain('For "one of these values" use {"$in": […]} (authoring: in)');
    expect(message).toContain('{"$contains": "…"} (authoring: contains), an $or of those for any-of.');
    expect(message).toMatch(/The filter was NOT applied, .*UNFILTERED result set\.$/);
    // Inside the 500-char client bound the face's messages are held to.
    const longest = issueAt(
      FilterConditionSchema.safeParse({ close_date: ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc'] }),
      'close_date',
    ).message;
    expect(longest.length).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// §4 CONTROLS — both doors accept, so the arm is exactly the face's
// ---------------------------------------------------------------------------

describe('#19889 §4 — what stays accepted, at BOTH doors', () => {
  const day = new Date('2026-07-01T00:00:00.000Z');
  it.each([
    ['a string', { stage: 'won' }],
    ['a number, zero', { amount: 0 }],
    ['a boolean', { active: false }],
    ['the empty string', { stage: '' }],
    ['null — the has-no-value predicate', { stage: null }],
    ['$eq: null', { stage: { $eq: null } }],
    ['a Date', { closed_at: day }],
    ['$eq: a Date', { closed_at: { $eq: day } }],
    ['$eq: a { $field } reference', { amount: { $eq: { $field: 'budget' } } }],
    ['$eq: a scalar', { stage: { $eq: 'won' } }],
    ['$in keeps its list', { stage: { $in: ['won', 'lost'] } }],
    ['$in: [] stays the declared predicate', { stage: { $in: [] } }],
    ['$nin keeps its list', { stage: { $nin: ['lost'] } }],
    ['$between keeps its pair', { amount: { $between: [1, 9] } }],
    ['$ne carrying an array — not this ruling', { stage: { $ne: ['won'] } }],
    ['an array inside a nested-relation spec — the face never descends one', { owner: { region: ['NA'] } }],
    ['$eq array inside a nested-relation spec — likewise', { owner: { region: { $eq: ['NA'] } } }],
  ])('%s', (_label, where) => {
    expect(() => assertListComparandShapes(where)).not.toThrow();
    const result = FilterConditionSchema.safeParse(where);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    // Accepted means KEPT: the door returns the document it was given.
    expect(result.data).toEqual(where);
  });

  it('the { $field } reference an equality spelling lowers to passes both doors', () => {
    const lowered = parseFilterAST([['amount', '=', { $field: 'budget' }]]);
    expect(lowered).toEqual({ amount: { $eq: { $field: 'budget' } } });
    expect(FilterConditionSchema.safeParse(lowered).success).toBe(true);
    expect(FieldOperatorsSchema.safeParse({ $eq: { $field: 'budget' } }).success).toBe(true);
  });

  it('the operator slot accepts every scalar and null', () => {
    for (const comparand of ['won', 0, false, '', null, day]) {
      expect(FieldOperatorsSchema.safeParse({ $eq: comparand }).success, String(comparand)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 The stored carriers refuse on save, naming the path
// ---------------------------------------------------------------------------

describe('#19889 §5 — a stored filter carrier refuses the shape on save', () => {
  const dataset = (extra: Record<string, unknown>) => ({
    name: 'deals_ds',
    label: 'Deals',
    object: 'deal',
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'deal_count', aggregate: 'count' }],
    ...extra,
  });

  it('DatasetSchema refuses at filter.stage', () => {
    const issue = issueAt(DatasetSchema.safeParse(dataset({ filter: { stage: ['won', 'lost'] } })), 'filter.stage');
    expect(issue.message).toMatch(/^The implicit-equality comparand on field "stage"/);
  });

  it('DatasetSchema refuses a measure filter at measures.0.filter.stage.$eq', () => {
    const doc = dataset({
      measures: [{ name: 'deal_count', aggregate: 'count', filter: { stage: { $eq: ['won', 'lost'] } } }],
    });
    const issue = issueAt(DatasetSchema.safeParse(doc), 'measures.0.filter.stage.$eq');
    expect(issue.message).toMatch(/^Operator "\$eq" on field "stage"/);
  });

  it('a dashboard widget filter and a report runtimeFilter refuse at their own paths', () => {
    const dashboard = {
      name: 'sales',
      label: 'Sales',
      widgets: [{ id: 'won_deals', type: 'metric', dataset: 'deals', values: ['total'], filter: { stage: ['won'] } }],
    };
    issueAt(DashboardSchema.safeParse(dashboard), 'widgets.0.filter.stage');
    const report = {
      name: 'pipeline', label: 'Pipeline', type: 'summary',
      dataset: 'sales', rows: ['stage'], values: ['revenue'],
      runtimeFilter: { stage: { $eq: ['won'] } },
    };
    issueAt(ReportSchema.safeParse(report), 'runtimeFilter.stage.$eq');
  });

  it('CONTROL — the same documents with $in publish, and keep their filter', () => {
    const parsed = DatasetSchema.safeParse(dataset({ filter: { stage: { $in: ['won', 'lost'] } } }));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data!.filter).toEqual({ stage: { $in: ['won', 'lost'] } });
  });
});
