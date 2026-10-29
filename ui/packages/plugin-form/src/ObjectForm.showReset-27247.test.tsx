/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `showReset` on the `object-form` block is "Show the reset button" in the
 * spec's block contract (objectstack#27247). The renderer used to OR it into
 * the form's `resetOnSubmit`, so `true` drew no button and emptied the form
 * after every save, and `false` did nothing. Pinned here:
 *
 *   - `showReset: true` draws a Reset button on each bar the block mounts with
 *     one form behind it (the flat form, the sectioned form, the tabbed form,
 *     and the drawer/modal footers, which name the form by `id`);
 *   - clicking it restores the values the form opened with and saves nothing;
 *   - a save does NOT clear the form because of `showReset`;
 *   - unset, no Reset button is drawn.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import React from 'react';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: vi.fn() } };
});

import { ObjectForm } from './ObjectForm';
import { ObjectFormContainer } from './ObjectFormContainer';
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
const resetButtons = (root: ParentNode) =>
  Array.from(root.querySelectorAll('button[type="reset"]')) as HTMLButtonElement[];

const renderForm = (schema: Record<string, unknown>, ds = makeDS()) => {
  // The block's drawer/modal route is `ObjectFormContainer`; `ObjectForm`
  // itself never receives those two `formType`s.
  const Form = schema.formType === 'drawer' || schema.formType === 'modal' ? ObjectFormContainer : ObjectForm;
  const utils = render(
    <Form
      schema={{ type: 'object-form', objectName: 'o', mode: 'create', ...schema } as any}
      dataSource={ds as any}
    />,
  );
  return { ...utils, ds };
};

describe('ObjectForm — showReset draws the Reset button (objectstack#27247)', () => {
  it('flat form: the button restores the opening values and saves nothing', async () => {
    const { container, ds } = renderForm({ showReset: true, initialValues: { name: 'Seed' } });
    const name = await waitInput(container, 'name');
    expect(name.value).toBe('Seed');
    fireEvent.change(name, { target: { value: 'Alpha' } });
    expect(name.value).toBe('Alpha');

    const [reset] = resetButtons(container);
    expect(reset).toBeTruthy();
    expect(reset.textContent).toBe('Reset');
    fireEvent.click(reset);

    await waitFor(() => expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Seed'));
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('a save does not clear the form because of showReset', async () => {
    const { container, ds } = renderForm({ showReset: true });
    fireEvent.change(await waitInput(container, 'name'), { target: { value: 'Alpha' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Alpha');
  });

  it('unset: no Reset button is drawn', async () => {
    const { container } = renderForm({});
    await waitInput(container, 'name');
    expect(resetButtons(container)).toHaveLength(0);
  });

  it('view mode: no Reset button, as there is nothing to edit', async () => {
    const ds = makeDS();
    ds.findOne.mockResolvedValue({ id: 'r1', name: 'Kept' });
    const { container } = renderForm({ showReset: true, mode: 'view', recordId: 'r1' }, ds);
    await waitFor(() => expect(container.querySelector('form')).toBeTruthy());
    expect(resetButtons(container)).toHaveLength(0);
  });

  it('sectioned form: the bar draws the button and it restores the opening values', async () => {
    const { container } = renderForm({
      showReset: true,
      sections: [{ name: 's1', label: 'Main', fields: ['name', 'note'] }],
    });
    const note = await waitInput(container, 'note');
    fireEvent.change(note, { target: { value: 'typed' } });
    const [reset] = resetButtons(container);
    expect(reset).toBeTruthy();
    fireEvent.click(reset);
    await waitFor(() => expect((container.querySelector('input[name="note"]') as HTMLInputElement).value).toBe(''));
  });

  it('tabbed form: the bar draws the button', async () => {
    const { container } = renderForm({
      showReset: true,
      formType: 'tabbed',
      sections: [
        { name: 't1', label: 'One', fields: ['name'] },
        { name: 't2', label: 'Two', fields: ['note'] },
      ],
    });
    await waitFor(() => expect(container.querySelector('form')).toBeTruthy());
    expect(resetButtons(container)).toHaveLength(1);
  });

  it('modal: the footer button names the form by id and restores the opening values', async () => {
    renderForm({ showReset: true, formType: 'modal', open: true, initialValues: { name: 'Seed' } });
    const name = await waitInput(document, 'name');
    fireEvent.change(name, { target: { value: 'Alpha' } });

    const footer = await screen.findByTestId('modal-form-footer');
    const [reset] = resetButtons(footer);
    expect(reset).toBeTruthy();
    const form = document.querySelector('form') as HTMLFormElement;
    expect(form.id).toBeTruthy();
    expect(reset.getAttribute('form')).toBe(form.id);

    // The footer sits outside the <form>: the click reaches the form's own
    // `reset` event through the button's `form` attribute.
    fireEvent.click(reset);
    await waitFor(() => expect((document.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Seed'));
  });

  it('drawer: the footer draws the button, naming the form by id', async () => {
    renderForm({ showReset: true, formType: 'drawer', open: true });
    await waitInput(document, 'name');
    const footer = await screen.findByTestId('drawer-form-footer');
    const [reset] = resetButtons(footer);
    expect(reset).toBeTruthy();
    expect(reset.getAttribute('form')).toBe((document.querySelector('form') as HTMLFormElement).id);
  });
});
