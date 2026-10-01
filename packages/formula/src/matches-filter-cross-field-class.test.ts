// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20355] Given the object's declared columns, `matchesFilterCondition`
 * refuses a `{ $field }` comparison between two columns that share no
 * comparison class — the spec's `crossFieldComparisonVerdict`, the rule
 * driver-sql's read applies to the same comparison — with `INVALID_FILTER` /
 * 400, before any record is read.
 *
 * This evaluator IS the RLS write check (plugin-security matches a policy's
 * `check`, or its `using` standing in, against the post-image). Measured
 * through the real plugin-security on driver-sql before this rule, on SQLite
 * and PostgreSQL:
 *
 * | policy                            | read it scopes         | insert its `check` judges, before | now          |
 * |---|---|---|---|
 * | `record.status != record.amount`  | `INVALID_FILTER` / 400 | admitted, stored (`'open' !== 5`)  | 400, nothing stored |
 * | `record.status != record.photo`   | `INVALID_FILTER` / 400 | admitted, stored                   | 400, nothing stored |
 * | `record.status != record.is_open` | `INVALID_FILTER` / 400 | admitted, stored                   | 400, nothing stored |
 * | `record.status != record.title`   | admitted               | admitted                           | admitted (control) |
 *
 * The expectations below are written from each column's LABEL in this file's
 * own table (same class label ⇒ comparable), never from the verdict function
 * under test, so the pin is a second statement of the rule rather than an
 * echo of it.
 */

import { describe, it, expect } from 'vitest';
import {
  crossFieldClassRefusalCarriedBy,
  findCrossFieldClassRefusal,
  matchesFilterCondition,
  type MatchesFilterOptions,
} from './matches-filter';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * One declared column per comparison class, and one per family with none. The
 * label is the expectation: two columns are comparable iff both carry the same
 * CLASS label (`none:*` never compares, not even with itself).
 */
const COLUMNS: ReadonlyArray<{ name: string; type: string; multiple?: boolean; label: string }> = [
  { name: 'status', type: 'text', label: 'text' },
  { name: 'title', type: 'textarea', label: 'text' },
  { name: 'stage', type: 'select', label: 'text' },
  { name: 'account', type: 'lookup', label: 'text' },
  { name: 'amount', type: 'number', label: 'numeric' },
  { name: 'budget', type: 'currency', label: 'numeric' },
  { name: 'is_won', type: 'boolean', label: 'boolean' },
  { name: 'close_date', type: 'date', label: 'date' },
  { name: 'closed_at', type: 'datetime', label: 'datetime' },
  { name: 'call_at', type: 'time', label: 'time' },
  { name: 'photo', type: 'image', label: 'none:file' },
  { name: 'is_open', type: 'formula', label: 'none:formula' },
  { name: 'meta', type: 'json', label: 'none:list-or-object' },
  { name: 'watchers', type: 'lookup', multiple: true, label: 'none:list-or-object' },
];

const FIELDS: NonNullable<MatchesFilterOptions['fields']> = Object.fromEntries(
  COLUMNS.map((c) => [c.name, c.multiple ? { type: c.type, multiple: true } : { type: c.type }]),
);
const OPTIONS: MatchesFilterOptions = { fields: FIELDS };
const OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'] as const;

const comparable = (a: string, b: string): boolean => {
  const la = COLUMNS.find((c) => c.name === a)!.label;
  const lb = COLUMNS.find((c) => c.name === b)!.label;
  return la === lb && !la.startsWith('none:');
};

const refusalOf = (filter: unknown, record: Record<string, unknown> = {}): WireBearingError | null => {
  try {
    matchesFilterCondition(record, filter as never, OPTIONS);
    return null;
  } catch (e) {
    return e as WireBearingError;
  }
};

describe('matchesFilterCondition — a field compared with a field of no shared comparison class, given the declared columns (#20355)', () => {
  for (const target of COLUMNS) {
    it(`${target.name} (${target.label}) against every declared column, all six operators`, () => {
      const wrong: string[] = [];
      for (const ref of COLUMNS) {
        for (const op of OPERATORS) {
          const err = refusalOf({ [target.name]: { [op]: { $field: ref.name } } });
          const refused = err !== null;
          if (refused === comparable(target.name, ref.name)) {
            wrong.push(`${target.name} ${op} ${ref.name}: ${refused ? 'refused' : 'admitted'}`);
          }
          if (err) {
            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
          }
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  it('the card\'s cells: text vs number, text vs a file field, text vs a formula field are refused; text vs text is compared', () => {
    for (const ref of ['amount', 'photo', 'is_open']) {
      const err = refusalOf({ status: { $ne: { $field: ref } } }, { status: 'open', amount: 5, photo: 'f1' });
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(matchesFilterCondition({ status: 'open', title: 'x' }, { status: { $ne: { $field: 'title' } } } as never, OPTIONS)).toBe(true);
    expect(matchesFilterCondition({ status: 'x', title: 'x' }, { status: { $ne: { $field: 'title' } } } as never, OPTIONS)).toBe(false);
  });

  it('is refused for every record or for none — the record is never read', () => {
    const filter = { status: { $ne: { $field: 'amount' } } };
    for (const record of [{}, { status: 'open', amount: 5 }, { status: 'open', amount: 'open' }, { status: null, amount: null }]) {
      expect(refusalOf(filter, record)?.code).toBe('INVALID_FILTER');
    }
  });

  it('is found at any depth under $and / $or / $not, beside a satisfied branch', () => {
    const record = { status: 'open', title: 'open', amount: 5 };
    for (const filter of [
      { $and: [{ status: { $eq: 'open' } }, { status: { $ne: { $field: 'amount' } } }] },
      { $or: [{ status: { $eq: 'open' } }, { status: { $ne: { $field: 'amount' } } }] },
      { $not: { amount: { $gt: { $field: 'status' } } } },
      { $or: [{ $and: [{ $not: { status: { $lte: { $field: 'closed_at' } } } }] }] },
    ]) {
      expect(refusalOf(filter, record)?.code).toBe('INVALID_FILTER');
    }
  });

  it('judges an offset reference on its two columns, as driver-sql asks the class before it reads the offset', () => {
    expect(refusalOf({ close_date: { $lte: { $field: 'closed_at', addDays: 3 } } })?.code).toBe('INVALID_FILTER');
    expect(refusalOf({ close_date: { $lte: { $field: 'close_date', addDays: 3 } } })).toBeNull();
  });

  it('leaves a comparison it cannot judge from the declarations to the rules that own it', () => {
    // An undeclared column, a dotted path, a type outside FieldType: not this rule's question.
    expect(refusalOf({ status: { $ne: { $field: 'nope' } } })).toBeNull();
    expect(refusalOf({ nope: { $ne: { $field: 'amount' } } })).toBeNull();
    expect(refusalOf({ status: { $ne: { $field: 'account.amount' } } })).toBeNull();
    expect(matchesFilterCondition({ a: 'x', b: 1 }, { a: { $eq: { $field: 'b' } } } as never, { fields: { a: { type: 'string' }, b: { type: 'number' } } })).toBe(false);
    // A literal comparand and the list operators are not field-to-field comparisons.
    expect(refusalOf({ amount: { $gt: 5 }, status: { $in: ['open'] } }, { amount: 6, status: 'open' })).toBeNull();
  });

  it('without the declared columns it judges values only, exactly as before', () => {
    expect(matchesFilterCondition({ status: 'open', amount: 5 }, { status: { $ne: { $field: 'amount' } } } as never)).toBe(true);
    expect(matchesFilterCondition({ status: 'open', amount: 5 }, { status: { $ne: { $field: 'amount' } } } as never, {})).toBe(true);
  });

  it('names nothing from the filter in the message, and carries the comparison for the server log', () => {
    const err = refusalOf({ status: { $ne: { $field: 'photo' } } })!;
    for (const name of ['status', 'photo', '$ne', 'image']) expect(err.message).not.toContain(`"${name}"`);
    expect(err.message).not.toMatch(/\bstatus\b|\bphoto\b/);
    expect(JSON.parse(JSON.stringify(err))).not.toHaveProperty('field');
    const carried = crossFieldClassRefusalCarriedBy(err);
    expect(carried).toMatchObject({ field: 'status', operator: '$ne', reference: 'photo' });
    expect(carried?.verdict.verdict).toBe('no-class');
    expect(carried?.diagnostic).toContain('"photo" (type \'image\') is a file field');
    expect(crossFieldClassRefusalCarriedBy(new Error('x'))).toBeNull();
  });

  it('leads with its remedy and fits the REST client-message bound whole, however long the column names', () => {
    // The REST door cuts a 4xx message of 500 characters or more to 499 plus an
    // ellipsis (`CLIENT_MESSAGE_MAX`, `@objectstack/rest`): it keeps the HEAD.
    const remedy =
      'In a row-level policy, compare a field only with a field of the same class, or fix the declaration of ' +
      'the one that is declared with the wrong type.';
    const long = (stem: string) => `${stem}_${'x'.repeat(120)}`;
    const longFields = { [long('stage')]: { type: 'text' }, [long('amount')]: { type: 'number' } };
    const shortErr = refusalOf({ status: { $ne: { $field: 'amount' } } })!;
    let longErr: WireBearingError | null = null;
    try {
      matchesFilterCondition({}, { [long('stage')]: { $ne: { $field: long('amount') } } } as never, { fields: longFields });
    } catch (e) {
      longErr = e as WireBearingError;
    }
    expect({ code: longErr?.code, status: longErr?.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
    // It names no column, so its length does not depend on theirs.
    expect(longErr?.message).toBe(shortErr.message);
    expect(shortErr.message.startsWith(remedy)).toBe(true);
    expect(shortErr.message.length).toBeLessThan(500);
    // After the remedy: what is refused, why, and why the columns are withheld.
    const at = (s: string) => shortErr.message.indexOf(s);
    expect([at('share no class'), at('so it is refused'), at('withheld')].every((i, n, a) => i > remedy.length && (n === 0 || i > a[n - 1]))).toBe(true);
  });

  it('findCrossFieldClassRefusal answers null for a filter whose comparisons all compare', () => {
    expect(findCrossFieldClassRefusal({ $and: [{ status: { $eq: { $field: 'title' } } }, { amount: { $lt: { $field: 'budget' } } }] }, FIELDS)).toBeNull();
    expect(findCrossFieldClassRefusal({ amount: { $lt: { $field: 'status' } } }, FIELDS)).toMatchObject({
      field: 'amount',
      operator: '$lt',
      reference: 'status',
      verdict: { verdict: 'cross-class', left: 'numeric', right: 'text' },
    });
  });
});
