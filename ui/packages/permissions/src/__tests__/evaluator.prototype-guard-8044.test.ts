/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8044 — `evaluateCondition` reads a condition's field in THREE cases,
 * not two, so that *inherited* and *genuinely absent* stop being the same
 * answer.
 *
 * The defect this pins closed, in one sentence: `hasOwnProperty` collapses
 * inherited into absent, and on a negative operator absent ADMITS. Measured on
 * the pre-fix source against the record `{ id: 1, tenant: 'acme' }`, every
 * prototype member name outside the three-name refusal list —  `toString`,
 * `valueOf`, `hasOwnProperty`, `isPrototypeOf` — returned `true` on `neq` and
 * on `not_in`. `true` on a row-level condition means the record passes the rule
 * that exists to hide it.
 *
 * ⛔ The fix is NOT a longer name list. A list enumerates spellings, and
 * `Object.prototype` has more of them than any list will hold; the defect is
 * the shape of the guard. The shape that closes the class is the three-case
 * read objectui#7751 landed on a sibling row-level evaluator in
 * `@object-ui/core` (retired since, at objectui#7750), and this change is a
 * port of it back to the evaluator that was #7751's reference.
 *
 * ## What this file measures, and why the last describe block is the important one
 *
 * A pin asserting only "`toString` no longer admits" would ALSO pass on an
 * implementation strictly worse than the bug: one that refuses every non-own
 * read. That implementation denies records it should admit — ordinary rows with
 * an ordinary missing field — which on a permission boundary is a worse defect
 * than the fail-open being fixed. So the discriminating pin here is the
 * GENUINELY-ABSENT case (`describe('a field that resolves nowhere …')`), per
 * operator, and the differential matrix at the bottom is what carries the rest:
 * it replays every case through the pre-fix read and the shipped one and counts
 * the verdicts that moved in each direction.
 *
 * ⭐ `widened === 0` is the acceptance criterion, matching the bar objectui#7751
 * set on that sibling evaluator over its own 2772-case matrix (352 narrowed,
 * zero widened, zero change in the genuinely-absent family).
 */

import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../evaluator';
import type { PermissionCondition } from '@object-ui/types';

/** Every operator `PermissionCondition` declares. The matrix runs all of them. */
const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'is_null',
  'is_not_null',
] as const;

type Operator = (typeof OPERATORS)[number];

const condition = (field: string, operator: Operator, value: unknown): PermissionCondition =>
  ({ field, operator, value }) as PermissionCondition;

/** One verdict out of the shipped evaluator. */
const admits = (field: string, operator: Operator, value: unknown, record: Record<string, unknown>): boolean =>
  evaluateCondition(condition(field, operator, value), record);

/**
 * The PRE-FIX read, transcribed from the source this change replaces
 * (`4eb665bcf`: a three-name list plus `hasOwnProperty`), so the differential
 * below can replay both reads in one process.
 *
 * Only the READ differs — the operator switch is the shipped one, reached
 * through `evaluateCondition` with the value this legacy read produces. That
 * keeps the transcription to the four lines that actually changed, and it is
 * why a later edit to an operator arm cannot silently desynchronise the two
 * halves of the matrix: both halves evaluate through the same switch.
 *
 * Verified against the real pre-fix module: over the full case space below,
 * `legacyVerdict` and the pre-fix `evaluateCondition` agreed on every case.
 */
function legacyVerdict(field: string, operator: Operator, value: unknown, record: Record<string, unknown>): boolean {
  if (['__proto__', 'constructor', 'prototype'].includes(field)) return false;
  const read = Object.prototype.hasOwnProperty.call(record, field) ? record[field] : undefined;
  // Replay the shipped switch over the legacy value by handing it a record that
  // carries exactly that value under a name with no prototype meaning.
  return evaluateCondition(condition('__legacy_value__', operator, value), { __legacy_value__: read });
}

/* ------------------------------------------------------------------ *
 * The record shapes. All three cases the fix distinguishes are here,
 * and they are distinguishable from each other by construction — not by
 * two reads that both come back `undefined`.
 * ------------------------------------------------------------------ */

/** `tenant` is the record's OWN data. */
const ownRecord = (): Record<string, unknown> => ({ id: 1, tenant: 'acme', age: 30 });

/** `tenant` resolves — on the prototype. It is NOT this record's data. */
const inheritedRecord = (): Record<string, unknown> =>
  Object.assign(Object.create({ tenant: 'acme', age: 30 }), { id: 1 }) as Record<string, unknown>;

/** No prototype at all: `toString` resolves NOWHERE on this record. */
const nullProtoRecord = (): Record<string, unknown> => {
  const bare = Object.create(null) as Record<string, unknown>;
  bare.id = 1;
  bare.tenant = 'acme';
  bare.age = 30;
  return bare;
};

/** An OWN key spelled like a prototype member — genuinely the record's data. */
const shadowRecord = (): Record<string, unknown> => ({
  id: 1,
  tenant: 'acme',
  age: 30,
  toString: 'shadow',
  valueOf: 'shadow',
});

const RECORD_SHAPES = [
  ['own', ownRecord],
  ['inherited', inheritedRecord],
  ['null-prototype', nullProtoRecord],
  ['own-key-shadowing-a-prototype-name', shadowRecord],
] as const;

/** Refused outright by name, before the record is consulted. */
const REFUSED_NAMES = ['__proto__', 'constructor', 'prototype'] as const;

/** On `Object.prototype` and NOT on the refusal list — the reach path. */
const UNLISTED_PROTOTYPE_NAMES = [
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
] as const;

/** Ordinary data fields. */
const OWN_NAMES = ['id', 'tenant', 'age'] as const;

/** Names that resolve nowhere on any shape above — ordinary missing fields. */
const ABSENT_NAMES = ['status', 'missing'] as const;

const FIELDS = [...REFUSED_NAMES, ...UNLISTED_PROTOTYPE_NAMES, ...OWN_NAMES, ...ABSENT_NAMES];

const VALUES: readonly unknown[] = ['acme', 'x', 30, 0, ['acme'], null];

/* ------------------------------------------------------------------ *
 * 1. The attack-shaped reach path
 * ------------------------------------------------------------------ */

describe('objectui#8044 — a condition naming an unlisted prototype member no longer admits', () => {
  it.each(UNLISTED_PROTOTYPE_NAMES)(
    'denies rather than admits for the prototype member name %s',
    (field) => {
      const record = ownRecord();
      // Every one of these returned `true` on the pre-fix source. That is the
      // card's probe table, and it is the whole defect.
      expect(admits(field, 'neq', 'x', record)).toBe(false);
      expect(admits(field, 'not_in', ['x'], record)).toBe(false);
      // These were already `false`; pinned so the fix is not read as having
      // moved them.
      expect(admits(field, 'eq', 'x', record)).toBe(false);
      expect(admits(field, 'in', ['x'], record)).toBe(false);
      expect(admits(field, 'contains', 'x', record)).toBe(false);
      expect(admits(field, 'gte', 0, record)).toBe(false);
      // `is_null` answered `true` before, off the same collapsed read.
      expect(admits(field, 'is_null', null, record)).toBe(false);
      expect(admits(field, 'is_not_null', null, record)).toBe(false);
    },
  );

  it.each(REFUSED_NAMES)('keeps refusing the listed name %s', (field) => {
    const record = ownRecord();
    for (const operator of OPERATORS) {
      expect(admits(field, operator, 'x', record)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. The accident-shaped reach path — no attacker required
 * ------------------------------------------------------------------ */

describe('objectui#8044 — an INHERITED value is not read as the record\'s data', () => {
  it('denies the negative rule that used to admit an inherited tenant', () => {
    // The record's tenant IS `acme`, through its prototype. Admitting it under
    // "tenant is not acme" is the fail-open; both verdicts below are the
    // refusal, not a comparison.
    expect(admits('tenant', 'neq', 'acme', inheritedRecord())).toBe(false);
    expect(admits('tenant', 'not_in', ['acme'], inheritedRecord())).toBe(false);
  });

  it('refuses the positive rule too, rather than answering from the prototype', () => {
    expect(admits('tenant', 'eq', 'acme', inheritedRecord())).toBe(false);
    expect(admits('tenant', 'in', ['acme'], inheritedRecord())).toBe(false);
    expect(admits('age', 'gte', 18, inheritedRecord())).toBe(false);
    expect(admits('tenant', 'is_null', null, inheritedRecord())).toBe(false);
  });

  it('reads OWN members of the same record unchanged', () => {
    // `id` is own on the inherited-shape record; only `tenant` / `age` are not.
    expect(admits('id', 'eq', 1, inheritedRecord())).toBe(true);
    expect(admits('id', 'neq', 1, inheritedRecord())).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 3. ⭐ THE DISCRIMINATING PIN
 *
 * An implementation that refused every non-own read would pass sections 1
 * and 2 and would be strictly worse than the bug. This is the section that
 * fails on it.
 * ------------------------------------------------------------------ */

describe('objectui#8044 — a field that resolves NOWHERE keeps the verdicts it has always had', () => {
  const absent = () => ({ id: 1, tenant: 'acme' }) as Record<string, unknown>;

  it.each([
    ['eq', 'archived', false],
    ['neq', 'archived', true],
    ['gt', 0, false],
    ['gte', 0, false],
    ['lt', 0, false],
    ['lte', 0, false],
    ['in', ['archived'], false],
    ['not_in', ['archived'], true],
    ['contains', 'arch', false],
    ['is_null', null, true],
    ['is_not_null', null, false],
  ] as const)(
    'operator %s on an ordinary missing field still returns %s',
    (operator, value, expected) => {
      expect(admits('status', operator as Operator, value, absent())).toBe(expected);
    },
  );

  it('distinguishes absent from inherited from own with three concrete records, one rule', () => {
    // One rule — "tenant is not acme" — three record shapes, three verdicts.
    // ⚠️ Not a comparison of two `undefined` reads: each record below is a
    // different shape and the three verdicts are not all the same.
    const rule = (record: Record<string, unknown>) => admits('tenant', 'neq', 'acme', record);
    expect(rule({ id: 1, tenant: 'acme' })).toBe(false); // own, and it matches → hidden
    expect(rule(inheritedRecord())).toBe(false); // inherited → refused → hidden
    expect(rule({ id: 1 })).toBe(true); // genuinely absent → admitted, as always
  });

  it('a prototype member name on a NULL-PROTOTYPE record resolves nowhere, so it is absent', () => {
    // The same name, the same operator, a different record shape — and the
    // verdict follows the record, not the spelling.
    expect(admits('toString', 'neq', 'x', nullProtoRecord())).toBe(true);
    expect(admits('toString', 'neq', 'x', ownRecord())).toBe(false);
  });

  it('an OWN key spelled like a prototype member is still the record\'s data', () => {
    expect(admits('toString', 'eq', 'shadow', shadowRecord())).toBe(true);
    expect(admits('toString', 'neq', 'shadow', shadowRecord())).toBe(false);
  });

  it('ordinary rules over ordinary records are untouched', () => {
    expect(admits('tenant', 'eq', 'acme', ownRecord())).toBe(true);
    expect(admits('tenant', 'neq', 'other', ownRecord())).toBe(true);
    expect(admits('age', 'gte', 18, ownRecord())).toBe(true);
    expect(admits('age', 'gte', 31, ownRecord())).toBe(false);
    expect(admits('id', 'in', [1, 2], ownRecord())).toBe(true);
  });

  it('a null record still throws from the read, exactly as before', () => {
    // Unchanged behaviour, pinned so the port is not read as having introduced
    // a swallow. A refused NAME still answers without touching the record.
    expect(() => evaluateCondition(condition('status', 'eq', 'x'), null as never)).toThrow(TypeError);
    expect(evaluateCondition(condition('constructor', 'eq', 'x'), null as never)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The differential matrix — the quantitative bar
 * ------------------------------------------------------------------ */

interface MatrixCase {
  shape: string;
  field: string;
  operator: Operator;
  value: unknown;
  before: boolean;
  after: boolean;
  /** The field resolves nowhere on this record and is not a refused name. */
  genuinelyAbsent: boolean;
}

function buildMatrix(
  fields: readonly string[] = FIELDS,
  shapes: readonly (readonly [string, () => Record<string, unknown>])[] = RECORD_SHAPES,
  operators: readonly Operator[] = OPERATORS,
  values: readonly unknown[] = VALUES,
): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const [shape, make] of shapes) {
    for (const field of fields) {
      for (const operator of operators) {
        for (const value of values) {
          const record = make();
          cases.push({
            shape,
            field,
            operator,
            value,
            before: legacyVerdict(field, operator, value, record),
            after: admits(field, operator, value, record),
            genuinelyAbsent:
              !(REFUSED_NAMES as readonly string[]).includes(field) && !(field in Object(record)),
          });
        }
      }
    }
  }
  return cases;
}

interface MatrixSummary {
  total: number;
  narrowed: number;
  widened: number;
  absentTotal: number;
  absentChanged: number;
}

function summarize(cases: readonly MatrixCase[]): MatrixSummary {
  return {
    total: cases.length,
    narrowed: cases.filter((c) => c.before && !c.after).length,
    widened: cases.filter((c) => !c.before && c.after).length,
    absentTotal: cases.filter((c) => c.genuinelyAbsent).length,
    absentChanged: cases.filter((c) => c.genuinelyAbsent && c.before !== c.after).length,
  };
}

describe('objectui#8044 — differential matrix: pre-fix read vs shipped read', () => {
  const summary = summarize(buildMatrix());

  /**
   * ⚠️ VACUITY GUARD, and it comes first on purpose.
   *
   * Every assertion below iterates a GENERATED case list, and every one of them
   * passes over an empty list — `widened === 0` most of all. So the size is
   * asserted exactly, and the next test proves that this exact-size assertion
   * is the thing that fails when the list is emptied.
   */
  it('runs the exact case space it claims to: 14 fields x 4 record shapes x 11 operators x 6 values', () => {
    expect(FIELDS).toHaveLength(14);
    expect(RECORD_SHAPES).toHaveLength(4);
    expect(OPERATORS).toHaveLength(11);
    expect(VALUES).toHaveLength(6);
    expect(summary.total).toBe(14 * 4 * 11 * 6);
    expect(summary.total).toBe(3696);
  });

  it('the vacuity guard is real: an emptied matrix fails the size assertion and only the size assertion', () => {
    const empty = summarize(buildMatrix([], [], [], []));
    expect(empty.total).toBe(0);
    // Vacuously satisfied — this is exactly why they cannot stand alone.
    expect(empty.widened).toBe(0);
    expect(empty.absentChanged).toBe(0);
    // The assertion that actually notices.
    expect(() => expect(empty.total).toBe(3696)).toThrow();
  });

  it('⭐ widened ZERO — not one verdict moved from deny to admit', () => {
    expect(summary.widened).toBe(0);
  });

  it('narrowed 234 — the fail-open verdicts this card was filed for', () => {
    expect(summary.narrowed).toBe(234);
  });

  it('the genuinely-absent family changed ZERO verdicts, and is not empty', () => {
    expect(summary.absentTotal).toBe(924);
    expect(summary.absentChanged).toBe(0);
  });

  it('every narrowed case is a prototype-name read or an inherited read — nothing else moved', () => {
    const moved = buildMatrix().filter((c) => c.before !== c.after);
    expect(moved.length).toBeGreaterThan(0);
    for (const c of moved) {
      const record = RECORD_SHAPES.find(([name]) => name === c.shape)![1]();
      const own = Object.prototype.hasOwnProperty.call(record, c.field);
      const resolves = c.field in Object(record);
      expect(own).toBe(false);
      expect(resolves).toBe(true);
    }
  });
});
