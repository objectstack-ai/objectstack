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

  it('judges a flattened (flow) condition the same way, under the flow codes (#30016)', () => {
    const flattened: ExprSchemaHint = {
      fields: ['start_date', 'end_date'],
      fieldTypes: { start_date: 'date', end_date: 'date' },
    };
    // No declared outcome: the run fails wherever the name holds the date's text.
    const refused = validateExpression('predicate', 'end_date - start_date > duration("72h")', flattened);
    expect(refused.errors.map((e) => e.code)).toEqual(['date-text-arithmetic-run-may-fail']);
    expect(refused.errors[0].params).toEqual({ operands: 'DateText - DateText', reference: 'start_date' });
    expect(refused.errors[0].message).not.toMatch(/evaluates to null/);
    // The run is proven to hold the field: it fails at the condition.
    const proven = validateExpression('predicate', 'end_date - start_date > duration("72h")', { ...flattened, faultOutcome: 'run-fails' });
    expect(proven.errors.map((e) => e.code)).toEqual(['date-text-arithmetic-run-fails']);
    expect(proven.errors[0].message).toMatch(/this faults at runtime, and a flow condition that cannot be evaluated fails the run/);
    // A node can rebind the bare names: not proven, whatever the outcome.
    const unproven = validateExpression('predicate', 'end_date - start_date > duration("72h")', {
      ...flattened, faultOutcome: 'run-fails', bareNamesUnproven: true,
    });
    expect(unproven.errors.map((e) => e.code)).toEqual(['date-text-arithmetic-run-may-fail']);
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

/**
 * #32595 — the same split on two more shapes, judged the same way: by the gate
 * and by the evaluator over the row a read door serves.
 *
 *  - A call handed a date field's text that no overload accepts: the Timestamp
 *    typing hands `isoDate(record.start_at)` the Timestamp it asks for and
 *    passes it; the evaluator faults on every row
 *    (`found no matching overload for 'isoDate(string)'`), so a formula reads
 *    null and an `error` validation rule refuses every write. Refused at the
 *    gate (`date-text-call*`), prescribing the field parsed by `date(…)` first.
 *  - Concatenating a date field with text, or ordering it against a text
 *    literal: the evaluator answers both (string concatenation, string-lex),
 *    which the Timestamp typing read as `string + Timestamp` /
 *    `Timestamp < string` and reported as a type mismatch — a refusal on a
 *    fail-closed site. Accepted, as `firstTypeMismatch`'s docblock and the
 *    `DateText` overload table declare.
 */
describe('a date field\'s text handed to a call, concatenated or ordered against text (#32595)', () => {
  /** The card's object: a date-time read as its ISO text, a year to match it against. */
  const LEAVE: ExprSchemaHint = {
    scope: 'record',
    objectName: 'c982_leave_request',
    fields: ['title', 'start_time', 'start_day', 'end_day'],
    fieldTypes: { title: 'text', start_time: 'datetime', start_day: 'date', end_day: 'date' },
  };
  const ROW_2026 = { title: 'Leave', start_time: '2026-11-16T01:00:00.000Z', start_day: '2026-11-16', end_day: '2026-11-20' };
  const ROW_2025 = { ...ROW_2026, start_time: '2025-11-16T01:00:00.000Z', start_day: '2025-11-16' };
  type Outcome = ExprSchemaHint['faultOutcome'];
  /** Every code the gate answers, errors and warnings alike. */
  function gate(role: 'value' | 'predicate', source: string, faultOutcome?: Outcome): string[] {
    const r = validateExpression(role, source, faultOutcome ? { ...LEAVE, faultOutcome } : LEAVE);
    return [...r.errors, ...r.warnings].map((e) => e.code);
  }
  /** What the evaluator answers over `row`: the value, or `fault`. */
  function evaluated(source: string, row: Record<string, unknown> = ROW_2026): unknown {
    const r = celEngine.evaluate({ dialect: 'cel', source }, { record: row });
    // Only an overload fault (a call or an operator the bound text cannot
    // take) reads as 'fault'; any other fault (an unbound name, a typo) is
    // returned as itself and fails the row.
    if (r.ok) return r.value;
    return /no (matching|such) overload/.test(r.error.message) ? 'fault' : r.error;
  }

  // [role, source, faultOutcome, the codes the gate answers, what the evaluator reads over ROW_2026]
  const ROWS: ReadonlyArray<readonly ['value' | 'predicate', string, Outcome, readonly string[], unknown]> = [
    // The card's rule and formula: every check passed them, every row faults.
    ['predicate', "!startsWith(isoDate(record.start_time), '2026')", 'fail-closed', ['date-text-call-fail-closed'], 'fault'],
    ['predicate', "!startsWith(isoDate(record.start_time), '2026')", 'fail-open', ['date-text-call-fail-open'], 'fault'],
    ['value', "record.title + ' ' + isoDate(record.start_time)", undefined, ['date-text-call'], 'fault'],
    ['value', 'isoDatetime(record.start_time)', undefined, ['date-text-call'], 'fault'],
    ['value', 'isoDate(record.start_day)', undefined, ['date-text-call'], 'fault'],
    ['predicate', 'record.start_time.getFullYear() == 2026', 'fail-closed', ['date-text-call-fail-closed'], 'fault'],
    // The prescribed rewrites check clean and read the day.
    ['predicate', "!startsWith(isoDate(date(record.start_time)), '2026')", 'fail-closed', [], false],
    ['value', "record.title + ' ' + isoDate(date(record.start_time))", undefined, [], 'Leave 2026-11-16'],
    ['value', 'isoDatetime(date(record.start_time))', undefined, [], '2026-11-16T01:00:00.000Z'],
    ['value', 'isoDate(date(record.start_day))', undefined, [], '2026-11-16'],
    ['predicate', 'date(record.start_time).getFullYear() == 2026', 'fail-closed', [], true],
    // Concatenation and ordering against a literal: the evaluator answers them.
    ['value', "record.title + ' ' + record.start_time", undefined, [], 'Leave 2026-11-16T01:00:00.000Z'],
    ['predicate', "record.title + ' ' + record.start_time != ''", 'fail-closed', [], true],
    ['value', '"Due: " + record.end_day', undefined, [], 'Due: 2026-11-20'],
    ['value', 'record.end_day + " (due)"', undefined, [], '2026-11-20 (due)'],
    ['predicate', 'record.start_day < "2026-12-01"', 'fail-closed', [], true],
    ['predicate', '"2026-01-01" <= record.start_time', 'fail-closed', [], true],
    // Calls the evaluator answers on a string stay clean.
    ['predicate', "startsWith(record.start_time, '2026')", 'fail-closed', [], true],
    ['predicate', "record.start_time.startsWith('2026')", 'fail-closed', [], true],
    ['predicate', 'size(record.start_day) == 10', 'fail-closed', [], true],
    ['value', 'string(record.start_time)', undefined, [], '2026-11-16T01:00:00.000Z'],
    ['value', 'daysBetween(record.start_day, record.end_day)', undefined, [], 4],
    ['value', 'isoDate(today())', undefined, [], evaluated('isoDate(today())')],
    // Kept as they were: a real fault, and an ordering against a TEXT field no declared text names.
    ['predicate', 'record.title < today()', 'fail-closed', ['type-mismatch-fail-closed'], 'fault'],
    ['predicate', 'record.title < record.start_time', 'fail-closed', ['type-mismatch-fail-closed'], false],
  ];

  for (const [role, source, outcome, codes, reads] of ROWS) {
    it(`${role}${outcome ? ` (${outcome})` : ''} \`${source}\` → ${codes.join(', ') || 'clean'} (the evaluator reads ${String(reads)})`, () => {
      expect(evaluated(source)).toEqual(reads);
      expect(gate(role, source, outcome)).toEqual(codes);
    });
  }

  it('the card\'s rule, rewritten as prescribed, passes a 2026 write and refuses a 2025 one', () => {
    const rule = "!startsWith(isoDate(date(record.start_time)), '2026')";
    expect(gate('predicate', rule, 'fail-closed')).toEqual([]);
    // A validation condition that is true refuses the write.
    expect(evaluated(rule, ROW_2026)).toBe(false);
    expect(evaluated(rule, ROW_2025)).toBe(true);
  });

  it('names the call and the field, and prescribes the rewrite the check proved clean', () => {
    const [refused] = validateExpression(
      'predicate',
      "!startsWith(isoDate(record.start_time), string(int(record.leave_year)))",
      { ...LEAVE, fields: [...LEAVE.fields!, 'leave_year'], faultOutcome: 'fail-closed' },
    ).errors;
    expect(refused.code).toBe('date-text-call-fail-closed');
    expect(refused.params).toEqual({
      call: 'isoDate(record.start_time)',
      reference: 'record.start_time',
      rewrite: 'isoDate(date(record.start_time))',
    });
    expect(refused.message).toMatch(/fails closed: the write .* is refused/);
    // The prescription is what the evaluator answers.
    expect(evaluated('isoDate(date(record.start_time))')).toBe('2026-11-16');
  });

  it('a fault the check meets first does not mask the call', () => {
    // The check stops at the first call, handed the field through a ternary (no
    // field to name, so not this check's verdict); each call is judged on its own.
    const source =
      "isoDate(record.title == '' ? record.end_day : record.start_day) != '' || isoDate(record.end_day) == '2026-11-20'";
    const [refused] = validateExpression('predicate', source, { ...LEAVE, faultOutcome: 'fail-closed' }).errors;
    expect(refused.code).toBe('date-text-call-fail-closed');
    expect(refused.params).toMatchObject({ call: 'isoDate(record.end_day)', reference: 'record.end_day' });
    expect(evaluated(source)).toBe('fault');
  });

  it('judges a flattened (flow) condition the same way, under the flow codes', () => {
    const flattened: ExprSchemaHint = { fields: ['start_time'], fieldTypes: { start_time: 'datetime' } };
    const source = "isoDate(start_time) == '2026-11-16'";
    expect(validateExpression('predicate', source, flattened).errors.map((e) => e.code)).toEqual(['date-text-call-run-may-fail']);
    expect(validateExpression('predicate', source, { ...flattened, faultOutcome: 'run-fails' }).errors.map((e) => e.code))
      .toEqual(['date-text-call-run-fails']);
    expect(celEngine.evaluate({ dialect: 'cel', source }, { extra: { start_time: ROW_2026.start_time } })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("no matching overload for 'isoDate(string)'") },
    });
    expect(validateExpression('predicate', '"Due: " + start_time != ""', flattened).warnings).toEqual([]);
  });

  it('without field types the check does not run, as before', () => {
    expect(validateExpression('value', 'isoDate(record.start_time)', { scope: 'record' }).errors).toEqual([]);
  });
});
