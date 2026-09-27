// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] An ARRAY under `$ne` is refused at the SCHEMA door's operator slot,
 * `FieldOperatorsSchema.$ne`, in the comparand-shape face's own words.
 *
 * Ruling A (record 5805254639, the director seat, class 1):
 *
 * 1. 「The shared comparand-shape face refuses an array under `$ne` for every
 *    driver, and `FieldOperatorsSchema.$ne` refuses it at parse — one remedy
 *    text, naming the declared list-negation operator by its spec spelling」.
 * 3. 「pins: `$ne` arrays refused at the compile face and the schema door,
 *    scalars and `{ $field }` still pass」.
 *
 * The face's own pins live in `filter-comparand-shape.test.ts`. This file pins
 * the operator slot and the one-text rule between the two doors.
 *
 * Measured before the change, on `origin/main` `9e7824a4`:
 * `FieldOperatorsSchema.safeParse({ $ne: ['a'] })`, the same on its
 * documentation copy `EqualityOperatorSchema`, and
 * `NormalizedFilterSchema.safeParse({ $and: [{ s: { $ne: ['a'] } }] })` all
 * answered `success: true`, and `assertListComparandShapes` passed
 * `{ tags: { $ne: ['a'] } }` at every depth.
 *
 * ## What would make these pins worthless, and what stops it
 *
 * - A slot that refuses EVERYTHING passes every REFUSE row. §4 runs each
 *   control through BOTH doors and requires both to accept and KEEP the value.
 * - "Same message" read as "similar message". §3 compares the two doors'
 *   strings for EQUALITY after removing only the two clauses the face adds and
 *   the slot cannot know (` on field "…"` and ` at <path>`), and proves each
 *   clause is really there first, so the removal is not vacuous.
 */

import { describe, expect, it } from 'vitest';

import { StandardErrorCode } from '../api/errors.zod';
import { assertListComparandShapes } from './filter-comparand-shape';
import {
  EqualityOperatorSchema,
  FieldOperatorsSchema,
  NormalizedFilterSchema,
  parseFilterAST,
} from './filter.zod';

type Issue = { code?: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; data?: unknown; error?: { issues: readonly Issue[] } };

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

/** The prescription, verbatim: the declared list-negation operator and its authoring spellings. */
const REMEDY = 'For "none of these values" use {"$nin": […]} (authoring: nin, not_in, notin).';
const NOT_APPLIED = /The filter was NOT applied, and an unapplied filter would have returned the UNFILTERED result set\.$/;

const SLOTS = [
  ['FieldOperatorsSchema (the enforced copy)', FieldOperatorsSchema],
  ['EqualityOperatorSchema (the documentation copy)', EqualityOperatorSchema],
] as const;

// ---------------------------------------------------------------------------
// §1 The $ne operator slot refuses an array — both copies, one factory
// ---------------------------------------------------------------------------

describe('#19886 §1 — the $ne operator slot refuses an array', () => {
  for (const [label, schema] of SLOTS) {
    it(`${label} refuses $ne: [...] at $ne — issue code, path and the prescription`, () => {
      const issue = issueAt(schema.safeParse({ $ne: ['won', 'lost'] }), '$ne');
      expect(issue.code).toBe('custom');
      expect(issue.message).toBe(
        'Operator "$ne" requires a single comparable value, but received an array (["won","lost"]). '
        + 'For "none of these values" use {"$nin": […]} (authoring: nin, not_in, notin). The filter '
        + 'was NOT applied, and an unapplied filter would have returned the UNFILTERED result set.',
      );
    });

    it(`${label} refuses the EMPTY array too — still an array in a one-value slot`, () => {
      const issue = issueAt(schema.safeParse({ $ne: [] }), '$ne');
      expect(issue.code).toBe('custom');
      expect(issue.message).toMatch(/^Operator "\$ne" requires a single comparable value, but received an array \(\[\]\)\. /);
      expect(issue.message).toContain(REMEDY);
      expect(issue.message).toMatch(NOT_APPLIED);
    });
  }

  it('refuses a $ne array beside a legal $eq in the same map, and only the $ne', () => {
    const result = FieldOperatorsSchema.safeParse({ $eq: 'won', $ne: ['lost'] });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.'))).toEqual(['$ne']);
  });

  it('the normalized AST — which validates field conditions against FieldOperatorsSchema — refuses it at the nested path', () => {
    const issue = issueAt(
      NormalizedFilterSchema.safeParse({ $and: [{ stage: { $ne: ['won'] } }] }),
      '$and.0.stage.$ne',
    );
    expect(issue.message).toMatch(/^Operator "\$ne" requires a single comparable value/);
    expect(issue.message).toContain(REMEDY);
    // Control: the same member with a scalar is a normalized field condition.
    expect(NormalizedFilterSchema.safeParse({ $and: [{ stage: { $ne: 'won' } }] }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 The face refuses the same shape — the compile half of the ruling
// ---------------------------------------------------------------------------

describe('#19886 §2 — the shared face refuses $ne: [...] with the ADR-0112 envelope', () => {
  it.each([
    ['top level', { stage: { $ne: ['won', 'lost'] } }, 'where.stage.$ne'],
    ['EMPTY', { stage: { $ne: [] } }, 'where.stage.$ne'],
    ['under $and', { $and: [{ amount: { $gt: 1 } }, { stage: { $ne: ['won'] } }] }, 'where.$and[1].stage.$ne'],
    ['under $not', { $not: { stage: { $ne: ['won'] } } }, 'where.$not.stage.$ne'],
  ])('%s', (_label, where, facePath) => {
    const face = faceRefusal(where);
    expect(face.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(face.status).toBe(400);
    expect(face.message).toContain(` at ${facePath}. ${REMEDY}`);
    expect(face.message).toMatch(NOT_APPLIED);
  });
});

// ---------------------------------------------------------------------------
// §3 One remedy text, two doors
// ---------------------------------------------------------------------------

describe('#19886 §3 — one text, two doors', () => {
  it.each([
    ['two members', ['won', 'lost']],
    ['one member', ['won']],
    ['EMPTY', []],
    ['a long list, cut at the shared preview bound', ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc']],
  ])('%s — the operator slot prints the face\'s sentence, less the field and the location', (_label, list) => {
    const face = faceRefusal({ stage: { $ne: list } }).message;
    const field = ' on field "stage"';
    const location = ' at where.stage.$ne.';
    // The two clauses only the face can write are really there, exactly once…
    expect(face.split(field)).toHaveLength(2);
    expect(face.split(location)).toHaveLength(2);
    // …and removing them leaves the slot's message, character for character.
    const slot = issueAt(FieldOperatorsSchema.safeParse({ $ne: list }), '$ne').message;
    expect(slot).toBe(face.replace(field, '').replace(location, '.'));
    // The documentation copy is the same factory, so the same characters.
    expect(issueAt(EqualityOperatorSchema.safeParse({ $ne: list }), '$ne').message).toBe(slot);
  });

  it('every FilterArray spelling of $ne reaches the face through parseFilterAST with the same sentence', () => {
    const face = faceRefusal({ stage: { $ne: ['won', 'lost'] } }).message;
    for (const op of ['ne', '!=', '<>', 'neq', 'not_equals', 'notequals']) {
      let lowered: Error | undefined;
      try {
        parseFilterAST([['stage', op, ['won', 'lost']]]);
      } catch (error) {
        lowered = error as Error;
      }
      expect(lowered?.message, op).toBe(face);
    }
  });

  it('the remedy names the DECLARED list-negation operator, and only it', () => {
    // Read off the enforced schema, as the ruling says: `$nin` is declared, and
    // it is the operator whose comparand is a list of values NOT to match.
    const declared = Object.keys(FieldOperatorsSchema.shape);
    expect(declared).toContain('$nin');
    expect(FieldOperatorsSchema.safeParse({ $nin: ['won', 'lost'] }).success).toBe(true);
    const slot = issueAt(FieldOperatorsSchema.safeParse({ $ne: ['won'] }), '$ne').message;
    expect(slot).toContain(REMEDY);
    // ⛔ No second remedy: `$notContains` is declared on a STRING comparand,
    // and the equality slot's `$in` / `$contains` answer a different question.
    expect(FieldOperatorsSchema.safeParse({ $notContains: ['won'] }).success).toBe(false);
    for (const other of ['$notContains', '$contains', '{"$in"']) {
      expect(slot, other).not.toContain(other);
    }
    // Inside the 500-char client bound the face's messages are held to.
    const longest = faceRefusal({
      close_date: { $ne: ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc'] },
    }).message;
    expect(longest.length).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// §4 CONTROLS — both doors accept, and keep, every non-array $ne comparand
// ---------------------------------------------------------------------------

describe('#19886 §4 — what stays accepted, at BOTH doors', () => {
  const day = new Date('2026-07-01T00:00:00.000Z');
  it.each([
    ['a string', 'won'],
    ['the empty string', ''],
    ['a number, zero', 0],
    ['a boolean', false],
    ['null — the has-a-value predicate', null],
    ['a Date', day],
    ['a { $field } reference', { $field: 'budget' }],
  ])('%s', (_label, comparand) => {
    const where = { stage: { $ne: comparand } };
    expect(() => assertListComparandShapes(where)).not.toThrow();
    for (const [label, schema] of SLOTS) {
      const result = schema.safeParse({ $ne: comparand }) as Parsed;
      expect(result.success, `${label}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
      // Accepted means KEPT: the slot returns the comparand it was given.
      expect(result.data, label).toEqual({ $ne: comparand });
    }
  });

  it('the { $field } reference a $ne spelling lowers to passes both doors', () => {
    const lowered = parseFilterAST([['amount', '!=', { $field: 'budget' }]]);
    expect(lowered).toEqual({ amount: { $ne: { $field: 'budget' } } });
    expect(FieldOperatorsSchema.safeParse({ $ne: { $field: 'budget' } }).success).toBe(true);
  });

  it('the list operators keep their lists at the slot — $nin: [] included', () => {
    expect(FieldOperatorsSchema.safeParse({ $nin: [] }).success).toBe(true);
    expect(FieldOperatorsSchema.safeParse({ $in: ['a'] }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 The boundary this change does NOT move
// ---------------------------------------------------------------------------

describe('#19886 §5 — the stored-filter carrier walk', () => {
  // Why the operator slot's refusal does not reach a stored carrier:
  // `FilterConditionSchema` parses a field entry as `unknown` and judges it
  // with its own walk (`checkFilterConditionComparands`), which judges `$eq`
  // and not `$ne`. The `$eq` side of that walk is pinned in
  // `filter-equality-array-schema-door.test.ts`, including that its equality
  // arm raises nothing for `$ne`.
  it.todo(
    'FilterConditionSchema (every stored filter carrier: dataset, widget, report, rollup …) refusing '
    + '$ne: [...] on SAVE. Ruling A names the face and FieldOperatorsSchema.$ne, not the carrier walk, '
    + 'so the carrier still saves the shape and the face refuses it at query time. Reported to the '
    + 'seat for its own decision; ⛔ not pinned green here, because a green pin would read as a '
    + 'ruling nobody made',
  );
});
