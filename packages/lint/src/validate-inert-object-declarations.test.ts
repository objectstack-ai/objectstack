// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
  FIELD_BOOLEAN_REQUIRED,
  STATE_MACHINE_NO_INITIAL_STATES,
  validateInertObjectDeclarations,
} from './validate-inert-object-declarations.js';

const task = (fields: Record<string, unknown>, validations: unknown[] = []) => ({
  name: 'qa_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' }, ...fields },
  validations,
});

const STATUS = {
  type: 'select',
  label: 'Status',
  options: [{ label: 'Draft', value: 'draft' }, { label: 'Approved', value: 'approved' }],
};
const machine = (extra: Record<string, unknown> = {}) => ({
  name: 'status_flow',
  type: 'state_machine',
  message: 'Illegal status change',
  field: 'status',
  transitions: { draft: ['approved'], approved: [] },
  ...extra,
});

describe('field-boolean-required', () => {
  it('refuses a required boolean and a required toggle, at the `required` key', () => {
    const findings = validateInertObjectDeclarations({
      objects: [task({ is_done: { type: 'boolean', label: 'Done', required: true }, on: { type: 'toggle', label: 'On', required: true, defaultValue: false } })],
    });
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [FIELD_BOOLEAN_REQUIRED, 'error', 'objects[0].fields.is_done.required'],
      [FIELD_BOOLEAN_REQUIRED, 'error', 'objects[0].fields.on.required'],
    ]);
    // The fix names the default only where the field has none.
    expect(findings[0].hint).toContain('defaultValue: false');
    expect(findings[1].hint).not.toContain('defaultValue');
  });

  it('is silent on an optional boolean and on a required non-boolean', () => {
    expect(validateInertObjectDeclarations({
      objects: [task({ is_done: { type: 'boolean', label: 'Done', defaultValue: false }, code: { type: 'text', label: 'Code', required: true } })],
    })).toEqual([]);
  });
});

describe('state-machine-no-initial-states', () => {
  it('refuses a state machine with no `initialStates`, naming a first state in the fix', () => {
    const findings = validateInertObjectDeclarations({ objects: [task({ status: STATUS }, [machine()])] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: STATE_MACHINE_NO_INITIAL_STATES, severity: 'error', path: 'objects[0].validations[0]' });
    expect(findings[0].hint).toContain("initialStates: ['draft']");
  });

  it('is silent when the machine declares its entry states, and on other validation types', () => {
    expect(validateInertObjectDeclarations({
      objects: [task({ status: STATUS }, [machine({ initialStates: ['draft'] }), { name: 'r', type: 'script', message: 'm', condition: 'false' }])],
    })).toEqual([]);
  });
});

describe('the runtime publish gate refuses an object write carrying either declaration', () => {
  it('raises each as an error on an `object` write', () => {
    const item = task({ is_done: { type: 'boolean', label: 'Done', required: true }, status: STATUS }, [machine()]);
    const verdict = runRuntimeAuthoringRules({ type: 'object', item });
    const rules = verdict.errors.map((f) => f.rule);
    expect(rules).toContain(FIELD_BOOLEAN_REQUIRED);
    expect(rules).toContain(STATE_MACHINE_NO_INITIAL_STATES);
  });
});
