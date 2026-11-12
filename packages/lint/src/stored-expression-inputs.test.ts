// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32529] A STORED field's `expression` (any field but a `formula`) is
 * computed at the write and kept, so the build judges the inputs the write
 * cannot keep current (`stored-expression-inputs.ts`):
 *
 *  - a read of another record through a reference is refused, under
 *    `stored-expression-cross-record-input` — the measured case is a leave
 *    request reading `record.employee.daily_hours`, which stayed 40 after the
 *    employee's hours moved to 30.
 *
 * A `formula` field reading the same inputs is computed on every read and is
 * not reported. The object save door's half is the #32529 block of
 * `runtime-gate.object-formula-writes.test.ts`. Every fixture goes through
 * `specValid`: these are verdicts on an expression's inputs, so the stack must
 * be one the schema accepts outright.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackSchema } from '@objectstack/spec';

import { validateStackExpressions } from './validate-expressions.js';
import { STORED_EXPRESSION_CROSS_RECORD_INPUT } from './stored-expression-inputs.js';

const MANIFEST = { id: 'com.example.stored-inputs', name: 'stored_inputs', version: '1.0.0', type: 'app' } as const;

/** A fixture is only a fixture if the spec accepts it. */
function specValid(stack: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
  if (!result.success) {
    throw new Error(
      'fixture is not spec-valid: '
        + result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

const employee = {
  name: 'hr_employee',
  label: 'Employee',
  fields: {
    full_name: { type: 'text', label: 'Name' },
    daily_hours: { type: 'number', label: 'Daily Hours' },
  },
};

/** The leave request, with one computed field `probe` of the given type and kind. */
const leave = (probe: Record<string, unknown>) => ({
  name: 'hr_leave_request',
  label: 'Leave Request',
  fields: {
    employee: { type: 'lookup', label: 'Employee', reference: 'hr_employee' },
    approver: { type: 'user', label: 'Approver' },
    days: { type: 'number', label: 'Days' },
    starts_on: { type: 'date', label: 'Starts On' },
    probe: { label: 'Probe', ...probe },
  },
});

const WHERE = "object 'hr_leave_request' · field 'probe' expression";

const findingsOf = (probe: Record<string, unknown>) =>
  validateStackExpressions(specValid({ objects: [employee, leave(probe)] })).filter((i) => i.where === WHERE);

const ofRule = (rule: string, probe: Record<string, unknown>) => findingsOf(probe).filter((i) => i.rule === rule);

const RULES = [STORED_EXPRESSION_CROSS_RECORD_INPUT];
const neither = (probe: Record<string, unknown>) => findingsOf(probe).filter((i) => RULES.includes(i.rule ?? ''));

describe('a stored expression reading another record is refused (#32529)', () => {
  it('⭐ the measured case: `record.employee.daily_hours` on a stored number is refused, at the key the author edits', () => {
    const expression = 'record.days * record.employee.daily_hours';
    const errors = ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'number', expression });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ severity: 'error', where: WHERE, source: expression });
    // The path is named, so the author can find the read.
    expect(errors[0]!.message).toContain('`record.employee.daily_hours`');
  });

  it('refuses a read through a `user` field too (the type fixes its target)', () => {
    const errors = ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'text', expression: 'record.approver.name' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.severity).toBe('error');
  });

  it('refuses the indexed and the optional spellings of the same hop', () => {
    expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'number', expression: "record['employee'].daily_hours" })).toHaveLength(1);
    expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'number', expression: 'record.employee.?daily_hours.orValue(0.0)' })).toHaveLength(1);
  });

  it('admits a same-row expression, the reference itself and its `id`', () => {
    expect(neither({ type: 'number', expression: 'record.days * 8' })).toEqual([]);
    expect(neither({ type: 'text', expression: 'string(record.employee)' })).toEqual([]);
    expect(neither({ type: 'text', expression: 'record.employee.id' })).toEqual([]);
  });

  it('does not judge a `formula` field reading the same hop: it is computed on every read', () => {
    expect(neither({ type: 'formula', expression: 'record.days * record.employee.daily_hours' })).toEqual([]);
  });
});
