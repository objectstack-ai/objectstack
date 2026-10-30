/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * "Save and add another" on the `object-form` block (objectstack#27602).
 * `submitBehavior: { kind: 'continue' }`, or the legacy `resetOnSuccess: true`
 * on a create form, clears the form after a save. `SimpleObjectForm` renders
 * the same block through two `form` nodes — the flat one and the sectioned
 * one — and only the flat node carried the rule, so a form whose fields are
 * grouped into sections kept the saved record's values, inviting a
 * near-duplicate on the next save. Both nodes now read one shared expression.
 *
 * Pinned on BOTH paths, with the same block:
 *
 *   - `submitBehavior: { kind: 'continue' }` clears after a save;
 *   - `resetOnSuccess: true` on a create form clears after a save;
 *   - neither key declared: the saved values stay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: vi.fn() } };
});

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const objectSchema = {
  name: 'o',
  fields: {
    name: { type: 'text', label: 'Name' },
    note: { type: 'text', label: 'Note' },
  },
};
const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});
const waitInput = (root: ParentNode, name: string) =>
  waitFor(() => {
    const el = root.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

const PATHS = [
  { path: 'flat', shape: {} },
  { path: 'sectioned', shape: { sections: [{ name: 's1', label: 'Main', fields: ['name', 'note'] }] } },
] as const;

/**
 * Renders the block, types a value into `name`, saves, and returns the value
 * `name` holds once the save has fully settled — the form's submit button is
 * disabled for the whole submit, `resetOnSubmit` included, and re-enabled
 * only after it.
 */
const saveAndRead = async (schema: Record<string, unknown>) => {
  const ds = makeDS();
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'o', mode: 'create', ...schema } as any}
      dataSource={ds as any}
    />,
  );
  fireEvent.change(await waitInput(container, 'name'), { target: { value: 'Alpha' } });
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  expect(ds.create.mock.calls[0][1]).toMatchObject({ name: 'Alpha' });
  const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
  await waitFor(() => expect(submit.disabled).toBe(false));
  return (container.querySelector('input[name="name"]') as HTMLInputElement).value;
};

describe.each(PATHS)('ObjectForm — clear after save, $path form (objectstack#27602)', ({ shape }) => {
  beforeEach(() => toastSuccess.mockClear());

  it("submitBehavior { kind: 'continue' } clears the form after a save", async () => {
    expect(await saveAndRead({ ...shape, submitBehavior: { kind: 'continue' } })).toBe('');
  });

  it('resetOnSuccess: true on a create form clears the form after a save', async () => {
    expect(await saveAndRead({ ...shape, resetOnSuccess: true })).toBe('');
  });

  it('neither key declared: the saved values stay', async () => {
    expect(await saveAndRead({ ...shape })).toBe('Alpha');
    expect(toastSuccess).toHaveBeenCalled();
  });
});
