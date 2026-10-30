/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #27763 — a create form's `status` select offers only the object's
 * `state_machine` `initialStates`, the values the server admits on insert.
 *
 * Measured on the showcase "New Project + Tasks" page before the fix: the
 * master-detail create form listed all five project states, and every pick
 * but `planned` came back as `invalid_initial_state`. Pinned on that
 * master-detail form, on the flat in-page create form and on the console's
 * create dialog, read off the hidden native `<select>` Radix renders inside a
 * form, which lists exactly the options the widget was handed.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';
import { MasterDetailForm } from '../MasterDetailForm';

registerAllFields();

const STATUS_OPTIONS = [
  { label: 'Planned', value: 'planned', default: true },
  { label: 'Active', value: 'active' },
  { label: 'On Hold', value: 'on_hold' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];
const ALL = STATUS_OPTIONS.map((o) => o.value);

/** The showcase project (`examples/app-showcase` project.object.ts), as `/meta` serves it. */
const PROJECT = (rule: Record<string, unknown> = {}) => ({
  name: 'showcase_project',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'select', label: 'Status', required: true, options: STATUS_OPTIONS },
  },
  validations: [
    {
      type: 'state_machine',
      name: 'project_status_flow',
      field: 'status',
      events: ['insert', 'update'],
      initialStates: ['planned'],
      message: 'Projects start as Planned, and then move only along the declared status flow.',
      transitions: {
        planned: ['active', 'cancelled'],
        active: ['on_hold', 'completed', 'cancelled'],
        on_hold: ['active', 'cancelled'],
        completed: ['active'],
        cancelled: ['planned'],
      },
      ...rule,
    },
  ],
});

const TASK = { name: 'showcase_task', fields: { title: { type: 'text', label: 'Title' }, project: { type: 'master_detail', reference: 'showcase_project' } } };

const makeDS = (projectSchema: unknown, record: Record<string, unknown> = {}): DataSource =>
  ({
    getObjectSchema: vi.fn(async (obj: string) => (obj === 'showcase_task' ? TASK : projectSchema)),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue(record),
    create: vi.fn().mockResolvedValue({ id: 'p1' }),
    update: vi.fn().mockResolvedValue({ id: 'p1' }),
  }) as unknown as DataSource;

/** The values the hidden native select offers, empty placeholder left out. */
const offered = () =>
  Array.from(
    (document.body.querySelector('select[name="status"]') as HTMLSelectElement | null)?.options ?? [],
  )
    .map((o) => o.value)
    .filter((v) => v !== '');

afterEach(() => cleanup());

const renderObjectForm = (ds: DataSource, extra: Record<string, unknown> = {}) =>
  render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'showcase_project', mode: 'create', fields: ['name', 'status'], ...extra } as any}
      dataSource={ds}
    />,
  );

describe('create form offers a state machine field only its initialStates (#27763)', () => {
  it('the showcase master-detail create form offers only planned', async () => {
    render(
      <MasterDetailForm
        schema={{
          type: 'object-master-detail-form',
          objectName: 'showcase_project',
          mode: 'create',
          formType: 'simple',
          fields: ['name', 'status'],
          details: [{ title: 'Tasks', childObject: 'showcase_task', relationshipField: 'project' }],
        } as any}
        dataSource={makeDS(PROJECT())}
      />,
    );
    await waitFor(() => expect(offered()).toEqual(['planned']));
  });

  it('the flat in-page create form offers only planned', async () => {
    renderObjectForm(makeDS(PROJECT()));
    await waitFor(() => expect(offered()).toEqual(['planned']));
  });

  it('the console create dialog offers only planned', async () => {
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'showcase_project',
          mode: 'create',
          title: 'Project',
          open: true,
          onOpenChange: vi.fn(),
          fields: ['name', 'status'],
        } as any}
        dataSource={makeDS(PROJECT())}
      />,
    );
    await waitFor(() => expect(offered()).toEqual(['planned']));
  });

  it("keeps a caller's pre-fill outside initialStates offered, never silently dropped", async () => {
    renderObjectForm(makeDS(PROJECT()), { initialValues: { status: 'active' } });
    await waitFor(() => expect(offered()).toEqual(['planned', 'active']));
  });

  it('CONTROL: a machine with no initialStates keeps every option on create', async () => {
    renderObjectForm(makeDS(PROJECT({ initialStates: undefined })));
    await waitFor(() => expect(document.body.querySelector('select[name="status"]')).toBeTruthy());
    await waitFor(() => expect(offered()).toEqual(ALL));
  });

  it('CONTROL: an edit form keeps narrowing from the stored value (#25933)', async () => {
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'showcase_project', mode: 'edit', recordId: 'p1', fields: ['name', 'status'] } as any}
        dataSource={makeDS(PROJECT(), { id: 'p1', name: 'P', status: 'active' })}
      />,
    );
    await waitFor(() => expect(offered()).toEqual(['active', 'on_hold', 'completed', 'cancelled']));
  });
});
