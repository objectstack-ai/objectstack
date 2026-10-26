/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10291 — the single-value option widgets empty a pruned value to
 * `null`, and render `null` as "nothing chosen".
 *
 * The cascade clear used to emit `undefined`, which the JSON transport drops, so
 * the clear never reached the server. It now emits `null` — the write
 * contract's "clear the stored value" — and the widget-level pins of that live
 * beside each widget (`SelectField.cascade`, `RadioField.cascade`,
 * `optionWidgets.*`). This file pins the other half the change owes: the
 * widget's OWN display of the value it now emits. A form hands the widget
 * whatever it stored, so after a prune the select receives `null`; Radix shows
 * its placeholder only for `''` / `undefined`, and a raw `null` painted a blank
 * trigger with no placeholder.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelectField } from './SelectField';
import { RadioField } from './RadioField';

const OPTIONS = [
  { label: 'Gold', value: 'gold' },
  { label: 'Silver', value: 'silver' },
];

function trigger(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="select-trigger-tier"]') as HTMLElement;
}

describe('objectui#10291 — a null value renders as "nothing chosen"', () => {
  it('SelectField: null shows the placeholder exactly as an empty string does, and never the text "null"', () => {
    const empty = render(
      <SelectField
        value={''}
        onChange={vi.fn()}
        field={{ name: 'tier', type: 'select', options: OPTIONS } as any}
      />,
    );
    const emptyTrigger = trigger(empty.container);
    expect(emptyTrigger).toHaveAttribute('data-placeholder');
    const emptyText = emptyTrigger.textContent;
    empty.unmount();

    const cleared = render(
      <SelectField
        value={null as unknown as string}
        onChange={vi.fn()}
        field={{ name: 'tier', type: 'select', options: OPTIONS } as any}
      />,
    );
    const clearedTrigger = trigger(cleared.container);
    expect(clearedTrigger).toHaveAttribute('data-placeholder');
    expect(clearedTrigger.textContent).toBe(emptyText);
    expect(cleared.container.textContent).not.toContain('null');
  });

  it('RadioField: null checks no radio and never renders the text "null"', () => {
    const { container } = render(
      <RadioField
        value={null as unknown as string}
        onChange={vi.fn()}
        field={{ name: 'band', type: 'radio', options: OPTIONS } as any}
      />,
    );
    expect(container.querySelectorAll('[role="radio"][data-state="checked"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(container.textContent).not.toContain('null');
  });

  it('SelectField: a null value is empty, so the cascade clear never fires on it', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        value={null as unknown as string}
        onChange={onChange}
        field={{ name: 'tier', type: 'select', options: OPTIONS } as any}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
