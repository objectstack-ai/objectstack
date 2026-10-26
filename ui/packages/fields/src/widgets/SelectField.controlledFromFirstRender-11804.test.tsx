/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11804 — a select field is a controlled Radix `Select` from its first
 * render, so picking a value never flips it from uncontrolled to controlled.
 *
 * Measured before the fix through the real create form (`ObjectForm` → the
 * form renderer → `field:select` → this widget): a select field the record did
 * not seed opened with the form's value `undefined`, which `SelectField` handed
 * to Radix untouched — an UNCONTROLLED `Select`. The user's first pick made it
 * a string, and Radix logged "Select is changing from uncontrolled to
 * controlled". Opening the form logged nothing; the pick did. A field seeded
 * with a `defaultValue` was controlled from the start and never logged.
 *
 * Three hosts, three pins:
 *  - **the form renderer** (the create form's host): the pick logs nothing, the
 *    trigger shows the pick, and what is SUBMITTED is unchanged — the picked
 *    value for the picked field, and still no value at all for an untouched
 *    one (never the `''` the control now carries);
 *  - **a bare widget with an `onChange`** (inline edit, action dialogs): the
 *    same transition, `undefined` → a value, logs nothing, and the empty
 *    trigger still shows the placeholder;
 *  - **a host with no `onChange`** (a bare SDUI `field:select` node, which
 *    `SchemaRenderer` hands neither a value nor an `onChange`): the control
 *    stays uncontrolled and still shows the user's pick. Mapping `undefined`
 *    to `''` there would freeze it on the placeholder, because nothing would
 *    ever hand the pick back.
 *
 * The widget is registered raw rather than through `registerAllFields()`, which
 * wraps every loader in `React.lazy` (AGENTS.md 测试纪律, objectui#3010).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { SelectField } from './SelectField';

/** The kind of warning this card is about, as Radix words it. */
const FLIP = /changing from uncontrolled to controlled/;

const OPTIONS = [
  { label: 'Gold', value: 'gold' },
  { label: 'Silver', value: 'silver' },
];

let warnings: string[];

beforeAll(() => {
  ComponentRegistry.register('select', SelectField as any, {
    namespace: 'field',
    skipFallback: true,
  });
}, 30000);

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  });
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Radix renders a hidden native `<select>` inside a form; a pick through it
 *  drives the same `onValueChange` a pointer pick does. */
function nativeSelect(container: HTMLElement, name: string): HTMLSelectElement {
  return container.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
}

function trigger(container: HTMLElement, name: string): HTMLElement {
  return container.querySelector(`[data-testid="select-trigger-${name}"]`) as HTMLElement;
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('SelectField is controlled from its first render (objectui#11804)', () => {
  it('in the form renderer, picking an unseeded select logs no flip and submits what it always did', async () => {
    const onSubmit = vi.fn();
    const Form = ComponentRegistry.get('form')!;
    const { container } = render(
      <Form
        schema={{
          type: 'form',
          mode: 'create',
          showSubmit: true,
          showCancel: false,
          submitLabel: 'Create',
          // `field:select` is what `mapFieldTypeToFormType` emits for an
          // object's `select` field — the create form's path. Neither field is
          // seeded, exactly like a select field with no `defaultValue`.
          fields: [
            { name: 'tier', label: 'Tier', type: 'field:select', options: OPTIONS },
            { name: 'band', label: 'Band', type: 'field:select', options: OPTIONS },
          ],
          onSubmit,
        }}
      />,
    );
    await waitFor(() => expect(nativeSelect(container, 'tier')).not.toBeNull());
    await settle();
    expect(trigger(container, 'tier')).toHaveAttribute('data-placeholder');

    fireEvent.change(nativeSelect(container, 'tier'), { target: { value: 'silver' } });
    await settle();

    expect(warnings.filter((w) => FLIP.test(w))).toEqual([]);
    expect(trigger(container, 'tier')).toHaveTextContent('Silver');

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(submitted.tier).toBe('silver');
    // The untouched field: still no value, never the control's `''`.
    expect(submitted.band).toBeUndefined();
  });

  it('a bare widget with an onChange: undefined → a value logs no flip, and the empty trigger shows the placeholder', async () => {
    const field = { name: 'tier', type: 'select', options: OPTIONS } as any;
    const onChange = vi.fn();
    const { container, rerender } = render(
      <SelectField field={field} value={undefined as unknown as string} onChange={onChange} />,
    );
    expect(trigger(container, 'tier')).toHaveAttribute('data-placeholder');

    rerender(<SelectField field={field} value="gold" onChange={onChange} />);
    await settle();

    expect(warnings.filter((w) => FLIP.test(w))).toEqual([]);
    expect(trigger(container, 'tier')).toHaveTextContent('Gold');
    // Mounting a controlled empty control writes nothing back to the host.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a host with no onChange stays uncontrolled: the control still shows the pick', async () => {
    const field = { name: 'tier', type: 'select', options: OPTIONS } as any;
    // A `<form>` ancestor is what makes Radix render its native `<select>`.
    const { container } = render(
      <form>
        <SelectField {...({ field, name: 'tier' } as any)} />
      </form>,
    );
    expect(trigger(container, 'tier')).toHaveAttribute('data-placeholder');

    fireEvent.change(nativeSelect(container, 'tier'), { target: { value: 'gold' } });
    await settle();

    expect(trigger(container, 'tier')).toHaveTextContent('Gold');
    expect(warnings.filter((w) => FLIP.test(w))).toEqual([]);
  });
});
