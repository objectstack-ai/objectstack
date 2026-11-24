// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
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

describe('state-machine-no-initial-states', () => {
  it('refuses a state machine with no `initialStates`, naming a first state in the fix', () => {
    const findings = validateInertObjectDeclarations({ objects: [task({ status: STATUS }, [machine()])] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: STATE_MACHINE_NO_INITIAL_STATES, severity: 'error', path: 'objects[0].validations[0]' });
    expect(findings[0].hint).toContain("initialStates: ['draft']");
  });

  it('refuses an empty `initialStates` list: the engine reads it as no entry contract', () => {
    const findings = validateInertObjectDeclarations({ objects: [task({ status: STATUS }, [machine({ initialStates: [] })])] });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[STATE_MACHINE_NO_INITIAL_STATES, 'objects[0].validations[0]']]);
  });

  it('is silent on a machine with `active: false`: the engine skips it', () => {
    expect(validateInertObjectDeclarations({ objects: [task({ status: STATUS }, [machine({ active: false })])] })).toEqual([]);
  });

  it('is silent on an update-only machine with no `initialStates`: the engine never runs it on create', () => {
    expect(validateInertObjectDeclarations({ objects: [task({ status: STATUS }, [machine({ events: ['update'] })])] })).toEqual([]);
    expect(validateInertObjectDeclarations({ objects: [task({ status: STATUS }, [machine({ events: [] })])] })).toEqual([]);
  });

  it('still refuses a machine whose `events` name `insert`, or leave it to the default', () => {
    const objects = [
      task({ status: STATUS }, [
        machine({ name: 'explicit_insert', events: ['insert'] }),
        machine({ name: 'both', events: ['update', 'insert'] }),
        machine({ name: 'defaulted' }),
      ]),
    ];
    expect(validateInertObjectDeclarations({ objects }).map((f) => [f.rule, f.path])).toEqual([
      [STATE_MACHINE_NO_INITIAL_STATES, 'objects[0].validations[0]'],
      [STATE_MACHINE_NO_INITIAL_STATES, 'objects[0].validations[1]'],
      [STATE_MACHINE_NO_INITIAL_STATES, 'objects[0].validations[2]'],
    ]);
  });

  it('is silent when the machine declares its entry states, and on other validation types', () => {
    expect(validateInertObjectDeclarations({
      objects: [task({ status: STATUS }, [machine({ initialStates: ['draft'] }), { name: 'r', type: 'script', message: 'm', condition: 'false' }])],
    })).toEqual([]);
  });
});

describe('the runtime publish gate refuses an object write carrying the declaration', () => {
  it('raises it as an error on an `object` write', () => {
    const item = task({ status: STATUS }, [machine()]);
    const verdict = runRuntimeAuthoringRules({ type: 'object', item });
    expect(verdict.errors.map((f) => f.rule)).toContain(STATE_MACHINE_NO_INITIAL_STATES);
  });

  it('passes an `object` write whose only machine is update-only', () => {
    const item = task({ status: STATUS }, [machine({ events: ['update'] })]);
    const verdict = runRuntimeAuthoringRules({ type: 'object', item });
    expect(verdict.errors.map((f) => f.rule)).not.toContain(STATE_MACHINE_NO_INITIAL_STATES);
  });

  it('a required boolean is not refused: the form treats false as present', () => {
    const item = task({ is_done: { type: 'boolean', label: 'Done', required: true, defaultValue: true } });
    const verdict = runRuntimeAuthoringRules({ type: 'object', item });
    expect(verdict.errors.map((f) => f.rule)).not.toContain('field-boolean-required');
  });
});
