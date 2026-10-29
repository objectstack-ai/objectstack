/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27483 — a date typed in a form the picker cannot read is a
 * validation error, not a silent drop.
 *
 * The picker never writes text that names no date (`13/45/2026`), so the form
 * value stayed what it was: the record saved with an empty Due Date and a
 * success toast. The picker now reports such text through
 * `onInvalidInputChange`, and the form renderer turns it into the field's
 * error, which refuses submit the way a missing required value does.
 *
 * Mounted through the real `form` renderer with the production registration of
 * the picker, because the defect lives in the hand-off between the two.
 */

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { withFieldCarrier } from '../withFieldCarrier';
import { DatePickerField, DateTimePickerField } from '../widgets/date-picker/DatePickerField';

beforeAll(() => {
  ComponentRegistry.register('date', withFieldCarrier(DatePickerField) as any, {
    namespace: 'field',
    skipFallback: true,
  });
  ComponentRegistry.register('datetime', withFieldCarrier(DateTimePickerField) as any, {
    namespace: 'field',
    skipFallback: true,
  });
}, 60000);

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(type: 'date' | 'datetime', onSubmit: (data: Record<string, unknown>) => void) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues: { title: 'Walkthrough task', due: null },
        fields: [
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'due', label: 'Due Date', type: `field:${type}` },
        ],
        onSubmit,
      }}
    />,
  );
}

async function dueBox(): Promise<HTMLInputElement> {
  return waitFor(() => {
    const input = document.querySelector('[data-field="due"] [data-slot="date-picker"] input');
    if (!input) throw new Error('date picker never rendered');
    return input as HTMLInputElement;
  });
}

const typeAndLeave = (input: HTMLInputElement, text: string) => {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};

const dueRow = () => document.querySelector('[data-field="due"]') as HTMLElement;

/** Press Create and wait for the refusal to land: the form scrolls to its first invalid field. */
async function submitAndSeeRefusal() {
  const scroll = vi.spyOn(Element.prototype as any, 'scrollIntoView');
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await waitFor(() => expect(scroll).toHaveBeenCalled());
}

describe('an unreadable typed date refuses submit (objectstack#27483)', () => {
  it('13/45/2026 marks the field invalid and sends nothing', async () => {
    const onSubmit = vi.fn();
    renderForm('date', onSubmit);
    const input = await dueBox();

    typeAndLeave(input, '13/45/2026');
    // Shown on leaving the field, before any submit: the form's own message,
    // naming the format, and the picker's notice is not drawn beside it.
    await waitFor(() => expect(dueRow().textContent).toContain('MM/DD/YYYY'));
    expect(dueRow().querySelector('[data-testid="date-picker-notice"]')).toBeNull();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await submitAndSeeRefusal();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('13/45/2026');
  });

  it('correcting the text clears the error and the typed day is saved', async () => {
    const onSubmit = vi.fn();
    renderForm('date', onSubmit);
    const input = await dueBox();

    typeAndLeave(input, '13/45/2026');
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));

    typeAndLeave(input, '10/20/2026');
    await waitFor(() => expect(dueRow().textContent).not.toContain('MM/DD/YYYY'));
    expect(input).toHaveAttribute('aria-invalid', 'false');

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: 'Walkthrough task', due: '2026-10-20' });
  });

  it('clearing the bad text withdraws the error and an empty optional date saves', async () => {
    const onSubmit = vi.fn();
    renderForm('date', onSubmit);
    const input = await dueBox();

    typeAndLeave(input, '13/45/2026');
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));

    fireEvent.click(screen.getByTestId('date-picker-clear'));
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'false'));

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('a valid typed date saves untouched (control)', async () => {
    const onSubmit = vi.fn();
    renderForm('date', onSubmit);
    typeAndLeave(await dueBox(), '10/20/2026');

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ due: '2026-10-20' });
  });

  it('datetime: an unreadable date and time refuses submit the same way', async () => {
    const onSubmit = vi.fn();
    renderForm('datetime', onSubmit);
    const input = await dueBox();

    typeAndLeave(input, '13/45/2026 25:99');
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));

    await submitAndSeeRefusal();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
