/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #25933 — the edit form's `status` select offers only the moves the object's
 * error-severity `state_machine` allows from the stored value.
 *
 * Measured on the showcase task before the fix: a `backlog` task's edit dialog
 * listed all five states, and picking `done` came back from the server as
 * "Invalid task status transition." Pinned through the console's edit dialog
 * (the global `ModalForm`) and the in-page simple form, and read off the
 * hidden native `<select>` Radix renders inside a form, which lists exactly
 * the options the widget was handed.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const STATUS_OPTIONS = [
  { label: 'Backlog', value: 'backlog' },
  { label: 'To Do', value: 'todo' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'In Review', value: 'in_review' },
  { label: 'Done', value: 'done' },
];

/** The showcase task (`examples/app-showcase` task.object.ts), as `/meta` serves it. */
const TASK = (rule: Record<string, unknown> = {}) => ({
  name: 'showcase_task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'select', label: 'Status', options: STATUS_OPTIONS },
  },
  validations: [
    {
      type: 'state_machine',
      name: 'task_status_flow',
      field: 'status',
      events: ['update'],
      message: 'Invalid task status transition.',
      transitions: {
        backlog: ['todo'],
        todo: ['in_progress', 'backlog'],
        in_progress: ['in_review', 'todo'],
        in_review: ['done', 'in_progress'],
        done: ['in_progress'],
      },
      ...rule,
    },
  ],
});

const makeDS = (objectSchema: unknown, record: Record<string, unknown>): DataSource =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn().mockResolvedValue({ id: 't1' }),
    findOne: vi.fn().mockResolvedValue(record),
  }) as unknown as DataSource;

/** The values the hidden native select offers, empty placeholder left out. */
const offered = () =>
  Array.from(
    (document.body.querySelector('select[name="status"]') as HTMLSelectElement | null)?.options ?? [],
  )
    .map((o) => o.value)
    .filter((v) => v !== '');

const ALL = STATUS_OPTIONS.map((o) => o.value);

afterEach(() => cleanup());

const renderModal = (mode: 'edit' | 'create', ds: DataSource) =>
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'showcase_task',
        mode,
        ...(mode === 'edit' ? { recordId: 't1' } : {}),
        title: 'Task',
        open: true,
        onOpenChange: vi.fn(),
        fields: ['title', 'status'],
      } as any}
      dataSource={ds}
    />,
  );

describe('state-machine select narrowing (#25933)', () => {
  it('the console edit dialog offers a backlog task only backlog and todo', async () => {
    renderModal('edit', makeDS(TASK(), { id: 't1', title: 'T', status: 'backlog' }));
    await waitFor(() => expect(offered()).toEqual(['backlog', 'todo']));
  });

  it('narrows from the stored value of an in-review task', async () => {
    renderModal('edit', makeDS(TASK(), { id: 't1', title: 'T', status: 'in_review' }));
    await waitFor(() => expect(offered()).toEqual(['in_progress', 'in_review', 'done']));
  });

  it('CONTROL: a create dialog offers every option', async () => {
    renderModal('create', makeDS(TASK(), {}));
    await waitFor(() => expect(offered()).toEqual(ALL));
  });

  it('CONTROL: a warning-severity machine keeps every option', async () => {
    renderModal('edit', makeDS(TASK({ severity: 'warning' }), { id: 't1', title: 'T', status: 'backlog' }));
    await waitFor(() => expect(document.body.querySelector('select[name="status"]')).toBeTruthy());
    // Let the record load settle before reading the list.
    await waitFor(() => expect(offered()).toEqual(ALL));
  });

  it('the in-page simple edit form narrows the same way', async () => {
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'showcase_task',
          mode: 'edit',
          recordId: 't1',
          fields: ['title', 'status'],
        } as any}
        dataSource={makeDS(TASK(), { id: 't1', title: 'T', status: 'done' })}
      />,
    );
    await waitFor(() => expect(offered()).toEqual(['in_progress', 'done']));
  });
});
