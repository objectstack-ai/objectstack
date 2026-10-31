/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `object-form` drawer and modal give a save that answers advisory
 * warnings ONE toast, as the record page and the console's record dialogs do
 * (objectstack-ai/objectstack#27999): the record-named message on the warning
 * variant, its warnings one per line — and the write-warning channel raises
 * none of its own.
 *
 * The channel is stood in for by its own door, `parkAnswerWarnings` from
 * `@object-ui/react`, called synchronously inside the write as the adapter's
 * write-warning event is; `channelToast` is the toast the channel would show.
 *
 * Direction, written before the run: with the container's claim removed,
 * every "one toast" row RED (the channel toasts, the save toast is the plain
 * success one); the CONTROL rows GREEN on both sides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { parkAnswerWarnings } from '@object-ui/react';

const { toastSuccess, toastWarning } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastWarning: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, warning: toastWarning, error: vi.fn() } };
});

import { registerAllFields } from '@object-ui/fields';
import { ObjectFormContainer } from '../ObjectFormContainer';

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
const ADVISORY = 'Priority high needs a due date';

/**
 * An adapter whose writes answer `warnings`, announced the way the adapter's
 * write-warning event is: inside the write, before its promise settles.
 * `warnFor` names the record the event is about (default: the written one).
 */
function makeDS(channelToast: (message: string) => void, warnFor?: { id: string }) {
  const ds: any = {
    getObjectSchema: vi.fn().mockResolvedValue(TASK),
    findOne: vi.fn().mockResolvedValue({ ...STORED }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (o: string, d: Record<string, unknown>) => {
      const ev = { operation: 'create' as const, resource: o, id: warnFor?.id ?? 'n1', warnings: [{ message: ADVISORY }] };
      if (!parkAnswerWarnings(ds, ev, () => channelToast(ADVISORY))) channelToast(ADVISORY);
      return { id: 'n1', ...d };
    }),
    update: vi.fn(async (o: string, id: string, d: Record<string, unknown>) => {
      const ev = { operation: 'update' as const, resource: o, id: warnFor?.id ?? id, warnings: [{ message: ADVISORY }] };
      if (!parkAnswerWarnings(ds, ev, () => channelToast(ADVISORY))) channelToast(ADVISORY);
      return { ...STORED, ...d };
    }),
  };
  return ds;
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

beforeEach(() => {
  toastSuccess.mockClear();
  toastWarning.mockClear();
});
afterEach(cleanup);

describe.each(['drawer', 'modal'] as const)('`object-form` `formType: %s` — a save with warnings is one toast', (formType) => {
  it('edit: the record-named toast carries the warnings; the channel shows nothing', async () => {
    const channelToast = vi.fn();
    const onSuccess = vi.fn();
    const ds = makeDS(channelToast);
    render(<ObjectFormContainer schema={editSchema(formType, { onSuccess })} dataSource={ds} />);
    await waitFor(async () => expect((await input('priority')).value).toBe('low'));
    await fillAndSubmit({ priority: 'high' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith('Task "Fix login" updated', { description: ADVISORY });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(channelToast).not.toHaveBeenCalled();
  });

  it('create: the record-named toast carries the warnings of its own record', async () => {
    const channelToast = vi.fn();
    const onSuccess = vi.fn();
    const ds = makeDS(channelToast);
    render(<ObjectFormContainer schema={createSchema(formType, { onSuccess })} dataSource={ds} />);
    await fillAndSubmit({ title: 'Write release notes' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith('Task "Write release notes" created', { description: ADVISORY });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(channelToast).not.toHaveBeenCalled();
  });

  it('a declared `successMessage` carries them too', async () => {
    const channelToast = vi.fn();
    const onSuccess = vi.fn();
    const ds = makeDS(channelToast);
    render(<ObjectFormContainer schema={createSchema(formType, { onSuccess, successMessage: 'Queued!' })} dataSource={ds} />);
    await fillAndSubmit({ title: 'Write release notes' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastWarning).toHaveBeenCalledWith('Queued!', { description: ADVISORY });
    expect(channelToast).not.toHaveBeenCalled();
  });

  it('CONTROL: warnings about another record keep the channel toast; the save toast is the plain one', async () => {
    const channelToast = vi.fn();
    const onSuccess = vi.fn();
    const ds = makeDS(channelToast, { id: 't2' });
    render(<ObjectFormContainer schema={editSchema(formType, { onSuccess })} dataSource={ds} />);
    await waitFor(async () => expect((await input('priority')).value).toBe('low'));
    await fillAndSubmit({ priority: 'high' });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(channelToast).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Task "Fix login" updated');
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('CONTROL: a `submitHandler` claims nothing — the container writes nothing to report', async () => {
    const channelToast = vi.fn();
    const ds = makeDS(channelToast);
    render(
      <ObjectFormContainer
        schema={createSchema(formType, { submitHandler: vi.fn(async (v: Record<string, unknown>) => ({ id: 'h1', ...v })) })}
        dataSource={ds}
      />,
    );
    await input('title');

    await ds.create('showcase_task', { title: 'Written elsewhere' });
    expect(channelToast).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a closed container claims nothing', async () => {
    const channelToast = vi.fn();
    const ds = makeDS(channelToast);
    render(<ObjectFormContainer schema={createSchema(formType, { open: false })} dataSource={ds} />);

    await ds.create('showcase_task', { title: 'Written elsewhere' });
    expect(channelToast).toHaveBeenCalledTimes(1);
  });

  it('closing the container shows what its claim still parks', async () => {
    const channelToast = vi.fn();
    const ds = makeDS(channelToast);
    const { unmount } = render(<ObjectFormContainer schema={createSchema(formType)} dataSource={ds} />);
    await input('title');

    // A create of this object the container did not make, while it is open.
    await ds.create('showcase_task', { title: 'Written elsewhere' });
    expect(channelToast).not.toHaveBeenCalled();
    unmount();
    expect(channelToast).toHaveBeenCalledTimes(1);
  });
});
