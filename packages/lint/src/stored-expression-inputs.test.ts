// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32529, #32554] A STORED field's `expression` (any field but a `formula`)
 * is computed at the write and kept, so the build judges the two inputs the
 * write cannot keep current (`stored-expression-inputs.ts`):
 *
 *  - a read of another record through a reference is warned, under
 *    `stored-expression-cross-record-input` — the measured case is a leave
 *    request reading `record.employee.daily_hours`, which stayed 40 after the
 *    employee's hours moved to 30;
 *  - a read of the clock, the acting user or a permission is warned, under
 *    `stored-expression-volatile-input`.
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
import { STORED_EXPRESSION_CROSS_RECORD_INPUT, STORED_EXPRESSION_VOLATILE_INPUT } from './stored-expression-inputs.js';

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

const RULES = [STORED_EXPRESSION_CROSS_RECORD_INPUT, STORED_EXPRESSION_VOLATILE_INPUT];
const neither = (probe: Record<string, unknown>) => findingsOf(probe).filter((i) => RULES.includes(i.rule ?? ''));

describe('a stored expression reading another record is warned (#32529)', () => {
  it('⭐ the measured case: `record.employee.daily_hours` on a stored number is warned, at the key the author edits', () => {
    const expression = 'record.days * record.employee.daily_hours';
    const found = findingsOf({ type: 'number', expression });
    const warned = found.filter((i) => i.rule === STORED_EXPRESSION_CROSS_RECORD_INPUT);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ severity: 'warning', where: WHERE, source: expression });
    // The path is named, so the author can find the read.
    expect(warned[0]!.message).toContain('`record.employee.daily_hours`');
    // The repair names this object and this field, so it is scoped to their rows.
    expect(warned[0]!.message).toContain('--object hr_leave_request --field probe --changed --apply');
    // A warning only: the build does not fail on it.
    expect(found.filter((i) => (i.severity ?? 'error') === 'error')).toEqual([]);
  });

  it('warns a read through a `user` field too (the type fixes its target)', () => {
    const warned = ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'text', expression: 'record.approver.name' });
    expect(warned).toHaveLength(1);
    expect(warned[0]!.severity).toBe('warning');
  });

  it('warns the indexed and the optional spellings of the same hop, `record.?a.?b` included', () => {
    for (const expression of [
      "record['employee'].daily_hours",
      'record.employee.?daily_hours.orValue(0.0)',
      'record.?employee.?daily_hours.orValue(0.0)',
    ]) {
      expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'number', expression }), expression).toHaveLength(1);
    }
  });

  it('⭐ warns a hop through a reference column the registry injects, on an object that does not declare it', () => {
    // `owner_id` and `created_by` are injected as `lookup`s to `sys_user`; the
    // engine plans the hop over the registered schema, so the read is served.
    expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'text', expression: 'record.owner_id.name' })).toHaveLength(1);
    expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'text', expression: 'record.created_by.name' })).toHaveLength(1);
    // The first-party shape: a stored title reading the owner's name optionally.
    expect(ofRule(STORED_EXPRESSION_CROSS_RECORD_INPUT, { type: 'text', expression: "record.?owner_id.?name.orValue('')" })).toHaveLength(1);
  });

  it('CONTROL — `ownership: \'none\'` injects no `owner_id`, so its read is not a hop through a reference', () => {
    const noOwner = { ...leave({ type: 'text', expression: "record.?owner_id.?name.orValue('')" }), ownership: 'none' };
    const found = validateStackExpressions(specValid({ objects: [employee, noOwner] }))
      .filter((i) => i.where === WHERE && i.rule === STORED_EXPRESSION_CROSS_RECORD_INPUT);
    expect(found).toEqual([]);
    // …while `created_by` (the audit family, which `ownership` does not govern) still is.
    const audit = { ...leave({ type: 'text', expression: 'record.created_by.name' }), ownership: 'none' };
    expect(validateStackExpressions(specValid({ objects: [employee, audit] }))
      .filter((i) => i.where === WHERE && i.rule === STORED_EXPRESSION_CROSS_RECORD_INPUT)).toHaveLength(1);
  });

  it('warns a hop through a reference an object extension adds', () => {
    const extended = {
      objects: [employee, leave({ type: 'number', expression: 'record.days * record.backup.daily_hours' })],
      objectExtensions: [{ extend: 'hr_leave_request', fields: { backup: { type: 'lookup', label: 'Backup', reference: 'hr_employee' } } }],
    };
    const found = validateStackExpressions(specValid(extended))
      .filter((i) => i.where === WHERE && i.rule === STORED_EXPRESSION_CROSS_RECORD_INPUT);
    expect(found).toHaveLength(1);
  });

  it('admits a same-row expression, the reference itself and its `id`', () => {
    expect(neither({ type: 'number', expression: 'record.days * 8' })).toEqual([]);
    expect(neither({ type: 'text', expression: 'string(record.employee)' })).toEqual([]);
    expect(neither({ type: 'text', expression: 'record.employee.id' })).toEqual([]);
  });

  it('does not judge a `formula` field reading the same hop: it is computed on every read', () => {
    expect(neither({ type: 'formula', expression: 'record.days * record.employee.daily_hours' })).toEqual([]);
    expect(neither({ type: 'formula', expression: 'record.owner_id.name' })).toEqual([]);
  });
});

describe('a stored expression reading a volatile input is warned (#32554)', () => {
  it('⭐ `today()` on a stored date is warned, and only warned', () => {
    const found = findingsOf({ type: 'date', expression: 'today()' });
    const warned = found.filter((i) => i.rule === STORED_EXPRESSION_VOLATILE_INPUT);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ severity: 'warning', where: WHERE, source: 'today()' });
    expect(warned[0]!.message).toContain('`today()`');
    expect(found.filter((i) => (i.severity ?? 'error') === 'error')).toEqual([]);
  });

  it('⭐ the current user is warned', () => {
    const warned = ofRule(STORED_EXPRESSION_VOLATILE_INPUT, { type: 'text', expression: 'current_user.id' });
    expect(warned).toHaveLength(1);
    expect(warned[0]!.severity).toBe('warning');
    expect(warned[0]!.message).toContain('`current_user`');
  });

  it('warns every spelling the engine mounts the user under, the other clock functions and a permission', () => {
    for (const expression of ['user.id', 'ctx.user.id', 'os.user.id', "os['user'].id", "ctx['user'].id", "ctx[?'user'].?id.orValue('')"]) {
      expect(ofRule(STORED_EXPRESSION_VOLATILE_INPUT, { type: 'text', expression }), expression).toHaveLength(1);
    }
    for (const expression of ['now()', 'daysFromNow(3)', 'daysAgo(3)']) {
      expect(ofRule(STORED_EXPRESSION_VOLATILE_INPUT, { type: 'datetime', expression }), expression).toHaveLength(1);
    }
    expect(ofRule(STORED_EXPRESSION_VOLATILE_INPUT, { type: 'boolean', expression: "current_user.can('hr_employee', 'edit')" })).toHaveLength(1);
  });

  it('does not count the organization, a date of the row, or a loop variable named like a root', () => {
    expect(neither({ type: 'text', expression: 'os.org.id' })).toEqual([]);
    expect(neither({ type: 'date', expression: 'addDays(record.starts_on, 2)' })).toEqual([]);
    expect(neither({ type: 'boolean', expression: '[1, 2].exists(user, user > 1)' })).toEqual([]);
  });

  it('does not judge a `formula` field reading the clock or the user', () => {
    expect(neither({ type: 'formula', expression: 'daysBetween(record.starts_on, today())' })).toEqual([]);
    expect(neither({ type: 'formula', expression: 'current_user.id' })).toEqual([]);
  });
});
