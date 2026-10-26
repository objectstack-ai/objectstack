/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Option-value round trip (#3090).
 *
 * `SelectOptionSchema.value` has accepted `string | number | boolean` for as
 * long as it has existed, but the Radix controls underneath speak strings:
 * `onValueChange` hands back `"2"` no matter what the author wrote. Display
 * half-worked (a numeric default matched its numeric item), while SELECTION
 * silently morphed the type — the payload carried `"2"` into a number field,
 * a wrong-typed write nothing on the client ever reported. The renderers now
 * stringify on the way into the control and map the selection back to the
 * AUTHORED value on the way out (`matchOptionValue`).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toControlValue, matchOptionValue } from '../option-value';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there
// the cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

// Radix Select opens on pointer events jsdom does not implement.
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: any = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as any).PointerEvent = MockPointerEvent;
  (HTMLElement.prototype as any).hasPointerCapture = vi.fn();
  (HTMLElement.prototype as any).releasePointerCapture = vi.fn();
  (HTMLElement.prototype as any).scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('matchOptionValue / toControlValue', () => {
  const options = [
    { label: 'One', value: 1 },
    { label: 'Yes', value: true },
    { label: 'Text', value: 'text' },
  ];

  it('maps the control string back to the authored value, type intact', () => {
    expect(matchOptionValue(options, '1')).toBe(1);
    expect(matchOptionValue(options, 'true')).toBe(true);
    expect(matchOptionValue(options, 'text')).toBe('text');
  });

  it('falls back to the raw string when nothing matches (pre-#3090 behavior)', () => {
    expect(matchOptionValue(options, 'free-text')).toBe('free-text');
    expect(matchOptionValue(undefined, 'x')).toBe('x');
  });

  it('stringifies for the control but keeps absent values absent', () => {
    expect(toControlValue(2)).toBe('2');
    expect(toControlValue(false)).toBe('false');
    expect(toControlValue(null)).toBeUndefined();
    expect(toControlValue(undefined)).toBeUndefined();
  });
});

describe('in-form select — the payload carries the authored type', () => {
  it('submits the NUMBER the author wrote, not the string the control spoke', async () => {
    const onSubmit = vi.fn();
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          onSubmit,
          submitLabel: 'Save',
          fields: [
            {
              name: 'count',
              label: 'Count',
              type: 'select',
              options: [
                { label: 'One', value: 1 },
                { label: 'Two', value: 2 },
              ],
            },
          ],
        }}
      />,
    );

    const trigger = document.body.querySelector('[data-field="count"] [role="combobox"]')!;
    expect(trigger).toBeTruthy();
    fireEvent.pointerDown(trigger, { button: 0 });
    const option = await screen.findByRole('option', { name: 'Two' });
    fireEvent.click(option);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // The defect: this used to be the STRING "2".
    expect(onSubmit.mock.calls[0][0].count).toBe(2);
  });

  it('still displays a numeric default (regression for the half that already worked)', async () => {
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          defaultValues: { n: 1 },
          fields: [
            {
              name: 'n',
              label: 'Num',
              type: 'select',
              options: [
                { label: 'One', value: 1 },
                { label: 'Two', value: 2 },
              ],
            },
          ],
        }}
      />,
    );
    await waitFor(() =>
      expect(document.body.querySelector('[data-field="n"]')!.textContent).toContain('One'),
    );
  });
});

describe('standalone select component — onChange receives the authored type', () => {
  it('hands the handler a boolean, not "true"', async () => {
    const onChange = vi.fn();
    const SelectComp = ComponentRegistry.get('select')!;
    render(
      <SelectComp
        // The renderer wires the handler from the component PROP channel.
        onChange={onChange}
        schema={{
          type: 'select',
          id: 'bool-select',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        }}
      />,
    );

    const trigger = document.body.querySelector('[role="combobox"]')!;
    fireEvent.pointerDown(trigger, { button: 0 });
    const option = await screen.findByRole('option', { name: 'No' });
    fireEvent.click(option);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toBe(false);
  });
});
