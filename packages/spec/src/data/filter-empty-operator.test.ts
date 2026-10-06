// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20311] `$empty` — the declared emptiness operator.
 *
 * Ruling B on #20311 (record 5861435168) set what 「is empty」 means once, per
 * field type: text-like = null or `''`; multi-value (multi-select, tags,
 * multi-value lookup) = null or `[]`; every other type = null only. Ruling A on
 * #20399 (record 5865693155) spelled it as `$empty: boolean`, "whose describe
 * IS the per-type table", expanded by each compile surface "through one spec
 * function". The maintainer's amendment (record 5868169573, 「照 $like 先例分阶段」)
 * staged it: declared in `FieldOperatorsSchema`, absent from `FILTER_OPERATORS`
 * until every face had its arm, the `is_empty` lowering `$null` meanwhile.
 * [#20446] ended the staging: `$empty` is in `FILTER_OPERATORS` and the
 * `is_empty` / `is_not_empty` lowering emits it (§4).
 *
 * The pins ruling A lists for this card, one `describe` each:
 *
 * 1. the description string equals the ruled table — and each type list it
 *    names equals the set the expansion reads, so prose and code cannot drift;
 * 2. `{ tags: { $empty: true } }` parses at the schema door, and `{ tags: [] }`
 *    is still refused (ruling 乙 on #19757 untouched);
 * 3. the expansion function (`./filter-empty-operator.ts`, published on the
 *    data entry) returns the text, multi-value and null arms for the three
 *    field kinds, and the value predicate answers each arm;
 * 4. [#20446, inverted from the staging pin] `$empty` is IN
 *    `FILTER_OPERATORS`, and every spelling of the view operators `is_empty` /
 *    `is_not_empty` lowers to it — on the array sugar and in
 *    `canonicalAstOperator`'s fold. The rows those lowered rules answer are
 *    each face's own suite (`memory-20446-empty-flip.test.ts`,
 *    `sql-driver-20446-empty-flip.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { StandardErrorCode } from '../api/errors.zod';
import {
  MULTI_CAPABLE_TYPES,
  MULTI_OPTION_TYPES,
  STRING_VALUE_TYPES,
} from './field-value.zod';
import { FieldType } from './field.zod';
import { EMPTY_OPERATOR_ARMS, expandEmptyOperator, isEmptyFilterValue } from './filter-empty-operator';
import {
  FILTER_OPERATORS,
  FieldOperatorsSchema,
  FilterConditionSchema,
  NormalizedFilterSchema,
  SpecialOperatorSchema,
  canonicalAstOperator,
  parseFilterAST,
} from './filter.zod';
import * as dataBarrel from './index';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };

/** The one issue at `path` (dot-joined), failing loudly on none or several. */
function issueAt(result: Parsed, path: string): Issue {
  expect(result.success, `expected a refusal at ${path}`).toBe(false);
  const issues = (result.error?.issues ?? []).filter((i) => i.path.join('.') === path);
  expect(issues, `issues raised: ${JSON.stringify((result.error?.issues ?? []).map((i) => i.path))}`).toHaveLength(1);
  return issues[0]!;
}

/** The thrown refusal of `run`, failing loudly when it does not throw. */
function refusalOf(run: () => unknown): Error & { code?: string; status?: number } {
  try {
    run();
  } catch (error) {
    return error as Error & { code?: string; status?: number };
  }
  throw new Error('expected a refusal, got none');
}

/** A slot's `.describe()` text, through `.optional()`. */
function descriptionOf(shape: Record<string, unknown>, key: string): string | undefined {
  return (shape[key] as { description?: string } | undefined)?.description;
}

// ---------------------------------------------------------------------------
// §1 The description IS the ruled table
// ---------------------------------------------------------------------------

describe('§1 — the $empty description is the ruled per-type table', () => {
  /** The ruled table, verbatim as the operator describes it. */
  const RULED_TABLE =
    'Is-empty check by the field\'s DECLARED type. `true` matches rows whose field is empty, '
    + '`false` is its exact complement. What counts as empty: text-like types (text, textarea, '
    + 'email, url, phone, password, secret, markdown, html, richtext, code, color, signature, '
    + 'qrcode) = null or \'\' (the empty string); multi-value types (multiselect, checkboxes, '
    + 'tags, and select, radio, lookup, user, file or image with multiple: true) = null or [] '
    + '(the empty list); every other type = null only. A face that holds no field declaration '
    + 'judges by the value: null, \'\' and [] are empty. A face that answers by the declared '
    + 'type refuses the operator on a column whose declaration it does not hold (the built-in '
    + 'id, for one) rather than guess a row; use $null there for "has no value". The view '
    + 'operators is_empty / is_not_empty lower to this operator.';

  it('the enforced copy and the documentation copy carry the same string, and it is the table', () => {
    expect(descriptionOf(FieldOperatorsSchema.shape, '$empty')).toBe(RULED_TABLE);
    expect(descriptionOf(SpecialOperatorSchema.shape, '$empty')).toBe(RULED_TABLE);
  });

  it('each type list the table names is the set the expansion reads — prose and code cannot drift', () => {
    const text = [...STRING_VALUE_TYPES];
    expect(RULED_TABLE).toContain(`text-like types (${text.join(', ')}) = null or '' (the empty string)`);
    const inherent = [...MULTI_OPTION_TYPES];
    const capable = [...MULTI_CAPABLE_TYPES];
    expect(RULED_TABLE).toContain(
      `multi-value types (${inherent.join(', ')}, and ${capable.slice(0, -1).join(', ')} or ${capable.at(-1)} `
        + 'with multiple: true) = null or [] (the empty list)',
    );
    expect(RULED_TABLE).toContain('every other type = null only');
  });
});

// ---------------------------------------------------------------------------
// §2 The schema door: $empty parses; the empty list is still refused
// ---------------------------------------------------------------------------

describe('§2 — { tags: { $empty: true } } parses; { tags: [] } is still refused', () => {
  it('the enforced operator slot keeps a boolean $empty rather than stripping it', () => {
    // An undeclared key on this non-strict object is STRIPPED on parse; a
    // declared one survives. `toEqual` holding both values is the difference.
    expect(FieldOperatorsSchema.parse({ $empty: true })).toEqual({ $empty: true });
    expect(FieldOperatorsSchema.parse({ $empty: false })).toEqual({ $empty: false });
    expect(SpecialOperatorSchema.parse({ $empty: true })).toEqual({ $empty: true });
  });

  it('the save door and the normalized AST accept it, at any depth, and keep it', () => {
    for (const where of [
      { tags: { $empty: true } },
      { name: { $empty: false } },
      { $or: [{ tags: { $empty: true } }, { name: { $empty: false } }] },
      { $not: { tags: { $empty: true } } },
    ]) {
      const parsed = FilterConditionSchema.safeParse(where);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(parsed.data).toEqual(where);
    }
    // The normalized AST validates a field condition against the enforced slot.
    const ast = NormalizedFilterSchema.safeParse({ $and: [{ tags: { $empty: true } }] });
    expect(ast.success, JSON.stringify(ast.error?.issues)).toBe(true);
    expect(ast.data).toEqual({ $and: [{ tags: { $empty: true } }] });
    expect(NormalizedFilterSchema.safeParse({ $and: [{ tags: { $empty: 'yes' } }] }).success).toBe(false);
  });

  it('the empty list stays refused in the equality slot — the ruled refusal of an array there is untouched', () => {
    for (const [where, path] of [
      [{ tags: [] }, 'tags'],
      [{ tags: { $eq: [] } }, 'tags.$eq'],
    ] as const) {
      const issue = issueAt(FilterConditionSchema.safeParse(where), path);
      expect(issue.code).toBe('custom');
      expect(issue.message).toMatch(/requires a single comparable value, but received an array/);
    }
    // …and at the query face, in the ADR-0112 envelope.
    const face = refusalOf(() => parseFilterAST({ tags: [] }));
    expect(face.code).toBe(StandardErrorCode.enum.INVALID_FILTER);
    expect(face.status).toBe(400);
  });

  it('a non-boolean $empty is refused at the slot and at the save door, as $null and $exists are', () => {
    expect(issueAt(FieldOperatorsSchema.safeParse({ $empty: 'true' }), '$empty').code).toBe('invalid_type');
    for (const [where, path] of [
      [{ tags: { $empty: 'true' } }, 'tags.$empty'],
      [{ tags: { $empty: 1 } }, 'tags.$empty'],
      [{ $or: [{ tags: { $empty: null } }] }, '$or.0.tags.$empty'],
    ] as const) {
      const issue = issueAt(FilterConditionSchema.safeParse(where), path);
      expect(issue.code).toBe('custom');
      expect(issue.message).toMatch(/^Operator "\$empty" on field "tags" requires a boolean comparand \(true or false\)\. /);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 The expansion: three arms for the three field kinds, and the value test
// ---------------------------------------------------------------------------

describe('§3 — expandEmptyOperator answers the ruled arm per field definition', () => {
  it('is published on the data entry — the one function every compile surface imports', () => {
    expect(dataBarrel.expandEmptyOperator).toBe(expandEmptyOperator);
    expect(dataBarrel.isEmptyFilterValue).toBe(isEmptyFilterValue);
    expect(dataBarrel.EMPTY_OPERATOR_ARMS).toBe(EMPTY_OPERATOR_ARMS);
  });

  it('returns the text, multi-value and null arms for the three kinds the ruling names', () => {
    expect(expandEmptyOperator({ type: 'text' })).toBe(EMPTY_OPERATOR_ARMS.text);
    expect(expandEmptyOperator({ type: 'tags' })).toBe(EMPTY_OPERATOR_ARMS.multi_value);
    expect(expandEmptyOperator({ type: 'multiselect' })).toBe(EMPTY_OPERATOR_ARMS.multi_value);
    // A multi-value lookup is the DEFINITION's `multiple`, not the type.
    expect(expandEmptyOperator({ type: 'lookup', multiple: true })).toBe(EMPTY_OPERATOR_ARMS.multi_value);
    expect(expandEmptyOperator({ type: 'lookup' })).toBe(EMPTY_OPERATOR_ARMS.null_only);
    expect(expandEmptyOperator({ type: 'number' })).toBe(EMPTY_OPERATOR_ARMS.null_only);
  });

  it('each arm says which stored states count as empty beside null', () => {
    expect(EMPTY_OPERATOR_ARMS.text).toEqual({ arm: 'text', emptyString: true, emptyList: false });
    expect(EMPTY_OPERATOR_ARMS.multi_value).toEqual({ arm: 'multi_value', emptyString: false, emptyList: true });
    expect(EMPTY_OPERATOR_ARMS.null_only).toEqual({ arm: 'null_only', emptyString: false, emptyList: false });
    expect(Object.isFrozen(EMPTY_OPERATOR_ARMS)).toBe(true);
    for (const arm of Object.values(EMPTY_OPERATOR_ARMS)) expect(Object.isFrozen(arm)).toBe(true);
  });

  it('every declarable field type lands on exactly the arm its value class names', () => {
    const multiCapable = new Set(MULTI_CAPABLE_TYPES);
    for (const type of FieldType.options) {
      const single = expandEmptyOperator({ type }).arm;
      const expected = MULTI_OPTION_TYPES.has(type) ? 'multi_value' : STRING_VALUE_TYPES.has(type) ? 'text' : 'null_only';
      expect(single, type).toBe(expected);
      if (multiCapable.has(type)) expect(expandEmptyOperator({ type, multiple: true }).arm, `${type} multiple`).toBe('multi_value');
    }
    // The two value classes are disjoint, so the multi-first order decides nothing today.
    for (const type of STRING_VALUE_TYPES) {
      expect(MULTI_OPTION_TYPES.has(type) || MULTI_CAPABLE_TYPES.has(type), type).toBe(false);
    }
  });

  it('isEmptyFilterValue answers each declared arm, and $empty: false is its exact complement', () => {
    const values: ReadonlyArray<readonly [label: string, value: unknown, text: boolean, multi: boolean, nullOnly: boolean]> = [
      ['null', null, true, true, true],
      ['undefined (absent)', undefined, true, true, true],
      ["''", '', true, false, false],
      ['[]', [], false, true, false],
      ['a string', 'a', false, false, false],
      ['a whitespace string', ' ', false, false, false],
      ['a one-member list', ['a'], false, false, false],
      ['zero', 0, false, false, false],
      ['false', false, false, false, false],
    ];
    for (const [label, value, text, multi, nullOnly] of values) {
      expect(isEmptyFilterValue(value, EMPTY_OPERATOR_ARMS.text), `text ← ${label}`).toBe(text);
      expect(isEmptyFilterValue(value, EMPTY_OPERATOR_ARMS.multi_value), `multi ← ${label}`).toBe(multi);
      expect(isEmptyFilterValue(value, EMPTY_OPERATOR_ARMS.null_only), `null ← ${label}`).toBe(nullOnly);
    }
  });

  it('without a declaration the value decides: null, \'\' and [] are empty (the formula matcher and having)', () => {
    expect([null, undefined, '', []].map((v) => isEmptyFilterValue(v))).toEqual([true, true, true, true]);
    expect([' ', 'a', ['a'], 0, false, {}].map((v) => isEmptyFilterValue(v))).toEqual([false, false, false, false, false, false]);
    // The one named divergence from the declared table: a non-text column holding ''.
    expect(isEmptyFilterValue('')).toBe(true);
    expect(isEmptyFilterValue('', expandEmptyOperator({ type: 'number' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 The flip: in FILTER_OPERATORS, and the view operators lower to it
// ---------------------------------------------------------------------------

describe('§4 — $empty is IN FILTER_OPERATORS and is_empty / is_not_empty lower to it', () => {
  it('is in FILTER_OPERATORS, beside the other value-presence flags', () => {
    // Inverted from #20311's staging pin (the maintainer's amendment, record
    // 5868169573): every compile face answers `$empty` now (#20444, #20445),
    // so the enforcement surface names it. `STAGED_AHEAD_OF_BACKENDS`
    // (`filter-operator-vocabulary.test.ts`) no longer does.
    expect(FILTER_OPERATORS as readonly string[]).toContain('$empty');
    expect(FILTER_OPERATORS.slice(-3)).toEqual(['$null', '$exists', '$empty']);
    expect(Object.keys(FieldOperatorsSchema.shape)).toContain('$empty');
  });

  it('every spelling of is_empty lowers to $empty: true and of is_not_empty to $empty: false, whatever the filler', () => {
    for (const op of ['is_empty', 'isempty', 'IS_EMPTY', 'IsEmpty']) {
      for (const filler of [true, false, 'x', undefined]) {
        expect(parseFilterAST(['tags', op, filler]), `${op} ${String(filler)}`).toEqual({ tags: { $empty: true } });
      }
    }
    for (const op of ['is_not_empty', 'isnotempty', 'IS_NOT_EMPTY']) {
      for (const filler of [true, false, 'x', undefined]) {
        expect(parseFilterAST(['tags', op, filler]), `${op} ${String(filler)}`).toEqual({ tags: { $empty: false } });
      }
    }
    // Nested under the array sugar's combinators too — a stored view rule set.
    expect(parseFilterAST(['or', ['tags', 'is_empty', true], ['name', 'is_not_empty', true]])).toEqual({
      $or: [{ tags: { $empty: true } }, { name: { $empty: false } }],
    });
  });

  it('the null pair keeps its own lowering — is_null is not is_empty', () => {
    expect(parseFilterAST(['tags', 'is_null', true])).toEqual({ tags: { $null: true } });
    expect(parseFilterAST(['tags', 'isnotnull', true])).toEqual({ tags: { $null: false } });
  });

  it('canonicalAstOperator folds the empty pair onto its OWN names, not onto is_null / is_not_null', () => {
    for (const op of ['is_empty', 'isempty', 'IS_EMPTY']) expect(canonicalAstOperator(op), op).toBe('is_empty');
    for (const op of ['is_not_empty', 'isnotempty']) expect(canonicalAstOperator(op), op).toBe('is_not_empty');
    for (const op of ['is_null', 'isnull']) expect(canonicalAstOperator(op), op).toBe('is_null');
    for (const op of ['is_not_null', 'isnotnull']) expect(canonicalAstOperator(op), op).toBe('is_not_null');
  });
});
