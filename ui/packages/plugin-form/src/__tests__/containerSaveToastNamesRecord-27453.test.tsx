/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `object-form` block's drawer and modal containers give a save the
 * record-named toast the console's record dialogs give
 * (`ux-conventions.write-feedback`): `Task "Fix login" updated`, through the
 * one shared builder (`recordSaveMessage` in `@object-ui/i18n`), and before
 * the author's `onSuccess` runs — so a React page whose `onSuccess` only
 * closes the overlay and reloads its list still tells the user what it wrote.
 *
 * A host that mounts `DrawerForm` / `ModalForm` itself (the console's record
 * dialog, an action modal) owns its own feedback and is not toasted a second
 * time; a `submitHandler` owns its own persistence and feedback.
 *
 * Direction, written before the run: with the container's toast removed,
 * every "toasts" row RED (no call); the "not toasted" rows GREEN on both sides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: vi.fn() } };
});

import { registerAllFields } from '@object-ui/fields';
import { ObjectFormContainer } from '../ObjectFormContainer';
import { DrawerForm } from '../DrawerForm';

registerAllFields();

const TASK = {
  name: 'showcase_task',
  label: 'Task',
  nameField: 'title',
  fields: {
    title: { type: 'text', label: 'Title' },
    priority: { type: 'text', label: 'Priority' },
  },
};

const STORED = { id: 't1', title: 'Fix login', priority: 'low' };

function makeDS(objectDef: Record<string, unknown> = TASK) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(objectDef),
    findOne: vi.fn().mockResolvedValue({ ...STORED }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'n1', ...d })),
    update: vi.fn(async (_o: string, _id: string, d: Record<string, unknown>) => ({ ...STORED, ...d })),
  } as any;
}

const input = (name: string) =>
  waitFor(() => {
    const el = document.body.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

async function fillAndSubmit(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const el = await input(name);
    await act(async () => {
      fireEvent.change(el, { target: { value } });
    });
  }
  await act(async () => {
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
  });
}

const editSchema = (formType: 'drawer' | 'modal', extra: Record<string, unknown> = {}) =>
  ({
    type: 'object-form',
    objectName: 'showcase_task',
    mode: 'edit',
    recordId: 't1',
    formType,
    open: true,
    ...extra,
  }) as any;

const createSchema = (formType: 'drawer' | 'modal', extra: Record<string, unknown> = {}) =>
  ({ type: 'object-form', objectName: 'showcase_task', mode: 'create', formType, open: true, ...extra }) as any;

beforeEach(() => toastSuccess.mockClear());
afterEach(cleanup);

describe.each(['drawer', 'modal'] as const)('`object-form` `formType: %s` — the save toast names the record', (formType) => {
  it('edit: toasts `Task "TITLE" updated`, then runs the author’s onSuccess with the record', async () => {
    const order: string[] = [];
    toastSuccess.mockImplementation(() => order.push('toast'));
    const onSuccess = vi.fn(() => { order.push('onSuccess'); });
    const ds = makeDS();
    render(<ObjectFormContainer schema={editSchema(formType, { onSuccess })} dataSource={ds} />);
    await waitFor(async () => expect((await input('priority')).value).toBe('low'));
    await fillAndSubmit({ priority: 'high' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Task "Fix login" updated');
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', priority: 'high' }));
    expect(order).toEqual(['toast', 'onSuccess']);
  });

  it('create: toasts `Task "TITLE" created`', async () => {
    const onSuccess = vi.fn();
    const ds = makeDS();
    render(<ObjectFormContainer schema={createSchema(formType, { onSuccess })} dataSource={ds} />);
    await fillAndSubmit({ title: 'Write release notes' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(ds.create).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Task "Write release notes" created');
  });

  it('a metadata-only block (no onSuccess) is toasted too', async () => {
    const ds = makeDS();
    render(<ObjectFormContainer schema={createSchema(formType)} dataSource={ds} />);
    await fillAndSubmit({ title: 'Write release notes' });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Task "Write release notes" created'));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('a record with nothing nameable keeps the object-label toast', async () => {
    const onSuccess = vi.fn();
    // No name field, and no name-ish key on the record: the resolver's floor is `Record #<id>`.
    const ds = makeDS({ name: 'showcase_task', label: 'Task', fields: { priority: { type: 'text', label: 'Priority' } } });
    render(<ObjectFormContainer schema={createSchema(formType, { onSuccess })} dataSource={ds} />);
    await fillAndSubmit({ priority: 'high' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('Task created successfully');
  });

  it('a declared `successMessage` is the toast', async () => {
    const onSuccess = vi.fn();
    const ds = makeDS();
    render(<ObjectFormContainer schema={createSchema(formType, { onSuccess, successMessage: 'Queued!' })} dataSource={ds} />);
    await fillAndSubmit({ title: 'Write release notes' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Queued!');
  });

  it('a `submitHandler` owns persistence and feedback: not toasted', async () => {
    const onSuccess = vi.fn();
    const submitHandler = vi.fn(async (values: Record<string, unknown>) => ({ id: 'h1', ...values }));
    const ds = makeDS();
    render(<ObjectFormContainer schema={createSchema(formType, { onSuccess, submitHandler })} dataSource={ds} />);
    await fillAndSubmit({ title: 'Write release notes' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(submitHandler).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('a host that mounts `DrawerForm` itself owns its feedback', () => {
  it('is not toasted by the form', async () => {
    const onSuccess = vi.fn();
    const ds = makeDS();
    render(
      <DrawerForm
        schema={{ type: 'object-form', formType: 'drawer', objectName: 'showcase_task', mode: 'edit', recordId: 't1', open: true, onSuccess } as any}
        dataSource={ds}
      />,
    );
    await waitFor(async () => expect((await input('priority')).value).toBe('low'));
    await fillAndSubmit({ priority: 'high' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
