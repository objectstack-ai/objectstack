// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0157 D4/D6 (#35356): the working-day formula functions count with a
 * working calendar the engine loads for a formula field's or a computed
 * field's `expression` only. The publish lint accepts them there (with the
 * calendar code a quoted literal, the engine's loading contract) and refuses
 * them at every other expression site, prescribing the stored due-time field.
 * A sharing rule's condition is also refused by the enforceability pass,
 * which lowers it to a filter: no calendar arithmetic runs in SQL.
 *
 * Every fixture goes through `ObjectStackSchema.safeParse` first, so no case
 * pins a branch an author cannot reach.
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackSchema } from '@objectstack/spec';

import { validateStackExpressions } from './validate-expressions.js';
import { validateSharingRuleEnforceability } from './validate-sharing-rule-enforceability.js';

const MANIFEST = { id: 'com.example.working-day', name: 'working_day_probe', version: '1.0.0', type: 'app' } as const;

function specValid(stack: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
  if (!result.success) {
    throw new Error(
      'fixture is not spec-valid: ' +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

const ticket = (extraFields: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) => ({
  name: 'ticket_probe',
  label: 'Ticket probe',
  fields: {
    name: { type: 'text', label: 'Name' },
    region: { type: 'text', label: 'Region' },
    start: { type: 'date', label: 'Start' },
    opened_at: { type: 'datetime', label: 'Opened at' },
    ...extraFields,
  },
  ...rest,
});

const errorsOf = (stack: Record<string, unknown>) =>
  validateStackExpressions(specValid(stack)).filter((i) => i.severity === 'error');

describe('publish lint — working-day functions at the two served sites (ADR-0157 D4, D6)', () => {
  it.each([
    'addWorkingDays(record.start, 3)',
    "addWorkingDays(record.start, 3, 'cn_mainland')",
    "workingDaysBetween(record.start, today(), 'cn_mainland')",
    "record.region == 'us' ? addWorkingDays(record.start, 3, 'us') : addWorkingDays(record.start, 3, 'cn_mainland')",
  ])('accepts a formula field calling %s', (expression) => {
    expect(errorsOf({ objects: [ticket({ due: { type: 'formula', label: 'Due', expression } })] })).toEqual([]);
  });

  it("accepts a stored datetime field's `expression` (the D6 due column)", () => {
    const due_at = { type: 'datetime', label: 'Due at', expression: 'addWorkingHours(record.opened_at, 8)' };
    expect(errorsOf({ objects: [ticket({ due_at })] })).toEqual([]);
  });

  it('refuses a calendar code that is not a quoted literal, prescribing the branch between literal calls', () => {
    const due = { type: 'formula', label: 'Due', expression: 'addWorkingDays(record.start, 3, record.region)' };
    const errors = errorsOf({ objects: [ticket({ due })] });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('addWorkingDays() names its working calendar with an expression');
    expect(errors[0]!.message).toContain('write the calendar code as a quoted literal');
    expect(errors[0]!.message).toContain("record.region == 'us' ? addWorkingDays(record.start, 3, 'us')");
  });
});

describe('publish lint — working-day functions anywhere else are refused (ADR-0157 D4, D6)', () => {
  const STORE_IT = 'Store the due time instead: give the object a datetime field whose `expression` calls';

  it('refuses a validation rule condition, prescribing the stored due-time field', () => {
    const errors = errorsOf({
      objects: [
        ticket({}, {
          validations: [{
            name: 'not_overdue', type: 'script', severity: 'error', message: 'm',
            condition: 'addWorkingDays(record.start, 3) < now()',
          }],
        }),
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("addWorkingDays() counts with the organization's working calendar");
    expect(errors[0]!.message).toContain(`${STORE_IT} addWorkingDays()`);
  });

  it("refuses an action's `visible`", () => {
    const errors = errorsOf({
      objects: [ticket()],
      actions: [{
        name: 'probe_action', label: 'Probe', objectName: 'ticket_probe', type: 'script', target: 'fn',
        visible: 'workingDaysBetween(record.start, today()) > 2',
      }],
    });
    expect(errors.map((e) => e.message)).toEqual([expect.stringContaining('workingDaysBetween() counts with')]);
  });

  it('refuses a record-triggered flow condition', () => {
    const errors = errorsOf({
      objects: [ticket()],
      flows: [{
        name: 'ticket_flow', label: 'Ticket flow', type: 'autolaunched',
        nodes: [
          {
            id: 'start', type: 'start', label: 'Start',
            config: {
              objectName: 'ticket_probe', triggerType: 'record-after-update',
              condition: 'addWorkingHours(record.opened_at, 4) < now()',
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      }],
    });
    expect(errors.map((e) => e.message)).toEqual([expect.stringContaining('addWorkingHours() counts with')]);
  });

  it('refuses a sharing rule condition at both passes: no calendar arithmetic lowers to a filter', () => {
    const stack = specValid({
      objects: [ticket()],
      sharingRules: [{
        name: 'sr', type: 'criteria', object: 'ticket_probe',
        condition: 'addWorkingDays(record.start, 3) < today()',
        sharedWith: { type: 'team', value: 't' }, accessLevel: 'read',
      }],
    });
    const lint = validateStackExpressions(stack).filter((i) => i.severity === 'error');
    expect(lint.map((e) => e.message)).toEqual([expect.stringContaining('addWorkingDays() counts with')]);
    const lowered = validateSharingRuleEnforceability(stack);
    expect(lowered.map((f) => f.message)).toEqual([
      expect.stringContaining('addWorkingDays() counts with a working calendar and evaluates in memory only'),
    ]);
  });

  it("refuses a field's expression `defaultValue`: the default step has no calendar and would leave every insert blank", () => {
    const errors = errorsOf({
      objects: [ticket({ due: { type: 'date', label: 'Due', defaultValue: { dialect: 'cel', source: 'addWorkingDays(today(), 3)' } } })],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.where).toBe("object 'ticket_probe' · field 'due' defaultValue");
    expect(errors[0]!.message).toContain(`${STORE_IT} addWorkingDays()`);
  });

  it('refuses a seed record\'s expression value, at any depth', () => {
    const errors = errorsOf({
      objects: [ticket()],
      data: [{ object: 'ticket_probe', records: [{ name: 'a', start: { dialect: 'cel', source: 'addWorkingDays(today(), 2)' } }] }],
    });
    expect(errors.map((e) => e.where)).toEqual(["data[0] (object 'ticket_probe') · records[0].start"]);
    expect(errors[0]!.message).toContain('addWorkingDays() counts with');
  });

  it('CONTROL: a bare-string `defaultValue` is a literal, and an `addDays()` default or seed value draws nothing', () => {
    const errors = errorsOf({
      objects: [ticket({
        note: { type: 'text', label: 'Note', defaultValue: 'addWorkingDays(today(), 3)' },
        due: { type: 'date', label: 'Due', defaultValue: { dialect: 'cel', source: 'addDays(today(), 3)' } },
      })],
      data: [{ object: 'ticket_probe', records: [{ name: 'a', start: { dialect: 'cel', source: 'daysFromNow(2)' } }] }],
    });
    expect(errors.filter((e) => e.message.includes('working calendar'))).toEqual([]);
  });

  it('CONTROL: the same sites calling `addDays()` draw no working-day refusal', () => {
    const errors = errorsOf({
      objects: [
        ticket({}, {
          validations: [{
            name: 'not_overdue', type: 'script', severity: 'error', message: 'm',
            condition: 'addDays(record.start, 3) < now()',
          }],
        }),
      ],
      actions: [{
        name: 'probe_action', label: 'Probe', objectName: 'ticket_probe', type: 'script', target: 'fn',
        visible: "record.region == 'us'",
      }],
    });
    expect(errors.filter((e) => e.message.includes('working calendar'))).toEqual([]);
  });
});
