// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Date subtraction the runtime cannot answer is refused at author time (#28944).
 *
 * The type-soundness gate declared a `date` / `datetime` field a Timestamp, so
 * `record.end_date - record.start_date` checked as a legal `Duration` and
 * built. The runtime never holds a Timestamp there: every read door hands a
 * date field out as its text (`YYYY-MM-DD`, or the ISO-8601 instant for a
 * date-time), so the evaluator faults on the subtraction (the formula reads
 * null), and `today() - record.start_date` (the text coerced against a
 * Timestamp) computes a `Duration`, which a field serialises as `{}`.
 * `firstDateTextVerdict` re-checks what the Timestamp typing passes with the
 * field declared as that text, so the gate's verdict falls out of the same
 * typing the evaluator applies.
 *
 * Every row is judged twice — by the gate and by the evaluator over the row a
 * read door serves — so the table pins that the gate refuses exactly the
 * shapes that cannot produce a value, and nothing the evaluator answers.
 * Message pins live with the other code pins in
 * `expression-refusal-codes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { celEngine } from './cel-engine';
import { validateExpression, type ExprSchemaHint } from './validate';

const RECORD_SCOPE: ExprSchemaHint = {
  scope: 'record',
  objectName: 'qa_doctor_time_off',
  fields: ['title', 'start_date', 'end_date', 'start_at', 'end_at', 'amount', 'cost'],
  fieldTypes: {
    title: 'text',
    start_date: 'date',
    end_date: 'date',
    start_at: 'datetime',
    end_at: 'datetime',
    amount: 'number',
    cost: 'currency',
  },
};

/** The row a read door serves for those fields: dates as their text. */
const SERVED_ROW = {
  title: 't1',
  start_date: '2026-11-01',
  end_date: '2026-11-05',
  start_at: '2026-11-01T10:00:00.000Z',
  end_at: '2026-11-05T12:00:00.000Z',
  amount: 10,
  cost: 4,
};

/** What the evaluator gives a field computed from `source` over the served row. */
function runtimeReading(source: string): 'null' | '{}' | 'value' {
  const r = celEngine.evaluate({ dialect: 'cel', source }, { record: SERVED_ROW });
  if (!r.ok) return 'null';
  return JSON.stringify(r.value) === '{}' ? '{}' : 'value';
}

function codesOf(role: 'value' | 'predicate', source: string): string[] {
  const r = validateExpression(role, source, RECORD_SCOPE);
  return r.errors.map((e) => e.code);
}

describe('date subtraction the runtime cannot answer (#28944)', () => {
  // [role, source, the code the gate answers (null = clean), what the evaluator reads]
  const ROWS: ReadonlyArray<readonly ['value' | 'predicate', string, string | null, 'null' | '{}' | 'value']> = [
    // The card's shapes, refused.
    ['value', 'record.end_date - record.start_date', 'date-text-arithmetic', 'null'],
    ['value', 'today() - record.start_date', 'date-duration-value', '{}'],
    // Datetime, measured: its text faults the same way, and a Timestamp minus it is a Duration.
    ['value', 'record.end_at - record.start_at', 'date-text-arithmetic', 'null'],
    ['value', 'now() - record.start_at', 'date-duration-value', '{}'],
    ['value', 'record.start_date - today()', 'date-duration-value', '{}'],
    // The subtraction feeding a comparison still cannot produce a value.
    ['predicate', 'record.end_date - record.start_date > duration("72h")', 'date-text-arithmetic', 'null'],
    ['value', 'record.start_date - duration("24h")', 'date-text-arithmetic', 'null'],
    // The `+ 1` shape keeps its own refusal (asserted word for word below).
    ['value', '(record.end_date - record.start_date) + 1', 'date-arithmetic', 'null'],
    ['value', '(today() - record.start_date) + 1', 'date-arithmetic', 'null'],
    // Controls: every shape the evaluator answers stays clean.
    ['value', 'daysBetween(record.start_date, record.end_date)', null, 'value'],
    ['value', 'daysBetween(record.start_date, today())', null, 'value'],
    ['predicate', 'today() - record.start_date > duration("72h")', null, 'value'],
    ['value', '(today() - record.start_date).getHours()', null, 'value'],
    ['predicate', 'record.end_date < record.start_date', null, 'value'],
    ['predicate', 'record.start_date < today()', null, 'value'],
    ['predicate', 'record.start_at > now()', null, 'value'],
    ['predicate', 'record.start_date >= "2026-01-01"', null, 'value'],
    ['predicate', 'record.start_date == "2026-11-01"', null, 'value'],
    ['predicate', 'record.start_date != null && record.end_date != null', null, 'value'],
    ['value', '"Due: " + record.end_date', null, 'value'],
    ['value', 'addDays(record.start_date, 3)', null, 'value'],
    ['value', 'record.amount - record.cost', null, 'value'],
  ];

  for (const [role, source, code, reads] of ROWS) {
    it(`${role} \`${source}\` → ${code ?? 'clean'} (the evaluator reads ${reads})`, () => {
      expect(runtimeReading(source)).toBe(reads);
      expect(codesOf(role, source)).toEqual(code === null ? [] : [code]);
    });
  }

  it('the `+ 1` shape keeps its words: the Timestamp typing still answers first', () => {
    const r = validateExpression('value', '(record.end_date - record.start_date) + 1', RECORD_SCOPE);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe('date-arithmetic');
    expect(r.errors[0].params).toEqual({ operands: 'google.protobuf.Duration + int', reference: 'record.start_date' });
  });

  it('names the field and prescribes daysBetween', () => {
    const [span] = validateExpression('value', 'record.end_date - record.start_date', RECORD_SCOPE).errors;
    expect(span.params).toEqual({ operands: 'DateText - DateText', reference: 'record.start_date' });
    expect(span.message).toMatch(/evaluates to null/);
    expect(span.message).toMatch(/daysBetween\(a, b\)/);
    const [since] = validateExpression('value', 'today() - record.start_date', RECORD_SCOPE).errors;
    expect(since.params).toEqual({ reference: 'record.start_date' });
    expect(since.message).toMatch(/reads `\{\}`/);
    expect(since.message).toMatch(/daysBetween\(a, b\)/);
  });

  it('judges a flattened (flow) condition the same way', () => {
    const flattened: ExprSchemaHint = {
      fields: ['start_date', 'end_date'],
      fieldTypes: { start_date: 'date', end_date: 'date' },
    };
    const refused = validateExpression('predicate', 'end_date - start_date > duration("72h")', flattened);
    expect(refused.errors.map((e) => e.code)).toEqual(['date-text-arithmetic']);
    expect(refused.errors[0].params).toEqual({ operands: 'DateText - DateText', reference: 'start_date' });
    expect(validateExpression('predicate', 'today() - start_date > duration("72h")', flattened).errors).toEqual([]);
  });

  it('a predicate that computes a duration is not a formula value, so only `value` refuses it', () => {
    // A predicate's computed type is another check's question; the `{}` reading is a field's.
    expect(codesOf('predicate', 'today() - record.start_date')).toEqual([]);
    expect(codesOf('value', 'today() - record.start_date')).toEqual(['date-duration-value']);
  });

  it('without field types the check does not run, as before', () => {
    const r = validateExpression('value', 'record.end_date - record.start_date', { scope: 'record' });
    expect(r.errors).toEqual([]);
  });
});
