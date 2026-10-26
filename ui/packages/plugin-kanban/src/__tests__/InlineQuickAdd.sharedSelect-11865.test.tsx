/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The kanban quick-add form's select fields pick with the shared `Select`
 * (objectui#11865).
 *
 * `InlineQuickAdd` drew a `select` field as a browser-native select beside
 * the shared Radix `Select` the rest of the console picks with. The card asks
 * for one control for one kind of choice, surface by surface.
 *
 * What is pinned:
 *   - it IS the primitive (a Radix combobox trigger), shows the value and lists
 *     the native control's options in its order, the placeholder first;
 *   - every option submits what the native control submitted, compared as JSON
 *     text, over three pre-filled values (none, an option, and a value none of
 *     the options carries), the placeholder (the option whose value is `''`)
 *     included; re-picking the current option changes nothing;
 *   - a value is matched by its string, as the native control matched it, and
 *     a value none of the options carries is what the trigger shows;
 *   - the `<label htmlFor>` names the trigger as it named the native control,
 *     and the trigger takes the form's first focus;
 *   - the keys keep the form's contract: Enter on the closed picker submits and
 *     Escape cancels, as on the native control; Space and the arrows open the
 *     list; Enter in the open list selects without submitting, and Escape
 *     there closes the list without cancelling the form.
 *
 * The form has no read-only state.
 *
 * DIRECTION, observed against the native control: the pins that read a
 * control as the primitive's trigger are red there. Green there too, by
 * design, are the pins of what the conversion kept: the names, the first
 * focus, and Enter and Escape on the closed control. The list-key pins go red
 * when the list's key stop is removed, and the closed-Enter pin goes red when
 * the trigger's Enter guard is removed. What makes the submit rows guards of
 * "the conversion changed nothing the form submits" is the literal each
 * compares against: a `change` event on the pre-conversion native control,
 * then Save, submitted that same JSON, read once on this component with these
 * fixtures. The names, the first focus and the closed-control keys were read
 * there the same way.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { InlineQuickAdd } from '../InlineQuickAdd';
import type { InlineFieldDefinition } from '../types';

afterEach(() => cleanup());

const TITLE: InlineFieldDefinition = { name: 'title', type: 'text', label: 'Title' };
const PRIORITY: InlineFieldDefinition = {
  name: 'priority',
  type: 'select',
  label: 'Priority',
  options: [
    { label: 'High', value: 'high' },
    { label: 'Low', value: 'low' },
  ],
};

const PREFILLS: Record<string, Record<string, unknown>> = {
  empty: { title: 'T' },
  low: { title: 'T', priority: 'low' },
  ghost: { title: 'T', priority: 'ghost' },
};

function renderForm(defaultValues: Record<string, unknown>, fields: InlineFieldDefinition[] = [TITLE, PRIORITY]) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(<InlineQuickAdd columnId="c1" fields={fields} onSubmit={onSubmit} onCancel={onCancel} defaultValues={defaultValues} />);
  return { onSubmit, onCancel };
}

async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const options = await openPicker(trigger);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`the picker lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

/** What each submit carried, as JSON text. */
const submitted = (onSubmit: ReturnType<typeof vi.fn>) => onSubmit.mock.calls.map((c) => JSON.stringify(c));

const save = () => fireEvent.click(screen.getByRole('button', { name: /save/i }));

/** [prefill, option label, what Save submitted after the native control's `change`]. */
const WRITES: ReadonlyArray<readonly [string, string, string]> = [
  ['empty', 'Select Priority...', '["c1",{"title":"T","priority":""}]'],
  ['empty', 'High', '["c1",{"title":"T","priority":"high"}]'],
  ['empty', 'Low', '["c1",{"title":"T","priority":"low"}]'],
  ['low', 'Select Priority...', '["c1",{"title":"T","priority":""}]'],
  ['low', 'High', '["c1",{"title":"T","priority":"high"}]'],
  ['low', 'Low', '["c1",{"title":"T","priority":"low"}]'],
  ['ghost', 'Select Priority...', '["c1",{"title":"T","priority":""}]'],
  ['ghost', 'High', '["c1",{"title":"T","priority":"high"}]'],
  ['ghost', 'Low', '["c1",{"title":"T","priority":"low"}]'],
];

describe('InlineQuickAdd — a select field is the shared Select (objectui#11865)', () => {
  it('is the primitive, named by its label, and lists the native options in order', async () => {
    renderForm(PREFILLS.empty);
    const trigger = screen.getByRole('combobox', { name: 'Priority' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toBe('Select Priority...');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['Select Priority...', 'High', 'Low']);
  });

  it.each(WRITES)('prefill "%s", picking "%s" submits what the native control submitted', async (prefill, label, json) => {
    const { onSubmit } = renderForm(PREFILLS[prefill]);
    await pick(screen.getByRole('combobox', { name: 'Priority' }), label);
    save();
    expect(submitted(onSubmit)).toEqual([json]);
  });

  it('a value none of the options carries is what the trigger shows, and it is submitted untouched', async () => {
    const { onSubmit } = renderForm(PREFILLS.ghost);
    const trigger = screen.getByRole('combobox', { name: 'Priority' });
    // The native control showed the placeholder here.
    expect(trigger.textContent).toBe('ghost');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['ghost', 'Select Priority...', 'High', 'Low']);
    fireEvent.click(options[0]);
    save();
    expect(submitted(onSubmit)).toEqual(['["c1",{"title":"T","priority":"ghost"}]']);
  });

  it('a value is matched by its string, a field with no label is named by its name, and the placeholder is the field\'s own', () => {
    const SIZE: InlineFieldDefinition = {
      name: 'size',
      type: 'select',
      options: [
        { label: 'Two', value: '2' },
        { label: 'Three', value: '3' },
      ],
    };
    const { onSubmit } = renderForm({ size: 2 }, [SIZE, { ...SIZE, name: 'size2', placeholder: 'Pick one' }]);
    expect(screen.getByRole('combobox', { name: 'size' }).textContent).toBe('Two');
    expect(screen.getByRole('combobox', { name: 'size2' }).textContent).toBe('Pick one');
    save();
    expect(submitted(onSubmit)).toEqual(['["c1",{"size":2,"size2":""}]']);
  });

  it('the picker takes the form\'s first focus when it is the first field', async () => {
    renderForm({}, [PRIORITY, TITLE]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Priority' }));
  });

  it('Enter on the closed picker submits the form and does not open the list', () => {
    const { onSubmit } = renderForm(PREFILLS.low);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Priority' }), { key: 'Enter' });
    expect(submitted(onSubmit)).toEqual(['["c1",{"title":"T","priority":"low"}]']);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape on the closed picker cancels the form', () => {
    const { onCancel } = renderForm(PREFILLS.low);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Priority' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Space opens the list, and Enter on an option selects it without submitting', async () => {
    const { onSubmit } = renderForm(PREFILLS.empty);
    const trigger = screen.getByRole('combobox', { name: 'Priority' });
    fireEvent.keyDown(trigger, { key: ' ' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'High' }), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(trigger.textContent).toBe('High');
    // Back on the closed picker, Enter submits the picked value.
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(submitted(onSubmit)).toEqual(['["c1",{"title":"T","priority":"high"}]']);
  });

  it('Escape in the open list closes the list and does not cancel the form', async () => {
    const { onCancel } = renderForm(PREFILLS.empty);
    const options = await openPicker(screen.getByRole('combobox', { name: 'Priority' }));
    fireEvent.keyDown(options[1], { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
