/**
 * Unsaved-changes guard — ModalForm & DrawerForm.
 *
 * Closing a create/edit overlay *accidentally* (backdrop click, Escape, the X)
 * while the form has unsaved input must not silently discard that input — those
 * paths intercept with a "Discard changes?" confirmation.
 *
 * The explicit **Cancel button**, by contrast, is an intentional discard: it
 * closes immediately with no prompt, even when the form is dirty. Re-prompting
 * on a deliberate Cancel is just friction. These tests pin both behaviours.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

registerAllFields();

const ds: any = {
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'task',
    // A spread of field types — number/select/date/boolean widgets render an
    // empty value that isn't strictly `undefined`, which used to trip
    // react-hook-form's `isDirty` and make a pristine create form prompt on
    // close. The dirty check must treat all of these as still-pristine.
    fields: {
      title: { type: 'text', label: 'Title' },
      count: { type: 'number', label: 'Count' },
      status: { type: 'select', label: 'Status', options: [{ label: 'A', value: 'a' }] },
      due: { type: 'date', label: 'Due' },
      done: { type: 'boolean', label: 'Done' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  update: vi.fn(),
  findOne: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

/** Type into the first text input to dirty the form. */
async function dirtyTheForm() {
  const input = await waitFor(() => {
    const el = document.querySelector('input') as HTMLInputElement | null;
    if (!el) throw new Error('no input yet');
    return el;
  });
  fireEvent.change(input, { target: { value: 'hello world' } });
}

/**
 * The accidental-close path. Radix routes the X (and Escape/backdrop) through
 * the overlay's `onOpenChange(false)` — the guard only intercepts these, not
 * the explicit Cancel button. The X carries an sr-only "Close" label.
 */
function accidentalClose() {
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

describe('ModalForm unsaved-changes guard', () => {
  it('Cancel closes immediately when the form is pristine (no confirm)', async () => {
    const onOpenChange = vi.fn();
    render(
      <ModalForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());

    fireEvent.click(screen.getByText('Cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Discard changes?')).toBeNull();
  });

  it('Cancel closes immediately even when dirty (intentional discard, no confirm)', async () => {
    const onOpenChange = vi.fn();
    const onCancel = vi.fn();
    render(
      <ModalForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange, onCancel } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    await dirtyTheForm();

    fireEvent.click(screen.getByText('Cancel'));

    // No prompt — the overlay closes straight away and onCancel fires.
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(onCancel).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('accidental close (the X) intercepts with a confirm dialog when dirty', async () => {
    const onOpenChange = vi.fn();
    render(
      <ModalForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    await dirtyTheForm();

    accidentalClose();

    // Confirmation shown, overlay NOT yet closed.
    await waitFor(() => expect(screen.getByText('Discard changes?')).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('"Keep editing" dismisses the confirm and leaves the form open', async () => {
    const onOpenChange = vi.fn();
    render(
      <ModalForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    await dirtyTheForm();
    accidentalClose();
    await waitFor(() => expect(screen.getByText('Discard changes?')).toBeTruthy());

    fireEvent.click(screen.getByText('Keep editing'));

    await waitFor(() => expect(screen.queryByText('Discard changes?')).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('"Discard" confirms and closes the overlay', async () => {
    const onOpenChange = vi.fn();
    render(
      <ModalForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    await dirtyTheForm();
    accidentalClose();
    await waitFor(() => expect(screen.getByText('Discard changes?')).toBeTruthy());

    fireEvent.click(screen.getByText('Discard'));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('confirmOnDiscard: false closes immediately even on an accidental close', async () => {
    const onOpenChange = vi.fn();
    render(
      <ModalForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange, confirmOnDiscard: false } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    await dirtyTheForm();

    accidentalClose();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Discard changes?')).toBeNull();
  });
});

describe('DrawerForm unsaved-changes guard', () => {
  it('Cancel closes immediately even when dirty (intentional discard, no confirm)', async () => {
    const onOpenChange = vi.fn();
    render(
      <DrawerForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange } as any}
        dataSource={ds}
      />,
    );
    await dirtyTheForm();

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('accidental close (the X) intercepts with a confirm dialog when dirty', async () => {
    const onOpenChange = vi.fn();
    render(
      <DrawerForm
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange } as any}
        dataSource={ds}
      />,
    );
    await dirtyTheForm();

    accidentalClose();

    await waitFor(() => expect(screen.getByText('Discard changes?')).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

/**
 * Browser refresh / tab close while dirty. The Radix close guard above never
 * sees an unload — only a `beforeunload` listener can intercept it, so a dirty
 * overlay must register one (and a pristine one must not, or every navigation
 * away from the app would prompt).
 */
function fireBeforeUnload(): Event {
  const evt = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(evt);
  return evt;
}

/**
 * The two overlay containers, as one type.
 *
 * `ModalFormProps.schema` is a `ModalFormSchema` and `DrawerFormProps.schema` a
 * `DrawerFormSchema`, each pinned to its own `formType` literal, so a
 * `describe.each` tuple hands JSX a UNION of the two components — and JSX
 * resolves a union of components by INTERSECTING their props, reducing
 * `formType` to `never` and rejecting every schema including the correct one
 * (`Type 'any' is not assignable to type 'never'`). Naming the surface the
 * parametrisation actually uses is what makes the suite expressible; `schema`
 * can only be `any` here, because a shared schema type would have to be
 * assignable to both variants at once. See the longer note in
 * `recordSwapLoading.test.tsx`, where the same collision accounts for most of
 * this package's #4040 error count.
 */
type OverlayFormContainer = React.ComponentType<{
  schema: any;
  dataSource?: DataSource;
}>;

const OVERLAY_FORMS: ReadonlyArray<readonly [string, OverlayFormContainer]> = [
  ['ModalForm', ModalForm],
  ['DrawerForm', DrawerForm],
];

describe.each(OVERLAY_FORMS)('%s beforeunload guard', (_name, Form) => {
  it('does not block unload while the form is pristine', async () => {
    render(
      <Form
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange: vi.fn() } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => {
      if (!document.querySelector('input')) throw new Error('form not ready');
    });

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('blocks unload while the form is dirty', async () => {
    render(
      <Form
        schema={{ objectName: 'task', mode: 'create', open: true, onOpenChange: vi.fn() } as any}
        dataSource={ds}
      />,
    );
    await dirtyTheForm();

    await waitFor(() => expect(fireBeforeUnload().defaultPrevented).toBe(true));
  });

  it('does not block unload when confirmOnDiscard is false, even dirty', async () => {
    render(
      <Form
        schema={{ objectName: 'task', mode: 'create', open: true, confirmOnDiscard: false, onOpenChange: vi.fn() } as any}
        dataSource={ds}
      />,
    );
    await dirtyTheForm();

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
