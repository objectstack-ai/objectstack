// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6059 — the rebind of {@link omitServerOwnedBlanks} onto
 * `@object-ui/plugin-form`'s newly published `omitServerResolvedDefaults` is
 * BEHAVIOUR-PRESERVING.
 *
 * The card that ordered this change says outright that nothing is currently
 * broken: "Not a defect in behaviour — nothing is currently wrong on either
 * chain." It is a structural fix, so the only thing worth asserting about it is
 * the thing a structural fix can silently get wrong — that the create payload
 * this page submits is decided identically before and after. A test that merely
 * re-describes what the new code does would pass no matter which of the two
 * functions it described.
 *
 * ## Why a reference implementation and not a table of expectations
 *
 * The oracle here is the code this change deleted. `handComposed` below is the
 * pre-#6059 body of `omitServerOwnedBlanks`, verbatim — the `serverOwned` set,
 * the `isRuntimeDefault` filter, the `isMissingForRequired` test, the early
 * returns. Every case runs through both and the two results must agree on VALUE
 * and on KEY ORDER (a payload is serialised, so key order is observable in the
 * request body even though it changes no semantics).
 *
 * A hand-written expectation table would encode what the author BELIEVES both
 * versions do; the deleted code encodes what the shipped one actually did.
 *
 * ## The counter-probes are the load-bearing half
 *
 * "Agrees with the reference" is satisfiable by a matrix too narrow to tell any
 * two implementations apart, so {@link WRONG_COMPOSITIONS} carries four ways of
 * getting this rule wrong — each one a plausible slip, not a strawman — and the
 * suite asserts that the SHIPPED function disagrees with every one of them on
 * this matrix, at a named case. If a future edit narrows the matrix until it
 * stops discriminating, those assertions go red before the equivalence ones do.
 *
 * ## What the matrix has to cover
 *
 * The discriminating axes are the two predicates' own boundaries, crossed:
 *
 *   - the default: absent / static literal / runtime TOKEN / CEL envelope;
 *   - the submitted value: `''` (the text-family arms), `null` (the number
 *     family), `undefined`, and the three shapes `isMissingForRequired`
 *     deliberately keeps as VALUES — `false`, `0`, a non-empty string — plus
 *     `[]`, which it treats as missing;
 *   - the mode: create and edit;
 *   - a key in the payload that no rendered row declares.
 */

import { describe, expect, it } from 'vitest';
import { isMissingForRequired, isRuntimeDefault } from '@object-ui/core';
import { omitServerOwnedBlanks } from './FormPage';

/** The renderer's own row type, taken from the function rather than restated. */
type Row = Parameters<typeof omitServerOwnedBlanks>[1][number];

/** A rendered row carrying `defaultValue` — every other key is inert here. */
function row(name: string, defaultValue?: unknown): Row {
  return {
    name,
    label: name,
    type: 'text',
    required: false,
    readonly: false,
    hidden: false,
    colSpan: 1,
    defaultValue,
  };
}

/**
 * The pre-#6059 body of `omitServerOwnedBlanks`, verbatim. This is the ORACLE:
 * the rebind is correct exactly insofar as it agrees with the code it replaced.
 */
function handComposed(
  values: Record<string, unknown>,
  fields: Row[],
  isCreateForm: boolean,
): Record<string, unknown> {
  if (!isCreateForm) return values;
  const serverOwned = new Set(
    fields.filter((f) => isRuntimeDefault(f.defaultValue)).map((f) => f.name),
  );
  if (serverOwned.size === 0) return values;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (serverOwned.has(key) && isMissingForRequired(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Ways to get the composition wrong. Each is a real slip:
 *
 *   - `or` — the two predicates ORed instead of ANDed. Eats every blank in the
 *     payload AND every value on a server-owned field.
 *   - `no-create-gate` — the rule applied on edit too, which is the #5883
 *     docblock's first boundary and would silently discard a user's deliberate
 *     removal.
 *   - `blank-string-only` — "empty" narrowed to `''`, the obvious spelling,
 *     which leaves the number family (whose cleared write is `null`) behind.
 *   - `value-only` — the default ignored, so any blank is dropped, including
 *     one the user cleared from a field the server will never fill.
 */
const WRONG_COMPOSITIONS: Record<
  string,
  (values: Record<string, unknown>, fields: Row[], isCreateForm: boolean) => Record<string, unknown>
> = {
  or: (values, fields, isCreateForm) => {
    if (!isCreateForm) return values;
    const byName = new Map(fields.map((f) => [f.name, f]));
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (isRuntimeDefault(byName.get(key)?.defaultValue) || isMissingForRequired(value)) continue;
      out[key] = value;
    }
    return out;
  },
  'no-create-gate': (values, fields) => {
    const byName = new Map(fields.map((f) => [f.name, f]));
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (isRuntimeDefault(byName.get(key)?.defaultValue) && isMissingForRequired(value)) continue;
      out[key] = value;
    }
    return out;
  },
  'blank-string-only': (values, fields, isCreateForm) => {
    if (!isCreateForm) return values;
    const byName = new Map(fields.map((f) => [f.name, f]));
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (isRuntimeDefault(byName.get(key)?.defaultValue) && value === '') continue;
      out[key] = value;
    }
    return out;
  },
  'value-only': (values, _fields, isCreateForm) => {
    if (!isCreateForm) return values;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (isMissingForRequired(value)) continue;
      out[key] = value;
    }
    return out;
  },
};

/**
 * One rendered form covering every default shape the classifier tells apart.
 * `title` has no default at all; `status` a static literal; `owner` /
 * `remind_at` the two runtime TOKENS; `priority` / `stage` CEL envelopes.
 */
const ROWS: Row[] = [
  row('title'),
  row('status', 'draft'),
  row('owner', 'current_user'),
  row('remind_at', 'NOW()'),
  row('priority', { dialect: 'cel', source: 'defaultPriority()' }),
  row('stage', { dialect: 'cel', source: 'initialStage()' }),
];

/** Every value spelling a control on this page can write back. */
const VALUE_SPELLINGS: Array<[string, unknown]> = [
  ['blank string', ''],
  ['null', null],
  ['undefined', undefined],
  ['empty array', []],
  ['false', false],
  ['zero', 0],
  ['a typed value', 'typed'],
];

/** `values` keys the rows do not declare, plus whole-payload shapes. */
const PAYLOAD_CASES: Array<[string, Record<string, unknown>]> = [
  ['empty payload', {}],
  [
    'a full payload with every arm cleared',
    { title: '', status: '', owner: '', remind_at: '', priority: null, stage: '' },
  ],
  [
    'a full payload the user really filled in',
    { title: 'a', status: 'b', owner: 'user-99', remind_at: '2026-03-04', priority: 7, stage: 'new' },
  ],
  [
    'a key no rendered row declares, held blank',
    { extra: '', owner: '' },
  ],
  [
    'a key no rendered row declares, holding a value',
    { extra: 'kept', owner: 'user-99' },
  ],
];

/** Every (payload, mode) pair this suite judges, with a readable name. */
function allCases(): Array<[string, Record<string, unknown>, boolean]> {
  const cases: Array<[string, Record<string, unknown>, boolean]> = [];
  for (const isCreateForm of [true, false]) {
    const mode = isCreateForm ? 'create' : 'edit';
    for (const r of ROWS) {
      for (const [spelling, value] of VALUE_SPELLINGS) {
        cases.push([`${mode}: ${r.name} holding ${spelling}`, { [r.name]: value }, isCreateForm]);
      }
    }
    for (const [name, payload] of PAYLOAD_CASES) {
      cases.push([`${mode}: ${name}`, payload, isCreateForm]);
    }
  }
  return cases;
}

const CASES = allCases();

describe('omitServerOwnedBlanks after the #6059 rebind', () => {
  it('decides every case exactly as the hand-composed predicates did', () => {
    const disagreements: string[] = [];
    for (const [name, values, isCreateForm] of CASES) {
      const actual = omitServerOwnedBlanks(values, ROWS, isCreateForm);
      const expected = handComposed(values, ROWS, isCreateForm);
      // Value AND key order: the payload is serialised, so the order the keys
      // travel in is observable in the request body.
      if (
        JSON.stringify(Object.keys(actual)) !== JSON.stringify(Object.keys(expected)) ||
        Object.keys(actual).some((k) => !Object.is(actual[k], expected[k]))
      ) {
        disagreements.push(name);
      }
    }
    expect(disagreements).toEqual([]);
    // The matrix is not vacuous.
    expect(CASES.length).toBeGreaterThan(80);
  });

  it('never mutates the payload it was handed', () => {
    const values = { owner: '', title: '' };
    const before = { ...values };
    omitServerOwnedBlanks(values, ROWS, true);
    expect(values).toEqual(before);
  });
});

describe('the matrix tells the right composition from the wrong ones', () => {
  it.each(Object.keys(WRONG_COMPOSITIONS))(
    'disagrees with the `%s` composition somewhere in the matrix',
    (variant) => {
      const wrong = WRONG_COMPOSITIONS[variant];
      const disagreements = CASES.filter(([, values, isCreateForm]) => {
        const shipped = omitServerOwnedBlanks(values, ROWS, isCreateForm);
        const other = wrong(values, ROWS, isCreateForm);
        return JSON.stringify(Object.keys(shipped)) !== JSON.stringify(Object.keys(other));
      });
      expect(disagreements.length).toBeGreaterThan(0);
    },
  );

  it('keeps a real value the user typed into a server-owned field (`or` would eat it)', () => {
    const values = { owner: 'user-99' };
    expect(omitServerOwnedBlanks(values, ROWS, true)).toEqual({ owner: 'user-99' });
    expect(WRONG_COMPOSITIONS.or(values, ROWS, true)).toEqual({});
  });

  it('keeps a cleared EDIT column (`no-create-gate` would drop it)', () => {
    const values = { owner: '' };
    expect(omitServerOwnedBlanks(values, ROWS, false)).toEqual({ owner: '' });
    expect(WRONG_COMPOSITIONS['no-create-gate'](values, ROWS, false)).toEqual({});
  });

  it('drops a cleared NUMBER arm, whose write is `null` (`blank-string-only` would keep it)', () => {
    const values = { priority: null };
    expect(omitServerOwnedBlanks(values, ROWS, true)).toEqual({});
    expect(WRONG_COMPOSITIONS['blank-string-only'](values, ROWS, true)).toEqual({ priority: null });
  });

  it('keeps a blank on a field with no runtime default (`value-only` would eat it)', () => {
    const values = { title: '', status: '' };
    expect(omitServerOwnedBlanks(values, ROWS, true)).toEqual({ title: '', status: '' });
    expect(WRONG_COMPOSITIONS['value-only'](values, ROWS, true)).toEqual({});
  });
});
