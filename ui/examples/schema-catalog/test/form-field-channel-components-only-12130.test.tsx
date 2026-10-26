/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `defaultChecked` and `defaultValue` on a form field, with
 * `@object-ui/components` registered and `@object-ui/fields` NOT registered
 * (objectui#12130).
 *
 * The other registry set of the measurement in
 * `form-field-channel-effects-12130.test.tsx`. Without `@object-ui/fields` no
 * `field:` widget exists, so every type outside the built-in branches takes
 * the form renderer's unregistered-widget default branch: a native `<input>`
 * that receives the entry's leftover keys. Neither key becomes the field's
 * value there either: the box stays unchecked, and the submitted payload
 * carries no value. Each case's control seeds the same value through
 * `FormSchema.defaultValues`, the form's initial-values channel, and reads it
 * back from the same places.
 *
 * It also measures the default branch's own control (objectui#12130 round
 * 3): with no `number` widget registered, an entry that says
 * `inputType: 'number'` draws a native number input there, and its step
 * follows the registered widget's rule; an entry's `className` joins the
 * control's own classes there instead of replacing them.
 *
 * This file imports no field widgets on purpose. That absence IS the registry
 * set it measures, so a module-scope `@object-ui/fields` import added here
 * would silently turn it into a copy of the file beside it.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
};

type Row = Record<string, unknown>;

async function mount(field: Row, defaultValues?: Row) {
  let submitted: Row | undefined;
  const node = {
    type: 'form',
    showSubmit: true,
    submitLabel: 'Go',
    ...(defaultValues ? { defaultValues } : {}),
    fields: [{ name: 'f', label: 'F', ...field }],
    onSubmit: (data: Row) => { submitted = data; },
  };
  const utils = render(<SchemaRenderer schema={node as never} />);
  await settle();
  const row = () => utils.container.querySelector('[data-field="f"]') as HTMLElement;
  const submit = async () => {
    fireEvent.click(utils.getByRole('button', { name: 'Go' }));
    await settle();
    return submitted;
  };
  return { ...utils, row, submit };
}

describe('the registry set this file measures (objectui#12130)', () => {
  it('CONTROL: no field widget is registered, so these types take the default branch', () => {
    for (const type of ['text', 'email', 'number', 'radio', 'boolean']) {
      expect(ComponentRegistry.get(type, 'field'), type).toBeUndefined();
    }
  });
});

describe('`defaultChecked` on a form field is not honored without `@object-ui/fields` (objectui#12130)', () => {
  it.each(['checkbox', 'switch'])('%s', async (type) => {
    const box = (m: Awaited<ReturnType<typeof mount>>) => m.row().querySelector('[role=checkbox],[role=switch]');
    const control = await mount({ type }, { f: true });
    expect(box(control)?.getAttribute('aria-checked')).toBe('true');
    expect((await control.submit())?.f).toBe(true);
    control.unmount();

    const withKey = await mount({ type, defaultChecked: true });
    expect(box(withKey)?.getAttribute('aria-checked')).toBe('false');
    expect((await withKey.submit())?.f).toBe(false);
  });
});

describe('`defaultValue` on a form field never becomes the submitted value without `@object-ui/fields` (objectui#12130)', () => {
  const CASES: ReadonlyArray<readonly [string, unknown]> = [
    ['input', 'preset@x.co'],
    ['textarea', 'preset@x.co'],
    ['text', 'preset@x.co'],
    ['email', 'preset@x.co'],
    ['number', 42],
    ['select', 'b'],
    ['radio', 'b'],
  ];
  const OPTIONS = [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }];

  it.each(CASES)('%s', async (type, value) => {
    const field = { type, ...(type === 'select' || type === 'radio' ? { options: OPTIONS } : {}) };
    const control = await mount(field, { f: value });
    // The default branch draws a native input, which hands back a string.
    expect(String((await control.submit())?.f)).toBe(String(value));
    control.unmount();

    const withKey = await mount({ ...field, defaultValue: value });
    expect((await withKey.submit())?.f).toBeUndefined();
  });
});

describe('the default branch\'s number input takes the `number` widget\'s step without `@object-ui/fields` (objectui#12130)', () => {
  it('an explicit `step` wins, else `10^-scale`, else `any`', async () => {
    const stepOf = async (field: Row) => {
      const m = await mount({ type: 'number', inputType: 'number', ...field });
      const input = m.row().querySelector('input');
      const read = { type: input?.getAttribute('type'), step: input?.getAttribute('step') };
      m.unmount();
      return read;
    };
    expect(await stepOf({})).toEqual({ type: 'number', step: 'any' });
    expect(await stepOf({ scale: 2 })).toEqual({ type: 'number', step: '0.01' });
    expect(await stepOf({ step: 5, scale: 2 })).toEqual({ type: 'number', step: '5' });
  });
});

describe('the default branch merges an entry\'s `className` into its control\'s classes (objectui#12130)', () => {
  it('a read-only control keeps its read-only tint beside the authored class', async () => {
    const classesOf = (m: Awaited<ReturnType<typeof mount>>) =>
      (m.row().querySelector('input')?.getAttribute('class') ?? '').split(/\s+/);
    const without = await mount({ type: 'text', readonly: true });
    expect(classesOf(without)).toContain('bg-muted/40');
    without.unmount();

    const withKey = await mount({ type: 'text', readonly: true, className: 'authored-cls-12130' });
    expect(classesOf(withKey)).toEqual(expect.arrayContaining(['bg-muted/40', 'authored-cls-12130']));
    expect(withKey.row().getAttribute('class') ?? '').not.toContain('authored-cls-12130');
  });
});
