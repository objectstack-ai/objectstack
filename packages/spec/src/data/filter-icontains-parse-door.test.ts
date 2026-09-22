// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19514] The two comparands `FILTER_TEXT_CASES` declares REFUSED for the
 * case-insensitive contains operator are refused AT PARSE, on both authoring
 * vocabularies.
 *
 * `filter-text-conformance.test.ts` proves the table is internally honest and
 * `filter-text-comparand.test.ts` proves the published predicate answers it.
 * Neither of those reaches a SCHEMA: until this round the platform declared the
 * two refusals as data, every backend answered them, and both authoring doors
 * admitted the document anyway — `FilterConditionSchema` and
 * `ViewFilterRuleSchema` both said `success: true` for an empty comparand and
 * for a numeric one. That is the declared-not-enforced shape ADR-0049 closes.
 *
 * ## What these pins are for, and what would make them worthless
 *
 * §1 and §2 pin each door in BOTH directions — the newly-refused comparand
 * REFUSES, and the comparand that must keep working ACCEPTS. A one-directional
 * pin cannot tell a working arm from a door that refuses everything, and an
 * inert door passes every ACCEPT-only suite ever written. Each `REFUSE` block
 * therefore also carries an ENVELOPE control: a nearby input refused for an
 * unrelated reason, proving the door is reachable and that the refusal being
 * read is the one under test.
 *
 * §3 is the pin the derivation is FOR: the doors are driven from
 * `FILTER_TEXT_CASES` itself, so a row added to the table arrives here without
 * an edit, and a door that stopped following the table goes red naming the row
 * it dropped. A transcribed list here would pass while the doors drifted, which
 * is exactly the failure the predicate was lifted into this package to end.
 */

import { describe, expect, it } from 'vitest';

import {
  FILTER_TEXT_CASES,
  type FilterTextCase,
  type FilterTextRejectionCase,
} from './filter-text-conformance';
import { FilterConditionSchema } from './filter.zod';
import { ViewFilterRuleSchema } from '../ui/view.zod';

/** The operator under test, in the two spellings that can ARRIVE. */
const DOLLAR_SPELLING = '$icontains';
const INFIX_SPELLING = 'icontains';

const isRejection = (c: FilterTextCase): c is FilterTextRejectionCase =>
  'expectRejection' in c && c.expectRejection === true;

/** Every (field, operator, comparand) triple a case's filter carries. */
function comparands(c: FilterTextCase): Array<{ field: string; operator: string; target: unknown }> {
  const out: Array<{ field: string; operator: string; target: unknown }> = [];
  for (const [field, ops] of Object.entries(c.filter as Record<string, Record<string, unknown>>)) {
    if (typeof ops !== 'object' || ops === null) continue;
    for (const [operator, target] of Object.entries(ops)) out.push({ field, operator, target });
  }
  return out;
}

/** The rows the table declares refused FOR THIS OPERATOR, in its own dialect. */
const TABLE_ROWS = FILTER_TEXT_CASES.filter(
  (c): c is FilterTextRejectionCase =>
    isRejection(c) && comparands(c).some(({ operator }) => operator === DOLLAR_SPELLING),
);

/** The issue raised at a given path, or a failure naming what was raised instead. */
function issueAt(
  result: { success: boolean; error?: { issues: readonly { path: PropertyKey[]; message: string }[] } },
  path: string,
) {
  expect(result.success).toBe(false);
  const issues = (result.error?.issues ?? []).filter((i) => i.path.join('.') === path);
  expect(issues.map((i) => i.message).join(' | ')).not.toBe('');
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

// ---------------------------------------------------------------------------
// §1 the `$` dialect door — FilterConditionSchema
// ---------------------------------------------------------------------------

describe('#19514 §1 — the $ dialect refuses what the table declares refused', () => {
  it.each([
    ['the EMPTY comparand', '', 'EMPTY STRING'],
    ['a NUMBER comparand', 42, 'not a string'],
    ['a BOOLEAN comparand', true, 'not a string'],
    ['a NULL comparand', null, 'not a string'],
  ])('refuses %s', (_label, target, marker) => {
    const issue = issueAt(
      FilterConditionSchema.safeParse({ name: { [DOLLAR_SPELLING]: target } }),
      `name.${DOLLAR_SPELLING}`,
    );
    expect(issue.message).toContain(marker);
    // The refusal names the spelling that ARRIVED, and the declared code.
    expect(issue.message).toContain(`on operator '${DOLLAR_SPELLING}'`);
    expect(issue.message).toContain('INVALID_FILTER');
  });

  it('refuses inside a $and member, at the member own path', () => {
    const issue = issueAt(
      FilterConditionSchema.safeParse({ $and: [{ name: { [DOLLAR_SPELLING]: '' } }] }),
      `$and.0.name.${DOLLAR_SPELLING}`,
    );
    expect(issue.message).toContain('EMPTY STRING');
  });

  it('refuses inside a nested relation, at the nested path', () => {
    const issue = issueAt(
      FilterConditionSchema.safeParse({ owner: { profile: { name: { [DOLLAR_SPELLING]: 42 } } } }),
      `owner.profile.name.${DOLLAR_SPELLING}`,
    );
    expect(issue.message).toContain('not a string');
  });

  it('ENVELOPE CONTROL — this door refuses an unrelated thing, so it is reachable', () => {
    // A bare date-range preset in an ordering comparand (#8793). If this reads
    // ACCEPT the door is not running at all and every REFUSE above is a phantom.
    const issue = issueAt(
      FilterConditionSchema.safeParse({ created: { $gt: 'last_7_days' } }),
      'created.$gt',
    );
    expect(issue.message).toContain('PRESET');
    expect(issue.message).not.toContain('INVALID_FILTER');
  });

  it.each([
    ['a non-empty string comparand', { name: { [DOLLAR_SPELLING]: 'acme' } }],
    ['a single space, which IS a substring', { name: { [DOLLAR_SPELLING]: ' ' } }],
    ['the case-SENSITIVE sibling, empty', { name: { $contains: '' } }],
    ['the case-SENSITIVE sibling, numeric', { name: { $contains: 42 } }],
    ['$startsWith, empty — no row in the table', { name: { $startsWith: '' } }],
    ['$endsWith, numeric — no row in the table', { name: { $endsWith: 42 } }],
    ['$ilike, empty — a different operator family', { name: { $ilike: '' } }],
    ['an ordinary equality condition', { name: 'acme' }],
    ['the AND identity', { $and: [] }],
  ])('NEGATIVE CONTROL — still accepts %s', (_label, filter) => {
    expect(FilterConditionSchema.safeParse(filter).success).toBe(true);
  });

  it('⛔ the sibling operators are NOT widened by analogy — the table decides that', () => {
    // Stated as its own assertion because "we did not do X" is invisible in a
    // suite otherwise, and widening by analogy is the failure this scope note
    // exists to prevent.
    for (const op of ['$contains', '$startsWith', '$endsWith', '$like', '$ilike']) {
      expect(FilterConditionSchema.safeParse({ name: { [op]: '' } }).success, op).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 the infix/view dialect door — ViewFilterRuleSchema
// ---------------------------------------------------------------------------

describe('#19514 §2 — the view vocabulary refuses the same two comparands', () => {
  const rule = (value?: unknown) =>
    ViewFilterRuleSchema.safeParse(
      value === undefined
        ? { field: 'name', operator: INFIX_SPELLING }
        : { field: 'name', operator: INFIX_SPELLING, value },
    );

  it.each([
    ['the EMPTY comparand', '', 'EMPTY STRING'],
    ['a NUMBER comparand', 42, 'not a string'],
    ['a BOOLEAN comparand', true, 'not a string'],
    ['a NULL comparand', null, 'not a string'],
  ])('refuses %s', (_label, value, marker) => {
    const issue = issueAt(rule(value), 'value');
    expect(issue.message).toContain(marker);
    // Names the spelling a VIEW author can actually write…
    expect(issue.message).toContain(`on operator '${INFIX_SPELLING}'`);
    // …and names the wire operator in its own tail, which is the face's job:
    // the contract half deliberately does not substitute a `$` key for what
    // arrived, because a view author cannot write one.
    expect(issue.message).toContain(`"${DOLLAR_SPELLING}"`);
    expect(issue.message).toContain('400 INVALID_FILTER');
  });

  it('carries no internal tracker id — the reader of this string cannot open one', () => {
    expect(issueAt(rule(''), 'value').message).not.toMatch(/(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])/);
  });

  it('ENVELOPE CONTROL — this door refuses an unrelated thing, so it is reachable', () => {
    // No `field`. If this reads ACCEPT the door is inert.
    const result = ViewFilterRuleSchema.safeParse({ operator: INFIX_SPELLING, value: '' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.some((i) => i.path.join('.') === 'field')).toBe(true);
  });

  it.each([
    ['a non-empty string comparand', 'acme'],
    ['a single space, which IS a substring', ' '],
    ['the digit-string an author who meant 42 writes', '42'],
  ])('NEGATIVE CONTROL — still accepts %s', (_label, value) => {
    expect(rule(value).success).toBe(true);
  });

  it('ABSENCE is left unjudged — this vocabulary HAS an absent, and no row is about it', () => {
    // `isRefusedTextComparand(undefined)` answers TRUE, and its docblock hands
    // the carve-out to callers with an "absent". `value` is optional on every
    // view rule, so an omitted comparand is not a comparand the table judged.
    expect(rule().success).toBe(true);
  });

  it('an ARRAY is the SHAPE arm defect, reported once and with the shape wording', () => {
    // One defect, one issue. The author has to fix the shape first, so that is
    // what the message must be about.
    const issue = issueAt(rule(['a']), 'value');
    expect(issue.message).toContain('requires a SCALAR value');
    expect(issue.message).not.toContain('EMPTY STRING');
    expect(issue.message).not.toContain('not a string');
  });

  it('⛔ the sibling operators are NOT widened by analogy here either', () => {
    for (const operator of ['contains', 'not_contains', 'starts_with', 'ends_with']) {
      const emptyOne = ViewFilterRuleSchema.safeParse({ field: 'name', operator, value: '' });
      const numericOne = ViewFilterRuleSchema.safeParse({ field: 'name', operator, value: 42 });
      expect(emptyOne.success, `${operator} + empty`).toBe(true);
      expect(numericOne.success, `${operator} + number`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 both doors are DRIVEN BY the table, not by a copy of it
// ---------------------------------------------------------------------------

describe('#19514 §3 — a row added to FILTER_TEXT_CASES reaches both doors', () => {
  it('the table still carries rows for this operator, so this suite is not vacuous', () => {
    expect(TABLE_ROWS.length).toBeGreaterThan(0);
  });

  it.each(TABLE_ROWS.map((c) => [c.name, c] as const))(
    '%s — the $ dialect door refuses the row own filter',
    (_name, row) => {
      const result = FilterConditionSchema.safeParse(row.filter);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      // The row declares what the refusal must NAME; the door's message is the
      // published reason text, which carries the same tokens.
      const joined = result.error.issues.map((i) => i.message).join(' ');
      for (const token of row.mustMention) expect(joined, token).toContain(token);
      expect(joined).toContain(row.code);
    },
  );

  it.each(TABLE_ROWS.map((c) => [c.name, c] as const))(
    '%s — the view door refuses the same comparand under the infix spelling',
    (_name, row) => {
      const { field, target } = comparands(row).find(({ operator }) => operator === DOLLAR_SPELLING)!;
      const result = ViewFilterRuleSchema.safeParse({ field, operator: INFIX_SPELLING, value: target });
      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      const joined = result.error.issues.map((i) => i.message).join(' ');
      // `mustMention` is spelled in the `$` dialect because the rows' filters
      // are. The view face names the `$` twin in its TAIL, so every token the
      // row requires is present here too — via a different sentence, on purpose.
      for (const token of row.mustMention) expect(joined, token).toContain(token);
      expect(joined).toContain(row.code);
    },
  );

  it('the ROWS-verdict cases of the table are all still ACCEPTED by the $ door', () => {
    // The other direction of the same derivation: every case the table expects
    // to be EVALUATED must pass the authoring door, or the door is refusing the
    // platform's own conformance corpus. This is the assertion that goes red if
    // a future arm over-reaches.
    const rows = FILTER_TEXT_CASES.filter((c) => !isRejection(c));
    expect(rows.length).toBeGreaterThan(0);
    for (const c of rows) {
      expect(FilterConditionSchema.safeParse(c.filter).success, c.name).toBe(true);
    }
  });

  it('the RETIRED-operator rejections are a different door and are NOT answered here', () => {
    // `$regex` / `$options` rows are refused because the OPERATOR is retired and
    // their comparands are ordinary non-empty strings. The comparand door must
    // stay silent about them, or it reports the wrong repair.
    const retired = FILTER_TEXT_CASES.filter(
      (c) => isRejection(c) && !comparands(c).some(({ operator }) => operator === DOLLAR_SPELLING),
    );
    expect(retired.length).toBeGreaterThan(0);
    for (const c of retired) {
      const result = FilterConditionSchema.safeParse(c.filter);
      const joined = result.success ? '' : result.error.issues.map((i) => i.message).join(' ');
      expect(joined, c.name).not.toContain('EMPTY STRING');
      expect(joined, c.name).not.toContain('not a string');
    }
  });
});
