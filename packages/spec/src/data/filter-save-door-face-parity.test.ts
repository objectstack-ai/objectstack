// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20116] The SAVE door (`FilterConditionSchema`) refuses exactly the comparand
 * slots the QUERY faces refuse — at the top level and in every `$and` / `$or` /
 * `$not` member, and not inside a nested-relation condition, which the face
 * never descends. The analytics carriers (a dataset `filter`, a measure
 * `filter` and, since stage 2, a dashboard widget `filter` and a report's and a
 * joined report block's `runtimeFilter`), charted through the analytics
 * `where` door that DOES descend a relation, refuse the same slots inside one
 * (§5), asking the same function.
 *
 * Stage 2 adds the comparand-TYPE face (`normalizeFilterComparandTypes`) to
 * "the query faces": measured on `origin/main` `17bd3187`, every save door
 * accepted `{ stage: { $eq: { a: 1 } } }`, `{ stage: { $in: [{ a: 1 }] } }` and a
 * `Map` comparand, top level and nested, while that face and the analytics
 * door refused each with `INVALID_FILTER` / 400; and a dashboard widget
 * `filter`, a report `runtimeFilter` and a joined block `runtimeFilter`
 * accepted `{ acct: { stage: { $in: ['won', null] } } }` and #20080's nested
 * equality lists, which the analytics door refuses on chart. §1 and §5
 * ask all three rules; §6 pins the type face's words and table; §7 the
 * carriers.
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

import { z } from 'zod';

import { StandardErrorCode } from '../api/errors.zod';
import { analyticsCarrierFilter } from '../ui/analytics-carrier-filter';
import { DashboardSchema } from '../ui/dashboard.zod';
import { DatasetMeasureSchema, DatasetSchema } from '../ui/dataset.zod';
import { ReportSchema } from '../ui/report.zod';
import { assertListComparandShapes } from './filter-comparand-shape';
import { ComparandTypeProbe, FILTER_COMPARAND_TYPE_CASES } from './filter-comparand-type-conformance';
import { normalizeFilterComparandTypes } from './filter-comparand-type';
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

/** The comparand-TYPE face's refusal of `where`, or `undefined` when it accepts (its narrowed copy discarded). */
function typeFaceRefusal(where: unknown): (Error & { code?: string; status?: number }) | undefined {
  try {
    normalizeFilterComparandTypes(where);
  } catch (error) {
    return error as Error & { code?: string; status?: number };
  }
  return undefined;
}

/** A test-name rendering that survives a bigint, a `Map`, `undefined` and a function. */
function show(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return `${v}n`;
    if (v === undefined) return 'undefined';
    if (v instanceof Map) return 'Map';
    if (typeof v === 'function' || typeof v === 'symbol') return String(v);
    return v;
  });
}

/** Filter STRUCTURE as the type face classifies it: a PLAIN object, prototype `Object.prototype` or `null`. */
function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
  // Stage 2 — the comparand-TYPE face's arms, and the neighbours it passes.
  ['a Map', new Map([['a', 1]])],
  ['a class instance', new ComparandTypeProbe()],
  ['a function', () => 1],
  ['a Symbol', Symbol('x')],
  ['a { $field } with a non-string name', { $field: 5 }],
  ['an empty object', {}],
  ['a bigint within 2^53', 5n],
  ['a bigint beyond 2^53', 2n ** 60n],
  ['a list holding a plain object', ['won', { a: 1 }]],
  ['a list holding a Map', [new Map()]],
  ['a list holding undefined', [1, undefined]],
  ['a list holding a bigint beyond 2^53', [2n ** 60n]],
  ['a pair with a plain-object MAX', [1, { a: 1 }]],
  ['a pair of bigints within 2^53', [1n, 9n]],
];

/**
 * What the query faces answer for one operator slot: the shape face, the type
 * face, and the flag rule — the three `parseFilterAST`, the engine seam and
 * the analytics door run, in that order.
 */
function queryFacesRefuse(op: string, comparand: unknown): boolean {
  if (faceRefusal({ f: { [op]: comparand } })) return true;
  if (typeFaceRefusal({ f: { [op]: comparand } })) return true;
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

describe('§1 — the enumeration: the save door refuses exactly what the query faces refuse', () => {
  it('the table is derived, not hand-listed, and covers every arm the faces and the flag rule judge', () => {
    // The vocabulary is the enforced copy's, so a new operator joins the table.
    expect(OPERATORS).toEqual(expect.arrayContaining(['$eq', '$ne', '$gt', '$in', '$nin', '$between', '$null', '$exists']));
    // [#20311] `$empty` is declared `z.boolean()` (in FILTER_OPERATORS since #20446),
    // so it joins the flag arm by derivation and the door must hold it to a boolean.
    expect(BOOLEAN_SLOTS.sort()).toEqual(['$empty', '$exists', '$null']);
    // Every operator the face judges today refuses at least one battery shape —
    // the guard against a battery that silently stopped reaching an arm.
    const faceJudged = OPERATORS.filter((op) => BATTERY.some(([, c]) => faceRefusal({ f: { [op]: c } })));
    // [#21448] Every declared operator: the list operators by their own arms,
    // and every scalar operator by the one-value arm (a battery list), the text
    // operators and the flags included. Until then the face judged only the
    // list operators, the equality pair and the four ordering slots.
    expect(faceJudged.sort()).toEqual([...OPERATORS].sort());
    // [stage 2] The TYPE face judges every declared operator — its own test
    // reconciles its scalar/list split against this same vocabulary — so every
    // one of them must refuse some battery shape here, as a scalar comparand or
    // as a list member.
    const typeJudged = OPERATORS.filter((op) => BATTERY.some(([, c]) => typeFaceRefusal({ f: { [op]: c } })));
    expect(typeJudged.sort()).toEqual([...OPERATORS].sort());
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
    let refused = 0;
    for (const [label, comparand] of BATTERY) {
      // A PLAIN object in this slot is a nested condition or an operator map,
      // not a comparand — the type face's own classification. A `Map` or a
      // class instance IS a comparand here, and the type face judges it.
      if (isPlainObject(comparand)) continue;
      const expected = faceRefusal({ f: comparand }) !== undefined || typeFaceRefusal({ f: comparand }) !== undefined;
      const got = issuesUnder(FilterConditionSchema.safeParse({ f: comparand }), 'f');
      if (expected) refused += 1;
      expect(got.length > 0, label).toBe(expected);
    }
    // The implicit slot's refusals: every list, `undefined`, a Map, a class
    // instance, a function, a Symbol and the bigint beyond 2^53.
    expect(refused).toBeGreaterThanOrEqual(15);
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

describe('§2 — each refusal: issue code, path and the prescription', () => {
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
    ['an implicit list (an equality-slot refusal, unchanged)', { stage: ['won'] }, 'stage', 'where.stage'],
    ['a $eq list (an equality-slot refusal, unchanged)', { stage: { $eq: ['won'] } }, 'stage.$eq', 'where.stage.$eq'],
    // [#21448] A list at every other scalar operator: ordering, text and flag.
    ['a $gt list', { amount: { $gt: [10, 99] } }, 'amount.$gt', 'where.amount.$gt'],
    ['an empty $lte list', { amount: { $lte: [] } }, 'amount.$lte', 'where.amount.$lte'],
    ['a $contains list', { stage: { $contains: ['won', 'lost'] } }, 'stage.$contains', 'where.stage.$contains'],
    ['a $null list — a flag', { stage: { $null: [true] } }, 'stage.$null', 'where.stage.$null'],
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
    // [#21448] `$null: [true]` left this table: a list at a flag is the
    // comparand-shape face's refusal now (how many values comes before which
    // value), and it reads in that face's words — the §2 rows above.
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
          expect(issue.message, `${op} ← ${show(comparand)}`).not.toContain(' at where.');
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

describe('§3 — the stored carriers', () => {
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
  const joinedReport = (runtimeFilter: unknown) => ({
    name: 'pipeline_joined', label: 'Pipeline', type: 'joined',
    blocks: [{ name: 'won', label: 'Won', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], runtimeFilter }],
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
    // [stage 2] M-type: the comparand-TYPE face's cells.
    [{ stage: { $eq: { a: 1 } } }, 'stage.$eq'],
    [{ stage: { $in: [{ a: 1 }] } }, 'stage.$in.0'],
    [{ stage: { $eq: new Map([['a', 1]]) } }, 'stage.$eq'],
    [{ stage: new Map([['a', 1]]) }, 'stage'],
    [{ stage: { $nin: ['lost', new Map()] } }, 'stage.$nin.1'],
    [{ amount: { $gt: 2n ** 60n } }, 'amount.$gt'],
    [{ stage: undefined }, 'stage'],
  ];

  it.each(MEMBERS.map(([where, slot]) => [show(where), where, slot] as const))('%s — refused by the dataset filter, a measure filter, a widget filter and both report runtimeFilters', (_label, where, slot) => {
    const expected = issueAt(FilterConditionSchema.safeParse(where), slot).message;
    expect(issueAt(DatasetSchema.safeParse(dataset({ filter: where })), `filter.${slot}`).message).toBe(expected);
    const measure = dataset({ measures: [{ name: 'deal_count', aggregate: 'count', filter: where }] });
    expect(issueAt(DatasetSchema.safeParse(measure), `measures.0.filter.${slot}`).message).toBe(expected);
    expect(issueAt(DashboardSchema.safeParse(dashboard(where)), `widgets.0.filter.${slot}`).message).toBe(expected);
    expect(issueAt(ReportSchema.safeParse(report(where)), `runtimeFilter.${slot}`).message).toBe(expected);
    expect(issueAt(ReportSchema.safeParse(joinedReport(where)), `blocks.0.runtimeFilter.${slot}`).message).toBe(expected);
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

describe('§4 — what stays accepted, at both doors', () => {
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
    // [stage 2] What the TYPE face passes: its six accepted types, a
    // `{ $field }` reference, and the `{placeholder}` strings the engine
    // resolves only at request time (after both faces have run).
    ['$eq: a { $field } reference — not a literal', { amount: { $eq: { $field: 'budget' } } }],
    ['$gte: a {placeholder} date macro, resolved at request time', { closed_at: { $gte: '{today}' } }],
    ['an implicit {current_user_id}, resolved at request time', { owner_id: '{current_user_id}' }],
    ['$in: {placeholder} members', { owner_id: { $in: ['{current_user_id}', 'usr_1'] } }],
    ['$eq: a bigint within 2^53 — KEPT as written, never narrowed on save', { qty: { $eq: 100n } }],
    ['$in: bigints within 2^53', { qty: { $in: [100n, 2n ** 53n] } }],
    ['$between: Dates', { closed_at: { $between: [DAY, DAY] } }],
    ['an implicit Date', { closed_at: DAY }],
    ['an implicit boolean, number and null', { active: true, qty: 0, note: null }],
    ['a spec the type face classifies as a { $field } reference is stepped around whole, as that face does', {
      amount: { $field: 'budget', $gt: new Map() },
    }],
    ['a Map INSIDE a nested relation — neither face descends one', { acct: { stage: new Map([['a', 1]]) } }],
    ['a plain object under $eq INSIDE a nested relation — neither face descends one', { acct: { stage: { $eq: { a: 1 } } } }],
  ])('%s', (_label, where) => {
    expect(faceRefusal(where)).toBeUndefined();
    expect(typeFaceRefusal(where)).toBeUndefined();
    const result = FilterConditionSchema.safeParse(where);
    expect(result.success, show(result.error?.issues)).toBe(true);
    // Accepted means KEPT: the door returns the document it was given.
    expect(result.data).toEqual(where);
  });
});

// ---------------------------------------------------------------------------
// §5 Inside a nested relation, the ANALYTICS carriers answer as the analytics door
// ---------------------------------------------------------------------------

describe('§5 — inside a nested relation, the analytics carriers refuse what the analytics door refuses', () => {
  // The analytics `where` door flattens a nested relation to dotted members and
  // hands each entry to the same query faces it hands a top-level entry. The
  // analytics carriers' own walk (`refuseNestedRelationComparands`, #20207's,
  // `ui/analytics-carrier-filter.ts` since stage 2) reaches those entries and
  // asks the same function the shared walk asks, so the table is §1's, one
  // relation down, on every carrier — the two dataset carriers, the dashboard
  // widget's `filter`, and a report's and a joined block's `runtimeFilter`.
  const dataset = (filter: unknown) => ({
    name: 'deals_ds',
    label: 'Deals',
    object: 'deal',
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'deal_count', aggregate: 'count' }],
    filter,
  });
  const dashboard = (filter: unknown) => ({
    name: 'sales',
    label: 'Sales',
    widgets: [{ id: 'won_deals', type: 'metric', dataset: 'deals', values: ['total'], filter }],
  });

  /**
   * Every analytics carrier — every stored filter the analytics door charts:
   * its parse, and where its filter sits in the document. The two report rows
   * were EXPECTED-OPEN until the report half of the collector folded in (the
   * carrier on `ReportSchema.runtimeFilter` and `JoinedReportBlockSchema.runtimeFilter`).
   */
  const CARRIERS: ReadonlyArray<readonly [carrier: string, parse: (filter: unknown) => Parsed, at: string]> = [
    ['dataset filter', (filter) => DatasetSchema.safeParse(dataset(filter)), 'filter'],
    ['measure filter', (filter) => DatasetMeasureSchema.safeParse({ name: 'deal_count', aggregate: 'count', filter }), 'filter'],
    ['dashboard widget filter', (filter) => DashboardSchema.safeParse(dashboard(filter)), 'widgets.0.filter'],
    ['report runtimeFilter', (runtimeFilter) => ReportSchema.safeParse({
      name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], runtimeFilter,
    }), 'runtimeFilter'],
    ['joined report block runtimeFilter', (runtimeFilter) => ReportSchema.safeParse({
      name: 'pipeline_joined', label: 'Pipeline', type: 'joined',
      blocks: [{ name: 'won', label: 'Won', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], runtimeFilter }],
    }), 'blocks.0.runtimeFilter'],
  ];

  /** The collector's nested members, each with the slot it is refused at inside the relation. */
  const NESTED_MEMBERS: ReadonlyArray<readonly [filter: { acct: Record<string, unknown> }, slot: string]> = [
    [{ acct: { stage: { $null: 'x' } } }, 'acct.stage.$null'],
    [{ acct: { stage: { $exists: 'false' } } }, 'acct.stage.$exists'],
    [{ acct: { stage: { $null: null } } }, 'acct.stage.$null'],
    [{ acct: { amount: { $gt: null } } }, 'acct.amount.$gt'],
    [{ acct: { stage: { $in: 'won' } } }, 'acct.stage.$in'],
    [{ acct: { stage: { $in: ['won', null] } } }, 'acct.stage.$in.1'],
    [{ acct: { amount: { $between: [null, 5] } } }, 'acct.amount.$between.0'],
    [{ acct: { stage: { $ne: ['won', 'lost'] } } }, 'acct.stage.$ne'],
    // [stage 2] #20080's equality lists, M-widget's other named shape.
    [{ acct: { region: ['a'] } }, 'acct.region'],
    [{ acct: { region: { $eq: ['a'] } } }, 'acct.region.$eq'],
    // [stage 2] M-type inside a relation.
    [{ acct: { stage: { $eq: { a: 1 } } } }, 'acct.stage.$eq'],
    [{ acct: { stage: { $in: [{ a: 1 }] } } }, 'acct.stage.$in.0'],
    [{ acct: { stage: { $eq: new Map([['a', 1]]) } } }, 'acct.stage.$eq'],
    [{ acct: { stage: new Map([['a', 1]]) } }, 'acct.stage'],
  ];

  const HOPS = [
    ['one hop', (e: Record<string, unknown>) => ({ acct: e }), 'acct.f'],
    ['two hops, under $or', (e: Record<string, unknown>) => ({ $or: [{ acct: { owner: e } }] }), '$or.0.acct.owner.f'],
  ] as const;

  it.each(HOPS)('every operator × comparand cell, %s, on every carrier', (_label, wrap, prefix) => {
    const mismatches: string[] = [];
    let refused = 0;
    for (const op of OPERATORS) {
      for (const [label, comparand] of BATTERY) {
        const expected = queryFacesRefuse(op, comparand) || textArmRefuses(op, comparand);
        const filter = wrap({ f: { [op]: comparand } });
        if (expected) refused += 1;
        for (const [carrier, parse, at] of CARRIERS) {
          const got = issuesUnder(parse(filter), `${at}.${prefix}.${op}`);
          if ((got.length > 0) !== expected) {
            mismatches.push(`${carrier}: ${op} ← ${label}: faces ${expected ? 'REFUSE' : 'ACCEPT'}, door ${got.length > 0 ? 'REFUSE' : 'ACCEPT'}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(refused).toBeGreaterThan(40);
  });

  it.each(HOPS)('the implicit-equality slot, %s, on every carrier — a Map or a class instance is the comparand it is', (_label, wrap, prefix) => {
    let refused = 0;
    for (const [label, comparand] of BATTERY) {
      if (isPlainObject(comparand)) continue; // a nested condition or an operator map, not a comparand
      const expected = faceRefusal({ f: comparand }) !== undefined || typeFaceRefusal({ f: comparand }) !== undefined;
      if (expected) refused += 1;
      for (const [carrier, parse, at] of CARRIERS) {
        const got = issuesUnder(parse(wrap({ f: comparand } as Record<string, unknown>)), `${at}.${prefix}`);
        expect(got.length > 0, `${carrier}: ${label}`).toBe(expected);
      }
    }
    expect(refused).toBeGreaterThanOrEqual(15);
  });

  it('every carrier the analytics door charts is on the list — no stored presentation filter keeps the shared reach alone', () => {
    // The five stored filters `dataset-executor.ts` hands to the analytics
    // `where` door: the dataset's own and its measures', and the presentation
    // scopes it ANDs in as `runtimeFilter` (a widget's `filter`, a report's and
    // a joined block's `runtimeFilter`).
    expect(CARRIERS.map(([carrier]) => carrier)).toEqual([
      'dataset filter', 'measure filter', 'dashboard widget filter', 'report runtimeFilter', 'joined report block runtimeFilter',
    ]);
  });

  it.each(NESTED_MEMBERS.map(([filter, slot]) => [show(filter), filter, slot] as const))(
    'the collector\'s nested member %s — one issue per carrier, in the top-level sentence',
    (_label, filter, slot) => {
      // The same words as the top-level form: the field named is the leaf, as
      // the analytics door names it, and the issue path carries the relation.
      const leaf = slot.split('.').slice(1).join('.');
      const topLevel = { [leaf.split('.')[0]!]: (filter.acct as Record<string, unknown>)[leaf.split('.')[0]!] };
      const expected = issueAt(FilterConditionSchema.safeParse(topLevel), leaf).message;
      // Every carrier refuses it on save, once, at its own path.
      for (const [carrier, parse, at] of CARRIERS) {
        const issue = issueAt(parse(filter), `${at}.${slot}`);
        expect(issue.code, carrier).toBe('custom');
        expect(issue.message, carrier).toBe(expected);
      }
    },
  );

  it('CONTROL — the null predicate, references, empty lists, flags, Dates and placeholders pass inside a relation on every carrier, and are kept', () => {
    const filter = {
      acct: {
        stage: { $ne: null, $in: [] },
        owner: { region: { $eq: null }, id: '{current_user_id}' },
        amount: { $gt: { $field: 'floor' }, $between: [1, 9] },
        active: { $null: false, $exists: true },
        closed_at: { $gte: DAY, $lt: '{today}' },
        qty: { $in: [1n, 2] },
      },
    };
    for (const [carrier, parse, at] of CARRIERS) {
      const parsed = parse(filter);
      expect(parsed.success, `${carrier}: ${show(parsed.error?.issues)}`).toBe(true);
      const kept = at.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], (parsed as { data?: unknown }).data);
      expect(kept, carrier).toEqual(filter);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 The comparand-TYPE face: its words, its own table, one issue per slot
// ---------------------------------------------------------------------------

describe('§6 — the comparand-TYPE face at the save door', () => {
  /** The type face's message for `where`, with its ` at <facePath> ` location clause removed. */
  function typeFaceSentenceWithoutLocation(where: unknown, facePath: string): string {
    const face = typeFaceRefusal(where);
    expect(face, `the type face accepted ${show(where)}`).toBeDefined();
    expect(face!.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(face!.status).toBe(400);
    const location = ` at ${facePath} `;
    // The clause is really there, exactly once, so removing it is not vacuous.
    expect(face!.message.split(location)).toHaveLength(2);
    return face!.message.replace(location, ' ');
  }

  it.each([
    ['a plain object under $eq (M-type)', { stage: { $eq: { a: 1 } } }, 'stage.$eq', 'where.stage.$eq', 'a plain object ({"a":1})'],
    ['a plain object under $ne', { stage: { $ne: { a: 1 } } }, 'stage.$ne', 'where.stage.$ne', 'a plain object'],
    ['a Map under $gt', { amount: { $gt: new Map() } }, 'amount.$gt', 'where.amount.$gt', 'a Map instance'],
    ['undefined under $contains', { name: { $contains: undefined } }, 'name.$contains', 'where.name.$contains', 'is undefined'],
    ['a plain-object $in member (M-type)', { stage: { $in: ['won', { a: 1 }] } }, 'stage.$in.1', 'where.stage.$in[1]', 'a plain object'],
    ['a Map $nin member', { stage: { $nin: [new Map()] } }, 'stage.$nin.0', 'where.stage.$nin[0]', 'a Map instance'],
    ['a plain-object $between MAX', { amount: { $between: [1, { a: 1 }] } }, 'amount.$between.1', 'where.amount.$between[1]', 'a plain object'],
    ['an implicit Map (M-type)', { stage: new Map([['a', 1]]) }, 'stage', 'where.stage', 'a Map instance'],
    ['an implicit class instance', { qty: new ComparandTypeProbe() }, 'qty', 'where.qty', 'a ComparandTypeProbe instance'],
    ['an implicit undefined', { owner: undefined }, 'owner', 'where.owner', 'is undefined'],
    ['a function', { qty: { $eq: () => 1 } }, 'qty.$eq', 'where.qty.$eq', 'a function'],
    ['a Symbol', { qty: { $eq: Symbol('x') } }, 'qty.$eq', 'where.qty.$eq', 'a Symbol'],
    ['a bigint beyond 2^53', { qty: { $gt: 2n ** 60n } }, 'qty.$gt', 'where.qty.$gt', 'exceeds 2^53'],
    ['a { $field } whose name is not a string', { amount: { $gt: { $field: 5 } } }, 'amount.$gt', 'where.amount.$gt', 'a plain object'],
  ] as const)('%s — the type face\'s sentence, less its location, at the slot or member', (_label, where, issuePath, facePath, names) => {
    const issue = issueAt(FilterConditionSchema.safeParse(where), issuePath);
    expect(issue.code).toBe('custom');
    expect(issue.message).toBe(typeFaceSentenceWithoutLocation(where, facePath));
    expect(issue.message).toMatch(/^Filter comparand (is|is the) /);
    expect(issue.message).toContain(names);
    // The prescription is the accepted set, named.
    expect(issue.message).toContain('A comparison value must be a string, number, bigint, boolean, null or Date.');
    expect(issue.message).not.toContain(' at where');
  });

  it.each([
    ['$null: a plain object — the type face\'s refusal, not the flag rule\'s', { stage: { $null: { a: 1 } } }, 'stage.$null', /^Filter comparand is a plain object/],
    ['$exists: undefined — the type face\'s refusal', { stage: { $exists: undefined } }, 'stage.$exists', /^Filter comparand is undefined\./],
    ['$null: a bigint within 2^53 — the type face passes it, the flag rule refuses it', { stage: { $null: 5n } }, 'stage.$null', /^Operator "\$null" on field "stage" requires a boolean comparand/],
    ['$icontains: a Map — the type face\'s refusal, and the text-comparand arm stays silent', { name: { $icontains: new Map() } }, 'name.$icontains', /^Filter comparand is a Map instance/],
    ['$between: [undefined, 5] — the shape face\'s blank endpoint answers first', { amount: { $between: [undefined, 5] } }, 'amount.$between.0', /^A blank value is not a valid \$between endpoint/],
  ] as const)('one slot, one issue, in the query doors\' order — %s', (_label, where, issuePath, head) => {
    const result = FilterConditionSchema.safeParse(where);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.'))).toEqual([issuePath]);
    expect(issueAt(result, issuePath).message).toMatch(head);
  });

  it('every refused slot of one document is reported, each at its own path — the type face\'s among the shape face\'s', () => {
    const result = FilterConditionSchema.safeParse({
      stage: { $eq: { a: 1 }, $in: 'won' },
      amount: { $gt: new Map(), $lt: null },
      owner: undefined,
      $or: [{ tags: { $nin: ['x', { a: 1 }] } }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.')).sort()).toEqual([
      '$or.0.tags.$nin.1',
      'amount.$gt',
      'amount.$lt',
      'owner',
      'stage.$eq',
      'stage.$in',
    ]);
  });

  it.each(FILTER_COMPARAND_TYPE_CASES.map((row) => [row.name, row] as const))(
    'the type face\'s own conformance table — %s',
    (_name, row) => {
      const filter = row.filter();
      const result = FilterConditionSchema.safeParse(filter);
      if (row.verdict === 'door-refusal') {
        // Refused on save — and the rows are the query doors' refusals, in
        // their envelope, so the save door is refusing what they refuse.
        expect(result.success, show(filter)).toBe(false);
        expect(faceRefusal(filter) ?? typeFaceRefusal(filter)).toMatchObject({ code: row.code, status: 400 });
        for (const issue of result.error!.issues) expect(issue.message).not.toContain(' at where');
      } else {
        // Every accepted row is accepted AND kept as written — a bigint stays a
        // bigint; the query face's narrowing is a query-time rewrite.
        expect(result.success, show(result.error?.issues)).toBe(true);
        expect(result.data).toEqual(filter);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// §7 Adopting the analytics carrier moves no published byte
// ---------------------------------------------------------------------------

describe('§7 — the analytics carrier filter publishes exactly the bare condition', () => {
  it('its JSON Schema projection is the optional FilterCondition\'s, byte for byte — the walk is a dropped refinement', () => {
    // Why moving the dataset carriers' declaration into its own module, and
    // making the dashboard widget's filter a carrier, changes no published
    // body: the wrapper's refinement has no JSON form, so a carrier projects
    // exactly as the plain slot it replaces (the build records it in
    // `dropped-refinements.baseline.json` instead).
    expect(JSON.stringify(z.toJSONSchema(analyticsCarrierFilter()))).toBe(
      JSON.stringify(z.toJSONSchema(FilterConditionSchema.optional())),
    );
  });

  it('the widget filter keeps its published description and title', () => {
    const widget = z.toJSONSchema(DashboardSchema) as {
      properties?: { widgets?: { items?: { properties?: { filter?: { description?: string; title?: string } } } } };
    };
    const filter = widget.properties?.widgets?.items?.properties?.filter;
    expect(filter?.description).toBe('Presentation-scope filter (runtimeFilter)');
    expect(filter?.title).toBe('Filter');
  });

  it('the report runtimeFilter keeps its published description', () => {
    const report = z.toJSONSchema(ReportSchema) as { properties?: { runtimeFilter?: { description?: string } } };
    expect(report.properties?.runtimeFilter?.description).toBe('Render-time scope filter');
  });
});
