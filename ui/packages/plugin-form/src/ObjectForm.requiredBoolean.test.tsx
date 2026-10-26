/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A required boolean must be creatable in its UNCHECKED state (cloud#972).
 *
 * The reported app is an AI-built task tracker whose 是否完成 field is
 * `{ type: 'boolean', required: true }` — the blueprint field schema cannot
 * carry a `defaultValue`, so the column has none. Two defects stacked up on the
 * create form: the field was absent from the form's values (an OFF switch
 * backed by `undefined`), and react-hook-form's `required` rule reads a boolean
 * `false` as empty anyway. Either one alone makes "未完成" unsavable, so both
 * halves are pinned here, end to end through ObjectForm.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

/** The shape apply_blueprint materializes: required boolean, NO defaultValue. */
const taskSchema = {
  name: 'task',
  fields: {
    title: { type: 'text', label: '任务名称', required: true },
    hours: { type: 'number', label: '工时', required: true },
    is_done: { type: 'boolean', label: '是否完成', required: true },
  },
};

const makeDS = (schema: unknown = taskSchema) => ({
  getObjectSchema: vi.fn().mockResolvedValue(schema),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

describe('ObjectForm — required boolean (cloud#972)', () => {
  it('creates a task with 是否完成 = false, leaving the switch untouched', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'create' } as any}
        dataSource={ds as any}
      />,
    );

    fireEvent.change(await waitInput(container, 'title'), { target: { value: '写周报' } });
    fireEvent.change(await waitInput(container, 'hours'), { target: { value: '2' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ title: '写周报', is_done: false });
  });

  it('a required number still accepts 0', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'create' } as any}
        dataSource={ds as any}
      />,
    );

    fireEvent.change(await waitInput(container, 'title'), { target: { value: '写周报' } });
    fireEvent.change(await waitInput(container, 'hours'), { target: { value: '0' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ hours: 0 });
  });

  it('a blank required text is still refused — the server would reject it too', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'create' } as any}
        dataSource={ds as any}
      />,
    );

    await waitInput(container, 'title');
    fireEvent.change(await waitInput(container, 'hours'), { target: { value: '2' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() =>
      expect(container.querySelector('[data-field="title"]')?.textContent).toMatch(
        /任务名称 is required/,
      ),
    );
    expect(ds.create).not.toHaveBeenCalled();
  });

  it("honours an authored default of `true` rather than forcing false", async () => {
    const ds = makeDS({
      name: 'task',
      fields: {
        title: { type: 'text', label: '任务名称' },
        notify: { type: 'boolean', label: '通知我', defaultValue: true },
      },
    });
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'create' } as any}
        dataSource={ds as any}
      />,
    );

    fireEvent.change(await waitInput(container, 'title'), { target: { value: '写周报' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ notify: true });
  });
});
