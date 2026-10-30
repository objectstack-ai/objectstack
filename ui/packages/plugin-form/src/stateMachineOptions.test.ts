/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #25933 — an edit form's `state_machine` select offers the persisted value
 * plus its declared next states, and #27763 — a create form's offers the
 * machine's `initialStates`, through the one field gate every layout draws
 * through (`gateFormFields`).
 */

import { describe, it, expect } from 'vitest';
import { gateFormFields } from './fieldWriteGate';
import { narrowStateMachineOptions } from './stateMachineOptions';

const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];

const transitions = {
  backlog: ['todo'],
  todo: ['in_progress', 'backlog'],
  in_progress: ['in_review', 'todo'],
  in_review: ['done', 'in_progress'],
  done: ['in_progress'],
};

// The showcase task's rule: update-only, severity left at the spec default.
const taskSchema = (rule: Record<string, unknown> = {}) => ({
  name: 'showcase_task',
  fields: { status: { type: 'select', options: STATUS_OPTIONS } },
  validations: [
    { type: 'state_machine', name: 'task_status_flow', field: 'status', events: ['update'], transitions, ...rule },
  ],
});

// A generated form entry carries BOTH option carriers: its own `options` (the
// form renderer's built-in select) and the raw field metadata under `field`
// (what the registered select widget reads).
const statusField = () => ({
  name: 'status',
  type: 'field:select',
  options: STATUS_OPTIONS,
  field: { type: 'select', options: STATUS_OPTIONS },
});
const titleField = () => ({ name: 'title', type: 'input' });

const values = (opts: unknown) => (opts as Array<{ value: string }>).map((o) => o.value);

describe('narrowStateMachineOptions', () => {
  it('keeps the persisted value plus its declared next states, on both carriers', () => {
    const [status] = narrowStateMachineOptions([statusField()], {
      objectSchema: taskSchema(),
      mode: 'edit',
      previousValues: { status: 'backlog' },
    });
    expect(values(status.options)).toEqual(['backlog', 'todo']);
    expect(values(status.field.options)).toEqual(['backlog', 'todo']);
  });

  it('reads the from-state from the persisted record, not from anything live', () => {
    const [status] = narrowStateMachineOptions([statusField()], {
      objectSchema: taskSchema(),
      mode: 'edit',
      previousValues: { status: 'in_review' },
    });
    expect(values(status.options)).toEqual(['in_progress', 'in_review', 'done']);
  });

  it('leaves a create form unconstrained', () => {
    const fields = [statusField()];
    const out = narrowStateMachineOptions(fields, {
      objectSchema: taskSchema(),
      mode: 'create',
      previousValues: { status: 'backlog' },
    });
    expect(out).toBe(fields);
  });

  it('leaves the form unconstrained until the persisted record has loaded', () => {
    const fields = [statusField()];
    expect(
      narrowStateMachineOptions(fields, { objectSchema: taskSchema(), mode: 'edit', previousValues: undefined }),
    ).toBe(fields);
  });

  it('keeps every option for a warning-severity machine', () => {
    const field = statusField();
    const [status] = narrowStateMachineOptions([field], {
      objectSchema: taskSchema({ severity: 'warning' }),
      mode: 'edit',
      previousValues: { status: 'backlog' },
    });
    expect(status).toBe(field);
  });

  it('keeps every option for an undeclared from-state', () => {
    const field = statusField();
    const [status] = narrowStateMachineOptions([field], {
      objectSchema: taskSchema(),
      mode: 'edit',
      previousValues: { status: 'archived' },
    });
    expect(status).toBe(field);
  });

  it('narrows plain string options too', () => {
    const [status] = narrowStateMachineOptions(
      [{ name: 'status', options: ['backlog', 'todo', 'done'] }],
      { objectSchema: taskSchema(), mode: 'edit', previousValues: { status: 'backlog' } },
    );
    expect(status.options).toEqual(['backlog', 'todo']);
  });

  it('leaves a multi-value field and fields with no machine untouched', () => {
    const multi = { ...statusField(), multiple: true };
    const title = titleField();
    const out = narrowStateMachineOptions([multi, title], {
      objectSchema: taskSchema(),
      mode: 'edit',
      previousValues: { status: 'backlog', title: 'x' },
    });
    expect(out[0]).toBe(multi);
    expect(out[1]).toBe(title);
  });
});

describe('gateFormFields narrows a state-machine select (#25933)', () => {
  const gate = (mode: string, previousValues?: Record<string, unknown>) =>
    gateFormFields<Record<string, any>>([statusField(), titleField()], {
      perms: null,
      objectName: 'showcase_task',
      mode,
      objectSchema: taskSchema() as any,
      previousValues,
    })!;

  it('narrows on an edit form handed its persisted record', () => {
    const [status, title] = gate('edit', { status: 'done' });
    expect(values(status.options)).toEqual(['in_progress', 'done']);
    expect(values(status.field.options)).toEqual(['in_progress', 'done']);
    expect(title).toEqual(titleField());
  });

  it('offers every option on a create form', () => {
    const [status] = gate('create', { status: 'done' });
    expect(values(status.options)).toEqual(values(STATUS_OPTIONS));
  });

  it('offers every option when no persisted record is handed in', () => {
    const [status] = gate('edit');
    expect(values(status.options)).toEqual(values(STATUS_OPTIONS));
  });
});

// #27763 — a create form offers a machine's `initialStates`. The showcase
// project's rule (examples/app-showcase project.object.ts).
const PROJECT_OPTIONS = [
  { value: 'planned', label: 'Planned', default: true },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const projectSchema = (rule: Record<string, unknown> = {}) => ({
  name: 'showcase_project',
  fields: { status: { type: 'select', options: PROJECT_OPTIONS } },
  validations: [
    {
      type: 'state_machine',
      name: 'project_status_flow',
      field: 'status',
      events: ['insert', 'update'],
      initialStates: ['planned'],
      transitions: {
        planned: ['active', 'cancelled'],
        active: ['on_hold', 'completed', 'cancelled'],
      },
      ...rule,
    },
  ],
});
const projectStatus = () => ({
  name: 'status',
  type: 'field:select',
  options: PROJECT_OPTIONS,
  field: { type: 'select', options: PROJECT_OPTIONS },
});

describe('narrowStateMachineOptions on a create form (#27763)', () => {
  it('keeps only the declared initialStates, on both carriers', () => {
    const [status] = narrowStateMachineOptions([projectStatus()], {
      objectSchema: projectSchema(),
      mode: 'create',
    });
    expect(values(status.options)).toEqual(['planned']);
    expect(values(status.field.options)).toEqual(['planned']);
  });

  it('keeps the value the form opens with, even outside initialStates', () => {
    const [status] = narrowStateMachineOptions([projectStatus()], {
      objectSchema: projectSchema(),
      mode: 'create',
      openingValues: { status: 'active' },
    });
    expect(values(status.options)).toEqual(['planned', 'active']);
  });

  it('ignores the persisted record — a create has no from-state', () => {
    const [status] = narrowStateMachineOptions([projectStatus()], {
      objectSchema: projectSchema(),
      mode: 'create',
      previousValues: { status: 'active' },
    });
    expect(values(status.options)).toEqual(['planned']);
  });

  it('CONTROL: a machine that declares no initialStates leaves the create form unconstrained', () => {
    const field = projectStatus();
    const [status] = narrowStateMachineOptions([field], {
      objectSchema: projectSchema({ initialStates: undefined }),
      mode: 'create',
    });
    expect(status).toBe(field);
  });

  it('CONTROL: an edit still narrows from the stored value, not to initialStates', () => {
    const [status] = narrowStateMachineOptions([projectStatus()], {
      objectSchema: projectSchema(),
      mode: 'edit',
      previousValues: { status: 'active' },
      openingValues: { status: 'active' },
    });
    expect(values(status.options)).toEqual(['active', 'on_hold', 'completed', 'cancelled']);
  });

  it('passes a view form through', () => {
    const fields = [projectStatus()];
    expect(narrowStateMachineOptions(fields, { objectSchema: projectSchema(), mode: 'view' })).toBe(fields);
  });

  it('narrows through gateFormFields', () => {
    const [status] = gateFormFields<Record<string, any>>([projectStatus()], {
      perms: null,
      objectName: 'showcase_project',
      mode: 'create',
      objectSchema: projectSchema() as any,
      openingValues: { status: 'planned' },
    })!;
    expect(values(status.options)).toEqual(['planned']);
  });
});
