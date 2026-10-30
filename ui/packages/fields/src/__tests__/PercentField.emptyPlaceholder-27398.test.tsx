/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27398 row 2, same family — an EMPTY percent box
 * reads as empty.
 *
 * The edit-mode input fell back to the placeholder `0` whenever the field
 * declared none, which beside the `%` adornment reads as a filled-in 0%. The
 * widget now shows the field's own `placeholder`, or none, as `CurrencyField`
 * and `NumberField` do.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PercentField } from '../widgets/PercentField';
import { FieldEditWidget } from '../FieldEditWidget';

afterEach(() => cleanup());

const box = (container: HTMLElement): HTMLInputElement => {
  const el = container.querySelector('input[type=number]');
  if (!el) throw new Error('no percent input rendered');
  return el as HTMLInputElement;
};

/** The attribute as the browser would show it: absent and empty read alike. */
const shownPlaceholder = (container: HTMLElement) => box(container).getAttribute('placeholder') ?? '';

const renderWidget = (field: Record<string, unknown>, value: number | null = null) =>
  render(<PercentField value={value as any} onChange={vi.fn()} field={{ type: 'percent', ...field } as any} />);

describe('PercentField — an empty box shows no numeric stand-in (objectstack#27398 row 2)', () => {
  it('an empty field that declares no placeholder shows none', () => {
    const { container } = renderWidget({ name: 'discount' });
    expect(box(container).value).toBe('');
    expect(shownPlaceholder(container)).toBe('');
  });

  it('an authored empty placeholder stays empty rather than being replaced', () => {
    const { container } = renderWidget({ name: 'discount', placeholder: '' });
    expect(shownPlaceholder(container)).toBe('');
  });

  it('FieldEditWidget (the inline editor) draws an empty percent with no placeholder', () => {
    const { container } = render(
      <FieldEditWidget
        field={{ name: 'discount', type: 'percent', label: 'Discount' } as never}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(shownPlaceholder(container)).toBe('');
  });

  it("CONTROL — the field's own placeholder is still shown", () => {
    const { container } = renderWidget({ name: 'discount', placeholder: 'e.g. 15' });
    expect(shownPlaceholder(container)).toBe('e.g. 15');
  });

  it('CONTROL — a real zero still shows as a value', () => {
    const { container } = renderWidget({ name: 'discount' }, 0);
    expect(box(container).value).toBe('0');
  });
});
